# 🏗️ ARCHITECTURE-V2.md — PROPOSITION "SEBA-CORE"

*Rédigé le 2026-07-09. Document d'analyse et de proposition uniquement — **aucun code n'a été modifié**, conformément à la consigne ("ne codez rien tant que l'architecture n'est pas validée par le fondateur"). Consultation croisée indépendante : Groq (données/état), Mistral + Gemini (interface/composants), synthèse et sections sécurité/maintenance par Claude Code.*

---

## ⚠️ Deux conflits réels avec les règles actuelles du projet (`CLAUDE.md`)

Avant tout le reste, deux points de ce brief entrent directement en tension avec des règles déjà écrites dans `CLAUDE.md`. Les 3 agents ont, chacun indépendamment, proposé des solutions qui **respectent** ces règles plutôt que de les casser — mais la décision finale reste au fondateur, pas à moi :

1. **"theme.css unifié"** vs *"Tactical Dark est scopé à `dashboard.html`/`widgets.js` — ne pas fusionner avec le thème des autres pages sans autorisation explicite"*. Mistral et Gemini convergent indépendamment sur la même solution : un fichier de **tokens** commun, mais où chaque thème **surcharge** les variables via un sélecteur scopé (`data-theme="tactical-dark"` ou équivalent), sans jamais forcer les deux palettes à devenir identiques. C'est une centralisation de la source de vérité, pas une fusion visuelle. Détail en section 2.
2. **"Composants modulaires"** vs *"zéro bundler, zéro framework"*. Mistral et Gemini convergent aussi, indépendamment, sur **ES Modules natifs** (`<script type="module">`, `import`/`export`) plutôt que des fichiers `<script src>` multiples ou un vrai framework — nativement supporté par tous les navigateurs modernes, zéro outil de build. Détail en section 3.

---

## 1. Schéma de base de données final (proposition)

**Contexte factuel à ne pas perdre de vue** : le produit fonctionne aujourd'hui sur `seba_state` (un blob JSON unique par utilisateur, via `SebaDB`/`docs/seba-data.js`) — c'est la voie réellement branchée. Les tables normalisées (`clients`, `devis`, `factures`, `interventions`, `employes`) existent déjà dans `supabase-schema.sql` avec RLS complet, mais sont documentées comme "prêtes, pas encore branchées". `profiles`/`companies` viennent d'être ajoutées (tunnel Flash & Drop) avec RLS partiel (SELECT+INSERT seulement).

**Proposition retenue** — *avec une correction par rapport à la réponse brute de Groq* :

Groq a proposé de lier chaque table normalisée existante à `profiles` via une nouvelle colonne `profile_id` :
```sql
ALTER TABLE clients ADD COLUMN profile_id INTEGER REFERENCES profiles(id);
```
**Cette instruction ne fonctionnerait pas telle quelle** : `profiles.id` est de type `uuid` (voir `supabase-schema.sql`), pas `integer` — la contrainte de clé étrangère échouerait à la création. Corrigé ci-dessous. Au-delà de la coquille de type, il y a une **vraie question d'architecture non tranchée** : `clients`/`devis`/`factures`/etc. ont déjà un lien direct `user_id → auth.users`. Ajouter un second lien indirect via `profiles` crée deux chemins de vérité pour la même notion de propriétaire. Deux options, à trancher par le fondateur avant tout code :

- **Option A (minimale)** : ne toucher à rien sur les tables existantes ; `profiles` reste une table de métadonnées de compte (secteur, etc.), complémentaire mais pas maîtresse au sens strict.
- **Option B (unification réelle)** : migrer progressivement `user_id` en `profile_id` sur les tables existantes, ce qui suppose de créer une ligne `profiles` pour chaque compte existant (migration de données, pas juste de schéma).

