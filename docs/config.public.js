/* ═══════════════════════════════════════════════════════════════
   SEBA — Configuration PUBLIQUE (committée, déployée).

   Uniquement des valeurs conçues pour être exposées côté navigateur :
   - URL du projet Supabase + clé "publishable" : publiques par design,
     les données sont protégées par le Row Level Security côté serveur
     (voir supabase-schema.sql — chaque utilisateur ne voit que SES lignes).

   ⚠️ JAMAIS de clé secrète ici (Groq gsk_…, Stripe sk_…) :
   celles-ci vont dans config.js (gitignoré, local uniquement).
═══════════════════════════════════════════════════════════════ */
window.SEBA_CONFIG_PUBLIC = {
  supabaseUrl: 'https://ptmudezhxnhhyctowlqp.supabase.co',
  supabaseAnonKey: 'sb_publishable_u8RsEy8djwN8_66hSHck7A_wwNgOZWx',
  accountId: 'seba',
};
