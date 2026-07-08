# Seba — Backend & données : comment ça marche, comment brancher le cloud

## Architecture actuelle (livrée)

Toutes les pages métier partagent désormais **un seul moteur de données** : `docs/seba-data.js` (`SebaDB`).

```
onboarding.html ──crée le compte──▶ sebaEntreprise (profil)
                                        │
                                        ▼ (première visite : seed réaliste par secteur)
                    ┌────────────── SebaDB (seba_db) ──────────────┐
                    │ clients · devis · factures · interventions   │
                    │ employés · journal · séquences #0125/#F-0099 │
                    └───────────────────────────────────────────────┘
     ▲            ▲           ▲            ▲           ▲          ▲
 clients.html  devis.html  factures.html planning.html equipe.html historique.html
     (CRUD)     (CRUD)      (lecture)     (CRUD)       (CRUD)     (journal)
                                 │
                          dashboard.html
              (métriques CALCULÉES : CA réel du mois, devis en
               attente, interventions du jour, courbe D3 alimentée
               par les vrais chiffres, activité = journal réel)
```

- **Stockage par défaut** : `localStorage` (clé `seba_db`) — fonctionne sans serveur, hors ligne, gratuit.
- **Synchro inter-onglets** : automatique (événement `storage`).
- **Sauvegarde/restauration** : Réglages → Compte → « Données & sauvegarde » (export/import JSON).
- **Limite assumée** : les données vivent sur l'appareil. Pour du multi-appareils, brancher Supabase (ci-dessous).

## Brancher Supabase (multi-appareils) — 15 minutes

L'adaptateur est **déjà écrit** dans `seba-data.js` (`SupabaseAdapter`). Il ne manque que tes clés.

### 1. Créer le projet
1. Va sur https://supabase.com → **New project** (gratuit).
2. Note deux valeurs dans **Settings → API** :
   - **Project URL** (ex. `https://abcdefgh.supabase.co`)
   - **anon public key** (longue chaîne `eyJ...`)

### 2. Créer la table (SQL Editor → coller → Run)

**Utilise directement `supabase-schema.sql` à la racine du repo** (schéma complet, policies RLS déjà verrouillées par `auth.uid() = user_id`). L'exemple ci-dessous a longtemps montré une version prototype avec des policies `using (true)` (accès libre à quiconque connaît l'URL du projet) — retiré pour ne plus être copiable par erreur à la place du vrai schéma :

```sql
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
```

### 3. Déclarer les clés côté site
Créer `docs/config.js` :
```js
window.SEBA_CONFIG = {
  supabaseUrl: 'https://TON-PROJET.supabase.co',
  supabaseAnonKey: 'eyJ...ta clé anon...',
  accountId: 'mon-entreprise', // identifiant du compte (slug)
};
```
Puis ajouter **avant** `seba-data.js` dans chaque page pro :
```html
<script src="config.js"></script>
```
⚠️ **Ne jamais committer config.js avec de vraies clés** dans un repo public — ajouter `docs/config.js` au `.gitignore`. La clé *anon* est conçue pour être exposée côté navigateur : ça ne pose pas de problème ici car les policies ci-dessus restreignent déjà chaque ligne à son propre `auth.uid()` (voir aussi `api_usage` dans `supabase-schema.sql`, protégée différemment : RLS activé sans policy = accès service_role uniquement).

### 4. C'est tout
`SebaDB` détecte `window.SEBA_CONFIG` au chargement : lecture instantanée depuis le cache local, rapatriement du cloud en arrière-plan, sauvegarde débouncée (800 ms) vers Supabase à chaque écriture, tolérance hors-ligne (le cache local fait foi, re-push à la prochaine écriture).

## Étapes suivantes recommandées (dans l'ordre)
1. ~~**Auth Supabase** → un `accountId` par utilisateur réel + policies RLS `auth.uid()`.~~ **Fait (2026-07-07)** : `SupabaseAdapter._accountId()` dans `docs/seba-data.js` dérive l'`account` directement du `sub` du JWT de session (auth.uid() réel), au lieu de l'ancien `accountId` unique et partagé de `config.public.js` — chaque utilisateur a désormais sa propre ligne `seba_state`.
2. **Normalisation** : passer du blob JSON à de vraies tables (`clients`, `devis`, `factures`…) quand le produit est validé — l'API de `SebaDB` ne change pas, seul l'adaptateur évolue.
3. **Stripe** (liens de paiement sur les factures) puis **PDF conformes France** — voir `strategie/plan-marche-produit-2026.md`.

## API SebaDB (référence rapide)
| Méthode | Rôle |
|---|---|
| `SebaDB.list('clients')` | liste (copie) — collections : clients, devis, factures, interventions, employes |
| `SebaDB.get(coll, id)` / `create` / `update` / `remove` | CRUD |
| `SebaDB.nextNum('devis'\|'facture')` | numérotation séquentielle `#0125` / `#F-0099` |
| `SebaDB.log(type, label, href)` / `SebaDB.journal(n)` | journal d'activité |
| `SebaDB.metrics()` | CA du mois, devis en attente, interventions du jour… |
| `SebaDB.onChange(fn)` | ré-agir aux changements (même onglet + autres onglets) |
| `SebaDB.exportJSON()` / `importJSON(str)` | sauvegarde / restauration |
| `SebaDB.hasData()` | le compte a-t-il des données réelles ? |
