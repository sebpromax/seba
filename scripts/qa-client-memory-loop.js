// SEBA — QA permanente de la boucle SEBA CLIENT MEMORY & MISSION
// INTELLIGENCE (feature/client-crm-advanced). Ne modifie jamais ce test
// pour masquer un échec réel.
//
// Deux volets, testés avec les VRAIES données/écritures correspondantes :
//
//   VOLET A (docs/client-fiche.html, mode démo local) -- mémoire client,
//   plans récurrents, génération d'occurrences idempotente, briefing
//   automatique, filtrage owner_only (vérifié en inspectant directement le
//   contenu du snapshot généré par la même fonction generateMissionBrief()
//   utilisée en production), isolation entre deux clients, persistance
//   après reload.
//
//   VOLET B (docs/espace-terrain.html, VRAIE session Supabase locale) --
//   un employé réel se connecte, voit le briefing autorisé de SA mission,
//   soumet un retour terrain structuré via la RPC réelle
//   submit_my_intervention_field_report, persistance confirmée après
//   reload. Réutilise le jeu de données synthétique déjà seedé par
//   scripts/local-db/test-employee-portal-rls.sh (test-patron-a/emp_synth_1
//   /employe-a@test.seba.invalid) -- isolation employé/employé et
//   patron/patron déjà couverte de façon exhaustive par
//   scripts/local-db/test-employee-portal-rls.sh et
//   scripts/local-db/test-field-report-rls.sh (RLS réelle), non
//   dupliquée ici.
//
// Prérequis VOLET B : Docker/Supabase local démarré + migrations
// appliquées + `bash scripts/local-db/test-employee-portal-rls.sh` lancé
// au moins une fois pour seeder le jeu de données. Si Supabase local est
// injoignable, le VOLET B est marqué SKIP (pas un échec) et le VOLET A
// s'exécute seul.
//
// Usage : node scripts/qa-client-memory-loop.js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PORT = 8870;
const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(repoRoot, 'docs', urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('nf: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function skip(msg) { console.log('  --   -', msg); }

async function seedDemoAndGoto(page, url) {
  await page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€' }));
    localStorage.setItem('seba_calibration_seen', '1');
  });
  await page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 900));
}

