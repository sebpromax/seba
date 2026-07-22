# SEBA — Checkpoint Phase 1A : préparation, reproduction et premier gate

Statut : checkpoint de diagnostic. Aucun comportement produit n'a été modifié pour produire ce document. Toutes les preuves ci-dessous proviennent d'une lecture directe du code actuel et, quand indiqué explicitement, d'une exécution réelle mais non destructive (voir §3).

---

## 1. Inventaire T0 — environnements et secrets

### Fichiers de configuration existants
| Fichier | Statut git | Contenu | Rôle |
|---|---|---|---|
| `docs/config.public.js` | **Committé** | `supabaseUrl`, `supabaseAnonKey` (clé publishable), `accountId: 'demo'`, `onesignalAppId`, `sentryDsn`, `umamiWebsiteId/ScriptUrl` (vides) | Config publique par design — protégée par RLS, pas par le secret |
| `docs/config.js` | **Gitignoré, présent localement** (confirmé : fichier existe sur cette machine, 1478 octets) | Mêmes clés que `config.example.js` : `supabaseUrl`, `supabaseAnonKey`, `accountId`, `groqApiKey`, `stripePublicKey`, `stripePaymentLink` (valeurs non lues/affichées ici, uniquement les noms de clés) | Config locale réelle du fondateur |
| `docs/config.example.js` | Committé | Gabarit avec placeholders | Modèle pour recréer `config.js` |
| `.env` | **Gitignoré, présent localement** (322 octets) | Clés présentes (noms seulement, vérifiés) : `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` | Utilisé par `tools/orchestrator.js`, `tools/chaos-monkey.js` |
| `.env.example` | Committé | Gabarit + doc des variables d'orchestration (`SEBA_ORCH_ALLOW_PR`, `SEBA_ORCH_ALLOW_PUSH_MAIN`) | Modèle |
| `agents_config.json` | Committé | Aucune clé en dur — uniquement des noms de variables d'environnement (`apiKeyEnvVar`) | Config de l'orchestrateur multi-agents |

Vérifié explicitement : ni `.env` ni `docs/config.js` ne sont suivis par git (`git ls-files` ne les liste pas) — la règle du projet est respectée.

### Secrets côté serveur (Supabase Edge Functions, Vault)
Recherche exhaustive de `Deno.env.get(...)` dans `supabase-functions/*.ts` — variables attendues côté Vault Supabase (non vérifiable depuis ce dépôt si elles sont réellement configurées en production) :
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MAX_DAILY_REQUESTS`. Aucune clé Anthropic référencée nulle part (cohérent avec la règle du projet : IA via Groq/Gemini/Mistral/OpenRouter, jamais l'API Anthropic facturée à l'usage).

### Séparation développement / test / production
**Constat central, confirmé empiriquement** : `docs/config.js` (local, réel) et `docs/config.public.js` (committé) pointent vers **exactement la même URL Supabase** (`https://ptmudezhxnhhyctowlqp.supabase.co`). Il n'existe **qu'un seul projet Supabase**, utilisé à la fois pour la démo publique, le développement local et la production réelle. Un fichier `ARCHITECTURE-V2.md` (§6) propose depuis un moment un switch `docs/config.env.js` (`window.SEBA_ENV = 'dev'|'staging'|'prod'`) — **vérifié : ce fichier n'existe pas dans le dépôt**, la proposition n'a jamais été implémentée.

- **Risque identifié** : tout test automatisé (T5, tests ciblés T2/T3) écrit maintenant contre ce projet Supabase s'exécuterait contre les **mêmes données que la production réelle**, sauf à créer explicitement des comptes de test jetables et à les nettoyer soigneusement après coup.
- **Recommandation** : créer un second projet Supabase (gratuit) dédié aux tests, avant d'écrire le moindre test RLS (T5) ou test ciblé (T2/T3) qui toucherait une vraie base — ou, à défaut, documenter une convention stricte de comptes de test isolés et nettoyés systématiquement sur le projet unique existant.
- **Gravité** : élevée pour la confiance dans T5, modérée pour les tests ciblés T2/T3 s'ils restent very limités en portée.

### Risques de fuite ou de mauvaise configuration identifiés
- Aucune fuite constatée : `.gitignore` couvre correctement `docs/config.js` et `.env` ; `git ls-files` confirme qu'aucun des deux n'est suivi.
- Risque résiduel non technique : `docs/config.js` existe en clair sur le poste de travail local — sa protection dépend entièrement de la sécurité de la machine elle-même (hors périmètre de ce dépôt, non vérifiable ici).
- Aucune rotation de secret documentée nulle part (ni fréquence, ni procédure) — signalé comme absent, aucune action prise dans ce checkpoint.

---

## 2. Analyse du déploiement actuel et CI révisée (remplace la section DEC-011 précédente)

### 2.1 — Qu'est-ce qui déclenche actuellement le déploiement ?
`.github/workflows/static.yml` : déclenché sur `push` vers `main` + `workflow_dispatch` manuel. Étapes : `actions/checkout` → `actions/configure-pages` → `actions/upload-pages-artifact` (`path: './docs'`) → `actions/deploy-pages`. **Aucun gate, aucun test, aucun lint avant ces étapes.**

### 2.2 — Le workflow CI proposé peut-il réellement bloquer ce déploiement ?
**Non, pas automatiquement, et c'est pourquoi mon appellation précédente ("pre-deploy gate") était trompeuse — corrigée ci-dessous.** Deux workflows déclenchés par le même événement `push` s'exécutent indépendamment et en parallèle sur GitHub Actions : il n'existe aucune relation de dépendance implicite entre deux fichiers de workflow distincts. Un simple `push` sur `main` lancerait les deux en même temps, sans que l'un attende l'autre. Deux vrais mécanismes existent pour créer un blocage réel :
1. **Protection de branche** (configuration GitHub, pas du YAML) : bloque la **fusion d'une pull request** tant qu'un check nommé n'a pas réussi — n'affecte pas un push déjà effectué après coup.
2. **Chaînage `workflow_run`** : modifier `static.yml` pour qu'il se déclenche sur `workflow_run` (achèvement du contrôle CI) plutôt que directement sur `push`, avec une condition `if: github.event.workflow_run.conclusion == 'success'` — crée une vraie dépendance technique, mais nécessite de toucher au fichier de déploiement lui-même, pas seulement d'ajouter un nouveau fichier.

