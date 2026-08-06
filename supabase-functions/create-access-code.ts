// ═══════════════════════════════════════════════════════════════
// SEBA — Création d'un accès initial Client/Salarié par code provisoire
// (feat/client-employee-initial-access-code).
//
// Complément à client-provision.ts/employe-provision.ts (lien magique,
// inchangés) : le patron génère ici un code court (8 caractères), soit
// envoyé par email (delivery_method:'email'), soit révélé une seule fois
// dans l'interface (delivery_method:'reveal_once', jamais par email).
//
// Le code est généré ICI, via crypto.getRandomValues() (jamais
// Math.random(), jamais random()/gen_random_bytes() côté SQL) -- la RPC
// store_access_code() ne fait que le HACHER (pgcrypto), jamais stocké en
// clair. `account` n'est JAMAIS lu depuis le body du client : résolu
// uniquement depuis le JWT du patron (callerUid) via seba_state.
//
// Body attendu : { role: 'client'|'employe', entity_id, email, delivery_method: 'email'|'reveal_once' }
// Déploiement : verify_jwt=true (config projet, en plus de la vérification
// manuelle ci-dessous -- défense en profondeur, même garde-fou que
// client-provision.ts/employe-provision.ts).
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { forbiddenOriginResponse, getCorsHeaders } from './_shared/cors.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L -- pas d'ambiguite a la saisie
const CODE_LENGTH = 8;

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/* JWT du CALLER (le patron) -> auth.uid(). Défense en profondeur : la
   passerelle Supabase (verify_jwt=true, config projet) vérifie déjà la
   signature avant que ce code ne s'exécute -- ce décodage ne fait que
   lire le sub déjà authentifié, jamais une validation de signature
   maison (même commentaire que client-provision.ts/employe-provision.ts). */
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

/* Génération cryptographiquement sûre -- jamais Math.random(). */
function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function buildEmail(opts: { companyName: string; role: 'client' | 'employe'; code: string; expiresAt: string; loginUrl: string }) {
  const roleLabel = opts.role === 'client' ? 'client' : 'salarié';
  const subject = `${opts.companyName} — votre code d'accès Seba`;
  const expiresLabel = new Date(opts.expiresAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#8D5F42;">Votre code d'accès Seba</h2>
      <p>${escapeHtml(opts.companyName)} vous invite à activer votre espace ${roleLabel} sur Seba.</p>
      <p style="font-size:1.8rem;font-weight:700;letter-spacing:.15em;background:#F0E6DC;color:#4A3020;padding:14px 18px;border-radius:10px;text-align:center;">${escapeHtml(opts.code)}</p>
      <p>Rendez-vous sur <a href="${escapeHtml(opts.loginUrl)}">${escapeHtml(opts.loginUrl)}</a>, choisissez « Première connexion », puis saisissez votre email et ce code.</p>
      <p style="color:#71717A;font-size:.85rem;">Ce code est à usage unique et expire à ${expiresLabel}.</p>
    </div>
  `;
  return { subject, html };
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (!cors) return forbiddenOriginResponse();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const callerUid = verifyUser(req);
  if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  let body: { role?: string; entity_id?: string; email?: string; delivery_method?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { role, entity_id, delivery_method } = body;
  const email = body.email;
  if (!role || !['client', 'employe'].includes(role)) return jsonResponse(cors, { error: 'Rôle invalide' }, 400);
  if (!entity_id || typeof entity_id !== 'string' || entity_id.length > 100) return jsonResponse(cors, { error: 'Fiche invalide' }, 400);
  if (!email || typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse(cors, { error: 'Adresse email invalide' }, 400);
  if (!delivery_method || !['email', 'reveal_once'].includes(delivery_method)) return jsonResponse(cors, { error: 'Méthode de livraison invalide' }, 400);

  // account résolu UNIQUEMENT depuis le patron authentifié -- jamais une
  // valeur fournie par le navigateur.
  const { data: ownerState } = await supabase.from('seba_state').select('account, state').eq('user_id', callerUid).maybeSingle();
  if (!ownerState) return jsonResponse(cors, { error: 'Compte introuvable' }, 403);
  const account = ownerState.account as string;

  const code = generateCode();

  const { data: storeResult, error: storeError } = await supabase.rpc('store_access_code', {
    p_account: account, p_role: role, p_entity_id: entity_id, p_email: email.trim().toLowerCase(),
    p_delivery_method: delivery_method, p_code: code,
  });
  if (storeError || !storeResult || !(storeResult as { ok: boolean }).ok) {
    return jsonResponse(cors, { error: (storeResult as { error?: string })?.error || 'Erreur serveur' }, 400);
  }
  const invitationId = (storeResult as { invitation_id: string }).invitation_id;
  const expiresAt = (storeResult as { expires_at: string }).expires_at;

  if (delivery_method === 'reveal_once') {
    await supabase.from('provisional_access_codes').update({ delivery_status: 'revealed' }).eq('id', invitationId);
    // Seul cas où le code en clair est renvoyé -- jamais persisté, jamais
    // relisible ensuite (aucune RPC ne relit un code en clair).
    return jsonResponse(cors, { ok: true, invitation_id: invitationId, expires_at: expiresAt, delivery_status: 'revealed', code });
  }

  // delivery_method === 'email' : construit et envoie le template
  // ENTIEREMENT côté serveur -- le navigateur ne fournit ni sujet ni HTML.
  const companyName = (ownerState.state && (ownerState.state as { entreprise?: { nom?: string } }).entreprise?.nom) || 'Votre prestataire';
  const loginUrl = role === 'client' ? 'https://sebastienvalentin.com/client-connexion.html' : 'https://sebastienvalentin.com/employe-connexion.html';
  const { subject, html } = buildEmail({ companyName, role: role as 'client' | 'employe', code, expiresAt, loginUrl });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const resendFrom = Deno.env.get('RESEND_FROM');
  if (!resendKey || !resendFrom) {
    await supabase.from('provisional_access_codes').update({ delivery_status: 'delivery_failed', delivery_error: 'RESEND_API_KEY/RESEND_FROM non configurées côté serveur.' }).eq('id', invitationId);
    return jsonResponse(cors, { ok: true, invitation_id: invitationId, expires_at: expiresAt, delivery_status: 'delivery_failed' });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + resendKey },
      body: JSON.stringify({ from: resendFrom, to: [email.trim().toLowerCase()], subject, html, tags: [{ name: 'kind', value: 'access-code-' + role }] }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      await supabase.from('provisional_access_codes').update({ delivery_status: 'delivery_failed', delivery_error: ('Resend HTTP ' + res.status + ' : ' + errText).slice(0, 300) }).eq('id', invitationId);
      return jsonResponse(cors, { ok: true, invitation_id: invitationId, expires_at: expiresAt, delivery_status: 'delivery_failed' });
    }
    await supabase.from('provisional_access_codes').update({ delivery_status: 'sent' }).eq('id', invitationId);
    return jsonResponse(cors, { ok: true, invitation_id: invitationId, expires_at: expiresAt, delivery_status: 'sent' });
  } catch {
    await supabase.from('provisional_access_codes').update({ delivery_status: 'delivery_failed', delivery_error: 'Connexion à Resend impossible.' }).eq('id', invitationId);
    return jsonResponse(cors, { ok: true, invitation_id: invitationId, expires_at: expiresAt, delivery_status: 'delivery_failed' });
  }
});