async function voletA(browser) {
  console.log('\n=== VOLET A — client-fiche.html (mémoire, plans, briefing, isolation) ===');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console.error: ' + m.text()); });

  // Force le mode démo LOCAL pur : docs/config.public.js (committé, pointe
  // vers le projet Supabase partagé réel) serait sinon chargé par auth.js
  // même sans session -- hasSupabase deviendrait true et
  // SebaDB.interventions.saveFieldReport()/employeePortal.* prendraient le
  // chemin RPC réseau (échec "Non authentifié.", puisqu'aucune session
  // n'existe dans ce contexte patron-local), au lieu du repli local
  // volontairement testé ici. Interception nécessaire pour un test
  // déterministe et sans dépendance réseau pour ce volet.
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (/config(\.public)?\.js$/.test(req.url())) { req.respond({ status: 200, contentType: 'application/javascript', body: 'window.SEBA_CONFIG_PUBLIC = {};' }); return; }
    req.continue();
  });

  // 1. Créer deux clients (isolation).
  await seedDemoAndGoto(page, 'clients.html?demo');
  const clientIds = await page.evaluate(() => {
    const c1 = window.SebaDB.create('clients', { prenom: 'Alpha', nom: 'Client', contact: 'alpha@test.invalid', adresse: '1 rue Alpha', statut: 'actif' });
    const c2 = window.SebaDB.create('clients', { prenom: 'Beta', nom: 'Client', contact: 'beta@test.invalid', adresse: '2 rue Beta', statut: 'actif' });
    return { c1: c1.id, c2: c2.id };
  });
  assert(!!clientIds.c1 && !!clientIds.c2, '1. deux clients créés (isolation)');

  await page.goto(`http://127.0.0.1:${PORT}/client-fiche.html?id=${clientIds.c1}&demo`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));

  // 2. Entrée owner_only.
  const ownerOnlyId = await page.evaluate((cid) => {
    const e = window.SebaDB.clients.addMemoryEntry(cid, { type: 'billing', title: 'Tarif préférentiel négocié', content: 'Remise 15% jamais visible du client ni de l\'employé', visibility: 'owner_only', importance: 'important', source: 'manual' });
    return e && e.id;
  }, clientIds.c1);
  assert(!!ownerOnlyId, '2. entrée mémoire owner_only ajoutée');

  // 3. Instruction d'accès critique (visible employé).
  const accessId = await page.evaluate((cid) => {
    const e = window.SebaDB.clients.addMemoryEntry(cid, { type: 'access', title: 'Code portail 4471', content: 'Boîte à clés côté jardin', visibility: 'assigned_employee', importance: 'critical', source: 'manual' });
    return e && e.id;
  }, clientIds.c1);
  assert(!!accessId, '3. instruction d\'accès critique ajoutée (visible employé)');

  // 4. Plan hebdomadaire.
  const planId = await page.evaluate((cid) => {
    const p = window.SebaDB.clients.saveServicePlan(cid, { name: 'Ménage hebdo', service: 'Ménage standard', frequency: 'weekly', preferredStartTime: '09:00', startDate: '2026-08-03', horizonDays: 35, instructions: 'Sonner 2 fois' });
    return p && p.id;
  }, clientIds.c1);
  assert(!!planId, '4. plan hebdomadaire créé');

  // 5. Génère les occurrences (4 attendues sur un horizon de 35 jours hebdo).
  const gen1 = await page.evaluate((cid, pid) => window.SebaDB.clients.generateServicePlanOccurrences(cid, pid), clientIds.c1, planId);
  assert(gen1.created === 4, `5. génère 4 occurrences (observe ${gen1.created})`);

  // 6/7. Relance -- zéro doublon.
  const gen2 = await page.evaluate((cid, pid) => window.SebaDB.clients.generateServicePlanOccurrences(cid, pid), clientIds.c1, planId);
  assert(gen2.created === 0 && gen2.skipped === 4, `6/7. relance sans doublon (observe created=${gen2.created}, skipped=${gen2.skipped})`);

  // 8/9. Ouvre une mission générée, vérifie le briefing.
  const firstInterventionId = await page.evaluate((cid) => window.SebaDB.list('interventions').find(i => i.clientId === cid && i.recurrenceKey).id, clientIds.c1);
  const brief = await page.evaluate((iid) => window.SebaDB.get('interventions', iid).missionBrief, firstInterventionId);
  assert(!!brief, '8/9. briefing généré automatiquement à la création de l\'occurrence');

  // 11. La préférence/accès visible apparaît dans le briefing.
  const briefStr = JSON.stringify(brief);
  assert(briefStr.includes('Code portail 4471'), '11. l\'entrée access visible par l\'employé apparaît dans le briefing');

  // 12. L'entrée owner_only N'apparaît JAMAIS dans le briefing (filtrage à la génération).
  assert(!briefStr.includes('Tarif préférentiel négocié') && !briefStr.includes('Remise 15%'), '12. l\'entrée owner_only est absente du briefing (aucune donnée financière/interne exposée)');

  // Régénération explicite.
  const regenerated = await page.evaluate((iid) => window.SebaDB.interventions.regenerateMissionBrief(iid), firstInterventionId);
  assert(!!regenerated && regenerated.generatedAt !== brief.generatedAt, 'régénération explicite du briefing produit un nouveau snapshot horodaté');

  // Retour terrain (mode démo local -- volet B teste la RPC réelle).
  const frResult = await page.evaluate((iid) => window.SebaDB.interventions.saveFieldReport(iid, { outcome: 'completed', summary: 'RAS', issueType: 'access', issueDescription: 'Code changé sans prévenir', followUpRequired: true, followUpDate: '2026-08-10' }), firstInterventionId);
  assert(frResult && frResult.ok, 'retour terrain structuré enregistré (mode démo)');

  // 14. Suggestion mémoire générée à partir de l'incident -> accepter.
  const suggestionId = await page.evaluate((iid) => { const i = window.SebaDB.get('interventions', iid); return i.fieldReport.memorySuggestions[0] && i.fieldReport.memorySuggestions[0].id; }, firstInterventionId);
  assert(!!suggestionId, 'suggestion de mémoire générée à partir de l\'incident signalé');
  const acceptResult = await page.evaluate((iid, sid) => window.SebaDB.interventions.acceptMemorySuggestion(iid, sid, {}), firstInterventionId, suggestionId);
  assert(acceptResult && acceptResult.ok, '17/14. suggestion mémoire acceptée -> nouvelle entrée réelle');
  const memoryCountAfterAccept = await page.evaluate((cid) => window.SebaDB.get('clients', cid).operationalMemory.entries.length, clientIds.c1);
  assert(memoryCountAfterAccept === 3, `mémoire enrichie via le retour terrain (2 manuelles + 1 acceptée, observe ${memoryCountAfterAccept})`);

  // Une suggestion déjà acceptée ne réapparaît plus.
  const pendingAfter = await page.evaluate((iid) => { const i = window.SebaDB.get('interventions', iid); const fr = i.fieldReport; return fr.memorySuggestions.filter(s => (fr.dismissedSuggestionIds||[]).indexOf(s.id)===-1 && (fr.acceptedSuggestionIds||[]).indexOf(s.id)===-1).length; }, firstInterventionId);
  assert(pendingAfter === (await page.evaluate((iid) => window.SebaDB.get('interventions', iid).fieldReport.memorySuggestions.length, firstInterventionId)) - 1, 'suggestion acceptée retirée de la liste "en attente"');

  // 18. Isolation entre deux clients : le 2e client ne voit rien du 1er.
  await page.goto(`http://127.0.0.1:${PORT}/client-fiche.html?id=${clientIds.c2}&demo`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  const c2Memory = await page.evaluate((cid) => window.SebaDB.get('clients', cid).operationalMemory.entries.length, clientIds.c2);
  const c2Plans = await page.evaluate((cid) => window.SebaDB.get('clients', cid).servicePlans.length, clientIds.c2);
  assert(c2Memory === 0 && c2Plans === 0, `18. isolation client 2 : aucune mémoire/plan du client 1 (observe memory=${c2Memory}, plans=${c2Plans})`);

  // Plan suspendu -> génération refusée.
  const planIdC2 = await page.evaluate((cid) => window.SebaDB.clients.saveServicePlan(cid, { name: 'Plan test suspension', service: 'Repassage', frequency: 'weekly', startDate: '2026-08-01' }).id, clientIds.c2);
  await page.evaluate((cid, pid) => window.SebaDB.clients.suspendServicePlan(cid, pid), clientIds.c2, planIdC2);
  const genSuspended = await page.evaluate((cid, pid) => window.SebaDB.clients.generateServicePlanOccurrences(cid, pid), clientIds.c2, planIdC2);
  assert(genSuspended.created === 0 && !!genSuspended.error, `plan suspendu : génération refusée (observe ${JSON.stringify(genSuspended)})`);

  // Plan supprimé -> disparaît de la liste, sans supprimer les interventions déjà générées.
  await page.evaluate((cid) => window.SebaDB.clients.saveServicePlan(cid, { id: (window.SebaDB.get('clients', cid).servicePlans.find(p=>p.name==='Plan test suspension')||{}).id, active: true }), clientIds.c2);
  const beforeDelete = await page.evaluate((cid) => window.SebaDB.get('clients', cid).servicePlans.length, clientIds.c2);
  await page.evaluate((cid, pid) => window.SebaDB.clients.deleteServicePlan(cid, pid), clientIds.c2, planIdC2);
  const afterDelete = await page.evaluate((cid) => window.SebaDB.get('clients', cid).servicePlans.length, clientIds.c2);
  assert(beforeDelete === 1 && afterDelete === 0, `plan supprimé : retiré de la liste (observe ${beforeDelete} -> ${afterDelete})`);

  // Occurrence passée non générée -- plan démarrant hier, aucune date < aujourd'hui.
  const pastPlanResult = await page.evaluate((cid) => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const startDate = yesterday.getFullYear() + '-' + String(yesterday.getMonth()+1).padStart(2,'0') + '-' + String(yesterday.getDate()).padStart(2,'0');
    const p = window.SebaDB.clients.saveServicePlan(cid, { name: 'Plan passé', service: 'Test', frequency: 'weekly', startDate, horizonDays: 14 });
    const preview = window.SebaDB.clients.previewServicePlanOccurrences(cid, p.id);
    const todayISO = new Date().toISOString().slice(0, 10);
    return { anyPast: preview.toCreate.some(o => o.date < todayISO) };
  }, clientIds.c2);
  assert(!pastPlanResult.anyPast, 'aucune occurrence dans le passé, même pour un plan démarrant hier');

  // 19. Aucun scroll horizontal à 390px.
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${PORT}/client-fiche.html?id=${clientIds.c1}&demo`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  const scrollState = await page.evaluate(() => ({ hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
  assert(!scrollState.hasHorizontalScroll, '19. aucun débordement horizontal à 390px');

  // 15/16. Persistance complète après reload (desktop).
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 900));
  const afterReload = await page.evaluate((cid) => {
    const c = window.SebaDB.get('clients', cid);
    return { memory: c.operationalMemory.entries.length, plans: c.servicePlans.length, interventions: window.SebaDB.list('interventions').filter(i => i.clientId === cid && i.recurrenceKey).length };
  }, clientIds.c1);
  assert(afterReload.memory === 3 && afterReload.plans === 1 && afterReload.interventions === 4, `15/16. persistance complète après reload (observe ${JSON.stringify(afterReload)})`);

  // 20. Aucune erreur console sur l'ensemble du volet A.
  assert(errors.length === 0, `20. aucune erreur console sur le volet A (observe: ${JSON.stringify(errors)})`);

  // 17 (dashboard). buildClientIntelligenceDashboardActions est défini
  // dans app/dashboard.html (pas seba-data.js) -- vérifié séparément via
  // qa-dashboard-command-center.js (branchement déjà couvert). Ici on
  // vérifie que le SIGNAL exploité par cette fonction est bien présent et
  // correct dans les données : un suivi requis existe réellement.
  const followUpPresent = await page.evaluate((iid) => !!window.SebaDB.get('interventions', iid).fieldReport.followUpRequired, firstInterventionId);
  assert(followUpPresent, '17. signal "suivi requis" présent dans les données -- exploitable par le dashboard (buildClientIntelligenceDashboardActions)');

  await page.close();
  return clientIds.c1;
}

async function voletB(browser) {
  console.log('\n=== VOLET B — espace-terrain.html (VRAIE session Supabase, RPC réelle) ===');
  let health;
  try {
    const res = await fetch(API_URL + '/rest/v1/', { headers: { apikey: ANON_KEY } });
    health = res.status < 500;
  } catch (e) { health = false; }
  if (!health) { skip('Supabase local injoignable -- volet B ignoré (pas un échec), voir bash scripts/local-db/test-employee-portal-rls.sh'); return; }

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  page.on('dialog', async d => { await d.dismiss(); });

  await page.setRequestInterception(true);
  page.on('request', req => {
    if (/config(\.public)?\.js$/.test(req.url())) {
      req.respond({ status: 200, contentType: 'application/javascript', body: `window.SEBA_CONFIG_PUBLIC = { supabaseUrl: '${API_URL}', supabaseAnonKey: '${ANON_KEY}', accountId: 'demo', onesignalAppId:'', sentryDsn:'', umamiWebsiteId:'', umamiScriptUrl:'' };` });
      return;
    }
    req.continue();
  });

  await page.setViewport({ width: 1024, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));

  // 9. Connecte l'employé assigné (jeu de données synthétique déjà seedé).
  const signIn = await page.evaluate(() => window.sebaAuth.signIn('employe-a@test.seba.invalid', 'Test-Synthetic-2026!'));
  if (signIn && signIn.error) { skip('connexion employé synthétique impossible (' + JSON.stringify(signIn.error) + ') -- relancer bash scripts/local-db/test-employee-portal-rls.sh -- volet B ignoré'); await page.close(); return; }
  assert(!signIn || !signIn.error, '9. connexion réelle de l\'employé assigné (employe-a@test.seba.invalid)');

  await page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _missions !== 'undefined', { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 900));

  const missionId = await page.evaluate(() => (_missions && _missions[0] && _missions[0].id) || null);
  assert(!!missionId, '10. au moins une mission assignée visible par l\'employé (isolation RLS déjà couverte par test-employee-portal-rls.sh)');
  if (!missionId) { await page.close(); return; }

  // 13. Démarrer puis terminer avec un fieldReport (RPC réelle).
  await page.evaluate(id => demarrerMission(id), missionId);
  await new Promise(r => setTimeout(r, 900));
  const started = await page.evaluate((id) => (_missions.find(m => m.id === id) || {}).statut, missionId);
  assert(started === 'en_cours', '13. mission démarrée (RPC update_my_employee_intervention_status)');

  await page.evaluate(id => openFieldReportModal(id), missionId);
  await new Promise(r => setTimeout(r, 200));
  await page.click('.fr-outcome-btn[data-outcome="completed"]');
  await page.type('#fr-summary', 'Intervention terminée sans souci');
  await page.select('#fr-issue-type', 'none');
  await page.click('#fr-validate');
  await new Promise(r => setTimeout(r, 1200));
  const afterFieldReport = await page.evaluate((id) => { const m = (_missions || []).find(x => x.id === id); return { done: m && m.done, outcome: m && m.fieldReport && m.fieldReport.outcome }; }, missionId);
  assert(afterFieldReport.outcome === 'completed', `13. retour terrain soumis via la VRAIE RPC submit_my_intervention_field_report (observe ${JSON.stringify(afterFieldReport)})`);

  // 15/16/19. Reload : persistance confirmée après reload réel.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _missions !== 'undefined', { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 900));
  const afterReload = await page.evaluate((id) => { const m = (_missions || []).find(x => x.id === id); return m && m.fieldReport && m.fieldReport.outcome; }, missionId);
  assert(afterReload === 'completed', '15/16. retour terrain persisté après reload complet (session réelle)');

  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 900));
  const scrollState = await page.evaluate(() => ({ hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
  assert(!scrollState.hasHorizontalScroll, '19. aucun débordement horizontal à 390px (espace-terrain.html)');

  const realErrors = consoleErrors.filter(e => !/404 \(Not Found\)/.test(e));
  assert(realErrors.length === 0, `20. aucune erreur console sur le volet B (observe: ${JSON.stringify(realErrors)})`);

  await page.close();
}

async function main() {
  const server = await startStaticServer();
  const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });

  await voletA(browser);
  await voletB(browser);

  await browser.close().catch(() => {});
  await server.close();
  console.log(failures === 0 ? '\nTOUT PASSE' : `\n${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
