// ═══════════════════════════════════════════════════════════════
// SEBA — Cœur de "conscience" partagé (Palier 4, durci au fine-tuning
// System Prompt / garde-fous de sécurité).
//
// Regroupe les responsabilités suivantes, jamais dupliquées ailleurs :
//   1. Garde-fous absolus (SEBA_SAFETY_RAILS) : cadre de sécurité commun
//      à tout agent produit, pas seulement assistant_technique.
//   2. Préparation du contexte : recherche sémantique (match_interventions,
//      via memoire-lookup.ts) + analytique financière (via
//      finance-analytics.ts), jamais l'historique/les données complètes.
//   3. Formatage du prompt système : règles métier Seba incorporées, texte
//      libre du LLM interdit de sortir du périmètre des extraits fournis.
//   4. Cache de contexte (ai_context_hash) — sert de mémoire courte pour
//      un agent : une situation déjà vue récemment pour un compte n'est
//      jamais recalculée par un appel LLM. C'est le sens donné ici à
//      "gestion de l'historique de conversation" : pas un historique
//      multi-tour (aucune fonctionnalité de conversation persistante
//      n'existe ailleurs dans le produit aujourd'hui pour s'y accrocher),
//      mais la mémoire de "qu'a-t-on déjà répondu pour ce contexte exact"
//      — voir RAPPORT-IMPLEMENTATION-PALIER4.md.
//   5. Orchestration des outils (RAG + analytique) avec interception
//      systématique des échecs — un outil qui échoue ne fait jamais
//      planter l'agent, il devient une absence de donnée explicite dans
//      le prompt (voir Garde-fou 1).
//
// Aucune clé API en dur : tout est lu via Deno.env.get(), mêmes noms que
// les Edge Functions déjà en production (MISTRAL_API_KEY, GROQ_API_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// IMPORTANT — ce qui N'EST PAS construit ici : une vraie boucle de
// function-calling où le LLM lui-même choisit ses outils via l'API native
// des fournisseurs (Mistral/Groq/Gemini tool-calling). Aucun appel LLM de
// ce projet (ai-relay.ts/daily-digest.ts/vision-qa.ts) n'utilise cette
// API à ce jour — product-agents.config.json reste une métadonnée
// descriptive consommée par CE module (routage déterministe côté
// TypeScript, pas par le modèle lui-même). "Optimiser les descriptions
// pour que le modèle choisisse ses outils" est donc un objectif à viser
// (prompts déjà écrits pour ça), pas encore un mécanisme actif — noté
// explicitement plutôt que de prétendre l'inverse.
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { lookupHistory, MemoireMatch } from './memoire-lookup.ts';
import { calculateProfitability, FinancialSummary, getFinancialSummary, InterventionProfitability } from './finance-analytics.ts';
import { enforceUsageGuardrail, LlmProvider } from './llm-providers.ts';

const FETCH_TIMEOUT_MS = 5000;

