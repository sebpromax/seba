# T3 — Correctif synchronisation (auto-retry) — rapport de livraison

Statut : **correction locale terminée et vérifiée, en attente de validation avant commit/fusion/déploiement** (aucune action git effectuée, aucun déploiement, aucune modification de l'environnement partagé/production).

## 1. Branche

`fix/t3-sync-retry-recovery`, créée depuis `main` (qui contient déjà le correctif T2 fusionné). Rien n'a été commité sur cette branche à ce stade.

## 2. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `docs/seba-data.js` | Correctif produit (le seul fichier de code applicatif touché) |
| `scripts/local-db/test-t3-sync-harness.js` | Nouveau — harnais Puppeteer de reproduction/validation (6 scénarios) |
| `scripts/local-db/t3-harness.html` | Nouveau — page minimale servant de point d'entrée au harnais |
| `scripts/local-db/local-only-grants.sql` | Découverte annexe (voir §14) — grants `service_role` locaux, fichier déjà existant et déjà explicitement hors-migration |
| `scripts/local-db/README.md` | Doc minimale — nouvelle commande + section "Edge functions" |

**Non touchés** (conformément au périmètre autorisé) : `supabase-functions/sync-push.ts` (idempotence déjà solide, voir §7 — aucune modification jugée nécessaire), le correctif T2 et sa migration, la fonction RGPD, l'authentification, le front public, les secteurs, `migrations/`, tout projet Supabase partagé/production.

## 3. Root cause

`docs/seba-data.js`, fonction `syncWorker()` (avant correctif) :
- Si `fetch()` renvoie un statut HTTP hors 2xx/207 : la fonction logue un `console.warn` et fait `return` **sans jamais reprogrammer de nouvel essai**. La file (`seba_pending_ops` dans `localStorage`) reste intacte mais plus aucun code ne la revide, sauf nouvelle écriture utilisateur ou évènement `online`.
- Si `fetch()` lève (panne réseau, `catch`) : même défaut — aucune reprogrammation automatique.
- Aucun code ne relançait le worker au chargement de page, même si la file n'était pas vide (perte de synchronisation silencieuse après fermeture d'onglet pendant une coupure).
- Les opérations en erreur individuelle (chemin 207 partiel) réessayaient déjà, mais **sans aucun backoff** — enchaînement immédiat (800ms fixe) jusqu'à `MAX_OP_ATTEMPTS`, puis **suppression pure et simple** de l'opération (`console.error` uniquement, aucune trace récupérable).
- Aucun indicateur visuel n'existait pour signaler à l'utilisateur qu'une modification n'était pas encore synchronisée.

## 4. Preuve automatisée AVANT correction

Trois runs successifs du harnais contre le code non corrigé (capturés intégralement dans les logs d'exécution de cette session) ont confirmé empiriquement, par comptage réel de requêtes réseau (jamais de logs console) :

- **HTTP 500 persistant** : 1 requête envoyée, puis **aucune 2ᵉ tentative après 6s** d'attente raisonnable.
- **Rejet réseau** (`request.abort()`) : même constat, **aucune 2ᵉ tentative après 6s**.
- **Rechargement de page** avec file non vide : **0 nouvelle requête** au chargement — la file reste inerte jusqu'à la prochaine écriture.
- **Aucun indicateur visuel** présent dans le DOM.
- (Confirmé fonctionnels avant correction, donc non régressifs) : une nouvelle écriture ou un évènement `online` redéclenchaient bien une tentative.
- **Réponse 207 partielle** : contrairement à l'hypothèse initiale, ce chemin retentait déjà (bug CORS de préflight dans le premier harnais l'avait masqué, corrigé avant la mesure finale) — mais **sans aucun backoff** : 4 requêtes en 2.5s lors du test, confirmant un risque réel de boucle serrée sur ce chemin précis.

## 5. Politique de réessai retenue

Backoff progressif et plafonné, unique pour les trois causes d'échec (HTTP hors 2xx/207, exception réseau, erreur par opération) :

```
RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000]  // ms, palier croissant
```

