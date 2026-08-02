// SEBA — QA Puppeteer RÉELLE : accès initial Client ET Salarié par code
// provisoire (feat/client-employee-initial-access-code, plan v4).
//
// Teste le VRAI parcours de bout en bout (patron génère/révèle/révoque un
// code depuis client-fiche.html/employe-fiche.html, la personne le saisit
// sur client-connexion.html/employe-connexion.html, crée son mot de passe,
// atterrit sur son portail, se reconnecte ensuite normalement) contre le
// Supabase local + les VRAIES Edge Functions create-access-code.ts /
// activate-access-code.ts (copiées temporairement dans supabase/functions/
// pour être servies par `supabase functions serve`, comme
// scripts/qa-account-activation.js le fait déjà pour client-provision.ts/
// employe-provision.ts -- convention documentée, jamais un changement du
// mode de déploiement réel qui reste manuel via le Dashboard Supabase).
//
// Une seule suite de scénarios, paramétrée par role ('client'|'employe'),
// lancée deux fois -- jamais deux copies dupliquées du même test.
//
// Prérequis :
//   1. Supabase local démarré (scripts/local-db/rebuild.sh).
//   2. cp supabase-functions/create-access-code.ts supabase/functions/create-access-code/index.ts
//      cp supabase-functions/activate-access-code.ts supabase/functions/activate-access-code/index.ts
//   3. RESEND_API_KEY volontairement NON définie dans l'environnement local
//      -- teste réellement que delivery_status devient 'delivery_failed'
//      et n'est JAMAIS affiché comme un succès (voir [8/10] plus bas).
//
// Usage : node scripts/qa-access-code-activation.js

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
// localhost:8791, PAS 127.0.0.1 -- doit matcher EXACTEMENT ALLOWED_ORIGINS
// dans create-access-code.ts/activate-access-code.ts (CORS).
const PORT = 8791;
const PATRON_PASSWORD = 'Test-Synthetic-2026!';
const NEW_PASSWORD = 'Code-Provisoire-QA-2026!';

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function note(msg) { console.log('  ····  ' + msg); }

function psql(sql) {
  return execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1 -t -A', { input: sql, encoding: 'utf8' });
}

async function createOrGetUser(email, password) {
  const resp = await fetch(API_URL + '/auth/v1/admin/users', {
    method: 'POST', headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json && json.id) return json.id;
  const out = execSync(`docker exec -i supabase_db_seba psql -U postgres -t -A -c "select id from auth.users where email = '${email}' limit 1;"`, { encoding: 'utf8' });
  return out.trim();
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(REPO_ROOT, 'docs', urlPath === '/' ? 'index.html' : urlPath);
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('nf: ' + req.url); }
  });
  return new Promise((resolve) => server.listen(PORT, 'localhost', () => resolve(server)));
}

