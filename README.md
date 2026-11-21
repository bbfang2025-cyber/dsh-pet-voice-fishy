# 大肥鱼语音（dsh-pet-voice-fishy）

> 当前版本：**V1.6.0**（package `1.6.0`）
>
> **默认音色 = 「御姐·原声库」**：414 条御姐原声台词池（337 日常碎碎念 + 27 表情包固定句 + 50 点击互动），库优先、模型兜底，库包约 4MB。

> **已装旧版（≤1.3.0）？** 在 DSH 的 desktop profile 目录（`%USERPROFILE%\.dsh\profiles\desktop`）执行
> `pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy --registry=https://registry.npmmirror.com`，
> 然后**完全退出并重新打开 DSH**（不是刷新页面）即升级到最新；或双击仓库里的 `升级到最新.cmd`。

给 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的**网页桌宠**配音：桌宠冒气泡 / 碎碎念时，自动把气泡里的文字念出来。

- **默认音色「御姐·原声库」**：414 条御姐原声台词池（337 日常碎碎念 + 27 表情包固定句 + 50 点击互动），命中直接播放（库包约 4MB），未命中自动走离线模型
- **离线可用**：音色包下载一次后，断网也能说话（鱼鱼酱 / 鱼鱼姐各约 58MB；原声库约 4MB）
- **下载/试听不断链**：库包缺失时试听返回 503 + 进度并自动安装，装完自动重试；GitHub → gh-proxy → ghfast → Gitee 多镜像换源
- **1.25x 语速**：鱼鱼酱 / 鱼鱼姐默认 1.25 倍速朗读（可在设置页选择其它音色）
- **朗读频率限制**：自动朗读最小间隔可设「不限 / 30 秒 / 60 秒 / 3 分钟」，**默认 30 秒**，不会一直说话
- **右键朗读**：右键（或长按）碎碎念气泡，直接再读一遍这条内容，不受频率限制
- **插件本体很小**：代码约 40KB，模型不进安装包，首次按需下载
- **不修改 dsh-pet 的任何文件**，装完即用（唯一例外：台词池 / 表情包固定句 / 点击互动需要给 dsh-pet 本地安装副本打一个小补丁，见「台词池」一节）

## 音色

| 音色 | 类型 | 说明 |
|---|---|---|
| 鱼鱼酱（默认） | 离线本地 | 本地复刻少女音，1.25x 语速，一次下载约 58MB，无需 Key |
| 鱼鱼姐（实验版） | 离线本地 | 本地复刻御姐音，1.25x 语速，一次下载约 58MB，无需 Key；语料较少，清晰度略逊于鱼鱼酱 |
| 御姐·原声库（默认） | 离线原声库 | 414 条御姐原声（337 日常 + 27 表情包 + 50 点击互动，库包约 4MB），命中直接播放；未命中自动回退鱼鱼姐模型 |

- 鱼鱼酱 / 鱼鱼姐是**本地离线模型**：在设置页点一下音色包下载（约 58MB）后，断网也能用，不需要任何 Key；
- 鱼鱼姐为**实验版**：Breeze 余额限制导致训练语料较少，个别字发音不如鱼鱼酱清晰，介意可先用鱼鱼酱；
- 如仍想用 Breeze 在线音色，可在设置页填 Breeze API Key（`brz_` 开头，可选，不影响本地音色）；
- 鱼鱼酱 / 鱼鱼姐的本地模型由 Piper 中文开源模型（Xiao Ya medium）微调而来，底座数据集 BZNSYP 为非商用许可，**仅供个人非商业使用**。

### 原声台词池「御姐·原声库 v3」（库优先、模型兜底）

- 音色 id `yujie-lib`，`engine: "library"`，包 `yujie-lib`（`dsh-lib-yujie-v3.tar.bz2` 约 3.9MiB / 4.1MB，**414 条 = 337 日常碎碎念 + 27 表情包固定句 + 50 点击互动**，Opus 32kbps 单声道、源 24kHz）；
- 条目分类：`index.json` 每条带 `kind: "chatter" | "meme" | "interact"`；meme 条目另有 `meme: "<表情包名>"`，id `M01..M27`；
  点击互动 id `I01..I50`；命中响应头带 `X-DSH-Pet-Voice-Meme`（meme 条目）；
