-- ═══════════════════════════════════════════════════════════════
-- SEBA — client_memoire : historique technique par intervention, exposé
-- directement au frontend (dette technique PLAN.md "Créer la vue/table
-- client_memoire").
--
-- 3 écarts assumés par rapport au brief initial, même raisonnement que
-- les paliers précédents (Palier 5, section 22 de supabase-schema.sql) :
--
-- 1. `account_id` -> `account text` : aucune colonne "account_id" n'existe
--    nulle part dans ce schéma. La convention réelle du projet est
--    `account` (text), voir seba_state/qa_photos/memoire_embeddings/
--    materiaux_couts/paiements — pas un renommage cosmétique, une colonne
--    "account_id" n'existerait tout simplement pas à joindre.
--
-- 2. Aucune table normalisée "interventions" peuplée n'existe (Pilier 4,
--    documenté depuis le Palier 1 : seba_state.state.interventions[] est
--    la SEULE source active — un blob JSON côté client synchronisé par
--    patch, pas des lignes Postgres qu'une vue SQL pourrait interroger).
--    La table `interventions` normalisée du tout début du schéma
--    (section 2) existe mais reste dormante — jamais écrite par le
--    pipeline de synchro réel (sync-push.ts patch uniquement
--    seba_state.state). intervention_id/client_id/date_intervention/
--    resume_technique/statut/montant_total ne peuvent donc PAS venir
--    d'une table "interventions" : ils sont recomposés à partir des
--    VRAIES tables déjà peuplées par les Paliers 2/4/5 :
--      - resume_technique <- memoire_embeddings.content (texte déjà
--        formaté par vision-qa.ts), avec repli sur qa_photos.raison si
--        l'embedding n'a pas (encore) été calculé (calcul best-effort/
--        découplé de la réponse HTTP, voir vision-qa.ts).
--      - statut <- qa_photos.verdict ('conforme' / 'non_conforme' /
--        'incertain') : le seul concept de "statut" réellement suivi
--        côté serveur pour une intervention à ce jour.
--      - montant_total <- vue_marge_interventions.revenu (Palier 5,
--        somme des paiements 'recu' pour cette intervention).
--      - client_id <- paiements.client_id : la SEULE table de ce
--        périmètre à porter un lien vers un client. Peut être NULL —
--        c'est un état réel (aucun paiement rattaché à un client précis
--        pour cette intervention pour l'instant), pas une erreur.
--    Ancrée sur qa_photos (LEFT JOIN les 3 autres sources) : c'est
--    littéralement "l'historique technique" du Palier 2 (Photo-First QA),
--    la seule table alimentée par une action réelle du technicien sur le
--    terrain pour chaque intervention suivie côté serveur.
--
-- 3. security_invoker = true (Postgres 15+), même raisonnement que
--    vue_marge_interventions (supabase-schema.sql section 24) : sans
--    cette option, la vue s'exécuterait avec les privilèges de son
--    créateur, contournant la RLS de qa_photos/memoire_embeddings/
--    paiements pour un appel direct par un client authentifié. Composée
--    ici EXCLUSIVEMENT de tables/vues qui ont déjà leur propre RLS
--    stricte (qa_photos_select, memoire_embeddings_select,
--    paiements_select, et vue_marge_interventions elle-même déjà
--    security_invoker) — aucune policy supplémentaire n'est nécessaire
--    sur client_memoire elle-même : une vue n'a pas de RLS propre, elle
--    hérite de celle des tables sous-jacentes via security_invoker.
--
-- Champs sensibles strictement exclus (règle de sécurité explicite de la
-- mission) :
--   - paiements.reference (référence bancaire/transaction)
--   - materiaux_couts.cout_unitaire / type_materiau (coûts internes —
--     seul l'agrégat marge/revenu de vue_marge_interventions est exposé,
--     même masquage par omission de colonne que _shared/finance-
--     analytics.ts)
--   - memoire_embeddings.embedding / metadata (vecteur brut + notes
--     internes générées par vision-qa.ts, jamais destinées à un
--     affichage direct)
--   - qa_photos.photo_path (chemin de stockage privé, pas une donnée
--     d'historique en soi)
--   - user_id (identifiant Supabase Auth brut, aucune valeur ajoutée
--     pour le frontend qui interroge déjà en tant que cet utilisateur)
--
-- IMPORTANT — synchronisation avec le fichier maître : ce fichier
-- correspond à la nouvelle section 26 également ajoutée à la fin de
-- `supabase-schema.sql` (racine du projet), qui reste LE fichier réel
-- déployé ("copie TOUT le contenu, colle, Run" — voir MANUEL-SEBA-
-- ADMIN.md section 2). Un fichier migrations/ isolé ne serait jamais
-- exécuté par ce flux documenté s'il n'était QUE là — les deux copies
-- sont donc maintenues identiques, celle-ci sert de changelog de
-- migration autonome et de référence pour ce chantier précis.
-- ═══════════════════════════════════════════════════════════════

create or replace view client_memoire
with (security_invoker = true) as
select
  qp.account,
  qp.intervention_id,
  pay.client_id,
  qp.created_at::date as date_intervention,
  coalesce(me.content, qp.raison) as resume_technique,
  qp.verdict as statut,
  coalesce(vmi.revenu, 0) as montant_total
from qa_photos qp
left join (
  select account, intervention_id, max(content) as content
  from memoire_embeddings
  where intervention_id is not null
  group by account, intervention_id
) me on me.account = qp.account and me.intervention_id = qp.intervention_id
left join (
  select account, intervention_id, max(client_id) as client_id
  from paiements
  where intervention_id is not null and client_id is not null
  group by account, intervention_id
) pay on pay.account = qp.account and pay.intervention_id = qp.intervention_id
left join vue_marge_interventions vmi on vmi.account = qp.account and vmi.intervention_id = qp.intervention_id;

-- Indexation (tâche 2 de la mission) : AUCUN nouvel index nécessaire.
-- idx_qa_photos_intervention (account, intervention_id) — section 13,
-- idx_memoire_embeddings_intervention (account, intervention_id) —
-- section 19, et idx_paiements_intervention (account, intervention_id) —
-- section 23 existent déjà et couvrent exactement les colonnes de
-- jointure/filtrage utilisées par cette vue. En créer un nouveau
-- dupliquerait un index déjà présent pour le même usage.
