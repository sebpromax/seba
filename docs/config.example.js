/* ═══════════════════════════════════════════════════════════════
   SEBA — Modèle de configuration (clés API)

   1. Copier ce fichier en  config.js  (même dossier docs/).
   2. Remplacer les valeurs ci-dessous par tes vraies clés.
   3. config.js est dans .gitignore : il ne sera JAMAIS commité.

   Où trouver chaque clé → voir MANUEL-SEBA-ADMIN.md à la racine.
═══════════════════════════════════════════════════════════════ */
window.SEBA_CONFIG = {
  /* ── Supabase (auth + données cloud) — supabase.com → Settings → API ── */
  supabaseUrl: 'VOTRE_SUPABASE_URL',          // ex. https://abcdefgh.supabase.co
  supabaseAnonKey: 'VOTRE_SUPABASE_ANON_KEY', // clé "anon public" (eyJ…)
  accountId: 'mon-entreprise',                // identifiant du compte (slug)

  /* ── Groq (assistant IA) — console.groq.com → API Keys ── */
  groqApiKey: 'VOTRE_GROQ_API_KEY',           // gsk_…

  /* ── Stripe (paiements) — dashboard.stripe.com → Développeurs → Clés API ── */
  stripePublicKey: 'VOTRE_STRIPE_PUBLIC_KEY', // pk_live_… ou pk_test_…
  stripePaymentLink: '',                      // lien Payment Link de l'abonnement Seba (optionnel)
};
