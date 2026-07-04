# Seba — Architecture & plan de refonte premium (v1.0)

Audit réalisé le 2026-07-04 sur l'intégralité de `docs/` (39 pages HTML, 5 assets JS/CSS partagés).

## 1. État des lieux

### Assets réellement partagés
| Fichier | Rôle | Pages consommatrices |
|---|---|---|
| `docs/pro-global.css` | Design system des pages "pro" (tokens, sidebar, badges, skeletons, nav mobile) | 11 pages (dashboard, clients, planning, devis, factures, équipe, réglages, historique, fiches) |
| `docs/widgets.js` | Moteur de widgets du dashboard (catalogue, grille S/M/L/XL, drag-and-drop, layout persistant, règles compagnon, barre IA) | dashboard.html |
| `docs/sidebar.js` | Rendu de la sidebar unifiée | pages pro |
| `docs/businessTypes.js` | Référentiel secteurs/métiers | dashboard, onboarding |
| `docs/animations-vitrine.js` | Animations de la landing | index.html |

Les pages vitrine (`index`, `onboarding`, `connexion`, `product`, `tarifs`, `faq`…) sont **autonomes** : chacune embarque son propre `<style>`. Toute correction y est locale.

### Bugs mobiles confirmés par mesure (viewport 390×844)
1. **Hero index.html** — `line-height` trop serré sur le titre multi-lignes (`36.8px` pour une police de `35.1px`, ratio 1.05) : le `<span class="headline-gradient">` (158px) déborde de son `<h1>` (147px) → lignes qui se chevauchent visuellement sur certains rendus.
2. **Onboarding, étapes courtes (ex. step-1)** — la boîte d'étape fait 907px de haut pour 844px de viewport alors que le contenu s'arrête à ~555px : ~350px de vide fantôme sous le bouton "Continuer".
3. **Onboarding, étape 2 (grille métiers)** — chevauchement mesuré (`overlap:true`) entre le bas de la grille de sélection (bottom 766px) et la barre de boutons sticky (top 677px) : le dégradé actuel masque partiellement les tuiles.

## 2. Design system — variables à créer

Étendues dans le `:root` de `pro-global.css` (pages pro) **et** dans le `:root` local des pages vitrine touchées (`index.html`, `onboarding.html`) :

```css
/* Échelle d'espacement (base 4px) */
--spacing-1: 4px;  --spacing-2: 8px;   --spacing-3: 12px; --spacing-4: 16px;
--spacing-5: 20px; --spacing-6: 24px;  --spacing-7: 32px; --spacing-8: 40px;
--spacing-9: 48px; --spacing-10: 64px;

/* Typographie */
--font-size-xs: .72rem; --font-size-sm: .84rem; --font-size-base: .95rem;
--font-size-lg: 1.15rem; --font-size-xl: 1.5rem; --font-size-2xl: 2.1rem;
--line-height-tight: 1.12; --line-height-base: 1.5;

/* Ombres et lueurs */
--shadow-sm: 0 1px 4px rgba(0,0,0,.06);
--shadow-md: 0 4px 16px rgba(0,0,0,.10);
--shadow-lg: 0 16px 48px rgba(0,0,0,.18);
--shadow-glow: 0 0 0 1px rgba(0,200,150,.28), 0 4px 24px rgba(0,200,150,.12);
```

Couleurs : déjà tokenisées (`--ink/--emerald/--plum/--bg/--border/--text-2` côté pro ; `--em/--ink/--t2/--t3/--bd` côté vitrine). Conservées telles quelles — un renommage global serait un risque de régression sans gain utilisateur.

## 3. Fichiers à refactoriser

| Fichier | Intervention |
|---|---|
| `docs/pro-global.css` | + tokens spacing/typo/ombres ; base du glassmorphism dashboard |
| `docs/index.html` | Fix hero (`line-height` mobile) ; tokens locaux |
| `docs/onboarding.html` | Fix vide fantôme (bouton collé au flux, `margin-top:auto`) ; fix chevauchement (sticky propre + `backdrop-filter`) ; tokens locaux |
| `docs/dashboard.html` + `docs/widgets.js` | Dashboard élite : D3.js (courbe lissée, tooltip, dégradé), glassmorphism, bordures lumineuses, données réalistes, micro-interactions |

**Non touchés volontairement** : les ~25 autres pages (outils "lot", pages produit) fonctionnent ; un refactor aveugle de leurs styles locaux serait du risque sans bénéfice. Elles adopteront les tokens au fil de l'eau.

## 4. Contraintes non négociables
- **Desktop intact** : toute correction mobile vit dans des media queries `max-width` ; vérification screenshot avant/après à chaque étape.
- **Moteur de widgets conservé** : le dashboard élite enrichit `widgets.js` (rendu, data-viz, styles), il ne remplace pas l'architecture modulaire.
- **Zéro framework** : HTML sémantique, CSS custom, JS vanilla, D3 en CDN (pattern existant).
- **Vérification continue** : pipeline headless Puppeteer (mobile 390px + desktop 1440px, erreurs console, parcours complet) avant chaque commit.

## 5. Séquence d'exécution
0. Ce document + commit `chore`.
1. Design system + 3 fixes mobiles + responsive → commit `fix`.
2. Dashboard élite (D3, glass, data) → commit `feat`.
3. Animations & micro-interactions → commit `feat`.
4. QA navigation complète + `release-notes-seba.md` → commit `chore` + `git push` + contrôle du déploiement réel.
