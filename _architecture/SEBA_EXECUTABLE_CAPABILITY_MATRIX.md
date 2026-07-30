# Matrice des capacités exécutables — Seba

Audit de vérité, 2026-07-30. Aucune modification de code produit effectuée pendant cet audit.

## Environnement exact audité

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit HEAD | `4d8dc09d7ce89e141f01bc726e7210ceffaf050f` (2026-07-30 10:03:02+02:00) |
| URL testée | `https://sebpromax.github.io/seba/` (site public GitHub Pages, sert `docs/`) |
| Projet Supabase | `ptmudezhxnhhyctowlqp` (`docs/config.public.js`) |
| Compte patron de test | Compte réel fourni par le fondateur (email non consigné dans ce document), entreprise "Sebababa" — utilisé en lecture/écriture réelles pour les tests ci-dessous |
| Migrations locales | 20 fichiers dans `./migrations/*.sql` (2026-07-11 → 2026-07-29) — **statut d'application en base non vérifiable sans accès direct psql/dashboard** ; présence en git ≠ preuve d'application |
| CI/CD | `.github/workflows/static.yml` déploie uniquement `docs/` vers GitHub Pages (+ lint design-system). `.github/workflows/qa-and-lint.yml` ne fait que lancer `check-design-system` sur les PR. **Aucun des deux ne déploie quoi que ce soit côté Supabase** (fonctions Edge, migrations SQL) — tout déploiement Supabase est un acte manuel non tracé par la CI |
| Adapter de données | `docs/seba-data.js` : `hasSupabase ? SupabaseAdapter : LocalAdapter` — le site public utilise réellement `SupabaseAdapter` (config publique renseignée), donc les pages patron ne sont PAS en mode démo/local par défaut |

### Méthode de vérification du déploiement réel des fonctions Edge

