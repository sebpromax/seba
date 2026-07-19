// ═══════════════════════════════════════════════════════════════
// SEBA — Provisionnement du compte de connexion d'un employé (authentification
// universelle, 2026-07-19 — remplace le modèle PIN/badge-sur-appareil-
// patron d'employe-auth.ts/employe-set-pin.ts, retirées).
//
// Le patron crée la fiche employé (equipe.html, champ email), cette
// fonction INVITE l'employé par email (auth.admin.inviteUserByEmail) --
// jamais de mot de passe imposé : l'employé choisit lui-même le sien en
// cliquant le lien reçu (reset-password.html). Miroir exact de
// client-provision.ts -- seule différence : lie employe_accounts au lieu
// de client_accounts.
//
// Pourquoi une Edge Function et pas un appel direct depuis le navigateur
// du patron : auth.admin.inviteUserByEmail() côté client REMPLACERAIT la
// session active du navigateur -- appelé depuis le poste du patron, ça
// le déconnecterait de son propre compte. auth.admin.* (service_role,
// jamais exposé au navigateur) invite le compte SANS jamais toucher à la
// session du patron.
//
// Body attendu : { account, employe_id, email }
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

/* JWT du CALLER (le patron) -> auth.uid(). */
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

  let body: { account?: string; employe_id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { account, employe_id, email } = body;
  if (!account || !employe_id || !email) {
    return jsonResponse(cors, { error: 'Paramètres manquants' }, 400);
  }
  const emailLower = email.trim().toLowerCase();

  // Même garde-fou que client-provision.ts : le caller doit être le
  // PROPRIÉTAIRE du compte visé, sinon un JWT valide sur N'IMPORTE QUEL
  // compte suffirait à inviter des accès pour les employés d'un AUTRE
  // patron.
  const { data: owner } = await supabase.from('seba_state').select('user_id').eq('account', account).maybeSingle();
  if (!owner || owner.user_id !== callerUid) {
    return jsonResponse(cors, { error: 'Compte introuvable ou non autorisé' }, 403);
  }

  // Deja provisionne ? (retrofit d'un employe existant, ou double-appel) --
  // idempotent, ne renvoie jamais une 2e invitation pour cet employe_id.
  const { data: existingLink } = await supabase
    .from('employe_accounts')
    .select('employe_user_id')
    .match({ account, employe_id })
    .maybeSingle();
  if (existingLink) {
    return jsonResponse(cors, { ok: true, already_provisioned: true });
  }

  const origin = req.headers.get('origin') || ALLOWED_ORIGINS[0];
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(emailLower, {
    redirectTo: origin + '/reset-password.html',
  });

  if (inviteError) {
    if (String(inviteError.message || '').toLowerCase().includes('already')) {
      return jsonResponse(cors, { error: 'Cet email est déjà associé à un compte existant.' }, 409);
    }
    console.error(inviteError);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  const newUserId = invited.user?.id;
  if (!newUserId) {
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  const { error: linkError } = await supabase.from('employe_accounts').insert({
    employe_user_id: newUserId, account, employe_id, email: emailLower,
  });
  if (linkError) {
    console.error(linkError);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  return jsonResponse(cors, { ok: true, already_provisioned: false });
});
