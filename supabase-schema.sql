-- ═══════════════════════════════════════════════════════════════
-- SEBA — Schéma Supabase complet avec Row Level Security (RLS)
--
-- Usage : Supabase → SQL Editor → coller tout ce fichier → Run.
-- Chaque utilisateur (auth.uid()) ne peut LIRE et ÉCRIRE que SES
-- propres lignes : le Patron A ne verra jamais les données du
-- Patron B, même si le code source du site est public.
-- ═══════════════════════════════════════════════════════════════

-- ── 0. État applicatif (utilisé par l'adaptateur actuel de seba-data.js) ──
create table if not exists seba_state (
  account text primary key,
  user_id uuid default auth.uid(),
  state jsonb not null,
  updated_at timestamptz default now()
);
alter table seba_state enable row level security;
create policy "state_select" on seba_state for select using (auth.uid() = user_id);
create policy "state_insert" on seba_state for insert with check (auth.uid() = user_id);
create policy "state_update" on seba_state for update using (auth.uid() = user_id);
create policy "state_delete" on seba_state for delete using (auth.uid() = user_id);

-- ── 0b. Compteur d'usage par fonction (ai-relay.ts, send-email.ts, send-push.ts) ──
-- "kind" sépare les quotas ('ai' / 'email' / 'push') pour qu'un usage
-- intensif d'un service n'épuise pas le quota des autres. Accessible
-- uniquement via la clé service_role (les Edge Functions l'ont
-- automatiquement) : RLS activé sans policy = accès bloqué à tout le
-- monde sauf service_role, qui contourne RLS par nature.
create table if not exists api_usage (
  account text not null,
  kind text not null,
  day date not null,
  count int not null default 0,
  primary key (account, kind, day)
);
alter table api_usage enable row level security;

-- ── 1. Clients ──
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  prenom text not null,
  nom text not null,
  email text,
  telephone text,
  adresse text,
  notes text,
  statut text default 'attente',           -- actif | attente | relance
  created_at timestamptz default now()
);
alter table clients enable row level security;
create policy "clients_select" on clients for select using (auth.uid() = user_id);
create policy "clients_insert" on clients for insert with check (auth.uid() = user_id);
create policy "clients_update" on clients for update using (auth.uid() = user_id);
create policy "clients_delete" on clients for delete using (auth.uid() = user_id);
create index if not exists clients_user_idx on clients (user_id);

-- ── 2. Interventions ──
create table if not exists interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid references clients (id) on delete set null,
  titre text not null,                      -- service / prestation
  date date not null,
  heure time,
  statut text default 'planifie',           -- planifie | en_cours | termine | annule
  prix numeric(10,2),
  created_at timestamptz default now()
);
alter table interventions enable row level security;
create policy "interv_select" on interventions for select using (auth.uid() = user_id);
create policy "interv_insert" on interventions for insert with check (auth.uid() = user_id);
create policy "interv_update" on interventions for update using (auth.uid() = user_id);
create policy "interv_delete" on interventions for delete using (auth.uid() = user_id);
create index if not exists interv_user_date_idx on interventions (user_id, date);

-- ── 3. Devis ──
create table if not exists devis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid references clients (id) on delete set null,
  numero text not null,                     -- #0125
  service text,
  lignes jsonb default '[]',                -- [{desc, qty, u}]
  montant numeric(10,2) not null default 0,
  statut text default 'attente',            -- attente | signe | expire
  date date default current_date,
  created_at timestamptz default now()
);
alter table devis enable row level security;
create policy "devis_select" on devis for select using (auth.uid() = user_id);
create policy "devis_insert" on devis for insert with check (auth.uid() = user_id);
create policy "devis_update" on devis for update using (auth.uid() = user_id);
create policy "devis_delete" on devis for delete using (auth.uid() = user_id);
create index if not exists devis_user_idx on devis (user_id);

-- ── 4. Factures ──
create table if not exists factures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid references clients (id) on delete set null,
  devis_id uuid references devis (id) on delete set null,
  numero text not null,                     -- #F-0099
  service text,
  montant numeric(10,2) not null default 0,
  statut text default 'attente',            -- attente | payee | retard
  date date default current_date,
  payee_le date,
  created_at timestamptz default now()
);
alter table factures enable row level security;
create policy "factures_select" on factures for select using (auth.uid() = user_id);
create policy "factures_insert" on factures for insert with check (auth.uid() = user_id);
create policy "factures_update" on factures for update using (auth.uid() = user_id);
create policy "factures_delete" on factures for delete using (auth.uid() = user_id);
create index if not exists factures_user_idx on factures (user_id);

-- ── 5. Employés ──
create table if not exists employes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  prenom text not null,
  nom text not null,
  role text,
  actif boolean default false,
  acces text default 'planning seulement',
  created_at timestamptz default now()
);
alter table employes enable row level security;
create policy "employes_select" on employes for select using (auth.uid() = user_id);
create policy "employes_insert" on employes for insert with check (auth.uid() = user_id);
create policy "employes_update" on employes for update using (auth.uid() = user_id);
create policy "employes_delete" on employes for delete using (auth.uid() = user_id);

-- ── 6. Profils & Entreprises (tunnel "Flash & Drop", onboarding.html) ──
-- Corrige les 3 defauts du script propose par l'agent Groq
-- (COMPARATIF-PARCOURS.md, TASK 3.1) : variable _profile_id non
-- declaree dans la fonction (Postgres aurait refuse de la creer),
-- policy INSERT ecrite avec `using` au lieu de `with check`, et
-- aucune policy RLS definie du tout sur ces 2 tables.
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sector text not null check (sector in ('Nettoyage', 'Conciergerie', 'Artisanat')),
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "profiles_select" on profiles for select using (auth.uid() = user_id);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = user_id);
create index if not exists profiles_user_idx on profiles (user_id);
-- Pas de policy update/delete : aucune UI n'ecrit encore sur ces champs
-- apres la creation initiale. RLS refuse par defaut toute operation
-- sans policy correspondante (echec ferme, pas une faille) -- a ajouter
-- explicitement le jour ou une page permet de modifier le secteur.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name varchar not null,
  created_at timestamptz default now()
);
alter table companies enable row level security;
-- `companies` n'a pas de colonne user_id propre (juste profile_id) --
-- la policy doit donc verifier la propriete indirectement via le
-- profil parent, pas un `auth.uid() = user_id` litteral qui n'aurait
-- rien a comparer sur cette table.
create policy "companies_select" on companies for select using (
  exists (select 1 from profiles where profiles.id = companies.profile_id and profiles.user_id = auth.uid())
);
create policy "companies_insert" on companies for insert with check (
  exists (select 1 from profiles where profiles.id = companies.profile_id and profiles.user_id = auth.uid())
);
create index if not exists companies_profile_idx on companies (profile_id);

