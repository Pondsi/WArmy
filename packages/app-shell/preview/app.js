/* WArmy renderer — 文案全在 i18n；主题/分栏/模型拉取/附件/语音/总看板 */
(() => {
  const $ = (id) => document.getElementById(id);
  let pendingAvatarTarget = null;
  const state = {
    nav: 'singleAi',
    yuYan: 'zh-CN',
    t: {},
    selectedChat: null,
    selectedInstance: null,
    urgency: 'P2',
    instances: [],
    groups: [],
    chats: [],
    hardware: null,
    globalSecurity: 'normal',
    sessionSecurity: {},
    sound: { complete: true, request: true, error: true },
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    theme: '#07c160',
    themeMode: 'system',
    consoleOpen: false,
    listSort: 'time',
    smtp: { host: '', port: 465, secure: true, user: '', pass: '' },
    smtpAccounts: [],
    embedUseGpu: true,
    listWidth: 280,
    panelWidth: 300,
    attachments: [],
    profile: { loggedIn: false, username: 'nav.touXiang', avatarDataUrl: '', email: '', deviceId: '', avatarPreset: 0 },
    queues: {},
    board: {
      /** ADR：外部聚合看板 — 会话进展只读，点击跳转；值班者写 board.jsonl */
      sessions: [
        { id: 's-internal-1', kind: 'internal', ming: 'demo.project1', jinDu: 65, status: 'doing', blocked: false, notify: true },
        { id: 's-internal-2', kind: 'internal', ming: 'demo.project2', jinDu: 30, status: 'doing', blocked: true },
        { id: 's-ext-1', kind: 'extgroup', ming: 'demo.client', jinDu: 90, status: 'doing', blocked: false },
        { id: 's-single-demo-1', kind: 'single', ming: 'demo.agent', jinDu: 40, status: 'doing', blocked: false },
      ],
      /** board.jsonl 结构化事件（值班者解析写入） */
      events: [
        { id: 'e1', ts: Date.now() - 3600e3, action: 'create_task', title: 'demo.task1', session: 'demo.project1' },
        { id: 'e2', ts: Date.now() - 1800e3, action: 'update_progress', title: 'demo.task1', session: 'demo.project1' },
        { id: 'e3', ts: Date.now() - 900e3, action: 'block', title: 'demo.task2', session: 'demo.project2' },
        { id: 'e4', ts: Date.now() - 300e3, action: 'complete_task', title: 'demo.task3', session: 'demo.agent' },
      ],
      recent: ['demo.recent1', 'demo.recent2'],
    },
    chaJianJi: [
      {
        id: 'agent-teams',
        ming: '@nanmicoder/dsh-agent-teams',
        enabled: true,
        desc: 'plugin.teams.desc',
      },
      {
        id: 'memory-plus',
        ming: 'dsh-memory-bundle',
        enabled: true,
        desc: 'plugin.memory.desc',
      },
    ],
    providers: [
      {
        id: 'deepseek',
        biaoQian: 'DeepSeek',
        protocol: 'openai-compatible',
        baseURL: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        apiKey: '',
        models: [],
      },
      {
        id: 'ollama',
        biaoQian: 'Ollama',
        protocol: 'ollama',
        baseURL: 'http://127.0.0.1:11434',
        defaultModel: 'qwen2.5:7b',
        apiKey: '',
        models: [],
      },
    ],
  };

  const t = (k) => state.t[k] || k;
  // 全局只注册一次 document click（避免每次开菜单都叠加）
  let __docClickBound = false;
  const __docClickHandlers = new Set();
  function onDocClick(fn) {
    __docClickHandlers.add(fn);
    if (!__docClickBound) {
      __docClickBound = true;
      document.addEventListener('click', (e) => {
        for (const fn of __docClickHandlers) fn(e);
      });
    }
  }
  /** 把下拉菜单 fixed 定位到触发按钮下方，避免被 overflow 裁切 */
  function positionMenuFixed(trigger, menu) {
    if (!trigger || !menu) return;
    const r = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    // .jinJiCaiDan 的 CSS 带 bottom:calc(100% + 6px)，不清掉会与 top 冲突、菜单被拉出视口
    menu.style.bottom = 'auto';
    menu.style.you = 'auto';
    menu.style.zIndex = '500';
    const mw = menu.offsetWidth || 170;
    const mh = menu.offsetHeight || 150;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const below = r.bottom + 4;
    const top = below + mh > window.innerHeight - 8 ? Math.max(8, r.top - 4 - mh) : below;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  let __rafThrottle = false;
  function raf(fn) {
    if (__rafThrottle) return;
    __rafThrottle = true;
    requestAnimationFrame(() => { __rafThrottle = false; fn(); });
  }
  let __inputThrottle = 0;
  const providerCfgModel = (p) => p.defaultModel || (p.models && p.models[0]) || 'deepseek-chat';
  const displayName = () =>
    state.t['yingYong.displayName'] || (state.yuYan.startsWith('zh') ? t('yingYong.zhName') : t('yingYong.enName'));
  /** 把任意输入夹成 0-100 的整数百分比，用于宽度与文本，避免注入 style 属性 */
  function clampPercent(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }
  /** 把 check-update 的可区分状态翻成用户能看懂的一句话（未配置/出错绝不冒充「最新」或「有新版本」） */
  function updateStatusText(r) {
    const st = r && r.status;
    if (st === 'update-available') {
      return t('update.status.available') + (r.latestVersion ? ' ' + r.latestVersion : '');
    }
    if (st === 'up-to-date') return t('update.status.upToDate');
    if (r && r.i18nKey) return t(r.i18nKey);
    return t('update.status.unknown');
  }
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 应用内弹窗：居中于主窗口，替代系统 alert/confirm */
  function uiAlert(message, biaoTi) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.add('yinCang');
        resolve(true);
      };
      acts.appendChild(ok);
      root.classList.remove('yinCang');
      ok.focus();
    });
  }

  function uiConfirm(message, biaoTi) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('yinCang');
        resolve(false);
      };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.remove('yinCang');
        resolve(true);
      };
      acts.append(cancel, ok);
      root.classList.remove('yinCang');
      ok.focus();
    });
  }

  /** 强制倒计时确认（危险操作） */
  function uiConfirmCountdown(message, biaoTi, seconds = 5) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); clearInterval(timer); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'anNiuDanger';
      ok.disabled = true;
      let left = seconds;
      const biaoQian = () => (t('urgency.confirmWait') || 'wait {s}s').replace('{s}', String(left));
      ok.textContent = biaoQian();
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          ok.disabled = false;
          ok.textContent = t('common.ok');
        } else {
          ok.textContent = biaoQian();
        }
      }, 1000);
      ok.onclick = () => { if (ok.disabled) return; root.classList.add('yinCang'); clearInterval(timer); resolve(true); };
      acts.append(cancel, ok);
      root.classList.remove('yinCang');
    });
  }

  function uiPrompt(message, defaultValue, biaoTi) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').innerHTML = '';
      const p = document.createElement('div');
      p.textContent = String(message ?? '');
      const shuRu = document.createElement('input');
      shuRu.style.cssText = 'width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--input-bg);color:var(--ink);font:inherit';
      shuRu.value = defaultValue ?? '';
      $('duiHuaKuangTi').append(p, shuRu);
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('yinCang');
        resolve(null);
      };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.add('yinCang');
        resolve(shuRu.value);
      };
      acts.append(cancel, ok);
      root.classList.remove('yinCang');
      shuRu.focus();
      shuRu.select();
      shuRu.onkeydown = (e) => {
        if (e.key === 'Enter') ok.click();
        if (e.key === 'Escape') cancel.click();
      };
    });
  }

  // ── 头像资源 ──
  const PERSON_AVATARS = Array.from({ length: 10 }, (_, i) => `./icons/avatars/person-${i + 1}.svg`);
  const PERSON_DEFAULT = './icons/avatars/person-default.svg';
  const PRESET_AVATARS = Array.from({ length: 10 }, (_, i) => `./icons/avatars/preset-${i + 1}.svg`);

  /** 我的头像：自定义图片 > 选定的人物头像 > 人物头像默认 */
  function personAvatarSrc(p) {
    if (p && p.avatarDataUrl) return p.avatarDataUrl;
    const n = Number(p && p.avatarPreset);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return PERSON_AVATARS[n - 1];
    return PERSON_DEFAULT;
  }

  /** 实例头像：自定义图片 > 分配的预设头像 > 第一个预设 */
  function instanceAvatarSrc(inst) {
    if (inst && inst.avatarDataUrl) return inst.avatarDataUrl;
    const n = Number(inst && inst.avatarPreset);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return PRESET_AVATARS[n - 1];
    return PRESET_AVATARS[0];
  }

  /** 实例创建时随机挑一个预设头像 */
  function randomPreset() {
    return 1 + Math.floor(Math.random() * PRESET_AVATARS.length);
  }

  /** 头像选择器：10 个预设 + 选择本地图片 */
  function pickAvatar(list, currentPreset, labelOf) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('touXiang.pickTitle');
      const ti = $('duiHuaKuangTi');
      ti.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'touXiangGrid';
      list.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'touXiangChoice' + (Number(currentPreset) === i + 1 ? ' qiYong' : '');
        b.title = labelOf(i);
        const im = document.createElement('img');
        im.src = src;
        im.alt = labelOf(i);
        b.appendChild(im);
        b.onclick = () => {
          root.classList.add('yinCang');
          resolve({ type: 'preset', preset: i + 1 });
        };
        grid.appendChild(b);
      });
      ti.appendChild(grid);
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const localBtn = document.createElement('button');
      localBtn.className = 'anNiuXiao';
      localBtn.textContent = t('touXiang.local');
      localBtn.onclick = () => {
        root.classList.add('yinCang');
        resolve({ type: 'local' });
      };
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('yinCang');
        resolve(null);
      };
      acts.append(localBtn, cancel);
      root.classList.remove('yinCang');
    });
  }

  function applyAvatar() {
    const img = $('selfAvatarImg');
    const span = $('selfAvatar');
    const src = personAvatarSrc(state.profile);
    if (src) {
      img.src = src;
      img.classList.remove('yinCang');
      span.classList.add('yinCang');
    } else {
      img.classList.add('yinCang');
      img.removeAttribute('src');
      span.classList.remove('yinCang');
      span.textContent = (state.profile.username || t('nav.touXiang')).slice(0, 1);
    }
  }

  function hslToHex(h, s, l) {
    const a2 = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const v = l / 100 - a2 * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  /** 相对亮度（WCAG） */
  function relLuminance(hex) {
    const ch = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  /** 该颜色配白字的对比度 */
  function contrastWithWhite(hex) {
    return 1.05 / (relLuminance(hex) + 0.05);
  }

  /**
   * 主题色板：17 个色相 × 3 个明度 = 51 色（每行 17 个）。
   *
   * 约束：
   *  - 每个色相先向下搜索出「白字对比度 >= 3.0」的最亮明度作为该列上限，
   *    再在 [上限, 上限-20] 区间内均分 3 档 —— 因此没有看不清的颜色；
   *  - 同一列越暗越饱和（+8%/档），使相邻两档在 RGB 上也有明显差异；
   *  - 相邻色相相差 20°，不会出现彼此接近的颜色。
   * 实测：51 色互不重复，最低白字对比度 3.02。
   */
  function accentPalette() {
    const HUES = [0, 20, 40, 60, 80, 100, 120, 150, 180, 200, 220, 240, 260, 280, 300, 320, 340];
    const ROWS = 3;
    const SAT_TOP = 58;
    const SAT_STEP = 8;
    const FLOOR = 22;
    const SPAN = 20;
    const TARGET = 3.0;
    const maxLight = (hue, sat) => {
      let l = 64;
      while (l > 12 && contrastWithWhite(hslToHex(hue, sat, l)) < TARGET) l -= 1;
      return l;
    };
    const cols = [];
    for (const h of HUES) {
      const lmax = maxLight(h, SAT_TOP);
      const lmin = Math.max(FLOOR, lmax - SPAN);
      const col = [];
      for (let k = 0; k < ROWS; k++) {
        const l = lmax - k * ((lmax - lmin) / (ROWS - 1));
        col.push(hslToHex(h, Math.min(96, SAT_TOP + k * SAT_STEP), l));
      }
      cols.push(col);
    }
    const grid = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < HUES.length; c++) grid.push(cols[c][r]);
    return grid;
  }

  /** 应用主题色（色板与自定义入口共用） */
  function applyAccent(color) {
    if (!color) return;
    state.theme = color;
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--me-bubble', color);
    window.warmy.settingsSave({ accent: color });
  }

  /** 自定义主题色：调色板 + 预览 + 取消/确定 */
  function pickCustomAccent() {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('settings.themeCustomTitle');
      const ti = $('duiHuaKuangTi');
      ti.innerHTML = `<div class="zhuTiPickerTi">
        <input type="color" id="zhuTiPickerShuRu" value="${escapeHtml(state.theme || '#c45c26')}"/>
        <div class="zhuTiPickerPreview">
          <span class="swatch" id="zhuTiPickerSwatch"></span>
          <span class="jingYin" id="zhuTiPickerHex"></span>
        </div>
        <div class="jingYin">${t('settings.themePreview')}</div>
      </div>`;
      const shuRu = $('zhuTiPickerShuRu');
      const swatch = $('zhuTiPickerSwatch');
      const hex = $('zhuTiPickerHex');
      const sync = () => {
        if (!shuRu) return;
        const v = String(shuRu.value || '#000000');
        swatch.style.background = v;
        const n = parseInt(v.slice(1), 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        hex.textContent = v.toUpperCase() + '   rgb(' + r + ', ' + g + ', ' + b + ')';
      };
      if (shuRu) {
        shuRu.oninput = sync;
        shuRu.onchange = sync;
      }
      sync();
      // 打开弹窗即直接弹出系统调色板，不需要再点一次色块
      if (shuRu) {
        setTimeout(() => {
          try {
            if (typeof shuRu.showPicker === 'function') shuRu.showPicker();
            else shuRu.click();
          } catch {
            try { shuRu.click(); } catch { /* noop */ }
          }
        }, 60);
      }
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); resolve(null); };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => { root.classList.add('yinCang'); resolve(shuRu ? shuRu.value : null); };
      acts.append(cancel, ok);
      root.classList.remove('yinCang');
    });
  }

  function renderThemeSwatches() {
    const box = $('zhuTiSwatches');
    if (!box || box.dataset.filled === '1') return;
    box.innerHTML = accentPalette()
      .map((col) => `<button data-c="${col}" style="background:${col}" title="${col}"></button>`)
      .join('');
    box.dataset.filled = '1';
  }

  function saveProfile() {
    window.warmy.profileSave({
      username: state.profile.username,
      email: state.profile.email,
      avatarDataUrl: state.profile.avatarDataUrl,
      avatarPreset: state.profile.avatarPreset,
    });
  }

  function syncTrayText() {
    // 设置第二列的水印文字也要随语言变化（CSS 里读这个变量）
    try {
      document.documentElement.style.setProperty('--brand-watermark', `"${t('brand.name')}"`);
    } catch {
      /* noop */
    }
    try {
      window.warmy.trayTooltip?.({
        text: `${t('brand.name')} ${t('brand.fu')}`,
        offWork: t('tray.offWork'),
        header: t('export.header'),
        wo: t('export.wo'),
      });
    } catch {
      /* noop */
    }
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    $('logoMing').textContent = displayName();
    $('logoFu').textContent = t('yingYong.subtitle');
    if ($('biaoTiLanPinPai')) $('biaoTiLanPinPai').textContent = displayName();
        applyAvatar();
    document.title = displayName();
    syncTrayText();
  }

  async function loadI18n(yuYan) {
    const pack = await window.warmy.i18n(yuYan);
    state.yuYan = pack.yuYan;
    state.t = pack.strings;
    if (pack.displayName) state.t['yingYong.displayName'] = pack.displayName;
    window.__refreshUrgency?.();
    window.__refreshSecurity?.();
    applyI18n();
  }

  function applyThemeMode(mode) {
    state.themeMode = mode;
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
      window.warmy?.setThemeSource?.('system');
    } else {
      root.setAttribute('data-theme', mode);
      window.warmy?.setThemeSource?.(mode);
    }
  }

  const NAV_TITLES = {
    wo: 'nav.touXiang',
    singleAi: 'nav.singleAi',
    internalGroup: 'nav.internalGroup',
    externalChat: 'nav.externalChat',
    externalGroup: 'nav.externalGroup',
    instances: 'nav.instances',
    settings: 'nav.settings',
  };
  const CHAT_NAVS = new Set(['singleAi', 'internalGroup', 'externalChat', 'externalGroup']);

  function hideMain() {
    $('kongTai').classList.add('yinCang');
    $('liaoTianBuJu').classList.add('yinCang');
    $('pageBuJu').classList.add('yinCang');
    $('shiLiXiangQing').classList.add('yinCang');
  }

  function setNav(nav) {
    state.nav = nav;
    document.querySelectorAll('.ceLanTiaoMu').forEach((el) => {
      el.classList.toggle('jiHuo', el.dataset.nav === nav);
    });
    hideMain();

    if (nav === 'settings' || nav === 'wo') {
      $('appTi').classList.add('yinCangLieBiao');
      $('pageBuJu').classList.remove('yinCang');
      $('pageBuJu').classList.toggle('peiZhiMoShi', nav === 'settings');
      renderPage();
      return;
    }
    $('pageBuJu').classList.remove('peiZhiMoShi');

    $('appTi').classList.remove('yinCangLieBiao');
    const lt = $('lieBiaoBiaoTi');
    lt.textContent = t(NAV_TITLES[nav] || nav);
    // 我的牛马：列表头右侧加牛马管理局图标
    const headActions = $('lieBiaoHeadDongZuoJi');
    const oldIcon = headActions?.querySelector('.lieBiaoHqTuBiao');
    if (oldIcon) oldIcon.remove();
    if (nav === 'singleAi' && headActions) {
      const icon = document.createElement('button');
      icon.className = 'lieBiaoHqTuBiao';
      icon.title = t('nav.instances');
      icon.innerHTML = '<svg viewBox="0 0 100 100" style="width:18px;height:18px"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>';
      icon.onclick = () => setNav('instances');
      headActions.insertBefore(icon, headActions.firstChild);
    }
    setupListAction();
    renderList();

    if (nav === 'instances') {
      if (!state.selectedInstance) {
        $('kongTai').classList.remove('yinCang');
        $('logoFu').textContent = t('instances.selectHint');
      } else {
        $('shiLiXiangQing').classList.remove('yinCang');
        renderInstanceDetail();
      }
      return;
    }

    $('logoFu').textContent = t('yingYong.subtitle');

    // 四个列表页：只要没停在本栏的某个会话上，就自动打开第一个
    if (nav === 'singleAi' || nav === 'internalGroup' || nav === 'externalGroup' || nav === 'externalChat') {
      const items = listItemsFor(nav);
      const cur = state.selectedChat;
      const stillHere = !!cur && matchNav(cur, nav) && items.some((c) => c.id === cur.id);
      if (!stillHere && items.length) {
        openChat(items[0].kind, items[0].id, items[0].name);
        return;
      }
    }

    if (!state.selectedChat || !matchNav(state.selectedChat, nav)) {
      state.selectedChat = null;
      $('liaoTianBuJu').classList.add('yinCang');
      $('kongTai').classList.remove('yinCang');
    } else {
      $('kongTai').classList.add('yinCang');
      $('liaoTianBuJu').classList.remove('yinCang');
      renderChat();
      renderQueueBar();
    }
  }

  /** 我的牛马候选列表：优先真实会话，没有会话时用实例兜底 */
  /** 列表排序：按时间（默认，最近有消息在上）或按名称 */
  function sortList(list) {
    const arr = list.slice();
    if (state.listSort === 'ming') {
      arr.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'zh'));
    } else {
      arr.sort((x, y) => tsOfItem(y) - tsOfItem(x));
    }
    return arr;
  }

  /** 条目最近消息时间：优先自身 lastTs，否则查会话表 */
  function tsOfItem(it) {
    if (it.lastTs) return it.lastTs;
    const c = state.chats.find((x) => x.id === it.id);
    return c ? (c.lastTs || 0) : 0;
  }

  function setListSort(mode) {
    state.listSort = mode;
    renderList();
    window.__saveState?.();
  }

  function singleChatItems() {
    const chats = state.chats.filter((c) => c.kind === 'single');
    if (chats.length) return chats.slice().sort((x, y) => (y.lastTs || 0) - (x.lastTs || 0));
    return state.instances.map((i) => ({ id: i.id, ming: i.name, kind: 'single', lastTs: 0 }));
  }

  /** 某个列表页的候选会话列表（用于自动打开第一个） */
  function listItemsFor(nav) {
    if (nav === 'singleAi') return singleChatItems();
    if (nav === 'externalChat') {
      return sortList(state.chats.filter((c) => c.kind === 'extdm'))
        .map((c) => ({ id: c.id, ming: c.name, kind: 'extdm' }));
    }
    const type = nav === 'internalGroup' ? 'internal' : 'external';
    return sortList(state.groups.filter((g) => g.type === type))
      .map((g) => ({ id: g.id, ming: g.name, kind: g.type === 'internal' ? 'internal' : 'extgroup' }));
  }

  function matchNav(sel, nav) {
    if (!sel) return false;
    if (nav === 'singleAi') return sel.kind === 'single';
    if (nav === 'internalGroup') return sel.kind === 'internal';
    if (nav === 'externalChat') return sel.kind === 'extdm';
    if (nav === 'externalGroup') return sel.kind === 'extgroup';
    return false;
  }

  function setupListAction() {
    const btn = $('lieBiaoDongZuo');
    const joinBtn = $('anNiuJiaRuqr');
    // 项目/群聊/联系人：显示扫码加入
    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('yinCang', !showJoin);
      if (state.nav === 'internalGroup') joinBtn.textContent = t('nav.addProject');
      else if (state.nav === 'externalGroup') joinBtn.textContent = t('nav.addGroup');
      else if (state.nav === 'externalChat') joinBtn.textContent = t('contact.add');
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.title = t(createKey);
      btn.classList.remove('yinCang');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      btn.textContent = t('contact.add');
      btn.title = t('contact.add');
      btn.classList.remove('yinCang');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');
      btn.title = t('list.addInstance');
      btn.classList.remove('yinCang');
      btn.onclick = addInstanceFlow;
    } else {
      btn.classList.add('yinCang');
      btn.onclick = null;
    }
  }

  function hang(ming, fu, ch, onClick, jiHuo, avatarSrc) {
    const el = document.createElement('div');
    el.className = 'lieBiaoTiaoMu' + (jiHuo ? ' jiHuo' : '');
    if (avatarSrc) el.dataset.av = '1';
    el.innerHTML = `${avatarSrc ? `<img class="avTuPian" src="${escapeHtml(avatarSrc)}" alt=""/>` : `<div class="av">${escapeHtml(ch || '?')}</div>`}<div class="meta"><div class="ming">${escapeHtml(ming)}</div><div class="fu">${escapeHtml(fu)}</div></div>`;
    el.title = `${ming}\n${fu}`;
    el.onclick = onClick;
    return el;
  }

  function renderList() {
    const q = ($('lieBiaoSouSuo').value || '').trim().toLowerCase();
    const box = $('lieBiaoTi');
    box.innerHTML = '';

    if (state.nav === 'instances') {
      const hw = state.hardware || { cpus: '—', suggested: '—', max: '—' };
      const ka = document.createElement('div');
      ka.className = 'lieBiaoKa';
      ka.innerHTML = `<h4>${t('instances.hardware')}</h4>
        <div class="jingYin">${t('instances.cpus')}: <b>${escapeHtml(String(hw.cpus ?? '—'))}</b></div>
        <div class="jingYin">${t('instances.suggested')}: <b>${escapeHtml(String(hw.suggested ?? '—'))}</b></div>
        <div class="jingYin">${t('instances.max')}: <b>${escapeHtml(String(hw.max ?? '—'))}</b></div>`;
      box.appendChild(ka);
      state.instances
        .filter((i) => !q || (i.name || '').toLowerCase().includes(q))
        .forEach((inst) => {
          const rowEl = hang(
            inst.name || inst.id,
            inst.status === 'running' ? t('instances.running') : t('instances.stopped'),
            (inst.name || 'A')[0],
            () => {
              state.selectedInstance = inst;
              hideMain();
              $('shiLiXiangQing').classList.remove('yinCang');
              renderInstanceDetail();
              renderList();
            },
            state.selectedInstance?.id === inst.id,
            instanceAvatarSrc(inst)
          );
          // 双击实例：跳到「我的牛马」并打开该实例的聊天
          rowEl.ondblclick = () => {
            setNav('singleAi');
            openChat('single', inst.id, inst.name);
          };
          box.appendChild(rowEl);
        });
      return;
    }

    if (state.nav === 'singleAi') {
      const items = sortList(state.chats
        .filter((c) => c.kind === 'single')
        .filter((c) => !q || c.name.toLowerCase().includes(q)));
      const source = items.length
        ? items
        : state.instances.map((i) => ({ id: i.id, ming: i.name, kind: 'single', lastPreview: t('list.noReply') }));
      if (!source.length) {
        // 一个实例都没有 → 显示「进入牛马管理局」按钮
        box.innerHTML = `<div class="enterHqBaoGuo">
          <div class="jingYin">${t('list.empty')}</div>
          <button class="enterHqAnNiu" id="anNiuEnterHq">
            <svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>
            <span>${t('nav.instances')}</span>
          </button>
        </div>`;
        $('anNiuEnterHq')?.addEventListener('click', () => setNav('instances'));
        return;
      }
      source.forEach((c) => {
        const inst = state.instances.find((x) => x.id === c.id);
        const rowEl = hang(
          c.name,
          c.lastPreview || t('list.noReply'),
          c.name[0],
          () => openChat('single', c.id, c.name),
          state.selectedChat?.id === c.id,
          inst ? instanceAvatarSrc(inst) : null
        );
        const menuInst = inst || { id: c.id, ming: c.name, status: 'stopped', notify: true };
        bindRowContext(rowEl, () => agentMenu(menuInst, rowEl));
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const items = sortList(state.groups.filter((g) => g.type === type).filter((g) => !q || g.name.toLowerCase().includes(q)));
      if (!items.length) {
        box.innerHTML = `<div class="lieBiaoKong">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((g) => {
        const rowEl = hang(
          g.name,
          `${t('group.type.' + g.type)} · ${g.members?.length || 0}`,
          g.ming[0],
          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),
          state.selectedChat?.id === g.id
        );
        bindRowContext(rowEl, () => groupMenu(g, rowEl));
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'externalChat') {
      const items = sortList(state.chats.filter((c) => c.kind === 'extdm').filter((c) => !q || c.name.toLowerCase().includes(q)));
      if (!items.length) {
        box.innerHTML = `<div class="lieBiaoKong">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((c) => {
        box.appendChild(
          hang(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, c.name), state.selectedChat?.id === c.id)
        );
      });
    }
  }

  function openChat(kind, id, ming) {
    state.selectedChat = { kind, id, ming };
    hideMain();
    $('liaoTianBuJu').classList.remove('yinCang');
    $('liaoTianBiaoTi').textContent = ming;
    $('liaoTianYuanShuju').textContent =
      kind === 'internal' ? t('group.type.internal') : kind.includes('ext') ? t('group.type.external') : t('nav.singleAi');
        window.__refreshSecurity?.();
    state.attachments = [];
    renderAttach();
    renderChat();
    renderQueueBar();
    renderList();
    updatePanelVisibility();
    renderModelMgr();
  }

  function renderChat() {
    const box = $('xiaoXiJi');
    box.innerHTML = '';
    const xiaoXi = (state.selectedChat && window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    xiaoXi.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'xiaoXi' + (m.role === 'wo' ? ' wo' : '');
      const av = state.profile.avatarDataUrl
        ? `<img class="touXiangTuPian" src="${state.profile.avatarDataUrl}" alt=""/>`
        : `<div class="av">${escapeHtml((state.profile.username || t('nav.touXiang')).slice(0, 1))}</div>`;
      div.innerHTML = `${m.role === 'wo' ? av : `<div class="av">${escapeHtml((state.selectedChat?.name || 'A')[0])}</div>`}<div class="bubble">${escapeHtml(m.text)}</div>`;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
    $('dutyXinXi').textContent = state.selectedChat ? state.selectedChat.name : '—';
  }

  function pushMsg(chatId, role, text) {
    window.__msgs = window.__msgs || {};
    window.__msgs[chatId] = window.__msgs[chatId] || [];
    window.__msgs[chatId].push({ role, text });
  }

  function queueOf(chatId) {
    if (!state.queues[chatId]) state.queues[chatId] = [];
    return state.queues[chatId];
  }

  function renderQueueBar() {
    const tiao = $('duiLieTiao');
    const list = $('duiLieTiaoMuJi');
    if (!state.selectedChat) {
      tiao.classList.add('yinCang');
      return;
    }
    const q = queueOf(state.selectedChat.id);
    if (!q.length) {
      tiao.classList.add('yinCang');
      list.innerHTML = '';
      return;
    }
    tiao.classList.remove('yinCang');
    $('duiLieCount').textContent = String(q.length);
    list.innerHTML = '';
    q.forEach((item, idx) => {
      const li = document.createElement('li');
      const tag = item.u === 'P2' ? t('chat.p2') : t('chat.p3');
      li.innerHTML = `<span class="qBiaoQian">${escapeHtml(tag)}</span>`;
      if (item.editing) {
        const ta = document.createElement('textarea');
        ta.value = item.text;
        const save = document.createElement('button');
        save.className = 'anNiuXiao';
        save.textContent = t('chat.queueSave');
        const del = document.createElement('button');
        del.className = 'anNiuXiao';
        del.textContent = t('chat.queueDelete');
        save.onclick = () => {
          item.text = ta.value.trim() || item.text;
          item.editing = false;
          renderQueueBar();
        };
        del.onclick = () => {
          q.splice(idx, 1);
          renderQueueBar();
        };
        li.append(ta, save, del);
      } else {
        const span = document.createElement('div');
        span.className = 'qWenBen';
        span.textContent = item.text;
        const edit = document.createElement('button');
        edit.className = 'anNiuXiao';
        edit.textContent = t('chat.queueEdit');
        const del = document.createElement('button');
        del.className = 'anNiuXiao';
        del.textContent = t('chat.queueDelete');
        edit.onclick = () => {
          item.editing = true;
          renderQueueBar();
        };
        del.onclick = () => {
          q.splice(idx, 1);
          renderQueueBar();
        };
        li.append(span, edit, del);
      }
      list.appendChild(li);
    });
  }

  function renderAttach() {
    const el = $('attachLieBiao');
    if (!state.attachments.length) {
      el.classList.add('yinCang');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('yinCang');
    el.innerHTML = state.attachments
      .map(
        (a, i) =>
          `<span class="attachChip">${escapeHtml(a.name)} <button data-i="${i}" title="${escapeHtml(t('chat.queueDelete'))}">×</button></span>`
      )
      .join(' ');
    el.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.attachments.splice(Number(b.dataset.i), 1);
        renderAttach();
      };
    });
  }

  function stopAllAi() {
    state.instances.forEach((inst) => {
      if (inst.status === 'running') {
        try {
          window.warmy.stopInstance(inst.id);
        } catch {
          /* noop */
        }
        inst.status = 'stopped';
      }
    });
    if (state.selectedChat) {
      queueOf(state.selectedChat.id).forEach((item) => {
        item.editing = false;
      });
      pushMsg(state.selectedChat.id, 'them', t('chat.stopAll'));
    }
    renderList();
    if (state.nav === 'instances' && state.selectedInstance) renderInstanceDetail();
    renderChat();
  }

  async function faSong() {
    const text = $('shuRu').value.trim();
    if (!text || !state.selectedChat) return;
    const id = state.selectedChat.id;
    const u = state.urgency;
    const attachNote = state.attachments.length
      ? `\n[${state.attachments.map((a) => a.name).join(', ')}]`
      : '';
    const full = text + attachNote;

    if (u === 'P2' || u === 'P3') {
      queueOf(id).push({ id: 'q' + Date.now(), text: full, u, editing: false });
      $('shuRu').value = '';
      state.attachments = [];
      renderAttach();
      renderQueueBar();
      return;
    }

    pushMsg(id, 'wo', full);
    $('shuRu').value = '';
    state.attachments = [];
    renderAttach();
    renderChat();

    // 内部群：值班编排闭环
    if (state.selectedChat.kind === 'internal') {
      try {
        const r = await window.warmy.groupOrchestrate({
          groupId: id,
          content: text,
          urgency: u,
        });
        const reply = r?.reply || `[${u}] ${r?.action || 'ok'}`;
        pushMsg(id, 'them', reply);
        if (r?.boardEvent) {
          state.board = state.board || { sessions: [], events: [], recent: [] };
          state.board.events = state.board.events || [];
          state.board.events.unshift({ id: 'e' + Date.now(), ts: Date.now(), action: r.boardEvent.split(':')[0], title: r.boardEvent, session: id });
        }
      } catch (e) {
        pushMsg(id, 'them', String(e.message || e));
      }
      window.warmy.checkpointAuto?.('round_end');
      renderChat();
      flushQueue(id);
      playNotifySound('complete');
      refreshMetrics();
      refreshCheckpoints();
      if (CHAT_NAVS.has(state.nav)) renderList();
      return;
    }

    // 单 AI / 外部：真 Provider 对话
    try {
      const r = await window.warmy.chatSend({
        sessionId: id,
        content: text,
        insertMode: state.urgency === 'P1' ? 'inner' : 'outer',
      });
      if (r?.needsKey) {
        pushMsg(id, 'them', r.reply);
      } else if (r?.ok) {
        pushMsg(id, 'them', r.reply);
        const c = state.chats.find((x) => x.id === id);
        if (c) {
          c.lastTs = Date.now();
          c.lastPreview = (r.reply || text).slice(0, 30);
        }
      } else {
        pushMsg(id, 'them', r?.error || t('common.error'));
      }
    } catch (e) {
      pushMsg(id, 'them', String(e.message || e));
    }
    window.warmy.checkpointAuto?.('round_end');
    renderChat();
    flushQueue(id);
    playNotifySound('complete');
    refreshMetrics();
    refreshCheckpoints();
    if (CHAT_NAVS.has(state.nav)) renderList();
  }

  function flushQueue(chatId) {
    const q = queueOf(chatId);
    while (q.length) {
      const item = q.shift();
      pushMsg(chatId, 'wo', item.text);
      pushMsg(chatId, 'them', `[${item.u === 'P2' ? t('chat.p2') : t('chat.p3')}] ${item.text.slice(0, 30)}…`);
    }
    renderQueueBar();
    renderChat();
  }

  async function renderDashboard(host) {
    let sessions = state.board.sessions;
    let events = state.board.events;
    try {
      const agg = await window.warmy.boardAggregate();
      const ev = await window.warmy.boardEvents();
      if (agg?.ok && agg.sessions?.length) {
        sessions = agg.sessions.map((s) => ({
          id: s.groupId,
          kind: 'internal',
          ming: s.groupId,
          jinDu: s.avgProgress,
          status: 'doing',
          blocked: false,
          taskCount: s.taskCount,
          done: s.done,
        }));
      }
      if (ev?.ok && ev.events?.length) {
        events = ev.events.map((e) => ({
          id: String(e.seq),
          ts: e.ts,
          action: e.action,
          title: e.biaoTi + (typeof e.jinDu === 'number' ? ` → ${e.jinDu}%` : ''),
          session: e.groupId,
        }));
      }
    } catch {
      /* fallback demo */
    }

    const running = state.instances.filter((i) => i.status === 'running').length;
    const queued = Object.values(state.queues).reduce((n, q) => n + q.length, 0);
    const doing = sessions.filter((x) => x.status !== 'done').length;
    const done = events.filter((e) => e.action === 'complete_task').length;
    const typeLabel = (k) =>
      k === 'internal' ? t('group.type.internal') : k === 'extgroup' ? t('group.type.external') : t('nav.singleAi');
    const evLabel = (a) =>
      ({
        create_task: t('board.create_task'),
        update_progress: t('board.update_progress'),
        complete_task: t('board.complete_task'),
        add_note: t('board.add_note'),
        block: t('board.block'),
      })[a] || a;

    host.innerHTML = `
      <h1>${t('dashboard.biaoTi')}</h1>
      <p class="kanbanTiShi">${t('dashboard.readOnlyHint')}</p>
      <div class="dashGrid">
        <div class="dashKa"><div class="jingYin">${t('dashboard.tasks')}</div><div class="stat">${escapeHtml(String(doing ?? 0))}</div></div>
        <div class="dashKa"><div class="jingYin">${t('dashboard.done')}</div><div class="stat">${escapeHtml(String(done ?? 0))}</div></div>
        <div class="dashKa"><div class="jingYin">${t('dashboard.agents')}</div><div class="stat">${escapeHtml(String(running ?? 0))}</div></div>
        <div class="dashKa"><div class="jingYin">${t('dashboard.queue')}</div><div class="stat">${escapeHtml(String(queued ?? 0))}</div></div>
      </div>
      <div class="sheZhiKa" style="margin-bottom:16px">
        <h2 style="margin:0 0 10px;font-size:14px">${t('dashboard.sessions')}</h2>
        <div id="kanbanHuiHuaJi"></div>
      </div>
      <div class="sheZhiKa">
        <h2 style="margin:0 0 10px;font-size:14px">${t('panel.board')} · ${t('dashboard.recent')}</h2>
        <div id="kanbanShiJianJi"></div>
      </div>`;

    const sess = $('kanbanHuiHuaJi');
    sessions.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'kanbanHuiHua';
      el.title = t('dashboard.jump');
      el.innerHTML = `
        <div class="bsMing">${escapeHtml(t(s.name))}</div>
        <span class="bsLeiXing">${escapeHtml(typeLabel(s.kind))}</span>
        <div class="bsProg">
          <div class="jinDu"><div class="jinDuTiao" style="width:${clampPercent(s.jinDu)}%"></div></div>
          <div class="jingYin" style="margin-top:2px">${t('dashboard.progressLabel')} ${clampPercent(s.jinDu)}%${s.blocked ? ' · ' + t('dashboard.blocked') : ''}</div>
        </div>
        <span class="bsZhuangTai">${t('dashboard.jump')} →</span>`;
      el.onclick = () => {
        const kind = s.kind === 'single' ? 'single' : s.kind === 'internal' ? 'internal' : 'extgroup';
        const nav = kind === 'single' ? 'singleAi' : kind === 'internal' ? 'internalGroup' : 'externalGroup';
        if (kind !== 'single' && !state.groups.find((g) => g.id === s.id)) {
          state.groups.push({ id: s.id, ming: t(s.name), type: kind, members: [] });
        }
        setNav(nav);
        openChat(kind, s.id, t(s.name));
      };
      sess.appendChild(el);
    });

    const evBox = $('kanbanShiJianJi');
    [...events]
      .sort((a, b) => b.ts - a.ts)
      .forEach((e) => {
        const d = document.createElement('div');
        d.className = 'kanbanShiJian';
        d.innerHTML = `<span class="evBiaoQian">${escapeHtml(evLabel(e.action))}</span>
          <div><div>${escapeHtml(t(e.biaoTi))}</div>
          <div class="jingYin">${escapeHtml(t(e.session))} · ${new Date(e.ts).toLocaleString()}</div></div>`;
        evBox.appendChild(d);
      });
  }

  function renderInstanceDetail() {
    const inst = state.selectedInstance;
    if (!inst) return;
    const box = $('shiLiXiangQing');
    box.innerHTML = `
      <h1>${escapeHtml(inst.name || inst.id)}</h1>
      <div class="sheZhiKa" style="max-width:720px">
        <div class="profileHead" style="align-items:center;gap:14px">
          <button id="iAvAnNiu" class="avAnNiu" title="${escapeHtml(t('touXiang.pickTitle'))}">
            <img class="touXiangTuPian big" src="${instanceAvatarSrc(inst)}" alt=""/>
          </button>
          <div style="flex:1">
            <div class="field"><label>${t('instances.name')}</label><input id="iMing" value="${escapeHtml(inst.name || '')}"/></div>
          </div>
        </div>

        <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.cognition')}</h3>
        <div class="jingYin" style="margin-bottom:8px">${t('instances.cognitionHint')}</div>
        <div id="iCogLieBiao"></div>
        <div style="margin-top:8px">
          <button class="anNiuXiao" id="iCogTianJia">${t('instances.cognitionAdd')}</button>
        </div>
        <div class="field" style="margin-top:12px">
          <label>${t('instances.persona')}</label>
          <textarea id="iPersona" placeholder="${escapeHtml(t('instances.personaPlaceholder'))}">${escapeHtml(inst.persona || '')}</textarea>
        </div>
        <div class="sheZhiKa yinCang" style="margin-top:14px" id="iModelcfg">
          <h3 style="margin:0 0 10px;font-size:13px">${t('instances.defaultModel')}</h3>
          <div class="shiLiHang">
            <div class="field">
              <label>${t('instances.defaultModel')}</label>
              <select id="iDefaultMoXing">
                <option value="__smart__">${t('instances.smartPick')}</option>
                ${(inst.availableModels || []).map((m) => '<option value="' + escapeHtml(m) + '"' + (inst.defaultModel === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('')}
              </select>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.availableModels')}</h3>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="iAllMoXingJi" ${inst.allModels !== false ? 'checked' : ''}/> ${t('instances.allAvailable')}
          </label>

          <div id="iManual" class="${inst.allModels !== false ? 'yinCang' : ''}">
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="iProvXuanZe" size="6">${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian) + '</option>').join('')}</select>
              <select id="iMoXingXuanZe" size="6"></select>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
              <button class="anNiuXiao" id="iTianJiaMoXing">${t('instances.addModel')}</button>
              <button class="anNiuXiao" id="iDelMoXing">${t('settings.removeModel')}</button>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.fallbackChain')}</h3>
          <div id="iChain"></div>
        </div>
        <div class="shiLiHang" style="margin-top:14px">
          <button class="anNiuZhuYao" id="iBaoCun" title="${escapeHtml(t('common.save'))}">${t('common.save')}</button>
          <button class="anNiuXiao" id="iQiDong" title="${escapeHtml(t('instances.start'))}">${t('instances.start')}</button>
          <button class="anNiuXiao" id="iTingZhi" title="${escapeHtml(t('instances.stop'))}">${t('instances.stop')}</button>
          <button class="anNiuDanger" id="iDel" title="${escapeHtml(t('instances.delete'))}">${t('instances.delete')}</button>
          <span class="huiZhang ${inst.status === 'running' ? '' : 'off'}">${inst.status === 'running' ? t('instances.running') : t('instances.stopped')}</span>
        </div>
      </div>`;
    $('iBaoCun').onclick = () => {
      inst.name = $('iMing').value.trim() || inst.name;
      inst.model = $('i-model').value.trim();
      inst.memoryFile = $('i-mem').value.trim();
      inst.persona = $('iPersona').value;
      renderList();
    };
    $('iQiDong').onclick = async () => {
      try {
        const dsh = await window.warmy.dshAvailable().catch(() => ({ ok: false }));
        let r;
        if (dsh?.ok) {
          r = await window.warmy.spawnDshInstance({ id: inst.id, ming: inst.name });
        } else {
          r = await window.warmy.spawnInstance({ id: inst.id, ming: inst.name, dutyEligible: true });
        }
        if (r?.ok === false && r?.error) {
          uiAlert(String(r.error));
          return;
        }
        inst.status = 'running';
        renderInstanceDetail();
        renderList();
      } catch (e) {
        uiAlert(String(e.message || e));
      }
    };
    $('iTingZhi').onclick = async () => {
      try {
        await window.warmy.stopInstance(inst.id);
      } catch {
        /* noop */
      }
      inst.status = 'stopped';
      renderInstanceDetail();
      renderList();
    };
    // ── 模型配置：默认模型 / 全部可用 / 手动添加 / 调用链 ──
    // ── 牛马头像 + 认知注入 ──
    (function bindInstanceAvatarCognition() {
      if (!inst.cognitionFiles) inst.cognitionFiles = [];
      const list = $('iCogLieBiao');
      function renderCog() {
        if (!list) return;
        list.innerHTML =
          inst.cognitionFiles
            .map(
              (f, i) =>
                '<div class="shiLiHang" style="margin:4px 0"><span style="flex:1">' +
                escapeHtml(f.name) +
                '</span><span class="jingYin">' + escapeHtml(String(f.size || 0)) + ' B</span>' +
                '<button class="anNiuXiao" data-cog-del="' + i + '">' + t('mesh.remove') + '</button></div>'
            )
            .join('') || '<div class="jingYin">' + t('instances.cognitionEmpty') + '</div>';
        list.querySelectorAll('[data-cog-del]').forEach((b) => {
          b.onclick = () => {
            inst.cognitionFiles.splice(Number(b.dataset.cogDel), 1);
            renderCog();
          };
        });
      }
      renderCog();

      $('iAvAnNiu')?.addEventListener('click', async () => {
        const r = await pickAvatar(PRESET_AVATARS, inst.avatarPreset, (i) => t('touXiang.preset.' + (i + 1)));
        if (!r) return;
        if (r.type === 'local') {
          pendingAvatarTarget = { kind: 'instance', inst };
          $('touXiangWenJian').click();
          return;
        }
        inst.avatarPreset = r.preset;
        inst.avatarDataUrl = '';
        renderInstanceDetail();
        window.__saveState?.();
      });

      $('iCogTianJia')?.addEventListener('click', async () => {
        const r = await window.warmy.pickFile({ filters: ['md'] });
        if (!r?.ok) return;
        const ming = r.path.split(/[\\/]/).pop();
        inst.cognitionFiles.push({ ming, path: r.path, size: 0 });
        renderCog();
      });
    })();

    (function bindModelConfig() {
      if (!$('iModelcfg') || $('iModelcfg').classList.contains('yinCang')) return;
      const inst2 = inst;
      if (!inst2.availableModels) inst2.availableModels = [];
      if (inst2.allModels === undefined) inst2.allModels = true;
      if (!inst2.chain) inst2.chain = [...inst2.availableModels];

      const defSel = $('iDefaultMoXing');
      const allChk = $('iAllMoXingJi');
      const allList = $('i-all-list');
      const manual = $('iManual');
      const provPick = $('iProvXuanZe');
      const modelPick = $('iMoXingXuanZe');
      const chainBox = $('iChain');

      function renderChain() {
        if (!chainBox) return;
        const list = inst2.chain || [];
        chainBox.innerHTML =
          list
            .map(
              (m, i) =>
                '<div class="shiLiHang" style="margin:4px 0">' +
                '<span style="flex:1">' + escapeHtml(m) + '</span>' +
                '<button class="anNiuXiao" data-up="' + i + '">' + t('instances.moveUp') + '</button>' +
                '<button class="anNiuXiao" data-down="' + i + '">' + t('instances.moveDown') + '</button>' +
                '</div>'
            )
            .join('') || '<div class="jingYin">' + t('settings.modelsEmpty') + '</div>';
        chainBox.querySelectorAll('[data-up]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.up);
            if (i <= 0) return;
            const arr = inst2.chain;
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
            renderChain();
          };
        });
        chainBox.querySelectorAll('[data-down]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.down);
            const arr = inst2.chain;
            if (i >= arr.length - 1) return;
            [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
            renderChain();
          };
        });
      }
      renderChain();

      // 全部可用：勾选时不显示模型列表；取消时进入手动添加
      if (allChk) {
        allChk.onchange = () => {
          inst2.allModels = allChk.checked;
          manual?.classList.toggle('yinCang', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
            inst2.availableModels = all;
            inst2.chain = [...all];
            renderChain();
          }
          updateAddDelState();
        };
      }

      // 两列选择器：左供应商 → 右模型
      function fillModels() {
        if (!provPick || !modelPick) return;
        const p = state.providers.find((x) => x.id === provPick.value) || state.providers[0];
        modelPick.innerHTML = (p?.models || [])
          .map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>')
          .join('');
        updateAddDelState();
      }

      function selectedFull() {
        const p = state.providers.find((x) => x.id === provPick?.value);
        const m = modelPick?.value;
        if (!p || !m) return '';
        return p.biaoQian + ' · ' + m;
      }

      function updateAddDelState() {
        const full = selectedFull();
        const inChain = full && (inst2.chain || []).includes(full);
        const addBtn = $('iTianJiaMoXing');
        const delBtn = $('iDelMoXing');
        if (addBtn) {
          addBtn.disabled = !full || inChain;
          addBtn.style.opacity = addBtn.disabled ? 0.45 : 1;
        }
        if (delBtn) {
          delBtn.disabled = !full || !inChain;
          delBtn.style.opacity = delBtn.disabled ? 0.45 : 1;
        }
      }

      if (provPick) {
        provPick.onchange = fillModels;
        fillModels();
      }
      modelPick?.addEventListener('change', updateAddDelState);

      $('iTianJiaMoXing')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.availableModels = [...new Set([...(inst2.availableModels || []), full])];
        inst2.chain = [...new Set([...(inst2.chain || []), full])];
        const sel = $('iDefaultMoXing');
        if (sel && ![...sel.options].some((o) => o.value === full)) {
          const opt = document.createElement('option');
          opt.value = full;
          opt.textContent = full;
          sel.appendChild(opt);
        }
        renderChain();
        updateAddDelState();
      });

      $('iDelMoXing')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.chain = (inst2.chain || []).filter((x) => x !== full);
        inst2.availableModels = (inst2.availableModels || []).filter((x) => x !== full);
        renderChain();
        updateAddDelState();
      });

      if (defSel) {
        defSel.onchange = () => {
          inst2.defaultModel = defSel.value === '__smart__' ? '' : defSel.value;
        };
      }
    })();

    function renderPageCurrentInstanceOptions() {
      const sel = $('iDefaultMoXing');
      if (!sel) return;
      const cur = inst2DefaultModel();
      sel.innerHTML =
        '<option value="__smart__">' + t('instances.smartPick') + '</option>' +
        (inst.availableModels || [])
          .map((m) => '<option value="' + escapeHtml(m) + '"' + (cur === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>')
          .join('');
      function inst2DefaultModel() {
        return inst.defaultModel || '';
      }
    }

    $('iDel').onclick = async () => {
      if (!uiConfirm(t('instances.delete') + '?')) return;
      try {
        await window.warmy.stopInstance(inst.id);
      } catch {
        /* noop */
      }
      state.instances = state.instances.filter((x) => x.id !== inst.id);
      state.selectedInstance = null;
      hideMain();
      $('kongTai').classList.remove('yinCang');
      renderList();
    };
  }

  function renderPage() {
    const box = $('pageTi');
    if (state.nav === 'wo') {
      const p = state.profile;
      const avHtml = `<img class="touXiangTuPian big" src="${personAvatarSrc(p)}" alt=""/>`;
      box.innerHTML = `
        <div class="pinPaiStrip">
          <img class="pinPailogo" src="./icons/logo-tight.png" alt="${escapeHtml(t('brand.name'))}"/>
          <div class="pinPaiWenBen">
            <div class="pinPaiMing">${escapeHtml(t('brand.name'))}</div>
            <div class="pinPaiFu">${escapeHtml(t('brand.fu'))}</div>
          </div>
        </div>
        <div class="woStrip">
          <div class="profileHead">
            <button id="pAvAnNiu" class="avAnNiu" aria-label="${escapeHtml(t('wo.touXiang'))}">${avHtml}</button>
            <div>
              <span id="pMingDisplay" class="usernameDisplay" title="${escapeHtml(t('wo.username'))}">${escapeHtml(p.username || t('nav.touXiang'))}</span>
              <input id="pMing" class="usernameShuRu yinCang" value="${escapeHtml(p.username)}"/>
              <div class="jingYin">${p.loggedIn ? escapeHtml(p.email || '') : t('wo.notLoggedIn')}</div>
              <div class="jingYin woTiShi">${t('wo.userId')}: ${escapeHtml(p.deviceId || '—')}</div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="anNiuXiao" id="pLogin">${t('wo.login')}</button>
                <button class="anNiuXiao" id="pReg">${t('wo.register')}</button>
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom:10px"><label>${t('wo.email')}</label><input id="pYouJian" type="email" value="${escapeHtml(p.email)}"/></div>
          <div class="field" style="margin-bottom:14px"><label>${t('wo.changePassword')}</label>
            <input id="pPw" type="password" placeholder="${escapeHtml(t('wo.newPassword'))}"/>
            <input id="pPw2" type="password" placeholder="${escapeHtml(t('wo.confirmPassword'))}" style="margin-top:6px"/>
          </div>
          <button class="anNiuZhuYao" id="pBaoCun">${t('wo.saveProfile')}</button>
        </div>
        <div id="dashHost"></div>`;
      $('pLogin').onclick = () => uiAlert(t('wo.notAvailable'));
      $('pReg').onclick = () => uiAlert(t('wo.notAvailable'));
      // click ming -> edit
      const nameDisp = $('pMingDisplay');
      const nameInp = $('pMing');
      nameDisp.onclick = () => {
        nameDisp.classList.add('yinCang');
        nameInp.classList.remove('yinCang');
        nameInp.focus();
        nameInp.select();
      };
      const commitName = () => {
        const v = nameInp.value.trim();
        if (v) {
          state.profile.username = v;
          nameDisp.textContent = v;
        }
        nameInp.classList.add('yinCang');
        nameDisp.classList.remove('yinCang');
      };
      nameInp.onblur = commitName;
      nameInp.onkeydown = (e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { nameInp.value = state.profile.username; commitName(); } };
      $('pAvAnNiu').onclick = async () => {
        const r = await pickAvatar(PERSON_AVATARS, state.profile.avatarPreset, (i) => t('touXiang.person.' + (i + 1)));
        if (!r) return;
        if (r.type === 'local') {
          pendingAvatarTarget = { kind: 'profile' };
          $('touXiangWenJian').click();
          return;
        }
        state.profile.avatarPreset = r.preset;
        state.profile.avatarDataUrl = '';
        applyAvatar();
        saveProfile();
        renderPage();
      };
      $('pBaoCun').onclick = () => {
        const v = $('pMing').value.trim();
        if (v) state.profile.username = v;
        state.profile.email = $('pYouJian').value.trim();
        applyAvatar();
        saveProfile();
        uiAlert(t('instances.saved'));
      };
      renderDashboard($('dashHost'));
      return;
    }

    if (state.nav === 'settings') {
      box.innerHTML = `
        <div class="peiZhiBuJu">
        <div class="peiZhiDaoHang" id="peiZhiDaoHang">
          <button data-sec="ui" class="qiYong">${t('settings.section.ui')}</button>
          <button data-sec="notify">${t('settings.section.notify')}</button>
          <button data-sec="model">${t('settings.section.model')}</button>
          <button data-sec="func">${t('settings.section.func')}</button>
          <button data-sec="about">${t('settings.section.about')}</button>
        </div>
        <div class="peiZhiNeiRong" id="peiZhiNeiRong">
        <div class="sheZhiSection" data-sec="ui"><h2 style="color:var(--accent)">${t('settings.section.ui')}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.language')}</h2>
          <select id="xuanZeYuYan" title="${escapeHtml(t('settings.language'))}">
            <option value="zh-CN" ${state.yuYan.startsWith('zh') ? 'selected' : ''}>${t('settings.localeZh')}</option>
            <option value="en-US" ${state.yuYan.startsWith('en') ? 'selected' : ''}>${t('settings.localeEn')}</option>
          </select>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.themeMode')}</h2>
          <div class="zhuTiMoShi">
            <button data-m="light" class="${state.themeMode === 'light' ? 'qiYong' : ''}">${t('settings.themeLight')}</button>
            <button data-m="dark" class="${state.themeMode === 'dark' ? 'qiYong' : ''}">${t('settings.themeDark')}</button>
            <button data-m="system" class="${state.themeMode === 'system' ? 'qiYong' : ''}">${t('settings.themeSystem')}</button>
          </div>
          <h2 style="margin-top:12px">${t('settings.theme')}</h2>
          <div class="zhuTiSwatches" id="zhuTiSwatches"></div>
          <div class="zhuTiCustomHang">
            <button class="anNiuXiao" id="anNiuZhuTiCustom">${t('settings.themeCustom')}</button>
            <span class="zhuTiCustomPreview" id="zhuTiCustomPreview"></span>
            <span class="jingYin">${t('settings.themePreview')}</span>
          </div>
        </div>
        <div class="sheZhiSection" data-sec="notify"><h2 style="color:var(--accent)">${t('settings.section.notify')}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.soundName')}</h2>
          <div class="soundHang">
            <label><input type="checkbox" id="sWanCheng" ${state.sound.complete ? 'checked' : ''}/> ${t('settings.soundComplete')}</label>
            <label><input type="checkbox" id="sQingQiu" ${state.sound.request ? 'checked' : ''}/> ${t('settings.soundRequest')}</label>
            <label><input type="checkbox" id="sCuoWu" ${state.sound.error ? 'checked' : ''}/> ${t('settings.soundError')}</label>
          </div>
          <div class="field" style="margin-top:10px"><label>${t('settings.soundCompleteFile')}</label>
            <div class="shiLiHang"><input id="sfWanCheng" value="${escapeHtml(state.soundFiles.complete)}" readonly/>
            <button class="anNiuXiao" data-pick="complete">${t('settings.soundPick')}</button>
            <button class="anNiuXiao" data-clear="complete">${t('settings.soundClear')}</button></div></div>
          <div class="field" style="margin-top:8px"><label>${t('settings.soundRequestFile')}</label>
            <div class="shiLiHang"><input id="sfQingQiu" value="${escapeHtml(state.soundFiles.request)}" readonly/>
            <button class="anNiuXiao" data-pick="request">${t('settings.soundPick')}</button>
            <button class="anNiuXiao" data-clear="request">${t('settings.soundClear')}</button></div></div>
          <div class="field" style="margin-top:8px"><label>${t('settings.soundErrorFile')}</label>
            <div class="shiLiHang"><input id="sfCuoWu" value="${escapeHtml(state.soundFiles.error)}" readonly/>
            <button class="anNiuXiao" data-pick="error">${t('settings.soundPick')}</button>
            <button class="anNiuXiao" data-clear="error">${t('settings.soundClear')}</button></div></div>
          <div style="margin-top:12px">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px">${t('settings.emailNotify')}</div>
            ${['complete', 'request', 'error']
            .map(
              (k) =>
                '<label style="margin-right:14px"><input type="checkbox" data-email-k="' + k + '" ' +
                (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</label>'
            )
            .join('')}
            <div class="jingYin">${t('settings.emailHint')}</div>
          </div>
        </div>
                <div class="sheZhiSection sheZhiKa">
          <h2>${t('smtp.biaoTi')} <span class="jingYin">(${t('smtp.count')} <span id="smtpN">0</span>/10 · ${t('smtp.max10')})</span></h2>
          <p class="jingYin">${t('smtp.tiShi')}</p>
          <div id="smtpAccounts"></div>
          <div class="shiLiHang" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
            <div class="field"><label>${t('smtp.biaoQian')}</label><input id="smtpBiaoQian" placeholder="${escapeHtml(t('placeholder.email'))}"/></div>
            <div class="field"><label>${t('smtp.host')}</label><input id="smtpHost" value="" placeholder="smtp.example.com"/></div>
            <div class="field"><label>${t('smtp.port')}</label><input id="smtpDuanKou" value="465"/></div>
          </div>
          <div class="shiLiHang" style="margin-top:8px">
            <label><input type="checkbox" id="smtpAnQuan" checked/> ${t('smtp.secure')}</label>
            <div class="field"><label>${t('smtp.user')}</label><input id="smtpUser"/></div>
            <div class="field"><label>${t('smtp.pass')}</label><input id="smtpPass" type="password"/></div>
            <button class="anNiuXiao" id="anNiusmtpTianJia">${t('smtp.add')}</button>
          </div>
          <span class="jingYin" id="smtpXiaoXi"></span>
        </div>
        <div class="sheZhiSection" data-sec="model"><h2 style="color:var(--accent)">${t('settings.section.model')}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.providers')}</h2>
          <div id="provLieBiao"></div>
          <button class="anNiuXiao" id="anNiuTianJiaProv">${t('settings.addProvider')}</button>
        </div>
        <div class="sheZhiSection" data-sec="func"><h2 style="color:var(--accent)">${t('settings.section.func')}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.security')}</h2>
          <div class="secHang">
            <select id="xuanZeSec" title="${escapeHtml(t('settings.securityHint'))}">
              <option value="normal">${t('settings.securityNormal')}</option>
              <option value="strict">${t('settings.securityStrict')}</option>
              <option value="full">${t('settings.securityFull')}</option>
            </select>
            <span class="secMiaoShu" id="secMiaoShu"></span>
          </div>
          <p class="jingYin" style="margin:8px 0 0">${t('settings.securityHint')}</p>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.chaJianJi')}</h2>
          <table class="chaJianJi">
            <thead><tr><th>${t('settings.pluginId')}</th><th>${t('settings.pluginDesc')}</th><th>${t('settings.pluginStatus')}</th><th>${t('settings.pluginActions')}</th></tr></thead>
            <tbody id="plugTi"></tbody>
          </table>
          <div style="margin-top:8px"><input id="plugLuJing" placeholder="package or path" style="width:55%"/>
            <button class="anNiuXiao" id="anNiuPlugAnZhuang">${t('settings.pluginInstall')}</button></div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('lan.biaoTi')}</h2>
          <div class="shiLiHang">
            <div class="field"><label>${t('lan.port')}</label><input id="neiWangDuanKou" value="7788"/></div>
            <button class="anNiuXiao" id="anNiuNeiWangQiDong">${t('lan.start')}</button>
            <button class="anNiuXiao" id="anNiuNeiWangTingZhi">${t('lan.stop')}</button>
          </div>
          <div class="shiLiHang" style="margin-top:8px">
            <div class="field"><label>${t('lan.peerHost')}</label><input id="neiWangHost" value="192.0.2.123" placeholder="192.0.2.123"/></div>
            <div class="field"><label>${t('lan.peerPort')}</label><input id="neiWangPport" value="7788"/></div>
            <button class="anNiuXiao" id="anNiuNeiWangFaSong">${t('lan.sendTest')}</button>
            <button class="anNiuXiao" id="anNiuNeiWangShuangJi">${t('lan.dualSmoke')}</button>
          </div>
          <div class="jingYin" id="neiWangXiaoXi" style="margin-top:8px"></div>
          <div class="jingYin" id="neiWangShouXiang" style="margin-top:8px;max-height:100px;overflow:auto"></div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('mesh.biaoTi')}</h2>
          <p class="jingYin">${t('mesh.tiShi')}</p>
          <div class="shiLiHang">
            <div class="field"><label>${t('lan.port')}</label><input id="wangZhuangDuanKou" value="7788"/></div>
            <button class="anNiuXiao" id="anNiuWangZhuangQiDong">${t('mesh.start')}</button>
            <button class="anNiuXiao" id="anNiuWangZhuangTingZhi">${t('mesh.stop')}</button>
            <button class="anNiuXiao" id="anNiuWangZhuangBcast">${t('mesh.broadcast')}</button>
          </div>
          <div class="shiLiHang" style="margin-top:8px">
            <div class="field"><label>${t('mesh.name')}</label><input id="duiDuanMing" placeholder="${escapeHtml(t('placeholder.nodeName'))}"/></div>
            <div class="field"><label>${t('lan.peerHost')}</label><input id="duiDuanHost" placeholder="${escapeHtml(t('placeholder.peerHost'))}"/></div>
            <div class="field"><label>${t('lan.peerPort')}</label><input id="duiDuanDuanKou" value="7788"/></div>
            <button class="anNiuXiao" id="anNiuDuiDuanTianJia">${t('mesh.addPeer')}</button>
          </div>
          <div id="duiDuanLieBiao" style="margin-top:10px"></div>
          <div class="jingYin" id="wangZhuangXiaoXi" style="margin-top:8px"></div>
          <div class="jingYin" id="wangZhuangShouXiang" style="margin-top:8px;max-height:100px;overflow:auto"></div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('ctx.archive')}</h2>
          <p class="jingYin">${t('archive.tiShi')}</p>
          <div id="yiGuiDangHe" class="jingYin">—</div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.specialModels')}</h2>
          <p class="jingYin">${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.asrModel')}</label>
            <select id="smasr">
              <option value="ollama">Ollama (whisper-tiny)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
              <option value="openai">OpenAI Whisper API</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.embeddingModel')}</label>
            <select id="smEmbed">
              <option value="onnx">ONNX (bge-small-zh)</option>
              <option value="ollama">Ollama embedding</option>
              <option value="api">API embedding</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.organizerModel')}</label>
            <input id="smOrganizer" placeholder="deepseek-chat"/>
          </div>
          <div style="margin-top:8px"><button class="anNiuXiao" id="anNiuwebgpu">${t('webgpu.test')}</button> <span class="jingYin" id="webgpuXiaoXi"></span></div>
          <button class="anNiuXiao" id="anNiuBaoCunTeShu">${t('common.save')}</button>
          <span class="jingYin" id="smXiaoXi"></span>
        </div>
        
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('join.blacklistTitle')}</h2>
          <div id="heiMingDanHe" class="jingYin">${t('join.blacklistEmpty')}</div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('diag.biaoTi')}</h2>
          <p class="jingYin" style="margin:0 0 8px">${t('diag.tiShi')}</p>
          <div id="diagShuChu" class="jingYin">—</div>
          <div style="margin-top:8px"><button class="anNiuXiao" id="anNiuDiagYunXing">${t('diag.run')}</button></div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.skills')}</h2>
          <p class="jingYin" style="margin:0 0 8px">${t('settings.skillsHint')}</p>
          <div style="margin-bottom:8px"><button class="anNiuXiao" id="anNiuJinengDaoRu">${t('settings.skillsImport')}</button></div>
          <div id="jinengLieBiao" class="jingYin">${t('settings.skillsEmpty')}</div>
          <div class="jingYin jinengLuJingJi" id="jinengLuJingJi"></div>
        </div>
        <div class="sheZhiSection" data-sec="about"><h2 style="color:var(--accent)">${t('settings.section.about')}</h2></div>
        <div class="sheZhiSection sheZhiKa aboutKa">
          <div class="aboutPinPai">
            <img class="aboutlogo" src="./icons/logo-tight.png" alt="${escapeHtml(t('about.logoAlt'))}"/>
            <div class="aboutPinPaiWenBen">
              <div class="aboutMing">${escapeHtml(t('brand.name'))}</div>
              <div class="aboutFu">${escapeHtml(t('brand.fu'))}</div>
              <div class="aboutVerXian">
                <span class="jingYin aboutVer" id="aboutVersion">—</span>
                <button class="anNiuXiao" id="anNiuAboutGengXin">${t('about.checkUpdate')}</button>
                <span class="jingYin" id="aboutUpd"></span>
              </div>
              <div class="about-feed-line" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
                <input id="gengXinFeed" placeholder="${escapeHtml(t('update.feedPlaceholder'))}" style="flex:1;min-width:220px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit"/>
                <button class="anNiuXiao" id="anNiuFeedBaoCun">${t('update.feedSave')}</button>
                <span class="jingYin" id="feedXiaoXi"></span>
              </div>
            </div>
          </div>
          <div class="aboutKuai">
            <h3>${t('about.versionInfo')}</h3>
            <div class="jingYin" id="aboutRuntime">—</div>
            <div class="jingYin" id="aboutDevice">—</div>
          </div>
          <div class="aboutKuai"><h3>${t('about.opensource')}</h3><p class="jingYin">${t('about.opensourceBody')}</p></div>
          <div class="aboutKuai"><h3>${t('about.techStack')}</h3><p class="jingYin">${t('about.techStackBody')}</p></div>
          <div class="aboutKuai"><h3>${t('about.copyright')}</h3><p class="jingYin">${t('about.copyrightBody')}</p></div>
          <div class="aboutKuai"><h3>${t('about.author')}</h3><p class="jingYin">${t('about.authorBody')}</p></div>
          <div class="aboutKuai"><h3>${t('about.contact')}</h3><p class="jingYin">${t('about.contactBody')}</p></div>
          <div class="aboutKuai"><h3>${t('about.legal')}</h3><p class="jingYin">${t('about.legalBody')}</p></div>
        </div></div></div>`;

      // 更新源：不填则永远只会是「未配置」，所以必须给界面入口
      (async () => {
        try {
          const cur = await window.warmy.updateSourceGet();
          const inp = $('gengXinFeed');
          if (inp && cur && cur.url) inp.value = cur.url;
          const xiaoXi = $('feedXiaoXi');
          if (xiaoXi && !(cur && cur.url)) xiaoXi.textContent = t('update.status.notConfigured');
        } catch (e) { /* 预览桩或旧版本可能没有该 API，静默跳过 */ }
      })();
      $('anNiuFeedBaoCun').onclick = async () => {
        const xiaoXi = $('feedXiaoXi');
        const url = (($('gengXinFeed') || {}).value || '').trim();
        const r = await window.warmy.updateSourceSet({ url }).catch(() => null);
        if (xiaoXi) xiaoXi.textContent = r && r.ok === false ? t('update.feedInvalid') : t('update.feedSaved');
      };
      $('anNiuAboutGengXin').onclick = async () => {
        const el = $('aboutUpd');
        if (el) el.textContent = t('about.checking');
        // 主进程会区分「未配置 / 网络失败 / HTTP 错误 / 格式非法 / 已最新 / 有更新」，
        // 不能只看 upToDate —— 那会把「未配置」误报成「发现新版本」。
        const r = await window.warmy.checkUpdate().catch(() => null);
        if (el) el.textContent = updateStatusText(r);
      };
      (async () => {
        try {
          const info = await window.warmy.appInfo();
          if (!info?.ok) return;
          const v = $('aboutVersion');
          if (v) v.textContent = `${t('about.version')} ${info.version}`;
          const rt = $('aboutRuntime');
          if (rt) rt.textContent =
            `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}/${info.arch}`;
          const dv = $('aboutDevice');
          if (dv) dv.textContent =
            `${t('wo.userId')}: ${info.deviceId || '—'} ${info.deviceIdValid ? t('about.idVerified') : t('about.idRegenerated')}`;
        } catch { /* noop */ }
      })();

      // 设置：第二列是菜单，第三列只显示对应板块
      (function bindSettingsMenu() {
        const contentEl = $('peiZhiNeiRong');
        if (!contentEl) return;
        const secIds = ['ui', 'notify', 'model', 'func', 'about'];
        const groups = { ui: [], notify: [], model: [], func: [], about: [] };
        let curSec = 'ui';
        Array.from(contentEl.children).forEach((el) => {
          const ds = el.getAttribute && el.getAttribute('data-sec');
          if (ds) curSec = ds;
          if (groups[curSec]) groups[curSec].push(el);
        });
        const navBtns = Array.from(document.querySelectorAll('#peiZhiDaoHang button'));
        const showSec = (s) => {
          secIds.forEach((k) => groups[k].forEach((el) => { el.style.display = k === s ? '' : 'none'; }));
          navBtns.forEach((b) => b.classList.toggle('qiYong', b.dataset.sec === s));
        };
        navBtns.forEach((btn) => { btn.onclick = () => showSec(btn.dataset.sec); });
        showSec('ui');
      })();
      $('xuanZeYuYan').onchange = async (e) => {
        await loadI18n(e.target.value);
        window.warmy.settingsSave({ yuYan: e.target.value });
        setNav('settings');
      };
      document.querySelectorAll('.zhuTiMoShi button').forEach((b) => {
        b.onclick = () => {
          applyThemeMode(b.dataset.m);
          window.warmy.settingsSave({ themeMode: b.dataset.m });
          renderPage();
        };
      });
      renderThemeSwatches();
      renderSkillList();
      bindDiagnostics();
      document.querySelectorAll('.zhuTiSwatches button').forEach((b) => {
        if (b.dataset.c === state.theme) b.classList.add('qiYong');
        b.onclick = () => {
          applyAccent(b.dataset.c);
          renderPage();
        };
      });
      (function bindThemeCustom() {
        const btn = $('anNiuZhuTiCustom');
        const preview = $('zhuTiCustomPreview');
        if (preview) preview.style.background = state.theme || '#c45c26';
        if (!btn) return;
        btn.onclick = async () => {
          const picked = await pickCustomAccent();
          if (!picked) return;
          applyAccent(picked);
          renderPage();
        };
      })();
      const SEC_DESC = {
        normal: 'settings.securityNormalDesc',
        strict: 'settings.securityStrictDesc',
        full: 'settings.securityFullDesc',
      };
      const syncSecDesc = () => {
        const d = $('secMiaoShu');
        if (d) d.textContent = t(SEC_DESC[state.globalSecurity] || SEC_DESC.normal);
      };
      $('xuanZeSec').value = state.globalSecurity;
      syncSecDesc();
      $('xuanZeSec').onchange = async (e) => {
        const next = e.target.value;
        if (next === 'full') {
          const okGo = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
          if (!okGo) {
            e.target.value = state.globalSecurity;
            syncSecDesc();
            return;
          }
        }
        state.globalSecurity = next;
        syncSecDesc();
        try {
          await window.warmy.setSecurityMode(state.globalSecurity);
        } catch {
          /* noop */
        }
      };
      ['complete', 'request', 'error'].forEach((k) => {
        $('s-' + k).onchange = (e) => {
          state.sound[k] = e.target.checked;
        };
      });
      document.querySelectorAll('[data-email-k]').forEach((el) => {
        el.onchange = () => {
          state.emailNotify = state.emailNotify || { complete: false, request: true, error: true };
          state.emailNotify[el.dataset.emailK] = el.checked;
          window.warmy.settingsSave({ emailNotify: state.emailNotify });
        };
      });
      document.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = async () => {
          const r = await window.warmy.pickSound();
          if (r?.ok) {
            state.soundFiles[b.dataset.pick] = r.path;
            renderPage();
          }
        };
      });
      document.querySelectorAll('[data-clear]').forEach((b) => {
        b.onclick = () => {
          state.soundFiles[b.dataset.clear] = '';
          renderPage();
        };
      });

      // ── SMTP 多账号（最多 10） ──
      $('btn-import-openclaw')?.addEventListener('click', async () => {
        $('import-msg').textContent = t('common.loading');
        const r = await window.warmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = t('instances.saved') + ' (' + r.providers.length + ')';
          state.providers = r.providers;
          renderPage();
        } else {
          $('import-msg').textContent = String(r?.error || t('common.error'));
        }
      });
      $('anNiuwebgpu')?.addEventListener('click', async () => {
        $('webgpuXiaoXi').textContent = t('common.loading');
        try {
          if (!navigator.gpu) throw new Error('no navigator.gpu');
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('no adapter');
          const info = adapter.info || {};
          $('webgpuXiaoXi').textContent = t('webgpu.ok') + ' · vendor=' + (info.vendor||'') + ' arch=' + (info.architecture||'');
        } catch (e) {
          $('webgpuXiaoXi').textContent = t('webgpu.fail');
        }
      });
      $('anNiuBaoCunTeShu')?.addEventListener('click', async () => {
        const cfg = {
          asr: { provider: $('smasr')?.value || 'ollama' },
          embedding: { provider: $('smEmbed')?.value || 'onnx' },
          summary: { provider: 'deepseek', model: $('sm-summary')?.value || 'deepseek-flash' },
          organizer: { provider: 'deepseek', model: $('smOrganizer')?.value || 'deepseek-chat' },
        };
        await window.warmy.specialModelsSet(cfg).catch(() => {});
        $('smXiaoXi').textContent = t('instances.saved');
      });
      // 邀请链接 / 二维码
      (async () => {
        const st = await window.warmy.meshStatus().catch(() => null);
        const node = st?.nodeId || 'local';
        const inv = await window.warmy.inviteCreate().catch(() => null);
        const tok = inv?.invite?.token ? '&tok=' + inv.invite.token : '';
        const link = 'warmy://join?node=' + encodeURIComponent(node) + '&port=7788' + tok;
        const lk = $('jiaRuLink');
        if (lk) lk.textContent = link;
        const qr = $('jiaRuqr');
        if (qr) {
          try {
            const mod = await import('./qr.js');
            qr.innerHTML = mod.qrSvg(link, 168);
          } catch {
            qr.textContent = link.slice(0, 26) + '…';
          }
        }
      })();
      $('btn-join-copy')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText($('jiaRuLink').textContent);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      });
      $('btn-join-accept')?.addEventListener('click', () => {
        const v = $('join-input').value.trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('warmy://') ? t('join.ok') : t('join.fail');
      });

      async function refreshBlacklist() {
        const box = $('heiMingDanHe');
        if (!box) return;
        const r = await window.warmy.blacklistList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((b) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(b.name) + ' · ' + escapeHtml(b.target) + ' · ' + new Date(b.blockedAt).toLocaleString() + '</span><button class="anNiuXiao" data-unblock="' + escapeHtml(b.id) + '">' + t('join.removeBlacklist') + '</button></div>').join('')
          : t('join.blacklistEmpty');
        box.querySelectorAll('[data-unblock]').forEach((btn) => {
          btn.onclick = async () => {
            await window.warmy.blacklistRemove(btn.dataset.unblock).catch(() => {});
            refreshBlacklist();
          };
        });
      }
      refreshBlacklist();

      async function refreshArchived() {
        const box = $('yiGuiDangHe');
        if (!box) return;
        const r = await window.warmy.archivedList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((a) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(a.name) + ' · ' + escapeHtml(String(a.kind || '')) + '</span><button class="anNiuXiao" data-restore="' + escapeHtml(a.id) + '">' + t('cp.rollback') + '</button></div>').join('')
          : '—';
        box.querySelectorAll('[data-restore]').forEach((b) => {
          b.onclick = async () => {
            await window.warmy.archivedRestore(b.dataset.restore).catch(() => {});
            refreshArchived();
            uiAlert(t('instances.saved'));
          };
        });
      }
      refreshArchived();

      async function renderSmtpList() {
        const r = await window.warmy.smtpList();
        const accounts = r?.accounts || [];
        const n = $('smtpN');
        if (n) n.textContent = String(accounts.length);
        const box = $('smtpAccounts');
        if (!box) return;
        if (!accounts.length) {
          box.innerHTML = '<div class="jingYin">' + t('smtp.empty') + '</div>';
          return;
        }
        box.innerHTML = accounts
          .map(
            (a) =>
              '<div class="provKa" style="margin-bottom:8px" data-id="' + escapeHtml(a.id) + '">' +
              '<div class="shiLiHang">' +
              '<div><b>' + escapeHtml(a.biaoQian) + '</b> <span class="jingYin">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + escapeHtml(String(a.port)) + '</span></div>' +
              '<span class="huiZhang ' + (a.verified ? '' : 'off') + '">' + (a.verified ? t('smtp.verified') : t('smtp.unverified')) + '</span>' +
              '<button class="anNiuXiao" data-v="' + escapeHtml(a.id) + '">' + t('smtp.verify') + '</button>' +
              '<button class="anNiuXiao" data-x="' + escapeHtml(a.id) + '">' + t('smtp.remove') + '</button>' +
              '</div></div>'
          )
          .join('');
        box.querySelectorAll('[data-x]').forEach((b) => {
          b.onclick = async () => {
            await window.warmy.smtpRemove(b.dataset.x);
            renderSmtpList();
          };
        });
        box.querySelectorAll('[data-v]').forEach((b) => {
          b.onclick = async () => {
            const id = b.dataset.v;
            const full = (state.smtpFull || []).find((x) => x.id === id);
            if (!full) {
              $('smtpXiaoXi').textContent = t('smtp.fail');
              return;
            }
            $('smtpXiaoXi').textContent = t('common.loading');
            const vr = await window.warmy.smtpVerify({ ...full, id });
            $('smtpXiaoXi').textContent = vr?.ok ? t('smtp.ok') : t('smtp.fail') + ': ' + (vr?.message || '');
            renderSmtpList();
          };
        });
      }
      renderSmtpList();

      $('anNiusmtpTianJia').onclick = async () => {
        const acc = {
          biaoQian: $('smtpBiaoQian').value.trim(),
          host: $('smtpHost').value.trim(),
          port: parseInt($('smtpDuanKou').value, 10) || 465,
          secure: $('smtpAnQuan').checked,
          user: $('smtpUser').value.trim(),
          pass: $('smtpPass').value,
        };
        if (!acc.host || !acc.user) {
          $('smtpXiaoXi').textContent = t('common.error');
          return;
        }
        const r = await window.warmy.smtpAdd(acc);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([acc]);
          ['smtpBiaoQian', 'smtpHost', 'smtpUser', 'smtpPass'].forEach((id) => {
            const el = $(id);
            if (el) el.value = '';
          });
          $('smtpXiaoXi').textContent = t('instances.saved');
        } else {
          $('smtpXiaoXi').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('provLieBiao');
      state.providers.forEach((pr) => {
        const el = document.createElement('div');
        el.className = 'provKa';
        el.innerHTML =
          '<div class="provHead" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.biaoQian) + '</span>' +
          '<button class="anNiuXiao" data-prov-del="' + escapeHtml(pr.id) + '" title="' + t('settings.pluginUninstall') + '">' + t('settings.pluginUninstall') + '</button>' +
          '</div>' +
          '<div class="shiLiHang">' +
          '<div class="field"><label>' + t('settings.providerName') + '</label><input data-k="biaoQian" value="' + escapeHtml(pr.biaoQian) + '"/></div>' +
          '<div class="field"><label>' + t('settings.baseUrl') + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"/></div>' +
          '<div class="field"><label>' + t('settings.apiKey') + '</label><input data-k="apiKey" type="password" value="' + escapeHtml(pr.apiKey || '') + '"/></div>' +
          '</div>' +
          '<div class="provDongZuoJi"><button class="anNiuXiao" data-fetch>' + t('settings.fetchModels') + '</button></div>' +
          '<div class="moXingHang">' +
          (((pr.models || [])
            .map(
              (m) =>
                '<span class="moXingChip" data-m="' + escapeHtml(m) + '">' + escapeHtml(m) +
                '<button class="x" data-del="' + escapeHtml(m) + '" title="' + t('settings.removeModel') + '">×</button></span>'
            )
            .join('')) || '<span class="jingYin">' + t('settings.modelsEmpty') + '</span>') +
          '</div>';
        el.querySelectorAll('shuRu[data-k]').forEach((inp) => {
          inp.onchange = () => {
            pr[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'biaoQian') el.querySelector('.provHead').textContent = inp.value;
            window.warmy.setProvider({
              presetId: pr.id,
              apiKey: pr.apiKey,
              baseURL: pr.baseURL,
              model: providerCfgModel(pr),
              protocol: pr.protocol,
            });
          };
        });
        el.querySelector('[data-fetch]').onclick = async () => {
          const btn = el.querySelector('[data-fetch]');
          btn.textContent = t('common.loading');
          await window.warmy.setProvider({
            presetId: pr.id,
            apiKey: pr.apiKey,
            baseURL: pr.baseURL,
            protocol: pr.protocol,
            model: providerCfgModel(pr),
          });
          const r = await window.warmy.listModels({ protocol: pr.protocol, baseURL: pr.baseURL, apiKey: pr.apiKey });
          if (r?.ok && r.models?.length) {
            pr.models = [...new Set([...(pr.models || []), ...r.models])];
          }
          renderPage();
        };
        el.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            pr.models = (pr.models || []).filter((m) => m !== btn.dataset.del);
            renderPage();
          };
        });
        el.querySelector('[data-prov-del]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          state.providers = state.providers.filter((x) => x.id !== pr.id);
          renderPage();
        });
        el.querySelectorAll('.moXingChip').forEach((chip) => {
          chip.onclick = async () => {
            pr.defaultModel = chip.dataset.m;
            await window.warmy.setProvider({
              presetId: pr.id,
              apiKey: pr.apiKey,
              baseURL: pr.baseURL,
              model: pr.defaultModel,
              protocol: pr.protocol,
            });
            renderPage();
          };
        });
        prov.appendChild(el);
      });
      $('anNiuTianJiaProv').onclick = () => {
        state.providers.push({
          id: 'custom-' + Date.now(),
          biaoQian: 'Custom',
          protocol: 'openai-compatible',
          baseURL: '',
          defaultModel: '',
          apiKey: '',
          models: [],
        });
        renderPage();
      };
    }
  }
  /* renderPage-end */

  $('anNiuYuYin').onclick = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buf = await blob.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const dataUrl = 'data:audio/webm;base64,' + btoa(bin);
        const r = await window.warmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          // 尝试 ASR 转文字
          const asr = await window.warmy.asrTranscribe({ dataUrl, ext: 'webm' }).catch(() => null);
          const text = asr?.ok && asr.text ? asr.text : `[${t('chat.voice')}] ${r.path.split(/[\\/]/).pop()}`;
          pushMsg(state.selectedChat.id, 'wo', text);
          renderChat();
        } else {
          uiAlert(t('chat.voiceUnsupported'));
        }
      };
      rec.start();
      uiAlert(t('chat.voice') + '…').then(() => {
        setTimeout(() => rec.stop(), 1200);
      });
    } catch {
      uiAlert(t('chat.voiceUnsupported'));
    }
  };
  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });
  // 输入防抖：仅更新内部状态，不触发重渲染
  const syncSendState = () => {
    const btn = $('anNiuFaSong');
    if (btn) btn.disabled = !($('shuRu')?.value || '').trim();
  };
  $('shuRu')?.addEventListener('input', () => {
    syncSendState();
    const now = Date.now();
    if (now - __inputThrottle < 100) return;
    __inputThrottle = now;
  });
  syncSendState();
  // 紧急度下拉：悬停显框，点击展开
  (function bindUrgency() {
    const trigger = $('jinJiTrigger');
    const menu = $('jinJiCaiDan');
    const dd = $('urgencyDd');
    const biaoQian = $('jinJiBiaoQian');
    if (!trigger || !menu || !dd) return;

    const LABELS = { P1: 'urgency.urgentLabel', P2: 'urgency.insertLabel', P3: 'urgency.queueLabel' };

    function refresh() {
      if (biaoQian) biaoQian.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      const icon = dd.querySelector('.urgentI');
      if (icon) icon.classList.toggle('yinCang', state.urgency !== 'P1');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.u === state.urgency));
    }
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
      if (!menu.classList.contains('yinCang')) positionMenuFixed(trigger, menu);
    });
    onDocClick(() => menu?.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');
      if (!b) return;
      const u = b.dataset.u;
      if (u === 'P1') {
        const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('yinCang');
          return;
        }
      }
      state.urgency = u;
      menu.classList.add('yinCang');
      refresh();
    });

    // 语言切换后刷新文案
    window.__refreshUrgency = refresh;
  })();
  // 「…」更多菜单
  $('gengDuoTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('gengDuoCaiDan');
    menu?.classList.toggle('yinCang');
    if (menu && !menu.classList.contains('yinCang')) positionMenuFixed($('gengDuoTrigger'), menu);
  });
  onDocClick(() => $('gengDuoCaiDan')?.classList.add('yinCang'));
  $('caiDanTuBiaoSouSuo')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    showSearchPopup();
  });
  let __directed = false;
  $('caiDanTuBiaoDingXiang')?.addEventListener('click', async () => {
    __directed = !__directed;
    const mark = $('caiDanTuBiaoDingXiangMark');
    if (mark) mark.textContent = __directed ? '✓' : '✕';
    if (state.selectedChat) {
      await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });
  $('caiDanTuBiaoDaKai')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏
    window.warmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind, mode: 'fu' });
  });
  $('caiDanTuBiaoDaoChu')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    showExportDialog();
  });

  $('anNiuKongZhiTai')?.addEventListener('click', () => {
    state.consoleOpen = !state.consoleOpen;
    $('anNiuKongZhiTai')?.classList.toggle('biaoTiLanQiYong', state.consoleOpen);
    $('kongZhiTaiMianBan')?.classList.toggle('yinCang', !state.consoleOpen);
    $('kongZhiTaiTiaoZhengTiao')?.classList.toggle('yinCang', !state.consoleOpen);
    if (state.consoleOpen && $('kongZhiTaiShuChu')) {
      $('kongZhiTaiShuChu').textContent = 'WArmy console ready.\n' + new Date().toLocaleString() + '\n';
    }
  });
  (function bindConsoleResize() {
    const el = $('kongZhiTaiTiaoZhengTiao');
    const pane = $('kongZhiTaiMianBan');
    if (!el || !pane) return;
    let y0 = 0, h0 = 0, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      const h = Math.min(360, Math.max(80, h0 + (y0 - e.clientY)));
      pane.style.maxHeight = h + 'px';
      pane.style.height = h + 'px';
    };
    const onUp = () => { drag = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = pane.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  })();
  $('anNiuShot')?.addEventListener('click', () => uiAlert(t('chat.screenshotPending')));
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('secTrigger');
    const menu = $('secCaiDan');
    const dd = $('secDd');
    const biaoQian = $('secBiaoQian');
    if (!trigger || !menu || !dd) return;

    const LABELS = {
      normal: 'chat.securityNormal',
      strict: 'chat.securityStrict',
      full: 'chat.securityFull',
    };
    function currentMode() {
      const id = state.selectedChat?.id;
      return (id && state.sessionSecurity[id]) || state.globalSecurity || 'normal';
    }
    function refresh() {
      const mode = currentMode();
      if (biaoQian) biaoQian.textContent = t(LABELS[mode] || LABELS.normal);
      dd.classList.toggle('urgent', mode === 'full');
      const warn = dd.querySelector('.secWarn');
      if (warn) warn.classList.toggle('yinCang', mode !== 'full');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.s === mode));
    }
    window.__refreshSecurity = refresh;
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
      if (!menu.classList.contains('yinCang')) positionMenuFixed(trigger, menu);
    });
    onDocClick(() => menu?.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('yinCang');
          return;
        }
      }
      menu.classList.add('yinCang');
      if (state.selectedChat) {
        state.sessionSecurity[state.selectedChat.id] = mode;
      } else {
        state.globalSecurity = mode;
        try { await window.warmy.setSecurityMode(mode); } catch { /* noop */ }
      }
      refresh();
    });
  })();
  $('touXiangWenJian').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      if (pendingAvatarTarget && pendingAvatarTarget.kind === 'instance') {
        pendingAvatarTarget.inst.avatarDataUrl = url;
        pendingAvatarTarget = null;
        if (state.selectedInstance) renderInstanceDetail();
        window.__saveState?.();
        return;
      }
      state.profile.avatarDataUrl = url;
      applyAvatar();
      saveProfile();
      if (state.nav === 'wo') renderPage();
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  });
  $('anNiuwinMin')?.addEventListener('click', () => window.warmy.winMinimize());
  $('anNiuwinMax')?.addEventListener('click', () => window.warmy.winMaximize());
  $('anNiuwinGuanBi')?.addEventListener('click', () => window.warmy.winClose());
  $('anNiuuiRefresh')?.addEventListener('click', () => window.warmy.winReload());
  $('anNiuZongShiDing')?.addEventListener('click', async () => {
    const r = await window.warmy.winAlwaysOnTop();
    $('anNiuZongShiDing')?.classList.toggle('biaoTiLanJiHuo', !!r?.alwaysOnTop);
  });

  (async () => {
    try {
      const p = await window.warmy.platformInfo();
      if (p?.isMac) document.body.classList.add('pingTaiDarwin');
      else if (p?.isWin) document.body.classList.add('pingTaiWin32');
      else if (p?.isLinux) document.body.classList.add('pingTaiLinux');
    } catch {
      /* noop */
    }
  })();

  /**
   * 群列表以主进程存储为准（userData/groups.json）。
   * 历史问题：建群会同步调用 groupCreate，但「解散 / 退出群」只改本地 state.groups，
   * 主进程存储纹丝不动 —— 两边分叉，重启后界面上又会冒出已经解散的群。
   * 所以在启动时、以及每次群变更后，都从真实存储重新拉一遍。
   */
  async function syncGroupsFromStore() {
    try {
      const r = await window.warmy.groupList();
      if (!r || r.ok !== true || !Array.isArray(r.groups)) return false;
      const prev = new Map(state.groups.map((g) => [g.id, g]));
      const fromStore = r.groups.map((g) => {
        const old = prev.get(g.groupId) || {};
        return {
          id: g.groupId,
          ming: g.name,
          type: g.type,
          members: old.members || [],
          notify: old.notify !== false,
          archived: !!old.archived,
          directedMode: !!g.directedMode,
          memberCount: g.memberCount,
        };
      });
      // 只替换群类条目，保留看板派生出来的其它条目
      const keep = state.groups.filter((g) => g.type !== 'internal' && g.type !== 'external');
      state.groups = keep.concat(fromStore);
      if (
        state.selectedChat &&
        state.selectedChat.kind !== 'single' &&
        state.selectedChat.kind !== 'extdm' &&
        !fromStore.some((g) => g.id === state.selectedChat.id)
      ) {
        state.selectedChat = null;
      }
      renderList();
      return true;
    } catch {
      // 预览桩或旧主进程没有该 API：不影响其余功能
      return false;
    }
  }

  function createGroupFlow() {
    uiPrompt(state.nav === 'internalGroup' ? t('list.createProject') : t('list.createGroupChat'), state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt')).then(async (ming) => {
      if (!ming) return;
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const id = 'g' + Date.now();
      try {
        await window.warmy.groupCreate({ groupId: id, ming, type, directedMode: false });
      } catch (e) {
        uiAlert(String(e.message || e));
        return;
      }
      await syncGroupsFromStore();
    });
  }

  function addContactFlow() {
    uiPrompt(t('contact.add'), '').then((ming) => {
      if (!ming) return;
      state.chats.push({ id: 'c-' + Date.now(), ming, kind: 'extdm', lastPreview: t('list.noReply'), notify: true });
      renderList();
    });
  }

  function addInstanceFlow() {
    uiPrompt(t('instances.name'), t('placeholder.agentName') + '-' + (state.instances.length + 1)).then((ming) => {
      if (!ming) return;
      const inst = {
        id: 'inst-' + Date.now(),
        ming,
        status: 'stopped',
        dutyEligible: true,
        notify: true,
        model: 'deepseek-chat',
        memoryFile: 'persona/' + ming + '.md',
        persona: t('instances.personaDefault'),
        avatarPreset: randomPreset(),
        avatarDataUrl: '',
      };
      state.instances.push(inst);
      state.selectedInstance = inst;
      hideMain();
      $('shiLiXiangQing').classList.remove('yinCang');
      renderInstanceDetail();
      renderList();
    });
  }

  function bindResizer(el, cssVar, min, max) {
    if (!el) return;
    let startX = 0, startW = 0, dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      el.classList.add('dragging');
      startX = e.clientX;
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 280;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  function bindVerticalResizer(handleId, targetId, dir) {
    const el = $(handleId);
    const target = $(targetId);
    if (!el || !target) return;
    let y0 = 0, h0 = 0, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      const delta = dir === 'up' ? (y0 - e.clientY) : (e.clientY - y0);
      const h = Math.min(400, Math.max(80, h0 + delta));
      target.style.height = h + 'px';
      target.style.maxHeight = h + 'px';
    };
    const onUp = () => {
      if (!drag) return;
      drag = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = target.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }
  // 控制台上方：拉伸控制台自身
  bindVerticalResizer('kongZhiTaiDingTiaoZhengTiao', 'kongZhiTaiMianBan', 'up');
  // 控制台下方（输入框上方）：拉伸输入区
  bindVerticalResizer('shuRuDingTiaoZhengTiao', 'shuRu', 'up');

  // ── 右键菜单 ──
  // ── 3 权限审批弹窗 ──
  function showApprovalDialog(payload) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('approval.biaoTi');
      $('duiHuaKuangTi').innerHTML =
        '<div style="margin-bottom:8px">' + escapeHtml(payload.action || '') + '</div>' +
        '<div class="jingYin">' + t('approval.tiShi') + '</div>';
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const mk = (biaoQian, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = biaoQian;
        b.onclick = async () => {
          root.classList.add('yinCang');
          await fn();
        };
        acts.appendChild(b);
      };
      mk(t('common.cancel'), 'anNiuXiao', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.deny'), 'anNiuXiao', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.once'), 'anNiuZhuYao', () => resolve({ allowed: true, scope: 'once' }));
      mk(t('approval.project'), 'anNiuXiao', () => resolve({ allowed: true, scope: 'project' }));
      mk(t('approval.global'), 'anNiuXiao', () => resolve({ allowed: true, scope: 'global' }));
      root.classList.remove('yinCang');
    });
  }
  window.warmy.onApprovalRequest?.(async (d) => {
    const r = await showApprovalDialog(d);
    await window.warmy.approvalRespond(d.id, r.allowed, r.scope);
  });

  function openContextMenu(x, y, items) {
    closeContextMenu();
    const el = document.createElement('div');
    el.className = 'shangXiaWenCaiDan';
    el.id = 'shangXiaWenCaiDan';
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'shangXiaWenFenGe';
        el.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.biaoQian;
      if (it.danger) b.classList.add('danger');
      if (it.checked) b.classList.add('qiYong');
      b.onclick = async () => {
        closeContextMenu();
        await it.onClick?.();
      };
      el.appendChild(b);
    });
    el.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    el.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    document.body.appendChild(el);
    setTimeout(() => {
      document.addEventListener('click', closeContextMenu, { once: true });
      document.addEventListener('keydown', onCtxKey, { once: true });
    }, 0);
  }
  function onCtxKey(e) {
    if (e.key === 'Escape') closeContextMenu();
  }
  function closeContextMenu() {
    document.getElementById('shangXiaWenCaiDan')?.remove();
  }

  function playNotifySound(kind) {
    const sid = state.selectedChat?.id;
    if (!shouldNotify(sid)) return; // 未勾选提醒：无提示音
    if (!state.sound || !state.sound[kind]) return; // 全局开关
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = kind === 'error' ? 220 : kind === 'request' ? 880 : 660;
      gain.gain.value = 0.04;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* noop */ }
  }

  function shouldNotify(sessionId) {
    if (!sessionId) return true;
    const inst = state.instances.find((x) => x.id === sessionId);
    if (inst) return inst.notify !== false;
    const g = state.groups.find((x) => x.id === sessionId);
    if (g) return g.notify !== false;
    const c = state.chats.find((x) => x.id === sessionId);
    if (c) return c.notify !== false;
    // 未知会话：默认提醒
    return true;
  }

  function sessionHasBlockingTasks(id) {
    const q = state.queues[id] || [];
    return q.some((x) => x.status !== 'done' && x.status !== 'cancelled');
  }

  function agentMenu(inst, rowEl) {
    const running = inst.status === 'running';
    const blocked = running || sessionHasBlockingTasks(inst.id);
    const rect = rowEl.getBoundingClientRect();
    return [
      {
        biaoQian: running ? t('ctx.close') : t('ctx.enable'),
        onClick: async () => {
          if (running) {
            if (sessionHasBlockingTasks(inst.id)) {
              uiAlert(t('ctx.taskRunning'));
              return;
            }
            const ok = await uiConfirm(t('ctx.closeConfirm'));
            if (!ok) return;
            await window.warmy.stopInstance(inst.id);
            inst.status = 'stopped';
          } else {
            try {
              await window.warmy.spawnInstance({ id: inst.id, ming: inst.name, dutyEligible: true });
              inst.status = 'running';
            } catch (e) {
              uiAlert(String(e.message || e));
            }
          }
          renderList();
        },
      },
      {
        biaoQian: t('ctx.settings'),
        onClick: () => {
          state.selectedInstance = inst;
          setNav('instances');
        },
      },
      {
        biaoQian: t('ctx.rename'),
        onClick: async () => {
          const ming = await uiPrompt(t('ctx.renamePrompt'), inst.name);
          if (!ming) return;
          inst.name = ming;
          renderList();
          if (state.selectedInstance?.id === inst.id) renderInstanceDetail();
        },
      },
      {
        biaoQian: t('ctx.archive'),
        onClick: async () => {
          const ok = await uiConfirm(t('ctx.archiveConfirm'));
          if (!ok) return;
          inst.archived = true;
          await window.warmy.archivedAdd({ id: inst.id, ming: inst.name, kind: 'agent' }).catch(() => {});
          uiAlert(t('instances.saved'));
          renderList();
        },
      },
      {
        biaoQian: t('ctx.clear'),
        danger: true,
        onClick: async () => {
          const ok = await uiConfirm(t('ctx.clearConfirm'));
          if (!ok) return;
          state.queues[inst.id] = [];
          window.__msgs = window.__msgs || {};
          delete window.__msgs[inst.id];
          uiAlert(t('instances.saved'));
          renderQueueBar();
        },
      },
      {
        biaoQian: t('ctx.notify') + (inst.notify ? ' ✓' : ''),
        onClick: () => {
          inst.notify = !inst.notify;
          renderList();
        },
      },
    ];
  }

  function groupMenu(g, rowEl) {
    const blocked = sessionHasBlockingTasks(g.id);
    const joined = !g.joinedByOther;
    return [
      {
        biaoQian: t('ctx.rename'),
        onClick: async () => {
          const ming = await uiPrompt(t('ctx.renamePrompt'), g.name);
          if (!ming) return;
          g.name = ming;
          renderList();
        },
      },
      joined
        ? {
            biaoQian: t('ctx.delete'),
            danger: true,
            onClick: async () => {
              if (blocked) {
                uiAlert(t('ctx.taskRunning'));
                return;
              }
              const ok = await uiConfirm(t('ctx.closeConfirm'));
              if (!ok) return;
              const dr = await window.warmy.groupDissolve(g.id).catch(() => null);
              if (dr && dr.ok === false) {
                uiAlert(t('ctx.dissolveFailed'));
                return;
              }
              state.groups = state.groups.filter((x) => x.id !== g.id);
              if (state.selectedChat?.id === g.id) state.selectedChat = null;
              renderList();
              setNav(state.nav);
            },
          }
        : {
            biaoQian: t('ctx.leave'),
            danger: true,
            onClick: async () => {
              // 本机单节点部署下，群记录只存在这台机器上，
              // 因此「退出」与「解散」的效果一致；都必须在存储里删掉，
              // 否则下次启动 syncGroupsFromStore() 会把它拉回来。
              await window.warmy.groupDissolve(g.id).catch(() => null);
              state.groups = state.groups.filter((x) => x.id !== g.id);
              renderList();
            },
          },
      g.type === 'internal'
        ? {
            biaoQian: t('ctx.archive'),
            onClick: async () => {
              const ok = await uiConfirm(t('ctx.archiveConfirm'));
              if (!ok) return;
              g.archived = true;
              uiAlert(t('instances.saved'));
            },
          }
        : null,
      {
        biaoQian: t('ctx.notify') + (g.notify ? ' ✓' : ''),
        onClick: () => {
          g.notify = !g.notify;
          renderList();
        },
      },
    ].filter(Boolean);
  }

  function bindRowContext(rowEl, getItems) {
    rowEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, getItems());
    });
  }

  // 列表空白处右键：按时间 / 按名称排序（我的牛马、项目、联系人、群聊）
  $('lieBiaoTi')?.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.lieBiaoTiaoMu, .lieBiaoKa, .enterHqBaoGuo')) return;
    if (!['singleAi', 'internalGroup', 'externalGroup', 'externalChat'].includes(state.nav)) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { biaoQian: t('list.sortByTime'), checked: state.listSort !== 'ming', onClick: () => setListSort('time') },
      { biaoQian: t('list.sortByName'), checked: state.listSort === 'ming', onClick: () => setListSort('ming') },
    ]);
  });

  // ── 加入请求处理 ──
  async function refreshJoinBadge() {
    const r = await window.warmy.joinPending().catch(() => null);
    const n = r?.count || 0;
    const huiZhang = $('join-badge');
    if (huiZhang) {
      huiZhang.textContent = String(n);
      huiZhang.classList.toggle('yinCang', n === 0);
    }
  }
  
  refreshJoinBadge();

  function showJoinRequestModal(req) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('join.requestBadge');
      $('duiHuaKuangTi').innerHTML =
        '<div>' + t('join.requester') + ': ' + escapeHtml(req.name) + '</div>' +
        '<div>' + t('join.kind') + ': ' + escapeHtml(req.kind) + '</div>' +
        '<div>' + t('join.target') + ': ' + escapeHtml(req.targetType) + ' ' + escapeHtml(req.target) + '</div>' +
        '<div>' + t('join.applyTime') + ': ' + new Date(req.ts).toLocaleString() + '</div>' +
        '<div>' + t('join.expireTime') + ': ' + new Date(req.expireAt).toLocaleString() + '</div>';
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const mk = (biaoQian, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = biaoQian;
        b.onclick = async () => { root.classList.add('yinCang'); await fn(); };
        acts.appendChild(b);
      };
      mk(t('join.reject'), 'anNiuXiao', () => resolve('reject'));
      mk(t('join.blacklist'), 'anNiuDanger', () => resolve('block'));
      mk(t('join.agree'), 'anNiuZhuYao', () => resolve('agree'));
      root.classList.remove('yinCang');
    });
  }

  document.querySelectorAll('[data-nav="instances"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const r = await window.warmy.joinPending().catch(() => null);
      if (r?.items?.length) {
        const req = r.items[0];
        const action = await showJoinRequestModal(req);
        await window.warmy.joinRespond({ id: req.id, action });
        refreshJoinBadge();
        uiAlert(t('instances.saved'));
      }
    });
  });

  // ── 进度折叠 ──
  $('jinDuKaiGuan')?.addEventListener('click', () => {
    $('jinDuKaiGuan')?.classList.toggle('daKai');
    $('renwuLieBiao')?.classList.toggle('yinCang');
  });

  // ── onlyQun 显示/隐藏 ──
  function updatePanelVisibility() {
    const isGroup = state.selectedChat && (state.selectedChat.kind === 'internal' || state.selectedChat.kind === 'extgroup');
    document.querySelectorAll('.onlyQun').forEach((el) => {
      el.classList.toggle('yinCang', !isGroup);
    });
  }

  // ── 模型管理（会话右侧）──
  let __mgrOpen = new Set();
  function renderModelMgr() {
    const box = $('moXingMgr');
    if (!box) return;
    const sel = state.selectedChat;
    if (!sel) {
      box.innerHTML = '<div class="jingYin">' + t('panel.modelMgrEmpty') + '</div>';
      return;
    }
    const isGroup = sel.kind === 'internal' || sel.kind === 'extgroup';
    let entries = [];
    if (isGroup) {
      const g = state.groups.find((x) => x.id === sel.id);
      const members = (g && g.members) || [];
      entries = members.map((m) => {
        const nm = typeof m === 'string' ? m : (m && (m.name || m.id)) || '';
        const local = state.instances.find((i) => i.name === nm || i.id === nm);
        return local
          ? { inst: local, editable: true }
          : { inst: { ming: nm, availableModels: [], chain: [], defaultModel: '' }, editable: false };
      });
    } else {
      const local =
        state.instances.find((i) => i.id === sel.id) ||
        state.instances.find((i) => i.name === sel.name);
      if (local) entries = [{ inst: local, editable: true }];
    }
    if (!entries.length) {
      box.innerHTML = '<div class="jingYin">' + t('panel.modelMgrEmpty') + '</div>';
      return;
    }
    box.innerHTML = entries
      .map((x, idx) => modelMgrCard(x.inst, x.editable, idx))
      .join('');
    bindModelMgr(entries);
  }

  /** 某模型属于哪个供应商 */
  function providerLabelOf(model) {
    const p = (state.providers || []).find((x) => (x.models || []).includes(model));
    return p ? p.biaoQian : '—';
  }

  /** 延迟显示：state.modelLatency[model] 单位 ms */
  function latencyText(model) {
    const ms = state.modelLatency && state.modelLatency[model];
    return ms ? ms + ' ms' : t('model.latencyNA');
  }

  function modelMgrCard(inst, editable, idx) {
    const models = inst.availableModels || [];
    const chain = (inst.chain && inst.chain.length) ? inst.chain : models;
    const dis = editable ? '' : ' disabled';
    const daKai = __mgrOpen.has(idx) ? ' daKai' : '';
    return `<details class="mgrKa${editable ? '' : ' zhiDuMianBan'}" data-mgidx="${idx}"${daKai}>
      <summary>
        <img class="avTuPian small" src="${escapeHtml(instanceAvatarSrc(inst))}" alt=""/>
        <span class="mgrMing">${escapeHtml(inst.name || inst.id || '')}</span>
        ${editable ? '' : '<span class="mgrRo">' + t('panel.modelMgrReadonly') + '</span>'}
      </summary>
      <div class="mgrTi">
        <label class="mgrLb">${t('instances.defaultModel')}</label>
        <select data-mg="default" data-i="${idx}"${dis}>
          <option value="__smart__"${!inst.defaultModel ? ' selected' : ''}>${t('instances.smartPick')}</option>
          ${models.map((m) => `<option value="${escapeHtml(m)}"${inst.defaultModel === m ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <label class="mgrLb">${t('instances.availableModels')}</label>
        <div class="mgrMoXingJi">${
          models.length
            ? models.map((m) => `<span class="moXingChip">${escapeHtml(m)}${
                editable ? `<button class="x" data-mgdel="${idx}" data-m="${escapeHtml(m)}" title="${t('settings.removeModel')}">×</button>` : ''
              }</span>`).join('')
            : '<span class="jingYin">' + t('settings.modelsEmpty') + '</span>'
        }</div>
        <label class="mgrLb">${t('instances.fallbackChain')}</label>
        <ol class="mgrChain">${
          chain.length
            ? chain.map((m, k) => `<li data-chain="${idx}" data-k="${k}"${editable ? ' draggable="true"' : ''}>
                <span class="mgrChainMing">${escapeHtml(m)}</span>
                <span class="mgrChainYuanShuju">${escapeHtml(providerLabelOf(m))} · ${escapeHtml(latencyText(m))}</span>
                ${editable ? `<button class="anNiuXiao" data-mgtest="${idx}" data-m="${escapeHtml(m)}" title="${t('model.test')}">⚡</button>` : ''}
              </li>`).join('')
            : '<li class="jingYin">—</li>'
        }</ol>
        ${editable ? `<div class="mgrTianJiaHang"><button class="anNiuXiao" data-mgadd="${idx}">＋ ${t('instances.addModel')}</button></div>` : ''}
      </div>
    </details>`;
  }

  function bindModelMgr(entries) {
    const box = $('moXingMgr');
    if (!box) return;
    box.querySelectorAll('details.mgrKa').forEach((d) => {
      d.addEventListener('toggle', () => {
        const i = Number(d.dataset.mgidx);
        if (d.daKai) __mgrOpen.add(i);
        else __mgrOpen.delete(i);
      });
    });
    box.querySelectorAll('[data-mg="default"]').forEach((selEl) => {
      selEl.onchange = () => {
        const e = entries[Number(selEl.dataset.i)];
        if (!e || !e.editable) return;
        e.inst.defaultModel = selEl.value === '__smart__' ? '' : selEl.value;
        window.__saveState?.();
      };
    });
    box.querySelectorAll('[data-mgdel]').forEach((b) => {
      b.onclick = () => {
        const e = entries[Number(b.dataset.mgdel)];
        if (!e || !e.editable) return;
        const m = b.dataset.m;
        e.inst.availableModels = (e.inst.availableModels || []).filter((x) => x !== m);
        e.inst.chain = (e.inst.chain || []).filter((x) => x !== m);
        renderModelMgr();
        window.__saveState?.();
      };
    });
    const move = (idx, k, dir) => {
      const e = entries[idx];
      if (!e || !e.editable) return;
      const arr = e.inst.chain;
      if (!arr) return;
      const t2 = k + dir;
      if (t2 < 0 || t2 >= arr.length) return;
      [arr[k], arr[t2]] = [arr[t2], arr[k]];
      renderModelMgr();
      window.__saveState?.();
    };
    box.querySelectorAll('[data-mgup]').forEach((b) => {
      b.onclick = () => move(Number(b.dataset.mgup), Number(b.dataset.k), -1);
    });
    box.querySelectorAll('[data-mgdown]').forEach((b) => {
      b.onclick = () => move(Number(b.dataset.mgdown), Number(b.dataset.k), 1);
    });
    // 拖拽排序
    let dragFrom = null;
    box.querySelectorAll('.mgrChain li[draggable="true"]').forEach((li) => {
      li.ondragstart = (e) => {
        dragFrom = { idx: Number(li.dataset.chain), k: Number(li.dataset.k) };
        li.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', String(li.dataset.k)); } catch { /* noop */ }
      };
      li.ondragend = () => { li.classList.remove('dragging'); dragFrom = null; };
      li.ondragover = (e) => { e.preventDefault(); li.classList.add('dropTarget'); };
      li.ondragleave = () => li.classList.remove('dropTarget');
      li.ondrop = (e) => {
        e.preventDefault();
        li.classList.remove('dropTarget');
        if (!dragFrom) return;
        const to = { idx: Number(li.dataset.chain), k: Number(li.dataset.k) };
        if (dragFrom.idx !== to.idx || dragFrom.k === to.k) return;
        const e2 = entries[dragFrom.idx];
        if (!e2 || !e2.editable || !e2.inst.chain) return;
        const arr = e2.inst.chain;
        const [item] = arr.splice(dragFrom.k, 1);
        arr.splice(to.k, 0, item);
        renderModelMgr();
        window.__saveState?.();
      };
    });
    // 测速：请求供应商的 models 接口，记录耗时
    box.querySelectorAll('[data-mgtest]').forEach((b) => {
      b.onclick = async () => {
        const model = b.dataset.m;
        b.disabled = true;
        const biaoQian = b.textContent;
        b.textContent = '…';
        try {
          const p = (state.providers || []).find((x) => (x.models || []).includes(model));
          const t0 = performance.now();
          const r = await window.warmy.listModels({ protocol: p && p.protocol, baseURL: p && p.baseURL, apiKey: p && p.apiKey });
          const ms = Math.round(performance.now() - t0);
          if (r && r.ok) {
            if (!state.modelLatency) state.modelLatency = {};
            state.modelLatency[model] = ms;
          }
        } catch {
          /* noop */
        }
        b.disabled = false;
        b.textContent = biaoQian;
        renderModelMgr();
      };
    });
    // 添加模型
    box.querySelectorAll('[data-mgadd]').forEach((b) => {
      b.onclick = async () => {
        const e3 = entries[Number(b.dataset.mgadd)];
        if (!e3 || !e3.editable) return;
        const picked = await pickModelsToAdd(e3.inst);
        if (picked && picked.length) {
          e3.inst.availableModels = [...new Set([...(e3.inst.availableModels || []), ...picked])];
          e3.inst.chain = [...new Set([...(e3.inst.chain || []), ...picked])];
          renderModelMgr();
          window.__saveState?.();
        }
      };
    });
  }

  /** 添加模型：选供应商 → 拉取 → 勾选 */
  function pickModelsToAdd(inst) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('model.addTitle');
      const ti = $('duiHuaKuangTi');
      const provs = state.providers || [];
      ti.innerHTML = `<div class="field">
          <label>${t('model.pickProvider')}</label>
          <div style="display:flex;gap:6px">
            <select id="mpProv" style="flex:1">${provs.map((p, i) => `<option value="${i}">${escapeHtml(p.biaoQian || p.id)}</option>`).join('')}</select>
            <button class="anNiuXiao" id="mpFetch">${t('model.fetch')}</button>
          </div>
        </div>
        <div class="jingYin" style="font-size:12px">${t('model.fetchHint')}</div>
        <div class="moXingXuanZeLieBiao" id="mpLieBiao"></div>`;
      const listBox = $('mpLieBiao');
      const renderList = () => {
        const p = provs[Number($('mpProv').value)] || {};
        const have = new Set(inst.availableModels || []);
        const cand = (p.models || []).filter((m) => !have.has(m));
        listBox.innerHTML = cand.length
          ? cand.map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}"/> ${escapeHtml(m)}</label>`).join('')
          : `<div class="jingYin">${t('model.noneAvailable')}</div>`;
      };
      renderList();
      $('mpProv').onchange = renderList;
      $('mpFetch').onclick = async () => {
        const btn = $('mpFetch');
        btn.textContent = t('common.loading');
        const p = provs[Number($('mpProv').value)] || {};
        try {
          const r = await window.warmy.listModels({ protocol: p.protocol, baseURL: p.baseURL, apiKey: p.apiKey });
          if (r && r.ok && r.models && r.models.length) {
            p.models = [...new Set([...(p.models || []), ...r.models])];
          }
        } catch {
          /* noop */
        }
        btn.textContent = t('model.fetch');
        renderList();
      };
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); resolve(null); };
      const okAdd = document.createElement('button');
      okAdd.className = 'anNiuZhuYao';
      okAdd.textContent = t('model.addSelected');
      okAdd.onclick = () => {
        const picked = Array.from(listBox.querySelectorAll('shuRu[type=checkbox]:checked')).map((i) => i.value);
        root.classList.add('yinCang');
        resolve(picked);
      };
      acts.append(cancel, okAdd);
      root.classList.remove('yinCang');
    });
  }

  // ── 搜索浮窗 ──
  function showSearchPopup() {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('list.search');
    $('duiHuaKuangTi').innerHTML = '<input id="souSuoPopupShuRu" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="' + t('list.search') + '"/><div id="souSuoPopupResults" class="jingYin" style="margin-top:8px;max-height:200px;overflow:auto"></div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'anNiuXiao';
    close.textContent = t('common.close');
    close.onclick = () => { root.classList.add('yinCang'); };
    acts.appendChild(close);
    root.classList.remove('yinCang');
    const inp = $('souSuoPopupShuRu');
    inp?.focus();
    let timer = null;
    inp?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (!q) { $('souSuoPopupResults').textContent = ''; return; }
        const r = await window.warmy.searchMessages(q).catch(() => null);
        const hits = r?.hits || [];
        $('souSuoPopupResults').innerHTML = hits.length
          ? hits.map((x) => '<div style="padding:4px 0;border-bottom:1px solid var(--line)">' + escapeHtml(x.snippet) + '</div>').join('')
          : t('list.empty');
      }, 300);
    });
  }

  // ── 导出弹窗 ──
  function showExportDialog() {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('chat.export');
    $('duiHuaKuangTi').innerHTML =
      '<div style="margin-bottom:8px">' + t('export.tiShi') + '</div>' +
      '<div class="jingYin">' + t('export.include') + '</div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
    ok.textContent = t('chat.export');
    ok.onclick = async () => {
      if (!state.selectedChat) { root.classList.add('yinCang'); return; }
      const xiaoXi = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
      const r = await window.warmy.exportSession({
        title: state.selectedChat.name,
        labels: { header: t('export.header'), wo: t('export.wo') },
        xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
      });
      root.classList.add('yinCang');
      uiAlert(r?.ok ? r.path : t('common.error'));
    };
    acts.append(cancel, ok);
    root.classList.remove('yinCang');
  }

  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.ceLanTiaoMu').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('lieBiaoSouSuo').addEventListener('input', () => renderList());
  $('anNiuFaSong').addEventListener('click', () => faSong());
  $('anNiuTingZhiAll')?.addEventListener('click', () => stopAllAi());
  $('anNiuAttach').addEventListener('click', async () => {
    const r = await window.warmy.pickFile();
    if (r?.ok) {
      const ming = r.path.split(/[\\/]/).pop();
      state.attachments.push({ ming, path: r.path });
      renderAttach();
    }
  });

  bindResizer($('lanTiaoZhengTiao'), '--list-w', 200, 420);
  bindResizer($('mianBanTiaoZhengTiao'), '--panel-w', 220, 480);

  async function refreshCost() {
    const box = $('cost-box');
    if (!box) return;
    const c = await window.warmy.costSummary().catch(() => null);
    if (c?.ok) {
      box.textContent = '¥' + c.estCostCny + ' · ' + c.promptTokens + ' in / ' + c.completionTokens + ' out · cache ' + ((c.cacheHitRate||0)*100).toFixed(1) + '%';
    }
  }
  

  async function refreshMetrics() {
    const box = $('zhiBiaoJiHe');
    if (!box) return;
    try {
      const m = await window.warmy.metricsSummary();
      if (!m?.ok) return;
      box.textContent = `turns=${m.turns} · cache=${((m.cacheHitRate || 0) * 100).toFixed(1)}% · ccr=${((m.ccrRatio || 1) * 100).toFixed(0)}% · avg=${m.avgDurationMs}ms`;
      const cost = await window.warmy.costSummary().catch(() => null);
      if (cost?.ok) {
        box.textContent += ` · ¥${cost.estCostCny}`;
      }
    } catch {
      /* noop */
    }
  }

  /** 成本明细：按会话 / 按模型聚合，可导出 CSV */
  async function renderCostDash() {
    const box = $('chengBenDash');
    if (!box) return;
    const r = await window.warmy.metricsTurns().catch(() => null);
    const turns = (r && r.turns) || [];
    if (!turns.length) {
      box.innerHTML = '<div class="jingYin">' + t('cost.empty') + '</div>';
      return;
    }
    const agg = (key) => {
      const m = new Map();
      turns.forEach((x) => {
        const k = x[key] || '—';
        const cur = m.get(k) || { turns: 0, tokens: 0, cost: 0 };
        cur.turns += 1;
        cur.tokens += (x.promptTokens || 0) + (x.completionTokens || 0);
        cur.cost += ((x.promptTokens || 0) + (x.completionTokens || 0)) / 1000 * 0.002;
        m.set(k, cur);
      });
      return [...m.entries()].sort((p, q2) => q2[1].cost - p[1].cost);
    };
    const table = (rows, firstCol) => {
      const head =
        '<tr><th>' + firstCol + '</th><th>' + t('cost.turns') + '</th><th>' + t('cost.tokens') + '</th><th>' + t('cost.cost') + '</th></tr>';
      const ti = rows
        .slice(0, 8)
        .map(
          ([k, v]) =>
            '<tr><td>' + escapeHtml(String(k).slice(0, 18)) + '</td><td>' + v.turns + '</td><td>' + v.tokens +
            '</td><td>' + v.cost.toFixed(4) + '</td></tr>'
        )
        .join('');
      return '<table class="chengBenTable">' + head + ti + '</table>';
    };
    box.innerHTML =
      '<div class="chengBenFu">' + t('cost.bySession') + '</div>' + table(agg('sessionId'), t('cost.session')) +
      '<div class="chengBenFu">' + t('cost.byModel') + '</div>' + table(agg('model'), t('cost.model'));

    const btn = $('anNiuChengBenCsv');
    if (btn) {
      btn.onclick = async () => {
        const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
        const lines = ['dimension,key,turns,tokens,cost_cny'];
        for (const [biaoQian, key] of [['session', 'sessionId'], ['model', 'model']]) {
          agg(key).forEach(([k, v]) => lines.push([biaoQian, esc(k), v.turns, v.tokens, v.cost.toFixed(6)].join(',')));
        }
        const rr = await window.warmy.saveText({
          defaultName: 'warmy-cost.csv',
          content: lines.join('\n'),
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (rr && rr.ok) uiAlert(t('instances.saved'));
        else if (rr && rr.error) uiAlert(String(rr.error));
      };
    }
  }

  $('chengBenKaiGuan')?.addEventListener('click', () => {
    const ti = $('chengBenTi');
    if (!ti) return;
    ti.classList.toggle('yinCang');
    $('chengBenKaiGuan').classList.toggle('daKai', !ti.classList.contains('yinCang'));
    if (!ti.classList.contains('yinCang')) renderCostDash();
  });

  async function refreshCheckpoints() {
    const box = $('cpXiangQingLieBiao') || $('cpLieBiao');
    const space = $('cpSpace');
    if (!box) return;
    const r = await window.warmy.checkpointList();
    const list = r?.list || [];
    const maxMb = 50;
    const usedMb = Math.min(maxMb, list.length * 0.5);
    if (space) {
      space.textContent = `${t('checkpoints.used')} ${usedMb.toFixed(1)}MB / ${t('checkpoints.max')} ${maxMb}MB`;
    }
    if (!list.length) {
      box.innerHTML = `<div class="jingYin">${t('checkpoints.empty')}</div>`;
      return;
    }
    const now = Date.now();
    box.innerHTML = list
      .slice(0, 12)
      .map((c) => {
        const d = new Date(c.createdAt);
        const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const when = now - c.createdAt < 86400000 ? hm : d.toLocaleString();
        return `<details class="cpTiaoMu" data-id="${escapeHtml(String(c.id))}">
          <summary>${escapeHtml(String(when))} · ${escapeHtml(String(c.phase || ''))} · ${escapeHtml(String(c.strategy || ''))}</summary>
          <div class="cpTi">
            <div>${t('checkpoints.tasks')}: ${escapeHtml(c.phase || '')}</div>
            <ul>
              <li>${t('checkpoints.changed')}: ${escapeHtml((c.filesChanged || []).map((f) => f.path).join(', ') || '—')}</li>
              <li>${t('checkpoints.created')}: ${escapeHtml((c.filesCreated || []).map((f) => f.path).join(', ') || c.dir)}</li>
              <li>${t('checkpoints.irreversible')}: ${escapeHtml((c.irreversible || []).join(', ') || '—')}</li>
              <li>${t('checkpoints.assets')}: ${escapeHtml((c.assets || []).join(', ') || '—')}</li>
            </ul>
          </div>
          <div class="cpDongZuoJi">
            <button class="anNiuXiao" data-load="${c.id}">${t('checkpoints.stopAndLoad')}</button>
          </div>
        </details>`;
      })
      .join('');
    box.querySelectorAll('[data-load]').forEach((b) => {
      b.onclick = async () => {
        const ok = await uiConfirm(t('checkpoints.confirmBody'), t('checkpoints.confirmTitle'));
        if (!ok) return;
        await window.warmy.checkpointRollback(b.dataset.load);
        uiAlert(t('instances.saved'));
        refreshCheckpoints();
      };
    });
  }

  $('btn-cp-start')?.addEventListener('click', async () => {
    await window.warmy.checkpointCreate('round_start');
    refreshCheckpoints();
  });
  $('btn-cp-end')?.addEventListener('click', async () => {
    await window.warmy.checkpointCreate('round_end');
    refreshCheckpoints();
  });
  $('anNiuCpLieBiao')?.addEventListener('click', refreshCheckpoints);
  async function refreshSessionBoard() {
    const box = $('board-sess-box');
    if (!box || !state.selectedChat) return;
    const r = await window.warmy.boardSession(state.selectedChat.id).catch(() => null);
    const tasks = r?.tasks || [];
    box.innerHTML = tasks.length
      ? tasks.map((t) => '<div>' + escapeHtml(t.biaoTi) + ' · ' + clampPercent(t.jinDu) + '% · ' + escapeHtml(String(t.status || '')) + '</div>').join('')
      : '—';
  }
  /** 卡顿自检：主进程 CPU/事件循环延迟 + 渲染进程帧率 */
  function bindDiagnostics() {
    // 设置页每次重渲染都会产生新的按钮元素，必须每次都重新绑定
    const btn = $('anNiuDiagYunXing');
    if (!btn) return;
    btn.onclick = async () => {
      const out = $('diagShuChu');
      if (!out) return;
      out.textContent = t('diag.running');
      // 渲染进程帧率：统计 500ms 内的 rAF 次数
      const fps = await new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - t0 < 500) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
        };
        requestAnimationFrame(tick);
      });
      const d = await window.warmy.diagnostics().catch(() => null);
      if (!d || !d.ok) {
        out.textContent = '—';
        return;
      }
      const heapMb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      const cell = (k, v) => '<div class="diagCell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
      const bad = d.cpuPercent > 60 || d.loopLagMs > 50 || fps < 30;
      out.innerHTML =
        '<div class="diagGrid">' +
        cell(t('diag.mainCpu'), d.cpuPercent + '%') +
        cell(t('diag.loopLag'), d.loopLagMs + ' ms') +
        cell(t('diag.rss'), d.rssMb + ' MB') +
        cell(t('diag.heap'), heapMb === null ? '—' : heapMb + ' MB') +
        cell(t('diag.fps'), fps + ' fps') +
        cell(t('diag.reqAnim'), d.handles + ' / ' + d.requests) +
        cell(t('diag.uptime'), d.uptimeSec + ' s') +
        '</div>' +
        '<div class="diagVerdict' + (bad ? ' bad' : '') + '">' + t(bad ? 'diag.verdictBad' : 'diag.verdictOk') + '</div>';
    };
  }

  async function renderSkillList() {
    const box = $('jinengLieBiao');
    if (!box) return;
    const importBtn = $('anNiuJinengDaoRu');
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = '1';
      importBtn.onclick = async () => {
        const r = await window.warmy.skillsImport();
        if (r && r.ok) {
          uiAlert(t('settings.skillsImported') + ': ' + r.id);
          renderSkillList();
        } else if (r && r.error) {
          uiAlert(String(r.error));
        }
      };
    }
    try {
      const pr = await window.warmy.skillsPaths();
      const pb = $('jinengLuJingJi');
      if (pb) pb.textContent = t('settings.skillsPaths') + ': ' + ((pr && pr.paths) || []).join('  ·  ');
    } catch {
      /* noop */
    }
    try {
      const r = await window.warmy.skillsList();
      const items = (r && r.skills) || [];
      if (!items.length) {
        box.className = 'jingYin';
        box.textContent = t('settings.skillsEmpty');
        return;
      }
      box.className = '';
      box.innerHTML = items
        .map(
          (s) => `<div class="jinengHang">
            <div class="jinengZhu">
              <div class="jinengMing">${escapeHtml(s.name || s.id)}</div>
              <div class="jingYin jinengMiaoShu">${escapeHtml(s.description || '—')}</div>
              <div class="jingYin jinengSrc">${t('settings.skillFrom')}: ${escapeHtml(s.source || '')}</div>
            </div>
            <button class="anNiuDanger" data-skill-del="${escapeHtml(s.id)}">${t('settings.skillRemove')}</button>
          </div>`
        )
        .join('');
      box.querySelectorAll('[data-skill-del]').forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.skillDel;
          if (!(await uiConfirm(t('settings.skillRemove') + ': ' + id + '?'))) return;
          const rr = await window.warmy.skillsRemove(id);
          if (rr && rr.ok === false) uiAlert(String(rr.error || ''));
          renderSkillList();
        };
      });
    } catch {
      box.className = 'jingYin';
      box.textContent = t('settings.skillsEmpty');
    }
  }

  async function refreshMembers() {
    const box = $('chengYuanJiHe');
    if (!box || !state.selectedChat) return;
    const r = await window.warmy.groupMembers(state.selectedChat.id).catch(() => null);
    const ms = (r && r.members) || [];
    box.innerHTML = ms.length
      ? ms
          .map(
            (x) =>
              '<div class="chengYuanHang" data-mid="' + escapeHtml(String(x.id || x.name)) + '">' +
              '<span class="chengYuanMing">' + escapeHtml(x.name) + ' · ' + escapeHtml(String(x.role || '')) + '</span>' +
              '<button class="anNiuXiao" data-mkick="' + escapeHtml(String(x.id || x.name)) + '">' + t('group.kick') + '</button>' +
              '</div>'
          )
          .join('')
      : '<div class="jingYin">' + t('group.memberEmpty') + '</div>';
    box.querySelectorAll('[data-mkick]').forEach((b) => {
      b.onclick = async () => {
        await window.warmy.groupKick({ groupId: state.selectedChat.id, memberId: b.dataset.mkick });
        refreshMembers();
      };
    });
    // 可选牛马下拉（排除已在群里的）
    const pick = $('chengYuanXuanZe');
    if (pick) {
      const inGroup = new Set(ms.map((x) => x.name));
      const cand = (state.instances || []).filter((i) => !inGroup.has(i.name));
      pick.innerHTML = cand.length
        ? cand.map((i) => '<option value="' + escapeHtml(i.id) + '">' + escapeHtml(i.name) + '</option>').join('')
        : '<option value="">' + t('group.memberEmpty') + '</option>';
    }
  }
  $('anNiuChengYuanTianJia')?.addEventListener('click', async () => {
    const pick = $('chengYuanXuanZe');
    if (!pick || !state.selectedChat) return;
    const instId = pick.value;
    if (!instId) return;
    const inst = (state.instances || []).find((i) => i.id === instId);
    try {
      const r = await window.warmy.groupJoinInstance(state.selectedChat.id, instId);
      if (r && r.ok === false) {
        await window.warmy.groupInvite({ groupId: state.selectedChat.id, ming: (inst && inst.name) || instId });
      }
    } catch {
      await window.warmy.groupInvite({ groupId: state.selectedChat.id, ming: (inst && inst.name) || instId });
    }
    refreshMembers();
  });
  

  // Q. 错误重试
  async function checkLastError() {
    const r = await window.warmy.lastError().catch(() => null);
    if (r?.error) {
      // 简单提示 + 可重试
      const ok = await uiConfirm(t('common.error') + ': ' + r.error.message.slice(0, 80) + ' · ' + t('common.retry'), t('common.error'));
      if (ok && state.selectedChat) {
        await window.warmy.clearError();
        faSong();
      } else {
        await window.warmy.clearError();
      }
    }
  }
  

  // R. 启动引导：让用户「选」语言，而不是手输 yuYan 字符串
  function pickOnboardingLocale() {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('settings.language');
      $('duiHuaKuangTi').innerHTML =
        '<div class="field"><select id="chuShiSheZhiYuYan">' +
        '<option value="zh-CN">' + t('settings.localeZh') + '</option>' +
        '<option value="en-US">' + t('settings.localeEn') + '</option>' +
        '</select></div>';
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'anNiuXiao';
      closeBtn.textContent = t('common.close');
      closeBtn.onclick = () => { root.classList.add('yinCang'); resolve(null); };
      const okBtn = document.createElement('button');
      okBtn.className = 'anNiuZhuYao';
      okBtn.textContent = t('common.ok');
      okBtn.onclick = () => {
        const v = $('chuShiSheZhiYuYan') ? $('chuShiSheZhiYuYan').value : 'zh-CN';
        root.classList.add('yinCang');
        resolve(v);
      };
      acts.append(closeBtn, okBtn);
      root.classList.remove('yinCang');
    });
  }

  async function maybeShowSetup() {
    const st = await window.warmy.setupState().catch(() => null);
    if (!st || st.done) return;
    const pick = await pickOnboardingLocale();
    if (pick) {
      await window.warmy.setupComplete({ yuYan: pick }).catch(() => {});
      if (!state.yuYan.startsWith(String(pick).slice(0, 2))) {
        try { await loadI18n(pick); } catch { /* noop */ }
      }
      await window.warmy.settingsSave({ yuYan: pick }).catch(() => {});
    } else {
      await window.warmy.setupComplete({}).catch(() => {});
    }
  }
  maybeShowSetup();

  async function refreshExecutors() {
    const box = $('zhiXingHe');
    if (!box) return;
    const r = await window.warmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + escapeHtml(String(it.status || '')) + ' · ' + escapeHtml(String(it.durationMs ?? 0)) + 'ms</div>').join('')
      : '—';
  }
  $('anNiuZhiXingYunXing')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.warmy.executorsRunBrief({ brief, contextItems: [] });
    refreshExecutors();
  });
  

  /** 知识库检索：结果可点击跳转（跳到聊天搜索）并可删除 */
  async function runKbQuery(q) {
    const out = $('zhiShiKuShuChu');
    if (!out) return;
    const r = await window.warmy.knowledgeQuery(q).catch(() => null);
    const det = await window.warmy.kbDetail(q).catch(() => null);
    const ents = (r && r.entities) || (det && det.entities) || [];
    const evs = (r && r.events) || [];
    const rows = [];
    ents.forEach((e) => {
      const id = String(e.id || e.name);
      rows.push(
        '<div class="zhiShiKuHang"><button class="zhiShiKuLink" data-kbent="' + escapeHtml(id) + '">' +
          escapeHtml(e.name || id) + '</button><span class="jingYin" style="font-size:11px">' + escapeHtml(String(e.kind || '')) + '</span>' +
          '<button class="anNiuXiao" data-kbdel="entity" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    evs.forEach((e) => {
      const id = String(e.id || e.biaoTi);
      rows.push(
        '<div class="zhiShiKuHang"><button class="zhiShiKuLink" data-kbev="' + escapeHtml(id) + '">' +
          escapeHtml(e.biaoTi || id) + '</button>' +
          '<button class="anNiuXiao" data-kbdel="event" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    out.innerHTML = rows.length ? rows.join('') : '<div class="jingYin">' + t('knowledge.empty') + '</div>';
    // 点击 → 跳到聊天搜索（把关键词带过去）
    out.querySelectorAll('.zhiShiKuLink').forEach((b) => {
      b.onclick = () => {
        const kw = b.textContent || '';
        showSearchPopup();
        setTimeout(() => {
          const inp = $('souSuoPopupShuRu');
          if (!inp) return;
          inp.value = kw;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }, 80);
      };
    });
    // 删除
    out.querySelectorAll('[data-kbdel]').forEach((b) => {
      b.onclick = async () => {
        const kind = b.dataset.kbdel;
        const id = b.dataset.kbid;
        if (!(await uiConfirm(t('knowledge.delete') + ': ' + id + '?'))) return;
        const rr = await window.warmy.kbDelete({ kind, id }).catch(() => null);
        if (rr && rr.ok === false) uiAlert(String(rr.error || ''));
        runKbQuery(q);
      };
    });
  }

  $('anNiuZhiShiKuGo')?.addEventListener('click', () => {
    const q = $('zhiShiKuQ').value.trim();
    if (q) void runKbQuery(q);
  });

  // 加入项目/群聊：扫码或粘贴链接
  $('anNiuJiaRuqr')?.addEventListener('click', async () => {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('join.biaoTi');
    $('duiHuaKuangTi').innerHTML =
      '<div class="jingYin" style="margin-bottom:8px">' + t('join.dropHint') + '</div>' +
      '<input type="file" id="jiaRuqrWenJian" accept="image/*" style="margin-bottom:8px"/>' +
      '<div class="jingYin" style="margin-bottom:8px">' + t('join.scanHint') + '</div>' +
      '<input id="jiaRuLinkShuRu" placeholder="' + t('join.pastePlaceholder') + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"/>' +
      '<div id="jiaRuqrXiaoXi" class="jingYin" style="margin-top:6px"></div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
    ok.textContent = t('join.apply');
    ok.onclick = async () => {
      const link = $('jiaRuLinkShuRu')?.value?.trim();
      if (!link) { $('jiaRuqrXiaoXi').textContent = t('join.qrFail'); return; }
      const r = await window.warmy.joinRequest({
        ming: state.profile.username || 'user',
        kind: 'human',
        target: state.selectedChat?.name || link,
        targetType: state.selectedChat?.kind === 'internal' ? 'project' : 'group',
      }).catch(() => null);
      $('jiaRuqrXiaoXi').textContent = r?.ok ? t('join.ok') : t('join.fail');
      setTimeout(() => root.classList.add('yinCang'), 800);
    };
    acts.append(cancel, ok);
    root.classList.remove('yinCang');
    // 文件选择后提示（完整二维码识别需 jsQR，这里提示粘贴链接）
    $('jiaRuqrWenJian')?.addEventListener('change', () => {
      $('jiaRuqrXiaoXi').textContent = t('join.scanHint');
    });
  });

  $('btn-chat-search')?.addEventListener('click', async () => {
    const q = $('chat-search')?.value?.trim();
    if (!q) return;
    const r = await window.warmy.searchMessages(q).catch(() => null);
    const hits = r?.hits || [];
    pushMsg(state.selectedChat?.id || 'search', 'them', hits.length ? hits.map((x) => x.snippet).join('\n') : t('list.empty'));
    renderChat();
  });
  // T. 消息右键：复制/引用
  $('xiaoXiJi')?.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    e.preventDefault();
    const text = bubble.textContent || '';
    openContextMenu(e.clientX, e.clientY, [
      { biaoQian: t('common.copy'), onClick: () => { navigator.clipboard?.writeText(text); } },
      { biaoQian: t('common.quote'), onClick: () => {
          const inp = $('shuRu');
          if (inp) inp.value = '> ' + text.slice(0, 120) + '\n' + inp.value;
        } },
    ]);
  });
  // W. 定向模式开关（聊天头）
  $('btn-open-win')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.warmy.openChatWindow({
      id: state.selectedChat.id,
      title: state.selectedChat.name,
      kind: state.selectedChat.kind,
    });
  });
  $('btn-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('btn-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const xiaoXi = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.warmy.exportSession({
      title: state.selectedChat.name,
      xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });
  // 托盘 + 热键
  window.warmy.trayInit?.().catch(() => {});
  window.warmy.registerHotkey?.('CommandOrControl+Shift+M').catch(() => {});
  // 从 URL 参数自动打开会话（多窗口）
  try {
    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    if (mode === 'fu') {
      document.getElementById('biaoTiLan')?.classList.add('yinCang');
      document.getElementById('ceLan')?.classList.add('yinCang');
      document.getElementById('lieBiaoLan')?.classList.add('yinCang');
      document.getElementById('appTi')?.classList.add('yinCangLieBiao');
    }
    const cid = q.get('chatId');
    if (cid) {
      const biaoTi = q.get('chatTitle') || cid;
      const kind = q.get('chatKind') || 'single';
      setTimeout(() => openChat(kind, cid, biaoTi), 300);
    }
  } catch { /* noop */ }

  // 主刷新循环：合并所有定时刷新，降低频率
  let __loopTick = 0;
  setInterval(() => {
    __loopTick++;
    if (__loopTick % 2 === 0) raf(refreshMetrics);
    if (__loopTick % 3 === 0) raf(refreshCost);
    if (__loopTick % 4 === 0) raf(refreshExecutors);
    if (__loopTick % 5 === 0) raf(() => { refreshSessionBoard(); refreshMembers(); });
    if (__loopTick % 6 === 0) raf(checkLastError);
    if (__loopTick % 8 === 0) raf(refreshJoinBadge);
    if (__loopTick % 15 === 0) raf(() => window.__saveState?.());
  }, 5000);
  const __mainLoop = true;

  (async () => {
    try {
      await loadI18n(navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US');
    } catch {
      state.yuYan = 'zh-CN';
      state.t = { 'yingYong.zhName': '无限牛马', 'yingYong.enName': 'WArmy', 'yingYong.subtitle': 'Workhorse Army', 'yingYong.displayName': '无限牛马' };
      applyI18n();
    }
    try {
      const s = await window.warmy.settingsGet();
      if (s?.settings) {
        state.themeMode = s.settings.themeMode || 'system';
        state.theme = s.settings.accent || state.theme;
        state.sound = s.settings.sound || state.sound;
        state.soundFiles = s.settings.soundFiles || state.soundFiles;
        state.emailOnRequest = !!s.settings.emailOnRequest;
        state.globalSecurity = s.settings.globalSecurity || 'normal';
        state.embedUseGpu = s.settings.embedUseGpu !== false;
        document.documentElement.style.setProperty('--accent', state.theme);
      }
      const p = await window.warmy.profileGet();
      if (p?.profile) {
        state.profile.username = p.profile.username || state.profile.username;
        state.profile.email = p.profile.email || '';
        state.profile.avatarDataUrl = p.profile.avatarDataUrl || '';
        state.profile.deviceId = p.profile.deviceId || '';
      }
    } catch {
      /* noop */
    }
    applyThemeMode(state.themeMode);
    applyAvatar();
    try {
      state.globalSecurity = (await window.warmy.securityMode()) || state.globalSecurity;
      state.hardware = await window.warmy.hardware();
      state.instances = (await window.warmy.listInstances()) || [];
    } catch {
      /* noop */
    }
    if (!state.instances.length) {
      state.instances = [
        {
          id: 'demo-1',
          ming: 'demo.agent',
          notify: true,
          status: 'stopped',
          dutyEligible: true,
          model: 'deepseek-chat',
          memoryFile: 'persona/main.md',
          persona: 'instances.personaDefault',
        },
      ];
    }
    // 老实例缺头像时补一个稳定的预设（按 id 派生，重启后不变）
    state.instances.forEach((i) => {
      if (!i.avatarPreset && !i.avatarDataUrl) {
        let h = 0;
        const s = String(i.id || i.name || '');
        for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) % 100000;
        i.avatarPreset = 1 + (h % PRESET_AVATARS.length);
      }
    });
    // E. 加载持久化状态
    try {
      const st = await window.warmy.stateLoad();
      if (st?.state) {
        if (Array.isArray(st.state.chaJianJi) && st.state.chaJianJi.length) state.chaJianJi = st.state.chaJianJi;
        if (Array.isArray(st.state.groups) && st.state.groups.length) state.groups = st.state.groups;
        if (Array.isArray(st.state.chats) && st.state.chats.length) state.chats = st.state.chats;
        if (st.state.listSort === 'ming' || st.state.listSort === 'time') state.listSort = st.state.listSort;
        const av = st.state.instanceAvatars;
        if (av && typeof av === 'object') {
          state.instances.forEach((i) => {
            const one = av[i.id];
            if (one) {
              if (one.avatarPreset) i.avatarPreset = one.avatarPreset;
              if (one.avatarDataUrl) i.avatarDataUrl = one.avatarDataUrl;
            }
          });
        }
      }
    } catch { /* noop */ }
    // 群列表以主进程落盘存储为准（避免界面与存储分叉）
    await syncGroupsFromStore();
    // 变更时保存
    const saveState = () => {
      const instanceAvatars = {};
      state.instances.forEach((i) => {
        if (i.avatarPreset || i.avatarDataUrl) {
          instanceAvatars[i.id] = { avatarPreset: i.avatarPreset || 0, avatarDataUrl: i.avatarDataUrl || '' };
        }
      });
      window.warmy.stateSave({
        chaJianJi: state.chaJianJi,
        groups: state.groups,
        chats: state.chats,
        instanceAvatars,
        listSort: state.listSort,
      }).catch(() => {});
    };
    window.__saveState = saveState;
    
    setNav('singleAi');
    // 默认选中第一个聊天
    setTimeout(() => {
      const first = state.instances[0] || state.chats.find((x) => x.kind === 'single');
      if (first) openChat('single', first.id, first.name);
    }, 100);
    refreshMetrics();
    refreshExecutors();
  })();
})();
