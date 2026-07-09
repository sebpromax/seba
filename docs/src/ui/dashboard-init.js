/**
 * @module ui/dashboard-init
 * Cablage reel (cote navigateur) de UIController — seul fichier de
 * Seba-Core autorise a toucher document/innerHTML directement pour le
 * dashboard, exactement le role que ARCHITECTURE-MODULAIRE.md attribue a
 * la couche "ui/".
 *
 * IMPORTE PAR docs/dashboard.html EN ADDITIF (script type="module" separe,
 * ajoute APRES le script classique existant) — pas en remplacement.
 * Le script inline actuel de dashboard.html declare 39 fonctions de portee
 * globale, dont au moins 20 appelees par des onclick="..." : le convertir
 * lui-meme en type="module" casserait tout instantanement (voir
 * MIGRATION_REPORT.md). Ce fichier cable seulement les boutons migres un
 * par un vers docs/src/ui/event-bridge.js (aujourd'hui : #hamburger,
 * action 'toggleSidebar'), sans toucher au reste du script classique.
 */
import { UIController } from '../modules/ui-controller.js';
import { eventBus } from '../core/event-bus.js';
import { TELEMETRY_EVENTS } from '../modules/telemetry-module.js';
import './event-bridge.js'; // pose window.handleLegacyClick (effet de bord a l'import)

function domWriter(targetId, html) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = html;
}

/**
 * Ecriture d'une propriete de style (pas d'innerHTML) — meme sandboxing que
 * domWriter, requis par UIController.renderTelemetry() pour #wc-bar
 * (style.width, une propriete CSS, voir ui-controller.js). Sans cette
 * dependance injectee, le volet CSS de renderTelemetry() est silencieusement
 * ignore (this.#domStyleWriter reste null) : on la fournit ici pour que le
 * cablage de la Sequence 3/4 soit complet plutot que partiel.
 */
function domStyleWriter(targetId, property, value) {
  const el = document.getElementById(targetId);
  if (el) el.style[property] = value;
}

/**
 * Bascule du menu mobile — logique DOM identique a la fonction historique
 * toggleSidebar() de dashboard.html (memes selecteurs, meme comportement),
 * pour un rendu visuel garanti inchange (voir test Puppeteer dans le
 * rapport de mission). Injectee dans UIController plutot que dupliquee a
 * l'interieur : ui-controller.js ne touche jamais document lui-meme.
 */
function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const hb = document.getElementById('hamburger');
  const open = sb && sb.classList.contains('open');
  sb && sb.classList.toggle('open', !open);
  ov && ov.classList.toggle('open', !open);
  hb && hb.classList.toggle('open', !open);
  document.body.style.overflow = open ? '' : 'hidden';
}

const uiController = new UIController({ domWriter, domStyleWriter, toggleSidebar });

/**
 * Souscription a TELEMETRY_READY (emis par TelemetryModule, voir
 * docs/src/modules/telemetry-module.js) -> routage direct vers
 * uiController.renderTelemetry(data). Reference de handler conservee au
 * niveau module et desabonnee avant tout nouvel abonnement : eventBus
 * (docs/src/core/event-bus.js) retrouve un handler par la reference exacte
 * du callback passe a subscribe(), donc un second appel de bindTelemetry()
 * sans ce garde empilerait un listener supplementaire a chaque appel
 * (fuite memoire + renderTelemetry() declenche N fois par evenement).
 *
 * Ecart de perimetre assume : ce fichier abonne l'ecouteur, mais
 * TelemetryModule (et la chaine AuthModule -> DataModule dont il depend
 * pour recevoir DATA_SUCCESS) n'est instancie nulle part dans le navigateur
 * a ce jour (verifie : aucun import de auth-module.js/data-module.js/
 * telemetry-module.js hors fichiers de test). TELEMETRY_READY ne sera donc
 * pas encore publie en production - ce cablage reste un tunnel pret mais
 * dormant, exactement comme event-bridge.js l'a ete en Phase 2 (voir
 * MIGRATION_REPORT.md) jusqu'a l'activation complete d'une sequence
 * ulterieure. Documente plutot que fabrique.
 */
let telemetryReadyHandler = null;

/* export uniquement pour test-dashboard-init.js (verifier qu'un second appel
   ne duplique pas l'ecoute) — dashboard.html ne l'importe pas nommement, il
   ne consomme que l'effet de bord de bindTelemetryReady() ci-dessous. */
export function bindTelemetryReady() {
  if (telemetryReadyHandler) {
    eventBus.unsubscribe(TELEMETRY_EVENTS.READY, telemetryReadyHandler);
  }
  telemetryReadyHandler = (data) => {
    console.debug('[Seba-Core] ⚡ Événement TELEMETRY_READY intercepté. Routage vers UIController effectuée.');
    uiController.renderTelemetry(data);
  };
  eventBus.subscribe(TELEMETRY_EVENTS.READY, telemetryReadyHandler);
}

bindTelemetryReady();

eventBus.publish('UI_READY', {});
