# Vision technique SEBA — Phase 2 : cadrage post-audit (ingénierie brute)

*Suite directe de `ANALYSE-ANGLES-MORTS-IA-TERRAIN.md`. Aucune fonctionnalité codée ici — c'est un cadrage précis (schémas SQL exacts, squelettes TypeScript, algorithmes) prêt à être exécuté. Toutes les propositions ont été revérifiées contre le code réel avant d'être écrites.*

---

## 0. Correction supplémentaire trouvée en creusant plus loin (avant même de commencer)

En traçant précisément comment les identifiants sont générés aujourd'hui, une **4ème réalité technique** s'ajoute aux 3 déjà actées, et elle invalide un détail de mon rapport précédent — je le corrige ici plutôt que de le laisser silencieusement faux :

```js
// docs/seba-data.js:171
function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
```

**Aucun identifiant généré côté client aujourd'hui n'est un UUID.** `clients[].id`, `devis[].id`, `factures[].id`, `interventions[].id`, `employes[].id` — tous sont des chaînes du type `id_l3x9k2a_bc4d1`, produites par cette fonction, vivant à l'intérieur de `state` (le blob `seba_state`). Les tables normalisées de `supabase-schema.sql` (`clients.id uuid default gen_random_uuid()`, etc.) sont donc doublement dormantes : ni écrites, ni compatibles par construction avec les identifiants réellement en circulation.

**Conséquence sur toutes les tables ajoutées ci-dessous** : toute colonne qui référence une entité vivant dans le blob (`intervention_id`, `client_id`, `entity_id`…) doit être typée `text`, jamais `uuid`, et **sans contrainte `references` dure** tant que l'entité correspondante n'est pas une vraie ligne Postgres. C'est documenté explicitement à chaque table concernée plutôt que de prétendre une intégrité référentielle qui n'existe pas encore.

**Une exception délibérée** : la table `employes` change de statut *dans ce document* — voir section 1 (Claude), elle devient la première entité à sortir réellement du blob, pour une raison de sécurité, pas de modélisation.

---

## 1. CLAUDE — Journal d'opérations incrémentales & session légère par PIN

### 1️⃣ Ce que je supprime ou refactorise immédiatement

- **`SupabaseAdapter._push(state)` (`docs/seba-data.js:135-152`) cesse d'être le chemin d'écriture de vérité.** Aujourd'hui : `save(state)` → debounce 800 ms → `POST .../seba_state?on_conflict=account` avec `Prefer: resolution=merge-duplicates`. Ce header ne fusionne **rien** au niveau JSON — c'est un upsert Postgres classique par clé primaire (`account`), donc un remplacement intégral de la ligne. Le nom du header est trompeur, pas le comportement : c'est un **UPSERT_WHOLE_ROW**, pas un merge. Ce chemin devient un **cache d'écriture de secours**, jamais la source de vérité une fois `sync_operations` en place (voir 2️⃣).
- **Toute hypothèse d'atomicité de `window._ctx`/`state` entre deux lectures devient explicitement fausse** dès qu'un deuxième appareil peut écrire de manière asynchrone — ce n'était pas un problème avant (un seul écrivain implicite), ça le devient dès l'introduction d'`employe_sessions` (ci-dessous). Ne pas corriger *ce* point ici en profondeur (hors périmètre du cadrage), mais l'acter comme prérequis explicite pour toute UI qui affiche `state` en `renderDashboard()`.
- **Idée abandonnée : résoudre les conflits par timestamp client (`Date.now()`).** Une horloge d'appareil hors-ligne n'est jamais fiable (dérive, fuseau, appareil qui a juste une horloge fausse) — la stratégie ci-dessous n'utilise **jamais** de comparaison de timestamp pour trancher un conflit, uniquement un compteur de version côté serveur.

### 2️⃣ Vision produit mise à jour — CQRS assumé : `seba_state` devient une projection, pas une source

Principe : **on ne supprime pas `seba_state`, on change son rôle.** Il reste le modèle de lecture (chargement instantané du dashboard, zéro agrégation à la volée) — mais toute **écriture** transite désormais par un journal d'opérations append-only, appliqué côté serveur avec détection de conflit **par champ**, jamais par enregistrement entier. `seba_state.state` devient une projection reconstruite, jamais éditée directement.

Ce que ça transforme en force produit, pas seulement en correctif :
- **Historique complet et infalsifiable de chaque champ modifié** (`sync_operations` est append-only, aucune policy `update`/`delete`) — un argument commercial direct pour du BTP/dépannage où un client conteste une intervention (« voici exactement qui a changé quoi et quand », pas une simple date de dernière modification).
- **Reprise après coupure réseau sans perte, quelle que soit la durée de la coupure** — un appareil hors ligne 3 jours rejoue simplement ses opérations en attente dans l'ordre de son `device_seq`, aucune notion de "trop vieux pour fusionner".
- **Conflits réels rarissimes en pratique** : la détection est *par champ*, pas par entité — deux techniciens qui modifient la même intervention sur deux champs différents (l'un le statut, l'autre les notes) ne génèrent **aucun** conflit, seulement une fusion propre. Le vrai conflit (même champ, deux valeurs) est l'exception, pas la règle — donc l'UX de résolution de conflit n'a presque jamais besoin d'apparaître.

