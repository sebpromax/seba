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
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€' }));
});
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// Check glass styling applied
const glassCheck = await page.evaluate(() => {
  const box = document.querySelector('.ai-bar-box');
  const cs = getComputedStyle(box);
  return { backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter, background: cs.backgroundColor };
});
console.log('ai-bar-box glass styling:', JSON.stringify(glassCheck));

// Trigger a search that should match a widget (try a known keyword, e.g. "chiffre" or "planning")
const result = await page.evaluate(async () => {
  window.openAiBar();
  const inp = document.getElementById('ai-bar-inp');
  inp.value = 'planning';
  window.submitAiBar();
  await new Promise((r) => setTimeout(r, 300));
  const canvas = document.getElementById('ai-bar-burst-canvas');
  return {
    resultsHtml: document.getElementById('ai-bar-results').innerHTML.slice(0, 200),
    canvasHasSize: canvas.width > 0 && canvas.height > 0,
  };
});
console.log('submitAiBar result:', JSON.stringify(result));
console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
