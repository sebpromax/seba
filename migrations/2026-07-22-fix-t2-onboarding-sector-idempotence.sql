-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT (T2) : correction create_profile_and_company.
-- Révisée le 2026-07-22 (durcissement) : voir historique de la branche
-- fix/t2-onboarding-sector-idempotence pour la version initiale.
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique.
--
-- PROBLÈME CORRIGÉ (1) — divergence de secteur : voir version initiale,
-- inchangé.
--
-- PROBLÈME CORRIGÉ (2) — absence d'idempotence : voir version initiale,
-- inchangé dans son objectif, mais MÉCANISME REVU après durcissement :
--
-- La première version ajoutait une policy UPDATE sur `profiles` pour
-- permettre `INSERT ... ON CONFLICT DO UPDATE` (verrouillage de ligne).
-- Problème identifié : cette policy aurait permis à un utilisateur
-- authentifié de modifier N'IMPORTE QUELLE colonne de son propre profil
-- (dont `sector`) par un appel PATCH direct sur /rest/v1/profiles,
-- CONTOURNANT la protection "jamais d'écrasement silencieux du secteur"
-- que la RPC elle-même garantit. Retirée.
--
-- Alternative testée (INSERT ... ON CONFLICT DO NOTHING puis
-- SELECT ... FOR UPDATE sur la ligne existante) : confirmée EMPIRIQUEMENT
-- insuffisante en SECURITY INVOKER -- sans policy UPDATE, `FOR UPDATE`
-- sous RLS ne renvoie AUCUNE ligne (silencieusement, sans erreur), même
-- avec un GRANT UPDATE au niveau table. RLS exige une policy de type
-- UPDATE pour qu'une ligne soit "verrouillable", pas seulement visible en
-- lecture.
--
-- Solution retenue : passer la fonction en SECURITY DEFINER (comme
-- get_my_client_profile/get_my_employee_profile/close_my_intervention/
-- erase_account_completely dans ce même schéma -- le modèle déjà dominant
-- de ce dépôt pour les RPC qui doivent agir au-delà de ce que RLS
-- autoriserait directement). Contourne RLS pour SES PROPRES opérations
-- internes (dont FOR UPDATE), MAIS réplique manuellement la garantie que
-- RLS aurait fournie : vérification explicite `_user_id = auth.uid()` en
-- tout début de fonction -- sans cette vérification, SECURITY DEFINER
-- permettrait à n'importe quel appelant de fournir un _user_id arbitraire
-- et de créer/lire le profil de quelqu'un d'autre. AUCUNE policy
-- supplémentaire n'est ajoutée sur `profiles` ou `companies` : leurs
-- policies RLS existantes restent inchangées et continuent de protéger
-- tout accès direct via l'API REST (hors de cette RPC).
--
-- RETOUR DE LA FONCTION : reste `uuid` (pas de changement de contrat
-- public). Les deux seuls appelants du dépôt (docs/bienvenue.html:173,
-- docs/connexion.html:435) ignorent déjà la valeur retournée -- seule
-- l'absence d'erreur leur importe. Les cas d'erreur métier (secteur
-- inconnu, conflit de secteur) lèvent une exception SQL explicite,
-- capturée nativement par le mécanisme d'erreur déjà utilisé par ces deux
-- appelants (`const { error } = await sebaAuth.rpc(...)`), sans qu'aucun
-- changement de code JS ne soit nécessaire.
-- ═══════════════════════════════════════════════════════════════

-- 1. Contrainte de secteur : accepte les 4 valeurs réellement envoyées par
--    l'onboarding actuel.
alter table profiles drop constraint if exists profiles_sector_check;
alter table profiles add constraint profiles_sector_check
  check (sector in ('menage', 'conciergerie', 'maintenance', 'autre'));