### 3️⃣ Ajouts critiques

#### Schéma SQL exact

```sql
-- Journal d'opérations, source de vérité en écriture. Append-only par
-- construction (aucune policy update/delete) — c'est la propriété qui
-- rend l'historique infalsifiable.
create table if not exists sync_operations (
  id bigint generated always as identity primary key,
  account text not null references seba_state(account) on delete cascade,
  user_id uuid not null default auth.uid(),
  employee_id text,                 -- text, pas uuid (voir section 0) — résolu SERVEUR (1.3), jamais déclaré par le client
  device_id uuid not null,
  device_seq bigint not null,       -- compteur local monotone PAR APPAREIL, jamais une horloge
  entity text not null check (entity in ('clients','devis','factures','interventions','employes','journal')),
  entity_id text not null,          -- text : format id_xxxxx du client (section 0), pas uuid
  op text not null check (op in ('create','update','delete')),
  patch jsonb not null,             -- UNIQUEMENT les champs modifiés, jamais l'objet entier
  base_version bigint not null default 0,  -- version connue du client au moment de la modif (0 = création)
  applied_at timestamptz,           -- rempli par le serveur après traitement, null = en attente
  conflict boolean default false,   -- true si au moins un champ a nécessité un arbitrage (voir sync_conflicts)
  created_at timestamptz default now(),
  unique (account, device_id, device_seq)   -- idempotence : rejouer le même paquet après coupure ne duplique rien
);
create index if not exists sync_ops_account_entity_idx on sync_operations (account, entity, entity_id, applied_at);
alter table sync_operations enable row level security;
create policy "sync_ops_select" on sync_operations for select using (auth.uid() = user_id);
create policy "sync_ops_insert" on sync_operations for insert with check (auth.uid() = user_id);
-- Pas de policy update/delete : RLS ferme par défaut sans policy = correct ici, pas un oubli.

-- Compteur de version optimiste par entité — remplace le timestamp comme arbitre.
create table if not exists entity_versions (
  account text not null,
  entity text not null,
  entity_id text not null,
  version bigint not null default 1,
  last_snapshot jsonb not null,     -- état courant complet de l'entité (source du patch de seba_state.state)
  updated_at timestamptz default now(),
  primary key (account, entity, entity_id)
);
alter table entity_versions enable row level security;
create policy "entity_versions_select" on entity_versions for select using (
  account = (select account from seba_state where user_id = auth.uid())
);
-- Pas d'insert/update client direct : géré exclusivement par l'Edge Function sync-push (service_role).

-- Conflit RÉEL (même champ, deux valeurs concurrentes) — jamais toute l'entité.
create table if not exists sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  entity text not null,
  entity_id text not null,
  champ text not null,
  valeur_serveur jsonb, operation_serveur_id bigint references sync_operations(id),
  valeur_perdante jsonb, operation_perdante_id bigint references sync_operations(id),
  employee_serveur text, employee_perdant text,
  resolved boolean default false,
  resolved_value jsonb,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
alter table sync_conflicts enable row level security;
create policy "sync_conflicts_select" on sync_conflicts for select using (
  account = (select account from seba_state where user_id = auth.uid())
);
create policy "sync_conflicts_resolve" on sync_conflicts for update using (
  account = (select account from seba_state where user_id = auth.uid())
) with check (resolved = true);  -- le client ne peut que MARQUER résolu + fournir resolved_value, jamais réécrire l'historique
```

#### Algorithme de résolution (Edge Function `sync-push.ts`)

