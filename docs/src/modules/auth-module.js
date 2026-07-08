/**
 * @module modules/auth-module
 * AuthModule — logique d'authentification extraite de docs/auth.js
 * (PHASE 1 de la migration Seba-Core, voir ARCHITECTURE-MODULAIRE.md
 * section B.2). docs/auth.js n'est PAS supprime : window.sebaAuth reste
 * la seule integration reellement branchee aux pages HTML aujourd'hui.
 * Ce module est une reimplementation isolee et testable en parallele,
 * pas encore consommee par aucune page (voir docs/src/test-auth-migration.js
 * pour la verification de non-regression comportementale).
 *
 * Différences volontaires avec docs/auth.js, et pourquoi :
 *
 * 1. AUCUNE lecture de window.SEBA_CONFIG : la config (supabaseUrl,
 *    supabaseAnonKey) est passee au constructeur. Le chargement du fichier
 *    config.js/config.public.js (XHR synchrone en deux couches) reste une
 *    responsabilite de bootstrap de page, pas de la logique d'authentification
 *    elle-meme — melanger les deux dans le meme module empecherait de le
 *    tester en isolation avec une config arbitraire.
 * 2. AUCUNE lecture/ecriture de window.sebaAuth : ce module n'installe rien
 *    sur window. C'est un export ES nomme (import { AuthModule } from ...).
 * 3. window/document restent utilises UNIQUEMENT pour charger le SDK
 *    Supabase depuis son CDN (document.createElement('script'), puis lecture
 *    de window.supabase — le nom sous lequel le SDK UMD s'expose lui-meme).
 *    Ce n'est pas une dependance a un etat applicatif global : c'est le
 *    mecanisme d'integration du SDK tiers, incontournable sans bundler.
 * 4. esc() (docs/src/core/esc.js) n'est PAS applique a l'email/mot de passe
 *    avant l'appel Supabase : esc() encode pour un contexte d'AFFICHAGE
 *    HTML, ce n'est pas un validateur d'entree API. L'appliquer ici
 *    corromprait des emails valides contenant une apostrophe et ne protege
 *    rien puisque la donnee ne passe jamais par innerHTML dans ce module
 *    (aucun rendu DOM ici — voir point 5 du rapport de mission).
 *    La validation reelle faite ici est structurelle (format, longueur).
 */
import { eventBus } from '../core/event-bus.js';

export const AUTH_EVENTS = Object.freeze({
  SUCCESS: 'AUTH_SUCCESS',
  FAILED: 'AUTH_FAILED',
  SIGNED_OUT: 'AUTH_SIGNED_OUT',
});

