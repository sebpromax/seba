# 🔍 AUDIT-RISQUES.md — Dettes et risques "Seba-Core"

*Rédigé le 2026-07-09 par Claude Code, lecture directe du code réel dans `docs/` (grep + lecture de fichiers, pas de consultation d'agents externes pour cet audit). Aucune correction appliquée — audit seul, conformément à la consigne. Ton volontairement sans complaisance : le but est la liste complète, pas de minimiser.*

---

## 1. Dépendances cachées

### 1.1 Variables globales (`window.X`)
Le site expose aujourd'hui **~20 objets globaux** sur `window` (un par fichier, presque toujours en IIFE) : `sebaAuth`, `sebaEmail`, `sebaStripe`, `sebaPush`, `sebaTheme`, `sebaLogs`, `SebaDB`, `WIDGET_CATALOG`, `businessTypes`, `askAI`, `sebaAIStatus`, `importerClientsCSV`, `exporterClientsCSV`, `generateInvoicePDF`, `switchChartPeriod`, `renderCockpitTelemetry`, `aiBarParticleBurst`, `SEBA_CONFIG`/`SEBA_CONFIG_PUBLIC`. Chaque page HTML choisit elle-même l'ordre de ses `<script src>`, et l'ordre **compte** (ex : `guard.js` doit être chargé après `auth.js`, sans qu'aucun mécanisme ne le garantisse — un simple oubli d'ordre dans une page ne lève aucune erreur visible, juste un `guard.js` qui ne bloque plus rien silencieusement).

### 1.2 Logique dupliquée (la vraie découverte de cet audit)
La fonction `sessionBearer()`/`_bearer()`/`_sebaAIBearer()` (scan de `localStorage` à la recherche d'une clé `sb-*-auth-token`, extraction de `access_token`) est **copiée-collée à l'identique dans 5 fichiers indépendants** : `docs/ai-assistant.js:29`, `docs/email-service.js:14`, `docs/push-init.js:16`, `docs/widgets.js:1052`, `docs/seba-data.js:62`. Chacune connaît en dur le format interne de stockage de `supabase-js` (`sb-.*-auth-token`) — un détail d'implémentation de la librairie, pas une API publique documentée. Si Supabase change ce format dans une future version majeure du SDK, **5 fichiers cassent silencieusement** (le token n'est simplement plus trouvé → repli sur mode démo/erreur 401, sans qu'aucun message n'identifie la vraie cause).

De même, la fonction d'échappement HTML `esc()` est dupliquée dans **3 fichiers** (`docs/clients.html:286`, `docs/crm-tech.html:90`, `docs/widgets.js:305`) — et son absence dans un 4ᵉ fichier est directement la cause du risque CRITIQUE listé en section 3.1.

### 1.3 Valeurs codées en dur
- URLs d'API tierces en dur dans le code (pas de config centralisée) : `https://api.groq.com/...` (`ai-assistant.js:101`), `https://data.geopf.fr/geocodage/search` (`address-autocomplete.js:11`), CDN divers (jsDelivr, unpkg, OneSignal, Sentry, Stripe) répétés à chaque fichier qui en a besoin.
- `docs/config.public.js:27` et `docs/config.js:12` contiennent la même URL Supabase en dur (`https://ptmudezhxnhhyctowlqp.supabase.co`) — normal et voulu pour `config.public.js` (public par design, protégé par RLS), mais `config.js` la duplique sans raison puisqu'il est gitignoré et censé ne contenir que les secrets/surcharges.
- Sélecteurs DOM (`getElementById('sidebar-footer')`, `getElementById('inp-nom')`, etc.) codés en dur dans chaque page sans aucune vérification statique — renommer un `id` dans le HTML d'une page ne casse rien à la compilation (il n'y a pas de compilation), juste silencieusement à l'exécution.

---

## 2. Sécurité et Fail-Safe

