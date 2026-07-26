-- ═══════════════════════════════════════════════════════════════
-- SEBA — MIGRATION PRODUIT : Quote-to-cash (feature/quote-to-cash).
--
-- Statut : MIGRATION PRODUIT — rejouable, ordonnée, appliquée après le
-- baseline figé (voir scripts/local-db/migrations-order.txt, section
-- [PRODUCT-MIGRATIONS]). Ne modifie ni supabase-schema.sql ni aucune
-- migration historique, y compris Intervention 360
-- (migrations/2026-07-25-intervention-360.sql), qui reste intacte.
--
-- OBJET : ferme le parcours commercial devis -> acceptation client ->
-- facture -> paiement. Le patron a un accès direct (policies RLS
-- existantes sur seba_state, aucune RPC nécessaire côté patron -- toute
-- la logique de création/correction/duplication/annulation/conversion
-- vit dans docs/seba-data.js, SebaDB.devis.*/SebaDB.factures.*). Les RPC
-- ci-dessous couvrent UNIQUEMENT la lecture et l'acceptation/refus côté
-- client, qui n'a aucun accès direct à seba_state (RLS bloque tout, comme
-- le reste de son portail).
--
-- EXCEPTION -- 2 RPC RESSERRÉES (pas un ajout, une correction), en toute
-- fin de fichier : get_my_client_devis() et get_my_client_factures()
-- (définies dans migrations/2026-07-23-client-portal-data-rls.sql)
-- renvoyaient jusqu'ici la ligne BRUTE (d.value/f.value) -- sans risque à
-- l'époque (aucune donnée interne sur ces objets). Depuis ce fichier, un
-- devis porte des notes patron + un historique d'événements, une facture
-- porte des notes patron + des paiements avec une note interne par
-- paiement : laisser ces 2 RPC inchangées en ferait une fuite. Resserrées
-- ici en allowlist explicite, exactement comme get_my_client_interventions()
-- l'a été dans la migration Intervention 360 pour la même raison.
--
-- SÉCURITÉ (identique au modèle déjà audité -- Intervention 360,
-- portail client) pour CHAQUE RPC ci-dessous :
--   1. auth.uid() null -> refus contrôlé immédiat (ou tableau vide pour
--      les lectures, jamais une erreur qui fuiterait une info) ;
--   2. rattachement retrouvé via client_accounts, jamais un account/
--      clientId fourni par le navigateur ;
--   3. écriture (accept/refuse) : verrou FOR UPDATE sur la ligne
--      seba_state ciblée ;
--   4. le devis doit exister ET appartenir à CE client (clientId) --
--      jamais account seul, jamais le devis d'un autre client ;
--   5. valeurs contrôlées côté serveur (statut cible jamais arbitraire) ;
--   6. chaque RPC d'écriture ne modifie QUE les champs qu'elle est censée
--      modifier (jamais client/lignes/prix/montants) ;
--   7. search_path resserré à pg_catalog, pg_temp ;
--   8. REVOKE PUBLIC + REVOKE anon explicites, GRANT EXECUTE au seul
--      rôle authenticated.
--
-- ALLOWLIST -- ce que le client NE voit JAMAIS (aucune de ces clés
-- n'apparaît dans les jsonb_build_object ci-dessous) :
--   - devis.notes (notes internes patron) ;
--   - devis.statusHistory (historique interne, acteurs/métadonnées) ;
--   - devis.duplicatedFrom / sourceInterventionId (liens internes) ;
--   - facture.notes (notes internes patron) ;
--   - facture.statusHistory ;
--   - facture.payments[].note (note interne par paiement -- seuls
--     amount/mode/date/reference sont exposés par paiement).
-- Aucune marge/coût interne n'existe de toute façon sur ces objets (les
-- montants vivent uniquement dans lines[]/totalHT/TVA/TTC, jamais un coût
-- de revient) -- rien à filtrer de plus sur ce point.
--
-- IDEMPOTENCE : accept/refuse vérifient l'état AVANT toute écriture --
-- rejouer un appel identique sur un devis déjà accepté/refusé PAR CE
-- CLIENT ne crée aucun doublon d'événement, retourne l'état actuel tel
-- quel (même garantie que start_my_intervention/complete_my_intervention,
-- migration Intervention 360).
--
-- Ne déploie AUCUNE migration automatiquement sur Supabase partagé.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. get_my_client_devis_detail — lecture complète d'UN devis (allowlist)
-- ───────────────────────────────────────────────────────────────
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
    'invoiceId', v_item ->> 'invoiceId'
  );

  return jsonb_build_object('ok', true, 'devis', v_safe);
