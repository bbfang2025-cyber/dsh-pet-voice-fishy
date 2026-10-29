/**
 * Breeze 在线自定义音色引擎（用用户自己的 API Key 调 Breeze 开发者 API）
 * 文档：https://docs.breezeblue.ai（POST /v1/text-to-speech/{voice_id}）
 * 网络抖动做 3 次重试；401/403 直接给出"Key 无效"提示，不重试。
 */
const BASE = 'https://api.breezeblue.ai';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyError() {
  const err = new Error('Breeze API Key 无效或已重置，请到 Breeze 后台 API Keys 复制新的 Key');
  err.status = 409;
  return err;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeBreeze({ apiKey, voice, speed = 1.0, model = 'breeze-tts-2', text, timeoutMs = 30000 }) {
  if (!apiKey) {
    const err = new Error('未配置 Breeze API Key');
    err.status = 409;
    throw err;
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/v1/text-to-speech/${encodeURIComponent(voice)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ text, language_code: 'zh', model_id: model, voice_settings: { speed } }),
        },
        timeoutMs,
      );
      if (res.status === 401 || res.status === 403) throw keyError();
      if (!res.ok) {
        const detail = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        const err = new Error(`Breeze API ${res.status}: ${detail.slice(0, 200)}`);
        err.status = retryable ? 502 : 400;
        err.retryable = retryable;
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw Object.assign(new Error('Breeze API 返回空音频'), { retryable: true });
      return { buf, mime: 'audio/mpeg', ext: 'mp3' };
    } catch (e) {
      lastErr = e;
      const retryable = e.retryable !== false && e.status !== 409 && e.status !== 400;
      if (!retryable || attempt === 3) throw e;
      await sleep(600 * attempt);
    }
  }
  throw lastErr || new Error('Breeze 合成失败');
}

export async function listBreezeVoices(apiKey) {
  if (!apiKey) {
    const err = new Error('未配置 Breeze API Key');
    err.status = 409;
    throw err;
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchWithTimeout(`${BASE}/v1/voices`, { headers: { 'xi-api-key': apiKey } }, 15000);
      if (res.status === 401 || res.status === 403) throw keyError();
      if (!res.ok) throw new Error('Breeze API ' + res.status);
      const data = await res.json();
      return (data.voices || []).map((v) => ({
        voiceId: v.voice_id,
        name: v.name,
        origin: v.origin,
        description: v.description || '',
      }));
    } catch (e) {
      lastErr = e;
      if (attempt === 3) throw e;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}
