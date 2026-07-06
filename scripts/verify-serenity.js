import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'serenity');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });

const url = 'file://' + path.resolve('docs', 'dashboard.html');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await page.setViewport({ width: 1440, height: 900 });
await new Promise((r) => setTimeout(r, 1200));

// Full dashboard
await page.screenshot({ path: path.join(outDir, 'dashboard-with-serenity.png'), fullPage: false });

// Close-up on the widget + simulate hover for the orbit labels
const widget = await page.$('.widget-shell[data-widget-id="serenity-score"]');
if (widget) {
  await widget.screenshot({ path: path.join(outDir, 'serenity-closeup-sain.png') });
  const box = await widget.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, 400));
  await widget.screenshot({ path: path.join(outDir, 'serenity-closeup-hover.png') });
} else {
  errs.push('WIDGET NOT FOUND: .widget-shell[data-widget-id="serenity-score"]');
}

// Toggle theme live and re-screenshot (checks CSS-var reactivity)
await page.evaluate(() => { if (window.sebaTheme) sebaTheme.set('light'); });
await new Promise((r) => setTimeout(r, 500));
if (widget) await widget.screenshot({ path: path.join(outDir, 'serenity-closeup-light-theme.png') });

// Check score value + computed color actually match theme var
const info = await page.evaluate(() => {
  const el = document.querySelector('.serenity-score-num');
  const canvas = document.querySelector('.serenity-canvas');
  return {
    scoreText: el ? el.textContent : null,
    canvasExists: !!canvas,
    canvasHasSize: canvas ? (canvas.width > 0 && canvas.height > 0) : false,
  };
});
console.log('widget info:', JSON.stringify(info));
console.log('errors:', errs);

await browser.close();
