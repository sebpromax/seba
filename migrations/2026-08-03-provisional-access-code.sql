-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : accès initial Client/Salarié par code
-- provisoire (feat/client-employee-initial-access-code).
--
-- Complément à l'invitation par lien magique existante
-- (client-provision.ts/employe-provision.ts, inchangés) : un code court
-- (8 caractères), envoyé par email ou révélé une fois au patron, tapé
-- manuellement avant création obligatoire du mot de passe. Une seule
-- logique paramétrée par role ('client'|'employe'), jamais deux systèmes
-- séparés.
--
-- PÉRIMÈTRE STRICT DE CETTE MIGRATION : création/vérification/activation
-- du code, liaison métier, statut. **N'ajoute AUCUNE notion de
-- suspension de compte** (`suspended_at` volontairement absent de
-- client_accounts/employe_accounts dans ce chantier — fera l'objet d'une
-- PR de sécurité séparée) et **ne modifie aucune RPC/policy existante**.
--
-- MACHINE À ÉTATS (voir plan v4 pour le détail complet) :
--   pending -> verifying -> password_pending -> activated
--   (ou revoked / expired à tout moment)
-- `activated` n'est posé QUE par mark_access_code_activated(), appelée
-- par le frontend une fois authentifié, APRÈS que le mot de passe a
-- réellement été posé -- jamais avant, jamais automatiquement à la
-- création du lien métier (erreur de la v1/v3 de ce plan, corrigée).
--
-- SÉCURITÉ :
--   1. Génération du code : crypto.getRandomValues() côté Edge Function
--      (jamais random()/gen_random_bytes() SQL, jamais Math.random()) --
--      cette migration ne fait que HACHER (pgcrypto) un code déjà généré,
--      reçu en paramètre, jamais stocké en clair.
--   2. verify_access_code_attempt() : SELECT ... FOR UPDATE (sérialise
--      les tentatives concurrentes sur la même ligne), jamais accordée à
--      authenticated/anon -- seule service_role (Edge Function
--      activate-access-code) peut l'appeler.
--   3. Unicité globale (email, role) sur les invitations actives --
--      jamais de sélection arbitraire de "la dernière", jamais
--      d'écrasement silencieux d'une invitation d'un AUTRE compte.
--   4. Aucune fonction ne renvoie jamais code_hash. Aucune fonction ne
--      renvoie le code en clair, sauf create-access-code.ts en mode
--      reveal_once (hors SQL, jamais persisté).
--   5. RLS activée sur provisional_access_codes, ZÉRO policy
--      authenticated/anon (même doctrine que la table notifications du
--      Lot 1) -- accès exclusivement via les RPC security definer
--      ci-dessous.
--   6. search_path resserré à pg_catalog, pg_temp partout.
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────
-- 1. Table provisional_access_codes
-- ───────────────────────────────────────────────────────────────
create table if not exists provisional_access_codes (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  role text not null check (role in ('client', 'employe')),
  entity_id text not null,
  email text not null,
  code_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'verifying', 'password_pending', 'activated', 'revoked', 'expired')),
  delivery_method text not null check (delivery_method in ('email', 'reveal_once')),
  delivery_status text not null default 'not_sent' check (delivery_status in ('not_sent', 'sent', 'delivery_failed', 'revealed')),
  delivery_error text,
  attempts int not null default 0,
  locked_until timestamptz,
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verifying_at timestamptz,
  password_pending_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz
);

alter table provisional_access_codes enable row level security;
-- Aucune policy authenticated/anon : accès exclusivement via les RPC
-- security definer ci-dessous (voir doctrine de sécurité en tête de
-- fichier, point 5 -- même choix que la table notifications du Lot 1).

create index if not exists idx_provisional_access_codes_account on provisional_access_codes (account, role, entity_id, created_at desc);
create unique index if not exists idx_provisional_access_codes_active_unique on provisional_access_codes (email, role) where status in ('pending', 'verifying', 'password_pending');

