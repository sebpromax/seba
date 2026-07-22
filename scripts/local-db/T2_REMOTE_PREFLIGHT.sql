-- ═══════════════════════════════════════════════════════════════
-- SEBA — Préflight T2, à exécuter dans l'éditeur SQL du projet Supabase
-- PARTAGÉ avant tout déploiement de la migration
-- 2026-07-22-fix-t2-onboarding-sector-idempotence.sql.
--
-- STRICTEMENT EN LECTURE SEULE. N'exécute rien d'autre. Aucun secret ni
-- donnée métier affichée -- uniquement des métadonnées et des comptages.
-- ═══════════════════════════════════════════════════════════════

-- 1. Doublons de profiles.user_id (bloquerait l'ajout de la contrainte UNIQUE).
select user_id, count(*) as nb_profils
from profiles
group by user_id
having count(*) > 1;
-- BLOQUANT SI NON VIDE : la contrainte unique ne peut pas être ajoutée
-- tant que ces doublons n'ont pas été résolus manuellement (fusion ou
-- suppression du profil obsolète -- décision humaine, pas automatique).

-- 2. Valeurs distinctes de profiles.sector, avec leurs nombres.
select sector, count(*) as n
from profiles
group by sector
order by n desc;
-- Si un résultat autre que 'menage'/'conciergerie'/'maintenance'/'autre'
-- apparaît (y compris 'Nettoyage'/'Conciergerie'/'Artisanat' capitalisés),
-- la nouvelle contrainte CHECK les rejettera à l'ajout -- BLOQUANT.

-- 3. Valeurs nulles (la colonne est déjà NOT NULL, devrait toujours être 0).
select count(*) as null_sector from profiles where sector is null;

-- 4. Valeurs avec une casse ou un vocabulaire ancien (recherche explicite).
select id, user_id, sector
from profiles
where sector in ('Nettoyage', 'Conciergerie', 'Artisanat')
   or sector ~ '[A-Z]';
-- BLOQUANT SI NON VIDE : ces lignes seraient rejetées par la nouvelle contrainte.

-- 5. Profils sans entreprise (état partiel préexistant).
select p.id as profile_id, p.user_id
from profiles p
left join companies c on c.profile_id = p.id
where c.id is null;
-- Informationnel : la nouvelle RPC réparera ce cas au prochain appel de
-- l'utilisateur concerné (si le secteur redemandé correspond), pas bloquant.

-- 6. Profils avec plusieurs entreprises (corruption potentielle déjà présente).
select p.user_id, count(*) as nb_companies
from companies c
join profiles p on p.id = c.profile_id
group by p.user_id
having count(*) > 1;
-- Informationnel : la nouvelle RPC ne plante pas sur ce cas (LIMIT 1
-- déterministe) mais ne le répare pas non plus -- à traiter séparément
-- si non vide (décision métier, pas cette migration).

-- 7. Entreprises sans profil (ne devrait jamais arriver, FK NOT NULL).
select c.id, c.profile_id
from companies c
left join profiles p on p.id = c.profile_id
where p.id is null;
-- Attendu : 0 ligne (contrainte FK empêche normalement ce cas).

-- 8. Définition actuelle de la contrainte profiles_sector_check.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'profiles'::regclass and contype = 'c';

-- 9. Définition et type de retour actuels de la RPC.
select p.proname, p.prosecdef as security_definer, p.proconfig,
       pg_get_function_result(p.oid) as type_retour,
       pg_get_function_arguments(p.oid) as arguments
from pg_proc p
where p.proname = 'create_profile_and_company' and p.pronamespace = 'public'::regnamespace;

-- 10. Dépendances de la fonction (objets qu'elle référence).
select distinct referenced_ns.nspname as schema, referenced_class.relname as objet_reference
from pg_depend d
join pg_proc p on p.oid = d.objid and p.proname = 'create_profile_and_company'
join pg_class referenced_class on referenced_class.oid = d.refobjid
join pg_namespace referenced_ns on referenced_ns.oid = referenced_class.relnamespace
where d.deptype = 'n';

-- 11. Droits et policies actuels sur profiles.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='profiles'
order by grantee, privilege_type;

select policyname, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename='profiles';

-- ═══════════════════════════════════════════════════════════════
-- RÉSULTATS QUI BLOQUENT LE DÉPLOIEMENT (à ne jamais ignorer) :
--   - Requête 1 non vide (doublons de user_id) ;
--   - Requête 2 montrant une valeur hors menage/conciergerie/maintenance/autre ;
--   - Requête 4 non vide (casse/vocabulaire ancien) ;
--   - Requête 9 montrant un type de retour ou une sécurité déjà différents
--     de ceux attendus par cette migration (signe qu'une autre modification
--     a eu lieu depuis l'audit de ce préflight).
-- Résultats informationnels seulement (ne bloquent pas, mais à lire) :
--   requêtes 3, 5, 6, 7, 10, 11.
-- ═══════════════════════════════════════════════════════════════
