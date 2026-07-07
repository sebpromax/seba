import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

// ─── Config ───
const MODE = process.argv[2] || 'local'; // 'local' | 'live'
const DEVICE = process.argv[3] || 'desktop'; // 'desktop' | 'mobile'

const BASE_LOCAL = `file://${path.resolve('docs', 'onboarding.html').replace(/\\/g, '/')}`;
const BASE_LIVE = 'https://sebpromax.github.io/seba/onboarding.html';
const URL = MODE === 'live' ? BASE_LIVE : BASE_LOCAL;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const viewport = VIEWPORTS[DEVICE];

const outDir = path.resolve('docs', 'audit-screenshots', 'onboarding-qa', `${MODE}-${DEVICE}`);
fs.mkdirSync(outDir, { recursive: true });

const findings = [];
function flag(sev, text) { findings.push({ sev, text }); console.log(`[${sev}] ${text}`); }
function note(text) { console.log(`  . ${text}`); }

const NOISE_PATTERNS = [/manifest\.json/i, /ERR_FAILED/i, /ERR_NAME_NOT_RESOLVED/i, /ERR_INTERNET_DISCONNECTED/i];
function isNoise(msg) { return NOISE_PATTERNS.some(p => p.test(msg)); }

async function shot(page, name) {
  const p = path.join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: p, fullPage: false, timeout: 10000 });
  } catch (e) {
    note(`(screenshot "${name}" failed/skipped: ${e.message})`);
  }
  return p;
}

async function checkHScroll(page, label) {
  const res = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  if (res.scrollW > res.clientW + 2) {
    flag('HIGH', `Horizontal scroll detected at ${label}: scrollWidth=${res.scrollW} > clientWidth=${res.clientW}`);
  } else {
    note(`No horizontal scroll at ${label} (${res.scrollW} vs ${res.clientW})`);
  }
}