-- Garde-fou base de données (en plus de la vérification applicative dans
-- finalize_access_code) : jamais deux liaisons pour la même entité, même
-- en cas de rejeu improbable. Ajout pur sur des tables déjà existantes du
-- baseline (jamais une modification du baseline figé lui-même).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employe_accounts_unique_target') then
    alter table employe_accounts add constraint employe_accounts_unique_target unique (account, employe_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_accounts_unique_target') then
    alter table client_accounts add constraint client_accounts_unique_target unique (account, client_id);
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 2. store_access_code — appelée uniquement par create-access-code.ts
-- (service_role, account déjà résolu côté Edge Function depuis le JWT
-- vérifié par la passerelle Supabase, JAMAIS depuis une valeur fournie
-- par le navigateur). Hache le code reçu, invalide l'ancien code actif
-- de CETTE entité (renvoi), refuse si (email, role) est déjà actif
-- ailleurs dans le système (jamais un écrasement cross-compte).
-- ───────────────────────────────────────────────────────────────
create or replace function store_access_code(
  p_account text, p_role text, p_entity_id text, p_email text, p_delivery_method text, p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  if p_account is null or btrim(p_account) = '' then return jsonb_build_object('ok', false, 'error', 'Compte invalide.'); end if;
  if p_role not in ('client', 'employe') then return jsonb_build_object('ok', false, 'error', 'Rôle invalide.'); end if;
  if p_delivery_method not in ('email', 'reveal_once') then return jsonb_build_object('ok', false, 'error', 'Méthode de livraison invalide.'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'error', 'Adresse email invalide.'); end if;
  if p_code is null or length(p_code) <> 8 then return jsonb_build_object('ok', false, 'error', 'Code invalide.'); end if;

  -- Le patron doit posseder la fiche visee : entity_id doit exister dans
  -- seba_state.state (clients[]/employes[]) de CE compte -- empeche de
  -- creer un code pour une fiche d'un autre patron via un entity_id
  -- devine ou mal transmis.
  if p_role = 'client' then
    if not exists (
      select 1 from public.seba_state s, jsonb_array_elements(coalesce(s.state -> 'clients', '[]'::jsonb)) c(value)
      where s.account = p_account and c.value ->> 'id' = p_entity_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'Fiche client introuvable.');
    end if;
  else
    if not exists (
      select 1 from public.seba_state s, jsonb_array_elements(coalesce(s.state -> 'employes', '[]'::jsonb)) e(value)
      where s.account = p_account and e.value ->> 'id' = p_entity_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'Fiche salarié introuvable.');
    end if;
  end if;

  -- Unicite globale (email, role) : refuse si une invitation active
  -- existe ailleurs (autre compte OU autre entite) -- jamais un
  -- ecrasement silencieux d'une invitation qui ne nous appartient pas.
  if exists (
    select 1 from public.provisional_access_codes
    where email = v_email and role = p_role
      and status in ('pending', 'verifying', 'password_pending')
      and not (account = p_account and entity_id = p_entity_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'Une invitation est déjà active pour cette adresse ailleurs dans le système.');
  end if;

  -- Invalide l'ancien code actif de CETTE entite precise (renvoi).
  update public.provisional_access_codes
    set status = 'revoked', revoked_at = now()
    where account = p_account and role = p_role and entity_id = p_entity_id
      and status in ('pending', 'verifying', 'password_pending');

  insert into public.provisional_access_codes (account, role, entity_id, email, code_hash, delivery_method, expires_at)
  values (p_account, p_role, p_entity_id, v_email, extensions.crypt(p_code, extensions.gen_salt('bf')), p_delivery_method, v_expires_at)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'invitation_id', v_id, 'expires_at', v_expires_at);
end;
$$;
revoke all on function store_access_code(text, text, text, text, text, text) from public;
revoke all on function store_access_code(text, text, text, text, text, text) from anon;
revoke all on function store_access_code(text, text, text, text, text, text) from authenticated;
grant execute on function store_access_code(text, text, text, text, text, text) to service_role;

-- ───────────────────────────────────────────────────────────────
-- 3. verify_access_code_attempt — appelée uniquement par
-- activate-access-code.ts (service_role). Verrouille la ligne (FOR
-- UPDATE), compare le hash, incremente les tentatives atomiquement,
-- applique le verrouillage progressif puis la revocation definitive.
-- Idempotente : un code deja passe en 'verifying'/'password_pending'
-- reste valide pour une reprise (reseau coupe), toujours revérifié.
-- ───────────────────────────────────────────────────────────────
create or replace function verify_access_code_attempt(p_email text, p_code text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row record;
  v_match boolean;
  v_new_attempts int;
begin
  if v_email = '' or p_code is null or p_role not in ('client', 'employe') then
    return jsonb_build_object('ok', false, 'error', 'Email ou code invalide, expiré ou déjà utilisé.');
  end if;

  select * into v_row from public.provisional_access_codes
  where email = v_email and role = p_role
    and status in ('pending', 'verifying', 'password_pending')
  order by created_at desc
  limit 1
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'Email ou code invalide, expiré ou déjà utilisé.');
  end if;

  if v_row.expires_at <= now() then
    update public.provisional_access_codes set status = 'expired' where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'Email ou code invalide, expiré ou déjà utilisé.');
  end if;

  -- Pendant un verrouillage actif, toute nouvelle tentative compte quand
  -- meme dans le total (sinon un attaquant qui martele pendant le
  -- verrouillage reste bloque indefiniment sous le seuil de revocation
  -- definitive -- corrige un defaut trouve par le test RLS local) : le
  -- code n'est meme pas verifie, la tentative est traitee comme un echec.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    v_match := false;
  else
    v_match := (extensions.crypt(p_code, v_row.code_hash) = v_row.code_hash);
  end if;

  if not v_match then
    v_new_attempts := v_row.attempts + 1;
    update public.provisional_access_codes set
      attempts = v_new_attempts,
      locked_until = case
        when v_new_attempts >= 10 then locked_until
        when v_new_attempts >= 8 then now() + interval '15 minutes'
        when v_new_attempts >= 5 then now() + interval '5 minutes'
        when v_new_attempts >= 3 then now() + interval '1 minute'
        else locked_until
      end,
      status = case when v_new_attempts >= 10 then 'revoked' else status end,
      revoked_at = case when v_new_attempts >= 10 then now() else revoked_at end
    where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'Email ou code invalide, expiré ou déjà utilisé.');
  end if;

  -- Succes : ne redescend jamais un statut deja plus avance
  -- (password_pending reste password_pending sur un simple rejeu).
  update public.provisional_access_codes
    set status = case when status = 'pending' then 'verifying' else status end,
        verifying_at = coalesce(verifying_at, now())
    where id = v_row.id;

  return jsonb_build_object(
    'ok', true, 'invitation_id', v_row.id, 'account', v_row.account,
    'entity_id', v_row.entity_id, 'role', v_row.role, 'email', v_row.email,
    'auth_user_id', v_row.auth_user_id, 'status', v_row.status
  );
