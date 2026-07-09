// ═══════════════════════════════════════════════════════════════
// SEBA — Synchronisation incrémentale par patch (Palier 1).
//
// Remplace le POST direct sur seba_state (upsert du blob entier) :
// reçoit un batch d'opérations en attente d'un appareil, les applique une
// par une via apply_entity_patch() (atomique, verrouillage par ligne côté
// Postgres), journalise chacune dans sync_operations, et acquitte.
//
// Double voie d'authentification :
//   - Authorization: Bearer <jwt patron>  -> écriture directe, employee_id null.
//   - X-Employee-Token: <token>           -> résolu via employe_sessions,
//     account + employee_id dérivés de la session (jamais déclarés par le client).
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
// Audit go-live (AUDIT-GO-LIVE-SEBA.md, section 2) : ce fichier n'a aucun
// fetch() litteral (uniquement le client supabase-js) -- l'equivalent reel
// pour poser une limite de temps est .abortSignal() sur chaque requete/RPC,
// utilise systematiquement ci-dessous plutot que d'ignorer la consigne
// faute de fetch() a modifier au sens strict.
const FETCH_TIMEOUT_MS = 5000;

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-employee-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

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

interface SyncOp {
  client_seq: number;
  entity: string;
  entity_id: string;
  op: 'create' | 'update' | 'delete';
  patch: Record<string, unknown>;
}

interface OpResult {
  client_seq: number;
  status: 'applied' | 'ack_duplicate' | 'error';
  version?: number;
  last_snapshot?: Record<string, unknown>;
  error?: string;
}

const VALID_ENTITIES = new Set(['clients', 'devis', 'factures', 'interventions', 'employes', 'journal']);

/* Résout account + employee_id à partir des deux voies d'auth possibles.
   PRIORITÉ à X-Employee-Token quand il est présent : sur une tablette
   partagée, l'appareil reste authentifié comme le patron (JWT Supabase)
   PENDANT que le PIN identifie l'employé du moment -- les deux en-têtes
   sont donc présents simultanément dans le cas réel. Vérifier le JWT en
   premier attribuerait alors TOUJOURS l'opération au patron, ce qui
   annule l'intérêt de la couche PIN (traçabilité par employé). Le JWT
   patron ne sert de repli que lorsqu'aucun employé n'est identifié sur
   l'appareil (le patron utilise le dashboard lui-même). */
async function resolveIdentity(req: Request): Promise<{ account: string; user_id: string; employee_id: string | null } | null> {
  const employeeToken = req.headers.get('x-employee-token');

  if (employeeToken) {
    const { data: session } = await supabase
      .from('employe_sessions')
      .select('account, employe_id')
      .match({ token: employeeToken, revoked: false })
      .gt('expires_at', new Date().toISOString())
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
      .maybeSingle();
    if (session) {
      const { data: owner } = await supabase
        .from('seba_state')
        .select('user_id')
        .eq('account', session.account)
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
        .maybeSingle();
      if (owner) return { account: session.account, user_id: owner.user_id, employee_id: session.employe_id };
    }
    // Token employé présent mais invalide/expiré : ne PAS retomber
    // silencieusement sur le JWT patron (masquerait un problème de session
    // employé réel) -- échec net, l'appareil doit redemander un PIN.
    return null;
  }

  const callerUid = verifyUser(req);
  if (callerUid) {
    const { data } = await supabase
      .from('seba_state')
      .select('account, user_id')
      .eq('user_id', callerUid)
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
      .maybeSingle();
    if (!data) return null;
    return { account: data.account, user_id: data.user_id, employee_id: null };
  }

  return null;
}

