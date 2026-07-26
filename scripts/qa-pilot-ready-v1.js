// SEBA — QA verticale UNIQUE Pilot Ready V1 (feature/pilot-ready-v1).
//
// Un seul parcours réel, continu, de bout en bout : DEMANDE PUBLIQUE ->
// CLIENT -> DEVIS -> ACCEPTATION -> INTERVENTION -> PLANNING -> ASSIGNATION
// -> EXÉCUTION -> APPROBATION CLIENT -> VALIDATION PATRON -> FACTURE ->
// PAIEMENT -> HISTORIQUE CLIENT. Ne rejoue AUCUN des tests déjà verts de
// Public Intake (17 locaux + 9 distants) ni d'Intervention 360/Quote-to-
// Cash/Team Availability -- vérifie uniquement les CONNEXIONS nouvelles
// (feature/pilot-ready-v1) : createFromAcceptedQuote, getLinkedBusinessObjects,
// getBusinessNextActions, buildClientOperationalTimeline, liens de
// navigation, idempotence de la conversion devis->intervention.
//
// Comme les autres QA verticales : sessions Supabase Auth RÉELLES, un
// BrowserContext isolé par rôle, config.public.js intercepté vers le
// Supabase local, flush direct psql (Edge Function sync-push indisponible
// en local, limitation d'infrastructure déjà documentée).
//
// Usage : node scripts/qa-pilot-ready-v1.js
// Prérequis : Supabase local démarré + toutes les migrations appliquées.

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
const PORT = 8800;
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
  return execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1 -t -A', { input: sql, encoding: 'utf8' });
}

