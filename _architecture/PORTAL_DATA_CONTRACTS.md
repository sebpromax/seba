# Contrats de données — Portails Seba

**Créé** : 2026-08-02. Détail complet pour les objets du Lot 1 (notifications). Les objets des lots suivants sont esquissés (schéma indicatif) et seront figés au démarrage de leur lot respectif, jamais avant.

---

## `notifications` (nouvelle table — Lot 1)

| Champ | Type | Validation | Notes |
|---|---|---|---|
| `id` | `uuid` | `default gen_random_uuid()` | clé primaire |
| `account` | `text` | `not null references seba_state(account)` | l'entreprise concernée (toujours renseigné, même pour une notif Client/Salarié — sert à l'isolation multi-tenant) |
| `recipient_user_id` | `uuid` | `not null` | `auth.uid()` du destinataire réel (patron, client ou salarié) |
| `recipient_role` | `text` | `check in ('patron','client','employe')` | rôle du destinataire au moment de la création |
| `event_type` | `text` | `not null`, valeurs listées dans `PORTAL_NOTIFICATION_EVENTS.md` | ex. `intervention.reassigned`, `devis.accepted` |
| `severity` | `text` | `check in ('normal','important','urgent')`, défaut `normal` | |
| `title` | `text` | `not null` | court, affiché dans la liste |
| `body` | `text` | nullable | détail optionnel |
| `link_entity` | `text` | nullable | ex. `interventions`, `devis`, `factures`, `messages` |
| `link_entity_id` | `text` | nullable | id de l'objet cible (peut être orphelin si l'objet est supprimé plus tard — voir règle de repli) |
| `dedup_key` | `text` | nullable, index unique partiel `(account, recipient_user_id, dedup_key) where dedup_key is not null` | empêche un doublon pour le même événement+destinataire (ex. `intervention:{id}:reassigned:{timestamp_arrondi}`) |
| `read_at` | `timestamptz` | nullable | `null` = non lue |
| `created_at` | `timestamptz` | `default now()` | horodatage serveur, jamais client |

**Rôle créateur** : `service_role` uniquement, via une fonction serveur (`create_notification()`, `security definer`) appelée par les RPC métier existantes (jamais une insertion directe depuis le frontend, pour empêcher un rôle de se notifier lui-même à volonté ou de forger une notification pour un autre compte).
**Rôle lecteur** : le `recipient_user_id` uniquement (`auth.uid() = recipient_user_id`), jamais un autre utilisateur, même du même compte.
**Rôle modificateur** : le `recipient_user_id` peut uniquement modifier `read_at` (marquer lu), rien d'autre — policy `UPDATE` avec `WITH CHECK` limitant les colonnes modifiables via une fonction dédiée plutôt qu'un `UPDATE` de table brut si Postgres RLS seul ne peut pas restreindre par colonne (à trancher à l'implémentation, voir §Sécurité du plan Lot 1).
**Donnée sensible** : non en soi (pas de secret), mais `title`/`body` ne doivent **jamais** contenir un secret d'accès (coffre, Lot 3) ni des données financières internes si le destinataire est un salarié.
**Source de vérité** : cette table elle-même (pas dans `seba_state.state` — cycle de vie indépendant, volume potentiellement élevé, lectures fréquentes = candidate légitime à une table dédiée selon les critères de la mission).
**Règle de suppression** : pas de suppression par l'utilisateur (une notification lue reste dans l'historique) ; purge automatique possible après une rétention longue (ex. 180 jours), à trancher plus tard, hors périmètre Lot 1.
**Règle d'historique** : la table est elle-même l'historique (pas de table séparée `notification_history`).

---

## Objets existants (résumé, source de vérité déjà établie par l'audit du 2026-08-02)

