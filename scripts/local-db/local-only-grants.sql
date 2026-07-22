-- SEBA — Grants LOCAUX UNIQUEMENT, jamais une migration produit, jamais à déployer.
--
-- DÉCOUVERTE (2026-07-22) : la CLI Supabase locale (v2.109.1), pour un projet
-- fraîchement initialisé, n'accorde PAR DÉFAUT aucun privilège SELECT/INSERT/
-- UPDATE/DELETE aux rôles anon/authenticated sur les tables du schéma public
-- ("auto_expose_new_tables" non actif par défaut, voir supabase/config.toml
-- généré par `supabase init` — comportement documenté comme "nouveau défaut
-- cloud"). Confirmé empiriquement : information_schema.role_table_grants ne
-- montre QUE TRIGGER/REFERENCES/TRUNCATE après application du baseline seul,
-- jamais SELECT.
--
-- AUCUN fichier de ce dépôt (supabase-schema.sql compris) ne contient de
-- GRANT au niveau table -- seuls 4 GRANT EXECUTE existent, tous sur des
-- fonctions. Le fait que l'application réelle fonctionne en production
-- suggère qu'un privilège équivalent existe déjà là-bas, posé au moment de
-- la création du projet (hors de tout fichier versionné ici) -- point à
-- vérifier manuellement sur le vrai projet, pas supposé.
--
-- Ce fichier comble UNIQUEMENT cet écart pour permettre aux tests RLS
-- locaux de s'exécuter (RLS filtre les LIGNES, mais ne s'applique qu'après
-- que le privilège d'objet existe). Il n'est PAS une migration -- ne jamais
-- le copier vers migrations/ ni l'exécuter contre le projet partagé.
--
-- AJOUT (2026-07-22, harnais T3) : meme constat pour service_role. Sur un
-- vrai projet Supabase hébergé, service_role a deja acces a tout le schema
-- public (pose par la plateforme au provisioning, hors de tout fichier
-- versionne ici). En local, ce role n'a par defaut AUCUN privilege objet non
-- plus -- confirme empiriquement via PostgREST (403 "permission denied for
-- table seba_state", hint "GRANT SELECT ... TO service_role") en testant
-- l'edge function sync-push.ts (qui utilise le service role key) contre
-- l'environnement local. Sans ce grant, TOUTE edge function locale utilisant
-- createClient(url, SERVICE_ROLE_KEY) echoue silencieusement (une simple
-- ligne introuvable, pas une erreur explicite cote fonction).
--
-- STATUT EXPLICITE (2026-07-22, révisé Phase 1C) :
--   - LOCAL UNIQUEMENT. Ne représente PAS la source de vérité des privilèges
--     réels de production -- voir scripts/local-db/PRIVILEGE_COMPARISON.md
--     et scripts/local-db/REMOTE_PRIVILEGE_AUDIT_QUERIES.sql pour la
--     comparaison à établir manuellement.
--   - NE DOIT JAMAIS être déployé automatiquement, ni référencé par un
--     pipeline de déploiement, ni ajouté à `migrations/`.
--   - Devra être resserré ou remplacé une fois la comparaison avec le
--     projet distant obtenue (voir PRIVILEGE_COMPARISON.md) -- privilèges
--     actuellement volontairement larges (accès à toutes les tables) pour
--     débloquer les tests, pas un modèle de sécurité validé.
--   - GARDE-FOU : ce fichier n'est JAMAIS lu par migrations-order.txt (qui
--     ne connaît que [BASELINE] et [OVERLAY-RGPD]) -- rebuild.sh l'appelle
--     par un chemin direct et documenté (étape [3ter/5]), jamais via la
--     liste de migrations, précisément pour qu'il ne puisse pas se
--     retrouver mélangé à une future suite de migrations produit par
--     inadvertance.

grant usage on schema public to anon, authenticated, service_role;

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
    union
    select viewname from pg_views where schemaname = 'public'
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select on public.%I to anon', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Meme constat pour les fonctions : seul le proprietaire (postgres) a EXECUTE
-- par defaut en local. Les RPC deja publiees (create_profile_and_company,
-- close_my_intervention, erase_account_completely...) portent chacune leur
-- propre `grant execute ... to authenticated` explicite dans leur migration
-- -- inchange ici. Ce grant local ne vise QUE service_role, necessaire aux
-- edge functions (ex. apply_entity_patch appelee par sync-push.ts) et absent
-- par defaut, meme constat que les tables ci-dessus.
do $$
declare
  f record;
begin
  for f in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('grant execute on function public.%I(%s) to service_role', f.name, f.args);
  end loop;
end $$;
