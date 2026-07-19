-- Espace Client : provisionne par le patron par INVITATION (auth.admin.
-- inviteUserByEmail), le client choisit son propre mot de passe via le
-- lien recu -- jamais un mot de passe de depart impose. Demandes, RPC.
-- Idempotent : peut etre rejoue sans risque. Voir supabase-schema.sql
-- sections 30/31/33 pour la version de reference tenue a jour.
--
-- Necessite en plus le deploiement de l'Edge Function
-- supabase-functions/client-provision.ts (voir MANUEL-SEBA-ADMIN.md).
--
-- Si tu as deja rejoue une version anterieure de ce fichier (avec
-- pw_is_default / mark_client_password_changed), rejoue aussi
-- migrations/20260719c_universal_auth_employe.sql qui reecrit les
-- policies seba_messages pour l'employe ET retire pw_is_default.

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
alter table client_accounts drop column if exists pw_is_default;

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

drop function if exists mark_client_password_changed();
