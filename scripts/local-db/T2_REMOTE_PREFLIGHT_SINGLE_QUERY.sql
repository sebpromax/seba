-- ═══════════════════════════════════════════════════════════════
-- SEBA — Préflight T2, VERSION 1 SEULE REQUÊTE (résultat unique JSONB,
-- 11 sections nommées, une par requête du fichier original
-- T2_REMOTE_PREFLIGHT.sql). Même contenu, même lecture-seule stricte --
-- aucun INSERT/UPDATE/DELETE/ALTER/DROP/CREATE, aucun appel de fonction
-- d'écriture. À exécuter une seule fois, à copier le résultat unique.
-- ═══════════════════════════════════════════════════════════════

with
q1_doublons_user_id as (
  select user_id, count(*) as nb_profils
  from profiles
  group by user_id
  having count(*) > 1
),
q2_valeurs_sector as (
  select sector, count(*) as n
  from profiles
  group by sector
  order by n desc
),
q3_null_sector as (
  select count(*) as null_sector from profiles where sector is null
),
q4_casse_ou_vocabulaire_ancien as (
  select id, user_id, sector
  from profiles
  where sector in ('Nettoyage', 'Conciergerie', 'Artisanat')
     or sector ~ '[A-Z]'
),
q5_profils_sans_entreprise as (
  select p.id as profile_id, p.user_id
  from profiles p
  left join companies c on c.profile_id = p.id
  where c.id is null
),
q6_profils_plusieurs_entreprises as (
  select p.user_id, count(*) as nb_companies
  from companies c
  join profiles p on p.id = c.profile_id
  group by p.user_id
  having count(*) > 1
),
q7_entreprises_sans_profil as (
  select c.id, c.profile_id
  from companies c
  left join profiles p on p.id = c.profile_id
  where p.id is null
),
q8_contrainte_sector_check as (
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'profiles'::regclass and contype = 'c'
),
q9_definition_rpc as (
  select p.proname, p.prosecdef as security_definer, p.proconfig,
         pg_get_function_result(p.oid) as type_retour,
         pg_get_function_arguments(p.oid) as arguments
  from pg_proc p
  where p.proname = 'create_profile_and_company' and p.pronamespace = 'public'::regnamespace
),
q10_dependances_rpc as (
  select distinct referenced_ns.nspname as schema, referenced_class.relname as objet_reference
  from pg_depend d
  join pg_proc p on p.oid = d.objid and p.proname = 'create_profile_and_company'
  join pg_class referenced_class on referenced_class.oid = d.refobjid
  join pg_namespace referenced_ns on referenced_ns.oid = referenced_class.relnamespace
  where d.deptype = 'n'
),
q11a_grants_profiles as (
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema='public' and table_name='profiles'
  order by grantee, privilege_type
),
q11b_policies_profiles as (
  select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname='public' and tablename='profiles'
)
select jsonb_build_object(
  '1_doublons_profiles_user_id',        (select coalesce(jsonb_agg(t), '[]'::jsonb) from q1_doublons_user_id t),
  '2_valeurs_profiles_sector',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from q2_valeurs_sector t),
  '3_valeurs_nulles_sector',            (select coalesce(jsonb_agg(t), '[]'::jsonb) from q3_null_sector t),
  '4_casse_ou_vocabulaire_ancien',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from q4_casse_ou_vocabulaire_ancien t),
  '5_profils_sans_entreprise',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from q5_profils_sans_entreprise t),
  '6_profils_plusieurs_entreprises',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from q6_profils_plusieurs_entreprises t),
  '7_entreprises_sans_profil',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from q7_entreprises_sans_profil t),
  '8_contrainte_profiles_sector_check', (select coalesce(jsonb_agg(t), '[]'::jsonb) from q8_contrainte_sector_check t),
  '9_definition_rpc_create_profile_and_company', (select coalesce(jsonb_agg(t), '[]'::jsonb) from q9_definition_rpc t),
  '10_dependances_rpc',                 (select coalesce(jsonb_agg(t), '[]'::jsonb) from q10_dependances_rpc t),
  '11_permissions_et_policies_profiles', jsonb_build_object(
    'grants',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from q11a_grants_profiles t),
    'policies', (select coalesce(jsonb_agg(t), '[]'::jsonb) from q11b_policies_profiles t)
  )
) as preflight_t2_resultat_unique;
