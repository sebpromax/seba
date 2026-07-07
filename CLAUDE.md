# Seba — règles de projet

Stack : HTML5/CSS3/JS vanilla, zéro bundler, zéro framework. Imports via CDN (D3, SortableJS, PapaParse, html2pdf, Leaflet, supabase-js). Backend : Supabase (Postgres + Auth + RLS). `docs/seba-data.js` (SebaDB) est la source de vérité unique pour toutes les données métier (clients, devis, factures, interventions, employés) — jamais de tableaux codés en dur dans les pages.

## Thème "Tactical Dark Absolu" (dashboard.html uniquement)

Palette : `--bg:#09090B` `--white:#18181B` `--ink:#EDEDED` `--text-2:#A1A1AA` `--emerald:#10B981`. Typographie monospace (JetBrains Mono, classe `.mono-num`) pour tous les chiffres/métriques affichés. Ce thème est **scopé à `docs/dashboard.html` + `docs/widgets.js`** — les autres pages connectées (clients/devis/factures/planning/équipe/historique/réglages) utilisent un thème distinct défini dans `pro-global.css` (tokens 2026-07-06). Ne pas fusionner les deux sans autorisation explicite.

## Convention de commit

Format existant dans l'historique : `type: description en français` (types : `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`), un commit par changement atomique et cohérent, référence courte du contexte entre parenthèses si utile (ex: `(audit 1.2)`, `(TD-3)`).

## Périmètre et garde-fous

- Toute nouvelle fonctionnalité de données passe par SebaDB (`docs/seba-data.js`), jamais de données en dur.
- Un chantier qui touche un fichier partagé entre plusieurs pages (`pro-global.css`, `docs/sidebar.js`) doit le signaler explicitement dans le message de commit — ces fichiers ont un rayon d'impact large.
- `docs/config.js` (secrets : clés IA, etc.) reste **gitignoré**, ne jamais proposer de le committer. `docs/config.public.js` (URL/clé publique Supabase) est public par design.
- Travail non trivial = branche dédiée (`git checkout -b <nom-du-chantier>`), commits atomiques et fréquents, jamais de commit direct sur `main` pour un chantier de plusieurs étapes.
- **`git push origin main` ne doit jamais être automatique.** Toute automatisation (orchestrateur, script, agent) qui prépare un déploiement doit s'arrêter au commit local et attendre une action humaine explicite pour pousser/merger vers `main`, car `main` sert directement le site en production (GitHub Pages). Voir `agents_config.json` (`allowAutoPush`/`allowPushMain`, tous deux `false` par défaut).
- Les fichiers de test (`scripts/qa-*.js`) ne doivent jamais être modifiés pour masquer un échec ou forcer un succès — le code applicatif s'aligne sur le test, jamais l'inverse.

## Vérification

Script QA existant : `node scripts/qa-dashboard-full.js --target=local --viewport=desktop|mobile` (Puppeteer headless, capture erreurs console/requêtes échouées + screenshots dans `docs/audit-screenshots/`). À utiliser après tout changement touchant au dashboard, en particulier drag & drop, persistance localStorage, et animations.
