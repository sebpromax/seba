// SEBA — QA PHASE 1 UNIQUEMENT : backend d'envoi email des documents
// commerciaux (feature/customer-email-delivery). Teste le VRAI handler
// Edge Function (supabase/functions/send-commercial-document) servi
// localement (supabase functions serve), avec Resend mocké par un
// serveur HTTP local (RESEND_API_URL redirigé, jamais une vraie clé).
//
// Ne rejoue aucun test des chantiers précédents (documents/éditeurs).
// Prérequis : Supabase local démarré, migration 2026-07-28-commercial-
// email-delivery.sql appliquée, et
//   npx supabase@2.109.1 functions serve --no-verify-jwt --env-file <...>
// déjà lancé en arrière-plan (RESEND_API_URL -> ce process, port 8930).
//
// Usage : node scripts/qa-customer-email-delivery-phase1.js

import http from 'node:http';
import { execSync } from 'node:child_process';

const API_URL = 'http://127.0.0.1:54321';
const FUNCTIONS_URL = API_URL + '/functions/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'Test-Synthetic-2026!';
const MOCK_PORT = 8930;

let failures = 0;
function assert(cond, msg) { if (cond) console.log('  OK   -', msg); else { console.error('  FAIL -', msg); failures++; } }
function note(msg) { console.log('  ····  ' + msg); }

function psql(sql) {
  return execSync('docker exec -i supabase_db_seba psql -U postgres -v ON_ERROR_STOP=1 -t -A', { input: sql, encoding: 'utf8' });
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

async function signIn(email) {
  const res = await fetch(API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('signIn failed for ' + email + ': ' + JSON.stringify(json));
  return json.access_token;
}

// ── Mock Resend : compte les appels, décide succès/échec selon le
// destinataire ("fail@" -> erreur fournisseur simulée) -- jamais un vrai
// appel réseau vers api.resend.com. ──
let mockCallCount = 0;
const mockCallsBody = [];
function startMockResend() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      mockCallCount++;
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      mockCallsBody.push(parsed);
      const to = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
      res.setHeader('Content-Type', 'application/json');
      if (to && String(to).startsWith('fail@')) {
        res.writeHead(422);
        res.end(JSON.stringify({ message: 'Invalid recipient domain (mock failure)' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ id: 'mock-msg-' + mockCallCount }));
    });
  });
  // 0.0.0.0, jamais 127.0.0.1 -- l'Edge Function tourne dans le conteneur
  // edge-runtime et atteint ce serveur via host.docker.internal (voir
  // RESEND_API_URL dans l'env file), pas via la boucle locale du conteneur.
  return new Promise((resolve) => server.listen(MOCK_PORT, '0.0.0.0', () => resolve(server)));
}

