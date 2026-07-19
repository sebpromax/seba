-- Authentification universelle -- volet EMPLOYE (2026-07-19, revision
-- demandee explicitement le meme jour que l'Espace Client). Retire le
-- modele PIN/badge-sur-appareil-patron (employe_credentials/
-- employe_sessions) au profit d'un vrai compte Supabase Auth
-- independant, exactement comme le client : provisionne par INVITATION
-- (Edge Function employe-provision.ts, auth.admin.inviteUserByEmail),
-- l'employe choisit son propre mot de passe via le lien recu.
--
-- ORDRE REQUIS : ce fichier reference client_accounts (policies
-- seba_messages) -- rejoue migrations/20260719_client_espace.sql AVANT
-- celui-ci si ce n'est pas deja fait.
--
-- Necessite en plus le deploiement de l'Edge Function
-- supabase-functions/employe-provision.ts (voir MANUEL-SEBA-ADMIN.md).
-- employe-auth.ts et employe-set-pin.ts (ancien modele PIN) peuvent etre
-- retirees de Supabase → Edge Functions si deja deployees -- ne sont
-- plus appelees par aucune page.

drop table if exists employe_sessions;
drop table if exists employe_credentials;

create table if not exists employe_accounts (
  employe_user_id uuid primary key references auth.users (id) on delete cascade,
  account text not null references seba_state (account) on delete cascade,
  employe_id text not null,
  email text not null,
  linked_at timestamptz default now()
);
alter table employe_accounts enable row level security;
drop policy if exists "employe_accounts_select_own" on employe_accounts;
create policy "employe_accounts_select_own" on employe_accounts for select using (auth.uid() = employe_user_id);
create index if not exists idx_employe_accounts_account on employe_accounts (account, employe_id);

-- seba_messages : version finale des policies (patron OU client lie OU
-- employe lie) -- remplace toute version anterieure (idempotent).
drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
);
drop policy if exists "seba_messages_insert" on seba_messages;
create policy "seba_messages_insert" on seba_messages for insert with check (
  auth.uid() = user_id
  and (
    exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
    or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
    or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
  )
);
drop policy if exists "seba_messages_update" on seba_messages;
create policy "seba_messages_update" on seba_messages for update using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
);

create or replace function get_my_employee_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_employe jsonb;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select e into v_employe
  from seba_state s, jsonb_array_elements(s.state -> 'employes') e
  where s.account = v_link.account and e ->> 'id' = v_link.employe_id
  limit 1;

  return jsonb_build_object('ok', true, 'employe', v_employe, 'account', v_link.account, 'employe_id', v_link.employe_id);
end;
$$;
revoke all on function get_my_employee_profile() from public;
grant execute on function get_my_employee_profile() to authenticated;

create or replace function get_my_employee_interventions(_date text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_result jsonb;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_result
  from seba_state s, jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) i
  where s.account = v_link.account
    and i ->> 'employeId' = v_link.employe_id
    and i ->> 'date' = _date;

  return jsonb_build_object('ok', true, 'interventions', v_result, 'account', v_link.account, 'employe_id', v_link.employe_id);
end;
$$;
revoke all on function get_my_employee_interventions(text) from public;
grant execute on function get_my_employee_interventions(text) to authenticated;
