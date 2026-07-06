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
await page.goto(BASE + 'index.html', { waitUntil: 'networkidle2', timeout: 45000 });

// Real incremental scroll to trigger IntersectionObserver reveals
const height = await page.evaluate(() => document.body.scrollHeight);
console.log('page height', height);
let y = 0;
while (y < height) {
  y += 400;
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 500));

const newHeight = await page.evaluate(() => document.body.scrollHeight);
console.log('page height after scroll', newHeight);

await page.screenshot({ path: path.join(outDir, 'index-desktop-scrolled.png'), fullPage: true });

// Check which elements are still opacity:0 / hidden
const hiddenCount = await page.evaluate(() => {
  const all = document.querySelectorAll('*');
  let hidden = 0;
  all.forEach(el => {
    const s = getComputedStyle(el);
    if (s.opacity === '0' && el.getBoundingClientRect().height > 50) hidden++;
  });
  return hidden;
});
console.log('elements with opacity:0 and height>50px:', hiddenCount);

await browser.close();
