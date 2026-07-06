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
    nom: 'Test', secteur: 'menage', couleur: '#00FF9D', services: ['Menage'], slug: 'test', deviseSymbole: '€',
  }));
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

const result = await page.evaluate(() => {
  const c = document.getElementById('horizon-line');
  const rect = c.getBoundingClientRect();
  const tipCountBefore = document.querySelectorAll('.horizon-tip').length;
  const ev = new MouseEvent('mousemove', { clientX: rect.left + rect.width * 0.3, clientY: rect.top + rect.height * 0.5, bubbles: true });
  c.dispatchEvent(ev);
  const tip = document.querySelector('.horizon-tip');
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    tipCountBefore,
    tipVisible: tip ? tip.classList.contains('visible') : null,
    tipText: tip ? tip.textContent : null,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