| Objet | Source de vérité | Créateur | Lecteur | Modificateur | Sensible | Suppression |
|---|---|---|---|---|---|---|
| `client` | `seba_state.state.clients[]` | Patron | Patron (RW), Client (R, self, LOT 2) | Patron | `notes` interne oui | Pas de suppression dure observée |
| `employe` | `seba_state.state.employes[]` | Patron | Patron (RW), Salarié (R, self) | Patron | Non | `actif:false` (désactivation logique) |
| `intervention` | `seba_state.state.interventions[]` | Patron | Patron (RW), Salarié assigné (RW execution), Client (R allowlist) | Patron + Salarié (execution) | `execution.checklist/materials/incidents` jamais exposés client | Pas de suppression dure observée |
| `devis`/`facture` | `seba_state.state.devis[]`/`factures[]` | Patron | Patron (RW), Client (R) | Patron (écriture), Client (accept/refuse via RPC) | Montants, jamais modifiables côté client | Pas de suppression dure (statut `annulé`) |
| `seba_messages` | table dédiée `seba_messages` | Participant du fil | Participants du fil (RLS testée) | Auteur (visibilité), pas d'édition de contenu observée | Peut contenir des infos personnelles | Non observé |
| `client_accounts` / `employe_accounts` | tables dédiées | `client-provision.ts`/`employe-provision.ts` (service_role) | RPC `security definer` uniquement | service_role | Lien d'identité, sensible | Non observé (à couvrir par RGPD-001, Lot 16) |

---

## Objets futurs (esquisse, à figer au démarrage du lot correspondant)

### `client_locations` (Lot 2)
`id, account, client_id, label, is_primary, address, complement, city, postal_code, country, building, floor, has_elevator, intercom, parking, lat, lng, arrival_instructions, access_photos[], surface, rooms, pets, constraints, equipment_available, status(active|archived), created_at, updated_at`.
Créateur : Patron (RW), Client (proposition, Lot 2 précise le mode de validation). Lecteur : Patron (RW), Client (ses lieux), Salarié (lieu de sa mission active uniquement, jointure `interventions.locationId` + `interventions.employeId = auth`). Sensible : adresse physique — oui, restreint. Suppression : archivage seul si référencé par un document déjà émis (jamais une suppression dure qui casserait un historique de facturation).

### `access_secrets` (Lot 3)
`id, account, location_id, kind(code_immeuble|code_portail|code_alarme|boite_a_cles|autre), value, instructions, valid_from, valid_until, created_by, created_at`. Créateur : Patron (RW), Client (proposition avec validation). Lecteur : Patron (RW), Salarié **uniquement** si `exists (intervention assignée à ce salarié, à ce lieu, statut actif, maintenant entre les bornes de la mission)` — jointure RPC stricte, jamais un accès permanent. Sensible : **oui, maximal** — jamais dans une notification, jamais dans une URL, jamais dans un cache statique. Historique de consultation obligatoire (`access_secret_reads(secret_id, reader_user_id, read_at)`, append-only). Protection réelle à documenter honnêtement à l'implémentation (chiffrement de champ seulement si une clé serveur dédiée est réellement mise en place — sinon documenter que la protection est uniquement RLS + fenêtre temporelle, pas un chiffrement applicatif).

### `client_requests` étendu (Lot 4)
Déjà existant (`client_requests`), à étendre avec les statuts complets du cycle demandé (`brouillon → envoyée → en_étude → devis_envoyé → acceptée → planifiée → terminée → refusée → annulée`) — schéma exact à figer à l'ouverture du Lot 4 après relecture du schéma actuel de `client_requests`.

### `expenses` / `equipment_assignments` (Lot 12)
À figer à l'ouverture du Lot 12.

### `audit_log` immuable (Lot 16)
`id, account, actor_user_id, actor_role, action, entity, entity_id, old_value, new_value, created_at, request_id`. Append-only garanti par policies (aucun `UPDATE`/`DELETE` pour `authenticated`, écriture exclusivement par `service_role` via les RPC sensibles elles-mêmes — même patron que `entity_versions`, qui sert déjà de précédent testé dans ce dépôt).
