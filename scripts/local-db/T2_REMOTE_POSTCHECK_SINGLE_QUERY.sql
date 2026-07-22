-- SEBA — Vérification post-migration T2, une seule requête, un seul
-- résultat JSONB. STRICTEMENT EN LECTURE SEULE.
with
q1_contrainte_sector as (
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'profiles'::regclass and contype = 'c'
),
q2_contrainte_unique_user_id as (
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'profiles'::regclass and contype = 'u'
),
q3_rpc as (
  select p.proname, p.prosecdef as security_definer, p.proconfig,
         pg_get_function_result(p.oid) as type_retour,
         pg_get_function_arguments(p.oid) as arguments,
         pg_get_functiondef(p.oid) as definition_complete
  from pg_proc p
  where p.proname = 'create_profile_and_company' and p.pronamespace = 'public'::regnamespace
),
q4_permissions_execute as (
  select grantee, privilege_type
  from information_schema.routine_privileges
  where routine_name = 'create_profile_and_company'
)
select jsonb_build_object(
  '1_contrainte_sector_check',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from q1_contrainte_sector t),
  '2_contrainte_unique_user_id',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from q2_contrainte_unique_user_id t),
  '3_rpc_create_profile_and_company', (select coalesce(jsonb_agg(t), '[]'::jsonb) from q3_rpc t),
  '4_permissions_execute',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from q4_permissions_execute t)
) as postcheck_t2_resultat_unique;
