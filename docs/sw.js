/* ═══════════════════════════════════════════════════════════════
   SEBA — Service Worker (PWA, mode hors-ligne)
   Stratégies :
   - Navigation HTML  : Network First, repli cache (le dashboard
     s'affiche même sans réseau une fois visité).
   - Assets statiques : Cache First, repli réseau + mise en cache.
   - Cross-origin (CDN fonts/D3/GSAP…) : passthrough réseau.
═══════════════════════════════════════════════════════════════ */
const VERSION = 'seba-v1';
const CORE = [
  './',
  'index.html', 'connexion.html', 'onboarding.html',
  'dashboard.html', 'clients.html', 'planning.html', 'devis.html',
  'devis-nouveau.html', 'factures.html', 'equipe.html', 'reglages.html', 'historique.html',
  'pro-global.css', 'sidebar.js', 'businessTypes.js', 'widgets.js', 'seba-data.js',
  'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) =>
      // addAll échoue en bloc si UNE ressource manque : on cache
      // fichier par fichier en tolérant les absents.
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN : réseau direct

  if (req.mode === 'navigate') {
    // Network First — toujours la version fraîche si possible
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('dashboard.html'))
        )
    );
    return;
  }

  // Statique : Cache First
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
