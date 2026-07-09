# Analyse des angles morts — SEBA au-delà du générique

*Rédigé le 2026-07-09, après lecture directe de `supabase-schema.sql`, `docs-backend.md`, `supabase-functions/{ai-relay,daily-digest,send-email,send-push}.ts` et `agents_config.json` — pas une extrapolation du brief. Les 4 sections ci-dessous répondent point par point aux questions posées, mais s'appuient sur l'état réel du code, qui diverge du brief sur plusieurs points structurants (section 0).*

---

## 0. Cadrage préalable — ce que le brief suppose vs ce qui existe vraiment

Trois corrections factuelles avant d'aller plus loin, parce qu'elles changent la nature des recommandations :

### 0.1 Il n'y a pas encore de tables normalisées en production — un seul blob JSON

Le brief décrit `clients`/`employes`/`devis`/`factures`/`interventions`/`notes` comme "schéma existant" avec des colonnes typées. **C'est le schéma *cible*, pas le schéma *actif*.** `supabase-schema.sql` contient bien ces tables (RLS `auth.uid() = user_id` déjà correctement posée, `client_id`/`devis_id` en clé étrangère — c'est du bon travail), mais sa propre note finale est sans ambiguïté :

> « Le site utilise aujourd'hui la table `seba_state` (blob JSON) via l'adaptateur de `docs/seba-data.js` — c'est la voie déjà branchée. Les tables normalisées 1-5 ci-dessus sont prêtes pour l'étape suivante. »

`seba_state` = `{ account text primary key, user_id uuid, state jsonb, updated_at }`. Toute l'activité d'un compte (clients, devis, factures, interventions, employés, journal) vit dans **une seule colonne JSONB**, poussée en bloc vers Supabase avec un **debounce de 800 ms** à chaque écriture locale (`docs-backend.md`), le cache `localStorage` faisant foi en cas de coupure. Il n'existe **aucune table `notes`** dans le schéma réel.

Conséquence directe sur la Q1 de Claude : le scénario « deux techniciens modifient le même enregistrement » n'est pas un problème de conflit *ligne par ligne* à anticiper pour plus tard — c'est un problème de **conflit de blob entier, actif dès aujourd'hui**, dès qu'un deuxième point d'écriture existe (deuxième onglet, deuxième appareil). Voir 1.1.

### 0.2 Il n'existe aucune identité de terrain distincte du patron

Nulle part dans le code je ne trouve de mécanisme permettant à un **employé de terrain** de s'authentifier avec sa propre identité Supabase. La table `employes` (`prenom, nom, role, actif, acces`) est un **registre RH**, pas des comptes de connexion — `acces` (`'planning seulement'` par défaut) ressemble à un champ de préparation pour un futur contrôle d'accès, jamais branché. Toutes les policies RLS des tables réelles (`clients`, `devis`, `factures`, `interventions`) vérifient `auth.uid() = user_id`, où `user_id` est **le compte propriétaire unique**. `seba_state.account` est lui-même une clé primaire *par compte*, pas par utilisateur physique.

Autrement dit : **le produit n'a aujourd'hui qu'un seul utilisateur possible par entreprise cliente — le patron.** Un technicien sur le terrain n'a ni login, ni JWT, ni ligne RLS à lui. C'est *l'angle mort le plus important du dossier* pour un SaaS dont la proposition de valeur est la saisie terrain par des employés (section 1.2 et 4.1 en tirent toutes les conséquences).

### 0.3 `agents_config.json` n'est PAS le système d'IA du produit

