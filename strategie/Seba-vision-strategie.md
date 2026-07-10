# Seba — Vision, stratégie et philosophie

> **Statut : Constitution du projet.** Toute décision de développement, de design ou de priorisation se confronte à ce document. En cas de conflit entre une idée séduisante et une ligne écrite ici, c'est la ligne écrite qui gagne — ou alors on amende la Constitution, explicitement, jamais en silence.

## 1. La vision

Seba doit devenir **le système d'exploitation des entreprises de services** (conciergerie, ménage, gestion locative, maintenance, jardinage, etc.).

Aujourd'hui ces entreprises jonglent avec dix outils différents (devis, factures, agenda, CRM, Excel, paiement...). Seba regroupe tout sur une seule plateforme : un professionnel crée son entreprise, configure son activité en quelques dizaines de minutes, invite ses clients, et pilote tout depuis un seul endroit — sans jamais changer de logiciel quand il grandit.

Le moteur (clients, lieux, rendez-vous, prix, statuts) reste identique d'un métier à l'autre ; seule la "peau" s'adapte. C'est ce qui rend la plateforme scalable comme Shopify ou Stripe l'ont été dans leur domaine.

**Cette promesse est déjà câblée dans l'architecture** : ouvrir Seba à un nouveau secteur (électricien, jardinier, pressing, déménagement...) est une opération de **configuration, pas de développement** — un bloc de plus dans `businessTypes.js` (libellés, prestations types, tarifs suggérés), zéro modification du noyau (`seba-data.js`). Si un jour l'ajout d'un métier exige de toucher au noyau, c'est que l'architecture a dérivé : on corrige l'architecture, pas le métier.

## 2. Le positionnement

À tester en priorité auprès des premiers clients (la formule qui se comprend en moins de 5 secondes gagne) :
- Le système d'exploitation des entreprises de services
- Le cerveau de votre entreprise
- L'IA qui pilote votre entreprise

Mais le vrai pitch n'est pas une liste de fonctionnalités : **Seba vend la tranquillité d'esprit**. Le patron ouvre l'appli, voit en 30 secondes que tout va bien, la referme. C'est ça qui déclenche l'achat.

## 3. Le levier d'achat : la bascule sans couture

Le concurrent principal de Seba n'est pas un logiciel — c'est **l'inertie**. Un patron n'abandonne pas ses tableurs parce qu'un outil est meilleur ; il les abandonne le jour où la bascule ne lui coûte rien.

Seba doit donc être conçu comme **un port d'arrivée** : on y importe son historique (clients, prestations, tarifs — CSV depuis Excel ou l'outil précédent, via `import-export.js`), et à partir de ce jour on ne ressaisit plus jamais rien. La promesse de migration fait partie du produit au même titre que le devis en 30 secondes :

- **Importer doit être plus rapide que ressaisir.** Si l'import d'un fichier clients prend plus de temps que de recopier dix lignes, l'inertie gagne.
- **Aucune donnée orpheline.** Tout ce qui entre est immédiatement utilisable : un client importé est planifiable, facturable, relançable dès la première minute.
- **La sortie reste libre.** L'export complet des données est un droit permanent, pas une option cachée — c'est une condition de la confiance (section 8), et paradoxalement le meilleur argument pour rester.

La facilité de bascule est le levier d'achat ; la peur de la migration est le mur qu'on fait tomber.

## 4. Les anti-objectifs : ce que Seba n'est PAS

Un produit se définit autant par ce qu'il refuse que par ce qu'il promet. Seba est **le hub opérationnel** des entreprises de services — pas le logiciel métier de niche qui prétend tout faire. Lignes rouges :

- **Pas de comptabilité complexe.** Seba produit des factures propres et un suivi financier lisible ; il ne remplace ni l'expert-comptable ni un moteur de liasse fiscale. On exporte proprement vers la compta, on ne la réimplémente pas.
- **Pas de RH spécialisé.** Gestion d'équipe, planning, affectation des missions : oui. Paie, contrats, conformité sociale : non — c'est le territoire d'outils dédiés, et y entrer diluerait le cœur.
- **Pas de CRM généraliste ni de plateforme no-code.** Seba n'est pas un Notion des services : chaque écran répond à une tâche précise du quotidien d'un patron de terrain, pas à un usage hypothétique.
- **Pas de logiciel métier vertical.** Le jour où une fonctionnalité n'a de sens que pour un seul secteur, elle n'entre pas dans le noyau — elle devient de la configuration de "peau" (`businessTypes.js`) ou elle n'entre pas du tout.
- **Pas de fonctionnalité "démo".** Rien n'est construit pour impressionner en démonstration ce qui ne sera pas utilisé chaque semaine en vrai (voir obsession n°1).

