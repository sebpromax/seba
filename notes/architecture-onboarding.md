# Architecture — onboarding.html

## Vue d'ensemble

`onboarding.html` est la page d'accueil de configuration d'entreprise Seba. Elle guide l'utilisateur en 10 étapes (steps 0–9) pour créer son espace professionnel. Le côté gauche contient les formulaires, le côté droit affiche un globe D3 interactif (étapes 0–1) puis un téléphone preview (étapes 2+).

---

## Globe D3.js (IIFE — lignes ~778–900)

### Bibliothèques
- **D3.js v7** — `d3.geoOrthographic`, `d3.geoPath`, `d3.geoGraticule`, `d3.drag`, `d3.timer`, `d3.interpolate`, `d3.easeCubicInOut`
- **TopoJSON Client v3** — `topojson.feature`
- **Données** — `world-atlas@2/countries-110m.json` (CDN, ~100 Ko)

### Projection
Orthographique, scale=210, translate=[225,225], clipAngle=90. Rendu dans `<svg id="globe-canvas" width="450" height="450">`.

### Couches SVG (ordre de rendu)
1. `<circle>` — fond océan `#091524`
2. `<path>` graticule — lignes lat/lng, couleur `#1a3050`, opacity 0.5, stroke-width 0.35
3. `<g>` continents — 250 pays, fill `#1e293b`, stroke `#263a5a`, stroke-width 0.4
4. `<circle>` outline — contour globe `#1c2d50`
5. `<circle fill="url(#atm)">` — atmosphère : limb-darkening radial, transparent jusqu'à 64%, sombre aux bords
6. `<circle fill="url(#spec)">` — reflet spéculaire haut-gauche (cx=34%, cy=27%), luminosité subtile
7. `<defs><filter id="glow">` — lueur verte `#05F29A`, feGaussianBlur stdDeviation=8

### Globe panel HTML
```html
<div class="ob-globe-panel" id="ob-globe-panel">
  <div class="globe-wrap" id="globe-wrap">
    <svg id="globe-canvas" width="450" height="450">…</svg>
  </div>
</div>
```
La légende textuelle `"Sélectionnez votre pays"` a été supprimée — le globe respire seul au centre de son dégradé radial.

### Fond du panneau droit `.ob-right`
- `background: radial-gradient(ellipse at 50% 48%, #111a2e 0%, #060913 72%)` — studio dark, sans quadrillage
- `::before` — halo ambiant 560×560 px, vert `rgba(0,245,160,0.065)`, centré sur le globe

### Step-0 — Centrage absolu du contenu gauche
Le bloc `.welcome-wrap` (titre, sous-texte, bouton) est centré verticalement **et** horizontalement dans la colonne gauche via des règles CSS ciblées sur `#step-0` uniquement :
```css
#step-0 { justify-content: center; padding-top: 40px; padding-bottom: 40px; }
#step-0 .welcome-wrap { align-items: center; text-align: center; }
```
Les étapes suivantes (`#step-1` … `#step-9`) conservent leur alignement gauche natif et le `padding-top: 96px` d'origine.

### État 1 — Bienvenue (step-0)
- `autoSpin=true`, rotation Y automatique (+0.08°/frame via RAF, vitesse premium lente)
- `selCode=null`, tous les pays en `#1e293b`
- Drag libre : `d3.drag()` met `autoSpin=false` + `velX/velY=0` au début du drag
- **Inertie au relâchement** : `FRICTION=0.88`, décroissance exponentielle via `inertiaLoop()` RAF jusqu'à `|vel|<0.008`, puis `autoSpin=true` reprend en douceur

### État 2 — Sélection pays (step-1, `onPaysChange()`)
- `window.GlobeState2(code)` appelée depuis `updateGlobe(code)`
- `autoSpin=false`, `velX/velY=0` (pas de reprise auto-spin même après drag en État 2)
- Transition 980ms `d3.easeCubicInOut` via `d3.timer` : interpolation `[λ,φ]` courants → `[-lng, -lat, 0]` du pays
- Pays sélectionné : fill `#05F29A` + `filter:url(#glow)` (lueur verte étendue)

### Inertie drag (State 1 uniquement)
```
velX *= 0.88 (chaque frame)
velY *= 0.88
→ arrêt quand |velX|<0.008 && |velY|<0.008
→ autoSpin=true reprend le spinLoop naturellement
```
La fonction `inertiaLoop` vérifie `isDrag` pour s'auto-annuler si l'utilisateur reprend le drag pendant la phase de décélération.

### Correspondance pays → TopoJSON
Tableau `ISO_NUM` : codes ISO alpha-2 ↔ codes numériques ISO 3166-1 (clé `d.id` dans les features TopoJSON).
Les territoires ultramarins (RE, MQ, GP, GF, NC, PF) et Monaco peuvent ne pas apparaître comme polygones distincts à 110m mais le centrage fonctionne via leur lat/lng.

