# Audit — Dashboard Seba (`docs/dashboard.html` + `docs/widgets.js`)

Date : 2026-07-07
Branche : `amelioration-dashboard`
Périmètre : `docs/dashboard.html` (2102 lignes), `docs/widgets.js` (1700 lignes), `docs/sidebar.js` (132 lignes, référence). Les autres pages (thème 2026-07-06 / `pro-global.css`) ne sont pas auditées en détail, seulement comme référence de comparaison pour la sidebar mobile.

Méthode : lecture intégrale des deux fichiers, exécution de `scripts/qa-dashboard-full.js --target=local` (desktop 1440×900 et mobile 390×844, Chrome local headless, `docs/dashboard.html?demo`), analyse des captures produites dans `docs/audit-screenshots/qa-full-local-{desktop,mobile}/`, et vérifications ciblées à la main (Puppeteer ad hoc) pour confirmer/écarter 3 pistes ouvertes par le QA (aucun script temporaire n'a été conservé dans le repo). Zéro fichier de code modifié, zéro commit.

Baseline QA : **0 erreur console/page/requête réseau** sur les deux viewports. 2 `FINDING` remontés par le script, tous deux expliqués et confirmés comme de vrais bugs produit (voir 1.1 et 1.2 ci-dessous — ce ne sont pas des faux positifs du script).

---

## 1. Critique (impact utilisateur direct, à corriger avant tout autre chantier)

### 1.1 — Les notifications "Conscience Seba" sont un test hardcodé qui s'affiche à CHAQUE chargement, pour TOUS les utilisateurs, avec un nom de client factice
**Fichiers : `docs/widgets.js:874-877` (`AURA_TEST_SCENARIOS`), `docs/widgets.js:919-925` (`triggerAuraDemo`), `docs/dashboard.html:1271` (appel)**

```js
// widgets.js:874-877
const AURA_TEST_SCENARIOS = [
  { message: 'Paiement client X incertain (80% de retard)', probability: 80 },
  { message: 'Planning semaine prochaine à 90% de capacité', probability: 90 },
];
```
```html
<!-- dashboard.html:1271 -->
if (typeof triggerAuraDemo === 'function') triggerAuraDemo();
```
Cet appel est **inconditionnel** : il ne dépend ni de `?demo` (jamais lu par le fichier — `grep` confirme zéro occurrence de `location.search`/`URLSearchParams` dans `dashboard.html`), ni de `SebaDB.hasData()`, ni d'un flag "vu une fois" façon `seba_calibration_seen`. Résultat : **chaque utilisateur réel, à chaque ouverture du dashboard**, voit apparaître deux cartes "Conscience Seba" mentionnant littéralement *"client X"* — un texte de test qui n'a jamais été remplacé par un vrai contenu ou retiré avant mise en prod. Contrairement à la Planète de Calibration (`seba_calibration_seen`, un seul affichage à vie), rien ne limite la récurrence ici : c'est à chaque F5.
**Impact** : crédibilité produit (un utilisateur payant qui voit "client X" comprend immédiatement que c'est un gadget de démo), et amplifie le bug 1.2 ci-dessous à chaque session.
**Correctif suggéré** : gater `triggerAuraDemo()` derrière un vrai flag démo explicite (ex. `?demo` réellement lu, ou `!SebaDB.hasData()`), ou le supprimer et ne garder que les déclenchements réels (`maybeTriggerAIOnSerenity`/`maybeTriggerAIOnHorizon`, déjà correctement conditionnés).

### 1.2 — Les cartes "Conscience Seba" se superposent aux Vecteurs d'Action et bloquent les clics dessous
**Fichiers : `docs/dashboard.html:317-320` (`.aura-stack`, `position:fixed; z-index:260`), `docs/widgets.js:879-898` (`showAuraNotification`), zone `#action-stream` (`docs/dashboard.html:762`)**

Confirmé par capture (`docs/audit-screenshots/qa-full-local-desktop/08-aura-visible.png` et `10-theme-toggled.png`) et par un test `elementFromPoint` : au point central du bouton "Valider" d'un Vecteur d'Action, `document.elementFromPoint(x,y)` renvoie la `.aura-card` superposée, pas le bouton. C'est la cause racine du `FINDING` du QA script ("clicking Valider did not reduce card count") — **pas un faux positif**, un vrai bug de recouvrement z-index.
Sur mobile c'est pire : capture `docs/audit-screenshots/qa-full-local-mobile/08-aura-visible.png` montre le stack aura recouvrant environ 60% de la hauteur d'écran, cachant complètement 2 des 3 items de la Welcome Checklist ("Simuler la création de votre premier devis", "Copier votre lien public").
**Impact** : sur desktop, clics perdus/imprévisibles sur les Vecteurs d'Action selon le scroll ; sur mobile, blocage quasi-total de l'onboarding checklist pendant plusieurs secondes.
**Correctif suggéré** : réserver une zone d'exclusion (padding-bottom dynamique sur `#action-stream`/`.widget-grid` quand `.aura-stack` a des enfants) ou repositionner l'aura-stack pour qu'elle ne recouvre jamais le flux principal (ex. limiter sa largeur/hauteur max et l'ancrer strictement dans la marge libre).

### 1.3 — Ouvrir puis fermer la Bibliothèque d'Extensions laisse le dashboard bloqué en "Mode personnalisation"
**Fichiers : `docs/dashboard.html:1388-1393` (`openExtDrawer`), `1394-1397` (`closeExtDrawer`)**

```js
function openExtDrawer() {
  ...
  if (!_customizeMode) toggleCustomizeMode(); // la nouvelle vignette doit tout de suite montrer sa poignée (IV.8)
}
function closeExtDrawer() {
  document.getElementById('ext-drawer-overlay').classList.remove('open');
  document.getElementById('ext-drawer').classList.remove('open');
  // ← aucun appel symétrique à toggleCustomizeMode()
}
```
`openExtDrawer()` active silencieusement le mode personnalisation pour que les vignettes glissées aient tout de suite leur poignée. Mais `closeExtDrawer()` ne le désactive jamais. Confirmé par QA : les captures `06-customize-mode.png` (attendu) puis `07-ext-drawer-open.png`, `08-aura-visible.png`, `09-focus-mode-on.png`, `10-theme-toggled.png`, `12-after-stress-test.png` montrent **toutes** la bannière "Mode personnalisation — glissez ⠿..." et les bordures pointillées + boutons ✕ actifs sur chaque widget, alors qu'aucune de ces phases de test n'a redemandé le mode personnalisation.
**Impact** : un utilisateur qui ouvre juste le tiroir d'extensions par curiosité (icône "+" en haut à gauche) se retrouve avec tout son dashboard en mode édition (bordures pointillées, boutons de suppression visibles sur chaque widget) sans comprendre pourquoi, et doit deviner qu'il faut cliquer "Terminer".
**Correctif suggéré** : `closeExtDrawer()` doit restaurer l'état de `_customizeMode` qui existait avant l'ouverture du tiroir (sauvegarder un flag `_customizeModeBeforeDrawer` dans `openExtDrawer()`).

### 1.4 — Le bouton "Notifications" (cloche) est mort : aucun gestionnaire de clic, badge "2" figé en dur
**Fichier : `docs/dashboard.html:704-707`**
```html
<div class="topbar-btn" title="Notifications" role="button" aria-label="Notifications (2 non lues)" tabindex="0">
  <svg .../>
  <div class="notif-badge">2</div>
</div>
```
`grep` sur tout `dashboard.html` ne trouve **aucun** `onclick`, ni `addEventListener` ciblant cet élément, contrairement aux 3 autres `topbar-btn` du même bloc (Mode Focus, Barre IA, Personnaliser ont chacun un `onclick`). Le badge "2 non lues" est un texte statique, jamais recalculé.
**Impact** : élément visuellement identique aux autres boutons de la topbar mais totalement inerte au clic ET au clavier (le `role="button" tabindex="0"` promet une interactivité aux lecteurs d'écran/clavier qui n'existe pas). C'est le genre d'élément qui génère des tickets support ("je clique sur la cloche, rien ne se passe").
**Correctif suggéré** : soit brancher un vrai panneau de notifications, soit retirer `role="button"`/`tabindex="0"` et le badge tant qu'aucune fonctionnalité n'est branchée.

---

## 2. Élevé

### 2.1 — La cérémonie "Planète de Calibration" bloque toute l'interface pendant ~5s+ sans échappatoire et ignore `prefers-reduced-motion`
**Fichier : `docs/dashboard.html:1601-1682` (`showCalibration`), CSS `:554-563`**

- `z-index:900`, `position:fixed; inset:0` — recouvre tout, y compris le menu hamburger mobile. Confirmé : `elementFromPoint` sur les coordonnées du bouton hamburger (mobile, `#hamburger`) renvoie `#calib-overlay`, pas le bouton, tant que la cérémonie tourne.
- Durée fixe non-skippable : 1800ms (rotation) + 980ms (interpolation vers le pays) + 1300ms (légende verrouillée) + 650ms (fondu) ≈ **4.7s minimum**, plus le temps du `fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')` (ligne 1633) qui n'a **aucun timeout** — sur une connexion lente, l'écran noir avec le globe peut durer bien plus longtemps sans que l'utilisateur puisse cliquer nulle part ni appuyer sur Échap pour passer.
- Contrairement à `startSerenityAnimation` (`widgets.js:395`), `startHorizonAnimation` (`widgets.js:642`) et `startTimelineLifeAnimation` (`widgets.js:721`) qui vérifient tous `window.matchMedia('(prefers-reduced-motion: reduce)').matches` avant de lancer leur boucle `requestAnimationFrame`, `showCalibration()` ne fait **aucune** vérification équivalente — la règle CSS générique (`dashboard.html:486-488`) ne s'applique pas puisque la rotation du globe est pilotée en JS (`rot[0] += 0.5` dans `spinLoop`, ligne 1646), pas par une transition/animation CSS.
**Impact** : accessibilité (utilisateurs sensibles au mouvement forcés de subir l'animation), et blocage total de la première session si le CDN est lent — un seul point de défaillance externe (jsdelivr) peut geler l'accès au dashboard à la première connexion.
**Correctif suggéré** : ajouter le check `prefers-reduced-motion` (sauter directement à l'état "verrouillé"), ajouter un timeout sur le `fetch` (ex. `Promise.race` avec 3s), et permettre de fermer au clic/Échap.

### 2.2 — Le widget "Carte des interventions" fuit une instance Leaflet à chaque re-rendu de grille
**Fichier : `docs/widgets.js:1248-1275` (`lot-carte`)**
```js
render(ctx, el) {
  el.innerHTML = '<div class="widget-map" ...></div>';
  const box = el.querySelector('.widget-map');
  loadLeaflet().then(() => {
    const map = L.map(box, { ... }).setView(...);
    ...
  })
}
```
`renderGrid()` (`widgets.js:1487-1512`) vide et reconstruit tout `#widget-grid` (`gridEl.innerHTML = ''`) à chaque bascule du mode personnalisation, chaque ajout/retrait de widget, chaque commande IA. Si "Carte des interventions" est actif, chaque passage crée un **nouvel** objet `L.map()` sans jamais appeler `.remove()` sur le précédent — le conteneur DOM disparaît (`innerHTML=''` du parent), mais l'instance Leaflet garde des listeners actifs sur `window` (resize) et des tuiles en cours de chargement. Répété plusieurs fois dans une session (l'utilisateur teste le mode personnalisation, ajoute/retire des widgets), c'est une fuite mémoire/listeners cumulative.
**Correctif suggéré** : stocker l'instance de map dans une variable module-level (comme `_horizonCleanup`/`_timelineLifeCleanup` le font déjà pour les canvas) et appeler `.remove()` avant d'en recréer une.

---

## 3. Moyen

### 3.1 — Toggle de thème inopérant sur le dashboard (thème forcé sombre)
**Fichier : `docs/dashboard.html:19-21`**
```css
[data-theme="dark"], [data-theme="light"] {
  --bg: #09090B; --white: #18181B; --ink: #EDEDED; --text-2: #A1A1AA; --emerald: #10B981;
}
```
Confirmé par QA : après `sebaTheme.toggle()`, `document.documentElement.getAttribute('data-theme')` passe bien à `"light"`, mais `getComputedStyle(body).backgroundColor` reste `rgb(9, 9, 11)` (identique avant/après). C'est le comportement voulu par la charte Tactical Dark ("jamais de rendu clair sur ce cockpit"), mais si un contrôle de bascule de thème visible existe ailleurs dans l'UI du dashboard (ex. hérité de `reglages.html`/menu utilisateur), l'utilisateur qui clique dessus n'a aucun retour visuel que quelque chose s'est passé — à vérifier qu'aucune bascule de thème n'est exposée sur cette page précisément pour éviter la confusion, ou ajouter un message explicite ("Ce tableau de bord reste toujours en mode sombre").

### 3.2 — Fallback pays/devise peu soigné
**Fichier : `docs/widgets.js:1123`**
```js
'<div class="ws-row"><span class="ws-label">Pays / Devise</span><span class="ws-val">' + (ctx.biz.pays || '—') + ' · ' + ctx.sym + '</span></div>'
```
Confirmé en capture (`docs/audit-screenshots/qa-full-local-desktop/10-theme-toggled.png`, widget "Votre espace") : avec un `biz` sans champ `pays` (cas réel si l'onboarding ne demande/stocke pas toujours ce champ), l'affichage devient `— · €`, un tiret cadratin nu peu engageant pour un widget censé rassurer sur la configuration du compte.
**Correctif suggéré** : fallback textuel ("Non renseigné") plutôt qu'un `—` brut, cohérent avec les autres placeholders du fichier (`tl-empty`, etc.) qui utilisent des messages complets.

### 3.3 — Reconstruction complète du DOM des widgets à chaque changement d'état
**Fichier : `docs/widgets.js:1487-1512` (`renderGrid`), `1519-1534` (`renderCockpitTelemetry`)**
`renderGrid(gridEl, ctx, customizeMode)` fait systématiquement `gridEl.innerHTML = ''` puis reconstruit **tous** les widgets visibles, y compris ceux dont le contenu n'a pas changé (ex. basculer le mode personnalisation reconstruit aussi "Objectif du mois", "Portail client", etc.). Conséquence directe : chaque D3 chart (`bento-chart`, `chart-donut`) rejoue entièrement ses transitions d'entrée (`transition().duration(900)`, tracé de ligne `duration(1200)`) à chaque toggle — visuellement redondant, et coûteux sur les configurations bas de gamme si l'utilisateur bascule plusieurs fois le mode personnalisation ou ajoute plusieurs widgets via la barre IA d'affilée.
**Correctif suggéré** : différencier un re-rendu "structurel" (ajout/retrait/réordre de widgets) d'un simple re-rendu de contenu ; ou au minimum, ne pas rejouer les animations d'entrée CSS/D3 quand le widget concerné n'a pas changé de position/visibilité.

### 3.4 — Boucle `requestAnimationFrame` de la Timeline de Vie active mais invisible sous 1180px
**Fichiers : `docs/dashboard.html:309-310` (media query `display:none` sous 1180px), `docs/widgets.js:711-716` (`renderTimelineLife`, appelé sans condition de largeur)**
Le rail `.timeline-life-rail` est caché en CSS sous 1180px (mobile et beaucoup de tablettes/laptops), mais `renderTimelineLife()` est appelé inconditionnellement à chaque `renderDashboard()` (`dashboard.html:1317`) et lance quand même `startTimelineLifeAnimation` — une boucle `rAF` avec un `resize` listener tournant en continu sur un canvas réduit à 1×1px (confirmé par le QA : `Timeline de Vie canvas (#timeline-life) found but zero-size / not visible` en mobile). Le coût par frame est minime (clear + un trait), mais c'est une boucle qui tourne pour rien sur tout appareil <1180px, y compris tous les mobiles.
**Correctif suggéré** : vérifier la largeur du viewport (ou `getComputedStyle(rail).display === 'none'`) avant de démarrer la boucle, et écouter un `matchMedia('(min-width:1181px)')` pour la démarrer/arrêter dynamiquement plutôt que de laisser tourner un rAF permanent inutile.

---

## 4. Faible

### 4.1 — Sidebar mobile : le mécanisme du dashboard fonctionne correctement (à la différence de `clients.html`)
**Fichiers : `docs/dashboard.html:2039-2054` (`toggleSidebar`/`closeSidebar`), `docs/pro-global.css:517-546`**
Vérifié explicitement car demandé : le bug mémorisé ("la sidebar mobile ne passe jamais en `position:fixed`" sur `clients.html`) **ne se reproduit pas** sur `dashboard.html`. Test direct : `toggleSidebar()` appelé en JS bascule correctement `.sidebar` de `transform:translateX(-224px)` (fermé) à `translateX(0)` avec `position:fixed` déjà actif avant même le clic (media query `@media (max-width:840px)` appliquée correctement dès le chargement). Ce n'est pas une régression à corriger ici — juste une confirmation que le dashboard n'hérite pas du bug de `clients.html` (probablement parce que `dashboard.html` utilise `.app { display:grid }` avec sa propre structure, alors que `clients.html` a un layout différent où la media query ne s'applique visiblement pas de la même façon).

### 4.2 — Incohérence de nomenclature entre commentaire et code pour le widget "Missions"
**Fichier : `docs/dashboard.html:84-85` (commentaire "CA / Serenity Score / Missions"), `docs/widgets.js:1485` (`PINNED_TELEMETRY_IDS = ['metric-0', 'serenity-score', 'timeline']`, titre catalogue "Journée d'aujourd'hui")**
Le commentaire de la zone télémétrie fixe parle de "Missions" mais le widget réellement épinglé est `timeline` / "Journée d'aujourd'hui" — dérive de nommage sans impact fonctionnel, mais gêne la lecture du code pour la maintenance future.

### 4.3 — Bouton "cloche notifications" : cf. 1.4 (classé critique, pas dupliqué ici).

### 4.4 — Magic numbers non documentés dans les seuils de score
**Fichier : `docs/widgets.js:305-322` (`computeSerenityScore`)**
Les seuils `pct < 0.4`, `< 0.7`, `< 0.9`, `score -= 30/15/5`, `lateInvoices * 10` (plafonné à 30), `n * 5` (plafonné à 20) sont des constantes en dur sans nom ni configuration centralisée (contrairement à `SECTOR_VARIANCE` ou `HORIZON_MAJOR_THRESHOLD` qui sont au moins nommés). Difficile à ajuster/tester unitairement en l'état.

---

## Résumé exécutable (ordre de correction suggéré)
1. Retirer ou gater `triggerAuraDemo()` (1.1) — le plus visible, le plus embarrassant, le plus facile à corriger (une condition).
2. Corriger le recouvrement `.aura-stack` / `#action-stream` (1.2) et le bug `openExtDrawer`/`closeExtDrawer` (1.3) — deux bugs de state/z-index bien identifiés, correctifs localisés.
3. Brancher ou retirer le bouton notifications mort (1.4).
4. Ajouter un timeout + reduced-motion check sur la Planète de Calibration (2.1), et corriger la fuite Leaflet (2.2).
