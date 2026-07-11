/* ═══════════════════════════════════════════════════════════════
   SEBA FX — moteur de fonds WebGL à presets (« Encre Vivante »).

   Un seul moteur, un preset par page via l'attribut data-fx du canvas
   (repli sur l'id : #bg-shader → cockpit, #gl-canvas → landing) :

   - cockpit : le shader HISTORIQUE du dashboard (PR #50), inchangé au
     pixel près — thème Tactical Dark scopé, on n'y touche pas.
   - landing : fluide d'encre sombre (fbm domain-warpé), réfractions
     --fx-glint sur les crêtes, influence légère du pointeur.
   - tunnel  : le fluide raconte l'inscription en 3 actes (calme →
     anneaux ordonnés → vortex de propulsion), piloté par SebaFX.setAct().
   - calm    : fluide quasi gelé + battement toutes les ~2 s (connexion).
   - aurora  : fluide + ondes concentriques lentes (confiance).

   API publique (no-op silencieux si le moteur est désactivé) :
     SebaFX.pulse()      — flash radial --em : récompense d'une action.
     SebaFX.wave()       — onde unique traversante (login réussi).
     SebaFX.setAct(1|2|3)— acte du tunnel.
     SebaFX.fadeOut(ms)  — fondu de sortie avant navigation.

   Couleurs : AUCUNE valeur en dur, tokens :root de la page hôte avec
   chaîne de repli (--fx-* dédiés, puis tokens historiques). Le vert vif
   --em n'apparaît QUE sur pulse/wave : le fond murmure, l'action crie.

   Guards (tous presets) : prefers-reduced-motion, navigator.webdriver
   (baselines QA déterministes), onglet caché = zéro GPU, DPR ≤ 1.5,
   dégradation silencieuse sans CDN/WebGL. Vanilla JS, zéro npm.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var canvas = document.getElementById('bg-shader') || document.getElementById('gl-canvas');
  var noop = function () {};
  window.SebaFX = { pulse: noop, wave: noop, setAct: noop, fadeOut: noop, enabled: false };
  if (!canvas || !window.THREE) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (navigator.webdriver) return;

  var preset = canvas.getAttribute('data-fx') || (canvas.id === 'bg-shader' ? 'cockpit' : 'landing');

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
  } catch (e) { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  var styles = getComputedStyle(document.documentElement);
  function token(names, fallback) {
    for (var i = 0; i < names.length; i++) {
      var v = styles.getPropertyValue(names[i]).trim();
      if (v) return v;
    }
    return fallback;
  }

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10);
  camera.position.z = 1.8;

  var attrIntensity = parseFloat(canvas.getAttribute('data-intensity'));
  var uniforms, material, geometry;

  if (preset === 'cockpit') {
    /* ── Shader historique du Cockpit — VERBATIM PR #50, ne pas modifier ── */
    uniforms = {
      time:      { value: 0 },
      intensity: { value: isNaN(attrIntensity) ? 0.3 : attrIntensity },
      color1:    { value: new THREE.Color(token(['--bg', '--ink'], '#09090B')) },
      color2:    { value: new THREE.Color(token(['--emerald', '--em'], '#10B981')) },
    };
    material = new THREE.ShaderMaterial({
      uniforms: uniforms, transparent: true, depthWrite: false,
      vertexShader: [
        'uniform float time;', 'uniform float intensity;',
        'varying vec2 vUv;', 'varying vec3 vPosition;',
        'void main() {',
        '  vUv = uv; vPosition = position; vec3 pos = position;',
        '  pos.y += sin(pos.x * 10.0 + time) * 0.1 * intensity;',
        '  pos.x += cos(pos.y * 8.0 + time * 1.5) * 0.05 * intensity;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float time;', 'uniform float intensity;',
        'uniform vec3 color1;', 'uniform vec3 color2;', 'varying vec2 vUv;',
        'void main() {',
        '  vec2 uv = vUv;',
        '  float noise = sin(uv.x * 20.0 + time) * cos(uv.y * 15.0 + time * 0.8);',
        '  noise += sin(uv.x * 35.0 - time * 2.0) * cos(uv.y * 25.0 + time * 1.2) * 0.5;',
        '  vec3 color = mix(color1, color2, noise * 0.5 + 0.5);',
        '  color = mix(color, vec3(1.0), pow(abs(noise), 2.0) * intensity);',
        '  float glow = 1.0 - length(uv - 0.5) * 2.0; glow = pow(glow, 2.0);',
        '  gl_FragColor = vec4(color * glow, glow * 0.2);',
        '}',
      ].join('\n'),
    });
    geometry = new THREE.PlaneGeometry(5, 5, 32, 32);
  } else {
    /* ── Fluide « Encre Vivante » — landing / tunnel / calm / aurora ── */
    var PRESET_INTENSITY = { landing: 0.5, tunnel: 0.25, calm: 0.18, aurora: 0.45 };
    uniforms = {
      time:      { value: 0 },
      intensity: { value: isNaN(attrIntensity) ? (PRESET_INTENSITY[preset] || 0.4) : attrIntensity },
      cDeep:     { value: new THREE.Color(token(['--fx-deep'], '#050507')) },
      cDeep2:    { value: new THREE.Color(token(['--fx-deep2', '--ink-r'], '#0b0f19')) },
      cGlint:    { value: new THREE.Color(token(['--fx-glint'], '#00C896')) },
      cMist:     { value: new THREE.Color(token(['--fx-mist', '--t2'], '#94A3B8')) },
      cSignal:   { value: new THREE.Color(token(['--em', '--emerald'], '#00ff88')) },
      uAct:      { value: 1.0 },   // tunnel : 1 calme, 2 anneaux, 3 vortex
      uPulse:    { value: 0.0 },   // flash radial --em (décroît seul)
      uWave:     { value: 0.0 },   // onde unique 0→1 (login)
      uHeartbeat:{ value: preset === 'calm' ? 1.0 : 0.0 },
      uAurora:   { value: preset === 'aurora' ? 1.0 : 0.0 },
      uFade:     { value: 1.0 },
      uPointer:  { value: new THREE.Vector2(0, 0) },
    };
    material = new THREE.ShaderMaterial({
      uniforms: uniforms, transparent: true, depthWrite: false,
      vertexShader: [
        'varying vec2 vUv;',
        'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform float time; uniform float intensity;',
        'uniform vec3 cDeep; uniform vec3 cDeep2; uniform vec3 cGlint; uniform vec3 cMist; uniform vec3 cSignal;',
        'uniform float uAct; uniform float uPulse; uniform float uWave; uniform float uHeartbeat; uniform float uAurora; uniform float uFade;',
        'uniform vec2 uPointer;',
        'varying vec2 vUv;',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
        'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
        'float fbm(vec2 p){ float v = 0.0; float a = 0.5;',
        '  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(11.3, 7.7); a *= 0.5; } return v; }',
        'void main() {',
        '  vec2 uv = vUv;',
        '  vec2 c = uv - 0.5;',
        '  float r = length(c);',
        // Acte 3 : rotation en vortex, plus forte loin du centre
        '  float vortex = clamp(uAct - 2.0, 0.0, 1.0);',
        '  float ang = vortex * time * 0.55 * smoothstep(0.05, 0.6, r);',
        '  float ca = cos(ang); float sa = sin(ang);',
        '  c = mat2(ca, -sa, sa, ca) * c;',
        '  uv = c + 0.5;',
        // Encre : fbm domain-warpé, très lent, biaisé par le pointeur
        '  vec2 q = vec2(fbm(uv * 1.6 + time * 0.020), fbm(uv * 1.6 - time * 0.016));',
        '  float f = fbm(uv * 2.2 + q * 1.15 + uPointer * 0.10 + time * 0.012);',
        // Acte 2 : le chaos s\'ordonne en anneaux radiaux
        '  float rings = 0.5 + 0.5 * sin(r * 22.0 - time * 0.6);',
        '  float order = clamp(uAct - 1.0, 0.0, 1.0) * (1.0 - vortex);',
        '  float field = mix(f, rings, order * 0.6);',
        // Aurora : ondes concentriques continues très lentes
        '  field += uAurora * 0.18 * sin(r * 14.0 - time * 0.35);',
        // Couleur de base : abysse
        '  vec3 col = mix(cDeep, cDeep2, clamp(uv.y + 0.2 * f, 0.0, 1.0));',
        // Réfraction --fx-glint sur les crêtes + brume froide
        '  float crest = smoothstep(0.58, 0.78, field);',
        '  col += cGlint * crest * (0.055 + 0.025 * sin(time * 0.3));',
        '  col += cMist * 0.030 * fbm(uv * 3.1 - time * 0.008);',
        // Battement (calm) : ~2 s, centré
        '  float hb = uHeartbeat * pow(max(0.0, sin(time * 3.1)), 8.0);',
        '  col += cGlint * hb * 0.05 * (1.0 - r * 1.6);',
        // Pulse : la récompense --em (décroît côté JS)
        '  col += cSignal * uPulse * pow(max(0.0, 1.0 - r * 2.0), 2.0) * 0.35;',
        // Wave : onde unique traversante (login)
        '  float ringW = smoothstep(0.035, 0.0, abs(r - uWave * 0.85)) * (1.0 - uWave);',
        '  col += cSignal * ringW * 0.28;',
        // Vortex : accélération lumineuse au centre pendant la propulsion
        '  col += cGlint * vortex * pow(max(0.0, 1.0 - r * 1.4), 3.0) * (0.10 + 0.06 * sin(time * 4.0));',
        // Alpha : voile global + glow central, sous contrôle du fade
        '  float glow = pow(max(0.0, 1.0 - r * 1.55), 1.4);',
        '  float alpha = (0.35 + 0.65 * glow) * intensity * uFade;',
        '  gl_FragColor = vec4(col, alpha);',
        '}',
      ].join('\n'),
    });
    geometry = new THREE.PlaneGeometry(5, 5, 2, 2); // passthrough : pas de déplacement de vertex
  }

  scene.add(new THREE.Mesh(geometry, material));

  var clock = new THREE.Clock();
  var rafId = 0;
  var running = false;

  /* Cibles animées côté JS (lerp doux à chaque frame) */
  var target = { act: 1, intensity: uniforms.intensity.value, fade: 1 };
  var waveT = -1; // -1 = inactive, sinon progression 0→1

  function frame() {
    var dt = Math.min(clock.getDelta(), 0.1);
    uniforms.time.value = clock.getElapsedTime();
    if (uniforms.uAct) {
      uniforms.uAct.value += (target.act - uniforms.uAct.value) * Math.min(1, dt * 2.2);
      uniforms.intensity.value += (target.intensity - uniforms.intensity.value) * Math.min(1, dt * 2.2);
      uniforms.uFade.value += (target.fade - uniforms.uFade.value) * Math.min(1, dt * 6.0);
      if (uniforms.uPulse.value > 0.001) uniforms.uPulse.value *= Math.pow(0.15, dt); else uniforms.uPulse.value = 0;
      if (waveT >= 0) {
        waveT += dt * 0.9;
        if (waveT >= 1) { waveT = -1; uniforms.uWave.value = 0; }
        else uniforms.uWave.value = waveT;
      }
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }
  function start() { if (!running) { running = true; rafId = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(rafId); }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, 150);
  });

  /* Influence du pointeur : landing uniquement, amortie */
  if (preset === 'landing' && uniforms.uPointer) {
    window.addEventListener('pointermove', function (e) {
      uniforms.uPointer.value.x += ((e.clientX / window.innerWidth - 0.5) - uniforms.uPointer.value.x) * 0.06;
      uniforms.uPointer.value.y += ((0.5 - e.clientY / window.innerHeight) - uniforms.uPointer.value.y) * 0.06;
    }, { passive: true });
  }

  /* API publique — no-op sur le preset cockpit (pas d'uniforms fluide) */
  var TUNNEL_INTENSITY = { 1: 0.25, 2: 0.4, 3: 0.9 };
  window.SebaFX = {
    enabled: true,
    preset: preset,
    pulse: function () { if (uniforms.uPulse) uniforms.uPulse.value = 1.0; },
    wave: function () { if (uniforms.uWave) waveT = 0; },
    setAct: function (n) {
      if (!uniforms.uAct) return;
      target.act = Math.max(1, Math.min(3, n));
      target.intensity = TUNNEL_INTENSITY[target.act] || target.intensity;
    },
    fadeOut: function () { target.fade = 0; },
  };

  start();
})();
