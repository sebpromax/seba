# Seba — Plan de construction (site professionnel)

Règle : on termine toute la STRUCTURE avant de toucher aux DÉTAILS.
Une étape = un bloc = un prompt à Claude Code = une validation avant de passer à la suite.

---

## PHASE 1 — STRUCTURE (le squelette doit exister partout)

Une page "existe" structurellement si on peut cliquer dessus et naviguer,
même si le contenu à l'intérieur est encore simplifié.

| # | Bloc | État |
|---|------|------|
| 1.1 | Landing page (index.html) | ✅ Fait |
| 1.2 | Création d'entreprise — onboarding (3 étapes) | ✅ Fait |
| 1.3 | Tableau de bord pro (vue d'ensemble) | ✅ Fait |
| 1.4 | Liste clients | ✅ Fait |
| 1.5 | Planning (vue semaine) | ✅ Fait |
| 1.6 | Liste devis | ✅ Fait |
| 1.7 | Liste factures | ✅ Fait |
| 1.8 | Équipe (liste employés) | ✅ Fait |
| 1.9 | Réglages (général, identité, services, compte) | ✅ Fait |
| 1.10 | Navigation reliée entre toutes les pages (sidebar) | ✅ Fait |
| 1.11 | **Fiche détaillée d'un client** (clic "Ouvrir" depuis clients.html) | ✅ Fait |
| 1.12 | **Fiche détaillée d'un employé** (clic depuis equipe.html) | ✅ Fait |
| 1.13 | **Création d'un nouveau devis** (vrai formulaire, pas une alert) | ✅ Fait |
| 1.14 | **Création d'une nouvelle intervention** (depuis planning.html) | ✅ Fait |
| 1.15 | **Vue détaillée d'un devis / d'une facture** (clic "Voir") | ✅ Fait |
| 1.16 | **Menu de navigation (☰) sur la landing page** — contenu : Fonctionnalités, Comment ça marche, Tarifs, FAQ, Connexion (+ CTA "Créer mon entreprise") | ✅ Fait (0.22) |
| 1.17 | **Page "Comment ça marche"** (accessible depuis la landing) | ✅ Fait |
| 1.18 | **Page FAQ** (accessible depuis la landing) | ✅ Fait |
| 1.19 | **Page Tarifs** (accessible depuis la landing) | ✅ Fait |
| 1.20 | **Page Connexion** (se connecter à un compte existant) + lien "Mon compte" fonctionnel depuis le dashboard | ✅ Fait |
| 1.21 | **Généraliser les fiches détaillées** : toutes les lignes clients (pas seulement Sophie Lacroix) et toutes les cartes employés (pas seulement Léa Martin) doivent être cliquables vers une vraie fiche | ✅ Fait |

→ Une fois 1.11 à 1.15 faits, la PHASE 1 est complète : toutes les pages
qu'un professionnel pourrait vouloir ouvrir existent et sont reliées.

---

## PHASE 2 — INTERACTIVITÉ FINE (rendre chaque page déjà existante 100% utilisable)

| # | Bloc | État |
|---|------|------|
| 2.1 | Filtres devis.html | ✅ Fait |
| 2.2 | Filtres factures.html | ✅ Fait |
| 2.3 | Filtres clients.html | ✅ Fait |
| 2.4 | Navigation semaine planning.html | ✅ Fait |
| 2.5 | Onglets reglages.html | ✅ Fait |
| 2.6 | Recherche fonctionnelle (barre de recherche clients.html) | ✅ Fait |
| 2.7 | Formulaire d'ajout de client (réel, pas une alert) | ✅ Fait |
| 2.8 | Formulaire d'ajout d'employé (réel) | ✅ Fait |
| 2.9 | Bouton "Relancer" → vraie action (ou simulation crédible) | ✅ Fait |

---

## BLOCS TRANSVERSAUX (hors phases, exécutés à tout moment)

| # | Bloc | État |
|---|------|------|
| 0.5 | Améliorer les textes du site vitrine (index.html) | ✅ Fait |
| 0.6 | Persistance des données d'onboarding via localStorage | ✅ Fait |
| 0.7 | Refonte visuelle premium de index.html | ✅ Fait |
| 0.8 | Pages séparées probleme / solution / confiance + View Transitions + démo hero en boucle | ✅ Fait |
| 0.9 | **Refonte onboarding** — 8 étapes, design system v2, sélecteur international (27 pays), micro-réaction secteur, prévisualisation portail en temps réel, écosystème, chargement animé, résumé | ✅ Fait |
| 0.10 | **Refonte dashboard** — Score Seba (anneau SVG), métriques + recommandations + timeline + portail + services + intelligence adaptés par secteur, tout lu depuis localStorage | ✅ Fait |
| 0.11 | **Bloc correctif** — businessTypes.js : 11 secteurs avec sous-types conciergerie + nouveaux métiers (beauté, animaux, déménagement) ; aperçu téléphone onboarding redessiné ; design system v2 migré sur toutes les pages pro (10 fichiers) ; emojis remplacés par SVG ou supprimés ; audit liens cassés | ✅ Fait |
| 0.12 | **Relecture & audit** — 3 SyntaxError JS corrigés dans businessTypes.js (apostrophes ASCII dans strings), icône dupliquée `◈` corrigée sur conciergerieEntreprise → `◆`, référence `SC_ICONS` indéfinie corrigée dans onboarding.html, menu avatar ajouté sur dashboard.html, cohérence sidebar vérifiée sur toutes les pages | ✅ Fait |
| 0.13 | **Refonte dashboard** — Cockpit immersif 4 zones : en-tête (nom/secteur/date), métriques par secteur (4 cards cliquables), grille 2 colonnes (Timeline du jour + Activité récente / Recommandations + Actions rapides + Objectif du mois), bande basse 3 colonnes (Votre espace + Portail client avec copie vraie clipboard + Équipe aujourd'hui). DEMO data complet pour 11 secteurs. `historique.html` créé (filtres Tout/Clients/Paiements/Devis/Interventions). Tous les éléments sont des liens réels — aucun bouton décoratif. | ✅ Fait |
| 0.15 | **Animations vitrine** — `animations-vitrine.js` (index.html uniquement) : 180 particules Canvas 2D (émeraude/prune, répulsion souris, friction, wrap), GSAP ScrollTrigger `scrub:1` sur toutes les sections (titres, cartes, pipeline, portail colonnes opposées, trust panels, CTA), parallaxe `hero-visual` (`y:-80` scrub), prefers-reduced-motion skip total GSAP+canvas. CDN GSAP 3.12.5 dans `<head>` (defer). IntersectionObserver/.reveal entièrement supprimés. | ✅ Fait |
| 0.14 | **Horloge temps réel** — Dashboard : horloge HH:MM:SS live (`setInterval` 1s, `Intl.DateTimeFormat` avec `timeZone`), affiche l'heure du pays de l'entreprise (pas du navigateur). `TZ_MAP` de 27 pays (fallback si `biz.timezone` absent). `onboarding.html` : champ `tz` (IANA) ajouté sur chaque pays du sélecteur, persisté en localStorage comme `timezone`. Fallback `Europe/Paris` si aucune donnée. Ville affichée discrètement à côté de l'heure. | ✅ Fait |
| 0.16 | **Réingénierie visuelle — Part 1 index.html** : Three.js CDN + 800 particules WebGL (AdditiveBlending, émeraude/violet-prune, répulsion souris 3D R=2.5, retour à l'origine, friction 0.95). Hero background #090D16. ha1-ha5 CSS retirés, entrée GSAP power4.out. Dashboard tilt rotationX:15→0 sur scroll (scrub:1.5). Sections Problème + Solution redessinées en Bento Grid 4 colonnes avec glassmorphism (backdrop-filter blur:12px), halos radiaux, textes enrichis. scrub passé à 1.5 sur toutes les animations. Responsive géré. | ✅ Fait |
| 0.17 | **Réingénierie visuelle — Part 2 onboarding.html** : GSAP CDN ajouté. `goStep()` remplacé par transition GSAP (sortie y:-30/opacity:0 power2.in 0.38s, entrée y:30→0 power2.out 0.48s, direction inverse si back). Step-6 remplacé par anneau cinématique SVG (r=58, dasharray=364.4, GSAP 3.5s power1.inOut). Texte dynamique lisant secteur/nom depuis localStorage. À 100% : fondu corps + redirect dashboard.html. Fallback sans GSAP. | ✅ Fait |
| 0.22 | **Header hamburger unifié vitrine** — HTML identique sur les 6 pages (index, probleme, solution, confiance, connexion, onboarding) : logo `seba.` à gauche, hamburger à droite. Overlay plein écran `.sh-overlay` (z-index 199, opacity transition). 4 liens `.sh-link` clamp(1.8rem→2.8rem) + CTA émeraude `.sh-cta`. Fermeture : re-clic burger, clic hors nav, Escape. Nav fixe supprimée de index (hero padding ajusté 168→100px). | ✅ Fait |
| 0.23 | **Refonte onboarding — Jalons 1 à 4 complets** — Steps 0–8 en CSS grid overlap, transitions spring `cubic-bezier(.34,1.56,.64,1)` bidirectionnelles (two-rAF). Layout 45/55 % dark. Phone mockup HTML/CSS pur (lock ↔ app). **Step 1** : sélecteur pays 27 pays + champ téléphone avec indicatif pays auto-rempli. **Step 2** : 9 tiles secteur (conciergerie groupée). **Step 3** : sous-secteur conciergerie (3 tiles : location courte durée / copro / entreprise) — affiché uniquement si conciergerie sélectionné, sinon skippé. **Steps 4–8** : services (avec `makeSvcRow`, `addCustomSvc`), identité (swatches couleur, preview live téléphone), écosystème (slug + code SEBA-XXXX), chargement GSAP ring 3.5s, résumé ticket + grille "Et maintenant ?". `saveLS()` persist dans `sebaEntreprise` avec `phone`, `dialCode`, `timezone`. | ✅ Fait |
| 0.21 | **Maturation design system** — Audit et unification de l'exécution sur toutes les pages pro (fond clair conservé). `pro-global.css` réécrit : tokens de design, sidebar unifiée (`.sidebar .nav-item` specificity > inline, nav-label, dot actif, footer), badges sémantiques (actif/attente/relance/info), inputs focus émeraude cohérent (`!important`), hover rows, skeleton light-mode, navigation mobile (hamburger + overlay + JS `toggleSidebar`) ajoutée sur 11 pages pro, grille sidebar standardisée à 220px, tableaux scroll horizontal sur mobile, hiérarchie typographique unifiée (page-title, module-title, label, text-2), utilitaires 8px grid. | ✅ Fait |
| 0.20 | **Refonte index.html v3** — Nouvelle palette encre/émeraude (`--ink:#08090B`, `--emerald:#00F5A0`, etc.), dead code supprimé (`.ha1-.ha5`, `.pipeline`, `.seamless-grid`, `.reveal`), nav flottante `Industries · Automations · Tarifs`, hero glassmorphism cockpit (4s scenes ménage/conciergerie/maintenance), section problème 10 colonnes asymétriques (pc-01=span6, pc-02=span4, pc-03=span4, pc-04=span6), section solution remplacée par 4 métriques vitesse (30s/15s/20s/10s, font-size:68px émeraude), CTA dark `"Reprenez le contrôle de votre entreprise dès aujourd'hui."`, `#cursor-glow` (300px radial, opacity 0.04, blur 40px, suit la souris), Lenis CDN ajouté, boutons spring `cubic-bezier(0.34,1.56,0.64,1)`, View Transitions API + fallback JS. | ✅ Fait |
| 0.19 | **Particules contextuelles** — Refonte Three.js multi-pages (index, problème, solution, confiance, connexion) : opacité 0.18 (était 0.85), taille ~1px (0.028), canvas `position:fixed` couvrant le viewport. Transitions d'état 2.5s `sine.inOut` (machine à blends). Comportements par section : Problem → micro-bruit sur particules de bord uniquement (|nx|>0.62) ; Solution → magnétisme vers AABB des cartes Bento (force 0.004) ; Confiance → halo radial au survol de `.trust-panel` ; Connexion → ligne d'horizon horizontale sous le formulaire. Gravitation CTA : 30-40 particules dans rayon 1.25 unités attirées doucement au survol des boutons principaux. CDN Three.js + GSAP ajoutés à probleme/solution/confiance/connexion.html. | ✅ Fait |
| 0.18 | **Réingénierie visuelle — Part 3 Espace Pro** : `pro-global.css` créé — transitions 0.25s cubic-bezier(0.4,0,0.2,1) sur boutons/sidebar/liens/fiches/modules, hover émeraude sur rows, @keyframes shimmer (dégradé sombre→émeraude+prune, 1.5s), classes .skeleton/.skeleton-text/.skeleton-title/.skeleton-badge/.skeleton-metric/.skeleton-avatar/.skeleton-block + .content-fade-in, scrollbar discrète, :focus-visible global. Lié dans 11 pages pro. | ✅ Fait |
| 0.24 | **Bible de Production Interactive** — `onboarding.html` : Globe CSS pur (sphère radial-gradient + grille repeating-linear-gradient + dot positionné via formule lat/lng), switch globe↔phone selon l'étape, Mouse Glow Pointer sur cartes secteur, Nouveau step 5 Fiscal (Micro-Entreprise/Société/En cours + TVA 20/10/5.5%), renommage steps 5→6, 6→7, 7→8, 8→9, 7 points de progression, 4 phases de chargement cinématiques (0–25%/25–65%/65–90%/90–100%), `saveLS()` étendu (régimeFiscal, tvaRate, tvaTexte). `dashboard.html` : Welcome checklist 3 objectifs (auto-checked, devis, partage lien), confetti canvas sur complétion, Floating Action Button (+/✕) + menu 3 actions, palette Cmd+K (7 pages + 3 actions rapides, navigation clavier ↑↓↵). | ✅ Fait |
| 0.25 | **UX Invisible** — `onboarding.html` : `AudioUI` (Web Audio API, zéro fichier externe) — `playClick()` 660→330 Hz, `playSuccess()` accord mi-sol, `playComplete()` accord do-mi-sol — câblé sur sélection pays/secteur/fiscal/sous-secteur + chaque `validateStep()` réussie + fin de chargement. Globe inertia physique : drag souris et touch, vecteur vitesse, `friction=0.92`, clamp ±40°, rotateX/rotateY sur `globe-wrap` (preserve-3d, perspective 900px). `StateRecovery` : checkpoint sauvegardé à chaque `goStep()`, restauration non-bloquante via bannière fixe bas-centre (8s auto-dismiss, TTL 2h), clear automatique à la complétion. `dashboard.html` : `CmdHistory` localStorage mémorise les 3 dernières navigations, section "Récents" en tête de palette quand recherche vide, icône 🕐 distincte ; `Backspace` sur champ vide re-affiche les recents ; `ArrowUp/Down` avec `preventDefault()`. | ✅ Fait |
| 0.27 | **UX Haute Couture — Onboarding v4 + Sidebar harmonisée** — `onboarding.html` : (1) **Sync chromatique temps réel** : clic pastille → `applyCouleur(hex)` met à jour `--em` via `setProperty`, `.pv-avatar-ring`, `.pv-certified`, `.ph-app-cta`, `.ph-app-hdr-color` en live + `localStorage.user_theme_color`. (2) **Step-1 allégée** : suppression du champ téléphone (friction minimale à l'entrée). (3) **Double bloc horaires (step-7)** : Bloc 1 Lun-Ven 08h-18h + toggle Bloc 2 urgences indépendant avec fade-in, `initHorairesDoubleBloc()`, `toggleHoraireDayStd/Urg()`. Badge aperçu : `🟢 En ligne • Lun-Ven 08h–18h | Urgences Sam-Dim 10h–19h`. (4) **Step-8 centralisé** : 4 champs (email, téléphone avec indicatif auto-sync depuis step-1, mot de passe, confirmation mot de passe) + `checkPwdMatch()` + `togglePwd(id)` → message `❌ Les mots de passe ne correspondent pas`. (5) **Unités de prestation** : "Forfait" → "Unique (Prix fixe)" + options conciergerie `% des revenus / par séjour` injectées dynamiquement. Hint couleur sous swatches. `clients.html` : sidebar harmonisée (suppression "Vue d'ensemble", groupes Principal/Équipe/Compte, `<a class="nav-item">` propres), injection thème `user_theme_color` au démarrage. | ✅ Fait |
| 0.26 | **Refonte Architecte Maître** — `onboarding.html` : Zéro-scroll total (`html,body{overflow:hidden;height:100%;}`, `height:calc(100vh-60px)` sur layout + step-containers). Nav-btns ancrée en absolu `bottom:40px`. `.btn-em:hover` glow émeraude. Téléphone mockup supprimé → **Dashboard Bento holographique** `#ob-bento-panel` (4 cartes CA/Clients/Satisfaction/Prochaine intervention + terminal JetBrains Mono + animation `bento-in`). Globe D3 reste toujours visible : plein format steps 0–1, mini translucide `translate(50%,-45%) scale(0.35)` steps 2+. Module de recherche "Autre activité" : click → grid fade → `openSearch()` avec dictionnaire 90+ métiers (`JOBS[]`), filtre fuzzy live, option `✨ Créer «…»`, navigation clavier (↑↓↵). `BENTO_DATA` : 10 secteurs × 7 métriques (CA, clients, satisfaction, next, terminal body, bar widths). `populateBento()` appelé sur `selectSector`, `pickSub`, `updatePhone(n≥2)`. JetBrains Mono ajouté à Google Fonts. Commit `44c40b3`. | ✅ Fait |

**Identité visuelle active du projet (à partir du Bloc 0.7) :**
- Palette : `#14161A` (ink) · `#00C896` (emerald, accent signal) · `#3D2645` (plum) · `#FAF9F7` (bg) · `#6B6A6F` (text-2) · `#E8E6E1` (border)
- Typographie : Inter uniquement (weights 300–800), hero 800 clamp(2.4rem, 5vw, 3.8rem)
- Patterns réutilisables : `.seamless-grid` (gap:2px trick), `.reveal` (IntersectionObserver), `.section-label` (eyebrow émeraude), `.accent-line` (2px top fixe)
- Les prochains blocs visuels (pro pages, onboarding) doivent reprendre cette identité

---

## PHASE 3 — COHÉRENCE & POLISH (une fois tout cliquable)

| # | Bloc |
|---|------|
| 3.1 | Vérifier que toutes les données affichées (clients, devis, factures) sont cohérentes entre les pages (ex. le CA d'un client dans clients.html correspond à ses factures dans factures.html) |
| 3.2 | Responsive mobile — vérifier toutes les pages sur petit écran |
| 3.3 | Accessibilité de base (contrastes, focus clavier) |
| 3.4 | Relecture des textes (fautes, ton, cohérence du vocabulaire) |
| 3.5 | **Fluidité générale** : animation pageIn sur toutes les pages pro (pro-global.css), suppression de tous les alert() remplacés par toasts, boutons d'action reliés à de vraies pages | ✅ Fait |

---

## PHASE 4 — VALIDATION TERRAIN (avant d'aller plus loin)

| # | Bloc |
|---|------|
| 4.1 | Préparer les questions pour les premiers contacts professionnels |
| 4.2 | Montrer le site à 5-10 professionnels (ménage / conciergerie) |
| 4.3 | Recueillir et trier les retours |
| 4.4 | Ajuster le plan en fonction des retours avant de continuer |

---

## CE QUI VIENT APRÈS (pas avant la Phase 4)

- Vraie base de données / backend (sauvegarde réelle)
- Authentification réelle (connexion sécurisée)
- L'application mobile (gérant + client) — projet séparé, après validation du site
- IA et automatisations avancées

### Prochaine étape immédiate
→ Blocs 0.14–0.18 terminés. Réingénierie visuelle complète (Three.js + GSAP + Bento Grid + onboarding cinématique + transitions pro). Prochains blocs structurels : **1.14** (formulaire création d'intervention depuis planning.html) et **1.15** (vue détaillée d'un devis/facture) pour compléter la Phase 1.

---

## INFRASTRUCTURE AVANCÉE — Lots 0 à 4 (Engine interne + Modules métier)

| # | Module | Fichier | État |
|---|--------|---------|------|
| 0.1 | **Core Engine** — SebaStorage, SebaSync offline-first, SebaCmdPalette, Mode Terrain | `core-ux.html` | ✅ Fait |
| 1.1 | **Cockpit Trésorerie** — Simulateur fiscal Micro/SASU/EURL, slider CA 5k–300k€, cash-flow mensuel | `cockpit-treso.html` | ✅ Fait |
| 1.2 | **Registre des Charges** — TVA déductible auto, 8 catégories, filtre, export CSV | `registre-charges.html` | ✅ Fait |
| 1.3 | **BFR Prédictif** — Stocks + Créances − Dettes, acomptes & situations de travaux avec slider % | `bfr-predictif.html` | ✅ Fait |
| 1.4 | **Compta Expert FEC** — Agrégateur bancaire fictif DSP2, rapprochement de factures, export FEC DGFiP | `compta-expert.html` | ✅ Fait |
| 2.1 | **Agenda Élastique** — Vue semaine drag & drop, couleurs par type, multi-semaines | `agenda-elastique.html` | ✅ Fait |
| 2.2 | **Haversine Engine** — Formule orthodromique, carte schématique SVG, matrice distances, optimiseur Nearest Neighbor | `haversine-engine.html` | ✅ Fait |
| 2.3 | **Mutation Contextuelle** — Pipeline RDV → Devis → Facture → Encaissé, Kanban 4 colonnes | `mutation-contextuelle.html` | ✅ Fait |
| 2.4 | **Flotte & Télémétrie** — Véhicules (batterie VE), IK DGFiP 2026, outillage QR/NFC simulé | `flotte-telemetrie.html` | ✅ Fait |
| 3.1 | **Studio Factures** — Éditeur live (Facture/Devis/Avoir), TVA multisite, aperçu imprimable, export PDF | `studio-factures.html` | ✅ Fait |
| 3.2 | **Signature & Paiement** — Canvas tactile SHA-signé, QR code paiement canvas, Tap-to-Pay NFC simulé | `signature-payment.html` | ✅ Fait |
| 3.3 | **CRM Technique** — Fiches clients, notes techniques, rating ★, photos base64, recherche live | `crm-tech.html` | ✅ Fait |
| 3.4 | **Contentieux & Recouvrement** — 5 niveaux de relance, CGV art. L441-6, export LRE + dossier Huissier | `contentieux-recouvrement.html` | ✅ Fait |
| 4.1 | **Écotaxe · BSD · RSE** — Calculateur TEP/TGN/TGAP, Bordereau Suivi Déchets, tableau RSE annuel | `trava-dechets.html` | ✅ Fait |
| 4.2 | **PPSPS & Risques** — Plans de prévention (R4532-68), grille risques INRS F×G, attestations | `prevention-risques.html` | ✅ Fait |
| 4.3 | **RH & Compagnonnage** — Registre personnel, pointeuse crypto-vérifiée (SHA-256 Web Crypto), paniers/zones DGFiP | `rh-compagnonnage.html` | ✅ Fait |
| 4.4 | **Crypto Backup** — Journal audit SHA-256 chaîné (Web Crypto API réel), export/import AES-256-GCM PBKDF2 | `crypto-backup.html` | ✅ Fait |
| G.1 | **Globe D3.js interactif** — Projection orthographique D3 v7 + TopoJSON world-atlas@2, drag libre toutes directions, auto-spin Y, État 2 transition 950ms vers pays sélectionné + lueur #05F29A SVG glow | `onboarding.html` | ✅ Fait |
