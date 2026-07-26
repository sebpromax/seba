// ═══════════════════════════════════════════════════════════════
// SEBA — Fondation acquisition (feature/public-intake-conversion).
// VISITEUR PUBLIC -> DEMANDE DE PRESTATION -> QUALIFICATION PATRON ->
// CLIENT / DEVIS / INTERVENTION.
//
// Seule porte d'écriture pour un visiteur SANS compte Seba : la table
// public_service_requests n'a AUCUNE policy RLS d'insertion pour anon/
// authenticated (voir migrations/2026-07-26-public-intake.sql) -- cette
// fonction, avec la clé service_role, est le seul chemin possible.
//
// 3 actions, distinguées par méthode HTTP + query string (même fonction
// Deno.serve unique, convention déjà utilisée par ce dépôt pour les
// endpoints à plusieurs opérations) :
//   GET  ?account=<id>                 -> config publique (allowlist stricte)
//   POST { account, ... }              -> crée une demande
//   GET  ?ref=<reference>&token=<token> -> suivi (allowlist stricte)
//
// Ne retourne JAMAIS seba_state brut, owner_note, account, ni les
// identifiants convertis (clientId/quoteId/interventionId) -- même
// discipline d'allowlist explicite que get_my_client_intervention_detail
// (migrations/2026-07-25-intervention-360.sql).
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svcHeaders = { apikey: supabaseServiceKey, Authorization: 'Bearer ' + supabaseServiceKey, 'Content-Type': 'application/json' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 2000;
const MAX_NAME = 200;

function normalizeEmail(v: unknown): string | null {
  const s = String(v || '').trim().toLowerCase();
  return s && EMAIL_RE.test(s) ? s : null;
}
function normalizePhone(v: unknown): string | null {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  return digits.length >= 6 ? digits : null;
}
function clampText(v: unknown, max: number): string {
  return String(v || '').trim().slice(0, max);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Référence non prédictible -- jamais un compteur séquentiel (un
   compteur exposerait le volume de demandes ET permettrait d'énumérer
   les demandes d'autres visiteurs via GET tracking). */
function randomReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const b32 = Array.from(bytes).map((b) => b.toString(36)).join('').toUpperCase();
  return 'SEBA-' + b32.slice(0, 8);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Limite anti-spam simple : réutilise la table api_usage déjà en place
   (send-email.ts) -- clé (account, kind, day), "account" détourné ici pour
   porter l'IP ou l'email normalisé (texte libre, pas de FK), jamais un
   vrai identifiant de compte Seba. RLS bloque tout accès hors
   service_role, donc aucune fuite possible via cette table. */
async function checkAndBumpRateLimit(key: string, kind: string, dailyLimit: number): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(
      supabaseUrl + '/rest/v1/api_usage?select=count&account=eq.' + encodeURIComponent(key) + '&kind=eq.' + kind + '&day=eq.' + today,
      { headers: svcHeaders },
    );
    const rows = res.ok ? await res.json() : [];
    const count = rows.length ? rows[0].count : 0;
    if (count >= dailyLimit) return false;
    await fetch(supabaseUrl + '/rest/v1/api_usage?on_conflict=account,kind,day', {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account: key, kind, day: today, count: count + 1 }),
    });
    return true;
  } catch {
    return true; // panne de la vérification elle-même -- jamais bloquant pour un visiteur légitime
  }
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

const PUBLIC_STATUS_LABEL: Record<string, string> = {
  new: 'En cours de traitement', contacted: 'En cours de traitement', qualified: 'En cours de traitement',
  converted: 'Convertie', rejected: 'Non retenue', archived: 'Archivée',
};

