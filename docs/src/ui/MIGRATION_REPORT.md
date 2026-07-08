# MIGRATION_REPORT.md — Modernisation DOM (Phase 1 + Phase 2)

*État au 2026-07-09. Phase 3 non commencée — en attente de confirmation explicite de la structure du bridge, conformément à l'instruction de la mission.*

## Phase 1 — Audit (`docs/src/ui/migration-map.json`)

27 sites `onclick` recensés dans `docs/dashboard.html` par grep exhaustif, chacun avec sa fonction cible, ses paramètres et son niveau de dépendance globale. Détail complet dans `migration-map.json`.

**Résultat du critère d'exclusion "utilise `this`"** : vérifié fonction par fonction — **aucune** des fonctions ciblées n'utilise `this` dans un contexte d'objet DOM spécifique. La liste d'exclusion "EXCLUE - COMPLEXE" prévue pour ce critère est donc vide.

**2 entrées exclues pour une autre raison, explicite** :
- `.ai-bar-match a` (lien de suggestion généré dans `submitAiBar()`, ligne ~1529) : l'`onclick` chaîne 4 instructions (`event.preventDefault()`, `addWidgetToLayout(id)`, une écriture `innerHTML` **directe dans l'attribut lui-même**, puis `renderGrid(...)`) — pas un simple appel de fonction. Marqué `EXCLUE - COMPLEXE`.
- 3 sites `onclick="event.stopPropagation()"` (`.palette-box`, `.ai-bar-box`, `.shortcuts-box`) : appels natifs du navigateur, hors périmètre applicatif. Marqués `EXCLUE - HORS PÉRIMÈTRE`.

**Niveaux de dépendance globale observés** (répartition réelle, pas un a priori) :
- 8 sites **indépendants** (DOM pur, zéro dépendance externe) — `toggleSidebar`, `closeSidebar`, `toggleFab`, `closePalette`, `closeCustomizePanel` (×2), `closeExtDrawer`, `closeAiBar`, `closeShortcuts`
- 6 sites dépendant de **closures locales** à `dashboard.html` (`_customizeMode`, `_fabOpen`, `_palFiltered`, `menuEl`, etc.)
- 3 sites dépendant de **fichiers externes** via `window.X` (`enablePushNotifications` → `window.sebaPush`, `.menu-deconnect` → `window.sebaAuth`, le lien AI bar exclu → `window.addWidgetToLayout`/`renderGrid` dans `docs/widgets.js`)
- 4 sites à **dépendance élevée** (plusieurs états globaux combinés) — `toggleFocusMode` (×2 sites), `activerDonneesReelles`, `openCustomizePanel`

## Phase 2 — La passerelle (`docs/src/ui/event-bridge.js`)

Livrée, testée (`docs/src/test-event-bridge.js`, passant), **pas encore importée par `docs/dashboard.html`**.

`window.handleLegacyClick(action, ...args)` :
1. Publie `UI_ACTION { action, args, ack }` sur l'Event Bus.
2. Si un module lève `ack.handled = true`, s'arrête là (le module a pris en charge l'action).
3. Sinon, appelle `window[action](...args)` — comportement identique à avant la migration (Règle d'or #3, ZÉRO RÉGRESSION).
4. Si ni un module ni une fonction globale du même nom n'existent, log un avertissement console au lieu de bloquer le clic (Règle d'or #2, PAS DE PERTE).

**Écart assumé** : `action` désigne ici le nom de la fonction globale historique elle-même (ex. `'toggleSidebar'`), pas un identifiant abstrait type `'TOGGLE_SIDEBAR'` comme l'exemple du brief le suggérait. Choix fait pour que le fallback soit **sans ambiguïté** (`window[action]` fonctionne toujours, et correspond exactement au champ `targetFunction` déjà présent dans `migration-map.json`). Une couche de noms abstraits pourra être ajoutée en Phase 3 si un besoin réel apparaît une fois les premiers boutons réellement basculés — pas inventée aujourd'hui sans cas d'usage concret.

Aujourd'hui, **aucun module n'écoute encore `UI_ACTION`** (`ui-controller.js` n'a pas été modifié dans cette mission) : tout appel à `handleLegacyClick` retomberait donc systématiquement sur le fallback, soit un comportement rigoureusement identique à l'`onclick` direct actuel — le pont est un tunnel transparent tant que la Phase 3 ne lui ajoute pas d'écouteurs réels.

## Ce qui est basculé sur le bridge

**Rien.** `docs/dashboard.html` n'a pas été modifié (vérifié : `git diff` vide) — aucun `onclick` n'a été réécrit en `handleLegacyClick(...)`.

## Ce qui reste en `onclick` pur

Les 27 sites listés dans `migration-map.json`, sans exception — en l'état actuel du repo, 100% des `onclick` de `dashboard.html` restent inchangés.

## Recommandation pour la Phase 3 (à valider avant exécution)

3 candidats "boutons de navigation" les plus simples, zéro dépendance externe, zéro ou paramètre primitif unique (marqués `"recommandePhase3": true"` dans `migration-map.json`) :
1. `#hamburger` → `toggleSidebar()`
2. `#sidebar-overlay` → `closeSidebar()`
3. `#fab` → `toggleFab()`

Chacun serait converti dans **son propre commit atomique** (Règle d'or #1), avec vérification individuelle du rendu visuel et de la réception par `ui-controller.js`/le bus avant de passer au suivant — comme demandé, en attente de confirmation avant de commencer.
