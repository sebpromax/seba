-- ═══════════════════════════════════════════════════════════════
-- SEBA — Clôture de mission côté employé (espace-terrain.html), 2026-07-20
--
-- L'employé n'a AUCUN droit d'écriture direct ni sur seba_state
-- (state_update exige auth.uid() = user_id, celui du PATRON) ni sur
-- client_requests (client_requests_update, meme raison) -- exactement le
-- meme mur que pour la LECTURE du planning, déjà contourné par la RPC
-- get_my_employee_interventions (SECURITY DEFINER). Cette fonction fait
-- l'équivalent en ÉCRITURE, restreinte aux missions ACTUELLEMENT
-- assignées à l'appelant (même vérification employe_accounts que
-- get_my_employee_interventions).
--
-- Reconstruit tout le tableau interventions (jamais un jsonb_set
-- positionnel par index -- l'ordre du tableau n'est pas garanti stable
-- côté client) en fusionnant uniquement l'élément ciblé. Si l'intervention
-- a un requestId (créée via assignation.html), la client_request liée
-- passe aussi "terminee" dans la même transaction.
-- ═══════════════════════════════════════════════════════════════

create or replace function close_my_intervention(_intervention_id text, _rapport text, _photo_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_state jsonb;
  v_new_interventions jsonb;
  v_found boolean := false;
  v_request_id text;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select state into v_state from seba_state where account = v_link.account for update;
  if v_state is null then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable.');
  end if;

  select
    jsonb_agg(
      case
        when i ->> 'id' = _intervention_id and i ->> 'employeId' = v_link.employe_id
        then i || jsonb_build_object('done', true, 'rapport', _rapport, 'rapportPhotoName', _photo_name)
        else i
      end
    ),
    bool_or(i ->> 'id' = _intervention_id and i ->> 'employeId' = v_link.employe_id)
  into v_new_interventions, v_found
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) i;

  if not v_found then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  update seba_state
  set state = jsonb_set(state, '{interventions}', coalesce(v_new_interventions, '[]'::jsonb)),
      updated_at = now()
  where account = v_link.account;

  select i ->> 'requestId' into v_request_id
  from jsonb_array_elements(v_new_interventions) i
  where i ->> 'id' = _intervention_id;

  if v_request_id is not null then
    update client_requests
    set statut = 'terminee', updated_at = now()
    where id = v_request_id::uuid and account = v_link.account;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function close_my_intervention(text, text, text) from public;
grant execute on function close_my_intervention(text, text, text) to authenticated;
