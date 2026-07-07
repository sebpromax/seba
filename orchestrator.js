#!/usr/bin/env node
// Orchestrateur multi-agents asymetrique — boucle fermee pilotee par PLAN.md.
// Roles : Gemini (cartographe) -> Claude Code CLI (executeur) -> Groq (QA) -> Mistral (archiviste).
// Voir agents_config.json pour les cles API (variables d'environnement) et les garde-fous.
// Voir CLAUDE.md pour les regles de projet que l'executeur doit respecter.

import { readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'agents_config.json'), 'utf8'));

// --- logging "caveman method" : pas de narration, juste statut + metriques ---
function log(status, msg) {
  const line = `[${new Date().toISOString()}] ${status} ${msg}`;
  console.log(line);
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

// --- Gemini a un format de requete different (generateContent) ---
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

// --- Agent 1 : cartographe (Gemini) ---
async function runCartographe(taskText) {
  const tree = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).slice(0, 50000);
  const schema = existsSync(path.join(ROOT, 'supabase-schema.sql'))
    ? readFileSync(path.join(ROOT, 'supabase-schema.sql'), 'utf8')
    : '';
  const prompt = `Tache: ${taskText}\n\nArborescence du depot:\n${tree}\n\nSchema Supabase:\n${schema}\n\nListe UNIQUEMENT les fichiers a ouvrir pour realiser cette tache, un par ligne, avec une justification courte.`;
  return callGemini(cfg.agents.cartographe, prompt);
}

// --- Agent 2 : executeur (Claude Code CLI), dans un worktree isole ---
function runExecuteur(taskText, cartographie) {
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
  try {
    const instructions = `Tache PLAN.md: ${taskText}\n\nFichiers cibles identifies par l'agent cartographe:\n${cartographie}\n\nRespecte CLAUDE.md a la racine du depot. Ne modifie AUCUN fichier de test (${cfg.safety.protectedTestGlobs.join(', ')}).`;
    execFileSync(
      cfg.agents.executeur.command,
      ['-p', instructions, '--allowedTools', 'Read Edit Write Grep Glob'],
      { cwd: worktreeDir, stdio: 'inherit' }
    );
    return worktreeDir;
  } catch (e) {
    execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' });
    throw e;
  }
}

function assertTestFilesUntouched(worktreeDir) {
  const diff = execSync('git diff --name-only HEAD', { cwd: worktreeDir, encoding: 'utf8' });
  const touched = diff.split('\n').filter(Boolean);
  const globs = cfg.safety.protectedTestGlobs.map((g) => new RegExp(g.replace('**', '.*').replace('*', '[^/]*')));
  const violated = touched.filter((f) => globs.some((rx) => rx.test(f)));
  if (violated.length) throw new Error(`TEST_FILE_MODIFIED:${violated.join(',')}`);
}

// --- Agent 3 : QA (Groq interprete, Puppeteer execute reellement) ---
async function runQA(worktreeDir) {
  let output = '';
  let passed = true;
  for (const cmd of cfg.agents.qa.localCommands) {
    try {
      output += execSync(cmd, { cwd: worktreeDir, encoding: 'utf8' });
    } catch (e) {
      passed = false;
      output += String(e.stdout || e.message);
    }
  }
  let verdict = passed ? 'PASS' : 'FAIL';
  try {
    const interpretation = await callChatAPI(
      cfg.agents.qa,
      'Tu analyses des logs de tests QA. Reponds uniquement PASS ou FAIL suivi d\'une ligne de raison courte.',
      output.slice(0, 20000)
    );
    if (/^FAIL/i.test(interpretation.trim())) verdict = 'FAIL';
  } catch (e) {
    log('WARN', `groq-interpretation-skipped:${e.message}`);
  }
  return { verdict, output };
}

// --- Agent 4 : archiviste (Mistral) ---
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

// Meme logique que checkTask : ecrit dans le worktree, pas ROOT.
function updateProgress(worktreeDir, taskText, qaVerdict) {
  const entry = `\n## ${new Date().toISOString()} — orchestrateur\n\n**Tache**: ${taskText}\n**QA**: ${qaVerdict}\n`;
  appendFileSync(path.join(worktreeDir, cfg.progressFile), entry);
}