### 2.1 Réponses HTTP 429/500 — non distinguées d'un compte vide
`docs/seba-data.js:104-114` (`SupabaseAdapter.pull()`) :
```javascript
if (!res.ok) return null;
```
**Toute** réponse non-2xx (429 rate-limit, 500 erreur serveur, 401 token expiré) est traitée exactement comme "aucune donnée" — l'utilisateur avec un compte plein de données verrait un dashboard vide lors d'une panne ou d'un rate-limit transitoire, sans aucun message d'erreur, sans retry, sans distinction visuelle avec un compte réellement neuf. Le commentaire du code ne mentionne que le cas offline (`catch (e) { return null; }` ligne 113), pas le cas "serveur répond mais en erreur".

### 2.2 Écriture silencieusement perdue en cas d'échec réseau
`docs/seba-data.js:120-129` (`_push()`) : le `catch` avale l'erreur avec un commentaire *"offline : le cache local fait foi, re-push à la prochaine écriture"* — mais il n'existe **aucun mécanisme de retry automatique** : si l'utilisateur ne fait plus aucune modification après l'échec, cette écriture est perdue pour de bon côté serveur (le cache local reste correct, mais ne resynchronise jamais tant qu'aucun nouveau `save()` n'est déclenché). Aucun indicateur visuel n'informe l'utilisateur d'une désynchronisation.

### 2.3 RLS incomplète sur `profiles`/`companies` (déjà identifiée dans `ARCHITECTURE-V2.md`, toujours pas appliquée)
`supabase-schema.sql:141-178` : les tables `profiles` et `companies` n'ont que des policies `SELECT` et `INSERT` (`profiles_select`, `profiles_insert`, `companies_select`, `companies_insert`). **Aucune policy `UPDATE`/`DELETE` n'existe.** Concrètement aujourd'hui : un utilisateur authentifié ne peut ni corriger une faute de frappe dans le nom de son entreprise, ni supprimer son profil, via l'API REST/RPC standard de Supabase (RLS bloque tout par défaut en l'absence de policy) — c'est un manque fonctionnel autant qu'une zone d'ombre sécurité (une policy mal écrite plus tard, ajoutée dans l'urgence pour "débloquer" ce cas, est le scénario classique d'introduction de faille).

### 2.4 Fail-safe qui fonctionne bien (à noter, pas que des problèmes)
`docs/guard.js` et `docs/auth.js` : le repli "mode démo" (pas de config → aucun blocage, pas de crash) est cohérent et systématique sur les deux fichiers testés. `docs/onboarding.html:326-350` (`saveProfile()`) écrit déjà en local **avant** de tenter le réseau — donc un échec réseau lors de l'inscription ne bloque jamais la suite du tunnel. C'est un bon patron, à généraliser (voir `ARCHITECTURE-V2.md` section 4, déjà proposé).

---

## 3. Zones d'ombre (les oublis)

### 3.1 CRITIQUE — Injection HTML via le nom d'entreprise, non couverte par le fix XSS déjà livré
Le commit `fix-securite-xss-suppression` (8aa487a/93edec1, 2026-07-08) a ajouté une fonction `esc()` et corrigé plusieurs points dans `clients.html`, `crm-tech.html`, `widgets.js`, `seba-data.js`, `reglages.html`, `onboarding.html`. **Il n'a pas couvert tous les points d'insertion du même champ.** Preuve concrète :
- `docs/onboarding.html:189` : le champ `#inp-nom` accepte n'importe quel texte (max 60 caractères, aucun filtrage de balises — `<img src=x onerror=...>` tient largement dans 60 caractères).
- `docs/onboarding.html:333` : la valeur brute est stockée telle quelle dans `localStorage.sebaEntreprise` (`{ nom: S.nom, ... }`), sans échappement à l'écriture.
- `docs/clients.html:274` : `document.getElementById('sidebar-footer').innerHTML = biz.nom + '<br>Compte de démonstration';` — **insertion directe non échappée**, dans le même fichier qui possède pourtant déjà la fonction `esc()` (ligne 286) mais ne l'utilise pas à cet endroit précis.
- `docs/equipe.html:315` : `document.getElementById('sidebar-footer').innerHTML = biz.nom + '<br>Compte de démonstration';` — identique, et ce fichier ne possède même pas de fonction `esc()`.

C'est un vecteur d'injection HTML/JS réel dans le compte de l'utilisateur (self-XSS aujourd'hui, car les données ne transitent que par le `localStorage` du même navigateur) — mais qui **devient un risque multi-utilisateur** dès que `companies.name` sera effectivement lu depuis Supabase et affiché pour d'autres comptes/rôles (ex : un futur back-office admin, une future fonctionnalité d'équipe partagée) — direction explicitement envisagée dans `ARCHITECTURE-V2.md`.

