// ═══════════════════════════════════════════════════════════════
// SEBA — Chaîne de fallback des fournisseurs LLM texte.
//
// Extrait de ai-relay.ts (qui définissait ces 4 fonctions + son propre
// tableau PROVIDERS en interne) pour que assistant-technique.ts puisse les
// réutiliser sans les dupliquer une 3e fois. ai-relay.ts et daily-digest.ts
// gardent pour l'instant leur propre copie — leur bascule vers ce module
// partagé est un point de dette technique distinct (voir PLAN.md,
// "Brancher ai-relay.ts et daily-digest.ts sur conscience-seba.ts"), pas
// traité ici pour ne pas mélanger deux changements dans un même commit.
//
// Ordre et modèles identiques à product-agents.config.json
// (sharedProviders.chat) : Mistral → Groq → OpenRouter → Gemini, le
// premier qui répond gagne, un échec (clé absente ou fournisseur en
// panne) passe silencieusement au suivant.
// ═══════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 5000;

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

async function callGemini(system: string, user: string, _jsonMode: boolean): Promise<string> {
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
        generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
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

/**
 * Essaie chaque provider dans l'ordre jusqu'à ce que l'un renvoie une
 * réponse non vide. Ne lève jamais — retourne `null` si tous échouent,
 * laissant l'appelant décider de la réponse à renvoyer (Garde-fou 1 de
 * conscience-seba.ts : jamais de réponse inventée en remplacement).
 */
export async function callWithFallback(
  system: string,
  user: string,
  jsonMode = false,
): Promise<{ answer: string; provider: string } | null> {
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
