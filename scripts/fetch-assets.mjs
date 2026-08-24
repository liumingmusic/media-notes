/**
 * 资源准备脚本（vendoring）
 * - Whisper 模型：从 HuggingFace 官方源下载（构建机/本机能直连），写入 public/models/
 * - ONNX WASM：直接从 node_modules/onnxruntime-web/dist 拷贝到 public/wasm/
 * 两者最终都进入 dist/，由 GitHub Pages 同源服务，浏览器零外部网络请求。
 *
 * 注意：public/models 与 public/wasm 已在 .gitignore 中忽略，不进 git。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

// 使用国内镜像 hf-mirror.com（路径与官方兼容，且从自有缓存服务文件，不会被重定向回被墙的 huggingface.co）
const HF_BASE = 'https://hf-mirror.com/Xenova/whisper-base/resolve/main/';
const MODEL_DIR = join(PUBLIC, 'models', 'Xenova', 'whisper-base');

// whisper-base 需要的文件（量化版）。重要：@xenova/transformers@2.17.2 使用的是
// 合并解码器 decoder_model_merged_quantized.onnx（而非旧式的 decoder_model_quantized.onnx
// 与 decoder_with_past_model_quantized.onnx），后者在该版本下不会被加载，缺失 merged 会
// 导致 vite 回退返回 HTML 而 protobuf 解析失败，并报 "Unsupported model type: whisper"。
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'added_tokens.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

// ONNX Runtime Web 的 WASM（从 node_modules 拷贝，避免 dev 版不在 jsdelivr 上导致 404）
// 不同版本文件名不同（单线程/多线程/asyncify），直接拷贝 dist 下全部 .wasm 与 .mjs，避免漏文件。
const ORT_DIST = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const WASM_DIR = join(PUBLIC, 'wasm');
const WASM_EXTS = ['.wasm', '.mjs'];

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

import { readdir } from 'node:fs/promises';
async function listWasmFiles() {
  const entries = await readdir(ORT_DIST);
  return entries.filter((f) => WASM_EXTS.some((ext) => f.endsWith(ext)));
}

async function downloadFile(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  if (await fileExists(dest)) {
    console.log(`  ✓ 已存在，跳过: ${dest.replace(PUBLIC, 'public')}`);
    return;
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;
  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    ws.write(value);
    if (total) {
      process.stdout.write(`\r  ↓ ${((received / total) * 100).toFixed(0)}% (${(received / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)}MB)`);
    }
  }
  await new Promise((r) => ws.end(r));
  console.log('');
}

async function copyWasm() {
  await mkdir(WASM_DIR, { recursive: true });
  const files = await listWasmFiles();
  for (const f of files) {
    const src = join(ORT_DIST, f);
    const dest = join(WASM_DIR, f);
    if (await fileExists(dest)) {
      console.log(`  ✓ 已存在，跳过: public/wasm/${f}`);
      continue;
    }
    await copyFile(src, dest);
    const s = await stat(dest);
    console.log(`  ✓ 拷贝: public/wasm/${f} (${(s.size / 1048576).toFixed(1)}MB)`);
  }
}

async function main() {
  console.log('==> 下载 Whisper 模型到 public/models/Xenova/whisper-base/');
  for (const f of MODEL_FILES) {
    console.log(`  · ${f}`);
    await downloadFile(HF_BASE + f, join(MODEL_DIR, f));
  }
  console.log('==> 拷贝 ONNX WASM 到 public/wasm/');
  await copyWasm();
  console.log('完成。可执行 npm run build 了。');
}

main().catch((e) => {
  console.error('资源准备失败:', e);
  process.exit(1);
});
