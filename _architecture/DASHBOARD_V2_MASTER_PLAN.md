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
| `serenity-score` | Indice de santé du compte | — (remplacé par le Bandeau de situation, §4 vision) | Supprimé |
| `metric-0` | Métrique principale | Zone 3 — Santé financière (à réassigner : CA/Marge/Encaissements) | Orphelin |
| `metric-1` | Métrique activité | Zone 2 Bloc A — Interventions (compteur) | Migré |
| `metric-2` | Métrique clients | — (aucune zone V2 dans le MVP 12 widgets ; futur module "Commercial") | Orphelin |
| `metric-3` | Métrique devis | Zone 3 Carte 4 — Devis | Migré |
| `bento-chart` | Suivi des encaissements | Zone 3 Carte 3 — Encaissements | Migré |
| `bento-actions` | Actions flash | — (explicitement listé §26 de la vision) | Supprimé |
| `timeline` | Journée d'aujourd'hui | Zone 2 Bloc A — mini-timeline | Migré |
| `activity` | Activité récente | — (aucune zone V2 explicite) | Orphelin |
| `recos` | Recommandations Seba | Zone "Seba IA" (§21 vision, position 14 dans l'ordre §24) | Migré |
| `quick-actions` | Actions rapides | — (remplacé par le bouton `+ Créer` contextuel du header, §3/§11 vision) | Supprimé |
| `goal` | Objectif du mois | Zone 3 Carte 1 — CA (fusionné : barre d'objectif) | Migré |
| `workspace` | Votre espace | — (explicitement listé §26 de la vision) | Supprimé |
| `portal` | Portail client | — (retiré du dashboard, relocalisé en item de sidebar "Configuration", §2 vision) | Supprimé |
| `team` | Équipe aujourd'hui | Zone 2 Bloc B — Équipe | Migré |
| `chart-donut` | Répartition des interventions | — (graphique décoratif sans action, contraire à §13/§26 vision) | Orphelin |
| `lot-impayes` | Factures en retard | "À traiter maintenant" (facture échue) + Zone 3 Encaissements | Migré* |
| `lot-pipeline` | Pipeline devis → facture → encaissé | Zone 3 (Devis/Encaissements) ou Analyse détaillée | Migré* |
| `lot-tournee` | Tournée du jour | Zone 2 Bloc C — Carte et déplacements | Migré* |
| `lot-carte` | Carte des interventions | Zone 2 Bloc C — Carte et déplacements | Migré |
| `lot-treso` | Position de trésorerie | Zone 3 (Encaissements/Dépenses) ou Analyse détaillée | Migré* |
| `generic-media-report` | Rapport photo | Zone 5 — Qualité ("Photos manquantes") | Migré |
| `marge-reelle` | Marge réelle | Zone 3 Carte 2 — Marge + Zone 4 — Rentabilité par intervention | Migré** |
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

---

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
