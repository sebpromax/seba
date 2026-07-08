/* ═══════════════════════════════════════════════════════════════
   SEBA — Service Stripe (paiements).

   Frontend statique → pas de clé secrète ici, JAMAIS. Deux usages :
   1. Abonnement Seba : bouton "Souscrire" → ouvre le Payment Link
      créé dans le dashboard Stripe (cfg.stripePaymentLink).
   2. Liens de paiement pour les clients de l'utilisateur : ouvre le
      Payment Link avec montant/référence pré-remplis quand configuré,
      sinon copie un lien de démonstration.

   Clé publique (pk_…) chargée uniquement si configurée — préparée
   pour Stripe Checkout côté serveur à l'étape suivante (voir
   MANUEL-SEBA-ADMIN.md).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const cfg = window.SEBA_CONFIG || {};
  const pk = (cfg.stripePublicKey && !/^VOTRE_/.test(cfg.stripePublicKey)) ? cfg.stripePublicKey : null;
  const payLink = (cfg.stripePaymentLink && /^https:\/\//.test(cfg.stripePaymentLink)) ? cfg.stripePaymentLink : null;

  let _stripe = null;
  function loadStripe() {
    if (_stripe) return Promise.resolve(_stripe);
    if (!pk) return Promise.reject(new Error('Clé publique Stripe non configurée'));
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = () => { _stripe = window.Stripe(pk); resolve(_stripe); };
      s.onerror = () => reject(new Error('CDN Stripe inaccessible'));
      document.head.appendChild(s);
    });
  }

  window.sebaStripe = {
    isConfigured: !!pk,
    hasPaymentLink: !!payLink,

    /* Abonnement à Seba (page tarifs) — ouvre le Payment Link s'il est
       configuré, sinon renvoie false (le CTA suit son lien normal). */
    subscribe() {
      if (payLink) { window.open(payLink, '_blank', 'noopener'); return true; }
      return false;
    },

    /* Lien de paiement pour une facture du client de l'utilisateur.
       Pas de prefilled_email ici : ce lien est copié/partagé tel quel
       (email, SMS...) par l'utilisateur, donc tout ce qui est ajouté à
       l'URL circule en clair dans ces canaux (logs, historiques, aperçus
       de liens) — l'email du client n'y a rien à faire. client_reference_id
       (numéro de facture, pas une donnée personnelle) suffit au
       rapprochement dans le dashboard Stripe. */
    paymentLinkFor(facture) {
      if (payLink) {
        const url = payLink + (payLink.includes('?') ? '&' : '?') +
          'client_reference_id=' + encodeURIComponent(facture.num || '');
        return url;
      }
      return 'https://seba.app/pay/' + String(facture.num || '').replace('#', '');
    },

    copyPaymentLink(factureId) {
      const f = window.SebaDB ? SebaDB.get('factures', factureId) : null;
      if (!f) { notify('Facture introuvable.'); return; }
      const url = this.paymentLinkFor(f);
      const done = () => {
        SebaDB.log('facture', 'Lien de paiement copié — ' + f.num + ' (' + f.clientName + ')', 'factures.html');
        notify(payLink ? 'Lien de paiement Stripe copié ✓' : 'Lien copié (démo) — branchez Stripe pour encaisser réellement.');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
      else done();
    },

    loadStripe,
  };

  function notify(msg) {
    if (typeof window.showFactToast === 'function') window.showFactToast(msg);
    else if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }
})();
