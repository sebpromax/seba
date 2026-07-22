// SEBA — Harnais de reproduction/validation T3 (synchronisation).
// Réutilise puppeteer-core (déjà présent, voir package.json) — aucune
// nouvelle dépendance. Sert le dépôt sur un mini serveur HTTP local (Node
// natif, pas de nouvelle dépendance) pour que docs/seba-data.js et
// docs/auth.js se chargent normalement (pas de file://, évite tout souci
// CORS avec l'instance Supabase locale).
//
// Ce script teste le comportement CORRIGE (etat courant du depot). La preuve
// "avant correction" (bug reproduit) a ete capturee separement -- voir
// T3_FIX_REPORT.md pour la sortie brute des runs avant/apres.
//
// Usage : node scripts/local-db/test-t3-sync-harness.js

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const PORT = 8791; // origine deja presente dans ALLOWED_ORIGINS de sync-push.ts (localhost:8791) -- necessaire pour le Scenario F (appel reel, sans mock, donc vraies verifications CORS)
const HOST = 'localhost'; // 'localhost' precisement (pas 127.0.0.1) : ALLOWED_ORIGINS compare la chaine d'origine exacte
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function getSupabaseStatus() {
  const out = execSync('npx --yes supabase@2.109.1 status -o env', { encoding: 'utf8', cwd: repoRoot });
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return env;
}

function psql(sql) {
  return execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(repoRoot, urlPath);
      if (!filePath.startsWith(repoRoot)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end('not found: ' + req.url);
    }
  });
  return new Promise((resolve) => server.listen(PORT, HOST, () => resolve(server)));
}

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  OK   -', msg);
  } else {
    console.error('  FAIL -', msg);
    failures++;
  }
}

async function withPage(fn) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    await fn(page, browser);
  } finally {
    try {
      await browser.close();
    } catch (e) {
      // Nettoyage du profil Chrome temporaire (verrou de fichier Windows
      // transitoire, ex. EBUSY sur first_party_sets.db-journal) : sans
      // rapport avec le comportement teste, ne doit pas faire echouer la
      // suite.
      console.warn('  [warn] browser.close() : ' + e.message);
    }
  }
}

