# SEBA — Analyse d'écart : contrat de vision vs produit actuel

Statut : document d'analyse. S'appuie sur `SEBA_VISION_CONTRACT.md` (source de vérité stratégique) et `SEBA_CURRENT_STATE_AUDIT.md` (source de vérité factuelle sur le dépôt). Ne propose pas encore d'architecture cible détaillée (voir `SEBA_TARGET_ARCHITECTURE.md`).

Niveaux d'effort utilisés : faible / modéré / élevé / très élevé (relatifs entre eux, pas des estimations chiffrées). Priorité : critique / haute / moyenne / basse, jugée par rapport à la boucle produit prioritaire du contrat de vision (§11 du contrat), pas par facilité technique.

---

## 1. Face publique

**Existe déjà** : rien de directement exploitable côté public. Une seule trace indirecte : le bouton "copier le lien" du dashboard (`docs/app/dashboard.html:1922`) construit une URL `seba.app/p/{slug}` qui anticipe une convention de fiche publique, sans qu'aucune route ne l'implémente.

**Existe partiellement** : `businessTypes.js` (11 secteurs modélisés côté configuration) pourrait alimenter des filtres de recherche/catégories publiques, mais c'est un objet JS statique sans contrepartie base de données — non conçu pour une lecture publique cross-tenant.

**N'existe pas** : recherche, carte, liste de résultats, page de résultats, tout indexage public des professionnels.

**Réutilisable** : `businessTypes.js` comme référentiel de catégories/services (sous réserve d'audit — voir `SEBA_DOMAIN_MODEL.md`).

**Modification structurelle nécessaire** : la face publique nécessite une lecture cross-tenant, ce que le modèle RLS actuel (strictement scopé par `auth.uid()`/`account`, jamais de lecture publique) n'autorise nulle part aujourd'hui — voir §12 du contrat de vision et `SEBA_SECURITY_AND_TRUST.md`.

**Risque** : aucun aujourd'hui (rien n'existe, donc rien à casser) — le risque se déplacera entièrement sur la conception de cette nouvelle lecture publique.

