// 打包插件：npm pack → release/<name>-<version>.tgz
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack'], { cwd: root, encoding: 'utf8', shell: true })
  .trim()
  .split(/\r?\n/)
  .pop();
const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
const dest = path.join(releaseDir, out);
fs.copyFileSync(path.join(root, out), dest);
fs.rmSync(path.join(root, out));
console.log(`已打包 ${pkg.name}@${pkg.version} → ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB)`);
