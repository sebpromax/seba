/* ═══════════════════════════════════════════════════════════════
   SEBA — Logger de résilience.
   Capture toutes les erreurs JS (window.onerror + promesses rejetées)
   dans un tampon local, consultable SANS console développeur :
   Ctrl+Alt+L ouvre le panneau de logs (pratique sur mobile).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const LOGS = [];
  const MAX = 80;

  function push(type, msg, src) {
    LOGS.unshift({ ts: new Date().toLocaleTimeString('fr-FR'), type, msg: String(msg).slice(0, 300), src: src || '' });
    if (LOGS.length > MAX) LOGS.length = MAX;
  }

  window.addEventListener('error', (e) => {
    push('erreur', e.message, (e.filename || '').split('/').pop() + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('promesse', (e.reason && e.reason.message) || e.reason || 'rejet non géré', '');
  });

  let panel = null;
  function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;max-height:50vh;overflow-y:auto;background:#0a0a0c;color:#e5e7eb;font:12px/1.5 monospace;border:1px solid rgba(13,148,136,.35);border-radius:10px;padding:12px 14px;z-index:9999;box-shadow:0 16px 48px rgba(0,0,0,.5);';
    panel.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
      '<b style="color:#0D9488;">Log système Seba (' + LOGS.length + ')</b>' +
      '<span style="cursor:pointer;padding:0 6px;" onclick="this.closest(\'div[style]\').parentElement.remove()">✕</span></div>' +
      (LOGS.length
        ? LOGS.map((l) => '<div style="border-top:1px solid rgba(255,255,255,.07);padding:5px 0;"><span style="color:#6B7280;">' + l.ts + '</span> <span style="color:' + (l.type === 'erreur' ? '#f87171' : '#fbbf24') + ';">[' + l.type + ']</span> ' + l.msg.replace(/</g, '&lt;') + (l.src ? ' <span style="color:#6B7280;">(' + l.src + ')</span>' : '') + '</div>').join('')
        : '<div style="color:#6B7280;">Aucune erreur enregistrée ✓</div>');
    document.body.appendChild(panel);
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); togglePanel(); }
  });

  window.sebaLogs = { list: () => LOGS.slice(), toggle: togglePanel };
})();
