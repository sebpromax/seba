# SEBA — Architecture cible

Statut : proposition d'architecture, non validée. S'appuie sur `SEBA_VISION_CONTRACT.md` (vision, non négociable) et `SEBA_CURRENT_STATE_AUDIT.md`/`SEBA_PRODUCT_GAP_ANALYSIS.md` (faits). Ce document ne fige aucune décision — chaque option est comparée, une recommandation est formulée, mais toute mise en œuvre attend validation humaine (voir `SEBA_DECISION_LOG.md`).

---

## 1. Options d'évolution de l'architecture globale

### Option A — Évolution progressive de l'architecture actuelle

Conserver la stack vanilla HTML/CSS/JS + Supabase, renforcer les frontières internes (séparation explicite des responsabilités dans `seba-data.js`, normalisation progressive des 5 entités cœur encore en blob JSON), ajouter la face publique comme une extension du même dépôt (nouvelles pages `docs/`, nouvelles tables Supabase dédiées au public, nouvelles RLS), sans changer de paradigme frontend ni de fournisseur backend.

**Avantages** : coût de démarrage minimal ; aucune réécriture du moteur privé qui fonctionne déjà (13 pages opérationnelles, authentification universelle éprouvée) ; l'équipe (actuellement une seule personne + IA assistante) n'a pas besoin d'apprendre un nouvel outillage ; cohérent avec le principe du contrat de vision "réutiliser l'existant lorsque c'est pertinent" ; risque de régression limité au périmètre effectivement touché.

**Inconvénients** : `seba-data.js` (1090 lignes) devient plus difficile à faire grandir sans discipline stricte de frontières internes — il gère déjà 6+ domaines (CRUD générique, messages, employeePortal, clientPortal, requests, sync) dans un seul fichier ; l'absence totale de tests automatisés (audit §6) rend chaque extension plus risquée à mesure que le fichier grossit ; la face publique introduit un besoin réel de lecture cross-tenant que le modèle RLS actuel n'a jamais eu à gérer — l'ajouter dans le même schéma demande une vigilance RLS de tous les instants.

**Coût** : modéré. **Durée** : la plus courte des trois options pour obtenir un premier pilote. **Risques** : dette qui s'accumule dans `seba-data.js` si aucune règle de frontière n'est imposée en parallèle. **Vitesse de mise sur le marché** : la plus rapide. **Maintenabilité** : bonne à court terme, se dégrade sans discipline à moyen terme. **Sécurité** : dépend entièrement de la rigueur RLS appliquée aux nouvelles tables publiques — le passé récent (audit §RLS) montre une bonne discipline, donc un risque maîtrisable mais pas nul. **Capacité multi-développeurs** : faible aujourd'hui (un seul fichier de 1090 lignes concentre toute la logique métier), s'améliore si des frontières de domaine sont imposées en même temps (voir §3). **Migration de données** : aucune migration de données existantes requise, uniquement de nouvelles tables. **Rollback** : simple (nouvelles tables/pages isolées, désactivables sans toucher à l'existant). **Dette résiduelle** : le blob JSON `seba_state` pour les 5 entités cœur reste un point de complexité non résolu, indépendamment du choix fait ici.

### Option B — Refonte structurelle progressive

Introduire une séparation de domaines explicite côté backend (tables normalisées dès le départ pour toute nouvelle brique publique, migration progressive des 5 entités cœur hors du blob JSON), et/ou une réorganisation frontend en modules plus stricts (sans nécessairement changer de framework), le tout domaine par domaine, en conservant le produit actuel opérationnel pendant la transition.

**Avantages** : résout la dette structurelle de fond (blob JSON, fichier `seba-data.js` monolithique) en même temps que l'ajout de la face publique ; pose des frontières de domaine dès la conception de la face publique plutôt que de les ajouter après coup ; meilleure base pour accueillir plusieurs développeurs à moyen terme.

**Inconvénients** : coût et durée significativement plus élevés avant d'obtenir un premier pilote testable ; risque de sur-ingénierie si la refonte dépasse ce qu'exige réellement le pilote restreint prévu par le contrat de vision (§12/§13 : quelques métiers, une zone) ; nécessite une migration de données réelle des 5 entités cœur, avec un risque de régression sur le moteur privé qui fonctionne déjà bien aujourd'hui.

**Coût** : élevé. **Durée** : significativement plus longue. **Risques** : sur-ingénierie par rapport au besoin réel du pilote ; risque de régression sur le socle qui fonctionne. **Vitesse de mise sur le marché** : plus lente. **Maintenabilité** : meilleure à moyen/long terme, si l'effort est mené à son terme. **Sécurité** : meilleure dès le départ (RLS et séparation public/privé pensées ensemble, pas ajoutées après coup). **Capacité multi-développeurs** : meilleure. **Migration de données** : nécessaire et non triviale (blob JSON → tables normalisées pour clients/devis/factures/interventions/employés, en conservant la compatibilité avec 13 pages actives). **Rollback** : plus complexe (les migrations de données sont plus difficiles à annuler proprement qu'une addition de nouvelles tables). **Dette résiduelle** : faible si l'effort va à son terme, mais risque réel de rester à mi-chemin (dette double : ancien schéma partiellement migré + nouveau schéma partiellement adopté) si le rythme d'exécution ralentit.

