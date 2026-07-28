# Seba — Master Backlog

Dernière mise à jour : 2026-07-28
Branche observée : fix/account-activation-bootstrap
Commit observé : (mis à jour au commit de livraison de cette branche)

## Règle de fonctionnement

- ce fichier est la source de vérité unique des tâches restantes du projet Seba ;
- une tâche doit être ajoutée ici dès qu'elle est décidée ;
- une tâche passe à EN COURS au démarrage ;
- une tâche est retirée des sections actives après livraison prouvée (commit, PR, test ou validation externe) ;
- aucune tâche ne peut être marquée terminée sans preuve ;
- aucune nouvelle checklist concurrente ne doit être créée (voir `_architecture/DEPLOYMENT_CHECKLIST.md` et `PLAN.md`, dont les tâches actives ont été centralisées ici).

## Ordre recommandé (priorités de livraison)

1. Correctif critique d'activation sur `main` (AUTH-006).
2. Migration `account-activation-bootstrap` distante (AUTH-007).
3. Contrôle CI design system (CORE-008).
4. Achat du domaine et activation Resend (CED-004).
5. Validation réelle des emails (CED-008).
6. Validation terrain du pilote (PILOT-001).
7. Automatisations seulement après l'envoi manuel réel (AUTO-001).

## À terminer maintenant

