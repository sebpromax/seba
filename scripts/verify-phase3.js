import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function checkNoErrors(url, label) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_NAME_NOT_RESOLVED')) errs.push('CONSOLE: ' + msg.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  console.log(label, '-> errors:', errs.length ? JSON.stringify(errs) : '(none)');
  return page;
}

// Sentry/Umami no-op check (empty config -> zero errors, zero extra network)
for (const [url, label] of [
  ['http://localhost:8791/dashboard.html?demo', 'dashboard.html (sentry/analytics no-op)'],
  ['http://localhost:8791/connexion.html', 'connexion.html (sentry/analytics no-op)'],
  ['http://localhost:8791/onboarding.html', 'onboarding.html (sentry/analytics no-op)'],
]) {
  const page = await checkNoErrors(url, label);
  await page.close();
}

// Address autocomplete on clients.html
const page = await checkNoErrors('http://localhost:8791/clients.html?demo', 'clients.html');
const opened = await page.evaluate(() => {
  if (typeof window.openClientSheet === 'function') { window.openClientSheet(); return true; }
  const btn = document.querySelector('[onclick*="Sheet"], .btn-new-client, [data-open-sheet]');
  if (btn) { btn.click(); return true; }
  return false;
});
console.log('clients.html sheet opened via helper:', opened);
await page.evaluate(() => {
  const el = document.getElementById('ss-adresse');
  if (el) { el.style.display = ''; el.closest('[style*="display: none"]') && (el.closest('[style*="display: none"]').style.display = 'block'); }
});
const typed = await page.evaluate(async () => {
  const el = document.getElementById('ss-adresse');
  if (!el) return 'no #ss-adresse found';
  el.value = '10 rue de la paix paris';
  el.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 900));
  const box = document.querySelector('.addr-suggest-box');
  return box ? ('suggestions shown: ' + box.children.length) : 'no suggestion box appeared';
});
console.log('address-autocomplete result:', typed);
await page.close();

await browser.close();
