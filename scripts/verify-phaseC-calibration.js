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

await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.removeItem('seba_calibration_seen');
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€', paysCode: 'CA' }));
});
console.log('--- Premiere visite (calibration attendue) ---');
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });

// Check overlay appears within ~2.5s
await new Promise((r) => setTimeout(r, 2200));
const midState = await page.evaluate(() => {
  const overlay = document.getElementById('calib-overlay');
  return { open: overlay.classList.contains('open'), visible: overlay.classList.contains('visible'), caption: document.getElementById('calib-caption').textContent };
});
console.log('Etat a 2.2s (globe en rotation attendu):', JSON.stringify(midState));

// Wait for lock + caption change (zoom ~980ms starts at 1800ms, completes ~2780ms)
await new Promise((r) => setTimeout(r, 1400));
const lockedState = await page.evaluate(() => ({
  caption: document.getElementById('calib-caption').textContent,
  locked: document.getElementById('calib-caption').classList.contains('locked'),
  flashed: document.getElementById('calib-flash').classList.contains('fire'),
}));
console.log('Etat apres verrouillage (~3.6s):', JSON.stringify(lockedState));

// Wait for fade-out to complete (1300ms hold + 650ms fade after lock)
await new Promise((r) => setTimeout(r, 2200));
const finalState = await page.evaluate(() => {
  const overlay = document.getElementById('calib-overlay');
  return { open: overlay.classList.contains('open'), seenFlag: localStorage.getItem('seba_calibration_seen') };
});
console.log('Etat final (overlay ferme, flag pose):', JSON.stringify(finalState));

console.log('--- Deuxieme visite (calibration ne doit PAS reapparaitre) ---');
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
const secondVisit = await page.evaluate(() => document.getElementById('calib-overlay').classList.contains('open'));
console.log('Overlay ouvert a la 2e visite (doit etre false):', secondVisit);

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
