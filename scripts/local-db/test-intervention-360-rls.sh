#!/usr/bin/env bash
# SEBA — tests d'isolation RLS pour Intervention 360
# (migrations/2026-07-25-intervention-360.sql, feature/intervention-360).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh / test-field-report-rls.sh / test-client-portal-rls.sh).
#
# Scénario : Patron A / Employé A1 (existant, EMPLOYE_A_ID) / Employé A2
# (nouveau, même patron) / Client A1 (existant, CLIENT_A_ID) / Client A2
# (nouveau, même patron) / anonyme. Utilise le même mécanisme que les
# autres harnais (set local role + request.jwt.claims dans une
# transaction annulée) -- aucune donnée réelle, aucun compte de
# production.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

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

echo "== [1/3] Comptes employé/client supplémentaires (même patron A, ré-utilisés d'autres harnais si déjà créés) =="
EMPLOYE_A2_ID=$(create_or_get_user "employe-a2@test.seba.invalid")
CLIENT_A2_ID=$(create_or_get_user "client-a2@test.seba.invalid")
psql_exec -c "insert into employe_accounts (employe_user_id, account, employe_id, email) values ('$EMPLOYE_A2_ID', 'test-patron-a', 'emp_synth_1_a2', 'employe-a2@test.seba.invalid') on conflict (employe_user_id) do nothing;"
psql_exec -c "insert into client_accounts (client_user_id, account, client_id, email) values ('$CLIENT_A2_ID', 'test-patron-a', 'cli_synth_1_a2', 'client-a2@test.seba.invalid') on conflict (client_user_id) do nothing;"
echo "   employe A2 = $EMPLOYE_A2_ID"
echo "   client A2  = $CLIENT_A2_ID"

TODAY="$(date +%Y-%m-%d)"
echo "== [2/3] Amorce une mission Intervention 360 (assignée à Employé A1 / Client A1, patron A) =="
psql_exec <<SQL
update seba_state set state = jsonb_set(
  coalesce(state, '{}'::jsonb),
  '{interventions}',
  '[{
    "id":"itv_360_1","clientId":"cli_synth_1","clientName":"Client Synthetique A1",
    "employeId":"emp_synth_1","date":"$TODAY","time":"09:00","service":"Test Intervention 360",
    "done":false,"requirePhotoBefore":true,"requirePhotoAfter":true,
    "execution":{
      "checklist":[
        {"id":"chk_1","label":"Tache obligatoire 1","required":true,"checked":false,"checkedAt":null,"checkedBy":null,"note":""},
        {"id":"chk_2","label":"Tache optionnelle","required":false,"checked":false,"checkedAt":null,"checkedBy":null,"note":""}
      ],
      "timing":{},"photos":[],"materials":[],"incidents":[],
      "clientApproval":{"status":"pending","comment":"","submittedAt":null,"submittedBy":null},
      "completionStatus":"not_started","submittedAt":null,"reviewedAt":null,"reviewedBy":null
    },
    "statusHistory":[]
  }]'::jsonb
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
echo "# [3/3] Assertions bloquantes"
echo "############################################################"

