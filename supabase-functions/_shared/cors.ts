// ═══════════════════════════════════════════════════════════════
// SEBA — CORS partagé pour toutes les Edge Functions appelées depuis le
// navigateur.
//
// Source unique des origines autorisées : avant ce fichier, chaque
// fonction dupliquait son propre ALLOWED_ORIGINS/corsHeaders(), avec un
// repli silencieux vers https://sebpromax.github.io pour toute origine
// absente de la liste. C'est exactement ce qui a cassé les invitations
// Client/Salarié (client-provision.ts/employe-provision.ts, écrites le
// 2026-07-19, avant l'ajout du domaine personnalisé) : le navigateur
// reçoit un header Access-Control-Allow-Origin qui ne correspond jamais
// à son origine réelle et rejette la requête au préflight, avant même
// qu'elle ne parte (voir PR #139). Centraliser ici évite que le même
// bug ne réapparaisse fonction par fonction.
//
// Règle : une origine absente de la liste est REFUSÉE (403), jamais
// silencieusement remplacée par une autre. Aucune exception.
//
// Déploiement manuel (Dashboard) : ce fichier doit être ajouté comme
// fichier supplémentaire de CHAQUE fonction qui l'importe (chemin
// relatif './_shared/cors.ts', identique à la convention déjà en place
// pour _shared/llm-providers.ts / _shared/conscience-seba.ts /
// _shared/embeddings.ts, déjà déployées ainsi pour ai-relay.ts et
// vision-qa.ts). Voir MANUEL-SEBA-ADMIN.md.
// ═══════════════════════════════════════════════════════════════

export const ALLOWED_ORIGINS = new Set([
  'https://sebastienvalentin.com',
  'https://www.sebastienvalentin.com',
  'https://sebpromax.github.io',
  'http://localhost:8791',
]);

/* Retourne les headers CORS pour une origine autorisée, ou `null` si
   l'origine est absente/inconnue -- l'appelant doit alors répondre 403
   et ne jamais exécuter la logique métier. */
export function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/* Réponse 403 standard pour une origine refusée -- jamais de détail sur
   l'origine reçue (évite de confirmer à un scan automatisé quelles
   origines sont testées). */
export function forbiddenOriginResponse(): Response {
  return new Response(JSON.stringify({ error: 'Origine non autorisée.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
