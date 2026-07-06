import puppeteer from 'puppeteer-core';
import path from 'path';

const outDir = path.resolve('docs', 'audit-screenshots', 'serenity');
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('https://sebpromax.github.io/seba/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await page.setViewport({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(outDir, 'LIVE-full-check.png'), fullPage: false });
console.log('live console errors:', errs);
await browser.close();
