// SEBA — QA verticale Quote-to-cash (feature/quote-to-cash).
//
// Scénario exact exigé (21 points, section QA du chantier) : Patron A crée
// un client -> crée un devis 2 lignes -> totaux HT/TVA/TTC corrects -> le
// devis persiste après reload -> Client A voit son devis, Client B ne le
// voit pas -> Client A accepte -> un second appel d'acceptation ne crée
// aucun doublon -> le patron voit le devis accepté -> le convertit en
// facture -> lignes/montants identiques -> paiement partiel -> solde
// correct -> paiement final -> facture 'paid' -> reload complet : tout
// persiste -> aucun accès cross-account -> aucun accès anon -> dashboard
// affiche les bonnes alertes -> pas de scroll horizontal à 390px -> zéro
// erreur console.
//
// Même pattern que scripts/qa-intervention-360.js : sessions Supabase Auth
// RÉELLES (pas le mode démo local), un BrowserContext isolé par rôle,
// config.public.js intercepté pour pointer vers le Supabase local, flush
// serveur direct via psql (Edge Function sync-push indisponible en local,
// même limitation d'infrastructure déjà documentée dans qa-intervention-360.js).
//
// Usage : node scripts/qa-quote-to-cash.js
// Prérequis : Supabase local démarré + migrations appliquées (voir
// scripts/local-db/rebuild.sh), Chrome installé au chemin ci-dessous.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const REPO_ROOT = 'C:\\Users\\sebas\\Downloads\\Seba\\Seba\\seba';
const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8798;
const PASSWORD = 'Test-Synthetic-2026!';

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(REPO_ROOT, 'docs', urlPath === '/' ? 'index.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('nf: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function createOrGetUser(email) {
  const resp = await fetch(API_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json && json.id) return json.id;
  const out = execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '${email}' limit 1;"`, { encoding: 'utf8' });
  return out.trim();
}

function psql(sql) {
  execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1', { input: sql, encoding: 'utf8' });
}
// Variante qui renvoie le résultat (stdin, jamais -c en ligne de commande --
// évite tout imbroglio d'échappement de guillemets shell/JSON).
function psqlValue(sql) {
  return execSync('docker exec -i supabase_db_seba psql -U postgres -t -A -v ON_ERROR_STOP=1', { input: sql, encoding: 'utf8' }).trim();
}

/* Même contournement que qa-intervention-360.js (sync-push indisponible en
   local) : après chaque écriture patron, on lit l'état local COMPLET et on
   le fusionne (||) directement dans seba_state via psql. */
async function flushPatronStateToServer(page, account) {
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
  }));
  psql(`update seba_state set state = state || $QAQTC$${stateJson}$QAQTC$::jsonb where account = '${account}';`);
}

