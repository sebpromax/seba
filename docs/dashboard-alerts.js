/* ═══════════════════════════════════════════════════════════════
   SEBA — Tableau de bord des alertes QA (Palier 3).

   alert_logs est une table normalisée hors du blob seba_state : SebaDB
   (docs/seba-data.js) n'a aucun moyen de l'interroger, son API est
   scopee aux collections clients/devis/factures/interventions/employes/
   journal. Lecture en REST direct avec le bearer de session, meme
   pattern que email-service.js/photo-manager.js.

   Pas de temps reel (pas de client supabase-js cote navigateur dans ce
   projet -- zero bundler, voir CLAUDE.md) : polling leger, comme propose
   en alternative dans le brief. syncWorker (seba-data.js) ne convient
   pas ici : il pousse la file locale de patchs vers sync-push.ts, sens
   inverse et table sans rapport.

   Import : <script src="dashboard-alerts.js"></script> en fin de body,
   apres config.js.
   Usage :
     AlertDashboard.render(document.getElementById('alerts-container'));
     AlertDashboard.startPolling(document.getElementById('alerts-container'), 30000);
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const TYPE_LABELS = { securite: 'Sécurité', proprete: 'Propreté', materiel: 'Matériel', autre: 'Autre' };

  /* select=... explicite (pas '*') : n'expose jamais plus que ce que
     l'UI affiche reellement. RLS (alert_logs_select) filtre deja au
     compte de l'appelant -- pas de parametre account a fournir cote
     client. */
  async function fetchAlerts() {
    const bearer = sessionBearer();
    if (!cfg.supabaseUrl || !bearer) return { ok: false, error: 'Session requise', alerts: [] };
    try {
      const res = await fetch(
        cfg.supabaseUrl + '/rest/v1/alert_logs?select=id,intervention_id,type_alerte,raison,status,created_at&status=neq.resolved&order=created_at.desc',
        { headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer } },
      );
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status, alerts: [] };
      const alerts = await res.json();
      return { ok: true, alerts };
    } catch (e) {
      return { ok: false, error: e.message, alerts: [] };
    }
  }

  async function acknowledgeAlert(alertId) {
    const bearer = sessionBearer();
    if (!cfg.supabaseUrl || !bearer) return { ok: false, error: 'Session requise' };
    try {
      const res = await fetch(cfg.supabaseUrl + '/rest/v1/alert_logs?id=eq.' + encodeURIComponent(alertId), {
        method: 'PATCH',
        headers: {
          apikey: cfg.supabaseAnonKey,
          Authorization: 'Bearer ' + bearer,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        // Seul le champ autorise par la policy RLS (alert_logs_acknowledge,
        // with check status='acknowledged') est envoye -- toute autre
        // valeur serait de toute facon rejetee cote serveur.
        body: JSON.stringify({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }),
      });
      return res.ok ? { ok: true } : { ok: false, error: 'HTTP ' + res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function alertRowHtml(a) {
    const label = TYPE_LABELS[a.type_alerte] || esc(a.type_alerte);
    const ackBtn = a.status === 'active'
      ? '<button type="button" class="alert-ack-btn" data-alert-id="' + esc(a.id) + '">Acquitter</button>'
      : '<span class="alert-status-badge">Acquittée</span>';
    return (
      '<div class="alert-row" data-alert-id="' + esc(a.id) + '">' +
        '<span class="alert-type alert-type-' + esc(a.type_alerte) + '">' + label + '</span>' +
        '<span class="alert-intervention">' + esc(a.intervention_id) + '</span>' +
        '<span class="alert-raison">' + esc(a.raison || 'Aucun détail fourni.') + '</span>' +
        ackBtn +
      '</div>'
    );
  }

  async function renderInto(container) {
    const { ok, error, alerts } = await fetchAlerts();
    if (!ok) {
      container.innerHTML = '<div class="alert-empty">Alertes indisponibles (' + esc(error) + ').</div>';
      return;
    }
    if (!alerts.length) {
      container.innerHTML = '<div class="alert-empty">Aucune alerte en cours.</div>';
      return;
    }
    container.innerHTML = alerts.map(alertRowHtml).join('');
    container.querySelectorAll('.alert-ack-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '…';
        const result = await acknowledgeAlert(btn.dataset.alertId);
        if (result.ok) {
          await renderInto(container); // re-tire l'etat reel depuis le serveur, pas une supposition optimiste
        } else {
          btn.disabled = false;
          btn.textContent = 'Acquitter';
          console.warn('[dashboard-alerts] acquittement echoue :', result.error);
        }
      });
    });
  }

  const pollers = new WeakMap();

  window.AlertDashboard = {
    /** Rend la liste une fois dans `container` (element DOM). */
    render: renderInto,

    /** Rafraichit `container` toutes les intervalMs (defaut 30s). Un seul
        polling actif par container -- un appel repete remplace le
        precedent au lieu de les empiler. */
    startPolling(container, intervalMs) {
      this.stopPolling(container);
      renderInto(container);
      const id = setInterval(() => renderInto(container), intervalMs || 30000);
      pollers.set(container, id);
    },
    stopPolling(container) {
      const id = pollers.get(container);
      if (id) { clearInterval(id); pollers.delete(container); }
    },

    acknowledgeAlert,
    fetchAlerts,
  };
})();