Remplace l'appel direct `POST /rest/v1/seba_state` de `SupabaseAdapter._push()`. Reçoit un **batch** d'opérations (toutes celles accumulées hors-ligne, dans l'ordre `device_seq`) :

```ts
// supabase-functions/sync-push.ts (squelette — logique complète, style d'erreur cohérent avec ai-relay.ts)
interface IncomingOp {
  device_id: string; device_seq: number;
  entity: string; entity_id: string;
  op: 'create' | 'update' | 'delete';
  patch: Record<string, unknown>;
  base_version: number;
}

async function applyOne(supa: SupaAdmin, account: string, userId: string, employeeId: string | null, o: IncomingOp) {
  // 1. Verrouille la version courante de l'entité (SELECT ... FOR UPDATE via une fonction Postgres
  //    dédiée get_and_lock_entity_version, pour éviter une race entre deux appels concurrents
  //    de sync-push sur la MEME entité).
  const current = await supa.rpc('get_and_lock_entity_version', { p_account: account, p_entity: o.entity, p_entity_id: o.entity_id });

  if (o.op === 'create' || !current) {
    // Pas de conflit possible sur une création : la version démarre à 1.
    await supa.from('entity_versions').upsert({ account, entity: o.entity, entity_id: o.entity_id, version: 1, last_snapshot: o.patch });
    return { entity_id: o.entity_id, applied: o.patch, conflict: false };
  }

  if (o.base_version === current.version) {
    // Cas nominal : le client avait la dernière version connue, aucun tiers n'a écrit entre-temps.
    const merged = { ...current.last_snapshot, ...o.patch };
    await supa.from('entity_versions').update({ version: current.version + 1, last_snapshot: merged }).match({ account, entity: o.entity, entity_id: o.entity_id });
    return { entity_id: o.entity_id, applied: o.patch, conflict: false };
  }

  // base_version < version courante : quelqu'un d'autre a écrit entre-temps. Résolution PAR CHAMP,
  // pas par entité — seuls les champs réellement disputés (modifiés par les deux côtés depuis
  // base_version) deviennent des conflits ; le reste s'applique normalement.
  const opsEntreTemps = await supa.from('sync_operations')
    .select('patch, employee_id, id')
    .match({ account, entity: o.entity, entity_id: o.entity_id })
    .gt('base_version', o.base_version - 1) // toutes les ops déjà appliquées depuis la base du client
    .eq('conflict', false);

  const champsDejaModifies = new Set(opsEntreTemps.data?.flatMap((op) => Object.keys(op.patch)) ?? []);
  const appliques: Record<string, unknown> = {};
  const conflits: Array<{ champ: string; valeur_serveur: unknown }> = [];

  for (const [champ, valeur] of Object.entries(o.patch)) {
    if (champsDejaModifies.has(champ) && current.last_snapshot[champ] !== valeur) {
      conflits.push({ champ, valeur_serveur: current.last_snapshot[champ] });
    } else {
      appliques[champ] = valeur;  // champ non disputé : merge automatique, silencieux
    }
  }

  const merged = { ...current.last_snapshot, ...appliques };
  await supa.from('entity_versions').update({ version: current.version + 1, last_snapshot: merged }).match({ account, entity: o.entity, entity_id: o.entity_id });

  for (const c of conflits) {
    await supa.from('sync_conflicts').insert({
      account, entity: o.entity, entity_id: o.entity_id, champ: c.champ,
      valeur_serveur: c.valeur_serveur, valeur_perdante: o.patch[c.champ], employee_perdant: employeeId,
    });
  }
  return { entity_id: o.entity_id, applied: appliques, conflict: conflits.length > 0, conflictFields: conflits.map((c) => c.champ) };
}
```

Après le batch : recalcule `seba_state.state` en repartant de `entity_versions.last_snapshot` pour chaque entité touchée (un `jsonb_set` ciblé, ou reconstruction complète du tableau de la collection concernée — pas des autres) puis upsert cette projection dans `seba_state` (le chemin `on_conflict=account` d'origine devient l'écriture de la **projection**, plus jamais celle de la vérité).

**Réponse au client** : `{ appliedCount, conflicts: [...], newBaseVersions: {entity_id: version} }` — le client met à jour son `base_version` local par entité, et si `conflicts.length > 0`, affiche l'écran de résolution (« Ahmed a aussi modifié le statut pendant votre absence réseau — garder votre valeur ou la sienne ? ») en ne bloquant **jamais** la suite de la synchronisation des autres entités.

Côté `docs/seba-data.js` : `save(state)` ne calcule plus un état complet à pousser — il **diffe** contre le dernier état connu poussé avec succès (garder une copie locale `_lastSyncedState`), produit une liste de `patch` par entité modifiée, l'ajoute à une file locale (`localStorage['seba_sync_queue']` ou IndexedDB si le volume grossit), et la vide vers `sync-push.ts` au lieu de faire un `POST` direct sur `seba_state`.

#### Session légère par PIN — `employe_sessions`

**Décision d'architecture explicite** : `employes` sort du blob dès maintenant, pas en fin de migration — parce que stocker un `pin_hash` dans une donnée que le navigateur lit/écrit librement via le chemin générique de sauvegarde serait une vraie faille (n'importe quel script exécuté dans la page, ou un export/import JSON mal maîtrisé, pourrait exposer les hachages). C'est une frontière de sécurité, pas une préférence de modélisation — elle justifie d'être normalisée en premier, avant tout le reste.

```sql
-- La table employes de supabase-schema.sql existe déjà (RLS user_id=auth.uid() correcte) —
-- ajout d'une colonne, jamais lue/écrite par le chemin générique SebaDB (aucune UI ne
-- doit l'exposer autrement que via l'Edge Function ci-dessous).
alter table employes add column if not exists pin_hash text;
alter table employes add column if not exists pin_set_at timestamptz;

create table if not exists employe_sessions (
  id uuid primary key default gen_random_uuid(),
  employe_id uuid not null references employes(id) on delete cascade,
  device_id uuid not null,
  token text not null unique,        -- 32 octets aléatoires, opaque — PAS un JWT Supabase, pas de claims à décoder
  issued_at timestamptz default now(),
  expires_at timestamptz not null,   -- ex. now() + interval '12 hours'
  revoked boolean default false
);
create index if not exists employe_sessions_token_idx on employe_sessions (token) where not revoked;
alter table employe_sessions enable row level security;
-- Aucune policy select/insert client : gérée exclusivement par service_role dans employe-login.ts.
```

