import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const BASE = 'https://sebpromax.github.io/seba/';

const pages = [
  'index.html',
  'onboarding.html',
  'dashboard.html?demo',
  'tarifs.html',
  'product.html',
  'solution.html',
  'confiance.html',
  'clients.html?demo',
];

const outDir = path.resolve('docs', 'audit-screenshots', 'fresh-eyes');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const consoleErrors = {};

for (const relative of pages) {
  const slug = relative.replace(/[?].*$/, '').replace('.html', '');
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });

  // Desktop
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const url = BASE + relative;
  console.log('Capturing desktop', url);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: path.join(outDir, `${slug}-desktop.png`), fullPage: true });
  } catch (e) { errs.push('NAV_FAIL_DESKTOP: ' + e.message); }

  // Mobile
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  console.log('Capturing mobile', url);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: path.join(outDir, `${slug}-mobile.png`), fullPage: true });
  } catch (e) { errs.push('NAV_FAIL_MOBILE: ' + e.message); }

  consoleErrors[slug] = errs;
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(outDir, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2));
console.log('Done. Screenshots + console-errors.json in', outDir);
