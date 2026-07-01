# Architecture — onboarding.html

## Vue d'ensemble

`onboarding.html` est la page d'accueil de configuration d'entreprise Seba. Elle guide l'utilisateur en 10 étapes (steps 0–9) pour créer son espace professionnel. Le côté gauche contient les formulaires, le côté droit affiche un globe D3 interactif (étapes 0–1) puis un téléphone preview (étapes 2+).

---

## Globe D3.js (IIFE — lignes ~778–864)

### Bibliothèques
- **D3.js v7** — `d3.geoOrthographic`, `d3.geoPath`, `d3.geoGraticule`, `d3.drag`, `d3.timer`, `d3.interpolate`, `d3.easeCubicInOut`
- **TopoJSON Client v3** — `topojson.feature`
- **Données** — `world-atlas@2/countries-110m.json` (CDN, ~100 Ko)

### Projection
Orthographique, scale=140, translate=[150,150], clipAngle=90. Rendu dans `<svg id="globe-canvas" width="300" height="300">`.

### Couches SVG (ordre de rendu)
1. `<circle>` — fond océan `#0a1628`
2. `<path>` graticule — lignes lat/lng, opacité 0.08
3. `<g class="countries">` — 250 pays, fill `#1e293b`, stroke `#222c44`
4. `<circle>` outline — bordure globe `#1a2a50`
5. `<defs><filter id="glow">` — lueur verte `#05F29A` pour pays sélectionné

### État 1 — Bienvenue (step-0)
- `autoSpin=true`, rotation Y automatique (+0.12°/frame via RAF)
- `selCode=null`, tous les pays en `#1e293b`
- Drag libre : `d3.drag()` met `autoSpin=false` pendant le drag, `autoSpin=true` au relâchement

### État 2 — Sélection pays (step-1, `onPaysChange()`)
- `window.GlobeState2(code)` appelée depuis `updateGlobe(code)`
- `autoSpin=false` (ne reprend pas après drag en État 2)
- Transition 950ms `d3.easeCubicInOut` via `d3.timer` : rotation de `[λ,φ]` courants vers `[-lng, -lat, 0]` du pays
- Pays sélectionné : fill `#05F29A` + `filter:url(#glow)` (lueur feGaussianBlur stdDeviation=5)

### Correspondance pays → TopoJSON
Tableau `ISO_NUM` : codes ISO alpha-2 ↔ codes numériques ISO 3166-1 (clé `d.id` dans les features TopoJSON).
Les territoires ultramarins (RE, MQ, GP, GF, NC, PF) et Monaco peuvent ne pas apparaître comme polygones distincts à 110m mais le centrage fonctionne via leur lat/lng.

---

## Machine à états `_currentStep`

| Step | Contenu gauche | Panneau droit |
|------|---------------|---------------|
| 0 | Bienvenue | Globe — État 1 (auto-spin) |
| 1 | Pays + téléphone | Globe — État 2 (centrage pays) |
| 2–9 | Secteur, services, fiscal, identité… | Phone preview |

`goStep(n)` gère les transitions CSS (translateX + opacity), `updatePhone(n)` bascule globe ↔ téléphone.

---

## Modules JS principaux

| Fonction/Module | Rôle |
|-----------------|------|
| `AudioUI` | Web Audio API — `playClick()`, `playSuccess()`, `playComplete()` |
| `StateRecovery` | Checkpoint localStorage (`seba_onboarding_checkpoint`), TTL 2h, bannière non-bloquante |
| `SebaStorage` | Wrapper localStorage `seba_*` |
| `COUNTRIES[]` | 27 pays avec lat, lng, devise, tz, dial |
| `GlobeState2(code)` | Globe → État 2 (global, défini par l'IIFE D3) |
| `GlobeState1()` | Globe → État 1 (global) |
| `updateGlobe(code)` | Pont entre `onPaysChange()` et `GlobeState2` |
| `buildSvcList(sector)` | Génère les lignes de prestations selon le secteur |
| `startLoading()` | Animation GSAP ring + redirect vers `dashboard.html` |
| `saveLS()` | Sérialise `S` dans `localStorage['sebaEntreprise']` |

---

## Dépendances CDN

```
gsap@3.12.5         Animation ring de chargement
d3@7                Globe interactif
topojson-client@3   Décodage données géographiques
world-atlas@2       Frontières pays (110m, chargé à la volée)
Inter (Google Fonts) Typographie
```
