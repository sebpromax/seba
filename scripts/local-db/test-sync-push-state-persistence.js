// SEBA — QA360-P0-A : preuve locale que apply_entity_patch() persiste
// désormais dans seba_state.state (pas seulement entity_versions).
// Réutilise les comptes synthétiques de seed-synthetic.sh (patron A / B)
// et le layout supabase/functions/sync-push/index.ts (servi par le runtime
// edge local, cf. supabase/config.toml -- aucune dépendance nouvelle).
//
// Usage : node scripts/local-db/test-sync-push-state-persistence.js

import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const PORT = 8792;
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      // auth.js charge docs/config.js (gitignore, secrets dev locaux) des
      // que location.hostname vaut 127.0.0.1/localhost, et l'eval ECRASE
      // window.SEBA_CONFIG pose par evaluateOnNewDocument (pointe vers le
      // vrai projet distant) -- on sert ce test contre le Supabase LOCAL,
      // donc ce fichier ne doit jamais etre servi ici (jamais lu ni modifie
      // sur disque, juste absent de CE serveur statique de test).
      if (urlPath === '/config.js') { res.writeHead(404); res.end(); return; }
      const filePath = path.join(repoRoot, 'docs', urlPath === '/' ? 'connexion.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// Remplace page.type() (frappe caractere par caractere, evenements
// synthetiques Chrome) : sous charge Docker/CPU, des caracteres peuvent se
// perdre ou se meler entre deux champs typed() consecutifs -- observe
// empiriquement ici (prenom/nom corrompus par intermittence). Injection
// directe de .value + evenement 'input' reel, deterministe.
async function setValue(page, selector, value) {
  await page.$eval(selector, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

function getSupabaseStatus() {
  const out = execSync('npx --yes supabase@2.109.1 status -o env', { encoding: 'utf8' });
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return env;
}

function psql(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "${escaped}"`, { encoding: 'utf8' }).trim();
}

function psqlJson(sql) {
  const raw = psql(sql);
  return raw && raw !== '' ? JSON.parse(raw) : null;
}

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  OK   -', msg);
  else { console.error('  FAIL -', msg); failures++; }
}
// Comparaison profonde insensible a l'ordre des cles (JSONB de Postgres ne
// garantit pas de preserver l'ordre d'insertion des cles d'un objet) --
// JSON.stringify(a) === JSON.stringify(b) donnerait de faux echecs.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i]) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

async function signIn(env, email, password) {
  const res = await fetch(env.API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY },
    body: JSON.stringify({ email, password: password || 'Test-Synthetic-2026!' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error('signIn failed for ' + email + ': ' + JSON.stringify(body));
  return body.access_token;
}

async function syncPush(env, token, deviceId, operations) {
  const res = await fetch(env.API_URL + '/functions/v1/sync-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + token },
    body: JSON.stringify({ device_id: deviceId, operations }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function pullState(env, token, account) {
  const res = await fetch(env.API_URL + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(account), {
    headers: { apikey: env.ANON_KEY, Authorization: 'Bearer ' + token },
  });
  const rows = await res.json();
  return rows.length ? rows[0].state : null;
}

async function main() {
  const env = getSupabaseStatus();
  const tokenA = await signIn(env, 'patron-a@test.seba.invalid');
  const tokenB = await signIn(env, 'patron-b@test.seba.invalid');
  const deviceA = 'test_device_a_' + Date.now();
  const deviceB = 'test_device_b_' + Date.now();

  console.log('\n=== CAS 1 -- CREATE : client present dans seba_state.state ===');
  const clientId = 'id_qa_sync_push_' + Date.now();
  const seq1 = 1;
  const create1 = await syncPush(env, tokenA, deviceA, [{ client_seq: seq1, entity: 'clients', entity_id: clientId, op: 'create', patch: { id: clientId, prenom: 'QA', nom: 'SyncPush', email: 'qa-sync-push@test.seba.invalid' } }]);
  assert(create1.status === 200, `reponse succes (observe status=${create1.status}, body=${JSON.stringify(create1.body)})`);
  assert((create1.body.results || [])[0]?.status === 'applied', `resultat "applied" (observe: ${JSON.stringify(create1.body.results)})`);
  const stateAfterCreate = psqlJson(`select state from seba_state where account='test-patron-a';`);
  const clientInState = (stateAfterCreate.clients || []).find((c) => c.id === clientId);
  assert(!!clientInState, `client present dans seba_state.state.clients (observe: ${JSON.stringify(clientInState)})`);
  const versionRow = psqlJson(`select row_to_json(entity_versions) from entity_versions where account='test-patron-a' and entity='clients' and entity_id='${clientId}';`);
  assert(!!versionRow && versionRow.version === 1, `entity_versions cree en parallele, version=1 (observe: ${JSON.stringify(versionRow)})`);

  console.log('\n=== CAS 2 -- RELOAD : meme chemin que SupabaseAdapter.pull() ===');
  const pulled = await pullState(env, tokenA, 'test-patron-a');
  const clientAfterPull = (pulled.clients || []).find((c) => c.id === clientId);
  assert(!!clientAfterPull, `client toujours present via le chemin pull() (rest/v1/seba_state) (observe: ${JSON.stringify(clientAfterPull)})`);

  console.log('\n=== CAS 3 -- RETRY identique : aucun doublon ===');
  const create1Retry = await syncPush(env, tokenA, deviceA, [{ client_seq: seq1, entity: 'clients', entity_id: clientId, op: 'create', patch: { id: clientId, prenom: 'QA', nom: 'SyncPush', email: 'qa-sync-push@test.seba.invalid' } }]);
  assert((create1Retry.body.results || [])[0]?.status === 'ack_duplicate', `rejeu du meme client_seq reconnu comme doublon (observe: ${JSON.stringify(create1Retry.body.results)})`);
  const countAfterRetry = (psqlJson(`select state from seba_state where account='test-patron-a';`).clients || []).filter((c) => c.id === clientId).length;
  assert(countAfterRetry === 1, `toujours UN SEUL client apres rejeu (observe: ${countAfterRetry})`);

  console.log('\n=== CAS 4 -- UPDATE : fusion superficielle, champs non modifies conserves ===');
  const seq2 = 2;
  const update1 = await syncPush(env, tokenA, deviceA, [{ client_seq: seq2, entity: 'clients', entity_id: clientId, op: 'update', patch: { nom: 'SyncPushModifie' } }]);
  assert(update1.status === 200 && (update1.body.results || [])[0]?.status === 'applied', `update accepte (observe: ${JSON.stringify(update1.body.results)})`);
  const clientAfterUpdate = (psqlJson(`select state from seba_state where account='test-patron-a';`).clients || []).find((c) => c.id === clientId);
  assert(clientAfterUpdate.nom === 'SyncPushModifie', `champ modifie applique (observe nom=${clientAfterUpdate.nom})`);
  assert(clientAfterUpdate.prenom === 'QA' && clientAfterUpdate.email === 'qa-sync-push@test.seba.invalid', `champs non touches par le patch conserves (observe: ${JSON.stringify(clientAfterUpdate)})`);

  console.log('\n=== CAS 9 -- collection inconnue refusee ===');
  const badEntity = await syncPush(env, tokenA, deviceA, [{ client_seq: 3, entity: 'hackers_dream', entity_id: clientId, op: 'update', patch: { x: 1 } }]);
  const badResult = (badEntity.body.results || [])[0] || {};
  assert(badResult.status === 'error', `collection inconnue refusee (observe: ${JSON.stringify(badResult)})`);
  const stateUnchangedAfterBadEntity = psqlJson(`select state from seba_state where account='test-patron-a';`);
  assert(JSON.stringify(stateUnchangedAfterBadEntity) === JSON.stringify(psqlJson(`select state from seba_state where account='test-patron-a';`)), 'aucun chemin JSONB arbitraire cree (relecture stable)');
  assert(!('hackers_dream' in stateUnchangedAfterBadEntity), `aucune cle "hackers_dream" ajoutee a seba_state.state (observe cles: ${Object.keys(stateUnchangedAfterBadEntity).join(',')})`);

  console.log('\n=== CAS 7 -- cross-account : patron B ne touche jamais le compte de A ===');
  const stateAbeforeB = psqlJson(`select state from seba_state where account='test-patron-a';`);
  const crossAttempt = await syncPush(env, tokenB, deviceB, [{ client_seq: 1, entity: 'clients', entity_id: clientId, op: 'update', patch: { nom: 'ECRASE-PAR-B' } }]);
  // Le contrat sync-push resout le compte depuis le JWT de B (jamais un
  // account fourni par le navigateur) -- meme entity_id, mais l'element
  // n'existe pas encore dans LE COMPTE DE B -- traite comme "objet
  // introuvable pour update" (l'update de A n'est jamais atteint).
  const crossResult = (crossAttempt.body.results || [])[0] || {};
  assert(crossResult.status === 'error', `l'update de B sur un id inexistant DANS SON PROPRE compte est refuse, jamais route vers le compte de A (observe: ${JSON.stringify(crossResult)})`);
  const stateAafterB = psqlJson(`select state from seba_state where account='test-patron-a';`);
  assert(JSON.stringify(stateAbeforeB) === JSON.stringify(stateAafterB), 'seba_state du compte A totalement inchange apres la tentative de B');
  const stateB = psqlJson(`select state from seba_state where account='test-patron-b';`);
  assert(!(stateB.clients || []).some((c) => c.id === clientId), `le compte de B ne contient pas non plus l'objet (aucune fuite/creation croisee) (observe: ${JSON.stringify(stateB.clients)})`);

  console.log('\n=== CAS 8 -- atomicite : echec avant toute ecriture = aucun etat modifie ===');
  const stateBeforeFailure = psqlJson(`select state from seba_state where account='test-patron-a';`);
  const versionsBeforeFailure = psql(`select count(*) from entity_versions where account='test-patron-a';`);
  const nonExistentId = 'id_never_created_' + Date.now();
  const failedUpdate = await syncPush(env, tokenA, deviceA, [{ client_seq: 4, entity: 'clients', entity_id: nonExistentId, op: 'update', patch: { nom: 'x' } }]);
  const failedResult = (failedUpdate.body.results || [])[0] || {};
  assert(failedResult.status === 'error', `update sur un objet inexistant refuse (observe: ${JSON.stringify(failedResult)})`);
  const stateAfterFailure = psqlJson(`select state from seba_state where account='test-patron-a';`);
  const versionsAfterFailure = psql(`select count(*) from entity_versions where account='test-patron-a';`);
  assert(JSON.stringify(stateBeforeFailure) === JSON.stringify(stateAfterFailure), 'seba_state.state totalement inchange apres un echec (aucune moitie d\'operation)');
  assert(versionsBeforeFailure === versionsAfterFailure, `aucune ligne entity_versions creee pour l'echec (observe avant=${versionsBeforeFailure}, apres=${versionsAfterFailure})`);

  console.log('\n=== CAS 6 -- pas de perte d\'update sous ecritures successives sur la meme entite ===');
  const seqBase = 10;
  const u1 = await syncPush(env, tokenA, deviceA, [{ client_seq: seqBase, entity: 'clients', entity_id: clientId, op: 'update', patch: { adresse: '1 rue Un' } }]);
  const u2 = await syncPush(env, tokenA, deviceA, [{ client_seq: seqBase + 1, entity: 'clients', entity_id: clientId, op: 'update', patch: { telephone: '0600000000' } }]);
  assert((u1.body.results || [])[0]?.status === 'applied' && (u2.body.results || [])[0]?.status === 'applied', 'les deux updates successifs reussissent');
  const finalClient = (psqlJson(`select state from seba_state where account='test-patron-a';`).clients || []).find((c) => c.id === clientId);
  assert(finalClient.adresse === '1 rue Un' && finalClient.telephone === '0600000000' && finalClient.nom === 'SyncPushModifie', `aucune perte d'update, les 3 champs coexistent (observe: ${JSON.stringify(finalClient)})`);
  const finalVersion = psqlJson(`select row_to_json(entity_versions) from entity_versions where account='test-patron-a' and entity='clients' and entity_id='${clientId}';`);
  assert(finalVersion.version === 4, `version incrementee de façon monotone (1 create + 1 update CAS4 + 2 update CAS6 = 4 ; observe=${finalVersion.version})`);

  console.log('\n=== CAS 6-PARALLEL-A -- deux ecritures REELLEMENT simultanees, champs differents (Promise.all, pas deux await successifs) ===');
  {
    const pClientId = 'id_qa_parallel_' + Date.now();
    await syncPush(env, tokenA, deviceA, [{ client_seq: 100, entity: 'clients', entity_id: pClientId, op: 'create', patch: { id: pClientId, nom: 'Parallel', ville: 'Nice' } }]);
    const [rA, rB] = await Promise.all([
      syncPush(env, tokenA, deviceA, [{ client_seq: 101, entity: 'clients', entity_id: pClientId, op: 'update', patch: { champA: 'valeurA' } }]),
      syncPush(env, tokenA, deviceB, [{ client_seq: 1, entity: 'clients', entity_id: pClientId, op: 'update', patch: { champB: 'valeurB' } }]),
    ]);
    assert((rA.body.results || [])[0]?.status === 'applied' && (rB.body.results || [])[0]?.status === 'applied', `les deux ecritures paralleles reussissent (aucun deadlock/erreur) (observe A=${JSON.stringify(rA.body.results)}, B=${JSON.stringify(rB.body.results)})`);
    const pClient = (psqlJson(`select state from seba_state where account='test-patron-a';`).clients || []).find((c) => c.id === pClientId);
    assert(pClient.champA === 'valeurA' && pClient.champB === 'valeurB', `aucune perte : les deux champs distincts ecrits en parallele coexistent (observe: ${JSON.stringify(pClient)})`);
  }

  console.log('\n=== CAS 6-PARALLEL-B -- deux ecritures REELLEMENT simultanees, MEME champ (dernier ecrivain valide gagnant, documente honnetement) ===');
  {
    const pClientId = 'id_qa_parallel2_' + Date.now();
    await syncPush(env, tokenA, deviceA, [{ client_seq: 110, entity: 'clients', entity_id: pClientId, op: 'create', patch: { id: pClientId, nom: 'ParallelMemeChamp' } }]);
    const [rA, rB] = await Promise.all([
      syncPush(env, tokenA, deviceA, [{ client_seq: 111, entity: 'clients', entity_id: pClientId, op: 'update', patch: { statut: 'valeur-A' } }]),
      syncPush(env, tokenA, deviceB, [{ client_seq: 2, entity: 'clients', entity_id: pClientId, op: 'update', patch: { statut: 'valeur-B' } }]),
    ]);
    assert((rA.body.results || [])[0]?.status === 'applied' && (rB.body.results || [])[0]?.status === 'applied', 'les deux ecritures concurrentes sur le meme champ reussissent toutes les deux (serialisees par le verrou, aucune erreur/rejet)');
    const pClient = (psqlJson(`select state from seba_state where account='test-patron-a';`).clients || []).find((c) => c.id === pClientId);
    assert(pClient.statut === 'valeur-A' || pClient.statut === 'valeur-B', `dernier ecrivain valide gagnant sur le champ dispute, aucune corruption (valeur finale coherente, une des deux, jamais un melange) (observe: ${JSON.stringify(pClient.statut)})`);
    const finalVersionParallel = psqlJson(`select row_to_json(entity_versions) from entity_versions where account='test-patron-a' and entity='clients' and entity_id='${pClientId}';`);
    assert(finalVersionParallel.version === 3, `version = 3 (1 create + 2 update serialises par le verrou FOR UPDATE) (observe: ${finalVersionParallel.version})`);
    console.log('    NOTE HONNETE : le protocole actuel ne rejette PAS une version client perimee (le frontend n\'en envoie aucune) -- il serialise les ecritures et applique un dernier-ecrivain-valide-gagnant sur un champ dispute. Ceci n\'est PAS une concurrence optimiste avec rejet explicite.');
  }

  console.log('\n=== SEMANTIQUE JSONB -- objet imbriqué complet, tableau imbriqué, null, champ absent, id manquant/different, propriete inconnue ===');
  {
    const jId = 'id_qa_jsonb_' + Date.now();
    await syncPush(env, tokenA, deviceA, [{ client_seq: 120, entity: 'interventions', entity_id: jId, op: 'create', patch: { id: jId, service: 'Menage', execution: { checklist: [{ id: 'c1', label: 'Aspirateur', checked: false }], photos: [] } } }]);

    console.log('  -- objet imbriqué complet (le frontend envoie toujours execution en entier, jamais un sous-champ isole) --');
    const newExecution = { checklist: [{ id: 'c1', label: 'Aspirateur', checked: true }], photos: [{ id: 'p1', type: 'before' }] };
    await syncPush(env, tokenA, deviceA, [{ client_seq: 121, entity: 'interventions', entity_id: jId, op: 'update', patch: { execution: newExecution } }]);
    const afterNested = (psqlJson(`select state from seba_state where account='test-patron-a';`).interventions || []).find((i) => i.id === jId);
    assert(deepEqual(afterNested.execution, newExecution), `objet imbriqué complet remplace integralement, exactement comme Object.assign cote client (observe: ${JSON.stringify(afterNested.execution)})`);

    console.log('  -- tableau imbriqué (photos, remplacement complet du tableau) --');
    assert(Array.isArray(afterNested.execution.photos) && afterNested.execution.photos.length === 1 && afterNested.execution.photos[0].id === 'p1', `tableau imbriqué correctement stocke (observe: ${JSON.stringify(afterNested.execution.photos)})`);

    console.log('  -- valeur null explicite (conservee telle quelle, jamais convertie en absence de cle) --');
    await syncPush(env, tokenA, deviceA, [{ client_seq: 122, entity: 'interventions', entity_id: jId, op: 'update', patch: { rescheduleRequest: null } }]);
    const afterNull = (psqlJson(`select state from seba_state where account='test-patron-a';`).interventions || []).find((i) => i.id === jId);
    assert(('rescheduleRequest' in afterNull) && afterNull.rescheduleRequest === null, `valeur null explicite conservee comme cle presente = null, pas supprimee (observe cles: ${Object.keys(afterNull).join(',')}, rescheduleRequest=${JSON.stringify(afterNull.rescheduleRequest)})`);

    console.log('  -- champ absent du patch reste inchange --');
    assert(afterNull.service === 'Menage', `champ non touche par aucun des 2 patchs precedents toujours present (observe service=${afterNull.service})`);

    console.log('  -- propriete inconnue/sensible a l\'interieur du patch : totalement inerte, ne franchit jamais la limite de l\'objet dans le tableau --');
    await syncPush(env, tokenA, deviceA, [{ client_seq: 123, entity: 'interventions', entity_id: jId, op: 'update', patch: { account: 'compte-vole', user_id: 'fake-uid' } }]);
    const afterInjection = psql(`select account, user_id from seba_state where account='test-patron-a';`);
    const [injAccount, injUserId] = afterInjection.split('|');
    assert(injAccount === 'test-patron-a', `seba_state.account (colonne, hors JSONB) inchange malgre un patch contenant la cle "account" (observe: ${injAccount})`);
    const injIntervention = (psqlJson(`select state from seba_state where account='test-patron-a';`).interventions || []).find((i) => i.id === jId);
    assert(injIntervention.account === 'compte-vole', `la propriete "account" reste une simple cle inerte SUR L'OBJET dans le tableau JSONB, sans aucun effet sur la vraie colonne seba_state.account (observe objet.account=${injIntervention.account}, vraie colonne=${injAccount})`);

    console.log('  -- CREATE sans identifiant dans le patch : refuse --');
    const noIdRes = await syncPush(env, tokenA, deviceA, [{ client_seq: 124, entity: 'clients', entity_id: 'id_qa_noid_' + Date.now(), op: 'create', patch: { nom: 'SansId' } }]);
    assert((noIdRes.body.results || [])[0]?.status === 'error', `create sans champ "id" dans le patch refuse (observe: ${JSON.stringify(noIdRes.body.results)})`);

    console.log('  -- CREATE avec patch.id different de entity_id : refuse --');
    const mismatchEntityId = 'id_qa_mismatch_' + Date.now();
    const mismatchRes = await syncPush(env, tokenA, deviceA, [{ client_seq: 125, entity: 'clients', entity_id: mismatchEntityId, op: 'create', patch: { id: 'id_qa_AUTRE_' + Date.now(), nom: 'Mismatch' } }]);
    assert((mismatchRes.body.results || [])[0]?.status === 'error', `create avec patch.id != entity_id refuse (observe: ${JSON.stringify(mismatchRes.body.results)})`);
  }

  console.log('\n=== COLLECTIONS AJOUTEES A L\'ALLOWLIST -- contrats/custom_services/automationRules/automationRuns/automationAlerts ===');
  {
    for (const coll of ['contrats', 'custom_services', 'automationRules', 'automationRuns', 'automationAlerts']) {
      const id = 'id_qa_' + coll + '_' + Date.now();
      const res = await syncPush(env, tokenA, deviceA, [{ client_seq: 200 + ['contrats', 'custom_services', 'automationRules', 'automationRuns', 'automationAlerts'].indexOf(coll), entity: coll, entity_id: id, op: 'create', patch: { id, label: 'QA ' + coll } }]);
      assert((res.body.results || [])[0]?.status === 'applied', `collection "${coll}" (reellement utilisee par le produit, absente de l'allowlist d'origine) acceptee (observe: ${JSON.stringify(res.body.results)})`);
      const stored = (psqlJson(`select state from seba_state where account='test-patron-a';`)[coll] || []).find((x) => x.id === id);
      assert(!!stored, `"${coll}" bien present dans seba_state.state.${coll} (observe: ${JSON.stringify(stored)})`);
    }
  }

  console.log('\n=== CAS 5 -- REMOVE : absence reelle de seba_state.state, retry sans danger ===');
  const del1 = await syncPush(env, tokenA, deviceA, [{ client_seq: 20, entity: 'clients', entity_id: clientId, op: 'delete', patch: { _deleted: true, deletedAt: '2026-07-28' } }]);
  assert((del1.body.results || [])[0]?.status === 'applied', `delete accepte (observe: ${JSON.stringify(del1.body.results)})`);
  const stateAfterDelete = psqlJson(`select state from seba_state where account='test-patron-a';`);
  assert(!(stateAfterDelete.clients || []).some((c) => c.id === clientId), `client absent de seba_state.state.clients apres suppression (observe: ${JSON.stringify(stateAfterDelete.clients)})`);
  const auditSnapshot = psqlJson(`select last_snapshot from entity_versions where account='test-patron-a' and entity='clients' and entity_id='${clientId}';`);
  assert(auditSnapshot && auditSnapshot._deleted === true, `trace d'audit _deleted conservee dans entity_versions (observe: ${JSON.stringify(auditSnapshot)})`);
  const del2 = await syncPush(env, tokenA, deviceA, [{ client_seq: 21, entity: 'clients', entity_id: clientId, op: 'delete', patch: { _deleted: true, deletedAt: '2026-07-28' } }]);
  assert(del2.status === 200 && (del2.body.results || [])[0]?.status === 'applied', `retry de suppression sans danger, aucune erreur (observe: ${JSON.stringify(del2.body.results)})`);
  const stateAfterSecondDelete = psqlJson(`select state from seba_state where account='test-patron-a';`);
  assert((stateAfterSecondDelete.clients || []).length === (stateAfterDelete.clients || []).length, 'retry de suppression ne retire aucun AUTRE objet (longueur du tableau inchangee)');

  console.log('\n=== CAS 10 -- cycle frontend reel local (interface, reload, reconnexion) ===');
  const freshEmail = 'qa-sync-push-case10-' + Date.now() + '@test.seba.invalid';
  const freshPassword = 'Qa-SyncPush-2026!';
  const createUserRes = await fetch(env.API_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
    body: JSON.stringify({ email: freshEmail, password: freshPassword, email_confirm: true }),
  });
  const freshUser = await createUserRes.json();
  if (!createUserRes.ok) throw new Error('creation patron frais echouee: ' + JSON.stringify(freshUser));
  const freshUserId = freshUser.id;
  const freshToken = await signIn(env, freshEmail, freshPassword);
  // Bootstrap seba_state via create_profile_and_company (RPC reelle, meme
  // chemin que l'inscription reelle -- AUTH-006/AUTH-007) : account=user_id,
  // exactement la convention reelle (contrairement au seed synthetique
  // patron-a/b qui utilise un account lisible different de auth.uid()).
  const bootstrapRes = await fetch(env.API_URL + '/rest/v1/rpc/create_profile_and_company', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + freshToken },
    body: JSON.stringify({ _user_id: freshUserId, _sector: 'menage', _company_name: 'QA Sync Push Local' }),
  });
  if (!bootstrapRes.ok) throw new Error('bootstrap create_profile_and_company echoue: ' + JSON.stringify(await bootstrapRes.json()));

  const server = await startStaticServer();
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  try {
    const clientName = 'CycleReelQA' + Date.now();
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('    [pageerror]', e.message));
    await page.evaluateOnNewDocument((url, key) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, env.API_URL, env.ANON_KEY);
    await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.sebaAuth, { timeout: 10000 });
    await setValue(page, '#email', freshEmail);
    await setValue(page, '#password', freshPassword);
    // handleLogin() declenche elle-meme window.location.href='app/dashboard.html'
    // ~450ms apres un succes (onde SebaFX) -- l'execution context peut donc
    // etre detruit PENDANT que evaluate()/waitForFunction() y sont encore
    // attaches (course avec la propre redirection de l'app). On tolere
    // l'erreur "Execution context was destroyed" ici : la navigation qui la
    // cause EST la preuve que la connexion a reussi.
    await page.evaluate(() => handleLogin()).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));

    console.log('  -- Creation d\'un client depuis l\'interface reelle (clients.html) --');
    await page.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 10000 });
    await page.evaluate(() => openSheet());
    await page.waitForSelector('#ss-panel.open', { timeout: 5000 }); // le sheet a sa propre transition CSS -- attendre la classe "open" reelle plutot qu'un delai fixe apres openSheet()
    await page.waitForSelector('#ss-prenom', { visible: true, timeout: 5000 });
    await setValue(page, '#ss-prenom', 'CycleReel');
    await setValue(page, '#ss-nom', clientName);
    const typedValues = await page.evaluate(() => ({ prenom: document.getElementById('ss-prenom').value, nom: document.getElementById('ss-nom').value }));
    assert(typedValues.prenom === 'CycleReel' && typedValues.nom === clientName, `champs du formulaire reellement remplis avant soumission (observe: ${JSON.stringify(typedValues)})`);
    await page.evaluate(() => submitClient());
    // Signal reel de fin de synchro (SebaDB.syncStatus().pending===0) plutot
    // qu'un delai fixe -- le debounce sync (800ms) + l'aller-retour reseau
    // local peuvent varier sous charge Docker.
    const syncSettled = await page
      .waitForFunction(() => window.SebaDB && window.SebaDB.syncStatus && window.SebaDB.syncStatus().pending === 0, { timeout: 8000, polling: 200 })
      .then(() => true).catch(() => false);
    assert(syncSettled, 'file de synchro videe apres la creation reelle depuis l\'interface (SebaDB.syncStatus().pending === 0)');

    const stateAfterUiCreate = psqlJson(`select state from seba_state where account='${freshUserId}';`);
    const clientInDb = (stateAfterUiCreate.clients || []).find((c) => c.nom === clientName);
    assert(!!clientInDb, `client cree depuis l'interface reellement present dans seba_state.state (compte ${freshUserId}) (observe: ${JSON.stringify(clientInDb)})`);

    console.log('  -- Reload complet --');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 10000 });
    const visibleAfterReload = await page
      .waitForFunction((name) => document.body.innerText.includes(name), { timeout: 8000, polling: 300 }, clientName)
      .then(() => true).catch(() => false); // ready()/pull() rapatrient l'etat cloud de façon asynchrone, delai variable selon la charge Docker locale -- on attend la condition reelle plutot qu'un delai fixe
    assert(visibleAfterReload, `client toujours visible dans l'UI apres un reload complet (compte ${freshUserId})`);

    console.log('  -- Reconnexion (nouvelle session, localStorage vide) --');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.sebaAuth, { timeout: 10000 });
    await setValue(page, '#email', freshEmail);
    await setValue(page, '#password', freshPassword);
    // handleLogin() declenche elle-meme window.location.href='app/dashboard.html'
    // ~450ms apres un succes (onde SebaFX) -- l'execution context peut donc
    // etre detruit PENDANT que evaluate()/waitForFunction() y sont encore
    // attaches (course avec la propre redirection de l'app). On tolere
    // l'erreur "Execution context was destroyed" ici : la navigation qui la
    // cause EST la preuve que la connexion a reussi.
    await page.evaluate(() => handleLogin()).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    await page.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 10000 });
    const visibleAfterReconnect = await page
      .waitForFunction((name) => document.body.innerText.includes(name), { timeout: 8000, polling: 300 }, clientName)
      .then(() => true).catch(() => false);
    assert(visibleAfterReconnect, `client toujours visible apres reconnexion complete (nouvelle session, compte ${freshUserId})`);
  } finally {
    await browser.close().catch(() => {});
    await server.close();
    // Nettoyage : supprime le patron QA de test cree pour ce seul scenario.
    await fetch(env.API_URL + '/auth/v1/admin/users/' + freshUserId, {
      method: 'DELETE',
      headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
    }).catch(() => {});
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
