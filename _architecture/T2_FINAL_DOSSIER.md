# SEBA — T2 : dossier final de correction (`create_profile_and_company`)

Statut : dossier de préparation complet. Aucune migration créée, aucune commande SQL exécutée. Je n'ai par ailleurs **aucun accès technique** (aucune clé, aucun outil MCP) au projet Supabase réel de ce dépôt — je ne peux exécuter aucune des requêtes ci-dessous moi-même, sur aucun environnement. Elles sont préparées pour toi (ou une session future disposant d'un accès), à exécuter dans l'environnement isolé retenu (voir `PHASE_1A_CHECKPOINT.md` §2bis).

---

## État actuel

### Définition actuelle complète de la RPC
```sql
create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid as $$
declare
  _profile_id uuid;
begin
  insert into profiles (user_id, sector) values (_user_id, _sector)
    returning id into _profile_id;
  insert into companies (profile_id, name) values (_profile_id, _company_name);
  return _profile_id;
end;
$$ language plpgsql;
```
Source : `supabase-schema.sql:209-222`. **SECURITY INVOKER** (pas de clause `security definer` — confirmé par absence explicite dans la définition), donc s'exécute avec les droits de l'appelant : la policy `profiles_insert` (`with check (auth.uid() = user_id)`) s'applique réellement, un appel avec un `_user_id` différent de l'appelant est rejeté par RLS (documenté explicitement dans le commentaire du schéma, ligne 204-208).

### Migration qui l'a créée ou modifiée
**Aucune migration dédiée** — la fonction et les tables `profiles`/`companies` vivent directement dans `supabase-schema.sql` (le schéma maître), pas dans un fichier daté de `migrations/`. Origine tracée avec certitude : `COMPARATIF-PARCOURS.md:71-107` (exercice multi-agents antérieur, "TASK 3.1"), où l'agent Groq a proposé ce schéma avec trois valeurs de secteur capitalisées (`Nettoyage`/`Conciergerie`/`Artisanat`) — le commentaire du schéma actuel (`supabase-schema.sql:160-164`) confirme que seuls les bugs structurels de cette proposition (variable non déclarée, policies manquantes) ont été corrigés avant intégration ; **le choix des 3 valeurs de secteur, lui, n'a jamais été révisé**.

**Preuve documentaire directe de l'origine du problème** : `COMPARATIF-PARCOURS.md:155` note explicitement, au moment de la proposition initiale : *"TASK 3.1 ne modélise que 3 valeurs de secteur (Nettoyage/Conciergerie/Artisanat), un choix plus restrictif que la taxonomie actuelle à 9 secteurs [aujourd'hui 11] : point à trancher avec le fondateur avant implémentation, ce document ne tranche pas."* Cette décision a été explicitement signalée comme en attente d'arbitrage humain — et n'a jamais été retranchée avant que le schéma soit intégré tel quel. Le bug d'aujourd'hui est la conséquence directe d'une décision explicitement laissée ouverte, jamais refermée.

### Nom exact de la contrainte
`sector text not null check (sector in ('Nettoyage', 'Conciergerie', 'Artisanat'))` (`supabase-schema.sql:168`) est une contrainte **inline, non nommée explicitement** dans le SQL source. PostgreSQL génère alors un nom par convention : `<table>_<colonne>_check`, soit très probablement `profiles_sector_check` (une seule contrainte CHECK existe sur cette colonne, donc pas de suffixe numérique attendu). **Ce nom n'est pas garanti à 100% sans le vérifier directement sur la base réelle** — voir la requête de vérification ci-dessous, à exécuter avant d'écrire la migration définitive.

### Valeurs actuellement autorisées
`'Nettoyage'`, `'Conciergerie'`, `'Artisanat'` — 3 valeurs, capitalisées.

### Valeur réellement envoyée par `bienvenue.html`, pour chaque secteur
Chemin exact : `docs/onboarding.html:372-375` (`secteurKey = resolveSector(S.sector) || 'autre'`, sauvegardé dans `localStorage['sebaEntreprise'].secteur`) → lu par `docs/bienvenue.html:170-174` (`biz.secteur`) → transmis tel quel comme `_sector`.

