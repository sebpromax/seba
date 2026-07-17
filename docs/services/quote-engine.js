/* quote-engine.js — Seba
 * Moteur de calcul et de validation des lignes/devis multi-format.
 * Isole les mathématiques financières de l'interface (une seule source de
 * vérité pour les totaux, testable indépendamment du formulaire).
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi -- pas
 * de type="module", casse en file://). Dépend de PRICING_MODELS (charger
 * pricing-model-registry.js avant ce fichier). Expose :
 *   window.SebaQuotes.calculateQuoteLine(line, context)
 *   window.SebaQuotes.calculateQuoteTotals(lines, globalAdjustments)
 *
 * Remises/options de ligne, remise globale, TVA et acompte sont supportés
 * ici en tant que fonctions PURES, prêtes pour une future UI -- mais aucune
 * page de Seba n'expose aujourd'hui de champ TVA/remise sur un devis (seule
 * registre-charges.html en parle, pour la comptabilité interne, sans lien
 * avec les devis clients). calculateQuoteTotals() n'est donc PAS branché
 * sur le total réellement enregistré par devis-nouveau.html tant qu'aucun
 * champ UI ne permet à l'utilisateur de voir/régler ces valeurs -- les
 * appliquer en silence gonflerait le montant affiché au client sans son
 * consentement ni le vôtre.
 */
(function () {
  'use strict';

  window.SebaQuotes = window.SebaQuotes || {};

  function calculateQuoteLine(line, context) {
    context = context || {};
    const modelId = line.pricingModel;
    const model = window.SebaQuotes.PRICING_MODELS && window.SebaQuotes.PRICING_MODELS[modelId];

    if (!model) {
      return { valid: false, subtotal: 0, total: 0, errors: ['Modèle tarifaire inconnu ou non pris en charge.'], calculationDetails: [] };
    }

    const validation = model.validate(line);
    if (!validation.valid) {
      return { valid: false, subtotal: null, total: null, errors: validation.errors, calculationDetails: [] };
    }

    let subtotal = 0;
    const details = [];

    switch (modelId) {
      case 'hourly': {
        const duration = Number(line.duration) || 0;
        const rate = Number(line.hourlyRate) || 0;
        const workers = Number(line.workerCount) || 1;
        subtotal = duration * rate * workers;
        details.push(duration + 'h × ' + rate + ' €/h' + (workers > 1 ? ' × ' + workers + ' intervenant(s)' : ''));
        break;
      }
      case 'fixed': {
        const qtyFixed = Number(line.quantity) || 1;
        const fixedPrice = Number(line.fixedPrice) || 0;
        subtotal = qtyFixed * fixedPrice;
        details.push(qtyFixed + ' forfait(s) × ' + fixedPrice + ' €');
        break;
      }
      case 'unit': {
        const qtyUnit = Number(line.quantity) || 0;
        const unitPrice = Number(line.unitPrice) || 0;
        const unitLabel = line.unit || 'unité';
        subtotal = qtyUnit * unitPrice;
        details.push(qtyUnit + ' ' + unitLabel + '(s) × ' + unitPrice + ' €');
        break;
      }
      case 'subscription': {
        const recurringPrice = Number(line.recurringPrice) || 0;
        const frequency = line.frequency || 'month';
        subtotal = recurringPrice;
        details.push('Abonnement : ' + recurringPrice + ' € par ' + frequency);
        break;
      }
      case 'day_rate': {
        const dayCount = Number(line.dayCount) || 0;
        const dayRate = Number(line.dayRate) || 0;
        subtotal = dayCount * dayRate;
        details.push(dayCount + ' jour(s) × ' + dayRate + ' €/jour');
        break;
      }
      case 'quote_only': {
        subtotal = null;
        details.push('Tarification sur étude — aucun montant immédiat');
        break;
      }
      case 'included': {
        subtotal = 0;
        details.push("Prestation incluse d'office");
        break;
      }
    }

    let adjustmentsTotal = 0;
    let discountTotal = 0;

    if (subtotal !== null) {
      if (Array.isArray(line.options)) {
        line.options.forEach(function (opt) {
          if (opt.checked) {
            const val = Number(opt.price) || 0;
            adjustmentsTotal += val;
            details.push('Option [' + opt.label + '] : +' + val + ' €');
          }
        });
      }
      if (line.discount) {
        const disc = line.discount;
        if (disc.type === 'percentage') {
          discountTotal = (subtotal * (Number(disc.value) || 0)) / 100;
          details.push('Remise (' + disc.value + '%) : -' + discountTotal.toFixed(2) + ' €');
        } else if (disc.type === 'fixed') {
          discountTotal = Number(disc.value) || 0;
          details.push('Remise fixe : -' + discountTotal + ' €');
        }
      }
    }

    const lineTotal = subtotal !== null ? Math.max(0, subtotal + adjustmentsTotal - discountTotal) : null;

    return {
      valid: true,
      subtotal: subtotal,
      adjustmentsTotal: adjustmentsTotal,
      discountTotal: discountTotal,
      total: lineTotal,
      errors: [],
      calculationDetails: details
    };
  }

  function calculateQuoteTotals(lines, globalAdjustments) {
    lines = lines || [];
    globalAdjustments = globalAdjustments || {};
    let subtotal = 0;
    let containsQuoteOnly = false;
    const errors = [];

    lines.forEach(function (line, index) {
      const result = calculateQuoteLine(line);
      if (!result.valid) {
        errors.push('Erreur sur la ligne ' + (index + 1) + ' : ' + result.errors.join(', '));
        return;
      }
      if (result.total === null) {
        containsQuoteOnly = true;
      } else {
        subtotal += result.total;
      }
    });

    if (containsQuoteOnly && subtotal === 0 && lines.every(function (l) { return l.pricingModel === 'quote_only'; })) {
      return { valid: errors.length === 0, subtotal: null, total: null, taxTotal: null, errors: errors, isQuoteOnly: true };
    }

    let globalDiscount = 0;
    if (globalAdjustments.discount) {
      const disc = globalAdjustments.discount;
      if (disc.type === 'percentage') {
        globalDiscount = (subtotal * (Number(disc.value) || 0)) / 100;
      } else if (disc.type === 'fixed') {
        globalDiscount = Number(disc.value) || 0;
      }
    }

    const postDiscountTotal = Math.max(0, subtotal - globalDiscount);

    /* Pas de taxRate par défaut (contrairement à une première version de ce
       fichier qui appliquait 20% implicitement) : beaucoup de professionnels
       Seba sont en franchise de TVA (auto-entrepreneurs), le calcul TTC
       réel dépend d'un statut fiscal que ce moteur ne connaît pas -- un
       taux non nul doit venir explicitement de l'appelant. */
    const taxRate = Number(globalAdjustments.taxRate) || 0;
    const taxTotal = (postDiscountTotal * taxRate) / 100;
    const finalTotal = postDiscountTotal + taxTotal;

    let depositAmount = 0;
    if (globalAdjustments.depositPercentage) {
      depositAmount = (finalTotal * (Number(globalAdjustments.depositPercentage) || 0)) / 100;
    }

    return {
      valid: errors.length === 0,
      subtotal: subtotal,
      discountTotal: globalDiscount,
      taxTotal: taxTotal,
      total: finalTotal,
      depositAmount: depositAmount > 0 ? depositAmount : null,
      errors: errors,
      isQuoteOnly: false
    };
  }

  window.SebaQuotes.calculateQuoteLine = calculateQuoteLine;
  window.SebaQuotes.calculateQuoteTotals = calculateQuoteTotals;
})();
