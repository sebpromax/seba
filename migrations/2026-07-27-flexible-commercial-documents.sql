-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Espace commercial flexible + documents
-- professionnels (feature/flexible-commercial-documents).
--
-- SEULE extension serveur de ce chantier (tout le reste -- numérotation,
-- snapshot, révisions, modèles de document -- vit dans seba_state,
-- couvert par les policies RLS existantes, aucune RPC nécessaire côté
-- patron). Resserre client_accept_devis/client_refuse_devis (CREATE OR
-- REPLACE, même signature, AUCUNE autre RPC/policy touchée) : ces 2
-- fonctions ignoraient jusqu'ici le nouveau champ devis.supersededByQuoteId
-- (révisions, section 16 du chantier) -- sans ce correctif, un client
-- pourrait accepter/refuser une version de devis déjà remplacée par une
-- révision plus récente. Jugé indispensable (section 26 du chantier :
-- "une migration est autorisée uniquement si cette extension serveur est
-- indispensable") -- c'est une garantie business/anti-confusion qui ne
-- peut être appliquée que côté serveur (RLS/RPC), jamais seulement côté
-- client.
--
-- Ne modifie ni supabase-schema.sql ni aucune migration historique, ne
-- touche aucune autre RPC.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function client_accept_devis(p_devis_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select d.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value)
  where d.value ->> 'id' = p_devis_id and d.value ->> 'clientId' = v_client_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Devis introuvable ou non associé à votre compte.');
  end if;

  -- Rejeu idempotent : déjà accepté par CE client -> aucun nouvel
  -- événement, retourne l'état actuel tel quel.
  if v_current ->> 'status' = 'signe' then
    return jsonb_build_object('ok', true, 'devis', v_current);
  end if;
  -- Révisions (feature/flexible-commercial-documents) -- une version
  -- remplacée par une révision plus récente ne peut plus être acceptée,
  -- même si son statut brut est resté 'attente'.
  if (v_current -> 'supersededByQuoteId') is not null and v_current -> 'supersededByQuoteId' != 'null'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'Ce devis a été remplacé par une version plus récente.');
  end if;
  if v_current ->> 'status' != 'attente' then
    return jsonb_build_object('ok', false, 'error', 'Ce devis ne peut plus être accepté.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_accepted', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', null);

  select jsonb_agg(
    case
      when d.value ->> 'id' = p_devis_id then
        (d.value
          || jsonb_build_object('status', 'signe', 'acceptedAt', v_now, 'acceptedBy', v_client_id)
          || jsonb_build_object('statusHistory', coalesce(d.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else d.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value);

  update public.seba_state set state = jsonb_set(state, '{devis}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select d.value into v_updated from jsonb_array_elements(v_new) as d(value) where d.value ->> 'id' = p_devis_id;
  return jsonb_build_object('ok', true, 'devis', v_updated);
end;
$$;
revoke all on function client_accept_devis(text) from public;
revoke all on function client_accept_devis(text) from anon;
grant execute on function client_accept_devis(text) to authenticated;

create or replace function client_refuse_devis(p_devis_id text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_state jsonb;
  v_current jsonb;
  v_new jsonb;
  v_updated jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_event jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Non authentifié.'); end if;
  if p_comment is null or btrim(p_comment) = '' then
    return jsonb_build_object('ok', false, 'error', 'Un commentaire est requis pour refuser un devis.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca where ca.client_user_id = v_uid;
  if v_account is null then return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.'); end if;

  select state into v_state from public.seba_state where account = v_account for update;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'Compte introuvable.'); end if;

  select d.value into v_current
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value)
  where d.value ->> 'id' = p_devis_id and d.value ->> 'clientId' = v_client_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'Devis introuvable ou non associé à votre compte.');
  end if;

  if v_current ->> 'status' = 'refuse' then
    return jsonb_build_object('ok', true, 'devis', v_current);
  end if;
  if v_current ->> 'status' = 'signe' then
    return jsonb_build_object('ok', false, 'error', 'Devis déjà accepté, refus impossible.');
  end if;
  if (v_current -> 'supersededByQuoteId') is not null and v_current -> 'supersededByQuoteId' != 'null'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'Ce devis a été remplacé par une version plus récente.');
  end if;

  v_event := jsonb_build_object('id', gen_random_uuid()::text, 'event', 'client_refused', 'actorRole', 'client', 'actorId', v_client_id, 'createdAt', v_now, 'metadata', jsonb_build_object('comment', btrim(p_comment)));

  select jsonb_agg(
    case
      when d.value ->> 'id' = p_devis_id then
        (d.value
          || jsonb_build_object('status', 'refuse', 'refusedAt', v_now, 'refusedBy', v_client_id, 'refusalComment', btrim(p_comment))
          || jsonb_build_object('statusHistory', coalesce(d.value -> 'statusHistory', '[]'::jsonb) || jsonb_build_array(v_event))
        )
      else d.value
    end
  ) into v_new
  from jsonb_array_elements(coalesce(v_state -> 'devis', '[]'::jsonb)) as d(value);

  update public.seba_state set state = jsonb_set(state, '{devis}', coalesce(v_new, '[]'::jsonb)), updated_at = now()
  where account = v_account;

  select d.value into v_updated from jsonb_array_elements(v_new) as d(value) where d.value ->> 'id' = p_devis_id;
  return jsonb_build_object('ok', true, 'devis', v_updated);
end;
$$;
revoke all on function client_refuse_devis(text, text) from public;
revoke all on function client_refuse_devis(text, text) from anon;
grant execute on function client_refuse_devis(text, text) to authenticated;

-- Allowlist étendue (additive uniquement) : le document facture imprimable
-- côté client (section 23/26) a besoin de l'identité entreprise/client au
-- moment de l'émission -- déjà capturée par documentSnapshot (section 12),
-- simplement jamais exposée au client avant ce chantier. Aucun autre champ
-- ajouté/retiré.
create or replace function get_my_client_facture_detail(p_facture_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_item jsonb;
  v_safe jsonb;
  v_paid numeric;
  v_total numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.');
  end if;

  select f.value into v_item
  from public.seba_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'factures', '[]'::jsonb)) as f(value)
  where s.account = v_account
    and f.value ->> 'id' = p_facture_id
    and f.value ->> 'clientId' = v_client_id
  limit 1;

  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'Facture introuvable ou non associée à votre compte.');
  end if;

  v_total := coalesce((v_item ->> 'totalTTC')::numeric, (v_item ->> 'amount')::numeric, 0);
  select coalesce(sum((p.value ->> 'amount')::numeric), 0) into v_paid
  from jsonb_array_elements(coalesce(v_item -> 'payments', '[]'::jsonb)) as p(value);

  v_safe := jsonb_build_object(
    'id', v_item ->> 'id', 'num', v_item ->> 'num', 'date', v_item ->> 'date', 'dueDate', v_item ->> 'dueDate',
    'status', v_item ->> 'status', 'lines', coalesce(v_item -> 'lines', '[]'::jsonb),
    'tvaRate', v_item -> 'tvaRate', 'remise', v_item -> 'remise',
    'totalHT', v_item -> 'totalHT', 'totalTVA', v_item -> 'totalTVA', 'totalTTC', v_item -> 'totalTTC',
    'montantPaye', v_paid, 'solde', greatest(0, v_total - v_paid),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.value -> 'id', 'amount', p.value -> 'amount', 'mode', p.value ->> 'mode',
        'date', p.value ->> 'date', 'reference', p.value ->> 'reference', 'createdAt', p.value ->> 'createdAt'
      )), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_item -> 'payments', '[]'::jsonb)) as p(value)
    ),
    'devisId', v_item ->> 'devisId', 'interventionId', v_item ->> 'interventionId',
    'documentSnapshot', v_item -> 'documentSnapshot'
  );

  return jsonb_build_object('ok', true, 'facture', v_safe);
