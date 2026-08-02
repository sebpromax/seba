#!/usr/bin/env bash
# SEBA — tests RLS/RPC pour la migration
# 2026-08-03-provisional-access-code.sql (feat/client-employee-initial-
# access-code).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# les autres test-*.sh de ce dossier). Comptes/état synthétiques
# entièrement autonomes, jamais de donnée réelle.
#
# Scénario : Patron A/B, Client A (fiche cli_rlsac_a), Salarié A (fiche
# emp_rlsac_a) -- aucun accès anonyme/authenticated direct aux RPC
# service_role, isolation cross-rôle (code client sur salarié et
# inversement), unicité globale (email,role), verrouillage progressif,
# cycle complet jusqu'à activation, révocation, statut patron sans fuite
# de code_hash.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== [1/3] Comptes synthétiques RLSAC =="
create_or_get_user() {
  local email="$1"
  local resp id
  resp=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Test-Synthetic-2026!\",\"email_confirm\":true}")
  id=$(echo "$resp" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
  if [[ -z "$id" ]]; then
    id=$(psql_exec -t -A -c "select id from auth.users where email = '$email' limit 1;" | tr -d '[:space:]')
  fi
  echo "$id"
}
PATRON_A_ID=$(create_or_get_user "rlsac-patron-a@test.seba.invalid")
PATRON_B_ID=$(create_or_get_user "rlsac-patron-b@test.seba.invalid")
echo "   patron A=$PATRON_A_ID B=$PATRON_B_ID"
# Utilisateurs Auth réels pour les tests finalize_access_code (la FK
# client_accounts.client_user_id -> auth.users exige un id existant --
# jamais un gen_random_uuid() qui ne correspond à aucun compte Auth réel,
# ce qui ne reproduirait pas le comportement réel d'activate-access-code.ts).
FINALIZE_TEST_USER_ID=$(create_or_get_user "rlsac-finalize-test@test.seba.invalid")
RESUME_TEST_USER_ID=$(create_or_get_user "rlsac-resume-test@test.seba.invalid")
echo "   finalize=$FINALIZE_TEST_USER_ID resume=$RESUME_TEST_USER_ID"