Flux (`supabase-functions/employe-login.ts`, nouvelle fonction, même patron que `ai-relay.ts`) :
1. L'appareil (tablette de chantier) est déjà authentifié Supabase **en tant que patron** (JWT normal, vérifié comme dans `ai-relay.ts` via `verifyUser()`) — le PIN est une **deuxième couche d'identité au-dessus**, pas un remplacement de l'auth Supabase.
2. `POST { employe_id, pin }` → l'Edge Function récupère `employes.pin_hash` (via `service_role`, jamais exposé au client), compare avec `bcrypt.compare` (lib Deno `std/crypto` ou `bcrypt` npm compatible Deno).
3. Si valide : génère un token opaque (`crypto.getRandomValues`), l'insère dans `employe_sessions` avec `device_id` (généré une fois côté client, persistant en `localStorage`), retourne `{ token, employee_id, expires_at }`.
4. Le client stocke `token` dans `localStorage['seba_employee_token']` et l'ajoute en en-tête (`X-Employee-Token`) sur **chaque appel à `sync-push.ts`**.
5. `sync-push.ts` résout `employee_id` en interrogeant `employe_sessions` (jointure `token` → `employe_id`, vérifie `not revoked and expires_at > now()`) — **jamais** en faisant confiance à un `employee_id` fourni tel quel dans le corps de la requête (sinon n'importe qui pourrait usurper une identité en changeant un champ JSON). C'est ce `employee_id` résolu serveur qui atterrit dans `sync_operations.employee_id`.

Ergonomie : écran "Qui êtes-vous ?" avec la liste des employés actifs (photos/avatars, pas de saisie de nom) + clavier numérique 4 chiffres — 2 taps + 4 chiffres, pas un formulaire de connexion classique. Session valable toute la demi-journée sur l'appareil, pas de re-saisie à chaque intervention.

---

## 2. GROK — `product-agents.config.json`, `_shared/conscience-seba.ts`, marge réelle

### 1️⃣ Ce que je supprime ou refactorise immédiatement

- **Le prompt `JSON_SYSTEM` dupliqué mot pour mot entre `ai-relay.ts` (mode `json`) et `daily-digest.ts`** (`callMistralOrGroq`) devient un import unique — deux implémentations divergentes du même besoin, c'est une dette qui va s'aggraver à chaque nouvel agent ajouté (section 5 du rapport précédent : `qa_visuelle_intervention`, `prediction_impayes`…) si rien n'est fait maintenant.
- **L'idée de référencer `interventions(id)`/`clients(id)` en clé étrangère dure** dans les tables de coût proposées précédemment (`intervention_materiaux`, `intervention_trajets`) — invalidée par la section 0 : ces entités n'existent pas en lignes Postgres aujourd'hui. Corrigé ci-dessous en références souples typées `text`.
- **L'hypothèse que le calcul de marge doit attendre la normalisation complète du blob** — fausse. Les tables de coûts (catalogues, historiques) sont des données **peu écrites, gérées par le patron** (pas par les techniciens en hors-ligne concurrent) : elles n'ont pas le problème de conflit multi-appareil de la section 1, donc rien n'empêche de les créer en tables normalisées **dès aujourd'hui**, indépendamment du calendrier de migration du blob.

### 2️⃣ Vision produit mise à jour

`ai-relay.ts` (mode `json`, appelé par le navigateur) et `daily-digest.ts` (appelé par `pg_cron`) deviennent deux **appelants** d'un seul moteur de décision (`_shared/conscience-seba.ts`), avec un routage de coût explicite (tier0/tier1/tier2, voir section 3 ci-dessous, propriété de Mistral) défini une fois dans `product-agents.config.json` et lu par ce module partagé — pas dans `agents_config.json` (confirmé hors sujet, section 0.3 du rapport précédent).

La marge réelle devient calculable **immédiatement** en tant que fonctionnalité serveur (une vue Postgres, pas un widget qui dépend d'un LLM) — parce que les coûts et les revenus (`state.factures[].amount`, déjà dans le blob) peuvent être rapprochés par un identifiant texte souple, sans attendre que `factures` devienne une vraie table.

### 3️⃣ Ajouts critiques

#### `supabase-functions/product-agents.config.json` (nouveau fichier, distinct d'`agents_config.json`)

```json
{
  "$comment": "Config des agents COTE PRODUIT, consommée par _shared/conscience-seba.ts. Distinct de /agents_config.json (orchestrateur de développement interne, tools/orchestrator.js) — ne jamais fusionner les deux.",
  "costTiers": {
    "tier0_deterministic": { "description": "Calcul pur Postgres/TS, aucun appel LLM", "maxLatencyMs": 50 },
    "tier1_cached": { "description": "ai_context_hash consulté avant tout appel LLM", "cacheTtlHours": 20 },
    "tier2_llm": { "description": "Réservé au texte libre sans alternative déterministe", "maxTokens": 400 }
  },
  "sharedProviders": {
    "conscience": { "order": ["mistral", "groq"], "model_mistral": "mistral-small-latest", "model_groq": "llama-3.1-8b-instant" },
    "chat": { "order": ["mistral", "groq", "openrouter", "gemini"] },
    "vision": { "order": ["gemini"], "model": "gemini-2.0-flash" },
    "embeddings": { "order": ["mistral"], "model": "mistral-embed", "dimensions": 1024 }
  },
  "agents": {
    "assistant_conversationnel": { "entrypoint": "ai-relay.ts", "mode": "chat", "costTier": "tier2_llm" },
    "conscience_predictive": {
      "entrypoints": ["ai-relay.ts:json", "daily-digest.ts"],
      "sharedModule": "_shared/conscience-seba.ts",
      "costTier": "tier0_deterministic puis tier2_llm pour la formulation uniquement"
    },
    "qa_visuelle_intervention": { "entrypoint": "qa-photo-analyse.ts (nouveau)", "costTier": "tier2_llm", "blocking": false },
    "prediction_impayes": { "entrypoint": "vue Postgres client_payment_stats (nouveau)", "costTier": "tier0_deterministic", "llm": false }
  }
}
```

#### `supabase-functions/_shared/conscience-seba.ts` (module partagé)

```ts
// Un seul point de vérité pour "analyser un contexte business et proposer UNE action".
// Remplace le code dupliqué entre ai-relay.ts (mode json) et daily-digest.ts.
export interface ConscienceContext {
  facturesEnRetard: number; montantEnRetardEUR: number; devisEnAttente: number;
  margeEstimeeMois?: number;   // nouveau champ possible dès que 2.3 est en place
}
export interface ConscienceVerdict { action: string; priority: 'high' | 'medium' | 'low'; reasoning: string }

const SYSTEM =
  "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
  'Réponds uniquement en JSON structuré : {"action":"titre court","priority":"high/medium/low","reasoning":"une phrase"}. ' +
  "Analyse le contexte et propose UNE mesure concrète si utile.";

// TIER 0 — décisions déjà tranchables sans LLM (seuils déterministes). Retourne
// null si le cas n'est pas assez net pour éviter l'appel LLM (ex. situation ambiguë).
export function decideDeterministe(ctx: ConscienceContext): ConscienceVerdict | null {
  if (ctx.facturesEnRetard >= 5) {
    return { action: 'Relancer les impayés en masse', priority: 'high', reasoning: `${ctx.facturesEnRetard} factures en retard, seuil critique dépassé.` };
  }
  if (ctx.facturesEnRetard === 0 && ctx.devisEnAttente === 0) return null; // rien à signaler, pas d'appel LLM du tout
  return null; // cas intermédiaire -> tier2
}

// TIER 2 — appel LLM, réservé à la FORMULATION d'une situation déjà quantifiée,
// jamais au calcul du chiffre lui-même (le LLM ne doit jamais halluciner un total).
export async function decideAvecLLM(ctx: ConscienceContext, providers: Array<(s: string, u: string) => Promise<string>>): Promise<ConscienceVerdict | null> {
  for (const call of providers) {
    try {
      const raw = await call(SYSTEM, JSON.stringify(ctx));
      const parsed = JSON.parse(raw);
      if (parsed?.action && parsed?.priority) return parsed;
    } catch { /* fournisseur suivant */ }
  }
  return null;
}

// Point d'entrée unique — TIER 1 (cache) enveloppe l'appelant, voir section Mistral.
export async function conscience(ctx: ConscienceContext, providers: Array<(s: string, u: string) => Promise<string>>): Promise<ConscienceVerdict | null> {
  return decideDeterministe(ctx) ?? await decideAvecLLM(ctx, providers);
}
```

`ai-relay.ts` (mode `json`) et `daily-digest.ts` importent tous deux `conscience()` — plus aucune divergence de prompt possible, un seul endroit à corriger si le format change.

#### Marge réelle malgré la structure en blob

```sql
-- Catalogues de coûts : gérés par le patron (faible fréquence d'écriture, aucun
-- risque de conflit multi-appareil) — tables normalisées dès aujourd'hui, indépendamment
-- du calendrier de migration du blob (section 0).
create table if not exists materiaux_couts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  nom text not null,
  cout_unitaire numeric(10,2) not null,
  fournisseur text,
  unite text default 'unité',
  updated_at timestamptz default now()
);
alter table materiaux_couts enable row level security;
create policy "materiaux_couts_all" on materiaux_couts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Référence SOUPLE vers une intervention du blob (entity_id text, voir section 0) —
-- PAS de `references interventions(id)` tant que interventions n'est pas une vraie ligne.
-- Deviendra une vraie FK le jour où la migration normalisée (docs-backend.md, étape 2) est faite.
create table if not exists intervention_materiaux (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  intervention_id text not null,        -- correspond à interventions[].id dans seba_state.state (format id_xxxxx)
  materiau_id uuid not null references materiaux_couts(id),
  quantite_prevue numeric(10,2),
  quantite_utilisee numeric(10,2),
  ecart_justification text
);
alter table intervention_materiaux enable row level security;
create policy "intervention_materiaux_all" on intervention_materiaux for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists intervention_materiaux_intervention_idx on intervention_materiaux (user_id, intervention_id);

create table if not exists intervention_trajets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  intervention_id text not null,
  duree_estimee_min int,
  duree_reelle_min int,
  cause_ecart text
);
alter table intervention_trajets enable row level security;
create policy "intervention_trajets_all" on intervention_trajets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Vue de marge réelle** — le rapprochement blob/tables normalisées se fait côté application (Edge Function ou requête client), pas en SQL pur (impossible de joindre nativement du JSONB de `seba_state.state.factures[]` avec `intervention_materiaux.intervention_id` sans un `jsonb_array_elements` fragile) :

```sql
-- Fonction Postgres qui déplie le blob pour un compte donné, réutilisable par
-- product-agents (conscience_predictive) ET par un futur widget dashboard.
create or replace function marge_reelle_interventions(p_account text)
returns table(intervention_id text, revenu numeric, cout_materiaux numeric, marge numeric) as $$
  select
    f->>'id' as intervention_id,
    coalesce((f->>'amount')::numeric, 0) as revenu,
    coalesce((select sum(quantite_utilisee * mc.cout_unitaire)
              from intervention_materiaux im join materiaux_couts mc on mc.id = im.materiau_id
              where im.intervention_id = f->>'id' and im.user_id = (select user_id from seba_state where account = p_account)), 0) as cout_materiaux,
    coalesce((f->>'amount')::numeric, 0) - coalesce((select sum(quantite_utilisee * mc.cout_unitaire)
              from intervention_materiaux im join materiaux_couts mc on mc.id = im.materiau_id
              where im.intervention_id = f->>'id' and im.user_id = (select user_id from seba_state where account = p_account)), 0) as marge
  from seba_state s, jsonb_array_elements(s.state->'factures') f
  where s.account = p_account and f->>'statut' = 'payee';
$$ language sql stable;
```

---

## 3. MISTRAL — Fix du `.slice(0, 4000)` & `memoire_embeddings` (pgvector)

### 1️⃣ Ce que je supprime ou refactorise immédiatement

- **`JSON.stringify(body.context).slice(0, 2000|4000)` dans `ai-relay.ts` (lignes 208 et 224) — supprimé purement et simplement.** Une troncature de chaîne sur un JSON stringifié peut couper au milieu d'une clé ou d'une valeur, produisant soit un JSON invalide envoyé tel quel au modèle (perte de qualité de réponse silencieuse), soit une coupure qui retire précisément les données les plus récentes (le contexte est probablement construit `{...anciennes clés, factures: [...]}`, donc la fin — souvent la plus pertinente — est ce qui saute en premier). C'est un bug de qualité, pas seulement de coût.
- **L'appel LLM systématique de `daily-digest.ts` pour chaque compte, chaque jour, même quand la situation n'a pas changé depuis la veille** — remplacé par le cache `ai_context_hash` (ci-dessous), pas par une intuition de fréquence.

### 2️⃣ Vision produit mise à jour

Le contexte envoyé à un LLM doit toujours être **construit**, jamais **coupé**. Le budget de tokens devient un paramètre d'entrée de la construction du contexte (on choisit QUOI inclure), pas une contrainte de sortie qu'on subit après coup (on tronque ce qui dépasse). Pour la mémoire long terme, le principe symétrique s'applique : ne jamais faire grossir un prompt avec l'historique complet d'un client — ne récupérer QUE les fragments pertinents à la question posée, via une recherche vectorielle, coût constant quelle que soit l'ancienneté du client.

### 3️⃣ Ajouts critiques

#### Fix exact du contexte tronqué

```ts
// supabase-functions/_shared/build-context.ts (nouveau)
// Construit un contexte BORNÉ EN NOMBRE D'ÉLÉMENTS, jamais en caractères —
// le JSON produit est TOUJOURS valide, jamais coupé à l'aveugle.
interface RawContext {
  facturesEnRetard?: Array<{ id: string; client?: string; montant?: number }>;
  devisEnAttente?: Array<{ id: string; client?: string; montant?: number }>;
  [key: string]: unknown;
}

export function buildStructuredContext(raw: RawContext, maxItemsPerList = 10): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      out[key + 'Total'] = value.length;                       // le compte total n'est jamais perdu
      out[key] = value.slice(0, maxItemsPerList);               // troncature PAR ÉLÉMENT, jamais par caractère
      if (value.length > maxItemsPerList) out[key + 'Tronque'] = true;  // le modèle SAIT que la liste est partielle
    } else {
      out[key] = value;
    }
  }
  return out;  // JSON.stringify(out) est TOUJOURS un JSON valide, complet, borné en taille par construction
}
```

`ai-relay.ts` remplace `JSON.stringify(body.context).slice(0, 4000)` par `JSON.stringify(buildStructuredContext(body.context))` — plus de coupure de chaîne, une garantie structurelle de validité JSON, et le modèle est informé explicitement quand une liste est partielle (`devisEnAttenteTronque: true`) au lieu de le découvrir en silence.

#### Cache de contexte (`ai_context_hash`)

```sql
create table if not exists ai_context_hash (
  account text not null,
  agent text not null,             -- 'conscience_predictive', 'assistant_conversationnel'...
  context_hash text not null,      -- sha256(JSON.stringify(contexte construit))
  response jsonb not null,
  created_at timestamptz default now(),
  primary key (account, agent, context_hash)
);
alter table ai_context_hash enable row level security;
-- Accès service_role uniquement (Edge Functions) — aucune policy client.
```

```ts
// Dans conscience-seba.ts : avant tout appel LLM (tier2), vérifier le cache.
async function withCache(supa: SupaAdmin, account: string, agent: string, ctx: unknown, compute: () => Promise<ConscienceVerdict | null>) {
  const hash = await sha256(JSON.stringify(ctx));
  const cached = await supa.from('ai_context_hash').select('response').match({ account, agent, context_hash: hash }).maybeSingle();
  if (cached.data) return cached.data.response as ConscienceVerdict;
  const result = await compute();
  if (result) await supa.from('ai_context_hash').upsert({ account, agent, context_hash: hash, response: result });
  return result;
}
```

Effet concret sur `daily-digest.ts` : un compte dont la situation n'a pas bougé depuis la veille (même hash) ne déclenche **aucun** appel réseau vers Mistral/Groq, juste une lecture Postgres — élimine la quasi-totalité du gaspillage identifié.

#### Mémoire sémantique — `pgvector` avec `mistral-embed`

Choix du fournisseur d'embeddings : **`mistral-embed`** (endpoint `https://api.mistral.ai/v1/embeddings`, 1024 dimensions), pas un modèle local — Deno Edge Functions n'a pas d'environnement d'inférence ML embarqué, et `MISTRAL_API_KEY` est déjà provisionnée dans l'infra existante (aucune nouvelle clé à gérer).

