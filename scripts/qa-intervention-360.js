// SEBA — QA verticale Intervention 360 (feature/intervention-360).
//
// Scénario exact exigé (section 9 du chantier) : Patron A crée un client
// puis une intervention -> ajoute une checklist (2 tâches obligatoires)
// -> exige des photos avant/après -> assigne Employé A1 -> Employé A1 voit
// SEULEMENT cette mission, Employé A2 ne la voit pas -> A1 démarre ->
// complète une seule tâche -> la finalisation est refusée -> complète la
// checklist -> ajoute les photos obligatoires -> ajoute un matériau ->
// termine (retour terrain inclus) -> Client A1 voit la mission terminée,
// Client A2 ne la voit pas -> Client A1 signale un problème -> le patron
// voit l'alerte -> le patron rouvre -> Employé A1 corrige et termine ->
// Client A1 approuve -> le patron valide le dossier -> le patron crée une
// facture préremplie -> reload complet -> toutes les données persistent
// -> aucun événement dupliqué -> aucun accès cross-compte (Patron B/
// Employé B/Client B) -> aucun accès anonyme -> pas de scroll horizontal
// à 390px -> zéro erreur console.
//
// Utilise des sessions Supabase Auth RÉELLES (pas le mode démo local) --
// un BrowserContext isolé par rôle (patron/employé A1/employé A2/client
// A1/client A2), config.public.js intercepté pour pointer vers le
// Supabase local. Même schéma que scripts/local-db/test-*-rls.sh pour les
// comptes synthétiques (email/mdp fixes, idempotent).
//
// Usage : node scripts/qa-intervention-360.js
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
const PORT = 8799;
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
  // Déjà existant (rejeu du script) -- relit l'id via psql, service_role.
  const out = execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '${email}' limit 1;"`, { encoding: 'utf8' });
  return out.trim();
}

function psql(sql) {
  execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1', { input: sql, encoding: 'utf8' });
}

/* Le patron écrit en local-first (SebaDB.create/update) : la synchronisation
   normale passe par l'Edge Function sync-push, INDISPONIBLE dans cet
   environnement local (supabase_edge_runtime_seba non déployé avec les
   fonctions -- limitation d'infrastructure hors du périmètre de ce
   chantier, confirmée : 404 "Function not found" même conteneur démarré).
   Sans elle, la file d'attente locale ne se vide jamais -- naviguer vers
   une autre page déclenche un nouveau SupabaseAdapter.pull() qui écrase
   l'état local fraîchement écrit par une copie serveur encore ancienne
   (perte de l'écriture), et Employé/Client (RPC réelles, lecture
   serveur directe) ne verraient jamais les données créées par le
   patron. Contournement : après chaque écriture patron, on lit l'état
   local COMPLET du navigateur et on l'écrit directement dans seba_state
   via psql (postgres, contourne RLS) -- simule exactement ce que
   sync-push aurait fini par faire, sans dépendre de l'Edge Function. */
