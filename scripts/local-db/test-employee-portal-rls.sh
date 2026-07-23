#!/usr/bin/env bash
# SEBA — tests d'isolation RLS pour l'accès employé à ses propres missions
# (migrations/2026-07-23-employee-portal-missions.sql :
# get_my_employee_interventions() sans argument + update_my_employee_intervention_status).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh / test-client-portal-rls.sh). Étend le jeu de données
# synthétique de seed-synthetic.sh UNIQUEMENT en mémoire de cette
# exécution (2 comptes employé supplémentaires, des interventions
# synthétiques assignées) -- ne touche pas seed-synthetic.sh lui-même.
#
# Scénario exigé : Patron A / Employé A1 / Employé A2 / Patron B /
# Employé B1. Même mécanisme que verify.sh (set local role +
# request.jwt.claims dans une transaction annulée) -- aucune donnée
# réelle, aucun compte de production.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "== [1/4] Création des 2 comptes employé supplémentaires (Employé A2, Employé B1) =="
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
EMPLOYE_A2_ID=$(create_or_get_user "employe-a2@test.seba.invalid")
EMPLOYE_B1_ID=$(create_or_get_user "employe-b1@test.seba.invalid")
echo "   employe A2 = $EMPLOYE_A2_ID"
echo "   employe B1 = $EMPLOYE_B1_ID"

echo "== [2/4] Extension du jeu de données synthétique (2e employé patron A, interventions assignées) =="
# Date du jour calculée dynamiquement -- jamais une date en dur : une
# mission assignée doit apparaitre dans le dashboard employe (zone
# prioritaire/"aujourd'hui") quel que soit le jour reel d'execution de ce
# script (meme lecon que la derive de date des baselines QA dashboard).
TODAY="$(date +%Y-%m-%d)"
# Réécrit le state complet de test-patron-a/b (service_role, contourne RLS
# volontairement pour amorcer -- même principe que seed-synthetic.sh) :
#   - patron A : Employé A1 (existant, emp_synth_1) + Employé A2 (nouveau,
#     emp_synth_1_a2), chacun avec 1 mission qui LEUR est propre
#     (employeId distinct) ;
#   - patron B : Employé B1 (nouveau, emp_synth_2), 1 mission assignée.
# Champs interventions (clientId/employeId/service/date/time/done) --
# aucun champ financier (confirmé par grep dans docs/seba-data.js:seed()).
psql_exec <<SQL
update seba_state set state = '{
  "v":1,
  "clients":[
    {"id":"cli_synth_1","nom":"Client Synthétique A1","email":"client-a@test.seba.invalid","adresse":"1 rue de Test, Nice"},
    {"id":"cli_synth_1_a2","nom":"Client Synthétique A2","email":"client-a2@test.seba.invalid","adresse":"2 rue de Test, Nice"}
  ],
  "devis":[],
  "factures":[],
  "interventions":[
    {"id":"itv_synth_1","clientId":"cli_synth_1","clientName":"Client Synthétique A1","employeId":"emp_synth_1","date":"$TODAY","time":"09:00","service":"Test mission A1","done":false},
    {"id":"itv_synth_1_a2","clientId":"cli_synth_1_a2","clientName":"Client Synthétique A2","employeId":"emp_synth_1_a2","date":"$TODAY","time":"10:00","service":"Test mission A2","done":false}
  ],
  "employes":[
    {"id":"emp_synth_1","prenom":"Employe","nom":"Synthetique A1","role":"Agent"},
    {"id":"emp_synth_1_a2","prenom":"Employe","nom":"Synthetique A2","role":"Agent"}
  ],
  "journal":[]
}'::jsonb
where account = 'test-patron-a';

update seba_state set state = '{
  "v":1,
  "clients":[{"id":"cli_synth_2","nom":"Client Synthétique B1","email":"client-b1@test.seba.invalid","adresse":"3 rue de Test, Lyon"}],
  "devis":[],
  "factures":[],
  "interventions":[
    {"id":"itv_synth_2","clientId":"cli_synth_2","clientName":"Client Synthétique B1","employeId":"emp_synth_2","date":"$TODAY","time":"11:00","service":"Test mission B1","done":false}
  ],
  "employes":[{"id":"emp_synth_2","prenom":"Employe","nom":"Synthetique B1","role":"Agent"}],
  "journal":[]
}'::jsonb
where account = 'test-patron-b';

insert into employe_accounts (employe_user_id, account, employe_id, email) values
  ('$EMPLOYE_A2_ID', 'test-patron-a', 'emp_synth_1_a2', 'employe-a2@test.seba.invalid')
on conflict (employe_user_id) do nothing;

insert into employe_accounts (employe_user_id, account, employe_id, email) values
  ('$EMPLOYE_B1_ID', 'test-patron-b', 'emp_synth_2', 'employe-b1@test.seba.invalid')
on conflict (employe_user_id) do nothing;
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

run_check "Patron A conserve tous ses accès actuels (seba_state complet, ses 2 missions), zéro accès au patron B" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_own_interv int; v_own_state int; v_other_state int;
begin
  select jsonb_array_length(state->'interventions') into v_own_interv from seba_state where account='test-patron-a';
  select count(*) into v_own_state from seba_state where account='test-patron-a';
  select count(*) into v_other_state from seba_state where account='test-patron-b';
  assert v_own_interv = 2, 'ECHEC : patron A devrait voir 2 interventions (observe ' || v_own_interv || ')';
  assert v_own_state = 1, 'ECHEC : patron A ne voit pas son propre seba_state';
  assert v_other_state = 0, 'ECHEC MULTI-TENANT : patron A voit le seba_state du patron B';
  raise notice 'OK -- patron A: acces complet a ses donnees, zero acces au patron B';
