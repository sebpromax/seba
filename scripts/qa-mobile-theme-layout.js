// SEBA — THEME-MOBILE-001 : preuve visuelle + assertions ciblees pour les
// corrections theme mobile / sidebar / Assistant Seba / header / Ctrl K.
// Local uniquement (Supabase local deja demarre, docs/ servi statiquement) --
// aucune dependance a un compte de production. WebKit en priorite, Chromium
// en controle (voir consigne).
//
// Usage : node scripts/qa-mobile-theme-layout.js

import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PORT = 8796;
const SHOT_DIR = path.join(repoRoot, 'docs', 'audit-screenshots', 'mobile-theme-001');

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

async function signInAndGoToDashboard(page, env) {
  await page.addInitScript(([url, key]) => {
    window.SEBA_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, accountId: 'default' };
  }, [env.API_URL, env.ANON_KEY]);
  await page.goto(`http://127.0.0.1:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sebaAuth, { timeout: 15000 });
  await page.locator('#email').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 'patron-a@test.seba.invalid');
  await page.locator('#password').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 'Test-Synthetic-2026!');
  await page.evaluate(() => handleLogin()).catch(() => {});
  await page.waitForTimeout(1500);
  // Le compte QA synthetique n'est jamais passe par l'onboarding
  // (bienvenue.html), donc localStorage.sebaEntreprise est absent -- le
  // gate de app/dashboard.html retombe alors sur l'ecran "Bienvenue"
  // vide au lieu du tableau de bord reel (c'est precisement QA360-P1-A,
  // deja suivi separement, hors perimetre THEME-MOBILE-001). Sans ce
  // contournement, cmd-bar/synchro/etc. ne seraient jamais rendus et ce
  // test ne verifierait rien de reel sur ces elements.
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'QA Mobile Theme', secteur: 'menage', couleur: '#10B981' }));
  });
  await page.goto(`http://127.0.0.1:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.SebaDB, { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function setTheme(page, theme) {
  // THEME-MOBILE-001 (2026-07-29) : sebaTheme.set()/toggle() supprimes,
  // le theme suit exclusivement prefers-color-scheme -- emulateMedia est
  // desormais le seul moyen de piloter le theme dans un test.
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await page.waitForTimeout(150);
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function noOverlap(page, selA, selB) {
  return page.evaluate(([a, b]) => {
    const elA = document.querySelector(a);
    const elB = document.querySelector(b);
    if (!elA || !elB) return true; // absent = pas de chevauchement possible
    const ra = elA.getBoundingClientRect();
    const rb = elB.getBoundingClientRect();
    const bothVisible = ra.width > 0 && ra.height > 0 && rb.width > 0 && rb.height > 0;
    if (!bothVisible) return true;
    const overlap = !(ra.right <= rb.left || ra.left >= rb.right || ra.bottom <= rb.top || ra.top >= rb.bottom);
    return !overlap;
  }, [selA, selB]);
}

async function inViewport(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
  }, sel);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}

// THEME-MOBILE-001 (2026-07-29, correctif racine) : html/body n'avaient
// jamais de background-color -- verifie que le canevas entier est bien
// peint avec le bon token par theme, pas seulement les composants
// individuels (voir docs/pro-global.css, commentaire "html, body { ... }").
const EXPECTED_BG = { light: 'rgb(246, 245, 242)', dark: 'rgb(5, 5, 5)' };
const EXPECTED_SIDEBAR_BG = { light: 'rgb(255, 255, 255)', dark: 'rgb(11, 12, 14)' };

async function canvasBg(page) {
  return page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
}

// Un texte peut avoir un getComputedStyle().color parfaitement correct et
// rester invisible si le fond REEL derriere lui (pas juste le fond direct
// transparent de son propre element) n'est jamais peint -- c'est
// exactement la cause racine trouvee ici. Verifie donc le pixel
// effectivement rendu au centre de l'element, pas seulement le style
// calcule.
async function textActuallyVisible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { found: true, rendered: false, reason: 'zero-size' };
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
      return { found: true, rendered: false, reason: 'display/visibility/opacity' };
    }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const topElIsSelf = topEl === el || (topEl && el.contains(topEl)) || (topEl && topEl.contains(el));
    return { found: true, rendered: true, topElIsSelf, color: cs.color, text: (el.textContent || '').trim() };
  }, sel);
}