Le brief demande de proposer des workflows pour `agents_config.json` en le présentant comme le fichier définissant « les rôles, les prompts systèmes et les périmètres d'action de chaque IA » du produit. **Ce fichier ne concerne pas le produit.** C'est la configuration d'un **orchestrateur de développement** (`tools/orchestrator.js`) qui automatise la fabrication de Seba lui-même : `cartographe` (Gemini, analyse d'impact du diff), `executeur` (Claude Code CLI, écrit le code dans un git worktree isolé), `qa` (Groq, choisit et lance les tests), `visualqa` (Gemini, conformité visuelle Tactical Dark sur captures d'écran), `secops` (Claude Code CLI en lecture seule, revue XSS/RLS), `archiviste` (Mistral, messages de commit). C'est un outil *méta*, pas une fonctionnalité livrée aux clients de Seba.

Le vrai système d'IA **côté produit** est ailleurs, dans `supabase-functions/` :
- `ai-relay.ts` : un relais unique à 2 modes (`chat` conversationnel, `json` = « Conscience Seba » qui renvoie `{action, priority, reasoning}`), avec un **fallback de 4 fournisseurs** (Mistral → Groq → OpenRouter → Gemini) — ce n'est pas du multi-agent spécialisé, c'est de la **redondance de fournisseur** pour la disponibilité/le coût.
- `daily-digest.ts` : un job **indépendant**, déclenché par `pg_cron`, qui refait **son propre appel LLM** (Mistral → Groq seulement, prompt quasi identique à celui d'`ai-relay.ts` en mode `json`) puis envoie email + push.
- `send-email.ts` / `send-push.ts` : deux relais transactionnels déclenchés par le navigateur, aucune IA dedans.

Il n'y a donc **aucun hub de routage vers des agents spécialisés** aujourd'hui — juste un relais généraliste + un cron qui duplique une partie de sa logique. Proposer des « rôles d'agents produit » dans `agents_config.json` casserait la config de l'orchestrateur de dev (qui est lue par `tools/orchestrator.js`, un script réel, pas de la documentation). **Section 5** propose un fichier séparé, `supabase-functions/product-agents.config.json`, pour ne pas mélanger les deux systèmes.

---

## 1. L'AVIS DE CLAUDE — Scénarios limites & psychologie d'abandon

### 1.1 Le pire scénario de désynchronisation n'est pas hypothétique, il est déjà actif

Avec le modèle blob-JSON + debounce 800 ms, voici le scénario concret le plus probable, pas un cas extrême :

**Chantier avec 2 techniciens (ou 1 patron + 1 tablette partagée) hors réseau.** Techniciens A et B ont chacun chargé `seba_db` en cache local au dernier moment où ils avaient du réseau (disons 8h00, identique sur les deux appareils). Toute la matinée, sans réseau :
- A marque l'intervention #42 « terminée », ajoute une note, prend une photo.
- B, sur le même chantier, corrige le montant de la facture #F-0099 liée à un autre client, et ajoute un nouveau client rencontré sur place.

À 12h, les deux appareils retrouvent du réseau. Le mécanisme actuel (`localStorage` fait foi, push débounce à la prochaine écriture) va faire écrire **le blob JSON complet de A**, puis (quelques secondes ou minutes après, selon quand B retrouve du réseau) **le blob complet de B écrase celui de A** — `updated_at` avance, aucune fusion. **Le travail de A disparaît entièrement**, pas seulement le champ en conflit : toute intervention, tout client, toute facture modifiée par A entre 8h et 12h est perdue si B écrit après lui, silencieusement, sans erreur ni avertissement.

C'est pire que le scénario du brief (« deux techniciens modifient le statut de la même pièce ») : ici, ce n'est même pas nécessaire de toucher le même enregistrement — n'importe quelle divergence entre deux appareils déconnectés cause une perte totale d'un côté. Le risque est proportionnel au nombre d'employés actifs simultanément, donc **s'aggrave mécaniquement à mesure que Seba grandit chez un client**, au moment précis où il devient impossible à excuser (« logiciel Enterprise » qui perd des factures).

**Recommandation technique (priorité maximale, avant tout autre chantier de cette liste)** :
1. Remplacer le push « blob entier » par un **journal d'opérations** (`sync_operations` : `id, account, entity, entity_id, op ('create'|'update'|'delete'), patch jsonb, device_id, employee_id, client_seq int, created_at`). Chaque appareil pousse une **liste d'opérations depuis son dernier `client_seq` connu**, jamais l'état entier.
2. Le serveur applique les opérations dans l'ordre de réception (pas de l'horloge cliente, jamais fiable hors-ligne) et détecte les conflits **par entité** : si deux `update` visent le même `entity_id` avec un `base_seq` différent de la version serveur actuelle, c'est un conflit réel à résoudre, pas un simple écrasement.
3. Résolution : **last-write-wins par champ**, pas par enregistrement — si A a changé `statut` et B a changé `notes` sur la même intervention, les deux survivent (fusion automatique, aucun conflit réel). Un conflit **vrai** (même champ, deux valeurs) ne se résout pas silencieusement : il est écrit dans une table `sync_conflicts` et surfacé à la prochaine ouverture du dashboard (« Le statut de l'intervention #42 a été modifié par Ahmed et par vous pendant votre absence réseau — laquelle garder ? »), jamais deviné par le système.
4. Migration progressive : la table `seba_state` actuelle peut rester le **cache de lecture rapide** (dernière projection connue), tant que `sync_operations` devient la source de vérité en écriture — évite de casser l'API `SebaDB` existante pendant la transition (cohérent avec l'étape 2 déjà notée dans `docs-backend.md`).

### 1.2 Sans identité de terrain, aucune donnée n'est attribuable — et ça change tout

Puisque `employes` n'a pas de compte réel (0.2), la première vraie faille n'est pas technique, elle est humaine : **impossible de savoir qui a réellement fait quoi**. Un intervention marquée « terminée » ne dit pas par qui — sur un litige client (« vous n'êtes jamais venus »), le patron n'a aucune preuve, seulement une case cochée depuis un compte partagé. Ça détruit la valeur de tout ce qui est proposé plus bas (photo de contrôle qualité, notes horodatées, digest quotidien) parce que rien n'est **attribuable à une personne responsable**.

**Recommandation** : ajouter une identité légère par employé, sans repasser par un vrai compte Supabase Auth complet (trop lourd pour un ouvrier qui n'a pas d'email professionnel) :
- Table `employe_sessions` : `id, employe_id, pin_hash, device_id, expires_at`. Connexion par **code PIN à 4 chiffres propre à chaque employé**, sur l'appareil de l'entreprise (tablette de chantier) — pas un JWT Supabase individuel, un jeton applicatif signé côté Edge Function, échangé contre un `employe_id` scellé dans chaque opération écrite (`sync_operations.employee_id` ci-dessus).
- RLS ne change pas de propriétaire (`user_id` reste celui du patron, cohérent avec la facturation par compte), mais toute écriture porte désormais un `employee_id` traçable, vérifié côté Edge Function (pas confié au client).
- Conséquence produit immédiate : chaque intervention affiche « Terminée par Ahmed à 14h32 » au lieu d'un simple ✓ — un gain de confiance client ET une preuve en cas de litige, sans coût de développement démesuré.

### 1.3 Pourquoi un ouvrier arrête de saisir ses rapports — et comment l'anticiper

Ce n'est presque jamais un problème d'ergonomie au sens UI classique. Les causes réelles, par ordre de fréquence observée dans les métiers de terrain (BTP, maintenance) :

1. **Peur de la surveillance.** Un rapport détaillé ressemble à un mouchard pour le patron (« il va compter mes pauses »). Tant que la saisie est présentée comme un outil de contrôle (durée, position), l'ouvrier minimise volontairement ce qu'il rapporte. **Contre-mesure produit** : jamais de chrono visible pendant l'intervention, jamais de géolocalisation en continu (seulement un point d'arrivée/départ, explicite et consenti) ; présenter le rapport comme *sa* protection (« si le client conteste, votre photo/note vous couvre »), pas celle du patron.
2. **Aucun bénéfice personnel immédiat.** Remplir un formulaire prend du temps pour un résultat que l'ouvrier ne voit jamais (le dashboard est pour le patron). **Contre-mesure** : retour immédiat et personnel — un badge « 12 interventions ce mois, 0 réclamation », visible par l'employé lui-même, pas seulement agrégé pour le patron.
3. **Friction de saisie disproportionnée par rapport à la tâche.** Remplir un formulaire de 8 champs pour une intervention de 10 minutes est absurde du point de vue de l'ouvrier — il abandonne, et abandonne aussi les tâches suivantes une fois la confiance rompue. **Contre-mesure** : défaut « intervention conforme, rien à signaler » en 1 tap (voir 4.1, saisie vocale/photo), formulaire détaillé seulement si un écart est signalé.
4. **Anxiété de connectivité — « je le ferai plus tard » devient jamais.** Si l'ouvrier n'est pas sûr que sa saisie sera sauvegardée sans réseau, il préfère différer à ce soir — et le soir, il a oublié les détails ou n'a plus envie. **Contre-mesure** : indicateur de queue locale explicite et rassurant (« 3 rapports en attente d'envoi, seront transmis automatiquement »), jamais un simple silence qui laisse deviner si ça a marché.
5. **Aucune conséquence si rien n'est saisi.** Si le patron ne relance jamais un rapport manquant, l'ouvrier apprend vite que ce n'est pas obligatoire. **Contre-mesure** : le digest quotidien (déjà existant, `daily-digest.ts`) devrait inclure « 2 interventions d'hier sans rapport de clôture » — visible du patron, sans naming-and-shaming auprès de l'équipe, juste un signal de suivi doux.

