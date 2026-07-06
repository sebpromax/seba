import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'tactical-dark');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const pages = ['clients.html', 'devis.html', 'factures.html', 'planning.html', 'equipe.html', 'historique.html', 'reglages.html'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

for (const rel of pages) {
  const page = await browser.newPage();
  const url = 'file://' + path.resolve('docs', rel);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({
      nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
      services: ['Menage', 'Vitres', 'Repassage'], slug: 'menage-pro-test', deviseSymbole: '€',
    }));
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 300));
  const slug = rel.replace('.html', '');
  await page.screenshot({ path: path.join(outDir, slug + '-desktop.png'), fullPage: true });
  await page.close();
  console.log('captured', rel);
}

await browser.close();
