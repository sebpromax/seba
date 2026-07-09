// ═══════════════════════════════════════════════════════════════
// SEBA — Relais IA unifié (remplace groq-chat.ts + seba-ai-mistral.ts)
//
// Un site 100% statique (GitHub Pages) ne peut jamais cacher une clé
// secrète : cette fonction tourne côté serveur Supabase à la place.
// Elle reçoit la question/contexte du navigateur et essaie les
// fournisseurs IA gratuits dans l'ordre, jusqu'à ce qu'un réponde
// (clé absente ou fournisseur en panne = passage silencieux au
// suivant) :
//   1. Mistral (mistral-small-latest)
//   2. Groq (llama-3.1-8b-instant)
//   3. OpenRouter (modèle :free)
//   4. Google Gemini (gemini-2.0-flash)
//
// Deux modes (body.mode) :
//   'chat' -> réponse texte libre (assistant conversationnel dashboard)
//   'json' -> réponse structurée {action, priority, reasoning}
//             (« Conscience Seba », Bible V.1)
//
// Durcissement sécurité par rapport aux 2 anciennes fonctions
// (trouvé par l'audit du 2026-07-06 : CORS '*' + aucune vérification
// d'identité + aucune limite de débit = n'importe qui avec l'URL
// Supabase + la clé anon publique pouvait consommer tout le quota) :
//   - CORS restreint aux origines autorisées (plus de '*')
//   - Le caller doit fournir un vrai JWT de session (auth.uid())
//   - Plafond de requêtes/jour/compte via la table api_usage
//     (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées
//     automatiquement par Supabase dans toute Edge Function, aucun
//     secret à configurer pour ça)
//
// Déploiement : voir MANUEL-SEBA-ADMIN.md section 1b (mise à jour).
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const DAILY_LIMIT = 50;
// Audit go-live (AUDIT-GO-LIVE-SEBA.md, section 2) : aucun appel reseau
// sortant n'avait de limite de temps propre a l'application, exposant
// l'invocation entiere a la limite d'execution de la plateforme au lieu
// d'un echec controle. AbortSignal.timeout() plutot qu'un
// AbortController+setTimeout manuel : meme resultat ({signal: ...}),
// nettoyage automatique du timer, pas de risque de fuite si le fetch
// resout avant l'echeance.
const FETCH_TIMEOUT_MS = 5000;

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/* JWT du caller -> auth.uid(), décodage synchrone (pas d'appel réseau) */
function verifyUser(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const jwt = header.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt.split('.').length !== 3) return null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

/* Plafond quotidien par compte (table api_usage, kind='ai'). En cas
   d'erreur réseau/config, on n'empêche jamais la requête de passer
   (fail-open) — mieux vaut un usage non limité temporairement qu'un
   assistant qui plante. */
async function checkRateLimit(userId: string): Promise<boolean> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) return true;
  const today = new Date().toISOString().slice(0, 10);
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  try {
    const res = await fetch(
      supaUrl + '/rest/v1/api_usage?select=count&account=eq.' + encodeURIComponent(userId) + "&kind=eq.ai&day=eq." + today,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const rows = res.ok ? await res.json() : [];
    const count = rows.length ? rows[0].count : 0;
    if (count >= DAILY_LIMIT) return false;
    await fetch(supaUrl + '/rest/v1/api_usage?on_conflict=account,kind,day', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account: userId, kind: 'ai', day: today, count: count + 1 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return true;
  } catch {
    return true;
  }
}

const CHAT_SYSTEM =
  "Tu es l'assistant business de Seba, un logiciel de gestion pour entreprises de services. " +
  'Réponds en français, concis (max 120 mots), concret et actionnable, au patron de l\'entreprise. ';

const JSON_SYSTEM =
  "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
  'Ton ton est analytique, concis, et tourné vers l\'action. Tu reçois des données JSON de performance. ' +
  'Tu dois répondre uniquement en JSON structuré : ' +
  '{ "action": "titre court", "priority": "high/medium/low", "reasoning": "une phrase expliquant pourquoi" }. ' +
  "Analyse le contexte et propose des mesures de redressement ou d'optimisation.";

type Provider = { name: string; call: (system: string, user: string, jsonMode: boolean) => Promise<string> };

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

const PROVIDERS: Provider[] = [
  { name: 'mistral', call: callMistral },
  { name: 'groq', call: callGroq },
  { name: 'openrouter', call: callOpenRouter },
  { name: 'gemini', call: callGemini },
];

function fallbackJson(reasoning: string) {
  return { action: 'Analyse indisponible', priority: 'low', reasoning };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const userId = verifyUser(req);
  if (!userId) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const allowed = await checkRateLimit(userId);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne atteinte, réessayez demain' }, 429);

  try {
    const body = await req.json();
    const mode = body.mode === 'json' ? 'json' : 'chat';

    if (mode === 'chat') {
      const question = body.question;
      if (!question || typeof question !== 'string' || question.length > 500) {
        return jsonResponse(cors, { error: 'Question invalide' }, 400);
      }
      const system = CHAT_SYSTEM + (body.context ? 'Données réelles actuelles de son entreprise : ' + JSON.stringify(body.context).slice(0, 2000) : 'Aucune donnée disponible pour le moment.');
      for (const p of PROVIDERS) {
        try {
          const answer = await p.call(system, String(question).slice(0, 500), false);
          if (answer) return jsonResponse(cors, { answer, provider: p.name });
        } catch { /* fournisseur suivant */ }
      }
      return jsonResponse(cors, { error: 'Tous les fournisseurs IA sont indisponibles' }, 502);
    }

    // mode 'json' — Conscience Seba
    if (!body.context || typeof body.context !== 'object') {
      return jsonResponse(cors, { error: 'Contexte invalide' }, 400);
    }
    for (const p of PROVIDERS) {
      try {
        const raw = await p.call(JSON_SYSTEM, JSON.stringify(body.context).slice(0, 4000), true);
        const parsed = JSON.parse(raw);
        if (parsed && parsed.action && parsed.priority) return jsonResponse(cors, { ...parsed, provider: p.name });
      } catch { /* fournisseur suivant */ }
    }
    return jsonResponse(cors, fallbackJson('Tous les fournisseurs IA sont indisponibles.'));
  } catch (e) {
    return jsonResponse(cors, { error: String((e as Error)?.message || e) }, 500);
  }
});
