// 将上传的音/视频文件解码并重采样为 16kHz 单声道 Float32（Whisper 所需格式）
export async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const targetRate = 16000;
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(audioBuffer.duration * targetRate)),
      targetRate
    );
    const src = offline.createBufferSource();
    const buf = offline.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    buf.copyToChannel(audioBuffer.getChannelData(0), 0);
    src.buffer = buf;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    void ctx.close();
  }
}
