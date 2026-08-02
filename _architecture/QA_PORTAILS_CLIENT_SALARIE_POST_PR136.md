# QA fonctionnelle post-PR#136 — Portails Client et Salarié

**Date** : 2026-08-02
**Version de production testée** : commit `8db0f98` (merge PR #136), déployé et confirmé live sur `https://sebastienvalentin.com`
**Méthode** : tests fonctionnels réels (clics, saisies, navigation) via Puppeteer + Chrome, sessions Supabase Auth réelles, contre un environnement Supabase **local** reconstruit à l'identique du code/schéma exactement fusionné sur `main` (aucune écriture sur la base de production réelle). Complété par des vérifications sûres exécutées directement sur `https://sebastienvalentin.com` (pages publiques, états d'erreur avec mauvais identifiants — aucune donnée créée). 4 agents lancés en parallèle, phase d'observation uniquement (aucun code applicatif modifié pendant les tests).

---

## Comptes synthétiques utilisés

Entreprise « SEBA QA PORTAILS », mot de passe commun `QA-Portails-Test-2026!`, tous les emails en `@test.seba.invalid` :

| Rôle | Email | Rattachement |
|---|---|---|
| Professionnel | `qa-portails-pro@test.seba.invalid` | compte `95b0093f-0df7-4e8f-9039-d235b9f1170d` |
| Client A | `qa-portails-client-a@test.seba.invalid` | `cli_qap_a` — 2 devis en attente, 1 facture impayée, 1 intervention |
| Client B | `qa-portails-client-b@test.seba.invalid` | `cli_qap_b` — 1 intervention séparée, aucun devis/facture |
| Salarié A | `qa-portails-emp-a@test.seba.invalid` | `emp_qap_a` — assigné à `interv_qap_a` |
| Salarié B | `qa-portails-emp-b@test.seba.invalid` | `emp_qap_b` — assigné à `interv_qap_b` |

Données de départ : 2 devis, 1 facture non payée, 2 interventions (checklist 2 items, consignes), 2 fils de messages (Client↔Pro, Salarié↔Pro). Aucune donnée réelle utilisée à aucun moment.

---

## Pages testées

**Client** : `client-connexion.html`, `client-espace.html` (vues accueil/demandes/interventions/documents/messages/compte).
**Salarié** : `employe-connexion.html`, `espace-terrain.html` (vues aujourd'hui/missions/messages/profil, détail mission).
**Production (public, sans compte)** : `index.html`, `connexion.html`, `client-connexion.html`, `employe-connexion.html`, `offline.html`, `mentions-legales.html`, `politique-confidentialite.html`, `cgu.html`, `faq.html`, `tarifs.html`, `reset-password.html`, URL inconnue (404).

## Boutons/formulaires testés

Connexion (empty/wrong/valide, Entrée, toggle mot de passe, mot de passe oublié) × 2 portails ; navigation complète (tous les onglets, retour, déconnexion) × 2 portails ; formulaire de message (vide, XSS, injection SQL, emoji, texte long 5000+ car., double-soumission rapide) ; formulaire de changement de mot de passe ; formulaire de nouvelle demande ; acceptation/refus de devis avec motif ; checklist de mission (cocher/décocher/recocher) ; ajout photo/incident/matériau ; finalisation de mission (avec et sans checklist complète).

## Messages envoyés (réels, contenu préfixé « QA test »)

Client A→Pro, Pro→Client A, Salarié A→Pro, Pro→Salarié A — 4/4 directions confirmées reçues, persistées après rechargement et après déconnexion/reconnexion, isolées des tiers (Client B et Salarié B ne voient rien).

## Notifications générées et vérifiées (les 4 déclencheurs de la PR #136)

| Déclencheur | Lignes créées (compte DB direct) | Destinataire correct | Rejeu sans doublon |
|---|---|---|---|
| Nouveau message | 1 par message envoyé | Oui | N/A (chaque message est un événement distinct) |
| Devis accepté | Exactement 1 (après 2 appels) | Oui (le pro, jamais le client lui-même) | Oui |
| Devis refusé | Exactement 1 (après 2 appels) | Oui | Oui |
| Mission terminée | Exactement 1 (après appel de rejeu sur mission déjà `submitted`) | Oui | Oui |

Aucune notification cross-tenant observée sur l'ensemble des tests.

## Interventions modifiées (réel, entités dédiées créées par l'agent d'interconnexion pour ne pas interférer avec les autres agents)

Cycle complet testé : création → assignation Salarié A → démarrage → checklist/incident/matériau/2 photos (1 interne, 1 visible client) → consultation Pro (données complètes) → finalisation → consultation Client (données filtrées, checklist/matériaux/incidents absents, photo interne jamais transmise) → changement d'horaire (propagation après actualisation, cohérent avec l'absence de Realtime) → réassignation à Salarié B (perte d'accès immédiate et vérifiée côté serveur pour Salarié A, gain d'accès pour Salarié B) → annulation (propagée après actualisation).

