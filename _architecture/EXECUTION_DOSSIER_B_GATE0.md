# SEBA — Dossier d'exécution B : Kit complet du Gate 0 (validation terrain)

Statut : kit prêt à l'emploi. **Aucun premier contact réel n'a été effectué à ce jour (2026-07-22)** — le recrutement terrain est une action humaine que seul le fondateur peut exécuter, je ne peux ni contacter, ni appeler, ni interviewer qui que ce soit à sa place. Ce document ne modifie rien au produit — il sert uniquement à mener les entretiens définis dans `SEBA_DECISION_LOG.md` (GATE-0). Zone concernée : Cap-d'Ail, Beausoleil, Roquebrune-Cap-Martin, Menton (opérationnel) + Monaco (acquisition uniquement, voir DEC-008). Secteur : nettoyage de logements/locations saisonnières + conciergeries donneuses d'ordre.

---

## 0. Tableau de suivi du recrutement (à tenir à jour au fur et à mesure, par le fondateur)

Distinction explicite entre les étapes — ne jamais présenter un contact comme un entretien réalisé, ni un intérêt verbal comme un engagement réel (voir §6).

| Nom / entreprise (anonymisable ensuite) | Profil (§2) | Identifié | Contacté | Réponse obtenue | Entretien planifié | Entretien réalisé | Second entretien accepté | Test accepté | Client(s) réel(s) mobilisable(s) |
|---|---|---|---|---|---|---|---|---|---|
| *(une ligne par contact, à remplir au fil de l'eau)* | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

**État actuel de ce tableau : entièrement vide.** Aucune ligne n'a encore été créée — je ne présente le Gate 0 comme "démarré" qu'à partir du moment où une première ligne réelle y sera portée par toi.

---

## 1. Objectifs de recherche

### Hypothèses à confirmer
- Les professionnels du nettoyage/conciergerie de cette zone jonglent avec plusieurs outils disjoints (téléphone, WhatsApp, Excel, agenda papier) pour gérer demandes, planning et facturation.
- Une part significative des demandes de nettoyage arrive par recommandation ou réseau personnel plutôt que par une recherche structurée.
- Le temps perdu en échanges non structurés avant de pouvoir chiffrer une prestation (aller-retours de messages, appels manqués) est un vrai point de friction reconnu spontanément.
- Les conciergeries locales sous-traitent réellement une partie de leur nettoyage à des indépendants/petites entreprises, avec un besoin de coordination répété.
- Un professionnel serait prêt à publier une fiche présentant son activité si cela ne demande pas d'effort disproportionné et ne le met pas en concurrence déloyale avec son réseau actuel.

### Hypothèses à invalider (activement chercher à les casser, pas seulement les vérifier)
- "Les professionnels n'ont besoin de rien de plus que le bouche-à-oreille" — si confirmée de façon large et argumentée, c'est un signal STOP ou AJUSTER fort.
- "Le client type ne cherche jamais un nouveau prestataire, il reste avec celui qu'il connaît" — si confirmée, la fiche publique aurait peu de valeur d'acquisition dans cette zone précise.
- "Les professionnels refuseront catégoriquement de payer quoi que ce soit, même après avoir vu de la valeur" — à tester réellement, pas supposer.
- "Le formulaire de demande qualifiée est perçu comme une barrière plutôt qu'une aide" — un risque réel si le vocabulaire ou la longueur du formulaire rebute plutôt qu'il ne facilite.

### Informations qui influenceront réellement la roadmap (pas de la couleur, du contenu qui change une décision)
- Le vocabulaire exact utilisé par les professionnels pour décrire leurs prestations (à réutiliser mot pour mot dans le formulaire sectoriel, plutôt que le vocabulaire supposé aujourd'hui dans `businessTypes.js`).
- Les informations qu'un professionnel juge indispensables avant d'accepter une demande (conditionne les champs obligatoires du formulaire de demande qualifiée).
- Le canal de communication réellement préféré (conditionne DEC-004 — SMS, email, ou autre).
- Une estimation, même grossière, du volume de demandes mensuelles plausibles (conditionne directement le critère de sortie "densité minimale", voir §5).
- Le nombre de professionnels réellement disposés à s'engager dans un test (conditionne la taille réelle du premier cercle, DEC-007).

---

## 2. Profils à interroger

| Profil | Nombre cible | Où les trouver |
|---|---|---|
| Indépendants du nettoyage (auto-entrepreneurs, solo) | 4-5 | Réseau personnel du fondateur, recommandations croisées |
| Petites entreprises avec intervenants (2-15 employés) | 3-4 | Réseau personnel, annuaires professionnels locaux, chambre de commerce |
| Conciergeries (donneuses d'ordre) | 3-4 | Recherche locale, réseau, plateformes de conciergerie de locations saisonnières |
| Propriétaires de résidences secondaires/locations saisonnières | 2-3 | Réseau personnel, groupes/communautés de propriétaires de la zone |
| Gestionnaires de locations (professionnels gérant plusieurs biens pour des tiers) | 2 | Recoupe souvent les conciergeries, à distinguer si un rôle est purement gestion sans nettoyage propre |
| Donneurs d'ordre côté Monaco (acquisition uniquement, voir DEC-008) | 1-2 | Réseau, si accès facilité |

Total minimal : 10 professionnels + 5 acteurs côté demande, cohérent avec les seuils pratiques posés dans `SEBA_DECISION_LOG.md` (GATE-0).

---

## 3. Guide d'entretien professionnel

**Principe directeur** : ne jamais demander "trouveriez-vous ça utile ?". Toujours ancrer sur un comportement passé récent, concret, daté si possible.

### Fonctionnement actuel et outils
1. Racontez-moi votre dernière semaine de travail, du lundi au dimanche — comment se sont enchaînées vos journées ?
2. Quand une nouvelle demande de nettoyage arrive, comment ça se passe concrètement, de la première prise de contact jusqu'au jour de l'intervention ? Montrez-moi si possible sur votre téléphone.
3. Quels outils utilisez-vous aujourd'hui pour gérer vos clients, votre planning, vos devis et vos factures ? (noter précisément : papier, Excel, WhatsApp, logiciel dédié, autre)

### Volume, fréquence, saisonnalité
4. Combien de prestations avez-vous réalisées le mois dernier ? Et le même mois l'année dernière, si vous vous en souvenez ?
5. Y a-t-il des périodes de l'année où vous avez beaucoup plus ou beaucoup moins de demandes ? Lesquelles ?
6. Quel est, en moyenne, le montant d'une prestation de nettoyage chez vous ?
7. Quelles zones couvrez-vous aujourd'hui ? Avez-vous déjà refusé une demande parce qu'elle était trop loin ?

### Devis, demandes perdues, organisation
8. La dernière fois que vous avez fait un devis, combien de temps ça vous a pris entre la demande et l'envoi du prix ?
9. Vous est-il arrivé de perdre une demande parce que vous avez mis trop de temps à répondre, ou parce que l'information donnée était insuffisante ? Racontez un exemple précis.
10. Si vous avez des employés ou des collègues qui interviennent avec vous, comment organisez-vous qui va où et quand ?
11. Comment gardez-vous une trace du travail réalisé (photos, rapport, autre) ? Un client vous a-t-il déjà demandé une preuve après coup ?

### Facturation, paiement, litiges
12. Comment facturez-vous vos clients aujourd'hui, et comment sont-ils payés ?
13. Avez-vous déjà eu un désaccord avec un client sur une prestation (qualité, retard, absence) ? Comment ça s'est réglé ?

### Acquisition de clients
14. Comment vos clients actuels vous ont-ils trouvé, dans la majorité des cas ?
15. Avez-vous déjà cherché à obtenir de nouveaux clients activement (publicité, réseau, plateforme) ? Qu'est-ce que ça a donné ?

### Intérêt réel et engagement (pas une question fermée)
16. Je vous montre une fiche professionnelle test [montrer une maquette simple] — qu'est-ce que vous en pensez concrètement, qu'est-ce qui manquerait pour que ce soit utile chez vous ?
17. Si un client vous envoyait une demande déjà structurée (type de prestation, date, adresse, photos) plutôt qu'un simple message ou appel, qu'est-ce que ça changerait pour vous dans votre façon de répondre ?
18. Seriez-vous disposé à tester ça avec vos propres clients existants dans les prochaines semaines ? (noter la réponse exacte, pas une reformulation optimiste)
19. Si cet outil vous faisait gagner du temps de façon mesurable, dans quelles conditions accepteriez-vous de payer, et combien vous semblerait raisonnable ?
20. Qu'est-ce qui vous empêcherait aujourd'hui d'adopter un outil comme celui-ci ?

---

## 4. Guide d'entretien côté demande (propriétaires, gestionnaires, conciergeries donneuses d'ordre)

1. La dernière fois que vous avez eu besoin d'un nettoyage (changement de locataire, fin de séjour, entretien régulier), comment avez-vous trouvé le prestataire ?
2. Qu'est-ce qui compte le plus pour vous dans le choix d'un professionnel de nettoyage — racontez comment vous avez choisi la dernière fois ?
3. Aviez-vous confiance dans le prestataire choisi ? Sur quoi reposait cette confiance ?
4. Combien de temps s'est écoulé entre votre demande et l'intervention réelle ?
5. Avez-vous eu un devis avant l'intervention ? Comment ça s'est passé ?
6. Avez-vous déjà eu un problème avec un prestataire (retard, absence, qualité, dégât) ? Comment ça s'est réglé ?
7. Si vous deviez décrire votre besoin aujourd'hui, préféreriez-vous appeler, envoyer un message, ou remplir un formulaire ? Pourquoi ?
8. Quelles informations accepteriez-vous de fournir avant même d'avoir un premier contact avec le professionnel (nom, téléphone, adresse, photos) ? Lesquelles refuseriez-vous ?
9. Si on vous demandait de créer un compte avant de pouvoir envoyer votre demande, que feriez-vous ? Et si le compte n'était demandé qu'à la toute fin ?
10. Comment payez-vous aujourd'hui vos prestataires de nettoyage ?
11. Aimeriez-vous pouvoir suivre l'avancement d'une intervention (confirmation, avant/après, facture) au même endroit ? Avez-vous déjà eu besoin de réclamer après une prestation ?
12. À quelle fréquence avez-vous réellement besoin de ce type de service (une fois, régulièrement, saisonnier) ?

---

## 5. Estimation de la densité du marché

**Avertissement explicite** : ce qui suit est une estimation construite à partir d'entretiens qualitatifs, jamais une statistique officielle. À présenter comme telle dans la synthèse finale, sans faux habillage de précision.

Méthode proposée pendant les entretiens (questions 4, 5, 7 du guide professionnel et 12 du guide demande servent directement à ça) :
- **Nombre de prestations plausibles par mois** : croiser le volume déclaré par les professionnels interrogés (question 4) avec le nombre de professionnels actifs estimés dans la zone (à recouper avec des annuaires locaux/chambre de commerce si possible, en plus des entretiens).
- **Nombre de professionnels disponibles** : décompte réel des indépendants/entreprises identifiés pendant le recrutement, pas une estimation théorique.
- **Nombre de clients qu'un professionnel pilote peut inviter** : demander explicitement pendant l'entretien (question 18 du guide professionnel) combien de ses clients existants il serait prêt à faire tester.
- **Saisonnalité** : réponse à la question 5 — la zone pilote (locations saisonnières) est probablement fortement saisonnière (été), à documenter explicitement pour ne pas lancer le pilote au pire moment de l'année.
- **Concentration géographique** : noter si les professionnels interrogés interviennent surtout sur une des 4 communes ou de façon dispersée — conditionne si "la zone pilote" doit être resserrée encore davantage.
- **Fréquence de récurrence** : nettoyage de fin de séjour (récurrent, haute fréquence en saison) vs nettoyage ponctuel (rare) — à distinguer, ils ont des dynamiques de volume très différentes.
- **Volume minimum nécessaire pour observer la boucle** : hypothèse de départ, à corriger après les entretiens — quelques dizaines de demandes réelles sur la durée du pilote semblent nécessaires pour observer ne serait-ce qu'un cycle complet demande→facture plusieurs fois par professionnel ; en dessous, les métriques de conversion n'auront aucun sens statistique.
- **Risque de recherches sans résultat** : si le nombre de fiches publiées reste très faible au démarrage, noter explicitement ce risque plutôt que l'ignorer — un client qui cherche et ne trouve rien est une mauvaise première impression.
- **Risque de professionnels sans demande** : symétriquement, si un professionnel publie sa fiche et ne reçoit rien pendant plusieurs semaines, le risque de désengagement est réel (déjà signalé dans `SEBA_PRODUCT_GAP_ANALYSIS.md` §18) — à anticiper en recrutant les tout premiers clients testeurs en même temps que les professionnels, pas en séquence.

---

## 6. Engagements recherchés

Distinguer explicitement, dans la grille de prise de notes (§7), ces quatre niveaux — ne jamais les confondre dans la synthèse finale :

| Niveau | Définition | Exemple de formulation à noter telle quelle |
|---|---|---|
| **Intérêt verbal** | La personne dit que ça a l'air bien, sans rien engager | "Oui ça a l'air intéressant" |
| **Intention de test** | La personne accepte verbalement de participer, sans date ni action concrète encore posée | "Je veux bien essayer un jour" |
| **Engagement réel** | Une action concrète est actée : un deuxième rendez-vous fixé, un accord explicite à tester avec de vrais clients à une date donnée | "On se revoit le [date] pour que je teste avec 3 de mes clients" |
| **Volonté de payer** | Une indication chiffrée ou conditionnelle, même provisoire | "Si ça me fait gagner 2h par semaine, je paierais autour de X€/mois" |

Objectifs minimaux à obtenir pendant le Gate 0 (cohérents avec les seuils pratiques déjà posés) :
- des professionnels acceptant explicitement un second entretien ;
- des professionnels acceptant de tester un prototype avec de vrais clients ;
- des clients/donneurs d'ordre acceptant de tester une vraie demande ;
- au moins quelques indications chiffrées de volonté de payer, même approximatives.

---

## 7. Documents opérationnels

### 7.1 — Message de recrutement des professionnels (à adapter au canal : SMS, message direct, appel)

> Bonjour [Prénom], je travaille sur un projet qui pourrait simplifier la gestion des demandes de nettoyage/conciergerie pour les professionnels de la région (Menton, Roquebrune, Beausoleil, Cap-d'Ail). Avant de construire quoi que ce soit, je veux comprendre comment ça se passe vraiment aujourd'hui pour vous. Auriez-vous 20-30 minutes pour en discuter, sans engagement d'aucune sorte ? Je me déplace volontiers.

### 7.2 — Message de recrutement côté clients/donneurs d'ordre

> Bonjour [Prénom], je prépare un projet lié à la mise en relation avec des professionnels de nettoyage/entretien pour les résidences de la région. Avant de construire quoi que ce soit, j'aimerais comprendre comment vous trouvez et choisissez un prestataire aujourd'hui. Auriez-vous 15-20 minutes à m'accorder ?

### 7.3 — Script d'introduction à l'entretien (à lire ou paraphraser en début de rendez-vous)

> Merci d'avoir accepté ce temps. Je ne suis pas là pour vous vendre quoi que ce soit aujourd'hui — je cherche à comprendre votre réalité concrète, pas à confirmer une idée que j'ai déjà. N'hésitez pas à me dire si une question ne vous parle pas, ou si la réponse honnête est "je ne sais pas" ou "ça ne m'intéresse pas" — c'est exactement ce genre de réponse qui m'aide le plus. Est-ce que je peux prendre des notes pendant qu'on parle ? [voir note de consentement ci-dessous]

### 7.4 — Note de consentement et de confidentialité (à présenter avant l'entretien)

> Les informations que vous partagez serviront uniquement à orienter la conception d'un projet en cours de validation. Vos réponses seront anonymisées dans toute synthèse partagée à des tiers. Aucune donnée personnelle (nom, coordonnées) ne sera conservée au-delà de ce qui est nécessaire pour vous recontacter si vous y consentez. Vous pouvez à tout moment refuser de répondre à une question ou demander l'arrêt de l'entretien.

### 7.5 — Grille de prise de notes (structure recommandée par entretien)

| Champ | Contenu |
|---|---|
| Profil | (indépendant / entreprise / conciergerie / propriétaire / gestionnaire / donneur d'ordre Monaco) |
| Date | |
| Zone d'intervention déclarée | |
| Volume mensuel déclaré | |
| Outils actuels | |
| Problèmes évoqués (verbatim) | |
| Réaction à la fiche publique | |
| Réaction à la demande qualifiée | |
| Niveau d'engagement obtenu | (intérêt verbal / intention de test / engagement réel / volonté de payer, avec citation exacte) |
| Raison de refus/réticence exprimée (le cas échéant) | |
| Vocabulaire exact utilisé pour décrire les prestations | |

### 7.6 — Tableau anonymisé des réponses (modèle)

Une ligne par entretien, colonnes reprenant les champs de la grille ci-dessus, avec un identifiant anonyme (ex. `PRO-01`, `DEM-01`) à la place du nom.

### 7.7 — Matrice hypothèse confirmée / infirmée / incertaine

| Hypothèse (voir §1) | Confirmée | Infirmée | Incertaine | Preuve (citations anonymisées) |
|---|---|---|---|---|
| (une ligne par hypothèse listée en §1) | | | | |

### 7.8 — Grille de classement des problèmes

| Problème évoqué | Fréquence (nb d'entretiens l'ayant mentionné) | Gravité perçue (faible/modérée/élevée, jugée par l'intensité du langage utilisé) | Lien avec une brique du produit prévue |
|---|---|---|---|

### 7.9 — Modèle de synthèse finale

Structure recommandée : résumé exécutif (5-10 lignes) ; ce qui est confirmé ; ce qui est infirmé ; ce qui reste incertain ; changements recommandés (formulaire, fiche, positionnement, cible, zone, modèle économique, ordre des phases) ; estimation de densité (avec l'avertissement de non-scientificité) ; liste des engagements réels obtenus (par niveau, §6) ; recommandation GO/AJUSTER/STOP argumentée.

### 7.10 — Modèle de décision GO / AJUSTER / STOP

| Critère | Constat | Poids dans la décision |
|---|---|---|
| Problèmes réels observés (pas supposés) | | |
| Fréquence et gravité des problèmes | | |
| Nombre de professionnels prêts à un engagement réel | | |
| Nombre de clients mobilisables pour un premier test | | |
| Densité minimale plausible (voir §5) | | |
| Capacité du fondateur (temps réellement disponible constaté) | | |
| Volonté de payer exprimée | | |
| Faisabilité opérationnelle (rien d'observé qui rende le pilote impraticable) | | |
| Risques juridiques majeurs identifiés pendant les entretiens | | |
| **Décision finale** | GO / AJUSTER (préciser quoi) / STOP (préciser pourquoi) | |

---

## 8. Critères de sortie du Gate 0

Provisoires, sans précision artificielle — à ajuster une fois les premiers entretiens réalisés, pas figés avant.

- **GO** envisageable si : plusieurs professionnels (pas un seul) expriment un problème réel et récurrent correspondant à ce que Seba propose de résoudre, ET au moins quelques engagements réels (pas seulement verbaux) sont obtenus des deux côtés (professionnels et clients), ET aucun risque juridique majeur n'est remonté pendant les entretiens, ET la densité estimée (même grossière) suggère un volume suffisant pour observer au moins un cycle complet de la boucle par professionnel pendant la durée du pilote.
- **AJUSTER** envisageable si : l'intérêt est réel mais le formulaire/vocabulaire/positionnement testé ne correspond pas à ce qui a été conçu, ou si la zone/cible doit être resserrée ou élargie, ou si le modèle économique envisagé se heurte à un refus argumenté et généralisé.
- **STOP** envisageable si : la majorité des professionnels interrogés n'expriment aucun problème réel correspondant à la proposition, ou si aucun engagement réel (au-delà de l'intérêt verbal poli) n'est obtenu malgré plusieurs tentatives, ou si un risque juridique/opérationnel majeur et bloquant est identifié.

Un GO ne doit jamais reposer uniquement sur des avis positifs exprimés poliment — la grille §7.10 est conçue pour forcer une lecture croisée de plusieurs critères plutôt qu'un jugement d'ambiance.
