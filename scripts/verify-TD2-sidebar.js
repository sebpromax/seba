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
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED') && !msg.text().includes('401')) errs.push('CONSOLE: ' + msg.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));

  const activeCheck = await page.evaluate(() => {
    const active = document.querySelector('.nav-item.active');
    if (!active) return null;
    const cs = getComputedStyle(active);
    const before = getComputedStyle(active, '::before');
    return { bg: cs.backgroundColor, color: cs.color, beforeBg: before.backgroundColor, beforeWidth: before.width };
  });
  const shortcutCheck = await page.evaluate(() => {
    const item = document.querySelector('.nav-item .nav-shortcut');
    return item ? { text: item.textContent, opacityBefore: getComputedStyle(item).opacity } : null;
  });
  const gapCheck = await page.evaluate(() => !!document.querySelector('.nav-group-gap'));

  console.log(label, '-> active state:', JSON.stringify(activeCheck));
  console.log(label, '-> shortcut hint:', JSON.stringify(shortcutCheck));
  console.log(label, '-> group gap present:', gapCheck);
  console.log(label, '-> errors:', errs.length ? JSON.stringify(errs) : '(none)');
  await page.close();
}

await check('http://localhost:8791/dashboard.html?demo', 'dashboard.html');
await check('http://localhost:8791/clients.html?demo', 'clients.html (autre page connectee)');

await browser.close();
