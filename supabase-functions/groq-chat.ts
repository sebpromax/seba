// ═══════════════════════════════════════════════════════════════
// SEBA — Supabase Edge Function : relais Groq (clé secrète cachée)
//
// Rôle : le site (100% statique, GitHub Pages) ne peut jamais cacher
// une clé secrète. Cette fonction tourne côté serveur Supabase à la
// place : elle reçoit la question + le contexte business du client,
// appelle Groq avec la clé GARDÉE EN SECRET (variable d'environnement
// Deno.env, jamais visible du navigateur), et renvoie juste la réponse.
//
// Déploiement : voir MANUEL-SEBA-ADMIN.md section 1b.
// ═══════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*', // proxy texte uniquement, pas de données sensibles renvoyées
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { question, context } = await req.json();
    if (!question || typeof question !== 'string' || question.length > 500) {
      return new Response(JSON.stringify({ error: 'Question invalide' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY non configurée côté serveur' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const system = 'Tu es l\'assistant business de Seba, un logiciel de gestion pour entreprises de services. ' +
      'Réponds en français, concis (max 120 mots), concret et actionnable, au patron de l\'entreprise. ' +
      (context ? 'Données réelles actuelles de son entreprise : ' + JSON.stringify(context).slice(0, 2000) : 'Aucune donnée disponible pour le moment.');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: system }, { role: 'user', content: String(question).slice(0, 500) }],
        max_tokens: 400, temperature: 0.4,
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Groq HTTP ' + res.status }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const data = await res.json();
    const answer = (data.choices && data.choices[0] && data.choices[0].message.content) || 'Réponse vide.';
    return new Response(JSON.stringify({ answer }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
