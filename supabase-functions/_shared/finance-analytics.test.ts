// ═══════════════════════════════════════════════════════════════
// Tests unitaires — finance-analytics.ts (Palier 5).
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// meme limite que pour toutes les Edge Functions du projet — voir
// AUDIT-GO-LIVE-SEBA.md sur pg_net/Vault). Prets a lancer via
// `deno test supabase-functions/_shared/finance-analytics.test.ts`.
//
// Portee reelle : verifie le CONTRAT TypeScript (quel account part vers
// get_marge_reelle/vue_marge_interventions, comment les agregats sont
// calcules) via un client Supabase mocke — PAS la RLS ni la vue/fonction
// SQL elles-memes, qui exigent un vrai Postgres (verifiees par relecture,
// voir supabase-schema.sql sections 22-25).
// ═══════════════════════════════════════════════════════════════

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { calculateProfitability, getFinancialSummary } from './finance-analytics.ts';

function makeMockSupabase(opts: {
  rpcResultByAccount?: Record<string, { revenu: number; cout_materiaux: number; marge: number } | null>;
  summaryRowsByAccount?: Record<string, Array<{ intervention_id: string; revenu: number; cout_materiaux: number; marge: number }>>;
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ method: 'rpc:' + name, args: [params] });
      const account = params.p_account as string;
      const row = opts.rpcResultByAccount?.[account] ?? null;
      return {
        abortSignal() { return this; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
      };
    },
    from(table: string) {
      calls.push({ method: 'from:' + table, args: [] });
      let filterAccount: string | undefined;
      return {
        select() { return this; },
        eq(col: string, val: string) {
          calls.push({ method: 'eq', args: [col, val] });
          if (col === 'account') filterAccount = val;
          return this;
        },
        abortSignal() {
          const rows = opts.summaryRowsByAccount?.[filterAccount ?? ''] ?? [];
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
  return { client: client as unknown as import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient, calls };
}

// ═══ calculateProfitability() doit passer p_account EXACTEMENT le compte
// demandé — seule frontière multi-tenant de get_marge_reelle() sous un
// appel service_role. ═══
Deno.test('calculateProfitability() scope get_marge_reelle au compte demandé', async () => {
  const { client, calls } = makeMockSupabase({
    rpcResultByAccount: { 'compte-A': { revenu: 200, cout_materiaux: 50, marge: 150 } },
  });
  const result = await calculateProfitability(client, 'compte-A', 'id_abc123');
  const rpcCall = calls.find((c) => c.method === 'rpc:get_marge_reelle');
  assertEquals((rpcCall?.args[0] as Record<string, unknown>).p_account, 'compte-A');
  assertEquals((rpcCall?.args[0] as Record<string, unknown>).p_intervention_id, 'id_abc123');
  assertEquals(result?.revenu, 200);
  assertEquals(result?.marge, 150);
  assertEquals(result?.margePct, 75); // 150/200 = 75%
});

Deno.test('calculateProfitability() retourne null (pas une exception) si aucune donnée', async () => {
  const { client } = makeMockSupabase({ rpcResultByAccount: {} });
  const result = await calculateProfitability(client, 'compte-A', 'id_inconnu');
  assertEquals(result, null);
});

Deno.test('calculateProfitability() margePct est null si revenu = 0 (pas une division par zéro qui plante)', async () => {
  const { client } = makeMockSupabase({
    rpcResultByAccount: { 'compte-A': { revenu: 0, cout_materiaux: 30, marge: -30 } },
  });
  const result = await calculateProfitability(client, 'compte-A', 'id_xyz');
  assertEquals(result?.margePct, null);
});

// ═══ getFinancialSummary() agrège uniquement les lignes du compte
// demandé (filtre .eq('account', ...) vérifié), jamais d'un autre. ═══
Deno.test('getFinancialSummary() filtre vue_marge_interventions par compte et agrège correctement', async () => {
  const { client, calls } = makeMockSupabase({
    summaryRowsByAccount: {
      'compte-A': [
        { intervention_id: 'id_1', revenu: 100, cout_materiaux: 20, marge: 80 },
        { intervention_id: 'id_2', revenu: 50, cout_materiaux: 10, marge: 40 },
      ],
      'compte-B': [{ intervention_id: 'id_9', revenu: 999, cout_materiaux: 0, marge: 999 }],
    },
  });

  const summary = await getFinancialSummary(client, 'compte-A');

  const eqCall = calls.find((c) => c.method === 'eq');
  assertEquals(eqCall?.args, ['account', 'compte-A']);
  assertEquals(summary.interventionsCount, 2);
  assertEquals(summary.revenuTotal, 150);
  assertEquals(summary.coutMateriauxTotal, 30);
  assertEquals(summary.margeTotale, 120);
});

Deno.test('getFinancialSummary() retourne des totaux à zéro (pas une exception) si le compte n\'a aucune intervention', async () => {
  const { client } = makeMockSupabase({ summaryRowsByAccount: {} });
  const summary = await getFinancialSummary(client, 'compte-vide');
  assertEquals(summary.interventionsCount, 0);
  assertEquals(summary.revenuTotal, 0);
  assertEquals(summary.margePctMoyenne, null);
});
