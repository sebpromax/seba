/* widget-data-api.js — Seba
 * Interface d'API centralisée pour les widgets "purs" (voir la règle d'or
 * dans _architecture/WIDGET_DEVELOPMENT_PROTOCOL.md) : un widget ne lit
 * JAMAIS window.SebaDB ou localStorage lui-même. Il appelle une fonction
 * de ce fichier, qui est le seul autorisé à parler à SebaDB pour le compte
 * des widgets.
 *
 * Chargé après seba-data.js, avant widgets.js.
 */
(function () {
  'use strict';

  window.SebaWidgetAPI = {
    /* Rapport photo des interventions de ménage (widget cleaning-photo-report).
     * SebaDB n'a pas encore de champ "photos" sur les interventions — aucune
     * fonctionnalité d'upload n'existe côté produit. Plutôt que d'inventer des
     * chiffres, cette fonction renvoie honnêtement null tant que ce champ
     * n'existe pas : le widget affichera son état vide jusqu'à ce que la
     * vraie fonctionnalité (photos avant/après sur une intervention) existe
     * dans SebaDB. */
    getCleaningPhotoReport: function (ctx) {
      if (!window.SebaDB || !SebaDB.hasData()) return null;
      var interventions = SebaDB.list('interventions') || [];
      var withPhotos = interventions.filter(function (i) { return Array.isArray(i.photos) && i.photos.length > 0; });
      if (!withPhotos.length) return null;
      return {
        count: withPhotos.length,
        latest: withPhotos[withPhotos.length - 1],
      };
    },
  };
})();
