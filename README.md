# 大肥鱼语音（dsh-pet-voice-fishy）

> 当前版本：**V1.3.2**（package `1.3.2`）

> **已装旧版（≤1.3.0）？** 在 DSH 的 desktop profile 目录（`%USERPROFILE%\.dsh\profiles\desktop`）执行
> `pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy --registry=https://registry.npmmirror.com`，
> 然后**完全退出并重新打开 DSH**（不是刷新页面）即升级到最新；或双击仓库里的 `升级到最新.cmd`。

给 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的**网页桌宠**配音：桌宠冒气泡 / 碎碎念时，自动把气泡里的文字念出来。

- **10 个音色**：2 个**本地离线复刻音色**（鱼鱼酱 / 鱼鱼姐，无需 Key、无需 GPU）+ 8 个离线中文女声
- **离线可用**：音色包下载一次后，断网也能说话（鱼鱼酱 / 鱼鱼姐各约 58MB，Kokoro 合集约 348MB）
- **1.25x 语速**：鱼鱼酱 / 鱼鱼姐默认 1.25 倍速朗读（可在设置页选择其它音色）
- **朗读频率限制**：自动朗读最小间隔可设「不限 / 30 秒 / 60 秒 / 3 分钟」，**默认 30 秒**，不会一直说话
- **右键朗读**：右键（或长按）碎碎念气泡，直接再读一遍这条内容，不受频率限制
- **插件本体很小**：代码约 40KB，模型不进安装包，首次按需下载
- **不修改 dsh-pet 的任何文件**，装完即用

## 音色

| 音色 | 类型 | 说明 |
|---|---|---|
| 鱼鱼酱（默认） | 离线本地 | 本地复刻少女音，1.25x 语速，一次下载约 58MB，无需 Key |
| 鱼鱼姐（实验版） | 离线本地 | 本地复刻御姐音，1.25x 语速，一次下载约 58MB，无需 Key；语料较少，清晰度略逊于鱼鱼酱 |
| 奶糖鱼 | 离线 | 萌系：音调最高、奶甜软糯 |
| 果冻鱼 | 离线 | 萌系：清亮带点俏皮 |
| 泡泡鱼 | 离线 | 萌系：软乎乎的少女音 |
| 团子鱼 | 离线 | 萌系：圆润黏人的小嗓音 |
| 冷月鱼 | 离线 | 御姐：低沉冷静、气场足 |
| 知性鱼 | 离线 | 御姐：温柔知性、娓娓道来 |
| 低语鱼 | 离线 | 御姐：轻声细语、耳边低语 |
| 夜莺鱼 | 离线 | 御姐：偏中性的成熟女声 |

- 鱼鱼酱 / 鱼鱼姐是**本地离线模型**：在设置页点一下音色包下载（约 58MB）后，断网也能用，不需要任何 Key；
- 鱼鱼姐为**实验版**：Breeze 余额限制导致训练语料较少，个别字发音不如鱼鱼酱清晰，介意可先用鱼鱼酱；
- 如仍想用 Breeze 在线音色，可在设置页填 Breeze API Key（`brz_` 开头，可选，不影响本地音色）；
- 8 个 Kokoro 离线女声来自 **Kokoro 中文女声**（Apache-2.0，sherpa-onnx 转换版），一次下载约 **348MB**；
- 鱼鱼酱 / 鱼鱼姐的本地模型由 Piper 中文开源模型（Xiao Ya medium）微调而来，底座数据集 BZNSYP 为非商用许可，**仅供个人非商业使用**。

## 安装

### 方式零：让 AI Agent 帮你装（复制这一句就行）

> 从这个仓库安装插件：`https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy`，装好加进 DSH desktop profile 的 `dsh.profile.bundles`，然后提醒我重启。

Agent 会执行 `pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy`。完整的给-agent 指令、验收标准和排错见 [AGENT-INSTALL.md](AGENT-INSTALL.md)。

### 方式一：插件市场（推荐）

DSH → 插件市场 → 搜索「大肥鱼语音」或 `dsh-pet-voice-fishy` → 安装 → 重启 DSH。

### 方式二：Gitee 直链（国内最快，免 VPN）

