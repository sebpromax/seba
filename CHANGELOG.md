# Changelog

Ce fichier suit les décisions architecturales et les jalons produit significatifs — pas le détail de chaque PR (voir l'historique git pour ça).

## 2026-07-15 — Révision du Blueprint architectural

Le blueprint cible (`_architecture/ARCHITECTURE.md`) a été révisé suite à l'analyse des conflits soulevés lors de sa première rédaction :

- **GitHub Pages** : abandon du dossier `docs/www/` initialement proposé. `docs/` reste lui-même la racine marketing (`index.html` et les pages publiques restent à sa racine) — élimine le risque de casser l'URL racine du site (`sebpromax.github.io/seba/`).
- **Event Bus existant** : `docs/src/` (event bus, `ARCHITECTURE-MODULAIRE.md`, Phases 1-2 déjà livrées) n'est pas touché par ce blueprint (Option A retenue). Les dossiers cibles du nouveau périmètre sont renommés pour éviter toute collision : `ui/` → `design-system/`, `core/` → `services/`.
- **Pages de conversion** : le point resté ouvert (classement d'`onboarding.html`/`connexion.html` dans `app/`) est tranché — les deux pages restent à la racine publique de `docs/`, aux côtés des autres pages marketing. Elles constituent le "sas" public vers l'application et doivent rester indexées (portes d'entrée stratégiques pour l'acquisition). `docs/app/` est désormais strictement réservé aux vues post-login (`dashboard.html`, `settings/`, et les pages déjà bloquées par `robots.txt` aujourd'hui) — seule zone bloquée par `robots.txt` et absente du sitemap.

Aucune migration de fichiers n'a été effectuée à ce stade — document de planification uniquement.

## 2026-07-15 — Première migration réelle (`docs/app/dashboard.html`) + widgets par domaine métier

Première étape concrète du blueprint ci-dessus, et premier fichier à migrer réellement vers `docs/app/` :

- **`dashboard.html` déplacé vers `docs/app/dashboard.html`.** Tous les chemins relatifs internes (CSS, JS partagés, favicon, manifest, service worker, liens de navigation) sont réécrits avec le préfixe `../` nécessaire. Les autres pages post-login (clients, planning, devis, factures, équipe, historique, réglages) restent à plat dans `docs/` pour l'instant — migration en plusieurs PR atomiques, dossier par dossier, pas en un seul commit.
- **Tous les points d'entrée mis à jour en conséquence** : liens internes des pages marketing/app (`onboarding.html`, `connexion.html`, `bienvenue.html`, `404.html`, etc.), `robots.txt`, `manifest.json` (`start_url`), `sw.js` (précache), et les scripts QA officiels (`qa-dashboard-full.js`, `qa-visual-regression.js`) + `check-404.js`/`mobile-audit.js`.
- **`docs/sidebar.js`** (fichier partagé à rayon d'impact large, utilisé par toutes les pages pro) : la résolution des `href` de navigation est désormais dynamique selon la profondeur de la page courante (`resolveHref`/`isInApp`), au lieu d'un chemin fixe — nécessaire puisque `sidebar.js` est chargé à la fois depuis `docs/` et depuis `docs/app/`.
- **Widgets par défaut du dashboard, désormais différenciés par domaine métier** (`docs/services/config-dashboard.js`) : un socle commun + des widgets "compagnon" promus par secteur (tournée/carte pour les métiers de terrain type maintenance/jardinage/déménagement, pipeline/impayés pour les services récurrents type ménage/conciergerie/pressing/beauté/animaux). Branché dans `getEffectiveLayout()` (`docs/widgets.js`) — s'applique uniquement tant qu'un utilisateur n'a pas encore personnalisé sa disposition ; le moteur de widgets existant (`WIDGET_CATALOG`, `renderGrid`, drag & drop, persistance localStorage, recherche par mots-clés) n'a pas été touché ni dupliqué.
- **Vérifié** : `qa-dashboard-full.js` (desktop + mobile, aucun finding), `qa-visual-regression.js` (dashboard-desktop/mobile sous le seuil de 0.5%), `check-design-system.js` (aucune couleur en dur ajoutée — les 92 alertes remontées en mode `--base=main` sont un faux positif du renommage de fichier, confirmé par diff manuel : le script perd l'appariement de renommage quand il diffe un seul chemin).
