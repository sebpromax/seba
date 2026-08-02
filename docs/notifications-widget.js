/* ═══════════════════════════════════════════════════════════════
   SEBA — Centre de notifications commun (Lot 1 du programme portails).

   Widget autonome, injecté par script sur les 3 portails (patron/client/
   salarié) : cloche + compteur non-lu + liste déroulante. Consomme les
   RPC de migrations/2026-08-02-portal-notifications-foundation.sql
   (get_my_notifications/get_my_unread_notification_count/
   mark_notification_read/mark_all_notifications_read) via window.sebaAuth
   déjà chargé par la page hôte (auth.js).

   Design volontairement auto-porté (tokens scopés .sn-*, jamais les
   tokens des pages hôtes) : le système de tokens réel des pages
   patron/client/salarié n'a pas pu être retrouvé de façon fiable dans le
   temps de ce lot (--bg/--ink/--emerald référencés partout mais jamais
   définis dans un fichier CSS trouvé -- probablement injectés par un
   mécanisme non identifié ici). Ce choix évite tout risque de casser
   l'existant : le widget ne dépend que de lui-même, marron/brun/caramel/
   ivoire uniquement, clair/sombre via [data-theme] déjà posé par
   theme.js sur toutes les pages hôtes.

   Polling simple (pas de Supabase Realtime dans ce lot, voir
   _architecture/PORTALS_MAX_ROADMAP.md, Lot 15) : 45s, jamais plus
   agressif pour ne pas alourdir un poste terrain en 4G.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const POLL_MS = 45000;
  const STYLE_ID = 'sn-styles';
  const ROOT_ID = 'sn-root';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
:root{
  --sn-bg:#F8F4ED;--sn-ink:#2E1D0F;--sn-ink-2:#6B5B4C;--sn-border:rgba(46,29,15,.14);
  --sn-caramel:#B9825C;--sn-caramel-dark:#8D5F42;--sn-surface:#FFFFFF;--sn-hover:rgba(185,130,92,.10);
  --sn-shadow:rgba(46,29,15,.18);--sn-error-on-light:#481212;
}
[data-theme="dark"]{
  --sn-bg:#1D1713;--sn-ink:#F8F4ED;--sn-ink-2:#C8B9A6;--sn-border:rgba(245,240,231,.14);
  --sn-caramel:#B9825C;--sn-caramel-dark:#B9825C;--sn-surface:#2A211B;--sn-hover:rgba(185,130,92,.14);
  --sn-shadow:rgba(0,0,0,.45);--sn-error-on-light:#F87171;
}
#${ROOT_ID}{position:fixed;top:14px;right:14px;z-index:900;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;}
.sn-bell{position:relative;width:44px;height:44px;border-radius:12px;border:1.5px solid var(--sn-border);background:var(--sn-surface);color:var(--sn-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .15s;}
.sn-bell:hover{border-color:var(--sn-caramel);}
.sn-bell:focus-visible{outline:2px solid var(--sn-caramel);outline-offset:3px;}
.sn-bell svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;}
.sn-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:var(--sn-caramel);color:#fff;font-size:.62rem;font-weight:700;display:none;align-items:center;justify-content:center;line-height:1;}
.sn-badge.visible{display:flex;}
.sn-panel{position:absolute;top:calc(100% + 8px);right:0;width:min(360px,88vw);max-height:70vh;overflow-y:auto;background:var(--sn-surface);border:1px solid var(--sn-border);border-radius:14px;box-shadow:0 16px 40px var(--sn-shadow);display:none;}
.sn-panel.open{display:block;}
.sn-panel-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--sn-border);position:sticky;top:0;background:var(--sn-surface);}
.sn-panel-title{font-size:.85rem;font-weight:700;color:var(--sn-ink);}
.sn-mark-all{font-size:.72rem;font-weight:600;color:var(--sn-caramel-dark);background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:6px;}
.sn-mark-all:hover{background:var(--sn-hover);}
.sn-mark-all:focus-visible{outline:2px solid var(--sn-caramel);outline-offset:2px;}
.sn-list{list-style:none;margin:0;padding:0;}
.sn-item{display:block;width:100%;text-align:left;padding:12px 14px;border:none;border-bottom:1px solid var(--sn-border);background:none;cursor:pointer;font-family:inherit;}
.sn-item:last-child{border-bottom:none;}
.sn-item:hover{background:var(--sn-hover);}
.sn-item:focus-visible{outline:2px solid var(--sn-caramel);outline-offset:-2px;}
.sn-item.unread{background:var(--sn-hover);}
.sn-item-title{font-size:.85rem;font-weight:700;color:var(--sn-ink);margin-bottom:2px;}
.sn-item-body{font-size:.78rem;color:var(--sn-ink-2);margin-bottom:4px;}
.sn-item-time{font-size:.68rem;color:var(--sn-ink-2);}
.sn-item.severity-urgent .sn-item-title{color:var(--sn-error-on-light);}
.sn-empty{padding:32px 14px;text-align:center;font-size:.82rem;color:var(--sn-ink-2);}
@media (max-width:480px){
  #${ROOT_ID}{top:10px;right:10px;}
  .sn-panel{position:fixed;top:64px;right:8px;left:8px;width:auto;}
}
`;
    document.head.appendChild(style);
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' h';
    return Math.floor(h / 24) + ' j';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const SebaNotifications = {
    _open: false,
    _timer: null,

    async init() {
      if (!window.sebaAuth || !sebaAuth.isConfigured) return;
      injectStyles();
      if (document.getElementById(ROOT_ID)) return;

      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.innerHTML = `
<button type="button" class="sn-bell" id="sn-bell-btn" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
  <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
  <span class="sn-badge" id="sn-badge"></span>
</button>
<div class="sn-panel" id="sn-panel" role="region" aria-label="Liste des notifications">
  <div class="sn-panel-head">
    <span class="sn-panel-title">Notifications</span>
    <button type="button" class="sn-mark-all" id="sn-mark-all">Tout marquer lu</button>
  </div>
  <ul class="sn-list" id="sn-list"></ul>
</div>`;
      document.body.appendChild(root);

      const bellBtn = document.getElementById('sn-bell-btn');
      const panel = document.getElementById('sn-panel');
      bellBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
      document.getElementById('sn-mark-all').addEventListener('click', (e) => { e.stopPropagation(); this.markAllRead(); });
      document.addEventListener('click', (e) => { if (this._open && !root.contains(e.target)) this.close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._open) this.close(); });

      await this.refreshBadge();
      this._timer = setInterval(() => this.refreshBadge(), POLL_MS);
    },

    toggle() { this._open ? this.close() : this.open(); },
    open() {
      this._open = true;
      document.getElementById('sn-panel').classList.add('open');
      document.getElementById('sn-bell-btn').setAttribute('aria-expanded', 'true');
      this.loadList();
    },
    close() {
      this._open = false;
      document.getElementById('sn-panel').classList.remove('open');
      document.getElementById('sn-bell-btn').setAttribute('aria-expanded', 'false');
    },

    async refreshBadge() {
      try {
        const { data, error } = await sebaAuth.rpc('get_my_unread_notification_count', {});
        if (error) return;
        const badge = document.getElementById('sn-badge');
        if (!badge) return;
        if (data && data > 0) { badge.textContent = data > 99 ? '99+' : String(data); badge.classList.add('visible'); }
        else { badge.classList.remove('visible'); }
      } catch (e) { /* réseau indisponible : badge inchangé, jamais une erreur visible */ }
    },

    async loadList() {
      const list = document.getElementById('sn-list');
      if (!list) return;
      list.innerHTML = '<li class="sn-empty">Chargement…</li>';
      try {
        const { data, error } = await sebaAuth.rpc('get_my_notifications', { p_limit: 30, p_only_unread: false });
        if (error || !data) { list.innerHTML = '<li class="sn-empty">Impossible de charger les notifications.</li>'; return; }
        if (data.length === 0) { list.innerHTML = '<li class="sn-empty">Aucune notification pour le moment.</li>'; return; }
        list.innerHTML = data.map((n) => `
<li>
  <button type="button" class="sn-item ${n.read_at ? '' : 'unread'} severity-${n.severity}" data-id="${n.id}" data-link-entity="${escapeHtml(n.link_entity || '')}" data-link-id="${escapeHtml(n.link_entity_id || '')}">
    <div class="sn-item-title">${escapeHtml(n.title)}</div>
    ${n.body ? `<div class="sn-item-body">${escapeHtml(n.body)}</div>` : ''}
    <div class="sn-item-time">${timeAgo(n.created_at)}</div>
  </button>
</li>`).join('');
        list.querySelectorAll('.sn-item').forEach((btn) => {
          btn.addEventListener('click', () => this.onItemClick(btn.dataset.id, btn.dataset.linkEntity, btn.dataset.linkId));
        });
      } catch (e) {
        list.innerHTML = '<li class="sn-empty">Impossible de charger les notifications.</li>';
      }
    },

    async onItemClick(id, linkEntity, linkId) {
      try { await sebaAuth.rpc('mark_notification_read', { p_id: id }); } catch (e) {}
      await this.refreshBadge();
      await this.loadList();
      // Navigation contextuelle minimale (V1) : pas de routeur générique
      // par entité dans ce lot, laisse la page hôte gérer si besoin futur.
      void linkEntity; void linkId;
    },

    async markAllRead() {
      try { await sebaAuth.rpc('mark_all_notifications_read', {}); } catch (e) {}
      await this.refreshBadge();
      await this.loadList();
    },
  };

  window.SebaNotifications = SebaNotifications;
})();
