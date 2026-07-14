# Changelog

Ce fichier suit les décisions architecturales et les jalons produit significatifs — pas le détail de chaque PR (voir l'historique git pour ça).

## 2026-07-15 — Révision du Blueprint architectural

Le blueprint cible (`_architecture/ARCHITECTURE.md`) a été révisé suite à l'analyse des conflits soulevés lors de sa première rédaction :

- **GitHub Pages** : abandon du dossier `docs/www/` initialement proposé. `docs/` reste lui-même la racine marketing (`index.html` et les pages publiques restent à sa racine) — élimine le risque de casser l'URL racine du site (`sebpromax.github.io/seba/`).
- **Event Bus existant** : `docs/src/` (event bus, `ARCHITECTURE-MODULAIRE.md`, Phases 1-2 déjà livrées) n'est pas touché par ce blueprint (Option A retenue). Les dossiers cibles du nouveau périmètre sont renommés pour éviter toute collision : `ui/` → `design-system/`, `core/` → `services/`.
- **Pages de conversion** : le point resté ouvert (classement d'`onboarding.html`/`connexion.html` dans `app/`) est tranché — les deux pages restent à la racine publique de `docs/`, aux côtés des autres pages marketing. Elles constituent le "sas" public vers l'application et doivent rester indexées (portes d'entrée stratégiques pour l'acquisition). `docs/app/` est désormais strictement réservé aux vues post-login (`dashboard.html`, `settings/`, et les pages déjà bloquées par `robots.txt` aujourd'hui) — seule zone bloquée par `robots.txt` et absente du sitemap.

Aucune migration de fichiers n'a été effectuée à ce stade — document de planification uniquement.
