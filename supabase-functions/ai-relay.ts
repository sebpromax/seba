// ═══════════════════════════════════════════════════════════════
// SEBA — Relais IA unifié (remplace groq-chat.ts + seba-ai-mistral.ts)
//
// Un site 100% statique (GitHub Pages) ne peut jamais cacher une clé
// secrète : cette fonction tourne côté serveur Supabase à la place.
// Elle reçoit la question/contexte du navigateur et essaie les
// fournisseurs IA gratuits dans l'ordre, jusqu'à ce qu'un réponde
// (clé absente ou fournisseur en panne = passage silencieux au
// suivant) — chaîne de fallback centralisée dans _shared/llm-providers.ts
// (Mistral → Groq → OpenRouter → Gemini), et non plus dupliquée ici
// (dette technique PLAN.md "Brancher ai-relay.ts ... sur conscience-seba.ts").
//
// Deux modes (body.mode) :
//   'chat' -> réponse texte libre (assistant conversationnel dashboard)
//   'json' -> réponse structurée {action, priority, reasoning}
//             (« Conscience Seba », Bible V.1) — via decideAvecLLM()
//             (_shared/conscience-seba.ts), System Prompt centralisé.
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
// Correction dette technique (PLAN.md) : l'ancien
// JSON.stringify(body.context).slice(0, 2000|4000) pouvait tronquer un
// JSON en plein milieu d'un élément, produisant un contexte invalide
// envoyé au modèle. Remplacé par buildStructuredContext()
// (_shared/conscience-seba.ts), qui borne le contexte par NOMBRE
// d'éléments par liste, jamais par caractères — le JSON produit reste
// toujours syntaxiquement valide.
//
// Déploiement : voir MANUEL-SEBA-ADMIN.md section 1b (mise à jour).
// ═══════════════════════════════════════════════════════════════

import { ASSISTANT_CONVERSATIONNEL_SYSTEM, buildStructuredContext, decideAvecLLM } from './_shared/conscience-seba.ts';
import { callWithFallback, LLM_PROVIDERS } from './_shared/llm-providers.ts';

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

/* Résout le compte métier (seba_state.account) à partir du user_id du JWT
   — même besoin multi-tenant que vision-qa.ts/assistant-technique.ts.
   Fail-open vers userId si la résolution échoue (config absente, réseau) :
   dégrade proprement en rate-limit "par utilisateur" plutôt que de
   bloquer l'assistant, cohérent avec le fail-open déjà en place plus bas
   dans checkRateLimit(). Sans cette résolution, deux employés du même
   compte (voir Pilier 4 : plusieurs user_id peuvent partager un seul
   account) auraient chacun leur propre quota au lieu d'un quota partagé
   par entreprise — pas une fuite de données, mais une dérive du plafond
   voulu par compte (PLAN.md, garde-fou multi-tenant). */
async function resolveAccount(userId: string, supaUrl?: string, serviceKey?: string): Promise<string> {
  if (!supaUrl || !serviceKey) return userId;
  try {
    const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
    const res = await fetch(
      supaUrl + '/rest/v1/seba_state?select=account&user_id=eq.' + encodeURIComponent(userId),
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const rows = res.ok ? await res.json() : [];
    return rows[0]?.account || userId;
  } catch {
    return userId;
  }
}

/* Plafond quotidien par compte (table api_usage, kind='ai'). En cas
   d'erreur réseau/config, on n'empêche jamais la requête de passer
   (fail-open) — mieux vaut un usage non limité temporairement qu'un
   assistant qui plante. */
async function checkRateLimit(account: string): Promise<boolean> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) return true;
  const today = new Date().toISOString().slice(0, 10);
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  try {
    const res = await fetch(
      supaUrl + '/rest/v1/api_usage?select=count&account=eq.' + encodeURIComponent(account) + "&kind=eq.ai&day=eq." + today,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const rows = res.ok ? await res.json() : [];
    const count = rows.length ? rows[0].count : 0;
    if (count >= DAILY_LIMIT) return false;
    await fetch(supaUrl + '/rest/v1/api_usage?on_conflict=account,kind,day', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account, kind: 'ai', day: today, count: count + 1 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return true;
  } catch {
    return true;
  }
}

function fallbackJson(reasoning: string) {
  return { action: 'Analyse indisponible', priority: 'low', reasoning };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const userId = verifyUser(req);
  if (!userId) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const account = await resolveAccount(userId, Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  const allowed = await checkRateLimit(account);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne atteinte, réessayez demain' }, 429);

  try {
    const body = await req.json();
    const mode = body.mode === 'json' ? 'json' : 'chat';

    if (mode === 'chat') {
      const question = body.question;
      if (!question || typeof question !== 'string' || question.length > 500) {
        return jsonResponse(cors, { error: 'Question invalide' }, 400);
      }
      const boundedContext = body.context && typeof body.context === 'object'
        ? buildStructuredContext(body.context as Record<string, unknown>)
        : null;
      const system = ASSISTANT_CONVERSATIONNEL_SYSTEM +
        (boundedContext ? 'Données réelles actuelles de son entreprise : ' + JSON.stringify(boundedContext) : 'Aucune donnée disponible pour le moment.');

      const result = await callWithFallback(system, String(question).slice(0, 500), false);
      if (result) return jsonResponse(cors, { answer: result.answer, provider: result.provider });
      return jsonResponse(cors, { error: 'Tous les fournisseurs IA sont indisponibles' }, 502);
    }

    // mode 'json' — Conscience Seba
    if (!body.context || typeof body.context !== 'object') {
      return jsonResponse(cors, { error: 'Contexte invalide' }, 400);
    }
    const boundedContext = buildStructuredContext(body.context as Record<string, unknown>);
    const decision = await decideAvecLLM(boundedContext, LLM_PROVIDERS);
    if (decision) return jsonResponse(cors, { ...decision.verdict, provider: decision.provider });
    return jsonResponse(cors, fallbackJson('Tous les fournisseurs IA sont indisponibles.'));
  } catch (e) {
    return jsonResponse(cors, { error: String((e as Error)?.message || e) }, 500);
  }
});
