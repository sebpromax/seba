---
name: dashboard-v2-master-plan
status: draft
version: 1
scope: docs/app/dashboard.html, docs/widgets.js, docs/services/config-dashboard.js, docs/services/widget-data-api.js
depends_on: _architecture/WIDGET_MASTER_PLAN.md, _architecture/WIDGET_DEVELOPMENT_PROTOCOL.md
---

# Dashboard Seba V2 — Master Plan de migration

## 0. Objectif et statut

Ce document planifie la transition du dashboard "grille de widgets" (V1, livré) vers le
dashboard "cockpit de décision" (V2, vision produit reçue le 2026-07-15). **Aucun code
n'est modifié par ce document.** C'est une réconciliation entre la vision et l'état réel
du code (26 widgets, moteur de compatibilité par secteur, contrat "Widget Pur").

**Décision en attente (bloquante avant Phase 1) :** la charte visuelle V2 (violet
`#7C5CFC` / fond `#0E0F12` / Inter) remplace ou coexiste avec "Tactical Dark Absolu"
(`#09090B` / émeraude `#10B981` / mono) — reportée par le fondateur. Tant que cette
décision n'est pas prise, la Phase 1 (squelette layout) peut avancer en héritant des
tokens CSS existants de `pro-global.css` ; aucune couleur de la vision V2 ne doit être
codée en dur avant l'arbitrage (violation immédiate de `tools/check-design-system.js`).

Contexte technique non négociable (voir `CLAUDE.md`) : zéro bundler, zéro framework, JS
vanilla, SebaDB comme unique source de données métier, contrat "Widget Pur" (un widget
ne lit jamais `window.SebaDB`/`localStorage` directement — il passe par
`window.SebaWidgetAPI`).

---

## 1. Mapping existant → V2

26 widgets réels dans `WIDGET_CATALOG` (`docs/widgets.js`), extraits directement du
code (id / titre / catégorie / source). Statuts :

- **Migré** — widget existant réutilisé tel quel (ou avec adaptation de titre/style) dans une zone V2.
- **Orphelin** — widget conservé dans le catalogue (pas supprimé), mais sans zone V2 dédiée dans le MVP 12-widgets (§25 de la vision) ; reste sélectionnable via "Personnaliser".
- **Supprimé** — retiré de la disposition par défaut du dashboard ; code archivé (jamais effacé, voir §5 Règles de protection).