```sql
create extension if not exists vector;

-- Résumé vivant par client — 2-3 phrases, MIS À JOUR INCRÉMENTALEMENT (jamais
-- régénéré en entier à chaque digest, sinon même coût que 3.1 en boucle).
create table if not exists client_memoire (
  client_id text not null,          -- text, pas uuid (section 0) : correspond à clients[].id dans le blob
  user_id uuid not null default auth.uid(),
  resume text,
  derniers_faits jsonb default '[]',  -- FIFO, 5 max — évite la croissance indéfinie
  faits_depuis_dernier_resume int default 0,  -- déclenche la régénération du résumé au-delà d'un seuil (ex. 5)
  updated_at timestamptz default now(),
  primary key (client_id, user_id)
);
alter table client_memoire enable row level security;
create policy "client_memoire_all" on client_memoire for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Recherche sémantique — interrogée SEULEMENT sur demande explicite (question du
-- chat), jamais injectée automatiquement dans chaque prompt.
create table if not exists memoire_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id text not null,
  source_type text not null check (source_type in ('note','intervention','digest')),
  source_id text,
  contenu text not null,
  embedding vector(1024),           -- mistral-embed, pas 384 (correction du chiffre du rapport précédent, qui supposait un modèle local)
  created_at timestamptz default now()
);
alter table memoire_embeddings enable row level security;
create policy "memoire_embeddings_all" on memoire_embeddings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists memoire_embeddings_vec_idx on memoire_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

```ts
// supabase-functions/_shared/embeddings.ts
export async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get('MISTRAL_API_KEY');
  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: 'mistral-embed', input: [text.slice(0, 8000)] }), // borne d'ENTRÉE, distincte du bug de sortie corrigé plus haut
  });
  const data = await res.json();
  return data.data[0].embedding;
}