### Option C (proposée) — Évolution progressive du backend, extension stricte du frontend, sans refonte du cœur privé qui fonctionne

Une voie intermédiaire, pertinente au vu des preuves de l'audit : **traiter la face publique comme un nouveau domaine backend normalisé dès sa création** (jamais dans le blob JSON, jamais dans `seba-data.js` monolithique), **sans toucher aux 5 entités cœur existantes** (clients/devis/factures/interventions/employés restent en blob JSON pour l'instant — elles fonctionnent, sont bien RLS-scopées, et leur migration n'est pas un prérequis du pilote). Le frontend reste vanilla (pas de changement de stack), mais toute nouvelle logique liée à la face publique (recherche, fiche, demande publique) est écrite dans des modules JS dédiés et séparés de `seba-data.js`, communiquant avec lui par une interface étroite plutôt que par extension du fichier existant.

**Pourquoi cette option plutôt que A ou B strictement** : l'audit montre que le moteur privé actuel n'est pas le problème (il fonctionne, il est bien sécurisé) — le problème est l'absence totale d'une notion de donnée publique et le risque de continuer à grossir un fichier déjà volumineux si la face publique y est ajoutée sans discipline. Cette option obtient l'essentiel des bénéfices de sécurité et de clarté de l'Option B (nouveau domaine bien isolé dès le départ) sans payer le coût et le risque d'une migration de données sur un système qui fonctionne (Option B complète). Elle correspond directement au principe du contrat de vision : "réutilisation du produit existant lorsque c'est pertinent, sans que ce principe interdise une refonte si un audit démontre qu'elle est nécessaire" — l'audit démontre qu'une refonte du cœur privé n'est *pas* nécessaire pour lancer le pilote, mais qu'une structuration propre est nécessaire pour la face publique qui, elle, n'existe pas encore et n'a donc rien à perdre à naître bien structurée.

