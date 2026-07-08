# PLAN — Seba

Source unique de vérité pour la direction produit. L'orchestrateur (`tools/orchestrator.js`) traite les tâches dans l'ordre, une par une, en cochant au fur et à mesure. Ne pas réordonner manuellement sans mettre à jour `PROGRESS.md` en conséquence.

## Chantier dashboard (2026-07-07/08)

- [x] Audit + benchmark + implémentation + QA du dashboard (branche `amelioration-dashboard`, 16 commits)
- [ ] Revue humaine et merge de `amelioration-dashboard` dans `main`

## Dette RGPD/sécurité identifiée (voir audit du 2026-07-07, classement gravité dans la conversation — pas encore fichier dédié)

- [x] Suppression de compte : ajouter la suppression réelle côté Supabase — Art. 17 RGPD, critique (fait sur la branche `fix-securite-xss-suppression`, en attente de merge)
- [x] Corriger les injections `innerHTML` non échappées — faille XSS stockée, critique (fait sur la branche `fix-securite-xss-suppression`, en attente de merge)
- [ ] Brancher `SebaDB.remove()` à l'UI pour la suppression individuelle d'un client/employé — Art. 17
- [ ] Exposer un export JSON complet des données personnelles dans réglages.html (la fonction `SebaDB.exportJSON()` existe déjà) — Art. 20
- [ ] Retirer/mitiger `prefilled_email` en clair dans l'URL des Payment Links Stripe
- [ ] Créer la page politique de confidentialité / mentions légales (actuellement absente — lien mort dans `faq.html`) — nécessite du contenu juridique du fondateur, pas seulement du code
- [ ] Trancher l'incohérence entre le discours marketing ("tout est hébergé en Europe") et les fournisseurs IA/email/push américains (Groq, OpenRouter, Gemini, Resend, OneSignal) — décision métier/juridique du fondateur

## Thème Tactical Dark — migration restante

- [ ] Migrer `client-fiche.html` vers Tactical Dark (actuellement thème clair)
- [ ] Migrer `employe-fiche.html` vers Tactical Dark (actuellement thème clair)

## Bugs connus non corrigés

- [ ] Sidebar mobile ne passe jamais en `position:fixed` sur `clients.html` (bug distinct de celui déjà corrigé sur le dashboard le 2026-07-04)
