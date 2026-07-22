# SEBA — Audit de l'état actuel du dépôt

Statut : document d'audit. Ne décrit pas l'architecture cible (voir `SEBA_TARGET_ARCHITECTURE.md`) ni la vision produit (voir `SEBA_VISION_CONTRACT.md`, qui prévaut en cas de conflit). Rédigé à partir d'une lecture directe du code, du schéma SQL, des migrations, des Edge Functions et des scripts du dépôt — pas de la mémoire de conversation ni d'anciens audits, sauf mention explicite du contraire.

Hiérarchie des sources appliquée : code exécuté > migrations/schéma > configuration > RLS/fonctions > tests > comportement observé > historique Git > documentation > anciens audits > mémoire > suppositions.

---

## 1. Résumé exécutif

Seba dispose aujourd'hui d'un **moteur professionnel privé réel et globalement bien sécurisé** (authentification universelle patron/employé/client, isolation multi-tenant cohérente, RLS sans faille active identifiée), mais construit sur une base de données **hybride et transitoire** : les cinq entités métier cœur (clients, devis, factures, interventions, employés) vivent encore dans un blob JSON (`seba_state.state`), pendant que les fonctionnalités les plus récentes (demande client, chat de mission, portail client) utilisent déjà des tables normalisées.

Trois constats structurants pour la suite :

1. **Le pipeline "demande qualifiée → conversation → intervention → preuve" existe déjà, mais uniquement pour un client déjà invité par un professionnel qu'il connaît.** Il n'y a aucun chemin pour un visiteur public anonyme — c'est un vide architectural, pas une fonctionnalité mal câblée.
2. **Aucun test automatisé ne protège ce système** (ni RLS, ni isolation multi-tenant, ni parcours métier bout en bout). Le seul gate CI vérifie l'absence de couleurs codées en dur, uniquement sur PR touchant `docs/`. Le déploiement en production (push sur `main`) n'a aucun filet.
3. **La documentation technique existante contient des affirmations obsolètes ou fausses** sur l'état du backend (voir §11) — à ne pas utiliser comme source de vérité sans revérification.

## 2. Réalité du dépôt — vue d'ensemble

| Domaine | Ce qui existe | Statut |
|---|---|---|
| Frontend | 52 pages HTML (`docs/*.html` + `docs/app/dashboard.html`), zéro bundler/framework, CDN only | ACTUEL ET CONFIRMÉ |
| Moteur de données | `docs/seba-data.js` (SebaDB), 1090 lignes, API unifiée locale + synchronisation Supabase | ACTUEL ET CONFIRMÉ |
| Backend | Supabase (Postgres + Auth + Storage), schéma `supabase-schema.sql` (1349 lignes) + 10 migrations datées | ACTUEL ET CONFIRMÉ |
| Edge Functions | 10 fonctions Deno (`supabase-functions/*.ts`) | ACTUEL ET CONFIRMÉ |
| Tests automatisés | Aucun (pas de jest/vitest/playwright, pas de dossier tests/) | ACTUEL ET CONFIRMÉ |
| CI | 1 gate (couleurs en dur, PR seulement) + déploiement sans gate sur push main | ACTUEL ET CONFIRMÉ |

## 3. Fonctions réellement opérationnelles (câblées Supabase, RLS vérifiée)