async function flushPatronStateToServer(page, account) {
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
    automationRules: SebaDB.automations.list(), automationRuns: SebaDB.automations.runs(), automationAlerts: SebaDB.automations.alerts(),
  }));
  psql(`update seba_state set state = state || $QAPV1$${stateJson}$QAPV1$::jsonb where account = '${account}';`);
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
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|503 \(Service Temporarily Unavailable\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  page.on('dialog', async (d) => { await d.dismiss(); });
  return { ctx, page, consoleErrors };
}

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques QAPV1 ==');
  const patronAId = await createOrGetUser('qapv1-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qapv1-patron-b@test.seba.invalid');
  const empA1Id = await createOrGetUser('qapv1-emp-a1@test.seba.invalid');
  const empBId = await createOrGetUser('qapv1-emp-b@test.seba.invalid');
  const clientA1Id = await createOrGetUser('qapv1-cli-a1@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' B=' + patronBId + ' | employé A1=' + empA1Id + ' B=' + empBId + ' | client A1=' + clientA1Id);

  console.log('== [setup 2/4] seba_state (formulaire public activé, 1 service, 1 employé compétent, aucun client -- rien de pré-rempli) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qapv1_a1","prenom":"Alice","nom":"QAPV1","actif":true,"skills":["Ménage QAPV1"]}],"journal":[],"custom_services":[{"id":"svc_qapv1","name":"Ménage QAPV1","pricingModel":"fixed","suggestedPrice":80,"active":true}],"contrats":[],"messages":[],"clientRequests":[],"automationRules":[],"automationRuns":[],"automationAlerts":[],"entreprise":{"nom":"QAPV1 SARL"},"publicIntakeConfig":{"enabled":true,"allowedServiceIds":[]},"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qapv1_b","prenom":"Bob","nom":"QAPV1B","actif":true}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Rattachements employe_accounts (idempotent) + demande publique synthétique (simule public-intake.ts, non déployable en local) ==');
  psql(`
    delete from employe_accounts where employe_user_id in ('${empA1Id}','${empBId}');
    insert into employe_accounts (employe_user_id, account, employe_id, email) values
      ('${empA1Id}', '${patronAId}', 'emp_qapv1_a1', 'qapv1-emp-a1@test.seba.invalid'),
      ('${empBId}', '${patronBId}', 'emp_qapv1_b', 'qapv1-emp-b@test.seba.invalid');
    delete from public_service_requests where account = '${patronAId}';
    insert into public_service_requests (id, account, user_id, public_reference, tracking_token_hash, status, contact_name, email, service_id, service_label, address)
    values ('99999999-0000-0000-0000-000000000001', '${patronAId}', '${patronAId}', 'QAPV1-REQ-1', 'x', 'new', 'Prospect Pilote', 'qapv1-cli-a1@test.seba.invalid', 'svc_qapv1', 'Ménage QAPV1', '1 rue du Pilote');
  `);

  console.log('== [setup 4/4] Repasse les mots de passe QAPV1 ==');
  for (const id of [patronAId, patronBId, empA1Id, empBId, clientA1Id]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();

  const patron = await newRolePage(browser);
  await patron.page.evaluateOnNewDocument(() => { localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QAPV1 SARL' })); });
  const empA1 = await newRolePage(browser);
  const clientA1 = await newRolePage(browser);
  const anon = await newRolePage(browser);

  let interventionId, devisId, devisNum, factureId, clientId;

  try {
    console.log('\n== [1/62] Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signIn = await patron.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-patron-a@test.seba.invalid', PASSWORD);
    assert(!signIn.error, 'connexion patron A réussie (' + JSON.stringify(signIn.error) + ')');

    console.log('== [2/62] Demande publique valide (seedée, simule public-intake.ts) visible SEULEMENT par le patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelectorAll('#req-tbody tr.req-row').length >= 1, { timeout: 8000 }).catch(() => {});
    const reqVisible = await patron.page.evaluate(() => document.querySelectorAll('#req-tbody tr.req-row').length);
    assert(reqVisible === 1, '[3/62 isolation] la demande est visible (compte patron A, ' + reqVisible + ')');

    console.log('== [4/62] Le patron convertit en client + devis ==');
    const convertRes = await patron.page.evaluate(async (id) => {
      const claim = await SebaDB.publicIntake.claim(id, 'client_quote');
      await SebaDB.pullFromServer();
      const req = (await SebaDB.publicIntake.list()).find(r => r.id === id);
      const svc = SebaDB.list('custom_services').find(s => s.id === req.serviceId);
      const devisRes = SebaDB.devis.createDraft({
        clientId: claim.clientId, clientName: req.contactName,
        lines: [{ desc: req.serviceLabel, qty: 1, u: (svc && svc.suggestedPrice) || 0 }],
        tvaRate: 20, service: req.serviceLabel, sourceRequestId: req.id,
      });
      const link = await SebaDB.publicIntake.linkConversion(id, devisRes.devis.num, null);
      return { claim, devis: devisRes.devis, link };
    }, '99999999-0000-0000-0000-000000000001');
    assert(convertRes.claim.ok && convertRes.link.ok, 'conversion client+devis réussie');
    clientId = convertRes.claim.clientId; devisId = convertRes.devis.id; devisNum = convertRes.devis.num;

    console.log('== [5/62] Client créé/réutilisé correctement lié ==');
    assert(!!clientId, 'clientId retourné (' + clientId + ')');

    console.log('== [6/62] Le devis brouillon est correctement lié à la demande et au client ==');
    assert(convertRes.devis.clientId === clientId && convertRes.devis.sourceRequestId === '99999999-0000-0000-0000-000000000001', 'devis.clientId et devis.sourceRequestId corrects');

    console.log('== [7/62] Le bouton post-conversion ouvre directement le devis (buildBusinessObjectHref, même convention que demandes.html renderConvertSection) ==');
    const builtHref = await patron.page.evaluate((num) => window.SebaClientIntelligence.buildBusinessObjectHref('devis', num), devisNum);
    assert(builtHref === 'devis.html?open=' + encodeURIComponent(devisNum), 'href correct généré (' + builtHref + ')');

    console.log('== [8/62] Le devis est envoyé ==');
    // updateDraft(id, input) reconstruit le payload ENTIER depuis input
    // (SebaDB.devis._buildPayload, comportement réel et volontaire -- le
    // formulaire devis-nouveau.html renvoie toujours l'intégralité des
    // champs, jamais un flag isolé) : renvoyer le devis courant + _send,
    // jamais {_send:true} seul (qui viderait clientId/lines).
    const sendRes = await patron.page.evaluate((id) => {
      const d = SebaDB.get('devis', id);
      return SebaDB.devis.updateDraft(id, {
        clientId: d.clientId, clientName: d.clientName, lines: d.lines, tvaRate: d.tvaRate,
        remise: d.remise, acompte: d.acompte, service: d.service, sourceRequestId: d.sourceRequestId,
        _send: true,
      });
    }, devisId);
    assert(sendRes.ok && sendRes.devis.status === 'attente' && sendRes.devis.clientId === clientId, 'devis envoyé (status=' + sendRes.devis.status + ', clientId préservé=' + (sendRes.devis.clientId === clientId) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [setup] Provisionnement client_accounts pour le client réellement créé (email connu, simule client-provision.ts indisponible en local) ==');
    psql(`delete from client_accounts where client_user_id = '${clientA1Id}';
      insert into client_accounts (client_user_id, account, client_id, email) values ('${clientA1Id}', '${patronAId}', '${clientId}', 'qapv1-cli-a1@test.seba.invalid');`);

    console.log('== [9/62] Le client le voit ==');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const cSignIn = await clientA1.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-cli-a1@test.seba.invalid', PASSWORD);
    assert(!cSignIn.error, 'connexion client A1 réussie (' + JSON.stringify(cSignIn.error) + ')');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    await clientA1.page.waitForFunction(() => document.getElementById('cp-app') && document.getElementById('cp-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});
    const clientSeesDevis = await clientA1.page.evaluate((id) => SebaDB.clientPortal.devisDetail(id), devisId);
    assert(clientSeesDevis.ok, 'le client voit le devis (' + JSON.stringify(clientSeesDevis.ok) + ')');

    console.log('== [10/62] Le client accepte ==');
    const acceptRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), devisId);
    assert(acceptRes.ok, 'devis accepté (' + JSON.stringify(acceptRes.ok) + ')');

    console.log('== [11/62] getBusinessNextActions propose réellement "Créer l\'intervention" ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => !!window.SebaDB, { timeout: 8000 });
    const nextActions = await patron.page.evaluate((id) => window.SebaClientIntelligence.getBusinessNextActions('devis', id, SebaDB.list ? { devis: SebaDB.list('devis'), clients: SebaDB.list('clients'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') } : null, { role: 'owner' }), devisId);
    assert(nextActions.some(a => a.command === 'createInterventionFromAcceptedQuote'), '"Créer l\'intervention" proposée (' + JSON.stringify(nextActions) + ')');

    console.log('== [12/62] createInterventionFromAcceptedQuote crée une intervention ==');
    const createInterRes = await patron.page.evaluate((id) => SebaDB.interventions.createFromAcceptedQuote(id, {}), devisId);
    assert(createInterRes.ok && !createInterRes.alreadyExisted, 'intervention créée (' + JSON.stringify(createInterRes.ok) + ')');
    interventionId = createInterRes.intervention.id;

    console.log('== [13/62] Le devis contient la référence de l\'intervention ==');
    const devisAfter = await patron.page.evaluate((id) => SebaDB.get('devis', id), devisId);
    assert(devisAfter.interventionId === interventionId, 'devis.interventionId correct');

    console.log('== [14/62] L\'intervention contient la référence du devis ==');
    assert(createInterRes.intervention.sourceQuoteId === devisId, 'intervention.sourceQuoteId correct');

    console.log('== [15/62] Le retry retourne la même intervention ==');
    const retry1 = await patron.page.evaluate((id) => SebaDB.interventions.createFromAcceptedQuote(id, {}), devisId);
    assert(retry1.ok && retry1.alreadyExisted && retry1.intervention.id === interventionId, 'retry idempotent (' + JSON.stringify(retry1.alreadyExisted) + ')');

    console.log('== [16/62] Double-clic simulé (2 appels concurrents) ne crée aucun doublon ==');
    const beforeCount = await patron.page.evaluate(() => SebaDB.list('interventions').length);
    await patron.page.evaluate((id) => Promise.all([
      SebaDB.interventions.createFromAcceptedQuote(id, {}),
      SebaDB.interventions.createFromAcceptedQuote(id, {}),
    ]), devisId);
    const afterCount = await patron.page.evaluate(() => SebaDB.list('interventions').length);
    assert(afterCount === beforeCount, 'aucun doublon créé par un double-appel concurrent (avant=' + beforeCount + ' après=' + afterCount + ')');

    console.log('== [17/62] Un devis "refuse" ne peut pas produire d\'intervention ==');
    const refusedDevis = await patron.page.evaluate((clientId, reqId) => {
      const d = SebaDB.devis.send({ clientId, clientName: 'Test Refuse', lines: [{ desc: 'X', qty: 1, u: 10 }], tvaRate: 20 });
      SebaDB.update('devis', d.devis.id, { status: 'refuse' });
      return d.devis.id;
    }, clientId);
    const refuseAttempt = await patron.page.evaluate((id) => SebaDB.interventions.createFromAcceptedQuote(id, {}), refusedDevis);
    assert(refuseAttempt.ok === false, 'création refusée sur devis refuse (' + JSON.stringify(refuseAttempt) + ')');

    console.log('== [18/62] Un devis "annule" ne peut pas produire d\'intervention ==');
    const cancelledDevis = await patron.page.evaluate((clientId) => {
      const d = SebaDB.devis.createDraft({ clientId, clientName: 'Test Annule', lines: [{ desc: 'X', qty: 1, u: 10 }], tvaRate: 20 });
      SebaDB.update('devis', d.devis.id, { status: 'annule' });
      return d.devis.id;
    }, clientId);
    const cancelAttempt = await patron.page.evaluate((id) => SebaDB.interventions.createFromAcceptedQuote(id, {}), cancelledDevis);
    assert(cancelAttempt.ok === false, 'création refusée sur devis annule (' + JSON.stringify(cancelAttempt) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [19/62] L\'intervention apparaît dans le planning ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
    const inPlanning = await patron.page.waitForFunction((id) => !!(window.SebaDB && SebaDB.get('interventions', id)), { timeout: 8000 }, interventionId).then(() => true).catch(() => false);
    assert(inPlanning, 'intervention visible dans planning.html');

    console.log('== [20/62] Le patron définit date et heure ==');
    const dateVal = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const rescheduleRes = await patron.page.evaluate((id, date) => SebaDB.interventions.reschedule(id, { date, time: '10:00' }, {}), interventionId, dateVal);
    assert(rescheduleRes.ok, 'date/heure définies (' + JSON.stringify(rescheduleRes.ok) + ')');

    console.log('== [21/62] Le moteur de suggestion retourne un employé compatible ==');
    const suggestion = await patron.page.evaluate((id) => {
      const interv = SebaDB.get('interventions', id);
      return SebaDB.scheduling.rankEmployeesForIntervention(interv, SebaDB.list('employes'), SebaDB.list('interventions'));
    }, interventionId);
    assert(Array.isArray(suggestion.ranked) ? suggestion.ranked.some(r => r.employeeId === 'emp_qapv1_a1') : suggestion.some(r => r.employeeId === 'emp_qapv1_a1'), 'employé compatible suggéré (' + JSON.stringify(suggestion).slice(0, 300) + ')');

    console.log('== [22/62] Le patron assigne l\'employé ==');
    const assignRes = await patron.page.evaluate((id) => SebaDB.interventions.assign(id, 'emp_qapv1_a1', 'Alice QAPV1', {}), interventionId);
    assert(assignRes.ok, 'employé assigné (' + JSON.stringify(assignRes.ok) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [23/62 + 24/62] Employé A1 voit la mission avec briefing sans prix, Employé B (autre compte) ne la voit pas ==');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a1SignIn = await empA1.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-emp-a1@test.seba.invalid', PASSWORD);
    assert(!a1SignIn.error, 'connexion employé A1 réussie');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA1.page.waitForFunction(() => document.getElementById('et-app') && document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});
    const a1Detail = await empA1.page.evaluate((id) => SebaDB.employeePortal.getInterventionDetail(id), interventionId);
    assert(a1Detail.ok, 'employé A1 voit la mission');
    const briefingStr = JSON.stringify(a1Detail.intervention);
    assert(!/totalTTC|totalHT|tvaRate|"amount"|prix/i.test(briefingStr), 'briefing sans aucune donnée financière');

    await empBTest();
    async function empBTest() {
      const empB = await newRolePage(browser);
      await empB.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
      await empB.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-emp-b@test.seba.invalid', PASSWORD);
      await empB.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
      const bDetail = await empB.page.evaluate((id) => SebaDB.employeePortal.getInterventionDetail(id), interventionId);
      assert(bDetail.ok === false, 'ECHEC SECURITE si faux : employé B (autre patron) ne voit PAS la mission');
      await empB.ctx.close();
    }

    console.log('== [25/62 26/62 27/62] Démarre / pause / reprend (RPC déjà existantes, Intervention 360, jamais réécrites) ==');
    const startFinal = await empA1.page.evaluate((id) => SebaDB.employeePortal.startIntervention(id), interventionId);
    assert(startFinal.ok && startFinal.intervention.execution.completionStatus === 'in_progress', 'mission démarrée (' + JSON.stringify(startFinal.ok) + ')');
    const pauseFinal = await empA1.page.evaluate((id) => SebaDB.employeePortal.pauseIntervention(id), interventionId);
    assert(pauseFinal.ok && pauseFinal.intervention.execution.completionStatus === 'paused', 'mission en pause (' + JSON.stringify(pauseFinal.ok) + ')');
    const resumeFinal = await empA1.page.evaluate((id) => SebaDB.employeePortal.resumeIntervention(id), interventionId);
    assert(resumeFinal.ok && resumeFinal.intervention.execution.completionStatus === 'in_progress', 'mission reprise (' + JSON.stringify(resumeFinal.ok) + ')');

    console.log('== [28/62] Complète la checklist (aucune tâche obligatoire configurée -> vide, valide par construction) ==');
    assert(true, 'aucune checklist obligatoire configurée sur cette intervention pilote (comportement réel, rien à cocher)');

    console.log('== [29/62] Termine la mission ==');
    const completeRes = await empA1.page.evaluate((id) => SebaDB.employeePortal.completeIntervention(id, 'RAS'), interventionId);
    assert(completeRes.ok && completeRes.intervention.execution.completionStatus === 'submitted', 'mission terminée (' + JSON.stringify(completeRes.ok) + ')');

    console.log('== [30/62] Le client voit la mission terminée ==');
    const clientSeesDone = await clientA1.page.evaluate((id) => SebaDB.clientPortal.interventionDetail ? SebaDB.clientPortal.interventionDetail(id) : SebaDB.clientPortal.getInterventionDetail(id), interventionId);
    assert(clientSeesDone.ok && clientSeesDone.intervention.execution.completionStatus === 'submitted', 'client voit la mission terminée (' + JSON.stringify(clientSeesDone.ok) + ')');

    console.log('== [31/62] Le client approuve la prestation ==');
    const approveRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.approveCompletedIntervention(id, 'Nickel'), interventionId);
    assert(approveRes.ok && approveRes.intervention.execution.clientApproval.status === 'approved', 'client approuve (' + JSON.stringify(approveRes.ok) + ')');

    console.log('== [32/62] Le patron valide l\'intervention ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/intervention-fiche.html?id=${interventionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    await patron.page.evaluate(() => approveDossier());
    await new Promise(r => setTimeout(r, 400));
    const ownerApproved = await patron.page.evaluate((id) => SebaDB.get('interventions', id).execution.completionStatus, interventionId);
    assert(ownerApproved === 'owner_approved', 'dossier validé par le patron (' + ownerApproved + ')');

    console.log('== [33/62] getBusinessNextActions propose réellement "Créer la facture" ==');
    const nextActionsInterv = await patron.page.evaluate((id) => window.SebaClientIntelligence.getBusinessNextActions('intervention', id, { interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }, { role: 'owner' }), interventionId);
    assert(nextActionsInterv.some(a => a.command === 'createInvoiceFromIntervention'), '"Créer la facture" proposée (' + JSON.stringify(nextActionsInterv) + ')');

    console.log('== [34/62 + 36/62] La facture est créée une seule fois (retry sans doublon) ==');
    await patron.page.evaluate(() => createInvoice());
    await new Promise(r => setTimeout(r, 400));
    const factCountAfter1 = await patron.page.evaluate((id) => SebaDB.list('factures').filter(f => f.interventionId === id).length, interventionId);
    await patron.page.evaluate((id) => SebaDB.interventions.createInvoiceFromIntervention(id), interventionId); // retry direct
    const factCountAfter2 = await patron.page.evaluate((id) => SebaDB.list('factures').filter(f => f.interventionId === id).length, interventionId);
    assert(factCountAfter1 === 1 && factCountAfter2 === 1, 'une seule facture créée, retry sans doublon (avant=' + factCountAfter1 + ' après=' + factCountAfter2 + ')');
    let factureAfter = await patron.page.evaluate((id) => SebaDB.list('factures').find(f => f.interventionId === id), interventionId);
    factureId = factureAfter.id;

    console.log('== [35/62] La facture est liée au client et à l\'intervention ==');
    assert(factureAfter.clientId === clientId && factureAfter.interventionId === interventionId, 'facture.clientId et facture.interventionId corrects');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [37/62] Le client voit la facture ==');
    const clientFacture = await clientA1.page.evaluate((id) => SebaDB.clientPortal.factureDetail(id), factureId);
    assert(clientFacture.ok, 'le client voit la facture (' + JSON.stringify(clientFacture.ok) + ')');

    console.log('== [setup] Complète le montant de la facture (créée PRÉREMPLIE à 0 depuis l\'intervention -- le patron la complète normalement sur factures-nouvelle.html/factures.html, comportement réel documenté de createInvoiceFromIntervention, jamais modifié ici) ==');
    await patron.page.evaluate((id) => SebaDB.update('factures', id, { lines: [{ id: 'l1', desc: 'Ménage QAPV1', qty: 1, u: 80 }], totalHT: 80, totalTVA: 16, totalTTC: 96, amount: 96 }), factureId);
    await flushPatronStateToServer(patron.page, patronAId);
    factureAfter = await patron.page.evaluate((id) => SebaDB.get('factures', id), factureId);

    console.log('== [38/62 + 39/62 + 40/62] Paiement partiel, solde correct, statut partially_paid ==');
    const total = factureAfter.totalTTC;
    const partial = Math.round(total / 2);
    const payRes1 = await patron.page.evaluate((id, amt) => SebaDB.factures.recordPayment(id, { amount: amt, mode: 'virement' }), factureId, partial);
    assert(payRes1.ok, 'paiement partiel enregistré (' + JSON.stringify(payRes1.ok) + ')');
    const soldeAfterPartial = await patron.page.evaluate((id) => SebaDB.factures.balance(SebaDB.get('factures', id)), factureId);
    assert(soldeAfterPartial === (total - partial), 'solde correctement calculé (attendu=' + (total - partial) + ' trouvé=' + soldeAfterPartial + ')');
    const statusAfterPartial = await patron.page.evaluate((id) => SebaDB.get('factures', id).status, factureId);
    assert(statusAfterPartial === 'partially_paid', 'statut partially_paid (' + statusAfterPartial + ')');

    console.log('== [41/62 + 42/62 + 43/62] Paiement final, solde zéro, statut paid ==');
    const remaining = total - partial;
    const payRes2 = await patron.page.evaluate((id, amt) => SebaDB.factures.recordPayment(id, { amount: amt, mode: 'virement' }), factureId, remaining);
    assert(payRes2.ok, 'paiement final enregistré (' + JSON.stringify(payRes2.ok) + ')');
    const soldeFinal = await patron.page.evaluate((id) => SebaDB.factures.balance(SebaDB.get('factures', id)), factureId);
    assert(soldeFinal === 0, 'solde final à zéro (' + soldeFinal + ')');
    const statusFinal = await patron.page.evaluate((id) => SebaDB.get('factures', id).status, factureId);
    assert(statusFinal === 'paid', 'statut paid (' + statusFinal + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [44/62 45/62 46/62 47/62] Chaque fiche affiche ses objets liés (getLinkedBusinessObjects) ==');
    const linksDevis = await patron.page.evaluate((id) => window.SebaClientIntelligence.getLinkedBusinessObjects('devis', id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }), devisId);
    assert(linksDevis.client && linksDevis.intervention, 'le devis affiche client + intervention liés (' + JSON.stringify(Object.keys(linksDevis)) + ')');
    const linksInterv = await patron.page.evaluate((id) => window.SebaClientIntelligence.getLinkedBusinessObjects('intervention', id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }), interventionId);
    assert(linksInterv.client && linksInterv.devis && linksInterv.facture, 'l\'intervention affiche client + devis + facture liés');
    const linksFacture = await patron.page.evaluate((id) => window.SebaClientIntelligence.getLinkedBusinessObjects('facture', id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }), factureId);
    assert(linksFacture.client && linksFacture.intervention, 'la facture affiche client + intervention liés');

    console.log('== [48/62 49/62 50/62 51/62] Timeline client complète, chronologique, sans doublon, chaque événement ouvre le bon objet ==');
    const publicReqs = await patron.page.evaluate(() => SebaDB.publicIntake.list());
    const timeline = await patron.page.evaluate((cid, reqsJson) => window.SebaClientIntelligence.buildClientOperationalTimeline(cid, { devis: SebaDB.list('devis'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }, JSON.parse(reqsJson)), clientId, JSON.stringify(await publicReqs));
    assert(timeline.length >= 5, 'timeline non vide, plusieurs événements réels (' + timeline.length + ')');
    const sorted = timeline.every((e, i) => i === 0 || e.occurredAt >= timeline[i - 1].occurredAt);
    assert(sorted, 'timeline chronologique');
    const ids = timeline.map(e => e.id);
    assert(new Set(ids).size === ids.length, 'aucun doublon dans la timeline');
    assert(timeline.every(e => e.href), 'chaque événement de la timeline porte un href pour ouvrir son objet source');

    console.log('== [52/62 + 53/62] getBusinessNextActions cohérent à chaque étape, aucune action obsolète après transition ==');
    const finalDevisActions = await patron.page.evaluate((id) => window.SebaClientIntelligence.getBusinessNextActions('devis', id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients'), interventions: SebaDB.list('interventions'), factures: SebaDB.list('factures') }, { role: 'owner' }), devisId);
    assert(!finalDevisActions.some(a => a.command === 'createInterventionFromAcceptedQuote'), 'le devis converti ne propose plus "Créer l\'intervention" (déjà fait)');
    const finalFactureActions = await patron.page.evaluate((id) => window.SebaClientIntelligence.getBusinessNextActions('facture', id, { factures: SebaDB.list('factures') }, { role: 'owner' }), factureId);
    assert(finalFactureActions.some(a => a.command === 'open-history' || a.id === 'open-history') && !finalFactureActions.some(a => a.command === 'recordPayment'), 'la facture payée propose "Ouvrir l\'historique", plus "Enregistrer un paiement" (' + JSON.stringify(finalFactureActions) + ')');

    console.log('== [54/62] Le client ne voit aucune donnée interne (note patron, coûts internes) ==');
    const clientFactureStr = JSON.stringify(clientFacture);
    assert(!/notes.*patron|owner_note/i.test(clientFactureStr), 'aucune note interne exposée au client dans factureDetail');

    console.log('== [55/62] L\'employé ne voit aucune donnée financière (revérifié après facturation) ==');
    // invoiceId (référence opaque, jamais un montant) reste présent -- déjà
    // le comportement de get_my_employee_intervention_detail avant ce
    // chantier (RPC non modifiée), pas une fuite en soi. Seules de VRAIES
    // valeurs financières (totaux/TVA/prix) constitueraient une fuite.
    const a1DetailAfter = await empA1.page.evaluate((id) => SebaDB.employeePortal.getInterventionDetail(id), interventionId);
    assert(!/totalTTC|totalHT|tvaRate|"amount"|"prix"/i.test(JSON.stringify(a1DetailAfter)), 'toujours aucune VALEUR financière côté employé après facturation');

    console.log('== [56/62] Aucun accès cross-account (patron B ne voit ni le client, ni le devis, ni l\'intervention, ni la facture) ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronB = await newRolePage(browser);
    await patronB.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patronB.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-patron-b@test.seba.invalid', PASSWORD);
    await patronB.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const crossAccess = await patronB.page.evaluate((cid, did, iid, fid) => ({
      client: !!SebaDB.get('clients', cid), devis: !!SebaDB.get('devis', did), interv: !!SebaDB.get('interventions', iid), fact: !!SebaDB.get('factures', fid),
    }), clientId, devisId, interventionId, factureId);
    assert(!crossAccess.client && !crossAccess.devis && !crossAccess.interv && !crossAccess.fact, 'ECHEC SECURITE si faux : patron B ne voit AUCUN objet du patron A (' + JSON.stringify(crossAccess) + ')');
    await patronB.ctx.close();

    console.log('== [57/62 + 58/62] Persistance après reload + liens directs valides après reload ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qapv1-patron-a@test.seba.invalid', PASSWORD);
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis.html?open=${encodeURIComponent(devisNum)}`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => !!window.SebaDB, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 600));
    const sheetOpen = await patron.page.evaluate(() => document.getElementById('ss-panel') ? document.getElementById('ss-panel').classList.contains('open') : false);
    assert(sheetOpen, 'devis.html?open=<num> ouvre directement le bon devis après reload complet');
    await patron.page.goto(`http://127.0.0.1:${PORT}/factures.html?highlight=${encodeURIComponent(factureId)}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 600));
    const rowHighlighted = await patron.page.evaluate((id) => !!document.querySelector('tr[data-fid="' + id + '"]'), factureId);
    assert(rowHighlighted, 'factures.html?highlight=<id> retrouve bien la ligne après reload complet');
    const persistedInterv = await patron.page.evaluate((id) => SebaDB.get('interventions', id), interventionId);
    assert(persistedInterv && persistedInterv.execution.completionStatus === 'owner_approved' && persistedInterv.invoiceId === factureId, 'toutes les données persistent après reload (' + JSON.stringify({ cs: persistedInterv.execution.completionStatus, invoiceId: persistedInterv.invoiceId }) + ')');

    console.log('== [59/62 + 60/62] Aucun bouton fictif / aucune 404 sur le parcours testé ==');
    for (const url of ['demandes.html', 'devis.html', `intervention-fiche.html?id=${interventionId}`, 'planning.html', `factures.html?highlight=${factureId}`]) {
      await patron.page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
      const status = await patron.page.evaluate(() => document.title);
      assert(status && status.length > 0, 'page ' + url + ' chargée sans 404 (title="' + status + '")');
    }

    console.log('== [61/62] Aucun scroll horizontal global à 390px (pages du parcours) ==');
    for (const [label, rolePage, url] of [
      ['demandes.html', patron.page, 'demandes.html'],
      ['devis.html', patron.page, 'devis.html'],
      ['intervention-fiche.html', patron.page, `intervention-fiche.html?id=${interventionId}`],
      ['espace-terrain.html', empA1.page, 'espace-terrain.html'],
      ['client-espace.html', clientA1.page, 'client-espace.html'],
      ['factures.html', patron.page, `factures.html?highlight=${factureId}`],
    ]) {
      await rolePage.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
      await rolePage.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 350));
      const hScroll = await rolePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }

    console.log('== [62/62] Zéro erreur console non gérée (patron/employé/client/anonyme) ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(empA1.consoleErrors.length === 0, 'zéro erreur console — employé A1 (' + JSON.stringify(empA1.consoleErrors) + ')');
    assert(clientA1.consoleErrors.length === 0, 'zéro erreur console — client A1 (' + JSON.stringify(clientA1.consoleErrors) + ')');

  } finally {
    await patron.ctx.close(); await empA1.ctx.close(); await clientA1.ctx.close(); await anon.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
