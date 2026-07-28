-- ═══════════════════════════════════════════════════════════════
-- SEBA — Bootstrap de la ligne seba_state du patron à l'inscription
-- (chantier "ACTIVATION RÉELLE DES COMPTES ET ACCÈS", prérequis avant
-- déploiement des emails commerciaux).
--
-- BUG RÉEL TROUVÉ (QA compte/activation, scripts/qa-account-activation.js) :
-- un patron fraîchement inscrit + activé (bienvenue.html -> updatePassword
-- + create_profile_and_company) n'a AUCUNE ligne seba_state -- cette table
-- n'est peuplée que par sync-push (Palier 1, patch par patch), et
-- sync-push.resolveIdentity() EXIGE qu'une ligne seba_state existe déjà
-- pour résoudre account/user_id à partir du JWT (select ... where user_id =
-- callerUid). Résultat : le tout premier SebaDB.create() du patron (ajout
-- d'un client, d'un devis...) échoue silencieusement en boucle (401
-- "Authentification requise", ré-essayé indéfiniment par le worker de
-- sync, jamais résolu) -- un patron neuf ne peut RIEN écrire, et ne peut
-- donc jamais inviter son premier client/employé (client-provision.ts/
-- employe-provision.ts vérifient aussi l'existence de cette même ligne).
--
-- FIX : create_profile_and_company crée désormais AUSSI la ligne
-- seba_state du patron, avec l'état par défaut exact de EMPTY()
-- (docs/seba-data.js) -- account = user_id = auth.uid(), comme partout
-- ailleurs dans le projet (adapter._accountId()). `on conflict (account) do
-- nothing` : idempotent, sans danger si rejouée (connexion.html rejoue
-- cette RPC au premier login quand la confirmation email était requise,
-- voir completePendingProfile()).
--
-- CORRECTION 2026-07-28 (avant tout déploiement) : la première version de
-- ce fichier faisait un `create or replace` NAIF, recopiant la forme
-- D'ORIGINE du baseline (supabase-schema.sql, SECURITY INVOKER, sans
-- garde-fous) -- une fonction PostgreSQL est intégralement redéfinie par
-- CREATE OR REPLACE, propriétés comprises (SECURITY DEFINER/INVOKER,
-- search_path) : rejouée APRÈS le durcissement T2
-- (migrations/2026-07-22-fix-t2-onboarding-sector-idempotence.sql, déjà
-- fusionné dans main), elle aurait SILENCIEUSEMENT effacé SECURITY
-- DEFINER, le search_path resserré, la validation de secteur, et
-- surtout le `on conflict (user_id) do nothing` sur profiles/companies --
-- un rejeu légitime de cette RPC (patron déjà existant, cas déjà couvert
-- par completePendingProfile()) aurait levé une violation de contrainte
-- unique brute au lieu d'un no-op gracieux. Cette version repart donc du
-- corps durci de T2 tel quel, seul l'ajout du bootstrap seba_state est
-- nouveau -- aucune régression du durcissement existant.
-- ═══════════════════════════════════════════════════════════════

create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  _profile_id uuid;
  _existing_sector text;
  _company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_profile_and_company: appel non authentifie'
      using errcode = '42501';
  end if;

  if _user_id is distinct from auth.uid() then
    raise exception 'create_profile_and_company: _user_id doit correspondre a l''utilisateur authentifie'
      using errcode = '42501';
  end if;

  if _sector is null or _sector not in ('menage', 'conciergerie', 'maintenance', 'autre') then
    raise exception 'create_profile_and_company: secteur inconnu ''%'' -- valeurs acceptees : menage, conciergerie, maintenance, autre', _sector
      using errcode = '22023';
  end if;

  insert into public.profiles (user_id, sector) values (_user_id, _sector)
  on conflict (user_id) do nothing
  returning id into _profile_id;

  if _profile_id is null then
    select id, sector into _profile_id, _existing_sector
    from public.profiles where user_id = _user_id
    for update;

    if _existing_sector is distinct from _sector then
      raise exception 'create_profile_and_company: profil existant avec un secteur different (demande=%, existant=%)', _sector, _existing_sector
        using errcode = '23514';
    end if;
  end if;

  select id into _company_id from public.companies where profile_id = _profile_id limit 1;

  if _company_id is null then
    insert into public.companies (profile_id, name) values (_profile_id, _company_name)
    returning id into _company_id;
  end if;

  -- Ajout PUR de ce chantier : bootstrap seba_state, absent de T2.
  -- account = user_id = auth.uid() (jamais un _user_id arbitraire, déjà
  -- validé par le garde-fou ci-dessus) -- aucune écriture cross-account
  -- possible. `on conflict (account) do nothing` : idempotent au même
  -- titre que profiles/companies ci-dessus, aucune dépendance à
  -- sync-push pour exister.
  insert into public.seba_state (account, user_id, state)
  values (
    _user_id::text,
    _user_id,
    jsonb_build_object(
      'v', 1,
      'clients', '[]'::jsonb, 'devis', '[]'::jsonb, 'factures', '[]'::jsonb,
      'interventions', '[]'::jsonb, 'employes', '[]'::jsonb, 'journal', '[]'::jsonb,
      'custom_services', '[]'::jsonb, 'contrats', '[]'::jsonb, 'messages', '[]'::jsonb,
      'clientRequests', '[]'::jsonb,
      'automationRules', '[]'::jsonb, 'automationRuns', '[]'::jsonb, 'automationAlerts', '[]'::jsonb,
      'entreprise', jsonb_build_object('nom', _company_name, 'secteur', _sector),
      'publicIntakeConfig', null,
      'seq', jsonb_build_object('devis', 118, 'facture', 93, 'contrat', 0, 'recu', 0),
      'documentNumbering', null, 'documentDisplayPrefs', null,
      'commercialEmailTemplates', null
    )
  )
  on conflict (account) do nothing;

  return _profile_id;
end;
$$;

revoke all on function create_profile_and_company(uuid, text, varchar) from public;
revoke all on function create_profile_and_company(uuid, text, varchar) from anon;
grant execute on function create_profile_and_company(uuid, text, varchar) to authenticated;
