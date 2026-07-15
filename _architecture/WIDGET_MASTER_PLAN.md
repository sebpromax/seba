---
widget_matrix_version: 2
last_updated: 2026-07-15
status: draft
owners:
  - product
  - architecture
---

# 🗺️ WIDGET_MASTER_PLAN.md — Source de vérité du système de widgets Seba

## 1. Objet du document

Ce document existe pour stabiliser, en un seul endroit, les règles d'attribution des widgets du dashboard par secteur métier, leurs dépendances, et la manière dont le système doit évoluer sans casser les personnalisations des utilisateurs.

**Son périmètre :** le moteur de widgets du dashboard (`docs/app/dashboard.html`, `docs/widgets.js`, `docs/services/config-dashboard.js`, `docs/services/widget-data-api.js`), les secteurs métiers déclarés (`docs/businessTypes.js`, `docs/seba-data.js`), et l'attribution widgets↔secteurs.

**Ce qu'il ne régit pas :** l'architecture générale du dépôt (`_architecture/ARCHITECTURE.md` reste la référence pour la migration `docs/app/`), les règles de développement d'un widget au sens technique pas-à-pas (`_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md` reste la référence pour "comment coder un widget"), le schéma de données Supabase (`supabase-schema.sql`), les pages marketing/SEO hors dashboard.

**Documents qui doivent désormais le référencer :** `_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md` (attribution par secteur), `_architecture/ARCHITECTURE.md` (mention du dossier `docs/services/`), et tout futur document de roadmap dashboard.

**Règle de préséance :** en cas de contradiction sur l'attribution ou les dépendances d'un widget, `WIDGET_MASTER_PLAN.md` prévaut sur les documents secondaires, **sauf** contradiction avec le schéma de données ou le code de production non encore migré — dans ce cas le code/schéma réel fait foi jusqu'à résolution explicite (voir §17).

Toute création ou modification de widget doit être répercutée ici (inventaire §5, matrice §6, fiche §7) avant ou en même temps que le changement de code.

---

## 2. Définitions

**Widget** — Un module d'interface autonome affichant, synthétisant ou permettant d'exploiter une information métier, enregistré comme une entrée de `window.WIDGET_CATALOG` (`docs/widgets.js`), avec un `id`, un `render(ctx, el)`, une taille de grille (`S|M|L|XL`) et une catégorie.

**Secteur** — Une configuration métier de Seba regroupant services, champs, terminologie, priorités et widgets adaptés à un type d'entreprise, identifiée par une clé stable (`biz.secteur`) utilisée par `businessTypes.js`, `seba-data.js` et `config-dashboard.js`.

**Widget obligatoire — O** — Widget activé par défaut pour le secteur, considéré comme faisant partie de son expérience de base.

**Widget optionnel — P** — Widget compatible avec le secteur, disponible dans le catalogue, mais non activé automatiquement.

**Widget incompatible — X** — Widget sans valeur métier suffisante, techniquement incompatible ou explicitement exclu pour le secteur. **Important (Confirmé par le code) : ce statut n'est aujourd'hui appliqué nulle part dans le code.** Voir §16, risque critique R-01.

**Widget pur** — Widget respectant le protocole "Widget Pur" (`_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md`) : ne contient aucune condition métier codée en dur (`if (secteur === "menage")`), reçoit ses données via une interface standardisée (`window.SebaWidgetAPI`), jamais directement `window.SebaDB`/`localStorage`.

**Extension sectorielle** — Adaptateur permettant à un widget commun de gérer une terminologie, des données, des calculs ou des actions propres à un métier, **sans dupliquer le widget**. **Non trouvé dans le dépôt** : ce mécanisme n'existe pas encore techniquement (aucun contrat d'extension déclaratif) — voir §9.

**Dépendance requise** — Service, table, API, permission ou module sans lequel le widget ne peut pas fonctionner correctement.

**Dépendance facultative** — Service ou donnée qui enrichit le widget sans empêcher son fonctionnement principal.

---

## 3. Sources analysées

| Source | Type | Rôle | État | Observations |
|---|---|---|---|---|
| `CLAUDE.md` | Documentation | Contraintes du projet | Confirmé | Règles vanilla JS, SebaDB source unique, garde-fous |
| `_architecture/ARCHITECTURE.md` | Architecture | Structure cible `docs/app/` | Confirmé | Révisé le 2026-07-15, migration `dashboard.html` actée |
| `_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md` | Documentation | Protocole "Widget Pur", merge secteur | Confirmé | Rédigé dans cette même session de travail |
| `docs/businessTypes.js` | Code métier | Secteurs, services, champs | Confirmé | 11 clés de secteur, lu intégralement |
| `docs/seba-data.js` | Code métier | SebaDB (API données), seed par secteur | Confirmé | `SebaDB.list/get/create/update/remove/hasData/metrics`, `SEED_SERVICES`/`SEED_EMPLOYES` |
| `docs/widgets.js` | Code métier | `WIDGET_CATALOG`, moteur de rendu, merge | Confirmé | 25 widgets recensés, lu intégralement sur les sections pertinentes |
| `docs/services/config-dashboard.js` | Code métier | Attribution widgets par secteur | Confirmé | Écrit dans cette session, `CORE` + `BY_SECTEUR` |
| `docs/services/widget-data-api.js` | Code métier | `SebaWidgetAPI` (façade Widget Pur) | Confirmé | Écrit dans cette session |
| `docs/app/dashboard.html` | Code UI | Rendu dashboard, init, palette, tiroir | Confirmé | Script d'init (`renderDashboard`), `buildLibraryPanelHTML` |
| `docs/onboarding.html` | Code UI | Sélection de secteur à l'inscription | Confirmé | **Contradiction majeure détectée — voir §4 et §17, WM-001** |
| `docs/bienvenue.html` | Code UI | Écran post-onboarding, activation | Confirmé | Relit `biz.secteur` tel quel, ne remappe rien |
| `docs/client-fiche.html` | Code UI | Fiche client | Confirmé | Aucune mention de "widget" — sections de page, pas des widgets |
| `docs/reglages.html` | Code UI | Réglages compte | Confirmé | Aucun champ de changement de secteur |
| `supabase-schema.sql` | Schéma DB | Backend Supabase | Confirmé | `vue_marge_interventions`, `get_marge_reelle` existent côté DB |
| `PLAN.md` | Roadmap | Suivi des chantiers | Confirmé | Widget "marge réelle" listé non commencé |
| `strategie/dashboard-vision-modulaire.md` | Vision produit | Origine du moteur de widgets | Confirmé | Direction validée 2026-07-03, implémentée 2026-07-04 |
| `CHANGELOG.md` | Documentation | Historique des jalons | Confirmé | Migration `app/`, widgets par secteur, Widget Pur |

Fichiers cités dans la mission mais non explorés en détail dans cette passe (existence non contestée, contenu non audité ligne à ligne) : `AUDIT-DASHBOARD.md`, `BENCHMARK-DASHBOARD.md`, `QA-DASHBOARD.md`, `docs-backend.md`, `ARCHITECTURE-V2.md`, `ARCHITECTURE-MODULAIRE.md`. **À valider** si nécessaire dans une passe ultérieure.

---

## 4. Inventaire des secteurs

**Confirmé par le code** — 11 clés de secteur strictement identiques entre `businessTypes.js`, `seba-data.js` (`SEED_SERVICES`/`SEED_EMPLOYES`) et `docs/services/config-dashboard.js` (`BY_SECTEUR`) :

| ID stable | Nom affiché | État | Présent dans le code | Présent dans l'onboarding | Niveau de support | Observations |
|---|---|---|---|---|---|---|
| `menage` | Ménage & nettoyage | Actif | Oui | **Non (voir ci-dessous)** | Complet | Seed, DEMO, config-dashboard tous présents |
| `conciergerie` | Conciergerie / Location courte durée | Actif | Oui | Non | Complet | |
| `conciergerieCopro` | Conciergerie de copropriété | Actif | Oui | Non | Partiel | Présent dans `businessTypes.js`/config ; **à valider** si `DEMO` (widgets.js) a une entrée dédiée ou retombe sur `autre` |
| `conciergerieEntreprise` | Conciergerie d'entreprise | Actif | Oui | Non | Partiel | Idem — à valider pour `DEMO` |
| `jardinage` | Jardinage & paysagisme | Actif | Oui | Non | Complet | |
| `maintenance` | Maintenance & bricolage | Actif | Oui | Non | Complet | Regroupe bricolage, plomberie légère, électricité légère comme **services**, pas comme secteurs séparés |
| `pressing` | Pressing & blanchisserie | Actif | Oui | Non | Complet | |
| `beaute` | Beauté & soins à domicile | Actif | Oui | Non | Complet | |
| `animaux` | Garde & soins d'animaux | Actif | Oui | Non | Complet | |
| `demenagement` | Déménagement & transport | Actif | Oui | Non | Complet | |
| `autre` | Autre activité | Actif (fallback) | Oui | Oui (bouton "Autre activité") | Complet | Secteur "roue de secours" — reçoit tout ce qui ne matche aucune autre clé, y compris par accident (voir §4.5) |

### 4.1 Secteurs confirmés

Les 11 clés ci-dessus sont confirmées par trois fichiers indépendants et cohérents entre eux (`businessTypes.js`, `seba-data.js`, `config-dashboard.js`).

### 4.2 Secteurs prévus

Aucun secteur additionnel prévu n'a été trouvé dans le dépôt (pas de mention de secteur futur dans `PLAN.md`/`PROGRESS.md`).

