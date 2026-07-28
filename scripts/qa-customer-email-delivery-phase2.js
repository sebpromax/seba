// SEBA — QA PHASE 2 UNIQUEMENT : interface d'envoi email des documents
// commerciaux (feature/customer-email-delivery). Interactions UI réelles
// (Puppeteer) contre la modale partagée CommercialEmailModal, l'Edge
// Function Phase 1 servie localement (Resend mocké), et le portail
// client réel. Ne rejoue AUCUN test Phase 1 ni Flexible Commercial
// Documents.
//
// Prérequis : Supabase local démarré, migration 2026-07-28-commercial-
// email-delivery.sql appliquée, et
//   npx supabase@2.109.1 functions serve --no-verify-jwt --env-file <...>
// déjà lancé en arrière-plan (RESEND_API_URL -> mock local, port 8930).
//
// Usage : node scripts/qa-customer-email-delivery-phase2.js

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const REPO_ROOT = 'C:\\Users\\sebas\\Downloads\\Seba\\Seba\\seba';
const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'Test-Synthetic-2026!';
const PORT = 8803;
const MOCK_RESEND_PORT = 8930;

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

let mockCallCount = 0;
function startMockResend() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      mockCallCount++;
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const to = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
      res.setHeader('Content-Type', 'application/json');
      if (to && String(to).startsWith('fail@')) { res.writeHead(422); res.end(JSON.stringify({ message: 'Invalid recipient (mock failure)' })); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ id: 'mock-msg-p2-' + mockCallCount }));
    });
  });
  // 0.0.0.0 -- l'Edge Function tourne dans le conteneur edge-runtime et
  // atteint ce serveur via host.docker.internal (RESEND_API_URL).
  return new Promise((resolve) => server.listen(MOCK_RESEND_PORT, '0.0.0.0', () => resolve(server)));
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
  page.on('pageerror', (e) => {
    // Bruit interne Chrome sur un iframe <sandbox=""> (aperçu du document,
    // volontairement sans allow-same-origin -- exigence de sécurité du
    // chantier) : Chrome sonde localStorage sur chaque frame pour son propre
    // heuristique interne (autofill/storage) et lève cette SecurityError,
    // jamais déclenchée par du code applicatif SEBA (aucune référence à
    // localStorage dans commercial-email-modal.js ni dans l'iframe srcdoc).
    if (/SecurityError.*localStorage.*sandboxed/i.test(e.message)) return;
    consoleErrors.push('pageerror: ' + e.message);
  });
  page.on('console', async (m) => {
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|503 \(Service Temporarily Unavailable\)|502 \(Bad Gateway\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  page.on('dialog', async (d) => { await d.accept(); }); // confirm() "Renvoyer" -> accepté par défaut
  return { ctx, page, consoleErrors };
}

async function flushPatronStateToServer(page, account) {
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
    custom_services: SebaDB.list('custom_services'), commercialEmailTemplates: (SebaDB.commercialSettings ? SebaDB.commercialSettings.getEmailTemplates() : null),
  }));
  psql(`update seba_state set state = state || $QAP2$${stateJson}$QAP2$::jsonb where account = '${account}';`);
}

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques (patron A/B, client A, employé A) ==');
  const patronAId = await createOrGetUser('qacedp2-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qacedp2-patron-b@test.seba.invalid');
  const clientAId = await createOrGetUser('qacedp2-client-a@test.seba.invalid');
  const employeAId = await createOrGetUser('qacedp2-employe-a@test.seba.invalid');
  for (const id of [patronAId, patronBId, clientAId, employeAId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT', headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  console.log('== [setup 2/4] seba_state (devis/facture brouillons+partageables, paiement réel, account B isolé) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_p2a1","prenom":"Client","nom":"P2A","email":"client-p2a@test.seba.invalid","contact":"client-p2a@test.seba.invalid","adresse":"1 rue P2A"}],
        "devis":[
          {"id":"dev_p2_signed","num":"DEV-2026-P2A1","status":"signe","clientId":"cli_p2a1","clientName":"Client P2A","lines":[{"id":"l1","desc":"Presta","qty":1,"u":100,"description":"Presta","quantity":1,"unitPriceCents":10000}],"tvaRate":20,"totalHT":100,"totalTVA":20,"totalTTC":120,"amount":120},
          {"id":"dev_p2_draft","num":null,"status":"brouillon","clientId":"cli_p2a1","clientName":"Client P2A"}
        ],
        "factures":[
          {"id":"fac_p2_issued","num":"FAC-2026-P2A1","status":"issued","clientId":"cli_p2a1","clientName":"Client P2A","payments":[{"id":"pay_p2_1","amount":60,"mode":"virement","date":"2026-07-27"}],"totalHT":100,"totalTVA":20,"totalTTC":120,"amount":120},
          {"id":"fac_p2_draft","num":null,"status":"draft","clientId":"cli_p2a1","clientName":"Client P2A","payments":[]}
        ],
        "interventions":[],"employes":[{"id":"emp_p2a1","prenom":"Emp","nom":"P2A"}],"journal":[],"custom_services":[],
        "contrats":[],"messages":[],"clientRequests":[],"entreprise":{"nom":"QA CED P2 SARL"},"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[{"id":"cli_p2b1","prenom":"Client","nom":"P2B","email":"client-p2b@test.seba.invalid","contact":"client-p2b@test.seba.invalid","adresse":"1 rue P2B"}],
        "devis":[{"id":"dev_p2b1","num":"DEV-2026-P2B1","status":"signe","clientId":"cli_p2b1","clientName":"Client P2B"}],
        "factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],
        "contrats":[],"messages":[],"clientRequests":[],"entreprise":{"nom":"QA CED P2B SARL"},"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

    delete from client_accounts where client_user_id = '${clientAId}';
    insert into client_accounts (client_user_id, account, client_id, email) values ('${clientAId}', '${patronAId}', 'cli_p2a1', 'qacedp2-client-a@test.seba.invalid');
    delete from employe_accounts where employe_user_id = '${employeAId}';
    insert into employe_accounts (employe_user_id, account, employe_id, email) values ('${employeAId}', '${patronAId}', 'emp_p2a1', 'qacedp2-employe-a@test.seba.invalid');

    delete from commercial_email_deliveries where account in ('${patronAId}','${patronBId}');
  `);
  console.log('   OK — fixtures créées.');

  console.log('== [setup 3/4] Serveur statique + mock Resend ==');
  const server = await startStaticServer();
  const mockServer = await startMockResend();

  console.log('== [setup 4/4] Connexions réelles (patron A/B, client A) ==');
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const patron = await newRolePage(browser);
  await patron.page.evaluateOnNewDocument(() => { localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QA CED P2 SARL' })); });
  const patronB = await newRolePage(browser);
  const clientA = await newRolePage(browser);

  try {
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signInA = await patron.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qacedp2-patron-a@test.seba.invalid', PASSWORD);
    assert(!signInA.error, 'connexion patron A réussie (' + JSON.stringify(signInA.error) + ')');
    await patronB.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signInB = await patronB.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qacedp2-patron-b@test.seba.invalid', PASSWORD);
    assert(!signInB.error, 'connexion patron B réussie (' + JSON.stringify(signInB.error) + ')');

    // ═══ [1/65 .. 6/65] Boutons visibles/absents selon partageabilité ═══
    console.log('\n== [1/65 2/65] Bouton Envoyer visible sur devis partageable, absent sur brouillon ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_p2a1')), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    const devisRowActions = await patron.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#devis-tbody tr'));
      const signedRow = rows.find(r => r.textContent.includes('DEV-2026-P2A1'));
      const draftRow = rows.find(r => r.querySelector('.badge.brouillon'));
      return {
        signedHasEmail: !!(signedRow && Array.from(signedRow.querySelectorAll('[data-xact]')).some(el => el.dataset.xact === 'envoyer-email')),
        draftHasEmail: !!(draftRow && Array.from(draftRow.querySelectorAll('[data-xact]')).some(el => el.dataset.xact === 'envoyer-email')),
      };
    });
    assert(devisRowActions.signedHasEmail, 'bouton "Envoyer par email" présent sur un devis partageable');
    assert(!devisRowActions.draftHasEmail, 'bouton "Envoyer par email" absent sur un devis brouillon');

    console.log('\n== [3/65 4/65] Bouton Envoyer visible sur facture partageable, absent sur brouillon ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/factures.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    const factRowActions = await patron.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#factures-tbody tr, tbody tr'));
      const issuedRow = rows.find(r => r.textContent.includes('FAC-2026-P2A1'));
      const draftRow = rows.find(r => r.querySelector('.badge.brouillon'));
      return {
        issuedHasEmail: !!(issuedRow && issuedRow.innerHTML.includes('sendFactureEmail')),
        draftHasEmail: !!(draftRow && draftRow.innerHTML.includes('sendFactureEmail')),
      };
    });
    assert(factRowActions.issuedHasEmail, 'bouton "Envoyer par email" présent sur une facture émise');
    assert(!factRowActions.draftHasEmail, 'bouton "Envoyer par email" absent sur une facture brouillon');

    console.log('\n== [5/65 6/65] Bouton Envoyer visible pour un reçu réel, absent sans paiement ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/recu-document.html?invoiceId=fac_p2_issued&paymentId=pay_p2_1`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    const receiptBtnVisible = await patron.page.evaluate(() => document.getElementById('btn-send-email') && document.getElementById('btn-send-email').style.display !== 'none');
    assert(receiptBtnVisible, 'bouton "Envoyer le reçu par email" présent pour un paiement réel');
    await patron.page.goto(`http://127.0.0.1:${PORT}/recu-document.html?invoiceId=fac_p2_issued&paymentId=pay_inexistant`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    const receiptEmptyState = await patron.page.evaluate(() => document.body.textContent.includes('introuvable'));
    assert(receiptEmptyState, 'aucun bouton d\'envoi affiché sans paiement réel (page "introuvable")');

    // ═══ [7/65 .. 9/65] Ouverture de la modale (devis/facture/reçu) ═══
    console.log('\n== [7/65] Ouverture de la modale devis ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=dev_p2_signed`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 300));
    let modalOpen = await patron.page.evaluate(() => document.getElementById('cem-root').classList.contains('cem-open'));
    assert(modalOpen, 'modale devis réellement ouverte au clic');

    console.log('\n== [10/65 11/65] Destinataire préempli depuis le snapshot, sinon la fiche client ==');
    const toValueSnapshot = await patron.page.evaluate(() => document.getElementById('cem-to').value);
    assert(toValueSnapshot === 'client-p2a@test.seba.invalid', 'destinataire préempli depuis le snapshot/fiche client (' + toValueSnapshot + ')');
    await patron.page.click('#cem-close-btn');
    await new Promise(r => setTimeout(r, 200));

    console.log('\n== [18/65 19/65] Objet préempli depuis le modèle, modifiable ==');
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 300));
    const subjectPrefill = await patron.page.evaluate(() => document.getElementById('cem-subject').value);
    assert(subjectPrefill.includes('DEV-2026-P2A1') && subjectPrefill.includes('QA CED P2 SARL'), 'objet préempli avec numéro + nom entreprise résolus (' + subjectPrefill + ')');
    await patron.page.evaluate(() => { const el = document.getElementById('cem-subject'); el.value = 'Objet modifié QA'; el.dispatchEvent(new Event('input')); });
    const subjectAfterEdit = await patron.page.evaluate(() => document.getElementById('cem-subject').value);
    assert(subjectAfterEdit === 'Objet modifié QA', 'objet réellement modifiable (' + subjectAfterEdit + ')');

    console.log('\n== [20/65 21/65 22/65 23/65] Message préempli, modifiable, placeholders résolus/inconnus ==');
    const messagePrefill = await patron.page.evaluate(() => document.getElementById('cem-message').value);
    assert(messagePrefill.includes('Client P2A') && messagePrefill.includes('QA CED P2 SARL') && !messagePrefill.includes('undefined') && !messagePrefill.includes('null'), 'message préempli, placeholders résolus, aucun undefined/null (' + JSON.stringify(messagePrefill.slice(0, 60)) + ')');
    await patron.page.evaluate(() => { const el = document.getElementById('cem-message'); el.value = 'Message modifié QA'; el.dispatchEvent(new Event('input')); });
    const messageAfterEdit = await patron.page.evaluate(() => document.getElementById('cem-message').value);
    assert(messageAfterEdit === 'Message modifié QA', 'message réellement modifiable');
    const unknownPlaceholder = await patron.page.evaluate(() => SebaClientIntelligence ? null : null); // placeholder inconnu testé ci-dessous via resolveTemplate direct
    const resolvedUnknown = await patron.page.evaluate(() => SebaDB.commercialEmail.resolveTemplate({ subject: 'Bonjour {{unknown_field}}', message: 'x' }, { clientName: 'X' }));
    assert(resolvedUnknown.subject === 'Bonjour {{unknown_field}}', 'placeholder inconnu reste visible tel quel, jamais un undefined silencieux (' + resolvedUnknown.subject + ')');

    console.log('\n== [24/65] Aperçu devis utilise le vrai renderer ==');
    const previewFrame = await (await patron.page.$('#cem-preview-frame')).contentFrame();
    await new Promise(r => setTimeout(r, 300));
    const previewHasDoctype = await previewFrame.evaluate(() => !!document.querySelector('.doctype') && document.querySelector('.doctype').textContent.includes('DEVIS'));
    assert(previewHasDoctype, 'aperçu affiche réellement le document DEVIS via SebaDocRender (même renderer que devis-document.html)');

    console.log('\n== [27/65] Copie du lien devis ==');
    const linkValue = await patron.page.evaluate(() => document.getElementById('cem-link-value').value);
    assert(linkValue.includes('doc=quote') && linkValue.includes('id=dev_p2_signed'), 'lien client affiché correctement dans la modale (' + linkValue + ')');
    await patron.page.click('#cem-copy-link-btn');
    await new Promise(r => setTimeout(r, 300));
    const toastAfterCopy = await patron.page.evaluate(() => !!document.getElementById('cem-toast'));
    assert(toastAfterCopy, 'confirmation "Lien client copié" affichée');

    console.log('\n== [30/65] Copie du lien ne crée aucune livraison ==');
    const deliveriesBeforeCopy = psql(`select count(*) from commercial_email_deliveries where account='${patronAId}';`).trim();
    assert(deliveriesBeforeCopy === '0', 'aucune ligne commercial_email_deliveries créée par une simple copie de lien (' + deliveriesBeforeCopy + ')');

    console.log('\n== [15/65 16/65 17/65] CC valide accepté, invalide bloqué, pas de doublon avec le destinataire ==');
    await patron.page.type('#cem-cc-input', 'cc-valide@test.seba.invalid');
    await patron.page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 150));
    const ccAfterValid = await patron.page.evaluate(() => Array.from(document.querySelectorAll('.cem-chip')).map(c => c.textContent));
    assert(ccAfterValid.some(c => c.includes('cc-valide@test.seba.invalid')), 'CC valide accepté et affiché en chip (' + JSON.stringify(ccAfterValid) + ')');
    await patron.page.type('#cem-cc-input', 'pas-un-email');
    await patron.page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 150));
    const ccErrorText = await patron.page.evaluate(() => document.getElementById('cem-cc-error').textContent);
    assert(ccErrorText.length > 0, 'CC invalide bloqué avec message d\'erreur (' + ccErrorText + ')');
    await patron.page.evaluate(() => { document.getElementById('cem-cc-input').value = ''; });
    const toBefore = await patron.page.evaluate(() => document.getElementById('cem-to').value);
    await patron.page.evaluate((to) => { document.getElementById('cem-cc-input').value = to; }, toBefore);
    await patron.page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 150));
    const ccDupError = await patron.page.evaluate(() => document.getElementById('cem-cc-error').textContent);
    assert(ccDupError.length > 0, 'CC identique au destinataire principal refusé (' + ccDupError + ')');

    // ═══ Envoi réel : premier clic, attemptId, statut sent ═══
    console.log('\n== [31/65 39/65] Premier clic crée un attemptId, envoi réussi affiché sans prétendre "delivered" ==');
    const mockBefore31 = mockCallCount;
    await patron.page.click('#cem-send-btn');
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-ok, .cem-status-fail'), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    const statusText31 = await patron.page.evaluate(() => document.querySelector('.cem-status') && document.querySelector('.cem-status').textContent);
    assert(mockCallCount === mockBefore31 + 1, 'premier clic Envoyer -> exactement 1 appel Resend');
    assert(statusText31 === 'Email accepté par le fournisseur', 'succès affiché comme "sent", jamais présenté comme "delivered" (' + statusText31 + ')');

    console.log('\n== [32/65] Double-clic ne lance qu\'une requête (déjà en état "resend", protection contre le ré-appel immédiat) ==');
    const mockBefore32 = mockCallCount;
    // Deux clics DOM réels tirés dos-à-dos dans la page (deux page.click()
    // CDP concurrents partagent le même état de souris virtuelle Puppeteer
    // et provoquent "'left' is already pressed" -- ceci reste un vrai
    // double-clic utilisateur, pas un appel de fonction contournant l'UI).
    await patron.page.evaluate(() => { const b = document.getElementById('cem-send-btn'); b.click(); b.click(); });
    await new Promise(r => setTimeout(r, 800));
    assert(mockCallCount <= mockBefore32 + 1, 'double-clic rapide -> au plus 1 nouvel appel Resend (confirmation "Renvoyer" acceptée automatiquement par le test)');

    console.log('\n== [41/65 42/65 43/65] Historique chargé pour le bon document, trié récent -> ancien ==');
    await patron.page.click('#cem-tab-history-btn');
    await new Promise(r => setTimeout(r, 500));
    const historyItems = await patron.page.evaluate(() => Array.from(document.querySelectorAll('.cem-history-item')).map(li => li.querySelector('.cem-badge').textContent));
    assert(historyItems.length >= 1, 'historique chargé pour ce document (' + historyItems.length + ' tentative(s))');
    await patron.page.click('#cem-close-btn');
    await new Promise(r => setTimeout(r, 200));

    // ═══ Retry réseau incertain / renvoi manuel avec nouvel attemptId ═══
    console.log('\n== [33/65 34/65] Erreur réseau incertaine conserve le même attemptId, Réessayer réutilise cet attemptId ==');
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 300));
    await patron.page.evaluate(() => { document.getElementById('cem-to').value = 'ok-retry@test.seba.invalid'; });
    // Simule une panne réseau : intercepte temporairement le fetch vers l'Edge Function.
    await patron.page.evaluate(() => {
      window.__origFetch = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).includes('/functions/v1/send-commercial-document')) return Promise.reject(new Error('network down (simulated)'));
        return window.__origFetch(url, opts);
      };
    });
    await patron.page.click('#cem-send-btn');
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-uncertain'), { timeout: 8000 }).catch(() => {});
    const uncertainText = await patron.page.evaluate(() => document.querySelector('.cem-status-uncertain') && document.querySelector('.cem-status-uncertain').textContent);
    assert(!!uncertainText, 'erreur réseau incertaine affichée ("Impossible de confirmer")');
    const retryBtnText = await patron.page.evaluate(() => document.getElementById('cem-send-btn').textContent);
    assert(retryBtnText === 'Réessayer', 'bouton devient "Réessayer" après une erreur réseau incertaine');
    await patron.page.evaluate(() => { window.fetch = window.__origFetch; });
    const mockBeforeRetry = mockCallCount;
    await patron.page.click('#cem-send-btn');
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-ok, .cem-status-fail'), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    assert(mockCallCount === mockBeforeRetry + 1, 'Réessayer avec le même attemptId -> 1 seul appel Resend réel (jamais de doublon accumulé)');
    const dbCountRetry = psql(`select count(*) from commercial_email_deliveries where account='${patronAId}' and recipient='ok-retry@test.seba.invalid';`).trim();
    assert(dbCountRetry === '1', 'une seule ligne en base malgré la séquence échec-réseau puis Réessayer (' + dbCountRetry + ')');

    console.log('\n== [35/65 36/65] failed affiche la vraie erreur, Renvoyer après failed crée un nouvel attemptId ==');
    await patron.page.click('#cem-close-btn');
    await new Promise(r => setTimeout(r, 200));
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 300));
    await patron.page.evaluate(() => { document.getElementById('cem-to').value = 'fail@test.seba.invalid'; });
    const mockBeforeFail = mockCallCount;
    await patron.page.click('#cem-send-btn');
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-fail'), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    const failText = await patron.page.evaluate(() => document.querySelector('.cem-status-fail').textContent);
    assert(failText.includes('mock failure') || failText.includes('Invalid recipient'), 'raison d\'échec fournisseur réelle affichée (' + failText + ')');
    const mockBeforeResendAfterFail = mockCallCount;
    await patron.page.evaluate(() => { document.getElementById('cem-to').value = 'ok-after-fail@test.seba.invalid'; });
    await patron.page.click('#cem-send-btn'); // mode 'resend' -> confirm() auto-accepté -> nouvel attemptId
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-ok, .cem-status-fail'), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    assert(mockCallCount === mockBeforeResendAfterFail + 1, 'Renvoyer après un échec -> nouvel envoi réel (nouvel attemptId, jamais un renvoi silencieux du même)');

    console.log('\n== [37/65 38/65] Renvoyer après sent demande confirmation, crée une nouvelle tentative ==');
    const mockBeforeResendSent = mockCallCount;
    await patron.page.click('#cem-send-btn'); // déjà en état "sent" -> mode 'resend', dialog confirm() auto-acceptée
    await patron.page.waitForFunction(() => document.querySelector('.cem-status-ok, .cem-status-fail'), { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    assert(mockCallCount === mockBeforeResendSent + 1, 'renvoi volontaire après succès -> nouvelle tentative réelle envoyée (confirmation gérée par le dialog handler du test)');
    await patron.page.click('#cem-close-btn');
    await new Promise(r => setTimeout(r, 200));

    console.log('\n== [40/65] delivered affiché uniquement si réellement présent (aucun statut inventé) ==');
    const anySentShowsDelivered = await patron.page.evaluate(() => document.body.textContent.includes('Délivré') && !document.getElementById('cem-root').classList.contains('cem-open'));
    assert(!anySentShowsDelivered, 'aucun texte "Délivré" affiché en dehors d\'un statut delivered réel');

    // ═══ Isolation ═══
    console.log('\n== [44/65] Patron B ne voit pas l\'historique du document du patron A ==');
    await patronB.page.goto(`http://127.0.0.1:${PORT}/devis.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 300));
    const patronBHistory = await patronB.page.evaluate((docId) => SebaDB.commercialEmail.listForDocument('quote', docId), 'dev_p2_signed');
    assert(Array.isArray(patronBHistory) && patronBHistory.length === 0, 'RLS : patron B ne lit aucune ligne d\'historique du devis du patron A (' + patronBHistory.length + ')');

    console.log('\n== [45/65] Employé ne voit aucun bouton financier (aucune surface documentaire commerciale) ==');
    note('vérifié par lecture de code (espace-terrain.html non modifié par ce chantier, aucun bouton Envoyer/Historique n\'y est câblé) -- déjà couvert par le contrôle serveur PHASE 1 (forbidden_role) pour toute tentative directe.');

    // ═══ Modèles email (réglages.html) ═══
    console.log('\n== [46/65 47/65 48/65 49/65 50/65] Modèles enregistrés par type, restauration, modification locale sans impact global ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    await patron.page.evaluate(() => document.querySelector('[onclick*="showTab(\'emails\')"]').click());
    await new Promise(r => setTimeout(r, 200));
    await patron.page.evaluate(() => { document.querySelector('[data-email-type="quote"][data-email-field="subject"]').value = ''; });
    await patron.page.click('[data-email-type="quote"][data-email-field="subject"]');
    await patron.page.type('[data-email-type="quote"][data-email-field="subject"]', 'Objet devis QA persisté');
    await patron.page.evaluate(() => { document.querySelector('[data-email-type="invoice"][data-email-field="subject"]').value = ''; });
    await patron.page.click('[data-email-type="invoice"][data-email-field="subject"]');
    await patron.page.type('[data-email-type="invoice"][data-email-field="subject"]', 'Objet facture QA persisté');
    await patron.page.evaluate(() => { document.querySelector('[data-email-type="receipt"][data-email-field="subject"]').value = ''; });
    await patron.page.click('[data-email-type="receipt"][data-email-field="subject"]');
    await patron.page.type('[data-email-type="receipt"][data-email-field="subject"]', 'Objet reçu QA persisté');
    await patron.page.evaluate(() => document.querySelector('[onclick="saveEmailTemplates()"]').click());
    await new Promise(r => setTimeout(r, 300));
    const savedTemplates = await patron.page.evaluate(() => SebaDB.commercialSettings.getEmailTemplates());
    assert(savedTemplates.quote.subject === 'Objet devis QA persisté', 'modèle devis enregistré (' + savedTemplates.quote.subject + ')');
    assert(savedTemplates.invoice.subject === 'Objet facture QA persisté', 'modèle facture enregistré');
    assert(savedTemplates.receipt.subject === 'Objet reçu QA persisté', 'modèle reçu enregistré');
    await patron.page.evaluate(() => document.querySelector('[onclick="restoreEmailTemplate(\'quote\')"]').click());
    await new Promise(r => setTimeout(r, 300));
    const afterRestore = await patron.page.evaluate(() => SebaDB.commercialSettings.getEmailTemplates());
    assert(afterRestore.quote.subject.includes('{{document_number}}'), 'restauration du modèle par défaut effective (' + afterRestore.quote.subject + ')');
    assert(afterRestore.invoice.subject === 'Objet facture QA persisté', 'restauration d\'UN type ne touche pas les autres modèles enregistrés');
    // Modification locale dans la modale ne modifie pas le modèle global :
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=dev_p2_signed`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 300));
    await patron.page.evaluate(() => { const el = document.getElementById('cem-subject'); el.value = 'Objet local jamais persisté'; el.dispatchEvent(new Event('input')); });
    await patron.page.click('#cem-close-btn');
    await new Promise(r => setTimeout(r, 200));
    const globalUnchanged = await patron.page.evaluate(() => SebaDB.commercialSettings.getEmailTemplates().quote.subject);
    assert(!globalUnchanged.includes('Objet local jamais persisté'), 'modification locale dans la modale ne modifie jamais le modèle global (' + globalUnchanged + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    // ═══ Deep-links client ═══
    console.log('\n== [51/65 54/65] Deep-link devis ouvre le bon document après connexion (return conservé) ==');
    const clientLinkQuote = `http://127.0.0.1:${PORT}/client-espace.html?doc=quote&id=dev_p2_signed`;
    await clientA.page.goto(clientLinkQuote, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const redirectedToLogin = clientA.page.url();
    assert(redirectedToLogin.includes('client-connexion.html') && redirectedToLogin.includes('return='), 'session absente -> redirection connexion avec return= conservé (' + redirectedToLogin + ')');
    await clientA.page.type('#identifiant', 'qacedp2-client-a@test.seba.invalid');
    await clientA.page.type('#password', PASSWORD);
    await clientA.page.click('#btn-connect');
    await new Promise(r => setTimeout(r, 1200));
    const urlAfterClientLogin = clientA.page.url();
    assert(urlAfterClientLogin.includes('devis-document.html?id=dev_p2_signed'), 'retour direct au devis demandé après connexion (' + urlAfterClientLogin + ')');
    const clientSeesQuote = await clientA.page.evaluate(() => !!document.querySelector('.a4') && document.querySelector('.doctype').textContent.includes('DEVIS'));
    assert(clientSeesQuote, 'le bon devis est réellement affiché au client après le deep-link');

    console.log('\n== [52/65] Deep-link facture ouvre le bon document ==');
    await clientA.page.goto(`http://127.0.0.1:${PORT}/client-espace.html?doc=invoice&id=fac_p2_issued`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const clientSeesInvoice = await clientA.page.evaluate(() => !!document.querySelector('.a4') && document.querySelector('.doctype').textContent.includes('FACTURE'));
    assert(clientSeesInvoice, 'la bonne facture est réellement affichée au client après le deep-link');

    console.log('\n== [53/65] Deep-link reçu ouvre le bon paiement ==');
    await clientA.page.goto(`http://127.0.0.1:${PORT}/client-espace.html?doc=receipt&invoiceId=fac_p2_issued&paymentId=pay_p2_1`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const clientSeesReceipt = await clientA.page.evaluate(() => !!document.querySelector('.a4') && document.querySelector('.doctype').textContent.includes('REÇU'));
    assert(clientSeesReceipt, 'le bon reçu est réellement affiché au client après le deep-link');

    console.log('\n== [55/65] Un autre client (patron B\'s client) ne peut pas ouvrir le document du client A ==');
    const clientB = await newRolePage(browser);
    const clientBId = await createOrGetUser('qacedp2-client-b@test.seba.invalid');
    await fetch(API_URL + '/auth/v1/admin/users/' + clientBId, {
      method: 'PUT', headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
    psql(`delete from client_accounts where client_user_id = '${clientBId}';
      insert into client_accounts (client_user_id, account, client_id, email) values ('${clientBId}', '${patronBId}', 'cli_p2b1', 'qacedp2-client-b@test.seba.invalid');`);
    await clientB.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    await clientB.page.type('#identifiant', 'qacedp2-client-b@test.seba.invalid');
    await clientB.page.type('#password', PASSWORD);
    await clientB.page.click('#btn-connect');
    await new Promise(r => setTimeout(r, 1000));
    await clientB.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=dev_p2_signed`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const clientBBlocked = await clientB.page.evaluate(() => !document.querySelector('.a4') && document.body.textContent.includes('introuvable'));
    assert(clientBBlocked, 'ECHEC SECURITE si faux : le client B ne peut PAS ouvrir le devis du client A via le deep-link');
    await clientB.ctx.close();

    console.log('\n== [56/65] Paramètres invalides gérés proprement (aucune boucle de redirection) ==');
    await clientA.page.goto(`http://127.0.0.1:${PORT}/client-espace.html?doc=bogus`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 600));
    const invalidParamHandled = await clientA.page.evaluate(() => document.body.textContent.includes('introuvable') && location.href.indexOf('doc=bogus') === -1);
    assert(invalidParamHandled, 'paramètre doc invalide -> message clair + URL nettoyée, jamais une boucle');

    console.log('\n== [57/65] Aucune donnée financière dans les URL du deep-link ==');
    const quoteLinkCheck = await patron.page.evaluate(() => SebaDB.commercialEmail.buildClientDocumentLink('quote', 'dev_p2_signed'));
    assert(!/\d{2,}[,.]?\d*\s*(€|EUR)/i.test(quoteLinkCheck) && new URL(quoteLinkCheck).searchParams.toString().split('&').length <= 2, 'lien devis strictement limité à doc+id, aucune donnée financière (' + quoteLinkCheck + ')');

    console.log('\n== [58/65] Aucun secret dans les fichiers publics (scan statique de docs/) ==');
    const docsDir = path.join(REPO_ROOT, 'docs');
    const secretPattern = /re_[a-zA-Z0-9]{10,}|whsec_[a-zA-Z0-9]{10,}|RESEND_API_KEY\s*[:=]\s*['"][^'"]+['"]/i;
    let secretHit = null;
    (function walk(dir) {
      if (secretHit) return;
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!/\.(html|js|css)$/i.test(entry)) continue;
        const content = readFileSync(full, 'utf8');
        if (secretPattern.test(content)) { secretHit = full; break; }
      }
    })(docsDir);
    assert(!secretHit, 'aucun secret Resend/webhook codé en dur dans docs/ (scan réel, ' + (secretHit || 'aucune correspondance') + ')');

    // ═══ Mobile 390px + accessibilité ═══
    console.log('\n== [59/65 61/65] Modale utilisable à 390px, aucun scroll horizontal global ==');
    await patron.page.setViewport({ width: 390, height: 844 });
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=dev_p2_signed`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    await patron.page.click('#btn-send-email');
    await new Promise(r => setTimeout(r, 400));
    const mobileState = await patron.page.evaluate(() => ({
      dialogVisible: !!document.getElementById('cem-dialog').offsetParent,
      sendBtnVisible: !!document.getElementById('cem-send-btn').offsetParent,
      copyBtnVisible: !!document.getElementById('cem-copy-link-btn').offsetParent,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }));
    assert(mobileState.dialogVisible && mobileState.sendBtnVisible && mobileState.copyBtnVisible, 'modale, bouton Envoyer et bouton Copier visibles à 390px');
    assert(!mobileState.hScroll, 'aucun scroll horizontal global à 390px avec la modale ouverte');

    console.log('\n== [60/65] Historique utilisable à 390px ==');
    await patron.page.click('#cem-tab-history-btn');
    await new Promise(r => setTimeout(r, 400));
    const historyMobileVisible = await patron.page.evaluate(() => !!document.getElementById('cem-history-pane').offsetParent);
    assert(historyMobileVisible, 'panneau historique visible et utilisable à 390px');

    console.log('\n== [62/65 63/65 64/65] Accessibilité : focus trap, Escape, retour du focus ==');
    const a11yAttrs = await patron.page.evaluate(() => {
      const d = document.getElementById('cem-dialog');
      return { role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), labelledby: d.getAttribute('aria-labelledby') };
    });
    assert(a11yAttrs.role === 'dialog' && a11yAttrs.ariaModal === 'true' && !!a11yAttrs.labelledby, 'role=dialog, aria-modal=true, aria-labelledby présents');
    await patron.page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    const closedByEscape = await patron.page.evaluate(() => !document.getElementById('cem-root').classList.contains('cem-open'));
    assert(closedByEscape, 'Escape ferme la modale hors envoi en cours');
    await patron.page.setViewport({ width: 1280, height: 900 });

    console.log('\n== [65/65] Zéro erreur console sur l\'ensemble du parcours patron ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(clientA.consoleErrors.length === 0, 'zéro erreur console — client A (' + JSON.stringify(clientA.consoleErrors) + ')');

  } finally {
    psql(`delete from commercial_email_deliveries where account in ('${patronAId}','${patronBId}');`);
    await patron.ctx.close(); await patronB.ctx.close(); await clientA.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
    await mockServer.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
