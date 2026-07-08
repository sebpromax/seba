/**
 * @module modules/ui-controller
 * UIController — logique de rendu du dashboard, decouplee du DOM reel.
 * Migration progressive en cours (voir MIGRATION_REPORT.md) : le bouton
 * #hamburger (action 'toggleSidebar') est le premier onclick reellement
 * bascule sur ce module via docs/src/ui/event-bridge.js. Le reste des 27
 * sites de migration-map.json reste en onclick pur jusqu'a migration
 * individuelle (un commit atomique par bouton).
 *
 * Decisions volontaires, et pourquoi :
 *
 * 1. SANDBOXING DOM : ce module ne touche jamais document/innerHTML
 *    directement. Les methodes de rendu (render*) sont des fonctions PURES
 *    qui prennent des donnees et retournent une chaine HTML deja echappee
 *    (section 3 "DATA-VIEW" du brief). L'ecriture reelle dans le DOM
 *    (element.innerHTML = ...) est deleguee a un `domWriter` injecte au
 *    constructeur — jamais appelee ici. Ca permet de tester 100% de la
 *    logique de rendu sous Node, sans jsdom, exactement comme storage l'a
 *    ete pour DataModule.
 * 2. Pas d'import de auth-module.js ni de data-module.js : ce module ne
 *    reagit qu'aux NOMS d'evenements deja publies sur le bus (DATA_SUCCESS,
 *    DATA_ERROR, AUTH_SUCCESS), jamais par import croise de code metier
 *    (meme regle que data-module.js).
 * 3. Toute donnee textuelle d'origine utilisateur (nom d'entreprise, message
 *    d'erreur pouvant contenir une valeur utilisateur echouee) passe par
 *    esc() avant d'etre assemblee en HTML — aucune exception.
 */
import { eventBus } from '../core/event-bus.js';
import { esc } from '../core/esc.js';

export class UIController {
  #domWriter;
  #toggleSidebar;

  /**
   * @param {{ domWriter: (targetId: string, html: string) => void, toggleSidebar?: () => void }} deps
   * `toggleSidebar` est optionnel et injecte (meme sandboxing que domWriter) :
   * c'est la logique DOM reelle de bascule du menu mobile, fournie par
   * dashboard-init.js (seul fichier autorise a toucher document). Sans elle,
   * l'action 'toggleSidebar' de UI_ACTION reste non geree et retombe sur le
   * fallback window.toggleSidebar() du bridge — zero regression meme si ce
   * module est instancie sans cette dependance (tests, pages sans sidebar...).
   */
  constructor({ domWriter, toggleSidebar } = {}) {
    if (typeof domWriter !== 'function') {
      throw new Error('UIController requiert un domWriter injecte (targetId, html) => void — voir sandboxing.');
    }
    this.#domWriter = domWriter;
    this.#toggleSidebar = typeof toggleSidebar === 'function' ? toggleSidebar : null;

    eventBus.subscribe('DATA_SUCCESS', (payload) => this.#onDataSuccess(payload));
    eventBus.subscribe('DATA_ERROR', (payload) => this.#onDataError(payload));
    eventBus.subscribe('AUTH_SUCCESS', () => this.#onAuthSuccess());
    eventBus.subscribe('UI_ACTION', (payload) => this.#onUiAction(payload));
  }

  /**
   * Rendu du pied de sidebar (nom d'entreprise) — reproduit A L'IDENTIQUE
   * le marquage deja en production sur clients.html/equipe.html
   * (voir AUDIT-RISQUES.md section 3.1 et les PR #18/#19 qui l'ont corrige),
   * pour que ce module puisse un jour remplacer ce code sans changer le
   * rendu visuel d'un seul pixel.
   * @param {{nom?: string}} biz
   * @returns {string} HTML deja echappe, pret pour innerHTML
   */
  static renderCompanyFooter(biz) {
    const nom = biz && biz.nom ? esc(biz.nom) : 'Mon entreprise';
    return nom + '<br>Compte de démonstration';
  }

  /**
   * Rendu d'un toast d'erreur — reagit a DATA_ERROR au lieu de laisser
   * l'UI planter (section 4 du brief : resilience, pas de crash).
   * @param {string} message
   * @returns {string} HTML deja echappe
   */
  static renderErrorToast(message) {
    return '⚠ ' + esc(message || 'Une erreur est survenue.');
  }

  #onDataSuccess({ key, data }) {
    if (key === 'sebaEntreprise') {
      this.#domWriter('sidebar-footer', UIController.renderCompanyFooter(data));
    }
  }

  #onDataError({ error }) {
    this.#domWriter('dash-toast', UIController.renderErrorToast(error));
  }

  #onAuthSuccess() {
    eventBus.publish('DATA_REQUEST', { action: 'FETCH', key: 'sebaEntreprise' });
  }

  /**
   * Reagit aux clics passes par docs/src/ui/event-bridge.js
   * (window.handleLegacyClick). Ne prend en charge QUE les actions pour
   * lesquelles ce module a reellement une dependance injectee — sinon
   * n'appelle jamais ack.handled=true, et le bridge retombe lui-meme sur
   * la fonction globale historique (fallback deja teste dans
   * test-event-bridge.js, zero regression).
   */
  #onUiAction({ action, ack }) {
    if (action === 'toggleSidebar' && this.#toggleSidebar) {
      this.#toggleSidebar();
      if (ack) ack.handled = true;
    }
  }
}
