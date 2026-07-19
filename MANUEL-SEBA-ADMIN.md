# MANUEL DU PROPRIÉTAIRE — Seba

Ce document t'explique **exactement** quoi faire pour passer du prototype (mode démo, données locales) au vrai produit connecté (comptes réels, données cloud, paiements, IA). Chaque bloc "PLACEHOLDER" du code est listé ici.

---

## Section 1 — Configuration des clés API

**Le principe — deux couches** :

| Fichier | Contenu | Publié ? |
|---|---|---|
| `docs/config.public.js` | Supabase URL + clé *publishable* (**publiques par design** — les données sont protégées par le RLS côté serveur) | ✅ committé, déployé — le site en ligne a les vrais comptes |
| `docs/config.js` | Clés **SECRÈTES** : Groq (`gsk_…`), et surcharges locales | ❌ gitignoré, jamais publié |

```
1. Supabase : déjà branché dans config.public.js ✓
2. Pour Groq/Stripe : copie docs/config.example.js → docs/config.js
   et remplace les valeurs VOTRE_… (config.js écrase config.public.js)
3. Le site fusionne les deux couches automatiquement au chargement
```

**Accès démo commercial** : une fois Supabase actif, le dashboard exige une connexion. Pour montrer le prototype à un prospect sans compte : partage le lien **`dashboard.html?demo`** (accès démo le temps de l'onglet).

### 1a. Supabase (comptes utilisateurs + données cloud) — GRATUIT
1. Va sur https://supabase.com → **Start your project** → crée un projet (région Europe).
2. Menu **Settings → API** :
   - **Project URL** → colle dans `supabaseUrl`
   - **anon public** (longue clé `eyJ…`) → colle dans `supabaseAnonKey`
3. Effet immédiat : l'inscription (onboarding étape 8) crée un vrai compte, la connexion vérifie les vrais identifiants, et **le dashboard devient inaccessible sans session** (`guard.js` redirige vers la connexion).

### 1b. Assistant IA + Conscience Seba (relais unifié `ai-relay`) — GRATUIT

Depuis le 2026-07-07, une seule fonction `ai-relay.ts` alimente à la fois le chat du dashboard (`ai-assistant.js`) et la Conscience Seba (`widgets.js`). Elle essaie les fournisseurs **dans l'ordre, gratuitement, jusqu'à ce que l'un réponde** : Mistral → Groq → OpenRouter → Gemini. Tu n'es obligé d'en configurer aucun (le site retombe sur l'analyste local sans erreur visible), mais plus tu en ajoutes, plus la cascade est robuste.

**Niveau 1 — test en local uniquement** (déjà fait si tu as suivi ce guide) :
1. https://console.groq.com → **API Keys** → **Create API Key**.
2. Colle la clé (`gsk_…`) dans `docs/config.js` → `groqApiKey`.
3. Effet : sur TON ordinateur uniquement, le chat devient une vraie IA. Sur le site public (GitHub Pages), ça reste l'analyste local tant que le relais n'est pas déployé.

**Niveau 2 — vraie IA pour TOUT LE MONDE sur le site en ligne** (relais Supabase Edge Function, clés cachées côté serveur) :
1. Supabase → menu **Edge Functions** → **Deploy a new function** (ou **Create function**).
2. Nom de la fonction : `ai-relay`.
3. Colle le contenu de **`supabase-functions/ai-relay.ts`** (racine du projet) dans l'éditeur → **Deploy**.
4. Toujours dans Edge Functions → onglet **Secrets** → ajoute celles que tu as (une seule suffit pour que la cascade fonctionne, les autres sont sautées silencieusement) :
   - `MISTRAL_API_KEY` — https://console.mistral.ai → API Keys
   - `GROQ_API_KEY` — https://console.groq.com → API Keys
   - `OPENROUTER_API_KEY` — https://openrouter.ai → Keys (compte gratuit)
   - `GEMINI_API_KEY` — https://aistudio.google.com/apikey (compte gratuit, **ne jamais activer la facturation** sur ce projet Google Cloud sinon le free tier disparaît définitivement)