async function main() {
  console.log(`\n=== QA RUN: mode=${MODE} device=${DEVICE} url=${URL} ===`);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await page.setViewport(viewport);

  const consoleErrors = [];
  const pageErrors = [];
  page.on('pageerror', err => { pageErrors.push(err.message); });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isNoise(text)) consoleErrors.push(text);
    }
  });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch (e) {
    flag('CRITICAL', `Page failed to load (${MODE}/${DEVICE}): ${e.message}`);
    await browser.close();
    return { findings, consoleErrors, pageErrors };
  }

  await new Promise(r => setTimeout(r, 500));

  // ── STEP 0 : welcome ──
  await shot(page, '00-welcome');
  await checkHScroll(page, 'step 0 (welcome)');

  if (DEVICE === 'mobile') {
    // Hero position check (past bug: hero text too low)
    const heroBox = await page.evaluate(() => {
      const el = document.querySelector('#step-0 .w-title');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, viewportH: window.innerHeight };
    });
    if (heroBox) {
      const ratio = heroBox.top / heroBox.viewportH;
      note(`Hero title top=${heroBox.top.toFixed(0)}px of ${heroBox.viewportH}px viewport (ratio ${ratio.toFixed(2)})`);
      if (ratio > 0.45) {
        flag('HIGH', `REGRESSION? Hero title positioned too low on mobile step 0: top ratio ${ratio.toFixed(2)} (top=${heroBox.top.toFixed(0)}px)`);
      }
    } else {
      flag('HIGH', 'Could not find .w-title element on step 0');
    }

    // Hamburger menu check
    const burgerBox = await page.evaluate(() => {
      const b = document.getElementById('sh-burger');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { left: r.left, right: r.right, windowW: window.innerWidth, display: getComputedStyle(b).display };
    });
    if (!burgerBox || burgerBox.display === 'none') {
      flag('HIGH', 'Hamburger button not visible/found on mobile viewport');
    } else {
      const distFromRight = burgerBox.windowW - burgerBox.right;
      const distFromLeft = burgerBox.left;
      note(`Burger box: left=${distFromLeft.toFixed(0)} right-gap=${distFromRight.toFixed(0)} windowW=${burgerBox.windowW}`);
      // right-aligned means the button sits in the right half AND its right-gap is small (close to page padding)
      if (distFromLeft > burgerBox.windowW * 0.5 && distFromRight < 40) {
        note('Burger appears correctly right-aligned (not centered)');
      } else {
        flag('HIGH', `REGRESSION? Hamburger appears NOT right-aligned (possibly centered): left=${distFromLeft.toFixed(0)}px right-gap=${distFromRight.toFixed(0)}px on ${burgerBox.windowW}px width`);
      }
      await page.click('#sh-burger');
      await new Promise(r => setTimeout(r, 400));
      const overlayState = await page.evaluate(() => {
        const o = document.getElementById('sh-overlay');
        return o ? { opened: o.classList.contains('open'), ariaHidden: o.getAttribute('aria-hidden') } : null;
      });
      await shot(page, '00b-hamburger-open');
      if (!overlayState || !overlayState.opened) {
        flag('HIGH', 'Hamburger menu did not open overlay on click');
      } else {
        note('Hamburger overlay opened correctly');
      }
      // close it again
      await page.click('#sh-burger');
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Click "Commencer"
  try {
    await page.click('#step-0 button.btn-em');
  } catch (e) {
    flag('CRITICAL', `Could not click "Commencer" button on step 0: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 1 : pays ──
  await shot(page, '01-pays');
  await checkHScroll(page, 'step 1 (pays)');
  try {
    await page.select('#sel-pays', 'FR');
  } catch (e) {
    flag('CRITICAL', `Could not select country FR: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 300));

  // Check nav buttons not overlapped by content
  await checkNavOverlap(page, 'step 1');

  await clickContinue(page, 1);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 2 : secteur ──
  await shot(page, '02-secteur');
  await checkHScroll(page, 'step 2 (secteur)');
  try {
    await page.click('#sc-menage');
  } catch (e) {
    flag('CRITICAL', `Could not click sector card sc-menage: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 400));
  await shot(page, '02b-secteur-selected');
  await checkNavOverlap(page, 'step 2');
  await clickContinue(page, 2);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 3 : orientation (conditional - menage triggers it) ──
  const onStep3 = await page.evaluate(() => document.getElementById('step-3') &&
    getComputedStyle(document.getElementById('step-3')).pointerEvents !== 'none');
  if (onStep3) {
    note('Step 3 (orientation) reached as expected for sector "menage"');
    await shot(page, '03-orientation');
    await checkHScroll(page, 'step 3 (orientation)');
    const btnDisabledBefore = await page.evaluate(() => document.getElementById('or-continue-btn')?.disabled);
    if (!btnDisabledBefore) flag('MEDIUM', 'Step 3 continue button not disabled before any orientation selected');
    try {
      await page.click('#or-particuliers');
    } catch (e) {
      flag('HIGH', `Could not click orientation card #or-particuliers: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
    const btnDisabledAfter = await page.evaluate(() => document.getElementById('or-continue-btn')?.disabled);
    if (btnDisabledAfter) flag('HIGH', 'Step 3 continue button still disabled after selecting an orientation');
    await checkNavOverlap(page, 'step 3');
    await page.click('#or-continue-btn');
    await new Promise(r => setTimeout(r, 600));
  } else {
    flag('MEDIUM', 'Step 3 (orientation) was NOT reached after selecting "menage" sector — expected conditional step to trigger');
  }

  // ── STEP 4 : baptême (nom) ──
  await shot(page, '04-bapteme');
  await checkHScroll(page, 'step 4 (bapteme)');
  const TEST_NAME = 'QA Test Entreprise';
  try {
    await page.type('#inp-nom', TEST_NAME, { delay: 20 });
  } catch (e) {
    flag('CRITICAL', `Could not type into #inp-nom: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 300));
  await checkNavOverlap(page, 'step 4');

  // Test BACK navigation + persistence
  try {
    await page.click('#step-4 button.btn-ghost');
    await new Promise(r => setTimeout(r, 500));
    const backLandedOn = await page.evaluate(() => {
      for (const n of [3, 2]) {
        const el = document.getElementById('step-' + n);
        if (el && getComputedStyle(el).pointerEvents !== 'none') return n;
      }
      return null;
    });
    note(`Back from step 4 landed on step ${backLandedOn}`);
    await shot(page, '04b-back-nav');
    // go forward again
    if (backLandedOn === 3) {
      await page.click('#or-continue-btn');
    } else if (backLandedOn === 2) {
      await clickContinue(page, 2);
    }
    await new Promise(r => setTimeout(r, 600));
    const nomValueAfterReturn = await page.evaluate(() => document.getElementById('inp-nom')?.value);
    if (nomValueAfterReturn === TEST_NAME) {
      note('Data persisted correctly after back-then-forward navigation (nom field)');
    } else {
      flag('HIGH', `Data NOT persisted after back navigation: expected "${TEST_NAME}", got "${nomValueAfterReturn}"`);
    }
  } catch (e) {
    flag('MEDIUM', `Back-navigation test failed with error: ${e.message}`);
  }

  await page.type('#inp-pub', 'QA Public Name', { delay: 15 }).catch(() => {});
  await clickContinue(page, 4);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 5 : signature ──
  await shot(page, '05-signature');
  await checkHScroll(page, 'step 5 (signature)');
  await page.type('#inp-welcome', 'QA slogan de test', { delay: 15 }).catch(() => {});
  await page.type('#inp-desc', 'Description QA de test pour audit onboarding.', { delay: 10 }).catch(() => {});
  const swatchClicked = await page.evaluate(() => {
    const sw = document.querySelectorAll('.swatch')[2];
    if (sw) { sw.click(); return true; }
    return false;
  });
  if (!swatchClicked) flag('LOW', 'Could not find a 3rd color swatch to click on step 5');
  await new Promise(r => setTimeout(r, 300));
  await checkNavOverlap(page, 'step 5');
  await clickContinue(page, 5);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 6 : services (dense step — PAST SCROLL-TRAP BUG) ──
  await shot(page, '06-services');
  await checkHScroll(page, 'step 6 (services)');
  const svcInfo = await page.evaluate(() => {
    const list = document.getElementById('svc-list');
    const container = document.getElementById('step-6');
    const cs = container ? getComputedStyle(container) : null;
    return {
      svcCount: list ? list.children.length : 0,
      anyChecked: !!document.querySelector('#svc-list input[type=checkbox]:checked'),
      overflowY: cs ? cs.overflowY : null,
      touchAction: cs ? cs.touchAction : null,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
  note(`Step 6: ${svcInfo.svcCount} services rendered, anyChecked=${svcInfo.anyChecked}, overflow-y=${svcInfo.overflowY}, touch-action=${svcInfo.touchAction}`);
  if (!svcInfo.anyChecked) flag('MEDIUM', 'No service pre-checked by default on step 6 — user must manually check one or Continue will show a validation error');

  if (DEVICE === 'mobile') {
    // Regression test: simulate a real touch-scroll gesture and confirm the page actually scrolls
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    try {
      await page.touchscreen.touchStart(195, 650);
      await page.touchscreen.touchMove(195, 300);
      await page.touchscreen.touchEnd();
    } catch (e) {
      note(`touchscreen gesture API issue: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    note(`Step 6 touch-scroll test: scrollY before=${scrollYBefore} after=${scrollYAfter} (doc scrollHeight=${svcInfo.scrollHeight}, viewport=${svcInfo.innerHeight})`);
    if (svcInfo.scrollHeight > svcInfo.innerHeight + 50 && scrollYAfter === scrollYBefore) {
      flag('CRITICAL', `REGRESSION: Touch-scroll appears FROZEN on step 6 (Vos prestations) on mobile — content taller than viewport (${svcInfo.scrollHeight}px vs ${svcInfo.innerHeight}px) but scrollY did not change after simulated swipe`);
    } else if (svcInfo.scrollHeight > svcInfo.innerHeight + 50) {
      note('Step 6 touch-scroll works correctly on mobile (no regression of past scroll-trap bug)');
    } else {
      note('Step 6 content fits in viewport, scroll not required for this content length');
    }
    await shot(page, '06b-services-scrolled');
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 200));
  }
  await checkNavOverlap(page, 'step 6');
  await clickContinue(page, 6);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 7 : horaires ──
  await shot(page, '07-horaires');
  await checkHScroll(page, 'step 7 (horaires)');
  try {
    await page.click('#chk-urgences');
    await new Promise(r => setTimeout(r, 300));
    await shot(page, '07b-horaires-urgences');
  } catch (e) {
    flag('LOW', `Could not toggle #chk-urgences: ${e.message}`);
  }
  await checkNavOverlap(page, 'step 7');
  await clickContinue(page, 7);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 8 : compte (RAPID DOUBLE-CLICK TEST on validateStep) ──
  await shot(page, '08-compte');
  await checkHScroll(page, 'step 8 (compte)');
  await checkNavOverlap(page, 'step 8');

  const TEST_EMAIL = `qa.onboarding.test+${Date.now()}@example.com`;
  await page.type('#inp-email', TEST_EMAIL, { delay: 10 }).catch(() => {});
  await page.type('#inp-phone-s8', '0612345678', { delay: 10 }).catch(() => {});

  // Test mismatch validation first
  await page.type('#inp-pwd', 'password123', { delay: 10 }).catch(() => {});
  await page.type('#inp-pwd2', 'differentpwd', { delay: 10 }).catch(() => {});
  const btnCreerSelector = '#btn-creer';
  await page.click(btnCreerSelector).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const mismatchErrShown = await page.evaluate(() => document.getElementById('err-pwd2')?.classList.contains('show'));
  if (!mismatchErrShown) {
    flag('MEDIUM', 'Password mismatch error not shown when passwords differ on step 8');
  } else {
    note('Password-mismatch validation correctly blocks submission on step 8');
  }
  // fix password2 to match
  await page.click('#inp-pwd2', { clickCount: 3 }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace').catch(() => {});
  await page.type('#inp-pwd2', 'password123', { delay: 10 }).catch(() => {});
  await new Promise(r => setTimeout(r, 200));

  // Rapid double-click test on final submit button (dispatched in-page to
  // avoid Puppeteer's per-click actionability/scroll waits hanging on an
  // element that starts animating/transitioning away immediately after click)
  const stepBeforeSubmit = await page.evaluate(() => window._currentStep);
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); btn.click(); }
  }, btnCreerSelector).catch(e => note(`rapid double-click dispatch issue: ${e.message}`));
  await new Promise(r => setTimeout(r, 500));
  await shot(page, '08b-post-submit-rapid-click');

  // ── STEP 9 : loading / redirect ──
  note('Waiting for loading animation + redirect to dashboard.html...');
  let redirected = false;
  let finalUrl = page.url();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { finalUrl = page.url(); } catch (e) {}
    if (/dashboard\.html/.test(finalUrl)) { redirected = true; break; }
    if (/connexion\.html/.test(finalUrl)) { break; }
  }
  await new Promise(r => setTimeout(r, 300));
  await shot(page, '09-final-state');

  try {
    if (!redirected) {
      flag('HIGH', `Onboarding did not redirect to dashboard.html within 10s of final submission. Final URL: ${finalUrl}`);
    } else {
      note(`Redirected successfully to: ${finalUrl}`);
      await new Promise(r => setTimeout(r, 1000));
      await shot(page, '10-dashboard-after-redirect');
      const dashboardData = await page.evaluate(() => {
        try {
          const biz = JSON.parse(localStorage.getItem('sebaEntreprise') || '{}');
          return { nom: biz.nom, secteur: biz.secteur, bodyText: document.body.innerText.slice(0, 2000) };
        } catch (e) { return { error: e.message }; }
      });
      if (dashboardData.nom === TEST_NAME) {
        note(`Dashboard localStorage correctly shows business name: "${dashboardData.nom}"`);
      } else {
        flag('HIGH', `Dashboard localStorage business name mismatch: expected "${TEST_NAME}", got "${dashboardData.nom}"`);
      }
      if (dashboardData.bodyText && dashboardData.bodyText.includes(TEST_NAME)) {
        note('Business name visibly rendered in dashboard.html body text');
      } else {
        flag('MEDIUM', `Business name "${TEST_NAME}" not found in visible dashboard body text (may render async/later, or may be a display bug)`);
      }
    }
  } catch (e) {
    flag('MEDIUM', `Post-redirect verification threw an error: ${e.message}`);
  }

  // Collect console/page errors
  if (pageErrors.length) {
    pageErrors.forEach(e => flag('HIGH', `JS pageerror during flow (${MODE}/${DEVICE}): ${e}`));
  } else {
    note('No JS pageerror events during entire flow');
  }
  if (consoleErrors.length) {
    consoleErrors.forEach(e => flag('MEDIUM', `console.error during flow (${MODE}/${DEVICE}): ${e}`));
  } else {
    note('No console.error events during entire flow (excluding known noise)');
  }

  try { await browser.close(); } catch (e) {}
  return { findings, consoleErrors, pageErrors };
}

