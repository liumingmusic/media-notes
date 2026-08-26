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
const VIDEO = process.env.TEST_VIDEO || 'scripts/test-video.mp4';
const MAX_WAIT = Number(process.env.MAX_WAIT_MS || 600000);
const VIEWPORT = { width: 1000, height: 760 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 注入主线程心跳：每 200ms 记录一次时间戳，用于事后判断冻结时长
await page.evaluateOnNewDocument(() => {
  window.__beats = [];
  setInterval(() => { window.__beats.push(performance.now()); if (window.__beats.length > 2000) window.__beats.shift(); }, 200);
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
console.log('navigated:', URL);

const input = await page.$('#fileInput');
await input.uploadFile(VIDEO);
await sleep(1500);
await page.click('button.primary');
console.log('clicked 开始提取; video=', VIDEO);

const start = Date.now();
let freezeMax = 0;
let lastBeatCount = 0;
let result = null;

while (Date.now() - start < MAX_WAIT) {
  const t0 = Date.now();
  const info = await page.evaluate(() => {
    const logs = document.querySelectorAll('.logs li');
    const last = logs.length ? logs[logs.length - 1].textContent : '';
    const prog = document.querySelector('.progress span')?.textContent || '';
    const ready = !!document.querySelector('.results');
    const err = document.querySelector('.error')?.textContent || '';
    const beats = window.__beats ? window.__beats.length : 0;
    return { last, prog, ready, err, beats };
  });
  const rt = Date.now() - t0; // evaluate 往返延迟 = 主线程被阻塞程度
  const elapsed = Math.round((Date.now() - start) / 1000);
  const beatDelta = info.beats - lastBeatCount;
  lastBeatCount = info.beats;
  // 心跳停止（beatDelta==0 且 rt 大）说明主线程被长时间冻结
  const froze = rt > 1500 || beatDelta === 0;
  if (rt > freezeMax) freezeMax = rt;
  console.log(`[${elapsed}s] rt=${rt}ms beats+=${beatDelta} prog="${info.prog}" last="${info.last}"${froze ? '  <<< FROZEN?' : ''}`);
  if (info.err) { result = { type: 'error', msg: info.err }; break; }
  if (info.ready) { result = { type: 'ready' }; break; }
  await sleep(1500);
}

console.log('=== RESULT ===');
console.log('type:', result?.type);
console.log('maxEvaluateRoundTrip(ms):', freezeMax, '(越高说明主线程冻结越久)');
if (result?.type === 'error') {
  await sleep(800);
  const errText = await page.evaluate(
    () => document.querySelector('.error')?.textContent || '(no .error element)'
  );
  console.log('app .error text:', errText);
}
if (consoleErrors.length) { console.log('=== console errors ==='); consoleErrors.slice(0, 8).forEach((e) => console.log(' -', e)); }

await browser.close();
console.log('DONE');