/* ── GET config : allowlist stricte, jamais seba_state brut ── */
async function handleConfig(cors: Record<string, string>, account: string) {
  if (!account) return jsonResponse(cors, { error: 'Paramètre account manquant.' }, 400);

  const stateRes = await fetch(
    supabaseUrl + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(account),
    { headers: svcHeaders },
  );
  if (!stateRes.ok) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  const stateRows = await stateRes.json();
  const state = stateRows[0]?.state;
  if (!state) return jsonResponse(cors, { error: 'Entreprise introuvable.' }, 404);

  const cfg = state.publicIntakeConfig;
  if (!cfg || !cfg.enabled) return jsonResponse(cors, { error: 'Formulaire désactivé.' }, 404);

  const allServices: Array<{ id: string; name: string }> = Array.isArray(state.custom_services)
    ? state.custom_services.filter((s: any) => s && s.active !== false).map((s: any) => ({ id: s.id, name: s.name }))
    : [];
  const allowedIds: string[] = Array.isArray(cfg.allowedServiceIds) ? cfg.allowedServiceIds : [];
  const services = allowedIds.length === 0 ? allServices : allServices.filter((s) => allowedIds.indexOf(s.id) !== -1);

  return jsonResponse(cors, {
    ok: true,
    entreprise: { nom: (state.entreprise && state.entreprise.nom) || 'Cette entreprise' },
    config: {
      title: cfg.title || 'Demander une intervention',
      introduction: cfg.introduction || '',
      services,
      requireAddress: !!cfg.requireAddress,
      allowPreferredDate: cfg.allowPreferredDate !== false,
      confirmationMessage: cfg.confirmationMessage || 'Merci, votre demande a bien été envoyée.',
    },
  });
}

/* ── POST request : validation serveur complète, jamais une confiance
   au formulaire côté navigateur (mêmes champs re-vérifiés ici que ceux
   affichés/désactivés côté client par demande.html). ── */
async function handleCreateRequest(cors: Record<string, string>, req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse(cors, { error: 'JSON invalide' }, 400); }

  // Honeypot -- champ caché, invisible pour un humain, jamais rempli par
  // un vrai visiteur. Un bot qui le remplit reçoit une réponse "succès"
  // plausible (même forme) SANS aucune écriture réelle -- ne révèle jamais
  // à l'automate qu'il a été détecté.
  if (body.website) {
    return jsonResponse(cors, { ok: true, reference: randomReference(), trackingToken: randomToken() });
  }

  const account = String(body.account || '').trim();
  if (!account) return jsonResponse(cors, { error: 'Entreprise manquante.' }, 400);

  const ip = clientIp(req);
  const emailNorm = normalizeEmail(body.email);
  const phoneNorm = normalizePhone(body.phone);
  if (!emailNorm && !phoneNorm) return jsonResponse(cors, { error: 'Email ou téléphone requis.' }, 400);

  const ipOk = await checkAndBumpRateLimit(ip, 'public_intake_ip', 20);
  if (!ipOk) return jsonResponse(cors, { error: 'Trop de demandes, réessayez plus tard.' }, 429);
  if (emailNorm) {
    const emailOk = await checkAndBumpRateLimit(emailNorm, 'public_intake_email', 5);
    if (!emailOk) return jsonResponse(cors, { error: 'Trop de demandes pour cette adresse, réessayez plus tard.' }, 429);
  }

  const stateRes = await fetch(
    supabaseUrl + '/rest/v1/seba_state?select=state,user_id&account=eq.' + encodeURIComponent(account),
    { headers: svcHeaders },
  );
  if (!stateRes.ok) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  const stateRows = await stateRes.json();
  const row = stateRows[0];
  if (!row || !row.state) return jsonResponse(cors, { error: 'Entreprise introuvable.' }, 404);
  const state = row.state;
  const cfg = state.publicIntakeConfig;
  if (!cfg || !cfg.enabled) return jsonResponse(cors, { error: 'Formulaire désactivé.' }, 404);

  const contactName = clampText(body.contactName, MAX_NAME);
  if (!contactName) return jsonResponse(cors, { error: 'Nom requis.' }, 400);

  const allServices: Array<{ id: string; name: string; active?: boolean }> = Array.isArray(state.custom_services) ? state.custom_services : [];
  const allowedIds: string[] = Array.isArray(cfg.allowedServiceIds) ? cfg.allowedServiceIds : [];
  const serviceId = String(body.serviceId || '').trim() || null;
  let serviceLabel: string | null = null;
  if (serviceId) {
    const svc = allServices.find((s) => s.id === serviceId && s.active !== false);
    const isAllowed = !!svc && (allowedIds.length === 0 || allowedIds.indexOf(serviceId) !== -1);
    if (!isAllowed) return jsonResponse(cors, { error: 'Service non autorisé.' }, 400);
    serviceLabel = svc!.name;
  }

  const address = cfg.requireAddress ? clampText(body.address, MAX_TEXT) : clampText(body.address, MAX_TEXT) || null;
  if (cfg.requireAddress && !address) return jsonResponse(cors, { error: 'Adresse requise.' }, 400);

  const preferredDate = cfg.allowPreferredDate && body.preferredDate ? String(body.preferredDate).slice(0, 10) : null;
  const preferredTimeStart = cfg.allowPreferredDate && body.preferredTimeStart ? String(body.preferredTimeStart).slice(0, 5) : null;
  const preferredTimeEnd = cfg.allowPreferredDate && body.preferredTimeEnd ? String(body.preferredTimeEnd).slice(0, 5) : null;

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  let reference = randomReference();

  const insertRow = {
    account, user_id: row.user_id,
    public_reference: reference, tracking_token_hash: tokenHash, status: 'new',
    contact_name: contactName, email: emailNorm, phone: phoneNorm, address,
    service_id: serviceId, service_label: serviceLabel,
    preferred_date: preferredDate, preferred_time_start: preferredTimeStart, preferred_time_end: preferredTimeEnd,
    description: clampText(body.description, MAX_TEXT) || null,
    source: 'public_form',
  };

  let insertRes = await fetch(supabaseUrl + '/rest/v1/public_service_requests', {
    method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(insertRow),
  });
  // Collision extrêmement improbable sur public_reference (unique) -- un
  // seul nouvel essai suffit, jamais une boucle non bornée.
  if (insertRes.status === 409) {
    reference = randomReference();
    insertRow.public_reference = reference;
    insertRes = await fetch(supabaseUrl + '/rest/v1/public_service_requests', {
      method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(insertRow),
    });
  }
  if (!insertRes.ok) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);

  // event métier service_request_created : émis côté navigateur PATRON
  // (demandes.html détecte les demandes 'new' non encore vues, voir
  // SebaDB.publicIntake + runAutomationsPass dans seba-data.js) -- cette
  // fonction n'a aucun accès à seba_state.automationRules/Runs (ils vivent
  // dans le blob JSONB patron, jamais lisibles par un visiteur anonyme),
  // donc aucune émission possible ici. Documenté explicitement pour ne pas
  // chercher un appel manquant.
  return jsonResponse(cors, { ok: true, reference, trackingToken: token });
}

