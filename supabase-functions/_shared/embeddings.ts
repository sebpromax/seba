// ═══════════════════════════════════════════════════════════════
// SEBA — Calcul d'embeddings (Palier 4).
//
// mistral-embed (1024 dimensions) : pas OpenAI (aucune clé configurée
// nulle part dans ce projet — voir la note en tête de la section 19 de
// supabase-schema.sql). MISTRAL_API_KEY est deja provisionnee pour
// ai-relay.ts/daily-digest.ts, aucun nouveau secret a gerer.
// ═══════════════════════════════════════════════════════════════

const EMBED_TIMEOUT_MS = 10000; // un peu plus large qu'un chat court (FETCH_TIMEOUT_MS=5000 ailleurs) : l'encodage d'un texte plus long peut prendre davantage de temps cote fournisseur
const EMBED_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 8000; // borne d'ENTREE, distincte du bug de troncature de sortie corrige dans ai-relay.ts (buildStructuredContext)

export async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get('MISTRAL_API_KEY');
  if (!key) throw new Error('MISTRAL_API_KEY absente');

  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: 'mistral-embed', input: [text.slice(0, MAX_INPUT_CHARS)] }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('Mistral embeddings HTTP ' + res.status);

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBED_DIMENSIONS) {
    throw new Error('Réponse embeddings malformée ou dimension inattendue (attendu ' + EMBED_DIMENSIONS + ')');
  }
  return vector;
}
