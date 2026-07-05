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

### 1b. Groq (assistant IA du dashboard) — GRATUIT
1. Va sur https://console.groq.com → **API Keys** → **Create API Key**.
2. Colle la clé (`gsk_…`) dans `groqApiKey`.
3. Effet : le bouton 🤖 du dashboard passe de "analyste local" à une vraie IA qui analyse tes données (elle reçoit un résumé JSON de tes chiffres réels).
   ⚠️ Cette clé est **secrète** : c'est pour cela que `config.js` n'est jamais commité. Pour un produit public, il faudra la déplacer derrière un petit proxy serveur (voir Section 3).

### 1c. Stripe (paiements) — GRATUIT jusqu'à la 1re vente
1. Va sur https://dashboard.stripe.com → **Développeurs → Clés API** :
   - **Clé publiable** (`pk_test_…` puis `pk_live_…`) → `stripePublicKey`
2. Crée un **Payment Link** (menu Liens de paiement → + Nouveau) pour ton abonnement Seba → colle l'URL dans `stripePaymentLink`.
3. Effet : le bouton du plan Pro sur la page Tarifs ouvre ton paiement réel ; le bouton "💳 Lien" des factures copie un lien Stripe avec la référence de la facture (`client_reference_id`) pour le rapprochement.
   ⚠️ Ne mets JAMAIS une clé `sk_…` (secrète) dans le site.

---

## Section 2 — Base de données (tables + sécurité RLS)

Le fichier **`supabase-schema.sql`** (racine du projet) contient tout le schéma.

1. Supabase → **SQL Editor** → **New query**.
2. Ouvre `supabase-schema.sql`, copie TOUT le contenu, colle, **Run**.
3. Résultat : les tables `seba_state`, `clients`, `interventions`, `devis`, `factures`, `employes` sont créées **avec Row Level Security activée** — chaque utilisateur ne peut lire/écrire QUE ses propres lignes (`auth.uid() = user_id`). Le Patron A ne verra jamais les données du Patron B.

Note : le site utilise aujourd'hui la table `seba_state` (sauvegarde JSON du moteur `seba-data.js`). Les tables normalisées sont prêtes pour l'étape suivante sans rien changer aux pages.

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
| `docs-backend.md` | Architecture données en détail |
| `release-notes-seba.md` | Historique des livraisons |
