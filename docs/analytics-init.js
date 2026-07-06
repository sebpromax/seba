/* ═══════════════════════════════════════════════════════════════
   SEBA — Analytics respectueux du RGPD (Umami, gratuit).

   Charge le script Umami uniquement si window.SEBA_CONFIG.umamiWebsiteId
   est configuré — voir MANUEL-SEBA-ADMIN.md §1h. Sans configuration :
   totalement invisible, zéro requête réseau, zéro cookie.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const cfg = window.SEBA_CONFIG || {};
  const websiteId = cfg.umamiWebsiteId;
  if (!websiteId) return;

  const s = document.createElement('script');
  s.src = cfg.umamiScriptUrl || 'https://cloud.umami.is/script.js';
  s.setAttribute('data-website-id', websiteId);
  s.defer = true;
  document.head.appendChild(s);
})();