Chaque anti-objectif protège la même chose : **10 fonctionnalités utilisées tous les jours**, et la vitesse qui va avec.

## 5. La niche de départ

Pas la "meilleure" niche sur le papier — celle où il y a un avantage personnel : conciergeries de locations saisonnières + entreprises de ménage, parce que c'est un terrain déjà connu, avec des contacts et le langage des clients. On élargira service par service une fois le cœur validé — par configuration (section 1), jamais par fork.

## 6. Avant d'écrire la moindre ligne de code

Aller rencontrer 30 à 50 professionnels du secteur choisi. Pas pour vendre — pour écouter :
- Montrez-moi votre journée
- Quels logiciels utilisez-vous
- Qu'est-ce qui vous fait perdre du temps / de l'argent

Construire Seba autour de leurs réponses, pas autour d'hypothèses.

## 7. La roadmap (l'IA arrive après, pas avant)

**V1 — Prouver que le cœur fonctionne**
CRM, planning, devis, factures, clients, employés, Stripe, Google Calendar, notifications, portail client web.

**V2 — Une fois V1 utilisée et payée**
IA commerciale, IA opérationnelle, automatisations, tableaux de bord intelligents.

**V3**
Benchmark, marketplace, IA prédictive, application mobile complète.

> Une IA géniale posée sur un logiciel que personne n'utilise ne sert à rien. On valide l'usage avant d'ajouter l'intelligence.

## 8. Les deux obsessions produit

**Obsession n°1 — 10 fonctionnalités utilisées tous les jours**, pas 1000 fonctionnalités rarement ouvertes. L'écran d'accueil doit répondre en 30 secondes : combien j'ai gagné, qui travaille aujourd'hui, quels devis/paiements sont en attente.

**Obsession n°2 — La vitesse.** Créer un devis : 30s. Un client : 15s. Une intervention : 20s. Une facture : 10s. L'utilisateur ne doit jamais attendre. Faire un outil ultra-puissant qui semble si simple qu'une grand-mère pourrait l'utiliser — c'est ça le vrai génie produit, pas la complexité.

## 9. L'avantage caché : la confiance — la sérénité du patron

Le plus gros différenciant ne sera pas l'IA ni les automatisations — ce sera la confiance. Si une entreprise met ses salariés, ses clients, sa comptabilité et ses paiements sur Seba, elle doit avoir une confiance à 100% : sauvegardes automatiques, sécurité, gestion fine des droits d'accès, disponibilité du service.

Au cœur de cette confiance, un choix d'architecture qui est en réalité **un argument commercial** : le journal d'opérations en écriture seule (append-only — techniquement, aucune modification ni suppression n'y est possible, par construction). Ce que ça vend n'est pas une prouesse d'ingénierie, c'est **la sérénité du patron face à l'incertitude humaine** :

- Un client conteste une intervention ? *« Voici exactement qui a changé quoi, et quand. »* Pas une vague date de dernière modification — la chronologie complète, infalsifiable.
- Un employé s'est trompé, un doute s'installe, deux versions s'affrontent ? Le journal tranche sans accuser personne : les faits sont là, horodatés, inaltérables.
- Une coupure réseau de trois jours sur le terrain ? Rien n'est perdu : les opérations se rejouent dans l'ordre, sans écraser le travail des autres.

Le patron n'achète pas un « event log » — il achète le droit de ne plus jamais trancher un litige de mémoire. Moins spectaculaire que l'IA, mais c'est ce qui rend un logiciel indispensable.

## 10. L'automatisation comme cœur du système

Réservation → devis → signature → facture → planning → mission envoyée → confirmation client → photos après intervention → questionnaire de satisfaction.
Tout s'enchaîne automatiquement, sans ressaisie, sans oubli.

## 11. Le rôle de l'IA (une fois en place)

Assister, jamais remplacer : rédiger des devis, proposer des réponses clients, résumer des conversations, générer des rapports hebdomadaires (CA, clients les plus rentables, taux de transformation des devis), et suggérer des opportunités de développement — sans jamais imposer un choix.

## 12. Ordre d'exécution recommandé

1. 30–50 entretiens terrain
2. Maquettes détaillées
3. Prototype cliquable testé par de vrais professionnels
4. Construction de la V1
5. Premiers clients payants (même petit montant)
6. Itération continue sur leurs retours
7. IA ajoutée seulement quand le produit est déjà utilisé au quotidien

---

**En une phrase** : parler aux utilisateurs avant de coder, construire un produit simple et fiable avant de le rendre intelligent, rendre l'arrivée (import) et le quotidien si fluides que les professionnels ouvrent Seba chaque matin par réflexe — et refuser tout ce qui ne sert pas ça.
