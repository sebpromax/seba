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

/* Elements statiques de telemetry-map.json (Prompt 1) et le champ de
   `data` (sortie de TelemetryModule.computeAggregates(), voir
   docs/src/modules/telemetry-module.js) cense les nourrir. IMPORTANT,
   corrige en Sequence 4/4 (activation reelle, voir MIGRATION_TELEMETRY_
   REPORT.md "notif-badge") : AUCUN des 4 elements ci-dessous n'a de source
   reelle dans TelemetryModule aujourd'hui.
   - notif-badge : retire de cette liste (etait mappe sur facturesRetard
     dans la PR#28, jamais active). Verification faite en activant la
     cascade pour de vrai (Sequence 4/4) : #notif-badge est deja alimente
     en production par renderNotifPanel(ctx) (dashboard.html), sur
     ctx.creances (docs/widgets.js buildWidgetCtx, cle localStorage
     "creances_imp" - un registre de recouvrement/relance), PAS sur les
     factures status='retard' de seba_db que compte facturesRetard. Ce sont
     deux concepts metier distincts (creances/relance vs factures en
     retard) qui partagent le meme id DOM par coincidence historique. Le
     laisser mappe aurait fait remplacer, une fois la cascade active pour
     de vrai, un compte correct (creances) par un compte incoherent avec le
     panneau deroulant en dessous (qui liste toujours les creances) — un
     vrai regression, pas juste un doublon inoffensif. Documente plutot que
     fabrique une fausse correspondance.
   - focus-score-num / focus-score-lbl / wc-pct : Serenity Score
     (computeSerenityScore() dans widgets.js) et checklist onboarding
     (flags localStorage seba_check_*) restent des calculs totalement
     distincts, jamais produits par TelemetryModule.
   renderTelemetry() ignore proprement (voir guards) tant qu'aucune source
   reelle n'alimente un de ces champs — le volet statique est donc
   aujourd'hui un no-op assume en production ; seul le volet dynamique
   (redeclenchement de renderCockpitTelemetry) et le clamp CSS restent
   actifs des qu'une donnee reelle existe. */
const STATIC_TELEMETRY_FIELDS = [
  { id: 'focus-score-num', dataKey: 'serenityScore', format: (n) => String(n) },
  { id: 'focus-score-lbl', dataKey: 'serenityLabel', format: (s) => String(s) },
  { id: 'wc-pct', dataKey: 'checklistLabel', format: (s) => String(s) },
];

export class UIController {
  #domWriter;
  #domStyleWriter;
  #toggleSidebar;
  #latestTelemetry = null;