end;
$$;
revoke all on function get_my_client_facture_detail(text) from public;
revoke all on function get_my_client_facture_detail(text) from anon;
grant execute on function get_my_client_facture_detail(text) to authenticated;

create or replace function get_my_client_devis_detail(p_devis_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_item jsonb;
  v_safe jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.');
  end if;

  select d.value into v_item
  from public.seba_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'devis', '[]'::jsonb)) as d(value)
  where s.account = v_account
    and d.value ->> 'id' = p_devis_id
    and d.value ->> 'clientId' = v_client_id
    and d.value ->> 'status' is distinct from 'brouillon'
  limit 1;

  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'Devis introuvable ou non associé à votre compte.');
  end if;

  v_safe := jsonb_build_object(
    'id', v_item ->> 'id', 'num', v_item ->> 'num', 'date', v_item ->> 'date', 'status', v_item ->> 'status',
    'lines', coalesce(v_item -> 'lines', '[]'::jsonb),
    'tvaRate', v_item -> 'tvaRate', 'remise', v_item -> 'remise', 'acompte', v_item -> 'acompte',
    'validityDate', v_item ->> 'validityDate', 'conditions', v_item ->> 'conditions',
    'totalHT', v_item -> 'totalHT', 'totalTVA', v_item -> 'totalTVA', 'totalTTC', v_item -> 'totalTTC',
    'sentAt', v_item ->> 'sentAt', 'acceptedAt', v_item ->> 'acceptedAt',
    'refusedAt', v_item ->> 'refusedAt', 'refusalComment', v_item ->> 'refusalComment',
    'invoiceId', v_item ->> 'invoiceId',
    'parentQuoteId', v_item ->> 'parentQuoteId', 'revisionNumber', v_item -> 'revisionNumber', 'supersededByQuoteId', v_item ->> 'supersededByQuoteId',
    'documentSnapshot', v_item -> 'documentSnapshot'
  );

  return jsonb_build_object('ok', true, 'devis', v_safe);
