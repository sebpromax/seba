# SEBA — Sécurité et confiance

Statut : analyse de sécurité, faits vérifiés + recommandations pour l'extension publique. S'appuie sur l'audit backend complet (`SEBA_CURRENT_STATE_AUDIT.md`) et le modèle de domaine (`SEBA_DOMAIN_MODEL.md`).

---

## 1. Authentification (état actuel, vérifié)

Authentification universelle réelle pour patron/employé/client, chacun avec sa propre session Supabase Auth, provisionnée exclusivement par invitation descendante (le patron invite un employé ou un client qu'il connaît déjà). Garde-fou vérifié : `client-provision.ts:82-84` refuse (403) toute invitation si l'appelant ne possède pas le compte visé. Statut : ACTUEL ET CONFIRMÉ, gravité de risque : faible sur ce périmètre.

**Ce qui manque pour la vision** : un mode d'authentification ascendante — un visiteur public s'identifiant lui-même sans invitation préalable, avec une "identification légère et vérifiée" au moment de transmettre une demande (contrat de vision §16, décision humaine attendue sur le moment exact où elle devient obligatoire). Aucune preuve dans le code qu'un tel mécanisme existe aujourd'hui, même partiellement.

## 2. Autorisation (RLS, RPC)

Discipline RLS globalement bonne : aucune policy `using(true)` active trouvée dans le schéma réel (une occurrence de ce pattern existait dans un exemple de `docs-backend.md`, déjà retirée du document et documentée comme non représentative du schéma réel). Toutes les RPC SECURITY DEFINER vérifiées (`get_my_employee_profile`, `get_my_employee_interventions`, `close_my_intervention`, `get_my_client_profile`, `erase_account_completely`) résolvent le périmètre d'action depuis le JWT de l'appelant, jamais depuis un paramètre fourni par le client. Statut : ACTUEL ET CONFIRMÉ.

**Point de vigilance documenté mais non un risque actif** : la RLS de `seba_messages` combine 5 conditions (patron / client propriétaire / employé assigné en direct / 2 fils génériques hors `request_id`) — complexité de maintenabilité plus qu'une faille actuelle. Toute future modification de cette policy doit revérifier les 5 branches ensemble, pas une seule isolément.

## 3. Multi-tenancy

Cohérence `account`/`auth.uid()` bonne partout où vérifiée. Un bug historique de partage d'`accountId` entre comptes a été corrigé le 2026-07-07 (mémoire de projet, à reconfirmer si ce point redevient sensible — non re-testé automatiquement dans cet audit faute d'outillage, voir §11). Statut : HISTORIQUE ET CORRIGÉ pour ce bug précis ; ACTUEL MAIS PARTIELLEMENT VÉRIFIÉ pour l'absence de régression depuis (aucun test automatisé ne le garantit dans la durée).

## 4. Auto-inscription client / accès aux fiches (à construire)

Aujourd'hui : impossible — un client ne peut exister dans `client_accounts` que via l'Edge Function `client-provision.ts`, jamais par une action autonome. C'est un changement de nature à concevoir, pas une simple ouverture de policy (voir gap analysis §8). Recommandation : concevoir la nouvelle policy d'insertion pour l'origine publique comme **strictement additive** — ne jamais relâcher les conditions de la policy actuelle (invitation patron→client), créer une policy parallèle distincte pour le nouveau cas (visiteur identifié légèrement→demande publique).

## 5. Recherche transverse / exposition des coordonnées

Sujet neuf pour ce projet — voir la comparaison d'approches dans `SEBA_DOMAIN_MODEL.md` §3. **Décision prise (DEC-005, 2026-07-22)** : coordonnées directes non affichées par défaut sur les fiches du pilote, uniquement partagées après acceptation d'une demande, depuis la conversation. **Portée explicitement limitée** : cette règle ne concerne que les nouveaux clients découvrant le professionnel par la face publique — elle ne s'applique pas et ne doit rien changer aux relations déjà établies (clients existants, clients invités directement par le professionnel via `client-provision.ts`, relations contractuelles en cours), qui continuent de fonctionner exactement comme aujourd'hui. À implémenter : un champ "coordonnées visibles" distinct du contenu de la fiche elle-même dans la table publique (DEC-002), jamais exposé par défaut pour ce pilote.

