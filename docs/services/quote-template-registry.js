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
