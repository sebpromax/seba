import puppeteer from 'puppeteer-core';
import path from 'path';

const BASE = 'https://sebpromax.github.io/seba/';
const outDir = path.resolve('docs', 'audit-screenshots', 'fresh-eyes');

const targets = [
  { slug: 'product', viewport: { width: 1440, height: 900 } },
  { slug: 'solution', viewport: { width: 1440, height: 900 } },
  { slug: 'confiance', viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

for (const t of targets) {
  const page = await browser.newPage();
  await page.setViewport(t.viewport);
  await page.goto(BASE + t.slug + '.html', { waitUntil: 'networkidle2', timeout: 45000 });
  const height = await page.evaluate(() => document.body.scrollHeight);
  let y = 0;
  while (y < height) {
    y += 400;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 500));
  const suffix = t.viewport.isMobile ? '-mobile-scrolled' : '-desktop-scrolled';
  await page.screenshot({ path: path.join(outDir, `${t.slug}${suffix}.png`), fullPage: true });
  const hiddenCount = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    let hidden = 0;
    all.forEach(el => {
      const s = getComputedStyle(el);
      if (s.opacity === '0' && el.getBoundingClientRect().height > 50) hidden++;
    });
    return hidden;
  });
  console.log(t.slug, 'height', height, 'hiddenCount', hiddenCount);
  await page.close();
}

await browser.close();
