// SEBA — QA ACTIVATION RÉELLE DES COMPTES ET ACCÈS (feature/customer-
// email-delivery, prérequis avant déploiement des emails commerciaux).
// Teste les VRAIS parcours Supabase Auth (patron/client/employé) contre
// le Supabase local -- emails interceptés par Mailpit (aucun mock, aucun
// SMTP externe), liens d'activation/récupération réellement suivis par
// un vrai navigateur, sessions réellement établies.
//
// Prérequis : Supabase local démarré (Mailpit sur :54324), et
//   npx supabase@2.109.1 functions serve --no-verify-jwt --env-file <...>
// déjà lancé, servant notamment client-provision et employe-provision
// (copiés temporairement depuis supabase-functions/ vers supabase/functions/
// pour ce test -- ces deux fonctions sont normalement déployées à la main
// via le Dashboard Supabase, voir MANUEL-SEBA-ADMIN.md ; ce script ne
// change pas cette convention de déploiement, il la teste seulement).
//
// Usage : node scripts/qa-account-activation.js

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const REPO_ROOT = 'C:\\Users\\sebas\\Downloads\\Seba\\Seba\\seba';
const API_URL = 'http://127.0.0.1:54321';
const MAILPIT_URL = 'http://127.0.0.1:54324';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// localhost:8791, PAS 127.0.0.1 -- doit matcher EXACTEMENT ALLOWED_ORIGINS
// dans client-provision.ts/employe-provision.ts/send-commercial-document
// (CORS) et additional_redirect_urls dans supabase/config.toml (redirectTo).
const PORT = 8791;
const NEW_PASSWORD = 'Nouveau-MdP-QA-2026!';

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
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* Attend un NOUVEAU message Mailpit pour ce destinataire (Created après
   sinceMs) -- jamais un ancien message d'un run précédent. Retourne
   {subject, text} du corps réel de l'email envoyé par Supabase Auth. */
async function mailpitWaitFor(email, sinceMs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(MAILPIT_URL + '/api/v1/search?query=' + encodeURIComponent('to:' + email));
    const json = await res.json().catch(() => ({ messages: [] }));
    const fresh = (json.messages || []).filter((m) => new Date(m.Created).getTime() >= sinceMs);
    if (fresh.length) {
      const full = await fetch(MAILPIT_URL + '/api/v1/message/' + fresh[0].ID).then((r) => r.json());
      return { subject: full.Subject, text: full.Text || '' };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function extractVerifyLink(text) {
  const m = text.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s)]+/);
  return m ? m[0] : null;
}

async function newRolePage(browser) {
  const ctx = await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  // 60s (au lieu du defaut Puppeteer 30s) : Docker Desktop + le stack
  // Supabase local peuvent ralentir un goto() bien au-dela de 30s sous
  // charge soutenue (execution repetee de cette suite) -- n'affaiblit
  // aucune assertion, donne seulement plus de marge a une machine locale
  // lente avant de declarer un FATAL.
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
    // 403 : bruit réseau du navigateur pour le test d'attaque cross-account
    // volontaire (patron B, [16/20]) -- résultat déjà vérifié explicitement
    // par une assertion dédiée sur le corps de la réponse, jamais un échec
    // muet ici. 400 : même raisonnement pour le rejeu volontaire de
    // create_profile_and_company avec un secteur différent ([2bis/20]) --
    // la RPC PostgREST renvoie 400 pour l'exception 23514 attendue,
    // vérifiée explicitement par sa propre assertion.
    if (m.type() !== 'error' || /manifest\.json|404 \(Not Found\)|502 \(Bad Gateway\)|403 \(Forbidden\)|400 \(Bad Request\)/.test(m.text())) return;
    const args = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.stack) ? v.stack : v).catch(() => '[unserializable]')));
    consoleErrors.push('console.error: ' + m.text() + (args.length ? ' | ' + JSON.stringify(args) : ''));
  });
  return { ctx, page, consoleErrors };
}

