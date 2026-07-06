import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'ext-drawer');
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

// Open the drawer
await page.evaluate(() => openExtDrawer());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(outDir, 'drawer-open.png') });

const tileInfo = await page.evaluate(() => {
  return [...document.querySelectorAll('.ext-tile')].map(t => ({
    id: t.dataset.widgetId, name: t.querySelector('.ext-tile-name').textContent, draggable: t.getAttribute('draggable'),
  }));
});
console.log('tiles in drawer:', JSON.stringify(tileInfo));

// Confirm timeline rail still visible/unaffected while drawer is open
const railStillThere = await page.evaluate(() => {
  const rail = document.querySelector('.timeline-life-rail');
  const canvas = document.getElementById('timeline-life');
  const rect = rail.getBoundingClientRect();
  return { display: getComputedStyle(rail).display, right: rect.right, hasCanvas: !!canvas };
});
console.log('timeline rail while drawer open:', JSON.stringify(railStillThere));

// Simulate a native drop of "ext-notes" onto the grid (DataTransfer polyfill via DragEvent)
const dropResult = await page.evaluate(() => {
  const grid = document.getElementById('widget-grid');
  const dt = new DataTransfer();
  dt.setData('text/plain', 'ext-notes');
  const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  grid.dispatchEvent(dropEvent);
  return { hasWidget: !!grid.querySelector('.widget-shell[data-widget-id="ext-notes"]') };
});
console.log('drop result:', JSON.stringify(dropResult));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(outDir, 'after-drop.png') });

// Confirm the tile now shows as "installed" after refresh
const tileAfter = await page.evaluate(() => {
  const t = document.querySelector('.ext-tile[data-widget-id="ext-notes"]');
  return t ? { classes: t.className, draggable: t.getAttribute('draggable') } : null;
});
console.log('tile after install:', JSON.stringify(tileAfter));

console.log('errors:', errs);
await browser.close();
