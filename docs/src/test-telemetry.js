/**
 * Test de charge - TelemetryModule.
 * Verifie (1) l'exactitude des agregats sur un flux de donnees connu,
 * (2) le cycle complet AUTH_SUCCESS -> DATA_REQUEST -> DATA_SUCCESS ->
 * TELEMETRY_READY sans jamais toucher localStorage directement, et
 * (3) le comportement sur un volume important de donnees brutes (charge).
 * Execution : node docs/src/test-telemetry.js
 */
import assert from 'node:assert';
import { TelemetryModule } from './modules/telemetry-module.js';
import { eventBus } from './core/event-bus.js';

async function run() {
  // 1. Exactitude sur un jeu de donnees connu
  const state = {
    clients: [
      { id: 'c1', statut: 'actif' }, { id: 'c2', statut: 'actif' }, { id: 'c3', statut: 'attente' },
    ],
    devis: [
      { id: 'd1', status: 'attente' }, { id: 'd2', status: 'accepte' },
    ],
    factures: [
      { id: 'f1', status: 'payee', amount: 120 },
      { id: 'f2', status: 'payee', amount: 80 },
      { id: 'f3', status: 'retard', amount: 45 },
    ],
    interventions: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }, { id: 'i4' }],
    employes: [{ id: 'e1' }],
  };
  const aggregates = TelemetryModule.computeAggregates(state);
  assert.deepStrictEqual(aggregates, {
    caTotal: 200,
    montantEnRetard: 45,
    clientsTotal: 3,
    clientsActifs: 2,
    devisTotal: 2,
    devisAttente: 1,
    facturesTotal: 3,
    facturesRetard: 1,
    interventionsTotal: 4,
    employesTotal: 1,
  }, 'les agregats doivent correspondre exactement au jeu de donnees connu');

  // 2. Cycle complet par evenements, aucun acces localStorage direct
  new TelemetryModule();

  let capturedRequest = null;
  eventBus.subscribe('DATA_REQUEST', (req) => { capturedRequest = req; });
  eventBus.publish('AUTH_SUCCESS', { userId: 'u1' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(capturedRequest, { action: 'FETCH', key: 'seba_db' }, 'AUTH_SUCCESS doit demander un FETCH de seba_db via DataModule, jamais lire localStorage');

  let telemetryReady = null;
  eventBus.subscribe('TELEMETRY_READY', (data) => { telemetryReady = data; });
  // Simule la reponse que DataModule publierait reellement apres le FETCH
  eventBus.publish('DATA_SUCCESS', { key: 'seba_db', data: state });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(telemetryReady, 'DATA_SUCCESS(seba_db) doit declencher TELEMETRY_READY');
  assert.strictEqual(telemetryReady.caTotal, 200, 'TELEMETRY_READY doit porter les bons agregats');

  // Une cle sans rapport ne doit jamais declencher de recalcul
  telemetryReady = null;
  eventBus.publish('DATA_SUCCESS', { key: 'sebaEntreprise', data: { nom: 'Test' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(telemetryReady, null, 'DATA_SUCCESS sur une autre cle ne doit pas recalculer la telemetrie');

  // 3. Test de charge : volume important de donnees brutes
  const bigState = {
    clients: Array.from({ length: 5000 }, (_, i) => ({ id: 'c' + i, statut: i % 3 === 0 ? 'actif' : 'attente' })),
    devis: Array.from({ length: 5000 }, (_, i) => ({ id: 'd' + i, status: i % 4 === 0 ? 'attente' : 'accepte' })),
    factures: Array.from({ length: 5000 }, (_, i) => ({ id: 'f' + i, status: i % 5 === 0 ? 'retard' : 'payee', amount: 10 })),
    interventions: Array.from({ length: 5000 }, (_, i) => ({ id: 'i' + i })),
    employes: Array.from({ length: 200 }, (_, i) => ({ id: 'e' + i })),
  };
  const startedAt = performance.now();
  const bigAggregates = TelemetryModule.computeAggregates(bigState);
  const elapsedMs = performance.now() - startedAt;
  assert.strictEqual(bigAggregates.clientsTotal, 5000, 'le calcul doit rester exact a grande echelle');
  assert.ok(elapsedMs < 500, 'le calcul sur 5000+ enregistrements doit rester rapide (<500ms), obtenu : ' + elapsedMs.toFixed(1) + 'ms');

  console.log('OK — agregats exacts, cycle AUTH_SUCCESS->DATA_REQUEST->DATA_SUCCESS->TELEMETRY_READY confirme, charge (5000 enreg.) en ' + elapsedMs.toFixed(1) + 'ms.');
}

run().catch((e) => {
  console.error('ECHEC test-telemetry :', e.message);
  process.exitCode = 1;
});