---

## 2. L'AVIS DE GROK — Rentabilité réelle & IA prédictive

### 2.1 Le schéma actuel ne peut tout simplement pas calculer une marge réelle

Aucune table, dans le réel comme dans le préparé, ne porte de notion de **coût** — ni matériaux, ni trajet, ni main d'œuvre horaire réelle. `factures.montant` est un prix de vente, pas un profit. Un patron qui perd de l'argent sur un chantier à cause d'un vol de matériel, d'un devis mal chiffré ou d'un trajet embouteillé n'a **aucun moyen dans Seba de le voir** — c'est un angle mort total, pas une amélioration marginale.

**Tables à ajouter** :
```sql
-- Catalogue de coûts matériaux (distinct du catalogue de vente déjà prévu dans les manques connus)
create table if not exists materiaux_couts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  nom text not null,
  cout_unitaire numeric(10,2) not null,
  fournisseur text,
  unite text default 'unité',
  updated_at timestamptz default now()
);

-- Consommation réelle de matériaux par intervention (pertes/vol détectables par écart)
create table if not exists intervention_materiaux (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references interventions(id) on delete cascade,
  materiau_id uuid not null references materiaux_couts(id),
  quantite_prevue numeric(10,2),
  quantite_utilisee numeric(10,2),
  ecart_justification text  -- rempli seulement si quantite_utilisee > quantite_prevue * 1.15 (seuil d'alerte)
);

-- Temps réel de trajet, distinct du temps facturé au client
create table if not exists intervention_trajets (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references interventions(id) on delete cascade,
  duree_estimee_min int,
  duree_reelle_min int,
  cause_ecart text  -- 'embouteillage' | 'erreur_adresse' | 'attente_client' | null
);

-- Historique de prix fournisseur, pour détecter une hausse avant qu'elle ne rogne la marge sur un devis déjà signé
create table if not exists fournisseurs_prix_historique (
  id uuid primary key default gen_random_uuid(),
  materiau_id uuid not null references materiaux_couts(id),
  prix numeric(10,2) not null,
  releve_le date default current_date
);
```

