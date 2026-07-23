#!/usr/bin/env bash
# SEBA — tests d'isolation RLS pour l'accès client à ses propres
# devis/factures/interventions (migrations/2026-07-23-client-portal-data-rls.sql).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh). Étend le jeu de données synthétique de seed-synthetic.sh
# UNIQUEMENT en mémoire de cette exécution (2 comptes client supplémentaires,
# des devis/factures/interventions synthétiques) -- ne touche pas
# seed-synthetic.sh lui-même, dont d'autres harnais dépendent tels quels.
#
# Scénario exigé : Patron A / Client A1 / Client A2 / Patron B / Client B1 /
# anonyme. Utilise le même mécanisme que verify.sh (set local role +
# request.jwt.claims dans une transaction annulée) -- aucune donnée réelle,
# aucun compte de production.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "== [1/4] Création des 2 comptes client supplémentaires (Client A2, Client B1) =="
# Idempotent : rejouable sans reconstruire tout l'environnement local --
# si l'utilisateur existe deja (rejeu de ce script), on relit son id au
# lieu d'echouer sur un email en conflit.
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
    id=$(psql_exec -t -A -c "select id from auth.users where email = '$email' limit 1;" | tr -d '[:space:]')
  fi
  echo "$id"
}
CLIENT_A2_ID=$(create_or_get_user "client-a2@test.seba.invalid")
CLIENT_B1_ID=$(create_or_get_user "client-b1@test.seba.invalid")
echo "   client A2 = $CLIENT_A2_ID"
echo "   client B1 = $CLIENT_B1_ID"

echo "== [2/4] Extension du jeu de données synthétique (devis/factures/interventions + 2e client patron A) =="
# Réécrit le state complet de test-patron-a/b (service_role, contourne RLS
# volontairement pour amorcer -- même principe que seed-synthetic.sh) :
#   - patron A : client A1 (existant, cli_synth_1) + un 2e client A2
#     (cli_synth_1_a2, nouveau), chacun avec 1 devis + 1 facture + 1
#     intervention qui LEUR sont propres (clientId distinct) ;
#   - patron B : son client existant (cli_synth_2) reçoit 1 devis + 1
#     facture + 1 intervention, et devient "Client B1".
# Noms de champs (num/amount/status/service/done, PAS numero/montant/statut) :
# doivent correspondre exactement au schema REEL du blob JSONB tel que
# produit par seba-data.js:seed() (docs/seba-data.js ~L461-506) -- ce
# schema differe volontairement des colonnes de la table normalisee
# `devis`/`factures` du baseline (numero/montant/statut), jamais utilisee
# en pratique (voir note ARCHITECTURE, supabase-schema.sql ~L224). Un
# premier essai avec les noms de colonnes SQL a fait passer les RPC mais
# rendu les zones devis/factures vides cote portail (rendu par
# renderQuoteRow/renderInvoiceRow qui lisent d.status/d.amount/d.num) --
# corrige ici, verifie par le test e2e reel (voir livraison).
psql_exec <<SQL
update seba_state set state = '{
  "v":1,
  "clients":[
    {"id":"cli_synth_1","nom":"Client Synthétique A1","email":"client-a@test.seba.invalid"},
    {"id":"cli_synth_1_a2","nom":"Client Synthétique A2","email":"client-a2@test.seba.invalid"}
  ],
  "devis":[
    {"id":"dev_synth_1","num":"TEST-0001","clientId":"cli_synth_1","status":"attente","amount":150,"date":"2026-07-15"},
    {"id":"dev_synth_1_a2","num":"TEST-0002","clientId":"cli_synth_1_a2","status":"attente","amount":220,"date":"2026-07-16"}
  ],
  "factures":[
    {"id":"fac_synth_1","num":"TEST-F-0001","clientId":"cli_synth_1","status":"payee","amount":150,"date":"2026-07-19"},
    {"id":"fac_synth_1_a2","num":"TEST-F-0002","clientId":"cli_synth_1_a2","status":"attente","amount":220,"date":"2026-07-20"}
  ],
  "interventions":[
    {"id":"itv_synth_1","clientId":"cli_synth_1","date":"2026-07-25","time":"09:00","service":"Test A1","done":false},
    {"id":"itv_synth_1_a2","clientId":"cli_synth_1_a2","date":"2026-07-26","time":"10:00","service":"Test A2","done":false}
  ],
  "employes":[{"id":"emp_synth_1","nom":"Employé Synthétique A"}],
  "journal":[]
}'::jsonb
where account = 'test-patron-a';

