# 🏗️ ARCHITECTURE-MODULAIRE.md — Event Bus & découplage strict

*Rédigé le 2026-07-09. Document de structure et de contrat d'interface uniquement — **aucun fichier de code n'a été modifié**, conformément à la consigne ("Ne modifiez pas encore le code existant"). Grounded sur l'état réel actuel de `docs/onboarding.html` (fusionné, PR #15) et `docs/auth.js`, prolonge [[project_architecture_v2|ARCHITECTURE-V2.md]] (déjà mergé, PR #16) sur le point qu'il laissait ouvert : "ampleur du découplage modulaire".*

---

## ⚠️ Correction préalable : où vit `/src` ?

Le brief propose `/src/core`, `/src/modules`, `/src/ui` à la racine du repo. **Le site réel ne fonctionne pas comme ça** : GitHub Pages sert le dossier `docs/` (confirmé : `docs/index.html`, `docs/dashboard.html`, `docs/auth.js`, etc. sont déjà à la racine servie). Un `/src` à la racine du repo ne serait **jamais livré au navigateur** — un `<script type="module" src="/src/core/event-bus.js">` retournerait 404 en production.

**Structure corrigée**, mêmes noms, bon emplacement :
```
docs/
  src/
    core/
      event-bus.js         — EventBus natif (CustomEvent sur un EventTarget dédié)
      state-manager.js      — StateManager (deja specifie dans ARCHITECTURE-V2.md section 5)
    modules/
      auth-module.js        — encapsule window.sebaAuth (signUp/signIn), n'expose que des evenements
      segmentation-module.js — logique de selection du secteur (ecran 2)
      propulsion-module.js   — animation + orchestration de la sauvegarde (ecran 3)
      api-module.js          — seul point d'appel RPC/Supabase autorise
    ui/
      step-navigator.js      — goStep()/toggle .hidden, ecoute les evenements, ne connait aucune logique metier
  onboarding.html            — <script type="module" src="src/index.js">, plus de logique inline
```
Le reste du document utilise cette arborescence corrigée.

---

## A. Structure des dossiers — rôle de chaque fichier

| Fichier | Contient | Ne contient jamais |
|---|---|---|
| `core/event-bus.js` | Le bus d'événements, un unique `EventTarget` exporté | De la logique métier |
| `core/state-manager.js` | Le `StateManager` (déjà spécifié dans `ARCHITECTURE-V2.md`) | Des appels réseau |
| `modules/auth-module.js` | Appelle `window.sebaAuth.signUp/signIn`, valide le formulaire, émet des événements | Un accès direct au DOM en dehors de son propre formulaire |
| `modules/segmentation-module.js` | Détecte le clic sur une `.sector-card`, valide, émet `SECTOR_SELECTED` | Un appel réseau |
| `modules/propulsion-module.js` | Orchestre l'animation (pattern `animatePropulsion` déjà spécifié) + déclenche l'appel API | L'appel RPC lui-même (délégué à `api-module.js`) |
| `modules/api-module.js` | **Seul** fichier autorisé à appeler `window.sebaAuth.rpc(...)` | De la logique d'affichage |
| `ui/step-navigator.js` | `goStep()`, classes `.hidden`/`.selected` | La moindre règle métier (ex: quel secteur est valide) |

---

## B. Contrat d'interface

### B.1 — L'Event Bus (implémentation, pas juste le concept)

Un `EventTarget` natif suffit — pas besoin de réinventer un pub/sub, le navigateur en fournit déjà un, sans dépendance :
```javascript
// core/event-bus.js
const bus = new EventTarget();

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, handler) {
  bus.addEventListener(type, (e) => handler(e.detail));
  return () => bus.removeEventListener(type, handler); // desabonnement, evite les fuites memoire
}
```
Aucun module n'importe un autre module directement (contrainte du brief respectée à la lettre) : `auth-module.js` n'importe jamais `segmentation-module.js`, il émet un événement que `segmentation-module.js` (ou `index.js`, voir plus bas) choisit d'écouter.

### B.2 — Liste des événements (mappée sur le code réel actuel)

