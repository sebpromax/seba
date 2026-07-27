// SEBA — Rendu documentaire partagé (feature/flexible-commercial-documents,
// éditeurs). Extrait tel quel des 3 pages document (devis/facture/reçu) --
// UNE SEULE fonction par type de document, appelée à la fois par les pages
// documentaires autonomes (devis-document.html/facture-document.html/
// recu-document.html) ET par l'onglet Aperçu des éditeurs
// (devis-nouveau.html/factures-nouvelle.html), pour qu'aucune divergence
// entre aperçu et document final ne soit possible par construction (section
// 25 du chantier : "Interdiction de maintenir deux templates différents.").
//
// Chaque fonction retourne UNIQUEMENT le HTML du contenu imprimable (le
// conteneur .a4), jamais la barre d'outils (page-spécifique, restée dans
// chaque hôte). CSS partagée séparément dans commercial-document.css.
(function (global) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function eur(cents) { return ((Number(cents) || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function eurAmount(v) { return (Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'; }

  const QUOTE_STATUS_LABEL = { brouillon: 'BROUILLON — NON ENVOYÉ', attente: 'EN ATTENTE DE RÉPONSE', signe: 'ACCEPTÉ', refuse: 'REFUSÉ', annule: 'ANNULÉ', expire: 'EXPIRÉ' };
  const INVOICE_STATUS_LABEL = { draft: 'BROUILLON', issued: 'ÉMISE', partially_paid: 'PARTIELLEMENT PAYÉE', paid: 'PAYÉE', overdue: 'EN RETARD', cancelled: 'ANNULÉE', attente: 'ÉMISE', payee: 'PAYÉE', retard: 'EN RETARD' };

  function quoteHTML(model) {
    if (!model) return '<div class="empty-state"><p>Devis introuvable.</p></div>';
    const linesHtml = model.lines.map(l => (
      '<tr><td>' + esc(l.description) + (l.details ? '<div style="color:var(--doc-muted);font-size:0.78rem;">' + esc(l.details) + '</div>' : '') + '</td>' +
      '<td class="num-col">' + (l.quantity || 0) + (l.unit ? ' ' + esc(l.unit) : '') + '</td>' +
      '<td class="num-col">' + eur(l.unitPriceCents) + '</td>' +
      '<td class="num-col">' + (l.discountCents ? '-' + eur(l.discountCents) : '—') + '</td>' +
      '<td class="num-col">' + eur(l.totalExcludingTaxCents) + '</td></tr>'
    )).join('');

    let acceptanceHtml = '';
    if (model.acceptance) {
      if (model.acceptance.acceptedAt) acceptanceHtml = '<div class="doc-acceptance accepted">Devis accepté le ' + fmtDate(model.acceptance.acceptedAt) + '.</div>';
      else if (model.acceptance.refusedAt) acceptanceHtml = '<div class="doc-acceptance">Devis refusé le ' + fmtDate(model.acceptance.refusedAt) + (model.acceptance.refusalComment ? ' — ' + esc(model.acceptance.refusalComment) : '') + '</div>';
    }
    if (model.references.supersededByQuoteId) acceptanceHtml = '<div class="doc-acceptance">REMPLACÉ PAR UNE NOUVELLE VERSION.</div>' + acceptanceHtml;

    const byRateHtml = (model.totals.byRate || []).length > 1
      ? model.totals.byRate.map(r => '<div class="row"><span>TVA ' + r.rate + '%</span><span>' + eur(r.taxCents) + '</span></div>').join('')
      : '';

    return `
    <div class="a4">
      <div class="doc-head">
        <div class="company">
          <h2>${esc((model.company && model.company.nom) || 'Entreprise')}</h2>
          <p>${esc((model.company && model.company.email) || '')}${model.company && model.company.telephone ? ' · ' + esc(model.company.telephone) : ''}</p>
          <p>${esc((model.company && model.company.zone) || '')}</p>
        </div>
        <div class="meta">
          <div class="doctype">DEVIS</div>
          <div class="docnum">${esc(model.documentNumber || 'BROUILLON')}${model.revisionNumber > 1 ? ' · v' + model.revisionNumber : ''}</div>
          <div style="font-size:0.8rem;color:var(--doc-muted);margin-top:4px;">${fmtDate(model.issueDate)}</div>
          <div class="status-pill">${QUOTE_STATUS_LABEL[model.status] || model.status}</div>
        </div>
      </div>
      <div class="doc-parties">
        <div class="block">
          <h4>Client</h4>
          <p>${esc(((model.customer.prenom || '') + ' ' + (model.customer.nom || '')).trim() || '—')}
${esc(model.billingAddress || '')}
${esc(model.customer.email || '')}${model.clientReference ? '\nRéf. client : ' + esc(model.clientReference) : ''}</p>
        </div>
        <div class="block">
          <h4>Validité</h4>
          <p>${model.validityDate ? fmtDate(model.validityDate) : 'Non spécifiée'}</p>
        </div>
      </div>
      <table class="doc-lines">
        <thead><tr><th>Prestation</th><th class="num-col">Qté</th><th class="num-col">Prix unit.</th><th class="num-col">Remise</th><th class="num-col">Total HT</th></tr></thead>
        <tbody>${linesHtml || '<tr><td colspan="5" style="color:var(--doc-muted);">Aucune ligne.</td></tr>'}</tbody>
      </table>
      <div class="doc-totals">
        <div class="row"><span>Total HT</span><span>${eur(model.totals.totalExclCents)}</span></div>
        ${model.totals.globalDiscountCents ? '<div class="row"><span>Remise</span><span>-' + eur(model.totals.globalDiscountCents) + '</span></div>' : ''}
        ${byRateHtml}
        <div class="row"><span>TVA</span><span>${eur(model.totals.totalTaxCents)}</span></div>
        <div class="row grand"><span>Total TTC</span><span>${eur(model.totals.totalInclCents)}</span></div>
        ${model.totals.depositCents ? '<div class="row deposit"><span>Acompte demandé</span><span>' + eur(model.totals.depositCents) + '</span></div><div class="row"><span>Solde après acompte</span><span>' + eur(model.totals.balanceAfterDepositCents) + '</span></div>' : ''}
      </div>
      ${model.terms.conditions ? '<div class="doc-terms">' + esc(model.terms.conditions) + '</div>' : ''}
      ${acceptanceHtml}
      <div class="doc-footer-text">Document généré par Seba.</div>
    </div>`;
  }

  function invoiceHTML(model) {
    if (!model) return '<div class="empty-state"><p>Facture introuvable.</p></div>';
    const isPaid = model.status === 'paid' || model.status === 'payee';
    const linesHtml = model.lines.map(l => (
      '<tr><td>' + esc(l.description) + (l.details ? '<div style="color:var(--doc-muted);font-size:0.78rem;">' + esc(l.details) + '</div>' : '') + '</td>' +
      '<td class="num-col">' + (l.quantity || 0) + (l.unit ? ' ' + esc(l.unit) : '') + '</td>' +
      '<td class="num-col">' + eur(l.unitPriceCents) + '</td>' +
      '<td class="num-col">' + eur(l.totalExcludingTaxCents) + '</td></tr>'
    )).join('');

    const paymentsHtml = model.payments.length ? `
      <div class="payments-block">
        <h4>Paiements enregistrés</h4>
        <table><thead><tr><th>Date</th><th>Montant</th><th>Méthode</th><th>Référence</th></tr></thead>
        <tbody>${model.payments.map(p => '<tr><td>' + fmtDate(p.date) + '</td><td>' + eur(Math.round(p.amount * 100)) + '</td><td>' + esc(p.mode || '') + '</td><td>' + esc(p.reference || '') + '</td></tr>').join('')}</tbody></table>
      </div>` : '';

    const balanceCents = Math.round(((model.solde != null ? model.solde : 0)) * 100);

    return `
    <div class="a4">
      <div class="doc-head">
        <div class="company">
          <h2>${esc((model.company && model.company.nom) || 'Entreprise')}</h2>
          <p>${esc((model.company && model.company.email) || '')}${model.company && model.company.telephone ? ' · ' + esc(model.company.telephone) : ''}</p>
        </div>
        <div class="meta">
          <div class="doctype">FACTURE</div>
          <div class="docnum">${esc(model.documentNumber || 'BROUILLON')}</div>
          <div style="font-size:0.8rem;color:var(--doc-muted);margin-top:4px;">${model.documentNumber ? 'Émise le ' + fmtDate(model.issueDate) : 'Non émise'}${model.dueDate ? ' · échéance ' + fmtDate(model.dueDate) : ''}</div>
          <div class="status-pill${isPaid ? ' paid' : ''}">${INVOICE_STATUS_LABEL[model.status] || model.status}</div>
        </div>
      </div>
      <div class="doc-parties">
        <div class="block">
          <h4>Client</h4>
          <p>${esc(((model.customer.prenom || '') + ' ' + (model.customer.nom || '')).trim() || '—')}
${esc(model.billingAddress || '')}
${esc(model.customer.email || '')}</p>
        </div>
        <div class="block">
          <h4>Origine</h4>
          <p>${model.references.devisId ? 'Devis source lié' : (model.references.interventionId ? 'Intervention source liée' : 'Facture libre')}</p>
        </div>
      </div>
      <table class="doc-lines">
        <thead><tr><th>Prestation</th><th class="num-col">Qté</th><th class="num-col">Prix unit.</th><th class="num-col">Total HT</th></tr></thead>
        <tbody>${linesHtml || '<tr><td colspan="4" style="color:var(--doc-muted);">Aucune ligne.</td></tr>'}</tbody>
      </table>
      <div class="doc-totals">
        <div class="row"><span>Total HT</span><span>${eur(model.totals.totalExclCents)}</span></div>
        <div class="row"><span>TVA</span><span>${eur(model.totals.totalTaxCents)}</span></div>
        <div class="row grand"><span>Total TTC</span><span>${eur(model.totals.totalInclCents)}</span></div>
        <div class="row"><span>Payé</span><span>${eur(Math.round((model.montantPaye || 0) * 100))}</span></div>
        <div class="row balance"><span>Solde</span><span>${eur(balanceCents)}</span></div>
      </div>
      ${isPaid ? '<div class="paid-banner">PAYÉE — Solde : 0,00 €</div>' : ''}
      ${paymentsHtml}
      ${model.terms.conditions ? '<div style="margin-top:20px;font-size:0.8rem;color:var(--doc-muted);white-space:pre-line;">' + esc(model.terms.conditions) + '</div>' : ''}
      <div class="doc-footer-text">Document généré par Seba.</div>
    </div>`;
  }

  function receiptHTML(model) {
    if (!model) return '<div class="empty-state"><p>Reçu introuvable.</p></div>';
    return `
    <div class="a4">
      <div class="doc-head">
        <div class="company">
          <h2>${esc((model.company && model.company.nom) || 'Entreprise')}</h2>
          <p>${esc((model.company && model.company.email) || '')}</p>
        </div>
        <div class="meta">
          <div class="doctype">REÇU</div>
          <div class="docnum">Facture ${esc(model.references.invoiceNumber || '')}</div>
          <div style="font-size:0.8rem;color:var(--doc-muted);margin-top:4px;">${fmtDate(model.issueDate)}</div>
        </div>
      </div>
      <div class="receipt-body">
        <div class="receipt-row"><span>Client</span><span>${esc(((model.customer.prenom || '') + ' ' + (model.customer.nom || '')).trim() || '—')}</span></div>
        <div class="receipt-row"><span>Méthode</span><span>${esc(model.references.paymentMode || '—')}</span></div>
        ${model.references.paymentReference ? '<div class="receipt-row"><span>Référence</span><span>' + esc(model.references.paymentReference) + '</span></div>' : ''}
        <div class="receipt-row"><span>Total de la facture</span><span>${eurAmount(model.totals.invoiceTotal)}</span></div>
        <div class="receipt-row"><span>Cumul payé après ce paiement</span><span>${eurAmount(model.totals.cumulativePaid)}</span></div>
        <div class="receipt-row"><span>Solde après ce paiement</span><span>${eurAmount(model.totals.balanceAfter)}</span></div>
        <div class="receipt-row grand"><span>Montant reçu</span><span>${eurAmount(model.totals.paymentAmount)}</span></div>
      </div>
      <div class="receipt-confirm">Nous confirmons la réception du paiement indiqué ci-dessus.</div>
    </div>`;
  }

  global.SebaDocRender = { esc, eur, eurAmount, fmtDate, QUOTE_STATUS_LABEL, INVOICE_STATUS_LABEL, quoteHTML, invoiceHTML, receiptHTML };
})(window);
