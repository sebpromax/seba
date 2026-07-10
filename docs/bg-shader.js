/* ═══════════════════════════════════════════════════════════════
   BG-SHADER — fond ambiant WebGL du Cockpit (dashboard.html UNIQUEMENT,
   thème Tactical Dark).

   Vanilla JS + Three.js r128 chargé via CDN (global window.THREE) juste
   avant ce fichier — zéro npm, zéro bundler (Constitution SEBA).

   Couleurs : AUCUNE valeur en dur ici. Les deux teintes sont lues dans
   les tokens :root à l'exécution (--bg, --emerald), donc l'accent
   personnalisé (user_theme_color, appliqué par le script inline en tête
   de <body> avant ce fichier) est automatiquement respecté.

   Dégradation silencieuse — le fond reste simplement var(--bg) si :
   - le CDN Three.js n'a pas chargé (offline, QA en file://) ;
   - WebGL est indisponible ;
   - l'utilisateur demande prefers-reduced-motion (effet décoratif pur) ;
   - la page est pilotée par un webdriver (Puppeteer) : les baselines de
     qa-visual-regression.js doivent rester déterministes, un fond animé
     rendrait chaque capture différente de la précédente.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var canvas = document.getElementById('bg-shader');
  if (!canvas || !window.THREE) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (navigator.webdriver) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
  } catch (e) { return; }

  // DPR plafonné : fond décoratif, pas question de payer du rétina x3 —
  // la vitesse est le produit (Constitution, obsession n°2).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  var styles = getComputedStyle(document.documentElement);
  function token(name, fallback) {
    var v = styles.getPropertyValue(name).trim();
    return v || fallback;
  }

  var uniforms = {
    time:      { value: 0 },
    // Volontairement bas : le fond ne doit jamais gêner la lecture des
    // métriques et des logs système du cockpit.
    intensity: { value: 0.3 },
    color1:    { value: new THREE.Color(token('--bg', '#09090B')) },
    color2:    { value: new THREE.Color(token('--emerald', '#10B981')) },
  };

  var material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: [
      'uniform float time;',
      'uniform float intensity;',
      'varying vec2 vUv;',
      'varying vec3 vPosition;',
      'void main() {',
      '  vUv = uv; vPosition = position; vec3 pos = position;',
      '  pos.y += sin(pos.x * 10.0 + time) * 0.1 * intensity;',
      '  pos.x += cos(pos.y * 8.0 + time * 1.5) * 0.05 * intensity;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float time;',
      'uniform float intensity;',
      'uniform vec3 color1;',
      'uniform vec3 color2;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 uv = vUv;',
      '  float noise = sin(uv.x * 20.0 + time) * cos(uv.y * 15.0 + time * 0.8);',
      '  noise += sin(uv.x * 35.0 - time * 2.0) * cos(uv.y * 25.0 + time * 1.2) * 0.5;',
      '  vec3 color = mix(color1, color2, noise * 0.5 + 0.5);',
      '  color = mix(color, vec3(1.0), pow(abs(noise), 2.0) * intensity);',
      '  float glow = 1.0 - length(uv - 0.5) * 2.0; glow = pow(glow, 2.0);',
      '  gl_FragColor = vec4(color * glow, glow * 0.2);', // opacité 0.2 : fond subtil
      '}',
    ].join('\n'),
  });

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10);
  camera.position.z = 1.8;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(5, 5, 32, 32), material));

  var clock = new THREE.Clock();
  var rafId = 0;
  var running = false;

  function frame() {
    uniforms.time.value = clock.getElapsedTime();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Onglet caché = zéro GPU. clock.getElapsedTime() continue de courir
  // pendant la pause, donc pas de "saut" visuel au retour.
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

  start();
})();
