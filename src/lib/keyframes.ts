import type { Keyframe } from '../types';

// 视频抽帧 + 帧差检测幻灯片/场景切换，提取关键帧与时间轴
function frameDiff(prev: Uint8ClampedArray, curr: Uint8ClampedArray): number {
  let sum = 0;
  const n = curr.length;
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(prev[i] - curr[i]);
  }
  return sum / (n / 4);
}

// 周期性让出主线程，保证抽帧（尤其是长视频几十次 seek）期间页面仍可滚动/交互
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export async function extractKeyframes(
  videoFile: Blob,
  opts: { onProgress?: (p: number) => void; threshold?: number; maxFrames?: number } = {}
): Promise<Keyframe[]> {
  const { onProgress, threshold = 12, maxFrames = 48 } = opts;
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('视频加载失败，请确认格式受浏览器支持'));
    });
    const duration = video.duration || 0;
    if (!isFinite(duration) || duration <= 0) return [];

    const targetFrames = Math.min(maxFrames, Math.max(20, Math.floor(duration / 2)));
    // 降到 320x180，减少每帧 getImageData / toDataURL(JPEG 编码) 的主线程开销
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const keyframes: Keyframe[] = [];
    let prevData: Uint8ClampedArray | null = null;

    for (let i = 0; i < targetFrames; i++) {
      const t = Math.min(duration - 0.05, ((i + 0.5) / targetFrames) * duration);
      // 关键兜底：onseeked 在部分视频/编码下可能不触发（尤其在已到末尾或无法解码该点），
      // 用 Promise.race 加 3s 超时，避免循环永久挂起（表现为"卡死"）。
      await Promise.race([
        new Promise<void>((res) => {
          video.onseeked = () => res();
          video.onerror = () => res(); // 解码失败也放行，不卡死
          video.currentTime = t;
        }),
        new Promise<void>((res) => setTimeout(res, 3000)),
      ]);
      await yieldToUI(); // 让出主线程，抽帧过程中页面仍可用
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
        continue; // 该帧未能解码则跳过，继续下一帧
      }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const score = prevData ? frameDiff(prevData, data) : 0;
      if (i === 0 || score >= threshold) {
        keyframes.push({
          id: `kf-${i}`,
          time: t,
          dataUrl: canvas.toDataURL('image/jpeg', 0.6),
          score,
        });
      }
      prevData = data;
      onProgress?.((i + 1) / targetFrames);
    }
    return keyframes;
  } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
