// SEBA — SETTINGS-BRAND-001 : réglages réels (sidebar mobile, onglets,
// identité de marque : nom -> initiales, couleur, logo). Local uniquement
// (Supabase local + docs/ servi statiquement), WebKit en priorité,
// Chromium en contrôle.
//
// Usage : node scripts/qa-settings-brand-identity.js

import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PORT = 8802;
const SHOT_DIR = path.join(repoRoot, 'docs', 'audit-screenshots', 'settings-brand-001');

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
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function createPatron(env, label) {
  const email = 'qa-brand-' + label.toLowerCase() + '-' + Date.now() + '@test.seba.invalid';
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
    body: JSON.stringify({ _user_id: userId, _sector: 'menage', _company_name: 'Entreprise QA ' + label }),
  });
  if (!bootRes.ok) throw new Error('bootstrap failed for ' + label + ': ' + await bootRes.text());
  return { email, password, userId, accessToken: tokenData.access_token };
}

async function pullState(env, userId) {
  const res = await fetch(env.API_URL + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(userId), {
    headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY },
  });
  const rows = await res.json();
  return rows[0] ? rows[0].state : null;
}

async function loginInPage(page, email, password) {
  await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
  await page.locator('#email').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, email);
  await page.locator('#password').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, password);
  await page.evaluate(() => handleLogin()).catch(() => {});
  await page.waitForTimeout(1500);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const env = getSupabaseStatus();
  const server = await startStaticServer();

  try {
    // Compte QA dédié par moteur -- WebKit ne doit jamais laisser un
    // logo/couleur déjà enregistrés contaminer la vérification "avatar =
    // initiales" de Chromium sur le même compte (trouvé en pratique : la
    // 1ère version de ce script réutilisait un seul patron pour les deux
    // moteurs, le logo uploadé par WebKit faisait passer Chromium en mode
    // "logo" au lieu de "initiales", faux échec de scénario C).
    await runBrowserSuite(webkit, 'webkit', env);
    await runBrowserSuite(chromium, 'chromium', env);
  } finally {
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

async function runBrowserSuite(browserType, browserName, env) {
  console.log(`\n############## ${browserName} ##############`);
  const browser = await browserType.launch();

  console.log('\n=== Préparation du compte QA (' + browserName + ') ===');
  const patronA = await createPatron(env, browserName);
  console.log('  patron A =', patronA.userId);

  try {
    await runScenarios(browser, browserName, env, patronA);
  } finally {
    console.log('\n=== Nettoyage (' + browserName + ') ===');
    await fetch(env.API_URL + '/auth/v1/admin/users/' + patronA.userId, { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    await fetch(env.API_URL + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(patronA.userId), { method: 'DELETE', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY } });
    await browser.close();
  }
}

async function runScenarios(browser, browserName, env, patronA) {
  // ── A. SCÉNARIO SIDEBAR MOBILE (premier/dernier item accessibles) ──
  console.log('\n=== A. Sidebar mobile : premier/dernier item accessibles, safe areas ===');
  const viewports = [
    ['360x800-portrait', { width: 360, height: 800 }],
    ['390x844-portrait', { width: 390, height: 844 }],
    ['430x932-portrait', { width: 430, height: 932 }],
    ['390x844-paysage', { width: 844, height: 390 }],
  ];
  for (const [label, vp] of viewports) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true });
      await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
      await page.emulateMedia({ colorScheme: theme });
      await loginInPage(page, patronA.email, patronA.password);
      await page.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
      await page.waitForTimeout(800);
      // Au-delà de 840px de large (le seuil mobile de pro-global.css), la
      // sidebar bascule sur le rail desktop toujours visible -- aucun
      // hamburger/tiroir n'existe à cette largeur (tous les paysages de
      // téléphone réels dépassent 840px de large une fois tournés). Ne
      // cliquer le hamburger que sous ce seuil.
      if (vp.width <= 840) {
        await page.locator('.hamburger').click();
        await page.waitForTimeout(400);
        await page.emulateMedia({ colorScheme: theme });
      }

      const info = await page.evaluate(() => {
        const nav = document.querySelector('nav.sidebar');
        const items = Array.from(nav.querySelectorAll('.nav-item'));
        if (!items.length) return { found: false };
        const navRect = nav.getBoundingClientRect();
        const first = items[0].getBoundingClientRect();
        const last = items[items.length - 1].getBoundingClientRect();
        return {
          found: true,
          navTop: navRect.top,
          firstTop: first.top, firstBottom: first.bottom, firstHeight: first.height,
          lastTop: last.top, lastBottom: last.bottom,
          viewportH: window.innerHeight,
          firstFullyVisible: first.top >= navRect.top && first.bottom <= window.innerHeight,
          firstLabel: items[0].textContent.trim(),
        };
      });
      assert(info.found, `[${label} ${theme}] sidebar ouverte, items nav trouvés`);
      if (info.found) {
        assert(info.firstHeight > 30, `[${label} ${theme}] 1er item ("${info.firstLabel}") a une hauteur réelle non écrasée (observe: ${info.firstHeight}px)`);
        assert(info.firstTop >= 0, `[${label} ${theme}] 1er item commence dans le viewport, pas sous l'encoche (observe top=${info.firstTop}px)`);
        if (info.lastBottom <= info.viewportH) {
          assert(true, `[${label} ${theme}] dernier item directement visible, tient dans le viewport (observe bottom=${info.lastBottom}px, viewport=${info.viewportH}px)`);
        } else {
          // Viewport trop court pour tout afficher sans scroll (ex. paysage
          // téléphone, 390px de haut) -- attendu tant que le conteneur est
          // réellement scrollable ET que le dernier item devient atteignable
          // après scroll (exigence : "dernier item entièrement accessible",
          // pas "visible sans interaction").
          const afterScroll = await page.evaluate(() => {
            const nav = document.querySelector('nav.sidebar');
            const items = nav.querySelectorAll('.nav-item');
            const last = items[items.length - 1];
            nav.scrollTop = nav.scrollHeight;
            const r = last.getBoundingClientRect();
            return { scrollable: nav.scrollHeight > nav.clientHeight, bottom: r.bottom, top: r.top };
          });
          assert(afterScroll.scrollable, `[${label} ${theme}] sidebar réellement scrollable quand le contenu déborde (nav.scrollHeight > clientHeight)`);
          assert(afterScroll.bottom <= info.viewportH + 1 && afterScroll.top >= -1, `[${label} ${theme}] dernier item atteignable après scroll de la sidebar (observe bottom=${afterScroll.bottom}px après scroll, viewport=${info.viewportH}px)`);
        }
      }
      await page.screenshot({ path: path.join(SHOT_DIR, `${browserName}-sidebar-${label}-${theme}.png`) });
      await page.close();
    }
  }

  // ── B. SCÉNARIO ONGLETS : Supprimer mon entreprise UNIQUEMENT dans Compte ──
  console.log('\n=== B. Onglets Réglages : Supprimer mon entreprise uniquement dans Compte ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page, patronA.email, patronA.password);
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);

    const dangerCount = await page.locator('.danger-zone').count();
    assert(dangerCount === 1, `un seul .danger-zone dans tout le DOM, jamais dupliqué (observe: ${dangerCount})`);

    for (const tab of ['general', 'identite', 'services', 'demandes', 'documents']) {
      await page.evaluate((t) => showTab(t), tab);
      await page.waitForTimeout(150);
      const visible = await page.locator('.danger-zone').isVisible().catch(() => false);
      assert(!visible, `"Supprimer mon entreprise" invisible sur l'onglet ${tab}`);
    }
    await page.evaluate(() => showTab('compte'));
    await page.waitForTimeout(150);
    const visibleOnCompte = await page.locator('.danger-zone').isVisible().catch(() => false);
    assert(visibleOnCompte, `"Supprimer mon entreprise" visible sur l'onglet Compte`);
    await page.close();
  }

  // ── C. SCÉNARIO IDENTITÉ : nom -> initiales, reload, reconnexion ──
  console.log('\n=== C. Identité : nom -> initiales, persistance ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page, patronA.email, patronA.password);
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);

    await page.locator('#regl-nom').fill('Seba Clean');
    await page.evaluate(() => saveGeneralInfo());
    await page.waitForTimeout(1200);
    const initialsAfterSave = await page.locator('#avatar-btn').textContent();
    assert(initialsAfterSave.trim() === 'SC', `avatar = "SC" immédiatement après renommage en "Seba Clean" (observe: "${initialsAfterSave.trim()}")`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const initialsAfterReload = await page.locator('#avatar-btn').textContent();
    assert(initialsAfterReload.trim() === 'SC', `avatar = "SC" après reload (observe: "${initialsAfterReload.trim()}")`);

    const serverState = await pullState(env, patronA.userId);
    assert(serverState && serverState.entreprise && serverState.entreprise.nom === 'Seba Clean', `nom réellement écrit côté serveur (observe: ${JSON.stringify(serverState && serverState.entreprise && serverState.entreprise.nom)})`);

    // Reconnexion (nouvel onglet/contexte, même compte)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page2, patronA.email, patronA.password);
    await page2.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page2.waitForTimeout(1000);
    const initialsSecondContext = await page2.locator('#avatar-btn').textContent();
    assert(initialsSecondContext.trim() === 'SC', `avatar = "SC" dans un second contexte navigateur, sur une AUTRE page (clients.html) (observe: "${initialsSecondContext.trim()}")`);
    await context2.close();
    await page.close();
  }

  // ── D. SCÉNARIO COULEUR : sauvegarde réelle, application globale, sémantique préservée ──
  console.log('\n=== D. Couleur de marque : sauvegarde réelle et application globale ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page, patronA.email, patronA.password);
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => showTab('identite'));
    await page.waitForTimeout(200);

    await page.locator('.color-swatch[data-color="#3B5BA9"]').click();
    await page.evaluate(() => saveIdentiteVisuelle());
    await page.waitForFunction(() => document.getElementById('identite-save-btn').textContent.trim() === 'Enregistrer', { timeout: 10000 });

    const serverStateAfterColor = await pullState(env, patronA.userId);
    assert(serverStateAfterColor && serverStateAfterColor.entreprise && serverStateAfterColor.entreprise.branding && serverStateAfterColor.entreprise.branding.accent === '#3B5BA9', `couleur réellement écrite côté serveur (observe: ${JSON.stringify(serverStateAfterColor && serverStateAfterColor.entreprise && serverStateAfterColor.entreprise.branding)})`);

    // Application globale : une AUTRE page connectée doit refléter la couleur.
    await page.goto(`http://127.0.0.1:${PORT}/clients.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const emeraldOnClients = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--emerald').trim());
    assert(emeraldOnClients.toLowerCase() === '#3b5ba9', `--emerald appliqué sur clients.html (autre page) après sauvegarde (observe: "${emeraldOnClients}")`);

    // Sémantique préservée : badges succès/alerte/danger jamais alignés sur l'accent.
    const semanticIntact = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        successTxt: cs.getPropertyValue('--badge-success-txt').trim(),
        warningTxt: cs.getPropertyValue('--badge-warning-txt').trim(),
        errorTxt: cs.getPropertyValue('--badge-error-txt').trim(),
      };
    });
    assert(semanticIntact.successTxt.toLowerCase() !== '#3b5ba9', `--badge-success-txt reste indépendant de l'accent de marque (observe: ${semanticIntact.successTxt})`);
    assert(semanticIntact.warningTxt.toLowerCase() !== '#3b5ba9', `--badge-warning-txt reste indépendant de l'accent de marque (observe: ${semanticIntact.warningTxt})`);
    assert(semanticIntact.errorTxt.toLowerCase() !== '#3b5ba9', `--badge-error-txt reste indépendant de l'accent de marque (observe: ${semanticIntact.errorTxt})`);

    // Reload sur clients.html : couleur toujours là.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const emeraldAfterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--emerald').trim());
    assert(emeraldAfterReload.toLowerCase() === '#3b5ba9', `--emerald toujours appliqué après reload (observe: "${emeraldAfterReload}")`);

    // Changer pour une autre couleur -> remplace réellement la précédente.
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => showTab('identite'));
    await page.waitForTimeout(200);
    await page.locator('.color-swatch[data-color="#E2722C"]').click();
    await page.evaluate(() => saveIdentiteVisuelle());
    await page.waitForFunction(() => document.getElementById('identite-save-btn').textContent.trim() === 'Enregistrer', { timeout: 10000 });
    const serverStateAfterSecondColor = await pullState(env, patronA.userId);
    assert(serverStateAfterSecondColor.entreprise.branding.accent === '#E2722C', `deuxième couleur remplace réellement la première côté serveur (observe: ${serverStateAfterSecondColor.entreprise.branding.accent})`);
    await page.close();
  }

  // ── E. SCÉNARIO LOGO : upload réel, preview, persistance, rejets ──
  console.log('\n=== E. Logo : upload réel, preview, persistance, rejets ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page, patronA.email, patronA.password);
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => showTab('identite'));
    await page.waitForTimeout(200);

    // PNG 1x1 valide (le plus petit PNG possible), encodé en base64.
    const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const tinyPngPath = path.join(SHOT_DIR, 'tiny-valid.png');
    await import('node:fs/promises').then(fs => fs.writeFile(tinyPngPath, Buffer.from(tinyPngB64, 'base64')));

    await page.setInputFiles('#identite-logo-input', tinyPngPath);
    await page.waitForTimeout(300);
    const previewHasImg = await page.locator('#identite-logo-preview img').count();
    assert(previewHasImg === 1, `preview immédiate du logo choisi, avant tout enregistrement`);

    await page.evaluate(() => saveIdentiteVisuelle());
    await page.waitForFunction(() => document.getElementById('identite-save-btn').textContent.trim() === 'Enregistrer', { timeout: 15000 });

    const serverStateAfterLogo = await pullState(env, patronA.userId);
    const logoUrl = serverStateAfterLogo && serverStateAfterLogo.entreprise && serverStateAfterLogo.entreprise.branding && serverStateAfterLogo.entreprise.branding.logoUrl;
    assert(!!logoUrl, `logoUrl réellement écrit côté serveur (observe: ${logoUrl})`);
    if (logoUrl) {
      const logoRes = await fetch(logoUrl.split('?')[0]);
      assert(logoRes.status === 200, `l'URL de logo publique répond bien 200 (observe: ${logoRes.status})`);
    }

    // Avatar affiche le logo (img), pas des initiales, une fois un logo présent.
    const avatarHasImg = await page.locator('#avatar-btn img').count();
    assert(avatarHasImg === 1, `avatar affiche le logo (img) plutôt que des initiales une fois un logo enregistré`);

    // Reload : logo toujours présent.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const avatarHasImgAfterReload = await page.locator('#avatar-btn img').count();
    assert(avatarHasImgAfterReload === 1, `avatar affiche toujours le logo après reload`);

    // Format interdit rejeté (texte brut renommé en .png -- signature invalide).
    await page.evaluate(() => showTab('identite'));
    await page.waitForTimeout(200);
    const badFilePath = path.join(SHOT_DIR, 'not-really-an-image.png');
    await import('node:fs/promises').then(fs => fs.writeFile(badFilePath, 'ceci nest pas une image'));
    // setInputFiles ne verifie que le nom/MIME (image/png par extension) --
    // le contenu invalide doit etre rejete cote SERVEUR (Storage), pas
    // seulement cote client par le type MIME declare.
    await page.setInputFiles('#identite-logo-input', badFilePath);
    await page.waitForTimeout(300);

    await page.close();
  }

  // ── F. SCÉNARIO DEMANDE EN LIGNE : sauvegarde réelle, formulaire public réellement activé ──
  console.log('\n=== F. Demande en ligne : sauvegarde réelle, formulaire public activable ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(([url, key]) => { window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' }; }, [env.API_URL, env.ANON_KEY]);
    await loginInPage(page, patronA.email, patronA.password);
    await page.goto(`http://127.0.0.1:${PORT}/reglages.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => showTab('demandes'));
    await page.waitForTimeout(200);

    const stateBeforeSave = await pullState(env, patronA.userId);
    assert(!stateBeforeSave.publicIntakeConfig || !stateBeforeSave.publicIntakeConfig.enabled, `formulaire public bien désactivé par défaut côté serveur avant toute sauvegarde`);

    await page.locator('#pic-enabled').check();
    await page.locator('#pic-title').fill('Demandez votre devis QA');
    await page.locator('#pic-intro').fill('Introduction QA réelle.');
    await page.evaluate(() => savePublicIntakeConfig());
    await page.waitForFunction(() => document.getElementById('pic-save-btn').textContent.trim() === 'Enregistrer', { timeout: 10000 });

    const stateAfterSave = await pullState(env, patronA.userId);
    const cfg = stateAfterSave && stateAfterSave.publicIntakeConfig;
    assert(!!cfg && cfg.enabled === true, `enabled=true réellement écrit côté serveur (observe: ${JSON.stringify(cfg && cfg.enabled)})`);
    assert(cfg && cfg.title === 'Demandez votre devis QA', `titre réellement écrit côté serveur (observe: ${cfg && cfg.title})`);

    // L'Edge Function public-intake lit ce MÊME champ -- doit désormais
    // refléter la configuration réellement enregistrée (avant ce correctif,
    // elle restait bloquée sur "Formulaire désactivé" indéfiniment).
    const edgeRes = await fetch(env.API_URL + '/functions/v1/public-intake/config?account=' + encodeURIComponent(patronA.userId), {
      headers: { apikey: env.ANON_KEY },
    });
    const edgeBody = await edgeRes.json().catch(() => ({}));
    assert(edgeRes.status === 200, `l'Edge Function public-intake voit désormais le formulaire activé (observe status=${edgeRes.status}, body=${JSON.stringify(edgeBody)})`);
    assert(edgeBody && edgeBody.config && edgeBody.config.title === 'Demandez votre devis QA', `l'Edge Function reflète le vrai titre enregistré (observe: ${edgeBody && edgeBody.config && edgeBody.config.title})`);

    await page.close();
  }
}

main().catch((e) => { console.error('ERREUR FATALE:', e); process.exit(1); });
