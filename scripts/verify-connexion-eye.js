import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs', 'audit-screenshots', 'connexion-eye');
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

const url = 'file://' + path.resolve('docs', 'connexion.html');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 500));

await page.type('#password', 'MotDePasseTest123');
await page.screenshot({ path: path.join(outDir, 'password-hidden.png') });

const before = await page.evaluate(() => document.getElementById('password').type);
await page.click('#toggle-pw');
await new Promise((r) => setTimeout(r, 200));
const after = await page.evaluate(() => document.getElementById('password').type);
await page.screenshot({ path: path.join(outDir, 'password-visible.png') });

console.log('input type before click:', before, '| after click:', after);
console.log('errors:', errs.length ? JSON.stringify(errs) : '(none)');

// Mobile check too
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 500));
await page.type('#password', 'MotDePasseTest123');
await page.screenshot({ path: path.join(outDir, 'mobile.png') });

await browser.close();
