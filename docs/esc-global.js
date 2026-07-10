/* ═══════════════════════════════════════════════════════════════
   SEBA — Echappement HTML centralise pour les pages en script CLASSIQUE
   (non-module).

   Meme implementation exacte que docs/src/core/esc.js (module ES,
   deja utilise par dashboard.html/ui-controller.js/auth-module.js) --
   dupliquee ICI UNE SEULE FOIS sous forme de script global classique,
   pas une 5e copie inline : factures.html/devis.html/planning.html
   chargent plusieurs blocs <script> non-module qui partagent l'espace
   global (functions/variables inter-blocs) -- les convertir en
   type="module" isolerait leur scope et casserait ces references
   croisees. Un script classique partage est le fix le plus sur pour
   cette famille de pages precise.

   Voir AUDIT-EXPERT.md ecart #1 (XSS) / #14 (esc() disperse).

   Usage exclusif : encodage de SORTIE avant insertion dans innerHTML/
   un template HTML. Ne JAMAIS appliquer avant un appel reseau/API
   (Supabase, Stripe...) -- ce n'est pas une validation d'entree.
   ═══════════════════════════════════════════════════════════════ */
window.esc = function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
