/* sidebar.js — Seba
 * Source unique de vérité pour la navigation latérale.
 *
 * Usage dans chaque page pro :
 *   1. Laisser <nav class="sidebar"></nav> vide dans le HTML
 *   2. Ajouter <script src="sidebar.js"></script> juste après
 *
 * La classe .active est posée automatiquement selon l'URL courante.
 * Le nom d'entreprise est lu depuis localStorage.sebaEntreprise.
 */
(function () {
  'use strict';

  /* ── Icônes SVG (15×15, stroke uniquement) ───────────────────────────────── */
  var I = {
    dashboard:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>',
    clients:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 15v-1a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v1"/><circle cx="7.5" cy="7" r="3"/><path d="M19 15v-1a3 3 0 0 0-3-3"/><path d="M16 4a3 3 0 0 1 0 6"/></svg>',
    planning:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16"/><path d="M6 2v4M14 2v4"/></svg>',
    devis:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6z"/><polyline points="13 2 13 7 18 7"/><line x1="12" y1="11" x2="6" y2="11"/><line x1="12" y1="15" x2="6" y2="15"/></svg>',
    factures:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v18l2.5-1.5L8 20l2.5-1.5L13 20l2.5-1.5L18 20V2z"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="11" x2="13" y2="11"/><line x1="7" y1="14" x2="10" y2="14"/></svg>',
    equipe:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="8" r="2.5"/><circle cx="14" cy="8" r="2.5"/><path d="M1 17c0-2.8 2.2-5 5-5h8c2.8 0 5 2.2 5 5"/></svg>',
    historique:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8"/><polyline points="10 6 10 10 13 13"/></svg>',
    reglages:
      '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/></svg>',
  };

  /* ── Structure de navigation ─────────────────────────────────────────────── */
  var NAV = [
    {
      label: 'Principal',
      items: [
        { href: 'dashboard.html', label: 'Tableau de bord', key: 'dashboard', match: ['dashboard'], appDir: true },
        { href: 'clients.html',   label: 'Clients',         key: 'clients',   match: ['client'],  shortcut: 'C' },
        { href: 'planning.html',  label: 'Planning',        key: 'planning',  match: ['planning'], shortcut: 'P' },
        { href: 'devis.html',     label: 'Devis',           key: 'devis',     match: ['devis'],    shortcut: 'D' },
        { href: 'factures.html',  label: 'Factures',        key: 'factures',  match: ['factures'], shortcut: 'F' },
      ],
    },
    {
      label: 'Équipe',
      gapBefore: true, // grand espace pour séparer "opérations" du reste ("système")
      items: [
        { href: 'equipe.html',     label: 'Équipe',     key: 'equipe',     match: ['equipe', 'employe'] },
        { href: 'historique.html', label: 'Historique', key: 'historique', match: ['historique'] },
      ],
    },
    {
      label: 'Compte',
      items: [
        { href: 'reglages.html', label: 'Réglages', key: 'reglages', match: ['reglages'] },
      ],
    },
  ];

  /* ── Détection de la page active ─────────────────────────────────────────── */
  function isActive(item) {
    var p = window.location.pathname;
    return item.match.some(function (token) { return p.includes(token); });
  }

  /* ── Résolution de chemin relatif ─────────────────────────────────────────
     dashboard.html est seul dans docs/app/ (première étape de la migration
     décrite dans _architecture/ARCHITECTURE.md), les autres pages restent à
     plat dans docs/. sidebar.js est chargé depuis les deux emplacements :
     on calcule le préfixe selon la profondeur de la page courante plutôt que
     de coder deux versions du fichier. */
  function isInApp() { return /\/app\//.test(window.location.pathname); }
  function resolveHref(item) {
    var inApp = isInApp();
    if (item.appDir) return inApp ? item.href : 'app/' + item.href;
    return inApp ? '../' + item.href : item.href;
  }

  /* ── Nom d'entreprise depuis localStorage ────────────────────────────────── */
  function companyName() {
    try {
      var biz = JSON.parse(localStorage.getItem('sebaEntreprise') || 'null');
      return (biz && biz.nom) ? biz.nom : 'Mon entreprise';
    } catch (e) { return 'Mon entreprise'; }
  }

  /* ── Génération du HTML ──────────────────────────────────────────────────── */
  function build() {
    var html = '<div class="s-logo"><div class="s-logo-dot"></div>Seba</div>';

    NAV.forEach(function (group) {
      var groupCls = 'nav-group' + (group.gapBefore ? ' nav-group-gap' : '');
      html += '<div class="' + groupCls + '"><div class="nav-label">' + group.label + '</div>';
      group.items.forEach(function (item) {
        var cls = 'nav-item' + (isActive(item) ? ' active' : '');
        html += '<a href="' + resolveHref(item) + '" class="' + cls + '">'
              + (I[item.key] || '') + item.label
              + (item.shortcut ? '<span class="nav-shortcut">' + item.shortcut + '</span>' : '')
              + '</a>';
      });
      html += '</div>';
    });

    html += '<div class="sidebar-footer">'
          + '<strong id="sidebar-company">' + companyName() + '</strong>'
          + 'Compte de démonstration'
          + '</div>';

    return html;
  }

  /* ── Injection ───────────────────────────────────────────────────────────── */
  function init() {
    try {
      var nav = document.querySelector('nav.sidebar');
      if (!nav) return;
      nav.innerHTML = build();
    } catch (e) {
      console.error('sidebar init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