### 3.2 Aucune fonction ne vérifie une deuxième fois `auth.uid()` côté client avant un appel RPC
Confirmé par grep exhaustif : un seul call site RPC existe dans tout `docs/` (`docs/onboarding.html:347`, via `docs/auth.js:129` comme unique passerelle). Ce point précis est donc sain — pas de dispersion des appels RPC. Le vrai filet de sécurité reste (à raison) les policies RLS côté serveur, pas une vérification côté client — cohérent avec ce qui est déjà écrit dans `ARCHITECTURE-MODULAIRE.md` section C.

### 3.3 Aucune fuite de secret ou de token en `console.log`
Grep exhaustif de `console.log/warn/error/debug` sur tout `docs/*.js` : 5 occurrences seulement, aucune n'affiche d'email, de mot de passe, de token ou de clé API. Point propre, à noter positivement.

### 3.4 `JSON.parse(localStorage.getItem(...))` incohérent — certains sites protégés, d'autres non
14 fichiers font `JSON.parse(localStorage.getItem('sebaEntreprise') ...)`. La moitié l'enveloppe dans un `try/catch` (`sidebar.js:85`, `dashboard.html:1320`, `factures.html:158/292`, `devis.html:292`, `pdf-generator.js:65`, `historique.html:209`), l'autre moitié **ne le fait pas** : `docs/clients.html:271`, `docs/equipe.html:314`, `docs/contentieux-recouvrement.html:96`, `docs/planning.html:394`, `docs/studio-factures.html:127`, `docs/trava-dechets.html:197`, `docs/prevention-risques.html:143`. Un `localStorage.sebaEntreprise` corrompu (édité manuellement dans les devtools, ou écrit par une version antérieure du code avec un format différent) ferait planter le script de ces pages avec une exception JS non interceptée — pas une injection au sens strict (JSON.parse ne peut pas exécuter de code), mais une page qui casse net au lieu de se dégrader proprement.

### 3.5 Aucun SRI (Subresource Integrity) sur les scripts CDN
Tous les `<script src="https://cdn...">`/`<link href="https://cdn...">` (D3, SortableJS, PapaParse, html2pdf, Leaflet, Supabase SDK, three.js, Sentry, OneSignal, Stripe) sont chargés sans attribut `integrity`/`crossorigin`. Si un de ces CDN est compromis, le script injecté s'exécute avec les pleins pouvoirs de la page (accès à `localStorage`, aux tokens de session, au DOM) — risque de chaîne d'approvisionnement classique, jamais mitigé ici.

---

## 4. Compatibilité écosystème (migration vers `docs/src/`)

### 4.1 Chaque page HTML référence les scripts partagés par chemin relatif plat
Comptage exact des `<script src="...">` **relatifs, même dossier** à travers tout `docs/*.html` :

| Fichier référencé | Nombre de pages qui le chargent ainsi |
|---|---|
| `theme.js` | 11 |
| `seba-data.js` | 11 |
| `auth.js` | 6 |
| `sentry-init.js` | 3 |
| `animations-vitrine.js` | 3 |
| `analytics-init.js` | 3 |
| `stripe-service.js` | 2 |
| `email-service.js` | 2 |
| `businessTypes.js` | 2 |
| `widgets.js`, `sidebar.js`, `push-init.js`, `pdf-generator.js`, `logger.js`, `import-export.js` | 1 chacun |

