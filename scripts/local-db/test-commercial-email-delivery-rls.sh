#!/usr/bin/env bash
# SEBA — tests RLS pour commercial_email_deliveries
# (migrations/2026-07-28-commercial-email-delivery.sql, feature/customer-
# email-delivery PHASE 1).
#
# Ne modifie ni ne corrige rien : rapporte uniquement (même contrat que
# test-client-portal-rls.sh/verify.sh). Réutilise les comptes synthétiques
# déjà en place (.synthetic-ids.env, seed-synthetic.sh) -- n'en crée aucun
# nouveau. Même mécanisme que les autres tests RLS : set local role +
# request.jwt.claims dans une transaction annulée, aucune donnée réelle.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "== [1/3] Deux lignes d'historique de test (service_role, contourne RLS pour amorcer) =="
psql_exec <<SQL
delete from commercial_email_deliveries where account in ('test-patron-a','test-patron-b') and idempotency_key like 'qa-cediv-%';
insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_synth_a', 'client-a@test.seba.invalid', 'Votre devis', 'sent', 'qa-cediv-a-1');
insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
values ('test-patron-b', '$PATRON_B_ID', 'cli_synth_2', 'invoice', 'fac_synth_b', 'client-b@test.seba.invalid', 'Votre facture', 'sent', 'qa-cediv-b-1');
SQL
echo "   OK — 2 lignes créées."

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
echo "# [2/3] Assertions bloquantes (RLS)"
echo "############################################################"

run_check "Patron A lit son propre historique et RIEN du patron B" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_own int; v_other int;
begin
  select count(*) into v_own from commercial_email_deliveries where account = 'test-patron-a';
  select count(*) into v_other from commercial_email_deliveries where account = 'test-patron-b';
  assert v_own = 1, 'ECHEC : patron A devrait voir 1 ligne (observe ' || v_own || ')';
  assert v_other = 0, 'ECHEC MULTI-TENANT : patron A voit une ligne du patron B';
  raise notice 'OK -- patron A: 1 ligne propre, 0 du patron B';
end \$\$;
rollback;
"

run_check "Patron B lit son propre historique et RIEN du patron A" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_B_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_own int; v_other int;
begin
  select count(*) into v_own from commercial_email_deliveries where account = 'test-patron-b';
  select count(*) into v_other from commercial_email_deliveries where account = 'test-patron-a';
  assert v_own = 1, 'ECHEC : patron B devrait voir 1 ligne (observe ' || v_own || ')';
  assert v_other = 0, 'ECHEC MULTI-TENANT : patron B voit une ligne du patron A';
  raise notice 'OK -- patron B: 1 ligne propre, 0 du patron A';
end \$\$;
rollback;
"

run_check "Client authentifié (Client A1) ne lit RIEN de la table" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$CLIENT_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from commercial_email_deliveries;
  assert v_count = 0, 'ECHEC SECURITE : un client authentifié voit ' || v_count || ' ligne(s) de commercial_email_deliveries';
  raise notice 'OK -- client authentifié : 0 ligne visible';
end \$\$;
rollback;
"

run_check "Employé authentifié ne lit RIEN de la table" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$EMPLOYE_A_ID\",\"role\":\"authenticated\"}';
do \$\$
declare v_count int;
begin
  select count(*) into v_count from commercial_email_deliveries;
  assert v_count = 0, 'ECHEC SECURITE : un employé authentifié voit ' || v_count || ' ligne(s) de commercial_email_deliveries';
  raise notice 'OK -- employé authentifié : 0 ligne visible';
end \$\$;
rollback;
"

run_check "Visiteur anonyme ne lit RIEN de la table (GRANT absent -> permission denied, garantie plus forte qu'un filtrage RLS)" "
begin;
set local role anon;
do \$\$
declare v_count int;
begin
  begin
    select count(*) into v_count from commercial_email_deliveries;
    raise exception 'ECHEC SECURITE : anon voit % ligne(s) de commercial_email_deliveries', v_count;
  exception when insufficient_privilege then
    raise notice 'OK -- anon : accès table refusé (insufficient_privilege)';
  end;
end \$\$;
rollback;
"

