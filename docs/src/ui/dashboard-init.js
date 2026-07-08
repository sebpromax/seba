/**
 * @module ui/dashboard-init
 * Cablage reel (cote navigateur) de UIController — seul fichier de
 * Seba-Core autorise a toucher document/innerHTML directement pour le
 * dashboard, exactement le role que ARCHITECTURE-MODULAIRE.md attribue a
 * la couche "ui/".
 *
 * IMPORTANT — PAS ENCORE IMPORTE PAR docs/dashboard.html.
 * Voir le rapport de mission (commit/PR) : le script inline actuel de
 * dashboard.html declare 39 fonctions de portee globale (renderDashboard,
 * toggleFocusMode, checkItem, etc.), dont au moins 20 sont appelees par des
 * attributs onclick="..." dans le HTML. Passer ce script en
 * type="module" les rendrait toutes indisponibles instantanement
 * (un script module n'attache pas ses declarations sur window) — une
 * regression certaine, pas hypothetique, sur la page la plus utilisee du
 * site. Ce fichier est livre pret a l'emploi, teste, mais le branchement
 * reel sur dashboard.html est reporte a un chantier dedie (voir rapport).
 */
import { UIController } from '../modules/ui-controller.js';
import { eventBus } from '../core/event-bus.js';

function domWriter(targetId, html) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = html;
}

new UIController({ domWriter });

eventBus.publish('UI_READY', {});
