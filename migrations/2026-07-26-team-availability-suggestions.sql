-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Team availability + suggestions
-- (feature/team-availability-suggestions).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique.
--
-- OBJET : demandes d'indisponibilité employé (unavailabilityRequests,
-- nouveau champ sur l'objet employé existant dans seba_state.state.employes[],
-- jamais un second objet). Le patron a un accès direct (policies RLS
-- existantes sur seba_state, aucune RPC nécessaire côté patron -- lecture/
-- écriture patron via SebaDB.employes.*, docs/seba-data.js). Les 2 RPC
-- ci-dessous couvrent UNIQUEMENT l'écriture employé (créer sa propre
-- demande, l'annuler tant qu'elle est pending), qui n'a aucun accès direct
-- à seba_state (RLS bloque tout, comme le reste de son portail).
--
-- LECTURE : AUCUNE nouvelle RPC -- get_my_employee_profile() (baseline,
-- supabase-schema.sql) renvoie déjà l'objet employé COMPLET (jamais un
-- allowlist : l'employé est du personnel de confiance, contrairement au
-- client), donc unavailabilityRequests y est déjà exposé sans rien changer
-- ici. Vérifié : cette RPC fait `select e into v_employe from ... e ->> 'id'
-- = v_link.employe_id`, aucune projection de champs.
--
-- SÉCURITÉ (identique au modèle déjà audité -- Intervention 360,
-- quote-to-cash) pour CHAQUE RPC ci-dessous :
--   1. auth.uid() null -> refus contrôlé immédiat ;
--   2. rattachement retrouvé via employe_accounts, jamais un account/
--      employeId fourni par le navigateur ;
--   3. verrou FOR UPDATE sur la ligne seba_state ciblée ;
--   4. modifie UNIQUEMENT unavailabilityRequests de LA fiche employé du
--      demandeur -- jamais un autre employé, jamais un autre champ ;
--   5. valeurs contrôlées côté serveur (dates valides, startDate<=endDate,
--      motif non vide, statut cible jamais arbitraire) ;
--   6. search_path resserré à pg_catalog, pg_temp ;
--   7. REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul
--      rôle authenticated.
--
-- IDEMPOTENCE : annuler une demande déjà 'cancelled' est un no-op qui
-- renvoie ok=true sans réécrire (rejeu de retry réseau sûr, jamais un
-- double événement).
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. create_my_unavailability_request
-- ───────────────────────────────────────────────────────────────
create or replace function create_my_unavailability_request(p_start_date text, p_end_date text, p_reason text)
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
  v_employe jsonb;
  v_start date;
  v_end date;
  v_new_req jsonb;
  v_new_employes jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'Motif requis.');
  end if;

  begin
    v_start := p_start_date::date;
    v_end := p_end_date::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Dates invalides.');
  end;
  if v_start > v_end then
    return jsonb_build_object('ok', false, 'error', 'La date de début doit précéder ou égaler la date de fin.');
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select e.value into v_employe
  from jsonb_array_elements(coalesce(v_state -> 'employes', '[]'::jsonb)) as e(value)
  where e.value ->> 'id' = v_employe_id;
  if v_employe is null then return jsonb_build_object('ok', false, 'error', 'Fiche employé introuvable.'); end if;

  v_new_req := jsonb_build_object(
    'id', gen_random_uuid()::text, 'startDate', p_start_date, 'endDate', p_end_date, 'reason', btrim(p_reason),
    'status', 'pending', 'createdAt', v_now, 'reviewedAt', null, 'reviewedBy', null, 'reviewComment', null
  );

  select jsonb_agg(
    case
      when e.value ->> 'id' = v_employe_id then
        e.value || jsonb_build_object(
          'unavailabilityRequests',
          coalesce(e.value -> 'unavailabilityRequests', '[]'::jsonb) || jsonb_build_array(v_new_req)
        )
      else e.value
    end
  ) into v_new_employes
  from jsonb_array_elements(coalesce(v_state -> 'employes', '[]'::jsonb)) as e(value);

  update public.seba_state set state = jsonb_set(state, '{employes}', coalesce(v_new_employes, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  return jsonb_build_object('ok', true, 'request', v_new_req);
end;
$$;
revoke all on function create_my_unavailability_request(text, text, text) from public;
revoke all on function create_my_unavailability_request(text, text, text) from anon;
grant execute on function create_my_unavailability_request(text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. cancel_my_unavailability_request
-- ───────────────────────────────────────────────────────────────
create or replace function cancel_my_unavailability_request(p_request_id text)
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
  v_employe jsonb;
  v_current_req jsonb;
  v_new_employes jsonb;
  v_updated_req jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea where ea.employe_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select e.value into v_employe
  from jsonb_array_elements(coalesce(v_state -> 'employes', '[]'::jsonb)) as e(value)
  where e.value ->> 'id' = v_employe_id;
  if v_employe is null then return jsonb_build_object('ok', false, 'error', 'Fiche employé introuvable.'); end if;

  select r.value into v_current_req
  from jsonb_array_elements(coalesce(v_employe -> 'unavailabilityRequests', '[]'::jsonb)) as r(value)
  where r.value ->> 'id' = p_request_id;
  if v_current_req is null then
    return jsonb_build_object('ok', false, 'error', 'Demande introuvable ou non associée à votre compte.');
  end if;

  -- Rejeu idempotent : déjà annulée -> no-op, retourne l'état actuel.
  if v_current_req ->> 'status' = 'cancelled' then
    return jsonb_build_object('ok', true, 'request', v_current_req);
  end if;
  if v_current_req ->> 'status' != 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Impossible d''annuler une demande déjà traitée.');
  end if;

  v_updated_req := v_current_req || jsonb_build_object('status', 'cancelled', 'reviewedAt', v_now);

  select jsonb_agg(
    case
      when e.value ->> 'id' = v_employe_id then
        e.value || jsonb_build_object(
          'unavailabilityRequests',
          (
            select coalesce(jsonb_agg(case when r.value ->> 'id' = p_request_id then v_updated_req else r.value end), '[]'::jsonb)
            from jsonb_array_elements(coalesce(e.value -> 'unavailabilityRequests', '[]'::jsonb)) as r(value)
          )
        )
      else e.value
    end
  ) into v_new_employes
  from jsonb_array_elements(coalesce(v_state -> 'employes', '[]'::jsonb)) as e(value);

  update public.seba_state set state = jsonb_set(state, '{employes}', coalesce(v_new_employes, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  return jsonb_build_object('ok', true, 'request', v_updated_req);
end;
$$;
revoke all on function cancel_my_unavailability_request(text) from public;
revoke all on function cancel_my_unavailability_request(text) from anon;
grant execute on function cancel_my_unavailability_request(text) to authenticated;

commit;
