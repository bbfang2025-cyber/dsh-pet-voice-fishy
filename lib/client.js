/**
 * dsh-pet-voice 浏览器半侧
 * - 播放：轮询 dsh-pet 的 /state（pets.<id>.say.data），新气泡 → /dsh-pet-voice/tts → 播放
 * - 点击桌宠：随机说一句
 * - 设置：DSH 设置里注册「大肥鱼语音」页（音色 / 开关 / 音量）
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-voice-fishy',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState, useCallback } = React;

    const API = '/dsh-pet-voice';
    const PET_STATE = '/dsh-pet-7340/state';
    const POLL_MS = 1200;
    const CONFIG_REFRESH_MS = 5000;
    const PREVIEW_TEXT = '主人，小鱼在这呢';
    const CLICK_LINES = [
      '主人，小鱼在这呢',
      '我在呢，主人',
      '嘿嘿，被你摸到了',
      '要一起加油哦',
      '摸鱼中，请稍等',
    ];

    // ---------- 全局播放状态（与 React 无关） ----------
    const player = {
      cfg: { enabled: true, volume: 0.8, voiceId: 'breeze-yuyujiang' },
      voices: [],
      sayCounters: new Map(), // petId -> 已读 say.counter
      initialized: false,
      current: null,
      pending: null,
      unlocked: false,
      inflight: false,
      clickIdx: 0,
      lastSpokenText: '',
      lastSpokenNorm: '',
      lastSpokenAt: 0,
      lastAutoSpeakAt: 0,
    };

    async function fetchJson(url, options) {
      const res = await fetch(url, { cache: 'no-store', ...(options || {}) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    async function refreshConfig() {
      try {
        const s = await fetchJson(API + '/state');
        if (s && s.config) player.cfg = s.config;
        if (s && Array.isArray(s.voices)) player.voices = s.voices;
        return s;
      } catch {
        return null;
      }
    }

    function stopCurrent() {
      if (player.current) {
        try {
          player.current.pause();
        } catch {
          /* ignore */
        }
        player.current = null;
      }
    }

    function playBlobUrl(url, isPreview) {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, Number(player.cfg.volume) || 0.8));
      if (!isPreview) player.current = audio;
      const p = audio.play();
      if (p && p.catch) {
        p.catch(() => {
          player.pending = { url, isPreview };
        });
      }
      return audio;
    }

    async function speakText(text, force) {
      if (!player.cfg.enabled) return;
      if (!text) return;
      const now = Date.now();
      // 去重：轮询（状态文本）和 DOM 监听可能拿到「同一句、但标点/空白/表情不同」的文本，
      // 所以先归一化再比较，窗口 6 秒；避免同一句话被读两遍（两个音源）。
      const norm = normalizeForDedupe(text);
      if (!force && player.lastSpokenNorm === norm && now - player.lastSpokenAt < 6000) return;
      // 自动朗读限频：两次自动朗读之间至少间隔 minIntervalSec 秒（用户主动点不受限）
      if (!force && !allowAutoSpeak()) return;
      // 多开窗口/标签页时只让一个页面出声（localStorage 跨标签共享）
      if (!force && otherTabSpokeRecently()) return;
      player.lastSpokenText = text;
      player.lastSpokenNorm = norm;
      player.lastSpokenAt = now;
      if (!force) {
        player.lastAutoSpeakAt = now;
        markAutoSpoke();
      }
      if (player.inflight) return; // 上一句还在取音频：丢弃，避免叠音
      player.inflight = true;
      stopCurrent();
      try {
        // 关键：先向宿主申请「这次由我播」——同一 DSH 实例下（桌面窗口 + 浏览器标签页 +
        // 多开窗口）只会有一个页面拿到 allow，其余直接跳过，从根上消除双音源。
        const allowed = await claimPlayback(text, !!force);
        if (!allowed) return;
        const url = API + '/tts?voice=' + encodeURIComponent(player.cfg.voiceId) + '&text=' + encodeURIComponent(text);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const blob = await res.blob();
        playBlobUrl(URL.createObjectURL(blob), false);
      } catch {
        /* 静默失败 */
      } finally {
        player.inflight = false;
      }
    }

    async function claimPlayback(text, force) {
      try {
        const res = await fetch(API + '/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, force, intervalSec: Number(player.cfg.minIntervalSec) || 0 }),
        });
        if (!res.ok) return true; // 宿主异常时不影响正常朗读
        const j = await res.json();
        return !!(j && j.allow);
      } catch {
        return true;
      }
    }

    function normalizeForDedupe(text) {
      return String(text || '')
        .replace(/[\s\u3000]/g, '')
        .replace(/[\p{P}\p{S}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .toLowerCase();
    }

    function otherTabSpokeRecently() {
      try {
        const v = Number(localStorage.getItem('dsh-pet-voice:last-auto') || 0);
        return v > 0 && Date.now() - v < 2500;
      } catch {
        return false;
      }
    }

    function markAutoSpoke() {
      try {
        localStorage.setItem('dsh-pet-voice:last-auto', String(Date.now()));
      } catch {
        /* ignore */
      }
    }

    function canSpeak() {
      return !!player.cfg.enabled && !document.hidden;
    }

    function allowAutoSpeak() {
      const interval = Number(player.cfg.minIntervalSec) || 0;
      if (!interval) return true;
      return Date.now() - (player.lastAutoSpeakAt || 0) >= interval * 1000;
    }

    async function pollPetState() {
      let state;
      try {
        const res = await fetch(PET_STATE, { cache: 'no-store' });
        if (!res.ok) return;
        state = await res.json();
      } catch {
        return;
      }
      const pets = (state && state.pets) || {};
      const first = !player.initialized;
      for (const [petId, leaves] of Object.entries(pets)) {
        const leaf = leaves && leaves.say;
        if (!leaf || !leaf.data) continue;
        const counter = typeof leaf.counter === 'number' ? leaf.counter : null;
        if (counter !== null) {
          if (player.sayCounters.get(petId) === counter) continue;
          player.sayCounters.set(petId, counter);
          if (first) continue; // 首次加载不补播历史气泡
        }
        const d = leaf.data;
        if (d.clear === true) continue;
        const text = typeof d.text === 'string' ? d.text.trim() : '';
        if (!text) continue;
        if (!canSpeak()) continue;
        speakText(text);
      }
      player.initialized = true;
    }

    function installUnlock() {
      const unlock = () => {
        player.unlocked = true;
        if (player.pending) {
          const p = player.pending;
          player.pending = null;
          playBlobUrl(p.url, p.isPreview);
        }
      };
      document.addEventListener('pointerdown', unlock, { capture: true });
      document.addEventListener('keydown', unlock, { capture: true });
    }

    // 点击桌宠 → 说一句（拖拽不触发：按下/抬起位移超过 8px 忽略）
    // 点击桌宠的碎碎念气泡 → 把气泡内容读出来
    function installPetClick() {
      let down = null;
      document.addEventListener(
        'pointerdown',
        (e) => {
          const el = e.target instanceof Element ? e.target.closest('.dsh-pet-hit, .dsh-pet-bubble') : null;
          if (el) down = { x: e.clientX, y: e.clientY, t: Date.now(), isBubble: el.classList.contains('dsh-pet-bubble') };
        },
        true,
      );
      document.addEventListener(
        'pointerup',
        (e) => {
          if (!down) return;
          const start = down;
          down = null;
          // 只处理左键；右键交给 contextmenu 那条路，避免读两遍
          if (e.button !== 0) return;
          const el = e.target instanceof Element ? e.target.closest('.dsh-pet-hit, .dsh-pet-bubble') : null;
          if (!el) return;
          const dx = Math.abs(e.clientX - start.x);
          const dy = Math.abs(e.clientY - start.y);
          if (dx > 8 || dy > 8 || Date.now() - start.t > 900) return;

          if (el.classList.contains('dsh-pet-bubble')) {
            // 主动点击碎碎念 → 朗读气泡内容
            const text = bubbleText(el);
            if (text) speakText(text, true);
            return;
          }

          const line = CLICK_LINES[player.clickIdx % CLICK_LINES.length];
          player.clickIdx += 1;
          speakText(line, true);
        },
        true,
      );
    }

    function bubbleText(el) {
      // 优先取气泡正文行：dsh-pet 的碎碎念把每一行放在 .pet-bub-row 里，
      // 直接 textContent 会把按钮、图标旁的文字也算进来。
      let rows = [];
      try {
        rows = Array.from(el.querySelectorAll('.pet-bub-row'));
      } catch {
        rows = [];
      }
      if (rows.length) {
        const joined = rows
          .map((r) => (r.textContent || '').trim())
          .filter(Boolean)
          .join(' ');
        if (joined) return joined;
      }
      const clone = el.cloneNode(true);
      if (clone.querySelectorAll) clone.querySelectorAll('button, svg, img').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // 右键碎碎念气泡 → 朗读这条内容（拦掉浏览器原生右键菜单）
    function installBubbleContextMenu() {
      document.addEventListener(
        'contextmenu',
        (e) => {
          const el = e.target instanceof Element ? e.target.closest('.dsh-pet-bubble') : null;
          if (!el) return;
          const text = bubbleText(el);
          if (!text) return;
          e.preventDefault();
          e.stopPropagation();
          speakText(text, true);
        },
        true,
      );
    }

    // 注意：自动朗读只走 pollPetState 这一条路（状态里的 say.data.text 是唯一真源）。
    // 之前额外用 MutationObserver 读 .dsh-pet-whisper 气泡文本，两条路拿到的文本
    // 标点/空白/表情可能不同，去重会失效 → 同一句话被读两遍（两个音源）。
    // 点击/右键气泡仍然走 bubbleText()，不受影响。

    // ---------- 设置页 UI ----------
    const CSS = `
.dpv-root{font-size:13px;color:var(--dsh-text,#222);display:flex;flex-direction:column;gap:16px;padding:4px 2px}
.dpv-card{background:var(--dsh-bg-card,#fff);border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:14px 16px}
.dpv-title{font-size:15px;font-weight:600;margin:0 0 6px}
.dpv-desc{color:#888;font-size:12px;margin:0 0 10px}
.dpv-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dpv-switch{width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;position:relative;background:#d8dbe2;transition:.15s}
.dpv-switch.on{background:#5b8cff}
.dpv-switch::after{content:'';position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.15s}
.dpv-switch.on::after{left:22px}
.dpv-slider{flex:1;accent-color:#5b8cff;cursor:pointer}
.dpv-vol{width:44px;text-align:right;color:#666}
.dpv-voice{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(0,0,0,.08);border-radius:10px;margin-top:8px;cursor:pointer}
.dpv-voice.active{border-color:#5b8cff;background:rgba(91,140,255,.08)}
.dpv-voice-main{flex:1;min-width:0}
.dpv-voice-name{font-weight:600}
.dpv-voice-desc{color:#888;font-size:12px;margin-top:2px}
.dpv-tag{font-size:11px;color:#5b8cff;border:1px solid rgba(91,140,255,.4);border-radius:8px;padding:0 6px;margin-left:6px}
.dpv-btn{border:1px solid rgba(0,0,0,.12);background:transparent;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;color:inherit}
.dpv-btn:hover{border-color:#5b8cff;color:#5b8cff}
.dpv-btn:disabled{opacity:.45;cursor:not-allowed}
.dpv-input{flex:1;min-width:0;border:1px solid rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:13px;background:transparent;color:inherit}
.dpv-tag.warn{color:#d97706;border-color:rgba(217,119,6,.5)}
.dpv-voice.locked{opacity:.7}
.dpv-err{color:#dc2626;font-size:12px;margin-top:4px;line-height:1.4}
.dpv-freqs{gap:8px;flex-wrap:wrap;justify-content:flex-start}
.dpv-freq.active{border-color:#5b8cff;color:#5b8cff;background:rgba(91,140,255,.08)}
.dpv-hint{color:#999;font-size:12px;margin-top:8px}
`;
    function ensureStyle() {
      if (document.querySelector('style[data-plugin-css="dsh-pet-voice/panel"]')) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-pet-voice';
      tag.dataset.pluginCss = 'dsh-pet-voice/panel';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function VoicePanel() {
      const [state, setState] = useState(null);
      const [volume, setVolume] = useState(0.8);
      const [busy, setBusy] = useState(false);
      const [breezeKey, setBreezeKey] = useState('');
      const [packProgress, setPackProgress] = useState({});
      const [voiceError, setVoiceError] = useState({});
      const [keyMsg, setKeyMsg] = useState('');
      const previewRef = useRef(null);
      const saveTimer = useRef(null);
      const pendingVoice = useRef(null);
      const pendingPreview = useRef(null);

      const load = useCallback(async () => {
        const s = await refreshConfig();
        if (s) {
          setState(s);
          setVolume(Number(s.config.volume) || 0.8);
        }
      }, []);

      useEffect(() => {
        ensureStyle();
        load();
        const timer = setInterval(load, 4000);
        return () => {
          clearInterval(timer);
          if (previewRef.current) {
            try {
              previewRef.current.pause();
            } catch {
              /* ignore */
            }
          }
          if (saveTimer.current) clearTimeout(saveTimer.current);
        };
      }, [load]);

      const post = useCallback(async (patch) => {
        setBusy(true);
        try {
          const res = await fetch(API + '/state', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          });
          const s = await res.json();
          if (s && s.config) {
            setState(s);
            player.cfg = s.config;
            setVolume(Number(s.config.volume) || 0.8);
          }
        } catch {
          /* ignore */
        } finally {
          setBusy(false);
        }
      }, []);

      const preview = useCallback(async (voiceId) => {
        if (previewRef.current) {
          try {
            previewRef.current.pause();
          } catch {
            /* ignore */
          }
        }
        setVoiceError((e) => ({ ...e, [voiceId]: '' }));
        try {
          const res = await fetch(
            API + '/tts?voice=' + encodeURIComponent(voiceId) + '&text=' + encodeURIComponent(PREVIEW_TEXT) + '&t=' + Date.now(),
            { cache: 'no-store' }
          );
          if (!res.ok) {
            let msg = 'HTTP ' + res.status;
            try {
              const j = await res.json();
              if (j && j.error) msg = j.error;
            } catch {
              /* ignore */
            }
            setVoiceError((e) => ({ ...e, [voiceId]: msg }));
            return;
          }
          const blob = await res.blob();
          previewRef.current = playBlobUrl(URL.createObjectURL(blob), true);
        } catch (e) {
          setVoiceError((err) => ({ ...err, [voiceId]: '网络错误：' + ((e && e.message) || e) }));
        }
      }, []);

      const downloadPack = useCallback(
        async (id) => {
          setPackProgress((p) => ({ ...p, [id]: { state: 'downloading', percent: 0, message: '开始下载' } }));
          try {
            const res = await fetch(API + '/packs/install?id=' + encodeURIComponent(id), { method: 'POST' });
            const j = await res.json();
            if (!j.ok) throw new Error(j.error || '启动下载失败');
          } catch (e) {
            setPackProgress((p) => ({ ...p, [id]: { state: 'error', message: String((e && e.message) || e) } }));
            return;
          }
          const timer = setInterval(async () => {
            try {
              const r = await fetch(API + '/packs/progress?id=' + encodeURIComponent(id), { cache: 'no-store' });
              const d = await r.json();
              const prog = d.progress || {};
              setPackProgress((p) => ({ ...p, [id]: prog }));
              if (prog.state === 'done' || prog.state === 'error') {
                clearInterval(timer);
                if (prog.state === 'done') {
                  const want = pendingVoice.current;
                  const wantPreview = pendingPreview.current;
                  pendingVoice.current = null;
                  pendingPreview.current = null;
                  load().then(() => {
                    if (want) post({ voiceId: want });
                    if (wantPreview) setTimeout(() => preview(wantPreview), 250);
                  });
                }
              }
            } catch {
              /* ignore */
            }
          }, 700);
        },
        [load],
      );

      if (!state) return h('div', { className: 'dpv-root' }, '加载中…');
      const cfg = state.config || {};
      const voices = state.voices || [];
      const version = state.version || '?';
      // 1.3.3 起宿主 /state 的 packs 统一为数组；这里同时兼容旧版的对象形状
      const packsArr = Array.isArray(state.packs) ? state.packs : Object.values(state.packs || {});
      const packById = (id) => packsArr.find((p) => p.id === id) || (state.packs || {})[id] || null;

      return h(
        'div',
        { className: 'dpv-root' },
        h('p', { className: 'dpv-hint', style: { margin: '0 2px -6px' } }, '大肥鱼语音 v' + version),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, '气泡朗读'),
          h('p', { className: 'dpv-desc' }, '桌宠冒气泡时自动念出来（本地离线音色，音色包装好后断网也能说）'),
          h(
            'div',
            { className: 'dpv-row' },
            h('span', null, cfg.enabled ? '已开启' : '已关闭'),
            h('button', {
              className: 'dpv-switch' + (cfg.enabled ? ' on' : ''),
              disabled: busy,
              onClick: () => post({ enabled: !cfg.enabled }),
              'aria-label': '气泡朗读开关',
            }),
          ),
        ),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, '音量'),
          h(
            'div',
            { className: 'dpv-row' },
            h('input', {
              className: 'dpv-slider',
              type: 'range',
              min: 0,
              max: 100,
              value: Math.round(volume * 100),
              onChange: (e) => {
                const v = Number(e.target.value) / 100;
                setVolume(v);
                player.cfg = { ...player.cfg, volume: v };
                if (saveTimer.current) clearTimeout(saveTimer.current);
                saveTimer.current = setTimeout(() => post({ volume: v }), 350);
              },
            }),
            h('span', { className: 'dpv-vol' }, Math.round(volume * 100) + '%'),
          ),
        ),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, '朗读频率'),
          h('p', { className: 'dpv-desc' }, '自动朗读的最小间隔，避免桌宠一直说话；你主动点它不受限制'),
          h(
            'div',
            { className: 'dpv-row dpv-freqs' },
            ...[
              [0, '不限'],
              [30, '30 秒'],
              [60, '60 秒'],
              [180, '3 分钟'],
            ].map(([sec, label]) =>
              h(
                'button',
                {
                  key: sec,
                  className: 'dpv-btn dpv-freq' + (Math.round(Number(cfg.minIntervalSec) || 0) === sec ? ' active' : ''),
                  disabled: busy,
                  onClick: () => post({ minIntervalSec: sec }),
                },
                label,
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, '音色'),
          h('p', { className: 'dpv-desc' }, '点「试听」听声音，点卡片切换'),
          ...voices.map((v) => {
            const locked = v.available === false;
            const packInfo = v.pack ? packById(v.pack) : null;
            const prog = packInfo ? packProgress[packInfo.id] || packInfo.progress || null : null;
            const downloading = !!(prog && prog.state === 'downloading');
            // 只有缺 Breeze Key 的在线音色才禁用试听；离线音色未下载时试听按钮可点，点了自动下载
            const trialDisabled = !!v.needsBreezeKey;
            const warnTag = v.needsBreezeKey ? '需配 Key' : v.needsDownload ? '未下载' : null;
            const trialLabel = downloading
              ? '下载中 ' + (prog.percent || 0) + '%'
              : v.needsDownload
                ? '试听（先下载）'
                : '试听';
            return h(
              'div',
              {
                key: v.id,
                className: 'dpv-voice' + (cfg.voiceId === v.id ? ' active' : '') + (locked ? ' locked' : ''),
                onClick: () => {
                  if (locked) {
                    if (v.needsDownload && v.pack) {
                      pendingVoice.current = v.id;
                      downloadPack(v.pack);
                    }
                    return;
                  }
                  post({ voiceId: v.id });
                },
              },
              h(
                'div',
                { className: 'dpv-voice-main' },
                h(
                  'div',
                  { className: 'dpv-voice-name' },
                  v.name,
                  ...(v.tags || []).map((tag, i) => h('span', { key: i, className: 'dpv-tag' }, tag)),
                  locked && warnTag ? h('span', { className: 'dpv-tag warn' }, warnTag) : null,
                ),
                h('div', { className: 'dpv-voice-desc' }, v.desc || ''),
                v.needsDownload && !downloading ? h('div', { className: 'dpv-hint' }, '点「试听」会自动下载音色包，下载完自动播放') : null,
                voiceError[v.id] ? h('div', { className: 'dpv-err' }, '试听失败：' + voiceError[v.id]) : null,
              ),
              h(
                'button',
                {
                  className: 'dpv-btn',
                  disabled: trialDisabled || downloading,
                  onClick: (e) => {
                    e.stopPropagation();
                    if (trialDisabled || downloading) return;
                    if (v.needsDownload && v.pack) {
                      pendingPreview.current = v.id;
                      pendingVoice.current = v.id;
                      downloadPack(v.pack);
                      return;
                    }
                    preview(v.id);
                  },
                },
                trialLabel,
              ),
            );
          }),
          h('p', { className: 'dpv-hint' }, '点击桌宠本体也会说一句；首次没声音时先在页面点一下鼠标。'),
        ),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, 'Breeze 在线音色（可选）'),
          h(
            'p',
            { className: 'dpv-desc' },
            cfg.breezeConfigured
              ? '已配置（' + (cfg.breezeKeyHint || '已保存') + '）：可使用 Breeze 后台的在线音色（鱼鱼酱 / 鱼鱼姐已改为本地离线，不需要 Key）'
              : '可选。填入 Breeze API Key 后可使用 Breeze 在线音色；鱼鱼酱 / 鱼鱼姐已改为本地离线，不需要 Key',
          ),
          h(
            'div',
            { className: 'dpv-row' },
            h('input', {
              className: 'dpv-input',
              type: 'password',
              placeholder: 'brz_...',
              value: breezeKey,
              onChange: (e) => setBreezeKey(e.target.value),
            }),
            h(
              'button',
              {
                className: 'dpv-btn',
                disabled: busy || !breezeKey.trim(),
                onClick: async () => {
                  const k = breezeKey.trim();
                  if (!k.startsWith('brz_')) {
                    setKeyMsg('Key 应以 brz_ 开头（在 Breeze 后台 API Keys 里复制，不要填音色 ID）');
                    return;
                  }
                  await post({ breezeApiKey: k });
                  setBreezeKey('');
                  setKeyMsg('已保存');
                },
              },
              '保存',
            ),
          ),
          keyMsg ? h('div', { className: 'dpv-err' }, keyMsg) : null,
          h('p', { className: 'dpv-hint' }, 'Key 只保存在本机数据目录（$DSH_HOME/dsh-pet-voice/config.json），不会上传。'),
        ),
        h(
          'div',
          { className: 'dpv-card' },
          h('p', { className: 'dpv-title' }, '离线音色（断网可用）'),
          h('p', { className: 'dpv-desc' }, '鱼鱼酱 / 鱼鱼姐各约 58MB，Kokoro 合集约 348MB；下载一次后断网也能说话'),
          ...packsArr.map((pack) => {
            const prog = packProgress[pack.id] || pack.progress || null;
            const downloading = prog && prog.state === 'downloading';
            const failed = prog && prog.state === 'error';
            const status = pack.installed
              ? '已安装，断网可用'
              : downloading
                ? (prog.message || '下载中') + ' ' + (prog.percent || 0) + '%'
                : failed
                  ? prog.message
                  : pack.desc;
            return h(
              'div',
              { key: pack.id, className: 'dpv-voice' },
              h(
                'div',
                { className: 'dpv-voice-main' },
                h(
                  'div',
                  { className: 'dpv-voice-name' },
                  pack.name,
                  h('span', { className: 'dpv-tag' }, '离线'),
                  h('span', { className: 'dpv-tag' }, (pack.sizeMB || 0) + 'MB'),
                ),
                h('div', { className: 'dpv-voice-desc' }, status),
              ),
              pack.installed
                ? h('span', { className: 'dpv-tag' }, '已安装')
                : h(
                    'button',
                    { className: 'dpv-btn', disabled: downloading, onClick: () => downloadPack(pack.id) },
                    downloading ? (prog.percent || 0) + '%' : failed ? '重试' : '下载',
                  ),
            );
          }),
          h('p', { className: 'dpv-hint' }, '下载完成后，在「音色」里选择任意离线女声即可断网使用。'),
        ),
      );
    }

    // ---------- 插件定义 ----------
    const name = 'dsh-pet-voice-fishy';
    const inject = ['slots'];

    function apply(ctx) {
      refreshConfig();
      installUnlock();
      installPetClick();
      installBubbleContextMenu();
      setInterval(pollPetState, POLL_MS);
      setInterval(refreshConfig, CONFIG_REFRESH_MS);

      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.section',
            id: 'pet-voice',
            order: 40,
            label: () => '大肥鱼语音',
          },
          VoicePanel,
        );
      });
    }

    module.exports = { name, inject, apply };
    return module.exports;
  },
});