-- 2. Contrainte d'unicité sur profiles.user_id.
--    Prérequis vérifiés avant application (voir rapport de livraison) :
--      - table profiles vide en production (la RPC n'a jamais réussi) ;
--      - aucune donnée synthétique locale ne contredit "un profil par utilisateur" ;
--      - les tests ci-dessous démontrent qu'aucun parcours prévu n'est cassé.
--    Nécessaire pour que ON CONFLICT (user_id) soit possible.
--    N'IMPOSE PAS qu'un propriétaire ne gère qu'une seule entreprise --
--    aucune contrainte équivalente n'est ajoutée sur companies.profile_id,
--    décision produit délibérément non prise ici.
alter table profiles add constraint profiles_user_id_unique unique (user_id);

-- 3. Aucune policy supplémentaire sur profiles ou companies. Les policies
--    existantes (profiles_select, profiles_insert, companies_select,
--    companies_insert) restent strictement inchangées.

create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _profile_id uuid;
  _existing_sector text;
  _company_id uuid;
begin
  -- Refuse explicitement tout appel non authentifié -- distinct du test
  -- suivant : sans cette ligne, un _user_id NULL fourni par un appelant
  -- dont auth.uid() est aussi NULL passerait le test "IS DISTINCT FROM"
  -- (NULL IS DISTINCT FROM NULL vaut FALSE en SQL), un cas limite que le
  -- seul test d'égalité ci-dessous ne couvre pas.
  if auth.uid() is null then
    raise exception 'create_profile_and_company: appel non authentifie'
      using errcode = '42501';
  end if;

  -- Garde-fou OBLIGATOIRE : remplace la protection normalement assurée
  -- par la policy RLS profiles_insert (auth.uid() = user_id), contournée
  -- par SECURITY DEFINER. Sans cette ligne, n'importe quel appelant
  -- authentifié pourrait fournir un _user_id arbitraire.
  if _user_id is distinct from auth.uid() then
    raise exception 'create_profile_and_company: _user_id doit correspondre a l''utilisateur authentifie'
      using errcode = '42501';
  end if;

  -- Erreur explicite AVANT toute écriture si le secteur est inconnu.
  if _sector not in ('menage', 'conciergerie', 'maintenance', 'autre') then
    raise exception 'create_profile_and_company: secteur inconnu ''%'' -- valeurs acceptees : menage, conciergerie, maintenance, autre', _sector
      using errcode = '22023';
  end if;

  -- Tentative d'insertion. DO NOTHING (pas DO UPDATE) : aucune policy
  -- UPDATE n'est nécessaire, SECURITY DEFINER contourne de toute façon
  -- RLS pour cette opération, mais on garde le principe du moindre effet
  -- (DO NOTHING plutôt qu'un UPDATE no-op). Objets qualifiés par leur
  -- schéma (public.) : le search_path est déjà fixé ci-dessus et rend
  -- cela redondant pour la sécurité, mais plus explicite/robuste à la
  -- lecture et si ce corps est un jour réutilisé ailleurs.
  insert into public.profiles (user_id, sector) values (_user_id, _sector)
  on conflict (user_id) do nothing
  returning id into _profile_id;

  if _profile_id is null then
    -- Le profil existait déjà : lecture + verrouillage de la ligne pour
    -- la durée de la transaction (sérialise les appels concurrents sur ce
    -- même profil). Fonctionne car SECURITY DEFINER contourne RLS pour
    -- cette opération -- vérifié empiriquement insuffisant sans cela
    -- (voir historique de cette migration).
    select id, sector into _profile_id, _existing_sector
    from public.profiles where user_id = _user_id
    for update;

    -- Le secteur stocké n'est JAMAIS écrasé silencieusement : un
    -- désaccord avec la valeur demandée est un conflit métier explicite.
    if _existing_sector is distinct from _sector then
      raise exception 'create_profile_and_company: profil existant avec un secteur different (demande=%, existant=%)', _sector, _existing_sector
        using errcode = '23514';
    end if;
  end if;

  -- Rattache l'entreprise existante ou en crée une nouvelle. Protégé par
  -- le verrou de ligne sur profiles pris ci-dessus (insert réussi -- qui
  -- verrouille implicitement sa propre ligne jusqu'au commit -- ou
  -- SELECT FOR UPDATE) : deux appels concurrents pour le même utilisateur
  -- sont sérialisés sur cette ligne profiles, le second ne reprend qu'après
  -- le commit du premier et trouve alors l'entreprise déjà créée.
  select id into _company_id from public.companies where profile_id = _profile_id limit 1;

  if _company_id is null then
    insert into public.companies (profile_id, name) values (_profile_id, _company_name)
    returning id into _company_id;
  end if;

  return _profile_id;
end;
$$;

revoke all on function create_profile_and_company(uuid, text, varchar) from public;
grant execute on function create_profile_and_company(uuid, text, varchar) to authenticated;
