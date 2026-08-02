# Audit exhaustif de l'interconnexion Seba — Portail Professionnel / Client / Salarié

**Date** : 2026-08-02
**Branche auditée** : `main`, commit `db124017553abf99e994ba2a6c97e351d345bf58` (working tree propre au démarrage de l'audit)
**Site public réel** : `https://sebastienvalentin.com` (alias custom domain de `sebpromax.github.io/seba`), `docs/config.public.js` pointe vers le projet Supabase distant `ptmudezhxnhhyctowlqp`
**Méthode** : lecture directe du code de production + tests réels contre un environnement Supabase **local** isolé (Docker, reconstruit à neuf pour cet audit via `scripts/local-db/rebuild.sh`, baseline `supabase-schema.sql` + 15 migrations produit), aucune donnée réelle touchée. Les suites de test déjà présentes dans le dépôt (`scripts/local-db/test-*.sh`, `scripts/qa-*.js`) ont été **exécutées telles quelles**, jamais modifiées. Complété par 3 agents de recherche read-only pour la lecture de code à grande échelle (storage/documents/signature/journal ; notifications/hors-ligne ; inventaire fiches client/salarié) — chaque affirmation d'agent a été vérifiée indépendamment avant intégration ; deux erreurs d'agent ont été détectées et corrigées (voir §12 et §15).

**Périmètre non re-testé en direct** : la livraison d'email en production (Resend/SMTP Supabase Auth) n'a pas été re-sondée — aucun identifiant de production disponible ici, conformément à la consigne de ne demander aucun secret. L'état cité est le dernier constat documenté et daté du dépôt (`MANUEL-SEBA-ADMIN.md`, `_architecture/MASTER_BACKLOG.md` — QA360-P0-B), pas une observation de ce jour.

---

## 1. État réel du dépôt et de l'architecture

- **Branche** : `main`. **Dernier commit** : `db124017` (2026-08-02, merge PR #135, accessibilité — sans rapport avec ce périmètre). **Aucun fichier modifié/non suivi** au démarrage.
- **Écart local/main/production** : aucun écart détecté sur `main` lui-même. Le seul écart réel et documenté est **déployé vs versionné** pour deux Edge Functions (voir §3/§4) : `MASTER_BACKLOG.md` (DEPLOY-DRIFT-001) affirme que `client-provision`/`employe-provision` "n'existent dans aucun commit de l'historique git" — **c'est faux, vérifié par cet audit** : `git log --oneline -- supabase-functions/client-provision.ts` renvoie le commit `f39a25f`, présent sur `main` (confirmé par `git branch --contains f39a25f` qui liste `main`). Le backlog cherchait le mauvais chemin (`supabase/functions/`, avec slash) alors que les fichiers réels vivent dans `supabase-functions/` (racine, tiret). Le code source de ces deux fonctions **existe bel et bien sur `main`** et a été lu intégralement pour cet audit (§3/§4). Ce que je ne peux **pas** vérifier sans accès au tableau de bord Supabase de production : que le code réellement déployé correspond octet pour octet à ce qui est sur `main` aujourd'hui — `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` sur ce point précis.

### Inventaire des fichiers par domaine (vérifié par lecture directe)

| Domaine | Fichiers |
|---|---|
| Authentification | `docs/auth.js`, `docs/guard.js`, `docs/connexion.html`, `docs/client-connexion.html`, `docs/employe-connexion.html`, `docs/bienvenue.html`, `docs/reset-password.html` |
| Invitation client/salarié | `supabase-functions/client-provision.ts`, `supabase-functions/employe-provision.ts`, `migrations/2026-07-28-account-activation-bootstrap.sql` (RPC `create_profile_and_company`) |
| Fiche client/salarié | `docs/client-fiche.html`, `docs/employe-fiche.html`, `docs/clients.html`, `docs/equipe.html` |
| Planning/interventions | `docs/planning.html`, `docs/intervention-fiche.html`, `docs/assignation.html`, `migrations/2026-07-25-intervention-360.sql`, `migrations/2026-07-23-employee-portal-missions.sql` |
| Messages | `migrations/20260716_create_seba_messages.sql` (superseded), `migrations/20260720_mission_chat.sql` (policy finale réellement active), `docs/client-fiche.html`/`docs/employe-fiche.html`/`docs/client-espace.html`/`docs/espace-terrain.html` |
| Devis/factures/paiements | `docs/devis.html`, `docs/devis-nouveau.html`, `docs/devis-document.html`, `docs/factures.html`, `docs/factures-nouvelle.html`, `docs/facture-document.html`, `docs/recu-document.html`, `docs/commercial-document-render.js`, `migrations/2026-07-26-quote-to-cash.sql`, `migrations/2026-07-27-flexible-commercial-documents.sql` |
| Documents/photos | `docs/commercial-document-render.js`, buckets Storage (§12) |
| Notifications | `docs/email-service.js`, `docs/push-init.js`, `supabase-functions/send-email.ts`, `supabase-functions/send-commercial-document.ts` (existence), `send-push` (non déployé, voir §14) |
| Portail client | `docs/client-espace.html`, `docs/client-connexion.html`, `migrations/2026-07-23-client-portal-data-rls.sql` |
| Portail salarié | `docs/espace-terrain.html`, `docs/employe-connexion.html`, `migrations/2026-07-23-employee-portal-missions.sql`, `migrations/2026-07-24-mission-field-report.sql` |
| Dashboard pro | `docs/app/dashboard.html`, `docs/widgets.js`, `docs/sidebar.js` |
| Supabase / RPC / Edge Functions | `supabase-schema.sql` (fichier maître), `migrations/*.sql`, `supabase-functions/*.ts` |
| Service worker / PWA | `docs/sw.js`, `docs/manifest.json`, `docs/offline.html` |
| Stockage local (frontend) | `docs/seba-data.js` (`localStorage['seba_pending_ops']`, cache `seba_db_*`) |
| Supabase Storage | buckets `company-logos`, `intervention-photos`, `intervention360-photos`, `mission-photos` |

### Architecture réelle des données

**`seba_state.state` (JSONB, une ligne par compte) est l'unique source de vérité opérationnelle réellement utilisée.** Ceci est un fait déjà établi et documenté par `_architecture/ADR_DATA_SOURCE_OF_TRUTH.md` (2026-07-30) — **vérifié à nouveau et confirmé par cet audit**, avec un point que l'ADR laissait explicitement en suspens : *"Lecture portail employé : présumée du même patron, non relue ligne par ligne — à vérifier."* **C'est maintenant vérifié** : `get_my_employee_interventions()` a été testée en direct (§5, `test-employee-portal-rls.sh`) et suit bien le même patron RPC `security definer` filtrant `seba_state.state` en JSONB, enrichie de l'adresse client (contrairement à ce que laissait craindre l'entrée de backlog QA360-P2-B, voir §16).

**Tables normalisées** (`clients`, `devis`, `factures`, `paiements`, `interventions`, `employes`) : confirmées vestigiales, aucun chemin de lecture/écriture actif trouvé. Le test `test-client-portal-rls.sh` confirme explicitement qu'une requête brute sur ces tables reste bloquée et n'est jamais utilisée comme chemin alternatif.

**Carte des flux (patron)** :
```
clients.html/devis.html/... → SebaDB.create/update/remove() (docs/seba-data.js)
  → mutation locale + pushOp() (file localStorage['seba_pending_ops'])
  → sync-push (Edge Function) → RPC apply_entity_patch(account, entity, entity_id, patch, op)
  → écriture atomique : seba_state.state (source lue) + entity_versions (bookkeeping, jamais relu par l'app)
  → lecture : GET /rest/v1/seba_state?select=state&account=eq.<compte>
```

**Carte des flux (client/salarié)** :
```
client-espace.html / espace-terrain.html → sebaAuth.rpc('get_my_client_*'/'get_my_employee_*', {})
  → RPC security definer : résout auth.uid() → client_accounts/employe_accounts → account+client_id/employe_id
  → filtre seba_state.state → 'interventions'/'devis'/'factures' en JSONB côté serveur (jamais les tables normalisées)
  → réponse allowlist (jamais l'objet brut complet, voir §5/§8)
```

---

## 2. Modèle d'identité et de liaison des comptes

`auth.uid()` (Supabase Auth) est l'ancre unique. Trois tables de liaison, jamais de rôle stocké dans les métadonnées Auth :

- **Patron** : `seba_state.account = auth.uid()` (le compte EST l'utilisateur — un patron = un compte, `seba_state.user_id` confirmé égal à `auth.uid()` par tous les tests RLS exécutés).
- **Client** : table `client_accounts(client_user_id, account, client_id, email)` — liaison créée par `client-provision.ts` (§3).
- **Salarié** : table `employe_accounts(employe_user_id, account, employe_id, email)` — liaison créée par `employe-provision.ts` (§4).
- **Résolution du rôle après activation** : `docs/reset-password.html:179-188`, fonction `resolveRoleLandingPage()` — appelle `get_my_client_profile()` puis `get_my_employee_profile()` côté serveur (jamais un flag stocké côté client) ; redirige vers la page correspondante, ou `connexion.html` par défaut (patron). **Le rôle n'est jamais déclaré par le frontend, toujours résolu par une RPC serveur qui interroge les tables de liaison.**

**Réponses aux questions posées** :
- Métadonnées Auth utilisées pour le rôle : **non**, table de liaison dédiée uniquement.
- Frontend peut-il falsifier le rôle : **non** — `get_my_client_profile()`/`get_my_employee_profile()` sont `security definer`, résolvent `auth.uid()` côté serveur ; RÉEL ET TESTÉ (§5, anonyme + cross-account systématiquement refusés sur ces RPC dans 5 suites de test différentes).
- Changement d'email casse-t-il la liaison : `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` — aucun test exécuté sur ce scénario précis (le lien est fait sur `auth.uid()`, stable même si l'email change côté Supabase Auth ; **probable mais non testé**).
- Une même adresse peut-elle appartenir à plusieurs entreprises : `client-provision.ts:106-108` refuse explicitement une invitation sur un email déjà utilisé ailleurs dans Supabase Auth (409, message clair) — un email = un seul compte Auth = un seul rattachement possible avec ce mécanisme. `RÉEL ET TESTÉ` au niveau code, non re-testé en direct (dépend de l'email cassé, §3).
- Cumul de rôles (salarié aussi client, client sur plusieurs patrons) : `MANQUANT` — aucun mécanisme trouvé pour lier un même `auth.uid()` à plusieurs comptes `client_accounts`/`employe_accounts` distincts ; **rien n'empêche techniquement plusieurs lignes** (pas de contrainte UNIQUE sur `client_user_id` seul dans le schéma), mais aucune UI ne gère la sélection d'un compte parmi plusieurs — cas non prévu, ni interdit ni supporté proprement.

---

## 3. Parcours complet d'invitation client

Code source lu intégralement (`supabase-functions/client-provision.ts`, §1 — **contrairement à l'affirmation DEPLOY-DRIFT-001 du backlog, ce code existe sur `main`**).

- **Fiche client** : persistée dans `seba_state.state.clients[]` (JSONB), id stable côté client (`id_xxx`, généré frontend). Email non obligatoire pour la création (le champ `client_id`/`email` n'est requis que par la fonction d'invitation, pas par la création de fiche elle-même — `clients.html`). Rien n'empêche deux fiches avec le même email (**MANQUANT** — confirmé aussi côté `SEBA_PILOT_READINESS_AUDIT.md` : "créer deux fois le même client... crée deux fiches distinctes sans avertissement", trouvé indépendamment sur un compte patron réel).
- **Génération du lien** : délègue entièrement à `supabase.auth.admin.inviteUserByEmail()` (`client-provision.ts:99-101`) — **pas de token maison** : génération, aléa cryptographique, expiry et usage unique sont gérés nativement par Supabase Auth (mécanisme standard, pas auditable ligne à ligne depuis ce dépôt, mais reconnu comme fiable). Idempotence : un `client_id` déjà lié dans `client_accounts` renvoie `already_provisioned:true` sans réinviter (`client-provision.ts:89-96`) — `RÉEL ET TESTÉ` (lecture code claire, logique simple).
- **Contrôle d'accès** : le caller doit être `owner.user_id === callerUid` (`client-provision.ts:82-85`), sinon 403 — empêche un patron d'inviter un client au nom d'un autre patron. **RISQUE DE SÉCURITÉ à vérifier** : `verifyUser()` (ligne 42-52) décode le JWT **sans vérifier sa signature cryptographique** dans le code de la fonction elle-même — ceci n'est sûr que si la fonction est déployée avec `verify_jwt=true` au niveau de la passerelle Supabase (vérification faite avant l'exécution du code). Je n'ai **pas pu confirmer ce paramètre de déploiement** pour ces deux fonctions précises sans accès au tableau de bord de production — `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ`. Si `verify_jwt=false` avait été utilisé par erreur, un JWT forgé avec un `sub` arbitraire suffirait à usurper n'importe quel patron. À vérifier en priorité par le fondateur (`npx supabase functions list` affiche ce paramètre).
- **Envoi** : passe par le même relais SMTP que l'inscription patron (Supabase Auth → Resend). **État actuel documenté (non re-testé ce jour)** : `MANQUANT` — cause confirmée le 2026-07-30 (`MANUEL-SEBA-ADMIN.md:16`, `MASTER_BACKLOG.md` QA360-P0-B) : domaine expéditeur `onboarding@resend.dev` non vérifié chez Resend, tout email finit en `failed` malgré un `200` apparent côté appelant. Case à cocher toujours `[ ]` (non résolue) dans `MANUEL-SEBA-ADMIN.md` à la date de son dernier commit. **Aucun renvoi manuel, aucun log de statut de livraison visible dans le dashboard patron** — `client-provision.ts` ne journalise pas le succès/échec d'envoi au-delà du code HTTP retourné à l'appelant.
- **Activation** : lien valide/expiré/déjà utilisé/révoqué — délégué à Supabase Auth nativement, `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` en conditions réelles (nécessiterait un email réel reçu, bloqué par le point précédent). Le mécanisme de résolution de rôle post-activation (§2) est lui `RÉEL ET TESTÉ` en local (RPC `get_my_client_profile` testée directement, §5).
- **Liaison** : `client_accounts` insert (`client-provision.ts:118-120`) — testée en local (`test-client-portal-rls.sh`) : un client lié voit **uniquement** ses propres devis/factures/interventions, jamais celles d'un autre client du même patron ni d'un autre patron. `RÉEL ET TESTÉ`.

---

## 4. Parcours complet d'invitation et d'onboarding salarié terrain

Miroir exact de §3 (`employe-provision.ts`, même structure de code, même garde-fou propriétaire, même mécanisme Supabase Auth natif, même blocage email documenté). Différences réelles :

- **Rôle et permissions** : `employe-fiche.html:305-324` expose une liste de droits (`access-list` : planning / clients / devis-factures / réglages), stockée dans une chaîne `emp.acces` (`seba-data.js:4498`). **Granularité limitée** : pas de restriction par client individuel, pas de distinction lecture/écriture par module — `V1 UTILE`, pas `V1 ESSENTIEL` complet.
- **Application côté serveur** : `RÉEL ET TESTÉ` — `test-employee-portal-rls.sh` confirme qu'un salarié ne peut modifier QUE sa propre mission assignée (refus contrôlé sur la mission d'un collègue), qu'un statut arbitraire est rejeté côté serveur, et que l'isolation cross-patron est totale.
- **Restriction de vue (finances/CA/marges/factures internes)** : `RÉEL ET TESTÉ` — `get_my_employee_interventions()`/`get_my_employee_intervention_detail()` ne renvoient jamais les champs financiers ; confirmé par `test-intervention-360-rls.sh` ("allowlist respectée, aucune fuite" sur checklist/matériaux/incidents côté client, et le salarié n'a par construction accès à aucune RPC de facturation — aucune RPC salarié ne référence `factures`/`paiements`).
- **Changement de rôle en cours de session** : `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` — non testé (nécessiterait de changer les droits pendant une session active et vérifier la prise d'effet immédiate ou après reconnexion).

---

## 5. Matrice d'interconnexion globale

| Donnée/action | Source de vérité | Pro | Client | Salarié | Persisté | Synchro | Notif | Contrôle serveur | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Identité client | `seba_state.state.clients[]` | RW | R (via RPC) | — | Oui | Après actualisation | Non | RLS+RPC | RÉEL ET TESTÉ |
| Identité salarié | `seba_state.state.employes[]` | RW | — | R (via RPC) | Oui | Après actualisation | Non | RLS+RPC | RÉEL ET TESTÉ |
| Coordonnées/adresses | client.adresse (1 seule) | RW | R | R (mission) | Oui | Après actualisation | Non | RLS | RÉEL ET TESTÉ (1 adresse) / MANQUANT (multi-adresses) |
| Codes d'accès/clés | absent en champ dédié | — | — | — | — | — | — | — | MANQUANT |
| Notes internes | `client.notes` | RW | Jamais exposé | Jamais exposé | Oui | Après actualisation | Non | Allowlist RPC | RÉEL ET TESTÉ |
| Consignes client (mémoire/plans) | `operationalMemory`/`servicePlans` | RW | Partiel | Partiel (instructions) | Oui | Après actualisation | Non | RLS | RÉEL ET TESTÉ |
| Devis | `seba_state.state.devis[]` | RW | R + accept/refuse | — | Oui | Après actualisation | Non (§14) | RLS+RPC, testé cross-account | RÉEL ET TESTÉ |
| Acceptation devis | `devis.status/acceptedAt` | R | W (bouton, pas signature) | — | Oui | Après actualisation | Non | RPC idempotente testée | RÉEL ET TESTÉ |
| Signature | absent | — | — | — | — | — | — | — | MANQUANT (voir §10) |
| Planning/intervention | `seba_state.state.interventions[]` | RW | R (allowlist) | R+W (sa mission) | Oui | **Après actualisation, jamais temps réel** | Non | RLS+RPC, testé exhaustivement | RÉEL ET TESTÉ |
| Assignation/changement | `intervention.employeId` | RW | — | R (perte immédiate si réassigné) | Oui | Après actualisation | Non | Testé (§6/§8) | RÉEL ET TESTÉ |
| Récurrence | `servicePlans` | RW | R | — | Oui | Après actualisation | Non | RLS | RÉEL NON TESTÉ (mécanique non exécutée en direct dans cet audit) |
| Annulation | `intervention.statusHistory` | RW | R | R | Oui | Après actualisation | Non | RLS | RÉEL ET TESTÉ (via statusHistory) |
| Messages généraux/intervention | `seba_messages` | RW | RW (fil autorisé) | RW (fil autorisé) | Oui | Après actualisation | Non (push) | RLS testé en direct (§7) | RÉEL ET TESTÉ |
| Messages internes | non distingués dans `seba_messages` | — | — | — | — | — | — | — | NON APPLICABLE (mécanisme différent, voir §7) |
| Checklist/notes/photos/incidents mission | `intervention.execution.*` | R | R (allowlist, photos filtrées) | RW (sa mission) | Oui | Après actualisation | Non | RLS testé exhaustivement | RÉEL ET TESTÉ |
| Compte rendu | `execution.completionStatus`+historique | R/valide | R (une fois approuvé) | W | Oui | Après actualisation | Non | RLS testé | RÉEL ET TESTÉ, avec 1 anomalie sur le cycle réouverture (§8) |
| Facture | `seba_state.state.factures[]` | RW | R | — | Oui | Après actualisation | Non | RLS+RPC testé cross-account | RÉEL ET TESTÉ |
| Paiement | `facture.paiements[]` | RW | R (lecture solde) | — | Oui | Après actualisation | Non | Testé (partiel+final, solde) | RÉEL ET TESTÉ |
| Remboursement/correction | absent | — | — | — | — | — | — | — | MANQUANT (P1 déjà documenté, `SEBA_PILOT_READINESS_AUDIT.md`) |
| Reçu | généré à la volée depuis paiement | R | R | — | Oui (dérivé) | Après actualisation | Non | Testé | RÉEL ET TESTÉ |
| Documents (devis/facture/reçu) | HTML imprimable, snapshot JSONB | R | R (même moteur) | — | Snapshot oui, PDF non | Après actualisation | Non | Isolation testée | RÉEL ET TESTÉ (voir §12 pour la nuance PDF) |
| Disponibilités salarié | `weeklyAvailability` | R | — | RW (demandes) | Oui | Après actualisation | Non | RLS testé (`test-team-availability-rls.sh`) | RÉEL ET TESTÉ |
| Absences/indisponibilités | `unavailabilityRequests` | R (valide) | — | RW | Oui | Après actualisation | Non | RLS testé | RÉEL ET TESTÉ |
| Temps planifié/réel | `execution.timing` | R | — | RW | Oui | Après actualisation | Non | RLS testé | RÉEL ET TESTÉ |
| Compétences | `employe.skills` | RW | — | R | Oui | Après actualisation | Non | RLS | RÉEL ET TESTÉ |
| Permissions | `employe.acces` (string) | RW | — | R | Oui | Après actualisation | Non | Appliqué par RPC (allowlist), pas granulaire | PARTIEL |
| Journal d'audit | `seba_state.state.journal[]` | RW (via même patch que le reste) | — | — | Oui | Après actualisation | Non | **Aucun — même JSONB que les données métier** | PARTIEL / RISQUE (voir §18) |

**Aucune ligne "temps réel" au sens strict (Supabase Realtime/WebSocket)** : `grep -r "realtime\|\.channel(\|\.subscribe(" docs/` ne retourne aucun usage de l'API Realtime de Supabase dans le frontend consulté durant cet audit — toute la propagation inter-portails observée est **"après actualisation"** (rechargement de page ou nouvel appel RPC), jamais un push serveur→client. Ceci n'a pas été vérifié par un grep exhaustif dédié dans cette passe précise mais s'aligne avec tous les tests exécutés (aucun n'observe de mise à jour sans rechargement explicite).

---

## 6. Tests de synchronisation du planning

Exécuté via `scripts/qa-intervention-360.js` (données 100% synthétiques : patrons A/B, clients A1/A2/B, salariés A1/A2/B, comptes dédiés `QA360-*`, jamais partagés avec des données réelles) et les suites RLS dédiées.

1. Création intervention (patron) → **RÉEL ET TESTÉ**.
2. Rattachement client → **RÉEL ET TESTÉ**.
3. Assignation salarié → **RÉEL ET TESTÉ**.
4. Visibilité patron → **RÉEL ET TESTÉ** (immédiate, même session).
5. Visibilité client → **RÉEL ET TESTÉ**, après actualisation (nouvelle session/appel RPC dans le test).
6. Visibilité salarié → **RÉEL ET TESTÉ**, après actualisation, avec adresse enrichie (contredit l'hypothèse non vérifiée de l'ADR — confirmé correct).
7-9. Modification date/heure/durée → **RÉEL NON TESTÉ dans cette passe précise** (le test exécuté couvre le cycle d'exécution complet, pas une modification de date isolée — mécanisme RLS déjà validé pour l'écriture patron en général, donc probable mais pas isolément prouvé ce jour).
10-12. Rafraîchissement des 3 espaces / déconnexion-reconnexion / cohérence unique → **RÉEL ET TESTÉ** (`test-sync-push-state-persistence.js`, CAS 10 : cycle réel interface → reload → reconnexion, une seule version cohérente confirmée).
13-15. Changement d'assignation A1→A2, perte d'accès A1, gain d'accès A2 → **RÉEL ET TESTÉ** (`test-employee-portal-rls.sh` : "employé A1 ne voit plus la mission de A2" testé symétriquement dans les deux sens ; le commentaire SQL de `migrations/2026-07-20-mission_chat.sql` confirme explicitement que la vérification se fait "EN DIRECT contre l'assignation ACTUELLE, jamais une valeur figée").
16-17. Annulation + propagation → **PARTIEL** : le statut change et se propage (statusHistory testé), mais aucune notification n'est envoyée à qui que ce soit (§14).
18. Historique → **RÉEL ET TESTÉ** (`statusHistory` avec acteur/rôle/timestamp, confirmé sans doublon dans `test-intervention-360-rls.sh` run standard).

**Récurrences, modification d'une seule occurrence vs toute la série, conflits de planning, créneaux dépassés** : `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` dans cette passe — `servicePlans` existe et génère des interventions (`client-fiche.html:558-562`), mais aucun test d'audit n'a exercé le cas "modifier une seule occurrence d'une série récurrente" ni la détection de conflit de planning ; à traiter dans un lot dédié (§23).

---

## 7. Audit des messages

**Découverte importante, corrigeant une lecture naïve du schéma** : la migration initiale `20260716_create_seba_messages.sql` pose une policy naïve (`auth.uid() = user_id`, visible uniquement par l'expéditeur — aurait empêché tout destinataire de lire un message qui lui est adressé). Cette policy est **entièrement remplacée** par `20260720_mission_chat.sql`, qui introduit une policy basée sur l'appartenance réelle au fil (patron via `seba_state`, client via `client_accounts`, salarié via `employe_accounts`, ou participant à une `client_request` liée). **Vérifié que c'est bien la version finale active** : `supabase-schema.sql` contient les deux définitions dans l'ordre (la seconde, ligne ~1070, écrase la première par `DROP POLICY IF EXISTS` + `CREATE POLICY`), et une requête directe `pg_policies` sur l'environnement local reconstruit confirme que seule la version participant-based est active.

**Test isolé exécuté ce jour** (SQL direct, comptes synthétiques `test-patron-a`/client A1/A2/salarié A1, jamais de données réelles) :
- Patron envoie un message au fil du client A1, persiste, `COMMIT` réel (pas un rollback de démonstration).
- Client A1 le voit (1 ligne) — **OK**.
- Client A2 (même patron, autre fiche) ne le voit pas (0 ligne) — **OK**.
- Salarié A1 (non partie au fil) ne le voit pas (0 ligne) — **OK**.
- Patron le voit — **OK**.
- Anonyme ne voit rien (0 ligne) — **OK**.
- Client A2 tente d'usurper le fil du client A1 sur un INSERT → **refusé par RLS** (`new row violates row-level security policy`), 0 ligne résiduelle après tentative — **OK**.

**Verdict messagerie** : `RÉEL ET TESTÉ`, réellement interconnectée et isolée server-side, persistée dans une vraie table (pas `localStorage`, pas seulement le DOM).

**Messages internes invisibles du client** : il n'existe **pas** de distinction "message interne" dans `seba_messages`/`mission_chat` — tout participant d'un fil (patron+client, ou patron+salarié, ou patron+client+salarié via `request_id`) voit tout ce qui y est écrit. Ce n'est **pas un défaut** au sens propre : la distinction "interne vs visible client" existe ailleurs, correctement, au niveau de l'exécution d'intervention (`execution.checklist`/`materials`/`incidents` jamais exposés au client, `photos[].visibleToClient` filtré individuellement — testé exhaustivement en §8/§9). Ce sont deux mécanismes différents pour deux besoins différents ; aucun des deux ne fuit vers l'autre canal, mais il n'existe **pas de "note interne" au sein d'un fil de chat** — si un patron veut écrire une remarque interne sur un client SANS que ce soit dans `client.notes` (seul canal interne réel), il n'y a pas d'équivalent "message privé" adossé au fil client. `PARTIEL`.

---

## 8. Synchronisation complète d'une intervention

Testé de bout en bout via `scripts/qa-intervention-360.js` (30 assertions, comptes 100% synthétiques `QA360-*`), **exécuté en direct aujourd'hui** :

`RÉEL ET TESTÉ`, avec le détail exact de chaque étape :
- Assignation, réception salarié, visibilité client, changement d'horaire (implicite via `execution.timing`), démarrage (`in_progress`), checklist bloquante (refus de finalisation testé explicitement avec message d'erreur précis), photos avant/après obligatoires (refus si manquantes), matériaux, incident signalé par le client, réouverture par le patron **sans perte de données** (checklist/photos/matériaux confirmés préservés), correction, ré-approbation client, validation patron (`owner_approved`).

**Aucune ligne n'est temps réel véritable** (aucun WebSocket/canal Supabase Realtime détecté dans le code consulté) — tout est "après actualisation" (rechargement de page ou nouvel appel RPC).

**Anomalie détectée et reproduite ce jour, à classer avec prudence** : après le cycle réouverture → correction employé → réapprobation client → validation patron (`owner_approved` confirmé au moment même de l'action), un `createInvoice()` (qui **navigue** vers l'éditeur de facture préempli — comportement volontaire et documenté par un commentaire de code, `intervention-fiche.html:763-767`, confirmé fonctionner correctement et testé séparément avec succès dans `scripts/qa-flexible-commercial-documents.js` étapes 117-118), puis un rechargement complet montre `completionStatus: "reopened"` au lieu de `"owner_approved"` et aucun `invoiceId`. Deux `assert()` supplémentaires échouent (le second événement `"completed"` de l'historique n'apparaît pas non plus).

**Analyse de cause, sans intervention corrective (conforme à la consigne de ne pas corriger sans validation)** : le harnais de test local utilise un contournement `flushPatronStateToServer()` (psql direct) car l'Edge Function `sync-push` ne tourne pas dans l'environnement Supabase local — limitation d'infrastructure déjà documentée ailleurs dans ce dépôt. `ownerApproveIntervention()` (`docs/seba-data.js:5127-5140`) écrit en **local uniquement** (`SebaDB.update()`, file `pushOp`), jamais par une RPC serveur directe — contrairement aux actions salarié/client de ce même cycle qui, elles, passent par des RPC `security definer` écrivant directement côté serveur. Le seul flush vers le serveur après l'approbation patron a lieu **après** que `createInvoice()` a navigué la page du patron vers `factures-nouvelle.html` — un contexte de page différent, où l'état local en mémoire n'est plus garanti identique à celui d'`intervention-fiche.html` au moment de l'approbation. C'est l'hypothèse la plus probable au vu du code lu, **mais elle n'a pas été formellement confirmée par un test isolé sans ce contournement** (qui exigerait soit de modifier le test — interdit par la consigne de cet audit —, soit de tester contre un `sync-push` réellement déployé, hors de portée sans accès de production).

**Classification honnête** : `RÉEL ET TESTÉ` pour tout le cycle métier normal (assignation → exécution → checklist/photos → incident → réouverture → correction) ; `RISQUE DE SÉCURITÉ` non applicable ici (aucune fuite entre comptes) mais **`PARTIEL`** signalé sur la combinaison spécifique "validation patron immédiatement suivie d'une navigation vers l'éditeur facture puis rechargement" — reproductible, à re-tester en priorité avec un `sync-push` réellement actif (local ou distant) avant d'écarter l'hypothèse d'un vrai bug produit. Ne pas classer `MANQUANT` (le mécanisme existe et fonctionne dans le cas simple, confirmé par `qa-flexible-commercial-documents.js`) ni `MOCK/DÉMO` (les comptes et écritures sont réels).

**Changement d'assignation, retrait d'accès à l'ancien salarié** : `RÉEL ET TESTÉ` — confirmé symétriquement (§6, point 13-15) et re-confirmé dans ce même test 360 (`employé A2 ne voit pas la mission de A1`).

---

## 9. Checklists, notes, photos et comptes rendus

**Checklists** : modèle par intervention (`execution.checklist[]`, items `required`/`checked`/`checkedAt`/`checkedBy`), **RÉEL ET TESTÉ** — sauvegarde intermédiaire confirmée (chaque coche appelle une écriture, testée individuellement dans `qa-intervention-360.js` étapes 8-10), verrouillage effectif : la finalisation est **refusée côté serveur** tant qu'une tâche obligatoire n'est pas cochée (message précis retourné, pas un simple blocage UI). Visibilité client : la checklist elle-même n'est **jamais** exposée au client (confirmé par l'allowlist testée dans `test-intervention-360-rls.sh` : "aucune fuite checklist/materials/incidents").

**Notes** : distinction réelle entre `client.notes` (interne patron, jamais exposé — confirmé par lecture de `client-fiche.html` et l'allowlist RPC) et les commentaires d'intervention (`clientApproval.comment`, visible du patron et du client puisqu'échangé dans le cadre de l'approbation). Pas de note "visible du salarié uniquement" distincte trouvée — `PARTIEL`.

**Photos** : `RÉEL ET TESTÉ` pour le mécanisme d'upload+filtrage — chaque photo a un `type` (before/after), un `uploadedBy`, un `visibleToClient` **par photo individuelle** (confirmé dans les données observées lors du test : une photo `type:"before"` avec `visibleToClient:false` et une `type:"after"` avec `visibleToClient:true` dans le même test run), stockée dans le bucket privé `intervention360-photos` avec un `storagePath` structuré `accounts/{account}/interventions/{interventionId}/{photoId}` (uuid, non prévisible en dehors du préfixe compte). **Suppression/orpheline** : aucune policy `DELETE` trouvée par un agent de recherche pour `intervention-photos`/`mission-photos` (à vérifier — voir nuance ci-dessous) ; le bucket `intervention360-photos`, lui, possède bien une policy `DELETE` confirmée par requête directe sur l'environnement local (`intervention360_photos_delete`, cmd=DELETE). **Correction d'une affirmation d'agent** : un premier passage de recherche automatisée n'avait trouvé que 2 des 4 buckets réels — vérifié directement contre l'instance Postgres locale reconstruite (`select id, public from storage.buckets`) : il existe bien **4 buckets** (`company-logos` public, `intervention-photos`/`intervention360-photos`/`mission-photos` privés), pas 2. Ne pas se fier à la recherche par grep seule pour l'inventaire Storage — confirmé par requête SQL directe dans cet audit.

**Compte rendu** : `RÉEL ET TESTÉ` pour le cycle simple (checklist+photos complets → finalisation acceptée → `submitted` → approbation client → validation patron). Publication au client : automatique dès `submitted`/`approved` selon l'allowlist RPC, pas une action de publication séparée. Pas de génération PDF du compte rendu (même logique que §12 — document HTML imprimable, pas de PDF stocké côté serveur).

---

## 10. Signature client

**MANQUANT au sens strict demandé (capture réelle d'une signature — tracé canvas, image, ou nom tapé traité comme signature).**

Vérifié par lecture directe (`docs/seba-data.js`) :
- Acceptation de devis (`acceptDevis()`, ~ligne 3291-3332) : clic sur un bouton de confirmation (`client-espace.html`) → RPC `client_accept_devis` → stocke `status:'signe'`, `acceptedAt` (timestamp serveur via la RPC), `acceptedBy` (l'identifiant client, pas une preuve d'identité supplémentaire). **Aucun champ signature dans l'objet devis.**
- Approbation de fin d'intervention (`approveExecution()`, ~ligne 3417-3448) : même schéma — `clientApproval.status:'approved'`, `comment` optionnel, `submittedAt`, `submittedBy`. **Aucune capture graphique.**

Ce que cela EST réellement : une acceptation horodatée côté serveur (le timestamp vient de la RPC serveur, pas du navigateur du client — vérifié par le test `qa-quote-to-cash.js` étape 8 : "acceptation horodatée"), non falsifiable côté frontend puisque protégée par RLS/RPC (`test-client-portal-rls.sh` confirme qu'un client ne peut pas écrire directement dans `seba_state` en dehors de la RPC dédiée). Ce que cela n'EST PAS : une signature au sens juridique probant (pas de tracé, pas de preuve d'identité au-delà de la session Auth déjà authentifiée).

**Classification demandée par la consigne d'audit respectée à la lettre** : classé `MANQUANT`, **non simulé, non développé** dans le cadre de cet audit.

---

## 11. Sécurité et étanchéité multi-tenant

**RLS activée** sur 24 tables (vérifié par requête directe `pg_class.relrowsecurity` sur l'environnement local reconstruit — liste complète : `ai_context_hash, alert_logs, api_usage, api_usage_daily, client_accounts, client_requests, clients, companies, devis, employe_accounts, employes, entity_versions, factures, interventions, materiaux_couts, memoire_embeddings, paiements, profiles, public_service_requests, qa_photos, seba_messages, seba_state, sync_conflicts, sync_operations`).

**Tests de fuite exécutés en direct aujourd'hui, résultats bruts (aucune donnée réelle, comptes 100% synthétiques créés/détruits pour cet audit)** :

| Test | Résultat |
|---|---|
| Isolation `seba_state` patron A / patron B | OK — confirmé (`verify.sh` 4b) |
| Client A1 ne lit pas Client A2 (même patron) | OK — confirmé (`test-client-portal-rls.sh`) |
| Client A1 ne lit pas Client B1 (autre patron) | OK — confirmé |
| Client ne peut ni UPDATE ni DELETE `seba_state` (0 ligne affectée, policy réservée au patron) | OK — confirmé |
| Salarié A1 ne lit pas les missions d'A2 | OK — confirmé (`test-employee-portal-rls.sh`) |
| Salarié A1 ne lit pas B1 (autre patron) | OK — confirmé |
| Salarié ne peut pas modifier la mission d'un collègue | OK — refus contrôlé, message explicite |
| Salarié : statut arbitraire refusé côté serveur | OK — confirmé |
| Anonyme : 0 ligne visible partout, `EXECUTE` révoqué au niveau privilège sur toutes les RPC testées (pas juste un tableau vide — l'appel n'atteint jamais le corps de la fonction) | OK — confirmé sur `get_my_client_*`, `get_my_employee_*`, `update_my_employee_intervention_status`, 13 RPC Intervention 360, `create_team_availability_request`/`cancel_...`, `convert_public_service_request` |
| Requête brute sur tables normalisées (hors `seba_state`) | Toujours patron-only, aucune régression | 
| ID modifié dans une requête ne donne jamais accès à une autre ressource | OK — testé explicitement (usurpation de fil de message refusée, usurpation de compte cross-account refusée dans `test-sync-push-state-persistence.js` CAS 7) |
| Fuite de données financières vers un salarié | OK — aucune RPC salarié ne référence `factures`/`paiements` |
| Étanchéité multi-tenant Storage (`intervention360-photos`) | OK — bucket privé, policies `insert/select/delete` réservées à `authenticated` avec vérification d'appartenance |

**Verdict RLS** : `RÉEL ET TESTÉ`, exhaustivement, sur 6 suites de test indépendantes exécutées en direct ce jour (client-portal, employee-portal, field-report, intervention-360, team-availability, public-intake) plus un test de messages écrit spécifiquement pour cet audit — **zéro échec de sécurité observé** sur l'ensemble de ces tests.

**Point non couvert** (`TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ`) : vérification `verify_jwt` réel des Edge Functions `client-provision`/`employe-provision` en production (§3).

**Données sensibles — qui lit quoi** :
- Codes d'accès/clés : champ dédié absent (§16), donc non applicable pour l'instant.
- Notes internes : jamais envoyées au frontend client (allowlist RPC vérifiée).
- Photos internes (checklist/matériaux/incidents) : jamais envoyées au client (allowlist vérifiée), photos `visibleToClient:false` jamais retournées par `get_my_client_intervention_detail()`.
- Factures/paiements : jamais accessibles à un salarié (aucune RPC salarié ne les expose).

---

## 12. Supabase Storage et documents

**4 buckets réels** (vérifiés par requête directe, corrigeant une recherche par grep incomplète d'un premier passage automatisé qui n'en avait trouvé que 2) :

| Bucket | Public | Policies confirmées |
|---|---|---|
| `company-logos` | Oui | `company_logos_select_public`, `_insert_own`, `_update_own`, `_delete_own` |
| `intervention-photos` | Non | INSERT/SELECT scopées par `account` (préfixe de chemin) |
| `intervention360-photos` | Non | INSERT/SELECT/DELETE, `authenticated` uniquement, confirmé restrictif par test direct (§8/§9) |
| `mission-photos` | Non | INSERT (salarié assigné uniquement, jointure `client_requests`+`employe_accounts`), SELECT (patron/salarié assigné/client) |

**Documents commerciaux (devis/facture/reçu)** : **pas de PDF généré ni stocké côté serveur.** `devis-document.html`/`facture-document.html`/`recu-document.html` sont des pages HTML imprimables (`@page{size:A4}` CSS, bouton déclenchant `window.print()` — l'utilisateur choisit "Enregistrer en PDF" dans la boîte de dialogue d'impression du navigateur, ce n'est pas Seba qui produit le fichier). **`documentSnapshot`** est bien persisté, mais dans `seba_state.state` (JSONB), pas dans Storage ni une table dédiée — figé au moment de l'envoi/émission (statut `attente`/`issued`), utilisé en repli si l'objet vivant a changé depuis. **Même fonction de rendu pour le patron et le client** — vérifié par un agent puis confirmé cohérent avec le test `qa-quote-to-cash.js` (le montant vu par le client correspond exactement à celui du patron à chaque étape) : `RÉEL ET TESTÉ`.

**Anciens documents sans snapshot** : repli vers un calcul live confirmé fonctionnel (`qa-flexible-commercial-documents.js` étapes 60-61, "vieux devis SANS documentSnapshot reste affichable").

**Isolation cross-tenant sur les documents** : `RÉEL ET TESTÉ` (`qa-flexible-commercial-documents.js` étape 56-57 : "patron B ne peut PAS ouvrir le document du patron A").

---

## 13. Tunnel devis → facture → paiement

**Testé de bout en bout aujourd'hui, en conditions réelles (`scripts/qa-quote-to-cash.js`, 21/21 assertions, comptes synthétiques dédiés), `RÉEL ET TESTÉ` sur toute la chaîne** :

- Devis 2 lignes, TVA 20%, remise 10€ → totaux HT/TVA/TTC exacts (135/27/162) — confirmé.
- Persistance après reload — confirmé.
- Client A1 voit son devis, Client B ne le voit ni en liste ni en détail (erreur explicite, pas un tableau vide silencieux) — confirmé.
- Acceptation par le client, horodatée côté serveur — confirmé.
- **Idempotence de l'acceptation** : un second appel ne crée aucun doublon d'événement `client_accepted` — confirmé.
- Conversion devis → facture : lignes et montants identiques, confirmé.
- Paiement partiel (100€) → statut `partially_paid`, solde exact (62€) — confirmé.
- Paiement final (62€) → statut `paid`, solde à 0 — confirmé.
- Persistance complète après reload (devis signé lié à la facture, facture payée, 2 paiements, solde 0) — confirmé.
- Aucun accès cross-account sur la facture (Client B refusé explicitement) — confirmé.
- Aucun appel anonyme possible sur `client_accept_devis` — confirmé (`permission denied for function`).
- Dashboard : aucune alerte résiduelle trompeuse, aucun scroll horizontal mobile — confirmé.
- Zéro erreur console sur tout le parcours (patron + client) — confirmé.

**Un client ne peut ni modifier un montant, ni changer un statut, ni marquer une facture payée** : confirmé par construction RLS (aucune RPC client n'expose ces opérations, testé négativement dans `test-client-portal-rls.sh` : UPDATE côté client sur `seba_state` affecte 0 ligne).

**Paiement** : mécanisme réel = enregistrement manuel patron (montant, méthode) persistant côté serveur — **aucune intégration Stripe active trouvée dans le chemin testé** (pas de clé Stripe réelle utilisée, pas d'appel réseau vers Stripe observé dans ces tests). Pas de mécanisme de correction/annulation de paiement dans l'UI — **déjà documenté comme P1 PILOT GATE** par `SEBA_PILOT_READINESS_AUDIT.md`, confirmé toujours absent par la lecture de code de cet audit (aucune fonction `cancelPayment`/`correctPayment` trouvée dans `seba-data.js`).

**Reçu** : généré à la volée depuis un paiement réel, impossible sans paiement associé, solde historique correct au moment du paiement (pas le solde actuel) — `RÉEL ET TESTÉ` (`qa-flexible-commercial-documents.js` étapes 44-46).

---

## 14. Notifications

**Constat principal : infrastructure générique présente, quasi aucun événement métier réellement câblé.**

| Événement | Déclenchement réel trouvé | Preuve |
|---|---|---|
| Invitation client envoyée | Oui, mais uniquement l'email natif Supabase Auth (`inviteUserByEmail`) — pas un appel Seba `sendDocument`/`notifyMe` | `client-provision.ts:99-101` |
| Invitation client acceptée / 1ère connexion | Non | aucun site d'appel trouvé |
| Invitation salarié envoyée | Idem client (email natif Auth uniquement) | `employe-provision.ts:99-101` |
| Invitation salarié acceptée | Non | aucun site d'appel trouvé |
| Nouvelle demande client | Non | `clientPortal.requests.create()` ne notifie personne |
| Nouvelle intervention créée | Non | `planning.html` crée sans notifier |
| Changement date/heure intervention | Non | aucun site d'appel trouvé |
| Réassignation salarié | Non | aucun site d'appel trouvé |
| Annulation intervention | Non | aucun site d'appel trouvé |
| Nouveau message | Non (push) / statut lu-non-lu en base uniquement | colonne `seba_messages.lu` existe, badge non-lu affiché côté client (`client-espace.html`), mais aucun push/email envoyé à la réception |
| Devis disponible/accepté/refusé | Non | `acceptDevis()`/`refuseDevis()` ne notifient personne |
| Facture disponible/paiement reçu | Non | aucun site d'appel trouvé |
| Intervention démarrée/terminée | Non | `completeIntervention()` ne notifie personne |
| Incident signalé | Non (visible seulement via alerte dashboard patron au prochain chargement, pas un push) | confirmé aussi dans `qa-intervention-360.js` étape 18 : l'alerte apparaît au dashboard, pas de notification poussée |
| Document/photo ajouté | Non | événement local (`statusHistory`) uniquement |
| Compte rendu publié | Non | aucun site d'appel trouvé |

**Infrastructure existante mais non branchée** : `docs/email-service.js` (`sebaEmail.sendDocument()`), `docs/push-init.js` (`sebaPush.notifyMe()` via OneSignal, Edge Function `send-push`). `send-push` est en outre **confirmé non déployé** en production par le précédent audit de vérité (`SEBA_PILOT_READINESS_AUDIT.md` §2, 404 identique à un nom de fonction inventé) — non re-testé en direct ce jour (`TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ`, pas d'accès production).

**Verdict notifications** : `MANQUANT` pour la quasi-totalité des événements métier listés — seul le mail d'invitation natif Supabase existe réellement (et lui-même actuellement cassé en production, §3/§4). Le badge non-lu in-app est `RÉEL ET TESTÉ` uniquement pour l'affichage (aucun test dédié de la mise à jour du compteur exécuté dans cet audit, `RÉEL NON TESTÉ`).

---

## 15. Moteur hors ligne du portail terrain

**Correction importante d'une première recherche automatisée** : un agent avait conclu "aucun service worker trouvé" en cherchant uniquement le nom `service-worker.js`. **Vérifié directement par cet audit** : le fichier existe sous le nom `docs/sw.js`, lu intégralement.

Ce que `sw.js` fait réellement (`docs/sw.js:1-84`) :
- Stratégie **Network First avec repli cache**, sur toutes les requêtes GET same-origin (pas seulement une liste figée).
- Liste `CORE` pré-cachée à l'installation : `index.html, connexion.html, onboarding.html, offline.html, app/dashboard.html, clients.html, planning.html, devis.html, devis-nouveau.html, factures.html, factures-nouvelle.html, equipe.html, reglages.html, historique.html` + assets statiques — **ce sont les pages du patron et du site public, jamais les pages du portail salarié ou client.**
- Mise en cache opportuniste additionnelle : toute page/asset same-origin réellement visité une fois est aussi mis en cache, au-delà de la liste `CORE`.
- Repli hors-ligne : `offline.html` uniquement pour une **navigation** jamais mise en cache — un asset jamais caché échoue simplement.

**Découverte critique, vérifiée par grep direct sur les 41 pages qui appellent `serviceWorker.register()`** : `docs/espace-terrain.html`, `docs/client-espace.html`, `docs/employe-connexion.html`, `docs/client-connexion.html`, `docs/reset-password.html` et `docs/bienvenue.html` **ne l'appellent jamais**. Seule `docs/app/dashboard.html` l'enregistre parmi les pages "applicatives". **Conséquence concrète** : un salarié dont le parcours réel est `bienvenue.html`/`reset-password.html` (activation) → `employe-connexion.html` → `espace-terrain.html` **ne déclenche à aucun moment l'installation du service worker**, sauf s'il a visité une autre page l'enregistrant au préalable dans ce même navigateur (par exemple la page d'accueil publique) — non garanti pour un nouvel utilisateur invité qui clique directement le lien d'email. **Le moteur hors ligne existe dans le dépôt mais n'est architecturalement pas raccordé au parcours réel du portail salarié/client.**

**IndexedDB** : absent — confirmé, aucune occurrence dans `docs/`. `localStorage` seul porte la file de synchronisation.

**File de synchronisation** (`docs/seba-data.js`) : `localStorage['seba_pending_ops']` — survit à une fermeture complète du navigateur (stockage persistant, pas seulement en mémoire), retry avec backoff exponentiel, bascule automatique vers un journal d'échecs après un nombre max de tentatives, flush automatique sur l'événement `online`. `RÉEL ET TESTÉ` pour la persistance de la file elle-même (confirmé par `test-sync-push-state-persistence.js` CAS 10, cycle réel création → reload → reconnexion).

**Photos hors ligne** : **non mises en file** — l'upload (`intervention360-photos`/`mission-photos`) est une tentative directe immédiate, sans repli local en cas d'échec réseau. Une photo prise sans réseau est donc perdue si l'upload échoue, contrairement aux écritures de données classiques (qui, elles, passent par la file `pushOp`).

**Conflits** : **aucune détection côté client** — le protocole serveur (`apply_entity_patch`) sérialise et applique un dernier-écrivain-gagnant sans rejet de version périmée (déjà documenté et testé, §1/§8), et le frontend ne compare jamais de version/timestamp avant d'envoyer une écriture en attente : aucun avertissement "modifié ailleurs" n'est jamais affiché.

**Pré-chargement des données de mission avant la coupure réseau** : aucun mécanisme de téléchargement explicite pour l'usage hors ligne trouvé — les missions ne sont disponibles hors ligne que si elles ont déjà été chargées en mémoire/`localStorage` lors d'une session en ligne précédente, sans garantie ni action utilisateur dédiée ("préparer le hors-ligne").

**Verdict hors ligne** : **`HORS LIGNE PARTIEL`** — la file de synchronisation des écritures textuelles est réelle et robuste, mais (a) le service worker n'est pas raccordé aux points d'entrée réels du portail salarié/client, (b) les photos ne bénéficient d'aucun repli hors ligne, (c) aucune détection de conflit, (d) aucun pré-chargement dédié des données de mission. Ce n'est ni `CONSULTATION SEULEMENT` (les écritures survivent réellement à une coupure via la file) ni `HORS LIGNE COMPLET`.

---

## 16. Inventaire complet de la fiche client

Comparaison au modèle cible, lecture directe de `docs/client-fiche.html` + `docs/clients.html` + `docs/seba-data.js` :

| Élément | Statut | Preuve |
|---|---|---|
| Nom, prénom, email, contact (tél/email) | V1 ESSENTIEL | `clients.html` (création), `client-fiche.html` (édition) |
| Statut, date de création, notes internes | V1 ESSENTIEL | `client-fiche.html` |
| Adresse (unique) | V1 ESSENTIEL | `client-fiche.html` |
| CA/solde attente/solde retard | V1 ESSENTIEL | `client-fiche.html` (stats calculées depuis factures) |
| Historique interventions, devis/factures/contrats | V1 ESSENTIEL | tables affichées dans `client-fiche.html` |
| Champs métier personnalisés | V1 ESSENTIEL | `client-fiche.html`, `champsMetier` |
| Mémoire opérationnelle (préférence/accès/équipement/risque/qualité/facturation/relation/consigne) | V1 UTILE | `client-fiche.html`, `operationalMemory.entries` |
| Plans récurrents (fréquence/jour/créneau/employé préféré/consignes) | V1 UTILE | `client-fiche.html`, `servicePlans` |
| Timeline/demandes/messagerie | V1 UTILE | `client-fiche.html`, tables séparées (`client_requests`, `seba_messages`) |
| Avatar | V1 UTILE | initiales seulement, pas de photo réelle |
| Langue, contact secondaire, contact d'urgence, origine du client | V2 | non trouvé |
| Plusieurs adresses, étage/interphone/code d'accès/parking/clés, pièces/surface/animaux/contraintes, matériel disponible | V2 | non trouvé en champs dédiés (stockable de façon non structurée via `champsMetier`, pas un vrai modèle) |
| Produits autorisés/interdits, allergies, pièces prioritaires, checklist client | V2 | non trouvé en champ dédié |
| Réclamation (champ dédié) | V2 | absent — traité informellement via incidents/mémoire |
| Préférences email/SMS/push | V2 | non trouvé |
| Satisfaction (score) | V2 | non trouvé |
| Remboursements | V2 | non trouvé (cohérent avec §13) |
| Consentements (communication/photos/données/export/suppression) | V2/MANQUANT | non trouvé — voir aussi RGPD ci-dessous |

**RGPD/consentements — statut confirmé, déjà documenté et non résolu** (`MASTER_BACKLOG.md`, RGPD-001) : *"Aucune fermeture/effacement en self-service pour un compte client/employé invité — `erase_account_completely` ne couvre que le patron."* Statut `À DÉCIDER`, 9 points d'arbitrage fondateur listés dans le backlog, **non traité par cet audit** (hors périmètre technique, décision produit/juridique en attente). Classé `MANQUANT`.

---

## 17. Inventaire complet de la fiche salarié

Lecture directe de `docs/employe-fiche.html` + `docs/equipe.html` + `docs/seba-data.js` :

| Élément | Statut | Preuve |
|---|---|---|
| Nom, prénom, email, poste/rôle, statut actif | V1 ESSENTIEL | `equipe.html`, `employe-fiche.html` |
| Date d'entrée | V1 ESSENTIEL | `employe-fiche.html` |
| Compétences/services autorisés | V1 UTILE | `employe-fiche.html`, `skills` |
| Disponibilités habituelles (jours/créneaux), max heures/semaine | V1 UTILE | `employe-fiche.html`, `weeklyAvailability`/`maxWeeklyMinutes` |
| Indisponibilités/demandes de congé | V1 UTILE | `employe-fiche.html`, `unavailabilityRequests`, RLS testée (§5) |
| Droits/permissions (planning/clients/devis-factures/réglages) | V1 UTILE (peu granulaire) | `employe-fiche.html`, chaîne `acces` |
| Missions/planning (via interventions.employeId) | V1 UTILE | dépend de la collection interventions, pas de champ dédié sur la fiche salarié |
| Messages/consignes | V1 UTILE | `employe-fiche.html`, `seba_messages` |
| Notes internes | V1 UTILE (stockage réel non confirmé) | champ affiché, persistance non vérifiée indépendamment dans cet audit |
| Photo, téléphone, adresse, responsable/superviseur, contact d'urgence, langue | V2 | non trouvé (avatar = initiales générées) |
| Restriction fine par client/module, suspension de session, révocation | V2 | seul `actif:false` existe (bascule globale, pas de révocation de session active) |
| Zones géographiques, transport | V2 | non trouvé |
| Permis/certifications, autonomie, travail en équipe | V2 | non trouvé |
| Documents/certificats, notes de frais, matériel, export paie | V2 | non trouvé |
| Heures planifiées/réalisées, retards/pauses | V1 UTILE | dérivé de `execution.timing`, pas un module RH dédié |

**Note de cohérence avec le backlog** : QA360-P2-B affirmait que le détail de mission côté salarié "n'affiche pas l'adresse du client" par hypothèse de cause (réutilisation de l'objet liste plutôt qu'un rappel du RPC de détail enrichi). **Cet audit a testé directement `get_my_employee_interventions()` et confirmé qu'elle renvoie bien l'adresse enrichie côté RPC** (`test-employee-portal-rls.sh`, "adresse enrichie" explicitement confirmé). Le problème, s'il persiste, serait donc **uniquement frontend** (quelle fonction `espace-terrain.html` appelle réellement pour l'écran de détail) — non re-vérifié ligne à ligne dans le JS de `espace-terrain.html` par cet audit, `TEST IMPOSSIBLE — BLOCAGE DOCUMENTÉ` pour la confirmation finale frontend, mais le blocage suspecté côté RPC est **infirmé**.

---

## 18. Journal d'audit et traçabilité

**Deux mécanismes distincts trouvés, à ne pas confondre :**

1. **`journal` (dans `seba_state.state.journal[]`)** — un journal d'activité **applicatif**, pas un journal d'audit tamper-resistant. Entrée : `{id, ts, type, label, href}` (`docs/seba-data.js`), créée par `SebaDB.log()` sur ~60 sites d'appel (nouveau client, devis signé, paiement enregistré, employé désactivé, etc.), tronquée à 200 entrées, persistée dans le **même JSONB** que les données métier elles-mêmes. **Aucune protection en écriture distincte** : ce JSONB est modifié par le même chemin (`apply_entity_patch`) que n'importe quelle autre donnée du compte — un patron ayant les moyens de forger une requête RPC pourrait en théorie altérer ses propres entrées passées, exactement comme il pourrait altérer n'importe quelle autre donnée de son compte. Ce n'est **pas conçu comme une preuve opposable**, plutôt comme un fil d'activité pour l'utilisateur lui-même.
2. **`entity_versions`** — table technique, réellement append-only : écrite **exclusivement** par la RPC `apply_entity_patch()` elle-même (jamais un contenu fourni tel quel par le client), aucune policy INSERT/UPDATE pour le rôle `authenticated`. C'est la seule trace réellement immuable, mais elle est un artefact d'implémentation (bookkeeping de version/idempotence), **jamais exposée à l'utilisateur**, ne couvre pas les suppressions au sens d'un vrai journal métier lisible.

**Classement** : `HISTORIQUE MÉTIER SIMPLE` — le `journal` applicatif existe et fonctionne, mais n'a aucune garantie de tamper-resistance ; `entity_versions` fournit une trace technique immuable mais invisible et non conçue pour l'audit humain. Aucun des deux ne constitue un "journal d'audit complet" au sens strict demandé par cet audit (acteur + date + entreprise + objet + ancienne/nouvelle valeur + impossibilité de suppression, **le tout accessible et lisible**).

---

## 19. Matrice finale « réel vs fictif »

| Fonctionnalité | Source de vérité | Persisté serveur | Sécurisé RLS/RPC | Pro | Salarié | Client | Temps réel | Après actualisation | Hors ligne | Diagnostic |
|---|---:|---:|---:|---|---|---|---:|---:|---:|---|
| Création client | `seba_state.clients[]` | Oui | Oui | RW | — | — | Non | Oui | Écriture en file locale, pas de repli si offline non déjà chargé | OUI — TESTÉ |
| Invitation client | Supabase Auth natif | Oui (token Auth) | Oui (ownership check) | Déclenche | — | Reçoit | Non | N/A | N/A | PARTIEL — mécanisme réel, livraison email actuellement cassée en prod (documenté, non re-testé) |
| Activation client | `client_accounts` + RPC rôle | Oui | Oui | — | — | Oui | Non | N/A | N/A | OUI — TESTÉ (mécanisme), TEST IMPOSSIBLE (bout en bout réel, email cassé) |
| Création salarié | `seba_state.employes[]` | Oui | Oui | RW | — | — | Non | Oui | Idem client | OUI — TESTÉ |
| Invitation salarié | Supabase Auth natif | Oui | Oui | Déclenche | Reçoit | — | Non | N/A | N/A | PARTIEL — idem client |
| Activation salarié | `employe_accounts` + RPC rôle | Oui | Oui | — | Oui | — | Non | N/A | N/A | OUI — TESTÉ (mécanisme) |
| Rôle | tables de liaison | Oui | Oui | — | Résolu serveur | Résolu serveur | Non | N/A | N/A | OUI — TESTÉ |
| Permissions salarié | `employe.acces` (string) | Oui | Partiel (peu granulaire) | RW | R | — | Non | Oui | — | PARTIEL |
| Adresses | `client.adresse` (1 seule) | Oui | Oui | RW | R (mission) | R | Non | Oui | — | OUI — TESTÉ (1 adresse) |
| Codes d'accès | absent | — | — | — | — | — | — | — | — | MANQUANT |
| Planning | `seba_state.interventions[]` | Oui | Oui | RW | R+W (sa mission) | R (allowlist) | Non | Oui | Écritures en file | OUI — TESTÉ |
| Assignation | `intervention.employeId` | Oui | Oui | RW | R (perte immédiate si réassigné) | — | Non | Oui | — | OUI — TESTÉ |
| Changement d'assignation | idem | Oui | Oui | RW | Testé symétriquement | — | Non | Oui | — | OUI — TESTÉ |
| Récurrence | `servicePlans` | Oui | Oui (RLS générale) | RW | — | R | Non | Oui | — | RÉEL NON TESTÉ (mécanique de génération non exercée dans cet audit) |
| Changement d'horaire | `intervention.date/time` | Oui | Oui | RW | R | R | Non | Oui | — | RÉEL NON TESTÉ (isolément) |
| Annulation | `statusHistory` | Oui | Oui | RW | R | R | Non | Oui | — | OUI — TESTÉ |
| Messages généraux | `seba_messages` | Oui | Oui (testé aujourd'hui) | RW | RW | RW | Non | Oui | — | OUI — TESTÉ |
| Messages d'intervention | `seba_messages` + `request_id` | Oui | Oui | RW | RW | RW | Non | Oui | — | OUI — TESTÉ |
| Messages internes | non distingués | — | — | — | — | — | — | — | — | NON APPLICABLE (pas de canal dédié) |
| Notifications | quasi aucune | — | — | — | — | — | — | — | — | MANQUANT (voir §14) |
| Checklist | `execution.checklist[]` | Oui | Oui | R | RW | Jamais exposé | Non | Oui | — | OUI — TESTÉ |
| Photos | `execution.photos[]` + Storage | Oui | Oui | R | RW | R (filtré par photo) | Non | Oui | Pas de file offline | OUI — TESTÉ |
| Compte rendu | `execution.completionStatus`+historique | Oui | Oui | R/valide | W | R | Non | Oui | — | OUI — TESTÉ, 1 anomalie sur cycle réouverture (§8) |
| Incident | `execution.incidents[]`/`clientApproval` | Oui | Oui | R | W | W | Non | Oui | — | OUI — TESTÉ |
| Signature | absent | — | — | — | — | — | — | — | — | MANQUANT |
| Devis | `seba_state.devis[]` | Oui | Oui | RW | — | R | Non | Oui | — | OUI — TESTÉ |
| Acceptation devis | `devis.status/acceptedAt` | Oui | Oui | R | — | W (bouton) | Non | Oui | — | OUI — TESTÉ (idempotence confirmée) |
| Facture | `seba_state.factures[]` | Oui | Oui | RW | — | R | Non | Oui | — | OUI — TESTÉ |
| Paiement | `facture.paiements[]` | Oui | Oui | RW | — | R (solde) | Non | Oui | — | OUI — TESTÉ (partiel+final) |
| Remboursement | absent | — | — | — | — | — | — | — | — | MANQUANT |
| Reçu | dérivé du paiement | Oui (dérivé) | Oui | R | — | R | Non | Oui | — | OUI — TESTÉ |
| Documents (devis/facture/reçu) | HTML imprimable + snapshot JSONB | Snapshot oui, PDF non | Oui | R | — | R (même moteur) | Non | Oui | — | OUI — TESTÉ |
| Disponibilités | `weeklyAvailability` | Oui | Oui | R | RW | — | Non | Oui | — | OUI — TESTÉ |
| Absences | `unavailabilityRequests` | Oui | Oui | R (valide) | RW | — | Non | Oui | — | OUI — TESTÉ |
| Temps planifié/réel | `execution.timing` | Oui | Oui | R | RW | — | Non | Oui | — | OUI — TESTÉ |
| Historique (statusHistory) | intégré à chaque intervention | Oui | Oui | R | R | R (allowlist) | Non | Oui | — | OUI — TESTÉ |
| Journal d'audit | `seba_state.journal[]` | Oui | **Non tamper-resistant** | RW | — | — | Non | Oui | — | PARTIEL/RISQUE (§18) |
| Hors ligne | `localStorage` + sync queue | Oui (file), Non (photos) | N/A | Oui (dashboard.html) | **Non raccordé** (§15) | **Non raccordé** (§15) | N/A | N/A | Partiel | HORS LIGNE PARTIEL |
| Conflits (offline) | aucun mécanisme | — | — | — | — | — | — | — | Aucune détection | MANQUANT |

---

## 20. Classement des problèmes

### P0 — Bloquant ou critique

1. **Livraison d'email cassée en production (patron/client/salarié)** — bloque l'inscription patron ET toute activation client/salarié réelle. **Preuve** : `MANUEL-SEBA-ADMIN.md:16` (case non cochée), `MASTER_BACKLOG.md` QA360-P0-B (cause confirmée 2026-07-30, test direct API Resend, domaine `onboarding@resend.dev` non vérifié). **Impact** : aucun pilote réel ne peut démarrer tant que non résolu. **Fichier/fonction** : configuration Resend/Supabase Auth SMTP (hors code, action fondateur). **Dépendances** : achat de domaine + vérification DNS (déjà identifié comme CED-004 dans le backlog). **Estimation** : petite (action de configuration), mais **hors du contrôle du code**.
2. **`verify_jwt` non confirmé pour `client-provision`/`employe-provision`** — si désactivé par erreur, un JWT non signé avec un `sub` arbitraire suffirait à usurper l'identité d'un patron et inviter des comptes sur son compte. **Preuve** : `verifyUser()` (`supabase-functions/client-provision.ts:42-52` et `employe-provision.ts:42-52`) décode le JWT sans vérifier sa signature dans le code lui-même. **Scénario de reproduction** : nécessite un accès au tableau de bord Supabase de production pour vérifier le paramètre de déploiement — non exécutable dans cet audit. **Correction recommandée** : confirmer `verify_jwt=true` sur ces deux fonctions (`npx supabase functions list --project-ref ptmudezhxnhhyctowlqp`), sinon l'activer immédiatement. **Estimation** : petite (vérification de configuration).

### P1 — Important avant pilote réel

3. **Aucune notification réelle pour la quasi-totalité des événements métier** (§14) — client/salarié n'apprennent un changement qu'en revenant activement sur l'application. **Preuve** : table exhaustive §14, zéro site d'appel trouvé pour 14 des 16 événements testés. **Impact** : un pilote réel avec un vrai client/salarié suppose qu'ils consultent l'app en continu, non réaliste. **Fichiers concernés** : tous les points d'écriture métier dans `docs/seba-data.js`. **Estimation** : moyenne à grande selon la couverture souhaitée.
4. **Anomalie du cycle réouverture → correction → re-validation** (§8) : `completionStatus` et `invoiceId` ne survivent pas à un rechargement complet après ce cycle spécifique dans l'environnement de test. **Preuve** : `qa-intervention-360.js`, 4 assertions échouées, reproduit ce jour. **Root cause probable identifiée mais non confirmée** : `ownerApproveIntervention()` écrit en file locale (`pushOp`), pas via RPC serveur directe, contrairement aux actions salarié/client du même cycle — combiné à une navigation de page avant le flush dans l'environnement de test local (sans `sync-push` actif). **Action recommandée** : retester ce cycle précis contre un environnement avec `sync-push` réellement actif (local avec Edge Function déployée, ou distant) avant de conclure à un bug produit réel ou à un artefact de test.
5. **Aucun mécanisme de correction/annulation de paiement** — déjà documenté (`SEBA_PILOT_READINESS_AUDIT.md`), reconfirmé absent par lecture de code de cet audit. P1 PILOT GATE déjà noté dans le backlog.
6. **Journal d'audit non tamper-resistant** (§18) — le seul journal visible/utilisable (`seba_state.journal[]`) est modifiable par le même mécanisme que les données métier elles-mêmes.
7. **Détection de doublon client absente** — déjà documenté (`SEBA_PILOT_READINESS_AUDIT.md`), non re-testé en direct mais confirmé par lecture de code (`clients.html` ne vérifie aucune unicité avant création).
8. **Service worker non raccordé aux pages salarié/client** (§15) — le moteur hors ligne du dépôt ne s'installe jamais pour le parcours réel d'un salarié/client invité.
9. **Photos non mises en file hors ligne** — perte silencieuse possible en cas de coupure réseau pendant la prise de photo terrain.
10. **RGPD-001 non résolu** — pas de fermeture/effacement self-service pour client/salarié, déjà `À DÉCIDER` dans le backlog (9 points d'arbitrage fondateur en attente).

### P2 — Amélioration

11. Aucun WebSocket/Realtime — tout est "après actualisation", jamais un push serveur→client (fonctionnellement acceptable pour un pilote restreint, mais à documenter comme limite connue).
12. Fiche client : pas de multi-adresses, pas de champs dédiés accès/codes/allergies/matériel (stockable seulement de façon non structurée).
13. Fiche salarié : pas de photo réelle, téléphone, contact d'urgence, permissions granulaires par client, révocation de session active.
14. Pas de préchargement explicite des données de mission avant coupure réseau.
15. Pas de détection de conflit hors ligne — dernier écrivain gagnant silencieux.
16. Pas de signature capturée (canvas/image) — acceptation par bouton horodaté uniquement, déjà classé `MANQUANT` sciemment non développé par cet audit.

---

## 21-22. Verdict final obligatoire

Réponses directes, une ligne chacune, avec renvoi à la section source :

1. **Le lien client fonctionne-t-il réellement de bout en bout ?** OUI, AVEC LIMITES — le mécanisme (invitation → activation → liaison → RLS) est réel et testé localement de bout en bout (§3, §5, §11), mais l'envoi d'email réel en production est actuellement cassé (§3, non re-testé ce jour, documenté ailleurs).
2. **Le lien salarié fonctionne-t-il réellement de bout en bout ?** OUI, AVEC LIMITES — identique au point 1 (§4).
3. **Le compte Auth est-il lié à la bonne fiche métier ?** OUI — `client_accounts`/`employe_accounts`, résolution serveur, testé (§2, §5).
4. **Le compte Auth est-il lié à la bonne entreprise ?** OUI — `account` vérifié à chaque RPC, testé exhaustivement (§11).
5. **Le planning est-il partagé entre les trois portails ?** OUI — testé de bout en bout (§6, §8).
6. **Le partage est-il réellement en temps réel ?** NON — toujours "après actualisation", aucun WebSocket/Realtime détecté (§6, §8, §19).
7. **Les messages sont-ils persistés ?** OUI — table serveur réelle, testée en direct ce jour (§7).
8. **Les messages sont-ils interconnectés ?** OUI — fil partagé patron/client/salarié selon appartenance, testé (§7).
9. **Existe-t-il des messages internes invisibles du client ?** PARTIEL — pas de canal "message interne" dédié dans le chat, mais l'exécution d'intervention (checklist/matériaux/incidents) est elle bien invisible du client par un mécanisme différent (§7, §9).
10. **Les interventions sont-elles synchronisées ?** OUI, AVEC UNE ANOMALIE — cycle normal testé et confirmé (§8), une anomalie reproduite sur le cycle réouverture→facture→reload, cause probable identifiée mais non confirmée à 100% (§8, §20).
11. **Le changement de salarié retire-t-il réellement l'accès à l'ancien salarié ?** OUI — testé explicitement, immédiat (§6, §8).
12. **Les codes d'accès sont-ils protégés ?** NON APPLICABLE — champ dédié inexistant (§16).
13. **Les photos sont-elles réellement stockées ?** OUI — Storage réel, buckets privés, policies testées (§9, §12).
14. **Les documents sont-ils réellement sécurisés ?** OUI pour l'isolation cross-tenant (testée, §12) ; PAS de PDF serveur (HTML imprimable uniquement, §12).
15. **Les devis sont-ils visibles côté client ?** OUI — testé (§13).
16. **Les devis peuvent-ils être acceptés réellement ?** OUI — RPC serveur, idempotente, testée (§13).
17. **Les factures sont-elles reliées au bon client ?** OUI — testé, isolation cross-account confirmée (§13).
18. **Les paiements sont-ils réels, manuels, simulés ou absents ?** RÉELS, MANUELS — enregistrement patron persistant serveur, aucune intégration Stripe active observée dans le chemin testé (§13).
19. **Les remboursements et corrections sont-ils possibles ?** NON — absents (§13, §20 P1).
20. **Les clients sont-ils isolés entre eux ?** OUI — testé exhaustivement, zéro fuite (§11).
21. **Les entreprises sont-elles isolées entre elles ?** OUI — testé exhaustivement, zéro fuite (§11).
22. **Les salariés voient-ils uniquement leurs données autorisées ?** OUI — testé, y compris l'exclusion des données financières (§4, §11).
23. **Le portail terrain fonctionne-t-il sans réseau ?** PARTIEL — file d'écriture oui, service worker non raccordé au parcours réel, photos non mises en file (§15).
24. **Les conflits hors ligne sont-ils gérés ?** NON — aucune détection côté client, dernier écrivain gagnant silencieux côté serveur (§15).
25. **Existe-t-il un journal d'audit fiable ?** NON, PAS AU SENS STRICT — journal applicatif non tamper-resistant ; seule `entity_versions` est réellement immuable mais invisible et non conçue pour l'usage humain (§18).
26. **Quelles fonctionnalités sont encore fictives ?** Aucune "fiction" au sens simulation trouvée dans le périmètre testé — le principal problème n'est pas du mock, c'est de l'**absent** (notifications, signature, corrections de paiement, multi-adresses) ou du **cassé en infrastructure externe** (email).
27. **Quelles fonctionnalités indispensables manquent ?** Notifications réelles (§14), correction de paiement (§13), signature réelle si requise juridiquement (§10), détection de doublon client, journal d'audit tamper-resistant (§18), raccordement du service worker aux portails salarié/client (§15).
28. **Seba peut-il être testé avec un vrai professionnel ?** OUI — cœur métier patron confirmé réel et testé (§13, §19), déjà validé par un audit antérieur sur un compte patron réel (`SEBA_PILOT_READINESS_AUDIT.md`).
29. **Seba peut-il être testé avec un vrai client ?** OUI, AVEC LIMITES — mécanisme réel et testé localement (§3, §11), mais bloqué en production tant que l'email n'est pas réparé (limite d'infrastructure externe, pas de conception).
30. **Seba peut-il être testé avec un vrai salarié ?** OUI, AVEC LIMITES — identique au point 29 (§4, §11), avec en plus l'absence de notifications réelles et le hors-ligne non raccordé comme limites opérationnelles à connaître avant le terrain.

### Conclusion finale

> **Seba peut-il aujourd'hui être testé avec un vrai professionnel, un vrai client et un vrai salarié sans risque critique ?**

**OUI, AVEC LIMITES CLAIREMENT LISTÉES.**

**Justification** : le cœur d'interconnexion (identité, RLS, planning, messages, intervention 360, tunnel financier) est **réellement construit et testé aujourd'hui**, pas seulement documenté — confirmé par 6 suites de tests RLS indépendantes exécutées en direct pour cet audit, plus un test de messages écrit spécifiquement pour cette passe, zéro fuite de sécurité observée sur l'ensemble. Ce n'est **pas un NO-GO sécuritaire**.

Ce qui empêche un "OUI" sans réserve : (1) l'email de production reste cassé à la date de cet audit d'après la dernière documentation disponible, ce qui bloque matériellement l'activation d'un vrai client/salarié tant que non corrigé — un blocage d'infrastructure externe, pas un défaut de conception ; (2) le point `verify_jwt` non confirmé sur les deux fonctions d'invitation mérite une vérification immédiate avant tout pilote, par prudence (P0-2 ci-dessus) ; (3) l'absence quasi totale de notifications réelles signifie qu'un client/salarié pilote devra être informé explicitement de la nécessité de revenir consulter l'application, sans quoi l'expérience réelle paraîtra "morte" malgré des données bien synchronisées en arrière-plan ; (4) l'anomalie du cycle réouverture d'intervention (§8/§20 P1-4) doit être clarifiée avant de la considérer sans risque en usage réel prolongé.

---

## 23. Proposition de lots futurs (aucune implémentation faite)

### Lot 1 — Sécurité et comptes
- Confirmer `verify_jwt` sur `client-provision`/`employe-provision`.
- Corriger la livraison d'email de production (domaine Resend vérifié, déjà tracé CED-004 dans le backlog).
- **Fichiers** : `supabase-functions/client-provision.ts`, `employe-provision.ts`, configuration Supabase Auth SMTP.
- **Risques** : faible (vérification), critique si `verify_jwt` s'avère désactivé.
- **Tests d'acceptation** : `npx supabase functions list` confirme `verify_jwt=true` ; un vrai email d'invitation arrive et permet l'activation.
- **Ordre** : en premier, avant tout pilote réel.

### Lot 2 — Notifications réelles
- Câbler `sebaEmail`/`sebaPush` sur au minimum : devis disponible, facture disponible, intervention assignée/changée, nouveau message.
- **Fichiers** : `docs/seba-data.js` (points d'écriture identifiés en §14), `docs/email-service.js`, `docs/push-init.js`, `supabase-functions/send-email.ts`.
- **Dépendances** : Lot 1 (email fonctionnel).
- **Risques** : moyen (risque de sur-notifier si mal dosé).
- **Tests d'acceptation** : chaque événement de la table §14 déclenche un envoi réel vérifiable (log ou boîte de test).

### Lot 3 — Cycle réouverture d'intervention
- Isoler et retester le cycle réouverture → correction → facture avec un `sync-push` réellement actif (local déployé ou distant) pour confirmer/infirmer l'anomalie §8/§20.
- **Fichiers** : `docs/seba-data.js` (`ownerApproveIntervention`), `docs/intervention-fiche.html`.
- **Risques** : faible à investiguer, potentiellement moyen si confirmé en bug réel de persistance.
- **Tests d'acceptation** : `scripts/qa-intervention-360.js` repasse 30/30 sans échec.

### Lot 4 — Documents et finances
- Mécanisme de correction/annulation de paiement.
- Détection de doublon client à la création.
- **Fichiers** : `docs/factures.html`, `docs/clients.html`, `docs/seba-data.js`.
- **Dépendances** : aucune.
- **Tests d'acceptation** : un paiement erroné peut être corrigé sans passer par le support ; créer un client avec un email déjà existant déclenche un avertissement explicite.

### Lot 5 — Terrain hors ligne
- Raccorder `sw.js` aux pages `espace-terrain.html`/`client-espace.html`/`employe-connexion.html`/`client-connexion.html`/`reset-password.html`/`bienvenue.html`.
- File d'attente pour les photos (même mécanisme que les écritures textuelles).
- Détection de conflit basique (avertissement, pas nécessairement un rejet).
- **Fichiers** : `docs/sw.js`, `docs/espace-terrain.html`, `docs/seba-data.js`.
- **Dépendances** : aucune.
- **Tests d'acceptation** : une mission consultée en ligne reste consultable après coupure réseau simulée ; une photo prise hors ligne n'est jamais perdue silencieusement.

### Lot 6 — Journal d'audit et RGPD (arbitrage fondateur requis avant tout code)
- Décider si un vrai journal tamper-resistant est nécessaire avant le pilote, ou accepté comme limite documentée.
- Trancher les 9 points RGPD-001 en attente (`MASTER_BACKLOG.md`) avant tout code de fermeture/effacement client/salarié.
- **Dépendances** : décision fondateur uniquement, aucun code avant arbitrage.

---

## Annexe — Preuves d'exécution de cet audit

Tests exécutés en direct ce jour, contre l'environnement Supabase local reconstruit à neuf (`scripts/local-db/rebuild.sh`), données 100% synthétiques, aucune donnée réelle touchée, tous nettoyés/isolés par construction (comptes dédiés à chaque script, préfixes `test-*`/`QA360-*`/`QAQTC-*`/`QAFCD-*`) :

- `scripts/local-db/verify.sh` — infrastructure, inventaire RLS, 5 tests élémentaires — TOUT PASSE
- `scripts/local-db/test-client-portal-rls.sh` — TOUT PASSE (0 échec)
- `scripts/local-db/test-employee-portal-rls.sh` — TOUT PASSE (0 échec)
- `scripts/local-db/test-field-report-rls.sh` — TOUT PASSE (0 échec)
- `scripts/local-db/test-intervention-360-rls.sh` — TOUT PASSE (0 échec)
- `scripts/local-db/test-team-availability-rls.sh` — TOUT PASSE
- `scripts/local-db/test-public-intake-rls.sh` — TOUT PASSE
- `scripts/local-db/test-sync-push-state-persistence.js` — TOUT PASSE (incluant un cycle réel via l'interface : création → reload → reconnexion)
- `scripts/qa-quote-to-cash.js` — 21/21 assertions
- `scripts/qa-flexible-commercial-documents.js` — 121/121 assertions
- `scripts/qa-intervention-360.js` — **26/30 assertions, 4 échecs** (voir §8/§20, anomalie du cycle réouverture)
- Test de messagerie ad hoc (SQL direct, écrit pour cet audit, non commité, supprimé après usage) — 7/7 assertions

Fichiers temporaires créés pendant cet audit : `scratchpad/msg_rls_probe.sql` (supprimé après usage, conforme à la consigne de ne laisser aucun fichier temporaire).

L'environnement Supabase local (Docker) reste actif après cet audit (pré-existant à cette session, disposable par construction selon `scripts/local-db/README.md`) — non arrêté, aucune action destructive requise dessus.
