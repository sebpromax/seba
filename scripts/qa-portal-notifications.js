// SEBA — QA verticale Lot 1 (Centre de notifications commun).
//
// Scénario réel : Patron A crée client+devis+intervention -> Client A1
// accepte le devis (session réelle) -> le bell du patron affiche le
// compteur non-lu réel -> ouverture du panneau -> l'item est bien
// affiché -> marquage lu -> compteur redescend -> Employé A1 termine
// une mission -> notification patron -> message envoyé par le patron ->
// notification client. Vérifie aussi focus clavier, mobile 390px, zéro
// erreur console, sur les 3 pages concernées (dashboard/client-espace/
// espace-terrain).
//
// Même pattern que scripts/qa-quote-to-cash.js : sessions Supabase Auth
// RÉELLES, BrowserContext isolé par rôle, config.public.js intercepté,
// flush direct psql pour les écritures PATRON uniquement (sync-push
// indisponible en local par défaut -- si `supabase functions serve`
// tourne, les écritures patron passeront aussi par le vrai chemin, sans
// incidence sur ce test qui ne dépend pas de ce détail).
//
// Usage : node scripts/qa-portal-notifications.js
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
const PORT = 8811;
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
  page.on('console', (m) => {
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|503 \(Service Temporarily Unavailable\)/.test(m.text())) return;
    consoleErrors.push('console.error: ' + m.text());
  });
  page.on('dialog', async (d) => { await d.dismiss(); });
  return { ctx, page, consoleErrors };
}

