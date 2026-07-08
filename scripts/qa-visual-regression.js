// Regression visuelle par diff pixel (golden master).
// Usage :
//   node scripts/qa-visual-regression.js                  -> compare vs baselines existantes
//   node scripts/qa-visual-regression.js --update-baseline -> (re)genere les baselines
//
// Reprend le pattern Puppeteer des autres scripts qa-*.js de ce dossier
// (executablePath Chrome local, file:// direct, pas de serveur) plutot que
// d'introduire une nouvelle convention.
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import path from 'path';
import fs from 'fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const updateBaseline = !!args['update-baseline'];

const PAGES = ['dashboard.html', 'onboarding.html', 'tarifs.html'];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812, isMobile: true, hasTouch: true },
};
// Tolerance demandee : 0.5% des pixels de la capture, pour absorber le rendu
// system-ui/antialiasing qui varie legerement d'un OS/d'une version Chrome a
// l'autre sans que ce soit une vraie regression visuelle.
const DIFF_RATIO_THRESHOLD = 0.005;

const BASELINE_DIR = path.resolve('docs', 'visual-baselines');
if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });

function log(status, msg) { console.log(`[${status}] ${msg}`); }

function seedLocalStorage() {
  // Meme seed que scripts/qa-dashboard-full.js : sans elle, dashboard.html
  // rend un etat vide (pas d'entreprise configuree) et le rituel de
  // calibration plein ecran s'affiche a chaque chargement, ce qui rendrait
  // les baselines instables d'un run a l'autre pour rien.
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
  localStorage.setItem('seba_calibration_seen', '1');
}

async function screenshotPage(browser, pageName, viewportName) {
  const url = 'file://' + path.resolve('docs', pageName).replace(/\\/g, '/');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(seedLocalStorage);
  await page.setViewport(VIEWPORTS[viewportName]);
  // domcontentloaded, pas networkidle2 : les pages marketing (onboarding.html,
  // tarifs.html) chargent GSAP/three.js depuis un CDN externe — sans acces
  // reseau (ou juste lent), ces requetes ne se resolvent jamais et
  // networkidle2 attend indefiniment jusqu'au timeout. Meme choix que
  // qa-dashboard-full.js pour ses runs --target=local.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000)); // laisse les animations/reveal s'installer
  const buf = await page.screenshot({ fullPage: false });
  await page.close();
  return buf;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let anyFail = false;
  const report = [];

  for (const pageName of PAGES) {
    for (const viewportName of Object.keys(VIEWPORTS)) {
      const label = `${pageName.replace('.html', '')}-${viewportName}`;
      const baselinePath = path.join(BASELINE_DIR, `${label}.png`);
      const buf = await screenshotPage(browser, pageName, viewportName);

      if (updateBaseline || !fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, buf);
        log(updateBaseline ? 'BASELINE-UPDATED' : 'BASELINE-CREATED', label);
        report.push({ label, status: 'baseline-written' });
        continue;
      }

      const current = PNG.sync.read(buf);
      const baseline = PNG.sync.read(fs.readFileSync(baselinePath));

      if (current.width !== baseline.width || current.height !== baseline.height) {
        anyFail = true;
        log('FAIL', `${label} : dimensions differentes (baseline ${baseline.width}x${baseline.height}, actuel ${current.width}x${current.height})`);
        report.push({ label, status: 'fail', reason: 'dimension-mismatch' });
        continue;
      }

      const { width, height } = current;
      const diff = new PNG({ width, height });
      const numDiffPixels = pixelmatch(current.data, baseline.data, diff.data, width, height, { threshold: 0.1 });
      const diffRatio = numDiffPixels / (width * height);

      if (diffRatio > DIFF_RATIO_THRESHOLD) {
        anyFail = true;
        const diffPath = path.join(BASELINE_DIR, `${label}-diff.png`);
        fs.writeFileSync(diffPath, PNG.sync.write(diff));
        log('FAIL', `${label} : ${(diffRatio * 100).toFixed(2)}% de pixels differents (seuil ${(DIFF_RATIO_THRESHOLD * 100).toFixed(1)}%) -> ${diffPath}`);
        report.push({ label, status: 'fail', diffRatio });
      } else {
        log('OK', `${label} : ${(diffRatio * 100).toFixed(3)}% de pixels differents (sous le seuil)`);
        report.push({ label, status: 'pass', diffRatio });
      }
    }
  }

  await browser.close();

  console.log('\n=== RESUME ===');
  console.log(JSON.stringify(report, null, 2));

  if (anyFail) {
    log('FAILED', 'au moins une page depasse le seuil de tolerance visuelle');
    process.exit(1);
  }
  log('OK', 'toutes les pages sont dans la tolerance visuelle');
}

main().catch((e) => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