update seba_state set state = '{
  "v":1,
  "clients":[{"id":"cli_synth_2","nom":"Client Synthétique B1","email":"client-b1@test.seba.invalid"}],
  "devis":[{"id":"dev_synth_2","num":"TEST-0003","clientId":"cli_synth_2","status":"attente","amount":75,"date":"2026-07-17"}],
  "factures":[{"id":"fac_synth_2","num":"TEST-F-0003","clientId":"cli_synth_2","status":"retard","amount":75,"date":"2026-07-10"}],
  "interventions":[{"id":"itv_synth_2","clientId":"cli_synth_2","date":"2026-07-27","time":"11:00","service":"Test B1","done":false}],
  "employes":[],
  "journal":[]
}'::jsonb
where account = 'test-patron-b';

insert into client_accounts (client_user_id, account, client_id, email) values
  ('$CLIENT_A2_ID', 'test-patron-a', 'cli_synth_1_a2', 'client-a2@test.seba.invalid')
on conflict (client_user_id) do nothing;

insert into client_accounts (client_user_id, account, client_id, email) values
  ('$CLIENT_B1_ID', 'test-patron-b', 'cli_synth_2', 'client-b1@test.seba.invalid')
on conflict (client_user_id) do nothing;
SQL
echo "   OK — données étendues."

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
echo "# [3/4] Assertions bloquantes"
echo "############################################################"

run_check "Patron A voit ses 2 devis/factures/interventions ET ne voit rien du patron B (via seba_state, chemin normal)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_own_devis int; v_own_state int; v_other_state int;
begin
  select jsonb_array_length(state->'devis') into v_own_devis from seba_state where account='test-patron-a';
  select count(*) into v_own_state from seba_state where account='test-patron-a';
  select count(*) into v_other_state from seba_state where account='test-patron-b';
  assert v_own_devis = 2, 'ECHEC : patron A devrait voir 2 devis (observe ' || v_own_devis || ')';
  assert v_own_state = 1, 'ECHEC : patron A ne voit pas son propre seba_state';
  assert v_other_state = 0, 'ECHEC MULTI-TENANT : patron A voit le seba_state du patron B';
  raise notice 'OK -- patron A: acces complet a ses donnees, zero acces au patron B';
end \$\$;
rollback;
"

run_check "Client A1 : get_my_client_devis/factures/interventions renvoient UNIQUEMENT ses propres lignes (jamais celles de A2 ni de B1)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_devis jsonb; v_fact jsonb; v_interv jsonb;
begin
  select get_my_client_devis() into v_devis;
  select get_my_client_factures() into v_fact;
  select get_my_client_interventions() into v_interv;
  assert jsonb_array_length(v_devis) = 1, 'ECHEC : client A1 devrait voir exactement 1 devis (observe ' || jsonb_array_length(v_devis) || ')';
  assert v_devis->0->>'id' = 'dev_synth_1', 'ECHEC : le devis retourne n''est pas le sien';
  assert jsonb_array_length(v_fact) = 1, 'ECHEC : client A1 devrait voir exactement 1 facture';
  assert v_fact->0->>'id' = 'fac_synth_1', 'ECHEC : la facture retournee n''est pas la sienne';
  assert jsonb_array_length(v_interv) = 1, 'ECHEC : client A1 devrait voir exactement 1 intervention';
  assert v_interv->0->>'id' = 'itv_synth_1', 'ECHEC : l''intervention retournee n''est pas la sienne';
  -- Aucune ligne de Client A2 (dev_synth_1_a2/fac_synth_1_a2/itv_synth_1_a2)
  -- ni de Client B1 (dev_synth_2/fac_synth_2/itv_synth_2) ne doit apparaitre.
  assert not (v_devis @> '[{\"id\":\"dev_synth_1_a2\"}]'), 'ECHEC FUITE : client A1 voit le devis de A2';
  assert not (v_devis @> '[{\"id\":\"dev_synth_2\"}]'), 'ECHEC FUITE : client A1 voit le devis de B1';
  raise notice 'OK -- client A1: voit uniquement ses 3 lignes, zero fuite vers A2/B1';
end \$\$;
rollback;
"

