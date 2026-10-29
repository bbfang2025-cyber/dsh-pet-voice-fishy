/** 数据目录与配置读写（跨平台，不依赖系统命令） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(os.homedir(), '.dsh');
}

export function dataDir() {
  const dir = path.join(dshHome(), 'dsh-pet-voice');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function modelsDir() {
  const dir = process.env.DSH_PET_VOICE_MODELS_DIR || path.join(dataDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cacheDir() {
  const dir = path.join(dataDir(), 'cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DEFAULT_CONFIG = {
  enabled: true,
  volume: 0.8,
  voiceId: 'breeze-yuyujiang',
  breezeApiKey: '',
  minIntervalSec: 30,
};

function configFile() {
  return path.join(dataDir(), 'config.json');
}

export function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...(patch || {}) };
  const file = configFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}
