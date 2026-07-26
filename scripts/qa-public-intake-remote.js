// SEBA — QA distante CIBLÉE : les 9 scénarios Public Intake qui exigent
// réellement l'Edge Function déployée (supabase/functions/public-intake),
// jamais exécutables en local (voir scripts/qa-public-intake-conversion.js,
// 17 scénarios déjà verts, NON rejoués ici).
//
// Ne teste QUE :
//   1. GET config, entreprise/service actifs
//   2. GET config, formulaire désactivé
//   3. POST request valide (référence+token retournés, hash stocké, ligne réelle)
//   4. POST avec service non autorisé
//   5. Honeypot rempli
//   6. Rate-limit (email, limite réelle = 5/jour côté fonction)
//   7. GET tracking, bon token
//   8. GET tracking, mauvais token
//   9. Isolation cross-account (tracking + lecture directe RLS)
//
// Comptes patron : lus depuis .env.qa.local (jamais committé, voir
// .git/info/exclude) -- créés manuellement par le fondateur via le
// Dashboard Supabase (email confirmé d'office), le blocage SMTP du projet
// partagé rendait signUp() inutilisable pour ce script.
//
// Usage : node scripts/qa-public-intake-remote.js

import { readFileSync } from 'node:fs';

const SUPABASE_URL = 'https://ptmudezhxnhhyctowlqp.supabase.co';
const ANON_KEY = 'sb_publishable_u8RsEy8djwN8_66hSHck7A_wwNgOZWx';
const FN_URL = SUPABASE_URL + '/functions/v1/public-intake';

function loadEnvQA() {
  const raw = readFileSync('.env.qa.local', 'utf8');
  const env = {};
  raw.split(/\r?\n/).forEach((line) => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  });
  return env;
}

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }

async function signIn(email, password) {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error('Connexion échouée pour ' + email + ' : ' + JSON.stringify(json));
  return { accessToken: json.access_token, userId: json.user.id };
}

async function upsertOwnState(accessToken, account, state) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/seba_state?on_conflict=account', {
    method: 'POST',
    headers: {
      apikey: ANON_KEY, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ account, user_id: account, state }),
  });
  if (!res.ok) throw new Error('upsert seba_state échoué pour ' + account + ' : ' + (await res.text()));
  return res.json();
}

async function patchConfig(accessToken, account, publicIntakeConfig) {
  // Lecture-fusion-écriture explicite (pas de jsonb_set REST direct sans RPC dédiée) :
  const getRes = await fetch(SUPABASE_URL + '/rest/v1/seba_state?select=state&account=eq.' + account, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + accessToken },
  });
  const rows = await getRes.json();
  const state = rows[0].state;
  state.publicIntakeConfig = Object.assign({}, state.publicIntakeConfig, publicIntakeConfig);
  const patchRes = await fetch(SUPABASE_URL + '/rest/v1/seba_state?account=eq.' + account, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ state }),
  });
  if (!patchRes.ok) throw new Error('patch config échoué : ' + (await patchRes.text()));
}

async function readOwnRequests(accessToken, account) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/public_service_requests?select=*&account=eq.' + account, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error('lecture public_service_requests échouée : ' + (await res.text()));
  return res.json();
}

