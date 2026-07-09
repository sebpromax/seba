# Audit Go-Live — SEBA (Sync/Auth + QA Visuelle + Alerting)

*Rédigé le 2026-07-09 par relecture directe du code sur `main` (`c71157d`) — chaque affirmation ci-dessous est vérifiée contre `supabase-schema.sql`, `supabase-functions/*.ts`, `docs/seba-data.js`, pas déduite du brief. Aucun fichier modifié dans ce document : c'est un audit, pas une implémentation — les correctifs proposés sont prêts à appliquer mais pas appliqués.*

---

## 1. Sécurité & RLS

### 🟢 GREEN — Isolation par compte correctement implémentée partout

Vérifié table par table : `sync_operations`, `entity_versions`, `sync_conflicts`, `qa_photos`, `alert_logs` scopent toutes leur accès via `auth.uid() = user_id` (direct) ou `exists (select 1 from seba_state where account = X and user_id = auth.uid())` (indirect, quand la ligne n'a pas de `user_id` propre). **La crainte spécifique du brief — "accès global sur `alert_logs` au lieu de `account_id`" — ne se vérifie pas** : `alert_logs_select`/`alert_logs_acknowledge` sont bien scopées par compte.

`employe_credentials`/`employe_sessions` : RLS activé **sans aucune policy** — bloque tout accès `authenticated`/`anon`, y compris en lecture. C'est intentionnel (`pin_hash`/`token` ne doivent jamais transiter par l'API REST publique) et correctement documenté dans le code.

### 🟢 GREEN — Stockage `intervention-photos`