-- Insertion en une seule operation (profil + entreprise) depuis l'ecran 2
-- du tunnel Flash & Drop. SECURITY INVOKER (par defaut, pas de
-- `security definer`) : la fonction s'execute avec les droits de
-- l'appelant, donc la policy `profiles_insert` (auth.uid() = user_id)
-- s'applique normalement -- un appel avec un _user_id qui n'est pas le
-- votre est rejete par RLS, pas seulement par la logique applicative.
create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid as $$
declare
  _profile_id uuid;
begin
  insert into profiles (user_id, sector) values (_user_id, _sector)
    returning id into _profile_id;
  insert into companies (profile_id, name) values (_profile_id, _company_name);
  return _profile_id;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- NOTE ARCHITECTURE
-- Le site utilise aujourd'hui la table seba_state (blob JSON) via
-- l'adaptateur de docs/seba-data.js — c'est la voie déjà branchée.
-- Les tables normalisées 1-5 ci-dessus sont prêtes pour l'étape
-- suivante (migration de l'adaptateur vers un CRUD table par table)
-- sans changer l'API SebaDB consommée par les pages.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- PALIER 1 (VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md) — Synchronisation
-- incrémentale par patch + identité terrain légère (PIN).
--
-- Les identifiants d'entités métier (clients, devis, factures,
-- interventions, employés) NE SONT PAS des UUID : ils sont générés
-- côté client par uid() (docs/seba-data.js:171), format `id_xxxxx`.
-- Toute colonne qui référence une de ces entités est donc `text`,
-- SANS contrainte `references` — une intégrité forcée par une FK
-- Postgres échouerait puisque ces lignes n'existent nulle part côté
-- serveur aujourd'hui (seba_state contient tout dans un seul JSONB).
-- Seules les clés primaires des tables CRÉÉES ICI (id des lignes de
-- sync_operations/sync_conflicts elles-mêmes) sont des uuid générés
-- serveur — ce ne sont pas des identifiants qui doivent correspondre au
-- format client.
-- ═══════════════════════════════════════════════════════════════

-- ── 7. Journal d'opérations (append-only, source de vérité en écriture) ──
create table if not exists sync_operations (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),   -- ajouté pour une policy RLS directe (pas de sous-requête sur le chemin d'écriture le plus chaud)
  entity text not null check (entity in ('clients','devis','factures','interventions','employes','journal')),
  entity_id text not null,                    -- format id_xxxxx, voir note ci-dessus — jamais de FK
  op text not null check (op in ('create','update','delete')),
  patch jsonb not null,                       -- uniquement les champs modifiés, jamais l'objet entier
  device_id text not null,
  employee_id text,                           -- LEGACY (modele PIN retire 2026-07-19) -- toujours null aujourd'hui, aucune UI employe ne pousse d'ecriture via ce chemin (lecture + messagerie uniquement, voir employe_accounts). A reprendre si un futur besoin d'ecriture cote employe apparait (sync-push.ts devrait alors resoudre via employe_accounts, pas l'ancien employe_sessions).
  client_seq int not null,                    -- séquence locale de l'appareil, jamais une horloge
  created_at timestamptz default now(),
  unique (account, device_id, client_seq)     -- idempotence : rejouer le même paquet après coupure ne duplique rien
);
create index if not exists idx_sync_ops_lookup on sync_operations (account, entity, entity_id);
alter table sync_operations enable row level security;
create policy "sync_operations_select" on sync_operations for select using (auth.uid() = user_id);
create policy "sync_operations_insert" on sync_operations for insert with check (auth.uid() = user_id);
-- Pas de policy update/delete : append-only par design, RLS ferme par défaut sans policy.

-- ── 8. Version courante par entité (verrouillage optimiste, remplace le timestamp comme arbitre) ──
create table if not exists entity_versions (
  account text not null references seba_state (account) on delete cascade,
  entity text not null,
  entity_id text not null,
  version int not null default 1,
  last_snapshot jsonb not null,
  updated_at timestamptz default now(),
  primary key (account, entity, entity_id)
);
alter table entity_versions enable row level security;
create policy "entity_versions_select" on entity_versions for select using (
  exists (select 1 from seba_state s where s.account = entity_versions.account and s.user_id = auth.uid())
);
-- Pas d'insert/update pour authenticated : écrit exclusivement par la Edge Function sync-push.ts
-- (service_role, contourne RLS par nature) — jamais directement par le client.

-- ── 9. Conflit réel (même champ, deux valeurs concurrentes) — jamais toute l'entité ──
create table if not exists sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  entity text not null,
  entity_id text not null,
  field text not null,
  server_value jsonb,
  client_value jsonb,
  resolved boolean default false,
  employee_id text,
  created_at timestamptz default now()
);
alter table sync_conflicts enable row level security;
create policy "sync_conflicts_select" on sync_conflicts for select using (
  exists (select 1 from seba_state s where s.account = sync_conflicts.account and s.user_id = auth.uid())
);
create policy "sync_conflicts_resolve" on sync_conflicts for update using (
  exists (select 1 from seba_state s where s.account = sync_conflicts.account and s.user_id = auth.uid())
) with check (resolved = true);   -- le client ne peut que MARQUER résolu, jamais réécrire l'historique du conflit lui-même

-- ── 10. Compte Supabase Auth de l'employé (2026-07-19, authentification
-- universelle) -- REMPLACE le modele PIN/badge-sur-appareil-patron
-- (employe_credentials/employe_sessions, employe-auth.ts/employe-set-pin.ts,
-- retires) : sur demande explicite, l'employe doit pouvoir se connecter
-- depuis N'IMPORTE QUEL appareil avec identifiant+mot de passe, comme le
-- patron et le client -- pas seulement badger un appareil deja
-- authentifie. Exactement le meme modele que client_accounts : compte
-- cree par invitation (Edge Function employe-provision.ts, service_role,
-- auth.admin.inviteUserByEmail), l'employe choisit son mot de passe via
-- le lien recu (reset-password.html gere deja ce flux, voir section
-- suivante). `employes` (table reelle, section 5) n'est pas ecrite
-- aujourd'hui (Pilier 2, employes vivent dans le blob state.employes[]) :
-- impossible d'y stocker ce lien directement, d'ou une table separee,
-- keyee sur le meme id texte que le blob -- meme raison que
-- client_accounts pour client_id.
create table if not exists employe_accounts (
  employe_user_id uuid primary key references auth.users (id) on delete cascade,
  account text not null references seba_state (account) on delete cascade,
  employe_id text not null,
  email text not null,
  linked_at timestamptz default now()
);
alter table employe_accounts enable row level security;
drop policy if exists "employe_accounts_select_own" on employe_accounts;
create policy "employe_accounts_select_own" on employe_accounts for select using (auth.uid() = employe_user_id);
create index if not exists idx_employe_accounts_account on employe_accounts (account, employe_id);

