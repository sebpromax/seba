// SEBA — Non-régression QA_PORTAILS_CLIENT_SALARIE_POST_PR136.md, P1-1.
//
// envoyerMessagePrestataire() (docs/client-espace.html) créait un doublon
// lorsqu'elle était appelée deux fois rapidement (double-clic/double
// Entrée) avant que le premier appel n'ait fini d'écrire -- aucune garde
// "déjà en cours d'envoi", contrairement à envoyerMessagePatron() dans
// espace-terrain.html qui avait déjà le bon garde-fou. Corrigé en ajoutant
// `if (inp.disabled) return;` en tête de fonction.
//
// Ce test appelle la fonction réelle deux fois quasi simultanément (comme
// un utilisateur qui double-clique) et vérifie qu'un seul message existe
// côté serveur après coup.
//
// Usage : node scripts/qa-client-message-no-duplicate.js
// Prérequis : Supabase local démarré (scripts/local-db/rebuild.sh).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const REPO_ROOT = 'C:\\Users\\sebas\\Downloads\\Seba\\Seba\\seba';
const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8831;
const PASSWORD = 'Test-Synthetic-2026!';

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (/config(\.public)?\.js$/.test(urlPath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(`window.SEBA_CONFIG_PUBLIC = { supabaseUrl: '${API_URL}', supabaseAnonKey: '${ANON_KEY}', accountId: 'demo', onesignalAppId:'', sentryDsn:'', umamiWebsiteId:'', umamiScriptUrl:'' };`);
        return;
      }
      const filePath = path.join(REPO_ROOT, 'docs', urlPath === '/' ? 'index.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('nf: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function createOrGetUser(email) {
  const resp = await fetch(API_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json && json.id) return json.id;
  const out = execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '${email}' limit 1;"`, { encoding: 'utf8' });
  return out.trim();
}

function psql(sql) {
  return execSync('docker exec -i supabase_db_seba psql -U postgres -t -A -v ON_ERROR_STOP=1', { input: sql, encoding: 'utf8' });
}

async function main() {
  const patronId = await createOrGetUser('qa-nodup-patron@test.seba.invalid');
  const clientId = await createOrGetUser('qa-nodup-client@test.seba.invalid');

  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronId}', '${patronId}',
      '{"v":1,"clients":[{"id":"cli_nodup","nom":"NoDup","prenom":"QA","email":"qa-nodup-client@test.seba.invalid","adresse":"1 rue Test"}],"devis":[],"factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    delete from client_accounts where client_user_id = '${clientId}';
    insert into client_accounts (client_user_id, account, client_id, email) values ('${clientId}', '${patronId}', 'cli_nodup', 'qa-nodup-client@test.seba.invalid');
  `);

  const marker = 'QA-NODUP-' + Date.now();
  const server = await startStaticServer();
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new' });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => req.continue());

  await page.goto(`http://127.0.0.1:${PORT}/client-connexion.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((email, pw) => window.sebaAuth.signIn(email, pw), 'qa-nodup-client@test.seba.invalid', PASSWORD);
  await new Promise((r) => setTimeout(r, 400));
  await page.goto(`http://127.0.0.1:${PORT}/client-espace.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 800));

  console.log('== Double appel rapide de envoyerMessagePrestataire() (simule un double-clic) ==');
  await page.evaluate((marker) => {
    document.getElementById('ce-msg-input').value = marker;
    envoyerMessagePrestataire();
    envoyerMessagePrestataire();
  }, marker);
  await new Promise((r) => setTimeout(r, 1200));

  const count = psql(`select count(*) from seba_messages where account = '${patronId}' and texte = '${marker}';`).trim();
  assert(count === '1', 'un seul message créé après double appel rapide (observé ' + count + ')');

  await browser.close();
  server.close();
  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
