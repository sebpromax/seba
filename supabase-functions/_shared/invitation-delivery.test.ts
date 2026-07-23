// ═══════════════════════════════════════════════════════════════
// Tests unitaires — invitation-delivery.ts (fix/invitation-delivery).
//
// NON EXECUTES dans cet environnement (pas de CLI Deno disponible ici,
// même limite que les autres tests de supabase-functions/_shared/ -- voir
// conscience-seba.test.ts). Écrits pour être lancés via
// `deno test supabase-functions/_shared/invitation-delivery.test.ts` dès
// qu'un environnement Deno est disponible (CI ou poste local).
// ═══════════════════════════════════════════════════════════════

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { normalizeResendError, sendInvitationViaResend } from './invitation-delivery.ts';

Deno.test('sendInvitationViaResend() renvoie ok:true + resendId sur succès HTTP 200', async () => {
  const fakeFetch = (() => Promise.resolve(new Response(JSON.stringify({ id: 'resend_abc123' }), { status: 200 }))) as typeof fetch;
  const res = await sendInvitationViaResend({
    resendKey: 'test-key-fake', from: 'Seba <onboarding@resend.dev>', to: 'client@example.com',
    actionLink: 'https://sebpromax.github.io/seba/reset-password.html?token=xyz', invitationType: 'client', fetchImpl: fakeFetch,
  });
  assertEquals(res.ok, true);
  assertEquals(res.resendId, 'resend_abc123');
  assertEquals(res.errorMessage, undefined);
});

Deno.test('sendInvitationViaResend() renvoie ok:false + erreur normalisée sur refus Resend (domaine non vérifié, sandbox)', async () => {
  const fakeFetch = (() => Promise.resolve(new Response(
    JSON.stringify({ message: 'You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain' }),
    { status: 403 },
  ))) as typeof fetch;
  const res = await sendInvitationViaResend({
    resendKey: 'test-key-fake', from: 'Seba <onboarding@resend.dev>', to: 'employe@example.com',
    actionLink: 'https://sebpromax.github.io/seba/reset-password.html?token=xyz', invitationType: 'employe', fetchImpl: fakeFetch,
  });
  assertEquals(res.ok, false);
  assert(res.errorMessage!.includes('non vérifié'));
  assert(!res.errorMessage!.includes('test-key-fake'), 'le message d\'erreur ne doit jamais contenir la clé API');
});

Deno.test('sendInvitationViaResend() renvoie ok:false sur exception réseau (fetch qui rejette)', async () => {
  const fakeFetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
  const res = await sendInvitationViaResend({
    resendKey: 'test-key-fake', from: 'Seba <onboarding@resend.dev>', to: 'client@example.com',
    actionLink: 'https://sebpromax.github.io/seba/reset-password.html?token=xyz', invitationType: 'client', fetchImpl: fakeFetch,
  });
  assertEquals(res.ok, false);
  assert(!!res.errorMessage);
});

Deno.test('normalizeResendError() reformule le refus sandbox (403 + "own email") en message clair', () => {
  const msg = normalizeResendError(403, 'You can only send testing emails to your own email address');
  assert(msg.includes('non vérifié'));
});

Deno.test('normalizeResendError() ne dépasse jamais 300 caractères de corps recopié (pas de fuite massive de réponse brute)', () => {
  const longBody = 'x'.repeat(1000);
  const msg = normalizeResendError(500, longBody);
  assert(msg.length < 350);
});