**Marge réelle calculable** = `facture.montant - Σ(intervention_materiaux.quantite_utilisee × cout_unitaire) - (intervention_trajets.duree_reelle_min × taux_horaire non facturé) - écarts non justifiés`. C'est un widget dashboard à fort impact commercial (« Seba vous dit combien vous gagnez VRAIMENT, pas combien vous facturez ») — aucun concurrent générique ne l'affiche parce qu'aucun ne capte cette donnée à la source (au moment de l'intervention, pas en comptabilité a posteriori).

### 2.2 Utiliser l'IA en mode prédictif, pas seulement réactif

Aujourd'hui `ai-relay.ts` (mode `json`) et `daily-digest.ts` réagissent à un état ponctuel (« il y a X factures en retard »). Une vraie IA prédictive a besoin d'**historique**, qui n'existe pas encore sous forme exploitable (pas de série temporelle de comportement client). Deux prédictions à fort ROI, réalisables avec le schéma proposé :

**a) Prédiction de retard de paiement avant l'échéance.** Table `client_payment_history` (vue matérialisée ou table alimentée à chaque `factures.statut = 'payee'`) : `client_id, delai_paiement_jours, montant, date`. Un client qui paie systématiquement à J+35 sur une échéance à J+30 n'est pas un cas « en retard » à traiter le jour J — c'est un **pattern connu**, détectable avant même l'échéance (« Client X a 85% de chance de payer en retard d'après son historique — envoyer un rappel préventif à J+25 plutôt que d'attendre J+30 »). C'est un calcul déterministe simple (moyenne + écart-type par client), **pas besoin d'appeler un LLM** pour ça — Mistral verra ce point directement (2.1 de sa section).