**Coût** : modéré. **Durée** : proche de l'Option A pour le pilote, avec une meilleure trajectoire à moyen terme. **Risques** : le principal risque est une frontière mal tenue dans le temps entre "nouveau code public, bien structuré" et "ancien code privé, en blob JSON" si la discipline n'est pas maintenue — risque humain/process plus que technique. **Vitesse de mise sur le marché** : proche de l'Option A. **Maintenabilité** : meilleure que l'Option A pure sur la partie publique, identique à l'Option A sur la partie privée existante (ni pire ni meilleure, puisqu'on n'y touche pas). **Sécurité** : bonne, car la face publique — la seule brique réellement nouvelle en termes de risque (lecture cross-tenant) — est conçue avec RLS et séparation dès l'origine plutôt qu'ajoutée après coup dans un système qui n'a jamais eu à gérer ce cas. **Capacité multi-développeurs** : meilleure que l'Option A sur le nouveau périmètre, inchangée sur l'ancien. **Migration de données** : aucune sur le cœur privé ; création de nouvelles tables uniquement pour le nouveau périmètre public. **Rollback** : aussi simple que l'Option A (nouvelles tables/modules isolés). **Dette résiduelle** : le blob JSON cœur reste, mais c'est une dette déjà connue, déjà vivable, et son traitement peut être reporté à une phase ultérieure sans bloquer le pilote.

## 2. Recommandation

**Option C.** Justification fondée sur le dépôt réel : l'audit ne montre aucune preuve que le moteur privé actuel a besoin d'être refondu pour supporter le pilote décrit par le contrat de vision (quelques métiers, une zone). En revanche, il montre une preuve claire que la face publique n'a **aucune fondation existante** à préserver — c'est donc l'endroit où investir dans une bonne structuration dès le départ coûte le moins cher relativement au bénéfice (aucune migration à faire, seulement une bonne conception initiale). Recommander l'Option B complète maintenant reviendrait à faire porter au pilote un coût de migration (blob JSON → tables normalisées du cœur privé) que rien dans le contrat de vision n'exige à ce stade — ce serait exactement le type de sur-ingénierie que le contrat de vision met en garde (§13 : "la vision de long terme ne doit jamais devenir une liste de fonctionnalités à construire immédiatement").

Ce choix n'est pas définitif : si le pilote démontre que le cœur privé (blob JSON) devient un frein réel (ex. conflits de synchronisation à plusieurs employés, taille du blob), la migration progressive vers des tables normalisées (Option B) reste ouverte plus tard, module par module — cette option ne ferme aucune porte.

## 3. Frontières de domaine cibles

Convention : chaque domaine indique sa responsabilité, les données qu'il possède, ce qu'il expose, ce qu'il consomme, et son statut par rapport à l'existant.

