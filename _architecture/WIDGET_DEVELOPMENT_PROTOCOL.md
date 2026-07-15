# 🧩 WIDGET_DEVELOPMENT_PROTOCOL.md — Ajouter un widget au dashboard

*Décrit l'état réel du moteur de widgets au 2026-07-15 (voir `CHANGELOG.md`, section "Première migration réelle... + widgets par domaine métier"). Pas un plan futur — chaque étape ci-dessous correspond à du code qui existe déjà dans `docs/widgets.js` et `docs/services/config-dashboard.js`.*

---

## 0. Ce qu'il faut savoir avant de commencer

Le dashboard n'a **pas** un fichier par widget. C'est un choix assumé (voir `CHANGELOG.md` 2026-07-15) : le moteur existant (`WIDGET_CATALOG`, `renderGrid()`, drag & drop, persistance localStorage, recherche par mots-clés) vivait déjà entièrement dans `docs/widgets.js` avant qu'on touche quoi que ce soit, et on a choisi de ne pas le fragmenter/dupliquer pour un gain marginal. Un widget = **une entrée dans `window.WIDGET_CATALOG`**, pas un module séparé.

Deux fichiers différents, deux responsabilités différentes — à ne pas confondre :
- **`docs/widgets.js` (`WIDGET_CATALOG`)** : fait exister le widget. Sans entrée ici, le widget n'apparaît nulle part (ni tiroir d'extensions, ni recherche, ni disposition par défaut).
- **`docs/services/config-dashboard.js`** : décide, pour un secteur donné, si ce widget (qui existe déjà) doit être **visible par défaut** avant que l'utilisateur ait personnalisé sa disposition. Totalement optionnel — un widget peut très bien n'être ajoutable que manuellement (catégorie `extension`, par ex.).

---

## Règle d'or — Widget Pur

**Un widget est un composant pur. Il n'accède JAMAIS directement à la base de données (LocalStorage/SebaDB). Il passe obligatoirement par une interface d'API centralisée ou des services de données définis** (`docs/services/*.js` — ex. `widget-data-api.js`).

Concrètement : un `render(ctx, el)` n'écrit jamais `window.SebaDB.xxx` ni `localStorage.getItem/setItem` lui-même. Il appelle une fonction exposée par un service dédié (ex. `window.SebaWidgetAPI.getXxx(ctx)`), qui est seule autorisée à parler à SebaDB pour le compte des widgets. Ça permet de faire évoluer la source de données (schéma SebaDB, futur backend) sans toucher au rendu, et de tester/mocker un widget sans dépendre de localStorage.

**Statut au 2026-07-15 : cette règle s'applique aux widgets créés à partir de maintenant** (premier exemple : `cleaning-photo-report`, via `docs/services/widget-data-api.js`). Les widgets antérieurs à cette règle (`chart-donut`, `lot-carte`, `lot-treso`, etc., voir §3) appellent encore `window.SebaDB` directement dans leur `render()` — c'est de la dette technique documentée, pas une exception silencieuse. Ils ne sont pas rétro-migrés dans ce changement ; à faire opportunément, pas en bloquant tout nouveau widget dessus.

---

## 1. Emplacement du code JS

Tout se passe dans `docs/widgets.js` :

1. Si le rendu est simple, écris-le directement inline dans `render(ctx, el)`.
2. Si le rendu est non trivial (canvas animé, D3, carte Leaflet...), déclare une fonction dédiée plus haut dans le fichier (ex. `renderSerenityScore`, `renderHorizonLine`) et appelle-la depuis `render(ctx, el)`. C'est le pattern déjà utilisé par tous les widgets existants — garde-le, n'introduis pas un système de modules séparés en parallèle.
3. Ajoute l'entrée dans `window.WIDGET_CATALOG` (autour de la ligne 1130 aujourd'hui) :

