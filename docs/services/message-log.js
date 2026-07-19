/* message-log.js — Seba
 * Aiguillage vers SebaDB.messages (seba-data.js) -- table Supabase dédiée
 * seba_messages quand une session existe, repli local (state.messages)
 * sinon (mode démo/file://). Ce fichier ne contient plus de logique de
 * stockage lui-même depuis que seba_messages est une vraie table (voir
 * seba-data.js pour le pourquoi) ; il existe surtout pour ne pas avoir à
 * modifier client-fiche.html/employe-fiche.html, qui appellent déjà
 * messagesFor()/createMessage().
 *
 * Depuis l'Espace Client (2026-07-19), un vrai aller-retour existe :
 * client-espace.html appelle messagesFor('client', clientId, account) --
 * le 3e argument est necessaire car un client authentifie a SON PROPRE
 * auth.uid(), distinct de account (SebaDB.messages.list ne peut donc
 * plus deriver account depuis le JWT de l'appelant comme il le fait pour
 * le patron/employe -- voir seba-data.js pour le detail). Cote employe,
 * le PIN (employe-auth.ts) badge toujours un employe sur l'appareil deja
 * authentifie du patron plutot que de creer une session independante --
 * account reste dans ce cas derive normalement, le 3e argument est omis.
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
