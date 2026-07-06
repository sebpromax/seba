import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function check(url) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
  page.on('dialog', async (d) => { await d.dismiss(); });
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_NAME_NOT_RESOLVED')) errs.push('CONSOLE: ' + msg.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));
  console.log(url.replace('http://localhost:8791/', ''), '-> errors:', errs.length ? JSON.stringify(errs) : '(none)');
  await page.close();
}

const pages = [
  'dashboard.html?demo', 'onboarding.html', 'connexion.html', 'clients.html?demo',
  'devis.html?demo', 'factures.html?demo', 'planning.html?demo', 'index.html',
];
for (const p of pages) {
  try { await check('http://localhost:8791/' + p); }
  catch (e) { console.log(p, '-> FAILED TO LOAD:', e.message); }
}

await browser.close();
