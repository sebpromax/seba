-- Espace Client : rattachement de compte, demandes, RPC.
-- Idempotent : peut etre rejoue sans risque. Voir supabase-schema.sql
-- sections 30-34 pour la version de reference tenue a jour.
-- Reecrit aussi les policies seba_messages (section 29 de
-- supabase-schema.sql) pour supporter un client authentifie de facon
-- independante (2e auth.uid() possible par conversation).

create table if not exists client_accounts (
  client_user_id uuid primary key references auth.users (id) on delete cascade,
  account text not null references seba_state (account) on delete cascade,
  client_id text not null,
  email text not null,
  linked_at timestamptz default now()
);
alter table client_accounts enable row level security;
drop policy if exists "client_accounts_select_own" on client_accounts;
create policy "client_accounts_select_own" on client_accounts for select using (auth.uid() = client_user_id);
create index if not exists idx_client_accounts_account on client_accounts (account, client_id);

create table if not exists client_requests (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  client_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text not null,
  titre text not null,
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'en_cours', 'terminee', 'annulee')),
  intervenant_id text,
  intervenant_nom text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table client_requests enable row level security;
drop policy if exists "client_requests_select" on client_requests;
create policy "client_requests_select" on client_requests for select using (
  exists (select 1 from seba_state s where s.account = client_requests.account and s.user_id = auth.uid())
  or auth.uid() = client_user_id
);
drop policy if exists "client_requests_insert" on client_requests;
create policy "client_requests_insert" on client_requests for insert with check (
  auth.uid() = client_user_id
  and exists (
    select 1 from client_accounts ca
    where ca.client_user_id = auth.uid() and ca.account = client_requests.account and ca.client_id = client_requests.client_id
  )
);
drop policy if exists "client_requests_update" on client_requests;
create policy "client_requests_update" on client_requests for update using (
  exists (select 1 from seba_state s where s.account = client_requests.account and s.user_id = auth.uid())
);
create index if not exists idx_client_requests_account on client_requests (account, created_at);
create index if not exists idx_client_requests_client on client_requests (account, client_id, created_at);

drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
);
drop policy if exists "seba_messages_insert" on seba_messages;
create policy "seba_messages_insert" on seba_messages for insert with check (
  auth.uid() = user_id
  and (
    exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
    or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  )
);
drop policy if exists "seba_messages_update" on seba_messages;
create policy "seba_messages_update" on seba_messages for update using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
);

-- Index email -> (account, client_id), maintenu par trigger -- evite un
-- scan complet de tous les comptes a chaque tentative de connexion
-- client (necessaire des que le site sert des milliers d'utilisateurs
-- confondus). RLS sans policy : accessible uniquement via SECURITY
-- DEFINER (le trigger et link_client_account ci-dessous).
create table if not exists client_emails (
  email text primary key,
  account text not null references seba_state (account) on delete cascade,
  client_id text not null,
  updated_at timestamptz default now()
);
alter table client_emails enable row level security;
create index if not exists idx_client_emails_account on client_emails (account);

create or replace function sync_client_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and old.state -> 'clients' is not distinct from new.state -> 'clients' then
    return new;
  end if;
  delete from client_emails where account = new.account;
  insert into client_emails (email, account, client_id)
  select lower(c ->> 'email'), new.account, c ->> 'id'
  from jsonb_array_elements(coalesce(new.state -> 'clients', '[]'::jsonb)) c
  where c ->> 'email' is not null and c ->> 'email' <> ''
  on conflict (email) do update set account = excluded.account, client_id = excluded.client_id, updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_sync_client_emails on seba_state;
create trigger trg_sync_client_emails
after insert or update of state on seba_state
for each row execute function sync_client_emails();

insert into client_emails (email, account, client_id)
select lower(c ->> 'email'), s.account, c ->> 'id'
from seba_state s, jsonb_array_elements(coalesce(s.state -> 'clients', '[]'::jsonb)) c
where c ->> 'email' is not null and c ->> 'email' <> ''
on conflict (email) do update set account = excluded.account, client_id = excluded.client_id, updated_at = now();

create or replace function link_client_account(_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row client_emails;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Authentification requise');
  end if;

  if exists (select 1 from client_accounts where client_user_id = v_uid) then
    return jsonb_build_object('ok', true, 'already_linked', true);
  end if;

  select * into v_row from client_emails where email = lower(_email);

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'Aucune fiche client trouvée avec cet email. Contactez votre prestataire.');
  end if;

  insert into client_accounts (client_user_id, account, client_id, email)
  values (v_uid, v_row.account, v_row.client_id, lower(_email));

  return jsonb_build_object('ok', true, 'already_linked', false);
end;
$$;
revoke all on function link_client_account(text) from public;
grant execute on function link_client_account(text) to authenticated;

create or replace function get_my_client_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link client_accounts;
  v_client jsonb;
begin
  select * into v_link from client_accounts where client_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.');
  end if;

  select c into v_client
  from seba_state s, jsonb_array_elements(s.state -> 'clients') c
  where s.account = v_link.account and c ->> 'id' = v_link.client_id
  limit 1;

  return jsonb_build_object('ok', true, 'client', v_client, 'account', v_link.account, 'client_id', v_link.client_id);
end;
$$;
revoke all on function get_my_client_profile() from public;
grant execute on function get_my_client_profile() to authenticated;
