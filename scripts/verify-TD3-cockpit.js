import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('401')) errs.push('CONSOLE: ' + msg.text()); });

await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('seba_calibration_seen', '1');
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€', paysCode: 'FR' }));
});
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));

const telemetryCheck = await page.evaluate(() => {
  const container = document.getElementById('cockpit-telemetry');
  const ids = Array.from(container.querySelectorAll('.widget-shell')).map((s) => s.dataset.widgetId);
  const grid = document.getElementById('widget-grid');
  const gridIds = Array.from(grid.querySelectorAll('.widget-shell')).map((s) => s.dataset.widgetId);
  const caEl = container.querySelector('[data-widget-id="metric-0"] .metric-value');
  return {
    telemetryOrder: ids,
    gridStillHasPinned: gridIds.some((id) => ids.includes(id)),
    gridWidgetCount: gridIds.length,
    caFontSize: caEl ? getComputedStyle(caEl).fontSize : null,
    caFontFamily: caEl ? getComputedStyle(caEl).fontFamily : null,
  };
});
console.log('Telemetrie:', JSON.stringify(telemetryCheck, null, 2));

const auraPos = await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('aura-stack'));
  return { left: cs.left, right: cs.right };
});
console.log('aura-stack position (desktop, doit etre right):', JSON.stringify(auraPos));

// Confirm drag-and-drop still works on the remaining grid (customize mode)
const dragStillWorks = await page.evaluate(() => {
  window.toggleCustomizeMode();
  const grid = document.getElementById('widget-grid');
  const hasHandles = grid.querySelectorAll('.widget-drag-handle').length > 0;
  window.toggleCustomizeMode();
  return hasHandles;
});
console.log('Grille restante toujours en drag-and-drop (poignees presentes):', dragStillWorks);

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