**b) Détection de dépassement de budget-temps sur un chantier en cours**, à partir de l'écart entre `intervention_trajets.duree_reelle_min` cumulé et les heures prévues au devis, croisé avec les mots-clés des notes de chantier (« problème imprévu », « accès difficile », « client absent ») — ici un LLM a du sens parce que le signal est dans du texte libre, pas structuré. Alimente le digest quotidien : « Le chantier Dupont a consommé 140% du temps prévu, en cours depuis 3 jours — vérifier avant que ça continue » — *avant* la facture finale, pas après.

**c) Consolidation immédiate, avant toute nouvelle fonctionnalité IA** : `ai-relay.ts` (mode `json`) et `daily-digest.ts` font quasiment le même appel (même prompt structuré `{action, priority, reasoning}`, même paire de fournisseurs Mistral/Groq) de manière totalement indépendante — deux implémentations à maintenir en double pour le même besoin. Avant d'ajouter des prédictions supplémentaires, factoriser en un seul module partagé (`_shared/conscience-seba.ts`, pattern Supabase Edge Functions) évite que la dette de duplication ne triple avec chaque nouvel agent.

---

## 3. L'AVIS DE MISTRAL — Coût, souveraineté & mémoire long terme

### 3.1 Le vrai risque de "Token Burn" n'est pas le nombre d'agents, c'est l'absence de filtre en amont

`ai-relay.ts` envoie `JSON.stringify(body.context).slice(0, 4000)` au LLM à **chaque** appel du mode `json`, et `daily-digest.ts` refait un appel LLM **pour chaque compte ayant au moins une facture en retard ou un devis en attente**, une fois par jour, sans aucun filtre de pertinence en amont. Deux problèmes concrets, pas hypothétiques :

1. **Troncature aveugle par `.slice()`** : couper une chaîne JSON à 4000 caractères peut couper *au milieu d'un objet*, produisant un contexte tronqué et parfois un JSON invalide envoyé au modèle — un vrai bug latent de qualité de réponse, pas seulement un problème de coût.
2. **Aucune déduplication de calcul** : si un compte a exactement la même situation (mêmes factures en retard) deux jours de suite parce que le patron n'a rien fait, `daily-digest.ts` repaie un appel LLM identique chaque matin pour regénérer *la même recommandation*.

**Stratégie technique à trois étages, du moins cher au plus cher** :
- **Étage 0 (gratuit, déterministe)** : tout ce qui est calculable sans LLM le reste — retard de paiement (2.2a), agrégats `SebaDB.metrics()`, seuils simples (« 3+ factures en retard »). Aujourd'hui `JSON_SYSTEM` demande à l'IA d'« analyser le contexte et proposer une mesure » alors qu'une bonne partie de ce contexte est déjà un calcul pur — ne demander au LLM que la **formulation en langage naturel** d'une décision déjà prise par du code, pas la décision elle-même. Réduit drastiquement le volume de tokens ET la variance qualité (un LLM qui « décide » peut halluciner un chiffre ; un LLM qui « reformule » un chiffre déjà calculé ne peut pas se tromper dessus).
- **Étage 1 (cache de contexte)** : table `ai_context_hash` (`account, context_hash, response, created_at`) — si le hash du contexte n'a pas changé depuis le dernier appel (`daily-digest.ts` tourne sur un compte inchangé), retourner la réponse en cache au lieu de rappeler le LLM. Coût de calcul du hash négligeable face au coût d'un appel API.
- **Étage 2 (LLM réel, borné)** : seulement pour du texte libre non structuré (notes de chantier, question ouverte du chat) où il n'y a pas d'alternative déterministe — remplacer `.slice(0, 4000)` par un résumé structuré construit côté serveur (les 5 champs les plus pertinents, jamais une troncature de chaîne brute).

### 3.2 Mémoire long terme sans saturer le contexte — pgvector, pas des blobs qui grossissent