async function callSend(token, payload) {
  const res = await fetch(FUNCTIONS_URL + '/send-commercial-document', {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: token ? 'Bearer ' + token : '', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log('== [setup 1/3] Comptes synthétiques (2 accounts, patron A/B, client, employé) ==');
  const patronAId = await createOrGetUser('qaced-patron-a@test.seba.invalid');
  const patronBId = await createOrGetUser('qaced-patron-b@test.seba.invalid');
  const clientAId = await createOrGetUser('qaced-client-a@test.seba.invalid');
  const employeAId = await createOrGetUser('qaced-employe-a@test.seba.invalid');
  for (const id of [patronAId, patronBId, clientAId, employeAId]) {
    await fetch(API_URL + '/auth/v1/admin/users/' + id, {
      method: 'PUT',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    });
  }
  console.log('   patron A=' + patronAId + ' | patron B=' + patronBId + ' | client A=' + clientAId + ' | employe A=' + employeAId);

  console.log('== [setup 2/3] seba_state (account A: devis/facture brouillons+valides, paiement réel ; account B: devis isolé) ==');
  psql(`
    insert into seba_state (account, user_id, state) values (
      'qa-ced-a', '${patronAId}',
      '{"v":1,"clients":[{"id":"cli_a1","prenom":"Client","nom":"CedA","email":"client-a@test.seba.invalid","contact":"client-a@test.seba.invalid","adresse":"1 rue CedA"}],
        "devis":[
          {"id":"dev_signed","num":"DEV-2026-CED1","status":"signe","clientId":"cli_a1","clientName":"Client CedA"},
          {"id":"dev_draft","num":null,"status":"brouillon","clientId":"cli_a1","clientName":"Client CedA"}
        ],
        "factures":[
          {"id":"fac_issued","num":"FAC-2026-CED1","status":"issued","clientId":"cli_a1","clientName":"Client CedA","payments":[{"id":"pay_1","amount":100,"mode":"virement","date":"2026-07-27"}]},
          {"id":"fac_draft","num":null,"status":"draft","clientId":"cli_a1","clientName":"Client CedA","payments":[]}
        ],
        "interventions":[],"employes":[{"id":"emp_a1","prenom":"Emp","nom":"CedA"}],"journal":[],"custom_services":[],
        "contrats":[],"messages":[],"clientRequests":[],"entreprise":{"nom":"QA CED SARL"},"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

    insert into seba_state (account, user_id, state) values (
      'qa-ced-b', '${patronBId}',
      '{"v":1,"clients":[{"id":"cli_b1","prenom":"Client","nom":"CedB","email":"client-b@test.seba.invalid","contact":"client-b@test.seba.invalid","adresse":"1 rue CedB"}],
        "devis":[{"id":"dev_b1","num":"DEV-2026-CEDB1","status":"signe","clientId":"cli_b1","clientName":"Client CedB"}],
        "factures":[],"interventions":[],"employes":[],"journal":[],"custom_services":[],
        "contrats":[],"messages":[],"clientRequests":[],"entreprise":{"nom":"QA CED B SARL"},"seq":{"devis":0,"facture":0,"contrat":0,"recu":0}}'::jsonb
    ) on conflict (account) do update set state = excluded.state, user_id = excluded.user_id;

    delete from client_accounts where client_user_id = '${clientAId}';
    insert into client_accounts (client_user_id, account, client_id, email) values ('${clientAId}', 'qa-ced-a', 'cli_a1', 'qaced-client-a@test.seba.invalid');
    delete from employe_accounts where employe_user_id = '${employeAId}';
    insert into employe_accounts (employe_user_id, account, employe_id, email) values ('${employeAId}', 'qa-ced-a', 'emp_a1', 'qaced-employe-a@test.seba.invalid');

    delete from commercial_email_deliveries where account in ('qa-ced-a','qa-ced-b');
  `);
  console.log('   OK — fixtures créées.');

  console.log('== [setup 3/3] Mock Resend (port ' + MOCK_PORT + ') + connexions réelles ==');
  const mockServer = await startMockResend();
  const tokenA = await signIn('qaced-patron-a@test.seba.invalid');
  const tokenB = await signIn('qaced-patron-b@test.seba.invalid');
  const tokenClient = await signIn('qaced-client-a@test.seba.invalid');
  const tokenEmploye = await signIn('qaced-employe-a@test.seba.invalid');
  console.log('   OK — 4 sessions réelles + mock Resend démarré.');

  try {
    const basePayload = { account: 'qa-ced-a', clientId: 'cli_a1', documentType: 'quote', documentId: 'dev_signed', recipient: 'ok@test.seba.invalid', subject: 'Test', message: 'Bonjour', attemptId: 'attempt-1' };

    console.log('\n== [1/30] Patron valide autorisé (envoi réussi de bout en bout) ==');
    const r1 = await callSend(tokenA, basePayload);
    assert(r1.status === 200 && r1.json.ok === true && r1.json.status === 'sent', 'patron valide -> envoi réussi (' + JSON.stringify(r1.json) + ')');

    console.log('\n== [2/30] Requête sans JWT refusée ==');
    const r2 = await callSend(null, basePayload);
    assert(r2.status === 401 && r2.json.ok === false, 'sans JWT -> 401 (' + r2.status + ')');

    console.log('\n== [3/30] Mauvais account refusé ==');
    const r3 = await callSend(tokenA, { ...basePayload, account: 'qa-ced-b', attemptId: 'attempt-3' });
    assert(r3.status === 403 && r3.json.code === 'forbidden_account', 'patron A sur account B -> 403 forbidden_account (' + JSON.stringify(r3.json) + ')');

    console.log('\n== [4/30] Client authentifié refusé ==');
    const r4 = await callSend(tokenClient, { ...basePayload, attemptId: 'attempt-4' });
    assert(r4.status === 403 && r4.json.code === 'forbidden_role', 'client authentifié -> 403 forbidden_role (' + JSON.stringify(r4.json) + ')');

    console.log('\n== [5/30] Employé authentifié refusé ==');
    const r5 = await callSend(tokenEmploye, { ...basePayload, attemptId: 'attempt-5' });
    assert(r5.status === 403 && r5.json.code === 'forbidden_role', 'employé authentifié -> 403 forbidden_role (' + JSON.stringify(r5.json) + ')');

    console.log('\n== [6/30] Destinataire invalide refusé ==');
    const r6 = await callSend(tokenA, { ...basePayload, recipient: 'not-an-email', attemptId: 'attempt-6' });
    assert(r6.status === 400 && r6.json.code === 'invalid_recipient', 'destinataire invalide -> 400 (' + JSON.stringify(r6.json) + ')');

    console.log('\n== [7/30] CC invalide refusé ==');
    const r7 = await callSend(tokenA, { ...basePayload, cc: 'not-an-email', attemptId: 'attempt-7' });
    assert(r7.status === 400 && r7.json.code === 'invalid_cc', 'CC invalide -> 400 (' + JSON.stringify(r7.json) + ')');

    console.log('\n== [8/30] documentType invalide refusé ==');
    const r8 = await callSend(tokenA, { ...basePayload, documentType: 'bogus', attemptId: 'attempt-8' });
    assert(r8.status === 400 && r8.json.code === 'bad_request', 'documentType invalide -> 400 (' + JSON.stringify(r8.json) + ')');

    console.log('\n== [9/30] Devis brouillon refusé ==');
    const r9 = await callSend(tokenA, { ...basePayload, documentId: 'dev_draft', attemptId: 'attempt-9' });
    assert(r9.status === 422 && r9.json.code === 'draft_not_shareable', 'devis brouillon -> 422 draft_not_shareable (' + JSON.stringify(r9.json) + ')');

    console.log('\n== [10/30] Facture brouillon refusée ==');
    const r10 = await callSend(tokenA, { ...basePayload, documentType: 'invoice', documentId: 'fac_draft', attemptId: 'attempt-10' });
    assert(r10.status === 422 && r10.json.code === 'draft_not_shareable', 'facture brouillon -> 422 draft_not_shareable (' + JSON.stringify(r10.json) + ')');

    console.log('\n== [11/30] Reçu sans paiement refusé ==');
    const r11 = await callSend(tokenA, { ...basePayload, documentType: 'receipt', documentId: 'pay_inexistant', attemptId: 'attempt-11' });
    assert(r11.status === 404 && r11.json.code === 'payment_not_found', 'reçu sans paiement -> 404 payment_not_found (' + JSON.stringify(r11.json) + ')');

    console.log('\n== [12/30] Document d\'un autre client refusé ==');
    const r12 = await callSend(tokenA, { ...basePayload, clientId: 'cli_inexistant', attemptId: 'attempt-12' });
    assert(r12.status === 404 && r12.json.code === 'client_not_found', 'client inexistant -> 404 (' + JSON.stringify(r12.json) + ')');

    console.log('\n== [13/30] Document d\'un autre account refusé ==');
    const r13 = await callSend(tokenA, { ...basePayload, documentId: 'dev_b1', attemptId: 'attempt-13' });
    assert(r13.status === 404 && r13.json.code === 'document_not_found', 'devis d\'un autre account -> 404 document_not_found (' + JSON.stringify(r13.json) + ')');

    console.log('\n== [14/30 15/30 16/30] Liens devis/facture/reçu corrects ==');
    const rQuote = await callSend(tokenA, { ...basePayload, recipient: 'ok2@test.seba.invalid', attemptId: 'attempt-14' });
    assert(rQuote.json.documentLink && rQuote.json.documentLink.includes('doc=quote') && rQuote.json.documentLink.includes('id=dev_signed'), 'lien devis correct (' + rQuote.json.documentLink + ')');
    const rInvoice = await callSend(tokenA, { ...basePayload, documentType: 'invoice', documentId: 'fac_issued', recipient: 'ok3@test.seba.invalid', attemptId: 'attempt-15' });
    assert(rInvoice.json.documentLink && rInvoice.json.documentLink.includes('doc=invoice') && rInvoice.json.documentLink.includes('id=fac_issued'), 'lien facture correct (' + rInvoice.json.documentLink + ')');
    const rReceipt = await callSend(tokenA, { ...basePayload, documentType: 'receipt', documentId: 'pay_1', recipient: 'ok4@test.seba.invalid', attemptId: 'attempt-16' });
    assert(rReceipt.json.documentLink && rReceipt.json.documentLink.includes('doc=receipt') && rReceipt.json.documentLink.includes('invoiceId=fac_issued') && rReceipt.json.documentLink.includes('paymentId=pay_1'), 'lien reçu correct (' + rReceipt.json.documentLink + ')');

    console.log('\n== [17/30 18/30] Lien sans montant, sans donnée financière ==');
    const linkUrl = new URL(rReceipt.json.documentLink);
    const linkParamKeys = Array.from(linkUrl.searchParams.keys()).sort();
    assert(!/\d{2,}[,.]?\d*\s*(€|EUR)/i.test(rReceipt.json.documentLink), 'lien sans montant (' + rReceipt.json.documentLink + ')');
    assert(JSON.stringify(linkParamKeys) === JSON.stringify(['doc', 'invoiceId', 'paymentId']), 'lien sans donnée financière -- uniquement doc/invoiceId/paymentId (' + linkParamKeys.join(',') + ')');

    console.log('\n== [19/30] Premier envoi appelle Resend une fois ==');
    const before19 = mockCallCount;
    await callSend(tokenA, { ...basePayload, recipient: 'ok5@test.seba.invalid', attemptId: 'attempt-19' });
    assert(mockCallCount === before19 + 1, 'premier envoi -> 1 appel Resend (avant=' + before19 + ' après=' + mockCallCount + ')');

    console.log('\n== [20/30] Retry même attemptId n\'appelle pas Resend une seconde fois ==');
    const before20 = mockCallCount;
    const r20 = await callSend(tokenA, { ...basePayload, recipient: 'ok5@test.seba.invalid', attemptId: 'attempt-19' });
    assert(mockCallCount === before20 && r20.json.reused === true, 'retry même attemptId -> 0 nouvel appel Resend, reused=true (' + JSON.stringify(r20.json) + ')');

    console.log('\n== [21/30] Double appel concurrent ne produit qu\'un envoi ==');
    const before21 = mockCallCount;
    const [c1, c2] = await Promise.all([
      callSend(tokenA, { ...basePayload, recipient: 'ok6@test.seba.invalid', attemptId: 'attempt-21' }),
      callSend(tokenA, { ...basePayload, recipient: 'ok6@test.seba.invalid', attemptId: 'attempt-21' }),
    ]);
    assert(mockCallCount === before21 + 1, 'double appel concurrent (même attemptId) -> exactement 1 appel Resend (avant=' + before21 + ' après=' + mockCallCount + ')');
    assert((c1.json.ok && c2.json.ok), 'les deux appels concurrents renvoient un résultat cohérent (jamais une erreur inattendue)');

    console.log('\n== [22/30] Nouvel attemptId autorise un renvoi ==');
    const before22 = mockCallCount;
    const r22 = await callSend(tokenA, { ...basePayload, recipient: 'ok6@test.seba.invalid', attemptId: 'attempt-22-renvoi' });
    assert(mockCallCount === before22 + 1 && r22.json.ok === true && r22.json.reused !== true, 'nouvel attemptId -> nouvel appel Resend réel (' + JSON.stringify(r22.json) + ')');

    console.log('\n== [23/30 28/30] Succès Resend -> status sent + provider_message_id conservé ==');
    const dbRow23 = psql(`select status, provider_message_id from commercial_email_deliveries where account='qa-ced-a' and document_id='dev_signed' and recipient='ok5@test.seba.invalid' order by created_at desc limit 1;`).trim();
    const [status23, msgId23] = dbRow23.split('|');
    assert(status23 === 'sent', 'statut réellement persisté en base : sent (' + status23 + ')');
    assert(msgId23 && msgId23.startsWith('mock-msg-'), 'provider_message_id réel du mock conservé en base (' + msgId23 + ')');

    console.log('\n== [24/30 25/30] Erreur Resend -> status failed, raison conservée ==');
    const before24 = mockCallCount;
    const r24 = await callSend(tokenA, { ...basePayload, recipient: 'fail@test.seba.invalid', attemptId: 'attempt-24' });
    assert(mockCallCount === before24 + 1 && r24.status === 502 && r24.json.ok === false, 'erreur fournisseur -> réponse ok:false, HTTP 502 (' + JSON.stringify(r24.json) + ')');
    const dbRow24 = psql(`select status, failure_reason from commercial_email_deliveries where account='qa-ced-a' and recipient='fail@test.seba.invalid' order by created_at desc limit 1;`).trim();
    const [status24, reason24] = dbRow24.split('|');
    assert(status24 === 'failed', 'statut réellement persisté en base : failed (' + status24 + ')');
    assert(!!reason24 && reason24.trim().length > 0, 'raison d\'échec fournisseur réellement conservée (' + reason24 + ')');

    console.log('\n== [26/30] Aucune clé secrète dans la réponse ==');
    const allBodies = JSON.stringify([r1, r24, rQuote, rInvoice, rReceipt].map((r) => r.json));
    assert(!allBodies.includes('re_test_fake_key') && !allBodies.includes('whsec_'), 'aucune clé secrète dans les réponses JSON observées');

    console.log('\n== [27/30] Aucune clé secrète dans les logs de la fonction (best-effort) ==');
    note('vérifié par relecture du code source (Deno.env.get jamais loggé/retourné) -- aucun accès direct aux logs edge-runtime depuis ce script.');

    console.log('\n== [29/30 30/30] Aucun contenu de message ni montant stocké en base (contrainte de schéma) ==');
    const columns = psql(`select string_agg(column_name, ',') from information_schema.columns where table_name = 'commercial_email_deliveries';`).trim();
    // 'provider_message_id' est une colonne mandatée par le contrat (section
    // 11 du chantier) -- un identifiant opaque du fournisseur, jamais le
    // contenu du message envoyé. Exclue explicitement du balayage plutôt
    // que de retirer 'message' du filtre (qui doit rester bloquant sur une
    // vraie colonne 'message'/'email_body').
    const colList = columns.toLowerCase().split(',').filter((col) => col !== 'provider_message_id');
    const forbiddenCols = ['message', 'body', 'amount', 'montant', 'total', 'solde', 'lines', 'address', 'adresse'];
    const leaked = forbiddenCols.filter((c) => colList.some((col) => col.includes(c)));
    assert(leaked.length === 0, 'aucune colonne financière/contenu-message dans commercial_email_deliveries (colonnes réelles : ' + columns + ')');

    console.log('\n== [zéro secret dans les fichiers publics] ==');
    note('vérifié séparément par grep insensible à la casse sur docs/ avant commit (aucun RESEND_API_KEY/EMAIL_FROM/APP_BASE_URL/whsec_ codé en dur).');

  } finally {
    psql(`delete from commercial_email_deliveries where account in ('qa-ced-a','qa-ced-b');`);
    mockServer.close();
  }

  console.log(failures === 0 ? '\nTOUT PASSE' : '\n' + failures + ' ECHEC(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
