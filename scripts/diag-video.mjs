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

// 横向滚动检测：测量文档宽度并定位溢出元素（修复"页面变形/横向滚动条"用）
const scrollInfo = await page.evaluate(() => {
  const de = document.documentElement;
  const cw = de.clientWidth;
  const sw = de.scrollWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right > cw + 1 && r.width > 0) {
      const cls = typeof el.className === 'string' ? el.className : '';
      offenders.push({ tag: el.tagName.toLowerCase(), cls, right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const o of offenders.sort((a, b) => b.right - a.right)) {
    const key = o.tag + '.' + o.cls;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(o);
    if (uniq.length >= 8) break;
  }
  // 关键容器实际计算宽度，定位"谁撑宽了页面"
  const widths = {};
  for (const s of ['.app', '.layout', '.main', '.side', '.results', '.card', '.timeline', '.seg-list']) {
    const el = document.querySelector(s);
    if (!el) continue;
    const cs = getComputedStyle(el);
    widths[s] = { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, overflowX: cs.overflowX, minWidth: cs.minWidth };
  }
  // 找出最宽 / 最靠右的元素及其父链，定位真正撑宽页面的元凶
  let maxRight = null;
  let maxWidth = null;
  const chain = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; i < 4 && n; i++) {
      const c = typeof n.className === 'string' ? n.className : '';
      parts.push(n.tagName.toLowerCase() + (c ? '.' + c.split(' ')[0] : ''));
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!maxRight || r.right > maxRight.r.right) maxRight = { r, info: { tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className : '', right: Math.round(r.right), w: Math.round(r.width), chain: chain(el) } };
    if (!maxWidth || r.width > maxWidth.r.width) maxWidth = { r, info: { tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className : '', right: Math.round(r.right), w: Math.round(r.width), chain: chain(el) } };
  }
  // 分段文字稿渲染校验
  const segs = document.querySelectorAll('.seg');
  const firstSeg = segs.length ? {
    time: document.querySelector('.seg-time')?.textContent || '',
    text: (document.querySelector('.seg-text')?.textContent || '').slice(0, 40),
  } : null;
  return { clientWidth: cw, scrollWidth: sw, hasHScroll: sw > cw + 1, offenders: uniq, widths, maxRight: maxRight?.info, maxWidth: maxWidth?.info, segCount: segs.length, firstSeg };
});
console.log('=== HORIZONTAL SCROLL ===');
console.log('clientWidth:', scrollInfo.clientWidth, 'scrollWidth:', scrollInfo.scrollWidth, 'hasHScroll:', scrollInfo.hasHScroll);
if (scrollInfo.offenders.length) {
  console.log('offending elements (right edge beyond viewport):');
  scrollInfo.offenders.forEach((o) => console.log('  ', o.tag, '.' + o.cls, 'right=' + o.right, 'w=' + o.width));
} else {
  console.log('(no overflowing element — OK)');
}
console.log('container widths:', JSON.stringify(scrollInfo.widths));
console.log('maxRight:', JSON.stringify(scrollInfo.maxRight));
console.log('maxWidth:', JSON.stringify(scrollInfo.maxWidth));
console.log('segCount:', scrollInfo.segCount, 'firstSeg:', JSON.stringify(scrollInfo.firstSeg));

await browser.close();
console.log('DONE');
