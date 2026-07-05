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

  /* Accès démo partageable : dashboard.html?demo ouvre la visite en
     lecture du prototype (données locales de démonstration) — utile
     pour montrer le produit à un prospect sans créer de compte.
     Le flag ne dure que le temps de l'onglet (sessionStorage). */
  try {
    if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem('seba_demo_bypass', '1');
    if (sessionStorage.getItem('seba_demo_bypass') === '1') return;
  } catch (e) {}

  window.sebaAuth.getSession().then(function (session) {
    if (!session) {
      window.location.replace('connexion.html');
    }
  }).catch(function () { /* réseau HS : on laisse le cache PWA servir la page */ });
})();