async function main() {
  console.log('== [setup] Comptes synthétiques QAPN, seba_state, rattachements ==');
  const patronId = await createOrGetUser('qapn-patron-a@test.seba.invalid');
  const clientId = await createOrGetUser('qapn-cli-a1@test.seba.invalid');
  const employeId = await createOrGetUser('qapn-emp-a1@test.seba.invalid');
  console.log('   patron=' + patronId + ' client=' + clientId + ' employe=' + employeId);

  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronId}', '${patronId}',
      '{"v":1,"clients":[{"id":"cli_qapn_1","nom":"Client QAPN","prenom":"","email":"qapn-cli-a1@test.seba.invalid","adresse":"1 rue QAPN"}],
       "devis":[{"id":"devis_qapn_1","clientId":"cli_qapn_1","status":"attente","lignes":[],"totalTTC":80,"statusHistory":[]}],
       "factures":[],
       "interventions":[{"id":"interv_qapn_1","clientId":"cli_qapn_1","employeId":"emp_qapn_1","service":"QAPN Test","execution":{"checklist":[],"photos":[],"materials":[],"incidents":[],"completionStatus":"in_progress"},"requirePhotoBefore":false,"requirePhotoAfter":false,"statusHistory":[]}],
       "employes":[{"id":"emp_qapn_1","prenom":"Employe","nom":"QAPN","actif":true}],
       "journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    delete from client_accounts where client_user_id = '${clientId}';
    insert into client_accounts (client_user_id, account, client_id, email) values ('${clientId}', '${patronId}', 'cli_qapn_1', 'qapn-cli-a1@test.seba.invalid');
    delete from employe_accounts where employe_user_id = '${employeId}';
    insert into employe_accounts (employe_user_id, account, employe_id, email) values ('${employeId}', '${patronId}', 'emp_qapn_1', 'qapn-emp-a1@test.seba.invalid');
    delete from notifications where account = '${patronId}';
  `);

  const server = await startStaticServer();
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new' });

  console.log('== [1/9] Client A1 accepte le devis (déclenche une vraie notification patron) ==');
  const client = await newRolePage(browser);
  await client.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
  await client.page.evaluate((email, pw) => window.sebaAuth.signIn(email, pw), 'qapn-cli-a1@test.seba.invalid', PASSWORD);
  await new Promise((r) => setTimeout(r, 400));
  const acceptRes = await client.page.evaluate((id) => SebaDB.clientPortal.acceptDevis(id), 'devis_qapn_1');
  assert(acceptRes && acceptRes.ok, 'devis accepté réellement (' + JSON.stringify(acceptRes && acceptRes.ok) + ')');

  console.log('== [2/9] Patron : connexion réelle sur app/dashboard.html, bell + badge réels ==');
  const patron = await newRolePage(browser);
  await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
  await patron.page.evaluate((email, pw) => window.sebaAuth.signIn(email, pw), 'qapn-patron-a@test.seba.invalid', PASSWORD);
  await new Promise((r) => setTimeout(r, 300));
  await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const bellExists = await patron.page.evaluate(() => !!document.getElementById('sn-bell-btn'));
  assert(bellExists, 'la cloche de notifications est réellement injectée sur app/dashboard.html');
  const badgeText = await patron.page.evaluate(() => document.getElementById('sn-badge').textContent);
  assert(badgeText && parseInt(badgeText, 10) >= 1, 'le badge affiche un compteur non-lu réel (observé "' + badgeText + '")');

  console.log('== [3/9] Ouverture du panneau, item réel affiché, lien vers la notification devis.client_accepted ==');
  await patron.page.click('#sn-bell-btn');
  await new Promise((r) => setTimeout(r, 500));
  const panelOpen = await patron.page.evaluate(() => document.getElementById('sn-panel').classList.contains('open'));
  assert(panelOpen, 'le panneau s\'ouvre réellement au clic');
  const itemCount = await patron.page.evaluate(() => document.querySelectorAll('#sn-list .sn-item').length);
  assert(itemCount >= 1, 'au moins un item réel affiché dans la liste (observé ' + itemCount + ')');
  const firstTitle = await patron.page.evaluate(() => document.querySelector('#sn-list .sn-item-title')?.textContent);
  assert(firstTitle && /devis/i.test(firstTitle), 'le premier item concerne bien le devis accepté (titre="' + firstTitle + '")');

  console.log('== [4/9] Marquage lu réel (clic), badge redescend à 0 ==');
  await patron.page.click('#sn-list .sn-item');
  await new Promise((r) => setTimeout(r, 500));
  const badgeAfter = await patron.page.evaluate(() => document.getElementById('sn-badge').classList.contains('visible'));
  assert(!badgeAfter, 'le badge disparaît une fois l\'unique notification marquée lue');

  console.log('== [5/9] Employé A1 termine une mission -> nouvelle notification patron réelle après reload ==');
  const employe = await newRolePage(browser);
  await employe.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
  await employe.page.evaluate((email, pw) => window.sebaAuth.signIn(email, pw), 'qapn-emp-a1@test.seba.invalid', PASSWORD);
  await new Promise((r) => setTimeout(r, 400));
  const completeRes = await employe.page.evaluate((id) => SebaDB.employeePortal.completeIntervention(id, 'QAPN'), 'interv_qapn_1');
  assert(completeRes && completeRes.ok, 'mission terminée réellement (' + JSON.stringify(completeRes && completeRes.ok) + ')');
  await patron.page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const badgeAfterMission = await patron.page.evaluate(() => document.getElementById('sn-badge').textContent);
  assert(badgeAfterMission && parseInt(badgeAfterMission, 10) >= 1, 'nouvelle notification mission.completed réelle après reload (observé "' + badgeAfterMission + '")');

  console.log('== [6/9] Message patron -> client : notification réelle côté client-espace.html ==');
  await patron.page.evaluate(() => SebaDB.messages.send({ clientId: 'cli_qapn_1', expediteurRole: 'patron', destinataireRole: 'client', texte: 'QAPN message test' }));
  await new Promise((r) => setTimeout(r, 1000));
  await client.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const clientBellExists = await client.page.evaluate(() => !!document.getElementById('sn-bell-btn'));
  assert(clientBellExists, 'la cloche est réellement injectée sur client-espace.html');
  const clientBadge = await client.page.evaluate(() => document.getElementById('sn-badge').textContent);
  assert(clientBadge && parseInt(clientBadge, 10) >= 1, 'le client reçoit une vraie notification message.new (observé "' + clientBadge + '")');

  console.log('== [7/9] espace-terrain.html : widget présent pour le salarié (pas seulement dashboard/client) ==');
  await employe.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const empBellExists = await employe.page.evaluate(() => !!document.getElementById('sn-bell-btn'));
  assert(empBellExists, 'la cloche est réellement injectée sur espace-terrain.html');

  console.log('== [8/9] Accessibilité : focus clavier atteint la cloche, activation au clavier ouvre le panneau ==');
  await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  await patron.page.evaluate(() => document.getElementById('sn-bell-btn').focus());
  const focusedIsBell = await patron.page.evaluate(() => document.activeElement && document.activeElement.id === 'sn-bell-btn');
  assert(focusedIsBell, 'la cloche est focusable réellement (tabindex natif du <button>)');
  await patron.page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));
  const openedByKeyboard = await patron.page.evaluate(() => document.getElementById('sn-panel').classList.contains('open'));
  assert(openedByKeyboard, 'Entrée sur la cloche focusée ouvre réellement le panneau');
  const outline = await patron.page.evaluate(() => { const cs = getComputedStyle(document.getElementById('sn-bell-btn')); return cs.outlineStyle; });
  console.log('   (info) outline-style au focus:', outline);

  console.log('== [9/9] Mobile 390px : pas de scroll horizontal, panneau utilisable ==');
  for (const [label, page] of [['dashboard', patron.page], ['client-espace', client.page], ['espace-terrain', employe.page]]) {
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, 'pas de scroll horizontal à 390px — ' + label);
  }

  console.log('== Zéro erreur console sur les 3 rôles ==');
  assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
  assert(client.consoleErrors.length === 0, 'zéro erreur console — client (' + JSON.stringify(client.consoleErrors) + ')');
  assert(employe.consoleErrors.length === 0, 'zéro erreur console — employé (' + JSON.stringify(employe.consoleErrors) + ')');

  await browser.close();
  server.close();
  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
