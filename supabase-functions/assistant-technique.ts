// ═══════════════════════════════════════════════════════════════
// SEBA — Route HTTP de l'agent "assistant_technique" (RAG + analytique
// financière), voir PLAN.md dette technique / product-agents.config.json
// (agents.assistant_technique).
//
// Jusqu'ici, prepareAssistantTechniqueContext() (_shared/conscience-seba.ts)
// construisait déjà tout le contexte (recherche vectorielle + analytique
// financière + garde-fous) mais rien ne l'exposait au navigateur et aucun
// appel LLM réel n'y était branché. Cette fonction fait le dernier maillon :
// reçoit une question de technicien, construit le prompt via
// prepareAssistantTechniqueContext(), l'envoie à la chaîne de fallback LLM
// (_shared/llm-providers.ts), renvoie la réponse.
//
// Même pattern d'authentification/CORS/rate-limit que ai-relay.ts et
// vision-qa.ts : JWT du navigateur -> auth.uid() -> account résolu
// SERVEUR (jamais fourni par le client, règle multi-tenant du projet).
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createServiceClient, prepareAssistantTechniqueContext } from './_shared/conscience-seba.ts';
import { callWithFallback } from './_shared/llm-providers.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
// Quota propre a cet agent (kind='assistant_technique' dans api_usage),
// distinct de kind='ai' (ai-relay.ts) et kind='vision' (vision-qa.ts) --
// meme raisonnement que ces deux fonctions : un agent ne doit jamais
// epuiser le quota d'un autre.
const DAILY_LIMIT = 30;
const FETCH_TIMEOUT_MS = 5000;
const MAX_QUESTION_LENGTH = 500;

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

/* Meme mecanisme que ai-relay.ts/vision-qa.ts : JWT du caller -> auth.uid(),
   decodage synchrone, aucun appel reseau. */
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

/* Fail-open en cas d'erreur reseau/config (meme choix que ai-relay.ts/
   vision-qa.ts) : mieux vaut un usage temporairement non limite qu'un
   assistant qui plante pour un technicien sur le terrain. */
async function checkRateLimit(supa: ReturnType<typeof createClient>, account: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supa
      .from('api_usage')
      .select('count')
      .match({ account, kind: 'assistant_technique', day: today })
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
      .maybeSingle();
    const count = data?.count ?? 0;
    if (count >= DAILY_LIMIT) return false;
    await supa
      .from('api_usage')
      .upsert({ account, kind: 'assistant_technique', day: today, count: count + 1 }, { onConflict: 'account,kind,day' })
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
    return true;
  } catch {
    return true;
  }
}

const supabase = createServiceClient();

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const callerUid = verifyUser(req);
  if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  // account resolu SERVEUR, jamais transmis par le client (regle
  // multi-tenant du projet -- meme pattern que vision-qa.ts).
  const { data: owner } = await supabase
    .from('seba_state')
    .select('account')
    .eq('user_id', callerUid)
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
    .maybeSingle();
  if (!owner) return jsonResponse(cors, { error: 'Compte introuvable' }, 403);
  const account = owner.account;

  const allowed = await checkRateLimit(supabase, account);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne de questions atteinte, réessayez demain' }, 429);

  let body: { question?: unknown; interventionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }

  const question = body.question;
  if (!question || typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse(cors, { error: `Question invalide (texte non vide, ${MAX_QUESTION_LENGTH} caractères max requis)` }, 400);
  }
  const interventionId = typeof body.interventionId === 'string' && body.interventionId ? body.interventionId : undefined;

  try {
    // Construit le prompt via le meme moteur RAG que le reste du projet
    // (recherche vectorielle + analytique financiere + garde-fous absolus,
    // echecs d'outil deja interceptes en interne -- voir conscience-seba.ts).
    const { systemPrompt, matches } = await prepareAssistantTechniqueContext(supabase, account, question, { interventionId });

    const result = await callWithFallback(systemPrompt, question);
    if (!result) {
      // Garde-fou 1 (anti-hallucination) : aucun provider disponible ->
      // jamais de reponse inventee en remplacement, on le dit explicitement.
      return jsonResponse(cors, { error: 'Assistant technique indisponible pour le moment, réessayez plus tard' }, 502);
    }

    return jsonResponse(cors, {
      answer: result.answer,
      provider: result.provider,
      sourcesCount: matches.length,
    });
  } catch (e) {
    return jsonResponse(cors, { error: String((e as Error)?.message || e) }, 500);
  }
});