async function checkNavOverlap(page, label) {
  const overlap = await page.evaluate(() => {
    const stepEls = Array.from(document.querySelectorAll('.step-container')).filter(el => getComputedStyle(el).pointerEvents !== 'none');
    const active = stepEls[0];
    if (!active) return null;
    const nav = active.querySelector('.nav-btns');
    if (!nav) return null;
    const navRect = nav.getBoundingClientRect();
    const continueBtn = nav.querySelector('.btn-em');
    if (!continueBtn) return null;
    const btnRect = continueBtn.getBoundingClientRect();
    // find any sibling content element whose box intersects the button box (other than nav itself)
    const candidates = Array.from(active.querySelectorAll('input,select,.sector-card,.svc-row,.orientation-card,.fiscal-card,textarea'));
    let overlapFound = null;
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      if (r.bottom > btnRect.top && r.top < btnRect.bottom && r.right > btnRect.left && r.left < btnRect.right) {
        overlapFound = c.tagName + (c.id ? '#' + c.id : '') + (c.className ? '.' + String(c.className).split(' ')[0] : '');
        break;
      }
    }
    return {
      btnInViewport: btnRect.top >= 0 && btnRect.bottom <= window.innerHeight && btnRect.left >= 0 && btnRect.right <= window.innerWidth,
      overlapFound,
      btnRect: { top: btnRect.top, bottom: btnRect.bottom, left: btnRect.left, right: btnRect.right, height: btnRect.height },
      viewportH: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
    };
  });
  if (!overlap) { note(`(nav overlap check skipped at ${label} — no nav-btns found)`); return; }
  if (overlap.overlapFound) {
    flag('HIGH', `Continue button overlapped by content "${overlap.overlapFound}" at ${label}`);
  } else if (!overlap.btnInViewport) {
    const cutoff = overlap.btnRect.bottom - overlap.viewportH;
    flag('MEDIUM', `Continue button below the fold at ${label}: bottom=${overlap.btnRect.bottom.toFixed(0)}px vs viewport height=${overlap.viewportH}px (cut off by ~${cutoff.toFixed(0)}px, doc scrollHeight=${overlap.docScrollHeight}px) — requires scrolling to fully reveal on initial load`);
  } else {
    note(`Continue button clear of overlap and within viewport at ${label}`);
  }
}

async function clickContinue(page, stepNum) {
  const sel = `#step-${stepNum} .nav-btns .btn-em`;
  try {
    await page.waitForSelector(sel, { timeout: 5000 });
    await page.click(sel);
  } catch (e) {
    flag('CRITICAL', `Could not click Continue button for step ${stepNum} (selector ${sel}): ${e.message}`);
  }
}

const HARD_TIMEOUT = setTimeout(() => {
  console.error('HARD TIMEOUT: script did not finish within 90s — killing process.');
  process.exit(2);
}, 90000);

main().then(({ findings }) => {
  console.log('\n=== SUMMARY for', MODE, DEVICE, '===');
  if (findings.length === 0) console.log('No findings recorded.');
  findings.forEach(f => console.log(`[${f.sev}] ${f.text}`));
  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
  clearTimeout(HARD_TIMEOUT);
}).catch(e => {
  console.error('FATAL SCRIPT ERROR:', e);
  process.exit(1);
});
