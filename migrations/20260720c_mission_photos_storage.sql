-- ═══════════════════════════════════════════════════════════════
-- SEBA — Stockage réel des photos de clôture de mission
-- (espace-terrain.html), 2026-07-20
--
-- Bucket DISTINCT de intervention-photos (Palier 2, QA visuelle) : cette
-- photo-ci n'est jamais analysée par IA, elle sert de preuve visuelle de
-- fin d'intervention, visible par le PATRON, l'EMPLOYÉ assigné ET le
-- CLIENT -- intervention-photos ne l'est jamais (patron uniquement,
-- upload via service_role dans vision-qa.ts). Upload DIRECT depuis le
-- navigateur de l'employé (son propre JWT, jamais service_role) : les
-- policies RLS ci-dessous font tout le travail d'autorisation, pas
-- besoin d'Edge Function pour ce flux.
--
-- Convention de nommage : {id_demande}/{fichier} -- id_demande (1er
-- segment du chemin, storage.foldername(name)[1]) est le uuid réel de
-- client_requests.id, directement joignable dans les policies. Différent
-- du préfixe {account} utilisé sur intervention-photos : là-bas
-- l'upload se fait via service_role donc seul le patron a jamais besoin
-- d'y accéder ; ici on a besoin de granularité par personne (employé
-- assigné + client propriétaire), un uuid de demande le permet
-- directement, un simple compte non.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mission-photos', 'mission-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "mission_photos_insert_employe" on storage.objects;
create policy "mission_photos_insert_employe" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mission-photos'
    -- Vérifié EN DIRECT contre client_requests.intervenant_id (l'assignation
    -- ACTUELLE) -- même principe que seba_messages/close_my_intervention :
    -- une réassignation coupe le droit d'upload immédiatement.
    and exists (
      select 1 from client_requests cr
      join employe_accounts ea on ea.account = cr.account and ea.employe_id = cr.intervenant_id
      where cr.id::text = (storage.foldername(name))[1]
        and ea.employe_user_id = auth.uid()
    )
  );

drop policy if exists "mission_photos_select" on storage.objects;
create policy "mission_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mission-photos'
    and (
      -- Patron (propriétaire du compte).
      exists (
        select 1 from client_requests cr
        join seba_state s on s.account = cr.account
        where cr.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
      )
      -- Employé actuellement assigné.
      or exists (
        select 1 from client_requests cr
        join employe_accounts ea on ea.account = cr.account and ea.employe_id = cr.intervenant_id
        where cr.id::text = (storage.foldername(name))[1] and ea.employe_user_id = auth.uid()
      )
      -- Client propriétaire de la demande.
      or exists (
        select 1 from client_requests cr
        where cr.id::text = (storage.foldername(name))[1] and cr.client_user_id = auth.uid()
      )
    )
  );

-- Trace du chemin de la photo directement sur la demande (en plus du
-- champ rapportPhotoPath posé sur l'intervention dans le blob JSONB) :
-- client-fiche.html/client-espace.html peuvent l'afficher sans avoir à
-- lire le blob seba_state.
alter table client_requests add column if not exists photo_path text;

-- close_my_intervention (chantier précédent) : _photo_name (simple nom
-- de fichier, jamais uploadé nulle part) devient _photo_path (chemin
-- réel dans le bucket mission-photos, ou null si pas de photo/échec
-- d'upload) -- écrit maintenant à la fois sur l'intervention
-- (rapportPhotoPath, dans le blob) et sur la client_request liée
-- (photo_path, colonne dédiée ci-dessus).
create or replace function close_my_intervention(_intervention_id text, _rapport text, _photo_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_state jsonb;
  v_new_interventions jsonb;
  v_found boolean := false;
  v_request_id text;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select state into v_state from seba_state where account = v_link.account for update;
  if v_state is null then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable.');
  end if;

  select
    jsonb_agg(
      case
        when i ->> 'id' = _intervention_id and i ->> 'employeId' = v_link.employe_id
        then i || jsonb_build_object('done', true, 'rapport', _rapport, 'rapportPhotoPath', _photo_path)
        else i
      end
    ),
    bool_or(i ->> 'id' = _intervention_id and i ->> 'employeId' = v_link.employe_id)
  into v_new_interventions, v_found
  from jsonb_array_elements(coalesce(v_state -> 'interventions', '[]'::jsonb)) i;

  if not v_found then
    return jsonb_build_object('ok', false, 'error', 'Mission introuvable ou non assignée à vous.');
  end if;

  update seba_state
  set state = jsonb_set(state, '{interventions}', coalesce(v_new_interventions, '[]'::jsonb)),
      updated_at = now()
  where account = v_link.account;

  select i ->> 'requestId' into v_request_id
  from jsonb_array_elements(v_new_interventions) i
  where i ->> 'id' = _intervention_id;

  if v_request_id is not null then
    update client_requests
    set statut = 'terminee', photo_path = _photo_path, updated_at = now()
    where id = v_request_id::uuid and account = v_link.account;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function close_my_intervention(text, text, text) from public;
grant execute on function close_my_intervention(text, text, text) to authenticated;
