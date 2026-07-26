// SEBA — QA verticale Smart Planning Dispatch (feature/smart-planning-dispatch).
//
// Scénario exact exigé (13 points) : création de plusieurs interventions ->
// assignation à deux employés -> détection d'un chevauchement -> refus de
// validation du conflit -> déplacement vers un horaire valide -> persistance
// après reload -> intervention visible dans l'espace terrain du bon employé
// -> aucune visibilité pour un autre employé -> demande client acceptée ->
// demande client refusée -> filtres fonctionnels -> aucun scroll horizontal
// à 390px -> zéro erreur console.
//
// Même pattern que scripts/qa-intervention-360.js / scripts/qa-quote-to-cash.js :
// sessions Supabase Auth RÉELLES, BrowserContext isolé par rôle,
// config.public.js intercepté, flush serveur direct via psql (Edge Function
// sync-push indisponible en local -- limitation d'infrastructure déjà
// documentée dans les scripts QA précédents).
//
// Usage : node scripts/qa-smart-planning-dispatch.js
// Prérequis : Supabase local démarré, Chrome installé au chemin ci-dessous.

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
const PORT = 8797;
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

/* Même contournement que les scripts QA précédents (sync-push indisponible
   en local) : après chaque écriture patron, on lit l'état local COMPLET et
   on le fusionne (||) directement dans seba_state via psql. */