-- ── 11. Application atomique d'un patch sur une entité (sync-push.ts) ──
create or replace function apply_entity_patch(
  p_account text,
  p_entity text,
  p_entity_id text,
  p_patch_jsonb jsonb
)
returns table (out_version int, out_last_snapshot jsonb)
language plpgsql
-- SECURITY INVOKER (défaut, pas de "security definer") : cette fonction
-- s'exécute avec les privilèges de l'APPELANT. Appelée par sync-push.ts
-- via une connexion service_role -> bypass RLS nativement (attribut
-- BYPASSRLS de service_role, indépendant de la fonction). Si jamais
-- appelée directement depuis le navigateur (RPC public) avec un JWT
-- authenticated -> RLS de entity_versions (aucune policy insert/update
-- pour authenticated) bloque l'écriture normalement, sans dépendre de
-- cette fonction pour se protéger. Ne jamais passer en security definer
-- ici : ça court-circuiterait cette protection.
as $$
declare
  v_version int;
  v_snapshot jsonb;
begin
  loop
    -- Verrouille la ligne si elle existe déjà : bloque toute autre
    -- transaction qui tenterait de lire/modifier la MÊME entité pendant
    -- la mise à jour (évite les lost updates entre deux syncs simultanées).
    select version, last_snapshot into v_version, v_snapshot
    from entity_versions
    where account = p_account and entity = p_entity and entity_id = p_entity_id
    for update;

    if found then
      v_version := v_version + 1;
      v_snapshot := v_snapshot || p_patch_jsonb;  -- merge shallow : le patch gagne sur les clés qu'il touche

      update entity_versions
      set version = v_version, last_snapshot = v_snapshot, updated_at = now()
      where account = p_account and entity = p_entity and entity_id = p_entity_id;

      return query select v_version, v_snapshot;
      return;
    end if;

    -- Pas encore de ligne pour cette entité : tentative de création.
    begin
      insert into entity_versions (account, entity, entity_id, version, last_snapshot)
      values (p_account, p_entity, p_entity_id, 1, p_patch_jsonb);

      return query select 1, p_patch_jsonb;
      return;
    exception when unique_violation then
      -- Un autre appel concurrent a gagné la course de création : on
      -- reboucle, le SELECT ... FOR UPDATE du tour suivant la trouvera
      -- et la verrouillera normalement.
      continue;
    end;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PALIER 2 — Pipeline de QA visuelle (supabase-functions/vision-qa.ts)
-- ═══════════════════════════════════════════════════════════════

-- ── 12. Bucket de stockage des photos d'intervention ──
-- public=false : jamais d'URL publique, tout acces passe par une policy
-- RLS ou par service_role (l'Edge Function). Plafond de taille + types
-- MIME autorises poses au niveau du bucket, en plus de la validation
-- faite dans vision-qa.ts (defense en profondeur).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intervention-photos', 'intervention-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Chemin de stockage : {account}/{intervention_id}/{timestamp}.jpg --
-- PAS {intervention_id}/{timestamp}.jpg seul : intervention_id (format
-- id_xxxxx, aucune structure exploitable) ne permet pas a une policy RLS
-- de determiner le proprietaire. Le prefixe account est le seul moyen
-- fiable de scoper "SELECT pour les proprietaires" -- l'upload se faisant
-- via service_role (l'Edge Function), pas via le JWT du patron, la
-- colonne `owner` automatique de Storage ne se remplit pas et n'est donc
-- pas utilisable comme critere ici.
create policy "intervention_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'intervention-photos'
    and (storage.foldername(name))[1] = (select account from seba_state where user_id = auth.uid())
  );
create policy "intervention_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'intervention-photos'
    and (storage.foldername(name))[1] = (select account from seba_state where user_id = auth.uid())
  );
-- Pas de policy pour service_role : contourne RLS par nature (upload et
-- lecture pour l'analyse se font tous les deux via l'Edge Function).

-- ── 13. Verdicts de QA visuelle ──
create table if not exists qa_photos (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),
  intervention_id text not null,              -- format id_xxxxx (Pilier 4), pas de FK -- voir note ci-dessus
  employee_id text,                           -- nullable : non requis par ce palier (auth JWT patron uniquement, voir vision-qa.ts), reserve pour une attribution par employe ulterieure
  photo_path text,                            -- chemin dans intervention-photos, null si l'upload a echoue
  verdict text not null check (verdict in ('conforme', 'non_conforme', 'incertain')),
  confidence numeric(3,2) not null default 0,
  raison text,
  error boolean not null default false,       -- distingue un "incertain" authentique (IA prudente) d'un echec de pipeline (upload/API HS)
  created_at timestamptz default now()
);
create index if not exists idx_qa_photos_intervention on qa_photos (account, intervention_id);
alter table qa_photos enable row level security;
create policy "qa_photos_select" on qa_photos for select using (auth.uid() = user_id);
-- Pas de policy insert/update/delete pour authenticated : ecrit exclusivement
-- par vision-qa.ts (service_role) -- une photo/verdict ne doit jamais pouvoir
-- etre falsifie depuis le navigateur.

-- ═══════════════════════════════════════════════════════════════
-- PALIER 3 — Pipeline d'alerting & exceptions
--
-- IMPORTANT (verifie en revue, pas teste contre un projet Supabase reel --
-- pg_net/Vault ne sont pas simulables ici) : le trigger qui suit appelle
-- l'Edge Function notify-alert.ts via l'extension pg_net, en lisant le
-- secret service_role depuis Supabase Vault -- JAMAIS en dur dans ce
-- fichier, qui est commite dans un repo public. Prerequis MANUEL, a faire
-- une seule fois dans Supabase (SQL Editor), avant que la notification
-- fonctionne (l'absence de ce prerequis ne fait JAMAIS echouer les
-- alertes elles-memes, seulement la notification -- voir
-- call_notify_alert ci-dessous) :
--   select vault.create_secret('https://TON-PROJET.supabase.co', 'project_url');
--   select vault.create_secret('TA_CLE_SERVICE_ROLE', 'service_role_key');
-- ═══════════════════════════════════════════════════════════════

