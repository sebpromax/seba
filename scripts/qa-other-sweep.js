import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const REPO_ROOT = path.resolve('.');
const DOCS_DIR = path.resolve('docs');
const outDir = path.resolve('docs', 'audit-screenshots', 'qa-other');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const LIVE_BASE = 'https://sebpromax.github.io/seba/';

const MARKETING = ['index.html', 'product.html', 'solution.html', 'confiance.html', 'tarifs.html', 'faq.html', 'probleme.html', 'comment-ca-marche.html'];
const APP = ['clients.html', 'devis.html', 'factures.html', 'planning.html', 'equipe.html', 'historique.html', 'reglages.html'];
const DETAIL = ['client-fiche.html', 'devis-nouveau.html', 'employe-fiche.html'];
const LOGIN = ['connexion.html'];

const ALL_PAGES = [...MARKETING, ...APP, ...DETAIL, ...LOGIN];
const NEEDS_SEED = new Set([...APP, ...DETAIL]);

const NOISE_PATTERNS = [/manifest\.json/i, /ERR_FAILED/i, /ERR_NAME_NOT_RESOLVED/i];

function isNoise(text) {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

const results = []; // { page, env, viewport, errors: [], notes: [] }

async function testPage(browser, pageName, env, viewport) {
  const p = await browser.newPage();
  const errors = [];
  const notes = [];

  p.on('pageerror', (e) => {
    const text = String(e);
    if (!isNoise(text)) errors.push('PAGE ERROR: ' + text);
  });
  p.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isNoise(text)) errors.push('CONSOLE: ' + text);
    }
  });
  p.on('requestfailed', (req) => {
    const text = req.url() + ' :: ' + (req.failure() ? req.failure().errorText : 'unknown');
    if (!isNoise(text)) errors.push('REQUEST FAILED: ' + text);
  });

  if (NEEDS_SEED.has(pageName)) {
    await p.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test', deviseSymbole: '€' }));
      } catch (e) {}
    });
  }

  if (viewport === 'desktop') {
    await p.setViewport({ width: 1440, height: 900 });
  } else {
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  }

  let url;
  if (env === 'local') {
    url = `file://${path.resolve(DOCS_DIR, pageName).replace(/\\/g, '/')}`;
  } else {
    url = LIVE_BASE + pageName;
  }
  const suffix = NEEDS_SEED.has(pageName) ? '?demo' : '';
  url += suffix;

  let loadError = null;
  try {
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    loadError = 'GOTO ERROR: ' + e.message;
  }

  await new Promise((r) => setTimeout(r, 700));

  // Extract internal links (only meaningful for local env, but do for both to compare)
  let internalLinks = [];
  try {
    internalLinks = await p.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((a) => a.getAttribute('href'))
        .filter((href) => href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript:'));
    });
  } catch (e) {
    notes.push('Could not extract links: ' + e.message);
  }

  // Try clicking a couple of safe interactive elements (buttons without navigation, tabs)
  let clickErrors = [];
  try {
    const buttonSelectors = await p.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="tab"], .tab, .nav-tab'))
        .filter((el) => el.offsetParent !== null)
        .slice(0, 3);
      return candidates.map((el, i) => {
        if (!el.id) el.setAttribute('data-qa-idx', String(i));
        return el.id ? `#${el.id}` : `[data-qa-idx="${i}"]`;
      });
    });
    for (const sel of buttonSelectors) {
      try {
        await p.click(sel);
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        // ignore click failures (element may be covered), not a page error
      }
    }
  } catch (e) {
    notes.push('Click-through skipped: ' + e.message);
  }

  // connexion.html specific: type + eye toggle
  if (pageName === 'connexion.html') {
    try {
      const hasEmail = await p.$('#email');
      const hasPw = await p.$('#password');
      if (hasEmail) await p.type('#email', 'test@example.com');
      if (hasPw) await p.type('#password', 'MotDePasseTest123');
      const before = hasPw ? await p.evaluate(() => document.getElementById('password')?.type) : null;
      const eyeBtn = await p.$('#toggle-pw');
      if (eyeBtn) {
        await eyeBtn.click();
        await new Promise((r) => setTimeout(r, 200));
        const after = await p.evaluate(() => document.getElementById('password')?.type);
        notes.push(`Password toggle: before=${before} after=${after} ${before === after ? '(NO CHANGE - POSSIBLE BUG)' : '(OK)'}`);
      } else {
        notes.push('No #toggle-pw eye icon found');
      }
    } catch (e) {
      clickErrors.push('connexion.html interaction error: ' + e.message);
    }
  }

  const shotName = `${pageName.replace('.html', '')}__${env}__${viewport}.png`;
  try {
    await p.screenshot({ path: path.join(outDir, shotName), fullPage: true });
  } catch (e) {
    notes.push('Screenshot failed: ' + e.message);
  }

  const allErrors = [...(loadError ? [loadError] : []), ...errors, ...clickErrors];

  await p.close();

  return { page: pageName, env, viewport, errors: allErrors, notes, internalLinks, url };
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const envs = ['local', 'live'];
const viewports = ['desktop', 'mobile'];

for (const pageName of ALL_PAGES) {
  for (const env of envs) {
    for (const viewport of viewports) {
      process.stdout.write(`Testing ${pageName} [${env}/${viewport}] ... `);
      try {
        const r = await testPage(browser, pageName, env, viewport);
        results.push(r);
        console.log(r.errors.length ? `${r.errors.length} ERROR(S)` : 'OK');
      } catch (e) {
        results.push({ page: pageName, env, viewport, errors: ['SCRIPT ERROR: ' + e.message], notes: [], internalLinks: [] });
        console.log('SCRIPT ERROR: ' + e.message);
      }
    }
  }
}

await browser.close();

fs.writeFileSync(path.resolve('docs', 'audit-screenshots', 'qa-other', 'results.json'), JSON.stringify(results, null, 2));
console.log('\n\nDONE. Results saved to docs/audit-screenshots/qa-other/results.json');