| Domaine | Responsabilité | Données possédées | Statut |
|---|---|---|---|
| **Identity & Authentication** | Sessions Supabase Auth pour les 4 rôles (patron, employé, client, visiteur public identifié légèrement) | `auth.users`, sessions | Existant, fonctionnel (patron/employé/client) ; à étendre pour l'identification légère du visiteur public (§16 du contrat) |
| **Accounts & Tenancy** | Compte professionnel, isolation multi-tenant | `seba_state.account`, `profiles`/`companies` (à corriger) | Existant pour le cœur, buggé sur `profiles`/`companies` (voir gap analysis) |
| **Roles & Permissions** | Qui peut faire quoi selon le rôle | RLS + RPC SECURITY DEFINER | Existant, bien conçu, à étendre pour le rôle "administrateur Seba" (non défini aujourd'hui) |
| **Professional Profiles** | Contenu du profil professionnel (source privée, avant publication) | Extension de `profiles`/`companies` ou nouvelle table dédiée | À créer/corriger — voir `SEBA_DOMAIN_MODEL.md` |
| **Public Listings** | Projection publique lisible sans compte | Nouvelle table dédiée, distincte des données privées | À créer entièrement — cœur du nouveau domaine |
| **Listing Claims** | Revendication et activation d'une fiche | Nouvelle table ou état sur Public Listings | À créer entièrement |
| **Categories & Sector Packs** | Référentiel des métiers et de leurs champs spécifiques | `businessTypes.js` (aujourd'hui frontend uniquement) | Existant côté frontend, à évaluer pour une contrepartie backend si la recherche publique en a besoin |
| **Service Catalog** | Services proposés par un professionnel | Dérivé de `businessTypes.js` + configuration par compte | Existant partiellement (frontend), pas encore backend par professionnel |
| **Geographic Search** | Recherche par localisation | Rien aujourd'hui (logique de `haversine-engine.html` non intégrée) | À créer |
| **Service Areas** | Zones d'intervention déclarées par un professionnel | Nouveau, dérivé des champs d'onboarding existants | À créer |
| **Requests & Qualification** | Demande qualifiée, cycle de vie | `client_requests` | Existant, à étendre pour l'origine publique (voir §8 gap analysis) |
| **Matching** | Aide à identifier le bon professionnel (Parcours B) | Rien aujourd'hui | À créer, priorité basse |
| **Conversations** | Messagerie liée à une demande | `seba_messages` (avec `request_id`) | Existant, solide, à étendre à l'origine publique |
| **CRM** | Gestion clients côté professionnel | `seba_state.clients` (blob JSON) | Existant, fonctionnel, non touché |
| **Quotes** | Devis | `seba_state.devis` (blob JSON) | Existant, fonctionnel, non touché |
| **Contracts** | Contrats récurrents | `seba_state.contrats` | Existant (mémoire : "Quote engine + contracts" shippé 2026-07-17), non ré-audité en détail ici |
| **Scheduling** | Planning | `seba_state.interventions` (dates) | Existant, fonctionnel, non touché |
| **Jobs & Interventions** | Intervention, affectation | `seba_state.interventions` | Existant, fonctionnel, non touché |
| **Workforce** | Employés | `seba_state.employes`, `employe_accounts` | Existant, fonctionnel, non touché |
| **Evidence & Reports** | Preuve photo, rapport de mission | `client_requests.photo_path`, bucket `mission-photos` | Existant, solide |
| **Billing** | Facturation | `seba_state.factures` (blob JSON) | Existant, fonctionnel, non touché ; conformité France (mentions, TVA, numérotation) à vérifier séparément |
| **Payments** | Encaissement réel | Rien de fonctionnel (`stripe-service.js` = démo) | À construire réellement |
| **Reviews & Trust** | Avis, vérification, badges | Rien aujourd'hui | À créer entièrement, avec la distinction vérifié/abonné/sponsorisé posée dès la conception (principe non négociable) |
| **QR & Attribution** | Génération et suivi de QR codes | Génération canvas isolée (`signature-payment.html`), pas d'attribution | À créer, dépend de Public Listings |
| **Notifications** | Email/push | `send-email.ts`, `send-push.ts`, `notify-alert.ts` | Existant, fonctionnel côté infra, à étendre aux nouveaux événements publics |
| **Subscriptions** | Paliers Seba Pro | Rien aujourd'hui (mentions Stripe Payment Link marketing uniquement) | À créer, priorité basse (long terme) |
| **Moderation** | Rôle administrateur Seba, signalements | Rien aujourd'hui | À créer, périmètre à définir humainement (question ouverte du contrat de vision §16) |
| **Analytics** | Événements produit de la boucle | Rien aujourd'hui | À créer, voir événements proposés dans une itération ultérieure de ce document si demandé |
| **Audit & Compliance** | RGPD, journal d'audit | `erase_account_completely`, `sync_operations` (append-only) | Existant mais incomplet (gap client/employé, voir `SEBA_SECURITY_AND_TRUST.md`) |

**Principe transversal** : aucun de ces domaines n'est recommandé comme microservice séparé. Il s'agit d'une organisation modulaire à l'intérieur du même dépôt (fichiers JS séparés côté frontend, tables et policies séparées côté Supabase) — un monolithe bien structuré, cohérent avec l'échelle actuelle du projet (un seul environnement de production, une équipe réduite).

## 4. Frontend

Rester en HTML/CSS/JS vanilla + CDN, cohérent avec l'état actuel et avec le principe de réutilisation. Nouvelle recommandation structurelle : tout module lié à la face publique (recherche, fiche, formulaire de demande publique) doit vivre dans ses propres fichiers JS, avec une frontière d'appel claire vers `seba-data.js` plutôt que d'y être ajouté directement — pour éviter que ce fichier déjà volumineux (1090 lignes) ne devienne le point de friction central de tout développement futur. Les pages publiques (fiche, recherche) devront définir leur propre thème ou réutiliser `pro-global.css` selon une décision explicite (non tranchée ici, voir la note du contrat de vision sur les deux thèmes existants).

## 5. Backend

Supabase reste le backend (Postgres + Auth + Storage + Edge Functions) — aucune preuve dans l'audit ne justifie un changement de fournisseur, et le modèle RLS actuel est une base saine à étendre. Toute nouvelle table liée à la face publique doit être conçue avec RLS dès sa création (jamais de policy `using(true)` par défaut, cohérent avec la discipline déjà observée dans le reste du schéma).

## 6. Données

Voir `SEBA_DOMAIN_MODEL.md` pour la correspondance détaillée entité par entité. Principe directeur : la donnée publique n'est **jamais** une simple policy RLS ouverte sur les tables privées existantes — elle vit dans une structure séparée, alimentée par une action explicite du professionnel (publication), pas par une lecture directe de ses données de gestion. Ce choix sera comparé formellement (table dédiée vs vue sécurisée vs projection) dans une section dédiée du modèle de domaine.

## 7. Événements

Domaines candidats à l'émission d'événements (pour notifications et analytics futurs, non implémentés aujourd'hui) : création de demande, acceptation, déverrouillage de conversation, création de devis, clôture d'intervention, émission de facture, réception de paiement. Aucun bus d'événements dédié n'existe aujourd'hui — les notifications actuelles (`notify-alert.ts`, `send-email.ts`, `send-push.ts`) sont appelées directement, pas via un événement découplé. Ne pas introduire de bus d'événements généraliste tant que le volume ne le justifie pas — rester sur des appels directs bien nommés, cohérent avec l'échelle du projet.

## 8. Intégrations

Existantes et fonctionnelles au niveau infrastructure : email (`send-email.ts`), push (`send-push.ts`), IA (`ai-relay.ts`, providers Groq/Gemini/Mistral/OpenRouter — jamais l'API Anthropic facturée à l'usage, règle du projet). À construire réellement : Stripe (aujourd'hui démo uniquement).

## 9. Sécurité

Voir `SEBA_SECURITY_AND_TRUST.md` pour le détail. Point le plus structurant : la face publique introduit la toute première nécessité de lecture cross-tenant du projet — traiter cela comme un chantier à part entière avec plusieurs approches comparées, pas comme une extension mineure des policies existantes.

## 10. Internationalisation

Ne pas construire de Country Pack maintenant. Recommandation : au moment de modéliser Public Listings et Service Areas, éviter de coder en dur des hypothèses françaises non réversibles (formats d'adresse, devise) dans les nouvelles tables — sans pour autant construire un système multi-pays complet. Le sélecteur pays/fuseau existant à l'onboarding (27 pays) montre que cette préoccupation existe déjà partiellement dans le produit ; s'aligner dessus plutôt que réinventer.

## 11. Tests

Recommandation prioritaire indépendante du choix d'architecture : avant d'ajouter la face publique, combler l'absence totale de tests sur au moins les parcours les plus risqués existants (authentification, isolation multi-tenant sur `client_requests`/`seba_messages`). Voir `SEBA_SECURITY_AND_TRUST.md` §"contrôles à tester" et `SEBA_MIGRATION_PLAN.md` pour le séquencement.

## 12. Observabilité

Rien d'existant aujourd'hui en dehors de `console.error`/`console.warn` côté client et des logs Supabase par défaut. Pas de recommandation de plateforme spécifique dans ce document (question d'implémentation, pas de vision) — signalé comme un manque à combler avant l'ouverture publique, où les échecs silencieux (ex. synchronisation, voir audit §4) deviendraient plus coûteux à diagnostiquer à plus grande échelle.