---

## Machine à états `_currentStep`

| Step | Contenu gauche | Panneau droit |
|------|---------------|---------------|
| 0 | Bienvenue | Globe plein format — État 1 (auto-spin lent) |
| 1 | Pays + téléphone | Globe plein format — État 2 (centrage pays + lueur verte) |
| 2–9 | Secteur, services, fiscal, identité… | Globe mini (coin sup. droit) + Bento dashboard |

`goStep(n)` gère les transitions CSS (translateX + opacity), `updatePhone(n)` bascule globe plein ↔ globe mini + bento.

### Globe mini (steps 2+)
La classe `.globe-mini` est ajoutée sur `#globe-wrap` via CSS transition 850ms cubic-bezier :
```css
.globe-wrap.globe-mini { transform: translate(50%,-45%) scale(0.35); opacity: 0.4; pointer-events: none; }
```
Le globe D3 continue de tourner et de pointer le pays sélectionné — il ne s'éteint jamais.

---

## Vitrine Premium (`#ob-preview-panel`) — steps 2–9

Remplace le bento dashboard (supprimé en 0.27). Glassmorphism card visible dès step 2.

### Structure HTML
```html
<div class="ob-preview-panel panel-hidden" id="ob-preview-panel">
  <div class="preview-card">
    <div id="pv-skeleton-state">…squelette animé…</div>
    <div id="pv-data-state" style="display:none;">
      <!-- Avatar · Titre · Niche · Badges (id="pv-rating", id="pv-avail") -->
      <!-- Services (id="pv-services") · Compétences (id="pv-tags") -->
      <!-- Zone (id="pv-zone") · Actions -->
    </div>
  </div>
</div>
```

### Logique d'affichage
- Steps 0–1 : `panel-hidden` (globe plein écran)
- Steps 2+ : `ob-globe-panel` opacity→0, `ob-preview-panel` visible
- Hover sur carte secteur → `updateSectorPreview(getDefaultJobForSector(key))`
- Sélection job via recherche → `updateSectorPreview(job)` + `S.selectedJobId=job.id`
- Step 4 (services cochés) → `updateLiveSvcPreview()` met à jour `pv-services` en temps réel
- Step 6 (identité) → `updatePreview()` met à jour `pv-title`, `pv-niche`, `pv-desc`, `pv-avatar-letter`

---

## Module de recherche "Autre activité" (Moteur Fuzzy)

Déclenché quand `key === 'autre'` dans `selectSector`. Séquence :
1. `selectSector` → `setTimeout(openSearch, 300)`
2. `openSearch()` : grid fade (`.hidden`), module search (`.active`), focus input
3. `filterSearch(q)` → `renderSearchResults(searchJobs(q), q)` — moteur fuzzy + Levenshtein
4. `pickJobFromSearch(job)` : `S.secteur='autre'`, `S.secteurCustom=job.label`, `S.selectedJobId=job.id`
5. `pickCustomSector(label)` : métier libre, `S.selectedJobId=null`
6. `closeSearch()` : revenir à la grille, reset `S.secteur=null`

### `JOB_INDEX[]` — 60+ métiers hiérarchisés
Champs : `id, sector, sl, label, niche, spec[], kw[], services[], competences[], desc, icon, zone, rating, reviews`
Couvre : artisans bâtiment, numérique/IA, santé, beauté, animaux, événementiel, mobilité, agriculture.

### `SEARCH_INDEX[]` — Index plat pour la recherche fuzzy
Construit par `buildSearchIndex()` au démarrage. Chaque entrée : `{job, text, weight}`.
Weights : label×3, niche×2, spec×2, kw×1.5, services×1, compétences×1.

### Algorithme de scoring (`levenshtein` + `fuzzyScore`)
```
Exact match     → weight × 10
Préfixe         → weight × 7
Inclusion       → weight × 5
Mot préfixe     → weight × 4
Mot inclusion   → weight × 3
Levenshtein ≤ 1 → weight × 2
Levenshtein = 2 → weight × 1
```
Temps < 100ms garanti sur SEARCH_INDEX ≤ 1200 entrées.

---

## Génération des prestations (Step 4)

### Logique de sélection du job source (`buildSvcList`)
```
S.selectedJobId défini → JOB_INDEX[selectedJobId].services[]
↓ sinon
SECTOR_DEFAULT_JOB[sector] → JOB_INDEX[id].services[]
↓ sinon
window.businessTypes[sector].services[] (fallback legacy)
```

### Règle d'injection
- **1 métier** : 4 premières prestations du job, **pré-cochées**, prix inférés par `inferSvcPrice()`
- **Futur multi-métiers** : `S.selectedJobs[]` (architecture prête) — mix 2 prestations phares par métier

