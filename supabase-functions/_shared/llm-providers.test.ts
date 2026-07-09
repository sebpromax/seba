// ═══════════════════════════════════════════════════════════════
// Tests unitaires — llm-providers.ts.
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// meme limite que le reste du projet — voir PLAN.md dette technique
// "Configurer un environnement CI ou CLI Deno"). Prets a lancer via
// `deno test supabase-functions/_shared/llm-providers.test.ts`.
//
// Portee reelle : verifie le CONTRAT (ordre de fallback, propagation du
// nom du provider gagnant, comportement quand tout echoue) via des stubs
// de Deno.env.get et globalThis.fetch — jamais un vrai appel reseau.
// ═══════════════════════════════════════════════════════════════

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { callWithFallback } from './llm-providers.ts';

function withStubs<T>(
  opts: { envKeys?: Record<string, string>; fetchImpl?: (url: string) => Promise<Response> },
  fn: () => Promise<T>,
): Promise<T> {
  const originalGet = Deno.env.get.bind(Deno.env);
  const originalFetch = globalThis.fetch;
  Deno.env.get = ((key: string) => opts.envKeys?.[key] ?? originalGet(key)) as typeof Deno.env.get;
  if (opts.fetchImpl) {
    globalThis.fetch = ((url: string) => opts.fetchImpl!(url)) as typeof fetch;
  }
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