// --- disjoncteur d'urgence ---
function crashAndFreeze(taskText, attempts, lastError) {
  const log_ = `CRASH ${new Date().toISOString()}\nTache: ${taskText}\nEchecs consecutifs: ${attempts}\nDerniere erreur: ${lastError}\n`;
  writeFileSync(path.join(ROOT, cfg.crashLogFile), log_, { flag: 'a' });
  process.stdout.write('\x07'); // signal sonore terminal
  log('FROZEN', `circuit-breaker apres ${attempts} echecs — voir ${cfg.crashLogFile} — controle rendu a l'operateur humain`);
  process.exit(1);
}

// --- push, gate double explicite ---
function maybePush(worktreeDir, branch) {
  const allowPush = cfg.safety.allowAutoPush || process.env[cfg.safety.allowAutoPushEnvVar] === 'true';
  const allowMain = cfg.safety.allowPushMain || process.env[cfg.safety.allowPushMainEnvVar] === 'true';
  if (!allowPush) {
    log('SKIP', 'push desactive (allowAutoPush=false) — commit local uniquement, revue humaine requise');
    return;
  }
  if (branch === 'main' && !allowMain) {
    log('SKIP', 'push vers main bloque (allowPushMain=false) — pousse une branche de travail a la place');
    return;
  }
  execFileSync('git', ['push', 'origin', branch], { cwd: worktreeDir, stdio: 'inherit' });
  log('OK', `push origin/${branch}`);
}

// --- boucle principale ---
async function main() {
  const task = firstUncheckedTask();
  if (!task) {
    log('OK', 'aucune tache non cochee dans PLAN.md — rien a faire');
    return;
  }
  log('OK', `tache selectionnee: ${task.text}`);

  let attempts = 0;
  let lastError = '';
  while (attempts < cfg.safety.maxConsecutiveFailures) {
    attempts += 1;
    let worktreeDir;
    try {
      log('OK', `cycle ${attempts}/${cfg.safety.maxConsecutiveFailures}`);

      const cartographie = await runCartographe(task.text);
      log('OK', 'cartographie recue');

      worktreeDir = runExecuteur(task.text, cartographie);
      assertTestFilesUntouched(worktreeDir);
      log('OK', 'execution terminee, fichiers de test intacts');

      const { verdict, output } = await runQA(worktreeDir);
      if (verdict === 'FAIL') throw new Error(`QA_FAILED`);
      log('OK', 'QA: PASS');

      // PLAN.md/PROGRESS.md ecrits AVANT le commit de l'archiviste, dans le
      // worktree, pour finir dans le MEME commit que le code (voir note sur
      // checkTask/updateProgress plus haut).
      updateProgress(worktreeDir, task.text, verdict);
      checkTask(worktreeDir, task.lines, task.index);

      const commitMsg = await runArchiviste(task.text, output, worktreeDir);

      const branch = execSync('git branch --show-current', { cwd: worktreeDir, encoding: 'utf8' }).trim();
      maybePush(worktreeDir, branch);

      execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' });
      log('OK', `cycle termine — commit "${commitMsg}" sur la branche "${branch}" (worktree supprime, branche conservee dans le depot principal). Revue humaine + merge manuel requis. /clear recommande avant la tache suivante.`);
      return;
    } catch (e) {
      lastError = e.message;
      log('RETRYING', `echec cycle ${attempts}: ${lastError}`);
      if (worktreeDir) {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' }); } catch {}
      }
    }
  }
  crashAndFreeze(task.text, attempts, lastError);
}

// Note sur /clear : c'est une commande interactive de la CLI Claude Code, non invocable
// depuis un script externe. Cet orchestrateur obtient un effet equivalent en lancant un
// nouveau processus `claude -p` par tache (runExecuteur), qui ne porte aucun contexte
// des taches precedentes — pas de purge manuelle necessaire entre deux taches.

main().catch((e) => {
  log('FAILED', `erreur non geree: ${e.message}`);
  process.exit(1);
});
