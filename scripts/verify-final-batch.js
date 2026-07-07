import puppeteer from 'puppeteer-core';
import path from 'path';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function freshPage() {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_NAME_NOT_RESOLVED')) errs.push('CONSOLE: ' + msg.text()); });
  return { page, errs };
}

// 1) onboarding preview-panel custom name persistence across steps
{
  const { page, errs } = await freshPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('file://' + path.resolve('docs', 'onboarding.html'), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  const result = await page.evaluate(() => {
    S.secteur = 'menage';
    S.nom = 'Nettoyage Étoile';
    S.publicName = 'Nettoyage Étoile';
    goStep(4);
    updatePreview();
    const afterStep4 = document.getElementById('pv-title').textContent;
    goStep(5);
    const afterStep5 = document.getElementById('pv-title').textContent;
    goStep(6);
    const afterStep6 = document.getElementById('pv-title').textContent;
    return { afterStep4, afterStep5, afterStep6 };
  });
  console.log('preview-panel persistence:', JSON.stringify(result));
  console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
  await page.close();
}

// 2) dashboard.html: ext-drawer-trigger vs greeting, aura-stack vs sidebar
{
  const { page, errs } = await freshPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('file://' + path.resolve('docs', 'dashboard.html') + '?demo', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€' }));
  });
  await page.goto('file://' + path.resolve('docs', 'dashboard.html') + '?demo', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
  const overlapCheck = await page.evaluate(() => {
    function intersects(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }
    const trigger = document.getElementById('ext-drawer-trigger')?.getBoundingClientRect();
    const greeting = document.getElementById('greeting')?.getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    window.showAuraNotification && window.showAuraNotification('Test overlap check', 70);
    return { triggerVsGreeting: trigger && greeting ? intersects(trigger, greeting) : null, sidebarRight: sidebar ? sidebar.right : null };
  });
  await new Promise(r => setTimeout(r, 300));
  const auraCheck = await page.evaluate(() => {
    function intersects(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }
    const aura = document.querySelector('.aura-stack')?.getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    return { auraVsSidebar: aura && sidebar ? intersects(aura, sidebar) : null };
  });
  console.log('dashboard overlap check:', JSON.stringify({ ...overlapCheck, ...auraCheck }));
  console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
  await page.close();
}

// 3) three.js fix on solution/confiance/probleme
for (const f of ['solution.html', 'confiance.html', 'probleme.html']) {
  const { page, errs } = await freshPage();
  await page.goto('file://' + path.resolve('docs', f), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  const rev = await page.evaluate(() => (typeof THREE !== 'undefined' ? THREE.REVISION : null));
  console.log(f, 'THREE.REVISION=', rev, 'errors:', errs.length ? JSON.stringify(errs) : '(none)');
  await page.close();
}

await browser.close();
