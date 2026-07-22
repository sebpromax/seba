# SEBA — Journal des décisions

Statut : chaque entrée porte son propre statut (PROPOSÉE / VALIDÉE — PRINCIPE / VALIDÉE — ORIENTATION PROVISOIRE). Une validation de principe fixe une direction et des règles générales, pas encore une implémentation ni un détail technique définitif — voir le détail de chaque entrée pour ce qui reste à trancher par l'audit technique. Ce document sert de support à l'arbitrage humain.

---

### DEC-001 — Option d'architecture globale

- **Contexte** : le contrat de vision impose une face publique nouvelle sans figer la manière technique de la construire (§10 du contrat, questions ouvertes §16).
- **Options** : (A) évolution progressive de l'existant, (B) refonte structurelle progressive, (C) évolution du backend + extension frontend stricte sans refonte du cœur privé — voir `SEBA_TARGET_ARCHITECTURE.md` §1.
- **Recommandation** : Option C.
- **Arguments** : le cœur privé fonctionne et est bien sécurisé (aucune preuve qu'il a besoin d'être refondu pour le pilote) ; la face publique n'a aucune fondation existante à préserver, donc aucun coût de migration à payer pour bien la structurer dès le départ.
- **Risques** : dérive possible si la discipline de séparation entre nouveau code public et ancien code privé n'est pas maintenue dans le temps.
- **Décision humaine attendue** : valider ou choisir une autre option.
- **Décision** : orientation Option C validée provisoirement (message utilisateur du présent audit) — "conserver pour le pilote le moteur professionnel privé qui fonctionne ; créer le futur domaine public avec une structure propre et distincte ; ne pas lancer de refonte générale du cœur privé sans preuve qu'elle est nécessaire." Explicitement qualifiée de non définitive et non équivalente à une autorisation d'implémentation.
- **Confirmation explicite (2026-07-22)** : ce statut n'évolue pas vers une validation définitive tant que les conditions suivantes ne sont pas réunies :
  1. conception détaillée de la frontière public/privé (DEC-002 et son mécanisme de synchronisation) ;
  2. modèle de données public stabilisé ;
  3. résultats réels des tests RLS et multi-tenant (pas seulement leur conception sur le papier) ;
  4. coût réel d'intégration avec le cœur privé mesuré pendant la Phase 0/1, pas seulement estimé ;
  5. absence de blocage découvert pendant la stabilisation du socle existant.
