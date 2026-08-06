// SEBA — QA persistance réelle sync-push (P0 fix/p0-sync-push-apply-
// entity-patch-signature).
//
// Bug trouvé 2026-08-06 : migrations/2026-07-28-sync-push-state-
// persistence.sql a changé la signature de apply_entity_patch() pour
// exiger un 5e paramètre p_op (create/update/delete) et a supprimé
// l'ancienne signature à 4 paramètres -- mais supabase-functions/
// sync-push.ts (la copie documentée comme source de déploiement dans
// MANUEL-SEBA-ADMIN.md) n'a jamais été mise à jour pour l'envoyer.
// Résultat réel : 100% des écritures patron via sync-push échouaient
// silencieusement au niveau HTTP (RPC introuvable), sans aucune
// persistance, même partielle (entity_versions restait vide aussi).
//
// Ce script appelle le VRAI endpoint HTTP sync-push (JWT réel d'un
// patron synthétique, Origin réel), jamais un raccourci SQL direct pour
// simuler ce que sync-push ferait -- c'est précisément le chemin qui a
// été trouvé cassé qu'il faut vérifier.
//
// Prérequis : Supabase local démarré + supabase-functions/sync-push.ts
// copié dans supabase/functions/sync-push/index.ts (copie temporaire,
// jamais committée -- même convention que les autres scripts qa-*.js de
// ce dépôt).
//
// Usage : node scripts/qa-sync-push-persistence.js

import { execSync } from 'node:child_process';

const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'Test-Synthetic-2026!';
const ORIGIN = 'https://sebastienvalentin.com'; // origine réelle de production, pas localhost

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function note(msg) { console.log('  ····  ' + msg); }

function psql(sql) {
  return execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1 -t -A', { input: sql, encoding: 'utf8' });
}

async function createOrGetUser(email) {
  const resp = await fetch(API_URL + '/auth/v1/admin/users', {
    method: 'POST', headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json && json.id) return json.id;
  const out = execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '${email}' limit 1;"`, { encoding: 'utf8' });
  return out.trim();
}

async function signIn(email) {
  const resp = await fetch(API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await resp.json();
  if (!json.access_token) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.access_token;
}

async function syncPush(token, deviceId, operations) {
  const resp = await fetch(API_URL + '/functions/v1/sync-push', {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, operations }),
  });
  return { status: resp.status, json: await resp.json().catch(() => ({})) };
}

/* "Actualisation" -- relit seba_state directement, exactement ce que
   SupabaseAdapter.pull() ferait au reload d'une vraie page. */
function freshState(account) {
  const raw = psql(`select state from seba_state where account='${account}';`);
  return JSON.parse(raw.trim());
}

function entityVersionRow(account, entity, entityId) {
  const raw = psql(`select version, last_snapshot from entity_versions where account='${account}' and entity='${entity}' and entity_id='${entityId}';`);
  const line = raw.trim();
  if (!line) return null;
  const [version, snapshotJson] = line.split('|');
  return { version: Number(version), snapshot: JSON.parse(snapshotJson) };
}

