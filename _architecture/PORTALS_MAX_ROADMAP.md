# Programme complet d'amélioration des portails Client et Salarié — feuille de route

**Créé** : 2026-08-02, en ouverture du programme demandé par le fondateur. Source des faits : `_architecture/AUDIT_INTERCONNEXION_PORTAILS.md` (audit exhaustif du même jour).

**Doctrine de gouvernance** (héritée de `CLAUDE.md`, non négociable pour ce programme) : un lot = une branche = une PR = un commit local en attente de fusion explicite. `main` sert directement la production (GitHub Pages) — aucune fusion automatique, quel que soit le nombre de lots livrés en séquence. Chaque lot livré s'arrête au commit + push + PR ouverte, avec rapport, puis attend l'autorisation de fusion avant que le lot suivant démarre.

---

## 0. Gates de production — résultat

Exécutées le 2026-08-02, avant tout code de Lot 1 :

| Gate | Résultat | Preuve |
|---|---|---|
| `client-provision` → `verify_jwt=true` | **CONFIRMÉ** | `supabase functions list --project-ref ptmudezhxnhhyctowlqp` → `"slug":"client-provision","verify_jwt":true` |
| `employe-provision` → `verify_jwt=true` | **CONFIRMÉ** | idem → `"slug":"employe-provision","verify_jwt":true` |
| Fonctions déployées correspondent au code de `main` | **PROBABLE, non prouvé à 100%** | `entrypoint_path` en `/tmp/user_fn_.../source/index.ts` (déploiement par collage dans le dashboard, comme documenté pour `send-email` dans `MANUEL-SEBA-ADMIN.md`) — cohérent avec `supabase-functions/client-provision.ts`/`employe-provision.ts` étant l'unique source existante dans le dépôt, mais aucun hash n'a pu être comparé directement sans télécharger le code déployé |
| Secrets Resend configurés (`RESEND_API_KEY`, `RESEND_FROM`) | **CONFIRMÉ présents** (noms de secrets, jamais leur valeur) | `supabase secrets list` → les deux entrées existent, mises à jour le 2026-07-30 |
| Envoi email réellement livré en production | **NON RE-TESTÉ** | conformément à la consigne du fondateur ("l'infrastructure a déjà été corrigée, ne reconfigure pas sans échec reproductible") — confiance accordée à la déclaration, aucun envoi réel déclenché dans cette passe |
| Cycle Intervention 360 (réouverture → correction → réapprobation → validation → reload) avec `sync-push` réellement actif | **RÉSOLU — anomalie confirmée comme un artefact du harnais de test local, pas un bug produit** | voir §1 ci-dessous |

### 1. Anomalie Intervention 360 — root cause confirmée

`scripts/qa-intervention-360.js` échoue de façon reproductible (4-5 assertions) sur le cycle réouverture→correction→réapprobation→validation, **mais uniquement à cause de son propre contournement `flushPatronStateToServer()`** (fusion JSONB manuelle par `psql`, utilisant l'état LOCAL du navigateur du patron — un instantané qui ne contient jamais les écritures faites en parallèle par l'employé et le client via leurs propres sessions). Ce contournement a été conçu à une époque où l'Edge Function `sync-push` n'était pas servie dans l'environnement local (limitation documentée). **Une fois `sync-push` réellement servie localement** (`npx supabase functions serve`, testé ce jour), **un script de reproduction isolé, sans ce contournement, reproduisant exactement le même cycle métier avec un rechargement de page avant chaque validation patron (comportement réel d'un vrai utilisateur), passe intégralement (TOUT PASSE, 2/2 assertions clés, historique complet des 2 événements `completed`).**

**Conclusion** : aucun bug produit. `scripts/qa-intervention-360.js` n'a pas été modifié (conforme à la consigne de ne jamais changer un test pour masquer un échec) — son contournement local reste ce qu'il est, documenté comme limitation connue dans son propre en-tête. Le programme peut démarrer.

