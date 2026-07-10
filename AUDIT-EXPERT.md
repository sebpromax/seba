# AUDIT-EXPERT — SEBA : conformité internationale & exigence Senior Architect

**Date** : 2026-07-10
**Mode** : Phase 1 — diagnostic uniquement, **zéro modification de code**.
**Simulation** : orchestrateur `agents_config.json` (cartographe → executeur → qa → visualqa → secops → archiviste), exécuté par un unique agent proxy (moi), aucune clé API tierce disponible dans cet environnement. Distinct de `product-agents.config.json` (agents produit en prod) — jamais fusionnés dans ce rapport.
**Portée** : analyse statique du code source réel (`git ls-files`, lecture directe, `grep`), aucune mesure runtime/navigateur. Chaque affirmation de ce rapport est sourcée par un fichier et, quand pertinent, une ligne précise — aucune évaluation "généralement conforme" sans preuve n'est admise ici.

---

## 1. Synthèse exécutive

Le socle technique (RLS Postgres, CORS restreint, absence de secrets committés, disjoncteur de coût IA) est **solide et cohérent** — vérifié sur les 9 Edge Functions, aucune régression trouvée sur ces axes. Le point noir réel : **une vulnérabilité XSS stockée systémique, non corrigée par le hotfix du 2026-07-06**, subsiste dans 3 pages métier critiques (factures, devis, planning) qui manipulent des données client réelles — le même bug que celui déjà patché ailleurs dans `clients.html`/`dashboard.html`, simplement pas répliqué partout. C'est le seul point **bloquant** de cet audit.

Le reste des écarts est de nature "produit mature mais jamais audité sous cet angle" : zéro métadonnée SEO (aucun sitemap, canonical, Open Graph, structured data), aucun mécanisme de consentement cookies malgré 3 intégrations tierces (Stripe/OneSignal/Sentry), pas de CGV distinctes de la politique de confidentialité, et une i18n inexistante (39/39 pages en `lang="fr"` figé) — acceptable si la cible reste la France, à confirmer. Le site n'a aucun build (`package.json` ne référence aucun bundler ni Tailwind), ce qui explique une fragilité repérée sur 17 pages "Lot" : elles utilisent des classes Tailwind sur un CSS **manuellement recopié** (`docs/styles/main.css`, 447 lignes) — toute nouvelle classe non répliquée à la main échoue silencieusement.

Rien dans cet audit ne nécessite une réécriture d'architecture. La majorité des correctifs sont chirurgicaux (une fonction `esc()` déjà écrite à réutiliser à 3 endroits, des balises `<link>`/`<meta>` à ajouter, 2 fichiers à re-encoder). Le seul chantier de fond identifié est décisionnel, pas technique : trancher le périmètre géographique/linguistique réel du produit avant d'investir dans l'i18n ou le SEO multi-pays.

---

## 2. Cartographie (Étape 1 — Cartographe)

### 2.1 Frontend (`docs/`, GitHub Pages, statique, zéro build)

**39 pages HTML**, réparties en 3 groupes distincts par usage réel (constaté par analyse des liens inter-pages, pas par nomenclature) :

| Groupe | Pages | Rôle |
|---|---|---|
| **Marketing/acquisition** | `index.html`, `product.html`, `tarifs.html`, `faq.html`, `confiance.html`, `comment-ca-marche.html`, `solution.html`, `probleme.html`, `onboarding.html`, `connexion.html`, `politique-confidentialite.html` | Funnel public, non authentifié |
| **Application métier** | `dashboard.html`, `clients.html`, `client-fiche.html`, `devis.html`, `devis-nouveau.html`, `factures.html`, `planning.html`, `equipe.html`, `employe-fiche.html`, `historique.html`, `reglages.html`, `client.html` | Authentifié (Supabase Auth), données réelles multi-tenant |
| **Galerie de concepts "Lot 1.x"** | `core-ux.html` (hub, référencé par 17 pages) + `bfr-predictif.html`, `cockpit-treso.html`, `compta-expert.html`, `agenda-elastique.html`, `crm-tech.html`, `contentieux-recouvrement.html`, `crypto-backup.html`, `flotte-telemetrie.html`, `haversine-engine.html`, `mutation-contextuelle.html`, `prevention-risques.html`, `registre-charges.html`, `rh-compagnonnage.html`, `signature-payment.html`, `studio-factures.html`, `trava-dechets.html` | **Publiquement déployées** (GitHub Pages sert tout `docs/`), non liées depuis `index.html`/`product.html`/`tarifs.html` — cluster isolé, atteignable uniquement par URL directe ou navigation interne au cluster |

**24 modules JS partagés** (`docs/*.js`) : `seba-data.js` (SebaDB, source de vérité), `auth.js`/`guard.js` (session), `stripe-service.js` (paiement), `photo-manager.js`/`ai-assistant.js`/`dashboard-alerts.js` (IA/terrain), `sentry-init.js`/`analytics-init.js`/`push-init.js` (observabilité), `widgets.js`/`sidebar.js`/`theme.js` (UI), `address-autocomplete.js`, `import-export.js`, `pdf-generator.js`, `logger.js`, `sw.js` (service worker). Architecture modulaire additionnelle sous `docs/src/` (`core/` event-bus, `modules/` auth/data/telemetry/ui-controller, `ui/` dashboard-init/event-bridge).

