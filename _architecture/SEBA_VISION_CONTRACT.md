# SEBA — Contrat de vision

Statut : vision stratégique validée. Ce document ne décrit ni architecture technique, ni migration, ni implémentation. Il fixe ce que Seba doit accomplir, pour qui, selon quel ordre — pas comment le construire.

---

## 1. Définition de Seba

Seba est une plateforme à deux faces qui relie la découverte d'un professionnel par un client à la réalisation complète et payée de la prestation, dans une seule boucle continue de bout en bout : découverte, qualification du besoin, mise en relation, réalisation, preuve, facturation, paiement, historique, fidélisation.

Seba n'est pas seulement un logiciel de gestion pour professionnels. Il n'est pas non plus seulement un annuaire ou une marketplace grand public. C'est la connexion entre les deux qui constitue le produit.

## 2. Le problème résolu

Côté client : trouver un professionnel adapté à un besoin (connu ou mal défini), sans devoir contacter plusieurs interlocuteurs au hasard ni décrire son besoin de façon libre et non structurée.

Côté professionnel : recevoir des demandes exploitables et qualifiées plutôt que des messages libres non filtrés, puis disposer d'un seul outil pour transformer cette demande en devis, planning, intervention, preuve, facture et paiement — sans ressaisie ni changement d'outil à chaque étape.

## 3. Les utilisateurs

- **Client public** : peut rechercher des professionnels, consulter les fiches et commencer une demande sans compte. Une identification légère et vérifiée peut devenir nécessaire au moment de transmettre définitivement la demande, afin de protéger les professionnels contre le spam et de permettre le suivi.
- **Client avec espace** : dispose d'un espace personnel regroupant demandes, conversations, devis, interventions, rapports, factures, paiements, favoris et historique.
- **Professionnel indépendant** : gère à la fois sa présence publique et son activité opérationnelle.
- **Patron d'entreprise** : même logique que le professionnel indépendant, à l'échelle d'une équipe.
- **Employé terrain** : intervient sur les missions qui lui sont assignées, avec un accès limité à son périmètre.
- **Administrateur Seba** : rôle garant de la confiance de la plateforme (modération, vérification, arbitrage) — son périmètre exact reste à définir, voir section 16.

## 4. Les deux faces de la plateforme

**Face publique** : ce que voit un client, avec ou sans compte — recherche, fiches professionnelles, dépôt de demande.

**Face privée (Seba Pro)** : ce que le professionnel utilise pour piloter son activité — demandes reçues, conversations, clients, devis, planning, équipe, interventions, factures, paiements, historique.

Les deux faces doivent rester profondément connectées : une demande déposée côté public devient directement une donnée exploitable côté privé, sans étape de transfert ni de ressaisie manuelle.

## 5. Les deux parcours de recherche client

**Parcours A — le client sait ce qu'il cherche.** Il indique un métier ou service et une localisation. Seba lui présente une liste et/ou une vue cartographique de professionnels, avec filtres et fiches permettant de décider.

**Parcours B — le client ne sait pas quel professionnel chercher.** Il décrit son problème en langage libre. Seba l'aide à identifier le type de professionnel nécessaire, puis le redirige vers les résultats correspondants (parcours A).

Les deux parcours convergent vers la même destination : une fiche professionnelle et un dépôt de demande structuré.

## 6. Le principe de demande qualifiée

Le client ne contacte pas librement un professionnel par un simple message. Il remplit une demande structurée et adaptée au métier concerné (type de prestation, localisation, date souhaitée, description, urgence, photos, informations techniques, budget facultatif).

Cette demande n'est ni un devis ni une conversation ouverte : c'est une intention qualifiée que le professionnel peut évaluer avant tout engagement.

Le professionnel peut : accepter, demander une précision encadrée, refuser, indiquer une indisponibilité, indiquer que la demande est hors zone, ou indiquer qu'il ne propose pas ce service.

## 7. Le déverrouillage de la conversation après acceptation

La conversation libre ne s'ouvre qu'après acceptation de la demande par le professionnel. Avant cette acceptation, il n'existe pas de messagerie libre entre client et professionnel.

Une fois débloquée, la conversation devient le fil conducteur de la prestation : elle peut porter texte, photos, documents, messages vocaux, propositions de rendez-vous, devis, validations, acompte, paiement, rapport d'intervention et facture. Elle n'est pas un canal détaché du travail — elle en est le support.

## 8. La fiche publique professionnelle

Chaque professionnel peut disposer d'une fiche publique consultable dans les résultats de recherche, sur Internet, via un lien direct ou un QR code : identité, activité, description, services, photos, zone d'intervention, horaires, avis, éléments de vérification et formulaire de demande.

Les moyens de contact directs sont configurables selon le métier et les préférences du professionnel. Par défaut, ils ne doivent pas permettre de contourner entièrement le parcours de demande qualifiée. Des exceptions peuvent être prévues pour certains services urgents ou nécessitant un appel immédiat.

Une fiche non revendiquée par son professionnel ne doit jamais être présentée comme officiellement vérifiée. La revendication et l'activation d'une fiche sont des étapes distinctes de sa simple existence ou prévisualisation.

## 9. Le rôle du QR code

Le QR code est un canal d'accès, pas le produit. Il permet d'ouvrir la fiche publique ou une action précise (demande de devis, réservation, paiement, demande d'avis, assistance) depuis un support physique du quotidien professionnel (véhicule, vitrine, carte de visite, flyer, facture, signature d'email, document).

