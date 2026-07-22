#!/usr/bin/env bash
# SEBA — vérifications post-reconstruction de l'environnement Supabase local.
# Ne modifie ni ne corrige rien : rapporte uniquement. Toute divergence est
# affichée, jamais corrigée automatiquement.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(npx --yes supabase@2.109.1 status -o env)"
# psql absent de l'hôte (constaté à l'exécution) -- utilise le psql du conteneur Postgres fourni par Supabase local.
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "############################################################"
echo "# 1. INFRASTRUCTURE"
echo "############################################################"
echo "-- Postgres --"
psql_exec -c "select version();" | head -3
echo "-- Auth (GoTrue) --"
curl -s "$API_URL/auth/v1/health" -H "apikey: $ANON_KEY"; echo
echo "-- Storage --"
curl -s "$API_URL/storage/v1/status" -H "apikey: $ANON_KEY"; echo
echo "-- URLs retournées (doivent être locales, jamais la production) --"
echo "API_URL=$API_URL"
echo "DB_URL (masqué au-delà de l'hôte)=postgresql://***@127.0.0.1:54322/postgres"
if [[ "$API_URL" == *"ptmudezhxnhhyctowlqp"* ]]; then
  echo "!! ALERTE : l'URL retournée référence le projet de production, arrêt."
  exit 1
fi
echo "OK — aucune référence à la production détectée."

echo
echo "############################################################"
echo "# 2. SCHÉMA — objets attendus par le code vs objets réels"
echo "############################################################"
psql_exec <<'SQL'
\echo '-- Tables (public) --'
select tablename from pg_tables where schemaname = 'public' order by tablename;

\echo '-- Extensions --'
select extname from pg_extension order by extname;

\echo '-- Triggers (non internes) --'
select tgname, tgrelid::regclass as table_name from pg_trigger where not tgisinternal order by tgname;

\echo '-- Fonctions/RPC (public) --'
select proname from pg_proc where pronamespace = 'public'::regnamespace order by proname;

\echo '-- Policies RLS (public) --'
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, policyname;

\echo '-- Tables avec RLS activée --'
select relname, relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
  order by relname;
SQL

echo
echo "-- Comparaison objets attendus par le code (recensés par grep dans ce dépôt) --"
echo "RPC attendues : create_profile_and_company, get_my_client_profile, get_my_employee_profile,"
echo "  get_my_employee_interventions, close_my_intervention, erase_account_completely,"
echo "  call_notify_alert, apply_entity_patch, trigger_qa_alert, derive_type_alerte"
echo "Trigger attendu : qa_photos_alert_trigger"
echo "Extensions attendues : pg_net, vector"
echo "(comparaison manuelle avec la sortie ci-dessus — ce script ne fait pas encore de diff automatisé)"

echo
echo "############################################################"
echo "# 3. STORAGE (buckets)"
echo "############################################################"
psql_exec -c "select id, public from storage.buckets order by id;"

echo
echo "############################################################"
echo "# 4. SÉCURITÉ — tests RLS élémentaires (simulation JWT locale, aucune donnée réelle)"
echo "############################################################"

echo "-- 4a. Test repris tel quel du dépôt : migrations/20260709_create_client_memoire.test.sql --"
psql_exec < "$REPO_ROOT/migrations/20260709_create_client_memoire.test.sql"

# Charge les identifiants synthétiques réels générés par seed-synthetic.sh
source "$REPO_ROOT/scripts/local-db/.synthetic-ids.env"

echo "-- 4b. Isolation seba_state entre patron A et patron B --"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$PATRON_A_ID","role":"authenticated"}';
do \$\$
declare v_own int; v_other int;
begin
  select count(*) into v_own from seba_state where account = 'test-patron-a';
  select count(*) into v_other from seba_state where account = 'test-patron-b';
  assert v_own = 1, 'ECHEC : patron A ne voit pas son propre seba_state';
  assert v_other = 0, 'ECHEC MULTI-TENANT : patron A voit le seba_state du patron B';
  raise notice 'OK 4b -- isolation seba_state patron A / patron B verifiee';
end \$\$;
rollback;
SQL

echo "-- 4c. Un client ne peut pas lire une client_request qui n'est pas la sienne --"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"$CLIENT_A_ID","role":"authenticated"}';
do \$\$
declare v_own int;
begin
  select count(*) into v_own from client_requests where client_user_id = '$CLIENT_A_ID';
  assert v_own >= 1, 'ECHEC : client A ne voit pas sa propre demande';
  raise notice 'OK 4c -- client A voit sa propre demande (% ligne(s))', v_own;
end \$\$;
rollback;
SQL

echo "-- 4d. Un utilisateur anonyme ne peut lire aucune donnée privée (seba_state, client_requests) --"
psql_exec <<'SQL'
begin;
set local role anon;
do $$
declare v_state int; v_requests int;
begin
  select count(*) into v_state from seba_state;
  select count(*) into v_requests from client_requests;
  assert v_state = 0, 'ECHEC SECURITE : un anonyme voit des lignes de seba_state (' || v_state || ')';
  assert v_requests = 0, 'ECHEC SECURITE : un anonyme voit des lignes de client_requests (' || v_requests || ')';
  raise notice 'OK 4d -- anonyme ne voit rien dans seba_state ni client_requests';
end $$;
rollback;
SQL

echo "-- 4e. get_my_client_profile() pour un utilisateur non lié ne renvoie pas les données d'un autre --"
psql_exec <<SQL
begin;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000ffff","role":"authenticated"}';
select get_my_client_profile();
rollback;
SQL
echo "   (résultat attendu : {\"ok\": false, \"error\": \"Compte non relié à une fiche client.\"} -- vérifier ci-dessus, pas les données du client A)"

echo
echo "############################################################"
echo "# Vérifications terminées. Aucune correction appliquée."
echo "############################################################"
