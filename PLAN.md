# PLAN — Seba

Source unique de vérité pour la direction produit. L'orchestrateur (`tools/orchestrator.js`) traite les tâches dans l'ordre, une par une, en cochant au fur et à mesure. Ne pas réordonner manuellement sans mettre à jour `PROGRESS.md` en conséquence.

---

## Roadmap SEBA-Core — Sync terrain, QA visuelle, alerting (livré 2026-07-09)

Contexte complet : `ANALYSE-ANGLES-MORTS-IA-TERRAIN.md` (audit produit) et `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md` (cadrage technique, schémas SQL/TypeScript détaillés pour P4/P5 ci-dessous). Détail d'exécution de chaque palier : `PROGRESS.md`.

### P1 — Synchronisation par patch & identité PIN terrain
**Livré** — PR #32 (`2454af4`), 2026-07-09. `sync_operations`/`entity_versions`/`sync_conflicts`, `employe_credentials`/`employe_sessions`, `apply_entity_patch()`, `docs/seba-data.js` refactoré (patchs delta, plus de push du blob entier).

### P2 — Photo-First & QA visuelle Gemini
**Livré** — PR #33 (`d91d938`), 2026-07-09. Bucket `intervention-photos`, `qa_photos`, `supabase-functions/vision-qa.ts`, `docs/photo-manager.js`.

### P3 — Pipeline d'alerting & exceptions
**Livré** — PR #34 (`c71157d`), 2026-07-09. `alert_logs`, trigger `qa_photos_alert_trigger`, `supabase-functions/notify-alert.ts` (stub), `docs/dashboard-alerts.js`.

### P4 (ex-P3 du cadrage initial) — Agents intelligents & mémoire vectorielle
**[X] Terminé** — PR #37 (`6c71361`), #38 (`63c448b`), #39 (`44740eb`), 2026-07-09.
- [x] `supabase-functions/product-agents.config.json` — config des agents côté produit, **distincte** de `agents_config.json` (orchestrateur de dev interne, jamais fusionnée).
- [x] `supabase-functions/_shared/conscience-seba.ts` — module partagé, prompt unifié.
- [x] Table `ai_context_hash` (cache SHA256 de contexte).
- [x] Extension `pgvector` + table `memoire_embeddings` (`mistral-embed`, 1024 dimensions), fonction `match_interventions()`, `_shared/memoire-lookup.ts` (`lookupHistory`), embedding branché sur `vision-qa.ts` (`_shared/embeddings.ts`).
- [x] Corriger `JSON.stringify(body.context).slice(0, 2000|4000)` dans `ai-relay.ts` — fait, voir "Phase API & Frontend Connect" ci-dessous.
- [x] Table `client_memoire` — fait, voir "Phase API & Frontend Connect" ci-dessous.

