// SEBA — smoke test Puppeteer pour la landing page publique (docs/index.html).
// Sert un docs/ statique en local (aucune dependance a Supabase : la page
// publique ne charge aucun SDK reseau) et verifie : absence d'erreur
// console, hero visible et non coupe, CTA primaire fonctionnel (mene vers
// onboarding.html), menu mobile ouvrable avec zones tactiles >= 44px,
// aucune ancre principale morte, aucun lien vide, aucun scroll horizontal
// a 1440/1024/768/390px, navigation vers Connexion fonctionnelle.
//
// Usage : node scripts/qa-index-landing.js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PORT = 8810;

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(repoRoot, 'docs', urlPath === '/' ? 'index.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('nf: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }

async function main() {
  const server = await startStaticServer();
  const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });

  for (const w of [1440, 1024, 768, 390]) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const state = await page.evaluate(() => ({
      hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      heroVisible: !!document.querySelector('.hero-title') && document.querySelector('.hero-title').getBoundingClientRect().width > 0,
      heroTitleLen: document.querySelector('.hero-title').textContent.trim().length,
      ctaVisible: !!document.querySelector('.hero-ctas .btn-primary') && document.querySelector('.hero-ctas .btn-primary').getBoundingClientRect().height > 0,
    }));
    console.log(`== ${w}px ==`, JSON.stringify({ hasHorizontalScroll: state.hasHorizontalScroll, ctaVisible: state.ctaVisible }));
    assert(!state.hasHorizontalScroll, `${w}px: aucun scroll horizontal`);
    assert(state.heroVisible, `${w}px: hero visible`);
    assert(state.heroTitleLen > 10, `${w}px: titre hero non vide/coupe (len=${state.heroTitleLen})`);
    assert(state.ctaVisible, `${w}px: CTA primaire visible`);
    const realErrors = consoleErrors.filter(e => !/404 \(Not Found\)/.test(e));
    assert(realErrors.length === 0, `${w}px: aucune erreur console (observe: ${JSON.stringify(realErrors)})`);
    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    await page.click('#nav-hamburger');
    await new Promise(r => setTimeout(r, 300));
    const menuOpen = await page.evaluate(() => document.getElementById('mobile-menu').classList.contains('open'));
    assert(menuOpen, '390px: menu mobile ouvrable');
    const tapSizes = await page.evaluate(() => Array.from(document.querySelectorAll('.mob-link,.mob-conn')).map(el => Math.round(el.getBoundingClientRect().height)));
    assert(tapSizes.every(h => h >= 44), `menu mobile: zones tactiles >= 44px (observe ${JSON.stringify(tapSizes)})`);
    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));
    const linkCheck = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const empty = anchors.filter(a => !a.getAttribute('href') || a.getAttribute('href').trim() === '' || a.getAttribute('href') === '#');
      const onPageAnchors = anchors.filter(a => a.getAttribute('href').startsWith('#') && a.getAttribute('href').length > 1);
      const missingTargets = onPageAnchors.filter(a => !document.getElementById(a.getAttribute('href').slice(1)));
      return { emptyCount: empty.length, missingTargets: missingTargets.map(a => a.getAttribute('href')) };
    });
    assert(linkCheck.emptyCount === 0, 'aucun lien vide (#, ou href manquant)');
    assert(linkCheck.missingTargets.length === 0, `toutes les ancres pointent vers une section existante (manquantes: ${JSON.stringify(linkCheck.missingTargets)})`);

    const ctaHref = await page.evaluate(() => document.querySelector('.hero-ctas .btn-primary').getAttribute('href'));
    assert(ctaHref === 'onboarding.html', `CTA primaire pointe vers onboarding.html (observe: ${ctaHref})`);

    const connHref = await page.evaluate(() => document.querySelector('.nav-connexion').getAttribute('href'));
    await page.goto(`http://127.0.0.1:${PORT}/${connHref}`, { waitUntil: 'domcontentloaded' });
    const connTitle = await page.title();
    assert(connTitle.length > 0, `navigation vers Connexion fonctionnelle (titre: ${connTitle})`);
    await page.close();
  }

  await browser.close().catch(() => {});
  await server.close();
  console.log(failures === 0 ? '\nTOUT PASSE' : `\n${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