**Action de fond recommandée, hors périmètre de ce programme** : envisager de faire tourner `supabase functions serve` par défaut dans `scripts/local-db/rebuild.sh` pour que les futurs harnais de test n'aient plus besoin du contournement `flushPatronStateToServer()` — à proposer au fondateur séparément, pas un blocage pour les lots ci-dessous.

---

## 2. Lots — ordre, dépendances, risques, critères de sortie

| # | Lot | Dépend de | Risque principal | Critère de sortie |
|---|---|---|---|---|
| 1 | Centre de notifications commun | Gates (résolues) | Sur-notification, fuite cross-tenant | Table `notifications` avec RLS testée, UI in-app fonctionnelle sur les 3 portails, 0 fuite, CI verte |
| 2 | Profil Client et lieux multiples | Lot 1 (pour notifier les changements de lieu) | Migration de l'adresse unique existante vers une table `client_locations` sans perte de données | Migration réversible testée, ancien champ `client.adresse` conservé en compatibilité, RLS testée |
| 3 | Coffre d'accès sécurisé | Lot 2 (les secrets sont attachés à un lieu) | Fuite de secrets dans logs/notifications/cache | Secrets jamais dans une notification, jamais dans une URL, historique de consultation, RLS testée strictement par mission active |
| 4 | Demandes, réservations et planning Client | Lot 1, 2 | Client modifiant le planning final sans validation patron | Toute action Client = une demande, jamais une écriture directe du planning |
| 5 | Messagerie avancée et canal interne | Lot 1 | Fuite du canal interne vers Client/Salarié non autorisé | Colonne de visibilité explicite testée, jamais une déduction frontend |
| 6 | Expérience Client après prestation | Lot 1, 4 | Fuite de notes internes/marge/coût salarié | Allowlist RPC déjà existante étendue, jamais élargie par erreur |
| 7 | Documents, paiements et corrections | Lot 1 | Perte de traçabilité sur une correction de paiement | Historique immuable de correction, jamais une suppression silencieuse |
| 8 | Profil Salarié complet | Lot 1 | Aucun majeur | Champs additionnels RLS testés (self-read/write, patron read/write) |
| 9 | Disponibilités et permissions fines | Lot 8 | Régression sur les permissions actuelles (`employe.acces`) pendant la migration | Ancien format toujours lu en compatibilité, nouveau format additif |
| 10 | « Ma journée » Salarié | Lot 8, 9 | Aucun majeur (lecture seule principalement) | Mobile-first testé à 320-1440px |
| 11 | Détail de mission et exécution avancée | Lot 1, 10 | Régression sur Intervention 360 existante (déjà très testée) | Suite `qa-intervention-360.js` repassée sans nouvelle régression |
| 12 | Temps, frais et matériel Salarié | Lot 11 | Aucun majeur | RLS testée (self-write, patron validate) |
| 13 | Hors-ligne terrain complet | Lot 11, 12 | Perte de données lors d'un conflit mal résolu | Aucun écrasement silencieux, avertissement de conflit testé |
| 14 | Automatisations | Lot 1 (notifications), 4 | Sur-notification, boucle d'automatisation | Déduplication testée, désactivation possible |
| 15 | Realtime facultatif | Lots 1-14 stables | Devenir source de vérité par erreur | Le produit fonctionne intégralement sans Realtime (dégradation propre) |
| 16 | RGPD, sessions, journal d'audit | Tous | Décision produit prise sans arbitrage fondateur | Aucun code avant arbitrage écrit des 9 points RGPD-001 |

**Ordre fixé, non modifié sans justification technique** (conforme à la consigne du fondateur).

---

## 3. État des PR (mis à jour à chaque lot)

| Lot | Branche | PR | Statut | Fusionné |
|---|---|---|---|---|
| 1 | `feat/portal-notifications-foundation` | — | En cours | Non |
| 2-16 | — | — | Non démarré | Non |

---

## 4. Documents complémentaires

- `_architecture/PORTAL_CAPABILITIES_MATRIX.md` — matrice des capacités par rôle.
- `_architecture/PORTAL_DATA_CONTRACTS.md` — contrats de données par objet.
- `_architecture/PORTAL_NOTIFICATION_EVENTS.md` — catalogue des événements de notification.
