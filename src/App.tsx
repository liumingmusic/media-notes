import { useCallback, useEffect, useRef, useState } from 'react';
import type { Keyframe, MediaKind, NoteRecord, TranscriptSegment } from './types';
import { decodeToMono16k } from './lib/audio';
import { transcribeWithWhisper } from './lib/transcription';
import { aiSummarize, extractiveSummary } from './lib/summarizer';
import { extractKeyframes } from './lib/keyframes';
import { deleteNote, listNotes, saveNote } from './lib/storage';
import { downloadMarkdown, formatTime, toMarkdown } from './lib/markdown';

type Phase = 'idle' | 'processing' | 'ready' | 'error';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('audio');
  const [duration, setDuration] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState('');
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [useAi, setUseAi] = useState(false);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const previewRef = useRef<HTMLMediaElement | null>(null);

  const refreshNotes = useCallback(async () => {
    setNotes(await listNotes());
  }, []);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  const handleFile = useCallback((f: File) => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    const kind: MediaKind = f.type.startsWith('video') ? 'video' : 'audio';
    const url = URL.createObjectURL(f);
    setFile(f);
    setMediaUrl(url);
    setMediaKind(kind);
    setTranscript('');
    setSegments([]);
    setSummary('');
    setKeyframes([]);
    setPhase('idle');
    setActiveId('');
    setProgress(0);
    // 读取时长
    if (kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      v.onloadedmetadata = () => setDuration(v.duration || 0);
    } else {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = url;
      a.onloadedmetadata = () => setDuration(a.duration || 0);
    }
  }, [mediaUrl]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const run = useCallback(async () => {
    if (!file) return;
    setPhase('processing');
    setLogs([]);
    const log = (s: string) => {
      setStatusText(s);
      setLogs((prev) => [...prev, s]);
    };
    log('准备中…');
    setProgress(0.02);
    try {
      const tasks: Promise<void>[] = [];
      let text = '';
      let segs: TranscriptSegment[] = [];

      tasks.push(
        (async () => {
          const samples = await decodeToMono16k(file);
          log('音频解码完成，开始语音识别…');
          const r = await transcribeWithWhisper(samples, log);
          text = r.text;
          segs = r.segments;
          setTranscript(r.text);
          setSegments(r.segments);
          log(`识别完成，文字稿 ${r.text.length} 字`);
        })()
      );

      let kfs: Keyframe[] = [];
      if (mediaKind === 'video') {
        tasks.push(
          (async () => {
            kfs = await extractKeyframes(file, {
              onProgress: (p) => setProgress(0.05 + p * 0.75),
            });
            setKeyframes(kfs);
          })()
        );
      }

      await Promise.all(tasks);
      setProgress(0.85);

      log('总结中…');
      const sum = useAi
        ? await aiSummarize(text || transcript, log).catch(() => extractiveSummary(text || transcript))
        : extractiveSummary(text || transcript);
      setSummary(sum);
      setProgress(1);
      setPhase('ready');

      const rec: NoteRecord = {
        id: crypto.randomUUID(),
        fileName: file.name,
        mediaKind,
        duration,
        createdAt: Date.now(),
        transcript: text || transcript,
        segments: segs,
        summary: sum,
        keyframes: kfs,
      };
      await saveNote(rec);
      setActiveId(rec.id);
      void refreshNotes();
    } catch (err) {
      console.error(err);
      setStatusText(`出错了：${(err as Error).message || String(err)}`);
      setPhase('error');
    }
  }, [file, mediaKind, duration, useAi, transcript, refreshNotes]);

  const reSummarize = useCallback(async () => {
    if (!transcript) return;
    setStatusText('重新总结中…');
    const sum = useAi
      ? await aiSummarize(transcript).catch(() => extractiveSummary(transcript))
      : extractiveSummary(transcript);
    setSummary(sum);
    setStatusText('');
  }, [transcript, useAi]);

  const loadNote = useCallback((n: NoteRecord) => {
    setActiveId(n.id);
    setFile(null);
    setMediaUrl('');
    setMediaKind(n.mediaKind);
    setDuration(n.duration);
    setTranscript(n.transcript);
    setSegments(n.segments);
    setSummary(n.summary);
    setKeyframes(n.keyframes);
    setPhase('ready');
  }, []);

  const removeNote = useCallback(
    async (id: string) => {
      await deleteNote(id);
      if (activeId === id) {
        setPhase('idle');
        setTranscript('');
        setSummary('');
        setKeyframes([]);
        setActiveId('');
      }
      void refreshNotes();
    },
    [activeId, refreshNotes]
  );

  const copyMd = useCallback(() => {
    if (!file && !activeId) return;
    const rec: NoteRecord = {
      id: activeId || crypto.randomUUID(),
      fileName: file?.name || '记录',
      mediaKind,
      duration,
      createdAt: Date.now(),
      transcript,
      segments,
      summary,
      keyframes,
    };
    void navigator.clipboard.writeText(toMarkdown(rec));
    setStatusText('已复制 Markdown 到剪贴板');
  }, [activeId, file, mediaKind, duration, transcript, segments, summary, keyframes]);

  const exportMd = useCallback(() => {
    const rec: NoteRecord = {
      id: activeId || crypto.randomUUID(),
      fileName: file?.name || '记录',
      mediaKind,
      duration,
      createdAt: Date.now(),
      transcript,
      segments,
      summary,
      keyframes,
    };
    downloadMarkdown(rec);
  }, [activeId, file, mediaKind, duration, transcript, segments, summary, keyframes]);

  const seekTo = (t: number) => {
    if (previewRef.current) previewRef.current.currentTime = t;
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>音视频笔记</h1>
        <p>本地提取与整理 · 纯前端 · 文件不出本机</p>
      </header>

      <div className="layout">
        <main className="main">
          <section
            className="dropzone"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <input
              id="fileInput"
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {file ? (
              <div className="fileinfo">
                <strong>{file.name}</strong>
                <span>
                  {mediaKind === 'video' ? '视频' : '音频'} · {formatTime(duration)}
                </span>
              </div>
            ) : (
              <div className="hint">点击或拖拽上传本地音频 / 视频文件</div>
            )}
          </section>

          {mediaUrl && (
            <div className="preview">
              {mediaKind === 'video' ? (
                <video ref={previewRef as React.RefObject<HTMLVideoElement>} src={mediaUrl} controls />
              ) : (
                <audio ref={previewRef as React.RefObject<HTMLAudioElement>} src={mediaUrl} controls />
              )}
            </div>
          )}

          <div className="controls">
            <button className="primary" disabled={!file || phase === 'processing'} onClick={run}>
              {phase === 'processing' ? '处理中…' : '开始提取'}
            </button>
            <label className="ai-toggle">
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              使用本地 AI 深度总结（首次需下载模型）
            </label>
          </div>

          {phase === 'processing' && (
            <div className="progress">
              <div className="bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              <span>{statusText}</span>
            </div>
          )}
          {(phase === 'processing' || phase === 'error') && logs.length > 0 && (
            <div className="logs">
              <div className="logs-title">处理日志（如失败请把这里的内容发我）</div>
              <ul>
                {logs.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {phase === 'error' && <div className="error">{statusText}</div>}
          {phase === 'ready' && statusText && <div className="note">{statusText}</div>}

          {phase === 'ready' && (
            <div className="results">
              <section className="card">
                <h2>摘要</h2>
                <div className="summary">{summary || '（无）'}</div>
                <button className="ghost" onClick={reSummarize}>
                  重新总结
                </button>
              </section>

              {keyframes.length > 0 && (
                <section className="card">
                  <h2>关键帧时间轴（点击跳转）</h2>
                  <div className="timeline">
                    {keyframes.map((k) => (
                      <button key={k.id} className="kf" onClick={() => seekTo(k.time)} title={`${formatTime(k.time)}`}>
                        <img src={k.dataUrl} alt="" />
                        <span>{formatTime(k.time)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="card">
                <h2>文字稿（可编辑）</h2>
                <textarea
                  className="transcript"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <div className="export-row">
                  <button className="ghost" onClick={copyMd}>
                    复制 Markdown
                  </button>
                  <button className="ghost" onClick={exportMd}>
                    下载 .md
                  </button>
                </div>
              </section>
            </div>
          )}
        </main>

        <aside className="side">
          <h2>历史记录</h2>
          {notes.length === 0 && <p className="muted">暂无保存的记录</p>}
          <ul className="history">
            {notes.map((n) => (
              <li key={n.id} className={n.id === activeId ? 'active' : ''}>
                <button className="hist-item" onClick={() => loadNote(n)}>
                  <span className="hist-name">{n.fileName}</span>
                  <span className="hist-meta">
                    {n.mediaKind === 'video' ? '视频' : '音频'} · {formatTime(n.duration)}
                  </span>
                </button>
                <button className="del" onClick={() => removeNote(n.id)} title="删除">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
