-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Fondation acquisition (feature/public-intake-
-- conversion). VISITEUR PUBLIC -> DEMANDE DE PRESTATION -> QUALIFICATION
-- PATRON -> CLIENT / DEVIS / INTERVENTION.
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique, ne touche AUCUNE policy/RPC déjà existante.
--
-- ARCHITECTURE (inspectée avant d'écrire cette migration, voir aussi
-- docs/seba-data.js SebaDB.publicIntake/entreprise) :
--   - Aucun "slug public" n'existe dans Seba aujourd'hui (vérifié :
--     onboarding.html/reglages.html n'en génèrent aucun). L'identifiant
--     public réutilisé est account = auth.uid() du patron, déjà la
--     frontière RLS réelle de tout le reste de l'app, déjà non-devinable.
--     Créer un vrai "slug" lisible impliquerait un second panneau
--     d'administration (génération/unicité/édition), hors périmètre.
--   - public_service_requests est une table DÉDIÉE, jamais seba_state :
--     un visiteur sans compte Seba ne peut pas écrire dans le blob JSONB
--     patron (RLS state_insert exige auth.uid() = user_id). Toute
--     écriture publique passe exclusivement par l'Edge Function
--     public-intake (service_role, voir supabase-functions/public-intake.ts).
--   - convert_public_service_request NE RECRÉE AUCUN calcul de devis ni
--     aucune logique de planning/conflit : elle résout/crée uniquement le
--     CLIENT (mapping de champs simple, sans logique métier). Le devis
--     (SebaDB.devis.createDraft, moteur quote-to-cash réel) et
--     l'intervention non assignée sont créés côté navigateur patron, en
--     réutilisant tel quel les moteurs JS déjà écrits/testés, puis reliés
--     à la demande via link_public_service_request_conversion (idempotente,
--     n'écrase jamais un id déjà posé).
--
-- SÉCURITÉ (identique au modèle déjà audité cette session) pour chaque
-- RPC ci-dessous : auth.uid() null -> refus immédiat ; propriété du compte
-- vérifiée via seba_state.user_id, jamais un account fourni sans contrôle ;
-- FOR UPDATE sur les lignes ciblées ; search_path resserré à pg_catalog,
-- pg_temp ; REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul
-- rôle authenticated.
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Table public_service_requests
-- ───────────────────────────────────────────────────────────────
create table if not exists public_service_requests (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null,                     -- copie de seba_state.user_id au moment de l'insertion (Edge Function) -- policy RLS directe, pas de sous-requête sur le chemin de lecture le plus chaud (même convention que sync_operations, supabase-schema.sql section 7)
  public_reference text not null unique,     -- non prédictible, généré par l'Edge Function (jamais un compteur séquentiel)
  tracking_token_hash text not null,         -- hash SHA-256 uniquement -- le token en clair n'est JAMAIS stocké, renvoyé une seule fois à la création
  status text not null default 'new' check (status in ('new','contacted','qualified','converted','rejected','archived')),
  contact_name text not null,
  email text,
  phone text,
  address text,
  service_id text,
  service_label text,
  preferred_date date,
  preferred_time_start time,
  preferred_time_end time,
  description text,
  source text,
  owner_note text,
  converted_client_id text,
  converted_quote_id text,
  converted_intervention_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_at timestamptz
);
alter table public_service_requests enable row level security;

-- Aucune policy insert/delete pour anon NI authenticated : la seule voie
-- d'écriture initiale est l'Edge Function public-intake (service_role,
-- contourne RLS par nature). Le patron ne supprime jamais une demande
-- (statut 'archived' à la place, cohérent avec le reste de l'app qui
-- préfère un statut à une suppression physique -- ex. devis 'annule').
drop policy if exists "psr_select_owner" on public_service_requests;
create policy "psr_select_owner" on public_service_requests for select using (auth.uid() = user_id);
drop policy if exists "psr_update_owner" on public_service_requests;
create policy "psr_update_owner" on public_service_requests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists psr_account_created_idx on public_service_requests (account, created_at desc);
create index if not exists psr_account_status_idx on public_service_requests (account, status);
create index if not exists psr_reference_idx on public_service_requests (public_reference);

-- ───────────────────────────────────────────────────────────────
-- 2. convert_public_service_request — résout/crée le CLIENT, verrouille la
-- demande. Idempotente : rejouer le même appel (retry réseau) ne crée
-- JAMAIS un 2e client -- si déjà convertie, renvoie le client existant tel
-- quel, aucune nouvelle écriture.
-- ───────────────────────────────────────────────────────────────
create or replace function convert_public_service_request(p_account text, p_request_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_found boolean;
  v_status text;
  v_contact_name text;
  v_request_email text;
  v_request_phone text;
  v_address text;
  v_service_label text;
  v_converted_client_id text;
  v_converted_quote_id text;
  v_converted_intervention_id text;
  v_state jsonb;
  v_email text;
  v_phone_digits text;
  v_existing_client_id text;
  v_new_client jsonb;
  v_new_client_id text;
  v_clients jsonb;
  v_client_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;
  if p_action not in ('client', 'client_quote', 'client_intervention') then
    return jsonb_build_object('ok', false, 'error', 'Action invalide.');
  end if;

  select user_id into v_owner_id from public.seba_state where account = p_account;
  if v_owner_id is null or v_owner_id != v_uid then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable ou non autorisé.');
  end if;

  select true, status, contact_name, email, phone, address, service_label, converted_client_id, converted_quote_id, converted_intervention_id
  into v_found, v_status, v_contact_name, v_request_email, v_request_phone, v_address, v_service_label, v_converted_client_id, v_converted_quote_id, v_converted_intervention_id
  from public.public_service_requests where id = p_request_id and account = p_account for update;
  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'error', 'Demande introuvable.');
  end if;

  -- Idempotence : déjà convertie -> renvoie l'état actuel sans rien réécrire
  -- (un retry de clic/réseau ne duplique jamais le client).
  if v_status = 'converted' then
    return jsonb_build_object(
      'ok', true, 'alreadyConverted', true,
      'clientId', v_converted_client_id,
      'convertedQuoteId', v_converted_quote_id,
      'convertedInterventionId', v_converted_intervention_id
    );
  end if;
  if v_status in ('rejected', 'archived') then
    return jsonb_build_object('ok', false, 'error', 'Cette demande est ' || v_status || ', impossible de la convertir.');
  end if;

  select state into v_state from public.seba_state where account = p_account for update;
  if v_state is null then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable.');
  end if;

  v_email := nullif(lower(btrim(v_request_email)), '');
  v_phone_digits := nullif(regexp_replace(coalesce(v_request_phone, ''), '\D', '', 'g'), '');

  -- Résolution client existant : email normalisé en priorité (champ
  -- structuré et fiable) ; à défaut, comparaison des chiffres du téléphone
  -- demandé contre le champ libre `contact` -- aucun champ téléphone dédié
  -- n'existe sur l'objet client aujourd'hui (vérifié : clients.html
  -- n'écrit que prenom/nom/contact/email/adresse/notes/service/ca/statut).
  select c.value ->> 'id' into v_existing_client_id
  from jsonb_array_elements(coalesce(v_state -> 'clients', '[]'::jsonb)) as c(value)
  where (v_email is not null and lower(btrim(c.value ->> 'email')) = v_email)
     or (v_phone_digits is not null and v_phone_digits = regexp_replace(coalesce(c.value ->> 'contact', ''), '\D', '', 'g'))
  limit 1;

  if v_existing_client_id is not null then
    v_new_client_id := v_existing_client_id;
  else
    v_new_client_id := 'id_' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12);
    v_client_name := btrim(coalesce(v_contact_name, ''));
    v_new_client := jsonb_build_object(
      'id', v_new_client_id,
      'prenom', split_part(v_client_name, ' ', 1),
      'nom', case when position(' ' in v_client_name) > 0 then substr(v_client_name, position(' ' in v_client_name) + 1) else '' end,
      'contact', coalesce(v_email, v_request_phone, '—'),
      'email', v_email,
      'adresse', coalesce(v_address, ''),
      'notes', '',
      'service', coalesce(v_service_label, 'Aucun service encore'),
      'ca', 0,
      'statut', 'attente',
      'createdAt', to_char(now(), 'YYYY-MM-DD'),
      'sourcePublicRequestId', p_request_id::text
    );
    v_clients := coalesce(v_state -> 'clients', '[]'::jsonb) || jsonb_build_array(v_new_client);
    update public.seba_state set state = jsonb_set(state, '{clients}', v_clients), updated_at = now() where account = p_account;
  end if;

  update public.public_service_requests
  set status = 'converted', converted_client_id = v_new_client_id, converted_at = now(), updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'alreadyConverted', false, 'clientId', v_new_client_id, 'convertedQuoteId', null, 'convertedInterventionId', null);
