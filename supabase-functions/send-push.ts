// ═══════════════════════════════════════════════════════════════
// SEBA — Relais de notification push (OneSignal).
//
// Envoie une notification push au navigateur/mobile de L'UTILISATEUR
// APPELANT LUI-MÊME (identifié par son auth.uid(), tagué comme
// "external_user_id" OneSignal lors de l'abonnement — voir
// docs/push-init.js). Utile pour les rappels programmés par
// l'utilisateur (RDV, relance) qui se notifie lui-même.
//
// Body attendu : { title, message }
// Déploiement : voir MANUEL-SEBA-ADMIN.md section 1f.
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const DAILY_LIMIT = 30;

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

async function checkRateLimit(userId: string): Promise<boolean> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) return true;
  const today = new Date().toISOString().slice(0, 10);
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  try {
    const res = await fetch(
      supaUrl + '/rest/v1/api_usage?select=count&account=eq.' + encodeURIComponent(userId) + '&kind=eq.push&day=eq.' + today,
      { headers },
    );
    const rows = res.ok ? await res.json() : [];
    const count = rows.length ? rows[0].count : 0;
    if (count >= DAILY_LIMIT) return false;
    await fetch(supaUrl + '/rest/v1/api_usage?on_conflict=account,kind,day', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account: userId, kind: 'push', day: today, count: count + 1 }),
    });
    return true;
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const userId = verifyUser(req);
  if (!userId) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const allowed = await checkRateLimit(userId);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne de notifications atteinte' }, 429);

  try {
    const { title, message } = await req.json();
    if (!title || typeof title !== 'string' || title.length > 100) return jsonResponse(cors, { error: 'Titre invalide' }, 400);
    if (!message || typeof message !== 'string' || message.length > 300) return jsonResponse(cors, { error: 'Message invalide' }, 400);

    const appId = Deno.env.get('ONESIGNAL_APP_ID');
    const restKey = Deno.env.get('ONESIGNAL_API_KEY');
    if (!appId || !restKey) return jsonResponse(cors, { error: 'OneSignal non configuré côté serveur' }, 500);

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + restKey },
      body: JSON.stringify({
        app_id: appId,
        include_external_user_ids: [userId],
        channel_for_external_user_ids: 'push',
        headings: { fr: String(title).slice(0, 100) },
        contents: { fr: String(message).slice(0, 300) },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse(cors, { error: 'OneSignal HTTP ' + res.status + ' : ' + errText.slice(0, 200) }, 502);
    }
    const data = await res.json();
    return jsonResponse(cors, { ok: true, recipients: data.recipients || 0 });
  } catch (e) {
    return jsonResponse(cors, { error: String((e as Error)?.message || e) }, 500);
  }
});
