/** 合成结果缓存（按 音色+文本 哈希落盘，LRU 控制体积） */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cacheDir } from './config.mjs';

const MAX_FILES = 300;
const MAX_BYTES = 100 * 1024 * 1024;

export function cacheKey(voiceId, text) {
  return crypto.createHash('sha1').update(String(voiceId) + '\n' + String(text)).digest('hex');
}

export function readCache(key, ext) {
  const file = path.join(cacheDir(), `${key}.${ext}`);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return null;
    fs.utimesSync(file, new Date(), new Date());
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export function writeCache(key, ext, buf) {
  try {
    const file = path.join(cacheDir(), `${key}.${ext}`);
    fs.writeFileSync(file, buf);
    prune();
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

function prune() {
  try {
    const dir = cacheDir();
    const files = fs
      .readdirSync(dir)
      .map((name) => {
        const file = path.join(dir, name);
        try {
          const st = fs.statSync(file);
          return { file, size: st.size, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((s, f) => s + f.size, 0);
    let count = files.length;
    for (const f of files) {
      if (count <= MAX_FILES && total <= MAX_BYTES) break;
      try {
        fs.unlinkSync(f.file);
      } catch {
        /* ignore */
      }
      total -= f.size;
      count -= 1;
    }
  } catch {
    /* ignore */
  }
}
