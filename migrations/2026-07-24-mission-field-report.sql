-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : retour terrain structuré (fieldReport) sur
-- une intervention (feature/client-crm-advanced, SEBA CLIENT MEMORY &
-- MISSION INTELLIGENCE).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique. Ne modifie AUCUNE RPC/policy déjà existante, en
-- particulier close_my_intervention(...) (baseline, section 36) : cette
-- RPC-ci est un AJOUT pur, jamais un remplacement.
--
-- POURQUOI UNE RPC SÉPARÉE DE close_my_intervention : close_my_intervention
-- gère la clôture "legacy" (rapport texte libre + photo, flux déjà câblé
-- sur espace-terrain.html "Terminer la mission" depuis 2026-07-20). Le
-- retour terrain structuré (outcome/issueType/followUp...) est un objet
-- JSON distinct (intervention.fieldReport), avec ses propres valeurs
-- contrôlées côté serveur -- jamais un statut ou un type arbitraire envoyé
-- par le navigateur, même contrainte en dur que les RPC employé déjà
-- auditées cette session (update_my_employee_intervention_status).
--
-- SÉCURITÉ (identique au modèle close_my_intervention/
-- update_my_employee_intervention_status déjà audité) :
--   1. auth.uid() null -> refus immédiat ;
--   2. compte non lié à employe_accounts -> refus contrôlé ;
--   3. verrou FOR UPDATE sur la ligne seba_state ciblée ;
--   4. l'intervention doit exister ET être assignée à CET employé
--      (employeId = employe_id du compte appelant) -- jamais une autre
--      mission, jamais account seul ;
--   5. outcome/issueType validés côté serveur contre une liste fermée
--      (jamais une valeur arbitraire du navigateur) ;
--   6. ne touche QUE le champ fieldReport (+ done:true, cohérent avec la
--      clôture) via `||`, jamais client/prix/employé assigné ;
--   7. search_path resserré à public (même convention que le baseline) ;
--   8. REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul rôle
--      authenticated.
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé (voir
-- consigne du chantier, section 11) -- ce fichier est créé et testé en
-- local uniquement (scripts/local-db/), jamais appliqué en production par
-- cette session.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function submit_my_intervention_field_report(
  p_intervention_id text,
  p_outcome text,
  p_summary text,
  p_issue_type text,
  p_issue_description text,
  p_follow_up_required boolean,
  p_follow_up_date text
)
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
  v_new_interventions jsonb;
  v_updated jsonb;
  v_field_report jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  if p_outcome not in ('completed', 'partially_completed', 'blocked', 'cancelled_on_site') then
    return jsonb_build_object('ok', false, 'error', 'Résultat de mission non autorisé.');
  end if;
  if p_issue_type is null or p_issue_type not in ('none', 'access', 'client_absent', 'equipment', 'damage', 'quality', 'delay', 'other') then
    return jsonb_build_object('ok', false, 'error', 'Type de signalement non autorisé.');
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea
  where ea.employe_user_id = v_uid;

  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable.');
  end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  v_field_report := jsonb_build_object(
    'completedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'outcome', p_outcome,
    'summary', coalesce(p_summary, ''),
    'issueType', p_issue_type,
    'issueDescription', coalesce(p_issue_description, ''),
    'followUpRequired', coalesce(p_follow_up_required, false),
    'followUpDate', p_follow_up_date,
    'submittedBy', v_employe_id,
    'submittedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'memorySuggestions', '[]'::jsonb,
    'dismissedSuggestionIds', '[]'::jsonb,
    'acceptedSuggestionIds', '[]'::jsonb
  );

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id
        then i.value || jsonb_build_object('fieldReport', v_field_report, 'done', true)
      else i.value
    end
  )
  into v_new_interventions
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  update public.seba_state
  set state = jsonb_set(state, '{interventions}', coalesce(v_new_interventions, '[]'::jsonb)),
      updated_at = now()
  where account = v_account;

  select i.value into v_updated
  from jsonb_array_elements(v_new_interventions) as i(value)
  where i.value ->> 'id' = p_intervention_id;

  return jsonb_build_object('ok', true, 'intervention', v_updated);
end;
$$;
revoke all on function submit_my_intervention_field_report(text, text, text, text, text, boolean, text) from public;
revoke all on function submit_my_intervention_field_report(text, text, text, text, text, boolean, text) from anon;
grant execute on function submit_my_intervention_field_report(text, text, text, text, text, boolean, text) to authenticated;

commit;
