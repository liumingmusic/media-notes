// 生成一个短测试 WAV（16kHz 单声道 16bit，3 秒，正弦波），用于浏览器实测
import { writeFileSync } from 'node:fs';

const sampleRate = 16000;
const durationSec = 3;
const freq = 220;
const n = sampleRate * durationSec;
const bytesPerSample = 2;
const blockAlign = bytesPerSample; // mono
const byteRate = sampleRate * blockAlign;
const dataSize = n * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);

// WAV header
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // channels
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(16, 34); // bits
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < n; i++) {
  const t = i / sampleRate;
  const s = Math.sin(2 * Math.PI * freq * t) * 0.3;
  buffer.writeInt16LE(Math.round(s * 32767), 44 + i * bytesPerSample);
}

writeFileSync('scripts/test.wav', buffer);
console.log('wrote scripts/test.wav', buffer.length, 'bytes');
