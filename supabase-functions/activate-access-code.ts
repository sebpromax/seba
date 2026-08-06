// ═══════════════════════════════════════════════════════════════
// SEBA — Activation d'un accès Client/Salarié par code provisoire
// (feat/client-employee-initial-access-code).
//
// Fonction PUBLIQUE (verify_jwt=false, config projet) : appelée AVANT
// authentification, comme un formulaire de connexion classique. Durcie
// explicitement : CORS restreint, validation stricte du body, rate
// limiting par IP, message d'erreur générique unique (jamais de détail
// permettant d'énumérer les emails), aucun secret dans les logs.
//
// Orchestration (voir migrations/2026-08-03-provisional-access-code.sql
// pour le détail des 3 RPC atomiques appelées ici) :
//   1. verify_access_code_attempt() -- Postgres, atomique, FOR UPDATE.
//   2. (hors transaction Postgres) auth.admin.createUser() si nécessaire,
//      OU réutilisation de auth_user_id déjà connu (reprise réseau) --
//      JAMAIS un second compte créé pour la même invitation.
//   3. finalize_access_code() -- Postgres, atomique : liaison métier +
//      statut 'password_pending' (PAS 'activated' -- posé plus tard par
//      mark_access_code_activated(), appelée par le frontend authentifié
//      après la création réelle du mot de passe).
//   4. auth.admin.generateLink(type:'recovery') -- toujours ce type,
//      fonctionne aussi bien pour un compte tout juste créé que pour une
//      reprise sur un compte déjà confirmé sans mot de passe.
//   5. Renvoie {token_hash, type} -- jamais le lien complet, jamais le
//      code, jamais code_hash.
//
// Compte Auth déjà existant AVANT cette invitation (jamais un
// rattachement automatique, jamais un mot de passe changé silencieusement) :
// si verify_access_code_attempt() ne renvoie PAS de auth_user_id déjà
// connu ET qu'auth.admin.createUser() échoue avec "already registered",
// c'est un compte externe préexistant -- l'invitation est révoquée et un
// message générique invite à se connecter normalement ou à réinitialiser
// son mot de passe.
//
// Body attendu : { email, code, role: 'client'|'employe' }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { forbiddenOriginResponse, getCorsHeaders } from './_shared/cors.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Z2-9]{8}$/;
const GENERIC_ERROR = 'Email ou code invalide, expiré ou déjà utilisé.';
const RATE_LIMIT_PER_IP_PER_DAY = 60; // large marge sous un usage légitime, bloque un balayage automatisé

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return (fwd.split(',')[0] || 'unknown').trim().slice(0, 64);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkIpRateLimit(ip: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from('api_usage').select('count').eq('account', 'ip:' + ip).eq('kind', 'access-code-verify').eq('day', today).maybeSingle();
  const count = (data && (data as { count: number }).count) || 0;
  if (count >= RATE_LIMIT_PER_IP_PER_DAY) return false;
  await supabase.from('api_usage').upsert({ account: 'ip:' + ip, kind: 'access-code-verify', day: today, count: count + 1 }, { onConflict: 'account,kind,day' });
  return true;
}

function extractTokenFromActionLink(actionLink: string): { token_hash: string; type: string } | null {
  try {
    const url = new URL(actionLink);
    const tokenHash = url.searchParams.get('token') || url.searchParams.get('token_hash');
    const type = url.searchParams.get('type') || 'recovery';
    if (!tokenHash) return null;
    return { token_hash: tokenHash, type };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (!cors) return forbiddenOriginResponse();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const ip = clientIp(req);
  const allowed = await checkIpRateLimit(ip);
  if (!allowed) return jsonResponse(cors, { error: GENERIC_ERROR }, 429);

  let body: { email?: string; code?: string; role?: string };
  try {
    const raw = await req.text();
    if (raw.length > 2000) return jsonResponse(cors, { error: 'Requête invalide' }, 400);
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const role = body.role;

  // Validation stricte du body AVANT toute requête base de données.
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse(cors, { error: GENERIC_ERROR }, 400);
  if (!code || !CODE_RE.test(code)) return jsonResponse(cors, { error: GENERIC_ERROR }, 400);
  if (role !== 'client' && role !== 'employe') return jsonResponse(cors, { error: GENERIC_ERROR }, 400);

  // 1. Vérification atomique du code (RPC service_role, jamais exposée
  // directement au navigateur).
  const { data: verifyResult, error: verifyError } = await supabase.rpc('verify_access_code_attempt', {
    p_email: email, p_code: code, p_role: role,
  });
  if (verifyError || !verifyResult || !(verifyResult as { ok: boolean }).ok) {
    return jsonResponse(cors, { error: GENERIC_ERROR }, 401);
  }
  const v = verifyResult as { invitation_id: string; account: string; entity_id: string; role: string; email: string; auth_user_id: string | null };

  // 2. Compte Auth : réutilise s'il est déjà connu pour CETTE invitation
  // (reprise réseau), sinon tente une création. Un échec "already
  // registered" à ce stade signifie un compte externe préexistant --
  // jamais de rattachement automatique.
  let authUserId = v.auth_user_id;
  if (!authUserId) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email: v.email, email_confirm: true });
    if (createError) {
      const msg = String(createError.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        // revoke_access_code() est reservee au patron authentifie
        // (auth.uid()) -- ici, mise a jour directe via le client
        // service_role (contourne RLS par defaut), le patron verra le
        // statut "revoked" sur sa fiche au prochain rafraichissement.
        await supabase.from('provisional_access_codes').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', v.invitation_id);
        return jsonResponse(cors, { error: 'Un compte existe déjà pour cette adresse. Connectez-vous normalement ou utilisez « mot de passe oublié ».' }, 409);
      }
      console.error('[activate-access-code] createUser error (jamais le code/email complet loggé)');
      return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
    }
    authUserId = created.user?.id || null;
    if (!authUserId) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  // 3. Liaison métier + passage à 'password_pending' -- atomique, jamais
  // 'activated' à ce stade.
  const { data: finalizeResult, error: finalizeError } = await supabase.rpc('finalize_access_code', {
    p_invitation_id: v.invitation_id, p_auth_user_id: authUserId,
  });
  if (finalizeError || !finalizeResult || !(finalizeResult as { ok: boolean }).ok) {
    return jsonResponse(cors, { error: GENERIC_ERROR }, 401);
  }

  // 4. Génère un token de session frais (toujours 'recovery' : fonctionne
  // pour un compte neuf comme pour une reprise, voir en-tête).
  // origin non-null garanti ici : une origine absente/inconnue a deja ete
  // rejetee (403) par getCorsHeaders() plus haut.
  const origin = req.headers.get('origin')!;
  const redirectTo = origin + (v.role === 'client' ? '/client-connexion.html' : '/employe-connexion.html');
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'recovery', email: v.email, options: { redirectTo },
  });
  if (linkError || !linkData?.properties?.action_link) {
    console.error('[activate-access-code] generateLink error');
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }
  const token = extractTokenFromActionLink(linkData.properties.action_link);
  if (!token) return jsonResponse(cors, { error: 'Erreur serveur' }, 500);

  return jsonResponse(cors, { ok: true, token_hash: token.token_hash, type: token.type, role: v.role });
});