/* location.pathname change dès que la navigation est validée par le
   navigateur, potentiellement AVANT que les <script src> synchrones de la
   nouvelle page (auth.js en tête) n'aient fini de s'exécuter -- attendre
   explicitement window.sebaAuth avant tout evaluate() qui en dépend,
   sinon "Cannot read properties of undefined" de façon intermittente. */
async function waitSebaAuth(page) {
  await page.waitForFunction(() => !!window.sebaAuth, { timeout: 5000 }).catch(() => {});
}

/* Suit RÉELLEMENT le lien reçu par email (GET sur /auth/v1/verify, comme
   un vrai clic) -- GoTrue échange le token et redirige (303) vers
   redirect_to#access_token=...&type=..., que le SDK côté page consomme
   ensuite (detectSessionInUrl). Aucun raccourci : pas d'injection directe
   de session. */
async function followEmailLink(page, verifyLink) {
  await page.goto(verifyLink, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 700));
}

async function main() {
  console.log('== [setup] Nettoyage des comptes de test précédents ==');
  psql(`
    delete from client_accounts where email like 'qaaa-%';
    delete from employe_accounts where email like 'qaaa-%';
    delete from seba_state where account like 'qaaa-%';
    delete from auth.users where email like 'qaaa-%';
  `);

  console.log('== [setup] Serveur statique (localhost:8791, doit matcher CORS + redirect allowlist) ==');
  const server = await startStaticServer();
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox'] });

  const patron = await newRolePage(browser);
  const client = await newRolePage(browser);
  const employe = await newRolePage(browser);
  const patronB = await newRolePage(browser);

  const patronEmail = 'qaaa-patron-' + Date.now() + '@test.seba.invalid';
  const clientEmail = 'qaaa-client-' + Date.now() + '@test.seba.invalid';
  const employeEmail = 'qaaa-employe-' + Date.now() + '@test.seba.invalid';

  try {
    // ═══ [1/20] Inscription patron (tunnel bienvenue.html, signInWithOtp réel) ═══
    console.log('\n== [1/20] Inscription patron -- signUpEmailOnly réel + email réellement envoyé ==');
    await patron.page.goto(`http://localhost:${PORT}/bienvenue.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.evaluate(() => {
      localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: 'QAAA SARL', secteur: 'menage' }));
      localStorage.setItem('seba_profile_pending', '1');
    });
    const tSignup = Date.now();
    const signupRes = await patron.page.evaluate((e) => window.sebaAuth.signUpEmailOnly(e), patronEmail);
    assert(signupRes.ok, 'signUpEmailOnly réussi, aucune erreur (' + JSON.stringify(signupRes) + ')');
    const signupMail = await mailpitWaitFor(patronEmail, tSignup);
    assert(!!signupMail, 'email d\'inscription réellement reçu dans Mailpit');

    // ═══ [2/20] Confirmation patron (clic réel du lien, session réellement établie) ═══
    console.log('\n== [2/20] Confirmation patron -- lien suivi réellement, session + email_confirmed_at réels ==');
    const signupLink = signupMail && extractVerifyLink(signupMail.text);
    assert(!!signupLink, 'lien d\'activation présent dans l\'email');
    // reload(), pas goto() : patron.page est deja sur bienvenue.html depuis
    // le [1/20] (meme raison qu'au [7/20]/[13/20] plus bas).
    await patron.page.reload({ waitUntil: 'domcontentloaded' });
    await followEmailLink(patron.page, signupLink);
    const activatePaneVisible = await patron.page.evaluate(() => !document.getElementById('pane-activate').classList.contains('hidden') && document.getElementById('pane-invalid').classList.contains('hidden'));
    assert(activatePaneVisible, 'session réelle détectée après le clic -- pane activation affiché (pas "lien expiré")');
    const confirmedAt = psql(`select email_confirmed_at is not null from auth.users where email = '${patronEmail}';`).trim();
    assert(confirmedAt === 't', 'email_confirmed_at réellement posé en base après le clic');

    await patron.page.type('#new-password', NEW_PASSWORD);
    await patron.page.click('#btn-activate');
    // La séquence SebaFX (pulse -> 1200ms -> fadeOut -> 350ms) précède la
    // navigation réelle -- attendre franchement plus que ces délais avant
    // d'interagir avec la page suivante, sinon la navigation est parfois
    // encore en vol au moment de l'evaluate() suivant (contexte détruit).
    await patron.page.waitForFunction(() => location.pathname.includes('dashboard.html'), { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2200));
    const patronUrlAfterActivate = patron.page.url();
    assert(patronUrlAfterActivate.includes('app/dashboard.html'), 'activation patron -> redirection réelle vers app/dashboard.html (' + patronUrlAfterActivate + ')');
    const patronId = await patron.page.evaluate(async () => { const s = await window.sebaAuth.getSession(); return s && s.user && s.user.id; });
    assert(!!patronId, 'session réelle établie sur app/dashboard.html après activation (' + patronId + ')');

    // ═══ [2bis/20] Retry idempotent de create_profile_and_company (rejeu réel,
    // pas supposé) -- reproduit exactement le chemin completePendingProfile()
    // (connexion.html) qui rappelle cette RPC au premier login si le flag
    // seba_profile_pending n'a pas été nettoyé côté client. Vérifie
    // qu'un second appel pour le MÊME patron ne lève aucune erreur (pas de
    // violation de contrainte unique) et ne duplique aucune ligne. ═══
    console.log('\n== [2bis/20] Retry idempotent create_profile_and_company -- rejeu réel, aucun doublon ==');
    const retryRes = await patron.page.evaluate((uid) => window.sebaAuth.rpc('create_profile_and_company', {
      _user_id: uid, _sector: 'menage', _company_name: 'QAAA SARL',
    }), patronId);
    assert(!retryRes.error, 'second appel (même patron, même secteur) réussit sans erreur (' + JSON.stringify(retryRes.error) + ')');
    const profilesCount = psql(`select count(*) from profiles where user_id = '${patronId}';`).trim();
    assert(profilesCount === '1', 'aucun doublon dans profiles après le rejeu (observé : ' + profilesCount + ')');
    const companiesCount = psql(`select count(*) from companies c join profiles p on p.id = c.profile_id where p.user_id = '${patronId}';`).trim();
    assert(companiesCount === '1', 'aucun doublon dans companies après le rejeu (observé : ' + companiesCount + ')');
    const sebaStateCount = psql(`select count(*) from seba_state where user_id = '${patronId}';`).trim();
    assert(sebaStateCount === '1', 'aucun doublon dans seba_state après le rejeu (observé : ' + sebaStateCount + ')');
    const mismatchRes = await patron.page.evaluate((uid) => window.sebaAuth.rpc('create_profile_and_company', {
      _user_id: uid, _sector: 'conciergerie', _company_name: 'QAAA SARL',
    }), patronId);
    assert(!!mismatchRes.error, 'un secteur different au rejeu est refuse explicitement, jamais ecrase silencieusement (' + JSON.stringify(mismatchRes.error) + ')');

    // ═══ [3/20] Connexion patron (nouveau mot de passe déjà posé) ═══
    console.log('\n== [3/20] Connexion patron -- vraie session, vrai redirect (clic réel) ==');
    await patron.page.evaluate(() => window.sebaAuth.signOut());
    await patron.page.goto(`http://localhost:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    await patron.page.type('#email', patronEmail);
    await patron.page.type('#password', NEW_PASSWORD);
    await patron.page.click('#btn-connect');
    await patron.page.waitForFunction(() => location.pathname.includes('dashboard.html'), { timeout: 8000 }).catch(() => {});
    assert(patron.page.url().includes('app/dashboard.html'), 'connexion patron réussie (clic réel) -> app/dashboard.html (' + patron.page.url() + ')');

    // ═══ [4/20] Reset mot de passe patron (flux réel, email réel, lien réel) ═══
    console.log('\n== [4/20] Reset mot de passe patron -- flux réel de bout en bout ==');
    await patron.page.goto(`http://localhost:${PORT}/reset-password.html`, { waitUntil: 'domcontentloaded' });
    const tReset = Date.now();
    await patron.page.type('#email', patronEmail);
    await patron.page.click('#btn-request');
    await new Promise((r) => setTimeout(r, 500));
    const reqSuccessVisible = await patron.page.evaluate(() => document.getElementById('req-success').classList.contains('visible'));
    assert(reqSuccessVisible, 'confirmation "email envoyé" affichée après la demande');
    const resetMail = await mailpitWaitFor(patronEmail, tReset);
    assert(!!resetMail, 'email de réinitialisation réellement reçu');
    const resetLink = resetMail && extractVerifyLink(resetMail.text);
    const PATRON_NEW_PW2 = 'Encore-Un-MdP-QA-2026!';
    await followEmailLink(patron.page, resetLink);
    const updatePaneVisible = await patron.page.evaluate(() => !document.getElementById('pane-update').classList.contains('hidden'));
    assert(updatePaneVisible, 'lien de récupération réellement suivi -- pane "nouveau mot de passe" affiché');
    await patron.page.type('#new-password', PATRON_NEW_PW2);
    await patron.page.click('#btn-update');
    await patron.page.waitForFunction(() => location.pathname.includes('connexion.html'), { timeout: 5000 }).catch(() => {});
    assert(patron.page.url().includes('connexion.html'), 'patron redirigé vers connexion.html après reset (pas client/employé -- aucun rôle détecté)');
    const reSignIn = await patron.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), patronEmail, PATRON_NEW_PW2);
    assert(reSignIn.ok, 'le nouveau mot de passe fonctionne réellement pour se reconnecter');

    // ═══ [5/20] Invitation client (Edge Function réelle, email réel) ═══
    console.log('\n== [5/20] Invitation client -- Edge Function client-provision réelle, email réel ==');
    // Crée le client/devis via de VRAIS SebaDB.create() (comme clients.html
    // le ferait), pas une injection SQL directe -- c'est cette écriture qui
    // crée la ligne seba_state elle-même (persist() -> pushOp() ->
    // sync-push, débouncé 800ms) : un patron fraîchement activé n'a AUCUNE
    // ligne seba_state tant qu'il n'a rien créé, exactement comme un vrai
    // patron au tout premier usage.
    await patron.page.goto(`http://localhost:${PORT}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 500));
    await patron.page.evaluate((email) => SebaDB.create('clients', { id: 'cli_qaaa1', prenom: 'Client', nom: 'QAAA', email, contact: email, adresse: '1 rue QAAA' }), clientEmail);
    await patron.page.evaluate(() => SebaDB.create('devis', { id: 'dev_qaaa1', num: 'DEV-QAAA-1', status: 'signe', clientId: 'cli_qaaa1', clientName: 'Client QAAA' }));
    await new Promise((r) => setTimeout(r, 2200));
    const hasSebaState = psql(`select count(*) from seba_state where user_id = '${patronId}';`).trim();
    assert(hasSebaState === '1', 'la première écriture réelle du patron crée bien sa ligne seba_state (compte = user_id, jamais un label arbitraire)');
    const patronAccount = psql(`select account from seba_state where user_id = '${patronId}';`).trim();
    assert(patronAccount === patronId, 'account de seba_state == auth.uid() du patron, comme attendu par adapter._accountId() (' + patronAccount + ')');

    const tInviteClient = Date.now();
    const provisionClientRes = await patron.page.evaluate((cid, e) => SebaDB.clientPortal.provision(cid, e), 'cli_qaaa1', clientEmail);
    assert(provisionClientRes.ok, 'invitation client réussie côté API (' + JSON.stringify(provisionClientRes) + ')');
    const clientInviteMail = await mailpitWaitFor(clientEmail, tInviteClient);
    assert(!!clientInviteMail, 'email d\'invitation client réellement reçu');
    const linkRow = psql(`select client_user_id from client_accounts where account = '${patronId}' and client_id = 'cli_qaaa1';`).trim();
    assert(!!linkRow, 'client_accounts réellement lié après l\'invitation');

    // ═══ [6/20] Activation client (lien réel, resolveRoleLandingPage -> client-connexion.html) ═══
    console.log('\n== [6/20] Activation client -- lien réel suivi, redirection réelle vers client-connexion.html ==');
    const clientInviteLink = extractVerifyLink(clientInviteMail.text);
    assert(!!clientInviteLink, 'lien d\'invitation présent dans l\'email client');
    await client.page.goto(`http://localhost:${PORT}/reset-password.html`, { waitUntil: 'domcontentloaded' });
    await followEmailLink(client.page, clientInviteLink);
    const clientUpdatePaneVisible = await client.page.evaluate(() => !document.getElementById('pane-update').classList.contains('hidden'));
    assert(clientUpdatePaneVisible, 'lien d\'invitation client réellement suivi -- pane "nouveau mot de passe" affiché');
    await client.page.type('#new-password', NEW_PASSWORD);
    await client.page.click('#btn-update');
    await client.page.waitForFunction(() => location.pathname.includes('client-connexion.html'), { timeout: 8000 }).catch(() => {});
    assert(client.page.url().includes('client-connexion.html'), 'client activé -> redirection réelle vers client-connexion.html, pas connexion.html (' + client.page.url() + ')');

    // ═══ [7/20] Connexion client ═══
    console.log('\n== [7/20] Connexion client -- vraie session cliente ==');
    // reload(), pas goto() vers la MÊME URL où le test [6/20] vient déjà
    // d'atterrir : un goto() vers une URL identique à la courante ne
    // redéclenche pas toujours un cycle de navigation complet côté Chrome
    // (aucun événement de lifecycle -- domcontentloaded n'arrive jamais),
    // observé de façon intermittente (FATAL TimeoutError). reload() force
    // un vrai rechargement quelle que soit l'URL courante.
    await client.page.reload({ waitUntil: 'domcontentloaded' });
    await client.page.type('#identifiant', clientEmail);
    await client.page.type('#password', NEW_PASSWORD);
    await client.page.click('#btn-connect');
    await client.page.waitForFunction(() => location.pathname.includes('client-espace.html'), { timeout: 8000 }).catch(() => {});
    assert(client.page.url().includes('client-espace.html'), 'connexion client réussie -> client-espace.html (' + client.page.url() + ')');

    // ═══ [8/20] Reset mot de passe client (mécanisme sous-jacent, UI intentionnellement absente) ═══
    console.log('\n== [8/20] Reset mot de passe client -- capacité sous-jacente Supabase Auth vérifiée ==');
    note('client-connexion.html expose volontairement "Demandez à votre prestataire" (pas de self-service, décision produit documentée) -- ce test vérifie que sebaAuth.resetPassword générique fonctionne aussi pour un compte client, capacité déjà réutilisable si un self-service est ajouté plus tard.');
    await client.page.waitForFunction(() => !!window.sebaAuth, { timeout: 5000 });
    const tResetClient = Date.now();
    const clientResetReq = await client.page.evaluate((e) => window.sebaAuth.resetPassword(e), clientEmail);
    assert(clientResetReq.ok, 'resetPassword() fonctionne pour un compte client (' + JSON.stringify(clientResetReq) + ')');
    const clientResetMail = await mailpitWaitFor(clientEmail, tResetClient);
    assert(!!clientResetMail, 'email de reset client réellement reçu');
    const clientResetLink = extractVerifyLink(clientResetMail.text);
    const CLIENT_NEW_PW2 = 'Client-MdP-QA-2026!';
    await client.page.goto(`http://localhost:${PORT}/reset-password.html`, { waitUntil: 'domcontentloaded' });
    await followEmailLink(client.page, clientResetLink);
    await client.page.type('#new-password', CLIENT_NEW_PW2);
    await client.page.click('#btn-update');
    await client.page.waitForFunction(() => location.pathname.includes('client-connexion.html'), { timeout: 8000 }).catch(() => {});
    assert(client.page.url().includes('client-connexion.html'), 'reset client -> redirection réelle vers client-connexion.html (' + client.page.url() + ')');
    await client.page.waitForFunction(() => !!window.SebaDB, { timeout: 5000 }).catch(() => {});
    const clientReSignIn = await client.page.evaluate((e, p) => SebaDB.clientPortal.login(e, p), clientEmail, CLIENT_NEW_PW2);
    assert(clientReSignIn.ok, 'nouveau mot de passe client réellement fonctionnel');

    // ═══ [9/20] Isolation client A / client B ═══
    console.log('\n== [9/20] Client A ne voit pas les documents d\'un autre compte ==');
    const foreignQuoteRes = await client.page.evaluate(() => SebaDB.clientPortal.devisDetail('dev_p2_signed_does_not_belong_here'));
    assert(!foreignQuoteRes.ok, 'accès à un devis ne lui appartenant pas réellement refusé (' + JSON.stringify(foreignQuoteRes) + ')');

    // ═══ [10/20] Retour client vers le devis demandé après connexion fraîche ═══
    // HORS PÉRIMÈTRE de fix/account-activation-bootstrap : le deep-link
    // ?doc=quote&id=... (client-espace.html) et safeReturnUrl()/return=
    // (client-connexion.html) sont du code Customer Email Delivery Phase 2
    // (commit 9e56065), pas encore sur main -- volontairement NON extrait
    // dans cette branche (voir MASTER_BACKLOG.md CED-008 "deep-link
    // post-auth", qui couvre ce scénario une fois CED mergée). Retirer ce
    // test ici n'est pas masquer une régression : rien dans CETTE PR ne
    // prétend fournir ce comportement.
    console.log('\n== [10/20] Retour vers le document demandé -- HORS PÉRIMÈTRE (code Customer Email Delivery, non présent sur cette branche, voir CED-008) ==');

    // ═══ [11/20 12/20] Invitation + activation employé ═══
    console.log('\n== [11/20 12/20] Invitation + activation employé -- flux réels ==');
    await patron.page.evaluate((email) => SebaDB.create('employes', { id: 'emp_qaaa1', prenom: 'Emp', nom: 'QAAA', email }), employeEmail);
    await new Promise((r) => setTimeout(r, 1500));
    const tInviteEmp = Date.now();
    const provisionEmpRes = await patron.page.evaluate((eid, e) => SebaDB.employeePortal.provision(eid, e), 'emp_qaaa1', employeEmail);
    assert(provisionEmpRes.ok, 'invitation employé réussie côté API (' + JSON.stringify(provisionEmpRes) + ')');
    const empInviteMail = await mailpitWaitFor(employeEmail, tInviteEmp);
    assert(!!empInviteMail, 'email d\'invitation employé réellement reçu');
    const empInviteLink = extractVerifyLink(empInviteMail.text);
    await employe.page.goto(`http://localhost:${PORT}/reset-password.html`, { waitUntil: 'domcontentloaded' });
    await followEmailLink(employe.page, empInviteLink);
    await employe.page.type('#new-password', NEW_PASSWORD);
    await employe.page.click('#btn-update');
    await employe.page.waitForFunction(() => location.pathname.includes('employe-connexion.html'), { timeout: 8000 }).catch(() => {});
    assert(employe.page.url().includes('employe-connexion.html'), 'employé activé -> redirection réelle vers employe-connexion.html (' + employe.page.url() + ')');

    // ═══ [13/20] Connexion employé (clic réel) ═══
    console.log('\n== [13/20] Connexion employé -- clic réel ==');
    // reload(), même raison qu'au [7/20] : employe.page est déjà sur cette
    // URL exacte depuis [11/20 12/20], un goto() identique est intermittent.
    await employe.page.reload({ waitUntil: 'domcontentloaded' });
    await employe.page.type('#identifiant', employeEmail);
    await employe.page.type('#password', NEW_PASSWORD);
    await employe.page.click('#btn-connect');
    await employe.page.waitForFunction(() => location.pathname.includes('espace-terrain.html'), { timeout: 8000 }).catch(() => {});
    assert(employe.page.url().includes('espace-terrain.html'), 'connexion employé réussie (clic réel) -> espace-terrain.html (' + employe.page.url() + ')');

    // ═══ [14/20] Employé sans accès financier ═══
    console.log('\n== [14/20] Employé sans accès financier (RLS + absence UI) ==');
    await waitSebaAuth(employe.page);
    const empFinancialRead = await employe.page.evaluate(async () => {
      const session = await window.sebaAuth.getSession();
      const token = session && session.access_token;
      const res = await fetch(window.SEBA_CONFIG.supabaseUrl + '/rest/v1/seba_state?select=state', {
        headers: { apikey: window.SEBA_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + token },
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, rows: Array.isArray(json) ? json.length : null };
    });
    assert(empFinancialRead.rows === 0, 'lecture directe de seba_state (devis/factures) par un employé -> 0 ligne, RLS bloque réellement (' + JSON.stringify(empFinancialRead) + ')');
    const espaceTerrainHtml = readFileSync(path.join(REPO_ROOT, 'docs', 'espace-terrain.html'), 'utf8');
    assert(!/facture|devis/i.test(espaceTerrainHtml), 'aucune référence devis/facture dans espace-terrain.html (contrôle statique du fichier réellement servi)');

    // ═══ [15/20] Reset mot de passe employé ═══
    console.log('\n== [15/20] Reset mot de passe employé -- capacité sous-jacente vérifiée ==');
    await employe.page.waitForFunction(() => !!window.sebaAuth, { timeout: 5000 });
    const tResetEmp = Date.now();
    const empResetReq = await employe.page.evaluate((e) => window.sebaAuth.resetPassword(e), employeEmail);
    assert(empResetReq.ok, 'resetPassword() fonctionne pour un compte employé');
    const empResetMail = await mailpitWaitFor(employeEmail, tResetEmp);
    assert(!!empResetMail, 'email de reset employé réellement reçu');
    const empResetLink = extractVerifyLink(empResetMail.text);
    const EMP_NEW_PW2 = 'Employe-MdP-QA-2026!';
    await employe.page.goto(`http://localhost:${PORT}/reset-password.html`, { waitUntil: 'domcontentloaded' });
    await followEmailLink(employe.page, empResetLink);
    await employe.page.type('#new-password', EMP_NEW_PW2);
    await employe.page.click('#btn-update');
    await employe.page.waitForFunction(() => location.pathname.includes('employe-connexion.html'), { timeout: 8000 }).catch(() => {});
    assert(employe.page.url().includes('employe-connexion.html'), 'reset employé -> redirection réelle vers employe-connexion.html');
    const empReSignIn = await employe.page.evaluate((e, p) => SebaDB.employeePortal.login(e, p), employeEmail, EMP_NEW_PW2);
    assert(empReSignIn.ok, 'nouveau mot de passe employé réellement fonctionnel');

    // ═══ [16/20] Mauvais account refusé (attaque cross-account réelle) ═══
    console.log('\n== [16/20] Invitation sur un account qui n\'appartient pas à l\'appelant -> refusée ==');
    const patronBId = await createOrGetUser('qaaa-patron-b-' + Date.now() + '@test.seba.invalid', 'Test-Synthetic-2026!');
    await patronB.page.goto(`http://localhost:${PORT}/connexion.html`, { waitUntil: 'domcontentloaded' });
    const patronBEmailRow = psql(`select email from auth.users where id = '${patronBId}';`).trim();
    const signInB = await patronB.page.evaluate((e, p) => window.sebaAuth.signIn(e, p), patronBEmailRow, 'Test-Synthetic-2026!');
    assert(signInB.ok, 'connexion patron B réussie (setup attaque)');
    const crossAccountRes = await patronB.page.evaluate(async (targetAccount, cid, e) => {
      const session = await window.sebaAuth.getSession();
      const res = await fetch(window.SEBA_CONFIG.supabaseUrl + '/functions/v1/client-provision', {
        method: 'POST',
        headers: { apikey: window.SEBA_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: targetAccount, client_id: cid, email: e }),
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    }, patronId, 'cli_qaaa1', 'attacker-injected@test.seba.invalid');
    assert(crossAccountRes.status === 403, 'patron B ne peut pas inviter un client au nom du account de patron A -> 403 (' + JSON.stringify(crossAccountRes) + ')');

    // ═══ [17/20] Return URL externe refusée (anti open-redirect) ═══
    console.log('\n== [17/20] Return URL externe refusée -- aucun open redirect ==');
    await client.page.evaluate(() => SebaDB.clientPortal.logout());
    await client.page.goto(`http://localhost:${PORT}/client-connexion.html?return=` + encodeURIComponent('https://evil-attacker.example.com/phishing'), { waitUntil: 'domcontentloaded' });
    await client.page.type('#identifiant', clientEmail);
    await client.page.type('#password', CLIENT_NEW_PW2);
    await client.page.click('#btn-connect');
    await new Promise((r) => setTimeout(r, 800));
    const afterExternalReturn = client.page.url();
    assert(!afterExternalReturn.includes('evil-attacker.example.com'), 'return= externe JAMAIS suivi -- ECHEC SECURITE si faux (' + afterExternalReturn + ')');
    assert(afterExternalReturn.includes('client-espace.html'), 'retombe sur client-espace.html par défaut (' + afterExternalReturn + ')');

    // ═══ [18/20] Zéro secret public ═══
    console.log('\n== [18/20] Aucun secret dans les fichiers publics (scan statique de docs/) ==');
    const docsDir = path.join(REPO_ROOT, 'docs');
    const secretPattern = /re_[a-zA-Z0-9]{10,}|whsec_[a-zA-Z0-9]{10,}|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+['"]|service_role.{0,20}eyJ/i;
    let secretHit = null;
    (function walk(dir) {
      if (secretHit) return;
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!/\.(html|js|css)$/i.test(entry)) continue;
        const content = readFileSync(full, 'utf8');
        if (secretPattern.test(content)) { secretHit = full; break; }
      }
    })(docsDir);
    assert(!secretHit, 'aucun secret Auth/service_role codé en dur dans docs/ (scan réel, ' + (secretHit || 'aucune correspondance') + ')');

    // ═══ [19/20] Mobile 390px ═══
    // Pages FRAÎCHES et jetables (pas patron.page/client.page/employe.page,
    // vivantes et abondamment naviguées depuis le [1/20]/[11/20] -- un
    // formulaire de connexion se teste hors session, un contexte long-vécu
    // n'apporte rien ici et s'est révélé fragile après une longue suite de
    // navigations dans le même onglet). Fermées juste après usage.
    console.log('\n== [19/20] Mobile 390px -- connexion.html / client-connexion.html / employe-connexion.html ==');
    const mobileChecks = [
      { url: 'connexion.html', label: 'connexion.html' },
      { url: 'client-connexion.html', label: 'client-connexion.html' },
      { url: 'employe-connexion.html', label: 'employe-connexion.html' },
    ];
    for (const { url, label } of mobileChecks) {
      const mobilePage = await newRolePage(browser);
      await mobilePage.page.setViewport({ width: 390, height: 844 });
      await mobilePage.page.goto(`http://localhost:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
      await mobilePage.page.waitForSelector('#btn-connect');
      const state = await mobilePage.page.evaluate(() => ({
        btnVisible: !!document.getElementById('btn-connect').offsetParent,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      }));
      assert(state.btnVisible && !state.hScroll, label + ' utilisable à 390px, aucun scroll horizontal');
      await mobilePage.ctx.close();
    }

    // ═══ [20/20] Zéro erreur console ═══
    console.log('\n== [20/20] Zéro erreur console sur l\'ensemble des parcours ==');
    assert(patron.consoleErrors.length === 0, 'zéro erreur console — patron (' + JSON.stringify(patron.consoleErrors) + ')');
    assert(client.consoleErrors.length === 0, 'zéro erreur console — client (' + JSON.stringify(client.consoleErrors) + ')');
    assert(employe.consoleErrors.length === 0, 'zéro erreur console — employé (' + JSON.stringify(employe.consoleErrors) + ')');
    assert(patronB.consoleErrors.length === 0, 'zéro erreur console — patron B (' + JSON.stringify(patronB.consoleErrors) + ')');

  } finally {
    psql(`
      delete from client_accounts where email like 'qaaa-%';
      delete from employe_accounts where email like 'qaaa-%';
      delete from seba_state where account like 'qaaa-%';
      delete from auth.users where email like 'qaaa-%';
    `);
    await patron.ctx.close(); await client.ctx.close(); await employe.ctx.close(); await patronB.ctx.close();
    await browser.close().catch(() => {});
    await server.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
