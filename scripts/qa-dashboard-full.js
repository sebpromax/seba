import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

// Args: --target=local|live --viewport=desktop|mobile
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const target = args.target || 'local';
const vp = args.viewport || 'desktop';

const outDir = path.resolve('docs', 'audit-screenshots', `qa-full-${target}-${vp}`);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const localUrl = 'file://' + path.resolve('docs', 'app', 'dashboard.html').replace(/\\/g, '/') + '?demo';
const liveUrl = 'https://sebpromax.github.io/seba/app/dashboard.html?demo';
const url = target === 'live' ? liveUrl : localUrl;

const IGNORE = [/manifest\.json/i, /ERR_FAILED/i, /ERR_NAME_NOT_RESOLVED/i];

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();

let phase = 'init';
function mark(p) { phase = p; }
const taggedErrs = [];
page.on('pageerror', (e) => taggedErrs.push({ phase, type: 'pageerror', text: String(e) }));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (IGNORE.some(rx => rx.test(text))) return;
    taggedErrs.push({ phase, type: 'console', text });
  }
});
page.on('requestfailed', (req) => {
  const f = req.failure();
  const t = f ? f.errorText : '';
  if (IGNORE.some(rx => rx.test(t)) || IGNORE.some(rx => rx.test(req.url()))) return;
  taggedErrs.push({ phase, type: 'requestfailed', text: `${req.url()} :: ${t}` });
});

const results = { target, viewport: vp, url, findings: [] };
function finding(text) { results.findings.push(text); console.log('FINDING: ' + text); }

