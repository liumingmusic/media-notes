import type { TranscriptSegment } from '../types';
import WhisperWorker from './whisper.worker?worker';

// 模型加载与推理全部在 Web Worker（whisper.worker.ts）中进行，
// 主线程只负责派发音频 + 接收进度/结果，因此即使长音频需要几分钟推理，
// 页面也不会被冻结（可正常滚动、交互）——根治之前"上传长视频卡死"的问题。

export interface WhisperResult {
  text: string;
  segments: TranscriptSegment[];
}

let worker: Worker | null = null;
let workerReady: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (worker) return Promise.resolve(worker);
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve, reject) => {
    try {
      const w = new WhisperWorker();
      w.onerror = (ev) => reject(new Error((ev as ErrorEvent).message || 'Whisper Worker 启动失败'));
      worker = w;
      resolve(w);
    } catch (e) {
      reject(e as Error);
    }
  });
  return workerReady;
}

export async function transcribeWithWhisper(
  samples: Float32Array,
  onStatus?: (s: string) => void
): Promise<WhisperResult> {
  const w = await getWorker();
  return new Promise<WhisperResult>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d.type === 'status') {
        onStatus?.(d.text);
      } else if (d.type === 'result') {
        w.removeEventListener('message', onMsg);
        resolve({ text: d.text ?? '', segments: d.segments ?? [] });
      } else if (d.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(d.message || '语音识别失败'));
      }
    };
    w.addEventListener('message', onMsg);
    // transfer 音频 buffer 所有权给 worker，避免大数组拷贝
    w.postMessage(
      {
        type: 'transcribe',
        samples: samples.buffer,
        language: 'chinese',
        task: 'transcribe',
      },
      [samples.buffer]
    );
  });
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
