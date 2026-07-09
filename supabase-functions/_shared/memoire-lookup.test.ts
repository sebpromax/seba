// ═══════════════════════════════════════════════════════════════
// Tests unitaires — memoire-lookup.ts (Palier 4).
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// meme limite que pour toutes les Edge Functions du projet — voir
// AUDIT-GO-LIVE-SEBA.md sur pg_net/Vault). Prets a lancer via
// `deno test supabase-functions/_shared/memoire-lookup.test.ts`.
//
// Portee reelle : verifie le CONTRAT TypeScript (quel parametre part vers
// match_interventions) via un client Supabase mocke — PAS la RLS ni la
// fonction SQL elle-meme (Postgres/pgvector reel requis, verifiees par
// relecture, voir supabase-schema.sql section 20).
// ═══════════════════════════════════════════════════════════════

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { lookupHistory } from './memoire-lookup.ts';

function makeMockSupabase(rpcResultsByAccount: Record<string, unknown[]>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ method: 'rpc:' + name, args: [params] });
      const account = params.p_account as string;
      const rows = rpcResultsByAccount[account] ?? [];
      return {
        abortSignal() { return this; },
        then(resolve: (v: unknown) => void) { resolve({ data: rows, error: null }); },
      };
    },
  };
  return { client: client as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient, calls };
}

function withFakeEmbedding(fn: () => Promise<void>) {
  return async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
    Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');
    try {
      await fn();
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
}

// ═══ lookupHistory() doit passer p_account EXACTEMENT le compte demandé,
// jamais un autre — c'est la SEULE frontière de sécurité de
// match_interventions() sous une connexion service_role (voir
// supabase-schema.sql section 20). Ce test échouerait si un futur
// refactor mélangeait account_id avec un autre paramètre. ═══
Deno.test('lookupHistory() scope match_interventions au compte demandé, jamais un autre', withFakeEmbedding(async () => {
  const { client, calls } = makeMockSupabase({
    'compte-A': [{ id: '1', intervention_id: 'id_abc', content: 'Fuite détectée sous évier', metadata: {}, similarity: 0.9 }],
    'compte-B': [{ id: '2', intervention_id: 'id_xyz', content: 'Autre compte, ne doit jamais apparaître pour A', metadata: {}, similarity: 0.99 }],
  });

  const resultsA = await lookupHistory(client, 'fuite évier', 'compte-A');
  const rpcCallA = calls.find((c) => c.method === 'rpc:match_interventions');
  assertEquals((rpcCallA?.args[0] as Record<string, unknown>).p_account, 'compte-A', 'p_account doit être exactement le compte demandé');
  assertEquals(resultsA.length, 1);
  assertEquals(resultsA[0].content, 'Fuite détectée sous évier');
  assertNotEquals(resultsA[0].content, 'Autre compte, ne doit jamais apparaître pour A', 'les résultats du compte B ne doivent jamais fuiter vers le compte A');
}));

// ═══ Les options threshold/limit doivent atteindre match_threshold/
// match_count SQL sans altération (noms différents de part et d'autre,
// point précis où une faute de frappe silencieuse casserait le filtrage). ═══
Deno.test('lookupHistory() transmet threshold/limit à match_threshold/match_count', withFakeEmbedding(async () => {
  const { client, calls } = makeMockSupabase({ 'compte-A': [] });
  await lookupHistory(client, 'question', 'compte-A', { threshold: 0.9, limit: 2 });
  const rpcCall = calls.find((c) => c.method === 'rpc:match_interventions');
  const params = rpcCall?.args[0] as Record<string, unknown>;
  assertEquals(params.match_threshold, 0.9);
  assertEquals(params.match_count, 2);
}));

// ═══ Valeurs par défaut si options absentes ═══
Deno.test('lookupHistory() applique threshold=0.75/limit=5 par défaut', withFakeEmbedding(async () => {
  const { client, calls } = makeMockSupabase({ 'compte-A': [] });
  await lookupHistory(client, 'question', 'compte-A');
  const rpcCall = calls.find((c) => c.method === 'rpc:match_interventions');
  const params = rpcCall?.args[0] as Record<string, unknown>;
  assertEquals(params.match_threshold, 0.75);
  assertEquals(params.match_count, 5);
}));

// ═══ Aucun résultat ne doit jamais faire planter l'appelant (retour []) ═══
Deno.test('lookupHistory() retourne un tableau vide (pas une exception) si match_interventions échoue', async () => {
  const client = {
    rpc() {
      return { abortSignal() { return this; }, then(resolve: (v: unknown) => void) { resolve({ data: null, error: { message: 'boom' } }); } };
    },
  } as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');
  try {
    const results = await lookupHistory(client, 'question', 'compte-A');
    assertEquals(results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