/* ── GET tracking : allowlist stricte, jamais owner_note/account/ids internes ── */
async function handleTracking(cors: Record<string, string>, reference: string, token: string) {
  if (!reference || !token) return jsonResponse(cors, { error: 'Paramètres manquants.' }, 400);

  const res = await fetch(
    supabaseUrl + '/rest/v1/public_service_requests?select=public_reference,tracking_token_hash,status,service_label,preferred_date,created_at&public_reference=eq.' + encodeURIComponent(reference),
    { headers: svcHeaders },
  );
  if (!res.ok) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  const rows = await res.json();
  const row = rows[0];
  if (!row) return jsonResponse(cors, { error: 'Demande introuvable.' }, 404);

  const providedHash = await sha256Hex(token);
  if (!timingSafeEqual(providedHash, row.tracking_token_hash)) {
    return jsonResponse(cors, { error: 'Lien de suivi invalide.' }, 403);
  }

  return jsonResponse(cors, {
    ok: true,
    reference: row.public_reference,
    service: row.service_label,
    status: PUBLIC_STATUS_LABEL[row.status] || 'En cours de traitement',
    preferredDate: row.preferred_date,
    createdAt: row.created_at,
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('ref')) {
    return handleTracking(cors, url.searchParams.get('ref') || '', url.searchParams.get('token') || '');
  }
  if (req.method === 'GET' && url.searchParams.has('account')) {
    return handleConfig(cors, url.searchParams.get('account') || '');
  }
  if (req.method === 'POST') {
    return handleCreateRequest(cors, req);
  }
  return jsonResponse(cors, { error: 'Requête invalide.' }, 400);
});
