/* legacy-quote-adapter.js — Seba
 * Adapte les devis stockés au format "v1" (une seule prestation, calcul
 * heures x taux implicite, aucun pricingModel) vers la forme normalisée
 * attendue par le moteur multi-format, sans jamais réécrire les données
 * en base : purement en lecture, à l'affichage.
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.adaptLegacyQuote.
 */
(function () {
  'use strict';

  function adaptLegacyQuote(legacyQuote) {
    if (!legacyQuote) return null;

    if (legacyQuote.lines && legacyQuote.lines.length > 0 && legacyQuote.lines[0].pricingModel) {
      return legacyQuote;
    }

    var adaptedLines = [];

    if (legacyQuote.lines && legacyQuote.lines.length > 0) {
      legacyQuote.lines.forEach(function (line, index) {
        var qty = line.qty || 1;
        var rate = line.u || legacyQuote.hourlyRate || 0;
        adaptedLines.push({
          id: line.id || ('line_' + Date.now() + '_' + index),
          title: line.desc || legacyQuote.service || 'Prestation de service',
          pricingModel: 'hourly',
          quantity: qty,
          unit: 'hour',
          unitPrice: rate,
          duration: qty,
          hourlyRate: rate,
          total: qty * rate
        });
      });
    } else {
      var duration = legacyQuote.duration || 1;
      var hourlyRate = legacyQuote.hourlyRate || 0;
      adaptedLines.push({
        id: 'line_' + Date.now() + '_0',
        title: legacyQuote.service || 'Prestation de service',
        pricingModel: 'hourly',
        quantity: duration,
        unit: 'hour',
        unitPrice: hourlyRate,
        duration: duration,
        hourlyRate: hourlyRate,
        total: duration * hourlyRate
      });
    }

    var out = {};
    for (var k in legacyQuote) out[k] = legacyQuote[k];
    out.lines = adaptedLines;
    if (out.amount === undefined || out.amount === null) {
      out.amount = adaptedLines.reduce(function (sum, l) { return sum + (l.total || 0); }, 0);
    }
    return out;
  }

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.adaptLegacyQuote = adaptLegacyQuote;
})();