| Événement | Émis par | Écouté par | Détail (`payload`) |
|---|---|---|---|
| `AUTH_SUCCESS` | `auth-module.js` | `ui/step-navigator.js`, `core/state-manager.js` | `{ email, userId }` |
| `AUTH_FAILED` | `auth-module.js` | `ui/step-navigator.js` (affiche `#err-capture`) | `{ message }` |
| `SECTOR_SELECTED` | `segmentation-module.js` | `core/state-manager.js`, `ui/step-navigator.js` | `{ sector }` |
| `PROPULSION_STARTED` | `ui/step-navigator.js` (au `goStep(3)`) | `propulsion-module.js` | `{}` |
| `PROPULSION_SAVE_REQUESTED` | `propulsion-module.js` | `api-module.js` | `{ userId, sector, companyName }` |
| `API_SUCCESS` | `api-module.js` | `propulsion-module.js` | `{ endpoint: 'create_profile_and_company' }` |
| `API_FAILED` | `api-module.js` | `propulsion-module.js`, `ui/step-navigator.js` | `{ endpoint, message }` — déclenche le Mode Déconnecté (voir D) |
| `STATE_CHANGED` | `core/state-manager.js` | quiconque appelle `on('STATE_CHANGED', ...)` | `{ key, value }` |

Convention de nommage : `DOMAINE_EVENEMENT` en `SCREAMING_SNAKE_CASE`, cohérente avec les exemples du brief (`AUTH_SUCCESS`, `SECTOR_SELECTED`).

### B.3 — Signature du `StateModule`

Reprend et fige l'implémentation déjà proposée dans `ARCHITECTURE-V2.md` (section 5), avec un ajout : elle **réagit** au bus plutôt que d'être appelée directement par les modules métier — c'est ce qui la rend conforme à la règle "communication uniquement par événements" :

```javascript
// core/state-manager.js
import { on, emit } from './event-bus.js';

const state = { email: '', sector: '', nom: '', userId: null }; // remplace S global d'onboarding.html

export function get(key) { return state[key]; }

function set(key, value) {
  state[key] = value;
  emit('STATE_CHANGED', { key, value });
}

on('AUTH_SUCCESS', ({ email, userId }) => { set('email', email); set('userId', userId); });
on('SECTOR_SELECTED', ({ sector }) => set('sector', sector));
```
Aucun module métier n'importe `state-manager.js` pour écrire dedans — seul `state-manager.js` s'abonne aux événements et décide quoi retenir. Un module métier qui a besoin de **lire** l'état (ex: `propulsion-module.js` a besoin de `userId`/`sector` pour construire le payload RPC) importe uniquement `get()`, jamais `set()` — c'est la frontière d'isolation demandée par le brief ("aucune variable globale en dehors du StateModule").

---

## C. Stratégie de sécurité — comment `APIModule` filtre les appels

Le brief demande : *"comment le module APIModule protège les appels RPC en ignorant les appels non autorisés provenant d'autres modules"*.

**Précision nécessaire avant de répondre** : en JavaScript navigateur pur (sans framework, sans sandbox iframe/Worker), il n'existe pas de mécanisme qui empêche un module d'appeler directement une fonction exportée par un autre — `import` donne un accès total, il n'y a pas de "private" au sens runtime. La vraie protection ne peut donc pas être "empêcher un import", mais deux choses concrètes et réellement applicables :