```js
'mon-widget': {
  id: 'mon-widget',
  title: 'Titre affiché dans le module-head',
  size: 'M',                 // S | M | L | XL — span de grille, voir .widget-shell[data-size] dans dashboard.html
  category: 'core',          // core | companion | extension (voir §2)
  source: 'live',            // live | demo | static | lot:<nom> | extension (voir §3)
  keywords: ['mots', 'clés', 'recherche AI-bar'],
  defaultVisible: false,     // fallback global si aucune config de secteur ne s'applique (voir §2)
  defaultOrder: 40,          // > 32 pour ne pas entrer en collision avec les ids existants
  link: { href: 'planning.html', label: 'Voir tout →' }, // optionnel
  render(ctx, el) { /* ... */ },
},
```

`size` doit correspondre à une taille déjà stylée dans `docs/app/dashboard.html` (`.widget-shell[data-size="S|M|L|XL"]`) — n'invente pas une 5ᵉ taille sans ajouter la règle CSS correspondante.

---

## 2. Enregistrement dans `config-dashboard.js`

`config-dashboard.js` ne fait *pas* exister le widget (ça, c'est `WIDGET_CATALOG`, §1). Il choisit uniquement qui le voit par défaut, et seulement tant que l'utilisateur n'a jamais personnalisé sa disposition (`getEffectiveLayout()` dans `docs/widgets.js` ignore cette config dès qu'une disposition est sauvegardée en `localStorage`).

Deux cas :

- **Le widget est pertinent pour tout le monde** (catégorie `core`) → ajoute son `id` dans `CORE` (le socle commun), en haut de `docs/services/config-dashboard.js`.
- **Le widget n'est pertinent que pour certains métiers** (catégorie `companion`, ex. tournée/carte pour les métiers de terrain) → ajoute son `id` dans le(s) tableau(x) concernés de `BY_SECTEUR`, en respectant les clés de secteur déjà utilisées ailleurs dans le produit (`menage`, `conciergerie`, `conciergerieCopro`, `conciergerieEntreprise`, `jardinage`, `maintenance`, `pressing`, `beaute`, `animaux`, `demenagement`, `autre` — mêmes valeurs que `SEED_SERVICES`/`SEED_EMPLOYES` dans `docs/seba-data.js`).
- **Le widget est une extension optionnelle** (catégorie `extension`, ajoutée uniquement à la main depuis le tiroir) → ne touche pas à `config-dashboard.js` du tout. `defaultVisible: false` dans `WIDGET_CATALOG` suffit.

N'invente pas de secteur qui n'existe pas dans `seba-data.js` — un secteur inconnu de `BY_SECTEUR` retombe silencieusement sur `autre`.

---

## 3. Lier le widget à SebaDB (via l'API centralisée)

`docs/seba-data.js` (SebaDB) reste la source de vérité unique — jamais de données métier codées en dur dans un widget (règle CLAUDE.md, sans exception). Depuis la règle d'or ci-dessus, un widget n'y accède plus directement : il passe par un service dédié.

Pattern à suivre pour tout nouveau widget (ex. `cleaning-photo-report` / `docs/services/widget-data-api.js`) :

```js
// docs/services/widget-data-api.js — seul fichier autorisé à lire SebaDB pour les widgets
window.SebaWidgetAPI = {
  getMaDonnee: function (ctx) {
    if (!window.SebaDB || !SebaDB.hasData()) return null;
    const list = SebaDB.list('interventions');   // ou 'clients', 'devis', 'factures'...
    // ... calcule/filtre, renvoie un objet simple (jamais l'objet SebaDB brut)
    return list.length ? { count: list.length } : null;
  },
};

// docs/widgets.js — le widget ne connaît que l'API, jamais SebaDB
render(ctx, el) {
  const data = window.SebaWidgetAPI.getMaDonnee(ctx);
  if (!data) {
    el.innerHTML = buildRichEmptyHTML('🗂️', 'Titre état vide', 'Sous-titre explicatif', 'Créer un client', 'clients.html');
    return;
  }
  // ... construire le HTML à partir de data
}
```

