// ═══════════════════════════════════════════════════════════════
// SEBA — Orchestrateur quotidien (Phase 4, automatisation serverless).
//
// Déclenché une fois par jour par pg_cron (Supabase Postgres, gratuit —
// voir MANUEL-SEBA-ADMIN.md §1j), PAS par un navigateur : cette fonction
// n'a pas de CORS et exige que l'appelant présente la clé service_role
// elle-même (seul pg_cron la connaît côté serveur).
//
// Pour chaque compte ayant des données réelles : calcule un résumé
// simple (factures en retard, devis en attente), demande une
// recommandation à l'IA via decideAvecLLM() (_shared/conscience-seba.ts,
// System Prompt centralisé, même chaîne de fallback à 4 fournisseurs que
// ai-relay.ts — voir _shared/llm-providers.ts), et si une action semble
// utile, envoie un email (Resend) + une notification push (OneSignal)
// au patron de l'entreprise.
//
// La boucle ci-dessous itère UNE ligne seba_state = UN compte à la fois :
// c'est ce qui garantit le cloisonnement multi-tenant du contexte envoyé
// au LLM (jamais de mélange de données entre comptes), sans qu'il soit
// nécessaire ni souhaitable d'injecter l'account_id lui-même dans le texte
// envoyé au modèle (Garde-fou 2 de conscience-seba.ts : aucun identifiant
// brut dans un prompt/une réponse IA).
//
// Contexte de confiance différent de ai-relay.ts/send-email.ts/
// send-push.ts (qui sont appelés par le NAVIGATEUR d'un utilisateur
// quelconque, d'où leur JWT + rate-limit) : ici l'appelant est déjà le
// serveur Supabase lui-même via pg_cron, donc les appels aux
// fournisseurs (Resend/OneSignal) sont faits directement, sans repasser
// par ces fonctions HTTP.
// ═══════════════════════════════════════════════════════════════

import { decideAvecLLM } from './_shared/conscience-seba.ts';
import { LLM_PROVIDERS } from './_shared/llm-providers.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Audit go-live (AUDIT-GO-LIVE-SEBA.md, section 2) : voir ai-relay.ts pour
// le detail du raisonnement (AbortSignal.timeout, pas de construction
// manuelle). Particulierement important ici : ce batch boucle sur TOUS
// les comptes ayant des donnees reelles -- un seul appel bloque sans
// timeout aurait pu ralentir ou geler l'integralite du cron pour tous
// les comptes suivants dans la boucle, pas seulement celui en cours.
const FETCH_TIMEOUT_MS = 5000;

async function sendEmail(to: string, subject: string, html: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + resendKey },
      body: JSON.stringify({ from: Deno.env.get('RESEND_FROM') || 'Seba <onboarding@resend.dev>', to: [to], subject, html }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch { /* best-effort */ }
}

async function sendPush(accountId: string, title: string, message: string) {
  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const restKey = Deno.env.get('ONESIGNAL_API_KEY');
  if (!appId || !restKey) return;
  try {
    await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + restKey },
      body: JSON.stringify({
        app_id: appId, include_external_user_ids: [accountId], channel_for_external_user_ids: 'push',
        headings: { fr: title }, contents: { fr: message },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const auth = req.headers.get('authorization') || '';
  if (!serviceKey || !supaUrl || auth !== 'Bearer ' + serviceKey) {
    return jsonResponse({ error: 'Réservé au déclencheur planifié (pg_cron)' }, 401);
  }

  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  const results: Array<{ account: string; action: string | null }> = [];

  try {
    const rowsRes = await fetch(supaUrl + '/rest/v1/seba_state?select=account,user_id,state', { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const rows = rowsRes.ok ? await rowsRes.json() : [];

    for (const row of rows) {
      const state = row.state || {};
      const factures = Array.isArray(state.factures) ? state.factures : [];
      const devis = Array.isArray(state.devis) ? state.devis : [];
      const retard = factures.filter((f: { status?: string }) => f.status === 'retard');
      const attente = devis.filter((d: { status?: string }) => d.status === 'attente');

      // Rien d'actionnable -> pas de digest ce jour-là (évite de spammer)
      if (!retard.length && !attente.length) { results.push({ account: row.account, action: null }); continue; }

      const context = {
        facturesEnRetard: retard.length,
        montantEnRetardEUR: retard.reduce((s: number, f: { amount?: number }) => s + (f.amount || 0), 0),
        devisEnAttente: attente.length,
      };
      const decision = await decideAvecLLM(context, LLM_PROVIDERS);
      const reco = decision?.verdict ?? null;
      results.push({ account: row.account, action: reco?.action || null });
      if (!reco || reco.priority === 'low') continue;

      // E-mail au patron du compte (adresse récupérée via l'API admin Supabase)
      if (row.user_id) {
        try {
          const userRes = await fetch(supaUrl + '/auth/v1/admin/users/' + row.user_id, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (userRes.ok) {
            const user = await userRes.json();
            if (user.email) {
              await sendEmail(
                user.email,
                'Seba — ' + reco.action,
                '<p>' + reco.reasoning + '</p><p>' + context.facturesEnRetard + ' facture(s) en retard (' + context.montantEnRetardEUR + ' €), ' + context.devisEnAttente + ' devis en attente.</p>',
              );
            }
          }
        } catch { /* best-effort */ }
      }
      await sendPush(row.account, reco.action, reco.reasoning);
    }
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }

  return jsonResponse({ ok: true, accounts: results.length, results });
});
