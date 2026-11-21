/**
 * dsh-pet-voice 宿主半侧（Cordis 插件）
 * - 监听桌宠气泡（客户端半侧），把气泡文字念出来
 * - 在线：Breeze 自定义音色（用户自己的 API Key）
 * - 离线：鱼鱼酱 / 鱼鱼姐（VITS，sherpa-onnx，worker 线程推理，模型首次按需下载）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadRawConfig, saveConfig } from './config.mjs';
import { loadVoiceCatalog, findVoice } from './catalog.mjs';
import { synthesizeBreeze, listBreezeVoices } from './engines/breeze.mjs';
import { modelInstallState, getModelProgress, ensureModelDownloaded } from './download.mjs';
import { isModelInstalled, synthesizeLocal } from './engine.mjs';
import { cacheKey, readCache, writeCache } from './cache.mjs';
import {
  libraryDir,
  libraryCount,
  libraryInstalled,
  libraryInstalledManifest,
  libraryInstallState,
  libraryPreviewText,
  poolDir,
  pickPoolLine,
  getLibraryProgress,
  ensureLibraryInstalled,
  lookupLibrary,
  readLibraryAudio,
  libraryStats,
  resetLibraryStats,
  lastLibraryMiss,
} from './library.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export const name = 'dsh-pet-voice-fishy';
export const inject = ['webServer'];

const PREFIX = '/dsh-pet-voice';
// 原声库统计等接口同时挂到根路径 /api/library，便于第三方/验收直接访问
const LIB_API = '/api/library';
const PREVIEW_TEXT = '主人，小鱼在这呢';
const MAX_CHARS = 200;

let sherpaAvailable = null;
function canUseLocal() {
  if (sherpaAvailable !== null) return sherpaAvailable;
  try {
    createRequire(import.meta.url)('sherpa-onnx-node');
    sherpaAvailable = true;
  } catch {
    sherpaAvailable = false;
  }
  return sherpaAvailable;
}

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const ZH_UNITS = ['', '十', '百', '千'];

/** 1~4 位数字的中文读法 */
function readFourDigits(digits) {
  let out = '';
  let zero = false;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    const unit = ZH_UNITS[digits.length - 1 - i];
    if (d === 0) {
      zero = true;
      continue;
    }
    if (zero && out) out += '零';
    zero = false;
    out += ZH_DIGITS[d] + unit;
  }
  if (digits.length === 2 && digits[0] === '1') {
    out = out.replace(/^一十/, '十');
  }
  return out || '零';
}

/** 阿拉伯数字 → 中文读法（支持小数，最大到亿；更长的按位读） */
function readNumber(numText) {
  const [intPartRaw, decPart] = numText.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '');
  let intText = '';
  if (intPart.length <= 4) {
    intText = readFourDigits(intPart);
  } else if (intPart.length <= 8) {
    const high = intPart.slice(0, intPart.length - 4);
    const low = intPart.slice(intPart.length - 4);
    intText = readFourDigits(high) + '万';
    if (!/^0+$/.test(low)) {
      intText += (low[0] === '0' ? '零' : '') + readFourDigits(low.replace(/^0+/, ''));
    }
  } else {
    return intPart.split('').map((d) => ZH_DIGITS[Number(d)]).join('');
  }
  if (decPart) {
    intText += '点' + decPart.split('').map((d) => ZH_DIGITS[Number(d)]).join('');
  }
  return intText;
}