- **Authentification universelle patron/employé/client** — chacun a sa propre session Supabase Auth, provisionnée par invitation (`client-provision.ts`, `employe-provision.ts`), garde-fou explicite empêchant un patron d'inviter sur un compte qu'il ne possède pas (`client-provision.ts:82-84`). Statut : ACTUEL ET CONFIRMÉ.
- **`client_requests`** (demande client) : cycle complet tracé dans le code — création par le client (`client-espace.html:373-385`), traitement patron (`assignation.html`, création d'intervention + passage `statut='en_cours'`), clôture exclusivement via la RPC `close_my_intervention` (transaction atomique, verrou `FOR UPDATE`, `supabase-schema.sql:1236-1295`). Statut : ACTUEL ET CONFIRMÉ.
- **`seba_messages` avec `request_id`** (chat de mission) : accès scopé en direct sur l'assignation courante — une réassignation coupe l'accès immédiatement, sans purge manuelle (`migrations/20260720_mission_chat.sql:25-29`). Statut : ACTUEL ET CONFIRMÉ.
- **Preuve photo** (`mission-photos`, bucket Storage) : upload direct par l'employé assigné, policies RLS `storage.objects` scopées sur `client_requests.id` (non devinable). Statut : ACTUEL ET CONFIRMÉ.
- **CRUD clients/devis/factures/interventions/employés** : fonctionnel en local-first (écriture immédiate locale, synchronisation différée vers Supabase via file `seba_pending_ops`, debounce 800ms). Statut : ACTUEL ET CONFIRMÉ, avec réserve — voir §6 (résilience).
- **RGPD (suppression de compte patron)** : `erase_account_completely()` couvre correctement toutes les tables satellites via cascade `on delete cascade` vers `seba_state(account)`, y compris les tables créées après cette migration (client_requests, seba_messages) grâce au mécanisme de cascade générique. Statut : ACTUEL ET CONFIRMÉ, mais incomplet (voir §7, gap client/employé).

## 4. Fonctions partielles, simulées ou incohérentes

### Constat — `create_profile_and_company` échoue systématiquement

- **Statut temporel** : ACTUEL ET CONFIRMÉ, non corrigé.
- **Gravité** : élevée (bug reproductible à 100%), mais **impact utilisateur nul aujourd'hui** car aucune page ne relit `profiles`/`companies`.
- **Niveau de confiance** : élevé (contrainte SQL et valeurs JS toutes deux lues et confrontées).
- **Preuve** : `supabase-schema.sql:168` impose `sector text not null check (sector in ('Nettoyage', 'Conciergerie', 'Artisanat'))` (capitalisé). Le code envoie systématiquement des clés internes minuscules (`docs/services/config-dashboard.js:30-35`, `SECTOR_MAPPING` → `'menage'`/`'conciergerie'`/`'maintenance'`/`'autre'`), appelées depuis `docs/bienvenue.html:173-174` et `docs/connexion.html:435`. PostgreSQL étant sensible à la casse, les 4 valeurs réellement envoyées échouent contre la contrainte CHECK.
- **Fichiers concernés** : `supabase-schema.sql:168`, `docs/services/config-dashboard.js:30-35`, `docs/bienvenue.html:173-179`, `docs/connexion.html:427-439`.
- **Impact technique** : l'échec est avalé par un simple `console.error`, sans notification utilisateur, sans nettoyage de `seba_profile_pending` (rejoué à chaque login, échoue à chaque fois).
- **Risque si ignoré** : si une future fonctionnalité venait à relire `profiles`/`companies` (ce qui est probable dans une architecture cible avec fiche publique), elle découvrirait que la table est vide pour tous les comptes existants.
- **Recommandation** : corriger la correspondance de casse/valeurs avant toute réutilisation de `profiles`/`companies`.
- **Phase proposée** : à traiter avant ou pendant la Phase 1 du plan de migration (fondations), indépendamment de la nouvelle vision — c'est un bug préexistant.

### Constat — perte silencieuse de données possible après échec réseau prolongé

- **Statut temporel** : ACTUEL ET CONFIRMÉ.
- **Gravité** : élevée.
- **Preuve** : `docs/seba-data.js:193` (`MAX_OP_ATTEMPTS=5`), lignes 294-298 — au-delà de 5 tentatives, l'opération en attente est retirée de la file avec un simple `console.error`, sans notification UI.
- **Impact utilisateur** : un devis, une facture ou une clôture créée localement peut ne jamais atteindre le serveur si le réseau reste indisponible ou en erreur pendant la fenêtre de retry, sans que l'utilisateur ne soit jamais averti d'un état "non synchronisé".
- **Recommandation** : introduire un indicateur d'état de synchronisation visible et/ou une file de rejeu manuel avant d'ajouter de nouveaux flux critiques (paiement) sur ce même mécanisme.
- **Phase proposée** : à évaluer dans la Phase de sécurisation du socle (voir `SEBA_MIGRATION_PLAN.md`).

### Constat — `businessTypes.js` : 11 secteurs modélisés, seulement 4 atteignables

- **Statut temporel** : DOCUMENTÉ MAIS NON IMPLÉMENTÉ (partiellement) — le code documente lui-même l'écart.
- **Gravité** : informationnelle (dette d'onboarding assumée, pas un bug).
- **Preuve** : `docs/businessTypes.js` modélise 11 secteurs (menage, conciergerie, conciergerieCopro, conciergerieEntreprise, jardinage, maintenance, pressing, beaute, animaux, demenagement, autre). `docs/services/config-dashboard.js:56-59` documente explicitement que 7 d'entre eux sont "inertes en pratique" car aucun parcours d'onboarding ne les rend sélectionnables (`SECTOR_MAPPING` n'en couvre que 4).
- **Pertinence pour la vision** : le contrat de vision prévoit un périmètre sectoriel initial restreint (§12) — cet écart n'est pas un problème à corriger dans l'immédiat, mais une base de configuration déjà disponible pour l'expansion sectorielle future.

### Constat — 17 pages "Infrastructure avancée" déconnectées du moteur réel

- **Statut temporel** : PRÉSENT MAIS NON UTILISÉ (dans le flux principal).
- **Gravité** : modérée (dette d'architecture et de clarté produit).
- **Preuve** : `core-ux.html`, `cockpit-treso.html`, `registre-charges.html`, `bfr-predictif.html`, `compta-expert.html`, `agenda-elastique.html`, `haversine-engine.html`, `mutation-contextuelle.html`, `flotte-telemetrie.html`, `studio-factures.html`, `signature-payment.html`, `crm-tech.html`, `contentieux-recouvrement.html`, `trava-dechets.html`, `prevention-risques.html`, `rh-compagnonnage.html`, `crypto-backup.html` — 0 occurrence de `SebaDB.` sur les 17 fichiers (grep exhaustif). Thème visuel distinct (`docs/styles/main.css`), navigation isolée (`layout-manager.js`).
- **Chevauchements fonctionnels non résolus avec le cœur métier réel** : `crm-tech.html` ≈ `clients.html`/`client-fiche.html` ; `studio-factures.html` ≈ `devis-nouveau.html`/`factures-nouvelle.html` ; `agenda-elastique.html` ≈ `planning.html` ; `mutation-contextuelle.html` ≈ `devis.html`/`factures.html`/`assignation.html` ; `rh-compagnonnage.html` ≈ `equipe.html`.
- **`robots.txt`** ne bloque que 4 de ces 17 pages (incohérence documentée dans le fichier lui-même) — les 13 autres restent indexables malgré leur statut de prototype.
- **Recommandation** : décision binaire nécessaire — matière première à réintégrer (ex. la signature tactile de `signature-payment.html` pourrait alimenter le vrai flux devis) ou dette à isoler explicitement de la navigation/indexation avant toute refonte. Voir `SEBA_MIGRATION_PLAN.md`.

### Constat — `client.html` est un mockup mort, source de confusion

- **Statut temporel** : PRÉSENT MAIS NON UTILISÉ / trompeur.
- **Gravité** : modérée (risque de confusion produit, pas un risque technique).
- **Preuve** : données 100% en dur ("Sophie", "Ménage Express Lyon"), zéro dépendance SebaDB/pro-global.css/guard.js, tous les boutons déclenchent `alert('... à venir.')`. Lié uniquement depuis `docs/widgets.js` (bouton "Voir l'aperçu" du widget Portail du dashboard).
- **Impact** : le patron qui clique "Voir l'aperçu" ne voit pas ce que voit réellement son client — le vrai flux passe par `client-connexion.html` → `client-espace.html`, une paire de pages entièrement différente et fonctionnelle.
- **Recommandation** : à traiter explicitement (suppression, ou remplacement par un vrai aperçu dynamique) avant toute communication publique sur le "portail client".

## 5. Fonctions documentées mais absentes du code

Ces écarts entre promesses marketing et réalité ont été vérifiés par grep exhaustif (pas de simple absence de lecture) :

| Promesse (page, citation) | Recherche effectuée | Résultat |
|---|---|---|
| "Vitrine publique incluse" (`faq.html`) | grep "vitrine publique" sur tout `docs/` | Aucune autre occurrence ; aucune route `/p/{slug}` n'existe. `docs/app/dashboard.html:1922` construit déjà l'URL `seba.app/p/{slug}` dans un bouton "copier le lien" — la convention est anticipée, la route n'existe pas |
| "Signature électronique légale" (`product.html`, `faq.html`) | lecture de `devis.html` | Le flux réel n'a qu'un bouton `marquerSigne()` (changement de statut par clic patron). La vraie signature tactile canvas existe uniquement dans `signature-payment.html`, déconnectée (§4) |
| "Réservation" client self-service (`solution.html` étape 1) | grep "réservation\|booking\|reserv" sur tout `docs/` | Seule occurrence : `client.html:81` (mockup mort, `alert(...)`) |
| "Avis client" / notation (`solution.html` étape 8, `og:description` de plusieurs pages) | grep "avis\|review\|rating\|★" sur `docs/*.js`/`docs/*.html` + `supabase-schema.sql` + migrations | Aucune fonctionnalité réelle. Seul système d'étoiles trouvé : notation interne patron→client dans `crm-tech.html` (page déconnectée, §4), pas un avis public |
| "Paiement en ligne" (`solution.html` étape 7) | lecture de `docs/stripe-service.js` | Le fichier documente lui-même sa nature de démo : `'Lien copié (démo) — branchez Stripe pour encaisser réellement.'` |
| "Relance automatique 5 jours" | lecture de `factures.html` + `supabase-functions/daily-digest.ts` | Le bouton "Relancer" est un clic manuel patron. Le seul cron réel (`daily-digest.ts`, `pg_cron`) est une synthèse IA **au patron**, pas une relance automatique **au client** |
| Sync Google Calendar/iCal (`product.html`) | grep ".ics\|calendar.google\|oauth.*calendar\|CalDAV" | 0 résultat |

Conclusion : le funnel marketing décrit un cycle de vie complet (réservation → ... → avis) qui n'existe qu'à environ 40% dans le code réel. Devis/facture/planning/statuts sont réels ; réservation client, signature tactile réelle, paiement en ligne réel, avis et vitrine publique sont soit des maquettes déconnectées, soit inexistants.

## 6. Dette et risques techniques actuels

| Risque | Gravité | Statut temporel | Fichiers |
|---|---|---|---|
| Aucun test automatisé de RLS/isolation multi-tenant/parcours métier | critique (pour la confiance à accorder à tout changement futur) | ACTUEL ET CONFIRMÉ | absence confirmée sur tout le dépôt |
| Déploiement production (push `main`) sans aucun gate | élevé | ACTUEL ET CONFIRMÉ | `.github/workflows/static.yml` |
| ~30 scripts de vérification historiques cassés (référencent `docs/dashboard.html`, déplacé vers `docs/app/dashboard.html`) | modéré | ACTUEL ET CONFIRMÉ | `scripts/verify-*.js`, `scripts/preview-*.js` |
| `create_profile_and_company` échoue systématiquement | élevé (latent) | ACTUEL ET CONFIRMÉ | voir §4 |
| Perte silencieuse de données après 5 échecs de synchronisation | élevé | ACTUEL ET CONFIRMÉ | voir §4 |
| Compte client/employé invité sans RPC d'auto-suppression RGPD | modéré | ACTUEL ET CONFIRMÉ | voir §7 |
| `seba_employee_token` : chemin de code mort (lu, jamais écrit) | faible | HISTORIQUE ET CORRIGÉ (résidu inoffensif documenté) | `docs/seba-data.js:255-270` |
| `client.html` mockup trompeur | modéré | ACTUEL ET CONFIRMÉ | voir §4 |
| 17 pages "Infrastructure avancée" déconnectées, chevauchements fonctionnels | modéré | ACTUEL ET CONFIRMÉ | voir §4 |
| `robots.txt` incohérent (4/17 pages-outils bloquées seulement) | faible | ACTUEL ET CONFIRMÉ | `docs/robots.txt` |
| `pro-global.css` (14 pages) / `sidebar.js` (12 pages) : rayon d'impact large | informationnel (déjà connu et documenté dans CLAUDE.md) | ACTUEL ET CONFIRMÉ | — |

## 7. RGPD — gap résiduel identifié

- **Constat** : `erase_account_completely()` ne traite que le cas du patron propriétaire de `seba_state` (résolution de `_uid` comme propriétaire du compte). Un client ou un employé invité, disposant de sa propre ligne `auth.users` et de sa propre session, n'a **aucune fonction équivalente pour supprimer ses propres données**.
- **Statut temporel** : ACTUEL ET CONFIRMÉ.
- **Gravité** : modérée.
- **Preuve** : `migrations/2026-07-11-rgpd-suppression-compte.sql`, RPC entière lue — aucune branche ne traite `client_user_id`/`employe_user_id` comme point d'entrée.
- **Recommandation** : à traiter avant tout élargissement du nombre de clients/employés invités (a fortiori avant une ouverture publique), voir `SEBA_SECURITY_AND_TRUST.md`.

## 8. Documentation obsolète ou contradictoire (corrections signalées, non appliquées)

Conformément à la consigne de la mission, ces corrections sont **signalées pour validation humaine**, aucune n'a été appliquée.

### Constat — `docs-backend.md` partiellement obsolète

- **Statut temporel** : ACTUEL ET CONFIRMÉ (le document n'a pas été mis à jour).
- **Preuve** : `docs-backend.md:25` affirme *"Stockage par défaut : localStorage... table unique"* et présente la normalisation en tables comme une étape **future**. Or `client_requests`, `seba_messages`, `client_accounts`, `employe_accounts`, `qa_photos`, `memoire_embeddings`, `materiaux_couts`, `paiements` sont déjà des tables normalisées actives, écrites par de vraies RPC/Edge Functions.
- **Nuance** : vrai uniquement pour les 5 entités métier cœur (clients/devis/factures/interventions/employés), qui restent effectivement dans le blob JSON `seba_state.state` à ce jour.
- **Recommandation** : mettre à jour `docs-backend.md` pour distinguer explicitement "cœur métier encore en blob JSON" vs "modules récents déjà normalisés", avant qu'un futur développeur ne s'y fie pour une décision d'architecture.

### Constat — `strategie/Seba-vision-strategie.md` se déclare "Constitution du projet"

- **Statut temporel** : FAUX OU PÉRIMÉ pour la portée qu'il revendique.
- **Preuve** : `strategie/Seba-vision-strategie.md:3` — *"Statut : Constitution du projet. Toute décision de développement, de design ou de priorisation se confronte à ce document."* Ce document décrit une vision purement B2B ("OS des entreprises de services") sans face publique, avec une roadmap V1/V2/V3 où la "marketplace" n'apparaît qu'en V3, après l'IA.
- **Conflit** : `_architecture/SEBA_VISION_CONTRACT.md` est désormais la source de vérité stratégique officielle (validée explicitement par l'utilisateur), et prévaut sur ce document plus ancien en cas de contradiction sur la vision produit.
- **Recommandation** : mettre à jour le statut de ce document (ex. "historique — remplacé par SEBA_VISION_CONTRACT.md pour la vision produit, conserve sa valeur pour les principes d'exécution §3/§4/§8") plutôt que le supprimer — il contient des principes toujours pertinents (obsession de la vitesse, anti-objectifs, importance de la confiance) qui ne contredisent pas le nouveau contrat.

### Constat — `strategie/plan-marche-produit-2026.md` contient une affirmation aujourd'hui fausse

- **Statut temporel** : HISTORIQUE — vrai au moment de sa rédaction, FAUX aujourd'hui.
- **Preuve** : le document affirme *"Tout est encore une démo localStorage. Zéro backend, zéro vraie donnée, zéro vrai compte."* Cette affirmation est antérieure à l'authentification universelle (2026-07-19) et aux tables normalisées récentes (client_requests, mission chat, 2026-07-19/20) — elle ne reflète plus l'état actuel du dépôt (voir §3).
- **Recommandation** : dater explicitement ce document comme "photographie du 2026-07 (avant Phase B)" pour éviter qu'il soit lu comme une description actuelle.

## 9. Contradictions et zones grises restantes

- Deux pages "client" historiquement homonymes (`client.html` mort vs `client-espace.html` réel) créent un risque de confusion pour quiconque audite rapidement le dépôt sans lire le contenu — signalé explicitement pour que la future architecture tranche ce cas (suppression ou redirection).
- La convention d'URL publique `seba.app/p/{slug}` est déjà présente dans le code (bouton copier-lien du dashboard) sans qu'aucune route ne l'implémente — c'est un indice qu'une intention de fiche publique existait déjà avant ce contrat de vision, à concilier avec la nouvelle conception plutôt qu'ignorer.
- Le niveau de couverture RLS est bon partout où il a été vérifié, mais **rien ne le prouve automatiquement** (voir §6) — la confiance actuelle repose sur une lecture humaine ponctuelle (cet audit), pas sur un contrôle reproductible.

## 10. Fichiers cités dans cet audit (racine du dépôt sauf mention contraire)

`supabase-schema.sql` · `migrations/*.sql` (10 fichiers) · `supabase-functions/*.ts` (10 fichiers) · `docs/seba-data.js` · `docs/auth.js` · `docs/guard.js` · `docs/businessTypes.js` · `docs/services/config-dashboard.js` · `docs/onboarding.html` · `docs/bienvenue.html` · `docs/connexion.html` · `docs/client-espace.html` · `docs/client-fiche.html` · `docs/client.html` · `docs/client-connexion.html` · `docs/espace-terrain.html` · `docs/assignation.html` · `docs/reset-password.html` · `docs/app/dashboard.html` · `docs/pro-global.css` · `docs/sidebar.js` · `docs/identity-bar.js` · `docs/robots.txt` · `docs/sitemap.xml` · `docs/manifest.json` · `docs/sw.js` · `docs/offline.html` · `docs-backend.md` · `strategie/Seba-vision-strategie.md` · `strategie/plan-marche-produit-2026.md` · `strategie/plan-de-construction.md` · `.github/workflows/static.yml` · `.github/workflows/qa-and-lint.yml` · `package.json` · `eslint.config.js` · `deno.json` · `tools/check-design-system.js` · `tools/chaos-monkey.js` · `tools/orchestrator.js` · `scripts/*.js` (~48 fichiers).

**Non vérifiable depuis ce dépôt** : configuration réelle Supabase de production (secrets Vault, `verify_jwt` par Edge Function, exécution effective de toutes les migrations dans l'ordre sur le projet réel).
