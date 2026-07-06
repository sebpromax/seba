import puppeteer from 'puppeteer-core';
import path from 'path';

const outDir = path.resolve('docs', 'audit-screenshots', 'tactical-dark');
import fs from 'fs';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
const url = 'file://' + path.resolve('docs', 'dashboard.html');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage', 'Vitres', 'Repassage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

await page.setViewport({ width: 1440, height: 900 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(outDir, 'dashboard-desktop.png'), fullPage: true });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(outDir, 'dashboard-mobile.png'), fullPage: true });

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
console.log('done, console errors captured after reload only (see below if any)');

await browser.close();
