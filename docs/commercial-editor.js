// SEBA — Éditeur de lignes commerciales partagé (feature/flexible-
// commercial-documents, éditeurs réels). Utilisé identiquement par
// devis-nouveau.html et factures-nouvelle.html -- aucun calcul financier
// ici (uniquement collecte des entrées), tout total vient de
// window.SebaClientIntelligence.buildCommercialDocumentTotals (docs/seba-
// data.js), jamais recalculé en double dans cette page.
(function (global) {
  'use strict';

  const UNIT_LABELS = {
    forfait: 'Forfait', heure: 'Heure', jour: 'Jour', intervention: 'Intervention',
    piece: 'Pièce', unite: 'Unité', m2: 'm²', metre: 'Mètre', kilometre: 'Kilomètre', mois: 'Mois', aucune: 'Sans unité',
  };
  const TYPE_LABELS = { service: 'Service', product: 'Produit', time: 'Temps', travel: 'Déplacement', material: 'Matériel', fee: 'Frais', free: 'Ligne libre' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid() { return 'l' + Math.random().toString(36).slice(2, 10); }

  /* Monte l'éditeur de lignes dans `container`. options :
     - initialLines : lignes existantes (format riche ou v1, normalisées à
       l'affichage)
     - catalog : services du catalogue [{id,name,suggestedPrice}]
     - advanced : bool -- affiche les colonnes remise/TVA-ligne/détails
     - onChange(lines) : appelé à chaque modification (ajout/édition/suppr/
       déplacement), lignes déjà au format riche attendu par _buildPayload. */
  function mountLinesEditor(container, options) {
    options = options || {};
    let lines = (options.initialLines || []).map(l => Object.assign({}, l, { id: l.id || uid() }));
    let advanced = !!options.advanced;
    const catalog = options.catalog || [];
    const onChange = options.onChange || function () {};

    function emit() { onChange(lines.slice()); render(); }

    function addFree() { lines.push({ id: uid(), type: 'free', serviceId: null, description: '', details: '', quantity: 1, unit: 'forfait', unitPriceCents: 0, discountType: null, discountValue: 0, taxRate: null }); emit(); }
    function addFromCatalog(svcId) {
      const svc = catalog.find(s => s.id === svcId);
      if (!svc) return;
      lines.push({ id: uid(), type: 'service', serviceId: svc.id, description: svc.name, details: '', quantity: 1, unit: 'intervention', unitPriceCents: Math.round((Number(svc.suggestedPrice) || 0) * 100), discountType: null, discountValue: 0, taxRate: null });
      emit();
    }
    function addSection() { lines.push({ id: uid(), type: 'section', description: '', details: '', quantity: 0, unit: '', unitPriceCents: 0, discountType: null, discountValue: 0, taxRate: null }); emit(); }
    function duplicateLine(id) {
      const idx = lines.findIndex(l => l.id === id);
      if (idx === -1) return;
      const copy = Object.assign({}, lines[idx], { id: uid() });
      lines.splice(idx + 1, 0, copy);
      emit();
    }
    function removeLine(id) { lines = lines.filter(l => l.id !== id); emit(); }
    function moveLine(id, dir) {
      const idx = lines.findIndex(l => l.id === id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= lines.length) return;
      const [item] = lines.splice(idx, 1);
      lines.splice(target, 0, item);
      emit();
    }
    function patchLine(id, field, value) {
      const l = lines.find(x => x.id === id);
      if (!l) return;
      l[field] = value;
      onChange(lines.slice());
      // Pas de re-render complet ici -- perdrait le focus clavier de l'input
      // en cours d'édition. Seul le total de LA ligne + les totaux globaux
      // sont rafraîchis par l'appelant via updateTotalsDisplay().
    }

    function unitOptionsHtml(current) {
      const known = Object.keys(UNIT_LABELS).indexOf(current) !== -1;
      return Object.entries(UNIT_LABELS).map(([v, l]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${l}</option>`).join('')
        + `<option value="__custom__" ${!known && current ? 'selected' : ''}>Autre (personnalisée)…</option>`;
    }

    function lineRowHtml(l, idx) {
      if (l.type === 'section') {
        return `<tr class="cle-row cle-section" data-id="${l.id}">
          <td colspan="${advanced ? 8 : 6}">
            <div class="cle-section-bar">
              <span class="cle-section-tag">SECTION</span>
              <input type="text" class="cle-input cle-section-title" data-id="${l.id}" data-f="description" placeholder="Titre de section (ex. Préparation)" value="${esc(l.description)}">
              <span class="cle-row-actions">
                <button type="button" class="cle-mini" data-act="up" data-id="${l.id}" title="Monter" ${idx === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="cle-mini" data-act="down" data-id="${l.id}" title="Descendre">↓</button>
                <button type="button" class="cle-mini cle-danger" data-act="remove" data-id="${l.id}" title="Supprimer">✕</button>
              </span>
            </div>
          </td>
        </tr>`;
      }
      return `<tr class="cle-row" data-id="${l.id}">
        <td class="cle-col-type"><select class="cle-input" data-id="${l.id}" data-f="type">${Object.entries(TYPE_LABELS).filter(([v]) => v !== 'section' && v !== 'free').map(([v, lab]) => `<option value="${v}" ${l.type === v ? 'selected' : ''}>${lab}</option>`).join('')}<option value="free" ${l.type === 'free' ? 'selected' : ''}>${TYPE_LABELS.free}</option></select></td>
        <td class="cle-col-desc">
          <input type="text" class="cle-input" data-id="${l.id}" data-f="description" placeholder="Description de la prestation" value="${esc(l.description)}">
          ${advanced ? `<input type="text" class="cle-input cle-details" data-id="${l.id}" data-f="details" placeholder="Détails (optionnel)" value="${esc(l.details || '')}">` : ''}
        </td>
        <td class="cle-col-qty"><input type="number" class="cle-input" data-id="${l.id}" data-f="quantity" min="0" step="0.5" value="${l.quantity}"></td>
        <td class="cle-col-unit">
          <select class="cle-input" data-id="${l.id}" data-f="unit">${unitOptionsHtml(l.unit)}</select>
          <input type="text" class="cle-input cle-unit-custom" data-id="${l.id}" data-f="unit" placeholder="Unité…" value="${Object.keys(UNIT_LABELS).indexOf(l.unit) === -1 ? esc(l.unit) : ''}" style="${Object.keys(UNIT_LABELS).indexOf(l.unit) === -1 && l.unit ? '' : 'display:none;'}">
        </td>
        <td class="cle-col-price"><input type="number" class="cle-input" data-id="${l.id}" data-f="unitPriceCents" min="0" step="0.01" value="${(Number(l.unitPriceCents) || 0) / 100}"></td>
        ${advanced ? `<td class="cle-col-discount">
          <select class="cle-input" data-id="${l.id}" data-f="discountType"><option value="">Aucune</option><option value="percent" ${l.discountType === 'percent' ? 'selected' : ''}>%</option><option value="amount" ${l.discountType === 'amount' ? 'selected' : ''}>€</option></select>
          <input type="number" class="cle-input" data-id="${l.id}" data-f="discountValue" min="0" step="0.5" value="${l.discountValue || 0}" ${l.discountType ? '' : 'style="display:none;"'}>
        </td>
        <td class="cle-col-tva"><input type="number" class="cle-input" data-id="${l.id}" data-f="taxRate" min="0" step="0.1" placeholder="doc." value="${l.taxRate != null ? l.taxRate : ''}"></td>` : ''}
        <td class="cle-col-total"><span class="cle-line-total" data-total-for="${l.id}">—</span></td>
        <td class="cle-col-actions">
          <button type="button" class="cle-mini" data-act="up" data-id="${l.id}" title="Monter" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="cle-mini" data-act="down" data-id="${l.id}" title="Descendre">↓</button>
          <button type="button" class="cle-mini" data-act="dup" data-id="${l.id}" title="Dupliquer">⧉</button>
          <button type="button" class="cle-mini cle-danger" data-act="remove" data-id="${l.id}" title="Supprimer">✕</button>
        </td>
      </tr>`;
    }

    function render() {
      const catalogOptions = catalog.map(s => `<option value="${s.id}">${esc(s.name)}${s.suggestedPrice ? ' — ' + s.suggestedPrice + '€' : ''}</option>`).join('');
      container.innerHTML = `
        <div class="cle-toolbar">
          <select class="cle-input cle-catalog-pick" id="cle-catalog-pick"><option value="">+ Depuis le catalogue…</option>${catalogOptions}</select>
          <button type="button" class="cle-add-btn" id="cle-add-free">+ Ligne libre</button>
          ${advanced ? '<button type="button" class="cle-add-btn" id="cle-add-section">+ Section</button>' : ''}
        </div>
        <table class="cle-table">
          <thead><tr>
            <th>Type</th><th>Description</th><th>Qté</th><th>Unité</th><th>Prix unit.</th>
            ${advanced ? '<th>Remise</th><th>TVA %</th>' : ''}
            <th>Total</th><th></th>
          </tr></thead>
          <tbody id="cle-tbody">${lines.length ? lines.map(lineRowHtml).join('') : '<tr><td colspan="9" class="cle-empty">Aucune ligne. Ajoutez une prestation depuis le catalogue ou une ligne libre.</td></tr>'}</tbody>
        </table>`;

      container.querySelector('#cle-catalog-pick').addEventListener('change', e => { if (e.target.value) { addFromCatalog(e.target.value); } });
      const addFreeBtn = container.querySelector('#cle-add-free');
      if (addFreeBtn) addFreeBtn.addEventListener('click', addFree);
      const addSectionBtn = container.querySelector('#cle-add-section');
      if (addSectionBtn) addSectionBtn.addEventListener('click', addSection);

      container.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id, act = btn.dataset.act;
          if (act === 'remove') removeLine(id);
          else if (act === 'dup') duplicateLine(id);
          else if (act === 'up') moveLine(id, -1);
          else if (act === 'down') moveLine(id, 1);
        });
      });

      container.querySelectorAll('[data-f]').forEach(inp => {
        inp.addEventListener('input', () => {
          const id = inp.dataset.id, f = inp.dataset.f;
          if (f === 'unit' && inp.classList.contains('cle-unit-custom')) { patchLine(id, 'unit', inp.value); onChange(lines.slice()); return; }
          if (f === 'unit') {
            const customInp = container.querySelector('.cle-unit-custom[data-id="' + id + '"]');
            if (inp.value === '__custom__') { if (customInp) { customInp.style.display = ''; customInp.focus(); } patchLine(id, 'unit', ''); return; }
            if (customInp) customInp.style.display = 'none';
            patchLine(id, 'unit', inp.value); onChange(lines.slice()); return;
          }
          if (f === 'unitPriceCents') { patchLine(id, 'unitPriceCents', Math.round((parseFloat(inp.value) || 0) * 100)); onChange(lines.slice()); return; }
          if (f === 'quantity') { patchLine(id, 'quantity', parseFloat(inp.value) || 0); onChange(lines.slice()); return; }
          if (f === 'discountValue') { patchLine(id, 'discountValue', parseFloat(inp.value) || 0); onChange(lines.slice()); return; }
          if (f === 'taxRate') { patchLine(id, 'taxRate', inp.value === '' ? null : parseFloat(inp.value)); onChange(lines.slice()); return; }
          patchLine(id, f, inp.value); onChange(lines.slice());
        });
        inp.addEventListener('change', () => {
          const id = inp.dataset.id, f = inp.dataset.f;
          if (f === 'discountType') {
            const valInp = container.querySelector('.cle-input[data-id="' + id + '"][data-f="discountValue"]');
            if (valInp) valInp.style.display = inp.value ? '' : 'none';
            patchLine(id, 'discountType', inp.value || null); onChange(lines.slice());
          }
        });
      });
    }

    render();
    return {
      getLines() { return lines.slice(); },
      setLines(next) { lines = (next || []).map(l => Object.assign({}, l, { id: l.id || uid() })); render(); },
      setAdvanced(v) { advanced = !!v; render(); },
      isAdvanced() { return advanced; },
    };
  }

  /* Rafraîchit uniquement les totaux de ligne affichés (spans data-total-for)
     sans re-render du tableau -- préserve le focus clavier pendant la saisie.
     computedLines : le tableau `.lines` retourné par
     buildCommercialDocumentTotals() (déjà calculé, jamais recalculé ici). */
  function updateLineTotals(container, computedLines) {
    (computedLines || []).forEach(l => {
      const span = container.querySelector('[data-total-for="' + l.id + '"]');
      if (span) span.textContent = ((Number(l.totalExcludingTaxCents) || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    });
  }

  global.SebaCommercialEditor = { UNIT_LABELS, TYPE_LABELS, mountLinesEditor, updateLineTotals, esc, uid };
})(window);
