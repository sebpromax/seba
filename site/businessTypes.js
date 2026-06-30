/**
 * businessTypes.js — Seba
 *
 * Données métier par secteur d'activité.
 * Exposé en variable globale window.businessTypes.
 *
 * Clés par secteur :
 *   label            — nom affiché
 *   icon             — caractère texte sobre (pas emoji)
 *   services         — prestations typiques
 *   specificFields   — champs supplémentaires onboarding
 *   dashboardMetrics — indicateurs pertinents
 *   recommendations  — modèles de suggestions Seba
 *   clientFields     — champs spécifiques fiche client
 *
 * priceType valides :
 *   "heure" | "forfait" | "devis" | "abonnement" | "majoration" | "inclus" | "jour"
 */

window.businessTypes = {

  // ─────────────────────────────────────────────
  // MÉNAGE / NETTOYAGE
  // ─────────────────────────────────────────────
  menage: {
    label: 'Ménage & nettoyage',
    icon: '◈',

    services: [
      { name: 'Ménage standard',          priceType: 'heure',      suggestedPrice: 25,  duration: '2h'  },
      { name: 'Ménage récurrent',         priceType: 'abonnement', suggestedPrice: 23,  duration: null  },
      { name: 'Repassage',                priceType: 'heure',      suggestedPrice: 30,  duration: null  },
      { name: 'Nettoyage de vitres',      priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Nettoyage fin de bail',    priceType: 'forfait',    suggestedPrice: 120, duration: null  },
      { name: 'Nettoyage après travaux',  priceType: 'devis',      suggestedPrice: null, duration: null },
      { name: 'Nettoyage canapé / tapis', priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Désinfection',             priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Intervention urgente',     priceType: 'majoration', suggestedPrice: null, duration: null },
    ],

    specificFields: [],

    dashboardMetrics: [
      'interventions du jour',
      'clients récurrents',
      'factures en retard',
      'prestations les plus demandées',
      'abonnements potentiels',
    ],

    recommendations: [
      'Relancez [client] : devis en attente depuis [X] jours',
      '[Client] réserve tous les mois : proposez-lui un abonnement',
      'Créneau libre [jour] après-midi',
    ],

    clientFields: [
      'fréquence',
      'surface',
      'animaux',
      'produits préférés',
      'pièces sensibles',
      "code d'accès",
      'consignes',
      'photos avant/après',
    ],
  },

  // ─────────────────────────────────────────────
  // CONCIERGERIE LOCATION COURTE DURÉE (Airbnb, etc.)
  // ─────────────────────────────────────────────
  conciergerie: {
    label: 'Conciergerie / Location courte durée',
    icon: '◉',

    services: [
      { name: 'Check-in voyageurs',        priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Check-out voyageurs',       priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Ménage entre séjours',      priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Gestion du linge',          priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'État des lieux',            priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Gestion des clés',          priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Communication voyageurs',   priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Réassort consommables',     priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Maintenance légère',        priceType: 'devis',      suggestedPrice: null, duration: null },
      { name: 'Rapport propriétaire',      priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Gestion des urgences',      priceType: 'majoration', suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Nombre de logements gérés',
      'Besoin de rapports propriétaires ?',
      'Besoin de gestion du linge ?',
    ],

    dashboardMetrics: [
      "arrivées aujourd'hui",
      "départs aujourd'hui",
      'logements à préparer',
      'linge à gérer',
      'rapports propriétaires à envoyer',
    ],

    recommendations: [
      "Logement [X] : check-out à 11h, check-in à 15h — ménage à prévoir",
      'Rapport propriétaire de [X] non envoyé',
    ],

    clientFields: [
      'logement',
      'propriétaire',
      'check-in habituel',
      'check-out habituel',
      'linge',
      'clés',
      'inventaire',
    ],
  },

  // ─────────────────────────────────────────────
  // CONCIERGERIE DE COPROPRIÉTÉ
  // ─────────────────────────────────────────────
  conciergerieCopro: {
    label: 'Conciergerie de copropriété',
    icon: '◫',

    services: [
      { name: 'Gestion des accès et badges', priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Réception colis',             priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Surveillance des parties communes', priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Nettoyage parties communes',  priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Petits travaux / dépannage',  priceType: 'heure',      suggestedPrice: null, duration: null },
      { name: 'Gestion boîtes aux lettres',  priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Assistance résidents',        priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Signalement incidents',       priceType: 'inclus',     suggestedPrice: null, duration: null },
      { name: 'Relation syndic',             priceType: 'inclus',     suggestedPrice: null, duration: null },
      { name: 'Gestion des prestataires',    priceType: 'forfait',    suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Nombre de logements dans la copropriété',
      'Horaires de présence',
      'Syndic référent',
    ],

    dashboardMetrics: [
      'incidents signalés',
      'colis en attente',
      'demandes résidents',
      'réunions de copropriété',
      'prestataires à coordonner',
    ],

    recommendations: [
      '[X] colis en attente de retrait depuis plus de 3 jours',
      'Assemblée générale prévue — préparer le rapport',
    ],

    clientFields: [
      'bâtiment',
      'numéro appartement',
      'badge',
      'prestataire préféré',
      'historique incidents',
    ],
  },

  // ─────────────────────────────────────────────
  // CONCIERGERIE D'ENTREPRISE
  // ─────────────────────────────────────────────
  conciergerieEntreprise: {
    label: "Conciergerie d'entreprise",
    icon: '◆',

    services: [
      { name: 'Services aux employés',          priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Réservation voyages / hôtels',   priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Gestion des livraisons',          priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Organisation événements',         priceType: 'devis',      suggestedPrice: null, duration: null },
      { name: 'Courses et commissions',          priceType: 'heure',      suggestedPrice: null, duration: null },
      { name: 'Assistance administrative',       priceType: 'heure',      suggestedPrice: null, duration: null },
      { name: 'Gestion accueil visiteurs',       priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Services bien-être employés',     priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Coordination prestataires',       priceType: 'inclus',     suggestedPrice: null, duration: null },
    ],

    specificFields: [
      "Effectif de l'entreprise",
      'Services prioritaires à proposer',
      'Fréquence de présence souhaitée',
    ],

    dashboardMetrics: [
      'demandes salariés',
      'réservations en cours',
      'événements à préparer',
      'budget mensuel utilisé',
    ],

    recommendations: [
      'Pic de demandes lundi matin — prévoyez du renfort',
      'Budget mensuel presque atteint — informez le DRH',
    ],

    clientFields: [
      'entreprise',
      'contact RH',
      'niveau de service',
      'budget mensuel',
      'demandes récurrentes',
    ],
  },

  // ─────────────────────────────────────────────
  // JARDINAGE / PAYSAGISTE
  // ─────────────────────────────────────────────
  jardinage: {
    label: 'Jardinage & paysagisme',
    icon: '◌',

    services: [
      { name: 'Tonte',                    priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Taille de haies',          priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Débroussaillage',          priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Désherbage',               priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Arrosage',                 priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Entretien saisonnier',     priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Évacuation déchets verts', priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Contrat annuel',           priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Plantation',               priceType: 'devis',      suggestedPrice: null, duration: null },
      { name: 'Nettoyage extérieur',      priceType: 'forfait',    suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Travail saisonnier ?',
      'Contrats annuels ?',
      'Gestion des déchets verts ?',
    ],

    dashboardMetrics: [
      'interventions météo-sensibles',
      'contrats annuels',
      'déchets verts à évacuer',
      'entretiens saisonniers',
    ],

    recommendations: [
      "Pluie prévue [jour] : reportez l'intervention chez [client]",
      'Contrat annuel de [client] à renouveler',
    ],

    clientFields: [
      'surface extérieure',
      'fréquence',
      'accès jardin',
      'déchets verts',
      'matériel nécessaire',
      'saisonnalité',
    ],
  },

  // ─────────────────────────────────────────────
  // MAINTENANCE / BRICOLAGE
  // ─────────────────────────────────────────────
  maintenance: {
    label: 'Maintenance & bricolage',
    icon: '◎',

    services: [
      { name: 'Petite réparation',         priceType: 'heure',    suggestedPrice: null, duration: null },
      { name: 'Montage meuble',            priceType: 'forfait',  suggestedPrice: null, duration: null },
      { name: 'Peinture',                  priceType: 'forfait',  suggestedPrice: null, duration: null },
      { name: 'Plomberie légère',          priceType: 'heure',    suggestedPrice: null, duration: null },
      { name: 'Électricité légère',        priceType: 'heure',    suggestedPrice: null, duration: null },
      { name: 'Diagnostic',                priceType: 'forfait',  suggestedPrice: null, duration: null },
      { name: 'Dépannage urgent',          priceType: 'majoration', suggestedPrice: null, duration: null },
      { name: 'Intervention sur site',     priceType: 'heure',    suggestedPrice: null, duration: null },
      { name: "Rapport d'intervention",    priceType: 'inclus',   suggestedPrice: null, duration: null },
      { name: 'Fournitures à prévoir',     priceType: 'forfait',  suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Urgence 24/7 ?',
      'Devis avant intervention ?',
      'Matériel/fournitures à facturer ?',
    ],

    dashboardMetrics: [
      'urgences',
      'diagnostics en attente',
      'interventions non facturées',
      'matériel à prévoir',
    ],

    recommendations: [
      "Intervention chez [client] terminée mais non facturée",
      'Urgence non assignée',
    ],

    clientFields: [
      'problème signalé',
      'diagnostic',
      'matériel à prévoir',
      'urgence',
      "rapport d'intervention",
    ],
  },

  // ─────────────────────────────────────────────
  // PRESSING / BLANCHISSERIE
  // ─────────────────────────────────────────────
  pressing: {
    label: 'Pressing & blanchisserie',
    icon: '◷',

    services: [
      { name: 'Collecte',                         priceType: 'inclus',     suggestedPrice: null, duration: null },
      { name: 'Livraison',                        priceType: 'inclus',     suggestedPrice: null, duration: null },
      { name: 'Repassage',                        priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Nettoyage textile',                priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Express 24h',                      priceType: 'majoration', suggestedPrice: null, duration: null },
      { name: 'Abonnement hebdomadaire',          priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Nettoyage cuir / daim',            priceType: 'forfait',    suggestedPrice: null, duration: null },
      { name: 'Retouches et réparations',         priceType: 'forfait',    suggestedPrice: null, duration: null },
    ],

    specificFields: [],

    dashboardMetrics: [
      'commandes à collecter',
      'commandes à livrer',
      'commandes prêtes',
      'clients récurrents',
      'retards',
    ],

    recommendations: [
      'Commande de [client] prête depuis [X] jours',
      'Retard de livraison chez [client]',
    ],

    clientFields: [
      'adresse de collecte',
      'fréquence',
      'type de linge',
      'instructions spéciales',
    ],
  },

  // ─────────────────────────────────────────────
  // BEAUTÉ & SOINS À DOMICILE
  // ─────────────────────────────────────────────
  beaute: {
    label: 'Beauté & soins à domicile',
    icon: '◊',

    services: [
      { name: 'Coupe femme',           priceType: 'forfait', suggestedPrice: 45,  duration: '1h'    },
      { name: 'Coupe homme',           priceType: 'forfait', suggestedPrice: 25,  duration: '30min' },
      { name: 'Coloration',            priceType: 'forfait', suggestedPrice: null, duration: null   },
      { name: 'Balayage / mèches',     priceType: 'devis',   suggestedPrice: null, duration: null   },
      { name: 'Soin visage',           priceType: 'forfait', suggestedPrice: 60,  duration: '1h'    },
      { name: 'Épilation',             priceType: 'forfait', suggestedPrice: null, duration: null   },
      { name: 'Pose vernis gel',       priceType: 'forfait', suggestedPrice: 35,  duration: '1h'    },
      { name: 'Maquillage événement',  priceType: 'forfait', suggestedPrice: 80,  duration: '1h30'  },
      { name: 'Massage relaxant',      priceType: 'heure',   suggestedPrice: 70,  duration: '1h'    },
      { name: 'Abonnement mensuel',    priceType: 'abonnement', suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Type de prestations principales (coiffure, esthétique, onglerie…)',
      'Déplacement à domicile uniquement ?',
      'Produits fournis ou client amène les siens ?',
    ],

    dashboardMetrics: [
      'rendez-vous du jour',
      'nouveaux clients',
      'taux de fidélisation',
      'prestations phares',
      'avis en attente',
    ],

    recommendations: [
      "[Client] n'a pas pris rendez-vous depuis 6 semaines — relancez",
      "Votre créneau du [jour] est vide — proposez-le à votre liste d'attente",
    ],

    clientFields: [
      'type de cheveux / peau',
      'prestations habituelles',
      'produits allergie',
      'fréquence',
      'remarques',
    ],
  },

  // ─────────────────────────────────────────────
  // GARDE D'ANIMAUX
  // ─────────────────────────────────────────────
  animaux: {
    label: "Garde & soins d'animaux",
    icon: '◯',

    services: [
      { name: 'Promenade chien',       priceType: 'forfait',    suggestedPrice: 15,  duration: '30min' },
      { name: 'Garde à domicile',      priceType: 'jour',       suggestedPrice: 40,  duration: '24h'   },
      { name: 'Garde en famille',      priceType: 'jour',       suggestedPrice: 35,  duration: '24h'   },
      { name: 'Visite à domicile',     priceType: 'forfait',    suggestedPrice: 15,  duration: '30min' },
      { name: 'Soins basiques',        priceType: 'forfait',    suggestedPrice: null, duration: null   },
      { name: 'Bain et toilettage',    priceType: 'forfait',    suggestedPrice: 40,  duration: '1h'    },
      { name: 'Transport vétérinaire', priceType: 'forfait',    suggestedPrice: 25,  duration: null    },
      { name: 'Abonnement promenades', priceType: 'abonnement', suggestedPrice: null, duration: null   },
    ],

    specificFields: [
      'Espèces acceptées (chiens, chats, NAC…)',
      'Garde chez vous ou au domicile du client ?',
      'Capacité maximum simultanée',
    ],

    dashboardMetrics: [
      'animaux en garde',
      'promenades du jour',
      'visites planifiées',
      'clients réguliers',
      'avis en attente',
    ],

    recommendations: [
      '[Client] revient dans [X] jours — réservez la garde maintenant',
      'Votre créneau du [jour] matin est libre',
    ],

    clientFields: [
      "nom de l'animal",
      'espèce / race',
      'âge',
      'vétérinaire',
      'carnet de santé',
      'allergies / régime',
      'comportement',
      'contact urgence',
    ],
  },

  // ─────────────────────────────────────────────
  // DÉMÉNAGEMENT & TRANSPORT LÉGER
  // ─────────────────────────────────────────────
  demenagement: {
    label: 'Déménagement & transport',
    icon: '◪',

    services: [
      { name: 'Déménagement appartement',  priceType: 'devis',   suggestedPrice: null, duration: null },
      { name: 'Transport de meubles',      priceType: 'forfait', suggestedPrice: null, duration: null },
      { name: 'Livraison / enlèvement',    priceType: 'forfait', suggestedPrice: null, duration: null },
      { name: 'Emballage / déballage',     priceType: 'heure',   suggestedPrice: null, duration: null },
      { name: 'Montage / démontage',       priceType: 'heure',   suggestedPrice: null, duration: null },
      { name: 'Portage étages',            priceType: 'majoration', suggestedPrice: null, duration: null },
      { name: 'Stockage garde-meubles',    priceType: 'abonnement', suggestedPrice: null, duration: null },
      { name: 'Débarras / encombrants',    priceType: 'devis',   suggestedPrice: null, duration: null },
      { name: 'Petits déménagements',      priceType: 'forfait', suggestedPrice: null, duration: null },
    ],

    specificFields: [
      'Volume max traité (m³)',
      'Camion propre ou sous-traitance ?',
      'Portage étages possible ?',
    ],

    dashboardMetrics: [
      'déménagements ce mois',
      'devis en attente',
      'km parcourus',
      'volume moyen déplacé',
    ],

    recommendations: [
      'Devis [client] sans réponse depuis [X] jours — relancez',
      'Forte demande [mois] : bloquez vos disponibilités tôt',
    ],

    clientFields: [
      'adresse départ',
      'adresse arrivée',
      'étages (avec / sans ascenseur)',
      'volume estimé',
      'objets fragiles',
      'date souhaitée',
      'flexibilité dates',
    ],
  },

  // ─────────────────────────────────────────────
  // AUTRE (secteur libre — dernier recours)
  // ─────────────────────────────────────────────
  autre: {
    label: 'Autre activité',
    icon: '·',

    services: [],

    specificFields: [],

    dashboardMetrics: [
      'interventions du jour',
      'devis en attente',
      'factures en retard',
      'clients à relancer',
    ],

    recommendations: [
      'Relancez [client] : devis en attente depuis [X] jours',
      'Créneau libre [jour]',
    ],

    clientFields: [],
  },

};
