/* ═══════════════════════════════════════════════════════════════
   SEBA — Configuration PUBLIQUE (committée, déployée).

   Uniquement des valeurs conçues pour être exposées côté navigateur :
   - URL du projet Supabase + clé "publishable" : publiques par design,
     les données sont protégées par le Row Level Security côté serveur
     (voir supabase-schema.sql — chaque utilisateur ne voit que SES lignes).

   ⚠️ JAMAIS de clé secrète ici (Groq gsk_…, Stripe sk_…) :
   celles-ci vont dans config.js (gitignoré, local uniquement).

   accountId : repli UNIQUEMENT pour le mode démo/hors-session (aucun
   utilisateur réel connecté). Dès qu'une session Supabase existe, l'app
   utilise l'auth.uid() réel de l'utilisateur comme identifiant de compte
   (docs/seba-data.js → SupabaseAdapter._accountId()) — cette valeur ne
   sert jamais à un vrai compte inscrit.

   onesignalAppId : identifiant d'app OneSignal (public par design, comme
   une clé publishable) — voir MANUEL-SEBA-ADMIN.md §1f. Vide = la
   fonctionnalité de notifications push reste invisible, aucune erreur.
═══════════════════════════════════════════════════════════════ */
window.SEBA_CONFIG_PUBLIC = {
  supabaseUrl: 'https://ptmudezhxnhhyctowlqp.supabase.co',
  supabaseAnonKey: 'sb_publishable_u8RsEy8djwN8_66hSHck7A_wwNgOZWx',
  accountId: 'demo',
  onesignalAppId: '',
};
