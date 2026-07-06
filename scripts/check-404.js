import puppeteer from 'puppeteer-core';

const BASE = 'https://sebpromax.github.io/seba/';
const pages = ['onboarding.html', 'dashboard.html?demo', 'tarifs.html'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

for (const relative of pages) {
  const page = await browser.newPage();
  const fails = [];
  page.on('response', (res) => { if (res.status() === 404) fails.push(res.url()); });
  await page.goto(BASE + relative, { waitUntil: 'networkidle2', timeout: 45000 });
  console.log(relative, '->', fails);
  await page.close();
}
await browser.close();
