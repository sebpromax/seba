#!/usr/bin/env bash
# SEBA — Suite de tests T2 : create_profile_and_company (secteur + idempotence).
# Révisée le 2026-07-22 (durcissement) : retour UUID (pas jsonb), SECURITY
# DEFINER + garde-fou explicite, aucune nouvelle policy sur profiles/companies.
# À exécuter APRÈS rebuild.sh (baseline + migration produit T2 déjà appliqués).
# Comptes 100% synthétiques, créés et détruits par ce script lui-même.
set -euo pipefail
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

create_user() {
  local email="$1"
  curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Test-Synthetic-2026!\",\"email_confirm\":true}" \
    | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4
}

call_rpc() {
  local caller_uid="$1" target_uid="$2" sector="$3" name="$4"
  psql_exec -t -A <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$caller_uid","role":"authenticated"}';
select create_profile_and_company('$target_uid'::uuid, $sector, '$name');
commit;
SQL
}

echo "== Création des comptes synthétiques T2 =="
UID_MENAGE=$(create_user "t2-menage@test.seba.invalid")
UID_CONCIERGERIE=$(create_user "t2-conciergerie@test.seba.invalid")
UID_MAINTENANCE=$(create_user "t2-maintenance@test.seba.invalid")
UID_AUTRE=$(create_user "t2-autre@test.seba.invalid")
UID_UNKNOWN=$(create_user "t2-unknown-sector@test.seba.invalid")
UID_NULL=$(create_user "t2-null-sector@test.seba.invalid")
UID_REPEAT=$(create_user "t2-repeat@test.seba.invalid")
UID_MISMATCH=$(create_user "t2-mismatch@test.seba.invalid")
UID_CONCURRENT=$(create_user "t2-concurrent@test.seba.invalid")
UID_PARTIAL=$(create_user "t2-partial-repair@test.seba.invalid")
UID_ISO_A=$(create_user "t2-isolation-a@test.seba.invalid")
UID_ISO_B=$(create_user "t2-isolation-b@test.seba.invalid")
UID_ATTACKER=$(create_user "t2-attacker@test.seba.invalid")
UID_VICTIM=$(create_user "t2-victim@test.seba.invalid")
UID_REPEAT10=$(create_user "t2-repeat10@test.seba.invalid")
echo "   15 comptes créés."

echo
echo "############################################################"
echo "# Tests 1-4 : création avec les 4 secteurs réellement accessibles"
echo "############################################################"
echo "-- menage --"; call_rpc "$UID_MENAGE" "$UID_MENAGE" "'menage'" "Entreprise Menage Test"
echo "-- conciergerie --"; call_rpc "$UID_CONCIERGERIE" "$UID_CONCIERGERIE" "'conciergerie'" "Entreprise Conciergerie Test"
echo "-- maintenance --"; call_rpc "$UID_MAINTENANCE" "$UID_MAINTENANCE" "'maintenance'" "Entreprise Maintenance Test"
echo "-- autre --"; call_rpc "$UID_AUTRE" "$UID_AUTRE" "'autre'" "Entreprise Autre Test"
echo "(attendu : chaque appel retourne un UUID (profile_id), aucune erreur)"

echo
echo "############################################################"
echo "# Test 5 : rejet d'un secteur inconnu, avec erreur explicite"
echo "############################################################"
set +e
call_rpc "$UID_UNKNOWN" "$UID_UNKNOWN" "'plomberie'" "Entreprise Inconnue" 2>&1
set -e
echo "(attendu : exception explicite 'secteur inconnu', errcode 22023)"

echo
echo "############################################################"
echo "# Test 6 : comportement avec secteur NULL"
echo "############################################################"
set +e
call_rpc "$UID_NULL" "$UID_NULL" "null" "Entreprise Null" 2>&1
set -e
echo "(attendu : violation NOT NULL sur profiles.sector, colonne inchangee)"

echo
echo "############################################################"
echo "# Test 15 : rollback complet lors d'une erreur (aucun profil créé)"
echo "############################################################"
psql_exec -c "select count(*) as profils_uid_unknown_apres_echec from profiles where user_id = '$UID_UNKNOWN';"
echo "(attendu : 0)"

