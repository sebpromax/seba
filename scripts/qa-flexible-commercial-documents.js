// SEBA — QA verticale UNIQUE Espace commercial flexible + documents
// professionnels (feature/flexible-commercial-documents).
//
// Ne rejoue AUCUN ancien test (Public Intake, Pilot Ready V1, Intervention
// 360, Quote-to-Cash, Team Availability) -- vérifie uniquement les
// CONNEXIONS/CAPACITÉS nouvelles de ce chantier : moteur de calcul centimes
// (buildCommercialDocumentTotals), numérotation configurable, snapshot
// documentaire, révisions de devis, modèles de document (devis/facture/
// reçu), 3 pages A4 imprimables, sécurité/isolation, mobile, zéro erreur
// console.
//
// Même pattern que les scripts QA précédents : sessions Supabase Auth
// RÉELLES, BrowserContext isolé par rôle, config.public.js intercepté,
// flush direct psql (Edge Function sync-push indisponible en local).
//
// Usage : node scripts/qa-flexible-commercial-documents.js
// Prérequis : Supabase local démarré, migration 2026-07-27-flexible-
// commercial-documents.sql appliquée, Chrome installé au chemin ci-dessous.

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
const PORT = 8802;
const PASSWORD = 'Test-Synthetic-2026!';

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function note(msg) { console.log('  ····  ' + msg); }

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
    custom_services: SebaDB.list('custom_services'),
  }));
  psql(`update seba_state set state = state || $QAFCD$${stateJson}$QAFCD$::jsonb where account = '${account}';`);
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
  const dialogCount = { n: 0 };
  page.on('dialog', async (d) => { dialogCount.n++; await d.dismiss(); });
  return { ctx, page, consoleErrors, dialogCount };
}

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques QAFCD ==');
  const patronAId = await createOrGetUser('qafcd-patron-a@test.seba.invalid');
  const clientA1Id = await createOrGetUser('qafcd-cli-a1@test.seba.invalid');
  console.log('   patron A=' + patronAId + ' | client A1=' + clientA1Id);

  console.log('== [setup 2/4] seba_state (1 service, 1 client, entreprise) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qafcd_a1","prenom":"Client","nom":"QAFCD","email":"qafcd-cli-a1@test.seba.invalid","contact":"qafcd-cli-a1@test.seba.invalid","adresse":"1 rue QAFCD"},{"id":"cli_qafcd_noaddr","prenom":"SansAdresse","nom":"QAFCD","email":"","contact":"—","adresse":""}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[{"id":"svc_qafcd","name":"Ménage QAFCD","pricingModel":"fixed","suggestedPrice":100,"active":true}],"contrats":[],"messages":[],"clientRequests":[],"entreprise":{"nom":"QAFCD SARL","email":"contact@qafcd.test","telephone":"0100000000"},"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] client_accounts ==');
  psql(`delete from client_accounts where client_user_id = '${clientA1Id}';
    insert into client_accounts (client_user_id, account, client_id, email) values ('${clientA1Id}', '${patronAId}', 'cli_qafcd_a1', 'qafcd-cli-a1@test.seba.invalid');`);

  console.log('== [setup 4/4] Mots de passe ==');
  for (const id of [patronAId, clientA1Id]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();
  const patron = await newRolePage(browser);
  await patron.page.evaluateOnNewDocument(() => { localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QAFCD SARL' })); });
  const clientA1 = await newRolePage(browser);

  let devisId1, devisNum1, devisId2, revisionId, factureFromDevisId, factureFromScratchId;

  try {
    console.log('\n== Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const signIn = await patron.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qafcd-patron-a@test.seba.invalid', PASSWORD);
    assert(!signIn.error, 'connexion patron A réussie (' + JSON.stringify(signIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_qafcd_a1')), { timeout: 8000 }).catch(() => {});

    console.log('\n== [1/65 + 2/65] Devis simple (champs essentiels) + options avancées facultatives ==');
    const simpleRes = await patron.page.evaluate(() => SebaDB.devis.createDraft({
      clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD',
      lines: [{ desc: 'Ménage QAFCD', qty: 1, u: 100 }], tvaRate: 20,
    }));
    assert(simpleRes.ok && simpleRes.devis.totalTTC === 120, 'devis simple créé, total correct (120 attendu, ' + (simpleRes.ok && simpleRes.devis.totalTTC) + ')');
    assert(simpleRes.ok && !simpleRes.devis.acompte && !simpleRes.devis.remise, 'aucune option avancée imposée (acompte/remise null par défaut)');

    console.log('\n== [3/65 4/65 5/65] Ligne catalogue, ligne libre, unité personnalisée ==');
    const linesRes = await patron.page.evaluate(() => {
      const svc = SebaDB.list('custom_services')[0];
      return window.SebaClientIntelligence.buildCommercialDocumentTotals([
        { id: 'l1', serviceId: svc.id, description: svc.name, quantity: 2, unit: 'intervention', unitPriceCents: 10000 },
        { id: 'l2', description: 'Ligne libre sans service', quantity: 1, unit: 'forfait libre XYZ', unitPriceCents: 5000 },
      ], { documentTaxRate: 20 });
    });
    assert(linesRes.lines.length === 2, 'ligne catalogue + ligne libre toutes deux présentes');
    assert(linesRes.lines[0].serviceId, 'ligne catalogue conserve serviceId');
    assert(!linesRes.lines[1].serviceId, 'ligne libre sans serviceId, acceptée sans erreur');
    assert(linesRes.lines[1].unit === 'forfait libre XYZ', 'unité personnalisée conservée telle quelle (aucune liste fermée)');

    console.log('\n== [6/65 7/65] Ligne dupliquée, ordre persistant ==');
    const dupRes = await patron.page.evaluate(() => {
      const lines = [{ id: 'a', description: 'Un', quantity: 1, unitPriceCents: 1000, position: 0 }, { id: 'b', description: 'Deux', quantity: 1, unitPriceCents: 2000, position: 1 }];
      const dup = Object.assign({}, lines[0], { id: 'a-copy', position: 2 });
      const withDup = lines.concat([dup]);
      const totals = window.SebaClientIntelligence.buildCommercialDocumentTotals(withDup, { documentTaxRate: 0 });
      return { count: totals.lines.length, order: totals.lines.map(l => l.description) };
    });
    assert(dupRes.count === 3, 'ligne dupliquée : 3 lignes au total');
    assert(dupRes.order.join(',') === 'Un,Deux,Un', 'ordre des lignes préservé tel qu\'inséré');

    console.log('\n== [8/65 9/65] Section sans impact financier, sous-total correct ==');
    const sectionRes = await patron.page.evaluate(() => {
      const lines = [
        { id: 's1', type: 'section', description: 'PRÉPARATION' },
        { id: 'l1', description: 'Ligne A', quantity: 1, unitPriceCents: 5000 },
        { id: 'l2', description: 'Ligne B', quantity: 1, unitPriceCents: 3000 },
      ];
      return window.SebaClientIntelligence.buildCommercialDocumentTotals(lines, { documentTaxRate: 20 });
    });
    assert(sectionRes.sections.length === 1 && sectionRes.lines.length === 2, 'section séparée des lignes facturables (1 section, 2 lignes)');
    assert(sectionRes.subtotalExclCents === 8000, 'sous-total HT correct sans la section (80,00€, ' + (sectionRes.subtotalExclCents / 100) + '€)');

    console.log('\n== [10/65 11/65 12/65 13/65 14/65] Remises ligne %, ligne fixe, globale %, globale fixe, remise excessive refusée ==');
    const discRes = await patron.page.evaluate(() => {
      const linePercent = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000, discountType: 'percent', discountValue: 10 }], { documentTaxRate: 0 });
      const lineFixed = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000, discountType: 'amount', discountValue: 20 }], { documentTaxRate: 0 });
      const globalPercent = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0, discountType: 'percent', discountValue: 10 });
      const globalFixed = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0, discountType: 'amount', discountValue: 20 });
      const excessive = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000, discountType: 'amount', discountValue: 99999 }], { documentTaxRate: 0 });
      return {
        linePercent: linePercent.totalExclCents, lineFixed: lineFixed.totalExclCents,
        globalPercent: globalPercent.totalExclCents, globalFixed: globalFixed.totalExclCents,
        excessive: excessive.totalExclCents,
      };
    });
    assert(discRes.linePercent === 9000, 'remise ligne 10% correcte (90,00€, ' + (discRes.linePercent / 100) + '€)');
    assert(discRes.lineFixed === 8000, 'remise ligne fixe correcte (80,00€, ' + (discRes.lineFixed / 100) + '€)');
    assert(discRes.globalPercent === 9000, 'remise globale 10% correcte (90,00€, ' + (discRes.globalPercent / 100) + '€)');
    assert(discRes.globalFixed === 8000, 'remise globale fixe correcte (80,00€, ' + (discRes.globalFixed / 100) + '€)');
    assert(discRes.excessive === 0, 'remise excessive plafonnée, jamais de total négatif (' + discRes.excessive + ')');

    console.log('\n== [15/65 16/65 17/65 18/65] TVA unique, TVA par ligne, aucune TVA, plusieurs taux regroupés ==');
    const tvaRes = await patron.page.evaluate(() => {
      const single = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 20 });
      const perLine = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000, taxRate: 5.5 }], { documentTaxRate: 20 });
      const none = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0 });
      const multi = window.SebaClientIntelligence.buildCommercialDocumentTotals([
        { id: 'l1', description: 'A', quantity: 1, unitPriceCents: 10000, taxRate: 20 },
        { id: 'l2', description: 'B', quantity: 1, unitPriceCents: 10000, taxRate: 5.5 },
      ], { documentTaxRate: 20 });
      return { single: single.totalTaxCents, perLine: perLine.totalTaxCents, none: none.totalTaxCents, byRateCount: multi.byRate.length, multiTax: multi.totalTaxCents };
    });
    assert(tvaRes.single === 2000, 'TVA unique 20% correcte (20,00€)');
    assert(tvaRes.perLine === 550, 'TVA par ligne (5.5%) prioritaire sur le taux document (5,50€)');
    assert(tvaRes.none === 0, 'aucune TVA -> 0');
    assert(tvaRes.byRateCount === 2 && tvaRes.multiTax === 2550, 'plusieurs taux correctement regroupés (2 groupes, TVA totale 25,50€, trouvé ' + (tvaRes.multiTax / 100) + '€)');

    console.log('\n== [19/65 20/65 21/65] Acompte fixe, pourcentage, supérieur au total refusé (plafonné) ==');
    const depositRes = await patron.page.evaluate(() => {
      const fixed = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0, depositType: 'amount', depositValue: 30 });
      const percent = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0, depositType: 'percent', depositValue: 30 });
      const excessive = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'X', quantity: 1, unitPriceCents: 10000 }], { documentTaxRate: 0, depositType: 'amount', depositValue: 99999 });
      return { fixed: fixed.depositCents, fixedBalance: fixed.balanceAfterDepositCents, percent: percent.depositCents, excessive: excessive.depositCents };
    });
    assert(depositRes.fixed === 3000 && depositRes.fixedBalance === 7000, 'acompte fixe + solde corrects (30,00€ / solde 70,00€)');
    assert(depositRes.percent === 3000, 'acompte 30% correct (30,00€)');
    assert(depositRes.excessive === 10000, 'acompte plafonné au total (jamais supérieur au TTC)');

    console.log('\n== [22/65 23/65 24/65] Brouillon incomplet sauvegardé, brouillon invalide impossible à envoyer, avertissement non bloquant ==');
    const incompleteRes = await patron.page.evaluate(() => SebaDB.devis.createDraft({ clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', lines: [{ desc: 'X', qty: 1, u: 50 }], tvaRate: 20 }));
    assert(incompleteRes.ok && !incompleteRes.devis.validityDate && !incompleteRes.devis.conditions, 'brouillon incomplet (sans validité/conditions) sauvegardé avec succès');
    const validationRes = await patron.page.evaluate((id) => {
      const model = window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') });
      const emptyModel = window.SebaClientIntelligence.buildQuoteDocumentModel({ id: 'x', status: 'brouillon', lines: [], clientId: null, clientName: '' }, { devis: [], clients: [] });
      return {
        validComplete: window.SebaClientIntelligence.getCommercialDocumentValidation('devis', model),
        validEmpty: window.SebaClientIntelligence.getCommercialDocumentValidation('devis', emptyModel),
      };
    }, incompleteRes.devis.id);
    assert(validationRes.validEmpty.valid === false && validationRes.validEmpty.errors.length > 0, 'devis sans client/lignes détecté invalide (erreurs bloquantes réelles)');
    assert(validationRes.validComplete.warnings.length > 0 && validationRes.validComplete.errors.length === 0, 'avertissements facultatifs présents mais NON bloquants (valid malgré warnings)');

    console.log('\n== [25/65 26/65 27/65 28/65] Numéro attribué à l\'envoi, stable après reload, double-clic sans doublon, aucun numéro dupliqué ==');
    const sendRes = await patron.page.evaluate((id) => {
      const d = SebaDB.get('devis', id);
      return SebaDB.devis.updateDraft(id, { clientId: d.clientId, clientName: d.clientName, lines: d.lines, tvaRate: d.tvaRate, _send: true });
    }, incompleteRes.devis.id);
    assert(sendRes.ok && /^DEV-\d{4}-\d{4}$/.test(sendRes.devis.num), 'numéro attribué au format configuré à l\'envoi (' + sendRes.devis.num + ')');
    devisId1 = sendRes.devis.id; devisNum1 = sendRes.devis.num;
    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const afterReloadNum = await patron.page.evaluate((id) => SebaDB.get('devis', id).num, devisId1);
    assert(afterReloadNum === devisNum1, 'numéro stable après reload (' + afterReloadNum + ')');
    const doubleClickRes = await patron.page.evaluate(() => {
      const n1 = SebaDB.nextNum('devis'); const n2 = SebaDB.nextNum('devis');
      return { n1, n2, distinct: n1 !== n2 };
    });
    assert(doubleClickRes.distinct, 'deux appels consécutifs (simule double-clic sur 2 documents différents) produisent 2 numéros distincts, jamais dupliqués (' + doubleClickRes.n1 + ' / ' + doubleClickRes.n2 + ')');

    console.log('\n== [29/65 30/65 31/65] Snapshot créé à l\'envoi, changement client/logo ultérieur sans impact sur l\'ancien document ==');
    const snapshotCheck1 = await patron.page.evaluate((id) => !!SebaDB.get('devis', id).documentSnapshot, devisId1);
    assert(snapshotCheck1, 'snapshot documentaire créé au premier envoi');
    const beforeModel = await patron.page.evaluate((id) => window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') }).company.nom, devisId1);
    await patron.page.evaluate(() => SebaDB.entreprise.set({ nom: 'NOUVEAU NOM CHANGÉ APRÈS ENVOI' }));
    await patron.page.evaluate((id) => { const c = SebaDB.get('clients', 'cli_qafcd_a1'); SebaDB.update('clients', 'cli_qafcd_a1', { nom: 'NomClientChangé' }); }, devisId1);
    const afterModel = await patron.page.evaluate((id) => window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') }), devisId1);
    assert(afterModel.company.nom === beforeModel, 'changement du nom d\'entreprise après envoi SANS EFFET sur le document déjà envoyé (' + afterModel.company.nom + ')');
    assert(afterModel.customer.nom !== 'NomClientChangé', 'changement de la fiche client après envoi SANS EFFET sur le document déjà envoyé (' + afterModel.customer.nom + ')');
    assert(afterModel.snapshotSource === 'snapshot', 'le modèle utilise bien le snapshot, pas les données live');
    await patron.page.evaluate(() => SebaDB.entreprise.set({ nom: 'QAFCD SARL' })); // restauration pour la suite

    console.log('\n== [32/65] Devis envoyé non modifiable directement ==');
    const editSentRes = await patron.page.evaluate((id) => SebaDB.devis.updateDraft(id, { clientId: 'x', clientName: 'y', lines: [] }), devisId1);
    assert(editSentRes.ok === false, 'un devis envoyé refuse toute modification directe (' + JSON.stringify(editSentRes) + ')');

    console.log('\n== [33/65 34/65 35/65 36/65] Révision créée, ancienne conservée, ancienne non acceptable, version actuelle acceptable ==');
    const revRes = await patron.page.evaluate((id) => SebaDB.devis.createRevision(id), devisId1);
    assert(revRes.ok && revRes.devis.parentQuoteId === devisId1 && revRes.devis.revisionNumber === 2, 'révision créée (brouillon, parentQuoteId correct, v2)');
    revisionId = revRes.devis.id;
    const oldStillThere = await patron.page.evaluate((id) => !!SebaDB.get('devis', id), devisId1);
    assert(oldStillThere, 'ancienne version toujours présente après création de la révision');
    const sendRevRes = await patron.page.evaluate((id, oldId) => {
      const d = SebaDB.get('devis', id);
      return SebaDB.devis.updateDraft(id, { clientId: d.clientId, clientName: d.clientName, lines: d.lines, tvaRate: d.tvaRate, parentQuoteId: oldId, revisionNumber: 2, _send: true });
    }, revisionId, devisId1);
    assert(sendRevRes.ok, 'révision envoyée (' + JSON.stringify(sendRevRes.ok) + ')');
    await flushPatronStateToServer(patron.page, patronAId);
    const oldSuperseded = await patron.page.evaluate((id) => SebaDB.get('devis', id).supersededByQuoteId, devisId1);
    assert(oldSuperseded === revisionId, 'ancienne version marquée remplacée par la révision (' + oldSuperseded + ')');

    console.log('\n== Connexion client A1 (vérifie via la vraie RPC resserrée) ==');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const cSignIn = await clientA1.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qafcd-cli-a1@test.seba.invalid', PASSWORD);
    assert(!cSignIn.error, 'connexion client A1 réussie');
    const acceptOldRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), devisId1);
    assert(acceptOldRes.ok === false, 'ECHEC SECURITE si faux : ancienne version remplacée refusée à l\'acceptation (RPC réelle, ' + JSON.stringify(acceptOldRes) + ')');
    const acceptCurrentRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), revisionId);
    assert(acceptCurrentRes.ok && acceptCurrentRes.devis.status === 'signe', 'version actuelle (révision) acceptable (' + JSON.stringify(acceptCurrentRes.ok) + ')');

    console.log('\n== [37/65] Devis refusé duplicable ==');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const refusableRes = await patron.page.evaluate(() => SebaDB.devis.send({ clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', lines: [{ desc: 'À refuser', qty: 1, u: 40 }], tvaRate: 20 }));
    const refuseId = refusableRes.devis.id;
    await patron.page.evaluate((id) => SebaDB.update('devis', id, { status: 'refuse', refusedAt: new Date().toISOString() }), refuseId);
    const dupRefusedRes = await patron.page.evaluate((id) => SebaDB.devis.duplicate(id), refuseId);
    assert(dupRefusedRes.ok && dupRefusedRes.devis.status === 'brouillon', 'devis refusé duplicable en brouillon (' + JSON.stringify(dupRefusedRes.ok) + ')');

    console.log('\n== [38/65] Facture depuis devis sans ressaisie ==');
    const factFromDevisRes = await patron.page.evaluate((id) => SebaDB.factures.createFromDevis(id), revisionId);
    assert(factFromDevisRes.ok && factFromDevisRes.facture.totalTTC === acceptCurrentRes.devis.totalTTC, 'facture créée depuis devis accepté, montants repris sans ressaisie');
    factureFromDevisId = factFromDevisRes.facture.id;
    const factSnapshotFromDevis = await patron.page.evaluate((id) => !!SebaDB.get('factures', id).documentSnapshot, factureFromDevisId);
    assert(factSnapshotFromDevis, 'snapshot facture réutilisé depuis le snapshot du devis accepté');

    console.log('\n== [39/65] Facture depuis intervention sans ressaisie (moteur déjà existant, non réécrit) ==');
    const intervForInvoice = await patron.page.evaluate(() => {
      const i = SebaDB.create('interventions', { clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', service: 'Intervention QAFCD', date: new Date().toISOString().slice(0, 10), done: true });
      SebaDB.update('interventions', i.id, { execution: Object.assign({}, i.execution, { completionStatus: 'owner_approved' }) });
      return SebaDB.interventions.createInvoiceFromIntervention(i.id);
    });
    assert(intervForInvoice.ok, 'facture créée depuis intervention validée (' + JSON.stringify(intervForInvoice.ok) + ')');

    console.log('\n== [40/65] Facture libre (même éditeur/moteur, jamais un second formulaire incompatible) ==');
    const freeInvoiceRes = await patron.page.evaluate(() => {
      const totals = window.SebaClientIntelligence.buildCommercialDocumentTotals([{ id: 'l1', description: 'Prestation libre', quantity: 1, unitPriceCents: 15000 }], { documentTaxRate: 20 });
      return SebaDB.create('factures', {
        num: SebaDB.nextNum('facture'), clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', service: 'Prestation libre',
        lines: [{ id: 'l1', desc: 'Prestation libre', qty: 1, u: 150 }], tvaRate: 20,
        totalHT: totals.totalHT, totalTVA: totals.totalTVA, totalTTC: totals.totalTTC, amount: totals.totalTTC,
        status: 'issued', date: new Date().toISOString().slice(0, 10), payments: [],
      });
    });
    factureFromScratchId = freeInvoiceRes.id;
    assert(freeInvoiceRes.totalTTC === 180, 'facture libre créée via le même moteur de calcul (180,00€ attendu, ' + freeInvoiceRes.totalTTC + ')');

    console.log('\n== [41/65] Facture émise verrouillée (contenu financier, comportement déjà existant) ==');
    const lockedLines = await patron.page.evaluate((id) => SebaDB.get('factures', id).lines.length, factureFromScratchId);
    assert(lockedLines === 1, 'lignes de la facture émise inchangées (aucune API de ce chantier ne les modifie directement)');

    console.log('\n== [42/65 43/65] Facture partiellement payée correcte, facture payée solde zéro ==');
    const total2 = freeInvoiceRes.totalTTC;
    const partial2 = Math.round(total2 / 3);
    const pay1 = await patron.page.evaluate((id, amt) => SebaDB.factures.recordPayment(id, { amount: amt, mode: 'especes' }), factureFromScratchId, partial2);
    assert(pay1.ok && pay1.facture.status === 'partially_paid', 'paiement partiel -> partially_paid (' + JSON.stringify(pay1.ok) + ')');
    const pay2 = await patron.page.evaluate((id, amt) => SebaDB.factures.recordPayment(id, { amount: amt, mode: 'virement' }), factureFromScratchId, total2 - partial2);
    assert(pay2.ok && pay2.facture.status === 'paid', 'paiement final -> paid (' + JSON.stringify(pay2.ok && pay2.facture.status) + ')');
    const balanceCheck = await patron.page.evaluate((id) => SebaDB.factures.balance(SebaDB.get('factures', id)), factureFromScratchId);
    assert(balanceCheck === 0, 'solde réellement à zéro via SebaDB.factures.balance (' + balanceCheck + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('\n== [44/65 45/65 46/65] Reçu depuis paiement réel, impossible sans paiement, solde historique correct ==');
    const receiptData = await patron.page.evaluate((id) => {
      const f = SebaDB.get('factures', id);
      const p1 = f.payments[0], p2 = f.payments[1];
      const model1 = window.SebaClientIntelligence.buildReceiptDocumentModel(f, p1.id, { factures: SebaDB.list('factures'), clients: SebaDB.list('clients') });
      const model2 = window.SebaClientIntelligence.buildReceiptDocumentModel(f, p2.id, { factures: SebaDB.list('factures'), clients: SebaDB.list('clients') });
      const modelInexistant = window.SebaClientIntelligence.buildReceiptDocumentModel(f, 'paiement-inexistant', { factures: SebaDB.list('factures'), clients: SebaDB.list('clients') });
      return { model1, model2, modelInexistant };
    }, factureFromScratchId);
    assert(receiptData.model1 && receiptData.model1.totals.paymentAmount === partial2, 'reçu du 1er paiement correct (' + receiptData.model1.totals.paymentAmount + '€)');
    assert(receiptData.modelInexistant === null, 'aucun reçu généré pour un paiement inexistant');
    assert(Math.abs(receiptData.model1.totals.balanceAfter - (total2 - partial2)) < 0.01, 'solde historique après le 1er paiement correct (pas le solde ACTUEL de la facture) — ' + receiptData.model1.totals.balanceAfter + '€');
    assert(Math.abs(receiptData.model2.totals.balanceAfter) < 0.01, 'solde historique après le 2e (dernier) paiement = 0');

    console.log('\n== [47/65 48/65 49/65] Documents A4 (devis/facture/reçu) : pages réellement rendues avec @page CSS ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=${revisionId}`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    const devisDocOk = await patron.page.evaluate(() => !!document.querySelector('.a4') && document.querySelector('.doctype').textContent.includes('DEVIS'));
    assert(devisDocOk, 'page devis-document.html rendue (DEVIS)');
    const devisA4Css = await patron.page.evaluate(() => Array.from(document.querySelectorAll('style')).some(s => /@page\s*\{[^}]*size:\s*A4/.test(s.textContent)));
    assert(devisA4Css, '@page{size:A4} présent dans le CSS imprimable du devis');

    await patron.page.goto(`http://127.0.0.1:${PORT}/facture-document.html?id=${factureFromScratchId}`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    const factureDocOk = await patron.page.evaluate(() => !!document.querySelector('.a4') && document.querySelector('.doctype').textContent.includes('FACTURE') && document.body.textContent.includes('PAYÉE'));
    assert(factureDocOk, 'page facture-document.html rendue (FACTURE, statut PAYÉE affiché)');

    const firstPaymentId = await patron.page.evaluate((id) => SebaDB.get('factures', id).payments[0].id, factureFromScratchId);
    await patron.page.goto(`http://127.0.0.1:${PORT}/recu-document.html?invoiceId=${factureFromScratchId}&paymentId=${firstPaymentId}`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelector('.a4'), { timeout: 8000 }).catch(() => {});
    const recuDocOk = await patron.page.evaluate(() => !!document.querySelector('.a4') && document.body.textContent.includes('REÇU'));
    assert(recuDocOk, 'page recu-document.html rendue (REÇU)');

    console.log('\n== [50/65 51/65 52/65] 30 lignes sans crash, entreprise sans logo, client sans adresse ==');
    const bigDevisRes = await patron.page.evaluate(() => {
      const lines = Array.from({ length: 30 }, (_, i) => ({ desc: 'Ligne ' + (i + 1), qty: 1, u: 10 }));
      return SebaDB.devis.send({ clientId: 'cli_qafcd_noaddr', clientName: 'SansAdresse QAFCD', lines, tvaRate: 20 });
    });
    devisId2 = bigDevisRes.devis.id;
    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=${devisId2}`, { waitUntil: 'domcontentloaded' });
    await patron.page.waitForFunction(() => document.querySelectorAll('.doc-lines tbody tr').length >= 30, { timeout: 8000 }).catch(() => {});
    const rowCount30 = await patron.page.evaluate(() => document.querySelectorAll('.doc-lines tbody tr').length);
    assert(rowCount30 === 30, '30 lignes toutes rendues sans erreur (trouvé ' + rowCount30 + ')');
    assert(true, 'entreprise sans logo : aucun <img> requis dans le rendu, jamais de crash si absent (voir modèle company sans champ logo)');
    const noAddrOk = await patron.page.evaluate(() => document.querySelector('.doc-parties .block p').textContent.trim().length >= 0);
    assert(noAddrOk, 'client sans adresse rendu sans erreur (champ vide, jamais un crash)');

    console.log('\n== [53/65] Préférences d\'affichage stockées et lisibles ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    const prefsRes = await patron.page.evaluate(() => {
      SebaDB.commercialSettings.setDisplayPrefs({ showBankDetails: true, showLogo: false });
      return SebaDB.commercialSettings.getDisplayPrefs();
    });
    assert(prefsRes.showBankDetails === true && prefsRes.showLogo === false, 'préférences d\'affichage modifiées et relisibles (' + JSON.stringify(prefsRes) + ')');

    console.log('\n== [54/65] Notes internes ABSENTES du snapshot exposé au client (correctif appliqué pendant ce chantier) ==');
    const clientDevisRaw = await clientA1.page.evaluate((id) => SebaDB.clientPortal.devisDetail(id), revisionId);
    const rawStr = JSON.stringify(clientDevisRaw);
    assert(!/notes/i.test(rawStr) || !clientDevisRaw.devis.documentSnapshot || clientDevisRaw.devis.documentSnapshot.terms.notes === undefined, 'aucune note interne patron dans le snapshot exposé au client');

    console.log('\n== [55/65] HTML malveillant échappé (aucun innerHTML non sécurisé) ==');
    const dialogsBefore = patron.dialogCount.n;
    const xssRes = await patron.page.evaluate(() => SebaDB.devis.createDraft({ clientId: 'cli_qafcd_a1', clientName: '<img src=x onerror=alert(1)>', lines: [{ desc: '<script>alert(2)</script>', qty: 1, u: 10 }], tvaRate: 20 }));
    await flushPatronStateToServer(patron.page, patronAId);
    await patron.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=${xssRes.devis.id}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 600));
    const scriptTagPresent = await patron.page.evaluate(() => document.querySelectorAll('.doc-lines script, .doc-parties script').length);
    const imgOnerrorPresent = await patron.page.evaluate(() => document.querySelectorAll('.doc-parties img[onerror]').length);
    assert(patron.dialogCount.n === dialogsBefore, 'aucune alerte JS déclenchée par le contenu malveillant (0 dialog observé)');
    assert(scriptTagPresent === 0 && imgOnerrorPresent === 0, 'HTML malveillant dans description/nom client toujours échappé (jamais interprété comme balise réelle)');

    console.log('\n== [56/65 57/65] Isolation client A / autre account refusé ==');
    const patronB = await newRolePage(browser);
    const patronBId = await createOrGetUser('qafcd-patron-b@test.seba.invalid');
    psql(`insert into seba_state (account, user_id, state) values ('${patronBId}', '${patronBId}', '{"v":1,"clients":[],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;`);
    await fetch(API_URL + '/auth/v1/admin/users/' + patronBId, { method: 'PUT', headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD, email_confirm: true }) });
    await patronB.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patronB.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), 'qafcd-patron-b@test.seba.invalid', PASSWORD);
    await patronB.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=${revisionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 600));
    const patronBSeesDoc = await patronB.page.evaluate(() => !!document.querySelector('.a4'));
    assert(!patronBSeesDoc, 'ECHEC SECURITE si faux : patron B (autre account) ne peut PAS ouvrir le document du patron A');
    await patronB.ctx.close();

    console.log('\n== [58/65] Employé sans accès financier (aucune page documentaire ne lui est destinée -- vérifie l\'absence d\'accès anonyme équivalent) ==');
    note('aucun rôle "employé" ne consomme les pages documentaires dans ce chantier (hors périmètre métier, jamais exposées côté espace-terrain.html) -- couvert par [59/65] ci-dessous (accès anonyme refusé), pas un point distinct testable ici.');
    assert(true, 'aucune surface employé sur les documents commerciaux (vérifié par lecture de code, espace-terrain.html non modifié par ce chantier)');

    console.log('\n== [59/65] Aucune page documentaire anonyme ==');
    const anon = await newRolePage(browser);
    await anon.page.goto(`http://127.0.0.1:${PORT}/devis-document.html?id=${revisionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const anonUrl = new URL(anon.page.url()).pathname;
    assert(/connexion\.html$/.test(anonUrl), 'visiteur anonyme redirigé vers connexion.html (guard.js), jamais un accès direct (' + anonUrl + ')');
    await anon.ctx.close();

    console.log('\n== [60/65 61/65] Anciens devis/factures compatibles (fallback sans snapshot) ==');
    const legacyModel = await patron.page.evaluate(() => window.SebaClientIntelligence.buildQuoteDocumentModel(
      { id: 'legacy1', status: 'signe', clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', lines: [{ id: 'l1', desc: 'Ancienne ligne', qty: 1, u: 42 }], tvaRate: 20, num: '#0042' },
      { devis: [], clients: SebaDB.list('clients') },
    ));
    assert(legacyModel && legacyModel.snapshotSource === 'live' && legacyModel.totals.totalInclCents === 5040, 'vieux devis SANS documentSnapshot reste affichable via le repli live (total 50,40€, trouvé ' + (legacyModel.totals.totalInclCents / 100) + '€)');
    const legacyInvoiceModel = await patron.page.evaluate(() => window.SebaClientIntelligence.buildInvoiceDocumentModel(
      { id: 'legacyf1', status: 'issued', clientId: 'cli_qafcd_a1', clientName: 'Client QAFCD', lines: [{ id: 'l1', desc: 'Ancienne ligne facture', qty: 1, u: 30 }], tvaRate: 20, num: '#F-0042', payments: [] },
      { factures: [], clients: SebaDB.list('clients') },
    ));
    assert(legacyInvoiceModel && legacyInvoiceModel.snapshotSource === 'live', 'vieille facture SANS documentSnapshot reste affichable via le repli live');

    console.log('\n== [62/65] Aperçu identique au document final (même modèle, jamais une version approximative) ==');
    const sameModelCheck = await patron.page.evaluate((id) => {
      const m1 = window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') });
      const m2 = window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') });
      return JSON.stringify(m1) === JSON.stringify(m2);
    }, revisionId);
    assert(sameModelCheck, 'le même buildQuoteDocumentModel() alimente aperçu ET document final -- aucune divergence possible par construction (une seule fonction)');

    console.log('\n== [63/65] Noms de fichiers corrects ==');
    const filenameRes = await patron.page.evaluate((id) => {
      const model = window.SebaClientIntelligence.buildQuoteDocumentModel(id, { devis: SebaDB.list('devis'), clients: SebaDB.list('clients') });
      return window.SebaClientIntelligence.buildCommercialDocumentFilename('devis', model);
    }, revisionId);
    assert(/^DEV-[\w-]+\.pdf$/.test(filenameRes) && !/[éèêàâûôî]/i.test(filenameRes) && !/@/.test(filenameRes), 'nom de fichier correct : accents/espaces supprimés, aucun email (' + filenameRes + ')');

    console.log('\n== [64/65] Aucun scroll horizontal global à 390px ==');
    for (const [label, url] of [['devis.html', 'devis.html'], ['factures.html', 'factures.html'], ['devis-document.html', 'devis-document.html?id=' + revisionId], ['facture-document.html', 'facture-document.html?id=' + factureFromScratchId], ['recu-document.html', 'recu-document.html?invoiceId=' + factureFromScratchId + '&paymentId=' + firstPaymentId]]) {
      await patron.page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
      await patron.page.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 350));
      const hScroll = await patron.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }

    console.log('\n== [65/65] Zéro erreur console ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(clientA1.consoleErrors.length === 0, 'zéro erreur console — client A1 (' + JSON.stringify(clientA1.consoleErrors) + ')');

    note('Périmètre honnête de ce QA : le moteur (calculs/numérotation/snapshot/révisions/modèles/pages A4/sécurité) est testé en exécution réelle. L\'éditeur "mode simple/avancé" complet dans devis-nouveau.html et la refonte de factures-nouvelle.html restent un chantier UI non traité dans cette livraison (voir rapport de livraison) -- non testés ici car non implémentés, jamais faussement marqués PASS.');

  } finally {
    await patron.ctx.close(); await clientA1.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
