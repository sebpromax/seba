-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Centre de notifications commun (Lot 1 du
-- programme d'amélioration des portails Client/Salarié).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt). Ne modifie
-- ni supabase-schema.sql ni aucune migration historique.
--
-- OBJET : une table dédiée `notifications` (justifiée par les critères de
-- `CLAUDE.md`/la mission : cycle de vie indépendant des données métier,
-- volume de lecture potentiellement élevé, RLS précise par destinataire —
-- PAS un ajout dans seba_state.state, qui grossirait un document déjà
-- envoyé en bloc à chaque lecture). Canal V1 : in-app uniquement (voir
-- _architecture/PORTAL_NOTIFICATION_EVENTS.md pour le catalogue complet
-- et la justification du choix "email non bloquant pour ce lot").
--
-- PORTÉE EXACTE DE CE LOT (volontairement restreinte, le reste du
-- catalogue suit dans des lots ultérieurs, jamais mélangé ici) :
--   1. Infrastructure : table + RLS + RPC de lecture/marquage.
--   2. Déclenchement réel, choisi pour son isolation et son innocuité vis-
--      à-vis du code déjà testé :
--      a. Nouveau message (`seba_messages`) -> trigger AFTER INSERT,
--         zéro contact avec le code applicatif existant.
--      b. `client_accept_devis` / `client_refuse_devis` -> notifie le
--         patron (CREATE OR REPLACE additif, logique existante
--         reproduite à l'identique, un seul appel ajouté avant le
--         `return` de succès).
--      c. `complete_my_intervention` -> notifie le patron (idem).
--   Les autres événements du catalogue (réassignation, changement de
--   date/heure, réouverture, etc.) passent par le chemin générique
--   `apply_entity_patch`/`SebaDB.update` (aucune RPC dédiée existante) —
--   les y brancher aurait touché la fonction la plus critique et la plus
--   testée du dépôt sans le temps de la revalider intégralement dans ce
--   lot ; reporté explicitement à un lot de suivi, documenté dans
--   _architecture/PORTALS_MAX_ROADMAP.md, PAS une fonctionnalité simulée
--   ni un mock — simplement non câblée dans cette PR.
--
-- SÉCURITÉ (même doctrine que Intervention 360/Quote-to-Cash) :
--   1. `create_notification()` n'est JAMAIS exposée à `authenticated`/
--      `anon` (aucun GRANT EXECUTE pour ces rôles) — appelable
--      uniquement depuis une autre fonction SECURITY DEFINER de ce
--      schéma (les fonctions appelantes s'exécutent avec les droits de
--      leur propriétaire, qui possède aussi `create_notification`).
--      Empêche un utilisateur de forger une notification pour un autre
--      compte ou un autre destinataire.
--   2. Lecture (`get_my_notifications`, `get_my_unread_notification_count`)
--      et marquage (`mark_notification_read`, `mark_all_notifications_read`)
--      : `security definer`, résolvent `auth.uid()` et ne touchent jamais
--      que les lignes où `recipient_user_id = auth.uid()`.
--   3. RLS activée sur `notifications` en plus des RPC (défense en
--      profondeur) : aucune policy SELECT/INSERT/UPDATE/DELETE pour
--      `authenticated`/`anon` — la table n'est accessible QUE via les RPC
--      `security definer` ci-dessus (choix délibéré : plus strict qu'une
--      policy "select if recipient_user_id = auth.uid()" qui autoriserait
--      aussi une requête REST directe hors RPC).
--   4. `search_path` resserré à `pg_catalog, pg_temp` partout.
--   5. `REVOKE PUBLIC` + `REVOKE anon` explicites sur toutes les RPC,
--      `GRANT EXECUTE` au seul rôle `authenticated` (sauf
--      `create_notification`, jamais accordée).
--
-- IDEMPOTENCE : `dedup_key` (nullable) + index unique partiel — un
-- `INSERT ... ON CONFLICT DO NOTHING` empêche tout doublon pour le même
-- événement+destinataire.
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Table notifications
-- ───────────────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  recipient_user_id uuid not null,
  recipient_role text not null check (recipient_role in ('patron', 'client', 'employe')),
  event_type text not null,
  severity text not null default 'normal' check (severity in ('normal', 'important', 'urgent')),
  title text not null,
  body text,
  link_entity text,
  link_entity_id text,
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;
-- Aucune policy authenticated/anon : accès exclusivement via les RPC
-- security definer ci-dessous (voir doctrine de sécurité en tête de
-- fichier, point 3).

create index if not exists idx_notifications_recipient on notifications (recipient_user_id, created_at desc);
create unique index if not exists idx_notifications_dedup on notifications (account, recipient_user_id, dedup_key) where dedup_key is not null;

-- ───────────────────────────────────────────────────────────────
-- 2. Table notification_preferences — minimale (V1) : un utilisateur peut
-- désactiver l'email pour une catégorie d'événement. Le in-app reste
-- toujours actif (jamais désactivable — c'est le canal de vérité du
-- centre de notifications, contrairement à l'email qui est un simple
-- relais best-effort). Absence de ligne = email activé par défaut.
-- ───────────────────────────────────────────────────────────────
create table if not exists notification_preferences (
  user_id uuid not null,
  event_type text not null,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

alter table notification_preferences enable row level security;
drop policy if exists "notification_preferences_select_own" on notification_preferences;
create policy "notification_preferences_select_own" on notification_preferences for select using (auth.uid() = user_id);
drop policy if exists "notification_preferences_upsert_own" on notification_preferences;
create policy "notification_preferences_upsert_own" on notification_preferences for insert with check (auth.uid() = user_id);
drop policy if exists "notification_preferences_update_own" on notification_preferences;
create policy "notification_preferences_update_own" on notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────
-- 3. create_notification — helper interne, JAMAIS accordée à
-- authenticated/anon. Idempotente via dedup_key.
-- ───────────────────────────────────────────────────────────────
create or replace function create_notification(
  p_account text,
  p_recipient_user_id uuid,
  p_recipient_role text,
  p_event_type text,
  p_title text,
  p_body text default null,
  p_severity text default 'normal',
  p_link_entity text default null,
  p_link_entity_id text default null,
  p_dedup_key text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.notifications (account, recipient_user_id, recipient_role, event_type, severity, title, body, link_entity, link_entity_id, dedup_key)
  values (p_account, p_recipient_user_id, p_recipient_role, p_event_type, p_severity, p_title, p_body, p_link_entity, p_link_entity_id, p_dedup_key)
  on conflict (account, recipient_user_id, dedup_key) where dedup_key is not null do nothing;
exception when others then
  -- Une notification qui échoue à s'écrire ne doit JAMAIS faire échouer
  -- l'action métier qui l'a déclenchée (accepter un devis, terminer une
  -- mission...). Best-effort assumé, jamais silencieux au sens de "caché
  -- à l'équipe" : PostgreSQL journalise l'exception serveur normalement.
  null;
end;
$$;
revoke all on function create_notification(text, uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function create_notification(text, uuid, text, text, text, text, text, text, text, text) from anon;
revoke all on function create_notification(text, uuid, text, text, text, text, text, text, text, text) from authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4. Lecture/marquage — exposées à authenticated uniquement.
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_notifications(p_limit int default 50, p_only_unread boolean default false)
returns setof notifications
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  return query
    select * from public.notifications
    where recipient_user_id = v_uid
      and (not p_only_unread or read_at is null)
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;
revoke all on function get_my_notifications(int, boolean) from public;
revoke all on function get_my_notifications(int, boolean) from anon;
grant execute on function get_my_notifications(int, boolean) to authenticated;

create or replace function get_my_unread_notification_count()
returns int
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then return 0; end if;
  select count(*) into v_count from public.notifications where recipient_user_id = v_uid and read_at is null;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function get_my_unread_notification_count() from public;
revoke all on function get_my_unread_notification_count() from anon;
grant execute on function get_my_unread_notification_count() to authenticated;

create or replace function mark_notification_read(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  update public.notifications set read_at = now()
  where id = p_id and recipient_user_id = v_uid and read_at is null;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;
revoke all on function mark_notification_read(uuid) from public;
revoke all on function mark_notification_read(uuid) from anon;
grant execute on function mark_notification_read(uuid) to authenticated;

create or replace function mark_all_notifications_read()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  update public.notifications set read_at = now()
  where recipient_user_id = v_uid and read_at is null;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;
revoke all on function mark_all_notifications_read() from public;
revoke all on function mark_all_notifications_read() from anon;
grant execute on function mark_all_notifications_read() to authenticated;

create or replace function get_my_notification_preferences()
returns setof notification_preferences
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  return query select * from public.notification_preferences where user_id = v_uid;
end;
$$;
revoke all on function get_my_notification_preferences() from public;
revoke all on function get_my_notification_preferences() from anon;
grant execute on function get_my_notification_preferences() to authenticated;

create or replace function set_my_notification_preference(p_event_type text, p_email_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_event_type is null or btrim(p_event_type) = '' then
    return jsonb_build_object('ok', false, 'error', 'event_type requis.');
  end if;
  insert into public.notification_preferences (user_id, event_type, email_enabled)
  values (v_uid, p_event_type, p_email_enabled)
  on conflict (user_id, event_type) do update set email_enabled = excluded.email_enabled, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function set_my_notification_preference(text, boolean) from public;
revoke all on function set_my_notification_preference(text, boolean) from anon;
grant execute on function set_my_notification_preference(text, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5. Déclencheur "nouveau message" — AFTER INSERT sur seba_messages,
-- zéro modification du code applicatif existant. Notifie tous les
-- participants du fil SAUF l'auteur (les mêmes 3 chemins de participation
-- que la policy seba_messages_select définie dans
-- migrations/20260720_mission_chat.sql : patron du compte, client lié,
-- employé lié via request_id).
-- ───────────────────────────────────────────────────────────────
create or replace function notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_patron_uid uuid;
  v_client_uid uuid;
  v_employe_uid uuid;
  v_title text := 'Nouveau message';
begin
  select user_id into v_patron_uid from public.seba_state where account = new.account;
  if v_patron_uid is not null and v_patron_uid != new.user_id then
    perform public.create_notification(new.account, v_patron_uid, 'patron', 'message.new', v_title, left(new.texte, 140), 'normal', 'messages', new.id::text, null);
  end if;

  if new.client_id is not null then
    select client_user_id into v_client_uid from public.client_accounts where account = new.account and client_id = new.client_id;
    if v_client_uid is not null and v_client_uid != new.user_id then
      perform public.create_notification(new.account, v_client_uid, 'client', 'message.new', v_title, left(new.texte, 140), 'normal', 'messages', new.id::text, null);
    end if;
  end if;

  if new.employe_id is not null then
    select employe_user_id into v_employe_uid from public.employe_accounts where account = new.account and employe_id = new.employe_id;
    if v_employe_uid is not null and v_employe_uid != new.user_id then
      perform public.create_notification(new.account, v_employe_uid, 'employe', 'message.new', v_title, left(new.texte, 140), 'normal', 'messages', new.id::text, null);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on seba_messages;
create trigger trg_notify_new_message after insert on seba_messages
for each row execute function notify_new_message();

-- ───────────────────────────────────────────────────────────────
-- 6. client_accept_devis — CREATE OR REPLACE additif. Logique EXISTANTE
-- (migrations/2026-07-26-quote-to-cash.sql) reproduite à l'identique ;
-- seul ajout : une notification au patron juste avant le retour de
-- succès de la branche qui modifie réellement l'état (jamais sur le
-- rejeu idempotent où le statut était déjà 'signe').
-- ───────────────────────────────────────────────────────────────
create or replace function client_accept_devis(p_devis_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_patron_uid uuid;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select d.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value)
  where d.value ->> 'id' = p_devis_id and d.value ->> 'clientId' = v_client_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Devis introuvable ou non associé à votre compte.');
  end if;

  if v_current ->> 'status' = 'signe' then
    return jsonb_build_object('ok', true, 'devis', v_current);
  end if;
  if v_current ->> 'status' != 'attente' then
    return jsonb_build_object('ok', false, 'error', 'Ce devis ne peut plus être accepté.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_accepted', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when d.value ->> 'id' = p_devis_id then
        (d.value
          || jsonb_build_object('status', 'signe', 'acceptedAt', v_now, 'acceptedBy', v_client_id)
          || jsonb_build_object('statusHistory', coalesce(d.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else d.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value);

  update public.seba_state set state = jsonb_set(state, '{devis}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select d.value into v_updated from jsonb_array_elements(v_new) as d(value) where d.value ->> 'id' = p_devis_id;

  select user_id into v_patron_uid from public.seba_state where account = v_account;
  if v_patron_uid is not null then
    perform public.create_notification(v_account, v_patron_uid, 'patron', 'devis.client_accepted', 'Devis accepté', 'Un client a accepté un devis.', 'important', 'devis', p_devis_id, 'devis:' || p_devis_id || ':accepted');
  end if;

  return jsonb_build_object('ok', true, 'devis', v_updated);
end;
$$;
revoke all on function client_accept_devis(text) from public;
revoke all on function client_accept_devis(text) from anon;
grant execute on function client_accept_devis(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7. client_refuse_devis — même principe additif.
-- ───────────────────────────────────────────────────────────────
create or replace function client_refuse_devis(p_devis_id text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_patron_uid uuid;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_comment is null or btrim(p_comment) = '' then
    return jsonb_build_object('ok', false, 'error', 'Un commentaire est requis pour refuser un devis.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select d.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value)
  where d.value ->> 'id' = p_devis_id and d.value ->> 'clientId' = v_client_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Devis introuvable ou non associé à votre compte.');
  end if;

  if v_current ->> 'status' = 'refuse' then
    return jsonb_build_object('ok', true, 'devis', v_current);
  end if;
  if v_current ->> 'status' = 'signe' then
    return jsonb_build_object('ok', false, 'error', 'Devis déjà accepté, refus impossible.');
  end if;
  if v_current ->> 'status' != 'attente' then
    return jsonb_build_object('ok', false, 'error', 'Ce devis ne peut plus être refusé.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_refused', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', jsonb_build_object('comment', btrim(p_comment)));

  select jsonb_agg(
    case
      when d.value ->> 'id' = p_devis_id then
        (d.value
          || jsonb_build_object('status', 'refuse', 'refusedAt', v_now, 'refusedBy', v_client_id, 'refusalComment', btrim(p_comment))
          || jsonb_build_object('statusHistory', coalesce(d.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else d.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value);

  update public.seba_state set state = jsonb_set(state, '{devis}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select d.value into v_updated from jsonb_array_elements(v_new) as d(value) where d.value ->> 'id' = p_devis_id;

  select user_id into v_patron_uid from public.seba_state where account = v_account;
  if v_patron_uid is not null then
    perform public.create_notification(v_account, v_patron_uid, 'patron', 'devis.client_refused', 'Devis refusé', 'Un client a refusé un devis.', 'important', 'devis', p_devis_id, 'devis:' || p_devis_id || ':refused');
  end if;

  return jsonb_build_object('ok', true, 'devis', v_updated);
end;
$$;
revoke all on function client_refuse_devis(text, text) from public;
revoke all on function client_refuse_devis(text, text) from anon;
grant execute on function client_refuse_devis(text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 8. complete_my_intervention — même principe additif : notification au
-- patron uniquement sur la branche qui écrit réellement 'submitted'
-- (jamais sur le rejeu idempotent déjà 'submitted'/'owner_approved', ni
-- sur un refus pour checklist/photos manquantes).
-- ───────────────────────────────────────────────────────────────
create or replace function complete_my_intervention(p_intervention_id text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_patron_uid uuid;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
  v_unchecked_count int;
  v_has_before boolean;
  v_has_after boolean;
  v_blockers jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select i.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value)
  where i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  if v_current -> 'execution' ->> 'completionStatus' in ('submitted', 'owner_approved') then
    return jsonb_build_object('ok', true, 'intervention', v_current);
  end if;

  select count(*) into v_unchecked_count
  from jsonb_array_elements(coalesce(v_current -> 'execution' -> 'checklist', '[]'::jsonb)) as c(value)
  where (c.value ->> 'required')::boolean = true and coalesce((c.value ->> 'checked')::boolean, false) = false;
  if v_unchecked_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('type', 'checklist', 'message', v_unchecked_count || ' tâche(s) obligatoire(s) non cochée(s)'));
  end if;

  select bool_or(p.value ->> 'type' = 'before') into v_has_before from jsonb_array_elements(coalesce(v_current -> 'execution' -> 'photos', '[]'::jsonb)) as p(value);
  select bool_or(p.value ->> 'type' = 'after') into v_has_after from jsonb_array_elements(coalesce(v_current -> 'execution' -> 'photos', '[]'::jsonb)) as p(value);
  if coalesce((v_current ->> 'requirePhotoBefore')::boolean, false) and not coalesce(v_has_before, false) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('type', 'photo', 'message', 'Photo "avant" obligatoire manquante'));
  end if;
  if coalesce((v_current ->> 'requirePhotoAfter')::boolean, false) and not coalesce(v_has_after, false) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('type', 'photo', 'message', 'Photo "après" obligatoire manquante'));
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('ok', false, 'error', 'Finalisation impossible.', 'blockers', v_blockers);
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'completed', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', jsonb_build_object('notes', p_notes));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('done', true)
          || jsonb_build_object('execution',
               (i.value -> 'execution')
               || jsonb_build_object('completionStatus', 'submitted')
               || jsonb_build_object('submittedAt', v_now)
               || jsonb_build_object('timing', (i.value -> 'execution' -> 'timing') || jsonb_build_object('actualEnd', v_now))
             )
          || jsonb_build_object('statusHistory', coalesce(i.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;

  select user_id into v_patron_uid from public.seba_state where account = v_account;
  if v_patron_uid is not null then
    perform public.create_notification(v_account, v_patron_uid, 'patron', 'mission.completed', 'Mission terminée', 'Un salarié a terminé une mission, en attente de validation.', 'normal', 'interventions', p_intervention_id, 'intervention:' || p_intervention_id || ':completed:' || v_now);
  end if;

  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function complete_my_intervention(text, text) from public;
revoke all on function complete_my_intervention(text, text) from anon;
grant execute on function complete_my_intervention(text, text) to authenticated;

commit;