/** 朗读前的文本归一化：去 Markdown / 表情 / 链接 / 多余空白，数字转中文 */
export function normalizeSpeechText(input) {
  let text = String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 百分比 / 小数 / 整数 → 中文（Piper 中文音色包的中文前端不认阿拉伯数字）
  text = text
    .replace(/(\d+(?:\.\d+)?)\s*([%％])/g, (_m, n) => '百分之' + readNumber(n))
    .replace(/\d+(?:\.\d+)?/g, (n) => readNumber(n));
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '…';
  return text;
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// 旧版本（≤1.1.2）的音色 id → 1.2.0 音色 id。
// 1.2.0 起鱼鱼酱 / 鱼鱼姐改为本地离线音色，id 保持不变；这里仍做兜底映射，
// 兼容可能出现的旧写法 / 未来改名，避免老用户升级后指向不存在的音色而无声。
export const LEGACY_VOICE_IDS = {
  'breeze-yuyujiang': 'breeze-yuyujiang',
  'breeze-yuyujie': 'breeze-yuyujie',
  yuyujiang: 'breeze-yuyujiang',
  yuyujie: 'breeze-yuyujie',
  'local-yuyujiang': 'breeze-yuyujiang',
  'local-yuyujie': 'breeze-yuyujie',
};

/** 把配置里的音色 id 解析成目录里的音色；旧 id 自动迁移，实在找不到就落到第一个本地音色 */
export function resolveCatalogVoice(catalog, voiceId) {
  const voices = (catalog && catalog.voices) || [];
  const direct = findVoice(catalog, voiceId);
  if (direct) return { voice: direct, legacy: false };
  const mapped = LEGACY_VOICE_IDS[voiceId];
  if (mapped) {
    const v = findVoice(catalog, mapped);
    if (v) return { voice: v, legacy: true };
  }
  const fallback = voices.find((v) => v.engine === 'local') || voices[0] || null;
  return { voice: fallback, legacy: true };
}

export async function apply(ctx) {
  let catalogCache = { at: 0, value: null };
  // 播放仲裁状态（进程级）：防止同一 DSH 下多个页面/窗口重复朗读
  const claim = { norm: '', at: 0, autoAt: 0 };
  const normForClaim = (text) =>
    String(text || '')
      .replace(/[\s\u3000]/g, '')
      .replace(/[\p{P}\p{S}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .toLowerCase();
  const getCatalog = () => {
    if (!catalogCache.value || Date.now() - catalogCache.at > 5000) {
      catalogCache.value = loadVoiceCatalog();
      catalogCache.at = Date.now();
    }
    return catalogCache.value;
  };

  function voiceAvailable(voice, config) {
    if (voice.engine === 'breeze') return !!config.breezeApiKey;
    if (voice.engine === 'library') return libraryInstalled(voice.params.pack);
    if (voice.engine === 'local') {
      const pack = (getCatalog().packs || {})[voice.params.pack];
      return !!pack && isModelInstalled(pack) && canUseLocal();
    }
    return false;
  }

  // 目录里的原声库音色（engine === 'library'，目前是「御姐·原声库」）
  const libraryVoices = (catalog) => ((catalog && catalog.voices) || []).filter((v) => v.engine === 'library');

  // v1.4.0：请求的本地音色包没装时，挑第一个「已安装可用」的本地音色顶上，绝不静默 503。
  function packInstalledForVoice(voice) {
    if (!voice) return false;
    if (voice.engine === 'library') return libraryInstalled(voice.params.pack);
    if (voice.engine !== 'local') return false;
    const pack = (getCatalog().packs || {})[voice.params.pack];
    return !!pack && isModelInstalled(pack) && canUseLocal();
  }

  function firstInstalledLocalVoice(catalog, excludeId) {
    const voices = (catalog && catalog.voices) || [];
    const local = voices.filter((v) => v.engine === 'local');
    const candidates = local.filter((v) => v.id !== excludeId && packInstalledForVoice(v));
    // 优先非实验版（鱼鱼酱），再考虑实验版/其它
    const normal = candidates.find((v) => !(Array.isArray(v.tags) && v.tags.includes('实验')));
    return normal || candidates[0] || null;
  }

  // 原声库未命中时的模型兜底：优先同音色族（yujie-lib → 鱼鱼姐），否则第一个已装本地音色
  function voiceForLibraryFallback(catalog, voice) {
    const preferredId = voice && voice.params && voice.params.fallbackVoice;
    if (preferredId) {
      const v = findVoice(catalog, preferredId);
      if (v && packInstalledForVoice(v)) return v;
    }
    return firstInstalledLocalVoice(catalog, voice ? voice.id : '');
  }

  // 默认音色：优先 voices.json 里显式 `default:true` 的音色（v1.6.0 起是「御姐·原声库」），
  // 其次第一个「非实验版」本地音色（鱼鱼酱），再退第一个本地音色。
  // 仅用于「用户还没选过音色」的全新安装；config 里已有 voiceId 的保持不变。
  function pickDefaultVoice(catalog) {
    const voices = (catalog && catalog.voices) || [];
    const flagged =
      voices.find((v) => v.default === true) || (catalog && catalog.defaultVoice ? findVoice(catalog, catalog.defaultVoice) : null);
    if (flagged) return flagged;
    const local = voices.filter((v) => v.engine === 'local');
    const normal = local.find((v) => !(Array.isArray(v.tags) && v.tags.includes('实验')));
    return normal || local[0] || voices[0] || null;
  }

  // config.json 里是否真的存过 voiceId（区分新装默认值 vs 用户主动选择）
  function hasExplicitVoiceId() {
    const raw = loadRawConfig();
    return !!(raw && typeof raw.voiceId === 'string' && raw.voiceId.trim());
  }

  // 没有 Breeze Key（例如市场用户）时，默认音色自动落到第一个离线女声
  function effectiveVoiceId(config) {
    const catalog = getCatalog();
    const { voice } = resolveCatalogVoice(catalog, config.voiceId);
    if (hasExplicitVoiceId() && voice) {
      if (voice.engine === 'breeze' && !config.breezeApiKey) {
        const def = pickDefaultVoice(catalog);
        if (def) return def.id;
      }
      return voice.id;
    }
    const def = pickDefaultVoice(catalog);
    return def ? def.id : config.voiceId;
  }

  // 1.2.0 升级兜底：老用户 config.json 里可能是旧音色 id / 已不存在的 id。
  // 解析成功后把新 id 写回配置，并确认一次日志，避免升级后「静默无声」。
  // 1.3.3：全新安装（config 里没有 voiceId）不再硬编码，默认取第一个非实验版本地音色；
  //        用户明确选过的值（如鱼鱼姐）保持不变。
  const migratedIds = new Set();
  function migrateConfigVoice(config) {
    const catalog = getCatalog();
    if (!hasExplicitVoiceId()) {
      const def = pickDefaultVoice(catalog);
      if (def) return { catalog, voice: def, config: { ...config, voiceId: def.id } };
      return { catalog, voice: null, config };
    }
    const { voice, legacy } = resolveCatalogVoice(catalog, config.voiceId);
    if (!voice) {
      const def = pickDefaultVoice(catalog);
      if (def) {
        try {
          saveConfig({ voiceId: def.id });
        } catch {
          /* ignore */
        }
        return { catalog, voice: def, config: { ...config, voiceId: def.id } };
      }
      return { catalog, voice: null, config };
    }
    if (legacy || voice.id !== config.voiceId) {
      if (!migratedIds.has(config.voiceId)) {
        migratedIds.add(config.voiceId);
        console.log('[dsh-pet-voice] 音色配置已迁移：' + config.voiceId + ' → ' + voice.id + '（本地离线音色）');
      }
      try {
        saveConfig({ voiceId: voice.id });
      } catch {
        /* ignore */
      }
      return { catalog, voice, config: { ...config, voiceId: voice.id } };
    }
    return { catalog, voice, config };
  }

  function packStates() {
    const packs = getCatalog().packs || {};
    const out = {};
    for (const [id, pack] of Object.entries(packs)) {
      if (pack.kind === 'library') {
        const state = libraryInstallState(id);
        out[id] = {
          id,
          name: pack.name,
          desc: pack.desc,
          sizeMB: pack.sizeMB,
          kind: 'library',
          installed: state.installed,
          progress: state.progress,
        };
        continue;
      }
      const state = modelInstallState(pack);
      out[id] = {
        id,
        name: pack.name,
        desc: pack.desc,
        sizeMB: pack.sizeMB,
        installed: state.installed,
        progress: state.progress,
      };
    }
    return out;
  }

  async function synthesize(voice, text) {
    const config = loadConfig();
    const isLocal = voice.engine === 'local';
    const ext = isLocal ? 'wav' : 'mp3';
    const key = cacheKey(voice.id + '@' + (voice.params.speed || 1), text);
    const cached = readCache(key, ext);
    if (cached) return { buf: cached, mime: isLocal ? 'audio/wav' : 'audio/mpeg' };

    let out;
    if (voice.engine === 'breeze') {
      out = await synthesizeBreeze({
        apiKey: config.breezeApiKey || '',
        voice: voice.params.voice,
        speed: voice.params.speed || 1.0,
        model: voice.params.model || 'breeze-tts-2',
        text,
      });
    } else if (voice.engine === 'local') {
      const pack = (getCatalog().packs || {})[voice.params.pack];
      if (!pack) throw Object.assign(new Error('未知音色包'), { status: 400 });
      if (!isModelInstalled(pack)) {
        ensureModelDownloaded(pack).catch(() => {});
        const progress = getModelProgress(pack.model) || {};
        throw Object.assign(new Error('离线音色包下载中 ' + (progress.percent || 0) + '%'), { status: 503 });
      }
      const buf = await synthesizeLocal(pack, text, voice.params.sid, voice.params.speed);
      out = { buf, mime: 'audio/wav', ext: 'wav' };
    } else {
      throw Object.assign(new Error('不支持的音色引擎: ' + voice.engine), { status: 400 });
    }
    writeCache(key, out.ext, out.buf);
    return out;
  }

  function statePayload() {
    const catalog = getCatalog();
    const migrated = migrateConfigVoice(loadConfig());
    const config = migrated.config;
    const packsById = packStates();
    // 对外统一成数组（第三方/自查直接用 .map/.filter，不必猜是对象还是数组）
    const packs = Object.values(packsById);
    return {
      version: VERSION,
      config: {
        ...config,
        voiceId: effectiveVoiceId(config),
        breezeApiKey: undefined,
        breezeConfigured: !!config.breezeApiKey,
        breezeKeyHint: maskKey(config.breezeApiKey || ''),
      },
      voices: catalog.voices.map((v) => {
        const pack = v.engine === 'local' || v.engine === 'library' ? packsById[v.params.pack] : null;
        const installed = pack ? pack.installed : true;
        return {
          id: v.id,
          name: v.name,
          desc: v.desc,
          engine: v.engine,
          online: v.online,
          tags: v.tags,
          pack: v.params.pack || null,
          available: voiceAvailable(v, config),
          needsBreezeKey: v.engine === 'breeze' && !config.breezeApiKey,
          needsDownload: (v.engine === 'local' || v.engine === 'library') && !installed,
        };
      }),
      packs,
      engines: { local: canUseLocal() },
    };
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      // 同一个 handler 同时挂在 /dsh-pet-voice 与根路径 /api/library 两个前缀上
      const full = url.pathname;
      let rest;
      if (full.startsWith(PREFIX)) rest = full.slice(PREFIX.length) || '/';
      else if (full === LIB_API || full.startsWith(LIB_API + '/')) rest = full;
      else return sendJson(res, 404, { error: 'not found' });
      const method = (req.method || 'GET').toUpperCase();

      if (rest === '/state' || rest === '/') {
        if (method === 'GET') return sendJson(res, 200, statePayload());
        if (method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const patch = {};
          if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
          if (typeof body.volume === 'number') patch.volume = Math.max(0, Math.min(1, body.volume));
          if (typeof body.minIntervalSec === 'number') {
            patch.minIntervalSec = Math.max(0, Math.min(3600, Math.round(body.minIntervalSec)));
          }
          if (typeof body.libraryFirst === 'boolean') patch.libraryFirst = body.libraryFirst;
          if (typeof body.voiceId === 'string') {
            const catalog = getCatalog();
            const config = loadConfig();
            const { voice, legacy } = resolveCatalogVoice(catalog, body.voiceId);
            if (!voice) return sendJson(res, 400, { error: '未知音色' });
            if (voice.engine === 'breeze' && !config.breezeApiKey) {
              return sendJson(res, 409, { error: '该音色需要先在下方「自定义音色」里填 Breeze API Key' });
            }
            if (voice.engine === 'local') {
              const pack = (catalog.packs || {})[voice.params.pack];
              if (!pack) return sendJson(res, 400, { error: '音色包未配置' });
              if (!isModelInstalled(pack)) {
                ensureModelDownloaded(pack).catch(() => {});
              }
            }
            if (voice.engine === 'library') {
              const pack = (catalog.packs || {})[voice.params.pack];
              if (!pack) return sendJson(res, 400, { error: '库包未配置' });
              // 未安装会安装；已装旧版（如 v1 337 条）会按 voices.json 自动升级
              ensureLibraryInstalled(voice.params.pack, pack).catch(() => {});
            }
            patch.voiceId = voice.id;
            if (legacy || voice.id !== body.voiceId) {
              console.log('[dsh-pet-voice] 音色配置已迁移：' + body.voiceId + ' → ' + voice.id + '（本地离线音色）');
            }
          }
          if (typeof body.breezeApiKey === 'string') {
            const k = body.breezeApiKey.trim();
            if (k && !k.startsWith('brz_')) {
              return sendJson(res, 400, { error: 'API Key 格式不对：应以 brz_ 开头（不是音色 ID）' });
            }
            patch.breezeApiKey = k;
          }
          saveConfig(patch);
          catalogCache.value = null;
          return sendJson(res, 200, statePayload());
        }
        return sendJson(res, 405, { error: 'method not allowed' });
      }

      if (rest === '/tts' || rest === '/preview') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const catalog = getCatalog();
        const config = loadConfig();
        const voiceId = url.searchParams.get('voice') || effectiveVoiceId(config);
        const resolved = resolveCatalogVoice(catalog, voiceId);
        let voice = resolved.voice;
        const legacy = resolved.legacy;
        if (!voice) return sendJson(res, 404, { error: '未知音色: ' + voiceId });
        if (legacy || voice.id !== voiceId) {
          console.log('[dsh-pet-voice] 音色配置已迁移：' + voiceId + ' → ' + voice.id + '（本地离线音色）');
          try {
            saveConfig({ voiceId: voice.id });
          } catch {
            /* ignore */
          }
        }
        if (voice.engine === 'breeze' && !config.breezeApiKey) {
          return sendJson(res, 409, { error: '请先配置 Breeze API Key' });
        }
        // 库包未安装：「试听」与「朗读」都返回 503 + 安装进度，并自动触发安装。
        // 客户端收到 503 后显示「音色包下载中 x%」，装完自动重试试听/朗读；不再静默回退模型。
        if (voice.engine === 'library') {
          const pack = (catalog.packs || {})[voice.params.pack];
          if (!pack) return sendJson(res, 400, { error: '原声库包未配置: ' + voice.params.pack });
          if (!libraryInstalled(voice.params.pack)) {
            ensureLibraryInstalled(voice.params.pack, pack).catch(() => {});
            const progress = getLibraryProgress(voice.params.pack) || { state: 'installing', percent: 0, message: '准备安装' };
            const percent = Number(progress.percent) || 0;
            return sendJson(res, 503, {
              error: '原声库下载中 ' + percent + '%',
              message: '「' + (voice.name || voice.id) + '」正在下载/安装（' + percent + '%），完成后会自动重试试听',
              code: 'LIBRARY_INSTALLING',
              action: 'installing',
              progress,
              requestedVoice: voice.id,
              pack: { id: voice.params.pack, name: pack.name, count: pack.count, sizeMB: pack.sizeMB },
            });
          }
        }
        // 库音色试听：用库内首句，保证点到「试听」听到的是原声而不是模型
        const raw =
          rest === '/preview'
            ? voice.engine === 'library'
              ? libraryPreviewText(voice.params.pack) || PREVIEW_TEXT
              : PREVIEW_TEXT
            : url.searchParams.get('text') || '';
        if (!String(raw).trim()) return sendJson(res, 400, { error: '文本为空' });
        let requestedVoice = voice;
        let fallback = false;

        // —— 第一优先级：原声库（归一化后精确匹配）——
        // 装了库包就先查库；命中直接返回库内 opus，不进入任何模型推理。
        let libHit = null;
        if (config.libraryFirst !== false) {
          for (const lv of libraryVoices(catalog)) {
            if (!libraryInstalled(lv.params.pack)) continue;
            const hit = lookupLibrary(lv.params.pack, raw);
            if (hit) {
              libHit = { voice: lv, hit };
              break;
            }
          }
        }
        if (libHit) {
          const buf = readLibraryAudio(libHit.hit.packId, libHit.hit.entry);
          const libHeaders = {
            'Content-Type': 'audio/ogg',
            'Content-Length': buf.length,
            'Cache-Control': 'no-store',
            'X-DSH-Pet-Voice-Source': 'library',
            'X-DSH-Pet-Voice-Voice': libHit.voice.id,
            'X-DSH-Pet-Voice-Voice-Name': encodeURIComponent(libHit.voice.name || libHit.voice.id),
            'X-DSH-Pet-Voice-Library': libHit.hit.packId,
            'X-DSH-Pet-Voice-Id': libHit.hit.entry.id,
            'X-DSH-Pet-Voice-Duration': String(libHit.hit.entry.dur == null ? '' : libHit.hit.entry.dur),
          };
          // 表情包固定台词条目（id M01..M27）带 meme 字段，方便 dsh-pet/验收核对
          if (libHit.hit.entry.meme) libHeaders['X-DSH-Pet-Voice-Meme'] = encodeURIComponent(libHit.hit.entry.meme);
          res.writeHead(200, libHeaders);
          res.end(buf);
          return;
        }

        // —— 第二优先级：原有模型（离线 VITS / Breeze）——
        if (voice.engine === 'library') {
          // 选的是「御姐·原声库」但库里没有这句：先退同音色族离线模型，再退第一个已装模型
          const fallbackVoice = voiceForLibraryFallback(catalog, voice);
          if (fallbackVoice) {
            console.log('[dsh-pet-voice] 原声库未命中，回退模型：' + voice.id + ' → ' + fallbackVoice.id);
            voice = fallbackVoice;
            fallback = true;
          } else {
            return sendJson(res, 404, {
              error: '原声库未命中，且没有可用的离线模型',
              code: 'LIBRARY_MISS',
              source: 'none',
              text: String(raw).slice(0, 80),
              hint: '这句话不在原声库里；可安装离线音色包（鱼鱼酱 / 鱼鱼姐）后重试，或改用在线音色',
              library: {
                pack: requestedVoice.params.pack,
                installed: libraryInstalled(requestedVoice.params.pack),
              },
              stats: libraryStats(),
            });
          }
        }

        const text = normalizeSpeechText(raw);
        if (!text) return sendJson(res, 400, { error: '文本为空' });

        // v1.4.0：本地音色包缺失时自动回退到第一个已安装可用的本地音色，绝不静默 503。
        // 同时后台继续下载用户请求的那个包，下次请求就能用回它。
        if (voice.engine === 'local') {
          const pack = (catalog.packs || {})[voice.params.pack];
          if (!pack) return sendJson(res, 400, { error: '未知音色包: ' + voice.params.pack });
          if (!isModelInstalled(pack)) {
            ensureModelDownloaded(pack).catch(() => {});
            const alt = firstInstalledLocalVoice(catalog, voice.id);
            if (alt) {
              const altPack = (catalog.packs || {})[alt.params.pack];
              console.log(
                '[dsh-pet-voice] 音色包未安装，回退：' + voice.id + ' → ' + alt.id + '（' + (altPack && altPack.name) + '）',
              );
              voice = alt;
              fallback = true;
            } else {
              const progress = getModelProgress(pack.model) || {};
              const percent = progress.percent || 0;
              return sendJson(res, 503, {
                error: '音色包下载中 ' + percent + '%',
                message: '你选的音色包正在下载（' + percent + '%），下载完会自动说话',
                progress,
                requestedVoice: requestedVoice.id,
                action: 'download',
              });
            }
          }
        }
        const out = await synthesize(voice, text);
        const headers = {
          'Content-Type': out.mime,
          'Content-Length': out.buf.length,
          'Cache-Control': 'no-store',
          'X-DSH-Pet-Voice-Source': 'model',
        };
        if (fallback) {
          headers['X-DSH-Pet-Voice-Fallback'] = '1';
          headers['X-DSH-Pet-Voice-Voice'] = voice.id;
          headers['X-DSH-Pet-Voice-Voice-Name'] = encodeURIComponent(voice.name || voice.id);
          headers['X-DSH-Pet-Voice-Requested'] = requestedVoice.id;
        }
        res.writeHead(200, headers);
        res.end(out.buf);
        return;
      }

      // 全局播放仲裁：同一 DSH 实例下（桌面窗口 + 浏览器标签页）只允许一个页面出声
      if (rest === '/claim') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        let body = {};
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          /* ignore */
        }
        const text = String(body.text || '');
        const force = !!body.force;
        const interval = Math.max(0, Math.min(3600, Number(body.intervalSec) || 0));
        const now = Date.now();
        const norm = normForClaim(text);
        if (!norm) return sendJson(res, 200, { allow: false, reason: 'empty' });
        if (!force) {
          if (claim.norm === norm && now - claim.at < 6000) {
            return sendJson(res, 200, { allow: false, reason: 'duplicate' });
          }
          if (interval > 0 && now - claim.autoAt < interval * 1000) {
            return sendJson(res, 200, { allow: false, reason: 'rate-limit' });
          }
        }
        claim.norm = norm;
        claim.at = now;
        if (!force) claim.autoAt = now;
        return sendJson(res, 200, { allow: true });
      }

      if (rest === '/breeze/voices') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const config = loadConfig();
        const voices = await listBreezeVoices(config.breezeApiKey || '');
        return sendJson(res, 200, { voices });
      }

      if (rest === '/packs') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return sendJson(res, 200, { packs: Object.values(packStates()) });
      }

      if (rest === '/packs/install') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        const id = url.searchParams.get('id') || '';
        const pack = (getCatalog().packs || {})[id];
        if (!pack) return sendJson(res, 400, { ok: false, error: '未知音色包: ' + id });
        if (pack.kind === 'library') {
          ensureLibraryInstalled(id, pack).catch(() => {});
          return sendJson(res, 200, { ok: true, progress: getLibraryProgress(id) });
        }
        ensureModelDownloaded(pack).catch(() => {});
        return sendJson(res, 200, { ok: true, progress: getModelProgress(pack.model) });
      }

      if (rest === '/packs/progress') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const id = url.searchParams.get('id') || '';
        const pack = (getCatalog().packs || {})[id];
        if (pack && pack.kind === 'library') return sendJson(res, 200, { progress: getLibraryProgress(id) });
        return sendJson(res, 200, { progress: pack ? getModelProgress(pack.model) : null });
      }

      // —— 原声库：统计 / 状态 / 安装（同时支持 /dsh-pet-voice/api/library/* 与根路径 /api/library/*）——
      if (rest === '/api/library/stats' || rest === '/library/stats') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return sendJson(res, 200, libraryStats());
      }

      if (rest === '/api/library/stats/reset' || rest === '/library/stats/reset') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        resetLibraryStats();
        return sendJson(res, 200, libraryStats());
      }

      // 点击互动 / 其它宿主侧随机抽句：GET /api/library/pick?kind=interact|chatter
      if (rest === '/api/library/pick' || rest === '/library/pick') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const kind = (url.searchParams.get('kind') || 'interact').toLowerCase();
        if (kind !== 'interact' && kind !== 'chatter') {
          return sendJson(res, 400, { ok: false, reason: 'bad-kind', error: 'kind 只能是 interact / chatter' });
        }
        const text = pickPoolLine(kind);
        if (!text) return sendJson(res, 200, { ok: false, reason: 'pool-empty', kind });
        return sendJson(res, 200, { ok: true, kind, text, source: 'pool-' + kind, pool: kind + '.txt' });
      }

      if (rest === '/api/library/status' || rest === '/library/status') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const catalog = getCatalog();
        const packs = Object.entries(catalog.packs || {})
          .filter(([, p]) => p.kind === 'library')
          .map(([id, p]) => {
            const state = libraryInstallState(id);
            const manifest = state.installed ? libraryInstalledManifest(id) : null;
            return {
              id,
              name: p.name,
              installed: state.installed,
              count: state.installed ? libraryCount(id) : 0,
              version: manifest ? Number(manifest.version || 0) : 0,
              contentSha256: manifest ? manifest.sha256 || null : null,
              progress: state.progress,
              dir: libraryDir(id),
            };
          });
        const readPoolCounts = () => {
          try {
            const dir = poolDir();
            const countLines = (n) => {
              try {
                return fs.readFileSync(path.join(dir, n), 'utf8').split(/\r?\n/).filter((s) => s.trim()).length;
              } catch {
                return 0;
              }
            };
            let meme = 0;
            try {
              meme = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'meme.json'), 'utf8'))).length;
            } catch {
              /* ignore */
            }
            let config = null;
            try {
              config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
            } catch {
              /* ignore */
            }
            return { dir, chatter: countLines('chatter.txt'), interact: countLines('interact.txt'), meme, config };
          } catch {
            return null;
          }
        };
        return sendJson(res, 200, {
          stats: libraryStats(),
          lastMiss: lastLibraryMiss(),
          packs,
          pools: readPoolCounts(),
          voices: libraryVoices(catalog).map((v) => ({
            id: v.id,
            name: v.name,
            pack: v.params.pack,
            installed: libraryInstalled(v.params.pack),
          })),
        });
      }

      if (rest === '/api/library/install' || rest === '/library/install') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        const catalog = getCatalog();
        const lv = libraryVoices(catalog);
        const id = url.searchParams.get('id') || (lv[0] && lv[0].params.pack) || '';
        const pack = (catalog.packs || {})[id];
        if (!pack) return sendJson(res, 400, { ok: false, error: '未知库包: ' + id });
        if (pack.kind !== 'library') return sendJson(res, 400, { ok: false, error: '不是原声库包: ' + id });
        const result = await ensureLibraryInstalled(id, pack);
        return sendJson(res, 200, { ok: true, ...result, dir: libraryDir(id) });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      // 排障友好：宿主日志打完整堆栈，响应里带 error + 前几行 stack（前端仍只展示 error）
      const msg = e && e.message ? e.message : String(e);
      const stack = String((e && e.stack) || e);
      console.warn('[dsh-pet-voice] 请求失败:', stack);
      const status = e && e.status ? e.status : 500;
      sendJson(res, status, { error: msg, detail: stack.split('\n').slice(0, 6).join('\n') });
    }
  };

  // v1.4.0 首装预下载：插件一加载就在后台把「默认音色包」拉下来（带进度），
  // 用户不用先点试听；气泡朗读请求若正好撞上下载，会拿到可显示的进度并自动重试。
  setTimeout(() => {
    try {
      const config = loadConfig();
      const catalog = getCatalog();
      const voice = findVoice(catalog, effectiveVoiceId(config)) || findVoice(catalog, catalog.defaultVoice);
      const pack = voice && voice.params && voice.params.pack ? (catalog.packs || {})[voice.params.pack] : null;
      if (pack && pack.kind !== 'library' && !isModelInstalled(pack)) {
        console.log('[dsh-pet-voice] 首装预下载默认音色包：' + pack.name);
        ensureModelDownloaded(pack).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, 800).unref?.();

  // 原声库：插件加载后在后台安装（若已配置下载源 / 设置了 DSH_PET_VOICE_LIBRARY_SRC）。
  // 装好后 /tts 自动「库优先」；失败不影响已有的 VITS 模型路径。
  // DSH_PET_VOICE_AUTO_INSTALL=0 可关闭后台自动安装（验收/排障用，试听时仍会触发按需安装）。
  setTimeout(() => {
    if (process.env.DSH_PET_VOICE_AUTO_INSTALL === '0') return;
    try {
      const catalog = getCatalog();
      for (const v of libraryVoices(catalog)) {
        const pack = (catalog.packs || {})[v.params.pack];
        if (pack) {
          if (!libraryInstalled(v.params.pack)) console.log('[dsh-pet-voice] 后台安装原声库：' + v.params.pack);
          ensureLibraryInstalled(v.params.pack, pack).catch((e) => {
            console.warn('[dsh-pet-voice] 原声库安装失败：' + ((e && e.message) || e));
          });
        }
      }
    } catch {
      /* ignore */
    }
  }, 900).unref?.();

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler,
    }),
  );

  // 统计等原声库接口同时挂在根路径 /api/library（验收/第三方可直接访问）。
  // 用 try/catch 包住：万一宿主保留了 /api 命名空间、拒绝该路由，也不影响插件主功能。
  ctx.effect(() => {
    try {
      return ctx.webServer.register({
        kind: 'prefix',
        path: LIB_API,
        handler,
      });
    } catch (e) {
      console.warn('[dsh-pet-voice] 根路径 /api/library 注册失败（不影响 /dsh-pet-voice/api/library）：' + ((e && e.message) || e));
      return () => {};
    }
  });

  console.log('[dsh-pet-voice] 已加载：' + PREFIX);
}
