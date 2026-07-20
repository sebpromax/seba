-- ═══════════════════════════════════════════════════════════════
-- SEBA — Chat de mission tripartite (Patron/Employé/Client), 2026-07-20
--
-- seba_messages n'avait jusqu'ici que client_id OU employe_id : deux fils
-- PLATS et PARALLELES (tout l'historique d'un client mélangé, tout
-- l'historique d'un employé mélangé), aucun canal partagé entre les
-- trois rôles, aucun rattachement à une demande/mission précise.
--
-- request_id (nullable) ancre desormais un message sur UNE demande
-- (client_requests) : le cycle de vie complet (avant assignation, apres
-- assignation, jusqu'a la mission) reste couvert car client_requests
-- existe des la soumission, contrairement a une intervention qui
-- n'existe qu'apres assignation. client_requests.intervention_id fait
-- deja le pont si besoin de retrouver la mission concrete.
--
-- Les fils generiques (client_id/employe_id seuls, sans request_id)
-- restent PLEINEMENT fonctionnels et INCHANGES -- decision fondateur
-- explicite (2026-07-20) : necessaires pour les questions hors-mission
-- (administratif/RH). Le nouveau canal s'ajoute, ne remplace rien.
-- ═══════════════════════════════════════════════════════════════

alter table seba_messages add column if not exists request_id uuid references client_requests (id) on delete cascade;
create index if not exists idx_seba_messages_request on seba_messages (request_id, created_at);

-- Règle d'accès employé au chat de mission : verifiee EN DIRECT contre
-- client_requests.intervenant_id (l'assignation ACTUELLE), jamais une
-- valeur figee sur le message au moment de l'envoi -- si le patron
-- réassigne la mission a quelqu'un d'autre, l'ancien intervenant perd
-- immediatement l'acces au fil, sans purge manuelle necessaire.
drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
  or exists (
    select 1 from client_requests cr
    where cr.id = seba_messages.request_id and cr.client_user_id = auth.uid()
  )
  or exists (
    select 1 from client_requests cr
    join employe_accounts ea on ea.account = cr.account and ea.employe_id = cr.intervenant_id
    where cr.id = seba_messages.request_id and ea.employe_user_id = auth.uid()
  )
);
drop policy if exists "seba_messages_insert" on seba_messages;
create policy "seba_messages_insert" on seba_messages for insert with check (
  auth.uid() = user_id
  and (
    exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
    or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
    or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
    or exists (
      select 1 from client_requests cr
      where cr.id = seba_messages.request_id and cr.client_user_id = auth.uid()
    )
    or exists (
      select 1 from client_requests cr
      join employe_accounts ea on ea.account = cr.account and ea.employe_id = cr.intervenant_id
      where cr.id = seba_messages.request_id and ea.employe_user_id = auth.uid()
    )
  )
);
drop policy if exists "seba_messages_update" on seba_messages;
create policy "seba_messages_update" on seba_messages for update using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
  or exists (
    select 1 from client_requests cr
    where cr.id = seba_messages.request_id and cr.client_user_id = auth.uid()
  )
  or exists (
    select 1 from client_requests cr
    join employe_accounts ea on ea.account = cr.account and ea.employe_id = cr.intervenant_id
    where cr.id = seba_messages.request_id and ea.employe_user_id = auth.uid()
  )
);