async function loadHarnessAndSignIn(page, { supabaseUrl, anonKey }) {
  await page.evaluateOnNewDocument((url, key) => {
    window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'demo' };
  }, supabaseUrl, anonKey);
  await page.goto(`http://${HOST}:${PORT}/scripts/local-db/t3-harness.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__t3, { timeout: 10000 });
  const signIn = await page.evaluate(async () => window.__t3.signIn('patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
  if (!signIn.ok) throw new Error('signIn a echoue: ' + JSON.stringify(signIn));
  await new Promise((r) => setTimeout(r, 300)); // laisse le SDK persister le token dans localStorage
}

/* Installe l'interception réseau pour les requêtes sync-push. `mode` :
   'fail500' | 'reject' | 'partial207' | 'success' -- mutable en cours de test
   via netState.mode pour simuler une reprise de service. */
function installInterception(page, state) {
  state.count = 0;
  state.timestamps = [];
  page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/sync-push')) {
      if (req.method() === 'OPTIONS') {
        // Préflight CORS (headers non-simples : apikey/Authorization) -- à
        // répondre correctement, sinon la vraie requête POST n'est jamais
        // envoyée et fetch() rejette (masquerait le vrai scénario testé).
        req.respond({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-employee-token',
          },
        });
        return;
      }
      state.count++;
      state.timestamps.push(Date.now());
      const mode = state.mode;
      if (mode === 'reject') {
        req.abort('failed');
      } else if (mode === 'fail500') {
        req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated failure' }), headers: { 'Access-Control-Allow-Origin': '*' } });
      } else if (mode === 'partial207') {
        const body = JSON.parse(req.postData() || '{}');
        const results = (body.operations || []).map((o, i) => ({ client_seq: o.client_seq, status: i === 0 ? 'error' : 'applied', error: i === 0 ? 'simulated partial error' : undefined }));
        req.respond({ status: 207, contentType: 'application/json', body: JSON.stringify({ results }), headers: { 'Access-Control-Allow-Origin': '*' } });
      } else {
        const body = JSON.parse(req.postData() || '{}');
        const results = (body.operations || []).map((o) => ({ client_seq: o.client_seq, status: 'applied' }));
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }), headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    } else {
      req.continue();
    }
  });
}

async function main() {
  const env = getSupabaseStatus();
  const server = await startStaticServer();
  console.log(`Serveur statique local : http://${HOST}:${PORT}  (repo root)`);
  console.log(`Instance Supabase locale : ${env.API_URL}`);

  console.log('\n=== Scenario A : HTTP 500 persistant puis reprise de service ===');
  await withPage(async (page) => {
    const netState = { mode: 'fail500' };
    installInterception(page, netState);
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });

    await page.evaluate(() => window.__t3.createDevis('T3-A-1'));
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === 1, `1re requete envoyee apres l'ecriture (observe: ${netState.count})`);

    const indicatorAfterFirstFailure = await page.evaluate(() => ({ visible: window.__t3.isIndicatorVisible(), text: window.__t3.indicatorText() }));
    assert(indicatorAfterFirstFailure.visible === true, `indicateur visible apres le 1er echec (texte observe: "${indicatorAfterFirstFailure.text}")`);
    assert(/1 modification en attente/.test(indicatorAfterFirstFailure.text || ''), `texte de l'indicateur correct (observe: "${indicatorAfterFirstFailure.text}")`);

    console.log('  Attente du 1er reessai automatique (backoff #1 ≈ 2s)...');
    await new Promise((r) => setTimeout(r, 2600));
    assert(netState.count >= 2, `AUTO-RETRY apres echec HTTP 500 (observe: ${netState.count} requete(s))`);
    const gap1 = netState.timestamps[1] - netState.timestamps[0];
    assert(gap1 >= 1500, `le 1er reessai respecte un delai progressif, pas une boucle serree (observe: ${gap1}ms entre tentative 1 et 2)`);

    console.log('  Attente du 2e reessai automatique (backoff #2 ≈ 5s, doit etre PLUS LONG que le 1er)...');
    await new Promise((r) => setTimeout(r, 5600));
    assert(netState.count >= 3, `2e reessai automatique observe (observe: ${netState.count} requete(s) au total)`);
    const gap2 = netState.timestamps[2] - netState.timestamps[1];
    assert(gap2 > gap1, `le delai progresse (backoff croissant) : gap1=${gap1}ms puis gap2=${gap2}ms`);

    console.log('  Simulation d\'une reprise de service (mode -> success), attente de la resorption de la file...');
    netState.mode = 'success';
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 20000, polling: 300 });
    assert(true, 'la file se vide automatiquement des que le service redevient disponible (sans action manuelle)');
    const indicatorAfterRecovery = await page.evaluate(() => window.__t3.isIndicatorVisible());
    assert(indicatorAfterRecovery === false, `indicateur masque une fois la file vide (observe visible=${indicatorAfterRecovery})`);

    console.log('  Nouvel echec APRES une reprise reussie : le backoff doit repartir de zero (pas de 30s/60s residuel)...');
    netState.mode = 'fail500';
    const countBeforeSecondFailure = netState.count;
    await page.evaluate(() => window.__t3.createDevis('T3-A-2'));
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === countBeforeSecondFailure + 1, `nouvelle ecriture envoyee normalement (observe: ${netState.count})`);
    const tsFirstOfSecondFailure = netState.timestamps[netState.timestamps.length - 1];
    await new Promise((r) => setTimeout(r, 2600));
    assert(netState.count === countBeforeSecondFailure + 2, `reessai rapide (~2s, backoff reinitialise) apres le nouvel echec (observe: ${netState.count})`);
    const gapAfterReset = netState.timestamps[netState.timestamps.length - 1] - tsFirstOfSecondFailure;
    assert(gapAfterReset < 4000, `le delai de reessai est bien reinitialise a la valeur la plus courte, pas celle ou l'on s'etait arrete (observe: ${gapAfterReset}ms)`);

    netState.mode = 'success';
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 20000, polling: 300 });
  });

  console.log('\n=== Scenario B : rejet reseau (fetch throw) -- auto-retry + reprise ===');
  await withPage(async (page) => {
    const netState = { mode: 'reject' };
    installInterception(page, netState);
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    await page.evaluate(() => window.__t3.createDevis('T3-B-1'));
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === 1, `1re requete tentee (rejet reseau) (observe: ${netState.count})`);

    await new Promise((r) => setTimeout(r, 2600));
    assert(netState.count >= 2, `AUTO-RETRY apres rejet reseau (observe: ${netState.count} requete(s))`);

    netState.mode = 'success';
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 20000, polling: 300 });
    assert(true, 'la file se resorbe des que le reseau redevient disponible');
  });

  console.log('\n=== Scenario B2 : retour 207 partiel (mix applied/error dans un meme lot) ===');
  await withPage(async (page) => {
    const netState = { mode: 'partial207' }; // mock : la 1re operation du lot est toujours 'error', les suivantes 'applied' (voir installInterception)
    installInterception(page, netState);
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    await page.evaluate(() => { window.__t3.createDevis('T3-B2-1'); window.__t3.createDevis('T3-B2-2'); });
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === 1, `1 lot envoye (2 operations) (observe: ${netState.count} requete(s))`);
    let pending = await page.evaluate(() => window.__t3.getPendingCount());
    assert(pending === 1, `l'operation en erreur (1re du lot) reste seule en file, l'autre est acquittee (observe pending=${pending})`);

    await new Promise((r) => setTimeout(r, 2600));
    assert(netState.count >= 2, `AUTO-RETRY (avec backoff) de l'operation en erreur du 207 partiel (observe: ${netState.count} requete(s))`);
    const gap = netState.timestamps[1] - netState.timestamps[0];
    assert(gap >= 1500, `pas de boucle serree sur ce chemin non plus (observe: ${gap}ms entre les deux tentatives)`);

    netState.mode = 'success';
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 20000, polling: 300 });
    assert(true, 'la file se resorbe entierement une fois le service retabli');
  });

  console.log('\n=== Scenario C : flush au chargement de page (file non vide restauree apres reload) ===');
  await withPage(async (page) => {
    const netState = { mode: 'fail500' };
    installInterception(page, netState);
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    await page.evaluate(() => window.__t3.createDevis('T3-C-1'));
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === 1, `1re requete envoyee avant rechargement (observe: ${netState.count})`);
    const pendingBeforeReload = await page.evaluate(() => window.__t3.getPendingCount());
    assert(pendingBeforeReload === 1, `operation toujours en file avant rechargement (observe: ${pendingBeforeReload})`);

    console.log('  Rechargement de la page (nouveau contexte JS, meme localStorage)...');
    const countBeforeReload = netState.count;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__t3, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count > countBeforeReload, `FLUSH AU CHARGEMENT : une tentative est envoyee des le chargement, sans attendre une nouvelle ecriture ou l'evenement online (observe: +${netState.count - countBeforeReload})`);

    netState.mode = 'success';
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 20000, polling: 300 });
  });

  console.log('\n=== Scenario D : evenement online -- reprise immediate ===');
  await withPage(async (page) => {
    const netState = { mode: 'reject' };
    installInterception(page, netState);
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    await page.evaluate(() => window.__t3.createDevis('T3-D-1'));
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count === 1, `1re requete tentee (observe: ${netState.count})`);

    netState.mode = 'success';
    const countBeforeOnline = netState.count;
    await page.setOfflineMode(true);
    await new Promise((r) => setTimeout(r, 300));
    await page.setOfflineMode(false);
    await new Promise((r) => setTimeout(r, 1200));
    assert(netState.count > countBeforeOnline, `l'evenement 'online' declenche une reprise immediate, sans attendre la fin du backoff en cours (observe: +${netState.count - countBeforeOnline})`);
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0, { timeout: 10000, polling: 300 });
  });

  console.log('\n=== Scenario E : echec definitif (MAX_OP_ATTEMPTS) -- jamais de perte silencieuse ===');
  await withPage(async (page) => {
    const netState = { mode: 'partial207AlwaysError' };
    // Reponse 207 ou l'unique operation est TOUJOURS en erreur : verifie que
    // l'operation finit par etre deplacee vers seba_failed_ops (visible,
    // recuperable) plutot que supprimee silencieusement.
    page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/sync-push')) {
        if (req.method() === 'OPTIONS') {
          req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-employee-token' } });
          return;
        }
        netState.count = (netState.count || 0) + 1;
        const body = JSON.parse(req.postData() || '{}');
        const results = (body.operations || []).map((o) => ({ client_seq: o.client_seq, status: 'error', error: 'always fails' }));
        req.respond({ status: 207, contentType: 'application/json', body: JSON.stringify({ results }), headers: { 'Access-Control-Allow-Origin': '*' } });
      } else {
        req.continue();
      }
    });
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    await page.evaluate(() => window.__t3.createDevis('T3-E-1'));

    console.log('  Attente du basculement vers seba_failed_ops (6 echecs necessaires, backoff croissant 2s/5s/15s/30s/60s -- jusqu\'a ~115s)...');
    await page.waitForFunction(() => window.__t3.getFailedCount() === 1, { timeout: 130000, polling: 500 });
    const pendingAfterAbandon = await page.evaluate(() => window.__t3.getPendingCount());
    assert(pendingAfterAbandon === 0, `l'operation ne reste plus dans la file active apres abandon (observe pending=${pendingAfterAbandon})`);
    const failedQueue = await page.evaluate(() => window.__t3.getFailedQueue());
    assert(failedQueue.length === 1 && failedQueue[0].entity === 'devis', `PAS DE PERTE SILENCIEUSE : l'operation est conservee dans seba_failed_ops, visible et identifiable (observe: ${JSON.stringify(failedQueue)})`);
    const indicatorText = await page.evaluate(() => window.__t3.indicatorText());
    assert(/echec d.finitif/i.test(indicatorText || ''), `l'indicateur signale l'echec definitif a l'utilisateur (observe: "${indicatorText}")`);

    console.log('  Reessai manuel (bouton "Réessayer") avec un backend qui fonctionne de nouveau...');
    let mode2 = { ok: false };
    page.removeAllListeners('request');
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/sync-push')) {
        if (req.method() === 'OPTIONS') {
          req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-employee-token' } });
          return;
        }
        const body = JSON.parse(req.postData() || '{}');
        const results = (body.operations || []).map((o) => ({ client_seq: o.client_seq, status: 'applied' }));
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }), headers: { 'Access-Control-Allow-Origin': '*' } });
      } else {
        req.continue();
      }
    });
    await page.evaluate(() => window.__t3.retrySyncNow());
    await page.waitForFunction(() => window.__t3.getPendingCount() === 0 && window.__t3.getFailedCount() === 0, { timeout: 10000, polling: 300 });
    assert(true, 'le reessai manuel replace l\'operation echouee dans la file et la fait aboutir des que le backend fonctionne');
    const indicatorHidden = await page.evaluate(() => window.__t3.isIndicatorVisible());
    assert(indicatorHidden === false, `indicateur masque une fois tout resorbe (observe visible=${indicatorHidden})`);
  });

  console.log('\n=== Scenario F : idempotence reelle cote serveur (edge function locale, sans mock) ===');
  const functionServed = (() => {
    try {
      execSync(`curl -sf -o /dev/null -X OPTIONS "${env.API_URL}/functions/v1/sync-push" -H "Origin: http://${HOST}:${PORT}"`, { stdio: 'ignore' });
      return true;
    } catch (e) { return false; }
  })();
  if (!functionServed) {
    console.log('  IGNORE - fonction sync-push non servie par le runtime edge local (voir supabase/functions/, absent par defaut dans ce depot -- supabase-functions/ n\'est pas le layout attendu par la CLI). Idempotence deja verifiee statiquement (unique(account,device_id,client_seq) + upsert ignoreDuplicates, voir sync-push.ts) ET verifiee empiriquement lors du developpement de ce correctif (voir T3_FIX_REPORT.md). Pour rejouer ce scenario : copier supabase-functions/sync-push.ts vers supabase/functions/sync-push/index.ts puis `supabase stop && bash scripts/local-db/rebuild.sh`.');
  } else {
  await withPage(async (page) => {
    // Pas d'interception ici : on veut vraiment toucher le backend local
    // (fonction sync-push reelle) pour prouver qu'un reessai (meme
    // client_seq) ne cree jamais de doublon, quel que soit le nombre
    // d'appels automatiques ajoutes par ce correctif.
    await loadHarnessAndSignIn(page, { supabaseUrl: env.API_URL, anonKey: env.ANON_KEY });
    const fixedSeq = 900001; // hors plage des sequences normales (nextClientSeq()) pour ne jamais entrer en collision avec les autres scenarios
    const deviceId = 'diag_device_' + Date.now(); // pas de SebaDB.create() dans ce scenario (appel direct au backend) -- seba_device_id n'existe donc pas encore, on fournit notre propre identifiant stable pour ce test

    const callOnce = () => page.evaluate(async ({ url, key, deviceId, seq }) => {
      const bearer = (() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/^sb-.*-auth-token$/.test(k)) {
            try { return JSON.parse(localStorage.getItem(k)).access_token; } catch (e) {}
          }
        }
        return null;
      })();
      const res = await fetch(url + '/functions/v1/sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + bearer },
        body: JSON.stringify({
          device_id: deviceId,
          operations: [{ client_seq: seq, entity: 'devis', entity_id: 'id_t3_idempotence_test', op: 'create', patch: { id: 'id_t3_idempotence_test', numero: 'T3-F-1', statut: 'envoye', montant: 100 } }],
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { url: env.API_URL, key: env.ANON_KEY, deviceId, seq: fixedSeq });

    const first = await callOnce();
    assert(first.status === 200, `1er appel reel accepte par le backend (observe status=${first.status}, body=${JSON.stringify(first.body)})`);
    const countAfterFirst = psql(`select count(*) from sync_operations where device_id='${deviceId}' and client_seq=${fixedSeq};`);
    assert(countAfterFirst === '1', `1 ligne sync_operations creee apres le 1er appel (observe: ${countAfterFirst})`);

    const second = await callOnce(); // simule le reessai automatique du client sur le meme client_seq
    assert(second.status === 200, `2e appel (rejeu du meme client_seq, comme le ferait un reessai automatique) egalement accepte (observe status=${second.status})`);
    const secondResult = (second.body && second.body.results && second.body.results[0]) || {};
    assert(secondResult.status === 'ack_duplicate', `le backend reconnait le doublon (observe status="${secondResult.status}")`);
    const countAfterSecond = psql(`select count(*) from sync_operations where device_id='${deviceId}' and client_seq=${fixedSeq};`);
    assert(countAfterSecond === '1', `AUCUN DOUBLON cote serveur apres rejeu du meme client_seq (observe: ${countAfterSecond} ligne(s), attendu 1)`);
  });
  }

  await server.close();
  console.log(`\n${failures === 0 ? 'TOUT PASSE' : failures + ' ECHEC(S)'} -- ${failures === 0 ? 'comportement conforme au correctif attendu.' : 'voir le detail ci-dessus.'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE DU HARNAIS :', e); process.exit(1); });