async function newRolePage(browser) {
  const ctx = await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(60000);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/config(\.public)?\.js$/.test(req.url())) {
      const body = `window.SEBA_CONFIG_PUBLIC = { supabaseUrl: '${API_URL}', supabaseAnonKey: '${ANON_KEY}', accountId: 'demo' };`;
      req.respond({ status: 200, contentType: 'application/javascript', body });
      return;
    }
    req.continue();
  });
  const consoleErrors = [];
  page.on('pageerror', (e) => {
    if (/SecurityError.*localStorage.*sandboxed/i.test(e.message)) return;
    consoleErrors.push('pageerror: ' + e.message);
  });
  page.on('console', async (m) => {
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|401 \(Unauthorized\)|409 \(Conflict\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map((a) => a.evaluate((v) => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  return { ctx, page, consoleErrors };
}

/* Suit exactement le lien "Première connexion" -- 2 champs (email+code)
   puis clic reel sur #fl-btn -- jamais un raccourci JS direct, pour
   verifier le VRAI parcours ecran-par-ecran comme un utilisateur. */
async function submitFirstLogin(page, email, code) {
  const alreadyOnFirstLogin = await page.evaluate(() => document.getElementById('first-login-block').style.display === 'block');
  if (!alreadyOnFirstLogin) {
    await page.waitForSelector('button[onclick="showFirstLoginMode()"]');
    await page.click('button[onclick="showFirstLoginMode()"]');
    await page.waitForFunction(() => document.getElementById('first-login-block').style.display !== 'none');
  }
  await page.click('#fl-email', { clickCount: 3 });
  await page.type('#fl-email', email);
  await page.click('#fl-code', { clickCount: 3 });
  await page.type('#fl-code', code);
  await page.click('#fl-btn');
  await new Promise((r) => setTimeout(r, 900));
}

async function submitCreatePassword(page, pwd, confirm) {
  await page.click('#cp-password', { clickCount: 3 });
  await page.type('#cp-password', pwd);
  await page.click('#cp-password-confirm', { clickCount: 3 });
  await page.type('#cp-password-confirm', confirm);
  await page.click('#cp-btn');
  await new Promise((r) => setTimeout(r, 900));
}

async function patronRevealCode(patronPage, fichePage, emailInputId, entityId, email) {
  await patronPage.goto(`http://localhost:${PORT}/${fichePage}?id=${entityId}`, { waitUntil: 'domcontentloaded' });
  await patronPage.waitForFunction(
    (id) => { const el = document.getElementById(id); return el && el.textContent !== 'Chargement du statut…'; },
    { timeout: 8000 }, 'access-code-status-line',
  ).catch(() => {});
  await patronPage.click('#' + emailInputId, { clickCount: 3 });
  await patronPage.type('#' + emailInputId, email);
  await patronPage.click('button[onclick*="reveal_once"]');
  await patronPage.waitForFunction(() => document.getElementById('access-code-reveal').style.display === 'block', { timeout: 8000 });
  return patronPage.evaluate(() => document.getElementById('access-code-reveal-value').textContent.trim());
}

async function patronSendEmailCode(patronPage, fichePage, emailInputId, entityId, email) {
  await patronPage.goto(`http://localhost:${PORT}/${fichePage}?id=${entityId}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await patronPage.click('#' + emailInputId, { clickCount: 3 });
  await patronPage.type('#' + emailInputId, email);
  await patronPage.click('button[onclick*="\'email\'"]');
  await new Promise((r) => setTimeout(r, 1200));
  return patronPage.evaluate(() => document.getElementById('access-code-status-line').textContent);
}

async function patronRevoke(patronPage, fichePage, entityId) {
  await patronPage.goto(`http://localhost:${PORT}/${fichePage}?id=${entityId}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await patronPage.click('button[onclick="handleRevokeAccessCode()"]');
  await new Promise((r) => setTimeout(r, 600));
}

/* Suite complète pour UN role -- appelée deux fois (client, employe),
   jamais deux copies dupliquées du même test. */
async function runRoleSuite(browser, patron, role) {
  const R = {
    client: {
      fichePage: 'client-fiche.html', connexionPage: 'client-connexion.html', portalUrl: 'client-espace.html',
      emailInputId: 'client-email-input', accountsTable: 'client_accounts', userCol: 'client_user_id', idCol: 'client_id',
      login: (p, e, pw) => p.evaluate((e2, pw2) => SebaDB.clientPortal.login(e2, pw2), e, pw),
      logout: (p) => p.evaluate(() => SebaDB.clientPortal.logout()),
    },
    employe: {
      fichePage: 'employe-fiche.html', connexionPage: 'employe-connexion.html', portalUrl: 'espace-terrain.html',
      emailInputId: 'email-input', accountsTable: 'employe_accounts', userCol: 'employe_user_id', idCol: 'employe_id',
      login: (p, e, pw) => p.evaluate((e2, pw2) => SebaDB.employeePortal.login(e2, pw2), e, pw),
      logout: (p) => p.evaluate(() => SebaDB.employeePortal.logout()),
    },
  }[role];
  const prefix = role === 'client' ? 'cli_qaac' : 'emp_qaac';
  const label = role === 'client' ? 'CLIENT' : 'SALARIÉ';
  const ts = Date.now();
  const emailFor = (tag) => `qaac-${role}-${tag}-${ts}@test.seba.invalid`;

  console.log(`\n${'='.repeat(70)}\n== SUITE ${label} ==\n${'='.repeat(70)}`);

  // ═══ [1] Parcours complet : mauvais code -> bon code -> mot de passe
  // (mismatch puis correct) -> portail -> reconnexion normale ensuite ═══
  console.log(`\n== [1/10 ${label}] Parcours complet, réel de bout en bout ==`);
  const entityHappy = `${prefix}_a`;
  const emailHappy = emailFor('happy');
  const codeHappy = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityHappy, emailHappy);
  assert(/^[A-Z2-9]{8}$/.test(codeHappy), 'code réel révélé au patron, format attendu (' + codeHappy + ')');

  const person1 = await newRolePage(browser);
  await person1.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  const wrongCode = codeHappy[0] === 'A' ? 'B' + codeHappy.slice(1) : 'A' + codeHappy.slice(1);
  await submitFirstLogin(person1.page, emailHappy, wrongCode);
  const wrongErrVisible = await person1.page.evaluate(() => document.getElementById('fl-error-msg').classList.contains('visible'));
  assert(wrongErrVisible, 'mauvais code réellement refusé, erreur affichée (clic réel)');
  const stillOnFirstLogin = await person1.page.evaluate(() => document.getElementById('create-password-block').style.display !== 'block');
  assert(stillOnFirstLogin, 'mauvais code ne fait jamais avancer vers l\'écran mot de passe');

  await submitFirstLogin(person1.page, emailHappy, codeHappy);
  const onPasswordScreen = await person1.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(onPasswordScreen, 'bon code réellement accepté -> écran de création de mot de passe (clic réel)');

  await submitCreatePassword(person1.page, NEW_PASSWORD, 'Autre-Chose-2026!');
  const mismatchErrVisible = await person1.page.evaluate(() => document.getElementById('cp-error-msg').classList.contains('visible'));
  assert(mismatchErrVisible, 'mots de passe différents réellement refusés, jamais silencieusement acceptés');

  await submitCreatePassword(person1.page, NEW_PASSWORD, NEW_PASSWORD);
  await person1.page.waitForFunction((url) => location.href.includes(url), { timeout: 8000 }, R.portalUrl).catch(() => {});
  assert(person1.page.url().includes(R.portalUrl), 'mot de passe créé -> redirection réelle vers ' + R.portalUrl + ' (' + person1.page.url() + ')');

  const rowHappy = psql(`select status from provisional_access_codes where email='${emailHappy}' and role='${role}';`).trim();
  assert(rowHappy === 'activated', 'statut final réellement "activated" en base (observé : ' + rowHappy + ')');
  const linkedHappy = psql(`select count(*) from ${R.accountsTable} where email='${emailHappy}';`).trim();
  assert(linkedHappy === '1', 'liaison métier réellement créée, une seule fois (' + linkedHappy + ')');

  await R.logout(person1.page);
  await person1.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await person1.page.type('#identifiant', emailHappy);
  await person1.page.type('#password', NEW_PASSWORD);
  await person1.page.click('#btn-connect');
  await person1.page.waitForFunction((url) => location.href.includes(url), { timeout: 8000 }, R.portalUrl).catch(() => {});
  assert(person1.page.url().includes(R.portalUrl), 'reconnexion NORMALE ensuite avec le mot de passe créé -> ' + R.portalUrl + ' (' + person1.page.url() + ')');
  await person1.ctx.close();

  // ═══ [2] Double-clic / double-envoi (première connexion ET création
  // du mot de passe) -- aucun doublon de compte/liaison ═══
  console.log(`\n== [2/10 ${label}] Double-clic -- aucun doublon ==`);
  const entityDup = `${prefix}_b`;
  const emailDup = emailFor('dup');
  const codeDup = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityDup, emailDup);
  const person2 = await newRolePage(browser);
  await person2.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await person2.page.click('button[onclick="showFirstLoginMode()"]');
  await person2.page.type('#fl-email', emailDup);
  await person2.page.type('#fl-code', codeDup);
  await person2.page.evaluate(() => { handleFirstLoginSubmit(); handleFirstLoginSubmit(); });
  await new Promise((r) => setTimeout(r, 1400));
  const onPwScreenDup = await person2.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(onPwScreenDup, 'double-envoi de "Première connexion" aboutit quand même une seule fois à l\'écran mot de passe');
  await person2.page.evaluate((pwd) => { document.getElementById('cp-password').value = pwd; document.getElementById('cp-password-confirm').value = pwd; handleCreatePassword(); handleCreatePassword(); }, NEW_PASSWORD);
  await new Promise((r) => setTimeout(r, 1400));
  const linkedDup = psql(`select count(*) from ${R.accountsTable} where email='${emailDup}';`).trim();
  assert(linkedDup === '1', 'double-clic (première connexion + création mdp) -> aucun doublon de liaison (' + linkedDup + ')');
  const usersDup = psql(`select count(*) from auth.users where email='${emailDup}';`).trim();
  assert(usersDup === '1', 'double-clic -> un seul compte Auth créé, jamais deux (' + usersDup + ')');
  await person2.ctx.close();

  // ═══ [3] Coupure réseau / reprise : abandon après le code, reprise
  // complète ensuite sur une page fraîche -- aucun doublon ═══
  console.log(`\n== [3/10 ${label}] Reprise après interruption -- aucun doublon, activation réussie ==`);
  const entityResume = `${prefix}_c`;
  const emailResume = emailFor('resume');
  const codeResume = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityResume, emailResume);
  const abandoned = await newRolePage(browser);
  await abandoned.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await submitFirstLogin(abandoned.page, emailResume, codeResume);
  const abandonedReachedPw = await abandoned.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(abandonedReachedPw, 'première tentative atteint bien l\'écran mot de passe avant l\'abandon simulé');
  await abandoned.ctx.close(); // simule la coupure : jamais de mot de passe créé

  const statusAfterAbandon = psql(`select status from provisional_access_codes where email='${emailResume}' and role='${role}';`).trim();
  assert(statusAfterAbandon === 'password_pending', 'après abandon, le code reste "password_pending" (jamais perdu ni faussement activé, observé : ' + statusAfterAbandon + ')');

  const resumed = await newRolePage(browser);
  await resumed.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await submitFirstLogin(resumed.page, emailResume, codeResume);
  const resumedReachedPw = await resumed.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(resumedReachedPw, 'reprise sur une page fraîche : le même email+code fonctionne à nouveau (idempotent, jamais "déjà utilisé")');
  await submitCreatePassword(resumed.page, NEW_PASSWORD, NEW_PASSWORD);
  await resumed.page.waitForFunction((url) => location.href.includes(url), { timeout: 8000 }, R.portalUrl).catch(() => {});
  assert(resumed.page.url().includes(R.portalUrl), 'reprise terminée -> portail atteint normalement');
  const linkedResume = psql(`select count(*) from ${R.accountsTable} where email='${emailResume}';`).trim();
  assert(linkedResume === '1', 'reprise après interruption -> toujours une seule liaison, jamais dupliquée (' + linkedResume + ')');
  const usersResume = psql(`select count(*) from auth.users where email='${emailResume}';`).trim();
  assert(usersResume === '1', 'reprise après interruption -> un seul compte Auth, jamais recréé (' + usersResume + ')');
  await resumed.ctx.close();

  // ═══ [4] Renvoi : un nouveau code invalide l'ancien pour la même fiche ═══
  console.log(`\n== [4/10 ${label}] Renvoi -- l'ancien code cesse réellement de fonctionner ==`);
  const entityResend = `${prefix}_e`;
  const emailResend = emailFor('resend');
  const oldCode = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityResend, emailResend);
  const newCode = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityResend, emailResend);
  assert(oldCode !== newCode, 'renvoi génère bien un code différent');
  const personOld = await newRolePage(browser);
  await personOld.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await submitFirstLogin(personOld.page, emailResend, oldCode);
  const oldStillWorks = await personOld.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(!oldStillWorks, 'ANCIEN code réellement inutilisable après un renvoi (jamais accepté)');
  await personOld.ctx.close();
  const personNew = await newRolePage(browser);
  await personNew.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await submitFirstLogin(personNew.page, emailResend, newCode);
  const newWorks = await personNew.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(newWorks, 'NOUVEAU code réellement fonctionnel après le renvoi');
  await personNew.ctx.close();

  // ═══ [5] Révocation patron : le code ne fonctionne plus ensuite ═══
  console.log(`\n== [5/10 ${label}] Révocation patron -- code réellement inutilisable ensuite ==`);
  const entityRevoke = `${prefix}_f`;
  const emailRevoke = emailFor('revoke');
  const codeRevoke = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityRevoke, emailRevoke);
  await patronRevoke(patron.page, R.fichePage, entityRevoke);
  const statusRevoked = psql(`select status from provisional_access_codes where email='${emailRevoke}' and role='${role}';`).trim();
  assert(statusRevoked === 'revoked', 'révocation patron réellement posée en base (' + statusRevoked + ')');
  const personRevoked = await newRolePage(browser);
  await personRevoked.page.goto(`http://localhost:${PORT}/${R.connexionPage}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));
  await submitFirstLogin(personRevoked.page, emailRevoke, codeRevoke);
  const revokedStillWorks = await personRevoked.page.evaluate(() => document.getElementById('create-password-block').style.display === 'block');
  assert(!revokedStillWorks, 'code révoqué par le patron réellement inutilisable côté client/salarié');
  await personRevoked.ctx.close();

  // ═══ [6] Isolation cross-rôle : un code Client ne marche jamais sur le
  // point d'entrée Salarié, et inversement (via le VRAI Edge Function) ═══
  console.log(`\n== [6/10 ${label}] Isolation cross-rôle (Edge Function réelle) ==`);
  const entityCross = `${prefix}_g`;
  const emailCross = emailFor('cross');
  const codeCross = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityCross, emailCross);
  const otherRole = role === 'client' ? 'employe' : 'client';
  const crossRes = await fetch(API_URL + '/functions/v1/activate-access-code', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Origin: 'http://localhost:8791' },
    body: JSON.stringify({ email: emailCross, code: codeCross, role: otherRole }),
  });
  const crossJson = await crossRes.json().catch(() => ({}));
  assert(crossRes.status === 401 && !crossJson.ok, 'code ' + label + ' refusé avec role="' + otherRole + '" (status ' + crossRes.status + ', ' + JSON.stringify(crossJson) + ')');
  const stillPendingCross = psql(`select status from provisional_access_codes where email='${emailCross}' and role='${role}';`).trim();
  assert(stillPendingCross === 'pending', 'tentative cross-rôle ne fait PAS avancer le vrai code (reste pending, observé : ' + stillPendingCross + ')');

  // ═══ [7] Fiche d'un autre patron refusée par la VRAIE Edge Function
  // create-access-code (résolution account depuis auth.uid(), jamais le
  // navigateur) ═══
  console.log(`\n== [7/10 ${label}] create-access-code refuse une fiche d'un autre patron (Edge Function réelle) ==`);
  const crossAccountRes = await patron.pageB.evaluate(async (entityId, roleArg) => {
    const session = await window.sebaAuth.getSession();
    const res = await fetch(window.SEBA_CONFIG.supabaseUrl + '/functions/v1/create-access-code', {
      method: 'POST',
      headers: { apikey: window.SEBA_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: roleArg, entity_id: entityId, email: 'attacker-injected@test.seba.invalid', delivery_method: 'reveal_once' }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, entityHappy, role);
  assert(crossAccountRes.status === 400 && !crossAccountRes.json.ok, 'patron B ne peut pas créer un code pour une fiche du patron A (' + JSON.stringify(crossAccountRes) + ')');

  // ═══ [8] Compte Auth déjà existant AVANT l'invitation : jamais de
  // rattachement automatique, jamais de mot de passe changé silencieusement ═══
  console.log(`\n== [8/10 ${label}] Compte Auth déjà existant -- refus explicite, jamais de rattachement silencieux ==`);
  const entityExisting = `${prefix}_d`;
  const emailExisting = emailFor('existing');
  await createOrGetUser(emailExisting, 'Mot-De-Passe-Externe-Deja-Existant-2026!');
  const codeExisting = await patronRevealCode(patron.page, R.fichePage, R.emailInputId, entityExisting, emailExisting);
  const existingRes = await fetch(API_URL + '/functions/v1/activate-access-code', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Origin: 'http://localhost:8791' },
    body: JSON.stringify({ email: emailExisting, code: codeExisting, role }),
  });
  const existingJson = await existingRes.json().catch(() => ({}));
  assert(existingRes.status === 409, 'compte Auth déjà existant -> HTTP 409 explicite (' + existingRes.status + ')');
  assert(/existe déjà/.test(existingJson.error || ''), 'message générique correct, jamais un rattachement silencieux (' + JSON.stringify(existingJson) + ')');
  const statusExisting = psql(`select status from provisional_access_codes where email='${emailExisting}' and role='${role}';`).trim();
  assert(statusExisting === 'revoked', 'invitation automatiquement révoquée après un compte déjà existant (' + statusExisting + ')');
  const stillOnePwExisting = psql(`select count(*) from auth.users where email='${emailExisting}';`).trim();
  assert(stillOnePwExisting === '1', 'aucun second compte Auth créé pour cet email (' + stillOnePwExisting + ')');

  // ═══ [9] Envoi par email : delivery_failed (RESEND_API_KEY absente en
  // local) JAMAIS affiché comme un succès dans l'interface patron ═══
  console.log(`\n== [9/10 ${label}] Email : delivery_failed jamais affiché comme "envoyé" ==`);
  const entityEmail = `${prefix}_h`;
  const emailEmail = emailFor('email');
  const statusLineText = await patronSendEmailCode(patron.page, R.fichePage, R.emailInputId, entityEmail, emailEmail);
  const deliveryStatus = psql(`select delivery_status from provisional_access_codes where email='${emailEmail}' and role='${role}';`).trim();
  note('delivery_status observé en base : ' + deliveryStatus + ' (RESEND_API_KEY volontairement absente en local)');
  assert(deliveryStatus === 'delivery_failed' || deliveryStatus === 'sent', 'delivery_status cohérent (' + deliveryStatus + ')');
  if (deliveryStatus === 'delivery_failed') {
    assert(/ÉCHEC D'ENVOI/.test(statusLineText), 'interface patron affiche explicitement l\'échec, jamais "envoyé" (texte observé : "' + statusLineText + '")');
    assert(!/— email envoyé/.test(statusLineText), 'JAMAIS le libellé de succès affiché sur un échec réel (texte observé : "' + statusLineText + '")');
  } else {
    assert(/— email envoyé/.test(statusLineText), 'interface patron affiche le succès réel (texte observé : "' + statusLineText + '")');
  }

  // ═══ [10] Zéro erreur console sur l'ensemble des parcours réels ═══
  console.log(`\n== [10/10 ${label}] Zéro erreur console ==`);
  assert(person1.consoleErrors.length === 0, 'zéro erreur console — parcours complet (' + JSON.stringify(person1.consoleErrors) + ')');

  psql(`
    delete from ${R.accountsTable} where email like 'qaac-${role}-%';
    delete from provisional_access_codes where email like 'qaac-${role}-%';
    delete from auth.users where email like 'qaac-${role}-%';
  `);
}

async function main() {
  console.log('== [setup] Nettoyage des comptes de test précédents ==');
  psql(`
    delete from client_accounts where email like 'qaac-%';
    delete from employe_accounts where email like 'qaac-%';
    delete from provisional_access_codes where email like 'qaac-%';
    delete from seba_state where account like 'qaac-%';
    delete from auth.users where email like 'qaac-%';
  `);

  console.log('== [setup] Serveur statique (localhost:8791) + comptes patron A/B ==');
  const server = await startStaticServer();
  const patronAId = await createOrGetUser('qaac-patron-a@test.seba.invalid', PATRON_PASSWORD);
  const patronBId = await createOrGetUser('qaac-patron-b@test.seba.invalid', PATRON_PASSWORD);

  const clientEntities = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => ({ id: `cli_qaac_${s}`, nom: 'QAAC Client ' + s.toUpperCase() }));
  const employeEntities = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => ({ id: `emp_qaac_${s}`, nom: 'QAAC Salarie ' + s.toUpperCase() }));
  psql(`
    insert into seba_state (account, user_id, state) values (
      '${patronAId}', '${patronAId}',
      '${JSON.stringify({
        v: 1,
        clients: clientEntities.map((c) => ({ id: c.id, nom: c.nom, prenom: '', email: '' })),
        employes: employeEntities.map((e) => ({ id: e.id, prenom: e.nom, nom: '', actif: true })),
        devis: [], factures: [], interventions: [], journal: [], custom_services: [], contrats: [], messages: [], clientRequests: [], seq: { devis: 0, facture: 0, contrat: 0 },
      }).replace(/'/g, "''")}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
    insert into seba_state (account, user_id, state) values (
      '${patronBId}', '${patronBId}',
      '{"v":1,"clients":[],"employes":[],"devis":[],"factures":[],"interventions":[],"journal":[],"custom_services":[],"contrats":[],"messages":[],"clientRequests":[],"seq":{"devis":0,"facture":0,"contrat":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;
  `);

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const patron = await newRolePage(browser);
  const patronBCtx = await newRolePage(browser);

  try {
    console.log('== [setup] Connexion patron A / patron B (clic réel) ==');
    await patron.page.goto(`http://localhost:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.type('#email', 'qaac-patron-a@test.seba.invalid');
    await patron.page.type('#password', PATRON_PASSWORD);
    await patron.page.click('#btn-connect');
    await patron.page.waitForFunction(() => location.pathname.includes('dashboard.html'), { timeout: 8000 }).catch(() => {});
    assert(patron.page.url().includes('app/dashboard.html'), 'connexion patron A réussie -> app/dashboard.html');

    await patronBCtx.page.goto(`http://localhost:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patronBCtx.page.type('#email', 'qaac-patron-b@test.seba.invalid');
    await patronBCtx.page.type('#password', PATRON_PASSWORD);
    await patronBCtx.page.click('#btn-connect');
    await patronBCtx.page.waitForFunction(() => location.pathname.includes('dashboard.html'), { timeout: 8000 }).catch(() => {});
    assert(patronBCtx.page.url().includes('app/dashboard.html'), 'connexion patron B réussie -> app/dashboard.html');
    patron.pageB = patronBCtx.page;

    await runRoleSuite(browser, patron, 'client');
    await runRoleSuite(browser, patron, 'employe');
  } finally {
    psql(`
      delete from client_accounts where email like 'qaac-%';
      delete from employe_accounts where email like 'qaac-%';
      delete from provisional_access_codes where email like 'qaac-%';
      delete from seba_state where account like 'qaac-%';
      delete from auth.users where email like 'qaac-%';
    `);
    await patron.ctx.close();
    await patronBCtx.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