run_check "Client A1 ne peut ni modifier ni supprimer une ligne (RLS filtre les lignes visibles en UPDATE/DELETE -> 0 ligne affectee, jamais une erreur explicite : c'est le comportement Postgres normal d'une policy USING qui ne matche rien)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_rows int;
begin
  update seba_state set state = '{}'::jsonb where account = 'test-patron-a';
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'ECHEC SECURITE : client A1 a pu modifier ' || v_rows || ' ligne(s) de seba_state (UPDATE non bloque)';
  raise notice 'OK -- UPDATE seba_state : 0 ligne affectee pour client A1 (policy state_update reservee au patron)';

  delete from seba_state where account = 'test-patron-a';
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'ECHEC SECURITE : client A1 a pu supprimer ' || v_rows || ' ligne(s) de seba_state (DELETE non bloque)';
  raise notice 'OK -- DELETE seba_state : 0 ligne affectee pour client A1 (policy state_delete reservee au patron)';
end \$\$;
rollback;
"

run_check "Client A2 : ne voit aucune donnée de Client A1" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_devis jsonb;
begin
  select get_my_client_devis() into v_devis;
  assert jsonb_array_length(v_devis) = 1, 'ECHEC : client A2 devrait voir exactement 1 devis';
  assert v_devis->0->>'id' = 'dev_synth_1_a2', 'ECHEC : devis retourne incorrect pour A2';
  assert not (v_devis @> '[{\"id\":\"dev_synth_1\"}]'), 'ECHEC FUITE : client A2 voit le devis de A1';
  raise notice 'OK -- client A2: zero acces aux donnees de A1';
end \$\$;
rollback;
"

run_check "Client B1 : ne voit que ses propres données (isolation totale du patron A)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_B1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_devis jsonb; v_fact jsonb; v_interv jsonb; v_state_a int;
begin
  select get_my_client_devis() into v_devis;
  select get_my_client_factures() into v_fact;
  select get_my_client_interventions() into v_interv;
  select count(*) into v_state_a from seba_state where account = 'test-patron-a';
  assert jsonb_array_length(v_devis) = 1 and v_devis->0->>'id' = 'dev_synth_2', 'ECHEC : client B1 devis incorrect';
  assert jsonb_array_length(v_fact) = 1 and v_fact->0->>'id' = 'fac_synth_2', 'ECHEC : client B1 facture incorrecte';
  assert jsonb_array_length(v_interv) = 1 and v_interv->0->>'id' = 'itv_synth_2', 'ECHEC : client B1 intervention incorrecte';
  assert v_state_a = 0, 'ECHEC MULTI-TENANT : client B1 voit le seba_state du patron A';
  raise notice 'OK -- client B1: acces strictement limite a ses propres donnees';
end \$\$;
rollback;
"

run_check "Anonyme : aucune donnée via seba_state, et EXECUTE sur les 3 RPC refusé au niveau privilège (REVOKE anon explicite -- plus strict qu'un simple tableau vide : l'appel n'atteint meme pas le corps de la fonction)" "
begin;
set local role anon;
do \$\$
declare v_state int;
begin
  select count(*) into v_state from seba_state;
  assert v_state = 0, 'ECHEC SECURITE : un anonyme voit des lignes de seba_state';
  raise notice 'OK -- anonyme: zero ligne seba_state visible';
end \$\$;
rollback;
begin;
set local role anon;
do \$\$
begin
  begin
    perform get_my_client_devis();
    raise exception 'ECHEC SECURITE : un anonyme a pu executer get_my_client_devis (EXECUTE non revoque)';
  exception
    when insufficient_privilege then
      raise notice 'OK -- anonyme: EXECUTE refuse sur get_my_client_devis (revoke anon applique)';
  end;
end \$\$;
rollback;
"

run_check "Contournement direct : une requête brute sur les tables normalisées devis/factures/interventions (hors seba_state) reste bloquée pour un client, sans régression pour le patron" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from devis;
  assert v_count = 0, 'ECHEC : client A1 voit des lignes dans la table devis normalisee (devrait etre 0, policy patron-only inchangee)';
  select count(*) into v_count from factures;
  assert v_count = 0, 'ECHEC : client A1 voit des lignes dans la table factures normalisee';
  select count(*) into v_count from interventions;
  assert v_count = 0, 'ECHEC : client A1 voit des lignes dans la table interventions normalisee';
  raise notice 'OK -- tables normalisees devis/factures/interventions: toujours patron-only, aucune regression';
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