run_check "Insertion directe authenticated refusée (RLS/GRANT)" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_x', 'x@test.seba.invalid', 'x', 'sent', 'qa-cediv-illegal-insert');
    raise exception 'ECHEC SECURITE : insertion directe authenticated a reussi';
  exception when insufficient_privilege then
    raise notice 'OK -- insertion directe authenticated refusee (insufficient_privilege)';
  end;
end \$\$;
rollback;
"

run_check "Mise à jour directe authenticated refusée" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
begin
  begin
    update commercial_email_deliveries set status = 'delivered' where account = 'test-patron-a';
    raise exception 'ECHEC SECURITE : mise a jour directe authenticated a reussi';
  exception when insufficient_privilege then
    raise notice 'OK -- mise a jour directe authenticated refusee (insufficient_privilege)';
  end;
end \$\$;
rollback;
"

run_check "Suppression directe authenticated refusée" "
begin;
set local role authenticated;
set local \"request.jwt.claims\" to '{\"sub\":\"$PATRON_A_ID\",\"role\":\"authenticated\"}';
do \$\$
begin
  begin
    delete from commercial_email_deliveries where account = 'test-patron-a';
    raise exception 'ECHEC SECURITE : suppression directe authenticated a reussi';
  exception when insufficient_privilege then
    raise notice 'OK -- suppression directe authenticated refusee (insufficient_privilege)';
  end;
end \$\$;
rollback;
"

echo
echo "############################################################"
echo "# [3/3] Assertions bloquantes (contraintes de table)"
echo "############################################################"

run_check "Contrainte unique(account, idempotency_key) appliquée" "
begin;
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_synth_a', 'client-a@test.seba.invalid', 'Votre devis', 'sent', 'qa-cediv-a-1');
    raise exception 'ECHEC : doublon (account, idempotency_key) accepte';
  exception when unique_violation then
    raise notice 'OK -- contrainte unique(account, idempotency_key) appliquee';
  end;
end \$\$;
rollback;
"

run_check "document_type invalide refusé" "
begin;
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'bogus', 'dev_x', 'x@test.seba.invalid', 'x', 'sent', 'qa-cediv-bad-doctype');
    raise exception 'ECHEC : document_type invalide accepte';
  exception when check_violation then
    raise notice 'OK -- document_type invalide refuse (check_violation)';
  end;
end \$\$;
rollback;
"

run_check "status invalide refusé" "
begin;
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_x', 'x@test.seba.invalid', 'x', 'bogus', 'qa-cediv-bad-status');
    raise exception 'ECHEC : status invalide accepte';
  exception when check_violation then
    raise notice 'OK -- status invalide refuse (check_violation)';
  end;
end \$\$;
rollback;
"

run_check "recipient vide refusé" "
begin;
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_x', '   ', 'x', 'sent', 'qa-cediv-empty-recipient');
    raise exception 'ECHEC : recipient vide accepte';
  exception when check_violation then
    raise notice 'OK -- recipient vide refuse (check_violation)';
  end;
end \$\$;
rollback;
"

run_check "subject vide refusé" "
begin;
do \$\$
begin
  begin
    insert into commercial_email_deliveries (account, user_id, client_id, document_type, document_id, recipient, subject, status, idempotency_key)
    values ('test-patron-a', '$PATRON_A_ID', 'cli_synth_1', 'quote', 'dev_x', 'x@test.seba.invalid', '   ', 'sent', 'qa-cediv-empty-subject');
    raise exception 'ECHEC : subject vide accepte';
  exception when check_violation then
    raise notice 'OK -- subject vide refuse (check_violation)';
  end;
end \$\$;
rollback;
"

echo
echo "== Nettoyage des lignes de test =="
psql_exec <<SQL
delete from commercial_email_deliveries where account in ('test-patron-a','test-patron-b') and idempotency_key like 'qa-cediv-%';
SQL
echo "   OK — nettoyé."

echo
if [[ $failures -eq 0 ]]; then
  echo "TOUT PASSE (RLS commercial_email_deliveries)"
  exit 0
else
  echo "$failures ECHEC(S)"
  exit 1
fi
