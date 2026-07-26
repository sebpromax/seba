// SEBA — QA verticale Team availability + suggestions
// (feature/team-availability-suggestions).
//
// Scénario exact exigé (20 points) : ancien employé sans nouveaux champs
// reste assignable -> classement compétent/actif -> exclusions (inactif,
// indisponibilité acceptée, chevauchement, hors dispo habituelle) ->
// avertissements (compétence manquante, plafond hebdo, indispo pending) ->
// départage par charge -> stabilité alphabétique -> cycle de vie complet
// d'une demande d'indisponibilité (créer/annuler/isolation cross-employé/
// immutabilité après décision patron) -> suggestion visible dans planning
// ET intervention-fiche -> persistance -> mobile -> zéro erreur console.
//
// Même pattern que les scripts QA précédents : sessions Supabase Auth
// RÉELLES, BrowserContext isolé par rôle, config.public.js intercepté,
// flush serveur direct via psql (Edge Function sync-push indisponible en
// local). Pas de rôle client nécessaire ici (aucun des 20 points ne le
// requiert).
//
// Usage : node scripts/qa-team-availability-suggestions.js
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
const PORT = 8796;
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

async function flushPatronStateToServer(page, account) {
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
  }));
  psql(`update seba_state set state = state || $QATAS$${stateJson}$QATAS$::jsonb where account = '${account}';`);
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
  console.log('== [setup 1/4] Comptes synthétiques QATAS -- dédiés à ce script ==');
  const patronAId = await createOrGetUser('qatas-patron-a@test.seba.invalid');
  const empA1Id = await createOrGetUser('qatas-emp-a1@test.seba.invalid');
  const empA2Id = await createOrGetUser('qatas-emp-a2@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' | employé A1=' + empA1Id + ' A2=' + empA2Id);

  console.log('== [setup 2/4] seba_state du patron QATAS (2 employés, 1 client, aucun champ disponibilité -- "ancien" modèle volontaire) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qatas_a1","nom":"Client QATAS A1","prenom":"","email":"","adresse":"1 rue QATAS"}],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qatas_a1","prenom":"Alice","nom":"QATAS","actif":true,"role":"Agent"},{"id":"emp_qatas_a2","prenom":"Bob","nom":"QATAS","actif":true,"role":"Agent"}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Rattachements employe_accounts (idempotent) ==');
  psql(`
    delete from employe_accounts where employe_user_id in ('${empA1Id}','${empA2Id}');
    insert into employe_accounts (employe_user_id, account, employe_id, email) values
      ('${empA1Id}', '${patronAId}', 'emp_qatas_a1', 'qatas-emp-a1@test.seba.invalid'),
      ('${empA2Id}', '${patronAId}', 'emp_qatas_a2', 'qatas-emp-a2@test.seba.invalid');
  `);

  console.log('== [setup 4/4] Repasse tous les mots de passe QATAS ==');
  for (const id of [patronAId, empA1Id, empA2Id]) {
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
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QATAS SARL' }));
  });
  const empA1 = await newRolePage(browser);
  const empA2 = await newRolePage(browser);

  try {
    console.log('\n== Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronSignIn = await patron.page.evaluate(() => window.sebaAuth.signIn('qatas-patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!patronSignIn.error, 'connexion patron A réussie (' + JSON.stringify(patronSignIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
    const waitOk = await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('employes', 'emp_qatas_a1')), { timeout: 8000 }).then(() => true).catch(() => false);
    assert(waitOk, 'état cloud patron A rapatrié (employé emp_qatas_a1 visible)');

    console.log('== [1/20] Ancien employé (aucun champ disponibilité) reste assignable ==');
    const setup1 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qatas_a1');
      const interv = SebaDB.create('interventions', { date: '2026-08-03', time: '09:00', duree: '2h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage standard', done: false, employeId: null, employeName: null });
      const res = SebaDB.interventions.assign(interv.id, 'emp_qatas_a1', 'Alice QATAS');
      return { interventionId: interv.id, res };
    });
    assert(setup1.res.ok === true, 'ancien employé (sans skills/weeklyAvailability/...) reste assignable (' + JSON.stringify(setup1.res.ok || setup1.res.error) + ')');
    const i1 = setup1.interventionId;

    console.log('== [2/20] Employé actif + compétent classé premier ==');
    // Bob reçoit une compétence NON compatible (pas juste "aucune") pour
    // isoler strictement le critère 1 -- une liste vide vaudrait "aucune
    // restriction" (règle explicite du chantier) et neutraliserait le test.
    await patron.page.evaluate(() => {
      SebaDB.employes.setSkills('emp_qatas_a1', ['Ménage standard']);
      SebaDB.employes.setSkills('emp_qatas_a2', ['Jardinage']);
    });
    const rank2 = await patron.page.evaluate(() => {
      const candidate = { id: null, date: '2026-08-04', time: '09:00', duree: '2h', service: 'Ménage standard' };
      return SebaDB.scheduling.rankEmployeesForIntervention(candidate, SebaDB.list('employes'), SebaDB.list('interventions'));
    });
    assert(rank2.ranked.length === 2 && rank2.ranked[0].employeeId === 'emp_qatas_a1', 'Alice (compétente) classée première (' + JSON.stringify(rank2.ranked.map(r => r.employeeId)) + ')');

    console.log('== [3/20] Employé inactif exclu ==');
    await patron.page.evaluate(() => SebaDB.employes.setActive('emp_qatas_a2', false));
    const rank3 = await patron.page.evaluate(() => {
      const candidate = { id: null, date: '2026-08-04', time: '09:00', duree: '2h', service: 'Ménage standard' };
      return SebaDB.scheduling.rankEmployeesForIntervention(candidate, SebaDB.list('employes'), SebaDB.list('interventions'));
    });
    assert(rank3.ranked.length === 1 && rank3.excluded.some(e => e.employeeId === 'emp_qatas_a2' && e.blockers.some(b => b.code === 'employee_inactive')), 'Bob (inactif) exclu du classement (' + JSON.stringify(rank3.excluded.map(e => e.employeeId)) + ')');
    await patron.page.evaluate(() => SebaDB.employes.setActive('emp_qatas_a2', true)); // réactivé pour la suite des tests

    console.log('== [4/20] Indisponibilité ACCEPTED bloque l\'assignation ==');
    const block4 = await patron.page.evaluate(() => {
      SebaDB.update('employes', 'emp_qatas_a2', { unavailabilityRequests: [{ id: 'req1', startDate: '2026-08-10', endDate: '2026-08-15', reason: 'QA', status: 'accepted', createdAt: new Date().toISOString(), reviewedAt: new Date().toISOString(), reviewedBy: 'patron', reviewComment: '' }] });
      const interv = SebaDB.create('interventions', { date: '2026-08-12', time: '09:00', duree: '2h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: null, employeName: null });
      const res = SebaDB.interventions.assign(interv.id, 'emp_qatas_a2', 'Bob QATAS');
      return res;
    });
    assert(block4.ok === false && block4.blockers.some(b => b.code === 'accepted_unavailability'), 'indisponibilité acceptée bloque l\'assignation (' + JSON.stringify(block4.blockers && block4.blockers.map(b => b.code)) + ')');

    console.log('== [5/20] Indisponibilité PENDING avertit sans bloquer (force possible) ==');
    const warn5 = await patron.page.evaluate(() => {
      SebaDB.update('employes', 'emp_qatas_a2', { unavailabilityRequests: [{ id: 'req2', startDate: '2026-08-20', endDate: '2026-08-22', reason: 'QA', status: 'pending', createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null, reviewComment: null }] });
      const interv = SebaDB.create('interventions', { date: '2026-08-21', time: '09:00', duree: '2h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: null, employeName: null });
      const first = SebaDB.interventions.assign(interv.id, 'emp_qatas_a2', 'Bob QATAS');
      const forced = SebaDB.interventions.assign(interv.id, 'emp_qatas_a2', 'Bob QATAS', { force: true });
      return { first, forced };
    });
    assert(warn5.first.ok === false && warn5.first.needsConfirm && warn5.first.warnings.some(w => w.code === 'pending_unavailability'), 'indisponibilité pending avertit sans bloquer dur (' + JSON.stringify(warn5.first.warnings && warn5.first.warnings.map(w => w.code)) + ')');
    assert(warn5.forced.ok === true, 'confirmation explicite (force) permet l\'assignation malgré l\'avertissement');

    console.log('== [6/20] Chevauchement bloque ==');
    const block6 = await patron.page.evaluate(() => {
      const i1 = SebaDB.create('interventions', { date: '2026-08-06', time: '09:00', duree: '2h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: 'emp_qatas_a1', employeName: 'Alice QATAS' });
      const i2 = SebaDB.create('interventions', { date: '2026-08-06', time: '10:00', duree: '1h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: null, employeName: null });
      const res = SebaDB.interventions.assign(i2.id, 'emp_qatas_a1', 'Alice QATAS');
      return res;
    });
    assert(block6.ok === false && block6.blockers.some(b => b.code === 'schedule_conflict'), 'chevauchement horaire bloque (' + JSON.stringify(block6.blockers && block6.blockers.map(b => b.code)) + ')');

    console.log('== [7/20] Disponibilité habituelle incompatible bloque ==');
    const block7 = await patron.page.evaluate(() => {
      // 2026-08-03 est un lundi -- Alice disponible 09:00-12:00 le lundi uniquement.
      SebaDB.employes.setDayAvailability('emp_qatas_a1', 'monday', [{ start: '09:00', end: '12:00' }]);
      const interv = SebaDB.create('interventions', { date: '2026-08-03', time: '14:00', duree: '1h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: null, employeName: null });
      return SebaDB.interventions.assign(interv.id, 'emp_qatas_a1', 'Alice QATAS');
    });
    assert(block7.ok === false && block7.blockers.some(b => b.code === 'outside_regular_availability'), 'hors disponibilité habituelle bloque (' + JSON.stringify(block7.blockers && block7.blockers.map(b => b.code)) + ')');
    await patron.page.evaluate(() => SebaDB.employes.setDayAvailability('emp_qatas_a1', 'monday', [])); // reset pour la suite

    console.log('== [8/20] Compétence manquante avertit sans bloquer ==');
    const warn8 = await patron.page.evaluate(() => {
      const interv = SebaDB.create('interventions', { date: '2026-08-07', time: '09:00', duree: '1h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Prestation inconnue', done: false, employeId: null, employeName: null });
      return SebaDB.interventions.assign(interv.id, 'emp_qatas_a1', 'Alice QATAS');
    });
    assert(warn8.ok === false && warn8.needsConfirm && warn8.warnings.some(w => w.code === 'missing_skill'), 'compétence manquante avertit sans bloquer dur (' + JSON.stringify(warn8.warnings && warn8.warnings.map(w => w.code)) + ')');

    console.log('== [9/20] Plafond hebdomadaire dépassé avertit ==');
    const warn9 = await patron.page.evaluate(() => {
      SebaDB.employes.setMaxWeeklyMinutes('emp_qatas_a1', 60); // 1h/semaine, très bas exprès
      const interv = SebaDB.create('interventions', { date: '2026-08-04', time: '15:00', duree: '2h', clientId: 'cli_qatas_a1', clientName: 'x', service: 'Ménage standard', done: false, employeId: null, employeName: null });
      const res = SebaDB.interventions.assign(interv.id, 'emp_qatas_a1', 'Alice QATAS');
      SebaDB.employes.setMaxWeeklyMinutes('emp_qatas_a1', null); // reset
      return res;
    });
    assert(warn9.ok === false && warn9.warnings.some(w => w.code === 'weekly_capacity_exceeded'), 'dépassement du plafond hebdomadaire avertit (' + JSON.stringify(warn9.warnings && warn9.warnings.map(w => w.code)) + ')');

    console.log('== [10/20] Charge hebdomadaire départage deux employés à égalité sinon ==');
    const rank10 = await patron.page.evaluate(() => {
      // Alice a déjà 3h planifiées cette semaine (I1 2h + i6a 2h... on repart propre) -- on construit un cas net.
      const interventions = [
        { id: 'x1', date: '2026-08-03', time: '08:00', duree: '3h', employeId: 'emp_qatas_a1' }, // Alice : 3h
        { id: 'x2', date: '2026-08-03', time: '08:00', duree: '1h', employeId: 'emp_qatas_a2' }, // Bob : 1h
      ];
      const employees = [
        { id: 'emp_qatas_a1', prenom: 'Alice', nom: 'Z', actif: true, skills: [], weeklyAvailability: {}, maxWeeklyMinutes: null, unavailabilityRequests: [] },
        { id: 'emp_qatas_a2', prenom: 'Bob', nom: 'A', actif: true, skills: [], weeklyAvailability: {}, maxWeeklyMinutes: null, unavailabilityRequests: [] },
      ];
      const candidate = { id: null, date: '2026-08-05', time: '09:00', duree: '1h', service: 'Ménage standard' };
      return SebaDB.scheduling.rankEmployeesForIntervention(candidate, employees, interventions);
    });
    assert(rank10.ranked[0].employeeId === 'emp_qatas_a2', 'Bob (charge plus faible, 1h vs 3h) classé premier malgré nom alphabétiquement après (' + JSON.stringify(rank10.ranked.map(r => [r.employeeId, r.weeklyMinutes])) + ')');

    console.log('== [11/20] Résultat stable en cas d\'égalité totale (ordre alphabétique) ==');
    const rank11 = await patron.page.evaluate(() => {
      const employees = [
        { id: 'z1', prenom: 'Zoe', nom: 'Z', actif: true, skills: [], weeklyAvailability: {}, maxWeeklyMinutes: null, unavailabilityRequests: [] },
        { id: 'a1', prenom: 'Aline', nom: 'A', actif: true, skills: [], weeklyAvailability: {}, maxWeeklyMinutes: null, unavailabilityRequests: [] },
      ];
      const candidate = { id: null, date: '2026-08-05', time: '09:00', duree: '1h', service: 'Ménage standard' };
      return SebaDB.scheduling.rankEmployeesForIntervention(candidate, employees, []);
    });
    assert(rank11.ranked[0].employeeId === 'a1', 'égalité totale départagée par ordre alphabétique (' + JSON.stringify(rank11.ranked.map(r => r.employeeId)) + ')');

    console.log('== [17/20] Suggestion visible dans planning.html ET intervention-fiche.html ==');
    const planningSuggest = await patron.page.evaluate(() => {
      document.getElementById('ss-date').value = '2026-08-04';
      document.getElementById('ss-time').value = '09:00';
      document.getElementById('ss-duration').value = '1h';
      document.getElementById('ss-service').value = 'Ménage standard';
      openSuggestPanel();
      return document.getElementById('suggest-panel').innerHTML;
    });
    assert(/Recommandé/.test(planningSuggest), 'panneau de suggestion visible sur planning.html (' + planningSuggest.slice(0, 80) + '…)');

    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.goto(`http://127.0.0.1:${PORT}/intervention-fiche.html?id=${i1}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const fichesuggest = await patron.page.evaluate(() => {
      document.getElementById('f-date').value = '2026-08-04';
      document.getElementById('f-time').value = '09:00';
      document.getElementById('f-service').value = 'Ménage standard';
      openSuggestPanel();
      return document.getElementById('suggest-panel').innerHTML;
    });
    assert(/Recommandé/.test(fichesuggest), 'panneau de suggestion visible sur intervention-fiche.html (' + fichesuggest.slice(0, 80) + '…)');

    console.log('== [18/20] Assignation persistante après reload ==');
    await patron.page.evaluate(() => SebaDB.interventions.assign(_id, 'emp_qatas_a1', 'Alice QATAS', { force: true }));
    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const persisted18 = await patron.page.evaluate((id) => SebaDB.get('interventions', id), i1);
    assert(persisted18.employeId === 'emp_qatas_a1', 'assignation persistée après reload (' + persisted18.employeId + ')');

    console.log('== Connexion réelle Employé A1 + Employé A2 ==');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a1SignIn = await empA1.page.evaluate(() => window.sebaAuth.signIn('qatas-emp-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a1SignIn.error, 'connexion employé A1 réussie (' + JSON.stringify(a1SignIn.error) + ')');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA1.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    await empA2.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a2SignIn = await empA2.page.evaluate(() => window.sebaAuth.signIn('qatas-emp-a2@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a2SignIn.error, 'connexion employé A2 réussie (' + JSON.stringify(a2SignIn.error) + ')');
    await empA2.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA2.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [12/20] Employé A1 crée sa propre demande d\'indisponibilité ==');
    const createRes = await empA1.page.evaluate(() => SebaDB.employeePortal.createUnavailabilityRequest('2026-09-01', '2026-09-05', 'QA congés'));
    assert(createRes.ok, 'demande créée par l\'employé A1 (' + JSON.stringify(createRes.ok || createRes.error) + ')');
    const reqId = createRes.request.id;

    console.log('== [13/20] Employé A2 ne voit ni ne modifie cette demande ==');
    const a2Profile = await empA2.page.evaluate(() => SebaDB.employeePortal.profile());
    const a2SeesReq = (a2Profile.employe.unavailabilityRequests || []).some(r => r.id === reqId);
    assert(!a2SeesReq, 'ECHEC SECURITE si faux : employé A2 ne voit pas la demande de A1 (' + JSON.stringify(a2Profile.employe.unavailabilityRequests) + ')');
    const a2CancelAttempt = await empA2.page.evaluate((id) => SebaDB.employeePortal.cancelUnavailabilityRequest(id), reqId);
    assert(a2CancelAttempt.ok === false, 'ECHEC SECURITE si faux : employé A2 ne peut pas annuler la demande de A1 (' + JSON.stringify(a2CancelAttempt) + ')');

    console.log('== [14/20] Employé A1 annule sa demande pending ==');
    const cancelRes = await empA1.page.evaluate((id) => SebaDB.employeePortal.cancelUnavailabilityRequest(id), reqId);
    assert(cancelRes.ok && cancelRes.request.status === 'cancelled', 'demande annulée par A1 (' + JSON.stringify(cancelRes.ok && cancelRes.request.status) + ')');

    console.log('== [15/20] Annulation impossible après acceptation (nouvelle demande, acceptée par le patron) ==');
    const createRes2 = await empA1.page.evaluate(() => SebaDB.employeePortal.createUnavailabilityRequest('2026-09-10', '2026-09-12', 'QA congés 2'));
    assert(createRes2.ok, 'seconde demande créée (' + JSON.stringify(createRes2.ok) + ')');
    const reqId2 = createRes2.request.id;
    await patron.page.goto(`http://127.0.0.1:${PORT}/employe-fiche.html?id=emp_qatas_a1`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));

    console.log('== [16/20] Le patron accepte la demande ==');
    const acceptRes = await patron.page.evaluate((id) => SebaDB.employes.resolveUnavailabilityRequest('emp_qatas_a1', id, true, 'Accordé, bonnes vacances'), reqId2);
    assert(acceptRes.ok && acceptRes.employe.unavailabilityRequests.find(r => r.id === reqId2).status === 'accepted', 'patron accepte la demande (' + JSON.stringify(acceptRes.ok) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    const cancelAfterAccept = await empA1.page.evaluate((id) => SebaDB.employeePortal.cancelUnavailabilityRequest(id), reqId2);
    assert(cancelAfterAccept.ok === false, 'annulation impossible après acceptation (' + JSON.stringify(cancelAfterAccept) + ')');

    console.log('== [19/20] Aucun scroll horizontal à 390px (planning.html + employe-fiche.html) ==');
    for (const [label, rolePage] of [['patron (planning.html)', patron.page]]) {
      await rolePage.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
      await rolePage.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 300));
      const hScroll = await rolePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }
    await patron.page.goto(`http://127.0.0.1:${PORT}/employe-fiche.html?id=emp_qatas_a1`, { waitUntil: 'domcontentloaded' });
    await patron.page.setViewport({ width: 390, height: 844 });
    await new Promise(r => setTimeout(r, 400));
    const hScroll2 = await patron.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hScroll2, 'pas de scroll horizontal à 390px — patron (employe-fiche.html)');

    console.log('== [20/20] Zéro erreur console (patron/employé A1/employé A2) ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(empA1.consoleErrors.length === 0, 'zéro erreur console — employé A1 (' + JSON.stringify(empA1.consoleErrors) + ')');
    assert(empA2.consoleErrors.length === 0, 'zéro erreur console — employé A2 (' + JSON.stringify(empA2.consoleErrors) + ')');

  } finally {
    await patron.ctx.close(); await empA1.ctx.close(); await empA2.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
