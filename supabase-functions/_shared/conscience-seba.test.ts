// ═══════════════════════════════════════════════════════════════
// Tests unitaires — conscience-seba.ts (Palier 4).
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// meme limite que pour les autres Edge Functions du projet — voir
// AUDIT-GO-LIVE-SEBA.md sur pg_net/Vault). Ecrits pour etre lances via
// `deno test supabase-functions/_shared/conscience-seba.test.ts` des
// qu'un environnement Deno est disponible (CI ou poste local).
//
// Portee reelle de ces tests : ils verifient le CONTRAT TypeScript (quel
// parametre part vers match_interventions, dans quel ordre les fonctions
// composent leurs resultats) via un client Supabase mocke — PAS la RLS ni
// la fonction SQL elle-meme, qui exigent un vrai Postgres/pgvector et
// restent verifiees par relecture (voir supabase-schema.sql section 20).
// ═══════════════════════════════════════════════════════════════

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildStructuredContext, decideDeterministe, formatAssistantTechniquePrompt, lookupHistory, withContextCache } from './conscience-seba.ts';

/** Client Supabase mocké minimal — enregistre les appels .rpc()/.from()
    pour inspection, retourne des données canned par test. */
function makeMockSupabase(opts: {
  rpcResultsByAccount?: Record<string, unknown[]>;
  cacheHit?: unknown;
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ method: 'rpc:' + name, args: [params] });
      const account = params.p_account as string;
      const rows = opts.rpcResultsByAccount?.[account] ?? [];
      return {
        abortSignal() { return this; },
        then(resolve: (v: unknown) => void) { resolve({ data: rows, error: null }); },
      };
    },
    from(table: string) {
      calls.push({ method: 'from:' + table, args: [] });
      return {
        select() { return this; },
        match(m: Record<string, unknown>) { calls.push({ method: 'match', args: [m] }); return this; },
        upsert(v: Record<string, unknown>) { calls.push({ method: 'upsert', args: [v] }); return { abortSignal: () => Promise.resolve({ error: null }) }; },
        abortSignal() { return this; },
        maybeSingle() { return Promise.resolve({ data: opts.cacheHit ?? null, error: null }); },
      };
    },
  };
  return { client: client as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient, calls };
}

// ═══ 1. lookupHistory() doit passer p_account EXACTEMENT le compte de
// l'appelant courant, jamais un autre — c'est la SEULE frontière de
// sécurité de match_interventions() sous une connexion service_role
// (voir supabase-schema.sql section 20). Ce test échouerait si un futur
// refactor oubliait de transmettre `account` ou le mélangeait avec un
// autre paramètre. ═══
Deno.test('lookupHistory() scope match_interventions au compte de l\'appelant, jamais un autre', async () => {
  // embed() appelle Mistral en reseau -- hors de portee d'un test unitaire
  // sans cle API reelle. On ne teste ici QUE le threading du parametre
  // account a travers l'appel RPC, pas le calcul d'embedding lui-meme
  // (couvert par embed-content.ts en integration, hors perimetre ici).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');

  try {
    const { client, calls } = makeMockSupabase({
      rpcResultsByAccount: {
        'compte-A': [{ id: '1', intervention_id: 'id_abc', content: 'Fuite détectée sous évier', metadata: {}, similarity: 0.9 }],
        'compte-B': [{ id: '2', intervention_id: 'id_xyz', content: 'Autre compte, ne doit jamais apparaître pour A', metadata: {}, similarity: 0.99 }],
      },
    });

    const resultsA = await lookupHistory(client, 'compte-A', 'fuite évier');
    const rpcCallA = calls.find((c) => c.method === 'rpc:match_interventions');
    assertEquals((rpcCallA?.args[0] as Record<string, unknown>).p_account, 'compte-A', 'p_account doit être exactement le compte demandé');
    assertEquals(resultsA.length, 1);
    assertEquals(resultsA[0].content, 'Fuite détectée sous évier');
    assertNotEquals(resultsA[0].content, 'Autre compte, ne doit jamais apparaître pour A', 'les résultats du compte B ne doivent jamais fuiter vers le compte A');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ═══ 2. decideDeterministe() ne doit jamais halluciner via LLM ce qui
// est calculable en pur TS ═══
Deno.test('decideDeterministe() tranche sans LLM au-delà du seuil critique', () => {
  const verdict = decideDeterministe({ facturesEnRetard: 6, devisEnAttente: 2 });
  assertEquals(verdict?.priority, 'high');
});
Deno.test('decideDeterministe() retourne null (cas intermédiaire) sous le seuil', () => {
  const verdict = decideDeterministe({ facturesEnRetard: 2, devisEnAttente: 1 });
  assertEquals(verdict, null);
});

// ═══ 3. buildStructuredContext() ne tronque jamais en plein milieu d'un
// element -- corrige le bug .slice(0, N) de ai-relay.ts ═══
Deno.test('buildStructuredContext() borne par nombre d\'éléments, jamais par caractères', () => {
  const raw = { facturesEnRetard: Array.from({ length: 15 }, (_, i) => ({ id: i })) };
  const out = buildStructuredContext(raw, 10);
  assertEquals((out.facturesEnRetard as unknown[]).length, 10);
  assertEquals(out.facturesEnRetardTotal, 15);
  assertEquals(out.facturesEnRetardTronque, true);
  // Le JSON produit doit toujours être valide, jamais coupé au milieu.
  JSON.parse(JSON.stringify(out));
});

// ═══ 4. withContextCache() ne recalcule jamais un contexte déjà vu ═══
Deno.test('withContextCache() retourne la réponse en cache sans appeler compute()', async () => {
  const { client } = makeMockSupabase({ cacheHit: { action: 'Déjà calculé', priority: 'low', reasoning: 'depuis le cache' } });
  let computeCalled = false;
  const result = await withContextCache(client, 'compte-A', 'conscience_predictive', { x: 1 }, async () => {
    computeCalled = true;
    return { action: 'Ne devrait jamais être atteint', priority: 'high' as const, reasoning: '' };
  });
  assertEquals(computeCalled, false, 'compute() ne doit pas être invoqué si le cache a déjà la réponse');
  assertEquals((result as { action: string }).action, 'Déjà calculé');
});

// ═══ 5. formatAssistantTechniquePrompt() ne fabrique jamais un extrait
// absent des résultats de recherche ═══
Deno.test('formatAssistantTechniquePrompt() signale explicitement l\'absence d\'historique', () => {
  const prompt = formatAssistantTechniquePrompt([]);
  assertEquals(prompt.includes('Aucun historique pertinent'), true);
});