### `inferSvcPrice(name, sector)` — inférence des prix suggérés
Matrice mots-clés → `{price, pt}` :

| Mot-clé détecté | Prix | Type |
|-----------------|------|------|
| urgence / express | 120 € | forfait |
| installation / création / pose | 280 € | forfait |
| maintenance / entretien | 80 € | forfait |
| coaching / formation | 75 € | heure |
| audit / bilan | 150 € | forfait |
| massage / soin / séance | 65 € | forfait |
| Défaut secteur (menage) | 25 € | heure |

---

## Système Horaires Hybrides (Step 4)

### `S.horaires` — structure
```js
{
  modes: ['classique', 'urgence'],   // multi-select
  jours: ['lun','mar','mer','jeu','ven'],
  debut: '08:00',
  fin: '18:00',
  urgences24h: true                  // flag fusion
}
```

### Logique multi-select (`pickHoraires`)
- Chaque clic **toggle** le preset (ajout ou retrait du tableau `modes`)
- Les jours sont **fusionnés** (union) de tous les modes actifs (hors 'urgence')
- Les plages horaires fusionnent : `debut = min(...)`, `fin = max(...)`
- `urgences24h` = `modes.includes('urgence')`

### Badge de disponibilité (`updateHorairesPreviewBadge`)
| Modes actifs | Badge affiché |
|--------------|---------------|
| classique seul | 🟢 Disponible · 08h–18h · 5j/7 |
| urgence seul | 🟢 Urgences 24h/24 · 7j/7 |
| classique + urgence | 🟢 Lun–Ven (08h–18h) & Urgences 24/7 |

---

## Modules JS principaux

| Fonction/Module | Rôle |
|-----------------|------|
| `AudioUI` | Web Audio API — `playClick()`, `playSuccess()`, `playComplete()` |
| `StateRecovery` | Checkpoint localStorage (`seba_onboarding_checkpoint`), TTL 2h, bannière non-bloquante |
| `SebaStorage` | Wrapper localStorage `seba_*` |
| `COUNTRIES[]` | 27 pays avec lat, lng, devise, tz, dial |
| `JOB_INDEX[]` | 60+ métiers hiérarchisés avec services, compétences, pricing |
| `SEARCH_INDEX[]` | Index plat fuzzy, construit par `buildSearchIndex()` au init |
| `SECTOR_DEFAULT_JOB` | Mappage sector → jobId par défaut |
| `SMART_SUGGEST` | 3 suggestions slogan + description par secteur (8 secteurs) |
| `HORAIRES_PRESETS` | 3 préréglages horaires (classique/urgence/flexible) |
| `GlobeState2(code)` | Globe → État 2 (global, défini par l'IIFE D3) |
| `GlobeState1()` | Globe → État 1 (global) |
| `updateGlobe(code)` | Pont entre `onPaysChange()` et `GlobeState2` |
| `updatePhone(n)` | Globe mini/plein + preview panel visible/caché selon étape |
| `updateSectorPreview(job)` | Remplit la vitrine glassmorphism avec un job JOB_INDEX |
| `getDefaultJobForSector(key)` | Retourne le job par défaut d'un secteur |
| `pickJobFromSearch(job)` | Valide un job fuzzy, stocke `S.selectedJobId` |
| `pickCustomSector(label)` | Valide un métier libre (sans id JOB_INDEX) |
| `openSearch() / closeSearch()` | Bascule grille secteur ↔ module de recherche |
| `filterSearch(q)` | Déclenche fuzzy engine → `renderSearchResults` |
| `buildSvcList(sector)` | Génère prestations depuis JOB_INDEX (priorité) ou businessTypes |
| `inferSvcPrice(name, sector)` | Prix suggéré par inférence mot-clé |
| `updateLiveSvcPreview()` | Met à jour `pv-services` en temps réel (step 4) |
| `pickHoraires(preset)` | Toggle multi-select horaires + fusion plages |
| `updateHorairesPreviewBadge()` | Met à jour badge `#pv-avail` selon horaires actifs |
| `openSuggest / applySuggest` | Smart Suggest — dropdown suggestions slogan/desc |
| `updatePreview()` | Met à jour panneau preview depuis les champs identité (step 6) |
| `startLoading()` | Animation GSAP ring + redirect vers `dashboard.html` |
| `saveLS()` | Sérialise `S` complet dans `localStorage['sebaEntreprise']` |

---

## Dépendances CDN

```
gsap@3.12.5                Animation ring de chargement
d3@7                       Globe interactif
topojson-client@3          Décodage données géographiques
world-atlas@2              Frontières pays (110m, chargé à la volée)
Inter (Google Fonts)       Typographie principale
JetBrains Mono (Google)    Police terminal bento dashboard
```