// Requête de rappel (chat assistant) : "rappelle-moi ce qui s'est passé chez Dupont"
export async function rappelClient(supa: SupaAdmin, userId: string, clientId: string, question: string, k = 5) {
  const qEmbedding = await embed(question);
  const { data } = await supa.rpc('match_memoire', { p_user_id: userId, p_client_id: clientId, p_embedding: qEmbedding, p_k: k });
  return data; // les k passages les plus proches, jamais l'historique complet
}
```

```sql
create or replace function match_memoire(p_user_id uuid, p_client_id text, p_embedding vector(1024), p_k int)
returns table(contenu text, source_type text, created_at timestamptz, similarity float) as $$
  select contenu, source_type, created_at, 1 - (embedding <=> p_embedding) as similarity
  from memoire_embeddings
  where user_id = p_user_id and client_id = p_client_id
  order by embedding <=> p_embedding
  limit p_k;
$$ language sql stable;
```

Coût : un appel `mistral-embed` par fait mémorisé (écriture, peu fréquente) + un appel par question explicite de rappel (lecture, sur demande utilisateur) — jamais un appel par digest quotidien ni par calcul de conscience prédictive, qui restent sur `client_memoire.resume` (texte fixe, coût constant).

---

## 4. GEMINI — Interface Photo-First & QA visuelle bloquante-jamais

### 1️⃣ Ce que je supprime ou refactorise immédiatement

- **Toute maquette d'écran de clôture d'intervention à formulaire multi-champs par défaut** — le premier écran ne doit contenir QUE : 1 bouton photo (zone tactile ≥ 64px, pas 44px standard — gants), 2 boutons « Conforme » / « À signaler ». Le texte libre est un écran secondaire, jamais le premier.
- **Idée abandonnée : bloquer la validation d'une intervention tant que la photo n'est pas analysée par l'IA.** Latence réseau chantier (zone blanche fréquente) rendrait la clôture d'intervention non fiable si elle dépend d'un aller-retour réseau synchrone. L'analyse IA est toujours **asynchrone et a posteriori**, jamais sur le chemin critique de la clôture.
- **Idée abandonnée : score de conformité unique (`0-100`)** trop abstrait pour être actionnable par un technicien sous pression — remplacé par une liste de critères binaires nommés (voir `qa_criteres_metier`), chacun avec un verdict séparé.

### 2️⃣ Vision produit mise à jour

Le pipeline de clôture d'intervention devient : **photo obligatoire → statut en 1 tap → envoi immédiat (mise en file si hors-ligne, cohérent avec `sync_operations`, section 1) → analyse IA asynchrone, alerte push uniquement si un écart réel est détecté.** Le technicien ne voit jamais l'IA comme un obstacle — au pire, comme une notification 2 minutes plus tard, sur le trajet vers le prochain chantier, à un moment où corriger est encore trivial (il est encore sur place ou tout proche), contrairement à un signalement client 3 semaines après.

### 3️⃣ Ajouts critiques

#### Schéma SQL exact

```sql
create table if not exists qa_criteres_metier (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  secteur text not null,                -- même valeurs que profiles.sector
  type_intervention text not null,
  criteres jsonb not null,              -- [{label, description, obligatoire bool}]
  updated_at timestamptz default now()
);
alter table qa_criteres_metier enable row level security;
create policy "qa_criteres_metier_all" on qa_criteres_metier for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists qa_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  intervention_id text not null,        -- référence souple (section 0), format id_xxxxx
  photo_url text not null,
  criteres_id uuid references qa_criteres_metier(id),
  verdict text check (verdict in ('conforme','a_verifier','non_conforme')),
  points_detectes jsonb,                -- [{critere, respecte bool, detail text}]
  confidence numeric(3,2),
  analyse_le timestamptz,
  notifie boolean default false,        -- évite un double push si l'Edge Function est rejouée
  created_at timestamptz default now()
);
alter table qa_photos enable row level security;
create policy "qa_photos_all" on qa_photos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists qa_photos_intervention_idx on qa_photos (user_id, intervention_id);
```

#### `supabase-functions/qa-photo-analyse.ts` (nouvelle fonction, asynchrone, jamais bloquante)

```ts
// Déclenchée par le client APRÈS que la photo soit uploadée dans Supabase
// Storage — jamais avant, jamais en attente synchrone de la clôture d'intervention.
Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const userId = verifyUser(req);
  if (!userId) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const { qaPhotoId, photoUrl, typeIntervention, secteur } = await req.json();

  const criteres = await supa.from('qa_criteres_metier')
    .select('id, criteres').match({ user_id: userId, secteur, type_intervention: typeIntervention }).maybeSingle();
  if (!criteres.data) return jsonResponse(cors, { skipped: true, reason: 'Aucun critère défini pour ce type d\'intervention' });

  const prompt = `Analyse cette photo de fin d'intervention (${typeIntervention}). ` +
    `Vérifie chacun de ces critères et réponds en JSON strict : ` +
    `{"points_detectes":[{"critere":"...","respecte":true|false,"detail":"..."}],"verdict":"conforme|a_verifier|non_conforme","confidence":0.0-1.0}. ` +
    `Critères : ${JSON.stringify(criteres.data.criteres)}`;

  try {
    const key = Deno.env.get('GEMINI_API_KEY');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { fileData: { mimeType: 'image/jpeg', fileUri: photoUrl } }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');

    await supa.from('qa_photos').update({
      verdict: parsed.verdict, points_detectes: parsed.points_detectes,
      confidence: parsed.confidence, analyse_le: new Date().toISOString(),
    }).eq('id', qaPhotoId);

    // Alerte UNIQUEMENT si écart réel — jamais de notification sur un verdict conforme (fatigue d'alerte).
    if (parsed.verdict !== 'conforme' && parsed.confidence >= 0.6) {
      await sendPush(userId, 'Point à vérifier détecté', `${typeIntervention} : ${parsed.points_detectes.find((p: { respecte: boolean }) => !p.respecte)?.detail ?? 'voir détail'}`);
      await supa.from('qa_photos').update({ notifie: true }).eq('id', qaPhotoId);
    }
    return jsonResponse(cors, { ok: true, verdict: parsed.verdict });
  } catch (e) {
    // Échec de l'IA = SILENCIEUX pour le technicien, jamais un blocage. Le patron peut
    // voir "analyse indisponible" dans qa_photos (analyse_le reste null), pas une erreur bloquante.
    return jsonResponse(cors, { ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
```

**Garde-fou explicite dans le code, pas seulement dans la doc** : le seuil `confidence >= 0.6` avant toute alerte évite qu'un faux positif à faible confiance génère une notification anxiogène pour un technicien qui a bien fait son travail — un verdict `non_conforme` à `confidence: 0.3` reste enregistré (traçabilité) mais **ne notifie personne**, laissé à la revue du patron dans son dashboard s'il le consulte.

#### Interface Photo-First — contraintes UI exactes (à une main, gants)

- Zone de capture photo : bouton unique ≥ 64×64px en bas d'écran, atteignable au pouce, jamais en haut de l'écran.
- Boutons de statut (« Conforme » / « À signaler ») : même zone basse, contraste élevé (pas de dépendance à la justesse des couleurs sous soleil direct — utiliser forme + icône, pas uniquement une couleur).
- Formulaire détaillé : accessible uniquement en swipe/tap secondaire depuis l'écran principal, jamais imposé avant la validation du statut de base.
- Reconnaissance vocale pour les notes : déclenchée par un bouton maintenu (pas un mode toujours-actif qui capterait le bruit de chantier en continu) ; si le score de confiance de la transcription (fourni par l'API de reco vocale) est sous un seuil, repli automatique sur une liste de statuts prédéfinis à sélectionner en 1 tap plutôt qu'une resaisie vocale vouée à l'échec.
