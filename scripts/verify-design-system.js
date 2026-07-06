import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'design-system');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE ERROR: ' + e));
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('manifest') && !msg.text().includes('ERR_FAILED')) errs.push('CONSOLE: ' + msg.text()); });

const url = 'file://' + path.resolve('docs', 'dashboard.html') + '?demo';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('sebaEntreprise', JSON.stringify({
    nom: 'Menage Pro Test', secteur: 'menage', couleur: '#00FF9D',
    services: ['Menage'], slug: 'menage-pro-test', deviseSymbole: '€',
  }));
});
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// Full dashboard screenshot
await page.screenshot({ path: path.join(outDir, 'full-dashboard.png') });

// Box model check: rest vs hover vs active for a nav-item — dims must be identical
const dims = await page.evaluate(() => {
  const item = document.querySelector('.nav-item');
  const rect1 = item.getBoundingClientRect();
  item.classList.add('active');
  const rect2 = item.getBoundingClientRect();
  item.classList.remove('active');
  return {
    rest: { w: rect1.width, h: rect1.height },
    withActiveClass: { w: rect2.width, h: rect2.height },
  };
});
console.log('nav-item box model rest vs .active:', JSON.stringify(dims));

// Hover screenshot of the sidebar nav
const navItemBox = await page.evaluate(() => {
  const r = document.querySelector('.nav-item').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(navItemBox.x + navItemBox.w / 2, navItemBox.y + navItemBox.h / 2);
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: path.join(outDir, 'sidebar-hover.png'), clip: { x: 0, y: 0, width: 240, height: 500 } });

// Check computed on-emerald contrast still applies (avatar/FAB/notif-badge)
const colorCheck = await page.evaluate(() => {
  const fab = getComputedStyle(document.querySelector('.fab'));
  const avatar = getComputedStyle(document.querySelector('.avatar'));
  return { fabColor: fab.color, avatarColor: avatar.color };
});
console.log('on-emerald applied (should be dark, e.g. rgb(3, 26, 18)):', JSON.stringify(colorCheck));

console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');
await browser.close();
