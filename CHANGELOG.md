# Changelog

## V1.6.0 (2026-11-21)

### 发版摘要

- 版本：package / `assets/voices.json` = **1.6.0**；默认音色改为 **`yujie-lib`「御姐·原声库」**（414 条原声台词池 v3，库优先 / 模型兜底）；
- **修复「无法试听」**：库包未安装时 `/preview`（及 `/tts`）返回 **503 + JSON `{action:"installing", progress, code:"LIBRARY_INSTALLING"}`** 并自动触发安装；
  客户端显示「原声库下载中 x%」，装完**自动重试试听一次**，失败给人话原因；不再静默回退鱼鱼姐模型；
- 下载换源链：**GitHub（固定名）→ gh-proxy → ghfast → Gitee（release / raw）**；全部失败时明确提示「所有镜像下载失败：…」；
- 语料入库：`assets/corpus/`（`corpus538.txt` 337 / `corpus_meme27.txt` 27 / `corpus_interact50.txt` 50 + README，**只有文本，不含音频**）；
- 发布资产：`dsh-pet-voice-fishy-1.6.0.tgz`、固定名 `dsh-pet-voice-fishy.tgz`、`dsh-lib-yujie-v3.tar.bz2`、`dsh-corpus-v1.zip`；GitHub / Gitee 双站。

### 修复：点击桌宠「第一句新、后面全旧（鱼鱼姐）」

- 根因：配音插件客户端 `installPetClick()` 里还有一份硬编码 `CLICK_LINES`（5 句旧台词），每次点击都强制朗读它 →
  `/tts` 未命中库 → 回退鱼鱼姐模型；首次点击可能被新气泡/碎碎念掩盖而显得"第一句是新的"。
- 修复：点击 `.dsh-pet-hit` 改为 `GET /dsh-pet-voice/api/library/pick?kind=interact` 从 `pools/interact.txt` 抽句
  （宿主侧最近 10 次不重复）→ `POST /dsh-pet-7340/broadcast` 写同句气泡 → 强制朗读同句；不调 AI；
  池不可用时回退原 `CLICK_LINES` 行为，不报错。
- 撤回上一轮对 dsh-pet `client.js` 的 `/interact` 调用补丁（避免双气泡）；dsh-pet 的 `index.js` 碎碎念补丁保留，
  `/interact` 宿主路由保留但不再被点击使用；`pools/config.json`、`meme_lines.json` 解析改为容忍 UTF-8 BOM。
- 新增宿主接口 `GET /dsh-pet-voice/api/library/pick?kind=interact|chatter`。

### 原声库 v3（414 条）+ 台词池模式

- 库包升级为 `dsh-lib-yujie-v3`：**414 条 = 337 日常碎碎念（chatter）+ 27 表情包固定句（meme）+ 50 点击互动（interact，I01-I50）**，
  Opus 32kbps 单声道（源 24kHz），tar.bz2 3,911 MiB；`index.json` 每条带 `kind`，interact 条目 `kind: "interact"`；
- 库安装 / 启动时自动同步台词池到 `$DSH_HOME/dsh-pet-voice/pools/`：`chatter.txt`(337) / `interact.txt`(50) / `meme.json`(27) / `config.json`；
- 已装 v2（364 条）按 voices.json 自动升级 v3；`/api/library/status` 增加台词池文件计数；
- **dsh-pet 第二轮本地补丁**：碎碎念 meme 固定句 → chatter 池随机（不调 AI）；点击桌宠新增 `POST /dsh-pet-7340/interact`
  从 interact 池随机抽句写气泡（不调 AI）；池缺失/为空回退原逻辑；最近 10 次抽句不重复；`usePhrasePool` / `memeFirst` 开关；
- `voices.json` 升到 version 7。

## 未发布（v2，本地工作副本，1.5.0 线）

### 原声库扩到 364 句 + 表情包固定台词

- 库包升级为 `dsh-lib-yujie-v2`：**364 条 = 337 日常句（0001-0337）+ 27 表情包固定台词（M01-M27）**，
  Opus 32kbps 单声道（源 24kHz），tar.bz2 约 3.5MB；meme 条目在 `index.json` 带 `meme: "<表情包名>"` 字段；
- 库安装支持**自动升级**（已装 337 条 v1 时，按 voices.json 的 count/version/contentSha256 自动升到 364 条；
  升级先备份旧目录、校验通过才删，失败自动回滚）；
