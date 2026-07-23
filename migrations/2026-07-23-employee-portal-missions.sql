-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : portail employé (espace-terrain.html),
-- lecture de ses missions + changement de statut en_cours/terminee.
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique. Ne modifie AUCUNE RPC/policy déjà existante,
-- en particulier get_my_employee_interventions(_date text) et
-- close_my_intervention(...) (baseline, sections 35/36) : les 2 RPC
-- ci-dessous sont des AJOUTS, jamais des remplacements.
--
-- POURQUOI get_my_employee_interventions() (SANS argument) EN PLUS DE
-- get_my_employee_interventions(_date text) (déjà existante) :
-- surcharge Postgres valide (signatures distinctes) -- la version datée
-- sert le planning "d'un jour précis", la nouvelle sert le dashboard
-- (mission en cours / prochaine / en retard, toutes dates confondues) et
-- la liste "Missions" complète. Enrichit chaque intervention avec
-- l'adresse du client (SEUL champ ajouté -- jamais le reste de la fiche
-- client : ni notes, ni ca, ni statut commercial) car l'employé n'a
-- aucun autre moyen de lire state.clients (RLS de seba_state bloque son
-- auth.uid(), comme pour le patron -- même raison que get_my_client_*).
--
-- POURQUOI update_my_employee_intervention_status EST SÉPARÉE DE
-- close_my_intervention : close_my_intervention (baseline) gère la
-- clôture COMPLÈTE (rapport texte + photo + clôture de la client_request
-- liée) -- un flux différent, plus lourd, déjà câblé. Cette RPC-ci est
-- le simple aller-retour "Démarrer"/"Terminer" du dashboard employé,
-- sans rapport ni photo. Statuts acceptés : 'en_cours' | 'terminee'
-- uniquement (contrainte en dur dans le corps de la fonction, jamais un
-- statut arbitraire envoyé par le navigateur). Ajoute un champ JSON
-- `statut` sur l'intervention (absent aujourd'hui : le modèle réel
-- n'utilise qu'un booléen `done`, voir docs/seba-data.js:seed() et
-- assignation.html -- confirmé par grep, aucune trace de statut
-- multi-valeurs sur les interventions avant ce correctif). Pour ne CASSER
-- AUCUN consommateur existant du booléen `done` (dashboard.html,
-- client-espace.html filtrent déjà sur `!i.done`), 'terminee' met AUSSI
-- `done:true` dans le même jsonb_set -- 'en_cours' laisse `done:false`
-- (toujours "non terminé" au sens de l'ancien modèle, ce qui reste exact).
--
-- SÉCURITÉ (identique au modèle get_my_client_*/update pattern déjà
-- audité côté client, migrations/2026-07-23-client-portal-data-rls.sql) :
--   1. auth.uid() null -> refus immédiat (lecture : '[]'::jsonb ;
--      écriture : {ok:false,error}) ;
--   2. compte non lié à employe_accounts -> même refus contrôlé ;
--   3. lecture ET écriture filtrent TOUJOURS par account ET employe_id
--      (jamais account seul -- deux employés du même patron sont
--      mutuellement invisibles) ;
--   4. écriture : verrou FOR UPDATE sur la ligne seba_state ciblée,
--      vérifie que l'intervention existe puis qu'elle est assignée à CET
--      employé avant toute modification, ne touche QUE le champ statut
--      (+ done, voir ci-dessus) via `||`, jamais client/prix/employé ;
--   5. search_path resserré à `pg_catalog, pg_temp`, tables qualifiées
--      `public.` ;
--   6. REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul
--      rôle authenticated.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function get_my_employee_interventions()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_employe_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ea.account, ea.employe_id into v_account, v_employe_id
  from public.employe_accounts ea
  where ea.employe_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      i.value || jsonb_build_object('adresse', c.value ->> 'adresse')
    ),
    '[]'::jsonb
  ) into v_items
  from public.seba_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) as i(value)
  left join lateral (
    select c.value
    from jsonb_array_elements(coalesce(s.state -> 'clients', '[]'::jsonb)) as c(value)
    where c.value ->> 'id' = i.value ->> 'clientId'
    limit 1
  ) c on true
  where s.account = v_account
    and i.value ->> 'employeId' = v_employe_id;

  return v_items;
end;
$$;
revoke all on function get_my_employee_interventions() from public;
revoke all on function get_my_employee_interventions() from anon;
grant execute on function get_my_employee_interventions() to authenticated;

create or replace function update_my_employee_intervention_status(p_intervention_id text, p_status text)
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
  v_exists boolean := false;
  v_owned boolean := false;
  v_new_interventions jsonb;
  v_updated jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  if p_status not in ('en_cours', 'terminee') then
    return jsonb_build_object('ok', false, 'error', 'Statut non autorisé.');
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

  select bool_or(i.value ->> 'id' = p_intervention_id)
  into v_exists
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'error', 'Intervention inconnue.');
  end if;

  select bool_or(i.value ->> 'id' = p_intervention_id and i.value ->> 'employeId' = v_employe_id)
  into v_owned
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) as i(value);

  if not coalesce(v_owned, false) then
    return jsonb_build_object('ok', false, 'error', 'Mission non assignée à vous.');
  end if;

  select jsonb_agg(
    case
      when i.value ->> 'id' = p_intervention_id
        then i.value || jsonb_build_object('statut', p_status, 'done', (p_status = 'terminee'))
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
revoke all on function update_my_employee_intervention_status(text, text) from public;
revoke all on function update_my_employee_intervention_status(text, text) from anon;
grant execute on function update_my_employee_intervention_status(text, text) to authenticated;

commit;
