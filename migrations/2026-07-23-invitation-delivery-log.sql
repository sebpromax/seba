-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : statut d'envoi persistant des invitations
-- client/employé (fix/invitation-delivery).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). N'altère aucune table/RPC existante -- AJOUT pur
-- (une nouvelle table + policy + index).
--
-- POURQUOI une table dédiée plutôt qu'une colonne de statut sur
-- employe_accounts/client_accounts : ces deux tables ne contiennent une
-- ligne QUE lorsque le lien est effectivement établi (l'auth.users existe
-- et la fiche est liée) -- avant ce moment (email en échec, en attente),
-- il n'existe encore AUCUNE ligne à mettre à jour. Cette migration exige
-- aussi de conserver "date de tentative" (une invitation peut être
-- retentée plusieurs fois, "Réessayer l'envoi") : un historique append-only
-- par tentative est le seul modèle qui capture ça sans écraser
-- l'information précédente à chaque nouvel essai.
--
-- Ecriture : exclusivement service_role (Edge Functions employe-provision.ts
-- /client-provision.ts) -- jamais insérée/modifiée directement par le
-- navigateur. Lecture : le patron propriétaire du compte concerné
-- uniquement (RLS via seba_state.user_id = auth.uid(), même garde-fou que
-- les Edge Functions elles-mêmes), pour afficher le statut réel dans
-- employe-fiche.html/client-fiche.html.
--
-- SÉCURITÉ :
--   1. RLS activée, aucune policy INSERT/UPDATE pour authenticated/anon
--      (seul service_role, qui contourne RLS par défaut, peut écrire) ;
--   2. SELECT limité aux lignes du compte dont le user_id (seba_state)
--      correspond à auth.uid() -- jamais account seul, jamais tous les
--      comptes ;
--   3. error_message ne doit JAMAIS contenir de secret (clé API, JWT) --
--      responsabilité des Edge Functions appelantes de ne stocker qu'un
--      message d'erreur normalisé (voir supabase-functions/_shared/
--      invitation-delivery.ts, normalizeResendError()).
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists invitation_log (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  invitation_type text not null check (invitation_type in ('employe', 'client')),
  target_id text not null,           -- employe_id ou client_id (id texte du blob state, pas une PK Postgres)
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  resend_id text,                    -- identifiant Resend si disponible (jamais un secret -- c'est un id opaque)
  error_message text,                -- erreur technique normalisee, jamais de cle/JWT
  attempted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table invitation_log enable row level security;

drop policy if exists "invitation_log_select_owner" on invitation_log;
create policy "invitation_log_select_owner" on invitation_log for select using (
  exists (
    select 1 from seba_state s
    where s.account = invitation_log.account and s.user_id = auth.uid()
  )
);

create index if not exists idx_invitation_log_target on invitation_log (account, invitation_type, target_id, attempted_at desc);

-- GRANT au niveau table (distinct de la policy RLS au niveau ligne) --
-- sans lui, PostgREST/authenticated OU anon recoit "permission denied"
-- avant meme que la policy RLS ne s'applique (confirmé empiriquement,
-- scripts/local-db/test-invitation-log-rls.sh). SELECT uniquement : aucun
-- INSERT/UPDATE/DELETE pour authenticated/anon (ecriture reservee a
-- service_role, qui contourne RLS/GRANT par défaut). anon reçoit aussi le
-- GRANT (comme employe_accounts/client_accounts) : la policy RLS
-- ci-dessus ne matche jamais pour ce rôle (aucun seba_state.user_id =
-- auth.uid() possible sans session), donc 0 ligne visible dans tous les
-- cas -- mais la requête doit pouvoir s'exécuter pour le prouver.
grant select on invitation_log to authenticated, anon;

-- Garde-fou "absence de doublon de rattachement" au niveau BASE DE DONNEES,
-- pas seulement applicatif (le existingLink lookup dans
-- employe-provision.ts/client-provision.ts empêche déjà un second appel
-- de créer un doublon, mais rien au niveau schéma n'empêchait jusqu'ici
-- deux lignes employe_accounts/client_accounts distinctes de pointer vers
-- le même (account, employe_id)/(account, client_id) -- la PK de ces
-- tables est employe_user_id/client_user_id, pas ce couple). Ajout pur sur
-- des tables déjà existantes du baseline (jamais une modification du
-- baseline figé lui-même, voir scripts/local-db/migrations-order.txt) --
-- idempotent via pg_constraint, ADD CONSTRAINT IF NOT EXISTS n'existant
-- pas pour les contraintes UNIQUE en PostgreSQL.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employe_accounts_unique_target') then
    alter table employe_accounts add constraint employe_accounts_unique_target unique (account, employe_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_accounts_unique_target') then
    alter table client_accounts add constraint client_accounts_unique_target unique (account, client_id);
  end if;
end $$;

commit;
