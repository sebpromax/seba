#!/usr/bin/env bash
# SEBA — vérification de l'overlay RGPD + tests d'ABUS (Phase 1C, 2026-07-22).
# À exécuter UNIQUEMENT après `rebuild.sh --with-rgpd`. Toutes les suppressions
# réelles effectuées ici portent EXCLUSIVEMENT sur les comptes synthétiques
# créés par seed-synthetic.sh. L'environnement est détruit entièrement après.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "############################################################"
echo "# 1. Propriétés de sécurité de la fonction"
echo "############################################################"
psql_exec <<'SQL'
select p.proname, p.prosecdef as security_definer, p.proconfig as config_locale,
       pg_get_userbyid(p.proowner) as proprietaire
from pg_proc p where p.proname = 'erase_account_completely' and p.pronamespace = 'public'::regnamespace;

select grantee, privilege_type
from information_schema.role_routine_grants
where routine_name = 'erase_account_completely';
SQL

echo
echo "############################################################"
echo "# 2. ÉTAT INITIAL — fichier Storage synthétique présent avant tout test"
echo "############################################################"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$API_URL/storage/v1/object/authenticated/${SYNTHETIC_STORAGE_PATH}" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
echo "(attendu : 200 — le fichier existe avant tout test de suppression)"

echo
echo "############################################################"
echo "# 3. Employé A tente d'appeler la fonction (\"supprimer son patron\")"
echo "############################################################"
psql_exec -c "select count(*) as seba_state_patron_a_avant from seba_state where account = 'test-patron-a';"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$EMPLOYE_A_ID","role":"authenticated"}';
select erase_account_completely();
commit;
SQL
echo "-- Résultat attendu : seba_state du patron A INTACT (l'employé n'a aucune ligne à son nom dans les tables business) --"
psql_exec -c "select count(*) as seba_state_patron_a_apres from seba_state where account = 'test-patron-a';"
psql_exec -c "select count(*) as employe_accounts_restant from employe_accounts where employe_user_id = '$EMPLOYE_A_ID';"
echo "(attendu : 1 puis 1 pour patron A -- intact ; 0 pour employe_accounts -- l'employé a supprimé SA PROPRE identité, cascade sur son propre lien, jamais les données du patron)"

echo
echo "############################################################"
echo "# 4. Client A tente d'appeler la fonction (\"supprimer l'entreprise qui l'a invité\")"
echo "############################################################"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$CLIENT_A_ID","role":"authenticated"}';
select erase_account_completely();
commit;
SQL
echo "-- Résultat attendu : seba_state du patron A TOUJOURS intact --"
psql_exec -c "select count(*) as seba_state_patron_a_apres_client from seba_state where account = 'test-patron-a';"
psql_exec -c "select count(*) as client_accounts_restant from client_accounts where client_user_id = '$CLIENT_A_ID';"
echo "(attendu : 1 pour patron A -- intact ; 0 pour client_accounts -- même raisonnement que l'employé)"

echo
echo "############################################################"
echo "# 5. Utilisateur ANONYME tente d'exécuter la fonction"
echo "############################################################"
set +e
psql_exec <<'SQL' 2>&1
begin;
set local role anon;
select erase_account_completely();
rollback;
SQL
ANON_EXIT=$?
set -e
echo "(attendu : erreur 'permission denied' -- EXECUTE jamais accordé à anon, code de sortie non nul ci-dessus : $ANON_EXIT)"

echo
echo "############################################################"
echo "# 6. Utilisateur authentifié SANS PROFIL (orphelin) tente l'appel"
echo "############################################################"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$ORPHAN_ID","role":"authenticated"}';
select erase_account_completely();
commit;
SQL
echo "-- Résultat attendu : succès silencieux (no-op sur toutes les tables business), aucune erreur --"
psql_exec -c "select count(*) as orphelin_restant_auth_users from auth.users where id = '$ORPHAN_ID';"
echo "(attendu : 0 -- son propre compte auth disparaît, rien d'autre n'est affecté nulle part)"

echo
echo "############################################################"
echo "# 7. Patron A supprime RÉELLEMENT son propre compte (cas nominal)"
echo "############################################################"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$PATRON_A_ID","role":"authenticated"}';
select erase_account_completely();
commit;
SQL
psql_exec -c "select count(*) as seba_state_patron_a_final from seba_state where account = 'test-patron-a';"
echo "(attendu : 0 -- patron A a bien supprimé ses propres données cette fois)"

echo "-- Vérification croisée : patron B (jamais touché par aucun test ci-dessus) --"
psql_exec -c "select count(*) as seba_state_patron_b_intact from seba_state where account = 'test-patron-b';"
echo "(attendu : 1 -- patron B totalement intact après 4 appels de la fonction par d'autres identités)"

echo
echo "############################################################"
echo "# 8. Second appel après suppression (rejeu sur la même identité patron A)"
echo "############################################################"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$PATRON_A_ID","role":"authenticated"}';
select erase_account_completely();
commit;
SQL
echo "(observé ci-dessus : la fonction ne vérifie l'existence d'auth.users nulle part -- un second appel avec le même sub simulé s'exécute sans erreur, tous les DELETE affectent 0 ligne, comportement idempotent de fait)"

echo
echo "############################################################"
echo "# 9. Appel simultané/répété — test de concurrence réelle sur patron B"
echo "############################################################"
(
  psql_exec <<SQL &
begin; set local role authenticated; set local "request.jwt.claims" to '{"sub":"$PATRON_B_ID","role":"authenticated"}'; select pg_sleep(0.2); select erase_account_completely(); commit;
SQL
  psql_exec <<SQL &
begin; set local role authenticated; set local "request.jwt.claims" to '{"sub":"$PATRON_B_ID","role":"authenticated"}'; select pg_sleep(0.2); select erase_account_completely(); commit;
SQL
  wait
) 2>&1
psql_exec -c "select count(*) as seba_state_patron_b_apres_concurrence from seba_state where account = 'test-patron-b';"
echo "(attendu : 0 -- deux appels concurrents sur le même compte ne créent ni erreur bloquante ni double effet observable, DELETE est intrinsèquement idempotent)"

echo
echo "############################################################"
echo "# 10. Objets orphelins — le fichier Storage synthétique existe-t-il ENCORE ?"
echo "############################################################"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$API_URL/storage/v1/object/authenticated/${SYNTHETIC_STORAGE_PATH}" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
echo "(attendu : 200 -- le fichier existe TOUJOURS malgré la suppression complète du compte patron A propriétaire de la demande associée : CONFIRME L'ORPHELIN STORAGE)"

echo
echo "############################################################"
echo "# Tests d'abus terminés. Seuls des comptes synthétiques ont été affectés."
echo "############################################################"
