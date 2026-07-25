-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Intervention 360 (feature/intervention-360).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique. Ne modifie AUCUNE RPC/policy déjà existante --
-- get_my_employee_interventions(), update_my_employee_intervention_status(),
-- close_my_intervention(), submit_my_intervention_field_report()
-- restent intactes. EXCEPTION UNIQUE, en toute fin de fichier :
-- get_my_client_interventions() (migrations/2026-07-23-client-portal-data-rls.sql)
-- est resserrée (CREATE OR REPLACE) -- avant Intervention 360 elle
-- renvoyait la ligne intervention brute sans risque (aucune donnée
-- interne dedans) ; maintenant que le modèle ajoute execution.checklist/
-- materials/incidents et des photos non visibleToClient, cette même RPC
-- deviendrait une fuite si elle restait inchangée. Voir sa section dédiée
-- plus bas pour le détail complet.
--
-- OBJET : une intervention devient un dossier opérationnel complet
-- (intervention.execution : checklist/timing/photos/materials/incidents/
-- clientApproval/completionStatus, intervention.statusHistory[]) partagé
-- entre patron/employé/client. Le patron a un accès direct (déjà couvert
-- par les policies RLS existantes sur seba_state, aucune RPC nécessaire
-- côté patron — voir SebaDB.interventions.* dans docs/seba-data.js).
-- Les RPC ci-dessous couvrent UNIQUEMENT les écritures employé/client,
-- qui n'ont aucun accès direct à seba_state (RLS bloque tout, comme le
-- reste de leurs portails).
--
-- SÉCURITÉ (identique au modèle déjà audité cette session --
-- update_my_employee_intervention_status/submit_my_intervention_field_report/
-- get_my_client_*) pour CHAQUE RPC ci-dessous :
--   1. auth.uid() null -> refus contrôlé immédiat ;
--   2. rattachement retrouvé via employe_accounts (employé) ou
--      client_accounts (client), jamais un account fourni par le
--      navigateur ;
--   3. écriture : verrou FOR UPDATE sur la ligne seba_state ciblée ;
--   4. l'intervention doit exister ET être assignée à CET employé
--      (employeId) ou appartenir à CE client (clientId) -- jamais
--      account seul, jamais une autre mission ;
--   5. valeurs contrôlées côté serveur contre une liste fermée quand
--      applicable (outcome/issueType/type photo) -- jamais une valeur
--      arbitraire du navigateur ;
--   6. chaque RPC ne modifie QUE les champs qu'elle est censée modifier
--      (execution.xxx ciblé, jamais client/prix/employé assigné) ;
--   7. search_path resserré à pg_catalog, pg_temp ;
--   8. REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul
--      rôle authenticated.
--
-- IDEMPOTENCE : chaque écriture est un remplacement de valeur (checked=
-- true, completionStatus='in_progress', etc.), jamais une opération
-- relative (pas de +=1) sauf pausedDurationMinutes qui ACCUMULE
-- volontairement (plusieurs pauses possibles) -- rejouer un appel identique
-- ne crée jamais de doublon d'état, seul statusHistory grandit à chaque
-- VRAI événement (jamais un doublon d'événement pour un appel qui échoue
-- avant d'écrire : toute vérification a lieu AVANT toute mutation).
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. get_my_employee_intervention_detail — lecture complète d'UNE mission
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_employee_intervention_detail(p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_item jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea
  where ea.employe_user_id = v_uid;

  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  -- Enrichit l'adresse depuis la fiche client -- même jointure que
  -- get_my_employee_interventions() (migrations/2026-07-23-employee-portal-missions.sql),
  -- jamais stockée directement sur l'intervention. Sans ça, le détail
  -- d'une mission perdrait l'adresse que la liste affiche déjà (itinéraire).
  select i.value || jsonb_build_object('adresse', c.value ->> 'adresse') into v_item
  from public.seba_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) as i(value)
  left join lateral (
    select c.value
    from jsonb_array_elements(coalesce(s.state -> 'clients', '[]'::jsonb)) as c(value)
    where c.value ->> 'id' = i.value ->> 'clientId'
    limit 1
  ) c on true
  where s.account = v_account
    and i.value ->> 'id' = p_intervention_id
    and i.value ->> 'employeId' = v_employe_id
  limit 1;

  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  return jsonb_build_object('ok', true, 'intervention', v_item);
end;
$$;
revoke all on function get_my_employee_intervention_detail(text) from public;
revoke all on function get_my_employee_intervention_detail(text) from anon;
grant execute on function get_my_employee_intervention_detail(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. start_my_intervention
-- ───────────────────────────────────────────────────────────────
create or replace function start_my_intervention(p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
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

  -- Rejeu idempotent (retry réseau) : la mission est déjà démarrée
  -- (in_progress/paused/submitted/owner_approved) -> aucun nouvel
  -- événement, retourne l'état actuel tel quel (jamais de doublon
  -- 'started' dans statusHistory, jamais d'écrasement de actualStart).
  if coalesce(v_current -> 'execution' ->> 'completionStatus', 'not_started') != 'not_started' then
    return jsonb_build_object('ok', true, 'intervention', v_current);
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'started', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('statut', 'en_cours')
          || jsonb_build_object('execution',
               coalesce(i.value -> 'execution', '{}'::jsonb)
               || jsonb_build_object('completionStatus', 'in_progress')
               || jsonb_build_object('timing', coalesce(i.value -> 'execution' -> 'timing', '{}'::jsonb) || jsonb_build_object('actualStart', v_now))
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
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function start_my_intervention(text) from public;
revoke all on function start_my_intervention(text) from anon;
grant execute on function start_my_intervention(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. pause_my_intervention
-- ───────────────────────────────────────────────────────────────
create or replace function pause_my_intervention(p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
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
  if v_current -> 'execution' -> 'timing' -> 'actualStart' is null or v_current -> 'execution' -> 'timing' ->> 'actualStart' = '' then
    return jsonb_build_object('ok', false, 'error', 'La mission n''a pas encore démarré.');
  end if;
  if v_current -> 'execution' -> 'timing' ->> 'pausedAt' is not null then
    return jsonb_build_object('ok', false, 'error', 'Mission déjà en pause.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'paused', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution',
               (i.value -> 'execution')
               || jsonb_build_object('completionStatus', 'paused')
               || jsonb_build_object('timing', (i.value -> 'execution' -> 'timing') || jsonb_build_object('pausedAt', v_now))
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
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function pause_my_intervention(text) from public;
revoke all on function pause_my_intervention(text) from anon;
grant execute on function pause_my_intervention(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4. resume_my_intervention
-- ───────────────────────────────────────────────────────────────
create or replace function resume_my_intervention(p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
  v_paused_minutes numeric;
  v_prior_minutes numeric;
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
  if v_current -> 'execution' -> 'timing' ->> 'pausedAt' is null then
    return jsonb_build_object('ok', false, 'error', 'Mission non en pause.');
  end if;

  v_paused_minutes := greatest(0, extract(epoch from (now() - (v_current -> 'execution' -> 'timing' ->> 'pausedAt')::timestamptz)) / 60);
  v_prior_minutes := coalesce((v_current -> 'execution' -> 'timing' ->> 'pausedDurationMinutes')::numeric, 0);

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'resumed', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution',
               (i.value -> 'execution')
               || jsonb_build_object('completionStatus', 'in_progress')
               || jsonb_build_object('timing',
                    ((i.value -> 'execution' -> 'timing') - 'pausedAt')
                    || jsonb_build_object('pausedDurationMinutes', round(v_prior_minutes + v_paused_minutes))
                  )
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
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function resume_my_intervention(text) from public;
revoke all on function resume_my_intervention(text) from anon;
grant execute on function resume_my_intervention(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5. update_my_intervention_checklist — coche/décoche + note UNE tâche
-- (l'employé ne peut jamais ajouter/retirer une tâche, seulement modifier
-- son état -- création de la checklist réservée au patron)
-- ───────────────────────────────────────────────────────────────
create or replace function update_my_intervention_checklist(p_intervention_id text, p_item_id text, p_checked boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_item_exists boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  select bool_or(c.value ->> 'id' = p_item_id)
  into v_item_exists
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value)
  cross join lateral jsonb_array_elements(coalesce(i.value -> 'execution' -> 'checklist', '[]'::jsonb)) as c(value)
  where i.value ->> 'id' = p_intervention_id;
  if not coalesce(v_item_exists, false) then
    return jsonb_build_object('ok', false, 'error', 'Tâche introuvable.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'checklist_updated', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', jsonb_build_object('itemId', p_item_id, 'checked', p_checked));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution',
               (i.value -> 'execution') || jsonb_build_object('checklist',
                 (
                   select jsonb_agg(
                     case
                       when c.value ->> 'id' = p_item_id then
                         c.value
                         || jsonb_build_object('checked', p_checked)
                         || jsonb_build_object('checkedAt', case when p_checked then v_now else null end)
                         || jsonb_build_object('checkedBy', case when p_checked then v_employe_id else null end)
                         || jsonb_build_object('note', coalesce(p_note, c.value ->> 'note', ''))
                       else c.value
                     end
                   )
                   from jsonb_array_elements(coalesce(i.value -> 'execution' -> 'checklist', '[]'::jsonb)) as c(value)
                 )
               )
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
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function update_my_intervention_checklist(text, text, boolean, text) from public;
revoke all on function update_my_intervention_checklist(text, text, boolean, text) from anon;
grant execute on function update_my_intervention_checklist(text, text, boolean, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 6. add_my_intervention_material
-- ───────────────────────────────────────────────────────────────
create or replace function add_my_intervention_material(p_intervention_id text, p_label text, p_quantity text, p_unit text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_material jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_label is null or btrim(p_label) = '' then return jsonb_build_object('ok', false, 'error', 'Nom du matériau requis.'); end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  v_material := jsonb_build_object('id', gen_random_uuid()::text, 'label', btrim(p_label), 'quantity', p_quantity, 'unit', p_unit, 'note', coalesce(p_note, ''));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        i.value || jsonb_build_object('execution',
          (i.value -> 'execution') || jsonb_build_object('materials', coalesce(i.value -> 'execution' -> 'materials', '[]'::jsonb) || jsonb_build_array(v_material))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function add_my_intervention_material(text, text, text, text, text) from public;
revoke all on function add_my_intervention_material(text, text, text, text, text) from anon;
grant execute on function add_my_intervention_material(text, text, text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7. submit_my_intervention_incident
-- ───────────────────────────────────────────────────────────────
create or replace function submit_my_intervention_incident(p_intervention_id text, p_type text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_incident jsonb;
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_type is null or p_type not in ('access', 'client_absent', 'equipment', 'damage', 'quality', 'delay', 'other') then
    return jsonb_build_object('ok', false, 'error', 'Type d''incident non autorisé.');
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  v_incident := jsonb_build_object('id', gen_random_uuid()::text, 'type', p_type, 'description', coalesce(btrim(p_description), ''), 'reportedAt', v_now, 'reportedBy', v_employe_id);
  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'incident_reported', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', jsonb_build_object('type', p_type));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution', (i.value -> 'execution') || jsonb_build_object('incidents', coalesce(i.value -> 'execution' -> 'incidents', '[]'::jsonb) || jsonb_build_array(v_incident)))
          || jsonb_build_object('statusHistory', coalesce(i.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function submit_my_intervention_incident(text, text, text) from public;
revoke all on function submit_my_intervention_incident(text, text, text) from anon;
grant execute on function submit_my_intervention_incident(text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 8. add_my_intervention_photo — non listée explicitement dans les 8 RPC
-- employé de la commande, mais requise par la section 3 ("prendre ou
-- joindre des photos avant/après") : aucune des 8 RPC listées ne couvre
-- l'ajout de métadonnée photo. Ajout minimal et nécessaire, même modèle
-- de sécurité que les autres. Le FICHIER lui-même est uploadé directement
-- par l'employé (son propre JWT, policies RLS du bucket -- voir section
-- storage plus bas) ; cette RPC persiste uniquement la métadonnée dans
-- seba_state une fois l'upload réussi. visibleToClient : true pour les
-- photos "after" (preuve de travail terminé, montrable), false sinon
-- (before/during/incident restent internes par défaut -- le patron peut
-- changer cela depuis intervention-fiche.html, action patron directe,
-- aucune RPC nécessaire pour ça).
-- ───────────────────────────────────────────────────────────────
create or replace function add_my_intervention_photo(p_intervention_id text, p_type text, p_storage_path text, p_mime_type text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_photo jsonb;
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_type is null or p_type not in ('before', 'during', 'after', 'incident') then
    return jsonb_build_object('ok', false, 'error', 'Type de photo non autorisé.');
  end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then
    return jsonb_build_object('ok', false, 'error', 'Chemin de stockage manquant.');
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  v_photo := jsonb_build_object(
    'id', gen_random_uuid()::text, 'type', p_type, 'storagePath', p_storage_path, 'mimeType', p_mime_type,
    'createdAt', v_now, 'uploadedBy', v_employe_id, 'visibleToClient', (p_type = 'after')
  );
  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'photo_added', 'actorRole', 'employe', 'actorId', v_employe_id, 'createdAt', v_now, 'metadata', jsonb_build_object('type', p_type));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution', (i.value -> 'execution') || jsonb_build_object('photos', coalesce(i.value -> 'execution' -> 'photos', '[]'::jsonb) || jsonb_build_array(v_photo)))
          || jsonb_build_object('statusHistory', coalesce(i.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated, 'photo', v_photo);
end;
$$;
revoke all on function add_my_intervention_photo(text, text, text, text) from public;
revoke all on function add_my_intervention_photo(text, text, text, text) from anon;
grant execute on function add_my_intervention_photo(text, text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 9. complete_my_intervention — finalise l'EXÉCUTION, bloque si des
-- tâches obligatoires ne sont pas cochées ou des photos obligatoires
-- manquent (recalcul SERVEUR, jamais une confiance aveugle au bouton déjà
-- désactivé côté client -- même liste de blocages que
-- computeInterventionCompletionBlockers() côté JS, voir docs/seba-data.js).
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

  -- Rejeu idempotent (retry réseau) : déjà finalisée -> aucun nouvel
  -- événement 'completed', aucune écriture de submittedAt/actualEnd,
  -- retourne l'état actuel tel quel.
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
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function complete_my_intervention(text, text) from public;
revoke all on function complete_my_intervention(text, text) from anon;
grant execute on function complete_my_intervention(text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 10. get_my_client_intervention_detail — ALLOWLIST explicite (jamais un
-- filtrage par exclusion) : ne construit que les champs listés
-- ci-dessous, jamais la ligne brute -- garantit structurellement l'absence
-- de fuite de checklist/matériaux/incidents/notes internes/montants
-- (aucun de ces champs n'existe de toute façon sur l'objet intervention,
-- les données financières vivent dans devis/factures, jamais touchées
-- ici). Photos : uniquement celles avec visibleToClient = true.
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_client_intervention_detail(p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_item jsonb;
  v_safe jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.');
  end if;

  select i.value into v_item
  from public.seba_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) as i(value)
  where s.account = v_account
    and i.value ->> 'id' = p_intervention_id
    and i.value ->> 'clientId' = v_client_id
  limit 1;

  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'Intervention introuvable ou non associée à votre compte.');
  end if;

  v_safe := jsonb_build_object(
    'id', v_item ->> 'id', 'date', v_item ->> 'date', 'time', v_item ->> 'time', 'service', v_item ->> 'service',
    'adresse', v_item ->> 'adresse', 'employeName', v_item ->> 'employeName', 'statut', v_item ->> 'statut',
    'done', coalesce(v_item -> 'done', 'false'::jsonb),
    'rescheduleRequest', v_item -> 'rescheduleRequest',
    'execution', jsonb_build_object(
      'timing', v_item -> 'execution' -> 'timing',
      'completionStatus', v_item -> 'execution' -> 'completionStatus',
      'clientApproval', v_item -> 'execution' -> 'clientApproval',
      'photos', coalesce(
        (select jsonb_agg(p.value) from jsonb_array_elements(coalesce(v_item -> 'execution' -> 'photos', '[]'::jsonb)) as p(value)
         where coalesce((p.value ->> 'visibleToClient')::boolean, false) = true),
        '[]'::jsonb
      )
    )
  );

  return jsonb_build_object('ok', true, 'intervention', v_safe);
end;
$$;
revoke all on function get_my_client_intervention_detail(text) from public;
revoke all on function get_my_client_intervention_detail(text) from anon;
grant execute on function get_my_client_intervention_detail(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 11. request_my_intervention_reschedule
-- ───────────────────────────────────────────────────────────────
create or replace function request_my_intervention_reschedule(p_intervention_id text, p_preferred_date text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_req jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'clientId' = v_client_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Intervention introuvable ou non associée à votre compte.');
  end if;

  v_req := jsonb_build_object('requestedDate', p_preferred_date, 'comment', coalesce(btrim(p_comment), ''), 'requestedAt', v_now, 'status', 'pending');

  select jsonb_agg(
    case when i.value ->> 'id' = p_intervention_id then i.value || jsonb_build_object('rescheduleRequest', v_req) else i.value end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function request_my_intervention_reschedule(text, text, text) from public;
revoke all on function request_my_intervention_reschedule(text, text, text) from anon;
grant execute on function request_my_intervention_reschedule(text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 12. approve_my_completed_intervention — refuse explicitement tant que
-- completionStatus != 'submitted' ("ne peut pas approuver avant la fin de
-- la mission", règle explicite du chantier).
-- ───────────────────────────────────────────────────────────────
create or replace function approve_my_completed_intervention(p_intervention_id text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_approval jsonb;
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select i.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value)
  where i.value ->> 'id' = p_intervention_id and i.value ->> 'clientId' = v_client_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Intervention introuvable ou non associée à votre compte.');
  end if;
  if coalesce(v_current -> 'execution' ->> 'completionStatus', '') != 'submitted' then
    return jsonb_build_object('ok', false, 'error', 'La mission n''est pas encore terminée.');
  end if;

  v_approval := jsonb_build_object('status', 'approved', 'comment', coalesce(btrim(p_comment), ''), 'submittedAt', v_now, 'submittedBy', v_client_id);
  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_approved', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution', (i.value -> 'execution') || jsonb_build_object('clientApproval', v_approval))
          || jsonb_build_object('statusHistory', coalesce(i.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function approve_my_completed_intervention(text, text) from public;
revoke all on function approve_my_completed_intervention(text, text) from anon;
grant execute on function approve_my_completed_intervention(text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 13. report_my_intervention_issue — utilisée à la fois pour "signaler un
-- problème" (en cours de mission) et "refuser l'approbation avec un
-- commentaire" (après la fin) : même écriture sous-jacente
-- (execution.clientApproval.status = 'issue_reported'), pas de RPC
-- séparée pour ces deux usages -- la commande n'en liste que 4 côté
-- client, exactement respectée.
-- ───────────────────────────────────────────────────────────────
create or replace function report_my_intervention_issue(p_intervention_id text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_state jsonb;
  v_owned boolean := false;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_approval jsonb;
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_comment is null or btrim(p_comment) = '' then
    return jsonb_build_object('ok', false, 'error', 'Un commentaire est requis pour signaler un problème.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'clientId' = v_client_id)
  into v_owned from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);
  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Intervention introuvable ou non associée à votre compte.');
  end if;

  v_approval := jsonb_build_object('status', 'issue_reported', 'comment', btrim(p_comment), 'submittedAt', v_now, 'submittedBy', v_client_id);
  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_issue_reported', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', jsonb_build_object('comment', btrim(p_comment)));

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id then
        (i.value
          || jsonb_build_object('execution', (i.value -> 'execution') || jsonb_build_object('clientApproval', v_approval))
          || jsonb_build_object('statusHistory', coalesce(i.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else i.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state set state = jsonb_set(state, '{interventions}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select i.value into v_updated from jsonb_array_elements(v_new) as i(value) where i.value ->> 'id' = p_intervention_id;
  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function report_my_intervention_issue(text, text) from public;
revoke all on function report_my_intervention_issue(text, text) from anon;
grant execute on function report_my_intervention_issue(text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 14. Stockage des photos Intervention 360 -- bucket DÉDIÉ, distinct de
-- intervention-photos (Palier 2, QA visuelle IA, patron/service_role
-- uniquement -- pas de policy employé/client) et de mission-photos
-- (clôture legacy, keyé sur client_requests.id -- une intervention sans
-- requestId, comme celles générées par un plan récurrent, n'aurait AUCUNE
-- policy applicable dans ce bucket). Ni l'un ni l'autre ne satisfait le
-- modèle 3 rôles requis ici (patron propriétaire + employé assigné +
-- client uniquement si visibleToClient) -- bucket neuf plutôt que
-- détourner un système conçu pour un usage différent.
--
-- Chemin obligatoire : accounts/{account}/interventions/{interventionId}/{photoId}
-- (sans extension -- le MIME type réel est servi via Content-Type au
-- moment de l'upload, storage.foldername()/split_part() n'ont pas besoin
-- de parser une extension).
-- ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intervention360-photos', 'intervention360-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Helper SECURITY DEFINER -- INDISPENSABLE ICI, pas une simple préférence
-- de style : une policy RLS sur storage.objects s'évalue avec les
-- PRIVILÈGES DE L'APPELANT, jamais ceux du propriétaire de la fonction.
-- Une sous-requête inline vers seba_state à l'intérieur du WITH CHECK/USING
-- reste donc soumise à la policy state_select de seba_state elle-même
-- (auth.uid() = user_id, c-a-d le PATRON) -- pour un employé ou un client
-- (jamais propriétaires de la ligne), ce JOIN ne renvoie STRUCTURELLEMENT
-- jamais rien, quelle que soit la validité des données (confirmé
-- empiriquement : upload employé refusé par RLS malgré des données
-- correctes, avant ce correctif). SECURITY DEFINER contourne cette
-- RLS interne exactement comme les 13 RPC ci-dessus -- même garde-fous
-- (search_path resserré, revoke public/anon, grant authenticated seul).
-- p_check_client_visibility=false pour INSERT (l'employé/le patron
-- n'ont pas besoin de ce filtre), true pour SELECT (le client ne doit
-- voir QUE les photos visibleToClient=true).
create or replace function intervention360_photo_authorized(p_path text, p_check_client_visibility boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segments text[] := storage.foldername(p_path);
  v_account text := v_segments[2];
  v_intervention_id text := v_segments[4];
  v_photo_id text := split_part(p_path, '/', 5);
begin
  -- Validation STRICTE du chemin -- pas seulement les positions [2]/[4]
  -- (compte/intervention), aussi les segments littéraux et la profondeur
  -- exacte. Sans ça, un chemin de forme différente (ex. un sous-dossier
  -- supplémentaire, ou 'x/ACC/y/INTID/photoid' au lieu de
  -- 'accounts/ACC/interventions/INTID/photoid') passerait quand même
  -- l'autorisation par simple coïncidence de position -- jamais une
  -- fuite cross-compte en soi (l'autorisation reste vérifiée par
  -- correspondance réelle avec auth.uid() plus bas), mais un chemin qui
  -- ne respecte pas le format attendu par le reste du système.
  if v_uid is null
     or array_length(v_segments, 1) is distinct from 4
     or v_segments[1] is distinct from 'accounts'
     or v_segments[3] is distinct from 'interventions'
     or v_account is null or btrim(v_account) = ''
     or v_intervention_id is null or btrim(v_intervention_id) = ''
     or v_photo_id is null or btrim(v_photo_id) = ''
  then
    return false;
  end if;

  if exists (select 1 from public.seba_state s where s.account = v_account and s.user_id = v_uid) then
    return true;
  end if;

  if exists (
    select 1
    from public.employe_accounts ea
    join public.seba_state s on s.account = ea.account and s.account = v_account
    cross join lateral jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) as i(value)
    where ea.employe_user_id = v_uid
      and i.value ->> 'id' = v_intervention_id
      and i.value ->> 'employeId' = ea.employe_id
  ) then
    return true;
  end if;

  if p_check_client_visibility and exists (
    select 1
    from public.client_accounts ca
    join public.seba_state s on s.account = ca.account and s.account = v_account
    cross join lateral jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) as i(value)
    cross join lateral jsonb_array_elements(coalesce(i.value -> 'execution' -> 'photos', '[]'::jsonb)) as ph(value)
    where ca.client_user_id = v_uid
      and i.value ->> 'id' = v_intervention_id
      and i.value ->> 'clientId' = ca.client_id
      and ph.value ->> 'id' = v_photo_id
      and coalesce((ph.value ->> 'visibleToClient')::boolean, false) = true
  ) then
    return true;
  end if;

  return false;
end;
$$;
revoke all on function intervention360_photo_authorized(text, boolean) from public;
revoke all on function intervention360_photo_authorized(text, boolean) from anon;
grant execute on function intervention360_photo_authorized(text, boolean) to authenticated;

-- INSERT : patron (propriétaire du compte) OU employé assigné à
-- l'intervention ciblée par le chemin. (storage.foldername(name)) pour
-- 'accounts/ACC/interventions/INTID/PHOTOID' -> [1]='accounts', [2]='ACC',
-- [3]='interventions', [4]='INTID'.
drop policy if exists "intervention360_photos_insert" on storage.objects;
create policy "intervention360_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'intervention360-photos' and intervention360_photo_authorized(name, false));

-- SELECT : patron OU employé assigné OU client SEULEMENT si la photo
-- (photoId = nom du fichier, dernier segment du chemin) est marquée
-- visibleToClient=true dans le JSON de l'intervention.
drop policy if exists "intervention360_photos_select" on storage.objects;
create policy "intervention360_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'intervention360-photos' and intervention360_photo_authorized(name, true));

-- DELETE : patron uniquement (suppression sécurisée, jamais l'employé ni
-- le client -- une photo déjà envoyée reste une preuve, seul le
-- propriétaire du compte peut la retirer).
drop policy if exists "intervention360_photos_delete" on storage.objects;
create policy "intervention360_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'intervention360-photos'
    and exists (select 1 from public.seba_state s where s.account = (storage.foldername(name))[2] and s.user_id = auth.uid())
  );

-- ───────────────────────────────────────────────────────────────
-- 15. get_my_client_interventions() -- RESSERRÉE (pas un ajout, une
-- correction). Définie dans migrations/2026-07-23-client-portal-data-rls.sql
-- AVANT Intervention 360, elle renvoyait `i.value` -- la ligne
-- intervention BRUTE -- sans risque à l'époque (l'objet ne contenait
-- aucune donnée interne). Depuis ce fichier, la même ligne porte
-- execution.checklist/materials/incidents et des photos non
-- visibleToClient : la laisser inchangée en ferait une fuite (le JSON
-- brut part sur le réseau vers le navigateur du client, lu ou non par
-- l'UI actuelle). Même allowlist explicite que get_my_client_intervention_detail
-- ci-dessus, appliquée ici à CHAQUE élément de la liste -- aucun champ
-- financier n'existe de toute façon sur l'objet intervention (montants
-- dans devis/factures, jamais touchés ici).
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_client_interventions()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.value ->> 'id', 'date', i.value ->> 'date', 'time', i.value ->> 'time', 'service', i.value ->> 'service',
        'adresse', i.value ->> 'adresse', 'employeName', i.value ->> 'employeName', 'statut', i.value ->> 'statut',
        'done', coalesce(i.value -> 'done', 'false'::jsonb),
        'rescheduleRequest', i.value -> 'rescheduleRequest',
        'execution', jsonb_build_object(
          'timing', i.value -> 'execution' -> 'timing',
          'completionStatus', i.value -> 'execution' -> 'completionStatus',
          'clientApproval', i.value -> 'execution' -> 'clientApproval',
          'photos', coalesce(
            (select jsonb_agg(p.value) from jsonb_array_elements(coalesce(i.value -> 'execution' -> 'photos', '[]'::jsonb)) as p(value)
             where coalesce((p.value ->> 'visibleToClient')::boolean, false) = true),
            '[]'::jsonb
          )
        )
      )
    ),
    '[]'::jsonb
  ) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'interventions') as i(value)
  where s.account = v_account
    and i.value ->> 'clientId' = v_client_id;

  return v_items;
end;
$$;
revoke all on function get_my_client_interventions() from public;
revoke all on function get_my_client_interventions() from anon;
grant execute on function get_my_client_interventions() to authenticated;

commit;
