// ═══════════════════════════════════════════════════════════════
// SEBA — Pipeline de QA visuelle (Palier 2).
//
// Reçoit une photo de fin d'intervention, l'archive dans le bucket privé
// intervention-photos, la fait analyser par Gemini Vision selon des
// critères de conformité génériques, journalise le verdict dans
// qa_photos. NE BLOQUE JAMAIS l'intervention : toute erreur (upload,
// API IA, réponse malformée) retourne un JSON propre avec verdict
// 'incertain', jamais une exception qui casserait le flux du technicien.
//
// Body attendu : multipart/form-data { image_blob: File, intervention_id: string }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runDecoupled, storeEmbedding } from './_shared/embeddings.ts';

const ALLOWED_ORIGINS = ['https://sebpromax.github.io', 'http://localhost:8791'];
const DAILY_LIMIT = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo, coherent avec file_size_limit du bucket (supabase-schema.sql)
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CONFIDENCE_THRESHOLD = 0.6;
// Audit go-live (AUDIT-GO-LIVE-SEBA.md, section 2) : voir ai-relay.ts pour
// le raisonnement general. RESERVE PROPRE A CE FICHIER : l'analyse
// multimodale (vision) est intrinsequement plus lente qu'une completion
// texte seule -- 5s peut se reveler court pour une vraie photo et
// declencher plus de verdicts 'incertain' par timeout que par analyse
// reelle. C'est sans risque (degradation deja geree, jamais de blocage),
// juste un compromis qualite/latence a surveiller (voir metrique n°3 du
// rapport d'audit, ratio incertain/total) -- ajuster cette seule
// constante si le ratio grimpe anormalement apres le go-live.
const FETCH_TIMEOUT_MS = 5000;

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/* Meme mecanisme que ai-relay.ts : JWT du caller -> auth.uid(), decodage
   synchrone, aucun appel reseau. */
function verifyUser(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const jwt = header.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt.split('.').length !== 3) return null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

/* Plafond quotidien par compte (table api_usage, kind='vision', distinct
   de kind='ai' pour que l'un n'epuise pas le quota de l'autre -- meme
   raisonnement que ai-relay.ts/send-email.ts/send-push.ts). Fail-open en
   cas d'erreur reseau/config : mieux vaut un usage temporairement non
   limite qu'une QA qui plante et bloque un technicien. */
