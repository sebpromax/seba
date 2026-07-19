-- ═══════════════════════════════════════════════════════════════
-- SEBA — Lien demande -> mission (assignation.html, 2026-07-19)
--
-- Quand le patron transforme une client_request en mission planifiee
-- (assignation.html, drag & drop ou modale), on cree une vraie entree
-- dans state.interventions[] (blob JSONB seba_state, jamais une table
-- normalisee) et on relie la demande d'origine a cette mission via
-- cette colonne.
--
-- text, pas de foreign key : les interventions n'ont pas de table
-- dediee, exactement comme intervenant_id (deja text, reference
-- state.employes[].id) juste au-dessus dans client_requests. Idempotent,
-- sur a rejouer.
-- ═══════════════════════════════════════════════════════════════

alter table client_requests add column if not exists intervention_id text;
