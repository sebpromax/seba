/* ═══════════════════════════════════════════════════════════════
   SEBA — Autocomplétion d'adresse française.

   API Adresse (Géoplateforme IGN) : gratuite, illimitée (50 req/s),
   AUCUNE clé requise. Attache une liste de suggestions à tout champ
   marqué data-address-autocomplete.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ENDPOINT = 'https://data.geopf.fr/geocodage/search';

  function attach(input) {
    let box = null;
    let debounceTimer = null;

    function closeBox() { if (box) { box.remove(); box = null; } }

    function renderSuggestions(features) {
      closeBox();
      if (!features.length) return;
      box = document.createElement('div');
      box.className = 'addr-suggest-box';
      box.style.cssText = 'position:absolute;z-index:400;background:#fff;border:1px solid #E8E6E1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:220px;overflow-y:auto;width:' + input.offsetWidth + 'px;font-family:inherit;';
      features.forEach((f) => {
        const item = document.createElement('div');
        item.textContent = f.properties.label;
        item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:.86rem;color:#14161A;';
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = f.properties.label;
          input.dispatchEvent(new Event('change'));
          closeBox();
        });
        item.addEventListener('mouseenter', () => { item.style.background = '#F5F5F4'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        box.appendChild(item);
      });
      const rect = input.getBoundingClientRect();
      box.style.top = (window.scrollY + rect.bottom + 4) + 'px';
      box.style.left = (window.scrollX + rect.left) + 'px';
      document.body.appendChild(box);
    }

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 4) { closeBox(); return; }
      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(ENDPOINT + '?q=' + encodeURIComponent(q) + '&limit=5');
          if (!res.ok) return;
          const data = await res.json();
          renderSuggestions(data.features || []);
        } catch (e) { /* pas de réseau -> pas de suggestion, la saisie manuelle reste possible */ }
      }, 300);
    });
    input.addEventListener('blur', () => setTimeout(closeBox, 150));
  }

  function init() {
    document.querySelectorAll('[data-address-autocomplete]').forEach(attach);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
