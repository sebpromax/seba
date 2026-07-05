/* ═══════════════════════════════════════════════════════════════
   SEBA GUARD — verrou d'accès aux pages privées (dashboard, etc.).

   - Supabase CONFIGURÉ (config.js présent) : session obligatoire,
     sinon redirection immédiate vers connexion.html.
   - Mode DÉMO (pas de config) : aucun blocage — le prototype public
     reste explorable ; le dashboard gère déjà son propre état vide
     quand aucun compte n'existe.

   À charger dans le <head> des pages à protéger, APRÈS config.js
   (si présent) et auth.js.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!window.sebaAuth || !window.sebaAuth.isConfigured) return; // mode démo : pas de verrou

  window.sebaAuth.getSession().then(function (session) {
    if (!session) {
      window.location.replace('connexion.html');
    }
  }).catch(function () { /* réseau HS : on laisse le cache PWA servir la page */ });
})();
