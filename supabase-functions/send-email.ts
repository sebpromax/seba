// ═══════════════════════════════════════════════════════════════
// SEBA — Relais d'envoi d'email transactionnel (Resend).
//
// Même principe que ai-relay.ts : un site 100% statique ne peut pas
// cacher une clé secrète. Cette fonction envoie un devis/facture par
// email au client, avec la clé RESEND_API_KEY gardée côté serveur.
//
// Body attendu : { to, subject, html, kind: 'devis'|'facture' }
// Déploiement : voir MANUEL-SEBA-ADMIN.md section 1e.
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const DAILY_LIMIT = 30; // reste large sous le plafond Resend (100/jour) tout en évitant l'abus

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
      supaUrl + '/rest/v1/api_usage?select=count&account=eq.' + encodeURIComponent(userId) + '&kind=eq.email&day=eq.' + today,
      { headers },
    );
    const rows = res.ok ? await res.json() : [];
    const count = rows.length ? rows[0].count : 0;
    if (count >= DAILY_LIMIT) return false;
    await fetch(supaUrl + '/rest/v1/api_usage?on_conflict=account,kind,day', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account: userId, kind: 'email', day: today, count: count + 1 }),
    });
    return true;
  } catch {
    return true;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const userId = verifyUser(req);
  if (!userId) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const allowed = await checkRateLimit(userId);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne d\'emails atteinte, réessayez demain' }, 429);

  try {
    const { to, subject, html, kind } = await req.json();
    if (!to || !EMAIL_RE.test(to)) return jsonResponse(cors, { error: 'Adresse email destinataire invalide' }, 400);
    if (!subject || typeof subject !== 'string' || subject.length > 200) return jsonResponse(cors, { error: 'Sujet invalide' }, 400);
    if (!html || typeof html !== 'string' || html.length > 50000) return jsonResponse(cors, { error: 'Contenu invalide' }, 400);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return jsonResponse(cors, { error: 'RESEND_API_KEY non configurée côté serveur' }, 500);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + resendKey },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') || 'Seba <onboarding@resend.dev>',
        to: [to],
        subject: String(subject).slice(0, 200),
        html: String(html).slice(0, 50000),
        tags: [{ name: 'kind', value: kind === 'facture' ? 'facture' : 'devis' }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse(cors, { error: 'Resend HTTP ' + res.status + ' : ' + errText.slice(0, 200) }, 502);
    }
    const data = await res.json();
    return jsonResponse(cors, { ok: true, id: data.id });
  } catch (e) {
    return jsonResponse(cors, { error: String((e as Error)?.message || e) }, 500);
  }
});
