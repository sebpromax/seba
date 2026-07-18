// ═══════════════════════════════════════════════════════════════
// SEBA — Définition/changement du PIN terrain d'un employé (Palier 1).
//
// Complète employe-auth.ts : celui-ci VÉRIFIE un PIN, celui-ci en
// DÉFINIT un. Même modèle d'identité : appelé par le PATRON (JWT
// Supabase classique, vérifié via verifyUser()) depuis employe-fiche.html
// -- jamais par l'employé lui-même, qui n'a pas de session Supabase Auth
// indépendante (voir employe-auth.ts, en-tête).
//
// pin_hash ne transite JAMAIS en clair côté serveur au-delà de cette
// fonction : hashé ici (bcrypt) avant écriture dans employe_credentials,
// qui n'a aucune policy RLS (accès service_role uniquement).
//
// Body attendu : { account, employe_id, pin }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hash } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

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

/* JWT du CALLER (le patron) -> auth.uid(). Identique à employe-auth.ts. */
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

  let body: { account?: string; employe_id?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }
  const { account, employe_id, pin } = body;
  if (!account || !employe_id || !pin) {
    return jsonResponse(cors, { error: 'Paramètres manquants' }, 400);
  }
  if (!/^\d{4}$/.test(pin)) {
    return jsonResponse(cors, { error: 'Le PIN doit être composé de 4 chiffres' }, 400);
  }

  // Même garde-fou que employe-auth.ts : le caller doit être le
  // PROPRIÉTAIRE du compte visé, sinon un JWT valide sur N'IMPORTE QUEL
  // compte suffirait à écraser le PIN des employés d'un AUTRE compte.
  const { data: owner } = await supabase.from('seba_state').select('user_id').eq('account', account).maybeSingle();
  if (!owner || owner.user_id !== callerUid) {
    return jsonResponse(cors, { error: 'Compte introuvable ou non autorisé' }, 403);
  }

  const pin_hash = await hash(pin);

  const { error } = await supabase
    .from('employe_credentials')
    .upsert(
      { employe_id, account, pin_hash, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() },
      { onConflict: 'employe_id' },
    );
  if (error) {
    console.error(error);
    return jsonResponse(cors, { error: 'Erreur serveur' }, 500);
  }

  return jsonResponse(cors, { ok: true });
});
