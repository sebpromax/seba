// ═══════════════════════════════════════════════════════════════
// SEBA — Calcul d'embeddings, découplé du thread de réponse principal (Palier 4).
//
// Le calcul mistral-embed + l'écriture dans memoire_embeddings ne
// bloquent JAMAIS la réponse HTTP : via EdgeRuntime.waitUntil() (API du
// runtime Supabase Edge Functions, pas une fonctionnalité Deno standard),
// l'appelant reçoit un accusé de réception immédiat pendant que le calcul
// continue en arrière-plan après l'envoi de la réponse.
//
// Body attendu : { content: string, intervention_id?: string, metadata?: object }
// ═══════════════════════════════════════════════════════════════

import { createServiceClient } from './_shared/conscience-seba.ts';
import { runDecoupled, storeEmbedding } from './_shared/embeddings.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const MAX_CONTENT_CHARS = 8000;

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

const supabase = createServiceClient();

/** Enveloppe storeEmbedding() pour journaliser un echec -- storeEmbedding
    ne leve jamais, mais un echec silencieux serait invisible sans ce log. */
async function computeAndStore(account: string, interventionId: string | null, content: string, metadata: Record<string, unknown>) {
  const result = await storeEmbedding(supabase, account, interventionId, content, metadata);
  if (!result.ok) console.error('[embed-content] échec (best-effort, jamais bloquant) :', result.error);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const callerUid = verifyUser(req);
  if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const { data: owner } = await supabase.from('seba_state').select('account').eq('user_id', callerUid).maybeSingle();
  if (!owner) return jsonResponse(cors, { error: 'Compte introuvable' }, 403);
  const account = owner.account;

  let body: { content?: string; intervention_id?: string; metadata?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const content = body.content;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return jsonResponse(cors, { error: 'content requis (texte non vide)' }, 400);
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return jsonResponse(cors, { error: 'content trop long (' + MAX_CONTENT_CHARS + ' caractères max)' }, 400);
  }

  const interventionId = typeof body.intervention_id === 'string' ? body.intervention_id : null;
  const metadata = (body.metadata && typeof body.metadata === 'object') ? body.metadata : {};

  // 202 Accepted : le contenu est pris en charge, le calcul peut se
  // terminer apres cette reponse (runDecoupled -> EdgeRuntime.waitUntil).
  await runDecoupled(computeAndStore(account, interventionId, content, metadata));
  return jsonResponse(cors, { accepted: true }, 202);
});