-- ── 14. Journal d'alertes (exceptions QA a traiter par le patron) ──
create table if not exists alert_logs (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  intervention_id text not null,              -- format id_xxxxx (Pilier 4), pas de FK
  qa_photo_id uuid references qa_photos (id) on delete set null,
  type_alerte text not null,                  -- derive automatiquement de qa_photos.raison, voir derive_type_alerte()
  raison text,
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  created_at timestamptz default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
create index if not exists idx_alert_logs_account_status on alert_logs (account, status);
create index if not exists idx_alert_logs_intervention on alert_logs (account, intervention_id);
alter table alert_logs enable row level security;
create policy "alert_logs_select" on alert_logs for select using (
  exists (select 1 from seba_state s where s.account = alert_logs.account and s.user_id = auth.uid())
);
-- Le patron peut acquitter (status -> 'acknowledged'), rien d'autre : pas
-- de policy insert/delete pour authenticated (cree/resolu exclusivement
-- par le trigger ci-dessous), et le with check limite strictement la
-- transition possible -- impossible de forcer 'resolved' ou de modifier
-- type_alerte/raison depuis le navigateur.
create policy "alert_logs_acknowledge" on alert_logs for update using (
  exists (select 1 from seba_state s where s.account = alert_logs.account and s.user_id = auth.uid())
) with check (status = 'acknowledged');

-- ── 15. Derivation du type d'alerte a partir du texte libre de Gemini ──
-- Heuristique simple (mots-cles), volontairement pas un appel LLM
-- supplementaire pour classer un texte deja produit par un LLM -- coherent
-- avec le principe "tier0 deterministe avant tout appel IA"
-- (VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md, section Mistral).
create or replace function derive_type_alerte(p_raison text) returns text as $$
begin
  if p_raison is null or btrim(p_raison) = '' then return 'autre'; end if;
  if p_raison ~* 'danger|risque|s[ée]curit[ée]|[ée]lectri|d[ée]nud[ée]|incendie' then return 'securite';
  elsif p_raison ~* 'propret[ée]|salet[ée]|sale\b|poussi[èe]re|nettoy' then return 'proprete';
  elsif p_raison ~* 'manquant|cass[ée]|d[ée]fectueux|absent|non[ -]conforme' then return 'materiel';
  else return 'autre';
  end if;
end;
$$ language plpgsql immutable;

-- ── 16. Notification best-effort (pg_net + Vault) — ne bloque JAMAIS
-- l'ecriture de alert_logs qui l'a declenchee, meme si pg_net/Vault ne
-- sont pas configures (echec silencieux, capture dans le bloc exception).
create extension if not exists pg_net;

create or replace function call_notify_alert(p_alert_id uuid, p_account text, p_intervention_id text, p_type_alerte text, p_raison text)
returns void as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return; -- Vault non configure (voir prerequis manuel en tete de section) : pas d'echec, juste pas de notification
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/notify-alert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('alert_id', p_alert_id, 'account', p_account, 'intervention_id', p_intervention_id, 'type_alerte', p_type_alerte, 'raison', p_raison)
  );
exception when others then
  -- best-effort : reseau/config en echec ne doit jamais faire echouer
  -- l'insert/update de alert_logs qui a declenche cet appel.
  null;
end;
$$ language plpgsql security definer set search_path = public, vault, net;

-- ── 17. Trigger : qa_photos -> alert_logs ──
-- Se declenche uniquement AFTER INSERT sur qa_photos (chaque analyse cree
-- une NOUVELLE ligne, vision-qa.ts ne fait jamais d'update -- voir
-- supabase-functions/vision-qa.ts) et n'ecrit QUE dans alert_logs, jamais
-- dans qa_photos elle-meme : aucune boucle possible, ce trigger ne peut
-- pas se re-declencher lui-meme.
--
-- Idempotence des DEUX cotes : une alerte n'est creee que s'il n'en
-- existe pas deja une active/acknowledged pour cette intervention (evite
-- des doublons si plusieurs photos non_conforme/incertain s'enchainent
-- avant resolution) ; la resolution marque 'resolved' toute alerte
-- active/acknowledged existante des qu'une photo 'conforme' arrive pour
-- la meme intervention, sans erreur si aucune alerte n'existait deja.
create or replace function trigger_qa_alert() returns trigger as $$
declare
  v_type text;
  v_alert_id uuid;
begin
  if new.verdict in ('non_conforme', 'incertain') then
    if not exists (
      select 1 from alert_logs
      where account = new.account and intervention_id = new.intervention_id and status in ('active', 'acknowledged')
    ) then
      v_type := derive_type_alerte(new.raison);
      insert into alert_logs (account, intervention_id, qa_photo_id, type_alerte, raison, status)
      values (new.account, new.intervention_id, new.id, v_type, new.raison, 'active')
      returning id into v_alert_id;
      perform call_notify_alert(v_alert_id, new.account, new.intervention_id, v_type, new.raison);
    end if;
  elsif new.verdict = 'conforme' then
    update alert_logs
    set status = 'resolved', resolved_at = now()
    where account = new.account and intervention_id = new.intervention_id and status in ('active', 'acknowledged');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger qa_photos_alert_trigger
after insert on qa_photos
for each row execute function trigger_qa_alert();