end;
$$;
revoke all on function get_my_client_devis_detail(text) from public;
revoke all on function get_my_client_devis_detail(text) from anon;
grant execute on function get_my_client_devis_detail(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. get_my_client_facture_detail — lecture complète d'UNE facture (allowlist)
-- ───────────────────────────────────────────────────────────────
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
        'amount', p.value -> 'amount', 'mode', p.value ->> 'mode',
        'date', p.value ->> 'date', 'reference', p.value ->> 'reference'
      )), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_item -> 'payments', '[]'::jsonb)) as p(value)
    ),
    'devisId', v_item ->> 'devisId', 'interventionId', v_item ->> 'interventionId'
  );

  return jsonb_build_object('ok', true, 'facture', v_safe);
end;
$$;
revoke all on function get_my_client_facture_detail(text) from public;
revoke all on function get_my_client_facture_detail(text) from anon;
grant execute on function get_my_client_facture_detail(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. client_accept_devis — persistant, horodaté, lié au client authentifié,
-- idempotent, impossible sur le devis d'un autre client.
-- ───────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────
-- 4. client_refuse_devis — commentaire obligatoire, idempotent, jamais
-- possible sur un devis déjà accepté.
-- ───────────────────────────────────────────────────────────────
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
    return jsonb_build_object('ok', true, 'devis', v_current); -- idempotent
  end if;
  if v_current ->> 'status' = 'signe' then
    return jsonb_build_object('ok', false, 'error', 'Devis déjà accepté, refus impossible.');
  end if;
  if v_current ->> 'status' != 'attente' then
    return jsonb_build_object('ok', false, 'error', 'Ce devis ne peut plus être refusé.');
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

-- ───────────────────────────────────────────────────────────────
-- 5. get_my_client_devis() -- RESSERRÉE (pas un ajout, une correction).
-- Définie dans migrations/2026-07-23-client-portal-data-rls.sql, renvoyait
-- `d.value` -- la ligne devis BRUTE. Depuis ce fichier, la même ligne porte
-- notes/statusHistory (internes) : la laisser inchangée en ferait une
-- fuite. Allowlist identique à get_my_client_devis_detail ci-dessus,
-- appliquée à chaque élément de la liste. Exclut aussi les brouillons
-- (jamais envoyés, le client n'a jamais à les voir).
-- ───────────────────────────────────────────────────────────────
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
        'invoiceId', d.value ->> 'invoiceId'
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

-- ───────────────────────────────────────────────────────────────
-- 6. get_my_client_factures() -- RESSERRÉE, même raison que ci-dessus.
-- Allowlist identique à get_my_client_facture_detail, appliquée à chaque
-- élément de la liste (payments[].note strippé par élément également).
-- ───────────────────────────────────────────────────────────────
create or replace function get_my_client_factures()
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
        'id', f.value ->> 'id', 'num', f.value ->> 'num', 'date', f.value ->> 'date', 'dueDate', f.value ->> 'dueDate',
        'status', f.value ->> 'status', 'lines', coalesce(f.value -> 'lines', '[]'::jsonb),
        'tvaRate', f.value -> 'tvaRate', 'remise', f.value -> 'remise',
        'totalHT', f.value -> 'totalHT', 'totalTVA', f.value -> 'totalTVA', 'totalTTC', f.value -> 'totalTTC',
        'montantPaye', (
          select coalesce(sum((p.value ->> 'amount')::numeric), 0)
          from jsonb_array_elements(coalesce(f.value -> 'payments', '[]'::jsonb)) as p(value)
        ),
        'solde', greatest(0, coalesce((f.value ->> 'totalTTC')::numeric, (f.value ->> 'amount')::numeric, 0) - (
          select coalesce(sum((p.value ->> 'amount')::numeric), 0)
          from jsonb_array_elements(coalesce(f.value -> 'payments', '[]'::jsonb)) as p(value)
        )),
        'payments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'amount', p.value -> 'amount', 'mode', p.value ->> 'mode',
            'date', p.value ->> 'date', 'reference', p.value ->> 'reference'
          )), '[]'::jsonb)
          from jsonb_array_elements(coalesce(f.value -> 'payments', '[]'::jsonb)) as p(value)
        ),
        'devisId', f.value ->> 'devisId', 'interventionId', f.value ->> 'interventionId'
      )
    ),
    '[]'::jsonb
  ) into v_items
  from public.seba_state s, jsonb_array_elements(s.state -> 'factures') as f(value)
  where s.account = v_account
    and f.value ->> 'clientId' = v_client_id;

  return v_items;
end;
$$;
revoke all on function get_my_client_factures() from public;
revoke all on function get_my_client_factures() from anon;
grant execute on function get_my_client_factures() to authenticated;

commit;
