/**
 * 原声台词库包（library 引擎）
 * - 安装：tar.bz2（sha256 校验）解压到 ~/.dsh/dsh-pet-voice/models/<pack>/，或直接复制本地目录
 * - 索引：读取 index.json（version/engine/count/phrases[{id,text,file,dur}]）
 * - 匹配：文本归一化（全半角 NFKC、去空白、去标点/符号/表情、转小写）后精确匹配
 * - 统计：total / hits / misses（进程内累计，供 GET /api/library/stats 查看命中率）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { modelsDir, dataDir } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_WORKER = path.join(HERE, 'extract-worker.cjs');

const progress = new Map(); // packId -> { state, percent, message, promise }
const indexCache = new Map(); // packId -> { key, data }
const stats = { total: 0, hits: 0, misses: 0 };
let lastMiss = null;

export function libraryDir(packId) {
  const dir = path.join(modelsDir(), String(packId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 文本归一化：全半角统一（NFKC）→ 去空白 → 去标点/符号/表情 → 小写 */
export function normalizeLibraryText(input) {
  return String(input == null ? '' : input)
    .normalize('NFKC')
    .replace(/[\s\u3000\u00a0\ufeff]+/g, '')
    .replace(/[\p{P}\p{S}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .toLowerCase();
}

export function libraryStats() {
  return { total: stats.total, hits: stats.hits, misses: stats.misses };
}

export function resetLibraryStats() {
  stats.total = 0;
  stats.hits = 0;
  stats.misses = 0;
  lastMiss = null;
}

export function lastLibraryMiss() {
  return lastMiss;
}

export function getLibraryProgress(packId) {
  const p = progress.get(packId);
  return p ? { state: p.state, percent: p.percent, message: p.message } : null;
}

/** 读 index.json（按 mtime+size 缓存解析结果），并建归一化 → 条目 的索引 */
export function loadLibraryIndex(packId) {
  const dir = libraryDir(packId);
  const file = path.join(dir, 'index.json');
  const st = fs.statSync(file);
  const key = st.mtimeMs + ':' + st.size;
  const cached = indexCache.get(packId);
  if (cached && cached.key === key) return cached.data;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || !Array.isArray(raw.phrases) || !raw.phrases.length) {
    throw new Error('index.json 格式不对：phrases 为空');
  }
  if (raw.engine && raw.engine !== 'phrase-library') {
    throw new Error('index.json engine 不是 phrase-library：' + raw.engine);
  }
  const map = new Map();
  for (const p of raw.phrases) {
    if (!p || !p.id || !p.file) continue;
    const k = normalizeLibraryText(p.text);
    if (!k) continue;
    if (!map.has(k)) map.set(k, p);
  }
  const data = { raw, map, dir, file };
  indexCache.set(packId, { key, data });
  return data;
}

export function libraryInstalled(packId) {
  try {
    const { raw } = loadLibraryIndex(packId);
    return Array.isArray(raw.phrases) && raw.phrases.length > 0;
  } catch {
    return false;
  }
}

/** 已安装库包的 manifest 摘要（版本/条数/内容哈希），没有则 null */
export function libraryInstalledManifest(packId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(libraryDir(packId), 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 已装版本是否该按 voices.json 里的包描述升级（条数/内容哈希/版本任一变化即升级） */
function libraryNeedsUpgrade(packId, pack) {
  if (!pack) return false;
  const manifest = libraryInstalledManifest(packId);
  if (!manifest) return true;
  if (pack.count && Number(manifest.count) !== Number(pack.count)) return true;
  if (pack.contentSha256 && String(manifest.sha256 || '') !== String(pack.contentSha256)) return true;
  if (pack.version && Number(manifest.version || 0) < Number(pack.version)) return true;
  return false;
}

export function libraryCount(packId) {
  try {
    return loadLibraryIndex(packId).raw.phrases.length;
  } catch {
    return 0;
  }
}

/** 试听用的首条原声文本（库音色点「试听」时保证能命中库） */
export function libraryPreviewText(packId) {
  try {
    const { raw } = loadLibraryIndex(packId);
    const first = raw.phrases.find((p) => p && p.text);
    return first ? first.text : '';
  } catch {
    return '';
  }
}

export function libraryInstallState(packId) {
  return { installed: libraryInstalled(packId), progress: getLibraryProgress(packId) };
}

/**
 * 归一化匹配。会被记录到 hits/misses。
 * @returns {{entry:object, file:string, packId:string}|null}
 */
export function lookupLibrary(packId, text) {
  let entry = null;
  let dir = null;
  try {
    const data = loadLibraryIndex(packId);
    dir = data.dir;
    const key = normalizeLibraryText(text);
    entry = key ? data.map.get(key) || null : null;
  } catch {
    entry = null;
  }
  stats.total += 1;
  if (entry) {
    stats.hits += 1;
    return { entry, file: path.join(dir, path.basename(entry.file)), packId };
  }
  stats.misses += 1;
  lastMiss = { text: String(text || '').slice(0, 120), at: new Date().toISOString() };
  return null;
}

export function readLibraryAudio(packId, entry) {
  const name = path.basename(String((entry && entry.file) || ''));
  if (!name || name !== entry.file) throw new Error('库音频文件名非法：' + (entry && entry.file));
  const file = path.join(libraryDir(packId), name);
  const buf = fs.readFileSync(file);
  if (!buf.length) throw new Error('库音频为空：' + name);
  return buf;
}

/**
 * 把库里的表情包固定台词（index 里带 meme 字段的条目）同步成
 * $DSH_HOME/dsh-pet-voice/meme_lines.json，供 dsh-pet 的碎碎念前置分支读取。
 * 没有 meme 条目时不动文件；内容已一致时不重写。失败不抛错（不影响配音主流程）。
 */
export function syncMemeLinesFile(packId) {
  try {
    const { raw } = loadLibraryIndex(packId);
    const map = {};
    for (const p of raw.phrases) {
      if (p && p.meme && p.text) map[p.meme] = p.text;
    }
    if (!Object.keys(map).length) return null;
    const file = path.join(dataDir(), 'meme_lines.json');
    const body = JSON.stringify(map, null, 2) + '\n';
    try {
      if (fs.readFileSync(file, 'utf8') === body) return file;
    } catch {
      /* 文件不存在 → 继续写 */
    }
    fs.writeFileSync(file, body, 'utf8');
    console.log('[dsh-pet-voice] 已同步表情包固定台词映射：' + file + '（' + Object.keys(map).length + ' 条）');
    return file;
  } catch {
    return null;
  }
}

/* ------------------------------ 台词池 ------------------------------ */

/** 台词池目录：$DSH_HOME/dsh-pet-voice/pools */
export function poolDir() {
  return path.join(dataDir(), 'pools');
}

function phraseKind(p) {
  if (!p) return 'chatter';
  if (p.kind === 'interact' || /^I\d+$/.test(String(p.id))) return 'interact';
  if (p.meme || p.kind === 'meme') return 'meme';
  return 'chatter';
}

/**
 * 把库里的三类台词同步成 dsh-pet 台词池（v3）：
 *   pools/chatter.txt   337 行日常碎碎念（随机抽）
 *   pools/interact.txt  50 行点击互动（随机抽）
 *   pools/meme.json     27 条表情包固定句
 *   pools/config.json   {"usePhrasePool":true,"memeFirst":true}（已存在则不覆盖，保留用户开关）
 * 内容一致时不重写；失败不抛错（不影响配音主流程）。
 */
export function syncPhrasePools(packId) {
  try {
    const { raw } = loadLibraryIndex(packId);
    const chatter = [];
    const interact = [];
    const meme = {};
    for (const p of raw.phrases) {
      if (!p || !p.text) continue;
      const kind = phraseKind(p);
      if (kind === 'interact') interact.push(p.text);
      else if (kind === 'meme') meme[p.meme || p.text] = p.text;
      else chatter.push(p.text);
    }
    if (!chatter.length && !interact.length && !Object.keys(meme).length) return null;
    const dir = poolDir();
    fs.mkdirSync(dir, { recursive: true });
    const writeIfChanged = (name, body) => {
      const file = path.join(dir, name);
      try {
        if (fs.readFileSync(file, 'utf8') === body) return;
      } catch {
        /* 文件不存在 → 继续写 */
      }
      fs.writeFileSync(file, body, 'utf8');
    };
    writeIfChanged('chatter.txt', chatter.join('\n') + '\n');
    writeIfChanged('interact.txt', interact.join('\n') + '\n');
    writeIfChanged('meme.json', JSON.stringify(meme, null, 2) + '\n');
    const cfgFile = path.join(dir, 'config.json');
    if (!fs.existsSync(cfgFile)) {
      fs.writeFileSync(cfgFile, JSON.stringify({ usePhrasePool: true, memeFirst: true }, null, 2) + '\n', 'utf8');
    }
    console.log(
      '[dsh-pet-voice] 已同步台词池：' + dir + '（chatter ' + chatter.length + ' / meme ' + Object.keys(meme).length + ' / interact ' + interact.length + '）',
    );
    return { dir, chatter: chatter.length, meme: Object.keys(meme).length, interact: interact.length };
  } catch {
    return null;
  }
}

/** 同步所有派生文件：表情包映射 + v3 台词池（安装完成 / 启动已装时调用） */
function syncDerivedFiles(packId) {
  syncMemeLinesFile(packId);
  syncPhrasePools(packId);
}

/**
 * 从 pools/<kind>.txt 抽一句（kind: interact | chatter），最近 10 次不重复。
 * 供点击互动（/api/library/pick）与其它宿主侧调用；池缺失返回 null（调用方回退）。
 */
const poolRecent = { chatter: [], interact: [] };
export function pickPoolLine(kind) {
  try {
    if (kind !== 'chatter' && kind !== 'interact') return null;
    const file = path.join(poolDir(), kind + '.txt');
    const lines = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    const recent = poolRecent[kind];
    const fresh = lines.filter((l) => !recent.includes(l));
    const pool = fresh.length ? fresh : lines;
    const text = pool[Math.floor(Math.random() * pool.length)];
    recent.push(text);
    while (recent.length > 10) recent.shift();
    return text;
  } catch {
    return null;
  }
}

/* ------------------------------ 安装 ------------------------------ */

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function computeContentSha(dir) {
  const parts = [];
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.opus'))
    .sort();
  for (const n of names) parts.push(sha256File(path.join(dir, n)) + '  ' + n + '\n');
  parts.push(sha256File(path.join(dir, 'index.json')) + '  index.json\n');
  return sha256(Buffer.from(parts.join(''), 'utf8'));
}

function copyDirInto(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    const d = path.join(destDir, name);
    if (fs.statSync(s).isDirectory()) fs.cpSync(s, d, { recursive: true });
    else fs.copyFileSync(s, d);
  }
}

function moveContents(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    const d = path.join(destDir, name);
    try {
      fs.renameSync(s, d);
    } catch (e) {
      if (e && e.code === 'EXDEV') {
        fs.cpSync(s, d, { recursive: true });
        fs.rmSync(s, { recursive: true, force: true });
      } else {
        throw e;
      }
    }
  }
}

/** 在目录（或其唯一子目录）里找到含 index.json 的根 */
function findPackRoot(dir) {
  if (fs.existsSync(path.join(dir, 'index.json'))) return dir;
  const dirs = fs.readdirSync(dir).filter((n) => {
    try {
      return fs.statSync(path.join(dir, n)).isDirectory() && fs.existsSync(path.join(dir, n, 'index.json'));
    } catch {
      return false;
    }
  });
  if (dirs.length === 1) return path.join(dir, dirs[0]);
  return null;
}

function extractTarBz2(tarPath, targetRoot, state) {
  return new Promise((resolve, reject) => {
    const w = new Worker(EXTRACT_WORKER, { workerData: { tarPath, targetRoot } });
    let settled = false;
    w.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'progress') {
        state.percent = 40 + Math.round((Number(msg.percent) || 0) * 0.45);
        state.message = '解压中 ' + (msg.message || '');
      } else if (msg.type === 'done') {
        settled = true;
        resolve();
      } else if (msg.type === 'error') {
        settled = true;
        reject(new Error(msg.error));
      }
    });
    w.on('error', (e) => {
      if (!settled) reject(e);
    });
  });
}

