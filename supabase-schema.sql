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
