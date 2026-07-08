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
import './event-bridge.js'; // pose window.handleLegacyClick (effet de bord a l'import)

function domWriter(targetId, html) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = html;
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

new UIController({ domWriter, toggleSidebar });

eventBus.publish('UI_READY', {});