async function downloadPack(packId, urls, pack, state) {
  const dir = path.join(dataDir(), 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, packId + '.tar.bz2');
  const failures = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url.slice(0, 40);
      }
    })();
    try {
      state.message = `下载库包（${i + 1}/${urls.length}）${host}`;
      state.percent = Math.max(0, state.percent || 0);
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = Number(res.headers.get('content-length') || 0);
      const fh = fs.createWriteStream(dest);
      let got = 0;
      for await (const chunk of res.body) {
        fh.write(chunk);
        got += chunk.length;
        if (total) state.percent = Math.min(25, Math.round((got / total) * 25));
      }
      await new Promise((r) => fh.end(r));
      if (total && got < total) throw new Error('下载不完整 ' + got + '/' + total);
      return dest;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      failures.push(host + ': ' + msg);
      state.message = `镜像失败 ${i + 1}/${urls.length}（${host}），换源…`;
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error('所有镜像下载失败：' + (failures.join('；') || '无可用 URL'));
}

function validateInstalled(packId, pack) {
  const { raw, dir } = loadLibraryIndex(packId);
  const count = raw.phrases.length;
  const expect = Number((pack && pack.count) || raw.count || 0);
  if (expect && count !== expect) throw new Error(`库包条数不对：index=${count}，期望=${expect}`);
  if (raw.count && raw.count !== count) throw new Error(`index.json count=${raw.count} 与实际 ${count} 条不一致`);
  for (const p of raw.phrases) {
    const st = fs.statSync(path.join(dir, path.basename(p.file)));
    if (!st.size) throw new Error('库音频为空：' + p.file);
  }
  let contentSha256 = null;
  const manifestFile = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest && manifest.sha256) {
      contentSha256 = computeContentSha(dir);
      if (contentSha256 !== String(manifest.sha256).toLowerCase()) {
        throw new Error('库包内容 sha256 校验失败：' + contentSha256);
      }
    }
  }
  return { count, totalDur: raw.phrases.reduce((s, p) => s + (Number(p.dur) || 0), 0), contentSha256 };
}

