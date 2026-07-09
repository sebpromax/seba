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
const styleWrites = [];
function mockDomStyleWriter(targetId, property, value) {
  styleWrites.push({ targetId, property, value });
}
let sidebarToggled = 0;
function mockToggleSidebar() { sidebarToggled++; }

const controller = new UIController({ domWriter: mockDomWriter, domStyleWriter: mockDomStyleWriter, toggleSidebar: mockToggleSidebar });

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

  // 7. renderTelemetry() — guard : donnees absentes/invalides ne doivent
  // rien ecrire (DOM existant preserve) et doivent avertir proprement.
  const writesBefore = writes.length;
  controller.renderTelemetry(null);
  controller.renderTelemetry('pas un objet');
  controller.renderTelemetry({});
  assert.strictEqual(writes.length, writesBefore, 'des donnees invalides ne doivent produire aucune ecriture DOM');
  assert.strictEqual(controller.latestTelemetry, null, 'des donnees invalides ne doivent pas remplacer latestTelemetry');

  // 8. renderTelemetry() — volet statique : seul le champ reellement fourni
  // est ecrit (serenityLabel -> focus-score-lbl), les champs absents
  // (serenityScore, checklist) sont ignores individuellement, pas d'erreur.
  controller.renderTelemetry({ caTotal: 500, serenityLabel: 'Serein' });
  const lblWriteA = writes.find((w) => w.targetId === 'focus-score-lbl');
  assert.ok(lblWriteA, 'serenityLabel present doit ecrire sur focus-score-lbl');
  assert.strictEqual(lblWriteA.html, 'Serein');
  assert.strictEqual(controller.latestTelemetry.caTotal, 500, 'latestTelemetry doit exposer les agregats recus');
  assert.ok(!writes.some((w) => w.targetId === 'focus-score-num'), 'un champ absent de data (serenityScore) ne doit jamais ecrire un element');

  // 9. renderTelemetry() — facturesRetard ne doit JAMAIS ecrire sur
  // notif-badge : cet id DOM est deja possede par renderNotifPanel(ctx)
  // (dashboard.html), sur un concept metier different (creances/relance,
  // pas les factures status='retard' de seba_db) — voir le commentaire de
  // STATIC_TELEMETRY_FIELDS. Un champ texte malveillant reste echappe
  // (defense systematique).
  controller.renderTelemetry({ facturesRetard: 15, serenityLabel: '<b>Tendu</b>' });
  assert.ok(!writes.some((w) => w.targetId === 'notif-badge'), 'facturesRetard ne doit jamais ecrire sur notif-badge (concept metier different, voir Sequence 4/4)');
  const lblWrite = writes.filter((w) => w.targetId === 'focus-score-lbl').at(-1);
  assert.ok(lblWrite && !lblWrite.html.includes('<b>'), 'une valeur malveillante dans un champ texte doit rester echappee');

  // 10. renderTelemetry() — volet CSS (wc-bar) : passe par domStyleWriter,
  // jamais par esc()/innerHTML (ce n'est pas un contexte HTML), et reste clampe.
  controller.renderTelemetry({ facturesRetard: 0, checklistPct: 150 });
  const styleWrite = styleWrites.find((w) => w.targetId === 'wc-bar');
  assert.ok(styleWrite, 'checklistPct present doit ecrire sur wc-bar via domStyleWriter');
  assert.strictEqual(styleWrite.value, '100%', 'un pourcentage hors bornes doit etre clampe a 100%');

  console.log('OK — ' + writes.length + ' ecritures DOM simulees, rendu identique, resilience DATA_ERROR, UI_ACTION(toggleSidebar) et renderTelemetry (guards + volet statique/CSS, notif-badge preserve) confirmes.');
}

run().catch((e) => {
  console.error('ECHEC test-ui-controller :', e.message);
  process.exitCode = 1;
});
