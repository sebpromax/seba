# Environnement Supabase local — SEBA

Environnement de développement/test isolé, distinct du projet Supabase de production. Créé le 2026-07-22 (Phase 1B).

## Version

**Supabase CLI fixée à `2.109.1`** — jamais installée globalement, toujours invoquée via `npx --yes supabase@2.109.1 <commande>` pour garantir qu'aucune autre version n'est utilisée par erreur, aujourd'hui ou plus tard.

- Vérifier la version utilisée : `npx --yes supabase@2.109.1 --version` (doit afficher `2.109.1`).
- Mettre à jour volontairement plus tard : changer le numéro dans **tous** les scripts de ce dossier et dans ce README — jamais un changement silencieux d'un seul endroit.
- Désinstaller / revenir en arrière : rien à désinstaller globalement (aucune installation persistante) — `npx` télécharge et met en cache la version demandée à chaque appel. Pour repartir de zéro : `bash scripts/local-db/stop.sh`.

## Modèle baseline + overlay (important)

`migrations/` **n'est pas une chaîne de migrations rejouable en séquence**. `supabase-schema.sql` est un fichier maître continuellement remis à jour qui absorbe déjà la quasi-totalité des migrations historiques. Un seul fichier reste un véritable overlay séparé (action manuelle volontaire, jamais fusionnée) : `migrations/2026-07-11-rgpd-suppression-compte.sql`. Voir `migrations-order.txt` pour la classification complète, fichier par fichier, avec preuve.

**Conséquence directe sur les commandes** : la reconstruction n'applique **jamais** l'overlay RGPD par défaut — il faut le demander explicitement.

## Commandes

| Commande | Rôle |
|---|---|
| `bash scripts/local-db/rebuild.sh` | Baseline uniquement (`supabase-schema.sql`) : détruit, redémarre Supabase local, applique le baseline, insère le jeu de données synthétique. S'arrête immédiatement à la première erreur. |
| `bash scripts/local-db/rebuild.sh --with-rgpd` | Baseline **puis** overlay RGPD explicite (`migrations/2026-07-11-rgpd-suppression-compte.sql`). Affiche un avertissement visible quand l'overlay s'active. Un échec de l'overlay n'invalide pas le baseline déjà appliqué. |
| `bash scripts/local-db/rebuild.sh --show-baseline-diff` | N'exécute aucune reconstruction. Affiche le diff de `supabase-schema.sql` depuis le dernier commit validé et la procédure obligatoire de revalidation manuelle (jamais automatique). |
| `bash scripts/local-db/stop.sh` | Détruit complètement l'environnement local (`--no-backup`, aucune donnée conservée). |
| `bash scripts/local-db/seed-synthetic.sh` | Insère seulement le jeu de données synthétique. |
| `bash scripts/local-db/verify.sh` | Vérifications du baseline : infrastructure, inventaire du schéma, tests RLS élémentaires. Confirme aussi l'**absence** de `erase_account_completely` tant que l'overlay n'a pas été appliqué. |
| `bash scripts/local-db/verify-rgpd-overlay.sh` | Vérifications spécifiques à l'overlay RGPD, à lancer uniquement après `rebuild.sh --with-rgpd` : propriétés de sécurité de la fonction, rejouabilité, puis un appel réel limité à un compte synthétique. |

## Prérequis

- Docker Desktop installé et **démarré** (le daemon doit répondre à `docker ps`).
- Aucune autre dépendance à installer manuellement.

## Fichiers de ce dossier

- `migrations-order.txt` — classification complète (BASELINE / OVERLAY MANUEL FACULTATIF / HISTORIQUE ABSORBÉ / SCRIPT DE TEST), avec preuve pour chaque fichier. **Ne jamais régénérer par un simple tri alphabétique.**
- `BASELINE_MANIFEST.txt` — commit et hash sha256 de `supabase-schema.sql` au moment de la validation. `rebuild.sh` compare ce hash à chaque exécution et avertit (sans bloquer) si le fichier maître a changé depuis — dans ce cas, revalider manuellement `migrations-order.txt` avant de faire confiance à la classification.
- `.synthetic-ids.env` — généré automatiquement par `seed-synthetic.sh`, gitignoré, ne contient aucune donnée réelle.

## Ce que cet environnement n'est pas

- Ce n'est pas une copie de la production — aucune donnée réelle n'y est jamais introduite.
- Ce n'est pas un remplacement des migrations historiques dans `migrations/` — ces fichiers ne sont ni renommés ni déplacés.
- Ce n'est pas un environnement persistant de confiance — traité comme jetable par construction, à reconstruire à la demande.

## Dette structurelle connue (signalée, non corrigée ici)

Le dossier `migrations/` mélange, sans frontière explicite jusqu'ici : un fichier maître continuellement fusionné, des migrations historiques absorbées, une action manuelle séparée (RGPD), et un script de test. Ce fonctionnement est praticable pour reprendre le contrôle localement mais fragile pour l'avenir. Règle proposée pour la suite (non appliquée rétroactivement) : **toute nouvelle migration doit indiquer explicitement, dans son propre en-tête, si elle est destinée à être fusionnée dans `supabase-schema.sql` ou à rester une action manuelle séparée** — pour ne plus jamais avoir à reconstituer cette frontière a posteriori par audit de contenu.
