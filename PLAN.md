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
**Non commencé.** Détail technique complet déjà écrit dans `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md` section Grok/Mistral — reste à implémenter :
- [ ] `supabase-functions/product-agents.config.json` — config des agents côté produit, **distincte** de `agents_config.json` (orchestrateur de dev interne, ne jamais fusionner les deux).
- [ ] `supabase-functions/_shared/conscience-seba.ts` — module partagé, tue la duplication de prompt entre `ai-relay.ts` (mode `json`) et `daily-digest.ts`.
- [ ] Table `ai_context_hash` (cache SHA256 de contexte, évite les appels LLM redondants quand la situation d'un compte n'a pas changé depuis la veille).
- [ ] Corriger `JSON.stringify(body.context).slice(0, 2000|4000)` dans `ai-relay.ts` — troncature de chaîne pouvant produire un JSON invalide envoyé au modèle. Remplacer par une construction de contexte bornée en nombre d'éléments, pas en caractères.
- [ ] Extension `pgvector` + table `memoire_embeddings` (`mistral-embed`, 1024 dimensions) + `client_memoire` (résumé incrémental, pas régénéré à chaque digest) — mémoire sémantique par client sans saturer le contexte envoyé au LLM.

### P5 (ex-P4 du cadrage initial) — Analytique financière
**Non commencé.** Détail technique complet dans `VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md` section Grok :
- [ ] Tables `materiaux_couts`, `intervention_materiaux`, `intervention_trajets`, `fournisseurs_prix_historique` — normalisables dès maintenant, indépendamment du calendrier de migration du blob `seba_state` (faible fréquence d'écriture, pas de risque de conflit multi-appareil comme les données opérationnelles de P1).
- [ ] Fonction Postgres `marge_reelle_interventions()` — rapproche `seba_state.state.factures[]` (JSONB) et les coûts normalisés.
- [ ] Table `client_payment_history` + prédiction déterministe des impayés (moyenne/écart-type par client, **aucun appel LLM** — le LLM n'intervient qu'à la toute fin pour la mise en forme textuelle du digest).
- [ ] Widget dashboard "marge réelle" (CA vendu − coûts matériaux − temps de trajet non facturé).

---

## Dette technique & maintenance (priorité avant P4/P5)

Trouvée lors de l'audit Go-Live (`AUDIT-GO-LIVE-SEBA.md`, 2026-07-09) et de sa remédiation (PR #35, `f4724c2`) :

- [x] `REVOKE EXECUTE` sur les 4 fonctions internes sensibles (`call_notify_alert`, `apply_entity_patch`, `trigger_qa_alert`, `derive_type_alerte`) — fait, PR #35.
- [x] Fenêtre de course dans l'idempotence de `sync-push.ts` — fait, PR #35 (`upsert ignoreDuplicates` + `DELETE` compensatoire).
- [x] Timeout réseau (`AbortSignal.timeout`) sur tous les appels sortants des 4 Edge Functions concernées — fait, PR #35.
- [x] Prérequis manuel Vault (`vault.create_secret`) documenté — fait, `MANUEL-SEBA-ADMIN.md` section 2a.
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
