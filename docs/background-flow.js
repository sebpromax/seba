/* background-flow.js — Seba
 * Arrière-plan "flux organique" (lignes ondulantes façon courants
 * magnétiques) en Canvas 2D vanilla -- remplace bg-shader.js/three.js
 * sur employe-connexion.html : pas de dépendance CDN lourde, mieux
 * adapté à des appareils de terrain modestes (tablette partagée,
 * batterie/CPU limités). N'affecte AUCUNE autre page -- les pages
 * publiques (connexion.html, index.html...) gardent l'effet "Encre
 * Vivante" (SebaFX/bg-shader.js) inchangé.
 *
 * - Canvas plein écran, position fixed, z-index -1, sous la carte
 *   (opaque : les lignes ne traversent jamais le formulaire).
 * - requestAnimationFrame, jamais de setInterval -- une seule boucle,
 *   annulée proprement au déchargement de la page (pas de fuite).
 * - prefers-reduced-motion : une frame statique, aucune boucle.
 * - Onglet caché ou souris/doigt inactif depuis 4s : ralenti (2 frames
 *   sur 3 sautées) plutôt que stoppé net -- mouvement toujours perçu,
 *   coût CPU/GPU réduit.
 * - Couleur lue depuis --em (variable CSS déjà définie par la page),
 *   jamais une teinte codée en dur ici -- une seule source de vérité.
 *
 * Script classique (pas de module ES, voir CLAUDE.md). Expose rien sur
 * window -- purement auto-contenu.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('flow-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [13, 148, 136];
  }
  var accentRgb = hexToRgb(getComputedStyle(document.documentElement).getPropertyValue('--em'));

  var width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // Chaque ligne = un courant ondulant independant (deux sinusoides
  // combinees, frequences/phases aleatoires) -- pas de bruit de Perlin
  // (dependance evitee), le rendu reste "flow field" organique sans lib.
  var LINE_COUNT = 14;
  var lines = [];
  for (var i = 0; i < LINE_COUNT; i++) {
    lines.push({
      baseY: (i + 0.5) / LINE_COUNT,
      amp1: 26 + Math.random() * 30,
      amp2: 12 + Math.random() * 18,
      freq1: 0.0022 + Math.random() * 0.0015,
      freq2: 0.004 + Math.random() * 0.002,
      speed1: 0.00016 + Math.random() * 0.00008,
      speed2: 0.00024 + Math.random() * 0.00010,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.1 + Math.random() * 0.2, // borne demandee : 0.1 - 0.3
    });
  }

  var lastActivity = Date.now();
  function markActive() { lastActivity = Date.now(); }
  window.addEventListener('mousemove', markActive, { passive: true });
  window.addEventListener('touchstart', markActive, { passive: true });

  var tabHidden = document.hidden;
  document.addEventListener('visibilitychange', function () { tabHidden = document.hidden; });

  var rafId = null;
  var frameSkip = 0;

  function draw(t) {
    if (!reduceMotion) rafId = requestAnimationFrame(draw);
    if (tabHidden) return;

    var idle = Date.now() - lastActivity > 4000;
    if (idle) {
      frameSkip = (frameSkip + 1) % 3;
      if (frameSkip !== 0) return; // 2 frames sur 3 sautees quand inactif
    }

    ctx.clearRect(0, 0, width, height);
    var r = accentRgb[0], g = accentRgb[1], b = accentRgb[2];
    var step = Math.max(8, Math.floor(width / 120));

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      ctx.beginPath();
      for (var x = 0; x <= width; x += step) {
        var y = ln.baseY * height
          + Math.sin(x * ln.freq1 + t * ln.speed1 + ln.phase) * ln.amp1
          + Math.sin(x * ln.freq2 - t * ln.speed2 + ln.phase) * ln.amp2;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + ln.opacity + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (reduceMotion) {
    draw(0);
  } else {
    rafId = requestAnimationFrame(draw);
  }

  // Nettoyage explicite (pas de fuite si cette page est un jour integree
  // a une navigation SPA-like sans rechargement complet).
  window.addEventListener('pagehide', function () {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', markActive);
    window.removeEventListener('touchstart', markActive);
  });
})();
