# QA — Accès initial Client/Salarié par code provisoire

Branche testée : `feat/client-employee-initial-access-code`
Base : `main` @ `c6a776f` (post-PR #137)
Date : 2026-08-02/03
Environnement : Supabase local (`scripts/local-db/rebuild.sh`), Edge Functions réelles servies localement (copies temporaires de `supabase-functions/create-access-code.ts`/`activate-access-code.ts` dans `supabase/functions/`, jamais commitées — même convention que `scripts/qa-account-activation.js` pour `client-provision.ts`/`employe-provision.ts`)

## Périmètre

Complément à l'invitation par lien magique existante (`client-provision.ts`/`employe-provision.ts`, inchangés) : le patron génère un code court (8 caractères) depuis `client-fiche.html`/`employe-fiche.html`, envoyé par email OU révélé une seule fois à l'écran ; le client/salarié le saisit sur `client-connexion.html`/`employe-connexion.html` (« Première connexion ») avant de créer son mot de passe obligatoire. Suspension de compte explicitement hors périmètre (voir plan v4, PR de sécurité séparée à venir).

## Comptes utilisés

Uniquement synthétiques, jamais de données réelles :
- `rlsac-patron-a@test.seba.invalid` / `rlsac-patron-b@test.seba.invalid` + `rlsac-finalize-test@test.seba.invalid` / `rlsac-resume-test@test.seba.invalid` (suite RLS/RPC).
- `qaac-patron-a@test.seba.invalid` / `qaac-patron-b@test.seba.invalid` + emails `qaac-{client|employe}-{scénario}-{timestamp}@test.seba.invalid` (suite Puppeteer réelle).
- Mot de passe synthétique commun : `Test-Synthetic-2026!` (patrons) / `Code-Provisoire-QA-2026!` (comptes activés).

## Pages testées

`client-fiche.html`, `employe-fiche.html` (panneau « Accès au portail »), `client-connexion.html`, `employe-connexion.html` (mode « Première connexion » + création de mot de passe), `client-espace.html`, `espace-terrain.html` (atterrissage post-activation), `connexion.html` (patron).

## Suite 1 — RLS/RPC (`scripts/local-db/test-access-code-rls.sh`)

13/13 assertions, **TOUT PASSE**. Couvre : refus anonyme/authenticated sur les 3 RPC `service_role`-only ; refus d'une fiche cross-compte ; hachage bcrypt réel (jamais le code en clair en base) ; unicité globale `(email, role)` ; renvoi invalidant l'ancien code ; mauvais code incrémentant les tentatives, bon code passant en `verifying` ; isolation cross-rôle ; verrouillage progressif puis révocation définitive après 10 échecs ; cycle complet `verify → finalize (password_pending) → mark_access_code_activated (activated)` ; reprise réseau idempotente (`password_pending` toujours acceptée, `auth_user_id` réutilisé) ; révocation patron réellement bloquante ; `get_my_access_codes_status` sans fuite de `code_hash`, isolation cross-compte.

Deux bugs réels trouvés et corrigés pendant l'écriture de cette suite (pas des faux positifs de test) :
1. **Verrouillage qui empêchait la révocation définitive** — `verify_access_code_attempt` refusait toute tentative pendant un verrouillage actif *sans jamais incrémenter le compteur*, ce qui bloquait indéfiniment le total sous le seuil de 10 échecs. Corrigé : une tentative pendant un verrouillage compte désormais comme un échec (le code n'est même pas vérifié, mais l'échec est comptabilisé).
2. **`SET LOCAL ROLE` persistant au-delà du bloc `DO`** — un bug dans le test lui-même (pas l'application) : une lecture brute effectuée après un changement de rôle vers `authenticated` restait bloquée par RLS dans le bloc `DO` suivant, faisant croire à tort à un échec de `mark_access_code_activated()` (dont le comportement réel était déjà correct, vérifié indépendamment).

## Suite 2 — Puppeteer réelle (`scripts/qa-access-code-activation.js`)

39/39 assertions, **TOUT PASSE**, Client ET Salarié (suite unique paramétrée par `role`, jamais deux copies dupliquées). Zéro erreur console sur l'ensemble des parcours réels.

Pour chaque rôle, clics réels (jamais un raccourci JS direct sauf mention contraire) :
1. **Parcours complet** : mauvais code refusé (erreur affichée, aucune avance d'écran) → bon code accepté → mots de passe différents refusés → mot de passe créé → redirection réelle vers le portail → statut `activated` en base → liaison métier créée une fois → **reconnexion normale ensuite** avec le nouveau mot de passe.
2. **Double-clic** (première connexion ET création du mot de passe, simulé par deux appels quasi simultanés de la fonction réellement bindée au bouton) : une seule liaison métier, un seul compte Auth créé.
3. **Coupure réseau / reprise** : abandon après le code (contexte navigateur fermé avant la création du mot de passe) → le code reste `password_pending` → reprise sur une page fraîche avec le même email+code → réussit à nouveau (idempotent) → activation terminée → toujours une seule liaison, un seul compte Auth.
4. **Renvoi** : nouveau code différent de l'ancien ; ancien code réellement inutilisable après renvoi ; nouveau code fonctionnel.
5. **Révocation patron** : code révoqué réellement inutilisable ensuite.
6. **Isolation cross-rôle** (via la vraie Edge Function `activate-access-code`, pas seulement la RPC) : un code Client refusé avec `role=employe` et inversement, sans faire avancer le vrai code.
7. **Fiche d'un autre patron refusée** par la vraie Edge Function `create-access-code` (résolution `account` depuis `auth.uid()`, jamais depuis le corps envoyé par le navigateur).
8. **Compte Auth déjà existant avant l'invitation** : refus explicite HTTP 409, message générique, invitation automatiquement révoquée, aucun second compte Auth créé, aucun rattachement/changement de mot de passe silencieux.
9. **Email `delivery_failed` jamais affiché comme un succès** : `RESEND_API_KEY` volontairement absente en local → `delivery_status` réel `delivery_failed` → ligne de statut patron affiche explicitement « ÉCHEC D'ENVOI », jamais le libellé de succès.
10. **Zéro erreur console** sur le parcours complet.

## Non-régression

Aucune RPC/policy existante modifiée par cette migration (uniquement 2 contraintes `unique` ajoutées sur `client_accounts`/`employe_accounts`, déjà de facto respectées par le code existant). Confirmé sans régression :
- `test-client-portal-rls.sh`, `test-employee-portal-rls.sh`, `test-field-report-rls.sh`, `test-intervention-360-rls.sh`, `test-team-availability-rls.sh`, `test-notifications-rls.sh` : TOUT PASSE.
- `scripts/qa-quote-to-cash.js` (21/21), `scripts/qa-portal-notifications.js` (9/9) : TOUT PASSE.
- `node tools/check-design-system.js` : 0 couleur en dur détectée.

## Hors périmètre (assumé, documenté)

- Suspension de compte (voir plan v4, PR de sécurité séparée).
- Verrouillage progressif complet en temps réel (délais de 1/5/15 min) : prouvé par simulation instantanée côté SQL (la boucle de 10 échecs de la suite RLS s'exécute dans la même transaction) plutôt qu'en attendant les délais réels — le mécanisme est correct (voir bug #1 ci-dessus), les délais eux-mêmes ne sont pas re-mesurés en temps réel ici.
- Délivrabilité réelle d'un email Resend (domaine non vérifié en production, voir `MANUEL-SEBA-ADMIN.md`/QA360-P0-B) : hors de portée de cet environnement local, `delivery_failed` est le comportement attendu et vérifié tant que ce n'est pas résolu.

## Verdict

```
CLIENT   — CODE INITIAL : PRÊT
SALARIÉ  — CODE INITIAL : PRÊT
ISOLATION CLIENT/SALARIÉ : VALIDÉE
```
