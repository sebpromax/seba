// ═══════════════════════════════════════════════════════════════
// SEBA — Provisionnement du compte de connexion d'un client (Palier 1).
//
// Calque le modèle employé (equipe.html pose un PIN de départ '1234' à
// la création -- voir employe-set-pin.ts) : le patron crée la fiche
// client (clients.html, champ email), cette fonction crée IMMÉDIATEMENT
// un vrai compte Supabase Auth avec un mot de passe de départ '1234',
// que le client change lui-même depuis client-espace.html (panneau "Mon
// mot de passe", miroir de "Mon code PIN" côté terrain).
//
// Pourquoi une Edge Function et pas un appel direct depuis le navigateur
// du patron : supabase.auth.signUp() côté client REMPLACE la session
// active du navigateur -- appelé depuis le poste du patron, ça le
// déconnecterait de son propre compte pour le reconnecter en tant que
// client. auth.admin.createUser() (service_role, jamais exposé au
// navigateur) crée le compte SANS jamais toucher à la session du
// patron, ni même faire transiter par le SDK client.
//
// Body attendu : { account, client_id, email }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const DEFAULT_PASSWORD = '1234';

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

/* JWT du CALLER (le patron) -> auth.uid(). Identique à employe-set-pin.ts. */
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

  const callerUid = verifyUser(req);
  if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  let body: { account?: string; client_id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { account, client_id, email } = body;
  if (!account || !client_id || !email) {
    return jsonResponse(cors, { error: 'Paramètres manquants' }, 400);
  }
  const emailLower = email.trim().toLowerCase();

  // Même garde-fou que employe-set-pin.ts : le caller doit être le
  // PROPRIÉTAIRE du compte visé, sinon un JWT valide sur N'IMPORTE QUEL
  // compte suffirait à provisionner des accès pour les clients d'un
  // AUTRE patron.
  const { data: owner } = await supabase.from('seba_state').select('user_id').eq('account', account).maybeSingle();
  if (!owner || owner.user_id !== callerUid) {
    return jsonResponse(cors, { error: 'Compte introuvable ou non autorisé' }, 403);
  }

  // Deja provisionne ? (retrofit d'un client existant, ou double-appel) --
  // idempotent, ne recree jamais un compte pour ce client_id.
  const { data: existingLink } = await supabase
    .from('client_accounts')
    .select('client_user_id')
    .match({ account, client_id })
    .maybeSingle();
  if (existingLink) {
    return jsonResponse(cors, { ok: true, already_provisioned: true });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: emailLower,
    password: DEFAULT_PASSWORD,
    email_confirm: true, // provisionne par un patron de confiance, pas un auto-signup public -- pas de mail de confirmation a attendre
  });

  if (createError) {
    // Email deja utilise ailleurs dans le systeme (un autre compte
    // Supabase Auth existe deja) -- message honnete, pas une 500 opaque.
    if (String(createError.message || '').toLowerCase().includes('already')) {
      return jsonResponse(cors, { error: 'Cet email est déjà associé à un compte existant.' }, 409);
    }
    console.error(createError);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  const newUserId = created.user?.id;
  if (!newUserId) {
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  const { error: linkError } = await supabase.from('client_accounts').insert({
    client_user_id: newUserId, account, client_id, email: emailLower,
  });
  if (linkError) {
    console.error(linkError);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  return jsonResponse(cors, { ok: true, already_provisioned: false });
});
