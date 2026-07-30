# Audit de préparation au pilote — Seba

Phase 0 (vérité technique) + 12 tests de lancement uniquement. Les 42 scénarios hostiles n'ont volontairement pas été relancés — voir `_architecture/SEBA_EXECUTABLE_CAPABILITY_MATRIX.md` pour le détail ligne par ligne.

## 1. Quelle version de Seba a été auditée

- **Code** : branche `main`, commit `4d8dc09` (2026-07-30).
- **Site testé** : `https://sebpromax.github.io/seba/` — c'est le site public réel servi en production, pas une maquette séparée. `docs/config.public.js` pointe vers le vrai projet Supabase `ptmudezhxnhhyctowlqp`, et `seba-data.js` confirme que ce déploiement utilise `SupabaseAdapter` (persistance réelle), pas le mode démo local.
- **Le premier audit rejeté par le fondateur avait testé la même URL** — le problème n'était donc pas "il a testé la mauvaise chose", mais que ses conclusions ont été lues comme un verdict produit définitif sans distinguer panne d'infrastructure (email) vs absence de fonctionnalité vs bug applicatif. Cette passe corrige cette distinction.
- **Compte utilisé** : compte patron réel préexistant fourni par le fondateur ("Sebababa"), avec des données métier réelles (7 clients, 6 devis, 5 factures avant l'audit). Non créé depuis zéro par cet audit — voir section 2 pour pourquoi.

## 2. Réel / mocké / non déployé

| | |
|---|---|
| **Réel et fonctionnel** | Connexion, lecture/écriture clients, interventions, devis (y compris révision de devis signé), factures, paiements (y compris partiels) — tout confirmé par requêtes serveur directes, pas seulement par lecture d'écran |
| **Mocké nulle part sur le chemin testé** | Le site public utilise la vraie base de données pour toutes les pages patron testées ; aucune donnée `LocalAdapter`/démo rencontrée sur ce compte |
| **Non déployé (code existe, jamais poussé sur ce projet Supabase)** | `send-push`, `ai-relay`, `vision-qa`, `daily-digest`, `notify-alert`, `assistant-technique`, `embed-content` — confirmé par test d'endpoint direct (404 identique à un nom de fonction inventé) |
| **Déployé mais cassé** | L'envoi d'email d'authentification Supabase (`/auth/v1/otp`) et les fonctions `client-provision`/`employe-provision` — voir P0 ci-dessous |

## 3. Verdict

# **NO-GO**

Pas à cause de la qualité du cœur produit : **plusieurs opérations centrales côté patron fonctionnent réellement et persistent correctement** (clients, interventions, devis — y compris révision d'un devis signé —, factures, paiements y compris partiels), confirmé par requêtes serveur directes sur un compte patron réel. Mais **le parcours complet patron → employé → client n'a pas pu être validé de bout en bout** : la porte d'entrée est fermée, personne ne peut créer un compte patron, et un patron déjà connecté ne peut inviter ni un client ni un employé à son propre portail — donc les portails employé (`espace-terrain.html`) et client (`client-espace.html`) restent **non testés**, pas confirmés fonctionnels ni confirmés cassés. Un pilote lancé maintenant échouerait dès la première étape (recrutement d'un nouveau patron) ou dès la deuxième (le patron ne peut pas donner accès à son équipe/ses clients).

**Hypothèse principale, non confirmée à ce stade** : une seule panne de configuration email/SMTP côté Supabase expliquerait P0-1/P0-2/P0-3 et rendrait ce NO-GO réversible en un seul correctif — voir section 8 et `_architecture/QA360_P0_REMEDIATION_PLAN.md` pour la vérification par les logs avant toute action.

## 4. P0 réels (bugs confirmés, pas des absences de fonctionnalité)

### P0-1 — Aucune inscription patron n'est possible en production
`POST /auth/v1/otp` retourne systématiquement `500 {"code":"unexpected_failure","message":"Error sending confirmation email"}` (ou `"Error sending magic link email"`). Reproduit avec une adresse jetable **et** une vraie adresse Gmail personnelle du fondateur — ce n'est donc pas un filtre anti-spam sur les domaines jetables, c'est une panne totale d'envoi. Tant que ce n'est pas corrigé, **zéro nouveau compte patron ne peut être créé**, quel que soit le canal.

### P0-2 — Le provisioning du portail client échoue systématiquement
`POST /functions/v1/client-provision` retourne `500 {"error":"Erreur serveur"}` à chaque ajout de client depuis `clients.html`. La fiche client elle-même est bien créée (persistance confirmée), mais l'invitation au portail client échoue toujours. Root cause très probablement identique à P0-1 (même mécanisme d'envoi d'email en panne).

### P0-3 — Le provisioning du portail employé échoue systématiquement
Même symptôme exact que P0-2, sur `employe-provision`, à chaque ajout d'employé.

**Hypothèse non confirmée** : P0-1, P0-2 et P0-3 pourraient n'être qu'une seule et même panne (configuration SMTP/email du projet Supabase) plutôt que trois bugs indépendants — les trois échecs partagent le même symptôme générique (`500`, message serveur non détaillé), mais **rien à ce stade ne prouve une cause commune** au niveau des logs réels. Cette hypothèse doit être confirmée ou infirmée par une inspection des logs Supabase Auth/Edge Functions avant toute correction — voir `_architecture/QA360_P0_REMEDIATION_PLAN.md`. Tant que ce n'est pas confirmé, les trois restent listés et traités séparément.

### P0-4 — RETIRÉ en tant que bug confirmé (voir `QA360_P0_REMEDIATION_PLAN.md` section 4 pour le détail complet)

> Le scénario initial de correction par montant négatif était invalide : le code refuse déjà les montants négatifs localement. Aucun succès serveur fantôme reproductible n'est confirmé.

`recordPayment()` (`docs/seba-data.js:4318`) rejette déjà tout montant ≤ 0 localement, avant tout envoi au serveur. Le texte "En attente" observé n'a pas de cause confirmée liée à cette tentative précise. Retiré de la liste des P0 confirmés.

**Conservé, reclassifié :**

> Aucun mécanisme de correction ou d'annulation historisée d'un paiement n'existe dans l'interface. Classification : **P1 — PILOT GATE.**

Ne bloque pas la remédiation en cours, mais doit être résolu ou explicitement accepté par le fondateur avant l'ouverture du pilote. Le paiement de test de 40 € reste présent sur la facture réelle `#F-0095` (id `id_ms7crz6db6iyj`) tant que non nettoyé — voir procédure en attente de validation dans `QA360_P0_REMEDIATION_PLAN.md` section 2a.

## 5. Fonctions manquantes nécessaires au pilote (absence de fonctionnalité, PAS des bugs P0)

- **Détection de doublon client** : créer deux fois le même client (même prénom/nom/email/téléphone) crée deux fiches distinctes sans avertissement. Ce n'est pas un P0 en soi (le produit ne perd ni ne corrompt rien), mais c'est un vrai risque opérationnel pour un pilote réel (confusion, double facturation potentielle) — à corriger avant un usage à plusieurs personnes sur un même compte.
- **Aucune suppression dure des devis** : "Annuler" change le statut, ne supprime jamais la ligne. Probablement un choix assumé (piste d'audit) plutôt qu'un oubli — à confirmer avec le fondateur plutôt qu'à "corriger" à l'aveugle.
- **P1 — PILOT GATE : aucun mécanisme de correction de paiement fiable.** Il n'existe visiblement aucun moyen dans l'UI de retirer ou corriger proprement un paiement mal saisi (pas de bouton "annuler ce paiement" sur la fiche facture ; les montants négatifs sont rejetés par validation, sans alternative proposée) — voir P0-4 ci-dessus pour le détail. Ne bloque pas cette passe, mais doit être résolu ou explicitement accepté avant l'ouverture du pilote.
- **Vue mission individuelle de la fiche employé non reliée au planning** : l'application l'admet elle-même ("l'assignation par employé n'est pas encore reliée au planning") — fonctionnalité partiellement construite, pas un bug de régression.
- **Accès direct par rôle employé/client non testé** : bloqué faute de compte actif (voir P0-1/P0-2/P0-3 — la panne d'email empêche justement de créer ces comptes de test). Ce n'est pas une absence confirmée, c'est un **test non exécutable tant que les P0 ci-dessus ne sont pas résolus** — priorité à retester en premier après correction.

## 6. Ressaisies observées

Aucune ressaisie manuelle constatée dans les parcours testés (client → intervention → devis → facture → paiement) : chaque étape reprend les données déjà saisies (client sélectionné depuis une liste, pas retapé ; devis lié au client sans ressaisie de coordonnées). Ce point n'a pas révélé de problème dans le périmètre testé.

## 7. Risques de sécurité et de permissions

- **Accès direct par URL sans session** : confirmé correctement bloqué (5 pages patron testées, toutes redirigent vers `connexion.html` sans session active).
- **Accès direct par URL avec une session d'un autre rôle** (ex. un employé qui tente d'ouvrir une page patron) : **non testé**, bloqué par l'absence de compte employé/client actif (conséquence directe de P0-2/P0-3). C'est le test de sécurité le plus important qui reste à faire — à traiter en priorité dès que le provisioning fonctionne.
- **Architecture de données** : `seba_state` (JSONB par compte) coexiste avec des tables normalisées (`clients`, `devis`, `factures`, `paiements`, etc.) dans le même schéma. La relation exacte entre les deux (lequel les portails client/employé et les RLS lisent réellement) n'a pas été vérifiée dans cette passe — à clarifier avant de considérer la séparation des données entre comptes comme garantie de bout en bout, pas seulement au niveau de la table `seba_state`.
- **Secrets** : aucune clé service-role Supabase trouvée dans `docs/config.js` (seulement anon key + clés Groq/Stripe test) — cohérent avec la doctrine du projet, rien d'anormal trouvé ici.

## 8. Corrections minimales, dans l'ordre d'exécution

1. **Diagnostiquer et corriger la configuration email/SMTP du projet Supabase** (Authentication → Email, ou config SMTP custom si utilisée). C'est la seule action qui débloque à la fois P0-1, P0-2 et P0-3 — à faire et vérifier en premier, avant tout le reste.
2. **Retester l'inscription patron de bout en bout** (un vrai email doit arriver et permettre de poser un mot de passe sur `bienvenue.html`) — preuve de correction de P0-1.
3. **Retester l'ajout d'un client et d'un employé** et confirmer que `client-provision`/`employe-provision` retournent `200`, pas `500` — preuve de correction de P0-2/P0-3.
4. **Une fois 1-3 validés, créer un vrai compte employé et un vrai compte client de test** et exécuter les tests d'accès par URL directe avec ces rôles (section 7) — c'est le test de sécurité qui manque le plus.
5. **Décider si un vrai mécanisme de correction de paiement est nécessaire avant le pilote** (voir `QA360_P0_REMEDIATION_PLAN.md` section 4) — absence de fonctionnalité confirmée, pas un bug à corriger en urgence.
6. **Nettoyer les artefacts de cet audit** dans le compte réel (voir liste précise dans `SEBA_EXECUTABLE_CAPABILITY_MATRIX.md`, section finale) : devis annulé `DEV-2026-0119`, paiement de test de 40€ sur la facture `#F-0095`.
7. Seulement après 1-6 : décider si la détection de doublon client (section 5) doit être traitée avant le pilote ou documentée comme limitation acceptée pour un premier compte à un seul utilisateur.

Ni les scénarios de récurrence, ni le fonctionnement hors connexion, ni les 42 scénarios hostiles n'ont été abordés dans cette passe — ils restent la suite logique une fois ce NO-GO levé, pas la priorité actuelle.