### 5bis. Garde-fou de liste blanche pour la projection publique (DEC-002, 2026-07-22)

La synchronisation automatique des champs approuvés vers la fiche publique (DEC-002, principe n°4) ne doit jamais pouvoir devenir une fuite involontaire — c'est exactement le risque qu'on a écarté en éliminant l'option "vue publique sécurisée" (`SEBA_DOMAIN_MODEL.md` §3). Garde-fous obligatoires, non négociables pour cette implémentation :

1. La synchronisation automatique repose exclusivement sur une liste blanche explicite de champs (pas une liste noire, pas une exclusion par défaut).
2. Aucun nouveau champ privé ne peut devenir public automatiquement — ajout à la liste blanche = action explicite et revue, jamais un effet de bord d'une migration de schéma privé.
3. Un test automatisé doit échouer si un champ hors liste blanche apparaît dans la projection publique — ce test doit être écrit avant la mise en production de la table publique, pas après (voir §11, contrôle n°5, renforcé ci-dessous).
4. Les données sensibles (coordonnées, informations financières, toute donnée non explicitement whitelistée) restent exclues par défaut.
5. Toute publication, modification sensible, suspension et dépublication de la fiche est journalisée (acteur, date, ancien/nouvel état) — réutilise le principe de traçabilité déjà posé pour le rôle administrateur (DEC-003).

## 6. Pièces jointes, photos, documents, messages

Le modèle actuel (`mission-photos`) est solide : path scopé sur `client_requests.id` (UUID non devinable), policies distinctes select/insert selon le rôle et l'assignation courante, aucune policy delete/update (cohérent avec l'exigence d'intégrité d'une preuve). Recommandation pour l'extension : appliquer exactement le même pattern (path scopé sur un identifiant non énumérable) pour les pièces jointes de la demande initiale (le contrat de vision prévoit des photos dès la création de la demande, pas seulement à la clôture).

## 7. Paiements

Aucun paiement réel n'existe aujourd'hui (`stripe-service.js` auto-documenté comme démo). Aucun risque de sécurité actif sur ce périmètre puisqu'aucune transaction réelle n'a lieu — mais tout futur branchement Stripe réel devra être traité comme un chantier de sécurité à part entière (jamais de clé secrète côté client, cohérent avec la règle déjà existante du projet sur `docs/config.js`).

## 8. Vérifications, avis, modération (à créer entièrement)

Aucune brique n'existe. **Rôle et périmètre désormais validés en principe (DEC-003, 2026-07-22)** : le fondateur exerce personnellement la vérification, le traitement des signalements, la suspension et l'arbitrage des cas simples pendant le pilote, sans interface d'administration dédiée. Principes de sécurité à respecter dès la conception :
- Un avis ne doit pouvoir être écrit que par un client ayant réellement eu une intervention clôturée avec ce professionnel précis (anti-faux avis) — vérifiable via une jointure vers `client_requests`/interventions clôturées, pas une simple déclaration libre.
- La vérification d'une fiche (badge) doit être une action distincte de la revendication, réservée au fondateur pendant le pilote — jamais un simple effet de paiement d'un abonnement. Le badge doit être typé (téléphone vérifié, identité vérifiée, existence légale vérifiée, assurance vérifiée), jamais un badge vague unique.
- Chaque action sensible du fondateur (vérification, suspension, arbitrage) doit être journalisée : acteur, date, type d'action, justification, documents examinés, ancien/nouvel état, éventuelle date d'expiration — même en traitement entièrement manuel.
- **Seuils de bascule vers une vraie interface d'administration** (proposés comme hypothèses à corriger après le pilote, pas des valeurs figées) : nombre de fiches en attente de vérification, nombre de vérifications traitées par semaine, nombre de signalements par semaine, temps hebdomadaire consacré à la modération, délai moyen de traitement, taux d'erreur ou de réouverture d'un dossier déjà traité.
- Les avis publics complexes peuvent être repoussés après le premier pilote — le périmètre minimal du pilote est : revendication, vérifications essentielles, signalement, suspension manuelle.

