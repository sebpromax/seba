# Seba — Vision de marque pour la home page publique

Statut : document de vision, pas de design. Sert d'ancrage commun pour tout travail visuel/éditorial futur sur la home, les illustrations, les couleurs, les animations et la communication de Seba (LANDING-HOMEPAGE-001 et au-delà). Ne décrit ni palette exacte, ni architecture de page — cela vient après, une fois cette vision validée.

Base : `_architecture/SEBA_VISION_CONTRACT.md` (vision stratégique produit, deux faces, long terme) + lecture directe de `docs/index.html` (home actuelle) + `CLAUDE.md`.

**Précision de périmètre importante** : la home actuelle doit vendre Seba tel qu'il existe **aujourd'hui** — un logiciel de gestion pour le patron/indépendant d'une entreprise de services de terrain. La vision "plateforme à deux faces" (découverte publique + QR code + fiche professionnelle) décrite dans `SEBA_VISION_CONTRACT.md` est une trajectoire **moyen/long terme**, pas l'état actuel du produit. La home ne doit donc jamais présenter comme disponible aujourd'hui un parcours client public, une fiche professionnelle publique ou un QR code — ces éléments n'existent pas encore dans le produit livré.

---

## 1. Qui est Seba ?

Seba est un logiciel de gestion pensé pour les entreprises de services qui travaillent **sur le terrain**, pas dans un bureau : des clients avec une adresse, une équipe qui se déplace, des devis à faire signer, des factures à encaisser. Seba centralise ce qui est aujourd'hui dispersé entre cahiers papier, SMS, WhatsApp et tableurs, dans un seul outil pensé pour être utilisé sans formation par quelqu'un qui n'est pas un professionnel du logiciel.

## 2. Pourquoi Seba existe

