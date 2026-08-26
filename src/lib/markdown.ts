import type { NoteRecord } from '../types';

export function formatTime(s: number): string {
  if (!isFinite(s)) return '00:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function toMarkdown(rec: NoteRecord): string {
  const lines: string[] = [];
  lines.push(`# ${rec.fileName} 笔记`);
  lines.push('');
  lines.push(`- 类型：${rec.mediaKind === 'audio' ? '音频' : '视频'}`);
  lines.push(`- 时长：${formatTime(rec.duration)}`);
  lines.push(`- 创建：${new Date(rec.createdAt).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push(rec.summary || '（无）');
  lines.push('');
  if (rec.keyframes.length) {
    lines.push('## 关键帧时间轴');
    lines.push('');
    for (const k of rec.keyframes) {
      lines.push(`- [${formatTime(k.time)}] 关键画面（在应用内查看截图）`);
    }
    lines.push('');
  }
  lines.push('## 文字稿');
  lines.push('');
  if (rec.segments.length) {
    for (const s of rec.segments) {
      lines.push(`- [${formatTime(s.start)}] ${s.text}`);
    }
  } else {
    lines.push(rec.transcript || '（无）');
  }
  lines.push('');
  return lines.join('\n');
}

export function downloadMarkdown(rec: NoteRecord): void {
  const md = toMarkdown(rec);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${rec.fileName.replace(/\.[^.]+$/, '')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}
