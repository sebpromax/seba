/**
 * Test de non-regression - dashboard-init.js (Sequence 3/4, binding TELEMETRY_READY).
 * Node n'a pas de `window`/`document` global : simule le minimum necessaire
 * (getElementById avec compteur d'ecritures, style, comme test-event-bridge.js
 * simule window) - suffisant pour ce test, pas un jsdom complet.
 * Execution : node docs/src/test-dashboard-init.js
 */
import assert from 'node:assert';
import { eventBus } from './core/event-bus.js';
import { TELEMETRY_EVENTS } from './modules/telemetry-module.js';

function makeCountingEl() {
  let html = '';
  let writes = 0;
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; writes++; },
    get writeCount() { return writes; },
    style: {},
    classList: { contains: () => false, toggle: () => {} },
  };
}

const elements = new Map();
function getElementById(id) {
  if (!elements.has(id)) elements.set(id, makeCountingEl());
  return elements.get(id);
}

// import statique impossible ici : les imports sont hoistes avant tout code
// de ce fichier, donc window/document doivent exister AVANT que
// dashboard-init.js soit charge (il touche document des son evaluation :
// new UIController(...), bindTelemetryReady()) - meme raison que
// test-event-bridge.js.
globalThis.window = globalThis;
globalThis.document = {
  getElementById,
  querySelector: () => null,
  body: { style: {} },
};

const { bindTelemetryReady } = await import('./ui/dashboard-init.js');

async function run() {
  // 1. TELEMETRY_READY -> renderTelemetry() -> ecriture DOM reelle, routee
  // par dashboard-init.js jusqu'a UIController (pas juste un log).
  eventBus.publish(TELEMETRY_EVENTS.READY, { facturesRetard: 4 });
  await new Promise((r) => setTimeout(r, 0));
  const badge = getElementById('notif-badge');
  assert.strictEqual(badge.innerHTML, '4', 'TELEMETRY_READY doit router jusqu\'a une ecriture DOM reelle via UIController.renderTelemetry');
  assert.strictEqual(badge.writeCount, 1, 'un seul abonnement actif doit produire une seule ecriture par evenement publie');

  // 2. Anti-fuite memoire : un second appel a bindTelemetryReady() (simule
  // une initialisation repetee) ne doit PAS empiler un second listener -
  // sinon une seule publication produirait 2 ecritures au lieu d'1.
  bindTelemetryReady();
  eventBus.publish(TELEMETRY_EVENTS.READY, { facturesRetard: 6 });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(badge.innerHTML, '6', 'apres un second bindTelemetryReady(), le routage doit toujours fonctionner');
  assert.strictEqual(badge.writeCount, 2, 'un second appel a bindTelemetryReady() doit desabonner le handler precedent, pas en empiler un nouveau (sinon writeCount serait 3)');

  console.log('OK — TELEMETRY_READY route vers UIController.renderTelemetry(), abonnement unique confirme (pas de handler duplique apres re-bind).');
}

run().catch((e) => {
  console.error('ECHEC test-dashboard-init :', e.message);
  process.exitCode = 1;
});
