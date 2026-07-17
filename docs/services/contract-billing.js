/* contract-billing.js — Seba
 * Calcul des echeances de facturation recurrente (contrats). Seba n'a pas
 * de serveur/cron : l'echeance n'est jamais "declenchee" toute seule, elle
 * est simplement comparee a la date du jour au moment ou l'artisan ouvre
 * l'app (voir la regle RULES 'contrats-a-facturer' dans widgets.js, et la
 * section "Contrats a facturer" de factures.html qui fait vraiment la
 * generation).
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.addBillingInterval / contractsDueForBilling.
 */
(function () {
  'use strict';

  /* Avance dateStr (YYYY-MM-DD) de l'intervalle reel de frequency -- pas
   * une comparaison de mois calendaire (qui sur-facture le trimestriel et
   * sous-facture l'hebdomadaire, cf. correctif du 2026-07-17).
   * Tout en Date.UTC/getUTC* : un new Date(dateStr+'T00:00:00') (heure
   * LOCALE) suivi de toISOString() (UTC) decale la date d'un jour des que
   * le fuseau local n'est pas UTC+0 -- deja rencontre en test (2026-08-17
   * calcule a tort 2026-08-16). Rester en UTC de bout en bout l'evite. */
  function addBillingInterval(dateStr, frequency) {
    var parts = dateStr.split('-').map(Number);
    var y = parts[0], m = parts[1], d = parts[2];
    if (frequency === 'week') {
      var wd = new Date(Date.UTC(y, m - 1, d));
      wd.setUTCDate(wd.getUTCDate() + 7);
      return wd.toISOString().slice(0, 10);
    }
    var addMonths = frequency === 'quarter' ? 3 : frequency === 'year' ? 12 : 1;
    var totalMonths = (m - 1) + addMonths;
    var newY = y + Math.floor(totalMonths / 12);
    var newM = (totalMonths % 12) + 1;
    // Ecrete le jour si le mois cible est plus court (ex. 31 janvier + 1 mois -> 28/29 fevrier, pas 3 mars).
    var daysInNewMonth = new Date(Date.UTC(newY, newM, 0)).getUTCDate();
    var newD = Math.min(d, daysInNewMonth);
    return newY + '-' + String(newM).padStart(2, '0') + '-' + String(newD).padStart(2, '0');
  }

  function contractsDueForBilling() {
    if (!window.SebaDB) return [];
    var today = new Date().toISOString().slice(0, 10);
    return SebaDB.list('contrats').filter(function (c) {
      return c.status === 'actif' && c.nextBillingDate && today >= c.nextBillingDate;
    });
  }

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.addBillingInterval = addBillingInterval;
  window.SebaQuotes.contractsDueForBilling = contractsDueForBilling;
})();
