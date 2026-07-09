// ═══════════════════════════════════════════════════════════════
// SEBA — Service d'analytique financière (Palier 5).
//
// Aucun appel LLM ici (tier0_deterministic, comme prediction_impayes dans
// product-agents.config.json) : la marge est un calcul, jamais une
// estimation demandée à un modèle.
//
// Masquage des données sensibles : `paiements.reference` (référence
// bancaire/transaction) n'est JAMAIS sélectionnée par les requêtes de ce
// fichier — ni dans vue_marge_interventions, ni ici. Le masquage se fait
// par OMISSION DE COLONNE dans la requête elle-même, pas par un filtrage
// a posteriori sur un objet déjà chargé (une donnée jamais lue ne peut
// jamais fuiter par erreur dans un log ou une réponse partielle).
//
// `account` DOIT être résolu par l'appelant à partir du JWT de la session
// (jamais un champ envoyé tel quel par un client) — même règle que
// match_interventions/call_notify_alert/lookupHistory : sous une
// connexion service_role, ces fonctions n'ont pas d'autre frontière de
// sécurité multi-tenant.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FETCH_TIMEOUT_MS = 5000;

export interface InterventionProfitability {
  interventionId: string;
  revenu: number;
  coutMateriaux: number;
  marge: number;
  margePct: number | null; // null si revenu = 0 (division impossible, pas une erreur)
}

export interface FinancialSummary {
  account: string;
  interventionsCount: number;
  revenuTotal: number;
  coutMateriauxTotal: number;
  margeTotale: number;
  margePctMoyenne: number | null;
}

function computeMargePct(revenu: number, marge: number): number | null {
  if (revenu === 0) return null;
  return Math.round((marge / revenu) * 10000) / 100; // 2 decimales
}

/**
 * Marge réelle d'UNE intervention (tool `calculate_profitability`).
 * Retourne null si aucune donnée (ni coût, ni paiement) n'existe pour
 * cette intervention — pas une erreur, juste une absence de données.
 */
export async function calculateProfitability(
  supa: SupabaseClient,
  account: string,
  interventionId: string,
): Promise<InterventionProfitability | null> {
  const { data, error } = await supa
    .rpc('get_marge_reelle', { p_account: account, p_intervention_id: interventionId })
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
    .maybeSingle();

  if (error) {
    console.error('[finance-analytics] calculateProfitability: get_marge_reelle a échoué', error.message);
    return null;
  }
  if (!data) return null;

  const revenu = Number(data.revenu) || 0;
  const coutMateriaux = Number(data.cout_materiaux) || 0;
  const marge = Number(data.marge) || 0;
  return {
    interventionId,
    revenu,
    coutMateriaux,
    marge,
    margePct: computeMargePct(revenu, marge),
  };
}

/**
 * Résumé financier agrégé sur TOUT le compte (tool `get_financial_summary`).
 * Agrégation cote TypeScript (pas une deuxième vue SQL "globale") : le
 * volume attendu par compte (dizaines/centaines d'interventions, pas des
 * millions) rend un GROUP BY applicatif largement suffisant, pas besoin
 * d'une fonction SQL dédiée pour ce palier.
 */
export async function getFinancialSummary(supa: SupabaseClient, account: string): Promise<FinancialSummary> {
  const { data, error } = await supa
    .from('vue_marge_interventions')
    .select('intervention_id, revenu, cout_materiaux, marge')
    .eq('account', account)
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  if (error) {
    console.error('[finance-analytics] getFinancialSummary: lecture de vue_marge_interventions a échoué', error.message);
    return { account, interventionsCount: 0, revenuTotal: 0, coutMateriauxTotal: 0, margeTotale: 0, margePctMoyenne: null };
  }

  const rows = data ?? [];
  const revenuTotal = rows.reduce((s, r) => s + (Number(r.revenu) || 0), 0);
  const coutMateriauxTotal = rows.reduce((s, r) => s + (Number(r.cout_materiaux) || 0), 0);
  const margeTotale = rows.reduce((s, r) => s + (Number(r.marge) || 0), 0);

  return {
    account,
    interventionsCount: rows.length,
    revenuTotal,
    coutMateriauxTotal,
    margeTotale,
    margePctMoyenne: computeMargePct(revenuTotal, margeTotale),
  };
}