async function checkRateLimit(supa: ReturnType<typeof createClient>, account: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supa.from('api_usage').select('count').match({ account, kind: 'vision', day: today }).maybeSingle();
    const count = data?.count ?? 0;
    if (count >= DAILY_LIMIT) return false;
    await supa.from('api_usage').upsert(
      { account, kind: 'vision', day: today, count: count + 1 },
      { onConflict: 'account,kind,day' },
    );
    return true;
  } catch {
    return true;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32k -- evite le depassement de pile de String.fromCharCode(...bytes) sur un gros buffer
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const VISION_SYSTEM =
  "Tu es un expert technique. Analyse l'image pour valider la conformité. " +
  'Réponds uniquement en JSON : {"verdict":"conforme"|"non_conforme","confidence":float,"raison":string}.';

interface GeminiVerdict { verdict: string; confidence: number; raison: string }

async function callGeminiVision(base64Image: string, mimeType: string): Promise<GeminiVerdict> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY absente');
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: VISION_SYSTEM }] },
        contents: [{ parts: [{ inlineData: { mimeType, data: base64Image } }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed.confidence !== 'number' || typeof parsed.verdict !== 'string') {
    throw new Error('Reponse Gemini malformee');
  }
  return parsed;
}

/* Verdict final envoye au client + journalise -- jamais directement celui
   de Gemini. confidence < 0.6 force TOUJOURS 'incertain', quel que soit
   ce que Gemini a repondu : un non_conforme a faible confiance est
   exactement le faux positif anxiogene a eviter pour un technicien qui a
   correctement fait son travail (voir VISION-TECHNIQUE-SEBA-PHASE2-
   CADRAGE.md, section Gemini). */
function finalizeVerdict(raw: GeminiVerdict | null, errorReason: string | null): { verdict: string; confidence: number; raison: string; error: boolean } {
  if (!raw) {
    return { verdict: 'incertain', confidence: 0, raison: errorReason || 'Analyse indisponible.', error: true };
  }
  const confidence = Math.max(0, Math.min(1, raw.confidence));
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { verdict: 'incertain', confidence, raison: raw.raison || 'Confiance insuffisante pour trancher.', error: false };
  }
  const verdict = raw.verdict === 'non_conforme' ? 'non_conforme' : 'conforme';
  return { verdict, confidence, raison: raw.raison || '', error: false };
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResponse(cors, { error: 'Method not allowed' }, 405);

  const callerUid = verifyUser(req);
  if (!callerUid) return jsonResponse(cors, { error: 'Authentification requise' }, 401);

  const { data: owner } = await supabase.from('seba_state').select('account').eq('user_id', callerUid).maybeSingle();
  if (!owner) return jsonResponse(cors, { error: 'Compte introuvable' }, 403);
  const account = owner.account;

  const allowed = await checkRateLimit(supabase, account);
  if (!allowed) return jsonResponse(cors, { error: 'Limite quotidienne de QA visuelle atteinte, réessayez demain' }, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(cors, { error: 'multipart/form-data invalide' }, 400);
  }

  const file = form.get('image_blob');
  const interventionId = form.get('intervention_id');
  if (!(file instanceof File) || typeof interventionId !== 'string' || !interventionId) {
    return jsonResponse(cors, { error: 'image_blob (fichier) et intervention_id (texte) requis' }, 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return jsonResponse(cors, { error: 'Type de fichier non supporté (jpeg/png/webp uniquement)' }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse(cors, { error: 'Fichier trop volumineux (10 Mo max)' }, 400);
  }

  const buffer = await file.arrayBuffer();
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = account + '/' + interventionId + '/' + Date.now() + '.' + ext;

  // ACTION 1 — Upload. Un echec ici est journalise et retourne proprement,
  // jamais une exception : le technicien ne doit jamais etre bloque parce
  // que le stockage a un probleme passager.
  const { error: uploadError } = await supabase.storage.from('intervention-photos').upload(path, buffer, { contentType: file.type });

  const result = uploadError
    ? finalizeVerdict(null, 'Échec de l\'archivage de la photo : ' + uploadError.message)
    : await (async () => {
        // ACTION 2 — Gemini Vision, sur les MEMES octets deja en memoire
        // (pas de re-telechargement depuis Storage).
        try {
          const base64 = arrayBufferToBase64(buffer);
          const raw = await callGeminiVision(base64, file.type);
          return finalizeVerdict(raw, null);
        } catch (e) {
          return finalizeVerdict(null, 'Analyse IA indisponible : ' + String((e as Error)?.message || e));
        }
      })();

  // Le stockage du verdict PRECEDE toujours l'embedding, dans cet ordre.
  // Pas pour eviter une erreur de cle etrangere : memoire_embeddings.
  // intervention_id n'a AUCUNE contrainte FK (texte libre, format
  // id_xxxxx, aucune ligne reelle a referencer -- Pilier 4, voir
  // supabase-schema.sql section 19). La vraie raison : ne jamais calculer
  // un embedding pour une analyse qui n'a pas ete reellement enregistree,
  // et embedder le verdict TEL QU'IL EST PERSISTE, pas un etat intermediaire.
  const { error: qaInsertError } = await supabase.from('qa_photos').insert({
    account,
    user_id: callerUid,
    intervention_id: interventionId,
    photo_path: uploadError ? null : path,
    verdict: result.verdict,
    confidence: result.confidence,
    raison: result.raison,
    error: result.error,
  });

  // Embedding declenche uniquement si (a) le verdict a bien ete enregistre
  // et (b) c'est une VRAIE analyse Gemini (result.error === false) -- un
  // message d'echec de pipeline ("Analyse indisponible : ...") n'a aucune
  // valeur pour la memoire semantique future, ce n'est pas du contenu
  // metier. Decouple du thread de reponse (runDecoupled ->
  // EdgeRuntime.waitUntil, voir _shared/embeddings.ts) : le technicien
  // reçoit son verdict immediatement, le calcul mistral-embed continue
  // apres l'envoi de la reponse HTTP.
  if (!qaInsertError && !result.error) {
    try {
      const content = `Intervention ${interventionId} — verdict ${result.verdict} (confiance ${(result.confidence * 100).toFixed(0)}%) : ${result.raison || 'aucun détail fourni'}`;
      runDecoupled(
        storeEmbedding(supabase, account, interventionId, content, {
          verdict: result.verdict,
          confidence: result.confidence,
          photo_path: uploadError ? null : path,
        }).then((r) => {
          if (!r.ok) console.error('[vision-qa] embedding non stocké (best-effort) :', r.error);
        }),
      );
    } catch (e) {
      // Filet de securite supplementaire : storeEmbedding() ne leve deja
      // jamais (retourne un resultat discrimine), mais ce try/catch
      // garantit qu'aucune evolution future de cet appel ne peut faire
      // echouer la reponse QA elle-meme.
      console.error('[vision-qa] déclenchement de l\'embedding a échoué (non bloquant) :', String((e as Error)?.message || e));
    }
  }

  // Toujours 200 : le statut HTTP ne doit jamais forcer le client a
  // interpreter ceci comme un blocage. `error` dans le corps distingue un
  // 'incertain' authentique d'un echec de pipeline pour qui veut tracer.
  return jsonResponse(cors, result, 200);
});
