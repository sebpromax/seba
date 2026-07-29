/* SETTINGS-BRAND-001 (2026-07-29) — rendu automatique de l'avatar
   d'entreprise (#avatar-btn), partagé par toutes les pages connectées.
   Avant ce chantier, l'avatar restait un texte statique ("ML" en dur dans
   le HTML) sur la plupart des pages, jamais recalculé -- remonté par le
   fondateur ("l'avatar affiche encore ML même lorsque l'entreprise a été
   renommée SebaClean"). Un seul calcul (SebaDB.entreprise.initials/
   renderAvatar, docs/seba-data.js), jamais dupliqué par page.
   Nécessite seba-data.js déjà chargé avant ce script. */
(function () {
  function render() {
    if (window.SebaDB && SebaDB.entreprise) SebaDB.entreprise.renderAvatar('avatar-btn');
  }
  function boot() {
    render();
    if (window.SebaDB && SebaDB.onChange) SebaDB.onChange(render);
  }
  if (window.SebaDB) boot();
  else document.addEventListener('DOMContentLoaded', function () {
    // seba-data.js est charge de façon synchrone juste avant ce script sur
    // toutes les pages concernées -- ce repli ne couvre qu'un ordre de
    // chargement inhabituel, jamais le cas normal.
    if (window.SebaDB) boot(); else console.warn('[avatar-init] SebaDB indisponible, avatar non rendu.');
  });
})();
