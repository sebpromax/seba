# SEBA — Modèle de domaine (actuel → cible)

Statut : proposition de correspondance entre entités existantes et entités nécessaires à la vision. Aucune table n'est créée par ce document — c'est une cartographie, pas une migration (voir `SEBA_MIGRATION_PLAN.md` pour le séquencement d'exécution).

---

## 1. Entités actuelles (confirmées par lecture du schéma et des migrations)

| Entité | Où | Statut | Donnée publique/privée/sensible |
|---|---|---|---|
| `seba_state` (blob JSON : clients, devis, factures, interventions, employes, journal, custom_services, contrats, seq) | `supabase-schema.sql:1-60` | Cœur métier actif, RLS `auth.uid()=user_id` | Privée |
| `profiles` / `companies` | `supabase-schema.sql:165-222` | Écrit par `create_profile_and_company` (RPC en échec systématique, voir audit), jamais relu | Privée (destinée à devenir en partie publique une fois corrigée) |
| `api_usage` | `migrations/20260709_create_api_usage_guardrail.sql` | Garde-fou quota IA, RLS fermée (service_role uniquement) | Sensible (interne) |
| `client_memoire` / `memoire_embeddings` | `migrations/20260709_create_client_memoire.sql` | Mémoire vectorielle IA, jamais écrite par le pipeline réel selon son propre commentaire | Privée/sensible |
| `sync_operations`, `entity_versions`, `sync_conflicts` | `supabase-schema.sql` (section sync) | File de synchronisation append-only, cascade sur `seba_state.account` | Privée, technique |
| `employe_accounts` | `migrations/20260719c_universal_auth_employe.sql` | Lien compte employé ↔ compte patron | Privée |
| `client_accounts` | `migrations/20260719_client_espace.sql` | Lien compte client ↔ compte patron, insertion service_role uniquement | Privée |
| `client_requests` | `migrations/20260719_client_espace.sql` + `20260719d` | Demande qualifiée, statuts `nouvelle/en_cours/terminee/annulee` | Privée (donnée personnelle du client) |
| `seba_messages` | `migrations/20260716_create_seba_messages.sql` + `20260720_mission_chat.sql` (`request_id`) | Conversation, scope dynamique sur assignation courante | Privée, sensible (contenu de conversation) |
| Bucket `mission-photos` | `migrations/20260720c_mission_photos_storage.sql` | Preuve d'intervention, path scopé sur `client_requests.id` | Privée, sensible (photo) |
| Bucket `intervention-photos` | Palier 2 QA visuelle | Upload service_role uniquement | Privée |
| `materiaux_couts`, `paiements` | Module finance (paliers antérieurs, non ré-audité en détail) | Existant, non revu en profondeur dans cet audit | Privée, sensible (financier) |
| `alert_logs` | Lié à `notify-alert.ts` | Existant | Privée, technique |
| `businessTypes.js` (objet JS, pas une table) | `docs/businessTypes.js` | Référentiel de 11 secteurs, frontend uniquement | Publique par nature (pas de donnée personnelle), mais non exposée comme donnée backend aujourd'hui |

## 2. Entités nécessaires à la vision — correspondance

Pour chaque entité cible listée dans le prompt d'audit, statut par rapport à l'existant :

| Entité cible | Existe ? | Où / correspondance | Recommandation | Conséquence RLS |
|---|---|---|---|---|
| Utilisateurs / identités | Oui | `auth.users` (Supabase Auth) | Conserver | Aucune (déjà correct) |
| Comptes professionnels | Oui, partiellement buggé | `seba_state.account`, `profiles`/`companies` | Corriger avant réutilisation (contrainte CHECK sector, voir audit) | Aucun changement RLS nécessaire, correction de valeurs uniquement |
| Membres / rôles / permissions | Oui | RLS + RPC SECURITY DEFINER | Conserver, étendre pour "administrateur Seba" (rôle à définir humainement) | Nouveau rôle = nouvelles policies dédiées, à concevoir une fois le périmètre tranché |
| Profils professionnels (contenu source, avant publication) | Partiellement | `profiles`/`companies` (à corriger) + champs onboarding non tous persistés côté backend | Étendre `profiles`/`companies` une fois corrigée, ou créer une table dédiée si la correspondance de champs s'avère insuffisante | Reste privée — c'est la source, pas la projection publique |
| Fiches publiques | Non | — | Créer une nouvelle table dédiée (voir §3, comparaison d'approches) | Nouvelle catégorie RLS : lecture publique sans authentification, jamais vue jusqu'ici dans ce projet |
| Sources des fiches | Non | — | Dérivé du profil professionnel au moment de la publication (voir §3) | — |
| Revendications | Non | — | Créer, état sur la fiche publique ou table séparée `listing_claims` | Écriture réservée au patron authentifié propriétaire du compte visé |
| Vérifications | Non | — | Créer, distincte de la revendication (un badge "vérifié" est une décision, pas un simple statut de revendication) | Écriture réservée à un rôle "administrateur Seba" à définir |
| Catégories / secteurs | Oui, frontend seulement | `businessTypes.js` | Évaluer une contrepartie backend (table `categories`) uniquement si la recherche publique en a besoin pour filtrer/indexer ; sinon garder frontend | Donnée publique par nature |
| Services | Oui, frontend seulement | `businessTypes.js.services[]` | Idem — dépend du besoin réel de filtrage public | Publique si exposée |
| Zones d'intervention | Non structuré | Champs bruts d'onboarding, non modélisés en zone interrogeable | Créer `service_areas` si la recherche géographique se construit | Publique (zone déclarée), pas sensible |
| Disponibilités | Non | — | Non prioritaire tant que la recherche publique n'est pas construite | — |
| Clients publics (visiteur avant identification) | Non | — | À créer avec le mécanisme d'identification légère (§16 du contrat de vision — décision humaine attendue) | Nouvelle policy d'insertion, distincte du modèle actuel (`client_accounts` suppose toujours une invitation préalable) |
| Clients professionnels (déjà invités) | Oui | `client_accounts`, `seba_state.clients` | Conserver | Aucun changement |
| Demandes | Oui | `client_requests` | Étendre pour accepter une origine publique (voir gap analysis §8) | Nouvelle policy d'insertion pour un visiteur identifié légèrement, distincte de l'actuelle (qui exige un `client_accounts` préexistant) |
| Réponses de qualification | Partiellement | `client_requests.titre` (texte libre aujourd'hui) | Structurer par secteur (lié à `specificFields` de `businessTypes.js`) | Reste privée (contenu de la demande) |
| Pièces jointes (demande) | Oui (photo à la clôture) | Bucket `mission-photos` | Étendre pour permettre des pièces jointes dès la création de la demande (le contrat de vision le prévoit, §6), pas seulement à la clôture | Nouvelle policy d'upload pour le visiteur identifié légèrement |
| Destinataires | Implicite | Le professionnel dont dépend `seba_state.account` | Conserver le principe | — |
| Conversations | Oui | `seba_messages` | Conserver, étendre l'origine | Voir demandes |
| Participants | Implicite | Résolu par jointure (patron/client/employé assigné) | Conserver | — |
| Messages | Oui | `seba_messages` | Conserver | — |
| Prospects | Non distinct | Traité comme client dès la première demande | Décision à prendre : introduire un statut "prospect" avant conversion en client, ou continuer à fusionner les deux (voir décision log) | — |
| Clients (établis) | Oui | `seba_state.clients`, `client_accounts` | Conserver | — |
| Devis / versions | Oui (devis), versions non confirmées en détail | `seba_state.devis` | Non ré-audité en profondeur (hors périmètre de cet audit) | — |
| Interventions | Oui | `seba_state.interventions` | Conserver | — |
| Rendez-vous | Fusionné avec intervention | `seba_state.interventions` (dates) | Évaluer si un rendez-vous doit être distinct d'une intervention planifiée dans la vision (proposition de rendez-vous dans la conversation, §7 du contrat) — actuellement non distinct | — |
| Affectations | Oui | `client_requests.intervenant_id`, `seba_state.interventions.employeId` | Conserver | — |
| Rapports | Oui | `close_my_intervention` (champ rapport) | Conserver | — |
| Preuves | Oui | `client_requests.photo_path`, bucket `mission-photos` | Conserver, étendre aux pièces jointes de la demande initiale | — |
| Factures | Oui | `seba_state.factures` | Conserver | — |
| Paiements | Démo uniquement | `stripe-service.js` (démo), `paiements` (table existante, rôle exact non ré-audité ici) | À construire réellement (voir gap analysis §13) | — |
| Avis | Non | — | Créer entièrement, avec modération associée | Publique (contenu d'avis), mais écriture réservée à un client ayant réellement eu une intervention clôturée avec ce professionnel (anti-faux avis) |
| Abonnements | Non | — | Créer, priorité basse (long terme) | — |
| QR codes | Génération isolée seulement | `signature-payment.html` (paiement, pas fiche) | Créer une table d'attribution liée à Public Listings | Publique (le QR encode une URL publique) |
| Événements d'attribution | Non | — | Créer si le suivi de provenance (QR vs recherche vs lien direct) devient une priorité produit | — |
| Signalements | Non | — | Créer avec le rôle de modération | Sensible |
| Notifications | Oui (infra) | `send-email.ts`, `send-push.ts`, `notify-alert.ts` | Conserver, étendre aux événements publics | — |
| Événements analytiques | Non | — | Créer une fois les métriques prioritaires tranchées (voir roadmap) | — |
| Journaux d'audit | Partiellement | `sync_operations` (append-only) | Conserver le principe, étendre explicitement si un rôle administrateur/modération est créé | Sensible |

## 3. Séparation public / privé — comparaison des approches

C'est la décision la plus structurante du modèle de domaine cible. Comparaison sans choix imposé, conformément à la demande d'audit.

| Approche | Sécurité | Cohérence | Fraîcheur | Simplicité RLS | Risque de fuite | Recherche géo | Modération | Performance | Suppression | Historique | Migration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Table publique dédiée** (le professionnel "publie" explicitement un sous-ensemble de champs vers une table séparée, lisible sans authentification) | Élevée — aucune policy sur les données privées à auditer pour l'accès public | Nécessite une synchronisation explicite profil→fiche (risque de désynchronisation si oublié) | Dépend de la discipline de mise à jour (pas automatique) | Très simple (une seule policy `select` ouverte sur une table qui ne contient que ce qui est volontairement public) | Faible — la surface exposée est minimale et intentionnelle | Facile (index dédié possible) | Facile (modération porte sur un objet unique, clairement délimité) | Bonne (table optimisée pour la lecture publique) | Simple (suppression d'une ligne, sans toucher aux données privées sources) | Bonne (append/versionnage possible sans exposer l'historique privé) | Simple : nouvelle table, aucune migration de l'existant |
| **Vue publique sécurisée** (vue Postgres filtrée sur les tables privées existantes) | Moyenne — dépend entièrement de la rigueur de la définition de vue ; tout ajout de colonne privée future doit systématiquement penser à l'exclusion | Toujours fraîche par construction (pas de synchronisation à gérer) | Excellente (temps réel) | Complexe (une vue mal écrite peut fuiter un champ ajouté plus tard sans qu'on y pense) | Modéré à élevé si la discipline se relâche dans le temps | Possible mais dépend des index sous-jacents des tables privées | Plus difficile (modérer une vue dérivée est moins direct que modérer un objet dédié) | Variable | Complexe (une suppression doit se propager depuis la source privée) | Dépend de la table source | Simple techniquement, mais risque de dette de sécurité qui grandit avec le schéma privé |
| **Projection depuis les données privées** (job qui recopie périodiquement un sous-ensemble vers une structure publique) | Élevée si le job est simple et audité | Décalage possible entre profil réel et fiche publique (fraîcheur dépend de la fréquence du job) | Moyenne (dépend de la fréquence) | Simple côté RLS (même principe que la table dédiée) | Faible | Facile | Facile | Bonne | Simple | Bonne | Simple, mais ajoute une pièce d'infrastructure (job planifié) supplémentaire |
| **Service d'indexation externe** (ex. moteur de recherche dédié, Elasticsearch/Algolia-like) | Dépend du fournisseur, complexité supplémentaire de synchronisation | Décalage possible | Dépend | Complexité ajoutée (synchronisation à maintenir) | Faible si bien isolé | Excellente (c'est leur rôle) | Variable | Excellente pour la recherche | Nécessite une synchronisation de suppression | Non pertinent | Coût d'introduction d'un nouveau composant d'infrastructure, disproportionné pour un pilote limité à quelques métiers/une zone |
| **Réplication contrôlée** (copie physique vers une base/schema distinct) | Élevée | Décalage selon fréquence | Moyenne | Simple une fois en place | Faible | Bonne | Facile | Bonne | Nécessite synchronisation | Bonne | Coût d'infrastructure le plus élevé des options listées, disproportionné à ce stade |

**Observation, pas une décision imposée** : au vu de l'échelle du pilote prévu par le contrat de vision (quelques métiers, une zone géographique), les deux options les plus proportionnées sont la **table publique dédiée** (la plus simple, la plus sûre, la moins chère à mettre en œuvre et à faire évoluer) et la **projection périodique** (si une fraîcheur temps réel n'est pas jugée nécessaire). Le service d'indexation externe et la réplication contrôlée introduisent une complexité d'infrastructure que rien dans l'audit ne justifie à ce stade — ce sont des options à garder en réserve si l'échelle grandit significativement après validation du pilote, pas des choix de départ. La vue publique sécurisée est déconseillée en première approche car elle fait porter un risque de sécurité croissant sur chaque évolution future du schéma privé — un mode de défaillance moins visible que les autres options.

Cette observation n'est **pas une décision validée** — elle nourrit `SEBA_DECISION_LOG.md` (entrée dédiée) pour arbitrage humain explicite.

## 4. États et transitions (aperçu, détaillé en machine à états dans la roadmap si besoin)

- **Fiche publique** : `non créée → prévisualisée (non revendiquée) → revendiquée → active`. Une fiche "prévisualisée" ne doit jamais afficher de badge de vérification (principe non négociable du contrat de vision).
- **Revendication** : `non revendiquée → en cours de revendication (vérification d'identité du professionnel) → revendiquée`.
- **Demande (`client_requests`, déjà existant)** : `nouvelle → en_cours → terminee` (ou `annulee`) — confirmé par la contrainte CHECK réelle (`supabase-schema.sql:1018`). Extension nécessaire pour l'origine publique : un état intermédiaire explicite "en attente d'acceptation" avant que la conversation ne s'ouvre, aujourd'hui implicite car le client est toujours déjà connu.
- **Conversation** : verrouillée avant acceptation de la demande, déverrouillée après — déjà cohérent avec le principe non négociable du contrat, à l'échelle du modèle actuel.

## 5. Ownership par domaine

Chaque domaine du `SEBA_TARGET_ARCHITECTURE.md` (§3) possède exclusivement ses propres tables — aucune table n'est recommandée comme partagée en écriture entre deux domaines. Les lectures cross-domaines (ex. Public Listings lisant Categories & Sector Packs) sont autorisées ; les écritures cross-domaines ne le sont pas (ex. Reviews & Trust ne doit jamais écrire directement dans Jobs & Interventions — elle doit uniquement lire l'état "intervention clôturée" pour autoriser un avis).