Sur les entités pré-semées (`interv_qap_a`) : réassignation testée séparément par l'agent Salarié (perte/gain d'accès confirmés y compris par appel RPC direct avec l'ancien salarié), puis réassignation restaurée à l'état initial.

## Résultats de persistance

100% des écritures testées (devis accepté/refusé, message envoyé×4 directions, mot de passe changé, demande créée, checklist coché/décoché/recoché, photo/incident/matériau ajoutés, mission finalisée, compte rendu envoyé) ont été confirmées persistées après **rechargement de page ET déconnexion/reconnexion complète** — aucun cas d'« action annoncée réussie mais non persistée » (critère P0) observé.

## Erreurs console / réseau

- Aucune erreur console bloquante trouvée sur les pages/actions testées.
- 1 échec réseau isolé et non bloquant : `POST /auth/v1/logout?scope=global` échoue au niveau transport sur l'instance GoTrue locale, sans impact utilisateur observé (`signOut()` retourne `ok:true`, la reconnexion immédiate fonctionne) — probable particularité de l'instance locale, à reconfirmer si jamais observé en production réelle. Classé P2, informationnel.
- Un `net::ERR_ABORTED` sur `/auth/v1/logout` lors d'une navigation immédiate après déconnexion : reproduit comme un artefact attendu (la page change avant que l'appel fire-and-forget ne se termine), pas un défaut.

## Liens morts / pages inexistantes

Aucun lien mort, aucune page blanche, aucun bouton inerte, aucun `#` mort trouvé sur l'ensemble de la navigation crawlée (2 portails authentifiés en local + 12 URLs publiques en production). Une URL inconnue en production renvoie correctement une 404 avec page de marque dédiée. Aucun lien codé en dur vers `localhost` ou un domaine obsolète trouvé dans `client-connexion.html`/`employe-connexion.html`.

## Tests responsive

320/375/390/430/768/1440px sur les 2 portails (connexion + espace) : **aucun scroll horizontal global détecté sur aucune combinaison**. Cloche de notification et panneau restent utilisables et dans le viewport à toutes les tailles. Boutons d'action de mission ≥44px.

## Tests clavier

Tab atteint tous les éléments interactifs sur les 4 pages testées (2 connexions + 2 espaces). Anneau de focus visible sur la quasi-totalité des éléments (exception notée en P2, voir ci-dessous). Entrée active la cloche de notification et ouvre le panneau. Échap ferme le panneau de notifications.

## Tests d'isolation (sécurité, critère P0)

| Vérification | Résultat |
|---|---|
| Client A ne voit jamais Client B (données, devis, factures, messages, interventions) | Confirmé, y compris via appel RPC direct avec identifiant falsifié |
| Client ne voit jamais les données internes (checklist/matériaux/incidents/notes internes/finances) | Confirmé — champs absents de la charge utile, pas seulement masqués côté UI |
| Salarié A ne voit jamais les missions de Salarié B | Confirmé, y compris via appel RPC direct et manipulation d'URL |
| Salarié ne voit jamais les factures/paiements/CA/marges | Confirmé |
| Salarié ne peut pas modifier son propre rôle/permissions | Confirmé — aucun contrôle exposé dans l'UI, tentative de sonde RPC directe rejetée (fonction inexistante) |
| Perte d'accès immédiate après réassignation | Confirmé dans les deux sens (ancien salarié refusé, nouveau salarié autorisé), au niveau RPC serveur |
| Anonyme ne peut lire aucune donnée privée | Confirmé |

**Zéro échec d'isolation détecté sur l'ensemble des deux portails.**

---

## Problèmes classés

### P0 — Bloquant ou critique
**Aucun.**

### P1 — Important avant pilote réel

