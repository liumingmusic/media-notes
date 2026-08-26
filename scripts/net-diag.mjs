import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

function findChrome() {
  const cands = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const c of cands) { try { execSync(`test -x "${c}"`); return c; } catch {} }
  try { return execSync('which google-chrome || which chromium').toString().trim(); } catch {}
  return null;
}

const URL = process.env.TEST_URL || 'https://liumingmusic.github.io/media-notes/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 760 });

// 捕获 worker / 页面发出的所有网络请求，重点看 models/ 与 wasm/ 的状态
const bad = [];
const logReq = (r) => {
  const u = r.url();
  if (u.includes('/models/') || u.includes('/wasm/')) console.log('REQ', r.method(), u);
};
const logResp = (r) => {
  const u = r.url();
  if ((u.includes('/models/') || u.includes('/wasm/')) && r.status() >= 400) bad.push(`HTTP ${r.status()} ${u}`);
};
const logFail = (r) => {
  const u = r.url();
  if (u.includes('/models/') || u.includes('/wasm/')) bad.push(`FAILED ${u} :: ${r.failure()?.errorText}`);
};
// 关键：puppeteer 默认不捕获 Worker 的网络请求，需监听 worker target
browser.on('targetcreated', async (target) => {
  if (target.type() === 'worker') {
    const wp = await target.page();
    if (wp) { wp.on('request', logReq); wp.on('response', logResp); wp.on('requestfailed', logFail); }
  }
});
page.on('request', logReq);
page.on('response', logResp);
page.on('requestfailed', logFail);
// 捕获页面 + Worker 的 console（Worker console 会转发到 page）
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('whisper-worker') || t.toLowerCase().includes('error') || t.includes('Unsupported')) {
    console.log('CONSOLE', m.type(), t);
  }
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
console.log('navigated:', URL);
const input = await page.$('#fileInput');
await input.uploadFile('scripts/test-video.mp4');
await sleep(1500);
await page.click('button.primary');
console.log('clicked; waiting 25s for worker to fetch model...');
await sleep(25000);

console.log('=== BAD/404/FAILED requests (models/wasm) ===');
if (bad.length === 0) console.log('(none)');
else bad.forEach((b) => console.log(' -', b));

// 读取页面日志面板(Worker 回传的调试路径会显示在这里)
const logs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.logs li')).map((li) => li.textContent);
});
console.log('=== page .logs ===');
if (logs.length === 0) console.log('(no logs)');
else logs.forEach((l) => console.log('  LOG:', l));

await browser.close();
console.log('DONE');
