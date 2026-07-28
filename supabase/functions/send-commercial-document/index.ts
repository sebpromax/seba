// ═══════════════════════════════════════════════════════════════
// SEBA — Envoi email des documents commerciaux (feature/customer-email-
// delivery, PHASE 1 uniquement : base backend, aucune modale/UI ici).
//
// Seule porte d'écriture de commercial_email_deliveries (RLS : patron
// lit uniquement, aucune écriture directe navigateur -- voir migrations/
// 2026-07-28-commercial-email-delivery.sql). Vérifie réellement la
// session patron, résout le document CÔTÉ SERVEUR (jamais une confiance
// dans ce qu'envoie le navigateur), refuse les brouillons/paiements
// inexistants, construit le lien portail, appelle Resend, enregistre le
// VRAI résultat -- jamais un faux succès.
//
// Ne stocke JAMAIS de donnée financière/ligne/adresse/secret dans
// commercial_email_deliveries (voir contraintes de la migration) ni dans
// l'URL du lien portail (voir buildPortalLink ci-dessous).
// ═══════════════════════════════════════════════════════════════

import {
  normalizeEmail, normalizeCcList, clampSingleLine, clampMultiLine, escapeHtml,
  buildIdempotencyKey, isValidDocumentType, jsonResponse, DOC_TYPE_LABEL,
  MAX_SUBJECT_LEN, MAX_MESSAGE_LEN, MAX_ATTEMPT_ID_LEN,
  type DocumentType,
} from '../_shared/commercial-email.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791', 'http://127.0.0.1:8791'];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const emailFrom = Deno.env.get('EMAIL_FROM') || '';
const appBaseUrl = (Deno.env.get('APP_BASE_URL') || '').replace(/\/$/, '');
// Jamais un secret -- simple point de terminaison, overridable UNIQUEMENT
// pour les tests locaux (QA Phase 1, Resend mocké par un serveur local,
// voir scripts/qa-customer-email-delivery-phase1.js). Vaut toujours
// l'URL Resend réelle en production (valeur par défaut ci-dessous).
const resendApiUrl = Deno.env.get('RESEND_API_URL') || 'https://api.resend.com/emails';

const svcHeaders = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

/* ── Authentification patron réelle (jamais le rôle envoyé par le
   navigateur) : vérifie le JWT auprès de Supabase Auth, obtient
   auth.uid() côté serveur. ── */
async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: anonKey, Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.id) || null;
  } catch {
    return null;
  }
}

/* Propriétaire réel de l'account = seba_state.user_id (même source de
   vérité que toutes les autres Edge Functions/RPC de ce dépôt). Refuse
   explicitement un client ou un employé authentifié même si par erreur
   leur uid correspondait (défense en profondeur, jamais supposé). */
async function assertPatronOwnsAccount(uid: string, account: string): Promise<{ ok: true; state: any } | { ok: false; error: string; code: string }> {
  const [stateRes, clientRes, employeRes] = await Promise.all([
    fetch(supabaseUrl + '/rest/v1/seba_state?select=state,user_id&account=eq.' + encodeURIComponent(account), { headers: svcHeaders }),
    fetch(supabaseUrl + '/rest/v1/client_accounts?select=client_user_id&client_user_id=eq.' + encodeURIComponent(uid), { headers: svcHeaders }),
    fetch(supabaseUrl + '/rest/v1/employe_accounts?select=employe_user_id&employe_user_id=eq.' + encodeURIComponent(uid), { headers: svcHeaders }),
  ]);
  if (!stateRes.ok) return { ok: false, error: 'Erreur serveur.', code: 'server_error' };
  const clientRows = clientRes.ok ? await clientRes.json() : [];
  if (clientRows.length) return { ok: false, error: 'Accès refusé.', code: 'forbidden_role' };
  const employeRows = employeRes.ok ? await employeRes.json() : [];
  if (employeRows.length) return { ok: false, error: 'Accès refusé.', code: 'forbidden_role' };

  const stateRows = await stateRes.json();
  const row = stateRows[0];
  if (!row || !row.state) return { ok: false, error: 'Compte introuvable.', code: 'not_found' };
  if (row.user_id !== uid) return { ok: false, error: 'Accès refusé.', code: 'forbidden_account' };
  return { ok: true, state: row.state };
}

