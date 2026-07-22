# SEBA — Plan de migration

Statut : plan proposé, aucune phase n'est validée ni engagée. S'appuie sur `SEBA_PRODUCT_GAP_ANALYSIS.md` (priorités) et `SEBA_TARGET_ARCHITECTURE.md` (Option C recommandée). Aucune migration SQL, aucune politique RLS, aucun fichier produit n'a été modifié pour produire ce plan.

---

## 1. Décisions par module existant

Vocabulaire imposé : CONSERVER TEL QUEL / CONSERVER ET SÉCURISER / ADAPTER / REFACTORISER PROGRESSIVEMENT / REMPLACER APRÈS MIGRATION / DÉPRÉCIER / SUPPRIMER APRÈS VÉRIFICATION / À ÉTUDIER DAVANTAGE.

| Module | Décision | Dépendants | Données à conserver | Chemin de migration | Tests nécessaires | Retour arrière |
|---|---|---|---|---|---|---|
| Authentification universelle (patron/employé/client) | **CONSERVER TEL QUEL** | Tout le produit | — | Aucune | Ajouter les tests RLS listés dans `SEBA_SECURITY_AND_TRUST.md` §11 | N/A |
| `seba_state` (blob JSON, 5 entités cœur) | **CONSERVER ET SÉCURISER** | 13 pages pro | Toutes les données patron existantes | Aucune migration de données à ce stade (voir Option C) ; sécuriser = combler la perte silencieuse de synchronisation (§4 audit) | Test de la file `seba_pending_ops` sous échec réseau simulé | Aucun changement de structure, donc rollback trivial |
| `profiles` / `companies` | **ADAPTER** | Future fiche publique | Aucune donnée réelle actuellement (RPC en échec systématique) | Corriger la correspondance de valeurs (`SECTOR_MAPPING` vs contrainte CHECK), rejouer `create_profile_and_company` pour les comptes existants après correction | Test unitaire de la RPC avec les 4 valeurs réelles envoyées par le frontend | Simple (aucune donnée en production dépend de l'état actuel buggé) |
| `client_requests` / `seba_messages` (mission chat) | **ADAPTER** | Espace client, espace terrain, assignation | Toutes les demandes/conversations existantes | Ajouter un état "en attente d'acceptation" et une policy d'insertion parallèle pour l'origine publique — sans toucher à la policy existante (invitation patron→client) | Tests RLS dédiés (§11 sécurité) avant d'ouvrir la nouvelle policy | Désactivable en retirant uniquement la nouvelle policy, sans toucher à l'existante |
| `client_accounts` / `employe_accounts` | **CONSERVER ET SÉCURISER** | Auth universelle | Toutes les liaisons existantes | Ajouter la RPC d'auto-suppression RGPD manquante (§10 sécurité) | Test RGPD dédié | N/A (ajout pur) |
| Bucket `mission-photos` | **CONSERVER TEL QUEL** | Espace terrain, clôture de mission | Toutes les photos existantes | Aucune | — | — |
| 17 pages "Infrastructure avancée" (cockpit-treso, registre-charges, bfr-predictif, compta-expert, agenda-elastique, haversine-engine, mutation-contextuelle, flotte-telemetrie, studio-factures, signature-payment, crm-tech, contentieux-recouvrement, trava-dechets, prevention-risques, rh-compagnonnage, crypto-backup, core-ux) | **À ÉTUDIER DAVANTAGE** (décision binaire non tranchable sans arbitrage humain — voir décision log) | Aucun (déconnectées) | Aucune donnée réelle (démo uniquement) | Si réintégration : extraire la brique utile (ex. signature tactile) et la reconnecter à SebaDB, page par page. Si dépréciation : retirer de la navigation et de l'indexation avant suppression | Aucune donnée à migrer, donc pas de test de migration ; tester uniquement la non-régression des pages qui resteraient | Trivial (pages actuellement non liées au flux principal) |
| `client.html` (mockup racine) | **SUPPRIMER APRÈS VÉRIFICATION** | `docs/widgets.js` (un seul lien) | Aucune donnée (mockup statique) | Retirer le lien dans `widgets.js`, remplacer par un lien vers un véritable aperçu ou vers `client-espace.html`, puis supprimer le fichier | Vérifier qu'aucun autre lien ne pointe vers ce fichier avant suppression (grep) | Trivial |
| `docs-backend.md` | **ADAPTER** (documentation, pas du code) | Quiconque s'y réfère pour une décision d'architecture | — | Mettre à jour pour distinguer "cœur en blob JSON" vs "modules récents normalisés" | — | — |
| `strategie/Seba-vision-strategie.md` | **ADAPTER** (statut à corriger, contenu à conserver) | — | — | Ajouter une note de statut renvoyant vers `SEBA_VISION_CONTRACT.md` pour la vision produit, sans supprimer les principes d'exécution toujours valides | — | — |
| `strategie/plan-marche-produit-2026.md` | **ADAPTER** (dater explicitement comme photographie passée) | — | — | Ajouter une date de péremption explicite en tête de document | — | — |
| ~30 scripts `verify-*`/`preview-*` cassés (référencent `docs/dashboard.html`) | **SUPPRIMER APRÈS VÉRIFICATION** ou **DÉPRÉCIER** | Aucun (jamais appelés en CI) | Aucune | Vérifier qu'aucun processus manuel ne s'appuie encore dessus, puis supprimer ou déplacer vers un dossier `scripts/archive/` explicite | — | Trivial |
| RLS/policies existantes (cœur privé) | **CONSERVER TEL QUEL** | Tout | — | Aucune | Ajouter les tests listés en §11 de `SEBA_SECURITY_AND_TRUST.md` | — |

## 2. Phasage

### Phase 0 — Fondations et sécurisation du socle existant

- **Objectif** : rendre le socle actuel fiable et testé avant d'y ajouter la face publique.
- **Périmètre** : correction de `create_profile_and_company` (bug de correspondance de valeurs) ; traitement de la perte silencieuse de synchronisation (notification UI a minima) ; ajout de la RPC d'auto-suppression RGPD pour client/employé invité ; mise en place des premiers tests automatisés listés dans `SEBA_SECURITY_AND_TRUST.md` §11 (isolation multi-tenant, RLS sur `client_requests`/`seba_messages`).
- **Fichiers concernés** : `supabase-schema.sql` (contrainte CHECK ou mapping), `docs/services/config-dashboard.js`, `docs/seba-data.js` (notification de synchronisation), nouvelle migration RGPD.
- **Données concernées** : aucune migration de données existantes — uniquement des corrections de bugs et ajouts.
- **Dépendances** : aucune, peut démarrer immédiatement.
- **Risques** : faibles, changements ciblés et isolés.
- **Critères d'entrée** : validation humaine du contrat de vision (déjà faite) + validation de ce plan.
- **Critères de sortie** : les tests ajoutés passent ; la RPC `create_profile_and_company` réussit pour les 4 valeurs réelles envoyées par le frontend.
- **Tests** : unitaires/intégration sur les points listés ci-dessus.
- **Rollback** : trivial (corrections ponctuelles, pas de migration structurelle).
- **Éléments explicitement exclus** : aucune nouvelle fonctionnalité publique dans cette phase.

### Phase 1 — Fondation de la face publique (données)

- **Objectif** : créer la structure de données publique (table dédiée, voir `SEBA_DOMAIN_MODEL.md` §3), sans encore l'exposer dans une page.
- **Périmètre** : nouvelle table "Public Listings" (ou nom équivalent, à trancher), RLS de lecture publique, mécanisme de publication explicite depuis le profil professionnel corrigé (Phase 0).
- **Dépendances** : Phase 0 terminée (profil professionnel fiable).
- **Risques** : c'est la première lecture cross-tenant du projet — risque de conception si les comparaisons d'approches de `SEBA_DOMAIN_MODEL.md` §3 ne sont pas tranchées avec soin.
- **Critères de sortie** : une fiche publique peut être créée et lue sans authentification, sans qu'aucune donnée privée ne soit accessible via cette table (vérifié par test dédié).
- **Tests** : le test "aucun champ privé ne fuite" de `SEBA_SECURITY_AND_TRUST.md` §11.
- **Rollback** : simple (nouvelle table isolée, désactivable sans impact sur l'existant).
- **Exclu de cette phase** : recherche, QR code, revendication — la table existe et est lisible, mais rien ne la consomme encore visuellement.

### Phase 2 — Fiche publique visible + revendication

- **Objectif** : une vraie page de fiche publique consultable, et le mécanisme de revendication.
- **Dépendances** : Phase 1.
- **Risques** : modérés (nouvelle page frontend, pas de nouveau risque de données si Phase 1 est solide).
- **Critères de sortie** : une fiche publique est consultable par URL directe (pas encore par recherche), la distinction "prévisualisée/non revendiquée" vs "revendiquée" est visible et fonctionnelle.
- **Tests** : vérification manuelle + test automatisé de l'état de revendication.
- **Rollback** : retirer la page de la navigation, la table reste inerte.
- **Exclu** : QR code (peut suivre immédiatement après, dépend seulement de l'URL stable de la fiche, donc peu coûteux à ajouter dans la foulée si souhaité — mais reste une phase distincte pour garder le principe "une brique validée avant la suivante").

### Phase 3 — Demande qualifiée publique

- **Objectif** : un visiteur peut transmettre une demande depuis la fiche publique, avec l'identification légère décidée humainement (voir décision bloquante).
- **Dépendances** : Phase 2 (fiche publique existe) + décision humaine sur le moment de l'identification (contrat de vision §16) + mécanisme anti-spam/rate limiting (voir sécurité §9).
- **Risques** : élevés si l'anti-spam n'est pas traité en même temps — c'est le premier point d'entrée non authentifié fort du projet.
- **Critères de sortie** : une demande créée par un visiteur transite correctement dans le pipeline déjà existant (`client_requests`), un professionnel peut l'accepter/refuser, et la conversation se déverrouille uniquement après acceptation — comportement vérifié par test automatisé, pas seulement observé manuellement.
- **Tests** : parcours bout en bout automatisé (le plus proche possible d'un vrai test end-to-end, même minimal), tests RLS sur la nouvelle policy d'insertion.
- **Rollback** : possible en désactivant la nouvelle policy d'insertion publique, sans toucher au cycle existant (invitation patron→client).
- **Exclu** : recherche publique, avis, paiement réel — cette phase se limite à faire fonctionner la boucle sur un accès direct (lien/QR), pas sur une recherche large.

### Phase 4 — Pilote restreint (zone + métiers limités)

- **Objectif** : valider la boucle complète (fiche/lien → demande → acceptation → conversation → devis → intervention → preuve → facture) avec de vrais professionnels et clients, sur un métier et une zone choisis humainement (décision bloquante du contrat de vision).
- **Dépendances** : Phases 0 à 3 terminées et testées.
- **Risques** : les risques produit (pas seulement techniques) dominent cette phase — voir le contrat de vision sur la nécessité de valider avant d'étendre.
- **Critères de sortie** : définis par les métriques de la roadmap d'exécution, pas uniquement techniques.
- **Exclu explicitement** : recherche publique large, paiement Stripe réel (sauf si jugé nécessaire au pilote par décision humaine), expansion sectorielle, internationalisation.

### Phases ultérieures (non détaillées ici, hors périmètre de cet audit)

Recherche publique à plus large échelle, paiement réel, avis/vérification/modération, monétisation par paliers, expansion sectorielle et géographique — toutes conditionnées à la validation du pilote de la Phase 4, conformément au principe de progression ordonnée du contrat de vision.

## 3. Compatibilité et non-régression

Aucune phase de ce plan ne modifie le comportement des 13 pages pro existantes ni le cycle `client_requests`/`seba_messages` actuel pour les clients déjà invités — toute nouvelle policy est additive. Le principal risque de régression concerne `profiles`/`companies` (Phase 0), dont la correction doit être vérifiée pour ne pas casser un flux qui, aujourd'hui, échoue silencieusement sans impact observable — un correctif mal testé pourrait au contraire introduire un effet de bord nouveau (écriture réussie là où elle échouait avant), à valider explicitement.
