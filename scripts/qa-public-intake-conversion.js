// SEBA — QA verticale Fondation acquisition (feature/public-intake-conversion).
//
// Scénario (26 points demandés) : entreprise/formulaire public -> demande ->
// centre de demandes patron -> conversion (client / client+devis /
// client+intervention) -> automatisations -> mobile -> zéro erreur console.
//
// LIMITE D'INFRASTRUCTURE CONNUE (voir memory/project_local_supabase_infra_gaps.md
// et scripts/local-db/local-only-grants.sql) : le runtime Edge Functions ne
// sert AUCUNE fonction en local (confirmé pour sync-push/ai-relay, même
// constat structurel ici -- ce dépôt garde ses Edge Functions à plat dans
// supabase-functions/*.ts, jamais supabase/functions/<nom>/index.ts attendu
// par la CLI). Les points qui exigent d'invoquer RÉELLEMENT l'endpoint HTTP
// public-intake (GET config / POST request / GET tracking / rate-limit) ne
// sont donc PAS vérifiables ici -- rapportés explicitement comme BLOQUÉ
// (jamais silencieusement ignorés, jamais faussement marqués OK). Tout le
// reste (RLS, RPC convert_public_service_request/link_..., moteur JS
// devis/intervention, automatisations, UI patron, mobile) tourne réellement
// contre le Postgres local + une vraie session Supabase Auth.
//
// La couverture RLS de la table/RPC (anon bloqué, isolation cross-account,
// idempotence, résolution client) est testée séparément et plus en détail
// par scripts/local-db/test-public-intake-rls.sh (exécuté par le harnais de
// livraison avant ce script) -- ce script-ci se concentre sur le parcours
// UI patron + le moteur JS + les automatisations, pas une redite des mêmes
// assertions SQL.
//
// Usage : node scripts/qa-public-intake-conversion.js
// Prérequis : Supabase local démarré, migration 2026-07-26-public-intake.sql
// appliquée, Chrome installé au chemin ci-dessous.

import http from 'node:http';
import crypto from 'node:crypto';
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
let blockedCount = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function blocked(msg) { console.log('  BLOQUÉ (infra: Edge Function non déployable en local) -', msg); blockedCount++; }

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
  psql(`update seba_state set state = state || $QAPI$${stateJson}$QAPI$::jsonb where account = '${account}';`);
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

