/** 模型下载与安装（tar.bz2，多镜像 + 断点续传 + worker 解压） */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { modelsDir, dataDir } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_WORKER = path.join(HERE, 'extract-worker.cjs');

const progress = new Map();

function modelFile(pack) {
  return path.join(modelsDir(), pack.model, 'model.onnx');
}

export function modelInstallState(pack) {
  return { installed: fs.existsSync(modelFile(pack)), progress: progress.get(pack.model) || null };
}

export function getModelProgress(model) {
  return progress.get(model) || null;
}

function tempFile(pack) {
  const dir = path.join(dataDir(), 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, pack.model + '.tar.bz2');
}

async function downloadOne(url, dest, state) {
  let start = 0;
  try {
    start = fs.statSync(dest).size;
  } catch {
    start = 0;
  }
  const res = await fetch(url, { headers: start > 0 ? { Range: 'bytes=' + start + '-' } : {}, redirect: 'follow' });
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
  // 服务器忽略 Range 返回 200：从头重写，避免追加出坏文件
  if (start > 0 && res.status === 200) start = 0;
  const total = Number(res.headers.get('content-length') || 0) + start;
  const fh = fs.createWriteStream(dest, { flags: start > 0 ? 'a' : 'w' });
  let got = start;
  for await (const chunk of res.body) {
    fh.write(chunk);
    got += chunk.length;
    if (total) {
      state.percent = Math.min(70, Math.round((got / total) * 70));
      state.message = '下载中 ' + (got / 1048576).toFixed(0) + 'MB / ' + (total / 1048576).toFixed(0) + 'MB';
    }
  }
  await new Promise((r) => fh.end(r));
  if (total && got < total) throw new Error('下载不完整 ' + got + '/' + total);
}

function extract(tarPath, targetRoot) {
  return new Promise((resolve, reject) => {
    const w = new Worker(EXTRACT_WORKER, { workerData: { tarPath, targetRoot } });
    w.on('message', (msg) => {
      if (msg.type === 'progress') {
        const state = progress.get(path.basename(targetRoot));
        if (state) {
          state.percent = msg.percent;
          state.message = msg.message;
        }
      } else if (msg.type === 'done') {
        resolve();
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
      }
    });
    w.on('error', (e) => reject(e));
  });
}

/** 下载并安装模型；重复调用会复用进行中的任务 */
export async function ensureModelDownloaded(pack) {
  const current = progress.get(pack.model);
  if (current && current.state === 'downloading') return current.promise;
  if (fs.existsSync(modelFile(pack))) return null;

  const state = { state: 'downloading', percent: 0, message: '准备下载' };
  progress.set(pack.model, state);
  state.promise = (async () => {
    try {
      const dest = tempFile(pack);
      const urls = (pack.urls || []).filter(Boolean);
      if (!urls.length) throw new Error('该音色包暂未配置下载源');
      let lastErr = null;
      for (const url of urls) {
        try {
          await downloadOne(url, dest, state);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          state.message = '换源重试…';
        }
      }
      if (lastErr) throw lastErr;
      state.percent = 70;
      state.message = '解压中';
      await extract(dest, path.join(modelsDir(), pack.model));
      fs.rmSync(dest, { force: true });
      if (!fs.existsSync(modelFile(pack))) throw new Error('解压后没有找到 model.onnx');
      state.state = 'done';
      state.percent = 100;
      state.message = '安装完成';
    } catch (e) {
      state.state = 'error';
      state.message = '安装失败：' + String((e && e.message) || e);
      throw e;
    }
  })();
  return state.promise;
}