-- ═══════════════════════════════════════════════════════════════
-- 18. CORRECTIF AUDIT GO-LIVE (AUDIT-GO-LIVE-SEBA.md, section 1, RED) —
-- Postgres accorde EXECUTE a PUBLIC par defaut sur toute fonction
-- nouvellement creee, ce qui inclut anon/authenticated via
-- POST /rest/v1/rpc/<fonction>. Aucune des 4 fonctions ci-dessous n'a de
-- raison legitime d'etre appelee directement par un client : elles ne
-- sont invoquees qu'en interne (le trigger qa_photos_alert_trigger,
-- lui-meme declenche par une ecriture service_role dans vision-qa.ts).
--
-- IMPORTANT : ne JAMAIS regranter a `authenticated` -- call_notify_alert
-- est SECURITY DEFINER et lit le service_role_key depuis Vault ; regranter
-- a authenticated reouvrirait exactement le trou trouve par l'audit
-- (n'importe quel utilisateur connecte pourrait declencher rpc/
-- call_notify_alert avec des donnees arbitraires). apply_entity_patch/
-- trigger_qa_alert/derive_type_alerte sont deja proteges par RLS
-- (SECURITY INVOKER, voir leurs commentaires respectifs) mais restreintes
-- ici aussi en defense en profondeur -- aucun de ces 4 revoke ne change
-- le comportement legitime du systeme : sync-push.ts/vision-qa.ts
-- utilisent le client service_role, qui conserve ses privileges
-- independamment de ce que PUBLIC perd ici.
-- ═══════════════════════════════════════════════════════════════
revoke execute on function call_notify_alert(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function apply_entity_patch(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function trigger_qa_alert() from public, anon, authenticated;
revoke execute on function derive_type_alerte(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- PALIER 4 — Agents intelligents & mémoire vectorielle
-- (supabase-functions/_shared/conscience-seba.ts)
--
-- 2 ecarts assumes par rapport au brief initial, corriges ici :
-- 1. embedding vector(1024), pas vector(1536) : 1536 est la dimension
--    d'OpenAI (text-embedding-3-small/ada-002) -- aucune cle OpenAI
--    n'existe nulle part dans ce projet (verifie). mistral-embed (1024
--    dimensions) est deja le choix documente dans
--    VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md, et MISTRAL_API_KEY est deja
--    provisionnee (ai-relay.ts/daily-digest.ts) -- pas de nouveau
--    fournisseur non configure a introduire pour ce palier.
-- 2. Colonne `account` ajoutee : le brief demandait une RLS "par
--    account_id (jointure necessaire)", mais memoire_embeddings
--    (id, intervention_id, content, embedding, metadata, created_at) n'a
--    aucune colonne vers laquelle joindre -- intervention_id (format
--    id_xxxxx, Pilier 4) vit dans le blob seba_state, ce n'est pas une
--    ligne reelle d'une table interventions permettant une jointure. Sans
--    colonne account directe, aucune policy RLS n'est ecrivable. Ajoutee
--    ici, exactement comme sync_operations/qa_photos/alert_logs.
-- ═══════════════════════════════════════════════════════════════
create extension if not exists vector;

-- ── 19. Mémoire vectorielle (embeddings) ──
create table if not exists memoire_embeddings (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  intervention_id text,                       -- format id_xxxxx (Pilier 4), nullable : un embedding peut ne pas etre lie a une intervention precise (ex. note generale client)
  content text not null,
  embedding vector(1024) not null,            -- mistral-embed, voir note ci-dessus
  metadata jsonb not null default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_memoire_embeddings_account on memoire_embeddings (account);
create index if not exists idx_memoire_embeddings_intervention on memoire_embeddings (account, intervention_id);
create index if not exists idx_memoire_embeddings_vector on memoire_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
alter table memoire_embeddings enable row level security;
create policy "memoire_embeddings_select" on memoire_embeddings for select using (
  exists (select 1 from seba_state s where s.account = memoire_embeddings.account and s.user_id = auth.uid())
);
-- Pas de policy insert/update/delete pour authenticated : ecrit
-- exclusivement par embed-content.ts (service_role) -- un embedding ne
-- doit jamais pouvoir etre injecte/falsifie depuis le navigateur (il
-- alimente directement le contexte envoye au LLM).

-- ── 20. Recherche de similarité, scopée par compte ──
-- p_account est un parametre EXPLICITE, pas une deduction via RLS : cette
-- fonction est appelee par _shared/conscience-seba.ts via le client
-- service_role (bypass RLS par nature) -- sans filtre explicite ici,
-- N'IMPORTE QUEL compte pourrait faire remonter les embeddings de
-- N'IMPORTE QUEL AUTRE compte par similarite, une fuite multi-tenant
-- totale. p_account doit TOUJOURS etre resolu cote serveur a partir du
-- JWT de l'appelant (voir conscience-seba.ts), jamais accepte tel quel
-- depuis le corps d'une requete client.
create or replace function match_interventions(
  p_account text,
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table (id uuid, intervention_id text, content text, metadata jsonb, similarity float)
language sql
stable
as $$
  select
    memoire_embeddings.id,
    memoire_embeddings.intervention_id,
    memoire_embeddings.content,
    memoire_embeddings.metadata,
    1 - (memoire_embeddings.embedding <=> query_embedding) as similarity
  from memoire_embeddings
  where memoire_embeddings.account = p_account
    and 1 - (memoire_embeddings.embedding <=> query_embedding) >= match_threshold
  order by memoire_embeddings.embedding <=> query_embedding
  limit match_count;
$$;
-- Meme defense en profondeur que la section 18 : appelee exclusivement
-- par conscience-seba.ts (service_role), jamais directement par un
-- client. La RLS de memoire_embeddings resterait un second filtre si
-- jamais appelee sous un contexte authenticated, mais p_account est deja
-- l'unique frontiere reelle sous service_role.
revoke execute on function match_interventions(text, vector, float, int) from public, anon, authenticated;

-- ── 21. Cache de contexte IA (deduplique les appels LLM identiques) ──
-- Meme design que documente dans VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md
-- section Mistral : hash SHA256 du contexte CONSTRUIT (jamais du texte
-- brut tronque) comme cle. Si le hash n'a pas change depuis le dernier
-- appel pour ce compte/cet agent, la reponse en cache est reutilisee sans
-- appeler le LLM.
create table if not exists ai_context_hash (
  account text not null references seba_state (account) on delete cascade,
  agent text not null,                        -- 'conscience_predictive' | 'assistant_technique' | ...
  context_hash text not null,                 -- sha256(JSON.stringify(contexte construit))
  response jsonb not null,
  created_at timestamptz default now(),
  primary key (account, agent, context_hash)
);
alter table ai_context_hash enable row level security;
-- RLS actif SANS AUCUNE policy = bloque tout sauf service_role, meme
-- pattern que api_usage : le cache
-- peut contenir des extraits de donnees metier, jamais expose en lecture
-- publique meme au proprietaire du compte (il n'a aucun besoin d'y
-- acceder directement, seul conscience-seba.ts le consulte).

-- ═══════════════════════════════════════════════════════════════
-- PALIER 5 — Analytique financière
--
-- 3 ecarts assumes par rapport au brief initial, meme raisonnement que
-- tous les paliers precedents (Pilier 4 : intervention_id/client_id sont
-- des TEXT generes cote client, format id_xxxxx, jamais des UUID -- aucune
-- ligne reelle a referencer par FK) :
-- 1. account_id -> `account text` directement sur les deux tables : la
--    "jointure sur intervention_id" demandee par le brief n'a rien vers
--    quoi joindre (pas de table interventions peuplee). Meme constat que
--    sync_operations/qa_photos/alert_logs/memoire_embeddings.
-- 2. get_marge_reelle(intervention_id UUID) -> (p_account text,
--    p_intervention_id text) : un intervention_id de ce systeme n'est
--    jamais un UUID valide, la fonction telle que specifiee ne pourrait
--    litteralement jamais etre appelee avec un vrai id. p_account ajoute
--    en plus, meme raisonnement de securite que match_interventions/
--    call_notify_alert (Paliers 3/4) : sans lui, un appel service_role
--    pourrait remonter la marge de n'importe quel compte.
-- 3. vue_marge_interventions calcule le revenu a partir de la table
--    paiements (statut='recu'), PAS d'une table "interventions" qui
--    n'existe pas -- jointure entre les deux tables reelles de ce palier
--    uniquement, pas besoin de toucher au blob seba_state.
-- ═══════════════════════════════════════════════════════════════

-- ── 22. Coûts matériaux par intervention ──
create table if not exists materiaux_couts (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),
  intervention_id text not null,              -- format id_xxxxx (Pilier 4), pas de FK -- voir note ci-dessus
  type_materiau text not null,
  quantite numeric(10,2) not null default 1,
  cout_unitaire numeric(10,2) not null,
  devise text not null default 'EUR',
  created_at timestamptz default now()
);
create index if not exists idx_materiaux_couts_intervention on materiaux_couts (account, intervention_id);
alter table materiaux_couts enable row level security;
-- CRUD complet pour le proprietaire : donnee metier saisie par le patron
-- (comme clients/devis/factures), pas un artefact genere par un systeme
-- (contrairement a qa_photos/alert_logs qui sont ecriture service_role
-- uniquement).
create policy "materiaux_couts_select" on materiaux_couts for select using (auth.uid() = user_id);
create policy "materiaux_couts_insert" on materiaux_couts for insert with check (auth.uid() = user_id);
create policy "materiaux_couts_update" on materiaux_couts for update using (auth.uid() = user_id);
create policy "materiaux_couts_delete" on materiaux_couts for delete using (auth.uid() = user_id);

-- ── 23. Paiements ──
create table if not exists paiements (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),
  client_id text,                             -- format id_xxxxx, nullable (paiement pas toujours rattache a un client precis), pas de FK
  intervention_id text,                       -- idem, nullable (ex. acompte global)
  montant numeric(10,2) not null,
  date_paiement date not null default current_date,
  statut text not null default 'recu' check (statut in ('recu', 'en_attente', 'rembourse')),
  reference text,                             -- reference bancaire/transaction -- JAMAIS exposee a l'agent, voir _shared/finance-analytics.ts (masquage par omission de colonne, pas par filtrage a posteriori)
  created_at timestamptz default now()
);
create index if not exists idx_paiements_intervention on paiements (account, intervention_id);
create index if not exists idx_paiements_client on paiements (account, client_id);
alter table paiements enable row level security;
create policy "paiements_select" on paiements for select using (auth.uid() = user_id);
create policy "paiements_insert" on paiements for insert with check (auth.uid() = user_id);
create policy "paiements_update" on paiements for update using (auth.uid() = user_id);
create policy "paiements_delete" on paiements for delete using (auth.uid() = user_id);

-- ── 24. Vue de marge par intervention ──
-- security_invoker=true (Postgres 15+) : sans cette option, une vue
-- s'execute par defaut avec les privileges de son CREATEUR, pas de
-- l'appelant -- la RLS de materiaux_couts/paiements ne s'appliquerait
-- alors JAMAIS a un client authentifie qui interrogerait cette vue
-- directement. Avec security_invoker=true, la RLS des tables sous-
-- jacentes s'applique correctement a l'appelant reel.
create or replace view vue_marge_interventions
with (security_invoker = true) as
select
  m.account,
  m.intervention_id,
  coalesce(p.revenu, 0) as revenu,
  coalesce(m.cout_materiaux, 0) as cout_materiaux,
  coalesce(p.revenu, 0) - coalesce(m.cout_materiaux, 0) as marge
from (
  select account, intervention_id, sum(quantite * cout_unitaire) as cout_materiaux
  from materiaux_couts
  group by account, intervention_id
) m
full outer join (
  select account, intervention_id, sum(montant) as revenu
  from paiements
  where statut = 'recu' and intervention_id is not null
  group by account, intervention_id
) p on p.account = m.account and p.intervention_id = m.intervention_id;

-- ── 25. Marge d'une intervention spécifique ──
-- p_account explicite : seule frontiere reelle sous un appel service_role
-- (voir note en tete de section) -- security_invoker sur la vue protege
-- deja un appel direct par un client authentifie, mais pas un appel
-- interne via _shared/finance-analytics.ts qui contourne RLS par nature.
-- Volontairement PAS de revoke execute ici (contrairement a
-- match_interventions/call_notify_alert) : cette fonction reste sure a
-- appeler directement par un client authentifie (security_invoker de la
-- vue fait deja le travail), un futur bouton dashboard "voir la marge de
-- cette intervention" pourrait l'appeler telle quelle sans detour serveur.
create or replace function get_marge_reelle(p_account text, p_intervention_id text)
returns table (revenu numeric, cout_materiaux numeric, marge numeric)
language sql
stable
as $$
  select revenu, cout_materiaux, marge
  from vue_marge_interventions
  where account = p_account and intervention_id = p_intervention_id;
$$;

-- ═══════════════════════════════════════════════════════════════
-- DETTE TECHNIQUE PLAN.md — client_memoire (historique frontend)
--
-- Détail complet des 3 écarts assumés par rapport au brief initial
-- (account_id -> account, aucune table interventions peuplée à joindre,
-- security_invoker) : voir migrations/20260709_create_client_memoire.sql,
-- gardée synchronisée avec cette section. Test de non-régression
-- multi-tenant (isolation compte A / compte B) :
-- migrations/20260709_create_client_memoire.test.sql.
-- ═══════════════════════════════════════════════════════════════

-- ── 26. Historique technique par intervention (frontend) ──
create or replace view client_memoire
with (security_invoker = true) as
select
  qp.account,
  qp.intervention_id,
  pay.client_id,
  qp.created_at::date as date_intervention,
  coalesce(me.content, qp.raison) as resume_technique,
  qp.verdict as statut,
  coalesce(vmi.revenu, 0) as montant_total
from qa_photos qp
left join (
  select account, intervention_id, max(content) as content
  from memoire_embeddings
  where intervention_id is not null
  group by account, intervention_id
) me on me.account = qp.account and me.intervention_id = qp.intervention_id
left join (
  select account, intervention_id, max(client_id) as client_id
  from paiements
  where intervention_id is not null and client_id is not null
  group by account, intervention_id
) pay on pay.account = qp.account and pay.intervention_id = qp.intervention_id
left join vue_marge_interventions vmi on vmi.account = qp.account and vmi.intervention_id = qp.intervention_id;

-- Aucun nouvel index necessaire : idx_qa_photos_intervention (section 13),
-- idx_memoire_embeddings_intervention (section 19) et
-- idx_paiements_intervention (section 23) couvrent deja exactement les
-- colonnes de jointure/filtrage (account, intervention_id) de cette vue.

-- ═══════════════════════════════════════════════════════════════
-- DISJONCTEUR GLOBAL DE COUT LLM (Tech Lead & Securite Cloud)
--
-- Detail complet (distinction avec le quota PAR COMPTE api_usage,
-- raisonnement fail-closed, risque de DoS cross-tenant via
-- increment_api_usage sans REVOKE EXECUTE) :
-- voir migrations/20260709_create_api_usage_guardrail.sql, gardee
-- synchronisee avec cette section. Implementation cote Edge Function :
-- _shared/llm-providers.ts (enforceUsageGuardrail), appelee en premiere
-- ligne de callWithFallback() ET decideAvecLLM() -- toute requete vers
-- Mistral/Groq/OpenRouter/Gemini passe par l'un des deux.
-- ═══════════════════════════════════════════════════════════════

-- ── 27. Compteur global de requetes LLM par jour ──
create table if not exists api_usage_daily (
  date date primary key default current_date,
  request_count int not null default 0
);
alter table api_usage_daily enable row level security;
-- Pas de policy : accès bloqué à tout le monde sauf service_role.

-- ── 28. Incremente le compteur du jour, retourne le total actuel ──
create or replace function increment_api_usage()
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  insert into api_usage_daily (date, request_count)
  values (current_date, 1)
  on conflict (date) do update set request_count = api_usage_daily.request_count + 1
  returning request_count into v_count;
  return v_count;
end;
$$;

-- ── 29. Messagerie terrain (client-fiche.html / employe-fiche.html) ──
-- Premiere collection SebaDB adossee a une vraie table dediee plutot
-- qu'au blob seba_state : ecriture independante, chat-like, indexee.
-- RLS classique (auth.uid() = user_id) suffisante : le PIN employe
-- (employe-auth.ts) badge un employe sur l'appareil deja authentifie
-- du patron, il ne cree jamais de session Supabase Auth independante
-- (voir supabase-functions/employe-auth.ts, en-tete).
create table if not exists seba_messages (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  user_id uuid not null default auth.uid(),
  client_id text,
  employe_id text,
  expediteur_role text not null check (expediteur_role in ('patron', 'employe', 'client')),
  destinataire_role text not null check (destinataire_role in ('patron', 'employe', 'client')),
  texte text not null,
  lu boolean not null default false,
  created_at timestamptz default now()
);
alter table seba_messages enable row level security;
drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (auth.uid() = user_id);
drop policy if exists "seba_messages_insert" on seba_messages;
create policy "seba_messages_insert" on seba_messages for insert with check (auth.uid() = user_id);
drop policy if exists "seba_messages_update" on seba_messages;
create policy "seba_messages_update" on seba_messages for update using (auth.uid() = user_id);
create index if not exists idx_seba_messages_client on seba_messages (account, client_id, created_at);
create index if not exists idx_seba_messages_employe on seba_messages (account, employe_id, created_at);
revoke execute on function increment_api_usage() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- AUTHENTIFICATION UNIVERSELLE -- CLIENT + EMPLOYE (2026-07-19)
-- Client (2026-07-19) puis employe (meme jour, revision demandee
-- explicitement) : les DEUX ont desormais une vraie session Supabase
-- Auth INDEPENDANTE, exactement comme le patron -- identifiant+mot de
-- passe, valide depuis N'IMPORTE QUEL appareil. Retire le modele PIN/
-- badge-sur-appareil-patron de l'employe (employe_credentials/
-- employe_sessions, employe-auth.ts/employe-set-pin.ts, section 10
-- precedente de ce fichier) : c'etait plus leger a construire mais
-- limitait l'employe a un appareil deja authentifie comme patron, jugé
-- trop contraignant a l'usage reel.
-- Le patron PROVISIONNE l'acces des deux roles par INVITATION (Edge
-- Functions client-provision.ts / employe-provision.ts,
-- auth.admin.inviteUserByEmail, service_role) -- le compte n'a jamais de
-- mot de passe impose, la personne invitee choisit le sien via le lien
-- recu (reset-password.html gere deja ce flux). Pas d'auto-inscription
-- ouverte pour aucun des deux roles -- donc pas besoin de rechercher un
-- email a travers tous les comptes (client_emails/link_client_account
-- d'une version precedente de ce fichier restent retires, le patron
-- connait deja son propre account/client_id ou employe_id au moment de
-- provisionner).
-- Consequence directe : seba_messages_select/insert/update (section 29
-- ci-dessus) supposaient un seul auth.uid() proprietaire par ligne
-- (celui du patron) -- desormais FAUX des qu'un client OU un employe
-- ecrit un message avec SON PROPRE auth.uid(). Les 3 policies sont donc
-- REECRITES ici
-- (drop+create, idempotent que la section 29 ait deja tourne ou non) :
-- patron OU client lie a ce client_id peuvent lire/ecrire une ligne.
-- ═══════════════════════════════════════════════════════════════