end;
$$;
revoke all on function convert_public_service_request(text, uuid, text) from public;
revoke all on function convert_public_service_request(text, uuid, text) from anon;
grant execute on function convert_public_service_request(text, uuid, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. link_public_service_request_conversion — pose converted_quote_id/
-- converted_intervention_id APRÈS que le navigateur patron ait créé le
-- devis/l'intervention via les moteurs JS existants (voir SebaDB.
-- publicIntake.linkConversion). Idempotente et set-once : n'écrase jamais
-- un id déjà posé -- un retry ne peut donc jamais lier un 2e devis/2e
-- intervention à la même demande, même après une double soumission.
-- ───────────────────────────────────────────────────────────────
create or replace function link_public_service_request_conversion(p_account text, p_request_id uuid, p_quote_id text, p_intervention_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_found boolean;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select user_id into v_owner_id from public.seba_state where account = p_account;
  if v_owner_id is null or v_owner_id != v_uid then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable ou non autorisé.');
  end if;

  select true, status into v_found, v_status from public.public_service_requests where id = p_request_id and account = p_account for update;
  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'error', 'Demande introuvable.');
  end if;
  if v_status != 'converted' then
    return jsonb_build_object('ok', false, 'error', 'Cette demande n''est pas encore convertie.');
  end if;

  update public.public_service_requests
  set
    converted_quote_id = coalesce(converted_quote_id, p_quote_id),
    converted_intervention_id = coalesce(converted_intervention_id, p_intervention_id),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function link_public_service_request_conversion(text, uuid, text, text) from public;
revoke all on function link_public_service_request_conversion(text, uuid, text, text) from anon;
grant execute on function link_public_service_request_conversion(text, uuid, text, text) to authenticated;

commit;
