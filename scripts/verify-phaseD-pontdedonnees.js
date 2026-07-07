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
page.on('dialog', async (d) => { console.log('DIALOG:', d.type(), '|', d.message().slice(0, 80)); await d.accept(); });

await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('seba_calibration_seen', '1'); // deja vu, evite l'interference avec ce test
  localStorage.removeItem('seba_donnees_reelles');
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€', paysCode: 'FR' }));
});
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const beforeClientCount = await page.evaluate(() => (window.SebaDB ? SebaDB.list('clients').length : -1));
console.log('Clients avant activation (demo attendu > 0):', beforeClientCount);

await page.evaluate(() => window.activerDonneesReelles());
// Wait for the staggered scan + reset (metrics count varies, be generous)
await new Promise((r) => setTimeout(r, 2500));

const afterState = await page.evaluate(() => ({
  clientCount: window.SebaDB ? SebaDB.list('clients').length : -1,
  flag: localStorage.getItem('seba_donnees_reelles'),
}));
console.log('Etat apres activation:', JSON.stringify(afterState));

// Calling again should just alert (already activated), not re-reset
await page.evaluate(() => window.activerDonneesReelles());
await new Promise((r) => setTimeout(r, 300));

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
