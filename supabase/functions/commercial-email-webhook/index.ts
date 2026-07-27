// ═══════════════════════════════════════════════════════════════
// SEBA — Webhook Resend (feature/customer-email-delivery, PHASE 1).
// Met à jour UNIQUEMENT le statut de livraison (delivered/failed/bounced)
// de la ligne commercial_email_deliveries correspondante -- ne crée
// jamais de seconde table d'événements, ne touche jamais account/
// document_type/document_id/recipient.
//
// Signature vérifiée AVANT toute désérialisation de confiance (schéma
// Svix, voir _shared/commercial-email.ts:verifySvixSignature) -- un
// corps dont la signature ne correspond pas est rejeté sans lecture.
// ═══════════════════════════════════════════════════════════════

import { verifySvixSignature, jsonResponse } from '../_shared/commercial-email.ts';

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
const svcHeaders = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

// event.type Resend -> statut Seba. Seuls delivered/bounced sont gérés
// (section 12 du chantier) -- tout autre type (delivery_delayed,
// complained, opened, clicked...) est ignoré (accusé réception 200,
// aucune écriture, jamais un statut inventé).
const EVENT_TO_STATUS: Record<string, 'delivered' | 'failed'> = {
  'email.delivered': 'delivered',
  'email.bounced': 'failed',
};

export async function handleWebhookBody(rawBody: string, headers: { id: string; timestamp: string; signature: string }) {
  const verify = await verifySvixSignature({ secret: webhookSecret, id: headers.id, timestamp: headers.timestamp, rawBody, signatureHeader: headers.signature });
  if (!verify.ok) return { status: 401 as const, body: { ok: false, error: verify.error } };

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return { status: 400 as const, body: { ok: false, error: 'JSON invalide.' } }; }

  const type = payload && payload.type;
  const providerMessageId = payload && payload.data && payload.data.email_id;
  const newStatus = EVENT_TO_STATUS[type];
  if (!newStatus || !providerMessageId) return { status: 200 as const, body: { ok: true, ignored: true } };

  const findRes = await fetch(
    supabaseUrl + '/rest/v1/commercial_email_deliveries?select=id,status&provider_message_id=eq.' + encodeURIComponent(providerMessageId),
    { headers: svcHeaders },
  );
  if (!findRes.ok) return { status: 500 as const, body: { ok: false, error: 'Erreur serveur.' } };
  const rows = await findRes.json();
  const row = rows[0];
  if (!row) return { status: 200 as const, body: { ok: true, ignored: true } }; // livraison inconnue -- accusé réception, jamais une erreur bruyante

  // Jamais de régression delivered -> sent/failed (idempotent : un replay
  // du même événement, ou un événement tardif après un état plus
  // définitif, ne doit jamais reculer le statut).
  if (row.status === 'delivered') return { status: 200 as const, body: { ok: true, alreadyFinal: true } };

  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === 'delivered') patch.delivered_at = new Date().toISOString();
  if (newStatus === 'failed') {
    patch.failed_at = new Date().toISOString();
    patch.failure_reason = String((payload.data && payload.data.reason) || type).slice(0, 500);
  }

  const patchRes = await fetch(supabaseUrl + '/rest/v1/commercial_email_deliveries?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH', headers: svcHeaders, body: JSON.stringify(patch),
  });
  if (!patchRes.ok) return { status: 500 as const, body: { ok: false, error: 'Erreur serveur.' } };
  return { status: 200 as const, body: { ok: true, deliveryId: row.id, status: newStatus } };
}

Deno.serve(async (req) => {
  const cors = corsHeaders();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { ok: false, error: 'Méthode non autorisée.' }, 405);

  const rawBody = await req.text();
  const id = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signature = req.headers.get('svix-signature') || '';

  try {
    const result = await handleWebhookBody(rawBody, { id, timestamp, signature });
    return jsonResponse(cors, result.body, result.status);
  } catch (e) {
    return jsonResponse(cors, { ok: false, error: 'Erreur serveur.' }, 500);
  }
});
