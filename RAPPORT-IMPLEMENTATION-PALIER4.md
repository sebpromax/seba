# Rapport d'implémentation — Palier 4 : Agents intelligents & mémoire vectorielle

*Rédigé le 2026-07-09. Périmètre : initialisation de l'infrastructure (schéma SQL, config agents, cœur `conscience-seba.ts`), pas une intégration complète dans les Edge Functions déjà en production — voir "Ce qui n'est PAS fait" en fin de document.*

## Écarts corrigés par rapport au brief initial

1. **`vector(1024)`, pas `vector(1536)`.** 1536 est la dimension d'OpenAI (`text-embedding-3-small`/`ada-002`) — aucune clé OpenAI n'existe nulle part dans ce projet (vérifié par recherche exhaustive). `mistral-embed` (1024 dimensions) était déjà le choix documenté dans `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md`, et `MISTRAL_API_KEY` est déjà provisionnée pour `ai-relay.ts`/`daily-digest.ts` — suivre 1536 à la lettre aurait introduit un fournisseur non configuré pour rien.
2. **Colonne `account` ajoutée à `memoire_embeddings`.** Le brief demandait une RLS "par account_id (jointure nécessaire)", mais la table telle que spécifiée (`id, intervention_id, content, embedding, metadata, created_at`) n'a aucune colonne vers laquelle joindre : `intervention_id` (format `id_xxxxx`, Pilier 4) vit dans le blob `seba_state`, ce n'est pas une ligne réelle d'une table `interventions`. Sans colonne `account` directe, aucune policy RLS n'est écrivable. Ajoutée, exactement comme sur `sync_operations`/`qa_photos`/`alert_logs`.
3. **`match_interventions()` a un paramètre `p_account` explicite**, absent de la signature demandée. Sans lui, la fonction — appelée par `conscience-seba.ts` via `service_role`, qui contourne RLS par nature — laisserait n'importe quel compte remonter les embeddings de n'importe quel autre par similarité : une fuite multi-tenant totale, pas un détail. `p_account` est résolu côté serveur à partir du JWT de l'appelant, jamais accepté tel quel depuis un corps de requête.
4. **`match_interventions()` restreinte par `REVOKE EXECUTE`** (même défense en profondeur que les 4 fonctions du Palier 3, voir `AUDIT-GO-LIVE-SEBA.md`) — appelée exclusivement en interne, jamais directement par un client.

## Stratégie de cache (`ai_context_hash`) — détail demandé

**Principe** : le contexte envoyé à un LLM est d'abord **construit** (`buildStructuredContext()`, borné en nombre d'éléments par liste, jamais tronqué à l'aveugle — corrige au passage le `.slice(0, 2000|4000)` de `ai-relay.ts`, une troncature de chaîne qui peut produire un JSON invalide). Le hash SHA-256 de ce contexte construit (`JSON.stringify` déterministe sur un objet aux clés déjà fixes) sert de clé de cache, jamais un hash du texte brut ou de la question posée.

