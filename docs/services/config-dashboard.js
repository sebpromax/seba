/* config-dashboard.js — Seba
 * Widgets par défaut du dashboard, par domaine métier (biz.secteur).
 *
 * N'est consulté qu'une fois, par getEffectiveLayout() (docs/widgets.js) :
 * tant qu'un utilisateur n'a jamais personnalisé sa disposition (aucune
 * entrée dans SebaLayoutStore), cette config choisit quels widgets du
 * WIDGET_CATALOG apparaissent par défaut et dans quel ordre. Dès que
 * l'utilisateur déplace/ajoute/retire un widget, sa disposition sauvegardée
 * prend le dessus — cette config ne sert plus qu'à l'onboarding.
 *
 * Les valeurs de secteur reprennent exactement celles de SEED_SERVICES/
 * SEED_EMPLOYES dans docs/seba-data.js (menage, conciergerie, jardinage...).
 */
(function () {
  'use strict';

  /* Socle commun à tous les domaines — inchangé par rapport aux
     defaultVisible/defaultOrder d'origine du WIDGET_CATALOG. */
  var CORE = [
    'serenity-score', 'metric-0', 'metric-1', 'metric-2', 'metric-3',
    'bento-chart', 'bento-actions', 'timeline', 'activity', 'recos',
    'quick-actions', 'goal', 'workspace', 'portal', 'team',
  ];

  /* Widgets "compagnon" promus par domaine, en plus du socle commun.
     Champ terrain (tournées/interventions dispersées) : carte + tournée.
     Services récurrents/abonnement (facturation régulière) : pipeline + impayés. */
  var BY_SECTEUR = {
    maintenance: ['chart-donut', 'lot-tournee', 'lot-carte'],
    jardinage: ['chart-donut', 'lot-tournee', 'lot-carte'],
    demenagement: ['chart-donut', 'lot-tournee', 'lot-carte'],
    // 'nettoyage' n'existe pas comme clé de secteur dans seba-data.js/businessTypes.js
    // (le secteur réel est 'menage', libellé "Ménage & nettoyage") — cleaning-photo-report
    // est donc rattaché à 'menage' pour être réellement activable par un utilisateur.
    menage: ['lot-pipeline', 'lot-impayes', 'cleaning-photo-report'],
    conciergerie: ['lot-pipeline', 'lot-impayes'],
    conciergerieCopro: ['lot-pipeline', 'lot-impayes'],
    conciergerieEntreprise: ['lot-pipeline', 'lot-impayes'],
    pressing: ['lot-pipeline', 'lot-impayes'],
    beaute: ['lot-pipeline', 'lot-impayes'],
    animaux: ['lot-pipeline', 'lot-impayes'],
    autre: [],
  };

  window.SEBA_DASHBOARD_CONFIG = {
    core: CORE,
    bySecteur: BY_SECTEUR,
    /* Liste ordonnée de widgets visibles par défaut pour un secteur donné. */
    widgetsFor: function (secteur) {
      var extra = BY_SECTEUR[secteur] || BY_SECTEUR.autre;
      return CORE.concat(extra);
    },
  };
})();
