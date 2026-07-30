# ADR — Source de vérité des données métier Seba

**Statut** : Accepté (constat, pas une décision de conception nouvelle — documente l'état réel du code de production tel que trouvé le 2026-07-30, QA360-P0).

**Contexte** : `_architecture/QA360_P0_REMEDIATION_PLAN.md` section 5 (analyse complète, preuves de code).

---

## Contexte

Le schéma Supabase (`supabase-schema.sql`) définit deux familles de stockage pour les données métier (clients, devis, factures, interventions, employés, paiements) :

1. `seba_state` — une table à une ligne par compte, colonne `state jsonb`, contenant l'intégralité des données métier de ce compte sous forme d'un document JSON unique.
2. Des tables normalisées classiques (`clients`, `devis`, `factures`, `paiements`, `interventions`, `employes`, etc.), avec de vraies colonnes et Row Level Security activée.

À l'œil, les deux semblent également valides comme source de vérité — les tables normalisées ont même l'air plus "canoniques" (vraies colonnes, RLS explicite par table).

Un audit de vérité (2026-07-30) a nécessité de trancher laquelle est réellement utilisée, en lisant le code de production plutôt qu'en supposant.

## Décision (constat)

**`seba_state.state` (JSONB) est aujourd'hui l'unique source de vérité opérationnelle réellement utilisée par Seba.**

Preuves, par lecture directe du code déployé :

- **Écriture patron** : `SebaDB.update/create/remove()` (`docs/seba-data.js`) mute l'état local puis met en file un patch (`pushOp()`), synchronisé par la fonction Edge `sync-push` via la RPC `apply_entity_patch(p_account, p_entity, p_entity_id, p_patch_jsonb, p_op)`. Cette RPC (version courante, `migrations/2026-07-28-sync-push-state-persistence.sql`) écrit **dans une seule transaction atomique** à la fois `seba_state.state` (source lue) et `entity_versions` (bookkeeping de version/idempotence, jamais relu par l'application).
- **Lecture patron** : `SupabaseAdapter.pull()` (`docs/seba-data.js:168`) — `GET /rest/v1/seba_state?select=state&account=eq.<compte>` — lit `seba_state.state` directement.
- **Lecture portail client** : `get_my_client_interventions()` (`security definer`, `migrations/2026-07-25-intervention-360.sql`) résout `auth.uid()` → `client_accounts` → `account`+`client_id`, puis filtre `seba_state.state -> 'interventions'` en JSONB côté serveur (`jsonb_array_elements`). Ne touche jamais la table normalisée `interventions`.
- **Lecture portail employé** : présumée du même patron (`get_my_employee_interventions()`, non relue ligne par ligne dans cette passe — à vérifier avant de la considérer aussi solidement établie que le côté client).

**Les tables normalisées (`clients`, `devis`, `factures`, `paiements`, `interventions`, `employes`) semblent vestigiales** : aucun chemin de lecture ni d'écriture trouvé dans cette passe ne les utilise. Hypothèse la plus probable : une architecture antérieure au pivot vers le modèle JSONB par compte, jamais retirée du schéma. **Ceci reste une conclusion de recherche du 2026-07-30, pas une certitude absolue** — un usage résiduel non découvert (une policy Storage, une fonction non lue) reste possible.

## Conséquences

1. **Tout nouveau code (patron, portail client, portail employé, Edge Function) doit lire et écrire via `seba_state.state`** (directement pour le patron, via une RPC `security definer` qui filtre le JSONB pour les portails à accès restreint), jusqu'à une décision de migration explicite documentée dans un ADR successeur.
2. **Ne jamais écrire dans les tables normalisées en supposant qu'elles sont lues quelque part** — à ce jour, rien ne les lit. Un code qui y écrirait créerait une illusion de persistance sans effet réel observable pour l'utilisateur.
3. **Aucune suppression ni migration des tables normalisées n'est décidée par ce document.** Ce n'est pas le rôle de cet ADR — il documente l'état actuel pour éviter une erreur d'aiguillage, pas une refonte. Une décision de les supprimer, les documenter comme mortes officiellement, ou leur trouver un usage réel appartient au fondateur, dans un futur ADR dédié si le sujet est repris.
4. **`supabase-schema.sql` contient une version obsolète de `apply_entity_patch`** (section 11, signature à 4 paramètres) — remplacée par la version à 5 paramètres de la migration du 2026-07-28. Le fichier de schéma de référence n'a pas été mis à jour pour refléter cette migration ; le lire comme documentation à jour de la fonction est trompeur. Non corrigé par cet ADR (documentation seule) — signalé pour une passe d'hygiène séparée.

## Alternatives non retenues (pour mémoire)

- **Considérer les tables normalisées comme la source de vérité future et migrer le code vers elles** : non tranché ici, nécessiterait une décision produit explicite (RLS par ligne plus fine, meilleure indexation/requêtage) pesée contre le coût de migration d'un système qui fonctionne aujourd'hui. Hors périmètre de ce constat.
- **Supprimer les tables normalisées immédiatement** : refusé par précaution — un usage résiduel non découvert reste possible, et la suppression d'un objet de schéma en production est une action difficile à annuler pour un bénéfice non urgent.