`public = false` confirmé (`insert into storage.buckets`). Policies RLS sur `storage.objects` scopées par le premier segment du chemin (`account`), pas par la colonne `owner` (qui ne se remplit pas ici puisque l'upload passe par `service_role`, pas le JWT du patron — décision déjà documentée et correcte). `file_size_limit`/`allowed_mime_types` posés au niveau du bucket en plus de la validation applicative dans `vision-qa.ts` — défense en profondeur réelle, pas redondante.

### 🔴 RED — `call_notify_alert()` est `SECURITY DEFINER` sans restriction d'exécution

C'est la seule fonction `SECURITY DEFINER` de tout le schéma (`create_profile_and_company` et `apply_entity_patch` sont toutes deux `SECURITY INVOKER`, vérifié). Elle lit `vault.decrypted_secrets` (le `service_role_key`) et déclenche un `net.http_post` authentifié avec. **Aucun `revoke execute` n'existe nulle part dans `supabase-schema.sql`** — par défaut Postgres, une fonction nouvellement créée est exécutable par `PUBLIC`, ce qui inclut `anon`/`authenticated` via `POST /rest/v1/rpc/call_notify_alert`.

Impact concret : n'importe quel utilisateur authentifié (même sur un autre compte) peut aujourd'hui appeler `rpc/call_notify_alert` avec un `p_account`/`p_intervention_id`/`p_raison` de son choix, déclenchant un appel HTTP vers `notify-alert.ts` avec le `service_role_key` en en-tête — la fonction cible ne redonne pas la clé à l'appelant (pas de fuite directe du secret), mais ça reste une action privilégiée invocable par n'importe qui, sur des données arbitraires non liées à une vraie alerte. Une fois l'envoi email/push réellement branché (ce palier est un stub), ça devient un vecteur de spam/spoofing de notifications sur des comptes tiers.

**Correctif prêt à appliquer (non exécuté) :**
```sql
revoke execute on function call_notify_alert(uuid, text, text, text, text) from public, anon, authenticated;
-- Defense en profondeur, meme si RLS protege deja le chemin normal (SECURITY INVOKER) :
revoke execute on function apply_entity_patch(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function trigger_qa_alert() from public, anon, authenticated;
revoke execute on function derive_type_alerte(text) from public, anon, authenticated;
```
**À exécuter avant le go-live, pas après.**

### 🟡 YELLOW — `notify-alert.ts` : comparaison de secret non constante dans le temps

`authHeader === 'Bearer ' + supabaseServiceKey` (ligne ~64) est une comparaison de chaîne standard, pas à temps constant. Risque théorique de timing attack pour deviner le `service_role_key` octet par octet. Sévérité réelle faible (l'endpoint n'est pas conçu pour recevoir un trafic hostile à haute fréquence, et Deno/V8 rendent ce genre d'attaque déjà difficile en pratique sur un réseau), mais à corriger si ce pattern est réutilisé ailleurs à l'avenir. Pas bloquant pour le go-live.

---

## 2. Performance & Scalabilité

### 🟢 GREEN — Pas de pool de connexions Postgres à saturer

Toutes les Edge Functions utilisent `supabase-js` (appels REST/RPC via PostgREST), pas de connexion Postgres directe (`pg`) maintenue par fonction — le risque classique "trop de connexions ouvertes simultanément" ne s'applique pas ici de la même façon que pour un serveur avec un pool `pg` traditionnel. Le client `supabase-js` est instancié une fois au chargement du module (pas par requête), réutilisé entre invocations à froid/chaud — bonne pratique déjà en place.

### 🔴 RED — Aucun timeout explicite sur AUCUN appel réseau sortant

Vérifié par recherche exhaustive (`grep AbortController|AbortSignal|timeout`) : **zéro résultat sur l'ensemble de `supabase-functions/*.ts`**, y compris les fonctions déjà en production (`ai-relay.ts`, `daily-digest.ts`), pas seulement celles de ce palier. Le `fetch()` vers Gemini dans `vision-qa.ts` (ligne 90) n'a aucune limite de temps posée côté code — si l'API Gemini traîne, l'invocation reste bloquée jusqu'à la limite de plateforme de Supabase (temps d'exécution max de l'Edge Function), pas une limite choisie et contrôlée par l'application. Côté client, `docs/photo-manager.js` n'a pas non plus d'`AbortController` sur son `fetch()` vers `vision-qa.ts` : un Gemini qui traîne 60s+ laisse le technicien avec `onStatus('analyzing')` indéfiniment, sans option d'annulation ni de repli automatique.

**Correctif recommandé (non appliqué)** — sur chaque appel LLM/HTTP sortant :
```ts
const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }); // 15s, ajustable par fonction
```
Et côté client (`photo-manager.js`), un timeout similaire avec un message explicite ("L'analyse prend plus de temps que prévu, réessayez") plutôt qu'une attente silencieuse.

### 🟡 YELLOW — Pas de circuit breaker global, mais dégradation individuelle correcte

Si Gemini se met à retourner du 429 (quota projet dépassé, pas juste le quota `api_usage` par compte), chaque appel `vision-qa` échoue et bascule individuellement en `incertain` (voir section 3) — pas de cascade, pas de crash groupé. C'est une bonne propriété de résilience, mais ça veut dire qu'en cas de saturation Gemini, **toutes** les photos deviennent `incertain` silencieusement, sans alerte opérationnelle distincte d'un vrai problème réseau ponctuel — voir section 5 (observabilité) pour la métrique qui comblerait ça.

---

## 3. Résilience & Fail-safe

### 🟢 GREEN — Cascade Gemini hors-ligne : vérifiée précisément dans le code

`callGeminiVision()` lève une exception (clé absente, HTTP non-2xx, JSON malformé) → capturée dans le `catch` du `Deno.serve` handler → `finalizeVerdict(null, raison)` → `{ verdict: 'incertain', confidence: 0, error: true }`, **toujours HTTP 200**. L'upload de la photo (Action 1) est lui-même déjà terminé et journalisé indépendamment de l'issue de l'analyse IA (Action 2) — un Gemini mort n'empêche jamais l'archivage de la preuve photo. L'app reste utilisable. Confirmé par lecture ligne à ligne, pas supposé.

### 🟡 YELLOW — Killswitch : partiel, pas total

- **Trigger d'alerting** : killswitch réel et immédiat, `ALTER TABLE qa_photos DISABLE TRIGGER qa_photos_alert_trigger;` — pure config DB, zéro redéploiement. ✅
- **Notification (`pg_net`)** : killswitch réel via Vault (vider/renommer le secret `service_role_key`) — le `exception when others then null;` du `call_notify_alert` absorbe l'échec proprement. ✅
- **`vision-qa.ts` lui-même** : **pas de killswitch en config DB**. Le seul levier "sans redéploiement" est de vider la variable d'environnement `GEMINI_API_KEY` côté dashboard Supabase (Edge Functions → Secrets) — ça fonctionne (dégrade proprement en `incertain` systématique) mais ce n'est pas une bascule DB comme demandé, c'est une action plateforme distincte.
- **`sync-push.ts`** : **aucun killswitch dédié**. Couper le trafic demanderait de désactiver la fonction entière côté dashboard Supabase (arrêt total, pas un mode dégradé) — il n'existe aujourd'hui aucun moyen de, par exemple, mettre la synchro en lecture seule sans toucher au code.

**Recommandation concrète** (non implémentée) : une table `app_config (key text primary key, value text)` lue en tête de chaque Edge Function sensible (`select value from app_config where key = 'vision_qa_enabled'`), permettant un vrai killswitch par fonction en config DB pure, cohérent avec ce qui existe déjà pour le trigger. Absent aujourd'hui.

---

## 4. Intégrité des données (Sync)

### 🔴 RED — Fenêtre de course réelle dans l'idempotence de `sync-push.ts`

Le flux actuel (`applyOne()`, lignes 106-162) : **1)** `SELECT` dans `sync_operations` pour vérifier l'existence de `(account, device_id, client_seq)`, **2)** si absent, appel `apply_entity_patch`, **3)** `INSERT` dans `sync_operations`. Entre l'étape 1 et l'étape 3, il n'y a **aucun verrou** — si le même batch est rejoué deux fois en parallèle (un client qui retente après un timeout réseau pendant que la première requête est encore en vol côté serveur, scénario réaliste, pas théorique), les deux appels peuvent passer l'étape 1 simultanément (aucune ligne encore insérée), tous les deux appeler `apply_entity_patch`, puis un seul réussira l'`INSERT` final (contrainte `unique(account, device_id, client_seq)`), l'autre échouera avec une erreur de conflit.

**Conséquence réelle, précisément qualifiée** (ni exagérée ni minimisée) : comme `apply_entity_patch` fait un merge idempotent en valeur (même patch réappliqué = mêmes champs finaux), **aucune corruption de donnée** — mais `entity_versions.version` est incrémenté deux fois pour une seule opération logique, et l'appel perdant reçoit un statut `'error'` pour une opération qui a en réalité réussi, ce qui peut fausser la logique de retry côté client (`docs/seba-data.js`) sans la casser (le prochain essai retrouvera la ligne et renverra correctement `ack_duplicate`).

**Correctif prêt à appliquer (non exécuté)** — inverser l'ordre : tenter l'`INSERT` en premier via un upsert `ignoreDuplicates`, ne déclencher `apply_entity_patch` que si l'insertion a réellement eu lieu (la contrainte UNIQUE de Postgres devient alors le seul arbitre, plus de fenêtre de course possible) :
```ts
const { data: inserted, error: insertError } = await supabase
  .from('sync_operations')
  .upsert(
    { account: identity.account, user_id: identity.user_id, employee_id: identity.employee_id,
      device_id, client_seq: op.client_seq, entity: op.entity, entity_id: op.entity_id,
      op: op.op, patch: op.patch },
    { onConflict: 'account,device_id,client_seq', ignoreDuplicates: true },
  )
  .select();
if (insertError) return { client_seq: op.client_seq, status: 'error', error: insertError.message };
if (!inserted || inserted.length === 0) return { client_seq: op.client_seq, status: 'ack_duplicate' };
// A partir d'ici, garanti seul gagnant de la course -- apply_entity_patch en toute securite.
```
Sévérité : réelle mais pas bloquante en soi pour un premier go-live à faible volume (le pire cas est une confusion transitoire de statut, pas une perte de donnée) — je recommande de la corriger avant une montée en charge multi-employés simultanée, pas nécessairement avant le tout premier déploiement.

### 🟢 GREEN — Verrouillage optimiste `apply_entity_patch`

`FOR UPDATE` sur `entity_versions` + boucle de retry sur `unique_violation` à la création : relu ligne à ligne, logique correcte, pas de lost update possible une fois qu'on est dans cette fonction (le problème ci-dessus est en AMONT de cet appel, pas dedans).

---

## 5. Plan d'observabilité — 5 métriques clés

1. **Taux d'erreur non-2xx par Edge Function** (`vision-qa`, `sync-push`, `notify-alert`, `employe-auth`), via les logs d'invocation du dashboard Supabase — un signal générique mais le premier à regarder après un déploiement.
2. **Latence P95/P99 de `vision-qa`** spécifiquement — c'est la fonction la plus lente du système (dépend de Gemini), et la seule sur le chemin critique perçu par un technicien sur le terrain. Une dérive ici précède souvent une panne complète.
3. **Ratio `incertain` / total des verdicts** sur `qa_photos`, glissant sur 24h — un ratio anormalement élevé ne distingue pas nativement "Gemini est en panne" de "le seuil de confiance 0.6 est mal calibré pour ce secteur d'activité", mais c'est le signal composite le plus tôt disponible pour les deux cas (voir section 2, YELLOW).
4. **Alertes `active` non acquittées depuis plus de 24h** (`alert_logs`) — un backlog qui grossit signifie soit un vrai problème terrain qui s'accumule, soit un patron qui ne regarde jamais son tableau de bord (fonctionnalité morte) : dans les deux cas, un signal produit à surveiller, pas seulement technique.
5. **Volume `sync_operations` en statut `'error'` côté client** (actuellement visible uniquement en `console.warn` dans `docs/seba-data.js`, pas remonté serveur) — c'est la seule métrique des 5 qui **n'existe pas encore** en l'état : aucun mécanisme ne fait remonter au patron/à l'admin qu'un appareil accumule des échecs de synchro silencieux. À construire si le volume d'usage terrain augmente.

*Bonus (6ème, hors quota demandé) : consommation `api_usage` par compte vs `DAILY_LIMIT` (kind='vision'/'ai') — alerte proactive avant qu'un client légitime heurte le rate limit en pleine journée de travail.*

---

## Checklist de déploiement finale

- [ ] **BLOQUANT** — Exécuter les 4 `revoke execute` (section 1, RED) avant toute mise en trafic réel.
- [ ] **BLOQUANT** — Exécuter le prérequis Vault documenté dans `supabase-schema.sql` (`vault.create_secret` pour `project_url` et `service_role_key`) si la notification d'alerte doit fonctionner dès le jour 1 — sinon, les alertes se créent normalement mais restent silencieuses (dégradation déjà sûre, pas un blocage).
- [ ] Ajouter `AbortSignal.timeout(...)` sur l'appel Gemini de `vision-qa.ts` (et par cohérence, sur `ai-relay.ts`/`daily-digest.ts` déjà en prod — dette préexistante, pas introduite par ce palier).
- [ ] Corriger la fenêtre de course `sync-push.ts` (section 4, RED) avant une utilisation multi-employés simultanée sur un même compte — pas strictement bloquant pour un premier déploiement à faible échelle.
- [ ] Confirmer manuellement dans le dashboard Supabase que les 4 nouvelles Edge Functions (`employe-auth`, `sync-push`, `vision-qa`, `notify-alert`) sont bien déployées et que `GEMINI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` sont présentes dans leurs variables d'environnement.
- [ ] Vérifier `pg_net` est bien activable sur le plan Supabase utilisé (disponible par défaut sur les projets hébergés standards, à confirmer si le projet est en plan gratuit avec restrictions).
- [ ] Mettre en place au moins la métrique n°2 (latence `vision-qa`) et n°4 (backlog d'alertes) avant le go-live — les 3 autres peuvent suivre en semaine 1.
- [ ] Informer le patron pilote du **prérequis PIN** (`employe_credentials.pin_hash`) : sans PIN configuré pour au moins un employé, la couche d'attribution terrain reste inutilisée (dégradation déjà sûre — tout continue de fonctionner au nom du patron — mais la fonctionnalité n'a alors aucun effet visible).

## Commandes SQL "Panic Button"

```sql
-- ═══ 1. Stopper la CREATION de nouvelles alertes (garde qa_photos/vision-qa actifs) ═══
alter table qa_photos disable trigger qa_photos_alert_trigger;
-- Reactivation :
-- alter table qa_photos enable trigger qa_photos_alert_trigger;

-- ═══ 2. Stopper uniquement les NOTIFICATIONS (garde la creation d'alertes active) ═══
-- Vider le secret Vault -- call_notify_alert() degrade silencieusement (voir section 3).
-- Syntaxe vault.update_secret() non verifiee en conditions reelles (meme
-- reserve que le reste de la plomberie pg_net/Vault, voir section 3 du
-- rapport) -- si la signature differe sur ta version de Supabase, plus
-- simple et sur : select vault.create_secret('DISABLED', 'service_role_key')
-- apres avoir supprime l'ancien secret du meme nom (delete from vault.secrets
-- where name = 'service_role_key'), le nom devant rester unique.
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  new_secret := 'DISABLED'
);
-- Reactivation : re-executer vault.create_secret(...) avec la vraie cle.

-- ═══ 3. Rollback complet du Palier 3 (alerting) — objets DB uniquement,
--        ne touche pas qa_photos/vision-qa (Palier 2) ni sync/PIN (Palier 1) ═══
drop trigger if exists qa_photos_alert_trigger on qa_photos;
drop function if exists trigger_qa_alert();
drop function if exists call_notify_alert(uuid, text, text, text, text);
drop function if exists derive_type_alerte(text);
drop table if exists alert_logs;
-- pg_net laissee en place : extension partagee, pas de raison de la retirer
-- pour un rollback cible sur ce seul palier.

-- ═══ 4. Rollback complet du Palier 2 (QA visuelle) — ATTENTION : supprime
--        l'historique des verdicts, action destructive, a ne lancer qu'en
--        dernier recours ═══
drop table if exists qa_photos cascade; -- cascade retire aussi alert_logs.qa_photo_id (FK)
delete from storage.buckets where id = 'intervention-photos'; -- ne supprime pas les fichiers deja uploades, voir doc Supabase Storage pour la purge

-- ═══ 5. Correctif de securite immediat (section 1, RED) — a executer
--        independamment de tout rollback, meme si aucun incident en cours ═══
revoke execute on function call_notify_alert(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function apply_entity_patch(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function trigger_qa_alert() from public, anon, authenticated;
revoke execute on function derive_type_alerte(text) from public, anon, authenticated;
```

## Rapport de confiance — synthèse

| Zone | Verdict |
|---|---|
| Isolation RLS (tables) | 🟢 Solide, vérifiée table par table |
| Stockage privé + policies | 🟢 Correct |
| Fonction `SECURITY DEFINER` sans restriction | 🔴 **À corriger avant go-live** |
| Timeouts réseau sortants | 🔴 Absents partout (dette préexistante + ce palier) |
| Connexions DB / architecture Edge Functions | 🟢 Pas de risque de saturation classique |
| Dégradation Gemini hors-ligne | 🟢 Vérifiée précisément, robuste |
| Killswitch trigger/notification | 🟢 Réel et immédiat |
| Killswitch `vision-qa`/`sync-push` en config DB | 🟡 Absent, contournable via dashboard Supabase |
| Idempotence `sync-push` | 🔴 Fenêtre de course réelle, impact contenu (pas de corruption) |
| Observabilité | 🟡 Rien en place aujourd'hui, plan fourni |

**Verdict global : GO conditionnel.** Le système est architecturalement sain (isolation des données correcte, dégradation gracieuse bien pensée et vérifiée) mais **2 points rouges doivent être traités avant un trafic réel non pilote** : le `revoke execute` sur `call_notify_alert` (5 minutes, zéro risque de régression) et, avant toute montée en charge multi-employés, la fenêtre de course dans `sync-push.ts`. Les timeouts réseau et l'observabilité sont des dettes réelles mais raisonnables à traiter en semaine 1 plutôt qu'à bloquer le lancement.
