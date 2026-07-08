#!/usr/bin/env node
// Orchestrateur multi-agents asymetrique — boucle fermee pilotee par PLAN.md.
// A lancer depuis la racine du depot : node tools/orchestrator.js
//
// Topologie (4 workers) :
//   1. Cartographe    (Gemini)              -> impact + choix des scripts QA pertinents
//   2. Executeur      (Claude Code CLI)     -> mutation du code, dans un worktree isole
//   3. QA/Lint        (Groq)                -> verdict PASS/FAIL sur les tests OU un lint statique
//   4. Sec-Ops        (Claude Code CLI)     -> revue de securite du diff avant cloture (XSS/auth/RLS)
//   Archiviste        (Mistral)             -> message de commit
//
// Voir agents_config.json pour les cles API (variables d'environnement) et les garde-fous.
// Voir CLAUDE.md pour les regles de projet que l'executeur et le sec-ops doivent respecter.
//
// Deviations assumees par rapport a une spec generique d'orchestrateur :
// - Le worker 1 ne fait pas d'analyse AST litterale (pas de parseur AST integre) : c'est un
//   raisonnement LLM sur l'arborescence du depot + le schema Supabase. Le nommer "AST parser"
//   serait trompeur.
// - Ce depot n'a pas de dossier tests/e2e/*.spec.js : le worker 1 choisit parmi les scripts
//   reels du depot (scripts/qa-*.js). Le champ retourne s'appelle "qa_scripts", pas
//   "e2e_spec_context", pour refleter cette realite plutot que de simuler une convention absente.
// - Le fast-forward merge + push vers main/production reste DESACTIVE PAR DEFAUT (voir
//   agents_config.json: safety.allowAutoPush / allowPushMain). main sert directement le
//   site en production (GitHub Pages) : un merge/push automatique sans relecture humaine
//   est un risque qui ne s'active que si tu mets ces deux flags a true toi-meme.
// - CONFINEMENT (trouve en test reel le 2026-07-08) : `cwd: worktreeDir` sur l'executeur
//   NE SUFFIT PAS a empecher `claude -p` d'ecrire en dehors du worktree -- constate en
//   conditions reelles (l'executeur a modifie CE fichier, en dehors de son worktree,
//   pendant qu'il tournait). `--add-dir` etend l'acces, mais l'absence de restriction
//   n'implique pas un perimetre par defaut fiable en mode non-interactif (-p). Le vrai
//   garde-fou est donc en aval, pas en amont : voir snapshotSentinels/assertSentinelsIntact.

import { readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'agents_config.json'), 'utf8'));

// --- logging "caveman method" : pas de narration, juste statut + metriques ---
function log(status, msg) {
  console.log(`[${new Date().toISOString()}] ${status} ${msg}`);
}

// --- PLAN.md : trouver la premiere case non cochee ---
function firstUncheckedTask() {
  const plan = readFileSync(path.join(ROOT, cfg.planFile), 'utf8');
  const lines = plan.split('\n');
  const idx = lines.findIndex((l) => /^\s*-\s\[ \]\s/.test(l));
  if (idx === -1) return null;
  return { index: idx, text: lines[idx].replace(/^\s*-\s\[ \]\s/, '').trim(), lines };
}

// Ecrit la case cochee dans la copie de PLAN.md DU WORKTREE (pas ROOT) pour
// qu'elle soit committee dans le meme commit que le code — sinon la case
// cochee et le code change finissent desynchronises sur deux branches.
function checkTask(worktreeDir, lines, idx) {
  lines[idx] = lines[idx].replace('- [ ]', '- [x]');
  writeFileSync(path.join(worktreeDir, cfg.planFile), lines.join('\n'));
}

// Meme logique que checkTask : ecrit dans le worktree, pas ROOT.
function updateProgress(worktreeDir, taskText, qaVerdict, secopsVerdict) {
  const entry = `\n## ${new Date().toISOString()} — orchestrateur\n\n**Tache**: ${taskText}\n**QA**: ${qaVerdict}\n**Sec-Ops**: ${secopsVerdict}\n`;
  appendFileSync(path.join(worktreeDir, cfg.progressFile), entry);
}

