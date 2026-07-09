// ═══════════════════════════════════════════════════════════════
// SEBA — Service de retrieval sémantique (Palier 4).
//
// Interroge memoire_embeddings via la fonction SQL match_interventions
// (supabase-schema.sql section 20). Extrait de conscience-seba.ts (qui
// contenait cette même fonction depuis l'initialisation du Palier 4) pour
// isoler la responsabilité "retrieval" de l'orchestration de l'agent —
// conscience-seba.ts importe désormais cette version unique, aucune
// deuxième implémentation concurrente.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embed } from './embeddings.ts';

const FETCH_TIMEOUT_MS = 5000;

export interface MemoireMatch {
  id: string;
  intervention_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface LookupHistoryOptions {
  threshold?: number;
  limit?: number;
}

/**
 * Recherche sémantique scopée par compte. `accountId` DOIT être résolu
 * par l'appelant à partir du JWT de la session (jamais un champ envoyé
 * tel quel par un client final) : match_interventions() n'a pas d'autre
 * frontière de sécurité sous une connexion service_role (voir
 * supabase-schema.sql section 20 — la fonction ne fait aucune hypothèse
 * sur qui l'appelle, seul p_account tranche quelles lignes reviennent).
 *
 * `supa` reste un paramètre explicite (pas un client construit en
 * interne) : c'est ce qui permet de mocker entièrement l'appel RPC dans
 * memoire-lookup.test.ts, même pattern que storeEmbedding()/
 * withContextCache() ailleurs dans ce module.
 */
export async function lookupHistory(
  supa: SupabaseClient,
  query: string,
  accountId: string,
  options?: LookupHistoryOptions,
): Promise<MemoireMatch[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (e) {
    console.error('[memoire-lookup] embedding de la requête a échoué', String((e as Error)?.message || e));
    return []; // jamais bloquant : pas d'historique trouvé, pas une erreur qui casse l'appelant
  }

  const threshold = options?.threshold ?? 0.75;
  const limit = options?.limit ?? 5;

  const { data, error } = await supa
    .rpc('match_interventions', {
      // Noms figés par la signature SQL deployee (supabase-schema.sql
      // section 20) -- p_account est le SEUL parametre qui fait office de
      // frontiere multi-tenant ici, jamais deductible depuis le vecteur
      // ou le seuil.
      p_account: accountId,
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    })
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  // Log de trace pour le hit rate (metrique n°3 de AUDIT-GO-LIVE-SEBA.md,
  // meme esprit applique ici a la recherche vectorielle) -- account_id
  // seul, jamais la question posee ni le contenu des extraits retournes
  // (donnees metier potentiellement sensibles, voir la note "aucune
  // policy select" de memoire_embeddings dans supabase-schema.sql).
  if (error) {
    console.error('[memoire-lookup] match_interventions a échoué', error.message);
    return [];
  }
  const results = (data as MemoireMatch[]) ?? [];
  console.debug('[memoire-lookup] recherche vectorielle', { account: accountId, hits: results.length, threshold, limit });
  return results;
}
