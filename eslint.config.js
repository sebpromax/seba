// Config ESLint minimale pour une stack vanille (pas de framework, pas de
// bundler). Sert de garde-fou pour l'executeur de l'orchestrateur (voir
// tools/orchestrator.js) : un vrai controle de qualite au-dela de la seule
// syntaxe (`node --check`), sans imposer un style agressif.
export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Navigateur
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', fetch: 'readonly', console: 'readonly',
        navigator: 'readonly', location: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', setTimeout: 'readonly', setInterval: 'readonly',
        clearTimeout: 'readonly', clearInterval: 'readonly', atob: 'readonly', btoa: 'readonly',
        getComputedStyle: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly',
        Path2D: 'readonly', performance: 'readonly', matchMedia: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', URL: 'readonly', CustomEvent: 'readonly',
        // CDN / globals du projet charges hors module (D3, Sortable, Supabase, Stripe, Leaflet, html2pdf...)
        d3: 'readonly', Sortable: 'readonly', supabase: 'readonly', Stripe: 'readonly',
        L: 'readonly', html2pdf: 'readonly', Papa: 'readonly',
        // Objets applicatifs partages entre scripts (docs/*.js, pas de bundler donc globals volontaires)
        SebaDB: 'writable', SEBA_CONFIG: 'writable', sebaAuth: 'readonly', sebaTheme: 'readonly',
        SebaStorage: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-debugger': 'error',
    },
  },
];