end;
$$;
revoke all on function get_my_client_devis_detail(text) from public;
revoke all on function get_my_client_devis_detail(text) from anon;
grant execute on function get_my_client_devis_detail(text) to authenticated;

create or replace function get_my_client_devis()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_account text;
  v_client_id text;
  v_items jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select ca.account, ca.client_id into v_account, v_client_id
  from public.client_accounts ca
  where ca.client_user_id = v_uid;

  if v_account is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.value ->> 'id', 'num', d.value ->> 'num', 'date', d.value ->> 'date', 'status', d.value ->> 'status',
        'lines', coalesce(d.value -> 'lines', '[]'::jsonb),
        'tvaRate', d.value -> 'tvaRate', 'remise', d.value -> 'remise', 'acompte', d.value -> 'acompte',
        'validityDate', d.value ->> 'validityDate', 'conditions', d.value ->> 'conditions',
        'totalHT', d.value -> 'totalHT', 'totalTVA', d.value -> 'totalTVA', 'totalTTC', d.value -> 'totalTTC',
        'sentAt', d.value ->> 'sentAt', 'acceptedAt', d.value ->> 'acceptedAt',
        'refusedAt', d.value ->> 'refusedAt', 'refusalComment', d.value ->> 'refusalComment',
        'invoiceId', d.value ->> 'invoiceId',
        'parentQuoteId', d.value ->> 'parentQuoteId', 'revisionNumber', d.value -> 'revisionNumber', 'supersededByQuoteId', d.value ->> 'supersededByQuoteId'
      )
    ),
    '[]'::jsonb
  ) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'devis') as d(value)
  where s.account = v_account
    and d.value ->> 'clientId' = v_client_id
    and d.value ->> 'status' is distinct from 'brouillon';

  return v_items;
end;
$$;
revoke all on function get_my_client_devis() from public;
revoke all on function get_my_client_devis() from anon;
grant execute on function get_my_client_devis() to authenticated;

commit;
