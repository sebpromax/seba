# MIGRATION_TELEMETRY_REPORT.md — Éveil du Seba-Core (Séquence 4/4, finale)

*État au 2026-07-09. Séquences 1→4 de la mission télémétrie (PR #27, #28, #29, #30) : cartographie, hotfix XSS, câblage de l'écoute, activation réelle. Rédigé après verification en Node (tests) ET en navigateur réel (Chrome headless, serveur HTTP local) — pas seulement en théorie.*

## Ce qui a été activé

`docs/src/ui/dashboard-init.js` instancie maintenant la chaîne complète pour de vrai :
- `TelemetryModule()`
- `DataModule({ storage: window.localStorage })`
- `AuthModule(window.SEBA_CONFIG || {})`, avec `getSession()` (lecture seule) traduite en `AUTH_SUCCESS` sur le bus si une session existe (réelle ou démo) — sinon rien n'est publié, comportement silencieux inchangé par défaut.

Compatibilité vérifiée avec la production réelle avant d'activer quoi que ce soit (pas supposée) :
- `DataModule.REGISTRY['seba_db']` valide exactement la forme du state `SebaDB` (`docs/seba-data.js`, `DB_KEY = 'seba_db'`) — même clé, mêmes tableaux (`clients/devis/factures/interventions/employes`). `DataModule.fetch('seba_db')` lit donc les vraies données métier.
- Confirmé en navigateur réel (Chrome headless, `http://localhost`, `seba_session_demo` + `seba_db` seedés) : la cascade `AuthModule.getSession() → AUTH_SUCCESS → DataModule → DATA_SUCCESS → TelemetryModule → TELEMETRY_READY → UIController.renderTelemetry()` se déclenche sans exception, sans casser le rendu existant (`window.SebaDB`, `window._ctx`, `window.handleLegacyClick` tous présents et fonctionnels après chargement).

## Correction critique trouvée en activant (pas une régression introduite, une régression évitée)

**`#notif-badge` a été retiré de `STATIC_TELEMETRY_FIELDS`** (`docs/src/modules/ui-controller.js`).

En Séquence 2/4 (PR #28), ce champ était mappé sur `facturesRetard` (compte de factures `status:'retard'` dans `seba_db`) — jamais vérifié contre le comportement réel de production, puisque rien n'était encore activé. En activant pour de vrai cette séquence, l'audit a montré que **`#notif-badge` appartient déjà à `renderNotifPanel(ctx)`** (`docs/dashboard.html`), alimenté par `ctx.creances` (`docs/widgets.js`, `buildWidgetCtx`, clé localStorage `creances_imp` — un registre de relance/recouvrement), un concept métier **différent** des factures en retard de `seba_db`. Les deux partagent le même id DOM par coïncidence historique, pas par équivalence de sens.

Laisser le mapping actif aurait fait remplacer, dès le premier `TELEMETRY_READY` réel, un badge correct (créances) par un nombre incohérent avec le panneau déroulant juste en dessous (qui continue de lister les créances). **Vérifié en navigateur réel** : avec une facture `status:'retard'` réelle dans `seba_db` (donc `facturesRetard: 1` calculé par `TelemetryModule`), `#notif-badge` reste strictement inchangé (`"0"`, `display:none`) après le déclenchement complet de la cascade — la régression est confirmée évitée, pas seulement supposée.

Conséquence assumée : le volet statique de `renderTelemetry()` (notif-badge/focus-score/checklist) est aujourd'hui un no-op complet en production — aucun des 4 champs de `STATIC_TELEMETRY_FIELDS` n'a de source réelle dans `TelemetryModule`. Documenté dans le code plutôt que masqué.

## Dette technique trouvée en activant — RÉSOLUE (PR #31, `feature/telemetry-deduplication`)

**Correctif appliqué** : `DataModule` n'écoute plus `AUTH_SUCCESS` du tout (voir `docs/src/modules/data-module.js`). Il ne réagit plus qu'à `DATA_REQUEST` (SAVE/FETCH/DELETE) et à `AUTH_SIGNED_OUT` (purge). Seuls les consommateurs réels demandent désormais explicitement ce dont ils ont besoin : `TelemetryModule` pour `seba_db`, `UIController` pour `sebaEntreprise` — chacun via son propre `DATA_REQUEST` sur `AUTH_SUCCESS`, un fetch par clé et par connexion. Aucune donnée perdue : les deux clés métier réelles étaient déjà redemandées explicitement par un consommateur, le fetch direct de `DataModule` était strictement redondant.

Vérifié après correctif : 1 seul `DATA_REQUEST`, 1 seul `DATA_SUCCESS(seba_db)`, 1 seul `TELEMETRY_READY` par connexion — confirmé par un test isolé, par `test-dashboard-init.js` (assertion stricte sur le compteur brut de `TELEMETRY_READY`), et en navigateur réel (Chrome headless). `test-data-migration.js` et `test-telemetry.js` (qui testent chaque module en isolation) restent inchangés et passants — aucun des deux n'exerçait le comportement retiré.

Détail du diagnostic original (pour mémoire) :

**`TelemetryModule` et `DataModule` réagissaient chacun indépendamment à `AUTH_SUCCESS`** et déclenchaient chacun un fetch de `seba_db` :
- `TelemetryModule` via `#requestRefresh()` → publie `DATA_REQUEST { action:'FETCH', key:'seba_db' }`
- `DataModule` via son propre `eventBus.subscribe(AUTH_SUCCESS, ...)` qui appelle `this.fetch('seba_db')` directement (indépendamment de tout `DATA_REQUEST`)

Résultat mesuré à l'époque (test isolé + confirmé en navigateur réel) : **1 seul `DATA_REQUEST` publié, mais 2 `DATA_SUCCESS(seba_db)` et donc 2 calculs `TELEMETRY_READY` pour une seule connexion.** Idempotent (même résultat calculé deux fois, pas de donnée incohérente) mais redondant : double lecture localStorage, double calcul d'agrégats, double re-render du volet dynamique à chaque login.

Une redondance similaire existait pour `sebaEntreprise` : `DataModule` la fetchait directement sur `AUTH_SUCCESS`, et `UIController.#onAuthSuccess()` la redemandait *aussi* via `DATA_REQUEST` — double écriture (identique) de `#sidebar-footer`. Résolue par le même correctif (`DataModule` ne fetch plus rien directement sur `AUTH_SUCCESS`).

À l'époque (PR #30), volontairement non corrigé dans la même PR que l'activation : corriger correctement demandait de trancher qui reste propriétaire du "fetch sur connexion" — une décision d'architecture séparée de l'activation elle-même, pas un correctif sûr à improviser en fin de séquence. C'est précisément l'objet de cette PR #31.

**Recommandation pour une séquence future** : soit retirer la responsabilité de fetch direct de `DataModule.constructor` sur `AUTH_SUCCESS` (laisser les *consommateurs* — `TelemetryModule`, `UIController` — demander explicitement ce dont ils ont besoin via `DATA_REQUEST`), soit dédupliquer dans `DataModule.fetch()` les appels concurrents sur une même clé dans le même tick. Nécessite de revalider les deux suites de tests isolées.

## Purge de la dette technique — ce qui N'A PAS été supprimé, et pourquoi

L'audit demandé (fonctions "autonomes de calcul CA/badges") a été fait sérieusement, pas superficiellement. Verdict : **aucune suppression n'est sûre aujourd'hui.** Ce qui ressemble à du code redondant en surface calcule en réalité des choses différentes ou plus riches que ce que `TelemetryModule` produit :

| Fonction / fichier | Ce qu'elle fait réellement | Pourquoi elle reste |
|---|---|---|
| `SebaDB.metrics()` (`docs/seba-data.js`) | `caMois` (filtré par mois), `caTotal`, `interventionsMois`, `interventionsJour`, etc. | `TelemetryModule.computeAggregates()` n'a **aucune** notion de mois — c'est un sous-ensemble brut, pas un remplaçant. `buildLiveData()` (ci-dessous) en dépend directement. |
| `buildLiveData()` (`docs/widgets.js:1515`) | Alimente les 4 cartes de métriques du cockpit (CA du mois + delta vs mois dernier, interventions, clients actifs + nouveaux, devis en attente + relance), l'équipe, le journal d'activité, la timeline, l'objectif mensuel | Consomme `SebaDB.metrics()` + calculs de delta additionnels (mois précédent, clients récents, devis stagnants). Rien d'équivalent côté `TelemetryModule`. |
| `renderNotifPanel(ctx)` (`dashboard.html:1939`) | Badge + liste déroulante des créances en retard (`ctx.creances`, clé `creances_imp`) | Concept métier différent de `facturesRetard` (voir section précédente) — pas un doublon, une fonctionnalité distincte. |
| `initChecklist/checkItem/updateChecklistBar` (`dashboard.html:1964+`) | Checklist d'onboarding (`seba_check_1/2`, confettis, fermeture) | Aucun rapport avec les données métier — `TelemetryModule` n'a jamais eu vocation à produire `checklistPct`/`checklistLabel` (voir commentaire déjà présent en PR #28). |
| `computeSerenityScore()` / `toggleFocusMode()` (`widgets.js`/`dashboard.html`) | Score de sérénité calculé sur le contexte complet (`_ctx`), affiché uniquement à l'ouverture du mode Focus | Ne s'exécute pas au chargement (à la différence de `renderTelemetry`), et dépend de `_ctx` entier, pas d'agrégats numériques seuls. |

Supprimer l'un de ces éléments aurait cassé une fonctionnalité réellement utilisée en production (delta CA mensuel, liste de créances, checklist d'onboarding, ou Focus Mode) pour satisfaire la lettre de la mission au prix de sa propre règle d'or (zéro régression). Documenté plutôt que fabriqué.

## Volet dynamique de `renderTelemetry()` — limite honnête

`renderTelemetry()` redéclenche `window.renderCockpitTelemetry(window._ctx)` en réutilisant le `_ctx` **existant**, jamais reconstruit à partir des seuls agrégats de `TelemetryModule` (décision déjà prise et documentée en PR #28, confirmée toujours justifiée : `_ctx` porte `biz/secteur/demo/creances/sym/...`, pas seulement des totaux). Conséquence : si `TELEMETRY_READY` se déclenche sans qu'aucun autre code n'ait déjà rafraîchi `window._ctx` avec des données plus fraîches, ce volet re-peint des valeurs identiques — un no-op visuel, pas un vrai rafraîchissement. Reconstruire `_ctx` correctement demanderait d'exposer `buildWidgetCtx`/`biz`/`demo` (aujourd'hui des fermetures privées du script classique de `dashboard.html`), une extraction hors périmètre de cette séquence.

## Gains d'architecture réels (pas de chiffres inventés)

- Le pipeline événementiel `Auth → Data → Telemetry → UI` est démontré fonctionnel de bout en bout, avec des tests qui exécutent le **vrai code de production** (pas des doublures) : `docs/src/test-dashboard-init.js` importe `dashboard-init.js`, `ui-controller.js`, `telemetry-module.js` tels quels, seuls `window`/`document`/`localStorage` sont mockés.
- Hotfix XSS (PR #28) confirmé toujours actif et testé (`esc()` sur `renderNotifPanel`).
- Une vraie régression potentielle (`#notif-badge` incohérent) a été trouvée et corrigée **avant** merge, pas après un signalement utilisateur.
- Une vraie duplication de calcul (`TelemetryModule`/`DataModule` sur `AUTH_SUCCESS`) a été trouvée, mesurée précisément, et documentée avec un test qui la fige explicitement plutôt que de la laisser dériver silencieusement.

Pas de claim de "latence 0ms" ou "découplage total" : le volet statique est un no-op aujourd'hui, le volet dynamique re-peint sans données fraîches, et deux modules dupliquent un fetch par connexion. C'est un socle activé et vérifié, pas une refonte complète du dashboard.

## Fichiers touchés

- `docs/src/ui/dashboard-init.js` — instanciation de la chaîne + `wakeUpCore()`
- `docs/src/modules/ui-controller.js` — retrait de `notif-badge` de `STATIC_TELEMETRY_FIELDS`
- `docs/src/test-dashboard-init.js` — réécrit pour couvrir l'activation réelle bout-en-bout
- `docs/src/test-ui-controller.js` — tests 8/9 adaptés au retrait de `notif-badge`
- `docs/dashboard.html` — **non modifié** (aucune suppression, voir section "Purge")

## Tests

Suite complète passante : `test-auth-migration`, `test-data-migration`, `test-event-bridge`, `test-telemetry`, `test-ui-controller`, `test-dashboard-init`. Lint design-system OK. ESLint propre sur les fichiers de production modifiés. Vérification additionnelle en navigateur réel (Chrome headless via un serveur HTTP local, `docs/dashboard.html` servi tel quel) : aucune exception, `window.SebaDB`/`window._ctx`/`window.handleLegacyClick` intacts, cascade `TELEMETRY_READY` confirmée visuellement (×2, duplication documentée ci-dessus), `#notif-badge` confirmé préservé.

`node scripts/qa-dashboard-full.js --target=local` a aussi été exécuté : aucune régression détectée sur ce qu'il peut observer, mais **ce script ne peut pas charger `dashboard-init.js`** (`type="module"` bloqué par la politique CORS de `file://`, limite structurelle préexistante, sans lien avec cette PR) — c'est pourquoi la vérification réelle de l'activation a été faite via un serveur HTTP local séparément (voir ci-dessus).
