# QA360-P0 — Plan de remédiation

Suite à `SEBA_PILOT_READINESS_AUDIT.md` (verdict NO-GO, 2026-07-30). Ce document diagnostique, propose des correctifs et une procédure de nettoyage — **aucun merge produit, aucun déploiement, aucun changement de configuration Supabase n'a été exécuté par cette passe**, hors deux fichiers de code déjà corrigés et listés en section 3 (correctif minimal demandé explicitement, pas encore déployé — voir section 6).

---

## 1. Cause des erreurs email — CONFIRMÉE (pas seulement une hypothèse)

**Méthode** : script isolé (`scratchpad/qa/test-send-email-resend.mjs`, non commité), identifiants saisis localement par le fondateur, jamais transmis ni journalisés. Appel direct de la fonction Edge déployée `send-email` avec un compte patron réel.

**Résultat obtenu par le fondateur** :
- `POST /functions/v1/send-email` → `200`, l'API Resend accepte la requête et crée un message avec un identifiant.
- Statut de livraison réel du message : **`failed`**.
- Événement exact renvoyé par Resend : *"Domain is not verified: The domain used to send this email needs to be verified."*

**Cause confirmée** : l'adresse expéditrice utilisée partout (`onboarding@resend.dev`, le domaine partagé par défaut de Resend) n'est pas vérifiable et fait échouer la livraison — silencieusement du point de vue de l'appelant HTTP, puisque Resend répond `200` (accepté pour traitement) avant même de tenter la livraison réelle. **`send-email` n'est donc pas résolu** : l'API répond correctement, aucun email n'est réellement livré.

**Lien de code confirmé entre les 3 pannes (P0-1/P0-2/P0-3 de l'audit précédent)** :
- `send-email.ts` appelle directement `https://api.resend.com/emails` avec sa propre `RESEND_API_KEY` — chemin indépendant.
- `client-provision.ts` et `employe-provision.ts` appellent `supabase.auth.admin.inviteUserByEmail(...)` — l'API Admin de Supabase Auth, qui route via le relais SMTP configuré dans Supabase (Authentication → Email → SMTP Settings), documenté dans `MANUEL-SEBA-ADMIN.md` §1e comme étant **le même compte/la même configuration Resend** (host `smtp.resend.com`, expéditeur `onboarding@resend.dev`).
- La panne de signup (`/auth/v1/otp`) passe par ce même relais SMTP interne.

**Donc** : les 3 échecs partagent un lien de code vérifié (même fournisseur Resend, même identité expéditrice non vérifiée), mais ceci reste **une inférence à partir du code et d'un seul test direct (send-email)** — je n'ai pas de logs Supabase Auth confirmant que le relais SMTP interne échoue pour la même raison exacte ("Domain is not verified"). C'est l'hypothèse la plus probable, pas une certitude à 100 % tant que le fondateur n'a pas vérifié le panneau SMTP Settings de Supabase Auth lui-même (je n'ai pas accès à ce dashboard).

---

## 2. Procédure de nettoyage sécurisée

**Aucune commande n'a été exécutée. Tout ce qui suit est une proposition, à valider et lancer par le fondateur lui-même** (je n'ai pas d'accès direct à la base — seulement au compte patron via REST, qui ne permet pas ce type de correction).

### 2a. Facture réelle `#F-0095` (Marc Roussel) — paiement de test de 40 €

Données confirmées par lecture directe (2026-07-30) :
- `account` : `97ef0aa0-a6d9-4424-ad70-37a19f781b85`
- `facture.id` : `id_mrs4iwygv77zr`
- `paiement.id` à retirer : `id_ms7crz6db6iyj` (40 €, mode `cb`, `createdAt: 2026-07-30T10:10:39.445Z`)
- `statusHistory.id` correspondant à retirer : `id_ms7crz6dlwkgt` (event `payment_recorded`)
- Statut actuel : `partially_paid` — statut cible après nettoyage : `attente` (état observé avant le test)