Le risque naturel serait d'ajouter un champ `historique_notes text` à chaque client et de le concaténer dans chaque prompt — ça grossit indéfiniment et finit par dépasser le budget de tokens en quelques mois d'activité. Structure recommandée, exploitant le fait que Supabase = Postgres (extension `pgvector` disponible nativement, gratuite) :

```sql
create extension if not exists vector;

-- Résumé vivant, mis à jour incrémentalement, PAS régénéré à chaque appel
create table if not exists client_memoire (
  client_id uuid primary key references clients(id) on delete cascade,
  resume text,                 -- 2-3 phrases, régénérées seulement quand le delta le justifie
  derniers_faits jsonb default '[]',  -- 5 derniers évènements marquants max, FIFO
  updated_at timestamptz default now()
);

-- Recherche sémantique sur l'historique complet (notes, interventions), sans jamais
-- charger tout l'historique dans un prompt : on ne récupère QUE les k passages pertinents
create table if not exists memoire_embeddings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source_type text not null,   -- 'note' | 'intervention' | 'digest'
  source_id uuid,
  contenu text not null,
  embedding vector(384),       -- modèle léger (ex. all-MiniLM), pas besoin d'un embedding 1536-dim coûteux ici
  created_at timestamptz default now()
);
create index on memoire_embeddings using ivfflat (embedding vector_cosine_ops);
```