- 库安装 / 启动时自动同步 `$DSH_HOME/dsh-pet-voice/meme_lines.json`（表情包名 → 固定台词，27 条）；
- 命中响应头新增 `X-DSH-Pet-Voice-Meme`；`GET /api/library/status` 增加 `version` / `contentSha256`；
- **dsh-pet 本地安装副本补丁**：碎碎念抽到表情包时先查 `meme_lines.json`，命中跳过 AI 直接返回固定句
  （`generateWhisper` 前置分支）；文件缺失/JSON 损坏/名称不匹配回退原 AI 逻辑；改动前备份 `.bak-<时间戳>`；
- `voices.json` 升到 version 6。

## 未发布（本地工作副本，1.5.0 线）

### 原声台词库包（方案 A）+ 库优先、模型兜底

- 新增音色 `yujie-lib`「御姐·原声库」（`engine: "library"`，包 `yujie-lib`）：337 条御姐原声，
  Opus 32kbps 单声道（源 24kHz），库包 `dsh-lib-yujie-v1.tar.bz2` 约 3.4MB；
- `/tts` 改为**先查库**：文本归一化（NFKC 全半角统一 → 去空白 → 去标点/符号/表情 → 小写）后精确匹配 `index.json`；
  命中直接返回库内 `audio/ogg`，未命中再走原有 VITS 模型（选库音色时优先鱼鱼姐）；
- 新增响应头 `X-DSH-Pet-Voice-Source: library|model`，便于验证命中路径；
- 新增 `GET /api/library/stats`（别名 `/dsh-pet-voice/api/library/stats`）返回 `{total,hits,misses}`；
  `GET /api/library/status`、`POST /api/library/install`；库包装到 `$DSH_HOME/dsh-pet-voice/models/yujie-lib/`，
  安装时校验 tar.bz2 sha256 与包内 manifest 内容哈希；
- 库未命中且无可用模型时返回 404 JSON（`code: "LIBRARY_MISS"`、`source: "none"`）；
- 新增 config `libraryFirst`（默认 `true`）；`voices.json` 升到 version 5。

## V1.5.0 (2026-11-06)

### 音色精简

- **音色列表只保留 2 个本地离线音色**：鱼鱼酱（默认）、鱼鱼姐（实验版）；
- **移除 8 个 Kokoro 离线女声**（奶糖鱼 / 果冻鱼 / 泡泡鱼 / 团子鱼 / 冷月鱼 / 知性鱼 / 低语鱼 / 夜莺鱼）
  以及约 **348MB** 的 Kokoro 音色包，安装/下载更轻；
- 默认音色规则不变（第一个非实验版本地音色 = 鱼鱼酱）；首装预下载只会下载鱼鱼酱包；
- 老配置里的 `voiceId`（如 `kokoro-41` 等已删除音色）会自动迁移到鱼鱼酱，不会报错；
- 已发布的历史版本与音色资产一律不动；下方历史 CHANGELOG 条目是当日发布记录，不代表当前音色列表。

## V1.4.0 (2026-11-04)

### 修复「很多人没声音」（防御式）

背景数据：GitHub 安装包下载 v1.3.0 = 1026 次（该版本在 Electron 下 `/tts` 必 500），v1.3.2 = 2，v1.3.3 = 222；
音色包下载：鱼鱼酱 169 次、鱼鱼姐 34 次，而 v1.3.0 默认音色是鱼鱼姐（实验版）→ 多数用户没装鱼鱼姐包 → `/tts` 503 被前端静默吞掉。

- **音色包缺失自动回退**：请求的音色包未安装时，宿主不再 503 结束，而是自动改用「第一个已安装可用的本地音色」
  （优先非实验版）合成，返回 200 并带 `X-DSH-Pet-Voice-Fallback: 1`、`X-DSH-Pet-Voice-Voice`、
  `X-DSH-Pet-Voice-Voice-Name`、`X-DSH-Pet-Voice-Requested` 响应头；同时后台继续下载用户原本选的包。
- **错误可见**：前端任何 `!res.ok` 都会在页面右下角显示「音色包下载中 x%」或「朗读失败：原因」，不再静默吞掉；
  音色包下载中导致的 503 会自动轮询，下载完成后把刚才那句话读出来（无需用户再操作）。
- **首装预下载**：插件加载后 0.8s 就在后台预下载默认音色包（带进度），不再等用户点试听。

### 永久安装地址

- GitHub（始终指向最新正式版）：`https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/latest/download/dsh-pet-voice-fishy.tgz`
- Gitee 镜像：`https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/latest/dsh-pet-voice-fishy.tgz`

### 说明

- 音色包与 v1.3.x 相同（v2 包），未重传；v1.3.3 及更早资产一律不动。

## V1.3.3 (2026-10-31)

