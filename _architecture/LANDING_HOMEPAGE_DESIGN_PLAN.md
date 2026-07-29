# LANDING-HOMEPAGE-001 — Plan de design concret (Concept Premium)

Statut : plan de design prêt à valider. **Aucune ligne de code n'a été écrite pour ce plan.** Rien ne doit être codé avant validation explicite du fondateur.

Base normative : `_architecture/SEBA_BRAND_CHARTER.md` (Version 1.0, prime en cas de contradiction) + `_architecture/SEBA_HOMEPAGE_BRAND_VISION.md`. Direction retenue à l'issue de l'exercice multi-agents : **Concept Premium**, avec le dispositif de continuité emprunté au Concept Radical (un seul client visible à travers plusieurs captures produit), signatures graphiques "coin corné" et "chanfrein" explicitement écartées — la reconnaissance de marque vient de la discipline d'exécution (rythme, espacement, régularité), pas d'une forme répétée.

Ce plan ne touche que la home publique (`docs/index.html`). Aucun autre fichier produit, portail, dashboard ou back-end n'est concerné.

---

## 1. Ce qui ne change pas

La structure actuelle en 9 sections est déjà orientée conversion, déjà confirmée saine par la vision de marque (`SEBA_HOMEPAGE_BRAND_VISION.md` §"Repères déjà présents"). Ce plan ne la jette pas : nav → hero → problème → produit (4 blocs) → parcours (6 étapes) → portails → secteurs → preuve → CTA final → footer. Le thème reste sombre (`--bg:#0a0a0c`), cohérent avec le "Tactical Dark" du dashboard sans le dupliquer littéralement — la home garde ses propres tokens, scopés à `docs/index.html` seul.

