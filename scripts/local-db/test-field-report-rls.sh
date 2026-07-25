#!/usr/bin/env bash
# SEBA — tests d'isolation RLS pour submit_my_intervention_field_report
# (migrations/2026-07-24-mission-field-report.sql, feature/client-crm-advanced).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (meme contrat que
# verify.sh / test-employee-portal-rls.sh).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

# Employe A2 : cree par test-employee-portal-rls.sh mais jamais persiste
# dans .synthetic-ids.env (id genere a chaque run) -- recree/retrouve ici
# a l'identique (meme email), pour tester l'isolation entre deux employes
# du meme patron sans dependre d'un run precedent.
create_or_get_user() {
  local email="$1"
  local resp
  resp=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Test-Synthetic-2026!\",\"email_confirm\":true}")
  local id
  id=$(echo "$resp" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
  if [[ -z "$id" ]]; then
    id=$(docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '$email' limit 1;" | tr -d '[:space:]')
  fi
  echo "$id"
}
EMPLOYE_A2_ID=$(create_or_get_user "employe-a2@test.seba.invalid")
psql_exec -c "insert into employe_accounts (employe_user_id, account, employe_id, email) values ('$EMPLOYE_A2_ID', 'test-patron-a', 'emp_synth_1_a2', 'employe-a2@test.seba.invalid') on conflict (employe_user_id) do nothing;"
echo "   employe A2 = $EMPLOYE_A2_ID"

TODAY="$(date +%Y-%m-%d)"
echo "== [1/2] Reamorce une mission assignee a Employe A1 (test-patron-a / emp_synth_1) =="
psql_exec <<SQL
update seba_state set state = jsonb_set(
  coalesce(state, '{}'::jsonb),
  '{interventions}',
  '[{"id":"itv_fr_1","clientId":"cli_synth_1","clientName":"Client Synthetique A1","employeId":"emp_synth_1","date":"$TODAY","time":"09:00","service":"Test mission field report","done":false}]'::jsonb
)
where account = 'test-patron-a';
SQL
echo "   OK"

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
echo "# [2/2] Assertions bloquantes"
echo "############################################################"

run_check "Employe A1 : peut soumettre un retour terrain sur SA mission, done passe a true" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select submit_my_intervention_field_report('itv_fr_1', 'completed', 'Tout s''est bien passe', 'none', null, false, null) into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : employe A1 devrait pouvoir soumettre son propre retour (' || (v_res->>'error') || ')';
  assert v_res->'intervention'->>'done' = 'true', 'ECHEC : done non mis a jour';
  assert v_res->'intervention'->'fieldReport'->>'outcome' = 'completed', 'ECHEC : outcome non enregistre';
  raise notice 'OK -- employe A1: retour terrain soumis sur sa propre mission';
end \$\$;
rollback;
"

run_check "Employe A1 : outcome arbitraire refuse cote serveur" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select submit_my_intervention_field_report('itv_fr_1', 'invente_par_le_navigateur', '', 'none', null, false, null) into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : un outcome arbitraire a ete accepte';
  raise notice 'OK -- employe A1: outcome arbitraire refuse';
end \$\$;
rollback;
"

run_check "Employe A1 : issueType arbitraire refuse cote serveur" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select submit_my_intervention_field_report('itv_fr_1', 'completed', '', 'invente', null, false, null) into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : un issueType arbitraire a ete accepte';
  raise notice 'OK -- employe A1: issueType arbitraire refuse';
end \$\$;
rollback;
"

run_check "Employe A2 : ne peut PAS soumettre un retour sur la mission de l'employe A1" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select submit_my_intervention_field_report('itv_fr_1', 'completed', 'usurpation', 'none', null, false, null) into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : employe A2 a pu soumettre un retour sur la mission de A1';
  raise notice 'OK -- employe A2: refuse sur la mission de A1';
end \$\$;
rollback;
"

run_check "Anonyme : aucune execution possible" "
begin;
set local role anon;
do \$\$
begin
  begin
    perform submit_my_intervention_field_report('itv_fr_1', 'completed', '', 'none', null, false, null);
    raise exception 'ECHEC SECURITE : un anonyme a pu executer submit_my_intervention_field_report';
  exception
    when insufficient_privilege then
      raise notice 'OK -- anonyme: EXECUTE refuse';
  end;
end \$\$;
rollback;
"

echo
echo "############################################################"
if [[ $failures -eq 0 ]]; then
  echo "# TOUT PASSE ($failures echec)"
else
  echo "# $failures ECHEC(S)"
fi
echo "############################################################"
exit $failures
