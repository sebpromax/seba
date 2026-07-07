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

// Directly drive goStep() to jump through steps quickly (bypasses needing to fill every field)
for (let i = 0; i <= 8; i++) {
  await page.evaluate((n) => { if (typeof goStep === 'function') goStep(n); }, i);
  await new Promise((r) => setTimeout(r, 350));

  const info = await page.evaluate((n) => {
    const el = document.getElementById('step-' + n);
    if (!el) return null;
    const nav = el.querySelector('.nav-btns');
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    return {
      stepHeight: el.offsetHeight,
      navBtnPresent: !!nav,
      navRect: navRect ? { top: navRect.top, bottom: navRect.bottom } : null,
      navReachableWithoutScroll: navRect ? (navRect.top < 844 && navRect.bottom > 0) : null,
      documentScrollHeight: docHeight,
    };
  }, i);
  console.log('step-' + i, JSON.stringify(info));
  await page.screenshot({ path: path.join(outDir, 'step-' + i + '.png') });

  // if nav not reachable without scroll, try scrolling to it and confirm it CAN be reached
  if (info && info.navRect && !info.navReachableWithoutScroll) {
    const reachedAfterScroll = await page.evaluate((n) => {
      const nav = document.getElementById('step-' + n).querySelector('.nav-btns');
      nav.scrollIntoView({ block: 'end' });
      const r = nav.getBoundingClientRect();
      return r.top < 844 && r.bottom > 0;
    }, i);
    console.log('  -> reachable after scrollIntoView:', reachedAfterScroll);
  }
}

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