## 10. Le rôle du moteur privé Seba Pro

Le professionnel dispose d'un espace privé pour gérer demandes, conversations, prospects, clients, devis, planning, employés, interventions, checklists, photos, rapports, factures, paiements, relances et historique.

Le produit professionnel déjà existant constitue le socle fonctionnel et la principale base de travail de cette future plateforme. Son code, son modèle de données et son architecture devront toutefois être audités avant de décider précisément ce qui sera conservé, adapté, refactorisé ou remplacé.

Le parcours professionnel complet : être visible → recevoir une demande qualifiée → l'accepter → ouvrir la conversation → créer un devis → planifier → affecter → réaliser → prouver → facturer → encaisser → fidéliser.

## 11. Le cycle complet jusqu'au paiement

La boucle fondamentale que Seba doit réussir, dans l'ordre :

un client trouve ou scanne une fiche → il transmet une demande qualifiée → le professionnel accepte → la conversation s'ouvre → le devis est créé → l'intervention est planifiée → le travail est réalisé → la preuve est fournie → la facture est émise → le paiement est reçu → l'historique est conservé.

Chaque étape alimente la suivante sans rupture ni ressaisie.

## 12. Le périmètre sectoriel initial

Seba ne couvre pas tous les métiers dès le départ. La première famille visée concerne des services réalisés chez le client ou sur un bien immobilier (par exemple : nettoyage, conciergerie, entretien immobilier, jardinage, entretien de piscine, vitrerie, dératisation, petite maintenance, bricolage planifiable), qui partagent un schéma commun : client → adresse → besoin → demande → devis → déplacement → intervention → preuve → facture.

Les métiers reposant sur une réservation standardisée en établissement (coiffure, esthétique, massage...) pourront être étudiés plus tard, mais ne doivent pas être mélangés au premier moteur.

Cette liste définit une famille stratégique compatible avec la vision de Seba, pas la liste des métiers à lancer simultanément. Le pilote devra retenir un nombre beaucoup plus limité de métiers après recherche terrain.

## 13. La vision à court, moyen et long terme

**Court terme** : comprendre et stabiliser le produit professionnel existant ; créer une fiche publique de qualité ; permettre sa revendication et son accès par QR code ; construire la demande client structurée ; protéger le professionnel par la qualification ; ouvrir la conversation après acceptation.

**Moyen terme** : relier la demande au reste du moteur privé existant (devis, planning) ; construire l'espace client complet ; tester le cycle entier sur une zone géographique et quelques métiers restreints.

**Long terme** : ouvrir progressivement la recherche publique à plus large échelle ; monétiser par paliers de valeur ; étendre de manière contrôlée par zone géographique, secteur et pays, en choisissant à chaque étape l'axe d'expansion le mieux validé par les données.

La vision de long terme ne doit jamais devenir une liste de fonctionnalités à construire immédiatement — l'ordre stratégique prime sur l'exhaustivité.

## 14. Les principes produit non négociables

- Pas de messagerie libre avant qualification et acceptation de la demande.
- Pas de badge de confiance simplement acheté.
- Distinction claire entre vérification, abonnement Seba Pro et résultat sponsorisé.
- Pas de ressaisie inutile entre la demande initiale et les opérations professionnelles qui en découlent.
- Séparation stricte entre données publiques et données professionnelles privées.
- Consultation publique possible sans compte.
- Création de compte demandée seulement lorsqu'elle devient réellement utile au parcours.
- Lancement limité à quelques métiers et une zone pilote avant toute extension.
- Progression ordonnée : la boucle produit prioritaire doit être validée avant toute expansion sectorielle ou géographique majeure. Les fondations transversales indispensables peuvent avancer en parallèle lorsque cela réduit les risques.
- Réutilisation du produit existant lorsque c'est pertinent, sans que ce principe interdise une refonte si un audit démontre qu'elle est nécessaire.

## 15. Les éléments explicitement repoussés

Seba ne doit pas devenir, en particulier dans les phases court et moyen terme :

- un annuaire mondial vide ;
- une messagerie ouverte remplie de spam ;
- une copie de Google Maps ou de Planity ;
- un simple générateur de QR codes ;
- une collection de fiches payantes sans valeur opérationnelle ajoutée ;
- un système où celui qui paie est présenté comme le plus fiable ;
- une marketplace couvrant tous les métiers dès le départ ;
- une banque ou un remplaçant de Stripe ;
- une accumulation de fonctionnalités sans ordre ni boucle commune ;
- plusieurs produits juxtaposés sans connexion entre eux.

## 16. Les questions encore ouvertes (non tranchées dans ce document)

- Le périmètre exact et les responsabilités du rôle d'administrateur Seba.
- Le métier et la zone géographique retenus pour le premier test du cycle complet.
- Les modalités précises d'existence d'une fiche publique avant sa revendication par le professionnel concerné.
- Le modèle économique exact de la fiche gratuite au démarrage (ouverte à tous ou réservée à un premier cercle).
- La manière technique de séparer données publiques et données professionnelles privées — question d'architecture, pas de vision.
- L'articulation exacte entre le moteur privé existant et les futures données publiques — question d'audit technique, pas de vision.
- Le moment exact où l'identification ou la création d'un compte devient obligatoire dans le parcours de demande client.
- La politique d'affichage des coordonnées directes du professionnel, afin de concilier accessibilité, urgences et protection du parcours de demande qualifiée.

Ces questions appartiennent au futur audit d'architecture, pas au présent contrat de vision.
