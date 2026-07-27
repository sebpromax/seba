-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Envoi email des documents commerciaux
-- (feature/customer-email-delivery, PHASE 1 — base de données et RLS
-- uniquement, aucune logique métier devis/facture/reçu modifiée).
--
-- Une seule table technique, purement journal d'envoi -- ne duplique
-- JAMAIS les données commerciales (déjà dans seba_state.devis/factures/
-- clients, RLS existante inchangée). Aucune donnée financière, aucune
-- ligne de document, aucun secret, jamais.
--
-- Écritures réservées à l'Edge Function send-commercial-document
-- (service_role, bypasse RLS) -- le patron authentifié peut uniquement
-- LIRE l'historique de son propre account (policy directe auth.uid() =
-- user_id, même convention que clients_select/interv_select dans
-- supabase-schema.sql), jamais écrire depuis le navigateur.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists commercial_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null,
  client_id text not null check (btrim(client_id) <> ''),
  document_type text not null check (document_type in ('quote', 'invoice', 'receipt')),
  document_id text not null check (btrim(document_id) <> ''),
  recipient text not null check (btrim(recipient) <> ''),
  subject text not null check (btrim(subject) <> ''),
  provider_message_id text,
  status text not null default 'creating' check (status in ('creating', 'sent', 'delivered', 'failed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cediv_account_idempotency_unique unique (account, idempotency_key)
);

alter table commercial_email_deliveries enable row level security;

-- Lecture patron directe (même convention que clients_select/interv_select
-- ci-dessus dans supabase-schema.sql) -- jamais via une RPC ici, aucune
-- logique de sérialisation/allowlist n'est nécessaire pour cette table
-- (déjà dépourvue de toute donnée sensible par construction : voir les
-- colonnes ci-dessus, jamais de montant/ligne/adresse/secret).
drop policy if exists "cediv_select_own" on commercial_email_deliveries;
create policy "cediv_select_own" on commercial_email_deliveries
  for select using (auth.uid() = user_id);

-- Aucune policy insert/update/delete pour authenticated : seule
-- l'Edge Function (clé service_role, contourne RLS) écrit dans cette
-- table. SELECT octroyé explicitement (ce projet local ne l'accorde pas
-- par défaut, contrairement aux GRANT implicites d'un projet Supabase
-- hébergé) -- la policy ci-dessus filtre déjà les lignes visibles à
-- auth.uid() = user_id, aucun accès élargi.
grant select on commercial_email_deliveries to authenticated;
revoke insert, update, delete on commercial_email_deliveries from authenticated;
revoke all on commercial_email_deliveries from anon;

-- service_role (Edge Function uniquement) : lecture/écriture complètes,
-- contourne RLS par définition de ce rôle -- ce projet local n'accorde
-- aucun privilège implicite sur les nouvelles tables, il faut l'octroyer
-- explicitement (même constat empirique que pour authenticated ci-dessus).
grant select, insert, update on commercial_email_deliveries to service_role;

create index if not exists cediv_account_created_idx on commercial_email_deliveries (account, created_at desc);
create index if not exists cediv_account_doc_idx on commercial_email_deliveries (account, document_type, document_id);
create index if not exists cediv_provider_msg_idx on commercial_email_deliveries (provider_message_id) where provider_message_id is not null;

commit;