```sql
begin;

-- Étape 1 — SAUVEGARDE (copier le résultat avant de continuer)
select state -> 'factures' as factures_backup_avant_nettoyage
from seba_state
where account = '97ef0aa0-a6d9-4424-ad70-37a19f781b85';

-- Étape 2 — SELECT DE CONTRÔLE : la facture concernée, état actuel exact
select f
from seba_state s, jsonb_array_elements(s.state -> 'factures') f
where s.account = '97ef0aa0-a6d9-4424-ad70-37a19f781b85'
  and f ->> 'id' = 'id_mrs4iwygv77zr';

-- Étape 3 — Transaction de nettoyage : retire UNIQUEMENT le paiement et
-- l'entrée d'historique de test, remet le statut à 'attente'. Ne touche
-- à aucune autre facture (le CASE ne modifie que l'élément dont l'id
-- correspond exactement).
update seba_state
set state = jsonb_set(
  state,
  '{factures}',
  (
    select jsonb_agg(
      case
        when f ->> 'id' = 'id_mrs4iwygv77zr' then
          jsonb_set(
            jsonb_set(
              f,
              '{payments}',
              coalesce(
                (select jsonb_agg(p) from jsonb_array_elements(f -> 'payments') p
                 where p ->> 'id' <> 'id_ms7crz6db6iyj'),
                '[]'::jsonb
              )
            ),
            '{statusHistory}',
            coalesce(
              (select jsonb_agg(h) from jsonb_array_elements(f -> 'statusHistory') h
               where h ->> 'id' <> 'id_ms7crz6dlwkgt'),
              '[]'::jsonb
            )
          ) || jsonb_build_object('status', 'attente')
        else f
      end
    )
    from jsonb_array_elements(state -> 'factures') f
  )
)
where account = '97ef0aa0-a6d9-4424-ad70-37a19f781b85';

-- Étape 4 — VÉRIFICATION POST-NETTOYAGE : confirmer le résultat AVANT de commit
select f
from seba_state s, jsonb_array_elements(s.state -> 'factures') f
where s.account = '97ef0aa0-a6d9-4424-ad70-37a19f781b85'
  and f ->> 'id' = 'id_mrs4iwygv77zr';

-- Étape 5 — Si l'étape 4 montre exactement : payments = [], statusHistory
-- sans l'entrée payment_recorded de test, status = 'attente' :
commit;
-- Sinon :
-- rollback;
```

**Rollback** : la transaction n'est PAS validée tant que `commit;` n'est pas exécuté explicitement — si le résultat de l'étape 4 ne correspond pas exactement à l'attendu, `rollback;` annule tout sans aucune trace. La sauvegarde de l'étape 1 reste une sécurité secondaire si jamais un `commit` était fait par erreur.

**Ne touche à aucune autre facture** : le `CASE` ne modifie que l'élément dont `id = 'id_mrs4iwygv77zr'`, tous les autres éléments du tableau `factures` sont réinjectés tels quels (`else f`).

### 2b. Devis annulé `DEV-2026-0119` (Sophie Lacroix)

Créé pendant le test de révision d'un devis signé (#0122), statut `Annulé`. **Recommandation : ne rien faire.** Le produit n'a volontairement aucune suppression dure pour les devis (`SebaDB.devis.cancel()` change le statut, ne retire jamais la ligne) — c'est un choix de conception assumé (piste d'audit), pas un oubli. Créer une exception juste pour cet artefact de test introduirait une incohérence (un devis annulé qui disparaît, contrairement à tous les autres). Si le fondateur veut quand même le retirer, la même méthode que 2a s'applique (filtrer `state -> 'devis'` par `id`), à préparer séparément sur demande explicite.

### 2c. Artefacts déjà nettoyés (rappel, aucune action requise)

4 fiches clients `AUDIT-TEST*`, 1 employé `AUDIT-TEST Karim`, 1 intervention associée — supprimés pendant l'audit du 2026-07-30, absence confirmée après rechargement à l'époque. Aucune trace résiduelle attendue.

---

## 3. Correctif minimal — identité expéditrice

