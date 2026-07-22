#!/usr/bin/env node
// SEBA — Test de contrat : empêche une nouvelle divergence entre les codes
// secteur réellement envoyés par l'onboarding (SECTOR_MAPPING) et les
// valeurs acceptées par la contrainte SQL profiles.sector.
//
// Ne construit PAS un système complet de catégories -- compare seulement
// deux listes déjà existantes. Échoue bruyamment (code de sortie non nul)
// si un bouton d'onboarding produit une valeur que la base rejetterait.
//
// Usage : node scripts/local-db/test-sector-contract.js
// Nécessite l'environnement local démarré (lit la contrainte réelle en base).

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// 1. Extraction des valeurs réellement envoyées par l'onboarding (SECTOR_MAPPING).
const configPath = path.join(repoRoot, 'docs/services/config-dashboard.js');
const configSrc = readFileSync(configPath, 'utf8');
const mappingMatch = configSrc.match(/var SECTOR_MAPPING\s*=\s*\{([^}]*)\}/s);
if (!mappingMatch) {
  console.error('ÉCHEC : impossible de trouver SECTOR_MAPPING dans', configPath);
  process.exit(1);
}
const jsValues = [...mappingMatch[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
const jsValuesUnique = [...new Set(jsValues)];
console.log('Valeurs envoyées par l\'onboarding (SECTOR_MAPPING) :', jsValuesUnique.join(', '));

if (jsValuesUnique.length === 0) {
  console.error('ÉCHEC : aucune valeur extraite -- le format de SECTOR_MAPPING a peut-être changé, revoir la regex de ce test.');
  process.exit(1);
}

// 2. Lecture de la contrainte SQL réelle depuis l'environnement local.
let sqlDef;
try {
  sqlDef = execSync(
    `docker exec -i supabase_db_seba psql -U postgres -t -A -c "select pg_get_constraintdef(oid) from pg_constraint where conrelid='profiles'::regclass and conname='profiles_sector_check';"`,
    { encoding: 'utf8' },
  ).trim();
} catch (e) {
  console.error('ÉCHEC : impossible de lire la contrainte profiles_sector_check -- environnement local démarré ?', e.message);
  process.exit(1);
}
if (!sqlDef) {
  console.error('ÉCHEC : contrainte profiles_sector_check introuvable dans la base locale.');
  process.exit(1);
}
console.log('Définition SQL actuelle :', sqlDef);

const sqlValues = [...sqlDef.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
console.log('Valeurs acceptées par PostgreSQL :', sqlValues.join(', '));

// 3. Comparaison : chaque valeur JS doit être acceptée par SQL.
const missing = jsValuesUnique.filter((v) => !sqlValues.includes(v));
if (missing.length > 0) {
  console.error('ÉCHEC DE CONTRAT : les valeurs suivantes sont envoyées par l\'onboarding mais REJETÉES par PostgreSQL :', missing.join(', '));
  console.error('-> Ajouter ces valeurs à la contrainte profiles_sector_check (nouvelle migration produit), ou corriger SECTOR_MAPPING.');
  process.exit(1);
}

console.log('OK — toutes les valeurs de SECTOR_MAPPING sont acceptées par la contrainte SQL actuelle.');

// 4. Information seulement (pas un échec) : secteurs de businessTypes.js non
//    encore atteignables via l'onboarding -- cohérent avec l'état connu du
//    dépôt ("7 secteurs inertes"), signalé mais pas traité ici.
try {
  const btPath = path.join(repoRoot, 'docs/businessTypes.js');
  const btSrc = readFileSync(btPath, 'utf8');
  const allKeys = [...btSrc.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
  const inert = allKeys.filter((k) => !jsValuesUnique.includes(k));
  if (inert.length > 0) {
    console.log('Information (non bloquant) — secteurs de businessTypes.js non atteignables via l\'onboarding aujourd\'hui :', inert.join(', '));
  }
} catch (e) {
  console.log('(vérification informative des secteurs inertes ignorée :', e.message, ')');
}

process.exit(0);
