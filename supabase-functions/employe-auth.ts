// ═══════════════════════════════════════════════════════════════
// SEBA — Authentification légère par PIN (identité terrain, Palier 1).
//
// Deuxième couche d'identité AU-DESSUS de l'auth Supabase normale, pas un
// remplacement : l'appareil (tablette de chantier) est déjà authentifié
// en tant que PATRON (JWT Supabase classique, vérifié ici via
// verifyUser(), même mécanisme que ai-relay.ts/send-email.ts). Ce PIN ne
// fait qu'identifier QUEL employé utilise l'appareil du patron à cet
// instant — jamais un compte Supabase Auth indépendant par employé
// (voir ANALYSE-ANGLES-MORTS-IA-TERRAIN.md section 0.2/1.2).
//
// pin_hash vit dans employe_credentials (jamais dans le blob seba_state,
// jamais renvoyé au client) — table dédiée car `employes` (table réelle)
// n'est pas écrite aujourd'hui (Pilier 2). Verrou anti brute-force
// obligatoire : un PIN à 4 chiffres n'a que 10 000 combinaisons.
//
// Body attendu : { account, employe_id, pin, device_id }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { compare } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_HOURS = 12;

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

/* JWT du CALLER (le patron, deja connecte via Supabase Auth normal) ->
   auth.uid(). Meme mecanisme que ai-relay.ts : decodage synchrone, aucun
   appel reseau. Sans ca, n'importe qui sur internet pourrait tenter des
   PIN sur n'importe quel compte -- ce garde-fou est ce qui restreint la
   surface d'attaque a "quelqu'un qui a deja une session patron valide". */
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

  let body: { account?: string; employe_id?: string; pin?: string; device_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { account, employe_id, pin, device_id } = body;
  if (!account || !employe_id || !pin || !device_id) {
    return jsonResponse(cors, { error: 'Paramètres manquants' }, 400);
  }

  // Le caller doit être le PROPRIÉTAIRE du compte visé -- sans ça, un JWT
  // valide sur N'IMPORTE QUEL compte suffirait à tenter des PIN sur les
  // employés d'un AUTRE compte. C'est le vrai périmètre RLS de seba_state,
  // vérifié ici manuellement car cette fonction tourne en service_role
  // (RLS ne s'applique pas, donc ce contrôle doit être explicite).
  const { data: owner } = await supabase.from('seba_state').select('user_id').eq('account', account).maybeSingle();
  if (!owner || owner.user_id !== callerUid) {
    return jsonResponse(cors, { error: 'Compte introuvable ou non autorisé' }, 403);
  }

  const generic401 = () => jsonResponse(cors, { error: 'Identifiants invalides' }, 401);

  const { data: cred } = await supabase
    .from('employe_credentials')
    .select('pin_hash, failed_attempts, locked_until')
    .match({ employe_id, account })
    .maybeSingle();

  // Meme message generique qu'un mauvais PIN (protection anti-enumeration) :
  // un employe_id inexistant pour ce compte ne doit rien reveler de plus.
  if (!cred) return generic401();

  if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
    return jsonResponse(cors, { error: 'Compte temporairement verrouillé, réessayez plus tard' }, 429);
  }

  const isValid = await compare(pin, cred.pin_hash);

  if (!isValid) {
    const attempts = cred.failed_attempts + 1;
    const patch: Record<string, unknown> = { failed_attempts: attempts, updated_at: new Date().toISOString() };
    if (attempts >= MAX_ATTEMPTS) {
      patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      patch.failed_attempts = 0; // repart a zero apres le verrouillage, pas un compteur qui grossit indefiniment
    }
    await supabase.from('employe_credentials').update(patch).match({ employe_id, account });
    return generic401();
  }

  // Succes : reset du compteur d'echecs, emission d'une session.
  await supabase.from('employe_credentials').update({ failed_attempts: 0, locked_until: null }).match({ employe_id, account });

  const token = crypto.randomUUID();
  const expires_at = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();

  const { error: sessionError } = await supabase.from('employe_sessions').insert({
    account, employe_id, device_id, token, expires_at,
  });
  if (sessionError) {
    console.error(sessionError);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  return jsonResponse(cors, { token, expires_at });
});
