-- ═══════════════════════════════════════════════════════════════
-- SEBA — Audit des privilèges du projet Supabase PARTAGÉ (production).
--
-- STRICTEMENT EN LECTURE SEULE. Aucune de ces requêtes ne modifie quoi que
-- ce soit. Copiables directement dans Supabase → SQL Editor → New query.
-- N'affiche aucun secret ni donnée métier -- uniquement des métadonnées de
-- privilèges (noms de rôles, de tables, de colonnes).
--
-- Objectif : comparer le résultat de chacune de ces requêtes à l'état
-- actuellement posé par scripts/local-db/local-only-grants.sql (voir le
-- tableau de comparaison à remplir, section suivante de la réponse).
-- ═══════════════════════════════════════════════════════════════

-- 1. Privilèges anon/authenticated/service_role sur TOUTES les tables publiques.
-- Résultat attendu si la production a un modèle "classique" pré-2026 : SELECT/
-- INSERT/UPDATE/DELETE pour authenticated et/ou anon sur la plupart des tables
-- (RLS filtre ensuite les lignes). Si le résultat ressemble à ce qu'on a vu en
-- local (uniquement TRIGGER/REFERENCES/TRUNCATE), la production a le même
-- écart que le local, et l'application ne fonctionnerait pas -- ce qui n'est
-- pas le cas observé -- donc un résultat "vide" ici serait surprenant et à
-- signaler immédiatement.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 2. Privilèges sur les séquences (utilisées par les colonnes serial/identity, si présentes).
select sequence_name, grantee, privilege_type
from information_schema.role_usage_grants
where object_schema = 'public' and object_type = 'SEQUENCE'
  and grantee in ('anon', 'authenticated', 'service_role')
order by sequence_name, grantee;

-- 3. Privilèges d'exécution sur les fonctions (RPC).
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where specific_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role', 'public')
order by routine_name, grantee;

-- 4. Privilèges par défaut configurés avec ALTER DEFAULT PRIVILEGES
-- (s'applique aux objets FUTURS, pas seulement existants -- explique
-- pourquoi de nouvelles tables pourraient ou non hériter automatiquement
-- de privilèges sans GRANT explicite à chaque fois).
select
  pg_get_userbyid(defaclrole) as role_proprietaire,
  defaclnamespace::regnamespace as schema,
  defaclobjtype as type_objet,       -- r=table, S=sequence, f=fonction, T=type
  defaclacl as acl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace;

-- 5. Droits USAGE et CREATE sur le schéma public lui-même.
select nspname as schema, r.rolname as grantee,
  has_schema_privilege(r.rolname, 'public', 'USAGE') as usage,
  has_schema_privilege(r.rolname, 'public', 'CREATE') as create_priv
from pg_namespace n
cross join pg_roles r
where n.nspname = 'public' and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
order by r.rolname;

-- 6. Tables exposées par l'API (présentes dans le schéma exposé par PostgREST)
-- mais dépourvues de tout privilège SELECT pour anon/authenticated -- seraient
-- des tables "mortes" côté API (accessible en théorie, inutilisable en
-- pratique). Sert à détecter l'écart inverse de celui trouvé en local.
select t.tablename
from pg_tables t
where t.schemaname = 'public'
  and not exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = t.tablename
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type = 'SELECT'
  )
order by t.tablename;

-- 7. Tables possédant des privilèges pour anon/authenticated MAIS sans RLS activée
-- (le risque inverse et le plus critique : privilège d'accès sans filtre de ligne).
select t.tablename, c.relrowsecurity as rls_activee
from pg_tables t
join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
where t.schemaname = 'public'
  and exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = t.tablename
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  )
  and c.relrowsecurity = false
order by t.tablename;

-- 8. Résumé compact à comparer directement au contenu de local-only-grants.sql
-- (qui accorde : authenticated -> SELECT/INSERT/UPDATE/DELETE sur tout ;
--                anon          -> SELECT seul sur tout).
select
  grantee,
  privilege_type,
  count(*) as nb_tables
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, privilege_type
order by grantee, privilege_type;
