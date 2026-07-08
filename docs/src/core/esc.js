/**
 * @module core/esc
 * Echappement HTML pour insertion sure dans innerHTML — usage RENDU
 * uniquement (voir AUDIT-RISQUES.md section 1.2 : cette fonction existait
 * dupliquee dans clients.html, crm-tech.html et widgets.js ; centralisee
 * ici pour ne pas ajouter une 4e copie divergente).
 *
 * Ne PAS appeler cette fonction sur une donnee avant un appel reseau/API
 * (ex: avant Supabase auth) : ce n'est pas une validation d'entree, c'est
 * un encodage de sortie pour le contexte HTML. L'appliquer a une valeur
 * qui n'est jamais rendue en HTML ne protege rien et peut corrompre la
 * donnee (ex: un email contenant une apostrophe deviendrait invalide).
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