async function flushPatronStateToServer(page, account) {
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
  }));
  psql(`update seba_state set state = state || $QASPD$${stateJson}$QASPD$::jsonb where account = '${account}';`);
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
  console.log('== [setup 1/4] Comptes synthétiques QASPD -- dédiés à ce script ==');
  const patronAId = await createOrGetUser('qaspd-patron-a@test.seba.invalid');
  const empA1Id = await createOrGetUser('qaspd-emp-a1@test.seba.invalid');
  const empA2Id = await createOrGetUser('qaspd-emp-a2@test.seba.invalid');
  const clientA1Id = await createOrGetUser('qaspd-cli-a1@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' | employé A1=' + empA1Id + ' A2=' + empA2Id + ' | client A1=' + clientA1Id);

  console.log('== [setup 2/4] seba_state du patron QASPD ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qspd_a1","nom":"Client QSPD A1","prenom":"","email":"qaspd-cli-a1@test.seba.invalid","adresse":"1 rue QSPD"}],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qspd_a1","prenom":"Employe","nom":"QSPD A1","actif":true},{"id":"emp_qspd_a2","prenom":"Employe","nom":"QSPD A2","actif":true}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Rattachements employe_accounts/client_accounts (idempotent) ==');
  psql(`
    delete from employe_accounts where employe_user_id in ('${empA1Id}','${empA2Id}');
    insert into employe_accounts (employe_user_id, account, employe_id, email) values
      ('${empA1Id}', '${patronAId}', 'emp_qspd_a1', 'qaspd-emp-a1@test.seba.invalid'),
      ('${empA2Id}', '${patronAId}', 'emp_qspd_a2', 'qaspd-emp-a2@test.seba.invalid');
    delete from client_accounts where client_user_id in ('${clientA1Id}');
    insert into client_accounts (client_user_id, account, client_id, email) values
      ('${clientA1Id}', '${patronAId}', 'cli_qspd_a1', 'qaspd-cli-a1@test.seba.invalid');
  `);

  console.log('== [setup 4/4] Repasse tous les mots de passe QASPD ==');
  for (const id of [patronAId, empA1Id, empA2Id, clientA1Id]) {
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
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QASPD SARL' }));
  });
  const empA1 = await newRolePage(browser);
  const empA2 = await newRolePage(browser);
  const clientA1 = await newRolePage(browser);

  try {
    console.log('\n== Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronSignIn = await patron.page.evaluate(() => window.sebaAuth.signIn('qaspd-patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!patronSignIn.error, 'connexion patron A réussie (' + JSON.stringify(patronSignIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
    const waitOk = await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_qspd_a1')), { timeout: 8000 }).then(() => true).catch(() => false);
    assert(waitOk, 'état cloud patron A rapatrié (client cli_qspd_a1 visible)');

    console.log('== [1/13] Création de plusieurs interventions ==');
    const todayISO = new Date().toISOString().slice(0, 10);
    const setup = await patron.page.evaluate((today) => {
      const client = SebaDB.get('clients', 'cli_qspd_a1');
      const i1 = SebaDB.create('interventions', { date: today, time: '09:00', duree: '2h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage A', done: false, employeId: null, employeName: null });
      const i2 = SebaDB.create('interventions', { date: today, time: '14:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage B', done: false, employeId: null, employeName: null });
      const i3 = SebaDB.create('interventions', { date: today, time: '10:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage C (conflit voulu)', done: false, employeId: null, employeName: null });
      const i4 = SebaDB.create('interventions', { date: today, time: '16:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage D (report)', done: false, employeId: null, employeName: null });
      return { i1: i1.id, i2: i2.id, i3: i3.id, i4: i4.id };
    }, todayISO);
    assert(setup.i1 && setup.i2 && setup.i3 && setup.i4, '4 interventions créées (' + JSON.stringify(setup) + ')');

    console.log('== [2/13] Assignation à deux employés (A1 sur i1, A2 sur i2) ==');
    const assignRes = await patron.page.evaluate((s) => ({
      a1: SebaDB.interventions.assign(s.i1, 'emp_qspd_a1', 'Employe QSPD A1'),
      a2: SebaDB.interventions.assign(s.i2, 'emp_qspd_a2', 'Employe QSPD A2'),
    }), setup);
    assert(assignRes.a1.ok && assignRes.a2.ok, 'assignation à 2 employés distincts réussie (' + JSON.stringify({ a1: assignRes.a1.ok, a2: assignRes.a2.ok }) + ')');

    console.log('== [3/13] Détection d\'un chevauchement (i3 à 10:00, employé A1 déjà pris 09:00-11:00) ==');
    const conflictAttempt = await patron.page.evaluate((s) => SebaDB.interventions.assign(s.i3, 'emp_qspd_a1', 'Employe QSPD A1'), setup);
    assert(conflictAttempt.ok === false && !!conflictAttempt.conflict, 'chevauchement détecté (' + JSON.stringify(conflictAttempt) + ')');

    console.log('== [4/13] Refus de validation du conflit (i3 reste NON assignée sans force) ==');
    const i3AfterAttempt = await patron.page.evaluate((id) => SebaDB.get('interventions', id), setup.i3);
    assert(!i3AfterAttempt.employeId, 'i3 n\'a PAS été assignée malgré la tentative en conflit (employeId=' + i3AfterAttempt.employeId + ')');

    console.log('== [5/13] Déplacement vers un horaire valide (i3 -> 12:00, hors chevauchement) ==');
    const validMove = await patron.page.evaluate((s) => SebaDB.interventions.reschedule(s.i3, { time: '12:00', employeId: 'emp_qspd_a1', employeName: 'Employe QSPD A1' }), setup);
    assert(validMove.ok === true, 'déplacement vers un horaire valide accepté (' + JSON.stringify(validMove.ok || validMove.error) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [6/13] Persistance après reload ==');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const persisted = await patron.page.evaluate((s) => ({
      i1: SebaDB.get('interventions', s.i1), i2: SebaDB.get('interventions', s.i2), i3: SebaDB.get('interventions', s.i3),
    }), setup);
    assert(persisted.i1.employeId === 'emp_qspd_a1' && persisted.i2.employeId === 'emp_qspd_a2' && persisted.i3.time === '12:00' && persisted.i3.employeId === 'emp_qspd_a1', 'assignations/horaires persistent après reload (' + JSON.stringify({ i1: persisted.i1.employeId, i2: persisted.i2.employeId, i3: [persisted.i3.time, persisted.i3.employeId] }) + ')');

    console.log('== Connexion réelle Employé A1 + Employé A2 ==');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a1SignIn = await empA1.page.evaluate(() => window.sebaAuth.signIn('qaspd-emp-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a1SignIn.error, 'connexion employé A1 réussie (' + JSON.stringify(a1SignIn.error) + ')');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA1.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    await empA2.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a2SignIn = await empA2.page.evaluate(() => window.sebaAuth.signIn('qaspd-emp-a2@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a2SignIn.error, 'connexion employé A2 réussie (' + JSON.stringify(a2SignIn.error) + ')');
    await empA2.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA2.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [7/13] i1 visible dans l\'espace terrain de l\'employé A1 (le bon employé) ==');
    const a1Missions = await empA1.page.evaluate(() => SebaDB.employeePortal.interventions());
    assert(Array.isArray(a1Missions) && a1Missions.some(m => m.id === setup.i1 && m.time === '09:00' && m.duree === '2h'), 'employé A1 voit i1 avec date/heure/durée réelles (' + JSON.stringify(a1Missions.map(m => m.id)) + ')');

    console.log('== [8/13] Aucune visibilité pour un autre employé (A2 ne voit PAS i1) ==');
    const a2Missions = await empA2.page.evaluate(() => SebaDB.employeePortal.interventions());
    const a2SeesI1 = a2Missions.some(m => m.id === setup.i1);
    assert(!a2SeesI1, 'ECHEC SECURITE si faux : employé A2 ne voit PAS i1 (assignée à A1) — observé ' + JSON.stringify(a2Missions.map(m => m.id)));
    assert(a2Missions.some(m => m.id === setup.i2), 'employé A2 voit bien sa propre mission i2');

    console.log('== Connexion réelle Client A1 ==');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const c1SignIn = await clientA1.page.evaluate(() => window.sebaAuth.signIn('qaspd-cli-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!c1SignIn.error, 'connexion client A1 réussie (' + JSON.stringify(c1SignIn.error) + ')');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    await clientA1.page.waitForFunction(() => document.getElementById('cp-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [9/13] Demande client ACCEPTÉE (i2, nouvelle date) met à jour la vraie intervention ==');
    // La demande est écrite par le CLIENT via sa propre session RPC réelle
    // (server-side, SECURITY DEFINER) -- ne JAMAIS flusher l'état local du
    // PATRON juste après (un flush fait un remplacement de clé au niveau
    // 'interventions', pas une fusion élément par élément : il écraserait
    // la demande fraîchement écrite par le client avec la copie locale
    // encore ancienne du patron). Un simple reload (pull) suffit ici.
    const tomorrowISO = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const reqRes = await clientA1.page.evaluate((id, d) => SebaDB.clientPortal.requestReschedule(id, d, 'QA : merci de reporter'), setup.i2, tomorrowISO);
    assert(reqRes.ok, 'demande de report envoyée par le client (' + JSON.stringify(reqRes.ok) + ')');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const acceptRes = await patron.page.evaluate((id) => SebaDB.interventions.resolveRescheduleRequest(id, true), setup.i2);
    assert(acceptRes.ok, 'patron accepte la demande de report (' + JSON.stringify(acceptRes.ok || acceptRes.error) + ')');
    const i2AfterAccept = await patron.page.evaluate((id) => SebaDB.get('interventions', id), setup.i2);
    assert(i2AfterAccept.date === tomorrowISO && i2AfterAccept.rescheduleRequest.status === 'accepted', 'date réelle mise à jour + statut "accepted" (' + JSON.stringify({ date: i2AfterAccept.date, status: i2AfterAccept.rescheduleRequest.status }) + ')');
    await flushPatronStateToServer(patron.page, patronAId); // écriture PATRON (accept) cette fois -- flush légitime avant la prochaine navigation

    console.log('== [10/13] Demande client REFUSÉE (i4) conserve le commentaire et son statut, date INCHANGÉE ==');
    const reqRes2 = await clientA1.page.evaluate((id, d) => SebaDB.clientPortal.requestReschedule(id, d, 'QA : report refusé attendu'), setup.i4, tomorrowISO);
    assert(reqRes2.ok, 'seconde demande de report envoyée (' + JSON.stringify(reqRes2.ok) + ')');
    await patron.page.reload({ waitUntil: 'domcontentloaded' }); // pull seul, même raison que ci-dessus
    await new Promise(r => setTimeout(r, 500));
    const dateBeforeDecline = (await patron.page.evaluate((id) => SebaDB.get('interventions', id), setup.i4)).date;
    const declineRes = await patron.page.evaluate((id) => SebaDB.interventions.resolveRescheduleRequest(id, false), setup.i4);
    assert(declineRes.ok, 'patron refuse la demande de report (' + JSON.stringify(declineRes.ok || declineRes.error) + ')');
    const i4AfterDecline = await patron.page.evaluate((id) => SebaDB.get('interventions', id), setup.i4);
    assert(i4AfterDecline.date === dateBeforeDecline, 'date INCHANGÉE après refus (' + i4AfterDecline.date + ' === ' + dateBeforeDecline + ')');
    assert(i4AfterDecline.rescheduleRequest.status === 'declined' && i4AfterDecline.rescheduleRequest.comment === 'QA : report refusé attendu', 'commentaire + statut "declined" conservés (' + JSON.stringify(i4AfterDecline.rescheduleRequest) + ')');
    await flushPatronStateToServer(patron.page, patronAId); // écriture PATRON (decline) -- flush avant la navigation vers planning.html au point 11

    console.log('== [11/13] Filtres fonctionnels (employé A1 -> seules ses cartes visibles) ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const beforeFilter = await patron.page.evaluate(() => document.querySelectorAll('.job[data-id]').length);
    await patron.page.select('#flt-employe', 'emp_qspd_a1');
    await new Promise(r => setTimeout(r, 400));
    const afterFilterIds = await patron.page.evaluate(() => [...document.querySelectorAll('.job[data-id]')].map(el => el.dataset.id));
    const onlyA1 = await patron.page.evaluate((ids) => ids.every((id) => { const i = SebaDB.get('interventions', id); return i && i.employeId === 'emp_qspd_a1'; }), afterFilterIds);
    assert(beforeFilter > afterFilterIds.length, 'le filtre réduit bien le nombre de cartes affichées (' + beforeFilter + ' -> ' + afterFilterIds.length + ')');
    assert(onlyA1 && afterFilterIds.length > 0, 'seules les interventions de l\'employé filtré restent visibles (' + JSON.stringify(afterFilterIds) + ')');
    await patron.page.select('#flt-employe', '');

    console.log('== [12/13] Aucun scroll horizontal à 390px (planning patron + espace terrain employé) ==');
    for (const [label, rolePage] of [['patron (planning.html)', patron.page], ['employé A1 (espace-terrain.html)', empA1.page]]) {
      await rolePage.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 300));
      const hScroll = await rolePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }

    console.log('== [13/13] Zéro erreur console (patron/employé A1/employé A2/client A1) ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(empA1.consoleErrors.length === 0, 'zéro erreur console — employé A1 (' + JSON.stringify(empA1.consoleErrors) + ')');
    assert(empA2.consoleErrors.length === 0, 'zéro erreur console — employé A2 (' + JSON.stringify(empA2.consoleErrors) + ')');
    assert(clientA1.consoleErrors.length === 0, 'zéro erreur console — client A1 (' + JSON.stringify(clientA1.consoleErrors) + ')');

  } finally {
    await patron.ctx.close(); await empA1.ctx.close(); await empA2.ctx.close(); await clientA1.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
