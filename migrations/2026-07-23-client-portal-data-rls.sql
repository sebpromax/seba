-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : accès client en lecture seule à ses
-- propres devis/factures/interventions.
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique.
--
-- PROBLÈME CORRIGÉ — depuis la refonte du portail client
-- (docs/client-espace.html, commit f9cd92e), un client authentifié via
-- une vraie session Supabase (client_accounts) ne pouvait lire NI ses
-- devis, NI ses factures, NI ses interventions : ces trois entités ne
-- sont pas des lignes normalisées appartenant au client (les tables
-- `devis`/`factures`/`interventions` du baseline existent mais ne sont
-- PAS la voie de stockage réellement branchée -- voir la note
-- "ARCHITECTURE" de supabase-schema.sql, ligne ~224 : le produit lit et
-- écrit tout via `seba_state.state` (un unique blob JSONB par PATRON,
-- policy `auth.uid() = user_id`). Un client authentifié a un auth.uid()
-- DIFFÉRENT de celui du patron propriétaire de la ligne seba_state : il
-- était donc bloqué à 100%, pas seulement mal filtré. En mode local/démo
-- (hors session cloud), le portail contournait déjà ça en lisant le
-- state en clair côté navigateur (aucun souci, RLS ne s'applique pas à
-- localStorage) -- seul le chemin "vraie session Supabase" restait vide,
-- honnêtement (jamais de fausse donnée), voir docs/client-espace.html
-- avant ce correctif.
--
-- POURQUOI PAS UNE POLICY SELECT DIRECTE SUR seba_state ?
-- Une policy `using (exists (select 1 from client_accounts ca where
-- ca.client_user_id = auth.uid() and ca.account = seba_state.account))`
-- donnerait au client accès à la ligne ENTIÈRE (state jsonb complet) --
-- donc à TOUS les clients, employés, devis, factures et interventions
-- du patron, pas seulement aux siens. `client_id` n'existe qu'À
-- L'INTÉRIEUR du blob JSON, jamais comme colonne Postgres filtrable par
-- une policy `using`/`with check` classique. Exactement le cas prévu :
-- "si une table ne contient pas de clé permettant de vérifier
-- précisément le client_id, ne pas créer de policy basée sur account
-- seul" -- d'où le choix de 3 RPC SECURITY DEFINER dédiées, sur le
-- modèle déjà établi par get_my_client_profile() (section 33 du
-- baseline) : extraction filtrée EXPLICITEMENT par account ET clientId,
-- jamais le blob entier.
--
-- SÉCURITÉ DE CHAQUE RPC :
--   1. auth.uid() doit correspondre à une ligne client_accounts (sinon
--      retour '[]'::jsonb, jamais une erreur qui fuiterait une info) ;
--   2. le compte (account) ET l'identifiant client (client_id) du lien
--      trouvé sont TOUS LES DEUX utilisés pour filtrer -- reproduit
--      exactement la double correspondance exigée : jamais "même
--      account" seul, toujours "même account ET même client_id" ;
--   3. SECURITY DEFINER strictement nécessaire ici (la fonction doit
--      lire seba_state, dont la policy SELECT normale exigerait
--      auth.uid() = user_id du PATRON) -- mais AUCUNE écriture nulle
--      part dans le corps de ces 3 fonctions : lecture pure ;
--   4. search_path resserré à `pg_catalog, pg_temp` (même durcissement
--      que 2026-07-22-fix-t2-onboarding-sector-idempotence.sql) --
--      toutes les tables référencées sont qualifiées `public.` ;
--   5. REVOKE PUBLIC + REVOKE anon explicites, puis GRANT EXECUTE au
--      seul rôle authenticated.
--
-- CE QUI N'EST PAS TOUCHÉ (rappel explicite) :
--   - aucune policy existante modifiée (seba_state, client_accounts,
--     client_requests, seba_messages restent identiques) ;
--   - aucun droit INSERT/UPDATE/DELETE ajouté pour le client sur quoi
--     que ce soit -- ces 3 RPC sont des fonctions de LECTURE uniquement ;
--   - `documents` : aucune table dédiée n'existe dans le schéma (grep
--     confirmé, aucun `create table ... documents`) -- le portail les
--     compose déjà côté client à partir de devis + factures + photos de
--     client_requests (colonne photo_path, déjà lisible par le client
--     via la policy client_requests_select existante) : aucune RPC
--     supplémentaire nécessaire pour ce point ;
--   - `seba_messages` : déjà correctement scopé par (account, client_id)
--     via client_accounts depuis la section 32 du baseline -- vérifié,
--     aucune régression à corriger, donc aucune ligne touchée ici.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function get_my_client_devis()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(d.value), '[]'::jsonb) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'devis') as d(value)
  where s.account = v_account
    and d.value ->> 'clientId' = v_client_id;

  return v_items;
end;
$$;
revoke all on function get_my_client_devis() from public;
revoke all on function get_my_client_devis() from anon;
grant execute on function get_my_client_devis() to authenticated;

create or replace function get_my_client_factures()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(f.value), '[]'::jsonb) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'factures') as f(value)
  where s.account = v_account
    and f.value ->> 'clientId' = v_client_id;

  return v_items;
end;
$$;
revoke all on function get_my_client_factures() from public;
revoke all on function get_my_client_factures() from anon;
grant execute on function get_my_client_factures() to authenticated;

create or replace function get_my_client_interventions()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(i.value), '[]'::jsonb) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'interventions') as i(value)
  where s.account = v_account
    and i.value ->> 'clientId' = v_client_id;

  return v_items;
end;
$$;
revoke all on function get_my_client_interventions() from public;
revoke all on function get_my_client_interventions() from anon;
grant execute on function get_my_client_interventions() to authenticated;

commit;
