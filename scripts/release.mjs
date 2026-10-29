// 发版：先改 package.json 的 version + CHANGELOG，再执行本脚本
//   GITHUB_TOKEN=... node scripts/release.mjs
// 会：打包 tgz → 创建 GitHub Release（tag v<version>）→ 上传 tgz
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}
const [owner, repo] = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '').split('/').slice(-2);
const version = pkg.version;
const tag = 'v' + version;
const api = 'https://api.github.com';
const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-pet-voice-fishy-release' };

async function apiFetch(url, options = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      return res;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// 打包
const tgz = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack'], { cwd: root, encoding: 'utf8', shell: true })
  .trim()
  .split(/\r?\n/)
  .pop();
const tgzPath = path.join(root, tgz);
console.log('打包完成：' + tgz);

// 创建 release
const create = await apiFetch(`${api}/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  body: JSON.stringify({
    tag_name: tag,
    name: tag,
    body: fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n').slice(0, 40).join('\n') : '',
    draft: false,
    prerelease: false,
  }),
});
if (create.status === 422) {
  console.log('该 tag 的 release 已存在，跳过创建');
} else {
  const release = await create.json();
  console.log('release:', release.html_url);
}

// 上传资产（同名则先删再传）
const releaseData = await (await apiFetch(`${api}/repos/${owner}/${repo}/releases/tags/${tag}`)).json();
const assetName = tgz;
const existing = (releaseData.assets || []).find((a) => a.name === assetName);
if (existing) {
  await apiFetch(`${api}/repos/${owner}/${repo}/releases/assets/${existing.id}`, { method: 'DELETE' });
  console.log('已删除同名资产，重新上传');
}
const data = fs.readFileSync(tgzPath);
const upload = await apiFetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets?name=${encodeURIComponent(assetName)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: data,
});
const asset = await upload.json();
console.log('上传完成：' + asset.browser_download_url);
fs.rmSync(tgzPath, { force: true });