echo
echo "############################################################"
echo "# Test 7 : second appel identique -- retourne le MÊME uuid, aucune erreur"
echo "############################################################"
FIRST=$(call_rpc "$UID_REPEAT" "$UID_REPEAT" "'menage'" "Entreprise Repeat Test")
echo "Premier appel  -> $FIRST"
SECOND=$(call_rpc "$UID_REPEAT" "$UID_REPEAT" "'menage'" "Entreprise Repeat Test")
echo "Second appel   -> $SECOND"
if [[ "$FIRST" == "$SECOND" ]]; then echo "OK -- meme profile_id retourne"; else echo "!! ECHEC -- profile_id different"; exit 1; fi
psql_exec -c "select count(*) as profils_repeat from profiles where user_id = '$UID_REPEAT';"
psql_exec -c "select count(*) as companies_repeat from companies c join profiles p on p.id = c.profile_id where p.user_id = '$UID_REPEAT';"
echo "(attendu : 1 et 1)"

echo
echo "############################################################"
echo "# Test 8 : second appel avec un secteur DIFFÉRENT -> exception explicite"
echo "############################################################"
call_rpc "$UID_MISMATCH" "$UID_MISMATCH" "'menage'" "Entreprise Mismatch Test"
set +e
call_rpc "$UID_MISMATCH" "$UID_MISMATCH" "'conciergerie'" "Entreprise Mismatch Test" 2>&1
set -e
psql_exec -c "select sector from profiles where user_id = '$UID_MISMATCH';"
echo "(attendu : exception explicite, secteur toujours 'menage', jamais ecrase)"

echo
echo "############################################################"
echo "# Test 19 (nouveau) : un utilisateur ne peut pas créer/modifier le profil d'un AUTRE"
echo "############################################################"
set +e
call_rpc "$UID_ATTACKER" "$UID_VICTIM" "'menage'" "Entreprise Usurpee" 2>&1
set -e
psql_exec -c "select count(*) as profils_victime from profiles where user_id = '$UID_VICTIM';"
echo "(attendu : exception '_user_id doit correspondre a l'utilisateur authentifie', 0 profil cree pour la victime)"

echo
echo "############################################################"
echo "# Test 20 (nouveau) : impossibilité de modifier le secteur par un UPDATE direct (hors RPC)"
echo "############################################################"
set +e
psql_exec <<SQL 2>&1
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$UID_MENAGE","role":"authenticated"}';
update profiles set sector = 'autre' where user_id = '$UID_MENAGE';
commit;
SQL
set -e
psql_exec -c "select sector from profiles where user_id = '$UID_MENAGE';"
echo "(attendu ci-dessus : 0 ligne affectee par l'UPDATE -- silencieusement bloque par RLS, aucune policy UPDATE n'existe -- sector reste 'menage')"

echo
echo "############################################################"
echo "# Test 21 (nouveau) : policies actuelles sur profiles (aucune UPDATE)"
echo "############################################################"
psql_exec -c "select policyname, cmd from pg_policies where schemaname='public' and tablename='profiles' order by policyname;"
echo "(attendu : profiles_select (SELECT) et profiles_insert (INSERT) uniquement -- aucune ligne UPDATE)"

echo
echo "############################################################"
echo "# Test 9 : deux appels concurrents (même utilisateur, mêmes paramètres)"
echo "############################################################"
( call_rpc "$UID_CONCURRENT" "$UID_CONCURRENT" "'maintenance'" "Entreprise Concurrente" & \
  call_rpc "$UID_CONCURRENT" "$UID_CONCURRENT" "'maintenance'" "Entreprise Concurrente" & \
  wait ) 2>&1
psql_exec -c "select count(*) as profils_concurrent from profiles where user_id = '$UID_CONCURRENT';"
psql_exec -c "select count(*) as companies_concurrent from companies c join profiles p on p.id = c.profile_id where p.user_id = '$UID_CONCURRENT';"
echo "(attendu : 1 et 1)"

