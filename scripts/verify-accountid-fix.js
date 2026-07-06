import puppeteer from 'puppeteer-core';
import path from 'path';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fakeJwt(sub) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ sub, aud: 'authenticated', exp: 9999999999 });
  return header + '.' + payload + '.fakesignature';
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function testUser(sub) {
  const page = await browser.newPage();
  const seenAccounts = new Set();
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/rest/v1/seba_state')) {
      const m = url.match(/account=eq\.([^&]+)/);
      if (m) seenAccounts.add(decodeURIComponent(m[1]));
    }
  });
  await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'domcontentloaded' });
  await page.evaluate((jwt) => {
    // Simule une session Supabase déjà persistée par supabase-js
    localStorage.setItem('sb-ptmudezhxnhhyctowlqp-auth-token', JSON.stringify({ access_token: jwt }));
    localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'Test', secteur: 'menage' }));
  }, fakeJwt(sub));
  // Recharge pour que seba-data.js reparte de zéro avec le faux token en place
  await page.goto('http://localhost:8791/dashboard.html?demo', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200)); // laisse le debounce _push (800ms) se déclencher
  await page.close();
  return [...seenAccounts];
}

const accountsA = await testUser('11111111-aaaa-1111-aaaa-111111111111');
const accountsB = await testUser('22222222-bbbb-2222-bbbb-222222222222');

console.log('Utilisateur A -> account(s) utilisé(s):', JSON.stringify(accountsA));
console.log('Utilisateur B -> account(s) utilisé(s):', JSON.stringify(accountsB));
console.log('Résultat: comptes distincts ?', accountsA.length && accountsB.length && accountsA[0] !== accountsB[0] ? 'OUI - CORRIGE' : 'NON - encore un souci');

await browser.close();
