import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const c of candidates) {
    try { execSync(`test -x "${c}"`); return c; } catch {}
  }
  try { return execSync('which google-chrome || which chromium').toString().trim(); } catch {}
  return null;
}

const URL = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const VIEWPORT = { width: 900, height: 680 };

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport(VIEWPORT);

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
console.log('navigated:', URL);

// upload + click
const input = await page.$('#fileInput');
await input.uploadFile('scripts/test.wav');
await new Promise((r) => setTimeout(r, 800));
await page.click('button.primary');
console.log('clicked 开始提取');

// wait for logs
await page.waitForSelector('.logs', { timeout: 180000 });
console.log('logs appeared');

const diag = await page.evaluate(() => {
  const de = document.documentElement;
  const ih = window.innerHeight;
  const sh = de.scrollHeight;
  const scrollable = sh > ih;
  const logs = document.querySelector('.logs');
  let logsInfo = null;
  if (logs) {
    const r = logs.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, r.top + 2);
    const mid = document.elementFromPoint(cx, cy);
    const bot = document.elementFromPoint(cx, r.bottom - 2);
    logsInfo = {
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) },
      viewportH: ih,
      topHit: top ? (top.className || top.tagName) : null,
      midHit: mid ? (mid.className || mid.tagName) : null,
      botHit: bot ? (bot.className || mid.tagName) : null,
      logsIsTop: top && logs.contains(top),
      logsIsMid: mid && logs.contains(mid),
      logsIsBot: bot && logs.contains(bot),
    };
  }
  // try scrolling
  window.scrollTo(0, 10000);
  const scrolledY = window.scrollY;
  const maxScroll = de.scrollHeight - ih;
  return {
    innerHeight: ih,
    scrollHeight: sh,
    scrollable,
    maxScroll,
    scrolledY,
    logsInfo,
  };
});

console.log('=== DIAG ===');
console.log(JSON.stringify(diag, null, 2));

await page.screenshot({ path: 'scripts/diag-full.png', fullPage: true });
console.log('screenshot: scripts/diag-full.png');

if (consoleErrors.length) {
  console.log('=== console errors ===');
  consoleErrors.slice(0, 10).forEach((e) => console.log(' -', e));
}

await browser.close();
console.log('DONE');
