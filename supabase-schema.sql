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

-- ── 0b. Compteur d'usage IA (relais ai-relay.ts) ──
-- Accessible uniquement via la clé service_role (les Edge Functions
-- l'ont automatiquement) : RLS activé sans policy = accès bloqué à
-- tout le monde sauf service_role, qui contourne RLS par nature.
create table if not exists api_usage (
  account text not null,
  day date not null,
  count int not null default 0,
  primary key (account, day)
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

-- ═══════════════════════════════════════════════════════════════
-- NOTE ARCHITECTURE
-- Le site utilise aujourd'hui la table seba_state (blob JSON) via
-- l'adaptateur de docs/seba-data.js — c'est la voie déjà branchée.
-- Les tables normalisées 1-5 ci-dessus sont prêtes pour l'étape
-- suivante (migration de l'adaptateur vers un CRUD table par table)
-- sans changer l'API SebaDB consommée par les pages.
-- ═══════════════════════════════════════════════════════════════
