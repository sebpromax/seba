/* ═══════════════════════════════════════════════════════════════
   SEBA — Notifications push (OneSignal, gratuit).

   Chargé uniquement sur les pages protégées (dashboard). Rien ne se
   passe sans un geste explicite de l'utilisateur (bouton "Activer les
   notifications") : aucun SDK ni permission demandée automatiquement.

   window.sebaPush = { isConfigured, subscribe(), notifyMe(title, msg) }
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const cfg = window.SEBA_CONFIG || {};
  const appId = cfg.onesignalAppId;

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

  function sessionUid(bearer) {
    if (!bearer) return null;
    try {
      const payload = JSON.parse(atob(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload && payload.sub ? payload.sub : null;
    } catch (e) {
      return null;
    }
  }

  if (!appId) {
    window.sebaPush = {
      isConfigured: false,
      async subscribe() { return { ok: false, error: 'Notifications push non configurées (voir MANUEL-SEBA-ADMIN.md §1f).' }; },
      async notifyMe() { return { ok: false, error: 'Notifications push non configurées.' }; },
    };
    return;
  }

  let _ready = null;
  function loadSDK() {
    if (_ready) return _ready;
    _ready = new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async function (OneSignal) {
        await OneSignal.init({ appId });
        const uid = sessionUid(sessionBearer());
        if (uid) { try { await OneSignal.login(uid); } catch (e) {} }
        resolve(OneSignal);
      });
      const s = document.createElement('script');
      s.src = 'https://cdn.onesignal.com/sdks/OneSignalSDK.page.js';
      s.defer = true;
      document.head.appendChild(s);
    });
    return _ready;
  }

  window.sebaPush = {
    isConfigured: true,

    async subscribe() {
      try {
        const OneSignal = await loadSDK();
        await OneSignal.Notifications.requestPermission();
        return { ok: OneSignal.Notifications.permission === true, permission: OneSignal.Notifications.permission };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async notifyMe(title, message) {
      const bearer = sessionBearer();
      if (!cfg.supabaseUrl || !bearer) return { ok: false, error: 'Session requise' };
      try {
        const res = await fetch(cfg.supabaseUrl + '/functions/v1/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer },
          body: JSON.stringify({ title, message }),
        });
        const data = await res.json();
        if (!res.ok || data.error) return { ok: false, error: data.error || ('HTTP ' + res.status) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };

  loadSDK();
})();
