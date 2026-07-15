---
name: dashboard-v2-master-plan
status: complete
version: 3
project_phase: "[MIGRATION COMPLÈTE] — V2 natif, V1 retiré (voir §7). Seul système de rendu restant."
scope: docs/app/dashboard.html, docs/widgets.js, docs/services/config-dashboard.js, docs/services/widget-data-api.js, docs/css/dashboard-v2.css, docs/services/widget-v2-framework.js
depends_on: _architecture/WIDGET_MASTER_PLAN.md, _architecture/WIDGET_DEVELOPMENT_PROTOCOL.md
---

# Dashboard Seba V2 — Master Plan de migration

## 0. Objectif et statut

Ce document planifie la transition du dashboard "grille de widgets" (V1, livré) vers le
dashboard "cockpit de décision" (V2, vision produit reçue le 2026-07-15). C'est une
réconciliation entre la vision et l'état réel du code (26 widgets, moteur de
compatibilité par secteur, contrat "Widget Pur").

*Mise à jour de statut (v2 du document) : la phrase d'origine "aucun code n'est modifié
par ce document" ne reflète plus l'état du projet — les §§3bis à 4quinquies documentent
des passes d'exécution réelles (squelette, migrations de widgets, décommission, header
V2, responsive mobile), toutes commitées sur `main`. Voir "Clôture Qualité/Stock" en fin
de document pour le statut global actuel (Maintenance/Optimisation).*

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
| `metric-1` | Métrique activité | Zone 2 Bloc A — Interventions (compteur) (`.v2-zone-activite`, montage par classe) | **Migré-exécuté** — voir §6bis |
| `metric-2` | Métrique clients | — (aucune zone V2 dans le MVP 12 widgets ; futur module "Commercial") | Orphelin |
| `metric-3` | Métrique devis | Zone 3 Carte 4 — Devis (`.v2-zone-finance`, montage par classe) | **Migré-exécuté** — voir §6bis |
| `bento-chart` | Suivi des encaissements | Zone 3 — Santé financière (`.v2-zone-finance`) | **Migré*** — exécuté, voir §3bis |
| `bento-actions` | Actions flash | Bouton `+ Créer` (`#v2-header`) — partiel | **Supprimé*** — exécuté, voir §4quater (dette : lien paiement/intervention non couverts) |
| `timeline` | Journée d'aujourd'hui | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — exécuté, voir §3bis (retiré de PINNED_TELEMETRY_IDS) |
| `activity` | Activité récente | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — pilote exécuté, voir §3bis |
| `recos` | Recommandations Seba | Zone "Seba IA" (§21 vision, position 14 dans l'ordre §24) — `.v2-zone-traitement`, montage par classe | **Migré-exécuté** — voir §6bis |
| `quick-actions` | Actions rapides | Bouton `+ Créer` (`#v2-header`) — partiel | **Supprimé*** — exécuté, voir §4quater (dette : "+ Facture" non couvert) |
| `goal` | Objectif du mois | Zone 3 Carte 1 — CA (fusionné : barre d'objectif — fusion visuelle non faite, voir §6bis) (`.v2-zone-finance`, montage par classe) | **Migré-exécuté** — voir §6bis |
| `workspace` | Votre espace | — (explicitement listé §26 de la vision) | Supprimé |
| `portal` | Portail client | — (retiré du dashboard, relocalisé en item de sidebar "Configuration", §2 vision) | Supprimé |
| `team` | Équipe aujourd'hui | Zone 2 — Aujourd'hui (`.v2-zone-activite`) | **Migré*** — exécuté, voir §3bis |
| `chart-donut` | Répartition des interventions | — (graphique décoratif sans action, contraire à §13/§26 vision) | Orphelin |
| `lot-impayes` | Factures en retard | "À traiter maintenant" (facture échue) + Zone 3 Encaissements (`.v2-zone-finance`, montage par classe) | **Migré-exécuté*** — voir §6bis (source `lot:contentieux` inchangée, dette de données) |
| `lot-pipeline` | Pipeline devis → facture → encaissé | Zone 3 (Devis/Encaissements) ou Analyse détaillée (`.v2-zone-finance`, montage par classe) | **Migré-exécuté*** — voir §6bis (source `lot:mutation` inchangée, dette de données ; bug `.qa-grid` corrigé au passage) |
| `lot-tournee` | Tournée du jour | Zone 2 Bloc C — Carte et déplacements (`.v2-zone-activite`, montage par classe) | **Migré-exécuté*** — voir §6bis (source `lot:haversine` inchangée, dette de données) |
| `lot-carte` | Carte des interventions | Zone 2 Bloc C — Carte et déplacements (`.v2-zone-activite`, montage par classe) | **Migré-exécuté** — voir §6, stress test du framework `WidgetV2` |
| `lot-treso` | Position de trésorerie | Zone 3 — Santé financière (`.v2-zone-finance`) | **Migré*** — exécuté, voir §3bis (source `lot:treso` inchangée, dette de données) |
| `generic-media-report` | Rapport photo | `.v2-zone-activite` (réassigné ici, montage par classe — Zone 5 "Qualité" d'origine retirée du backlog, voir "Clôture Qualité/Stock" ; widget lui-même non concerné, données réelles via `SebaWidgetAPI.getMediaReport`) | **Migré-exécuté** — voir §6bis |
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
| Zone 6 (Stock/matériel, vision §10) | `stock[]`, `equipements[]` | Manquant — aucune collection. **[DÉFINITIF] Re-vérifié, toujours aucune — voir "Clôture Qualité/Stock" en fin de document.** |
| Zone 5 (Qualité, contrôles/réclamations, vision §9) | `controlesQualite[]`, `reclamations[]` | Manquant — aucune collection. **[DÉFINITIF] Re-vérifié, toujours aucune — voir "Clôture Qualité/Stock" en fin de document.** |

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
  5. ~~Nouveaux widgets métier "purs" pour Zone 5 (Qualité) et Zone 6 (Stock)~~ —
     **[DÉFINITIF] retiré du backlog V2, voir "Clôture Qualité/Stock" en fin de
     document.** Ne plus lister comme travail actif ; à rouvrir uniquement si une
     source de données réelle apparaît un jour (nouveau chantier, pas une reprise
     de celui-ci).
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
| `quality-check` (Priorité 3) | `generic-media-report` (« Rapport photo ») | Aucune collection SebaDB de contrôles qualité (`controlesQualite`, `reclamations`) | **[DÉFINITIF] Fermé** — re-diagnostiqué, toujours aucune source. Retiré du backlog V2 (voir "Clôture Qualité/Stock"). `generic-media-report` (widget réel et distinct, données via `SebaWidgetAPI.getMediaReport`) n'est PAS concerné par cette fermeture — reste "Migré" au §1, zone cible à réassigner puisque "Zone 5 Qualité" n'existe plus comme cible active. |
| `stock-alerts` (Priorité 3) | Aucun | Aucune collection SebaDB (`stock`, `equipements`) ni widget existant | **[DÉFINITIF] Fermé** — re-diagnostiqué, toujours aucune source, aucun widget. Retiré du backlog V2 (voir "Clôture Qualité/Stock"). |

**[DÉFINITIF] Suppression des widgets « Qualité » et « Stock » du backlog V2 par absence
de source de données.** Diagnostic final (re-exécuté avant cette clôture, pas supposé) :
recherche `stock|equipement|qualit|controle|reclamation|inventaire` sur `docs/seba-data.js`,
`docs/widgets.js` et `supabase-schema.sql` — zéro résultat pertinent (uniquement des faux
positifs, "stockage"/"stocké" au sens générique de stockage de photos/JWT, sans rapport
avec un inventaire de stock ou des contrôles qualité). Aucune table, vue, colonne, ni
champ ne porte cette donnée nulle part dans le projet. Un widget "Qualité" ou "Stock" migré
maintenant serait un widget fantôme — affichant un état vide permanent sans date de
déblocage crédible, contrairement à `marge-reelle` (champ identifié, juste absent) ou aux
widgets `lot-*` (données démo réelles, juste pas encore rebranchées). Ce backlog est donc
clos, pas reporté : voir la section "Clôture Qualité/Stock" en fin de document pour le
critère de réouverture.

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

### 4quinquies. Sécurisation mobile de `#v2-header` — dette "mobile" du §4quater refermée

Suite directe du point de vigilance mobile ci-dessus (§4quater) : `#v2-header` est
maintenant le seul point de création rapide sur **tous** les viewports (le FAB
desktop-only jamais implémenté a été décommissionné, pas juste masqué sur desktop) — sans
correctif, les utilisateurs mobiles auraient perdu tout accès à la création rapide.

- **`@media (max-width: 768px)`** (`docs/css/dashboard-v2.css`) : badge secteur masqué
  (`.v2-header-identity-sector { display: none; }` — seul "label textuel long" au sens de
  la consigne, le nom d'entreprise reste affiché, déjà tronqué par ellipsis existant) ;
  `header-status-group` perd son `min-width: 140px` fixe ; padding du header réduit
  (`12px 24px` → `8px 12px`) ; bouton `+ Créer` avec `min-height`/`min-width: 44px`
  explicites (cible tactile). Mesuré à 375×812 (iPhone-ish) : bouton rendu 46×63px,
  aucun débordement horizontal (`body.scrollWidth === innerWidth`).
- **Bug réel trouvé en vérifiant la cohérence `#fab-menu`** (demandé explicitement par la
  consigne, pas supposé correct) : le `top: 64px` fixe de `.fab-menu` (posé lors du
  §4quater pour la hauteur du header desktop, 56px) chevauchait le bouton de 13px sur
  mobile, où le header mesure 63px (bouton 44px + padding réduit). **Corrigé
  différemment d'un simple second breakpoint** : `toggleFab()` calcule maintenant
  `#fab-menu`'s `top` depuis la hauteur RÉELLE de `#v2-header`
  (`header.getBoundingClientRect().bottom + 8`) à chaque ouverture, au lieu d'un `top`
  figé en CSS — s'adapte à n'importe quelle hauteur de header, présente ou future, sans
  nouveau magic number à maintenir en synchronisation manuelle.
- **Validé** via Puppeteer (375×812 et 1440×900 dans le même run) : mobile — badge
  secteur masqué, bouton 46×63px visible, menu FAB rouvert avec un écart de 18px sous le
  bouton (zéro chevauchement, zéro débordement horizontal) ; desktop — badge secteur
  toujours visible, hauteur de header inchangée (56px, aucune régression) ; aucune
  erreur console ; `pro-global.css` diff vide ; `tools/check-design-system.js` vert
  (2 fichiers scannés).
- **Non couvert par cette passe** (voir Phase 7 ci-dessous pour la suite) : le libellé
  d'état de santé ("Vigilance"/"Stable"/"Alerte") reste affiché sur mobile et se
  retrouve visuellement proche du bouton — pas cassé, mais dense ; les 3 actions
  perdues du menu FAB (paiement, intervention dédiée, facture) restent des dettes
  fonctionnelles indépendantes du responsive.

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

---

## Phase 7 : Évolution UX (dettes ouvertes, non résolues)

Feuille de route des dettes UX identifiées pendant la décommission (§4quater) et sa
sécurisation mobile (cette passe) — non résolues ici, à trancher avec le fondateur avant
d'être closes. Chaque sous-section est une dette indépendante, priorisable séparément.

### Actionnaires (menu de création rapide)

Le menu FAB repris par le bouton `+ Créer` du header (`#fab-menu`, 3 entrées : Nouveau
client / Nouveau devis / Nouvelle intervention) est strictement plus pauvre que les deux
widgets qu'il remplace :

| Action perdue | Widget d'origine | Statut |
|---|---|---|
| Envoyer un lien de paiement | `bento-actions` | Aucun équivalent dans `#fab-menu` |
| Programmer une intervention (raccourci dédié, distinct de "Nouvelle intervention") | `bento-actions` | Aucun équivalent dans `#fab-menu` |
| + Facture | `quick-actions` | Aucun équivalent dans `#fab-menu` |

Ces 3 actions ne sont pas perdues pour l'utilisateur (les pages `factures.html`/
`planning.html` restent accessibles via la sidebar/navigation), seul le **raccourci de
création rapide** en un clic depuis le dashboard a disparu. Options pour clore cette
dette, à trancher avec le fondateur : (a) étendre `#fab-menu` à 4-5 entrées, (b) accepter
la perte de raccourci comme un arbitrage délibéré de simplification V2, (c) déplacer ces
actions dans une zone V2 dédiée (ex. Zone "À traiter maintenant" du blueprint original).

### Responsive (au-delà de cette passe)

Cette passe sécurise uniquement l'**existant** de `#v2-header` sur mobile (masquage du
badge secteur, bouton `+ Créer` ≥44px, `#fab-menu` repositionné dynamiquement). Elle ne
couvre **pas** la croissance future du header : si le header V2 accueille davantage
d'éléments plus tard (ex. `header-status-group` s'enrichit d'autres indicateurs, `+
Créer` gagne un sous-menu plus large, une recherche globale s'ajoute côté vision d'origine
§3 — voir la vision produit reçue avant le Phase 1) — la zone gauche/centrale/droite en
`display:flex` simple **saturera** sur les petits écrans bien avant le desktop.

**Note pour l'implémentation future :** prévoir un menu burger (☰) ou un affichage
alternatif (drawer, bottom sheet) dès que `#v2-header` dépasse son contenu actuel sur
mobile — ne pas empiler indéfiniment de nouveaux `display:none` par média-requête comme
fait cette passe (solution correcte pour 1 élément masqué, pas une stratégie à long
terme). Déclencheur suggéré pour rouvrir ce chantier : le jour où un nouvel élément doit
être ajouté à `.v2-header-left`/`.header-status-group`/`.v2-header-right` et qu'il n'y a
plus de place sur un viewport ≤768px sans revoir la structure.

---

## Clôture Qualité/Stock — arbitrage définitif

**[DÉFINITIF] Suppression des widgets « Qualité » et « Stock » du backlog V2 par absence
de source de données.**

### Diagnostic final (re-vérifié, pas supposé)

Recherche ciblée sur l'ensemble du projet avant cette clôture, pas une reprise du
diagnostic du §2 :

- `docs/seba-data.js` : recherche `stock|equipement|qualit|controle|reclamation|inventaire`
  (insensible à la casse) — zéro résultat pertinent.
- `docs/widgets.js` : même recherche — zéro résultat pertinent (uniquement "stockage" au
  sens générique de mécanisme de persistance, `SebaLayoutStore`).
- `supabase-schema.sql` : même recherche — zéro résultat pertinent (uniquement "bucket de
  stockage des photos d'intervention", sans rapport avec un inventaire de stock).

**Conclusion : aucune table, vue, colonne, champ ou widget existant, à quelque niveau que
ce soit du projet, ne porte de donnée de contrôle qualité ou de stock/matériel.**
Contrairement à `marge-reelle` (champ `coutReel` identifié, juste absent de SebaDB) ou aux
widgets `lot-*` (données démo réelles, source `lot:*` juste pas encore rebranchée), il n'y
a ici ni champ nommé, ni vue Supabase, ni structure de données quelconque à rebrancher un
jour prochain — juste une absence totale, à n'importe quelle profondeur du projet.

### Décision

Backlog fermé, pas reporté. Zone 5 ("Qualité") et Zone 6 ("Stock") du blueprint original
(§24 de la vision produit) ne sont **plus** des cibles actives de la migration V2 :

- Aucune zone DOM (`.v2-zone-qualite`/`.v2-zone-stock`) ne sera créée tant que ce critère
  de réouverture n'est pas atteint.
- Aucun widget "purs" Qualité/Stock ne sera développé (contrat Widget Pur inapplicable
  sans source `SebaWidgetAPI` à appeler).
- `generic-media-report` (widget réel et distinct, non concerné par cette clôture — voir
  §1) reste au backlog, zone cible à réassigner séparément.

**Critère de réouverture** (pas "quand on aura le temps", un fait vérifiable) : ce chantier
ne rouvre que le jour où une collection SebaDB réelle (`controlesQualite`, `reclamations`,
`stock`, ou `equipements`) apparaît dans `docs/seba-data.js` — c'est-à-dire qu'une
fonctionnalité produit distincte (saisie de contrôle qualité, gestion de stock) aura été
construite en amont. Ce sera alors un **nouveau chantier**, pas une reprise de celui-ci.

### Statut du projet — de "Migration active" à "Maintenance/Optimisation"

Avec cette clôture, **la phase de planification/arbitrage de la migration V2 est
terminée** : les 23 widgets restants du catalogue (26 moins `serenity-score`/
`bento-actions`/`quick-actions`, décommissionnés) ont chacun un verdict définitif
(Migré-exécuté, Migré-planifié, Orphelin, ou Supprimé-exécuté) — plus aucun widget n'est
dans un état "à trancher" ou "en attente de décision". C'est ce changement précis (fin
des zones de flou, pas fin du travail de code) qui justifie de qualifier le projet de
"Maintenance/Optimisation" plutôt que "Migration active" à partir de maintenant.

**Mise à jour (§6/§6bis) — exécution désormais terminée pour les 9 widgets identifiés :**
les 9 widgets qui restaient marqués "Migré" sans exécution physique (`lot-carte`, `metric-1`,
`metric-3`, `recos`, `goal`, `lot-impayes`, `lot-pipeline`, `lot-tournee`,
`generic-media-report`) sont désormais tous "Migré-exécuté", en tant qu'instances `WidgetV2`
(voir §6/§6bis). Ce que "exécution terminée" ne veut PAS dire ici : le dashboard n'est pas
"tout V2" pour autant — 8 widgets restent en V1 sans changement, par choix déjà documenté
(Orphelins/hors périmètre de toute bascule planifiée) : `metric-0` (télémétrie v2-header),
`metric-2`, `workspace`, `portal`, `chart-donut`, `ext-chart`, `ext-notes`, `ext-rss`. Le
"Shadow Backlog" (`session-manager.js`, routage par hash, audit `pro-global.css`) et le
Batch 3 (retrait total du V1, renommage de fichier) restent non commencés — voir §6bis.

## 6. Framework `WidgetV2` — standard pour le backlog des 9 widgets restants

Les 6 widgets déjà migrés (`activity`, `timeline`, `team`, `bento-chart`, `marge-reelle`,
`lot-treso`) partagent tous le même patron : `def.render(ctx, el)` synchrone, une chaîne
HTML construite et injectée, rien d'autre à gérer après coup. Ce patron ne suffit pas pour
un widget qui a un **vrai cycle de vie** — une lib externe à charger une seule fois, un
état vivant à nettoyer (instance de carte, listener), un besoin de réagir à un
redimensionnement de son propre conteneur (pas de la fenêtre). `lot-carte` est le premier
widget du backlog restant à avoir ce profil — d'où son choix comme "stress test" du
nouveau framework plutôt qu'un widget plus simple.

**Fichiers** :
- `docs/services/widget-v2-framework.js` (nouveau, chargé après `widget-data-api.js` et
  avant `widgets.js`) — classe de base `WidgetV2` (`constructor(container)`, `async load()`,
  `render()`, `onMount()`, `onResize()`, `onDestroy()`, `renderError(err)`, orchestrateur
  `async mount()` non réécrit par les sous-classes) + singleton `AssetLoader` (cache de
  promesses par nom d'asset, une entrée retirée du cache si elle rejette pour permettre une
  vraie nouvelle tentative).
- `docs/widgets.js` — `loadLeaflet()` refactorisé pour déléguer à `AssetLoader.load('leaflet', …)`
  au lieu de sa propre variable de promesse locale (`_leafletPromise`, supprimée : un seul
  mécanisme de chargement pour toute la page, pas deux en parallèle). `class LotCarteWidgetV2
  extends WidgetV2` juste après, reprenant à l'identique la logique V1 (hash de position
  stable par nom client, style des marqueurs, tuiles OSM, `fitBounds`) — seul le cycle de vie
  change : `this.map` (jamais `window.map`), un `ResizeObserver` remplace le
  `setTimeout(...,250)` de l'ancienne version pour `invalidateSize()`, `onDestroy()` remplace
  la garde module-scope `_lotCarteMapInstance` (audit 2.2, fuite mémoire) supprimée. L'entrée
  `WIDGET_CATALOG['lot-carte']` perd son `render()` (retrait pur — la logique vit désormais
  uniquement dans la classe) mais garde ses métadonnées (title/keywords/defaultVisible/
  defaultOrder/link), toujours utilisées par `getEffectiveLayout()` et le panneau bibliothèque.
- `V2_CLASS_WIDGETS`/`V2_CLASS_WIDGET_IDS` (nouveau, à côté de `V2_ZONE_ACTIVITE_IDS`) —
  registre widget-par-classe, plié dans `MIGRATED_TO_V2_IDS` pour l'exclusion V1 comme les
  widgets fonctionnels. `mountV2ClassWidgets()` respecte **la même règle de visibilité que
  `renderGrid()`** (`getEffectiveLayout().filter(w => w.visible)`) — `lot-carte` étant
  `defaultVisible:false` (compagnon promu par secteur maintenance/jardinage/déménagement),
  un mount inconditionnel l'aurait fait apparaître pour tous les secteurs en V2 alors qu'il
  ne s'affiche qu'à certains en V1 : régression évitée, vérifiée en Puppeteer (secteur
  `coiffure` → widget absent, secteur `maintenance` → présent). `destroyV2ClassWidgets()`
  appelle `onDestroy()` sur toutes les instances vivantes avant tout re-mount (bascule mode
  personnalisation, changement de secteur) — généralise et remplace `_lotCarteMapInstance`.

**Vérification (Puppeteer, `?demo&v2=1`, secteur `maintenance`)** : `window.WidgetV2`/
`window.AssetLoader` exposés (surface globale minimale — `LotCarteWidgetV2` elle-même reste
non exposée, seule la fonction de montage l'est) ; conteneur + `.widget-map` + vraie instance
Leaflet créée (`.leaflet-map-pane` présent) ; `window.map` absent (`this.map`, zéro pollution
globale) ; V1 n'affiche plus le widget (0 shell rendu, commentaire de traçabilité présent) ;
un re-rendu forcé (`renderV2ZoneActivite(ctx)` rappelé) ne laisse ni doublon ni conteneur
orphelin (1 conteneur avant, 1 après) ; redimensionnement du conteneur sans erreur console.
Secteur `coiffure` (non-promu) : widget absent du DOM, confirmant que la visibilité suit
`getEffectiveLayout()` et non un mount systématique.

**Reste hors périmètre de cette passe** (backlog du "Batch Finale" proposé, pas commencé) :
migration des 8 autres widgets en sous-classes `WidgetV2` (la plupart n'ont pas besoin de
cycle de vie réel — `render()` synchrone suffira, `load()`/`onMount()`/`onResize()` resteront
vides), audit du "Shadow Backlog" (`session-manager.js`, routage par hash `#widget-id`, audit
complet de `pro-global.css`), et le retrait total du V1 (Batch 3).

## 6bis. Batch de bascule — les 8 widgets restants (Groupes A/B/C)

Les 8 widgets qui restaient marqués "Migré" sans exécution physique sont désormais des
sous-classes `WidgetV2`, suivant strictement le patron `LotCarteWidgetV2` (répétition
volontaire, pas de variation créative par widget — consigne d'exécution) : `Metric1Widget`,
`Metric3Widget`, `GoalWidget`, `LotImpayesWidget`, `LotPipelineWidget`, `LotTourneeWidget`,
`RecosWidget`, `GenericMediaReportWidget` (toutes dans `docs/widgets.js`, juste après
`LotCarteWidgetV2`). `load()` prépare `this._data` depuis `ctx` ; `render()` ne fait que du
templating à partir de `this._data` (séparation stricte donnée/template demandée) ;
`onMount()`/`onResize()`/`onDestroy()` existent sur les 8 (API uniforme), même vides —
aucun n'a besoin d'un cycle de vie réel (voir "Points non applicables" ci-dessous).

**Répartition par zone** (suit la colonne "Zone V2 Cible" du §1) :
- `.v2-zone-activite` : + `metric-1`, `lot-tournee`, `generic-media-report` (rejoint
  `activity`/`timeline`/`team`/`lot-carte`).
- `.v2-zone-finance` : + `metric-3`, `goal`, `lot-impayes`, `lot-pipeline` (rejoint
  `bento-chart`/`marge-reelle`/`lot-treso`).
- `.v2-zone-traitement` : `recos` — premier occupant de cette zone, placeholder vide depuis
  la Phase 1 (bon fit conceptuel : recommandations proactives ~ "bandeau de traitement").

**Orchestration** (`docs/widgets.js`) : `V2_ZONE_ACTIVITE_CLASS_IDS`/`V2_ZONE_FINANCE_CLASS_IDS`/
`V2_ZONE_TRAITEMENT_CLASS_IDS` (nouvelles listes par zone, agrégées dans `V2_CLASS_WIDGET_IDS`
puis dans `MIGRATED_TO_V2_IDS` pour l'exclusion V1, comme d'habitude). `V2_CLASS_WIDGETS`
étendu aux 8 nouvelles entrées (avec `titleFor` pour `generic-media-report`, seul widget à
copie dynamique par secteur). Le nettoyage de zone (`zone.innerHTML = ''`) a été **centralisé**
dans une nouvelle fonction `clearV2Zone()`, appelée une fois par `renderV2ZoneActivite()`/
`renderV2ZoneFinance()`/`renderV2ZoneTraitement()` avant les deux mounts (fonctionnel +
classe) qui partagent désormais certaines zones — l'ancien `zone.innerHTML = ''` interne à
`mountV2Widgets()` aurait effacé les widgets-classe déjà montés selon l'ordre d'appel.
`destroyV2ClassWidgets()` (détruit toutes les instances vivantes, ResizeObserver compris) est
maintenant appelé **une seule fois** depuis `docs/app/dashboard.html`, avant les 3 zones
(et non plus depuis l'intérieur de `renderV2ZoneActivite`, insuffisant dès que des widgets-classe
existent dans plusieurs zones).

**Bug pré-existant corrigé en chemin** : `lot-pipeline` utilisait `class="qa-grid"` pour sa
grille à 4 étapes — cette classe CSS a été supprimée du `<style>` de `dashboard.html` lors de
la décommission `bento-actions`/`quick-actions` (§4quater) sans qu'on remarque alors que
`lot-pipeline` la réutilisait aussi. Le widget rendait donc sans `display:grid` depuis cette
date (seul `grid-template-columns` inline survivait, sans effet sans `display:grid`). Corrigé
par une classe dédiée `.v2-pipeline-stages` (nouvelle, `dashboard-v2.css`), vérifiée en
Puppeteer (`getComputedStyle` → `display:grid`, 4 colonnes égales).

**CSS — décision et écart assumé par rapport à la consigne littérale** : la consigne demandait
de migrer "les styles V1 de ces widgets" vers `dashboard-v2.css` et de les supprimer de
`dashboard.html`. Vérifié par grep AVANT toute suppression : `.reco-*` (exclusif à `recos`),
`.goal-*` (exclusif à `goal`) et `.bc-pad`/`.bc-empty-*` (utilisés uniquement par
`bento-chart`/`marge-reelle`, déjà V2, et `generic-media-report`, migré ici) n'ont **aucun**
consommateur restant en V1 — déplacés tels quels (mêmes noms de classe, gérés par `render()`/
templates, pas renommés en `.v2-*` : renommer exigerait de toucher chaque template pour un
gain nul). En revanche `.metric-card`/`.metric-value`/`.metric-label`/`.metric-unit`/
`.metric-delta`/`.metric-spark` (partagés avec `metric-0`, toujours en télémétrie v2-header, et
`metric-2`, toujours orphelin V1) et `.ws-row`/`.ws-label`/`.ws-val` (partagés avec `workspace`,
toujours orphelin V1) **restent volontairement** dans le `<style>` de `dashboard.html` : les
déplacer aurait cassé ces 3 widgets dès ce commit — un déplacement littéral aurait donc
introduit une régression hors du périmètre demandé. `.goal-current` a été retiré de la règle
police partagée (`.metric-value, .bc-amount, .goal-current, .focus-score-num`) et redéfini
seul dans `dashboard-v2.css` (`goal` migre entièrement, plus besoin de rester dans la règle
partagée). Deux couleurs littérales déplacées (`rgba(201,169,218,.4)` du glow `.reco-bar.pl`,
`rgba(0,255,157,.08)`/`.2` de `.bc-empty-ico`) ont été reformulées en tokens
`--v2-content-plum-glow`/`--v2-content-accent-tint`/`--v2-content-accent-border` (`:root` de
`dashboard-v2.css`) pour rester conformes à `tools/check-design-system.js` (aucune couleur en
dur hors `:root`) — mêmes valeurs, rendu identique au pixel près.

**Points de la consigne vérifiés non applicables (pas ignorés, vérifiés)** :
- **`onInterval()`/auto-refresh périodique** : zéro `setInterval` trouvé dans le V1 de ces 8
  widgets avant migration (grep sur tout `widgets.js`) — aucun n'a donc de rafraîchissement
  périodique à préserver. Pas de mécanisme d'auto-refresh ajouté à la classe de base pour ne
  pas construire une API inutilisée par tous les widgets actuels (à ajouter le jour où un
  widget réel en aura besoin).
- **Routage par hash (`#recos` etc.)** : zéro `location.hash`/`hashchange` trouvé dans
  `dashboard.html` — aucun widget de ce dashboard n'utilise de routage par hash aujourd'hui,
  rien à préserver ni migrer sur ce point.

**Vérification (Puppeteer, `?demo&v2=1`)** : secteur `maintenance` → `metric-1`/`metric-3`/
`goal`/`lot-tournee`/`recos`/`lot-carte` présents et corrects par zone (activite:6, finance:5,
traitement:1) ; secteur `coiffure` (aucune promotion compagnon) → seuls les widgets `core`
présents (`metric-1`/`metric-3`/`goal`/`recos`), `lot-carte`/`lot-tournee` absents comme en V1 ;
`lot-impayes`/`lot-pipeline`/`generic-media-report` (defaultVisible:false, non promus par
AUCUN secteur — vrai déjà en V1, pas une régression) vérifiés séparément via un layout forcé
(simulation d'un ajout manuel réel via `seba_dashboard_layout`) : les 3 montent et rendent
correctement (états vides `buildRichEmptyHTML`, cohérent avec l'absence de données `lot:*` en
démo). `goal-bar-fill` anime bien vers son pourcentage cible (double `requestAnimationFrame`,
plus de `setTimeout(400)`). Zéro widget rendu dans `#widget-grid` (V1) pour les 8 ids. Zéro
erreur console dans les deux secteurs testés. `node tools/check-design-system.js` (mode diff) :
0 violation. `node scripts/qa-dashboard-full.js --target=local` (desktop + mobile) : aucune
régression (seul finding pré-existant : `serenity-score` absent, déjà accepté depuis §4quater).

**Statut catalogue** : les 9 widgets du backlog "Migré-planifié" sont désormais tous
"Migré-exécuté" (`lot-carte` en §6, ces 8 ici). Restent en V1 sans changement, par choix
déjà documenté (Orphelins/non concernés par cette bascule) : `metric-0` (télémétrie
v2-header), `metric-2`, `workspace`, `portal`, `chart-donut`, `ext-chart`, `ext-notes`,
`ext-rss` — 8 entrées de catalogue, donc `docs/widgets.js` n'est **pas** devenu une coquille
vide (attendu : ces 8 sont hors périmètre de toute bascule V2 planifiée à ce jour, voir §1).
Le "Shadow Backlog" (`session-manager.js`, routage hash, audit `pro-global.css`) et le Batch 3
(retrait total du V1) restent non commencés.

## 7. [MIGRATION COMPLÈTE] — Bascule V2 Native, retrait total du V1

Les 8 derniers "Orphelins" sont migrés et le rendu V1 est intégralement retiré. Le dashboard
n'a plus qu'un seul système de rendu : `renderAllV2(ctx, customizeMode)` (`docs/widgets.js`),
seul point d'entrée appelé depuis `docs/app/dashboard.html`.

**Derniers "Orphelins" migrés** :
- `metric-0`/`metric-2`/`chart-donut` → `Metric0Widget`/`Metric2Widget`/`ChartDonutWidget`
  (patron `WidgetV2` identique aux batches précédents), montés dans `.v2-zone-finance`/
  `.v2-zone-activite`. `metric-0` sort de `#cockpit-telemetry`/`PINNED_TELEMETRY_IDS`
  (décommissionnés avec lui — plus rien à épingler une fois seul). `chart-donut` avait un
  statut particulier : contrairement aux autres orphelins, il reste **réellement promu par
  défaut** pour 3 secteurs (maintenance/jardinage/déménagement, voir `config-dashboard.js`) —
  sans cette migration il aurait disparu silencieusement pour ces secteurs à la suppression du
  rendu V1 (régression évitée, pas un simple nettoyage de code mort).
- `workspace`/`portal` → `WorkspaceWidget`/`PortalWidget`, intégrés au chrome fixe du
  `#v2-header` plutôt qu'à une zone : `workspace` dans un panneau déroulant zone gauche
  (`toggleWorkspacePanel()`, bouton `▾` à côté de l'identité), `portal` dans un menu "Actions"
  zone droite (`togglePortalMenu()`, à côté de "+ Créer"). **Écart constaté et assumé** : la
  consigne d'exécution décrivait `workspace` comme "le sélecteur de secteur/service/devise" —
  le widget V1 réel n'a jamais été un contrôle interactif, seulement un résumé lecture-seule
  (secteur/services actifs/portail/pays-devise) avec liens vers Réglages pour modification.
  Comportement préservé à l'identique, aucune interactivité inventée. Bonus au passage :
  liens `reglages.html`/`client.html` corrigés en `../reglages.html`/`../client.html` (même
  bug de chemin relatif déjà rencontré et corrigé pour `activity`/`team` plus tôt dans ce
  document — `docs/app/` casse les chemins non préfixés).
- `HEADER_MOUNTED_IDS = ['workspace', 'portal']` : exclus du panneau bibliothèque/barre IA
  (rien à cocher/décocher pour un widget de chrome fixe, contrairement à une carte de zone).

**Bibliothèque d'Extensions (Bible IV.9) décommissionnée** : jamais assignée à une zone V2,
déjà qualifiée "contraire à la vision" — `ext-chart`/`ext-notes`/`ext-rss` retirés du
catalogue, tiroir (DOM + JS + CSS) supprimé intégralement. Dette notée : les notes
éventuellement saisies dans `ext-notes` restent dans `localStorage` (clé `widget_notes`)
mais deviennent inaccessibles via l'UI — donnée non supprimée, juste plus aucun widget pour
la lire/éditer.

**`GridManagerV2`** (`docs/widgets.js`) : moteur de glisser-déposer extrait du V1
(`initSortable()`/`#widget-grid`) et reciblé sur les 3 zones V2 — une instance SortableJS par
zone peuplée (`initGridManagerV2()`), drag borné à l'intérieur d'une zone (le tri inter-zone
n'a plus de sens : chaque widget a une zone cible fixe, déterminée par son contenu). Réutilise
`persistOrder()`/`getEffectiveLayout()`/`patchStoredWidgets()` tels quels (couche données
inchangée). **Bug trouvé et corrigé pendant la vérification** : un premier jet montait les
widgets fonctionnels (`def.render`) et les widgets-classe (`WidgetV2`) en deux passes
séparées par zone — chaque groupe respectait bien l'ordre persisté *en interne*, mais les deux
groupes restaient toujours concaténés dans un ordre fixe l'un après l'autre, empêchant un
widget-classe glissé au-dessus d'un widget fonctionnel de jamais se refléter dans le DOM.
Corrigé en fusionnant les deux listes d'ids AVANT de trier (`mountV2Zone()`), puis en montant
chaque id, dans cet ordre fusionné, via le bon chemin (fonctionnel ou classe) — vérifié en
Puppeteer par un test explicite d'inversion d'ordre sur `.v2-zone-finance` (6 widgets mixtes
fonctionnel+classe), confirmant que l'ordre inversé demandé correspond exactement à l'ordre
rendu après un re-rendu complet.

**Panneau bibliothèque + barre IA adaptés** : `buildLibraryPanelHTML()`/`matchIntent()`/
`suggestClosest()` utilisaient `MIGRATED_TO_V2_IDS.includes(w.id)) return;` comme garde
d'exclusion temporaire (pendant la période hybride, pour ne pas lister un widget déjà migré et
confirmer un ajout sans effet). Une fois TOUS les widgets restants migrés, cette garde aurait
exclu l'intégralité du catalogue — panneau et barre IA vidés en silence. Remplacée par
`HEADER_MOUNTED_IDS` (seuls `workspace`/`portal` restent exclus, tout le reste redevient
listable/ajoutable normalement).

**Retrait V1 (DOM + CSS + JS)** : `#widget-grid`, `#cockpit-telemetry`, le tiroir
d'extensions, `.widget-shell`/`.module-head`/`.module-title`/`.module-link`/`.widget-body`/
`.widget-drag-handle`/`.widget-remove-btn` (CSS, plus aucun créateur JS) retirés. Le flag
`?v2=1`/`window.__SEBA_V2_ENABLED__` est retiré : `renderAllV2()` s'exécute désormais
inconditionnellement — plus de condition `if (v2)` nulle part dans le code. **La vraie
sidebar de navigation (`<nav class="sidebar">`, `sidebar.js`, `.mobile-header`) n'a PAS été
touchée** : elle n'a jamais fait partie du périmètre V1/V2 widgets (c'est la navigation réelle
et actuelle vers les autres pages de l'app, pas un vestige à retirer) — vérifié qu'elle est
exclusive à `dashboard.html` (`sidebar.js` n'est chargé par aucune autre page), donc aucun
risque de casser la navigation des autres pages en la laissant intacte ici.
**Bugs latents trouvés et corrigés en chemin** (existaient déjà dans le code, révélés par la
suppression de `#widget-grid`) : un listener `document.getElementById('widget-grid')
.addEventListener('mousemove', ...)` (glow radial des `.metric-card`) aurait levé une
`TypeError` au chargement de la page une fois `#widget-grid` retiré — reciblé sur
`.v2-grid-container` ; la règle CSS Focus Mode (`body.focus-active .widget-grid > .widget-shell`)
ne correspondait déjà plus à rien d'utile depuis le décommissionnement de `serenity-score`
(§4quater) — reciblée sur `.v2-header-bar`/`.v2-grid-container` pour continuer à masquer tout
le dashboard normal pendant le Mode Focus.

**"URL racine" — écart avec la consigne littérale, vérifié et documenté** : `docs/index.html`
est le site marketing public (page d'accueil commerciale), sans aucun rapport avec le
dashboard applicatif. La consigne "redirige tout comportement legacy vers la V2" ne s'applique
donc à aucun fichier réel — non exécutée. L'intention pratique (V2 comme seul comportement,
plus de legacy) est couverte par le retrait du flag `?v2=1` : `dashboard.html` est désormais
nativement et inconditionnellement le rendu V2.

**Vérification (Puppeteer, secteur `maintenance` puis `menage`, aucun flag requis)** : les 3
zones se peuplent correctement (widgets fonctionnels + classe mélangés, triés par ordre
persisté) ; `#widget-grid`/`#cockpit-telemetry`/`#ext-drawer` absents du DOM ; panneau
workspace et menu portail s'ouvrent/se ferment avec le bon contenu (copier-lien/aperçu) ;
mode personnalisation pose poignées de tri + boutons de retrait sur tous les widgets de zone ;
panneau bibliothèque liste 18 widgets cochables ; retrait/ré-ajout d'un widget fonctionne ;
barre IA trouve et ajoute un widget par mot-clé ; `GridManagerV2` attache 3 instances
SortableJS (une par zone peuplée) ; Mode Focus masque bien le header + la grille V2 après la
transition CSS ; zéro erreur console dans tous les tests. `node tools/check-design-system.js
--base=main` : 0 violation (2 couleurs en dur introduites par ce chantier — `#FFB800`,
`rgba(0,0,0,.4)` — reformulées en tokens `--v2-widget-remove-hover`/`--v2-dropdown-shadow`).

**Point non résolu, signalé plutôt que corrigé en silence** : `node
scripts/qa-dashboard-full.js` (desktop + mobile) rapporte 4 "findings" — `.widget-shell`
absent, `.widget-drag-handle` absent, `#ext-drawer-trigger` absent, `serenity-score` absent.
Les 4 sont **attendus** (chacun correspond à un élément intentionnellement retiré, avec un
équivalent V2 documenté ci-dessus), pas des régressions. Mais `CLAUDE.md` interdit
explicitement de modifier un fichier `scripts/qa-*.js` pour faire taire un échec — ce script
teste encore la forme DOM du V1 par construction. Il devra être mis à jour pour tester la
forme V2 native (`.v2-widget-container`, `.v2-widget-drag-handle`, panneaux workspace/portail)
dans un chantier dédié, avec accord explicite, plutôt que d'être corrigé en douce ici. Même
remarque pour `docs/visual-baselines/` : la mise en page ayant changé dans son ensemble, une
passe de `qa-visual-regression.js` montrerait des diffs massifs partout — attendus, pas
utiles tels quels, nouvelles baselines à capturer séparément après validation humaine du rendu.

**Statut final** : les 26 widgets d'origine du catalogue ont chacun un verdict définitif et
exécuté — plus aucun widget en V1, plus de flag, plus de grille modulable héritée. Le "Shadow
Backlog" (`session-manager.js` — vérifié inexistant dans le dépôt —, routage par hash — vérifié
absent de `dashboard.html` —, audit complet de `pro-global.css` — non fait, hors périmètre de ce
chantier qui ne touchait que `docs/app/dashboard.html`/`docs/widgets.js`) reste, pour sa
dernière partie, un chantier distinct si besoin.
