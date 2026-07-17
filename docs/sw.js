/* ═══════════════════════════════════════════════════════════════
   SEBA — Service Worker (PWA, mode hors-ligne)
   Stratégies :
   - Navigation HTML ET assets statiques : Network First, repli cache
     (voir note v4 ci-dessous — unifié depuis Cache First).
   - Cross-origin (CDN fonts/D3/GSAP…) : passthrough réseau.
═══════════════════════════════════════════════════════════════ */
// v4 : les assets statiques (widgets.js/seba-data.js/sidebar.js/dashboard.html...)
// passaient en Cache-First -- une fois mis en cache, ils restaient figes
// INDEFINIMENT cote navigateur, meme apres plusieurs deploiements serveur
// reussis et des Ctrl+Maj+R (qui ne vide que le cache HTTP normal, jamais le
// cache d'un Service Worker). Le correctif v3 (bump manuel de VERSION) ne
// resolvait qu'UN seul deploiement : chaque commit suivant reproduisait le
// meme blocage tant que VERSION n'etait pas re-bumpe a la main. Passer TOUS
// les assets en Network First (comme la navigation) elimine la classe de bug
// : plus besoin de se souvenir de bumper VERSION a chaque deploiement.
const VERSION = 'seba-v4';
const CORE = [
  './',
  'index.html', 'connexion.html', 'onboarding.html', 'offline.html',
  'app/dashboard.html', 'clients.html', 'planning.html', 'devis.html',
  'devis-nouveau.html', 'factures.html', 'equipe.html', 'reglages.html', 'historique.html',
  'pro-global.css', 'sidebar.js', 'businessTypes.js', 'widgets.js', 'seba-data.js',
  'services/config-dashboard.js', 'services/widget-data-api.js',
  'auth.js', 'guard.js', 'theme.js',
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

  const isNavigate = req.mode === 'navigate';

  // Network First pour tout le contenu same-origin (navigation ET assets
  // statiques) : le réseau gagne toujours quand il est disponible, le cache
  // ne sert que de repli hors-ligne. Évite qu'un fichier mis en cache une
  // fois reste figé indéfiniment (voir note v4 en tête de fichier).
  // { cache: 'no-store' } : sans ça, ce fetch() reste soumis au cache HTTP
  // normal du navigateur (Cache-Control: max-age=600 sur GitHub Pages) --
  // "Network First" ne gagnait donc pas toujours vraiment le réseau, juste
  // le cache du Service Worker ; le cache HTTP pouvait encore servir une
  // version vieille de 10 min sans la moindre requête réseau réelle.
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // Repli hors-ligne : uniquement pour une navigation de page jamais
          // mise en cache (servir dashboard.html à la place d'une page
          // inconnue serait trompeur : l'utilisateur ne saurait pas qu'il
          // est hors ligne). Un asset statique jamais caché échoue
          // simplement — comportement identique à avant pour ce cas.
          return isNavigate ? caches.match('offline.html') : undefined;
        })
      )
  );
});