- **Statut** : VALIDÉE — ORIENTATION PROVISOIRE (ne vaut pas autorisation d'implémentation).

### GATE-0 — Validation terrain du pilote (préalable obligatoire avant le Groupe 3)

- **Contexte** : aucune validation terrain n'a été réalisée à ce jour pour le secteur/zone retenus en DEC-008, alors que deux documents stratégiques historiques du dépôt (`strategie/Seba-vision-strategie.md` §6, `strategie/plan-marche-produit-2026.md` Phase A) la recommandaient explicitement avant tout développement. Sans cette étape, la fiche publique et le formulaire de demande qualifiée seraient conçus sur des hypothèses non vérifiées plutôt que sur un besoin confirmé.
- **Nature** : ce n'est pas une décision d'arbitrage mais un jalon obligatoire — aucun développement du Groupe 3 (`SEBA_EXECUTION_ROADMAP.md`) ne commence avant que ce Gate rende une décision explicite.
- **Objectif minimal** (seuils pratiques proposés, pas une preuve statistique) :
  - interroger au moins 10 professionnels du nettoyage ou de la conciergerie de la zone pilote ;
  - interroger au moins 5 acteurs côté demande (propriétaires, gestionnaires, conciergeries donneuses d'ordre, responsables de logements) ;
  - concentrer les entretiens sur la zone pilote (Cap-d'Ail, Beausoleil, Roquebrune-Cap-Martin, Menton), en incluant des acteurs d'acquisition basés à Monaco si pertinent (voir clarification DEC-008) ;
  - documenter les outils réellement utilisés aujourd'hui par ces professionnels ;
  - identifier les problèmes récurrents et leur fréquence/gravité ;
  - tester le vocabulaire du futur formulaire de qualification directement auprès des interviewés ;
  - vérifier l'intérêt réel pour la fiche publique, la demande qualifiée et Seba Pro (pas un intérêt de politesse) ;
  - identifier les raisons de refus ou de non-adoption exprimées ;
  - obtenir des engagements concrets de professionnels disposés à participer au pilote.
- **Livrables attendus** : guide d'entretien, synthèse anonymisée, problèmes classés par fréquence et gravité, hypothèses confirmées, hypothèses infirmées, changements recommandés dans le pilote.
- **Décision de sortie attendue** : GO (le pilote démarre tel que conçu), AJUSTER (le pilote démarre avec des modifications identifiées), ou STOP (le secteur/zone/produit ne correspond pas à un besoin suffisant, retour à DEC-008).
- **Ce que ce Gate bloque** : tout développement du Groupe 3 (fondation de données publiques), Groupe 4 (fiche publique) et Groupe 5 (demande qualifiée publique) de `SEBA_EXECUTION_ROADMAP.md`.
- **Ce que ce Gate ne bloque pas** : les corrections du Groupe 1 (fondations du socle privé existant) et la mise en place encadrée de la liste d'attente publique (DEC-007), qui peuvent avancer en parallèle.
- **Statut** : OBLIGATOIRE — EN ATTENTE D'EXÉCUTION.

### DEC-002 — Approche de séparation public/privé des données

- **Contexte** : aucune notion de donnée publique n'existe dans le schéma actuel — c'est le changement le plus structurant requis par la vision.
- **Options comparées** : table publique dédiée, vue publique sécurisée, projection périodique, service d'indexation externe, réplication contrôlée — voir `SEBA_DOMAIN_MODEL.md` §3.
- **Décision** : variante renforcée de l'Option A (table/modèle publique dédiée, strictement séparée des données privées), avec les principes suivants :
  1. Le professionnel choisit explicitement les informations qu'il souhaite publier.
  2. La première publication est volontaire et explicite.
  3. Une projection publique distincte est créée.
  4. Les champs déjà approuvés comme publics peuvent ensuite être synchronisés automatiquement depuis leur source autorisée (pas de republication manuelle systématique après chaque modification mineure).
  5. Tout nouveau champ est privé par défaut.
  6. Les informations sensibles ne doivent jamais pouvoir être exposées par extension automatique du schéma privé.
  7. Les modifications sensibles peuvent nécessiter une nouvelle validation.
  8. La fiche publique doit pouvoir être retirée ou suspendue sans modifier ni supprimer les données privées.
- **Reste à trancher par l'audit technique** (non couvert par cette validation de principe) : liste initiale des champs publics, règles de synchronisation, mécanisme de publication, règles de dépublication, tests RLS, journal d'audit, comportement en cas d'échec de synchronisation.
- **Garde-fou ajouté (2026-07-22)** — liste blanche obligatoire pour la synchronisation automatique (point 4 ci-dessus) :
  1. la synchronisation automatique vers le modèle public repose exclusivement sur une liste blanche explicite de champs ;
  2. aucun nouveau champ privé ne peut devenir public automatiquement ;
  3. toute évolution de la liste blanche doit être revue explicitement (pas d'ajout silencieux) ;
  4. un test automatisé doit échouer lorsqu'un champ non autorisé tente d'entrer dans la projection publique ;
  5. les données sensibles restent exclues par défaut ;
  6. toute publication, modification sensible, suspension et dépublication est journalisée (acteur, date, ancien/nouvel état).
- **Précision explicite de l'utilisateur** : cette décision valide le principe d'une projection publique dédiée, pas encore le nom définitif des tables ni l'implémentation SQL.
- **Statut** : VALIDÉE — PRINCIPE.

### DEC-003 — Périmètre du rôle "administrateur Seba"

- **Contexte** : le contrat de vision mentionne ce rôle sans le définir (§3, §16).
- **Impact** : bloque toute implémentation de vérification de fiche, de modération d'avis, de traitement des signalements.
- **Décision** : Option A validée pour le pilote — le fondateur exerce personnellement, sans grande interface d'administration construite maintenant : vérification des fiches, traitement des signalements, suspension éventuelle, arbitrage des cas simples.
- **Exigence de traçabilité** (même en traitement manuel), chaque action sensible doit enregistrer : acteur, date, type d'action, justification, documents examinés, ancien et nouvel état, éventuelle date d'expiration.
- **Principe de vérification** : jamais un badge vague ni simplement acheté — le produit doit distinguer des vérifications réelles et typées, par exemple : téléphone vérifié, identité vérifiée, existence légale vérifiée, assurance vérifiée.
- **Périmètre du pilote** : revendication, vérifications essentielles, signalement, suspension manuelle. Les avis publics complexes peuvent être repoussés après le premier pilote.
- **Critères de réévaluation vers une vraie interface d'administration** : nombre de fiches, nombre de demandes de vérification, nombre de signalements, temps hebdomadaire nécessaire au traitement manuel.
- **Seuils mesurables proposés (2026-07-22)** — présentés comme hypothèses à valider, pas des valeurs figées : nombre de fiches en attente de vérification, nombre de vérifications traitées par semaine, nombre de signalements par semaine, temps hebdomadaire consacré à la modération, délai moyen de traitement d'une demande de vérification, taux d'erreur ou de réouverture d'un dossier déjà traité. Ces seuils doivent être corrigés après le Gate 0 (validation terrain) et les premières semaines réelles du pilote — aucune valeur numérique n'est fixée définitivement ici faute de données.
- **Statut** : VALIDÉE — PRINCIPE.

### DEC-004 — Moment de l'identification/création de compte dans le parcours de demande

- **Contexte** : le contrat de vision autorise une consultation sans compte mais laisse ouvert le moment exact où l'identification légère devient obligatoire (§16).
- **Impact** : conditionne la conception de la nouvelle policy d'insertion publique sur `client_requests` et le mécanisme anti-spam associé.
- **Décision** : Option B validée — recherche, consultation des fiches et remplissage complet du formulaire sans identification immédiate ; une vérification légère (code reçu par téléphone ou email) devient obligatoire juste avant l'envoi définitif.
- **Principes retenus** :
  1. Aucune demande n'est visible par le professionnel avant confirmation.
  2. La confirmation peut utiliser un code reçu par téléphone ou email.
  3. Pour le pilote, pas de mot de passe classique imposé immédiatement.
  4. Une identité client légère peut être créée après vérification, pour permettre le suivi de la demande et l'accès futur à l'espace client.
  5. Les brouillons non confirmés ne sont jamais transmis au professionnel.
  6. Les brouillons expirent automatiquement après un délai à définir.
  7. Rate limiting, anti-bot et détection d'abus restent obligatoires même avant confirmation.
- **Reste à proposer pendant la conception technique** : canal exact de confirmation, durée d'expiration, mode de connexion définitif.
- **Condition préalable obligatoire ajoutée (2026-07-22)** : l'ouverture d'un flux de confirmation par SMS ou email est interdite avant la mise en place et le test de : rate limiting par adresse IP/identité/appareil ou autre signal pertinent ; limitation du nombre de codes envoyés ; délai minimal entre deux envois ; expiration des codes ; limitation des tentatives ; protection anti-bot ; détection des comportements anormaux ; plafonds de coût pour les SMS ; logs et alertes ; mécanisme de blocage. Motivation : l'envoi de codes par SMS est une cible connue de fraude par abus automatisé ("SMS pumping"), et aucun de ces mécanismes n'existe aujourd'hui dans le dépôt.
- **Comparaison à mener pendant la conception technique** (canal SMS vs email vs connexion sans mot de passe) selon : sécurité, coût, délivrabilité, friction, récupération d'accès, risques d'abus — comparaison non encore faite, à documenter avant le choix définitif du canal.
- **Statut** : VALIDÉE — PRINCIPE.

### DEC-005 — Politique d'affichage des coordonnées directes du professionnel

- **Contexte** : le contrat de vision (§8) prévoit que les coordonnées ne contournent pas par défaut le parcours de demande qualifiée, avec des exceptions possibles pour l'urgence.
- **Impact** : conditionne un champ de configuration explicite dans le modèle de la fiche publique.
- **Décision** : Option A validée pour le pilote — téléphone et email du professionnel non affichés publiquement par défaut sur les fiches nettoyage/conciergerie ; bouton principal "Faire une demande" ; les coordonnées (ou la possibilité d'appeler) peuvent être partagées après acceptation de la demande, depuis la conversation.
- **Motivation** : protéger le professionnel du spam, préserver la qualification, conserver un historique, mesurer correctement la conversion, éviter un canal parallèle non traçable.
- **Exclusion explicite** : les exceptions pour les métiers urgents sont repoussées, à ne pas construire pour le premier pilote.
- **Clarification de portée (2026-07-22)** : cette règle concerne exclusivement les nouveaux clients découvrant le professionnel par la face publique Seba. Elle ne change rien au fonctionnement actuel des relations déjà établies (clients existants, clients invités directement par le professionnel via `client-provision.ts`, contacts déjà connus, relations contractuelles en cours) — les professionnels restent libres de communiquer leurs coordonnées à leurs clients existants. La conversation Seba reste néanmoins le canal recommandé pour conserver l'historique lié à une demande ou une intervention.
- **Statut** : VALIDÉE — PRINCIPE.

### DEC-006 — Sort des 17 pages "Infrastructure avancée"

- **Contexte** : ces pages (cockpit-treso, registre-charges, bfr-predictif, compta-expert, agenda-elastique, haversine-engine, mutation-contextuelle, flotte-telemetrie, studio-factures, signature-payment, crm-tech, contentieux-recouvrement, trava-dechets, prevention-risques, rh-compagnonnage, crypto-backup, core-ux) sont déconnectées de SebaDB et chevauchent partiellement le cœur métier réel.
- **Options** : réintégrer les briques utiles (ex. signature tactile de `signature-payment.html` dans le vrai flux devis), isoler explicitement (hors navigation/indexation) sans supprimer, ou déprécier/supprimer après vérification.
- **Décision humaine attendue** : trancher au cas par cas ou en bloc.
- **Statut** : PROPOSÉE.

### DEC-007 — Statut économique de la fiche gratuite au démarrage

- **Contexte** : question ouverte du contrat de vision (§16).
- **Impact** : conditionne si la Phase 1/2 du plan de migration s'ouvre à tout professionnel ou seulement à un premier cercle contrôlé.
- **Décision** : variante de l'Option A — pendant le pilote, seules les entreprises sélectionnées et invitées par le fondateur peuvent publier une fiche visible ; aucune auto-publication professionnelle ouverte à tous ; chaque professionnel pilote bénéficie d'un accompagnement direct.
- **Variante ajoutée** : un professionnel non invité peut déposer une candidature ou rejoindre une liste d'attente publique (nom de l'entreprise, activité, zone géographique, téléphone ou email, taille de l'équipe, outils actuellement utilisés, intérêt pour Seba) — cette candidature ne crée jamais automatiquement une fiche publique ; le fondateur choisit ensuite qui inviter.
- **Reste à définir avec des critères mesurables** (nombre exact de professionnels pilotes, critères d'ouverture plus large) : capacité de modération, taux d'activation, qualité des fiches, demandes reçues, taux de réponse, charge de support.
- **Garde-fous ajoutés avant publication de la liste d'attente (2026-07-22)** — la liste d'attente est retenue comme première expérimentation commerciale possible, mais ne doit pas être mise en ligne sans avoir d'abord défini : finalité du formulaire, données strictement nécessaires, information de confidentialité, consentement lorsque nécessaire, durée de conservation, suppression, protection anti-spam, rate limiting, notification fiable, responsable du traitement des candidatures, délai de réponse, événements analytics minimaux, capacité réelle du fondateur à traiter les candidatures.
- **Séquencement** : la liste d'attente peut avancer en parallèle de la stabilisation du Groupe 1 uniquement si elle ne retarde pas les corrections critiques de ce même groupe.
- **Statut** : VALIDÉE — PRINCIPE, VARIANTE INVITATION + LISTE D'ATTENTE.

### DEC-008 — Métier et zone géographique du pilote

- **Contexte** : question ouverte du contrat de vision (§16), condition de sortie de la Phase 4 du plan de migration.
- **Décision** : Option A validée avec le périmètre suivant :
  - Métier pilote principal : nettoyage de logements et de locations saisonnières.
  - Les conciergeries sont incluses comme entreprises utilisatrices, donneuses d'ordre ou prescriptrices de prestations de nettoyage.
  - Cible professionnelle initiale : indépendants, microentreprises et entreprises de 1 à 15 intervenants.
  - Zone pilote : Cap-d'Ail, Beausoleil, Roquebrune-Cap-Martin et Menton.
  - Monaco, Nice et les autres villes ne font pas partie du premier périmètre produit, sauf besoin ponctuel d'entretien utilisateur ; leur ouverture officielle dépendra des résultats du pilote.
- **Motivation** : connaissance personnelle du métier, expérience terrain, accès direct aux professionnels de cette zone, compatibilité avec les modules déjà existants, besoin de limiter la complexité du premier formulaire sectoriel.
- **Exclusion explicite** : le pilote ne construit pas simultanément les parcours pisciniste, jardinier, vitrier, dératisation et bricolage — le modèle de données peut prévoir leur ajout futur, mais l'expérience pilote est optimisée pour le nettoyage et la conciergerie locative.
- **Clarification sur Monaco (2026-07-22)** — distinction entre deux zones différentes, à ne pas confondre :
  - **Zone opérationnelle des prestations** : Cap-d'Ail, Beausoleil, Roquebrune-Cap-Martin et Menton restent la zone opérationnelle principale du premier pilote.
  - **Zone d'acquisition des clients et donneurs d'ordre** : Monaco peut être inclus dans les entretiens terrain (voir GATE-0) et dans l'acquisition de propriétaires, gestionnaires ou conciergeries — une demande provenant d'un acteur monégasque peut concerner un logement situé dans la zone opérationnelle française.
  - L'ouverture officielle à des prestations effectivement situées à Monaco reste conditionnée à une vérification juridique, commerciale, fiscale et opérationnelle non encore réalisée — aucune décision juridique n'est prise ici.
- **Statut** : VALIDÉE — PRINCIPE.

### DEC-009 — Statut documentaire de `docs-backend.md`, `strategie/Seba-vision-strategie.md`, `strategie/plan-marche-produit-2026.md`

- **Contexte** : les trois documents contiennent des affirmations obsolètes ou en conflit de statut avec `SEBA_VISION_CONTRACT.md` (détail dans `SEBA_CURRENT_STATE_AUDIT.md` §8).
- **Recommandation** : mettre à jour leur statut/date plutôt que les supprimer — ils conservent une valeur historique et, pour `Seba-vision-strategie.md`, des principes d'exécution toujours pertinents.
- **Décision humaine attendue** : valider cette correction documentaire avant application (aucune modification n'a été faite).
- **Statut** : PROPOSÉE.

### DEC-010 — Notion de "prospect" distincte de "client"

- **Contexte** : le modèle actuel fusionne prospect et client dès la première demande (`SEBA_DOMAIN_MODEL.md` §2).
- **Impact** : mineur à court terme, mais conditionne la clarté du CRM une fois le flux public actif (volume de demandes non converties potentiellement plus élevé qu'aujourd'hui).
- **Décision humaine attendue** : introduire un statut distinct maintenant ou reporter après le pilote.
- **Statut** : PROPOSÉE, priorité basse.

### DEC-011 — Gate de déploiement sur `static.yml`

- **Contexte** : le déploiement GitHub Pages actuel n'a aucun gate automatique (`SEBA_CURRENT_STATE_AUDIT.md` §6) — seul un push manuel discipliné protège `main`.
- **Options détaillées et recommandation (2026-07-22)** : voir `EXECUTION_DOSSIER_A_GROUPE1.md` §2 — Option A (gate minimal lint/check-design-system, immédiat) vs Option B (attendre les tests RLS de T5 pour un gate complet). Recommandation : les deux, dans l'ordre — Option A immédiatement, enrichie par T5 une fois disponible.
- **Décision humaine attendue** : valider l'Option A immédiate, ou confirmer explicitement que la discipline humaine actuelle suffit tant que le volume de contributeurs reste faible.
- **Statut** : PROPOSÉE — options détaillées, décision utilisateur attendue.
