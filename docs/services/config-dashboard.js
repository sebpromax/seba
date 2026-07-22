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
  /* 'timeline' (Journée d'aujourd'hui = planning du jour) déplacé juste
     après 'serenity-score', avant les mini-métriques (refonte hiérarchie
     dashboard, 2026-07-22) : widgetsFor() trie par index dans CE tableau
     (voir plus bas), donc l'ordre ici EST l'ordre d'affichage réel --
     déplacer defaultOrder sur la définition du widget (widgets.js) n'a
     aucun effet tant qu'un secteur (donc domainOrder) est actif, seul cet
     ordre CORE compte alors. */
  var CORE = [
    'serenity-score', 'timeline', 'metric-0', 'metric-1', 'metric-2', 'metric-3',
    'bento-chart', 'bento-actions', 'activity', 'recos',
    'quick-actions', 'goal', 'workspace', 'portal', 'team',
  ];

  /* ── WIDGET_SECTOR_FALLBACK (WM-002, _architecture/WIDGET_MASTER_PLAN.md) ──
     conciergerieCopro/conciergerieEntreprise n'ont pas leur propre logique
     de widgets "compagnon" : ils héritent de celle de 'conciergerie' plutôt
     que de la dupliquer (même métier de fond — réception/accès/courrier —
     pas des interventions de terrain dispersées comme maintenance/jardinage).
     Résolu UNIQUEMENT ici, à l'intérieur du moteur de widgets — biz.secteur
     n'est jamais réécrit : businessTypes.js/seba-data.js continuent de lire
     la clé fine (copro/entreprise) pour les services, libellés et champs de
     fiche client, qui doivent eux rester spécifiques. Pas de champ subSector
     ajouté en localStorage : biz.secteur porte déjà cette précision, rien
     n'est écrasé donc rien n'a besoin d'être dupliqué pour être "préservé".
     Inerte aujourd'hui en pratique : aucun parcours (onboarding compris) ne
     produit encore biz.secteur === 'conciergerieCopro'/'conciergerieEntreprise'
     (WM-002 reste ouvert sur ce point précis) — prêt pour le jour où un
     compte portera l'une de ces deux valeurs. */
  var WIDGET_SECTOR_FALLBACK = {
    conciergerieCopro: 'conciergerie',
    conciergerieEntreprise: 'conciergerie',
  };
  function resolveWidgetSector(secteur) {
    return WIDGET_SECTOR_FALLBACK[secteur] || secteur;
  }

  /* Widgets "compagnon" promus par domaine, en plus du socle commun.
     Champ terrain (tournées/interventions dispersées) : carte + tournée.
     Services récurrents/abonnement (facturation régulière) : pipeline + impayés.
     conciergerieCopro/conciergerieEntreprise : pas d'entrée dédiée, voir
     WIDGET_SECTOR_FALLBACK ci-dessus (héritent de 'conciergerie'). */
  var BY_SECTEUR = {
    maintenance: ['chart-donut', 'lot-tournee', 'lot-carte', 'marge-reelle'],
    jardinage: ['chart-donut', 'lot-tournee', 'lot-carte'],
    demenagement: ['chart-donut', 'lot-tournee', 'lot-carte', 'marge-reelle'],
    menage: ['lot-pipeline', 'lot-impayes', 'generic-media-report'],
    conciergerie: ['lot-pipeline', 'lot-impayes'],
    pressing: ['lot-pipeline', 'lot-impayes'],
    beaute: ['lot-pipeline', 'lot-impayes'],
    animaux: ['lot-pipeline', 'lot-impayes'],
    autre: [],
    /* ── 'commun' (WM-003, universalisation de lot-treso) : n'est jamais une
       vraie clé de biz.secteur (aucun secteur ne s'appelle "commun" dans
       businessTypes.js/seba-data.js) — c'est une liste ajoutée à TOUS les
       secteurs par widgetsFor() ci-dessous, quel que soit secteur. Distincte
       de CORE par intention : CORE = identité du produit (widgets présents
       depuis toujours) ; 'commun' = widgets "compagnon" promus universels
       par décision produit ultérieure, sans changer leur category
       ('companion') dans WIDGET_CATALOG. */
    commun: ['lot-treso'],
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
    /* Liste ordonnée de widgets visibles par défaut pour un secteur donné.
       BY_SECTEUR.commun (WM-003) s'ajoute TOUJOURS, quel que soit secteur —
       ce n'est pas une entrée sélectionnée par clé comme les autres.
       secteur passe par resolveWidgetSector() (WM-002) avant le lookup. */
    widgetsFor: function (secteur) {
      var resolved = resolveWidgetSector(secteur);
      var extra = BY_SECTEUR[resolved] || BY_SECTEUR.autre;
      return CORE.concat(BY_SECTEUR.commun || [], extra);
    },
    /* Résout un libellé de l'onboarding (docs/onboarding.html) vers une clé
       de secteur interne. Renvoie 'autre' si le libellé est inconnu — un
       nouveau bouton de secteur ajouté à l'onboarding sans entrée ici
       retombe sur le filet de sécurité existant, jamais une clé invalide. */
    resolveSector: function (label) {
      return SECTOR_MAPPING[label] || 'autre';
    },
    /* Repli de secteur pour le seul usage du moteur de widgets (WM-002) —
       ne remplace jamais biz.secteur, voir WIDGET_SECTOR_FALLBACK ci-dessus. */
    resolveWidgetSector: resolveWidgetSector,
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
      /* Un widget du socle commun (CORE) ou universel ('commun', WM-003) ne
         peut jamais être marqué X : le filtrage par secteur ne s'applique
         qu'aux widgets réellement spécifiques à un métier. Évite qu'une
         future entrée INCOMPATIBLE_BY_SECTEUR mal placée masque par erreur
         un widget désormais universel (ex. lot-treso). */
      if (CORE.indexOf(widgetId) !== -1 || (BY_SECTEUR.commun || []).indexOf(widgetId) !== -1) return true;
      var resolved = resolveWidgetSector(secteur);
      var excluded = INCOMPATIBLE_BY_SECTEUR[resolved] || INCOMPATIBLE_BY_SECTEUR.autre || [];
      return excluded.indexOf(widgetId) === -1;
    },
    /* Version "explicable" de isCompatible() — n'ajoute rien à la logique,
       expose juste POURQUOI. Additive : isCompatible() reste inchangée pour
       ses appelants existants (buildLibraryPanelHTML) ; cette fonction sert
       les futurs consommateurs qui ont besoin de justifier une décision
       (ex. un futur "pourquoi ce widget n'est pas proposé ?"). Statuts
       calqués sur le vocabulaire déjà utilisé dans la matrice §6 de
       _architecture/WIDGET_MASTER_PLAN.md (O/P/X), pas un nouveau système. */
    explainCompatibility: function (widgetId, secteur) {
      var isUniversal = CORE.indexOf(widgetId) !== -1 || (BY_SECTEUR.commun || []).indexOf(widgetId) !== -1;
      if (isUniversal) {
        return { compatible: true, status: 'O', reasons: ['Widget universel (socle commun ou promu pour tous les secteurs).'] };
      }
      var resolved = resolveWidgetSector(secteur);
      var fellBack = resolved !== secteur;
      var excluded = INCOMPATIBLE_BY_SECTEUR[resolved] || INCOMPATIBLE_BY_SECTEUR.autre || [];
      if (excluded.indexOf(widgetId) !== -1) {
        return { compatible: false, status: 'X', reasons: ['Marqué incompatible pour secteur "' + resolved + '" (INCOMPATIBLE_BY_SECTEUR).'] };
      }
      var defaultIds = BY_SECTEUR[resolved] || BY_SECTEUR.autre;
      var isDefault = defaultIds.indexOf(widgetId) !== -1;
      var reasons = [isDefault
        ? 'Activé par défaut pour secteur "' + resolved + '" (BY_SECTEUR).'
        : 'Disponible en option pour secteur "' + resolved + '", non activé par défaut.'];
      if (fellBack) reasons.push('Secteur "' + secteur + '" résolu vers "' + resolved + '" via WIDGET_SECTOR_FALLBACK (WM-002).');
      return { compatible: true, status: isDefault ? 'O' : 'P', reasons: reasons };
    },
  };
})();