1. **Un seul point d'appel réseau existe dans tout le code : `window.sebaAuth.rpc(...)`** (déjà vrai aujourd'hui — voir `docs/auth.js` ligne 129, commenté explicitement *"auth.js reste le seul point d'entrée Supabase du site"*). `api-module.js` est le seul fichier du dossier `modules/` qui importe/appelle cette fonction. Si un autre module tentait de l'appeler directement, ce serait détectable **statiquement** (grep `sebaAuth.rpc` en dehors de `api-module.js` → violation), pas empêché à l'exécution — c'est une convention de code vérifiable, pas un sandboxing runtime. À ajouter comme règle dans `tools/check-design-system.js` ou un script dédié léger (`grep -rn "sebaAuth\.rpc" docs/src/modules | grep -v api-module.js` doit être vide).
2. **`api-module.js` valide le contenu de l'événement `PROPULSION_SAVE_REQUESTED` avant d'agir** — il ne fait pas confiance à l'émetteur :
```javascript
// modules/api-module.js
import { on, emit } from '../core/event-bus.js';

const VALID_SECTORS = ['Nettoyage & Entretien', 'Conciergerie & Accueil', 'Artisans & Maintenance'];

on('PROPULSION_SAVE_REQUESTED', async ({ userId, sector, companyName }) => {
  if (typeof userId !== 'string' || !userId) {
    emit('API_FAILED', { endpoint: 'create_profile_and_company', message: 'userId invalide ou absent.' });
    return;
  }
  if (!VALID_SECTORS.includes(sector)) {
    emit('API_FAILED', { endpoint: 'create_profile_and_company', message: 'secteur invalide.' });
    return;
  }
  const { error } = await window.sebaAuth.rpc('create_profile_and_company', {
    _user_id: userId, _sector: sector, _company_name: String(companyName || '').slice(0, 200),
  });
  if (error) { emit('API_FAILED', { endpoint: 'create_profile_and_company', message: error.message }); return; }
  emit('API_SUCCESS', { endpoint: 'create_profile_and_company' });
});
```
La vraie sécurité (autorisation d'écriture, propriétaire des données) reste et doit rester **côté serveur** — les policies RLS déjà en place sur `profiles`/`companies` (`auth.uid() = user_id`) sont la protection réelle contre un appel malveillant, quel que soit ce qui se passe côté client. Ce que fait `api-module.js` est de l'hygiène (valider avant d'envoyer, ne pas propager `undefined`/valeurs hors-liste), pas un rempart de sécurité en soi — un rempart client-side seul serait contournable par quiconque ouvre la console.

---

## D. Gestion des erreurs — modèle Fail-Safe

```javascript
// ui/step-navigator.js (extrait)
import { on } from '../core/event-bus.js';

let offlineMode = false;

on('API_FAILED', ({ message }) => {
  offlineMode = true;
  document.body.classList.add('mode-deconnecte');
  showBanner(`Connexion au serveur impossible (${message}). Vos données restent enregistrées localement.`);
  // pas de blocage : l'ecran 3 (propulsion) termine son animation et redirige quand meme,
  // conformement au repli local deja existant dans saveProfile() (localStorage.setItem('sebaEntreprise', ...))
});
```
Ce n'est pas une nouvelle idée : `saveProfile()` fait déjà ça aujourd'hui (`docs/onboarding.html` lignes 326-350) — `localStorage.setItem('sebaEntreprise', ...)` est écrit **avant** même de tenter le RPC, donc l'échec réseau ne bloque jamais la redirection vers `dashboard.html`. Le modèle Fail-Safe ci-dessus **formalise** ce comportement existant en le rendant explicite et visible (bannière "Mode Déconnecté"), plutôt que silencieux comme c'est le cas actuellement (`console.error` seul, rien pour l'utilisateur).

`.mode-deconnecte` doit être un token de thème neutre (gris/orange discret), pas une couleur en dur — respecte la règle `check-design-system.js` déjà en place.

---

## E. Testabilité (contrainte "indépendant de l'interface graphique")

Chaque module exporte des fonctions pures/testables sans DOM réel, en s'appuyant sur l'Event Bus comme point d'observation :
```javascript
// scripts/tests/api-module.test.js
import { on, emit } from '../../docs/src/core/event-bus.js';
import '../../docs/src/modules/api-module.js'; // s'auto-enregistre sur le bus a l'import

test('rejette un secteur invalide sans appeler le RPC', async () => {
  window.sebaAuth = { rpc: () => { throw new Error('ne doit jamais etre appele'); } };
  let failure = null;
  on('API_FAILED', (detail) => { failure = detail; });
  emit('PROPULSION_SAVE_REQUESTED', { userId: 'u1', sector: 'Secteur bidon', companyName: 'Test' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(failure);
});
```
Cohérent avec la structure déjà proposée dans `ARCHITECTURE-V2.md` section 7 (`node --test`, zéro dépendance) — l'Event Bus rend ce test possible **sans** simuler de clic DOM, exactement ce que demande la contrainte du brief.

---

## Ce qui reste une question ouverte (pas tranchée ici)

- **Granularité de la migration** : `ARCHITECTURE-V2.md` posait déjà la question "tout `onboarding.html` d'un coup, ou module par module ?" — ce document précise le *contrat* (événements, dossiers) mais ne tranche pas *l'ordre d'exécution*. Recommandation : migrer `api-module.js` en premier (le point de sécurité le plus sensible, section C), en le faisant coexister avec le code inline actuel via un simple `emit()` ajouté à `saveProfile()` existant, avant de toucher au reste.
- **Vérification statique de la règle "seul `api-module.js` appelle `sebaAuth.rpc`"** (section C.1) : à implémenter comme un petit script dédié ou une extension de `check-design-system.js` — pas encore fait, sujet à discussion.
