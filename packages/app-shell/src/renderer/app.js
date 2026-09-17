/* CCArmy renderer — 文案全在 i18n；主题/分栏/模型拉取/附件/语音/总看板 */
(() => {
  const $ = (id) => document.getElementById(id);
  let pendingAvatarTarget = null;
  const state = {
    nav: 'singleAi',
    locale: 'zh-CN',
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
    profile: { loggedIn: false, username: 'nav.avatar', avatarDataUrl: '', email: '', deviceId: '', avatarPreset: 0 },
    queues: {},
    board: {
      /** ADR：外部聚合看板 — 会话进展只读，点击跳转；值班者写 board.jsonl */
      sessions: [
        { id: 's-internal-1', kind: 'internal', name: 'demo.project1', progress: 65, status: 'doing', blocked: false, notify: true },
        { id: 's-internal-2', kind: 'internal', name: 'demo.project2', progress: 30, status: 'doing', blocked: true },
        { id: 's-ext-1', kind: 'extgroup', name: 'demo.client', progress: 90, status: 'doing', blocked: false },
        { id: 's-single-demo-1', kind: 'single', name: 'demo.agent', progress: 40, status: 'doing', blocked: false },
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
    plugins: [
      {
        id: 'agent-teams',
        name: '@nanmicoder/dsh-agent-teams',
        enabled: true,
        desc: 'plugin.teams.desc',
      },
      {
        id: 'memory-plus',
        name: 'dsh-memory-bundle',
        enabled: true,
        desc: 'plugin.memory.desc',
      },
    ],
    providers: [
      {
        id: 'deepseek',
        label: 'DeepSeek',
        protocol: 'openai-compatible',
        baseURL: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        apiKey: '',
        models: [],
      },
      {
        id: 'ollama',
        label: 'Ollama',
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
    // .urg-menu 的 CSS 带 bottom:calc(100% + 6px)，不清掉会与 top 冲突、菜单被拉出视口
    menu.style.bottom = 'auto';
    menu.style.right = 'auto';
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
    state.t['app.displayName'] || (state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName'));
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
  function uiAlert(message, title) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = title || displayName();
      $('modal-body').textContent = String(message ?? '');
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.add('hidden');
        resolve(true);
      };
      acts.appendChild(ok);
      root.classList.remove('hidden');
      ok.focus();
    });
  }

  function uiConfirm(message, title) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = title || displayName();
      $('modal-body').textContent = String(message ?? '');
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('hidden');
        resolve(false);
      };
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.remove('hidden');
        resolve(true);
      };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
      ok.focus();
    });
  }

  /** 强制倒计时确认（危险操作） */
  function uiConfirmCountdown(message, title, seconds = 5) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = title || displayName();
      $('modal-body').textContent = String(message ?? '');
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); clearInterval(timer); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'btn-danger';
      ok.disabled = true;
      let left = seconds;
      const label = () => (t('urgency.confirmWait') || 'wait {s}s').replace('{s}', String(left));
      ok.textContent = label();
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          ok.disabled = false;
          ok.textContent = t('common.ok');
        } else {
          ok.textContent = label();
        }
      }, 1000);
      ok.onclick = () => { if (ok.disabled) return; root.classList.add('hidden'); clearInterval(timer); resolve(true); };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
    });
  }

  function uiPrompt(message, defaultValue, title) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = title || displayName();
      $('modal-body').innerHTML = '';
      const p = document.createElement('div');
      p.textContent = String(message ?? '');
      const input = document.createElement('input');
      input.style.cssText = 'width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--input-bg);color:var(--ink);font:inherit';
      input.value = defaultValue ?? '';
      $('modal-body').append(p, input);
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('hidden');
        resolve(null);
      };
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.add('hidden');
        resolve(input.value);
      };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
      input.focus();
      input.select();
      input.onkeydown = (e) => {
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
      const root = $('modal-root');
      $('modal-title').textContent = t('avatar.pickTitle');
      const body = $('modal-body');
      body.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'avatar-grid';
      list.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'avatar-choice' + (Number(currentPreset) === i + 1 ? ' on' : '');
        b.title = labelOf(i);
        const im = document.createElement('img');
        im.src = src;
        im.alt = labelOf(i);
        b.appendChild(im);
        b.onclick = () => {
          root.classList.add('hidden');
          resolve({ type: 'preset', preset: i + 1 });
        };
        grid.appendChild(b);
      });
      body.appendChild(grid);
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const localBtn = document.createElement('button');
      localBtn.className = 'btn-mini';
      localBtn.textContent = t('avatar.local');
      localBtn.onclick = () => {
        root.classList.add('hidden');
        resolve({ type: 'local' });
      };
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => {
        root.classList.add('hidden');
        resolve(null);
      };
      acts.append(localBtn, cancel);
      root.classList.remove('hidden');
    });
  }

  function applyAvatar() {
    const img = $('selfAvatarImg');
    const span = $('selfAvatar');
    const src = personAvatarSrc(state.profile);
    if (src) {
      img.src = src;
      img.classList.remove('hidden');
      span.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      span.classList.remove('hidden');
      span.textContent = (state.profile.username || t('nav.avatar')).slice(0, 1);
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
    window.ccarmy.settingsSave({ accent: color });
  }

  /** 自定义主题色：调色板 + 预览 + 取消/确定 */
  function pickCustomAccent() {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('settings.themeCustomTitle');
      const body = $('modal-body');
      body.innerHTML = `<div class="theme-picker-body">
        <input type="color" id="theme-picker-input" value="${escapeHtml(state.theme || '#c45c26')}"/>
        <div class="theme-picker-preview">
          <span class="swatch" id="theme-picker-swatch"></span>
          <span class="muted" id="theme-picker-hex"></span>
        </div>
        <div class="muted">${t('settings.themePreview')}</div>
      </div>`;
      const input = $('theme-picker-input');
      const swatch = $('theme-picker-swatch');
      const hex = $('theme-picker-hex');
      const sync = () => {
        if (!input) return;
        const v = String(input.value || '#000000');
        swatch.style.background = v;
        const n = parseInt(v.slice(1), 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        hex.textContent = v.toUpperCase() + '   rgb(' + r + ', ' + g + ', ' + b + ')';
      };
      if (input) {
        input.oninput = sync;
        input.onchange = sync;
      }
      sync();
      // 打开弹窗即直接弹出系统调色板，不需要再点一次色块
      if (input) {
        setTimeout(() => {
          try {
            if (typeof input.showPicker === 'function') input.showPicker();
            else input.click();
          } catch {
            try { input.click(); } catch { /* noop */ }
          }
        }, 60);
      }
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); resolve(null); };
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = t('common.ok');
      ok.onclick = () => { root.classList.add('hidden'); resolve(input ? input.value : null); };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
    });
  }

  function renderThemeSwatches() {
    const box = $('theme-swatches');
    if (!box || box.dataset.filled === '1') return;
    box.innerHTML = accentPalette()
      .map((col) => `<button data-c="${col}" style="background:${col}" title="${col}"></button>`)
      .join('');
    box.dataset.filled = '1';
  }

  function saveProfile() {
    window.ccarmy.profileSave({
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
      window.ccarmy.trayTooltip?.({
        text: `${t('brand.name')} ${t('brand.sub')}`,
        offWork: t('tray.offWork'),
        header: t('export.header'),
        me: t('export.me'),
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
    $('logo-name').textContent = displayName();
    $('logo-sub').textContent = t('app.subtitle');
    if ($('tb-brand')) $('tb-brand').textContent = displayName();
        applyAvatar();
    document.title = displayName();
    syncTrayText();
  }

  async function loadI18n(locale) {
    const pack = await window.ccarmy.i18n(locale);
    state.locale = pack.locale;
    state.t = pack.strings;
    if (pack.displayName) state.t['app.displayName'] = pack.displayName;
    window.__refreshUrgency?.();
    window.__refreshSecurity?.();
    applyI18n();
  }

  function applyThemeMode(mode) {
    state.themeMode = mode;
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
      window.ccarmy?.setThemeSource?.('system');
    } else {
      root.setAttribute('data-theme', mode);
      window.ccarmy?.setThemeSource?.(mode);
    }
  }

  const NAV_TITLES = {
    me: 'nav.avatar',
    singleAi: 'nav.singleAi',
    internalGroup: 'nav.internalGroup',
    externalChat: 'nav.externalChat',
    externalGroup: 'nav.externalGroup',
    instances: 'nav.instances',
    settings: 'nav.settings',
  };
  const CHAT_NAVS = new Set(['singleAi', 'internalGroup', 'externalChat', 'externalGroup']);

  function hideMain() {
    $('empty-state').classList.add('hidden');
    $('chat-layout').classList.add('hidden');
    $('page-layout').classList.add('hidden');
    $('inst-detail').classList.add('hidden');
  }

  function setNav(nav) {
    state.nav = nav;
    document.querySelectorAll('.rail-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === nav);
    });
    hideMain();
    // 顶部横幅依赖「会话是否可见」，等同步流程走完（本函数各分支的 return）再重算
    requestAnimationFrame(() => renderNetBanner());

    if (nav === 'settings' || nav === 'me') {
      $('app-body').classList.add('hide-list');
      $('page-layout').classList.remove('hidden');
      $('page-layout').classList.toggle('settings-mode', nav === 'settings');
      renderPage();
      return;
    }
    $('page-layout').classList.remove('settings-mode');

    $('app-body').classList.remove('hide-list');
    const lt = $('list-title');
    lt.textContent = t(NAV_TITLES[nav] || nav);
    // 我的牛马：列表头右侧加牛马管理局图标
    const headActions = $('list-head-actions');
    const oldIcon = headActions?.querySelector('.list-hq-icon');
    if (oldIcon) oldIcon.remove();
    if (nav === 'singleAi' && headActions) {
      const icon = document.createElement('button');
      icon.className = 'list-hq-icon';
      icon.title = t('nav.instances');
      icon.innerHTML = '<svg viewBox="0 0 100 100" style="width:18px;height:18px"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>';
      icon.onclick = () => setNav('instances');
      headActions.insertBefore(icon, headActions.firstChild);
    }
    setupListAction();
    renderList();

    if (nav === 'instances') {
      if (!state.selectedInstance) {
        $('empty-state').classList.remove('hidden');
        $('logo-sub').textContent = t('instances.selectHint');
      } else {
        $('inst-detail').classList.remove('hidden');
        renderInstanceDetail();
      }
      return;
    }

    $('logo-sub').textContent = t('app.subtitle');

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
      $('chat-layout').classList.add('hidden');
      $('empty-state').classList.remove('hidden');
    } else {
      $('empty-state').classList.add('hidden');
      $('chat-layout').classList.remove('hidden');
      renderChat();
      renderQueueBar();
    }
  }

  /** 我的牛马候选列表：优先真实会话，没有会话时用实例兜底 */
  /** 列表排序：按时间（默认，最近有消息在上）或按名称 */
  function sortList(list) {
    const arr = list.slice();
    if (state.listSort === 'name') {
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
    return state.instances.map((i) => ({ id: i.id, name: i.name, kind: 'single', lastTs: 0 }));
  }

  /** 某个列表页的候选会话列表（用于自动打开第一个） */
  function listItemsFor(nav) {
    if (nav === 'singleAi') return singleChatItems();
    if (nav === 'externalChat') {
      return sortList(state.chats.filter((c) => c.kind === 'extdm'))
        .map((c) => ({ id: c.id, name: c.name, kind: 'extdm' }));
    }
    const type = nav === 'internalGroup' ? 'internal' : 'external';
    return sortList(state.groups.filter((g) => g.type === type))
      .map((g) => ({ id: g.id, name: g.name, kind: g.type === 'internal' ? 'internal' : 'extgroup' }));
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
    const btn = $('list-action');
    const joinBtn = $('btn-join-qr');
    // 项目/群聊/联系人：显示扫码加入
    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('hidden', !showJoin);
      if (state.nav === 'internalGroup') joinBtn.textContent = t('nav.addProject');
      else if (state.nav === 'externalGroup') joinBtn.textContent = t('nav.addGroup');
      else if (state.nav === 'externalChat') joinBtn.textContent = t('contact.add');
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.title = t(createKey);
      btn.classList.remove('hidden');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      btn.textContent = t('contact.add');
      btn.title = t('contact.add');
      btn.classList.remove('hidden');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');
      btn.title = t('list.addInstance');
      btn.classList.remove('hidden');
      btn.onclick = addInstanceFlow;
    } else {
      btn.classList.add('hidden');
      btn.onclick = null;
    }
  }

  function row(name, sub, ch, onClick, active, avatarSrc) {
    const el = document.createElement('div');
    el.className = 'list-item' + (active ? ' active' : '');
    if (avatarSrc) el.dataset.av = '1';
    el.innerHTML = `${avatarSrc ? `<img class="av-img" src="${escapeHtml(avatarSrc)}" alt=""/>` : `<div class="av">${escapeHtml(ch || '?')}</div>`}<div class="meta"><div class="name">${escapeHtml(name)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    el.title = `${name}\n${sub}`;
    el.onclick = onClick;
    return el;
  }

  /** 列表行上的「身份变更待核实」常驻标记（附六：三个入口都能看到） */
  function attachIdChangeMark(rowEl) {
    if (!rowEl || rowEl.querySelector('.id-change-mark')) return rowEl;
    const m = document.createElement('span');
    m.className = 'id-change-mark';
    m.setAttribute('data-idchg-mark', '1');
    m.textContent = '! ' + t('idchg.pending');
    m.title = t('idchg.title') + ' · ' + t('idchg.marker');
    rowEl.appendChild(m);
    return rowEl;
  }

  /**
   * R12：停用（stopped）的牛马实例 → 整行灰 + 名字删除线（灰仍须可读，见 --ink-dim）。
   * R11 在成员列表里，列表行这里只处理实例自身的停用态。
   */
  function applyInstanceRowState(rowEl, inst, sessionKind) {
    if (!rowEl || !inst) return rowEl;
    if (inst.status === 'stopped') {
      rowEl.classList.add('is-disabled');
      const nm = rowEl.querySelector('.name');
      if (nm) nm.classList.add('struck');
      const b = document.createElement('span');
      b.className = 'row-badge off';
      b.setAttribute('data-state', 'disabled');
      b.textContent = t('group.memberDisabled');
      rowEl.appendChild(b);
    }
    if (sessionKind && hasPendingIdChange(sessionKind, inst.id)) attachIdChangeMark(rowEl);
    return rowEl;
  }

  function renderList() {
    const q = ($('list-search').value || '').trim().toLowerCase();
    const box = $('list-body');
    box.innerHTML = '';

    if (state.nav === 'instances') {
      const hw = state.hardware || { cpus: '—', suggested: '—', max: '—' };
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `<h4>${t('instances.hardware')}</h4>
        <div class="muted">${t('instances.cpus')}: <b>${escapeHtml(String(hw.cpus ?? '—'))}</b></div>
        <div class="muted">${t('instances.suggested')}: <b>${escapeHtml(String(hw.suggested ?? '—'))}</b></div>
        <div class="muted">${t('instances.max')}: <b>${escapeHtml(String(hw.max ?? '—'))}</b></div>`;
      box.appendChild(card);
      state.instances
        .filter((i) => !q || (i.name || '').toLowerCase().includes(q))
        .forEach((inst) => {
          const rowEl = row(
            inst.name || inst.id,
            inst.status === 'running' ? t('instances.running') : t('instances.stopped'),
            (inst.name || 'A')[0],
            () => {
              state.selectedInstance = inst;
              hideMain();
              $('inst-detail').classList.remove('hidden');
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
          applyInstanceRowState(rowEl, inst, 'single');
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
        : state.instances.map((i) => ({ id: i.id, name: i.name, kind: 'single', lastPreview: t('list.noReply') }));
      if (!source.length) {
        // 一个实例都没有 → 显示「进入牛马管理局」按钮
        box.innerHTML = `<div class="enter-hq-wrap">
          <div class="muted">${t('list.empty')}</div>
          <button class="enter-hq-btn" id="btn-enter-hq">
            <svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>
            <span>${t('nav.instances')}</span>
          </button>
        </div>`;
        $('btn-enter-hq')?.addEventListener('click', () => setNav('instances'));
        return;
      }
      source.forEach((c) => {
        const inst = state.instances.find((x) => x.id === c.id);
        const rowEl = row(
          c.name,
          c.lastPreview || t('list.noReply'),
          c.name[0],
          () => openChat('single', c.id, c.name),
          state.selectedChat?.id === c.id,
          inst ? instanceAvatarSrc(inst) : null
        );
        const menuInst = inst || { id: c.id, name: c.name, status: 'stopped', notify: true };
        bindRowContext(rowEl, () => agentMenu(menuInst, rowEl));
        applyInstanceRowState(rowEl, inst, 'single');
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const items = sortList(state.groups.filter((g) => g.type === type).filter((g) => !q || g.name.toLowerCase().includes(q)));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((g) => {
        const rowEl = row(
          g.name,
          `${t('group.type.' + g.type)} · ${g.members?.length || 0}`,
          g.name[0],
          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),
          state.selectedChat?.id === g.id
        );
        bindRowContext(rowEl, () => groupMenu(g, rowEl));
        if (hasPendingIdChange(g.type === 'internal' ? 'internal' : 'extgroup', g.id)) attachIdChangeMark(rowEl);
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'externalChat') {
      const items = sortList(state.chats.filter((c) => c.kind === 'extdm').filter((c) => !q || c.name.toLowerCase().includes(q)));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((c) => {
        const rowEl = row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, c.name), state.selectedChat?.id === c.id);
        if (hasPendingIdChange('extdm', c.id)) attachIdChangeMark(rowEl);
        box.appendChild(rowEl);
      });
    }
  }

  function openChat(kind, id, name) {
    state.selectedChat = { kind, id, name };
    hideMain();
    $('chat-layout').classList.remove('hidden');
    $('chat-title').textContent = name;
    $('chat-meta').textContent =
      kind === 'internal' ? t('group.type.internal') : kind.includes('ext') ? t('group.type.external') : t('nav.singleAi');
        window.__refreshSecurity?.();
    state.attachments = [];
    renderAttach();
    renderChat();
    renderQueueBar();
    renderList();
    updatePanelVisibility();
    renderModelMgr();
    // 附六：「下次进该会话」要重新出现（关闭只是暂时隐藏）
    void idRefreshForChat();
  }

  function renderChat() {
    const box = $('messages');
    box.innerHTML = '';
    const msgs = (state.selectedChat && window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    msgs.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'msg' + (m.role === 'me' ? ' me' : '');
      const av = state.profile.avatarDataUrl
        ? `<img class="avatar-img" src="${state.profile.avatarDataUrl}" alt=""/>`
        : `<div class="av">${escapeHtml((state.profile.username || t('nav.avatar')).slice(0, 1))}</div>`;
      div.innerHTML = `${m.role === 'me' ? av : `<div class="av">${escapeHtml((state.selectedChat?.name || 'A')[0])}</div>`}<div class="bubble">${escapeHtml(m.text)}</div>`;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
    $('duty-info').textContent = state.selectedChat ? state.selectedChat.name : '—';
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
    const bar = $('queue-bar');
    const list = $('queue-items');
    if (!state.selectedChat) {
      bar.classList.add('hidden');
      return;
    }
    const q = queueOf(state.selectedChat.id);
    if (!q.length) {
      bar.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    $('queue-count').textContent = String(q.length);
    list.innerHTML = '';
    q.forEach((item, idx) => {
      const li = document.createElement('li');
      const tag = item.u === 'P2' ? t('chat.p2') : t('chat.p3');
      li.innerHTML = `<span class="q-tag">${escapeHtml(tag)}</span>`;
      if (item.editing) {
        const ta = document.createElement('textarea');
        ta.value = item.text;
        const save = document.createElement('button');
        save.className = 'btn-mini';
        save.textContent = t('chat.queueSave');
        const del = document.createElement('button');
        del.className = 'btn-mini';
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
        span.className = 'q-text';
        span.textContent = item.text;
        const edit = document.createElement('button');
        edit.className = 'btn-mini';
        edit.textContent = t('chat.queueEdit');
        const del = document.createElement('button');
        del.className = 'btn-mini';
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
    const el = $('attach-list');
    if (!state.attachments.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = state.attachments
      .map(
        (a, i) =>
          `<span class="attach-chip">${escapeHtml(a.name)} <button data-i="${i}" title="${escapeHtml(t('chat.queueDelete'))}">×</button></span>`
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
          window.ccarmy.stopInstance(inst.id);
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

  async function send() {
    const text = $('input').value.trim();
    if (!text || !state.selectedChat) return;
    const id = state.selectedChat.id;
    const u = state.urgency;
    const attachNote = state.attachments.length
      ? `\n[${state.attachments.map((a) => a.name).join(', ')}]`
      : '';
    const full = text + attachNote;

    if (u === 'P2' || u === 'P3') {
      queueOf(id).push({ id: 'q-' + Date.now(), text: full, u, editing: false });
      $('input').value = '';
      state.attachments = [];
      renderAttach();
      renderQueueBar();
      return;
    }

    pushMsg(id, 'me', full);
    $('input').value = '';
    state.attachments = [];
    renderAttach();
    renderChat();

    // 内部群：值班编排闭环
    if (state.selectedChat.kind === 'internal') {
      try {
        const r = await window.ccarmy.groupOrchestrate({
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
      window.ccarmy.checkpointAuto?.('round_end');
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
      const r = await window.ccarmy.chatSend({
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
    window.ccarmy.checkpointAuto?.('round_end');
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
      pushMsg(chatId, 'me', item.text);
      pushMsg(chatId, 'them', `[${item.u === 'P2' ? t('chat.p2') : t('chat.p3')}] ${item.text.slice(0, 30)}…`);
    }
    renderQueueBar();
    renderChat();
  }

  async function renderDashboard(host) {
    let sessions = state.board.sessions;
    let events = state.board.events;
    try {
      const agg = await window.ccarmy.boardAggregate();
      const ev = await window.ccarmy.boardEvents();
      if (agg?.ok && agg.sessions?.length) {
        sessions = agg.sessions.map((s) => ({
          id: s.groupId,
          kind: 'internal',
          name: s.groupId,
          progress: s.avgProgress,
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
          title: e.title + (typeof e.progress === 'number' ? ` → ${e.progress}%` : ''),
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
      <h1>${t('dashboard.title')}</h1>
      <p class="board-hint">${t('dashboard.readOnlyHint')}</p>
      <div class="dash-grid">
        <div class="dash-card"><div class="muted">${t('dashboard.tasks')}</div><div class="stat">${escapeHtml(String(doing ?? 0))}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.done')}</div><div class="stat">${escapeHtml(String(done ?? 0))}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.agents')}</div><div class="stat">${escapeHtml(String(running ?? 0))}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.queue')}</div><div class="stat">${escapeHtml(String(queued ?? 0))}</div></div>
      </div>
      <div class="set-card" style="margin-bottom:16px">
        <h2 style="margin:0 0 10px;font-size:14px">${t('dashboard.sessions')}</h2>
        <div id="board-sessions"></div>
      </div>
      <div class="set-card">
        <h2 style="margin:0 0 10px;font-size:14px">${t('panel.board')} · ${t('dashboard.recent')}</h2>
        <div id="board-events"></div>
      </div>`;

    const sess = $('board-sessions');
    sessions.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'board-session';
      el.title = t('dashboard.jump');
      el.innerHTML = `
        <div class="bs-name">${escapeHtml(t(s.name))}</div>
        <span class="bs-type">${escapeHtml(typeLabel(s.kind))}</span>
        <div class="bs-prog">
          <div class="progress"><div class="progress-bar" style="width:${clampPercent(s.progress)}%"></div></div>
          <div class="muted" style="margin-top:2px">${t('dashboard.progressLabel')} ${clampPercent(s.progress)}%${s.blocked ? ' · ' + t('dashboard.blocked') : ''}</div>
        </div>
        <span class="bs-status">${t('dashboard.jump')} →</span>`;
      el.onclick = () => {
        const kind = s.kind === 'single' ? 'single' : s.kind === 'internal' ? 'internal' : 'extgroup';
        const nav = kind === 'single' ? 'singleAi' : kind === 'internal' ? 'internalGroup' : 'externalGroup';
        if (kind !== 'single' && !state.groups.find((g) => g.id === s.id)) {
          state.groups.push({ id: s.id, name: t(s.name), type: kind, members: [] });
        }
        setNav(nav);
        openChat(kind, s.id, t(s.name));
      };
      sess.appendChild(el);
    });

    const evBox = $('board-events');
    [...events]
      .sort((a, b) => b.ts - a.ts)
      .forEach((e) => {
        const d = document.createElement('div');
        d.className = 'board-event';
        d.innerHTML = `<span class="ev-tag">${escapeHtml(evLabel(e.action))}</span>
          <div><div>${escapeHtml(t(e.title))}</div>
          <div class="muted">${escapeHtml(t(e.session))} · ${new Date(e.ts).toLocaleString()}</div></div>`;
        evBox.appendChild(d);
      });
  }

  function renderInstanceDetail() {
    const inst = state.selectedInstance;
    if (!inst) return;
    const box = $('inst-detail');
    box.innerHTML = `
      <h1>${escapeHtml(inst.name || inst.id)}</h1>
      <div class="set-card" style="max-width:720px">
        <div class="profile-head" style="align-items:center;gap:14px">
          <button id="i-av-btn" class="av-btn" title="${escapeHtml(t('avatar.pickTitle'))}">
            <img class="avatar-img big" src="${instanceAvatarSrc(inst)}" alt=""/>
          </button>
          <div style="flex:1">
            <div class="field"><label>${t('instances.name')}</label><input id="i-name" value="${escapeHtml(inst.name || '')}"/></div>
          </div>
        </div>

        <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.cognition')}</h3>
        <div class="muted" style="margin-bottom:8px">${t('instances.cognitionHint')}</div>
        <div id="i-cog-list"></div>
        <div style="margin-top:8px">
          <button class="btn-mini" id="i-cog-add">${t('instances.cognitionAdd')}</button>
        </div>
        <div class="field" style="margin-top:12px">
          <label>${t('instances.persona')}</label>
          <textarea id="i-persona" placeholder="${escapeHtml(t('instances.personaPlaceholder'))}">${escapeHtml(inst.persona || '')}</textarea>
        </div>
        <div class="set-card hidden" style="margin-top:14px" id="i-modelcfg">
          <h3 style="margin:0 0 10px;font-size:13px">${t('instances.defaultModel')}</h3>
          <div class="inst-row">
            <div class="field">
              <label>${t('instances.defaultModel')}</label>
              <select id="i-default-model">
                <option value="__smart__">${t('instances.smartPick')}</option>
                ${(inst.availableModels || []).map((m) => '<option value="' + escapeHtml(m) + '"' + (inst.defaultModel === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('')}
              </select>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.availableModels')}</h3>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="i-all-models" ${inst.allModels !== false ? 'checked' : ''}/> ${t('instances.allAvailable')}
          </label>

          <div id="i-manual" class="${inst.allModels !== false ? 'hidden' : ''}">
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="i-prov-pick" size="6">${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>').join('')}</select>
              <select id="i-model-pick" size="6"></select>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
              <button class="btn-mini" id="i-add-model">${t('instances.addModel')}</button>
              <button class="btn-mini" id="i-del-model">${t('settings.removeModel')}</button>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">${t('instances.fallbackChain')}</h3>
          <div id="i-chain"></div>
        </div>
        <div class="inst-row" style="margin-top:14px">
          <button class="btn-primary" id="i-save" title="${escapeHtml(t('common.save'))}">${t('common.save')}</button>
          <button class="btn-mini" id="i-start" title="${escapeHtml(t('instances.start'))}">${t('instances.start')}</button>
          <button class="btn-mini" id="i-stop" title="${escapeHtml(t('instances.stop'))}">${t('instances.stop')}</button>
          <button class="btn-danger" id="i-del" title="${escapeHtml(t('instances.delete'))}">${t('instances.delete')}</button>
          <span class="badge ${inst.status === 'running' ? '' : 'off'}">${inst.status === 'running' ? t('instances.running') : t('instances.stopped')}</span>
        </div>
      </div>`;
    $('i-save').onclick = () => {
      inst.name = $('i-name').value.trim() || inst.name;
      inst.model = $('i-model').value.trim();
      inst.memoryFile = $('i-mem').value.trim();
      inst.persona = $('i-persona').value;
      renderList();
    };
    $('i-start').onclick = async () => {
      try {
        const dsh = await window.ccarmy.dshAvailable().catch(() => ({ ok: false }));
        let r;
        if (dsh?.ok) {
          r = await window.ccarmy.spawnDshInstance({ id: inst.id, name: inst.name });
        } else {
          r = await window.ccarmy.spawnInstance({ id: inst.id, name: inst.name, dutyEligible: true });
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
    $('i-stop').onclick = async () => {
      try {
        await window.ccarmy.stopInstance(inst.id);
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
      const list = $('i-cog-list');
      function renderCog() {
        if (!list) return;
        list.innerHTML =
          inst.cognitionFiles
            .map(
              (f, i) =>
                '<div class="inst-row" style="margin:4px 0"><span style="flex:1">' +
                escapeHtml(f.name) +
                '</span><span class="muted">' + escapeHtml(String(f.size || 0)) + ' B</span>' +
                '<button class="btn-mini" data-cog-del="' + i + '">' + t('mesh.remove') + '</button></div>'
            )
            .join('') || '<div class="muted">' + t('instances.cognitionEmpty') + '</div>';
        list.querySelectorAll('[data-cog-del]').forEach((b) => {
          b.onclick = () => {
            inst.cognitionFiles.splice(Number(b.dataset.cogDel), 1);
            renderCog();
          };
        });
      }
      renderCog();

      $('i-av-btn')?.addEventListener('click', async () => {
        const r = await pickAvatar(PRESET_AVATARS, inst.avatarPreset, (i) => t('avatar.preset.' + (i + 1)));
        if (!r) return;
        if (r.type === 'local') {
          pendingAvatarTarget = { kind: 'instance', inst };
          $('avatar-file').click();
          return;
        }
        inst.avatarPreset = r.preset;
        inst.avatarDataUrl = '';
        renderInstanceDetail();
        window.__saveState?.();
      });

      $('i-cog-add')?.addEventListener('click', async () => {
        const r = await window.ccarmy.pickFile({ filters: ['md'] });
        if (!r?.ok) return;
        const name = r.path.split(/[\\/]/).pop();
        inst.cognitionFiles.push({ name, path: r.path, size: 0 });
        renderCog();
      });
    })();

    (function bindModelConfig() {
      if (!$('i-modelcfg') || $('i-modelcfg').classList.contains('hidden')) return;
      const inst2 = inst;
      if (!inst2.availableModels) inst2.availableModels = [];
      if (inst2.allModels === undefined) inst2.allModels = true;
      if (!inst2.chain) inst2.chain = [...inst2.availableModels];

      const defSel = $('i-default-model');
      const allChk = $('i-all-models');
      const allList = $('i-all-list');
      const manual = $('i-manual');
      const provPick = $('i-prov-pick');
      const modelPick = $('i-model-pick');
      const chainBox = $('i-chain');

      function renderChain() {
        if (!chainBox) return;
        const list = inst2.chain || [];
        chainBox.innerHTML =
          list
            .map(
              (m, i) =>
                '<div class="inst-row" style="margin:4px 0">' +
                '<span style="flex:1">' + escapeHtml(m) + '</span>' +
                '<button class="btn-mini" data-up="' + i + '">' + t('instances.moveUp') + '</button>' +
                '<button class="btn-mini" data-down="' + i + '">' + t('instances.moveDown') + '</button>' +
                '</div>'
            )
            .join('') || '<div class="muted">' + t('settings.modelsEmpty') + '</div>';
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
          manual?.classList.toggle('hidden', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.label + ' · ' + m));
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
        return p.label + ' · ' + m;
      }

      function updateAddDelState() {
        const full = selectedFull();
        const inChain = full && (inst2.chain || []).includes(full);
        const addBtn = $('i-add-model');
        const delBtn = $('i-del-model');
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

      $('i-add-model')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.availableModels = [...new Set([...(inst2.availableModels || []), full])];
        inst2.chain = [...new Set([...(inst2.chain || []), full])];
        const sel = $('i-default-model');
        if (sel && ![...sel.options].some((o) => o.value === full)) {
          const opt = document.createElement('option');
          opt.value = full;
          opt.textContent = full;
          sel.appendChild(opt);
        }
        renderChain();
        updateAddDelState();
      });

      $('i-del-model')?.addEventListener('click', () => {
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
      const sel = $('i-default-model');
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

    $('i-del').onclick = async () => {
      if (!uiConfirm(t('instances.delete') + '?')) return;
      try {
        await window.ccarmy.stopInstance(inst.id);
      } catch {
        /* noop */
      }
      state.instances = state.instances.filter((x) => x.id !== inst.id);
      state.selectedInstance = null;
      hideMain();
      $('empty-state').classList.remove('hidden');
      renderList();
    };
  }

  function renderPage() {
    const box = $('page-body');
    if (state.nav === 'me') {
      const p = state.profile;
      const avHtml = `<img class="avatar-img big" src="${personAvatarSrc(p)}" alt=""/>`;
      box.innerHTML = `
        <div class="brand-strip">
          <img class="brand-logo" src="./icons/logo-tight.png" alt="${escapeHtml(t('brand.name'))}"/>
          <div class="brand-text">
            <div class="brand-name">${escapeHtml(t('brand.name'))}</div>
            <div class="brand-sub">${escapeHtml(t('brand.sub'))}</div>
          </div>
        </div>
        <div class="me-strip">
          <div class="profile-head">
            <button id="p-av-btn" class="av-btn" aria-label="${escapeHtml(t('me.avatar'))}">${avHtml}</button>
            <div>
              <span id="p-name-display" class="username-display" title="${escapeHtml(t('me.username'))}">${escapeHtml(p.username || t('nav.avatar'))}</span>
              <input id="p-name" class="username-input hidden" value="${escapeHtml(p.username)}"/>
              <div class="muted">${p.loggedIn ? escapeHtml(p.email || '') : t('me.notLoggedIn')}</div>
              <div class="muted me-hint">${t('me.userId')}: ${escapeHtml(p.deviceId || '—')}</div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="btn-mini" id="p-login">${t('me.login')}</button>
                <button class="btn-mini" id="p-reg">${t('me.register')}</button>
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom:10px"><label>${t('me.email')}</label><input id="p-email" type="email" value="${escapeHtml(p.email)}"/></div>
          <div class="field" style="margin-bottom:14px"><label>${t('me.changePassword')}</label>
            <input id="p-pw" type="password" placeholder="${escapeHtml(t('me.newPassword'))}"/>
            <input id="p-pw2" type="password" placeholder="${escapeHtml(t('me.confirmPassword'))}" style="margin-top:6px"/>
          </div>
          <button class="btn-primary" id="p-save">${t('me.saveProfile')}</button>
        </div>
        <div id="dash-host"></div>`;
      $('p-login').onclick = () => uiAlert(t('me.notAvailable'));
      $('p-reg').onclick = () => uiAlert(t('me.notAvailable'));
      // click name -> edit
      const nameDisp = $('p-name-display');
      const nameInp = $('p-name');
      nameDisp.onclick = () => {
        nameDisp.classList.add('hidden');
        nameInp.classList.remove('hidden');
        nameInp.focus();
        nameInp.select();
      };
      const commitName = () => {
        const v = nameInp.value.trim();
        if (v) {
          state.profile.username = v;
          nameDisp.textContent = v;
        }
        nameInp.classList.add('hidden');
        nameDisp.classList.remove('hidden');
      };
      nameInp.onblur = commitName;
      nameInp.onkeydown = (e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { nameInp.value = state.profile.username; commitName(); } };
      $('p-av-btn').onclick = async () => {
        const r = await pickAvatar(PERSON_AVATARS, state.profile.avatarPreset, (i) => t('avatar.person.' + (i + 1)));
        if (!r) return;
        if (r.type === 'local') {
          pendingAvatarTarget = { kind: 'profile' };
          $('avatar-file').click();
          return;
        }
        state.profile.avatarPreset = r.preset;
        state.profile.avatarDataUrl = '';
        applyAvatar();
        saveProfile();
        renderPage();
      };
      $('p-save').onclick = () => {
        const v = $('p-name').value.trim();
        if (v) state.profile.username = v;
        state.profile.email = $('p-email').value.trim();
        applyAvatar();
        saveProfile();
        uiAlert(t('instances.saved'));
      };
      renderDashboard($('dash-host'));
      return;
    }

    if (state.nav === 'settings') {
      box.innerHTML = `
        <div class="settings-layout">
        <div class="settings-nav" id="settings-nav">
          <button data-sec="ui" class="on">${t('settings.section.ui')}</button>
          <button data-sec="notify">${t('settings.section.notify')}</button>
          <button data-sec="model">${t('settings.section.model')}</button>
          <button data-sec="func">${t('settings.section.func')}</button>
          <button data-sec="about">${t('settings.section.about')}</button>
        </div>
        <div class="settings-content" id="settings-content">
        <div class="set-section" data-sec="ui"><h2 style="color:var(--accent)">${t('settings.section.ui')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.language')}</h2>
          <select id="sel-locale" title="${escapeHtml(t('settings.language'))}">
            <option value="zh-CN" ${state.locale.startsWith('zh') ? 'selected' : ''}>${t('settings.localeZh')}</option>
            <option value="en-US" ${state.locale.startsWith('en') ? 'selected' : ''}>${t('settings.localeEn')}</option>
          </select>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.themeMode')}</h2>
          <div class="theme-mode">
            <button data-m="light" class="${state.themeMode === 'light' ? 'on' : ''}">${t('settings.themeLight')}</button>
            <button data-m="dark" class="${state.themeMode === 'dark' ? 'on' : ''}">${t('settings.themeDark')}</button>
            <button data-m="system" class="${state.themeMode === 'system' ? 'on' : ''}">${t('settings.themeSystem')}</button>
          </div>
          <h2 style="margin-top:12px">${t('settings.theme')}</h2>
          <div class="theme-swatches" id="theme-swatches"></div>
          <div class="theme-custom-row">
            <button class="btn-mini" id="btn-theme-custom">${t('settings.themeCustom')}</button>
            <span class="theme-custom-preview" id="theme-custom-preview"></span>
            <span class="muted">${t('settings.themePreview')}</span>
          </div>
        </div>
        <div class="set-section" data-sec="notify"><h2 style="color:var(--accent)">${t('settings.section.notify')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.soundName')}</h2>
          <div class="sound-row">
            <label><input type="checkbox" id="s-complete" ${state.sound.complete ? 'checked' : ''}/> ${t('settings.soundComplete')}</label>
            <label><input type="checkbox" id="s-request" ${state.sound.request ? 'checked' : ''}/> ${t('settings.soundRequest')}</label>
            <label><input type="checkbox" id="s-error" ${state.sound.error ? 'checked' : ''}/> ${t('settings.soundError')}</label>
          </div>
          <div class="field" style="margin-top:10px"><label>${t('settings.soundCompleteFile')}</label>
            <div class="inst-row"><input id="sf-complete" value="${escapeHtml(state.soundFiles.complete)}" readonly/>
            <button class="btn-mini" data-pick="complete">${t('settings.soundPick')}</button>
            <button class="btn-mini" data-clear="complete">${t('settings.soundClear')}</button></div></div>
          <div class="field" style="margin-top:8px"><label>${t('settings.soundRequestFile')}</label>
            <div class="inst-row"><input id="sf-request" value="${escapeHtml(state.soundFiles.request)}" readonly/>
            <button class="btn-mini" data-pick="request">${t('settings.soundPick')}</button>
            <button class="btn-mini" data-clear="request">${t('settings.soundClear')}</button></div></div>
          <div class="field" style="margin-top:8px"><label>${t('settings.soundErrorFile')}</label>
            <div class="inst-row"><input id="sf-error" value="${escapeHtml(state.soundFiles.error)}" readonly/>
            <button class="btn-mini" data-pick="error">${t('settings.soundPick')}</button>
            <button class="btn-mini" data-clear="error">${t('settings.soundClear')}</button></div></div>
          <div style="margin-top:12px">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px">${t('settings.emailNotify')}</div>
            ${['complete', 'request', 'error']
            .map(
              (k) =>
                '<label style="margin-right:14px"><input type="checkbox" data-email-k="' + k + '" ' +
                (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</label>'
            )
            .join('')}
            <div class="muted">${t('settings.emailHint')}</div>
          </div>
        </div>
                <div class="set-section set-card">
          <h2>${t('smtp.title')} <span class="muted">(${t('smtp.count')} <span id="smtp-n">0</span>/10 · ${t('smtp.max10')})</span></h2>
          <p class="muted">${t('smtp.hint')}</p>
          <div id="smtp-accounts"></div>
          <div class="inst-row" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
            <div class="field"><label>${t('smtp.label')}</label><input id="smtp-label" placeholder="${escapeHtml(t('placeholder.email'))}"/></div>
            <div class="field"><label>${t('smtp.host')}</label><input id="smtp-host" value="" placeholder="smtp.example.com"/></div>
            <div class="field"><label>${t('smtp.port')}</label><input id="smtp-port" value="465"/></div>
          </div>
          <div class="inst-row" style="margin-top:8px">
            <label><input type="checkbox" id="smtp-secure" checked/> ${t('smtp.secure')}</label>
            <div class="field"><label>${t('smtp.user')}</label><input id="smtp-user"/></div>
            <div class="field"><label>${t('smtp.pass')}</label><input id="smtp-pass" type="password"/></div>
            <button class="btn-mini" id="btn-smtp-add">${t('smtp.add')}</button>
          </div>
          <span class="muted" id="smtp-msg"></span>
        </div>
        <div class="set-section" data-sec="model"><h2 style="color:var(--accent)">${t('settings.section.model')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.providers')}</h2>
          <div id="prov-list"></div>
          <button class="btn-mini" id="btn-add-prov">${t('settings.addProvider')}</button>
        </div>
        <div class="set-section" data-sec="func"><h2 style="color:var(--accent)">${t('settings.section.func')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.security')}</h2>
          <div class="sec-row">
            <select id="sel-sec" title="${escapeHtml(t('settings.securityHint'))}">
              <option value="normal">${t('settings.securityNormal')}</option>
              <option value="strict">${t('settings.securityStrict')}</option>
              <option value="full">${t('settings.securityFull')}</option>
            </select>
            <span class="sec-desc" id="sec-desc"></span>
          </div>
          <p class="muted" style="margin:8px 0 0">${t('settings.securityHint')}</p>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.plugins')}</h2>
          <table class="plugins">
            <thead><tr><th>${t('settings.pluginId')}</th><th>${t('settings.pluginDesc')}</th><th>${t('settings.pluginStatus')}</th><th>${t('settings.pluginActions')}</th></tr></thead>
            <tbody id="plug-body"></tbody>
          </table>
          <div style="margin-top:8px"><input id="plug-path" placeholder="package or path" style="width:55%"/>
            <button class="btn-mini" id="btn-plug-install">${t('settings.pluginInstall')}</button></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('lan.title')}</h2>
          <div class="inst-row">
            <div class="field"><label>${t('lan.port')}</label><input id="lan-port" value="7788"/></div>
            <button class="btn-mini" id="btn-lan-start">${t('lan.start')}</button>
            <button class="btn-mini" id="btn-lan-stop">${t('lan.stop')}</button>
          </div>
          <div class="inst-row" style="margin-top:8px">
            <div class="field"><label>${t('lan.peerHost')}</label><input id="lan-host" value="192.168.1.123" placeholder="192.168.1.123"/></div>
            <div class="field"><label>${t('lan.peerPort')}</label><input id="lan-pport" value="7788"/></div>
            <button class="btn-mini" id="btn-lan-send">${t('lan.sendTest')}</button>
            <button class="btn-mini" id="btn-lan-dual">${t('lan.dualSmoke')}</button>
          </div>
          <div class="muted" id="lan-msg" style="margin-top:8px"></div>
          <div class="muted" id="lan-inbox" style="margin-top:8px;max-height:100px;overflow:auto"></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('mesh.title')}</h2>
          <p class="muted">${t('mesh.hint')}</p>
          <div class="inst-row">
            <div class="field"><label>${t('lan.port')}</label><input id="mesh-port" value="7788"/></div>
            <button class="btn-mini" id="btn-mesh-start">${t('mesh.start')}</button>
            <button class="btn-mini" id="btn-mesh-stop">${t('mesh.stop')}</button>
            <button class="btn-mini" id="btn-mesh-bcast">${t('mesh.broadcast')}</button>
          </div>
          <div class="inst-row" style="margin-top:8px">
            <div class="field"><label>${t('mesh.name')}</label><input id="peer-name" placeholder="${escapeHtml(t('placeholder.nodeName'))}"/></div>
            <div class="field"><label>${t('lan.peerHost')}</label><input id="peer-host" placeholder="${escapeHtml(t('placeholder.peerHost'))}"/></div>
            <div class="field"><label>${t('lan.peerPort')}</label><input id="peer-port" value="7788"/></div>
            <button class="btn-mini" id="btn-peer-add">${t('mesh.addPeer')}</button>
          </div>
          <div id="peer-list" style="margin-top:10px"></div>
          <div class="muted" id="mesh-msg" style="margin-top:8px"></div>
          <div class="muted" id="mesh-inbox" style="margin-top:8px;max-height:100px;overflow:auto"></div>
        </div>
        <!-- R8：公网地址（自动填入 / 手改 / 多域名）+ 检测 + 组网开关（检测通过才能打开） -->
        <div class="set-section set-card" id="net-card">
          <h2>${t('net.title')}</h2>
          <p class="muted" style="margin:0 0 10px">${t('net.hint')}</p>
          <div class="inst-row">
            <div class="field"><label>${t('net.address')}</label><input id="net-ip" value="${escapeHtml(netState.addr.ip || '')}" placeholder="${escapeHtml(t('net.address'))}"/></div>
            <div class="field" style="max-width:120px"><label>${t('net.port')}</label><input id="net-port" value="${escapeHtml(String(netState.addr.port || ''))}"/></div>
            <button class="btn-mini" id="btn-net-autofill">${t('net.autofill')}</button>
          </div>
          <div class="muted" id="net-local-info" style="margin:6px 0"></div>
          <div style="margin-top:6px">
            <label class="net-sub-label">${t('net.domainTitle')}</label>
            <div id="net-domains"></div>
            <div style="margin-top:6px"><button class="btn-mini" id="btn-net-domain-add">${t('net.domainAdd')}</button></div>
          </div>
          <div class="inst-row" style="margin-top:10px;align-items:center">
            <button class="btn-primary" id="btn-net-detect">${t('net.detect')}</button>
            <div id="net-probe-result" style="flex:1;min-width:220px"></div>
          </div>
          <div class="net-switch-row">
            <label class="net-switch"><input type="checkbox" id="net-switch" aria-label="${escapeHtml(t('net.switch'))}"/><span class="net-switch-track"></span></label>
            <span class="net-switch-label">${t('net.switch')}</span>
            <span class="muted" id="net-switch-msg"></span>
          </div>
        </div>
        <div class="set-section set-card">
          <h2>${t('ctx.archive')}</h2>
          <p class="muted">${t('archive.hint')}</p>
          <div id="archived-box" class="muted">—</div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.specialModels')}</h2>
          <p class="muted">${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.asrModel')}</label>
            <select id="sm-asr">
              <option value="ollama">Ollama (whisper-tiny)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
              <option value="openai">OpenAI Whisper API</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.embeddingModel')}</label>
            <select id="sm-embed">
              <option value="onnx">ONNX (bge-small-zh)</option>
              <option value="ollama">Ollama embedding</option>
              <option value="api">API embedding</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.organizerModel')}</label>
            <input id="sm-organizer" placeholder="deepseek-chat"/>
          </div>
          <div style="margin-top:8px"><button class="btn-mini" id="btn-webgpu">${t('webgpu.test')}</button> <span class="muted" id="webgpu-msg"></span></div>
          <button class="btn-mini" id="btn-save-special">${t('common.save')}</button>
          <span class="muted" id="sm-msg"></span>
        </div>
        
        <div class="set-section set-card">
          <h2>${t('join.blacklistTitle')}</h2>
          <div id="blacklist-box" class="muted">${t('join.blacklistEmpty')}</div>
        </div>
        <div class="set-section set-card">
          <h2>${t('diag.title')}</h2>
          <p class="muted" style="margin:0 0 8px">${t('diag.hint')}</p>
          <div id="diag-out" class="muted">—</div>
          <div style="margin-top:8px"><button class="btn-mini" id="btn-diag-run">${t('diag.run')}</button></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.skills')}</h2>
          <p class="muted" style="margin:0 0 8px">${t('settings.skillsHint')}</p>
          <div style="margin-bottom:8px"><button class="btn-mini" id="btn-skill-import">${t('settings.skillsImport')}</button></div>
          <div id="skill-list" class="muted">${t('settings.skillsEmpty')}</div>
          <div class="muted skill-paths" id="skill-paths"></div>
        </div>
        <div class="set-section" data-sec="about"><h2 style="color:var(--accent)">${t('settings.section.about')}</h2></div>
        <div class="set-section set-card about-card">
          <div class="about-brand">
            <img class="about-logo" src="./icons/logo-tight.png" alt="${escapeHtml(t('about.logoAlt'))}"/>
            <div class="about-brand-text">
              <div class="about-name">${escapeHtml(t('brand.name'))}</div>
              <div class="about-sub">${escapeHtml(t('brand.sub'))}</div>
              <div class="about-ver-line">
                <span class="muted about-ver" id="about-version">—</span>
                <button class="btn-mini" id="btn-about-update">${t('about.checkUpdate')}</button>
                <span class="muted" id="about-upd"></span>
              </div>
              <div class="about-feed-line" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
                <input id="update-feed" placeholder="${escapeHtml(t('update.feedPlaceholder'))}" style="flex:1;min-width:220px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit"/>
                <button class="btn-mini" id="btn-feed-save">${t('update.feedSave')}</button>
                <span class="muted" id="feed-msg"></span>
              </div>
            </div>
          </div>
          <div class="about-block">
            <h3>${t('about.versionInfo')}</h3>
            <div class="muted" id="about-runtime">—</div>
            <div class="muted" id="about-device">—</div>
          </div>
          <div class="about-block"><h3>${t('about.opensource')}</h3><p class="muted">${t('about.opensourceBody')}</p></div>
          <div class="about-block"><h3>${t('about.techStack')}</h3><p class="muted">${t('about.techStackBody')}</p></div>
          <div class="about-block"><h3>${t('about.copyright')}</h3><p class="muted">${t('about.copyrightBody')}</p></div>
          <div class="about-block"><h3>${t('about.author')}</h3><p class="muted">${t('about.authorBody')}</p></div>
          <div class="about-block"><h3>${t('about.contact')}</h3><p class="muted">${t('about.contactBody')}</p></div>
          <div class="about-block"><h3>${t('about.legal')}</h3><p class="muted">${t('about.legalBody')}</p></div>
        </div></div></div>`;

      // 更新源：不填则永远只会是「未配置」，所以必须给界面入口
      (async () => {
        try {
          const cur = await window.ccarmy.updateSourceGet();
          const inp = $('update-feed');
          if (inp && cur && cur.url) inp.value = cur.url;
          const msg = $('feed-msg');
          if (msg && !(cur && cur.url)) msg.textContent = t('update.status.notConfigured');
        } catch (e) { /* 预览桩或旧版本可能没有该 API，静默跳过 */ }
      })();
      $('btn-feed-save').onclick = async () => {
        const msg = $('feed-msg');
        const url = (($('update-feed') || {}).value || '').trim();
        const r = await window.ccarmy.updateSourceSet({ url }).catch(() => null);
        if (msg) msg.textContent = r && r.ok === false ? t('update.feedInvalid') : t('update.feedSaved');
      };
      $('btn-about-update').onclick = async () => {
        const el = $('about-upd');
        if (el) el.textContent = t('about.checking');
        // 主进程会区分「未配置 / 网络失败 / HTTP 错误 / 格式非法 / 已最新 / 有更新」，
        // 不能只看 upToDate —— 那会把「未配置」误报成「发现新版本」。
        const r = await window.ccarmy.checkUpdate().catch(() => null);
        if (el) el.textContent = updateStatusText(r);
      };
      (async () => {
        try {
          const info = await window.ccarmy.appInfo();
          if (!info?.ok) return;
          const v = $('about-version');
          if (v) v.textContent = `${t('about.version')} ${info.version}`;
          const rt = $('about-runtime');
          if (rt) rt.textContent =
            `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}/${info.arch}`;
          const dv = $('about-device');
          if (dv) dv.textContent =
            `${t('me.userId')}: ${info.deviceId || '—'} ${info.deviceIdValid ? t('about.idVerified') : t('about.idRegenerated')}`;
        } catch { /* noop */ }
      })();

      // 设置：第二列是菜单，第三列只显示对应板块
      (function bindSettingsMenu() {
        const contentEl = $('settings-content');
        if (!contentEl) return;
        const secIds = ['ui', 'notify', 'model', 'func', 'about'];
        const groups = { ui: [], notify: [], model: [], func: [], about: [] };
        let curSec = 'ui';
        Array.from(contentEl.children).forEach((el) => {
          const ds = el.getAttribute && el.getAttribute('data-sec');
          if (ds) curSec = ds;
          if (groups[curSec]) groups[curSec].push(el);
        });
        const navBtns = Array.from(document.querySelectorAll('#settings-nav button'));
        const showSec = (s) => {
          secIds.forEach((k) => groups[k].forEach((el) => { el.style.display = k === s ? '' : 'none'; }));
          navBtns.forEach((b) => b.classList.toggle('on', b.dataset.sec === s));
        };
        navBtns.forEach((btn) => { btn.onclick = () => showSec(btn.dataset.sec); });
        showSec('ui');
      })();
      $('sel-locale').onchange = async (e) => {
        await loadI18n(e.target.value);
        window.ccarmy.settingsSave({ locale: e.target.value });
        setNav('settings');
      };
      document.querySelectorAll('.theme-mode button').forEach((b) => {
        b.onclick = () => {
          applyThemeMode(b.dataset.m);
          window.ccarmy.settingsSave({ themeMode: b.dataset.m });
          renderPage();
        };
      });
      renderThemeSwatches();
      renderSkillList();
      bindDiagnostics();
      bindNetCard();
      document.querySelectorAll('.theme-swatches button').forEach((b) => {
        if (b.dataset.c === state.theme) b.classList.add('on');
        b.onclick = () => {
          applyAccent(b.dataset.c);
          renderPage();
        };
      });
      (function bindThemeCustom() {
        const btn = $('btn-theme-custom');
        const preview = $('theme-custom-preview');
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
        const d = $('sec-desc');
        if (d) d.textContent = t(SEC_DESC[state.globalSecurity] || SEC_DESC.normal);
      };
      $('sel-sec').value = state.globalSecurity;
      syncSecDesc();
      $('sel-sec').onchange = async (e) => {
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
          await window.ccarmy.setSecurityMode(state.globalSecurity);
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
          window.ccarmy.settingsSave({ emailNotify: state.emailNotify });
        };
      });
      document.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = async () => {
          const r = await window.ccarmy.pickSound();
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
        const r = await window.ccarmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = t('instances.saved') + ' (' + r.providers.length + ')';
          state.providers = r.providers;
          renderPage();
        } else {
          $('import-msg').textContent = String(r?.error || t('common.error'));
        }
      });
      $('btn-webgpu')?.addEventListener('click', async () => {
        $('webgpu-msg').textContent = t('common.loading');
        try {
          if (!navigator.gpu) throw new Error('no navigator.gpu');
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('no adapter');
          const info = adapter.info || {};
          $('webgpu-msg').textContent = t('webgpu.ok') + ' · vendor=' + (info.vendor||'') + ' arch=' + (info.architecture||'');
        } catch (e) {
          $('webgpu-msg').textContent = t('webgpu.fail');
        }
      });
      $('btn-save-special')?.addEventListener('click', async () => {
        const cfg = {
          asr: { provider: $('sm-asr')?.value || 'ollama' },
          embedding: { provider: $('sm-embed')?.value || 'onnx' },
          summary: { provider: 'deepseek', model: $('sm-summary')?.value || 'deepseek-flash' },
          organizer: { provider: 'deepseek', model: $('sm-organizer')?.value || 'deepseek-chat' },
        };
        await window.ccarmy.specialModelsSet(cfg).catch(() => {});
        $('sm-msg').textContent = t('instances.saved');
      });
      // 邀请链接 / 二维码
      (async () => {
        const st = await window.ccarmy.meshStatus().catch(() => null);
        const node = st?.nodeId || 'local';
        const inv = await window.ccarmy.inviteCreate().catch(() => null);
        const tok = inv?.invite?.token ? '&tok=' + inv.invite.token : '';
        const link = 'ccarmy://join?node=' + encodeURIComponent(node) + '&port=7788' + tok;
        const lk = $('join-link');
        if (lk) lk.textContent = link;
        const qr = $('join-qr');
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
          await navigator.clipboard.writeText($('join-link').textContent);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      });
      $('btn-join-accept')?.addEventListener('click', () => {
        const v = $('join-input').value.trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('ccarmy://') ? t('join.ok') : t('join.fail');
      });

      async function refreshBlacklist() {
        const box = $('blacklist-box');
        if (!box) return;
        const r = await window.ccarmy.blacklistList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((b) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(b.name) + ' · ' + escapeHtml(b.target) + ' · ' + new Date(b.blockedAt).toLocaleString() + '</span><button class="btn-mini" data-unblock="' + escapeHtml(b.id) + '">' + t('join.removeBlacklist') + '</button></div>').join('')
          : t('join.blacklistEmpty');
        box.querySelectorAll('[data-unblock]').forEach((btn) => {
          btn.onclick = async () => {
            await window.ccarmy.blacklistRemove(btn.dataset.unblock).catch(() => {});
            refreshBlacklist();
          };
        });
      }
      refreshBlacklist();

      async function refreshArchived() {
        const box = $('archived-box');
        if (!box) return;
        const r = await window.ccarmy.archivedList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((a) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(a.name) + ' · ' + escapeHtml(String(a.kind || '')) + '</span><button class="btn-mini" data-restore="' + escapeHtml(a.id) + '">' + t('cp.rollback') + '</button></div>').join('')
          : '—';
        box.querySelectorAll('[data-restore]').forEach((b) => {
          b.onclick = async () => {
            await window.ccarmy.archivedRestore(b.dataset.restore).catch(() => {});
            refreshArchived();
            uiAlert(t('instances.saved'));
          };
        });
      }
      refreshArchived();

      async function renderSmtpList() {
        const r = await window.ccarmy.smtpList();
        const accounts = r?.accounts || [];
        const n = $('smtp-n');
        if (n) n.textContent = String(accounts.length);
        const box = $('smtp-accounts');
        if (!box) return;
        if (!accounts.length) {
          box.innerHTML = '<div class="muted">' + t('smtp.empty') + '</div>';
          return;
        }
        box.innerHTML = accounts
          .map(
            (a) =>
              '<div class="prov-card" style="margin-bottom:8px" data-id="' + escapeHtml(a.id) + '">' +
              '<div class="inst-row">' +
              '<div><b>' + escapeHtml(a.label) + '</b> <span class="muted">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + escapeHtml(String(a.port)) + '</span></div>' +
              '<span class="badge ' + (a.verified ? '' : 'off') + '">' + (a.verified ? t('smtp.verified') : t('smtp.unverified')) + '</span>' +
              '<button class="btn-mini" data-v="' + escapeHtml(a.id) + '">' + t('smtp.verify') + '</button>' +
              '<button class="btn-mini" data-x="' + escapeHtml(a.id) + '">' + t('smtp.remove') + '</button>' +
              '</div></div>'
          )
          .join('');
        box.querySelectorAll('[data-x]').forEach((b) => {
          b.onclick = async () => {
            await window.ccarmy.smtpRemove(b.dataset.x);
            renderSmtpList();
          };
        });
        box.querySelectorAll('[data-v]').forEach((b) => {
          b.onclick = async () => {
            const id = b.dataset.v;
            const full = (state.smtpFull || []).find((x) => x.id === id);
            if (!full) {
              $('smtp-msg').textContent = t('smtp.fail');
              return;
            }
            $('smtp-msg').textContent = t('common.loading');
            const vr = await window.ccarmy.smtpVerify({ ...full, id });
            $('smtp-msg').textContent = vr?.ok ? t('smtp.ok') : t('smtp.fail') + ': ' + (vr?.message || '');
            renderSmtpList();
          };
        });
      }
      renderSmtpList();

      $('btn-smtp-add').onclick = async () => {
        const acc = {
          label: $('smtp-label').value.trim(),
          host: $('smtp-host').value.trim(),
          port: parseInt($('smtp-port').value, 10) || 465,
          secure: $('smtp-secure').checked,
          user: $('smtp-user').value.trim(),
          pass: $('smtp-pass').value,
        };
        if (!acc.host || !acc.user) {
          $('smtp-msg').textContent = t('common.error');
          return;
        }
        const r = await window.ccarmy.smtpAdd(acc);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([acc]);
          ['smtp-label', 'smtp-host', 'smtp-user', 'smtp-pass'].forEach((id) => {
            const el = $(id);
            if (el) el.value = '';
          });
          $('smtp-msg').textContent = t('instances.saved');
        } else {
          $('smtp-msg').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('prov-list');
      state.providers.forEach((pr) => {
        const el = document.createElement('div');
        el.className = 'prov-card';
        el.innerHTML =
          '<div class="prov-head" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.label) + '</span>' +
          '<button class="btn-mini" data-prov-del="' + escapeHtml(pr.id) + '" title="' + t('settings.pluginUninstall') + '">' + t('settings.pluginUninstall') + '</button>' +
          '</div>' +
          '<div class="inst-row">' +
          '<div class="field"><label>' + t('settings.providerName') + '</label><input data-k="label" value="' + escapeHtml(pr.label) + '"/></div>' +
          '<div class="field"><label>' + t('settings.baseUrl') + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"/></div>' +
          '<div class="field"><label>' + t('settings.apiKey') + '</label><input data-k="apiKey" type="password" value="' + escapeHtml(pr.apiKey || '') + '"/></div>' +
          '</div>' +
          '<div class="prov-actions"><button class="btn-mini" data-fetch>' + t('settings.fetchModels') + '</button></div>' +
          '<div class="model-row">' +
          (((pr.models || [])
            .map(
              (m) =>
                '<span class="model-chip" data-m="' + escapeHtml(m) + '">' + escapeHtml(m) +
                '<button class="x" data-del="' + escapeHtml(m) + '" title="' + t('settings.removeModel') + '">×</button></span>'
            )
            .join('')) || '<span class="muted">' + t('settings.modelsEmpty') + '</span>') +
          '</div>';
        el.querySelectorAll('input[data-k]').forEach((inp) => {
          inp.onchange = () => {
            pr[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'label') el.querySelector('.prov-head').textContent = inp.value;
            window.ccarmy.setProvider({
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
          await window.ccarmy.setProvider({
            presetId: pr.id,
            apiKey: pr.apiKey,
            baseURL: pr.baseURL,
            protocol: pr.protocol,
            model: providerCfgModel(pr),
          });
          const r = await window.ccarmy.listModels({ protocol: pr.protocol, baseURL: pr.baseURL, apiKey: pr.apiKey });
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
        el.querySelectorAll('.model-chip').forEach((chip) => {
          chip.onclick = async () => {
            pr.defaultModel = chip.dataset.m;
            await window.ccarmy.setProvider({
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
      $('btn-add-prov').onclick = () => {
        state.providers.push({
          id: 'custom-' + Date.now(),
          label: 'Custom',
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
  /* ══════════════════════════════════════════════════════════════════════
   * 组网状态与身份变更横幅（ADR 003 R8–R12 / 附六）
   * ----------------------------------------------------------------------
   * 改这块之前先读这五条：
   *
   *  1) 这里**只做 UI 与判定**，不实现网络：一律走 window.ccarmy 的组网/身份 IPC。
   *     该 IPC 还没落地（身份层并行开发中）时用**可注入的桩**顶替：
   *       window.__ccarmyNetStub / window.__ccarmyIdentityStub
   *     桩优先于真实 IPC（自动化才能压出各种状态）。两者都没有时如实显示
   *     「组网层未就绪」，**不假装检测通过**。
   *
   *  2) R9 的迟滞判定在本文件里做，且写成纯函数 netStep()：连续 N 次心跳失败
   *     **且**持续 M 秒才判「断链」→ 先出横幅 + 退避重试 → 重试 R 轮仍失败才
   *     自动关组网。判定与关断分两步，就是为了不让开关反复自动开关。
   *
   *  3) R9（断链）与 R10（组网关了但存在异地成员）会同时发生，因此
   *     netBannerModel() **只返回一个模型**；DOM 里恒只有一行
   *     .bn-row[data-kind="net"]，不会出两条。
   *
   *  4) R11/R12 的置灰用 --ink-dim（对 --list-bg/--hover/--active-list 都 ≥ 3.0，
   *     沿用项目已立的对比度硬规则），不是简单 opacity 变淡。验收脚本用真实
   *     Chromium 读计算色复算对比度。
   *
   *  5) 附六的换证横幅：可折叠（保留常驻标记）或关闭（二次确认 + 审计），
   *     但关闭只是「暂时隐藏」——下次进该会话 / 下次启动会重现，直到用户点
   *     「已联系本人核实」。旧联系方式必须来自变更记录里的**旧名片快照**，
   *     空值显示「未填写」占位，绝不表现为对方隐藏。
   * ══════════════════════════════════════════════════════════════════════ */

  const NET_DEFAULTS = {
    port: 7788,
    hysteresisFailures: 3, // 连续失败次数
    hysteresisSeconds: 30, // 且持续这么久
    retryRounds: 3, // 先重试几轮
    backoffMs: [5000, 15000, 30000],
    tickMs: 1000,
  };

  /**
   * 迟滞/重试参数。window.__netTuning 只用于自动化把时间窗缩短
   * （语义不变：仍是「连续 N 次 + 持续 M 秒」），运行期随时可注入。
   */
  function netTuning() {
    const o = (typeof window !== 'undefined' && window.__netTuning) || {};
    const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    return {
      port: n(o.port, NET_DEFAULTS.port),
      failures: n(o.hysteresisFailures, NET_DEFAULTS.hysteresisFailures),
      seconds: n(o.hysteresisSeconds, NET_DEFAULTS.hysteresisSeconds),
      rounds: n(o.retryRounds, NET_DEFAULTS.retryRounds),
      backoff: Array.isArray(o.backoffMs) && o.backoffMs.length ? o.backoffMs.map(Number) : NET_DEFAULTS.backoffMs.slice(),
      tickMs: n(o.tickMs, NET_DEFAULTS.tickMs),
    };
  }

  /** 组网层 IPC：桩优先，其次真实 IPC，都没有则 null（= 未就绪） */
  function netIpc(name, ...args) {
    const stub = window.__ccarmyNetStub;
    if (stub && typeof stub[name] === 'function') {
      try { return Promise.resolve(stub[name](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.ccarmy && window.ccarmy[name];
    if (typeof api === 'function') {
      try { return Promise.resolve(api(...args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.resolve(null);
  }

  /** 身份层 IPC：同上（window.ccarmy.identity*） */
  function idIpc(name, ...args) {
    const stub = window.__ccarmyIdentityStub;
    if (stub && typeof stub[name] === 'function') {
      try { return Promise.resolve(stub[name](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.ccarmy && window.ccarmy[name];
    if (typeof api === 'function') {
      try { return Promise.resolve(api(...args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.resolve(null);
  }

  /** 带 {name} 变量的 i18n 文本 */
  function fmtKey(k, vars) {
    return String(t(k)).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  }

  const netState = {
    /** 组网开关 */
    enabled: false,
    /** 公网地址：1 个 IP + 多个域名（R8） */
    addr: { ip: '', port: NET_DEFAULTS.port, domains: [] },
    /** 最近一次检测结果 { verdict:'pass'|'fail'|'unknown', isPublic, outboundOk, method, at, code } */
    probe: null,
    probing: false,
    /** 链接迟滞状态（netStep 的输入与输出） */
    link: { fails: 0, downSince: 0, linkDown: false, round: 0, autoOff: false, nextRetryAt: 0 },
    /** 最近一次采样：true=通 / false=失败 / null=未知（无 IPC，不计数） */
    linkSample: null,
    /** 自动关组网时留下的现场（用于横幅文案）；用户重新打开组网时清空 */
    autoOffInfo: null,
    /** 已手动关闭的提示签名（状态变化后签名改变，于是会重新提示） */
    dismissed: {},
    /** 组网「关闭」事件序号：让同一原因只弹一次，再次关闭时重新弹 */
    meshOffSeq: 0,
    /** 本地地址信息（自动填入用） */
    local: null,
    /** 异地成员总数（横幅用）与按群缓存的成员状态 */
    remoteCount: 0,
    presence: {},
    /** 组网层是否就绪（有 netStatus/netProbe 之类的 IPC 才算） */
    ready: null,
    /** 渲染签名：相同就不重建 DOM（避免 1s 心跳把用户正在点的按钮刷掉） */
    renderedSig: '',
    booted: false,
  };

  /**
   * 断链迟滞判定（纯函数：给定状态与一个事件，返回新状态）。
   * 事件：
   *   'heartbeat-failed' 一次心跳失败
   *   'heartbeat-ok' / 'up' 恢复
   *   'retry-tick' 重试时钟（只有到点才推进轮次）
   * 规则：
   *   - 连续 N 次失败 **且** downSince 起的持续时长 ≥ M 秒 → linkDown=true（先出横幅）
   *   - linkDown 后每轮退避重试，重试 R 轮仍失败 → autoOff=true（这时才关组网）
   *   - 任一成功样本 → 全部清零（不自动重开组网，开必须由用户手动且要重新检测）
   */
  function netStep(s, ev, cfg, now) {
    const next = {
      fails: s.fails,
      downSince: s.downSince,
      linkDown: s.linkDown,
      round: s.round,
      autoOff: s.autoOff,
      nextRetryAt: s.nextRetryAt || 0,
    };
    if (ev.type === 'heartbeat-ok' || ev.type === 'up') {
      next.fails = 0;
      next.downSince = 0;
      next.linkDown = false;
      next.round = 0;
      next.nextRetryAt = 0;
      return next;
    }
    if (ev.type === 'heartbeat-failed') {
      next.fails = s.fails + 1;
      if (!next.downSince) next.downSince = now;
      const lastedEnough = now - next.downSince >= cfg.seconds * 1000;
      if (!next.linkDown && next.fails >= cfg.failures && lastedEnough) {
        next.linkDown = true;
        next.round = 0;
        next.nextRetryAt = now + cfg.backoff[0];
      }
      return next;
    }
    if (ev.type === 'retry-tick') {
      if (!next.linkDown || next.autoOff) return next;
      if (now < next.nextRetryAt) return next;
      next.round = s.round + 1;
      if (next.round >= cfg.rounds) {
        next.autoOff = true;
        next.nextRetryAt = 0;
      } else {
        next.nextRetryAt = now + cfg.backoff[Math.min(next.round, cfg.backoff.length - 1)];
      }
      return next;
    }
    return next;
  }

  /** 推进链接状态机；'retry-tick' 之外的样本都走这里 */
  function netLinkStep(ev, now) {
    const prev = netState.link;
    const next = netStep(prev, ev, netTuning(), now || Date.now());
    const changed =
      next.fails !== prev.fails ||
      next.linkDown !== prev.linkDown ||
      next.round !== prev.round ||
      next.autoOff !== prev.autoOff ||
      next.downSince !== prev.downSince ||
      next.nextRetryAt !== prev.nextRetryAt;
    netState.link = next;
    if (next.autoOff && !prev.autoOff) void netAutoDisableMesh();
    return changed;
  }

  /** 本地实例（成员可能是邀请来的人，没有实例） */
  function localInstanceOf(member) {
    const id = String(member.instanceId || member.id || member.name || '');
    const nm = String(member.name || '');
    return (state.instances || []).find((i) => i.id === id || i.name === nm) || null;
  }

  /** 成员三态 + 停用（R11/R12）：disabled 优先，其次组网关闭，再次异地离线 */
  function memberVisual(groupId, member) {
    const bag = netState.presence[groupId] || {};
    const p = bag[String(member.id || member.name)] || bag[String(member.name)] || null;
    const local = localInstanceOf(member);
    const remote = !!(p && p.remote);
    const localStopped = !!local && local.status === 'stopped';
    const disabled = (p && p.disabled === true) || (!remote && localStopped);
    const online = p && typeof p.online === 'boolean' ? p.online : !!(local && local.status === 'running');
    let kind = 'normal';
    if (disabled) kind = 'disabled';
    else if (remote && !netState.enabled) kind = 'meshOff';
    else if (remote && !online) kind = 'offline';
    else if (remote) kind = 'remoteOnline';
    return { kind, remote, disabled, online };
  }

  /** 实例是否异地：显式标记、或组网层在成员表里标过 */
  function instanceIsRemote(inst) {
    if (!inst) return false;
    if (inst.remote === true) return true;
    const stub = window.__ccarmyNetStub;
    if (stub && Array.isArray(stub.remoteInstanceIds) && stub.remoteInstanceIds.includes(inst.id)) return true;
    for (const gid of Object.keys(netState.presence)) {
      const bag = netState.presence[gid] || {};
      for (const k of Object.keys(bag)) {
        const rec = bag[k];
        if (rec && rec.remote && (k === inst.id || k === inst.name)) return true;
      }
    }
    return false;
  }

  /** 地址格式校验（IP 或域名） */
  function isValidHost(v) {
    const s = String(v || '').trim();
    if (!s || /\s/.test(s)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').every((x) => Number(x) >= 0 && Number(x) <= 255);
    if (s.includes(':')) return /^[0-9a-fA-F:]+$/.test(s); // IPv6
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(s);
  }

  function parsePort(v) {
    const n = Number(String(v ?? '').trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  }

  /* ── R8：公网地址（自动填入 + 手改 + 多域名）与检测 ── */

  /** 读取已保存的组网地址配置（走既有 settings IPC，不新开持久化通道） */
  async function netLoadConfig() {
    try {
      const s = await window.ccarmy.settingsGet();
      const saved = s && s.settings && s.settings.net;
      if (saved && typeof saved === 'object') {
        netState.addr.ip = String(saved.ip || '');
        const p = parsePort(saved.port);
        if (p) netState.addr.port = p;
        netState.addr.domains = Array.isArray(saved.domains) ? saved.domains.map(String).filter(Boolean) : [];
      }
    } catch {
      /* 预览桩/旧主进程没有该字段：保持默认 */
    }
    try {
      const st = await netIpc('netStatus');
      if (st && st.ok !== false && typeof st.meshEnabled === 'boolean') {
        netState.enabled = st.meshEnabled;
        netState.ready = true;
      }
    } catch {
      /* noop */
    }
    if (netState.ready === null) {
      // 退一步：既有 meshStatus（老 IPC）至少能给出「监听中」这一个事实
      try {
        const ms = await window.ccarmy.meshStatus();
        if (ms && ms.ok !== false && typeof ms.listening === 'boolean') netState.enabled = ms.listening;
      } catch {
        /* noop */
      }
    }
  }

  /** 本机地址（自动填入的默认值） */
  async function netFetchLocal() {
    try {
      const r = await netIpc('netLocalAddress');
      if (r && r.ok !== false && (r.localIp || r.ip)) {
        netState.local = { ip: String(r.localIp || r.ip), publicIp: String(r.publicIp || ''), behindNat: !!r.behindNat, port: parsePort(r.port) || null };
      }
    } catch {
      /* noop */
    }
    return netState.local;
  }

  /** 自动填入：本机 IP + 默认端口（只在字段为空时覆盖，不打断用户手改） */
  async function netAutofill(force) {
    const loc = await netFetchLocal();
    const tn = netTuning();
    if (!netState.addr.ip || force) netState.addr.ip = (loc && loc.ip) || netState.addr.ip || '';
    if (!netState.addr.port) netState.addr.port = (loc && loc.port) || tn.port;
    return netState.addr;
  }

  function netPersist() {
    window.ccarmy
      .settingsSave({ net: { ip: netState.addr.ip, port: netState.addr.port, domains: netState.addr.domains } })
      .catch(() => {});
  }

  /** 检测：判断是否公网地址 + 能否与外网连通（不通过就不能打开组网开关） */
  async function netDetect() {
    const ip = String(netState.addr.ip || '').trim();
    const port = parsePort(netState.addr.port);
    if (!isValidHost(ip)) return { ok: false, code: 'invalid-ip' };
    if (!port) return { ok: false, code: 'invalid-port' };
    netState.probing = true;
    renderNetCard();
    let r = null;
    try {
      r = await netIpc('netProbe', { ip, port, domains: netState.addr.domains.slice() });
    } catch (e) {
      r = { ok: false, errorCode: 'error', error: String(e && e.message) };
    }
    let probe;
    if (!r || typeof r !== 'object') {
      probe = { verdict: 'unknown', code: 'no-ipc', at: Date.now() };
    } else if (r.ok === false && !('isPublic' in r) && !('outboundOk' in r)) {
      probe = { verdict: 'unknown', code: r.errorCode || 'probe-error', at: Date.now() };
    } else {
      const isPublic = r.isPublic === true;
      const outboundOk = r.outboundOk === true;
      const lanOnly = r.lanOnly === true;
      let verdict = 'fail';
      let code = 'not-public';
      if (outboundOk && isPublic) verdict = 'pass', code = 'public';
      else if (outboundOk && lanOnly) verdict = 'pass', code = 'lan';
      else if (!outboundOk) code = 'no-outbound';
      probe = { verdict, code, isPublic, outboundOk, lanOnly, method: r.method || '', behindNat: !!r.behindNat, at: Date.now() };
    }
    netState.probing = false;
    netState.probe = probe;
    renderNetCard();
    renderNetBanner();
    return probe;
  }

  /** 组网开关（R8：检测通过才允许打开；R9：自动关闭走 opts.auto） */
  async function netSetEnabled(on, opts) {
    const tn = netTuning();
    if (on && !(netState.probe && netState.probe.verdict === 'pass')) {
      await uiAlert(t('net.result.needPass'), t('net.switch'));
      return false;
    }
    let r = null;
    try {
      r = on
        ? await netIpc('meshEnable', { ip: netState.addr.ip, port: netState.addr.port, domains: netState.addr.domains.slice() }) || (await window.ccarmy.meshStart(netState.addr.port))
        : await netIpc('meshDisable') || (await window.ccarmy.meshStop());
    } catch (e) {
      r = { ok: false, error: String(e && e.message) };
    }
    if (r && r.ok === false) {
      await uiAlert(fmtKey(on ? 'net.enableFailed' : 'net.disableFailed', { err: String(r.error || '') }));
      return false;
    }
    const wasOn = netState.enabled;
    netState.enabled = !!on;
    netState.ready = true;
    if (on) {
      netState.autoOffInfo = null;
      netState.link = { fails: 0, downSince: 0, linkDown: false, round: 0, autoOff: false, nextRetryAt: 0 };
      netState.linkSample = null;
    } else {
      if (wasOn) netState.meshOffSeq += 1;
      if (!opts || !opts.auto) netState.autoOffInfo = null;
      netState.link = { fails: 0, downSince: 0, linkDown: false, round: 0, autoOff: false, nextRetryAt: 0 };
      netState.linkSample = null;
    }
    netState.dismissed = {};
    netPersist();
    renderNetCard();
    renderNetBanner();
    return true;
  }

  /** R9：重试若干轮仍失败 → 自动关组网（并留下现场供横幅说明原因） */
  async function netAutoDisableMesh() {
    const l = netState.link;
    netState.autoOffInfo = {
      fails: l.fails,
      secs: Math.max(0, Math.round((Date.now() - (l.downSince || Date.now())) / 1000)),
      rounds: netTuning().rounds,
    };
    await netSetEnabled(false, { auto: true });
  }

  /** 采样一次链接状态（只有组网开着才采；没有 IPC 时返回 null，不计数、不误报） */
  async function netPollOnce() {
    if (!netState.enabled) return;
    let st = null;
    try {
      st = await netIpc('netStatus');
    } catch {
      st = null;
    }
    if (!st || typeof st !== 'object') {
      netState.linkSample = null;
      return;
    }
    netState.ready = true;
    const reachable = st.link && typeof st.link.reachable === 'boolean' ? st.link.reachable : null;
    netState.linkSample = reachable;
    if (typeof st.meshEnabled === 'boolean' && st.meshEnabled !== netState.enabled) {
      netState.enabled = st.meshEnabled;
      renderNetCard();
    }
  }

  /** 1s 心跳：采样 → 迟滞推进 → 重试轮次 → 重渲染（幂等） */
  async function netHeartbeatTick() {
    const tn = netTuning();
    const now = Date.now();
    await netPollOnce();
    if (netState.enabled && netState.linkSample !== null) {
      netLinkStep(netState.linkSample ? { type: 'heartbeat-ok' } : { type: 'heartbeat-failed' }, now);
    } else if (!netState.enabled && netState.link.linkDown) {
      netLinkStep({ type: 'up' }, now);
    }
    if (netState.link.linkDown && !netState.link.autoOff) {
      const next = netStep(netState.link, { type: 'retry-tick' }, tn, now);
      if (next !== netState.link) netState.link = next;
      // 轮次推进后到点即 autoOff
      if (netState.link.autoOff) void netAutoDisableMesh();
    }
    renderNetBanner();
  }

  /** 成员在线/异地/停用状态（R11）：按群刷新，供成员列表与横幅用 */
  async function netRefreshPresence() {
    const ids = [];
    (state.groups || []).forEach((g) => ids.push(g.id));
    if (state.selectedChat && !ids.includes(state.selectedChat.id)) ids.push(state.selectedChat.id);
    for (const gid of ids) {
      let r = null;
      try {
        r = await netIpc('netMembersPresence', { groupId: gid });
      } catch {
        r = null;
      }
      if (!r || typeof r !== 'object' || !Array.isArray(r.members)) continue;
      const bag = {};
      r.members.forEach((m) => {
        const key = String(m.id || m.name || '');
        if (!key) return;
        bag[key] = { remote: !!m.remote, online: m.online !== false, disabled: !!m.disabled };
        if (m.name) bag[String(m.name)] = bag[key]; // 成员表里 id 与显示名都可能被用来查
      });
      netState.presence[gid] = bag;
    }
    // 去重：同一个异地成员可能同时以 id 与 name 存在 bag 里，只算一次
    const remoteKeys = new Set();
    Object.keys(netState.presence).forEach((gid) => {
      const bag = netState.presence[gid] || {};
      Object.keys(bag).forEach((k) => {
        if (!bag[k] || !bag[k].remote) return;
        const inst = (state.instances || []).find((i) => i.id === k || i.name === k);
        remoteKeys.add(inst ? inst.id : k);
      });
    });
    netState.remoteCount = remoteKeys.size;
    return netState.remoteCount;
  }

  /* ── 顶部横幅：断链 / 组网关闭（合并成一条）+ 身份变更（附六） ── */

  /**
   * R9 + R10 合并后的**单一**模型。返回 null = 不出组网横幅。
   * DOM 里恒只有一行 .bn-row[data-kind="net"]，所以不会同时出现两条。
   */
  function netBannerModel() {
    const tn = netTuning();
    const l = netState.link;
    const info = netState.autoOffInfo;
    // ① 组网已关（含断链自动关）：只要有异地成员或刚自动关过，就出这一条
    if (!netState.enabled && (info || netState.remoteCount > 0)) {
      const sig = 'meshoff:' + netState.meshOffSeq;
      if (netState.dismissed[sig]) return null;
      const affected = netState.remoteCount;
      const impact = affected > 0 ? fmtKey('net.banner.meshOffBody', { n: affected }) : '';
      return {
        sig,
        tone: info ? 'danger' : 'warn',
        title: info ? fmtKey('net.banner.mergedTitle', { n: affected }) : t('net.banner.meshOffTitle'),
        body: info
          ? [fmtKey('net.banner.mergedBody', { fails: info.fails, secs: info.secs, rounds: info.rounds }), impact].filter(Boolean).join(' ')
          : impact,
        showTurnOn: true,
      };
    }
    // ② 仍在重试的断链：先提示（还没关组网）
    if (l.linkDown) {
      const sig = 'link:' + (l.downSince || 0);
      if (netState.dismissed[sig]) return null;
      const secs = Math.max(0, Math.round((Date.now() - (l.downSince || Date.now())) / 1000));
      const after = Math.max(0, Math.round(((l.nextRetryAt || Date.now()) - Date.now()) / 1000));
      const impact = netState.remoteCount > 0 ? fmtKey('net.banner.meshOffBody', { n: netState.remoteCount }) : '';
      return {
        sig,
        tone: 'warn',
        title: t('net.banner.linkTitle'),
        body: [
          fmtKey('net.banner.linkBody', {
            fails: l.fails,
            secs,
            round: Math.min(l.round + 1, tn.rounds),
            rounds: tn.rounds,
            after,
          }),
          impact,
        ]
          .filter(Boolean)
          .join(' '),
        showTurnOn: false,
      };
    }
    return null;
  }

  const BN_ICON = {
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 5 7.5 12h-15L12 7zm-1 4h2v5h-2v-5zm0 6h2v2h-2v-2z"/></svg>',
    danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm-1 7h2v7h-2V9zm0 8h2v2h-2v-2z"/></svg>',
  };

  function bnHidden(cid) {
    return !!idchgState.dismissedLocal[cid];
  }

  const idchgState = {
    changes: [],
    collapsed: {},
    /** 关闭只是暂时隐藏：本次页面存活期内不显示，重进会话/重启会重现 */
    dismissedLocal: {},
    /** 「已联系本人核实」成功后的本地镜像 */
    verifiedLocal: {},
    /** 「采用新联系方式」成功后的本地镜像 */
    adoptedLocal: {},
    ready: null,
    loadedAt: 0,
  };

  /* ── 附六（冻结规则）：联系方式的两份来源与 7 天冻结期 ──
   *  历史留存卡（historicalContactCard）：这个人当初加入群/项目/加联系人时，
   *    **本机**存下来的那份名片 —— 横幅里的「旧值」只能来自这里，
   *    不能从换证声明里取（声明不含联系方式）。
   *  新提交卡（newContactCard）：换证时对方新提交的，可能为空。
   *  冻结期：收到提醒后 7 天内本机**不得**把联系方式更新为新值；到期后也**不自动**
   *    采用，必须用户手动确认（否则攻击者只要等 7 天就能得手，冷却期形同虚设）。
   */
  const IDCHG_DEFAULTS = { freezeMs: 7 * 24 * 60 * 60 * 1000 };

  function idchgTuning() {
    const o = (typeof window !== 'undefined' && window.__idchgTuning) || {};
    const n = Number(o.freezeMs);
    return { freezeMs: Number.isFinite(n) && n >= 0 ? n : IDCHG_DEFAULTS.freezeMs };
  }

  function idHistoryCard(c) {
    if (c && c.historicalContactCard) return c.historicalContactCard;
    if (c && c.previousCard) return c.previousCard; // 身份层的 PeerContactView 字段名
    if (c && c.storedCard) return c.storedCard; // 身份层的 PeerContactState 字段名
    if (c && c.oldCard) return c.oldCard; // 兼容早期字段名
    return null;
  }

  function idNewCard(c) {
    return (c && (c.newContactCard || c.pendingCard || c.newCard)) || null;
  }

  /**
   * 联系方式决策。以身份层给的字段为准（contactDecision / contactFreezeUntil /
   * receivedAt / remainingMs / frozen），缺省按「收到提醒的时刻 + 7 天」推算。
   * ⚠️ 冻结期结束后**不自动采用**新值：本机仍然显示历史留存值，直到用户手动确认
   *    （父任务冻结规则；身份层的 peerContactSettle 会在到期时把 pending 提升为
   *     storedCard —— 那是存储层的行为，UI 这边一律要求显式确认）。
   */
  function idContactDecision(c) {
    const d = (c && c.contactDecision) || {};
    const id = String((c && c.id) || '');
    const adopted = !!idchgState.adoptedLocal[id] || d.state === 'adopted' || !!d.adoptedAt || !!(c && c.cardAdopted);
    const now = Date.now();
    let frozenUntil = Number(d.frozenUntil) || Number(c && c.contactFreezeUntil) || 0;
    if (!frozenUntil) {
      const start = Number(c && (c.receivedAt || c.ts)) || now;
      frozenUntil = start + idchgTuning().freezeMs;
    }
    let msLeft = Math.max(0, frozenUntil - now);
    const hasRemaining = !!(c && typeof c.remainingMs === 'number');
    if (hasRemaining) msLeft = Math.max(0, Number(c.remainingMs));
    const frozenFlag = hasRemaining ? Number(c.remainingMs) > 0 : now < frozenUntil;
    const frozen = !adopted && (!!(c && c.frozen === true) || frozenFlag);
    return { adopted, frozenUntil, frozen, msLeft };
  }

  /** 身份变更（附六）：待核实 + 属于当前会话（或未指定范围） */
  function idChangePending(c) {
    if (!c) return false;
    if (idchgState.verifiedLocal[String(c.id)]) return false;
    return !(c.ack && c.ack.verifiedAt);
  }

  function idScopesOf(c) {
    if (Array.isArray(c && c.scopes)) return c.scopes;
    if (c && c.scope) return [c.scope];
    return [];
  }

  function sessionScopeKind(kind) {
    if (kind === 'internal') return 'internal';
    if (kind === 'extgroup') return 'external';
    if (kind === 'extdm') return 'extdm';
    return '';
  }

  /** 该变更是否落在某个会话（群聊 / 项目 / 联系人）上；范围为空视为三处都出 */
  function idMatches(c, kind, id) {
    const scopes = idScopesOf(c);
    if (!scopes.length) return true;
    const sk = sessionScopeKind(kind);
    return scopes.some((s) => s && (s.kind === 'all' || s.kind === sk) && (!s.id || String(s.id) === String(id)));
  }

  function idForSession(sel) {
    if (!sel) return [];
    return idchgState.changes.filter((c) => idChangePending(c) && idMatches(c, sel.kind, sel.id));
  }

  /** 列表行上的常驻标记：不打开会话也能看到「这里有身份变更待核实」 */
  function hasPendingIdChange(kind, id) {
    return idchgState.changes.some((c) => idChangePending(c) && idMatches(c, kind, id));
  }

  async function idLoadChanges() {
    let r;
    try {
      r = await idIpc('identityChanges', { scope: 'all' });
    } catch {
      r = null;
    }
    if (r === null || typeof r !== 'object') {
      idchgState.ready = false; // 身份层未就绪：不显示、也不假装没有变更
      idchgState.changes = [];
    } else if (r.ok !== false && Array.isArray(r.changes)) {
      idchgState.ready = true;
      idchgState.changes = r.changes;
    } else if (r.ok === false) {
      idchgState.ready = false;
      idchgState.changes = [];
    } else {
      idchgState.ready = true;
      idchgState.changes = [];
    }
    idchgState.loadedAt = Date.now();
    return idchgState.changes;
  }

  const SCOPE_LABEL = { internal: 'idchg.scope.internal', external: 'idchg.scope.external', extdm: 'idchg.scope.extdm' };

  function scopeLabelOf(c) {
    const scopes = idScopesOf(c);
    if (!scopes.length) return '';
    return scopes
      .map((s) => (s.kind === 'all' ? '' : t(SCOPE_LABEL[s.kind] || 'idchg.scope.internal')))
      .filter(Boolean)
      .join(' / ');
  }

  /** 联系方式取值：空值一律显示「未填写」占位（不得表现为对方隐藏） */
  function cardValueWith(v, placeholderKey) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '<span class="id-v id-val-empty" data-empty="1">' + escapeHtml(t(placeholderKey || 'idchg.empty')) + '</span>';
    return '<span class="id-v">' + escapeHtml(s) + '</span>';
  }

  function cardValue(v) {
    return cardValueWith(v, 'idchg.empty');
  }

  function idTagHtml(textKey, cls) {
    return '<span class="id-tag ' + cls + '" data-tag="' + cls + '">' + escapeHtml(t(textKey)) + '</span>';
  }

  /**
   * 附六：历史留存卡 / 新提交卡并排 + 冻结期说明。
   *  - 历史卡缺失 → 如实说「本机无历史联系方式」（不是留空让对方以为「他没写」）；
   *  - 新卡为空 → 「未填写」占位；
   *  - 两者不一致 → 明确提示「联系方式已变化，请自行核实」。
   */
  function idContactCardsHtml(c) {
    const hist = idHistoryCard(c);
    const nw = idNewCard(c);
    const dec = idContactDecision(c);
    const histHtml = hist
      ? '<div class="id-card" data-card="history">' +
        '<div class="id-card-h">' + escapeHtml(t('idchg.histTitle')) + idTagHtml('idchg.cardHistoryTag', 'hist') + '</div>' +
        '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.email')) + '</span>' + cardValue(hist.email) + '</div>' +
        '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.phone')) + '</span>' + cardValue(hist.phone) + '</div>' +
        (hist.capturedAt
          ? '<div class="bn-hint">' + escapeHtml(fmtKey('idchg.historyCapturedAt', { t: new Date(hist.capturedAt).toLocaleString() })) + '</div>'
          : '') +
        '</div>'
      : '<div class="id-card" data-card="history" data-empty-history="1">' +
        '<div class="id-card-h">' + escapeHtml(t('idchg.histTitle')) + idTagHtml('idchg.cardHistoryTag', 'hist') + '</div>' +
        '<div class="id-nohistory">' + escapeHtml(t('idchg.noHistory')) + '</div>' +
        '<div class="bn-hint">' + escapeHtml(t('idchg.noHistoryHint')) + '</div>' +
        '</div>';
    const nwEmpty = !String((nw && nw.email) || '').trim() && !String((nw && nw.phone) || '').trim();
    const newHtml =
      '<div class="id-card" data-card="new">' +
      '<div class="id-card-h">' + escapeHtml(t('idchg.newTitle')) + idTagHtml('idchg.cardNewTag', 'pending') + '</div>' +
      '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.email')) + '</span>' + cardValue(nw && nw.email) + '</div>' +
      '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.phone')) + '</span>' + cardValue(nw && nw.phone) + '</div>' +
      (nw && nw.submittedAt
        ? '<div class="bn-hint">' + escapeHtml(fmtKey('idchg.newSubmittedAt', { t: new Date(nw.submittedAt).toLocaleString() })) + '</div>'
        : '') +
      (nwEmpty ? '<div class="bn-hint">' + escapeHtml(t('idchg.newEmptyHint')) + '</div>' : '') +
      '</div>';
    const changed =
      !!hist && !!nw && (String(hist.email || '') !== String(nw.email || '') || String(hist.phone || '') !== String(nw.phone || ''));
    const days = Math.floor(dec.msLeft / 86400000);
    const hours = Math.floor((dec.msLeft % 86400000) / 3600000);
    const freezeText = dec.adopted
      ? t('idchg.adopted')
      : dec.frozen
        ? fmtKey('idchg.freeze', { days, hours })
        : t('idchg.freezeOver');
    const nowText = hist
      ? fmtKey('idchg.contactNowIs', { v: [hist.email, hist.phone].filter((x) => String(x || '').trim()).join(' / ') || t('idchg.empty') })
      : '';
    return (
      '<div class="id-cards">' + histHtml + newHtml + '</div>' +
      (changed ? '<div class="bn-hint id-contact-warn" data-changed="1">' + escapeHtml(t('idchg.contactChanged')) + '</div>' : '') +
      (nowText ? '<div class="bn-hint">' + escapeHtml(nowText) + '</div>' : '') +
      '<div class="bn-hint id-freeze" data-freeze="' + (dec.frozen ? '1' : '0') + '" data-adopted="' + (dec.adopted ? '1' : '0') + '">' +
      escapeHtml(freezeText) +
      '</div>'
    );
  }

  function idChangeItemHtml(c) {
    const cid = escapeHtml(String(c.id));
    const collapsed = !!idchgState.collapsed[String(c.id)];
    const at = c.ts ? new Date(c.ts).toLocaleString() : '—';
    const reasonKey = c.reason === 'compromised' ? 'idchg.reason.compromised' : c.reason === 'rotate' ? 'idchg.reason.rotate' : '';
    const hist = idHistoryCard(c);
    const dec = idContactDecision(c);
    // 折叠时只留常驻标记 + 一行历史值摘要（历史留存值才是本机当前认的那份）
    const summary =
      t('idchg.oldEmail') + ' ' + (hist ? String(hist.email || '').trim() || t('idchg.empty') : t('idchg.noHistory')) + ' · ' +
      t('idchg.oldPhone') + ' ' + (hist ? String(hist.phone || '').trim() || t('idchg.empty') : t('idchg.noHistory'));
    return (
      '<div class="id-item' + (collapsed ? ' is-collapsed' : '') + '" data-cid="' + cid + '">' +
      '<div class="id-head">' +
      '<span class="id-title">' + escapeHtml(fmtKey('idchg.titleNamed', { name: c.subjectName || c.subjectId || '—' })) + '</span>' +
      '<span class="id-pending">' + escapeHtml(t('idchg.pending')) + '</span>' +
      (scopeLabelOf(c) ? '<span class="id-scope">' + escapeHtml(scopeLabelOf(c)) + '</span>' : '') +
      (c.generation ? '<span class="id-gen">' + escapeHtml(fmtKey('idchg.generation', { n: c.generation })) + '</span>' : '') +
      '</div>' +
      '<div class="id-summary">' + escapeHtml(summary) + '</div>' +
      '<div class="id-detail">' +
      '<div class="bn-body">' +
      escapeHtml(
        fmtKey('idchg.body', {
          old: c.oldFingerprint || '—',
          new: c.newFingerprint || '—',
          gen: c.generation || '—',
          at,
        })
      ) +
      '</div>' +
      idContactCardsHtml(c) +
      '<div class="bn-hint">' + escapeHtml(t('idchg.emptyHint')) + '</div>' +
      (reasonKey ? '<div class="bn-hint">' + escapeHtml(t('idchg.reason')) + ': ' + escapeHtml(t(reasonKey)) + '</div>' : '') +
      '</div>' +
      '<div class="bn-actions">' +
      '<button class="btn-mini" data-bn="idCollapse" data-cid="' + cid + '">' +
      escapeHtml(collapsed ? t('idchg.expand') : t('idchg.collapse')) +
      '</button>' +
      '<button class="btn-mini" data-bn="idAdopt" data-cid="' + cid + '"' + (dec.frozen || dec.adopted ? ' disabled' : '') +
      ' title="' + escapeHtml(dec.frozen ? t('idchg.adoptFrozen') : t('idchg.adopt')) + '">' + escapeHtml(t('idchg.adopt')) + '</button>' +
      '<button class="btn-mini" data-bn="idDismiss" data-cid="' + cid + '">' + escapeHtml(t('idchg.dismiss')) + '</button>' +
      '<button class="btn-primary" data-bn="idVerify" data-cid="' + cid + '" title="' + escapeHtml(t('idchg.verifiedHint')) + '">' +
      escapeHtml(t('idchg.verified')) +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  /** 当前会话的身份变更行（三处：项目 / 群聊 / 联系人） */
  function idRowModel() {
    const sel = state.selectedChat;
    if (!sel) return null;
    // 会话没显示出来时（例如在设置页）不出这条：列表行上的常驻标记仍然可见
    const chat = $('chat-layout');
    if (chat && chat.classList.contains('hidden')) return null;
    const all = idForSession(sel);
    if (!all.length) return null;
    const visible = all.filter((c) => !bnHidden(String(c.id)));
    const markerOnly = visible.length === 0;
    const collapsedAll = !markerOnly && visible.every((c) => idchgState.collapsed[String(c.id)]);
    return { all, visible, markerOnly, collapsedAll, total: all.length };
  }

  function renderNetBanner() {
    const host = $('net-banner');
    if (!host) return;
    const netRow = netBannerModel();
    const idRow = idRowModel();
    const sig = JSON.stringify([
      netRow ? [netRow.sig, netRow.title, netRow.body, netRow.tone, netRow.showTurnOn] : null,
      idRow ? [idRow.total, idRow.markerOnly, idRow.collapsedAll, idRow.all.map((c) => String(c.id))] : null,
      state.selectedChat ? state.selectedChat.id : '',
    ]);
    if (sig === netState.renderedSig) return;
    netState.renderedSig = sig;

    const rows = [];
    if (netRow) {
      rows.push(
        '<div class="bn-row net-row tone-' + netRow.tone + '" data-kind="net" data-sig="' + escapeHtml(netRow.sig) + '">' +
          '<span class="bn-ico">' + BN_ICON[netRow.tone] + '</span>' +
          '<div class="bn-main">' +
          '<div class="bn-title">' + escapeHtml(netRow.title) + '</div>' +
          '<div class="bn-body">' + escapeHtml(netRow.body) + '</div>' +
          (netRow.tone === 'danger' ? '<div class="bn-body">' + escapeHtml(t('net.banner.autoOff')) + '</div>' : '') +
          '<div class="bn-actions">' +
          (netRow.showTurnOn
            ? '<button class="btn-mini" data-bn="turnOn">' + escapeHtml(t('net.banner.turnOn')) + '</button>'
            : '') +
          '<button class="btn-mini" data-bn="netDismiss" data-sig="' + escapeHtml(netRow.sig) + '">' + escapeHtml(t('net.banner.close')) + '</button>' +
          '<span class="bn-hint">' + escapeHtml(t('net.banner.dismissHint')) + '</span>' +
          '</div>' +
          '</div>' +
          '<button class="bn-x" data-bn="netDismiss" data-sig="' + escapeHtml(netRow.sig) + '" title="' + escapeHtml(t('net.banner.close')) + '">×</button>' +
          '</div>'
      );
    }
    if (idRow) {
      const items = idRow.markerOnly
        ? '<div class="bn-hint">' + escapeHtml(t('idchg.audited') + ' · ' + t('idchg.marker')) + '</div>'
        : idRow.visible.map(idChangeItemHtml).join('');
      rows.push(
        '<div class="bn-row id-row" data-kind="idchg" data-marker="' + (idRow.markerOnly ? '1' : '0') + '">' +
          '<span class="bn-ico">' + BN_ICON.danger + '</span>' +
          '<div class="bn-main">' +
          '<div class="bn-head">' +
          '<span class="bn-title">' + escapeHtml(t('idchg.title')) + '</span>' +
          '<span class="id-marker" data-marker="1">' + escapeHtml(t('idchg.marker')) + ' · ' + idRow.total + '</span>' +
          '</div>' +
          items +
          (idRow.markerOnly
            ? '<div class="bn-actions"><button class="btn-mini" data-bn="idExpandAll">' + escapeHtml(t('idchg.expand')) + '</button></div>'
            : '') +
          '</div>' +
          '</div>'
      );
    }

    host.innerHTML = rows.join('');
    const any = rows.length > 0;
    host.classList.toggle('hidden', !any);
    const main = $('main-col');
    if (main) main.classList.toggle('has-banner', any);
    requestAnimationFrame(() => {
      const h = any ? host.offsetHeight : 0;
      document.documentElement.style.setProperty('--banner-h', h + 'px');
    });
  }

  function bindBannerHost() {
    const host = $('net-banner');
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-bn]');
      if (!btn) return;
      const act = btn.dataset.bn;
      if (act === 'netDismiss') {
        netState.dismissed[btn.dataset.sig] = true;
        netState.renderedSig = '';
        renderNetBanner();
        return;
      }
      if (act === 'turnOn') {
        netState.autoOffInfo = null;
        netState.dismissed = {};
        if (netState.probe && netState.probe.verdict === 'pass') await netSetEnabled(true);
        else gotoNetSettings();
        netState.renderedSig = '';
        renderNetBanner();
        return;
      }
      const cid = btn.dataset.cid;
      if (act === 'idCollapse') {
        idchgState.collapsed[cid] = !idchgState.collapsed[cid];
      } else if (act === 'idExpandAll') {
        idchgState.dismissedLocal = {};
        Object.keys(idchgState.collapsed).forEach((k) => { idchgState.collapsed[k] = false; });
      } else if (act === 'idAdopt') {
        // 冻结期内禁止；冻结期后也**不自动**采用，必须用户手动确认
        const ch = idchgState.changes.find((x) => String(x.id) === cid);
        const dec = idContactDecision(ch);
        if (dec.frozen) {
          await uiAlert(t('idchg.adoptFrozen'), t('idchg.adopt'));
          return;
        }
        if (dec.adopted) return;
        const goAdopt = await uiConfirm(t('idchg.adoptConfirm'), t('idchg.adopt'));
        if (!goAdopt) return;
        let ra = null;
        try {
          ra = await idIpc('identityContactAdopt', { changeId: cid });
        } catch {
          ra = null;
        }
        if (ra === null) {
          // 身份层真实形状是「按指纹手动确认采用对方的新名片」（ccarmy:identity-peer-confirm）
          const fp = String((ch && (ch.newFingerprint || ch.fingerprint)) || '');
          if (fp) {
            try {
              ra = await idIpc('identityPeerConfirm', fp);
            } catch {
              ra = null;
            }
          }
        }
        if (!ra || ra.ok === false) {
          await uiAlert(t('idchg.adoptFailed'), t('idchg.adopt'));
          return;
        }
        idchgState.adoptedLocal[cid] = true;
      } else if (act === 'idDismiss') {
        // 「不得被随意关闭」：二次确认 + 记审计；且只是暂时隐藏
        const go = await uiConfirmCountdown(t('idchg.dismissConfirm'), t('idchg.dismissTitle'), 3);
        if (!go) return;
        let r = null;
        try {
          r = await idIpc('identityChangeAcknowledge', { changeId: cid, level: 'dismiss' });
        } catch {
          r = null;
        }
        if (!r || r.ok === false) {
          await uiAlert(t('idchg.auditFailed'), t('idchg.dismissTitle'));
          return;
        }
        idchgState.dismissedLocal[cid] = true;
        idchgState.collapsed[cid] = false;
      } else if (act === 'idVerify') {
        const go = await uiConfirm(t('idchg.verifyConfirm'), t('idchg.verified'));
        if (!go) return;
        let r = null;
        try {
          r = await idIpc('identityChangeAcknowledge', { changeId: cid, level: 'verified' });
        } catch {
          r = null;
        }
        if (!r || r.ok === false) {
          await uiAlert(t('idchg.verifyFailed'), t('idchg.verified'));
          return;
        }
        idchgState.verifiedLocal[cid] = true;
        delete idchgState.dismissedLocal[cid];
      }
      netState.renderedSig = '';
      renderNetBanner();
    });
  }

  /* ── R8 的设置卡片：渲染 / 绑定 / 跳转 ── */

  /** 检测结论 → 文案 + 样式 */
  function netProbeView() {
    const p = netState.probe;
    if (netState.probing) return { text: t('net.detecting'), cls: '' };
    if (!p) return { text: '', cls: '' };
    if (p.verdict === 'pass') return { text: t(p.code === 'lan' ? 'net.result.passLan' : 'net.result.pass'), cls: 'net-ok' };
    if (p.code === 'no-ipc' || p.code === 'probe-error') return { text: t('net.result.unknown'), cls: 'net-bad' };
    if (p.code === 'no-outbound') return { text: t('net.result.failOutbound'), cls: 'net-bad' };
    return { text: t('net.result.failPublic'), cls: 'net-bad' };
  }

  function renderNetCard() {
    if (!$('net-card')) return;
    renderNetDomains();
    renderNetProbeState();
  }

  /** 域名列表（1 个 IP + 多个域名）。只在需要重建行时调用，输入过程中不重建（会打断输入） */
  function renderNetDomains() {
    if (!$('net-card')) return;
    const box = $('net-domains');
    if (!box) return;
    box.innerHTML = netState.addr.domains.length
      ? netState.addr.domains
          .map(
            (d, i) =>
              '<div class="net-domain-row" data-di="' + i + '">' +
              '<input class="net-domain-input" data-di="' + i + '" value="' + escapeHtml(d) + '" placeholder="' +
              escapeHtml(t('net.domainPlaceholder')) + '"/>' +
              '<button class="btn-mini" data-domain-del="' + i + '">' + escapeHtml(t('net.domainRemove')) + '</button>' +
              '</div>'
          )
          .join('')
      : '<div class="muted">' + escapeHtml(t('net.domainTitle')) + '</div>';
    box.querySelectorAll('[data-domain-del]').forEach((b) => {
      b.onclick = () => {
        netState.addr.domains.splice(Number(b.dataset.domainDel), 1);
        netPersist();
        renderNetCard();
      };
    });
    box.querySelectorAll('input.net-domain-input').forEach((inp) => {
      inp.onchange = () => {
        const i = Number(inp.dataset.di);
        const v = String(inp.value || '').trim();
        if (!v || !isValidHost(v)) {
          inp.classList.add('net-invalid');
          return;
        }
        inp.classList.remove('net-invalid');
        netState.addr.domains[i] = v;
        netPersist();
        netInvalidateProbe(); // 地址集合变了：旧检测结论作废
      };
    });
  }

  /** 检测结论 + 开关（地址被改动时只刷这一块，不动输入框） */
  function renderNetProbeState() {
    if (!$('net-card')) return;
    const tn = netTuning();
    const res = $('net-probe-result');
    if (res) {
      const v = netProbeView();
      const p = netState.probe;
      const details = [];
      if (p && p.at) details.push(fmtKey('net.result.at', { t: new Date(p.at).toLocaleString() }));
      if (p && p.method) details.push(fmtKey('net.result.method', { m: p.method }));
      if (p && p.behindNat) details.push(t('net.result.behindNat'));
      res.innerHTML =
        (v.text ? '<div class="net-probe-line ' + v.cls + '">' + escapeHtml(v.text) + '</div>' : '') +
        (details.length ? '<div class="muted">' + escapeHtml(details.join(' · ')) + '</div>' : '');
    }
    const pass = !!(netState.probe && netState.probe.verdict === 'pass');
    const sw = $('net-switch');
    if (sw) {
      sw.checked = !!netState.enabled;
      sw.disabled = !netState.enabled && !pass;
      sw.title = pass || netState.enabled ? t('net.switch') : t('net.result.needPass');
    }
    const msg = $('net-switch-msg');
    if (msg) {
      msg.textContent = netState.enabled
        ? fmtKey('net.switchOn', { port: netState.addr.port || tn.port })
        : netState.probe
          ? pass
            ? t('net.switchOff')
            : t('net.switchBlocked')
          : t('net.switchNeedDetect');
    }
    const info = $('net-local-info');
    if (info) {
      const loc = netState.local;
      info.textContent = loc
        ? t('net.localIp') + ': ' + loc.ip + (loc.publicIp ? ' · ' + t('net.publicIp') + ': ' + loc.publicIp : '')
        : '';
    }
  }

  /**
   * 地址被改动 → 上一次检测结论不再代表当前地址，必须重新检测。
   * 否则「检测通过才能打开组网开关」就成了摆设（改完地址还能拿旧结论去开）。
   */
  function netInvalidateProbe() {
    if (!netState.probe) return;
    netState.probe = null;
    renderNetProbeState();
  }

  /** 打开设置并定位到组网卡片（横幅 / 加成员提示的「去设置打开」都走这里） */
  function gotoNetSettings() {
    setNav('settings');
    const navBtn = document.querySelector('#settings-nav button[data-sec="func"]');
    if (navBtn) navBtn.click();
    const card = $('net-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
    const ip = $('net-ip');
    if (ip) ip.focus();
  }

  function bindNetCard() {
    const box = $('net-card');
    if (!box) return;
    const ip = $('net-ip');
    if (ip && ip.dataset.bound !== '1') {
      ip.dataset.bound = '1';
      ip.oninput = () => {
        netState.addr.ip = String(ip.value || '').trim();
        ip.classList.toggle('net-invalid', !!netState.addr.ip && !isValidHost(netState.addr.ip));
        netInvalidateProbe();
      };
      ip.onchange = () => {
        if (!isValidHost(netState.addr.ip)) {
          void uiAlert(t('net.invalidIp'), t('net.address'));
          return;
        }
        netPersist();
      };
    }
    const port = $('net-port');
    if (port && port.dataset.bound !== '1') {
      port.dataset.bound = '1';
      port.onchange = () => {
        const p = parsePort(port.value);
        if (!p) {
          void uiAlert(t('net.invalidPort'), t('net.port'));
          port.value = String(netState.addr.port);
          return;
        }
        netState.addr.port = p;
        netPersist();
        netInvalidateProbe();
      };
    }
    const auto = $('btn-net-autofill');
    if (auto && auto.dataset.bound !== '1') {
      auto.dataset.bound = '1';
      auto.onclick = async () => {
        await netAutofill(true);
        if (ip) ip.value = netState.addr.ip;
        if (port) port.value = String(netState.addr.port);
        netPersist();
        netState.probe = null;
        renderNetCard();
        void uiAlert(fmtKey('net.autofillDone', { ip: netState.addr.ip, port: netState.addr.port }), t('net.autofill'));
      };
    }
    const detect = $('btn-net-detect');
    if (detect && detect.dataset.bound !== '1') {
      detect.dataset.bound = '1';
      detect.onclick = async () => {
        const r = await netDetect();
        if (r && r.code === 'invalid-ip') void uiAlert(t('net.invalidIp'), t('net.address'));
        else if (r && r.code === 'invalid-port') void uiAlert(t('net.invalidPort'), t('net.port'));
      };
    }
    const addD = $('btn-net-domain-add');
    if (addD && addD.dataset.bound !== '1') {
      addD.dataset.bound = '1';
      addD.onclick = () => {
        netState.addr.domains.push('');
        renderNetCard();
        const last = $('net-domains') && $('net-domains').querySelector('input.net-domain-input:last-of-type');
        if (last) last.focus();
      };
    }
    const sw = $('net-switch');
    if (sw && sw.dataset.bound !== '1') {
      sw.dataset.bound = '1';
      sw.onchange = async () => {
        const want = !!sw.checked;
        const okGo = await netSetEnabled(want);
        if (!okGo) renderNetCard();
      };
    }
    renderNetCard();
  }

  /* ── 附六：名片（加入群 / 项目 / 联系人时对方一定看得到，不可隐藏但可以不写） ── */

  /**
   * 名片标签/占位文案的键名：身份层（身份层还没有 `card.*` 这套键）通过
   * identityInfo.contactI18n 声明它需要的键（CONTACT_CARD_I18N），这里照它给的用，
   * 拿不到时退回本地 card.* 键。两套键都在 i18n 里，不会显示成 key 原文。
   */
  let identityCardI18n = null;
  function cardKey(name, fallback) {
    const m = identityCardI18n || {};
    const k = m[name];
    return k && state.t && state.t[k] ? k : fallback;
  }

  /** 本人身份（真实 IPC 已落地：ccarmy:identity-info；桩：identityGet） */
  async function myIdentity() {
    let r = null;
    try {
      r = await idIpc('identityInfo');
    } catch {
      r = null;
    }
    if (!r || typeof r !== 'object' || r.ok === false || !r.identity) {
      let r2 = null;
      try {
        r2 = await idIpc('identityGet');
      } catch {
        r2 = null;
      }
      if (r2 && typeof r2 === 'object' && r2.ok !== false) r = Object.assign({}, r, r2);
    }
    if (r && typeof r === 'object' && r.contactI18n) identityCardI18n = r.contactI18n;
    return r;
  }

  async function myCard() {
    const card = { email: String(state.profile.email || ''), phone: '' };
    const r = await myIdentity();
    if (r && typeof r === 'object' && r.ok !== false) {
      const info = r.identity || {};
      const c = info.contactCard || r.contactCard || r.card || {};
      if (c.email) card.email = String(c.email);
      if (c.phone) card.phone = String(c.phone);
      if (c.extra) card.extra = c.extra;
    }
    return card;
  }

  function myCardHtml(card) {
    const c = card || {};
    const titleKey = cardKey('title', 'card.title');
    const emailKey = cardKey('email', 'card.email');
    const phoneKey = cardKey('phone', 'card.phone');
    const noteKey = cardKey('alwaysVisible', 'card.cannotHide');
    const empty = !String(c.email || '').trim() && !String(c.phone || '').trim();
    return (
      '<div class="my-card">' +
      '<div class="id-card-h">' + escapeHtml(t(titleKey)) + '</div>' +
      '<div class="id-field"><span class="id-k">' + escapeHtml(t(emailKey)) + '</span>' + cardValueWith(c.email, cardKey('unfilled', 'card.empty')) + '</div>' +
      '<div class="id-field"><span class="id-k">' + escapeHtml(t(phoneKey)) + '</span>' + cardValueWith(c.phone, cardKey('unfilled', 'card.empty')) + '</div>' +
      (Array.isArray(c.extra) && c.extra.length
        ? c.extra
            .map(
              (e) =>
                '<div class="id-field"><span class="id-k">' + escapeHtml(String(e.label || t('card.extra'))) + '</span>' +
                cardValueWith(e.value, cardKey('unfilled', 'card.empty')) + '</div>'
            )
            .join('')
        : '') +
      '<div class="bn-hint">' + escapeHtml(t(noteKey)) + '</div>' +
      (empty ? '<div class="bn-hint">' + escapeHtml(t('card.fillInProfile')) + '</div>' : '') +
      '</div>'
    );
  }

  /** 加入动作前把「对方将看到的名片」摆在用户面前；空值显示未填写占位 */
  function shareCardConfirm(card, titleKey) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t(titleKey || 'card.title');
      $('modal-body').innerHTML = '<div class="muted">' + escapeHtml(t('card.peerWillSee')) + '</div>' + myCardHtml(card);
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = t('common.ok');
      ok.onclick = () => { root.classList.add('hidden'); resolve(true); };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
    });
  }

  /* ── 初始化与心跳 ── */

  function scheduleHeartbeat() {
    setTimeout(async () => {
      try {
        await netHeartbeatTick();
      } catch (e) {
        /* 单次心跳异常不应打断后续监测 */
      }
      scheduleHeartbeat();
    }, netTuning().tickMs);
  }

  async function netInit() {
    if (netState.booted) return;
    netState.booted = true;
    bindBannerHost();
    await netLoadConfig();
    await netAutofill(false);
    await netRefreshPresence();
    await idLoadChanges();
    renderNetCard();
    netState.renderedSig = '';
    renderNetBanner();
    scheduleHeartbeat();
    // 成员状态与身份变更：低频刷新（5s 主循环之外，避免和它抢渲染）
    setInterval(() => {
      void netRefreshPresence().then(() => {
        netState.renderedSig = '';
        renderNetBanner();
        if (state.nav === 'internalGroup' || state.nav === 'externalGroup') refreshMembers();
      });
    }, 15000);
  }

  /** 会话切换时：重新拉一次身份变更，让「下次进该会话重现」成立 */
  async function idRefreshForChat() {
    // 「下次进该会话/下次启动重现」：进入会话即清掉本次页面存活期内的「暂时隐藏」
    const sel = state.selectedChat;
    if (sel) {
      (idchgState.changes || []).forEach((c) => {
        if (idMatches(c, sel.kind, sel.id)) delete idchgState.dismissedLocal[String(c.id)];
      });
    }
    if (!(Date.now() - idchgState.loadedAt < 3000)) await idLoadChanges();
    netState.renderedSig = '';
    renderNetBanner();
    void netRefreshPresence().then(() => {
      netState.renderedSig = '';
      renderNetBanner();
    });
  }

  // 自动化用的可见钩子（与既有 window.__refreshSecurity / __saveState 同一风格）
  window.__netUi = {
    net: netState,
    idchg: idchgState,
    tuning: netTuning,
    idchgTuning,
    step: netStep,
    bannerModel: netBannerModel,
    memberVisual,
    hasPendingIdChange,
    idContactDecision,
    idHistoryCard,
    idNewCard,
    refreshBanner: () => { netState.renderedSig = ''; renderNetBanner(); },
    refreshPresence: netRefreshPresence,
    refreshMembers,
    loadIdChanges: idLoadChanges,
    detect: netDetect,
    setEnabled: netSetEnabled,
    heartbeat: netHeartbeatTick,
    gotoNetSettings,
  };

  /* renderPage-end */

  $('btn-voice').onclick = async () => {
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
        const r = await window.ccarmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          // 尝试 ASR 转文字
          const asr = await window.ccarmy.asrTranscribe({ dataUrl, ext: 'webm' }).catch(() => null);
          const text = asr?.ok && asr.text ? asr.text : `[${t('chat.voice')}] ${r.path.split(/[\\/]/).pop()}`;
          pushMsg(state.selectedChat.id, 'me', text);
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
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  // 输入防抖：仅更新内部状态，不触发重渲染
  const syncSendState = () => {
    const btn = $('btn-send');
    if (btn) btn.disabled = !($('input')?.value || '').trim();
  };
  $('input')?.addEventListener('input', () => {
    syncSendState();
    const now = Date.now();
    if (now - __inputThrottle < 100) return;
    __inputThrottle = now;
  });
  syncSendState();
  // 紧急度下拉：悬停显框，点击展开
  (function bindUrgency() {
    const trigger = $('urg-trigger');
    const menu = $('urg-menu');
    const dd = $('urgency-dd');
    const label = $('urg-label');
    if (!trigger || !menu || !dd) return;

    const LABELS = { P1: 'urgency.urgentLabel', P2: 'urgency.insertLabel', P3: 'urgency.queueLabel' };

    function refresh() {
      if (label) label.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      const icon = dd.querySelector('.urgent-i');
      if (icon) icon.classList.toggle('hidden', state.urgency !== 'P1');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.u === state.urgency));
    }
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) positionMenuFixed(trigger, menu);
    });
    onDocClick(() => menu?.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');
      if (!b) return;
      const u = b.dataset.u;
      if (u === 'P1') {
        const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('hidden');
          return;
        }
      }
      state.urgency = u;
      menu.classList.add('hidden');
      refresh();
    });

    // 语言切换后刷新文案
    window.__refreshUrgency = refresh;
  })();
  // 「…」更多菜单
  $('more-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('more-menu');
    menu?.classList.toggle('hidden');
    if (menu && !menu.classList.contains('hidden')) positionMenuFixed($('more-trigger'), menu);
  });
  onDocClick(() => $('more-menu')?.classList.add('hidden'));
  $('mi-search')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    showSearchPopup();
  });
  let __directed = false;
  $('mi-directed')?.addEventListener('click', async () => {
    __directed = !__directed;
    const mark = $('mi-directed-mark');
    if (mark) mark.textContent = __directed ? '✓' : '✕';
    if (state.selectedChat) {
      await window.ccarmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });
  $('mi-open')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏
    window.ccarmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind, mode: 'sub' });
  });
  $('mi-export')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    showExportDialog();
  });

  $('btn-console')?.addEventListener('click', () => {
    state.consoleOpen = !state.consoleOpen;
    $('btn-console')?.classList.toggle('tb-on', state.consoleOpen);
    $('console-pane')?.classList.toggle('hidden', !state.consoleOpen);
    $('console-resizer')?.classList.toggle('hidden', !state.consoleOpen);
    if (state.consoleOpen && $('console-out')) {
      $('console-out').textContent = 'CCArmy console ready.\n' + new Date().toLocaleString() + '\n';
    }
  });
  (function bindConsoleResize() {
    const el = $('console-resizer');
    const pane = $('console-pane');
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
  $('btn-shot')?.addEventListener('click', () => uiAlert(t('chat.screenshotPending')));
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('sec-trigger');
    const menu = $('sec-menu');
    const dd = $('sec-dd');
    const label = $('sec-label');
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
      if (label) label.textContent = t(LABELS[mode] || LABELS.normal);
      dd.classList.toggle('urgent', mode === 'full');
      const warn = dd.querySelector('.sec-warn');
      if (warn) warn.classList.toggle('hidden', mode !== 'full');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === mode));
    }
    window.__refreshSecurity = refresh;
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) positionMenuFixed(trigger, menu);
    });
    onDocClick(() => menu?.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('hidden');
          return;
        }
      }
      menu.classList.add('hidden');
      if (state.selectedChat) {
        state.sessionSecurity[state.selectedChat.id] = mode;
      } else {
        state.globalSecurity = mode;
        try { await window.ccarmy.setSecurityMode(mode); } catch { /* noop */ }
      }
      refresh();
    });
  })();
  $('avatar-file').addEventListener('change', (e) => {
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
      if (state.nav === 'me') renderPage();
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  });
  $('btn-win-min')?.addEventListener('click', () => window.ccarmy.winMinimize());
  $('btn-win-max')?.addEventListener('click', () => window.ccarmy.winMaximize());
  $('btn-win-close')?.addEventListener('click', () => window.ccarmy.winClose());
  $('btn-ui-refresh')?.addEventListener('click', () => window.ccarmy.winReload());
  $('btn-always-top')?.addEventListener('click', async () => {
    const r = await window.ccarmy.winAlwaysOnTop();
    $('btn-always-top')?.classList.toggle('tb-active', !!r?.alwaysOnTop);
  });

  (async () => {
    try {
      const p = await window.ccarmy.platformInfo();
      if (p?.isMac) document.body.classList.add('platform-darwin');
      else if (p?.isWin) document.body.classList.add('platform-win32');
      else if (p?.isLinux) document.body.classList.add('platform-linux');
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
      const r = await window.ccarmy.groupList();
      if (!r || r.ok !== true || !Array.isArray(r.groups)) return false;
      const prev = new Map(state.groups.map((g) => [g.id, g]));
      const fromStore = r.groups.map((g) => {
        const old = prev.get(g.groupId) || {};
        return {
          id: g.groupId,
          name: g.name,
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
    uiPrompt(state.nav === 'internalGroup' ? t('list.createProject') : t('list.createGroupChat'), state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt')).then(async (name) => {
      if (!name) return;
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const id = 'g-' + Date.now();
      try {
        await window.ccarmy.groupCreate({ groupId: id, name, type, directedMode: false });
      } catch (e) {
        uiAlert(String(e.message || e));
        return;
      }
      await syncGroupsFromStore();
    });
  }

  function addContactFlow() {
    uiPrompt(t('contact.add'), '').then(async (name) => {
      if (!name) return;
      // 附六：加入联系人时对方一定看得到你的联系方式（不可隐藏，但可以不写）
      const card = await myCard();
      const go = await shareCardConfirm(card, 'contact.add');
      if (!go) return;
      state.chats.push({ id: 'c-' + Date.now(), name, kind: 'extdm', lastPreview: t('list.noReply'), notify: true, card });
      renderList();
      window.__saveState?.();
    });
  }

  function addInstanceFlow() {
    uiPrompt(t('instances.name'), t('placeholder.agentName') + '-' + (state.instances.length + 1)).then((name) => {
      if (!name) return;
      const inst = {
        id: 'inst-' + Date.now(),
        name,
        status: 'stopped',
        dutyEligible: true,
        notify: true,
        model: 'deepseek-chat',
        memoryFile: 'persona/' + name + '.md',
        persona: t('instances.personaDefault'),
        avatarPreset: randomPreset(),
        avatarDataUrl: '',
      };
      state.instances.push(inst);
      state.selectedInstance = inst;
      hideMain();
      $('inst-detail').classList.remove('hidden');
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
  bindVerticalResizer('console-top-resizer', 'console-pane', 'up');
  // 控制台下方（输入框上方）：拉伸输入区
  bindVerticalResizer('input-top-resizer', 'input', 'up');

  // ── 右键菜单 ──
  // ── 3 权限审批弹窗 ──
  function showApprovalDialog(payload) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('approval.title');
      $('modal-body').innerHTML =
        '<div style="margin-bottom:8px">' + escapeHtml(payload.action || '') + '</div>' +
        '<div class="muted">' + t('approval.hint') + '</div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = async () => {
          root.classList.add('hidden');
          await fn();
        };
        acts.appendChild(b);
      };
      mk(t('common.cancel'), 'btn-mini', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.deny'), 'btn-mini', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.once'), 'btn-primary', () => resolve({ allowed: true, scope: 'once' }));
      mk(t('approval.project'), 'btn-mini', () => resolve({ allowed: true, scope: 'project' }));
      mk(t('approval.global'), 'btn-mini', () => resolve({ allowed: true, scope: 'global' }));
      root.classList.remove('hidden');
    });
  }
  window.ccarmy.onApprovalRequest?.(async (d) => {
    const r = await showApprovalDialog(d);
    await window.ccarmy.approvalRespond(d.id, r.allowed, r.scope);
  });

  function openContextMenu(x, y, items) {
    closeContextMenu();
    const el = document.createElement('div');
    el.className = 'ctx-menu';
    el.id = 'ctx-menu';
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'ctx-sep';
        el.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      if (it.danger) b.classList.add('danger');
      if (it.checked) b.classList.add('on');
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
    document.getElementById('ctx-menu')?.remove();
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
        label: running ? t('ctx.close') : t('ctx.enable'),
        onClick: async () => {
          if (running) {
            if (sessionHasBlockingTasks(inst.id)) {
              uiAlert(t('ctx.taskRunning'));
              return;
            }
            const ok = await uiConfirm(t('ctx.closeConfirm'));
            if (!ok) return;
            await window.ccarmy.stopInstance(inst.id);
            inst.status = 'stopped';
          } else {
            try {
              await window.ccarmy.spawnInstance({ id: inst.id, name: inst.name, dutyEligible: true });
              inst.status = 'running';
            } catch (e) {
              uiAlert(String(e.message || e));
            }
          }
          renderList();
        },
      },
      {
        label: t('ctx.settings'),
        onClick: () => {
          state.selectedInstance = inst;
          setNav('instances');
        },
      },
      {
        label: t('ctx.rename'),
        onClick: async () => {
          const name = await uiPrompt(t('ctx.renamePrompt'), inst.name);
          if (!name) return;
          inst.name = name;
          renderList();
          if (state.selectedInstance?.id === inst.id) renderInstanceDetail();
        },
      },
      {
        label: t('ctx.archive'),
        onClick: async () => {
          const ok = await uiConfirm(t('ctx.archiveConfirm'));
          if (!ok) return;
          inst.archived = true;
          await window.ccarmy.archivedAdd({ id: inst.id, name: inst.name, kind: 'agent' }).catch(() => {});
          uiAlert(t('instances.saved'));
          renderList();
        },
      },
      {
        label: t('ctx.clear'),
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
        label: t('ctx.notify') + (inst.notify ? ' ✓' : ''),
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
        label: t('ctx.rename'),
        onClick: async () => {
          const name = await uiPrompt(t('ctx.renamePrompt'), g.name);
          if (!name) return;
          g.name = name;
          renderList();
        },
      },
      joined
        ? {
            label: t('ctx.delete'),
            danger: true,
            onClick: async () => {
              if (blocked) {
                uiAlert(t('ctx.taskRunning'));
                return;
              }
              const ok = await uiConfirm(t('ctx.closeConfirm'));
              if (!ok) return;
              const dr = await window.ccarmy.groupDissolve(g.id).catch(() => null);
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
            label: t('ctx.leave'),
            danger: true,
            onClick: async () => {
              // 本机单节点部署下，群记录只存在这台机器上，
              // 因此「退出」与「解散」的效果一致；都必须在存储里删掉，
              // 否则下次启动 syncGroupsFromStore() 会把它拉回来。
              await window.ccarmy.groupDissolve(g.id).catch(() => null);
              state.groups = state.groups.filter((x) => x.id !== g.id);
              renderList();
            },
          },
      g.type === 'internal'
        ? {
            label: t('ctx.archive'),
            onClick: async () => {
              const ok = await uiConfirm(t('ctx.archiveConfirm'));
              if (!ok) return;
              g.archived = true;
              uiAlert(t('instances.saved'));
            },
          }
        : null,
      {
        label: t('ctx.notify') + (g.notify ? ' ✓' : ''),
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
  $('list-body')?.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.list-item, .list-card, .enter-hq-wrap')) return;
    if (!['singleAi', 'internalGroup', 'externalGroup', 'externalChat'].includes(state.nav)) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { label: t('list.sortByTime'), checked: state.listSort !== 'name', onClick: () => setListSort('time') },
      { label: t('list.sortByName'), checked: state.listSort === 'name', onClick: () => setListSort('name') },
    ]);
  });

  // ── 加入请求处理 ──
  async function refreshJoinBadge() {
    const r = await window.ccarmy.joinPending().catch(() => null);
    const n = r?.count || 0;
    const badge = $('join-badge');
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n === 0);
    }
  }
  
  refreshJoinBadge();

  function showJoinRequestModal(req) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('join.requestBadge');
      $('modal-body').innerHTML =
        '<div>' + t('join.requester') + ': ' + escapeHtml(req.name) + '</div>' +
        '<div>' + t('join.kind') + ': ' + escapeHtml(req.kind) + '</div>' +
        '<div>' + t('join.target') + ': ' + escapeHtml(req.targetType) + ' ' + escapeHtml(req.target) + '</div>' +
        '<div>' + t('join.applyTime') + ': ' + new Date(req.ts).toLocaleString() + '</div>' +
        '<div>' + t('join.expireTime') + ': ' + new Date(req.expireAt).toLocaleString() + '</div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = async () => { root.classList.add('hidden'); await fn(); };
        acts.appendChild(b);
      };
      mk(t('join.reject'), 'btn-mini', () => resolve('reject'));
      mk(t('join.blacklist'), 'btn-danger', () => resolve('block'));
      mk(t('join.agree'), 'btn-primary', () => resolve('agree'));
      root.classList.remove('hidden');
    });
  }

  document.querySelectorAll('[data-nav="instances"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const r = await window.ccarmy.joinPending().catch(() => null);
      if (r?.items?.length) {
        const req = r.items[0];
        const action = await showJoinRequestModal(req);
        await window.ccarmy.joinRespond({ id: req.id, action });
        refreshJoinBadge();
        uiAlert(t('instances.saved'));
      }
    });
  });

  // ── 进度折叠 ──
  $('progress-toggle')?.addEventListener('click', () => {
    $('progress-toggle')?.classList.toggle('open');
    $('task-list')?.classList.toggle('hidden');
  });

  // ── only-group 显示/隐藏 ──
  function updatePanelVisibility() {
    const isGroup = state.selectedChat && (state.selectedChat.kind === 'internal' || state.selectedChat.kind === 'extgroup');
    document.querySelectorAll('.only-group').forEach((el) => {
      el.classList.toggle('hidden', !isGroup);
    });
  }

  // ── 模型管理（会话右侧）──
  let __mgrOpen = new Set();
  function renderModelMgr() {
    const box = $('model-mgr');
    if (!box) return;
    const sel = state.selectedChat;
    if (!sel) {
      box.innerHTML = '<div class="muted">' + t('panel.modelMgrEmpty') + '</div>';
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
          : { inst: { name: nm, availableModels: [], chain: [], defaultModel: '' }, editable: false };
      });
    } else {
      const local =
        state.instances.find((i) => i.id === sel.id) ||
        state.instances.find((i) => i.name === sel.name);
      if (local) entries = [{ inst: local, editable: true }];
    }
    if (!entries.length) {
      box.innerHTML = '<div class="muted">' + t('panel.modelMgrEmpty') + '</div>';
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
    return p ? p.label : '—';
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
    const open = __mgrOpen.has(idx) ? ' open' : '';
    return `<details class="mgr-card${editable ? '' : ' readonly-panel'}" data-mgidx="${idx}"${open}>
      <summary>
        <img class="av-img small" src="${escapeHtml(instanceAvatarSrc(inst))}" alt=""/>
        <span class="mgr-name">${escapeHtml(inst.name || inst.id || '')}</span>
        ${editable ? '' : '<span class="mgr-ro">' + t('panel.modelMgrReadonly') + '</span>'}
      </summary>
      <div class="mgr-body">
        <label class="mgr-lb">${t('instances.defaultModel')}</label>
        <select data-mg="default" data-i="${idx}"${dis}>
          <option value="__smart__"${!inst.defaultModel ? ' selected' : ''}>${t('instances.smartPick')}</option>
          ${models.map((m) => `<option value="${escapeHtml(m)}"${inst.defaultModel === m ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <label class="mgr-lb">${t('instances.availableModels')}</label>
        <div class="mgr-models">${
          models.length
            ? models.map((m) => `<span class="model-chip">${escapeHtml(m)}${
                editable ? `<button class="x" data-mgdel="${idx}" data-m="${escapeHtml(m)}" title="${t('settings.removeModel')}">×</button>` : ''
              }</span>`).join('')
            : '<span class="muted">' + t('settings.modelsEmpty') + '</span>'
        }</div>
        <label class="mgr-lb">${t('instances.fallbackChain')}</label>
        <ol class="mgr-chain">${
          chain.length
            ? chain.map((m, k) => `<li data-chain="${idx}" data-k="${k}"${editable ? ' draggable="true"' : ''}>
                <span class="mgr-chain-name">${escapeHtml(m)}</span>
                <span class="mgr-chain-meta">${escapeHtml(providerLabelOf(m))} · ${escapeHtml(latencyText(m))}</span>
                ${editable ? `<button class="btn-mini" data-mgtest="${idx}" data-m="${escapeHtml(m)}" title="${t('model.test')}">⚡</button>` : ''}
              </li>`).join('')
            : '<li class="muted">—</li>'
        }</ol>
        ${editable ? `<div class="mgr-add-row"><button class="btn-mini" data-mgadd="${idx}">＋ ${t('instances.addModel')}</button></div>` : ''}
      </div>
    </details>`;
  }

  function bindModelMgr(entries) {
    const box = $('model-mgr');
    if (!box) return;
    box.querySelectorAll('details.mgr-card').forEach((d) => {
      d.addEventListener('toggle', () => {
        const i = Number(d.dataset.mgidx);
        if (d.open) __mgrOpen.add(i);
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
    box.querySelectorAll('.mgr-chain li[draggable="true"]').forEach((li) => {
      li.ondragstart = (e) => {
        dragFrom = { idx: Number(li.dataset.chain), k: Number(li.dataset.k) };
        li.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', String(li.dataset.k)); } catch { /* noop */ }
      };
      li.ondragend = () => { li.classList.remove('dragging'); dragFrom = null; };
      li.ondragover = (e) => { e.preventDefault(); li.classList.add('drop-target'); };
      li.ondragleave = () => li.classList.remove('drop-target');
      li.ondrop = (e) => {
        e.preventDefault();
        li.classList.remove('drop-target');
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
        const label = b.textContent;
        b.textContent = '…';
        try {
          const p = (state.providers || []).find((x) => (x.models || []).includes(model));
          const t0 = performance.now();
          const r = await window.ccarmy.listModels({ protocol: p && p.protocol, baseURL: p && p.baseURL, apiKey: p && p.apiKey });
          const ms = Math.round(performance.now() - t0);
          if (r && r.ok) {
            if (!state.modelLatency) state.modelLatency = {};
            state.modelLatency[model] = ms;
          }
        } catch {
          /* noop */
        }
        b.disabled = false;
        b.textContent = label;
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
      const root = $('modal-root');
      $('modal-title').textContent = t('model.addTitle');
      const body = $('modal-body');
      const provs = state.providers || [];
      body.innerHTML = `<div class="field">
          <label>${t('model.pickProvider')}</label>
          <div style="display:flex;gap:6px">
            <select id="mp-prov" style="flex:1">${provs.map((p, i) => `<option value="${i}">${escapeHtml(p.label || p.id)}</option>`).join('')}</select>
            <button class="btn-mini" id="mp-fetch">${t('model.fetch')}</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px">${t('model.fetchHint')}</div>
        <div class="model-pick-list" id="mp-list"></div>`;
      const listBox = $('mp-list');
      const renderList = () => {
        const p = provs[Number($('mp-prov').value)] || {};
        const have = new Set(inst.availableModels || []);
        const cand = (p.models || []).filter((m) => !have.has(m));
        listBox.innerHTML = cand.length
          ? cand.map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}"/> ${escapeHtml(m)}</label>`).join('')
          : `<div class="muted">${t('model.noneAvailable')}</div>`;
      };
      renderList();
      $('mp-prov').onchange = renderList;
      $('mp-fetch').onclick = async () => {
        const btn = $('mp-fetch');
        btn.textContent = t('common.loading');
        const p = provs[Number($('mp-prov').value)] || {};
        try {
          const r = await window.ccarmy.listModels({ protocol: p.protocol, baseURL: p.baseURL, apiKey: p.apiKey });
          if (r && r.ok && r.models && r.models.length) {
            p.models = [...new Set([...(p.models || []), ...r.models])];
          }
        } catch {
          /* noop */
        }
        btn.textContent = t('model.fetch');
        renderList();
      };
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); resolve(null); };
      const okAdd = document.createElement('button');
      okAdd.className = 'btn-primary';
      okAdd.textContent = t('model.addSelected');
      okAdd.onclick = () => {
        const picked = Array.from(listBox.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
        root.classList.add('hidden');
        resolve(picked);
      };
      acts.append(cancel, okAdd);
      root.classList.remove('hidden');
    });
  }

  // ── 搜索浮窗 ──
  function showSearchPopup() {
    const root = $('modal-root');
    $('modal-title').textContent = t('list.search');
    $('modal-body').innerHTML = '<input id="search-popup-input" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="' + t('list.search') + '"/><div id="search-popup-results" class="muted" style="margin-top:8px;max-height:200px;overflow:auto"></div>';
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'btn-mini';
    close.textContent = t('common.close');
    close.onclick = () => { root.classList.add('hidden'); };
    acts.appendChild(close);
    root.classList.remove('hidden');
    const inp = $('search-popup-input');
    inp?.focus();
    let timer = null;
    inp?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (!q) { $('search-popup-results').textContent = ''; return; }
        const r = await window.ccarmy.searchMessages(q).catch(() => null);
        const hits = r?.hits || [];
        $('search-popup-results').innerHTML = hits.length
          ? hits.map((x) => '<div style="padding:4px 0;border-bottom:1px solid var(--line)">' + escapeHtml(x.snippet) + '</div>').join('')
          : t('list.empty');
      }, 300);
    });
  }

  // ── 导出弹窗 ──
  function showExportDialog() {
    const root = $('modal-root');
    $('modal-title').textContent = t('chat.export');
    $('modal-body').innerHTML =
      '<div style="margin-bottom:8px">' + t('export.hint') + '</div>' +
      '<div class="muted">' + t('export.include') + '</div>';
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn-mini';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('hidden'); };
    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = t('chat.export');
    ok.onclick = async () => {
      if (!state.selectedChat) { root.classList.add('hidden'); return; }
      const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
      const r = await window.ccarmy.exportSession({
        title: state.selectedChat.name,
        labels: { header: t('export.header'), me: t('export.me') },
        messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
      });
      root.classList.add('hidden');
      uiAlert(r?.ok ? r.path : t('common.error'));
    };
    acts.append(cancel, ok);
    root.classList.remove('hidden');
  }

  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('list-search').addEventListener('input', () => renderList());
  $('btn-send').addEventListener('click', () => send());
  $('btn-stop-all')?.addEventListener('click', () => stopAllAi());
  $('btn-attach').addEventListener('click', async () => {
    const r = await window.ccarmy.pickFile();
    if (r?.ok) {
      const name = r.path.split(/[\\/]/).pop();
      state.attachments.push({ name, path: r.path });
      renderAttach();
    }
  });

  bindResizer($('col-resizer'), '--list-w', 200, 420);
  bindResizer($('panel-resizer'), '--panel-w', 220, 480);

  async function refreshCost() {
    const box = $('cost-box');
    if (!box) return;
    const c = await window.ccarmy.costSummary().catch(() => null);
    if (c?.ok) {
      box.textContent = '¥' + c.estCostCny + ' · ' + c.promptTokens + ' in / ' + c.completionTokens + ' out · cache ' + ((c.cacheHitRate||0)*100).toFixed(1) + '%';
    }
  }
  

  async function refreshMetrics() {
    const box = $('metrics-box');
    if (!box) return;
    try {
      const m = await window.ccarmy.metricsSummary();
      if (!m?.ok) return;
      box.textContent = `turns=${m.turns} · cache=${((m.cacheHitRate || 0) * 100).toFixed(1)}% · ccr=${((m.ccrRatio || 1) * 100).toFixed(0)}% · avg=${m.avgDurationMs}ms`;
      const cost = await window.ccarmy.costSummary().catch(() => null);
      if (cost?.ok) {
        box.textContent += ` · ¥${cost.estCostCny}`;
      }
    } catch {
      /* noop */
    }
  }

  /** 成本明细：按会话 / 按模型聚合，可导出 CSV */
  async function renderCostDash() {
    const box = $('cost-dash');
    if (!box) return;
    const r = await window.ccarmy.metricsTurns().catch(() => null);
    const turns = (r && r.turns) || [];
    if (!turns.length) {
      box.innerHTML = '<div class="muted">' + t('cost.empty') + '</div>';
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
      const body = rows
        .slice(0, 8)
        .map(
          ([k, v]) =>
            '<tr><td>' + escapeHtml(String(k).slice(0, 18)) + '</td><td>' + v.turns + '</td><td>' + v.tokens +
            '</td><td>' + v.cost.toFixed(4) + '</td></tr>'
        )
        .join('');
      return '<table class="cost-table">' + head + body + '</table>';
    };
    box.innerHTML =
      '<div class="cost-sub">' + t('cost.bySession') + '</div>' + table(agg('sessionId'), t('cost.session')) +
      '<div class="cost-sub">' + t('cost.byModel') + '</div>' + table(agg('model'), t('cost.model'));

    const btn = $('btn-cost-csv');
    if (btn) {
      btn.onclick = async () => {
        const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
        const lines = ['dimension,key,turns,tokens,cost_cny'];
        for (const [label, key] of [['session', 'sessionId'], ['model', 'model']]) {
          agg(key).forEach(([k, v]) => lines.push([label, esc(k), v.turns, v.tokens, v.cost.toFixed(6)].join(',')));
        }
        const rr = await window.ccarmy.saveText({
          defaultName: 'ccarmy-cost.csv',
          content: lines.join('\n'),
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (rr && rr.ok) uiAlert(t('instances.saved'));
        else if (rr && rr.error) uiAlert(String(rr.error));
      };
    }
  }

  $('cost-toggle')?.addEventListener('click', () => {
    const body = $('cost-body');
    if (!body) return;
    body.classList.toggle('hidden');
    $('cost-toggle').classList.toggle('open', !body.classList.contains('hidden'));
    if (!body.classList.contains('hidden')) renderCostDash();
  });

  async function refreshCheckpoints() {
    const box = $('cp-detail-list') || $('cp-list');
    const space = $('cp-space');
    if (!box) return;
    const r = await window.ccarmy.checkpointList();
    const list = r?.list || [];
    const maxMb = 50;
    const usedMb = Math.min(maxMb, list.length * 0.5);
    if (space) {
      space.textContent = `${t('checkpoints.used')} ${usedMb.toFixed(1)}MB / ${t('checkpoints.max')} ${maxMb}MB`;
    }
    if (!list.length) {
      box.innerHTML = `<div class="muted">${t('checkpoints.empty')}</div>`;
      return;
    }
    const now = Date.now();
    box.innerHTML = list
      .slice(0, 12)
      .map((c) => {
        const d = new Date(c.createdAt);
        const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const when = now - c.createdAt < 86400000 ? hm : d.toLocaleString();
        return `<details class="cp-item" data-id="${escapeHtml(String(c.id))}">
          <summary>${escapeHtml(String(when))} · ${escapeHtml(String(c.phase || ''))} · ${escapeHtml(String(c.strategy || ''))}</summary>
          <div class="cp-body">
            <div>${t('checkpoints.tasks')}: ${escapeHtml(c.phase || '')}</div>
            <ul>
              <li>${t('checkpoints.changed')}: ${escapeHtml((c.filesChanged || []).map((f) => f.path).join(', ') || '—')}</li>
              <li>${t('checkpoints.created')}: ${escapeHtml((c.filesCreated || []).map((f) => f.path).join(', ') || c.dir)}</li>
              <li>${t('checkpoints.irreversible')}: ${escapeHtml((c.irreversible || []).join(', ') || '—')}</li>
              <li>${t('checkpoints.assets')}: ${escapeHtml((c.assets || []).join(', ') || '—')}</li>
            </ul>
          </div>
          <div class="cp-actions">
            <button class="btn-mini" data-load="${c.id}">${t('checkpoints.stopAndLoad')}</button>
          </div>
        </details>`;
      })
      .join('');
    box.querySelectorAll('[data-load]').forEach((b) => {
      b.onclick = async () => {
        const ok = await uiConfirm(t('checkpoints.confirmBody'), t('checkpoints.confirmTitle'));
        if (!ok) return;
        await window.ccarmy.checkpointRollback(b.dataset.load);
        uiAlert(t('instances.saved'));
        refreshCheckpoints();
      };
    });
  }

  $('btn-cp-start')?.addEventListener('click', async () => {
    await window.ccarmy.checkpointCreate('round_start');
    refreshCheckpoints();
  });
  $('btn-cp-end')?.addEventListener('click', async () => {
    await window.ccarmy.checkpointCreate('round_end');
    refreshCheckpoints();
  });
  $('btn-cp-list')?.addEventListener('click', refreshCheckpoints);
  async function refreshSessionBoard() {
    const box = $('board-sess-box');
    if (!box || !state.selectedChat) return;
    const r = await window.ccarmy.boardSession(state.selectedChat.id).catch(() => null);
    const tasks = r?.tasks || [];
    box.innerHTML = tasks.length
      ? tasks.map((t) => '<div>' + escapeHtml(t.title) + ' · ' + clampPercent(t.progress) + '% · ' + escapeHtml(String(t.status || '')) + '</div>').join('')
      : '—';
  }
  /** 卡顿自检：主进程 CPU/事件循环延迟 + 渲染进程帧率 */
  function bindDiagnostics() {
    // 设置页每次重渲染都会产生新的按钮元素，必须每次都重新绑定
    const btn = $('btn-diag-run');
    if (!btn) return;
    btn.onclick = async () => {
      const out = $('diag-out');
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
      const d = await window.ccarmy.diagnostics().catch(() => null);
      if (!d || !d.ok) {
        out.textContent = '—';
        return;
      }
      const heapMb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      const cell = (k, v) => '<div class="diag-cell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
      const bad = d.cpuPercent > 60 || d.loopLagMs > 50 || fps < 30;
      out.innerHTML =
        '<div class="diag-grid">' +
        cell(t('diag.mainCpu'), d.cpuPercent + '%') +
        cell(t('diag.loopLag'), d.loopLagMs + ' ms') +
        cell(t('diag.rss'), d.rssMb + ' MB') +
        cell(t('diag.heap'), heapMb === null ? '—' : heapMb + ' MB') +
        cell(t('diag.fps'), fps + ' fps') +
        cell(t('diag.reqAnim'), d.handles + ' / ' + d.requests) +
        cell(t('diag.uptime'), d.uptimeSec + ' s') +
        '</div>' +
        '<div class="diag-verdict' + (bad ? ' bad' : '') + '">' + t(bad ? 'diag.verdictBad' : 'diag.verdictOk') + '</div>';
    };
  }

  async function renderSkillList() {
    const box = $('skill-list');
    if (!box) return;
    const importBtn = $('btn-skill-import');
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = '1';
      importBtn.onclick = async () => {
        const r = await window.ccarmy.skillsImport();
        if (r && r.ok) {
          uiAlert(t('settings.skillsImported') + ': ' + r.id);
          renderSkillList();
        } else if (r && r.error) {
          uiAlert(String(r.error));
        }
      };
    }
    try {
      const pr = await window.ccarmy.skillsPaths();
      const pb = $('skill-paths');
      if (pb) pb.textContent = t('settings.skillsPaths') + ': ' + ((pr && pr.paths) || []).join('  ·  ');
    } catch {
      /* noop */
    }
    try {
      const r = await window.ccarmy.skillsList();
      const items = (r && r.skills) || [];
      if (!items.length) {
        box.className = 'muted';
        box.textContent = t('settings.skillsEmpty');
        return;
      }
      box.className = '';
      box.innerHTML = items
        .map(
          (s) => `<div class="skill-row">
            <div class="skill-main">
              <div class="skill-name">${escapeHtml(s.name || s.id)}</div>
              <div class="muted skill-desc">${escapeHtml(s.description || '—')}</div>
              <div class="muted skill-src">${t('settings.skillFrom')}: ${escapeHtml(s.source || '')}</div>
            </div>
            <button class="btn-danger" data-skill-del="${escapeHtml(s.id)}">${t('settings.skillRemove')}</button>
          </div>`
        )
        .join('');
      box.querySelectorAll('[data-skill-del]').forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.skillDel;
          if (!(await uiConfirm(t('settings.skillRemove') + ': ' + id + '?'))) return;
          const rr = await window.ccarmy.skillsRemove(id);
          if (rr && rr.ok === false) uiAlert(String(rr.error || ''));
          renderSkillList();
        };
      });
    } catch {
      box.className = 'muted';
      box.textContent = t('settings.skillsEmpty');
    }
  }

  async function refreshMembers() {
    const box = $('members-box');
    if (!box || !state.selectedChat) return;
    const r = await window.ccarmy.groupMembers(state.selectedChat.id).catch(() => null);
    const ms = (r && r.members) || [];
    // R11 三态：在线正常 / 异地离线（灰 + 离线角标）/ 组网关闭（异地成员灰 + 异常角标）
    // R12：停用实例灰 + 名字删除线（灰色仍满足对比度 ≥ 3.0，见 --ink-dim）
    box.innerHTML = ms.length
      ? ms
          .map((x) => {
            const v = memberVisual(state.selectedChat.id, x);
            const badge =
              v.kind === 'disabled'
                ? { state: 'disabled', key: 'group.memberDisabled' }
                : v.kind === 'meshOff'
                  ? { state: 'mesh-off', key: 'group.memberMeshOff' }
                  : v.kind === 'offline'
                    ? { state: 'offline', key: 'group.memberOffline' }
                    : v.kind === 'remoteOnline'
                      ? { state: 'remote-online', key: 'group.memberOnline' }
                      : null;
            const cls =
              v.kind === 'disabled'
                ? ' is-disabled'
                : v.kind === 'meshOff'
                  ? ' is-mesh-off'
                  : v.kind === 'offline'
                    ? ' is-offline'
                    : '';
            return (
              '<div class="member-row' + cls + '" data-mid="' + escapeHtml(String(x.id || x.name)) + '" data-state="' + v.kind + '">' +
              '<span class="member-name' + (v.kind === 'disabled' ? ' struck' : '') + '">' +
              escapeHtml(x.name) + ' · ' + escapeHtml(String(x.role || '')) +
              '</span>' +
              (v.remote ? '<span class="member-badge remote" data-state="remote">' + escapeHtml(t('group.memberRemote')) + '</span>' : '') +
              (badge ? '<span class="member-badge" data-state="' + badge.state + '">' + escapeHtml(t(badge.key)) + '</span>' : '') +
              '<button class="btn-mini" data-mkick="' + escapeHtml(String(x.id || x.name)) + '">' + t('group.kick') + '</button>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="muted">' + t('group.memberEmpty') + '</div>';
    box.querySelectorAll('[data-mkick]').forEach((b) => {
      b.onclick = async () => {
        await window.ccarmy.groupKick({ groupId: state.selectedChat.id, memberId: b.dataset.mkick });
        refreshMembers();
      };
    });
    // 可选牛马下拉（排除已在群里的）
    const pick = $('member-pick');
    if (pick) {
      const inGroup = new Set(ms.map((x) => x.name));
      const cand = (state.instances || []).filter((i) => !inGroup.has(i.name));
      pick.innerHTML = cand.length
        ? cand.map((i) => '<option value="' + escapeHtml(i.id) + '">' + escapeHtml(i.name) + '</option>').join('')
        : '<option value="">' + t('group.memberEmpty') + '</option>';
    }
  }
  $('btn-member-add')?.addEventListener('click', async () => {
    const pick = $('member-pick');
    if (!pick || !state.selectedChat) return;
    const instId = pick.value;
    if (!instId) return;
    const inst = (state.instances || []).find((i) => i.id === instId);
    // R10：添加异地成员前先检查组网开关；没开就问一句是否进设置打开
    if (instanceIsRemote(inst) && !netState.enabled) {
      const go = await uiConfirm(fmtKey('net.addRemoteBody', { name: (inst && inst.name) || instId }), t('net.addRemoteTitle'));
      if (go) gotoNetSettings();
      return;
    }
    try {
      const r = await window.ccarmy.groupJoinInstance(state.selectedChat.id, instId);
      if (r && r.ok === false) {
        await window.ccarmy.groupInvite({ groupId: state.selectedChat.id, name: (inst && inst.name) || instId });
      }
    } catch {
      await window.ccarmy.groupInvite({ groupId: state.selectedChat.id, name: (inst && inst.name) || instId });
    }
    refreshMembers();
  });
  

  // Q. 错误重试
  async function checkLastError() {
    const r = await window.ccarmy.lastError().catch(() => null);
    if (r?.error) {
      // 简单提示 + 可重试
      const ok = await uiConfirm(t('common.error') + ': ' + r.error.message.slice(0, 80) + ' · ' + t('common.retry'), t('common.error'));
      if (ok && state.selectedChat) {
        await window.ccarmy.clearError();
        send();
      } else {
        await window.ccarmy.clearError();
      }
    }
  }
  

  // R. 启动引导：让用户「选」语言，而不是手输 locale 字符串
  function pickOnboardingLocale() {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('settings.language');
      $('modal-body').innerHTML =
        '<div class="field"><select id="setup-locale">' +
        '<option value="zh-CN">' + t('settings.localeZh') + '</option>' +
        '<option value="en-US">' + t('settings.localeEn') + '</option>' +
        '</select></div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-mini';
      closeBtn.textContent = t('common.close');
      closeBtn.onclick = () => { root.classList.add('hidden'); resolve(null); };
      const okBtn = document.createElement('button');
      okBtn.className = 'btn-primary';
      okBtn.textContent = t('common.ok');
      okBtn.onclick = () => {
        const v = $('setup-locale') ? $('setup-locale').value : 'zh-CN';
        root.classList.add('hidden');
        resolve(v);
      };
      acts.append(closeBtn, okBtn);
      root.classList.remove('hidden');
    });
  }

  async function maybeShowSetup() {
    const st = await window.ccarmy.setupState().catch(() => null);
    if (!st || st.done) return;
    const pick = await pickOnboardingLocale();
    if (pick) {
      await window.ccarmy.setupComplete({ locale: pick }).catch(() => {});
      if (!state.locale.startsWith(String(pick).slice(0, 2))) {
        try { await loadI18n(pick); } catch { /* noop */ }
      }
      await window.ccarmy.settingsSave({ locale: pick }).catch(() => {});
    } else {
      await window.ccarmy.setupComplete({}).catch(() => {});
    }
  }
  maybeShowSetup();

  async function refreshExecutors() {
    const box = $('exec-box');
    if (!box) return;
    const r = await window.ccarmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + escapeHtml(String(it.status || '')) + ' · ' + escapeHtml(String(it.durationMs ?? 0)) + 'ms</div>').join('')
      : '—';
  }
  $('btn-exec-run')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.ccarmy.executorsRunBrief({ brief, contextItems: [] });
    refreshExecutors();
  });
  

  /** 知识库检索：结果可点击跳转（跳到聊天搜索）并可删除 */
  async function runKbQuery(q) {
    const out = $('kb-out');
    if (!out) return;
    const r = await window.ccarmy.knowledgeQuery(q).catch(() => null);
    const det = await window.ccarmy.kbDetail(q).catch(() => null);
    const ents = (r && r.entities) || (det && det.entities) || [];
    const evs = (r && r.events) || [];
    const rows = [];
    ents.forEach((e) => {
      const id = String(e.id || e.name);
      rows.push(
        '<div class="kb-row"><button class="kb-link" data-kbent="' + escapeHtml(id) + '">' +
          escapeHtml(e.name || id) + '</button><span class="muted" style="font-size:11px">' + escapeHtml(String(e.kind || '')) + '</span>' +
          '<button class="btn-mini" data-kbdel="entity" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    evs.forEach((e) => {
      const id = String(e.id || e.title);
      rows.push(
        '<div class="kb-row"><button class="kb-link" data-kbev="' + escapeHtml(id) + '">' +
          escapeHtml(e.title || id) + '</button>' +
          '<button class="btn-mini" data-kbdel="event" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    out.innerHTML = rows.length ? rows.join('') : '<div class="muted">' + t('knowledge.empty') + '</div>';
    // 点击 → 跳到聊天搜索（把关键词带过去）
    out.querySelectorAll('.kb-link').forEach((b) => {
      b.onclick = () => {
        const kw = b.textContent || '';
        showSearchPopup();
        setTimeout(() => {
          const inp = $('search-popup-input');
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
        const rr = await window.ccarmy.kbDelete({ kind, id }).catch(() => null);
        if (rr && rr.ok === false) uiAlert(String(rr.error || ''));
        runKbQuery(q);
      };
    });
  }

  $('btn-kb-go')?.addEventListener('click', () => {
    const q = $('kb-q').value.trim();
    if (q) void runKbQuery(q);
  });

  // 加入项目/群聊：扫码或粘贴链接
  $('btn-join-qr')?.addEventListener('click', async () => {
    const root = $('modal-root');
    $('modal-title').textContent = t('join.title');
    const card = await myCard();
    $('modal-body').innerHTML =
      '<div class="muted" style="margin-bottom:8px">' + t('join.dropHint') + '</div>' +
      '<input type="file" id="join-qr-file" accept="image/*" style="margin-bottom:8px"/>' +
      '<div class="muted" style="margin-bottom:8px">' + t('join.scanHint') + '</div>' +
      '<input id="join-link-input" placeholder="' + t('join.pastePlaceholder') + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"/>' +
      '<div class="muted" style="margin-top:10px">' + escapeHtml(t('card.peerWillSee')) + '</div>' + myCardHtml(card) +
      '<div id="join-qr-msg" class="muted" style="margin-top:6px"></div>';
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn-mini';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('hidden'); };
    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = t('join.apply');
    ok.onclick = async () => {
      const link = $('join-link-input')?.value?.trim();
      if (!link) { $('join-qr-msg').textContent = t('join.qrFail'); return; }
      const r = await window.ccarmy.joinRequest({
        name: state.profile.username || 'user',
        kind: 'human',
        target: state.selectedChat?.name || link,
        targetType: state.selectedChat?.kind === 'internal' ? 'project' : 'group',
        // 附六：加入动作即交换名片（邮箱/手机号为空也照发，对方看到的是「未填写」而不是「被隐藏」）
        card: { email: card.email || '', phone: card.phone || '' },
      }).catch(() => null);
      $('join-qr-msg').textContent = r?.ok ? t('join.ok') : t('join.fail');
      setTimeout(() => root.classList.add('hidden'), 800);
    };
    acts.append(cancel, ok);
    root.classList.remove('hidden');
    // 文件选择后提示（完整二维码识别需 jsQR，这里提示粘贴链接）
    $('join-qr-file')?.addEventListener('change', () => {
      $('join-qr-msg').textContent = t('join.scanHint');
    });
  });

  $('btn-chat-search')?.addEventListener('click', async () => {
    const q = $('chat-search')?.value?.trim();
    if (!q) return;
    const r = await window.ccarmy.searchMessages(q).catch(() => null);
    const hits = r?.hits || [];
    pushMsg(state.selectedChat?.id || 'search', 'them', hits.length ? hits.map((x) => x.snippet).join('\n') : t('list.empty'));
    renderChat();
  });
  // T. 消息右键：复制/引用
  $('messages')?.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    e.preventDefault();
    const text = bubble.textContent || '';
    openContextMenu(e.clientX, e.clientY, [
      { label: t('common.copy'), onClick: () => { navigator.clipboard?.writeText(text); } },
      { label: t('common.quote'), onClick: () => {
          const inp = $('input');
          if (inp) inp.value = '> ' + text.slice(0, 120) + '\n' + inp.value;
        } },
    ]);
  });
  // W. 定向模式开关（聊天头）
  $('btn-open-win')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.ccarmy.openChatWindow({
      id: state.selectedChat.id,
      title: state.selectedChat.name,
      kind: state.selectedChat.kind,
    });
  });
  $('btn-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.ccarmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('btn-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.ccarmy.exportSession({
      title: state.selectedChat.name,
      messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });
  // 托盘 + 热键
  window.ccarmy.trayInit?.().catch(() => {});
  window.ccarmy.registerHotkey?.('CommandOrControl+Shift+M').catch(() => {});
  // 从 URL 参数自动打开会话（多窗口）
  try {
    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    if (mode === 'sub') {
      document.getElementById('titlebar')?.classList.add('hidden');
      document.getElementById('rail')?.classList.add('hidden');
      document.getElementById('list-col')?.classList.add('hidden');
      document.getElementById('app-body')?.classList.add('hide-list');
    }
    const cid = q.get('chatId');
    if (cid) {
      const title = q.get('chatTitle') || cid;
      const kind = q.get('chatKind') || 'single';
      setTimeout(() => openChat(kind, cid, title), 300);
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
      state.locale = 'zh-CN';
      state.t = { 'app.zhName': '无限牛马', 'app.enName': 'CCArmy', 'app.subtitle': 'Corporate Cattle Army', 'app.displayName': '无限牛马' };
      applyI18n();
    }
    try {
      const s = await window.ccarmy.settingsGet();
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
      const p = await window.ccarmy.profileGet();
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
      state.globalSecurity = (await window.ccarmy.securityMode()) || state.globalSecurity;
      state.hardware = await window.ccarmy.hardware();
      state.instances = (await window.ccarmy.listInstances()) || [];
    } catch {
      /* noop */
    }
    if (!state.instances.length) {
      state.instances = [
        {
          id: 'demo-1',
          name: 'demo.agent',
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
      const st = await window.ccarmy.stateLoad();
      if (st?.state) {
        if (Array.isArray(st.state.plugins) && st.state.plugins.length) state.plugins = st.state.plugins;
        if (Array.isArray(st.state.groups) && st.state.groups.length) state.groups = st.state.groups;
        if (Array.isArray(st.state.chats) && st.state.chats.length) state.chats = st.state.chats;
        if (st.state.listSort === 'name' || st.state.listSort === 'time') state.listSort = st.state.listSort;
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
    // 组网层：地址自动填入 + 横幅 + 1s 心跳（迟滞判定与重试都在 netInit 里）
    try {
      await netInit();
    } catch (e) {
      /* 组网层异常不能拖垮整个界面 */
    }
    // 变更时保存
    const saveState = () => {
      const instanceAvatars = {};
      state.instances.forEach((i) => {
        if (i.avatarPreset || i.avatarDataUrl) {
          instanceAvatars[i.id] = { avatarPreset: i.avatarPreset || 0, avatarDataUrl: i.avatarDataUrl || '' };
        }
      });
      window.ccarmy.stateSave({
        plugins: state.plugins,
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
