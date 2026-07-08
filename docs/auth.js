/* ═══════════════════════════════════════════════════════════════
   SEBA AUTH — authentification Supabase (email / mot de passe).

   Deux modes, bascule automatique :
   - CONFIGURÉ  : window.SEBA_CONFIG.supabaseUrl + .supabaseAnonKey
     présents (via config.js, jamais commité) → vraie auth Supabase,
     SDK v2 chargé à la volée depuis le CDN.
   - DÉMO       : pas de config → connexion locale simulée (le
     prototype reste 100% fonctionnel sans compte Supabase).

   API : window.sebaAuth = { isConfigured, signUp, signIn, signOut,
   getSession } — toutes les fonctions sont async et renvoient
   { ok, error, session? }.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Bootstrap de configuration en deux couches (XHR synchrone assumé :
     garantit que isConfigured est correct dès le parse, y compris pour
     guard.js chargé juste après dans le <head>) :
     1. config.public.js — committée/déployée : Supabase publishable
        (public par design, données protégées par RLS côté serveur).
     2. config.js — locale, gitignorée : clés SECRÈTES (Groq…) et
        surcharges. Fusionnée PAR-DESSUS la couche publique. */
  if (location.protocol !== 'file:') {
    const loadLayer = (file) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', file, false);
        x.send();
        if (x.status === 200 && x.responseText.indexOf('SEBA_CONFIG') !== -1) (0, eval)(x.responseText);
      } catch (e) {}
    };
    if (!window.SEBA_CONFIG_PUBLIC) loadLayer('config.public.js');
    const merged = Object.assign({}, window.SEBA_CONFIG_PUBLIC || {});
    loadLayer('config.js'); // pose window.SEBA_CONFIG si le fichier local existe
    window.SEBA_CONFIG = Object.assign(merged, window.SEBA_CONFIG || {});
    // valeurs placeholder = non renseignées → on les vide champ par champ
    const c = window.SEBA_CONFIG;
    Object.keys(c).forEach((k) => { if (/^VOTRE_/.test(String(c[k] || ''))) c[k] = ''; });
  }

  const cfg = window.SEBA_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let _client = null;
  let _loading = null;

  function loadSDK() {
    if (_client) return Promise.resolve(_client);
    if (_loading) return _loading;
    _loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = () => {
        _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        resolve(_client);
      };
      s.onerror = () => reject(new Error('CDN Supabase inaccessible'));
      document.head.appendChild(s);
    });
    return _loading;
  }

  const DEMO_KEY = 'seba_session_demo';

  window.sebaAuth = {
    isConfigured: configured,

    async signUp(email, password) {
      if (!configured) {
        try { localStorage.setItem(DEMO_KEY, JSON.stringify({ email, ts: Date.now() })); } catch (e) {}
        return { ok: true, demo: true };
      }
      try {
        const sb = await loadSDK();
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) return { ok: false, error: error.message };
        // data.user existe toujours (meme si la confirmation email est requise
        // et que data.session est encore null) -- l'appelant a besoin de
        // l'id utilisateur immediatement (ex: RPC juste apres l'inscription),
        // pas seulement quand une session est deja active.
        return { ok: true, session: data.session, user: data.user, needsConfirm: !data.session };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async signIn(email, password) {
      if (!configured) {
        try { localStorage.setItem(DEMO_KEY, JSON.stringify({ email, ts: Date.now() })); } catch (e) {}
        return { ok: true, demo: true };
      }
      try {
        const sb = await loadSDK();
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, error: error.message };
        return { ok: true, session: data.session };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async signOut() {
      try { localStorage.removeItem(DEMO_KEY); } catch (e) {}
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        await sb.auth.signOut();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async getSession() {
      if (!configured) {
        try {
          const demo = localStorage.getItem(DEMO_KEY);
          return demo ? { demo: true, user: JSON.parse(demo) } : null;
        } catch (e) { return null; }
      }
      try {
        const sb = await loadSDK();
        const { data } = await sb.auth.getSession();
        return data.session || null;
      } catch (e) { return null; }
    },

    /* Passerelle RPC generique -- auth.js reste le seul point d'entree
       Supabase du site (le client SDK n'est jamais initialise ailleurs).
       Pas de mode demo ici : appeler une fonction Postgres n'a de sens
       que si Supabase est reellement configure, l'appelant doit tester
       isConfigured avant d'appeler rpc() et prevoir son propre repli
       (ex: persistance locale) sinon. */
    async rpc(fnName, params) {
      if (!configured) return { data: null, error: new Error('Supabase non configure') };
      try {
        const sb = await loadSDK();
        return await sb.rpc(fnName, params);
      } catch (e) { return { data: null, error: e }; }
    },
  };
})();
