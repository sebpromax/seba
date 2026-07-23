// ═══════════════════════════════════════════════════════════════
// SEBA — Envoi de l'email d'invitation via Resend + normalisation des
// erreurs (partagé par employe-provision.ts et client-provision.ts,
// fix/invitation-delivery).
//
// Pourquoi ce fichier existe : les deux Edge Functions de provisionnement
// utilisaient jusqu'ici supabase.auth.admin.inviteUserByEmail(), qui
// envoie l'email via le SMTP configuré côté Supabase (Resend en
// pratique) SANS jamais exposer le résultat de cet envoi à l'appelant --
// impossible de savoir si Resend a accepté ou refusé le message, aucun
// identifiant Resend, aucune erreur exploitable. Ce module envoie
// explicitement via l'API Resend (même schéma que send-email.ts) pour
// obtenir un vrai statut (id ou erreur) à journaliser dans invitation_log.
// ═══════════════════════════════════════════════════════════════

export interface SendResult {
  ok: boolean;
  resendId?: string;
  errorMessage?: string; // normalisé, ne contient JAMAIS de secret (clé API, JWT)
}

/** Envoie l'email d'invitation (lien Supabase Auth déjà généré en amont
    par auth.admin.generateLink()) via l'API Resend. N'expose jamais la
    clé RESEND_API_KEY à l'appelant -- elle reste dans ce module, lue
    depuis Deno.env par l'appelant et passée en paramètre. */
export async function sendInvitationViaResend(opts: {
  resendKey: string;
  from: string;
  to: string;
  actionLink: string;
  invitationType: 'employe' | 'client';
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const doFetch = opts.fetchImpl || fetch;
  const label = opts.invitationType === 'employe' ? 'votre espace terrain' : 'votre espace client';
  const subject = 'Invitation Seba — accédez à ' + label;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#0D9488;">Vous êtes invité(e) sur Seba</h2>
      <p>Cliquez sur le lien ci-dessous pour choisir votre mot de passe et accéder à ${label}.</p>
      <p><a href="${opts.actionLink}" style="display:inline-block;background:#0D9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Activer mon accès</a></p>
      <p style="color:#71717A;font-size:.85rem;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : ${opts.actionLink}</p>
    </div>
  `;

  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.resendKey },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject,
        html,
        tags: [{ name: 'kind', value: 'invitation-' + opts.invitationType }],
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return { ok: false, errorMessage: normalizeResendError(res.status, bodyText) };
    }
    const data = await res.json();
    return { ok: true, resendId: data && data.id ? String(data.id) : undefined };
  } catch (e) {
    return { ok: false, errorMessage: 'Connexion à Resend impossible.' };
  }
}

/** Normalise une réponse d'erreur Resend en message technique lisible,
    SANS jamais reproduire de secret (la clé API n'apparaît jamais dans le
    corps de réponse Resend, mais on tronque quand même par prudence et on
    ne renvoie jamais les en-têtes de la requête). Cas connu et fréquent en
    sandbox (domaine non vérifié) : Resend refuse tout destinataire autre
    que l'adresse du titulaire du compte -- message reformulé en clair pour
    que le patron comprenne qu'il s'agit d'un blocage de configuration, pas
    d'une adresse invalide. */
export function normalizeResendError(status: number, bodyText: string): string {
  const truncated = String(bodyText || '').slice(0, 300);
  const lower = truncated.toLowerCase();
  if (status === 403 && (lower.includes('own email') || lower.includes('verify a domain') || lower.includes('testing emails'))) {
    return 'Domaine d\'envoi non vérifié auprès de Resend (mode sandbox) : impossible d\'envoyer à cette adresse tant que le domaine n\'est pas validé.';
  }
  if (status === 422) {
    return 'Adresse email refusée par Resend (HTTP 422) : ' + truncated;
  }
  return 'Resend HTTP ' + status + ' : ' + truncated;
}

/* deno-lint-ignore no-explicit-any */
type MinimalSupabase = any;

/** Insère une ligne invitation_log ('pending') et renvoie son id -- une
    ligne PAR TENTATIVE (jamais un upsert sur le statut), voir l'en-tête de
    migrations/2026-07-23-invitation-delivery-log.sql pour le pourquoi. */
export async function logInvitationAttempt(supabase: MinimalSupabase, row: {
  account: string; invitationType: 'employe' | 'client'; targetId: string; recipientEmail: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('invitation_log')
    .insert({
      account: row.account, invitation_type: row.invitationType, target_id: row.targetId,
      recipient_email: row.recipientEmail, status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return data.id as string;
}

/** Met à jour le statut final ('sent' | 'failed') d'une tentative déjà
    journalisée. */
export async function updateInvitationStatus(supabase: MinimalSupabase, logId: string, patch: {
  status: 'sent' | 'failed'; resendId?: string; errorMessage?: string;
}): Promise<void> {
  await supabase
    .from('invitation_log')
    .update({ status: patch.status, resend_id: patch.resendId || null, error_message: patch.errorMessage || null, updated_at: new Date().toISOString() })
    .eq('id', logId);
}
