import puppeteer from 'puppeteer-core';
import path from 'path';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_NAME_NOT_RESOLVED')) errs.push('CONSOLE: ' + msg.text()); });

const url = 'file://' + path.resolve('docs', 'dashboard.html') + '?demo';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
});
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

console.log('--- Rapid context-switch stress test ---');

// 1. Rapid theme toggling (5x) while other animations (Serenity/Horizon/Timeline) are running
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => sebaTheme.toggle());
  await new Promise((r) => setTimeout(r, 60));
}
console.log('1) rapid theme toggle x5 — ok');

// 2. Rapid customize mode on/off (5x) — mounts/unmounts SortableJS, widget-shells
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => toggleCustomizeMode());
  await new Promise((r) => setTimeout(r, 50));
}
console.log('2) rapid customize mode toggle x5 — ok');

// 3. Rapidly open/close the Extensions drawer and the Personnaliser panel interleaved
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => openExtDrawer());
  await new Promise((r) => setTimeout(r, 40));
  await page.evaluate(() => closeExtDrawer());
  await page.evaluate(() => openCustomizePanel());
  await new Promise((r) => setTimeout(r, 40));
  await page.evaluate(() => closeCustomizePanel());
}
console.log('3) rapid drawer/panel open-close interleaved x4 — ok');

// 4. Rapid hover across Serenity Score, Horizon Lines, Timeline de Vie rail — simulates
//    fast context switching between the three canvas-driven widgets
for (let i = 0; i < 8; i++) {
  await page.evaluate((iter) => {
    const wrap = document.querySelector('.serenity-wrap');
    if (wrap) wrap.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 }));
    const horizon = document.getElementById('horizon-line');
    if (horizon) {
      const r = horizon.getBoundingClientRect();
      horizon.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * (iter % 2), clientY: r.top + r.height / 2 }));
    }
    const tl = document.getElementById('timeline-life');
    if (tl) {
      const r2 = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r2.left + r2.width / 2, clientY: r2.top + r2.height * (iter % 2) }));
    }
  }, i);
  await new Promise((r) => setTimeout(r, 30));
}
console.log('4) rapid cross-widget hover (Serenity/Horizon/Timeline) x8 — ok');

// 5. Trigger + immediately dismiss several aura notifications back to back
await page.evaluate(() => {
  showAuraNotification('Test charge A', 70);
  showAuraNotification('Test charge B', 40);
  showAuraNotification('Test charge C', 90);
});
await new Promise((r) => setTimeout(r, 100));
await page.evaluate(() => {
  document.querySelectorAll('.aura-card .validate, .aura-card .ignore').forEach((btn) => btn.click());
});
await new Promise((r) => setTimeout(r, 500));
console.log('5) triple aura spawn + rapid dismiss-all — ok');

// 6. Force a full dashboard re-render burst (simulates rapid data updates)
await page.evaluate(() => {
  const biz = JSON.parse(localStorage.getItem('sebaEntreprise'));
  for (let i = 0; i < 6; i++) renderDashboard(biz);
});
await new Promise((r) => setTimeout(r, 600));
console.log('6) burst of 6 consecutive renderDashboard() calls — ok');

// 7. Final sanity: confirm core widgets are still present and canvases have valid size after the storm
const finalState = await page.evaluate(() => {
  const serenity = document.querySelector('.serenity-canvas');
  const horizon = document.getElementById('horizon-line');
  const timeline = document.getElementById('timeline-life');
  return {
    serenityOk: !!serenity && serenity.width > 0,
    horizonOk: !!horizon && horizon.width > 0,
    timelineOk: !!timeline && timeline.width > 0,
    widgetCount: document.querySelectorAll('.widget-shell').length,
    scoreText: document.querySelector('.serenity-score-num')?.textContent,
  };
});
console.log('7) final state after storm:', JSON.stringify(finalState));

console.log('--- console/page errors captured during the whole test ---');
console.log(errs.length ? JSON.stringify(errs, null, 2) : '(none)');

await browser.close();
