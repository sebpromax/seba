/**
 * Test de non-regression — UIController.
 * domWriter mocke (enregistre les appels au lieu d'ecrire dans un vrai DOM) :
 * verifie a la fois "le rendu ne change pas" (section 4 du brief, comparaison
 * a l'exact marquage deja en production sur clients.html/equipe.html) et la
 * resilience a DATA_ERROR (toast plutot que crash).
 * Execution : node docs/src/test-ui-controller.js
 */
import assert from 'node:assert';
import { UIController } from './modules/ui-controller.js';
import { eventBus } from './core/event-bus.js';

const writes = [];
function mockDomWriter(targetId, html) {
  writes.push({ targetId, html });
}
let sidebarToggled = 0;
function mockToggleSidebar() { sidebarToggled++; }

new UIController({ domWriter: mockDomWriter, toggleSidebar: mockToggleSidebar });

async function run() {
  // 1. "Le rendu ne change pas" : meme marquage exact que la production
  // (clients.html:274 / equipe.html:315 post-PR#18/#19 : esc(nom) + '<br>Compte de démonstration')
  const html = UIController.renderCompanyFooter({ nom: 'Ménage Express Lyon' });
  assert.strictEqual(html, 'Ménage Express Lyon<br>Compte de démonstration', 'le rendu normal ne doit pas changer visuellement');

  // 2. Donnee malveillante : doit rester echappee, jamais de balise executable
  const malicious = UIController.renderCompanyFooter({ nom: '<img src=x onerror=alert(1)>' });
  assert.ok(!malicious.includes('<img'), 'une balise HTML dans le nom ne doit jamais survivre non echappee');
  assert.ok(malicious.includes('&lt;img'), 'le contenu doit etre echappe, pas supprime');

  // 3. Reaction a DATA_SUCCESS('sebaEntreprise', ...) -> ecrit sur sidebar-footer
  eventBus.publish('DATA_SUCCESS', { key: 'sebaEntreprise', data: { nom: 'Studio Beauté Paris' } });
  await new Promise((r) => setTimeout(r, 0));
  const footerWrite = writes.find((w) => w.targetId === 'sidebar-footer');
  assert.ok(footerWrite, 'DATA_SUCCESS pour sebaEntreprise doit declencher une ecriture sur sidebar-footer');
  assert.strictEqual(footerWrite.html, 'Studio Beauté Paris<br>Compte de démonstration');

  // 4. Resilience : DATA_ERROR doit produire un toast, jamais une exception
  assert.doesNotThrow(() => {
    eventBus.publish('DATA_ERROR', { key: 'seba_db', error: 'JSON corrompu : Unexpected token' });
  }, 'une erreur DataModule ne doit jamais faire planter UIController');
  await new Promise((r) => setTimeout(r, 0));
  const toastWrite = writes.find((w) => w.targetId === 'dash-toast');
  assert.ok(toastWrite, 'DATA_ERROR doit declencher un toast au lieu d\'un crash');
  assert.ok(toastWrite.html.includes('JSON corrompu'), 'le toast doit porter le message d\'erreur (echappe)');

  // 5. UI_ACTION('toggleSidebar') : doit appeler la dependance injectee et
  // marquer ack.handled=true (empeche le bridge de retomber sur le fallback)
  const ack = { handled: false };
  eventBus.publish('UI_ACTION', { action: 'toggleSidebar', args: [], ack });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(sidebarToggled, 1, 'UI_ACTION toggleSidebar doit appeler la dependance toggleSidebar injectee');
  assert.strictEqual(ack.handled, true, 'UIController doit marquer ack.handled=true pour eviter le fallback du bridge');

  // 6. Une action inconnue ne doit jamais etre prise en charge (pas de faux handled)
  const ackUnknown = { handled: false };
  eventBus.publish('UI_ACTION', { action: 'actionInconnue', args: [], ack: ackUnknown });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(ackUnknown.handled, false, 'une action non geree ne doit jamais marquer ack.handled=true');

  console.log('OK — ' + writes.length + ' ecritures DOM simulees, rendu identique, resilience DATA_ERROR et UI_ACTION(toggleSidebar) confirmes.');
}

run().catch((e) => {
  console.error('ECHEC test-ui-controller :', e.message);
  process.exitCode = 1;
});
