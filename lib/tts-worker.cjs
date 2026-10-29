// tts-worker.cjs —— worker 线程里跑 sherpa-onnx 推理，避免卡 DSH 主进程
const { parentPort, workerData } = require('node:worker_threads');

const { modelDir, kind } = workerData || {};

function buildConfig(dir, kind) {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = fs.readdirSync(dir);
  const has = (n) => files.includes(n);
  const pickOnnx = () =>
    files
      .filter((f) => f.endsWith('.onnx'))
      .sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0];

  if (kind === 'kokoro') {
    const lexicon = ['lexicon-us-en.txt', 'lexicon-zh.txt']
      .filter((f) => has(f))
      .map((f) => path.join(dir, f))
      .join(',');
    return {
      model: {
        kokoro: {
          model: path.join(dir, pickOnnx()),
          voices: path.join(dir, 'voices.bin'),
          tokens: path.join(dir, 'tokens.txt'),
          ...(lexicon ? { lexicon } : {}),
        },
        numThreads: 4,
      },
      maxNumSentences: 1,
    };
  }

  const ruleFsts = ['date.fst', 'number.fst', 'phone.fst', 'new_heteronym.fst']
    .filter((f) => has(f))
    .map((f) => path.join(dir, f))
    .join(',');
  return {
    model: {
      vits: {
        model: path.join(dir, pickOnnx()),
        ...(has('tokens.txt') ? { tokens: path.join(dir, 'tokens.txt') } : {}),
        ...(has('lexicon.txt') ? { lexicon: path.join(dir, 'lexicon.txt') } : {}),
        ...(has('dict') ? { dictDir: path.join(dir, 'dict') } : {}),
        ...(ruleFsts ? { ruleFsts } : {}),
      },
      numThreads: 4,
    },
    maxNumSentences: 1,
  };
}

function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

let tts = null;
try {
  const sherpa = require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts(buildConfig(modelDir, kind));
} catch (e) {
  parentPort.postMessage({ type: 'init-error', error: String((e && e.message) || e) });
}

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'synth') return;
  try {
    if (!tts) throw new Error('模型未就绪');
    const audio = tts.generate({ text: msg.text, sid: Number(msg.sid) || 0, speed: Number(msg.speed) || 1.0 });
    const wav = encodeWav(audio.samples, audio.sampleRate);
    parentPort.postMessage({ type: 'result', id: msg.id, ok: true, wav });
  } catch (e) {
    parentPort.postMessage({ type: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
