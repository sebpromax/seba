import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED')) errs.push('CONSOLE: ' + msg.text()); });

await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test SARL', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test-sarl', deviseSymbole: '€' }));
});
await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const checks = await page.evaluate(async () => {
  const out = {};
  out.audioUIExists = typeof window.AudioUI === 'object';
  out.hasPlayClick = typeof window.AudioUI?.playClick === 'function';
  out.hasPlaySuccess = typeof window.AudioUI?.playSuccess === 'function';
  out.hasPlayComplete = typeof window.AudioUI?.playComplete === 'function';
  try { window.AudioUI.playClick(); out.playClickNoThrow = true; } catch (e) { out.playClickNoThrow = 'ERROR: ' + e.message; }
  try { window.AudioUI.playSuccess(); out.playSuccessNoThrow = true; } catch (e) { out.playSuccessNoThrow = 'ERROR: ' + e.message; }
  try { window.AudioUI.playComplete(); out.playCompleteNoThrow = true; } catch (e) { out.playCompleteNoThrow = 'ERROR: ' + e.message; }
  // Trigger toggleFocusMode and openAiBar (should call AudioUI internally, no throw)
  try { window.toggleFocusMode(); window.toggleFocusMode(); out.focusToggleNoThrow = true; } catch (e) { out.focusToggleNoThrow = 'ERROR: ' + e.message; }
  try { window.openAiBar(); out.aiBarOpenNoThrow = true; } catch (e) { out.aiBarOpenNoThrow = 'ERROR: ' + e.message; }
  return out;
});
console.log('Phase A checks:', JSON.stringify(checks, null, 2));
console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
