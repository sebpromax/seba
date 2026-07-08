# 🌍 RAPPORT D'AUDIT GLOBAL : PRÊT POUR L'INTERNATIONAL - SEBA

*Audit réalisé le 2026-07-08. Méthode : inspection directe du code source, capture Puppeteer (Chrome headless, desktop 1440×900 + mobile 375×812) de `index.html`, `dashboard.html`, `onboarding.html`, `tarifs.html`, et consultation croisée de 3 modèles indépendants (Gemini — expert produit, Mistral — direction artistique, Groq — contre-audit infrastructure) sur la base de contenus et de faits factuels vérifiés dans le code. Aucun fichier d'architecture backend (`docs-backend.md`, `supabase-schema.sql`) n'a été transmis à un tiers — l'analyse infrastructure ci-dessous est une synthèse locale, contre-vérifiée par un second modèle sur mes conclusions, pas sur le schéma brut.*

---

## 1. Utilité Produit & Alignement de la Proposition de Valeur

**Verdict : le produit résout un vrai chaos opérationnel (devis/factures/planning/équipe centralisés, chiffres réels sur le dashboard, export de données, droits par employé), mais le discours qui l'emballe ne parle pas la langue de sa cible.**

Le hero d'`index.html` — *"Le système d'exploitation des entreprises de services."* — est un positionnement de plateforme technique, pas une promesse métier. Un patron d'entreprise de ménage ou de conciergerie ne se projette pas dans un "système d'exploitation" : ce vocabulaire vient du monde des développeurs et des levées de fonds tech, pas du langage d'un artisan ou d'un gérant de PME. Verdict croisé (Gemini, expert produit) : *"H1 bien trop jargonneux pour un non-technophile ; il évoque un OS complexe, pas une solution métier."*

L'onboarding en 8 étapes est fonctionnellement complet (secteur, cœur de métier, identité visuelle, services, horaires) et pose les bonnes questions métier — mais son habillage verbal contredit son sérieux : *"Donnez un nom à votre aventure"*, *"Votre voix, votre univers"*, *"Votre espace est prêt à naître"*, *"C'est parti !"*. Ce ton (poétique, parfois enfantin) fonctionnerait pour une app grand public ou un outil créatif — pas pour un logiciel de gestion qu'un dirigeant évalue en le comparant, consciemment ou non, à Sage, QuickBooks ou ServiceTitan. Verdict croisé : *"Pour une cible internationale exigeante habituée à la rigueur de ces solutions, ce ton manque de professionnalisme et pourrait être perçu comme immature, créant un frein culturel."*

La page tarifs est en revanche le point le plus solide du site : *"Des tarifs simples. Sans surprise."*, structure à 4 paliers claire, mention explicite "pas de frais cachés" — c'est le seul endroit où le ton "sérieux et rassurant" attendu par la cible est déjà atteint.

---

## 2. Esthétique & Score de Confiance Typographique (Pro vs Gadget Tech)

**Verdict sans filtre (confirmé par consultation croisée Mistral, direction artistique) : le système visuel actuel penche clairement vers le "cyberpunk / hacker / dev-tool", pas vers l'outil institutionnel.**

Preuves concrètes observées (pas une impression) :
- Le hero d'`index.html` affiche le texte-clé en dégradé vert lumineux avec un halo radial derrière — un traitement esthétique directement issu des landing pages IA/crypto de 2023-2025, pas des codes visuels d'un éditeur de logiciel de gestion établi.
- Le widget dashboard **"Serenity Score"** affiche un chiffre entouré d'une animation de particules dorées façon confetti, avec le label **"VIGILANCE"** — un nom et un traitement visuel plus proches d'une app de bien-être/astrologie que d'un tableau de bord financier.
- Un autre widget s'appelle littéralement **"Cockpit financier"** — un anglicisme/jargon technique directement visible par l'utilisateur, alors que l'audit du copywriting marketing (voir section 3) ne trouvait pas ce type de terme dans les pages publiques : il est présent dans le produit connecté lui-même.
- La page d'accueil de l'onboarding affiche un globe terrestre 3D stylisé générique — imagerie "startup tech mondiale" vue des centaines de fois, qui ne dit rien de spécifique à Seba ni du sérieux métier visé.
- Typographie : graisse 800, letter-spacing -0.04em, très condensée. Verdict croisé : *"Non viable pour l'international. Les langues longues (allemand) ou à caractères étendus casseront les mises en page."*

