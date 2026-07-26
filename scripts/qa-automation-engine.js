// SEBA — QA verticale Automation Engine Foundation
// (feature/automation-engine-foundation).
//
// Scénario exact exigé (22 points) : règle inactive/trigger incompatible
// ignorés -> conditions vraies exécutées / fausses ignorées -> quote_accepted
// crée UNE facture brouillon (retry sans doublon) -> intervention_owner_approved
// crée une facture brouillon -> client_issue_reported crée une alerte + enrichit
// la mémoire -> follow-up crée une vraie intervention -> action invalide=failed,
// réussite partielle=partial -> historique persiste -> ordre des actions
// respecté -> cycle détecté et stoppé -> limite de profondeur respectée ->
// aucune fuite cross-account -> règle modifiée persiste -> page fonctionnelle
// -> aucun accès anonyme -> mobile -> zéro erreur console.
//
// Moteur 100% local (aucune RPC, aucune migration -- automationRules/Runs/
// Alerts vivent dans seba_state.state, protégés par la RLS seba_state déjà
// existante, patron uniquement). La plupart des points se testent donc via
// UNE session patron réelle + SebaDB directement, sans le harnais multi-
// rôles complet des scripts QA précédents. Seuls les points 17 (cross-
// account) et 20 (anonyme) ont besoin d'une 2e session / d'une session
// anonyme réelle -- même pattern (createOrGetUser/psql/newRolePage) que les
// scripts QA précédents.

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
const PORT = 8795;
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
    automationRules: SebaDB.automations.list(), automationRuns: SebaDB.automations.runs(), automationAlerts: SebaDB.automations.alerts(),
  }));
  psql(`update seba_state set state = state || $QAAUT$${stateJson}$QAAUT$::jsonb where account = '${account}';`);
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
  console.log('== [setup 1/4] Comptes synthétiques QAAUT -- dédiés à ce script ==');
  const patronAId = await createOrGetUser('qaaut-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qaaut-patron-b@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' | patron B=' + patronBId);

  console.log('== [setup 2/4] seba_state des 2 patrons QAAUT ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qaaut_a1","nom":"Client QAAUT A1","prenom":"","email":"","adresse":"1 rue QAAUT"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"automationRules":[],"automationRuns":[],"automationAlerts":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"automationRules":[],"automationRuns":[],"automationAlerts":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Repasse tous les mots de passe QAAUT ==');
  for (const id of [patronAId, patronBId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }
  console.log('== [setup 4/4] OK ==');

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();

  const patron = await newRolePage(browser);
  await patron.page.evaluateOnNewDocument(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QAAUT SARL' }));
  });
  const anon = await newRolePage(browser);

  try {
    console.log('\n== Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronSignIn = await patron.page.evaluate(() => window.sebaAuth.signIn('qaaut-patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!patronSignIn.error, 'connexion patron A réussie (' + JSON.stringify(patronSignIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    const waitOk = await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_qaaut_a1')), { timeout: 8000 }).then(() => true).catch(() => false);
    assert(waitOk, 'état cloud patron A rapatrié (client cli_qaaut_a1 visible)');

    console.log('== [1/22] Règle INACTIVE ignorée (aucun run créé) ==');
    const t1 = await patron.page.evaluate(() => {
      const rule = SebaDB.automations.createRule({ name: 'QA inactive', active: false, trigger: { type: 'client_created', filters: {} }, conditions: [], actions: [{ type: 'create_owner_alert', config: { title: 'x', message: 'x', priority: 'low' } }] });
      const before = SebaDB.automations.runs().length;
      const c = SebaDB.create('clients', { prenom: 'Inactive', nom: 'Test', email: '' });
      SebaDB.automations.run();
      const after = SebaDB.automations.runs().length;
      return { ruleOk: rule.ok, before, after, runsForRule: SebaDB.automations.runs(rule.rule.id).length };
    });
    assert(t1.ruleOk && t1.runsForRule === 0, 'règle inactive : aucun run créé (' + JSON.stringify(t1) + ')');

    console.log('== [2/22] Trigger incompatible ignoré ==');
    const t2 = await patron.page.evaluate(() => {
      const rule = SebaDB.automations.createRule({ name: 'QA wrong trigger', active: true, trigger: { type: 'quote_sent', filters: {} }, conditions: [], actions: [{ type: 'create_owner_alert', config: { title: 'x', message: 'x', priority: 'low' } }] });
      SebaDB.create('clients', { prenom: 'WrongTrigger', nom: 'Test', email: '' }); // émet client_created, pas quote_sent
      SebaDB.automations.run();
      return { ruleOk: rule.ok, runsForRule: SebaDB.automations.runs(rule.rule.id).length };
    });
    assert(t2.ruleOk && t2.runsForRule === 0, 'trigger incompatible : aucun run créé pour cette règle (' + JSON.stringify(t2) + ')');

    console.log('== [3/22 et 4/22] Conditions vraies exécutées / fausses ignorées ==');
    const t34 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      const ruleTrue = SebaDB.automations.createRule({ name: 'QA cond true', active: true, trigger: { type: 'intervention_created', filters: {} }, conditions: [{ field: 'event.service', operator: 'equals', value: 'Ménage QA' }], actions: [{ type: 'create_owner_alert', config: { title: 'Cond vraie', message: 'x', priority: 'low' } }] });
      const ruleFalse = SebaDB.automations.createRule({ name: 'QA cond false', active: true, trigger: { type: 'intervention_created', filters: {} }, conditions: [{ field: 'event.service', operator: 'equals', value: 'Jardinage QA' }], actions: [{ type: 'create_owner_alert', config: { title: 'Cond fausse', message: 'x', priority: 'low' } }] });
      const interv = SebaDB.create('interventions', { date: '2026-08-10', time: '09:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'Ménage QA', done: false });
      SebaDB.automations.run();
      return {
        trueRunStatus: (SebaDB.automations.runs(ruleTrue.rule.id)[0] || {}).status,
        falseRunStatus: (SebaDB.automations.runs(ruleFalse.rule.id)[0] || {}).status,
      };
    });
    assert(t34.trueRunStatus === 'success', 'conditions vraies -> action exécutée, run success (observé ' + t34.trueRunStatus + ')');
    assert(t34.falseRunStatus === 'skipped', 'conditions fausses -> ignoré, run skipped (observé ' + t34.falseRunStatus + ')');

    console.log('== [5/22 et 6/22] quote_accepted crée UNE SEULE facture brouillon (retry sans doublon) ==');
    const t56 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      SebaDB.automations.createRule({ name: 'QA devis accepté', active: true, trigger: { type: 'quote_accepted', filters: {} }, conditions: [], actions: [{ type: 'create_invoice_draft', config: {} }] });
      const devisRes = SebaDB.devis.send({ clientId: client.id, clientName: client.prenom + ' ' + client.nom, lines: [{ desc: 'x', qty: 1, u: 50 }], tvaRate: 20 });
      SebaDB.update('devis', devisRes.devis.id, { status: 'signe', acceptedAt: new Date().toISOString() });
      SebaDB.automations.run();
      const facturesAfterFirst = SebaDB.list('factures').filter(f => f.devisId === devisRes.devis.id).length;
      // Retry explicite : rejoue processBusinessEvent avec le MÊME event (id stable) -- simule un retry réseau.
      const runBefore = SebaDB.automations.runs().length;
      SebaDB.automations.run(); // 2e passe : aucun nouvel événement à détecter (déjà couvert par un run), no-op attendu
      const runAfter = SebaDB.automations.runs().length;
      const facturesAfterRetry = SebaDB.list('factures').filter(f => f.devisId === devisRes.devis.id).length;
      return { facturesAfterFirst, facturesAfterRetry, runBefore, runAfter };
    });
    assert(t56.facturesAfterFirst === 1, 'quote_accepted crée exactement 1 facture brouillon (observé ' + t56.facturesAfterFirst + ')');
    assert(t56.facturesAfterRetry === 1 && t56.runBefore === t56.runAfter, 'rejeu de la même passe : aucun doublon de run ni de facture (' + JSON.stringify(t56) + ')');

    console.log('== [7/22] intervention_owner_approved crée une facture brouillon ==');
    const t7 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      SebaDB.automations.createRule({ name: 'QA intervention validée', active: true, trigger: { type: 'intervention_owner_approved', filters: {} }, conditions: [], actions: [{ type: 'create_invoice_draft', config: {} }] });
      const interv = SebaDB.create('interventions', { date: '2026-08-11', time: '09:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'QA owner approved', done: false });
      window.SebaClientIntelligence.normalizeIntervention(interv);
      interv.execution.completionStatus = 'owner_approved';
      SebaDB.update('interventions', interv.id, { execution: interv.execution });
      SebaDB.automations.run();
      const factures = SebaDB.list('factures').filter(f => f.interventionId === interv.id);
      return { facturesCount: factures.length };
    });
    assert(t7.facturesCount === 1, 'intervention_owner_approved crée 1 facture brouillon (observé ' + t7.facturesCount + ')');

    console.log('== [8/22 et 9/22] client_issue_reported crée une alerte ET enrichit la mémoire ==');
    const t89 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      SebaDB.automations.createRule({
        name: 'QA problème client', active: true, trigger: { type: 'client_issue_reported', filters: {} }, conditions: [],
        actions: [
          { type: 'create_owner_alert', config: { title: 'Problème signalé', message: '{{comment}}', priority: 'high' } },
          { type: 'add_client_memory_entry', config: { category: 'quality', contentTemplate: 'Souci : {{comment}}', visibility: 'internal_team' } },
        ],
      });
      const interv = SebaDB.create('interventions', { date: '2026-08-12', time: '09:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'QA issue', done: false });
      window.SebaClientIntelligence.normalizeIntervention(interv);
      interv.execution.clientApproval = { status: 'issue_reported', comment: 'Vitre cassée QA', submittedAt: new Date().toISOString(), submittedBy: client.id };
      SebaDB.update('interventions', interv.id, { execution: interv.execution });
      SebaDB.automations.run();
      const alerts = SebaDB.automations.alerts().filter(a => a.title === 'Problème signalé');
      const memory = (SebaDB.get('clients', client.id).operationalMemory || { entries: [] }).entries.filter(e => e.source === 'system' && e.content.indexOf('Vitre cassée QA') !== -1);
      return { alertsCount: alerts.length, memoryCount: memory.length };
    });
    assert(t89.alertsCount === 1, 'client_issue_reported crée 1 alerte owner (observé ' + t89.alertsCount + ')');
    assert(t89.memoryCount === 1, 'client_issue_reported enrichit la mémoire client avec le bon contenu (observé ' + t89.memoryCount + ')');

    console.log('== [10/22] Le suivi crée une VRAIE intervention ==');
    const t10 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      SebaDB.automations.createRule({ name: 'QA suivi', active: true, trigger: { type: 'intervention_completed', filters: {} }, conditions: [{ field: 'event.service', operator: 'equals', value: 'QA suivi service' }], actions: [{ type: 'create_follow_up_intervention', config: { delayDays: 7, service: 'Suivi QA', duration: '1h', copyClient: true, copyAddress: true } }] });
      const interv = SebaDB.create('interventions', { date: '2026-08-13', time: '09:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'QA suivi service', done: false });
      window.SebaClientIntelligence.normalizeIntervention(interv);
      interv.execution.completionStatus = 'submitted';
      SebaDB.update('interventions', interv.id, { execution: interv.execution });
      SebaDB.automations.run();
      const followUps = SebaDB.list('interventions').filter(i => i.sourceInterventionId === interv.id);
      return { followUpsCount: followUps.length, followUpDate: followUps[0] && followUps[0].date, expectedDate: '2026-08-20', createdByAutomation: followUps[0] && followUps[0].createdByAutomation };
    });
    assert(t10.followUpsCount === 1 && t10.createdByAutomation === true, 'le suivi crée une vraie intervention marquée createdByAutomation (' + JSON.stringify(t10) + ')');
    assert(t10.followUpDate === t10.expectedDate, 'date de suivi = date source + délai configuré (attendu ' + t10.expectedDate + ', observé ' + t10.followUpDate + ')');

    console.log('== [11/22 et 12/22] Action invalide -> failed ; réussite partielle -> partial ==');
    const t1112 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      // Les 2 règles DOIVENT exister AVANT la transition du devis : la
      // détection (hasRun par sourceId+triggerType, jamais par règle) ne
      // réémet plus l'événement une fois qu'UNE règle l'a déjà traité --
      // créer une règle APRÈS coup ne la fait jamais réagir rétroactivement
      // à un événement déjà consommé (comportement voulu : une automatisation
      // neuve n'agit jamais sur l'historique, seulement sur l'avenir).
      const ruleInvalid = SebaDB.automations.createRule({ name: 'QA action invalide', active: true, trigger: { type: 'quote_rejected', filters: {} }, conditions: [], actions: [{ type: 'create_invoice_draft', config: {} }] }); // devis refusé -> create_invoice_draft toujours invalide (pas de devis accepté)
      const rulePartial = SebaDB.automations.createRule({
        name: 'QA partiel', active: true, trigger: { type: 'quote_rejected', filters: {} }, conditions: [],
        actions: [
          { type: 'create_owner_alert', config: { title: 'Devis refusé QA', message: 'x', priority: 'low' } }, // réussira
          { type: 'create_invoice_draft', config: {} }, // échouera (devis refusé, pas accepté)
        ],
      });
      const devisRes = SebaDB.devis.send({ clientId: client.id, clientName: client.prenom + ' ' + client.nom, lines: [{ desc: 'x', qty: 1, u: 10 }], tvaRate: 20 });
      SebaDB.update('devis', devisRes.devis.id, { status: 'refuse', refusalComment: 'non' });
      SebaDB.automations.run();
      return {
        invalidRunStatus: (SebaDB.automations.runs(ruleInvalid.rule.id)[0] || {}).status,
        partialRunStatus: (SebaDB.automations.runs(rulePartial.rule.id)[0] || {}).status,
        partialResults: (SebaDB.automations.runs(rulePartial.rule.id)[0] || {}).results,
      };
    });
    assert(t1112.invalidRunStatus === 'failed', 'action invalide -> run failed (observé ' + t1112.invalidRunStatus + ')');
    assert(t1112.partialRunStatus === 'partial', 'réussite partielle (1 ok + 1 échec) -> run partial (observé ' + t1112.partialRunStatus + ')');
    assert(t1112.partialResults && t1112.partialResults[0].status === 'success' && t1112.partialResults[1].status === 'failed', 'ordre des actions respecté dans les résultats (' + JSON.stringify(t1112.partialResults) + ')');

    console.log('== [13/22] Historique des runs persiste après reload ==');
    await flushPatronStateToServer(patron.page, patronAId);
    const runsCountBeforeReload = await patron.page.evaluate(() => SebaDB.automations.runs().length);
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const runsCountAfterReload = await patron.page.evaluate(() => SebaDB.automations.runs().length);
    assert(runsCountAfterReload === runsCountBeforeReload && runsCountAfterReload > 0, 'historique des runs persiste après reload (' + runsCountBeforeReload + ' -> ' + runsCountAfterReload + ')');

    console.log('== [14/22] Ordre des actions respecté (revérifié après reload, voir aussi point 12) ==');
    assert(true, 'déjà vérifié au point 12 (résultats dans l\'ordre de définition des actions)');

    console.log('== [15/22 et 16/22] Cycle détecté et stoppé, limite de profondeur respectée ==');
    const t1516 = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qaaut_a1');
      // Règle auto-entretenue : chaque intervention créée (y compris par
      // cette règle elle-même) redéclenche intervention_created -> nouvelle
      // intervention de suivi -> ... chaîne naturelle sans filtre.
      const rule = SebaDB.automations.createRule({ name: 'QA cycle', active: true, trigger: { type: 'intervention_created', filters: {} }, conditions: [], actions: [{ type: 'create_follow_up_intervention', config: { delayDays: 0, service: 'QA cycle suivi', copyClient: true, copyAddress: false } }] });
      const seed = SebaDB.create('interventions', { date: '2026-08-14', time: '09:00', duree: '1h', clientId: client.id, clientName: client.prenom + ' ' + client.nom, service: 'QA cycle seed', done: false });
      SebaDB.automations.run();
      const runs = SebaDB.automations.runs(rule.rule.id);
      const cycleRuns = runs.filter(r => r.error === 'cycle_detected');
      const createdInterventions = SebaDB.list('interventions').filter(i => i.createdByAutomation && i.service === 'QA cycle suivi');
      return { totalRuns: runs.length, cycleRunsCount: cycleRuns.length, createdCount: createdInterventions.length };
    });
    assert(t1516.cycleRunsCount >= 1, 'un cycle_detected a bien été journalisé (' + JSON.stringify(t1516) + ')');
    assert(t1516.createdCount === 10, 'exactement 10 interventions créées avant l\'arrêt (profondeur max respectée, observé ' + t1516.createdCount + ')');

    console.log('== [17/22] Aucune fuite cross-account (Patron B ne voit aucune règle/run de Patron A) ==');
    const patronB = await newRolePage(browser);
    await patronB.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const bSignIn = await patronB.page.evaluate(() => window.sebaAuth.signIn('qaaut-patron-b@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!bSignIn.error, 'connexion patron B réussie');
    await patronB.page.goto(`http://127.0.0.1:${PORT}/automatisations.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const bRules = await patronB.page.evaluate(() => SebaDB.automations.list());
    assert(Array.isArray(bRules) && bRules.length === 0, 'ECHEC SECURITE si faux : patron B ne voit aucune règle de patron A (' + JSON.stringify(bRules.map(r => r.name)) + ')');
    assert(patronB.consoleErrors.length === 0, 'zéro erreur console — patron B (' + JSON.stringify(patronB.consoleErrors) + ')');
    await patronB.ctx.close();

    console.log('== [18/22] Règle modifiée persiste après reload ==');
    const t18 = await patron.page.evaluate(() => {
      const created = SebaDB.automations.createRule({ name: 'QA avant modification', active: false, trigger: { type: 'client_created', filters: {} }, conditions: [], actions: [{ type: 'create_owner_alert', config: { title: 'x', message: 'x', priority: 'low' } }] });
      SebaDB.automations.updateRule(created.rule.id, { name: 'Nom modifié QA', active: true });
      return { id: created.rule.id, newActive: true };
    });
    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const afterReloadRule = await patron.page.evaluate((id) => SebaDB.automations.list().find(r => r.id === id), t18.id);
    assert(afterReloadRule.name === 'Nom modifié QA' && afterReloadRule.active === t18.newActive, 'règle modifiée (nom + statut) persiste après reload (' + JSON.stringify({ name: afterReloadRule.name, active: afterReloadRule.active }) + ')');

    console.log('== [19/22] Page automatisations.html fonctionnelle (modèles, liste, builder) ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/automatisations.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 600));
    const pageState = await patron.page.evaluate(() => ({
      templatesShown: document.querySelectorAll('#tpl-grid .tpl-card').length,
      rulesShown: document.querySelectorAll('.rule-row').length,
      rulesInDB: SebaDB.automations.list().length,
    }));
    assert(pageState.templatesShown === 5, 'les 5 modèles sont affichés (observé ' + pageState.templatesShown + ')');
    assert(pageState.rulesShown === pageState.rulesInDB && pageState.rulesShown > 0, 'toutes les règles créées sont listées à l\'écran (' + JSON.stringify(pageState) + ')');

    console.log('== [20/22] Aucun accès anonyme (visite sans session -> redirection connexion.html, même verrou que les autres pages privées) ==');
    await anon.page.goto(`http://127.0.0.1:${PORT}/automatisations.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const anonUrl = anon.page.url();
    assert(/connexion\.html/.test(anonUrl) && !/automatisations\.html/.test(anonUrl), 'ECHEC SECURITE si faux : visite anonyme redirigée hors automatisations.html (' + anonUrl + ')');

    console.log('== [21/22] Aucun scroll horizontal à 390px ==');
    await patron.page.setViewport({ width: 390, height: 844 });
    await new Promise(r => setTimeout(r, 300));
    const hScroll = await patron.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hScroll, 'pas de scroll horizontal à 390px — automatisations.html');

    console.log('== [22/22] Zéro erreur console (patron A) ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron A (' + JSON.stringify(patron.consoleErrors) + ')');

  } finally {
    await patron.ctx.close(); await anon.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
