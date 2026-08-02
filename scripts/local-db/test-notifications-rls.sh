#!/usr/bin/env bash
# SEBA — tests RLS/RPC pour la migration
# 2026-08-02-portal-notifications-foundation.sql (Lot 1 du programme
# d'amélioration des portails Client/Salarié).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# verify.sh / test-team-availability-rls.sh). Comptes/état synthétiques
# entièrement autonomes, jamais de donnée réelle.
#
# Scénario : Patron A/B, Client A1/A2 (patron A), Employé A1 (patron A) --
# aucun accès anonyme, aucune fuite cross-account, dédoublonnage,
# déclenchement réel via client_accept_devis/client_refuse_devis/
# complete_my_intervention/message.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== [1/3] Comptes synthétiques RLSNOTIF =="
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
PATRON_A_ID=$(create_or_get_user "rlsnotif-patron-a@test.seba.invalid")
PATRON_B_ID=$(create_or_get_user "rlsnotif-patron-b@test.seba.invalid")
CLIENT_A1_ID=$(create_or_get_user "rlsnotif-cli-a1@test.seba.invalid")
CLIENT_B1_ID=$(create_or_get_user "rlsnotif-cli-b1@test.seba.invalid")
EMPLOYE_A1_ID=$(create_or_get_user "rlsnotif-emp-a1@test.seba.invalid")
echo "   patron A=$PATRON_A_ID B=$PATRON_B_ID  client A1=$CLIENT_A1_ID B1=$CLIENT_B1_ID  employe A1=$EMPLOYE_A1_ID"

