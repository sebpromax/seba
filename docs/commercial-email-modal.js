// ═══════════════════════════════════════════════════════════════
// SEBA — Modale partagée d'envoi email des documents commerciaux
// (feature/customer-email-delivery, PHASE 2). Une seule implémentation,
// utilisée par devis.html/devis-document.html/factures.html/facture-
// document.html/recu-document.html -- jamais dupliquée par page.
//
// Réutilise SebaDB.commercialEmail (PHASE 2, docs/seba-data.js) pour
// tout appel réseau, et SebaDocRender pour l'aperçu (même renderer que
// les pages document finales, jamais un 4e template).
// ═══════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const DOC_LABEL = { quote: 'le devis', invoice: 'la facture', receipt: 'le reçu' };
  const DOC_TITLE = { quote: 'Envoyer le devis', invoice: 'Envoyer la facture', receipt: 'Envoyer le reçu' };
  const STATUS_LABEL = { creating: 'Envoi en cours', sent: 'Envoyé au fournisseur', delivered: 'Délivré', failed: 'Échec' };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MAX_SUBJECT = 180;
  const MAX_MESSAGE = 4000;
  const MAX_CC = 5;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function normEmail(v) { const s = String(v || '').trim().toLowerCase(); return s && EMAIL_RE.test(s) ? s : null; }

  let root = null;         // conteneur DOM unique, réutilisé
  let lastFocused = null;  // pour rendre le focus à la fermeture
  let state = null;        // état de la session d'envoi en cours

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'cem-root';
    root.innerHTML = `
      <div class="cem-backdrop" id="cem-backdrop"></div>
      <div class="cem-dialog" role="dialog" aria-modal="true" aria-labelledby="cem-title" aria-describedby="cem-desc" id="cem-dialog" tabindex="-1">
        <div class="cem-header">
          <div>
            <h2 id="cem-title">Envoyer</h2>
            <p class="cem-sub" id="cem-desc"></p>
          </div>
          <button type="button" class="cem-close" id="cem-close-btn" aria-label="Fermer">✕</button>
        </div>
        <div class="cem-body">
          <div class="cem-col-form">
            <div class="cem-field">
              <label for="cem-to">À <span class="cem-req">*</span></label>
              <input type="email" id="cem-to" class="cem-input" autocomplete="off">
              <p class="cem-field-error" id="cem-to-error" role="alert"></p>
            </div>
            <div class="cem-field">
              <label for="cem-cc-input">CC <span class="cem-opt">(optionnel)</span></label>
              <div class="cem-cc-chips" id="cem-cc-chips"></div>
              <input type="text" id="cem-cc-input" class="cem-input" placeholder="adresse@exemple.fr puis Entrée" autocomplete="off">
              <p class="cem-field-error" id="cem-cc-error" role="alert"></p>
            </div>
            <div class="cem-checkbox-row">
              <input type="checkbox" id="cem-update-client-email">
              <label for="cem-update-client-email">Mettre également à jour l'email de la fiche client</label>
            </div>
            <div class="cem-field">
              <label for="cem-subject">Objet <span class="cem-req">*</span></label>
              <input type="text" id="cem-subject" class="cem-input" maxlength="${MAX_SUBJECT}">
              <p class="cem-field-hint" id="cem-subject-count"></p>
              <p class="cem-field-error" id="cem-subject-error" role="alert"></p>
            </div>
            <div class="cem-field">
              <label for="cem-message">Message</label>
              <textarea id="cem-message" class="cem-input cem-textarea" maxlength="${MAX_MESSAGE}"></textarea>
              <p class="cem-field-error" id="cem-message-error" role="alert"></p>
            </div>
            <div class="cem-field">
              <label id="cem-link-label">Lien client sécurisé</label>
              <div class="cem-link-row">
                <input type="text" id="cem-link-value" class="cem-input" readonly aria-labelledby="cem-link-label">
                <button type="button" class="cem-btn-secondary" id="cem-copy-link-btn">Copier</button>
              </div>
              <p class="cem-field-hint">Le client devra se connecter à son espace pour consulter ce document.</p>
            </div>
            <div class="cem-status-area" id="cem-status-area" aria-live="polite"></div>
            <div class="cem-actions">
              <button type="button" class="cem-btn-secondary" id="cem-cancel-btn">Annuler</button>
              <button type="button" class="cem-btn-primary" id="cem-send-btn">Envoyer</button>
            </div>
          </div>
          <div class="cem-col-preview">
            <div class="cem-preview-tabs">
              <button type="button" class="cem-tab active" id="cem-tab-preview-btn">Aperçu du document</button>
              <button type="button" class="cem-tab" id="cem-tab-history-btn">Historique</button>
            </div>
            <div class="cem-preview-pane" id="cem-preview-pane">
              <iframe id="cem-preview-frame" title="Aperçu du document" sandbox=""></iframe>
            </div>
            <div class="cem-history-pane" id="cem-history-pane" style="display:none;"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    document.getElementById('cem-close-btn').addEventListener('click', close);
    document.getElementById('cem-cancel-btn').addEventListener('click', close);
    document.getElementById('cem-backdrop').addEventListener('click', () => { if (!state || !state.sending) close(); });
    document.getElementById('cem-send-btn').addEventListener('click', onSendClick);
    document.getElementById('cem-copy-link-btn').addEventListener('click', onCopyLink);
    document.getElementById('cem-tab-preview-btn').addEventListener('click', () => switchTab('preview'));
    document.getElementById('cem-tab-history-btn').addEventListener('click', () => switchTab('history'));
    document.getElementById('cem-subject').addEventListener('input', updateSubjectCount);
    document.getElementById('cem-cc-input').addEventListener('keydown', onCcKeydown);
    document.getElementById('cem-to').addEventListener('input', () => clearFieldError('to'));

    document.addEventListener('keydown', onGlobalKeydown);
    return root;
  }

  function onGlobalKeydown(e) {
    if (!root || !root.classList.contains('cem-open')) return;
    if (e.key === 'Escape' && (!state || !state.sending)) { close(); return; }
    if (e.key === 'Tab') trapFocus(e);
  }

  function trapFocus(e) {
    const dialog = document.getElementById('cem-dialog');
    const focusable = Array.from(dialog.querySelectorAll('button,input,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function switchTab(which) {
    document.getElementById('cem-tab-preview-btn').classList.toggle('active', which === 'preview');
    document.getElementById('cem-tab-history-btn').classList.toggle('active', which === 'history');
    document.getElementById('cem-preview-pane').style.display = which === 'preview' ? 'block' : 'none';
    document.getElementById('cem-history-pane').style.display = which === 'history' ? 'block' : 'none';
    if (which === 'history') renderHistory();
  }

  function clearFieldError(field) {
    const el = document.getElementById('cem-' + field + '-error');
    if (el) el.textContent = '';
  }
  function setFieldError(field, msg) {
    const el = document.getElementById('cem-' + field + '-error');
    if (el) el.textContent = msg || '';
  }

  function updateSubjectCount() {
    const val = document.getElementById('cem-subject').value || '';
    document.getElementById('cem-subject-count').textContent = val.length >= MAX_SUBJECT - 20 ? (val.length + ' / ' + MAX_SUBJECT) : '';
  }

  function renderCcChips() {
    const box = document.getElementById('cem-cc-chips');
    box.innerHTML = state.cc.map((email, i) => (
      '<span class="cem-chip">' + esc(email) + '<button type="button" class="cem-chip-remove" data-i="' + i + '" aria-label="Retirer ' + esc(email) + '">✕</button></span>'
    )).join('');
    box.querySelectorAll('.cem-chip-remove').forEach((btn) => btn.addEventListener('click', () => {
      state.cc.splice(Number(btn.dataset.i), 1);
      renderCcChips();
    }));
  }

  function onCcKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const input = document.getElementById('cem-cc-input');
    const raw = input.value.trim().replace(/,$/, '');
    if (!raw) return;
    const email = normEmail(raw);
    const to = document.getElementById('cem-to').value.trim().toLowerCase();
    if (!email) { setFieldError('cc', 'Adresse CC invalide : ' + raw); return; }
    if (email === to) { setFieldError('cc', 'Cette adresse est déjà le destinataire principal.'); return; }
    if (state.cc.indexOf(email) !== -1) { setFieldError('cc', 'Adresse déjà ajoutée.'); return; }
    if (state.cc.length >= MAX_CC) { setFieldError('cc', 'Maximum ' + MAX_CC + ' adresses en CC.'); return; }
    clearFieldError('cc');
    state.cc.push(email);
    input.value = '';
    renderCcChips();
  }

  function renderPreview() {
    const frame = document.getElementById('cem-preview-frame');
    const renderer = { quote: 'quoteHTML', invoice: 'invoiceHTML', receipt: 'receiptHTML' }[state.opts.documentType];
    const html = (global.SebaDocRender && state.opts.documentModel)
      ? global.SebaDocRender[renderer](state.opts.documentModel)
      : '<div style="padding:24px;font-family:sans-serif;color:#6B6B70;">Aperçu indisponible.</div>';
    frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="commercial-document.css"></head><body><div class="page-wrap">' + html + '</div></body></html>';
  }

  async function renderHistory() {
    const pane = document.getElementById('cem-history-pane');
    pane.innerHTML = '<p class="cem-hint">Chargement…</p>';
    const list = await global.SebaDB.commercialEmail.listForDocument(state.opts.documentType, state.opts.documentId);
    if (!list.length) { pane.innerHTML = '<p class="cem-hint">Aucun email n\'a encore été envoyé pour ce document.</p>'; return; }
    pane.innerHTML = '<ul class="cem-history-list">' + list.map((d) => (
      '<li class="cem-history-item">' +
        '<div class="cem-history-row"><span class="cem-badge cem-badge-' + esc(d.status) + '">' + esc(STATUS_LABEL[d.status] || d.status) + '</span>' +
        '<span class="cem-history-date">' + esc(fmtDate(d.createdAt)) + '</span></div>' +
        '<div class="cem-history-recipient">' + esc(d.recipient) + '</div>' +
        '<div class="cem-history-subject">' + esc(d.subject) + '</div>' +
        (d.failureReason ? '<div class="cem-history-error">' + esc(d.failureReason) + '</div>' : '') +
        (d.providerMessageId ? '<div class="cem-history-ref">Réf. ' + esc(String(d.providerMessageId).slice(0, 24)) + '</div>' : '') +
      '</li>'
    )).join('') + '</ul>';
  }

  function setStatusArea(html) { document.getElementById('cem-status-area').innerHTML = html; }

  function onCopyLink() {
    const link = document.getElementById('cem-link-value').value;
    const done = () => showToastLike('Lien client copié ✓ — le client devra se connecter.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
    } else {
      fallbackCopy(link, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    done();
  }
  function showToastLike(msg) {
    const ex = document.getElementById('cem-toast');
    if (ex) ex.remove();
    const t = document.createElement('div');
    t.id = 'cem-toast';
    t.className = 'cem-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('cem-toast-out'), 2400);
    setTimeout(() => t.remove(), 2900);
  }

  function validateBeforeSend() {
    let ok = true;
    clearFieldError('to'); clearFieldError('subject'); clearFieldError('message');
    const to = normEmail(document.getElementById('cem-to').value);
    if (!to) { setFieldError('to', 'Destinataire requis et valide.'); ok = false; }
    const subject = document.getElementById('cem-subject').value.trim();
    if (!subject) { setFieldError('subject', 'Objet requis.'); ok = false; }
    else if (subject.length > MAX_SUBJECT) { setFieldError('subject', 'Objet trop long (max ' + MAX_SUBJECT + ').'); ok = false; }
    const message = document.getElementById('cem-message').value;
    if (message.length > MAX_MESSAGE) { setFieldError('message', 'Message trop long (max ' + MAX_MESSAGE + ').'); ok = false; }
    return ok ? { to, subject, message } : null;
  }

  async function doSend(attemptId) {
    const fields = validateBeforeSend();
    if (!fields) return;
    state.sending = true;
    const btn = document.getElementById('cem-send-btn');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Envoi en cours…';
    setStatusArea('<p class="cem-status cem-status-pending">Envoi en cours…</p>');

    const input = {
      account: state.opts.account, clientId: state.opts.clientId,
      documentType: state.opts.documentType, documentId: state.opts.documentId,
      recipient: fields.to, cc: state.cc, subject: fields.subject, message: fields.message,
      attemptId,
    };
    const res = await global.SebaDB.commercialEmail.sendDocument(input);
    state.sending = false;
    btn.removeAttribute('aria-busy');

    if (res.networkError) {
      btn.disabled = false; btn.textContent = 'Réessayer';
      state.lastAttemptId = attemptId; // conservé pour un vrai retry (même attemptId)
      state.mode = 'retry';
      setStatusArea('<p class="cem-status cem-status-uncertain" role="alert">Impossible de confirmer le résultat — vérifiez votre connexion.</p>');
      return;
    }
    if (res.ok) {
      const isDelivered = res.status === 'delivered';
      setStatusArea(
        '<p class="cem-status cem-status-ok">' + (isDelivered ? 'Email délivré' : 'Email accepté par le fournisseur') + '</p>' +
        '<p class="cem-status-detail">' + esc(fields.to) + (res.reused ? ' (tentative déjà enregistrée)' : '') + '</p>'
      );
      btn.disabled = false; btn.textContent = 'Renvoyer'; state.mode = 'resend';
      if (document.getElementById('cem-update-client-email').checked && state.opts.clientId) {
        try { global.SebaDB.update('clients', state.opts.clientId, { email: fields.to, contact: fields.to }); } catch (e) {}
      }
      renderHistory();
      if (typeof state.opts.onSuccess === 'function') state.opts.onSuccess(res);
      return;
    }
    // Échec métier explicite (jamais un simple souci réseau) : failed,
    // validation, ou blocage backend -- jamais un renvoi silencieux du
    // même attemptId.
    btn.disabled = false; btn.textContent = 'Renvoyer'; state.mode = 'resend';
    setStatusArea('<p class="cem-status cem-status-fail" role="alert">Échec de l\'envoi — ' + esc(res.error || 'erreur inconnue') + '</p>');
    renderHistory();
  }

  function onSendClick() {
    if (state.sending) return; // double-clic : jamais un second appel pendant un envoi en cours
    if (state.mode === 'retry') { doSend(state.lastAttemptId); return; }
    if (state.mode === 'resend') {
      if (!confirm('Un email a déjà été envoyé pour ce document. Envoyer une nouvelle tentative ?')) return;
      const id = global.SebaDB.commercialEmail.createAttemptId();
      state.lastAttemptId = id;
      doSend(id);
      return;
    }
    const id = global.SebaDB.commercialEmail.createAttemptId();
    state.lastAttemptId = id;
    doSend(id);
  }

  function prefillRecipient(opts) {
    const snapEmail = opts.documentModel && opts.documentModel.customer && opts.documentModel.customer.email;
    const clientEmail = opts.client && (opts.client.email || opts.client.contact);
    return normEmail(snapEmail) || normEmail(clientEmail) || '';
  }

  async function open(opts) {
    opts = opts || {};
    ensureRoot();
    lastFocused = document.activeElement;
    state = { opts, cc: [], sending: false, mode: 'send', lastAttemptId: null };

    document.getElementById('cem-title').textContent = DOC_TITLE[opts.documentType] || 'Envoyer';
    const num = (opts.documentModel && opts.documentModel.documentNumber) || '';
    const clientName = (opts.client && ((opts.client.prenom || '') + ' ' + (opts.client.nom || '')).trim()) || (opts.documentModel && opts.documentModel.customer && ((opts.documentModel.customer.prenom || '') + ' ' + (opts.documentModel.customer.nom || '')).trim()) || 'Client';
    document.getElementById('cem-desc').textContent = [num, clientName].filter(Boolean).join(' — ');

    document.getElementById('cem-to').value = prefillRecipient(opts);
    document.getElementById('cem-cc-input').value = '';
    document.getElementById('cem-update-client-email').checked = false;
    clearFieldError('to'); clearFieldError('cc'); clearFieldError('subject'); clearFieldError('message');
    renderCcChips();

    const templates = global.SebaDB.commercialSettings.getEmailTemplates();
    const tpl = templates[opts.documentType] || { subject: '', message: '' };
    const entreprise = (global.SebaDB.entreprise && global.SebaDB.entreprise.get()) || {};
    const resolved = global.SebaDB.commercialEmail.resolveTemplate(tpl, {
      clientName, companyName: entreprise.nom || 'Votre prestataire', documentNumber: num, documentType: opts.documentType,
    });
    document.getElementById('cem-subject').value = resolved.subject;
    document.getElementById('cem-message').value = resolved.message;
    updateSubjectCount();

    const link = opts.documentLink || global.SebaDB.commercialEmail.buildClientDocumentLink(opts.documentType, opts.documentId, { invoiceId: opts.invoiceId, paymentId: opts.paymentId });
    document.getElementById('cem-link-value').value = link;

    const sendBtn = document.getElementById('cem-send-btn');
    sendBtn.disabled = false; sendBtn.textContent = 'Envoyer'; sendBtn.removeAttribute('aria-busy');
    setStatusArea('');
    switchTab('preview');
    renderPreview();

    root.classList.add('cem-open');
    document.body.style.overflow = 'hidden';

    // Dernier envoi connu, affiché dans l'en-tête pour contexte immédiat.
    global.SebaDB.commercialEmail.getLatestForDocument(opts.documentType, opts.documentId).then((latest) => {
      if (!latest || !root.classList.contains('cem-open')) return;
      const label = STATUS_LABEL[latest.status] || latest.status;
      document.getElementById('cem-desc').textContent += ' · Dernier envoi : ' + label + ' (' + fmtDate(latest.createdAt) + ')';
      if (latest.status === 'sent' || latest.status === 'delivered') state.mode = 'resend';
    });

    setTimeout(() => document.getElementById('cem-to').focus(), 0);
  }

  function close() {
    if (!root) return;
    root.classList.remove('cem-open');
    document.body.style.overflow = '';
    state = null;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  /* Copie autonome du lien client -- N'OUVRE PAS la modale, ne crée
     JAMAIS de ligne commercial_email_deliveries (section 17 du chantier :
     "Copier le lien n'est pas un envoi d'email"). */
  function copyLink(documentType, documentId, options) {
    const link = (options && options.documentLink) || global.SebaDB.commercialEmail.buildClientDocumentLink(documentType, documentId, options || {});
    const done = () => showToastLike('Lien client copié ✓ — le client devra se connecter.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
    } else {
      fallbackCopy(link, done);
    }
    return link;
  }

  global.CommercialEmailModal = { open, close, copyLink };
})(window);
