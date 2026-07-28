-- ═══════════════════════════════════════════════════════════════
-- SEBA — Rend explicite le privilège EXECUTE de service_role sur
-- apply_entity_patch(text,text,text,jsonb,text).
--
-- CONTEXTE : 2026-07-28-sync-push-state-persistence.sql revoque EXECUTE
-- de public/anon/authenticated mais n'accorde jamais explicitement
-- EXECUTE à service_role. Vérifié empiriquement (has_function_privilege,
-- + 550 appels réels réussis via service_role pendant les tests locaux
-- de la migration initiale, jamais un seul échec de permission) :
-- service_role a DÉJÀ EXECUTE sur cette fonction, avant même cette
-- migration additive -- via les privilèges par défaut posés par la
-- plateforme Supabase sur le schéma public, pas via un GRANT explicite
-- de nos migrations. Il ne s'agit donc pas d'un correctif d'un appel RPC
-- cassé (aucun ne l'a jamais été), mais d'un durcissement légitime :
-- rendre ce privilège explicite dans nos migrations plutôt que de
-- dépendre silencieusement d'une convention de plateforme non documentée
-- ici -- un privilège aussi sensible que celui-ci ne devrait pas
-- dépendre uniquement d'un comportement implicite externe au dépôt.
-- ═══════════════════════════════════════════════════════════════

begin;

revoke all
on function public.apply_entity_patch(text, text, text, jsonb, text)
from public;

revoke all
on function public.apply_entity_patch(text, text, text, jsonb, text)
from anon;

revoke all
on function public.apply_entity_patch(text, text, text, jsonb, text)
from authenticated;

grant execute
on function public.apply_entity_patch(text, text, text, jsonb, text)
to service_role;

commit;
