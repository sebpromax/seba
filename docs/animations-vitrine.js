/* animations-vitrine.js — index.html + pages séparées vitrine */
function __av_init() {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Détection de page ─────────────────────────────────────────────────── */
  var path = window.location.pathname;
  var isIndex     = !path.includes('probleme') && !path.includes('solution') &&
                    !path.includes('confiance') && !path.includes('connexion');
  var isProbleme  = path.includes('probleme');
  var isSolution  = path.includes('solution');
  var isConfiance = path.includes('confiance');
  var isConnexion = path.includes('connexion');

  /* ── Fallback GSAP absent ──────────────────────────────────────────────── */
  if (typeof gsap === 'undefined') {
    if (isIndex) {
      document.querySelectorAll('.hero-eyebrow,.hero h1,.hero-lede,.hero-ctas,.hero-visual')
        .forEach(function (el) { el.style.opacity = '1'; el.style.transform = 'none'; });
    }
    return;
  }

  /* ── Entrée hero (index uniquement, au chargement — pas au scroll) ──────── */
  if (isIndex) {
    if (!reduced) {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .fromTo('.hero-eyebrow', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.10)
        .fromTo('.hero h1',      { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.22)
        .fromTo('.hero-lede',    { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.40)
        .fromTo('.hero-ctas',    { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.54)
        .fromTo('.hero-visual',  { opacity: 0 },         { opacity: 1, duration: 0.9 },       0.48);
    } else {
      document.querySelectorAll('.hero-eyebrow,.hero h1,.hero-lede,.hero-ctas,.hero-visual')
        .forEach(function (el) { el.style.opacity = '1'; });
    }
  }

  /* ── Détection de section pour les particules — IntersectionObserver ────── */
  if (isIndex) {
    [
      { sel: '.hero',               key: 'hero' },
      { sel: '.section-problem',    key: 'problem' },
      { sel: '.section-solution',   key: 'solution' },
      { sel: '.section-confiance',  key: 'confiance' },
    ].forEach(function (s) {
      var el = document.querySelector(s.sel);
      if (!el) return;
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) transitionTo(s.key);
      }, { threshold: 0.35 }).observe(el);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     THREE.JS — Système de particules
  ══════════════════════════════════════════════════════════════════════════ */
  if (reduced) return;
  if (typeof THREE === 'undefined') return;
  var canvas = document.getElementById('particles-canvas');
  if (!canvas) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, alpha: true, antialias: false, powerPreference: 'low-power',
    });
  } catch (e) { return; }

  var W = window.innerWidth, H = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
  camera.position.z = 8;

  /* ── Géométrie : 800 particules ─────────────────────────────────────────── */
  var N     = 800;
  var SPW   = 14, SPH = 8;
  var posArr   = new Float32Array(N * 3);
  var origArr  = new Float32Array(N * 3);
  var colorArr = new Float32Array(N * 3);
  var velArr   = new Float32Array(N * 3);
  var noiseOff = new Float32Array(N);

  var cEm = new THREE.Color(0x00C896);
  var cPl = new THREE.Color(0x7C3AED);

  for (var i = 0; i < N; i++) {
    var px = (Math.random() - 0.5) * SPW;
    var py = (Math.random() - 0.5) * SPH;
    var pz = (Math.random() - 0.5) * 1.5;
    posArr[i*3]   = px; posArr[i*3+1]   = py; posArr[i*3+2]   = pz;
    origArr[i*3]  = px; origArr[i*3+1]  = py; origArr[i*3+2]  = pz;
    var c  = Math.random() < 0.6 ? cEm : cPl;
    var br = 0.30 + Math.random() * 0.70;
    colorArr[i*3] = c.r * br; colorArr[i*3+1] = c.g * br; colorArr[i*3+2] = c.b * br;
    noiseOff[i]   = Math.random() * 6.283;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colorArr, 3));

  var mat = new THREE.PointsMaterial({
    size: 0.028, vertexColors: true, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));

  /* ── Projection écran → monde Z=0 ───────────────────────────────────────── */
  function s2w(sx, sy) {
    var ndcX = (sx / W) * 2 - 1;
    var ndcY = -((sy / H) * 2 - 1);
    var v    = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    var dir  = v.sub(camera.position).normalize();
    var t    = -camera.position.z / dir.z;
    return { x: camera.position.x + dir.x * t, y: camera.position.y + dir.y * t };
  }

  /* ── Blend state — transitions 2.5s sine.inOut ──────────────────────────── */
  var blend = { hero: 0, problem: 0, solution: 0, confiance: 0, connexion: 0 };
  if (isProbleme)       blend.problem   = 1;
  else if (isSolution)  blend.solution  = 1;
  else if (isConfiance) blend.confiance = 1;
  else if (isConnexion) blend.connexion = 1;
  else                  blend.hero      = 1;

  function transitionTo(key) {
    var keys = ['hero', 'problem', 'solution', 'confiance', 'connexion'];
    var vars = { duration: 2.5, ease: 'sine.inOut', overwrite: true };
    for (var k = 0; k < keys.length; k++) {
      vars[keys[k]] = keys[k] === key ? 1 : 0;
    }
    gsap.to(blend, vars);
    if (key === 'solution') computeBentoBoxes();
  }

  /* ScrollTrigger → section detection (index.html) */
  if (isIndex && typeof ScrollTrigger !== 'undefined') {
    [
      { sel: '.hero',               key: 'hero' },
      { sel: '.section-problem',   key: 'problem' },
      { sel: '.section-solution',  key: 'solution' },
      { sel: '.section-confiance', key: 'confiance' },
    ].forEach(function (s) {
      var el = document.querySelector(s.sel);
      if (!el) return;
      ScrollTrigger.create({
        trigger: el, start: 'top 55%', end: 'bottom 45%',
        onEnter:     function () { transitionTo(s.key); },
        onEnterBack: function () { transitionTo(s.key); },
      });
    });
  }

  /* ── Bento card AABB (section solution) ─────────────────────────────────── */
  var bentoBoxes = [];

  function computeBentoBoxes() {
    bentoBoxes = [];
    var cards = document.querySelectorAll('.section-solution .bento-card');
    if (!cards.length) cards = document.querySelectorAll('.bento-card');
    cards.forEach(function (card) {
      var r  = card.getBoundingClientRect();
      var tl = s2w(r.left,  r.top);
      var br = s2w(r.right, r.bottom);
      bentoBoxes.push({ x0: tl.x, y0: br.y, x1: br.x, y1: tl.y });
    });
  }

  /* ── Confiance : halo au survol ─────────────────────────────────────────── */
  var trustHalo = { x: 9999, y: 9999, a: 0 };

  document.querySelectorAll('.trust-panel, .testimonial-card, .review-card').forEach(function (p) {
    p.addEventListener('mouseenter', function () {
      var r = p.getBoundingClientRect();
      var w = s2w(r.left + r.width / 2, r.top + r.height / 2);
      trustHalo.x = w.x; trustHalo.y = w.y;
      gsap.to(trustHalo, { a: 1, duration: 0.9, ease: 'sine.out' });
    });
    p.addEventListener('mouseleave', function () {
      gsap.to(trustHalo, { a: 0, duration: 1.8, ease: 'sine.in' });
    });
  });

  /* ── CTA gravitation ─────────────────────────────────────────────────────── */
  var ctaGrav = { wx: 9999, wy: 9999, a: 0 };
  var CTA_WORLD_R = 1.25;

  document.querySelectorAll(
    '.btn-primary, .hero-ctas a, .cta-inner a, .cta-section a, .btn-em, [class*="cta"]'
  ).forEach(function (btn) {
    btn.addEventListener('mouseenter', function () {
      var r = btn.getBoundingClientRect();
      var w = s2w(r.left + r.width / 2, r.top + r.height / 2);
      ctaGrav.wx = w.x; ctaGrav.wy = w.y;
      gsap.to(ctaGrav, { a: 1, duration: 0.7, ease: 'sine.out' });
    });
    btn.addEventListener('mouseleave', function () {
      gsap.to(ctaGrav, { a: 0, duration: 2.2, ease: 'sine.inOut' });
    });
  });

  /* ── Répulsion souris (hero index) ──────────────────────────────────────── */
  var mouseW  = { x: 9999, y: 9999 };
  var mNDC    = new THREE.Vector2();
  var ray     = new THREE.Raycaster();
  var zPlane  = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  window.addEventListener('mousemove', function (e) {
    mNDC.x = (e.clientX / W) * 2 - 1;
    mNDC.y = -((e.clientY / H) * 2 - 1);
    ray.setFromCamera(mNDC, camera);
    var pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(zPlane, pt)) { mouseW.x = pt.x; mouseW.y = pt.y; }
  }, { passive: true });

  /* ── Ligne horizon (connexion) ──────────────────────────────────────────── */
  var connexionLineY = 0;
  if (isConnexion) {
    var cardEl = document.querySelector('.page .card, .card, .cx-card');
    if (cardEl) {
      var cr = cardEl.getBoundingClientRect();
      connexionLineY = s2w(W / 2, cr.bottom + 35).y;
    }
  }

  /* ── Value noise ────────────────────────────────────────────────────────── */
  function hn(x) { var s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function sn(x) { var i = Math.floor(x), f = x - i; f = f * f * (3 - 2 * f); return hn(i) * (1 - f) + hn(i + 1) * f - 0.5; }

  /* ── Physique ───────────────────────────────────────────────────────────── */
  var RR = 2.5, FR = 0.95, RT = 0.016, MS = 0.22;
  var noiseT = 0;

  function tick() {
    var pos = geo.attributes.position.array;
    noiseT += 0.002;

    var bHero  = blend.hero;
    var bProb  = blend.problem;
    var bSol   = blend.solution;
    var bConf  = blend.confiance;
    var bConn  = blend.connexion;

    for (var j = 0; j < N; j++) {
      var a  = j * 3, b = a + 1;
      var px = pos[a], py = pos[b];
      var ox = origArr[a], oy = origArr[b];

      velArr[a] += (ox - px) * RT;
      velArr[b] += (oy - py) * RT;

      /* Problem : bruit de bord */
      if (bProb > 0.01) {
        var nx = Math.abs(ox) / (SPW * 0.5);
        var ny = Math.abs(oy) / (SPH * 0.5);
        if (nx > 0.62 || ny > 0.62) {
          var t  = noiseT * 0.35 + noiseOff[j];
          var nd = 0.0018 * bProb;
          velArr[a] += sn(t)        * nd;
          velArr[b] += sn(t + 73.1) * nd;
        }
      }

      /* Solution : magnétisme bento */
      if (bSol > 0.01 && bentoBoxes.length) {
        var bestD2 = Infinity, bdx = 0, bdy = 0;
        for (var ei = 0; ei < bentoBoxes.length; ei++) {
          var box = bentoBoxes[ei];
          var ex  = Math.max(box.x0, Math.min(px, box.x1));
          var ey  = Math.max(box.y0, Math.min(py, box.y1));
          var edx = ex - px, edy = ey - py;
          var d2  = edx * edx + edy * edy;
          if (d2 < bestD2) { bestD2 = d2; bdx = edx; bdy = edy; }
        }
        var bd = Math.sqrt(bestD2);
        if (bd < 0.75 && bd > 0.004) {
          var ef = (0.75 - bd) / 0.75 * 0.004 * bSol;
          velArr[a] += bdx * ef; velArr[b] += bdy * ef;
        }
      }

      /* Confiance : halo */
      if (bConf > 0.01 && trustHalo.a > 0.001 && trustHalo.x !== 9999) {
        var hdx = trustHalo.x - px, hdy = trustHalo.y - py;
        var hd2 = hdx * hdx + hdy * hdy, HR = 2.0;
        if (hd2 < HR * HR && hd2 > 0.001) {
          var hd = Math.sqrt(hd2);
          var hf = (HR - hd) / HR * 0.0025 * bConf * trustHalo.a;
          velArr[a] += hdx * hf; velArr[b] += hdy * hf;
        }
      }
      if (trustHalo.a > 0.001 && trustHalo.x !== 9999 && bConf < 0.1 && bHero < 0.5) {
        var hdx2 = trustHalo.x - px, hdy2 = trustHalo.y - py;
        var hd22 = hdx2 * hdx2 + hdy2 * hdy2;
        if (hd22 < 4.0 && hd22 > 0.001) {
          var hd2r = Math.sqrt(hd22);
          velArr[a] += hdx2 * (2.0 - hd2r) / 2.0 * 0.002 * trustHalo.a;
          velArr[b] += hdy2 * (2.0 - hd2r) / 2.0 * 0.002 * trustHalo.a;
        }
      }

      /* Connexion : ligne */
      if (bConn > 0.01) {
        velArr[b] += (connexionLineY - py) * 0.005 * bConn;
        velArr[a] *= 1 - 0.018 * bConn;
      }

      /* Répulsion souris (hero) */
      if (bHero > 0.01) {
        var mdx = px - mouseW.x, mdy = py - mouseW.y;
        var md2 = mdx * mdx + mdy * mdy;
        if (md2 < RR * RR && md2 > 0.001) {
          var md = Math.sqrt(md2);
          velArr[a] += (mdx / md) * ((RR - md) / RR) * 0.09 * bHero;
          velArr[b] += (mdy / md) * ((RR - md) / RR) * 0.09 * bHero;
        }
      }

      /* CTA gravitation */
      if (ctaGrav.a > 0.001 && ctaGrav.wx !== 9999) {
        var cdx = ctaGrav.wx - px, cdy = ctaGrav.wy - py;
        if (cdx * cdx + cdy * cdy < CTA_WORLD_R * CTA_WORLD_R) {
          velArr[a] += cdx * 0.005 * ctaGrav.a;
          velArr[b] += cdy * 0.005 * ctaGrav.a;
        }
      }

      velArr[a] *= FR; velArr[b] *= FR;
      var spd = Math.sqrt(velArr[a] * velArr[a] + velArr[b] * velArr[b]);
      if (spd > MS) { velArr[a] = (velArr[a] / spd) * MS; velArr[b] = (velArr[b] / spd) * MS; }
      pos[a] += velArr[a]; pos[b] += velArr[b];
    }
    geo.attributes.position.needsUpdate = true;
  }

  function loop() { tick(); renderer.render(scene, camera); requestAnimationFrame(loop); }

  /* ── Resize ─────────────────────────────────────────────────────────────── */
  var rsT;
  window.addEventListener('resize', function () {
    clearTimeout(rsT);
    rsT = setTimeout(function () {
      W = window.innerWidth; H = window.innerHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
      if (blend.solution > 0.1) computeBentoBoxes();
    }, 100);
  });
  window.addEventListener('scroll', function () {
    if (blend.solution > 0.1) computeBentoBoxes();
  }, { passive: true });

  loop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __av_init);
} else {
  try { __av_init(); } catch (e) { console.error('animations-vitrine init failed', e); }
}