5. C'est tout — `ai-assistant.js` et `widgets.js` détectent automatiquement la fonction et l'utilisent en priorité (à condition qu'une session réelle existe : le mode démo sans compte retombe sur l'analyste local, exprès, pour ne pas consommer le quota partagé). Si la fonction n'est pas encore déployée, ou si aucune clé n'est configurée, le site retombe tout seul sur l'analyste local (aucune erreur visible pour tes visiteurs).
   ⚠️ Si tu avais déjà déployé `groq-chat` et `seba-ai-mistral` (anciennes fonctions) : tu peux les supprimer dans Supabase → Edge Functions, elles sont remplacées par `ai-relay`.
   ℹ️ Le relais limite chaque compte à 50 requêtes/jour (table `api_usage`, voir Section 2) pour éviter qu'un usage abusif ne consomme tout le quota gratuit partagé.
   ℹ️ **Disjoncteur global de coût** (2026-07-09, `_shared/llm-providers.ts`) : en plus du quota par compte ci-dessus, un plafond GLOBAL (tous comptes confondus) protège les clés API partagées d'un dépassement de coût agrégé — variable `MAX_DAILY_REQUESTS` (défaut : 50/jour), ajoutable dans Edge Functions → Secrets si tu veux l'ajuster. Contrairement au quota par compte (qui laisse passer en cas de panne de vérification), celui-ci **bloque** tous les appels IA si le compteur (table `api_usage_daily`) est inaccessible — un choix volontaire pour ne jamais risquer un dépassement de coût silencieux. Voir README.md section "Environment Variables".

### 1c. Stripe (paiements) — GRATUIT jusqu'à la 1re vente
1. Va sur https://dashboard.stripe.com → **Développeurs → Clés API** :
   - **Clé publiable** (`pk_test_…` puis `pk_live_…`) → `stripePublicKey`
2. Crée un **Payment Link** (menu Liens de paiement → + Nouveau) pour ton abonnement Seba → colle l'URL dans `stripePaymentLink`.
3. Effet : le bouton du plan Pro sur la page Tarifs ouvre ton paiement réel ; le bouton "💳 Lien" des factures copie un lien Stripe avec la référence de la facture (`client_reference_id`) pour le rapprochement.
   ⚠️ Ne mets JAMAIS une clé `sk_…` (secrète) dans le site.

### 1d. Conscience Seba (recommandations IA du Dashboard)
Utilise désormais le même relais `ai-relay` que la section 1b ci-dessus (plus besoin d'une fonction séparée). Une fois `ai-relay` déployé avec au moins une clé configurée, `callSebaAI()` dans `widgets.js` peut joindre le relais. Le Dashboard déclenche automatiquement une analyse IA (affichée comme une notification "aura", cf. Conscience Seba) quand le Serenity Score entre en alerte, ou quand un mouvement financier important apparaît dans les Lignes d'Horizon. Sans secret configuré, ces déclenchements échouent silencieusement (aucune notification, aucune erreur visible) — le dashboard reste utilisable normalement.

### 1e. Email (devis/factures envoyés au client) — Resend, GRATUIT
1. https://resend.com → crée un compte gratuit (3 000 emails/mois, 100/jour).
2. **API Keys** → **Create API Key**.
3. Supabase → **Edge Functions** → **Deploy a new function**, nom `send-email`.
4. Colle le contenu de **`supabase-functions/send-email.ts`** → **Deploy**.
5. Edge Functions → **Secrets** → ajoute :
   - `RESEND_API_KEY` — ta clé Resend
   - `RESEND_FROM` (optionnel) — une adresse `Nom <email@tondomaine.fr>` si tu as vérifié un domaine sur Resend ; sinon le relais utilise `onboarding@resend.dev` (fonctionne tout de suite, sans domaine à vérifier, mais moins pro pour les vrais clients).
6. Effet : le bouton "✉️ Email" sur les pages Devis et Factures envoie un vrai email au client. Sans ce secret configuré, le bouton affiche une erreur claire à l'utilisateur (pas d'échec silencieux ici, contrairement à l'IA — l'utilisateur doit savoir que l'envoi n'a pas eu lieu).

