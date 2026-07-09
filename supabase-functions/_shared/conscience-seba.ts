// ═══════════════════════════════════════════════════════════════
// SEBA — Cœur de "conscience" partagé (Palier 4).
//
// Regroupe 3 responsabilités, jamais dupliquées ailleurs :
//   1. Préparation du contexte : recherche sémantique (match_interventions,
//      supabase-schema.sql section 20) — jamais l'historique complet.
//   2. Formatage du prompt système : règles métier Seba incorporées, texte
//      libre du LLM interdit de sortir du périmètre des extraits fournis.
//   3. Cache de contexte (ai_context_hash, section 21) — sert de mémoire
//      courte pour un agent : une situation déjà vue récemment pour un
//      compte n'est jamais recalculée par un appel LLM. C'est le sens
//      donné ici à "gestion de l'historique de conversation" : pas un
//      historique multi-tour (aucune fonctionnalité de conversation
//      persistante n'existe ailleurs dans le produit aujourd'hui pour s'y
//      accrocher), mais la mémoire de "qu'a-t-on déjà répondu pour ce
//      contexte exact" — voir RAPPORT-IMPLEMENTATION-PALIER4.md.
//
// Aucune clé API en dur : tout est lu via Deno.env.get(), mêmes noms que
// les Edge Functions déjà en production (MISTRAL_API_KEY, GROQ_API_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embed } from './embeddings.ts';

const FETCH_TIMEOUT_MS = 5000;

export interface ConscienceVerdict {
  action: string;
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface MemoireMatch {
  id: string;
  intervention_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

const CONSCIENCE_SYSTEM =
  "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
  'Réponds uniquement en JSON structuré : {"action":"titre court","priority":"high/medium/low","reasoning":"une phrase"}. ' +
  "Analyse le contexte et propose UNE mesure concrète si utile.";

const ASSISTANT_TECHNIQUE_SYSTEM =
  "Tu es l'assistant technique de Seba. Tu réponds aux questions d'un professionnel de terrain sur " +
  "l'historique d'une intervention ou d'un client, en te basant STRICTEMENT sur les extraits fournis " +
  "ci-dessous (ne jamais inventer un fait absent des extraits — répondre \"aucune information trouvée\" " +
  "plutôt que de deviner). Réponds en français, concis, concret, sans jargon inutile.";

/** Client Supabase service_role — un seul par isolat, réutilisé entre invocations à chaud (même pattern que toutes les autres fonctions du projet). */
export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ═══ 1. TIER 0/2 — décision déterministe avant tout appel LLM ═══
// Le LLM ne doit jamais halluciner un chiffre déjà calculable par du code
// pur (voir VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md, section Mistral).
export function decideDeterministe(ctx: { facturesEnRetard: number; devisEnAttente: number }): ConscienceVerdict | null {
  if (ctx.facturesEnRetard >= 5) {
    return { action: 'Relancer les impayés en masse', priority: 'high', reasoning: `${ctx.facturesEnRetard} factures en retard, seuil critique dépassé.` };
  }
  return null; // cas intermediaire ou rien a signaler -> tier2 (appelant decide s'il vaut la peine d'appeler le LLM)
}

export async function decideAvecLLM(
  ctx: Record<string, unknown>,
  providers: Array<(system: string, user: string) => Promise<string>>,
): Promise<ConscienceVerdict | null> {
  for (const call of providers) {
    try {
      const raw = await call(CONSCIENCE_SYSTEM, JSON.stringify(ctx));
      const parsed = JSON.parse(raw);
      if (parsed?.action && parsed?.priority) return parsed as ConscienceVerdict;
    } catch { /* fournisseur suivant */ }
  }
  return null;
}

// ═══ 2. Contexte borné en nombre d'éléments, jamais tronqué à l'aveugle ═══
// Corrige le JSON.stringify(context).slice(0, 2000|4000) de ai-relay.ts
// (peut couper un JSON en plein milieu, produisant un contexte invalide
// envoyé au modèle) — voir Dette Technique, PLAN.md P4.
export function buildStructuredContext(raw: Record<string, unknown>, maxItemsPerList = 10): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      out[key + 'Total'] = value.length;
      out[key] = value.slice(0, maxItemsPerList);
      if (value.length > maxItemsPerList) out[key + 'Tronque'] = true;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ═══ 3. Cache de contexte (ai_context_hash) ═══
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Enveloppe tout calcul IA coûteux : si le même contexte (même hash) a déjà
 * été traité pour ce compte/cet agent, la réponse en cache est réutilisée
 * SANS appeler le LLM. `compute` n'est invoqué qu'au premier appel pour un
 * contexte donné.
 */
export async function withContextCache<T>(
  supa: SupabaseClient,
  account: string,
  agent: string,
  context: unknown,
  compute: () => Promise<T | null>,
): Promise<T | null> {
  const hash = await sha256Hex(JSON.stringify(context));

  const { data: cached } = await supa
    .from('ai_context_hash')
    .select('response')
    .match({ account, agent, context_hash: hash })
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
    .maybeSingle();
  if (cached) return cached.response as T;

  const result = await compute();
  if (result) {
    const { error } = await supa
      .from('ai_context_hash')
      .upsert({ account, agent, context_hash: hash, response: result })
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
    if (error) console.warn('[conscience-seba] cache ai_context_hash non écrit (best-effort) :', error.message);
  }
  return result;
}

// ═══ 4. Préparation du contexte : recherche sémantique ═══
// `account` DOIT être résolu par l'appelant à partir du JWT (jamais un
// champ envoyé tel quel par un client) : match_interventions() n'a pas
// d'autre frontière de sécurité sous une connexion service_role (voir
// supabase-schema.sql section 20).
export async function lookupHistory(
  supa: SupabaseClient,
  account: string,
  query: string,
  opts?: { matchThreshold?: number; matchCount?: number },
): Promise<MemoireMatch[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (e) {
    console.error('[conscience-seba] lookupHistory: embedding de la requête a échoué', String((e as Error)?.message || e));
    return []; // jamais bloquant : pas d'historique trouvé, pas une erreur qui casse l'appelant
  }

  const { data, error } = await supa
    .rpc('match_interventions', {
      p_account: account,
      query_embedding: queryEmbedding,
      match_threshold: opts?.matchThreshold ?? 0.75,
      match_count: opts?.matchCount ?? 5,
    })
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  if (error) {
    console.error('[conscience-seba] lookupHistory: match_interventions a échoué', error.message);
    return [];
  }
  return (data as MemoireMatch[]) ?? [];
}

// ═══ 5. Formatage du prompt système "assistant_technique" ═══
// Incorpore les règles métier Seba (ne jamais inventer un fait) + les
// extraits pertinents formatés en contexte texte, jamais un historique
// complet chargé en vrac.
export function formatAssistantTechniquePrompt(matches: MemoireMatch[]): string {
  if (!matches.length) {
    return ASSISTANT_TECHNIQUE_SYSTEM + '\n\nAucun historique pertinent trouvé pour cette question.';
  }
  const extraits = matches
    .map((m, i) => `[${i + 1}] (pertinence ${(m.similarity * 100).toFixed(0)}%) ${m.content}`)
    .join('\n');
  return ASSISTANT_TECHNIQUE_SYSTEM + '\n\nExtraits pertinents (du plus au moins pertinent) :\n' + extraits;
}
