#!/usr/bin/env node
// Garde-fou design system : aucune couleur en dur (hex/rgb) en dehors des
// definitions de tokens (:root / [data-theme=...]). Le repo a 3 palettes
// actives differentes (pro-global.css dark/light + dashboard.html Tactical
// Dark) donc la regle n'est PAS "voici les 2 couleurs autorisees" (ca
// bloquerait a tort les 3 palettes reelles) mais "toute couleur passe par
// var(--token), les valeurs litterales ne vivent que dans les tokens
// eux-memes".
//
// Usage :
//   node tools/check-design-system.js            -> mode diff (fichiers
//                                                    HTML/CSS changes vs HEAD)
//   node tools/check-design-system.js --base=origin/main
//                                                  -> diff vs une autre ref
//   node tools/check-design-system.js --full       -> tout docs/*.html/*.css,
//                                                     rapport informatif,
//                                                     ne fait jamais echouer
//
// Mode diff = le vrai garde-fou (bloque une PR qui AJOUTE une couleur en
// dur). Mode --full = visibilite sur la dette existante (le repo en a deja
// beaucoup : #031A12, #0B0C0E... verifie dans clients.html seul), pour
// piloter un futur nettoyage sans bloquer tout le monde des aujourd'hui.

import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const fullMode = !!args.full;
const baseRef = typeof args.base === 'string' ? args.base : 'HEAD';

const COLOR_RE = /(#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\))/g;
// :root{...} et [data-theme="..."]{...} (ou combinaisons) : la ou les
// tokens sont legitimement definis en valeurs litterales.
const TOKEN_BLOCK_RE = /(:root|\[data-theme=["'][^"']*["']\])\s*(,\s*(:root|\[data-theme=["'][^"']*["']\])\s*)*\{[^}]*\}/g;

function stripTokenBlocks(css) {
  return css.replace(TOKEN_BLOCK_RE, (m) => ' '.repeat(m.length)); // garde les offsets de ligne
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanCss(content, fileLabel, violations) {
  const stripped = stripTokenBlocks(content);
  for (const m of stripped.matchAll(COLOR_RE)) {
    violations.push({ file: fileLabel, line: lineOf(content, m.index), value: m[0] });
  }
}

function scanHtml(content, fileLabel, violations) {
  // <style>...</style>
  for (const styleMatch of content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const block = styleMatch[1];
    const blockStart = styleMatch.index + styleMatch[0].indexOf(block);
    const stripped = stripTokenBlocks(block);
    for (const m of stripped.matchAll(COLOR_RE)) {
      violations.push({ file: fileLabel, line: lineOf(content, blockStart + m.index), value: m[0] });
    }
  }
  // style="..."
  for (const attrMatch of content.matchAll(/style\s*=\s*"([^"]*)"/g)) {
    const value = attrMatch[1];
    const valueStart = attrMatch.index + attrMatch[0].indexOf(value);
    for (const m of value.matchAll(COLOR_RE)) {
      violations.push({ file: fileLabel, line: lineOf(content, valueStart + m.index), value: m[0] });
    }
  }
}

function scanFile(absPath, relPath, violations) {
  const content = readFileSync(absPath, 'utf8');
  if (relPath.endsWith('.css')) scanCss(content, relPath, violations);
  else if (relPath.endsWith('.html')) scanHtml(content, relPath, violations);
}

function listAllDocsFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.(html|css)$/.test(name.name)) out.push(path.relative(ROOT, full));
    }
  })(path.join(ROOT, 'docs'));
  return out;
}

function listChangedDocsFiles(base) {
  let diffOut;
  try {
    diffOut = execSync(`git diff --name-only ${base}`, { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    console.error(`[ERROR] git diff --name-only ${base} a echoue: ${e.message}`);
    return [];
  }
  return diffOut.split('\n').filter(Boolean).filter((f) => /^docs\/.*\.(html|css)$/.test(f));
}

// Renvoie l'ensemble des numeros de ligne AJOUTES/MODIFIES (cote "apres")
// pour un fichier, en parsant les en-tetes de hunk unifie (@@ -a,b +c,d @@).
// Sans ca, le mode diff flaguerait TOUTES les violations d'un fichier des
// qu'il est touche (meme des lignes non modifiees) -- pas ce qu'on veut :
// le garde-fou doit bloquer une NOUVELLE couleur en dur, pas punir un dev
// qui touche un fichier historique pour une raison sans rapport.
function addedLinesFor(base, relPath) {
  let diffOut;
  try {
    diffOut = execSync(`git diff -U0 ${base} -- "${relPath}"`, { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    console.error(`[ERROR] git diff -U0 ${base} -- ${relPath} a echoue: ${e.message}`);
    return new Set();
  }
  const added = new Set();
  let curLine = null;
  for (const raw of diffOut.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) { curLine = parseInt(hunk[1], 10); continue; }
    if (curLine === null) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) { added.add(curLine); curLine++; }
    else if (raw.startsWith('-') && !raw.startsWith('---')) { /* ligne supprimee, ne consomme pas curLine */ }
    else if (!raw.startsWith('\\')) { curLine++; }
  }
  return added;
}

function main() {
  const targets = fullMode ? listAllDocsFiles() : listChangedDocsFiles(baseRef);

  if (!fullMode && !targets.length) {
    console.log(`[OK] aucun fichier HTML/CSS modifie dans docs/ (diff vs ${baseRef}) -- rien a verifier`);
    return;
  }

  const violations = [];
  for (const rel of targets) {
    const abs = path.join(ROOT, rel);
    const fileViolations = [];
    try { scanFile(abs, rel, fileViolations); } catch (e) { console.error(`[ERROR] ${rel}: ${e.message}`); continue; }

    if (fullMode) { violations.push(...fileViolations); continue; }

    const added = addedLinesFor(baseRef, rel);
    violations.push(...fileViolations.filter((v) => added.has(v.line)));
  }

  if (!violations.length) {
    console.log(`[OK] 0 couleur en dur detectee hors :root sur ${targets.length} fichier(s) (mode ${fullMode ? '--full' : 'diff vs ' + baseRef})`);
    return;
  }

  console.log(`\n=== ${violations.length} couleur(s) en dur hors :root (${fullMode ? 'rapport complet, informatif' : 'mode diff'}) ===`);
  const byFile = {};
  for (const v of violations) (byFile[v.file] ??= []).push(v);
  for (const [file, vs] of Object.entries(byFile)) {
    console.log(`\n${file} (${vs.length}) :`);
    for (const v of vs.slice(0, 20)) console.log(`  L${v.line} : ${v.value}`);
    if (vs.length > 20) console.log(`  ... et ${vs.length - 20} de plus`);
  }

  if (fullMode) {
    console.log('\n[INFO] --full est informatif uniquement (dette existante), ne bloque jamais.');
    return;
  }

  console.log('\n[FAIL] des couleurs en dur ont ete ajoutees/modifiees hors :root -- utiliser var(--token) a la place.');
  process.exit(1);
}

main();
