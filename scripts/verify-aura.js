import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'aura');
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

// Trigger immediately instead of waiting out the real staggered delay
await page.evaluate(() => {
  showAuraNotification('Paiement client X incertain (80% de retard)', 80);
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, 'aura-visible.png') });

const cardCountBefore = await page.evaluate(() => document.querySelectorAll('.aura-card').length);
const actionCountBefore = await page.evaluate(() => document.querySelectorAll('.action-vector').length);

// Click "Valider" and confirm the morph: aura gone, new action-vector appended
await page.click('.aura-card .validate');
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(outDir, 'aura-morph-mid.png') });

const result = await page.evaluate(() => {
  const auraCount = document.querySelectorAll('.aura-card').length;
  const vectors = [...document.querySelectorAll('.action-vector')].map(c => ({
    title: c.querySelector('.av-title')?.textContent,
    amount: c.querySelector('.av-amount')?.textContent,
  }));
  return { auraCount, vectors };
});
console.log('cardCountBefore:', cardCountBefore, 'actionCountBefore:', actionCountBefore);
console.log('after validate:', JSON.stringify(result, null, 2));

// Test "Ignorer" on a second notification
await page.evaluate(() => {
  showAuraNotification('Planning semaine prochaine à 90% de capacité', 90);
});
await new Promise((r) => setTimeout(r, 500));
const beforeIgnore = await page.evaluate(() => document.querySelectorAll('.aura-card').length);
await page.click('.aura-card .ignore');
await new Promise((r) => setTimeout(r, 700));
const afterIgnore = await page.evaluate(() => ({
  auraCount: document.querySelectorAll('.aura-card').length,
  actionCount: document.querySelectorAll('.action-vector').length,
}));
console.log('ignore test — before:', beforeIgnore, 'after:', JSON.stringify(afterIgnore));

console.log('errors:', errs);
await browser.close();
