#!/usr/bin/env node
// Chaos Monkey — audit red-team de docs-backend.md et supabase-schema.sql.
// Ne modifie jamais le code : produit un rapport (console + CHAOS-MONKEY-REPORT.md)
// pour revue humaine, jamais d'action automatique sur ce que le rapport trouve.
//
// Usage :
//   node tools/chaos-monkey.js              -> audit LOCAL (Claude), rien n'est envoye
//   node --env-file=.env tools/chaos-monkey.js --allow-external
//                                            -> en plus, envoie docs-backend.md +
//                                               supabase-schema.sql a Mistral/Groq/Gemini
//                                               pour un second avis independant
//
// --allow-external est DESACTIVE PAR DEFAUT : ces 2 fichiers documentent
// l'architecture backend et les policies RLS (securite d'acces aux donnees).
// Le classifieur de securite de Claude Code bloque cet envoi par defaut
// (categorise comme partage de donnees internes vers un tiers) -- decision
// explicitement laissee a l'operateur humain, pas un choix par defaut de ce
// script. Voir CLAUDE.md / conversation du 2026-07-08 pour le contexte.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const allowExternal = process.argv.includes('--allow-external');

function log(status, msg) { console.log(`[${new Date().toISOString()}] ${status} ${msg}`); }

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('MISSING_ENV:GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`API_ERROR:gemini:${res.status}:${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(reponse vide)';
}

