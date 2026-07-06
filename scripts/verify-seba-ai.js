import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'seba-ai');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED')) errs.push('CONSOLE: ' + msg.text()); });

// Intercept the relay call so we don't need a real deployed function to test the wiring
await page.setRequestInterception(true);
let relayCallCount = 0;
let lastRelayBody = null;
page.on('request', (req) => {
  if (req.url().includes('/functions/v1/seba-ai-mistral')) {
    relayCallCount++;
    lastRelayBody = req.postData();
    req.respond({
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      contentType: 'application/json',
      body: JSON.stringify({ action: 'Relancer le paiement en retard', priority: 'high', reasoning: 'Un montant important a été détecté sans encaissement confirmé.' }),
    });
  } else {
    req.continue();
  }
});

// auth.js deliberately skips config loading under file:// (no sync-XHR to local files) —
// inject SEBA_CONFIG directly, before any page script runs, to simulate a configured relay.
await page.evaluateOnNewDocument(() => {
  window.SEBA_CONFIG = { supabaseUrl: 'https://fake-project.supabase.co', supabaseAnonKey: 'fake-anon-key' };
});

const url = 'file://' + path.resolve('docs', 'dashboard.html') + '?demo';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
  // Seed 3 late invoices to push the Serenity Score into "alerte" (<40)
  localStorage.setItem('seba_creances_imp', JSON.stringify([
    { client: 'A', montant: 300, relanceStep: 2 },
    { client: 'B', montant: 300, relanceStep: 3 },
    { client: 'C', montant: 300, relanceStep: 2 },
  ]));
});
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

const scoreInfo = await page.evaluate(() => {
  const el = document.querySelector('.serenity-score-num');
  const lbl = document.querySelector('.serenity-score-lbl');
  return { score: el ? el.textContent : null, label: lbl ? lbl.textContent : null };
});
console.log('serenity score (should be low/ALERTE):', JSON.stringify(scoreInfo));

// Wait for the async callSebaAI().then(presentSebaAIRecommendation) chain to resolve and the aura to render
await new Promise((r) => setTimeout(r, 700));

console.log('relay call count after first render:', relayCallCount);
console.log('relay call body:', lastRelayBody);

const auraInfo = await page.evaluate(() => {
  return [...document.querySelectorAll('.aura-card')].map(card => ({
    badge: card.querySelector('.aura-badge').textContent, msg: card.querySelector('.aura-msg').textContent,
  }));
});
console.log('all aura cards present:', JSON.stringify(auraInfo));
await page.screenshot({ path: path.join(outDir, 'ai-aura.png') });

// Force a second render (simulate a data change re-render) and confirm the AI is NOT re-triggered
// (still in 'alerte', not a new transition — should stay at relayCallCount 1)
await page.evaluate(() => {
  const biz = JSON.parse(localStorage.getItem('sebaEntreprise'));
  renderDashboard(biz);
});
await new Promise((r) => setTimeout(r, 600));
console.log('relay call count after a SECOND render while still in alerte (should stay 1):', relayCallCount);

console.log('errors:', errs);
await browser.close();
