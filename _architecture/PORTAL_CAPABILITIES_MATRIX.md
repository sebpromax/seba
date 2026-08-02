# Matrice des capacités par rôle — Portails Seba

**Créé** : 2026-08-02. Colonne **Statut** : `EXISTANT` (vérifié par l'audit du 2026-08-02) / `LOT n` (à construire, numéro du lot du `PORTALS_MAX_ROADMAP.md`) / `EXISTANT PARTIEL` (mécanisme présent mais incomplet, précisé en note).

Légende des colonnes de rôle : `RW` = lecture+écriture, `R` = lecture seule, `W` = écriture seule (rare), `—` = aucun accès, `R (allowlist)` = lecture filtrée server-side (jamais l'objet brut).

| Capacité | Pro | Client | Salarié | Contrôle serveur | Statut |
|---|---|---|---|---|---|
| `client.profile.read` | RW | R (soi-même) | — | RLS `client_accounts` | LOT 2 (aujourd'hui : lecture seule via fiche patron, pas d'auto-lecture client) |
| `client.profile.update` | RW | W (champs autorisés uniquement) | — | RPC dédiée à écrire, allowlist de champs | LOT 2 |
| `client.location.read` | RW | R (ses lieux) | R (lieu de sa mission assignée) | RLS `client_locations` + jointure mission active | LOT 2 (aujourd'hui : 1 seule adresse, pas de table dédiée) |
| `client.location.update` | RW | W (proposition, validation patron) | — | RPC avec validation patron | LOT 2 |
| `location.secret.read.assigned` | RW | — | R (uniquement pendant la mission active) | RPC `security definer`, vérifie assignation ET fenêtre temporelle | LOT 3 (aujourd'hui : aucun champ secret dédié) |
| `location.secret.update` | RW | Proposition seule | — | RPC dédiée, jamais une écriture directe | LOT 3 |
| `mission.read.assigned` | RW | R (allowlist) | R (sa mission uniquement) | `get_my_employee_interventions()`, testé | EXISTANT |
| `mission.status.update` | RW | — (approbation seulement) | W (sa mission, transitions contrôlées) | `update_my_employee_intervention_status()`, testé (statut arbitraire refusé) | EXISTANT |
| `mission.photo.upload` | R | R (filtré par `visibleToClient`) | W | Bucket `intervention360-photos`, policies testées | EXISTANT |
| `mission.internal_note.read` | RW | — (jamais) | R (ses missions) | Allowlist RPC exclut déjà checklist/materials/incidents du client | EXISTANT |
| `mission.checklist.update` | R | — | W (sa mission) | Testé, finalisation refusée si incomplète | EXISTANT |
| `mission.incident.create` | R | W (signalement) | W | Testé (`test-intervention-360-rls.sh`) | EXISTANT |
| `mission.report.submit` | R (valide) | R | W | Testé (`completeIntervention()`) | EXISTANT |
| `invoice.read.own` | RW | R (siennes uniquement) | — | Testé cross-account (`qa-quote-to-cash.js`) | EXISTANT |
| `invoice.update` | RW | — (jamais) | — | RLS : UPDATE côté client = 0 ligne affectée, testé | EXISTANT |
| `invoice.correct` | RW | — | — | Historique immuable de correction requis | LOT 7 (aujourd'hui : absent, P1 audit) |
| `payment.record` | RW | — | — | RPC patron uniquement | EXISTANT |
| `payment.correct` | RW | — | — | Historique immuable, auteur, motif obligatoire | LOT 7 (absent aujourd'hui) |
| `payment.refund` | RW | — | — | idem | LOT 7 |
| `team.read` | RW | — | R (équipe de sa mission si autorisé) | À restreindre explicitement | LOT 9 |
| `planning.read.own` | RW | R (allowlist) | R (ses missions) | Testé | EXISTANT |
| `planning.update.team` | RW | — | — | Réservé patron | EXISTANT |
| `planning.request.create` (demande Client) | R (traite) | W | — | RPC dédiée, jamais une écriture directe du planning | LOT 4 |
| `devis.read.own` | RW | R | — | Testé | EXISTANT |
| `devis.accept` | R | W (bouton horodaté serveur) | — | RPC idempotente testée | EXISTANT |
| `devis.refuse.with_reason` | R | W | — | RPC à créer avec motif obligatoire | LOT 7 |
| `message.thread.read.participant` | RW | RW (fil autorisé) | RW (fil autorisé) | Testé ce jour (probe RLS dédiée) | EXISTANT |
| `message.internal.read` | RW | — (jamais) | R (si équipe/responsable) | Colonne de visibilité explicite requise | LOT 5 |
| `notification.read.own` | R (les siennes) | R (les siennes) | R (les siennes) | RLS stricte par destinataire | LOT 1 |
| `notification.mark_read` | W | W | W | RPC, vérifie propriété avant update | LOT 1 |
| `availability.read.own` | R | — | RW | Testé (`test-team-availability-rls.sh`) | EXISTANT |
| `availability.request.create` | R (valide) | — | W | Testé | EXISTANT |
| `permission.read` | RW | — | R (les siennes) | À exposer en lecture au salarié lui-même | LOT 9 |
| `permission.update` | RW | — | — (jamais ses propres droits) | Testé implicitement (aucune RPC salarié n'expose ceci) | EXISTANT (négatif, à formaliser LOT 9) |
| `settings.update` | RW | — | — | Réservé patron | EXISTANT |
| `session.read.own` | R | — | — | LOT 16 | LOT 16 |
| `session.revoke.own` | R (peut forcer) | — | — | LOT 16 | LOT 16 |
| `audit.read` | R (ses entrées) | — | — | Journal actuel non tamper-resistant, à durcir | LOT 16 |
| `expense.create` | R (valide) | — | W | LOT 12 | LOT 12 |
| `equipment.read.assigned` | RW | — | R | LOT 12 | LOT 12 |
| `offline.queue.write` | R | R | RW (écritures + photos) | Actuellement : écritures textuelles en file, photos non mises en file | LOT 13 (partiel EXISTANT) |
| `automation.rule.manage` | RW | — | — | Réservé patron | LOT 14 |
| `realtime.subscribe` | RW | RW | RW | Aucun canal Supabase Realtime actif aujourd'hui | LOT 15 |

**Note de méthode** : cette matrice sera mise à jour à la fin de chaque lot (colonne Statut passe de `LOT n` à `EXISTANT` avec un renvoi vers la preuve de test correspondante), jamais avant qu'un lot soit réellement fusionné et vérifié en production.