async function main() {
  const ts = Date.now();
  const email = `qa-syncpush-${ts}@test.seba.invalid`;
  const account = 'qa-syncpush-' + ts;

  console.log('== [setup] Patron synthétique dédié ==');
  const userId = await createOrGetUser(email);
  psql(`
    delete from seba_state where account = '${account}';
    insert into seba_state (account, user_id, state) values (
      '${account}', '${userId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    );
  `);
  const token = await signIn(email);
  assert(!!token, 'session réelle établie pour le patron synthétique');

  // ═══ [1/9] Création réelle -- clients ═══
  console.log('\n== [1/9] Client — création réelle via sync-push ==');
  const cliId = 'cli_sp_' + ts;
  const r1 = await syncPush(token, 'device-1', [{ client_seq: 1, entity: 'clients', entity_id: cliId, op: 'create', patch: { id: cliId, nom: 'Client SyncPush QA', prenom: 'Test' } }]);
  assert(r1.status === 200, 'HTTP 200 (observé ' + r1.status + ', ' + JSON.stringify(r1.json) + ')');
  assert(r1.json.results?.[0]?.status === 'applied', 'statut "applied" (observé : ' + JSON.stringify(r1.json.results) + ')');

  let state = freshState(account);
  assert(state.clients.some((c) => c.id === cliId && c.nom === 'Client SyncPush QA'), 'présent dans seba_state.state après actualisation');
  let ev = entityVersionRow(account, 'clients', cliId);
  assert(ev && ev.version === 1, 'présent dans entity_versions, version 1 (observé : ' + JSON.stringify(ev) + ')');

  // ═══ [2/9] Mise à jour réelle ═══
  console.log('\n== [2/9] Client — mise à jour réelle, fusion conservée après actualisation ==');
  const r2 = await syncPush(token, 'device-1', [{ client_seq: 2, entity: 'clients', entity_id: cliId, op: 'update', patch: { nom: 'Client SyncPush QA Modifié' } }]);
  assert(r2.json.results?.[0]?.status === 'applied', 'update appliqué (observé : ' + JSON.stringify(r2.json.results) + ')');
  state = freshState(account);
  const updated = state.clients.find((c) => c.id === cliId);
  assert(updated && updated.nom === 'Client SyncPush QA Modifié' && updated.prenom === 'Test', 'modification conservée après actualisation, fusion superficielle (prénom intact) (' + JSON.stringify(updated) + ')');
  ev = entityVersionRow(account, 'clients', cliId);
  assert(ev && ev.version === 2, 'entity_versions version incrémentée à 2 (observé : ' + ev?.version + ')');

  // ═══ [3/9] Opération invalide -- refusée sans corrompre l'état, dans un batch avec une opération valide ═══
  console.log('\n== [3/9] Opération invalide dans un batch mixte -- refusée proprement, aucune corruption ==');
  const cli2Id = 'cli_sp_valid_' + ts;
  const r3 = await syncPush(token, 'device-1', [
    { client_seq: 3, entity: 'clients', entity_id: cli2Id, op: 'create', patch: { id: cli2Id, nom: 'Client Valide' } },
    { client_seq: 4, entity: 'entite_qui_n_existe_pas', entity_id: 'x', op: 'create', patch: { id: 'x' } },
  ]);
  assert(r3.status === 207, 'HTTP 207 (succès partiel) quand un op échoue dans le batch (observé ' + r3.status + ')');
  const [validResult, invalidResult] = r3.json.results || [];
  assert(validResult?.status === 'applied', 'op valide du batch appliquée malgré l\'échec de l\'autre (' + JSON.stringify(validResult) + ')');
  assert(invalidResult?.status === 'error' && !!invalidResult.error, 'op invalide retourne une erreur claire, jamais masquée (' + JSON.stringify(invalidResult) + ')');
  state = freshState(account);
  assert(state.clients.some((c) => c.id === cli2Id), 'op valide du batch bien persistée après actualisation');
  assert(!('entite_qui_n_existe_pas' in state), 'aucune entité fantôme créée par l\'op invalide (état non corrompu)');
  const orphanSyncOp = psql(`select count(*) from sync_operations where account='${account}' and client_seq=4;`).trim();
  assert(orphanSyncOp === '0', 'aucune ligne sync_operations laissée pour l\'op invalide (compensation appliquée, observé : ' + orphanSyncOp + ')');

  // ═══ [4/9] Suppression réelle ═══
  console.log('\n== [4/9] Client — suppression réelle, conservée après actualisation ==');
  const r4 = await syncPush(token, 'device-1', [{ client_seq: 5, entity: 'clients', entity_id: cliId, op: 'delete', patch: {} }]);
  assert(r4.json.results?.[0]?.status === 'applied', 'delete appliqué (' + JSON.stringify(r4.json.results) + ')');
  state = freshState(account);
  assert(!state.clients.some((c) => c.id === cliId), 'réellement absent de seba_state.state après actualisation');
  ev = entityVersionRow(account, 'clients', cliId);
  assert(ev && ev.version === 3, 'entity_versions conserve la trace d\'audit même après suppression de state (version 3, observé : ' + ev?.version + ')');

  // ═══ [5/9] Rejeu idempotent de la même opération ═══
  console.log('\n== [5/9] Rejeu idempotent -- même client_seq, jamais réappliqué deux fois ==');
  const r5 = await syncPush(token, 'device-1', [{ client_seq: 5, entity: 'clients', entity_id: cliId, op: 'delete', patch: {} }]);
  assert(r5.json.results?.[0]?.status === 'ack_duplicate', 'rejeu exact reconnu comme doublon, jamais ré-exécuté (' + JSON.stringify(r5.json.results) + ')');

  // ═══ [6/9] Plusieurs opérations dans un même push ═══
  console.log('\n== [6/9] Plusieurs opérations dans un même push -- toutes appliquées, dans l\'ordre ==');
  const cli3Id = 'cli_sp_batch_a_' + ts;
  const cli4Id = 'cli_sp_batch_b_' + ts;
  const r6 = await syncPush(token, 'device-1', [
    { client_seq: 6, entity: 'clients', entity_id: cli3Id, op: 'create', patch: { id: cli3Id, nom: 'Batch A' } },
    { client_seq: 7, entity: 'clients', entity_id: cli4Id, op: 'create', patch: { id: cli4Id, nom: 'Batch B' } },
    { client_seq: 8, entity: 'clients', entity_id: cli3Id, op: 'update', patch: { nom: 'Batch A Modifié' } },
  ]);
  assert((r6.json.results || []).every((r) => r.status === 'applied'), 'les 3 opérations du même push toutes appliquées (' + JSON.stringify(r6.json.results) + ')');
  state = freshState(account);
  assert(state.clients.some((c) => c.id === cli4Id && c.nom === 'Batch B'), 'Batch B présent après actualisation');
  assert(state.clients.some((c) => c.id === cli3Id && c.nom === 'Batch A Modifié'), 'Batch A présent ET déjà modifié après actualisation (ordre respecté dans le même push)');

  // ═══ [7-9] Autre entité métier réellement prise en charge -- employes (pas seulement clients) ═══
  console.log('\n== [7/9] Autre entité (employes) — création réelle ==');
  const empId = 'emp_sp_' + ts;
  const r7 = await syncPush(token, 'device-1', [{ client_seq: 9, entity: 'employes', entity_id: empId, op: 'create', patch: { id: empId, prenom: 'Employé', nom: 'SyncPush QA' } }]);
  assert(r7.json.results?.[0]?.status === 'applied', 'création employe appliquée (' + JSON.stringify(r7.json.results) + ')');
  state = freshState(account);
  assert(state.employes.some((e) => e.id === empId), 'employe présent dans seba_state.state après actualisation');

  console.log('\n== [8/9] Autre entité (employes) — mise à jour réelle ==');
  const r8 = await syncPush(token, 'device-1', [{ client_seq: 10, entity: 'employes', entity_id: empId, op: 'update', patch: { actif: false } }]);
  assert(r8.json.results?.[0]?.status === 'applied', 'update employe appliqué');
  state = freshState(account);
  const updatedEmp = state.employes.find((e) => e.id === empId);
  assert(updatedEmp && updatedEmp.actif === false && updatedEmp.nom === 'SyncPush QA', 'modification employe conservée après actualisation, fusion superficielle (' + JSON.stringify(updatedEmp) + ')');

  console.log('\n== [9/9] Autre entité (employes) — suppression réelle ==');
  const r9 = await syncPush(token, 'device-1', [{ client_seq: 11, entity: 'employes', entity_id: empId, op: 'delete', patch: {} }]);
  assert(r9.json.results?.[0]?.status === 'applied', 'delete employe appliqué');
  state = freshState(account);
  assert(!state.employes.some((e) => e.id === empId), 'employe réellement absent après actualisation');

  psql(`delete from seba_state where account = '${account}';
        delete from entity_versions where account = '${account}';
        delete from sync_operations where account = '${account}';
        delete from auth.users where email = '${email}';`);

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
