/**
 * Test de non-regression — DataModule (Data-Core).
 * Storage mocke en memoire (Map) : demontre que le sandboxing par injection
 * de dependance fonctionne reellement (aucun acces a un vrai localStorage,
 * executable tel quel avec `node docs/src/test-data-migration.js`).
 */
import assert from 'node:assert';
import { DataModule, DATA_EVENTS } from './modules/data-module.js';
import { eventBus } from './core/event-bus.js';

/** Mock storage minimal (Map-backed) — l'objet injecte a la place de window.localStorage. */
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _raw: store, // acces direct pour les assertions du test uniquement
  };
}

const received = [];
eventBus.subscribe(DATA_EVENTS.SUCCESS, (d) => received.push({ name: DATA_EVENTS.SUCCESS, ...d }));
eventBus.subscribe(DATA_EVENTS.ERROR, (d) => received.push({ name: DATA_EVENTS.ERROR, ...d }));
eventBus.subscribe(DATA_EVENTS.CLEARED, (d) => received.push({ name: DATA_EVENTS.CLEARED, ...d }));

async function run() {
  const storage = createMockStorage();
  const data = new DataModule({ storage });

  // 1. Persistance d'une donnee complexe (objet imbrique, forme reelle de seba_db)
  const complexPayload = {
    clients: [{ id: 'c1', nom: 'Dupont', devis: [{ id: 'd1', montant: 120 }] }],
    devis: [{ id: 'd1', clientId: 'c1', lignes: [{ label: 'Ménage', prix: 60 }, { label: 'Repassage', prix: 60 }] }],
    factures: [], interventions: [], employes: [],
  };
  const saveResult = await data.save('seba_db', complexPayload);
  assert.strictEqual(saveResult.ok, true, 'save() doit reussir pour un payload seba_db valide');
  const fetchResult = await data.fetch('seba_db');
  assert.strictEqual(fetchResult.ok, true, 'fetch() doit reussir apres un save() valide');
  assert.deepStrictEqual(fetchResult.data, complexPayload, 'la donnee relue doit etre identique (round-trip complet, imbrication comprise)');

  // 2. Comportement face a une donnee corrompue (chaine non-JSON)
  storage._raw.set('sebaEntreprise', '{ceci n est pas du JSON valide');
  const corrupted = await data.fetch('sebaEntreprise');
  assert.strictEqual(corrupted.ok, false, 'fetch() doit echouer proprement sur un JSON corrompu');
  assert.strictEqual(storage._raw.has('sebaEntreprise'), false, 'la cle corrompue doit etre auto-reinitialisee (JSON-GUARD)');
  assert.strictEqual(received.at(-1).name, DATA_EVENTS.ERROR, 'une donnee corrompue doit publier DATA_ERROR');

  // 2b. Cle non enregistree : refusee (garde-fou anti-proliferation, section 5 du brief)
  const unknownKeyResult = await data.save('cle_inconnue_orpheline', { x: 1 });
  assert.strictEqual(unknownKeyResult.ok, false, 'save() doit refuser une cle absente du REGISTRY');

  // 3. Reactivite au signal AUTH_SIGNED_OUT : purge immediate + DATA_CLEARED
  await data.save('sebaEntreprise', { nom: 'Ménage Express Lyon', secteur: 'menage', email: 'contact@example.fr' });
  assert.ok(storage._raw.has('sebaEntreprise'), 'sebaEntreprise doit etre present avant deconnexion');
  eventBus.publish('AUTH_SIGNED_OUT', {});
  await new Promise((r) => setTimeout(r, 0)); // laisse le handler async clearAll() se terminer
  assert.strictEqual(storage._raw.size, 0, 'AUTH_SIGNED_OUT doit purger toutes les cles du registre');
  assert.strictEqual(received.at(-1).name, DATA_EVENTS.CLEARED, 'la purge doit publier DATA_CLEARED');

  console.log('OK — ' + received.length + ' evenements recus, persistance/corruption/purge conformes.');
}

run().catch((e) => {
  console.error('ECHEC test-data-migration :', e.message);
  process.exitCode = 1;
});