**Conséquence directe** : déplacer ne serait-ce que `auth.js` vers `docs/src/modules/auth-module.js` (comme proposé dans `ARCHITECTURE-MODULAIRE.md`) casse **6 pages d'un coup** si les balises `<script src="auth.js">` ne sont pas toutes mises à jour simultanément — pas de redirection automatique possible (fichiers statiques, pas de serveur applicatif). C'est une migration "tout ou rien" par fichier déplacé, pas un renommage progressif sans risque. À traiter fichier par fichier avec une vérification systématique (`grep -rn 'src="auth.js"' docs/*.html` avant/après chaque déplacement), jamais en bloc.

### 4.2 Modules ES natifs (`type="module"`) changent la portée globale
Le brief `ARCHITECTURE-MODULAIRE.md` propose `<script type="module">`. Point de compatibilité réel : un script chargé en `type="module"` a un scope de module isolé — il **n'attache plus automatiquement ses fonctions sur `window`** comme le fait aujourd'hui chaque fichier actuel (`window.sebaAuth = {...}`, etc.). Toute page qui appelle aujourd'hui `window.sebaAuth.signUp(...)` depuis un `<script>` classique (non-module) inline continuerait de fonctionner **uniquement si le module concerné continue explicitement d'assigner `window.sebaAuth = ...`** en plus d'exporter ses fonctions — sinon la bascule vers ES modules casse silencieusement tout appelant non encore migré lui-même en module. Migration à faire module par module avec ce pont de compatibilité explicite, pas en un seul commit global.

---

## 5. Tableau de bord des risques

