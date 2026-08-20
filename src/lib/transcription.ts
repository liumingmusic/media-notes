import { pipeline } from '@huggingface/transformers';
import type { TranscriptSegment } from '../types';

// 浏览器本地 Whisper 模型（纯前端、文件不出本机）
const MODEL_ID = 'Xenova/whisper-base';

let transcriber: ((audio: Float32Array, opts: unknown) => Promise<unknown>) | null = null;

export async function loadWhisper(onStatus?: (s: string) => void): Promise<unknown> {
  if (transcriber) return transcriber;
  onStatus?.('加载本地语音模型…');
  transcriber = (await pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file && p.progress != null) {
        onStatus?.(`下载语音模型 ${Math.round(p.progress)}%`);
      }
    },
  })) as unknown as (audio: Float32Array, opts: unknown) => Promise<unknown>;
  return transcriber;
}

export interface WhisperResult {
  text: string;
  segments: TranscriptSegment[];
}

export async function transcribeWithWhisper(
  samples: Float32Array,
  onStatus?: (s: string) => void
): Promise<WhisperResult> {
  const model = (await loadWhisper(onStatus)) as (
    audio: Float32Array,
    opts: unknown
  ) => Promise<{ text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number] }> }>;
  onStatus?.('识别中…');
  const out = await model(samples, {
    language: 'chinese',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });
  const segments: TranscriptSegment[] = (out.chunks || []).map((c) => ({
    start: c.timestamp?.[0] ?? 0,
    end: c.timestamp?.[1] ?? 0,
    text: (c.text || '').trim(),
  }));
  return { text: out.text || '', segments };
}

// ---------- 实时麦克风（Web Speech API，作为可选快速通道） ----------
export function speechRecognitionSupported(): boolean {
  return (
    'SpeechRecognition' in window ||
    'webkitSpeechRecognition' in window
  );
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
