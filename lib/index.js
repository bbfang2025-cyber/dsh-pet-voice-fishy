/**
 * dsh-pet-voice 宿主半侧（Cordis 插件）
 * - 监听桌宠气泡（客户端半侧），把气泡文字念出来
 * - 在线：Breeze 自定义音色（用户自己的 API Key）
 * - 离线：Kokoro 中文女声（sherpa-onnx，worker 线程推理，模型首次按需下载）
 */
import { createRequire } from 'node:module';
import { loadConfig, saveConfig } from './config.mjs';
import { loadVoiceCatalog, findVoice } from './catalog.mjs';
import { synthesizeBreeze, listBreezeVoices } from './engines/breeze.mjs';
import { modelInstallState, getModelProgress, ensureModelDownloaded } from './download.mjs';
import { isModelInstalled, synthesizeLocal } from './engine.mjs';
import { cacheKey, readCache, writeCache } from './cache.mjs';

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

/** 朗读前的文本归一化：去 Markdown / 表情 / 链接 / 多余空白 */
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

export async function apply(ctx) {
  let catalogCache = { at: 0, value: null };
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

  // 没有 Breeze Key（例如市场用户）时，默认音色自动落到第一个离线女声
  function effectiveVoiceId(config) {
    const catalog = getCatalog();
    const voice = findVoice(catalog, config.voiceId);
    if (voice && voice.engine === 'breeze' && !config.breezeApiKey) {
      const local = catalog.voices.find((v) => v.engine === 'local');
      if (local) return local.id;
    }
    return config.voiceId;
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
    const config = loadConfig();
    const packs = packStates();
    return {
      config: {
        ...config,
        voiceId: effectiveVoiceId(config),
        breezeApiKey: undefined,
        breezeConfigured: !!config.breezeApiKey,
        breezeKeyHint: maskKey(config.breezeApiKey || ''),
      },
      voices: catalog.voices.map((v) => {
        const pack = v.engine === 'local' ? packs[v.params.pack] : null;
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
            const voice = findVoice(catalog, body.voiceId);
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
            patch.voiceId = body.voiceId;
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
        const voice = findVoice(catalog, voiceId);
        if (!voice) return sendJson(res, 404, { error: '未知音色: ' + voiceId });
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

      if (rest === '/breeze/voices') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const config = loadConfig();
        const voices = await listBreezeVoices(config.breezeApiKey || '');
        return sendJson(res, 200, { voices });
      }

      if (rest === '/packs') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return sendJson(res, 200, { packs: packStates() });
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
      console.warn('[dsh-pet-voice] 请求失败:', e && e.message ? e.message : String(e));
      const status = e && e.status ? e.status : 500;
      sendJson(res, status, { error: e && e.message ? e.message : String(e) });
    }
  };

  // 首次安装（没有 Breeze Key）时后台预下载离线音色包，装完即可开口
  setTimeout(() => {
    try {
      const config = loadConfig();
      if (config.breezeApiKey) return;
      const pack = (getCatalog().packs || {})['kokoro'];
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
