import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'onboarding-mobile-fix');
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

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const url = 'file://' + path.resolve('docs', 'onboarding.html');
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));

// Measure every step's real height (should now differ per step, not all identical)
const heights = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.step-container').forEach((el) => { out[el.id] = el.offsetHeight; });
  return out;
});
console.log('step-container heights (should VARY, not all be identical):', JSON.stringify(heights));

// Walk forward through the visible steps we can reach simply (0 -> 1 via continue button), check nav-btns visibility at each reached step
async function isNavBtnVisible() {
  return page.evaluate(() => {
    const nav = document.querySelector('.step-container[style*="opacity: 1"] .nav-btns') ||
      [...document.querySelectorAll('.step-container')].find(s => getComputedStyle(s).opacity === '1')?.querySelector('.nav-btns');
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, visibleInViewport: r.top < 844 && r.bottom > 0, fullyVisible: r.top >= 0 && r.bottom <= 844 };
  });
}

console.log('step-0 nav-btns visibility (no scroll):', JSON.stringify(await isNavBtnVisible()));
await page.screenshot({ path: path.join(outDir, 'step0.png') });

// Click "Continuer" on step 0 (find primary CTA)
const clicked0 = await page.evaluate(() => {
  const btn = document.querySelector('#step-0 .btn-em, #step-0 button.btn-em, #step-0 .nav-btns .btn-em');
  if (btn) { btn.click(); return true; }
  return false;
});
console.log('clicked step0 CTA:', clicked0);
await new Promise((r) => setTimeout(r, 500));
console.log('step-1 nav-btns visibility (no scroll):', JSON.stringify(await isNavBtnVisible()));
await page.screenshot({ path: path.join(outDir, 'step1.png') });

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