**Diagnostic (section 1) : `RESEND_FROM` existe déjà** comme mécanisme de configuration (`Deno.env.get('RESEND_FROM')`), dans `send-email.ts` et `daily-digest.ts` — ce n'est donc pas une variable à créer, mais un repli codé en dur à éliminer aux 2 seuls endroits où il existait, sans renommer (`RESEND_FROM` déjà documenté dans `CLES-A-CONFIGURER.md`/`_architecture/PHASE_1A_CHECKPOINT.md` ; introduire `EMAIL_FROM` en plus aurait dupliqué le concept sous deux noms).

**Pourquoi pas un simple déplacement dans un fichier partagé** : `client-provision.ts`, `employe-provision.ts` et `send-email.ts` sont déployés un par un par copier-coller manuel dans le dashboard Supabase (`MANUEL-SEBA-ADMIN.md`, "Colle le contenu de `supabase-functions/X.ts` → Deploy") — un fichier auto-contenu par fonction, pas un bundle avec imports partagés. Introduire un import partagé casserait ce mode de déploiement documenté. La duplication du **nom de variable** `RESEND_FROM` entre les 2 fichiers reste donc nécessaire par contrainte opérationnelle ; ce qui est éliminé, c'est la duplication de la **valeur codée en dur** `onboarding@resend.dev`.

