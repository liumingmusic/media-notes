import { env, pipeline } from '@huggingface/transformers';
import type { TranscriptSegment } from '../types';

// 关键：模型与 WASM 全部同源打包进站点（public/ → dist/ → GitHub Pages），
// 浏览器零外部网络请求。这样彻底绕开两个问题：
//   1) huggingface.co 在国内被墙 / 镜像把请求重定向回官方域 → 模型永远下不下来；
//   2) onnxruntime-web 的 dev 预发布版不在 jsdelivr 上 → WASM 也会 404。
// 资源由 scripts/fetch-assets.mjs 在构建前准备（模型从 HF 官方源下载，WASM 从 node_modules 拷贝）。
env.allowLocalModels = true;
env.allowRemoteModels = false; // 强制本地，避免在中国网络下白等远程超时
env.localModelPath = import.meta.env.BASE_URL + 'models/';
try {
  // WASM 同源加载（BASE_URL 在 dev 为 '/'，在 GitHub Pages 子路径下为 '/media-notes/'）
  (env.backends as { onnx?: { wasm?: { wasmPaths?: string } } }).onnx = {
    ...(env.backends as { onnx?: object }).onnx,
    wasm: {
      ...((env.backends as { onnx?: { wasm?: object } }).onnx?.wasm ?? {}),
      wasmPaths: import.meta.env.BASE_URL + 'wasm/',
    },
  };
} catch {
  /* 忽略：WASM 路径设置失败时在运行时会有明确报错 */
}

// 浏览器本地 Whisper 模型（纯前端、文件不出本机）
const MODEL_ID = 'Xenova/whisper-base';

type AnyPipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: Array<{ text?: string; timestamp?: [number, number] | [number, null] }>;
}>;

let transcriber: AnyPipeline | null = null;
let loadPromise: Promise<AnyPipeline> | null = null;

export async function loadWhisper(onStatus?: (s: string) => void): Promise<AnyPipeline> {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;
  onStatus?.(`正在从国内镜像加载本地语音模型（${MODEL_ID}）…`);
  loadPromise = (async () => {
    const model = (await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) {
          const name = p.file.split('/').pop() || p.file;
          const pct = p.progress != null ? Math.round(p.progress) : 0;
          onStatus?.(`下载语音模型 ${name} ${pct}%`);
        } else if (p.status === 'done' && p.file) {
          const name = p.file.split('/').pop() || p.file;
          onStatus?.(`已就绪：${name}`);
        }
      },
    })) as unknown as AnyPipeline;
    transcriber = model;
    return model;
  })();
  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null; // 允许后续重试
    throw e;
  }
}

export interface WhisperResult {
  text: string;
  segments: TranscriptSegment[];
}

export async function transcribeWithWhisper(
  samples: Float32Array,
  onStatus?: (s: string) => void
): Promise<WhisperResult> {
  const model = await loadWhisper(onStatus);
  onStatus?.('语音识别中…（首次可能需数十秒，取决于音频长度）');
  const out = await model(samples, {
    language: 'chinese',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });

  // 兜底：若顶层 text 为空但存在分块，则拼接分块文本
  let text = out.text || '';
  if (!text && out.chunks?.length) {
    text = out.chunks.map((c) => (c.text || '').trim()).join(' ').trim();
  }

  const segments: TranscriptSegment[] = (out.chunks || [])
    .map((c) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? 0,
      text: (c.text || '').trim(),
    }))
    .filter((s) => s.text.length > 0);

  return { text, segments };
}

// ---------- 实时麦克风（Web Speech API，作为可选快速通道） ----------
export function speechRecognitionSupported(): boolean {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export interface MicHandle {
  stop: () => void;
}

export function transcribeFromMic(opts: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
}): MicHandle {
  const SR =
    (window as unknown as { SpeechRecognition: new () => any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition: new () => any }).webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    opts.onInterim(interim);
    if (finalText) opts.onFinal(finalText);
  };
  rec.onerror = (e: any) => opts.onError?.(e.error || '识别错误');
  rec.start();
  return { stop: () => rec.stop() };
}