async function assistantHidden(page) {
  const fabVisible = await page.locator('.ai-chat-fab').isVisible().catch(() => false);
  const panelVisible = await page.locator('.ai-chat-panel.open').isVisible().catch(() => false);
  return !fabVisible && !panelVisible;
}

async function runSuite(browserType, browserName) {
  console.log(`\n############## ${browserName} ##############`);
  const env = getSupabaseStatus();
  const browser = await browserType.launch();

  const VP = {
    mobile: { width: 390, height: 844 },
    smallMobile: { width: 360, height: 800 },
    landscape: { width: 844, height: 390 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  };

  // ── 1-4 : mobile clair/sombre, assistant ferme/ouvert ──
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: VP.mobile, hasTouch: true, isMobile: true });
    await signInAndGoToDashboard(page, env);
    await setTheme(page, theme);
    await shot(page, `${browserName}-mobile-${theme}-assistant-ferme`);
    assert(await noHorizontalOverflow(page), `[mobile ${theme}, assistant fermé] scrollWidth <= innerWidth`);
    assert(await noOverlap(page, '.hamburger', '#cmd-sync'), `[mobile ${theme}] pas de chevauchement hamburger/synchro`);
    assert(await noOverlap(page, '.cmd-search-trigger', '#cmd-sync'), `[mobile ${theme}] pas de chevauchement recherche/synchro`);
    const kbdVisible = await page.locator('.cmd-search-trigger kbd').isVisible().catch(() => false);
    assert(!kbdVisible, `[mobile ${theme}] "Ctrl K" absent (pointeur tactile simulé)`);

    // Canevas entier peint (root cause du texte invisible + "grand espace
    // vide" en sombre -- html/body transparents, cf. commentaire ci-dessus).
    const bg = await canvasBg(page);
    assert(bg.html === EXPECTED_BG[theme], `[mobile ${theme}] html peint avec --bg (observe: ${bg.html}, attendu: ${EXPECTED_BG[theme]})`);
    assert(bg.body === EXPECTED_BG[theme], `[mobile ${theme}] body peint avec --bg (observe: ${bg.body}, attendu: ${EXPECTED_BG[theme]})`);

    // Greeting/statut synchro réellement rendus (pas seulement un style
    // calculé correct) -- bug confirmé sur iPhone réel malgré un
    // getComputedStyle() sain, cause racine = canevas non peint ci-dessus.
    const greet = await textActuallyVisible(page, '#db-greeting');
    assert(greet.rendered && greet.topElIsSelf && greet.text.length > 0, `[mobile ${theme}] #db-greeting réellement rendu et non recouvert (observe: ${JSON.stringify(greet)})`);
    const sync = await textActuallyVisible(page, '#cmd-sync-label');
    assert(sync.rendered && sync.topElIsSelf && sync.text.length > 0, `[mobile ${theme}] #cmd-sync-label réellement rendu et non recouvert (observe: ${JSON.stringify(sync)})`);

    // Ouvre l'Assistant
    await page.locator('.ai-chat-fab').click();
    await page.waitForTimeout(400);
    await shot(page, `${browserName}-mobile-${theme}-assistant-ouvert`);
    assert(await page.locator('.ai-chat-panel.open').isVisible(), `[mobile ${theme}] panneau Assistant ouvert`);
    assert(await inViewport(page, '.ai-chat-panel'), `[mobile ${theme}] panneau Assistant contenu dans le viewport`);
    assert(await page.locator('#ai-chat-inp').isVisible(), `[mobile ${theme}] champ de saisie Assistant visible`);
    assert(await noOverlap(page, '.ai-chat-fab', '.ai-chat-panel'), `[mobile ${theme}] FAB ne chevauche pas une action principale du panneau`);
    assert(await page.locator('.ai-chat-backdrop.open').isVisible(), `[mobile ${theme}] backdrop Assistant visible (arriere-plan non interactif)`);
    // Contraste : le panneau et le champ de saisie doivent utiliser la
    // meme famille de fond que le theme actif (pas de fond fige blanc/noir).
    const panelBg = await page.locator('.ai-chat-panel').evaluate((el) => getComputedStyle(el).backgroundColor);
    const inputBg = await page.locator('.ai-chat-input input').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(panelBg === inputBg, `[mobile ${theme}] panneau et champ de saisie partagent le meme fond (observe panel=${panelBg}, input=${inputBg})`);
    // Escape ferme le panneau
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(!(await page.locator('.ai-chat-panel.open').count()), `[mobile ${theme}] Echap ferme l'Assistant`);
    await page.close();
  }

  // ── 5-6 : sidebar ouverte, clair/sombre ──
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: VP.mobile, hasTouch: true, isMobile: true });
    await signInAndGoToDashboard(page, env);
    await setTheme(page, theme);
    await page.locator('.hamburger').click();
    await page.waitForTimeout(400);
    await shot(page, `${browserName}-sidebar-${theme}-ouverte`);
    assert(await inViewport(page, 'nav.sidebar'), `[sidebar ${theme}] sidebar contenue dans le viewport`);
    assert(await page.locator('.sidebar-overlay.open').isVisible(), `[sidebar ${theme}] backdrop visible`);
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    assert(bodyOverflow === 'hidden', `[sidebar ${theme}] scroll du body verrouillé (observe: "${bodyOverflow}")`);

    // THEME-MOBILE-001 : la sidebar était câblée #0B0C0E en dur quel que
    // soit le thème (rail "toujours sombre") -- suit désormais le thème
    // de la page, décision produit explicite (remonté fondateur : "la
    // sidebar ne suit pas correctement le thème clair").
    const sidebarBg = await page.locator('nav.sidebar').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(sidebarBg === EXPECTED_SIDEBAR_BG[theme], `[sidebar ${theme}] fond de la sidebar suit le thème (observe: ${sidebarBg}, attendu: ${EXPECTED_SIDEBAR_BG[theme]})`);

    // L'Assistant flottant restait visible/cliquable AU-DESSUS de la
    // sidebar ouverte (z-index 300/301 > 149/150) -- remonté fondateur.
    assert(await assistantHidden(page), `[sidebar ${theme}] FAB/panneau Assistant masqués tant que la sidebar est ouverte`);

    // Echap ferme la sidebar
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(!(await page.locator('nav.sidebar.open').count()), `[sidebar ${theme}] Echap ferme la sidebar`);
    assert(await page.evaluate(() => document.body.style.overflow === ''), `[sidebar ${theme}] scroll du body restauré après Echap`);
    assert(await page.locator('.ai-chat-fab').isVisible(), `[sidebar ${theme}] FAB Assistant réapparaît une fois la sidebar refermée`);
    await page.close();
  }

  // ── 7-11 : autres viewports (light par defaut, sauf bureau sombre) ──
  const rest = [
    ['smallMobile', VP.smallMobile, 'light', `${browserName}-petit-mobile-360x800`],
    ['landscape', VP.landscape, 'light', `${browserName}-paysage-844x390`],
    ['tablet', VP.tablet, 'light', `${browserName}-tablette-768x1024`],
    ['desktop', VP.desktop, 'light', `${browserName}-bureau-clair-1440x900`],
    ['desktop', VP.desktop, 'dark', `${browserName}-bureau-sombre-1440x900`],
  ];
  for (const [, vp, theme, name] of rest) {
    const page = await browser.newPage({ viewport: vp });
    await signInAndGoToDashboard(page, env);
    await setTheme(page, theme);
    await shot(page, name);
    assert(await noHorizontalOverflow(page), `[${name}] scrollWidth <= innerWidth`);
    const vpBg = await canvasBg(page);
    assert(vpBg.html === EXPECTED_BG[theme] && vpBg.body === EXPECTED_BG[theme], `[${name}] canevas html/body peint avec --bg (observe: ${JSON.stringify(vpBg)})`);
    const vpSidebarVisible = await page.locator('nav.sidebar').isVisible().catch(() => false);
    if (vpSidebarVisible) {
      const vpSidebarBg = await page.locator('nav.sidebar').evaluate((el) => getComputedStyle(el).backgroundColor);
      assert(vpSidebarBg === EXPECTED_SIDEBAR_BG[theme], `[${name}] fond de la sidebar suit le thème (observe: ${vpSidebarBg}, attendu: ${EXPECTED_SIDEBAR_BG[theme]})`);
    }
    await page.close();
  }

  await browser.close();
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const server = await startStaticServer();
  try {
    await runSuite(webkit, 'webkit');
    await runSuite(chromium, 'chromium');
  } finally {
    await server.close();
  }
  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE:', e); process.exit(1); });
