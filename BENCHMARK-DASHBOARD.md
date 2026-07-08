# Benchmark Dashboard — Seba (dashboard.html + widgets.js)

Lecture seule. Aucune modification de code n'a été faite pour produire ce document.

## Méthode et périmètre

Avant toute recommandation, `docs/dashboard.html` (2102 lignes) et `docs/widgets.js` (1700 lignes) ont été lus intégralement. Rappel de ce qui existe **déjà** et qu'il ne faut pas reproposer :

- Zone télémétrie fixe (CA / Serenity Score / Missions du jour) — `dashboard.html` L84-96, L754-756
- Serenity Score : sphère à particules Canvas 2D, état sain/attention/alerte — `widgets.js` L293-456
- Console de Commande IA (barre en langage naturel, matching mots-clés local) — `widgets.js` L1606-1645, `dashboard.html` L1430-1468
- Mode Focus (mise sous vide, une seule action prioritaire) — `dashboard.html` L602-625, L1715-1749
- Vecteurs d'Action (cartes de gain, pas de tâches) — `widgets.js` L458-504
- Lignes d'Horizon (courbes Canvas, sans axes) — `widgets.js` L506-672
- Timeline de Vie (rail vertical, pouls d'activité) — `widgets.js` L674-862
- Conscience Seba (notifications prédictives en aura, morphing vers Vecteur d'Action) — `widgets.js` L864-1012
- Drag & Drop haptique (SortableJS, `is-dragging`, `lock-wave`) — `dashboard.html` L135-151, `widgets.js` L1541-1571
- Bibliothèque d'Extensions (tiroir gauche, HTML5 drag natif) — `dashboard.html` L1358-1425
- Planète de Calibration (globe D3 orthographique, cérémonie one-shot) — `dashboard.html` L1566-1682
- Pont de Données (bascule démo→réel, animation pixel-scan) — `dashboard.html` L1684-1713
- Interface Sonore (Web Audio API, `AudioUI`) — `dashboard.html` L1517-1564
- Thème Tactical Dark Absolu (`--bg:#09090B`, `--emerald:#10B981`, `pro-global.css`)

Toutes les recommandations ci-dessous sont donc des **compléments**, pas des redites — et 100% réalisables en HTML/CSS/JS vanilla + D3/SortableJS déjà chargés (aucune nouvelle dépendance requise, sauf mention explicite).

Tokens existants réutilisés dans les exemples (`pro-global.css`) : `--r:12px`, `--rs:8px`, `--border`, `--glass-bg`, `--shadow-glow`, `--weight-data:700`, `--tracking-tight:-0.02em`, `--leading-data:1.15`, `--amber`, `--plum`, `--critical`, `--ease-std`, `--ease-out`.

---

## 1. Stripe — hiérarchie des métriques & data-viz

**Ce que fait Stripe :** la valeur principale domine visuellement, la comparaison (delta, période précédente) est *sur* le graphique (ligne pointillée ou zone ombrée), pas seulement en texte à côté. Le survol révèle un delta contextualisé au point précis, pas juste au total.

### 1.1 Ligne d'objectif superposée sur le Cockpit financier (déjà un delta textuel → ajouter le delta visuel)

Aujourd'hui, `renderFinanceChartD3` (`widgets.js` L138-210) trace uniquement la courbe de CA réalisé. L'objectif mensuel (`ctx.demo.goal.target`) existe déjà comme donnée (utilisé par le widget `goal`, L1098-1112) mais n'apparaît jamais sur le graphique lui-même — l'artisan doit regarder deux widgets différents pour croiser "où j'en suis" et "combien il me faut par mois".

Ajout concret dans `renderFinanceChartD3` (après le tracé de `path`, avant le focus dot, vers L172) :

```js
// Ligne d'objectif — répartition linéaire du goal.target sur les mêmes mois,
// dessinée en pointillé gris clair, sans tooltip dédié (juste un repère visuel).
if (goalTarget > 0) {
  const perMonth = goalTarget; // objectif = même cible chaque mois (cohérent avec le widget "goal")
  const goalLine = d3.line().x(d => x(d.month)).y(() => y(perMonth));
  svg.append('path').datum(series)
    .attr('d', goalLine).attr('fill', 'none')
    .attr('stroke', 'rgba(255,255,255,.28)').attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '3 3');
}
```

`renderFinanceChartD3(wrapEl, series, sym)` devrait recevoir un 4e paramètre `goalTarget` ; l'appel dans la définition `bento-chart` (`widgets.js` L1062) devient `renderFinanceChartD3(el.querySelector('.bc-d3-wrap'), buildFinanceSeries(ctx.secteur, cur), ctx.sym, goal.target)`. Impact direct : l'artisan voit en un coup d'œil s'il est au-dessus ou en dessous de sa trajectoire cible, sans changer de widget.

### 1.2 Delta contextualisé au survol (pas seulement au total)

Le tooltip actuel (`moveFocus`, `widgets.js` L186-198) affiche `mois · valeur`. Stripe affiche en plus le delta vs le point équivalent période précédente. Ajout : passer aussi `SECTOR_VARIANCE` de l'année précédente (ou, à défaut de vraie donnée historique, un facteur `* 0.91` déterministe comme actuellement fait pour la démo) et afficher `+12% vs période préc.` dans `tip.textContent` à la ligne 194.

**Dimension couverte :** hiérarchie de l'information, composants de graphique.

---

## 2. Linear — vitesse, raccourcis clavier, densité

**Ce que fait Linear :** aucune action fréquente ne nécessite la souris ; une seule touche (`c` = create, `g`+lettre = go to) déclenche l'action la plus probable. Les raccourcis sont découvrables via un badge visuel discret, pas seulement via l'aide `?`.

### 2.1 Raccourci `C` pour créer (le FAB existe, il manque juste le clavier)

Le FAB (`dashboard.html` L778-783) et son menu existent mais ne sont accessibles qu'à la souris/tactile. Le gestionnaire `keydown` global (`dashboard.html` L2007-2034) a déjà `E` (personnaliser), `F` (focus), `?` (aide) — il manque `C` (create), cohérent avec Linear/GitHub :

```js
// dashboard.html, dans le bloc keydown existant (~L2012), juste après la ligne "F"
if (!typing && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); toggleFab(); return; }
```

Et dans `.shortcuts-overlay` (`dashboard.html` L849-859), ajouter la ligne `<div class="shortcut-row"><span>Actions rapides</span><span class="pal-key">C</span></div>`.

### 2.2 Badges numérotés sur le menu FAB (découvrabilité à la Linear/Raycast)

Quand le FAB est ouvert, permettre `1`/`2`/`3` pour aller direct à "Nouveau client"/"devis"/"intervention", avec un petit badge visuel sur chaque `.fab-item` (`dashboard.html` L779-783) :

```html
<a href="clients.html" class="fab-item"><span class="fab-item-ico">👤</span>Nouveau client<span class="pal-key" style="margin-left:auto;">1</span></a>
```
```js
// dans le handler keydown, uniquement si le menu est ouvert
if (_fabOpen && /^[123]$/.test(e.key)) {
  const links = ['clients.html', 'devis-nouveau.html', 'planning.html'];
  window.location.href = links[+e.key - 1];
}
```

`.pal-key` est une classe déjà stylée (`dashboard.html` L434) — zéro CSS à ajouter.

**Dimension couverte :** micro-interactions, densité d'info vs clarté (accès rapide sans alourdir l'UI visuellement, le badge n'apparaît qu'au survol/ouverture).

---

## 3. Vercel — dark mode & monospace pour la donnée technique

**Constat concret (pas une généralité) :** la classe utilitaire `.mono-num` est **définie** (`dashboard.html` L22 : `font-family: 'JetBrains Mono', ...; font-variant-numeric: tabular-nums;`) mais **n'est appliquée nulle part** dans tout le HTML généré — ni par `dashboard.html`, ni par `widgets.js`. Seul le chiffre du CA pinné en télémétrie a un `font-family` JetBrains Mono codé en dur localement (`.cockpit-telemetry [data-widget-id="metric-0"] .metric-value`, L94), tous les autres nombres du dashboard (`.bc-amount` L355, `.goal-current` L199, `.serenity-score-num` L262, les 3 autres `.metric-value` hors télémétrie) héritent d'Inter. C'est une incohérence typographique invisible à l'œil nu mais réelle : l'intention "chiffres en monospace façon terminal financier" (déjà actée dans la charte Tactical Dark) n'est appliquée qu'à 1 nombre sur ~8.

### 3.1 Appliquer `.mono-num` partout où un chiffre est la donnée principale

```css
/* dashboard.html, à ajouter dans le bloc de règles existant (proche L78) */
.metric-value, .bc-amount, .goal-current, .serenity-score-num, .focus-score-num { 
  font-family: 'JetBrains Mono', ui-monospace, monospace; 
  font-variant-numeric: tabular-nums; 
}
```

Aucun changement JS requis — c'est un ajout CSS pur qui unifie immédiatement tous les widgets (`metric-0..3`, `bento-chart`, `goal`, `serenity-score`, le focus overlay). Gain : les chiffres alignent leurs chiffres verticalement (tabular-nums) dans les listes et cartes, ce qui est précisément ce que fait Vercel Analytics pour donner un aspect "instrument de mesure" plutôt que "texte".

### 3.2 Barre d'usage sous le CA pinné (pattern "quota Vercel")

Vercel affiche sous chaque métrique d'usage une barre fine de progression vers la limite. Le widget `metric-0` pinné en télémétrie (`widgets.js` L1025-1028, rendu via `buildMetricCardEl` L55-66) n'a qu'un sparkline en fond — pas de repère de progression vers l'objectif mensuel. Ajout dans `buildMetricCardEl`, seulement pour `seed===0` (le CA) :

```js
// widgets.js, buildMetricCardEl — ajouter après la ligne du metric-delta (L62)
if (seed === 0 && ctxGoalPct != null) {
  a.innerHTML += '<div style="height:3px;background:var(--border);border-radius:2px;margin-top:8px;overflow:hidden;">' +
    '<div style="height:100%;background:var(--emerald);width:' + Math.min(100, ctxGoalPct) + '%;"></div></div>';
}
```
(nécessite de faire passer `goal.current/goal.target*100` en paramètre depuis l'appelant L1028 — un seul point d'appel à modifier)

**Dimension couverte :** typographie (correction d'incohérence réelle), hiérarchie de l'information.

---

## 4. Notion — blocs modulaires

**Ce que fait Notion :** chaque bloc a un type et un contexte clair ; les blocs de même famille sont visuellement regroupés par un en-tête discret, même dans une page dense.

Seba fait déjà le plus dur : le panneau "Personnaliser" groupe par catégorie `Cœur / Compagnon / Extensions` (`CATEGORY_LABEL`, `widgets.js` L1585-1600), et la grille elle-même est déjà segmentée en zones fixes (télémétrie / grille modulable / vecteurs d'action / lignes d'horizon, `dashboard.html` L754-765). Ce qui manque : **ces zones ne sont pas nommées visuellement** dans le dashboard lui-même — seul le code sait qu'elles existent (commentaires "Zone 1 : En-tête", etc.), l'artisan ne voit qu'un flux continu de cartes sans repère de structure.

### 4.1 Eyebrows de section (à la Notion, discrets, pas des titres de module)

```css
/* dashboard.html, nouveau bloc CSS */
.zone-eyebrow { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--text-2); margin: 4px 2px 10px; opacity: .6; }
```
```html
<!-- avant .cockpit-telemetry, dashboard.html L754 -->
<div class="zone-eyebrow">Vue d'ensemble</div>
<div class="cockpit-telemetry" id="cockpit-telemetry"></div>

<!-- avant #widget-grid, L758 -->
<div class="zone-eyebrow">Votre espace de travail</div>
<div class="widget-grid" id="widget-grid"></div>

<!-- avant #action-stream, L762 -->
<div class="zone-eyebrow">À traiter maintenant</div>
<section id="action-stream" class="action-stream"></section>
```

Coût : zéro logique, 3 `div` statiques + 4 lignes de CSS. Bénéfice : l'artisan comprend immédiatement pourquoi certaines cartes bougent (widget-grid, personnalisable) et d'autres non (télémétrie, vecteurs d'action) — actuellement cette distinction n'existe que dans les commentaires du code source.

**Dimension couverte :** hiérarchie de l'information, espacement/grille (structure perçue sans changer les grilles CSS existantes).

---

## 5. Airbnb — états vides engageants

**Constat concret :** deux familles d'états vides coexistent dans `widgets.js`, avec un écart de qualité net :

- Riche (icône + titre + sous-titre + CTA bouton) : `buildBentoChartHTML` quand `cur<=0` (L71-78), utilisé uniquement par `bento-chart`.
- Minimal (une ligne de texte + lien) : `.tl-empty`, utilisé par `buildTimelineHTML` (L249), `team` (L1148), **`lot-impayes`** (L1160), **`lot-pipeline`** (L1173), **`lot-tournee`** (L1187).

Les widgets "Compagnon" (pipeline, tournée, impayés) sont probablement le **premier contact** d'un artisan avec ces fonctionnalités avancées (ils sont `defaultVisible:false`, donc ajoutés volontairement) — c'est exactement le moment où Airbnb soigne le plus son état vide, alors que Seba y met le moins d'effort actuellement.

### 5.1 Helper d'état vide riche, réutilisé partout

```js
// widgets.js, à ajouter près de buildBentoChartHTML (L112)
function buildRichEmptyHTML(icon, title, sub, ctaLabel, ctaHref) {
  return '<div class="bc-empty-body">' +
    '<div class="bc-empty-ico">' + icon + '</div>' +
    '<div class="bc-empty-title">' + title + '</div>' +
    '<div class="bc-empty-sub">' + sub + '</div>' +
    (ctaHref ? '<button class="bc-empty-btn" onclick="window.location.href=\'' + ctaHref + '\'">' + ctaLabel + '</button>' : '') +
    '</div>';
}
```

Puis remplacer, par exemple pour `lot-tournee` (`widgets.js` L1186-1187) :

```js
// avant : '<div class="tl-empty">Aucun point de tournée. <a href="haversine-engine.html" ...>Ajouter des points →</a></div>'
if (!pts.length) {
  el.innerHTML = buildRichEmptyHTML(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF9D" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>',
    'Optimisez vos trajets du jour',
    'Ajoutez vos arrêts et Seba calcule l\'ordre le plus rapide.',
    'Ajouter des points', 'haversine-engine.html'
  );
  return;
}
```

Même traitement pour `lot-pipeline` (L1172-1173) et `lot-impayes` (L1159-1160, avec un message positif "✓ Aucune facture en retard" qui mérite aussi une icône de succès plutôt qu'une simple ligne de texte grise). `.bc-empty-*` (CSS `dashboard.html` L364-369) est déjà générique et ne dépend pas du contexte `bento-chart` — il est directement réutilisable.

**Dimension couverte :** états vides, clarté (cohérence visuelle entre widgets Cœur et Compagnon).

---

## 6. Figma — micro-interactions

Seba a déjà un vocabulaire de micro-interactions riche et cohérent (drag `lock-wave`, burst de particules IA, `pixel-scan`, sons `AudioUI`). Le point Figma qui manque : **le clic droit contextuel**, réflexe acquis par tout utilisateur d'un canvas/éditeur moderne, alors qu'aujourd'hui la seule façon de retirer/déplacer un widget passe par le mode "Personnaliser" explicite (`toggleCustomizeMode`, `dashboard.html` L1324-1331).

### 6.1 Menu contextuel léger sur `.widget-shell`

```js
// dashboard.html, à ajouter près du listener metric-card mousemove (L2059)
document.getElementById('widget-grid').addEventListener('contextmenu', e => {
  const shell = e.target.closest('.widget-shell');
  if (!shell || _customizeMode) return; // en mode personnalisation, le bouton ✕ existe déjà
  e.preventDefault();
  const id = shell.dataset.widgetId;
  // Réutilise le style .user-menu déjà présent (dashboard.html L67-72) — pas de nouveau composant visuel
  showWidgetContextMenu(shell, id, e.clientX, e.clientY);
});
```

`showWidgetContextMenu` peut cloner le pattern déjà existant de `.user-menu` (positionnement absolu + `.open`) avec deux actions : "Retirer ce widget" (appelle `onWidgetRemove(id)` déjà défini L1332) et "Agrandir" (cycle S→M→L→XL en modifiant `w.size` puis `saveLayout`). Aucune nouvelle dépendance, réutilise 100% de la mécanique de layout existante (`getEffectiveLayout`/`saveLayout`, `widgets.js` L1444-1454).

**Dimension couverte :** micro-interactions, densité vs clarté (action avancée disponible sans alourdir l'UI par défaut).

---

## 7. Shopify — dashboards PME/commerçants (cible la plus proche de Seba)

**Ce que fait Shopify Home :** un sélecteur de période simple (Aujourd'hui / 7 jours / 30 jours) au-dessus du graphique de ventes, qui recalcule instantanément la même courbe à une autre granularité — pas un vrai changement de vue, juste un zoom temporel.

### 7.1 Sélecteur de période sur le Cockpit financier, en réutilisant une donnée déjà calculée ailleurs

Aujourd'hui `bento-chart` (`widgets.js` L1042-1063) est figé sur 6 mois (`buildFinanceSeries`, L130-133, basé sur `SECTOR_VARIANCE`). Or **les Lignes d'Horizon calculent déjà une série journalière** (`buildHorizonSeries`, L514-541 : 12 derniers jours, réels via `SebaDB` ou simulés). Plutôt que d'inventer une 3e source de données, le sélecteur de période peut basculer entre deux séries qui existent déjà dans le code :

```html
<!-- widgets.js, dans le render() de 'bento-chart' (L1056), avant .bc-hdr -->
<div class="qa-grid" style="grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px;">
  <button class="qa-btn" style="padding:5px 8px;font-size:.72rem;" data-period="jour" onclick="switchChartPeriod('jour')">7 jours</button>
  <button class="qa-btn" style="padding:5px 8px;font-size:.72rem;" data-period="mois" onclick="switchChartPeriod('mois')">6 mois</button>
</div>
```
```js
// widgets.js — 'jour' réutilise buildHorizonSeries(ctx).gains, 'mois' réutilise buildFinanceSeries existant
function switchChartPeriod(period) {
  const wrap = document.querySelector('[data-widget-id="bento-chart"] .bc-d3-wrap');
  if (!wrap || !window._ctx) return;
  if (period === 'jour') {
    const daily = buildHorizonSeries(window._ctx).gains.map(p => ({ month: new Date(p.date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}), value: p.amount }));
    renderFinanceChartD3(wrap, daily, window._ctx.sym);
  } else {
    renderFinanceChartD3(wrap, buildFinanceSeries(window._ctx.secteur, window._ctx.demo.goal.current), window._ctx.sym);
  }
}
```

(nécessite d'exposer `_ctx` de `dashboard.html` sous `window._ctx` — actuellement une variable de closure locale à la ligne 1259 ; un simple `window._ctx = _ctx;` ajouté dans `renderDashboard` L1311 suffit).

**Dimension couverte :** composants de graphique/filtres, densité d'info vs clarté (l'artisan choisit son niveau de zoom au lieu de subir un seul horizon temporel).

---

## 8. Mercury — clarté financière

**Ce que fait Mercury :** toujours indiquer la fraîcheur d'une donnée financière ("Mis à jour à l'instant") — un repère de confiance, pas juste un chiffre nu, particulièrement important quand une partie du dashboard est en mode démo et une autre en mode réel (Pont de Données, `dashboard.html` L1684-1713).

### 8.1 Horodatage de fraîcheur sur le Cockpit financier et le CA pinné

```js
// widgets.js, buildBentoChartHTML (L96-100) et le render() de 'bento-chart' (L1059-1060)
// Remplacer le simple "Ce mois · juillet 2026" par : 
'<span style="font-size:.73rem;color:var(--text-2);">Ce mois · ' + new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) +
'  ·  <span title="Donnée recalculée à chaque ouverture">mis à jour à ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) + '</span></span>'
```

Detail important pour la confiance : quand `window.SebaDB && SebaDB.hasData()` est vrai (données réelles, cf. `buildLiveData`, `widgets.js` L1367), ce label devrait dire *"Données réelles · mis à jour à HH:MM"* plutôt que la formulation démo — un seul `ctx.isLive` (dérivable de `SebaDB.hasData()`, déjà calculé dans `renderDashboard` L1290) à faire transiter jusqu'à `buildWidgetCtx` (L41-50) pour que chaque widget financier sache s'afficher différemment selon la source.

**Dimension couverte :** hiérarchie de l'information, clarté (distinction visuelle démo/réel qui existe déjà logiquement via le Pont de Données mais n'est pas rappelée widget par widget).

---

## Tableau de couverture par dimension

| Dimension demandée | Recommandation(s) |
|---|---|
| Hiérarchie de l'information | 1.1, 1.2 (Stripe), 3.2 (Vercel), 4.1 (Notion), 8.1 (Mercury) |
| Typographie | 3.1 (Vercel — correction `.mono-num` non appliqué) |
| Espacement / grille | 4.1 (Notion — eyebrows de zone) |
| Graphiques / tableaux / filtres | 1.1 (Stripe — ligne objectif), 7.1 (Shopify — sélecteur de période), 2.3* (tri sur `lot-impayes`, voir ci-dessous) |
| Micro-interactions | 2.1, 2.2 (Linear), 6.1 (Figma) |
| États vides | 5.1 (Airbnb) |
| Densité d'info vs clarté | 2.2 (Linear), 6.1 (Figma), 7.1 (Shopify) |

*Point additionnel "filtres" non détaillé plus haut, pour compléter la case tableau/filtres du benchmark :*

**Tri sur le widget "Factures en retard" (`lot-impayes`, `widgets.js` L1154-1166).** Actuellement trié uniquement par `relanceStep` décroissant (L1159), sans possibilité de trier par montant. Ajout d'une paire de chips de tri (`Ancienneté` / `Montant`) au-dessus de la liste, réutilisant le style `.qa-btn` déjà défini (`dashboard.html` L192-194), avec un simple `list.sort()` conditionnel avant le `.map()` de rendu (L1163) — aucune nouvelle donnée requise, juste un second critère de tri sur `ctx.creances` déjà chargé.

---

## Les 5 recommandations les plus impactantes

1. **Appliquer `.mono-num` partout** (§3.1) — la classe existe déjà (`dashboard.html` L22) mais n'est utilisée nulle part ; un ajout CSS de 5 lignes corrige une vraie incohérence avec la charte Tactical Dark ("JetBrains Mono pour les chiffres").
2. **Sélecteur de période sur le Cockpit financier** (§7.1) — réutilise une série de données déjà calculée pour les Lignes d'Horizon (`buildHorizonSeries`), aucune nouvelle donnée à inventer, et répond à un vrai besoin métier ("comment ça se passe cette semaine ?" vs "ce semestre ?").
3. **États vides riches pour les widgets Compagnon** (§5.1) — `lot-pipeline`, `lot-tournee`, `lot-impayes` sont le premier contact avec des fonctionnalités avancées et ont aujourd'hui l'état vide le plus pauvre du dashboard ; un helper unique (`buildRichEmptyHTML`) corrige les trois d'un coup.
4. **Ligne d'objectif superposée sur le graphique CA** (§1.1) — donne une lecture visuelle immédiate de la trajectoire vs cible, sans exiger de croiser deux widgets différents.
5. **Eyebrows de section** (§4.1) — 3 lignes de HTML statique qui rendent visible une structure (télémétrie fixe / grille modulable / actions) qui existe déjà dans le code mais reste invisible à l'artisan.
