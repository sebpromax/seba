// ═══════════════════════════════════════════════════════════════
// SEBA — Chaîne de fallback des fournisseurs LLM texte.
//
// Extrait à l'origine de ai-relay.ts, désormais le point de passage
// UNIQUE vers Mistral/Groq/OpenRouter/Gemini pour tout le projet :
// ai-relay.ts (callWithFallback, mode chat), assistant-technique.ts
// (callWithFallback), et ai-relay.ts/daily-digest.ts (decideAvecLLM,
// _shared/conscience-seba.ts, qui consomme LLM_PROVIDERS directement).
//
// Ordre et modèles identiques à product-agents.config.json
// (sharedProviders.chat) : Mistral → Groq → OpenRouter → Gemini, le
// premier qui répond gagne, un échec (clé absente ou fournisseur en
// panne) passe silencieusement au suivant.
// ═══════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 5000;
const MAX_DAILY_REQUESTS_DEFAULT = 50;

export type LlmCall = (system: string, user: string, jsonMode: boolean) => Promise<string>;
export interface LlmProvider {
  name: string;
  call: LlmCall;
}

async function callMistral(system: string, user: string, jsonMode: boolean): Promise<string> {
  const key = Deno.env.get('MISTRAL_API_KEY');
  if (!key) throw new Error('MISTRAL_API_KEY absente');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      max_tokens: 400, temperature: 0.4,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('Mistral HTTP ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGroq(system: string, user: string, _jsonMode: boolean): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY absente');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 400, temperature: 0.4,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('Groq HTTP ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenRouter(system: string, user: string, _jsonMode: boolean): Promise<string> {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) throw new Error('OPENROUTER_API_KEY absente');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 400, temperature: 0.4,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('OpenRouter HTTP ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(system: string, user: string, jsonMode: boolean): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY absente');
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: 400, temperature: 0.4,
          // Meme pattern que vision-qa.ts (callGeminiVision) : force un JSON
          // syntaxiquement valide cote provider plutot que de compter
          // uniquement sur l'instruction textuelle du system prompt.
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export const LLM_PROVIDERS: LlmProvider[] = [
  { name: 'mistral', call: callMistral },
  { name: 'groq', call: callGroq },
  { name: 'openrouter', call: callOpenRouter },
  { name: 'gemini', call: callGemini },
];

// ═══════════════════════════════════════════════════════════════
// Disjoncteur GLOBAL de coût (tous comptes confondus), voir
// migrations/20260709_create_api_usage_guardrail.sql.
//
// DISTINCT du quota PAR COMPTE (table api_usage, checkRateLimit() dans
// ai-relay.ts/vision-qa.ts/assistant-technique.ts) : celui-ci protège les
// clés API PARTAGÉES par toute l'app (une seule clé Mistral/Groq/Gemini/
// OpenRouter pour tous les comptes) d'un dépassement de coût agrégé,
// même si chaque compte individuellement reste sous son propre plafond.
// Les deux coexistent, aucun ne remplace l'autre.
//
// FAIL-CLOSED, volontairement à L'OPPOSÉ du fail-open de checkRateLimit()
// partout ailleurs dans ce projet ("mieux vaut un usage non limité
// temporairement qu'un assistant qui plante") : un garde-fou de COÛT doit
// bloquer s'il ne peut pas se vérifier lui-même, un garde-fou de confort
// UX peut se permettre de laisser passer. NE PAS "harmoniser" cette
// asymétrie avec le reste du code — c'est un choix délibéré, pas un
// oubli.
// ═══════════════════════════════════════════════════════════════

/**
 * Incrémente puis vérifie le compteur global du jour (RPC
 * increment_api_usage, service_role uniquement). Lève
 * `Error('DAILY_LIMIT_REACHED')` si le plafond (MAX_DAILY_REQUESTS, 50
 * par défaut) est dépassé, OU si la vérification elle-même est
 * impossible (config Supabase absente, réseau, RPC en erreur) —
 * fail-closed, jamais un appel LLM laissé passer sans certitude d'être
 * sous le plafond.
 */
export async function enforceUsageGuardrail(): Promise<void> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const maxDaily = Number(Deno.env.get('MAX_DAILY_REQUESTS')) || MAX_DAILY_REQUESTS_DEFAULT;

  if (!supaUrl || !serviceKey) {
    console.error('[llm-providers] enforceUsageGuardrail: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absents, impossible de vérifier le quota global — appel bloqué (fail-closed).');
    throw new Error('DAILY_LIMIT_REACHED');
  }

  let count: number;
  try {
    const res = await fetch(supaUrl + '/rest/v1/rpc/increment_api_usage', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error('increment_api_usage HTTP ' + res.status);
    count = await res.json();
    if (typeof count !== 'number') throw new Error('increment_api_usage a renvoyé une réponse inattendue');
  } catch (e) {
    console.error('[llm-providers] enforceUsageGuardrail: vérification du quota global impossible — appel bloqué (fail-closed) :', String((e as Error)?.message || e));
    throw new Error('DAILY_LIMIT_REACHED');
  }

  if (count > maxDaily) {
    console.error(`[llm-providers] enforceUsageGuardrail: quota global quotidien dépassé (${count}/${maxDaily}) — appel bloqué.`);
    throw new Error('DAILY_LIMIT_REACHED');
  }
}

/**
 * Essaie chaque provider dans l'ordre jusqu'à ce que l'un renvoie une
 * réponse non vide. Ne lève jamais pour un échec de provider (réseau/clé
 * absente) — retourne `null` si tous échouent, laissant l'appelant
 * décider de la réponse à renvoyer (Garde-fou 1 de conscience-seba.ts :
 * jamais de réponse inventée en remplacement). PEUT en revanche lever
 * `Error('DAILY_LIMIT_REACHED')` AVANT même de contacter un provider, si
 * enforceUsageGuardrail() bloque l'appel — volontairement laissé remonter
 * (pas de catch ici) pour que l'appelant distingue explicitement "aucun
 * provider n'a répondu" de "le disjoncteur de coût est ouvert".
 */
export async function callWithFallback(
  system: string,
  user: string,
  jsonMode = false,
): Promise<{ answer: string; provider: string } | null> {
  await enforceUsageGuardrail();
  for (const p of LLM_PROVIDERS) {
    try {
      const answer = await p.call(system, user, jsonMode);
      if (answer) return { answer, provider: p.name };
    } catch {
      /* fournisseur suivant */
    }
  }
  return null;
}
