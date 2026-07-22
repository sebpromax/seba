# SEBA — Feuille de route d'exécution

Statut : proposition d'ordre de travail, aucune tâche n'est engagée. S'appuie sur `SEBA_MIGRATION_PLAN.md` (phasage) et `SEBA_PRODUCT_GAP_ANALYSIS.md` (priorités).

---

## 1. Ordre de travail proposé

### Groupe 1 — Fondations (Phase 0 du plan de migration), peut démarrer immédiatement

1. Corriger la correspondance de valeurs entre `SECTOR_MAPPING` (`docs/services/config-dashboard.js:30-35`) et la contrainte CHECK de `profiles.sector` (`supabase-schema.sql:168`).
   - **Critère d'acceptation** : `create_profile_and_company` réussit pour les 4 valeurs réellement envoyées par l'onboarding actuel.
2. Ajouter une notification UI (ou a minima un état visible) quand une opération locale échoue à se synchroniser après épuisement des tentatives (`docs/seba-data.js:294-298`).
   - **Critère d'acceptation** : un utilisateur peut voir qu'une opération n'est pas synchronisée, sans avoir à ouvrir la console développeur.
3. Ajouter une RPC d'auto-suppression RGPD pour un client/employé invité (distincte de `erase_account_completely`, qui ne couvre que le patron).
   - **Critère d'acceptation** : un compte client/employé peut demander la suppression de ses propres données sans dépendre d'une action du patron.
4. Écrire les premiers tests automatisés d'isolation multi-tenant et de RLS sur `client_requests`/`seba_messages` (remplaçant la vérification manuelle ponctuelle actuelle).
   - **Critère d'acceptation** : un test échoue de façon reproductible si une policy RLS régresse.
5. Trancher et exécuter le sort des ~30 scripts de vérification cassés (`scripts/verify-*`, `scripts/preview-*` référençant `docs/dashboard.html`) — archiver ou supprimer.
   - **Critère d'acceptation** : plus aucun script actif du dépôt ne référence un chemin de fichier inexistant.
6. Corriger `.github/workflows/static.yml` pour qu'il exécute au moins le lint/le check-design-system avant déploiement, ou documenter explicitement pourquoi ce choix est repoussé.
   - **Critère d'acceptation** : décision explicite prise et documentée, pas nécessairement une CI complète immédiatement.

### Groupe 1bis — Liste d'attente publique (peut avancer en parallèle du Groupe 1, sans le retarder)

7bis. Construire un formulaire de liste d'attente publique (DEC-007), une fois définis : finalité du formulaire, données strictement nécessaires, information de confidentialité, consentement, durée de conservation, suppression, protection anti-spam, rate limiting, notification fiable, responsable du traitement, délai de réponse, événements analytics minimaux, capacité réelle du fondateur à traiter les candidatures.
   - **Critère d'acceptation** : un professionnel non invité peut soumettre une candidature ; aucune fiche publique n'est créée automatiquement ; le fondateur reçoit une notification fiable.
   - **Condition explicite** : ne démarre et ne se poursuit que si aucune tâche du Groupe 1 n'est retardée par ce travail.

### GATE 0 — Validation terrain du pilote (obligatoire, bloque les Groupes 3/4/5)

