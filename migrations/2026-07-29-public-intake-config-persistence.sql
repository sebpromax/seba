-- ═══════════════════════════════════════════════════════════════
-- SEBA — SETTINGS-BRAND-001 : persistance réelle de la configuration
-- "Demande en ligne" (reglages.html, onglet Demande en ligne).
--
-- CAUSE RÉELLE : SebaDB.publicIntake.setConfig() (docs/seba-data.js)
-- n'appelait que persist() -- écrit UNIQUEMENT le cache local, exactement
-- le même défaut d'architecture que celui corrigé pour "entreprise" par
-- migrations/2026-07-29-update-my-entreprise.sql (objet unique, hors du
-- contrat pushOp()/sync-push qui ne couvre que les collections tableau).
-- La configuration réellement lue par le patron reste seba_state.state.
-- publicIntakeConfig -- exactement le champ que l'Edge Function
-- public-intake lit en base (supabase/functions/public-intake/index.ts,
-- handleConfig()) pour décider si le formulaire public est actif et
-- comment l'afficher. Conséquence concrète : AUCUNE modification faite
-- dans Réglages n'atteignait jamais le serveur -- le formulaire public
-- restait bloqué sur cfg=null ("Formulaire désactivé", 404) quel que
-- soit ce que le patron activait/configurait côté navigateur (remonté
-- fondateur : "certaines propositions dans Demandes en ligne semblent
-- présentes mais ne fonctionnent pas").
--
-- FIX : même schéma que update_my_entreprise -- RPC dédiée, écriture
-- authentifiée directe (jamais service_role), SECURITY INVOKER (la
-- policy RLS "state_update" existante suffit).
-- ═══════════════════════════════════════════════════════════════

create or replace function public.update_my_public_intake_config(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_new jsonb;
  v_allowed_keys text[] := array['enabled', 'title', 'introduction', 'allowedServiceIds', 'requireAddress', 'allowPreferredDate', 'confirmationMessage'];
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'update_my_public_intake_config: authentification requise'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'update_my_public_intake_config: patch invalide (objet requis)'
      using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed_keys)) then
      raise exception 'update_my_public_intake_config: propriété inconnue ''%''', v_key
        using errcode = '22023';
    end if;
  end loop;

  if (p_patch ? 'enabled') and jsonb_typeof(p_patch -> 'enabled') <> 'boolean' then
    raise exception 'update_my_public_intake_config: enabled doit être un booléen' using errcode = '22023';
  end if;
  if (p_patch ? 'requireAddress') and jsonb_typeof(p_patch -> 'requireAddress') <> 'boolean' then
    raise exception 'update_my_public_intake_config: requireAddress doit être un booléen' using errcode = '22023';
  end if;
  if (p_patch ? 'allowPreferredDate') and jsonb_typeof(p_patch -> 'allowPreferredDate') <> 'boolean' then
    raise exception 'update_my_public_intake_config: allowPreferredDate doit être un booléen' using errcode = '22023';
  end if;
  if (p_patch ->> 'title') is not null and length(p_patch ->> 'title') > 200 then
    raise exception 'update_my_public_intake_config: titre trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'introduction') is not null and length(p_patch ->> 'introduction') > 2000 then
    raise exception 'update_my_public_intake_config: introduction trop longue' using errcode = '22023';
  end if;
  if (p_patch ->> 'confirmationMessage') is not null and length(p_patch ->> 'confirmationMessage') > 2000 then
    raise exception 'update_my_public_intake_config: message de confirmation trop long' using errcode = '22023';
  end if;
  if (p_patch ? 'allowedServiceIds') then
    if jsonb_typeof(p_patch -> 'allowedServiceIds') <> 'array' then
      raise exception 'update_my_public_intake_config: allowedServiceIds doit être un tableau' using errcode = '22023';
    end if;
    if jsonb_array_length(p_patch -> 'allowedServiceIds') > 200 then
      raise exception 'update_my_public_intake_config: trop de services sélectionnés' using errcode = '22023';
    end if;
  end if;

  -- publicIntakeConfig est initialisé à un NULL JSON explicite au
  -- bootstrap (pas {} -- voir migrations/2026-07-28-account-activation-
  -- bootstrap.sql), pas un NULL SQL : coalesce(x, '{}') ne le remplace
  -- JAMAIS (coalesce ne réagit qu'au NULL SQL, un scalaire jsonb 'null'
  -- est une valeur comme une autre pour lui). Sans nullif ici, l'opérateur
  -- || traite un scalaire jsonb comme un tableau à un élément : le
  -- résultat devenait [null, {...}] au lieu de {...} -- confirmé en
  -- testant réellement l'appel (jamais un cas hypothétique).
  update public.seba_state
  set state = jsonb_set(
        state, '{publicIntakeConfig}',
        coalesce(nullif(state -> 'publicIntakeConfig', 'null'::jsonb), '{}'::jsonb) || p_patch,
        true
      ),
      updated_at = now()
  where user_id = auth.uid()
  returning state -> 'publicIntakeConfig' into v_new;

  if v_new is null then
    raise exception 'update_my_public_intake_config: compte introuvable pour cet utilisateur'
      using errcode = '22023';
  end if;

  return v_new;
end;
$$;

revoke all on function public.update_my_public_intake_config(jsonb) from public;
revoke all on function public.update_my_public_intake_config(jsonb) from anon;
grant execute on function public.update_my_public_intake_config(jsonb) to authenticated;
