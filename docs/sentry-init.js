/* ═══════════════════════════════════════════════════════════════
   SEBA — Capture d'erreurs front (Sentry, gratuit).

   Charge le SDK Sentry uniquement si window.SEBA_CONFIG.sentryDsn est
   configuré (DSN publique par design, comme une clé publishable) —
   voir MANUEL-SEBA-ADMIN.md §1g. Sans DSN : totalement invisible, zéro
   coût, zéro requête réseau supplémentaire.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const cfg = window.SEBA_CONFIG || {};
  const dsn = cfg.sentryDsn;
  if (!dsn) return;

  const s = document.createElement('script');
  s.src = 'https://browser.sentry-cdn.com/8/bundle.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = function () {
    if (window.Sentry) {
      window.Sentry.init({ dsn: dsn, tracesSampleRate: 0 });
    }
  };
  document.head.appendChild(s);
})();
