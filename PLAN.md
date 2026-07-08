# PLAN — Seba

Source unique de vérité pour la direction produit. L'orchestrateur (`tools/orchestrator.js`) traite les tâches dans l'ordre, une par une, en cochant au fur et à mesure. Ne pas réordonner manuellement sans mettre à jour `PROGRESS.md` en conséquence.

## Chantier dashboard (2026-07-07/08)

- [x] Audit + benchmark + implémentation + QA du dashboard (branche `amelioration-dashboard`, 16 commits)
- [x] Revue humaine et merge de `amelioration-dashboard` dans `main` (mergé 2026-07-08 via PR GitHub, déploiement Pages vérifié en direct sur sebpromax.github.io/seba/dashboard.html)

## Dette RGPD/sécurité identifiée (voir audit du 2026-07-07, classement gravité dans la conversation — pas encore fichier dédié)

- [x] Suppression de compte : ajouter la suppression réelle côté Supabase — Art. 17 RGPD, critique (mergé 2026-07-08, vérifié en direct : `eraseAllData` présent dans `seba-data.js` en production)
- [x] Corriger les injections `innerHTML` non échappées — faille XSS stockée, critique (mergé 2026-07-08, vérifié en direct : `function esc(` présent dans `clients.html`/`crm-tech.html`/`widgets.js` en production)
- [x] Brancher `SebaDB.remove()` à l'UI pour la suppression individuelle d'un client/employé — Art. 17 (2026-07-08 : bouton dans `client-fiche.html`/`employe-fiche.html` + action rapide dans `clients.html`, id désormais propagé dans l'URL)
- [x] Exposer un export JSON complet des données personnelles dans réglages.html (la fonction `SebaDB.exportJSON()` existe déjà) — Art. 20 (déjà implémenté — bouton "Exporter mes données" présent, checkbox juste restée non cochée)
- [x] Retirer/mitiger `prefilled_email` en clair dans l'URL des Payment Links Stripe (2026-07-08 : supprimé de `stripe-service.js`, `client_reference_id` seul suffit au rapprochement)
- [ ] Créer la page politique de confidentialité / mentions légales (actuellement absente — lien mort dans `faq.html`) — nécessite du contenu juridique du fondateur, pas seulement du code
- [ ] Trancher l'incohérence entre le discours marketing ("tout est hébergé en Europe") et les fournisseurs IA/email/push américains (Groq, OpenRouter, Gemini, Resend, OneSignal) — décision métier/juridique du fondateur

## Thème Tactical Dark — migration restante

- [x] Migrer `client-fiche.html` vers Tactical Dark — vérifié 2026-07-08 : la page utilise déjà les tokens `pro-global.css` (dark ET light), rendu conforme au reste de l'app dans les deux modes. La note "actuellement thème clair" était obsolète, aucun code à changer.
- [x] Migrer `employe-fiche.html` vers Tactical Dark — même constat, même vérification 2026-07-08.

## Bugs connus non corrigés

- [x] Sidebar mobile ne passe jamais en `position:fixed` sur `clients.html` (2026-07-08 : root-cause réel différent du diagnostic — `position:fixed` s'appliquait déjà correctement ; le vrai bug était `.layout{grid-template-columns:1fr!important}` sans `minmax(0,1fr)`, qui laissait la piste de grille grandir jusqu'au `min-content` du tableau responsive (`table{min-width:560px}`), poussant le hamburger hors du viewport sur `clients.html`/`devis.html`/`equipe.html`/`factures.html`/`planning.html`. Fix d'une ligne dans `pro-global.css` + petits ajustements de wrap par page. Vérifié : 0 débordement, hamburger accessible, desktop pixel-identique sur les 8 pages testées.)