| ID | Priorité | Domaine | Tâche | Statut | Dépendance ou blocage | Prochaine action exacte | Preuve/source |
|---|---|---|---|---|---|---|---|
| AUTH-006 | P0 | Authentification | Le correctif critique d'activation (`67d9925` : bootstrap `seba_state` à l'activation patron + redirection par rôle sur `reset-password.html`) n'existe QUE sur `feature/customer-email-delivery`/PR #94 (Draft, reste distincte et bloquée par le domaine — voir CED-004) — absent de `main`, donc absent de la production. Extraction en cours sur `fix/account-activation-bootstrap` (fichiers ciblés uniquement, aucun code Customer Email Delivery). Correction supplémentaire découverte pendant l'extraction : la migration originale faisait un `CREATE OR REPLACE` naïf qui aurait effacé le durcissement T2 (SECURITY DEFINER, search_path, idempotence profiles/companies) si rejouée après T2 — corrigée avant tout test | EN COURS | Aucune | Faire passer `qa-account-activation.js` (20/20), ouvrir une PR Ready (pas Draft) vers `main`, merger, puis archiver avec preuve | Branche `fix/account-activation-bootstrap` ; migration corrigée dans `migrations/2026-07-28-account-activation-bootstrap.sql` |
| AUTH-007 | P0 | Authentification | `migrations/2026-07-28-account-activation-bootstrap.sql` n'a jamais été appliquée sur le projet Supabase distant `ptmudezhxnhhyctowlqp` (seule `2026-07-28-commercial-email-delivery.sql` a été confirmée appliquée) — un nouveau patron en production aujourd'hui n'a toujours aucune ligne `seba_state` et ne peut réellement rien écrire (401 en boucle) | À FAIRE | AUTH-006 (mérger le correctif avant de l'appliquer en base, ordre recommandé) | Appliquer la migration dans le SQL Editor distant, puis valider en créant un vrai nouveau compte patron et en vérifiant sa première écriture | Aucune preuve d'application distante trouvée ; `migrations/2026-07-28-account-activation-bootstrap.sql` absent de `main` |
| CORE-008 | P2 | Socle produit | `.github/workflows/static.yml` déploie sur `main` sans exécuter aucun lint/`check-design-system` avant déploiement | À FAIRE | Aucune — contenu déjà proposé (DEC-011) | Ajouter une étape `node tools/check-design-system.js` avant `actions/upload-pages-artifact` | `.github/workflows/static.yml` (vérifié : aucune étape de vérification) ; `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 10 |

## Bloqué par une action externe

| ID | Priorité | Domaine | Tâche | Statut | Dépendance ou blocage | Prochaine action exacte | Preuve/source |
|---|---|---|---|---|---|---|---|
| CED-004 | P0 | Customer Email Delivery | Acheter un nom de domaine Seba, l'ajouter dans Resend, configurer SPF/DKIM, attendre la validation | BLOQUÉ | Action fondateur (achat + attente DNS) | Achat du domaine par le fondateur | `_architecture/DEPLOYMENT_CHECKLIST.md` ; `MANUEL-SEBA-ADMIN.md` ligne 14 (sandbox Resend = même cause racine) |
| CED-006 | P1 | Customer Email Delivery | Configurer les secrets distants `RESEND_API_KEY`/`EMAIL_FROM`/`APP_BASE_URL`/`RESEND_WEBHOOK_SECRET` (noms seulement, jamais les valeurs ici) | BLOQUÉ | CED-004 | Une fois le domaine validé, saisir les secrets dans Supabase → Edge Functions → Secrets | `_architecture/DEPLOYMENT_CHECKLIST.md` |
| CED-007 | P1 | Customer Email Delivery | Config Resend complète : domaine expéditeur validé, webhook configuré, événements limités aux événements gérés, secret webhook, test de signature réelle | BLOQUÉ | CED-004, CED-006 | Configurer le webhook Resend une fois le domaine validé, tester une signature réelle | `supabase/functions/commercial-email-webhook/index.ts` |
| CED-008 | P1 | Customer Email Delivery | Validation réelle en production : invitations (patron/client/employé), reset (patron/client/employé), envoi devis/facture/reçu, deep-link post-auth, isolation client A/B, idempotence, statuts sent/delivered/failed, zéro secret exposé | BLOQUÉ | CED-004, CED-006, CED-007 | Rejouer `scripts/qa-account-activation.js` + les scénarios d'envoi contre le projet distant une fois le domaine validé | `scripts/qa-customer-email-delivery-phase1.js`, `scripts/qa-customer-email-delivery-phase2.js` (équivalents locaux déjà écrits) |
| AUTH-005 | P2 | Authentification | Statut de livraison réel + bouton "Réessayer l'envoi" pour les invitations client/employé (`generateLink()` + envoi direct via l'API Resend au lieu de `auth.admin.inviteUserByEmail()`, table `invitation_log`, UI `client-fiche.html`/`employe-fiche.html`) — comportement utile déjà écrit sur `fix/invitation-delivery` (commit `7193874`), non porté : dépend de `RESEND_API_KEY` (même blocage externe que CED-004/CED-006) et casserait Mailpit en local tant que ce secret n'existe pas | BLOQUÉ | CED-004, CED-006 | Une fois CED-004/CED-006 résolus, réévaluer le portage de `supabase-functions/_shared/invitation-delivery.ts` + `migrations/2026-07-23-invitation-delivery-log.sql` sur `feature/customer-email-delivery`, en vérifiant `scripts/qa-account-activation.js` derrière | Branche `fix/invitation-delivery` (diff isolé via `git diff 63fb0d9 fix/invitation-delivery`) |
| RGPD-001 | P1 | RGPD | Aucune fermeture/effacement en self-service pour un compte client/employé invité (`erase_account_completely` ne couvre que le patron) | À DÉCIDER | Décision fondateur sur 9 points avant tout code (fermeture accès / effacement personnel / anonymisation métier / conservation légale factures / messages / Storage / multi-compte / dual-rôle / traçabilité) | Soumettre le design révisé (pas un simple strip JSONB, déjà rejeté) au fondateur pour arbitrage point par point | Mémoire `project_rgpd_client_employee_deletion_debt` (rejet explicite 2026-07-22) |
| LEGAL-001 | P2 | Juridique | Avis juridique sur la responsabilité de la plateforme en cas de dommage causé par un professionnel "vérifié" | BLOQUÉ | Juriste non assigné | Engager un juriste | `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 15 |
| LEGAL-002 | P2 | Juridique | Avis RGPD/CNIL sur les nouveaux flux publics (téléphone visiteur, fiche publique, liste d'attente) + cookies + rédaction CGV | BLOQUÉ | Juriste RGPD non assigné | Engager un prestataire RGPD/juriste | `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 16 ; `AUDIT-EXPERT.md` §8 |
| LEGAL-003 | P1 | Juridique/Comptable | Vérification de conformité facturation France avant toute facturation réelle émise via Seba | BLOQUÉ | Expert-comptable non assigné | Engager un expert-comptable | `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 14 |
| LEGAL-004 | P2 | Juridique | `docs/politique-confidentialite.html` contient toujours le placeholder `[À compléter par le fondateur : raison sociale, forme juridique, SIREN, adresse du siège]` | BLOQUÉ | Fondateur (identité légale réelle) | Le fondateur fournit raison sociale/SIREN/adresse | `docs/politique-confidentialite.html:72` (vérifié présent) |
| PILOT-001 | P1 | Pilote | GATE-0 — validation terrain (10 professionnels nettoyage/conciergerie + 5 acteurs demande, zone Cap-d'Ail/Beausoleil/Roquebrune/Menton) jamais réalisée ; bloque tout le Groupe 3/4/5 | BLOQUÉ | Action fondateur (entretiens réels) | Le fondateur conduit les entretiens, rédige la synthèse, enregistre GO/AJUSTER/STOP dans `SEBA_DECISION_LOG.md` | `_architecture/SEBA_EXECUTION_ROADMAP.md` §GATE 0 ; `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 1 |

## À faire ensuite

| ID | Priorité | Domaine | Tâche | Statut | Dépendance ou blocage | Prochaine action exacte | Preuve/source |
|---|---|---|---|---|---|---|---|
| CORE-001 | P2 | Socle produit | Périmètre P5 (analytique financière) incomplet : tables `intervention_materiaux`/`intervention_trajets`/`fournisseurs_prix_historique`, table `client_payment_history` + prédiction impayés, widget dashboard "marge réelle" | À FAIRE | Aucune | Concevoir le schéma des 3 tables restantes, puis le widget consommant `vue_marge_interventions`/`get_marge_reelle` | `PLAN.md` lignes 34-36 |
| CORE-002 | P2 | Socle produit | Aucun environnement CI/CLI Deno n'a jamais exécuté réellement la suite de tests unitaires (`*.test.ts` : sync-push, vision-qa, conscience-seba, llm-providers, invitation-delivery…) | À FAIRE | Aucune | Ajouter Deno CLI/CI (localement ou en pipeline) et exécuter la suite au moins une fois | `PLAN.md` ligne 53 |
| CORE-004 | P2 | Socle produit | Aucune métrique de monitoring serveur : échecs de synchro, latence `vision-qa`, backlog d'alertes ne remontent qu'en `console.warn` local, jamais au patron/admin | À FAIRE | Aucune | Construire au minimum la métrique "sync failures" + latence vision-qa | `PLAN.md` ligne 69 ; `AUDIT-GO-LIVE-SEBA.md` ligne 131 |
| PILOT-002 | P2 | Pilote | Groupe 1bis — formulaire de liste d'attente publique (finalité, données, consentement, conservation, anti-spam, notification fondateur) | À FAIRE | Doit rester sans retarder aucune tâche active | Définir finalité/données strictement nécessaires, puis construire le formulaire | `_architecture/SEBA_EXECUTION_ROADMAP.md` §Groupe 1bis |
| DASH-001 | P2 | Dashboard | Décision bloquante en attente avant la Phase 1 du Dashboard V2 Master Plan (non précisée plus avant dans ce backlog pour éviter la duplication du plan complet) | À DÉCIDER | Arbitrage fondateur/produit | Lire `DASHBOARD_V2_MASTER_PLAN.md` §"Décision en attente" et trancher | `_architecture/DASHBOARD_V2_MASTER_PLAN.md` ligne 25 |

## À décider

| ID | Priorité | Domaine | Tâche | Statut | Dépendance ou blocage | Prochaine action exacte | Preuve/source |
|---|---|---|---|---|---|---|---|
| CORE-006 | P2 | RGPD/Socle | Tension non tranchée entre append-only (`sync_operations`) et droit à l'effacement Art. 17 — `eraseAllData()` ne purge pas `sync_operations`/`employe_sessions`/`employe_credentials` côté serveur | À DÉCIDER | Probable anonymisation plutôt que suppression physique — non tranché | Faire trancher par le fondateur (avec avis juridique si nécessaire, voir LEGAL-002) | `PLAN.md` ligne 72 |
| CORE-007 | P3 | Socle produit | Sort des scripts `verify-*`/`preview-*` potentiellement obsolètes (inventaire fait) | À DÉCIDER | Autorisation d'archivage non donnée | Le fondateur autorise l'archivage ou la suppression | `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 4 ("Inventaire fait — décision d'archivage en attente d'autorisation") |
| QA-002 | P3 | QA | Dérive de date/heure des baselines visuelles du dashboard (expirent à minuit et selon le message d'accueil horaire) — fix par gel d'horloge proposé, jamais autorisé | À DÉCIDER | Autorisation fondateur | Le fondateur valide (ou non) le gel d'horloge dans `qa-dashboard-full.js`/`qa-visual-regression.js` | Mémoire `project_qa_baseline_date_drift` |

## Reporté

| ID | Priorité | Domaine | Tâche | Statut | Dépendance ou blocage | Prochaine action exacte | Preuve/source |
|---|---|---|---|---|---|---|---|
| AUTO-001 | P3 | Automatisations email | `send_quote_email`/`send_invoice_email`/`send_receipt_email`, intégration builder, idempotence des exécutions automatiques, QA final | REPORTÉ | L'envoi manuel réel doit d'abord être validé en production (CED-008) | Reprendre après validation réelle de CED | Instruction explicite de ce chantier (2026-07-28) |
| PILOT-003 | P3 | Pilote | Groupes 3 à 6 — face publique complète (fiche publique, revendication, demandes qualifiées, pilote restreint) | REPORTÉ | PILOT-001 (GATE-0) non résolu | Ne démarre qu'après décision GO/AJUSTER enregistrée dans `SEBA_DECISION_LOG.md` | `_architecture/SEBA_EXECUTION_ROADMAP.md` Groupes 3-6 |
| CORE-003 | P3 | Socle produit | Pas de killswitch DB pour `vision-qa.ts`/`sync-push.ts` (seul le trigger d'alerte a un vrai killswitch) — proposition `app_config(key,value)` déjà écrite, jamais créée | REPORTÉ | Non prioritaire | Créer `app_config` quand un vrai besoin d'arrêt d'urgence se présente | `PLAN.md` ligne 68 (vérifié : table `app_config` absente du schéma) |
| CORE-005 | P3 | Sécurité | Comparaison à temps constant manquante pour le secret dans `notify-alert.ts` | REPORTÉ | Sévérité faible, non bloquant | Remplacer la comparaison directe par une comparaison à temps constant | `PLAN.md` ligne 70 |
| QA-001 | P3 | QA | `AUDIT-GO-LIVE-SEBA.md`/`AUDIT-EXPERT.md` contiennent des cases `- [ ]` obsolètes pour du travail déjà livré (vérifié : `revoke execute`/`AbortSignal.timeout`/`robots.txt`+`sitemap.xml` déjà présents dans le code) | REPORTÉ | Hygiène documentaire, non bloquant | Cocher ou archiver ces 2 rapports lors d'un prochain passage doc | Vérification directe : `supabase-schema.sql` (7×`revoke execute`), `supabase-functions/vision-qa.ts:111`, `docs/robots.txt`+`docs/sitemap.xml` présents |
| LEGAL-005 | P3 | Juridique | Vérification juridique/fiscale/opérationnelle d'une ouverture à Monaco | REPORTÉ | Juriste droit du travail/fiscalité transfrontalière, non urgent | Aucune — explicitement reporté | `_architecture/SEBA_OWNERS_AND_DEADLINES.md` ligne 17 |

## Archive récente

| ID | Tâche terminée | Preuve |
|---|---|---|
| CED-001 | Customer Email Delivery — Phase 1 (backend) | commit `cba633b` |
| CED-002 | Customer Email Delivery — Phase 2 (interface) | commit `9e56065` |
| CED-003 | Activation réelle des comptes et accès (bootstrap `seba_state` + redirection par rôle sur `reset-password.html`) + `scripts/qa-account-activation.js` (20/20) — **développé et testé en LOCAL uniquement** : absent de `main`, absent du Supabase distant (voir AUTH-006/AUTH-007, tâches actives tant que ce n'est pas corrigé) | commit `67d9925` |
| CED-DOC | Documentation des prérequis de déploiement (domaine/Resend) | commit `8b7d688`, `_architecture/DEPLOYMENT_CHECKLIST.md` |
| BILLING-001 | Devis/factures — modes simple/avancé + création flexible des documents commerciaux | commit `e8e7f53`, PR #93, `main` à `d2e4e77` |
| AUTH-002 | T2 — correction `create_profile_and_company` (idempotence secteur) | branche `fix/t2-onboarding-sector-idempotence`, fusionnée dans `main`, `migrations/2026-07-22-fix-t2-onboarding-sector-idempotence.sql` |
| AUTH-003 | T3 — fiabilité de la synchronisation (retry/recovery) | branche `fix/t3-sync-retry-recovery`, fusionnée dans `main` |
| AUTH-004 | Chevauchement `fix/invitation-delivery` vs `feature/customer-email-delivery` résolu SANS merge : diff isolé (`git diff 63fb0d9 fix/invitation-delivery`) montre que le socle (invitation, liaison compte, redirection par rôle) est déjà couvert et testé (67d9925, 20/20) ; le comportement réellement absent (statut de livraison réel + retry) dépend de `RESEND_API_KEY`, bloqué par la même cause que CED-004 — reporté en `AUTH-005`, branche non mergée conservée telle quelle, aucun code modifié | Décision documentée dans ce fichier (`AUTH-005` ci-dessus) ; commit `77fbb5f` |
| CED-009 | Draft PR ouverte pour `feature/customer-email-delivery` → `main`, description couvrant Phase 1/2 terminées, activation corrigée, blocage domaine, migrations/Edge Functions non déployées, automatisations reportées | PR #94 (`feat(email): add commercial document delivery`, draft, non mergée) |
| CED-005 | Backend distant déployé sur le projet Supabase `ptmudezhxnhhyctowlqp` : migration `2026-07-28-commercial-email-delivery.sql` appliquée avec succès (confirmé fondateur), `send-commercial-document` déployée avec vérification JWT active (`verify_jwt:true`), `commercial-email-webhook` déployée avec `--no-verify-jwt` (protégée par sa propre vérification cryptographique de signature Resend/Svix, `verifySvixSignature` toujours présente dans le code) — aucun secret configuré, aucun envoi réel déclenché | `npx supabase functions list --project-ref ptmudezhxnhhyctowlqp` (les deux fonctions `ACTIVE`) |

**Note de correction** : `_architecture/SEBA_OWNERS_AND_DEADLINES.md` (daté 2026-07-22) affiche encore les lignes 5 et 6 (T2/T3) comme "correction NON ASSIGNÉE" — vérifié obsolète : les deux branches sont fusionnées dans `main` (`git branch --merged main`). Ne pas se fier à ce document sans vérification Git — voir AUTH-002/AUTH-003 ci-dessus.
