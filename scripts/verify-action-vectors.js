import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'action-vectors');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest')) errs.push('CONSOLE: ' + msg.text()); });

const url = 'file://' + path.resolve('docs', 'dashboard.html');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
  // Seed a couple of late invoices via the same store the contentieux tool uses
  localStorage.setItem('seba_creances_imp', JSON.stringify([
    { client: 'Julie Dumont', montant: 160, relanceStep: 2 },
    { client: 'Marc Roussel', montant: 90, relanceStep: 3 },
  ]));
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await page.setViewport({ width: 1440, height: 1400 });
await new Promise((r) => setTimeout(r, 1200));

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.action-vector')].map(c => ({
    title: c.querySelector('.av-title')?.textContent,
    amount: c.querySelector('.av-amount')?.textContent,
  }));
  return { count: cards.length, cards };
});
console.log('action cards found:', JSON.stringify(info, null, 2));

await page.screenshot({ path: path.join(outDir, 'action-stream-full.png'), fullPage: true });

// Click the first "Valider" and confirm it animates out and is removed
const before = await page.evaluate(() => document.querySelectorAll('.action-vector').length);
await page.click('.action-vector .av-validate');
await new Promise((r) => setTimeout(r, 150));
const midClass = await page.evaluate(() => {
  const el = document.querySelector('.action-vector.leaving');
  if (!el) return null;
  const s = getComputedStyle(el);
  return { opacity: s.opacity, transform: s.transform };
});
await new Promise((r) => setTimeout(r, 400));
const after = await page.evaluate(() => document.querySelectorAll('.action-vector').length);
console.log('cards before click:', before, '| mid-transition state:', JSON.stringify(midClass), '| cards after (should be before-1):', after);

console.log('errors:', errs);
await browser.close();