- Le compteur (`_syncFailureStreak`) s'incrémente à chaque échec (quelle que soit sa nature) et se **réinitialise à zéro dès qu'un lot est intégralement acquitté** — un nouvel échec après une reprise réussie repart donc au délai le plus court (2s), jamais au délai où l'on s'était arrêté. Vérifié explicitement par le harnais (Scénario A, dernière partie).
- L'évènement `online` déclenche une reprise **immédiate** (délai 0), sans attendre la fin du backoff en cours — vérifié (Scénario D).
- Le chargement de page (`SebaDB.ready()`) déclenche un flush immédiat si la file n'est pas vide — vérifié (Scénario C).
- Aucun jitter aléatoire : délais déterministes, choix assumé pour rester simple et testable (le risque de effet de troupeau concerne un service multi-tenant avec peu d'appareils simultanés par compte, jugé non pertinent ici).

## 6. Mécanisme "un seul worker actif à la fois"

- `scheduleSyncWorker(delay)` annule systématiquement le timer précédent (`clearTimeout`) avant d'en poser un nouveau : un seul timer en vol.
- `syncWorker()` pose un verrou `_syncing` pendant l'exécution. **Correctif additionnel** : avant, un déclenchement pendant qu'un run était en cours était **silencieusement perdu** (`if (_syncing) return;`) ; désormais il est **reprogrammé** (`scheduleSyncWorker(500)`) plutôt qu'abandonné — aucune tentative n'est plus jetée au sol.

## 7. Analyse idempotence backend (avant d'activer les réessais automatiques)

Confirmée solide, **aucune modification de `supabase-functions/sync-push.ts`** :
- Contrainte réelle `unique (account, device_id, client_seq)` sur `sync_operations` (`supabase-schema.sql`, ligne 263).
- `sync-push.ts` fait un `upsert(..., { onConflict: 'account,device_id,client_seq', ignoreDuplicates: true })` : un rejeu du même `client_seq` renvoie `ack_duplicate` sans ré-appliquer le patch.
- Compensation déjà présente : si `apply_entity_patch` échoue après l'insertion de la ligne `sync_operations`, celle-ci est supprimée pour ne pas bloquer un futur rejeu légitime.
- **Vérifié empiriquement** (pas seulement lu dans le code) en faisant tourner la vraie fonction en local (voir §14 pour le détail de la mise en place) : 2 appels identiques (même `client_seq`) → 1er `applied`, 2ᵉ `ack_duplicate`, **1 seule ligne** en base après les deux appels. Aucune régression possible du fait des réessais automatiques ajoutés côté client.

## 8. Diff — résumé

`docs/seba-data.js` (+136/-18 lignes) :
- Nouveaux : `FAILED_KEY`, `RETRY_DELAYS_MS`, `_syncFailureStreak`, `backoffDelay()`, `loadFailed()`/`saveFailed()`, `retrySyncNow()`, `ensureSyncIndicatorEl()`/`updateSyncIndicator()`.
- `scheduleSyncWorker()` accepte désormais un délai explicite (défaut 800ms inchangé pour l'écriture normale).
- `syncWorker()` : reprogrammation au lieu de `return` silencieux si déjà en cours ; backoff + indicateur sur échec HTTP global ; backoff + indicateur sur exception réseau ; les opérations dépassant `MAX_OP_ATTEMPTS` sont déplacées vers `seba_failed_ops` (jamais supprimées) au lieu d'être droppées.
- `ready()` : flush immédiat si `seba_pending_ops` non vide au chargement.
- API publique : `SebaDB.retrySyncNow()`, `SebaDB.syncStatus()`.
- `online` : reset du backoff + reprise immédiate.

`scripts/local-db/local-only-grants.sql` (+35 lignes) : ajout de grants `service_role` (découverte annexe, voir §14) — aucun changement de logique applicative.

## 9. Tests exécutés (harnais automatisé, Chrome réel + Supabase local réel)

`node scripts/local-db/test-t3-sync-harness.js` — 6 scénarios, tous par comptage réel de requêtes réseau interceptées (Puppeteer) ou par appel réel au backend local (Scénario F) :
- **A** — HTTP 500 persistant puis reprise de service (11 assertions)
- **B** — rejet réseau puis reprise (3 assertions)
- **C** — flush au chargement de page (3 assertions)
- **D** — évènement `online` (2 assertions)
- **E** — échec définitif après `MAX_OP_ATTEMPTS`, perte silencieuse et réessai manuel (5 assertions)
- **F** — idempotence réelle côté serveur (5 assertions, auto-ignoré si la fonction n'est pas servie localement — voir §14)

## 10. Résultats avant/après

- **Avant** (code non corrigé) : Scénarios A/B/C confirment le bug tel que décrit (aucune reprise auto, aucun flush au chargement) — voir §4.
- **Après** (code corrigé) : **3 runs complets indépendants, tous "TOUT PASSE"** (A à E systématiquement verts ; F vert quand la fonction est servie localement, auto-ignoré sinon).

## 11. Rechargement de page

Vérifié (Scénario C) : file non vide avant rechargement → nouvelle tentative envoyée dès le chargement (`ready()`), sans attendre une écriture ou un `online`.

## 12. Panne prolongée puis reprise

Vérifié (Scénario A, partie 2) : après 2 échecs consécutifs (backoff 2s puis 5s confirmés croissants), bascule du mock vers succès → la file se vide automatiquement (`waitForFunction` jusqu'à `pending === 0`, sans action manuelle) et l'indicateur se masque.

## 13. Aucune suppression silencieuse

Vérifié (Scénario E) : après 6 échecs consécutifs sur la même opération (délais 2s/5s/15s/30s/60s), l'opération est déplacée vers `seba_failed_ops` (nouvelle clé `localStorage`, jamais supprimée), reste dénombrable et identifiable, et l'indicateur affiche explicitement "1 échec définitif". Le réessai manuel (`SebaDB.retrySyncNow()`, ou bouton "Réessayer" de l'indicateur) la replace dans la file active et la fait aboutir dès que le backend répond de nouveau.

## 14. Aucun doublon côté serveur

Vérifié empiriquement (Scénario F) contre la **vraie** fonction Edge locale (pas un mock) : un rejeu du même `client_seq` renvoie `ack_duplicate` et laisse exactement 1 ligne dans `sync_operations`.

**Découverte annexe (hors périmètre T3, signalée pour information)** : pour rendre cette vérification possible, deux écarts d'infrastructure locale ont dû être identifiés et corrigés **uniquement dans l'environnement de test local** :
1. `supabase-functions/` (structure à plat de ce dépôt) n'est pas le chemin attendu par la CLI Supabase (`supabase/functions/<nom>/index.ts`) — aucune fonction n'est servie par défaut par `supabase start` ici. Contournement pour le test : copie temporaire vers `supabase/functions/sync-push/index.ts`, **supprimée après vérification**, non committée.
2. Le rôle `service_role` n'avait, sur une instance locale fraîche, **aucun privilège objet** (ni tables ni fonctions) — écart du même type que celui déjà documenté pour `anon`/`authenticated` (voir `local-only-grants.sql`, découverte initiale Phase 1C). Corrigé dans ce même fichier local-only (jamais une migration, jamais destiné au projet partagé).

Le runtime edge local a par ailleurs crashé une fois pendant les tests (`Bus error`, `docker logs supabase_edge_runtime_seba`) — redémarré (`docker start`), non reproduit ensuite. Traité comme une instabilité locale (Docker Desktop/edge-runtime), sans lien avec le code applicatif ; signalé pour information, non creusé davantage (hors périmètre).

Ces deux points n'affectent ni la production ni aucun fichier de migration — ils concernent exclusivement `scripts/local-db/` (déjà explicitement hors-scope de validation/déploiement).

## 15. Comportement utilisateur visible

Widget auto-injecté par `docs/seba-data.js` (aucune page à modifier), coin bas-droit, masqué par défaut :
- Affiche "N modification(s) en attente" et/ou "N échec(s) définitif(s)" dès qu'une opération est en file ou en échec.
- Bouton "Réessayer" — déclenche `SebaDB.retrySyncNow()` (requeue les échecs définitifs + relance immédiatement).
- Style : uniquement des tokens CSS (`var(--white)`, `var(--border)`, `var(--ink)`, `var(--emerald)`, `var(--rs)`...) déjà définis par chaque page (theme.css ou Tactical Dark selon la page) — aucune couleur en dur, `node tools/check-design-system.js` passe.

## 16. Rollback

`git checkout main -- docs/seba-data.js` restaure l'état d'avant correctif (un seul fichier de code applicatif modifié). Les fichiers de test/doc peuvent être supprimés sans effet sur le produit. Aucune migration, aucun état serveur/production à défaire.

## 17. Confirmation — aucune production touchée

Aucune commande git de publication n'a été exécutée (`push`, `merge` vers `main` distant). Aucune commande Supabase n'a ciblé le projet partagé (toutes via `npx supabase@2.109.1` contre l'instance Docker locale, `127.0.0.1:54321`). `supabase-functions/sync-push.ts` (fichier réel, déployable) n'a subi aucune modification.

## 18. En attente

Validation explicite avant tout `git add`/`commit`, avant toute fusion, et avant tout déploiement — conformément à la consigne reçue.
