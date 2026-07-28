-- ═══════════════════════════════════════════════════════════════
-- SEBA — Termine proprement le Palier 1 (sync-push) : `apply_entity_patch()`
-- écrit désormais aussi dans `seba_state.state`, pas seulement dans
-- `entity_versions`.
--
-- BUG RÉEL TROUVÉ (QA360-P0-A, avant tout déploiement de sync-push en
-- production) : depuis PR #32 (`2454af4`, 2026-07-09, Palier 1),
-- `apply_entity_patch()` (baseline, supabase-schema.sql section 11)
-- n'écrit QUE dans `entity_versions` (verrouillage optimiste par entité).
-- Or `SupabaseAdapter.pull()` (docs/seba-data.js:156, appelé par
-- `SebaDB.ready()` à chaque rechargement, et quasiment toutes les RPC de
-- lecture -- get_my_client_interventions, get_my_employee_interventions,
-- etc.) lit exclusivement `seba_state.state`. Écriture et lecture
-- n'ont jamais été raccordées : déployer sync-push tel quel aurait produit
-- un succès HTTP (`applied`, journalisé, idempotent) sans que la donnée
-- n'apparaisse jamais après un reload -- pire, `ready()` remplace l'état
-- local par le blob cloud périmé au reload (seba-data.js:2240-2244), donc
-- l'objet créé aurait disparu de l'écran malgré le succès affiché.
--
-- DÉCISION (fondateur, 2026-07-28, voir _architecture/MASTER_BACKLOG.md
-- QA360-P0-A) : `seba_state.state` reste l'UNIQUE source de vérité métier
-- réellement lue par Seba. `entity_versions` reste le mécanisme de
-- version/idempotence/concurrence (jamais relu par le frontend). On ne
-- reconstruit pas les lectures depuis `entity_versions`, on ne crée pas de
-- nouvelle architecture -- `apply_entity_patch()` écrit désormais les deux,
-- atomiquement, dans la même transaction.
--
-- CHANGEMENT DE SIGNATURE (indispensable, pas par préférence) : ajout du
-- paramètre `p_op` (create/update/delete). La signature d'origine
-- (p_account, p_entity, p_entity_id, p_patch_jsonb) ne permettait pas de
-- distinguer les 3 opérations -- indispensable pour savoir s'il faut
-- ajouter, fusionner ou retirer un élément du tableau JSONB
-- `seba_state.state.<entité>`. L'ancienne signature à 4 paramètres est
-- supprimée (aucun autre appelant dans le dépôt -- vérifié,
-- `apply_entity_patch` n'est référencée que par sync-push).
--
-- CONCURRENCE : verrouille la ligne `seba_state` du compte (FOR UPDATE)
-- AVANT toute lecture/écriture -- une seule ligne par compte, donc toutes
-- les écritures d'un même compte se sérialisent naturellement sur ce
-- verrou (contrairement à l'ancien verrouillage par entité seule). Choix
-- assumé : légèrement moins parallèle entre deux entités d'un même
-- compte, mais élimine toute fenêtre où `seba_state.state` et
-- `entity_versions` pourraient diverger sous écriture concurrente --
-- acceptable au volume d'écriture réel d'un compte Seba (terrain, pas
-- haute fréquence).
--
-- ATOMICITÉ : une seule fonction PL/pgSQL, aucun bloc `exception when
-- others` qui avalerait une erreur -- toute exception non interceptée
-- annule la transaction complète (les deux écritures, `seba_state` ET
-- `entity_versions`, ou aucune des deux).
--
-- SÉMANTIQUE PRÉSERVÉE (déduite de docs/seba-data.js) :
--   CREATE  -> state[coll].unshift(item) côté client : on préfixe le
--              tableau JSONB (même ordre, plus récent en premier).
--              Idempotent : si l'id existe déjà (retry), aucun doublon.
--   UPDATE  -> Object.assign(item, patch) côté client : fusion
--              superficielle (`||`), les clés du patch écrasent, les
--              autres restent inchangées. Objet introuvable = erreur
--              explicite (jamais un faux succès).
--   DELETE  -> côté client, list()/get() ne renvoient plus l'élément
--              après remove() (retrait réel de state[coll], jamais un
--              simple marqueur) -- contrairement à l'ancien commentaire
--              de apply_entity_patch ("pas de suppression physique"),
--              qui décrivait un chemin jamais réellement exercé en
--              production (sync-push n'a jamais été déployée). Retrait
--              réel de l'élément dans seba_state.state ; le marqueur
--              `_deleted`/`deletedAt` reste conservé dans
--              entity_versions.last_snapshot pour l'audit. Idempotent :
--              élément déjà absent = no-op, jamais une erreur.
-- ═══════════════════════════════════════════════════════════════

drop function if exists public.apply_entity_patch(text, text, text, jsonb);

create or replace function public.apply_entity_patch(
  p_account text,
  p_entity text,
  p_entity_id text,
  p_patch_jsonb jsonb,
  p_op text
)
returns table (out_version int, out_last_snapshot jsonb)
language plpgsql
-- SECURITY INVOKER (défaut, inchangé) : appelée par sync-push/index.ts via
-- une connexion service_role -> bypass RLS nativement (BYPASSRLS, attribut
-- du rôle, indépendant de cette fonction). Si jamais appelée directement
-- depuis le navigateur (RPC publique) avec un JWT authenticated -> RLS de
-- entity_versions/seba_state (aucune policy insert/update pour
-- authenticated sur entity_versions ; seba_state exige auth.uid() =
-- user_id, jamais garanti égal à p_account fourni ici) bloque l'écriture
-- normalement, sans dépendre de cette fonction pour se protéger. Ne jamais
-- passer en security definer ici : ça court-circuiterait cette protection.
set search_path = pg_catalog, pg_temp
as $$
declare
  v_state jsonb;
  v_array jsonb;
  v_version int;
  v_snapshot jsonb;
  v_idx int;
  v_existing jsonb;
  v_new_element jsonb;
begin
  if p_op not in ('create', 'update', 'delete') then
    raise exception 'apply_entity_patch: op invalide ''%''', p_op
      using errcode = '22023';
  end if;

  if p_entity not in ('clients', 'devis', 'factures', 'interventions', 'employes', 'journal') then
    raise exception 'apply_entity_patch: entity invalide ''%''', p_entity
      using errcode = '22023';
  end if;

  -- Verrouille la ligne seba_state du compte : toutes les écritures de ce
  -- compte se sérialisent ici, seba_state ET entity_versions restent
  -- cohérents entre eux par construction.
  select state into v_state
  from public.seba_state
  where account = p_account
  for update;

  if not found then
    raise exception 'apply_entity_patch: compte introuvable ''%''', p_account
      using errcode = '22023';
  end if;

  select version, last_snapshot into v_version, v_snapshot
  from public.entity_versions
  where account = p_account and entity = p_entity and entity_id = p_entity_id;

  v_array := coalesce(v_state -> p_entity, '[]'::jsonb);

  select (ord - 1)::int, elem into v_idx, v_existing
  from jsonb_array_elements(v_array) with ordinality as t(elem, ord)
  where elem ->> 'id' = p_entity_id
  limit 1;

  if p_op = 'create' then
    if v_idx is not null then
      -- Idempotent : déjà créé par une tentative précédente (retry réseau
      -- après un ack perdu) -- jamais rejoué, jamais de doublon.
      v_new_element := v_existing;
    else
      v_new_element := p_patch_jsonb;
      v_array := jsonb_build_array(v_new_element) || v_array; -- unshift, même ordre que le client
    end if;

  elsif p_op = 'update' then
    if v_idx is null then
      raise exception 'apply_entity_patch: objet introuvable pour update (% / %)', p_entity, p_entity_id
        using errcode = '22023';
    end if;
    v_new_element := v_existing || p_patch_jsonb; -- fusion superficielle, equivalent Object.assign
    v_array := jsonb_set(v_array, array[v_idx::text], v_new_element);

  else -- delete
    if v_idx is not null then
      v_array := v_array - v_idx; -- retrait reel de l'element (pas un marqueur) -- idempotent si dejà absent
    end if;
    v_new_element := coalesce(v_existing, '{}'::jsonb) || p_patch_jsonb; -- snapshot d'audit conserve dans entity_versions meme si retire de seba_state.state
  end if;

  v_version := coalesce(v_version, 0) + 1;

  update public.seba_state
  set state = jsonb_set(v_state, array[p_entity], v_array), updated_at = now()
  where account = p_account;

  insert into public.entity_versions (account, entity, entity_id, version, last_snapshot)
  values (p_account, p_entity, p_entity_id, v_version, v_new_element)
  on conflict (account, entity, entity_id)
  do update set version = excluded.version, last_snapshot = excluded.last_snapshot, updated_at = now();

  return query select v_version, v_new_element;
end;
$$;

revoke all on function public.apply_entity_patch(text, text, text, jsonb, text) from public;
revoke all on function public.apply_entity_patch(text, text, text, jsonb, text) from anon;
revoke all on function public.apply_entity_patch(text, text, text, jsonb, text) from authenticated;
-- Aucun grant explicite : appelée exclusivement via service_role (Edge
-- Function sync-push), qui bypasse GRANT/RLS par nature du rôle.
