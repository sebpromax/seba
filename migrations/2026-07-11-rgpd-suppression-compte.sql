-- ═══════════════════════════════════════════════════════════════
-- RGPD Art. 17 (droit à l'effacement) — suppression COMPLÈTE de compte.
--
-- Constat (audit zones d'ombre 2026-07-11) : le bouton « Supprimer mon
-- entreprise » (reglages.html → SebaDB.eraseAllData()) ne purge que ce que
-- les policies RLS du client autorisent. Restent en base après suppression :
--   - profiles / companies (aucune policy delete) — secteur + nom d'entreprise
--   - api_usage (pas de FK vers seba_state, pas de policy)
--   - auth.users — le compte lui-même, email inclus
-- Les tables satellites (sync_operations, entity_versions, sync_conflicts,
-- employe_credentials, employe_sessions, qa_photos, alert_logs,
-- memoire_embeddings, ai_context_hash, materiaux_couts, paiements) cascadent
-- déjà correctement depuis seba_state (references ... on delete cascade).
--
-- Principe : une seule RPC SECURITY DEFINER, SANS paramètre — l'appelant ne
-- peut supprimer QUE son propre compte (tout est dérivé de auth.uid()).
-- Aucune clé service_role côté client, aucune Edge Function nécessaire.
--
-- ⚠ À exécuter dans l'éditeur SQL Supabase (action fondateur).
-- ⚠ Vérifier sur l'instance que le rôle propriétaire de la fonction peut bien
--   DELETE dans auth.users (vrai avec le rôle postgres par défaut Supabase ;
--   sinon, remplacer le bloc auth.users par un appel Edge Function
--   auth.admin.deleteUser).
-- ═══════════════════════════════════════════════════════════════

create or replace function erase_account_completely()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'erase_account_completely: appel non authentifié';
  end if;

  -- 1. Quotas d'usage (pas de FK) — purgés via les comptes de l'appelant.
  delete from api_usage
  where account in (select account from seba_state where user_id = _uid);

  -- 2. Tables normalisées keyed user_id (Pilier 2, encore peu écrites mais
  --    on ne parie pas dessus) + profil/entreprise du tunnel d'onboarding.
  delete from companies
  where profile_id in (select id from profiles where user_id = _uid);
  delete from profiles     where user_id = _uid;
  delete from clients       where user_id = _uid;
  delete from interventions  where user_id = _uid;
  delete from devis          where user_id = _uid;
  delete from factures       where user_id = _uid;
  delete from employes       where user_id = _uid;

  -- 3. Le blob maître : sa suppression cascade sur TOUTES les tables
  --    satellites (sync, credentials, sessions, photos, alertes, IA, finance).
  delete from seba_state where user_id = _uid;

  -- 4. Le compte Supabase Auth lui-même (email, identités). Après ça, la
  --    session de l'appelant devient invalide — le client doit signOut().
  delete from auth.users where id = _uid;
end;
$$;

-- La RPC est appelable par tout utilisateur authentifié (elle ne touche que
-- SES données) — jamais par anon.
revoke all on function erase_account_completely() from public;
grant execute on function erase_account_completely() to authenticated;
