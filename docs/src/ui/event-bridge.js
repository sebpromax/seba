/**
 * @module ui/event-bridge
 * Passerelle "Hybrid Mode" (PHASE 2 de la mission "Modernisation DOM").
 * Permet de migrer les onclick inline de dashboard.html vers l'EventBus
 * PROGRESSIVEMENT, sans les supprimer, un par un (voir migration-map.json
 * et MIGRATION_REPORT.md). Rien n'est encore bascule : ce fichier n'est
 * pas importe par dashboard.html tant que la Phase 3 n'est pas confirmee.
 *
 * window.handleLegacyClick(action, ...args) :
 * 1. Publie UI_ACTION { action, args, ack } sur l'EventBus. Un module (ex:
 *    ui-controller.js, en Phase 3) peut ecouter cet evenement et lever
 *    ack.handled = true s'il a reellement pris en charge l'action.
 * 2. Si aucun module ne leve ack.handled (le cas aujourd'hui : rien n'ecoute
 *    encore UI_ACTION), la passerelle appelle directement window[action](...args)
 *    - Regle d'or #3 (ZERO REGRESSION) : comportement identique a avant migration.
 * 3. Si window[action] n'existe pas non plus, log un avertissement console
 *    au lieu de bloquer le clic - Regle d'or #2 (PAS DE PERTE). Une
 *    exception levee par un ecouteur UI_ACTION est elle aussi rattrapee,
 *    pour la meme raison.
 *
 * `action` designe ICI le nom de la fonction globale historique elle-meme
 * (ex: 'toggleSidebar'), pas un identifiant abstrait invente - ca rend le
 * fallback sans ambiguite (window[action] fonctionne toujours, cf.
 * migration-map.json ou targetFunction est deja ce nom exact). Une couche
 * de noms d'action plus abstraits pourra etre introduite plus tard si un
 * besoin reel apparait, pas anticipee ici sans cas d'usage concret.
 */
import { eventBus } from '../core/event-bus.js';

window.handleLegacyClick = function handleLegacyClick(action, ...args) {
  const ack = { handled: false };
  try {
    eventBus.publish('UI_ACTION', { action, args, ack });
  } catch (e) {
    console.warn('[event-bridge] UI_ACTION a leve une exception pour "' + action + '" :', e);
  }
  if (ack.handled) return;

  const legacyFn = window[action];
  if (typeof legacyFn !== 'function') {
    console.warn('[event-bridge] Aucune fonction globale "' + action + '" trouvee - clic ignore (ni module ni fallback disponible).');
    return;
  }
  legacyFn(...args);
};