Chaque fonction a été testée par un appel HTTP direct (`POST /functions/v1/<nom>`), avec un test de contrôle contre un nom de fonction délibérément inexistant pour valider le signal :
- **404 `{"code":"NOT_FOUND"}`** = identique au contrôle négatif → fonction non déployée.
- **401 avec message applicatif Seba** (ex: `"Authentification requise"`) → fonction déployée et vivante (a son propre code d'auth, distinct du 404 générique de la plateforme).

| Fonction | Résultat HTTP | Statut réel |
|---|---|---|
| `sync-push` | 401 `{"error":"Authentification requise"}` | **DÉPLOYÉE** |
| `client-provision` | 401 (même signature) | **DÉPLOYÉE** (mais retourne 500 en usage réel, voir plus bas) |
| `employe-provision` | 401 (même signature) | **DÉPLOYÉE** (mais retourne 500 en usage réel, voir plus bas) |
| `send-email` | 401 (même signature) | **DÉPLOYÉE** |
| `send-push` | 404 | **NON DÉPLOYÉE** |
| `ai-relay` | 404 | **NON DÉPLOYÉE** |
| `vision-qa` | 404 | **NON DÉPLOYÉE** |
| `daily-digest` | 404 | **NON DÉPLOYÉE** |
| `notify-alert` | 404 | **NON DÉPLOYÉE** |
| `assistant-technique` | 404 | **NON DÉPLOYÉE** |
| `embed-content` | 404 | **NON DÉPLOYÉE** |

Le code source des 7 fonctions non déployées existe intégralement dans `supabase/functions/`.

## Matrice des capacités

Statuts possibles : `IMPLEMENTED_WORKING` / `IMPLEMENTED_BROKEN` / `DEMO_ONLY` / `NOT_DEPLOYED` / `NOT_IMPLEMENTED` / `BLOCKED` / `UNVERIFIED`.

| Capacité | Route/fichier | Source de données | Persistance | Déployée | Testable | Statut réel | Preuve |
|---|---|---|---|---|---|---|---|
| Authentification patron (login) | `connexion.html` → Supabase Auth | Supabase Auth | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Login réel réussi, redirection vers `app/dashboard.html`, session persistée |
| Inscription patron (signup) | `onboarding.html` → `/auth/v1/otp` | Supabase Auth (email OTP) | N/A (bloque avant) | Oui | Oui | **IMPLEMENTED_BROKEN — P0** | `500 {"code":"unexpected_failure","message":"Error sending confirmation email"}` puis `"Error sending magic link email"`, reproduit avec une adresse jetable ET une vraie adresse Gmail — panne totale, pas un blocage anti-spam. **Cause probable confirmée pour le chemin `send-email` (même fournisseur Resend, non revérifiée pour ce chemin précis)** : domaine expéditeur `onboarding@resend.dev` non vérifié chez Resend — voir `QA360_P0_REMEDIATION_PLAN.md` section 1 |
| Entreprise / configuration compte | Onboarding écran 1 + `reglages.html` | `seba_state` (Supabase) | Oui | Oui | Partiel | **UNVERIFIED (réglages non testés directement)** | Compte de test déjà configuré, pas re-testé depuis zéro (bloqué par l'échec de signup) |
| Clients — création | `clients.html` | `seba_state` via `sync-push` (fonction Edge) | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Client créé, persiste après reload, confirmé par requête directe `GET /rest/v1/seba_state` |
| Clients — détection de doublon | `clients.html` | — | — | — | Oui | **NOT_IMPLEMENTED** | Même client (prénom/nom/email/tél identiques) créé deux fois de suite = deux fiches distinctes, aucun avertissement |
| Clients — suppression | `clients.html` | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | 4 fiches de test créées puis supprimées, confirmé absentes après reload |
| Portail client — provisioning/invitation | `client-provision` (fonction Edge, déclenchée depuis `clients.html`) | Supabase Auth (invite email) | — | Oui (mais échoue) | Oui | **IMPLEMENTED_BROKEN — P0** | `500 {"error":"Erreur serveur"}` systématique à chaque création de client. Code confirmé : appelle `auth.admin.inviteUserByEmail()`, qui route via le même relais SMTP Supabase que le signup (documenté `onboarding@resend.dev`, domaine non vérifié) — lien de code établi, logs Supabase Auth eux-mêmes non consultés (voir `QA360_P0_REMEDIATION_PLAN.md` section 1) |
| Intervention directe sans devis | `planning.html` | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Intervention créée pour Camille Faure sans devis préalable, persiste après reload et navigation semaine suivante |
| Assignation employé sur intervention | `planning.html` (`.jemp-select` / `reassignFromCard`) | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING (avec réserve UI)** | Assignation confirmée correcte côté serveur (requête directe `seba_state.employes`) ; mais le menu déroulant d'assignation n'a pas affiché de façon fiable un employé nouvellement créé selon le moment du chargement — piste : cache `EMPLOYEES_CACHE` non synchronisé de façon déterministe |
| Équipe — ajout employé | `equipe.html` | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Employé de test créé, persiste, retiré ensuite via `supprimerEmploye()` (confirmé absent après) |
| Portail employé — provisioning/invitation | `employe-provision` (fonction Edge) | Supabase Auth (invite email) | — | Oui (mais échoue) | Oui | **IMPLEMENTED_BROKEN — P0** | `500 {"error":"Erreur serveur"}` systématique, même symptôme que `client-provision` |
| Fiche employé — vue mission individuelle | `employe-fiche.html` | ? | ? | Oui | Oui | **IMPLEMENTED_BROKEN (mineur)** | Message affiché par l'app elle-même : "l'assignation par employé n'est pas encore reliée au planning" — gap explicitement admis dans l'UI |
| Devis — création | `devis.html` | `sync-push` | Oui | Oui | Non testé directement (dérivé de la lecture de liste existante) | **UNVERIFIED (création neuve non testée)** | Devis existants observés (numérotation `#01xx`), workflow de statut (Brouillon/En attente/Signé/Refusé/Expiré) observé mais pas de création de zéro exécutée |
| Devis — protection de la version signée | `devis.html` → "Créer une révision" | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Révision créée depuis un devis signé (#0122) → nouveau brouillon `DEV-2026-0119` créé séparément, message applicatif "le devis d'origine reste intact", original inchangé (toujours "Signé") confirmé après |
| Devis — annulation | `devis.html` | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING (pas de suppression dure)** | "Annuler" change le statut en "Annulé", ne supprime pas la ligne — cohérent avec une piste d'audit, mais **aucune suppression dure n'existe pour les devis** (à documenter comme choix, pas bug) |
| Facture — paiement complet | `factures.html` | `sync-push` | Oui | Oui | Non testé (déjà présent dans les données existantes : #F-0098, #F-0097, #F-0094 "Payée") | **UNVERIFIED (workflow observé, pas exécuté par l'audit)** | — |
| Facture — paiement partiel | `factures.html` → "Enregistrer un paiement" | `sync-push` | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | 40€ enregistrés sur une facture de 90€ → statut `partially_paid`, solde 50€, confirmé par requête directe (`payments[]` + `statusHistory[]` avec acteur et date) |
| Facture — paiements comme opérations historisées (pas un booléen) | `seba_state.factures[].payments[]` | Supabase | Oui | Oui | Oui | **IMPLEMENTED_WORKING** | Structure confirmée : tableau `payments` avec `id/date/mode/amount/reference/note/createdAt`, plus `statusHistory` avec `actorRole`/`createdAt` |
| Facture — correction d'un paiement erroné | `factures.html` → "Enregistrer un paiement" | — | — | Oui | Oui | **NOT_IMPLEMENTED (corrigé)** | ⚠️ Diagnostic corrigé après relecture du code — voir `QA360_P0_REMEDIATION_PLAN.md` section 4. `recordPayment()` (`docs/seba-data.js:4318`) rejette déjà les montants ≤ 0 localement ; l'affichage "En attente" observé n'a pas de cause confirmée liée à cette tentative. Ce qui reste confirmé : aucun mécanisme UI de correction/annulation de paiement n'existe (montants négatifs rejetés, pas de bouton de suppression) — absence de fonctionnalité, pas un bug de faux succès. Facture réelle #F-0095 (Marc Roussel) porte toujours un paiement de test de 40€ — **nettoyage manuel nécessaire côté fondateur**, procédure complète dans `QA360_P0_REMEDIATION_PLAN.md` section 2a (id paiement : `id_ms7crz6db6iyj`) |
| Accès direct par URL sans session (patron) | `clients.html`, `factures.html`, `devis.html`, `app/dashboard.html`, `equipe.html` | `guard.js` (déduit) | — | Oui | Oui | **IMPLEMENTED_WORKING** | Les 5 URLs redirigent systématiquement vers `connexion.html` sans session active |
| Accès direct par URL avec une session d'un autre rôle (employé/client sur pages patron) | — | — | — | — | Non | **BLOCKED** | Aucun compte employé/client actif disponible pour ce test — nécessite une invitation fonctionnelle (bloquée par le P0 email) ou des identifiants fournis séparément |
| Espace terrain (portail employé) | `espace-terrain.html` | Supabase (RLS propre, session indépendante) | Oui (déduit du code) | Oui | Non | **BLOCKED** | Même blocage que ci-dessus |
| Portail client (`client-espace.html`) | `client-espace.html` | Supabase (RLS propre, session indépendante) | Oui (déduit du code) | Oui | Non | **BLOCKED** | Même blocage |
| Assistant IA (dashboard) | Widget flottant, `ai-relay` | Fonction Edge `ai-relay` | — | **Non** | Oui | **NOT_DEPLOYED** | Erreur CORS/404 observée enconditions réelles pendant le test de login ; confirmé non déployé par le test d'endpoint direct |
| Notifications push | `send-push` | Fonction Edge `send-push` | — | **Non** | — | **NOT_DEPLOYED** | 404 au test d'endpoint direct |
| Rapport quotidien / alertes automatiques | `daily-digest`, `notify-alert` | Fonctions Edge | — | **Non** | — | **NOT_DEPLOYED** | 404 au test d'endpoint direct |
| QA visuelle automatisée serveur | `vision-qa` | Fonction Edge | — | **Non** | — | **NOT_DEPLOYED** | 404 au test d'endpoint direct |
| Recherche sémantique / mémoire IA (`embed-content`) | Fonction Edge | — | **Non** | — | **NOT_DEPLOYED** | 404 au test d'endpoint direct |
| Fonctionnement hors connexion | — | — | — | — | Non testé | **UNVERIFIED** | Hors périmètre de cette passe (nécessite coupure réseau contrôlée pendant un flux réel) |
| Récurrence (contrats / interventions périodiques) | Migrations `2026-07-26-team-availability-suggestions.sql`, `2026-07-27-flexible-commercial-documents.sql` référencées en mémoire projet | `seba_state` / tables normalisées | Non vérifié | Non vérifié | Non | **UNVERIFIED** | Code et migrations existent (branches `feature/quote-to-cash`, `feat/devis-multi-format` mergées dans `main`), pas testé en conditions réelles pendant cette passe |

## Point d'architecture — résolu (voir `QA360_P0_REMEDIATION_PLAN.md` section 5 pour le détail complet)

Confirmé par lecture du code de production (`migrations/2026-07-28-sync-push-state-persistence.sql`, RPC de lecture des portails) : `seba_state.state` (JSONB unique par compte) est la **seule et unique** source de vérité réellement lue et écrite — par le patron (`pull()` direct) **et** par les portails client/employé (RPC `security definer` type `get_my_client_interventions()`, qui filtrent `seba_state.state` en JSONB, pas une table à part). `entity_versions` est un mécanisme de version/idempotence pur, jamais relu par l'application. Les tables normalisées classiques (`clients`, `interventions`, `devis`, `factures`, `paiements`, `employes`) définies dans `supabase-schema.sql` semblent **vestigiales** : aucun chemin de lecture ni d'écriture trouvé ne les utilise — probable architecture antérieure abandonnée, jamais retirée du schéma. Risque réel identifié : un futur développeur pourrait raisonnablement les prendre pour la source de vérité (vraies colonnes, RLS activée) et y écrire du code qui diverge silencieusement de `seba_state`.

Note technique additionnelle : la RPC `apply_entity_patch` telle que définie dans `supabase-schema.sql` (section 11, 4 paramètres) est **obsolète** — remplacée par la version à 5 paramètres de `migrations/2026-07-28-sync-push-state-persistence.sql` (`drop function` + `create or replace`). Le fichier de schéma de référence n'a pas été mis à jour pour refléter cette migration, ce qui le rend trompeur pour quiconque le lit comme documentation à jour plutôt que comme un historique de `create table if not exists`.

## Artefacts de test laissés dans le compte réel (à traiter par le fondateur)

- Devis annulé `DEV-2026-0119` (Sophie Lacroix, 95€, statut "Annulé") — créé pendant le test de révision, pas supprimable via l'UI (pas de suppression dure sur les devis).
- Paiement de 40€ sur la facture réelle **#F-0095** (Marc Roussel, id paiement `id_ms7crz6db6iyj`) — aucun mécanisme UI ne permet de le retirer (voir ligne "Facture — correction d'un paiement erroné" ci-dessus). Procédure de nettoyage SQL complète (sauvegarde, contrôle, transaction, vérification, rollback) préparée dans `QA360_P0_REMEDIATION_PLAN.md` section 2a — à exécuter par le fondateur, pas par moi (pas d'accès direct à la base).

Tous les autres artefacts de test (4 fiches clients `AUDIT-TEST*`, 1 employé `AUDIT-TEST Karim`, 1 intervention associée) ont été créés puis supprimés et leur absence a été confirmée après rechargement.
