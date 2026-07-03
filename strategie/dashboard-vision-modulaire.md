# Seba — Vision du dashboard modulaire (le "plus puissant du marché")

Recherche comparative menée pour définir la direction du futur tableau de bord Seba (dashboard.html et ses dérivés). Objectif : fusionner les points forts des meilleurs outils du marché plutôt que copier un seul modèle.

## Sources consultées

- Housecall Pro vs Jobber vs ServiceTitan — https://fieldservicesoftware.io/comparisons/housecall-pro-vs-jobber-vs-servicetitan/
- ServiceTitan Competitors — https://www.getjobber.com/academy/servicetitan-competitors/
- ServiceTitan vs Housecall Pro — https://www.servicetitan.com/comparison/servicetitan-vs-housecall-pro
- Best Cleaning Business Management Software 2026 — https://wifitalents.com/best/cleaning-business-management-software/
- Launch27 Alternatives — https://getcleanly.net/blog/launch27-alternatives/
- Property Management Dashboards 2026 — https://www.secondnature.com/blog/property-management-dashboard
- AppFolio Best for Ease of Use 2026 — https://www.appfolio.com/blog/best-property-management-software-for-ease-of-use-2026
- Meilleurs logiciels CRM & Facturation 2026 — https://independant.io/logiciel-crm-facturation/
- Meilleurs logiciels facturation auto-entrepreneurs — https://go.sellsy.com/blog/meilleurs-logiciels-facturation-auto-entrepreneurs

## Direction retenue : le croisement Notion × Apple × Stripe

### 1. Architecture — Notion (blocs) + Apple Widgets (contrainte de taille)
- L'utilisateur démarre sur une page propre et glisse-dépose les modules dont il a besoin (système de "blocs" à la Notion).
- Les blocs respectent des tailles standardisées (carré, rectangle — logique widgets iOS) pour que la personnalisation ne casse jamais la mise en page, quel que soit l'agencement choisi par l'utilisateur.

### 2. Moteur — interconnectivité façon Zapier/Make, solidité façon Airtable
- L'utilisateur connecte ses outils tiers (Shopify, banque, réseaux sociaux) via clés API, sans code.
- Le dashboard agit comme hub central : la donnée est structurée en arrière-plan avec la rigueur d'un Airtable, mais affichée de façon simplifiée côté utilisateur.

### 3. UX/UI et data visualisation
- **Data viz** : inspirée de Stripe (graphiques épurés, interactifs, couleurs rassurantes) — référence déjà validée dans `bloc-refonte-visuelle-index.md`.
- **Zéro friction** : inspirée de Qonto (beaucoup d'espace blanc, pas de menus surchargés). Règle : toute action complexe (ex. connecter un outil tiers) doit tenir en 3 clics max.
- **Vitesse** : inspirée de Linear (réactivité immédiate) + raccourcis clavier façon Superhuman pour les power users.

### 4. Le différenciant — barre de commande universelle IA
- Au lieu de configurer manuellement l'espace, l'utilisateur tape une requête en langage naturel (ex. "Affiche-moi un widget avec mon CA du mois et mes 5 factures en retard") et le bloc correspondant se génère et se place automatiquement.
- C'est l'élément pensé pour dépasser la concurrence (aucun des outils analysés ne propose de génération de widget par commande IA).

## Résumé en une phrase
Squelette ultra-clean façon Stripe/Odoo, rendu modulable par un système de blocs façon Notion, et boosté par une couche IA qui génère les widgets à la demande.

## Point de vigilance
`Seba-vision-strategie.md` place les "tableaux de bord intelligents" en **V2** (après validation du cœur V1 : CRM, planning, devis, factures, Stripe, portail client). La barre de commande IA de cette vision est un composant V2/V3, pas un prérequis pour lancer V1 — à séquencer en conséquence plutôt qu'à construire tout de suite.

## Statut
Direction validée le 2026-07-03. **Implémenté le 2026-07-04** : voir `docs/widgets.js` (nouveau moteur de widgets) et `docs/dashboard.html` (grille modulaire, personnalisation, glisser-déposer, widgets compagnon, barre IA simulée). Vérifié sans erreur console sur 4 secteurs via test headless.

Bug sitewide découvert au passage (non corrigé ici, hors scope) : la sidebar mobile ne bascule jamais en position fixe sur aucune page pro (conflit `!important` dans `pro-global.css` entre la règle de nav mobile et une règle de sécurité mobile plus large). À traiter dans une tâche dédiée avec retest de toutes les pages pro.
