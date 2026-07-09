-- ═══════════════════════════════════════════════════════════════
-- SEBA — Disjoncteur GLOBAL de coût LLM (Tech Lead & Sécurité Cloud).
--
-- DISTINCT du quota PAR COMPTE déjà existant (`api_usage`, section 0b de
-- supabase-schema.sql, colonnes account/kind/day) : celui-ci protège
-- l'app d'un tenant abusif, un plafond par compte. `api_usage_daily`
-- protège les CLÉS API PARTAGÉES par toute l'app (une seule clé Mistral/
-- Groq/Gemini/OpenRouter pour tous les comptes, voir MANUEL-SEBA-
-- ADMIN.md section 1b) d'un dépassement de coût agrégé, même si chaque
-- compte individuellement reste sous son propre plafond. Les deux
-- coexistent, aucun ne remplace l'autre.
--
-- FAIL-CLOSED, volontairement à l'opposé du fail-open de checkRateLimit()
-- (api_usage, ai-relay.ts/vision-qa.ts/assistant-technique.ts) : un
-- garde-fou de COÛT doit bloquer s'il ne peut pas se vérifier lui-même,
-- un garde-fou de confort UX peut se permettre de laisser passer. Voir
-- _shared/llm-providers.ts (enforceUsageGuardrail) pour l'implémentation
-- côté Edge Function.
--
-- Sécurité : RLS actif SANS AUCUNE policy = bloque tout accès direct,
-- même au propriétaire d'un compte (ce compteur n'a aucune notion de
-- compte, l'exposer permettrait à N'IMPORTE QUEL utilisateur authentifié
-- de lire/déduire la consommation globale de toute la plateforme — même
-- pattern que api_usage/ai_context_hash/employe_credentials).
-- `revoke execute` sur increment_api_usage() : sans ça, n'importe quel
-- utilisateur authentifié pourrait appeler cette RPC directement (sans
-- jamais réellement interroger un LLM) pour faire déclencher le
-- disjoncteur global à volonté — un vecteur de déni de service
-- cross-tenant trivial sur toute la plateforme. Seul service_role (les
-- Edge Functions) doit pouvoir l'appeler.
-- ═══════════════════════════════════════════════════════════════

-- ── Compteur global de requêtes LLM par jour ──
create table if not exists api_usage_daily (
  date date primary key default current_date,
  request_count int not null default 0
);
alter table api_usage_daily enable row level security;
-- Pas de policy : accès bloqué à tout le monde sauf service_role.

-- ── Incrémente le compteur du jour, retourne le total actuel ──
create or replace function increment_api_usage()
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  insert into api_usage_daily (date, request_count)
  values (current_date, 1)
  on conflict (date) do update set request_count = api_usage_daily.request_count + 1
  returning request_count into v_count;
  return v_count;
end;
$$;
revoke execute on function increment_api_usage() from public, anon, authenticated;
