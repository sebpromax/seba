import puppeteer from 'puppeteer-core';
import path from 'path';

const BASE = 'https://sebpromax.github.io/seba/';
const outDir = path.resolve('docs', 'audit-screenshots', 'fresh-eyes');

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + 'confiance.html', { waitUntil: 'networkidle2', timeout: 45000 });
const height = await page.evaluate(() => document.body.scrollHeight);
let y = 0;
while (y < height) {
  y += 400;
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(outDir, 'confiance-desktop-scrolled.png'), fullPage: true });
await browser.close();
