/* config-dashboard.js — Seba
 * Widgets par défaut du dashboard, par domaine métier (biz.secteur), plus
 * deux registres annexes qui vivent ici pour la même raison (config de
 * secteur, pas de logique de rendu) : SECTOR_MAPPING (identité des
 * secteurs) et WIDGET_EXTENSIONS (copie/règles métier par secteur pour les
 * widgets "purs" génériques).
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

  /* ── SECTOR_MAPPING (WM-001, _architecture/WIDGET_MASTER_PLAN.md) ──
     docs/onboarding.html ne propose que 4 boutons de secteur, dont la valeur
     est un LIBELLÉ affiché ("Nettoyage & Entretien"), pas une des 11 clés
     internes ci-dessous. Sans ce pont, biz.secteur ne matchait jamais
     businessTypes.js/seba-data.js/BY_SECTEUR pour un utilisateur réel — tout
     retombait silencieusement sur 'autre'. Résolution WM-002 : chaque
     libellé de l'onboarding est mappé vers UNE SEULE clé interne (la plus
     représentative), pas vers les 11 — l'onboarding reste volontairement à
     4 choix ("2 minutes", promesse déjà actée). */
  var SECTOR_MAPPING = {
    'Nettoyage & Entretien': 'menage',
    'Conciergerie & Accueil': 'conciergerie',
    'Artisans & Maintenance': 'maintenance',
    'Autre activité': 'autre',
  };

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
    maintenance: ['chart-donut', 'lot-tournee', 'lot-carte', 'marge-reelle'],
    jardinage: ['chart-donut', 'lot-tournee', 'lot-carte'],
    demenagement: ['chart-donut', 'lot-tournee', 'lot-carte', 'marge-reelle'],
    menage: ['lot-pipeline', 'lot-impayes', 'generic-media-report'],
    conciergerie: ['lot-pipeline', 'lot-impayes'],
    conciergerieCopro: ['lot-pipeline', 'lot-impayes'],
    conciergerieEntreprise: ['lot-pipeline', 'lot-impayes'],
    pressing: ['lot-pipeline', 'lot-impayes'],
    beaute: ['lot-pipeline', 'lot-impayes'],
    animaux: ['lot-pipeline', 'lot-impayes'],
    autre: [],
  };

  /* ── WIDGET_EXTENSIONS (WM-004, _architecture/WIDGET_MASTER_PLAN.md) ──
     Contrat d'extension sectorielle minimal : un widget "pur" générique
     (docs/widgets.js) résout ici sa copie (titre, icône, état vide) selon
     le secteur courant, au lieu de coder une phrase par métier en dur dans
     le widget lui-même. 'default' s'applique à tout secteur non listé —
     jamais de secteur non couvert sans copie. */
  var WIDGET_EXTENSIONS = {
    'generic-media-report': {
      menage: {
        title: 'Rapport photo de ménage',
        emptyIcon: '📷', emptyTitle: 'Aucun rapport photo',
        emptySub: "Ajoutez des photos avant/après à vos interventions de ménage pour rassurer vos clients.",
      },
      conciergerie: {
        title: 'Rapport photo de logement',
        emptyIcon: '📷', emptyTitle: 'Aucun rapport photo',
        emptySub: 'Ajoutez des photos avant/après de vos logements pour rassurer vos propriétaires.',
      },
      conciergerieCopro: {
        title: 'Rapport photo des parties communes',
        emptyIcon: '📷', emptyTitle: 'Aucun rapport photo',
        emptySub: 'Ajoutez des photos avant/après des parties communes pour vos comptes rendus de copropriété.',
      },
      conciergerieEntreprise: {
        title: 'Rapport photo des espaces',
        emptyIcon: '📷', emptyTitle: 'Aucun rapport photo',
        emptySub: 'Ajoutez des photos avant/après des espaces entretenus pour vos comptes rendus.',
      },
      default: {
        title: 'Rapport photo',
        emptyIcon: '📷', emptyTitle: 'Aucun rapport photo',
        emptySub: 'Ajoutez des photos avant/après à vos interventions pour rassurer vos clients.',
      },
    },
  };

  /* ── INCOMPATIBLE_BY_SECTEUR (WM-006, _architecture/WIDGET_MASTER_PLAN.md) ──
     Traduction en code du statut "X" de la matrice §6 : widgets id à masquer
     complètement du panneau "Personnaliser" pour un secteur donné (pas
     seulement non promus par défaut — inatteignables, même manuellement).
     Vide aujourd'hui : au moment de la rédaction de la matrice (§6), aucun
     widget du catalogue n'est marqué X pour aucun secteur — ce registre
     existe pour que la prochaine incompatibilité actée par le produit
     tienne en une seule ligne ici, répercutée automatiquement dans l'UI
     (buildLibraryPanelHTML, docs/widgets.js), sans toucher au rendu. */
  var INCOMPATIBLE_BY_SECTEUR = {
    autre: [],
  };

  window.SEBA_DASHBOARD_CONFIG = {
    core: CORE,
    bySecteur: BY_SECTEUR,
    sectorMapping: SECTOR_MAPPING,
    incompatibleBySecteur: INCOMPATIBLE_BY_SECTEUR,
    /* Liste ordonnée de widgets visibles par défaut pour un secteur donné. */
    widgetsFor: function (secteur) {
      var extra = BY_SECTEUR[secteur] || BY_SECTEUR.autre;
      return CORE.concat(extra);
    },
    /* Résout un libellé de l'onboarding (docs/onboarding.html) vers une clé
       de secteur interne. Renvoie 'autre' si le libellé est inconnu — un
       nouveau bouton de secteur ajouté à l'onboarding sans entrée ici
       retombe sur le filet de sécurité existant, jamais une clé invalide. */
    resolveSector: function (label) {
      return SECTOR_MAPPING[label] || 'autre';
    },
    /* Copie/règles métier d'un widget générique pour un secteur donné —
       contrat d'extension sectorielle (voir WIDGET_EXTENSIONS ci-dessus). */
    widgetExtensionFor: function (widgetId, secteur) {
      var forWidget = WIDGET_EXTENSIONS[widgetId];
      if (!forWidget) return null;
      return forWidget[secteur] || forWidget.default || null;
    },
    /* Statut X de la matrice §6 : false = widget à masquer entièrement pour
       ce secteur (jamais dans le panneau "Personnaliser", même à ajouter
       manuellement). true pour tout le reste (O et P ne se distinguent pas
       ici — seule la visibilité par défaut, gérée par widgetsFor, diffère
       entre O et P). */
    isCompatible: function (widgetId, secteur) {
      var excluded = INCOMPATIBLE_BY_SECTEUR[secteur] || INCOMPATIBLE_BY_SECTEUR.autre || [];
      return excluded.indexOf(widgetId) === -1;
    },
  };
})();
