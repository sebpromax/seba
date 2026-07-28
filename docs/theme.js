/* ═══════════════════════════════════════════════════════════════
   SEBA — Thème pilote exclusivement par le système (THEME-MOBILE-001,
   2026-07-29). L'attribut data-theme est posé sur <html>, lu par
   pro-global.css. Le snippet anti-flash (inline, avant tout <link>,
   dupliqué en tête de chaque page connectée) fait déjà le tout premier
   rendu avec matchMedia — ce fichier applique la même règle et la
   maintient à jour si le système change PENDANT que Seba est ouverte.

   Décision produit (fondateur, 2026-07-29) : plus de bouton clair/sombre
   dans l'interface, plus de préférence utilisateur stockée -- la seule
   source de vérité est prefers-color-scheme du système. `seba_theme`
   (ancienne clé localStorage de préférence manuelle) est supprimée au
   chargement pour qu'aucune ancienne valeur ne puisse jamais reprendre
   le dessus sur le système. */
(function () {
  try { localStorage.removeItem('seba_theme'); } catch (e) {}

  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function current() {
    return media && media.matches ? 'dark' : 'light';
  }

  function apply() {
    const theme = current();
    document.documentElement.setAttribute('data-theme', theme);
    document.dispatchEvent(new CustomEvent('seba-theme-change', { detail: { theme } }));
  }

  window.sebaTheme = { get: current };

  apply();
  if (media) {
    // addEventListener('change', ...) : Safari/WebKit mobile le supporte
    // depuis longtemps (contrairement à l'ancien media.addListener legacy,
    // jamais nécessaire ici).
    media.addEventListener('change', apply);
  }
})();
