# 🗺️ COMPARATIF-PARCOURS : "FLASH & DROP" (V1)

*Rédigé le 2026-07-08. Quatre contributeurs, chacun cantonné à sa TO-DO list exclusive : Gemini (CPO), Mistral (Lead UI/UX) et Groq (CTO) interrogés indépendamment via API (aucun n'a vu la réponse des autres) ; Claude Code (section 4) planifie directement l'implémentation, sans appel externe — c'est le rôle qui lui était assigné dans le brief. Reproduction brute des 3 rapports API, pas de lissage entre eux.*

---

## 1. TO-DO LIST : GEMINI (Directeur Produit / CPO Élite)

### TASK 1.1 — Impact psychologique de la suppression du bouton "Suivant"

La suppression du bouton "Suivant" à l'étape 2 est un **accélérateur de conversion net**, à condition que l'affordance de progression par clic sur les cartes soit sans équivoque. Deux effets en tension :

**Effet positif** : réduction de friction cognitive et motrice (le choix du secteur *est* l'action de progression), feedback immédiat (transition instantanée vers l'écran 3 qui renforce le sentiment d'efficacité "FLASH & DROP"), logique naturelle après la saisie du nom d'entreprise.

**Risque de confusion** : violation du modèle mental habituel (bouton "Suivant" attendu après une saisie), manque d'affordance si les cartes ne semblent pas cliquables, peur de la soumission prématurée pour un artisan qui craint de ne pas pouvoir revenir en arrière.

**Mesures prioritaires pour garantir l'accélération** :
1. Microcopie explicite au-dessus des cartes : « Sélectionnez votre activité pour continuer : »
2. États de survol visibles (changement de fond, bordure, `transform:translateY(-2px)`), curseur `pointer`
3. Effet de clic confirmé (`transform:scale(0.98)`) avant la transition vers l'écran 3

### TASK 1.2 — Copywriting séquentiel des 3 messages de chargement (800ms chacun)

*(Pré-requis technique mentionné par l'agent : nécessite une table `companies` avec `name`/`sector` pour personnaliser les messages via `S.companyName`/`S.sector` — schéma proposé par l'agent en aparté, voir la note de convergence en fin de document.)*

1. **0–800ms** : « Initialisation de votre espace [nom entreprise], optimisé pour l'[secteur]... »
2. **800–1600ms** : « Vos modules clients, devis & planning s'activent pour vous. »
3. **1600–2400ms** : « Tableau de bord prêt ! Votre gestion simplifiée est à portée de clic. »

### TASK 1.3 — Première action prioritaire sur le Dashboard (éviter la page blanche)

**Ajouter son premier client.** C'est le point de départ logique de toute entreprise de services, et cela peuple immédiatement le dashboard avec des données réelles.

Implémentation : un encart de bienvenue centré (`background:var(--ink-r); border:1px solid var(--bd); border-radius:var(--r); padding:var(--spacing-8)`), titre « Bienvenue sur Seba, [Nom Entreprise] ! », bouton primaire « Ajouter mon premier client » (`background:var(--em); color:var(--ink)`) ouvrant une modale minimaliste (nom, prénom, téléphone optionnel, email optionnel, adresse optionnelle). Une fois le client ajouté, l'encart se transforme en suggestion de prochaine étape (« Créez votre première intervention ou devis pour lui »).

---

## 2. TO-DO LIST : MISTRAL (Directeur Artistique / Lead UI/UX)

### TASK 2.1 — Design System des cartes de secteur (états CSS exacts)

```css
:root{
  --sector-bg-idle:var(--ink);
  --sector-bg-hover:color-mix(in srgb, var(--ink) 85%, white 15%);
  --sector-bg-active:color-mix(in srgb, var(--ink) 70%, white 30%);
  --sector-border-idle:1px solid var(--bd);
  --sector-border-hover:1px solid var(--em);
  --sector-border-active:2px solid var(--em);
}
.sector-card{background:var(--sector-bg-idle);border:var(--sector-border-idle);border-radius:var(--r);padding:var(--spacing-6);min-height:180px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:var(--spacing-3);transition:all .3s cubic-bezier(.25,.8,.25,1);cursor:pointer;}
.sector-card:hover{background:var(--sector-bg-hover);border:var(--sector-border-hover);}
.sector-card:active{background:var(--sector-bg-active);border:var(--sector-border-active);transform:scale(.98);}
.sector-card.selected{background:color-mix(in srgb, var(--em) 15%, var(--ink) 85%);border:2px solid var(--em);box-shadow:0 0 0 2px color-mix(in srgb, var(--em) 30%, transparent 70%);}
```

Comportement JS : le clic retire `.selected` de toutes les cartes, l'ajoute à la carte cliquée, enregistre `S.sector = card.dataset.sector`, puis appelle `goStep(2, true)` + `StateRecovery.save(2)` — **sans bouton intermédiaire**, conforme à la règle d'or de l'écran 2.

### TASK 2.2 — Cinématique du Skeleton Screen (étape 3)

Dashboard flouté en arrière-plan (`filter:blur(8px) grayscale(30%); opacity:.7`) + conteneur centré avec barre de progression fine (`height:4px; background:var(--t3)`, remplissage `linear-gradient(90deg, var(--em), transparent)`) + messages qui fondent en séquence (`opacity 0→1`, `translateY(10px)→0`, 400ms). Le remplissage de la barre progresse par palier synchronisé aux messages (25/50/75/100% sur les 4 messages), redirection vers le dashboard réel ~1.5s après le dernier message.

### TASK 2.3 — Affichage de la complexité du mot de passe

**Décision tranchée : validation native invisible + indice textuel minimaliste, PAS de jauge visuelle.** Raison : une jauge ajoute de la friction (surtout mobile) sans bénéfice réel puisque Supabase Auth gère déjà la robustesse côté serveur. Un seul indice discret sous le champ (`color:var(--t3); font-size:var(--font-size-xs)`) : « 8 caractères minimum, 1 majuscule, 1 chiffre », avec `pattern` HTML5 natif sur l'input (`required minlength="8"`).

---

## 3. TO-DO LIST : GROQ (CTO / Principal Architect)

### TASK 3.1 — Schéma Payload (tables `profiles` + `companies`, une seule opération)

```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    company_name VARCHAR(255) NOT NULL,
    sector VARCHAR(50) NOT NULL CHECK (sector IN ('Nettoyage', 'Conciergerie', 'Artisanat')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX profiles_user_idx ON profiles (user_id);
CREATE INDEX companies_profile_idx ON companies (profile_id);

CREATE OR REPLACE FUNCTION create_profile_and_company(
    _user_id UUID, _company_name VARCHAR(255), _sector VARCHAR(50), _name VARCHAR(255)
) RETURNS VOID AS $$
BEGIN
    INSERT INTO profiles (user_id, company_name, sector)
    VALUES (_user_id, _company_name, _sector)
    RETURNING id INTO _profile_id;

    INSERT INTO companies (profile_id, name) VALUES (_profile_id, _name);
END;
$$ LANGUAGE plpgsql;
```

> ⚠️ **Bug réel repéré dans cette réponse, non corrigé ici (reproduction brute)** : la fonction utilise `_profile_id` sans jamais le déclarer (`DECLARE _profile_id UUID;` manquant) — ne compilera pas tel quel dans Postgres. Aucune policy RLS n'est non plus définie pour `profiles`/`companies` (contrairement au schéma que Gemini a proposé en aparté pour sa propre tâche, qui inclut lui les 4 policies `auth.uid() = user_id`). À corriger avant toute exécution réelle.

### TASK 3.2 — Validation email/mot de passe en JS vanilla

```javascript
function validateEmail(email) {
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
}
function validatePassword(password) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(password);
}
```

### TASK 3.3 — Injection du nom de secteur dans les messages de chargement

```javascript
function injectSectorText(sector) {
    const messages = [
        `Configuration de votre entreprise de ${sector} en cours...`,
        `Mise en place de votre tableau de bord ${sector}...`,
        `Chargement des données de votre entreprise de ${sector}...`
    ];
    let index = 0;
    const intervalId = setInterval(() => {
        document.getElementById('message').textContent = messages[index];
        index = (index + 1) % messages.length;
    }, 800);
    return intervalId;
}
```

---

## 4. TO-DO LIST : CLAUDE CODE (L'Exécuteur Technique)

*Section rédigée directement — pas un appel API, c'est le rôle assigné dans le brief.*

### TASK 4.1 — Arborescence de `docs/onboarding.html` : passage de 11 à 3 écrans

**État actuel (vérifié dans le code)** : 11 `<div class="step-container" id="step-N">` (N=0 à 10) à l'intérieur de `.ob-steps-wrap`, basculés par `goStep(toIdx, forward)` qui anime des **styles inline** (`translateX`/`opacity`, ~520ms) plutôt qu'un simple toggle de classe — plus une chaîne de hooks par index dispersés dans `goStep` (`if(toIdx===3) renderOrientations()`, etc.) et un objet global `S` qui accumule tous les champs.

**Plan de bascule vers 3 écrans :**
1. Remplacer les 11 `step-container` par exactement 3 `<section class="flash-step" id="fstep-1|2|3">`, plus la redirection finale vers `dashboard.html`.
2. Remplacer le mécanisme d'animation par styles inline par un simple toggle de classe `.flash-step.hidden{display:none}` — inutile de conserver la logique de glissement latéral (`translateX`) conçue pour un long tunnel séquentiel ; les transitions spécifiées par Mistral (fade, skeleton) suffisent pour 3 écrans.
3. **Conserver** les noms `_currentStep`, `S`, `StateRecovery` (aucune autre page n'y fait référence — vérifié par grep sur tout `docs/`) : renommer n'apporterait rien et créerait un diff plus large pour rien.
4. **Supprimer physiquement** (pas seulement cacher) le HTML des anciens écrans 2-3 (sous-taxonomie détaillée), 5 (identité visuelle), 6 (tarifs détaillés), 7 (horaires) — leur collecte de champs migre vers la checklist post-dashboard (hors périmètre de ce document, déjà spécifiée dans `SPECIFICATION-TECHNIQUE-V1.md`). Les laisser en DOM caché serait de la dette morte, pas une simplification.
5. Le nouvel écran 2 (Segmentation) absorbe le champ "nom entreprise" (ex-écran 4) et les 3 cartes de secteur (version compressée de l'ex-écran 2 à 9 tuiles) — cohérent avec `TASK 3.1` qui ne modélise que 3 valeurs de secteur (Nettoyage/Conciergerie/Artisanat), un choix plus restrictif que la taxonomie actuelle à 9 secteurs : **point à trancher avec le fondateur avant implémentation**, ce document ne tranche pas si la segmentation flash doit se limiter à 3 secteurs ou couvrir les 9 existants sous une grille plus dense.

### TASK 4.2 — Nettoyage du CSS obsolète sans corrompre les composants partagés

**Bonne nouvelle vérifiée dans le code** : `onboarding.html` ne charge **pas** `pro-global.css` — son `<style>` est entièrement autonome (confirmé par grep). Le rayon d'impact d'un nettoyage CSS ici est donc **strictement local à ce fichier**, contrairement à un chantier touchant `pro-global.css` ou `widgets.js` (qui nécessiterait un avertissement de blast radius explicite selon `CLAUDE.md`).

**Stratégie concrète :**
1. Après suppression du HTML des écrans obsolètes (TASK 4.1), lister les sélecteurs CSS qui ne sont plus référencés par AUCUN élément restant (`grep -o 'class="[^"]*"' onboarding.html` croisé avec les règles du `<style>`) — attention particulière aux classes partagées avec les éléments **conservés** (ex. `.ob-right`/`.ob-static-panel`, ajoutés lors du chantier de retrait du globe 3D — ne pas les supprimer par erreur en confondant avec les styles des écrans retirés).
2. Supprimer en un commit séparé de la restructuration HTML, pour pouvoir isoler facilement une régression visuelle à l'un ou l'autre changement (bisect propre).
3. Après nettoyage, faire tourner `node tools/check-design-system.js` (aucune couleur en dur introduite) et `node scripts/qa-visual-regression.js` (pas de régression visuelle sur les baselines existantes) — les deux outils existent déjà dans ce repo depuis un chantier précédent.
4. Ne pas toucher aux fichiers hors `onboarding.html` dans ce chantier : la checklist post-dashboard (qui récupère les champs retirés) est un chantier séparé, déjà cadré dans `SPECIFICATION-TECHNIQUE-V1.md`.

---

## Note de convergence (constat, pas de consensus forcé)

Gemini (TASK 1.2) et Groq (TASK 3.1) ont chacun, indépendamment, proposé un schéma pour une table `companies` — mais avec des designs différents : Gemini la modélise comme une table autonome liée directement à `auth.users` (avec RLS complet), Groq la lie à une table `profiles` intermédiaire (sans RLS, et avec le bug de variable non déclarée signalé ci-dessus). Les deux agents ont indépendamment senti le besoin de cette table pour personnaliser les messages/segmenter les données, mais leurs modélisations divergent — un arbitrage humain est nécessaire avant toute implémentation réelle du schéma.