echo "== [2/3] État seba_state + rattachements + devis/intervention de test (idempotent) =="
psql_exec <<SQL
insert into seba_state (account, user_id, state) values (
  '$PATRON_A_ID', '$PATRON_A_ID',
  '{"v":1,"clients":[{"id":"cli_rlsnotif_a1","nom":"Client RLSNOTIF A1","prenom":"","email":"rlsnotif-cli-a1@test.seba.invalid","adresse":"1 rue test"}],
   "devis":[{"id":"devis_rlsnotif_1","clientId":"cli_rlsnotif_a1","status":"attente","lignes":[],"totalTTC":100,"statusHistory":[]}],
   "factures":[],
   "interventions":[{"id":"interv_rlsnotif_1","clientId":"cli_rlsnotif_a1","employeId":"emp_rlsnotif_a1","service":"Test","execution":{"checklist":[],"photos":[],"materials":[],"incidents":[],"completionStatus":"in_progress"},"requirePhotoBefore":false,"requirePhotoAfter":false,"statusHistory":[]}],
   "employes":[{"id":"emp_rlsnotif_a1","prenom":"Employe","nom":"RLSNOTIF A1","actif":true}],
   "journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
insert into seba_state (account, user_id, state) values (
  '$PATRON_B_ID', '$PATRON_B_ID',
  '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
delete from client_accounts where client_user_id in ('$CLIENT_A1_ID','$CLIENT_B1_ID');
insert into client_accounts (client_user_id, account, client_id, email) values
  ('$CLIENT_A1_ID', '$PATRON_A_ID', 'cli_rlsnotif_a1', 'rlsnotif-cli-a1@test.seba.invalid'),
  ('$CLIENT_B1_ID', '$PATRON_B_ID', 'cli_rlsnotif_b1', 'rlsnotif-cli-b1@test.seba.invalid');
delete from employe_accounts where employe_user_id in ('$EMPLOYE_A1_ID');
insert into employe_accounts (employe_user_id, account, employe_id, email) values
  ('$EMPLOYE_A1_ID', '$PATRON_A_ID', 'emp_rlsnotif_a1', 'rlsnotif-emp-a1@test.seba.invalid');
delete from notifications where account in ('$PATRON_A_ID', '$PATRON_B_ID');
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

run_check "Anonyme : aucune des 5 RPC exécutable, aucune ligne notifications lisible" "
begin;
set local role anon;
select count(*) as should_be_zero from notifications;
do \$\$
declare v_err boolean;
begin
  v_err := false; begin perform get_my_notifications(50, false); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : get_my_notifications accessible en anon';
  v_err := false; begin perform get_my_unread_notification_count(); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : get_my_unread_notification_count accessible en anon';
  v_err := false; begin perform mark_notification_read(gen_random_uuid()); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : mark_notification_read accessible en anon';
  v_err := false; begin perform mark_all_notifications_read(); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : mark_all_notifications_read accessible en anon';
  v_err := false; begin perform create_notification('x', gen_random_uuid(), 'patron', 'x', 'x'); exception when insufficient_privilege then v_err := true; end;
  assert v_err, 'ECHEC SECURITE : create_notification (interne) accessible en anon';
  raise notice 'OK -- anonyme: 5/5 RPC refusees';
end \$\$;
rollback;
"

run_check "Authenticated (client A1) : aucun accès direct à la table notifications hors RPC (aucune policy)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from notifications;
  assert v_count = 0, 'ECHEC SECURITE : lecture directe de la table notifications possible hors RPC (' || v_count || ' lignes)';
  raise notice 'OK -- aucune policy SELECT directe, 0 ligne visible hors RPC';
end \$\$;
rollback;
"

run_check "client_accept_devis déclenche une notification réelle au patron A, lisible via get_my_notifications" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
select client_accept_devis('devis_rlsnotif_1');
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int; v_unread int;
begin
  select count(*) into v_count from get_my_notifications(50, false) where event_type = 'devis.client_accepted';
  assert v_count = 1, 'ECHEC : notification devis.client_accepted absente ou dupliquee (compte=' || v_count || ')';
  select get_my_unread_notification_count() into v_unread;
  assert v_unread >= 1, 'ECHEC : compteur non lu incorrect (' || v_unread || ')';
  raise notice 'OK -- notification reelle creee et lisible par le patron A (non-lu=%)', v_unread;
end \$\$;
rollback;
"

run_check "Rejeu de client_accept_devis (déjà 'signe' après un premier appel réel) ne crée pas une 2e notification" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
select client_accept_devis('devis_rlsnotif_1');
select client_accept_devis('devis_rlsnotif_1');
select client_accept_devis('devis_rlsnotif_1');
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from get_my_notifications(50, false) where event_type = 'devis.client_accepted';
  assert v_count = 1, 'ECHEC DEDUP : ' || v_count || ' notifications pour 3 appels (attendu 1, la 1ere ecriture reelle + 2 rejeux idempotents cote metier)';
  raise notice 'OK -- dedup confirmee (3 appels, 1 seule notification)';
end \$\$;
rollback;
"

run_check "Patron B ne voit jamais les notifications du patron A (isolation cross-tenant)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
select client_accept_devis('devis_rlsnotif_1');
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from get_my_notifications(50, false);
  assert v_count = 0, 'ECHEC SECURITE : patron B voit ' || v_count || ' notification(s) qui ne lui appartiennent pas';
  raise notice 'OK -- patron B: 0 notification visible';
end \$\$;
rollback;
"

run_check "complete_my_intervention déclenche une notification réelle au patron A" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A1_ID\",\"role\":\"authenticated\"}';
select complete_my_intervention('interv_rlsnotif_1', 'OK');
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from get_my_notifications(50, false) where event_type = 'mission.completed';
  assert v_count = 1, 'ECHEC : notification mission.completed absente (' || v_count || ')';
  raise notice 'OK -- notification mission.completed creee et lisible par le patron A';
end \$\$;
rollback;
"

run_check "mark_notification_read : un utilisateur ne peut marquer que SES PROPRES notifications" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
select client_accept_devis('devis_rlsnotif_1');
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
select set_config('rlsnotif.notif_id', (select id::text from get_my_notifications(50, false) where event_type = 'devis.client_accepted' limit 1), false);
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
select mark_notification_read(current_setting('rlsnotif.notif_id')::uuid);
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_notif_id uuid := current_setting('rlsnotif.notif_id')::uuid;
begin
  assert exists(select 1 from get_my_notifications(50,false) where id = v_notif_id and read_at is null), 'ECHEC SECURITE : patron B a pu marquer lue une notification du patron A';
  perform mark_notification_read(v_notif_id);
  assert exists(select 1 from get_my_notifications(50,false) where id = v_notif_id and read_at is not null), 'ECHEC : le proprietaire n a pas pu marquer sa propre notification comme lue';
  raise notice 'OK -- mark_notification_read: refuse pour un autre compte, fonctionne pour le proprietaire';
end \$\$;
rollback;
"

run_check "Nouveau message (trigger) : notifie le destinataire réel, jamais l'auteur lui-même, jamais un autre compte" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
insert into seba_messages (account, user_id, client_id, expediteur_role, destinataire_role, texte)
values ('$PATRON_A_ID', '$PATRON_A_ID', 'cli_rlsnotif_a1', 'patron', 'client', 'RLSNOTIF-MSG-1');
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A1_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count_client int;
begin
  select count(*) into v_count_client from get_my_notifications(50, false) where event_type = 'message.new';
  assert v_count_client = 1, 'ECHEC : le destinataire reel (client A1) n a pas ete notifie (' || v_count_client || ')';
  raise notice 'OK -- trigger message.new: destinataire reel notifie';
end \$\$;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count_patron int;
begin
  select count(*) into v_count_patron from get_my_notifications(50, false) where event_type = 'message.new';
  assert v_count_patron = 0, 'ECHEC : l auteur du message a ete notifie de son propre message (' || v_count_patron || ')';
  raise notice 'OK -- trigger message.new: auteur jamais notifie de son propre message';
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
