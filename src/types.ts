export type MediaKind = 'audio' | 'video';

export interface Keyframe {
  id: string;
  time: number; // 秒
  dataUrl: string; // 缩略图 dataURL
  score: number; // 帧差得分
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface NoteRecord {
  id: string;
  fileName: string;
  mediaKind: MediaKind;
  duration: number;
  createdAt: number;
  transcript: string;
  segments: TranscriptSegment[];
  summary: string;
  keyframes: Keyframe[];
}