### 修复 / 调整

- **默认音色改为鱼鱼酱**：全新安装（config 里还没有 voiceId）时，默认取「第一个非实验版的本地音色」，
  当前目录即 `breeze-yuyujiang`；**config.json 里已有用户选过的 voiceId 时保持不变**（例如选了鱼鱼姐不会被覆盖）。
- **`/state` 的 `packs` 字段统一为数组**：以前是对象 `{id: pack}`，第三方/自查脚本写 `(state.packs||[]).map`
  会报 "is not a function"；现在 `packs` 是 `[{id,name,desc,sizeMB,installed,progress}]` 数组（`/packs` 接口同样返回数组），
  前端同时兼容新旧两种形状；README 的 API 说明已补上响应结构。

### 说明

- 音色包与已发布资产（v1.3.2 及更早）一律不动。
## V1.3.2 (2026-10-31)

### 修复

- **全部离线音色试听/朗读报 500「External buffers are not allowed」**（Electron/DSH 实测）：
  sherpa-onnx-node 2.0.1 的 `OfflineTts.generate()` 默认 `enableExternalBuffer: true`，会在 Electron 的
  Node 构建里调用 `napi_create_external_arraybuffer`，该 API 在 Electron 中不允许（`napi_no_external_buffers_allowed`），
  于是 native 调用直接抛错，宿主 `/tts` 返回 500。
- 修复：`lib/tts-worker.cjs` 调用 generate 时显式 `enableExternalBuffer: false`；返回音频先
  `Float32Array.from()` 拷贝到 V8 堆，再以普通数字数组跨 worker 传递；宿主侧 `Buffer.from()` 还原。
- 顺带：`/tts` 异常时宿主日志打完整堆栈，JSON 响应附带 `detail`（前几行 stack），便于排障。

### 实测

- 真实 DSH 页面（CDP, 127.0.0.1:53029）：修复前 `/tts` 两音色均 `500 {"error":"External buffers are not allowed"}`；
  修复后同页面 `200 audio/wav`（鱼鱼酱 36,908B / 鱼鱼姐 35,884B，长句 203,308B / 210,970B）。
- Electron 44.7（Node 24.21，与 DSH 宿主同版本）独立 worker 测试：修复前抛同样的错，修复后正常出 wav。

### 说明

- 音色包沿用 v1.3.0 的 v2 包，未重传；v1.3.1 及更早资产一律不动。

## V1.3.1 (2026-10-31)

### 修复（小白上手体验）

- **试听按钮不再禁用**：离线音色包未下载时，音色卡片上的「试听」可点，点击会自动下载并显示「下载中 x%」，下载完成自动试听；不再出现灰掉按钮让用户以为坏了。
- **无 Key 不再出现「需配 Key」**：只有在线 Breeze 音色缺 Key 时才禁用并提示；鱼鱼酱 / 鱼鱼姐等本地音色全部按离线逻辑（未下载显示「未下载」+ 可试听）。
- **设置页显示插件版本号**（如 `大肥鱼语音 v1.3.1`），排障第一句话就能确认版本。
- **新增旧版升级入口**：README / AGENT-INSTALL 顶部加一行升级命令；新增 `升级到最新.cmd`，双击即可 `pnpm add ...` 并在完成后提示重启 DSH。

### 说明

- 音色包与 v1.3.0 完全相同（`dsh-vits-yuyujiang-v2` / `dsh-vits-yuyujie-v2`），旧 Release 资产一律不动。

## V1.3.0 (2026-10-30)

### 变更

- **语速统一 1.25x**：通过运行时参数（sherpa-onnx speed）实现，不重训；实测同一批句子总时长缩短约 17%。
- **训练语料清洗后重训两个音色**：去直流 → 50/100/150Hz 陷波(Q=30) → 80Hz 高通 → 轻谱减降噪 → 统一 -23 LUFS；
  鱼鱼姐不再使用速度扰动增强，改为只用 175 句干净语料重训。
- **音色包换 v2**（`dsh-vits-yuyujiang-v2` / `dsh-vits-yuyujie-v2`），约 58MB/个，旧 v1 包不受影响。
- 输出端后处理经 A/B 验证：80Hz 高通无可测变化；6–8kHz 高架衰减会让音色偏离目标原声（MFCC 相似度下降、谱质心 2875→2479，原声 2984），**因此不启用**。

### 实测

- 工频能量占比（22050Hz FFT，45–55Hz / 95–105Hz）：参考音色 ≈0% / ≈0%，重训合成 ≈0% / ≈0%（无 50/100Hz 工频峰）。
- 主峰频率：鱼鱼酱 ~275Hz、鱼鱼姐 ~201Hz，均为基频，无 50/100Hz 峰。
- ASR 可懂度、F0、MFCC 相似度见 Release 说明。