**RLS manquant à ajouter dans tous les cas** (ça, en revanche, ne fait pas débat — c'est un vrai trou de sécurité à combler) :
```sql
create policy "profiles_update" on profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete" on profiles for delete using (auth.uid() = user_id);

create policy "companies_update" on companies for update using (
  exists (select 1 from profiles where profiles.id = companies.profile_id and profiles.user_id = auth.uid())
);
create policy "companies_delete" on companies for delete using (
  exists (select 1 from profiles where profiles.id = companies.profile_id and profiles.user_id = auth.uid())
);
```
*(Style identique à `profiles_select`/`companies_select` déjà en place — `companies` n'a pas de colonne `user_id` propre, vérification indirecte via `profiles` comme pour les policies existantes.)*

---

## 2. Design system : `theme.css` sans fusion forcée

Synthèse convergente Mistral + Gemini : un seul fichier de **tokens** (couleurs, espacements, typographie) déclarés en `:root`, que chaque thème **surcharge** via un sélecteur scopé plutôt que de les redéfinir globalement :

```css
/* theme.css — tokens partagés (valeurs par defaut = pro-global.css actuel) */
:root {
  --color-bg: /* valeur actuelle pro-global.css */;
  --color-accent: /* valeur actuelle pro-global.css */;
  /* ... reste des tokens espacement/typo deja etablis cette session ... */
}

/* Surcharge scopee, jamais globale */
[data-theme="tactical-dark"] {
  --color-bg: #09090B;
  --color-accent: #10B981;
  /* ... valeurs Tactical Dark reelles, deja en usage dans dashboard.html ... */
}
```
`dashboard.html` ajoute `data-theme="tactical-dark"` sur son conteneur racine ; toutes les autres pages n'ont rien à changer (elles utilisent déjà les valeurs par défaut). **Aucune page ne voit ses couleurs changer** avec cette approche — c'est une factorisation de l'existant, pas une refonte visuelle. C'est la condition pour que ce soit acceptable sans "fusionner" les thèmes au sens de la règle projet.

Point de vigilance : les deux agents ont illustré leur proposition avec des valeurs hex **inventées** (`#007bff`, `#10B981` approximatif, etc.), pas les vraies valeurs actuelles de `pro-global.css`/`dashboard.html`. Une vraie migration devrait extraire les valeurs réelles, pas les réinventer.

---

## 3. Découplage en modules JS (ES Modules natifs, zéro bundler)

Structure convergente (synthèse des deux propositions) :
```
docs/js/onboarding/
  auth-manager.js       — signUp/signIn/getSession (delegue a window.sebaAuth, ne le duplique pas)
  step-navigator.js     — machine d'etat _currentStep / goStep, extraite de l'inline actuel
  data-propulsor.js      — appel RPC create_profile_and_company (voir correction ci-dessous)
  propulsion-animator.js — logique promise-based du point 4
docs/onboarding.html     — <script type="module" src="js/onboarding/index.js">, plus de logique inline
```

**Correction nécessaire par rapport à la réponse brute de Gemini** : sa proposition de `DataPropulsor` appelle directement `supabase.from('profiles').insert(...)` puis `supabase.from('companies').insert(...)` — **deux appels séparés, non atomiques**. C'est exactement le problème que la fonction RPC `create_profile_and_company()` a été écrite pour éliminer (déjà déployée et branchée dans `onboarding.html` actuel). Un module `DataPropulsor` réécrit ne doit **pas** régresser vers 2 insertions séparées ; il doit continuer à appeler `sebaAuth.rpc('create_profile_and_company', {...})`, juste depuis un module au lieu d'un script inline. Cet écart vient d'un manque de contexte dans mon prompt de consultation (Gemini n'avait pas explicitement connaissance de l'intégration RPC déjà faite) — je le corrige ici plutôt que de le laisser passer.

`AuthManager` ne doit pas non plus **dupliquer** l'initialisation du client Supabase (les deux propositions brutes le font) — `auth.js`/`window.sebaAuth` reste le seul point d'entrée Supabase du site, un `AuthManager.js` doit l'englober, pas le remplacer.

---

## 4. Résilience UX : animation basée sur des promesses

Convergence forte et techniquement solide entre Mistral et Gemini (pattern classique "durée minimale perçue + timeout de secours") :

```javascript
async function animatePropulsion(serverSavePromise, { minDuration = 1200, maxTimeout = 8000 } = {}) {
  showAnimation();
  const minDelay = new Promise((r) => setTimeout(r, minDuration));
  const withTimeout = Promise.race([
    serverSavePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Le serveur ne repond pas.')), maxTimeout)),
  ]);
  try {
    const [, result] = await Promise.all([minDelay, withTimeout]);
    hideAnimation();
    return result;
  } catch (e) {
    hideAnimation();
    throw e; // l'appelant affiche l'erreur, ne redirige pas vers le dashboard en cas d'echec
  }
}
```
Remplace le `setTimeout(2400)` fixe actuel : l'animation ne se termine ni trop tôt (flash désagréable si le serveur répond en 300ms) ni ne bloque indéfiniment (timeout de secours si le serveur ne répond jamais).

---

## 5. Gestion d'état centralisée (`StateManagement.js`)

Proposition de Groq, réutilisable directement (le pattern `window.addEventListener('storage', ...)` est déjà celui utilisé par `SebaDB.onChange()` dans `docs/seba-data.js` — cohérent avec l'existant) :

```javascript
export class StateManager {
  #state = {};
  #listeners = {};
  constructor() { window.addEventListener('storage', (e) => this.#syncFromStorage(e)); }
  get(key) { return this.#state[key]; }
  set(key, value) {
    this.#state[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error('[state] echec localStorage', e); }
    this.#notify(key);
  }
  onChange(key, cb) { (this.#listeners[key] ??= []).push(cb); }
  #notify(key) { (this.#listeners[key] || []).forEach((cb) => cb(this.#state[key])); }
  #syncFromStorage(e) {
    if (e.storageArea !== localStorage || !(e.key in this.#state)) return;
    try { this.#state[e.key] = JSON.parse(e.newValue); this.#notify(e.key); } catch (err) {}
  }
}
```
Remplace l'objet global `S` de `onboarding.html` par une instance unique importée par les modules qui en ont besoin (fuite de portée globale éliminée).

### Convention JSDoc (proposition Groq, adaptée au projet 100% vanilla)
```javascript
/**
 * @typedef {'Nettoyage & Entretien'|'Conciergerie & Accueil'|'Artisans & Maintenance'} Sector
 * @typedef {Object} OnboardingState
 * @property {string} email
 * @property {Sector|null} sector
 * @property {string} nom
 * @property {string|null} userId
 */
```
Aucune vérification à la compilation (pas de TypeScript/build step, contrainte du projet) — ces annotations servent l'auto-complétion IDE et la documentation, pas une garantie stricte. À faire respecter par convention/revue de code, pas par un outil.

---

## 6. Configuration d'environnement (DEV/STAGING/PROD)

Section rédigée directement (pas un appel API — rôle assigné explicitement à Claude Code dans le brief).

Le projet a déjà une séparation secrets/public établie (`docs/config.js` gitignoré vs `docs/config.public.js` commité). Proposition : un **troisième fichier**, `docs/config.env.js` (commité, pas de secret dedans), qui ne fait que déclarer l'environnement actif :
```javascript
window.SEBA_ENV = 'dev'; // 'dev' | 'staging' | 'prod' — bascule manuelle avant deploiement, pas de detection automatique fragile (hostname, etc.)
```
`auth.js` et les futurs modules lisent `window.SEBA_ENV` pour adapter leur comportement (ex : logs de debug actifs seulement en `dev`, comme déjà fait de façon ad hoc dans `onboarding.html` avec `location.hostname === 'localhost'`). **Ne remplace pas** `config.js`/`config.public.js` (qui restent la source des clés Supabase par environnement) — s'ajoute comme un simple switch de comportement, pas une nouvelle couche de secrets.

## 7. Suite de tests de non-régression

Proposition : `mocha` + `assert` natif (Node), ou une lib encore plus légère type `tape` — pas de Jest complet (poids inutile pour ~10 tests). Structure :
```
scripts/tests/
  auth.test.js          — stub sebaAuth.signUp (succes/echec), verifie le blocage d'etape en cas d'echec
  rpc.test.js            — stub sebaAuth.rpc, verifie le payload exact envoye (3 params, pas 4)
  step-navigator.test.js — verifie goStep()/toggle .hidden sur un DOM simule (jsdom, deja une devDependency indirecte de puppeteer ou a ajouter)
```
Exécution : `node --test scripts/tests/` (runner natif Node 18+, zéro dépendance supplémentaire — le projet tourne déjà sous Node 24). Pas besoin de `tiny-test` externe, Node fournit déjà `node:test` en natif depuis la version utilisée ici.

---

## 8. Gestion d'erreurs globale — que se passe-t-il si Supabase tombe ?

Synthèse (aucun agent n'a traité ce point explicitement, complété par Claude Code) : le principe déjà en place dans `auth.js`/`SebaDB` est le **repli local silencieux** (mode démo si non configuré, cache localStorage systématique). La proposition ci-dessus (section 4, `animatePropulsion` avec timeout) l'étend au cas "Supabase configuré mais indisponible/lent" : après le timeout de secours, l'erreur est propagée à l'utilisateur (pas de redirection silencieuse vers un dashboard vide), avec une option de nouvelle tentative plutôt qu'un blocage complet.

---

## Questions ouvertes pour le fondateur (avant tout code)

1. **Option A vs B** (section 1) : `profiles` reste une table complémentaire, ou devient réellement la table maîtresse avec migration des tables existantes ?
2. **`theme.css`** : go/no-go sur l'extraction de tokens même scopée (section 2) — c'est un changement qui touche potentiellement toutes les pages connectées, à faire dans un chantier dédié avec le rayon d'impact signalé explicitement (règle `CLAUDE.md` sur les fichiers partagés).
3. **Ampleur du découplage modulaire** : tout `onboarding.html` d'un coup, ou une migration progressive module par module ?
4. **Librairie de test** : `node:test` natif (proposé ci-dessus, zéro dépendance) suffisant, ou une préférence pour autre chose ?
