// SEBA — QA360-P1-A : le portail d'entrée de app/dashboard.html ne doit
// plus se fier uniquement à localStorage.sebaEntreprise pour décider
// "compte vide" (Bienvenue) vs contenu réel -- doit vérifier le serveur
// avant de conclure qu'un compte est vide. Local uniquement (Supabase
// local + docs/ servi statiquement), WebKit + Chromium.
//
// Usage : node scripts/qa-dashboard-empty-state-gate.js

import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PORT = 8803;

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

async function createPatron(env, label, seedRealData) {
  const email = 'qa-gate-' + label.toLowerCase() + '-' + Date.now() + '@test.seba.invalid';
  const password = 'Test-Synthetic-2026!';
  const createRes = await fetch(env.API_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await createRes.json();
  const userId = created.id || (created.user && created.user.id);
  const tokenRes = await fetch(env.API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const tokenData = await tokenRes.json();
  const bootRes = await fetch(env.API_URL + '/rest/v1/rpc/create_profile_and_company', {
    method: 'POST',
    headers: { apikey: env.ANON_KEY, Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _user_id: userId, _sector: 'menage', _company_name: 'Entreprise QA Gate ' + label }),
  });
  if (!bootRes.ok) throw new Error('bootstrap failed for ' + label + ': ' + await bootRes.text());
  if (seedRealData) {
    // Compte "avec données réelles" -- un vrai client, pour confirmer que
    // le contenu affiché après correction du gate est bien réel, pas
    // juste "non vide au sens secteur". Écriture directe service_role
    // (comme les autres scripts QA de ce repo), pas via sync-push/
    // apply_entity_patch (signature différente, pensée pour l'Edge
    // Function, pas pour un seed de test).
    const stateRes = await fetch(env.API_URL + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(userId), {
      headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
    });
    const rows = await stateRes.json();
    const state = rows[0].state;
    state.clients = [{ id: 'cli_gate_test', nom: 'Client Gate Test' }];
    await fetch(env.API_URL + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  }
  return { email, password, userId };
}

async function loginInPage(page, email, password) {
  // Connexion via sebaAuth.signIn() directement depuis connexion.html,
  // SANS jamais appeler handleLogin() -- ce dernier redirige lui-même
  // vers app/dashboard.html dès la connexion réussie, ce qui ferait
  // s'exécuter le correctif testé ici avant même que le test ait pu
  // observer l'état "localStorage absent" (trouvé en testant réellement :
  // 1ère version de ce script échouait sur cette assertion précise,
  // handleLogin() avait déjà navigué et déjà réchauffé le cache par le
  // moment où le test le vérifiait).
  await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
  await page.evaluate(([e, p]) => window.sebaAuth.signIn(e, p), [email, password]);
  await page.waitForTimeout(500);
}

async function main() {
  const env = getSupabaseStatus();
  const server = await startStaticServer();

  console.log('\n=== Préparation des comptes QA ===');
  const patronReal = await createPatron(env, 'Real', true);
  console.log('  patron (données réelles) =', patronReal.userId);

  try {
    for (const [engine, name] of [[webkit, 'webkit'], [chromium, 'chromium']]) {
      console.log(`\n############## ${name} ##############`);
      const browser = await engine.launch();
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);

      await loginInPage(page, patronReal.email, patronReal.password);

      // Point central du test : navigation DIRECTE vers app/dashboard.html
      // SANS jamais écrire localStorage.sebaEntreprise au préalable --
      // aucun contournement, c'est exactement le cas réel "nouvel
      // appareil / cache vidé" que le bug décrivait.
      const before = await page.evaluate(() => localStorage.getItem('sebaEntreprise'));
      assert(before === null, `[${name}] localStorage.sebaEntreprise bien absent avant navigation (cas réel testé, observe: ${before})`);

      await page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });

      // Le contenu réel doit apparaître après résolution serveur -- sans
      // jamais passer par "Bienvenue sur Seba" (qui inviterait à recréer
      // une entreprise déjà existante).
      await page.waitForFunction(() => {
        const dash = document.getElementById('dash-content');
        return dash && getComputedStyle(dash).display !== 'none' && document.getElementById('db-greeting').textContent.includes('Entreprise QA Gate Real');
      }, { timeout: 15000 }).catch(() => {});

      const emptyVisible = await page.locator('#empty-state').evaluate((el) => getComputedStyle(el).display !== 'none');
      const dashVisible = await page.locator('#dash-content').evaluate((el) => getComputedStyle(el).display !== 'none');
      const greeting = await page.locator('#db-greeting').textContent();
      assert(!emptyVisible, `[${name}] "Bienvenue sur Seba" (empty-state) reste masqué pour un compte réel sans cache local (observe display visible: ${emptyVisible})`);
      assert(dashVisible, `[${name}] contenu réel du tableau de bord affiché (observe: ${dashVisible})`);
      assert(greeting.includes('Entreprise QA Gate Real'), `[${name}] le nom réel de l'entreprise apparaît dans le message d'accueil (observe: "${greeting}")`);

      const localStorageNowSet = await page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('sebaEntreprise') || 'null'); } catch (e) { return false; } });
      assert(localStorageNowSet, `[${name}] localStorage.sebaEntreprise réaligné après la vérification serveur (cache réchauffé pour le prochain chargement)`);

      // Reload : le chemin rapide (localStorage maintenant valide) doit
      // fonctionner immédiatement, sans re-déclencher une vérification.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
      await page.waitForTimeout(1000);
      const dashVisibleAfterReload = await page.locator('#dash-content').evaluate((el) => getComputedStyle(el).display !== 'none');
      assert(dashVisibleAfterReload, `[${name}] contenu réel toujours affiché après reload (chemin rapide localStorage)`);

      await browser.close();
    }
  } finally {
    console.log('\n=== Nettoyage ===');
    await fetch(env.API_URL + '/auth/v1/admin/users/' + patronReal.userId, { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    await fetch(env.API_URL + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(patronReal.userId), { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE:', e); process.exit(1); });