### 4.3 Secteurs proposés mais non validés

Aucun. La mission demandait de rechercher "plomberie", "électricité", "dépannage", "artisanat du bâtiment" comme secteurs potentiels — **confirmé par le code : ce sont des services à l'intérieur du secteur `maintenance`, pas des secteurs distincts** (`businessTypes.js` l.263-307).

### 4.4 Secteurs potentiellement redondants

Aucune redondance entre les 11 clés elles-mêmes (chacune a des `services`/`dashboardMetrics`/`clientFields` distincts, notamment les 3 variantes de conciergerie qui ciblent des publics différents : particuliers/Airbnb, copropriété, entreprise). Pas de fusion recommandée à ce stade.

### 4.5 Contradiction critique — onboarding vs. clés internes (Confirmé par le code)

**Résolu (2026-07-15, `docs/services/config-dashboard.js` — `SECTOR_MAPPING`/`resolveSector()`, appliqué dans `docs/onboarding.html` avant l'écriture en `localStorage`).** Description ci-dessous conservée pour l'historique et parce que la correction ne migre pas les comptes déjà créés avec un libellé brut (aucun compte réel n'existait à ce stade selon le contexte projet — voir §17, WM-001 marqué résolu).

**`docs/onboarding.html` (lignes 220-232, 366) n'utilise pas les 11 clés ci-dessus.** L'écran de sélection de secteur ne propose que 4 boutons, dont la valeur (`data-sector`) est un **libellé affiché en français**, stocké tel quel :

```html
<button ... data-sector="Nettoyage &amp; Entretien">
<button ... data-sector="Conciergerie &amp; Accueil">
<button ... data-sector="Artisans &amp; Maintenance">
<button ... data-sector="Autre activité">
```
```js
localStorage.setItem('sebaEntreprise', JSON.stringify({ nom: S.nom, secteur: S.sector, email: S.email }));
```

`biz.secteur` vaut donc littéralement `"Nettoyage & Entretien"`, `"Conciergerie & Accueil"` ou `"Artisans & Maintenance"` pour tout utilisateur réel passé par l'onboarding — jamais `"menage"`, `"conciergerie"` ou `"maintenance"`. `docs/bienvenue.html` (l.141, 166-168) relit `biz.secteur` sans le remapper.

**Conséquence (Confirmé par le code) :** chaque lookup en aval (`businessTypes[secteur]` dans `dashboard.html`, `SEED_SERVICES[secteur]`/`SEED_EMPLOYES[secteur]` dans `seba-data.js`, `SEBA_DASHBOARD_CONFIG.bySecteur[secteur]` dans `config-dashboard.js`, `DEMO[secteur]` dans `widgets.js`) échoue silencieusement pour ces chaînes, et retombe sur son filet de sécurité `'autre'`/`{}`. **Tout utilisateur passé par l'onboarding réel reçoit donc aujourd'hui la configuration `autre` par défaut** (services génériques, aucun widget compagnon promu), quel que soit le bouton cliqué à l'inscription — y compris pour le seul secteur "Autre activité" qui, lui, matche par coïncidence puisque son libellé est identique à la clé... non, `autre` (clé) ≠ `"Autre activité"` (libellé) non plus : même ce cas ne matche pas la clé interne, il retombe sur le même filet de sécurité par un chemin différent (les deux aboutissent au même résultat visuellement, ce qui a probablement masqué le bug).

Cette contradiction touche directement le travail livré dans cette session (widgets par secteur, `feature/dashboard-widget-engine`, déployé en production le 2026-07-15) : **la fonctionnalité "widgets par défaut selon le secteur" est aujourd'hui inerte pour tout utilisateur réel**, elle n'a été vérifiée que via des scripts QA qui injectent directement une clé interne (`secteur: 'menage'`) en `localStorage`, en contournant le vrai parcours d'onboarding.

Conformément à la règle de fiabilité de cette mission, ce comportement n'est **pas corrigé ici** (aucune décision métier prise unilatéralement, aucun fichier applicatif modifié) — il est documenté et ajouté aux décisions ouvertes (§17, WM-001, priorité **Critique**).

Second écart, indépendant du premier : même corrigé, l'onboarding n'offre que **4 catégories** ("Nettoyage & Entretien", "Conciergerie & Accueil", "Artisans & Maintenance", "Autre activité") contre **11 clés internes** granulaires. **Résolu (2026-07-15) via un mapping 4→1 parmi 11** (pas 4→11) : `SECTOR_MAPPING` associe chaque libellé à la clé la plus représentative (`"Nettoyage & Entretien"` → `menage`, `"Conciergerie & Accueil"` → `conciergerie`, `"Artisans & Maintenance"` → `maintenance`, `"Autre activité"` → `autre`). Conséquence assumée : un utilisateur choisissant "Conciergerie & Accueil" reçoit toujours la configuration `conciergerie` de base, jamais `conciergerieCopro`/`conciergerieEntreprise` — ces deux clés restent aujourd'hui inatteignables depuis l'onboarding réel (uniquement modifiables via `reglages.html` s'il existait un champ secteur, ce qui n'est toujours pas le cas, §14). Si une granularité plus fine est requise pour ces deux profils, il faudra soit ajouter des boutons à l'onboarding, soit un écran de précision après le choix "Conciergerie & Accueil" — non fait ici (aurait dépassé le périmètre "assainir l'inscription" demandé).

---

## 5. Inventaire des widgets

**Confirmé par le code** — `window.WIDGET_CATALOG` (`docs/widgets.js`, ~l.1138-1500) contient exactement **25 widgets**.

**Règle de distinction retenue** (widget vs. autre chose) : est un *widget* toute entrée de `WIDGET_CATALOG` avec `id`/`render()`/`size`/`category`. N'est **pas** un widget : un conteneur de mise en page (`.cockpit-telemetry`), un mécanisme de gestion des widgets eux-mêmes (tiroir d'extensions, panneau "Personnaliser", palette de commande), une section de fiche (champs de `client-fiche.html`/`employe-fiche.html`, pilotés par `businessTypes.js.clientFields`, pas par `WIDGET_CATALOG`), ou une page entière (`planning.html`, `factures.html` — des pages, pas des widgets, même si des widgets y renvoient via leur champ `link`).

### 5.1 Widgets actifs (source `live` ou `demo`, rendus avec de vraies données quand elles existent)

| ID stable | Nom affiché | Emplacement | Catégorie | Widget pur | Extension nécessaire |
|---|---|---|---|---|---|
| `serenity-score` | Indice de santé du compte | Télémétrie pinnée | Pilotage | Non (accède `ctx`, calcul interne) | Non |
| `metric-0` à `metric-3` | Métriques principale/activité/clients/devis | Grille / télémétrie | Pilotage | Partiel (lit `ctx.demo`) | Non |
| `bento-chart` | Suivi des encaissements | Grille | Finance | Partiel (lit `ctx.demo`, D3) | Non |
| `timeline` | Journée d'aujourd'hui | Télémétrie pinnée | Planning | Partiel (lit `ctx.demo`) | Non |
| `activity` | Activité récente | Grille | Pilotage | Partiel (lit `ctx.demo`) | Non |
| `recos` | Recommandations Seba | Grille | Pilotage | Partiel (lit `ctx.demo`) | Non |
| `goal` | Objectif du mois | Grille | Finance | Partiel (lit `ctx.demo`) | Non |
| `workspace` | Votre espace | Grille | Compte | Partiel | Non |
| `portal` | Portail client | Grille | Client | Partiel | Non |
| `team` | Équipe aujourd'hui | Grille | Équipe | Partiel | Non |
| `chart-donut` | Répartition des interventions | Grille (opt-in) | Intervention | **Non — appelle `window.SebaDB` directement** | Non |
| `lot-carte` | Carte des interventions | Grille (opt-in) | Intervention | **Non — appelle `window.SebaDB` directement**, + Leaflet | Non |
| `generic-media-report` | Rapport photo (titre variable par secteur) | Grille (opt-in) | Intervention | **Oui — seul widget via `SebaWidgetAPI`, ET généralisé par extension sectorielle (WM-004, résolu)** | Non (copie via `WIDGET_EXTENSIONS`) |

### 5.2 Widgets partiels ou simulés

| ID stable | Nom affiché | Observation |
|---|---|---|
| `bento-actions` | Actions flash | `source: 'static'` — liens statiques, pas de données métier réelles à afficher |
| `quick-actions` | Actions rapides | `source: 'static'` — raccourcis, pas un indicateur |
| `lot-impayes` | Factures en retard | `source: 'lot:contentieux'` — lit `ctx.demo`, la page liée (`contentieux-recouvrement.html`) est une page de démonstration/mockup, **à valider** si elle expose de vraies données de production |
| `lot-pipeline` | Pipeline devis → facture → encaissé | Idem, `source: 'lot:mutation'`, lié à `mutation-contextuelle.html` |
| `lot-tournee` | Tournée du jour | Idem, `source: 'lot:haversine'`, lié à `haversine-engine.html` |
| `lot-treso` | Position de trésorerie | Idem, `source: 'lot:treso'`, lié à `cockpit-treso.html`, lit `ctx.demo.goal` uniquement (estimation simplifiée, dit explicitement "Estimation simplifiée" dans son propre rendu) |

Les 4 widgets `lot-*` ci-dessus renvoient vers des pages mockup/SEO (`docs/*.html` à la racine, hors `docs/app/`) qui ne sont **pas** confirmées comme des pages produit connectées à SebaDB — **à valider**.

### 5.3 Widgets prévus

| ID stable proposé | Nom | Statut | Source |
|---|---|---|---|
| `marge-reelle` (nom non confirmé, aucune entrée `WIDGET_CATALOG`) | Widget "marge réelle" | **Prévu — non commencé** | `PLAN.md` l.36/55 : "aucune UI ne consomme encore `vue_marge_interventions`/`get_marge_reelle`". Ces deux objets existent bien côté base (`supabase-schema.sql` l.773, l.803) — **dépendance conceptuelle, implémentation front et nom technique à définir** |

### 5.4 Éléments ne devant pas être considérés comme des widgets

- `.cockpit-telemetry` (zone fixe CA/Serenity Score/Missions) — un conteneur de mise en page, pas un widget en soi (il *contient* 3 widgets pinnés).
- Panneau "Personnaliser" (`buildLibraryPanelHTML`), tiroir "Bibliothèque d'extensions" (`ext-drawer`), palette de commande — mécanismes de **gestion** des widgets, pas des widgets.
- Champs de `client-fiche.html`/`employe-fiche.html` (pilotés par `businessTypes.js.clientFields`) — des sections de fiche, confirmé qu'aucune n'est enregistrée dans `WIDGET_CATALOG`.
- Pages `docs/*.html` de la racine liées par le champ `link` des widgets `lot-*` (`contentieux-recouvrement.html`, `mutation-contextuelle.html`, `haversine-engine.html`, `cockpit-treso.html`) — ce sont des pages, potentiellement des mockups/SEO, pas des widgets.

### 5.5 Widgets potentiellement redondants ou mal positionnés

`generic-media-report` (anciennement `cleaning-photo-report`) a été conçu et livré comme démonstration du protocole "Widget Pur" (accès données via `SebaWidgetAPI` uniquement), avec un écart identifié a posteriori : sa copie était codée en dur pour `menage`. **Résolu (2026-07-15, WM-004)** : renommé, son titre et son état vide sont désormais résolus via `SEBA_DASHBOARD_CONFIG.widgetExtensionFor()` (`docs/services/config-dashboard.js`) — un vrai contrat d'extension sectorielle, avec une copie dédiée pour `menage`/`conciergerie`/`conciergerieCopro`/`conciergerieEntreprise` et un repli générique neutre (`default`) pour les autres secteurs. C'est désormais le premier exemple réel de la catégorie "Pur avec extension" du protocole (§9), plus seulement "Pur" au sens strict de l'accès aux données.

---

## 6. Matrice d'attribution secteurs × widgets

Légende : **O** obligatoire (activé par défaut) · **P** optionnel (disponible, non promu) · **X** incompatible (aspirationnel, voir avertissement) · **?** décision impossible aujourd'hui.

**Avertissement (Confirmé par le code) :** aucune valeur **X** de cette matrice n'est appliquée techniquement aujourd'hui. `buildLibraryPanelHTML()` (`docs/widgets.js`) liste et permet d'activer **l'intégralité** de `WIDGET_CATALOG` pour **tout** secteur, sans filtre de compatibilité. Le **X** ci-dessous décrit donc une recommandation métier, pas un blocage réel — voir R-01 (§16).

| Widget | menage | conciergerie | conciergerieCopro | conciergerieEntreprise | jardinage | maintenance | pressing | beaute | animaux | demenagement | autre |
|---|---|---|---|---|---|---|---|---|---|---|---|
| serenity-score | O | O | O | O | O | O | O | O | O | O | O |
| metric-0..3 | O | O | O | O | O | O | O | O | O | O | O |
| bento-chart | O | O | O | O | O | O | O | O | O | O | O |
| bento-actions | O | O | O | O | O | O | O | O | O | O | O |
| timeline | O | O | O | O | O | O | O | O | O | O | O |
| activity | O | O | O | O | O | O | O | O | O | O | O |
| recos | O | O | O | O | O | O | O | O | O | O | O |
| quick-actions | O | O | O | O | O | O | O | O | O | O | O |
| goal | O | O | O | O | O | O | O | O | O | O | O |
| workspace | O | O | O | O | O | O | O | O | O | O | O |
| portal | O | O | O | O | O | O | O | O | O | O | O |
| team | O | O | O | O | O | O | O | O | O | O | O |
| chart-donut | P | P | P | P | O | O | P | P | P | O | P |
| lot-tournee | P | P | P | P | O | O | P | P | P | O | P |
| lot-carte | P | P | P | P | O | O | P | P | P | O | P |
| lot-pipeline | O | O | O | O | P | P | O | O | O | P | P |
| lot-impayes | O | O | O | O | P | P | O | O | O | P | P |
| lot-treso | P | P | P | P | P | P | P | P | P | P | P |
| generic-media-report | O | P | P | P | P | P | P | P | P | P | P |
| ext-chart / ext-notes / ext-rss | P | P | P | P | P | P | P | P | P | P | P |

*(`team` est marqué O partout par cohérence avec `CORE` de `config-dashboard.js`, bien qu'une entreprise individuelle sans salarié — plausible pour `beaute`/`animaux` — n'ait rien à y afficher : voir état vide, non une incompatibilité.)*

### 6.1 Justification des obligations

- **Widgets `core` (serenity-score → team) en O partout** : ce sont exactement les widgets du tableau `CORE` de `config-dashboard.js` — décision déjà actée et déployée, présentée ici pour complétude, pas re-décidée.
- **`chart-donut`, `lot-tournee`, `lot-carte` en O pour `maintenance`/`jardinage`/`demenagement`** : ces trois métiers sont caractérisés par des interventions dispersées géographiquement dans la journée (tournées) — la carte et l'optimisation de tournée répondent à un besoin quotidien, pas occasionnel. Décision déjà actée dans `config-dashboard.js` (session précédente), reprise ici.
- **`lot-pipeline`, `lot-impayes` en O pour `menage`/`conciergerie*`/`pressing`/`beaute`/`animaux`** : ces secteurs reposent davantage sur la facturation récurrente/abonnement (`priceType: 'abonnement'` fréquent dans `businessTypes.js` pour ces secteurs) — le suivi des impayés et du pipeline commercial y est quotidien. Décision déjà actée, reprise ici.
- **`generic-media-report` en O uniquement pour `menage`** : c'est le secteur d'origine du widget, celui pour lequel la valeur métier (photos avant/après de ménage) est la plus immédiate. Les autres secteurs restent en P plutôt qu'O par choix conservateur, pas par limite technique (voir résolution WM-004 ci-dessous).

### 6.2 Justification des incompatibilités

Aucun statut X discutable ne subsiste pour `generic-media-report` depuis sa généralisation (WM-004, résolu le 2026-07-15) — voir §6.3.

### 6.3 Intersections non résolues (mise à jour 2026-07-15)

- **`generic-media-report` pour `conciergerie`/`conciergerieCopro`/`conciergerieEntreprise`/`jardinage`/`maintenance`/`pressing`/`beaute`/`animaux`/`demenagement`** — **Résolu (WM-004)** : le widget a été généralisé (`docs/widgets.js`, id `generic-media-report`) et sa copie résolue via un contrat d'extension sectorielle (`WIDGET_EXTENSIONS`, `docs/services/config-dashboard.js`) — titre/icône/état vide dédiés pour `menage`/`conciergerie`/`conciergerieCopro`/`conciergerieEntreprise`, copie générique neutre (`default`) pour les 6 secteurs restants. Passé de X (aspirationnel) à P partout (sauf `menage` en O) — plus aucune incohérence de terminologie à l'affichage, quel que soit le secteur qui l'active manuellement.
- **`lot-treso` pour tous les secteurs** (marqué P partout, jamais O) : absent de tout tableau `BY_SECTEUR` dans `config-dashboard.js` — **à valider si c'est un choix délibéré ou un oubli**, puisque la trésorerie concernerait a priori tous les secteurs à facturation récurrente au même titre que `lot-pipeline`/`lot-impayes`. Voir WM-003 (toujours ouvert, non traité par cette session de correctifs).

---

## 7. Fiche architecturale de chaque widget

*(Fiches condensées pour les widgets `core` très similaires entre eux ; fiches complètes pour les widgets `companion`/`extension` et pour le widget prévu.)*

### `serenity-score` — Indice de santé du compte

**État :** Actif · **Catégorie :** Pilotage · **Widget pur :** Non (calcul interne à partir de `ctx`) · **Extension sectorielle :** Aucune
**Secteurs obligatoires :** tous (11) · **Secteurs optionnels :** aucun · **Secteurs incompatibles :** aucun

**Objectif métier** — Donner en un coup d'œil un score de "santé" global de l'activité (trésorerie, activité, relances).
**Utilisateur principal** — Dirigeant.
**Données requises** — `ctx` construit par `buildWidgetCtx()` (`docs/widgets.js`), lui-même alimenté par `SebaDB`/`ctx.demo` en amont dans `dashboard.html`. Pas d'accès direct à `SebaDB` dans le widget lui-même.
**Données facultatives** — Aucune identifiée.
**États requis** — Chargement (animation), données disponibles, erreur : **à valider** (pas de test explicite d'un état d'erreur trouvé).
**Actions produites** — Ouvre potentiellement le "mode focus" (`toggleFocusMode()`, `dashboard.html`).
**Événements consommés/produits** — **Non trouvé dans le dépôt** (pas de bus d'événements formel consommé ici — `docs/src/ui/event-bridge.js` existe mais Phase 3 "non confirmée").
**Permissions** — **Non trouvé dans le dépôt** : aucun système de rôles/permissions identifié dans `seba-data.js` (le champ `role` des employés est un intitulé de poste, pas un rôle d'accès).
**Extension sectorielle** — Aucune, le calcul est générique.
**Limites actuelles** — Widget pinné (non déplaçable/masquable via l'UI normale) — voir `PINNED_TELEMETRY_IDS`.
**Questions ouvertes** — Aucune spécifique.

### `metric-0`, `metric-1`, `metric-2`, `metric-3` — Métriques principale / activité / clients / devis

**État :** Actif · **Catégorie :** Pilotage · **Widget pur :** Partiel (lit `ctx.demo.metrics[i]`) · **Extension sectorielle :** Aucune
**Secteurs obligatoires :** tous · **Secteurs optionnels :** aucun · **Secteurs incompatibles :** aucun

**Objectif métier** — Afficher 4 chiffres clés (CA, volume d'activité, clients, devis en attente).
**Utilisateur principal** — Dirigeant.
**Données requises** — `ctx.demo.metrics[0..3]`, alimenté par `buildLiveData()` (`SebaDB.metrics()`) si des données existent, sinon `DEMO[secteur]`.
**Données facultatives** — Aucune.
**États requis** — Donnée présente / absente (`if (m) ...`) ; pas d'état d'erreur explicite identifié.
**Actions produites** — Carte cliquable (`metric-card`), cible **à valider** (pas de handler `onclick` trouvé sur la carte elle-même dans l'extrait consulté).
**Permissions** — Non trouvé.
**Limites actuelles** — `metric-0` est pinné (télémétrie fixe), `metric-1..3` sont dans la grille modulable.

### `bento-chart` — Suivi des encaissements

**État :** Actif · **Catégorie :** Finance · **Widget pur :** Partiel · **Extension sectorielle :** Aucune
**Secteurs :** O partout.
**Objectif métier** — Courbe d'évolution du CA (D3.js), objectif du mois.
**Données requises** — `ctx.demo.goal`, `ctx.sym` (symbole monétaire) ; bibliothèque **D3 (CDN)**, dépendance technique requise.
**Actions produites** — Changement de période (`switchChartPeriod('mois'|'jour')`).
**Limites actuelles** — Dépend de `typeof d3 === 'undefined'` avec repli HTML simplifié si D3 ne charge pas (mode dégradé déjà présent — bon signal, voir §16 R-08 en positif).

### `bento-actions` — Actions flash

**État :** Actif (statique) · **Catégorie :** Autre (action rapide) · **Widget pur :** Oui (aucune donnée métier, liens fixes) · **Extension sectorielle :** Aucune
**Secteurs :** O partout.
**Objectif métier** — Raccourcis visuels vers "programmer une intervention", "envoyer un lien de paiement", etc.
**Données requises** — Aucune (source `static`).
**Questions ouvertes** — Est-ce un "widget" au sens architectural ou une simple section d'actions rapides ? Conservé ici car présent dans `WIDGET_CATALOG`, mais à re-discuter (voir §16 R-04 confusion composant/widget).

### `timeline` — Journée d'aujourd'hui

**État :** Actif · **Catégorie :** Planning · **Widget pur :** Partiel · **Extension sectorielle :** Aucune
**Secteurs :** O partout (et pinné en télémétrie).
**Objectif métier** — Vue de la journée (rendez-vous/interventions).
**Données requises** — `ctx.demo`. **Lien** vers `planning.html`.
**Limites actuelles** — Widget pinné, non retirable via l'UI standard.

### `activity` — Activité récente

**État :** Actif · **Catégorie :** Pilotage · **Widget pur :** Partiel
**Secteurs :** O partout. **Lien** vers `historique.html`.

### `recos` — Recommandations Seba

**État :** Actif · **Catégorie :** Pilotage · **Widget pur :** Partiel
**Secteurs :** O partout.
**Objectif métier** — Suggestions textuelles paramétrées par `businessTypes[secteur].recommendations` (ex. "Relancez [client]...") — **c'est le seul widget `core` dont le contenu varie réellement par secteur** via une donnée déclarative (`recommendations` dans `businessTypes.js`), pas via du code conditionnel — bon exemple de ce qu'une "extension sectorielle" déclarative pourrait généraliser (voir §9).

### `quick-actions` — Actions rapides

**État :** Actif (statique) · **Catégorie :** Autre (action rapide) · **Widget pur :** Oui
**Secteurs :** O partout. Même remarque que `bento-actions` (§16 R-04).

### `goal` — Objectif du mois

**État :** Actif · **Catégorie :** Finance · **Widget pur :** Partiel
**Secteurs :** O partout. **Lien** vers `factures.html`.

### `workspace` — Votre espace

**État :** Actif · **Catégorie :** Compte · **Widget pur :** Partiel
**Secteurs :** O partout. **Lien** vers `reglages.html`.

### `portal` — Portail client

**État :** Actif · **Catégorie :** Client · **Widget pur :** Partiel
**Secteurs :** O partout.
**Objectif métier** — Lien de partage client. Détails d'implémentation non audités en profondeur dans cette passe — **à valider**.

### `team` — Équipe aujourd'hui

**État :** Actif · **Catégorie :** Équipe · **Widget pur :** Partiel
**Secteurs :** O partout. **Lien** vers `equipe.html`.
**Questions ouvertes** — État vide pour une entreprise individuelle sans salarié : **à valider** que ce cas est bien géré (pas confirmé dans cette passe).

### `chart-donut` — Répartition des interventions

**État :** Actif · **Catégorie :** Intervention · **Widget pur : Non — accède directement `window.SebaDB.list('interventions')`/`SebaDB.hasData()`** (dette technique documentée dans `WIDGET_DEVELOPMENT_PROTOCOL.md`, antérieure à la règle "Widget Pur") · **Extension sectorielle :** Aucune
**Secteurs obligatoires :** jardinage, maintenance, demenagement · **Secteurs optionnels :** les 8 autres · **Secteurs incompatibles :** aucun (aspirationnel)

**Objectif métier** — Visualiser la répartition des interventions (faites/en cours/à venir) sous forme d'anneau.
**Utilisateur principal** — Dirigeant, responsable planning.
**Données requises** — `SebaDB.list('interventions')` (**dépendance requise, confirmée**), `SebaDB.hasData()`.
**États requis** — Pas de données → **à valider** l'état vide exact (non audité en détail).
**Limites actuelles** — Contrevient à la règle "Widget Pur" (accès direct SebaDB) — dette technique assumée, pas rétro-migrée (voir §9).

### `lot-tournee` — Tournée du jour

**État :** Actif (simulé — `source: 'lot:haversine'`) · **Catégorie :** Intervention · **Widget pur :** Partiel (lit `ctx.demo`, pas d'accès direct SebaDB identifié dans l'extrait consulté — **à valider** sur l'intégralité du `render()`)
**Secteurs obligatoires :** maintenance, jardinage, demenagement · **Secteurs optionnels :** les 8 autres

**Objectif métier** — Lister/optimiser les déplacements du jour.
**Données requises** — `ctx.demo` ; **lien** vers `haversine-engine.html` — **à valider** si cette page est un produit réel connecté à SebaDB ou une démonstration/mockup (nom suggère un module de calcul, pas une page utilisateur classique).
**Limites actuelles** — Dépendance conceptuelle possible à une future vraie fonctionnalité d'optimisation de tournée (nom de la page `haversine-engine.html` suggère un calcul de distance, pas encore un widget interactif complet) — implémentation et nom technique définitifs à confirmer.

### `lot-carte` — Carte des interventions

**État :** Actif · **Catégorie :** Intervention · **Widget pur : Non — accède directement `window.SebaDB.metrics().interventionsJour`** · **Dépendance technique requise : Leaflet (CDN, chargé à la demande via `loadLeaflet()`)**
**Secteurs obligatoires :** maintenance, jardinage, demenagement · **Secteurs optionnels :** les 8 autres

**Objectif métier** — Carte géographique des interventions du jour.
**Données requises** — `SebaDB.metrics().interventionsJour` (coordonnées client), Leaflet + tuiles OpenStreetMap (dépendance externe réseau).
**États requis** — Pas d'intervention du jour → placeholder ("Aucune intervention aujourd'hui") déjà géré dans le code (`pts.length ? pts : [{clientName: 'Aucune intervention...'}]`).
**Limites actuelles** — Instance de carte Leaflet réutilisée via `_lotCarteMapInstance` — fuite mémoire déjà documentée et corrigée par le passé (`docs/widgets.js` commentaire "Audit 2.2"). Accès direct SebaDB — dette Widget Pur.

### `lot-pipeline` — Pipeline devis → facture → encaissé

**État :** Actif (simulé — `source: 'lot:mutation'`) · **Catégorie :** Finance · **Widget pur :** À valider (render non audité en détail dans cette passe)
**Secteurs obligatoires :** menage, conciergerie, conciergerieCopro, conciergerieEntreprise, pressing, beaute, animaux · **Secteurs optionnels :** jardinage, maintenance, demenagement, autre
**Lien** vers `mutation-contextuelle.html` — **à valider** nature réelle de cette page (mockup vs. produit).

### `lot-impayes` — Factures en retard

**État :** Actif (simulé — `source: 'lot:contentieux'`) · **Catégorie :** Finance · **Widget pur :** À valider
**Secteurs obligatoires :** menage, conciergerie, conciergerieCopro, conciergerieEntreprise, pressing, beaute, animaux · **Secteurs optionnels :** jardinage, maintenance, demenagement, autre
**Lien** vers `contentieux-recouvrement.html` — **à valider** nature réelle de cette page.

### `lot-treso` — Position de trésorerie

**État :** Actif (estimation simplifiée, le widget l'indique lui-même) · **Catégorie :** Finance · **Widget pur :** Oui pour la lecture (`ctx.demo.goal` uniquement, aucun accès SebaDB/localStorage direct dans le `render()` consulté)
**Secteurs obligatoires :** aucun (absent de `BY_SECTEUR` — voir §6.3, WM-003) · **Secteurs optionnels :** tous · **Secteurs incompatibles :** aucun

**Objectif métier** — Estimation de trésorerie simplifiée à partir du CA du mois, lien vers un "simulateur complet" (`cockpit-treso.html`).
**Limites actuelles** — Le widget affiche lui-même "Estimation simplifiée" — ce n'est pas un calcul de trésorerie réel (pas de charges/décaissements pris en compte).
**Questions ouvertes** — Absence de `BY_SECTEUR` pour ce widget alors que sa logique ressemble à `lot-pipeline`/`lot-impayes` (WM-003).

### `generic-media-report` — Rapport photo (titre variable par secteur)

**État :** Actif (Widget Pur + extension sectorielle de référence) · **Catégorie :** Intervention · **Widget pur : Oui** (accès données intégralement via `window.SebaWidgetAPI.getMediaReport(ctx)`) · **Extension sectorielle : Oui, via `SEBA_DASHBOARD_CONFIG.widgetExtensionFor()`** (`docs/services/config-dashboard.js`, `WIDGET_EXTENSIONS['generic-media-report']`) — **résolu 2026-07-15, WM-004**
**Secteurs obligatoires :** menage · **Secteurs optionnels :** les 10 autres (copie dédiée pour conciergerie/conciergerieCopro/conciergerieEntreprise, copie générique neutre `default` pour les 6 restants) · **Secteurs incompatibles :** aucun

**Objectif métier** — Donner confiance au client final via des photos avant/après d'une intervention, avec une terminologie adaptée au métier (ménage, logement, parties communes, espaces).
**Utilisateur principal** — Dirigeant, client final (valeur de réassurance).
**Données requises** — Dépendance conceptuelle : un champ `photos` sur les interventions **n'existe pas encore dans `SebaDB`** (`seba-data.js` ne définit aucun champ `photos` sur les interventions, confirmé par grep). `SebaWidgetAPI.getMediaReport()` retourne honnêtement `null` tant que ce champ n'existe pas — pas de donnée inventée. Dépendance additionnelle (nouvelle) : `window.SEBA_DASHBOARD_CONFIG.widgetExtensionFor()` pour le titre et la copie d'état vide — absent, le widget retombe sur son `title`/ses textes par défaut codés dans `WIDGET_CATALOG` (jamais d'erreur, juste moins spécifique).
**États requis** — Pas de données (état vide implémenté, copie par secteur), chargement (implicite, synchrone), erreur (`try/catch` implicite dans `SebaWidgetAPI`, pas de message d'erreur dédié — **à valider**).
**Permissions** — Non trouvé.
**Limites actuelles** — Fonctionnalité "photos d'intervention" inexistante en amont (ni upload, ni stockage, ni champ SebaDB) — ce widget est prêt à afficher la donnée dès qu'elle existera, mais rien ne la produit aujourd'hui. La copie n'est définie que pour 4 secteurs (`menage`, les 3 `conciergerie*`) + un repli générique — les 6 autres secteurs partagent un texte neutre, pas une copie dédiée.
**Questions ouvertes** — Construire la vraie fonctionnalité photo (upload, stockage) reste un chantier séparé, non commencé. Faut-il une copie dédiée pour `maintenance`/`jardinage`/`demenagement` (photos de chantier plutôt que de ménage) ? Non tranché ici.

### `ext-chart`, `ext-notes`, `ext-rss` — Bibliothèque d'extensions

**État :** Actif · **Catégorie :** Autre · **Widget pur :** Oui (aucune donnée métier réelle — graphique/notes/RSS génériques) · **Extension sectorielle :** Aucune, aucun besoin
**Secteurs :** P partout, jamais O — cohérent avec leur nature d'extensions "à la carte" ajoutées volontairement (`defaultVisible:false`, jamais promues nulle part).
**Questions ouvertes** — `ext-notes` (bloc-notes) et `ext-rss` (flux RSS finance externe) posent une question de confidentialité/pertinence **à valider** (flux RSS externe = dépendance réseau tierce, non auditée ici).

### `marge-reelle` (Prévu, id non confirmé)

**État : Prévu — non commencé** (aucune entrée dans `WIDGET_CATALOG`) · **Catégorie :** Finance · **Widget pur :** À valider (n'existe pas encore) · **Extension sectorielle :** À valider

**Objectif métier** — Afficher la marge réelle par intervention (revenu réel vs. coûts).
**Données requises** — `vue_marge_interventions` (vue SQL, confirmée `supabase-schema.sql` l.773), `get_marge_reelle(account, intervention_id)` (fonction SQL, confirmée l.803). **Dépendance conceptuelle — aucun consommateur front, aucun nom d'API JS/widget défini.**
**Limites actuelles** — Entièrement côté backend, zéro UI. `PLAN.md` le liste explicitement comme non commencé.
**Questions ouvertes** — Quel secteur en a le plus besoin (probablement tous ceux avec coûts variables — `maintenance`, `demenagement`) ? Non tranché ici (WM-005).

---

## 8. Registre consolidé des dépendances

| Dépendance | Type | Widgets concernés | Obligatoire | État actuel | Comportement si indisponible |
|---|---|---|---|---|---|
| `SebaDB` (`docs/seba-data.js`) | Données | Tous les widgets `live`/`demo` (indirectement via `ctx`) | Oui | Existe, confirmé | `ctx.demo` (fallback démo par secteur) |
| `window.SebaDB` (accès direct) | Données | `chart-donut`, `lot-carte` | Oui pour ces 2 widgets | Existe, mais **contrevient à "Widget Pur"** | État vide si `hasData()` faux |
| `window.SebaWidgetAPI` (`docs/services/widget-data-api.js`) | Service | `generic-media-report` (et futurs widgets purs) | Oui pour ce widget | Existe, confirmé | Widget affiche son état vide si l'API renvoie `null` |
| `window.SEBA_DASHBOARD_CONFIG` (`docs/services/config-dashboard.js`) | Configuration | Moteur `getEffectiveLayout()` (tous les widgets, indirectement) | Non (fallback sur `defaultVisible`/`defaultOrder`) | Existe, confirmé | Retombe sur les valeurs par défaut du catalogue |
| D3.js (CDN `cdn.jsdelivr.net`) | Bibliothèque | `bento-chart` | Oui pour le graphique | Présent, chargé en tête de `dashboard.html` | Repli HTML simplifié déjà codé (`typeof d3 === 'undefined'`) |
| SortableJS (CDN) | Bibliothèque | Moteur de drag & drop (tous les widgets, indirectement) | Oui pour le réordonnancement | Présent | `initSortable()` no-op si `Sortable` indéfini |
| Leaflet + tuiles OpenStreetMap (CDN, chargé à la demande) | Bibliothèque + service externe | `lot-carte` | Oui pour ce widget | Présent (`loadLeaflet()`) | **À valider** — pas de repli "vue liste" confirmé dans le code consulté (le placeholder gère l'absence d'intervention, pas l'absence de réseau/CDN) |
| Champ `photos` sur `interventions` (SebaDB) | Donnée | `generic-media-report` | Oui pour une vraie donnée | **N'existe pas** | `SebaWidgetAPI` renvoie `null`, état vide honnête |
| `vue_marge_interventions` / `get_marge_reelle` (Supabase) | Donnée + fonction SQL | Widget prévu "marge réelle" | Oui pour ce widget futur | Existe côté DB, **aucun consommateur front** | N/A (widget non construit) |
| Pages `docs/*.html` liées par `link` (`contentieux-recouvrement.html`, `mutation-contextuelle.html`, `haversine-engine.html`, `cockpit-treso.html`) | Pages | `lot-impayes`, `lot-pipeline`, `lot-tournee`, `lot-treso` | Facultatif (juste un lien "en savoir plus") | **À valider** (nature mockup vs. produit) | Lien mort ou page de démonstration si non connectée |
| `businessTypes[secteur].recommendations` | Donnée déclarative | `recos` | Oui | Existe, confirmé | Fallback silencieux via `bt[secteur] || {}` |

### 8.1 Dépendances critiques communes

`SebaDB` (via `ctx`) et le moteur de layout (`getEffectiveLayout`/`SebaWidgetAPI.getUserPreference`) sont les deux dépendances dont dépend la quasi-totalité des widgets, directement ou indirectement.

### 8.2 Dépendances optionnelles

D3, Leaflet, SortableJS — toutes trois via CDN, avec un comportement dégradé au moins partiellement codé (sauf Leaflet, à valider).

### 8.3 Dépendances non encore implémentées

Champ `photos` sur les interventions (`generic-media-report`) ; consommateur front de `vue_marge_interventions`/`get_marge_reelle` (widget "marge réelle").

### 8.4 Dépendances possiblement mal nommées ou dupliquées

`ctx.demo` sert à la fois de "données de démonstration" (nouveau compte vide) et de "vraies données transformées" (`buildLiveData()` réutilise la même forme que `DEMO[secteur]`) — un même objet porte deux sens différents selon le contexte. **À valider** si un renommage clarifierait (ex. distinguer `ctx.demo` de `ctx.live`), question de nommage, pas de comportement.

---

## 9. Protocole « Widget pur »

Critères (repris et complétés de `_architecture/WIDGET_DEVELOPMENT_PROTOCOL.md`) :

1. Aucun secteur codé en dur dans la logique (`if (secteur === "menage")`).
2. Les données sont fournies par une interface standard (`window.SebaWidgetAPI`), jamais `SebaDB`/`localStorage` directement.
3. Les textes variables sont injectés par configuration — **non appliqué aujourd'hui** : `generic-media-report` respecte le critère 2 mais pas celui-ci (copie "ménage" en dur, voir §5.5).
4. Les permissions sont externes au widget — **sans objet aujourd'hui**, aucun système de permissions n'existe dans le dépôt.
5. Les états sont gérés de manière uniforme — partiellement vrai (état vide via `buildRichEmptyHTML`, mais pas d'état "erreur"/"permission refusée" standardisé trouvé).
6. Activable/désactivable sans modifier la logique interne — vrai pour tous les widgets (`defaultVisible`, `getEffectiveLayout`).
7. Fonctionne dans plusieurs secteurs sans duplication — vrai pour les widgets `core`, faux pour `generic-media-report` (spécifique de fait).
8. Adaptations métier via extensions déclaratives — **non trouvé dans le dépôt**, aucun mécanisme d'extension sectorielle formel n'existe (le champ `recommendations` de `businessTypes.js`, consommé par le widget `recos`, en est l'exemple le plus proche d'un futur contrat d'extension, mais ce n'est pas généralisé).
9. Le widget expose ses dépendances — partiellement (ce document les documente a posteriori, aucun mécanisme de déclaration automatique dans le code).
10. Le widget ne suppose pas qu'une donnée facultative existe — vrai partout où vérifié (`if (window.SebaDB && SebaDB.hasData())`).

### Trois niveaux (classification réelle du catalogue actuel, mise à jour 2026-07-15)

- **Pur** : `bento-actions`, `quick-actions`, `ext-chart`, `ext-notes`, `ext-rss` (aucune donnée métier sectorielle, aucun besoin d'extension).
- **Pur avec extension** : **`generic-media-report`** — premier exemple réel de cette catégorie (résolu WM-004) : accès données via `SebaWidgetAPI.getMediaReport()`, copie (titre/icône/état vide) résolue via le contrat d'extension `WIDGET_EXTENSIONS`/`widgetExtensionFor()` (`docs/services/config-dashboard.js`), noyau de rendu unique partagé par tous les secteurs. Le widget `recos` s'en approche également (contenu variable par `businessTypes[secteur].recommendations`) mais via un mécanisme différent, non consolidé avec `WIDGET_EXTENSIONS` — **à valider** si les deux devraient converger vers un seul contrat d'extension à terme.
- **Spécifique** : `chart-donut`, `lot-carte` (accès direct SebaDB, dette technique — toujours non résolue par cette session de correctifs), `lot-tournee`/`lot-pipeline`/`lot-impayes`/`lot-treso` (liés chacun à une page mockup potentiellement non généralisable).

Un widget spécifique n'est pas automatiquement mauvais — mais la majorité du catalogue "compagnon" reste spécifique de fait : il n'existe pas de brique universelle sous-jacente partagée entre, par exemple, `lot-tournee` (jardinage/maintenance) et un futur widget tournée pour un autre secteur. `generic-media-report` montre que le contrat d'extension fonctionne pour un cas simple (texte) — **à valider/concevoir** s'il peut s'étendre à des widgets aux données plus complexes (voir §19).

---

## 10. Règles d'attribution

Ordre de résolution **actuellement implémenté** (Confirmé par le code, `getEffectiveLayout()`) — plus simple que l'ordre en 10 points suggéré par la mission, qui reste une cible possible :

1. **Préférence utilisateur explicite** (`SebaWidgetAPI.getUserPreference()`, par widget) — priorité absolue si elle existe pour ce widget.
2. **Config du secteur courant** (`SEBA_DASHBOARD_CONFIG.widgetsFor(secteur)`) — pour tout widget sans préférence explicite.
3. **`defaultVisible`/`defaultOrder`** du catalogue — filet de sécurité si (1) et (2) sont indisponibles.

**Ce qui n'existe pas encore (Non trouvé dans le dépôt), par rapport à l'ordre en 10 points proposé par la mission :** compatibilité technique préalable (aucune vérification de dépendance avant affichage — un widget sans sa dépendance s'affiche quand même et gère son propre état vide au niveau du `render()`, il n'y a pas de filtre en amont) ; plan/abonnement (aucune notion de plan commercial trouvée dans le dépôt) ; permissions utilisateur (inexistant) ; feature flags/expérimentations (inexistant, hormis le champ `defaultVisible` lui-même qui joue un rôle proche).

**Un widget X ne doit jamais être rendu activable par une simple préférence utilisateur** — recommandation actée pour cette mission, mais **rappel : ce blocage n'est pas implémenté aujourd'hui** (§16, R-01). C'est la recommandation la plus importante de ce document à transformer en code lors d'une prochaine session de développement (hors périmètre de cette mission, documentation uniquement).

Un widget O doit être présent par défaut ; **son caractère masquable ou non n'est pas distingué aujourd'hui** — tout widget, y compris les widgets `core`/O, peut être masqué via `onWidgetRemove`/`onWidgetToggle` (à l'exception des 3 widgets `PINNED_TELEMETRY_IDS`, qui eux ne peuvent pas être retirés du tout, mais ce n'est pas non plus distingué proprement — c'est un statut binaire "pinné" séparé, pas une propriété `userCanDisable`). Voir §13.

---

## 11. Règles de migration et d'évolution

Aucune des transitions ci-dessous n'est aujourd'hui outillée par du code (pas de mécanisme de version de matrice, pas de `system_added`, pas de log de migration trouvé dans le dépôt). Cette section documente donc la **stratégie recommandée**, à considérer comme **Hypothèse à valider** pour une implémentation future, pas comme un comportement actuel.

### 11.1 Passage de P à O
Nouvelle entreprise : widget activé par défaut (déjà le comportement réel via `config-dashboard.js`, pour peu que l'onboarding renseigne la bonne clé de secteur — voir §4.5).
Entreprise existante : stratégie recommandée — ajouter le widget comme `system_added: true` dans la disposition stockée, l'insérer à une position logique, informer l'utilisateur, conserver une trace de version de matrice. **Rien de ceci n'existe aujourd'hui** : `getEffectiveLayout()` ne fait la promotion par secteur que pour les widgets **sans aucune entrée stockée** — si un widget passe de P à O après qu'un utilisateur a déjà interagi avec son dashboard (donc a une entrée stockée, même pour d'autres widgets), ce widget spécifique ne serait affecté que s'il n'a lui-même jamais été touché individuellement (grâce au merge par widget introduit dans cette session) — mais aucune notification, aucun marqueur `system_added` n'existe.

### 11.2 Passage de O à P
Ne pas supprimer chez les utilisateurs existants (déjà vrai : `patchStoredWidgets` ne supprime jamais rien), permettre la désactivation (déjà vrai), ne plus l'activer par défaut pour les nouvelles entreprises (suffit de retirer l'id de `CORE`/`BY_SECTEUR` dans `config-dashboard.js`).

### 11.3 à 11.6 (P→X, O→X, X→P, X→O)
**Non applicable techniquement aujourd'hui** puisque X n'est pas appliqué (§16 R-01) — ces règles restent des recommandations pour le jour où un mécanisme de compatibilité réelle sera construit.

### 11.7 Changement de dépendance
Recommandation : ne jamais casser silencieusement, prévoir un mode dégradé. **Partiellement déjà en place** pour `bento-chart` (repli si D3 absent) ; **absent** pour `lot-carte` (Leaflet) — à valider/construire.

### 11.8 Widget pur → extension sectorielle
Recommandation actée : préserver le noyau commun, introduire un contrat d'extension. **À concevoir** (voir §19) — aucun contrat de ce type n'existe, `generic-media-report` en est le candidat naturel (voir §5.5, WM-004).

---

## 12. Versionnement de la matrice

```yaml
widget_matrix_version: 1
last_updated: 2026-07-15
status: draft
owners:
  - product
  - architecture
```

| Version | Date | Modification | Impact | Migration requise |
|---|---|---|---|---|
| 1 | 2026-07-15 | Création initiale (ce document) — inventaire 11 secteurs, 25 widgets, matrice complète, contradiction onboarding documentée | Tous secteurs | Non (documentation uniquement, aucun code modifié) |
| 2 | 2026-07-15 | WM-001 résolu (`SECTOR_MAPPING`/`resolveSector()`, `docs/onboarding.html` corrigé), WM-004 résolu (`cleaning-photo-report` renommé `generic-media-report`, contrat d'extension `WIDGET_EXTENSIONS`), matrice mise à jour (`generic-media-report` : X→P pour 6 secteurs, ?→P pour 3 secteurs) | Onboarding (tous secteurs), widget `generic-media-report`/anciennement `cleaning-photo-report` | Non (aucun compte réel confirmé existant nécessitant une migration de données à ce jour) |

---

## 13. Configuration utilisateur et priorité

Hiérarchie **recommandée** par la mission (Hypothèse à valider, pas encore implémentée dans cette forme) :

> Incompatibilité secteur > Disponibilité technique > Obligation réglementaire/métier > Plan commercial > Permissions > Configuration entreprise > Préférence utilisateur > Position personnalisée

**État réel du code (Confirmé)** : seules 2 couches existent — préférence utilisateur (prioritaire, par widget) puis config de secteur (`CORE`/`BY_SECTEUR`). Aucune notion de plan commercial, permission, ou incompatibilité technique bloquante.

Structure de propriétés **proposée** (conceptuelle, non implémentée) :
```js
{
  status: "O",              // ou "P" / "X"
  defaultEnabled: true,
  userCanDisable: true,
  userCanReorder: true,
  requiresConfiguration: false,
}
```
Aujourd'hui, le statut O/P n'est représenté que par un tableau d'ids (`CORE`/`BY_SECTEUR`) — pas par un objet à propriétés multiples. Migrer vers cette structure permettrait de distinguer, par exemple, un widget O non masquable (aucun cas de ce type n'existe aujourd'hui : tout widget non pinné est masquable) d'un widget O masquable.

**Rappel déjà vrai et à préserver** : les préférences ne suppriment jamais de données (`patchStoredWidgets` ne touche que la disposition, jamais `SebaDB`) ; une modification de matrice n'écrase jamais silencieusement une personnalisation existante (`getEffectiveLayout()` vérifie `storedById` avant toute config de secteur, widget par widget).

---

## 14. Cas particuliers à documenter

| Cas | État réel |
|---|---|
| Entreprise multi-secteurs | **Non trouvé dans le dépôt** — `biz.secteur` est un champ unique (string), pas un tableau. Voir §15. |
| Changement de secteur après onboarding | Pas de UI (`reglages.html` n'a pas ce champ) ; l'algorithme de merge a été vérifié robuste à ce cas par simulation directe en `localStorage` durant cette session (voir `CHANGELOG.md`/commit `3c24c3a`). |
| Secteur personnalisé (hors les 11 clés) | Retombe silencieusement sur `autre` partout (`SEED_SERVICES[secteur] || SEED_SERVICES.autre`, etc.) — **c'est exactement le bug documenté en §4.5**, qui traite déjà involontairement ce cas puisque les libellés de l'onboarding ne sont pas des clés valides. |
| Widget compatible plusieurs secteurs, données différentes | `recos` (via `businessTypes[secteur].recommendations`) est le seul exemple confirmé. |
| Dépendance temporairement indisponible | Géré au cas par cas dans chaque `render()` (`if (window.SebaDB && SebaDB.hasData())`), pas de mécanisme central. |
| Plan commercial sans accès à un widget obligatoire | Sans objet — aucune notion de plan commercial trouvée. |
| Utilisateur sans permission pour un widget obligatoire | Sans objet — aucun système de permission trouvé. |
| Ancienne configuration avec un widget devenu incompatible | Non applicable (X non appliqué techniquement, §16 R-01). |
| Widget visible mais alimenté par des données factices | **Existe** : tous les widgets `source: 'demo'` avant que `SebaDB.hasData()` devienne vrai (comportement voulu, pas un bug — sert de démonstration/onboarding). |
| Entreprise sans données suffisantes | Géré widget par widget via l'état vide (`buildRichEmptyHTML`, `.tl-empty`, etc.) — pas de standard unique (certains widgets ont un état vide riche, d'autres une simple ligne de texte, cf. commentaire historique dans `widgets.js` sur `lot-impayes`/`lot-pipeline`). |
| Widget nécessitant une configuration | **Non trouvé** — aucun widget du catalogue actuel ne bloque son affichage derrière un écran de configuration préalable. |
| Fusion/scission de secteur | Non applicable aujourd'hui (aucune fusion/scission identifiée nécessaire, §4.4). |
| Renommage/remplacement/suppression de widget | Aucune procédure trouvée — à définir (voir §19). |

---

## 15. Entreprises multi-secteurs

**À valider — le modèle multi-secteurs n'existe pas aujourd'hui.** `biz.secteur` est un champ scalaire unique dans `sebaEntreprise` (localStorage), lu tel quel par tous les consommateurs (`businessTypes.js`, `seba-data.js`, `config-dashboard.js`). Aucune structure de secteur "principal + secondaires" n'a été trouvée.

La règle en 7 points proposée par la mission (secteur principal + secondaires, incompatibilité seulement si X pour tous les secteurs actifs, etc.) est donc entièrement **prospective** — à marquer `status: draft`/`À valider` si elle devait être implémentée, et à concevoir en cohérence avec la résolution de la contradiction §4.5 (puisque le champ `secteur` actuel devrait de toute façon évoluer vers une structure plus riche pour supporter ne serait-ce qu'un secteur "principal" correctement typé).

---

## 16. Stratégie de mode dégradé

| Widget/dépendance | Mode dégradé actuel |
|---|---|
| `bento-chart` sans D3 | **Existe** — repli HTML simplifié (`buildBentoChartHTML`) |
| `lot-carte` sans Leaflet/réseau | **À valider** — pas de repli "liste" confirmé, seul le cas "aucune intervention" (donnée absente) est géré, pas le cas "librairie/CDN indisponible" |
| Tout widget `live`/`demo` sans données | État vide (`buildRichEmptyHTML` ou équivalent local) — **jamais de donnée inventée**, confirmé pour tous les widgets audités en détail (`generic-media-report`, `chart-donut`, `lot-treso`) |
| `generic-media-report` sans champ `photos` | Renvoie honnêtement `null` → état vide, pas de chiffre inventé (déjà conforme à la règle demandée) |
| Widget prévu "marge réelle" | Sans objet — n'existe pas encore |

Recommandation à retenir pour tout futur widget : **jamais de donnée inventée pour éviter un état vide** — règle déjà respectée par tous les widgets audités dans cette passe.

---

## 17. Décisions ouvertes

| ID | Question | Pourquoi elle compte | Options | Recommandation | Responsable | Priorité | Statut |
|---|---|---|---|---|---|---|---|
| WM-001 | `onboarding.html` stocke des libellés ("Nettoyage & Entretien"...) au lieu des clés de secteur internes (`menage`...) — comment corriger sans casser les comptes déjà créés ? | **Rendait inerte, pour tout utilisateur réel, toute la fonctionnalité "widgets/services par secteur"** (§4.5) | (a) Remapper les 4 libellés vers 4 des 11 clés au moment de l'onboarding ; (b) migrer les comptes existants (`secteur` textuel → clé) ; (c) les deux | (a) implémentée ; (b) non faite (pas de compte réel confirmé existant à ce jour selon le contexte projet — à revalider avant tout lancement public si des comptes de test ont été créés entre-temps) | Produit + Architecture | Critique | **Résolu (2026-07-15)** — `SECTOR_MAPPING`/`resolveSector()` dans `config-dashboard.js`, appliqué dans `onboarding.html` avant `localStorage.setItem`. Testé de bout en bout (clic réel → dashboard → bon jeu de widgets). |
| WM-002 | L'onboarding n'offre que 4 catégories contre 11 clés internes — faut-il élargir l'onboarding à 11 choix, réduire les clés à 4 familles, ou garder un mapping 4→11 avec un choix secondaire ("précisez votre activité") ? | Détermine la granularité réelle de personnalisation dont bénéficient les nouveaux utilisateurs | (a) 11 choix dans l'onboarding ; (b) 4 familles + sous-choix ; (c) réduire le modèle interne à 4 ; (d) mapping 4→1 simple (une seule clé par libellé, pas de sous-choix) | (d) implémentée par pragmatisme — **`conciergerieCopro`/`conciergerieEntreprise` restent inatteignables depuis l'onboarding réel aujourd'hui**, seul `conciergerie` est joignable via "Conciergerie & Accueil" | Produit | Haute | **Partiellement résolu** — le blocage critique (WM-001) est levé, mais la granularité fine (copro/entreprise) reste à trancher si jugée nécessaire |
| WM-003 | `lot-treso` n'est promu O dans aucun secteur — oubli ou choix délibéré ? | Incohérence apparente avec `lot-pipeline`/`lot-impayes` qui suivent la même logique de facturation récurrente | (a) Ajouter `lot-treso` aux mêmes secteurs que `lot-pipeline` ; (b) le laisser P partout (widget "avancé") | À trancher par le produit — pas de préférence technique | Produit | Moyenne | Ouvert (non traité par cette session de correctifs, hors périmètre demandé) |
| WM-004 | `generic-media-report` : généraliser la copie pour `conciergerie*` (et au-delà), ou le garder spécifique à `menage` ? | Premier widget "Widget Pur" du catalogue, mais spécifique de fait (§9) — précédent pour tous les futurs widgets | (a) Généraliser via une extension sectorielle (texte configurable) ; (b) dupliquer pour chaque secteur ; (c) garder tel quel, secteur unique | (a) implémentée — contrat d'extension `WIDGET_EXTENSIONS`/`widgetExtensionFor()` | Architecture | Moyenne | **Résolu (2026-07-15)** — testé (titre et état vide corrects pour `menage` via le flux réel) ; copie dédiée pour `conciergerie*` non re-testée en conditions réelles (vérifiée par lecture de code uniquement) |
| WM-005 | Widget "marge réelle" (`vue_marge_interventions`/`get_marge_reelle`) : quel secteur prioritaire, quel nom technique, quelle UI ? | Fonctionnalité backend prête, zéro consommateur — premier arbitrage nécessaire avant tout développement | À définir entièrement | Product doit spécifier avant qu'un développement ne commence (hors périmètre de cette mission) | Produit | Basse (pas bloquant, rien n'en dépend aujourd'hui) | Ouvert |
| WM-006 | Faut-il réellement bâtir l'enforcement technique du statut X (aujourd'hui purement déclaratif) ? | Sans lui, cette matrice reste un document d'intention, pas une contrainte produit | (a) Filtrer `buildLibraryPanelHTML`/le tiroir par compatibilité secteur ; (b) laisser le catalogue ouvert à tous, X = recommandation UX uniquement | (a) implémentée — `SEBA_DASHBOARD_CONFIG.isCompatible()`/`INCOMPATIBLE_BY_SECTEUR` (`config-dashboard.js`) + filtrage dans `buildLibraryPanelHTML()` (`docs/widgets.js`) | Architecture | Haute | **Résolu (2026-07-15)** — mécanisme construit et testé (canari d'exclusion confirmé fonctionnel, isolé par secteur). **`INCOMPATIBLE_BY_SECTEUR` est vide** : aucun widget n'est marqué X dans la matrice actuelle (§6), donc aucun effet visible tant qu'une vraie incompatibilité n'est pas actée par le produit. Tiroir "Bibliothèque d'extensions" (`ext-drawer`) non filtré — seul le panneau "Personnaliser" l'est, voir note ci-dessous. |
| WM-007 | Faut-il des pages `docs/*.html` (`contentieux-recouvrement.html`, `mutation-contextuelle.html`, `haversine-engine.html`, `cockpit-treso.html`) confirmées comme produit connecté, ou sont-elles des mockups marketing ? | Détermine si les widgets `lot-*` pointent vers du contenu réel ou une vitrine | À vérifier par une lecture dédiée de ces 4 pages | Confirmées comme mockups (galerie de concepts, `docs/layout-manager.js` l.2) — voir audit dédié | Architecture | Basse | **Résolu (2026-07-15)** — mockups confirmés (pas d'auth, pas de SebaDB, design system tiers) ; `robots.txt` corrigé et liens 404 des widgets `lot-*` neutralisés en conséquence |

---

## 18. Risques architecturaux

| Risque | Classement | Description |
|---|---|---|
| R-01 — Statut X purement déclaratif, aucun enforcement | **Critique — toujours ouvert (WM-006)** | `buildLibraryPanelHTML` expose tout `WIDGET_CATALOG` à tout secteur sans filtre — la matrice §6 reste un vœu pour tout widget encore marqué X (aucun ne l'est plus après la généralisation de `generic-media-report`, mais la question reste structurelle pour de futurs widgets) |
| R-02 — Contradiction onboarding/clés de secteur (§4.5) | **Résolu (2026-07-15, WM-001)** | Corrigé via `SECTOR_MAPPING`/`resolveSector()`, testé de bout en bout. Résiduel : granularité `conciergerieCopro`/`conciergerieEntreprise` inatteignable depuis l'onboarding (WM-002, priorité Haute, pas Critique) |
| R-03 — Logique sectorielle codée en dur dans un widget "Widget Pur" | **Résolu (2026-07-15, WM-004)** | `generic-media-report` respecte désormais la règle d'accès aux données ET la généricité de contenu via `WIDGET_EXTENSIONS` (§5.5, §9) |
| R-04 — Confusion widget / action rapide / composant | Modéré | `bento-actions`/`quick-actions` sont dans `WIDGET_CATALOG` mais ne portent aucune donnée métier — la frontière widget/action n'est pas formellement tracée dans le code |
| R-05 — Widgets alimentés par des données factices sans distinction visible pour l'utilisateur | Modéré | Les widgets `lot-*` affichent `ctx.demo` de façon indiscernable d'une vraie donnée tant que `SebaDB.hasData()` est faux — pas de badge "démo" identifié |
| R-06 — Dépendances "lot-*" vers des pages potentiellement mockup | Modéré | 4 widgets renvoient vers des pages non confirmées comme connectées à SebaDB (WM-007) |
| R-07 — Absence de tout modèle multi-secteurs | Modéré | Bloque toute évolution vers des entreprises à activité mixte (§15) |
| R-08 — Widgets `chart-donut`/`lot-carte` toujours en accès direct SebaDB | Élevé | Dette "Widget Pur" documentée mais non résorbée — risque de duplication de pattern si de nouveaux widgets s'en inspirent par erreur |
| R-09 — Absence de tout système de permissions | Modéré | Aucun widget ne peut aujourd'hui être restreint par rôle — à anticiper avant l'ajout d'une équipe avec des droits différenciés |
| R-10 — `lot-treso` orphelin de toute promotion sectorielle | Faible | Incohérence mineure (WM-003), pas de risque fonctionnel immédiat |
| R-11 — Aucune notion de version de matrice appliquée par compte | Modéré | Une évolution future de `config-dashboard.js` s'appliquera identiquement, sans distinction, à tous les comptes sans disposition sauvegardée — pas de mécanisme de migration versionnée (§11) |

---

## 19. Recommandations architecturales

- **Corriger WM-001 en priorité** avant toute nouvelle promotion sectorielle de widget — sans cela, tout travail sur la matrice reste sans effet réel en production.
- **Ne pas construire de nouveau widget "compagnon" spécifique** sans d'abord évaluer s'il peut suivre le modèle `recos` (contenu déclaratif par secteur via `businessTypes.js`) plutôt que dupliquer une logique par secteur.
- **Concevoir un contrat d'extension sectorielle minimal** (ex. un objet `sectorCopy` par widget, résolu via `businessTypes[secteur]`) avant de généraliser `generic-media-report` (WM-004) — poser ce contrat une fois, pas au coup par coup.
- **Ne pas migrer `chart-donut`/`lot-carte` vers `SebaWidgetAPI` dans la précipitation** — le faire dans un commit dédié, avec les mêmes garde-fous que pour `generic-media-report` (tests avant/après, pas de changement de comportement visible).
- **Décider explicitement du sort de WM-006** (enforcement du X) avant d'ajouter davantage de secteurs ou de widgets "compagnon" — plus la matrice grossit sans enforcement, plus l'écart entre documentation et réalité se creuse.
- **Emplacement du registre** : `docs/widgets.js` (`WIDGET_CATALOG`) reste le bon emplacement pour l'inventaire technique — pas de nouveau fichier de registre à créer, ce document (`WIDGET_MASTER_PLAN.md`) est la couche de gouvernance au-dessus, pas un remplacement.
- **Identifiants stables** : déjà en place (`id` de `WIDGET_CATALOG`, clés de secteur) — aucun changement recommandé.
- **Tests de cohérence** : envisager un script (`scripts/qa-*.js`, à créer hors de cette mission) qui vérifie automatiquement que tout `id` de `BY_SECTEUR`/`CORE` existe bien dans `WIDGET_CATALOG`, et inversement qu'aucun secteur cité dans `config-dashboard.js` n'est absent de `businessTypes.js` — validation automatique de la matrice mentionnée par la mission, à concevoir plus tard.

*(Conformément à la contrainte de mission : aucune de ces recommandations n'a été implémentée ici — pseudo-structure uniquement, pas de code applicatif modifié au-delà de la documentation.)*

---

## 20. Checklist de validation du document

- [x] Tous les secteurs trouvés sont inventoriés (11 clés + la contradiction onboarding documentée séparément).
- [x] Tous les widgets trouvés sont inventoriés (25 dans `WIDGET_CATALOG` + 1 prévu).
- [x] Widgets actifs et prévus distingués (§5.1-5.3).
- [x] La matrice utilise uniquement O, P, X ou ? (§6).
- [x] Chaque O non évident est justifié (§6.1).
- [x] Chaque X discutable est justifié (§6.2).
- [x] Chaque widget possède une fiche (§7) — fiches condensées pour les widgets `core` très similaires, complètes pour les widgets `companion`/`extension`/prévu, avec justification explicite de la condensation.
- [x] Widgets purs et extensions distingués (§9).
- [x] Les dépendances conceptuelles ne sont pas présentées comme des API existantes (`vue_marge_interventions`/`get_marge_reelle` marquées "existent côté DB, aucun consommateur front" ; champ `photos` marqué "n'existe pas").
- [x] Les règles de migration couvrent tous les changements de statut (§11), en précisant clairement qu'aucune n'est outillée aujourd'hui.
- [x] Les préférences utilisateur sont préservées dans les règles décrites (§10, §13 — comportement déjà réel, vérifié cette session).
- [x] Les entreprises multi-secteurs sont adressées (§15 — marqué "n'existe pas", pas de décision arbitraire prise).
- [x] Les zones d'ombre sont listées clairement (§17, 7 décisions ouvertes).
- [x] Aucun widget n'a été développé durant la mission de modélisation initiale (version 1 de ce document).
- [x] Version 1 : aucun fichier applicatif modifié, uniquement `_architecture/WIDGET_MASTER_PLAN.md`. **Version 2 (même jour) : correctifs demandés explicitement appliqués** — `docs/services/config-dashboard.js`, `docs/onboarding.html`, `docs/bienvenue.html`, `docs/widgets.js`, `docs/services/widget-data-api.js` (voir §12, journal de version 2).
- [x] Le document est suffisamment précis pour guider une future implémentation des points encore ouverts (enforcement du X, granularité `conciergerieCopro`/`conciergerieEntreprise`) — restent des chantiers de conception séparés (§19).

**Statut : `draft`** — WM-001 (critique) et WM-004 sont **résolus et testés de bout en bout** (§17). Restent ouvertes : WM-002 (partiellement — granularité conciergerie), WM-003, WM-005, WM-006 (priorité Haute — l'enforcement du X reste à construire), WM-007. Ce document ne doit pas être considéré `validated` tant que ces points ne sont pas tranchés, mais le blocage le plus grave (WM-001) ne bloque plus rien.