-- ── 30. Rattachement compte Supabase Auth client -> fiche client existante ──
-- Ne contient JAMAIS le mot de passe (gere par auth.users, Supabase).
-- Cree exclusivement par l'Edge Function client-provision.ts (service_role,
-- contourne RLS) -- RLS sans policy insert/update pour le role
-- authenticated, seul un client peut lire SA PROPRE ligne.
-- Authentification universelle (2026-07-19) : client-provision.ts utilise
-- desormais auth.admin.inviteUserByEmail (email d'invitation Supabase, le
-- client choisit lui-meme son mot de passe via le lien recu, jamais un
-- mot de passe de depart impose) -- plus de notion de "mot de passe par
-- defaut", donc plus de colonne pw_is_default ni de RPC
-- mark_client_password_changed (retires).
create table if not exists client_accounts (
  client_user_id uuid primary key references auth.users (id) on delete cascade,
  account text not null references seba_state (account) on delete cascade,
  client_id text not null,          -- id de l'entree dans state.clients[] (pas une PK Postgres -- vit dans le blob JSONB du patron)
  email text not null,
  linked_at timestamptz default now()
);
alter table client_accounts enable row level security;
drop policy if exists "client_accounts_select_own" on client_accounts;
create policy "client_accounts_select_own" on client_accounts for select using (auth.uid() = client_user_id);
create index if not exists idx_client_accounts_account on client_accounts (account, client_id);

