// 总结能力：离线"抽取式摘要"（基于词频/位置打分提取关键句），纯前端、无需下载模型

const STOP = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '啊', '吗',
  '呢', '吧', '把', '被', '让', '给', '与', '及', '或', '等', '中', '后', '前', '时', '个',
  '们', '它', '他', '她', '我们', '你们', '他们', '这个', '那个', '可以', '因为', '所以', '但是', '如果',
]);

export function extractiveSummary(text: string, maxSentences = 12): string {
  const sentences = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) return sentences.join('');
  const freq = new Map<string, number>();
  for (const s of sentences) {
    const words = s.match(/[一-龥]{2,}|[a-zA-Z]{2,}/g) || [];
    for (const w of words) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const scored = sentences.map((s, i) => {
    const words = s.match(/[一-龥]{2,}|[a-zA-Z]{2,}/g) || [];
    let score = 0;
    for (const w of words) score += freq.get(w) || 0;
    return { s, i, score: score / Math.max(1, words.length) + (i === 0 ? 0.2 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join('');
}