**Effort** : très élevé. **Priorité** : haute (c'est le vide le plus structurant identifié par le contrat de vision).

## 2. Face privée Seba Pro

**Existe déjà, largement** : CRM clients, devis, factures, planning, équipe, interventions — 13 pages fonctionnelles câblées à SebaDB, confirmées opérationnelles (`SEBA_CURRENT_STATE_AUDIT.md` §3).

**Modification structurelle nécessaire** : aucune dans l'immédiat pour continuer à fonctionner en l'état ; en revanche, l'intégration de la demande qualifiée publique (§9 ci-dessous) demandera d'exposer un point d'entrée nouveau dans ce moteur.

**Risque** : faible à court terme (le moteur privé peut continuer à fonctionner indépendamment de tout chantier public).

**Effort pour le sécuriser sans le refondre** : modéré (corriger `create_profile_and_company`, traiter la perte silencieuse de synchronisation — voir audit §4/§6). **Priorité** : haute (fondation transversale, indépendante de l'expansion publique, cf. principe de progression du contrat).

## 3. Recherche métier + localisation

**Existe déjà** : aucune recherche multi-professionnels. `haversine-engine.html` (page-outil déconnectée) contient une logique de distance orthodromique et un optimiseur de tournée, mais appliqué à un seul compte (ses propres interventions), pas à une recherche cross-tenant de professionnels.

**Réutilisable** : la logique mathématique de `haversine-engine.html` (formule, pas l'intégration) pourrait informer un futur moteur de recherche géographique, sous réserve d'audit de qualité du code (page jamais reliée à SebaDB, jamais testée en conditions réelles).

**N'existe pas** : zones d'intervention structurées et interrogeables publiquement, index géographique, filtres de recherche.

**Effort** : élevé. **Priorité** : haute à moyen terme, pas court terme (le contrat de vision situe la recherche large en long terme, §13).

## 4. Parcours guidé par description du besoin (Parcours B)

**Existe déjà** : rien. Aucune brique de qualification conversationnelle du besoin n'existe dans le dépôt (ni UI, ni logique, ni prompt IA dédié à cet usage — les fonctions IA existantes, `ai-relay.ts`/`assistant-technique.ts`, sont orientées assistance interne au patron, pas qualification client publique).

**Effort** : élevé (nécessite une brique de compréhension de langage naturel + mapping vers métiers). **Priorité** : basse — le contrat de vision le place explicitement après le parcours A (§13, court terme = fiche + demande structurée d'abord).

## 5. Fiche professionnelle publique

**Existe déjà** : rien de fonctionnel. `client-fiche.html` est une fiche CRM interne (patron consultant ses propres clients), pas une fiche professionnelle publique — vérifié avec certitude (voir audit §4, pas une supposition depuis le nom du fichier).

**Réutilisable comme matière première** : les champs déjà saisis à l'onboarding et dans `reglages.html` (nom, secteur, description, services, zone, horaires — via `businessTypes.js` et les tables `profiles`/`companies`, actuellement non fonctionnelles, voir §8 ci-après) constituent une bonne partie du contenu attendu d'une fiche publique.

**Modification structurelle nécessaire** : `profiles`/`companies` doivent d'abord être corrigées (bug de contrainte, `SEBA_CURRENT_STATE_AUDIT.md` §4) avant de pouvoir servir de socle à une fiche publique — sinon la fiche publique hériterait d'un sous-système jamais validé en conditions réelles.

**Effort** : élevé. **Priorité** : critique (c'est le premier chantier du court terme selon le contrat de vision, §13).

## 6. Revendication de fiche

**Existe déjà** : rien. Aucune notion de fiche "prévisualisée" vs "revendiquée" n'existe dans le modèle de données actuel.

**Effort** : modéré une fois la fiche publique elle-même modélisée (c'est avant tout un état supplémentaire sur la même entité, pas un sous-système séparé). **Priorité** : haute, indissociable de la fiche publique (le contrat de vision est explicite : "une fiche non revendiquée ne doit jamais être présentée comme officiellement vérifiée", §8 du contrat).

## 7. QR code

**Existe déjà** : deux briques techniques isolées mais non reliées à un usage réel : `signature-payment.html` génère un QR code de paiement (canvas), `flotte-telemetrie.html` simule un QR/NFC sur de l'outillage. Aucune des deux n'est un QR code d'accès à une fiche professionnelle.

**Réutilisable** : la génération canvas de QR code de `signature-payment.html` est réutilisable techniquement comme brique (génération), pas comme fonctionnalité (le cas d'usage est différent).

**Effort** : faible à modéré une fois la fiche publique et son URL stable définies (le QR code n'est qu'un encodage de cette URL). **Priorité** : moyenne — vient après la fiche elle-même (§9 du contrat de vision : "canal d'accès, pas le produit").

## 8. Demande qualifiée

**Existe déjà, substantiellement** : `client_requests` est un modèle de données réel et cohérent — statuts (`nouvelle/en_cours/terminee/annulee`), lien vers l'intervention, lien vers la conversation, clôture avec preuve. C'est la brique la plus proche de la vision parmi tout ce qui existe.

**Limite structurelle actuelle** : ce cycle n'existe que pour un client déjà lié via `client_accounts`, elle-même créée uniquement par un patron qui invite un client qu'il connaît déjà (`client-provision.ts`). **Aucun chemin pour un visiteur anonyme** — confirmé avec certitude par lecture des policies RLS (`client_requests_insert` exige un `client_accounts` préexistant) et par l'absence de toute page d'inscription client autonome dans le dépôt.

**Modification structurelle nécessaire** : introduire un mécanisme de création de compte/demande pour un visiteur qui n'a jamais été invité par ce professionnel — c'est un changement de nature (aujourd'hui : invitation descendante patron→client ; demain : initiative ascendante client→professionnel inconnu), pas une simple extension de règles RLS.

**Effort** : élevé (nouveau mode de création de compte client, nouvelle policy d'insertion, articulation avec l'identification légère mentionnée au contrat §16). **Priorité** : critique — c'est le cœur de la boucle produit.

## 9. Qualification sectorielle (formulaire adapté au métier)

**Existe déjà** : `businessTypes.js` modélise déjà des champs spécifiques par secteur (`specificFields`), mais utilisés aujourd'hui uniquement pour la configuration interne (onboarding, dashboard), jamais pour un formulaire de demande orienté client.

**Réutilisable** : la structure de données est directement adaptable à un formulaire de demande par métier, sous réserve d'étendre son usage au-delà de la configuration interne.

**Effort** : modéré. **Priorité** : haute (fait partie du même chantier que la demande qualifiée).

## 10. Acceptation avant conversation

**Existe déjà, entièrement** : c'est exactement le modèle actuel de `client_requests` + `seba_messages(request_id)` — la conversation liée à une demande n'existe déjà que dans le contexte d'une demande, avec un accès scopé sur l'assignation courante.

**Écart** : le modèle actuel suppose une demande toujours acceptée implicitement dès sa création (le client est déjà connu) — il manque l'état explicite "en attente d'acceptation" avant tout accès conversationnel pour une demande venant d'un inconnu.

**Effort** : faible à modéré (ajout d'un état dans la machine à états existante plutôt qu'un nouveau système). **Priorité** : critique, indissociable de la demande qualifiée publique.

## 11. Conversation liée à une demande

**Existe déjà, entièrement** — voir §10 et l'audit §3. C'est l'une des briques les plus solides du dépôt actuel.

**Effort pour l'étendre au public** : faible (la structure tient déjà ; le travail porte sur qui peut initier une demande, pas sur le mécanisme de conversation lui-même). **Priorité** : haute.

## 12. Espace client

**Existe déjà** : `client-espace.html` + `client-connexion.html` sont fonctionnels, avec demandes/conversations/historique pour un client déjà invité.

**Écart** : conçu aujourd'hui pour un client invité par un professionnel unique et déjà connu — devra évoluer pour représenter la relation d'un même client public avec plusieurs professionnels distincts (favoris, historique multi-pro) mentionnée au contrat de vision §3.

**Effort** : modéré. **Priorité** : moyenne (vient après que le flux public de demande existe).

## 13. Continuité jusqu'au paiement

**Existe déjà, partiellement** : devis → facture → statut "signé"/"payé" existent comme changements de statut manuels. La brique de paiement réel (Stripe) est explicitement une démo (`stripe-service.js`, auto-documentée comme telle).

**N'existe pas** : encaissement réel, lien de paiement fonctionnel, réconciliation automatique.

**Effort** : élevé (intégration Stripe réelle, conformité facturation France déjà notée comme priorité dans `strategie/plan-marche-produit-2026.md`). **Priorité** : moyenne à court terme — le contrat de vision inclut le paiement dans la boucle fondamentale (§11), mais son intégration réelle peut suivre la validation du pipeline demande→intervention sur le pilote, sans bloquer les premières briques.

## 14. Distinction vérifié / abonné / sponsorisé

**Existe déjà** : rien. Aucune notion de vérification, d'abonnement Seba Pro à paliers, ni de sponsorisation n'existe dans le modèle actuel (le compte est aujourd'hui binaire : existe ou n'existe pas).

**Effort** : modéré à élevé selon le niveau de sophistication visé. **Priorité** : basse à court terme (le contrat de vision situe la monétisation par paliers en long terme, §13), mais le principe de distinction (badge non achetable) doit être posé dès la conception de la fiche publique pour éviter une dette de conception — priorité haute pour le principe, basse pour l'implémentation complète.

## 15. Séparation public / privé

**Existe déjà** : une séparation stricte compte par compte (RLS `auth.uid()`/`account`), mais **aucune notion de "donnée publique"** n'existe dans le schéma actuel — tout est privé par défaut, sans exception.

**Modification structurelle nécessaire** : c'est le changement le plus profond requis par la vision — introduire une catégorie de données lisibles sans authentification et sans restriction de compte, ce qui n'a **aucun précédent** dans l'architecture actuelle. Voir la comparaison d'approches dans `SEBA_TARGET_ARCHITECTURE.md` §12 (du prompt d'audit).

**Risque** : élevé si mal conçu (première brique de lecture cross-tenant du projet — voir `SEBA_SECURITY_AND_TRUST.md`).

**Effort** : très élevé. **Priorité** : critique — bloquant pour toute la face publique.

## 16. Expansion sectorielle future

**Existe déjà** : `businessTypes.js` est explicitement conçu pour l'extension par configuration plutôt que par fork (revendiqué dans `strategie/Seba-vision-strategie.md:13`, cohérent avec ce qui est observé dans le code — ajouter un secteur ne touche pas le noyau `seba-data.js`).

**Effort pour un nouveau secteur métier** : faible, si le pattern actuel est respecté. **Priorité** : basse pour l'instant (le contrat de vision est explicite : pas d'expansion avant validation de la boucle sur un pilote restreint, §12/§13).

## 17. Internationalisation future

**Existe déjà** : le sélecteur de pays à l'onboarding (27 pays, fuseaux horaires `TZ_MAP`) montre qu'une notion de pays existe déjà côté configuration, mais rien n'indique de structuration en "Country Pack" (devises, taxes, mentions légales par pays) — non vérifié en détail dans cet audit, signalé comme à approfondir si ce chantier redevient prioritaire.

**Effort** : élevé si abordé maintenant. **Priorité** : basse (hors périmètre court/moyen terme).

---

## Synthèse des priorités (vue consolidée)

| Élément du contrat | Priorité | Effort | Bloquant pour |
|---|---|---|---|
| Séparation public/privé (fondation données) | critique | très élevé | tout le reste de la face publique |
| Fiche professionnelle publique | critique | élevé | revendication, QR, recherche |
| Demande qualifiée ouverte au public | critique | élevé | acceptation, conversation publique |
| Acceptation avant conversation (extension) | critique | faible-modéré | conversation publique |
| Correction de `create_profile_and_company` | haute | faible | fiche publique (dépend de `profiles`/`companies`) |
| Revendication de fiche | haute | modéré | distinction vérifié/sponsorisé |
| Sécurisation du socle privé existant (sync, RGPD) | haute | modéré | robustesse générale, indépendant de la face publique |
| QR code | moyenne | faible-modéré | dépend de la fiche publique |
| Recherche métier + localisation | haute (moyen terme) | élevé | ouverture publique large |
| Espace client multi-pro | moyenne | modéré | fidélisation, favoris |
| Paiement réel (Stripe) | moyenne | élevé | continuité jusqu'au paiement |
| Distinction vérifié/abonné/sponsorisé (principe) | haute (principe) / basse (implémentation) | modéré-élevé | confiance de la fiche publique |
| Parcours guidé par description (B) | basse | élevé | — |
| Expansion sectorielle | basse | faible (si pattern respecté) | — |
| Internationalisation | basse | élevé | — |

Cette synthèse alimente directement `SEBA_MIGRATION_PLAN.md` (phasage) et `SEBA_EXECUTION_ROADMAP.md` (ordre de travail).

## 18. Angles morts identifiés au-delà du contrat de vision (ajouté 2026-07-22)

Le contrat de vision décrit ce que Seba doit accomplir et pour qui. Il ne couvre pas — volontairement — les questions économiques et opérationnelles suivantes, qui conditionnent pourtant la viabilité réelle du pilote. Aucune n'est actuellement traitée par un document existant. Base de chaque point : hypothèse commerciale ou information manquante, pas un fait vérifié dans le dépôt.

### Économie du produit
- Volonté de payer des professionnels du secteur/zone retenus — non mesurée (dépend directement de GATE-0).
- Modèle de revenus pendant et après le pilote (gratuit, palier payant, commission sur transaction) — non tranché.
- Coût d'acquisition d'un professionnel et d'un client — non estimé.
- Coût de support et de modération par professionnel/par demande — non estimé, dépend directement de la charge réelle observée pendant le pilote (voir capacité opérationnelle ci-dessous).
- Marge potentielle une fois un modèle de revenus choisi — non calculable avant que ce modèle existe.
- Valeur réellement perçue par chaque type d'utilisateur (professionnel, client, conciergerie donneuse d'ordre) — seule GATE-0 peut commencer à y répondre.

### Acquisition des deux faces
- Stratégie de recrutement des professionnels au-delà du premier cercle invité (DEC-007) — non définie au-delà de la liste d'attente.
- Stratégie d'acquisition des clients (comment un client de la zone pilote découvre l'existence d'une fiche Seba en premier lieu) — non abordée dans aucune décision prise à ce jour.
- Densité minimale nécessaire des deux côtés pour produire des rencontres réelles mesurables — question posée dans la revue critique de DEC-008, non résolue.
- Gestion d'une recherche publique sans résultat (aucun professionnel disponible dans une zone/un métier) — aucune décision de produit prise sur ce cas, pourtant probable en tout début de pilote avec peu de fiches.
- Gestion d'un professionnel publié sans aucune demande reçue — risque de désengagement rapide du premier cercle invité si la valeur perçue est nulle dans les premières semaines.
- Stratégie d'amorçage local du marché ("cold start" classique des marketplaces à deux faces) — non abordée.

### Qualité, annulation et litiges
- Absence du professionnel ou du client à un rendez-vous convenu — aucun statut ni processus prévu dans le modèle de domaine actuel (`client_requests`/interventions n'ont pas d'état "no-show").
- Retard, dommage, prestation contestée — aucun mécanisme de signalement de litige distinct du signalement de fiche (DEC-003 couvre la modération de fiche, pas la résolution de litige de prestation).
- Annulation et remboursement — aucun état ni règle définis, alors que le paiement réel (même différé après le pilote) en dépendra directement.
- Suspension d'un professionnel en cours de mission — cas non traité (DEC-003 couvre la suspension de fiche, pas la gestion d'une mission déjà engagée au moment de la suspension).
- Responsabilité de Seba en cas de dommage causé par un professionnel "vérifié" — question juridique non posée dans ce processus, à traiter avec un regard juridique externe, pas par une décision d'architecture.

### Paiement
- Rôle exact de Seba dans le flux financier — simple lien de paiement (comme `stripe-service.js` le simule aujourd'hui) ou encaissement par la plateforme (avec responsabilités et obligations réglementaires différentes) : non tranché, alors que la différence a des implications légales et de conformité importantes.
- Acomptes, commissions, remboursements — aucune règle définie.
- Responsabilité en cas d'échec ou de litige de paiement — dépend directement du choix précédent (lien simple vs encaissement plateforme).

### Capacité opérationnelle du fondateur
- Temps disponible réel pour cumuler développement, recrutement terrain (DEC-008/GATE-0), et modération manuelle (DEC-003) — jamais quantifié dans ce processus.
- Nombre de professionnels réellement accompagnables en parallèle avec cette charge cumulée — non estimé.
- Nombre de vérifications gérables par semaine — proposé comme hypothèse à observer (DEC-003), pas encore mesuré.
- Charge de support et de recrutement cumulée — non estimée avant les premières semaines réelles.
- Seuil à partir duquel une aide humaine ou une automatisation devient nécessaire — non défini, à documenter dès que les premiers chiffres réels du pilote existent.

Ces points ne bloquent pas nécessairement GATE-0 lui-même (les entretiens terrain peuvent d'ailleurs aider à répondre à plusieurs d'entre eux), mais ils bloquent une décision d'ouverture du pilote au-delà du premier cercle restreint tant qu'ils restent sans réponse.
