#!/usr/bin/env bash
# SEBA — tests d'isolation RLS pour invitation_log
# (migrations/2026-07-23-invitation-delivery-log.sql : statut d'envoi
# persistant des invitations client/employe, fix/invitation-delivery).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (meme contrat que
# verify.sh / test-employee-portal-rls.sh / test-client-portal-rls.sh).
# Simule les ecritures service_role (Edge Functions employe-provision.ts/
# client-provision.ts) avec des INSERT directs -- aucun vrai appel Resend,
# aucune donnee reelle.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "== [1/3] Insertion de tentatives d'invitation synthetiques (service_role, contourne RLS) =="
# Idempotent : purge les tentatives synthetiques d'un run precedent avant
# de re-inserer (id est un uuid aleatoire a chaque ligne, "on conflict"
# seul ne suffit pas a eviter les doublons si ce script est relance).
psql_exec -c "delete from invitation_log where account in ('test-patron-a', 'test-patron-b');"
psql_exec <<SQL
insert into invitation_log (account, invitation_type, target_id, recipient_email, status, resend_id, error_message)
values
  ('test-patron-a', 'employe', 'emp_synth_1', 'employe-a@test.seba.invalid', 'sent', 'resend_fake_001', null),
  ('test-patron-a', 'client', 'cli_synth_1', 'client-a@test.seba.invalid', 'failed', null, 'Domaine d''envoi non vérifié auprès de Resend (mode sandbox).'),
  ('test-patron-b', 'employe', 'emp_synth_2', 'employe-b1@test.seba.invalid', 'sent', 'resend_fake_002', null)
on conflict do nothing;
SQL
echo "   OK — 3 tentatives synthetiques inserees."

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
echo "# [2/3] Assertions bloquantes"
echo "############################################################"

run_check "Patron A voit ses 2 tentatives (employe + client), avec le bon statut/erreur, zero fuite vers Patron B" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int; v_sent_id text; v_failed_msg text; v_other_count int;
begin
  select count(*) into v_count from invitation_log where account = 'test-patron-a';
  assert v_count = 2, 'ECHEC : patron A devrait voir 2 tentatives (observe ' || v_count || ')';

  select resend_id into v_sent_id from invitation_log where account='test-patron-a' and invitation_type='employe' and status='sent';
  assert v_sent_id = 'resend_fake_001', 'ECHEC : resend_id incorrect pour la tentative employe (observe ' || coalesce(v_sent_id,'NULL') || ')';

  select error_message into v_failed_msg from invitation_log where account='test-patron-a' and invitation_type='client' and status='failed';
  assert v_failed_msg like '%non vérifié%', 'ECHEC : error_message incorrect pour la tentative client en echec';

  select count(*) into v_other_count from invitation_log where account = 'test-patron-b';
  assert v_other_count = 0, 'ECHEC MULTI-TENANT : patron A voit les tentatives du patron B';
  raise notice 'OK -- patron A: voit ses 2 tentatives (statuts/erreur corrects), zero fuite vers patron B';
end \$\$;
rollback;
"

run_check "Patron B voit uniquement sa propre tentative, zero acces au patron A" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int; v_other_count int;
begin
  select count(*) into v_count from invitation_log where account = 'test-patron-b';
  assert v_count = 1, 'ECHEC : patron B devrait voir 1 tentative (observe ' || v_count || ')';
  select count(*) into v_other_count from invitation_log where account = 'test-patron-a';
  assert v_other_count = 0, 'ECHEC MULTI-TENANT : patron B voit les tentatives du patron A';
  raise notice 'OK -- patron B: voit uniquement sa tentative, zero acces au patron A';
end \$\$;
rollback;
"

run_check "Employe A1 (compte lie, pas patron) : aucun acces a invitation_log -- aucune policy ne le couvre" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from invitation_log where account = 'test-patron-a';
  assert v_count = 0, 'ECHEC SECURITE : un compte employe voit invitation_log (reserve au patron)';
  raise notice 'OK -- employe A1: aucun acces a invitation_log (reserve au patron proprietaire)';
end \$\$;
rollback;
"

run_check "Anonyme : aucune ligne visible (RLS sans policy pour anon)" "
begin;
set local role anon;
do \$\$
declare v_count int;
begin
  select count(*) into v_count from invitation_log;
  assert v_count = 0, 'ECHEC SECURITE : un anonyme voit des lignes de invitation_log';
  raise notice 'OK -- anonyme: aucune ligne visible dans invitation_log';
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
