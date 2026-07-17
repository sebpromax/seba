/* message-log.js — Seba
 * Journal de messagerie (fondation pour un futur portail client/employé).
 * Aujourd'hui : lecture/écriture patron uniquement -- ni le client ni
 * l'employé n'ont de moyen de se connecter à Seba pour lire/répondre (pas
 * de portail client, pas de page de connexion PIN employé côté UI, même si
 * les tables Supabase existent déjà pour le PIN -- voir MANUEL-SEBA-ADMIN.md).
 * Les messages sont donc un historique tenu par le patron, pas un vrai
 * aller-retour temps réel -- l'UI le dit explicitement (voir client-fiche.html/
 * employe-fiche.html).
 *
 * Repose sur SebaDB.list('messages')/create('messages', ...) -- même
 * mécanisme générique que 'contrats'/'custom_services' (pas de table
 * Supabase dédiée pour cette phase : seba-data.js ne synchronise QUE via
 * seba_state/entity_versions aujourd'hui, les tables normalisées du schéma
 * SQL sont dormantes). Une vraie table dédiée avec RLS employé/client aura
 * du sens quand le portail existera (lecture/écriture temps réel des DEUX
 * côtés), pas avant.
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.messagesFor / createMessage.
 */
(function () {
  'use strict';

  function messagesFor(kind, id) {
    if (!window.SebaDB || !id) return [];
    const field = kind === 'employe' ? 'employeId' : 'clientId';
    return SebaDB.list('messages')
      .filter(m => m[field] === id)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  function createMessage(obj) {
    if (!window.SebaDB) return null;
    return SebaDB.create('messages', Object.assign({ lu: false }, obj));
  }

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.messagesFor = messagesFor;
  window.SebaQuotes.createMessage = createMessage;
})();
