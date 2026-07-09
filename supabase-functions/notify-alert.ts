// ═══════════════════════════════════════════════════════════════
// SEBA — Relais de notification d'alerte (Palier 3, stub).
//
// Appelée par deux voies :
//   1. Le trigger DB qa_photos_alert_trigger (supabase-schema.sql, section
//      17) via pg_net, authentifiée avec la clé service_role lue dans
//      Vault -- déclenchement automatique à chaque nouvelle alerte.
//   2. Un client authentifié (JWT patron), pour une action manuelle
//      future (ex. "renvoyer la notification").
//
// N'écrit PAS dans alert_logs : la ligne existe déjà (créée par le
// trigger avant cet appel) ou par l'appelant manuel -- cette fonction ne
// fait QUE le relais de notification, jamais l'enregistrement.
//
// STUB pour ce palier : logge la réception, ne branche pas encore
// d'envoi réel (email/push). Structure prête pour brancher sendEmail()/
// sendPush() (même pattern que daily-digest.ts, RESEND_API_KEY/
// ONESIGNAL_APP_ID déjà provisionnées ailleurs dans le projet).
//
// Body attendu : { alert_id, account, intervention_id, type_alerte, raison }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];

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

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') || '';
  // Comparaison directe suffisante ici : le risque d'attaque par timing
  // sur un appel interne (trigger DB -> Edge Function, jamais expose au
  // public) est marginal comparé a la complexite d'une comparaison a
  // temps constant pour ce cas d'usage precis.
  const isTrustedTrigger = authHeader === 'Bearer ' + supabaseServiceKey;

  let callerAccount: string | null = null;
  if (!isTrustedTrigger) {
    const callerUid = verifyUser(req);
    if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);
    const { data } = await supabase.from('seba_state').select('account').eq('user_id', callerUid).maybeSingle();
    if (!data) return jsonResponse(cors, { error: 'Compte introuvable' }, 403);
    callerAccount = data.account;
  }

  let body: { alert_id?: string; account?: string; intervention_id?: string; type_alerte?: string; raison?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { alert_id, account, intervention_id, type_alerte, raison } = body;
  if (!alert_id || !intervention_id) {
    return jsonResponse(cors, { error: 'alert_id et intervention_id requis' }, 400);
  }
  // Appel manuel (JWT) sur une alerte d'un AUTRE compte : refus net, pas
  // de fuite d'existence de l'alerte.
  if (callerAccount && account && callerAccount !== account) {
    return jsonResponse(cors, { error: 'Alerte introuvable pour ce compte' }, 404);
  }

  console.log('[notify-alert] alerte reçue (stub, aucun envoi réel) :', { alert_id, intervention_id, type_alerte, raison });

  return jsonResponse(cors, {
    ok: true,
    notified: false,
    reason: 'Notification stub — email/push non branchés dans ce palier.',
  });
});
