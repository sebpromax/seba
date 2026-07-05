/* ═══════════════════════════════════════════════════════════════
   SEBA — Générateur de factures PDF (100% côté navigateur).
   Construit un gabarit HTML brandé à la volée depuis les données
   SebaDB, puis html2pdf.js (CDN) le compile en PDF téléchargé.
   Aucun serveur, aucune donnée transmise.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function invoiceHTML(f, biz, sym) {
    const dateFmt = f.date ? new Date(f.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const paidRow = f.status === 'payee' && f.paidAt
      ? '<div style="margin-top:6px;color:#1A7A5A;font-weight:600;">Payée le ' + new Date(f.paidAt).toLocaleDateString('fr-FR') + '</div>' : '';
    const statutLbl = { payee: 'PAYÉE', attente: 'EN ATTENTE', retard: 'EN RETARD' }[f.status] || '';
    const statutColor = { payee: '#1A7A5A', attente: '#92400E', retard: '#B5482F' }[f.status] || '#333';
    return (
      '<div style="font-family:Helvetica,Arial,sans-serif;color:#14161A;padding:48px 52px;width:700px;background:#fff;">' +
      '  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;">' +
      '    <div>' +
      '      <div style="font-size:24px;font-weight:800;">' + esc(biz.nom || 'Seba') + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00C896;margin-left:6px;"></span></div>' +
      '      <div style="font-size:12px;color:#6B6A6F;margin-top:4px;">' + esc(biz.pays || '') + (biz.email ? ' · ' + esc(biz.email) : '') + '</div>' +
      '    </div>' +
      '    <div style="text-align:right;">' +
      '      <div style="font-size:20px;font-weight:700;">FACTURE ' + esc(f.num) + '</div>' +
      '      <div style="font-size:12px;color:#6B6A6F;margin-top:4px;">Émise le ' + dateFmt + '</div>' +
      '      <div style="display:inline-block;margin-top:8px;padding:4px 12px;border:2px solid ' + statutColor + ';color:' + statutColor + ';font-weight:700;font-size:12px;border-radius:5px;">' + statutLbl + '</div>' +
      paidRow +
      '    </div>' +
      '  </div>' +
      '  <div style="background:#FAF9F7;border:1px solid #E8E6E1;border-radius:10px;padding:16px 20px;margin-bottom:28px;">' +
      '    <div style="font-size:11px;color:#6B6A6F;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Facturé à</div>' +
      '    <div style="font-size:16px;font-weight:600;">' + esc(f.clientName) + '</div>' +
      '  </div>' +
      '  <table style="width:100%;border-collapse:collapse;font-size:14px;">' +
      '    <thead><tr style="border-bottom:2px solid #14161A;">' +
      '      <th style="text-align:left;padding:10px 4px;">Prestation</th>' +
      '      <th style="text-align:right;padding:10px 4px;">Montant</th>' +
      '    </tr></thead>' +
      '    <tbody><tr style="border-bottom:1px solid #E8E6E1;">' +
      '      <td style="padding:14px 4px;">' + esc(f.service) + '</td>' +
      '      <td style="text-align:right;padding:14px 4px;">' + esc(f.amount) + ' ' + esc(sym) + '</td>' +
      '    </tr></tbody>' +
      '  </table>' +
      '  <div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
      '    <div style="background:#14161A;color:#fff;border-radius:10px;padding:14px 28px;text-align:right;">' +
      '      <div style="font-size:11px;color:#8A91A6;text-transform:uppercase;letter-spacing:.06em;">Total TTC</div>' +
      '      <div style="font-size:26px;font-weight:800;color:#00C896;">' + esc(f.amount) + ' ' + esc(sym) + '</div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="margin-top:56px;padding-top:16px;border-top:1px solid #E8E6E1;font-size:10px;color:#6B6A6F;line-height:1.6;">' +
      '    Document généré par Seba — seba.app. TVA non applicable, art. 293 B du CGI (à adapter selon votre régime fiscal dans les réglages).<br>' +
      '    En cas de retard de paiement, indemnité forfaitaire pour frais de recouvrement : 40 € (art. L441-10 du Code de commerce).' +
      '  </div>' +
      '</div>'
    );
  }

  window.generateInvoicePDF = function (factureId) {
    const f = SebaDB.get('factures', factureId);
    if (!f) { notify('Facture introuvable.'); return; }
    if (typeof html2pdf === 'undefined') { notify('Générateur PDF non chargé — vérifiez votre connexion.'); return; }
    let biz = {};
    try { biz = JSON.parse(localStorage.getItem('sebaEntreprise') || '{}'); } catch (e) {}
    const sym = biz.deviseSymbole || '€';
    notify('Génération du PDF…');

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;';
    host.innerHTML = invoiceHTML(f, biz, sym);
    document.body.appendChild(host);

    const safeName = (f.clientName || 'client').replace(/[^\wàâäéèêëîïôöùûüç -]/gi, '').replace(/\s+/g, '_');
    html2pdf().set({
      margin: 0,
      filename: 'Facture_' + f.num.replace(/[#]/g, '') + '_' + safeName + '.pdf',
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(host.firstChild).save().then(() => {
      host.remove();
      SebaDB.log('facture', 'PDF généré — facture ' + f.num + ' (' + f.clientName + ')', 'factures.html');
      notify('Facture ' + f.num + ' téléchargée ✓');
    }).catch((e) => { host.remove(); notify('Échec de génération : ' + e.message); });
  };

  function notify(msg) {
    if (typeof window.showFactToast === 'function') window.showFactToast(msg);
    else if (typeof window.showToast === 'function') window.showToast(msg);
    else console.log('[Seba PDF]', msg);
  }
})();
