/* SETTINGS-BRAND-001 (2026-07-29) — applique réellement la couleur de
   marque choisie dans Réglages/Identité visuelle, sur toutes les pages
   patron connectées. Remplace le mécanisme orphelin précédent
   (localStorage.getItem('user_theme_color'), jamais écrit nulle part et
   de toute façon local à reglages.html seule) par la source canonique
   réelle : seba_state.state.entreprise.branding.accent.

   Ne pilote QUE --emerald (le token "accent de marque" du design system,
   voir docs/src/ui/theme.css) -- jamais les tokens sémantiques
   (--badge-success-*, --badge-warning-*, --badge-error-*, --critical,
   --amber), qui restent des valeurs hexadécimales indépendantes, pas des
   var(--emerald) : succès/alerte/danger ne changent donc jamais quelle
   que soit la couleur de marque choisie (exigence explicite : "elle ne
   doit pas remplacer rouge danger / orange alerte / vert succès").

   Nécessite seba-data.js déjà chargé avant ce script. Pas de flash anti-
   FOUC synchrone possible ici (contrairement à theme.js) : la couleur de
   marque dépend de données de compte, chargées de façon asynchrone --
   un bref instant avec l'accent par défaut avant la vraie couleur choisie
   est un compromis assumé, cohérent avec le reste de la personnalisation
   du compte (nom, greeting, etc., déjà chargés après coup ailleurs). */
(function () {
  function apply() {
    if (!window.SebaDB || !SebaDB.entreprise) return;
    const ent = SebaDB.entreprise.get();
    const accent = ent && ent.branding && ent.branding.accent;
    if (accent) document.documentElement.style.setProperty('--emerald', accent);
  }
  function boot() {
    apply();
    if (window.SebaDB && SebaDB.onChange) SebaDB.onChange(apply);
  }
  if (window.SebaDB) boot();
  else document.addEventListener('DOMContentLoaded', function () {
    if (window.SebaDB) boot(); else console.warn('[brand-accent] SebaDB indisponible, couleur de marque non appliquée.');
  });
})();
