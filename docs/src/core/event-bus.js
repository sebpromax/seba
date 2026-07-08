/**
 * @module core/event-bus
 * Bus d'evenements natif (EventTarget) — seul canal de communication entre
 * modules dans l'architecture Seba-Core. Aucun module ne doit importer un
 * autre module metier directement : on publie un evenement, on s'y abonne.
 * Voir ARCHITECTURE-MODULAIRE.md section B.1/B.2 pour le contrat complet.
 */
export class EventBus {
  #target = new EventTarget();
  /* subscribe() enveloppe chaque callback dans un handler qui deballe
     event.detail — removeEventListener a besoin de cette meme reference
     enveloppee, pas du callback d'origine. Ce registre (callback -> handler
     par evenement) est ce qui permet a unsubscribe() de retrouver et
     retirer le bon handler. Sans lui, unsubscribe(event, callback) serait
     silencieusement un no-op (le callback brut ne correspond a rien dans
     l'EventTarget). */
  #registry = new Map();

  /**
   * @param {string} eventName
   * @param {(data: any) => void} callback
   */
  subscribe(eventName, callback) {
    const handler = (e) => callback(e.detail);
    if (!this.#registry.has(callback)) this.#registry.set(callback, new Map());
    this.#registry.get(callback).set(eventName, handler);
    this.#target.addEventListener(eventName, handler);
  }

  /**
   * @param {string} eventName
   * @param {(data: any) => void} callback
   */
  unsubscribe(eventName, callback) {
    const handlers = this.#registry.get(callback);
    const handler = handlers && handlers.get(eventName);
    if (!handler) return;
    this.#target.removeEventListener(eventName, handler);
    handlers.delete(eventName);
    if (handlers.size === 0) this.#registry.delete(callback);
  }

  /**
   * @param {string} eventName
   * @param {any} [data]
   */
  publish(eventName, data) {
    this.#target.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  }
}

export const eventBus = new EventBus();