### 2.3 — Une protection de branche est-elle nécessaire ?
**Oui, indispensable pour tout effet réellement bloquant sur les pull requests** (le principal chemin de contribution recommandé par `CLAUDE.md` : "chantier non trivial = branche dédiée... jamais de commit direct sur main"). Sans elle, le contrôle CI peut échouer en rouge sur une PR sans empêcher qui que ce soit de cliquer sur "Merge" quand même.

### 2.4 — Une modification du workflow de déploiement serait-elle nécessaire ?
Seulement si un blocage technique réel (pas seulement humain/discipline) est voulu pour les push directs sur `main` — via le chaînage `workflow_run` décrit en 2.2. **Je ne le recommande pas immédiatement** : cela ajoute une dépendance entre deux fichiers de workflow, avec un risque propre (`static.yml` pourrait silencieusement cesser de déployer si le chaînage est mal configuré, sans que personne ne le remarque immédiatement). Je recommande de s'appuyer d'abord sur la protection de branche (bloque déjà l'essentiel via la discipline PR déjà en place dans ce projet), et de ne considérer le chaînage `workflow_run` que si un contournement par push direct devient un risque observé, pas hypothétique.

### 2.5 — Quelle partie nécessite une action manuelle dans les paramètres GitHub ?
Toute la protection de branche : Settings → Branches → Add branch protection rule → `main` → cocher "Require a pull request before merging" et "Require status checks to pass before merging", puis sélectionner le nom exact du contrôle (voir §2.7). **Je n'ai aucun accès à l'API d'administration GitHub depuis cette session — cette étape doit être faite manuellement par toi.**

### 2.6 — Constat avant de présenter le YAML : éviter une duplication
Créer un second fichier de workflow dupliquerait exactement le contrôle `check-design-system.js` déjà présent dans `qa-and-lint.yml` sur les PR touchant `docs/**` — les deux tourneraient sur les mêmes PR, faisant le même travail deux fois. **Je recommande d'étendre `qa-and-lint.yml` plutôt que d'ajouter un fichier séparé** : un seul fichier CI, un seul job, pas de duplication. Renommé honnêtement `CI validation` — puisqu'il ne bloque rien tout seul (voir §2.2), l'appeler "gate" ou "pre-deploy" serait trompeur.

### 2.7 — YAML révisé complet (modification proposée de `.github/workflows/qa-and-lint.yml`, pas un nouveau fichier)
```yaml
name: CI validation

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    name: validate
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # historique complet nécessaire pour comparer contre la base réelle (PR) ou HEAD~1 (push)

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Déterminer la référence de comparaison
        id: base
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "ref=origin/${{ github.base_ref }}" >> "$GITHUB_OUTPUT"
          else
            echo "ref=HEAD~1" >> "$GITHUB_OUTPUT"
          fi

      - name: Aucune couleur en dur hors :root (mode diff vs base, règle déjà fiable)
        run: node tools/check-design-system.js --base=${{ steps.base.outputs.ref }}

      - name: Fichiers publics attendus présents
        run: |
          test -f docs/config.public.js
          test -f docs/index.html

      - name: Syntaxe JS valide sur les fichiers modifiés
        run: |
          set -e
          git diff --name-only ${{ steps.base.outputs.ref }} HEAD -- '*.js' | while read -r f; do
            [ -f "$f" ] && node --check "$f"
          done

      - name: Aucun secret accidentellement ajouté (motif seulement, jamais affiché)
        run: |
          if git diff ${{ steps.base.outputs.ref }} HEAD -- . ':(exclude)docs/config.js' \
            | grep -qEI "sk_live_|sk_test_|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----"; then
            echo "::error::Motif de secret potentiel détecté dans le diff — contenu volontairement non affiché dans les logs."
            exit 1
          fi
          echo "OK — aucun motif détecté"

      - name: Tests automatisés si présents (no-op tant que T5 n'existe pas)
        run: |
          if npm run 2>/dev/null | grep -q " test"; then
            npm test
          else
            echo "Aucun script de test défini pour l'instant (T5 à venir) — étape ignorée sans faire échouer le contrôle"
          fi
```

**Changements vs l'ancien `qa-and-lint.yml`** : retrait du filtre `paths: ['docs/**']` (les vérifications syntaxe/secrets concernent tout le dépôt, pas seulement `docs/`) ; ajout du déclencheur `push: branches: [main]` ; ajout des étapes fichiers/syntaxe/secrets/tests ; `check-design-system.js` reste en mode diff exclusivement (jamais `--full`). Aucune commande n'accède à Supabase, aucun secret n'est référencé (`secrets.*`).

### 2.8 — Nom stable du contrôle
Job nommé `validate` dans le workflow `CI validation` → apparaîtra dans les paramètres GitHub comme contrôle sélectionnable sous ce nom, **mais uniquement après que le workflow a tourné au moins une fois sur une pull request réelle** (GitHub ne propose de rendre obligatoire qu'un check déjà vu s'exécuter). Donc : d'abord fusionner ce fichier via une PR normale (le workflow tournera dessus), puis seulement ensuite aller le sélectionner dans la protection de branche.

### 2.9 — Comportement des commits directs sur `main`
Sans protection de branche : rien ne les empêche, `CI validation` tournerait dessus (déclencheur `push`) mais ne bloquerait rien après coup, et `static.yml` déploierait en parallèle sans attendre le résultat. Avec protection de branche + "Require a pull request before merging" **et** "Include administrators" coché : les push directs seraient rejetés purement et simplement par GitHub, y compris pour le fondateur lui-même — **tension à trancher consciemment** : `agents_config.json` documente déjà un palier explicite où le fondateur peut choisir `allowPushMain=true` pour pousser directement en cas de besoin ; une protection de branche stricte désactiverait cette flexibilité existante. Je ne tranche pas ce compromis à ta place.

### 2.10 — Rollback
Retour à l'ancien contenu de `qa-and-lint.yml` (un seul fichier modifié, pas ajouté — `git revert` du commit ou restauration de l'ancien contenu). Pas de nouveau fichier à supprimer puisqu'on modifie l'existant plutôt que d'en créer un nouveau.

**Rien n'est encore modifié. J'attends ta validation explicite de ce contenu avant de toucher à `qa-and-lint.yml`.**

---

## 2bis. T0 — plan exact de Supabase local (Option A validée comme orientation, pas encore exécutée)

### Version précise et méthode d'installation
**Version réelle vérifiée** (pas une supposition) : dernière release de Supabase CLI au moment de la rédaction = **v2.109.1**, publiée le 2026-07-07 (source : `gh api repos/supabase/cli/releases/latest`, exécuté dans cette session). À fixer explicitement dans le dépôt plutôt que d'installer "la dernière" au hasard à chaque fois : ajout d'une devDependency `"supabase": "2.109.1"` dans `package.json` (méthode npm officiellement supportée par Supabase, cohérent avec l'usage déjà fait de `devDependencies` dans ce projet pour `puppeteer-core`/`eslint`), plutôt qu'une installation globale hors du dépôt.

### Fichiers créés ou modifiés (proposés, pas encore créés)
- `package.json` : ajout de `"supabase": "2.109.1"` dans `devDependencies`.
- `supabase/config.toml` : généré par `supabase init` — configuration standard de la CLI (ports locaux, paramètres Auth/Storage par défaut). N'existe pas aujourd'hui (confirmé lors de l'audit initial : "aucun config.toml Supabase CLI présent").
- `supabase/.gitignore` : généré automatiquement par `supabase init`, exclut les fichiers de données locales (volumes Docker) du suivi git.
- `docs/config.local.js` (nouveau, à créer, **jamais commité**) : pointe vers l'instance locale (`http://127.0.0.1:54321` par défaut + clé anon locale auto-générée, affichée par `supabase status`) — strictement distinct de `docs/config.js` (réel) et `docs/config.public.js` (réel, committé). Utilisé uniquement en chargeant ce fichier à la place de `config.js` pendant une session de test locale.

### Séparation complète des variables locales et de production
- `docs/config.local.js` contient une URL/clé **générées localement par la CLI**, jamais issues du projet réel — aucune valeur copiée depuis `docs/config.js`.
- Aucune clé de production (`docs/config.js`, `.env`) n'est lue ni référencée par la configuration locale.

### Vérification du `.gitignore`
`docs/config.local.js` doit être ajouté à `.gitignore` (aux côtés de `docs/config.js` et `.env` déjà présents) **avant sa création**, pas après — pour qu'il ne soit jamais suivi même par erreur lors d'un premier `git add` accidentel. Cette modification de `.gitignore` fait partie des "fichiers de configuration" — je ne la fais pas sans validation, je la signale comme prérequis.

### Absence totale de clés de production
Confirmée par construction : les valeurs locales sont générées par `supabase start` lui-même (aléatoires, propres à chaque instance locale), jamais dérivées des vraies clés.

### Reconstruction depuis une base vide + application de toutes les migrations
**Constat important, pas une supposition optimiste** : les migrations de ce dépôt (`supabase-schema.sql` + 10 fichiers de `migrations/`) ne suivent pas la convention native de la CLI Supabase (`supabase/migrations/<timestamp>_nom.sql`) — elles ont été écrites pour être collées manuellement dans l'éditeur SQL Supabase, pas pour le système de migration versionné de la CLI. Plutôt que de renommer/réorganiser ces fichiers (une vraie restructuration, hors périmètre), méthode recommandée : appliquer les fichiers **existants, sans les toucher**, dans l'ordre chronologique exact, directement contre la base locale via `psql` (fourni par `supabase start`, connexion locale exposée) :
1. `supabase-schema.sql` (schéma de base).
2. Chaque fichier de `migrations/` dans l'ordre chronologique de leur nom de fichier (déjà daté : `20260709_...`, `2026-07-11-...`, `20260716_...`, `20260719_...`, `20260719c_...`, `20260719d_...`, `20260720_...`, `20260720b_...`, `20260720c_...`).

### Jeu de données synthétique + utilisateurs patron/employé/client
- **Patron** : création via le flux réel d'onboarding pointé vers l'instance locale (`docs/config.local.js`) — pas une insertion SQL directe, pour tester le vrai chemin applicatif (cohérent avec le test #13 de `T2_FINAL_DOSSIER.md`).
- **Employé** : invité depuis ce compte patron via le flux réel (`employe-provision.ts`, servi localement par `supabase functions serve`).
- **Client** : invité de la même façon (`client-provision.ts`).
- Aucune donnée réelle copiée — tout est créé de zéro via les parcours applicatifs normaux, avec des emails/noms fictifs.

### Vérification des RPC (comparaison code vs base, pas une confiance aveugle dans "la migration a terminé sans erreur")
Requête à exécuter localement une fois l'environnement monté :
```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace order by proname;
```
À comparer explicitement contre la liste des RPC réellement appelées par le code (recensées par grep dans ce dépôt) : `create_profile_and_company`, `get_my_client_profile`, `get_my_employee_profile`, `get_my_employee_interventions`, `close_my_intervention`, `erase_account_completely`, `call_notify_alert`, `apply_entity_patch`, `trigger_qa_alert`, `derive_type_alerte`, ainsi que celles utilisées par `sync-push.ts`/`vision-qa.ts` (à confirmer par une relecture complète des Edge Functions au moment de l'exécution réelle). Toute RPC présente dans le code mais absente de la liste locale = migration incomplète, pas une erreur silencieuse à ignorer.

### Vérification des triggers
```sql
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal;
```
Un seul trigger connu dans le schéma actuel, confirmé par lecture directe : `qa_photos_alert_trigger` (`after insert on qa_photos`, `supabase-schema.sql:590-593`) — à retrouver identique localement.

### Vérification des extensions
```sql
select extname from pg_extension;
```
Deux extensions confirmées par lecture directe du schéma : `pg_net` (`supabase-schema.sql:527`) et `vector` (`supabase-schema.sql:642`, pour `memoire_embeddings`) — à confirmer présentes localement (Supabase local les active par défaut, mais à vérifier explicitement plutôt que supposer).

### Vérification des policies RLS
```sql
select schemaname, tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, policyname;
```
À comparer contre le nombre de `create policy` du schéma source (environ 140 occurrences confirmées lors de l'audit initial) — un écart de nombre signale une policy non appliquée localement.

### Vérification du stockage (buckets)
```sql
select id, public from storage.buckets;
```
Deux buckets attendus : `mission-photos` (`public=false`, voir `migrations/20260720c_mission_photos_storage.sql`) et `intervention-photos` (Palier 2, service_role uniquement) — pertinent puisque le test #13 (parcours `bienvenue.html`/`connexion.html`) ne dépend pas du stockage, mais une vérification globale de fidélité de l'environnement doit les inclure.

### Commande de destruction et de recréation complète
```
supabase stop --no-backup   # destruction totale, aucune donnée locale conservée
supabase start               # recréation propre depuis zéro
# puis rejeu des fichiers SQL dans l'ordre chronologique (voir ci-dessus)
```

### Smoke test prouvant que l'environnement fonctionne
Avant tout test T2, un smoke test minimal : ouvrir `docs/onboarding.html` avec `docs/config.local.js` chargé à la place de `config.js`, créer un compte patron test, vérifier dans `supabase status`/Studio local qu'une ligne apparaît dans `auth.users` **et** que le flux ne plante pas avant même d'atteindre `create_profile_and_company` — confirme que l'environnement de base (Auth, RLS de premier niveau) fonctionne avant de diagnostiquer quoi que ce soit de plus spécifique à T2.

**Rien de tout ceci n'a été créé ou installé. Ce plan attend ta validation avant toute exécution.**

---

## 2ter. Diffs de configuration envisagés (aucun encore appliqué)

### `.github/workflows/qa-and-lint.yml` (modifié, pas remplacé par un nouveau fichier)
```diff
-# Garde-fous automatiques en pull request — avant ce workflow, tous les
-# checks du repo (check-design-system, qa-visual-regression, eslint) ne
-# tournaient qu'à la main : une couleur en dur pouvait atteindre main sans
-# que personne ne la voie.
-#
-# Périmètre volontairement limité à check-design-system : les scripts
-# scripts/qa-*.js utilisent un chemin Chrome Windows codé en dur et des
-# baselines pixel dépendantes de la machine — les porter en CI est un
-# chantier séparé (décision fondateur, règle CLAUDE.md sur les scripts QA).
-name: Garde-fous (design system)
+# CI validation — étendu le 2026-07-22 : couvrait uniquement check-design-system
+# sur PR touchant docs/**. Étend désormais à tout le dépôt (syntaxe JS, fichiers
+# publics attendus, motifs de secrets) et ajoute push:main. Toujours pas de
+# blocage réel sans protection de branche (voir PHASE_1A_CHECKPOINT.md §2.2/2.3).
+name: CI validation

 on:
   pull_request:
     branches: [main]
-    paths: ['docs/**']
+  push:
+    branches: [main]
+
+permissions:
+  contents: read

 jobs:
-  design-system:
+  validate:
+    name: validate
     runs-on: ubuntu-latest
+    permissions:
+      contents: read
     steps:
       - uses: actions/checkout@v4
         with:
-          fetch-depth: 0 # le mode diff compare vs la branche cible
+          fetch-depth: 0
       - uses: actions/setup-node@v4
         with:
           node-version: 20
+      - name: Déterminer la référence de comparaison
+        id: base
+        run: |
+          if [ "${{ github.event_name }}" = "pull_request" ]; then
+            echo "ref=origin/${{ github.base_ref }}" >> "$GITHUB_OUTPUT"
+          else
+            echo "ref=HEAD~1" >> "$GITHUB_OUTPUT"
+          fi
       - name: Aucune couleur en dur hors :root (mode diff vs base)
-        run: node tools/check-design-system.js --base=origin/${{ github.base_ref }}
+        run: node tools/check-design-system.js --base=${{ steps.base.outputs.ref }}
+      - name: Fichiers publics attendus présents
+        run: |
+          test -f docs/config.public.js
+          test -f docs/index.html
+      - name: Syntaxe JS valide sur les fichiers modifiés
+        run: |
+          set -e
+          git diff --name-only ${{ steps.base.outputs.ref }} HEAD -- '*.js' | while read -r f; do
+            [ -f "$f" ] && node --check "$f"
+          done
+      - name: Aucun secret accidentellement ajouté (motif seulement, jamais affiché)
+        run: |
+          if git diff ${{ steps.base.outputs.ref }} HEAD -- . ':(exclude)docs/config.js' \
+            | grep -qEI "sk_live_|sk_test_|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----"; then
+            echo "::error::Motif de secret potentiel détecté dans le diff — contenu volontairement non affiché dans les logs."
+            exit 1
+          fi
+          echo "OK — aucun motif détecté"
+      - name: Tests automatisés si présents (no-op tant que T5 n'existe pas)
+        run: |
+          if npm run 2>/dev/null | grep -q " test"; then
+            npm test
+          else
+            echo "Aucun script de test défini pour l'instant (T5 à venir) — étape ignorée sans faire échouer le contrôle"
+          fi
```

### `package.json` (ajout d'une devDependency, pas encore appliqué)
```diff
   "devDependencies": {
     "eslint": "^10.6.0",
     "pixelmatch": "^7.2.0",
     "pngjs": "^7.0.0",
-    "puppeteer-core": "^21.0.0"
+    "puppeteer-core": "^21.0.0",
+    "supabase": "2.109.1"
   }
```

### `.gitignore` (ajout d'une ligne, prérequis avant tout fichier local)
```diff
 docs/config.js
+docs/config.local.js
 .env
```

### `docs/config.local.js` (nouveau fichier, contenu type — jamais commité une fois créé)
```js
window.SEBA_CONFIG = {
  supabaseUrl: 'http://127.0.0.1:54321',       // généré par `supabase start`, jamais l'URL réelle
  supabaseAnonKey: '<clé anon locale affichée par `supabase status`>',
  accountId: 'test-local',
};
```

**Aucun de ces diffs n'est appliqué. Présentés pour validation avant toute création/modification.**

---

## 3. Inventaire T1 — les 49 scripts de `scripts/`, sans suppression

Méthode : lecture de chaque script + une exécution réelle non destructive quand c'était sûr de le faire (voir preuves). Classification empirique, pas seulement déclarative.

| Catégorie | Nombre | Scripts | Preuve |
|---|---|---|---|
| **A — Chemin cassé (`docs/dashboard.html`, déplacé vers `docs/app/dashboard.html`)** | 18 | `audit-stress-test`, `debug-horizon-hover`, `preview-tactical-dark`, `verify-action-vectors`, `verify-aura`, `verify-design-system`, `verify-drag-haptic`, `verify-ext-drawer`, `verify-final-batch`, `verify-focus-mode`, `verify-horizon`, `verify-seba-ai`, `verify-serenity`, `verify-serenity-hover-anim`, `verify-serenity-mobile`, `verify-theme-toggle`, `verify-timeline-life`, `verify-timeline-rail` | Confirmé par grep : `path.resolve('docs', 'dashboard.html')`, chemin inexistant (vérifié par `ls`) |
| **B — Dépend de `localhost:8791` (serveur manuel non documenté)** | 12 | `verify-accountid-fix`, `verify-ai-relay-frontend`, `verify-full-regression`, `verify-phase2`, `verify-phase3`, `verify-phaseA-audio`, `verify-phaseB-aibar`, `verify-phaseC-calibration`, `verify-phaseD-pontdedonnees`, `verify-TD2-sidebar`, `verify-TD3-cockpit`, `verify-TD4-toast` | **Testé réellement** : `curl localhost:8791` → aucune réponse (aucun serveur actif). Cassés aujourd'hui, confirmé, pas supposé. |
| **C — Chemin correct (`docs/app/dashboard.html`)** | 4 | `check-404`, `mobile-audit`, `qa-dashboard-full`, `qa-visual-regression` | `check-404.js` **exécuté réellement** (voir ci-dessous) — succès. Les 3 autres non exécutés ici (écrivent des captures dans `docs/audit-screenshots/`, hors périmètre de fichiers autorisés pour ce checkpoint) mais chemin vérifié correct par lecture. |
| **D — Cible le site live directement (jamais affecté par le déplacement du dashboard)** | 8 | `fresh-eyes-audit`, `qa-onboarding-flow`, `qa-other-sweep`, `verify-confiance-desktop`, `verify-live-serenity`, `verify-live-tactical-dark`, `verify-void`, `verify-void2` | Ciblent `sebpromax.github.io/seba/` directement — non exécutés ici (écriture de captures), mais aucune preuve de cassure trouvée par lecture. |
| **E — Cible d'autres pages existantes, chemin correct** | 7 | `preview-3-pages` (client-fiche/devis-nouveau/employe-fiche), `preview-mobile-check` (clients.html), `preview-tactical-dark-all` (clients/devis/factures/planning/equipe/historique/reglages), `qa-other-linkcheck` (scan générique de `docs/`), `verify-connexion-eye` (connexion.html), `verify-onboarding-full-mobile`/`verify-onboarding-mobile-height` (onboarding.html) | Toutes les pages cibles vérifiées existantes. Non exécutés (écriture de captures). |

**Total** : 18 + 12 + 4 + 8 + 7 = 49, cohérent avec l'inventaire complet du dossier.

### Exécution réelle effectuée (preuve empirique, non destructive)
- `node scripts/check-404.js` → exécuté avec succès, résultat réel : `onboarding.html -> []`, `app/dashboard.html?demo -> []`, `tarifs.html -> []` (aucun 404 sur les 3 pages testées, contre le site live). Confirme que ce script fonctionne réellement aujourd'hui, pas seulement "en théorie".
- `curl localhost:8791` → aucune réponse, confirmant empiriquement (pas par supposition) que les 12 scripts de la catégorie B sont cassés aujourd'hui.

### Correction par rapport à l'estimation précédente
Mon estimation antérieure ("4-6 scripts réellement réutilisables") était **trop pessimiste** : avec cette vérification empirique des chemins, ce sont en réalité **19 scripts (catégories C+D+E) qui ciblent des chemins valides** et sont plausiblement encore fonctionnels — contre 30 (catégories A+B) confirmés cassés. Je le signale explicitement : mon audit initial n'avait pas vérifié individuellement chaque script, seulement échantillonné.

### Décision individuelle proposée (aucune action prise)
- **Catégorie A (18) et B (12)** : proposer l'archivage vers `scripts/archive/` (pas la suppression) — cassés, confirmés, aucune valeur immédiate, mais logique de vérification potentiellement réutilisable un jour.
- **Catégorie C (4)** : conserver activement, ce sont les scripts de régression les plus solides du dépôt.
- **Catégories D (8) et E (7)** : conserver, mais recommander une vérification d'exécution réelle (comme celle faite pour `check-404.js`) avant de les considérer pleinement fiables — non faite ici par prudence sur l'écriture de fichiers dans `docs/`.

Aucun script n'a été déplacé ni supprimé.

---

## 4. T2 — dossier final

**Déplacé et développé en profondeur dans `_architecture/T2_FINAL_DOSSIER.md`** (état actuel complet, vérification des données existantes, analyse de la source de vérité des secteurs, migration exacte, 13 tests obligatoires, rollback non trivial révisé). Le diagnostic initial ci-dessous reste valide mais est **superficiel comparé au dossier final** — s'y référer en priorité.

**Correction importante par rapport à ma première estimation** : mon rollback initial ("trivial, table vide") n'est correct **qu'avant la première correction réussie**. Une fois la RPC corrigée et fonctionnelle, un rollback devient non trivial dès qu'un seul profil réel est créé — voir `T2_FINAL_DOSSIER.md` §Rollback pour l'analyse complète.

**Aucune modification de code n'a été faite pour T2. J'attends ton autorisation explicite avant d'appliquer cette correction.**

---

## 5. T3 — risque reformulé (pas une correction, une préservation du diagnostic)

### Cartographie précise de la file d'attente (relecture ligne par ligne de `docs/seba-data.js:186-309`)
- `seba_pending_ops` (localStorage) : liste d'opérations `{client_seq, entity, entity_id, op, patch, attempts}`.
- `pushOp()` (ligne 227-233) : ajoute une opération, incrémente `client_seq`, déclenche `scheduleSyncWorker()` (debounce 800ms).
- `syncWorker()` (ligne 246-307) : envoie **tout le lot** en un seul POST vers `sync-push.ts`.

### Conditions exactes de perte ou d'abandon — **plus précises que mon diagnostic initial**
Il existe **deux mécanismes de défaillance distincts**, pas un seul :

**(a) Échec au niveau de la requête HTTP entière** (ligne 281-284 : `!res.ok && res.status !== 207`) :
- La fonction retourne **sans planifier de nouvel essai automatique**.
- Le seul déclencheur d'un nouvel essai est soit une **nouvelle écriture** de l'utilisateur (`pushOp()` rappelle `scheduleSyncWorker()`), soit un événement navigateur `'online'` (ligne 308-309).
- **Recherche exhaustive confirmée** : `scheduleSyncWorker()` n'est appelé qu'à ces 3 endroits exacts dans tout le fichier — aucune autre boucle périodique n'existe, et **aucun appel n'a lieu au chargement de la page** si la file contient déjà des opérations en attente d'une session précédente.
- **Conséquence réelle** : si le serveur répond en erreur HTTP (500, panne temporaire de la fonction) pendant que le réseau reste disponible, et que l'utilisateur ferme l'onglet sans rien écrire de nouveau, **l'opération reste bloquée indéfiniment** jusqu'à la prochaine écriture ou reconnexion — pas seulement "5 tentatives puis abandon" comme je l'avais indiqué précédemment. C'est une correction de mon propre diagnostic antérieur, plus grave que ce qui était documenté.

**(b) Échec au niveau d'une opération individuelle** (le serveur répond mais marque une opération précise `status: 'error'`, lignes 285-299) :
- Compteur `attempts` incrémenté uniquement dans ce cas.
- Après plus de 5 tentatives (`MAX_OP_ATTEMPTS`), l'opération est retirée de la file avec un simple `console.error` — c'est le mécanisme que j'avais documenté initialement, mais il ne couvre qu'une partie des cas réels.

### Persistance après fermeture du navigateur
`seba_pending_ops` vit dans `localStorage`, **pas** `sessionStorage` — il persiste après fermeture de l'onglet/du navigateur, tant que l'utilisateur ne vide pas les données du site. Nuance importante entre les deux cas :
- **Cas (a) (échec HTTP complet)** : l'opération n'est **pas perdue du disque**, elle reste dans `localStorage` indéfiniment — mais rien ne la relance automatiquement tant qu'aucune nouvelle écriture ou reconnexion ne se produit. C'est "bloqué", pas "supprimé".
- **Cas (b) (échec par opération, >5 tentatives)** : l'opération est **activement retirée** de `seba_pending_ops` — c'est une perte réelle, pas juste un blocage.

### Comment l'utilisateur peut détecter le problème aujourd'hui
Il ne peut pas, sans ouvrir la console développeur (`console.warn`/`console.error`). Aucun indicateur UI n'existe. Un utilisateur non technique n'a aucun moyen de savoir qu'une de ses opérations (devis, facture, clôture de mission) n'a jamais atteint le serveur.

### Conditions actuelles qui relancent la file (sans notification, sans garantie)
1. Toute nouvelle écriture (`SebaDB.create/update/remove` sur n'importe quelle entité) — `pushOp()` rappelle `scheduleSyncWorker()` pour **tout le lot en attente**, pas seulement la nouvelle opération.
2. L'événement navigateur `'online'` (ligne 308-309) — se déclenche uniquement si le navigateur détecte une transition hors-ligne → en ligne, pas sur une simple erreur serveur pendant que le réseau reste actif.
3. **Aucune autre condition** — pas de minuteur périodique, pas de flush au chargement de la page, confirmé par recherche exhaustive de tous les appels à `scheduleSyncWorker()` dans le fichier.

### Ce que l'utilisateur voit actuellement
Rien, dans les deux cas. Aucun indicateur UI, aucune notification — confirmé par grep, aucune référence à `seba_pending_ops` ou à un état de synchronisation dans les fichiers `docs/*.html`.

### Scénarios de correction proposés (à trancher, pas encore choisis)
1. **Ajouter un appel de `scheduleSyncWorker()` à l'initialisation de SebaDB** si `loadQueue()` retourne une file non vide — corrige directement le cas (a), le plus grave des deux.
2. **Ajouter un minuteur périodique de secours** (ex. toutes les 60 secondes tant que la file n'est pas vide) en complément des déclencheurs événementiels actuels — filet de sécurité supplémentaire.
3. **Exposer un état visible** (`SebaDB.onChange` déjà existant comme mécanisme d'écoute, à étendre) pour qu'une bannière UI affiche "en attente de synchronisation" tant que `seba_pending_ops` n'est pas vide.
4. Pour le cas (b) uniquement : au lieu de supprimer silencieusement après 5 échecs, déplacer vers une file "échec persistant" distincte et non supprimée, avec un bouton de nouvel essai manuel.

### Tests de reproduction non destructifs proposés (à écrire dès qu'un framework existe, T5)
- Simuler une réponse HTTP 500 du endpoint `sync-push` (mock ou intercepteur réseau) et vérifier qu'aucun nouvel essai n'est planifié automatiquement — reproduit le cas (a) tel qu'il existe aujourd'hui.
- Simuler un `status: 'error'` répété sur une opération précise et vérifier qu'elle est bien abandonnée après 5 tentatives — reproduit le cas (b).
- Vérifier qu'un rechargement de page avec une file non vide ne relance rien automatiquement — confirme l'absence de flush au chargement.

### Découverte additionnelle — un second risque de synchronisation déjà documenté et jamais corrigé
En recherchant l'historique de `create_profile_and_company` (pour le dossier T2), j'ai trouvé `AUDIT-GO-LIVE-SEBA.md`, un audit antérieur qui documente **une fenêtre de course réelle et distincte** dans l'idempotence de `sync-push.ts` (section 4, RED) — un correctif est déjà rédigé dans ce document (`upsert` avec `ignoreDuplicates` avant `apply_entity_patch`, plutôt que l'ordre actuel) mais **jamais appliqué** (case de la checklist de déploiement toujours décochée, ligne 128 : *"pas strictement bloquant pour un premier déploiement à faible échelle"*). Ce même audit identifie aussi, indépendamment de moi, exactement le même trou que mon propre diagnostic T3 (ligne 117 : *"Volume `sync_operations` en statut 'error' côté client... n'existe pas encore [remonté serveur]"*) — une confirmation croisée par une source antérieure, pas juste mon observation isolée. Ces deux éléments renforcent la gravité de T3 pour le pilote à venir (le pilote introduira justement "une utilisation multi-employés simultanée sur un même compte", la condition exacte que cet audit signalait comme déclencheur du risque).

**Aucune correction n'a été appliquée pour ce point non plus — signalé, pas traité, hors périmètre de ce checkpoint.**

---

## 5bis. Comparaison de priorité T2 vs T3 (basée sur l'impact réel, pas un ordre par défaut)

### T2 — `create_profile_and_company`
- **Parcours actuellement bloqués** : uniquement la création de `profiles`/`companies`, deux tables jamais relues par aucune page (confirmé par grep exhaustif) — le blocage est réel mais invisible.
- **Nombre potentiel d'utilisateurs concernés aujourd'hui** : zéro observable — aucun impact fonctionnel visible tant que rien ne relit ces tables.
- **Possibilité de contourner** : oui, totalement — le reste de l'onboarding (création du compte réel, accès au dashboard) fonctionne indépendamment de l'échec silencieux de cette RPC.
- **Conséquences commerciales aujourd'hui** : aucune mesurable — mais bloquant pour la fiche publique prévue en Groupe 3, qui a besoin de `profiles`/`companies` fonctionnelles.
- **Risque créé par la correction elle-même** : réel et déjà identifié — absence de contrainte d'unicité sur `profiles.user_id` (voir `T2_FINAL_DOSSIER.md`), la correction peut activer un nouveau risque de doublons qui n'existait pas avant (puisque rien ne réussissait avant).

### T3 — synchronisation `seba-data.js`/`sync-push.ts`
- **Opérations concernées** : toutes les écritures via le CRUD générique (clients, devis, factures, interventions, employés, journal) — le cœur du produit actif aujourd'hui.
- **Utilisateurs actifs potentiellement touchés** : tous les comptes patron déjà en usage réel (contrairement à T2, ce chemin est utilisé activement dès qu'un compte existe).
- **Probabilité de panne** : non mesurable depuis ce dépôt seul (dépend de la fiabilité réelle de l'Edge Function `sync-push` en production, non vérifiable ici) — mais le mécanisme de défaillance (a) ne nécessite qu'une seule erreur HTTP transitoire pour bloquer indéfiniment une opération, ce qui n'est pas un événement rare dans l'absolu.
- **Possibilité de perdre ou bloquer des données** : oui, confirmée — cas (a) bloque silencieusement sans limite de temps, cas (b) supprime réellement après 5 tentatives ; renforcé par la fenêtre de course indépendante déjà documentée dans `AUDIT-GO-LIVE-SEBA.md`.
- **Visibilité du problème pour l'utilisateur** : nulle dans les deux cas (T2 et T3) — mais pour T3, l'utilisateur croit activement que son action (créer un devis, clôturer une mission) a réussi, alors qu'elle peut ne jamais atteindre le serveur.
- **Méthode manuelle de récupération aujourd'hui** : aucune pour l'utilisateur final ; un développeur pourrait inspecter `localStorage['seba_pending_ops']` manuellement, mais rien n'est prévu pour un utilisateur non technique.
- **Impact métier** : potentiellement plus grave que T2 dans l'absolu (données métier réelles, pas une table jamais lue), mais dépend entièrement du volume d'usage actif actuel — information que je n'ai pas.

### Application de ta règle de décision
- Si des utilisateurs actifs utilisent aujourd'hui le produit en conditions réelles (pas seulement en démonstration) et peuvent donc saisir des données qui restent silencieusement bloquées : **T3 devient prioritaire**, car son impact est actif et invisible, contrairement à T2 qui est bloqué mais sans impact observable.
- Si l'usage actuel reste limité à la démonstration/aux tests internes, sans utilisateur réel dépendant de la synchronisation cloud : **T2 reste prioritaire**, car il conditionne directement le Groupe 3 (fiche publique) et son risque (doublons potentiels) est plus simple à circonscrire dans un environnement isolé avant toute mise en production.
- **Je ne dispose pas de cette information** (volume d'usage réel actuel, nombre de comptes patron actifs en production, fréquence d'écriture) — **c'est une décision humaine, pas une déduction technique que je peux faire depuis ce dépôt.** Information nécessaire : combien de comptes patron utilisent réellement Seba aujourd'hui en dehors de toi-même et des tests, et à quelle fréquence.

---

## 6. Cartographie RGPD préliminaire T4

### Données du client
- `client_accounts` (`client_user_id`, `account`, `client_id`, `email`) — lien vers le compte `auth.users` propre du client.
- `client_requests` (`client_user_id`, `titre`, description libre, `photo_path` à la clôture) — contenu potentiellement sensible (adresse implicite via la demande, photos).
- `seba_messages` où `client_user_id` participe — contenu de conversation.
- Entrée dans `state.clients[]` du blob JSONB du **patron** (pas du client) — nom, coordonnées, historique — **ce n'est pas une donnée du client mais une donnée du patron À PROPOS du client**, distinction juridique importante à soumettre au juriste.

### Données de l'employé
- `employe_accounts` (`employe_user_id`, `account`, `employe_id`, `email`).
- Interventions où il est assigné (`state.employes[]`, vit dans le blob du patron, même remarque que ci-dessus).
- Rapports/photos de clôture de mission qu'il a lui-même soumis (`close_my_intervention`).

### Relations et obligations de conservation identifiées (pour le juriste, pas tranchées ici)
- Une facture émise par le patron à un client vit dans `state.factures[]`, **propriété du patron**, indépendante de `client_requests` — supprimer les données personnelles du client dans `client_requests` ne casserait pas la comptabilité du patron (les deux ne sont pas liées par une contrainte technique).
- En revanche, l'historique de conversation (`seba_messages`) et la demande elle-même (`client_requests`) constituent potentiellement une preuve dont le patron pourrait avoir besoin en cas de litige — tension réelle entre droit à l'effacement (client) et intérêt légitime/obligation de conservation (patron), à trancher juridiquement, pas techniquement.

### Mécanismes actuels d'export et de suppression (inventaire, rien de nouveau)
- `erase_account_completely()` (patron uniquement) — supprime en cascade toutes les tables satellites via `seba_state(account) on delete cascade`, **y compris `client_requests` et `seba_messages`** — confirmé par lecture directe des contraintes de table (`references seba_state (account) on delete cascade`). Autrement dit : **si le patron supprime son compte aujourd'hui, les données du client dans `client_requests`/`seba_messages` sont déjà supprimées physiquement**, pas anonymisées — ce comportement existe déjà, la question pour T4 ne porte que sur le cas inverse (le client supprime SON compte, pas celui du patron).
- **Aucune fonction équivalente n'existe pour que le client/employé supprime ses propres données** — confirmé, aucune branche de aucune RPC ne traite `client_user_id`/`employe_user_id` comme point d'entrée d'auto-suppression.
- `SebaDB.eraseAllData()` (`docs/seba-data.js`, appelée depuis `reglages.html`) — supprime `seba_state` côté patron uniquement, échoue silencieusement en cas de coupure réseau (déjà documenté dans `SEBA_SECURITY_AND_TRUST.md` §10).

### Options anonymisation / suppression / hybride (préparées, pas choisies)
- **Suppression physique complète** : cohérente avec le comportement déjà existant côté patron (cascade réelle), simple techniquement, mais supprime potentiellement une preuve dont le patron pourrait avoir besoin.
- **Anonymisation** (conserver la ligne, vider les champs identifiants) : préserve l'intégrité de l'historique du patron (nombre d'interventions, statistiques), mais plus complexe techniquement (quels champs anonymiser exactement, comment gérer une ligne "anonyme" dans l'UI du patron).
- **Hybride** : suppression complète des données de contact/identité (`client_accounts`, email, téléphone) mais conservation anonymisée du contenu transactionnel (dates, montants, statut) — probablement le compromis le plus défendable juridiquement, mais c'est exactement le type d'arbitrage qui doit venir d'un avis juridique, pas d'une préférence technique.

### Conséquences techniques de chaque option (pour éclairer le juriste, pas pour trancher)
- Suppression physique : plus simple à implémenter (RPC courte), risque de casser une preuve en cas de litige déjà engagé.
- Anonymisation : nécessite de définir précisément, champ par champ, ce qui est "identifiant" vs "transactionnel" dans `client_requests`/`seba_messages`/les entrées `state.clients[]` du patron.
- Hybride : le plus de travail d'implémentation, mais le compromis le plus probable une fois l'avis juridique rendu.

### Questions précises à transmettre au juriste (livrable de cette section)
1. Un client qui demande l'effacement de ses données peut-il légalement s'opposer à ce que le patron conserve une trace anonymisée de la transaction pour ses propres obligations comptables/de défense en cas de litige ?
2. Le contenu d'une conversation (`seba_messages`) est-il soumis aux mêmes règles que les données d'identité, ou peut-il être traité différemment (ex. anonymisé mais conservé) ?
3. Quelle est la durée de conservation minimale légale, le cas échéant, avant qu'une suppression complète devienne obligatoire sans exception ?
4. La distinction "donnée du patron à propos du client" (dans `state.clients[]`) vs "donnée propre du client" (`client_requests`, `seba_messages`) change-t-elle le traitement applicable ?

**Aucune suppression, anonymisation ou migration n'a été implémentée. Cette cartographie est le livrable attendu pour transmission au juriste.**

---

## 7. Propriétaires encore non assignés

Voir `SEBA_OWNERS_AND_DEADLINES.md` (mis à jour) pour le détail complet. Résumé des lignes marquées **NON ASSIGNÉ — BLOQUANT AVANT L'ÉTAPE CONCERNÉE** : le choix anonymisation/suppression de T4 (ligne 8), la conformité facturation France (ligne 14), la responsabilité de la plateforme (ligne 15), la mise à jour RGPD/CNIL des nouveaux flux publics (ligne 16), et la vérification Monaco (ligne 17, non bloquante pour l'instant). Toutes nécessitent une ressource juridique ou comptable qui n'a pas encore été engagée.

---

## 8. État du lancement du recrutement Gate 0

**Honnêteté explicite, pas une formalité** : le recrutement et les entretiens **n'ont pas commencé dans le monde réel**. Je ne peux ni contacter des professionnels, ni passer des appels, ni mener un entretien — ce sont des actions humaines réelles que seul toi peux exécuter. Le kit (`EXECUTION_DOSSIER_B_GATE0.md`) est prêt à l'emploi : messages de recrutement, script d'entretien, grilles. Ton autorisation de "commencer immédiatement" porte sur ta propre action terrain, pas sur une action que j'aurais engagée à ta place. Statut réel : **kit livré, recrutement non commencé**.

---

## 9. Désaccords ou nouveaux risques identifiés

1. **Correction d'un de mes propres diagnostics antérieurs** (pas un désaccord avec toi, une autocorrection) : ma caractérisation précédente de la perte de synchronisation ("5 tentatives puis abandon silencieux") était incomplète. La relecture ligne par ligne montre un second mécanisme plus grave : une panne HTTP complète (pas seulement une erreur par opération) ne déclenche **aucun nouvel essai automatique** tant que l'utilisateur n'écrit rien de nouveau ou ne se reconnecte pas — potentiellement une attente indéfinie, pas bornée à 5 tentatives. Voir §5.
2. **Risque nouvellement identifié (T0)** : l'absence totale de séparation dev/test/prod au niveau Supabase (un seul projet pour tout) rend l'écriture de tests RLS (T5) plus délicate qu'anticipé — soit il faut créer un second projet Supabase avant T5, soit accepter un risque réel de test contre des données réelles avec des comptes jetables mal isolés. Ce point n'était pas assez mis en avant dans mes documents précédents.
3. **Correction de mon estimation sur T1** : 19 scripts (pas 4-6) ciblent des chemins valides et sont plausiblement encore fonctionnels — mon audit initial les avait sous-estimés faute de vérification empirique individuelle.
4. **Aucun désaccord sur le fond des instructions de cette Phase 1A** — le séquencement demandé (préparation avant correction, autorisation explicite avant modification) est cohérent avec les risques réels observés, en particulier au vu du point 1 ci-dessus.

---

## Synthèse finale

### Première correction de code que je recommande d'autoriser
**T2 — élargissement de la contrainte CHECK sur `profiles.sector`.**

### Pourquoi elle passe avant les autres
- C'est le bug le plus simple, le plus isolé, et le mieux compris des trois (T2/T3/T4) — une seule contrainte SQL, aucune ambiguïté sur la cause racine.
- Contrairement à T3 (qui touche un mécanisme central utilisé par tout le CRUD) et T4 (qui attend un avis juridique), T2 ne dépend d'aucune ressource externe et ne modifie aucun comportement pour les utilisateurs actuels (la table est vide, personne ne peut régresser).
- Elle débloque directement un prérequis du Groupe 3 (réutilisation de `profiles`/`companies` pour la fiche publique), sans être elle-même liée à la face publique.

### Fichiers qu'elle modifierait
- Une nouvelle migration SQL (ex. `migrations/2026-07-XX-fix-profiles-sector-check.sql`).
- Aucune modification de `docs/services/config-dashboard.js` ni du frontend (la correction reste côté SQL, voir §4 point 5).

### Tests prévus
- Test manuel ou automatisé (selon si T5/l'environnement de test est disponible d'ici là) des 4 valeurs réelles (`menage`, `conciergerie`, `maintenance`, `autre`) contre la RPC corrigée.
- Test de non-régression : une valeur inventée (ex. `'plomberie'`) doit rester rejetée.

### Rollback
Migration inverse restaurant l'ancienne contrainte CHECK — trivial, aucune donnée réelle en jeu (table vide à ce jour).

### Éléments encore inconnus
- Faut-il garder les clés internes minuscules (`menage`) comme valeurs autorisées, ou les renommer en libellés plus lisibles (`Nettoyage`) ? Je recommande les clés internes telles quelles, mais c'est ton arbitrage, pas le mien.
- Aucun environnement de test séparé n'existe encore (T0) — le test ci-dessus devra soit attendre la création d'un projet Supabase de test, soit être exécuté avec prudence contre le projet unique existant avec un compte jetable créé et nettoyé pour l'occasion.

**J'attends ton autorisation explicite avant d'implémenter cette correction.**