**Modifications déjà appliquées** (code local, pas encore déployé sur Supabase — voir section 6 pour l'ordre) :

- `supabase-functions/send-email.ts` : `RESEND_FROM` devient **obligatoire**. Si absente, retourne `500 {"error":"RESEND_FROM non configurée côté serveur (adresse expéditrice vérifiée requise)"}` au lieu de tenter un envoi voué à l'échec avec `onboarding@resend.dev`.
- `supabase-functions/daily-digest.ts` : même principe, adapté au caractère "best-effort" de cette fonction (pas de réponse HTTP à un utilisateur — si `RESEND_FROM` est absente, l'envoi est silencieusement sauté, comme c'était déjà le cas pour `RESEND_API_KEY` manquante).
- `MANUEL-SEBA-ADMIN.md` §1e : ajoute l'étape de vérification de domaine Resend AVANT la configuration des secrets, rend `RESEND_FROM` explicitement obligatoire, ajoute l'instruction de reporter la **même adresse vérifiée** dans Supabase Auth → SMTP Settings (sinon signup/invitations restent cassés même après avoir corrigé `send-email`). Case à cocher du bug mise à jour avec la cause confirmée.
- `CLES-A-CONFIGURER.md` : note `RESEND_FROM` comme obligatoire sur domaine vérifié.

**Ce qui reste à faire (fondateur uniquement, hors de portée de cette passe)** :
1. Vérifier un vrai domaine dans Resend (resend.com → Domains → Add Domain → DNS chez le registrar).
2. Définir `RESEND_FROM` (Edge Functions → Secrets, sur `send-email` et `daily-digest` si redéployée) avec l'adresse vérifiée.
3. Reporter la **même adresse** dans Supabase Auth → Authentication → Emails → SMTP Settings (champ expéditeur).
4. Redéployer `send-email.ts` (copier-coller la version corrigée) — voir section 6 pour l'ordre exact.

---

## 4. Modèle d'écriture optimiste — portée réelle (correction d'un diagnostic précédent)

**Correction nécessaire à `SEBA_PILOT_READINESS_AUDIT.md` (P0-4)** : en relisant le code après l'audit initial, la caractérisation *"l'interface affiche un succès qui n'existe pas côté serveur"* pour la tentative de correction par montant négatif est **incorrecte ou incomplète**, pas confirmée par le code :

- `SebaDB.factures.recordPayment()` (`docs/seba-data.js:4318`) **valide et rejette déjà** tout montant ≤ 0, localement, avant tout appel serveur : `if (!amount || amount <= 0) return { ok: false, error: 'Montant de paiement invalide.' };`. Un montant de -40 est donc rejeté à ce stade, pas silencieusement accepté.
- Le texte "En attente" observé dans la liste après la tentative n'a pas de cause confirmée avec certitude — l'hypothèse la plus probable est un rafraîchissement d'affichage non lié à cette tentative précise (même famille que l'anomalie déjà notée sur le menu déroulant d'assignation employé), pas une preuve que la correction a été acceptée puis perdue.

**Ce qui EST confirmé par le code, et reste un vrai sujet** :

1. **Aucun mécanisme de correction de paiement n'existe dans l'UI.** Montants ≤ 0 rejetés, aucun bouton "annuler/retirer ce paiement" trouvé sur la fiche facture. Une erreur de saisie de paiement est donc irréversible par l'interface — un vrai manque fonctionnel, pas un bug.

2. **Le modèle d'écriture local-d'abord/synchronisation-arrière-plan est bien le modèle général de l'application**, pas spécifique aux paiements — confirmé en lisant `SebaDB.update()`/`.remove()`/`.log()` (`docs/seba-data.js:2399+`) : la mutation locale et l'affichage de succès sont **synchrones et immédiats**, `pushOp()` met l'opération en file et lance la synchronisation réseau **sans jamais être attendu (`await`) par l'appelant**. Ce modèle s'applique identiquement aux clients, devis, interventions, employés, factures, paiements, journal — c'est le chemin d'écriture unique de tout le produit, pas une exception introduite pour les paiements.

3. **Ce n'est cependant pas un échec totalement silencieux** : il existe un indicateur visible et persistant (`updateSyncIndicator()`, `docs/seba-data.js:1547`) affichant "N modification(s) en attente" / "N échec(s) définitif(s)" tant que la file de synchronisation n'est pas vide, plus un mécanisme de nouvelle tentative manuelle (`retrySyncNow()`). Un paiement dont la synchronisation échouerait définitivement apparaîtrait dans cet indicateur — mais **sans alerte immédiate ni blocage au moment de l'action elle-même**, et l'utilisateur doit remarquer l'indicateur pour s'en apercevoir.

4. **Précédent déjà existant dans le code pour exiger une confirmation réelle avant d'afficher un succès** : `pushEntreprisePatch()` (`docs/seba-data.js:1614`) a été spécifiquement corrigé (SETTINGS-BRAND-001, 2026-07-29) pour retourner une vraie Promise attendue par l'appelant, avec le commentaire explicite *"exigence explicite : aucun faux succès affiché avant confirmation de la requête"* — pour les réglages d'entreprise/marque uniquement. Si le fondateur juge que les opérations financières (paiements, et possiblement factures/devis) doivent bénéficier de la même garantie, c'est une **extension d'un patron déjà en place**, pas une nouvelle architecture à inventer.

**Recommandation, pas un correctif exécuté** : étendre le patron `pushEntreprisePatch()` (attente réelle + confirmation) aux opérations financières (`recordPayment`, `cancel` sur factures) serait cohérent avec la doctrine déjà appliquée une fois ailleurs. Décision produit à trancher par le fondateur, pas appliquée dans cette passe.

---

## 5. Flux réel `seba_state` → tables normalisées → portails

**Confirmé en lisant le code de production (`migrations/2026-07-28-sync-push-state-persistence.sql`, `docs/seba-data.js`, RPC de lecture)** — pas une hypothèse d'architecture générale, le comportement exact du code actuel :

### Où chaque écriture patron part

`SebaDB.update/create/remove()` (`docs/seba-data.js`) fait deux choses, toujours dans cet ordre :
1. Mutation **synchrone** de l'état local (`localStorage`, `LocalAdapter`).
2. `pushOp()` met un patch en file, synchronisée en arrière-plan vers `sync-push` (Edge Function déployée).

`sync-push` appelle la RPC Postgres `apply_entity_patch(p_account, p_entity, p_entity_id, p_patch_jsonb, p_op)` (signature actuelle, 5 paramètres — **la version à 4 paramètres visible dans `supabase-schema.sql` section 11 est obsolète**, remplacée par la migration `2026-07-28-sync-push-state-persistence.sql`, qui `drop function`+`create or replace` avec la nouvelle signature — divergence confirmée entre le fichier de schéma de référence et l'état réel après migrations, à corriger dans `supabase-schema.sql` pour que ce fichier reste une référence fiable).

`apply_entity_patch()` (version actuelle) écrit, **dans une seule transaction atomique, verrou de ligne sur `seba_state` du compte** :
- `seba_state.state` (JSONB, la colonne `state -> '<entité>'`, tableau modifié en place) — **c'est ici que vit réellement chaque client/devis/facture/intervention/employé**.
- `entity_versions` — uniquement un compteur de version + dernier instantané, pour l'idempotence et la détection de doublons de `sync-push`. **Jamais relu par aucune page ou RPC de lecture du produit.**

### Où chaque rôle lit

- **Patron** : `SupabaseAdapter.pull()` (`docs/seba-data.js:168`) — `GET /rest/v1/seba_state?select=state&account=eq.<compte>`, lit `seba_state.state` directement, en entier.
- **Client** (`client-espace.html`) : RPC `get_my_client_interventions()` (et équivalents pour devis/factures, non relues dans cette passe mais very probablement du même patron) — `security definer`, résout `auth.uid()` → `client_accounts` → `account`+`client_id`, puis **`select ... from seba_state s, jsonb_array_elements(s.state -> 'interventions') ... where i.value ->> 'clientId' = v_client_id`** — lit `seba_state.state` aussi, filtré côté serveur à l'intérieur du JSONB avant de renvoyer au client. Confirmé en lisant le corps SQL de la fonction (`migrations/2026-07-25-intervention-360.sql`).
- **Employé** (`espace-terrain.html`) : `get_my_employee_interventions()`, très probablement le même patron (résolution via `employe_accounts`, filtrage JSONB sur `seba_state.state`) — **pas relu ligne par ligne dans cette passe, à vérifier avant de considérer ce point comme aussi solidement établi que le côté client.**

### Et les tables normalisées (`clients`, `devis`, `factures`, `paiements`, `interventions`, `employes` — définies avec de vraies colonnes dans `supabase-schema.sql`) ?

**Constat, pas une hypothèse** : aucun chemin de lecture ni d'écriture trouvé dans cette passe ne les utilise. Toutes les écritures (`apply_entity_patch`) et toutes les lectures examinées (`pull()`, `get_my_client_interventions()`) passent exclusivement par `seba_state.state`. Ces tables normalisées semblent donc **vestigiales** — une architecture antérieure probablement abandonnée au profit du modèle JSONB par compte, jamais retirée du schéma. Risque réel : un futur développeur (humain ou agent) pourrait raisonnablement supposer que ces tables sont la source de vérité (ce sont des tables avec de vraies colonnes, RLS activée, ce qui *a l'air* canonique) et écrire du code qui les lit ou les écrit sans jamais toucher `seba_state` — créant une vraie divergence silencieuse là où aujourd'hui il n'y en a pas. **Pas de conclusion d'architecture générale au-delà de ce constat** : à confirmer avec le fondateur si ces tables doivent être supprimées, documentées comme mortes, ou si un usage réel existe ailleurs (RLS Storage, une fonction non lue dans cette passe, etc.).

### Que se passe-t-il si la propagation échoue ?

- **Échec réseau ou 4xx/5xx de `sync-push`** : l'opération reste dans la file locale (`localStorage`), retentée automatiquement (voir `updateSyncIndicator()`/`retrySyncNow()`, section 4). L'état local reste correct, l'indicateur de synchronisation le signale.
- **Échec de la RPC `apply_entity_patch` elle-même** (ex. `entity`/`op` invalide, objet introuvable pour un update) : `sync-push/index.ts` **compense explicitement** — supprime la ligne `sync_operations` déjà insérée pour que l'opération ne soit pas vue à tort comme un doublon au prochain essai (commentaire du code : sans ce nettoyage, l'opération "resterait bloquée indéfiniment, journalisée mais jamais appliquée"). Comportement correctement pensé, confirmé par lecture du code, pas juste supposé.
- **Panne du navigateur/appareil avant que la file locale soit vidée** : l'opération reste dans `localStorage` de cet appareil précis, rejouée à la prochaine visite sur le même appareil/navigateur — **jamais synchronisée si l'utilisateur change d'appareil entre-temps sans que la sync ait eu lieu.** Ce point n'a pas été testé dans cette passe (nécessiterait de couper le réseau pendant une écriture réelle, hors périmètre des 12 tests de lancement).