export interface ConscienceVerdict {
  action: string;
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

// Ré-exportée pour compatibilité : le type venait de ce fichier avant
// l'extraction de la recherche vectorielle vers memoire-lookup.ts.
export type { MemoireMatch };

/** Client Supabase service_role — un seul par isolat, réutilisé entre invocations à chaud (même pattern que toutes les autres fonctions du projet). */
export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ═══════════════════════════════════════════════════════════════
// GARDE-FOUS ABSOLUS (Safety Rails) — cadre commun à tout agent produit,
// pas seulement assistant_technique. Exporté séparément pour qu'un futur
// agent (conscience_predictive, ou un nouvel agent) puisse le réutiliser
// sans dupliquer le texte.
// ═══════════════════════════════════════════════════════════════
export const SEBA_SAFETY_RAILS =
  "RÈGLE 1 (Anti-hallucination) : Ne jamais inventer une marge, un prix, un diagnostic ou un fait technique. " +
  "Si un outil ne renvoie aucune donnée, déclare explicitement que l'information est absente — ne jamais deviner ni extrapoler à partir de cas généraux.\n" +
  "RÈGLE 2 (Sécurité) : Ne jamais afficher d'identifiant technique brut (UUID, account_id, référence bancaire ou de transaction) dans la réponse finale. " +
  "Utilise uniquement des libellés compréhensibles par un humain (nom de client si fourni, date, montant, type d'intervention).\n" +
  "RÈGLE 3 (Traçabilité) : Toute recommandation technique DOIT s'appuyer sur les extraits de mémoire vectorielle fournis ci-dessous — " +
  "jamais une réponse générique sans ancrage dans l'historique réel de ce compte. Si aucun extrait n'est pertinent, le dire plutôt que de généraliser.";

const CONSCIENCE_SYSTEM =
  "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
  'Réponds uniquement en JSON structuré : {"action":"titre court","priority":"high/medium/low","reasoning":"une phrase"}. ' +
  "Analyse le contexte et propose UNE mesure concrète si utile.";

// Agent "assistant_conversationnel" (product-agents.config.json, mode
// 'chat' de ai-relay.ts) — centralisé ici comme les autres System Prompts
// pour qu'ai-relay.ts n'ait plus aucun prompt en dur (voir PLAN.md dette
// technique "Brancher ai-relay.ts ... sur conscience-seba.ts").
export const ASSISTANT_CONVERSATIONNEL_SYSTEM =
  "Tu es l'assistant business de Seba, un logiciel de gestion pour entreprises de services. " +
  "Réponds en français, concis (max 120 mots), concret et actionnable, au patron de l'entreprise. ";

const ASSISTANT_TECHNIQUE_SYSTEM =
  "Tu es l'expert technique et financier du réseau SEBA. Tu assistes les techniciens terrain et les patrons " +
  "d'entreprises de services dans leurs décisions d'intervention et de rentabilité.\n\n" +
  "GARDE-FOUS ABSOLUS :\n" + SEBA_SAFETY_RAILS + "\n\n" +
  "Réponds en français, concis, concret, sans jargon inutile.";

// ═══ TIER 0/2 — décision déterministe avant tout appel LLM ═══
// Le LLM ne doit jamais halluciner un chiffre déjà calculable par du code
// pur (voir VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md, section Mistral —
// c'est la même logique que la Règle 1 des garde-fous ci-dessus).
export function decideDeterministe(ctx: { facturesEnRetard: number; devisEnAttente: number }): ConscienceVerdict | null {
  if (ctx.facturesEnRetard >= 5) {
    return { action: 'Relancer les impayés en masse', priority: 'high', reasoning: `${ctx.facturesEnRetard} factures en retard, seuil critique dépassé.` };
  }
  return null; // cas intermediaire ou rien a signaler -> tier2 (appelant decide s'il vaut la peine d'appeler le LLM)
}

// ═══ Dette technique corrigée : l'ancienne signature (callbacks anonymes)
// avalait silencieusement toute erreur — panne réseau ET JSON malformé
// indistinctement, aucun log, impossible de diagnostiquer laquelle des
// deux se produit en prod. Prend maintenant directement LLM_PROVIDERS
// (_shared/llm-providers.ts) : reseau et parsing JSON sont journalisés
// séparément, et le nom du provider gagnant est renvoyé (utile pour
// ai-relay.ts/daily-digest.ts, qui l'exposaient déjà avant ce refactor). ═══
export async function decideAvecLLM(
  ctx: Record<string, unknown>,
  providers: LlmProvider[],
): Promise<{ verdict: ConscienceVerdict; provider: string } | null> {
  // Disjoncteur global de coût (voir _shared/llm-providers.ts) : appelée
  // ici aussi, pas seulement dans callWithFallback(), car cette fonction
  // contacte directement les mêmes providers payants sans passer par
  // callWithFallback (ai-relay.ts mode 'json' et daily-digest.ts).
  // Volontairement PAS de try/catch ici : DAILY_LIMIT_REACHED doit
  // remonter tel quel jusqu'à l'appelant (ex. daily-digest.ts, qui doit
  // pouvoir distinguer "disjoncteur ouvert" d'un simple échec de
  // provider pour arrêter sa boucle proprement plutôt que de continuer à
  // tester 40+ comptes en pure perte).
  await enforceUsageGuardrail();
  const user = JSON.stringify(ctx);
  for (const p of providers) {
    let raw: string;
    try {
      raw = await p.call(CONSCIENCE_SYSTEM, user, true);
    } catch (e) {
      console.error(`[conscience-seba] decideAvecLLM: provider "${p.name}" indisponible, bascule sur le suivant :`, String((e as Error)?.message || e));
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.action && parsed?.priority) return { verdict: parsed as ConscienceVerdict, provider: p.name };
      console.error(`[conscience-seba] decideAvecLLM: réponse JSON du provider "${p.name}" incomplète (action/priority manquants), bascule sur le suivant.`);
    } catch (e) {
      console.error(`[conscience-seba] decideAvecLLM: échec de parsing JSON pour le provider "${p.name}" (bascule sur le suivant) :`, String((e as Error)?.message || e));
    }
  }
  return null;
}