const DEMO_KEY = 'seba_session_demo';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthModule {
  #config;
  #client = null;
  #loading = null;

  /** @param {{ supabaseUrl?: string, supabaseAnonKey?: string }} [config] */
  constructor(config = {}) {
    this.#config = config;
  }

  get isConfigured() {
    return !!(this.#config.supabaseUrl && this.#config.supabaseAnonKey);
  }

  #loadSDK() {
    if (this.#client) return Promise.resolve(this.#client);
    if (this.#loading) return this.#loading;
    this.#loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = () => {
        this.#client = window.supabase.createClient(this.#config.supabaseUrl, this.#config.supabaseAnonKey);
        resolve(this.#client);
      };
      s.onerror = () => reject(new Error('CDN Supabase inaccessible'));
      document.head.appendChild(s);
    });
    return this.#loading;
  }

  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ok: boolean, error?: string, session?: any, user?: any, needsConfirm?: boolean, demo?: boolean}>}
   */
  async signUp(email, password) {
    const cleanEmail = String(email || '').trim();
    if (!EMAIL_RE.test(cleanEmail)) {
      const message = 'Adresse email invalide.';
      eventBus.publish(AUTH_EVENTS.FAILED, { message });
      return { ok: false, error: message };
    }
    if (String(password || '').length < 8) {
      const message = 'Le mot de passe doit contenir au moins 8 caracteres.';
      eventBus.publish(AUTH_EVENTS.FAILED, { message });
      return { ok: false, error: message };
    }
    if (!this.isConfigured) {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify({ email: cleanEmail, ts: Date.now() })); } catch (e) {}
      eventBus.publish(AUTH_EVENTS.SUCCESS, { demo: true, email: cleanEmail });
      return { ok: true, demo: true };
    }
    try {
      const sb = await this.#loadSDK();
      const { data, error } = await sb.auth.signUp({ email: cleanEmail, password });
      if (error) {
        eventBus.publish(AUTH_EVENTS.FAILED, { message: error.message });
        return { ok: false, error: error.message };
      }
      const userId = data.user && data.user.id;
      eventBus.publish(AUTH_EVENTS.SUCCESS, { userId, email: cleanEmail, needsConfirm: !data.session });
      return { ok: true, session: data.session, user: data.user, needsConfirm: !data.session };
    } catch (e) {
      eventBus.publish(AUTH_EVENTS.FAILED, { message: e.message });
      return { ok: false, error: e.message };
    }
  }

  /**
   * @param {string} email
   * @param {string} password
   */
  async signIn(email, password) {
    const cleanEmail = String(email || '').trim();
    if (!this.isConfigured) {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify({ email: cleanEmail, ts: Date.now() })); } catch (e) {}
      eventBus.publish(AUTH_EVENTS.SUCCESS, { demo: true, email: cleanEmail });
      return { ok: true, demo: true };
    }
    try {
      const sb = await this.#loadSDK();
      const { data, error } = await sb.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) {
        eventBus.publish(AUTH_EVENTS.FAILED, { message: error.message });
        return { ok: false, error: error.message };
      }
      const userId = data.session && data.session.user && data.session.user.id;
      eventBus.publish(AUTH_EVENTS.SUCCESS, { userId, email: cleanEmail });
      return { ok: true, session: data.session };
    } catch (e) {
      eventBus.publish(AUTH_EVENTS.FAILED, { message: e.message });
      return { ok: false, error: e.message };
    }
  }

  async signOut() {
    try { localStorage.removeItem(DEMO_KEY); } catch (e) {}
    if (!this.isConfigured) {
      eventBus.publish(AUTH_EVENTS.SIGNED_OUT, { demo: true });
      return { ok: true, demo: true };
    }
    try {
      const sb = await this.#loadSDK();
      await sb.auth.signOut();
      eventBus.publish(AUTH_EVENTS.SIGNED_OUT, {});
      return { ok: true };
    } catch (e) {
      eventBus.publish(AUTH_EVENTS.FAILED, { message: e.message });
      return { ok: false, error: e.message };
    }
  }

  /** Lecture seule — ne publie pas d'evenement (pas un changement d'etat). */
  async getSession() {
    if (!this.isConfigured) {
      try {
        const demo = localStorage.getItem(DEMO_KEY);
        return demo ? { demo: true, user: JSON.parse(demo) } : null;
      } catch (e) { return null; }
    }
    try {
      const sb = await this.#loadSDK();
      const { data } = await sb.auth.getSession();
      return data.session || null;
    } catch (e) { return null; }
  }

  /**
   * Passerelle RPC generique. Reste le seul chemin d'appel Postgres attendu
   * (voir ARCHITECTURE-MODULAIRE.md section C — api-module.js sera le seul
   * consommateur prevu de cette methode, pas les modules UI).
   * @param {string} fnName
   * @param {Record<string, any>} params
   */
  async rpc(fnName, params) {
    if (!this.isConfigured) return { data: null, error: new Error('Supabase non configure') };
    try {
      const sb = await this.#loadSDK();
      return await sb.rpc(fnName, params);
    } catch (e) { return { data: null, error: e }; }
  }
}
