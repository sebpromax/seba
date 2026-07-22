# SEBA — Dossier d'exécution A : Groupe 1 (stabilisation technique du socle privé)

Statut : plan d'exécution détaillé, aucune correction n'est engagée. Ne modifie aucun fichier produit. S'appuie sur `SEBA_CURRENT_STATE_AUDIT.md` et `SEBA_SECURITY_AND_TRUST.md` pour les preuves, `SEBA_EXECUTION_ROADMAP.md` pour le positionnement dans la feuille de route globale.

---

## 1. Ordre réel de dépendance

```
T0 Documentation environnements/secrets ──┐
T1 Scripts cassés (nettoyage)             │  peuvent démarrer
T2 create_profile_and_company             │  immédiatement,
T3 Fiabilité de la synchronisation        │  en parallèle,
T4 RGPD client/employé                    │  sans se bloquer entre eux
                                           │
                                           ▼
T5 Tests RLS + isolation multi-tenant  (dépend de T0 ; couvre idéalement T2 et T4 une fois posés)
                                           │
                                           ▼
T6 / DEC-011 Contrôle minimal avant déploiement (version minimale indépendante ; version complète dépend de T5)
```

**Tâches réellement parallélisables** : T0, T1, T2, T3, T4 n'ont aucune dépendance entre elles — elles peuvent être menées simultanément par une ou plusieurs personnes sans coordination particulière, seulement une revue finale commune. T5 est la seule tâche qui a une vraie dépendance dure (T0) et un intérêt technique à suivre T2/T4 plutôt qu'à les précéder (pour tester le comportement corrigé, pas l'ancien bug). T6 a une version minimale indépendante de tout, et une version complète qui attend T5.

---

## T0 — Documentation des environnements et secrets

- **Problème exact** : aucune documentation à jour ne décrit quels environnements Supabase existent (production seule, ou aussi un projet de test/staging), ni où vivent les secrets (Vault Supabase, `.env`, `docs/config.js`), ni qui a accès à quoi.
- **Preuve dans le dépôt** : `docs/config.js` est gitignoré (clé anon + URL) ; `docs/config.public.js` est public par design ; `.env`/`.env.example` existent à la racine pour les scripts Node (orchestrateur, chaos-monkey) ; aucune trace d'un second projet Supabase (staging) nulle part dans le dépôt ; `docs-backend.md` documente le branchement Supabase mais pas la séparation d'environnements.
- **Gravité** : élevée — sans savoir s'il existe un environnement de test séparé de la production, T5 (tests RLS) risque soit de ne jamais être écrit par prudence, soit d'être exécuté par erreur contre des données réelles.
- **Fichiers concernés** : aucun fichier de code, un document à créer/compléter (`docs-backend.md` ou un nouveau document dédié, à trancher).
- **Données concernées** : aucune donnée applicative, uniquement de la documentation de configuration.
- **Prérequis** : aucun.
- **Solution proposée** : documenter explicitement (a) s'il existe ou non un projet Supabase de test distinct de la production, (b) si non, décider s'il faut en créer un avant T5, (c) lister les secrets existants et leur mode de rotation actuel (Vault Supabase — non vérifiable depuis ce dépôt, à confirmer humainement dans la console).
- **Alternatives envisagées** : écrire les tests RLS directement contre la production avec des comptes de test dédiés et nettoyés après coup (plus rapide à démarrer, mais risque réel si un test mal écrit modifie des données réelles) ; créer un projet Supabase de test séparé (plus sûr, coût de mise en place non nul mais faible — un projet Supabase gratuit supplémentaire).
- **Tests à écrire** : aucun, c'est une tâche de documentation/décision.
- **Critères d'acceptation** : un document répond sans ambiguïté à "où puis-je exécuter un test RLS sans risque pour les données réelles ?".
- **Risque de régression** : aucun.
- **Plan de retour arrière** : sans objet (documentation).
- **Ordre d'exécution** : peut démarrer immédiatement, en parallèle de tout.
- **Estimation grossière** : petite (si un projet de test existe déjà ou est simple à créer) à moyenne (si la création d'un environnement de test doit être mise en place de zéro).
- **Ce qui ne doit surtout pas être modifié** : aucun secret ne doit être documenté en clair dans un fichier versionné — cohérent avec la règle déjà existante du projet sur `docs/config.js`.

## T1 — Vérification des scripts cassés avant archivage ou suppression

- **Problème exact** : environ 30 scripts (`scripts/verify-*.js`, `scripts/preview-*.js`) référencent `docs/dashboard.html`, un chemin qui n'existe plus (déplacé vers `docs/app/dashboard.html`). Environ 10 autres supposent un serveur local manuel sur `localhost:8791` non documenté.
- **Preuve dans le dépôt** : confirmé par `ls docs/dashboard.html` (inexistant) vs `ls docs/app/dashboard.html` (existant) ; grep sur les scripts confirmant le chemin non préfixé `app/`.
- **Gravité** : faible en soi (ces scripts ne sont jamais appelés en CI), mais génère une confusion réelle pour quiconque explore le dépôt et croit à tort qu'il existe une suite de tests active.
- **Fichiers concernés** : ~40 fichiers dans `scripts/`.
- **Données concernées** : aucune.
- **Prérequis** : aucun.
- **Solution proposée** : vérifier un par un (ou par lot, script par script, en confirmant l'absence d'appel depuis `package.json`, `tools/orchestrator.js`, ou tout processus manuel documenté) puis déplacer vers `scripts/archive/` (conserver, ne pas supprimer — certains contiennent une logique de vérification réutilisable si un jour le dashboard redevient une cible de test) plutôt que supprimer directement.
- **Alternatives envisagées** : suppression directe (plus radical, perd la logique de vérification déjà écrite si elle redevient utile) ; correction des chemins pour les faire fonctionner à nouveau (coût largement disproportionné vu qu'aucun n'est un test de régression réel, seulement des vérifications ponctuelles historiques).
- **Tests à écrire** : aucun (l'archivage n'a pas besoin d'être testé).
- **Critères d'acceptation** : plus aucun script actif du dépôt ne référence un chemin de fichier inexistant ; les scripts archivés restent consultables mais clairement signalés comme non fonctionnels en l'état.
- **Risque de régression** : nul (aucun de ces scripts n'est appelé par la CI ni par un processus documenté).
- **Plan de retour arrière** : trivial (déplacement de fichiers, réversible par un simple retour de dossier).
- **Ordre d'exécution** : peut démarrer immédiatement, en parallèle de tout.
- **Estimation grossière** : petite.
- **Ce qui ne doit surtout pas être modifié** : ne pas toucher aux 4-6 scripts encore réellement réutilisables identifiés dans l'audit (`qa-dashboard-full.js`, `qa-visual-regression.js`, `mobile-audit.js`, `check-404.js`, `qa-onboarding-flow.js`, `qa-other-sweep/linkcheck.js`) — vérifier explicitement qu'ils ne sont pas inclus dans le lot archivé par erreur.

## T2 — Correction de `create_profile_and_company`

- **Problème exact** : la RPC échoue systématiquement pour les 4 valeurs de secteur réellement envoyées par l'onboarding, à cause d'une incompatibilité de casse/valeurs entre le mapping JS et la contrainte SQL.
- **Preuve dans le dépôt** : `supabase-schema.sql:168` — `sector text not null check (sector in ('Nettoyage', 'Conciergerie', 'Artisanat'))` (capitalisé) ; `docs/services/config-dashboard.js:30-35` (`SECTOR_MAPPING`) envoie `'menage'`/`'conciergerie'`/`'maintenance'`/`'autre'` (minuscules) ; appelé depuis `docs/bienvenue.html:173-179` et `docs/connexion.html:427-439` ; l'échec est avalé par un simple `console.error`, sans notification utilisateur, sans nettoyage de `seba_profile_pending`.
- **Gravité** : élevée (bug reproductible à 100%), impact utilisateur actuellement nul (aucune page ne relit `profiles`/`companies`) — mais bloquant pour toute réutilisation future de cette table (fiche publique notamment).
- **Fichiers concernés** : `supabase-schema.sql` (contrainte CHECK), `docs/services/config-dashboard.js` (mapping), potentiellement `docs/bienvenue.html`/`docs/connexion.html` (gestion de l'échec).
- **Données concernées** : `profiles`, `companies` — actuellement vides pour tous les comptes existants (la RPC n'a jamais réussi).
- **Prérequis** : aucun.
- **Solution proposée** : deux façons de corriger, à choisir explicitement (voir alternatives) — la plus sûre est d'élargir la contrainte CHECK pour accepter les valeurs réellement envoyées (`'menage'`, `'conciergerie'`, `'maintenance'`, `'autre'`) plutôt que de changer le mapping JS, car élargir une contrainte SQL est un changement moins risqué qu'une modification du frontend qui pourrait avoir d'autres effets de bord non anticipés.
- **Alternatives envisagées** : (a) modifier `SECTOR_MAPPING` pour envoyer les valeurs capitalisées attendues par le SQL — risque : si `SECTOR_MAPPING` est utilisé ailleurs pour d'autres finalités avec la casse actuelle, ce changement pourrait avoir un effet de bord non prévu ; (b) élargir la contrainte CHECK côté SQL — recommandée, changement isolé et réversible ; (c) ignorer ce bug pour l'instant puisqu'il est sans impact observable — écartée, car la fiche publique dépendra de cette table (`SEBA_DOMAIN_MODEL.md` §2).
- **Tests à écrire avant ou avec la correction** : un test qui appelle la RPC avec les 4 valeurs réellement envoyées par le frontend et vérifie un succès ; un test qui vérifie qu'une valeur non reconnue est bien rejetée (pour ne pas simplement supprimer toute validation).
- **Critères d'acceptation** : `create_profile_and_company` réussit pour `'menage'`, `'conciergerie'`, `'maintenance'`, `'autre'` ; un compte existant qui rejoue son profil en attente (`seba_profile_pending`) voit enfin une ligne créée dans `profiles`/`companies`.
- **Risque de régression** : faible — élargir une contrainte CHECK ne peut pas casser un comportement qui fonctionnait déjà (il ne fonctionnait pas). Le seul risque est d'accepter par erreur une valeur non désirée si la nouvelle liste est mal composée.
- **Plan de retour arrière** : trivial — une migration inverse qui restaure l'ancienne contrainte, sans perte de données puisque la table était vide auparavant.
- **Ordre d'exécution** : peut démarrer immédiatement, en parallèle de tout.
- **Estimation grossière** : petite.
- **Ce qui ne doit surtout pas être modifié** : ne pas toucher à `businessTypes.js` (les 11 secteurs modélisés côté frontend sont indépendants de cette table et de sa contrainte) ; ne pas élargir la contrainte au-delà des 4 valeurs réellement envoyées aujourd'hui, pour ne pas introduire silencieusement de nouvelles valeurs non prévues.

## T3 — Fiabilité de la synchronisation locale → cloud

### T3a — Traitement visible des échecs de synchronisation
- **Problème exact** : une opération locale (création de devis, facture, etc.) qui échoue à se synchroniser après épuisement des tentatives est silencieusement abandonnée, sans qu'aucune notification n'informe l'utilisateur.
- **Preuve dans le dépôt** : `docs/seba-data.js:193` (`MAX_OP_ATTEMPTS=5`), lignes 294-298 (abandon avec `console.error` uniquement).
- **Gravité** : élevée.
- **Fichiers concernés** : `docs/seba-data.js` (logique), potentiellement un composant UI partagé (toast/bannière) à créer ou réutiliser.
- **Données concernées** : toute donnée créée via le CRUD générique (clients, devis, factures, interventions, employés).
- **Prérequis** : aucun.
- **Solution proposée** : exposer un état de synchronisation consultable (`SebaDB.onChange` existe déjà comme mécanisme d'écoute — l'étendre pour signaler un état "non synchronisé" par opération) et afficher une notification visible (bannière ou badge) tant qu'une opération reste en échec.
- **Alternatives envisagées** : notification bloquante (modal empêchant de continuer) — écartée, trop intrusive pour un problème réseau temporaire ; simple log console amélioré sans UI — écartée, ne résout pas le problème pour l'utilisateur final.
- **Tests à écrire** : test simulant un échec réseau répété et vérifiant qu'un état visible apparaît côté UI.
- **Critères d'acceptation** : un utilisateur peut voir qu'une opération n'est pas synchronisée sans ouvrir la console développeur.
- **Risque de régression** : faible (ajout d'un indicateur, pas de changement du chemin de synchronisation existant).
- **Plan de retour arrière** : trivial (retrait de l'indicateur UI).
- **Ordre d'exécution** : peut démarrer immédiatement, en parallèle de tout.
- **Estimation grossière** : petite à moyenne (dépend du composant UI choisi).
- **Ce qui ne doit surtout pas être modifié** : ne pas changer le mécanisme de retry lui-même (800ms, 5 tentatives) sans une raison distincte — cette tâche ne concerne que la visibilité, pas la logique de tentative.

### T3b — Protection contre la perte silencieuse de données
- **Problème exact** : au-delà de 5 tentatives, l'opération est retirée de la file d'attente définitivement — les données restent en local (`localStorage`) mais ne sont plus jamais retentées automatiquement.
- **Preuve dans le dépôt** : `docs/seba-data.js:294-298`.
- **Gravité** : élevée.
- **Fichiers concernés** : `docs/seba-data.js`.
- **Données concernées** : toute opération abandonnée après échec répété.
- **Prérequis** : bénéficie de T3a (l'utilisateur doit être informé pour pouvoir agir).
- **Solution proposée** : au lieu de supprimer l'opération de la file après 5 échecs, la déplacer vers une file "en échec persistant" distincte, non supprimée, permettant un nouveau essai manuel déclenché par l'utilisateur (ex. bouton "réessayer" sur la notification de T3a) plutôt qu'un abandon définitif silencieux.
- **Alternatives envisagées** : augmenter simplement le nombre de tentatives (5 → 20) — écartée seule, ne résout pas le cas d'une panne réseau prolongée au-delà de n'importe quel nombre de tentatives automatiques ; conserver l'abandon mais avec notification seule (T3a sans T3b) — insuffisant, la donnée reste perdue au sens où plus rien ne la retente jamais.
- **Tests à écrire** : test vérifiant qu'une opération en échec persistant reste accessible et rejouable manuellement, pas supprimée.
- **Critères d'acceptation** : aucune opération n'est perdue de façon définitive et silencieuse — soit elle se synchronise, soit elle reste visible et actionnable.
- **Risque de régression** : modéré — modifier le comportement de la file d'attente touche un mécanisme central (`seba_pending_ops`) utilisé par tout le CRUD ; à tester soigneusement avant déploiement.
- **Plan de retour arrière** : possible mais moins trivial que T3a — nécessite de repasser sur l'ancienne logique d'abandon si un problème apparaît ; recommandé de déployer T3a seule d'abord, T3b ensuite séparément pour isoler le risque.
- **Ordre d'exécution** : après ou avec T3a, peut démarrer en parallèle des autres tâches T0-T2/T4.
- **Estimation grossière** : moyenne.
- **Ce qui ne doit surtout pas être modifié** : ne pas toucher au mécanisme d'idempotence côté serveur (`unique(account, device_id, client_seq)`) — cette contrainte protège déjà contre les doublons en cas de rejeu, elle doit rester intacte.

## T4 — RGPD : suppression et export pour client et employé

- **Problème exact** : `erase_account_completely()` ne couvre que le patron propriétaire de `seba_state` ; un client ou un employé invité, disposant de sa propre ligne `auth.users`, n'a aucune fonction équivalente pour supprimer ses propres données.
- **Preuve dans le dépôt** : `migrations/2026-07-11-rgpd-suppression-compte.sql`, RPC entière lue — aucune branche ne traite `client_user_id`/`employe_user_id` comme point d'entrée.
- **Gravité** : modérée aujourd'hui, augmente mécaniquement avec l'ouverture publique.
- **Fichiers concernés** : nouvelle migration SQL, nouvelle RPC SECURITY DEFINER, potentiellement `docs/seba-data.js` (`clientPortal`/`employeePortal`) pour exposer l'appel.
- **Données concernées** : `client_accounts`, `employe_accounts`, et toutes les données personnelles liées à un client/employé (`client_requests`, `seba_messages`, photos de mission).
- **Prérequis** : aucun techniquement, mais bénéficie de T0 (savoir où tester une suppression sans risque).
- **Solution proposée** : créer une RPC distincte (ex. `erase_my_client_account` / `erase_my_employee_account`), résolvant le périmètre depuis `client_user_id`/`employe_user_id` de l'appelant (jamais un paramètre fourni), supprimant la liaison (`client_accounts`/`employe_accounts`) et anonymisant les données personnelles dans les tables où une suppression complète casserait l'intégrité du patron (ex. `client_requests` d'un client supprimé : conserver la ligne pour l'historique du patron mais anonymiser les champs identifiants).
- **Alternatives envisagées** : suppression complète et immédiate de toute trace (plus simple, mais casse potentiellement l'historique légitime du patron — une facture émise à un client supprimé doit rester traçable pour la comptabilité) ; anonymisation plutôt que suppression physique (recommandée, concilie le droit à l'effacement et les obligations de conservation comptable/légale — **ce point précis relève d'un avis juridique**, voir tableau propriétaires/échéances).
- **Tests à écrire** : test créant un compte client/employé de test avec des données dans chaque table concernée, appelant la nouvelle RPC, et vérifiant l'anonymisation/suppression effective.
- **Critères d'acceptation** : un client/employé peut demander la suppression de ses propres données sans dépendre d'une action du patron ; l'historique légitime du patron (factures, comptabilité) n'est pas cassé par cette suppression.
- **Risque de régression** : faible (nouvelle fonction, n'affecte pas le chemin existant `erase_account_completely`).
- **Plan de retour arrière** : trivial (nouvelle fonction isolée, désactivable sans impact).
- **Ordre d'exécution** : peut démarrer immédiatement, en parallèle de tout — **mais le choix anonymisation vs suppression physique doit être tranché avec un avis juridique avant l'implémentation finale** (voir tableau propriétaires/échéances).
- **Estimation grossière** : moyenne.
- **Ce qui ne doit surtout pas être modifié** : ne pas toucher à `erase_account_completely()` existante (le cas patron reste inchangé) ; ne pas supprimer physiquement une donnée dont le patron a besoin pour ses propres obligations comptables/légales sans validation juridique explicite.

## T5 — Premiers tests RLS et d'isolation multi-tenant

- **Problème exact** : aucun test automatisé ne vérifie que les policies RLS empêchent réellement un compte de lire/écrire les données d'un autre compte, qu'un client ne peut pas lire une demande qui n'est pas la sienne, ou qu'une réassignation coupe bien l'accès à une conversation.
- **Preuve dans le dépôt** : confirmé par l'audit tests/CI — aucun dossier `tests/`, aucun framework de test, le script le plus proche (`verify-accountid-fix.js`) est manuel, ponctuel, et n'exécute pas de vraie requête contre les policies Postgres (observation du comportement JS côté client uniquement).
- **Gravité** : critique pour la confiance à accorder à tout changement futur.
- **Fichiers concernés** : nouveau dossier de tests (ex. `tests/rls/`), nécessite un framework de test à choisir (aucun n'existe aujourd'hui — décision technique à documenter, pas une décision humaine au sens du journal).
- **Données concernées** : comptes de test créés spécifiquement pour ces tests, jamais de données réelles.
- **Prérequis** : **dépend de T0** — un environnement où exécuter ces tests sans risque doit être clarifié avant d'écrire le premier test.
- **Solution proposée** : créer deux comptes de test distincts, vérifier via des requêtes réelles (pas une simulation) que chacun ne peut ni lire ni écrire les données de l'autre sur `seba_state`, `client_requests`, `seba_messages` ; vérifier qu'un employé non assigné ne peut pas lire une conversation liée à une demande qui ne le concerne pas ; vérifier qu'une réassignation coupe l'accès immédiatement.
- **Alternatives envisagées** : continuer avec des vérifications manuelles ponctuelles (statu quo) — explicitement rejetée, c'est le risque identifié comme critique ; tests unitaires mockant Supabase plutôt que contre une vraie instance — écartée pour ce périmètre précis, un mock ne prouve rien sur le comportement réel des policies RLS Postgres, qui est justement ce qu'on veut vérifier.
- **Tests à écrire** : ce sont les tests eux-mêmes, l'objet de la tâche.
- **Critères d'acceptation** : un test échoue de façon reproductible si une policy RLS régresse ; les tests couvrent au minimum `seba_state`, `client_requests`, `seba_messages`, et les nouvelles RPC de T2/T4 une fois posées.
- **Risque de régression** : nul sur le produit (ce sont des tests, pas des changements de comportement) — risque uniquement si un test mal écrit s'exécute par erreur contre la production (d'où la dépendance stricte à T0).
- **Plan de retour arrière** : sans objet (ajout de tests).
- **Ordre d'exécution** : après T0 ; bénéfice réel à suivre T2 et T4 pour tester directement le comportement corrigé plutôt que l'ancien bug.
- **Estimation grossière** : importante (premier travail de ce type sur ce projet, inclut le choix d'un outillage de test).
- **Ce qui ne doit surtout pas être modifié** : aucune policy RLS existante ne doit être modifiée pour "faciliter" l'écriture des tests — les tests s'adaptent aux policies réelles, jamais l'inverse.

---

## 2. DEC-011 — Contrôle minimal avant déploiement : options et recommandation

### Contexte
`.github/workflows/static.yml` déploie sur GitHub Pages à chaque push sur `main` (+ déclenchement manuel), sans aucun gate — ni test, ni lint, ni build. `qa-and-lint.yml` (check-design-system) ne s'exécute que sur les pull requests touchant `docs/**`, jamais sur un push direct.

### Option A — Ajouter un gate minimal maintenant (lint + check-design-system avant déploiement)
- Description : faire échouer le déploiement si `tools/check-design-system.js` (mode `--full`, pas seulement diff) ou ESLint échoue.
- Avantages : rapide à mettre en place, cohérent avec l'outillage déjà existant, réduit le risque qu'une couleur en dur ou une erreur de syntaxe JS atteigne la production sans qu'aucun push direct sur `main` ne soit vérifié.
- Inconvénients : ne couvre aucun comportement fonctionnel (RLS, multi-tenant, parcours métier) — un faux sentiment de sécurité si présenté comme "le" gate de qualité.
- Risque : faible.
- Coût/complexité : faible.
- Réversible : oui.

### Option B — Attendre T5 (tests RLS/multi-tenant) pour construire un gate plus complet
- Description : ne rien changer à `static.yml` tant que les tests de T5 n'existent pas, puis les intégrer directement dans le gate de déploiement dès leur création.
- Avantages : évite de construire un gate "minimal" qui devra de toute façon être réécrit une fois les vrais tests disponibles.
- Inconvénients : laisse `main` sans aucun filet pendant toute la durée de T0-T4, alors que ces tâches touchent justement des points sensibles (RPC RGPD, contrainte SQL, logique de synchronisation).
- Risque : modéré — une régression pendant T0-T4 pourrait atteindre la production sans qu'aucun gate ne la détecte.
- Coût/complexité : nul immédiatement, reporté.
- Réversible : oui.

### Recommandation
**Combiner les deux, dans l'ordre** : mettre en place l'Option A immédiatement (coût quasi nul, réduit un risque réel dès maintenant), puis l'enrichir avec les tests de T5 une fois écrits (Option B comme suite naturelle, pas comme alternative exclusive). Ne pas attendre T5 pour avoir un premier filet, aussi imparfait soit-il — un gate de style/lint vaut mieux qu'aucun gate, et ne retarde rien d'autre.

**Base de cette recommandation** : bonne pratique technique (un gate minimal coûte presque rien et réduit un risque réel), pas une preuve tirée du dépôt lui-même.

---

## 3. Synthèse des estimations

| Tâche | Estimation | Parallélisable | Dépendance |
|---|---|---|---|
| T0 — Environnements/secrets | Petite à moyenne | Oui, immédiat | Aucune |
| T1 — Scripts cassés | Petite | Oui, immédiat | Aucune |
| T2 — `create_profile_and_company` | Petite | Oui, immédiat | Aucune |
| T3a — Notification de synchronisation | Petite à moyenne | Oui, immédiat | Aucune |
| T3b — Protection perte silencieuse | Moyenne | Après/avec T3a | T3a (fonctionnel, pas bloquant) |
| T4 — RGPD client/employé | Moyenne | Oui, immédiat (implémentation) / bloqué (choix anonymisation vs suppression) sur avis juridique | Avis juridique pour le choix définitif |
| T5 — Tests RLS/multi-tenant | Importante | Non | T0 (dur), bénéfice de T2/T4 |
| DEC-011 — Gate de déploiement | Petite (Option A) | Oui, immédiat | Aucune pour l'Option A ; T5 pour la version complète |
