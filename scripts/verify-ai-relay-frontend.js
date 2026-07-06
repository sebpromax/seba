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

await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// askAI should gracefully fall back to local analyst (no session, no groqKey configured in config.public.js)
const askResult = await page.evaluate(async () => {
  try {
    const answer = await window.askAI('Quel est mon chiffre d\'affaires ?');
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
console.log('askAI() sans session ->', JSON.stringify(askResult).slice(0, 300));

const status = await page.evaluate(() => window.sebaAIStatus());
console.log('sebaAIStatus():', status);

// callSebaAI should return null gracefully (no bearer)
const sebaAIResult = await page.evaluate(async () => {
  if (typeof callSebaAI !== 'function') return 'callSebaAI not in global scope (expected, function-scoped) - skipped';
  return await callSebaAI({ test: true });
});
console.log('callSebaAI() sans session:', JSON.stringify(sebaAIResult));

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
