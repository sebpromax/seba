import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'tactical-dark');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const pages = ['client-fiche.html', 'devis-nouveau.html', 'employe-fiche.html'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

for (const rel of pages) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const url = 'file://' + path.resolve('docs', rel);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({
      nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
      services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
    }));
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 300));
  const slug = rel.replace('.html', '');
  await page.screenshot({ path: path.join(outDir, slug + '-desktop.png'), fullPage: true });
  console.log(rel, 'errors:', errs);
  await page.close();
}

await browser.close();