/**
 * 安装库包（幂等，并发复用同一 promise）。
 * 来源优先级：DSH_PET_VOICE_LIBRARY_SRC（本地 tar.bz2 / 目录）→ pack.urls 多镜像下载。
 */
export async function ensureLibraryInstalled(packId, pack = {}) {
  if (libraryInstalled(packId)) {
    if (!libraryNeedsUpgrade(packId, pack)) {
      syncDerivedFiles(packId);
      return { installed: true, count: libraryCount(packId), source: 'existing' };
    }
    console.log(
      '[dsh-pet-voice] 原声库升级：' + packId + ' ' + libraryCount(packId) + ' → ' + (pack.count || '?') + ' 条',
    );
  }
  const running = progress.get(packId);
  if (running && running.state === 'installing' && running.promise) return running.promise;

  const state = { state: 'installing', percent: 0, message: '准备安装' };
  let rolledBack = false;
  progress.set(packId, state);
  state.promise = (async () => {
    const destDir = libraryDir(packId);
    const tempDir = path.join(modelsDir(), '.tmp-' + packId + '-' + Date.now());
    let source = 'download';
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.mkdirSync(tempDir, { recursive: true });
      const localSrc = process.env.DSH_PET_VOICE_LIBRARY_SRC || (pack && pack.localFile) || '';
      let tarPath = null;
      if (localSrc && fs.existsSync(localSrc)) {
        source = 'local:' + localSrc;
        if (fs.statSync(localSrc).isDirectory()) {
          state.percent = 15;
          state.message = '复制本地库包目录';
          copyDirInto(localSrc, tempDir);
        } else {
          tarPath = localSrc;
        }
      } else {
        const urls = ((pack && pack.urls) || []).filter(Boolean);
        if (!urls.length) throw new Error('库包未配置下载源（可设置 DSH_PET_VOICE_LIBRARY_SRC 指向本地 tar.bz2）');
        tarPath = await downloadPack(packId, urls, pack, state);
      }
      if (tarPath) {
        state.percent = 30;
        state.message = '校验 sha256';
        if (pack && pack.sha256) {
          const got = sha256File(tarPath);
          if (got !== String(pack.sha256).toLowerCase()) {
            throw new Error('库包 tar.bz2 sha256 不匹配：' + got);
          }
        }
        state.percent = 40;
        state.message = '解压库包';
        await extractTarBz2(tarPath, tempDir, state);
      }
      const srcRoot = findPackRoot(tempDir);
      if (!srcRoot) throw new Error('库包里没有找到 index.json');
      state.percent = 85;
      state.message = '校验索引';
      // 升级时先备份旧目录：新包校验通过才删备份，失败自动回滚，避免升级把已装好的库弄没
      const backupDir = destDir + '.old-' + Date.now();
      let movedOld = false;
      if (fs.existsSync(destDir)) {
        try {
          fs.renameSync(destDir, backupDir);
          movedOld = true;
        } catch {
          fs.rmSync(destDir, { recursive: true, force: true });
        }
      }
      fs.mkdirSync(destDir, { recursive: true });
      try {
        moveContents(srcRoot, destDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
        indexCache.delete(packId);
        const info = validateInstalled(packId, pack);
        if (movedOld) {
          try {
            fs.rmSync(backupDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
        state.state = 'done';
        state.percent = 100;
        state.message = '安装完成';
        syncDerivedFiles(packId);
        console.log(
          '[dsh-pet-voice] 原声库已安装：' + packId + '（' + info.count + ' 条，' + (info.contentSha256 || '').slice(0, 12) + '…）',
        );
        return {
          installed: true,
          count: info.count,
          version: Number((libraryInstalledManifest(packId) || {}).version || 0),
          totalDur: Math.round(info.totalDur * 100) / 100,
          contentSha256: info.contentSha256,
          source,
        };
      } catch (e) {
        // 回滚到旧库包
        try {
          fs.rmSync(destDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        if (movedOld) {
          try {
            fs.renameSync(backupDir, destDir);
            rolledBack = true;
          } catch {
            /* ignore */
          }
        }
        indexCache.delete(packId);
        throw e;
      }
    } catch (e) {
      state.state = 'error';
      state.message = '安装失败：' + ((e && e.message) || e);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      // 失败时移除不完整的目标目录，避免「半装」状态被误判为已安装；
      // 已经回滚到旧库包时（rolledBack）不能再删。
      if (state.state === 'error' && !rolledBack) {
        try {
          fs.rmSync(destDir, { recursive: true, force: true });
          indexCache.delete(packId);
        } catch {
          /* ignore */
        }
      }
    }
  })();
  return state.promise;
}
