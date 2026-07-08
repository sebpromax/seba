/**
 * @module modules/telemetry-module
 * TelemetryModule — calcule des agregats (CA, compteurs) a partir des
 * donnees metier, sans jamais lire localStorage lui-meme.
 *
 * Ecart assume par rapport au brief, et pourquoi :
 * Le brief demande d'ecouter un evenement 'DATA_UPDATED' — cet evenement
 * n'existe nulle part dans le code reel. DataModule (docs/src/modules/
 * data-module.js, deja livre) publie DATA_SUCCESS a chaque SAVE ou FETCH
 * reussi (voir DATA_EVENTS.SUCCESS). C'est l'evenement reel qui joue le
 * role de "les donnees ont change/sont disponibles" — ce module ecoute
 * DATA_SUCCESS et ne reagit qu'aux mises a jour de la cle 'seba_db' (le
 * blob de donnees metier reel, voir data-module.js REGISTRY), plutot que
 * d'inventer un nom d'evenement qui n'a pas de producteur.
 *
 * Securite (section "Utiliser exclusivement les methodes du DataModule") :
 * ce module n'importe PAS data-module.js (aucun module n'importe un autre
 * module metier directement, meme regle que partout ailleurs dans
 * Seba-Core). Il accede aux donnees exclusivement via le contrat deja
 * publie par DataModule sur l'Event Bus : il publie DATA_REQUEST (FETCH)
 * et attend le DATA_SUCCESS correspondant — c'est "utiliser les methodes
 * du DataModule" a travers son interface publique (l'event bus), jamais
 * un acces direct a window.localStorage.
 */
import { eventBus } from '../core/event-bus.js';

const TELEMETRY_KEY = 'seba_db';

export const TELEMETRY_EVENTS = Object.freeze({
  READY: 'TELEMETRY_READY',
});

export class TelemetryModule {
  constructor() {
    eventBus.subscribe('AUTH_SUCCESS', () => this.#requestRefresh());
    eventBus.subscribe('DATA_SUCCESS', (payload) => this.#onDataSuccess(payload));
  }

  /** Declenche un FETCH via DataModule (jamais un acces localStorage direct). */
  #requestRefresh() {
    eventBus.publish('DATA_REQUEST', { action: 'FETCH', key: TELEMETRY_KEY });
  }

  #onDataSuccess({ key, data }) {
    if (key !== TELEMETRY_KEY || !data) return;
    const aggregates = TelemetryModule.computeAggregates(data);
    eventBus.publish(TELEMETRY_EVENTS.READY, aggregates);
  }

  /**
   * Fonction pure — memes noms de champs que SebaDB.metrics() (docs/seba-data.js)
   * pour rester coherent avec l'existant, mais operant sur un state passe en
   * parametre plutot que sur une fermeture interne (testable sans DOM/reseau).
   * @param {{clients: any[], devis: any[], factures: any[], interventions: any[], employes: any[]}} state
   */
  static computeAggregates(state) {
    const clients = state.clients || [];
    const devis = state.devis || [];
    const factures = state.factures || [];
    const interventions = state.interventions || [];
    const employes = state.employes || [];

    const caTotal = factures.filter((f) => f.status === 'payee').reduce((s, f) => s + (f.amount || 0), 0);
    const facturesRetard = factures.filter((f) => f.status === 'retard');

    return {
      caTotal,
      montantEnRetard: facturesRetard.reduce((s, f) => s + (f.amount || 0), 0),
      clientsTotal: clients.length,
      clientsActifs: clients.filter((c) => c.statut === 'actif').length,
      devisTotal: devis.length,
      devisAttente: devis.filter((d) => d.status === 'attente').length,
      facturesTotal: factures.length,
      facturesRetard: facturesRetard.length,
      interventionsTotal: interventions.length,
      employesTotal: employes.length,
    };
  }
}
