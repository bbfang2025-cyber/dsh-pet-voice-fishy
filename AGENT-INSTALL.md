# 装大肥鱼语音（给 AI Agent 的指令）

> 版本：**V1.0**（package `1.0.0`）
> 作用：给 DSH 网页桌宠（dsh-pet）配音。桌宠冒气泡/碎碎念时自动朗读；**右键碎碎念气泡**可再读一遍；点桌宠会回一句互动台词。不修改 dsh-pet 的任何文件。

---

## 给用户的用法（一句话）

把下面这段整段复制给你自己的 DSH agent：

> 从这个仓库安装插件：`https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy`
> 装好后把它加进 DSH desktop profile 的 `dsh.profile.bundles`，然后告诉我需要重启。

---

## 给 Agent 的完整步骤

### 方式 A：直接从 GitHub 装（推荐，永远最新）

```bash
# 1. 进入 DSH 的 desktop profile 目录
cd ~/.dsh/profiles/desktop        # Windows: C:\Users\<你>\.dsh\profiles\desktop

# 2. 从仓库安装（不需要 npm 发布、不需要 Release）
pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy

# 3. 把插件加进 profile 的 bundles
#    编辑 package.json，在 dsh.profile.bundles 数组里追加 "dsh-pet-voice-fishy"
```

### 方式 B：用 Release 里的预构建包

```bash
cd ~/.dsh/profiles/desktop
# 国内（快）
pnpm add https://gitee.com/bbfcyber/dsh-pet-voice-fishy/releases/download/v1.1.2/dsh-pet-voice-fishy-1.1.2.tgz
# 或者 GitHub
# pnpm add https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy/releases/download/v1.1.2/dsh-pet-voice-fishy-1.1.2.tgz
# 同样把 "dsh-pet-voice-fishy" 加进 dsh.profile.bundles
```

### 完成后

1. **完全退出并重新打开 DSH**（插件在启动时加载）；
2. 刷新页面，打开 设置 → **大肥鱼语音**，能看到音色列表就说明装好了。

---

## 给 Agent 的验收标准

装完必须逐条确认，不要只看安装命令是否成功：

- [ ] `node_modules/dsh-pet-voice-fishy/package.json` 存在且 `version` 是 `1.0.0`
- [ ] `node_modules/dsh-pet-voice-fishy/lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`assets/voices.json` 都在
- [ ] profile 的 `package.json` 里，`dsh.profile.bundles` 数组包含 `"dsh-pet-voice-fishy"`
- [ ] DSH 重启后，设置页出现「大肥鱼语音」分区
- [ ] 有 `~/.dsh/dsh-pet-voice/config.json`（第一次加载会自动创建）

> 可选依赖 `sherpa-onnx-node` 用于离线音色。装不上也不影响在线音色（Breeze）和界面，只是离线女声不可用。

---

## 功能和设置

| 设置项 | 位置 | 默认 |
|---|---|---|
| 气泡朗读开关 | 设置 → 大肥鱼语音 | 开 |
| 音量 | 同上 | 0.8 |
| 朗读频率（自动朗读最小间隔） | 同上 | **30 秒**（可选 不限 / 30 秒 / 60 秒 / 3 分钟） |
| 音色 | 同上 | 鱼鱼酱（在线） |

**使用方式**

- 桌宠冒碎碎念气泡 → **自动朗读**（受 30 秒间隔限制，避免一直说话）
- **左键点碎碎念气泡** → 立刻读这条（不受间隔限制）
- **右键 / 长按碎碎念气泡** → 再读一遍这条（不受间隔限制，也不会弹浏览器右键菜单）
- **点桌宠本体** → 随机回一句互动台词

**音色**

- 2 个在线 Breeze 自定义音色：需要自己填 API Key（设置页里粘贴）
- 8 个离线中文女声：首次选用时自动下载音色包（约 348MB，多镜像、断点续传），之后断网可用

---

## 常见问题

**右键气泡没反应？**
先确认装的是 `1.0.0` 或更新版本（0.2.0 及更早版本只支持左键）。用 `node -e "console.log(require('./node_modules/dsh-pet-voice-fishy/package.json').version)"` 检查。

**气泡出现了但不出声？**
1. 设置页确认「气泡朗读」是开的、音量不为 0；
2. 浏览器需要先有一次用户交互（点页面任意处）才能播放音频；
3. 看控制台有没有 `[dsh-pet-voice]` 开头的警告；
4. 在线音色需要网络和有效的 Breeze Key；离线音色需要等音色包下载完。

**和别的语音插件冲突？**
本插件的数据目录是 `~/.dsh/dsh-pet-voice/`。如果同时装了别的同名插件，配置会互相覆盖，建议只保留一个。

---

## 卸载

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-pet-voice-fishy
# 并从 package.json 的 dsh.profile.bundles 里删掉 "dsh-pet-voice-fishy"
```

数据目录 `~/.dsh/dsh-pet-voice/`（含已下载的音色模型）不会被自动删除，需要手动清。

---

仓库：https://github.com/bbfang2025-cyber/dsh-pet-voice-fishy
