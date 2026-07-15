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
    /* Rapport média (photos) des interventions, tous secteurs confondus
     * (widget generic-media-report, généralisé depuis cleaning-photo-report —
     * voir WM-004, _architecture/WIDGET_MASTER_PLAN.md). SebaDB n'a pas
     * encore de champ "photos" sur les interventions — aucune fonctionnalité
     * d'upload n'existe côté produit. Plutôt que d'inventer des chiffres,
     * cette fonction renvoie honnêtement null tant que ce champ n'existe
     * pas : le widget affichera son état vide jusqu'à ce que la vraie
     * fonctionnalité (photos avant/après sur une intervention) existe dans
     * SebaDB. */
    getMediaReport: function (ctx) {
      if (!window.SebaDB || !SebaDB.hasData()) return null;
      var interventions = SebaDB.list('interventions') || [];
      var withPhotos = interventions.filter(function (i) { return Array.isArray(i.photos) && i.photos.length > 0; });
      if (!withPhotos.length) return null;
      return {
        count: withPhotos.length,
        latest: withPhotos[withPhotos.length - 1],
      };
    },

    /* ── Dashboard Adaptatif — persistance des préférences de disposition ──
     * Seul point autorisé à lire/écrire la disposition personnalisée par
     * l'utilisateur (widgets supprimés/ajoutés/réordonnés). Utilise la même
     * clé que le moteur de layout déjà en place avant cette règle
     * ('seba_dashboard_layout', via SebaLayoutStore dans docs/widgets.js) —
     * pas de renommage cosmétique en 'user-dashboard-prefs' : ça aurait
     * silencieusement fait perdre sa disposition à tout utilisateur ayant
     * déjà personnalisé son dashboard. SebaLayoutStore délègue maintenant
     * ici plutôt que d'écrire dans localStorage lui-même. */
    LAYOUT_KEY: 'seba_dashboard_layout',
    saveUserPreference: function (layoutConfig) {
      try {
        layoutConfig.updatedAt = new Date().toISOString();
        localStorage.setItem(this.LAYOUT_KEY, JSON.stringify(layoutConfig));
      } catch (e) { /* quota/navigation privée : on abandonne silencieusement, comme writeSeba() */ }
    },
    getUserPreference: function () {
      try {
        const raw = localStorage.getItem(this.LAYOUT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    /* Secteur de l'entreprise courante (biz.secteur, déjà une clé interne
     * depuis SECTOR_MAPPING/resolveSector() — voir WM-001). Point d'accès
     * unique pour tout code qui a besoin du secteur courant sans relire
     * window._ctx directement (WM-006, _architecture/WIDGET_MASTER_PLAN.md) :
     * utilisé par buildLibraryPanelHTML() pour filtrer le catalogue. */
    getCurrentSector: function () {
      return (window._ctx && window._ctx.secteur) || null;
    },

    /* Marge réelle par intervention (widget marge-reelle — WM-005,
     * _architecture/WIDGET_MASTER_PLAN.md). vue_marge_interventions et
     * get_marge_reelle(p_account, p_intervention_id) existent déjà côté
     * Supabase (supabase-schema.sql, lignes ~773/803) mais aucun consommateur
     * front n'existe : SebaDB (docs/seba-data.js) n'expose aucun champ de
     * coût par intervention aujourd'hui, et aucun appel Supabase n'est câblé
     * ici. Async par conception (une vraie invocation RPC Supabase le
     * serait) : renvoie honnêtement null tant que la donnée de coût
     * n'existe pas côté produit, plutôt que d'inventer un pourcentage de
     * marge. Isolation Widget Pur : ctx en entrée (comme getMediaReport),
     * jamais le secteur seul — le futur appel réel à get_marge_reelle aura
     * besoin de l'identité du compte (ctx.biz), pas seulement du secteur. */
    getMargeReelle: async function (ctx) {
      if (!window.SebaDB || !SebaDB.hasData()) return null;
      var interventions = SebaDB.list('interventions') || [];
      var withCost = interventions.filter(function (i) { return typeof i.coutReel === 'number' && i.montant > 0; });
      if (!withCost.length) return null;
      var total = withCost.reduce(function (sum, i) { return sum + (i.montant - i.coutReel) / i.montant; }, 0);
      return {
        margeMoyennePct: Math.round((total / withCost.length) * 100),
        interventionsAnalysees: withCost.length,
      };
    },
  };
})();
