# Catalogue des événements de notification — Portails Seba

**Créé** : 2026-08-02, pour le Lot 1 (centre de notifications commun). Canal V1 : in-app uniquement (table `notifications`, voir `PORTAL_DATA_CONTRACTS.md`). Email listé pour mémoire (branché en Lot 1 uniquement pour les événements marqués **email V1**, le reste reste in-app seul jusqu'à un lot ultérieur explicite — conforme à la consigne "ne bloque pas le Lot 1 sur OneSignal").

Colonnes : **Nom technique** (`event_type` stocké) | **Déclencheur** (fonction/RPC qui appelle `create_notification()`) | **Destinataire** | **Canal V1** | **Déduplication** | **Lien cible**.

## Client

| Nom technique | Déclencheur | Destinataire | Canal V1 | Déduplication | Lien cible |
|---|---|---|---|---|---|
| `client.invitation_accepted` | `resolveRoleLandingPage()` succès (première résolution de rôle client réussie) | Patron | in-app | par `client_id` (une fois) | `client-fiche.html?id=` |
| `intervention.confirmed` | Création intervention avec `clientId` renseigné | Client | in-app + email V1 | `dedup_key=intervention:{id}:confirmed` | `client-espace.html#intervention={id}` |
| `intervention.date_changed` | `SebaDB.update('interventions', id, {date:...})` détecte un changement de `date` | Client | in-app + email V1 | `dedup_key=intervention:{id}:date:{date}` | idem |
| `intervention.time_changed` | idem pour `time` | Client | in-app + email V1 | `dedup_key=intervention:{id}:time:{time}` | idem |
| `intervention.employee_changed` | `SebaDB.update` détecte un changement d'`employeId` | Client | in-app | `dedup_key=intervention:{id}:employee:{employeId}` | idem |
| `intervention.cancelled` | Changement de statut vers annulé | Client | in-app + email V1 | une fois par `id` | idem |
| `message.new` | `messages.send()` avec destinataire client | Client | in-app | jamais dédupliqué (chaque message compte) | fil concerné |
| `devis.available` | Devis passe au statut `attente` (envoyé) | Client | in-app + email V1 | une fois par `devis.id` | `client-espace.html#devis={id}` |
| `devis.accepted` | `client_accept_devis` succès | **Patron** (pas le client — c'est lui l'acteur) | in-app + email V1 | une fois par `devis.id` | `devis.html?open={numero}` |
| `facture.available` | Facture émise (`issued`) | Client | in-app + email V1 | une fois par `facture.id` | `client-espace.html#facture={id}` |
| `payment.recorded` | `recordPayment()` succès | Client | in-app | une fois par paiement | idem |
| `intervention.completed` | `completeIntervention()` succès (premier `submitted`) | Client | in-app | une fois par `id`, réinitialisé si réouverture (nouveau `submitted`) | `client-espace.html#intervention={id}` |
| `intervention.report_available` | `ownerApproveIntervention()` succès | Client | in-app + email V1 | une fois par validation patron | idem |
| `intervention.incident` | `reportIssue()`/incident salarié communiqué au client | Client | in-app | une fois par incident | idem |
| `complaint.reply` | Réponse patron à une réclamation (Lot 6) | Client | in-app + email V1 | une fois par réponse | fil réclamation |

## Salarié

| Nom technique | Déclencheur | Destinataire | Canal V1 | Déduplication | Lien cible |
|---|---|---|---|---|---|
| `employee.invitation_accepted` | Première résolution de rôle salarié réussie | Patron | in-app | une fois | `employe-fiche.html?id=` |
| `mission.new` | Assignation d'un `employeId` sur une intervention | Salarié | in-app + email V1 | `dedup_key=intervention:{id}:assigned:{employeId}` | `espace-terrain.html#mission={id}` |
| `mission.changed` | Changement de date/heure/durée sur une mission déjà assignée | Salarié | in-app | `dedup_key=intervention:{id}:changed:{champ}:{valeur}` | idem |
| `mission.cancelled` | Annulation d'une mission assignée | Salarié | in-app + email V1 | une fois par `id` | idem |
| `mission.reassigned_away` | L'`employeId` change et n'est plus ce salarié | Ancien salarié uniquement (information, pas d'accès) | in-app | une fois | aucun lien (accès déjà retiré) |
| `message.new` | `messages.send()` avec destinataire salarié | Salarié | in-app | jamais dédupliqué | fil concerné |
| `instruction.changed` | Modification de `instructions`/consignes sur une mission assignée | Salarié | in-app | `dedup_key=intervention:{id}:instructions:{hash}` | idem |
| `incident.needs_response` | Incident créé nécessitant une action du salarié assigné | Salarié | in-app + email V1 | une fois par incident | idem |
| `availability_request.decided` | Patron valide/refuse une demande d'absence | Salarié | in-app + email V1 | une fois par demande | `employe-fiche.html#disponibilites` |
| `report.correction_requested` | `reopenIntervention()` | Salarié assigné | in-app + email V1 | une fois par réouverture | `espace-terrain.html#mission={id}` |

## Professionnel

| Nom technique | Déclencheur | Destinataire | Canal V1 | Déduplication | Lien cible |
|---|---|---|---|---|---|
| `client.activated` | `client_accounts` insert (première activation) | Patron | in-app | une fois | `client-fiche.html?id=` |
| `employee.activated` | `employe_accounts` insert | Patron | in-app | une fois | `employe-fiche.html?id=` |
| `client_request.new` | `clientPortal.requests.create()` | Patron | in-app + email V1 | une fois par demande | `demandes.html?open={id}` |
| `devis.client_accepted` | `client_accept_devis` succès | Patron | in-app + email V1 | une fois | `devis.html?open={numero}` |
| `devis.client_refused` | `client_refuse_devis` succès | Patron | in-app + email V1 | une fois | idem |
| `message.new` | `messages.send()` avec destinataire patron | Patron | in-app | jamais dédupliqué | fil concerné |
| `employee.mission_started` | `execution.completionStatus` passe à `in_progress` | Patron | in-app | une fois par mission | `intervention-fiche.html?id=` |
| `mission.completed` | `completeIntervention()` succès | Patron | in-app + email V1 | une fois par soumission (donc peut se redéclencher après réouverture, c'est le comportement attendu) | idem |
| `mission.incident` | Incident créé sur une mission | Patron | in-app + email V1 | une fois par incident | idem |
| `complaint.new` | Réclamation créée (Lot 6) | Patron | in-app + email V1 | une fois | fil réclamation |
| `payment.received` | `recordPayment()` succès | Patron | in-app | une fois par paiement | `factures.html?open={numero}` |
| `availability_request.new` | Demande d'absence salarié créée | Patron | in-app + email V1 | une fois | `equipe.html#disponibilites` |

## Règles transverses (toutes lignes ci-dessus)

- **Contenu** : `title`/`body` ne contiennent jamais de donnée financière interne si le destinataire est un salarié, jamais de secret d'accès (Lot 3), jamais de note interne patron.
- **Préférence utilisateur** : chaque utilisateur peut désactiver le canal email par catégorie d'événement dès le Lot 1 (table `notification_preferences(user_id, event_type, email_enabled)` — schéma minimal, à créer avec le Lot 1 si le temps le permet, sinon reporté avec un défaut "email activé" documenté explicitement comme limitation V1).
- **Erreur et retry** : l'échec d'un envoi email ne doit **jamais** empêcher la création de la notification in-app (créer d'abord la ligne `notifications`, tenter l'email ensuite en best-effort, logger l'échec sans le remonter à l'utilisateur comme un échec de notification globale).
- **Déduplication** : implémentée via l'index unique partiel `(account, recipient_user_id, dedup_key)` sur la table `notifications` — un `INSERT ... ON CONFLICT DO NOTHING` suffit, pas de logique applicative fragile.