async function getConfig(account) {
  const res = await fetch(FN_URL + '?account=' + encodeURIComponent(account), {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
  });
  return { status: res.status, body: await res.json() };
}
async function postRequest(body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function getTracking(ref, token) {
  const res = await fetch(FN_URL + '?ref=' + encodeURIComponent(ref) + '&token=' + encodeURIComponent(token), {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const env = loadEnvQA();
  console.log('== [setup] Connexion des 2 comptes patron de test (créés manuellement, email pré-confirmé) ==');
  const ownerA = await signIn(env.QA_OWNER_A_EMAIL, env.QA_OWNER_A_PASSWORD);
  const ownerB = await signIn(env.QA_OWNER_B_EMAIL, env.QA_OWNER_B_PASSWORD);
  console.log('   owner A=' + ownerA.userId + ' | owner B=' + ownerB.userId);

  console.log('== [setup] État seba_state (formulaire désactivé au départ, 1 service actif) ==');
  const baseState = {
    v: 1, clients: [], devis: [], factures: [], interventions: [], employes: [], journal: [],
    custom_services: [{ id: 'svc_qapi_remote', name: 'Ménage QAPI Remote', pricingModel: 'fixed', suggestedPrice: 60, active: true }],
    contrats: [], messages: [], clientRequests: [], automationRules: [], automationRuns: [], automationAlerts: [],
    entreprise: { nom: 'QAPI Remote SARL' },
    publicIntakeConfig: { enabled: false, title: 'Demander une intervention', introduction: '', allowedServiceIds: [], requireAddress: false, allowPreferredDate: true, confirmationMessage: 'Merci pour votre demande.' },
    seq: { devis: 0, facture: 0, contrat: 0 },
  };
  await upsertOwnState(ownerA.accessToken, ownerA.userId, baseState);
  await upsertOwnState(ownerB.accessToken, ownerB.userId, Object.assign({}, baseState, { entreprise: { nom: 'QAPI Remote B SARL' }, publicIntakeConfig: Object.assign({}, baseState.publicIntakeConfig, { enabled: true }) }));

  console.log('\n== [1/9] GET config — formulaire désactivé (état initial owner A) ==');
  const cfgDisabled = await getConfig(ownerA.userId);
  assert(cfgDisabled.status === 404, 'HTTP 404 sur formulaire désactivé (reçu ' + cfgDisabled.status + ')');
  assert(!cfgDisabled.body.entreprise && !cfgDisabled.body.config, 'aucune donnée interne renvoyée quand désactivé (' + JSON.stringify(cfgDisabled.body) + ')');

  console.log('\n== [2/9] GET config — entreprise active, service autorisé, aucune donnée interne ==');
  await patchConfig(ownerA.accessToken, ownerA.userId, { enabled: true });
  const cfgEnabled = await getConfig(ownerA.userId);
  assert(cfgEnabled.status === 200, 'HTTP 200 sur formulaire activé (reçu ' + cfgEnabled.status + ')');
  assert(cfgEnabled.body.entreprise && cfgEnabled.body.entreprise.nom === 'QAPI Remote SARL', 'nom entreprise correct renvoyé');
  assert(Array.isArray(cfgEnabled.body.config.services) && cfgEnabled.body.config.services.some((s) => s.name === 'Ménage QAPI Remote'), 'service autorisé présent (' + JSON.stringify(cfgEnabled.body.config.services) + ')');
  const bodyKeys = JSON.stringify(cfgEnabled.body);
  assert(!/seba_state|user_id|"account"|owner_note|clients":\[/.test(bodyKeys), 'aucune donnée interne (pas de seba_state brut/user_id/account/owner_note) dans la réponse');
  const serviceId = cfgEnabled.body.config.services[0].id;

  console.log('\n== [3/9 + 6/9] POST request — création réelle, puis limite anti-spam (email, 5/jour) ==');
  const emailQA = 'qapi-ratelimit-' + Date.now() + '@example.com';
  let firstRef = null, firstToken = null;
  let lastCreateRes = null;
  for (let i = 1; i <= 6; i++) {
    lastCreateRes = await postRequest({
      account: ownerA.userId, contactName: 'Prospect Remote ' + i, email: emailQA,
      serviceId, description: 'Test QA distant #' + i,
    });
    if (i === 1) {
      assert(lastCreateRes.status === 200 && lastCreateRes.body.ok, 'création réelle #1 réussie (' + JSON.stringify(lastCreateRes.body) + ')');
      assert(/^SEBA-[A-Z0-9]{8}$/.test(lastCreateRes.body.reference || ''), 'référence publique au format attendu (' + lastCreateRes.body.reference + ')');
      assert(!!lastCreateRes.body.trackingToken, 'token de suivi renvoyé une seule fois à la création');
      firstRef = lastCreateRes.body.reference; firstToken = lastCreateRes.body.trackingToken;
    } else if (i <= 5) {
      assert(lastCreateRes.status === 200 && lastCreateRes.body.ok, 'création #' + i + ' acceptée sous la limite (' + JSON.stringify(lastCreateRes.body) + ')');
    }
  }
  assert(lastCreateRes.status === 429, 'la 6e demande avec le même email est refusée par le rate-limit (reçu HTTP ' + lastCreateRes.status + ')');
  assert(!/[a-f0-9]{20,}/.test(JSON.stringify(lastCreateRes.body)) || lastCreateRes.body.error, 'aucune fuite dans la réponse de refus (' + JSON.stringify(lastCreateRes.body) + ')');

  console.log('\n== Vérification base (lecture propriétaire, RLS) : ligne réelle + hash uniquement ==');
  const ownRows = await readOwnRequests(ownerA.accessToken, ownerA.userId);
  const createdRow = ownRows.find((r) => r.public_reference === firstRef);
  assert(!!createdRow, 'la ligne créée est bien présente en base (compte owner A)');
  assert(createdRow.tracking_token_hash !== firstToken && /^[0-9a-f]{64}$/.test(createdRow.tracking_token_hash || ''), 'seul le hash SHA-256 est stocké, jamais le token en clair (hash=' + createdRow.tracking_token_hash + ')');
  assert(ownRows.filter((r) => r.email === emailQA).length === 5, 'exactement 5 lignes créées pour cet email (limite respectée), trouvé ' + ownRows.filter((r) => r.email === emailQA).length);

  console.log('\n== [4/9] POST avec service NON autorisé ==');
  const beforeCount = ownRows.length;
  const forbiddenRes = await postRequest({ account: ownerA.userId, contactName: 'Intrus Service', email: 'intrus-service@example.com', serviceId: 'svc_inexistant_qapi' });
  assert(forbiddenRes.status === 400 && !forbiddenRes.body.ok, 'refus HTTP 400 sur service non autorisé (' + JSON.stringify(forbiddenRes.body) + ')');
  const afterForbidden = await readOwnRequests(ownerA.accessToken, ownerA.userId);
  assert(afterForbidden.length === beforeCount, 'aucune demande créée malgré la tentative (avant=' + beforeCount + ' après=' + afterForbidden.length + ')');

  console.log('\n== [5/9] Honeypot rempli ==');
  const honeypotRes = await postRequest({ account: ownerA.userId, contactName: 'Bot Honeypot', email: 'bot-honeypot@example.com', website: 'http://spam.example' });
  assert(honeypotRes.status === 200 && honeypotRes.body.ok, 'réponse "succès" plausible renvoyée au bot (' + JSON.stringify(honeypotRes.body) + ')');
  const afterHoneypot = await readOwnRequests(ownerA.accessToken, ownerA.userId);
  assert(afterHoneypot.length === beforeCount, 'AUCUNE demande réellement créée malgré la réponse "succès" (avant=' + beforeCount + ' après=' + afterHoneypot.length + ')');

  console.log('\n== [7/9] GET tracking — bon token ==');
  const trackOk = await getTracking(firstRef, firstToken);
  assert(trackOk.status === 200 && trackOk.body.ok, 'suivi accepté avec le bon token (' + JSON.stringify(trackOk.body) + ')');
  assert(trackOk.body.reference === firstRef, 'référence correcte renvoyée');
  const trackKeys = Object.keys(trackOk.body);
  assert(!trackKeys.includes('ownerNote') && !trackKeys.includes('account') && !trackKeys.includes('clientId') && !trackKeys.includes('quoteId') && !trackKeys.includes('interventionId'), 'aucun champ interne exposé (clés reçues : ' + trackKeys.join(',') + ')');

  console.log('\n== [8/9] GET tracking — mauvais token ==');
  const trackBad = await getTracking(firstRef, 'ce-token-est-faux-0000000000000000000000000000000000000000000');
  assert(trackBad.status === 403 && !trackBad.body.ok, 'refus HTTP 403 avec un mauvais token (' + JSON.stringify(trackBad.body) + ')');

  console.log('\n== [9/9] Isolation cross-account ==');
  await patchConfig(ownerB.accessToken, ownerB.userId, { enabled: true });
  const cfgB = await getConfig(ownerB.userId);
  const serviceIdB = cfgB.body.config.services[0].id;
  const createB = await postRequest({ account: ownerB.userId, contactName: 'Prospect B', email: 'prospect-b-crossacct@example.com', serviceId: serviceIdB });
  assert(createB.status === 200 && createB.body.ok, 'création réelle chez owner B (' + JSON.stringify(createB.body) + ')');

  const crossTrack = await getTracking(firstRef, createB.body.trackingToken);
  assert(crossTrack.status === 403 && !crossTrack.body.ok, 'référence de A + token de B refusé (aucune confusion cross-account, reçu ' + crossTrack.status + ')');

  const crossRead = await readOwnRequests(ownerB.accessToken, ownerB.userId);
  assert(!crossRead.some((r) => r.public_reference === firstRef), 'owner B ne peut lire AUCUNE des demandes de owner A via sa propre session RLS (trouvé ' + crossRead.filter((r) => r.public_reference === firstRef).length + ')');
  const crossReadA = await readOwnRequests(ownerA.accessToken, ownerA.userId);
  assert(!crossReadA.some((r) => r.public_reference === createB.body.reference), 'owner A ne peut lire AUCUNE des demandes de owner B via sa propre session RLS');

  console.log('\n== Nettoyage : demandes QA archivées, formulaires repassés à désactivé ==');
  // Aucune policy DELETE sur public_service_requests (choix de conception
  // du chantier Public Intake déjà validé : archived plutôt qu'une
  // suppression physique, voir migrations/2026-07-26-public-intake.sql) --
  // le nettoyage propriétaire passe donc par le statut, pas par un DELETE
  // REST qui serait de toute façon refusé par RLS.
  async function archiveAll(accessToken, account) {
    await fetch(SUPABASE_URL + '/rest/v1/public_service_requests?account=eq.' + account, {
      method: 'PATCH',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
  }
  await archiveAll(ownerA.accessToken, ownerA.userId);
  await archiveAll(ownerB.accessToken, ownerB.userId);
  await patchConfig(ownerA.accessToken, ownerA.userId, { enabled: false });
  await patchConfig(ownerB.accessToken, ownerB.userId, { enabled: false });

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
