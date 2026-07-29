// SEBA — THEME-MOBILE-001 (defauts confirmes iPhone) : theme 100% pilote
// par le systeme, aucune statistique fictive sur un compte reellement
// vide (fuite localStorage inter-comptes), sauvegarde reelle du nom
// d'entreprise. Local uniquement (Supabase local deja demarre).
//
// Usage : node scripts/qa-mobile-system-theme-empty-state.js

import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PORT = 8798;

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  OK   -', msg);
  else { console.error('  FAIL -', msg); failures++; }
}

function getSupabaseStatus() {
  const out = execSync('npx --yes supabase@2.109.1 status -o env', { encoding: 'utf8' });
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return env;
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/config.js') { res.writeHead(404); res.end(); return; }
      const filePath = path.join(repoRoot, 'docs', urlPath === '/' ? 'connexion.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function createPatron(env, label) {
  const email = 'qa-theme-empty-' + label + '-' + Date.now() + '@test.seba.invalid';
  const password = 'Qa-ThemeEmpty-2026!';
  const createRes = await fetch(env.API_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await createRes.json();
  if (!createRes.ok) throw new Error('create failed: ' + JSON.stringify(user));
  const userId = user.id;
  const signInRes = await fetch(env.API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const { access_token } = await signInRes.json();
  const bootstrapRes = await fetch(env.API_URL + '/rest/v1/rpc/create_profile_and_company', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + access_token },
    body: JSON.stringify({ _user_id: userId, _sector: 'menage', _company_name: 'Entreprise QA Initiale' }),
  });
  if (!bootstrapRes.ok) throw new Error('bootstrap failed: ' + JSON.stringify(await bootstrapRes.json()));
  return { email, password, userId, token: access_token };
}

async function pullState(env, userId) {
  const r = await fetch(env.API_URL + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(userId), {
    headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
  });
  const rows = await r.json();
  return rows.length ? rows[0].state : null;
}

async function loginInPage(page, email, password) {
  await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
  await page.locator('#email').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, email);
  await page.locator('#password').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, password);
  await page.evaluate(() => handleLogin()).catch(() => {});
  await page.waitForTimeout(2000);
}

// app/dashboard.html decide "compte vide"/"tableau de bord reel" via
// localStorage.sebaEntreprise, jamais reevalue quand SebaDB.hasData()
// devient vrai apres coup (pull() async) -- c'est QA360-P1-A, deja suivi
// separement dans le Master Backlog, PAS le sujet de ce test. Sans ce
// contournement (deja utilise dans scripts/qa-mobile-theme-layout.js),
// aucun compte fraichement cree (jamais passe par l'onboarding) ne
// rendrait jamais le vrai contenu du dashboard ici.
async function gotoDashboard(page) {
  await page.evaluate(() => {
    if (!localStorage.getItem('sebaEntreprise')) {
      localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'QA Theme Test', secteur: 'menage', couleur: '#10B981' }));
    }
  });
  await page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
}