### 1f. Notifications push (rappels) — OneSignal, GRATUIT
1. https://onesignal.com → crée un compte gratuit → **New App** → plateforme **Web Push**, renseigne l'URL du site (`https://sebpromax.github.io/seba`).
2. Récupère l'**App ID** (Settings → Keys & IDs) → colle-le dans `docs/config.public.js` → `onesignalAppId` (public par design, comme la clé Supabase anon).
3. Toujours dans Keys & IDs, récupère la **REST API Key**.
4. Supabase → **Edge Functions** → **Deploy a new function**, nom `send-push`.
5. Colle le contenu de **`supabase-functions/send-push.ts`** → **Deploy**.
6. Edge Functions → **Secrets** → ajoute :
   - `ONESIGNAL_APP_ID` — le même App ID qu'à l'étape 2
   - `ONESIGNAL_API_KEY` — la REST API Key de l'étape 3
7. Effet : le bouton 🔔 dans la barre du dashboard permet à chaque utilisateur d'activer ses notifications (rien n'est envoyé sans ce geste explicite). `docs/OneSignalSDKWorker.js` est le petit fichier requis par OneSignal pour le service worker — déjà présent, rien à faire dessus.

### 1g. Capture d'erreurs (Sentry) — GRATUIT
1. https://sentry.io → crée un compte gratuit → **Create Project** → plateforme **Browser JavaScript**.
2. Copie le **DSN** affiché (ressemble à `https://xxxx@xxxx.ingest.sentry.io/xxxx`) → colle-le dans `docs/config.public.js` → `sentryDsn`.
3. Effet : les erreurs JS des pages Dashboard, Connexion et Inscription remontent automatiquement dans ton projet Sentry. Le DSN est public par design (comme la clé Supabase anon) — Sentry est fait pour ça.

