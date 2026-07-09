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

import { assertEquals, assertMatch } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  buildStructuredContext,
  decideDeterministe,
  formatAssistantTechniquePrompt,
  formatFinancialContext,
  prepareAssistantTechniqueContext,
  questionConcerneFinance,
  SEBA_SAFETY_RAILS,
  withContextCache,
} from './conscience-seba.ts';

// lookupHistory() elle-meme est testee dans memoire-lookup.test.ts, et
// calculateProfitability()/getFinancialSummary() dans
// finance-analytics.test.ts (les fichiers qui les definissent) -- ce
// fichier ne teste que l'orchestration qui les consomme
// (prepareAssistantTechniqueContext) et les garde-fous de sécurité.

/** Client Supabase mocké minimal — enregistre les appels .rpc()/.from()
    pour inspection, retourne des données canned par test. Supporte les 3
    RPC/tables consultées par prepareAssistantTechniqueContext :
    match_interventions, get_marge_reelle, vue_marge_interventions. */
function makeMockSupabase(opts: {
  rpcResultsByAccount?: Record<string, unknown[]>;
  margeResultByAccount?: Record<string, { revenu: number; cout_materiaux: number; marge: number } | null>;
  summaryRowsByAccount?: Record<string, Array<{ intervention_id: string; revenu: number; cout_materiaux: number; marge: number }>>;
  cacheHit?: unknown;
  throwOnRpc?: string; // nom de RPC a faire echouer, pour tester l'interception d'erreur
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ method: 'rpc:' + name, args: [params] });
      if (opts.throwOnRpc === name) {
        return { abortSignal() { return this; }, then(_r: unknown, reject: (e: unknown) => void) { reject(new Error('panne simulée : ' + name)); } };
      }
      const account = params.p_account as string;
      if (name === 'match_interventions') {
        const rows = opts.rpcResultsByAccount?.[account] ?? [];
        return { abortSignal() { return this; }, then(resolve: (v: unknown) => void) { resolve({ data: rows, error: null }); } };
      }
      if (name === 'get_marge_reelle') {
        const row = opts.margeResultByAccount?.[account] ?? null;
        return { abortSignal() { return this; }, maybeSingle() { return Promise.resolve({ data: row, error: null }); } };
      }
      return { abortSignal() { return this; }, then(resolve: (v: unknown) => void) { resolve({ data: [], error: null }); } };
    },
    from(table: string) {
      calls.push({ method: 'from:' + table, args: [] });
      let filterAccount: string | undefined;
      return {
        select() { return this; },
        eq(col: string, val: string) { if (col === 'account') filterAccount = val; return this; },
        match(m: Record<string, unknown>) { calls.push({ method: 'match', args: [m] }); return this; },
        upsert(v: Record<string, unknown>) { calls.push({ method: 'upsert', args: [v] }); return { abortSignal: () => Promise.resolve({ error: null }) }; },
        abortSignal() {
          if (table === 'vue_marge_interventions') {
            return Promise.resolve({ data: opts.summaryRowsByAccount?.[filterAccount ?? ''] ?? [], error: null });
          }
          return this;
        },
        maybeSingle() { return Promise.resolve({ data: opts.cacheHit ?? null, error: null }); },
      };
    },
  };
  return { client: client as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient, calls };
}