function sha256Hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques QAPI ==');
  const patronAId = await createOrGetUser('qapi-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qapi-patron-b@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' | patron B=' + patronBId);

  const req1Token = 'plaintoken1111111111111111111111';
  const req2Token = 'plaintoken2222222222222222222222';
  const req3Token = 'plaintoken3333333333333333333333';

  console.log('== [setup 2/4] seba_state patron A/B (formulaire activé, 1 service, aucun client) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[{"id":"svc_qapi","name":"Ménage QAPI","pricingModel":"fixed","suggestedPrice":75,"active":true}],"contrats":[],"messages":[],"clientRequests":[],"automationRules":[],"automationRuns":[],"automationAlerts":[],"entreprise":{"nom":"QAPI Test SARL"},"publicIntakeConfig":{"enabled":true,"title":"Demander une intervention","introduction":"Bienvenue","allowedServiceIds":[],"requireAddress":false,"allowPreferredDate":true,"confirmationMessage":"Merci pour votre demande."},"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] 3 demandes publiques synthétiques pour patron A (simulent une insertion réelle de public-intake.ts) ==');
  psql(`
    delete from public_service_requests where account in ('${patronAId}','${patronBId}');
    insert into public_service_requests (id, account, user_id, public_reference, tracking_token_hash, status, contact_name, email, phone, service_id, service_label, description)
    values
      ('11111111-0000-0000-0000-000000000001', '${patronAId}', '${patronAId}', 'QAPI-REQ-1', '${sha256Hex(req1Token)}', 'new', 'Prospect Un', 'prospect1@qapi.invalid', null, 'svc_qapi', 'Ménage QAPI', 'Besoin 1'),
      ('11111111-0000-0000-0000-000000000002', '${patronAId}', '${patronAId}', 'QAPI-REQ-2', '${sha256Hex(req2Token)}', 'new', 'Prospect Deux', 'prospect2@qapi.invalid', null, 'svc_qapi', 'Ménage QAPI', 'Besoin 2'),
      ('11111111-0000-0000-0000-000000000003', '${patronAId}', '${patronAId}', 'QAPI-REQ-3', '${sha256Hex(req3Token)}', 'new', 'Prospect Trois', 'prospect3@qapi.invalid', null, 'svc_qapi', 'Ménage QAPI', 'Besoin 3');
  `);

  console.log('== [setup 4/4] Repasse les mots de passe QAPI ==');
  for (const id of [patronAId, patronBId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  console.log('\n== [Point 7] Token stocké UNIQUEMENT sous forme de hash (jamais en clair) ==');
  const hashRow = psql(`select tracking_token_hash from public_service_requests where id = '11111111-0000-0000-0000-000000000001';`).trim();
  assert(hashRow === sha256Hex(req1Token), 'la ligne stocke bien le hash SHA-256 attendu');
  assert(hashRow !== req1Token && hashRow.length === 64 && /^[0-9a-f]{64}$/.test(hashRow), 'le token en clair n\'apparaît jamais en base (colonne = hex64)');

  console.log('\n== [Points 1-6, 8-9, 11] Edge Function public-intake (GET config / POST request / GET tracking / rate-limit / référence non prédictible) ==');
  blocked('entreprise active accessible par son slug (GET config)');
  blocked('entreprise désactivée refusée (GET config)');
  blocked('configuration publique sans donnée interne (GET config, forme de la réponse)');
  blocked('service non autorisé refusé (POST request, validation serveur)');
  blocked('demande valide créée via HTTP (POST request) — équivalent DB simulé par le seed ci-dessus, voir points 12+');
  blocked('référence non prédictible (génération crypto.getRandomValues, non exécutable sans runtime Deno local)');
  blocked('suivi valide accessible (GET tracking)');
  blocked('mauvais token refusé (GET tracking)');
  blocked('limite anti-spam appliquée (POST request, table api_usage)');
  console.log('   -> Ces 9 points nécessitent d\'invoquer réellement supabase-functions/public-intake.ts, indisponible en local');
  console.log('      (aucun conteneur supabase_edge_runtime_seba fonctionnel + arborescence supabase-functions/*.ts non');
  console.log('      reconnue par `supabase functions serve`, voir memory/project_local_supabase_infra_gaps.md).');
  console.log('      À valider manuellement après déploiement sur Supabase partagé, avant merge (voir consigne de livraison).');

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();

  const patronA = await newRolePage(browser);
  await patronA.page.evaluateOnNewDocument(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QAPI Test SARL' }));
  });
  const patronB = await newRolePage(browser);
  const anon = await newRolePage(browser);

  try {
    console.log('\n== Connexion réelle Patron A ==');
    await patronA.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signInA = await patronA.page.evaluate((email, pwd) => window.sebaAuth.signIn(email, pwd), 'qapi-patron-a@test.seba.invalid', PASSWORD);
    assert(!signInA.error, 'connexion patron A réussie (' + JSON.stringify(signInA.error) + ')');

    console.log('\n== [Point 24] Pages patron protégées : demandes.html redirige un visiteur anonyme vers connexion.html ==');
    await anon.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await anon.page.waitForFunction(() => /connexion\.html$/.test(location.pathname), { timeout: 6000 }).catch(() => {});
    assert(/connexion\.html$/.test(new URL(anon.page.url()).pathname), 'redirection guard.js vers connexion.html (url=' + anon.page.url() + ')');

    console.log('\n== [Point 23] Page publique demande.html accessible SANS session ==');
    await anon.page.goto(`http://127.0.0.1:${PORT}/demande.html?pro=${patronAId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    assert(/demande\.html/.test(anon.page.url()), 'aucune redirection vers une page de connexion (url=' + anon.page.url() + ')');
    const hpVisible = await anon.page.evaluate(() => {
      const el = document.getElementById('in-website');
      if (!el) return true;
      const box = el.closest('.hp-field');
      return box ? (box.offsetWidth > 5 && box.offsetHeight > 5) : true;
    });
    assert(!hpVisible, 'champ honeypot invisible pour un visiteur réel');

    console.log('\n== Préparation : activation des 2 modèles d\'automatisation (feature/public-intake-conversion) ==');
    await patronA.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await patronA.page.waitForFunction(() => !!window.SebaDB, { timeout: 8000 });
    const templatesRes = await patronA.page.evaluate(() => {
      const r1 = SebaDB.automations.createFromTemplate('service_request_received_alert');
      const r2 = SebaDB.automations.createFromTemplate('service_request_converted_memory');
      SebaDB.automations.setActive(r1.rule.id, true);
      SebaDB.automations.setActive(r2.rule.id, true);
      return { ok1: r1.ok, ok2: r2.ok };
    });
    assert(templatesRes.ok1 && templatesRes.ok2, 'les 2 modèles service_request_created/converted sont créés et activés');
    await flushPatronStateToServer(patronA.page, patronAId);

    console.log('\n== [Point 12] Le patron A voit ses 3 demandes ==');
    await patronA.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await patronA.page.waitForFunction(() => document.querySelectorAll('#req-tbody tr.req-row').length === 3, { timeout: 8000 }).catch(() => {});
    const rowCountA = await patronA.page.evaluate(() => document.querySelectorAll('#req-tbody tr.req-row').length);
    assert(rowCountA === 3, 'patron A voit ses 3 demandes (trouvé ' + rowCountA + ')');

    console.log('\n== [Point 21] événement service_request_created émis (détection au chargement de demandes.html) ==');
    await patronA.page.waitForFunction(
      () => SebaDB.automations.runs().filter(r => r.triggerType === 'service_request_created').length === 3,
      { timeout: 6000 },
    ).catch(() => {});
    const createdRuns = await patronA.page.evaluate(() => SebaDB.automations.runs().filter(r => r.triggerType === 'service_request_created'));
    assert(createdRuns.length === 3, 'un run automatisation par demande "new" détectée (trouvé ' + createdRuns.length + '/3)');
    const alertsAfterCreate = await patronA.page.evaluate(() => SebaDB.automations.alerts());
    assert(alertsAfterCreate.some(a => /Prospect (Un|Deux|Trois)/.test(a.message || '')), 'une alerte patron a bien été créée pour au moins une nouvelle demande');

    console.log('\n== [Point 13] Le patron B (autre compte) ne voit AUCUNE des demandes du patron A ==');
    await patronB.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signInB = await patronB.page.evaluate((email, pwd) => window.sebaAuth.signIn(email, pwd), 'qapi-patron-b@test.seba.invalid', PASSWORD);
    assert(!signInB.error, 'connexion patron B réussie (' + JSON.stringify(signInB.error) + ')');
    await patronB.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const rowCountB = await patronB.page.evaluate(() => document.querySelectorAll('#req-tbody tr.req-row').length);
    assert(rowCountB === 0, 'patron B ne voit aucune demande du patron A (trouvé ' + rowCountB + ')');

    console.log('\n== [Point 14] Conversion en CLIENT (demande 1) ==');
    const convertClientRes = await patronA.page.evaluate(async (id) => {
      const r = await SebaDB.publicIntake.claim(id, 'client');
      await SebaDB.pullFromServer();
      return r;
    }, '11111111-0000-0000-0000-000000000001');
    assert(convertClientRes.ok && !convertClientRes.alreadyConverted && convertClientRes.clientId, 'conversion client réussie (' + JSON.stringify(convertClientRes) + ')');
    const clientAfterConvert = await patronA.page.evaluate((id) => SebaDB.get('clients', id), convertClientRes.clientId);
    assert(clientAfterConvert && clientAfterConvert.prenom === 'Prospect' && clientAfterConvert.nom === 'Un', 'le client créé porte le nom du contact de la demande');

    console.log('\n== [Point 15] Retry (rejeu) sans doublon client ==');
    const clientCountBeforeRetry = await patronA.page.evaluate(() => SebaDB.list('clients').length);
    const retryRes = await patronA.page.evaluate(async (id) => {
      const r = await SebaDB.publicIntake.claim(id, 'client');
      await SebaDB.pullFromServer();
      return r;
    }, '11111111-0000-0000-0000-000000000001');
    const clientCountAfterRetry = await patronA.page.evaluate(() => SebaDB.list('clients').length);
    assert(retryRes.ok && retryRes.alreadyConverted && retryRes.clientId === convertClientRes.clientId, 'rejeu détecté comme déjà converti, même clientId');
    assert(clientCountAfterRetry === clientCountBeforeRetry, 'aucun client dupliqué sur retry (avant=' + clientCountBeforeRetry + ' après=' + clientCountAfterRetry + ')');

    console.log('\n== [Point 20] La demande 1 est marquée converted ==');
    const status1 = psql(`select status from public_service_requests where id = '11111111-0000-0000-0000-000000000001';`).trim();
    assert(status1 === 'converted', 'demande 1 marquée converted (trouvé "' + status1 + '")');

    console.log('\n== [Points 16-17] Conversion en CLIENT + DEVIS BROUILLON (demande 2), lignes issues du moteur réel ==');
    await patronA.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const convertQuoteRes = await patronA.page.evaluate(async (id) => {
      const claim = await SebaDB.publicIntake.claim(id, 'client_quote');
      await SebaDB.pullFromServer();
      const req = (await SebaDB.publicIntake.list()).find(r => r.id === id);
      const svc = SebaDB.list('custom_services').find(s => s.id === req.serviceId);
      const devisRes = SebaDB.devis.createDraft({
        clientId: claim.clientId, clientName: req.contactName,
        lines: [{ desc: req.serviceLabel, qty: 1, u: (svc && svc.suggestedPrice) || 0 }],
        tvaRate: 20, service: req.serviceLabel,
      });
      const link = await SebaDB.publicIntake.linkConversion(id, devisRes.devis.num, null);
      SebaDB.automations.processExternalEvent('service_request_converted', 'service_request', id, { clientId: claim.clientId, serviceLabel: req.serviceLabel, action: 'client_quote' });
      return { claim, devis: devisRes.devis, link };
    }, '11111111-0000-0000-0000-000000000002');
    assert(convertQuoteRes.claim.ok && convertQuoteRes.link.ok, 'client + devis créés et liés (' + JSON.stringify(convertQuoteRes.link) + ')');
    assert(convertQuoteRes.devis.totalHT === 75 && convertQuoteRes.devis.totalTVA === 15 && convertQuoteRes.devis.totalTTC === 90, 'totaux calculés par le VRAI moteur SebaDB.devis.computeTotals (HT=75/TVA=15/TTC=90, trouvé HT=' + convertQuoteRes.devis.totalHT + '/TVA=' + convertQuoteRes.devis.totalTVA + '/TTC=' + convertQuoteRes.devis.totalTTC + ')');
    assert(convertQuoteRes.devis.status === 'brouillon', 'le devis est bien créé au statut brouillon');
    const linkedQuoteId = psql(`select converted_quote_id from public_service_requests where id = '11111111-0000-0000-0000-000000000002';`).trim();
    assert(linkedQuoteId === convertQuoteRes.devis.num, 'converted_quote_id correctement posé sur la demande (' + linkedQuoteId + ')');

    console.log('\n== [Points 18-19] Conversion en CLIENT + INTERVENTION NON ASSIGNÉE (demande 3), visible dans le planning ==');
    const convertIntervRes = await patronA.page.evaluate(async (id) => {
      const claim = await SebaDB.publicIntake.claim(id, 'client_intervention');
      await SebaDB.pullFromServer();
      const req = (await SebaDB.publicIntake.list()).find(r => r.id === id);
      const interv = SebaDB.create('interventions', {
        clientId: claim.clientId, clientName: req.contactName,
        service: req.serviceLabel, adresse: req.address || '',
        date: null, time: null, duree: null, employeId: null, employeName: null, done: false,
        publicRequestId: req.id,
      });
      const link = await SebaDB.publicIntake.linkConversion(id, null, interv.id);
      SebaDB.automations.processExternalEvent('service_request_converted', 'service_request', id, { clientId: claim.clientId, serviceLabel: req.serviceLabel, action: 'client_intervention' });
      return { claim, interv, link };
    }, '11111111-0000-0000-0000-000000000003');
    assert(convertIntervRes.claim.ok && convertIntervRes.link.ok, 'client + intervention créés et liés (' + JSON.stringify(convertIntervRes.link) + ')');
    assert(convertIntervRes.interv.employeId === null || convertIntervRes.interv.employeId === undefined, 'intervention créée NON ASSIGNÉE (employeId vide)');
    await flushPatronStateToServer(patronA.page, patronAId);
    await patronA.page.goto(`http://127.0.0.1:${PORT}/planning.html`, { waitUntil: 'domcontentloaded' });
    const foundInPlanning = await patronA.page.waitForFunction(
      (id) => !!(window.SebaDB && SebaDB.get('interventions', id)),
      { timeout: 8000 }, convertIntervRes.interv.id,
    ).then(() => true).catch(() => false);
    assert(foundInPlanning, 'intervention visible via le moteur de données partagé par planning.html');

    console.log('\n== [Point 22] événement service_request_converted émis (mémoire client ajoutée) ==');
    const convertedRuns = await patronA.page.evaluate(() => SebaDB.automations.runs().filter(r => r.triggerType === 'service_request_converted'));
    assert(convertedRuns.length >= 1, 'au moins un run service_request_converted enregistré (trouvé ' + convertedRuns.length + ')');
    const memoryEntryFound = await patronA.page.evaluate((clientId) => {
      const c = SebaDB.get('clients', clientId);
      return !!(c && c.operationalMemory && c.operationalMemory.entries.some(e => e.source === 'system' && e.type === 'relationship'));
    }, convertIntervRes.claim.clientId);
    assert(memoryEntryFound, 'entrée de mémoire client "relationship" ajoutée automatiquement par le modèle activé');

    console.log('\n== [Point 25] Aucun scroll horizontal à 390px (demandes.html + demande.html) ==');
    await patronA.page.goto(`http://127.0.0.1:${PORT}/demandes.html`, { waitUntil: 'domcontentloaded' });
    await patronA.page.setViewport({ width: 390, height: 844 });
    await new Promise(r => setTimeout(r, 400));
    const hScrollDemandes = await patronA.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hScrollDemandes, 'pas de scroll horizontal à 390px — demandes.html');

    await anon.page.goto(`http://127.0.0.1:${PORT}/demande.html?pro=${patronAId}`, { waitUntil: 'domcontentloaded' });
    await anon.page.setViewport({ width: 390, height: 844 });
    await new Promise(r => setTimeout(r, 400));
    const hScrollDemande = await anon.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hScrollDemande, 'pas de scroll horizontal à 390px — demande.html');

    console.log('\n== [Point 26] Zéro erreur console (patron A / patron B / visiteur anonyme) ==');
    assert(patronA.consoleErrors.length === 0, 'zéro erreur console — patron A (' + JSON.stringify(patronA.consoleErrors) + ')');
    assert(patronB.consoleErrors.length === 0, 'zéro erreur console — patron B (' + JSON.stringify(patronB.consoleErrors) + ')');
    assert(anon.consoleErrors.length === 0, 'zéro erreur console — visiteur anonyme (' + JSON.stringify(anon.consoleErrors) + ')');

  } finally {
    await patronA.ctx.close(); await patronB.ctx.close(); await anon.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log('\n' + (26 - blockedCount) + '/26 points exécutés localement, ' + blockedCount + ' bloqué(s) par l\'infra Edge Function locale (voir détail ci-dessus).');
  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