// ═══ Contexte borné en nombre d'éléments, jamais tronqué à l'aveugle ═══
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

// ═══ Cache de contexte (ai_context_hash) ═══
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

// ═══════════════════════════════════════════════════════════════
// Outil calculate_profitability/get_financial_summary : déclenchement
// conditionnel (contrairement à lookup_history, "obligatoire" pour cet
// agent — voir plus bas). Heuristique par mots-clés, DÉTERMINISTE,
// volontairement PAS un appel LLM supplémentaire pour classer une simple
// question courte — même principe que derive_type_alerte() (Palier 3,
// supabase-schema.sql section 15) : un classifieur LLM pour cette
// décision coûterait plus cher et serait moins prévisible qu'une liste de
// mots-clés, pour un gain de précision marginal sur ce cas d'usage.
// ═══════════════════════════════════════════════════════════════
const FINANCIAL_KEYWORDS = /co[uû]t|prix|marge|rentab|remplac|cher|ch[eè]re|budget|factur|pay[ée]|paiement|d[ée]pense|rembours/i;

export function questionConcerneFinance(question: string): boolean {
  return FINANCIAL_KEYWORDS.test(question);
}

export interface FinancialToolResult {
  profitability: InterventionProfitability | null;
  summary: FinancialSummary | null;
}

/**
 * Formate le contexte financier en texte pour le prompt — jamais
 * `account`/ids bruts (Garde-fou 2), uniquement des montants agrégés
 * lisibles. Absence de données rendue EXPLICITE (Garde-fou 1) : jamais un
 * silence qui laisserait le LLM deviner.
 */
export function formatFinancialContext(result: FinancialToolResult | null): string | null {
  if (!result) return null;
  const parts: string[] = [];

  if (result.profitability) {
    const p = result.profitability;
    parts.push(
      `Marge de l'intervention concernée : revenu ${p.revenu.toFixed(2)} €, coût matériaux ${p.coutMateriaux.toFixed(2)} €, ` +
      `marge ${p.marge.toFixed(2)} €` + (p.margePct !== null ? ` (${p.margePct}%).` : ' (pourcentage non calculable, revenu nul).'),
    );
  } else {
    parts.push("Aucune donnée de marge trouvée pour l'intervention concernée.");
  }

  if (result.summary && result.summary.interventionsCount > 0) {
    const s = result.summary;
    parts.push(
      `Résumé financier du compte : ${s.interventionsCount} intervention(s) chiffrée(s), marge totale ${s.margeTotale.toFixed(2)} €` +
      (s.margePctMoyenne !== null ? ` (${s.margePctMoyenne}% en moyenne).` : '.'),
    );
  } else {
    parts.push("Aucune donnée financière agrégée disponible pour ce compte.");
  }

  return parts.join('\n');
}

