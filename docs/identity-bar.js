/* identity-bar.js — Seba
 * Bandeau d'identité fixe (nom d'entreprise + secteur), partagé par TOUTES
 * les pages connectées, dashboard patron compris depuis la refonte du
 * 2026-07-22 (retrait de l'exception Tactical Dark -- voir dashboard.html,
 * qui utilise désormais exactement le même socle visuel que clients.html/
 * planning.html/devis.html/reglages.html).
 *
 * Avant ce fichier, seul le dashboard avait un bandeau fixe en haut de page :
 * en naviguant vers les 9 autres pages connectées, le contenu démarrait à
 * une hauteur différente (pas de bandeau du tout), donnant une impression
 * d'incohérence de positionnement entre les pages (demande fondateur).
 *
 * Usage dans chaque page pro :
 *   1. Charger businessTypes.js AVANT ce fichier (résolution du libellé secteur)
 *   2. Laisser <div id="identity-bar" class="identity-bar"></div> vide dans
 *      le HTML, juste avant <div class="layout"> (id pour ce script, class
 *      pour le CSS -- pro-global.css cible .identity-bar)
 *   3. Ajouter <script src="identity-bar.js"></script> juste après
 *
 * Hauteur totale : 105px (voir --v2-fixed-header-space, dashboard-v2.css),
 * même valeur ici pour que .layout/.sidebar démarrent au même niveau que sur
 * le dashboard -- .identity-bar-total-height (pro-global.css) est la seule
 * source de vérité partagée pour ce nombre.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function build() {
    var biz = null;
    try { biz = JSON.parse(localStorage.getItem('sebaEntreprise') || 'null'); } catch (e) {}
    var nom = (biz && biz.nom) || 'Mon entreprise';
    var secteur = biz && biz.secteur;
    var bt = (secteur && window.businessTypes && window.businessTypes[secteur]) || null;
    var sectorLabel = bt ? bt.label : (secteur || '');

    return '<div class="identity-bar-name">' + esc(nom) + '</div>' +
      (sectorLabel ? '<span class="identity-bar-sector">' + esc(sectorLabel) + '</span>' : '');
  }

  function init() {
    var el = document.getElementById('identity-bar');
    if (!el) return;
    try {
      el.innerHTML = build();
    } catch (e) {
      console.error('identity-bar init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
