/* quote-template-registry.js — Seba
 * Registre des modèles ("formats") de devis proposés selon le secteur
 * d'activité. Pilote sur le secteur "menage" (clé réelle de
 * window.businessTypes, docs/businessTypes.js) ; sectorId doit toujours
 * correspondre à une clé existante de businessTypes, ou 'all' pour un
 * modèle proposé quel que soit le secteur.
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.QUOTE_TEMPLATES.
 */
(function () {
  'use strict';

  var QUOTE_TEMPLATES = {
    menage_ponctuel: {
      id: 'menage_ponctuel',
      sectorId: 'menage',
      name: 'Intervention ponctuelle',
      description: 'Ménage de printemps ou prestation unique.',
      allowedPricingModels: ['hourly', 'fixed', 'unit', 'quote_only'],
      defaultPricingModel: 'hourly'
    },
    menage_recurrent: {
      id: 'menage_recurrent',
      sectorId: 'menage',
      name: "Contrat d'entretien récurrent",
      description: 'Prestations périodiques avec engagement.',
      allowedPricingModels: ['subscription', 'fixed', 'hourly'],
      defaultPricingModel: 'subscription'
    },
    menage_airbnb: {
      id: 'menage_airbnb',
      sectorId: 'menage',
      name: 'Location saisonnière (Airbnb)',
      description: 'Rotations de locataires, linge et consommables.',
      allowedPricingModels: ['fixed', 'unit', 'subscription'],
      defaultPricingModel: 'fixed'
    },
    menage_bureaux: {
      id: 'menage_bureaux',
      sectorId: 'menage',
      name: 'Entretien de bureaux',
      description: 'Nettoyage de locaux professionnels.',
      allowedPricingModels: ['subscription', 'unit', 'fixed', 'hourly', 'quote_only'],
      defaultPricingModel: 'subscription'
    },
    menage_chantier: {
      id: 'menage_chantier',
      sectorId: 'menage',
      name: 'Nettoyage après chantier',
      description: 'Remise en état après travaux, évacuation des déchets.',
      allowedPricingModels: ['unit', 'fixed', 'day_rate', 'quote_only'],
      defaultPricingModel: 'unit'
    },
    menage_vitres: {
      id: 'menage_vitres',
      sectorId: 'menage',
      name: 'Nettoyage de vitres',
      description: 'Surfaces vitrées, options accessibilité.',
      allowedPricingModels: ['unit', 'hourly', 'fixed', 'quote_only'],
      defaultPricingModel: 'unit'
    },
    conciergerie_rotation: {
      id: 'conciergerie_rotation',
      sectorId: 'conciergerie',
      name: 'Rotation voyageur',
      description: 'Check-in, check-out et ménage entre deux séjours.',
      allowedPricingModels: ['fixed', 'unit', 'hourly', 'quote_only'],
      defaultPricingModel: 'fixed'
    },
    conciergerie_gestion_mensuelle: {
      id: 'conciergerie_gestion_mensuelle',
      sectorId: 'conciergerie',
      name: 'Gestion mensuelle complète',
      description: 'Linge, communication voyageurs, rapports propriétaire.',
      allowedPricingModels: ['subscription', 'fixed'],
      defaultPricingModel: 'subscription'
    },
    conciergerie_maintenance: {
      id: 'conciergerie_maintenance',
      sectorId: 'conciergerie',
      name: 'Maintenance & urgences',
      description: 'Petite intervention ou urgence signalée par un voyageur.',
      allowedPricingModels: ['hourly', 'fixed', 'quote_only'],
      defaultPricingModel: 'quote_only'
    },

    copro_forfait_mensuel: {
      id: 'copro_forfait_mensuel',
      sectorId: 'conciergerieCopro',
      name: 'Forfait de gestion mensuelle',
      description: 'Accès, colis, surveillance et entretien des parties communes.',
      allowedPricingModels: ['subscription', 'fixed'],
      defaultPricingModel: 'subscription'
    },
    copro_travaux: {
      id: 'copro_travaux',
      sectorId: 'conciergerieCopro',
      name: 'Petits travaux & dépannage',
      description: 'Intervention ponctuelle signalée par un résident ou le syndic.',
      allowedPricingModels: ['hourly', 'fixed', 'quote_only'],
      defaultPricingModel: 'hourly'
    },
    copro_prestataires: {
      id: 'copro_prestataires',
      sectorId: 'conciergerieCopro',
      name: 'Coordination de prestataires',
      description: 'Mise en relation et suivi d’un prestataire externe.',
      allowedPricingModels: ['fixed', 'quote_only'],
      defaultPricingModel: 'fixed'
    },

    entreprise_abonnement: {
      id: 'entreprise_abonnement',
      sectorId: 'conciergerieEntreprise',
      name: 'Abonnement services aux salariés',
      description: 'Accueil, livraisons, services récurrents pour les employés.',
      allowedPricingModels: ['subscription', 'fixed'],
      defaultPricingModel: 'subscription'
    },
    entreprise_evenement: {
      id: 'entreprise_evenement',
      sectorId: 'conciergerieEntreprise',
      name: 'Organisation d’événement',
      description: 'Événement ponctuel à organiser pour l’entreprise cliente.',
      allowedPricingModels: ['quote_only', 'fixed'],
      defaultPricingModel: 'quote_only'
    },
    entreprise_ponctuel: {
      id: 'entreprise_ponctuel',
      sectorId: 'conciergerieEntreprise',
      name: 'Mission ponctuelle',
      description: 'Courses, tâches administratives, assistance ponctuelle.',
      allowedPricingModels: ['hourly', 'fixed'],
      defaultPricingModel: 'hourly'
    },

    jardinage_ponctuel: {
      id: 'jardinage_ponctuel',
      sectorId: 'jardinage',
      name: 'Intervention ponctuelle',
      description: 'Tonte, taille, désherbage ou nettoyage extérieur.',
      allowedPricingModels: ['fixed', 'unit', 'hourly', 'quote_only'],
      defaultPricingModel: 'fixed'
    },
    jardinage_contrat_annuel: {
      id: 'jardinage_contrat_annuel',
      sectorId: 'jardinage',
      name: 'Contrat d’entretien annuel',
      description: 'Passages réguliers sur l’année, engagement contractuel.',
      allowedPricingModels: ['subscription', 'fixed'],
      defaultPricingModel: 'subscription'
    },
    jardinage_amenagement: {
      id: 'jardinage_amenagement',
      sectorId: 'jardinage',
      name: 'Aménagement / plantation',
      description: 'Projet nécessitant une étude avant chiffrage.',
      allowedPricingModels: ['quote_only', 'fixed', 'day_rate'],
      defaultPricingModel: 'quote_only'
    },

    maintenance_horaire: {
      id: 'maintenance_horaire',
      sectorId: 'maintenance',
      name: 'Intervention à l’heure',
      description: 'Petite réparation, plomberie ou électricité légère.',
      allowedPricingModels: ['hourly', 'quote_only'],
      defaultPricingModel: 'hourly'
    },
    maintenance_forfait: {
      id: 'maintenance_forfait',
      sectorId: 'maintenance',
      name: 'Forfait travaux',
      description: 'Montage, peinture ou diagnostic à prix fixe.',
      allowedPricingModels: ['fixed', 'unit', 'quote_only'],
      defaultPricingModel: 'fixed'
    },
    maintenance_urgence: {
      id: 'maintenance_urgence',
      sectorId: 'maintenance',
      name: 'Dépannage urgent',
      description: 'Intervention rapide, majoration possible sur le prix.',
      allowedPricingModels: ['hourly', 'fixed', 'quote_only'],
      defaultPricingModel: 'fixed'
    },

    pressing_ponctuel: {
      id: 'pressing_ponctuel',
      sectorId: 'pressing',
      name: 'Commande ponctuelle',
      description: 'Repassage, nettoyage textile ou cuir/daim.',
      allowedPricingModels: ['fixed', 'unit'],
      defaultPricingModel: 'fixed'
    },
    pressing_abonnement: {
      id: 'pressing_abonnement',
      sectorId: 'pressing',
      name: 'Abonnement hebdomadaire',
      description: 'Collecte et livraison régulières.',
      allowedPricingModels: ['subscription'],
      defaultPricingModel: 'subscription'
    },
    pressing_express: {
      id: 'pressing_express',
      sectorId: 'pressing',
      name: 'Service express',
      description: 'Livraison sous 24h, tarif majoré.',
      allowedPricingModels: ['fixed', 'quote_only'],
      defaultPricingModel: 'fixed'
    },

    beaute_prestation: {
      id: 'beaute_prestation',
      sectorId: 'beaute',
      name: 'Prestation à domicile',
      description: 'Coupe, soin, épilation ou pose vernis.',
      allowedPricingModels: ['fixed', 'hourly', 'quote_only'],
      defaultPricingModel: 'fixed'
    },
    beaute_evenement: {
      id: 'beaute_evenement',
      sectorId: 'beaute',
      name: 'Prestation événement',
      description: 'Mariage, groupe ou prestation sur mesure.',
      allowedPricingModels: ['quote_only', 'fixed'],
      defaultPricingModel: 'quote_only'
    },
    beaute_abonnement: {
      id: 'beaute_abonnement',
      sectorId: 'beaute',
      name: 'Abonnement mensuel',
      description: 'Suivi régulier du client tout au long du mois.',
      allowedPricingModels: ['subscription'],
      defaultPricingModel: 'subscription'
    },

    animaux_ponctuel: {
      id: 'animaux_ponctuel',
      sectorId: 'animaux',
      name: 'Prestation ponctuelle',
      description: 'Promenade, visite à domicile ou toilettage.',
      allowedPricingModels: ['fixed', 'hourly'],
      defaultPricingModel: 'fixed'
    },
    animaux_garde: {
      id: 'animaux_garde',
      sectorId: 'animaux',
      name: 'Garde à la journée',
      description: 'Garde à domicile ou en famille d’accueil.',
      allowedPricingModels: ['day_rate', 'fixed'],
      defaultPricingModel: 'day_rate'
    },
    animaux_abonnement: {
      id: 'animaux_abonnement',
      sectorId: 'animaux',
      name: 'Abonnement promenades',
      description: 'Promenades régulières sur la semaine ou le mois.',
      allowedPricingModels: ['subscription'],
      defaultPricingModel: 'subscription'
    },

    demenagement_petit: {
      id: 'demenagement_petit',
      sectorId: 'demenagement',
      name: 'Petit déménagement / transport',
      description: 'Transport de meubles, livraison ou enlèvement.',
      allowedPricingModels: ['fixed', 'hourly', 'unit'],
      defaultPricingModel: 'fixed'
    },
    demenagement_complet: {
      id: 'demenagement_complet',
      sectorId: 'demenagement',
      name: 'Déménagement complet',
      description: 'Volume important, chiffrage après étude du besoin.',
      allowedPricingModels: ['quote_only', 'fixed'],
      defaultPricingModel: 'quote_only'
    },
    demenagement_stockage: {
      id: 'demenagement_stockage',
      sectorId: 'demenagement',
      name: 'Stockage garde-meubles',
      description: 'Location d’espace de stockage, facturation récurrente.',
      allowedPricingModels: ['subscription'],
      defaultPricingModel: 'subscription'
    },

    custom_quote: {
      id: 'custom_quote',
      sectorId: 'all',
      name: 'Devis personnalisé',
      description: 'Modèle libre, sans contrainte métier préétablie.',
      allowedPricingModels: ['hourly', 'fixed', 'unit', 'subscription', 'quote_only', 'included', 'day_rate'],
      defaultPricingModel: 'hourly'
    }
  };

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.QUOTE_TEMPLATES = QUOTE_TEMPLATES;

  window.SebaQuotes.templatesForSector = function (sectorId) {
    var out = [];
    for (var key in QUOTE_TEMPLATES) {
      var t = QUOTE_TEMPLATES[key];
      if (t.sectorId === sectorId || t.sectorId === 'all') out.push(t);
    }
    return out;
  };
})();