type ResolvedDocument = {
  clientId: string; clientName: string;
  num: string | null; entrepriseNom: string;
  linkParams: Record<string, string>;
};

/* Résolution CÔTÉ SERVEUR -- jamais uniquement documentId : vérifie
   simultanément account/clientId/documentType/documentId, et que le
   document est réellement dans un état partageable (jamais un
   brouillon, jamais un paiement inexistant). */
function resolveDocument(state: any, clientId: string, documentType: DocumentType, documentId: string):
  { ok: true; doc: ResolvedDocument } | { ok: false; error: string; code: string } {
  const clients = Array.isArray(state.clients) ? state.clients : [];
  const client = clients.find((c: any) => c && c.id === clientId);
  if (!client) return { ok: false, error: 'Client introuvable.', code: 'client_not_found' };
  const entrepriseNom = (state.entreprise && state.entreprise.nom) || 'Votre prestataire';
  const clientName = ((client.prenom || '') + ' ' + (client.nom || '')).trim() || client.nom || 'Client';

  if (documentType === 'quote') {
    const devis = Array.isArray(state.devis) ? state.devis : [];
    const d = devis.find((x: any) => x && x.id === documentId);
    if (!d) return { ok: false, error: 'Devis introuvable.', code: 'document_not_found' };
    if (d.clientId !== clientId) return { ok: false, error: 'Devis introuvable.', code: 'document_not_found' };
    if (d.status === 'brouillon') return { ok: false, error: 'Un brouillon ne peut pas être envoyé.', code: 'draft_not_shareable' };
    return { ok: true, doc: { clientId, clientName, num: d.num || null, entrepriseNom, linkParams: { doc: 'quote', id: d.id } } };
  }

  if (documentType === 'invoice') {
    const factures = Array.isArray(state.factures) ? state.factures : [];
    const f = factures.find((x: any) => x && x.id === documentId);
    if (!f) return { ok: false, error: 'Facture introuvable.', code: 'document_not_found' };
    if (f.clientId !== clientId) return { ok: false, error: 'Facture introuvable.', code: 'document_not_found' };
    if (f.status === 'draft') return { ok: false, error: 'Un brouillon ne peut pas être envoyé.', code: 'draft_not_shareable' };
    return { ok: true, doc: { clientId, clientName, num: f.num || null, entrepriseNom, linkParams: { doc: 'invoice', id: f.id } } };
  }

  // receipt : documentId = id du paiement réel (facture.payments[].id) --
  // jamais un acompte simplement demandé, jamais une promesse (même
  // discipline que buildReceiptDocumentModel, docs/seba-data.js).
  const factures = Array.isArray(state.factures) ? state.factures : [];
  const f = factures.find((x: any) => x && x.clientId === clientId && Array.isArray(x.payments) && x.payments.some((p: any) => p && p.id === documentId));
  if (!f) return { ok: false, error: 'Paiement introuvable.', code: 'payment_not_found' };
  return {
    ok: true,
    doc: { clientId, clientName, num: f.num || null, entrepriseNom, linkParams: { doc: 'receipt', invoiceId: f.id, paymentId: documentId } },
  };
}

/* Lien portail sécurisé -- ouvre client-espace.html (portail existant,
   jamais un nouveau système), le client doit s'authentifier avant de
   voir la moindre donnée. Uniquement des identifiants opaques non
   sensibles dans l'URL (jamais montant/solde/email/adresse/JWT). */
function buildPortalLink(linkParams: Record<string, string>): string {
  const base = appBaseUrl || '';
  const qs = new URLSearchParams(linkParams).toString();
  return base + '/client-espace.html?' + qs;
}