run_check "Employe A1 : voit le detail de sa mission, Employe A2 ne la voit pas" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select get_my_employee_intervention_detail('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : employe A1 devrait voir sa mission (' || (v_res->>'error') || ')';
  raise notice 'OK -- employe A1: detail visible';
end \$\$;
rollback;
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select get_my_employee_intervention_detail('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : employe A2 a pu voir la mission de A1';
  raise notice 'OK -- employe A2: aucun acces a la mission de A1';
end \$\$;
rollback;
"

run_check "Employe A2 : start/pause/resume/checklist/materiel/incident/photo/complete tous refuses sur la mission de A1" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select start_my_intervention('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu demarrer la mission de A1';
  select update_my_intervention_checklist('itv_360_1', 'chk_1', true, '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu cocher une tache de la mission de A1';
  select add_my_intervention_material('itv_360_1', 'Vis', '10', 'u', '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu ajouter un materiel sur la mission de A1';
  select submit_my_intervention_incident('itv_360_1', 'access', 'test') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu declarer un incident sur la mission de A1';
  select add_my_intervention_photo('itv_360_1', 'before', 'accounts/test-patron-a/interventions/itv_360_1/photo_x', 'image/jpeg') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu ajouter une photo sur la mission de A1';
  select complete_my_intervention('itv_360_1', '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu finaliser la mission de A1';
  raise notice 'OK -- employe A2: toutes les ecritures refusees sur la mission de A1';
end \$\$;
rollback;
"

run_check "Employe A1 : cycle complet start -> checklist bloquante -> complete refuse -> checklist complete + photos + materiel -> complete accepte" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select start_my_intervention('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : demarrage refuse (' || (v_res->>'error') || ')';
  assert v_res->'intervention'->'execution'->>'completionStatus' = 'in_progress', 'ECHEC : completionStatus non in_progress apres start';

  select complete_my_intervention('itv_360_1', '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : finalisation acceptee malgre checklist/photos manquantes';
  -- 1 blocage checklist (agrege, items[]) + 1 blocage photo avant + 1 blocage
  -- photo apres (non agreges -- meme structure exacte que
  -- computeInterventionCompletionBlockers() cote JS, docs/seba-data.js:279-289).
  assert jsonb_array_length(v_res->'blockers') = 3, 'ECHEC : devrait rapporter 3 blocages (1 checklist + 2 photo), observe ' || jsonb_array_length(v_res->'blockers');

  select update_my_intervention_checklist('itv_360_1', 'chk_1', true, 'fait') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : coche checklist refusee (' || (v_res->>'error') || ')';

  select add_my_intervention_photo('itv_360_1', 'before', 'accounts/test-patron-a/interventions/itv_360_1/photo_before', 'image/jpeg') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : ajout photo before refuse';
  select add_my_intervention_photo('itv_360_1', 'after', 'accounts/test-patron-a/interventions/itv_360_1/photo_after', 'image/jpeg') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : ajout photo after refuse';
  assert (v_res->'intervention'->'execution'->'photos'->1->>'visibleToClient')::boolean = true, 'ECHEC : photo after devrait etre visibleToClient par defaut';

  select add_my_intervention_material('itv_360_1', 'Joint', '2', 'u', '') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : ajout materiel refuse';

  select submit_my_intervention_incident('itv_360_1', 'delay', 'Retard traffic') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : declaration incident refusee';

  select complete_my_intervention('itv_360_1', 'RAS') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : finalisation refusee apres checklist+photos completes (' || (v_res->>'error') || ')';
  assert v_res->'intervention'->'execution'->>'completionStatus' = 'submitted', 'ECHEC : completionStatus non submitted apres complete';
  assert v_res->'intervention'->>'done' = 'true', 'ECHEC : done non mis a true';

  select complete_my_intervention('itv_360_1', 'rejeu') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : rejeu de complete devrait etre un no-op ok=true';
  assert (select count(*) from jsonb_array_elements(v_res->'intervention'->'statusHistory') e(v) where e.v->>'event' = 'completed') = 1, 'ECHEC IDEMPOTENCE : rejeu de complete a duplique l''evenement completed';

  select start_my_intervention('itv_360_1') into v_res;
  assert (select count(*) from jsonb_array_elements(v_res->'intervention'->'statusHistory') e(v) where e.v->>'event' = 'started') = 1, 'ECHEC IDEMPOTENCE : rejeu de start apres completion a duplique l''evenement started';

  raise notice 'OK -- employe A1: cycle complet execute et idempotent';
end \$\$;
rollback;
"

run_check "Client A1 : voit la mission (photos filtrees visibleToClient uniquement), Client A2 ne la voit pas" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select get_my_client_intervention_detail('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : client A1 devrait voir sa mission (' || (v_res->>'error') || ')';
  assert not (v_res->'intervention' ? 'checklist'), 'ECHEC FUITE : la checklist interne ne doit jamais etre exposee au client';
  assert not (v_res->'intervention' ? 'materials'), 'ECHEC FUITE : les materiaux ne doivent jamais etre exposes au client';
  assert not (v_res->'intervention'->'execution' ? 'incidents'), 'ECHEC FUITE : les incidents ne doivent jamais etre exposes au client';
  raise notice 'OK -- client A1: detail visible, structure allowlist (aucune fuite checklist/materiaux/incidents)';
end \$\$;
rollback;
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select get_my_client_intervention_detail('itv_360_1') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : client A2 a pu voir la mission de A1';
  raise notice 'OK -- client A2: aucun acces a la mission de A1';
end \$\$;
rollback;
"

run_check "Client A2 : reschedule/approve/report tous refuses sur la mission de A1" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select request_my_intervention_reschedule('itv_360_1', '$TODAY', 'test') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu demander un report sur la mission de A1';
  select approve_my_completed_intervention('itv_360_1', '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu approuver la mission de A1';
  select report_my_intervention_issue('itv_360_1', 'probleme') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : A2 a pu signaler un probleme sur la mission de A1';
  raise notice 'OK -- client A2: toutes les ecritures refusees sur la mission de A1';
end \$\$;
rollback;
"

run_check "Client A1 : ne peut pas approuver avant la fin de la mission, peut approuver une fois soumise, refus reste bloque une fois approuvee sans nouveau commentaire pertinent" "
begin;
-- Amorce completionStatus='in_progress' avec le role postgres (le role
-- authenticated est bloque en ecriture directe sur seba_state par RLS --
-- comportement normal, confirme par test-client-portal-rls.sh -- donc
-- l'amorce doit se faire HORS du role authenticated, jamais via une RPC
-- qui n'existe pas pour ce cas de test).
update seba_state set state = jsonb_set(state, '{interventions,0,execution,completionStatus}', '\"in_progress\"') where account = 'test-patron-a';
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select approve_my_completed_intervention('itv_360_1', 'trop tot') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC SECURITE : client A1 a pu approuver une mission non terminee';
  raise notice 'OK -- client A1: approbation refusee tant que la mission n''est pas soumise';
end \$\$;
rollback;
begin;
update seba_state set state = jsonb_set(state, '{interventions,0,execution,completionStatus}', '\"submitted\"') where account = 'test-patron-a';
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_res jsonb;
begin
  select approve_my_completed_intervention('itv_360_1', 'Nickel') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : approbation refusee alors que la mission est soumise (' || (v_res->>'error') || ')';
  assert v_res->'intervention'->'execution'->'clientApproval'->>'status' = 'approved', 'ECHEC : clientApproval.status non approved';

  select report_my_intervention_issue('itv_360_1', 'finalement un probleme') into v_res;
  assert (v_res->>'ok')::boolean = true, 'ECHEC : signalement refuse apres approbation (doit rester possible)';
  assert v_res->'intervention'->'execution'->'clientApproval'->>'status' = 'issue_reported', 'ECHEC : statut non repasse a issue_reported';

  select report_my_intervention_issue('itv_360_1', '') into v_res;
  assert (v_res->>'ok')::boolean = false, 'ECHEC : signalement sans commentaire devrait etre refuse';
  raise notice 'OK -- client A1: approbation acceptee une fois soumise, signalement toujours possible, commentaire obligatoire';
end \$\$;
rollback;
"

run_check "get_my_client_interventions() (RESSERRÉE) : ne fuit ni checklist/materials/incidents ni photos internes, Client A2 ne voit pas la mission de A1" "
begin;
-- Amorce 2 photos (before=interne, after=visibleToClient) avec le role
-- postgres -- chaque run_check est sa propre transaction annulee, l'etat
-- laisse par le test precedent (cycle complet employe) ne survit pas
-- jusqu'ici.
update seba_state set state = jsonb_set(
  state, '{interventions,0,execution,photos}',
  '[{\"id\":\"ph_1\",\"type\":\"before\",\"storagePath\":\"x\",\"visibleToClient\":false},{\"id\":\"ph_2\",\"type\":\"after\",\"storagePath\":\"y\",\"visibleToClient\":true}]'::jsonb
) where account = 'test-patron-a';
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_list jsonb; v_item jsonb;
begin
  select get_my_client_interventions() into v_list;
  assert jsonb_array_length(v_list) >= 1, 'ECHEC : client A1 devrait voir au moins 1 intervention dans la liste';
  select i.value into v_item from jsonb_array_elements(v_list) as i(value) where i.value->>'id' = 'itv_360_1';
  assert v_item is not null, 'ECHEC : itv_360_1 absente de la liste client A1';
  assert not (v_item ? 'checklist'), 'ECHEC FUITE : get_my_client_interventions() expose la checklist';
  assert not (v_item ? 'materials'), 'ECHEC FUITE : get_my_client_interventions() expose les materiaux';
  assert not (v_item->'execution' ? 'incidents'), 'ECHEC FUITE : get_my_client_interventions() expose les incidents';
  assert jsonb_array_length(coalesce(v_item->'execution'->'photos','[]'::jsonb)) = 1, 'ECHEC : seule la photo visibleToClient (after) devrait apparaitre, observe ' || jsonb_array_length(coalesce(v_item->'execution'->'photos','[]'::jsonb));
  raise notice 'OK -- get_my_client_interventions(): allowlist respectee, aucune fuite';
end \$\$;
rollback;
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A2_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_list jsonb;
begin
  select get_my_client_interventions() into v_list;
  assert not (v_list @> '[{\"id\":\"itv_360_1\"}]'), 'ECHEC SECURITE : client A2 voit la mission de A1 dans la liste';
  raise notice 'OK -- client A2: mission de A1 absente de sa propre liste';
end \$\$;
rollback;
"

run_check "Anonyme : EXECUTE refuse sur les 13 RPC Intervention 360" "
begin;
set local role anon;
do \$\$
declare v_fns text[] := array[
  'get_my_employee_intervention_detail','start_my_intervention','pause_my_intervention','resume_my_intervention',
  'update_my_intervention_checklist','add_my_intervention_material','submit_my_intervention_incident',
  'add_my_intervention_photo','complete_my_intervention','get_my_client_intervention_detail',
  'request_my_intervention_reschedule','approve_my_completed_intervention','report_my_intervention_issue'
];
declare v_fn text; v_denied boolean;
begin
  foreach v_fn in array v_fns loop
    v_denied := false;
    begin
      execute format('select %I(%s)', v_fn, case v_fn
        when 'update_my_intervention_checklist' then \$q\$'itv_360_1','chk_1',true,''\$q\$
        when 'add_my_intervention_material' then \$q\$'itv_360_1','x','1','u',''\$q\$
        when 'submit_my_intervention_incident' then \$q\$'itv_360_1','access',''\$q\$
        when 'add_my_intervention_photo' then \$q\$'itv_360_1','before','x','image/jpeg'\$q\$
        when 'complete_my_intervention' then \$q\$'itv_360_1',''\$q\$
        when 'request_my_intervention_reschedule' then \$q\$'itv_360_1','2026-01-01',''\$q\$
        when 'approve_my_completed_intervention' then \$q\$'itv_360_1',''\$q\$
        when 'report_my_intervention_issue' then \$q\$'itv_360_1','x'\$q\$
        else \$q\$'itv_360_1'\$q\$
      end);
    exception
      when insufficient_privilege then v_denied := true;
    end;
    assert v_denied, 'ECHEC SECURITE : anonyme a pu executer ' || v_fn;
  end loop;
  raise notice 'OK -- anonyme: EXECUTE refuse sur les 13 RPC';
end \$\$;
rollback;
"

echo
echo "############################################################"
echo "# [bonus] Stockage intervention360-photos : policies presentes et restrictives"
echo "############################################################"
run_check "Bucket intervention360-photos : prive, policies insert/select/delete pour authenticated uniquement" "
select
  case when b.public = false then 'OK bucket prive' else 'ECHEC : bucket public' end,
  count(p.polname) filter (where p.polname = 'intervention360_photos_insert') as has_insert,
  count(p.polname) filter (where p.polname = 'intervention360_photos_select') as has_select,
  count(p.polname) filter (where p.polname = 'intervention360_photos_delete') as has_delete
from storage.buckets b
left join pg_policy p on p.polrelid = 'storage.objects'::regclass and p.polname like 'intervention360_photos_%'
where b.id = 'intervention360-photos'
group by b.public;
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