async function applyOne(identity: { account: string; user_id: string; employee_id: string | null }, device_id: string, op: SyncOp): Promise<OpResult> {
  if (!VALID_ENTITIES.has(op.entity) || typeof op.entity_id !== 'string' || !op.entity_id) {
    return { client_seq: op.client_seq, status: 'error', error: 'entity ou entity_id invalide' };
  }
  if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) {
    return { client_seq: op.client_seq, status: 'error', error: 'patch invalide (objet requis)' };
  }

  // Idempotence, version atomique (audit go-live, AUDIT-GO-LIVE-SEBA.md
  // section 4) : l'ancienne version faisait un SELECT de verification PUIS
  // un INSERT separe -- fenetre de course reelle entre les deux si le meme
  // batch est rejoue en parallele (retry reseau pendant que l'original est
  // encore en vol), pouvant faire executer apply_entity_patch deux fois
  // pour UNE operation logique. Remplace par un upsert avec
  // ignoreDuplicates (= INSERT ... ON CONFLICT (...) DO NOTHING cote
  // PostgREST) : la contrainte UNIQUE de sync_operations devient le SEUL
  // arbitre, tranche atomiquement par Postgres, plus de fenetre possible.
  // Si la ligne existait deja, inserted est un tableau VIDE (pas d'erreur,
  // pas de ligne retournee) -- c'est ce qui distingue un vrai doublon d'une
  // premiere ecriture, sans jamais avoir appele apply_entity_patch entre
  // les deux tentatives concurrentes.
  const { data: inserted, error: insertError } = await supabase
    .from('sync_operations')
    .upsert(
      {
        account: identity.account,
        user_id: identity.user_id,         // explicite : default auth.uid() vaudrait NULL sous service_role
        employee_id: identity.employee_id,
        device_id,
        client_seq: op.client_seq,
        entity: op.entity,
        entity_id: op.entity_id,
        op: op.op,
        patch: op.patch,
      },
      { onConflict: 'account,device_id,client_seq', ignoreDuplicates: true },
    )
    .select()
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  if (insertError) {
    return { client_seq: op.client_seq, status: 'error', error: insertError.message };
  }
  if (!inserted || inserted.length === 0) {
    // Doublon reel, deja journalise par une tentative precedente (gagnante
    // de la course) -- jamais rejoue, jamais d'erreur trompeuse.
    return { client_seq: op.client_seq, status: 'ack_duplicate' };
  }

  // Garanti a partir d'ici : nous sommes le SEUL appelant a avoir gagne
  // l'insertion pour ce (account, device_id, client_seq) -- la contrainte
  // UNIQUE de Postgres a tranche, pas notre code. apply_entity_patch ne
  // peut donc plus jamais etre invoquee deux fois pour la meme operation.
  const { data: patched, error: rpcError } = await supabase
    .rpc('apply_entity_patch', {
      p_account: identity.account,
      p_entity: op.entity,
      p_entity_id: op.entity_id,
      p_patch_jsonb: op.patch,
    })
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
    .single();

  if (rpcError || !patched) {
    // Compense l'insertion qui vient de reussir : sans ce delete, un
    // retry futur de ce MEME client_seq serait vu a tort comme un
    // doublon (inserted.length === 0 au prochain appel) et ne
    // redeclencherait plus jamais apply_entity_patch -- l'operation
    // resterait bloquee indefiniment, journalisee mais jamais appliquee.
    // Fenetre residuelle (assumee, pas ignoree) : un doublon concurrent
    // qui arriverait EXACTEMENT pendant ce delete pourrait re-gagner la
    // course et re-appliquer le patch -- au pire aussi severe que la race
    // d'origine corrigee ci-dessus (merge idempotent en valeur, jamais de
    // corruption), jamais pire.
    await supabase
      .from('sync_operations')
      .delete()
      .match({ account: identity.account, device_id, client_seq: op.client_seq })
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
    return { client_seq: op.client_seq, status: 'error', error: rpcError?.message ?? 'apply_entity_patch: réponse vide' };
  }

  return { client_seq: op.client_seq, status: 'applied', version: patched.out_version, last_snapshot: patched.out_last_snapshot };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const identity = await resolveIdentity(req);
  if (!identity) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  let body: { device_id?: string; operations?: SyncOp[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(cors, { error: 'JSON invalide' }, 400);
  }

  const { device_id, operations } = body;
  if (!device_id || typeof device_id !== 'string') {
    return jsonResponse(cors, { error: 'device_id manquant' }, 400);
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    return jsonResponse(cors, { error: 'operations manquant ou vide' }, 400);
  }

  // Ordre du batch respecté (pas de Promise.all) : les patches d'un même
  // appareil sur une même entité doivent s'appliquer dans l'ordre de
  // client_seq, jamais en parallèle désordonné.
  const results: OpResult[] = [];
  for (const op of operations) {
    results.push(await applyOne(identity, device_id, op));
  }

  const hasError = results.some((r) => r.status === 'error');
  return jsonResponse(cors, { results }, hasError ? 207 : 200);
});
