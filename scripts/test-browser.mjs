// 真实浏览器实测（本地预览）：上传测试音频，跑通 Whisper 转写，
// 明确判断「成功 / 报错」，并抓 console / pageerror。
// 用法：先 npm run build，再 scripts/serve-preview（或 vite preview --port 4173），然后 node scripts/test-browser.mjs
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const URL = process.env.TEST_URL || 'http://localhost:4173/';
const WAV = resolve('scripts/test.wav');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 150000);

const logs = [];
const failed = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage();

page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => failed.push(`${req.failure()?.errorText || 'ERR'}  ${req.url()}`));
page.on('response', (res) => {
  const u = res.url();
  if (u.includes('wasm') || u.includes('.onnx') || u.includes('wasmPaths')) {
    logs.push(`[response ${res.status()}] ${u.split('/').pop()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
logs.push(`[navigated] crossOriginIsolated=${await page.evaluate(() => self.crossOriginIsolated)}`);

const input = await page.$('#fileInput');
if (!input) {
  logs.push('[ERROR] 没找到 #fileInput');
} else {
  await input.uploadFile(WAV);
  logs.push('[upload] 已选择 test.wav');
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => x.textContent && x.textContent.includes('开始提取'));
    if (b) { b.click(); return true; }
    return false;
  });
  logs.push(`[click 开始提取] ${clicked}`);
}

// 轮询等待：成功(.results 出现=管线跑通) 或 报错(.error 出现)
const start = Date.now();
let finalState = 'timeout';
let sawMatMul = false;
while (Date.now() - start < MAX_WAIT_MS) {
  const st = await page.evaluate(() => {
    const err = document.querySelector('.error')?.textContent || '';
    const hasResults = !!document.querySelector('.results');
    const transcript = document.querySelector('textarea.transcript')?.value || '';
    const status = document.querySelector('.progress span')?.textContent || '';
    return { err, hasResults, transcriptLen: transcript.length, status };
  });
  const line = `[poll ${((Date.now() - start) / 1000) | 0}s] status="${st.status}" err="${st.err}" results=${st.hasResults} transcriptLen=${st.transcriptLen}`;
  logs.push(line);
  if (st.err.includes('Missing required scale') || st.err.includes("Can't create a session")) {
    sawMatMul = true;
  }
  if (st.err) {
    finalState = 'ERROR: ' + st.err;
    break;
  }
  if (st.hasResults) {
    // 整个管线（解码→Whisper→摘要→保存）完成，说明 ONNX 会话创建成功、无 MatMulNBits 报错
    finalState = `OK pipeline ready, transcriptLen=${st.transcriptLen}`;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (sawMatMul) logs.push('[REGRESSION] 出现 MatMulNBits / session 创建报错！');

logs.push(`===== FINAL STATE: ${finalState} =====`);
logs.push('===== 失败请求 =====');
for (const f of failed) logs.push(f);

console.log(logs.join('\n'));
await browser.close();

if (finalState.startsWith('OK')) {
  console.log('\n✅ 本地真实浏览器测试通过：Whisper 转写成功，未出现 MatMulNBits 错误');
  process.exit(0);
} else {
  console.log('\n❌ 测试未通过，请检查上面的日志');
  process.exit(1);
}
