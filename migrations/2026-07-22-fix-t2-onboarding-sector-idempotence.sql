-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT (T2) : correction create_profile_and_company.
-- Révisée le 2026-07-22 (durcissement 1) puis le 2026-07-22 (durcissement
-- 2, pré-production) : voir historique de la branche
-- fix/t2-onboarding-sector-idempotence pour les versions précédentes.
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
-- inchangé dans son objectif, mécanisme (SECURITY DEFINER + garde-fou
-- manuel _user_id = auth.uid()) inchangé depuis le durcissement 1 -- voir
-- ce commentaire dans l'historique git pour le raisonnement complet
-- (policy UPDATE écartée, FOR UPDATE insuffisant sans elle sous RLS).
--
-- DURCISSEMENT 2 (pré-production, 2026-07-22) — 6 changements, aucun
-- changement de comportement métier pour un appel valide :
--   1. Toute la partie exécutable (contraintes, fonction, REVOKE, GRANT)
--      dans une seule transaction explicite BEGIN/COMMIT -- soit tout
--      s'applique, soit rien (DDL Postgres est transactionnel).
--   2. Contrôle de secteur dans la fonction explicitement null-safe
--      (`_sector is null or ...`) -- `NULL not in (...)` vaut NULL (ni
--      vrai ni faux) en SQL, jamais une erreur explicite : un appel avec
--      un secteur NULL aurait silencieusement traversé le IF sans lever
--      d'exception, pour finir rejeté seulement par la contrainte CHECK
--      (message moins clair, et seulement APRÈS une tentative d'écriture).
--   3. Contrainte CHECK elle-même rendue null-safe pour la même raison,
--      en défense en profondeur (la fonction est le chemin normal, mais
--      la contrainte reste la garantie de dernier recours si jamais
--      contournée).
--   4. Ajout de profiles_user_id_unique rendu réellement rejouable via un
--      bloc DO qui vérifie pg_constraint -- un DROP puis ADD aurait
--      reconstruit l'index à chaque rejeu, coûteux et inutile sur une
--      table réelle en production (contrairement à la contrainte CHECK
--      ci-dessus, bon marché à reconstruire, qui garde son mécanisme
--      DROP IF EXISTS + ADD).
--   5. search_path resserré : `public` retiré, remplacé par
--      `pg_catalog, pg_temp` (recommandation standard Postgres/Supabase
--      contre le search_path hijacking -- une fonction malveillante posée
--      dans le schéma public ne peut plus jamais être appelée à la place
--      d'une fonction native attendue). Toutes les tables référencées
--      dans le corps étaient déjà qualifiées `public.` (aucun changement
--      de comportement) ; `auth.uid()` était déjà qualifié `auth.`
--      également.
--   6. REVOKE/GRANT explicites : `public` ET `anon` explicitement révoqués
--      (le premier REVOKE ALL FROM PUBLIC couvrait déjà transitivement
--      `anon`, mais un GRANT direct à `anon` ailleurs resterait invisible
--      sans ce second REVOKE explicite -- défense en profondeur, pas une
--      lacune corrigée : aucun GRANT direct à `anon` n'existe aujourd'hui
--      sur cette fonction).
--
-- RETOUR DE LA FONCTION : reste `uuid` (pas de changement de contrat
-- public). Les deux seuls appelants du dépôt (docs/bienvenue.html:173,
-- docs/connexion.html:435) ignorent déjà la valeur retournée -- seule
-- l'absence d'erreur leur importe. Les cas d'erreur métier (secteur
-- inconnu/null, conflit de secteur) lèvent une exception SQL explicite,
-- capturée nativement par le mécanisme d'erreur déjà utilisé par ces deux
-- appelants (`const { error } = await sebaAuth.rpc(...)`), sans qu'aucun
-- changement de code JS ne soit nécessaire.
-- ═══════════════════════════════════════════════════════════════

begin;

-- 1. Contrainte de secteur : accepte les 4 valeurs réellement envoyées par
--    l'onboarding actuel, explicitement null-safe (défense en profondeur,
--    voir durcissement 2 point 3). Rejouable par nature (DROP IF EXISTS
--    + ADD) : reconstruction bon marché, contrairement à l'index unique
--    ci-dessous.
alter table profiles drop constraint if exists profiles_sector_check;
alter table profiles add constraint profiles_sector_check
  check (
    sector is not null
    and sector in ('menage', 'conciergerie', 'maintenance', 'autre')
  );

-- 2. Contrainte d'unicité sur profiles.user_id.
--    Prérequis vérifiés avant application (voir rapport de livraison) :
--      - table profiles vide en production (la RPC n'a jamais réussi) ;
--      - aucune donnée synthétique locale ne contredit "un profil par utilisateur" ;
--      - les tests ci-dessous démontrent qu'aucun parcours prévu n'est cassé.
--    Nécessaire pour que ON CONFLICT (user_id) soit possible.
--    N'IMPOSE PAS qu'un propriétaire ne gère qu'une seule entreprise --
--    aucune contrainte équivalente n'est ajoutée sur companies.profile_id,
--    décision produit délibérément non prise ici.
--    Rejouable SANS reconstruire l'index à chaque fois (contrairement à un
--    DROP IF EXISTS + ADD) : ajoutée seulement si absente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_user_id_unique'
  ) then
    alter table public.profiles add constraint profiles_user_id_unique unique (user_id);
  end if;
end $$;

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
set search_path = pg_catalog, pg_temp
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

  -- Erreur explicite AVANT toute écriture si le secteur est NULL ou
  -- inconnu -- `NULL not in (...)` vaut NULL (ni vrai ni faux) en SQL,
  -- jamais une erreur : sans le test IS NULL explicite, un secteur NULL
  -- traverserait ce IF silencieusement et ne serait rejeté que par la
  -- contrainte CHECK, plus tard et avec un message moins clair.
  if _sector is null or _sector not in ('menage', 'conciergerie', 'maintenance', 'autre') then
    raise exception 'create_profile_and_company: secteur inconnu ''%'' -- valeurs acceptees : menage, conciergerie, maintenance, autre', _sector
      using errcode = '22023';
  end if;

  -- Tentative d'insertion. DO NOTHING (pas DO UPDATE) : aucune policy
  -- UPDATE n'est nécessaire, SECURITY DEFINER contourne de toute façon
  -- RLS pour cette opération, mais on garde le principe du moindre effet
  -- (DO NOTHING plutôt qu'un UPDATE no-op). Objets qualifiés par leur
  -- schéma (public.) : desormais OBLIGATOIRE (search_path resserré à
  -- pg_catalog, pg_temp, voir durcissement 2 point 5), plus seulement une
  -- bonne pratique redondante.
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
revoke all on function create_profile_and_company(uuid, text, varchar) from anon;
grant execute on function create_profile_and_company(uuid, text, varchar) to authenticated;

commit;
