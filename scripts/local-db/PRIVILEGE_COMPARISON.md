# Comparaison privilèges locaux vs distants — à compléter après exécution manuelle

Statut : gabarit vide. Aucune requête n'a été exécutée contre le projet partagé (je n'y ai aucun accès). Remplir la colonne "Privilèges distants" après avoir exécuté `REMOTE_PRIVILEGE_AUDIT_QUERIES.sql` dans l'éditeur SQL Supabase du projet réel.

| Objet | Privilèges locaux (`local-only-grants.sql`) | Privilèges distants (à remplir) | Écart | Risque | Action proposée |
|---|---|---|---|---|---|
| Tables publiques — `authenticated` | SELECT, INSERT, UPDATE, DELETE (toutes) | ? | ? | ? | ? |
| Tables publiques — `anon` | SELECT seul (toutes) | ? | ? | ? | ? |
| Séquences | Non accordé explicitement | ? | ? | ? | ? |
| Fonctions (RPC) | 4 `GRANT EXECUTE` explicites (voir `supabase-schema.sql`), le reste par défaut PostgreSQL | ? | ? | ? | ? |
| `ALTER DEFAULT PRIVILEGES` (objets futurs) | Aucun configuré localement | ? | ? | ? | ? |
| `USAGE`/`CREATE` sur schéma `public` | `USAGE` accordé à `anon`/`authenticated` (ligne 1 de `local-only-grants.sql`), `CREATE` non accordé | ? | ? | ? | ? |
| Tables exposées sans privilège SELECT | Aucune (toutes couvertes par le grant générique) | ? | ? | ? | ? |
| Tables avec privilège mais sans RLS | Aucune (RLS activée sur les 23 tables, confirmé Cycle A) | ? | ? | ? | ? |

## Comment interpréter un écart

- **Distant = plus restrictif que local** → `local-only-grants.sql` est trop permissif pour représenter fidèlement la production ; à resserrer après analyse de quel(s) rôle(s)/RPC portent réellement l'accès en production.
- **Distant = aussi permissif que local** → `local-only-grants.sql` est une reproduction fidèle, peut rester tel quel avec un statut "local uniquement" clarifié (voir en-tête du fichier).
- **Distant = plus permissif que local** → un privilège existe en production que ni le local ni aucun fichier versionné ne documente — creuser d'où il vient (dashboard Supabase, script d'installation initial non versionné) avant de le reproduire localement.

**Rappel explicite (2026-07-22)** : si la production ne possède pas les privilèges que le local suppose nécessaires, ne pas en conclure automatiquement qu'il faut les ajouter en production — d'abord déterminer comment l'application fonctionne aujourd'hui malgré cet écart apparent (quels RPC SECURITY DEFINER contournent le besoin de privilège table direct, par exemple `get_my_client_profile()`/`get_my_employee_profile()` qui lisent `seba_state` sans jamais exposer de SELECT direct sur cette table à l'appelant).