- `/tts` **先查库**：请求文本归一化（NFKC 全半角统一 → 去空白 → 去标点/符号/表情 → 小写）后与 `index.json` 精确匹配；
  命中直接返回库内 `audio/ogg`（Opus），响应头 `X-DSH-Pet-Voice-Source: library`、`X-DSH-Pet-Voice-Id`；
- **未命中**：走原有离线 VITS 模型（选「御姐·原声库」时优先 `breeze-yuyujie`），响应头 `X-DSH-Pet-Voice-Source: model`；
  模型也不可用时返回 **404 JSON**（`code: "LIBRARY_MISS"`、`source: "none"`），不会静默无响应；
- 库包解压到 `$DSH_HOME/dsh-pet-voice/models/yujie-lib/`（`index.json` + `manifest.json` + 414 个 `.opus`），
  安装时校验 tar.bz2 的 sha256 与包内 manifest 的内容哈希；已装 v2（364 条）会按 `voices.json` 自动升级到 v3；
  测试环境可用 `DSH_PET_VOICE_LIBRARY_SRC=<本地 tar.bz2 或目录>` 安装；
- 统计：`GET /api/library/stats`（别名 `GET /dsh-pet-voice/api/library/stats`）返回 `{ "total", "hits", "misses" }`；
  `GET /api/library/status` 返回安装状态、条数、版本、台词池文件计数与最近未命中文本；
- 想关掉「库优先」只走模型：把 config 的 `libraryFirst` 设为 `false`。

### 台词池（配合 dsh-pet，v3）

- 库装好 / 插件启动时，自动把三类台词同步到 `$DSH_HOME/dsh-pet-voice/pools/`：
  - `chatter.txt`（**337 行**日常碎碎念）、`interact.txt`（**50 行**点击互动）、`meme.json`（**27 条**表情包固定句）；
  - `config.json`：`{"usePhrasePool": true, "memeFirst": true}`（默认开；已存在则不覆盖，保留用户开关）；
- dsh-pet（第三方插件）的**已安装副本**打了两处本地补丁（改动前备份 `.bak-<时间戳>`）：
  1. **碎碎念**：meme 固定句（原逻辑）→ 否则从 `chatter.txt` 随机抽一句，**不调 AI**；池缺失/为空回退原 AI；
     抽句避免最近 10 次重复；`pools/config.json` / `meme_lines.json` 解析容忍 UTF-8 BOM（用户用 PowerShell 编辑过配置）；
  2. **点击桌宠互动**：由**配音插件客户端**处理（不改 dsh-pet 的 client.js）：点击 `.dsh-pet-hit` → `GET /dsh-pet-voice/api/library/pick?kind=interact`
     从 `interact.txt` 抽一句（宿主侧最近 10 次不重复）→ `POST /dsh-pet-7340/broadcast` 写同句气泡 → 强制朗读同句；
     **不调 AI**，气泡文本与朗读文本严格一致；池缺失时回退原 `CLICK_LINES` 行为（不报错、不白屏）；
  3. **用户主动聊天**：保持原样（AI 现编，需要理解上下文）；
- 开关语义：`usePhrasePool=false` 停用台词池（全部回退 AI）；`memeFirst=false` 让 chatter 池优先于 meme 固定句（此时碎碎念不带图）；
- **升级/重装 dsh-pet 后碎碎念补丁会被覆盖**，需要重新打（本仓库外脚本 `patch-dsh-pet-pools.mjs`）；
  点击互动走配音插件自身客户端，不受 dsh-pet 升级影响；`pools/` 文件不会丢（配音插件会自动重生）。

### 试听与下载（v1.6.0 修复「无法试听」）