| Widget actuel (id) | Titre actuel | Zone V2 cible | Statut |
|---|---|---|---|
| `serenity-score` | Indice de santé du compte | `header-status-group` (`#v2-header`) | **Supprimé*** — exécuté, voir §4quater |
| `metric-0` | Métrique principale | Zone 3 — Santé financière (à réassigner : CA/Marge/Encaissements) | Orphelin |
| `metric-1` | Métrique activité | Zone 2 Bloc A — Interventions (compteur) | Migré |
| `metric-2` | Métrique clients | — (aucune zone V2 dans le MVP 12 widgets ; futur module "Commercial") | Orphelin |
| `metric-3` | Métrique devis | Zone 3 Carte 4 — Devis | Migré |
| `bento-chart` | Suivi des encaissements | Zone 3 — Santé financière (`.v2-zone-finance`) | **Migré*** — exécuté, voir §3bis |
| `bento-actions` | Actions flash | Bouton `+ Créer` (`#v2-header`) — partiel | **Supprimé*** — exécuté, voir §4quater (dette : lien paiement/intervention non couverts) |
| `timeline` | Journée d'aujourd'hui | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — exécuté, voir §3bis (retiré de PINNED_TELEMETRY_IDS) |
| `activity` | Activité récente | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — pilote exécuté, voir §3bis |
| `recos` | Recommandations Seba | Zone "Seba IA" (§21 vision, position 14 dans l'ordre §24) | Migré |
| `quick-actions` | Actions rapides | Bouton `+ Créer` (`#v2-header`) — partiel | **Supprimé*** — exécuté, voir §4quater (dette : "+ Facture" non couvert) |
| `goal` | Objectif du mois | Zone 3 Carte 1 — CA (fusionné : barre d'objectif) | Migré |
| `workspace` | Votre espace | — (explicitement listé §26 de la vision) | Supprimé |
| `portal` | Portail client | — (retiré du dashboard, relocalisé en item de sidebar "Configuration", §2 vision) | Supprimé |
| `team` | Équipe aujourd'hui | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — exécuté, voir §3bis |
| `chart-donut` | Répartition des interventions | — (graphique décoratif sans action, contraire à §13/§26 vision) | Orphelin |
| `lot-impayes` | Factures en retard | "À traiter maintenant" (facture échue) + Zone 3 Encaissements | Migré* |
| `lot-pipeline` | Pipeline devis → facture → encaissé | Zone 3 (Devis/Encaissements) ou Analyse détaillée | Migré* |
| `lot-tournee` | Tournée du jour | Zone 2 Bloc C — Carte et déplacements | Migré* |
| `lot-carte` | Carte des interventions | Zone 2 Bloc C — Carte et déplacements | Migré |
| `lot-treso` | Position de trésorerie | Zone 3 — Santé financière (`.v2-zone-finance`) | **Migré*** — exécuté, voir §3bis (source `lot:treso` inchangée, dette de données) |
| `generic-media-report` | Rapport photo | Zone 5 — Qualité ("Photos manquantes") | Migré |
| `marge-reelle` | Marge réelle | Zone 3 — Santé financière (`.v2-zone-finance`) | **Migré*** — exécuté, voir §3bis. Zone 4 (Rentabilité par intervention) reste sans widget : nécessite `dureeEstimee`/`dureeReelle`, voir §2 |
| `ext-chart` | Nouveau Graphique | — (widget d'extension générique, catalogue seulement) | Orphelin |
| `ext-notes` | Bloc-notes | — (widget d'extension générique, catalogue seulement) | Orphelin |
| `ext-rss` | Flux RSS Finance | — (widget d'extension générique, catalogue seulement) | Orphelin |

`*` — voir §2 : source `lot:*` = données de démonstration issues du cluster "Lot"
(mockups déconnectés, WM-007), pas de SebaDB réelle. Migration de zone ≠ migration de
données — les deux sont dissociées en Phase 2 vs Phase 3.
`**` — `marge-reelle` a déjà le contrat Widget Pur correct et une source `live`, mais
`SebaWidgetAPI.getMargeReelle()` renvoie `null` en pratique (`coutReel` n'existe pas
dans SebaDB). Voir §2.

**15 widgets migrés, 8 orphelins, 3 supprimés** — cohérent avec le MVP 12 widgets visé
en §25 de la vision (le compte ne tombe pas pile sur 12 car plusieurs widgets migrés
fusionnent dans une même carte cible, ex. `goal` + `bento-chart` → une seule carte CA).

---

## 2. Diagnostic des données (checklist)

Champs requis par widget "Financier" ou "Rentabilité", confrontés à l'état réel de
SebaDB (`docs/seba-data.js` : collections `clients, devis, factures, interventions,
employes, journal` — aucune entité coût/photo/contrat/stock/équipement/incident).

| Widget | Champ requis | État de l'API |
|---|---|---|
| `goal` (CA + objectif) | `factures[].montant` (agrégation CA du mois) | Disponible |
| `goal` (CA + objectif) | `objectifCA` (cible mensuelle configurable) | Manquant — aucune collection "objectifs" dans SebaDB |
| `bento-chart` (Encaissements) | `factures[].montant`, `factures[].statut` | Disponible |
| `bento-chart` (Encaissements) | `factures[].dateEcheance` (distinction échu/à venir) | À vérifier — champ probablement présent, non confirmé sur ce passage |
| `metric-3` (Devis) | `devis[].montant`, `devis[].statut` (en attente/relancé) | Disponible |
| `lot-impayes` (Factures en retard) | `factures[].dateEcheance` + `statut` en retard | Manquant côté branchement — widget source `lot:contentieux`, sert des données de démo du cluster "Lot", **pas** de requête SebaDB réelle |
| `lot-pipeline` (Devis→Facture→Encaissé) | Chaîne `devis → factures → paiements` | Manquant côté branchement — source `lot:mutation`, idem `lot-impayes` |
| `lot-treso` (Position de trésorerie) | `factures[].montant/statut` + `dépenses[]` | Manquant — source `lot:treso` (démo) **et** aucune collection "dépenses" dans SebaDB |
| `marge-reelle` (Marge réelle) | `interventions[].montant` | Disponible |
| `marge-reelle` (Marge réelle) | `interventions[].coutReel` | Manquant — champ absent de SebaDB ; `SebaWidgetAPI.getMargeReelle()` renvoie honnêtement `null` (voir `docs/services/widget-data-api.js:78-88`) |
| Zone 3 Carte 5 (Dépenses, vision §7) | `depenses[].montant` par catégorie (personnel/produits/déplacements) | À implémenter — aucun widget existant, aucune collection SebaDB |
| Zone 4 (Rentabilité par intervention, temps prévu vs réel) | `interventions[].dureeEstimee`, `interventions[].dureeReelle` | Manquant — aucun des deux champs n'existe dans SebaDB aujourd'hui |
| Zone 6 (Stock/matériel, vision §10) | `stock[]`, `equipements[]` | Manquant — aucune collection |
| Zone 5 (Qualité, contrôles/réclamations, vision §9) | `controlesQualite[]`, `reclamations[]` | Manquant — aucune collection |

**Conséquence directe pour le phasage :** la Phase 2 (migration de zone) peut afficher
les widgets `lot-*` et `marge-reelle` dans leur nouvel emplacement visuel immédiatement
— mais leurs états resteront soit "données de démonstration" (source `lot:*`) soit
"état vide honnête" (`marge-reelle`) tant que la Phase 3 n'a pas rebranché les données
réelles. Ne jamais présenter une donnée `lot:*` comme si elle était `live` dans l'UI V2
sans le signaler (le badge de source existant dans `buildLibraryPanelHTML` doit rester
visible pendant toute la Phase 2).

---

## 3. Stratégie de migration (phasage)

### Phase 1 — Squelette (layout uniquement)

- Nouveau layout CSS grid 12 colonnes dans `docs/app/dashboard.html` (sidebar 240px /
  contenu 1200px, gouttière 16px, cartes 14px de rayon) — **zéro widget déplacé**.
- Nouvelles zones DOM vides (placeholders) dans l'ordre exact de la vision §24 : Header
  → Bandeau de situation → À traiter maintenant → Aujourd'hui (3 blocs) → Santé
  financière → Rentabilité métier → Qualité → Stock → Recommandations → Analyse.
- Le layout V1 actuel (`getEffectiveLayout()`, `renderGrid()`) continue de fonctionner
  en parallèle, caché derrière un flag ou une route de dev (`?v2=1`), pour permettre un
  A/B visuel sans casser la production.
- Aucun token couleur V2 codé en dur tant que §0 (décision charte) n'est pas tranchée —
  utiliser des variables CSS neutres (`--v2-bg`, `--v2-accent`, etc.) à résoudre plus
  tard, exactement comme demandé par `tools/check-design-system.js`.
- Livrable : page statique naviguable, zones visuellement correctes, contenu = titres
  de zone uniquement (pas de widgets réels).

### Phase 2 — Migration contenu

- Réaffectation des 15 widgets "Migré" du §1 dans leur zone cible, via
  `SEBA_DASHBOARD_CONFIG`/`getEffectiveLayout()` existants — **pas de nouveau moteur de
  layout**, seulement de nouvelles zones de destination pour les widgets déjà rendus.
- Les 8 widgets "Orphelin" restent dans le `WIDGET_CATALOG` et le panneau
  "Personnaliser" (`buildLibraryPanelHTML`) — non affichés par défaut en V2, mais
  ajoutables manuellement (aucune régression pour un utilisateur qui les a déjà
  activés, voir §5 Règles de protection).
- Les 3 widgets "Supprimé" sont retirés de `CORE`/`BY_SECTEUR` (plus proposés par
  défaut) mais leur `render()` reste dans `WIDGET_CATALOG`, commenté ou déplacé dans une
  section clairement marquée "archivé V1" (voir §5).
- Fusion visuelle : `goal` (objectif) s'intègre comme barre de progression dans la carte
  CA (`bento-chart`/nouveau composant), pas comme deux cartes séparées.
- Bandeau de situation (vision §4) : nouveau composant, alimenté par une agrégation des
  signaux déjà calculés par `lot-impayes` (factures échues), `timeline`/`metric-1`
  (interventions du jour), et l'équipe (absences) — pas de nouvelle source de données,
  juste une nouvelle façade de lecture.
- Livrable : dashboard V2 fonctionnel avec données réelles là où elles existent, et
  badges "démo"/"vide" honnêtes là où le §2 les identifie comme manquantes.

### Phase 3 — Fiabilisation

- Implémentation des champs manquants identifiés en §2, par ordre de priorité produit
  (proposition, à valider avec le fondateur) :
  1. `depenses[]` (collection SebaDB) — débloque Zone 3 Carte 5.
  2. `interventions[].coutReel` — débloque `marge-reelle` (déjà câblé, juste vide).
  3. `interventions[].dureeEstimee` / `dureeReelle` — débloque Zone 4 (Rentabilité par
     intervention, temps prévu vs réel).
  4. Rebranchement `lot-impayes`/`lot-pipeline`/`lot-treso` sur SebaDB réelle au lieu de
     leur source `lot:*` — supprime la dépendance résiduelle au cluster "Lot" (déjà
     `noindex` via `robots.txt`, WM-007).
  5. Nouveaux widgets métier "purs" pour Zone 5 (Qualité) et Zone 6 (Stock) — nécessite
     de nouvelles collections SebaDB (`controlesQualite`, `reclamations`, `stock`,
     `equipements`) : hors périmètre de ce document, à cadrer séparément.
- Nettoyage effectif du code archivé (§4 Liste noire) une fois la Phase 2 validée en
  production sans régression mesurée (script QA `qa-dashboard-full.js` vert sur au
  moins un cycle complet).
- Livrable : dashboard V2 avec données 100% réelles sur les widgets migrés, ou état vide
  honnête documenté pour ceux qui dépendent encore d'un champ SebaDB non implémenté.

### 3bis. Pilote exécuté — `activity` (branche `feat/dashboard-v2-layout`)

Premier widget effectivement déplacé en Phase 2, pour valider le mécanisme avant de
l'appliquer aux 14 autres widgets "Migré" du §1. Mécanisme retenu (à reproduire à
l'identique pour les prochains) :

- `docs/widgets.js` : `MIGRATED_TO_V2_IDS` (liste plate, à côté de
  `PINNED_TELEMETRY_IDS`) exclut le widget de `renderGrid()` (V1) — un
  `document.createComment(...)` est inséré à sa place dans `#widget-grid` au lieu de
  supprimer le code. `renderV2ZoneActivite(ctx)` (nouvelle fonction, exposée
  `window.renderV2ZoneActivite`) monte le même `def.render(ctx, el)` — **aucune
  duplication de logique/données** — dans `.v2-zone-activite`.
- `docs/app/dashboard.html` : `renderDashboard()` appelle `renderV2ZoneActivite(_ctx)`
  juste après `renderGrid(...)`, avec le même `_ctx`, uniquement si
  `window.__SEBA_V2_ENABLED__` (flag posé par le script de toggle `?v2=1` du squelette
  Phase 1).
- Chrome du widget en V2 (tête/titre/lien) : classes `.v2-widget-container` /
  `.v2-widget-head` / `.v2-widget-title` / `.v2-widget-link` / `.v2-widget-content`
  (nouvelles, `docs/css/dashboard-v2.css`) — jamais `.widget-shell`/`.module-head`
  (styles "legacy" du `<style>` de `dashboard.html`, non réutilisés pour la coque V2).
  Le contenu injecté par `def.render()` (ex. `.activity-item`/`.act-dot`) reste
  inchangé et continue de s'afficher correctement : ces classes ne sont pas scopées à
  `.app`, donc pas de fuite ni de perte de style à gérer.
- **Bug préexistant corrigé au passage** : `activity.link.href` valait `'historique.html'`
  (sans `../`), un résidu de la migration `docs/dashboard.html` → `docs/app/dashboard.html`
  qui faisait 404 en V1 comme en V2. Corrigé en `'../historique.html'` — bénéficie aux
  deux, pas seulement à V2. `goal`/`quick-actions` ont le même motif de lien non préfixé
  et n'ont pas été corrigés ici (hors périmètre de ce pilote) — à vérifier avant leur
  propre migration.
- Validé via Puppeteer (`?demo&v2=1` + `sebaEntreprise` seedé en localStorage) : V1 sans
  `activity` (comment présent, 15 autres widgets intacts) ; V2 avec les 4 items de
  démo réels, lien correct, classes attendues ; `pro-global.css` diff vide ;
  `tools/check-design-system.js` vert.

### 3ter. Vague 2 exécutée — `timeline`, `team`, `bento-chart`, `marge-reelle`, `lot-treso`

Deuxième vague de migration (même branche), "pipeline industriel" par lots plutôt que
widget par widget. Généralisation du mécanisme du pilote §3bis :

- `docs/widgets.js` : `MIGRATED_TO_V2_IDS` devient dérivé de deux listes par zone —
  `V2_ZONE_ACTIVITE_IDS = ['activity', 'timeline', 'team']` et
  `V2_ZONE_FINANCE_IDS = ['bento-chart', 'marge-reelle', 'lot-treso']` — une seule
  source de vérité pour "quoi exclure en V1" et "quoi monter, et où". La fonction de
  montage a été factorisée en `mountV2Widgets(zoneSelector, ids, ctx)`, réutilisée par
  `renderV2ZoneActivite()` et la nouvelle `renderV2ZoneFinance()` (toutes deux exposées
  sur `window`).
- **Cas particulier `timeline`** : contrairement aux autres widgets "Migré", il n'était
  pas rendu par `renderGrid()` mais épinglé dans `PINNED_TELEMETRY_IDS` (télémétrie fixe
  du cockpit, `renderCockpitTelemetry()`) — patron du §3bis non applicable tel quel.
  Retiré de `PINNED_TELEMETRY_IDS` (le trio CA/Serenity Score/Missions du jour devient
  un duo CA/Serenity Score) ; `MIGRATED_FROM_TELEMETRY_IDS = ['timeline']` fait insérer
  le commentaire de traçabilité dans `#cockpit-telemetry` (et non `#widget-grid`).
- **Nouvelle zone DOM** : `.v2-zone-finance` ajoutée au squelette (Phase 1) pour
  accueillir `bento-chart`/`marge-reelle`/`lot-treso` — même patron placeholder que les
  4 zones existantes, bascule en grille peuplée via `.v2-zone--has-widget` (règle CSS
  déjà générique, aucune duplication nécessaire). Zone 4 (Rentabilité par intervention)
  n'a **pas** reçu de conteneur : aucun widget disponible pour elle actuellement (voir
  §2, dette `dureeEstimee`/`dureeReelle`) — pas de placeholder vide non sollicité.
- **Bugs préexistants corrigés au passage** : `team.link.href` et les deux hrefs
  générés par `buildTeamItemEl()`/`buildRealTeamStatus()` valaient `'equipe.html'` (sans
  `../`), même résidu de migration `docs/app/` que `activity` — corrigés en
  `'../equipe.html'`. `lot-treso.link.href` (`'#'`) **n'a pas été touché** : ce n'est
  pas un lien cassé mais une neutralisation volontaire (WM-007, cible = cluster "Lot"
  non fiable) — à distinguer d'un oubli.
- `bento-chart` : `switchChartPeriod()` cible `[data-widget-id="bento-chart"]` en global
  (pas de dépendance à un conteneur V1 spécifique) — fonctionne à l'identique une fois
  monté en V2, aucune adaptation nécessaire. Interactivité (clic bouton période) validée.
- `marge-reelle` : `render()` async monté sans être attendu par `mountV2Widgets`, comme
  `renderGrid()` le faisait déjà — comportement inchangé (état "Marge réelle
  indisponible" affiché, `coutReel` toujours absent de SebaDB, voir §2).
- Validé via Puppeteer (`?demo&v2=1`) : V1 — `#widget-grid` sans les 4 widgets concernés
  (comment par widget, zone cible correcte dans le texte) ; `#cockpit-telemetry` réduit à
  `metric-0`/`serenity-score` + commentaire `timeline` ; `.v2-zone-activite` avec 3
  widgets réels ; `.v2-zone-finance` avec 3 widgets réels (chart D3, marge vide honnête,
  trésorerie) ; clic sur le bouton de période du graphique fonctionnel ; `pro-global.css`
  diff vide ; `tools/check-design-system.js` vert.

---

## Dettes de données (pipeline de migration, Priorités 3+)

Widgets/termes de la demande de migration sans correspondance exécutable actuellement —
notés ici plutôt que forcés, conformément à la note de conduite du chantier.

| Terme demandé | Widget catalogue le plus proche | Blocage | Décision |
|---|---|---|---|
| `planning` (Priorité 1) | Aucun — ni `lot-tournee` ni `lot-carte` ne correspondent sans ambiguïté | Nom ne désigne aucun id réel des 26 widgets | Ignoré pour cette vague (confirmé avec le fondateur) — `lot-tournee`/`lot-carte` restent "Migré*" (dette `lot:*`, voir §2), non traités ici |
| `quality-check` (Priorité 3) | `generic-media-report` (« Rapport photo ») | Aucune collection SebaDB de contrôles qualité (`controlesQualite`, `reclamations`) — déjà noté Manquant au §2 | Traité comme dette de données (confirmé avec le fondateur) — `generic-media-report` reste "Migré" au §1 mais non exécuté cette vague ; à faire dans une passe Priorité 3 dédiée |
| `stock-alerts` (Priorité 3) | Aucun | Aucune collection SebaDB (`stock`, `equipements`) ni widget existant — déjà noté Manquant au §2 (Zone 6) | Reporté entièrement : ni zone DOM ni widget à créer avant que la donnée existe |

## 4. Liste noire (nettoyage)

Éléments V1 à retirer de la disposition par défaut du dashboard (conformément à la
vision §26), à traiter en Phase 2/3 selon les règles de protection du §5 :

- Widget `serenity-score` ("indice de santé abstrait") — remplacé par le Bandeau de
  situation.
- Widget `workspace` ("Votre espace").
- Widget `portal` en grande carte ("portail client") — relocalisé en item de sidebar.
- Widget `bento-actions` ("Actions flash").
- Widget `quick-actions` — remplacé par le bouton `+ Créer` contextuel du header.
- Bouton flottant `+` sur desktop (vision §12) — conservé uniquement sur mobile
  (56px, `right:20px`/`bottom:20px`).
- Effets décoratifs : lignes lumineuses/néon, points colorés sur les bords, halos,
  bordures multicolores, effets brillants (vision §13, "Suppressions nécessaires").
- Graphiques sans échelle ni contexte chiffré (`chart-donut` reste dans le catalogue
  mais sort de la disposition par défaut — voir §1, statut Orphelin).
- Chiffres affichés sans contexte comparatif (tout widget qui affiche une valeur brute
  sans variation/objectif/période associée doit être révisé en Phase 2).
- Réglages de secteur et devise affichés en widget dashboard (déplacés vers
  Réglages/sidebar Configuration, hors dashboard).

**Aucun de ces éléments n'est effacé du code** — voir §5.

### 4bis. Audit d'exécution (branche `feat/dashboard-v2-layout`) — Statut : **bloqué, pas terminé**

Tentative de purge de la Liste Noire menée à son terme logique : **aucun des éléments
listés ci-dessus n'a pu être supprimé sans régression**, pour deux raisons distinctes,
vérifiées concrètement dans le code avant toute décision (pas une supposition) :

**1. Cinq entrées supposent un remplaçant V2 qui n'existe pas encore.**
`serenity-score`, `workspace`, `portal`, `bento-actions`, `quick-actions` sont "Supprimé"
dans l'hypothèse que le Bandeau de situation, le bouton `+ Créer` du header et le lien
sidebar "Portail client" existent en V2 — vérifié : `.v2-zone-header` et
`.v2-zone-bandeau-priorite` sont **toujours de simples placeholders** (Phase 1, aucune
logique), et aucun lien "Portail client" n'a été ajouté à la sidebar. Les supprimer
maintenant retirerait ces 5 fonctionnalités du dashboard réel (V1, sans `?v2=1`) sans
rien pour les remplacer. **Décision (confirmée avec le fondateur) : reportées** jusqu'à
ce que leur remplaçant V2 soit réellement construit (probablement en même temps que le
header/bandeau de situation eux-mêmes, un futur chantier dédié).

**2. Le bouton flottant `+` (desktop) sert une fonction réelle sans remplaçant non plus.**
`#fab`/`.fab-menu` (`docs/app/dashboard.html`) est le seul point d'accès "création
rapide" du dashboard actuel (client/devis/intervention, avec raccourcis clavier 1/2/3) —
pas une décoration. Le masquer sur desktop sans le bouton `+ Créer` du header (qui
n'existe pas encore) retirerait cette fonction pour tous les utilisateurs desktop.
**Reporté** pour la même raison que le point 1.

**3. Les "effets décoratifs" et "graphiques sans contexte" de la vision §13 ne
correspondent à aucun élément concret identifiable dans le code actuel.** Recherche
ciblée (lignes lumineuses/néon, points colorés sur les bords, halos, bordures
multicolores) : aucun résultat au-delà de fonctionnalités réelles déjà shippées
(`bg-shader.js` = intro globe, `#confetti-canvas` = célébration onboarding, `.fab` =
bouton de création). Le texte de la vision décrivait un pattern générique de mockup
("AI slop"), pas un défaut concret de l'implémentation Tactical Dark actuelle. Rien à
supprimer ici tant qu'un élément concret n'est pas désigné.

**Ce qui a effectivement été corrigé cette passe — dette de code réelle, pas de la
Liste Noire, trouvée en auditant le "code mort" post-migration :** `buildLibraryPanelHTML()`,
`matchIntent()` et `suggestClosest()` (`docs/widgets.js`) itéraient encore tout
`WIDGET_CATALOG`, y compris les 6 widgets déjà migrés (§3bis/§3ter) — un utilisateur
pouvait cocher "Activité récente" dans le panneau *Personnaliser*, ou taper "équipe" dans
la barre de commande IA (confirmation "✓ Widget ajouté", son, particules), sans que rien
n'apparaisse jamais dans la grille (`renderGrid()` les exclut désormais
inconditionnellement). Les trois fonctions excluent maintenant `MIGRATED_TO_V2_IDS` —
vérifié : le panneau ne les liste plus, la barre IA retombe sur un widget non-migré
pertinent (`metric-1` pour "activité") ou répond honnêtement "Aucun widget ne
correspond" plutôt que de mentir sur un ajout sans effet.

**Validé** : `#widget-grid`/`#cockpit-telemetry` déjà propres pour les 6 widgets migrés
(commentaires en place, confirmé §3bis/§3ter) ; `?demo&v2=1` sans erreur console ;
`.v2-zone-activite`/`.v2-zone-finance` toujours peuplées (3+3) après les corrections ;
`pro-global.css` diff vide ; `tools/check-design-system.js` vert (aucun fichier
HTML/CSS modifié cette passe).

### 4ter. `#v2-header` construit — débloque partiellement le point 1 du §4bis

Le blocage n°1 du §4bis (`serenity-score`/`workspace`/`bento-actions`/`quick-actions`
sans remplaçant V2) est **partiellement levé** : un header sticky réel existe maintenant
(`#v2-header`, hors de `.v2-grid-container`, `position:sticky`/`top:0`/`z-index:1000`),
remplaçant le placeholder plat Phase 1. Contenu, additif uniquement (aucun widget/élément
V1 supprimé cette passe — dé-duplication explicitement demandée) :

- **Zone gauche** (identité) : nom d'entreprise + badge secteur, mêmes données que le
  header V1 (`ctx.biz`/`ctx.sectorLabel`). Ne couvre **pas** la fonctionnalité propre au
  widget `portal` (lien public partageable + QR/code d'accès) — seule l'"identité"
  textuelle est couverte ; `portal` reste donc encore sans remplaçant réel malgré la
  mention "remplace l'ancien portal" du brief. À traiter séparément (relocalisation
  sidebar, comme prévu à l'origine au §1, ou extension de ce header).
- **Zone centrale** (`header-status-group`) : version compacte de `serenity-score` —
  réutilise `computeSerenityScore()`/`serenityStateFor()`/`readThemeVar()`
  (`docs/widgets.js`), pas le rendu canvas orbital (juste chiffre + barre fine, cf.
  "micro-interaction" du brief). `maybeTriggerAIOnSerenity()` volontairement **pas**
  appelé ici (effet de bord déjà déclenché par le widget `serenity-score` lui-même —
  l'appeler deux fois par cycle dupliquerait l'alerte IA). Ne couvre **pas** les données
  de `workspace` (secteur/services actifs/pays-devise) malgré la mention du brief —
  seul l'indicateur de santé est construit cette passe.
- **Zone droite** : bouton "+ Créer" qui appelle `toggleFab()` — **la même** ouverture
  que le FAB desktop actuel (même `#fab-menu`, aucune logique dupliquée), conformément à
  la consigne. **Bug réel trouvé et corrigé en cours de route** : le listener global
  "clic en dehors pour fermer" (`docs/app/dashboard.html`) refermait le menu
  immédiatement après l'avoir ouvert (l'event du clic sur le nouveau bouton bulle jusqu'à
  ce listener, qui le traite comme "clic hors du FAB") — exemption ajoutée pour
  `.v2-header-create-btn`. Limite connue et acceptée : le menu s'ouvre toujours ancré en
  bas-droite (position du `#fab` d'origine), visuellement déconnecté du bouton du header
  qui vient de le déclencher — pas corrigé cette passe (repositionner `.fab-menu`
  dynamiquement est un chantier séparé, hors du périmètre "même modale que l'actuel").
- Validé via Puppeteer : contenu du header correct (identité, score 65/Vigilance, barre
  65% couleur ambre) ; clic "+ Créer" ouvre bien `#fab-menu` après le fix ; test de scroll
  (`position:sticky` confirmée, élément directement sous le header = contenu réel de la
  grille V2, aucun chevauchement) ; `pro-global.css` diff vide ; lint vert.

**Ce qui reste bloqué** : `workspace` (au-delà de l'indicateur de santé, ses autres
données n'ont pas de remplaçant), `portal` (fonctionnalité de lien public non couverte).
Le fondateur peut maintenant autoriser la passe suivante pour `serenity-score`/
`bento-actions`/`quick-actions`/le bouton flottant desktop (remplaçant fonctionnel
complet en place) ; `workspace`/`portal` restent partiellement couverts seulement.

### 4quater. Décommission exécutée — `serenity-score`, `bento-actions`, `quick-actions`, `.fab`

Suite du §4bis : le remplaçant (`#v2-header`) étant en place, ces 4 éléments ont été
retirés pour de bon (pas seulement masqués), avec traçabilité par commentaire à leur
ancien emplacement DOM. `workspace`/`portal` **non touchés**, conformément à l'instruction.

- **`serenity-score`** : entrée retirée de `WIDGET_CATALOG` et de `PINNED_TELEMETRY_IDS`
  (`['metric-0', 'serenity-score']` → `['metric-0']`). `renderSerenityScore()` (le rendu
  canvas orbital, exclusif à ce widget) supprimée. **Fonctions partagées conservées** —
  vérifié avant suppression, pas supposé : `computeSerenityScore()`/`serenityStateFor()`/
  `readThemeVar()` restent utilisées par `renderV2Header()` **et** par le Focus Mode
  (`toggleFocusMode()`, `docs/app/dashboard.html`, classes `.focus-*` totalement
  distinctes de `.serenity-*` — confirmé aucun partage de CSS). `startSerenityAnimation()`
  conservée pour la même raison (Focus Mode). CSS mort retiré : `.serenity-wrap`/
  `.serenity-canvas`/`.serenity-readout`/`.serenity-score-num`/`.serenity-score-lbl`/
  `.serenity-orbit*`, les règles `[data-serenity-state]:hover`, et le token
  `.serenity-score-num` extrait d'une règle partagée (`.metric-value, .bc-amount,
  .goal-current, .serenity-score-num, .focus-score-num`) sans toucher aux 3 autres cibles.
  **`maybeTriggerAIOnSerenity()` (Bible V.1, alerte IA proactive) transférée dans
  `renderV2Header()`** — ce n'était PAS une simple suppression : sans ce transfert, la
  fonctionnalité aurait disparu silencieusement (plus aucun appelant). Le header devient
  le nouveau propriétaire de cet effet de bord, sans risque de double déclenchement
  puisque `renderSerenityScore()` n'existe plus.
- **`bento-actions`/`quick-actions`** : entrées retirées de `WIDGET_CATALOG`. Le bouton
  "+ Créer" du header ouvre le même menu FAB (client/devis/intervention) — **dette
  fonctionnelle non résolue** : "Envoyer un lien de paiement" et "Programmer une
  intervention" (`bento-actions`), "+ Facture" (`quick-actions`) n'ont **aucun**
  équivalent dans ce menu à 3 entrées. Documenté ici plutôt que silencieusement perdu ;
  à trancher avec le fondateur (étendre le menu FAB, ou accepter la perte de raccourci).
  CSS mort retiré : `.qa-grid`/`.qa-btn`, `.bento-flash`/`.flash-*`, et leurs tokens
  extraits de la règle combinée `:active` partagée avec `.metric-card`/`.portal-btn`
  (conservée pour ces deux-là).
- **`.fab`** : élément `<button id="fab">` retiré du DOM, remplacé par un commentaire.
  **`#fab-menu` conservé** (seul déclencheur restant : `.v2-header-create-btn` via
  `toggleFab()`) — le supprimer aussi aurait cassé le bouton "+ Créer" lui-même (Test 1
  l'exige fonctionnel). **Repositionné** de `bottom:92px;right:28px` vers `top:64px;
  right:24px` (+ direction d'animation inversée, `translateY(-10px)` au lieu de
  `translateY(10px)`) : sans ce repositionnement, le menu se serait ouvert dans un coin
  bas-droite vide, sans bouton pour le justifier visuellement — un vrai bug de
  "décommission propre", pas une amélioration cosmétique optionnelle. CSS `.fab`/
  `.fab:hover`/`.fab:active`/`.fab.open-state` retiré ; `.fab` retiré du sélecteur combiné
  `body.focus-active .fab, body.focus-active .fab-menu` (gardé `.fab-menu` seul).
  **`toggleFab()` non modifiée** : ses accès à `document.getElementById('fab')` sont déjà
  gardés (`if (btn) {...}`) depuis l'origine — aucune `TypeError` sur élément supprimé.
- **Point de vigilance résolu** : `.cockpit-telemetry` avait `grid-template-columns:
  1fr 1.3fr 1.4fr` (3 pistes fixes) — avec un seul widget restant (`metric-0`), il
  aurait occupé la première piste (1fr, la plus étroite) en laissant 1.3fr+1.4fr vides à
  droite. Classe `.solo` ajoutée (`grid-template-columns: 1fr`), posée par
  `renderCockpitTelemetry()` via `PINNED_TELEMETRY_IDS.length === 1` — `metric-0`
  occupe maintenant toute la largeur, pas de zone flottante disgracieuse.
- **Régression réelle trouvée sur une autre passe (non liée à ce chantier) : mobile.**
  Aucune règle `@media` ne distinguait jamais `.fab` desktop/mobile (vérifié avant
  suppression) — la vision (§12) prévoyait "bouton flottant uniquement sur mobile", jamais
  implémenté. Supprimer `.fab` retire donc le seul point de création rapide **sur mobile
  aussi**, où `#v2-header` n'a pas d'adaptation responsive dédiée. Signalé explicitement
  plutôt que laissé silencieux — à trancher : rétablir un FAB mobile-only via media query,
  ou adapter `#v2-header` pour petits écrans.
- **Validé** via Puppeteer (`?demo`/`?demo&v2=1`) : grid V1 sans `quick-actions`/
  `bento-actions` (commentaires en tête de grille — position exacte non préservée,
  limite documentée) ; télémétrie réduite à `metric-0` seul, `.solo` posée ; `workspace`/
  `portal` toujours présents dans la grille V1 ; `#fab` absent du DOM ; clic "+ Créer"
  ouvre bien `#fab-menu` (repositionné, visible dans le screenshot juste sous le
  bouton) ; zones V2 toujours peuplées (3+3) ; aucune erreur console ; `pro-global.css`
  diff vide ; `tools/check-design-system.js` vert.

---

## 5. Règles de protection

1. **Aucun code supprimé.** Tout widget/composant retiré de la disposition par défaut
   (`CORE`/`BY_SECTEUR`) est conservé dans `WIDGET_CATALOG` (`docs/widgets.js`),
   marqué par un commentaire `/* ARCHIVÉ V1 — voir DASHBOARD_V2_MASTER_PLAN §4 */`
   juste au-dessus de sa définition. Aucun `git rm`, aucune suppression de fonction :
   seule la promotion par défaut change (retrait de `CORE`/`BY_SECTEUR`, pas du
   catalogue). Un utilisateur ayant déjà personnalisé son dashboard avec l'un de ces
   widgets (`SebaLayoutStore` / `getUserPreference()`) ne doit voir aucune régression —
   `getEffectiveLayout()` respecte déjà la préférence utilisateur avant tout défaut de
   config (voir `docs/widgets.js`), donc ce cas est déjà couvert par le moteur existant
   sans modification.
2. **Compatibilité du moteur actuel avec la V2.** `SEBA_DASHBOARD_CONFIG.widgetsFor()`,
   `isCompatible()`, `explainCompatibility()`, `resolveWidgetSector()` et
   `WIDGET_SECTOR_FALLBACK` (WM-001/002/003/004/006, `config-dashboard.js`) restent la
   seule source de vérité pour "quel widget apparaît par défaut, pour quel secteur".
   La V2 ne crée pas un second moteur de layout : elle change uniquement (a) les valeurs
   de `CORE`/`BY_SECTEUR` (Phase 2) et (b) l'emplacement DOM où chaque widget migré est
   monté (Phase 1/2). `getEffectiveLayout()` et `patchStoredWidgets()` restent inchangés.
3. **Dépendance totale aux clés internes (`SECTOR_MAPPING`).** Toute nouvelle zone ou
   widget V2 qui a besoin du secteur courant passe par
   `window.SebaWidgetAPI.getCurrentSector()` (déjà en place) ou
   `SEBA_DASHBOARD_CONFIG.resolveWidgetSector()` — jamais de comparaison directe sur un
   libellé affiché (`biz.secteur` brut n'est fiable qu'après passage par
   `resolveSector()`/`resolveWidgetSector()`, voir WM-001/WM-002). Aucune zone V2 ne doit
   introduire une nouvelle table de correspondance secteur parallèle à
   `SECTOR_MAPPING`/`WIDGET_SECTOR_FALLBACK`.
4. **Widget Pur non négociable.** Tout nouveau widget créé en Phase 3 (Dépenses,
   Rentabilité temps réel, Qualité, Stock) suit le contrat déjà établi par
   `marge-reelle`/`generic-media-report` : `render()` n'accède jamais à
   `window.SebaDB`/`localStorage`, il appelle exclusivement
   `window.SebaWidgetAPI.<nouvelle-fonction>()` (voir
   `_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md`).
5. **`tools/check-design-system.js` doit rester vert** à chaque commit touchant la V2 —
   aucune couleur hex/rgb en dur hors `:root`, y compris pendant la Phase 1 où la charte
   finale n'est pas encore tranchée (voir §0).