| Priorité | Localisation | Risque | Impact | Solution proposée |
| :--- | :--- | :--- | :--- | :--- |
| **CRITIQUE** | `docs/clients.html:274`, `docs/equipe.html:315` | Injection HTML/JS via `biz.nom` inséré en `innerHTML` sans échappement, alors que la donnée vient d'un champ texte libre (`onboarding.html:189`, 60 caractères, aucun filtrage) | Self-XSS aujourd'hui (données mono-navigateur) ; devient un XSS stocké multi-utilisateur dès que `companies.name` sera lu depuis Supabase pour d'autres vues/rôles | Utiliser la fonction `esc()` déjà existante (`clients.html:286`) à ces 2 emplacements ; en profiter pour centraliser `esc()` dans un seul module partagé plutôt que 3 copies |
| **CRITIQUE** | `supabase-schema.sql:141-178` (`profiles`, `companies`) | Aucune policy RLS `UPDATE`/`DELETE` — un utilisateur ne peut pas corriger ou supprimer ses propres données de profil/entreprise via l'API standard | Bloque une fonctionnalité légitime aujourd'hui ; risque qu'une policy "corrective" écrite dans l'urgence plus tard soit trop permissive | Ajouter les 4 policies déjà rédigées dans `ARCHITECTURE-V2.md` section 1 (`profiles_update`, `profiles_delete`, `companies_update`, `companies_delete`) |
| **ÉLEVÉ** | `docs/seba-data.js:110` (`pull()`) | `if (!res.ok) return null` — confond "compte vide", "429 rate-limit" et "500 erreur serveur" | Un utilisateur avec des données réelles peut voir un dashboard vide lors d'une panne/rate-limit transitoire, sans message d'erreur | Distinguer les codes HTTP ; afficher un état "erreur de synchronisation, réessai en cours" plutôt qu'un état vide silencieux |
| **ÉLEVÉ** | `docs/seba-data.js:120-129` (`_push()`) | Échec réseau avalé silencieusement, aucun retry automatique si l'utilisateur ne modifie plus rien ensuite | Perte de données silencieuse côté serveur (le cache local reste correct mais désynchronisé, sans que l'utilisateur le sache) | Ajouter un retry avec backoff, ou au minimum un indicateur visuel de synchronisation en échec |
| **MOYEN** | `ai-assistant.js:29`, `email-service.js:14`, `push-init.js:16`, `widgets.js:1052`, `seba-data.js:62` | Fonction `sessionBearer()` dupliquée à l'identique dans 5 fichiers, connaissance en dur du format interne `sb-*-auth-token` de supabase-js | Une future montée de version du SDK Supabase change ce format → 5 points de rupture silencieuse simultanés | Centraliser dans `docs/auth.js` (déjà le point d'entrée Supabase unique) en exposant `window.sebaAuth.getBearerToken()`, supprimer les 4 autres copies |
| **MOYEN** | `docs/clients.html:271`, `equipe.html:314`, `contentieux-recouvrement.html:96`, `planning.html:394`, `studio-factures.html:127`, `trava-dechets.html:197`, `prevention-risques.html:143` | `JSON.parse(localStorage.getItem('sebaEntreprise') ...)` sans `try/catch`, contrairement à 6 autres fichiers qui, eux, le protègent | Un `localStorage` corrompu (édition manuelle, ancien format) fait planter la page entière avec une exception non interceptée | Uniformiser avec le pattern déjà utilisé ailleurs dans le même repo (`try { ... } catch(e) { ... }`) |
| **MOYEN** | Tous les `<script src="https://cdn...">` du repo (D3, SortableJS, PapaParse, html2pdf, Leaflet, Supabase SDK, three.js, Sentry, OneSignal, Stripe) | Aucun attribut `integrity`/`crossorigin` (pas de SRI) | Un CDN compromis exécute du code arbitraire avec accès complet à la page (tokens, localStorage, DOM) | Ajouter les hachages SRI disponibles pour les libs versionnées (D3, SortableJS, PapaParse, html2pdf, Leaflet) ; les SDK propriétaires (Supabase, Stripe, Sentry, OneSignal) n'en fournissent généralement pas — accepter le risque résiduel pour ceux-là ou vendoriser |
| **MOYEN** | Toutes les pages référençant `theme.js`/`seba-data.js`/`auth.js` (11/11/6 pages) | Chemins relatifs plats — la migration vers `docs/src/` proposée dans `ARCHITECTURE-MODULAIRE.md` casse toutes les pages d'un coup si non faite atomiquement, fichier par fichier | Migration "tout ou rien" par fichier déplacé, risque de régression large si mal séquencée | Migrer un seul fichier partagé à la fois, avec un grep de vérification systématique avant/après (déjà décrit en section 4.1) |
| **MOYEN** | Bascule `<script type="module">` proposée (`ARCHITECTURE-MODULAIRE.md`) | Un module ES n'attache plus automatiquement ses exports sur `window` — toute page non encore migrée qui appelle `window.sebaAuth.xxx` casserait silencieusement | Régression large et difficile à détecter sans test systématique de chaque page | Chaque module migré doit explicitement continuer à faire `window.sebaAuth = {...}` en plus de ses `export`, tant que toutes les pages appelantes n'ont pas basculé elles aussi |
| **FAIBLE** | `docs/config.js:21` (gitignoré) | `stripePaymentLink` pointe vers un lien de test (`buy.stripe.com/test_...`) — pas un vrai risque de sécurité, mais un oubli de configuration si jamais copié tel quel en prod | Paiements de test acceptés par erreur en production si `config.js` de prod n'est pas correctement distinct | Vérifier explicitement au déploiement prod qu'aucune valeur `test_` ne subsiste dans la config réellement utilisée |
| **FAIBLE** | Tous les fichiers | Aucune fuite de secret/token détectée dans les `console.log` (section 3.3), aucune dispersion des appels RPC (section 3.2) — points positifs, à ne pas casser lors de la refonte | — | Préserver ces deux propriétés comme contraintes de non-régression pendant la migration modulaire |

---

## Ce que cet audit ne couvre pas

- Pas de test d'intrusion réel (pas d'exécution effective d'un payload XSS contre le site déployé) — les findings ci-dessus sont établis par lecture de code, pas par exploitation.
- Pas d'audit des ~1558 couleurs hex en dur déjà connues et hors sujet ici (voir `tools/check-design-system.js --full`, mémoire projet existante).
- Pas de relecture ligne à ligne des ~30 pages "gadget" du dossier `docs/` (bfr-predictif.html, haversine-engine.html, etc.) — seuls les patterns transversaux (localStorage, innerHTML, script src) ont été vérifiés par grep exhaustif sur l'ensemble du dossier, pas une lecture complète de chacune.
