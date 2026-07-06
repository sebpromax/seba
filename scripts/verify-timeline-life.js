import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'timeline-life');
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
await page.setViewport({ width: 1440, height: 2200 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500)); // laisse l'entree se stabiliser

const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  return { exists: !!c, width: c ? c.width : 0, height: c ? c.height : 0 };
});
console.log('canvas info:', JSON.stringify(canvasInfo));

await page.evaluate(() => document.getElementById('timeline-life').scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(outDir, 'timeline-no-hover.png') });

// hover directly on a point (dispatch to be scroll/coord safe)
const hoverResult = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  const rect = c.getBoundingClientRect();
  // hover near the vertical center where a point is likely to sit
  const ev = new MouseEvent('mousemove', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.15, bubbles: true });
  c.dispatchEvent(ev);
  const tip = document.querySelector('.tl-life-tip');
  return tip ? { visible: tip.classList.contains('visible'), text: tip.textContent } : null;
});
console.log('hover result (first point ~15% down):', JSON.stringify(hoverResult));
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: path.join(outDir, 'timeline-hover.png') });

// resize check
await page.setViewport({ width: 900, height: 2200 });
await new Promise((r) => setTimeout(r, 400));
const afterResize = await page.evaluate(() => {
  const c = document.getElementById('timeline-life');
  return { width: c.width, cssWidth: c.style.width };
});
console.log('after resize:', JSON.stringify(afterResize));

console.log('errors:', errs);
await browser.close();