// ═══ Formatage du prompt système "assistant_technique" ═══
// Incorpore les garde-fous + les extraits pertinents (mémoire vectorielle)
// + le contexte financier si l'outil a été déclenché — jamais un
// historique/des données complètes chargées en vrac.
export function formatAssistantTechniquePrompt(matches: MemoireMatch[], financials: FinancialToolResult | null = null): string {
  const sections = [ASSISTANT_TECHNIQUE_SYSTEM];

  if (!matches.length) {
    sections.push('Aucun historique pertinent trouvé pour cette question.');
  } else {
    const extraits = matches
      .map((m, i) => `[${i + 1}] (pertinence ${(m.similarity * 100).toFixed(0)}%) ${m.content}`)
      .join('\n');
    sections.push('Extraits pertinents (du plus au moins pertinent) :\n' + extraits);
  }

  const financialText = formatFinancialContext(financials);
  if (financialText) sections.push('Contexte financier :\n' + financialText);

  return sections.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════
// RAG + analytique — orchestration des outils de l'agent assistant_technique
// (product-agents.config.json, agents.assistant_technique.tools).
//
// lookup_history : "Si la question concerne l'historique technique" — pour
// CET agent précis, c'est toujours vrai — son seul rôle est de répondre
// sur l'historique d'une intervention/d'un client. Il n'existe aucun
// classifieur d'intention réel dans ce projet pour cette partie non plus
// (même raisonnement que le mot-clé financier ci-dessus aurait pu s'y
// appliquer, mais aucun cas d'usage concret ne le justifie ici) : la
// condition est structurellement remplie par la nature même de cet agent,
// lookupHistory() est donc appelée systématiquement — CE choix reste
// intentionnel, pas un oubli de routage.
//
// calculate_profitability/get_financial_summary : déclenchés SEULEMENT si
// questionConcerneFinance(question) est vrai. calculateProfitability en
// plus nécessite un interventionId connu (transmis par l'appelant quand
// le technicien travaille sur une intervention précise) — sans lui, seul
// le résumé agrégé du compte est consulté.
//
// GESTION DES ÉCHECS D'OUTIL : lookupHistory/calculateProfitability/
// getFinancialSummary ne lèvent déjà jamais (chacune retourne un résultat
// vide/null en cas d'erreur, voir leurs fichiers respectifs) — le
// .catch() ci-dessous est une DEUXIÈME barrière (défense en profondeur,
// même style que le try/catch de vision-qa.ts autour de storeEmbedding) :
// même si une évolution future d'un de ces outils se met à lever une
// exception, l'agent ne plante jamais, il traite juste l'outil comme
// ayant renvoyé "aucune donnée" (Garde-fou 1).
// ═══════════════════════════════════════════════════════════════
export async function prepareAssistantTechniqueContext(
  supa: SupabaseClient,
  account: string,
  question: string,
  opts?: { threshold?: number; limit?: number; interventionId?: string },
): Promise<{ systemPrompt: string; matches: MemoireMatch[]; financials: FinancialToolResult | null }> {
  const matches = await lookupHistory(supa, question, account, opts).catch((e) => {
    console.error('[conscience-seba] tool lookup_history a échoué (intercepté, jamais un crash) :', String((e as Error)?.message || e));
    return [] as MemoireMatch[];
  });

  let financials: FinancialToolResult | null = null;
  if (questionConcerneFinance(question)) {
    const [profitability, summary] = await Promise.all([
      opts?.interventionId
        ? calculateProfitability(supa, account, opts.interventionId).catch((e) => {
            console.error('[conscience-seba] tool calculate_profitability a échoué (intercepté) :', String((e as Error)?.message || e));
            return null;
          })
        : Promise.resolve(null),
      getFinancialSummary(supa, account).catch((e) => {
        console.error('[conscience-seba] tool get_financial_summary a échoué (intercepté) :', String((e as Error)?.message || e));
        return null;
      }),
    ]);
    financials = { profitability, summary };
  }

  const systemPrompt = formatAssistantTechniquePrompt(matches, financials);
  return { systemPrompt, matches, financials };
}