## 9. Signalements, rate limiting, anti-spam, anti-bot

Rien n'existe aujourd'hui. **Condition bloquante explicite (DEC-004, 2026-07-22)** : l'ouverture d'un flux de confirmation par SMS ou email (identification légère avant l'envoi d'une demande) est **interdite** avant la mise en place et le **test réel** (pas seulement la conception) de :
- rate limiting par adresse IP, identité, appareil, ou autre signal pertinent ;
- limitation du nombre de codes envoyés par destinataire ;
- délai minimal entre deux envois ;
- expiration des codes de confirmation ;
- limitation du nombre de tentatives de saisie ;
- protection anti-bot ;
- détection de comportements anormaux (rafales de créations de brouillons, motifs répétitifs) ;
- plafonds de coût pour les SMS (protection contre la fraude "SMS pumping", un vecteur d'attaque connu contre ce type de flux) ;
- logs et alertes sur les seuils dépassés ;
- mécanisme de blocage (temporaire ou permanent) d'une source abusive.

Motivation : un point d'entrée non authentifié ou faiblement authentifié est une cible naturelle de spam/abus, et aucun de ces mécanismes n'existe aujourd'hui dans le dépôt (confirmé par l'audit tests/CI). Le choix du canal (SMS vs email vs connexion sans mot de passe) doit être comparé explicitement selon : sécurité, coût, délivrabilité, friction, récupération d'accès, risques d'abus — avant, pas après, le choix définitif.

## 10. RGPD, suppression, export

**Constat existant, bon** : `erase_account_completely()` couvre correctement le patron propriétaire et toutes ses tables satellites par cascade (`ON DELETE CASCADE` sur `seba_state.account`), y compris les tables créées après cette migration (mécanisme générique, pas besoin de mise à jour manuelle à chaque nouvelle table satellite).

**Gap confirmé (voir audit §7)** : aucune fonction équivalente n'existe pour qu'un client ou un employé invité supprime **ses propres données** (son propre compte `auth.users`, distinct de celui du patron). Statut : ACTUEL ET CONFIRMÉ, gravité modérée aujourd'hui (peu de clients/employés invités), **gravité qui augmente mécaniquement avec l'ouverture publique** — un visiteur public qui crée un compte pour déposer une demande doit pouvoir, de la même façon, demander la suppression de son propre compte sans dépendre du patron. Recommandation : traiter ce gap **avant** l'ouverture publique, pas après (contrairement à d'autres chantiers qui peuvent suivre le pilote).

**Second gap documenté par le schéma lui-même** : `sync_operations` est append-only par conception (aucune policy DELETE) et peut contenir des données personnelles dans ses colonnes `patch`, non couvert par `eraseAllData()`/`erase_account_completely()`. Nécessiterait une anonymisation `service_role` non implémentée à ce jour. Gravité modérée, statut actuel confirmé.

**Risque additionnel identifié** : `SebaDB.eraseAllData()` (suppression déclenchée côté client) attrape et ignore silencieusement un échec réseau — la ligne cloud peut survivre à une demande de suppression si l'appel échoue, sans retry ni file d'attente (contrairement aux écritures normales qui, elles, ont une file de rejeu). Gravité modérée, cas RGPD sensible, statut actuel confirmé.

## 11. Contrôles à tester automatiquement avant tout pilote réel

