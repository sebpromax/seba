/* message-log.js — Seba
 * Aiguillage vers SebaDB.messages (seba-data.js) -- table Supabase dédiée
 * seba_messages quand une session existe, repli local (state.messages)
 * sinon (mode démo/file://). Ce fichier ne contient plus de logique de
 * stockage lui-même depuis que seba_messages est une vraie table (voir
 * seba-data.js pour le pourquoi) ; il existe surtout pour ne pas avoir à
 * modifier client-fiche.html/employe-fiche.html, qui appellent déjà
 * messagesFor()/createMessage().
 *
 * Toujours pas un vrai aller-retour temps réel pour le client : aucun
 * portail client n'existe pour qu'il lise/réponde. Côté employé, le PIN
 * (employe-auth.ts) badge un employé sur l'appareil déjà authentifié du
 * patron plutôt que de créer une session indépendante -- voir seba-data.js
 * pour le détail RLS.
 *
 * API désormais ASYNCHRONE (peut faire un aller-retour réseau réel) --
 * les appelants (client-fiche.html/employe-fiche.html) doivent await ces
 * deux fonctions.
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.messagesFor / createMessage.
 */
(function () {
  'use strict';

  async function messagesFor(kind, id) {
    if (!window.SebaDB || !id) return [];
    const filter = kind === 'employe' ? { employeId: id } : { clientId: id };
    try {
      return await SebaDB.messages.list(filter);
    } catch (e) {
      console.warn('[message-log] lecture impossible', e.message);
      return [];
    }
  }

  async function createMessage(obj) {
    if (!window.SebaDB) return null;
    return SebaDB.messages.send(obj);
  }

  window.SebaQuotes = window.SebaQuotes || {};
  window.SebaQuotes.messagesFor = messagesFor;
  window.SebaQuotes.createMessage = createMessage;
})();
