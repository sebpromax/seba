// ═══════════════════════════════════════════════════════════════
// Tests unitaires — llm-providers.ts.
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// meme limite que le reste du projet — voir PLAN.md dette technique
// "Configurer un environnement CI ou CLI Deno"). Prets a lancer via
// `deno test supabase-functions/_shared/llm-providers.test.ts`.
//
// Portee reelle : verifie le CONTRAT (ordre de fallback, propagation du
// nom du provider gagnant, comportement quand tout echoue, disjoncteur de
// cout global) via des stubs de Deno.env.get et globalThis.fetch — jamais
// un vrai appel reseau.
// ═══════════════════════════════════════════════════════════════

import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { callWithFallback, enforceUsageGuardrail } from './llm-providers.ts';

// Config minimale pour que enforceUsageGuardrail() ne bloque pas les
// tests qui ne portent pas sur le disjoncteur lui-meme -- guardrailCount
// (defaut 1) reste tres en dessous du plafond par defaut (50).
const GUARDRAIL_DEFAULT_ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' };

function withStubs<T>(
  opts: {
    envKeys?: Record<string, string>;
    fetchImpl?: (url: string) => Promise<Response>;
    guardrailCount?: number | null; // null = simule une reponse RPC invalide/erreur reseau
    skipGuardrailEnv?: boolean; // pour tester le fail-closed quand SUPABASE_URL/SERVICE_ROLE_KEY sont absents
  },
  fn: () => Promise<T>,
): Promise<T> {
  const originalGet = Deno.env.get.bind(Deno.env);
  const originalFetch = globalThis.fetch;
  const mergedEnv = opts.skipGuardrailEnv ? (opts.envKeys ?? {}) : { ...GUARDRAIL_DEFAULT_ENV, ...opts.envKeys };
  Deno.env.get = ((key: string) => mergedEnv[key] ?? originalGet(key)) as typeof Deno.env.get;

  const userFetch = opts.fetchImpl;
  globalThis.fetch = ((url: string) => {
    if (url.includes('/rpc/increment_api_usage')) {
      if (opts.guardrailCount === null) return Promise.reject(new Error('panne réseau simulée pour increment_api_usage'));
      return Promise.resolve(new Response(JSON.stringify(opts.guardrailCount ?? 1), { status: 200 }));
    }
    if (userFetch) return userFetch(url);
    return Promise.reject(new Error('fetch non stubbé pour ' + url));
  }) as typeof fetch;

  return fn().finally(() => {
    Deno.env.get = originalGet;
    globalThis.fetch = originalFetch;
  });
}

function chatResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

Deno.test('callWithFallback : renvoie la reponse + le nom du premier provider qui repond (mistral)', async () => {
  const result = await withStubs(
    {
      envKeys: { MISTRAL_API_KEY: 'fake-key' },
      fetchImpl: () => Promise.resolve(chatResponse('reponse mistral')),
    },
    () => callWithFallback('system', 'user'),
  );
  assertEquals(result, { answer: 'reponse mistral', provider: 'mistral' });
});

Deno.test('callWithFallback : sans MISTRAL_API_KEY, bascule sur le provider suivant (groq)', async () => {
  const result = await withStubs(
    {
      envKeys: { GROQ_API_KEY: 'fake-key' }, // pas de cle Mistral -> callMistral leve immediatement
      fetchImpl: (url) => {
        if (url.includes('groq.com')) return Promise.resolve(chatResponse('reponse groq'));
        return Promise.reject(new Error('ne devrait pas etre appele'));
      },
    },
    () => callWithFallback('system', 'user'),
  );
  assertEquals(result, { answer: 'reponse groq', provider: 'groq' });
});

Deno.test('callWithFallback : tous les providers echouent -> null, jamais une exception', async () => {
  const result = await withStubs(
    {
      envKeys: {}, // aucune cle -> les 4 callX() levent "XXX_API_KEY absente" immediatement
    },
    () => callWithFallback('system', 'user'),
  );
  assertEquals(result, null);
});

Deno.test('callWithFallback : un provider avec cle mais reponse HTTP en erreur est traite comme un echec (bascule)', async () => {
  const result = await withStubs(
    {
      envKeys: { MISTRAL_API_KEY: 'fake-key', GROQ_API_KEY: 'fake-key' },
      fetchImpl: (url) => {
        if (url.includes('mistral.ai')) return Promise.resolve(new Response('erreur', { status: 500 }));
        if (url.includes('groq.com')) return Promise.resolve(chatResponse('reponse groq'));
        return Promise.reject(new Error('ne devrait pas etre appele'));
      },
    },
    () => callWithFallback('system', 'user'),
  );
  assertEquals(result, { answer: 'reponse groq', provider: 'groq' });
});

// ═══ Disjoncteur global de coût (enforceUsageGuardrail) ═══

Deno.test('enforceUsageGuardrail() : sous le plafond, ne lève rien', async () => {
  await withStubs({ guardrailCount: 3, envKeys: { MAX_DAILY_REQUESTS: '50' } }, () => enforceUsageGuardrail());
});

Deno.test('enforceUsageGuardrail() : au-dessus du plafond, lève DAILY_LIMIT_REACHED', async () => {
  await withStubs(
    { guardrailCount: 51, envKeys: { MAX_DAILY_REQUESTS: '50' } },
    () => assertRejects(() => enforceUsageGuardrail(), Error, 'DAILY_LIMIT_REACHED'),
  );
});

Deno.test('enforceUsageGuardrail() : respecte un plafond personnalisé via MAX_DAILY_REQUESTS', async () => {
  await withStubs(
    { guardrailCount: 6, envKeys: { MAX_DAILY_REQUESTS: '5' } },
    () => assertRejects(() => enforceUsageGuardrail(), Error, 'DAILY_LIMIT_REACHED'),
  );
});

Deno.test('enforceUsageGuardrail() : fail-closed si SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absents', async () => {
  await withStubs(
    { skipGuardrailEnv: true, envKeys: {} },
    () => assertRejects(() => enforceUsageGuardrail(), Error, 'DAILY_LIMIT_REACHED'),
  );
});

Deno.test('enforceUsageGuardrail() : fail-closed si la RPC increment_api_usage échoue (réseau/HTTP)', async () => {
  await withStubs(
    { guardrailCount: null },
    () => assertRejects(() => enforceUsageGuardrail(), Error, 'DAILY_LIMIT_REACHED'),
  );
});

Deno.test('callWithFallback() : le disjoncteur ouvert bloque l\'appel AVANT de contacter un provider', async () => {
  let providerCalled = false;
  await assertRejects(
    () => withStubs(
      {
        guardrailCount: 999,
        envKeys: { MISTRAL_API_KEY: 'fake-key' },
        fetchImpl: () => { providerCalled = true; return Promise.resolve(chatResponse('ne devrait jamais être atteint')); },
      },
      () => callWithFallback('system', 'user'),
    ),
    Error,
    'DAILY_LIMIT_REACHED',
  );
  assertEquals(providerCalled, false, 'aucun provider ne doit être contacté si le disjoncteur global est ouvert');
});
