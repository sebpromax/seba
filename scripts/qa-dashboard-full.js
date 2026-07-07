import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

// Args: --target=local|live --viewport=desktop|mobile
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const target = args.target || 'local';
const vp = args.viewport || 'desktop';

const outDir = path.resolve('docs', 'audit-screenshots', `qa-full-${target}-${vp}`);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const localUrl = 'file://' + path.resolve('docs', 'dashboard.html').replace(/\\/g, '/') + '?demo';
const liveUrl = 'https://sebpromax.github.io/seba/dashboard.html?demo';
const url = target === 'live' ? liveUrl : localUrl;

const IGNORE = [/manifest\.json/i, /ERR_FAILED/i, /ERR_NAME_NOT_RESOLVED/i];

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push({ where: 'CURRENT', type: 'pageerror', text: String(e) }));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (IGNORE.some(rx => rx.test(text))) return;
    errs.push({ where: 'CURRENT', type: 'console', text });
  }
});
page.on('requestfailed', (req) => {
  const f = req.failure();
  const t = f ? f.errorText : '';
  if (IGNORE.some(rx => rx.test(t)) || IGNORE.some(rx => rx.test(req.url()))) return;
  errs.push({ where: 'CURRENT', type: 'requestfailed', text: `${req.url()} :: ${t}` });
});

let phase = 'init';
function mark(p) { phase = p; }
function collectErrs() {
  const mine = errs.filter(e => e.where === 'CURRENT').map(e => ({ ...e, phase }));
  return mine;
}
// re-tag as we go: snapshot approach - store phase per error at push time instead
const taggedErrs = [];
page.removeAllListeners('pageerror');
page.removeAllListeners('console');
page.removeAllListeners('requestfailed');
page.on('pageerror', (e) => taggedErrs.push({ phase, type: 'pageerror', text: String(e) }));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (IGNORE.some(rx => rx.test(text))) return;
    taggedErrs.push({ phase, type: 'console', text });
  }
});
page.on('requestfailed', (req) => {
  const f = req.failure();
  const t = f ? f.errorText : '';
  if (IGNORE.some(rx => rx.test(t)) || IGNORE.some(rx => rx.test(req.url()))) return;
  taggedErrs.push({ phase, type: 'requestfailed', text: `${req.url()} :: ${t}` });
});

const results = { target, viewport: vp, url, findings: [] };
function finding(text) { results.findings.push(text); console.log('FINDING: ' + text); }

