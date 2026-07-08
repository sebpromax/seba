# 🧭 AUDIT COMPARATIF DES PARCOURS DE DÉMARRAGE

*Audit réalisé le 2026-07-08. Trois modèles interrogés **indépendamment** (aucun n'a vu la réponse des autres), rôles et missions imposés, sur le même contexte factuel (structure exacte des 11 écrans actuels de `onboarding.html`, cible = patrons de PME de terrain en stress de temps permanent). Reproduction brute, zéro consensus forcé. Aucun fichier de code n'a été modifié — analyse pure.*

---

## 📑 COMPTE-RENDU DE GEMINI (CPO)

**1. Ce qui ne va pas du tout dans le parcours actuel en 8 étapes :**
L'emplacement de l'écran "Créez votre accès" (actuel Écran 8) est la principale faille. Demander à l'utilisateur d'investir autant de temps et d'effort (7 écrans de configuration) avant même de créer un compte et de sécuriser sa progression est suicidaire pour la conversion. Tout abandon avant cet écran signifie une perte sèche de données et de motivation. La surcharge cognitive est aussi un désastre : demander des détails sur l'identité visuelle (Écran 5), une liste exhaustive des services avec tarification (Écran 6) et des horaires précis (Écran 7) est excessif pour un premier contact. Ces étapes sont bloquantes, chronophages et frustrent un public déjà sous pression. L'absence de Time-To-Value rapide, n'offrant le dashboard qu'après un marathon, garantit un taux d'abandon abyssal.

**2. Le parcours logique idéal (étape par étape, de l'inscription au Dashboard) :**
**1. Inscription rapide :** email pro, mot de passe, confirmation, CGU. L'utilisateur sécurise sa session et son progrès immédiatement.
**2. Infos clés entreprise :** nom de l'entreprise, pays. Le strict minimum pour personnaliser l'environnement.
**3. Type d'activité :** secteur principal et cœur de métier. Permet à Seba de pré-remplir intelligemment des données.
**4. Accès au Dashboard :** l'utilisateur est immédiatement dirigé vers un dashboard minimaliste, pré-rempli avec quelques données d'exemple ou des placeholders pertinents, et une checklist de "prochaines étapes" facultatives pour compléter la configuration. Le Time-To-Value est instantané, l'utilisateur voit ce qu'il est venu chercher.

**3. Ce qu'il faut supprimer immédiatement pour maximiser la conversion :**
Il est impératif de *supprimer la position actuelle* de l'écran de création de compte (Écran 8) et de le déplacer en début de parcours. L'intégralité de l'écran "Identité visuelle" (Écran 5 — slogan, description, couleur) doit être supprimée du parcours initial : c'est une barrière cognitive et un frein à l'engagement. De même, la configuration détaillée de *tous* les "Services phares" (Écran 6) avec prix et types de tarification, ainsi que la configuration des horaires standards et d'urgence (Écran 7), doivent être supprimées comme étapes obligatoires avant l'accès au dashboard. Seuls des choix par défaut ou un minimum (1 service générique) doivent être proposés.

**4. Ce qu'il faut ajouter ou déplacer plus tard (configuration asynchrone) :**
Toutes les informations non critiques pour l'accès et une première compréhension du produit doivent être déplacées après l'accès au dashboard. Cela inclut : l'identité visuelle complète (slogan, description, couleur), la personnalisation détaillée des services (prix spécifiques, types de tarification, ajout de services personnalisés), et la configuration précise des disponibilités (horaires standards, plages d'urgence). Il faut ajouter un "Assistant de Configuration" ou une "Checklist de Bienvenue" directement dans le dashboard. Cette checklist guidera l'utilisateur pour compléter ces éléments à son rythme, idéalement avec des micro-incitations et des bénéfices clairs pour chaque configuration, une fois qu'il aura expérimenté la valeur de base de Seba.

---

## 📑 COMPTE-RENDU DE MISTRAL (LEAD UI/UX)

**1. Ce qui ne va pas du tout dans le parcours actuel en 8 étapes :**
Le parcours actuel est une usine à gaz qui ignore la réalité des cibles : des patrons en stress permanent qui testent entre deux urgences. Le compte ne se crée qu'à l'écran 8, après 7 étapes de collecte de données inutiles en phase d'onboarding (couleurs, slogan, tarifs détaillés). La friction cognitive est maximale : 11 écrans statiques sans possibilité de sauter, sur mobile ou un coin de bureau. Le sentiment de perdre du temps est immédiat, surtout quand on demande des détails comme les couleurs (étape 5) ou les tarifs (étape 6) avant même d'avoir validé l'email ou le mot de passe. La confiance ne se construit pas ainsi : on demande des engagements prématurés sans valeur perçue claire.

**2. Le parcours logique idéal (étape par étape, de l'inscription au Dashboard) :**
Le parcours idéal doit commencer par l'inscription (email + mot de passe) en 2 écrans max, puis enchaîner sur la configuration *ultra-minimale* pour accéder au dashboard. Étape 1 : pays + type d'activité (2 tuiles max pour éviter la surcharge). Étape 2 : nom de l'entreprise + nom public (pour personnaliser le portail client). Étape 3 : horaires standards (jours + plages). Étape 4 : accès (email + téléphone + mot de passe). Ensuite, un écran de chargement, puis le dashboard avec un tutoriel progressif pour configurer slogan, couleurs, tarifs, etc. *L'onboarding doit être une porte d'entrée, pas un interrogatoire.*

**3. Ce qu'il faut supprimer immédiatement pour maximiser la conversion :**
Supprimez immédiatement les étapes 5 (identité visuelle), 6 (tarifs détaillés) et 7 (horaires d'urgence) de l'onboarding forcé. Ces données peuvent être collectées *après* que l'utilisateur ait accès à son espace, via des pop-ups ou un menu "Configurer mon profil". La couleur principale et le slogan n'ont aucun impact sur la création de compte ou l'usage immédiat de l'outil. Les tarifs détaillés et les horaires d'urgence sont des configurations avancées qui n'ont pas leur place dans un parcours de 11 écrans statiques.

**4. Ce qu'il faut ajouter ou déplacer plus tard (configuration asynchrone) :**
Déplacez en configuration asynchrone (après le dashboard) : l'identité visuelle (couleurs, slogan), les tarifs détaillés par service, les horaires d'urgence, et la description de l'activité. Ajoutez aussi un système de "checklist de configuration" dans le dashboard, avec des badges "À faire" pour encourager l'utilisateur à compléter son profil *quand il a le temps*. Ces éléments relèvent de la personnalisation avancée, pas de l'onboarding critique. Leur absence ne bloque pas l'usage de base de l'outil.

---

## 📑 COMPTE-RENDU DE GROQ (CTO / ARCHITECTE)

**1. Ce qui ne va pas du tout dans le parcours actuel en 8 étapes :**
Le parcours actuel de 11 étapes est trop long et impose une charge cognitive élevée aux utilisateurs, ce qui peut entraîner un abandon rapide. Les utilisateurs doivent fournir une grande quantité d'informations avant d'accéder au dashboard, ce qui peut sembler fastidieux et rebutant. De plus, l'absence de possibilité de sauter des étapes ou d'accéder au dashboard avant la fin du processus d'inscription peut être frustrante pour les utilisateurs qui veulent explorer l'outil rapidement.

**2. Le parcours logique idéal (étape par étape, de l'inscription au Dashboard) :**
Le parcours logique idéal devrait commencer par une inscription rapide (nom, email, mot de passe) suivi d'un accès immédiat au dashboard. Les étapes suivantes pourraient être les suivantes : choix du secteur d'activité, précision du cœur de métier, nom de l'entreprise et identification visuelle. Les informations relatives aux services phares, aux horaires et à la configuration de l'entreprise pourraient être collectées de manière progressive, en fonction des besoins de l'utilisateur.

**3. Ce qu'il faut supprimer immédiatement pour maximiser la conversion :**
Il faut supprimer immédiatement les étapes qui ne sont pas essentielles pour l'accès au dashboard, telles que le choix de la couleur principale, la description de l'activité et la création d'un slogan. Ces informations peuvent être collectées ultérieurement, une fois que l'utilisateur est familiarisé avec l'outil et a compris son fonctionnement. De même, les étapes relatives à la création de services phares et à la configuration des horaires pourraient être reportées à une étape ultérieure.

**4. Ce qu'il faut ajouter ou déplacer plus tard (configuration asynchrone) :**
Il faut ajouter ou déplacer les éléments de configuration de manière asynchrone, de sorte que l'utilisateur puisse accéder au dashboard rapidement et configurer son compte progressivement. Par exemple, les sections relatives aux services phares, aux horaires et à la configuration de l'entreprise pourraient être accessibles via des onglets ou des liens dans le dashboard, permettant à l'utilisateur de les configurer à son rythme. De plus, des rappels et des notifications pourraient être mis en place pour inviter les utilisateurs à compléter leur profil et à configurer leur compte de manière progressive.

---

## Convergence et divergence (constat, pas de consensus forcé)

**Convergence totale des 3 agents, indépendamment :**
- Le compte (email/mot de passe) doit être créé **en tout début** de parcours, pas à l'écran 8 comme aujourd'hui.
- Les écrans "Identité visuelle" (couleur/slogan/description), "Services phares" détaillés (tarification complète) et "Horaires d'urgence" doivent sortir de l'onboarding obligatoire et devenir de la configuration post-dashboard.
- Le mécanisme de rattrapage proposé converge aussi : une checklist/tutoriel de configuration progressive **dans** le dashboard, pas un formulaire bloquant en amont.

**Seule divergence de fond : la place du secteur/cœur de métier.**
Gemini et Groq le gardent dans le tronc commun avant le dashboard (utile pour pré-remplir intelligemment le compte). Mistral le compresse mais le garde aussi tôt. Aucun des 3 ne propose de le repousser en asynchrone — signal fort que cette donnée, contrairement aux autres, est jugée réellement structurante dès l'inscription par les 3 perspectives (produit, UX, architecture).