```powershell
Invoke-WebRequest -Uri "https://gitee.com/bbfcyber/dsh-pet-voice-fishy/raw/master/release/v130/dsh-pet-voice-fishy-1.3.1.tgz" -OutFile "$env:TEMP\dsh-pet-voice-fishy.tgz"
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add "file:$env:TEMP\dsh-pet-voice-fishy.tgz" --registry=https://registry.npmmirror.com
# 再把 dsh-pet-voice-fishy 加进 package.json 的 dsh.profile.bundles
```

### 方式三：GitHub 直链（gh-proxy 加速，免 VPN）

```powershell
# 国内如果 GitHub 慢，用 gh-proxy 前缀：https://gh-proxy.com/https://github.com/...
Invoke-WebRequest -Uri "https://gh-proxy.com/https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/download/v1.3.1/dsh-pet-voice-fishy-1.3.1.tgz" -OutFile "$env:TEMP\dsh-pet-voice-fishy.tgz"
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
5. 想用 Kokoro 离线女声：在「离线音色（断网可用）」里点 **下载**（约 348MB，有进度条），装完选任意离线女声；
6. 想用鱼鱼酱 / 鱼鱼姐：在「离线音色（断网可用）」里点下载（各约 58MB），装完切过去即可，不需要 Key。

音色包下载完成后即可断网使用；Breeze 在线音色（可选）需要联网和有效的 API Key。

## 离线是怎么做到"插件小"的

- 安装包里**只有代码**，没有任何模型；
- 第一次用到离线音色时，才从镜像下载音色包（tar.bz2）到 `$DSH_HOME/dsh-pet-voice/models/`：鱼鱼酱 / 鱼鱼姐各约 58MB，Kokoro 合集约 348MB；
- 推理跑在 **worker 线程**（sherpa-onnx / ONNX Runtime CPU），不会卡 DSH 主界面；
- 已下载过的模型不会重复下载；模型就绪后，朗读不产生任何网络请求。

## 配置

`$DSH_HOME/dsh-pet-voice/config.json`：

```json
{
  "enabled": true,
  "volume": 0.8,
  "voiceId": "breeze-yuyujiang",
  "breezeApiKey": ""
}
```

- `voiceId` 可选值见上面的音色表（如 `breeze-yuyujiang`、`breeze-yuyujie`、`kokoro-41`）；
- `breezeApiKey` 只保存在本机，不会上传；不填也不影响本地离线音色；
- 模型目录也可以用环境变量 `DSH_PET_VOICE_MODELS_DIR` 覆盖。

## 路由

```
GET  /dsh-pet-voice/state                    → 配置、音色、音色包状态
POST /dsh-pet-voice/state                    → 修改配置（enabled / volume / voiceId / breezeApiKey）
GET  /dsh-pet-voice/tts?voice=&text=         → audio/mpeg（在线）或 audio/wav（离线）
GET  /dsh-pet-voice/packs                    → 音色包安装状态
POST /dsh-pet-voice/packs/install?id=yuyujiang  → 开始下载/安装音色包
GET  /dsh-pet-voice/packs/progress?id=yuyujiang → 下载进度
GET  /dsh-pet-voice/breeze/voices            → 列出 Breeze 账号里的音色
```

## 已知限制

- 只覆盖**网页形态**的桌宠；桌面浮动版由 dsh-pet 自己的 Electron 助手渲染，需要上游支持；
- 鱼鱼酱 / 鱼鱼姐为**本地离线模型**：CPU 推理，不需要 Key / GPU / 联网，首次下载各约 58MB；
- Breeze 在线音色为可选能力，需要联网 + 自己的 API Key，且消耗你的 Breeze 余额；
- 音色包首次下载需要等（有进度条，支持断点续传）；
- 中文里的英文单词可能被读成"忽略"（离线模型的 OOV 限制）。

## 版权与合规

- 插件代码 MIT；离线语音模型 **不随包分发**，由使用者按需从 GitHub Releases 或镜像下载；
- Kokoro 模型为 Apache-2.0；鱼鱼酱 / 鱼鱼姐的本地模型由 Piper 中文开源模型（Xiao Ya medium，BZNSYP 数据集为非商用许可）微调而来，**仅供个人非商业使用**；
- BreezeBlue 为第三方云服务，使用需遵守其服务条款；音色由用户本人提供并授权本地化；
- 本插件不包含任何影视 / 游戏角色音色模型。

## 许可

MIT。模型与推理引擎许可见各自仓库（sherpa-onnx、Kokoro）。
