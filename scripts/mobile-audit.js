import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const pages = [
  'index.html',
  'onboarding.html',
  'dashboard.html',
  'clients.html',
  'product.html',
  'solution.html',
  'confiance.html'
];

const outDir = path.resolve('docs', 'audit-screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

for (const relative of pages) {
  const url = `file://${path.resolve('docs', relative)}`;
  console.log('Capturing', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, relative.replace('.html', '-mobile.png')), fullPage: true });
}

await browser.close();
console.log('Screenshots saved to', outDir);
