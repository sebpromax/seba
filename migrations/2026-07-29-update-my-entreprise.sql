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
--
-- REVUE PRÉ-MERGE (2026-07-29) : la première version ne validait que la
-- forme du patch (objet JSON non nul), pas son contenu -- n'importe quel
-- patron authentifié aurait pu appeler cette RPC directement (hors
-- reglages.html) avec un objet contenant des clés arbitraires (aucune
-- allowlist), un nom vide (la validation "nom non vide" n'existait que
-- côté client, contournable), ou des chaînes de taille illimitée. Corrigé
-- ici : allowlist stricte des clés réellement utilisées par
-- saveGeneralInfo() (docs/reglages.html), nom obligatoire et non vide dès
-- qu'il est présent dans le patch, longueurs maximales raisonnables sur
-- tous les champs texte. Aucun risque cross-compte (la portée reste
-- toujours le propre compte de l'appelant), mais un patron ne doit pas
-- pouvoir corrompre ses propres données avec un objet arbitraire.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.update_my_entreprise(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_new jsonb;
  v_allowed_keys text[] := array['nom', 'email', 'telephone', 'zone', 'raisonSociale', 'siret', 'tvaNumero'];
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'update_my_entreprise: authentification requise'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'update_my_entreprise: patch invalide (objet requis)'
      using errcode = '22023';
  end if;

  -- Allowlist stricte : seuls les champs réellement gérés par
  -- reglages.html/saveGeneralInfo() peuvent être écrits. Aucun chemin
  -- JSONB arbitraire fourni par l'appelant.
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed_keys)) then
      raise exception 'update_my_entreprise: propriété inconnue ''%''', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- Nom obligatoire et non vide dès qu'il est touché par le patch --
  -- reglages.html l'envoie toujours (saveGeneralInfo() refuse déjà de
  -- soumettre un nom vide côté client), mais cette règle métier doit
  -- aussi tenir pour un appel direct de la RPC, pas seulement via le
  -- formulaire.
  if p_patch ? 'nom' then
    if p_patch ->> 'nom' is null or btrim(p_patch ->> 'nom') = '' then
      raise exception 'update_my_entreprise: le nom de l''entreprise ne peut pas être vide'
        using errcode = '22023';
    end if;
    if length(p_patch ->> 'nom') > 200 then
      raise exception 'update_my_entreprise: nom trop long (200 caractères maximum)'
        using errcode = '22023';
    end if;
  end if;

  -- Longueurs maximales raisonnables sur les autres champs texte --
  -- defense en profondeur contre un objet arbitraire (bruit/abus), pas
  -- une contrainte metier fine par champ.
  if (p_patch ->> 'email') is not null and length(p_patch ->> 'email') > 254 then
    raise exception 'update_my_entreprise: email trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'telephone') is not null and length(p_patch ->> 'telephone') > 40 then
    raise exception 'update_my_entreprise: telephone trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'zone') is not null and length(p_patch ->> 'zone') > 200 then
    raise exception 'update_my_entreprise: zone trop longue' using errcode = '22023';
  end if;
  if (p_patch ->> 'raisonSociale') is not null and length(p_patch ->> 'raisonSociale') > 200 then
    raise exception 'update_my_entreprise: raison sociale trop longue' using errcode = '22023';
  end if;
  if (p_patch ->> 'siret') is not null and length(p_patch ->> 'siret') > 40 then
    raise exception 'update_my_entreprise: siret trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'tvaNumero') is not null and length(p_patch ->> 'tvaNumero') > 40 then
    raise exception 'update_my_entreprise: numero de TVA trop long' using errcode = '22023';
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