**Clé de cache** : `(account, agent, context_hash)` — composite, pas juste `context_hash` seul : deux comptes différents avec un contexte structurellement identique (ex. `{facturesEnRetard: 3, devisEnAttente: 1}`) ne doivent jamais partager une réponse, même si elle serait textuellement correcte pour les deux (fuite d'information involontaire entre comptes via un cache partagé).

**Lecture avant tout appel LLM** : `withContextCache()` consulte `ai_context_hash` en premier ; si une ligne existe pour `(account, agent, hash)`, la réponse est retournée sans aucun appel réseau vers Mistral/Groq. `compute()` (qui contient l'appel LLM réel) n'est invoqué qu'en l'absence de correspondance.

**Écriture après calcul** : uniquement si `compute()` retourne un résultat non-null (jamais de cache d'un échec — un `null` ne doit pas empêcher une nouvelle tentative au prochain appel). Écriture en `upsert`, best-effort (un échec d'écriture du cache est loggé mais ne fait jamais échouer l'appelant, qui a déjà sa réponse).

**Pas de TTL actif dans le schéma** (pas de colonne `expires_at`, pas de job de purge) — la table grandit tant que rien ne la vide. `product-agents.config.json` documente une intention (`cacheTtlHours: 20`) mais **aucun mécanisme ne l'applique encore** — à traiter avant une mise à l'échelle réelle (purge par cron, ou contrainte d'unicité remplacée par un upsert qui écrase après N heures). Noté dans "Ce qui n'est PAS fait".

**RLS `ai_context_hash`** : activée **sans aucune policy** (même pattern que `api_usage`/`employe_credentials`) — le cache peut contenir des extraits de données métier, jamais exposé en lecture même au propriétaire du compte, qui n'a de toute façon aucun besoin d'y accéder directement.

## Découplage du calcul d'embeddings

`supabase-functions/embed-content.ts` répond `202 Accepted` immédiatement après validation du body, puis termine le calcul (`mistral-embed` + écriture dans `memoire_embeddings`) via `EdgeRuntime.waitUntil()` — l'API réelle du runtime Supabase Edge Functions pour ce pattern "répondre maintenant, terminer après" (pas une fonctionnalité Deno standard, d'où la vérification défensive `typeof EdgeRuntime !== 'undefined'` avant utilisation, avec repli sur un `await` classique si absent — utile pour que le fichier reste exécutable dans un contexte de test sans ce global).

## Tests

**Non exécutés dans cet environnement** — aucun CLI Deno disponible ici, même limite déjà rencontrée pour toutes les autres Edge Functions du projet (voir `AUDIT-GO-LIVE-SEBA.md` sur `pg_net`/Vault). `supabase-functions/_shared/conscience-seba.test.ts` est un vrai fichier `Deno.test`, prêt à lancer (`deno test supabase-functions/_shared/conscience-seba.test.ts`) dès qu'un environnement Deno est disponible (CI ou poste local).

**Portée réelle de ces tests** : ils vérifient le contrat TypeScript via un client Supabase mocké — en particulier que `lookupHistory()` transmet exactement le `p_account` de l'appelant courant à `match_interventions()`, et que les résultats d'un autre compte simulé ne fuitent jamais. **Ils ne testent pas la RLS ni la fonction SQL elle-même**, qui exigent un vrai Postgres/pgvector — celles-ci restent vérifiées par relecture (section "Écarts corrigés" ci-dessus), pas exécutées.

## Ce qui n'est PAS fait (infrastructure seule, pas une intégration complète)

- **Aucune route HTTP dédiée pour `assistant_technique`** — `product-agents.config.json` déclare l'agent et ses 3 outils (`lookup_history`, `analyze_compliance`, `summarize_tech_notes`), mais seul `lookup_history` a une implémentation réelle (`conscience-seba.ts::lookupHistory`). `analyze_compliance`/`summarize_tech_notes` restent des entrées de config sans code derrière.
- **`client_memoire`** (résumé incrémental par client, documenté dans `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md`) — non créée ici. Le brief de ce palier ne demandait que `memoire_embeddings`, pas cette table complémentaire.
- **Aucun déclenchement automatique** de `embed-content.ts` depuis `vision-qa.ts`/les notes techniques — la fonction existe et fonctionne isolément, mais rien ne l'appelle encore dans le flux applicatif réel.
- **Purge/TTL de `ai_context_hash`** — voir section cache ci-dessus.
- **`ai-relay.ts`/`daily-digest.ts` n'utilisent pas encore `conscience-seba.ts`** — la duplication de prompt entre les deux (déjà notée dans `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md`, section Grok) n'est pas éliminée par cette initialisation ; `conscience-seba.ts` existe mais n'est consommé par aucune fonction déployée pour l'instant.

Ces points restent dans `PLAN.md` (P4) tant qu'ils ne sont pas traités.