  /**
   * @param {{
   *   domWriter: (targetId: string, html: string) => void,
   *   domStyleWriter?: (targetId: string, property: string, value: string) => void,
   *   toggleSidebar?: () => void
   * }} deps
   * `toggleSidebar` est optionnel et injecte (meme sandboxing que domWriter) :
   * c'est la logique DOM reelle de bascule du menu mobile, fournie par
   * dashboard-init.js (seul fichier autorise a toucher document). Sans elle,
   * l'action 'toggleSidebar' de UI_ACTION reste non geree et retombe sur le
   * fallback window.toggleSidebar() du bridge — zero regression meme si ce
   * module est instancie sans cette dependance (tests, pages sans sidebar...).
   * `domStyleWriter` est optionnel, meme sandboxing : necessaire pour #wc-bar
   * (style.width, une propriete CSS — pas un cas ou esc()/innerHTML a un
   * sens, voir renderTelemetry).
   */
  constructor({ domWriter, domStyleWriter, toggleSidebar } = {}) {
    if (typeof domWriter !== 'function') {
      throw new Error('UIController requiert un domWriter injecte (targetId, html) => void — voir sandboxing.');
    }
    this.#domWriter = domWriter;
    this.#domStyleWriter = typeof domStyleWriter === 'function' ? domStyleWriter : null;
    this.#toggleSidebar = typeof toggleSidebar === 'function' ? toggleSidebar : null;

    eventBus.subscribe('DATA_SUCCESS', (payload) => this.#onDataSuccess(payload));
    eventBus.subscribe('DATA_ERROR', (payload) => this.#onDataError(payload));
    eventBus.subscribe('AUTH_SUCCESS', () => this.#onAuthSuccess());
    eventBus.subscribe('UI_ACTION', (payload) => this.#onUiAction(payload));
  }

  /** Derniers agregats recus (ou null) — expose pour un futur consommateur
      (ex: un widget qui voudrait lire la valeur courante sans re-ecouter
      TELEMETRY_READY depuis le debut). */
  get latestTelemetry() {
    return this.#latestTelemetry;
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
   * renderTelemetry(data) — mode hybride, appelee a la reception de
   * TELEMETRY_READY (voir dashboard-init.js).
   *
   * VOLET STATIQUE : met a jour les elements de telemetry-map.json dont
   * `data` fournit reellement la valeur (voir STATIC_TELEMETRY_FIELDS et
   * son commentaire — 3 des 4 champs n'ont aujourd'hui aucune source dans
   * TelemetryModule, ils sont donc ignores un par un, pas globalement).
   * Toute valeur textuelle passe par esc() avant assemblage HTML — meme
   * pour des nombres, en garantie defensive systematique (voir
   * SECURITY_AUDIT.md : aucune de ces valeurs n'est une faille active
   * aujourd'hui, esc() est ici une ceinture de securite, pas un correctif).
   *
   * VOLET DYNAMIQUE : stocke les agregats dans un etat local accessible
   * (#latestTelemetry / latestTelemetry) puis declenche le VRAI point
   * d'entree de rafraichissement des widgets (window.renderCockpitTelemetry,
   * docs/widgets.js) avec le VRAI contexte deja construit par
   * dashboard.html (window._ctx) — jamais un contexte fabrique de toutes
   * pieces a partir des seuls agregats : renderCockpitTelemetry(ctx)
   * attend un contexte complet (biz/secteur/demo/creances/sym/...), pas
   * seulement des totaux numeriques (voir telemetry-map.json,
   * avertissement_perimetre). Sans window._ctx/renderCockpitTelemetry
   * disponibles (module pas encore charge, ou test hors navigateur), ce
   * volet est silencieusement ignore — pas une erreur.
   *
   * GUARDS : si `data` est absent/corrompu (pas un objet, aucun champ
   * numerique exploitable), log un avertissement et s'arrete NET avant
   * tout ecriture DOM — le rendu precedent reste affiche tel quel.
   * @param {Record<string, number|string>|null} data
   */
  renderTelemetry(data) {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      console.warn('[ui-controller] renderTelemetry: donnees absentes ou invalides, DOM existant conserve.', data);
      return;
    }

    this.#latestTelemetry = data;

    // Volet statique — un champ manquant/invalide est ignore individuellement,
    // jamais un abandon global (les autres champs presents restent appliques).
    STATIC_TELEMETRY_FIELDS.forEach(({ id, dataKey, format }) => {
      const value = data[dataKey];
      if (value === undefined || value === null) return;
      this.#domWriter(id, esc(format(value)));
    });

    if (typeof data.checklistPct === 'number' && this.#domStyleWriter) {
      // style.width : propriete CSS, pas un contexte HTML — esc() n'a pas de
      // sens ici (ce n'est pas de l'innerHTML). La protection adaptee est la
      // validation numerique/le clamp, pas l'echappement d'entites HTML.
      const pct = Math.max(0, Math.min(100, Number(data.checklistPct) || 0));
      this.#domStyleWriter('wc-bar', 'width', pct + '%');
    }

    // Volet dynamique — re-declenche le vrai point d'entree des widgets
    // avec le vrai contexte existant, sans le remplacer ni le deviner.
    if (typeof window !== 'undefined' && window._ctx && typeof window.renderCockpitTelemetry === 'function') {
      window.renderCockpitTelemetry(window._ctx);
    }
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
