// ═══════════════════════════════════════════════════════════════
// SEBA — Calcul + stockage d'embeddings (Palier 4).
//
// mistral-embed (1024 dimensions) : pas OpenAI (aucune clé configurée
// nulle part dans ce projet — voir la note en tête de la section 19 de
// supabase-schema.sql). MISTRAL_API_KEY est deja provisionnee pour
// ai-relay.ts/daily-digest.ts, aucun nouveau secret a gerer.
//
// storeEmbedding() est appelee EN PROCESS (import direct), pas via HTTP :
// embed-content.ts (endpoint deploye, appelable par un client) et
// vision-qa.ts (appel interne, meme isolat au deploiement -- voir son
// commentaire d'integration) importent tous les deux cette meme fonction,
// pas de duplication, pas d'aller-retour HTTP inutile entre deux
// fonctions du meme projet.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

/**
 * Lance `task` sans attendre sa fin (EdgeRuntime.waitUntil -- API du
 * runtime Supabase Edge Functions, pas une fonctionnalite Deno standard,
 * d'ou la verification defensive avant usage) : l'appelant peut repondre
 * au client immediatement, task() continue en arriere-plan apres l'envoi
 * de la reponse. Hors de ce runtime (tests locaux), repli sur un simple
 * `await` -- jamais une promesse non geree qui masquerait une erreur.
 */
export function runDecoupled(task: Promise<unknown>): void | Promise<unknown> {
  // deno-lint-ignore no-explicit-any -- EdgeRuntime n'a pas de definition
  // de type disponible a l'import, c'est un global injecte par le runtime.
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') {
    rt.waitUntil(task);
    return;
  }
  return task;
}

/**
 * Calcule l'embedding de `content` et l'enregistre dans memoire_embeddings.
 * Best-effort : ne lève JAMAIS -- un échec (API Mistral HS, timeout,
 * insertion refusée) est retourné sous forme de résultat discriminé,
 * jamais une exception qui remonterait chez l'appelant. C'est l'appelant
 * (embed-content.ts en HTTP, vision-qa.ts en interne) qui décide comment
 * journaliser, jamais cette fonction qui ne doit jamais faire échouer un
 * flux principal pour un embedding raté.
 *
 * `account` DOIT être résolu par l'appelant à partir du JWT de la session
 * -- jamais un champ accepté tel quel depuis un corps de requête client
 * (même raisonnement que match_interventions/p_account, voir
 * supabase-schema.sql section 20).
 */
export async function storeEmbedding(
  supa: SupabaseClient,
  account: string,
  interventionId: string | null,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const vector = await embed(content);
    const { error } = await supa.from('memoire_embeddings').insert({
      account,
      intervention_id: interventionId,
      content,
      embedding: vector,
      metadata,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}
