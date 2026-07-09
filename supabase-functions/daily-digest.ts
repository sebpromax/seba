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
// recommandation à l'IA (Mistral puis Groq), et si une action semble
// utile, envoie un email (Resend) + une notification push (OneSignal)
// au patron de l'entreprise.
//
// Contexte de confiance différent de ai-relay.ts/send-email.ts/
// send-push.ts (qui sont appelés par le NAVIGATEUR d'un utilisateur
// quelconque, d'où leur JWT + rate-limit) : ici l'appelant est déjà le
// serveur Supabase lui-même via pg_cron, donc les appels aux
// fournisseurs (Mistral/Groq/Resend/OneSignal) sont faits directement,
// sans repasser par ces fonctions HTTP.
// ═══════════════════════════════════════════════════════════════

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

async function callMistralOrGroq(context: Record<string, unknown>): Promise<{ action: string; priority: string; reasoning: string } | null> {
  const system =
    "Tu es Seba, l'intelligence de pilotage d'un cockpit de gestion. " +
    'Réponds uniquement en JSON structuré : {"action":"titre court","priority":"high/medium/low","reasoning":"une phrase"}. ' +
    "Analyse le contexte et propose UNE mesure concrète si utile.";
  const providers: Array<() => Promise<string>> = [];
  const mistralKey = Deno.env.get('MISTRAL_API_KEY');
  if (mistralKey) {
    providers.push(async () => {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mistralKey },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }],
          response_format: { type: 'json_object' }, max_tokens: 250, temperature: 0.3,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('Mistral HTTP ' + res.status);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    });
  }
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (groqKey) {
    providers.push(async () => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }],
          max_tokens: 250, temperature: 0.3,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('Groq HTTP ' + res.status);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    });
  }
  for (const call of providers) {
    try {
      const raw = await call();
      const parsed = JSON.parse(raw);
      if (parsed && parsed.action && parsed.priority) return parsed;
    } catch { /* fournisseur suivant */ }
  }
  return null;
}

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
      const reco = await callMistralOrGroq(context);
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
