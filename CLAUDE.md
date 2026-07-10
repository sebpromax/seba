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

D'autres garde-fous existent : `node scripts/qa-visual-regression.js` (diff pixel vs baselines dans `docs/visual-baselines/`, seuil 0.5%), `node tools/check-design-system.js` (aucune couleur hex/rgb en dur hors `:root`, mode diff par défaut), `node tools/chaos-monkey.js` (audit red-team de `docs-backend.md`/`supabase-schema.sql`, mode local par défaut — `--allow-external` désactivé sauf accord explicite, voir le fichier).

## Outils de conception assistée (dev uniquement)

- **`ui-ux-pro-max-skill`** (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT) — skill Claude Code d'assistance UI/UX (67 styles, 161 palettes, 57 pairings de polices, 161 règles par secteur, checklists a11y). Installation dev : `npm i -g ui-ux-pro-max-cli && uipro init --ai claude`, ou `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill`.
- **`@21st-dev/magic-mcp`** (https://github.com/21st-dev/magic-mcp, MIT) — serveur MCP "Magic" qui génère des composants via `/ui <description>` dans Cursor/Windsurf/VSCode+Cline/Claude. Installation dev : `npx @21st-dev/cli@latest install <client> --api-key <clé>`. ⚠️ **Sortie React + TypeScript** (réécriture vanilla intégrale obligatoire, voir garde-fous) et **clé API + compte 21st.dev requis** (quota mensuel) — la clé ne va **JAMAIS** dans le repo (même règle que `docs/config.js`, gitignoré).
- **Usage autorisé : idéation et prototypage rapide UNIQUEMENT** — explorer des directions visuelles, des structures de page, des checklists d'accessibilité. Ce n'est **jamais** "la façon de construire l'UI de SEBA".
- **Garde-fous impératifs avant d'intégrer une seule ligne issue de ces outils :**
  - **Jamais de dépendance runtime.** SEBA est "zéro bundler, zéro framework, CDN only" (voir en-tête). Toute sortie React/Vue/Tailwind/Next doit être réécrite en HTML/CSS/JS vanilla + tokens SEBA avant d'entrer dans `docs/`.
  - **Réconciliation obligatoire avec le design system existant.** La sortie du skill doit être remappée sur les tokens SEBA — `pro-global.css` (pages app) ou "Tactical Dark Absolu" scopé `dashboard.html`/`widgets.js` — jamais ses propres palettes/hex. Ne pas fusionner les deux thèmes SEBA sans autorisation (voir section thème).
  - **`node tools/check-design-system.js` doit passer** (aucune couleur hex/rgb en dur hors `:root`) avant tout commit d'une page touchée par ce skill.
  - Outil **de dev**, il ne va jamais dans `docs/config.*`, `package.json` runtime, ni dans une page servie.

## Leçons apprises et anti-patterns

- **`grid-template-columns: 1fr` (seul) garde un `min-width:auto` implicite = min-content de son contenu.** Sur une page avec un tableau responsive (`table{min-width:560px}`), la piste de grille grandit jusqu'à cette largeur au lieu de tenir dans le viewport — tout le contenu (et un bouton hamburger mobile) se retrouve poussé hors écran, sans que `position:fixed` sur la sidebar ne soit en cause. Toujours écrire `minmax(0,1fr)` pour une colonne de grille censée occuper l'espace restant. (Trouvé 2026-07-08, `pro-global.css`.)
- **Une règle globale `.btn-em{width:100%!important;max-width:420px!important}` pensée pour un seul CTA marketing casse les barres d'outils à plusieurs boutons.** Sur une page avec 2-3 boutons `.btn-em` dans un même conteneur flex sans `flex-wrap`, chaque bouton est forcé individuellement à ~420px de large, ce qui déborde même après ajout d'un `flex-wrap`. Avant de réutiliser une classe partagée dans un nouveau contexte (toolbar vs hero CTA), vérifier les règles globales `@media` qui la ciblent. (Trouvé 2026-07-08, `pro-global.css`.)
- **Pour les scripts Puppeteer sur des pages locales (`file://`) qui chargent des CDN externes (GSAP, three.js) : utiliser `waitUntil:'domcontentloaded'`, jamais `'networkidle2'`.** Sans accès réseau (ou juste lent), les requêtes CDN ne se résolvent jamais et `networkidle2` attend indéfiniment jusqu'au timeout. `domcontentloaded` suffit pour du rendu visuel/QA. (Convention déjà dans `qa-dashboard-full.js` pour ses runs `--target=local` ; reproduit dans `qa-visual-regression.js`.)
- **Les éléments `.reveal{opacity:0}` (animation au scroll) restent invisibles sur un screenshot pleine page pris sans scroll réel.** Ce n'est pas un bug de rendu — juste `document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'))` avant la capture si le contenu sous ces éléments doit être inspecté.
