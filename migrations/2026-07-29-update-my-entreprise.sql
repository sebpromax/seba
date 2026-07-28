-- ═══════════════════════════════════════════════════════════════
-- SEBA — RPC dédiée pour sauvegarder réellement seba_state.state.entreprise
-- (THEME-MOBILE-001, défaut confirmé : "modification du nom de l'entreprise
-- non retrouvée après sauvegarde").
--
-- CAUSE RÉELLE (parcours tracé, docs/reglages.html -> docs/seba-data.js) :
-- 1. champ #regl-nom (docs/reglages.html) ;
-- 2. saveGeneralInfo() ;
-- 3. objet _ent fusionné (nom/email/téléphone/zone/raisonSociale/siret/tva) ;
-- 4. SebaDB.entreprise.set(_ent) -- PAS SebaDB.update(), une API dédiée ;
-- 5. propriété seba_state.state.entreprise (objet unique, pas une
--    collection tableau comme clients/devis) ;
-- 6. AUCUNE requête réseau n'était jamais envoyée pour ce champ avant ce
--    correctif : entreprise.set() n'appelait que persist() ->
--    adapter.save(state), qui pour SupabaseAdapter (Palier 1) n'écrit plus
--    QUE le cache local (voir docs/seba-data.js, commentaire "ne pousse
--    plus le blob entier"). pushOp()/sync-push ne couvrent QUE les
--    collections tableau (clients/devis/factures/interventions/employes/
--    journal/contrats/custom_services/automationRules/automationRuns/
--    automationAlerts, voir apply_entity_patch()) -- entreprise n'entre pas
--    dans ce contrat (pas de tableau, pas d'id), et l'étendre à un objet
--    unique aurait été un changement d'architecture disproportionné pour
--    ce défaut ciblé ;
-- 7. le nom modifié ne vivait donc QUE dans le cache local (et
--    localStorage.sebaEntreprise, écrit en parallèle par reglages.html) ;
-- 8. au rechargement/reconnexion, SupabaseAdapter.pull() relit
--    seba_state.state en entier depuis le serveur -- où l'ancien nom
--    n'avait jamais été remplacé -- et écrase la valeur locale modifiée :
--    la modification "disparaissait".
--
-- FIX : RPC minimale dédiée, écriture authentifiée directe (jamais via
-- service_role), même emplacement canonique que le bootstrap initial
-- (create_profile_and_company insère déjà seba_state.state.entreprise à
-- l'inscription -- aucune nouvelle source de vérité créée, Supabase reste
-- l'unique backend). SECURITY INVOKER : la policy RLS existante
-- "state_update" (auth.uid() = user_id) suffit à isoler chaque compte,
-- la clause WHERE explicite ci-dessous est une défense en profondeur, pas
-- le seul rempart.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.update_my_entreprise(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_new jsonb;
begin
  if auth.uid() is null then
    raise exception 'update_my_entreprise: authentification requise'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'update_my_entreprise: patch invalide (objet requis)'
      using errcode = '22023';
  end if;

  update public.seba_state
  set state = jsonb_set(state, '{entreprise}', coalesce(state -> 'entreprise', '{}'::jsonb) || p_patch, true),
      updated_at = now()
  where user_id = auth.uid()
  returning state -> 'entreprise' into v_new;

  if v_new is null then
    raise exception 'update_my_entreprise: compte introuvable pour cet utilisateur'
      using errcode = '22023';
  end if;

  return v_new;
end;
$$;

revoke all on function public.update_my_entreprise(jsonb) from public;
revoke all on function public.update_my_entreprise(jsonb) from anon;
grant execute on function public.update_my_entreprise(jsonb) to authenticated;
