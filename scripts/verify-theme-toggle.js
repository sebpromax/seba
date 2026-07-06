import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'theme-toggle');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function seed(page) {
  await page.evaluate(() => {
    localStorage.setItem('sebaEntreprise', JSON.stringify({
      nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
      services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
    }));
  });
}

// 1. dashboard.html default (dark) after refactor — regression check
{
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const url = 'file://' + path.resolve('docs', 'dashboard.html');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await seed(page);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.setViewport({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(outDir, 'dashboard-dark-regression.png'), fullPage: true });
  console.log('dashboard dark regression errors:', errs);
  await page.close();
}

// 2. reglages.html: toggle to light via UI click, screenshot
{
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const url = 'file://' + path.resolve('docs', 'reglages.html');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await seed(page);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.setViewport({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(outDir, 'reglages-dark.png'), fullPage: true });

  await page.click('#theme-switch-light');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, 'reglages-light.png'), fullPage: true });

  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const stored = await page.evaluate(() => localStorage.getItem('seba_theme'));
  console.log('reglages after toggle: data-theme=', themeAttr, 'localStorage=', stored, 'errors:', errs);
  await page.close();
}

// 3. Navigate to clients.html in the SAME "session" (persisted localStorage via same browser context + fresh page) to confirm theme persists across pages
{
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve('docs', 'reglages.html'), { waitUntil: 'domcontentloaded' });
  await seed(page);
  await page.evaluate(() => localStorage.setItem('seba_theme', 'light'));
  const url2 = 'file://' + path.resolve('docs', 'clients.html');
  await page.goto(url2, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.setViewport({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(outDir, 'clients-light-persisted.png'), fullPage: true });
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('clients.html picked up persisted theme:', themeAttr);
  await page.close();
}

await browser.close();