Ce qui change : la couleur d'accent (teal → cuivre), la police (Geist → Inter, alignée sur l'application réelle), les icônes emoji des portails (remplacées par un motif déjà présent dans le produit), et la mise en scène narrative de la section Produit (un seul client suivi de bout en bout, rendu explicite au lieu d'incident).

---

## 2. Palette et typographie définitives

### 2.1 Palette

Tokens inchangés (déjà sobres, déjà cohérents) : `--bg:#0a0a0c`, `--surface:#131417`, `--surface-2:#1a1c20`, `--text:#f4f4f5`, `--text-2:#a1a1aa`, `--text-3:#71717a`, `--border:rgba(255,255,255,.10)`, `--border-strong:rgba(255,255,255,.22)`, `--danger:#EF4444`.

**Accent — remplace `#0D9488` (teal) par un cuivre chaud, en deux nuances distinctes (pas une seule), choisies par calcul de contraste réel plutôt qu'à l'œil :**

| Token | Valeur | Usage | Contraste vérifié |
|---|---|---|---|
| `--accent` | `#C2793D` | Texte/icônes/bordures sur fond sombre : liens, badges eyebrow, puce du logo, numéros de blocs | 5.91:1 sur `#0a0a0c` (AA texte normal) |
| `--accent-strong` | `#9C5A2A` | Fond des boutons pleins (`.btn-primary`), avec texte blanc | 5.37:1 texte blanc dessus ; 3.79:1 vs fond de page (AA composant UI) |
| `--accent-soft` | `rgba(194,121,61,.12)` | Fond des badges eyebrow | — |
| `--accent-border` | `rgba(194,121,61,.35)` | Bordures des badges/icônes | — |
| `--on-accent` | `#ffffff` | Texte sur `--accent-strong` | voir ci-dessus |

**Pourquoi deux nuances et pas une seule couleur "copper" appliquée partout** : la teinte `#C2793D` retenue dans l'arbitrage initial est illisible en texte blanc sur fond plein (3.44:1, sous le seuil AA de 4.5:1 à la taille des boutons actuels) — l'utiliser telle quelle pour `.btn-primary` aurait été une régression d'accessibilité invisible à l'œil mais réelle. `#9C5A2A`, plus sombre, résout ce problème sans changer la teinte perçue (même famille cuivre/terracotta). Ceci referme aussi le débat entre les trois valeurs qui ont circulé pendant l'exercice (`#C2793D`, `#D97A3C`, `#B08D57`) : on garde `#C2793D` comme teinte de référence, `#9C5A2A` comme sa variante fonctionnelle pour les boutons — pas une quatrième couleur.

`--nav-bg`/`--overlay`/`--shadow` restent identiques (dépendent du fond, pas de l'accent).

### 2.2 Typographie

**Une seule famille : Inter**, en remplacement de Geist. Poids utilisés : 400 (corps de texte), 600 (sous-titres, liens de section), 700 (boutons, labels), 800 (H1/H2).

Raison, au-delà de la préférence esthétique déjà actée (rejet de l'appariement serif+sans façon Fraunces, jugé trop "artisanal-mignon") : **`docs/app/dashboard.html` charge déjà exactement `Inter:wght@300;400;500;600;700;800`** (`docs/app/dashboard.html:10`). La home utilisant Geist aujourd'hui crée un écart typographique réel entre la vitrine et le produit — la personne qui clique "Créer mon espace" passe d'une police à une autre en une seconde. Aligner la home sur la police déjà réellement utilisée dans l'outil est cohérent avec le principe de confiance §7 de la charte ("aucune fonctionnalité future présentée comme disponible aujourd'hui") appliqué à l'inverse : ne pas donner à la vitrine un vernis visuel que le produit réel n'a pas. Pas de police monospace sur la home (JetBrains Mono reste scopé aux chiffres du dashboard, Tactical Dark uniquement — voir `CLAUDE.md`).

Import : `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">` (poids 300/500 du dashboard non nécessaires ici, pas de `JetBrains+Mono`).

---

## 3. Wireframe section par section (inchangé dans l'ordre, précisé dans le contenu)

1. **Nav** — structure identique. Point du logo recoloré en `--accent`.
2. **Hero** — ajout d'un eyebrow sectoriel au-dessus du H1 (validé précédemment : nommer le secteur tôt). H1/sous-titre réécrits pour porter la promesse non négociable de la charte. Capture inchangée (`preview-dashboard.png`).
3. **Problème** — liste des 5 points inchangée dans sa forme, copie légèrement resserrée.
4. **Produit (4 blocs)** — **seule section restructurée en substance** : devient le récit visuel du même client (Sophie Lacroix) suivi à travers les 4 captures déjà réelles. Voir §5.
5. **Parcours (6 étapes)** — inchangé dans sa forme ; copie resserrée. Reste volontairement générique (pas de nom de client ici — le dispositif de continuité doit rester réservé à la section Produit pour ne pas devenir un tic répété sur toute la page).
6. **Portails** — icônes emoji (🔗/📱) remplacées par des badges à initiales (voir §6), copie inchangée.
7. **Secteurs** — inchangé (la numérotation 01-04 est fonctionnelle, cohérente avec la numérotation déjà présente en section Produit et Parcours — pas décorative, c'est la même discipline répétée).
8. **Preuve produit** — inchangé, déjà fondé sur des faits produit réels.
9. **CTA final** — titre réécrit (voir §5), structure identique.
10. **Footer** — inchangé, point du logo recoloré.

---

## 4. Composition visuelle desktop et mobile

Aucun changement de grille/breakpoints : les règles existantes (`grid-template-columns:repeat(2,1fr)` desktop → `1fr` mobile pour les blocs produit et portails ; `repeat(4,1fr)` → `repeat(2,1fr)` → `1fr` pour les secteurs ; parcours horizontal → vertical à 860px) sont déjà correctes et déjà conformes à la leçon apprise du projet sur `minmax(0,1fr)` (à vérifier une seule fois lors de l'implémentation, pas re-conçu ici). Seul changement structurel : les nouvelles légendes sous chaque capture produit (§5) doivent recevoir une hauteur naturelle (pas de troncature forcée) pour ne pas casser l'alignement des 4 cartes en grille 2×2 — utiliser la même technique déjà en place (`.product-block` en `flex-direction:column`, la légende vient après l'image, pas de hauteur fixe).

---

## 5. Section Produit : le dispositif de continuité (Sophie Lacroix)

**Constat vérifié sur les captures réelles existantes (aucune nouvelle capture nécessaire) :** les 4 PNG déjà utilisés dans `docs/marketing/` montrent déjà, sans mise en scène, le même client cohérent de bout en bout :
- `preview-client-fiche.png` : Sophie Lacroix, active, 3 interventions, 95 € de CA total.
- `preview-planning.png` : Sophie Lacroix, Ménage standard, lundi/vendredi/samedi.
- `preview-devis.png` : devis #0122, Sophie Lacroix, Ménage standard, 95 €, **Signé**.
- `preview-factures.png` : facture #F-0098, Sophie Lacroix, Ménage standard, 95 €, **Payée**.

Le devis signé et la facture payée correspondent au même montant (95 €) — la cohérence n'est pas à construire, elle existe déjà dans les données de démonstration. Il ne s'agit donc pas d'inventer une preuve, mais de **rendre visible une continuité déjà réelle** en la nommant dans la copie — exactement l'esprit "show, don't tell" validé par le fondateur, sans construire de nouvel artefact visuel.

**Section-head réécrit :**
- Eyebrow : `Un seul dossier client, du premier contact au paiement`
- H2 : `Suivez Sophie, du premier rendez-vous à la facture payée.`
- Paragraphe : `Quatre écrans, un seul dossier. Aucune information ressaisie entre chacun.`

**Légendes ajoutées sous chaque capture (nouvel élément `<p class="product-block-caption">`, sous l'image, dans chaque `.product-block`) :**
1. CENTRALISER : `La fiche de Sophie : coordonnées, historique et consignes de service, au même endroit.`
2. ORGANISER : `Sophie sur le planning de la semaine — visible par toute l'équipe, sans appel téléphonique.`
3. VENDRE : `Le devis de Sophie, envoyé puis signé, prêt à devenir une facture sans ressaisie.`
4. SUIVRE : `La facture de Sophie, payée — le même montant que le devis signé, sans écart.`

**Règle d'usage des captures (vaut pour toute évolution future de la home, pas seulement ce chantier) :**
- Seules les 5 captures existantes dans `docs/marketing/` peuvent être utilisées (`preview-dashboard.png`, `preview-client-fiche.png`, `preview-planning.png`, `preview-devis.png`, `preview-factures.png`). Aucune capture, mockup ou photo supplémentaire ne doit être inventé ou généré.
- Aucun recadrage ni retouche du contenu des captures (pas de flou, pas de masquage de données réelles) — elles montrent un compte de démonstration ("Menage Pro Test"), pas un client réel, donc aucun enjeu de confidentialité ne justifie une retouche.
- Le nom "Sophie Lacroix" utilisé dans la copie doit correspondre exactement à ce qui apparaît dans les captures — si les captures sont un jour régénérées avec un autre nom, la copie de cette section devra être mise à jour en conséquence (dépendance à documenter dans le commit qui régénère les captures, si cela arrive).
- Le hero (`preview-dashboard.png`) reste hors du dispositif "Sophie" : c'est une vue d'ensemble compte, pas un dossier client — named continuity reste réservée à la section Produit, pour ne pas être diluée sur toute la page (cf. §3 point 5, réserve explicite sur le Parcours).

---

## 6. Portails : remplacement des icônes emoji

`🔗` et `📱` (actuels `.portal-icon`) sont génériques et détonnent avec la personnalité "robuste, précise, discrète" de la charte — un emoji est un raccourci visuel que n'importe quel autre SaaS peut coller tel quel. Remplacement par des badges à initiales, **motif déjà présent et réel dans le produit** (avatar "SL" dans `preview-client-fiche.png`, avatar "ML"/"M" dans les autres captures) : un carré `--surface-2` avec bordure `--accent-border`, contenant les initiales du portail en majuscules et `font-weight:800` — `CL` pour le portail Client, `EQ` pour le portail Employé Terrain. Ce n'est pas une nouvelle convention graphique inventée pour la home : c'est la réutilisation d'un motif que l'utilisateur reverra littéralement en se connectant, ce qui renforce la continuité vitrine → produit au lieu d'ajouter une signature purement décorative (cohérent avec le rejet du coin corné/chanfrein : la reconnaissance vient de motifs déjà fonctionnels dans le produit, pas d'une forme ajoutée pour la marque).

---

## 7. Copy complète (texte final, section par section)

**Nav** — inchangé : `Produit` / `Pour qui` / `Fonctionnement` / `Tarifs` / `Connexion` / `Essayer Seba`.

**Hero**
- Eyebrow (nouveau) : `Pour les entreprises de services de terrain`
- H1 : `Du premier contact client au paiement encaissé, sans changer d'outil.`
- Sous-titre : `Clients, devis, planning, interventions et factures réunis dans un seul espace — pensé pour les entreprises qui travaillent sur le terrain, pas dans un bureau.`
- CTA primaire : `Créer mon espace` (inchangé)
- CTA secondaire : `Voir comment ça fonctionne` (inchangé)
- Preuve : `Configuration en quelques minutes · Sans carte bancaire` (inchangé, déjà vérifié vrai)

**Problème** (eyebrow `Le quotidien sans Seba`, H2 `Ce que vous vivez chaque semaine` — inchangés) :
- `Les informations client sont dispersées entre appels, SMS et fichiers séparés.`
- `Le planning de l'équipe change sans que tout le monde soit informé à temps.`
- `Des devis restent sans réponse et des factures partent sans relance.`
- `Les employés découvrent leur mission sans consignes ni adresse précise.`
- `Les clients rappellent pour savoir si et quand ils seront servis.`

**Produit** — voir §5 pour le texte complet (eyebrow, H2, paragraphe, 4 légendes).

**Parcours** (eyebrow `Un seul flux`, H2 `De la demande au paiement` — inchangés, 6 étapes resserrées) :
1. `Client enregistré` — `Le client est enregistré dans votre fiche clients.`
2. `Devis envoyé` — `Le devis est créé et envoyé pour signature.`
3. `Intervention planifiée` — `L'intervention est planifiée sur le calendrier de l'équipe.`
4. `Mission assignée` — `L'employé reçoit sa mission avec les consignes.`
5. `Client informé` — `Le client suit l'avancement de la prestation.`
6. `Facture envoyée` — `La facture part automatiquement, sans ressaisie.`

**Portails** (eyebrow `Inclus, pas en option`, H2 `Deux portails, un seul outil.` — inchangés) :
- Intro : `Vos clients suivent leurs interventions sans vous appeler. Votre équipe terrain travaille depuis son téléphone, sans jamais voir les données des autres.`
- Portail Client (badge `CL`) : `Suivre ses demandes` / `Consulter ses interventions` / `Lire ses devis et factures` / `Échanger avec l'entreprise` — lien `Découvrir l'espace client →`
- Portail Employé Terrain (badge `EQ`) : `Voir ses missions` / `Consulter les consignes` / `Démarrer et terminer une intervention` / `Signaler un problème` — lien `Découvrir l'espace terrain →`

**Secteurs** (eyebrow `Pour qui`, H2 `Conçu pour votre métier de terrain` — inchangés) : `Ménage` / `Conciergerie` / `Maintenance` / `Activité personnalisée`.

**Preuve produit** (eyebrow `Ce que ça change`, H2 `Un seul outil, moins de friction` — inchangés) :
- `Moins de double saisie` — `Une seule fiche client, utilisée par le devis, la facture et le planning.`
- `Moins d'oublis` — `Les relances de devis et de factures partent sans que vous ayez à y penser.`
- `Une information accessible à chacun` — `Le patron, l'employé et le client voient chacun exactement ce qui le concerne.`

**CTA final** (réécrit — l'ancien titre était une tournure rhétorique ["mérite mieux qu'un cahier"] plus proche d'un ton "vendeur" que du ton direct/concret de la charte) :
- H2 : `Un seul outil pour tout le dossier client, du premier contact au paiement.`
- CTA primaire : `Créer mon espace Seba` (inchangé)
- Lien secondaire : `Se connecter` (inchangé)

**Footer** — inchangé.

**Phrase fondatrice interne et tagline de campagne** (charte §0) : ni l'une ni l'autre n'est utilisée verbatim dans cette copie publique — la phrase fondatrice est explicitement interne, et la tagline de campagne reste une piste à activer plus tard (campagne dédiée), pas une intégration silencieuse dans le premier jet de la home.

---

## 8. Interactions et animations

Reprend l'esprit déjà validé pendant l'exercice créatif (rejet des effets à la mode : pas de parallax, pas de particules, pas de scroll-jacking) :
- Boutons : transition déjà en place (`background-color`/`border-color`/`color`, 0.18s) — inchangée, juste recolorée avec les nouveaux tokens.
- Captures produit (`.product-block img`, `.hero-visual img`) : léger effet d'apparition au scroll (fade + translateY(8px), ~250ms, `IntersectionObserver`, une seule fois par élément — pas de replay en boucle). Fonctionnel : guide l'œil vers chaque étape du récit Sophie sans être un gadget.
- Aucune animation sur les nombres/statistiques (il n'y en a pas sur cette page — pas de "compteur qui s'incrémente", motif jugé faux/startup par le critique renforcé).
- Aucun signe animé répété façon "signature de marque" (cohérent avec le rejet du coin corné/chanfrein — la régularité vient de la mise en page, pas d'un tic visuel).

---

## 9. Fichiers à modifier

- `docs/index.html` — seul fichier modifié en profondeur (tokens CSS `:root`, import de police, contenu des sections Hero/Produit/Portails/CTA final, ajout des légendes produit, ajout des badges portails, script `IntersectionObserver` pour l'apparition au scroll).
- `docs/marketing/*.png` — **aucune modification**. Les 5 captures existantes sont utilisées telles quelles.
- Aucun fichier partagé (`pro-global.css`, `docs/sidebar.js`, `docs/app/dashboard.html`) n'est concerné — la home a ses propres tokens scopés à `docs/index.html`, comme aujourd'hui.
- `tools/check-design-system.js` devra passer sur `docs/index.html` une fois modifié (tokens dans `:root`, aucune couleur hex/rgb en dur ailleurs dans le fichier).

---

## 10. Stratégie de réalisation progressive

1. Branche dédiée `feature/landing-homepage-premium` (créée depuis `main`, pas de commit direct sur `main` pour ce chantier de plusieurs étapes, conformément à `CLAUDE.md`).
2. **Commit 1** — tokens CSS uniquement (`:root` : accent → cuivre, police → Inter) sans toucher au contenu. Permet de vérifier visuellement la palette/typo seules avant de toucher la copie.
3. **Commit 2** — réécriture de la copie Hero + CTA final (les 2 sections à plus fort impact de conversion, les plus courtes à vérifier).
4. **Commit 3** — section Produit : légendes Sophie Lacroix + réécriture eyebrow/H2/paragraphe.
5. **Commit 4** — portails : badges à initiales à la place des emoji.
6. **Commit 5** — interactions (apparition au scroll), resserrage du reste de la copie (Problème/Parcours inchangés en fond, juste vérifiés).
7. À chaque commit : `node tools/check-design-system.js` local avant de committer.
8. Une fois la branche complète : revue visuelle du fondateur en local (`file://.../docs/index.html` ou serveur statique local), desktop et mobile.
9. Après validation : PR vers `main` (jamais de push direct sur `main` pour ce chantier), merge par le fondateur, déploiement GitHub Pages, **vérification live obligatoire** sur `sebpromax.github.io/seba` (pas seulement "le push a réussi" — leçon déjà retenue sur ce projet : toujours confirmer le résultat déployé réel).

---

## 11. Critères de validation visuelle et responsive

- `node tools/check-design-system.js` passe sans erreur sur `docs/index.html` modifié.
- Contraste : `--accent` (`#C2793D`) sur `--bg` ≥ 4.5:1 (texte), `--accent-strong` (`#9C5A2A`) avec texte blanc ≥ 4.5:1 (déjà vérifiés par calcul en §2.1, à re-vérifier à l'œil/outil après implémentation réelle des tokens).
- Desktop (≥1140px) : grille 2×2 des blocs Produit alignée, légendes de hauteur variable n'introduisent aucun décalage vertical entre les 2 colonnes.
- Mobile (≤860px pour nav/parcours, ≤900px pour produit, ≤768px pour portails) : bascule en 1 colonne déjà en place, à revérifier après ajout des légendes (pas de texte tronqué, pas de débordement horizontal — cohérent avec la leçon apprise `minmax(0,1fr)` déjà documentée dans `CLAUDE.md`).
- Aucune régression sur le hamburger mobile ni le menu plein écran (inchangés dans ce plan, mais dépendent des mêmes tokens de couleur — à revérifier visuellement une fois l'accent recoloré).
- Chaque capture produit reste strictement une des 5 PNG existantes (vérification manuelle : aucun nouveau fichier dans `docs/marketing/`).
- Lecture à voix haute de la copie finale : aucun mot de la liste interdite de la charte (§2 de `SEBA_BRAND_CHARTER.md` : écosystème, révolutionnaire, disruptif, next-gen, synergie, scalable, growth, superlatif non prouvé) ne doit apparaître — vérifié ligne par ligne dans ce document avant implémentation (fait : aucun terme interdit dans la copie ci-dessus).
- Test de relecture "critique renforcé" (déjà demandé par le fondateur en amont de l'exercice) : la page, une fois modifiée, doit être relue en se demandant "est-ce que ceci pourrait être confondu avec 20 autres SaaS ?" et "qu'est-ce qui est purement décoratif ?" — à faire visuellement une fois le code réel en place, pas seulement sur ce plan écrit.

---

## 12. Hors périmètre (rappel, déjà noté dans `SEBA_HOMEPAGE_BRAND_VISION.md`)

L'incohérence du `<title>` sur 40+ autres pages du site (toujours "L'écosystème des entreprises de terrain", mot désormais interdit) n'est pas traitée par ce plan — seul le `<title>` de `docs/index.html` lui-même en fait partie, et il ne contient déjà pas "écosystème". Correction des 40+ autres pages : tâche distincte, à ajouter séparément au Master Backlog si le fondateur le décide, pas dans ce chantier.