// ═══ 1. prepareAssistantTechniqueContext() doit composer lookupHistory()
// + formatAssistantTechniquePrompt() dans le bon ordre, et propager le
// compte demandé jusqu'à l'appel RPC sous-jacent — c'est le chemin RAG
// réel de l'agent assistant_technique (product-agents.config.json). ═══
Deno.test('prepareAssistantTechniqueContext() scope la recherche au compte demandé et injecte les extraits dans le prompt', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');

  try {
    const { client, calls } = makeMockSupabase({
      rpcResultsByAccount: {
        'compte-A': [{ id: '1', intervention_id: 'id_abc', content: 'Fuite détectée sous évier', metadata: {}, similarity: 0.9 }],
      },
    });

    const { systemPrompt, matches } = await prepareAssistantTechniqueContext(client, 'compte-A', 'que s\'est-il passé chez le client X ?');

    const rpcCall = calls.find((c) => c.method === 'rpc:match_interventions');
    assertEquals((rpcCall?.args[0] as Record<string, unknown>).p_account, 'compte-A', 'p_account doit être exactement le compte demandé');
    assertEquals(matches.length, 1);
    assertEquals(systemPrompt.includes('Fuite détectée sous évier'), true, 'le prompt système doit incorporer l\'extrait trouvé');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('prepareAssistantTechniqueContext() signale l\'absence d\'historique sans exception si aucun match', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');

  try {
    const { client } = makeMockSupabase({ rpcResultsByAccount: { 'compte-A': [] } });
    const { systemPrompt, matches } = await prepareAssistantTechniqueContext(client, 'compte-A', 'question sans historique');
    assertEquals(matches.length, 0);
    assertEquals(systemPrompt.includes('Aucun historique pertinent'), true);
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

// ═══ 6. Le prompt système intègre les 3 garde-fous, textuellement, pas
// juste "quelque part dans le code" — c'est ce que le LLM reçoit
// réellement à chaque appel. ═══
Deno.test('formatAssistantTechniquePrompt() inclut les 3 garde-fous absolus', () => {
  const prompt = formatAssistantTechniquePrompt([]);
  assertMatch(prompt, /RÈGLE 1.*Anti-hallucination/s);
  assertMatch(prompt, /RÈGLE 2.*Sécurité/s);
  assertMatch(prompt, /RÈGLE 3.*Traçabilité/s);
  // Le prompt doit contenir EXACTEMENT le texte exporté, pas une paraphrase
  // qui pourrait dériver du texte réellement maintenu à jour.
  assertEquals(prompt.includes(SEBA_SAFETY_RAILS), true);
});

// ═══ 7. questionConcerneFinance() — heuristique déterministe, pas un
// appel LLM pour une décision aussi simple ═══
Deno.test('questionConcerneFinance() détecte les questions financières', () => {
  assertEquals(questionConcerneFinance('Est-ce rentable de remplacer cette pièce ?'), true);
  assertEquals(questionConcerneFinance('Quel est le coût de cette réparation ?'), true);
  assertEquals(questionConcerneFinance('Le client a-t-il payé sa facture ?'), true);
});
Deno.test('questionConcerneFinance() ne se déclenche pas sur une question purement technique', () => {
  assertEquals(questionConcerneFinance('Comment déboucher cette canalisation ?'), false);
});

// ═══ 8. formatFinancialContext() ne fuite JAMAIS account/ids bruts
// (Garde-fou 2) — seulement des montants agrégés lisibles. ═══
Deno.test('formatFinancialContext() ne contient aucun identifiant brut, uniquement des montants', () => {
  const text = formatFinancialContext({
    profitability: { interventionId: 'id_secret_abc123', revenu: 200, coutMateriaux: 50, marge: 150, margePct: 75 },
    summary: { account: 'compte-secret-xyz', interventionsCount: 3, revenuTotal: 500, coutMateriauxTotal: 100, margeTotale: 400, margePctMoyenne: 80 },
  });
  assertEquals(text?.includes('id_secret_abc123'), false, 'l\'intervention_id ne doit jamais apparaître dans le texte destiné au LLM');
  assertEquals(text?.includes('compte-secret-xyz'), false, 'l\'account ne doit jamais apparaître dans le texte destiné au LLM');
  assertMatch(text ?? '', /150[.,]00\s?€/, 'les montants agrégés doivent rester présents');
});
Deno.test('formatFinancialContext() déclare explicitement l\'absence de données (Garde-fou 1)', () => {
  const text = formatFinancialContext({ profitability: null, summary: null });
  assertEquals(text?.includes('Aucune donnée'), true);
});
Deno.test('formatFinancialContext() retourne null si aucun outil financier n\'a été déclenché', () => {
  assertEquals(formatFinancialContext(null), null);
});

// ═══ 9. prepareAssistantTechniqueContext() ne déclenche les outils
// financiers QUE si la question s'y prête — jamais pour une question
// purement technique. ═══
Deno.test('prepareAssistantTechniqueContext() ne consulte pas les outils financiers pour une question technique', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');
  try {
    const { client, calls } = makeMockSupabase({ rpcResultsByAccount: { 'compte-A': [] } });
    const { financials } = await prepareAssistantTechniqueContext(client, 'compte-A', 'comment déboucher cette canalisation ?');
    assertEquals(financials, null);
    assertEquals(calls.some((c) => c.method === 'rpc:get_marge_reelle'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('prepareAssistantTechniqueContext() consulte get_financial_summary pour une question financière, même sans interventionId', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');
  try {
    const { client, calls } = makeMockSupabase({
      rpcResultsByAccount: { 'compte-A': [] },
      summaryRowsByAccount: { 'compte-A': [{ intervention_id: 'id_1', revenu: 100, cout_materiaux: 20, marge: 80 }] },
    });
    const { financials, systemPrompt } = await prepareAssistantTechniqueContext(client, 'compte-A', 'est-ce rentable de continuer ce chantier ?');
    assertEquals(financials?.profitability, null, 'sans interventionId fourni, calculate_profitability ne doit pas être appelé');
    assertEquals(financials?.summary?.margeTotale, 80);
    assertEquals(calls.some((c) => c.method === 'from:vue_marge_interventions'), true);
    assertEquals(systemPrompt.includes('Contexte financier'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ═══ 10. Un outil qui échoue (timeout DB, erreur RLS...) est intercepté
// et transformé en absence de donnée — jamais une exception qui remonte
// à l'appelant (mission : "gestion robuste des failures"). ═══
Deno.test('prepareAssistantTechniqueContext() intercepte un échec de lookup_history sans planter', async () => {
  const client = {
    rpc() { return { abortSignal() { return this; }, then(_r: unknown, reject: (e: unknown) => void) { reject(new Error('DB timeout simulé')); } }; },
  } as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }), { status: 200 }))) as typeof fetch;
  Deno.env.set('MISTRAL_API_KEY', 'test-key-fake');
  try {
    const { matches, systemPrompt } = await prepareAssistantTechniqueContext(client, 'compte-A', 'question technique quelconque');
    assertEquals(matches, [], 'un échec de lookup_history doit se résoudre en liste vide, jamais une exception');
    assertEquals(systemPrompt.includes('Aucun historique pertinent'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
