import puppeteer from 'puppeteer-core';
import path from 'path';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
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
await new Promise((r) => setTimeout(r, 1000));

const before = await page.evaluate(() => {
  const el = document.querySelector('.serenity-orbit-item.o10h');
  const s = getComputedStyle(el);
  return { opacity: s.opacity, transform: s.transform };
});
console.log('BEFORE hover (should be opacity:0, translateY offset):', JSON.stringify(before));

const widget = await page.$('.widget-shell[data-widget-id="serenity-score"] .serenity-wrap');
const box = await widget.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await new Promise((r) => setTimeout(r, 500));

const after = await page.evaluate(() => {
  const el = document.querySelector('.serenity-orbit-item.o10h');
  const s = getComputedStyle(el);
  const el2 = document.querySelector('.serenity-orbit-item.o2h');
  const labels = [...document.querySelectorAll('.oi-lbl')].map(e => e.textContent);
  return { opacity: s.opacity, transform: s.transform, labels };
});
console.log('AFTER hover (should be opacity:1, translateY(0)):', JSON.stringify(after));

await browser.close();
