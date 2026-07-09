/**
 * @module modules/data-module
 * DataModule — persistance centralisee (LocalStorage aujourd'hui, Supabase
 * pourra s'ajouter comme second "backend" plus tard sans changer ce contrat)
 * pour l'architecture Seba-Core (voir ARCHITECTURE-MODULAIRE.md,
 * ARCHITECTURE-V2.md section 5). Isole et testable en parallele — ne
 * remplace pas encore docs/seba-data.js (SebaDB), qui reste la seule
 * integration reellement branchee aux pages HTML aujourd'hui.
 *
 * Decisions volontaires par rapport au brief, et pourquoi :
 *
 * 1. Pas d'import direct de auth-module.js. Ce module reagit a l'evenement
 *    AUTH_SIGNED_OUT par son NOM (chaine litterale), jamais en important
 *    AUTH_EVENTS depuis modules/auth-module.js — importer un autre module
 *    metier violerait la regle "aucun module n'importe un autre module
 *    directement" (ARCHITECTURE-MODULAIRE.md section B.1). Les deux modules
 *    ne se connaissent que via le nom des evenements qu'ils partagent,
 *    jamais via un import de code.
 *
 *    N'ecoute PLUS AUTH_SUCCESS directement (retire lors de la
 *    deduplication TELEMETRY_READY, voir docs/MIGRATION_TELEMETRY_REPORT.md
 *    "duplication AUTH_SUCCESS") : ce module reagissait a AUTH_SUCCESS en
 *    fetchant lui-meme seba_db/sebaEntreprise, EN PARALLELE de consommateurs
 *    qui redemandaient exactement les memes cles via DATA_REQUEST sur le
 *    meme evenement (TelemetryModule pour seba_db, UIController pour
 *    sebaEntreprise) — deux chemins pour une seule cle, donc deux
 *    DATA_SUCCESS et deux calculs en aval par connexion, verifie en Node ET
 *    en navigateur reel. Retirer le fetch direct de DataModule ne perd
 *    aucune donnee : DataModule reste un pur repondeur DATA_REQUEST
 *    (Request-Response, point 3 ci-dessous), et c'est desormais au
 *    CONSOMMATEUR de demander ce dont il a besoin — source unique de
 *    verite pour "qui declenche quel fetch", au lieu de deux emetteurs
 *    independants pour la meme cle.
 * 2. `storage` est injecte au constructeur (ni window.localStorage lu en
 *    dur, ni aucun autre acces a `window`) — sandboxing demande par le
 *    brief, et ce qui permet de mocker entierement la persistance dans
 *    docs/src/test-data-migration.js sans dependre d'un vrai navigateur.
 * 3. Le "Request-Response" du brief est implemente comme UN SEUL evenement
 *    d'entree DATA_REQUEST portant { action, key, payload }, plutot que
 *    trois evenements distincts SAVE/FETCH/DELETE — c'est la lecture la
 *    plus fidele de la forme donnee dans le brief
 *    ("écoute les événements {action: 'SAVE'|'FETCH'|'DELETE', key, payload}",
 *    un seul objet avec un champ action). Les methodes save()/fetch()/
 *    delete() restent aussi appelables directement (retour de Promise),
 *    pour rester "pure function compatible" et faciles a tester sans passer
 *    par le bus a chaque assertion.
 * 4. Les evenements de sortie n'incluent pas de champ `type` redondant :
 *    l'EventBus encode deja le type via le NOM de l'evenement
 *    (`eventBus.publish('DATA_SUCCESS', { key, data })`), exactement comme
 *    AUTH_SUCCESS/AUTH_FAILED dans auth-module.js. Ajouter en plus
 *    `{ type: 'DATA_SUCCESS', ... }` a l'interieur du payload dupliquerait
 *    une information deja portee par le nom de l'evenement.
 */
import { eventBus } from '../core/event-bus.js';

export const DATA_EVENTS = Object.freeze({
  REQUEST: 'DATA_REQUEST',
  SUCCESS: 'DATA_SUCCESS',
  ERROR: 'DATA_ERROR',
  CLEARED: 'DATA_CLEARED',
});

// Nom d'evenement d'un AUTRE module (auth-module.js), reference par
// chaine litterale et jamais par import — voir point 1 ci-dessus.
const AUTH_SIGNED_OUT = 'AUTH_SIGNED_OUT';

/**
 * Registre des cles LocalStorage autorisees et de leur validateur. Toute
 * cle absente de ce registre est refusee par save() — c'est le garde-fou
 * contre la proliferation de cles orphelines demande par le brief (section 5).
 *
 * Volontairement limite aux cles deja reelles et centrales aujourd'hui
 * (seba_db = le blob SebaDB, sebaEntreprise = profil entreprise onboarding,
 * seba_session_demo = session demo d'auth-module.js). D'autres cles reelles
 * existent dans le repo (seba_theme, seba_dashboard_layout,
 * seba_calibration_seen...) mais etendre le registre a chacune est une
 * decision separee, a prendre quand ces pages migreront reellement vers
 * DataModule — non tranchee ici, ce module n'est pas encore consomme.
 * @type {Map<string, (data: any) => boolean>}
 */