### 1h. Analytics respectueux du RGPD (Umami) — GRATUIT
1. https://cloud.umami.is → crée un compte gratuit (100 000 événements/mois) → **Add website**.
2. Copie le **Website ID** → colle-le dans `docs/config.public.js` → `umamiWebsiteId`.
3. (Optionnel, si tu t'auto-héberges Umami plutôt que le cloud) : renseigne aussi `umamiScriptUrl` avec l'URL de ton instance.
4. Effet : Umami compte les visites des pages Dashboard, Connexion et Inscription sans cookies et sans données personnelles.

### 1i. Stockage de fichiers (Cloudflare R2) — pas encore branché
Pas de fonction dédiée pour l'instant : le stockage Supabase (1 Go gratuit) suffit tant que tu ne stockes pas de photos de chantier ou de PDF en masse. Si ça devient limitant, Cloudflare R2 (10 Go gratuits, zéro frais de sortie) est le candidat naturel — à activer seulement quand le besoin réel apparaît, pour ne pas ajouter de complexité inutile.

### 1j. Automatisation quotidienne (relances automatiques) — GRATUIT, sans serveur
Une fois par jour, `daily-digest.ts` regarde chaque compte : s'il y a des factures en retard ou des devis en attente, il demande une recommandation à l'IA (Mistral/Groq) et prévient le patron par email + push. Ne fait rien (aucun coût, aucun envoi) pour les comptes qui n'ont rien d'actionnable ce jour-là.

1. Supabase → **Edge Functions** → **Deploy a new function**, nom `daily-digest`.
2. Colle le contenu de **`supabase-functions/daily-digest.ts`** → **Deploy**. (Réutilise les secrets déjà configurés en 1b/1e/1f : `MISTRAL_API_KEY`/`GROQ_API_KEY`, `RESEND_API_KEY`, `ONESIGNAL_APP_ID`/`ONESIGNAL_API_KEY` — rien de nouveau à ajouter si tu as déjà fait ces étapes.)
3. Supabase → **Database → Extensions** → active `pg_cron` et `pg_net` (deux clics, gratuit, inclus dans Postgres).
4. Supabase → **SQL Editor** → **New query**, colle ceci en remplaçant `TA_CLE_SERVICE_ROLE` par ta clé **service_role** (Settings → API → `service_role` — ⚠️ jamais dans le repo, seulement ici, une fois, dans l'éditeur SQL) :
   ```sql
   select cron.schedule(
     'seba-daily-digest',
     '0 7 * * *', -- tous les jours à 7h UTC (8h/9h en France selon la saison)
     $$
     select net.http_post(
       url := 'https://ptmudezhxnhhyctowlqp.supabase.co/functions/v1/daily-digest',
       headers := jsonb_build_object('Authorization', 'Bearer TA_CLE_SERVICE_ROLE', 'Content-Type', 'application/json'),
       body := '{}'::jsonb
     );
     $$
   );
   ```
   → **Run**. C'est tout : la tâche planifiée est créée, aucun serveur à maintenir (Supabase l'exécute lui-même).
5. Pour vérifier que ça tourne : Supabase → **Database → Cron Jobs** affiche l'historique des exécutions.
6. Pour arrêter : `select cron.unschedule('seba-daily-digest');` dans le SQL Editor.

### 1k. Terrain, QA visuelle & alerting (Paliers 1-3, 07/2026) — GRATUIT

Trois briques livrées le 2026-07-09 (PR #32/#33/#34), 4 nouvelles Edge Functions à déployer en plus de celles ci-dessus :

1. **`employe-auth`** : login PIN 4 chiffres pour les employés de terrain sur une tablette partagée (deuxième couche d'identité au-dessus du compte patron). Supabase → Edge Functions → Deploy, nom `employe-auth`, colle **`supabase-functions/employe-auth.ts`**. Aucune nouvelle clé (réutilise Supabase URL/service_role déjà injectées automatiquement).
2. **`sync-push`** : reçoit les modifications en attente d'un appareil (patch par patch, pas le blob entier) et les applique. Déploie **`supabase-functions/sync-push.ts`** sous le nom `sync-push`, même principe, aucune clé supplémentaire.
3. **`vision-qa`** : analyse une photo de fin d'intervention avec Gemini Vision (conformité/non-conformité/incertain). Déploie **`supabase-functions/vision-qa.ts`** sous le nom `vision-qa` — réutilise **`GEMINI_API_KEY`** (déjà configurée en 1b si l'assistant IA est actif ; sinon, même étape que 1b : [ai.google.dev](https://ai.google.dev/) → clé gratuite → Secrets de la fonction).
4. **`notify-alert`** : relais de notification d'alerte (stub aujourd'hui — enregistre l'alerte, n'envoie pas encore d'email/push réel). Déploie **`supabase-functions/notify-alert.ts`** sous le nom `notify-alert`.
5. **`employe-set-pin`** *(ajouté 2026-07-16, module messagerie/espace terrain)* : permet au patron de définir/changer le PIN 4 chiffres d'un employé depuis `employe-fiche.html` (complète `employe-auth` ci-dessus, qui ne fait que le vérifier). Déploie **`supabase-functions/employe-set-pin.ts`** sous le nom `employe-set-pin`. Aucune nouvelle clé.

Pour que le bucket photo et le trigger d'alerte fonctionnent, `supabase-schema.sql` doit être exécuté en entier (voir Section 2 ci-dessous) — les fonctions ci-dessus ne suffisent pas seules. La table `seba_messages` (module messagerie, ajoutée 2026-07-16) fait aussi partie de `supabase-schema.sql` — si le schéma complet a déjà été exécuté avant cette date, rejoue au minimum **`migrations/20260716_create_seba_messages.sql`**.

**Espace Client** *(ajouté 2026-07-19)* : tables `client_accounts`/`client_requests` + fonctions RPC `link_client_account`/`get_my_client_profile`, plus une **réécriture des policies `seba_messages`** (un client authentifié a désormais son propre `auth.uid()`, distinct de celui du patron — l'ancienne policy `auth.uid() = user_id` seule ne suffit plus). Si le schéma complet a déjà été exécuté avant cette date, rejoue **`migrations/20260719_client_espace.sql`** — idempotent, sûr à rejouer même si une partie existe déjà. Aucune nouvelle Edge Function : tout passe par des RPC Postgres (`sebaAuth.rpc(...)`, même mécanisme que `create_profile_and_company` de l'onboarding).

---

## Section 2 — Base de données (tables + sécurité RLS)

Le fichier **`supabase-schema.sql`** (racine du projet) contient tout le schéma.

1. Supabase → **SQL Editor** → **New query**.
2. Ouvre `supabase-schema.sql`, copie TOUT le contenu, colle, **Run**.
3. Résultat : les tables `seba_state`, `clients`, `interventions`, `devis`, `factures`, `employes` sont créées **avec Row Level Security activée** — chaque utilisateur ne peut lire/écrire QUE ses propres lignes (`auth.uid() = user_id`). Le Patron A ne verra jamais les données du Patron B. La table `api_usage` (compteur de quota IA du relais `ai-relay`) est aussi créée — elle n'est accessible qu'via la clé `service_role`, jamais depuis le navigateur.

Note : le site utilise aujourd'hui la table `seba_state` (sauvegarde JSON du moteur `seba-data.js`). Les tables normalisées sont prêtes pour l'étape suivante sans rien changer aux pages.

### 2a. Prérequis Vault — notifications d'alerte (Palier 3, optionnel)

Le trigger `qa_photos_alert_trigger` (dans `supabase-schema.sql`) crée automatiquement une alerte dès qu'une photo est jugée `non_conforme`/`incertain`. **Sans l'étape ci-dessous, les alertes se créent normalement et restent visibles dans le tableau de bord — seule la notification (email/push, pas encore branchée de toute façon, voir 1k) reste silencieuse.** Rien ne casse si tu sautes cette étape ; à faire quand tu veux activer la notification pour de vrai.

1. Supabase → **SQL Editor** → **New query**, colle en remplaçant les deux valeurs :
   ```sql
   select vault.create_secret('https://TON-PROJET.supabase.co', 'project_url');
   select vault.create_secret('TA_CLE_SERVICE_ROLE', 'service_role_key');
   ```
   (URL et clé **service_role** : Settings → API — ⚠️ jamais dans le repo, seulement ici, une fois.)
2. **Run**. C'est tout — le trigger retrouve les deux secrets automatiquement à chaque nouvelle alerte.
3. Pour désactiver sans tout redéployer : voir les commandes "Panic Button" dans `AUDIT-GO-LIVE-SEBA.md`.

---

## Section 3 — Maintenance & évolutions

- **Déploiement** : chaque `git push` sur `main` publie le site (GitHub Pages sert le dossier `docs/`). ⚠️ Le pipeline Pages de ce repo cale parfois : si le site ne se met pas à jour après ~5 min, re-sauvegarde la config dans Settings → Pages, ou pousse un commit vide.
- **PWA** : après un déploiement, le service worker (`docs/sw.js`) se met à jour au 2ᵉ chargement. Pour forcer : incrémente `VERSION` dans `sw.js`.
- **Sauvegardes utilisateur** : Réglages → Compte → « Données & sauvegarde » (export/import JSON). À faire régulièrement tant que Supabase n'est pas branché.
- **Debug sans console** (mobile inclus) : **Ctrl + Alt + L** sur le dashboard ouvre le log système (toutes les erreurs JS capturées).
- **Ajouter un widget au dashboard** : une entrée dans `WIDGET_CATALOG` (`docs/widgets.js`) suffit — id, titre, taille S/M/L/XL, mots-clés (pour la barre IA) et `render()`.
- **Prochaine grosse étape** (voir `strategie/plan-marche-produit-2026.md`) : interviews terrain, puis migration de l'adaptateur `seba-data.js` vers les tables normalisées, puis proxy serveur pour la clé Groq et Stripe Checkout serveur.

## Récapitulatif des fichiers importants
| Fichier | Rôle |
|---|---|
| `docs/config.example.js` | Modèle des clés → copier en `config.js` |
| `supabase-schema.sql` | Schéma DB + RLS à coller dans Supabase |
| `docs/seba-data.js` | Moteur de données (adaptateur local/Supabase) |
| `docs/auth.js` / `docs/guard.js` | Authentification + verrou du dashboard |
| `docs/ai-assistant.js` | Assistant IA (Groq ou analyste local) |
| `docs/stripe-service.js` | Paiements (Payment Links) |
| `docs/sw.js` / `docs/manifest.json` | PWA (installable + hors-ligne) |
| `docs/photo-manager.js` | Capture photo terrain + envoi à `vision-qa` |
| `docs/dashboard-alerts.js` | Tableau de bord des alertes QA (`alert_logs`) |
| `docs-backend.md` | Architecture données en détail |
| `release-notes-seba.md` | Historique des livraisons |
| `PLAN.md` / `PROGRESS.md` | Roadmap produit + journal d'exécution technique |
| `AUDIT-GO-LIVE-SEBA.md` | Audit sécurité/résilience + commandes "Panic Button" |
