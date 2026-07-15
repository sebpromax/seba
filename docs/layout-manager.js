/* ═══════════════════════════════════════════════════════════════
   SEBA — En-tête centralisé du cluster de pages "Lot" (galerie de
   concepts, voir AUDIT-EXPERT.md écart #6/#13). Remplace les <header>
   identiques copiés-collés dans 16 pages + core-ux.html.

   Écarts assumés par rapport au brief initial (voir message de mission) :
   1. Fichier gardé à plat dans docs/ (docs/js/ et docs/lot/ n'existent
      pas ; déplacer les pages casserait tous les liens croisés déjà en
      dur). Même convention que theme.js/esc-global.js.
   2. Pas de history.back()/forward() : remplacé par les VRAIS href
      précédent/suivant, transcrits un par un depuis le HTML réel de
      chaque page (pas de calcul de séquence — le préfixe "Lot X.X"
      n'apparaît qu'en avançant vers un nouveau groupe, jamais en
      reculant, et les 2 pages limites ont un lien de sortie spécial).
   3. Pas de logique de footer : aucun <footer> n'existe dans le HTML
      actuel de ces 17 pages (vérifié), rien à extraire.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  var STYLE_MUTED = 'text-2xs font-bold bg-slate-800 border border-slate-700 text-slate-300 px-3 py-1.5 rounded hover:text-white transition-colors';
  var STYLE_ACCENT = 'text-2xs font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded hover:bg-emerald-500/20 transition-colors';

  // Ordre navLeft/navRight = ordre RÉEL dans le DOM de chaque page
  // aujourd'hui (cockpit-treso.html a un ordre inversé par rapport aux
  // 15 autres — préservé tel quel, pas "corrigé").
  var PAGES = {
    'cockpit-treso': {
      label: 'LOT 1.1 // COCKPIT TRÉSORERIE',
      navLeft:  { href: 'registre-charges.html', text: 'Lot 1.2 →', style: STYLE_ACCENT },
      navRight: { href: 'app/dashboard.html',        text: 'Dashboard Pro', style: STYLE_MUTED },
    },
    'registre-charges': {
      label: 'LOT 1.2 // REGISTRE DES CHARGES',
      navLeft:  { href: 'cockpit-treso.html', text: '← 1.1', style: STYLE_MUTED },
      navRight: { href: 'bfr-predictif.html', text: '1.3 →', style: STYLE_ACCENT },
    },
    'bfr-predictif': {
      label: 'LOT 1.3 // BFR PRÉDICTIF',
      navLeft:  { href: 'registre-charges.html', text: '← 1.2', style: STYLE_MUTED },
      navRight: { href: 'compta-expert.html',    text: '1.4 →', style: STYLE_ACCENT },
    },
    'compta-expert': {
      label: 'LOT 1.4 // COMPTA EXPERT · FEC DGFiP',
      navLeft:  { href: 'bfr-predictif.html',    text: '← 1.3',     style: STYLE_MUTED },
      navRight: { href: 'agenda-elastique.html', text: 'Lot 2.1 →', style: STYLE_ACCENT },
    },
    'agenda-elastique': {
      label: 'LOT 2.1 // AGENDA ÉLASTIQUE',
      navLeft:  { href: 'compta-expert.html',    text: '← 1.4', style: STYLE_MUTED },
      navRight: { href: 'haversine-engine.html', text: '2.2 →', style: STYLE_ACCENT },
    },
    'haversine-engine': {
      label: 'LOT 2.2 // HAVERSINE ANTI-CONFLIT',
      navLeft:  { href: 'agenda-elastique.html',      text: '← 2.1', style: STYLE_MUTED },
      navRight: { href: 'mutation-contextuelle.html', text: '2.3 →', style: STYLE_ACCENT },
    },
    'mutation-contextuelle': {
      label: 'LOT 2.3 // MUTATION CONTEXTUELLE',
      navLeft:  { href: 'haversine-engine.html',  text: '← 2.2', style: STYLE_MUTED },
      navRight: { href: 'flotte-telemetrie.html', text: '2.4 →', style: STYLE_ACCENT },
    },
    'flotte-telemetrie': {
      label: 'LOT 2.4 // FLOTTE & TÉLÉMÉTRIE',
      navLeft:  { href: 'mutation-contextuelle.html', text: '← 2.3',     style: STYLE_MUTED },
      navRight: { href: 'studio-factures.html',       text: 'Lot 3.1 →', style: STYLE_ACCENT },
    },
    'studio-factures': {
      label: 'LOT 3.1 // STUDIO FACTURES',
      navLeft:  { href: 'flotte-telemetrie.html', text: '← 2.4', style: STYLE_MUTED },
      navRight: { href: 'signature-payment.html', text: '3.2 →', style: STYLE_ACCENT },
    },
    'signature-payment': {
      label: 'LOT 3.2 // ÉMARGEMENT & PAIEMENT',
      navLeft:  { href: 'studio-factures.html', text: '← 3.1', style: STYLE_MUTED },
      navRight: { href: 'crm-tech.html',        text: '3.3 →', style: STYLE_ACCENT },
    },
    'crm-tech': {
      label: 'LOT 3.3 // CRM TECHNIQUE',
      navLeft:  { href: 'signature-payment.html',        text: '← 3.2', style: STYLE_MUTED },
      navRight: { href: 'contentieux-recouvrement.html', text: '3.4 →', style: STYLE_ACCENT },
    },
    'contentieux-recouvrement': {
      label: 'LOT 3.4 // CONTENTIEUX & RECOUVREMENT',
      navLeft:  { href: 'crm-tech.html',      text: '← 3.3',     style: STYLE_MUTED },
      navRight: { href: 'trava-dechets.html', text: 'Lot 4.1 →', style: STYLE_ACCENT },
    },
    'trava-dechets': {
      label: 'LOT 4.1 // ÉCOTAXE · BSD · RSE',
      navLeft:  { href: 'contentieux-recouvrement.html', text: '← 3.4', style: STYLE_MUTED },
      navRight: { href: 'prevention-risques.html',       text: '4.2 →', style: STYLE_ACCENT },
    },
    'prevention-risques': {
      label: 'LOT 4.2 // PPSPS · ANALYSE RISQUES',
      navLeft:  { href: 'trava-dechets.html',    text: '← 4.1', style: STYLE_MUTED },
      navRight: { href: 'rh-compagnonnage.html', text: '4.3 →', style: STYLE_ACCENT },
    },
    'rh-compagnonnage': {
      label: 'LOT 4.3 // RH & COMPAGNONNAGE',
      navLeft:  { href: 'prevention-risques.html', text: '← 4.2', style: STYLE_MUTED },
      navRight: { href: 'crypto-backup.html',      text: '4.4 →', style: STYLE_ACCENT },
    },
    'crypto-backup': {
      label: 'LOT 4.4 // JOURNAL AUDIT · BACKUP AES-256',
      navLeft:  { href: 'rh-compagnonnage.html', text: '← 4.3',  style: STYLE_MUTED },
      navRight: { href: 'core-ux.html',          text: '↩ Core', style: STYLE_ACCENT },
    },
  };

  /**
   * Injecte l'en-tête standard du cluster "Lot" dans #header-container.
   * `pageId` = clé de PAGES (identifiant de la page courante, PAS une
   * donnée utilisateur — aucun esc() nécessaire ici, tout le contenu
   * vient de la config statique ci-dessus, jamais d'une saisie).
   */
  window.injectLotHeader = function (pageId) {
    var page = PAGES[pageId];
    var container = document.getElementById('header-container');
    if (!page || !container) return;
    container.innerHTML =
      '<header class="bg-slate-950 border-b border-slate-800 sticky top-0 z-40 px-6 py-4 flex items-center justify-between">' +
        '<div class="flex items-center space-x-4">' +
          '<a href="core-ux.html" class="text-xl font-bold tracking-tighter text-white font-mono">seba<span class="text-emerald-500">.</span></a>' +
          '<div class="h-4 w-px bg-slate-800"></div>' +
          '<span class="text-2xs font-bold text-slate-400 uppercase tracking-widest font-mono">' + page.label + '</span>' +
        '</div>' +
        '<div class="flex items-center space-x-3">' +
          '<a href="' + page.navLeft.href + '" class="' + page.navLeft.style + '">' + page.navLeft.text + '</a>' +
          '<a href="' + page.navRight.href + '" class="' + page.navRight.style + '">' + page.navRight.text + '</a>' +
        '</div>' +
      '</header>';
  };
})();