end \$\$;
rollback;
"

run_check "Employé A1 : get_my_employee_interventions() renvoie UNIQUEMENT sa propre mission (jamais celle de A2 ni de B1), enrichie de l'adresse client" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_interv jsonb;
begin
  select get_my_employee_interventions() into v_interv;
  assert jsonb_array_length(v_interv) = 1, 'ECHEC : employe A1 devrait voir exactement 1 mission (observe ' || jsonb_array_length(v_interv) || ')';
  assert v_interv->0->>'id' = 'itv_synth_1', 'ECHEC : la mission retournee n''est pas la sienne';
  assert v_interv->0->>'adresse' = '1 rue de Test, Nice', 'ECHEC : adresse client manquante ou incorrecte dans la mission enrichie';
  assert not (v_interv @> '[{\"id\":\"itv_synth_1_a2\"}]'), 'ECHEC FUITE : employe A1 voit la mission de A2';
  assert not (v_interv @> '[{\"id\":\"itv_synth_2\"}]'), 'ECHEC FUITE : employe A1 voit la mission de B1';
  raise notice 'OK -- employe A1: voit uniquement sa mission, zero fuite vers A2/B1, adresse enrichie';
end \$\$;
rollback;
"

run_check "Employé A1 : peut modifier le statut de SA mission (en_cours), le reste (client/employé assigné) est inchangé" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select update_my_employee_intervention_status('itv_synth_1', 'en_cours') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : employe A1 devrait pouvoir demarrer sa propre mission (' || (v_res->>'error') || ')';
  assert v_res->'intervention'->>'statut' = 'en_cours', 'ECHEC : statut non mis a jour';
  assert v_res->'intervention'->>'clientId' = 'cli_synth_1', 'ECHEC SECURITE : clientId modifie';
  assert v_res->'intervention'->>'employeId' = 'emp_synth_1', 'ECHEC SECURITE : employeId (assignation) modifie';
  raise notice 'OK -- employe A1: statut modifie sur sa mission, champs proteges (client/employe assigne) inchanges';
end \$\$;
rollback;
"

run_check "Employé A1 : ne peut PAS modifier une mission assignée à A2 (refus contrôlé, pas de fuite d'écriture)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select update_my_employee_intervention_status('itv_synth_1_a2', 'en_cours') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : employe A1 a pu modifier la mission de A2';
  assert v_res->>'error' = 'Mission non assignée à vous.', 'ECHEC : message d''erreur inattendu (' || (v_res->>'error') || ')';
  raise notice 'OK -- employe A1: refuse de modifier la mission de A2, message controle';
end \$\$;
rollback;
"

run_check "Employé A1 : statut interdit (arbitraire) refusé côté serveur" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select update_my_employee_intervention_status('itv_synth_1', 'annulee_par_le_navigateur') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : un statut arbitraire a ete accepte';
  assert v_res->>'error' = 'Statut non autorisé.', 'ECHEC : message d''erreur inattendu';
  raise notice 'OK -- employe A1: statut arbitraire refuse (Statut non autorise)';
end \$\$;
rollback;
"

run_check "Employé A2 : ne voit aucune mission de A1" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_interv jsonb;
begin
  select get_my_employee_interventions() into v_interv;
  assert jsonb_array_length(v_interv) = 1 and v_interv->0->>'id' = 'itv_synth_1_a2', 'ECHEC : employe A2 devrait voir exactement sa propre mission';
  assert not (v_interv @> '[{\"id\":\"itv_synth_1\"}]'), 'ECHEC FUITE : employe A2 voit la mission de A1';
  raise notice 'OK -- employe A2: zero acces aux donnees de A1';
end \$\$;
rollback;
"

run_check "Employé B1 : ne voit aucune donnée du Patron A (isolation cross-tenant)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_B1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_interv jsonb; v_state_a int;
begin
  select get_my_employee_interventions() into v_interv;
  select count(*) into v_state_a from seba_state where account = 'test-patron-a';
  assert jsonb_array_length(v_interv) = 1 and v_interv->0->>'id' = 'itv_synth_2', 'ECHEC : employe B1 devis incorrect';
  assert v_state_a = 0, 'ECHEC MULTI-TENANT : employe B1 voit le seba_state du patron A';
  raise notice 'OK -- employe B1: acces strictement limite a ses propres donnees, zero acces au patron A';
end \$\$;
rollback;
"

run_check "Anonyme : aucune RPC exécutable (EXECUTE révoqué au niveau privilège, lecture ET écriture)" "
begin;
set local role anon;
do \$\$
begin
  begin
    perform get_my_employee_interventions();
    raise exception 'ECHEC SECURITE : un anonyme a pu executer get_my_employee_interventions';
  exception
    when insufficient_privilege then
      raise notice 'OK -- anonyme: EXECUTE refuse sur get_my_employee_interventions';
  end;
  begin
    perform update_my_employee_intervention_status('itv_synth_1', 'en_cours');
    raise exception 'ECHEC SECURITE : un anonyme a pu executer update_my_employee_intervention_status';
  exception
    when insufficient_privilege then
      raise notice 'OK -- anonyme: EXECUTE refuse sur update_my_employee_intervention_status';
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
