/** 音色清单与音色包状态 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelsDir } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '..', 'assets');

function modelExists(dir) {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.onnx'));
  } catch {
    return false;
  }
}

/** 某个本地模型是否已安装（每次都查磁盘，安装完立即可见） */
export function isModelInstalled(model) {
  return modelExists(path.join(modelsDir(), model));
}

export function loadVoiceCatalog() {
  const file = path.join(ASSETS_DIR, 'voices.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const voices = (raw.voices || []).map((v) => {
    const out = { ...v };
    if (v.engine === 'local') {
      out.installed = isModelInstalled(v.params.model);
      out.pack = v.params.pack;
    } else {
      out.installed = true;
    }
    return out;
  });
  return { ...raw, voices };
}

export function findVoice(catalog, id) {
  return (catalog.voices || []).find((v) => v.id === id) || null;
}

export function localModelDir(voice) {
  return path.join(modelsDir(), voice.params.model);
}