Règles :
- La fonction de service vérifie `window.SebaDB && SebaDB.hasData()`, jamais le widget lui-même.
- Utilise l'état vide riche (`buildRichEmptyHTML`, déjà générique) plutôt qu'une ligne `.tl-empty` pauvre — c'est souvent le premier contact d'un utilisateur avec le widget.
- Si la donnée n'existe pas encore réellement dans SebaDB (fonctionnalité produit pas encore construite), le service renvoie honnêtement `null`/vide plutôt que d'inventer un chiffre — le widget affiche alors son état vide jusqu'à ce que la vraie donnée existe (voir `getCleaningPhotoReport`, qui attend un futur champ `photos` sur les interventions).
- `ctx` (construit par `buildWidgetCtx()`) porte déjà `biz`, `demo`, `secteur`, `sectorLabel`, `nom`, `couleur`, `services`, `slug`, `sym` — n'ajoute pas un second mécanisme de contexte, étends `buildWidgetCtx()` si un widget a besoin d'une donnée qui n'y est pas encore.
- Si le widget n'a pas encore de vraies données à afficher (prototype), utilise `source: 'demo'` et lis dans `ctx.demo` (alimenté par `DEMO[secteur]` ou par `buildLiveData()` une fois SebaDB peuplé) — jamais un tableau écrit en dur dans le widget lui-même.

**Widgets antérieurs à la règle d'or** (`chart-donut`, `lot-carte`, `lot-treso`...) appellent encore `window.SebaDB` directement dans leur `render()` — ne t'en inspire pas pour un nouveau widget, ce sont des exemples de l'ancien pattern, pas du pattern actuel.

---

## 4. Règles de design ("DNA Manifesto")

Ce sont les règles déjà actées dans `CLAUDE.md`, appliquées à l'échelle d'un widget :

- **Vanilla JS strict, zéro framework, zéro bundler.** Un widget ne doit importer que des libs déjà chargées via CDN dans `docs/app/dashboard.html` (D3, SortableJS, Leaflet). N'ajoute pas une nouvelle dépendance pour un seul widget sans en parler d'abord — ça touche un fichier à rayon d'impact large (`dashboard.html`).
- **Aucune couleur en dur.** Toutes les couleurs passent par les tokens CSS déjà définis (`var(--bg)`, `var(--white)`, `var(--ink)`, `var(--text-2)`, `var(--emerald)`, etc.), jamais un hex/rgb écrit à la main hors `:root`/`[data-theme]`. `node tools/check-design-system.js` doit passer avant tout commit touchant un widget.
- **Chiffres en monospace.** Toute valeur numérique affichée (CA, score, compteur...) utilise `.mono-num` ou une des classes déjà reliées à `JetBrains Mono` (`.metric-value`, `.bc-amount`, `.goal-current`, `.serenity-score-num`) — jamais une police par défaut pour un chiffre.
- **Thème Tactical Dark Absolu respecté.** Ce thème est scopé à `docs/app/dashboard.html` + `docs/widgets.js` (voir CLAUDE.md) — ne fais pas fuiter ses styles vers `pro-global.css` ou l'inverse.
- **État vide soigné, jamais un widget qui plante ou reste blanc.** Voir §3 (`buildRichEmptyHTML`).
- **`keywords` réalistes.** Ce sont les termes que l'AI-bar (recherche du tiroir de widgets) doit reconnaître — pense à ce qu'un artisan taperait, pas au nom technique du widget.
- **Performance.** Pas de nouvel intervalle/timer non nettoyé, pas de fuite mémoire sur une instance recréée à chaque `renderGrid()` (le widget `lot-carte` documente déjà ce piège avec `_lotCarteMapInstance` — même vigilance pour toute lib avec état persistant type carte/canvas).

---

## Vérification avant de commit

Comme pour tout changement touchant le dashboard :

```
node scripts/qa-dashboard-full.js --target=local --viewport=desktop
node scripts/qa-dashboard-full.js --target=local --viewport=mobile
node tools/check-design-system.js
node scripts/qa-visual-regression.js
```