| Bouton onboarding (libellé affiché) | Valeur transmise | Autorisée aujourd'hui ? |
|---|---|---|
| "Nettoyage & Entretien" | `menage` | Non |
| "Conciergerie & Accueil" | `conciergerie` | Non (casse différente de `Conciergerie`) |
| "Artisans & Maintenance" | `maintenance` | Non |
| "Autre activité" | `autre` | Non — et aucune valeur autorisée ne correspond même conceptuellement |

### Valeur réellement envoyée par `connexion.html`
Même mécanisme exact, confirmé ligne par ligne : `docs/connexion.html:427-435` (`completePendingProfile()`) relit `biz.secteur` depuis `localStorage['sebaEntreprise']` (posé par l'onboarding) et transmet la même valeur — pas de différence de comportement entre les deux points d'appel.

### Comportement exact pour le choix « autre »
`resolveSector()` (`docs/services/config-dashboard.js:161-163`) retourne `'autre'` dans **deux cas distincts** : (1) l'utilisateur clique explicitement sur "Autre activité", et (2) filet de sécurité générique — tout libellé non reconnu par `SECTOR_MAPPING` retombe silencieusement sur `'autre'`. Les deux cas produisent la même valeur, rejetée de la même façon aujourd'hui : aucune valeur de la contrainte CHECK ne représente même conceptuellement un "secteur autre/générique" — ce n'est pas seulement un problème de casse pour ce cas précis, c'est une absence totale de couverture.

### Résultat de la RPC pour chaque valeur
Les 4 valeurs (`menage`, `conciergerie`, `maintenance`, `autre`) échouent à 100% avec une violation de contrainte CHECK (`check_violation`, SQLSTATE 23514) — déterministe, prouvable par simple lecture de la contrainte, pas besoin d'exécution réelle pour l'établir.

### Permissions de la RPC (constat additionnel, pas dans le périmètre initial du bug)
Aucune ligne `revoke`/`grant` explicite n'existe pour cette fonction dans le schéma — contrairement aux autres RPC sensibles (`get_my_client_profile`, `get_my_employee_profile`, etc.) qui ont toutes un `revoke all ... from public; grant execute ... to authenticated;` explicite. Cette fonction repose donc sur les permissions par défaut de PostgreSQL/PostgREST. **Gravité : faible** — la RLS de `profiles_insert` (`auth.uid() = user_id`) bloque de toute façon tout appel où `auth.uid()` ne correspond pas à `_user_id`, y compris un appel anonyme (`auth.uid()` vaut alors `null`, jamais égal à un `_user_id` fourni). C'est un défaut de cohérence de style (defense in depth manquante), pas une faille active — signalé pour hygiène, pas inclus dans la correction de T2 sauf si tu le souhaites explicitement.

---

## Vérification des données existantes (requêtes non destructives, à exécuter par toi — je n'ai aucun accès à la base réelle)

```sql
-- 1. Répartition actuelle des valeurs de secteur (devrait être vide aujourd'hui)
select sector, count(*) as n
from profiles
group by sector
order by n desc;

-- 2. Valeurs nulles (la colonne est NOT NULL, devrait toujours renvoyer 0)
select count(*) as null_sector from profiles where sector is null;

-- 3. Valeurs ne correspondant à aucun des 3 codes actuellement attendus
--    (devrait toujours être 0 tant que la contrainte CHECK actuelle est active et n'a jamais été contournée)
select count(*) as valeurs_inattendues
from profiles
where sector not in ('Nettoyage', 'Conciergerie', 'Artisanat');

-- 4. Nom exact de la contrainte CHECK sur profiles.sector (à vérifier avant d'écrire "drop constraint")
select conname
from pg_constraint
where conrelid = 'profiles'::regclass and contype = 'c';

-- 5. Nombre total de lignes dans profiles et companies (devrait être 0 et 0 aujourd'hui)
select (select count(*) from profiles) as profiles_count,
       (select count(*) from companies) as companies_count;

-- 6. Plusieurs profils pour un même user_id (aucune contrainte d'unicité ne l'empêche aujourd'hui)
select user_id, count(*) as nb_profils
from profiles
group by user_id
having count(*) > 1;

-- 7. Plusieurs entreprises pour un même propriétaire (via profile_id -> profiles.user_id)
select p.user_id, count(*) as nb_companies
from companies c
join profiles p on p.id = c.profile_id
group by p.user_id
having count(*) > 1;

-- 8. Profils sans entreprise associée (la RPC devrait toujours créer les deux ensemble)
select p.id, p.user_id
from profiles p
left join companies c on c.profile_id = p.id
where c.id is null;

-- 9. Entreprises sans profil correspondant (ne devrait jamais arriver, profile_id est NOT NULL + FK)
select c.id, c.profile_id
from companies c
left join profiles p on p.id = c.profile_id
where p.id is null;

-- 10. Détection de créations partielles : combiner 8 et 9 avec un contrôle croisé du nombre total
select
  (select count(*) from profiles) as total_profiles,
  (select count(*) from companies) as total_companies,
  (select count(*) from profiles p where not exists (select 1 from companies c where c.profile_id = p.id)) as profils_orphelins;
```

**Attente honnête** : je m'attends à ce que les requêtes 1, 3, 5, 6, 7, 8, 9, 10 renvoient toutes 0/vide aujourd'hui, puisqu'aucun appel réussi de la RPC n'a jamais pu avoir lieu (la contrainte bloque les 4 seules valeurs possibles depuis toujours). Les requêtes 6-10 redeviennent en revanche directement pertinentes **après** la correction de T2 — c'est exactement le type de vérification à rejouer une fois la correction appliquée dans l'environnement isolé, pour confirmer qu'aucun doublon n'apparaît en pratique. Je ne peux exécuter aucune de ces requêtes moi-même — à faire dans l'environnement isolé (ou en lecture seule sur le projet partagé si tu juges ce risque acceptable, ce sont de pures requêtes `select`, aucune écriture).

---

## Source de vérité des secteurs

### Relation actuelle entre les 4 définitions concurrentes
1. **`businessTypes.js`** — 11 secteurs richement modélisés (services, champs spécifiques, métriques dashboard) — objet JS frontend pur, aucune contrepartie base de données.
2. **`SECTOR_MAPPING`** (`docs/services/config-dashboard.js:30-35`) — 4 libellés d'onboarding mappés vers 4 des 11 clés de `businessTypes.js` (`menage`, `conciergerie`, `maintenance`, `autre`) — c'est la valeur qui finit réellement dans `localStorage['sebaEntreprise'].secteur` et qui alimente tout le reste du système (dashboard, widgets, `seba-data.js`).
3. **`profiles.sector` (contrainte CHECK)** — un **troisième vocabulaire distinct**, capitalisé, à seulement 3 valeurs, hérité tel quel d'un prototype d'agent IA (`COMPARATIF-PARCOURS.md`) jamais réconcilié avec les deux précédents.

### Réponse 1 — Quelle est actuellement la source de vérité réelle ?
**Il n'y en a pas une seule aujourd'hui.** Pour tout ce qui compte opérationnellement (affichage dashboard, widgets, logique métier), la source de vérité de fait est `SECTOR_MAPPING` → les clés de `businessTypes.js`. La contrainte `profiles.sector` n'est pas une source de vérité concurrente légitime — c'est un vocabulaire orphelin, déconnecté, qui n'est d'ailleurs lu par **aucune** page (confirmé par grep exhaustif dans l'audit initial) : elle ne fait autorité sur rien de visible aujourd'hui, elle bloque juste silencieusement une écriture que personne ne remarque.

### Réponse 2 — Quelle devrait être la source de vérité à court terme ?
Aligner `profiles.sector` sur le vocabulaire déjà utilisé partout ailleurs (`SECTOR_MAPPING`/`businessTypes.js`), plutôt que d'inventer un nouveau référentiel ou de essayer de faire converger `businessTypes.js` vers le vocabulaire capitalisé de `profiles`. C'est la correction la moins coûteuse et la plus cohérente avec l'existant.

### Réponse 3 — Le correctif limité aux 4 valeurs résout-il seulement le bug actuel ou crée-t-il une nouvelle divergence future ?
**Il résout le bug actuel sans éliminer le risque structurel.** Si un des 7 secteurs actuellement "inertes" de `businessTypes.js` (ex. `jardinage`, `pressing`) devient un jour sélectionnable dans l'onboarding (en étendant `SECTOR_MAPPING`), quelqu'un devra se souvenir de mettre à jour **aussi** la contrainte CHECK de `profiles.sector` — exactement le même type d'oubli que celui documenté et jamais corrigé dans `COMPARATIF-PARCOURS.md`. Le correctif proposé est honnête et suffisant pour aujourd'hui, mais ne supprime pas la classe de risque, seulement son instance actuelle.

### Réponse 4 — Comment éviter que chaque activation de secteur exige une correction imprévue de la base ?
Trois pistes, présentées pour une décision future — **aucune n'est implémentée ni recommandée pour l'immédiat**, conformément à la consigne de ne pas transformer cette analyse en refonte :
1. Retirer la contrainte CHECK (juste `not null`), validation uniquement côté application — perd une garantie d'intégrité en base.
2. Remplacer le CHECK par une clé étrangère vers une petite table `sectors` listant les clés valides (le nettoyage "propre" à terme, mais c'est un changement de schéma, explicitement hors périmètre ici).
3. Ajouter une note explicite dans l'en-tête de `businessTypes.js`/`config-dashboard.js` (qui documente déjà la philosophie "ajouter un secteur = configuration, pas développement") rappelant qu'activer un secteur dans l'onboarding implique aussi de vérifier `profiles.sector` — coût quasi nul, pas une solution structurelle mais un filet de sécurité documentaire.

Je recommande de consigner ce choix dans `SEBA_DECISION_LOG.md` comme décision différée, pas de le trancher maintenant.

### Test de contrat automatisé des codes secteur (mécanisme minimal contre une nouvelle divergence)
Objectif : ne pas empêcher une future activation de secteur, seulement garantir qu'elle ne peut pas silencieusement recréer ce même bug. Proposition, à écrire dès qu'un framework de test existe (T5) — **pas une refonte, un test de garde-fou unique** :
```
POUR chaque libellé L dans les boutons d'onboarding réellement affichés (docs/onboarding.html) :
  v = resolveSector(L)   -- valeur réellement produite par SECTOR_MAPPING
  vérifier que v figure dans la liste des valeurs acceptées par profiles.sector

SÉPARÉMENT, pour chaque clé de businessTypes.js (11 secteurs) :
  signaler (sans faire échouer le test) si la clé n'est atteignable par aucun bouton d'onboarding
  -- purement informatif, cohérent avec "7 secteurs inertes aujourd'hui", pas une erreur
```
Ce test échouerait immédiatement si un nouveau bouton d'onboarding était ajouté sans mettre à jour la contrainte SQL — exactement la classe de bug de T2, détectée avant mise en production plutôt que découverte des mois plus tard. Il ne nécessite aucune nouvelle table, aucun domaine "secteurs" complexe — juste une comparaison entre deux listes déjà existantes (`SECTOR_MAPPING` côté JS, contrainte CHECK côté SQL). Peut être écrit comme un test unitaire pur (aucun besoin de base de données réelle) si la liste de valeurs autorisées est dupliquée en dur dans le test — ou comme un test d'intégration contre l'environnement isolé si on préfère vérifier la contrainte réelle plutôt qu'une copie.

---

## Idempotence de la RPC (nouveau périmètre, imposé par l'absence de contrainte d'unicité)

### La RPC utilise-t-elle une transaction unique ?
Oui — une fonction PL/pgSQL appelée via un seul appel RPC PostgREST s'exécute dans le contexte transactionnel de cet appel : les deux `insert` (dans `profiles` puis `companies`) réussissent ou échouent ensemble, sans état intermédiaire visible de l'extérieur. **Elle ne peut pas laisser de données partielles visibles** en cas d'échec du second insert — à condition qu'aucune exception ne soit interceptée silencieusement à l'intérieur de la fonction (vérifié : aucun bloc `exception when ... then` dans son corps actuel, donc toute erreur remonte et annule la transaction complète).

### Comportement dans les 8 scénarios demandés
| Scénario | Comportement actuel (avant toute correction) |
|---|---|
| Double clic (deux appels RPC quasi simultanés depuis le même onglet) | Chaque appel exécute intégralement la logique — **aujourd'hui les deux échouent** sur la contrainte de secteur. Après correction de la seule contrainte : **les deux réussiraient indépendamment**, créant deux profils distincts pour le même utilisateur (aucune unicité ne l'empêche). |
| Double appel simultané (deux onglets, ou rejeu réseau) | Identique au double clic — aucune protection contre la concurrence au niveau applicatif ni base aujourd'hui. |
| Nouvelle tentative après timeout | `bienvenue.html`/`connexion.html` ne suppriment `seba_profile_pending` que si `error` est `null` — un timeout réseau (pas une erreur applicative) laisserait `seba_profile_pending` à `'1'`, donc un nouvel essai est *prévu* par le code existant. Après correction, un timeout suivi d'un nouvel essai réussi créerait un doublon si le premier appel avait en réalité réussi côté serveur malgré le timeout perçu côté client. |
| Profil déjà existant | Aujourd'hui : nouvel `insert`, pas de vérification préalable — créerait un second profil (une fois la contrainte de secteur corrigée). |
| Entreprise déjà existante | Même remarque : `companies` n'a pas de contrainte d'unicité sur `profile_id` (bien qu'un `profile_id` par ligne de `companies` corresponde normalement à un seul profil créé à l'instant T, un second appel créerait un second couple profil+entreprise, pas une seconde entreprise attachée au même profil). |
| Profil existant mais entreprise absente | Cas théorique (ne devrait pas arriver vu l'atomicité de la transaction, sauf suppression manuelle de l'entreprise après coup) — la RPC recréerait un nouveau profil plutôt que de compléter l'entreprise manquante du profil existant, faute de logique de détection. |
| Entreprise créée mais deuxième étape échouée | Ne peut pas arriver dans l'état actuel de la fonction (une seule transaction, pas d'étape "deuxième partie" distincte au sens d'un appel séparé) — pertinent seulement si la fonction était un jour scindée en plusieurs appels, ce qui n'est pas le cas aujourd'hui. |
| Même utilisateur, secteur différent lors d'un second appel | Créerait un second profil avec un secteur différent du premier — aucune règle ne détermine lequel des deux profils fait autorité pour cet utilisateur. |

### Quelle clé métier permettrait de reconnaître une nouvelle tentative ?
`user_id` est la seule clé métier pertinente ici — un utilisateur ne devrait avoir qu'un seul profil. C'est précisément la contrainte qui manque aujourd'hui.

### Une contrainte unique est-elle nécessaire ?
**Oui, structurellement** — sans elle, corriger uniquement la contrainte de secteur (Option A ci-dessous) résout un bug pour en rendre un autre immédiatement possible, alors qu'il ne l'était pas avant (la table était protégée par accident, pas par conception).

### `INSERT ... ON CONFLICT`, vérification préalable, ou autre stratégie ?
- **Vérification préalable** (`select ... where user_id = _user_id` avant d'insérer) : simple à lire, mais crée une **vraie condition de course** si deux appels s'exécutent en parallèle (les deux peuvent passer la vérification avant que l'un des deux insère) — à éviter comme unique protection.
- **`insert ... on conflict (user_id) do nothing`** (nécessite une contrainte unique sur `user_id` pour fonctionner) : la bonne pratique standard PostgreSQL pour ce cas exact — la contrainte unique elle-même arbitre, pas une vérification applicative précédente. Élimine la condition de course par construction (c'est la base de données, pas le code, qui empêche le doublon).
- **Autre stratégie** (verrou applicatif, ex. `select ... for update`) : plus complexe que nécessaire ici, à réserver à des cas où la logique entre la lecture et l'écriture est plus riche qu'un simple insert.

### Comment éviter qu'une vérification applicative seule crée une condition de course ?
En ne s'appuyant jamais sur une vérification applicative comme unique garde-fou — la contrainte unique en base doit être la source de vérité de l'unicité, `on conflict` (ou une gestion explicite de l'exception `unique_violation` en PL/pgSQL) doit être le mécanisme qui la respecte. Une vérification applicative peut rester en complément pour un message d'erreur plus clair, jamais pour remplacer la contrainte.

---

## Périmètre de correction : Option A (minimal) vs Option B (sécurisé)

### Option A — Corriger uniquement la contrainte de secteur
- Avantages : le changement le plus petit possible, une seule ligne de logique modifiée (la contrainte CHECK), risque de régression minimal sur tout le reste.
- Inconvénients : **active immédiatement** un risque de doublons qui n'existait pas avant (la RPC était protégée par accident — elle échouait toujours — pas par une vraie garantie d'unicité). Une fois corrigée, le double clic/double appel devient un vrai risque de doublon en production dès le premier utilisateur réel.
- Coût : trivial.

### Option B — Corriger la contrainte de secteur ET rendre la RPC sûre en cas de rejeu
- Avantages : élimine la classe de bug complète (secteur ET doublons) en une seule intervention cohérente, plutôt que de corriger un problème en ouvrant un autre qu'il faudra revenir corriger séparément plus tard.
- Inconvénients : légèrement plus de surface de changement — une contrainte unique supplémentaire (`unique (user_id)` sur `profiles`) et une modification de la RPC elle-même (passer de deux `insert` simples à une logique tolérante au rejeu, ex. `on conflict (user_id) do nothing` suivi d'une lecture de l'`id` existant si la ligne existait déjà).
- Coût : modéré, mais toujours largement inférieur à une refonte — deux ajouts ciblés (une contrainte, une clause `on conflict`), pas une réécriture.

### Recommandation honnête
**Option B.** Ce n'est pas cohérent avec l'esprit d'une "modification petite" de laisser sciemment un risque d'intégrité nouveau et connu derrière une correction que je recommande moi-même — corriger la contrainte de secteur seule, en sachant qu'elle active un doublon possible, reviendrait à remplacer un bug documenté par un autre bug documenté. L'ajout d'une contrainte unique + `on conflict` reste une modification petite et ciblée (deux instructions SQL supplémentaires, pas une réécriture de l'architecture), proportionnée au risque qu'elle referme. Si tu préfères néanmoins limiter la première correction à l'Option A pour des raisons de séquencement (par exemple pour observer la contrainte de secteur seule en isolation avant d'ajouter la protection d'unicité), c'est un choix valide — mais il doit être pris consciemment, pas par défaut.

---

## Correction proposée

### Migration SQL exacte
**Option A seule (contrainte de secteur uniquement)** :
```sql
-- migrations/2026-07-XX-fix-profiles-sector-check.sql
alter table profiles drop constraint if exists profiles_sector_check;
alter table profiles add constraint profiles_sector_check
  check (sector in ('menage', 'conciergerie', 'maintenance', 'autre'));
```

**Option B recommandée (secteur + idempotence)** :
```sql
-- migrations/2026-07-XX-fix-profiles-sector-check-and-idempotence.sql
--
-- Corrige la divergence entre profiles.sector (contrainte héritée de
-- COMPARATIF-PARCOURS.md TASK 3.1, jamais réconciliée avec la taxonomie
-- réelle) et les 4 valeurs effectivement envoyées par l'onboarding
-- (SECTOR_MAPPING, docs/services/config-dashboard.js). Table vide à ce
-- jour (RPC en échec systématique depuis sa création) : aucune donnée
-- existante affectée -- à reconfirmer par les requêtes de vérification
-- avant application, quel que soit l'environnement.
--
-- Ajoute également une contrainte d'unicité sur profiles.user_id,
-- absente aujourd'hui -- sans elle, corriger uniquement le secteur
-- rendrait immédiatement possible la création de profils en double
-- (voir section Idempotence de la RPC ci-dessus).

alter table profiles drop constraint if exists profiles_sector_check;
alter table profiles add constraint profiles_sector_check
  check (sector in ('menage', 'conciergerie', 'maintenance', 'autre'));

alter table profiles add constraint profiles_user_id_unique unique (user_id);

create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid as $$
declare
  _profile_id uuid;
begin
  insert into profiles (user_id, sector) values (_user_id, _sector)
    on conflict (user_id) do nothing
    returning id into _profile_id;

  if _profile_id is null then
    -- Le profil existait déjà (rejeu/double appel) : renvoyer son id
    -- existant plutôt que de créer un doublon ou une entreprise orpheline.
    select id into _profile_id from profiles where user_id = _user_id;
    return _profile_id;
  end if;

  insert into companies (profile_id, name) values (_profile_id, _company_name);
  return _profile_id;
end;
$$ language plpgsql;
```
Cette version modifie la RPC elle-même (nécessaire pour l'idempotence, contrairement à la correction du secteur seule) — **c'est un changement de comportement volontaire** : un second appel réussi pour le même utilisateur renvoie désormais l'`id` du profil existant plutôt que d'en créer un second, silencieusement compatible avec le rejeu déjà prévu par `seba_profile_pending`.

### Fichiers créés ou modifiés
Un seul fichier nouveau (Option A ou B selon la décision, pas les deux). **Aucun fichier JavaScript modifié dans les deux cas.**

### Pourquoi le JavaScript ne doit pas être modifié
`SECTOR_MAPPING`/`resolveSector()` ne servent pas qu'à cet appel RPC : le commentaire d'en-tête de `docs/services/config-dashboard.js:1-17` documente qu'ils sont aussi consommés par `getEffectiveLayout()` (`docs/widgets.js`) pour déterminer la disposition par défaut du dashboard, et les mêmes clés alimentent `businessTypes.js`/`seba-data.js` partout dans l'application. Modifier ces valeurs pour qu'elles correspondent à l'ancienne contrainte SQL (`Nettoyage`/`Conciergerie`/`Artisanat`) aurait un rayon d'impact bien plus large que le problème isolé de `profiles.sector` — un changement SQL ciblé est strictement moins risqué.

### Conséquences sur les lignes existantes
Aucune — à confirmer par la requête de vérification #5 (`profiles_count = 0`), mais même en présence de lignes existantes, celles-ci auraient nécessairement `sector` parmi les 3 valeurs déjà autorisées (`Nettoyage`/`Conciergerie`/`Artisanat`), qui **restent acceptées telles quelles** si on ne les retire pas — non, en fait : la nouvelle contrainte **remplace entièrement** la liste, donc si une ligne existait avec `sector='Nettoyage'`, elle **violerait** la nouvelle contrainte (`'Nettoyage'` n'est plus dans la nouvelle liste). Ce cas est jugé hautement improbable (aucun appel n'a jamais réussi, confirmé par le fait que la contrainte bloque les 4 seules valeurs jamais envoyées) mais **doit être vérifié par la requête #1/#5 avant d'appliquer cette migration, sans exception**.

### Compatibilité ascendante et descendante
- **Ascendante (nouvelles lignes)** : les 4 valeurs réellement envoyées par l'onboarding actuel seront acceptées après la migration.
- **Descendante (retour à l'ancienne contrainte)** : non garantie sans condition — voir section Rollback ci-dessous, ce n'est pas un simple aller-retour symétrique.

### Idempotence
Le `drop constraint if exists` rend l'exécution répétée sûre pour la partie suppression. Le nom explicite (`profiles_sector_check`) dans le `add constraint` garantit qu'une seconde exécution du script complet aboutit au même état final (drop de la contrainte qu'on vient de créer, puis recréation identique) — **idempotent**, sous réserve que le nom réel de la contrainte d'origine soit bien `profiles_sector_check` (à confirmer par la requête #4 avant la toute première exécution).

### Comportement si la migration est appliquée deux fois
Aucun effet indésirable — état final identique après 1 ou N applications (voir idempotence ci-dessus).

### Comportement si une valeur invalide est envoyée après la migration
La contrainte CHECK rejette toujours toute valeur hors de la nouvelle liste (`check_violation`, SQLSTATE 23514) — le comportement de rejet reste inchangé dans sa nature, seul l'ensemble des valeurs acceptées change. Côté application, `sebaAuth.rpc(...)` retourne un objet `error`, déjà géré par le `console.error` existant dans `bienvenue.html`/`connexion.html` (comportement inchangé, pas amélioré par cette correction — voir angle mort ci-dessous sur l'absence de notification utilisateur, hors périmètre de T2).

---

## Tests obligatoires

| # | Test | Attendu après correction |
|---|---|---|
| 1 | Création avec `menage` | Succès, ligne `profiles` + `companies` créée |
| 2 | Création avec `conciergerie` | Succès |
| 3 | Création avec `maintenance` | Succès |
| 4 | Création avec `autre` | Succès |
| 5 | Rejet d'une valeur inconnue (ex. `'plomberie'`) | Toujours rejeté — la correction ne doit pas supprimer toute validation |
| 6 | Gestion de `null` selon la règle actuelle | Toujours rejeté par `not null` (colonne, indépendant de la contrainte CHECK modifiée) — comportement inchangé, à confirmer non régressé |
| 7 | Deuxième tentative après échec (rejeu de `seba_profile_pending`) | **Risque identifié, pas corrigé par T2** : `profiles` n'a pas de contrainte d'unicité sur `user_id` (seule la PK `id` l'est) — rien n'empêche techniquement la création de deux lignes `profiles` pour le même utilisateur si la RPC est appelée deux fois avec succès. Ce risque était invisible jusqu'ici car la RPC n'a jamais réussi ; il devient réel dès que la correction est appliquée. **Signalé pour décision, pas résolu dans le périmètre minimal de T2** — voir angle mort. |
| 8 | Tentative de création d'un doublon | Confirme le point 7 : aujourd'hui, rien ne bloquerait un doublon. Test à écrire pour documenter ce comportement, correction éventuelle à discuter séparément. |
| 9 | Absence de profil partiellement créé (si l'insert `companies` échoue) | Une fonction PL/pgSQL s'exécute dans une transaction unique portée par l'appel RPC : si le second `insert` échoue, le premier doit être annulé automatiquement (pas de COMMIT intermédiaire dans le corps de la fonction) — à vérifier explicitement en forçant un échec artificiel sur le second insert. |
| 10 | Absence d'entreprise partiellement créée | Même mécanisme, couvert par le test 9. |
| 11 | Respect du tenant (isolation) | Un utilisateur A ne doit pas pouvoir créer un profil avec `_user_id` = compte B — déjà protégé par la policy RLS `profiles_insert` (`auth.uid() = user_id`), documenté dans le schéma ; à tester en régression pour confirmer que la correction ne touche pas cette protection (elle ne devrait pas, la contrainte modifiée est indépendante de la RLS). |
| 12 | Respect des permissions de la RPC | Vérifier qu'un appel non authentifié (`anon`) échoue — aujourd'hui protégé indirectement par la RLS (`auth.uid()` NULL ne correspond à aucun `_user_id`), pas par un `revoke`/`grant` explicite (voir constat ci-dessus). |
| 13 | Parcours `bienvenue.html` et `connexion.html` | Vérification bout en bout : une activation de compte réelle (ou simulée dans l'environnement isolé) aboutit à une ligne `profiles`/`companies` créée et à la suppression de `seba_profile_pending` du `localStorage`. |

Quand c'est possible (tests 1-6, 9-13), le test doit être écrit pour **échouer avant le correctif et réussir après** — c'est faisable dès que l'environnement isolé (T0, Option A recommandée) existe.

---

## Rollback — révisé, non trivial

**Correction explicite de mon évaluation précédente** ("rollback trivial") : cette évaluation n'était valable que tant qu'aucune ligne réelle n'existe. Une fois la correction appliquée et fonctionnelle, un rollback devient délicat dès qu'un seul profil réel est créé avec l'une des 4 nouvelles valeurs.

### Ce qui se passe si des profils avec `sector = 'autre'` (ou les 3 autres valeurs) existent déjà au moment d'un rollback
Restaurer directement l'ancienne contrainte (`check (sector in ('Nettoyage', 'Conciergerie', 'Artisanat'))`) échouerait immédiatement — PostgreSQL valide par défaut toutes les lignes existantes au moment où une contrainte CHECK est ajoutée (sauf si ajoutée avec `not valid`). Toute ligne avec `sector = 'menage'`/`'conciergerie'`/`'maintenance'`/`'autre'` violerait la contrainte restaurée et **bloquerait l'exécution même du rollback**.

### Ce que le rollback ne doit jamais faire
- Ne jamais convertir/réécrire silencieusement les valeurs existantes (ex. `'menage'` → `'Nettoyage'`) pour "faire rentrer" les données dans l'ancienne contrainte — ce serait une modification de données non autorisée, invisible pour quiconque consulterait `profiles` ensuite.
- Ne jamais supprimer les lignes existantes pour permettre la restauration de la contrainte.
- Ne jamais utiliser `not valid` sans le signaler explicitement (une contrainte `not valid` accepte les lignes existantes en violation mais bloque les nouvelles insertions/mises à jour — un état hybride qu'il faut choisir consciemment, pas silencieusement).

### Procédure de rollback proposée
1. Exécuter la requête de vérification #1 (répartition des valeurs de `sector`) avant toute tentative de rollback.
2. **Si aucune ligne n'utilise les 4 nouvelles valeurs** (rollback très rapide après la correction, avant toute vraie activation de compte) : rollback trivial, restauration directe de l'ancienne contrainte.
3. **Si des lignes existent déjà avec les nouvelles valeurs** : ne pas tenter un rollback complet. Deux voies possibles, à choisir humainement, pas automatiquement :
   - Rester sur la contrainte corrigée (probablement le bon choix si le problème initial était ailleurs) ;
   - Ou étendre temporairement la contrainte pour accepter **les deux vocabulaires simultanément** (`'Nettoyage', 'Conciergerie', 'Artisanat', 'menage', 'conciergerie', 'maintenance', 'autre'`) le temps de décider d'une vraie migration de données, jamais une conversion silencieuse.

**Aucune migration n'a été créée. Ce dossier est prêt pour ta validation avant toute exécution, dans l'environnement isolé retenu.**