---

## 6. Ordre minimal des correctifs

1. **Fondateur** : vérifier un domaine réel dans Resend (Domains → Add Domain → DNS).
2. **Fondateur** : configurer `RESEND_FROM` (Edge Functions → Secrets) avec l'adresse vérifiée.
3. **Fondateur** : reporter la même adresse dans Supabase Auth → SMTP Settings (champ expéditeur).
4. **Fondateur** : redéployer `send-email.ts` (contenu déjà corrigé dans cette passe, à copier-coller) — et `daily-digest.ts` si cette fonction doit un jour être déployée (actuellement non déployée, voir `SEBA_EXECUTABLE_CAPABILITY_MATRIX.md`).
5. **Test isolé `send-email`** (réutiliser `scratchpad/qa/test-send-email-resend.mjs`) : confirmer statut `delivered` chez Resend, pas seulement `HTTP 200`.
6. **Test signup patron réel** (`onboarding.html`, une vraie adresse) : confirmer réception de l'email et activation via `bienvenue.html`.
7. **Test invitation client** (`clients.html` → ajout d'un client avec email) : confirmer `client-provision` répond `200`, pas `500`, et que l'email arrive.
8. **Test invitation employé** (`equipe.html` → ajout d'un employé avec email) : même vérification pour `employe-provision`.
9. Seulement après 5-8 validés : reprendre les tests d'accès par URL directe avec de vrais comptes employé/client (section 7 de `SEBA_PILOT_READINESS_AUDIT.md`), puis rouvrir PILOT-004.
10. **Nettoyage** (section 2 de ce document) : à faire à tout moment, indépendant du reste — mais idéalement après les tests ci-dessus pour ne pas re-polluer un compte tout juste nettoyé.
11. Décision séparée, non bloquante pour le pilote : traiter ou documenter le manque de détection de doublon client (audit précédent, section 5), le manque de mécanisme de correction de paiement (section 4 ci-dessus), et le statut des tables normalisées vestigiales (section 5 ci-dessus).

---

## 7. Tests de non-régression obligatoires

À exécuter après les correctifs de la section 6, avant de rouvrir PILOT-004 :

| # | Test | Preuve attendue |
|---|---|---|
| 1 | `send-email` direct (script isolé) | Statut Resend `delivered` (pas juste `HTTP 200`) |
| 2 | Signup patron avec une vraie adresse | Email reçu, lien d'activation fonctionnel, `bienvenue.html` accepte le mot de passe |
| 3 | Invitation client depuis un compte patron réel | `client-provision` → `200`, email reçu, le client peut se connecter sur `client-connexion.html` |
| 4 | Invitation employé | `employe-provision` → `200`, email reçu, l'employé peut se connecter sur `employe-connexion.html` |
| 5 | Accès direct par URL, session employé sur une page patron | Redirection/refus confirmé (test bloqué jusqu'ici faute de compte employé actif) |
| 6 | Accès direct par URL, session client sur une page patron | Même vérification côté client |
| 7 | Répéter les 12 tests de lancement de `SEBA_PILOT_READINESS_AUDIT.md` avec le cycle patron→employé→client complet, pas seulement patron seul | Voir section 4 du prochain audit — remplacer "non testé" par un verdict réel |
| 8 | Vérifier qu'aucune régression n'a été introduite sur `sync-push`/`client-provision`/`employe-provision` déjà fonctionnels (persistance clients/devis/factures/paiements) | Reprendre rapidement les scénarios déjà validés dans `SEBA_EXECUTABLE_CAPABILITY_MATRIX.md` |

Aucun de ces tests n'a été exécuté dans cette passe (dépendent tous de la correction email, section 6, points 1-4, qui reste à faire par le fondateur).