Principe : `client_memoire.resume` alimente le prompt en 2-3 phrases fixes (coût constant, quel que soit l'ancienneté du client) ; `memoire_embeddings` n'est interrogé **que si une question précise le justifie** (le chat assistant demande « rappelle-moi ce qui s'est passé chez Dupont l'an dernier »), via une recherche vectorielle qui ne remonte que les 3-5 passages les plus proches — jamais un historique complet. `resume` ne se régénère pas à chaque digest quotidien : seulement quand un nombre suffisant de faits nouveaux s'accumule (ex. tous les 5 évènements), sinon c'est le même coût de troncature/duplication qu'en 3.1.

### 3.3 Souveraineté : le fallback à 4 fournisseurs est une force à documenter, pas à multiplier sans contrôle

Un vrai point positif déjà en place : aucune dépendance unique à un fournisseur américain (Mistral en premier choix = souveraineté UE). Attention cependant à `daily-digest.ts` qui n'a **que** Mistral → Groq (pas OpenRouter/Gemini en secours) — si les deux échouent le même jour pour un compte à forte volumétrie, aucun digest n'est envoyé, silencieusement (`if (!reco || reco.priority === 'low') continue`). Ajouter un compteur d'échecs consécutifs par fournisseur (table `provider_health`) permettrait de désactiver temporairement un fournisseur en panne plutôt que de le retenter à chaque compte un par un — économise des appels réseau qui vont échouer de toute façon.

---

## 4. L'AVIS DE GEMINI — Barrières physiques & QA visuelle terrain

### 4.1 Les mains sales/mouillées/gantées ne sont pas un détail d'ergonomie, c'est la contrainte n°1

Sur un chantier réel : gants de chantier (tactile capacitif inopérant), mains mouillées ou grasses, pluie sur l'écran, soleil direct rendant l'écran illisible, bruit de perceuse/génératrice rendant la voix inutilisable par moments, une seule main disponible (l'autre tient un outil ou une échelle). Aucune de ces contraintes n'est adressée par une interface web responsive classique — c'est un problème de **modalité d'entrée**, pas de taille de bouton.

**Ce qui manque, par ordre de priorité d'impact terrain réel** :
1. **Photo-first, pas texte-first.** Prendre une photo est un geste possible avec des gants (bouton physique de l'appareil ou zone tactile large de 48px+), taper du texte ne l'est pas. Le flux par défaut d'une clôture d'intervention devrait être : 1 photo du résultat → 1 tap « conforme » ou « à signaler » → fin. Le texte détaillé (notes) vient en option, jamais en obligation de premier écran.
2. **OCR pour tout ce qui est déjà écrit ailleurs.** Un compteur électrique, une plaque signalétique, un numéro de série sur un équipement — photographier et laisser l'OCR extraire le texte est plus fiable et plus rapide qu'une saisie manuelle sous la pluie. Table `ocr_extractions` (`id, source_photo_url, texte_brut, champs_extraits jsonb, confidence, valide_par_humain boolean`) — jamais auto-validé sans confirmation d'un humain si la confiance est sous un seuil.
3. **Voix pour les notes, avec repli visuel si le bruit ambiant est trop fort.** Un chantier avec compresseur/perceuse en fond rend la reconnaissance vocale peu fiable — il faut détecter cette situation (score de confiance de la transcription trop bas) et proposer un repli sur une liste de statuts prédéfinis à taper en 1 tap plutôt que de forcer une resaisie vocale vouée à l'échec.
4. **Mode "une main"** : tout geste critique (valider une intervention, prendre une photo) doit être atteignable en bas d'écran avec le pouce, jamais un bouton en haut nécessitant de lâcher prise sur ce que l'autre main tient.

### 4.2 Un agent de contrôle qualité par photo — faisable dès aujourd'hui, avec l'infra déjà en place

`GEMINI_API_KEY` existe déjà (`agents_config.json` l'utilise côté dev-orchestrateur, la clé peut être réutilisée côté produit dans une nouvelle Edge Function) et `gemini-2.0-flash`/`gemini-2.5-flash` sont **multimodaux nativement** — pas besoin d'un nouveau fournisseur. Ce qui manque, c'est le **critère de comparaison par métier**, sans lequel demander à un modèle « est-ce que cette photo est conforme » est trop vague pour être fiable.

```sql
-- Un jeu de critères par type d'intervention, propre à chaque secteur (menage/electricite/plomberie/...)
create table if not exists qa_criteres_metier (
  id uuid primary key default gen_random_uuid(),
  secteur text not null,        -- même valeurs que profiles.sector
  type_intervention text not null,
  criteres jsonb not null,      -- [{label, description, obligatoire}]
  updated_at timestamptz default now()
);

-- Résultat de l'analyse IA sur une photo de fin de chantier
create table if not exists qa_photos (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references interventions(id) on delete cascade,
  photo_url text not null,
  criteres_id uuid references qa_criteres_metier(id),
  verdict text,                 -- 'conforme' | 'a_verifier' | 'non_conforme'
  points_detectes jsonb,        -- [{critere, respecte bool, detail text}]
  confidence numeric(3,2),
  analyse_le timestamptz default now()
);
```

Exemple concret sur l'électricité (repris du brief) : `qa_criteres_metier` pour `type_intervention = 'tableau_electrique'` contient `[{label:"Disjoncteurs étiquetés", obligatoire:true}, {label:"Câblage sans fil dénudé apparent", obligatoire:true}, {label:"Porte du tableau se ferme sans forcer", obligatoire:false}]`. La photo prise par le technicien est envoyée à Gemini multimodal avec ces critères en prompt structuré, réponse forcée en JSON (même pattern que `JSON_SYSTEM` existant dans `ai-relay.ts`). Si `verdict = 'non_conforme'` ou `'a_verifier'`, alerte **avant que le technicien ne quitte le chantier** (push immédiat via `send-push.ts`, déjà existant) — c'est la différence entre corriger un défaut en 2 minutes sur place et un retour client 3 semaines plus tard.

**Garde-fou obligatoire** : jamais de blocage automatique du technicien sur un verdict IA seul (faux positifs inévitables sur de la vision par ordinateur bas coût) — le système alerte et propose une seconde photo ou une validation manuelle, il ne bloque jamais la clôture d'intervention de force. Cohérent avec le principe déjà appliqué ailleurs dans le code (`daily-digest.ts` : `catch { /* best-effort */ }`, aucune fonctionnalité IA ne doit jamais devenir un point de blocage dur).

---

## 5. Structures de tables — récapitulatif consolidé

*(Toutes avec `enable row level security` + policies `auth.uid() = user_id` ou dérivées via `intervention_id`/`client_id`, même pattern que le reste de `supabase-schema.sql` — non répété ligne à ligne ici par souci de longueur.)*

| Table | Rôle | Section |
|---|---|---|
| `sync_operations` | Journal d'opérations pour la fusion multi-appareils (remplace le push blob-entier) | 1.1 |
| `sync_conflicts` | Conflits réels (même champ, deux valeurs) surfacés à l'utilisateur | 1.1 |
| `employe_sessions` | Identité légère par employé (PIN), sans compte Supabase Auth complet | 1.2 |
| `materiaux_couts` | Catalogue de coûts (distinct du catalogue de vente) | 2.1 |
| `intervention_materiaux` | Consommation réelle vs prévue, détection d'écart/perte/vol | 2.1 |
| `intervention_trajets` | Temps de trajet réel vs facturé | 2.1 |
| `fournisseurs_prix_historique` | Veille prix fournisseur en temps réel | 2.1 |
| `client_payment_history` | Série temporelle de délais de paiement par client (prédiction) | 2.2 |
| `ai_context_hash` | Cache de réponse LLM par hash de contexte | 3.1 |
| `client_memoire` | Résumé vivant par client, mis à jour incrémentalement | 3.2 |
| `memoire_embeddings` | Recherche sémantique (pgvector) sur l'historique complet | 3.2 |
| `provider_health` | Compteur d'échecs consécutifs par fournisseur LLM | 3.3 |
| `ocr_extractions` | Texte extrait de photos (compteurs, plaques, numéros de série) | 4.1 |
| `qa_criteres_metier` | Critères de conformité par secteur/type d'intervention | 4.2 |
| `qa_photos` | Verdict IA sur photo de fin de chantier | 4.2 |

---

## 6. `product-agents.config.json` — proposition (nouveau fichier, distinct d'`agents_config.json`)

Ne modifie pas `agents_config.json` (config réelle de l'orchestrateur de dev, section 0.3). Ce fichier serait consommé par une future version d'`ai-relay.ts` pour router vers un vrai comportement spécialisé au lieu du simple fallback de fournisseur actuel :

```json
{
  "$comment": "Config des agents COTE PRODUIT (consommés par supabase-functions/*.ts). Distinct de agents_config.json (orchestrateur de développement de Seba lui-même) — ne pas fusionner.",

  "costTiers": {
    "tier0_deterministic": "Calcul pur, aucun appel LLM (SebaDB.metrics(), client_payment_history, seuils) — voir 3.1",
    "tier1_cached": "ai_context_hash consulté avant tout appel LLM",
    "tier2_llm": "Réservé au texte libre non structuré (notes, chat) sans alternative déterministe"
  },

  "agents": {
    "assistant_conversationnel": {
      "trigger": "chat utilisateur dashboard (mode 'chat' existant)",
      "providers": ["mistral", "groq", "openrouter", "gemini"],
      "costTier": "tier2_llm",
      "existing": "ai-relay.ts, inchangé"
    },
    "conscience_predictive": {
      "trigger": "daily-digest.ts (pg_cron) + mode 'json' d'ai-relay.ts, À FUSIONNER (voir 2.2c)",
      "providers": ["mistral", "groq"],
      "costTier": "tier0_deterministic pour le calcul, tier2_llm pour la seule formulation",
      "sharedModule": "_shared/conscience-seba.ts (n'existe pas encore, à créer)"
    },
    "qa_visuelle_intervention": {
      "trigger": "photo de clôture d'intervention (nouveau, voir 4.2)",
      "providers": ["gemini"],
      "costTier": "tier2_llm",
      "blocking": false,
      "note": "Ne bloque jamais la clôture d'intervention sur un verdict seul (faux positifs vision par ordinateur)"
    },
    "prediction_impayes": {
      "trigger": "batch quotidien, avant échéance (voir 2.2a)",
      "providers": [],
      "costTier": "tier0_deterministic",
      "note": "Aucun LLM nécessaire — moyenne/écart-type sur client_payment_history"
    }
  }
}
```

---

## 7. Ce que je n'ai PAS traité (hors périmètre explicite du brief, à ne pas refaire)

Conformément à la consigne « ne pas repasser sur ce qu'on sait déjà » : lignes de devis, acomptes/paiements, mode hors-ligne générique, catalogue d'articles, signature électronique, conformité TVA anti-fraude. Ces manques restent réels et certains recoupent les recommandations ci-dessus (le mode hors-ligne générique bénéficierait directement du journal d'opérations de la section 1.1) — signalé pour cohérence, pas retraité en détail.
