// extract-worker.cjs —— 在 worker 里解 bz2 + 解 tar（避免阻塞主进程）
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const bzip = require('seek-bzip');

const { tarPath, targetRoot } = workerData;

try {
  const raw = fs.readFileSync(tarPath);
  parentPort.postMessage({ type: 'progress', percent: 10, message: '解码压缩包' });
  const buf = bzip.decode(raw);
  parentPort.postMessage({ type: 'progress', percent: 45, message: '解压文件' });

  let off = 0;
  const total = buf.length;
  while (off + 512 <= buf.length) {
    const nameRaw = buf.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    if (!nameRaw) {
      off += 512;
      continue;
    }
    const size = parseInt(buf.subarray(off + 124, off + 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8) || 0;
    const type = buf[off + 156];
    const prefixRaw = buf.subarray(off + 345, off + 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefixRaw ? prefixRaw + '/' + nameRaw : nameRaw;
    const rel = fullName.split('/').slice(1).join('/'); // 去掉顶层目录名
    const dataStart = off + 512;
    if (type === 0 || type === 48) {
      if (rel) {
        const dest = path.join(targetRoot, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf.subarray(dataStart, dataStart + size));
      }
    } else if (type === 53 || type === 0x35) {
      // 目录（'5'）
      if (rel) fs.mkdirSync(path.join(targetRoot, rel), { recursive: true });
    }
    off = dataStart + Math.ceil(size / 512) * 512;
    if (off % (8 * 1024 * 1024) < 512) {
      parentPort.postMessage({ type: 'progress', percent: 45 + Math.min(54, Math.round((off / total) * 54)), message: '解压文件' });
    }
  }
  parentPort.postMessage({ type: 'done' });
} catch (e) {
  parentPort.postMessage({ type: 'error', error: String((e && e.message) || e) });
}
