# Rapport Chaos Monkey — 2026-07-08T18:41:03.601Z

Mode : local (Claude, aucune donnee envoyee).
Ce rapport ne modifie AUCUN code — revue humaine/Claude requise avant toute action.

## Audit "utilisateur frustre"

- Aucun avertissement produit visible (dans l'app elle-meme, pas juste la doc technique) avant qu'un utilisateur change d'appareil/navigateur sans avoir configure Supabase -> perte de donnees silencieuse possible.
- Le debounce de sauvegarde de 800ms vers Supabase : fermer l'onglet ou eteindre l'appareil dans cette fenetre peut perdre la derniere ecriture sans avertissement.
- Aucune resolution de conflit documentee si le meme compte est utilise simultanement sur 2 appareils : "le cache local fait foi, re-push a la prochaine ecriture" = dernier ecrivain gagne silencieusement, sans prevenir l'utilisateur qu'il vient d'ecraser une modification faite ailleurs.
- La limite "les donnees vivent sur l'appareil" (mode local sans Supabase) est documentee pour le developpeur mais pas necessairement communiquee clairement a l'utilisateur final au moment ou ca compte (avant qu'il perde des donnees, pas apres).
NB_POINTS: 4

## Audit "attaquant"

- docs-backend.md section "2. Creer la table" contient un exemple SQL PROTOTYPE avec des policies permissives (`using (true)`) -- un developpeur qui copie CET exemple litteralement (au lieu du supabase-schema.sql reel, plus strict) cree des policies non securisees ou n'importe qui connaissant l'URL Supabase peut lire/ecrire toutes les donnees de tous les comptes. L'avertissement juste apres attenue le risque mais le code copiable reste dangereux tel quel.
- Table `api_usage` : RLS active sans aucune policy -- comportement voulu (deny-all sauf service_role) mais non explicite comme un choix intentionnel dans le SQL lui-meme (juste dans un commentaire) ; un futur dev pourrait "corriger" cet "oubli" en ajoutant une policy trop permissive.
- `seba_state.account` (cle texte, slug d'entreprise) et l'isolation reelle par `user_id` sont deux mecanismes qui se chevauchent conceptuellement : le RLS protege bien via `user_id`, mais si `account` est un jour utilise ailleurs sans filtrer aussi par `user_id`, collision possible entre deux comptes ayant choisi le meme slug.
- Cle anon Supabase exposee cote navigateur "par design" (correctement documente) mais aucune mention de rate-limiting cote Supabase pour limiter un usage abusif au-dela de ce que RLS bloque deja.
NB_POINTS: 4

## Validation

Analyse locale (pas de second avis externe) -- a considerer comme un premier passage, pas une validation croisee. Le point le plus actionnable : corriger ou retirer l'exemple SQL permissif de docs-backend.md (section 2) pour qu'il reflete directement les policies deja durcies de supabase-schema.sql, afin qu'aucun copier-coller futur ne puisse regresser vers des policies "using (true)".
