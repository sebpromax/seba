/* ═══════════════════════════════════════════════════════════════
   SEBA — Bascule de thème (Tactical Dark / Audit Light)
   L'attribut data-theme est pose sur <html>, lu par pro-global.css.
   Le snippet anti-flash (inline, avant tout <link>) fait deja le
   premier rendu ; ce fichier fournit juste l'API pour le bouton.
═══════════════════════════════════════════════════════════════ */
window.sebaTheme = {
  KEY: 'seba_theme',
  get() {
    try { return localStorage.getItem(this.KEY) || 'dark'; } catch (e) { return 'dark'; }
  },
  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(this.KEY, theme); } catch (e) {}
    document.dispatchEvent(new CustomEvent('seba-theme-change', { detail: { theme } }));
  },
  toggle() {
    const next = this.get() === 'dark' ? 'light' : 'dark';
    this.set(next);
    return next;
  },
};