## V1.2.0 (2026-10-30)

### 新增

- **鱼鱼酱 / 鱼鱼姐 改为本地离线音色**：用你自己的这两个音色训练出本地 VITS 模型，导出为 sherpa-onnx 可直接加载的 ONNX 音色包（CPU 推理，22.05kHz）——**不需要 Breeze API Key、不需要 GPU、断网也能说**；
- 两个音色包各约 **58MB**，首次选用时按需下载（多镜像 + 断点续传），装好后永久离线可用；
- 默认音色改为「鱼鱼酱（本地离线）」；首次安装会自动预下载这个包；
- **鱼鱼姐为实验版**：Breeze 余额限制导致训练语料较少（175 句 + 速度扰动），个别字发音不如鱼鱼酱清晰，暂不作为同等正式音色推荐。

### 变更

- 「自定义音色（Breeze 在线）」保留为可选：Breeze Key 只影响在线音色，不再影响鱼鱼酱 / 鱼鱼姐；
- 安装包本体仍然很小（约 40KB，不含模型）。

### 说明

- 本地模型由 Piper 中文开源模型（Xiao Ya medium，BZNSYP 数据集为**非商用**许可）微调而来，仅供个人非商业使用；
- 音色来自你本人已授权的 Breeze 自定义音色，训练语料仅用于本次本地化，不会上传。

## V1.1.2 (2026-10-29)

### 修复

- 双音源终极修复：新增宿主级「播放仲裁」接口 /dsh-pet-voice/claim，同一 DSH 实例下（桌面窗口 + 浏览器标签页 + 多开窗口）只有一个页面能拿到播放许可，其余直接跳过；
- 自动朗读限频也改为宿主统一判断，避免多页面各自计时导致重复；
- 保留客户端归一化去重与 localStorage 互斥作为第二层保险。

## V1.1.1 (2026-10-29)

### 修复

- 同一句碎碎念被读两遍（两个音源）：自动朗读现在只走状态轮询这一条真源，去掉 DOM 监听重复触发；
- 去重改为「归一化文本 + 6 秒窗口」（忽略标点/空白/表情差异）；
- 多开窗口/标签页时用 localStorage 互斥，只让一个页面出声。

## V1.1 (2026-10-29)

### 修复

- 自动朗读只读「碎碎念」气泡（`.dsh-pet-whisper`），不再把右键菜单里的「余额档位」「工作状态」等其它气泡念出来——之前点几下菜单就会听着一路说话。
- 左键/右键点碎碎念气泡仍可随时朗读，不受频率限制。

## V1.0 (2026-10-29)

### 新增

- **右键碎碎念气泡朗读**：右键（或触屏长按）桌宠的碎碎念气泡，直接朗读这条内容，并拦掉浏览器原生右键菜单；同一条内容可以反复读，不受自动朗读的频率限制。
- 气泡正文提取优先读 `.pet-bub-row` 行，避免把气泡里的按钮、图标文字一起念出来。

### 修复

- 左键点气泡只处理左键（`button === 0`），右键不再同时走点击与右键两条路、读两遍。

### 变更

- 自动朗读的默认最小间隔由 60 秒改为 **30 秒**（只影响新装；已有 config.json 里存过值的不动，可在设置页改）。

## V0.2.0 (2026-10-29)

首个公开版本。

### 功能

- 桌宠冒气泡 / 碎碎念时自动朗读；点击碎碎念气泡朗读其内容；点击桌宠回应互动台词。
- 10 个音色：2 个在线 Breeze 自定义音色（自备 API Key，语速可调）+ 8 个离线中文女声（萌系 / 御姐各 4 个）。
- 朗读频率限制：自动朗读最小间隔可设「不限 / 30 秒 / 60 秒 / 3 分钟」，避免桌宠一直说话；主动点击不受限。
- 离线音色包首次按需下载（约 348MB，多镜像、断点续传），之后断网可用。
- 推理在 worker 线程执行，不阻塞 DSH 主进程。
- 设置页：气泡朗读开关、音量、音色、朗读频率、离线包进度、Breeze Key。

### 技术

- 宿主半侧：Cordis 插件，`/dsh-pet-voice/*` 同源路由。
- 离线引擎：sherpa-onnx（Kokoro 中文女声，22.05kHz）。
- 在线引擎：BreezeBlue 开发者 API。
- 插件本体约 26KB，模型不随包分发。
