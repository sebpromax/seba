# LANDING-HOMEPAGE-001 — Audit visuel réel (branche `feature/landing-homepage-premium`)

Captures réelles, générées par Playwright contre le fichier tel qu'il existe sur la branche. Chemins ci-dessous. Rien n'est retouché ni recadré manuellement — ce sont des captures brutes ou des clips par sélecteur CSS.

## 1. Captures pleine page (5 viewports imposés)

- `docs/audit-screenshots/landing-homepage-001/full/1440x900.png`
- `docs/audit-screenshots/landing-homepage-001/full/1280x800.png`
- `docs/audit-screenshots/landing-homepage-001/full/430x932.png`
- `docs/audit-screenshots/landing-homepage-001/full/390x844.png`
- `docs/audit-screenshots/landing-homepage-001/full/375x812.png`

## 2. Captures section par section (desktop 1440 + mobile 390)

`docs/audit-screenshots/landing-homepage-001/sections/` :
`nav-desktop-1440.png`, `nav-mobile-390.png`, `hero-desktop-1440.png`, `hero-mobile-390.png`, `probleme-desktop-1440.png`, `probleme-mobile-390.png`, `produit-desktop-1440.png`, `produit-mobile-390.png`, `parcours-desktop-1440.png`, `parcours-mobile-390.png`, `portails-desktop-1440.png`, `portails-mobile-390.png`, `secteurs-desktop-1440.png`, `secteurs-mobile-390.png`, `preuve-desktop-1440.png`, `preuve-mobile-390.png`, `cta-final-desktop-1440.png`, `cta-final-mobile-390.png`, `footer-desktop-1440.png`, `footer-mobile-390.png`.

## 3. Planches couleur (même extrait réel : section hero complète, 3 valeurs déjà discutées pendant l'exercice, jamais de couleur nouvelle)

- `docs/audit-screenshots/landing-homepage-001/palettes/planche-A-cuivre-implemente.png` — `#C2793D` / `#9C5A2A` (implémentée sur la branche actuelle)
- `docs/audit-screenshots/landing-homepage-001/palettes/planche-B-cuivre-chaud.png` — `#D97A3C` / `#AD5E28`
- `docs/audit-screenshots/landing-homepage-001/palettes/planche-C-laiton-mat.png` — `#B08D57` / `#8A6C3C`

## 4. Résumé factuel

### Les 5 problèmes les plus graves

1. **Redondance structurelle Produit / Parcours.** La section Produit (`Suivez Sophie, du premier rendez-vous à la facture payée.`) et la section Parcours juste en dessous (`De la demande au paiement`, 6 étapes) racontent le même flux client → devis → intervention → facture deux fois de suite, avec deux mises en forme différentes. Visible en scrollant `full/1440x900.png` : les deux blocs se suivent sans rupture de sujet.
2. **Rupture de rythme dans la grille Produit sur mobile.** Sur `sections/produit-mobile-390.png` : les vignettes 01 (Centraliser) et 02 (Organiser) affichent un bandeau capture assez haut, les vignettes 03 (Vendre) et 04 (Suivre) affichent un bandeau capture réduit à une ligne de texte (~30px de haut affiché). Les 4 cartes de la même grille n'ont pas la même respiration visuelle.
3. **La même formule répétée 3 fois, mot pour mot.** H1 : « Du premier contact client au paiement encaissé, sans changer d'outil. » — eyebrow Produit : « Un seul dossier client, du premier contact au paiement » — H2 CTA final : « Un seul outil pour tout le dossier client, du premier contact au paiement. » Trois reformulations de la même phrase à trois endroits de la page.
4. **Tic de langage « un seul » répété 4 fois** comme ouverture ou pivot de phrase : eyebrow Produit (« Un seul dossier client »), H2 Portails (« Deux portails, un seul outil. »), H2 Preuve (« Un seul outil, moins de friction »), H2 CTA final (« Un seul outil pour tout le dossier client »).
5. **Dissonance couleur visible dans le hero lui-même.** Sur `palettes/planche-A-cuivre-implemente.png` : le bouton « Créer mon espace » est cuivre, mais la capture produit juste en dessous (bord supérieur visible dans le même cadre) montre un point vert « Seba » et un bouton vert « + Nouvelle intervention » — le produit réel reste vert, la promesse marketing est cuivre, les deux couleurs cohabitent dans la même image sans transition.

### Sections à supprimer ou fusionner

- **Parcours** (6 étapes) et **Produit** (4 blocs) : candidats à fusion. Les deux disent la même chose (le flux client de bout en bout) ; la page en garde probablement un seul.
- **Problème** (5 points négatifs) et **Preuve produit** (3 points positifs) : structure « avant / après » implicite mais jamais assumée comme telle — actuellement deux sections séparées par 4 autres sections, le lien ne se voit pas en scrollant.

### Textes exacts trop longs ou répétitifs

- « Du premier contact client au paiement encaissé, sans changer d'outil. » (H1)
- « Un seul dossier client, du premier contact au paiement » (eyebrow Produit)
- « Un seul outil pour tout le dossier client, du premier contact au paiement. » (H2 CTA final)
- « Un seul outil » apparaît dans : eyebrow Produit (paraphrasé), H2 Portails, H2 Preuve, H2 CTA final.

### Problèmes spécifiques desktop

- Aucune casse de mise en page entre 1440 et 1280 (les deux rendus sont visuellement identiques, la grille ne change qu'à 900px de large) — pas un bug, mais confirme qu'il n'y a qu'un seul point de rupture testé entre les deux largeurs desktop demandées.
- Dissonance couleur cuivre (marketing) / vert (produit réel) visible dans le cadre du hero, cf. point 5 ci-dessus.

### Problèmes spécifiques mobile

- Rupture de rythme des 4 vignettes Produit (cf. point 2).
- Page mobile très longue avant d'atteindre le CTA final (`full/375x812.png` : ~7500px de hauteur totale) — la répétition de texte (points 3 et 4) accentue la sensation de longueur au scroll.
- Sur les vignettes Devis/Facture (`sections/produit-mobile-390.png`), le nom et le montant sont lisibles mais rendus sous forme de bandeau très fin façon reçu de caisse, visuellement en rupture avec les deux autres vignettes (qui ressemblent à de vraies captures d'écran).