Parce que les outils de gestion existants sont soit trop complexes et pensés pour des métiers de bureau (avec des dizaines d'options inutiles pour un artisan), soit absents pour ces métiers de terrain, qui se débrouillent avec du bricolage. Seba existe pour remplacer ce bricolage par un outil qui suit le déroulement réel du métier — client → devis → planning → intervention → facture — sans jamais forcer l'utilisateur à s'adapter à une logique logicielle abstraite.

## 3. Pour qui exactement

Le patron ou l'indépendant d'une entreprise de services de terrain, 0 à ~15 employés, qui gère aujourd'hui son activité avec des outils dispersés, qui n'a pas de service informatique, qui décide seul de ses outils, et pour qui le temps gagné a une valeur immédiate et concrète (moins d'oublis, moins de clients mécontents qui rappellent, des factures qui partent réellement).

Secteurs confirmés par le produit existant (`businessTypes.js`, onboarding) : ménage, conciergerie, maintenance/petit bricolage, et plus largement tout métier suivant le schéma client → adresse → devis → intervention → facture (jardinage, vitrerie, pressing, artisans).

## 4. Qui n'est *pas* la cible

- Les entreprises avec un service informatique et des besoins d'intégration complexes.
- Les métiers de réservation en établissement (coiffure, esthétique, massage) — explicitement écartés par `SEBA_VISION_CONTRACT.md` §12, périmètre différent.
- Les profils techniques cherchant un outil "personnalisable"/no-code.
- Les entreprises cherchant un remplaçant complet d'un expert-comptable.
- Le grand public/consommateur — la home s'adresse au professionnel qui gère l'entreprise, jamais à un client final cherchant un prestataire (ce rôle n'existe pas encore, voir précision de périmètre ci-dessus).

## 5. Quelle émotion après 5 secondes

Soulagement pragmatique, pas de l'émerveillement technologique. La réaction visée : *"ça, c'est exactement mon problème, et ça a l'air simple à mettre en place."* Pas d'enthousiasme startup, pas de fascination — la reconnaissance immédiate d'un problème vécu, suivie d'une promesse de simplicité crédible.

## 6. Quelle promesse est non négociable

**Un seul outil qui suit le déroulement réel du métier de terrain, du premier contact client jusqu'au paiement encaissé, sans ressaisie ni changement d'outil à chaque étape.** Pas "l'IA gère votre entreprise", pas "la plus belle interface du marché" — le cœur de la promesse est la fin de la dispersion, pas la sophistication technologique.

## 7. Mots et tournures interdits

- "Révolutionnaire", "disruptif", "game changer", "next-gen", "innovant" utilisé comme adjectif vide.
- "Intelligence artificielle" mise en avant comme sujet principal — l'IA (Assistant Seba, automatisations) est un outil secondaire et discret, jamais l'argument central de la home.
- "Écosystème" — **incohérence déjà réelle et vérifiée** : `docs/index.html` (home actuelle) utilise "Gérez toute votre entreprise de services depuis un seul endroit", mais plus de 40 autres pages du site (`clients.html`, `automatisations.html`, `comment-ca-marche.html`...) utilisent encore le tag `<title>Seba — L'écosystème des entreprises de terrain</title>`. "Écosystème" est un mot abstrait de startup qui ne correspond à aucune des réponses ci-dessus (pas la promesse, pas le ton) — à corriger dans la même passe que la home, pas seulement sur `index.html`.
- "Synergie", "scalable", "growth", jargon growth/startup en général.
- Superlatifs non prouvés ("le meilleur", "le plus rapide du marché") — `SEBA_VISION_CONTRACT.md`/`CLAUDE.md` interdisent déjà d'inventer statistiques ou preuves non vérifiées.

## 8. Niveau de luxe

Ni luxe ni austérité. Seba doit être soigné et professionnel — comme un bon outil de travail bien fait — jamais comme un produit de luxe froid (pas de minimalisme galerie d'art, pas de typographie éditoriale façon marque de mode). Le niveau de finition doit rassurer ("ces gens savent ce qu'ils font") sans jamais donner l'impression d'un outil cher ou inaccessible pour une entreprise de 2-3 personnes. Repère : un établi bien rangé, pas une salle d'exposition.

## 9. Niveau de technologie perçu

Compétent et actuel, jamais futuriste. Seba doit donner l'impression d'un logiciel 2026 bien construit — rapide, propre, sans friction visible — pas d'un laboratoire d'IA ni d'un objet de science-fiction. L'IA existe dans le produit (Assistant Seba, automatisations) et peut être mentionnée, mais jamais comme le sujet principal de la page d'accueil.

## 10. Personnalité de marque

Compétent, direct, terrain, sans jargon — un bon collègue qui connaît le métier et explique clairement, jamais un vendeur surexcité ni un ingénieur qui parle d'architecture. Phrases courtes et concrètes. Vocabulaire ancré dans le travail réel (clients, missions, factures, équipe) plutôt que dans des concepts abstraits (workflow, écosystème, plateforme, solution).

---

## Repères déjà présents dans le produit (à confirmer ou trancher explicitement, pas à ignorer)

La home actuelle (`docs/index.html`) a déjà des choix de marque en place — la direction artistique finale doit les **confirmer explicitement ou les remplacer avec une raison**, jamais les ignorer silencieusement :

- Thème sombre uniquement sur le site marketing (`--bg:#0a0a0c`), indépendant du thème clair/sombre de l'application (`pro-global.css`/Tactical Dark) — cohérence à trancher.
- Accent actuel : `#0D9488` (un teal/sarcelle), distinct du vert `--emerald` de l'application (`#00FF9D` sombre / `#00996B` clair). Un accent de marque différent du produit lui-même n'est pas nécessairement un problème, mais c'est une décision à assumer, pas un hasard.
- Police : Geist (remplace Inter, utilisée dans l'application). Choix récent, cohérent avec un ton "moderne SaaS" mais à évaluer face au risque de ressembler à "20 autres SaaS" (préoccupation explicite du fondateur).
- Structure actuelle en 8 sections (nav, hero, problème, produit en 4 blocs, parcours en 6 étapes, portails client/employé, secteurs, preuve, CTA final, footer) — déjà orientée conversion/clarté, pas décorative. Base saine, pas à jeter par principe.
- Aucune capture d'écran de "fiche publique" ou "QR code" n'apparaît actuellement — cohérent avec la précision de périmètre ci-dessus (ces fonctionnalités n'existent pas encore).

## Questions encore ouvertes (à trancher par le fondateur avant ou pendant l'arbitrage final, pas par les agents seuls)

- Faut-il conserver `#0D9488` comme accent de marque, ou l'aligner sur le vert applicatif pour une continuité totale entre marketing et produit ?
- Faut-il prévoir un mode clair pour le site marketing, ou assumer le sombre comme signature de marque (cohérent avec le "Tactical Dark" du dashboard) ?
- Le prix (19€, visible dans les données structurées `docs/index.html` et `tarifs.html`) doit-il apparaître dans le hero, ou rester réservé à `tarifs.html` ?
- Uniformiser le tag `<title>`/tagline sur l'ensemble du site (au-delà de la seule home) fait-il partie du périmètre de ce chantier, ou une tâche distincte à ajouter au Master Backlog ?

---

Ce document sert d'ancrage unique pour les 5 agents (+ Concurrent Research Agent et Customer Psychology Agent, + critique renforcé) de LANDING-HOMEPAGE-001. Aucun agent ne doit produire une direction qui contredise une réponse ci-dessus sans le signaler explicitement comme un désaccord à arbitrer.
