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
import { AuthModule, AUTH_EVENTS } from '../modules/auth-module.js';
import { DataModule } from '../modules/data-module.js';
import { TelemetryModule, TELEMETRY_EVENTS } from '../modules/telemetry-module.js';
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
 * Sequence 4/4 — eveil du Core : instancie la chaine complete. Chaque
 * constructeur s'abonne lui-meme sur l'EventBus (voir data-module.js/
 * telemetry-module.js), aucun cablage supplementaire requis ici pour la
 * cascade DATA_SUCCESS -> TelemetryModule -> TELEMETRY_READY.
 * - TelemetryModule() : reagit a AUTH_SUCCESS (FETCH seba_db) et a
 *   DATA_SUCCESS(seba_db) (calcule les agregats, publie TELEMETRY_READY).
 * - DataModule({ storage: window.localStorage }) : reagit a AUTH_SUCCESS
 *   (FETCH seba_db + sebaEntreprise) et a DATA_REQUEST. Cle et forme
 *   verifiees compatibles avec la production reelle : DB_KEY='seba_db'
 *   dans docs/seba-data.js (SebaDB) est le MEME nom de cle que REGISTRY
 *   dans data-module.js, et le state SebaDB ({clients, devis, factures,
 *   interventions, employes, ...}) satisfait deja le validateur du
 *   registre — DataModule.fetch('seba_db') lit donc les vraies donnees
 *   metier, pas un blob vide ou incompatible.
 */
new TelemetryModule();
new DataModule({ storage: window.localStorage });
const authModule = new AuthModule(window.SEBA_CONFIG || {});

/**
 * AuthModule.getSession() est une lecture seule (ne publie aucun
 * evenement, voir auth-module.js) : c'est ce fichier qui traduit une
 * session confirmee en AUTH_SUCCESS sur le bus, avec la MEME forme de
 * payload que celle deja publiee par AuthModule.signIn()/signUp()
 * ({ userId, demo }) — DataModule et TelemetryModule y reagissent deja
 * (ils ne lisent d'ailleurs aucun champ du payload, seul le nom de
 * l'evenement compte). Aucune session -> aucune publication : la cascade
 * ne demarre jamais dans le vide, elle reste silencieuse (etat par defaut
 * du dashboard, demo ou reel, inchange).
 *
 * docs/guard.js a deja fait respecter l'acces a cette page (redirection
 * vers connexion.html si Supabase configure et non authentifie) BIEN
 * AVANT que ce script differe ne s'execute — cet appel ne bloque jamais
 * l'affichage, il ne fait qu'amorcer le bus une fois la page deja
 * autorisee a s'afficher.
 *
 * Ecart assume : instancier AuthModule ici cree un DEUXIEME client
 * Supabase (le premier est deja charge par docs/auth.js pour
 * window.sebaAuth, celui que guard.js utilise reellement) — AuthModule ne
 * lit jamais window.sebaAuth par conception (sandboxing, voir
 * auth-module.js, config passee au constructeur). Le SDK Supabase peut
 * logguer un avertissement "Multiple GoTrueClient instances" en console :
 * sans impact fonctionnel connu aujourd'hui (getSession() est en lecture
 * seule, ne rafraichit pas de token), documente comme dette a resorber
 * quand guard.js migrera lui-meme vers AuthModule — hors perimetre de
 * cette sequence (voir MIGRATION_TELEMETRY_REPORT.md).
 */
async function wakeUpCore() {
  try {
    const session = await authModule.getSession();
    if (!session) return;
    eventBus.publish(AUTH_EVENTS.SUCCESS, {
      userId: session.user && session.user.id,
      demo: !!session.demo,
    });
  } catch (e) {
    console.warn('[Seba-Core] AuthModule.getSession() a echoue, cascade telemetrie non amorcee.', e);
  }
}
wakeUpCore();

/**
 * Souscription a TELEMETRY_READY (emis par TelemetryModule ci-dessus) ->
 * routage direct vers uiController.renderTelemetry(data). Reference de
 * handler conservee au niveau module et desabonnee avant tout nouvel
 * abonnement : eventBus (docs/src/core/event-bus.js) retrouve un handler
 * par la reference exacte du callback passe a subscribe(), donc un second
 * appel de bindTelemetryReady() sans ce garde empilerait un listener
 * supplementaire a chaque appel (fuite memoire + renderTelemetry()
 * declenche N fois par evenement).
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
