/* ═══════════════════════════════════════════════════════════════
   SEBA — Service d'envoi d'email (devis/factures au client).

   Frontend statique → pas de clé secrète ici. Appelle le relais
   Supabase Edge Function (supabase-functions/send-email.ts) qui
   envoie réellement via Resend, clé cachée côté serveur — voir
   MANUEL-SEBA-ADMIN.md §1e.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const cfg = window.SEBA_CONFIG || {};

  function sessionBearer() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) {
          const tok = JSON.parse(localStorage.getItem(k));
          if (tok && tok.access_token) return tok.access_token;
        }
      }
    } catch (e) {}
    return null;
  }

  function notify(msg) {
    if (typeof window.showFactToast === 'function') window.showFactToast(msg);
    else if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }

  function moneyFR(n) {
    return (n || 0).toLocaleString('fr-FR') + ' €';
  }

  function devisFactureHtml(doc, kind) {
    const titre = kind === 'facture' ? 'Facture' : 'Devis';
    return '<div style="font-family:sans-serif;max-width:480px;margin:auto;">' +
      '<h2 style="margin-bottom:4px;">' + titre + ' ' + (doc.num || '') + '</h2>' +
      '<p style="color:#555;">Bonjour ' + (doc.clientName || '') + ',</p>' +
      '<p>Veuillez trouver le récapitulatif de votre ' + titre.toLowerCase() + ' :</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:12px 0;">' +
      '<tr><td style="padding:6px 0;border-bottom:1px solid #eee;">Service</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">' + (doc.service || '') + '</td></tr>' +
      '<tr><td style="padding:6px 0;font-weight:700;">Montant</td><td style="padding:6px 0;text-align:right;font-weight:700;">' + moneyFR(doc.amount) + '</td></tr>' +
      '</table>' +
      '<p style="color:#888;font-size:.85rem;">Envoyé automatiquement par Seba.</p>' +
      '</div>';
  }

  window.sebaEmail = {
    /* Envoie un devis ou une facture par email au client (doc.clientEmail
       ou doc.contact doit contenir une adresse valide). kind: 'devis'|'facture' */
    async sendDocument(doc, kind) {
      const to = doc.clientEmail || (window.SebaDB ? (SebaDB.get('clients', doc.clientId) || {}).contact : null);
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        notify('Aucune adresse email valide pour ce client.');
        return { ok: false, error: 'Adresse email manquante' };
      }
      const bearer = sessionBearer();
      if (!cfg.supabaseUrl || !bearer) {
        notify('Connectez-vous pour envoyer un email (fonction indisponible en démo).');
        return { ok: false, error: 'Session requise' };
      }
      try {
        const res = await fetch(cfg.supabaseUrl + '/functions/v1/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer },
          body: JSON.stringify({
            to,
            subject: (kind === 'facture' ? 'Facture ' : 'Devis ') + (doc.num || ''),
            html: devisFactureHtml(doc, kind),
            kind,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          notify('Envoi impossible : ' + (data.error || ('HTTP ' + res.status)));
          return { ok: false, error: data.error };
        }
        if (window.SebaDB) SebaDB.log(kind, (kind === 'facture' ? 'Facture envoyée par email — ' : 'Devis envoyé par email — ') + (doc.num || '') + ' (' + (doc.clientName || '') + ')', kind === 'facture' ? 'factures.html' : 'devis.html');
        notify('Email envoyé ✓');
        return { ok: true };
      } catch (e) {
        notify('Envoi impossible : ' + e.message);
        return { ok: false, error: e.message };
      }
    },
  };
})();
