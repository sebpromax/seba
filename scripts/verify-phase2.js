import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function check(url, label) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_NAME_NOT_RESOLVED')) errs.push('CONSOLE: ' + msg.text()); });
  page.on('dialog', async (d) => { await d.dismiss(); }); // auto-dismiss alert() from enablePushNotifications
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  console.log(label, '-> errors:', errs.length ? JSON.stringify(errs) : '(none)');
  return page;
}

const factures = await check('http://localhost:8791/factures.html', 'factures.html');
const emailBtnPresent = await factures.evaluate(() => document.body.innerHTML.includes('sendFactureEmail'));
console.log('factures.html has sendFactureEmail wiring:', emailBtnPresent);
await factures.close();

const devis = await check('http://localhost:8791/devis.html', 'devis.html');
const devisEmailFnExists = await devis.evaluate(() => typeof window.sendDevisEmail === 'function' || document.body.innerHTML.includes('sendDevisEmail'));
console.log('devis.html has sendDevisEmail wiring:', devisEmailFnExists);
await devis.close();

const dash = await check('http://localhost:8791/dashboard.html?demo', 'dashboard.html');
const pushCheck = await dash.evaluate(async () => {
  const hasFn = typeof window.enablePushNotifications === 'function';
  const sebaPushConfigured = window.sebaPush ? sebaPush.isConfigured : null;
  await window.enablePushNotifications(); // should alert() gracefully since onesignalAppId is empty
  return { hasFn, sebaPushConfigured };
});
console.log('dashboard.html push button wiring:', JSON.stringify(pushCheck));
await dash.close();

await browser.close();
