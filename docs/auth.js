/* ═══════════════════════════════════════════════════════════════
   SEBA AUTH — authentification Supabase (email / mot de passe).

   Deux modes, bascule automatique :
   - CONFIGURÉ  : window.SEBA_CONFIG.supabaseUrl + .supabaseAnonKey
     présents (via config.js, jamais commité) → vraie auth Supabase,
     SDK v2 chargé à la volée depuis le CDN.
   - DÉMO       : pas de config → connexion locale simulée (le
     prototype reste 100% fonctionnel sans compte Supabase).

   API : window.sebaAuth = { isConfigured, signUp, signIn, signOut,
   getSession, rpc, uploadFile, getSignedUrl } — toutes les fonctions
   sont async et renvoient { ok, error, session? } (rpc renvoie
   { data, error }, forme supabase-js standard).
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
    // config.public.js/config.js vivent à la racine de docs/, jamais dans
    // docs/app/ — un chemin relatif nu ('config.public.js') ne résout
    // correctement que depuis la racine. Depuis docs/app/dashboard.html,
    // ça pointait vers app/config.public.js (404 en prod, SEBA_CONFIG_PUBLIC
    // jamais posé, guard.js désarmé) : même correctif que docs/sidebar.js
    // (resolveHref/isInApp) pour rester correct des deux profondeurs.
    const prefix = /\/app\//.test(location.pathname) ? '../' : '';
    const loadLayer = (file) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', prefix + file, false);
        x.send();
        if (x.status === 200 && x.responseText.indexOf('SEBA_CONFIG') !== -1) (0, eval)(x.responseText);
      } catch (e) {}
    };
    if (!window.SEBA_CONFIG_PUBLIC) loadLayer('config.public.js');
    const merged = Object.assign({}, window.SEBA_CONFIG_PUBLIC || {});
    /* config.js est gitignoré et n'existe donc jamais sur le site déployé
       (sebpromax.github.io) — le sonder en prod ne produit qu'un 404
       systématique en console, sans aucune chance d'aboutir. Restreint
       aux contextes où le fichier peut réellement exister (dev local). */
    const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalDev) loadLayer('config.js'); // pose window.SEBA_CONFIG si le fichier local existe
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

    /* Réinitialisation de mot de passe — 2 temps, tout côté client (le SDK
       Supabase gère l'email + le lien de récupération, aucune Edge Function) :
       1. resetPassword(email) → Supabase envoie le lien, qui redirige vers
          reset-password.html (redirectTo absolu, valable en local et en prod).
       2. Sur cette page, le SDK consomme le token du lien (detectSessionInUrl)
          et updatePassword(nouveau) → auth.updateUser. */
    async resetPassword(email) {
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        const redirectTo = new URL('reset-password.html', location.href).href;
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async updatePassword(newPassword) {
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        const { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /* Inscription SANS mot de passe (parcours « valeur d'abord », décision
       fondateur 2026-07-11) : signInWithOtp crée le compte et envoie un lien
       d'activation. Le clic ouvre bienvenue.html AVEC une session — c'est là
       que l'utilisateur confirme son adresse et choisit son mot de passe
       (updatePassword) et que le profil est créé (RPC, auth.uid() valide). */
    async signUpEmailOnly(email) {
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        const emailRedirectTo = new URL('bienvenue.html', location.href).href;
        const { error } = await sb.auth.signInWithOtp({
          email: email,
          options: { shouldCreateUser: true, emailRedirectTo: emailRedirectTo },
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /* Changement d'email de connexion — Supabase envoie un lien de
       confirmation à la nouvelle adresse (et à l'ancienne si le "secure
       email change" est activé) ; le changement n'est effectif qu'après clic. */
    async updateEmail(newEmail) {
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        const { error } = await sb.auth.updateUser({ email: newEmail });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /* Renvoi de l'email de confirmation d'inscription — pour l'utilisateur
       dont le lien n'est jamais arrivé (spam, faute de frappe corrigée…).
       Sans ça, il est bloqué sans recours devant l'écran needsConfirm. */
    async resendConfirmation(email) {
      if (!configured) return { ok: true, demo: true };
      try {
        const sb = await loadSDK();
        const { error } = await sb.auth.resend({ type: 'signup', email: email });
        if (error) return { ok: false, error: error.message };
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

    /* Passerelle Storage generique -- meme raison d'etre que rpc()
       ci-dessus (auth.js reste le seul point d'entree Supabase du site).
       Upload DIRECT avec le JWT de la session en cours (jamais
       service_role) : les policies RLS du bucket font tout le travail
       d'autorisation cote serveur (voir supabase-schema.sql, section 37,
       mission-photos, 2026-07-20) -- pas d'Edge Function necessaire pour
       ce flux. Pas de mode demo ici, meme logique que rpc(). */
    async uploadFile(bucket, path, file) {
      if (!configured) return { ok: false, error: 'Supabase non configuré' };
      try {
        const sb = await loadSDK();
        const { data, error } = await sb.storage.from(bucket).upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, path: data.path };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /* Le bucket est privé (pas d'URL publique) : toute lecture passe par
       une URL signée, temporaire, générée à la demande -- jamais stockée
       ni mise en cache, le lien expire de lui-même (expiresIn, secondes). */
    async getSignedUrl(bucket, path, expiresIn) {
      if (!configured) return { ok: false, error: 'Supabase non configuré' };
      try {
        const sb = await loadSDK();
        const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn || 3600);
        if (error) return { ok: false, error: error.message };
        return { ok: true, url: data.signedUrl };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
})();