try {
  mark('0-empty-state-load');
  if (target === 'local') {
    await page.goto('file://' + path.resolve('docs', 'dashboard.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.goto('https://sebpromax.github.io/seba/dashboard.html', { waitUntil: 'networkidle2', timeout: 45000 });
  }
  await new Promise(r => setTimeout(r, 1000));
  if (vp === 'mobile') {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  } else {
    await page.setViewport({ width: 1440, height: 900 });
  }
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, '00-empty-state.png'), fullPage: false });

  mark('1-seed-and-reload');
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({
      nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
      services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
    }));
    // QA 2026-07-08 : sans ce flag, showCalibration() (dashboard.html) ouvre la
    // Planète de Calibration à chaque rechargement (elle ne s'affiche qu'une fois
    // par navigateur via ce flag) — l'overlay plein écran (position:fixed;inset:0)
    // reste ouvert ~5s et intercepte silencieusement les clics de test suivants
    // (ex. "Valider" sur un Vecteur d'Action), produisant un FINDING trompeur sans
    // rapport avec le widget testé. Ce script teste le dashboard "utilisateur
    // revenant", pas la cérémonie elle-même (non couverte ici) : on la marque donc
    // comme déjà vue, comme le ferait un vrai utilisateur au 2e chargement.
    localStorage.setItem('seba_calibration_seen', '1');
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, '01-populated-state.png'), fullPage: false });

  const basicInfo = await page.evaluate(() => ({
    title: document.title,
    widgetCount: document.querySelectorAll('.widget-shell').length,
    serenityCanvas: !!document.querySelector('.serenity-canvas'),
    actionStreamChildren: document.querySelectorAll('#action-stream > *').length,
    horizonCanvas: !!document.getElementById('horizon-line'),
    timelineCanvas: !!document.getElementById('timeline-life'),
  }));
  log('basic', JSON.stringify(basicInfo));
  if (basicInfo.widgetCount === 0) finding('No .widget-shell elements rendered after seeding + reload (populated state looks empty)');

  // 2. Serenity Score hover
  mark('2-serenity-hover');
  const serenityWidget = await page.$('.widget-shell[data-widget-id="serenity-score"]');
  if (serenityWidget) {
    const box = await serenityWidget.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise(r => setTimeout(r, 600));
      await serenityWidget.screenshot({ path: path.join(outDir, '02-serenity-hover.png') });
      const orbitInfo = await page.evaluate(() => {
        const labels = document.querySelectorAll('.serenity-orbit-label, [class*="orbit"]');
        return { orbitLabelCount: labels.length };
      });
      log('serenity', JSON.stringify(orbitInfo));
    } else {
      finding('Serenity widget found but has no bounding box (hidden/zero-size)');
    }
  } else {
    finding('Serenity Score widget (.widget-shell[data-widget-id="serenity-score"]) not found in DOM');
  }

  // 3. Action stream - Valider button dismissal
  mark('3-action-stream-valider');
  const actionCardsBefore = await page.$$eval('#action-stream [class*="action-card"], #action-stream > *', els => els.length);
  log('action-stream', `cards before: ${actionCardsBefore}`);
  const validerBtn = await page.$('#action-stream button');
  if (validerBtn) {
    const btnText = await page.evaluate(el => el.textContent, validerBtn);
    await validerBtn.click();
    await new Promise(r => setTimeout(r, 800));
    const actionCardsAfter = await page.$$eval('#action-stream [class*="action-card"], #action-stream > *', els => els.length);
    log('action-stream', `clicked btn "${btnText.trim()}", cards after: ${actionCardsAfter}`);
    await page.screenshot({ path: path.join(outDir, '03-action-stream-after-dismiss.png') });
    if (actionCardsAfter >= actionCardsBefore && actionCardsBefore > 0) {
      finding(`Action Stream: clicking "${btnText.trim()}" did not reduce card count (before=${actionCardsBefore}, after=${actionCardsAfter})`);
    }
  } else {
    finding('Action Stream (#action-stream): no buttons found to click (Valider button missing)');
  }

  // 4. Horizon line hover + resize
  mark('4-horizon-hover-resize');
  const horizonCanvas = await page.$('#horizon-line');
  if (horizonCanvas) {
    const box = await horizonCanvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await new Promise(r => setTimeout(r, 300));
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
      await new Promise(r => setTimeout(r, 300));
      const tooltip = await page.evaluate(() => {
        const t = document.querySelector('[class*="horizon-tooltip"], [class*="tooltip"]');
        return t ? { text: t.textContent.trim(), visible: getComputedStyle(t).display !== 'none' && getComputedStyle(t).opacity !== '0' } : null;
      });
      log('horizon', 'tooltip: ' + JSON.stringify(tooltip));
      await page.screenshot({ path: path.join(outDir, '04-horizon-hover.png') });
      // resize
      const prevVp = page.viewport();
      await page.setViewport({ width: prevVp.width - 200, height: prevVp.height });
      await new Promise(r => setTimeout(r, 500));
      const sizeAfterResize = await page.evaluate(() => {
        const c = document.getElementById('horizon-line');
        return { w: c.width, h: c.height, clientW: c.clientWidth };
      });
      log('horizon', 'after resize: ' + JSON.stringify(sizeAfterResize));
      await page.screenshot({ path: path.join(outDir, '04b-horizon-after-resize.png') });
      await page.setViewport(prevVp);
      await new Promise(r => setTimeout(r, 400));
    } else {
      finding('Horizon line canvas (#horizon-line) found but zero-size / not visible');
    }
  } else {
    finding('Horizon line canvas (#horizon-line) not found in DOM');
  }

  // 5. Timeline de Vie hover + resize
  // QA 2026-07-08 : .timeline-life-rail est caché en CSS sous 1180px par design
  // (audit 3.4 — la boucle rAF associée est même volontairement arrêtée en dessous
  // de ce seuil, cf. widgets.js renderTimelineLife). Sur le viewport mobile
  // (390px), un canvas zero-size est donc le comportement ATTENDU, pas un bug :
  // ne pas le signaler comme un FINDING, seulement le journaliser.
  mark('5-timeline-hover-resize');
  const timelineCanvas = await page.$('#timeline-life');
  if (timelineCanvas) {
    const box = await timelineCanvas.boundingBox();
    const vpWidth = page.viewport().width;
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, '05-timeline-hover.png') });
    } else if (vpWidth < 1181) {
      log('timeline', `zero-size canvas at ${vpWidth}px viewport — attendu (rail masqué < 1180px par design, audit 3.4)`);
    } else {
      finding('Timeline de Vie canvas (#timeline-life) found but zero-size / not visible');
    }
  } else {
    finding('Timeline de Vie canvas (#timeline-life) not found in DOM');
  }

  // 6. Customize mode / drag and drop
  mark('6-customize-mode');
  await page.evaluate(() => { if (typeof toggleCustomizeMode === 'function') toggleCustomizeMode(); });
  await new Promise(r => setTimeout(r, 600));
  const customizeState = await page.evaluate(() => ({
    bodyHasClass: document.body.classList.contains('customize-mode'),
    dragHandles: document.querySelectorAll('.widget-drag-handle').length,
  }));
  log('customize', JSON.stringify(customizeState));
  if (!customizeState.bodyHasClass) finding('toggleCustomizeMode() did not add "customize-mode" class to body');
  if (customizeState.dragHandles === 0) finding('Customize mode active but no .widget-drag-handle elements found');
  await page.screenshot({ path: path.join(outDir, '06-customize-mode.png') });
  await page.evaluate(() => { if (typeof toggleCustomizeMode === 'function') toggleCustomizeMode(); });
  await new Promise(r => setTimeout(r, 400));

  // 7. Extension drawer
  mark('7-ext-drawer');
  const extTrigger = await page.$('#ext-drawer-trigger');
  if (extTrigger) {
    await extTrigger.click();
    await new Promise(r => setTimeout(r, 600));
    const drawerState = await page.evaluate(() => {
      const drawer = document.getElementById('ext-drawer');
      const tiles = document.querySelectorAll('#ext-drawer-body .ext-tile, #ext-drawer-body [class*="ext-tile"]');
      return {
        open: drawer.classList.contains('open'),
        tileCount: tiles.length,
        tileTexts: Array.from(tiles).map(t => t.textContent.trim().slice(0, 40)),
      };
    });
    log('ext-drawer', JSON.stringify(drawerState));
    if (!drawerState.open) finding('Extension drawer (#ext-drawer) did not open after clicking trigger');
    if (drawerState.tileCount < 3) finding(`Extension drawer expected >=3 tiles (Nouveau Graphique / Bloc-notes / Flux RSS Finance), found ${drawerState.tileCount}: ${JSON.stringify(drawerState.tileTexts)}`);
    await page.screenshot({ path: path.join(outDir, '07-ext-drawer-open.png') });
    await page.evaluate(() => { if (typeof closeExtDrawer === 'function') closeExtDrawer(); });
    await new Promise(r => setTimeout(r, 400));
  } else {
    finding('Extension drawer trigger (#ext-drawer-trigger) not found in DOM');
  }

  // 8. Conscience Seba aura notifications
  // NB (audit 1.1, 2026-07-07) : triggerAuraDemo() n'est plus auto-déclenché au
  // chargement (c'était un scénario de test "client X" affiché à tout utilisateur
  // réel à chaque F5) — on le force nous-mêmes ici pour tester le mécanisme, et on
  // attend au moins le délai du 1er scénario (2500ms) avant de vérifier.
  mark('8-aura-notifications');
  await page.evaluate(() => { if (typeof triggerAuraDemo === 'function') triggerAuraDemo(); });
  await new Promise(r => setTimeout(r, 3000));
  let auraCard = await page.$('#aura-stack .aura-card');
  if (auraCard) {
    await page.screenshot({ path: path.join(outDir, '08-aura-visible.png') });
    const ignoreBtn = await page.$('#aura-stack .aura-btn.ignore');
    if (ignoreBtn) {
      await ignoreBtn.click();
      await new Promise(r => setTimeout(r, 700));
      const stillThere = await page.$('#aura-stack .aura-card');
      log('aura', `after ignore click, card present: ${!!stillThere}`);
      await page.screenshot({ path: path.join(outDir, '08b-aura-after-ignore.png') });
    } else {
      finding('Aura card visible but no .aura-btn.ignore button found');
    }
    // trigger again for validate test
    await page.evaluate(() => { if (typeof triggerAuraDemo === 'function') triggerAuraDemo(); });
    await new Promise(r => setTimeout(r, 3000));
    const validateBtn = await page.$('#aura-stack .aura-btn.validate');
    if (validateBtn) {
      await validateBtn.click();
      await new Promise(r => setTimeout(r, 700));
      log('aura', 'validate button clicked ok');
    } else {
      log('aura', 'no validate button found on second trigger (may have been one-shot)');
    }
  } else {
    finding('Conscience Seba aura notification (#aura-stack .aura-card) never appeared, even after triggerAuraDemo()');
  }

  // 9. Focus mode
  mark('9-focus-mode');
  await page.keyboard.press('f');
  await new Promise(r => setTimeout(r, 600));
  const focusState = await page.evaluate(() => {
    const overlay = document.getElementById('focus-overlay');
    const canvas = document.getElementById('focus-serenity-canvas');
    const actionLine = document.getElementById('focus-action-line');
    return {
      overlayExists: !!overlay,
      overlayOpen: overlay ? overlay.classList.contains('open') : false,
      bodyHasFocusClass: document.body.classList.contains('focus-active'),
      canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
      actionText: actionLine ? actionLine.textContent.trim() : null,
    };
  });
  log('focus-mode', JSON.stringify(focusState));
  if (!focusState.overlayOpen) finding('Pressing "F" did not open Focus Mode overlay (#focus-overlay missing "open" class)');
  if (focusState.canvasSize && (focusState.canvasSize.w === 0 || focusState.canvasSize.h === 0)) finding('Focus Mode Serenity canvas has zero size');
  await page.screenshot({ path: path.join(outDir, '09-focus-mode-on.png') });
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 600));
  const afterEsc = await page.evaluate(() => ({
    overlayOpen: document.getElementById('focus-overlay')?.classList.contains('open'),
    bodyHasFocusClass: document.body.classList.contains('focus-active'),
  }));
  log('focus-mode', 'after escape: ' + JSON.stringify(afterEsc));
  if (afterEsc.overlayOpen) finding('Escape key did not close Focus Mode overlay');
  await page.screenshot({ path: path.join(outDir, '09b-focus-mode-off.png') });

  // 10. Theme toggle
  mark('10-theme-toggle');
  await page.evaluate(() => { if (window.sebaTheme) sebaTheme.toggle(); });
  await new Promise(r => setTimeout(r, 700));
  const themeState = await page.evaluate(() => ({
    htmlTheme: document.documentElement.getAttribute('data-theme') || document.documentElement.className,
    bgColor: getComputedStyle(document.body).backgroundColor,
  }));
  log('theme', JSON.stringify(themeState));
  await page.screenshot({ path: path.join(outDir, '10-theme-toggled.png') });
  // toggle back
  await page.evaluate(() => { if (window.sebaTheme) sebaTheme.toggle(); });
  await new Promise(r => setTimeout(r, 500));

  // 12. Rapid interaction stress test
  mark('12-stress-test');
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => {
      if (typeof toggleCustomizeMode === 'function' && i % 2 === 0) toggleCustomizeMode();
      if (typeof toggleFocusMode === 'function' && i % 3 === 0) toggleFocusMode();
      if (window.sebaTheme && i % 2 === 1) sebaTheme.toggle();
    }, i);
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 500));
  const stressState = await page.evaluate(() => ({
    bodyClasses: document.body.className,
    widgetGridVisible: !!document.querySelector('.widget-grid'),
  }));
  log('stress', JSON.stringify(stressState));
  await page.screenshot({ path: path.join(outDir, '12-after-stress-test.png') });

} catch (e) {
  finding(`SCRIPT EXCEPTION during phase "${phase}": ${e.message}`);
  try { await page.screenshot({ path: path.join(outDir, 'ERROR-state.png') }); } catch {}
}

console.log('\n=== CONSOLE/PAGE ERRORS CAPTURED ===');
console.log(JSON.stringify(taggedErrs, null, 2));
console.log('\n=== FINDINGS ===');
console.log(JSON.stringify(results.findings, null, 2));

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...results, errors: taggedErrs }, null, 2));

await browser.close();
