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

### Fond du panneau droit `.ob-right`
- `background: radial-gradient(ellipse at 50% 48%, #111a2e 0%, #060913 72%)` — studio dark, sans quadrillage
- `::before` — halo ambiant 560×560 px, vert `rgba(0,245,160,0.065)`, centré sur le globe

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
| 0 | Bienvenue | Globe — État 1 (auto-spin lent) |
| 1 | Pays + téléphone | Globe — État 2 (centrage pays + lueur verte) |
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
gsap@3.12.5          Animation ring de chargement
d3@7                 Globe interactif
topojson-client@3    Décodage données géographiques
world-atlas@2        Frontières pays (110m, chargé à la volée)
Inter (Google Fonts) Typographie
```
