#!/usr/bin/env bash
# SEBA — tests RLS pour les 2 RPC de la migration
# 2026-07-26-team-availability-suggestions.sql (create/cancel_my_unavailability_request).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh / test-employee-portal-rls.sh). Comptes/état synthétiques
# entièrement autonomes (ne dépend pas de seed-synthetic.sh/.synthetic-ids.env),
# jamais de donnée réelle.
#
# Scénario : Patron A / Employé A1 / Employé A2 -- création, isolation
# cross-employé, annulation idempotente, immutabilité après décision
# patron, rejet anonyme explicite.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== [1/3] Comptes synthétiques RLSTAS =="
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
PATRON_A_ID=$(create_or_get_user "rlstas-patron-a@test.seba.invalid")
EMPLOYE_A1_ID=$(create_or_get_user "rlstas-emp-a1@test.seba.invalid")
EMPLOYE_A2_ID=$(create_or_get_user "rlstas-emp-a2@test.seba.invalid")
echo "   patron=$PATRON_A_ID  employe A1=$EMPLOYE_A1_ID  employe A2=$EMPLOYE_A2_ID"

echo "== [2/3] État seba_state + rattachements (idempotent) =="
psql_exec <<SQL
insert into seba_state (account, user_id, state) values (
  '$PATRON_A_ID', '$PATRON_A_ID',
  '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_rlstas_a1","prenom":"A1","nom":"RLSTAS","actif":true},{"id":"emp_rlstas_a2","prenom":"A2","nom":"RLSTAS","actif":true}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
delete from employe_accounts where employe_user_id in ('$EMPLOYE_A1_ID','$EMPLOYE_A2_ID');
insert into employe_accounts (employe_user_id, account, employe_id, email) values
  ('$EMPLOYE_A1_ID', '$PATRON_A_ID', 'emp_rlstas_a1', 'rlstas-emp-a1@test.seba.invalid'),
  ('$EMPLOYE_A2_ID', '$PATRON_A_ID', 'emp_rlstas_a2', 'rlstas-emp-a2@test.seba.invalid');
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

run_check "Aucun accès anonyme (role anon) aux 2 RPC" "
begin;
set local role anon;
do \$\$
declare v_err boolean := false;
begin
  begin
    perform create_my_unavailability_request('2026-09-01','2026-09-02','x');
  exception when insufficient_privilege then v_err := true;
  end;
  assert v_err, 'ECHEC SECURITE : create_my_unavailability_request accessible en anon';
  v_err := false;
  begin
    perform cancel_my_unavailability_request('whatever');
  exception when insufficient_privilege then v_err := true;
  end;
  assert v_err, 'ECHEC SECURITE : cancel_my_unavailability_request accessible en anon';
  raise notice 'OK -- les 2 RPC rejettent le role anon';
end \$\$;
rollback;
"

run_check "Employé A1 crée une demande, la retrouve dans son propre profil, A2 ne la voit pas et ne peut pas l'annuler" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb; v_req_id text;
begin
  select create_my_unavailability_request('2026-09-10','2026-09-12','RLS test') into v_res;
  assert (v_res->>'ok')::boolean, 'ECHEC : creation refusee (' || (v_res->>'error') || ')';
  v_req_id := v_res->'request'->>'id';
  perform set_config('request.jwt.claims', '{\"sub\":\"$EMPLOYE_A2_ID\",\"role\":\"authenticated\"}', true);
  select cancel_my_unavailability_request(v_req_id) into v_res;
  assert (v_res->>'ok') = 'false', 'ECHEC SECURITE : employe A2 a pu annuler la demande de A1';
  raise notice 'OK -- isolation cross-employe confirmee (creation + tentative annulation croisee refusee)';
end \$\$;
rollback;
"

run_check "Annulation idempotente (rejeu sur une demande déjà cancelled = no-op ok=true, pas d'erreur)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb; v_req_id text; v_res2 jsonb;
begin
  select create_my_unavailability_request('2026-09-20','2026-09-21','RLS test idempotence') into v_res;
  v_req_id := v_res->'request'->>'id';
  select cancel_my_unavailability_request(v_req_id) into v_res;
  assert (v_res->>'ok')::boolean and v_res->'request'->>'status' = 'cancelled', 'ECHEC : premiere annulation invalide';
  select cancel_my_unavailability_request(v_req_id) into v_res2;
  assert (v_res2->>'ok')::boolean, 'ECHEC : rejeu sur demande deja cancelled devrait renvoyer ok=true (no-op)';
  raise notice 'OK -- annulation idempotente confirmee';
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