-- ── 31. Demandes client ("Nouvelle demande" -- client-espace.html) ──
create table if not exists client_requests (
  id uuid primary key default gen_random_uuid(),
  account text not null references seba_state (account) on delete cascade,
  client_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text not null,
  titre text not null,
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'en_cours', 'terminee', 'annulee')),
  intervenant_id text,              -- id dans state.employes[], nullable (pas encore assigne)
  intervenant_nom text,
  intervention_id text,             -- id dans state.interventions[] une fois transformee en mission (assignation.html, 2026-07-19)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table client_requests enable row level security;
drop policy if exists "client_requests_select" on client_requests;
create policy "client_requests_select" on client_requests for select using (
  exists (select 1 from seba_state s where s.account = client_requests.account and s.user_id = auth.uid())
  or auth.uid() = client_user_id
);
drop policy if exists "client_requests_insert" on client_requests;
-- L'insert verifie que (account, client_id) correspond bien au lien deja
-- etabli pour CE client_user_id -- empeche un client authentifie de
-- creer une demande sous l'account/client_id de quelqu'un d'autre en
-- forgeant juste les valeurs du formulaire.
create policy "client_requests_insert" on client_requests for insert with check (
  auth.uid() = client_user_id
  and exists (
    select 1 from client_accounts ca
    where ca.client_user_id = auth.uid() and ca.account = client_requests.account and ca.client_id = client_requests.client_id
  )
);
drop policy if exists "client_requests_update" on client_requests;
-- Update reserve au patron (changer statut/intervenant) -- le client ne
-- modifie jamais une demande apres creation dans cette premiere version.
create policy "client_requests_update" on client_requests for update using (
  exists (select 1 from seba_state s where s.account = client_requests.account and s.user_id = auth.uid())
);
create index if not exists idx_client_requests_account on client_requests (account, created_at);
create index if not exists idx_client_requests_client on client_requests (account, client_id, created_at);

