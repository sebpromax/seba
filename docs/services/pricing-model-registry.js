/* pricing-model-registry.js — Seba
 * Registre des 7 modèles tarifaires du moteur de devis multi-format.
 * Script classique (pas de type="module" : casse en file:// via CORS,
 * voir docs/src/ui/dashboard-init.js pour un exemple déjà rencontré dans
 * ce projet). Expose window.SebaQuotes.PRICING_MODELS, même convention que
 * window.SebaDB / window.businessTypes.
 *
 * Chaque modèle : id, label, description, requiredFields (clés de la ligne
 * de devis attendues), units (unités compatibles), validate(line) -> {valid, errors}.
 */
(function () {
  'use strict';

  var PRICING_MODELS = {
    hourly: {
      id: 'hourly',
      label: 'Taux horaire',
      description: 'Facturation basée sur le temps passé (Heures x Taux horaire).',
      requiredFields: ['duration', 'hourlyRate'],
      units: ['hour'],
      validate: function (line) {
        var errors = [];
        if (line.duration === undefined || line.duration === null || line.duration <= 0) {
          errors.push('La durée doit être supérieure à 0.');
        }
        if (line.hourlyRate === undefined || line.hourlyRate === null || line.hourlyRate < 0) {
          errors.push('Le taux horaire ne peut pas être négatif.');
        }
        return { valid: errors.length === 0, errors: errors };
      }
    },
    fixed: {
      id: 'fixed',
      label: 'Forfait / Prix fixe',
      description: 'Montant forfaitaire unique indépendant du temps passé.',
      requiredFields: ['fixedPrice'],
      units: ['package'],
      validate: function (line) {
        var errors = [];
        if (line.fixedPrice === undefined || line.fixedPrice === null || line.fixedPrice < 0) {
          errors.push('Le prix forfaitaire ne peut pas être négatif.');
        }
        return { valid: errors.length === 0, errors: errors };
      }
    },
    unit: {
      id: 'unit',
      label: 'Unitaire',
      description: "Facturation à l'unité métier (m2, vitres, pièces, km...).",
      requiredFields: ['quantity', 'unitPrice', 'unit'],
      units: ['square_meter', 'window', 'room', 'km', 'item', 'passage'],
      validate: function (line) {
        var errors = [];
        if (line.quantity === undefined || line.quantity === null || line.quantity <= 0) {
          errors.push('La quantité doit être supérieure à 0.');
        }
        if (line.unitPrice === undefined || line.unitPrice === null || line.unitPrice < 0) {
          errors.push('Le prix unitaire ne peut pas être négatif.');
        }
        if (!line.unit) {
          errors.push("L'unité de mesure est requise.");
        }
        return { valid: errors.length === 0, errors: errors };
      }
    },
    subscription: {
      id: 'subscription',
      label: 'Abonnement / Contrat récurrent',
      description: 'Facturation récurrente périodique (mensuelle, hebdomadaire...).',
      requiredFields: ['recurringPrice', 'frequency'],
      units: ['month', 'week', 'quarter', 'year'],
      validate: function (line) {
        var errors = [];
        if (line.recurringPrice === undefined || line.recurringPrice === null || line.recurringPrice < 0) {
          errors.push("Le montant de l'abonnement ne peut pas être négatif.");
        }
        if (!line.frequency) {
          errors.push('La fréquence de facturation est requise.');
        }
        return { valid: errors.length === 0, errors: errors };
      }
    },
    quote_only: {
      id: 'quote_only',
      label: 'Sur étude (prix après visite)',
      description: 'Prestation nécessitant un examen avant tarification.',
      requiredFields: [],
      units: [],
      validate: function () {
        return { valid: true, errors: [] };
      }
    },
    included: {
      id: 'included',
      label: 'Inclus dans formule / contrat',
      description: "Service inclus d'office dans l'offre globale, sans surcoût.",
      requiredFields: [],
      units: [],
      validate: function () {
        return { valid: true, errors: [] };
      }
    },
    day_rate: {
      id: 'day_rate',
      label: 'Taux journalier',
      description: 'Facturation à la journée ou demi-journée.',
      requiredFields: ['dayCount', 'dayRate'],
      units: ['day'],
      validate: function (line) {
        var errors = [];
        if (line.dayCount === undefined || line.dayCount === null || line.dayCount <= 0) {
          errors.push('Le nombre de jours doit être supérieur à 0.');
        }
        if (line.dayRate === undefined || line.dayRate === null || line.dayRate < 0) {
          errors.push('Le tarif journalier ne peut pas être négatif.');
        }
        return { valid: errors.length === 0, errors: errors };
      }
    }
  };

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.PRICING_MODELS = PRICING_MODELS;
})();