**Directives précises pour corriger le tir** (synthèse de la consultation croisée) :
| Élément actuel | Correction recommandée |
|---|---|
| Vert néon `#00FF9D` avec glow radial | Vert émeraude profond `#10B981` (déjà utilisé sur le dashboard) en aplat, sans halo ; réserver aux CTA et accents, pas au texte de titre |
| "Serenity Score" + particules dorées | Renommer en indicateur factuel ("Indice d'activité", "Score de santé du compte") ; remplacer l'animation de particules par une jauge circulaire minimaliste |
| "Cockpit financier" | Renommer en "Performance financière" ou "Vue financière" |
| Globe 3D générique (onboarding) | Retirer ou remplacer par une illustration vectorielle sobre, ou simplement un fond neutre |
| Typographie condensée poids 800 | Réduire à poids 600-700, letter-spacing -0.01 à -0.02em max, garder une police sans-serif classique (la police actuelle casse dès qu'un mot allemand ou un texte à caractères étendus est injecté) |
| Effet glow/halo sur le hero marketing | Supprimer sur le texte ; conserver au maximum un liseré discret (1px, faible opacité) sur les CTA uniquement |

Le vert et le fond sombre en tant que tels ne sont pas le problème — c'est leur traitement (glow, particules, condensation extrême) qui signe "gadget" plutôt que "outil élitiste".

---

## 3. Audit Linguistique & Copywriting

**Constat : le langage est globalement correct et sans faute, mais truffé de familiarités et d'emojis qui cassent l'autorité attendue d'un outil professionnel.**

Relevé précis (occurrences réelles, `docs/onboarding.html` sauf mention contraire) :

| Tournure actuelle | Problème | Remplacement proposé |
|---|---|---|
| "Donnez un nom à votre aventure" | Registre poétique/loisir, pas professionnel | "Nommez votre entreprise" |
| "Votre voix, votre univers" | Vague, jargon de branding personnel | "Identité visuelle" |
| "Votre espace est prêt à naître" | Métaphore de naissance, déplacée pour un logiciel B2B | "Votre espace est prêt" |
| "C'est parti !" (`onboarding.html`, `index.html`) | Trop familier/oral | "Accéder à mon espace" |
| "Parfait !" (réaction automatique) | Ton assistant grand public | Retirer, ou "Confirmé." |
| Emojis en préfixe de label (✨, 🚀, 💡, 🏢, 🚨) | Dilue le sérieux, incohérent d'une culture à l'autre (un emoji lu comme ludique en France peut être perçu comme non professionnel ailleurs) | Retirer des labels de champs et titres ; tolérable uniquement en confirmation ponctuelle, jamais en label |
| "Le système d'exploitation des entreprises de services" (hero) | Jargon plateforme/dev, pas un bénéfice métier | Formuler autour du résultat concret (ex. "Toute votre entreprise de terrain, pilotée depuis un seul endroit.") |
| "Cockpit financier" (`dashboard.html`) | Anglicisme/jargon technique visible utilisateur | "Performance financière" |

Aucun jargon de développeur classique ("workflow", "widget" exposé tel quel, "cockpit" en dehors du cas ci-dessus) n'a été trouvé dans les pages marketing — le problème n'est donc pas la technicité du vocabulaire, mais son registre trop familier/poétique, à l'opposé de la rigueur attendue par une cible B2B internationale.

---

## 4. Prêt pour l'International ? Ingénierie & Infrastructure

**Constat central : il n'existe aujourd'hui aucune infrastructure d'internationalisation. Le produit est un logiciel français, pas un logiciel international disponible en français.**

Points de friction identifiés (analyse locale, contre-vérifiée par un second modèle sur le raisonnement, sans transmission du schéma brut à un tiers) :

1. **Aucun système i18n.** Chaque chaîne de caractères est écrite en dur en français directement dans le HTML (`lang="fr"` fixe sur chaque page). Ajouter une langue aujourd'hui signifierait dupliquer chaque page, pas activer une locale.
2. **Pas de devise par ligne de facture/devis.** Les montants sont stockés en nombre simple, la devise n'existe qu'en tant que symbole préférentiel du compte (paramètre d'affichage), pas comme un code ISO 4217 attaché à chaque transaction — un prérequis pour opérer dans plusieurs pays/devises simultanément.
3. **Aucune structure de taxation.** Pas de colonne de taux de TVA ni d'équivalent Sales Tax — chaque montant est un total plat. Les régimes fiscaux diffèrent radicalement d'un pays à l'autre (TVA européenne à taux multiples, Sales Tax américaine variable par État) ; rien dans le modèle de données actuel ne les distingue.
4. **Horodatage sans fuseau horaire explicite.** Les interventions sont stockées en date + heure locale sans référence de fuseau — ambigu dès qu'un compte (ou son équipe) opère sur plusieurs fuseaux horaires.
5. **Téléphones en texte libre**, sans validation ni format international (E.164).
6. **Formats de date/nombre non localisés** (point ajouté par le contre-audit) : l'affichage suppose implicitement des conventions françaises (jour/mois/année, virgule décimale) sans logique d'adaptation par locale utilisateur.
7. **Numérotation séquentielle des factures** (`#F-0099`) : format probablement incompatible avec les exigences légales de continuité de numérotation de certains pays — à vérifier pays par pays avant tout déploiement facturant réellement à l'étranger.
8. **Aucune mention des obligations légales de facturation par pays** (SIRET/TVA intracommunautaire pour la France ; équivalents locaux ailleurs) dans les gabarits de documents.
9. **Conformité protection des données hors RGPD** (point ajouté par le contre-audit) : la politique de confidentialité créée ce jour couvre le RGPD (UE) ; un déploiement international croiserait d'autres régimes (CCPA en Californie, LGPD au Brésil, etc.) non couverts à ce stade.

Rien de ceci n'est bloquant pour continuer à opérer en France aujourd'hui — mais toute annonce commerciale d'ambition "internationale" avant de traiter au moins les points 1 à 4 exposerait à des promesses non tenues dès le premier client hors zone euro/francophone.

---

## 5. Plan d'Action Non-Négociable

Par ordre de priorité d'exécution :

1. **Copywriting (impact immédiat, coût faible)** — Remplacer les 8 tournures relevées en section 3 (onboarding + hero + dashboard). Retirer les emojis des labels de champs et titres de section. Aucune dépendance technique, faisable en un seul chantier ciblé.
2. **Renommage des widgets dashboard** — "Serenity Score" → indicateur factuel ; "Cockpit financier" → "Performance financière". Cohérent avec le point 1, même chantier.
3. **Neutraliser l'effet glow/particules** sur le hero marketing et le widget de score — CSS uniquement, pas de refonte structurelle.
4. **Retirer ou remplacer le globe 3D générique** de l'écran d'accueil de l'onboarding par une illustration sobre ou un fond neutre.
5. **Réduire la graisse/condensation typographique** des titres (poids 800→600-700, letter-spacing -0.04em→-0.02em max) — prérequis technique avant toute traduction, sans quoi les futures langues casseront les mises en page.
6. **Ajouter une colonne devise (ISO 4217) par ligne de facture/devis** dans le schéma — prérequis structurel avant toute vente hors zone euro.
7. **Ajouter une structure de taux de taxe** (TVA/Sales Tax) par ligne, paramétrable par pays.
8. **Stocker un fuseau horaire explicite** avec chaque intervention plutôt qu'une heure locale implicite.
9. **Mettre en place une couche i18n** (fichiers de traduction/clés, `lang` dynamique) avant toute traduction du site — actuellement chaque langue supplémentaire nécessiterait de dupliquer chaque page HTML.
10. **Auditer pays par pays les obligations légales de facturation** (numérotation, mentions obligatoires) avant toute commercialisation active hors de France.

Les points 1 à 5 sont des corrections de surface, réalisables rapidement et sans risque, qui changent immédiatement la perception "gadget tech" vs "outil professionnel". Les points 6 à 10 sont des fondations structurelles à traiter avant toute expansion commerciale réelle hors du marché francophone — pas avant.