Aucun de ces contrôles n'existe aujourd'hui sous forme automatisée (confirmé par l'audit tests/CI — voir `SEBA_CURRENT_STATE_AUDIT.md` §6). Liste des contrôles minimaux à instaurer avant l'ouverture d'un pilote avec de vrais utilisateurs externes, par ordre de priorité :

1. **Isolation multi-tenant automatisée** : un test reproductible (pas un script ponctuel comme l'actuel `verify-accountid-fix.js`) qui crée deux comptes distincts et vérifie que ni l'un ni l'autre ne peut lire/écrire les données de l'autre, via une exécution réelle contre les policies Postgres (pas seulement une observation du comportement JS côté client).
2. **Test RLS sur `client_requests`/`seba_messages`** : vérifier automatiquement qu'un client ne peut ni lire ni modifier une demande qui n'est pas la sienne, qu'un employé non assigné ne peut pas lire une conversation, et qu'une réassignation coupe bien l'accès immédiatement (comportement documenté dans le code mais jamais testé automatiquement).
3. **Test de la RPC `close_my_intervention`** : vérifier l'atomicité (verrou `FOR UPDATE`) sous accès concurrent simulé.
4. **Test RGPD** : vérifier que `erase_account_completely()` supprime effectivement toutes les données attendues, sur un compte de test créé avec des données dans chaque table satellite.
5. **Test de la future policy publique** (dès sa création) : vérifier qu'aucun champ marqué privé dans le profil professionnel ne fuite jamais vers la table/vue publique, avec un test qui échoue explicitement si un nouveau champ privé est ajouté sans classification explicite publique/privée. Renforcé par la liste blanche de §5bis : le test doit spécifiquement échouer si un champ hors liste blanche apparaît dans la projection publique, pas seulement vérifier une absence générale de fuite.
6. **Test des mécanismes anti-abus du flux de confirmation** (§9) : vérifier que le rate limiting, l'expiration des codes et la limitation des tentatives fonctionnent réellement sous simulation d'abus (rafale de demandes de code, tentatives répétées) — condition explicitement bloquante avant l'ouverture du flux (DEC-004), pas un test parmi d'autres.

## 12. Sauvegarde, restauration, rotation des secrets, environnements, accès administrateur

**Non vérifiable depuis ce dépôt** : configuration réelle de sauvegarde/restauration Supabase (dépend du plan et de la configuration du projet réel, pas du code), rotation effective des secrets (Vault Supabase), séparation environnements dev/prod réelle, accès administrateur au dashboard Supabase lui-même. Ces points doivent être vérifiés directement dans la console Supabase de production, pas dans ce dépôt — signalé comme point à contrôler humainement avant tout pilote avec données réelles sensibles.

## 13. Synthèse des risques de sécurité par gravité

| Risque | Gravité | Statut temporel | Doit être traité avant l'ouverture publique ? |
|---|---|---|---|
| Absence de RPC d'auto-suppression RGPD pour client/employé invité | modérée | actuel confirmé | Oui — avant |
| Perte silencieuse de données après échec de synchronisation prolongé | élevée | actuel confirmé | Oui — avant, une fois le volume d'utilisateurs augmenté |
| Échec silencieux de `eraseAllData()` en cas de coupure réseau | modérée | actuel confirmé | Oui — avant |
| `sync_operations` non couvert par l'anonymisation RGPD | modérée | actuel confirmé | Recommandé avant, sinon en tout début de pilote |
| Aucun test automatisé de RLS/multi-tenant | critique (risque de confiance) | actuel confirmé | Oui — avant tout élargissement au public |
| Absence de rate limiting/anti-spam sur un futur point d'entrée public | élevée (dès que le point d'entrée existera) | à construire | Oui — dès la conception du formulaire public |
| Rôle administrateur/modération non défini | élevée pour la confiance produit | **résolu en principe (DEC-003)** — seuils numériques de bascule restent à observer | Décision de principe prise ; seuils à corriger après le pilote |
| `create_profile_and_company` en échec systématique | élevée (latent) | actuel confirmé | Oui — avant de réutiliser `profiles`/`companies` pour la fiche publique |
| Validation terrain jamais réalisée pour le secteur/zone du pilote | élevée pour l'adoption | **GATE-0 obligatoire, non exécuté** | Oui — bloque tout développement du Groupe 3 (`SEBA_EXECUTION_ROADMAP.md`) |
| Fraude par abus de codes SMS ("SMS pumping") sur le futur flux de confirmation | élevée dès l'ouverture du flux | à construire, aucun mécanisme anti-abus n'existe aujourd'hui | Oui — condition bloquante explicite avant toute ouverture (DEC-004) |
| Dérive de la synchronisation automatique de la fiche publique vers une fuite de champ non maîtrisée | modérée à élevée si la liste blanche n'est pas testée automatiquement | à construire | Oui — avant la mise en production de la table publique (§5bis) |
