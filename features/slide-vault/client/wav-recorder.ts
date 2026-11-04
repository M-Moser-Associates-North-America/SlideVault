/**
 * Record from the microphone as 16 kHz mono WAV (docs/DECISIONS.md FD-24), the format every
 * speech-to-text service accepts, so the server needs no converter. Audio stays in memory until
 * it is sent to the app's own /speech route; nothing goes to the browser maker's speech service.
 */

const RATE = 16000;
const MAX_SECONDS = 120;

export type Recording = { stop: () => Promise<Blob>; cancel: () => void };

export async function startRecording(onTooLong?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but works everywhere without a separate worklet file; this is short audio.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let samples = 0;
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    samples += data.length;
    if (samples > ctx.sampleRate * MAX_SECONDS) onTooLong?.();
  };
  source.connect(node);
  node.connect(ctx.destination);

  const close = () => {
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  return {
    cancel: close,
    async stop() {
      close();
      const all = new Float32Array(samples);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return toWav(downsample(all, ctx.sampleRate, RATE), RATE);
    },
  };
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the samples each output sample covers, a simple low-pass that keeps speech clear.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function toWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buf], { type: 'audio/wav' });
}
