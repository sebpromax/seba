/* message-log.js — Seba
 * Aiguillage vers SebaDB.messages (seba-data.js) -- table Supabase dédiée
 * seba_messages quand une session existe, repli local (state.messages)
 * sinon (mode démo/file://). Ce fichier ne contient plus de logique de
 * stockage lui-même depuis que seba_messages est une vraie table (voir
 * seba-data.js pour le pourquoi) ; il existe surtout pour ne pas avoir à
 * modifier client-fiche.html/employe-fiche.html, qui appellent déjà
 * messagesFor()/createMessage().
 *
 * Authentification universelle (2026-07-19) : client-espace.html ET
 * espace-terrain.html appellent tous deux messagesFor('client'|'employe',
 * id, account) avec le 3e argument -- un client ou un employe authentifie
 * a SON PROPRE auth.uid(), distinct de account (SebaDB.messages.list ne
 * peut donc plus deriver account depuis le JWT de l'appelant comme il le
 * fait pour le patron -- voir seba-data.js pour le detail). Seul le
 * patron (session sur son propre compte) omet ce 3e argument.
 *
 * API ASYNCHRONE (peut faire un aller-retour réseau réel) -- les
 * appelants doivent await ces deux fonctions.
 *
 * Script classique (voir pricing-model-registry.js pour le pourquoi).
 * Expose window.SebaQuotes.messagesFor / createMessage.
 */
(function () {
  'use strict';

  async function messagesFor(kind, id, account) {
    if (!window.SebaDB || !id) return [];
    const filter = kind === 'employe' ? { employeId: id } : { clientId: id };
    if (account) filter.account = account;
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
