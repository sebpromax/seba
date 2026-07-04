# Seba — Release Notes v1.0 Premium

Publié le 2026-07-04. Quatre commits séquentiels, chacun vérifié en navigateur headless (mobile 390×844 émulé + desktop 1440×900, capture des erreurs console) avant d'être enregistré.

## 🏗️ Design system (commit `chore` + `fix`)

- **Tokens CSS unifiés** dans `pro-global.css` et les pages autonomes (`index.html`, `onboarding.html`) :
  échelle d'espacement `--spacing-1`→`--spacing-10` (base 4px), typographie (`--font-size-xs`→`--font-size-2xl`, `--line-height-tight/base`), ombres et lueurs (`--shadow-sm/md/lg/glow`).
- **Audit complet** documenté dans `architecture-et-plan.md` (39 pages inventoriées, assets partagés cartographiés, bugs mesurés au pixel avant correction).

## 📱 Bugs mobiles éradiqués (commit `fix`)

1. **Hero qui se superposait** (`index.html`) — `line-height` 1.05 trop serré sur 4 lignes mobiles → 1.12 via token, uniquement en media query mobile. Desktop inchangé.
2. **Vide fantôme sous le bouton "Continuer"** (`onboarding.html`) — `100vh` dépasse le viewport réellement visible sur téléphone (barre du navigateur) → bascule sur `100svh` + `margin-top:auto` sur la barre de navigation. Vide résiduel mesuré : 16px (contre ~350px avant).
3. **Bouton chevauchant la grille des métiers** (`onboarding.html`) — le dégradé transparent du panneau sticky masquait les tuiles → fond translucide net `rgba(6,9,19,.82)` + `backdrop-filter:blur(14px)` + bordure haute. La grille scrolle proprement sous un panneau vitré.

(S'ajoutent aux correctifs mobiles déjà livrés plus tôt dans la journée : sidebar des 11 pages pro réparée, inscription rendue indépendante de la détection user-agent, hamburger recalé à droite, texte d'accueil remonté.)

## 💎 Dashboard élite (commit `feat`)

- **Cockpit financier en D3.js v7** : courbe lissée (Catmull-Rom), dégradé émeraude sous la courbe, tracé animé à l'entrée, **tooltip interactif** souris + tactile avec crosshair pointillé et valeur exacte au survol. Séries 6 mois **par secteur** à variance réaliste (creux saisonnier du jardinage, stabilité des abonnements copro, accélération du déménagement…). Fallback SVG inline si le CDN D3 est indisponible.
- **Mini-sparklines** dans les 4 cartes de métriques (style terminal financier), posées en fond pour ne pas déformer la grille.
- **Glassmorphism clair** : widgets translucides avec flou d'arrière-plan sur fond ambiant à double halo radial, **bordure lumineuse émeraude + lévitation douce au survol**. Flou désactivé sous 760px (performance mobile).
- Le tout par-dessus le **moteur de widgets modulaire** existant : glisser-déposer (poignées ⠿), panneau Personnaliser (afficher/masquer), tailles S/M/L/XL, layout persistant, barre de commande IA (⌘⇧K), règles "compagnon" branchées sur les données réelles des pages-outils.

## ✨ Animations & micro-interactions (commit `feat`)

- États actifs (pression) sur cartes et boutons, halo focus émeraude à la navigation clavier.
- Ouverture des overlays (palette ⌘K, barre IA, aide raccourcis) en zoom doux ; menu du bouton flottant en cascade.
- Entrées en fondu montant échelonné des widgets, tracé progressif du graphique.
- **Accessibilité** : `aria-label` sur les boutons icône, `role`/`tabindex` sur la cloche de notifications, `prefers-reduced-motion` respecté partout.

## ✅ Assurance qualité

Parcours complet vérifié en conditions réelles émulées, **zéro erreur console** :
- Mobile : accueil → inscription (9 étapes, soumission réelle du formulaire) → dashboard avec 14 widgets et graphique D3 rendus.
- Desktop : navigation vers les 7 pages pro (clients, planning, devis, factures, équipe, réglages, historique) — sidebar présente partout.
- Interactions : mode personnalisation (14 poignées), barre IA testée en langage naturel (« montre moi ma tournée du jour » → widget Tournée ajouté).

## 📦 Fichiers modifiés

| Fichier | Nature |
|---|---|
| `docs/pro-global.css` | Tokens design system |
| `docs/index.html` | Tokens + fix hero mobile |
| `docs/onboarding.html` | Tokens + fixes vide/chevauchement mobile |
| `docs/dashboard.html` | Glassmorphism, D3 CDN, micro-interactions, a11y |
| `docs/widgets.js` | Graphique D3, sparklines, séries par secteur |
| `architecture-et-plan.md` | Nouveau — audit et plan |
| `release-notes-seba.md` | Nouveau — ce document |
