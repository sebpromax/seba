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
    await page.type('#email', freshEmail);
    await page.type('#password', freshPassword);
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
    await page.type('#ss-prenom', 'CycleReel');
    await page.type('#ss-nom', clientName);
    await page.evaluate(() => submitClient());
    await new Promise((r) => setTimeout(r, 1500)); // debounce sync (800ms) + aller-retour reseau local

    const stateAfterUiCreate = psqlJson(`select state from seba_state where account='${freshUserId}';`);
    const clientInDb = (stateAfterUiCreate.clients || []).find((c) => c.nom === clientName);
    assert(!!clientInDb, `client cree depuis l'interface reellement present dans seba_state.state (compte ${freshUserId}) (observe: ${JSON.stringify(clientInDb)})`);

    console.log('  -- Reload complet --');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 2000)); // laisse ready()/pull() rapatrier l'etat cloud
    const visibleAfterReload = await page.evaluate((name) => document.body.innerText.includes(name), clientName);
    assert(visibleAfterReload, `client toujours visible dans l'UI apres un reload complet (compte ${freshUserId})`);

    console.log('  -- Reconnexion (nouvelle session, localStorage vide) --');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.sebaAuth, { timeout: 10000 });
    await page.type('#email', freshEmail);
    await page.type('#password', freshPassword);
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
    await new Promise((r) => setTimeout(r, 2000));
    const visibleAfterReconnect = await page.evaluate((name) => document.body.innerText.includes(name), clientName);
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
