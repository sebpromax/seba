# Clés à configurer — CARTE (aucune vraie clé ici)

> ⚠️ **CE FICHIER NE CONTIENT AUCUNE VRAIE CLÉ, ET N'EN CONTIENDRA JAMAIS.**
> Le dépôt est **public** (GitHub Pages). Une vraie clé committée = fuite définitive
> (elle reste dans l'historique git même après suppression).
> Ce doc dit seulement **où** coller chaque clé. Les vraies valeurs vont dans les
> cibles gitignorées / le dashboard Supabase / la config de ton client MCP — **jamais ici.**
>
> Détail pas-à-pas de chaque clé : `MANUEL-SEBA-ADMIN.md` section 1.

---

## 1. Front — fichier local `docs/config.js` (GITIGNORÉ, sur ta machine)

Copie `docs/config.example.js` en `docs/config.js`, puis remplis-y les vraies valeurs.
Ce fichier n'est jamais committé (`.gitignore`).

| Clé | Où l'obtenir | Statut |
|---|---|---|
| `groqApiKey` (`gsk_…`) | console.groq.com → API Keys | [ ] |
| `stripePublicKey` (`pk_live_…` / `pk_test_…`) | dashboard.stripe.com → Développeurs → Clés API | [ ] |
| `stripePaymentLink` (URL) | Stripe → Liens de paiement | [ ] |

> ⚠️ **Jamais** de clé Stripe secrète (`sk_…`) ni de service_role côté front.

## 2. Front — `docs/config.public.js` (COMMITTÉ, public par design — PAS de secret)

Déjà en place, valeurs publiques uniquement (URL Supabase + clé publishable, IDs OneSignal/Sentry/Umami). Rien de secret à y mettre.

## 3. Backend — Supabase → Edge Functions → Secrets (dashboard, hors repo)

À saisir dans l'interface Supabase, pas dans un fichier. Une seule suffit pour que la cascade IA marche (les autres sont sautées).

| Secret | Où l'obtenir | Statut |
|---|---|---|
| `MISTRAL_API_KEY` | console.mistral.ai → API Keys | [ ] |
| `GROQ_API_KEY` | console.groq.com → API Keys | [ ] |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys | [ ] |
| `GEMINI_API_KEY` | aistudio.google.com/apikey (ne jamais activer la facturation) | [ ] |
| `RESEND_API_KEY` + `RESEND_FROM` | resend.com → API Keys | [ ] |
| `ONESIGNAL_APP_ID` + `ONESIGNAL_API_KEY` | onesignal.com | [ ] |
| `MAX_DAILY_REQUESTS` (optionnel, défaut 50) | disjoncteur de coût global | [ ] |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | injectés automatiquement par Supabase | auto |
| Vault : `project_url` + `service_role_key` | prérequis alertes pg_net, `MANUEL-SEBA-ADMIN.md` §2a | [ ] |

## 4. Orchestrateur de dev — fichier local `.env` (GITIGNORÉ)

Utilisé par `tools/orchestrator.js` / `chaos-monkey.js` (`--env-file=.env`). Copie `.env.example` en `.env`.

| Clé | Statut |
|---|---|
| `GEMINI_API_KEY` | [ ] |
| `GROQ_API_KEY` | [ ] |
| `MISTRAL_API_KEY` | [ ] |

## 5. Outil de dev — `@21st-dev/magic-mcp` (config de TON client MCP, hors repo)

Clé depuis https://21st.dev/settings/api-keys. À installer **dans ton propre terminal**, jamais dans ce chat :

```
npx @21st-dev/cli@latest install <client> --api-key <ta-clé>
```

`<client>` = `cursor` / `windsurf` / `cline` / `claude`. La clé s'écrit dans la config MCP de ton client, sur ta machine — rien à committer.

| Élément | Statut |
|---|---|
| Clé 21st.dev installée dans le client MCP | [ ] |

---

**Rappel final :** tu remplis les vraies valeurs dans `docs/config.js`, `.env`, le dashboard Supabase et ton client MCP — **jamais dans ce fichier ni aucun autre fichier committé.**