### 2.2 Backend (`supabase-functions/`, Deno Edge Functions)

**10 fonctions HTTP déployées** : `ai-relay.ts`, `assistant-technique.ts`, `daily-digest.ts` (cron), `embed-content.ts`, `employe-auth.ts`, `notify-alert.ts`, `send-email.ts`, `send-push.ts`, `sync-push.ts`, `vision-qa.ts`.
**8 modules partagés** (`_shared/`) : `conscience-seba.ts`, `llm-providers.ts`, `finance-analytics.ts`, `memoire-lookup.ts`, `embeddings.ts` + 3 fichiers `.test.ts` (Deno, non exécutés faute de CLI — dette déjà tracée dans `PLAN.md`).

**Agents produit** (`product-agents.config.json`, 5 agents) : `assistant_conversationnel`, `conscience_predictive`, `qa_visuelle_intervention`, `prediction_impayes` (non implémenté), `assistant_technique`. Distinct de `agents_config.json` (6 agents orchestrateur dev, jamais activés dans cette session faute de clés API — confirmé par absence de toute clé `GEMINI_API_KEY`/`GROQ_API_KEY` dans l'environnement).

### 2.3 Zones à fort risque identifiées (priorisées pour l'audit détaillé ci-dessous)

1. **Données client affichées** (`factures.html`, `devis.html`, `planning.html`, `client-fiche.html`) — tout champ texte libre (nom, service, notes) est potentiellement un vecteur XSS stocké si mal échappé.
2. **Paiement** (`stripe-service.js`, `signature-payment.html`) — clé publique uniquement côté client (vérifié), aucune clé secrète trouvée.
3. **Auth** (`auth.js`, `guard.js`, `employe-auth.ts`, `sync-push.ts`) — RLS Postgres + PIN employé + anti brute-force déjà auditée aux Paliers 1/Go-Live (voir `AUDIT-GO-LIVE-SEBA.md`), revérifiée ici pour régression.
4. **IA/coût** (`_shared/llm-providers.ts`, `ai-relay.ts`, `assistant-technique.ts`, `daily-digest.ts`) — disjoncteur global ajouté le 2026-07-09 (PR #46), revérifié ici.

---

## 3. Audit statique détaillé (Étape 2 — checklist A à H)

### A. Internationalisation / localisation

- **Constat** : les 39 pages HTML ont `<html lang="fr">` en dur, aucune exception. `grep` sur `hreflang` dans tout `docs/` : **0 résultat**. Aucun fichier de traduction, aucune fonction `t()`/`i18n.get()`, aucun mécanisme de sélection de langue trouvé dans `docs/*.js`.
- **Formats date/heure/devise** : `devis.html:319` utilise `new Date(d.date).toLocaleDateString('fr-FR', {...})` — locale `fr-FR` codée en dur, pas dérivée d'un paramètre utilisateur/compte. Le symbole monétaire (`_sym`, vu `devis.html:421`, `factures.html:170`) est une variable mais sa valeur par défaut n'a pas été tracée jusqu'à sa source dans cet audit statique (à vérifier : est-elle configurable par compte, ou fixée à `€` ?).
- **Verdict** : le produit est **mono-langue, mono-locale, mono-devise par défaut**, avec un couplage FR fort (RGPD, hébergement UE déjà documenté dans `politique-confidentialite.html`). Ce n'est **pas un défaut en soi** si la cible commerciale reste la France — c'est une **hypothèse à valider** (voir section 5), pas un bug.

### B. Accessibilité (WCAG 2.1 AA)

- **Images** : seulement **4 balises `<img>`** existent dans tout `docs/` (`crm-tech.html` ×2, `signature-payment.html` ×1, plus 1 payload de test dans `docs/src/test-ui-controller.js` qui n'est pas une vraie image). **Aucune des 3 images réelles n'a d'attribut `alt`** (`crm-tech.html: <img src="${p}" class="w-full h-full object-cover">`). Surface de risque faible en volume (le design évite les images au profit de SVG/CSS — 6 fichiers utilisent `<svg>`, 13 utilisent `background-image`), mais l'écart est réel et trivial à corriger.
- **Focus clavier** : `outline: none` appliqué sur `:focus` dans au moins 8 fichiers (`client-fiche.html:104`, `clients.html:41`, `clients.html:90`, `connexion.html:84`, `dashboard.html:474/599/639`, `devis-nouveau.html:63`, `employe-fiche.html:110`) — remplacé uniquement par un changement de `border-color`. **Calcul de contraste effectué manuellement** : `--emerald` (`#10B981`) sur `--white`/`--bg` (`#18181B`/`#09090B`) donne un ratio ≈ 4.9:1, ce qui **satisfait** le seuil 3:1 de WCAG 2.4.11 (Focus Appearance) pour un indicateur non-textuel — donc **pas une violation stricte**, mais un indicateur de focus reposant uniquement sur la couleur (pas de forme/épaisseur ajoutée) reste moins robuste que le double signal recommandé (couleur + contour), notamment pour les utilisateurs avec un déficit de vision des couleurs partiel.
- **Contraste texte général** : vérifié manuellement (formule WCAG relative luminance) pour la combinaison la plus utilisée du thème Tactical Dark : `--text-2:#A1A1AA` sur `--bg:#09090B` → ratio ≈ **7.7:1**, conforme **AAA** (seuil AA = 4.5:1, AAA = 7:1). C'est le seul calcul de contraste que je peux garantir sans outil automatisé — **le reste de la palette (badges de statut, hover states, thème clair de `pro-global.css`) n'a pas été vérifié systématiquement et nécessite un passage Lighthouse/axe-core réel**, je ne l'affirme pas conforme faute de preuve.
- **`aria-label`** : 21 occurrences trouvées dans `docs/*.html` — présence réelle mais non exhaustive (non vérifié champ par champ).
- **Verdict incertain explicite** : la navigation clavier complète (ordre de tabulation, pièges de focus dans les modales `ss-panel`/`ss-backdrop`) **ne peut pas être vérifiée statiquement** — nécessite un test manuel navigateur, à planifier.

### C. SEO international

- **`grep -rn "og:title|og:description|twitter:card|application/ld+json|rel=\"canonical\"|hreflang" docs/`** → **0 résultat, sur les 39 pages**. Aucune balise Open Graph, aucune Twitter Card, aucune donnée structurée `schema.org`, aucun `<link rel="canonical">`.
- **`sitemap.xml`** : absent (`ls docs/sitemap*` → aucun fichier).
- **`robots.txt`** : absent (`ls docs/robots*` → aucun fichier). Conséquence directe : les 17 pages "Lot" du cluster `core-ux.html` (section 2.1) ne sont ni explicitement autorisées ni bloquées à l'indexation — un moteur de recherche qui les découvre (lien externe, partage) les indexera par défaut, alors qu'elles semblent être des pages de démonstration interne.
- **Meta description** : présente sur `index.html:9` uniquement vérifiée — à confirmer sur le reste du funnel marketing (`product.html`, `tarifs.html`, `faq.html`).
- **Verdict** : **absence totale d'outillage SEO**, alors que le produit dépend d'une acquisition organique probable (SaaS B2B service business). C'est l'écart le plus impactant business après la XSS.

### D. Sécurité (OWASP Top 10, lecture seule)

**Points positifs vérifiés (pas de "globalement conforme" sans preuve — voici les preuves)** :
- **Secrets** : `grep` sur les patterns `sk_live_|sk_test_|gsk_...|AIza...|SUPABASE_SERVICE_ROLE_KEY` dans tout `docs/` → **0 résultat**. `docs/config.js` (le seul fichier pouvant contenir une vraie clé locale) est gitignoré (`.gitignore` ligne 2) et **absent de tout l'historique git** (`git log --all -- docs/config.js` → vide, jamais committé). `docs/config.public.js` ne contient que l'URL Supabase + une clé `sb_publishable_...` (format publishable, protection assurée par RLS, pas par le secret de la clé).
- **CORS** : les 9 fonctions HTTP-exposées utilisent **la même allowlist stricte** (`ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791']`), vérifié fichier par fichier — **aucun `Access-Control-Allow-Origin: '*'` trouvé nulle part**. `daily-digest.ts` n'a délibérément aucun CORS (appelé uniquement par `pg_cron` côté serveur, jamais par un navigateur).
- **RLS Postgres** : chaque table métier (`seba_state`, `clients`, `interventions`, `qa_photos`, `materiaux_couts`, `paiements`, `memoire_embeddings`, `api_usage`, `api_usage_daily`) a RLS activée, vérifiée table par table dans `supabase-schema.sql` lors des sessions précédentes de ce projet (Paliers 1-5) — non re-dérivée ligne à ligne ici par souci de budget, mais cohérente avec les `REVOKE EXECUTE` trouvés sur les fonctions sensibles (`call_notify_alert`, `apply_entity_patch`, `match_interventions`, `increment_api_usage`).
- **Disjoncteur de coût IA** (ajouté 2026-07-09) : `_shared/llm-providers.ts` — `enforceUsageGuardrail()` fail-closed, appelée dans `callWithFallback()` et `decideAvecLLM()`, protège contre un dépassement de coût agrégé sur les clés Mistral/Groq/Gemini/OpenRouter partagées.

**Point bloquant trouvé** :
- **XSS stockée non corrigée, 3 pages** — voir tableau des écarts (section 4, écart #1). C'est une régression de couverture, pas une régression de correctif : le hotfix du 2026-07-06 a bien fonctionné là où il a été appliqué (`dashboard.html`, `clients.html`, `equipe.html`, `crm-tech.html` utilisent tous `esc()`), mais n'a jamais été étendu aux pages ajoutées/existantes qui manipulent le même type de données.

**Injections SQL** : aucune construction de requête SQL par concaténation de chaîne trouvée — tout passe par PostgREST (`supabase-js` ou `fetch()` vers `/rest/v1/`) ou des fonctions Postgres paramétrées (`p_account`, `p_intervention_id`), donc pas de surface d'injection SQL classique identifiée.

**RGPD sur formulaires** : `SebaDB.exportJSON()` et `eraseAllData()` confirmés présents dans `docs/seba-data.js`, avec déclenchement UI dans `docs/reglages.html` — Art. 15/17/20 RGPD techniquement couverts côté données applicatives.

### E. Légal / conformité

- **Politique de confidentialité** : présente (`docs/politique-confidentialite.html`), déjà auditée en 2026-07-08 avec réserve documentée : identité juridique du responsable de traitement marquée `[À compléter par le fondateur]` — **toujours non complétée** à la date de cet audit (relu, la mention est toujours présente).
- **CGU/CGV** : **absentes**. Aucun fichier `docs/cgu*`, `docs/cgv*`, `docs/mentions-legales*` trouvé. Un SaaS français encaissant des paiements via Stripe (`stripe-service.js`) est concerné par le Code de la consommation (informations précontractuelles, droit de rétractation le cas échéant pour les non-professionnels, conditions de résiliation) — une politique de confidentialité seule ne couvre pas ces obligations contractuelles.
- **Consentement cookies** : `grep -i cookie` sur tout `docs/*.html` ne retourne **aucune bannière de consentement réelle** (le seul résultat, `dashboard.html:1205`, est le nom d'un chat dans une donnée de démonstration, pas un mécanisme RGPD). Le site intègre Stripe (iframe/redirect), OneSignal (push, `onesignalAppId` dans `config.public.js`) et Sentry (`sentry-init.js`) — Umami (analytics) est documenté comme "respectueux du RGPD"/sans cookie dans `MANUEL-SEBA-ADMIN.md` (non re-vérifié techniquement ici), mais Stripe et OneSignal peuvent déposer des cookies/utiliser du stockage local selon leur configuration exacte, ce qui **peut nécessiter un consentement préalable** selon les recommandations CNIL — point à faire trancher par un professionnel du droit, comme déjà noté pour la politique de confidentialité elle-même.

### F. Performance & responsive (analyse statique — pas de mesure runtime)

- **Chargement de scripts** : dans `dashboard.html`, `theme.js`, `auth.js`, `guard.js`, `sidebar.js`, `businessTypes.js`, `seba-data.js`, `widgets.js` et les CDN **SortableJS** et **D3.js** (`dashboard.html:936-938`) sont chargés **sans `defer` ni `async`**, en plein corps de page (ligne 934-938) — bloquant le parsing HTML jusqu'à leur téléchargement + exécution complète. D3 (librairie complète de visualisation, non tree-shaked puisqu'aucun bundler n'existe) est un poids non négligeable pour une simple dashboard. À l'inverse, `sentry-init.js`, `analytics-init.js`, `ai-assistant.js`, `push-init.js`, `logger.js` utilisent correctement `defer` (lignes 687-688, 939-941), et `src/ui/dashboard-init.js` est chargé en `type="module"` (déféré nativement par la spec HTML) — donc la pratique existe déjà dans le projet, juste incomplètement appliquée.
- **Zéro bundler** (confirmé, `package.json` sans dépendance de build) : chaque page charge séparément ses modules JS non minifiés — cohérent avec le choix architectural documenté dans `CLAUDE.md` ("zéro bundler, zéro framework"), mais cela a un coût réseau réel (autant de requêtes HTTP que de fichiers `<script src>`, pas de minification).
- **Images** : quasi absentes (section B) — la stratégie "no decoration" du produit limite drastiquement le poids visuel, un vrai point fort pour la performance perçue (LCP) même sans mesure réelle possible ici.
- **Service Worker** (`docs/sw.js`) : stratégie correcte et documentée en commentaire — Network-First pour le HTML de navigation (repli cache si hors-ligne, vers `dashboard.html`), Cache-First pour les assets statiques, avec nettoyage des caches obsolètes à l'activation (`sw.js:32`). Bon signal de maturité PWA.
- **`manifest.json`** : présent et complet (icônes 192/512, `display: standalone`, couleurs de thème cohérentes avec la charte).
- **Viewport** : `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` confirmé sur `index.html:5`, cohérent avec les media queries responsive déjà auditées/corrigées dans `pro-global.css` lors du chantier mobile du 2026-07-08 (bug `grid-template-columns:1fr` sans `minmax(0,1fr)`, déjà résolu et documenté dans `PLAN.md`).

### G. Compatibilité navigateurs (analyse statique — pas de test cross-browser réel)

- **`backdrop-filter`** utilisé dans 22 fichiers. **`-webkit-backdrop-filter` (préfixe requis pour Safari desktop/iOS) présent dans 20 d'entre eux — absent précisément sur `docs/faq.html` et `docs/tarifs.html`.** Conséquence concrète : sur Safari, les effets de flou (glassmorphism) de ces 2 pages spécifiques ne s'appliqueront pas (dégradation silencieuse, pas de crash, mais incohérence visuelle sur des pages du funnel marketing public).
- **Syntaxe JS récente sans repli** : recherche ciblée sur `structuredClone`, `.at(-1)`, `??=`, `Object.hasOwn`, `Array.fromAsync` dans `docs/*.js` → **0 résultat**. Le code utilise un JS conservateur (vérifié également : 0 usage d'optional chaining `?.` dans `docs/*.js` à la racine — la syntaxe la plus "moderne" trouvée reste des template literals et des arrow functions, largement supportées depuis 2017+). **Bon point** : pas de risque d'incompatibilité sur ce plan.
- **Polyfills** : aucun polyfill explicite trouvé (`core-js`, etc.) — cohérent avec l'absence de syntaxe récente nécessitant un repli.

### H. Qualité de code / architecture

- **Encodage incohérent** : **15 des 17 pages du cluster "Lot"** (`core-ux.html`, `crm-tech.html`, `compta-expert.html`, `agenda-elastique.html` — non, celle-ci ne l'a pas — voir liste précise ci-dessous) commencent par un **BOM UTF-8** (`EF BB BF`), contrairement à **toutes** les pages de l'application métier (`dashboard.html`, `clients.html`, `devis.html`, `factures.html`, `planning.html`, `equipe.html`, `historique.html`, `client-fiche.html`, `employe-fiche.html`, `reglages.html`, `connexion.html`, `index.html`) qui sont **toutes propres**. Fichiers concernés (vérifiés octet par octet) : `bfr-predictif.html`, `compta-expert.html`, `core-ux.html`, `crm-tech.html`, `contentieux-recouvrement.html`, `crypto-backup.html`, `flotte-telemetrie.html`, `haversine-engine.html`, `mutation-contextuelle.html`, `prevention-risques.html`, `registre-charges.html`, `rh-compagnonnage.html`, `signature-payment.html`, `studio-factures.html`, `trava-dechets.html` (`cockpit-treso.html` et `agenda-elastique.html` sont, elles, propres). **Exactement la même signature** (`EF BB BF`) que celle diagnostiquée et corrigée le 2026-07-09 dans `.vscode/settings.json` (export PowerShell `ConvertTo-Json`/`Out-File`, encodage UTF-8 BOM par défaut) — indique que ce cluster de pages a été généré/édité par un outil ou pipeline différent des pages métier.
- **CSS Tailwind répliqué à la main** : `docs/styles/main.css` (447 lignes) porte l'en-tête `"Replicates the exact Tailwind utilities used across the prototype pages"` — confirmé, aucune dépendance Tailwind dans `package.json`, aucun script CDN Tailwind trouvé dans les pages "Lot". Risque concret : toute nouvelle classe Tailwind utilisée dans une page HTML mais non répliquée manuellement dans `main.css` **échoue silencieusement** (pas d'erreur, juste un élément non stylé) — dette de maintenabilité réelle, déjà en tension avec le fait que ces pages représentent 17 fichiers à garder synchronisés à la main avec un unique fichier CSS.
- **Duplication du pattern `esc()`** : la fonction est dupliquée (pas partagée via un module commun) dans au moins `clients.html:286`, `dashboard.html`, `equipe.html`, `crm-tech.html` — chacune une copie indépendante du même code. Fonctionnellement correct aujourd'hui, mais explique en partie pourquoi son adoption est incomplète (section D) : il n'existe aucun module central `esc.js` importé partout, donc rien ne rappelle systématiquement à un développeur de l'utiliser sur une nouvelle page.
- **Gestion d'erreurs backend** : cohérente et intentionnelle (vérifiée sur l'ensemble des Edge Functions lors des sessions précédentes) — fail-open documenté pour les quotas UX (`checkRateLimit`), fail-closed délibéré pour le disjoncteur de coût (`enforceUsageGuardrail`), timeouts `AbortSignal.timeout(5000)` uniformes. Pas de nouvelle régression trouvée sur ce point dans cet audit.
- **Tests** : 3 fichiers `_shared/*.test.ts` (Deno, jamais exécutés faute de CLI — dette déjà dans `PLAN.md`), 6 fichiers `docs/src/test-*.js` (Node, réellement exécutables et exécutés à chaque session de ce projet), ~45 scripts `scripts/verify-*.js`/`scripts/qa-*.js` — volume de tooling QA important mais dispersé, aucun script ne couvre spécifiquement `factures.html`/`devis.html`/`planning.html` pour une régression XSS (voir section 4, écart #1).

---

## 4. Tableau des écarts (par sévérité)

| # | Sévérité | Titre | Fichier(s) |
|---|---|---|---|
| 1 | 🔴 **Bloquant** | XSS stockée non échappée — factures/devis/planning | `factures.html:169`, `devis.html:309-337,420`, `planning.html:276` |
| 2 | 🟠 Important | Absence totale de métadonnées SEO (sitemap, robots.txt, canonical, OG, structured data) | Tout `docs/` |
| 3 | 🟠 Important | Aucun mécanisme de consentement cookies malgré 3 intégrations tierces | Tout `docs/`, `config.public.js` |
| 4 | 🟠 Important | Absence de CGU/CGV distinctes de la politique de confidentialité | `docs/` (fichier manquant) |
| 5 | 🟠 Important | Identité juridique du responsable de traitement toujours non complétée | `docs/politique-confidentialite.html` |
| 6 | 🟠 Important | CSS Tailwind répliqué manuellement sans build (fragilité silencieuse) | `docs/styles/main.css` + 17 pages "Lot" |
| 7 | 🟠 Important | Scripts bloquants non différés (D3, SortableJS, 6 fichiers first-party) | `dashboard.html:934-938` |
| 8 | 🟡 Mineur | UTF-8 BOM sur 15 pages du cluster "Lot" | 15 fichiers listés section 3.H |
| 9 | 🟡 Mineur | `-webkit-backdrop-filter` manquant (Safari) | `faq.html`, `tarifs.html` |
| 10 | 🟡 Mineur | 3 `<img>` sans attribut `alt` | `crm-tech.html` ×2, `signature-payment.html` |
| 11 | 🟡 Mineur | Indicateur de focus clavier reposant uniquement sur la couleur | 8 fichiers listés section 3.B |
| 12 | 🟡 Mineur | i18n inexistante (hypothèse à trancher, pas un bug en soi) | Tout `docs/` |
| 13 | 🟡 Mineur | Cluster "Lot" publiquement indexable sans robots.txt, non lié au funnel principal | 17 pages, section 2.1 |
| 14 | 🟡 Mineur | `esc()` dupliqué au lieu d'un module partagé | `clients.html`, `dashboard.html`, `equipe.html`, `crm-tech.html` |

---

## 5. Détail des écarts

### Écart #1 — XSS stockée non échappée (BLOQUANT)

**Fichiers/preuves** :
- `factures.html:169` — `tbody.innerHTML = list.map(f => { ... return '<tr>...' + f.clientName + '...' + f.service + '...'; })`
- `devis.html:420` — même pattern avec `d.client`/`d.service` dans la liste, **et** `devis.html:309-337` (`buildReceipt()`) qui interpole `d.client`, `d.service`, `l.desc` (ligne de devis), `h.label` (historique), `_bizName` dans un template literal injecté en `innerHTML` (`devis.html:301-302`) — c'est l'aperçu du devis, potentiellement montré/imprimé au client final.
- `planning.html:276` — `div.innerHTML = \`...${job.client}...${job.service}...\`` dans le rendu du planning hebdomadaire.

**Pourquoi c'est bloquant** : ces 4 champs (`clientName`/`client`, `service`, `desc`, `label`) sont des données saisies par un utilisateur (patron ou employé via `employe_credentials`/`employe_sessions`, système d'identité multi-utilisateur déjà en place) et stockées dans `seba_state.state` (blob JSON, aucune validation de contenu HTML côté serveur ni côté client à la saisie). Un nom de client ou une description de service contenant `<img src=x onerror=...>` s'exécute au rendu, sans interaction de la victime au-delà d'ouvrir la page. Le vecteur d'escalade le plus concret : un **employé** (accès PIN, périmètre plus restreint par nature) saisit un nom de client piégé lors d'une intervention terrain ; le **patron** (session complète, tous les droits) ouvre ensuite `factures.html`/`devis.html`/`planning.html` et exécute le payload dans son propre navigateur authentifié — élévation de privilège employé → patron.

**Ce qui manque n'est pas un concept nouveau** : la fonction `esc()` (échappement HTML basique : `&`, `<`, `>`, `"`, `'`) existe déjà, testée, dans `clients.html:286-290` et 3 autres fichiers. Le hotfix du 2026-07-06 (commit historique) l'a appliquée à `dashboard.html`/`clients.html`/`equipe.html`/`crm-tech.html` mais n'a jamais couvert `factures.html`/`devis.html`/`planning.html`, qui manipulent pourtant exactement le même type de données.

**Recommandation** : appliquer `esc()` (ou une version centralisée dans un module partagé, ce qui réglerait aussi l'écart #14) à chaque interpolation listée ci-dessus, dans les 3 fichiers. Correctif mécanique, pas de refonte.
**Effort estimé** : 2-3h (localisation précise déjà faite par cet audit, + vérification visuelle que l'échappement n'casse pas l'affichage des caractères accentués/apostrophes déjà présents en donnée réelle).
**Risque si non corrigé** : compromission de session patron depuis un compte employé à privilège réduit ; vol de session, action arbitraire sur le compte (export de données clients, modification de factures).

### Écart #2 — Absence de SEO technique (IMPORTANT)

**Preuve** : `grep` documenté en section 3.C, 0 résultat sur canonical/OG/Twitter/structured-data/sitemap/robots sur les 39 pages.
**Recommandation** : `robots.txt` (bloquant a minima le cluster "Lot") + `sitemap.xml` (funnel marketing uniquement) + balises `og:title`/`og:description`/`og:image`/`twitter:card` sur les pages marketing + `<link rel="canonical">` systématique.
**Effort estimé** : 1-2 jours (contenu + balisage sur ~11 pages marketing prioritaires, le reste peut suivre).
**Risque si non corrigé** : acquisition organique et partage social dégradés (aucune image de prévisualisation, aucun résumé) ; risque de contenu dupliqué indexé sans canonical si le site est un jour servi sur plusieurs domaines/sous-domaines.

### Écart #3 — Aucun consentement cookies (IMPORTANT)

**Preuve** : section 3.E, `grep -i cookie` ne retourne aucun mécanisme réel ; `onesignalAppId` dans `config.public.js`, `sentry-init.js`, `stripe-service.js` confirmés intégrés.
**Recommandation** : audit juridique dédié (déjà recommandé pour la politique de confidentialité elle-même, voir écart #5) pour déterminer si Stripe/OneSignal/Sentry, tels que configurés, nécessitent un consentement CNIL — puis implémenter une bannière minimale si oui.
**Effort estimé** : 0.5j (audit juridique) + 1j (implémentation si nécessaire).
**Risque si non corrigé** : non-conformité RGPD/ePrivacy potentielle, sanction CNIL en cas de plainte (probabilité faible à ce stade de traction, mais expositions croissante avec le volume d'utilisateurs).

### Écart #4 — Absence de CGU/CGV (IMPORTANT)

**Preuve** : aucun fichier `docs/cgu*`/`cgv*`/`mentions-legales*` (section 3.E).
**Recommandation** : rédaction de CGV a minima (obligatoire pour la vente en ligne en France) — même traitement que la politique de confidentialité initiale (contenu factuel généré, relu par un professionnel avant mise à l'échelle commerciale).
**Effort estimé** : 0.5-1j de rédaction + relecture juridique externe (non estimable ici).
**Risque si non corrigé** : non-conformité au Code de la consommation dès la première vente réelle via Stripe.

### Écart #5 — Identité juridique non complétée (IMPORTANT)

**Preuve** : `politique-confidentialite.html` contient toujours `[À compléter par le fondateur]` (relu à la date de cet audit).
**Recommandation** : action humaine uniquement — fournir SIREN/raison sociale/adresse.
**Effort estimé** : instantané côté fondateur, 15 min côté intégration.
**Risque si non corrigé** : politique de confidentialité juridiquement incomplète (obligation d'identification du responsable de traitement, Art. 13 RGPD).

### Écart #6 — CSS Tailwind répliqué manuellement (IMPORTANT)

**Preuve** : section 3.H, `docs/styles/main.css` (447 lignes, en-tête explicite "Replicates the exact Tailwind utilities"), aucune dépendance Tailwind dans `package.json`.
**Recommandation** : soit migrer ces 17 pages vers le design system existant (`pro-global.css`/Tactical Dark) pour éliminer la duplication de système visuel, soit introduire un vrai build Tailwind isolé à ce cluster (CDN runtime `cdn.tailwindcss.com` en dev, ou build statique) pour ne plus dépendre d'une réplique manuelle.
**Effort estimé** : 2-3j (dépend du choix : migration vs vrai build).
**Risque si non corrigé** : toute nouvelle page/section dans ce cluster utilisant une classe Tailwind non répliquée s'affiche cassée sans erreur visible — bug silencieux difficile à détecter en revue de code.

### Écart #7 — Scripts bloquants non différés (IMPORTANT)

**Preuve** : `dashboard.html:934-938`, section 3.F.
**Recommandation** : ajouter `defer` à `theme.js`\*, `auth.js`, `guard.js`, `sidebar.js`, `businessTypes.js`, `seba-data.js`, `widgets.js`, SortableJS, D3 — \*sauf le script de prévention de flash de thème (ligne 6), qui doit rester synchrone et bloquant par nature (inline, avant le premier paint). Vérifier l'ordre de dépendance entre ces scripts avant de différer (certains peuvent dépendre d'un autre déjà chargé de façon synchrone).
**Effort estimé** : 0.5j (ajout des attributs + test de non-régression sur l'ordre d'exécution).
**Risque si non corrigé** : temps de rendu initial (FCP/LCP) dégradé sur connexions lentes, particulièrement pénalisant sur mobile.

### Écarts #8-14 (MINEURS)

| # | Recommandation | Effort |
|---|---|---|
| 8 | Ré-encoder les 15 fichiers en UTF-8 sans BOM (même correctif que `.vscode/settings.json`, 2026-07-09) | 15 min |
| 9 | Ajouter `-webkit-backdrop-filter` sur `faq.html`/`tarifs.html` | 5 min |
| 10 | Ajouter `alt=""` (décoratif) ou `alt="description"` sur les 3 `<img>` | 10 min |
| 11 | Remplacer `outline:none` par un style de focus explicite (`box-shadow`/`outline` visible en plus du changement de couleur) | 1h |
| 12 | Décision produit à trancher (voir hypothèses) — pas d'effort technique tant que la décision n'est pas prise | — |
| 13 | Ajouter `robots.txt` avec `Disallow` sur le cluster si non destiné à l'indexation (couvert par écart #2) | inclus dans #2 |
| 14 | Extraire `esc()` dans un module partagé importé partout | 1h |

---

## 6. Étape 3 — QA simulée

### 6.1 Scripts à lancer en priorité sur les zones à risque identifiées

Aucun script existant (`scripts/qa-*.js`, ~45 fichiers `verify-*.js`) ne couvre spécifiquement l'écart #1 (XSS factures/devis/planning) — c'est un vrai trou de couverture QA, pas seulement un trou de code. Priorité recommandée pour la suite existante :

1. **`node scripts/qa-dashboard-full.js --target=local --viewport=desktop`** puis `--viewport=mobile` — couvre le dashboard, zone la plus fréquemment modifiée cette session (garde-fous IA, télémétrie).
2. **`node tools/check-design-system.js`** — pertinent si un correctif touche `pro-global.css`/`main.css` (écart #6).
3. **`node scripts/qa-visual-regression.js`** — à lancer après tout correctif visuel (écarts #9, #11) pour confirmer l'absence de régression pixel sur les pages déjà validées.
4. **`node scripts/qa-other-linkcheck.js`** — pertinent pour vérifier qu'aucun lien mort n'apparaît si `robots.txt`/liens internes sont ajoutés (écart #2/#13).

### 6.2 Script manquant à créer (recommandation, pas d'exécution en Phase 1)

Un script `qa-xss-injection.js` (Puppeteer, même pattern que les scripts `verify-*.js` existants) qui : injecte un client/devis/intervention avec un nom contenant `<img src=x onerror=window.__xss=1>` via `SebaDB.create()`, charge `factures.html`/`devis.html`/`planning.html`, et vérifie que `window.__xss` n'est jamais défini. Ce script deviendrait un test de non-régression permanent pour l'écart #1 une fois corrigé — actuellement, rien dans la suite ne l'aurait détecté.

### 6.3 Stratégie de QA visuelle (pas de capture d'écran réelle possible ici)

Basée sur les fichiers de design (`pro-global.css`, `docs/src/ui/theme.css`, `docs/styles/main.css`) : les captures de référence existantes dans `docs/visual-baselines/` (mentionnées dans `CLAUDE.md`, non ré-inspectées ici) couvrent vraisemblablement les pages métier (Tactical Dark) mais **probablement pas le cluster "Lot"** (thème Tailwind distinct, jamais mentionné dans les baselines connues) — à confirmer avant de lancer `qa-visual-regression.js` dessus, sous peine de faux positifs massifs (tout le cluster serait "différent" faute de baseline existante).

---

## 7. Hypothèses posées (à valider par le client)

1. **Cible géographique/linguistique** : hypothèse posée = France uniquement (cohérent avec `lang="fr"` partout, hébergement Supabase UE déjà documenté, RGPD comme seul cadre légal traité). Si une expansion multi-pays/multi-langue est prévue à moyen terme, les écarts #2 (SEO) et #12 (i18n) changent de sévérité (importants → bloquants) et méritent d'être traités avant le SEO plutôt qu'après.
2. **Navigateurs cibles** : hypothèse posée = Chrome/Safari/Firefox/Edge desktop + Safari iOS/Chrome Android récents (standard 2026). L'écart #9 (`-webkit-backdrop-filter`) n'a de sens que sous cette hypothèse — si Safari n'est pas dans le périmètre cible, cet écart devient non pertinent.
3. **Statut du cluster "Lot"** : hypothèse posée = pages de prototypage/démonstration interne, pas destinées à un usage commercial public actif (absence de lien depuis le funnel principal). Si elles sont en réalité destinées à devenir des pages produit publiques, leur priorité de correction (SEO, a11y, browser compat) doit remonter au niveau du funnel marketing principal.
4. **Configuration exacte de Stripe/OneSignal côté cookies** : non vérifiable statiquement (dépend de leur dashboard de configuration, pas du code de ce repo) — hypothèse posée = configuration par défaut, susceptible de déposer des cookies. À confirmer techniquement (inspection réseau réelle) avant de trancher l'écart #3.
5. **Contraste de couleur exhaustif** : seuls 2 combos ont été vérifiés par calcul manuel (section 3.B) et jugés conformes. Le reste de la palette (badges, hover, thème clair) est une zone grise non auditée faute d'outil — hypothèse de travail = probablement conforme (l'équipe a déjà une charte de contraste implicite cohérente sur les 2 combos vérifiés), à confirmer par Lighthouse/axe-core.

---

## 8. TODO priorisée et actionnable

- [ ] **[BLOQUANT]** Appliquer `esc()` aux interpolations de `factures.html:169`, `devis.html:309-337,420`, `planning.html:276` (écart #1)
- [ ] **[BLOQUANT]** Créer `scripts/qa-xss-injection.js` pour verrouiller la correction ci-dessus dans le temps (section 6.2)
- [ ] **[IMPORTANT]** Trancher l'hypothèse #1 (cible géo/langue) — conditionne la priorité réelle du SEO et de l'i18n
- [ ] **[IMPORTANT]** Ajouter `robots.txt` + `sitemap.xml` + balises OG/Twitter/canonical sur les 11 pages marketing (écart #2)
- [ ] **[IMPORTANT]** Faire trancher par un professionnel du droit : consentement cookies (écart #3) et rédaction CGV (écart #4) — même réserve déjà posée pour la politique de confidentialité
- [ ] **[IMPORTANT]** Fondateur : compléter l'identité juridique dans `politique-confidentialite.html` (écart #5)
- [ ] **[IMPORTANT]** Décider du sort du cluster "Lot" (migration design system vs vrai build Tailwind vs statu quo assumé) (écart #6)
- [ ] **[IMPORTANT]** Ajouter `defer` aux scripts bloquants de `dashboard.html` (écart #7), avec vérification de l'ordre de dépendance
- [ ] **[MINEUR]** Ré-encoder les 15 fichiers BOM en UTF-8 propre (écart #8)
- [ ] **[MINEUR]** `-webkit-backdrop-filter` sur `faq.html`/`tarifs.html` (écart #9)
- [ ] **[MINEUR]** `alt` sur les 3 `<img>` (écart #10)
- [ ] **[MINEUR]** Focus visible renforcé au-delà du changement de couleur seul (écart #11)
- [ ] **[MINEUR]** Extraire `esc()` en module partagé (écart #14) — traiter en même temps que l'écart #1 pour éviter une 4e copie
- [ ] **[VALIDATION HUMAINE REQUISE]** Passage Lighthouse/axe-core réel (contraste exhaustif, Core Web Vitals mesurés) — impossible à produire dans cet environnement statique
- [ ] **[VALIDATION HUMAINE REQUISE]** Test manuel de navigation clavier complète sur les modales (`ss-panel`/`ss-backdrop`)
- [ ] **[VALIDATION HUMAINE REQUISE]** Test cross-browser réel (Safari en particulier, vu écart #9)

---

*Rapport généré en Phase 1 (diagnostic uniquement). Aucun fichier de code n'a été modifié. `PROGRESS.md`/`PLAN.md` non touchés — ce rapport est autonome, à intégrer manuellement dans la roadmap si les correctifs ci-dessus sont retenus.*
