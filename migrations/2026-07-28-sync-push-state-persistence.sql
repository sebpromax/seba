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
--
-- SÉMANTIQUE JSONB DES PATCHS (revue pré-merge PR #98) : `jsonb || jsonb`
-- ne fait qu'une fusion de PREMIER NIVEAU -- un patch imbriqué PARTIEL
-- (ex. {adresse:{ville:'Nice'}} sur un objet adresse existant avec
-- rue/codePostal) écraserait silencieusement les clés absentes du patch.
-- Vérifié EXHAUSTIVEMENT (grep de tous les appels SebaDB.update(...) sur
-- docs/*.html + docs/seba-data.js, ~70 sites) : Seba ne le fait JAMAIS.
-- Chaque champ imbriqué (execution, fieldReport, champsMetier,
-- operationalMemory, servicePlans, statusHistory, unavailabilityRequests,
-- history...) est systématiquement reconstruit en objet/tableau COMPLET
-- côté client AVANT l'appel (`Object.assign({}, existant, changement)` ou
-- équivalent), puis envoyé tel quel comme valeur complète de la clé.
-- `adresse` elle-même est une chaîne (docs/clients.html:410), jamais un
-- objet imbriqué. La fusion superficielle `||` reproduit donc exactement
-- Object.assign(item, patch) -- aucun moteur de deep merge n'est
-- nécessaire ni ajouté ici. Si un futur champ envoie un jour un patch
-- imbriqué PARTIEL, ce sera un changement de contrat frontend à traiter
-- alors, pas une lacune silencieuse de cette migration (couvert par un
-- test explicite ci-dessous, scripts/local-db/test-sync-push-state-
-- persistence.js CAS "objet imbriqué complet").
--
-- MODÈLE DE CONCURRENCE (revue pré-merge PR #98) : le frontend actuel
-- (docs/seba-data.js pushOp/syncWorker) n'envoie AUCUNE version attendue
-- avec un patch -- il est donc FAUX d'affirmer que cette migration rejette
-- une écriture basée sur une version périmée. Le protocole réellement
-- livré ici est une SÉRIALISATION TRANSACTIONNELLE : le verrou FOR UPDATE
-- sur la ligne seba_state du compte sérialise toutes les écritures de ce
-- compte, chacune relit l'état le plus récent avant d'appliquer son
-- patch. Pour deux écritures concurrentes sur des champs DIFFÉRENTS du
-- même objet, aucune perte (les deux surviennent, vérifié par un test
-- réellement parallèle). Pour deux écritures concurrentes sur EXACTEMENT
-- le même champ, dernier écrivain validé gagnant (celle qui obtient le
-- verrou en second écrase la première sur ce champ précis) -- comportement
-- correct et suffisant pour le volume d'écriture réel d'un compte Seba
-- (usage terrain, pas de collaboration temps réel sur le même champ). Un
-- vrai protocole de version côté client (rejet explicite d'un patch fondé
-- sur une version périmée) n'existe pas et n'est pas ajouté ici -- dette
-- suivie séparément (SYNC-OPTIMISTIC-001) si un besoin réel de
-- collaboration simultanée apparaît.
-- ═══════════════════════════════════════════════════════════════

-- Élargit l'allowlist de sync_operations.entity : grep exhaustif de tous
-- les appels SebaDB.create/update/remove(...) (docs/*.html +
-- docs/seba-data.js) montre que 5 collections réellement utilisées par le
-- produit (contrats, custom_services, automationRules, automationRuns,
-- automationAlerts) étaient absentes de l'allowlist d'origine (Palier 1,
-- 2026-07-09) -- déjà un défaut PRÉEXISTANT à cette PR (sync-push
-- n'ayant jamais été déployée, jamais découvert avant), mais qui aurait
-- cassé silencieusement la création d'un contrat/service personnalisé/
-- règle d'automatisation dès le premier déploiement réel. Corrigé ici
-- puisque cette migration a précisément pour objet de terminer le Palier 1.
-- `messages`/`clientRequests` restent volontairement absentes : elles
-- vivent dans des tables dédiées (seba_messages/client_requests) avec
-- leurs propres RPC, jamais via ce chemin générique (vérifié, aucun appel
-- SebaDB.create/update/remove('messages'|'clientRequests', ...) trouvé).
alter table public.sync_operations drop constraint if exists sync_operations_entity_check;
alter table public.sync_operations add constraint sync_operations_entity_check
  check (entity in ('clients', 'devis', 'factures', 'interventions', 'employes', 'journal', 'contrats', 'custom_services', 'automationRules', 'automationRuns', 'automationAlerts'));

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

  if p_entity not in ('clients', 'devis', 'factures', 'interventions', 'employes', 'journal', 'contrats', 'custom_services', 'automationRules', 'automationRuns', 'automationAlerts') then
    raise exception 'apply_entity_patch: entity invalide ''%''', p_entity
      using errcode = '22023';
  end if;

  if p_entity_id is null or p_entity_id = '' then
    raise exception 'apply_entity_patch: entity_id manquant'
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
    if not (p_patch_jsonb ? 'id') then
      -- SebaDB.create() envoie toujours l'objet complet avec son id (voir
      -- docs/seba-data.js) -- un patch de création sans identifiant
      -- canonique ne peut provenir que d'un contrat rompu, jamais toléré
      -- silencieusement (l'objet stocké serait alors introuvable par
      -- entity_id ->> 'id' au prochain update/delete).
      raise exception 'apply_entity_patch: create sans identifiant canonique (patch.id absent)'
        using errcode = '22023';
    end if;
    if (p_patch_jsonb ->> 'id') is distinct from p_entity_id then
      -- Le frontend envoie toujours patch.id = entity_id (objet complet à
      -- la création, voir SebaDB.create()) -- une divergence signale soit
      -- un bug client, soit une tentative de faire pointer entity_id
      -- (utilisé pour le verrouillage/la recherche) vers un id different
      -- de celui réellement stocké dans l'objet : refusé explicitement
      -- plutôt que silencieusement toléré.
      raise exception 'apply_entity_patch: patch.id (%) different de entity_id (%)', p_patch_jsonb ->> 'id', p_entity_id
        using errcode = '22023';
    end if;
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
-- CORRECTION (revue post-merge, voir migrations/2026-07-28-sync-push-
-- service-role-execute.sql) : l'affirmation initiale ici était inexacte.
-- service_role contourne les politiques RLS (attribut BYPASSRLS du rôle)
-- mais nécessite toujours le privilège EXECUTE sur la fonction comme
-- n'importe quel rôle -- ce n'est pas le même mécanisme. Ce privilège est
-- accordé explicitement par la migration additive
-- 2026-07-28-sync-push-service-role-execute.sql (il existait déjà en
-- pratique via les privilèges par défaut de la plateforme Supabase sur
-- le schéma public, mais dépendait silencieusement d'une convention
-- implicite plutôt que d'un GRANT documenté ici).