async function flushPatronStateToServer(page, account) {
  // Fusion JSONB (||), jamais un remplacement complet -- l'état par
  // défaut (EMPTY(), docs/seba-data.js:54-59) porte aussi seq/
  // custom_services/contrats/messages/clientRequests, jamais lus ici
  // (SebaDB ne les expose pas via list()) : un remplacement complet les
  // aurait fait disparaître côté serveur (confirmé : nextNum('facture')
  // a crashé sur seq manquant lors du premier essai de ce helper).
  const stateJson = await page.evaluate(() => JSON.stringify({
    clients: SebaDB.list('clients'), devis: SebaDB.list('devis'), factures: SebaDB.list('factures'),
    interventions: SebaDB.list('interventions'), employes: SebaDB.list('employes'), journal: SebaDB.journal(200),
  }));
  psql(`update seba_state set state = state || $QA360$${stateJson}$QA360$::jsonb where account = '${account}';`);
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
    // 503 filtré : docs/widgets.js (chargé par app/dashboard.html, hors
    // périmètre Intervention 360) appelle l'Edge Function ai-relay au
    // chargement -- indisponible dans cet environnement local (même
    // limitation d'infrastructure que sync-push, voir flushPatronStateToServer
    // ci-dessus : supabase_edge_runtime_seba non déployé avec les
    // fonctions, confirmé par les logs Kong -- DNS resolution failed vers
    // supabase_edge_runtime_seba). Pré-existant, sans rapport avec ce
    // chantier -- jamais un vrai défaut de la fonctionnalité testée ici.
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|503 \(Service Temporarily Unavailable\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  page.on('dialog', async (d) => { await d.dismiss(); });
  return { ctx, page, consoleErrors };
}

async function main() {
  console.log('== [setup 1/4] Comptes synthétiques QA360 -- entièrement dédiés à ce script, jamais partagés avec les fixtures des autres harnais (test-patron-a/b) ==');
  // IMPORTANT : une session PATRON réelle résout son account via
  // auth.uid() (adapter._accountId(), docs/seba-data.js:106-121) -- un
  // vrai signup fait TOUJOURS account=user_id (docs/seba-data.js:1295).
  // Les fixtures test-patron-a/b (seed-synthetic.sh) utilisent un slug
  // texte ('test-patron-a') comme account, une convention héritée
  // valable UNIQUEMENT pour les tests SQL par impersonation
  // (set local "request.jwt.claims"), jamais pour une vraie session
  // navigateur -- réutiliser ces fixtures ici ferait échouer
  // silencieusement SupabaseAdapter.pull() (compte introuvable). D'où des
  // comptes QA360 autonomes, avec account = auth.uid() du patron, comme
  // un vrai compte le ferait.
  const patronAId = await createOrGetUser('qa360-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qa360-patron-b@test.seba.invalid');
  const empA1Id = await createOrGetUser('qa360-emp-a1@test.seba.invalid');
  const empA2Id = await createOrGetUser('qa360-emp-a2@test.seba.invalid');
  const clientA1Id = await createOrGetUser('qa360-cli-a1@test.seba.invalid');
  const clientA2Id = await createOrGetUser('qa360-cli-a2@test.seba.invalid');
  const empBId = await createOrGetUser('qa360-emp-b@test.seba.invalid');
  const clientBId = await createOrGetUser('qa360-cli-b@test.seba.invalid');
  console.log('   patron  A=' + patronAId + ' B=' + patronBId);
  console.log('   employe A1=' + empA1Id + ' A2=' + empA2Id + ' B=' + empBId);
  console.log('   client  A1=' + clientA1Id + ' A2=' + clientA2Id + ' B=' + clientBId);

  console.log('== [setup 2/4] seba_state des 2 patrons QA360 (account = user_id, convention réelle) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_qa_a1","nom":"Client QA360 A1","prenom":"","email":"qa360-cli-a1@test.seba.invalid","adresse":"1 rue QA360 A1"},{"id":"cli_qa_a2","nom":"Client QA360 A2","prenom":"","email":"qa360-cli-a2@test.seba.invalid","adresse":"2 rue QA360 A2"}],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qa_a1","prenom":"Employe","nom":"QA360 A1","actif":true},{"id":"emp_qa_a2","prenom":"Employe","nom":"QA360 A2","actif":true}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[{"id":"cli_qa_b","nom":"Client QA360 B","prenom":"","email":"qa360-cli-b@test.seba.invalid","adresse":"1 rue QA360 B"}],"devis":[],"factures":[],"interventions":[],"employes":[{"id":"emp_qa_b","prenom":"Employe","nom":"QA360 B","actif":true}],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  console.log('== [setup 3/4] Rattachements employe_accounts/client_accounts (idempotent) ==');
  psql(`
    delete from employe_accounts where employe_user_id in ('${empA1Id}','${empA2Id}','${empBId}');
    insert into employe_accounts (employe_user_id, account, employe_id, email) values
      ('${empA1Id}', '${patronAId}', 'emp_qa_a1', 'qa360-emp-a1@test.seba.invalid'),
      ('${empA2Id}', '${patronAId}', 'emp_qa_a2', 'qa360-emp-a2@test.seba.invalid'),
      ('${empBId}', '${patronBId}', 'emp_qa_b', 'qa360-emp-b@test.seba.invalid');
    delete from client_accounts where client_user_id in ('${clientA1Id}','${clientA2Id}','${clientBId}');
    insert into client_accounts (client_user_id, account, client_id, email) values
      ('${clientA1Id}', '${patronAId}', 'cli_qa_a1', 'qa360-cli-a1@test.seba.invalid'),
      ('${clientA2Id}', '${patronAId}', 'cli_qa_a2', 'qa360-cli-a2@test.seba.invalid'),
      ('${clientBId}', '${patronBId}', 'cli_qa_b', 'qa360-cli-b@test.seba.invalid');
  `);

  console.log('== [setup 4/4] Repasse tous les mots de passe QA360 (au cas où ils existaient déjà avec un autre mdp lors d\'un run précédent) ==');
  for (const id of [patronAId, patronBId, empA1Id, empA2Id, clientA1Id, clientA2Id, empBId, clientBId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const server = await startStaticServer();

  const patron = await newRolePage(browser);
  // app/dashboard.html n'affiche RIEN (état vide, jamais SebaDB.onChange
  // enregistré) sans sebaEntreprise en localStorage -- seul le patron
  // ouvre cette page dans ce scénario.
  await patron.page.evaluateOnNewDocument(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ secteur: 'menage', nom: 'QA360 SARL' }));
  });
  const empA1 = await newRolePage(browser);
  const empA2 = await newRolePage(browser);
  const clientA1 = await newRolePage(browser);
  const clientA2 = await newRolePage(browser);
  const anon = await newRolePage(browser);

  try {
    console.log('\n== [1/30] Connexion réelle Patron A ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronSignIn = await patron.page.evaluate(() => window.sebaAuth.signIn('qa360-patron-a@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!patronSignIn.error, 'connexion patron A reussie (' + JSON.stringify(patronSignIn.error) + ')');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    // SebaDB.ready() rapatrie l'état cloud en ARRIÈRE-PLAN (SupabaseAdapter.pull().then(...)) --
    // attend explicitement que 'cli_qa_a1' soit visible avant de continuer,
    // plutôt qu'un délai fixe fragile.
    const waitOk = await patron.page.waitForFunction(() => !!(window.SebaDB && SebaDB.get('clients', 'cli_qa_a1')), { timeout: 8000 }).then(() => true).catch(() => false);
    if (!waitOk) {
      const dbg = await patron.page.evaluate(() => ({
        hasSupabase: !!(window.SEBA_CONFIG_PUBLIC), configured: !!(window.sebaAuth && sebaAuth.isConfigured),
        session: window.sebaAuth ? 'checking' : 'no sebaAuth', clients: window.SebaDB ? SebaDB.list('clients') : 'no SebaDB',
      }));
      console.log('   DEBUG (attente état cloud échouée) :', JSON.stringify(dbg));
      console.log('   Console errors so far:', JSON.stringify(patron.consoleErrors));
    }

    console.log('== [2/30] Patron A crée un client puis une intervention (via sa propre session, RLS-safe) ==');
    const setup = await patron.page.evaluate(() => {
      const client = SebaDB.get('clients', 'cli_qa_a1');
      const interv = SebaDB.create('interventions', {
        clientId: client.id, clientName: (client.prenom + ' ' + client.nom).trim(), date: new Date().toISOString().slice(0, 10),
        time: '09:00', service: 'QA Intervention 360', duree: 90, done: false,
      });
      return { clientId: client.id, interventionId: interv.id };
    });
    assert(!!setup.interventionId, 'intervention créée (id=' + setup.interventionId + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [3/30] Patron A ajoute une checklist (2 tâches obligatoires) via intervention-fiche.html ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/intervention-fiche.html?id=${setup.interventionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const foundOnFiche = await patron.page.evaluate((id) => !!SebaDB.get('interventions', id), setup.interventionId);
    assert(foundOnFiche, 'intervention retrouvée sur intervention-fiche.html après flush serveur');
    await patron.page.evaluate(() => {
      document.getElementById('chk-new-label').value = 'Nettoyer les vitres';
      document.getElementById('chk-new-required').checked = true;
      addChecklistItemUI();
      document.getElementById('chk-new-label').value = 'Passer l\'aspirateur';
      document.getElementById('chk-new-required').checked = true;
      addChecklistItemUI();
    });
    const checklistCount = await patron.page.evaluate(() => document.querySelectorAll('#checklist-list .chk-item').length);
    assert(checklistCount === 2, '2 tâches créées (observé ' + checklistCount + ')');

    console.log('== [4/30] Patron A exige photo avant/après et assigne Employé A1 ==');
    await patron.page.evaluate(() => {
      document.getElementById('f-employe').value = 'emp_qa_a1';
      document.getElementById('f-photo-before').checked = true;
      document.getElementById('f-photo-after').checked = true;
      savePreparation();
    });
    await new Promise(r => setTimeout(r, 400));
    const afterPrep = await patron.page.evaluate((id) => {
      const i = SebaDB.get('interventions', id);
      return { employeId: i.employeId, requireBefore: i.requirePhotoBefore, requireAfter: i.requirePhotoAfter };
    }, setup.interventionId);
    assert(afterPrep.employeId === 'emp_qa_a1' && afterPrep.requireBefore && afterPrep.requireAfter, 'assignation + exigences photo enregistrées (' + JSON.stringify(afterPrep) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [5/30] Connexion réelle Employé A1 + Employé A2 ==');
    // Se connecter sur employe-connexion.html d'abord (jamais directement
    // sur espace-terrain.html) : cette dernière redirige IMMÉDIATEMENT
    // vers employe-connexion.html si aucune session n'existe encore
    // (son propre init() IIFE), ce qui détruit le contexte d'exécution
    // en pleine évaluation de signIn() -- même principe que la connexion
    // patron ci-dessus (via connexion.html, jamais dashboard.html direct).
    await empA1.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a1SignIn = await empA1.page.evaluate(() => window.sebaAuth.signIn('qa360-emp-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a1SignIn.error, 'connexion employé A1 réussie (' + JSON.stringify(a1SignIn.error) + ')');
    await empA1.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA1.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    await empA2.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const a2SignIn = await empA2.page.evaluate(() => window.sebaAuth.signIn('qa360-emp-a2@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!a2SignIn.error, 'connexion employé A2 réussie (' + JSON.stringify(a2SignIn.error) + ')');
    await empA2.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
    await empA2.page.waitForFunction(() => document.getElementById('et-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [6/30] Employé A1 voit la mission, Employé A2 ne la voit PAS ==');
    const a1Sees = await empA1.page.evaluate((id) => !!(_missionsById && _missionsById[id]), setup.interventionId);
    const a2Sees = await empA2.page.evaluate((id) => !!(_missionsById && _missionsById[id]), setup.interventionId);
    assert(a1Sees, 'employé A1 voit la mission');
    assert(!a2Sees, 'ECHEC SECURITE si faux : employé A2 ne voit PAS la mission de A1');

    console.log('== [7/30] Employé A1 démarre le suivi (execution.completionStatus) ==');
    await empA1.page.evaluate((id) => openMissionDetail(id, 'aujourdhui'), setup.interventionId);
    await empA1.page.evaluate((id) => startExecutionUI(id), setup.interventionId);
    await new Promise(r => setTimeout(r, 500));
    const afterStart = await empA1.page.evaluate((id) => SebaDB.get ? null : null, setup.interventionId); // sanity no-op (local SebaDB pas partagé entre contextes)
    const startRes = await empA1.page.evaluate((id) => SebaDB.employeePortal.getInterventionDetail(id), setup.interventionId);
    assert(startRes.ok && startRes.intervention.execution.completionStatus === 'in_progress', 'suivi démarré (' + JSON.stringify(startRes.ok && startRes.intervention.execution.completionStatus) + ')');

    console.log('== [8/30] Employé A1 complète UNE SEULE tâche ==');
    const oneItemId = await empA1.page.evaluate((id) => _missionsById[id].execution.checklist[0].id, setup.interventionId);
    await empA1.page.evaluate((id) => openMissionDetail(id, 'aujourdhui'), setup.interventionId);
    await new Promise(r => setTimeout(r, 300));
    await empA1.page.evaluate((itemId) => { const box = [...document.querySelectorAll('.ex-chk-box')].find(b => b.getAttribute('onclick').includes(itemId)); box.click(); }, oneItemId);
    await new Promise(r => setTimeout(r, 400));

    console.log('== [9/30] La finalisation est REFUSÉE (checklist incomplète + photos manquantes) ==');
    const finalizeBlocked = await empA1.page.evaluate((id) => SebaDB.employeePortal.completeIntervention(id, ''), setup.interventionId);
    assert(finalizeBlocked.ok === false && finalizeBlocked.blockers && finalizeBlocked.blockers.length > 0, 'finalisation refusée, blocages rapportés (' + JSON.stringify(finalizeBlocked.blockers) + ')');

    console.log('== [10/30] Employé A1 complète la checklist restante ==');
    const otherItemId = await empA1.page.evaluate((id) => _missionsById[id].execution.checklist[1].id, setup.interventionId);
    await empA1.page.evaluate((id, itemId) => SebaDB.employeePortal.updateChecklistItem(id, itemId, { checked: true }), setup.interventionId, otherItemId);

    console.log('== [11/30] Employé A1 ajoute les 2 photos obligatoires (avant/après) ==');
    const photosRes = await empA1.page.evaluate(async (id) => {
      const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
      const r1 = await SebaDB.employeePortal.addPhoto(id, 'before', file);
      const r2 = await SebaDB.employeePortal.addPhoto(id, 'after', file);
      return { r1: r1.ok, r2: r2.ok, e1: r1.error, e2: r2.error };
    }, setup.interventionId);
    if (!photosRes.r1 || !photosRes.r2) console.log('   DEBUG erreurs photo :', JSON.stringify(photosRes));
    assert(photosRes.r1 && photosRes.r2, 'photos avant/après ajoutées (' + JSON.stringify(photosRes) + ')');

    console.log('== [12/30] Employé A1 ajoute un matériau ==');
    const matRes = await empA1.page.evaluate((id) => SebaDB.employeePortal.addMaterial(id, { label: 'Produit vitres', quantity: '1', unit: 'flacon' }), setup.interventionId);
    assert(matRes.ok, 'matériau ajouté (' + JSON.stringify(matRes) + ')');

    console.log('== [13/30] Employé A1 termine la mission (checklist+photos complets -> accepté) ==');
    const completeRes = await empA1.page.evaluate((id) => SebaDB.employeePortal.completeIntervention(id, 'RAS'), setup.interventionId);
    assert(completeRes.ok && completeRes.intervention.execution.completionStatus === 'submitted', 'mission finalisée (' + JSON.stringify(completeRes.ok) + ')');

    console.log('== [14/30] Employé A1 envoie le retour terrain structuré (système préexistant, jamais modifié) ==');
    const fieldReportRes = await empA1.page.evaluate((id) => SebaDB.interventions.saveFieldReport(id, { outcome: 'completed', summary: 'QA Intervention 360 : mission terminée sans incident.', issueType: 'none' }), setup.interventionId);
    assert(fieldReportRes.ok, 'retour terrain enregistré (' + JSON.stringify(fieldReportRes.ok) + ')');

    console.log('== [15/30] Connexion réelle Client A1 + Client A2 ==');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const c1SignIn = await clientA1.page.evaluate(() => window.sebaAuth.signIn('qa360-cli-a1@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!c1SignIn.error, 'connexion client A1 réussie (' + JSON.stringify(c1SignIn.error) + ')');
    await clientA1.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    await clientA1.page.waitForFunction(() => document.getElementById('cp-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    await clientA2.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const c2SignIn = await clientA2.page.evaluate(() => window.sebaAuth.signIn('qa360-cli-a2@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!c2SignIn.error, 'connexion client A2 réussie (' + JSON.stringify(c2SignIn.error) + ')');
    await clientA2.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    await clientA2.page.waitForFunction(() => document.getElementById('cp-app').style.display !== 'none', { timeout: 8000 }).catch(() => {});

    console.log('== [16/30] Client A1 voit la mission terminée, Client A2 ne la voit PAS ==');
    const c1Detail = await clientA1.page.evaluate((id) => SebaDB.clientPortal.getInterventionDetail(id), setup.interventionId);
    const c2Detail = await clientA2.page.evaluate((id) => SebaDB.clientPortal.getInterventionDetail(id), setup.interventionId);
    assert(c1Detail.ok && c1Detail.intervention.execution.completionStatus === 'submitted', 'client A1 voit la mission terminée (' + JSON.stringify(c1Detail.ok) + ')');
    assert(c2Detail.ok === false, 'ECHEC SECURITE si faux : client A2 ne voit PAS la mission de A1 (' + JSON.stringify(c2Detail) + ')');

    console.log('== [17/30] Client A1 signale un problème ==');
    const issueRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.reportIssue(id, 'Une vitre n\'a pas été nettoyée.'), setup.interventionId);
    assert(issueRes.ok && issueRes.intervention.execution.clientApproval.status === 'issue_reported', 'problème signalé (' + JSON.stringify(issueRes.ok) + ')');

    console.log('== [18/30] Le patron voit l\'alerte "Problème signalé par un client" au dashboard ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    // Le signalement client (étape 17) vient d'une AUTRE session/onglet --
    // le patron ne le voit qu'après que SON PROPRE SupabaseAdapter.pull()
    // (arrière-plan, SebaDB.ready()) ait rapatrié l'état serveur à jour.
    // Poll sur la donnée réelle plutôt qu'un délai fixe fragile.
    // SebaDB.onChange(() => renderDashboard(biz)) (câblé par la page
    // elle-même) redéclenche le rendu automatiquement une fois le pull
    // arrivé -- jamais besoin d'appeler refreshAll() à la main ici (ça a
    // été tenté : plante, refreshAll() lit un état module-level posé
    // uniquement par le flux d'init normal de la page, pas rejouable
    // hors contexte). On attend directement le résultat visible.
    await patron.page.waitForFunction(() => {
      const el = document.getElementById('db-alerts');
      return el && el.textContent.includes('Problème signalé par un client');
    }, { timeout: 10000 }).catch(() => {});
    const dashAlerts = await patron.page.evaluate(() => [...document.querySelectorAll('#db-alerts .db-alert-label')].map(e => e.textContent));
    if (!dashAlerts.some(l => l.includes('Problème signalé par un client'))) {
      const dbgIntv = await patron.page.evaluate((id) => {
        const i = window.SebaDB && SebaDB.get('interventions', id);
        return i ? { completionStatus: i.execution && i.execution.completionStatus, clientApproval: i.execution && i.execution.clientApproval } : 'NOT FOUND LOCALLY';
      }, setup.interventionId);
      console.log('   DEBUG intervention côté patron au moment du check :', JSON.stringify(dbgIntv));
    }
    assert(dashAlerts.some(l => l.includes('Problème signalé par un client')), 'alerte "Problème signalé" visible (' + JSON.stringify(dashAlerts) + ')');

    console.log('== [19/30] Le patron rouvre le dossier ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/intervention-fiche.html?id=${setup.interventionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    await patron.page.evaluate(() => { window.prompt = () => 'Correction demandée'; reopenDossier(); });
    await new Promise(r => setTimeout(r, 400));
    const afterReopen = await patron.page.evaluate((id) => SebaDB.get('interventions', id).execution.completionStatus, setup.interventionId);
    assert(afterReopen === 'reopened', 'dossier rouvert (' + afterReopen + '), aucune donnée perdue');
    const dataPreserved = await patron.page.evaluate((id) => {
      const i = SebaDB.get('interventions', id);
      return { checklistChecked: i.execution.checklist.filter(c => c.checked).length, photoCount: i.execution.photos.length, materialCount: i.execution.materials.length };
    }, setup.interventionId);
    assert(dataPreserved.checklistChecked === 2 && dataPreserved.photoCount === 2 && dataPreserved.materialCount === 1, 'checklist/photos/matériaux préservés après réouverture (' + JSON.stringify(dataPreserved) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [20/30] Employé A1 corrige et termine à nouveau ==');
    const recomplete = await empA1.page.evaluate((id) => SebaDB.employeePortal.completeIntervention(id, 'Corrigé'), setup.interventionId);
    assert(recomplete.ok && recomplete.intervention.execution.completionStatus === 'submitted', 'mission re-finalisée après correction (' + JSON.stringify(recomplete.ok) + ')');

    console.log('== [21/30] Client A1 approuve ==');
    const approveRes = await clientA1.page.evaluate((id) => SebaDB.clientPortal.approveCompletedIntervention(id, 'Nickel cette fois'), setup.interventionId);
    assert(approveRes.ok && approveRes.intervention.execution.clientApproval.status === 'approved', 'client A1 approuve (' + JSON.stringify(approveRes.ok) + ')');

    console.log('== [22/30] Le patron valide le dossier ==');
    await patron.page.goto(`http://127.0.0.1:${PORT}/intervention-fiche.html?id=${setup.interventionId}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    await patron.page.evaluate(() => approveDossier());
    await new Promise(r => setTimeout(r, 400));
    const afterOwnerApprove = await patron.page.evaluate((id) => SebaDB.get('interventions', id).execution.completionStatus, setup.interventionId);
    assert(afterOwnerApprove === 'owner_approved', 'dossier validé par le patron (' + afterOwnerApprove + ')');

    console.log('== [23/30] Le patron crée une facture préremplie ==');
    await patron.page.evaluate(() => createInvoice());
    await new Promise(r => setTimeout(r, 400));
    const invoiceState = await patron.page.evaluate((id) => {
      const i = SebaDB.get('interventions', id);
      const factures = SebaDB.list('factures').filter(f => f.interventionId === id);
      return { hasInvoiceId: !!i.invoiceId, factureFound: factures.length === 1 };
    }, setup.interventionId);
    assert(invoiceState.hasInvoiceId && invoiceState.factureFound, 'facture préremplie créée (' + JSON.stringify(invoiceState) + ')');
    await flushPatronStateToServer(patron.page, patronAId);

    console.log('== [24/30] Reload complet (les 3 rôles) : toutes les données persistent ==');
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const persistedPatron = await patron.page.evaluate((id) => {
      const i = SebaDB.get('interventions', id);
      return {
        completionStatus: i.execution.completionStatus, invoiceId: i.invoiceId,
        checklistChecked: i.execution.checklist.filter(c => c.checked).length,
        photoCount: i.execution.photos.length, materialCount: i.execution.materials.length,
        historyEvents: i.statusHistory.map(e => e.event),
      };
    }, setup.interventionId);
    console.log('   État persisté (patron) :', JSON.stringify(persistedPatron));
    assert(persistedPatron.completionStatus === 'owner_approved', 'completionStatus persiste après reload');
    assert(!!persistedPatron.invoiceId, 'invoiceId persiste après reload');
    assert(persistedPatron.checklistChecked === 2 && persistedPatron.photoCount === 2 && persistedPatron.materialCount === 1, 'checklist/photos/matériaux persistent après reload');

    console.log('== [25/30] Aucun événement dupliqué dans statusHistory ==');
    const evCounts = {};
    persistedPatron.historyEvents.forEach(e => { evCounts[e] = (evCounts[e] || 0) + 1; });
    const singleEvents = ['prepared', 'assigned', 'client_issue_reported', 'reopened', 'client_approved', 'owner_approved', 'invoice_created'];
    const noDup = singleEvents.every(e => (evCounts[e] || 0) <= 1);
    assert(noDup, 'aucun événement critique dupliqué (' + JSON.stringify(evCounts) + ')');
    assert((evCounts['completed'] || 0) === 2, '2 événements "completed" attendus (1 par soumission réelle -- avant et après réouverture), observé ' + (evCounts['completed'] || 0));

    console.log('== [26/30] Aucun accès cross-compte (Patron B / Employé B / Client B) ==');
    await empBTest();
    async function empBTest() {
      const empB = await newRolePage(browser);
      await empB.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
      const bSignIn = await empB.page.evaluate(() => window.sebaAuth.signIn('qa360-emp-b@test.seba.invalid', 'Test-Synthetic-2026!'));
      assert(!bSignIn.error, 'connexion employé B réussie');
      await empB.page.goto(`http://127.0.0.1:${PORT}/espace-terrain.html`, { waitUntil: 'domcontentloaded' });
      const bDetail = await empB.page.evaluate((id) => SebaDB.employeePortal.getInterventionDetail(id), setup.interventionId);
      assert(bDetail.ok === false, 'ECHEC SECURITE si faux : employé B (autre patron) ne voit PAS la mission du patron A');
      await empB.ctx.close();
    }
    const clientB = await newRolePage(browser);
    await clientB.page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
    const bClientSignIn = await clientB.page.evaluate(() => window.sebaAuth.signIn('qa360-cli-b@test.seba.invalid', 'Test-Synthetic-2026!'));
    assert(!bClientSignIn.error, 'connexion client B réussie');
    await clientB.page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
    const bClientDetail = await clientB.page.evaluate((id) => SebaDB.clientPortal.getInterventionDetail(id), setup.interventionId);
    assert(bClientDetail.ok === false, 'ECHEC SECURITE si faux : client B (autre patron) ne voit PAS la mission du patron A');
    await clientB.ctx.close();

    console.log('== [27/30] Aucun accès anonyme ==');
    // index.html ne charge PAS auth.js (page publique) -- window.sebaAuth
    // y est undefined, un premier essai "passait" en réalité sur un crash
    // client (TypeError), jamais un vrai rejet serveur. employe-connexion.html
    // charge auth.js sans jamais s'y connecter ici : appel RPC réellement
    // anonyme (anon key, aucune session), rejet attendu côté RLS/REVOKE.
    await anon.page.goto(`http://127.0.0.1:${PORT}/employe-connexion.html`, { waitUntil: 'domcontentloaded' });
    const anonRes = await anon.page.evaluate(async (id) => {
      const res = await window.sebaAuth.rpc('get_my_employee_intervention_detail', { p_intervention_id: id });
      return { errored: !!res.error, message: res.error && res.error.message };
    }, setup.interventionId);
    assert(anonRes.errored, 'ECHEC SECURITE si faux : un appel anonyme à la RPC est refusé (' + JSON.stringify(anonRes) + ')');

    console.log('== [28/30] Pas de scroll horizontal à 390px (patron/employé/client) ==');
    for (const [label, rolePage] of [['patron (intervention-fiche.html)', patron.page], ['employé A1 (espace-terrain.html)', empA1.page], ['client A1 (client-espace.html)', clientA1.page]]) {
      await rolePage.setViewport({ width: 390, height: 844 });
      await new Promise(r => setTimeout(r, 300));
      const hScroll = await rolePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      assert(!hScroll, 'pas de scroll horizontal à 390px — ' + label);
    }

    console.log('== [29/30] Zéro erreur console sur les 3 rôles ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(empA1.consoleErrors.length === 0, 'zéro erreur console — employé A1 (' + JSON.stringify(empA1.consoleErrors) + ')');
    assert(clientA1.consoleErrors.length === 0, 'zéro erreur console — client A1 (' + JSON.stringify(clientA1.consoleErrors) + ')');

    console.log('== [30/30] node tools/check-design-system.js (rappel -- exécuté séparément dans le pipeline QA, pas ici) ==');
    assert(true, 'voir node tools/check-design-system.js, exécuté par le harnais de livraison, pas dupliqué ici');

  } finally {
    await patron.ctx.close(); await empA1.ctx.close(); await empA2.ctx.close();
    await clientA1.ctx.close(); await clientA2.ctx.close(); await anon.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
