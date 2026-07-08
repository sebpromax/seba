# 🛠️ SPÉCIFICATION TECHNIQUE ET COMPORTEMENTALE — TUNNEL FLASH V1

*Rédigé le 2026-07-08. Trois modèles interrogés **indépendamment** (aucun n'a vu la réponse des autres), chacun exclusivement sur son domaine, avec pour projection commune un tunnel flash en 3 étapes (Création de compte → Segmentation Métier → Dashboard) avec configuration asynchrone du reste. Reproduction brute, sans résumé ni lissage.*

---

## [EXIGENCE GEMINI - CPO] : LA PSYCHOLOGIE ET LE TIME-TO-VALUE (TTV)

### 1. DÉTAIL DE L'ÉCRAN 1 (Capture Lead)

L'objectif est de rassurer un patron de PME face à l'engagement, au temps et aux coûts. La formulation doit être directe, axée sur le bénéfice et la simplicité, avec des éléments de réassurance visuellement distincts et bien placés.

**Titre de l'écran :**
- **Formulation exacte :** « **Simplifiez la gestion de votre entreprise. Dès aujourd'hui.** »
- **Raisonnement :** concis, actif, bénéfice principal + notion d'immédiateté, sans jargon.

**Labels des champs :**
- **E-mail** — Label : « Adresse e-mail professionnelle » — Placeholder : « exemple@monentreprise.fr » (le mot « professionnelle » encourage un email d'entreprise, signal de sérieux).
- **Mot de passe** — Label : « Créez votre mot de passe » — Placeholder : « Minimum 8 caractères » — Texte d'aide (`--t3`) : « Un mot de passe sûr pour une tranquillité d'esprit. »
- **Nom de l'entreprise** — Label : « Nom de votre entreprise » — Placeholder : « Ex: Nettoyage Pro Services ».

**CTA :** « **Démarrer mon essai gratuit** » (le verbe « Démarrer » est incitatif, « essai gratuit » est un levier de conversion PME).

**Emplacement des éléments de réassurance :**
1. Sous le titre, `--font-size-lg`, couleur `--t2` : « Création de compte rapide et sans engagement. »
2. Juste sous le bouton CTA, centré, `--font-size-sm`, couleur `--t2`/`--t3` : « Pas de carte bancaire requise. Moins de 15 secondes pour commencer. » (avec « Moins de 15 secondes » en accent blanc gras).

```html
<h1 style="font-size:var(--font-size-2xl);color:white;text-align:center;">Simplifiez la gestion de votre entreprise. Dès aujourd'hui.</h1>
<p style="font-size:var(--font-size-lg);color:var(--t2);text-align:center;margin-top:var(--spacing-4);">Création de compte rapide et sans engagement.</p>
<!-- formulaire -->
<button type="submit" style="background-color:var(--em);color:var(--ink);padding:var(--spacing-4) var(--spacing-6);border-radius:var(--r);font-size:var(--font-size-lg);font-weight:bold;width:100%;box-shadow:var(--shadow-glow);">Démarrer mon essai gratuit</button>
<p style="font-size:var(--font-size-sm);color:var(--t2);text-align:center;margin-top:var(--spacing-3);">Pas de carte bancaire requise. <span style="font-weight:bold;color:white;">Moins de 15 secondes</span> pour commencer.</p>
```

**Implémentation JS :** soumission du formulaire → création de compte Supabase Auth → mise à jour de l'objet global `S` → `goStep(1, true)` → `StateRecovery.save(0)`.

### 2. DESIGN DES MESSAGES DE RELANCE (Abandon de tunnel)

Si l'utilisateur quitte à l'étape 2 (Segmentation Métier), le premier email doit être incitatif, personnalisé, et rassurer sur la facilité de reprise.

- **Expéditeur :** `Seba <noreply@seba.io>`
- **Objet :** « **[Nom de l'entreprise], votre essai Seba vous attend ! Une gestion simplifiée en 2 min.** » (personnalisation forte + rappel + réassurance de temps)
- **Hook (corps de l'email) :**
  > Bonjour **[Nom de l'entreprise]**,
  > Nous avons remarqué que vous avez commencé à simplifier la gestion de votre entreprise avec Seba ! Vous étiez sur le point de choisir votre métier pour personnaliser votre expérience.
  > Peut-être avez-vous été interrompu, ou aviez-vous une question ? Quoi qu'il en soit, sachez que vous êtes à un pas d'accéder à votre tableau de bord Seba, prêt à transformer votre quotidien : **devis rapides, plannings optimisés, factures automatisées**, et bien plus.
  > Reprendre est un jeu d'enfant et ne prendra que quelques secondes.
- **CTA :** « **Terminer ma configuration Seba** » → `https://app.seba.io/onboarding.html` (grâce à `StateRecovery.save(toIdx)` + détection de `_currentStep`, l'utilisateur est automatiquement redirigé vers l'étape où il s'est arrêté).
- Gabarit HTML complet (header sombre `#0b0f19`, bouton CTA `#00ff88`/`#0a0a0c`, footer avec lien de désinscription) fourni en annexe technique par l'agent — structure prête à intégrer dans un service d'envoi transactionnel.

### 3. LE PROTOCOLE DE LA CHECKLIST POST-DASHBOARD

Une « carte de démarrage » s'affiche dès l'arrivée sur le dashboard :
- **Titre :** « 🎉 Votre Lancement Seba : Premiers Pas Réussis ! » — **Sous-titre :** « Débloquez le plein potentiel de Seba en quelques minutes. »
- **Barre de progression** : `--em` pour la partie complétée, `--t3` pour le fond, texte « Progression : X% complété ».

**Tâche 1 — Identité Visuelle** (🎨 Personnalisez votre identité visuelle) : bénéfice mis en avant (« devis et factures qui reflètent le professionnalisme »). État initial → icône neutre + CTA « Ajouter mon logo et mes couleurs ». Après complétion → bordure `--shadow-glow`, icône ✅, message « Félicitations ! Votre entreprise a du style. ✨ ».

**Tâche 2 — Catalogue de Tarifs** (💰 Créez votre catalogue de services) : bénéfice (« devis et factures en un éclair, plus d'erreurs »). Complétion déclenchée après ajout d'au moins 3 services, ou validation manuelle.

**Protocole d'ensemble :** module `OnboardingChecklist.js`, `init()` lit les flags (`onboarding_visual_identity_done`, `onboarding_price_catalogue_done`) depuis une table `user_settings`, calcule `_currentProgress = (task1?50:0)+(task2?50:0)`, met à jour la barre + les cartes. À 100%, la carte se transforme en message de félicitations global et suggère d'explorer des fonctionnalités avancées (inviter des employés). Bouton « Masquer cette section » optionnel avec confirmation dissuasive (« Certaines fonctionnalités clés ne seront pas optimisées sans ces étapes »).

---

## [EXIGENCE MISTRAL - LEAD UI/UX] : LE DESIGN SYSTEM ET LES ÉTATS D'INTERFACE

### 1. ARCHITECTURE DES COMPOSANTS FLATS

```css
:root{
  --field-padding-v:var(--spacing-5); /* 20px */
  --field-padding-h:var(--spacing-6); /* 24px */
  --field-height:48px;
  --field-radius:var(--rs); /* 8px */
  --field-border:1px solid var(--bd); /* rgba(255,255,255,.1) */
  --label-font-size:var(--font-size-sm); /* .84rem */
  --label-margin-bottom:var(--spacing-3); /* 12px */
  --input-bg:rgba(255,255,255,.05);
  --btn-primary-height:44px;
  --btn-primary-padding-h:var(--spacing-7); /* 32px */
  --card-bg:var(--ink-r); /* #0b0f19 */
  --card-radius:var(--r); /* 10px */
  --card-padding:var(--spacing-7); /* 32px */
  --card-gap:var(--spacing-6); /* 24px */
}
.onboarding-form{display:flex;flex-direction:column;gap:var(--spacing-6);max-width:560px;margin:0 auto;}
.onboarding-form .form-group{display:flex;flex-direction:column;gap:var(--label-margin-bottom);}
.onboarding-form label{font-size:var(--label-font-size);color:white;font-weight:500;}
.onboarding-form input,.onboarding-form select{height:var(--field-height);padding:var(--field-padding-v) var(--field-padding-h);background:var(--input-bg);border:var(--field-border);border-radius:var(--field-radius);color:white;font-size:var(--font-size-base);transition:border-color 200ms ease;}
.onboarding-form input:focus{outline:none;border-color:var(--em);box-shadow:0 0 0 2px rgba(0,255,136,.2);}
.onboarding-form .btn{height:var(--btn-primary-height);padding:0 var(--btn-primary-padding-h);background:var(--em);color:var(--ink);border:none;border-radius:var(--rs);font-size:var(--font-size-base);font-weight:500;}
.onboarding-form .btn:hover{background:#00e67a;}
.onboarding-form .btn:disabled{background:var(--t3);cursor:not-allowed;}
.onboarding-card{background:var(--card-bg);padding:var(--card-padding);border-radius:var(--card-radius);display:flex;flex-direction:column;gap:var(--card-gap);}
```

### 2. ÉTATS DE CHARGEMENT ET MICRO-ANIMATIONS

Transition étape 2 → Dashboard : **800ms au total** (520ms animation de sortie + 280ms stabilisation/chargement), même easing `cubic-bezier(.4,0,.2,1)` que l'existant.

```css
.transition-step2-to-dashboard{transition:opacity 520ms cubic-bezier(.4,0,.2,1),transform 520ms cubic-bezier(.4,0,.2,1);opacity:0;transform:translateX(20px);}
.dashboard-skeleton{position:absolute;inset:0;background:var(--ink);z-index:100;display:flex;flex-direction:column;gap:var(--spacing-8);padding:var(--spacing-8);}
.skeleton-card{background:var(--card-bg);border-radius:var(--card-radius);padding:var(--card-padding);overflow:hidden;}
.skeleton-line{height:20px;background:linear-gradient(90deg,rgba(255,255,255,.1) 25%,rgba(255,255,255,.05) 50%,rgba(255,255,255,.1) 75%);background-size:200% 100%;animation:skeleton-loading 1.5s ease-in-out infinite;}
.skeleton-line.large{width:60%;height:24px;} .skeleton-line.medium{width:40%;height:16px;} .skeleton-line.small{width:25%;height:16px;}
@keyframes skeleton-loading{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
.loader-main{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;border:4px solid rgba(0,255,136,.2);border-top-color:var(--em);border-radius:50%;animation:spin 800ms linear infinite;}
@keyframes spin{to{transform:translate(-50%,-50%) rotate(360deg);}}
```

Comportement JS proposé : à `goStep(2,...)`, l'étape sortante s'anime (translateX -20px + fade), le skeleton s'affiche après 520ms, puis à 520+280ms le skeleton est retiré et le dashboard apparaît.

### 3. DESIGN DE LA CONFIGURATION ASYNCHRONE

Barre de complétion en position fixe, bas d'écran :

```css
.profile-completion{position:fixed;bottom:var(--spacing-6);left:50%;transform:translateX(-50%);width:min(90vw,480px);background:var(--card-bg);border-radius:var(--card-radius);padding:var(--spacing-4) var(--spacing-5);display:flex;align-items:center;gap:var(--spacing-4);box-shadow:var(--shadow-md);z-index:1000;}
.completion-bar{flex:1;height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;}
.completion-fill{height:100%;background:var(--em);width:0%;transition:width 500ms cubic-bezier(.4,0,.2,1);}
.completion-text{font-size:var(--font-size-xs);color:var(--t2);white-space:nowrap;}
/* Etat d'avertissement non-bloquant a 75% restant (pas 75% complete) */
.profile-completion.warning{background:rgba(255,152,0,.1);border:1px solid rgba(255,152,0,.3);}
.completion-fill.warning{background:#ff9800;}
.profile-completion.critical{background:rgba(255,82,82,.1);border:1px solid rgba(255,82,82,.3);}
.completion-fill.critical{background:#ff5252;}
```

Textes dynamiques par palier (0/50/75/100%) : « Complétez votre profil pour débloquer toutes les fonctionnalités » → « Presque terminé ! » → « Quelques détails et vous êtes prêt » → « Profil complet ✓ ». Persistance de la progression via upsert sur `seba_state` (`onboarding_progress`, `updated_at`).

---

## [EXIGENCE GROQ - CTO / ARCHITECTE] : MODÉLISATION ET TRANSITION TECHNIQUE

### 1. MODÈLE DE DONNÉES SUPABASE LOCALISÉ

```sql
CREATE TABLE users_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  devise character varying(3) NOT NULL CHECK (devise IN ('EUR', 'USD', 'GBP', ...)),
  timezone character varying(50) NOT NULL CHECK (timezone IN ('Europe/Paris', 'America/New_York', ...)),
  taxe_type character varying(20) NOT NULL CHECK (taxe_type IN ('TVA', 'TTC', ...)),
  CONSTRAINT users_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX users_profiles_user_idx ON users_profiles (user_id);

CREATE POLICY users_profiles_select ON users_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY users_profiles_insert ON users_profiles FOR INSERT USING (auth.uid() = user_id);
CREATE POLICY users_profiles_update ON users_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY users_profiles_delete ON users_profiles FOR DELETE USING (auth.uid() = user_id);
```

### 2. ABSTRACTION DU TEXTE (ARCHITECTURE I18N)

```json
// fr.json
{
  "titre": "Bienvenue sur Seba",
  "soustitre": "Créer votre compte",
  "bouton": "Créer",
  "erreur": "Erreur lors de la création du compte"
}
```
```json
// en.json
{
  "titre": "Welcome to Seba",
  "soustitre": "Create your account",
  "bouton": "Create",
  "erreur": "Error creating account"
}
```

Fonction de mapping vanilla proposée :
```javascript
function traduire(cle, langue) {
  const fichier = langue === 'fr' ? 'fr.json' : 'en.json';
  fetch(fichier)
    .then(response => response.json())
    .then(data => {
      const valeur = data[cle];
      document.querySelector(`[data-traduire="${cle}"]`).textContent = valeur;
    });
}
```

### 3. LOGIQUE SÉQUENTIELLE DU SCRIPT ONBOARDING.JS

```javascript
let _currentStep = 0;
const S = {};

function goStep(toIdx, forward) {
  const element = document.querySelector(`[data-step="${_currentStep}"]`);
  element.classList.remove('active');
  element.classList.add('hidden');
  const nextElement = document.querySelector(`[data-step="${toIdx}"]`);
  nextElement.classList.remove('hidden');
  nextElement.classList.add('active');

  _currentStep = toIdx;

  if (forward) {
    fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(S),
    })
      .then(response => response.json())
      .then(data => { /* traiter la reponse */ })
      .catch(error => { /* gerer les erreurs */ });
  }
}

S.langue = 'fr';
S.devise = 'EUR';
S.timezone = 'Europe/Paris';
S.taxe_type = 'TVA';

document.querySelector(`[data-step="1"]`).addEventListener('animationend', () => {
  // Reconstruire la liste des devises
});
document.querySelector(`[data-step="2"]`).addEventListener('animationend', () => {
  // Rafraichir l'apercu des taxes
});

goStep(0, true);
```
