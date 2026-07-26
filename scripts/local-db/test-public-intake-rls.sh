#!/usr/bin/env bash
# SEBA — tests RLS pour la migration 2026-07-26-public-intake.sql
# (table public_service_requests + RPC convert_public_service_request /
# link_public_service_request_conversion).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh / test-team-availability-rls.sh). Comptes/état synthétiques
# entièrement autonomes, jamais de donnée réelle.
#
# Scénario : Patron A / Patron B -- isolation cross-account de la table
# (select/update), rejet anonyme (table ET RPC), résolution/création client
# (nouveau + réutilisation d'un client existant par email normalisé),
# idempotence de conversion (pas de doublon client sur retry), refus sur
# demande rejected/archived, verrouillage cross-account des 2 RPC,
# set-once de link_public_service_request_conversion.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== [1/3] Comptes synthétiques RLSPI =="
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
PATRON_A_ID=$(create_or_get_user "rlspi-patron-a@test.seba.invalid")
PATRON_B_ID=$(create_or_get_user "rlspi-patron-b@test.seba.invalid")
echo "   patron A=$PATRON_A_ID  patron B=$PATRON_B_ID"

echo "== [2/3] État seba_state + demandes publiques synthétiques (idempotent) =="
psql_exec <<SQL
insert into seba_state (account, user_id, state) values (
  '$PATRON_A_ID', '$PATRON_A_ID',
  '{"v":1,"clients":[{"id":"cli_rlspi_existing","prenom":"Existant","nom":"RLSPI","email":"existant@rlspi.invalid","contact":"existant@rlspi.invalid"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[{"id":"svc_rlspi","name":"Ménage RLSPI","pricingModel":"fixed","suggestedPrice":50,"active":true}],"contrats":[],"messages":[],"clientRequests":[],"publicIntakeConfig":{"enabled":true,"allowedServiceIds":[]},"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
insert into seba_state (account, user_id, state) values (
  '$PATRON_B_ID', '$PATRON_B_ID',
  '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

delete from public_service_requests where account in ('$PATRON_A_ID','$PATRON_B_ID');
insert into public_service_requests (id, account, user_id, public_reference, tracking_token_hash, status, contact_name, email, service_id, service_label)
values
  ('11111111-1111-1111-1111-111111111111', '$PATRON_A_ID', '$PATRON_A_ID', 'RLSPI-REQ-NEW', 'x', 'new', 'Nouveau Prospect', 'nouveau@rlspi.invalid', 'svc_rlspi', 'Ménage RLSPI'),
  ('22222222-2222-2222-2222-222222222222', '$PATRON_A_ID', '$PATRON_A_ID', 'RLSPI-REQ-EXIST', 'x', 'new', 'Client Existant', 'existant@rlspi.invalid', 'svc_rlspi', 'Ménage RLSPI'),
  ('33333333-3333-3333-3333-333333333333', '$PATRON_A_ID', '$PATRON_A_ID', 'RLSPI-REQ-REJECTED', 'x', 'rejected', 'Rejeté', 'rejete@rlspi.invalid', null, null),
  ('44444444-4444-4444-4444-444444444444', '$PATRON_B_ID', '$PATRON_B_ID', 'RLSPI-REQ-B', 'x', 'new', 'Demande B', 'b@rlspi.invalid', null, null);
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

run_check "anon ne peut ni lire ni insérer dans public_service_requests" "
begin;
set local role anon;
do \$\$
declare v_count int; v_err boolean := false;
begin
  select count(*) into v_count from public_service_requests;
  assert v_count = 0, 'ECHEC SECURITE : anon voit ' || v_count || ' ligne(s) (RLS select devrait tout bloquer)';
  begin
    insert into public_service_requests (account, user_id, public_reference, tracking_token_hash, status, contact_name)
    values ('$PATRON_A_ID', '$PATRON_A_ID', 'RLSPI-ANON-INSERT', 'x', 'new', 'Injection anon');
    v_err := false;
  exception when insufficient_privilege then v_err := true;
  end;
  assert v_err, 'ECHEC SECURITE : anon a pu insérer dans public_service_requests';
  raise notice 'OK -- anon bloqué en lecture ET en écriture';
end \$\$;
rollback;
"

run_check "Patron A voit ses demandes, Patron B ne les voit pas (RLS select cross-account)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from public_service_requests where account = '$PATRON_A_ID';
  assert v_count = 3, 'ECHEC : patron A devrait voir 3 demandes, en voit ' || v_count;
end \$\$;
select set_config('request.jwt.claims', '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}', true);
do \$\$
declare v_count int;
begin
  select count(*) into v_count from public_service_requests where account = '$PATRON_A_ID';
  assert v_count = 0, 'ECHEC SECURITE : patron B voit ' || v_count || ' demande(s) du patron A';
  raise notice 'OK -- isolation cross-account confirmée (select)';
end \$\$;
rollback;
"

run_check "Patron A peut modifier sa demande, Patron B ne peut pas (RLS update cross-account)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
update public_service_requests set status = 'contacted' where id = '11111111-1111-1111-1111-111111111111';
do \$\$
declare v_status text;
begin
  perform set_config('request.jwt.claims', '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}', true);
  select status into v_status from public_service_requests where id = '11111111-1111-1111-1111-111111111111';
  assert v_status = 'new', 'ECHEC SECURITE : patron B a pu modifier une demande du patron A (status=' || v_status || ')';
  raise notice 'OK -- patron B ne peut pas modifier une demande du patron A (0 ligne affectée)';
end \$\$;
rollback;
"

run_check "anon rejeté par les 2 RPC" "
begin;
set local role anon;
do \$\$
declare v_err boolean := false;
begin
  begin
    perform convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client');
  exception when insufficient_privilege then v_err := true;
  end;
  assert v_err, 'ECHEC SECURITE : convert_public_service_request accessible en anon';
  v_err := false;
  begin
    perform link_public_service_request_conversion('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'q1', null);
  exception when insufficient_privilege then v_err := true;
  end;
  assert v_err, 'ECHEC SECURITE : link_public_service_request_conversion accessible en anon';
  raise notice 'OK -- les 2 RPC rejettent le rôle anon';
end \$\$;
rollback;
"

run_check "Patron B ne peut pas convertir une demande du patron A (ownership)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client') into v_res;
  assert (v_res->>'ok') = 'false', 'ECHEC SECURITE : patron B a pu convertir une demande du patron A';
  raise notice 'OK -- conversion cross-account refusée';
end \$\$;
rollback;
"

run_check "Conversion crée un NOUVEAU client (aucun email existant), demande marquée converted" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb; v_client_count_before int; v_client_count_after int;
begin
  select jsonb_array_length(state->'clients') into v_client_count_before from seba_state where account = '$PATRON_A_ID';
  select convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client') into v_res;
  assert (v_res->>'ok')::boolean, 'ECHEC : conversion refusée (' || (v_res->>'error') || ')';
  assert (v_res->>'clientId') is not null, 'ECHEC : aucun clientId renvoyé';
  select jsonb_array_length(state->'clients') into v_client_count_after from seba_state where account = '$PATRON_A_ID';
  assert v_client_count_after = v_client_count_before + 1, 'ECHEC : le client n''a pas été créé (avant=' || v_client_count_before || ' après=' || v_client_count_after || ')';
  assert (select status from public_service_requests where id = '11111111-1111-1111-1111-111111111111') = 'converted', 'ECHEC : statut non passé à converted';
  raise notice 'OK -- nouveau client créé, demande convertie';
end \$\$;
rollback;
"

run_check "Retry (rejeu) sur une demande déjà convertie : aucun doublon client, même clientId renvoyé" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res1 jsonb; v_res2 jsonb; v_client_count_before int; v_client_count_after int;
begin
  select jsonb_array_length(state->'clients') into v_client_count_before from seba_state where account = '$PATRON_A_ID';
  select convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client') into v_res1;
  select convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client') into v_res2;
  assert (v_res2->>'alreadyConverted')::boolean, 'ECHEC : 2e appel devrait signaler alreadyConverted=true';
  assert (v_res1->>'clientId') = (v_res2->>'clientId'), 'ECHEC : clientId différent entre les 2 appels';
  select jsonb_array_length(state->'clients') into v_client_count_after from seba_state where account = '$PATRON_A_ID';
  assert v_client_count_after = v_client_count_before + 1, 'ECHEC SECURITE : doublon client créé sur retry (avant=' || v_client_count_before || ' après=' || v_client_count_after || ')';
  raise notice 'OK -- retry idempotent confirmé, aucun doublon client';
end \$\$;
rollback;
"

run_check "Résolution d'un client EXISTANT par email normalisé (aucun nouveau client créé)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb; v_client_count_before int; v_client_count_after int;
begin
  select jsonb_array_length(state->'clients') into v_client_count_before from seba_state where account = '$PATRON_A_ID';
  select convert_public_service_request('$PATRON_A_ID', '22222222-2222-2222-2222-222222222222', 'client') into v_res;
  assert (v_res->>'ok')::boolean, 'ECHEC : conversion refusée (' || (v_res->>'error') || ')';
  assert (v_res->>'clientId') = 'cli_rlspi_existing', 'ECHEC : client existant non réutilisé (clientId=' || (v_res->>'clientId') || ')';
  select jsonb_array_length(state->'clients') into v_client_count_after from seba_state where account = '$PATRON_A_ID';
  assert v_client_count_after = v_client_count_before, 'ECHEC : un nouveau client a été créé alors qu''un client existant matchait (avant=' || v_client_count_before || ' après=' || v_client_count_after || ')';
  raise notice 'OK -- client existant réutilisé, aucun doublon';
end \$\$;
rollback;
"

run_check "Conversion refusée sur une demande rejected" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select convert_public_service_request('$PATRON_A_ID', '33333333-3333-3333-3333-333333333333', 'client') into v_res;
  assert (v_res->>'ok') = 'false', 'ECHEC SECURITE : conversion d''une demande rejected acceptée';
  raise notice 'OK -- conversion refusée sur demande rejected';
end \$\$;
rollback;
"

run_check "link_public_service_request_conversion refusé avant conversion, set-once après" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb; v_quote_id text;
begin
  select link_public_service_request_conversion('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'quote_early', null) into v_res;
  assert (v_res->>'ok') = 'false', 'ECHEC : link accepté avant toute conversion';

  perform convert_public_service_request('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'client_quote');
  perform link_public_service_request_conversion('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'quote_first', null);
  perform link_public_service_request_conversion('$PATRON_A_ID', '11111111-1111-1111-1111-111111111111', 'quote_second', null);
  select converted_quote_id into v_quote_id from public_service_requests where id = '11111111-1111-1111-1111-111111111111';
  assert v_quote_id = 'quote_first', 'ECHEC : converted_quote_id a été écrasé par un 2e appel (set-once attendu), vaut ' || v_quote_id;
  raise notice 'OK -- link refusé avant conversion, set-once confirmé après';
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