-- ── 32. seba_messages : policies reecrites pour un 2e/3e auth.uid() possible ──
-- Patron OU client lie (client_accounts) OU employe lie (employe_accounts,
-- authentification universelle 2026-07-19) peuvent lire/ecrire une ligne.
--
-- Chat de mission tripartite (2026-07-20) : request_id ancre un message
-- sur UNE demande (client_requests, existe des la soumission -- couvre
-- tout le cycle de vie, avant et apres assignation). Ajoute ici (apres
-- client_requests, section 31 juste au-dessus) plutot que dans la
-- create table de seba_messages (section 29, plus haut dans ce fichier)
-- car la contrainte de cle etrangere echouerait sur une table qui
-- n'existe pas encore lors d'une installation fraiche complete.
-- Les fils generiques (client_id/employe_id seuls, request_id null)
-- restent pleinement fonctionnels -- decision fondateur explicite : le
-- nouveau canal s'ajoute, ne remplace rien.
alter table seba_messages add column if not exists request_id uuid references client_requests (id) on delete cascade;
create index if not exists idx_seba_messages_request on seba_messages (request_id, created_at);

drop policy if exists "seba_messages_select" on seba_messages;
create policy "seba_messages_select" on seba_messages for select using (
  exists (select 1 from seba_state s where s.account = seba_messages.account and s.user_id = auth.uid())
  or exists (select 1 from client_accounts ca where ca.client_user_id = auth.uid() and ca.account = seba_messages.account and ca.client_id = seba_messages.client_id)
  or exists (select 1 from employe_accounts ea where ea.employe_user_id = auth.uid() and ea.account = seba_messages.account and ea.employe_id = seba_messages.employe_id)
  -- Chat de mission cote client : proprietaire de la demande visee.
  or exists (
    select 1 from client_requests cr
    where cr.id = seba_messages.request_id and cr.client_user_id = auth.uid()
  )
  -- Chat de mission cote employe : verifie EN DIRECT contre
  -- client_requests.intervenant_id (l'assignation ACTUELLE) -- une
  -- reassignation coupe l'acces immediatement, sans purge manuelle.
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

-- ── 33. Lit le profil client (fiche complete) du compte connecte ──
-- state.clients vit dans le blob JSONB du PATRON (seba_state.state) :
-- un client authentifie ne peut pas le lire via REST direct (RLS de
-- seba_state exige auth.uid() = user_id, qui est celui du PATRON, pas du
-- client) -- cette RPC extrait UNIQUEMENT sa propre entree, jamais le
-- blob entier ni les autres clients.
create or replace function get_my_client_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link client_accounts;
  v_client jsonb;
begin
  select * into v_link from client_accounts where client_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche client.');
  end if;

  select c into v_client
  from seba_state s, jsonb_array_elements(s.state -> 'clients') c
  where s.account = v_link.account and c ->> 'id' = v_link.client_id
  limit 1;

  return jsonb_build_object('ok', true, 'client', v_client, 'account', v_link.account, 'client_id', v_link.client_id);
end;
$$;
revoke all on function get_my_client_profile() from public;
grant execute on function get_my_client_profile() to authenticated;

-- ── 34. Lit le profil employe (fiche complete) du compte connecte ──
-- Miroir exact de get_my_client_profile() -- meme raison (RLS de
-- seba_state bloque un employe authentifie, auth.uid() != user_id du
-- patron proprietaire de la ligne).
create or replace function get_my_employee_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_employe jsonb;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select e into v_employe
  from seba_state s, jsonb_array_elements(s.state -> 'employes') e
  where s.account = v_link.account and e ->> 'id' = v_link.employe_id
  limit 1;

  return jsonb_build_object('ok', true, 'employe', v_employe, 'account', v_link.account, 'employe_id', v_link.employe_id);
end;
$$;
revoke all on function get_my_employee_profile() from public;
grant execute on function get_my_employee_profile() to authenticated;

-- ── 35. Planning du jour de l'employe connecte (espace-terrain.html) ──
-- interventions vit dans le meme blob JSONB du patron -- meme raison que
-- 33/34, extraction scopee a CET employe et CETTE date uniquement, jamais
-- le blob entier. _date est fourni par le CLIENT (sa propre date locale,
-- format YYYY-MM-DD, meme convention que todayISOLocal() cote JS) --
-- jamais calcule cote serveur : now() par defaut est en UTC, comparer a
-- une date locale pres de minuit deciderait le mauvais jour (piege deja
-- rencontre sur ce projet, voir CLAUDE.md).
create or replace function get_my_employee_interventions(_date text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link employe_accounts;
  v_result jsonb;
begin
  select * into v_link from employe_accounts where employe_user_id = v_uid;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'Compte non relié à une fiche employé.');
  end if;

  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_result
  from seba_state s, jsonb_array_elements(coalesce(s.state -> 'interventions', '[]'::jsonb)) i
  where s.account = v_link.account
    and i ->> 'employeId' = v_link.employe_id
    and i ->> 'date' = _date;

  return jsonb_build_object('ok', true, 'interventions', v_result, 'account', v_link.account, 'employe_id', v_link.employe_id);
end;
$$;
revoke all on function get_my_employee_interventions(text) from public;
grant execute on function get_my_employee_interventions(text) to authenticated;

-- ── 36. Clôture de mission côté employé (espace-terrain.html, 2026-07-20) ──
-- Meme mur d'ecriture que pour la LECTURE ci-dessus (seba_state.state_update
-- et client_requests.client_requests_update exigent tous deux
-- auth.uid() = user_id, celui du PATRON) -- cette RPC SECURITY DEFINER fait
-- l'equivalent en ECRITURE, restreinte aux missions ACTUELLEMENT assignees
-- a l'appelant. Reconstruit tout le tableau interventions (jamais un
-- jsonb_set positionnel par index -- l'ordre n'est pas garanti stable cote
-- client), et cloture aussi la client_request liee (statut "terminee")
-- dans la meme transaction si l'intervention a un requestId.
create or replace function close_my_intervention(_intervention_id text, _rapport text, _photo_name text)
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
        then i || jsonb_build_object('done', true, 'rapport', _rapport, 'rapportPhotoName', _photo_name)
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
    set statut = 'terminee', updated_at = now()
    where id = v_request_id::uuid and account = v_link.account;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function close_my_intervention(text, text, text) from public;
grant execute on function close_my_intervention(text, text, text) to authenticated;