async function newRolePage(browser) {
  const ctx = await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/config(\.public)?\.js$/.test(req.url())) {
      const body = `window.SEBA_CONFIG_PUBLIC = { supabaseUrl: '${API_URL}', supabaseAnonKey: '${ANON_KEY}', accountId: 'demo', onesignalAppId:'', sentryDsn:'', umamiWebsiteId:'', umamiScriptUrl:'' };`;
      req.respond({ status: 200, contentType: 'application/javascript', body });
      return;
    }
    req.continue();
  });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', async (m) => {
    // Même filtre que qa-intervention-360.js : ai-relay (widgets.js,
    // app/dashboard.html) et manifest.json, Edge Functions indisponibles
    // en local, hors périmètre de ce chantier.
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|503 \(Service Temporarily Unavailable\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  page.on('dialog', async (d) => { await d.dismiss(); });
  return { ctx, page, consoleErrors };
}

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques QAQTC -- dédiés à ce script ==');
  const patronAId = await createOrGetUser('qaqtc-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qaqtc-patron-b@test.seba.invalid');
  const clientA1Id = await createOrGetUser('qaqtc-cli-a1@test.seba.invalid');
  const clientBId = await createOrGetUser('qaqtc-cli-b@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' B=' + patronBId + ' | client A1=' + clientA1Id + ' B=' + clientBId);

  console.log('== [setup 2/4] seba_state des 2 patrons QAQTC (account = user_id) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qtc_a1","nom":"Client QTC A1","prenom":"","email":"qaqtc-cli-a1@test.seba.invalid","adresse":"1 rue QTC A1"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[{"id":"cli_qtc_b","nom":"Client QTC B","prenom":"","email":"qaqtc-cli-b@test.seba.invalid","adresse":"1 rue QTC B"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Rattachements client_accounts (idempotent) ==');
  psql(`
    delete from client_accounts where client_user_id in ('${clientA1Id}','${clientBId}');
    insert into client_accounts (client_user_id, account, client_id, email) values
      ('${clientA1Id}', '${patronAId}', 'cli_qtc_a1', 'qaqtc-cli-a1@test.seba.invalid'),
      ('${clientBId}', '${patronBId}', 'cli_qtc_b', 'qaqtc-cli-b@test.seba.invalid');
  `);

  console.log('== [setup 4/4] Repasse tous les mots de passe QAQTC ==');
  for (const id of [patronAId, patronBId, clientA1Id, clientBId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();

  const patron = await newRolePage(browser);
  await patron.page.evaluateOnNewDocument(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QAQTC SARL' }));
  });
  const clientA1 = await newRolePage(browser);
  const anon = await newRolePage(browser);

  try {
    console.log('\n== [1/21] Connexion réelle Patron A + crée un client ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronSignIn = await patron.page.evaluate(() => window.sebaAuth.signIn('qaqtc-patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!patronSignIn.error, 'connexion patron A réussie (' + JSON.stringify(patronSignIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    const waitOk = await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_qtc_a1')), { timeout: 8000 }).then(() => true).catch(() => false);
    assert(waitOk, 'état cloud patron A rapatrié (client cli_qtc_a1 visible)');

    console.log('== [2/21] Patron A crée un devis avec DEUX lignes (TVA 20%, remise 10€) ==');
    const devisSetup = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qtc_a1');
      const res = SebaDB.devis.send({
        clientId: client.id, clientName: (client.prenom + ' ' + client.nom).trim(),
        lines: [{ desc: 'Ménage standard', qty: 3, u: 40 }, { desc: 'Vitres', qty: 1, u: 25 }],
        tvaRate: 20, remise: { type: 'amount', value: 10 }, acompte: { type: 'percent', value: 30 },
        validityDate: '2026-12-31', conditions: 'QA — conditions de test.',
      });
      return res;
    });
    assert(devisSetup.ok, 'devis créé (' + JSON.stringify(devisSetup.error || devisSetup.ok) + ')');
    const devisId = devisSetup.devis.id;

    console.log('== [3/21] Totaux HT/TVA/TTC corrects ==');
    // HT attendu : (3×40 + 1×25) - 10 = 145 - 10 = 135 ; TVA 20% = 27 ; TTC = 162.
    assert(devisSetup.devis.totalHT === 135, 'totalHT correct (attendu 135, observé ' + devisSetup.devis.totalHT + ')');
    assert(devisSetup.devis.totalTVA === 27, 'totalTVA correct (attendu 27, observé ' + devisSetup.devis.totalTVA + ')');
    assert(devisSetup.devis.totalTTC === 162, 'totalTTC correct (attendu 162, observé ' + devisSetup.devis.totalTTC + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [4/21] Le devis persiste après reload ==');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const persistedDevis = await patron.page.evaluate((id) => SebaDB.get('devis', id), devisId);
    assert(!!persistedDevis && persistedDevis.totalTTC === 162 && persistedDevis.lines.length === 2, 'devis persisté avec 2 lignes et totalTTC=162 après reload');

    console.log('== [5/21] Connexion réelle Client A1 ==');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const c1SignIn = await clientA1.page.evaluate(() => window.sebaAuth.signIn('qaqtc-cli-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!c1SignIn.error, 'connexion client A1 réussie (' + JSON.stringify(c1SignIn.error) + ')');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    await clientA1.page.waitForFunction(() => document.getElementById('cp-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [6/21] Client A1 voit son devis ==');
    const c1Devis = await clientA1.page.evaluate(() => SebaDB.clientPortal.devis());
    assert(Array.isArray(c1Devis) && c1Devis.some(d => d.totalTTC === 162), 'client A1 voit le devis (totalTTC=162) — observé ' + JSON.stringify(c1Devis && c1Devis.map(d => d.totalTTC)));

    console.log('== [7/21] Client B ne voit PAS le devis de Patron A ==');
    const clientB = await newRolePage(browser);
    await clientB.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const bSignIn = await clientB.page.evaluate(() => window.sebaAuth.signIn('qaqtc-cli-b@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!bSignIn.error, 'connexion client B réussie');
    await clientB.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    const bDevis = await clientB.page.evaluate(() => SebaDB.clientPortal.devis());
    assert(Array.isArray(bDevis) && bDevis.length === 0, 'ECHEC SECURITE si faux : client B ne voit aucun devis de Patron A (' + JSON.stringify(bDevis) + ')');
    const bDetailOtherAccount = await clientB.page.evaluate((id) => SebaDB.clientPortal.devisDetail(id), devisId);
    assert(bDetailOtherAccount.ok === false, 'ECHEC SECURITE si faux : client B ne peut pas lire le détail du devis de A (' + JSON.stringify(bDetailOtherAccount) + ')');
    await clientB.ctx.close();

    console.log('== [8/21] Client A1 accepte le devis ==');
    const acceptRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), devisId);
    assert(acceptRes.ok && acceptRes.devis.status === 'signe', 'devis accepté (' + JSON.stringify(acceptRes.ok && acceptRes.devis.status) + ')');
    assert(!!acceptRes.devis.acceptedAt, 'acceptation horodatée (acceptedAt=' + acceptRes.devis.acceptedAt + ')');

    console.log('== [9/21] Un second appel d\'acceptation ne crée AUCUN doublon (idempotence) ==');
    const acceptAgain = await clientA1.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), devisId);
    assert(acceptAgain.ok && acceptAgain.devis.status === 'signe', 'second appel idempotent, toujours ok/signe');
    // Vérité serveur directe (psql, via stdin) -- le cache local du CLIENT
    // ne reflète pas le blob seba_state du PATRON (RLS : auth.uid()
    // différent), donc SebaDB.get('devis', id) côté clientA1.page est
    // structurellement vide.
    const histCountRaw = psqlValue(`
      select coalesce(jsonb_array_length(jsonb_agg(h.value)), 0)
      from seba_state s, jsonb_array_elements(s.state -> 'devis') as d(value)
      cross join lateral jsonb_array_elements(coalesce(d.value -> 'statusHistory', '[]'::jsonb)) as h(value)
      where s.account = '${patronAId}' and d.value ->> 'id' = '${devisId}' and h.value ->> 'event' = 'client_accepted';
    `);
    const histCount = Number(histCountRaw) || 0;
    assert(histCount === 1, 'un seul événement client_accepted côté serveur malgré 2 appels (observé ' + histCount + ')');

    console.log('== [10/21] Le patron voit le devis accepté ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    const waitAccepted = await patron.page.waitForFunction((id) => { const d = window.SebaDB && SebaDB.get('devis', id); return d && d.status === 'signe'; }, { timeout: 8000 }, devisId).then(() => true).catch(() => false);
    assert(waitAccepted, 'patron voit le devis accepté après pull');

    console.log('== [11/21] Le patron convertit le devis accepté en facture ==');
    const factureRes = await patron.page.evaluate((id) => SebaDB.factures.createFromDevis(id), devisId);
    assert(factureRes.ok, 'facture créée depuis le devis (' + JSON.stringify(factureRes.error || factureRes.ok) + ')');
    const factureId = factureRes.facture.id;

    console.log('== [12/21] Les lignes et montants de la facture sont identiques au devis ==');
    assert(factureRes.facture.lines.length === 2, '2 lignes reprises (observé ' + factureRes.facture.lines.length + ')');
    assert(factureRes.facture.totalTTC === 162 && factureRes.facture.totalHT === 135 && factureRes.facture.totalTVA === 27, 'montants identiques au devis (' + JSON.stringify({ ht: factureRes.facture.totalHT, tva: factureRes.facture.totalTVA, ttc: factureRes.facture.totalTTC }) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [13/21] Le patron enregistre un paiement PARTIEL (100€) ==');
    const partialRes = await patron.page.evaluate((id) => SebaDB.factures.recordPayment(id, { amount: 100, mode: 'virement', date: '2026-07-26', reference: 'QA-1', note: 'acompte QA' }), factureId);
    assert(partialRes.ok && partialRes.facture.status === 'partially_paid', 'paiement partiel enregistré, statut partially_paid (' + JSON.stringify(partialRes.ok && partialRes.facture.status) + ')');

    console.log('== [14/21] Le solde restant est correct (162 - 100 = 62) ==');
    const balanceAfterPartial = await patron.page.evaluate((id) => SebaDB.factures.balance(SebaDB.get('factures', id)), factureId);
    assert(balanceAfterPartial === 62, 'solde correct après paiement partiel (attendu 62, observé ' + balanceAfterPartial + ')');

    console.log('== [15/21] Le patron enregistre le paiement final (62€) ==');
    const finalRes = await patron.page.evaluate((id) => SebaDB.factures.recordPayment(id, { amount: 62, mode: 'virement', date: '2026-07-27', reference: 'QA-2', note: '' }), factureId);
    assert(finalRes.ok, 'paiement final enregistré (' + JSON.stringify(finalRes.error || finalRes.ok) + ')');

    console.log('== [16/21] La facture passe à \'paid\', solde à 0 ==');
    assert(finalRes.facture.status === 'paid', 'statut paid (observé ' + finalRes.facture.status + ')');
    const balanceAfterFinal = await patron.page.evaluate((id) => SebaDB.factures.balance(SebaDB.get('factures', id)), factureId);
    assert(balanceAfterFinal === 0, 'solde à 0 après paiement final (observé ' + balanceAfterFinal + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [17/21] Reload complet : tout persiste (devis, facture, 2 paiements, statut paid) ==');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const persistedFinal = await patron.page.evaluate((dId, fId) => {
      const d = SebaDB.get('devis', dId); const f = SebaDB.get('factures', fId);
      return {
        devisStatus: d && d.status, devisInvoiceId: d && d.invoiceId,
        factureStatus: f && f.status, paymentsCount: f && f.payments.length,
        balance: f && SebaDB.factures.balance(f),
      };
    }, devisId, factureId);
    console.log('   État persisté :', JSON.stringify(persistedFinal));
    assert(persistedFinal.devisStatus === 'signe' && persistedFinal.devisInvoiceId === factureId, 'devis persisté (signé, lié à la facture)');
    assert(persistedFinal.factureStatus === 'paid' && persistedFinal.paymentsCount === 2 && persistedFinal.balance === 0, 'facture persistée (paid, 2 paiements, solde 0)');

    console.log('== [18/21] Aucun accès cross-account (Patron B / Client B, dernière vérification) ==');
    const bAfterAll = await (async () => {
      const cb = await newRolePage(browser);
      await cb.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
      await cb.page.evaluate(() => window.sebaAuth.signIn('qaqtc-cli-b@test.seba.invalid', 'Test-Synthetic-2026!'));
      await cb.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
      const res = await cb.page.evaluate((id) => SebaDB.clientPortal.factureDetail(id), factureId);
      await cb.ctx.close();
      return res;
    })();
    assert(bAfterAll.ok === false, 'ECHEC SECURITE si faux : client B ne peut pas lire la facture de A (' + JSON.stringify(bAfterAll) + ')');

    console.log('== [19/21] Aucun accès anonyme (RPC sans session) ==');
    await anon.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const anonRes = await anon.page.evaluate(async (id) => {
      const res = await window.sebaAuth.rpc('client_accept_devis', { p_devis_id: id });
      return { errored: !!res.error, message: res.error && res.error.message };
    }, devisId);
    assert(anonRes.errored, 'ECHEC SECURITE si faux : un appel anonyme à client_accept_devis est refusé (' + JSON.stringify(anonRes) + ')');

    console.log('== [20/21] Dashboard : aucune alerte "devis accepté à convertir" résiduelle (déjà converti+payé), pas de scroll horizontal à 390px ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const alertLabels = await patron.page.evaluate(() => [...document.querySelectorAll('#db-alerts .db-alert-label')].map(e => e.textContent));
    assert(!alertLabels.some(l => l.includes('à convertir')), 'aucune alerte "à convertir" résiduelle pour un devis déjà facturé (' + JSON.stringify(alertLabels) + ')');
    for (const [label, rolePage] of [['patron (dashboard)', patron.page], ['client A1 (client-espace)', clientA1.page]]) {
      await rolePage.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 300));
      const hScroll = await rolePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }

    console.log('== [21/21] Zéro erreur console (patron/client A1) ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(clientA1.consoleErrors.length === 0, 'zéro erreur console — client A1 (' + JSON.stringify(clientA1.consoleErrors) + ')');

  } finally {
    await patron.ctx.close(); await clientA1.ctx.close(); await anon.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
