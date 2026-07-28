# SEBA — Checklist de déploiement

Document de suivi des prérequis bloquants avant mise en production de
fonctionnalités qui dépendent d'un service externe (email, paiement, etc.).
Un chantier par section, statut explicite, jamais un déploiement silencieux
tant qu'une section reste BLOQUÉ.

## À faire avant la mise en production des emails

Statut : BLOQUÉ — prérequis externe

Prérequis :

- acheter un nom de domaine pour Seba ;
- ajouter le domaine dans Resend ;
- configurer les enregistrements DNS SPF et DKIM ;
- attendre la validation du domaine par Resend ;
- créer une adresse d'expédition, par exemple no-reply@domaine-seba.fr ;
- créer une clé Resend dédiée à Supabase Auth SMTP ;
- configurer le SMTP personnalisé dans le projet Supabase distant ;
- configurer les secrets des Edge Functions :
  - RESEND_API_KEY
  - EMAIL_FROM
  - APP_BASE_URL
  - RESEND_WEBHOOK_SECRET
- appliquer la migration :
  migrations/2026-07-28-commercial-email-delivery.sql
- déployer :
  - send-commercial-document
  - commercial-email-webhook
- tester réellement :
  - invitation patron ;
  - invitation client ;
  - invitation employé ;
  - réinitialisation de mot de passe ;
  - envoi d'un devis ;
  - envoi d'une facture ;
  - envoi d'un reçu ;
  - ouverture du bon document après authentification.

Décision actuelle :

- aucun nom de domaine n'est encore acheté ;
- les tests locaux continuent avec Mailpit et Resend mocké ;
- ne pas utiliser onboarding@resend.dev en production ;
- ne pas déclarer les emails prêts pour la production avant validation réelle du domaine et des emails reçus ;
- ce blocage ne doit pas empêcher le développement local restant ;
- les automatisations email restent reportées jusqu'à l'activation réelle de l'envoi manuel.

## Note pour la future PR Customer Email Delivery

À reporter tel quel dans la description ou la checklist de la PR
`feature/customer-email-delivery` lors de son ouverture :

> Déploiement production bloqué jusqu'à l'achat et à la validation d'un domaine d'expédition Resend.
