// ═══════════════════════════════════════════════════════════════
// SEBA — Helpers partagés pour l'envoi email des documents commerciaux
// (feature/customer-email-delivery, PHASE 1). Validation, idempotence,
// échappement -- rien de spécifique à Resend ni à la résolution de
// document ici (voir index.ts pour l'orchestration).
// ═══════════════════════════════════════════════════════════════

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LEN = 254;
export const MAX_SUBJECT_LEN = 180;
export const MAX_MESSAGE_LEN = 4000;
export const MAX_ATTEMPT_ID_LEN = 100;
export const MAX_CC = 5;

export function normalizeEmail(v: unknown): string | null {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s || s.length > MAX_EMAIL_LEN || !EMAIL_RE.test(s)) return null;
  return s;
}

/* cc : chaîne "a@x.fr, b@y.fr" OU tableau -- normalisé, dédupliqué,
   jamais le destinataire principal en double, jamais plus de MAX_CC. */
export function normalizeCcList(v: unknown, exclude: string): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? v.split(/[,;]/) : []);
  const out: string[] = [];
  for (const item of raw) {
    const email = normalizeEmail(item);
    if (email && email !== exclude && out.indexOf(email) === -1) out.push(email);
    if (out.length >= MAX_CC) break;
  }
  return out;
}

/* Retire les caractères de contrôle dangereux (jamais un saut de ligne
   dans un header email -- injection de header), garde \n pour le corps
   du message. */
export function clampSingleLine(v: unknown, max: number): string {
  return String(v == null ? '' : v).replace(/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim().slice(0, max);
}
export function clampMultiLine(v: unknown, max: number): string {
  return String(v == null ? '' : v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim().slice(0, max);
}

export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c]);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* idempotency_key déterministe -- même (account, uid, documentType,
   documentId, attemptId) => même clé. Un retry (même attemptId, ex.
   double-clic ou retry réseau du navigateur) retombe donc TOUJOURS sur
   la même ligne (contrainte unique(account, idempotency_key), voir
   migration) -- jamais un second email. Un renvoi manuel réel doit
   fournir un nouvel attemptId (généré côté navigateur au moment du
   clic sur "Renvoyer"). */
export async function buildIdempotencyKey(parts: {
  account: string; uid: string; documentType: string; documentId: string; attemptId: string;
}): Promise<string> {
  return sha256Hex([parts.account, parts.uid, parts.documentType, parts.documentId, parts.attemptId].join('|'));
}

export const DOCUMENT_TYPES = ['quote', 'invoice', 'receipt'] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export const DOC_TYPE_LABEL: Record<DocumentType, string> = { quote: 'devis', invoice: 'facture', receipt: 'reçu' };

export function isValidDocumentType(v: unknown): v is DocumentType {
  return typeof v === 'string' && (DOCUMENT_TYPES as readonly string[]).indexOf(v) !== -1;
}

export function jsonResponse(cors: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/* ── Vérification de signature webhook Resend (schéma Svix, documenté
   publiquement) -- fonction PURE, testable sans requête réseau réelle.
   Contenu signé : "{id}.{timestamp}.{body}", HMAC-SHA256 avec le secret
   (préfixe "whsec_" retiré puis décodé en base64), comparé en temps
   constant à chaque signature "v1,<base64>" du header webhook-signature
   (plusieurs valeurs possibles séparées par des espaces -- rotation de
   secret côté fournisseur). ── */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeSvixSignature(secretWithPrefix: string, id: string, timestamp: string, rawBody: string): Promise<string> {
  const secretB64 = secretWithPrefix.replace(/^whsec_/, '');
  const keyBytes = base64ToBytes(secretB64);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signedContent = id + '.' + timestamp + '.' + rawBody;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  return bytesToBase64(new Uint8Array(sig));
}

/* toleranceSeconds : rejette un webhook trop ancien (anti-replay) --
   defaut 5 minutes, meme ordre de grandeur que la tolerance standard
   Svix documentee. */
export async function verifySvixSignature(opts: {
  secret: string; id: string; timestamp: string; rawBody: string; signatureHeader: string; nowSeconds?: number; toleranceSeconds?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!opts.secret) return { ok: false, error: 'Secret webhook non configuré.' };
  if (!opts.id || !opts.timestamp || !opts.signatureHeader) return { ok: false, error: 'Headers de signature manquants.' };
  const now = opts.nowSeconds != null ? opts.nowSeconds : Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds != null ? opts.toleranceSeconds : 300;
  const ts = parseInt(opts.timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return { ok: false, error: 'Horodatage du webhook hors tolérance.' };

  const expected = await computeSvixSignature(opts.secret, opts.id, opts.timestamp, opts.rawBody);
  const candidates = opts.signatureHeader.split(' ').map((part) => part.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const [version, sig] = candidate.split(',');
    if (version !== 'v1' || !sig) continue;
    if (timingSafeEqualStr(sig, expected)) return { ok: true };
  }
  return { ok: false, error: 'Signature invalide.' };
}
