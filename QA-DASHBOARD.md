# QA final — Dashboard Seba (`docs/dashboard.html` + `docs/widgets.js`)

Date : 2026-07-08
Branche : `amelioration-dashboard` (aucun push, aucun merge vers `main`)
Rôle : QA indépendant, après audit (`AUDIT-DASHBOARD.md`), benchmark (`BENCHMARK-DASHBOARD.md`) et 12 commits d'implémentation (`f12ef3f`…`e7cae07`).

Méthode : lecture intégrale du diff `git diff main...HEAD` sur `docs/dashboard.html`, `docs/widgets.js`, `scripts/qa-dashboard-full.js` (325 lignes changées) ; exécution répétée de `node scripts/qa-dashboard-full.js --target=local --viewport=desktop|mobile` ; scripts Puppeteer ad hoc temporaires (écrits dans le dossier scratch, jamais commités) pour cibler précisément les 4 points laissés non vérifiés par l'agent précédent, plus tout ce qui semblait à risque à la lecture du diff. Tous les scripts temporaires ont été supprimés du repo avant les commits finaux (`git status` vérifié propre : seuls les 3 fichiers de correctifs ci-dessous sont modifiés).

---

## 1. Les 4 points explicitement non vérifiés — désormais vérifiés

### 1.1 — Rendu visuel réel de la pile "Conscience Seba" après le fix anti-chevauchement
**Vérifié : PARTIELLEMENT CASSÉ, puis CORRIGÉ (commit `2f57bf9`).**

Mesure Puppeteer (`getBoundingClientRect`, `elementFromPoint`) : avec 1-2 notifications, le fix (`max-height:46vh`, `pointer-events:none` sur le conteneur, `pointer-events:auto` sur chaque carte, réserve `padding-bottom` sur `.main`) fonctionne comme prévu. Mais en déclenchant `triggerAuraDemo()` plusieurs fois de suite sans dismiss (scénario réaliste : plusieurs prédictions IA s'accumulent avant que l'utilisateur les traite), la pile grandit jusqu'à sa vraie limite CSS (`max-height:46vh` ≈ **414px** sur un viewport de 900px), alors que la réserve posée par `updateAuraReserve()` était une valeur **fixe de 260px**. Mesure directe : à 4 cartes empilées, `elementFromPoint` sur le bouton "Valider" d'un Vecteur d'Action renvoyait bien le bouton lui-même (`.aura-btn.validate`), pas le Vecteur d'Action — un recouvrement résiduel réel, pas un faux positif.
**Correctif appliqué (`2f57bf9`)** : `updateAuraReserve()` mesure maintenant la hauteur réelle de `.aura-stack` (`getBoundingClientRect().height`) et pose une réserve dynamique en style inline (`Math.max(h + 40, 260) + 'px'`), au lieu d'une valeur devinée. Revérifié après correctif : avec 5 cartes accumulées (stack à 414px, plafond max-height), le bouton "Valider" redevient correctement cliquable (`elementFromPoint` renvoie `BUTTON.av-validate`).

### 1.2 — Centrage vertical des états vides riches sur widgets L/XL (`lot-tournee`, `lot-pipeline`)
**Vérifié : CASSÉ, puis CORRIGÉ (commit `cc3c121`).**