end;
$$;
revoke all on function verify_access_code_attempt(text, text, text) from public;
revoke all on function verify_access_code_attempt(text, text, text) from anon;
revoke all on function verify_access_code_attempt(text, text, text) from authenticated;
grant execute on function verify_access_code_attempt(text, text, text) to service_role;

-- ───────────────────────────────────────────────────────────────
-- 4. finalize_access_code — appelée uniquement par
-- activate-access-code.ts (service_role), APRÈS que le compte Auth a
-- été créé/confirmé via l'Admin API (hors transaction Postgres). Crée la
-- liaison métier et passe le statut à 'password_pending' (PAS
-- 'activated' -- corrige l'erreur des versions précédentes du plan) dans
-- UNE SEULE transaction. Idempotente (on conflict do nothing).
-- ───────────────────────────────────────────────────────────────
create or replace function finalize_access_code(p_invitation_id uuid, p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row record;
begin
  select * into v_row from public.provisional_access_codes where id = p_invitation_id for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'Invitation introuvable.');
  end if;
  if v_row.status not in ('verifying', 'password_pending') then
    return jsonb_build_object('ok', false, 'error', 'Invitation non valide pour cette étape.');
  end if;
  if v_row.expires_at <= now() then
    update public.provisional_access_codes set status = 'expired' where id = p_invitation_id;
    return jsonb_build_object('ok', false, 'error', 'Invitation expirée.');
  end if;

  if v_row.role = 'client' then
    insert into public.client_accounts (client_user_id, account, client_id, email)
    values (p_auth_user_id, v_row.account, v_row.entity_id, v_row.email)
    on conflict (client_user_id) do nothing;
  else
    insert into public.employe_accounts (employe_user_id, account, employe_id, email)
    values (p_auth_user_id, v_row.account, v_row.entity_id, v_row.email)
    on conflict (employe_user_id) do nothing;
  end if;

  update public.provisional_access_codes
    set status = 'password_pending',
        password_pending_at = coalesce(password_pending_at, now()),
        auth_user_id = p_auth_user_id
    where id = p_invitation_id;

  return jsonb_build_object('ok', true, 'invitation_id', p_invitation_id, 'role', v_row.role);
end;
$$;
revoke all on function finalize_access_code(uuid, uuid) from public;
revoke all on function finalize_access_code(uuid, uuid) from anon;
revoke all on function finalize_access_code(uuid, uuid) from authenticated;
grant execute on function finalize_access_code(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────────
-- 5. mark_access_code_activated — appelée par le FRONTEND, authentifié
-- (le client/salarié a déjà une vraie session via verifyOtp() à ce
-- stade), UNIQUEMENT après que sebaAuth.updatePassword() a réellement
-- réussi. Idempotente : un rejeu (déjà activé) n'est jamais une erreur.
-- ───────────────────────────────────────────────────────────────
create or replace function mark_access_code_activated()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select * into v_row from public.provisional_access_codes
  where auth_user_id = v_uid and status = 'password_pending'
  order by password_pending_at desc nulls last
  limit 1
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', true, 'already_activated', true);
  end if;

  update public.provisional_access_codes set status = 'activated', activated_at = now() where id = v_row.id;

  return jsonb_build_object('ok', true, 'already_activated', false);
end;
$$;
revoke all on function mark_access_code_activated() from public;
revoke all on function mark_access_code_activated() from anon;
grant execute on function mark_access_code_activated() to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 6. revoke_access_code — action patron.
-- ───────────────────────────────────────────────────────────────
create or replace function revoke_access_code(p_role text, p_entity_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_updated int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  select account into v_account from public.seba_state where user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;
  if p_role not in ('client', 'employe') then return jsonb_build_object('ok', false, 'error', 'Rôle invalide.'); end if;

  update public.provisional_access_codes
    set status = 'revoked', revoked_at = now()
    where account = v_account and role = p_role and entity_id = p_entity_id
      and status in ('pending', 'verifying', 'password_pending');
  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'revoked', v_updated > 0);
end;
$$;
revoke all on function revoke_access_code(text, text) from public;
revoke all on function revoke_access_code(text, text) from anon;
grant execute on function revoke_access_code(text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7. get_my_access_codes_status — lecture patron, allowlist explicite
-- (jamais code_hash, jamais attempts/locked_until bruts). Statut affiché
-- calculé (expiration paresseuse jamais encore visitée par un essai =
-- affichée quand même comme "expired", sans dépendre d'un job).
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_access_codes_status(p_role text default null, p_entity_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_result jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  select account into v_account from public.seba_state where user_id = v_uid;
  if v_account is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'role', role, 'entity_id', entity_id, 'email', email,
    'status', case when status in ('pending', 'verifying') and expires_at <= now() then 'expired' else status end,
    'delivery_method', delivery_method, 'delivery_status', delivery_status,
    'created_at', created_at, 'expires_at', expires_at, 'verifying_at', verifying_at,
    'password_pending_at', password_pending_at, 'activated_at', activated_at, 'revoked_at', revoked_at
  ) order by created_at desc), '[]'::jsonb) into v_result
  from public.provisional_access_codes
  where account = v_account
    and (p_role is null or role = p_role)
    and (p_entity_id is null or entity_id = p_entity_id);

  return v_result;
end;
$$;
revoke all on function get_my_access_codes_status(text, text) from public;
revoke all on function get_my_access_codes_status(text, text) from anon;
grant execute on function get_my_access_codes_status(text, text) to authenticated;

commit;
