/* ═══════════════════════════════════════════════════════════════
   FX-ACTIONS — moteur de motion métier du cockpit (Encre Vivante, phase 3).

   Principe « logique SEBA » : aucune animation ambiante ici — chaque
   mouvement est la conséquence d'un geste ou d'un événement de données.
   - Toute ligne/carte AJOUTÉE au DOM après le rendu initial glisse en
     place (MutationObserver générique : aucun câblage par page).
   - SebaFXApp.flash(el) : impulsion émeraude unique pour marquer un
     accomplissement (facture payée, devis envoyé) — API opt-in pour les
     pages qui veulent signer un événement précis.

   Guards : navigator.webdriver (captures QA inchangées), prefers-reduced-
   motion, et démarrage APRÈS le rendu initial (les listes SebaDB déjà
   affichées au chargement ne rejouent pas leur entrée).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var noop = function () {};
  window.SebaFXApp = { flash: noop, enabled: false };

  if (navigator.webdriver) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('fx-on');

  window.SebaFXApp = {
    enabled: true,
    flash: function (el) {
      if (!el || !el.classList) return;
      el.classList.remove('fx-flash');
      void el.offsetWidth; // redémarre l'animation même si déjà jouée
      el.classList.add('fx-flash');
    },
  };

  // Ce qui « compte » comme une entrée de données : lignes de tableau et
  // conteneurs nommés carte/item/row. Volontairement pas plus large : les
  // panneaux, menus et toasts ne doivent pas glisser.
  function isDataEntry(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.tagName === 'TR') return true;
    var cls = String(node.className || '');
    return /(^|[\s-])(card|item|row)([\s-]|$)/.test(cls);
  }

  function animateIn(node) {
    node.classList.add('fx-new');
    node.addEventListener('animationend', function h() {
      node.classList.remove('fx-new');
      node.removeEventListener('animationend', h);
    });
  }

  // Démarrage différé : le rendu initial (SebaDB) ne doit pas rejouer
  // l'entrée de chaque ligne existante — seules les VRAIES créations
  // (après chargement) sont signées.
  window.addEventListener('load', function () {
    setTimeout(function () {
      var root = document.querySelector('main, .main') || document.body;
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (isDataEntry(added[j])) animateIn(added[j]);
          }
        }
      });
      mo.observe(root, { childList: true, subtree: true });
    }, 400);
  });
})();
