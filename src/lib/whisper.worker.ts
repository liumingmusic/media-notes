// Web Worker：承载 Whisper 模型加载与推理。
// 关键目的：把耗时的语音推理从主线程移开，避免长音频（如几分钟的视频）
// 在主线程单线程 WASM 推理时把页面冻结（表现为"卡死"——不能滚动、按钮无响应）。
// 主线程通过 postMessage 传入 Float32 PCM（transferable），并通过 message 接收进度/结果。

import { env, pipeline } from '@xenova/transformers';

// 与 transcription.ts 完全一致的同源 vendoring 配置（模型 + WASM 打包进站点）
env.allowLocalModels = true;
env.allowRemoteModels = false; // 强制本地，避免中国网络下白等远程超时
// 模型与 WASM 同源加载。注意：worker 脚本位于 /assets/ 下，而资源在站点根 /models、/wasm，
// 因此用 worker 自身 URL 推导绝对路径（不能用 import.meta.env.BASE_URL，它在子路径/worker
// 目录下会解析成 /assets/models/ 而 404）。new URL 的第二个参数是 self.location.href 变量，
// Vite 不会静态处理，运行时由浏览器把 '../' 正确规范化为站点根下的资源目录。
const MODEL_BASE = new URL('../models/', self.location.href).href;
const WASM_BASE = new URL('../wasm/', self.location.href).href;
env.localModelPath = MODEL_BASE;
try {
  (env.backends as { onnx?: { wasm?: { wasmPaths?: string; numThreads?: number } } }).onnx = {
    ...(env.backends as { onnx?: object }).onnx,
    wasm: {
      ...((env.backends as { onnx?: { wasm?: object } }).onnx?.wasm ?? {}),
      wasmPaths: WASM_BASE,
      numThreads: 1, // 单线程，无需 SharedArrayBuffer，GitHub Pages（无 COOP/COEP）也能跑
    },
  };
} catch {
  /* 忽略 */
}

const MODEL_ID = 'Xenova/whisper-base';

type AnyPipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: Array<{ text?: string; timestamp?: [number, number] | [number, null] }>;
}>;

let model: AnyPipeline | null = null;
let loadPromise: Promise<AnyPipeline> | null = null;

function loadModel(): Promise<AnyPipeline> {
  if (model) return Promise.resolve(model);
  if (loadPromise) return loadPromise;
  self.postMessage({ type: 'status', text: `正在加载本地语音模型（${MODEL_ID}）…` });
  loadPromise = (async () => {
    const m = (await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress' && p.file) {
          self.postMessage({
            type: 'status',
            text: `下载语音模型 ${p.file.split('/').pop()} ${Math.round(p.progress ?? 0)}%`,
          });
        } else if (p.status === 'done' && p.file) {
          self.postMessage({ type: 'status', text: `已就绪：${p.file.split('/').pop()}` });
        }
      },
    })) as unknown as AnyPipeline;
    model = m;
    return m;
  })();
  return loadPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  if (d.type !== 'transcribe') return;
  try {
    const m = await loadModel();
    const samples = new Float32Array(d.samples as ArrayBuffer);
    self.postMessage({
      type: 'status',
      text: '语音识别中…（长音频需要几分钟，请稍候，期间页面可正常滚动）',
    });
    const out = await m(samples, {
      language: d.language ?? 'chinese',
      task: d.task ?? 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    let text = out.text || '';
    if (!text && out.chunks?.length) {
      text = out.chunks.map((c) => (c.text || '').trim()).join(' ').trim();
    }
    const segments = (out.chunks || [])
      .map((c) => ({
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? 0,
        text: (c.text || '').trim(),
      }))
      .filter((s) => s.text.length > 0);

    self.postMessage({ type: 'result', text, segments });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error)?.message || String(err) });
  }
};