function buildEmailHtml(opts: { entrepriseNom: string; docLabel: string; num: string | null; message: string; link: string }): string {
  const safeMessage = escapeHtml(opts.message).replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:520px;margin:0 auto;padding:24px;">
    <p>${safeMessage}</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#0D9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
        Consulter ${escapeHtml(opts.docLabel)}${opts.num ? ' ' + escapeHtml(opts.num) : ''}
      </a>
    </p>
    <p style="font-size:0.85rem;color:#6B6B70;">${escapeHtml(opts.entrepriseNom)}</p>
  </body></html>`;
}

async function callResend(payload: { to: string; cc: string[]; subject: string; html: string }):
  Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  if (!resendApiKey || !emailFrom) return { ok: false, error: 'Fournisseur email non configuré.' };
  try {
    const res = await fetch(resendApiUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + resendApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom, to: [payload.to], cc: payload.cc.length ? payload.cc : undefined,
        subject: payload.subject, html: payload.html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (body && (body.message || body.error)) || ('Erreur fournisseur (HTTP ' + res.status + ')') };
    if (!body || !body.id) return { ok: false, error: 'Réponse fournisseur invalide.' };
    return { ok: true, messageId: body.id };
  } catch (e) {
    return { ok: false, error: 'Fournisseur email injoignable.' };
  }
}

async function handleSend(req: Request, cors: Record<string, string>): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse(cors, { ok: false, error: 'JSON invalide.', code: 'bad_request' }, 400); }

  const uid = await getAuthenticatedUserId(req);
  if (!uid) return jsonResponse(cors, { ok: false, error: 'Non authentifié.', code: 'unauthenticated' }, 401);

  const account = String(body.account || '').trim();
  if (!account) return jsonResponse(cors, { ok: false, error: 'Compte manquant.', code: 'bad_request' }, 400);

  const ownership = await assertPatronOwnsAccount(uid, account);
  if (!ownership.ok) {
    const status = ownership.code === 'not_found' ? 404 : 403;
    return jsonResponse(cors, { ok: false, error: ownership.error, code: ownership.code }, status);
  }
  const state = ownership.state;

  const clientId = String(body.clientId || '').trim();
  if (!clientId) return jsonResponse(cors, { ok: false, error: 'Client manquant.', code: 'bad_request' }, 400);

  if (!isValidDocumentType(body.documentType)) return jsonResponse(cors, { ok: false, error: 'Type de document invalide.', code: 'bad_request' }, 400);
  const documentType: DocumentType = body.documentType;

  const documentId = String(body.documentId || '').trim();
  if (!documentId) return jsonResponse(cors, { ok: false, error: 'Document manquant.', code: 'bad_request' }, 400);

  const recipient = normalizeEmail(body.recipient);
  if (!recipient) return jsonResponse(cors, { ok: false, error: 'Destinataire invalide.', code: 'invalid_recipient' }, 400);
  const cc = normalizeCcList(body.cc, recipient);
  if (body.cc && !cc.length && String(body.cc).trim()) {
    // cc fourni mais rien de valide après normalisation -- refuse plutôt
    // qu'ignorer silencieusement une saisie du patron.
    return jsonResponse(cors, { ok: false, error: 'CC invalide.', code: 'invalid_cc' }, 400);
  }

  const attemptId = clampSingleLine(body.attemptId, MAX_ATTEMPT_ID_LEN);
  if (!attemptId) return jsonResponse(cors, { ok: false, error: 'Tentative invalide.', code: 'bad_request' }, 400);

  const resolved = resolveDocument(state, clientId, documentType, documentId);
  if (!resolved.ok) {
    const status = resolved.code === 'document_not_found' || resolved.code === 'payment_not_found' || resolved.code === 'client_not_found' ? 404 : 422;
    return jsonResponse(cors, { ok: false, error: resolved.error, code: resolved.code }, status);
  }
  const doc = resolved.doc;

  const subject = clampSingleLine(body.subject, MAX_SUBJECT_LEN) ||
    ('Votre ' + DOC_TYPE_LABEL[documentType] + (doc.num ? ' ' + doc.num : '') + ' — ' + doc.entrepriseNom);
  const message = clampMultiLine(body.message, MAX_MESSAGE_LEN) ||
    ('Bonjour, veuillez consulter votre ' + DOC_TYPE_LABEL[documentType] + ' via le lien ci-dessous.');

  const idempotencyKey = await buildIdempotencyKey({ account, uid, documentType, documentId, attemptId });
  const link = buildPortalLink(doc.linkParams);

  // Verrou idempotent : tente une création 'creating' -- la contrainte
  // unique(account, idempotency_key) sert de verrou réel contre les
  // doubles appels concurrents (jamais uniquement un bouton désactivé
  // côté navigateur).
  const createRes = await fetch(supabaseUrl + '/rest/v1/commercial_email_deliveries', {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      account, user_id: uid, client_id: clientId, document_type: documentType, document_id: documentId,
      recipient, subject, status: 'creating', idempotency_key: idempotencyKey,
    }),
  });

  let deliveryRow: any;
  if (createRes.status === 409) {
    // Ligne déjà existante pour cette idempotency_key -- relit l'état
    // réel, ne rappelle JAMAIS Resend pour un retry du même attemptId.
    const existingRes = await fetch(
      supabaseUrl + '/rest/v1/commercial_email_deliveries?select=*&account=eq.' + encodeURIComponent(account) + '&idempotency_key=eq.' + encodeURIComponent(idempotencyKey),
      { headers: svcHeaders },
    );
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    deliveryRow = existingRows[0];
    if (!deliveryRow) return jsonResponse(cors, { ok: false, error: 'Erreur serveur.', code: 'server_error' }, 500);
    if (deliveryRow.status === 'sent' || deliveryRow.status === 'delivered') {
      return jsonResponse(cors, {
        ok: true, deliveryId: deliveryRow.id, status: deliveryRow.status,
        providerMessageId: deliveryRow.provider_message_id, reused: true, documentLink: link,
      });
    }
    if (deliveryRow.status === 'creating') {
      return jsonResponse(cors, { ok: true, deliveryId: deliveryRow.id, status: 'creating', providerMessageId: null, reused: true, documentLink: link });
    }
    // failed : même attemptId -> renvoie l'échec existant, jamais un
    // renvoi silencieux (un vrai renvoi exige un nouvel attemptId côté
    // navigateur -> nouvelle idempotency_key -> nouvelle ligne).
    return jsonResponse(cors, { ok: false, error: deliveryRow.failure_reason || 'Envoi précédent en échec.', code: 'previous_attempt_failed', deliveryId: deliveryRow.id }, 409);
  }
  if (!createRes.ok) return jsonResponse(cors, { ok: false, error: 'Erreur serveur.', code: 'server_error' }, 500);
  const createdRows = await createRes.json();
  deliveryRow = createdRows[0];

  const html = buildEmailHtml({ entrepriseNom: doc.entrepriseNom, docLabel: DOC_TYPE_LABEL[documentType], num: doc.num, message, link });
  const sendResult = await callResend({ to: recipient, cc, subject, html });

  if (sendResult.ok) {
    await fetch(supabaseUrl + '/rest/v1/commercial_email_deliveries?id=eq.' + encodeURIComponent(deliveryRow.id), {
      method: 'PATCH', headers: svcHeaders,
      body: JSON.stringify({ status: 'sent', provider_message_id: sendResult.messageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    return jsonResponse(cors, { ok: true, deliveryId: deliveryRow.id, status: 'sent', providerMessageId: sendResult.messageId, reused: false, documentLink: link });
  }

  await fetch(supabaseUrl + '/rest/v1/commercial_email_deliveries?id=eq.' + encodeURIComponent(deliveryRow.id), {
    method: 'PATCH', headers: svcHeaders,
    body: JSON.stringify({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: clampSingleLine(sendResult.error, 500), updated_at: new Date().toISOString() }),
  });
  return jsonResponse(cors, { ok: false, error: sendResult.error, code: 'provider_error', deliveryId: deliveryRow.id }, 502);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { ok: false, error: 'Méthode non autorisée.', code: 'method_not_allowed' }, 405);
  try {
    return await handleSend(req, cors);
  } catch (e) {
    console.error('send-commercial-document error:', e);
    return jsonResponse(cors, { ok: false, error: 'Erreur serveur.', code: 'server_error' }, 500);
  }
});
