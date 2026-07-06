import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'focus-mode');
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

const url = 'file://' + path.resolve('docs', 'dashboard.html') + '?demo';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
  localStorage.setItem('seba_creances_imp', JSON.stringify([
    { client: 'Julie Dumont', montant: 260, relanceStep: 2 },
  ]));
});
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// Toggle Focus mode via keyboard shortcut F
await page.keyboard.press('f');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, 'focus-on.png') });

const state = await page.evaluate(() => {
  const overlay = document.getElementById('focus-overlay');
  const canvas = document.getElementById('focus-serenity-canvas');
  const actionLine = document.getElementById('focus-action-line');
  return {
    overlayOpen: overlay.classList.contains('open'),
    overlayVisible: overlay.classList.contains('visible'),
    bodyHasFocusClass: document.body.classList.contains('focus-active'),
    canvasSize: { w: canvas.width, h: canvas.height },
    actionText: actionLine.textContent.trim(),
    sidebarOpacity: getComputedStyle(document.querySelector('.sidebar')).opacity,
  };
});
console.log('focus mode state:', JSON.stringify(state, null, 2));

// Exit via Escape
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
const afterEscape = await page.evaluate(() => ({
  overlayOpen: document.getElementById('focus-overlay').classList.contains('open'),
  bodyHasFocusClass: document.body.classList.contains('focus-active'),
}));
console.log('after Escape:', JSON.stringify(afterEscape));
await page.screenshot({ path: path.join(outDir, 'focus-off.png') });

// Re-toggle rapidly a few times (stress the cleanup handle) then verify no leaked errors
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => toggleFocusMode());
  await new Promise((r) => setTimeout(r, 120));
}
console.log('rapid focus toggle x4 done');

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