async function callChatAPI(endpoint, apiKey, model, systemPrompt, userPrompt) {
  if (!apiKey) throw new Error(`MISSING_ENV pour ${model}`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API_ERROR:${model}:${res.status}:${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(reponse vide)';
}

function readContext() {
  return {
    backendDoc: readFileSync(path.join(ROOT, 'docs-backend.md'), 'utf8'),
    schema: readFileSync(path.join(ROOT, 'supabase-schema.sql'), 'utf8'),
  };
}

async function runExternalAudit(ctx) {
  const CONTEXT = `===== docs-backend.md =====\n${ctx.backendDoc}\n\n===== supabase-schema.sql =====\n${ctx.schema}`;

  const frustratedUserPrompt = `Tu incarnes un UTILISATEUR FRUSTRE de ce produit (patron d'une petite entreprise de menage/conciergerie, pas technique). Cherche des frictions reelles d'usage (offline, changement d'appareil, perte de donnees, cas limites) -- pas de securite/RLS, un autre agent s'en charge. Francais, liste a puces, max 10 points, une phrase chacun. Termine par "NB_POINTS: <chiffre>".\n\n${CONTEXT}`;
  const attackerPrompt = `Tu incarnes un ATTAQUANT de ce backend (Supabase Postgres + Auth + RLS). Cherche des failles logiques/permissions precises (policy manquante/incorrecte, incoherence doc vs schema reel, exemple de code dangereux si copie tel quel). Francais, liste a puces, max 10 points, une phrase chacun, nom de table/policy si pertinent. Termine par "NB_POINTS: <chiffre>".\n\n${CONTEXT}`;

  const [userFindings, attackerFindings] = await Promise.all([
    callChatAPI('https://api.mistral.ai/v1/chat/completions', process.env.MISTRAL_API_KEY, 'mistral-small-latest', 'Tu es un testeur UX impitoyable mais constructif.', frustratedUserPrompt)
      .catch((e) => `ERREUR MISTRAL: ${e.message}`),
    callChatAPI('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, 'llama-3.3-70b-versatile', 'Tu es un auditeur de securite (pentester) rigoureux.', attackerPrompt)
      .catch((e) => `ERREUR GROQ: ${e.message}`),
  ]);
  log('OK', 'Mistral (utilisateur frustre) et Groq (attaquant) ont repondu');

  const validationPrompt = `Voici deux audits independants du backend de "Seba". VALIDE ou REJETE chaque point (une ligne chacun : "VALIDE" si actionnable au vu du contexte, "REJETE: <raison>" si bruit/deja corrige/hors-sujet).\n\n--- Audit "utilisateur frustre" (Mistral) ---\n${userFindings}\n\n--- Audit "attaquant" (Groq) ---\n${attackerFindings}\n\n--- Contexte ---\n${CONTEXT}`;
  const validation = await callGemini(validationPrompt).catch((e) => `ERREUR GEMINI: ${e.message}`);
  log('OK', 'Gemini a valide/rejete les points');

  return { userFindings, attackerFindings, validation };
}

// Audit local (aucun appel reseau) : les points ci-dessous sont une analyse
// deja effectuee (par Claude, dans la conversation du 2026-07-08) des memes
// 2 fichiers, servant de base par defaut quand --allow-external n'est pas
// utilise. A relire/completer manuellement si le schema ou la doc changent
// significativement -- ce n'est pas regenere dynamiquement.
const LOCAL_AUDIT = {
  userFindings: `- Aucun avertissement produit visible (dans l'app elle-meme, pas juste la doc technique) avant qu'un utilisateur change d'appareil/navigateur sans avoir configure Supabase -> perte de donnees silencieuse possible.
- Le debounce de sauvegarde de 800ms vers Supabase : fermer l'onglet ou eteindre l'appareil dans cette fenetre peut perdre la derniere ecriture sans avertissement.
- Aucune resolution de conflit documentee si le meme compte est utilise simultanement sur 2 appareils : "le cache local fait foi, re-push a la prochaine ecriture" = dernier ecrivain gagne silencieusement, sans prevenir l'utilisateur qu'il vient d'ecraser une modification faite ailleurs.
- La limite "les donnees vivent sur l'appareil" (mode local sans Supabase) est documentee pour le developpeur mais pas necessairement communiquee clairement a l'utilisateur final au moment ou ca compte (avant qu'il perde des donnees, pas apres).
NB_POINTS: 4`,
  attackerFindings: `- docs-backend.md section "2. Creer la table" contient un exemple SQL PROTOTYPE avec des policies permissives (\`using (true)\`) -- un developpeur qui copie CET exemple litteralement (au lieu du supabase-schema.sql reel, plus strict) cree des policies non securisees ou n'importe qui connaissant l'URL Supabase peut lire/ecrire toutes les donnees de tous les comptes. L'avertissement juste apres attenue le risque mais le code copiable reste dangereux tel quel.
- Table \`api_usage\` : RLS active sans aucune policy -- comportement voulu (deny-all sauf service_role) mais non explicite comme un choix intentionnel dans le SQL lui-meme (juste dans un commentaire) ; un futur dev pourrait "corriger" cet "oubli" en ajoutant une policy trop permissive.
- \`seba_state.account\` (cle texte, slug d'entreprise) et l'isolation reelle par \`user_id\` sont deux mecanismes qui se chevauchent conceptuellement : le RLS protege bien via \`user_id\`, mais si \`account\` est un jour utilise ailleurs sans filtrer aussi par \`user_id\`, collision possible entre deux comptes ayant choisi le meme slug.
- Cle anon Supabase exposee cote navigateur "par design" (correctement documente) mais aucune mention de rate-limiting cote Supabase pour limiter un usage abusif au-dela de ce que RLS bloque deja.
NB_POINTS: 4`,
  validation: `Analyse locale (pas de second avis externe) -- a considerer comme un premier passage, pas une validation croisee. Le point le plus actionnable : corriger ou retirer l'exemple SQL permissif de docs-backend.md (section 2) pour qu'il reflete directement les policies deja durcies de supabase-schema.sql, afin qu'aucun copier-coller futur ne puisse regresser vers des policies "using (true)".`,
};

async function main() {
  const ctx = readContext();

  if (!allowExternal) {
    log('OK', 'mode local (Claude) -- aucun appel reseau, aucune donnee envoyee. Ajouter --allow-external pour un second avis Mistral/Groq/Gemini (nécessite un accord explicite, voir en-tête du fichier).');
  } else {
    log('OK', "--allow-external : envoi de docs-backend.md/supabase-schema.sql a Mistral/Groq/Gemini");
  }

  const { userFindings, attackerFindings, validation } = allowExternal ? await runExternalAudit(ctx) : LOCAL_AUDIT;

  const report = `# Rapport Chaos Monkey — ${new Date().toISOString()}

Mode : ${allowExternal ? 'externe (Mistral/Groq/Gemini)' : 'local (Claude, aucune donnee envoyee)'}.
Ce rapport ne modifie AUCUN code — revue humaine/Claude requise avant toute action.

## Audit "utilisateur frustre"

${userFindings}

## Audit "attaquant"

${attackerFindings}

## Validation

${validation}
`;

  writeFileSync(path.join(ROOT, 'CHAOS-MONKEY-REPORT.md'), report);
  console.log('\n' + report);
  log('OK', 'rapport ecrit dans CHAOS-MONKEY-REPORT.md');
}

main().catch((e) => {
  log('FAILED', `erreur non geree: ${e.message}`);
  process.exit(1);
});
