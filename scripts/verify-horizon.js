import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'horizon');
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
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await page.setViewport({ width: 1440, height: 1500 });
await new Promise((r) => setTimeout(r, 1200));

const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('horizon-line');
  return { exists: !!c, width: c ? c.width : 0, height: c ? c.height : 0 };
});
console.log('canvas info:', JSON.stringify(canvasInfo));

await page.evaluate(() => document.getElementById('horizon-line').scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 300));
const box = await page.evaluate(() => {
  const el = document.getElementById('horizon-line');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
console.log('box:', JSON.stringify(box));

// screenshot without hover (full viewport, no clip math — avoids stale-rect pitfalls)
await page.screenshot({ path: path.join(outDir, 'horizon-no-hover.png') });

// hover near the middle-left of the curve
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
await new Promise((r) => setTimeout(r, 300));
const tipInfo = await page.evaluate(() => {
  const t = document.querySelector('.horizon-tip');
  return t ? { visible: t.classList.contains('visible'), text: t.textContent } : null;
});
console.log('tooltip on hover:', JSON.stringify(tipInfo));
await page.screenshot({ path: path.join(outDir, 'horizon-hover.png') });

// Test resize: shrink viewport and confirm canvas backing size updates
await page.setViewport({ width: 900, height: 1500 });
await new Promise((r) => setTimeout(r, 500));
const afterResize = await page.evaluate(() => {
  const c = document.getElementById('horizon-line');
  return { width: c.width, height: c.height, cssWidth: c.style.width };
});
console.log('canvas after resize:', JSON.stringify(afterResize));
await page.screenshot({ path: path.join(outDir, 'horizon-after-resize.png') });

console.log('errors:', errs);
await browser.close();
