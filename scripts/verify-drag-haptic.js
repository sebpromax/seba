import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'drag-haptic');
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

// Enter customize mode (calls initSortable per existing app logic)
await page.evaluate(() => { toggleCustomizeMode(); });
await new Promise((r) => setTimeout(r, 300));

const sortableState = await page.evaluate(() => ({
  hasSortableInstance: typeof _sortableInstance !== 'undefined' && _sortableInstance !== null,
  dragHandleCount: document.querySelectorAll('.widget-drag-handle').length,
  railStillOutsideGrid: !document.getElementById('widget-grid').contains(document.querySelector('.timeline-life-rail')),
  railHasDragHandle: !!(document.querySelector('.timeline-life-rail') && document.querySelector('.timeline-life-rail').querySelector('.widget-drag-handle')),
}));
console.log('sortable state:', JSON.stringify(sortableState));

// Simulate the pick-up visual (is-dragging) on the first widget-shell
await page.evaluate(() => {
  const el = document.querySelector('.widget-shell');
  el.classList.add('is-dragging');
});
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: path.join(outDir, 'is-dragging.png') });

// Simulate the lock feedback (lock-wave) on the same widget
await page.evaluate(() => {
  const el = document.querySelector('.widget-shell');
  el.classList.remove('is-dragging');
  el.classList.add('lock-wave');
});
await new Promise((r) => setTimeout(r, 150));
await page.screenshot({ path: path.join(outDir, 'lock-wave-mid.png') });

// Confirm lock-wave class auto-removes via animationend (real onEnd path uses this listener)
const lockWaveAutoRemoves = await page.evaluate(() => new Promise((resolve) => {
  const el = document.querySelector('.widget-shell');
  el.classList.remove('lock-wave');
  void el.offsetWidth;
  el.classList.add('lock-wave');
  el.addEventListener('animationend', () => resolve(!el.classList.contains('lock-wave')), { once: true });
  setTimeout(() => resolve('TIMEOUT'), 1500);
}));
console.log('lock-wave class removed after animationend:', lockWaveAutoRemoves);

console.log('errors:', errs);
await browser.close();
