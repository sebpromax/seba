/**
 * Test de non-regression - dashboard-init.js (Sequence 4/4, eveil du Core).
 * Node n'a pas de `window`/`document`/`localStorage` global : simule le
 * minimum necessaire (meme approche que test-event-bridge.js). Storage
 * pre-rempli avec une session demo + un seba_db reel (forme SebaDB), pour
 * verifier la cascade bout-en-bout SANS mocker AuthModule/DataModule/
 * TelemetryModule eux-memes (ils sont deja testes isolement dans
 * test-auth-migration.js/test-data-migration.js/test-telemetry.js) :
 * AuthModule.getSession() -> AUTH_SUCCESS -> DataModule.fetch('seba_db')
 * -> DATA_SUCCESS -> TelemetryModule -> TELEMETRY_READY -> dashboard-init.js
 * -> UIController.renderTelemetry() -> DOM/volet dynamique.
 * Execution : node docs/src/test-dashboard-init.js
 */
import assert from 'node:assert';
import { eventBus } from './core/event-bus.js';
import { TELEMETRY_EVENTS } from './modules/telemetry-module.js';

function makeMockStorage(initial) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

// Meme forme que SebaDB (docs/seba-data.js) sous localStorage['seba_db'],
// avec UNE facture status='retard' - sert a verifier que facturesRetard
// (reel, non nul) n'atterrit jamais sur #notif-badge (voir test 2).
const seededState = {
  clients: [{ id: 'c1', statut: 'actif' }],
  devis: [],
  factures: [{ id: 'f1', status: 'retard', amount: 50 }],
  interventions: [],
  employes: [],
};
const mockStorage = makeMockStorage({
  seba_session_demo: JSON.stringify({ email: 'demo@seba.app', ts: Date.now() }),
  seba_db: JSON.stringify(seededState),
});

const elements = new Map();
function getElementById(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {}, classList: { contains: () => false, toggle: () => {} } });
  return elements.get(id);
}

const cockpitCalls = [];

// import statique impossible ici : les imports sont hoistes avant tout code
// de ce fichier, donc window/document/localStorage doivent exister AVANT
// que dashboard-init.js soit charge (il instancie AuthModule/DataModule/
// TelemetryModule et appelle wakeUpCore() des son evaluation) - meme
// raison que test-event-bridge.js.
globalThis.window = globalThis;
globalThis.localStorage = mockStorage;
globalThis.document = {
  getElementById,
  querySelector: () => null,
  body: { style: {} },
};
globalThis.window._ctx = { fake: true };
globalThis.window.renderCockpitTelemetry = (ctx) => cockpitCalls.push(ctx);

const { bindTelemetryReady } = await import('./ui/dashboard-init.js');