echo
echo "############################################################"
echo "# Test 22 (nouveau) : 10 répétitions du test concurrent, résultat stable"
echo "############################################################"
for i in $(seq 1 10); do
  UID_REP=$(create_user "t2-concurrent-rep-${i}@test.seba.invalid")
  ( call_rpc "$UID_REP" "$UID_REP" "'menage'" "Rep $i A" > /dev/null 2>&1 & \
    call_rpc "$UID_REP" "$UID_REP" "'menage'" "Rep $i B" > /dev/null 2>&1 & \
    wait )
  P=$(psql_exec -t -A -c "select count(*) from profiles where user_id = '$UID_REP';")
  C=$(psql_exec -t -A -c "select count(*) from companies c join profiles p on p.id = c.profile_id where p.user_id = '$UID_REP';")
  echo "   répétition $i -> profils=$P companies=$C"
  if [[ "$P" != "1" || "$C" != "1" ]]; then echo "!! ECHEC répétition $i"; exit 1; fi
done
echo "OK -- 10/10 répétitions stables, aucun doublon"

echo
echo "############################################################"
echo "# Test 11 : profil existant SANS entreprise (état partiel réparé)"
echo "############################################################"
call_rpc "$UID_PARTIAL" "$UID_PARTIAL" "'menage'" "Entreprise Partial Test"
psql_exec -c "delete from companies where profile_id = (select id from profiles where user_id = '$UID_PARTIAL');"
call_rpc "$UID_PARTIAL" "$UID_PARTIAL" "'menage'" "Entreprise Partial Test"
psql_exec -c "select count(*) as companies_partial from companies c join profiles p on p.id = c.profile_id where p.user_id = '$UID_PARTIAL';"
echo "(attendu : 1 -- entreprise recréée car le secteur correspond)"

echo
echo "############################################################"
echo "# Test 12 : état incohérent (plusieurs entreprises, corruption simulée)"
echo "############################################################"
psql_exec -c "insert into companies (profile_id, name) select id, 'Entreprise Corrompue Duplicata' from profiles where user_id = '$UID_PARTIAL';"
call_rpc "$UID_PARTIAL" "$UID_PARTIAL" "'menage'" "Entreprise Partial Test"
psql_exec -c "select count(*) as companies_corrompues from companies c join profiles p on p.id = c.profile_id where p.user_id = '$UID_PARTIAL';"
echo "(attendu : 2 -- pas de 3e doublon créé, corruption pré-existante non réparée automatiquement, design assumé)"

echo
echo "############################################################"
echo "# Test 16 : isolation entre deux utilisateurs"
echo "############################################################"
call_rpc "$UID_ISO_A" "$UID_ISO_A" "'menage'" "Entreprise Isolation A"
call_rpc "$UID_ISO_B" "$UID_ISO_B" "'conciergerie'" "Entreprise Isolation B"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$UID_ISO_A","role":"authenticated"}';
select count(*) as profils_visibles_par_a from profiles;
rollback;
SQL
echo "(attendu : 1)"

echo
echo "############################################################"
echo "# Test 13-14 : absence globale de doublons"
echo "############################################################"
psql_exec -c "select user_id, count(*) from profiles group by user_id having count(*) > 1;"
echo "(attendu : aucune ligne)"

echo
echo "############################################################"
echo "# Test 17 : permissions de la RPC"
echo "############################################################"
psql_exec -c "select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'create_profile_and_company';"
set +e
psql_exec <<'SQL' 2>&1
begin;
set local role anon;
select create_profile_and_company('00000000-0000-0000-0000-000000000000'::uuid, 'menage', 'Test Anon');
rollback;
SQL
set -e
echo "(attendu : authenticated+postgres seulement ; permission denied pour anon)"

echo
echo "############################################################"
echo "# Test 18 : test de contrat frontend/SQL sur les secteurs"
echo "############################################################"
node "$(dirname "${BASH_SOURCE[0]}")/test-sector-contract.js"

echo
echo "############################################################"
echo "# Suite de tests T2 terminée (25 vérifications)."
echo "############################################################"
