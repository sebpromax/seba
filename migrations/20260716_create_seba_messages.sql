-- Messagerie terrain (client-fiche.html / employe-fiche.html).
-- Idempotent : peut etre rejoue sans risque. Voir supabase-schema.sql
-- section 29 pour la version de reference tenue a jour.
create table if not exists seba_messages (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),
  client_id text,
  employe_id text,
  expediteur_role text not null check (expediteur_role in ('patron', 'employe', 'client')),
  destinataire_role text not null check (destinataire_role in ('patron', 'employe', 'client')),
  texte text not null,
  lu boolean not null default false,
  created_at timestamptz default now()
);
alter table seba_messages enable row level security;
drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (auth.uid() = user_id);
drop policy if exists "seba_messages_insert" on seba_messages;
create policy "seba_messages_insert" on seba_messages for insert with check (auth.uid() = user_id);
drop policy if exists "seba_messages_update" on seba_messages;
create policy "seba_messages_update" on seba_messages for update using (auth.uid() = user_id);
create index if not exists idx_seba_messages_client on seba_messages (account, client_id, created_at);
create index if not exists idx_seba_messages_employe on seba_messages (account, employe_id, created_at);