### P5 (ex-P4 du cadrage initial) — Analytique financière
**[X] Terminé** — PR #40 (`4789590`), 2026-07-09.
- [x] Tables `materiaux_couts`, `paiements` (colonne `account` directe + RLS `auth.uid() = user_id`, pas de jointure sur une table `interventions` normalisée qui n'existe pas dans ce projet).
- [x] Vue `vue_marge_interventions` (`security_invoker = true`) + fonction `get_marge_reelle(p_account text, p_intervention_id text)`.
- [x] `_shared/finance-analytics.ts` (`calculateProfitability`, `getFinancialSummary`) — masquage de `paiements.reference` par omission de colonne.
- [ ] Tables `intervention_materiaux`, `intervention_trajets`, `fournisseurs_prix_historique` — non créées, périmètre réduit au strict nécessaire pour `calculate_profitability`/`get_financial_summary`.
- [ ] Table `client_payment_history` + prédiction déterministe des impayés — **non commencé**.
- [ ] Widget dashboard "marge réelle" — **non commencé**, aucune UI ne consomme encore `vue_marge_interventions`/`get_marge_reelle`.

### AI Core — System prompt, tool routing, garde-fous
**[X] Terminé** — PR #41 (`d5fc885`), 2026-07-09. Descriptions d'outils optimisées pour le tool-routing LLM (`llmDirective` par outil dans `product-agents.config.json`), `SEBA_SAFETY_RAILS` (anti-hallucination, non-exposition d'identifiants bruts, traçabilité) injecté dans `conscience-seba.ts`, gestion gracieuse des échecs d'outil (`.catch()` sur chaque appel RAG/financier, jamais de crash pipeline).

### Phase API & Frontend Connect
**[X] Terminée** — PR #44 (`d6a8a7f`), 2026-07-09. L'infrastructure IA (mémoire vectorielle, analytique financière, garde-fous LLM) livrée aux Paliers 4/5 + AI Core est désormais **exposée côté client**, plus seulement backend :
- [x] Route HTTP `supabase-functions/assistant-technique.ts` — expose `assistant_technique` (RAG + analytique financière) au navigateur, JWT → compte résolu serveur, quota dédié, ne renvoie jamais de réponse inventée si tous les providers échouent. `_shared/llm-providers.ts` créé (chaîne de fallback Mistral→Groq→OpenRouter→Gemini centralisée).
- [x] `ai-relay.ts`/`daily-digest.ts` migrés sur `callWithFallback()`/`decideAvecLLM()` (`_shared/conscience-seba.ts`) — System Prompt centralisé, plus de duplication de la chaîne de providers. Troncature JSON corrigée (`buildStructuredContext()` borne par nombre d'éléments, jamais par caractères). Bonus sécurité : quota `ai-relay.ts` résolu par compte métier partagé (`resolveAccount()`) au lieu du `user_id` brut.
- [x] Vue sécurisée `client_memoire` (`security_invoker = true`, RLS héritée de `qa_photos`/`memoire_embeddings`/`paiements`) — historique technique par intervention exposé au frontend sans appel IA. `migrations/20260709_create_client_memoire.sql` + test SQL d'isolation multi-tenant (`migrations/20260709_create_client_memoire.test.sql`).

**Architecture Full-Stack V1 opérationnelle.**

---

## Dette technique / Prochaines étapes

- [ ] **Configurer un environnement CI ou CLI Deno pour exécuter les tests unitaires** (RAG, Finance, Safety Rails, LLM providers) — les dizaines de `Deno.test` écrites depuis le Palier 1 (`sync-push.test.ts`, `vision-qa.test.ts`, `conscience-seba.test.ts`, `llm-providers.test.ts`, `finance-analytics` couvert indirectement, etc.) n'ont **jamais été exécutées réellement** dans cet environnement (pas de CLI Deno disponible) — vérifiées uniquement par relecture et équilibrage syntaxique. Risque cumulatif à mesure que la suite grossit.
- [ ] Tables `intervention_materiaux`, `intervention_trajets`, `fournisseurs_prix_historique` — non créées, périmètre P5 réduit au strict nécessaire pour `calculate_profitability`/`get_financial_summary`.
- [ ] Table `client_payment_history` + prédiction déterministe des impayés, widget dashboard "marge réelle" (aucune UI ne consomme encore `vue_marge_interventions`/`get_marge_reelle`/`client_memoire`) — reste du périmètre P5 non traité, et premier consommateur front naturel de `client_memoire`.

### Dette technique — audit Go-Live (résolue)

Trouvée lors de l'audit Go-Live (`AUDIT-GO-LIVE-SEBA.md`, 2026-07-09) et de sa remédiation (PR #35, `f4724c2`) :

- [x] `REVOKE EXECUTE` sur les 4 fonctions internes sensibles (`call_notify_alert`, `apply_entity_patch`, `trigger_qa_alert`, `derive_type_alerte`) — fait, PR #35.
- [x] Fenêtre de course dans l'idempotence de `sync-push.ts` — fait, PR #35 (`upsert ignoreDuplicates` + `DELETE` compensatoire).
- [x] Timeout réseau (`AbortSignal.timeout`) sur tous les appels sortants des 4 Edge Functions concernées — fait, PR #35.
- [x] Prérequis manuel Vault (`vault.create_secret`) documenté — fait, `MANUEL-SEBA-ADMIN.md` section 2a.

### Dette technique — restant (non prioritaire)

- [ ] **Killswitch en config DB pour `vision-qa.ts`/`sync-push.ts`** — aujourd'hui, seul le trigger d'alerte a un vrai killswitch DB (`ALTER TABLE ... DISABLE TRIGGER`). Couper `vision-qa`/`sync-push` demande de désactiver la fonction entière côté dashboard Supabase (arrêt total, pas un mode dégradé). Proposition déjà écrite dans l'audit : table `app_config (key text primary key, value text)` lue en tête de chaque fonction sensible.
- [ ] **Métriques de monitoring "sync failures" côté serveur** — aujourd'hui, les échecs de synchro d'un appareil ne sont visibles qu'en `console.warn` local (`docs/seba-data.js`), jamais remontés au patron/à l'admin. Priorité : construire dès que le volume d'usage terrain augmente (voir plan d'observabilité, `AUDIT-GO-LIVE-SEBA.md` section 5, métrique n°5).
- [ ] Comparaison à temps constant pour le secret dans `notify-alert.ts` (sévérité faible, non bloquant — voir audit section 1, YELLOW).
- [ ] `importJSON()` (`docs/seba-data.js`) reste local-only, pas de re-synchronisation automatique vers `sync-push.ts` après une restauration de sauvegarde — décision volontaire, à retraiter si le besoin se confirme.
- [ ] Tension append-only (`sync_operations`) vs droit à l'effacement Art. 17 RGPD — `eraseAllData()` ne purge pas `sync_operations`/`employe_sessions`/`employe_credentials` côté serveur aujourd'hui. Probable solution : anonymisation `service_role` plutôt que suppression physique, pas tranché.

---

## Historique — Chantier dashboard & conformité (livré 2026-07-07/08)

### Chantier dashboard

- [x] Audit + benchmark + implémentation + QA du dashboard (branche `amelioration-dashboard`, 16 commits)
- [x] Revue humaine et merge de `amelioration-dashboard` dans `main` (mergé 2026-07-08 via PR GitHub, déploiement Pages vérifié en direct sur sebpromax.github.io/seba/dashboard.html)

### Dette RGPD/sécurité identifiée (voir audit du 2026-07-07, classement gravité dans la conversation — pas encore fichier dédié)

- [x] Suppression de compte : ajouter la suppression réelle côté Supabase — Art. 17 RGPD, critique (mergé 2026-07-08, vérifié en direct : `eraseAllData` présent dans `seba-data.js` en production)
- [x] Corriger les injections `innerHTML` non échappées — faille XSS stockée, critique (mergé 2026-07-08, vérifié en direct : `function esc(` présent dans `clients.html`/`crm-tech.html`/`widgets.js` en production)
- [x] Brancher `SebaDB.remove()` à l'UI pour la suppression individuelle d'un client/employé — Art. 17 (2026-07-08 : bouton dans `client-fiche.html`/`employe-fiche.html` + action rapide dans `clients.html`, id désormais propagé dans l'URL)
- [x] Exposer un export JSON complet des données personnelles dans réglages.html (la fonction `SebaDB.exportJSON()` existe déjà) — Art. 20 (déjà implémenté — bouton "Exporter mes données" présent, checkbox juste restée non cochée)
- [x] Retirer/mitiger `prefilled_email` en clair dans l'URL des Payment Links Stripe (2026-07-08 : supprimé de `stripe-service.js`, `client_reference_id` seul suffit au rapprochement)
- [x] Créer la page politique de confidentialité / mentions légales (2026-07-08 : `docs/politique-confidentialite.html` créée, contenu factuel — voir PROGRESS.md pour le détail et la reserve sur l'identité juridique du responsable de traitement, marquée `[À compléter par le fondateur]`)
- [x] Trancher l'incohérence entre le discours marketing ("tout est hébergé en Europe") et les fournisseurs IA/email/push américains (2026-07-08 : `confiance.html`/`faq.html` reformulés pour être honnêtes — données métier en UE, services annexes internationaux détaillés dans la nouvelle politique de confidentialité)

### Thème Tactical Dark — migration restante

- [x] Migrer `client-fiche.html` vers Tactical Dark — vérifié 2026-07-08 : la page utilise déjà les tokens `pro-global.css` (dark ET light), rendu conforme au reste de l'app dans les deux modes. La note "actuellement thème clair" était obsolète, aucun code à changer.
- [x] Migrer `employe-fiche.html` vers Tactical Dark — même constat, même vérification 2026-07-08.

### Bugs connus non corrigés

- [x] Sidebar mobile ne passe jamais en `position:fixed` sur `clients.html` (2026-07-08 : root-cause réel différent du diagnostic — `position:fixed` s'appliquait déjà correctement ; le vrai bug était `.layout{grid-template-columns:1fr!important}` sans `minmax(0,1fr)`, qui laissait la piste de grille grandir jusqu'au `min-content` du tableau responsive (`table{min-width:560px}`), poussant le hamburger hors du viewport sur `clients.html`/`devis.html`/`equipe.html`/`factures.html`/`planning.html`. Fix d'une ligne dans `pro-global.css` + petits ajustements de wrap par page. Vérifié : 0 débordement, hamburger accessible, desktop pixel-identique sur les 8 pages testées.)
