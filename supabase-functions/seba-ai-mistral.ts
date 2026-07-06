// ═══════════════════════════════════════════════════════════════
// SEBA — Relais Mistral : "Conscience Seba" (Bible V.1)
//
// Meme principe que groq-chat.ts : un site 100% statique ne peut
// jamais cacher une cle secrete. Cette fonction tourne cote serveur
// Supabase a la place — elle recoit le contexte du dashboard, appelle
// Mistral avec la cle GARDEE EN SECRET (variable d'environnement
// Deno.env, jamais visible du navigateur), et renvoie uniquement la
// recommandation structuree.
//
// Deploiement : voir MANUEL-SEBA-ADMIN.md section 1d.
// ═══════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT =
  "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
  "Ton ton est analytique, concis, et tourné vers l'action. Tu reçois des données JSON de performance. " +
  'Tu dois répondre uniquement en JSON structuré : ' +
  '{ "action": "titre court", "priority": "high/medium/low", "reasoning": "une phrase expliquant pourquoi" }. ' +
  'Analyse le contexte et propose des mesures de redressement ou d\'optimisation.';

function fallback(reasoning: string) {
  return { action: 'Analyse indisponible', priority: 'low', reasoning };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { context } = await req.json();
    if (!context || typeof context !== 'object') {
      return new Response(JSON.stringify({ error: 'Contexte invalide' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const mistralKey = Deno.env.get('MISTRAL_API_KEY');
    if (!mistralKey) {
      return new Response(JSON.stringify({ error: 'MISTRAL_API_KEY non configurée côté serveur' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mistralKey },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context).slice(0, 4000) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Mistral HTTP ' + res.status }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (!parsed.action || !parsed.priority) parsed = fallback('Réponse IA incomplète.');
    } catch {
      parsed = fallback('Réponse IA non structurée.');
    }

    return new Response(JSON.stringify(parsed), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
