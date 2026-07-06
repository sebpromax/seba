import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'timeline-rail');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED')) errs.push('CONSOLE: ' + msg.text()); });

const url = 'file://' + path.resolve('docs', 'dashboard.html');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
});
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  const rail = document.querySelector('.timeline-life-rail');
  const railStyle = rail ? getComputedStyle(rail) : null;
  return { exists: !!c, width: c ? c.width : 0, height: c ? c.height : 0, railPosition: railStyle ? railStyle.position : null };
});
console.log('canvas/rail info:', JSON.stringify(canvasInfo));

// Screenshot at top of scroll (rail visible)
await page.screenshot({ path: path.join(outDir, 'rail-top.png') });

// Scroll down and confirm rail STAYS fixed on screen
await page.evaluate(() => window.scrollBy(0, 800));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(outDir, 'rail-scrolled.png') });

// Capture two snapshots of a dot's Y position at different times to confirm continuous motion
const posA = await page.evaluate(() => {
  // read internal state isn't exposed; instead sample the canvas pixel data isn't reliable for exact Y,
  // so we approximate by checking hover-detection at a fixed mouse Y across two times and see if the
  // detected event label differs, OR simpler: expose nothing and just rely on visual diff between screenshots.
  return performance.now();
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(outDir, 'rail-after-1500ms.png') });

// Hover test via dispatch (scroll-safe) — essaie plusieurs Y car les points dérivent en continu
const hoverResult = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  const rect = c.getBoundingClientRect();
  const fractions = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9];
  for (const f of fractions) {
    const ev = new MouseEvent('mousemove', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * f, bubbles: true });
    c.dispatchEvent(ev);
    const tip = document.querySelector('.tl-life-tip');
    if (tip && tip.classList.contains('visible')) return { visible: true, text: tip.textContent, atFraction: f };
  }
  return { visible: false };
});
console.log('hover result (tried multiple Y):', JSON.stringify(hoverResult));
await page.screenshot({ path: path.join(outDir, 'rail-hover.png') });

// resize check — reste AU-DESSUS du seuil responsive (1180px) pour tester le redraw, pas le masquage
await page.setViewport({ width: 1300, height: 900 });
await new Promise((r) => setTimeout(r, 400));
const afterResize = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  return { width: c.width, cssWidth: c.style.width };
});
console.log('after resize (1300px, rail still visible):', JSON.stringify(afterResize));

// confirm the rail correctly HIDES below the 1180px breakpoint (intentional, not a bug)
await page.setViewport({ width: 1000, height: 900 });
await new Promise((r) => setTimeout(r, 400));
const belowBreakpoint = await page.evaluate(() => {
  const rail = document.querySelector('.timeline-life-rail');
  return getComputedStyle(rail).display;
});
console.log('rail display below 1180px breakpoint (should be "none"):', belowBreakpoint);

console.log('errors:', errs);
await browser.close();
