/**
 * Test de non-regression - event-bridge.js (Hybrid Mode, Phase 2).
 * Node n'a pas de `window` global : on le simule via globalThis, comme un
 * navigateur ou window EST le global (suffisant pour ce test, pas un jsdom
 * complet). Execution : node docs/src/test-event-bridge.js
 */
import assert from 'node:assert';
import { eventBus } from './core/event-bus.js';

// import statique impossible ici : les imports sont hoistes avant tout code
// de ce fichier, donc `globalThis.window = globalThis` doit s'executer AVANT
// que event-bridge.js soit charge (il fait `window.handleLegacyClick = ...`
// des son evaluation) - d'ou l'import dynamique, execute a cet endroit precis.
globalThis.window = globalThis;
await import('./ui/event-bridge.js');

async function run() {
  // 1. Regle d'or #3 (ZERO REGRESSION) : si rien n'ecoute UI_ACTION,
  // l'ancienne fonction globale doit etre appelee a l'identique d'avant.
  let legacyCalled = null;
  window.legacyToggle = (a, b) => { legacyCalled = [a, b]; };
  window.handleLegacyClick('legacyToggle', 'x', 'y');
  assert.deepStrictEqual(legacyCalled, ['x', 'y'], 'sans ecouteur UI_ACTION, le fallback doit appeler la fonction globale avec les memes arguments');

  // 2. Si un module prend en charge l'action (ack.handled = true), le
  // fallback ne doit PAS s'executer.
  let legacyCalledAgain = false;
  window.handledElsewhere = () => { legacyCalledAgain = true; };
  eventBus.subscribe('UI_ACTION', ({ action, ack }) => {
    if (action === 'handledElsewhere') ack.handled = true;
  });
  window.handleLegacyClick('handledElsewhere');
  assert.strictEqual(legacyCalledAgain, false, 'si un module marque ack.handled, le fallback ne doit pas s\'executer');

  // 3. Regle d'or #2 (PAS DE PERTE) : action inconnue -> pas d'exception.
  assert.doesNotThrow(() => {
    window.handleLegacyClick('fonctionQuiNexistePas', 1, 2, 3);
  }, 'une action sans module ET sans fonction globale ne doit jamais lancer d\'exception');

  console.log('OK — fallback, prise en charge par un module, et absence totale de fonction sont tous geres sans regression.');
}

run().catch((e) => {
  console.error('ECHEC test-event-bridge :', e.message);
  process.exitCode = 1;
});
