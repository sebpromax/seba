/* ═══════════════════════════════════════════════════════════════
   KINETIC GRID — grille de nœuds magnétiques (spec Dual-Tone, index.html).
   Canvas 2D vanilla, zéro dépendance.

   - Résolution physique : clientWidth/Height × devicePixelRatio (netteté
     native, pas de flou d'antialiasing).
   - Attraction : rayon 180 px, force (180−d)/180 vers le curseur,
     interpolation amortie (damping 0.1).
   - Chrominance : les nœuds transitent du gris de repos (--grid-node)
     vers le Cyan Émeraude (--db-teal), opacité 0.9 au centre → 0 au bord.
   - Énergie : requestAnimationFrame exclusivement, et la boucle S'ARRÊTE
     quand la souris est immobile et que tous les nœuds sont revenus au
     repos → consommation CPU nulle à l'idle.
   - Guards repo : prefers-reduced-motion et navigator.webdriver = grille
     statique dessinée une fois (déterministe), aucun écouteur.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var canvas = document.getElementById('kinetic-grid');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var PITCH = 45;          // pas de grille (px CSS)
  var NODE_R = 0.6;        // rayon (diamètre 1.2px)
  var RADIUS = 180;        // rayon d'attraction (px CSS)
  var DAMPING = 0.1;       // coefficient d'amortissement
  var EPS = 0.05;          // seuil de repos (px)

  /* Couleurs depuis les tokens :root (fallbacks = valeurs de la spec). */
  var styles = getComputedStyle(document.documentElement);
  function token(name, fallback) {
    var v = styles.getPropertyValue(name).trim();
    return v || fallback;
  }
  var REST_COLOR = token('--grid-node', 'rgba(63,63,70,.4)');
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [13, 148, 136];
  }
  var TEAL = hexToRgb(token('--db-teal', '#0D9488'));

  var W = 0, H = 0, DPR = 1;
  var nodes = [];

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = document.documentElement.clientWidth;
    H = document.documentElement.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    nodes = [];
    for (var y = PITCH / 2; y < H + PITCH; y += PITCH) {
      for (var x = PITCH / 2; x < W + PITCH; x += PITCH) {
        nodes.push({ ox: x, oy: y, x: x, y: y, heat: 0 });
      }
    }
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = REST_COLOR;
    for (var i = 0; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.arc(nodes[i].x, nodes[i].y, NODE_R, 0, 6.2832);
      ctx.fill();
    }
  }

  build();
  drawStatic();

  /* Grille statique uniquement : motion réduit ou capture QA. */
  if (navigator.webdriver) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('resize', function () { build(); drawStatic(); });
    return;
  }

  var mx = -1e4, my = -1e4;   // souris hors champ au départ
  var running = false;
  var rafId = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    var settled = true;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var dx = mx - n.ox, dy = my - n.oy;
      var d = Math.sqrt(dx * dx + dy * dy);
      var tx = n.ox, ty = n.oy, heat = 0;
      if (d < RADIUS && d > 0.001) {
        var delta = (RADIUS - d) / RADIUS;      // force ∝ proximité
        tx = n.ox + dx * delta * 0.5;           // dérive VERS la souris
        ty = n.oy + dy * delta * 0.5;
        heat = delta;                            // 1 au centre → 0 au bord
      }
      n.x += (tx - n.x) * DAMPING;
      n.y += (ty - n.y) * DAMPING;
      n.heat += (heat - n.heat) * DAMPING;
      // Repos = chaque nœud a atteint SA CIBLE (position et chaleur) — une
      // souris immobile au-dessus de la grille produit des nœuds chauds mais
      // STABLES : l'image est statique, la boucle peut s'éteindre quand même.
      if (settled && (Math.abs(n.x - tx) > EPS || Math.abs(n.y - ty) > EPS || Math.abs(n.heat - heat) > 0.01)) settled = false;

      if (n.heat > 0.01) {
        ctx.fillStyle = 'rgba(' + TEAL[0] + ',' + TEAL[1] + ',' + TEAL[2] + ',' + (n.heat * 0.9).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_R + n.heat * 0.8, 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillStyle = REST_COLOR;
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_R, 0, 6.2832);
        ctx.fill();
      }
    }
    if (settled) {
      // Souris immobile + nœuds au repos : boucle stoppée, CPU à 0%.
      running = false;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function wake() {
    if (!running && !document.hidden) {
      running = true;
      rafId = requestAnimationFrame(frame);
    }
  }

  window.addEventListener('pointermove', function (e) {
    mx = e.clientX; my = e.clientY;
    wake();
  }, { passive: true });
  window.addEventListener('pointerleave', function () {
    mx = -1e4; my = -1e4;
    wake(); // laisse les nœuds dériver vers le repos, puis la boucle s'éteint
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(rafId); running = false; }
    else wake();
  });

  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { build(); drawStatic(); wake(); }, 150);
  });

  /* Témoin pour les tests (jamais utilisé par le produit). */
  window.KineticGrid = { isRunning: function () { return running; }, nodeCount: function () { return nodes.length; } };
})();