export const REGISTRY = new Map([
  ['seba_db', (d) => !!d && typeof d === 'object'
    && Array.isArray(d.clients) && Array.isArray(d.devis) && Array.isArray(d.factures)
    && Array.isArray(d.interventions) && Array.isArray(d.employes)],
  ['sebaEntreprise', (d) => !!d && typeof d === 'object'
    && (d.nom === undefined || typeof d.nom === 'string')
    && (d.secteur === undefined || typeof d.secteur === 'string')
    && (d.email === undefined || typeof d.email === 'string')],
  ['seba_session_demo', (d) => !!d && typeof d === 'object'
    && typeof d.email === 'string' && typeof d.ts === 'number'],
]);

/**
 * Parse JSON defensif — fonction pure, aucun acces I/O. Ne lance jamais :
 * retourne toujours une forme discriminee { ok, data|error }.
 * @param {string|null} raw
 * @returns {{ok: true, data: any} | {ok: false, error: string}}
 */
export function safeParse(raw) {
  if (raw == null) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: 'JSON corrompu : ' + e.message };
  }
}

export class DataModule {
  #storage;
  #registry;
  /** file d'attente par cle — garantit qu'un SAVE/FETCH/DELETE sur une meme
      cle ne s'execute jamais en meme temps qu'un autre (mutex simple par
      chainage de promesses, cf. section 1 "LOCK" du brief). */
  #locks = new Map();

  /**
   * @param {{ storage: {getItem: Function, setItem: Function, removeItem: Function}, registry?: Map<string, Function> }} deps
   */
  constructor({ storage, registry = REGISTRY } = {}) {
    if (!storage || typeof storage.getItem !== 'function') {
      throw new Error('DataModule requiert une dependance storage injectee (getItem/setItem/removeItem) — voir sandboxing.');
    }
    this.#storage = storage;
    this.#registry = registry;

    eventBus.subscribe(DATA_EVENTS.REQUEST, ({ action, key, payload }) => {
      if (action === 'SAVE') this.save(key, payload);
      else if (action === 'FETCH') this.fetch(key);
      else if (action === 'DELETE') this.delete(key);
    });
    eventBus.subscribe(AUTH_SIGNED_OUT, () => this.clearAll());
  }

  /**
   * @param {string} key
   * @param {any} data
   * @returns {boolean}
   */
  validate(key, data) {
    const validator = this.#registry.get(key);
    return typeof validator === 'function' && validator(data);
  }

  /** Chaine l'operation apres la precedente sur la meme cle, quel que soit
      son issue (resolue/rejetee), pour ne jamais bloquer les operations
      suivantes sur cette cle si l'une d'elles echoue. */
  #runExclusive(key, task) {
    const previousTail = this.#locks.get(key) || Promise.resolve();
    const result = previousTail.then(task, task);
    this.#locks.set(key, result.then(() => undefined, () => undefined));
    return result;
  }

  /**
   * @param {string} key
   * @param {any} payload
   * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
   */
  save(key, payload) {
    return this.#runExclusive(key, () => {
      if (!this.#registry.has(key)) {
        const error = 'cle non enregistree : "' + key + '" (voir REGISTRY dans data-module.js)';
        eventBus.publish(DATA_EVENTS.ERROR, { key, error });
        return { ok: false, error };
      }
      if (!this.validate(key, payload)) {
        const error = 'payload invalide pour la cle "' + key + '"';
        eventBus.publish(DATA_EVENTS.ERROR, { key, error });
        return { ok: false, error };
      }
      try {
        this.#storage.setItem(key, JSON.stringify(payload));
        eventBus.publish(DATA_EVENTS.SUCCESS, { key, data: payload });
        return { ok: true, data: payload };
      } catch (e) {
        eventBus.publish(DATA_EVENTS.ERROR, { key, error: e.message });
        return { ok: false, error: e.message };
      }
    });
  }

  /**
   * @param {string} key
   * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
   */
  fetch(key) {
    return this.#runExclusive(key, () => {
      let raw;
      try {
        raw = this.#storage.getItem(key);
      } catch (e) {
        eventBus.publish(DATA_EVENTS.ERROR, { key, error: e.message });
        return { ok: false, error: e.message };
      }
      const parsed = safeParse(raw);
      if (!parsed.ok) {
        // JSON-GUARD : donnee corrompue -> on reinitialise la cle plutot que
        // de laisser une exception se reproduire a chaque lecture future.
        try { this.#storage.removeItem(key); } catch (e) {}
        eventBus.publish(DATA_EVENTS.ERROR, { key, error: parsed.error });
        return { ok: false, error: parsed.error };
      }
      eventBus.publish(DATA_EVENTS.SUCCESS, { key, data: parsed.data });
      return { ok: true, data: parsed.data };
    });
  }

  /**
   * @param {string} key
   * @returns {Promise<{ok: boolean}>}
   */
  delete(key) {
    return this.#runExclusive(key, () => {
      try {
        this.#storage.removeItem(key);
        eventBus.publish(DATA_EVENTS.SUCCESS, { key, data: null });
        return { ok: true };
      } catch (e) {
        eventBus.publish(DATA_EVENTS.ERROR, { key, error: e.message });
        return { ok: false, error: e.message };
      }
    });
  }

  /** Purge immediate de toutes les cles du registre (reaction a AUTH_SIGNED_OUT). */
  async clearAll() {
    for (const key of this.#registry.keys()) {
      await this.delete(key);
    }
    eventBus.publish(DATA_EVENTS.CLEARED, {});
  }
}