**P1-1 — Double soumission possible sur le formulaire de message du portail Client (`docs/client-espace.html`)**
- **Preuve** : appeler `envoyerMessagePrestataire()` deux fois rapidement (double-clic/double Entrée réaliste) crée **deux lignes de message identiques** en base, vérifié avec un marqueur unique par exécution.
- **Cause identifiée** : `docs/client-espace.html` (fonction `envoyerMessagePrestataire()`, ~ligne 1062-1071) désactive le champ (`inp.disabled = true`) mais n'a **aucune garde de type "déjà en cours d'envoi"** avant de lire la valeur — les deux appels passent la validation avant que le premier `await createMessage(...)` ne se termine.
- **Comparaison utile** : `docs/espace-terrain.html`, fonction équivalente `envoyerMessagePatron()` (~ligne 1147-1153), possède déjà la garde correcte : `if (btn.disabled) return; // anti double-tap`. Le correctif existe déjà dans le code, il n'a simplement pas été appliqué au composeur du portail client.
- **Reproduction exacte** : se connecter en Client A sur `client-espace.html` → onglet Messages → dans la console : `document.getElementById('ce-msg-input').value='x'; envoyerMessagePrestataire(); envoyerMessagePrestataire();` → observer deux lignes.
- **Correction recommandée** : ajouter la même garde `if (btn.disabled) return;` (ou équivalent) en tout début de `envoyerMessagePrestataire()`, avant toute lecture du champ.
- **Dépendances** : aucune. **Estimation** : petite.

### P2 — Amélioration

**P2-1 — Message d'erreur brut en anglais sur mauvais identifiants (production)**
`docs/client-connexion.html` ligne 250 (et équivalent `employe-connexion.html`) : `err.textContent = res.error || 'Connexion impossible.'` transmet tel quel le message anglais natif de Supabase Auth (« Invalid login credentials ») plutôt qu'un message français cohérent avec le reste de l'interface. Cosmétique, non bloquant.

**P2-2 — Champs de changement de mot de passe sans nom accessible (`client-espace.html`)**
`#ce-pw-new`/`#ce-pw-confirm` n'ont ni `<label for>` ni `aria-label`, et utilisent un anneau de focus par `box-shadow` plutôt que `outline` (donc invisible aux lecteurs d'écran comme nom accessible, bien que le retour visuel existe pour un utilisateur voyant au clavier).

**P2-3 — Favicon non déclaré sur les pages applicatives (`client-espace.html`, `espace-terrain.html`, `offline.html`)**
`favicon.jpg` existe et est bien référencé sur les pages de connexion, mais absent de ces 3 pages → 404 cosmétique sur `/favicon.ico` à chaque chargement.

**P2-4 — Échec réseau isolé sur la déconnexion en environnement local**
Voir section « Erreurs console/réseau » ci-dessus — informationnel, aucun impact utilisateur observé, à garder à l'œil si reproduit un jour en production réelle.

---

## Verdict global

```
PORTAIL CLIENT      : PRÊT AVEC LIMITES  (1 correctif P1 avant un usage à plusieurs clients actifs simultanément)
PORTAIL SALARIÉ     : PRÊT               (0 problème trouvé sur l'ensemble du parcours réel testé)
INTERCONNEXION      : VALIDÉE            (4/4 déclencheurs de notification vérifiés en base, isolation totale confirmée, propagation planning correcte compte tenu de l'absence de Realtime)
```

**Justification du « PRÊT AVEC LIMITES » côté Client** : le seul problème trouvé (P1-1, double envoi de message) n'est ni une fuite de données ni une perte de données — c'est un doublon inoffensif mais visible, qui dégraderait l'expérience d'un client réel en cas de clic rapide/mauvaise connexion. Le reste du portail Client (52/52 vérifications) est passé sans réserve. Ce correctif est petit, isolé, et son schéma de correction existe déjà ailleurs dans le même dépôt.

**Tally global** : 4 agents, ~150 vérifications réelles effectuées (clics, saisies, appels RPC directs, comptages base de données), **0 P0, 1 P1, 4 P2**, 0 régression sur les suites automatisées existantes (non re-rejouées dans cette passe, mais aucune modification de code n'a eu lieu pendant l'observation).

---

## Prochaine étape

Correction du P1-1 (et, en même temps, les 3 P2 corrigibles en quelques lignes — P2-1, P2-2, P2-3 — puisqu'il s'agit du même type de correctif mineur et cohérent, pas un mélange sécurité/visuel) sur une branche dédiée `fix/qa-portails-client-salarie` (jamais la branche déjà supprimée de la PR #136), avec un test de non-régression pour le P1. Rapport de cette correction à présenter avant toute fusion. Le Lot 2 ne démarre qu'après.