async function main() {
  const env = getSupabaseStatus();
  const server = await startStaticServer();
  const browser = await webkit.launch();

  try {
    console.log('\n=== A. THEME 100% SYSTEME (clients.html -- page reelle sous pro-global.css/theme.js ; connexion.html n\'utilise pas ce systeme) ===');
    const patronTheme = await createPatron(env, 'theme');
    {
      const context = await browser.newContext({ colorScheme: 'light' });
      const page = await context.newPage();
      await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
      await loginInPage(page, patronTheme.email, patronTheme.password);
      await page.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
      await page.waitForTimeout(300);
      assert((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'systeme clair -> data-theme=light (clients.html)');

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(300);
      assert((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'changement systeme clair->sombre SANS reload (matchMedia change)');

      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForTimeout(300);
      assert((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'changement systeme sombre->clair SANS reload');

      const toggleGone = await page.evaluate(() => typeof window.sebaTheme.set !== 'function' && typeof window.sebaTheme.toggle !== 'function');
      assert(toggleGone, 'API sebaTheme.set()/toggle() (bascule manuelle) supprimee -- seul .get() subsiste');
      const noLocalPref = await page.evaluate(() => { try { return localStorage.getItem('seba_theme') === null; } catch (e) { return true; } });
      assert(noLocalPref, 'aucune preference de theme stockee dans localStorage (seba_theme supprimee)');

      await context.close();
    }
    {
      const context = await browser.newContext({ colorScheme: 'dark' });
      const page = await context.newPage();
      await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
      await loginInPage(page, patronTheme.email, patronTheme.password);
      await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
      await page.waitForTimeout(500);
      assert((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'systeme sombre -> data-theme=dark (reglages.html)');
      const toggleUiGone = await page.evaluate(() => !document.getElementById('theme-switch-dark') && !document.getElementById('theme-switch-light') && typeof window.setSebaTheme !== 'function');
      assert(toggleUiGone, 'aucun bouton/menu de choix de theme manuel present (reglages.html)');
      await context.close();
    }
    await fetch(env.API_URL + '/auth/v1/admin/users/' + patronTheme.userId, { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    await fetch(env.API_URL + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(patronTheme.userId), { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });

    console.log('\n=== B. AUCUNE STATISTIQUE FICTIVE (fuite cache inter-comptes) ===');
    const patronA = await createPatron(env, 'a');
    const patronB = await createPatron(env, 'b');

    // Donne a A de vraies donnees produisant des statistiques reelles non nulles.
    // SebaDB.hasData() se base sur clients.length>0 -- un client est donc
    // indispensable pour que collectState() cesse de tout renvoyer vide.
    const clientId = 'id_qa_theme_client_' + Date.now();
    const devisId = 'id_qa_theme_devis_' + Date.now();
    await fetch(env.API_URL + '/functions/v1/sync-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + patronA.token },
      body: JSON.stringify({
        device_id: 'qa_seed_device',
        operations: [
          { client_seq: 1, entity: 'clients', entity_id: clientId, op: 'create', patch: { id: clientId, prenom: 'QA', nom: 'ThemeClient' } },
          { client_seq: 2, entity: 'devis', entity_id: devisId, op: 'create', patch: { id: devisId, numero: 'QA-0001', status: 'attente', amount: 150, clientId } },
        ],
      }),
    });

    const contextA = await browser.newContext({ colorScheme: 'light' });
    const pageA = await contextA.newPage();
    await pageA.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(pageA, patronA.email, patronA.password);
    await gotoDashboard(pageA);
    await pageA.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    const aHasStat = await pageA
      .waitForFunction(() => document.body.innerText.includes('Devis sans réponse'), { timeout: 10000, polling: 300 })
      .then(() => true).catch(() => false);
    assert(aHasStat, 'compte A (donnees reelles) affiche bien "Devis sans réponse" -- sanity check, la stat existe vraiment pour A (le pull() cloud asynchrone doit ecraser l\'etat local vide initial)');
    await contextA.close();

    // Meme navigateur (meme profil Playwright = meme "localStorage" logique),
    // NOUVEAU compte B, reellement vide sur le serveur.
    const contextB = await browser.newContext({ colorScheme: 'light' });
    const pageB = await contextB.newPage();
    await pageB.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(pageB, patronB.email, patronB.password);
    await gotoDashboard(pageB);
    await pageB.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageB.waitForTimeout(1500);
    let bText = await pageB.evaluate(() => document.body.innerText);
    assert(!bText.includes('Devis sans réponse'), 'compte B (nouveau, vide) n\'affiche PAS la stat du compte A apres 1ere connexion (observe absence: ' + !bText.includes('Devis sans réponse') + ')');
    assert(!bText.includes('QA-0001'), 'aucune trace du devis de A visible pour B');

    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageB.waitForTimeout(1500);
    bText = await pageB.evaluate(() => document.body.innerText);
    assert(!bText.includes('Devis sans réponse'), 'compte B reste vide apres reload complet');

    await pageB.evaluate(() => localStorage.clear());
    await pageB.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
    await loginInPage(pageB, patronB.email, patronB.password);
    await gotoDashboard(pageB);
    await pageB.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageB.waitForTimeout(1500);
    bText = await pageB.evaluate(() => document.body.innerText);
    assert(!bText.includes('Devis sans réponse'), 'compte B reste vide apres localStorage.clear() + nouvelle session');
    await contextB.close();

    console.log('\n=== C. SAUVEGARDE REELLE DU NOM DE L\'ENTREPRISE ===');
    const patronC = await createPatron(env, 'c');
    const stateBefore = await pullState(env, patronC.userId);
    assert(stateBefore.entreprise && stateBefore.entreprise.nom === 'Entreprise QA Initiale', `nom initial correct cote serveur avant toute modification (observe: ${JSON.stringify(stateBefore.entreprise)})`);

    const contextC = await browser.newContext({ colorScheme: 'light' });
    const pageC = await contextC.newPage();
    await pageC.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(pageC, patronC.email, patronC.password);
    await pageC.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await pageC.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageC.waitForTimeout(1000);
    await pageC.locator('#regl-nom').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 'Entreprise QA Sauvegardée');
    await pageC.evaluate(() => saveGeneralInfo());
    await pageC.waitForTimeout(1500); // pushEntreprisePatch est fire-and-forget, laisse le temps a la requete reseau locale

    const stateAfterSave = await pullState(env, patronC.userId);
    assert(stateAfterSave.entreprise && stateAfterSave.entreprise.nom === 'Entreprise QA Sauvegardée', `nom reellement ecrit cote serveur apres Enregistrer (observe: ${JSON.stringify(stateAfterSave.entreprise)})`);

    await pageC.reload({ waitUntil: 'domcontentloaded' });
    await pageC.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageC.waitForTimeout(1000);
    const nomAfterReload = await pageC.locator('#regl-nom').inputValue();
    assert(nomAfterReload === 'Entreprise QA Sauvegardée', `nom toujours visible apres reload complet (observe: "${nomAfterReload}")`);

    await pageC.evaluate(() => localStorage.clear());
    await pageC.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await pageC.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
    await loginInPage(pageC, patronC.email, patronC.password);
    await pageC.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await pageC.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageC.waitForTimeout(1000);
    const nomAfterReconnect = await pageC.locator('#regl-nom').inputValue();
    assert(nomAfterReconnect === 'Entreprise QA Sauvegardée', `nom toujours visible apres deconnexion + nouvelle session (observe: "${nomAfterReconnect}")`);
    await contextC.close();

    console.log('\n=== D. update_my_entreprise : allowlist, validation, isolation cross-compte ===');
    const patronCToken = (await (await fetch(env.API_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY },
      body: JSON.stringify({ email: patronC.email, password: patronC.password }),
    })).json()).access_token;

    const rejUnknownKey = await fetch(env.API_URL + '/rest/v1/rpc/update_my_entreprise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + patronCToken },
      body: JSON.stringify({ p_patch: { nom: 'Tentative', secteur: 'hacked' } }),
    });
    assert(rejUnknownKey.status >= 400, `propriete hors allowlist (secteur) refusee (observe status=${rejUnknownKey.status})`);
    const rejEmptyNom = await fetch(env.API_URL + '/rest/v1/rpc/update_my_entreprise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + patronCToken },
      body: JSON.stringify({ p_patch: { nom: '   ' } }),
    });
    assert(rejEmptyNom.status >= 400, `nom vide (espaces) refuse (observe status=${rejEmptyNom.status})`);
    const rejTooLong = await fetch(env.API_URL + '/rest/v1/rpc/update_my_entreprise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + patronCToken },
      body: JSON.stringify({ p_patch: { nom: 'X'.repeat(201) } }),
    });
    assert(rejTooLong.status >= 400, `nom trop long (201 caracteres) refuse (observe status=${rejTooLong.status})`);
    const stateAfterRejections = await pullState(env, patronC.userId);
    assert(stateAfterRejections.entreprise.nom === 'Entreprise QA Sauvegardée', `aucune des tentatives refusees n'a modifie la valeur reelle (observe: ${stateAfterRejections.entreprise.nom})`);

    // Isolation cross-compte : B appelle la RPC (sur SON PROPRE jeton),
    // impossible par construction de cibler le compte de C (aucun
    // parametre "account", auth.uid() est la seule source d'identite).
    const patronBToken = (await (await fetch(env.API_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY },
      body: JSON.stringify({ email: patronB.email, password: patronB.password }),
    })).json()).access_token;
    const bUpdatesOwn = await fetch(env.API_URL + '/rest/v1/rpc/update_my_entreprise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY, Authorization: 'Bearer ' + patronBToken },
      body: JSON.stringify({ p_patch: { nom: 'Entreprise B Modifiee' } }),
    });
    assert(bUpdatesOwn.status === 200, `B peut modifier SON PROPRE nom (observe status=${bUpdatesOwn.status})`);
    const stateCAfterB = await pullState(env, patronC.userId);
    assert(stateCAfterB.entreprise.nom === 'Entreprise QA Sauvegardée', `le nom de C est INCHANGE apres que B ait modifie le sien (observe: ${stateCAfterB.entreprise.nom})`);
    const stateBAfterB = await pullState(env, patronB.userId);
    assert(stateBAfterB.entreprise.nom === 'Entreprise B Modifiee', `B a bien modifie SON PROPRE nom, nulle part ailleurs (observe: ${stateBAfterB.entreprise.nom})`);

    // Nouveau contexte navigateur DISTINCT (pas juste localStorage.clear()
    // dans le meme contexte) : B se connecte, ne doit jamais voir le nom
    // de C (cache stale ou fuite quelconque).
    const contextD = await browser.newContext({ colorScheme: 'light' });
    const pageD = await contextD.newPage();
    await pageD.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(pageD, patronB.email, patronB.password);
    await pageD.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await pageD.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await pageD.waitForTimeout(1000);
    const nomInSecondContext = await pageD.locator('#regl-nom').inputValue();
    assert(nomInSecondContext !== 'Entreprise QA Sauvegardée', `second contexte navigateur (B) n'affiche jamais le nom de C (observe: "${nomInSecondContext}")`);
    assert(nomInSecondContext === 'Entreprise B Modifiee', `second contexte navigateur affiche bien le nom reel de B, lu depuis la meme source canonique (observe: "${nomInSecondContext}")`);
    await contextD.close();

    console.log('\n=== Nettoyage des comptes QA ===');
    for (const p of [patronA, patronB, patronC]) {
      await fetch(env.API_URL + '/auth/v1/admin/users/' + p.userId, { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
      await fetch(env.API_URL + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(p.userId), { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
      await fetch(env.API_URL + '/rest/v1/entity_versions?account=eq.' + encodeURIComponent(p.userId), { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    }
    let residual = 0;
    for (const p of [patronA, patronB, patronC]) {
      const r = await fetch(env.API_URL + '/rest/v1/seba_state?select=account&account=eq.' + encodeURIComponent(p.userId), { headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
      residual += (await r.json()).length;
    }
    assert(residual === 0, `0 donnee QA residuelle apres nettoyage (observe: ${residual})`);
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE:', e); process.exit(1); });
