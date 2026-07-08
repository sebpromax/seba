/**
 * Test de non-regression — PHASE 1 migration auth-module.js.
 * Verifie que l'EventBus recoit bien les evenements attendus pour un cycle
 * complet signUp -> getSession -> signOut, en mode demo (pas de config
 * Supabase : evite toute dependance reseau/CDN pour un test rapide et
 * deterministe, cf. ARCHITECTURE-V2.md section 7 - node:test natif).
 *
 * localStorage n'existe pas nativement dans ce Node (pas de flag
 * --experimental-webstorage active ici) : les try/catch deja presents
 * dans AuthModule (calques sur docs/auth.js) l'avalent silencieusement,
 * ce qui rend ce script executable tel quel avec `node docs/src/test-auth-migration.js`.
 *
 * Execution : node docs/src/test-auth-migration.js
 */
import assert from 'node:assert';
import { AuthModule, AUTH_EVENTS } from './modules/auth-module.js';
import { eventBus } from './core/event-bus.js';

const received = [];
function record(name) {
  return (data) => received.push({ name, data });
}
eventBus.subscribe(AUTH_EVENTS.SUCCESS, record(AUTH_EVENTS.SUCCESS));
eventBus.subscribe(AUTH_EVENTS.FAILED, record(AUTH_EVENTS.FAILED));
eventBus.subscribe(AUTH_EVENTS.SIGNED_OUT, record(AUTH_EVENTS.SIGNED_OUT));

const auth = new AuthModule(); // pas de config => mode demo

async function run() {
  // 1. signUp avec un email invalide doit publier AUTH_FAILED, pas AUTH_SUCCESS
  const badSignUp = await auth.signUp('pas-un-email', 'motdepasse123');
  assert.strictEqual(badSignUp.ok, false, 'signUp doit rejeter un email invalide');
  assert.strictEqual(received.at(-1).name, AUTH_EVENTS.FAILED, 'un email invalide doit publier AUTH_FAILED');

  // 2. signUp valide (mode demo) doit publier AUTH_SUCCESS avec l'email
  const goodSignUp = await auth.signUp('fondateur@seba.app', 'motdepasse123');
  assert.strictEqual(goodSignUp.ok, true, 'signUp valide doit reussir en mode demo');
  const successEvent = received.at(-1);
  assert.strictEqual(successEvent.name, AUTH_EVENTS.SUCCESS, 'signUp valide doit publier AUTH_SUCCESS');
  assert.strictEqual(successEvent.data.email, 'fondateur@seba.app', 'le payload doit porter le bon email');
  assert.strictEqual(successEvent.data.demo, true, 'le payload doit indiquer le mode demo');

  // 3. getSession ne doit publier aucun evenement (lecture seule)
  const beforeCount = received.length;
  await auth.getSession();
  assert.strictEqual(received.length, beforeCount, 'getSession ne doit publier aucun evenement');

  // 4. signOut doit publier AUTH_SIGNED_OUT
  const out = await auth.signOut();
  assert.strictEqual(out.ok, true, 'signOut doit reussir en mode demo');
  assert.strictEqual(received.at(-1).name, AUTH_EVENTS.SIGNED_OUT, 'signOut doit publier AUTH_SIGNED_OUT');

  // 5. unsubscribe doit reellement arreter la reception (verifie le registre de EventBus)
  const handler = record('SHOULD_NOT_APPEAR');
  eventBus.subscribe(AUTH_EVENTS.SUCCESS, handler);
  eventBus.unsubscribe(AUTH_EVENTS.SUCCESS, handler);
  await auth.signUp('autre@seba.app', 'motdepasse123');
  assert.ok(!received.some((r) => r.name === 'SHOULD_NOT_APPEAR'), 'unsubscribe doit empecher toute reception ulterieure');

  console.log('OK — ' + received.length + ' evenements recus, cycle signUp/getSession/signOut conforme.');
}

run().catch((e) => {
  console.error('ECHEC test-auth-migration :', e.message);
  process.exitCode = 1;
});
