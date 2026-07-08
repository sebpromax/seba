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

import { readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
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
}

async function callGemini(agentCfg, prompt) {
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

function runExecuteur(worktreeDir, taskText, cartographie, priorFailureLog) {
  const instructions = priorFailureLog
    ? `Tentative de correction. Tache PLAN.md: ${taskText}\n\nCartographie: ${JSON.stringify(cartographie)}\n\nLe cycle precedent a echoue avec ce log brut, corrige le probleme specifique qu'il decrit (n'invente pas un autre changement) :\n${priorFailureLog.slice(0, 6000)}\n\nRespecte CLAUDE.md a la racine du depot. Ne modifie AUCUN fichier de test (${cfg.safety.protectedTestGlobs.join(', ')}).`
    : `Tache PLAN.md: ${taskText}\n\nFichiers cibles identifies par l'agent cartographe: ${JSON.stringify(cartographie)}\n\nRespecte CLAUDE.md a la racine du depot. Ne modifie AUCUN fichier de test (${cfg.safety.protectedTestGlobs.join(', ')}).`;
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
        try {
          execFileSync('node', ['--check', abs]);
          output += `OK node --check ${f}\n`;
        } catch (e) {
          passed = false;
          output += `FAIL node --check ${f}: ${e.message}\n`;
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
  if (worktreeDir) { try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' }); } catch {} }
  if (branch) { try { execFileSync('git', ['branch', '-D', branch], { cwd: ROOT, stdio: 'ignore' }); } catch {} }
  process.stdout.write('\x07'); // signal sonore terminal
  log('FROZEN', `circuit-breaker apres ${attempts} echecs — voir ${cfg.crashLogFile} — rollback effectue — controle rendu a l'operateur humain`);
  process.exit(1);
}

// --- deploiement, double gate explicite (voir CLAUDE.md) ---
function maybeDeploy(worktreeDir, branch, commitMsg) {
  const allowPush = cfg.safety.allowAutoPush || process.env[cfg.safety.allowAutoPushEnvVar] === 'true';
  const allowMain = cfg.safety.allowPushMain || process.env[cfg.safety.allowPushMainEnvVar] === 'true';
  if (!allowPush) {
    log('SKIP', `deploiement desactive (allowAutoPush=false) — commit "${commitMsg}" reste local sur la branche "${branch}", revue humaine requise`);
    return;
  }
  if (!allowMain) {
    execFileSync('git', ['push', 'origin', branch], { cwd: worktreeDir, stdio: 'inherit' });
    log('OK', `push origin/${branch} (allowPushMain=false, pas de merge vers main)`);
    return;
  }
  // Fast-forward merge + push vers main -- SEULEMENT si les deux flags sont
  // actives ET si ROOT est propre (jamais de merge sur un working tree sale,
  // on ne veut pas ecraser un travail humain en cours).
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

      runExecuteur(worktreeDir, task.text, cartographie, attempts > 1 ? lastQaOutput : null);
      assertTestFilesUntouched(worktreeDir);
      log('OK', 'execution terminee, fichiers de test intacts');

      const { verdict, output } = await runQA(worktreeDir, cartographie);
      lastQaOutput = output;
      if (verdict === 'FAIL') throw new Error('QA_FAILED');
      log('OK', 'QA: PASS');

      const secops = runSecOps(worktreeDir);
      if (secops.verdict === 'FAIL') { lastQaOutput = secops.output; throw new Error('STRIX_FAILED'); }
      log('OK', 'Sec-Ops (Strix): PASS');

      // PLAN.md/PROGRESS.md ecrits AVANT le commit de l'archiviste, dans le
      // worktree, pour finir dans le MEME commit que le code.
      updateProgress(worktreeDir, task.text, verdict, secops.verdict);
      checkTask(worktreeDir, task.lines, task.index);

      const commitMsg = await runArchiviste(task.text, output, worktreeDir);

      maybeDeploy(worktreeDir, branch, commitMsg);

      execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' });
      log('OK', `cycle termine — commit "${commitMsg}" sur la branche "${branch}" (worktree supprime). /clear recommande avant la tache suivante.`);
      return;
    } catch (e) {
      lastError = e.message;
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
