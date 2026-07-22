#!/usr/bin/env bash
# SEBA — jeu de données entièrement synthétique pour l'environnement local.
#
# Aucune valeur ici n'est une clé de production : les clés anon/service_role
# sont lues dynamiquement depuis `supabase status` (générées localement par
# la CLI à chaque instance), jamais copiées depuis docs/config.js ou .env.
#
# Domaine réservé aux tests : *.test.seba.invalid (TLD .invalid, RFC 2606 —
# garanti non routable et non réel, jamais un domaine existant).
set -euo pipefail

eval "$(npx --yes supabase@2.109.1 status -o env)"
# Variables attendues après cet eval : API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL
# psql absent de l'hôte (constaté à l'exécution) -- utilise le psql du conteneur Postgres fourni par Supabase local.
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== Création des comptes synthétiques (via l'API Auth locale, service_role) =="

create_user() {
  local email="$1"
  curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Test-Synthetic-2026!\",\"email_confirm\":true}"
}

PATRON_A_JSON=$(create_user "patron-a@test.seba.invalid")
PATRON_B_JSON=$(create_user "patron-b@test.seba.invalid")
EMPLOYE_A_JSON=$(create_user "employe-a@test.seba.invalid")
CLIENT_A_JSON=$(create_user "client-a@test.seba.invalid")
ORPHAN_JSON=$(create_user "orphan-sans-profil@test.seba.invalid")

PATRON_A_ID=$(echo "$PATRON_A_JSON" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
PATRON_B_ID=$(echo "$PATRON_B_JSON" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
EMPLOYE_A_ID=$(echo "$EMPLOYE_A_JSON" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
CLIENT_A_ID=$(echo "$CLIENT_A_JSON" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
ORPHAN_ID=$(echo "$ORPHAN_JSON" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)

echo "   patron A  = $PATRON_A_ID"
echo "   patron B  = $PATRON_B_ID"
echo "   employe A = $EMPLOYE_A_ID"
echo "   client A  = $CLIENT_A_ID"
echo "   orphelin (aucun profil/lien) = $ORPHAN_ID"

echo "== Écriture de l'état applicatif (seba_state) pour patron A et B, via service_role =="
# Insertion directe en tant que service_role pour le seed initial (contourne
# volontairement RLS UNIQUEMENT pour amorcer les données de test -- les tests
# RLS eux-mêmes, dans verify.sh, ne passent JAMAIS par service_role).
psql_exec <<SQL
insert into seba_state (account, user_id, state) values
  ('test-patron-a', '$PATRON_A_ID', '{"v":1,"clients":[{"id":"cli_synth_1","nom":"Client Synthétique A","email":"client-a@test.seba.invalid"}],"devis":[{"id":"dev_synth_1","numero":"TEST-0001","clientId":"cli_synth_1","statut":"envoye","montant":150}],"factures":[],"interventions":[],"employes":[{"id":"emp_synth_1","nom":"Employé Synthétique A"}],"journal":[]}'::jsonb)
on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

insert into seba_state (account, user_id, state) values
  ('test-patron-b', '$PATRON_B_ID', '{"v":1,"clients":[{"id":"cli_synth_2","nom":"Client Synthétique B","email":"client-b@test.seba.invalid"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[]}'::jsonb)
on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

insert into employe_accounts (employe_user_id, account, employe_id, email) values
  ('$EMPLOYE_A_ID', 'test-patron-a', 'emp_synth_1', 'employe-a@test.seba.invalid')
on conflict (employe_user_id) do nothing;

insert into client_accounts (client_user_id, account, client_id, email) values
  ('$CLIENT_A_ID', 'test-patron-a', 'cli_synth_1', 'client-a@test.seba.invalid')
on conflict (client_user_id) do nothing;

insert into client_requests (account, client_user_id, client_id, titre, statut) values
  ('test-patron-a', '$CLIENT_A_ID', 'cli_synth_1', 'Demande synthétique de test', 'nouvelle');
SQL

echo "== Upload d'un fichier synthétique dans mission-photos (pour tester les orphelins Storage) =="
echo "ceci-est-une-photo-de-test-synthetique-pas-une-vraie-image" > /tmp/seba-synthetic-photo.txt
REQUEST_ID=$(psql_exec -t -A -c "select id from client_requests where account='test-patron-a' limit 1;" | tr -d '[:space:]')
curl -s -X POST "$API_URL/storage/v1/object/mission-photos/${REQUEST_ID}/synthetic-test.jpg" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/tmp/seba-synthetic-photo.txt > /tmp/seba-storage-upload.log 2>&1
echo "   Chemin uploadé : mission-photos/${REQUEST_ID}/synthetic-test.jpg"
rm -f /tmp/seba-synthetic-photo.txt

echo "== Jeu de données synthétique créé. Aucun email/téléphone/nom réel utilisé. =="

# Exporte les identifiants pour verify.sh (fichier local, non commité, recréé à chaque seed)
cat > "$(dirname "${BASH_SOURCE[0]}")/.synthetic-ids.env" <<ENV
PATRON_A_ID=$PATRON_A_ID
PATRON_B_ID=$PATRON_B_ID
EMPLOYE_A_ID=$EMPLOYE_A_ID
CLIENT_A_ID=$CLIENT_A_ID
ORPHAN_ID=$ORPHAN_ID
SYNTHETIC_STORAGE_PATH=mission-photos/${REQUEST_ID}/synthetic-test.jpg
ENV