- 库包未安装时点「试听」：宿主返回 **503 JSON**（`action:"installing"`、`progress`、`code:"LIBRARY_INSTALLING"`）并**自动开始安装**，不会 500/挂死；
- 客户端显示「原声库下载中 x%」，装完**自动重试试听一次**；安装失败显示人话原因（含换源记录），不静默；
- 换源顺序：**GitHub 固定名 → gh-proxy → ghfast → Gitee release → Gitee raw**；全部失败时提示「所有镜像下载失败：…」；
- 库已装但某句不在库 → 走离线 VITS 模型（`Source: model`）；库和模型都不可用 → 404 JSON（`code:"LIBRARY_MISS"`）；
- 关闭后台自动安装：`DSH_PET_VOICE_AUTO_INSTALL=0`（验收/排障用，按需点「试听」仍会触发安装）。

### 语料与台词池自定义

- 训练/台词语料在 `assets/corpus/`（**只有文本，不含音频**）：`corpus538.txt`（337 日常）、`corpus_meme27.txt`（27 表情包）、`corpus_interact50.txt`（50 点击互动）；
- 运行期台词池在 `$DSH_HOME/dsh-pet-voice/pools/`：`chatter.txt`(337) / `interact.txt`(50) / `meme.json`(27) / `config.json`（`usePhrasePool` / `memeFirst`）；
- **直接改 pools/*.txt 会在插件装库/启动时被重新同步覆盖**；要长期改：改 `assets/corpus/` 或库包 `index.json` 后重新生成库包；临时调试可直接改本机 pools 文件（下次同步会覆盖）；
- 池开关：`usePhrasePool=false` 全部回退 AI；`memeFirst=false` 碎碎念优先 chatter（此时不带表情包图）。

## 安装

### 方式零：让 AI Agent 帮你装（复制这一句就行）

> 从这个仓库安装插件：`https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy`，装好加进 DSH desktop profile 的 `dsh.profile.bundles`，然后提醒我重启。

Agent 会执行 `pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy`。完整的给-agent 指令、验收标准和排错见 [AGENT-INSTALL.md](AGENT-INSTALL.md)。

### 方式一：插件市场（推荐）

DSH → 插件市场 → 搜索「大肥鱼语音」或 `dsh-pet-voice-fishy` → 安装 → 重启 DSH。

### 方式二：Gitee 直链（国内最快，免 VPN）

```powershell
Invoke-WebRequest -Uri "https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/latest/dsh-pet-voice-fishy.tgz" -OutFile "$env:TEMP\dsh-pet-voice-fishy.tgz"
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add "file:$env:TEMP\dsh-pet-voice-fishy.tgz" --registry=https://registry.npmmirror.com
# 再把 dsh-pet-voice-fishy 加进 package.json 的 dsh.profile.bundles
```

### 方式三：GitHub 直链（gh-proxy 加速，免 VPN）

```powershell
# 国内如果 GitHub 慢，用 gh-proxy 前缀：https://gh-proxy.com/https://github.com/...
Invoke-WebRequest -Uri "https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/latest/download/dsh-pet-voice-fishy.tgz" -OutFile "$env:TEMP\dsh-pet-voice-fishy.tgz"
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add "file:$env:TEMP\dsh-pet-voice-fishy.tgz" --registry=https://registry.npmmirror.com
# 再把 dsh-pet-voice-fishy 加进 package.json 的 dsh.profile.bundles
```

### 方式四：本地安装

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add file:D:\path\to\dsh-pet-voice-fishy-1.3.1.tgz --registry=https://registry.npmmirror.com
# 然后在 profile 的 package.json 里把 "dsh-pet-voice-fishy" 加进 dsh.profile.bundles
```

> 也可以把 `dist/INSTALL.md` 里的「发给 AI agent」那段话直接丢给 agent，让它帮你装。

装完完全退出并重新打开 DSH，在页面里刷新一次。

## 使用

1. 打开 设置 → **大肥鱼语音**；
2. 「气泡朗读」开关控制是否朗读，音量滑杆调音量；
3. 「朗读频率」选择自动朗读的最小间隔（不限 / 30 秒 / 60 秒 / 3 分钟，**默认 30 秒**；主动点击与右键不受限）；
4. 「音色」里点一下切换，点「试听」先听声音；
5. 想用鱼鱼酱 / 鱼鱼姐：在「离线音色（断网可用）」里点下载（各约 58MB），装完切过去即可，不需要 Key。

音色包下载完成后即可断网使用；Breeze 在线音色（可选）需要联网和有效的 API Key。

## 离线是怎么做到"插件小"的

- 安装包里**只有代码**，没有任何模型；
- 第一次用到离线音色时，才从镜像下载音色包（tar.bz2）到 `$DSH_HOME/dsh-pet-voice/models/`：鱼鱼酱 / 鱼鱼姐各约 58MB；
- 推理跑在 **worker 线程**（sherpa-onnx / ONNX Runtime CPU），不会卡 DSH 主界面；
- 已下载过的模型不会重复下载；模型就绪后，朗读不产生任何网络请求。

## 配置

`$DSH_HOME/dsh-pet-voice/config.json`：

```json
{
  "enabled": true,
  "volume": 0.8,
  "voiceId": "breeze-yuyujiang",
  "breezeApiKey": "",
  "libraryFirst": true
}
```

- `voiceId` 可选值见上面的音色表（`breeze-yuyujiang`、`breeze-yuyujie`、`yujie-lib`）；
- `breezeApiKey` 只保存在本机，不会上传；不填也不影响本地离线音色；
- `libraryFirst`（默认 `true`）：装了原声库时先查库、命中直接播原声；设为 `false` 则只走模型；
- 模型目录也可以用环境变量 `DSH_PET_VOICE_MODELS_DIR` 覆盖。

## 路由

```
GET  /dsh-pet-voice/state                    → 配置、音色、音色包状态
POST /dsh-pet-voice/state                    → 修改配置（enabled / volume / voiceId / breezeApiKey）
GET  /dsh-pet-voice/tts?voice=&text=         → audio/mpeg（在线）、audio/wav（离线模型）或 audio/ogg（原声库命中）
GET  /dsh-pet-voice/packs                    → 音色包安装状态（数组）
POST /dsh-pet-voice/packs/install?id=yuyujiang  → 开始下载/安装音色包
GET  /dsh-pet-voice/packs/progress?id=yuyujiang → 下载进度
GET  /dsh-pet-voice/breeze/voices            → 列出 Breeze 账号里的音色
GET  /api/library/stats                      → 原声库命中统计 {total,hits,misses}（别名 /dsh-pet-voice/api/library/stats）
POST /api/library/stats/reset                → 清零统计（验收/排查用）
GET  /api/library/status                     → 原声库安装状态、条数、最近未命中文本
POST /api/library/install                    → 安装原声库（tar.bz2 校验 sha256 后解压）
```

`X-DSH-Pet-Voice-Source` 响应头：`library`（原声库命中）或 `model`（模型合成），便于验证走了哪条路径。


### `GET /dsh-pet-voice/state` 响应（v1.3.3 起）

```jsonc
{
  "version": "1.3.3",
  "config": { "enabled": true, "volume": 0.8, "voiceId": "breeze-yuyujiang" },
  "voices": [
    { "id": "breeze-yuyujiang", "name": "鱼鱼酱", "engine": "local", "tags": ["离线", "少女", "默认"],
      "pack": "yuyujiang", "available": true, "needsBreezeKey": false, "needsDownload": false }
  ],
  "packs": [ /* v1.3.3 起固定为数组；旧版为对象 {id: pack} */
    { "id": "yuyujiang", "name": "…", "desc": "…", "sizeMB": 58, "installed": true, "progress": null }
  ],
  "engines": { "local": true }
}
```

- `packs` 现在是**数组**（`[{id,name,desc,sizeMB,installed,progress}]`），`/packs` 接口同样返回数组；
  第三方集成可直接 `state.packs.map(...)`，不再需要 `Object.values()`。
- 默认音色规则：config 里没有 voiceId（全新安装）时取第一个非实验版本地音色（当前是 `breeze-yuyujiang`）；
  config 里已有 voiceId 时保持不变。


### v1.4.0 新增：音色包缺失自动回退

- `GET /dsh-pet-voice/tts?voice=&text=`：若该音色包未安装，会自动用第一个已安装可用的本地音色合成，
  返回 **200** 并带响应头 `X-DSH-Pet-Voice-Fallback: 1`、`X-DSH-Pet-Voice-Voice`（实际音色 id）、
  `X-DSH-Pet-Voice-Voice-Name`（URL 编码的名字）、`X-DSH-Pet-Voice-Requested`（请求的音色 id）。
  后台同时下载请求的包；若一个已安装的本地音色都没有，才返回 503 JSON（含 `progress.percent` 与 `error`）。
- 前端在回退与失败时都会在页面右下角给出可见提示，不再静默。

### 永久安装地址 / 资产（v1.6.0）

```
插件（固定名，latest）：https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/latest/download/dsh-pet-voice-fishy.tgz
插件（版本化）：        https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/download/v1.6.0/dsh-pet-voice-fishy-1.6.0.tgz
原声库 v3：             https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/latest/download/dsh-lib-yujie-v3.tar.bz2
语料 zip：              https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/latest/download/dsh-corpus-v1.zip
```

Gitee 镜像：
- 插件：`https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/latest/dsh-pet-voice-fishy.tgz`
- 原声库：`https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/latest/dsh-lib-yujie-v3.tar.bz2`
- 语料：`https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/latest/dsh-corpus-v1.zip`

GitHub Release 每次发版都会额外上传固定文件名 `dsh-pet-voice-fishy.tgz`，`releases/latest/download/...` 永远指向最新正式版。

## 已知限制

- 只覆盖**网页形态**的桌宠；桌面浮动版由 dsh-pet 自己的 Electron 助手渲染，需要上游支持；
- 鱼鱼酱 / 鱼鱼姐为**本地离线模型**：CPU 推理，不需要 Key / GPU / 联网，首次下载各约 58MB；
- Breeze 在线音色为可选能力，需要联网 + 自己的 API Key，且消耗你的 Breeze 余额；
- 音色包首次下载需要等（有进度条，支持断点续传）；
- 中文里的英文单词可能被读成"忽略"（离线模型的 OOV 限制）。
- 原声库覆盖 414 条原句（337 日常 + 27 表情包固定句 + 50 点击互动）：**同音不同字、同义改写匹配不到**（归一化只处理空白/标点/全半角，不做拼音或语义匹配）；
- 表情包固定台词只覆盖那 27 张图；其它表情包仍走原 AI 现编（没有对应原声可命中）；
- **碎碎念来源与「碎碎念配图」联动**：dsh-pet 配图开启且抽到 27 张之一时，固定句优先（气泡带图）；
  没有配图 / 抽到未映射图时才走 chatter 池。想优先用 337 条 chatter：把 `pools/config.json` 的 `memeFirst` 设为 `false`，
  或关闭 dsh-pet 的「碎碎念配图」；
- 装了库包时 `/tts` 默认「库优先」：即使当前选的是鱼鱼酱，命中句也会播御姐原声；想只走模型把 `libraryFirst` 设为 `false`；
- 原声库音量/语速固定为原声，`speed` 参数对库命中不生效（`params.speed: 1.0`）；
- dsh-pet 补丁是**本地安装副本**改动：升级 / 重装 dsh-pet 后需重打；`pools/` 与 `meme_lines.json` 由配音插件在库安装/启动时自动同步。

## 版权与合规

- 插件代码 MIT；离线语音模型 **不随包分发**，由使用者按需从 GitHub Releases 或镜像下载；
- 鱼鱼酱 / 鱼鱼姐的本地模型由 Piper 中文开源模型（Xiao Ya medium，BZNSYP 数据集为非商用许可）微调而来，**仅供个人非商业使用**；
- BreezeBlue 为第三方云服务，使用需遵守其服务条款；音色由用户本人提供并授权本地化；
- 本插件不包含任何影视 / 游戏角色音色模型。

## 许可

MIT。模型与推理引擎许可见各自仓库（sherpa-onnx、Piper）。
