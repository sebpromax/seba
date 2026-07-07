import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
let dialogFired = false;
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('401')) errs.push('CONSOLE: ' + msg.text()); });
page.on('dialog', async (d) => { dialogFired = true; console.log('DIALOG (should only fire for the destructive confirm):', d.type(), d.message().slice(0, 60)); await d.accept(); });

await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('seba_calibration_seen', '1');
  localStorage.removeItem('seba_donnees_reelles');
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€', paysCode: 'FR' }));
});
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));

// Test 1: push notification (should show a toast, NOT a native dialog)
const pushToast = await page.evaluate(async () => {
  await window.enablePushNotifications();
  await new Promise((r) => setTimeout(r, 200));
  const t = document.querySelector('.dash-toast');
  return t ? { text: t.textContent, visible: t.classList.contains('visible') } : null;
});
console.log('Toast apres enablePushNotifications:', JSON.stringify(pushToast));

// Test 2: activerDonneesReelles second-call path (already activated -> toast, not alert)
await page.evaluate(() => { localStorage.setItem('seba_donnees_reelles', '1'); });
const secondCallToast = await page.evaluate(async () => {
  window.activerDonneesReelles();
  await new Promise((r) => setTimeout(r, 200));
  const t = document.querySelector('.dash-toast');
  return t ? t.textContent : null;
});
console.log('Toast apres 2e appel activerDonneesReelles (deja actif):', JSON.stringify(secondCallToast));

console.log('Un dialog natif a-t-il ete declenche (doit rester false ici):', dialogFired);
console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
