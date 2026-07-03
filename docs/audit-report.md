# Audit rapide du site — corrections proposées

Résumé: ce rapport liste les motifs récurrents qui causent des problèmes mobile/perf et propose corrections non-destructives.

Fichiers clés analysés:

- `docs/onboarding.html`:
  - Problèmes: globe D3 initialisé systématiquement; importante charge réseau (world-atlas) et CPU sur mobile.
  - Recommandation: garder `window.initGlobe()` et appeler seulement en `desktop-mode`; lazy-load D3/topojson via dynamic import.

- `docs/pro-global.css`:
  - Problèmes: `height:100vh` et sidebars sticky provoquent overflow et scrolling erratique sur mobile.
  - Recommandation: limiter `100vh` / sticky à desktop (`@media (min-width:880px)`), appliquer overrides conservateurs déjà ajoutés.

- `docs/animations-vitrine.js`:
  - Problèmes: initialisation possible avant DOMContentLoaded; listeners et heavy three.js loop peuvent s'exécuter même si canvas absent.
  - Actions prises: encapsulé l'init dans une fonction et déclenché au `DOMContentLoaded`; ajouté protection d'init et `try/catch`.

- `docs/sidebar.js`:
  - Problèmes: injection DOM sans protection pouvait lever et casser le reste du JS.
  - Actions prises: ajouté `try/catch` autour de l'initialisation.

Recommandations globales (phases):

1. Audit & report (this file) — fait.
2. Hardening JS (DOMContentLoaded, guards, prefers-reduced-motion) — partiellement fait (animations, sidebar).
3. Lazy-load libs: D3/topojson/GSAP/Three on pages that need them (dynamic imports or script injection + `defer`/`async`).
4. Mobile CSS pass: systematically convert `grid-template-columns: 220px 1fr` to `grid-template-columns: minmax(0, 1fr)` under small viewports; keep desktop with media queries.
5. Replace `height:100vh` with `min-height:100dvh` where appropriate and scope to desktop when necessary.
6. Run visual checks on device emulator, add screenshots in `docs/tests/` and adjust.

Prochaines étapes effectuables automatiquement sur demande:
- Appliquer lazy-loading D3/GSAP page-by-page.
- Convertir les grilles px → `fr` + `minmax()` sur pages prioritaires (index, dashboard, clients, onboarding).
- Ajouter tests visuels automatisés (puppeteer) pour mobile viewport.

Fin du rapport.
