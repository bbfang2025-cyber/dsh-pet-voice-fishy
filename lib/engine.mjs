/** TTS 引擎门面：懒加载 worker、串行合成、模型安装状态 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { modelsDir } from './config.mjs';
import { ensureModelDownloaded, modelInstallState } from './download.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'tts-worker.cjs');

const workers = new Map(); // modelDir -> { worker, queue, seq }

export function modelDirFor(pack) {
  return path.join(modelsDir(), pack.model);
}

export function isModelInstalled(pack) {
  return modelInstallState(pack).installed;
}

function getWorker(pack) {
  const dir = modelDirFor(pack);
  let wrapper = workers.get(dir);
  if (wrapper) return wrapper;
  const worker = new Worker(WORKER, { workerData: { modelDir: dir, kind: pack.kind || 'vits' } });
  const wrapper2 = { worker, queue: Promise.resolve(), seq: 0, pending: new Map(), initError: null };
  worker.on('message', (msg) => {
    if (msg.type === 'init-error') {
      wrapper2.initError = msg.error;
      return;
    }
    if (msg.type === 'result') {
      const p = wrapper2.pending.get(msg.id);
      if (p) {
        wrapper2.pending.delete(msg.id);
        if (msg.ok) {
          // worker 传来的是普通数字数组（避免 Electron 结构化克隆拒绝外部 buffer），
          // 这里复制成新的 Node Buffer 后再缓存/返回，确保不是外部内存视图。
          const bytes = msg.wav instanceof Array ? Uint8Array.from(msg.wav) : msg.wav;
          p.resolve(Buffer.from(bytes));
        } else {
          p.reject(new Error(msg.error || '合成失败'));
        }
      }
    }
  });
  worker.on('error', (err) => {
    wrapper2.initError = String((err && err.message) || err);
    for (const [, p] of wrapper2.pending) p.reject(new Error('推理线程崩溃：' + wrapper2.initError));
    wrapper2.pending.clear();
  });
  workers.set(dir, wrapper2);
  return wrapper2;
}

/** 合成一句话，返回 WAV Buffer（串行：一个模型同时只跑一句） */
export function synthesizeLocal(pack, text, sid, speed) {
  const w = getWorker(pack);
  const run = () => {
    if (w.initError) throw new Error('本地模型加载失败：' + w.initError);
    const id = ++w.seq;
    return new Promise((resolve, reject) => {
      w.pending.set(id, { resolve, reject });
      w.worker.postMessage({ type: 'synth', id, text, sid, speed });
    });
  };
  const out = w.queue.then(run, run);
  w.queue = out.then(
    () => undefined,
    () => undefined,
  );
  return out;
}

/** 确保模型可用（已安装直接返回；没有就后台下载） */
export async function ensureModel(pack) {
  if (isModelInstalled(pack)) return;
  await ensureModelDownloaded(pack);
}
