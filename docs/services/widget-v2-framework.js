/* widget-v2-framework.js — Seba
 * Contrat WidgetV2 : classe de base pour les widgets migrés vers le dashboard
 * V2 qui ont besoin d'un cycle de vie réel (chargement asynchrone d'une lib
 * externe, rendu impératif, réaction au redimensionnement) — par opposition
 * au patron plus simple mountV2Widgets()/def.render(ctx, el) de docs/widgets.js,
 * qui suffit pour un rendu synchrone "données -> chaîne HTML".
 *
 * Chargé après seba-data.js, avant widgets.js (docs/app/dashboard.html) :
 * les sous-classes (ex. LotCarteWidgetV2, définie dans widgets.js) ont besoin
 * de WidgetV2 déjà défini au moment où leur fichier s'exécute.
 *
 * Contrat (voir _architecture/DASHBOARD_V2_MASTER_PLAN.md) :
 *   constructor(container)  — pas de logique, juste l'état initial.
 *   async load()             — chargement de données/lib externes. Peut échouer :
 *                              l'orchestrateur mount() intercepte et appelle
 *                              renderError() à la place de render()/onMount().
 *   render()                 — construit le DOM de base dans this.container.
 *   onMount()                — hook post-insertion (ex. invalidateSize()).
 *   onResize()                — appelé par le ResizeObserver interne à chaque
 *                              changement de dimension de this.container.
 *   onDestroy()               — nettoyage (déconnecte le ResizeObserver ; les
 *                              sous-classes surchargent et appellent super.onDestroy()).
 *   renderError(err)          — état d'erreur ; surchargeable pour un message
 *                              spécifique au widget (sinon message générique).
 *
 * mount() est l'orchestrateur : il appelle load() -> render() -> onMount() ->
 * démarre le ResizeObserver, dans cet ordre fixe, et ne doit JAMAIS être
 * réécrit par une sous-classe (elles surchargent les hooks, pas l'ordre).
 */
(function () {
  'use strict';

  class WidgetV2 {
    constructor(container) {
      if (!container) throw new Error('WidgetV2: container requis');
      this.container = container;
      this._destroyed = false;
      this._resizeObserver = null;
    }

    async load() {}
    render() {}
    onMount() {}
    onResize() {}

    /* Sous-classes : toujours appeler super.onDestroy() en premier si
       surchargée, pour ne pas oublier de déconnecter le ResizeObserver
       (fuite mémoire sinon — voir checklist DASHBOARD_V2_MASTER_PLAN.md). */
    onDestroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      this._destroyed = true;
    }

    /* État "Erreur élégant" par défaut si load() rejette — surchargeable
       pour un message propre au widget (voir LotCarteWidgetV2). */
    renderError(err) {
      if (this.container) {
        this.container.innerHTML = '<div class="tl-empty">Widget indisponible.</div>';
      }
    }

    async mount() {
      try {
        await this.load();
      } catch (err) {
        if (!this._destroyed) this.renderError(err);
        return;
      }
      if (this._destroyed) return; // détruit pendant le load() asynchrone
      /* Isolation de pannes (P.Bulletproof, pilier 2) : render()/onMount()
         sont synchrones et appelés depuis appendClassWidget() sans attendre
         la promesse mount() — une exception ici ne remontait nulle part
         (rejet de promesse non observé), laissant le widget dans un état
         DOM à moitié construit sans message d'erreur. Même garde que le
         load() ci-dessus, pour un widget cohérent dans tous les cas d'échec. */
      try {
        this.render();
        this.onMount();
      } catch (err) {
        if (!this._destroyed) this.renderError(err);
        return;
      }
      this._attachResizeObserver();
    }

    _attachResizeObserver() {
      if (this._destroyed || typeof ResizeObserver === 'undefined' || !this.container) return;
      this._resizeObserver = new ResizeObserver(() => {
        if (!this._destroyed) this.onResize();
      });
      this._resizeObserver.observe(this.container);
    }
  }

  /* ── AssetLoader (singleton) ────────────────────────────────────────────
   * Garantit qu'un script/CSS externe n'est chargé qu'une seule fois, quel
   * que soit le nombre de widgets qui le demandent en parallèle — un cache
   * de promesses par nom, pas par widget. Une promesse rejetée est retirée
   * du cache (pas de rejet mis en cache pour toujours) : un widget suivant
   * qui redemande le même asset après un échec réseau obtient une vraie
   * nouvelle tentative, pas l'échec figé du premier appelant. */
  const _assetCache = new Map(); // name -> Promise

  const AssetLoader = {
    load(name, loaderFn) {
      if (_assetCache.has(name)) return _assetCache.get(name);
      const promise = Promise.resolve().then(loaderFn);
      _assetCache.set(name, promise);
      promise.catch(() => { _assetCache.delete(name); });
      return promise;
    },
  };

  window.WidgetV2 = WidgetV2;
  window.AssetLoader = AssetLoader;
})();