8bis. Conduire les entretiens terrain définis dans `SEBA_DECISION_LOG.md` (GATE-0) : au moins 10 professionnels du nettoyage/conciergerie et 5 acteurs côté demande, dans la zone pilote (Cap-d'Ail, Beausoleil, Roquebrune-Cap-Martin, Menton), avec extension possible aux acquéreurs basés à Monaco.
   - **Critère d'acceptation** : guide d'entretien produit, synthèse anonymisée rédigée, hypothèses confirmées/infirmées listées, décision explicite rendue — GO, AJUSTER ou STOP.
   - **Ce Gate ne peut pas être sauté ni implicite** : tant qu'aucune décision GO/AJUSTER/STOP n'est enregistrée dans `SEBA_DECISION_LOG.md`, aucune tâche du Groupe 3 ne commence, quelle que soit l'avancée technique du Groupe 1.

### Groupe 2 — Décisions humaines préalables (état : résolues en principe, détail dans `SEBA_DECISION_LOG.md`)

DEC-001 à DEC-008 portent désormais toutes un statut VALIDÉE — PRINCIPE ou VALIDÉE — ORIENTATION PROVISOIRE. Ce groupe ne bloque donc plus le démarrage du Groupe 1bis ni du GATE 0. Il continue en revanche de conditionner le Groupe 3 via GATE 0, et certains détails techniques non tranchés restent à documenter pendant la conception (voir §3 mis à jour ci-dessous).

### Groupe 3 — Face publique, fondation de données (Phase 1 du plan de migration) — démarre uniquement après GATE-0 = GO ou AJUSTER

9. Concevoir et créer la table "Public Listings" (nom à trancher) selon l'approche choisie dans `SEBA_DOMAIN_MODEL.md` §3, avec le garde-fou de liste blanche défini dans `SEBA_DECISION_LOG.md` (DEC-002).
   - **Critère d'acceptation** : une fiche peut être créée et lue sans authentification ; test automatisé confirmant qu'aucun champ privé ne fuite ; test automatisé confirmant qu'un champ hors liste blanche est rejeté ; journal d'audit fonctionnel sur publication/modification sensible/suspension/dépublication.
10. Mécanisme de publication explicite depuis le profil professionnel corrigé (Groupe 1, tâche 1).
    - **Critère d'acceptation** : un patron peut publier/dépublier sa fiche depuis son espace privé.

### Groupe 4 — Fiche publique visible + revendication (Phase 2)

11. Page de fiche publique (nouvelle page frontend, thème à trancher — voir décision log). Coordonnées directes non affichées par défaut (DEC-005) — seul le bouton "Faire une demande" est le point de contact visible.
12. Mécanisme de revendication et distinction visuelle "prévisualisée" vs "revendiquée".
    - **Critère d'acceptation** : une fiche non revendiquée n'affiche jamais de badge de vérification, vérifié par test.

### Groupe 5 — Demande qualifiée publique (Phase 3)

13. Nouvel état "brouillon non confirmé" puis "en attente d'acceptation" sur `client_requests` pour l'origine publique (DEC-004) — le formulaire complet est remplissable sans identification, la confirmation n'intervient qu'à l'étape finale d'envoi.
14. Nouvelle policy d'insertion pour un visiteur identifié légèrement (additive, sans toucher à la policy existante).
15. **Prérequis bloquant avant toute ouverture du flux de confirmation** (DEC-004) : rate limiting par IP/identité/appareil, limitation du nombre de codes envoyés, délai minimal entre deux envois, expiration des codes, limitation des tentatives, protection anti-bot, détection de comportements anormaux, plafonds de coût SMS, logs et alertes, mécanisme de blocage — aucun de ces mécanismes n'existe aujourd'hui dans le dépôt, tous doivent être testés avant mise en ligne, pas seulement conçus.
16. Comparaison documentée SMS vs email vs connexion sans mot de passe (sécurité, coût, délivrabilité, friction, récupération d'accès, risques d'abus) avant de choisir le canal définitif.
17. Formulaire de demande sectoriel réutilisant les `specificFields` de `businessTypes.js`, avec le vocabulaire testé lors de GATE-0.
    - **Critère d'acceptation** : un visiteur peut déposer une demande depuis une fiche publique, le professionnel peut l'accepter/refuser, la conversation se déverrouille uniquement après acceptation — testé automatiquement de bout en bout, y compris les cas d'abus (rate limiting déclenché, brouillon expiré).

### Groupe 6 — Pilote restreint (Phase 4)

18. Recrutement/onboarding des premiers professionnels et clients réels du pilote, sur la base des engagements obtenus pendant GATE-0.
19. Suivi via les critères de pilote définis en §4 (hypothèses à corriger après GATE-0 et les premières semaines réelles).
20. Première décision GO/AJUSTER/STOP sur l'ouverture élargie, selon les seuils mesurables de DEC-003/DEC-007 une fois observés en conditions réelles.

## 2. Tâches explicitement repoussées (hors de cette feuille de route)

- Recherche publique à grande échelle (carte, filtres avancés) — après validation du pilote.
- Parcours guidé par description du besoin (Parcours B) — après le parcours A.
- Paiement Stripe réel — sauf si le pilote démontre qu'il est bloquant plus tôt que prévu.
- Avis, vérification par un rôle modération, monétisation par paliers — dépendent de la décision humaine sur le rôle "administrateur Seba".
- Réintégration ou suppression des 17 pages "Infrastructure avancée" — décision à part, indépendante du calendrier de la face publique.
- Migration du blob JSON (`seba_state`) vers des tables normalisées pour les 5 entités cœur — reportée tant que le pilote ne démontre pas que c'est un frein réel (voir `SEBA_TARGET_ARCHITECTURE.md`, Option C).
- Internationalisation — hors périmètre court/moyen terme du contrat de vision.

## 3. État des décisions humaines (mis à jour 2026-07-22)

DEC-001 à DEC-008 portent toutes un statut VALIDÉE — PRINCIPE ou VALIDÉE — ORIENTATION PROVISOIRE (détail dans `SEBA_DECISION_LOG.md`). Ce qui reste réellement ouvert :

- **GATE-0 (bloquant)** : la validation terrain elle-même n'est pas encore réalisée — c'est la seule chose qui bloque encore matériellement le démarrage du Groupe 3.
- **Détails techniques non tranchés par les validations de principe** (à documenter pendant la conception, pas des décisions humaines au sens strict) : liste blanche exacte des champs publics (DEC-002), canal exact de confirmation et durée d'expiration (DEC-004), seuils numériques de bascule vers une interface d'administration (DEC-003), nombre exact de professionnels pilotes à inviter (DEC-007).
- **Décisions humaines restées ouvertes indépendamment de la face publique** : DEC-009 (statut documentaire de trois fichiers stratégiques obsolètes), DEC-010 (notion de "prospect" distincte de "client", priorité basse), DEC-011 (gate de déploiement sur `static.yml`).
- **Le sort des 17 pages "Infrastructure avancée" (DEC-006)** reste validé en principe (approche cas par cas) mais son calendrier d'exécution n'est pas fixé — sans impact bloquant sur le reste de la feuille de route.
- **Vérification juridique/commerciale/fiscale/opérationnelle de Monaco** (DEC-008) : aucune décision prise, explicitement hors périmètre de ce document.

## 4. Critères du pilote (hypothèses à corriger après GATE-0)

Aucun seuil ci-dessous n'est fixé de façon définitive — ce sont des points de départ à corriger une fois les entretiens terrain (GATE-0) et les premières semaines réelles du pilote disponibles. Présentés par catégorie, pas hiérarchisés par importance :

**Acquisition et activation**
- Professionnels interrogés (GATE-0).
- Professionnels invités.
- Professionnels activés (fiche publiée).

**Volume et conversion de la boucle produit**
- Fiches publiées.
- Demandes commencées (brouillon).
- Demandes confirmées (identification validée, DEC-004).
- Demandes acceptées par le professionnel.
- Délai de réponse du professionnel.
- Devis créés.
- Devis acceptés.
- Interventions terminées.
- Paiements reçus.
- Demandes abandonnées (jamais confirmées, ou confirmées mais jamais traitées).

**Qualité et abus**
- Spam et abus détectés/bloqués.

**Charge opérationnelle**
- Temps de support par professionnel.
- Temps de support par demande.

**Satisfaction et rétention**
- Satisfaction professionnelle.
- Satisfaction client.
- Volonté de continuer (professionnel et client).
- Volonté de payer (professionnel).

Ces métriques nécessitent une brique d'événements minimale (voir `SEBA_TARGET_ARCHITECTURE.md` §7) — non implémentée aujourd'hui, à prévoir dans le Groupe 5 ou 6. Aucun seuil GO/AJUSTER/STOP n'est proposé ici sans données — cette table sera complétée avec des valeurs concrètes une fois GATE-0 terminé, pas avant.
