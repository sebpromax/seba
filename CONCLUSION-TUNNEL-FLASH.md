# ✅ CONCLUSION — TUNNEL "FLASH & DROP" V1 : DE LA PENSÉE À LA CRÉATION

*2026-07-08. `docs/onboarding.html` réécrit de A à Z (2859 → ~330 lignes), validé localement (desktop + mobile, 0 erreur console, click-through complet jusqu'à la redirection dashboard), puis le résultat RÉEL (pas le plan) a été soumis à une dernière validation croisée Gemini/Mistral/Groq.*

## Ce qui a été construit

- **Écran 1 (Capture)** : email + mot de passe (validation HTML5 native invisible), bouton primaire, réassurance "Sans carte bancaire — Configuration en 30s". Branché sur **`window.sebaAuth.signUp()`** (module déjà existant dans `auth.js`, bascule automatique en mode démo localStorage si Supabase n'est pas configuré).
- **Écran 2 (Segmentation)** : nom d'entreprise + 3 cartes de secteur (Nettoyage & Entretien / Conciergerie & Accueil / Artisans & Maintenance), états `:hover`/`:active`/`.selected` conformes à la spec de Mistral. **Aucun bouton "Continuer"** — le clic sur une carte bascule directement.
- **Écran 3 (Propulsion)** : overlay plein écran, fond flouté, barre de progression, 3 messages de Gemini affichés toutes les 800ms, redirection vers `dashboard.html` à 2400ms.
- Bascule via toggle de classe `.hidden` (pas de styles inline comme l'ancien système), tokens CSS existants réutilisés + quelques nouveaux tokens ajoutés proprement dans `:root` (validé par `tools/check-design-system.js`, 0 violation).

## Ce qui a été volontairement coupé (et pourquoi)

| Retiré | Raison |
|---|---|
| Pays, confirmation mot de passe, téléphone | Hors du tronc commun flash — déplacé en configuration post-dashboard (déjà cadré dans `SPECIFICATION-TECHNIQUE-V1.md`) |
| Panneau de prévisualisation du profil public | Plus rien à prévisualiser (slogan/couleur/services ne sont plus collectés ici) — sa logique dépendait entièrement des écrans retirés |
| Bannière de reprise ("recovery banner") | Disproportionnée pour un tunnel de 3 écrans très rapides ; recommencer coûte un clic |
| GSAP (librairie externe) | Ne servait qu'à l'ancien écran de chargement — remplacé par une barre CSS pure, zéro dépendance externe en plus |
| Recherche floue de métier, 9 secteurs détaillés, tarification par service | Toute la logique de sélection fine de métier disparaît avec les écrans qui la portaient |

`.ob-right`/`.ob-static-panel` (panneau statique remplaçant l'ancien globe 3D) conservés **tels quels**, comme demandé explicitement.

## Bug réel trouvé et corrigé pendant la validation

`#fstep-3{display:flex;...}` (règle par ID) l'emportait sur `.flash-step.hidden{display:none;}` (règle par classe) à cause de la spécificité CSS — l'écran 3 ne se cachait donc jamais vraiment tant qu'on n'avait pas cliqué. Corrigé avec `!important` sur la règle `.hidden`, documenté dans le code. Sans ce test de bout en bout (pas juste une relecture visuelle), ce bug serait passé inaperçu.

## Validation finale croisée (sur le CODE réel, pas sur le plan)

**Convergence indépendante (Gemini + Groq)** : la simulation client-side de la création de compte ne "tient pas la promesse" faite à l'utilisateur — un vrai appel d'authentification est nécessaire. **Implémenté dans la foulée** : `window.sebaAuth.signUp(email, password)` est maintenant réellement appelé (mode démo automatique si Supabase n'est pas configuré), avec état de chargement sur le bouton et gestion d'erreur. Revalidé après coup : 0 erreur, session démo bien enregistrée.

**Point d'attention sur cette validation croisée** : Mistral a signalé "il manque un champ nom d'entreprise" — **c'est une erreur factuelle de sa part**, ce champ existe et est visible dans les captures d'écran qui lui ont été fournies. Signalé ici plutôt que traité comme un vrai gap, pour rester honnête sur la fiabilité de ces validations automatisées : elles restent un outil d'aide à la décision, pas une vérité absolue à appliquer sans relecture humaine.

## Ce qui reste ouvert (décisions humaines, pas techniques)

1. **Nombre de secteurs à l'écran 2** : 3 (implémenté, choix de Groq) vs 9 (taxonomie actuelle du reste du site) — non tranché, signalé dans `COMPARATIF-PARCOURS.md`, toujours en attente d'un arbitrage du fondateur.
2. **Wiring Supabase réel** (au-delà du mode démo) : nécessite `docs/config.js` avec de vraies clés (gitignoré, jamais fourni par moi) — le code est prêt à basculer automatiquement dès que la config existe, aucun changement de code nécessaire de ce côté.
3. **Checklist de configuration post-dashboard** (identité visuelle, tarifs, horaires) — spécifiée dans `SPECIFICATION-TECHNIQUE-V1.md`, pas encore implémentée : c'est la suite logique de ce sprint.
