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

export async function extractKeyframes(
  videoFile: Blob,
  opts: { onProgress?: (p: number) => void; threshold?: number; maxFrames?: number } = {}
): Promise<Keyframe[]> {
  const { onProgress, threshold = 12, maxFrames = 60 } = opts;
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
    const interval = duration / targetFrames;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const keyframes: Keyframe[] = [];
    let prevData: Uint8ClampedArray | null = null;

    for (let i = 0; i < targetFrames; i++) {
      const t = Math.min(duration - 0.05, ((i + 0.5) / targetFrames) * duration);
      await new Promise<void>((res, rej) => {
        video.onseeked = () => res();
        video.onerror = () => rej(new Error('视频跳转失败'));
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