Cause racine identifiée (pas seulement l'hypothèse "`.widget-body` n'est flex que pour S/M") : `buildRichEmptyHTML()` (benchmark Airbnb §5.1) injecte son HTML **directement** dans `.widget-body`, sans le wrapper `.bc-pad` (`display:flex;flex-direction:column;height:100%`) dont bénéficie l'état vide natif de `bento-chart`. Résultat mesuré (bounding boxes avant correctif) :
- `lot-tournee` (L, 163px de hauteur utile) : contenu de 187,7px → débordement de 24,7px, **pas centré**.
- `lot-pipeline` (XL, même hauteur utile que L car `grid-row:span 2` identique) : contenu de 208px → débordement de 45px, **pas centré**.
- `lot-impayes` (M, 94px de hauteur utile, où `.widget-body` EST pourtant flex) : contenu de 174px → débordement de **80px**, toujours pas centré (le simple fait d'être flex ne suffit pas si le contenu dépasse la boîte disponible).

**Correctif appliqué (`cc3c121`)** : `.bc-empty-body` reçoit `height:100%` (fonctionne que le parent soit flex ou non, tant qu'il a une hauteur définie — c'est toujours le cas via le `flex:1` déjà présent sur `.widget-body`) + gabarit visuellement plus compact (icône 48→34px, marges et tailles de police réduites, `max-width` du sous-titre élargi de 240px à 360px pour réduire le nombre de lignes). Revérifié après correctif, sur les 3 tailles : contenu et boîte ont exactement la même hauteur (`topGap`/`bottomGap` = 0 dans les 3 cas), confirmé aussi par capture d'écran (`lot-tournee` et `lot-pipeline` : rendu propre et centré ; `lot-impayes` : tient dans les 94px disponibles, contenu entièrement visible, sans coupure).

### 1.3 — Comportement avec de VRAIES données (pas seulement `?demo`)
**Vérifié : FONCTIONNE, aucune correction nécessaire.**

Seedé via `SebaDB.create('clients'|'factures'|'interventions'|'employes', …)` + `localStorage.seba_creances_imp` (chemin indépendant de `?demo` — confirmé que ce paramètre d'URL n'est lu nulle part dans `dashboard.html`, la vraie bascule est `SebaDB.hasData()`) :
- **Notifications (cloche)** : badge passe de masqué à `"2"`, panneau liste les 2 vraies créances en retard avec montant réel (`900 €`, `320 €`), lien vers `contentieux-recouvrement.html`. Fonctionne.
- **Ligne d'objectif** : avec `ctx.demo.goal` construit par `buildLiveData()` (CA réel + `target` de repli à 3500), la ligne pointillée (`stroke-dasharray:"3 3"`) se dessine bien sur le Cockpit financier en mode "6 mois". Fonctionne.
- **Sélecteur de période** : `switchChartPeriod('jour')` avec `window._ctx` réel bascule bien sur `buildHorizonSeries` (2 chemins SVG rendus), et retour à `'mois'` réaffiche la ligne d'objectif. Fonctionne.

### 1.4 — Cérémonie de calibration avec `prefers-reduced-motion: reduce`
**Vérifié : FONCTIONNE, aucune correction nécessaire.**

Comparaison chronométrée (polling 50ms dès `domcontentloaded`, sur le même environnement/réseau) :
| Scénario | Durée mesurée |
|---|---|
| Normal (pas de préférence reduced-motion) | ~5038ms (conforme à l'estimation de l'audit, ~4.7s+) |
| `prefers-reduced-motion: reduce` | **~703ms** — saute directement à l'état verrouillé, pas de rotation `rAF` |
| Skip par touche Échap (desktop) | **~709ms** après ouverture |
| Skip par tap sur l'overlay (mobile, `page.tap`) | **~1037ms** après ouverture |
| CDN `world-atlas` bloqué indéfiniment (simulé via interception réseau) | **~3457ms** — le timeout de 3.5s (`Promise.race`) se déclenche bien, dashboard reste utilisable (15 widgets rendus) après |

Point à noter, non corrigé car conforme au périmètre du fix (391c9f6) : sur mobile, le hamburger reste bien couvert par `#calib-overlay` pendant la durée de la cérémonie **normale** (~4.8s) si l'utilisateur ne tape/n'appuie pas sur Échap — c'est le comportement voulu (cérémonie unique dans la vie du navigateur, avec échappatoire disponible), pas un blocage sans issue comme avant le fix.

---

## 2. Régression sur la Bible du Dashboard (13 fonctionnalités)

Vérifié individuellement (script QA + vérifications ciblées) : Serenity Score (canvas + 3 labels d'orbite), Console de Commande IA (overlay s'ouvre, champ accepte la saisie, aucune erreur console), Mode Focus (overlay + Échap), Vecteurs d'Action (Valider retire bien la carte — voir §3 pour le faux positif initial), Lignes d'Horizon (canvas + resize), Timeline de Vie (visible desktop, correctement masquée et non animée <1180px), Drag & Drop (12 poignées en mode personnalisation), Bibliothèque d'Extensions (12 tuiles, ouverture/fermeture), Conscience Seba (déclenchement manuel, ignore/validate), Planète de Calibration (§1.4 ci-dessus), Pont de Données (lien + fonction `activerDonneesReelles` présents), Interface Sonore (`AudioUI.playComplete` appelé sans erreur pendant la calibration), Thème Tactical Dark (fond reste `rgb(9,9,11)` après toggle, cohérent avec la charte "jamais de clair").

Aucune régression fonctionnelle trouvée sur ces 13 points.

---

## 3. Bug de test découvert et corrigé dans `scripts/qa-dashboard-full.js` (commit `401c87d`)

En creusant un FINDING ("clicking Valider did not reduce card count") qui semblait être une régression des 12 commits, l'investigation (capture-phase click logger + `elementFromPoint`) a montré que le clic Puppeteer était en réalité intercepté par **`#calib-overlay`** (la cérémonie de calibration, encore ouverte ~1,5s après le chargement puisqu'elle dure jusqu'à ~5s) — pas par le bouton lui-même. Confirmé reproductible **avant même mes corrections** (`git stash` + re-run) : ce n'était pas une régression des 12 commits, mais un angle mort préexistant du script QA, qui ne neutralisait jamais `seba_calibration_seen` avant de tester les interactions du dashboard "utilisateur revenant".
**Correctif** : le script seede désormais `localStorage.seba_calibration_seen = '1'` avant le test (comme un vrai utilisateur au 2e chargement), et la vérification "Timeline de Vie zero-size" ne lève plus un FINDING quand le viewport est <1181px (comportement voulu par le fix audit 3.4, pas un bug). Revérifié : 0 FINDING, 0 erreur console, sur desktop et mobile, de façon stable sur plusieurs runs consécutifs.

---

## 4. Code mort / dupliqué

Recherche de fonctions dupliquées (`grep` sur les définitions `function` dans les deux fichiers) : aucune. Classes CSS ajoutées par les 12 commits (`.notif-wrap`, `.notif-panel*`, `.bc-period-*`, `.zone-eyebrow`) : toutes utilisées, aucune orpheline. Badge "2" figé en dur (audit 1.4) : retiré, remplacé par un badge dynamique masqué par défaut. `window._ctx` : une seule exposition (`dashboard.html`), une seule consommation (`widgets.js:switchChartPeriod`). `AURA_TEST_SCENARIOS`/`triggerAuraDemo` : conservés intentionnellement (commentaire explicite) pour un déclenchement manuel en QA, plus jamais appelés automatiquement au chargement.

---

## 5. Responsive desktop/mobile — réellement vérifié, pas supposé

`scripts/qa-dashboard-full.js --viewport=desktop` (1440×900) et `--viewport=mobile` (390×844, `isMobile:true`, `hasTouch:true`) exécutés à répétition après chaque correctif : **0 erreur console/page/requête réseau, 0 FINDING** sur les deux viewports, de façon stable. Vérifications manuelles additionnelles : sidebar mobile (`toggleSidebar`/`position:fixed`, confirmé sain par l'audit, revérifié inchangé), pile Conscience Seba sur mobile (`max-height:34vh`, pas de recouvrement de la Welcome Checklist), tap-to-skip de la calibration sur mobile (touch, pas seulement clavier).

---

## 6. Commits de correction

| Hash | Message |
|---|---|
| `2f57bf9` | fix: reserve dynamique sous la pile Conscience Seba (recouvrement residuel a 3+ cartes) |
| `cc3c121` | fix: centrage vertical des etats vides riches sur widgets M/L/XL (lot-tournee, lot-pipeline, lot-impayes) |
| `401c87d` | fix: qa-dashboard-full.js ne confond plus la ceremonie de calibration et le rail Timeline masque avec de vrais bugs |

---

## 7. Ce qui reste à vérifier humainement (pas vérifiable en autonomie)

- **Rendu visuel subjectif** : les captures d'écran confirment un centrage techniquement correct et l'absence de coupure de contenu, mais l'appréciation esthétique finale (est-ce que le gabarit compact de `.bc-empty-*` "a l'air bien" à l'œil, pas seulement mesurable) reste un jugement humain.
- **Vraies données de production** : tout le test "données réelles" ci-dessus utilise `SebaDB` en local (localStorage), pas un vrai compte Supabase avec de vraies factures/clients d'un artisan. Le comportement avec un vrai backend distant (latence réseau, erreurs API, données malformées d'un vrai utilisateur) n'est pas couvert.
- **Device physique mobile réel** : le viewport mobile Puppeteer (390×844, `isMobile:true`) simule un mobile mais ne remplace pas un test sur un vrai téléphone (tactile réel, clavier virtuel, Safari iOS notamment — Puppeteer utilise Chromium, pas WebKit).
- **Cérémonie de calibration — durée normale (~5s) sur un vrai utilisateur** : le chronométrage confirme que le mécanisme fonctionne comme codé, mais l'acceptabilité UX de "bloquer l'écran ~5s à la toute première visite" reste un jugement produit, pas un bug technique.
- **Console de Commande IA** : ouverture/saisie vérifiées sans erreur, mais le matching réel de commandes ("ajouter widget carte" → suggestion) n'a pas été validé en profondeur (hors périmètre des 12 commits, non touché par eux).

---

## Résumé (≤150 mots)

Les 12 commits corrigent réellement les bugs de l'audit et appliquent les recommandations du benchmark, confirmé par QA répété (0 erreur, 0 finding, desktop + mobile, plusieurs runs). Deux angles restés non vérifiés cachaient de vrais bugs résiduels, maintenant corrigés : la réserve anti-chevauchement de la pile Conscience Seba était une valeur fixe insuffisante dès 3+ notifications accumulées (recouvrement mesuré, corrigé par un calcul dynamique) ; les états vides riches des widgets Compagnon n'étaient pas centrés et débordaient de leur boîte sur M/L/XL (cause racine identifiée : wrapper flex manquant, corrigé). Le calcul de la calibration (reduced-motion, timeout CDN, skip clavier/tactile) fonctionne comme codé, chronométré précisément. Un bug de test (pas de régression produit) dans le script QA lui-même a aussi été corrigé. Restent hors de portée autonome : jugement esthétique final, vrai backend Supabase, vrai device mobile.