async function run() {
  // 0. wakeUpCore() (AuthModule.getSession() -> AUTH_SUCCESS -> DataModule
  // .fetch -> DATA_SUCCESS -> TelemetryModule -> TELEMETRY_READY) est
  // entierement chainee en microtaches (Promise) : un setTimeout(0) suffit
  // a toutes les vider avant de continuer, quel que soit le nombre de sauts
  // (meme principe deja utilise dans test-telemetry.js).
  await new Promise((r) => setTimeout(r, 0));

  // 1. Activation reelle bout-en-bout : la session demo presente dans le
  // storage mocke doit avoir traverse toute la chaine Auth->Data->Telemetry
  // ->UIController jusqu'au volet dynamique (window.renderCockpitTelemetry),
  // avec le VRAI contexte existant (window._ctx), jamais un contexte fabrique.
  //
  // cockpitCalls.length === 2 (pas 1) pour UNE SEULE session, et c'est une
  // dette reelle DECOUVERTE par cette activation (pas un bug introduit ici) :
  // TelemetryModule ET DataModule reagissent CHACUN independamment a
  // AUTH_SUCCESS et declenchent chacun un fetch('seba_db') -
  // TelemetryModule via #requestRefresh() -> DATA_REQUEST, DataModule via
  // son propre eventBus.subscribe(AUTH_SUCCESS) direct (voir data-module.js
  // "FETCH global des donnees utilisateur"). Resultat mesure : 1 seul
  // DATA_REQUEST publie, mais 2 DATA_SUCCESS(seba_db) et donc 2
  // TELEMETRY_READY pour 1 seule connexion (confirme par un test isole,
  // voir MIGRATION_TELEMETRY_REPORT.md "duplication AUTH_SUCCESS"). Ni
  // TelemetryModule ni DataModule ne sont modifies dans cette PR : chacun
  // est deja teste et valide EN ISOLATION (test-telemetry.js/
  // test-data-migration.js) sur exactement ce comportement individuel -
  // le corriger correctement demande de trancher qui reste proprietaire du
  // "fetch sur connexion", une decision d'architecture separee de
  // l'activation elle-meme. Ce test fige donc la REALITE observee plutot
  // que la valeur ideale, pour que toute correction future de cette
  // duplication fasse volontairement echouer ce test (signal, pas surprise).
  assert.strictEqual(cockpitCalls.length, 2, 'une session demo declenche aujourd\'hui 2 calculs TELEMETRY_READY (duplication connue TelemetryModule/DataModule sur AUTH_SUCCESS, voir MIGRATION_TELEMETRY_REPORT.md) - si ce nombre change, verifier si la duplication a ete corrigee intentionnellement');
  assert.ok(cockpitCalls.every((c) => c === globalThis.window._ctx), 'le volet dynamique doit toujours reutiliser le VRAI window._ctx, jamais un contexte reconstruit a partir des seuls agregats');

  // 2. Regression Sequence 4/4 : seba_db contient une facture status=
  // 'retard' (facturesRetard reel et non nul cote TelemetryModule), mais
  // #notif-badge appartient a renderNotifPanel()/ctx.creances (dashboard.
  // html, concept metier different) - la cascade reelle ne doit jamais
  // l'ecrire (voir STATIC_TELEMETRY_FIELDS dans ui-controller.js).
  assert.ok(!elements.has('notif-badge'), 'facturesRetard reel ne doit jamais ecrire sur notif-badge via la cascade activee (concept metier different)');

  // 3. TELEMETRY_READY -> renderTelemetry() -> ecriture DOM reelle (volet
  // CSS wc-bar, seul champ dote d'une ecriture DOM verifiable sans dependre
  // d'une source de donnees encore fictive) : routage confirme, pas juste
  // un log console.
  eventBus.publish(TELEMETRY_EVENTS.READY, { checklistPct: 40 });
  await new Promise((r) => setTimeout(r, 0));
  const bar = getElementById('wc-bar');
  assert.strictEqual(bar.style.width, '40%', 'TELEMETRY_READY doit router jusqu\'a une ecriture DOM reelle via UIController.renderTelemetry');

  // 4. Anti-fuite memoire : un second appel a bindTelemetryReady() (simule
  // une initialisation repetee) ne doit pas empiler un second listener -
  // sinon le volet dynamique serait declenche 2 fois pour 1 seule
  // publication (verifie via le compteur cockpitCalls, plus fiable qu'une
  // simple comparaison de valeur DOM finale).
  bindTelemetryReady();
  const cockpitCallsBefore = cockpitCalls.length;
  globalThis.window._ctx = { fake: true, tick: 2 };
  eventBus.publish(TELEMETRY_EVENTS.READY, { checklistPct: 60 });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(bar.style.width, '60%', 'apres un second bindTelemetryReady(), le routage doit toujours fonctionner');
  assert.strictEqual(cockpitCalls.length, cockpitCallsBefore + 1, 'un second appel a bindTelemetryReady() doit desabonner le handler precedent, pas en empiler un nouveau');

  console.log('OK — activation complete (AuthModule.getSession -> AUTH_SUCCESS -> DataModule -> DATA_SUCCESS -> TelemetryModule -> TELEMETRY_READY -> UIController) confirmee, notif-badge preserve, abonnement unique.');
}

run().catch((e) => {
  console.error('ECHEC test-dashboard-init :', e.message);
  process.exitCode = 1;
});