// --- appel generique a une API chat-completions-like (Groq/Mistral) ---
async function callChatAPI(agentCfg, systemPrompt, userPrompt) {
  return withRetry(async () => {
    const apiKey = process.env[agentCfg.apiKeyEnvVar];
    if (!apiKey) throw new Error(`MISSING_ENV:${agentCfg.apiKeyEnvVar}`);
    const res = await fetch(agentCfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: agentCfg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`API_ERROR:${agentCfg.provider}:${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  });
}

// Retry court avec backoff pour les erreurs transitoires (429/503 constates a
// plusieurs reprises en test reel sur Gemini -- sans ca, un simple hoquet
// reseau fait planter tout le cycle au lieu d'etre absorbe silencieusement).
// Ne retente PAS les erreurs 4xx hors 429 (ex: mauvaise cle, 401/403) : pas
// de raison qu'un retry change le resultat, ce serait juste 2x plus lent a
// echouer pour rien.
async function withRetry(fn, { retries = 2, delayMs = 3000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = /API_ERROR:.*:(429|500|502|503|504)/.test(e.message);
      if (!retryable || i === retries) throw e;
      log('WARN', `retry ${i + 1}/${retries} apres erreur transitoire: ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

async function callGemini(agentCfg, prompt) {
  return withRetry(async () => {
    const apiKey = process.env[agentCfg.apiKeyEnvVar];
    if (!apiKey) throw new Error(`MISSING_ENV:${agentCfg.apiKeyEnvVar}`);
    const url = agentCfg.endpoint.replace('{model}', agentCfg.model) + `?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`API_ERROR:gemini:${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  });
}

// Meme modele que le cartographe (gemini-2.5-flash, multimodal) mais avec des
// images en plus du texte -- utilise par le Worker 5 (QA visuelle).
async function callGeminiVision(agentCfg, prompt, imagePaths) {
  return withRetry(async () => {
    const apiKey = process.env[agentCfg.apiKeyEnvVar];
    if (!apiKey) throw new Error(`MISSING_ENV:${agentCfg.apiKeyEnvVar}`);
    const url = agentCfg.endpoint.replace('{model}', agentCfg.model) + `?key=${apiKey}`;
    const parts = [{ text: prompt }];
    for (const p of imagePaths) {
      const mimeType = p.endsWith('.jpg') || p.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      parts.push({ inlineData: { mimeType, data: readFileSync(p).toString('base64') } });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) throw new Error(`API_ERROR:gemini-vision:${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  });
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON_FOUND');
  return JSON.parse(raw.slice(start, end + 1));
}

// --- Worker 1 : cartographe (Gemini) — impact + choix des scripts QA pertinents ---
async function runCartographe(taskText) {
  const tree = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).slice(0, 50000);
  const schema = existsSync(path.join(ROOT, 'supabase-schema.sql'))
    ? readFileSync(path.join(ROOT, 'supabase-schema.sql'), 'utf8')
    : '';
  const qaScripts = execSync('git ls-files scripts', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /^scripts\/qa-.*\.js$/.test(f));
  const prompt = `Tache: ${taskText}

Arborescence du depot:
${tree}

Schema Supabase:
${schema}

Scripts QA disponibles dans ce depot (il n'y a PAS de dossier tests/e2e -- choisis UNIQUEMENT parmi cette liste, ou un tableau vide si aucun n'est pertinent pour les fichiers cibles) :
${qaScripts.join('\n')}

Reponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte autour :
{"mutations_target": ["chemin/fichier1", "..."], "qa_scripts": ["scripts/qa-xxx.js"]}`;
  const raw = await callGemini(cfg.agents.cartographe, prompt);
  try {
    return extractJSON(raw);
  } catch (e) {
    log('WARN', `cartographe-json-invalide, repli sur qa_scripts vide: ${e.message}`);
    return { mutations_target: [], qa_scripts: [] };
  }
}

// --- Worker 2 : executeur (Claude Code CLI), dans un worktree isole ---
// creerWorktree : appele une seule fois par tache. runExecuteur : appele a
// chaque tentative dans le MEME worktree (self-healing — voir main()).
function creerWorktree() {
  const branch = `orch-${Date.now()}`;
  const worktreeDir = path.join(ROOT, '..', `seba-worktree-${branch}`);
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreeDir, 'HEAD'], { cwd: ROOT, stdio: 'inherit' });
  // node_modules n'est pas suivi par git (gitignore) donc absent du nouveau
  // worktree par defaut -- jonction (pas de copie, pas de droits admin requis
  // sous Windows) vers le node_modules de ROOT pour que les scripts QA
  // (puppeteer-core) resolvent leurs dependances depuis le worktree.
  try {
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(worktreeDir, 'node_modules'), 'junction');
  } catch (e) {
    log('WARN', `node_modules-link-echoue:${e.message}`);
  }
  return { branch, worktreeDir };
}

// `git worktree remove` ne sait pas nettoyer la jonction node_modules (pas
// suivie par git) -- sans ce retrait explicite, le dossier parent survit
// vide-mais-non-vide indefiniment (constate : 8 dossiers residuels apres les
// tests a blanc de cette session). On la retire d'abord, dans TOUS les cas
// (succes, echec, arret manuel), pour que le worktree parte vraiment.
function removeWorktree(worktreeDir) {
  try { rmSync(path.join(worktreeDir, 'node_modules'), { force: true }); } catch {}
  try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' }); } catch {}
  try { rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
}

// Fichiers sentinelles verifies avant/apres chaque appel executeur -- si l'un
// d'eux change dans ROOT (pas dans le worktree), c'est une sortie de perimetre,
// pas un echec de tache normal. Volontairement une liste courte et ciblee
// (fichiers de pilotage/config), pas tout le depot (trop lent, hors propos).
const SENTINEL_FILES = ['tools/orchestrator.js', 'agents_config.json', 'CLAUDE.md', 'package.json', '.env'];

function hashFile(p) {
  if (!existsSync(p)) return null;
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function snapshotSentinels() {
  return Object.fromEntries(SENTINEL_FILES.map((f) => [f, hashFile(path.join(ROOT, f))]));
}
// Si une sentinelle a change dans ROOT, on la restaure depuis git (fichiers
// suivis) et on leve une erreur distincte -- ceci n'est PAS une simple
// QA_FAILED a corriger, c'est une sortie de perimetre a signaler tel quel.
function assertSentinelsIntact(before) {
  const after = snapshotSentinels();
  const violated = SENTINEL_FILES.filter((f) => before[f] !== after[f]);
  if (!violated.length) return;
  for (const f of violated) {
    if (f === '.env') continue; // jamais suivi par git, rien a restaurer depuis un commit
    try { execFileSync('git', ['checkout', '--', f], { cwd: ROOT, stdio: 'ignore' }); } catch {}
  }
  throw new Error(`PERIMETRE_VIOLE:${violated.join(',')}`);
}

function runExecuteur(worktreeDir, taskText, cartographie, priorFailureLog) {
  const instructions = priorFailureLog
    ? `Tentative de correction. Tache PLAN.md: ${taskText}\n\nCartographie: ${JSON.stringify(cartographie)}\n\nLe cycle precedent a echoue avec ce log brut, corrige le probleme specifique qu'il decrit, en modifiant UNIQUEMENT des fichiers a l'interieur de ce worktree (jamais un chemin en dehors, jamais l'orchestrateur lui-meme ou sa config) :\n${priorFailureLog.slice(0, 6000)}\n\nRespecte CLAUDE.md a la racine du depot. Ne modifie AUCUN fichier de test (${cfg.safety.protectedTestGlobs.join(', ')}).`
    : `Tache PLAN.md: ${taskText}\n\nFichiers cibles identifies par l'agent cartographe: ${JSON.stringify(cartographie)}\n\nModifie UNIQUEMENT des fichiers a l'interieur de ce worktree. Respecte CLAUDE.md a la racine du depot. Ne modifie AUCUN fichier de test (${cfg.safety.protectedTestGlobs.join(', ')}).`;
  execFileSync(
    cfg.agents.executeur.command,
    ['-p', instructions, '--allowedTools', 'Read Edit Write Grep Glob'],
    { cwd: worktreeDir, stdio: 'inherit' }
  );
}

function assertTestFilesUntouched(worktreeDir) {
  const diff = execSync('git diff --name-only HEAD', { cwd: worktreeDir, encoding: 'utf8' });
  const touched = diff.split('\n').filter(Boolean);
  const globs = cfg.safety.protectedTestGlobs.map((g) => new RegExp(g.replace('**', '.*').replace('*', '[^/]*')));
  const violated = touched.filter((f) => globs.some((rx) => rx.test(f)));
  if (violated.length) throw new Error(`TEST_FILE_MODIFIED:${violated.join(',')}`);
}

// --- Worker 3 : QA/Lint (Groq) — branchement conditionnel selon qa_scripts ---
// Si des scripts QA pertinents ont ete identifies par le cartographe : on les
// execute (rendu Puppeteer reel). Sinon on court-circuite le moteur de rendu
// UI (evite les faux positifs de timeout sur une tache sans rapport) et on
// bascule sur un lint statique : `node --check` pour le JS touche, et une
// verification structurelle grossiere (balises <script> equilibrees) pour le
// HTML touche -- ce n'est PAS un vrai linter HTML, juste un filet minimal.
async function runQA(worktreeDir, cartographie) {
  const qaScripts = cartographie.qa_scripts || [];

  if (!qaScripts.length) {
    // Pas de rendu UI, pas d'interpretation LLM : un check statique est
    // deterministe (node --check reussit ou non), donc le verdict est le
    // booleen lui-meme -- pas besoin (et pas souhaitable) qu'un LLM
    // re-interprete un resultat deja certain, ca ne peut qu'introduire du
    // bruit sur un cas sans ambiguite.
    let output = 'AUCUN SCRIPT QA PERTINENT -- bascule sur lint statique (rendu UI court-circuite).\n';
    let passed = true;
    const touched = execSync('git diff --name-only HEAD', { cwd: worktreeDir, encoding: 'utf8' }).split('\n').filter(Boolean);
    let checked = 0;
    for (const f of touched) {
      const abs = path.join(worktreeDir, f);
      if (!existsSync(abs)) continue;
      if (f.endsWith('.js')) {
        checked++;
        // ESLint (eslint.config.js) plutot que node --check seul : detecte
        // aussi les vraies erreurs (no-undef, redeclarations...), pas
        // seulement les fautes de syntaxe. Les warnings (ex: fonctions
        // exposees globalement, normal sans bundler) ne font PAS echouer
        // le gate -- seul un exit code non-nul (erreurs) le fait.
        try {
          // Point d'entree JS d'ESLint via `node`, pas le shim .bin/*.cmd :
          // sous Windows, execFileSync ne peut pas lancer un .cmd sans
          // shell:true (EINVAL constate en test reel), alors que node est un
          // binaire natif -- aucune des deux plateformes n'a ce probleme ici.
          const eslintJs = path.join(worktreeDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
          execFileSync('node', [eslintJs, abs], { cwd: worktreeDir });
          output += `OK eslint ${f}\n`;
        } catch (e) {
          passed = false;
          output += `FAIL eslint ${f}:\n${String(e.stdout || e.message)}\n`;
        }
      } else if (f.endsWith('.html')) {
        checked++;
        const src = readFileSync(abs, 'utf8');
        const opens = (src.match(/<script\b[^>]*>/g) || []).length;
        const closes = (src.match(/<\/script>/g) || []).length;
        if (opens !== closes) { passed = false; output += `FAIL balises <script> desequilibrees dans ${f} (${opens} ouvertures, ${closes} fermetures)\n`; }
        else output += `OK balises <script> equilibrees ${f}\n`;
      }
    }
    output += checked === 0
      ? 'Aucun fichier JS/HTML modifie (probablement Markdown/JSON/config) -- rien a verifier statiquement.\n'
      : '';
    output += `RESULTAT STATIQUE: ${passed ? 'PASS' : 'FAIL'}\n`;
    return { verdict: passed ? 'PASS' : 'FAIL', output };
  }

  // Scripts QA reels (Puppeteer) : sortie non structuree, l'interpretation
  // Groq apporte une vraie valeur ici (juger un log texte libre).
  let output = '';
  let passed = true;
  for (const script of qaScripts) {
    try {
      output += execSync(`node ${script} --target=local --viewport=desktop`, { cwd: worktreeDir, encoding: 'utf8' });
    } catch (e) {
      passed = false;
      output += String(e.stdout || e.message);
    }
  }
  let verdict = passed ? 'PASS' : 'FAIL';
  try {
    const interpretation = await callChatAPI(
      cfg.agents.qa,
      'Tu analyses des logs de tests QA (Puppeteer). Reponds uniquement PASS ou FAIL suivi d\'une ligne de raison courte.',
      output.slice(0, 20000)
    );
    if (/^FAIL/i.test(interpretation.trim())) verdict = 'FAIL';
  } catch (e) {
    log('WARN', `groq-interpretation-skippee:${e.message}`);
  }
  return { verdict, output };
}

// --- Worker 5 : QA visuelle (Gemini, multimodal) — conformite esthetique
// Tactical Dark sur les captures d'ecran produites par les scripts QA.
// N'existe que si des captures ont ete generees (donc si qa_scripts a tourne
// -- pas de rendu = pas de capture = SKIP, pas de verdict invente). Utilise
// CLAUDE.md comme reference de tokens plutot que de dupliquer les valeurs
// dans agents_config.json (une seule source de verite si la charte change). */
async function runVisualQA(worktreeDir) {
  const shotDir = path.join(worktreeDir, 'docs', 'audit-screenshots');
  if (!existsSync(shotDir)) return { verdict: 'SKIP', output: 'aucune capture ecran generee, rien a auditer visuellement' };

  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(png|jpe?g)$/i.test(name)) entries.push({ full, mtime: st.mtimeMs });
    }
  };
  walk(shotDir);
  if (!entries.length) return { verdict: 'SKIP', output: 'dossier de captures vide' };
  const recent = entries.sort((a, b) => b.mtime - a.mtime).slice(0, 2).map((e) => e.full);

  const charte = existsSync(path.join(worktreeDir, 'CLAUDE.md')) ? readFileSync(path.join(worktreeDir, 'CLAUDE.md'), 'utf8') : '';
  const prompt = `Voici la charte visuelle du projet (extrait de CLAUDE.md) :\n${charte}\n\nAnalyse les captures d'ecran jointes. Verifie la conformite aux tokens Tactical Dark (couleurs, typographie monospace des chiffres) SEULEMENT si la page auditee est dans le perimetre concerne (dashboard.html/widgets.js) -- ne penalise pas une autre page qui a legitimement un theme different. Signale aussi tout probleme esthetique evident (chevauchement, texte illisible, alignement casse) independamment de la charte. Termine ta reponse par exactement une ligne "VISUALQA: PASS" ou "VISUALQA: FAIL <raison courte>".`;

  try {
    const out = await callGeminiVision(cfg.agents.visualqa, prompt, recent);
    const verdict = /VISUALQA:\s*PASS/i.test(out) ? 'PASS' : 'FAIL';
    return { verdict, output: out };
  } catch (e) {
    log('WARN', `visualqa-echouee:${e.message} -- ignoree, ne bloque pas la tache`);
    return { verdict: 'SKIP', output: `visualqa-indisponible:${e.message}` };
  }
}

// --- Worker 4 : Sec-Ops / Agent Strix (Claude Code CLI, second appel distinct,
// lecture seule) — revue du diff avant cloture : XSS, auth, RLS Supabase. ---
function runSecOps(worktreeDir) {
  const diff = execSync('git diff HEAD', { cwd: worktreeDir, encoding: 'utf8' }).slice(0, 30000);
  if (!diff.trim()) return { verdict: 'PASS', output: 'diff vide, rien a auditer' };
  const instructions = `Revue de securite (SAST) du diff ci-dessous. Cherche specifiquement : injections XSS (innerHTML/template non echappes), regressions d'authentification, violations RLS Supabase (policies auth.uid()=user_id contournees ou absentes sur une nouvelle table/colonne). Termine ta reponse par exactement une ligne "STRIX: PASS" ou "STRIX: FAIL <raison courte>".\n\nDiff:\n${diff}`;
  let out = '';
  try {
    out = execFileSync(
      cfg.agents.secops.command,
      ['-p', instructions, '--allowedTools', 'Read Grep Glob'],
      { cwd: worktreeDir, encoding: 'utf8' }
    );
  } catch (e) {
    return { verdict: 'FAIL', output: `secops-execution-echouee:${e.message}` };
  }
  const verdict = /STRIX:\s*PASS/i.test(out) ? 'PASS' : 'FAIL';
  return { verdict, output: out };
}

// --- Archiviste (Mistral) : message de commit, commit final dans le worktree ---
async function runArchiviste(taskText, qaOutput, worktreeDir) {
  let commitMsg;
  try {
    commitMsg = await callChatAPI(
      cfg.agents.archiviste,
      'Genere un message de commit git en francais, format "type: description courte", pas de ponctuation finale, une seule ligne.',
      `Tache: ${taskText}\nResultat QA: ${qaOutput.slice(0, 2000)}`
    );
    commitMsg = commitMsg.trim().split('\n')[0];
  } catch (e) {
    commitMsg = `chore: ${taskText}`;
    log('WARN', `mistral-commit-msg-fallback:${e.message}`);
  }
  execFileSync('git', ['add', '-A'], { cwd: worktreeDir });
  execFileSync('git', ['commit', '-m', commitMsg], { cwd: worktreeDir, stdio: 'ignore' });
  return commitMsg;
}

// --- disjoncteur d'urgence : gel + dump + ROLLBACK du worktree/branche ---
function crashAndFreeze(taskText, attempts, lastError, worktreeDir, branch) {
  const entry = `CRASH ${new Date().toISOString()}\nTache: ${taskText}\nEchecs consecutifs: ${attempts}\nDerniere erreur: ${lastError}\n`;
  writeFileSync(path.join(ROOT, cfg.crashLogFile), entry, { flag: 'a' });
  // Rollback : rien de valide n'a ete produit (aucun commit archiviste n'a eu
  // lieu avant le disjoncteur) -- on supprime le worktree ET la branche
  // jetable pour ne laisser aucun residu dans le depot local.
  if (worktreeDir) removeWorktree(worktreeDir);
  if (branch) { try { execFileSync('git', ['branch', '-D', branch], { cwd: ROOT, stdio: 'ignore' }); } catch {} }
  process.stdout.write('\x07'); // signal sonore terminal
  log('FROZEN', `circuit-breaker apres ${attempts} echecs — voir ${cfg.crashLogFile} — rollback effectue — controle rendu a l'operateur humain`);
  process.exit(1);
}

// --- deploiement : 3 paliers, du plus sur au plus risque (voir CLAUDE.md) ---
// 1. Rien (tout local)                          -- allowAutoPR=false ET allowPushMain=false
// 2. Pull Request reelle (gh pr create)         -- allowAutoPR=true (defaut), revue humaine via GitHub
// 3. Fast-forward merge + push direct sur main  -- allowPushMain=true (jamais par defaut)
// Le palier 2 est le comportement par defaut demande le 2026-07-08 : jamais
// plus "silencieusement local uniquement" sans que ce soit un choix explicite
// (allowAutoPR=false), mais jamais de merge production sans le flag dedie.
function ghAvailable() {
  try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function maybeDeploy(worktreeDir, branch, commitMsg, taskText, verdicts) {
  const allowPR = process.env[cfg.safety.allowAutoPREnvVar] === 'false' ? false : (cfg.safety.allowAutoPR ?? true);
  const allowMain = cfg.safety.allowPushMain || process.env[cfg.safety.allowPushMainEnvVar] === 'true';

  if (!allowPR && !allowMain) {
    log('SKIP', `deploiement desactive (allowAutoPR=false) — commit "${commitMsg}" reste local sur la branche "${branch}", revue humaine requise`);
    return;
  }

  if (!allowMain) {
    execFileSync('git', ['push', '-u', 'origin', branch], { cwd: worktreeDir, stdio: 'inherit' });
    if (!ghAvailable()) {
      log('SKIP', `gh CLI absent ou non authentifie — branche "${branch}" poussee sur origin, ouvre la PR manuellement sur GitHub`);
      return;
    }
    const body = `Tache : ${taskText}\n\nVerdicts automatiques :\n- QA : ${verdicts.qa}\n- QA visuelle : ${verdicts.visualqa}\n- Sec-Ops (Strix) : ${verdicts.secops}\n\nGenere automatiquement par tools/orchestrator.js -- revue humaine requise avant merge.`;
    try {
      const prUrl = execFileSync('gh', ['pr', 'create', '--title', commitMsg, '--body', body, '--base', 'main', '--head', branch], { cwd: worktreeDir, encoding: 'utf8' }).trim();
      log('OK', `Pull Request ouverte : ${prUrl}`);
    } catch (e) {
      log('WARN', `gh pr create echoue (${e.message}) — branche "${branch}" quand meme poussee sur origin, ouvre la PR manuellement`);
    }
    return;
  }

  // Fast-forward merge + push vers main -- SEULEMENT si allowPushMain ET si
  // ROOT est propre (jamais de merge sur un working tree sale, on ne veut
  // pas ecraser un travail humain en cours).
  const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) {
    log('SKIP', 'merge vers main annule : working tree principal non propre (changements non commites presents) — revue humaine requise');
    return;
  }
  const currentBranch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['checkout', 'main'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['merge', '--ff-only', branch], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' });
    log('OK', `fast-forward merge + push origin/main — commit "${commitMsg}"`);
  } finally {
    execFileSync('git', ['checkout', currentBranch], { cwd: ROOT, stdio: 'inherit' });
  }
}

// --- boucle principale ---
async function main() {
  const task = firstUncheckedTask();
  if (!task) {
    log('OK', 'aucune tache non cochee dans PLAN.md — rien a faire');
    return;
  }
  log('OK', `tache selectionnee: ${task.text}`);

  const cartographie = await runCartographe(task.text);
  log('OK', `cartographie recue: cibles=${(cartographie.mutations_target || []).join(',') || '?'} qa_scripts=${(cartographie.qa_scripts || []).join(',') || '(aucun, lint statique)'}`);

  const { branch, worktreeDir } = creerWorktree();
  let attempts = 0;
  let lastError = '';
  let lastQaOutput = '';

  while (attempts < cfg.safety.maxConsecutiveFailures) {
    attempts += 1;
    try {
      log('OK', `cycle ${attempts}/${cfg.safety.maxConsecutiveFailures}`);

      const sentinelsBefore = snapshotSentinels();
      runExecuteur(worktreeDir, task.text, cartographie, attempts > 1 ? lastQaOutput : null);
      assertSentinelsIntact(sentinelsBefore);
      assertTestFilesUntouched(worktreeDir);
      log('OK', 'execution terminee, fichiers de test intacts, perimetre respecte');

      const { verdict, output } = await runQA(worktreeDir, cartographie);
      lastQaOutput = output;
      if (verdict === 'FAIL') throw new Error('QA_FAILED');
      log('OK', 'QA: PASS');

      const visualqa = await runVisualQA(worktreeDir);
      if (visualqa.verdict === 'FAIL') { lastQaOutput = visualqa.output; throw new Error('VISUALQA_FAILED'); }
      log(visualqa.verdict === 'SKIP' ? 'SKIP' : 'OK', `QA visuelle (Worker 5): ${visualqa.verdict}`);

      const secops = runSecOps(worktreeDir);
      if (secops.verdict === 'FAIL') { lastQaOutput = secops.output; throw new Error('STRIX_FAILED'); }
      log('OK', 'Sec-Ops (Strix): PASS');

      // PLAN.md/PROGRESS.md ecrits AVANT le commit de l'archiviste, dans le
      // worktree, pour finir dans le MEME commit que le code.
      updateProgress(worktreeDir, task.text, verdict, secops.verdict);
      checkTask(worktreeDir, task.lines, task.index);

      const commitMsg = await runArchiviste(task.text, output, worktreeDir);

      maybeDeploy(worktreeDir, branch, commitMsg, task.text, { qa: verdict, visualqa: visualqa.verdict, secops: secops.verdict });

      removeWorktree(worktreeDir);
      log('OK', `cycle termine — commit "${commitMsg}" sur la branche "${branch}" (worktree supprime). /clear recommande avant la tache suivante.`);
      return;
    } catch (e) {
      lastError = e.message;
      if (lastError.startsWith('PERIMETRE_VIOLE')) {
        // Sortie de perimetre = arret immediat, pas de nouvelle tentative
        // (retenter donnerait juste une nouvelle chance de sortir a nouveau).
        log('SECURITY', `${lastError} — sentinelles restaurees depuis git, arret immediat sans retry`);
        crashAndFreeze(task.text, attempts, lastError, worktreeDir, branch);
      }
      log('RETRYING', `echec cycle ${attempts}: ${lastError}`);
    }
  }
  crashAndFreeze(task.text, attempts, lastError, worktreeDir, branch);
}

// Note sur /clear : c'est une commande interactive de la CLI Claude Code, non
// invocable depuis un script externe. Cet orchestrateur obtient un effet
// equivalent en relancant un nouveau processus `claude -p` par tentative
// (runExecuteur), qui ne porte aucun contexte des cycles precedents au-dela
// du log d'erreur explicitement reinjecte pour l'auto-correction.

main().catch((e) => {
  log('FAILED', `erreur non geree: ${e.message}`);
  process.exit(1);
});
