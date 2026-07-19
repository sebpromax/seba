-- Complement a 20260719_client_espace.sql : remplace le scan complet de
-- link_client_account() par un index maintenu (table client_emails +
-- trigger sur seba_state). A rejouer si 20260719_client_espace.sql a
-- deja tourne AVANT ce correctif -- idempotent, sans risque sinon (la
-- version a jour de ce fichier est deja incluse dans
-- 20260719_client_espace.sql pour une installation fraiche).

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
