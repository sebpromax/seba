import fs from 'fs';
import path from 'path';

const DOCS_DIR = path.resolve('docs');

const MARKETING = ['index.html', 'product.html', 'solution.html', 'confiance.html', 'tarifs.html', 'faq.html', 'probleme.html', 'comment-ca-marche.html'];
const APP = ['clients.html', 'devis.html', 'factures.html', 'planning.html', 'equipe.html', 'historique.html', 'reglages.html'];
const DETAIL = ['client-fiche.html', 'devis-nouveau.html', 'employe-fiche.html'];
const LOGIN = ['connexion.html'];
const ALL_PAGES = [...MARKETING, ...APP, ...DETAIL, ...LOGIN];

const existingFiles = new Set(fs.readdirSync(DOCS_DIR));

const report = [];

for (const pageName of ALL_PAGES) {
  const filePath = path.join(DOCS_DIR, pageName);
  if (!fs.existsSync(filePath)) {
    report.push({ page: pageName, issue: 'PAGE FILE MISSING' });
    continue;
  }
  const html = fs.readFileSync(filePath, 'utf-8');
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  const found = [];
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href) continue;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('http') || href.startsWith('#') || href.startsWith('javascript:')) continue;
    found.push(href);
  }
  for (const href of found) {
    // strip query/hash
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue; // was just a hash/query on same page
    const resolved = path.resolve(DOCS_DIR, clean);
    const exists = fs.existsSync(resolved);
    report.push({ page: pageName, href, resolved: path.relative(DOCS_DIR, resolved), exists });
  }
}

console.log(JSON.stringify(report, null, 2));

const broken = report.filter((r) => r.exists === false || r.issue);
console.log('\n\n=== BROKEN LINKS SUMMARY ===');
if (broken.length === 0) {
  console.log('None found.');
} else {
  for (const b of broken) {
    console.log(`${b.page}: href="${b.href || ''}" -> ${b.resolved || ''} ${b.issue || '(MISSING FILE)'}`);
  }
}