try {
  mark('0-empty-state-load');
  if (target === 'local') {
    await page.goto('file://' + path.resolve('docs', 'app', 'dashboard.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.goto('https://sebpromax.github.io/seba/app/dashboard.html', { waitUntil: 'networkidle2', timeout: 45000 });
  }
  await new Promise(r => setTimeout(r, 1000));
  if (vp === 'mobile') {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  } else {
    await page.setViewport({ width: 1440, height: 900 });
  }
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, '00-empty-state.png'), fullPage: false });

  mark('1-seed-and-reload');
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({
      nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
      services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
    }));
    localStorage.setItem('seba_calibration_seen', '1');
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, '01-populated-state.png'), fullPage: false });

  /* ═══════════════════════════════════════════════════════════════
     Dashboard patron actuel (socle visuel pro-global, commit 1a0f841) --
     remplace les assertions de l'ancien dashboard Tactical Dark
     (Serenity Score / Action Stream / Horizon / Timeline de Vie / Focus
     Mode), retire du DOM depuis ce commit et jamais restaure. Selecteurs
     verifies directement dans docs/app/dashboard.html.
  ═══════════════════════════════════════════════════════════════ */
  mark('2-basic-sections');
  const basicInfo = await page.evaluate(() => {
    const btnPrimary = document.querySelector('.db-btn-primary');
    const panelTitles = Array.from(document.querySelectorAll('.db-panel-title span')).map(s => s.textContent.trim());
    return {
      title: document.title,
      primaryBtnText: btnPrimary ? btnPrimary.textContent.trim() : null,
      alertsSectionPresent: !!document.getElementById('db-alerts'),
      alertsChildren: document.getElementById('db-alerts') ? document.getElementById('db-alerts').children.length : 0,
      panelTitles,
      jobListChildren: document.getElementById('db-job-list') ? document.getElementById('db-job-list').children.length : 0,
      financeChildren: document.getElementById('db-finance') ? document.getElementById('db-finance').children.length : 0,
    };
  });
  log('basic', JSON.stringify(basicInfo));

  if (!basicInfo.primaryBtnText || !basicInfo.primaryBtnText.includes('Nouvelle intervention')) {
    finding(`Bouton "Nouvelle intervention" absent ou texte inattendu (observe: ${JSON.stringify(basicInfo.primaryBtnText)})`);
  }
  if (!basicInfo.alertsSectionPresent) {
    finding('Section "À traiter maintenant" (#db-alerts, aria-label="Actions prioritaires") absente du DOM');
  } else if (basicInfo.alertsChildren === 0) {
    finding('Section "À traiter maintenant" (#db-alerts) présente mais vide après seed + reload');
  }
  if (!basicInfo.panelTitles.includes("Aujourd'hui")) {
    finding(`Section "Aujourd'hui" absente (titres de panneaux observés: ${JSON.stringify(basicInfo.panelTitles)})`);
  } else if (basicInfo.jobListChildren === 0) {
    finding('Section "Aujourd\'hui" présente mais #db-job-list est vide après seed + reload');
  }
  if (!basicInfo.panelTitles.includes('Résumé financier')) {
    finding(`Section "Résumé financier" absente (titres de panneaux observés: ${JSON.stringify(basicInfo.panelTitles)})`);
  } else if (basicInfo.financeChildren === 0) {
    finding('Section "Résumé financier" présente mais #db-finance est vide après seed + reload');
  }
  await page.screenshot({ path: path.join(outDir, '02-sections-check.png') });

  // Navigation Dashboard -> Clients -> Dashboard (liens reels generes par
  // sidebar.js, jamais une URL devinee en dur -- voir docs/sidebar.js
  // resolveHref()).
  mark('3-nav-dashboard-clients-dashboard');
  // Sur mobile la sidebar est hors-champ tant que le hamburger ne l'ouvre
  // pas (meme flux qu'un vrai utilisateur -- toggleSidebar(), dashboard.html)
  // : sans ca les liens existent en DOM mais sont non-cliquables (masques).
  if (vp === 'mobile') {
    await page.evaluate(() => { if (typeof toggleSidebar === 'function') toggleSidebar(); });
    await new Promise(r => setTimeout(r, 400));
  }
  const clientsLinkHandle = await page.evaluateHandle(() => {
    const links = Array.from(document.querySelectorAll('#sidebar a, .sidebar a, nav a'));
    return links.find(a => a.textContent.trim().includes('Clients')) || null;
  });
  const clientsLink = clientsLinkHandle.asElement();
  if (clientsLink) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
      clientsLink.click(),
    ]);
    await new Promise(r => setTimeout(r, 800));
    const onClients = /clients\.html/.test(page.url());
    if (!onClients) finding(`Navigation vers Clients a échoué (URL observée: ${page.url()})`);
    log('nav', `Dashboard -> Clients : ${page.url()}`);

    if (vp === 'mobile') {
      await page.evaluate(() => { if (typeof toggleSidebar === 'function') toggleSidebar(); });
      await new Promise(r => setTimeout(r, 400));
    }
    const dashLinkHandle = await page.evaluateHandle(() => {
      const links = Array.from(document.querySelectorAll('#sidebar a, .sidebar a, nav a'));
      return links.find(a => a.textContent.trim().includes('Tableau de bord')) || null;
    });
    const dashLink = dashLinkHandle.asElement();
    if (dashLink) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
        dashLink.click(),
      ]);
      await new Promise(r => setTimeout(r, 800));
      const backOnDash = /dashboard\.html/.test(page.url());
      if (!backOnDash) finding(`Navigation retour vers Dashboard a échoué (URL observée: ${page.url()})`);
      log('nav', `Clients -> Dashboard : ${page.url()}`);
    } else {
      finding('Lien de navigation "Tableau de bord" introuvable dans la sidebar depuis Clients');
    }
  } else {
    finding('Lien de navigation "Clients" introuvable dans la sidebar du dashboard');
  }

  // Aucune barre de scroll horizontale
  mark('4-no-horizontal-scroll');
  const scrollState = await page.evaluate(() => ({
    hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  log('scroll', JSON.stringify(scrollState));
  if (scrollState.hasHorizontalScroll) {
    finding(`Scroll horizontal détecté (scrollWidth=${scrollState.scrollWidth}, clientWidth=${scrollState.clientWidth})`);
  }

  // Aucune collision mobile entre les actions d'en-tete et la navigation.
  // NB : cette page (dashboard patron, pro-global) n'a pas de FAB IA -- ce
  // composant n'existe que sur le portail employe terrain (espace-terrain.html,
  // hors perimetre de ce script). Le controle porte ici sur les elements
  // d'action reels de cette page (bouton principal, menu secondaire, avatar,
  // hamburger de sidebar) : aucun ne doit se chevaucher visuellement.
  if (vp === 'mobile') {
    mark('5-mobile-collision-check');
    const overlapInfo = await page.evaluate(() => {
      function rectOf(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { sel, top: r.top, left: r.left, right: r.right, bottom: r.bottom };
      }
      function intersects(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }
      const rects = ['#hamburger', '.db-btn-primary', '#db-menu-btn', '#avatar']
        .map(rectOf)
        .filter(Boolean);
      const collisions = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (intersects(rects[i], rects[j])) collisions.push([rects[i].sel, rects[j].sel]);
        }
      }
      return { rectCount: rects.length, collisions };
    });
    log('mobile-collision', JSON.stringify(overlapInfo));
    if (overlapInfo.collisions.length > 0) {
      finding(`Collision mobile détectée entre éléments d'action : ${JSON.stringify(overlapInfo.collisions)}`);
    }
    await page.screenshot({ path: path.join(outDir, '05-mobile-header.png') });
  }

  // Chargement sans erreur console (verification explicite, en plus de la
  // capture continue taggedErrs ci-dessous).
  if (taggedErrs.length > 0) {
    finding(`Erreurs console/page capturées pendant l'exécution : ${JSON.stringify(taggedErrs)}`);
  }

} catch (e) {
  finding(`SCRIPT EXCEPTION during phase "${phase}": ${e.message}`);
  try { await page.screenshot({ path: path.join(outDir, 'ERROR-state.png') }); } catch {}
}

console.log('\n=== CONSOLE/PAGE ERRORS CAPTURED ===');
console.log(JSON.stringify(taggedErrs, null, 2));
console.log('\n=== FINDINGS ===');
console.log(JSON.stringify(results.findings, null, 2));

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...results, errors: taggedErrs }, null, 2));

await browser.close();
process.exit(results.findings.length > 0 ? 1 : 0);