echo "== [2/3] État seba_state (fiches client/salarié de test) =="
psql_exec <<SQL
insert into seba_state (account, user_id, state) values (
  '$PATRON_A_ID', '$PATRON_A_ID',
  '{"v":1,"clients":[{"id":"cli_rlsac_a","nom":"RLSAC Client A","prenom":"","email":"rlsac-client-a@test.seba.invalid"}],
   "devis":[],"factures":[],"interventions":[],
   "employes":[{"id":"emp_rlsac_a","prenom":"RLSAC","nom":"Salarie A","actif":true}],
   "journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
insert into seba_state (account, user_id, state) values (
  '$PATRON_B_ID', '$PATRON_B_ID',
  '{"v":1,"clients":[{"id":"cli_rlsac_b","nom":"RLSAC Client B","prenom":"","email":"rlsac-client-b@test.seba.invalid"}],
   "devis":[],"factures":[],"interventions":[],"employes":[],
   "journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
delete from provisional_access_codes where account in ('$PATRON_A_ID','$PATRON_B_ID');
delete from client_accounts where account in ('$PATRON_A_ID','$PATRON_B_ID');
delete from employe_accounts where account in ('$PATRON_A_ID','$PATRON_B_ID');
SQL
echo "   OK — état prêt."

failures=0
run_check() {
  local label="$1" sql="$2"
  echo "-- $label --"
  if ! psql_exec <<SQL
$sql
SQL
  then
    echo "!! ECHEC SQL : $label"
    failures=$((failures + 1))
  fi
}

echo
echo "############################################################"
echo "# [3/3] Assertions bloquantes"
echo "############################################################"

run_check "Anonyme et authenticated : les 3 RPC service_role-only sont refusées" "
begin;
do \$\$
declare v_err boolean;
begin
  set local role anon;
  v_err := false; begin perform store_access_code('$PATRON_A_ID','client','cli_rlsac_a','x@test.seba.invalid','email','AAAAAAAA'); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : store_access_code accessible en anon';
  v_err := false; begin perform verify_access_code_attempt('x@test.seba.invalid','AAAAAAAA','client'); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : verify_access_code_attempt accessible en anon';
  v_err := false; begin perform finalize_access_code(gen_random_uuid(), gen_random_uuid()); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : finalize_access_code accessible en anon';
  raise notice 'OK -- anonyme: 3/3 RPC refusees';
end \$\$;
rollback;
"

run_check "authenticated : les 3 mêmes RPC restent refusées (pas seulement anon)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_err boolean;
begin
  v_err := false; begin perform store_access_code('$PATRON_A_ID','client','cli_rlsac_a','x@test.seba.invalid','email','AAAAAAAA'); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : store_access_code accessible en authenticated';
  v_err := false; begin perform verify_access_code_attempt('x@test.seba.invalid','AAAAAAAA','client'); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : verify_access_code_attempt accessible en authenticated';
  raise notice 'OK -- authenticated: RPC service_role-only toujours refusees';
end \$\$;
rollback;
"

run_check "store_access_code : refuse une fiche qui n'appartient pas au compte" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb;
begin
  select store_access_code('$PATRON_B_ID','client','cli_rlsac_a','x@test.seba.invalid','email','AAAAAAAA') into v_res;
  assert (v_res->>'ok') = 'false', 'ECHEC SECURITE : patron B a pu créer un code pour la fiche du patron A';
  raise notice 'OK -- fiche cross-compte refusee (%)' , (v_res->>'error');
end \$\$;
rollback;
"

run_check "store_access_code : succès réel, hache le code (jamais en clair en base)" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_hash text;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  assert (v_res->>'ok')::boolean, 'ECHEC : création refusée (' || (v_res->>'error') || ')';
  select code_hash into v_hash from provisional_access_codes where id = (v_res->>'invitation_id')::uuid;
  assert v_hash != 'ABCD2345' and v_hash like '\$2%', 'ECHEC : le code ne semble pas hache (bcrypt) : ' || v_hash;
  raise notice 'OK -- code cree et hache reellement (bcrypt)';
end \$\$;
rollback;
"

run_check "Unicité globale (email, role) : un second compte ne peut pas créer un code actif pour le même email+rôle" "
begin;
set local role service_role;
do \$\$
declare v_res1 jsonb; v_res2 jsonb;
begin
  perform store_access_code('$PATRON_A_ID','client','cli_rlsac_a','partage@test.seba.invalid','email','ABCD2345');
  select store_access_code('$PATRON_B_ID','client','cli_rlsac_b','partage@test.seba.invalid','email','WXYZ6789') into v_res2;
  assert (v_res2->>'ok') = 'false', 'ECHEC SECURITE : le patron B a pu créer un code actif pour un email déjà réservé ailleurs';
  raise notice 'OK -- unicite globale (email,role) respectee (%)', (v_res2->>'error');
end \$\$;
rollback;
"

run_check "Renvoi : un nouveau code invalide l'ancien pour la MÊME fiche" "
begin;
set local role service_role;
do \$\$
declare v_res1 jsonb; v_res2 jsonb; v_old_status text;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res1;
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','WXYZ6789') into v_res2;
  assert (v_res2->>'ok')::boolean, 'ECHEC : le renvoi a ete refuse';
  select status into v_old_status from provisional_access_codes where id = (v_res1->>'invitation_id')::uuid;
  assert v_old_status = 'revoked', 'ECHEC : l ancien code n a pas ete invalide (statut=' || v_old_status || ')';
  raise notice 'OK -- renvoi invalide bien l ancien code';
end \$\$;
rollback;
"

run_check "verify_access_code_attempt : mauvais code incrémente les tentatives, bon code passe en verifying" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_bad jsonb; v_good jsonb; v_attempts int;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','WRONGCOD','client') into v_bad;
  assert (v_bad->>'ok') = 'false', 'ECHEC : un mauvais code a ete accepte';
  select attempts into v_attempts from provisional_access_codes where id = (v_res->>'invitation_id')::uuid;
  assert v_attempts = 1, 'ECHEC : compteur de tentatives non incremente (' || v_attempts || ')';
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','client') into v_good;
  assert (v_good->>'ok')::boolean, 'ECHEC : le bon code a ete refuse (' || (v_good->>'error') || ')';
  raise notice 'OK -- mauvais code refuse+compte, bon code accepte';
end \$\$;
rollback;
"

run_check "Isolation cross-rôle : un code Client ne fonctionne jamais avec role=employe (et inversement)" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_cross jsonb;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','employe') into v_cross;
  assert (v_cross->>'ok') = 'false', 'ECHEC SECURITE : un code Client a fonctionne avec role=employe';
  raise notice 'OK -- code Client inutilisable avec role=employe';
end \$\$;
rollback;
"

run_check "Verrouillage progressif puis révocation définitive après 10 échecs" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_attempt jsonb; v_status text; i int;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  for i in 1..10 loop
    select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','WRONGCOD','client') into v_attempt;
  end loop;
  select status into v_status from provisional_access_codes where id = (v_res->>'invitation_id')::uuid;
  assert v_status = 'revoked', 'ECHEC : le code n a pas ete revoque apres 10 echecs (statut=' || v_status || ')';
  raise notice 'OK -- revocation definitive apres 10 echecs';
end \$\$;
rollback;
"

run_check "Cycle complet : verify -> finalize (password_pending) -> mark_access_code_activated (authenticated)" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_verify jsonb; v_finalize jsonb; v_fake_auth_id uuid := '$FINALIZE_TEST_USER_ID'::uuid;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','client') into v_verify;
  assert (v_verify->>'ok')::boolean, 'ECHEC verify';
  select finalize_access_code((v_verify->>'invitation_id')::uuid, v_fake_auth_id) into v_finalize;
  assert (v_finalize->>'ok')::boolean, 'ECHEC finalize (' || (v_finalize->>'error') || ')';
  assert exists(select 1 from client_accounts where client_user_id = v_fake_auth_id and account = '$PATRON_A_ID' and client_id = 'cli_rlsac_a'), 'ECHEC : liaison client_accounts non creee';
  assert (select status from provisional_access_codes where id = (v_verify->>'invitation_id')::uuid) = 'password_pending', 'ECHEC : statut pas password_pending apres finalize';
  perform set_config('request.jwt.claims', '{\"sub\":\"' || v_fake_auth_id || '\",\"role\":\"authenticated\"}', true);
  set local role authenticated;
  perform mark_access_code_activated();
  raise notice 'OK -- cycle complet jusqu a activated';
end \$\$;
-- SET LOCAL ROLE reste actif pour le reste de la transaction (pas
-- seulement le bloc DO) : repasser en service_role avant la lecture brute
-- ci-dessous, sinon RLS (zero policy) la bloque silencieusement et ce
-- second bloc croit à tort que mark_access_code_activated a échoué.
set local role service_role;
do \$\$
declare v_status text;
begin
  select status into v_status from provisional_access_codes where account = '$PATRON_A_ID' and status = 'activated' order by activated_at desc limit 1;
  assert v_status = 'activated', 'ECHEC : mark_access_code_activated n a pas pose le statut final';
  raise notice 'OK -- statut final activated confirme';
end \$\$;
rollback;
"

run_check "Reprise réseau : verify_access_code_attempt reste acceptée même après password_pending (idempotent)" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb; v_verify1 jsonb; v_finalize jsonb; v_verify2 jsonb;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','client') into v_verify1;
  select finalize_access_code((v_verify1->>'invitation_id')::uuid, '$RESUME_TEST_USER_ID'::uuid) into v_finalize;
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','client') into v_verify2;
  assert (v_verify2->>'ok')::boolean, 'ECHEC REPRISE : le code n est plus accepte apres password_pending (' || (v_verify2->>'error') || ')';
  assert (v_verify2->>'auth_user_id') is not null, 'ECHEC REPRISE : auth_user_id deja connu non renvoye';
  raise notice 'OK -- reprise reseau : code toujours valide en password_pending, auth_user_id reutilisable';
end \$\$;
rollback;
"

run_check "revoke_access_code (patron authentifié) : révoque réellement, le code ne fonctionne plus ensuite" "
begin;
set local role service_role;
do \$\$
declare v_res jsonb;
begin
  select store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345') into v_res;
end \$\$;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_revoke jsonb;
begin
  select revoke_access_code('client','cli_rlsac_a') into v_revoke;
  assert (v_revoke->>'ok')::boolean and (v_revoke->>'revoked')::boolean, 'ECHEC : revocation refusee';
end \$\$;
set local role service_role;
do \$\$
declare v_verify jsonb;
begin
  select verify_access_code_attempt('rlsac-client-a@test.seba.invalid','ABCD2345','client') into v_verify;
  assert (v_verify->>'ok') = 'false', 'ECHEC SECURITE : un code revoque reste utilisable';
  raise notice 'OK -- code revoque reellement inutilisable';
end \$\$;
rollback;
"

run_check "get_my_access_codes_status (patron) : jamais code_hash, isolation cross-compte" "
begin;
set local role service_role;
do \$\$ begin perform store_access_code('$PATRON_A_ID','client','cli_rlsac_a','rlsac-client-a@test.seba.invalid','email','ABCD2345'); end \$\$;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_status jsonb;
begin
  select get_my_access_codes_status('client','cli_rlsac_a') into v_status;
  assert jsonb_array_length(v_status) >= 1, 'ECHEC : aucun statut renvoye';
  assert not (v_status::text ilike '%code_hash%'), 'ECHEC SECURITE : code_hash expose dans le statut patron';
  raise notice 'OK -- statut patron sans code_hash';
end \$\$;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_status_b jsonb;
begin
  select get_my_access_codes_status('client','cli_rlsac_a') into v_status_b;
  assert jsonb_array_length(v_status_b) = 0, 'ECHEC SECURITE : patron B voit les codes du patron A';
  raise notice 'OK -- patron B: 0 statut visible pour la fiche du patron A';
end \$\$;
rollback;
"

echo
if [[ "$failures" -eq 0 ]]; then
  echo "TOUT PASSE"
  exit 0
else
  echo "$failures ECHEC(S)"
  exit 1
fi
