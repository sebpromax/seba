// ═══════════════════════════════════════════════════════════════
// SEBA — Provisionnement du compte de connexion d'un employé (authentification
// universelle, 2026-07-19 — remplace le modèle PIN/badge-sur-appareil-
// patron d'employe-auth.ts/employe-set-pin.ts, retirées).
//
// Le patron crée la fiche employé (equipe.html, champ email), cette
// fonction INVITE l'employé par email -- jamais de mot de passe imposé :
// l'employé choisit lui-même le sien en cliquant le lien reçu
// (reset-password.html). Miroir exact de client-provision.ts -- seule
// différence : lie employe_accounts au lieu de client_accounts.
//
// fix/invitation-delivery (2026-07-23) : n'utilise plus
// auth.admin.inviteUserByEmail() (envoi opaque via le SMTP Supabase --
// aucun moyen de savoir si l'email a réellement été accepté par Resend,
// ni pourquoi il a échoué). Remplacé par auth.admin.generateLink() (crée
// le compte + renvoie le lien SANS envoyer de mail) suivi d'un envoi
// explicite via l'API Resend (supabase-functions/_shared/
// invitation-delivery.ts) -- le résultat réel (id Resend, ou erreur
// normalisée) est journalisé dans invitation_log et renvoyé au patron.
// Supporte aussi `retry: true` : renvoie un nouveau lien (type
// 'recovery') au compte déjà lié, sans jamais créer un second lien
// employe_accounts (idempotent -- voir garde-fou existingLink ci-dessous).
//
// Pourquoi une Edge Function et pas un appel direct depuis le navigateur
// du patron : auth.admin.* REMPLACERAIT la session active du navigateur
// -- appelé depuis le poste du patron, ça le déconnecterait de son propre
// compte. auth.admin.* (service_role, jamais exposé au navigateur) crée/
// invite le compte SANS jamais toucher à la session du patron.
//
// Body attendu : { account, employe_id, email, retry?: boolean }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logInvitationAttempt, sendInvitationViaResend, updateInvitationStatus } from './_shared/invitation-delivery.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let body: { account?: string; employe_id?: string; email?: string; retry?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { account, employe_id, retry } = body;
  const email = body.email;
  if (!account || !employe_id || !email) {
    return jsonResponse(cors, { error: 'Paramètres manquants' }, 400);
  }
  const emailLower = email.trim().toLowerCase();
  if (!EMAIL_RE.test(emailLower)) {
    return jsonResponse(cors, { error: 'Adresse email invalide' }, 400);
  }

  // Même garde-fou que client-provision.ts : le caller doit être le
  // PROPRIÉTAIRE du compte visé, sinon un JWT valide sur N'IMPORTE QUEL
  // compte suffirait à inviter des accès pour les employés d'un AUTRE
  // patron.
  const { data: owner } = await supabase.from('seba_state').select('user_id').eq('account', account).maybeSingle();
  if (!owner || owner.user_id !== callerUid) {
    return jsonResponse(cors, { error: 'Compte introuvable ou non autorisé' }, 403);
  }

  // Deja provisionne ? (retrofit d'un employe existant, ou double-appel) --
  // idempotent, ne cree JAMAIS un second lien employe_accounts pour cet
  // employe_id, que ce soit un premier appel repete ou un retry explicite.
  const { data: existingLink } = await supabase
    .from('employe_accounts')
    .select('employe_user_id, email')
    .match({ account, employe_id })
    .maybeSingle();

  if (existingLink && !retry) {
    return jsonResponse(cors, { ok: true, already_provisioned: true });
  }

  const origin = req.headers.get('origin') || ALLOWED_ORIGINS[0];
  const redirectTo = origin + '/reset-password.html';

  let actionLink: string | null = null;
  let newUserId: string | null = null;
  const targetEmail = existingLink ? existingLink.email : emailLower;

  if (existingLink) {
    // Réessai : le compte auth existe déjà (créé lors d'une tentative
    // précédente) -- 'recovery' génère un lien de définition de mot de
    // passe pour un utilisateur EXISTANT (même mécanisme que "mot de passe
    // oublié", reset-password.html gère déjà ce flux).
    const { data: linkData, error: linkGenError } = await supabase.auth.admin.generateLink({
      type: 'recovery', email: targetEmail, options: { redirectTo },
    });
    if (linkGenError || !linkData) {
      console.error(linkGenError);
      return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
    }
    actionLink = linkData.properties?.action_link || null;
  } else {
    const { data: linkData, error: linkGenError } = await supabase.auth.admin.generateLink({
      type: 'invite', email: emailLower, options: { redirectTo },
    });
    if (linkGenError) {
      if (String(linkGenError.message || '').toLowerCase().includes('already')) {
        return jsonResponse(cors, { error: 'Cet email est déjà associé à un compte existant.' }, 409);
      }
      console.error(linkGenError);
      return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
    }
    actionLink = linkData?.properties?.action_link || null;
    newUserId = linkData?.user?.id || null;
    if (!actionLink || !newUserId) {
      return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
    }

    // Le lien de rattachement est créé MAINTENANT, avant même de tenter
    // l'envoi de l'email : le compte existe et reste utilisable (le
    // patron peut "Réessayer l'envoi") même si Resend refuse le message.
    const { error: linkError } = await supabase.from('employe_accounts').insert({
      employe_user_id: newUserId, account, employe_id, email: emailLower,
    });
    if (linkError) {
      console.error(linkError);
      return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
    }
  }

  const logId = await logInvitationAttempt(supabase, {
    account, invitationType: 'employe', targetId: employe_id, recipientEmail: targetEmail,
  });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const resendFrom = Deno.env.get('RESEND_FROM') || 'Seba <onboarding@resend.dev>';
  if (!resendKey) {
    if (logId) await updateInvitationStatus(supabase, logId, { status: 'failed', errorMessage: 'RESEND_API_KEY non configurée côté serveur.' });
    return jsonResponse(cors, { ok: true, already_provisioned: !!existingLink, email_status: 'failed', email_error: 'RESEND_API_KEY non configurée côté serveur.' });
  }

  const sendResult = await sendInvitationViaResend({
    resendKey, from: resendFrom, to: targetEmail, actionLink: actionLink!, invitationType: 'employe',
  });

  if (logId) {
    await updateInvitationStatus(supabase, logId, sendResult.ok
      ? { status: 'sent', resendId: sendResult.resendId }
      : { status: 'failed', errorMessage: sendResult.errorMessage });
  }

  return jsonResponse(cors, {
    ok: true,
    already_provisioned: !!existingLink,
    email_status: sendResult.ok ? 'sent' : 'failed',
    email_error: sendResult.ok ? undefined : sendResult.errorMessage,
    invitation_id: logId,
  });
});
