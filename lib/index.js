/**
 * dsh-pet-voice 宿主半侧（Cordis 插件）
 * - 监听桌宠气泡（客户端半侧），把气泡文字念出来
 * - 在线：Breeze 自定义音色（用户自己的 API Key）
 * - 离线：Kokoro 中文女声（sherpa-onnx，worker 线程推理，模型首次按需下载）
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
    if (voice.engine === 'local') {
      const pack = (getCatalog().packs || {})[voice.params.pack];
      return !!pack && isModelInstalled(pack) && canUseLocal();
    }
    return false;
  }

  // 默认音色：第一个「非实验版」的本地音色（当前目录里是鱼鱼酱），
  // 没有则退第一个本地音色。仅用于「用户还没选过音色」的全新安装。
  function pickDefaultVoice(catalog) {
    const voices = (catalog && catalog.voices) || [];
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
        const pack = v.engine === 'local' ? packsById[v.params.pack] : null;
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
          needsDownload: v.engine === 'local' && !installed,
        };
      }),
      packs,
      engines: { local: canUseLocal() },
    };
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const rest = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname;
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
        const { voice, legacy } = resolveCatalogVoice(catalog, voiceId);
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
        const raw = rest === '/preview' ? PREVIEW_TEXT : url.searchParams.get('text') || '';
        const text = normalizeSpeechText(raw);
        if (!text) return sendJson(res, 400, { error: '文本为空' });
        const out = await synthesize(voice, text);
        res.writeHead(200, {
          'Content-Type': out.mime,
          'Content-Length': out.buf.length,
          'Cache-Control': 'no-store',
        });
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
        ensureModelDownloaded(pack).catch(() => {});
        return sendJson(res, 200, { ok: true, progress: getModelProgress(pack.model) });
      }

      if (rest === '/packs/progress') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const id = url.searchParams.get('id') || '';
        const pack = (getCatalog().packs || {})[id];
        return sendJson(res, 200, { progress: pack ? getModelProgress(pack.model) : null });
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

  // 首次安装（没有 Breeze Key）时后台预下载离线音色包，装完即可开口
  setTimeout(() => {
    try {
      const config = loadConfig();
      const catalog = getCatalog();
      const voice = findVoice(catalog, effectiveVoiceId(config)) || findVoice(catalog, catalog.defaultVoice);
      const pack = voice && voice.params && voice.params.pack ? (catalog.packs || {})[voice.params.pack] : null;
      if (pack && !isModelInstalled(pack)) ensureModelDownloaded(pack).catch(() => {});
    } catch {
      /* ignore */
    }
  }, 3000).unref?.();

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler,
    }),
  );

  console.log('[dsh-pet-voice] 已加载：' + PREFIX);
}
