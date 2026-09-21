/* WArmy renderer — 文案全在 i18n；主题/分栏/模型拉取/附件/语音/总看板 */
(() => {
  const $ = (id) => document.getElementById(id);
  let pendingAvatarTarget = null;
  /**
   * 供应商列表的**出厂预设**（只在从来没有落盘过时用一次）。
   * 真正生效的列表一律以设置文件为准 —— 用户加过的供应商、拉到的模型、标红状态
   * 都写在 `settings.providers` 里（**密钥不在这里**：密钥走 safeStorage，见主进程）。
   */
  const PROVIDER_DEFAULTS = [
    { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', models: [] },
    { id: 'ollama', label: 'Ollama (本机)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5:7b', models: [] },
  ];
  const PROVIDER_PROTOCOLS = ['openai-compatible', 'anthropic', 'ollama'];
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
    listWidth: 200,
    panelWidth: 300,
    /**
     * R2：用户自己设的快捷键（动作 id → 组合键字符串）。
     * 只存**用户改过的**；没写过的动作走 SHORTCUT_ACTIONS 里的预置值。
     * 空串 = 用户显式解绑（不会回落到预置值）。走既有 settings 通道持久化。
     */
    shortcuts: {},
    attachments: [],
    profile: { loggedIn: false, username: 'nav.avatar', avatarDataUrl: '', email: '', deviceId: '', avatarPreset: 0 },
    queues: {},
    board: {
      /**
       * ADR：外部聚合看板 — 会话进展只读，点击跳转；值班者写 board.jsonl。
       *
       * ⚠️ 这里**刻意是空的**：以前预置了 4 个演示会话 + 4 条演示动态（demo.project1…），
       * 于是「总看板」在真数据还没来时显示得像"真的有 4 个项目在跑、刚刚完成了任务"
       * （时间戳还是相对现在算的，看着很新）。那属于"看起来在跑其实没跑"。
       * 现在：真数据一律来自 `warmy:board-aggregate` / `warmy:board-events`；
       * 没数据就由 renderDashboard() 如实显示"暂无…"。
       */
      sessions: [],
      /** board.jsonl 结构化事件（值班者解析写入） */
      events: [],
      recent: [],
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
    providers: PROVIDER_DEFAULTS.map((p) => ({ ...p, models: [] })),
  };

  const __CONSOLE_CAP_EARLY = 200;
  /** 设置页当前分区（跨 renderPage 保留，见 bindSettingsMenu） */
  let settingsSection = 'ui';

  /* ── 供应商列表的落盘（设置 → 模型） ────────────────────────────────
   * 事实来源 = 设置文件里的 `providers`；**密钥不在里面**（走 safeStorage）。
   * 这里只做三件事：读回来、写回去、把密钥存在与否问出来（永远读不回明文）。 */
  function providerRecordOf(p) {
    return {
      id: String(p.id || ''),
      label: String(p.label || ''),
      protocol: PROVIDER_PROTOCOLS.includes(p.protocol) ? p.protocol : 'openai-compatible',
      baseURL: String(p.baseURL || ''),
      defaultModel: String(p.defaultModel || ''),
      models: Array.isArray(p.models) ? p.models.map((m) => String(m)) : [],
      staleModels: (p.staleModels && typeof p.staleModels === 'object') ? { ...p.staleModels } : {},
      hasKey: !!p.hasKey,
    };
  }
  async function saveProviders() {
    try {
      await window.warmy.settingsSave({
        providers: state.providers.map(providerRecordOf),
        providersSeeded: true,
      });
    } catch { /* 写失败不影响本次界面；下次改动会再试 */ }
  }
  async function loadProvidersFromSettings() {
    let seeded = false;
    try {
      const r = await window.warmy.settingsGet?.();
      const saved = r?.settings?.providers;
      seeded = !!r?.settings?.providersSeeded;
      if (Array.isArray(saved) && (saved.length || seeded)) {
        state.providers = saved.map((p) => providerRecordOf(p));
      } else {
        // 从来没落盘过：用出厂预设初始化一次（之后一律以落盘为准，删光了也不会自己回来）
        state.providers = PROVIDER_DEFAULTS.map((p) => providerRecordOf({ ...p, models: [] }));
        await saveProviders();
      }
    } catch { /* 读不到就用内置预设顶着 */ }
    try {
      const ids = state.providers.map((p) => p.id);
      const h = await window.warmy.providerKeyHas?.({ providerIds: ids });
      if (h?.ok) state.providers.forEach((p) => { p.hasKey = !!h.has[p.id]; });
    } catch { /* 问不到就当没有：界面会显示"未设置密钥" */ }
  }
  window.__warmyReloadProviders = loadProvidersFromSettings;
  /**
   * 给**自动化门禁**用的两个钩子（真人从来不点这个）：
   *  · `__warmyRenderPage`：门禁要能"灌一份设置 → 立即按真实渲染路径重画"，
   *    否则只能靠静态文本断言（历史上正是这种弱断言把"没跑过"当成了"过了"）；
   *  · `__warmyProviders`：读回渲染层当前持有的供应商数组（只读快照）。
   */
  window.__warmyRenderPage = () => renderPage();
  const t = (k) => state.t[k] || k;
  /** 结构化值展示：对象绝不 textContent 直出（避免 [object Object]） */
  const fmtDisp = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.map(fmtDisp).join(' · ');
      return String(v.label || v.text || v.name || v.value || v.unit || '—');
    }
    return String(v);
  };
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
  function positionMenuFixed(trigger, caiDan) {
    if (!trigger || !caiDan) return;
    const r = trigger.getBoundingClientRect();
    caiDan.style.position = 'fixed';
    // .urg-menu 的 CSS 带 bottom:calc(100% + 6px)，不清掉会与 top 冲突、菜单被拉出视口
    caiDan.style.bottom = 'auto';
    caiDan.style.right = 'auto';
    caiDan.style.zIndex = '500';
    const mw = caiDan.offsetWidth || 170;
    const mh = caiDan.offsetHeight || 150;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const below = r.bottom + 4;
    const top = below + mh > window.innerHeight - 8 ? Math.max(8, r.top - 4 - mh) : below;
    caiDan.style.left = left + 'px';
    caiDan.style.top = top + 'px';
  }
  let __rafThrottle = false;
  function raf(fn) {
    if (__rafThrottle) return;
    __rafThrottle = true;
    requestAnimationFrame(() => { __rafThrottle = false; fn(); });
  }
  let __inputThrottle = 0;
  const providerCfgModel = (p) => p.defaultModel || (p.models && p.models[0]) || 'deepseek-chat';
  // Locale packs shipped under src/i18n/. Native names are intentionally not translated.
  const SUPPORTED_LOCALES = [
    ['zh-CN', '简体中文'],
    ['zh-TW', '繁體中文'],
    ['en-US', 'English'],
    ['ja', '日本語'],
    ['ko', '한국어'],
    ['ru', 'Русский'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['pt', 'Português'],
    ['eo', 'Esperanto'],
  ];
  function resolveLocalePack(locale) {
    if (!locale) return 'zh-CN';
    const raw = String(locale).trim();
    if (SUPPORTED_LOCALES.some((x) => x[0] === raw)) return raw;
    const l = raw.toLowerCase().replace('_', '-');
    if (l.startsWith('zh-tw') || l.startsWith('zh-hant') || l === 'zh-hk' || l === 'zh-mo') return 'zh-TW';
    if (l.startsWith('zh')) return 'zh-CN';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('pt')) return 'pt';
    if (l.startsWith('eo')) return 'eo';
    if (l.startsWith('en')) return 'en-US';
    return 'zh-CN';
  }
  function localeOptionsHtml(selected) {
    return SUPPORTED_LOCALES.map(([code, label]) => {
      const on = resolveLocalePack(selected) === code ? ' selected' : '';
      return `<option value="${code}"${on}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  const displayName = () =>
    state.t['app.displayName'] || state.t['brand.name'] || (state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName'));
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
        // 确认后**必须关上**：这里原本写成 remove('hidden')（= 保持打开），
        // 于是「采用新联系方式 / 已联系本人核实」等确认框点完确定还留在屏幕上，
        // 遮住整页（遮蔽层连顶部横幅一起挡住），用户以为没生效、也点不到下面的按钮。
        // 对照 uiConfirmCountdown / uiAlert 的实现：两者都是 add('hidden')。
        // 若调用方紧接着还要弹下一个框（uiAlert 会自己 remove('hidden')），不受影响。
        root.classList.add('hidden');
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
      const wangGe = document.createElement('div');
      wangGe.className = 'avatar-grid';
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
        wangGe.appendChild(b);
      });
      body.appendChild(wangGe);
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
    const tuPian = $('selfAvatarImg');
    const kuaDu = $('selfAvatar');
    const src = personAvatarSrc(state.profile);
    if (src) {
      tuPian.src = src;
      tuPian.classList.remove('hidden');
      kuaDu.classList.add('hidden');
    } else {
      tuPian.classList.add('hidden');
      tuPian.removeAttribute('src');
      kuaDu.classList.remove('hidden');
      kuaDu.textContent = (state.profile.username || t('nav.avatar')).slice(0, 1);
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
  function relLuminance(shiLiuJin) {
    const ch = [1, 3, 5]
      .map((i) => parseInt(shiLiuJin.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  /** 该颜色配白字的对比度 */
  function contrastWithWhite(shiLiuJin) {
    return 1.05 / (relLuminance(shiLiuJin) + 0.05);
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
    const kuadu = 20;
    const mubiao = 3.0;
    const maxLight = (hue, sat) => {
      let l = 64;
      while (l > 12 && contrastWithWhite(hslToHex(hue, sat, l)) < mubiao) l -= 1;
      return l;
    };
    const lieJi = [];
    for (const h of HUES) {
      const lmax = maxLight(h, SAT_TOP);
      const lmin = Math.max(FLOOR, lmax - kuadu);
      const col = [];
      for (let k = 0; k < ROWS; k++) {
        const l = lmax - k * ((lmax - lmin) / (ROWS - 1));
        col.push(hslToHex(h, Math.min(96, SAT_TOP + k * SAT_STEP), l));
      }
      lieJi.push(col);
    }
    const wangGe = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < HUES.length; c++) wangGe.push(lieJi[c][r]);
    return wangGe;
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
      const shiLiuJin = $('theme-picker-hex');
      const tongBu = () => {
        if (!input) return;
        const v = String(input.value || '#000000');
        swatch.style.background = v;
        const n = parseInt(v.slice(1), 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        shiLiuJin.textContent = v.toUpperCase() + '   rgb(' + r + ', ' + g + ', ' + b + ')';
      };
      if (input) {
        input.oninput = tongBu;
        input.onchange = tongBu;
      }
      tongBu();
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
    document.querySelectorAll('[data-i18n]').forEach((yuanSu) => {
      yuanSu.textContent = t(yuanSu.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((yuanSu) => {
      yuanSu.placeholder = t(yuanSu.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((yuanSu) => {
      yuanSu.title = t(yuanSu.getAttribute('data-i18n-title'));
    });
    $('logo-name').textContent = displayName();
    $('logo-sub').textContent = t('brand.sub');
    // Owner rule: top-left titlebar line = logo + tagline ONLY (no product name on that line).
    if ($('tb-brand')) $('tb-brand').textContent = t('brand.tagline') || t('about.tagline');
    if (typeof updateListWatermark === 'function') updateListWatermark();
        applyAvatar();
    document.title = displayName();
    syncTrayText();
    // T194：控制台表头/清空按钮也走 i18n（面板合着时只更新表头那一行）
    try { renderConsole(); } catch { /* 控制台还没初始化完 */ }
  }

  async function loadI18n(locale) {
    const pack = await window.warmy.i18n(locale);
    state.locale = pack.locale;
    state.t = pack.strings;
    if (pack.displayName) state.t['app.displayName'] = pack.displayName;
    window.__refreshUrgency?.();
    window.__refreshSecurity?.();
    applyI18n();
  }
  /** 语言可达性：设置页/预览桥/巡检脚本统一走这一条（10 语言包，禁止塌缩） */
  window.__warmyLoadI18n = loadI18n;


  /**
   * 隐私政策渲染：把 `【小节】正文` 形态的文本渲染成**分节卡片**，
   * 而不是一整块 pre-wrap 文本 —— 一整块看起来"和以前没区别"，也不像正式文档。
   */
  function privacyHtml(text) {
    const raw = String(text || '');
    return raw
      .split(/\n\s*\n/)
      .map((para) => {
        const p = para.trim();
        if (!p) return '';
        const m = p.match(/^【(.+?)】([\s\S]*)$/);
        if (m) {
          return '<section class="pv-sec"><h4>' + escapeHtml(m[1]) + '</h4><p>' + escapeHtml(m[2].trim()) + '</p></section>';
        }
        return '<p>' + escapeHtml(p) + '</p>';
      })
      .join('');
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
    document.querySelectorAll('.rail-item').forEach((yuanSu) => {
      yuanSu.classList.toggle('active', yuanSu.dataset.nav === nav);
    });
    hideMain();
    // 切页即重算右栏：未选中会话时一律隐藏会话卡片（不再出现"成员/进度"空占位）
    try { refreshPanelVisibility(); } catch { /* noop */ }
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
      const stillHere = !!cur && pipeiDaohang(cur, nav) && items.some((c) => c.id === cur.id);
      if (!stillHere && items.length) {
        openChat(items[0].kind, items[0].id, items[0].name);
        return;
      }
    }

    if (!state.selectedChat || !pipeiDaohang(state.selectedChat, nav)) {
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

  function pipeiDaohang(sel, nav) {
    if (!sel) return false;
    if (nav === 'singleAi') return sel.kind === 'single';
    if (nav === 'internalGroup') return sel.kind === 'internal';
    if (nav === 'externalChat') return sel.kind === 'extdm';
    if (nav === 'externalGroup') return sel.kind === 'extgroup';
    return false;
  }

  /**
   * 第二列顶部入口：项目/群聊 = 「+」（新建 / 加入）；联系人 = 「+」（添加联系人）。
   * 旧实现把"新建"和"加入"拆成两个按钮，产品要求合并到一个加号菜单里。
   */
  function setupListAction() {
    const btn = $('list-action');
    const jiaRuAnNiu = $('btn-join-qr');
    const plusKinds = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
    if (plusKinds && btn) {
      if (jiaRuAnNiu) jiaRuAnNiu.classList.add('hidden'); // 合并进「+」菜单，不再单独显示
      btn.classList.remove('hidden');
      btn.textContent = '+';
      btn.title = t('list.addMore') || 'Add…';
      btn.onclick = (e) => {
        e.stopPropagation();
        const old = $('list-plus-menu');
        if (old) { old.remove(); return; }
        const m = document.createElement('div');
        m.id = 'list-plus-menu';
        m.className = 'urg-menu list-plus-menu';
        const items = state.nav === 'externalChat'
          ? [{ k: 'contact', label: t('contact.add') }]
          : [
              { k: 'create', label: state.nav === 'internalGroup' ? t('list.createProject') : t('list.createGroupChat') },
              { k: 'join', label: state.nav === 'internalGroup' ? t('nav.addProject') : t('nav.addGroup') },
            ];
        m.innerHTML = items.map((it) => '<button type="button" data-lp="' + it.k + '">' + escapeHtml(it.label) + '</button>').join('');
        btn.parentElement.appendChild(m);
        m.querySelectorAll('button').forEach((b) => {
          b.onclick = (ev) => {
            ev.stopPropagation();
            m.remove();
            if (b.dataset.lp === 'create') createGroupFlow();
            else if (b.dataset.lp === 'join') { const jb = $('btn-join-qr'); if (jb) { jb.classList.remove('hidden'); jb.click(); } }
            else if (b.dataset.lp === 'contact') { const jb = $('btn-join-qr'); if (jb) { jb.classList.remove('hidden'); jb.click(); } }
          };
        });
        onDocClick(() => m.remove(), { once: true });
      };
      return;
    }
    // 其它页面（我的牛马等）保留原逻辑
    setupListActionLegacy();
  }

  function setupListActionLegacy() {
    const btn = $('list-action');
    const jiaRuAnNiu = $('btn-join-qr');
    if (jiaRuAnNiu) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      jiaRuAnNiu.classList.toggle('hidden', !showJoin);
      jiaRuAnNiu.title = t('join.qrHint');
      if (state.nav === 'internalGroup') jiaRuAnNiu.textContent = t('nav.addProject');
      else if (state.nav === 'externalGroup') jiaRuAnNiu.textContent = t('nav.addGroup');
      else if (state.nav === 'externalChat') {
        // R4：联系人页**只留这一个**添加按钮——右手那个 #list-action 原本同名同位（已知缺陷）。
        jiaRuAnNiu.textContent = t('contact.add');
        jiaRuAnNiu.title = t('contact.add');
      }
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.title = t(createKey);
      btn.classList.remove('hidden');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      // R4：这里不再出现第二个「添加联系人」。加联系人走 #btn-join-qr（带「我的链接/二维码」的那个弹窗）。
      btn.classList.add('hidden');
      btn.onclick = null;
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
    const yuanSu = document.createElement('div');
    yuanSu.className = 'list-item' + (active ? ' active' : '');
    if (avatarSrc) yuanSu.dataset.av = '1';
    yuanSu.innerHTML = `${avatarSrc ? `<img class="av-tuPian" src="${escapeHtml(avatarSrc)}" alt=""/>` : `<div class="av">${escapeHtml(ch || '?')}</div>`}<div class="meta"><div class="name">${escapeHtml(name)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    yuanSu.title = `${name}\n${sub}`;
    yuanSu.onclick = onClick;
    return yuanSu;
  }

  /** 列表行上的「身份变更待核实」常驻标记（附六：三个入口都能看到） */
  function attachIdChangeMark(hangYuanSu) {
    if (!hangYuanSu || hangYuanSu.querySelector('.id-change-mark')) return hangYuanSu;
    const m = document.createElement('span');
    m.className = 'id-change-mark';
    m.setAttribute('data-idchg-mark', '1');
    m.textContent = '! ' + t('idchg.pending');
    m.title = t('idchg.title') + ' · ' + t('idchg.marker');
    hangYuanSu.appendChild(m);
    return hangYuanSu;
  }

  /**
   * R12：停用（stopped）的牛马实例 → 整行灰 + 名字删除线（灰仍须可读，见 --ink-dim）。
   * R11 在成员列表里，列表行这里只处理实例自身的停用态。
   */
  function applyInstanceRowState(hangYuanSu, inst, sessionKind) {
    if (!hangYuanSu || !inst) return hangYuanSu;
    if (inst.status === 'stopped') {
      hangYuanSu.classList.add('is-disabled');
      const mingCheng = hangYuanSu.querySelector('.name');
      if (mingCheng) mingCheng.classList.add('struck');
      const b = document.createElement('span');
      b.className = 'row-badge off';
      b.setAttribute('data-state', 'disabled');
      b.textContent = t('group.memberDisabled');
      hangYuanSu.appendChild(b);
    }
    if (sessionKind && hasPendingIdChange(sessionKind, inst.id)) attachIdChangeMark(hangYuanSu);
    return hangYuanSu;
  }

  /**
   * 列表渲染 = 选择状态的唯一驱动。右栏分区必须跟着它走：
   * 之前只在 openChat 里调用分区函数，导致「自动选中会话」（启动恢复 / 同步群列表后
   * 自动选第一项）这条路径**不更新右栏** —— 项目已选中却看不到「成员」卡片。
   * 现在把分区刷新收口在 renderList 外层，所有路径都覆盖。
   */
  function renderList() {
    renderListInner();
    try { refreshPanelVisibility(); } catch { /* 分区失败不影响列表 */ }
  }

  function renderListInner() {
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
          const hangYuanSu = row(
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
          hangYuanSu.ondblclick = () => {
            setNav('singleAi');
            openChat('single', inst.id, inst.name);
          };
          applyInstanceRowState(hangYuanSu, inst, 'single');
          box.appendChild(hangYuanSu);
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
        const hangYuanSu = row(
          c.name,
          c.lastPreview || t('list.noReply'),
          c.name[0],
          () => openChat('single', c.id, c.name),
          state.selectedChat?.id === c.id,
          inst ? instanceAvatarSrc(inst) : null
        );
        const menuInst = inst || { id: c.id, name: c.name, status: 'stopped', notify: true };
        bindRowContext(hangYuanSu, () => agentMenu(menuInst, hangYuanSu));
        applyInstanceRowState(hangYuanSu, inst, 'single');
        box.appendChild(hangYuanSu);
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
        const hangYuanSu = row(
          g.name,
          `${t('group.type.' + g.type)} · ${g.members?.length || 0}`,
          g.name[0],
          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),
          state.selectedChat?.id === g.id
        );
        bindRowContext(hangYuanSu, () => qunCaidan(g, hangYuanSu));
        if (hasPendingIdChange(g.type === 'internal' ? 'internal' : 'extgroup', g.id)) attachIdChangeMark(hangYuanSu);
        box.appendChild(hangYuanSu);
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
        const hangYuanSu = row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, c.name), state.selectedChat?.id === c.id);
        if (hasPendingIdChange('extdm', c.id)) attachIdChangeMark(hangYuanSu);
        box.appendChild(hangYuanSu);
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
    xuanranFujian();
    renderChat();
    renderQueueBar();
    renderList();
    updatePanelVisibility();
    renderModelMgr();
    // ADR 004 第七批：右栏「项目状态 / 最近改动文件 / 其他文件 / 生成的产品」+ 容器控制台门禁。
    // 右侧顶部**不再有切换容器的入口**（切换容器在项目右键菜单里）。
    void renderProjectStateBlock();
    void renderProjectFilesBlock();
    void refreshContainerConsoleGate();
    // 附六：「下次进该会话」要重新出现（关闭只是暂时隐藏）
    void idRefreshForChat();
    // 右栏「进度」按当前会话拉真任务（没有就如实说"暂无任务"）
    void renderProgressTasks();
    /**
     * 从**主进程日志**补齐内容：主窗口与独立会话窗是同一个会话的两个视图，
     * 谁打开都读到同一份（新窗口以前是空白的，这是"记录不同步"的根因）。
     */
    void loadSessionMessages(id);
  }

  /**
   * 拉取某会话的正文并替换本地镜像（主进程日志是唯一事实来源）。
   *
   * 主进程那边没有内容（例如刚建、或记忆服务未回灌）时**保留本地已有**，绝不因此清空界面；
   * 本地那些"只给用户看的提示"（停止全部、报错、搜索结果）主进程日志里没有，
   * 因此做**合并**：以主进程的顺序为准，再把本地独有的几条按原顺序接在后面。
   */
  async function loadSessionMessages(id) {
    const sid = String(id || '');
    if (!sid) return;
    try {
      const r = await window.warmy.chatMessages?.({ sessionId: sid, limit: 500 });
      if (!r || !r.ok || !Array.isArray(r.messages) || !r.messages.length) return;
      const fromMain = r.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts || Date.now() }));
      const local = (window.__msgs && window.__msgs[sid]) || [];
      const sig = (m) => String(m.role) + '\u0001' + String(m.text);
      const mainSigs = new Set(fromMain.map(sig));
      const localOnly = local.filter((m) => !mainSigs.has(sig(m)));
      window.__msgs = window.__msgs || {};
      window.__msgs[sid] = [...fromMain, ...localOnly];
      if (state.selectedChat && state.selectedChat.id === sid) renderChat();
      renderList();
    } catch { /* 读不到就保持本地视图，不清空 */ }
  }

  /** 实体级状态变了：把本窗口这一处视图按最新事实重画（不搬内容，也不动另一处） */
  async function refreshEntityView(id) {
    try {
      const s = await window.warmy.projectState?.({ sessionId: id }).catch(() => null);
      if (s && s.ok && s.state) state.selectedChatProject = s.state;
    } catch { /* noop */ }
    try { renderChat(); } catch { /* noop */ }
    try { void renderProjectStateBlock?.(); } catch { /* noop */ }
    try { renderList(); } catch { /* noop */ }
    try { refreshContainerConsoleGate?.(); } catch { /* noop */ }
  }


  /** 聊天：展示**完整真实**记录；DOM 只挂最近 N 条，上滑加载；新消息按策略滚动 */
  const CHAT_VIEW_WINDOW = 20;
  const chatViewVisible = {};
  /** 自动滚动（默认关）：由三点菜单勾选；持久化到 settings */
  let autoScrollChat = false;
  let pendingNewest = null; // { text, role }

  function msgsOf(chatId) {
    return (window.__msgs && window.__msgs[chatId]) || [];
  }

  function isAtBottom(box) {
    return box.scrollHeight - box.scrollTop - box.clientHeight < 12;
  }

  function updateScrollAffordances(box) {
    const btn = $('scroll-bottom-btn');
    const bub = $('new-msg-bubble');
    const zaiDiBu = box ? isAtBottom(box) : true;
    if (btn) btn.classList.toggle('hidden', zaiDiBu);
    if (bub) {
      if (zaiDiBu || !pendingNewest) {
        bub.classList.add('hidden');
      } else {
        bub.classList.remove('hidden');
        bub.textContent = String(pendingNewest.text || '').slice(0, 120);
      }
    }
  }

  function scrollToBottom(smooth) {
    const box = $('messages');
    if (!box) return;
    pendingNewest = null;
    try { box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
    catch { box.scrollTop = box.scrollHeight; }
    updateScrollAffordances(box);
  }

  /**
   * 渲染聊天。滚动策略：
   *  - 自动滚动开：总是滚到底（最后一条的最后一句可见）
   *  - 自动滚动关（默认）：新内容滚到「能看见」为止；若新消息比视口高，
   *    则把它的**顶部**对齐到视口顶部并不再继续滚动（从头展示），此时显示下箭头
   */
  function renderChat(opts) {
    const box = $('messages');
    if (!box) return;
    const o = opts || {};
    const chatId = state.selectedChat && state.selectedChat.id;
    const msgs = chatId ? msgsOf(chatId) : [];
    const shown = Math.min(chatViewVisible[chatId] || CHAT_VIEW_WINDOW, msgs.length);
    chatViewVisible[chatId] = shown;
    const slice = msgs.slice(Math.max(0, msgs.length - shown));
    const wasAtBottom = isAtBottom(box);
    box.innerHTML = '';
    const hiddenCount = msgs.length - slice.length;
    if (hiddenCount > 0) {
      const more = document.createElement('button');
      more.className = 'chat-load-more btn-mini';
      more.textContent = `↑ ${t('chat.loadMore') || 'Load earlier'} (${hiddenCount})`;
      more.onclick = () => {
        chatViewVisible[chatId] = (chatViewVisible[chatId] || CHAT_VIEW_WINDOW) + CHAT_VIEW_WINDOW;
        renderChat({ keepScroll: true });
      };
      box.appendChild(more);
    }
    slice.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'msg' + (m.role === 'me' ? ' me' : '');
      const av = state.profile.avatarDataUrl
        ? `<img class="avatar-img" src="${state.profile.avatarDataUrl}" alt=""/>`
        : `<div class="av">${escapeHtml((state.profile.username || t('nav.avatar')).slice(0, 1))}</div>`;
      div.innerHTML = `${m.role === 'me' ? av : `<div class="av">${escapeHtml((state.selectedChat?.name || 'A')[0])}</div>`}<div class="bubble">${escapeHtml(m.text)}</div>`;
      box.appendChild(div);
    });
    if (box.dataset.lazyBound !== '1') {
      box.dataset.lazyBound = '1';
      box.addEventListener('scroll', () => {
        const id2 = state.selectedChat && state.selectedChat.id;
        if (box.scrollTop < 40 && id2) {
          const total = msgsOf(id2).length;
          const vis = chatViewVisible[id2] || CHAT_VIEW_WINDOW;
          if (vis < total) {
            chatViewVisible[id2] = Math.min(total, vis + CHAT_VIEW_WINDOW);
            renderChat({ keepScroll: true });
            box.scrollTop = 80;
            return;
          }
        }
        if (isAtBottom(box)) pendingNewest = null;
        updateScrollAffordances(box);
      });
    }
    const last = box.lastElementChild;
    if (o.keepScroll) {
      // 加载历史：保持位置
    } else if (autoScrollChat || wasAtBottom && !o.newContent) {
      scrollToBottom(false);
    } else if (last) {
      const maxScroll = box.scrollHeight - box.clientHeight;
      const lastTop = last.offsetTop;
      const lastH = last.offsetHeight;
      if (lastH <= box.clientHeight) {
        // 放得下：滚到底展示
        box.scrollTop = maxScroll;
      } else {
        // 比视口高：顶部对齐并停住（从头展示）
        box.scrollTop = Math.min(lastTop, maxScroll);
      }
      updateScrollAffordances(box);
    } else {
      updateScrollAffordances(box);
    }
    const duty = $('duty-info');
    if (duty) duty.textContent = state.selectedChat ? state.selectedChat.name : '—';
    try { updateListWatermark(); } catch { /* 水印失败不得中断聊天渲染 */ }
  }

  /**
   * 第二列水印的品牌文字。
   *
   * ⚠️ 历史缺陷（真机才暴露）：这个函数被 `applyI18n` 与 `renderChat` **调用**，
   * 却**从未定义**。`applyI18n` 里用了 `typeof === 'function'` 兜住，所以看不出问题；
   * 但 `renderChat` 是直接调用 ⇒ 每次打开会话都抛
   * `ReferenceError: updateListWatermark is not defined`，
   * 直接中断 `openChat()` 后续流程（右栏分区、成员卡片、进度、模型管理全部不更新）。
   * 静态 grep 检查源码完全查不出来 —— 只有真机跑一遍才会现形。
   */
  function updateListWatermark() {
    try {
      const name = (typeof t === 'function' && t('brand.name')) || 'WArmy';
      document.documentElement.style.setProperty('--brand-watermark', `"${String(name)}"`);
      const yuanSu = document.getElementById('list-watermark');
      if (yuanSu) yuanSu.setAttribute('data-brand', String(name));
    } catch { /* noop */ }
  }

  function tuisongXiaoxi(chatId, role, text, opts) {
    window.__msgs = window.__msgs || {};
    window.__msgs[chatId] = window.__msgs[chatId] || [];
    window.__msgs[chatId].push({ role, text, ts: Date.now() });
    if (state.selectedChat && state.selectedChat.id === chatId) {
      const box = $('messages');
      const zaiDiBu = box ? isAtBottom(box) : true;
      if (!zaiDiBu && !(opts && opts.self)) pendingNewest = { text, role };
    }
  }

  function queueOf(chatId) {
    if (!state.queues[chatId]) state.queues[chatId] = [];
    return state.queues[chatId];
  }

  /** 待执行队列落盘（主进程 userData/ui-queues.json）；失败不打断 UI */
  let __uiQueuesTimer = 0;
  function persistUiQueuesSoon() {
    if (!window.warmy?.uiQueuesSet) return;
    if (__uiQueuesTimer) return;
    __uiQueuesTimer = setTimeout(() => {
      __uiQueuesTimer = 0;
      try {
        // 只序列化可 JSON 化的字段（去掉 editing 等瞬时 UI 态）
        const out = {};
        for (const [k, arr] of Object.entries(state.queues || {})) {
          if (!Array.isArray(arr) || !arr.length) continue;
          out[k] = arr.map((x) => ({
            text: String(x.text || ''),
            u: String(x.u || 'P2'),
            status: String(x.status || 'queued'),
          }));
        }
        void window.warmy.uiQueuesSet(out);
      } catch { /* noop */ }
    }, 200);
  }

  async function restoreUiQueuesOnce() {
    if (!window.warmy?.uiQueuesGet) return;
    try {
      const r = await window.warmy.uiQueuesGet();
      const q = r && r.ok && r.queues && typeof r.queues === 'object' ? r.queues : null;
      if (!q) return;
      for (const [k, arr] of Object.entries(q)) {
        if (!Array.isArray(arr) || !arr.length) continue;
        state.queues[k] = arr.map((x) => ({
          text: String(x?.text || ''),
          u: x?.u === 'P3' ? 'P3' : 'P2',
          status: 'queued',
          editing: false,
        }));
      }
      renderQueueBar();
    } catch { /* noop */ }
  }


  /**
   * 右栏分区：
   *  - 干活（我的牛马 / 项目）：项目状态、文件/产物、进度、模型管理、目录、成员
   *  - 聊天（联系人 / 群聊）：知识库（本会话自己的）、聊天摘要、群聊另有成员与模型
   */
  /**
   * 右栏分区（**唯一权威**：`applyPanelPartition` 与 `updatePanelVisibility` 都汇到这里）。
   *
   * 规则（产品要求）：
   *  - **未选中会话**：所有会话相关卡片一律隐藏（不出现"空着占位"的成员/进度）
   *  - 我的牛马(single)：项目状态/文件/进度/模型/等待协助；**无成员**、无知识库/摘要
   *  - 项目(internal)：以上 + **成员** + 知识库 + 摘要 + 目录
   *  - 群聊(extgroup/external)：**成员** + 知识库 + 摘要 + 模型 + 等待协助
   *  - 联系人(extchat/externalChat)：知识库 + 摘要 + 等待协助；**无成员**、无模型管理
   */
  function panelVisibilityFor(kindRaw) {
    const kind = String(kindRaw || '');
    if (!kind || kind === 'none') {
      return { state: false, files: false, progress: false, model: false, dir: false, members: false, kb: false, summary: false, assist: false };
    }
    const work = kind === 'single' || kind === 'internal';
    const chat = kind === 'external' || kind === 'externalChat' || kind === 'extGroup' || kind === 'extgroup' || kind === 'externalGroup';
    const group = kind === 'internal' || kind === 'external' || kind === 'externalGroup' || kind === 'extgroup';
    return {
      state: work,
      files: work,
      progress: work,
      model: work || group,
      dir: kind === 'internal',
      members: group,              // 仅项目/群聊；我的牛马与联系人**没有**
      kb: kind === 'internal' || chat,
      summary: kind === 'internal' || chat,
      assist: work || chat,
    };
  }

  function applyPanelVisibility(kindRaw) {
    const v = panelVisibilityFor(kindRaw);
    try {
      window.__panelLog = window.__panelLog || [];
      window.__panelLog.push({ f: 'apply', kind: String(kindRaw || ''), members: v.members, t: Date.now() });
      if (window.__panelLog.length > 60) window.__panelLog.shift();
    } catch { /* noop */ }
    const set = (id, on) => {
      const yuanSu = document.getElementById(id);
      if (!yuanSu) return;
      yuanSu.classList.toggle('hidden', !on);
      yuanSu.style.display = on ? '' : 'none';
      yuanSu.setAttribute('data-panel-hidden', on ? '0' : '1');
    };
    set('project-state-block', v.state);
    set('project-files-block', v.files);
    set('panel-progress-block', v.progress);
    set('panel-model-mgr-block', v.model);
    set('panel-directory-block', v.dir);
    set('panel-members-block', v.members);
    set('panel-kb-block', v.kb);
    set('panel-summary-block', v.summary);
    set('panel-assist-block', v.assist);
    return v;
  }
  window.__applyPanelVisibility = applyPanelVisibility;
  /** 当前应显示的分区（按已选会话；没有会话 → 全隐藏） */
  function currentPanelKind() {
    return state.selectedChat ? String(state.selectedChat.kind || '') : 'none';
  }
  function refreshPanelVisibility() {
    return applyPanelVisibility(currentPanelKind());
  }
  window.__refreshPanelVisibility = refreshPanelVisibility;
  /** 验收脚本用：当前分区状态快照（只读，不改产品行为） */
  window.__panelDebug = () => ({
    selected: state.selectedChat ? { kind: state.selectedChat.kind, id: state.selectedChat.id } : null,
    membersClass: (document.getElementById('panel-members-block') || {}).className || '',
    membersHidden: !!document.getElementById('panel-members-block')?.classList.contains('hidden'),
    nav: state.nav,
  });

  function applyPanelPartition(kind) {
    applyPanelVisibility(kind);
    try {
      void renderPanelKnowledge();
      void renderPanelSummary();
      void renderProgressTasks();
      void renderAssistList({ scrollBottom: false });
    } catch { /* noop */ }
  }

  async function renderPanelKnowledge() {
    const host = document.getElementById('panel-kb-box');
    if (!host) return;
    const gid = state.selectedChat && state.selectedChat.id;
    if (!gid) { host.textContent = '—'; return; }
    try {
      const r = await window.warmy.knowledgeQuery?.(gid);
      const ents = (r && r.entities) || [];
      const evs = (r && r.events) || [];
      host.innerHTML = (ents.length || evs.length)
        ? [
            ...ents.slice(0, 6).map((e) => `<div class="pk-row">${escapeHtml(e.name || e.id)}</div>`),
            ...evs.slice(0, 6).map((e) => `<div class="pk-row muted">${escapeHtml(e.title || '')}</div>`),
          ].join('')
        : `<div class="muted">${escapeHtml(t('knowledge.empty') || '—')}</div>`;
    } catch {
      host.textContent = '—';
    }
  }

  async function renderPanelSummary() {
    const host = document.getElementById('panel-summary-box');
    if (!host) return;
    const gid = state.selectedChat && state.selectedChat.id;
    if (!gid) { host.textContent = '—'; return; }
    try {
      const r = await window.warmy.archiveList?.(gid);
      const list = (r && r.entries) || [];
      // 最新一条若带 structured，则优先展示要点/决策/待办/风险
      const last = list[list.length - 1];
      const st = last && last.structured;
      let extra = '';
      if (st) {
        const sec = (arr, key) => (arr && arr.length ? `<div class="pk-sec"><b>${escapeHtml(t(key))}</b>${arr.map((x) => `<div class="pk-row"><button class="btn-mini" data-jump-st="${escapeHtml(String(x).slice(0, 80))}">${escapeHtml(x)}</button></div>`).join('')}</div>` : '');
        extra = sec(st.decisions, 'panel.summary.decisions') + sec(st.todos, 'panel.summary.todos') + sec(st.risks, 'panel.summary.risks') + sec(st.bullets, 'panel.summary.bullets');
      }
      host.innerHTML = extra + (list.length
        ? list.slice(-5).reverse().map((e) => `
            <div class="pk-row">
              <div>${escapeHtml(e.title || '')}</div>
              <div class="muted">${escapeHtml(String(e.summary || '').slice(0, 80))}</div>
              <button class="btn-mini" data-jump-archive="${escapeHtml(e.id)}">${escapeHtml(t('panel.summary.jump') || 'Jump')}</button>
            </div>`).join('')
        : `<div class="muted">${escapeHtml(t('panel.summary.empty') || '—')}</div>`);
      host.querySelectorAll('[data-jump-archive]').forEach((b) => {
        b.onclick = () => {
          const id = b.getAttribute('data-jump-archive');
          const item = list.find((x) => x.id === id);
          const st = item && item.structured;
          const anchor = item && item.anchors && item.anchors[0];
          const jumpQuery = () => {
            if (anchor && (anchor.recordId || anchor.seq != null)) return String(anchor.recordId || anchor.seq);
            // 无锚点时：优先用结构化决策/要点原文，其次标题
            const stFirst = st && ((st.decisions && st.decisions[0]) || (st.bullets && st.bullets[0]));
            return String(stFirst || (item && item.title) || '');
          };
          const q = jumpQuery();
          if (!q) {
            try {
              const sid = gid;
              openChat(state.selectedChat?.kind || 'single', sid, sid);
              setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
            } catch { /* noop */ }
            return;
          }
          try {
            void window.warmy.searchMessages?.(q).then((r) => {
              const hits = (r && r.hits) || [];
              if (hits.length) {
                const first = hits[0];
                const sid = first.sessionId || gid;
                openChat(state.selectedChat?.kind || 'single', sid, sid);
                setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
              } else {
                const sid = gid;
                openChat(state.selectedChat?.kind || 'single', sid, sid);
                setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
              }
            });
          } catch {
            try {
              const sid = gid;
              openChat(state.selectedChat?.kind || 'single', sid, sid);
              setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
            } catch { /* noop */ }
          }
        };
      });
      // 结构化行也可点击跳转
      host.querySelectorAll('[data-jump-st]').forEach((b) => {
        b.onclick = () => {
          const q = b.getAttribute('data-jump-st') || '';
          if (!q) return;
          try {
            void window.warmy.searchMessages?.(q).then((r) => {
              const hits = (r && r.hits) || [];
              const sid = (hits[0] && hits[0].sessionId) || gid;
              openChat(state.selectedChat?.kind || 'single', sid, sid);
              setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
            });
          } catch { /* noop */ }
        };
      });
    } catch {
      host.textContent = '—';
    }
  }

  /** 三点菜单：按会话类型显示条目 + 快捷键提示 */
  function xuanranGengduoCaidan() {
    const nav = state.nav;
    const isWork = nav === 'singleAi' || nav === 'internalGroup';
    const isGroupChat = nav === 'internalGroup' || nav === 'externalGroup';
    $('mi-directed')?.classList.toggle('hidden', !isGroupChat);
    /**
     * 独立会话窗里**不再提供「在新窗口打开」**：那个窗口本来就是"这个会话的窗口"，
     * 再开只会得到重复视图（用户明确要求去掉）。
     */
    $('mi-open')?.classList.toggle('hidden', document.body.classList.contains('chat-window'));
    const sc = (id, key) => { const e = $(id); if (e) e.textContent = typeof SHORTCUT_LABEL === 'function' ? SHORTCUT_LABEL(key) : ''; };
    sc('sc-open', 'openChatWindow');
    sc('sc-export', 'exportSession');
    sc('sc-stop', 'stopAll');
    void isWork;
  }


  // ── 上下文预算滑块 + 会话摘要（手动/自动） ──
  const CTX_MIN_TOKENS = 2048;
  const CTX_DEFAULT_WINDOW = 32768;
  let ctxState = { percent: 60, maxTokens: CTX_DEFAULT_WINDOW };

  function ctxMinPercent() {
    return Math.min(90, Math.ceil((CTX_MIN_TOKENS / Math.max(4096, ctxState.maxTokens)) * 100));
  }

  function ctxRenderMeta() {
    const pct = $('ctx-pct');
    const tok = $('ctx-tokens');
    const minP = ctxMinPercent();
    if (pct) pct.textContent = `${ctxState.percent}%`;
    if (tok) {
      const t = Math.max(CTX_MIN_TOKENS, Math.round((ctxState.percent / 100) * ctxState.maxTokens));
      tok.textContent = t('ctx.budget.tokens') ? fmtKey('ctx.budget.tokens', { n: String(t) }) : `≈ ${t} tokens`;
    }
    const s = $('ctx-slider');
    if (s) { s.min = String(minP); s.value = String(ctxState.percent); }
    const hint = document.querySelector('#ctx-popover .ctx-pop-min');
    if (hint) hint.textContent = fmtKey('ctx.budget.minHint', { n: String(minP) });
  }

  function ctxVisibleFor(nav) {
    // 群聊不暴露；联系人不涉及；项目/我的牛马可见
    return nav === 'singleAi' || nav === 'internalGroup'; // 群聊/联系人不显示，由后台自动收敛
  }

  function bindCtxBudget() {
    const btn = $('btn-ctx');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('ctx-popover');
      if (!pop) return;
      const opening = pop.classList.contains('hidden');
      pop.classList.toggle('hidden');
      btn.classList.toggle('on', opening);
      if (opening) {
        try {
          const r = btn.getBoundingClientRect();
          pop.style.left = Math.max(8, Math.min(r.left - 120, window.innerWidth - 320)) + 'px';
          pop.style.top = Math.max(8, r.top - 8 - pop.offsetHeight) + 'px';
        } catch { /* noop */ }
      }
      ctxRenderMeta();
    });
    const slider = $('ctx-slider');
    if (slider) {
      slider.addEventListener('input', () => {
        ctxState.percent = Number(slider.value) || ctxState.percent;
        ctxRenderMeta();
        // 落盘（合并式设置）
        try { window.warmy.settingsSave({ contextBudgetPercent: ctxState.percent }); } catch { /* noop */ }
      });
    }
    onDocClick((ev) => {
      const pop = $('ctx-popover');
      if (!pop || pop.classList.contains('hidden')) return;
      if (ev.target && (ev.target.closest('#ctx-popover') || ev.target.closest('#btn-ctx'))) return;
      pop.classList.add('hidden');
      btn.classList.remove('on');
    });
  }

  /** 已知模型 → 上下文窗口（token）；拿不到就用 settings.modelContextTokens */
  const MODEL_CTX_MAP = {
    'deepseek-chat': 65536,
    'deepseek-reasoner': 65536,
    'mimo-v2.5-pro': 131072,
    'mimo-v2.5': 131072,
    'qwen3.7-max': 131072,
    'qwen3.8-27b': 32768,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'claude-3-5-sonnet': 200000,
  };
  function modelContextTokensFor(nav) {
    try {
      let model = '';
      if (nav === 'singleAi') {
        const inst = state.selectedInstance || state.instances.find((x) => x.id === state.selectedChat?.id);
        model = String(inst?.model || inst?.defaultModel || '');
      } else if (nav === 'internalGroup') {
        // 项目：按值班牛马所选模型
        const gid = state.selectedChat && state.selectedChat.id;
        const g = (state.groups || []).find((x) => x.id === gid);
        const dutyId = g && (g.dutyInstanceId || g.dutyInstance);
        const inst = state.instances.find((x) => x.id === dutyId) || state.instances.find((x) => x.dutyEligible);
        model = String(inst?.model || inst?.defaultModel || '');
      }
      if (model && MODEL_CTX_MAP[model]) return MODEL_CTX_MAP[model];
    } catch { /* noop */ }
    return ctxState.maxTokens || CTX_DEFAULT_WINDOW;
  }

  async function ctxLoad() {
    try {
      const s = await window.warmy.settingsGet();
      const p = Number(s?.settings?.contextBudgetPercent);
      if (Number.isFinite(p)) ctxState.percent = Math.min(90, Math.max(10, Math.round(p)));
      const m = Number(s?.settings?.modelContextTokens);
      if (Number.isFinite(m) && m >= 4096) ctxState.maxTokens = m;
    } catch { /* 默认 */ }
    // 按当前会话所选/值班模型推算上下文窗口
    ctxState.maxTokens = modelContextTokensFor(state.nav);
    ctxRenderMeta();
  }

  // ── 会话摘要：手动 + 空闲自动 ──
  let autoSummaryOn = true;
  let lastSummaryAt = 0;
  async function genSessionSummary(auto) {
    const gid = state.selectedChat && state.selectedChat.id;
    if (!gid) return null;
    const msg = $('summary-msg');
    if (msg && !auto) msg.textContent = t('common.loading') || '';
    try {
      const r = await window.warmy.sessionSummary?.({ sessionId: gid, auto: !!auto });
      if (msg && !auto) msg.textContent = r && r.ok ? (t('panel.summary.done') || 'OK') : String(r?.error || '');
      lastSummaryAt = Date.now();
      try { void renderPanelSummary(); } catch { /* noop */ }
      return r;
    } catch (e) {
      if (msg && !auto) msg.textContent = String(e.message || e);
      return null;
    }
  }

  function bindSummaryControls() {
    const btn = $('btn-gen-summary');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { void genSessionSummary(false); });
    }
    const tg = $('auto-summary-toggle');
    if (tg && tg.dataset.bound !== '1') {
      tg.dataset.bound = '1';
      tg.checked = autoSummaryOn;
      tg.addEventListener('change', async () => {
        autoSummaryOn = !!tg.checked;
        try { await window.warmy.settingsSave({ autoSummary: autoSummaryOn }); } catch { /* noop */ }
      });
    }
  }

  async function loadSummaryPref() {
    try {
      const s = await window.warmy.settingsGet();
      autoSummaryOn = s?.settings?.autoSummary !== false;
      const tg = $('auto-summary-toggle');
      if (tg) tg.checked = autoSummaryOn;
    } catch { /* 默认开 */ }
  }

  /** 空闲自动摘要：每 10 分钟检查一次；有新消息且空闲才生成 */
  setInterval(() => {
    if (!autoSummaryOn || !state.selectedChat) return;
    const gid = state.selectedChat.id;
    const msgs = (window.__msgs && window.__msgs[gid]) || [];
    if (!msgs.length) return;
    const lastTs = msgs[msgs.length - 1] && msgs[msgs.length - 1].ts || 0;
    const kongxian = Date.now() - lastTs > 3 * 60 * 1000;
    const since = Date.now() - lastSummaryAt > 10 * 60 * 1000;
    if (kongxian && since) void genSessionSummary(true);
  }, 60 * 1000);

  // ── 聊天滚动：下箭头 / 新消息气泡 / 自动滚动 ──
  (function bindScrollUx() {
    /* btn-scroll-bottom-bind */
    $('scroll-bottom-btn')?.addEventListener('click', () => scrollToBottom(true));
    $('new-msg-bubble')?.addEventListener('click', () => scrollToBottom(true));
    const miAuto = $('mi-autoscroll');
    const markAuto = $('mi-autoscroll-mark');
    const syncAuto = () => {
      if (markAuto) markAuto.style.visibility = autoScrollChat ? 'visible' : 'hidden';
      if (miAuto) miAuto.setAttribute('aria-checked', autoScrollChat ? 'true' : 'false');
    };
    if (miAuto && !miAuto.dataset.bound) {
      miAuto.dataset.bound = '1';
      miAuto.addEventListener('click', async () => {
        autoScrollChat = !autoScrollChat;
        syncAuto();
        try { await window.warmy.settingsSave({ autoScrollChat }); } catch { /* noop */ }
        if (autoScrollChat) scrollToBottom(false);
      });
    }
    // 恢复设置
    void (async () => {
      try {
        const s = await window.warmy.settingsGet();
        autoScrollChat = !!(s?.settings?.autoScrollChat);
      } catch { /* noop */ }
      syncAuto();
    })();
    // 输入字数
    const input = $('input');
    const counter = $('input-counter');
    if (input && counter && !input.dataset.counterBound) {
      input.dataset.counterBound = '1';
      const MAX = Number(input.getAttribute('maxlength')) || 8000;
      const upd = () => {
        const n = input.value.length;
        counter.textContent = n > MAX * 0.8 ? `${n} / ${MAX}` : '';
        counter.classList.toggle('over', n >= MAX);
      };
      input.addEventListener('input', upd);
      upd();
    }
  })();

  // ── AI 决策选项卡（会话中）+ 项目 MEMORY 编辑 ──
  function renderAiQuestions() {
    const host = $('aiq-host');
    if (!host || !state.selectedChat) {
      if (host) host.innerHTML = '';
      return;
    }
    const gid = state.selectedChat.id;
    void (async () => {
      try {
        const r = await window.warmy.aiQuestionList?.(gid);
        const items = (r && r.items) || [];
        const pending = items.filter((q) => q.status === 'pending');
        if (!pending.length) {
          host.innerHTML = '';
          return;
        }
        host.innerHTML = pending.map((q) => {
          const opts = (q.options || []).map((o) =>
            `<button class="btn-mini" data-aiq="${escapeHtml(q.id)}" data-opt="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`
          ).join(' ');
          return `<div class="aiq-card" data-qid="${escapeHtml(q.id)}">
            <div class="aiq-title">${escapeHtml(t('aiq.title')||'')} · ${escapeHtml(q.title||'')}</div>
            ${q.body ? `<div class="muted">${escapeHtml(q.body)}</div>` : ''}
            <div class="aiq-opts">${opts}
              <button class="btn-mini" data-aiq="${escapeHtml(q.id)}" data-opt="__custom__">${escapeHtml(t('aiq.custom')||'Other')}</button>
            </div>
            <div class="aiq-custom hidden"><input class="aiq-input" placeholder="${escapeHtml(t('aiq.custom')||'')}"/>
              <button class="btn-primary" data-aiq-submit="${escapeHtml(q.id)}">${escapeHtml(t('aiq.submit')||'OK')}</button></div>
          </div>`;
        }).join('');
        host.querySelectorAll('[data-aiq]').forEach((b) => {
          b.onclick = async () => {
            const id = b.getAttribute('data-aiq');
            const opt = b.getAttribute('data-opt');
            if (opt === '__custom__') {
              const card = host.querySelector(`[data-qid="${CSS.escape(id)}"]`);
              if (card) card.querySelector('.aiq-custom')?.classList.remove('hidden');
              return;
            }
            const r2 = await window.warmy.aiQuestionAnswer?.({ id, optionId: opt });
            if (r2 && r2.ok === false) uiAlert(String(r2.error||''));
            renderAiQuestions();
          };
        });
        host.querySelectorAll('[data-aiq-submit]').forEach((b) => {
          b.onclick = async () => {
            const id = b.getAttribute('data-aiq-submit');
            const card = host.querySelector(`[data-qid="${CSS.escape(id)}"]`);
            const zhi = card ? (card.querySelector('.aiq-input')?.value || '') : '';
            const r2 = await window.warmy.aiQuestionAnswer?.({ id, optionId: '__custom__', customText: zhi });
            if (r2 && r2.ok === false) uiAlert(String(r2.error||''));
            renderAiQuestions();
          };
        });
      } catch { host.innerHTML = ''; }
    })();
  }

  async function renderProjectMemoryPanel() {
    const box = $('pm-box');
    if (!box || !state.selectedChat) {
      if (box) box.innerHTML = '';
      return;
    }
    const gid = state.selectedChat.id;
    try {
      const r = await window.warmy.projectMemoryGet?.({ sessionId: gid });
      const jiYi = (r && r.memory) || '';
      box.innerHTML = `<div class="muted">${escapeHtml(t('pm.hint')||'')}</div>
        <textarea id="pm-text" rows="5" style="width:100%;margin-top:6px">${escapeHtml(jiYi)}</textarea>
        <div style="margin-top:6px"><button class="btn-mini" id="btn-pm-save">${escapeHtml(t('pm.save')||'Save')}</button>
        <span class="muted" id="pm-msg">${jiYi ? '' : escapeHtml(t('pm.empty')||'')}</span></div>`;
      const btn = $('btn-pm-save');
      if (btn) btn.onclick = async () => {
        const zhi = $('pm-text') ? $('pm-text').value : '';
        const yunXingJieGuo = await window.warmy.projectMemorySet?.({ sessionId: gid, memory: zhi });
        const msg = $('pm-msg');
        if (msg) {
          msg.textContent = yunXingJieGuo && yunXingJieGuo.ok ? t('pm.saved') : (yunXingJieGuo?.error || t('pm.readBackFail'));
        }
      };
    } catch {
      box.innerHTML = '';
    }
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
          persistUiQueuesSoon();
        };
        del.onclick = () => {
          q.splice(idx, 1);
          renderQueueBar();
          persistUiQueuesSoon();
        };
        li.append(ta, save, del);
      } else {
        const kuaDu = document.createElement('div');
        kuaDu.className = 'q-text';
        kuaDu.textContent = item.text;
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
          persistUiQueuesSoon();
        };
        li.append(kuaDu, edit, del);
      }
      list.appendChild(li);
    });
  }

  function xuanranFujian() {
    const yuanSu = $('attach-list');
    if (!state.attachments.length) {
      yuanSu.classList.add('hidden');
      yuanSu.innerHTML = '';
      return;
    }
    yuanSu.classList.remove('hidden');
    yuanSu.innerHTML = state.attachments
      .map(
        (a, i) =>
          `<span class="attach-chip">${escapeHtml(a.name)} <button data-i="${i}" title="${escapeHtml(t('chat.queueDelete'))}">×</button></span>`
      )
      .join(' ');
    yuanSu.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.attachments.splice(Number(b.dataset.i), 1);
        xuanranFujian();
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
      tuisongXiaoxi(state.selectedChat.id, 'them', t('chat.stopAll'));
    }
    renderList();
    if (state.nav === 'instances' && state.selectedInstance) renderInstanceDetail();
    renderChat();
  }

  /** 会话 id → 类型（内部群走值班编排，其余走单会话 Provider 对话） */
  function chatKindOf(chatId) {
    const c = state.chats.find((x) => x.id === chatId);
    if (c && c.kind) return c.kind;
    const g = (state.groups || []).find((x) => x.id === chatId);
    if (g && g.type) return g.type === 'internal' ? 'internal' : 'extgroup';
    if (state.selectedChat && state.selectedChat.id === chatId) return state.selectedChat.kind || '';
    return '';
  }

  /**
   * 真的把一条消息交给模型（一轮 = 一次派发，从发起到回包）。
   *   · 内部群 → groupOrchestrate（值班编排闭环：回包 + 看板事件 + 检查点都在主进程那侧）
   *   · 单 AI / 外部 → chatSend（真 Provider 对话）
   * 直接路径（P0·P1，见 send()）与「待执行队列」的冲刷走的是**同一个**实现 ——
   * 修前排队项只被本地回显、从不派发，根因就是没有这一份共用的"派发"。
   */
  async function deliver(chatId, text, u) {
    const kind = chatKindOf(chatId);
    queueRounds[chatId] = true;
    try {
      if (kind === 'internal') {
        try {
          const r = await window.warmy.groupOrchestrate({ groupId: chatId, content: text, urgency: u });
          const reply = r?.reply || `[${u}] ${r?.action || 'ok'}`;
          tuisongXiaoxi(chatId, 'them', reply);
          if (r?.boardEvent) {
            state.board = state.board || { sessions: [], events: [], recent: [] };
            state.board.events = state.board.events || [];
            state.board.events.unshift({ id: 'e' + Date.now(), ts: Date.now(), action: r.boardEvent.split(':')[0], title: r.boardEvent, session: chatId });
          }
        } catch (e) {
          tuisongXiaoxi(chatId, 'them', String(e.message || e));
        }
        return;
      }
      // 单 AI / 外部：真 Provider 对话
      try {
        const r = await window.warmy.chatSend({
          sessionId: chatId,
          content: text,
          insertMode: u === 'P1' ? 'inner' : 'outer',
        });
        if (r?.needsKey) {
          tuisongXiaoxi(chatId, 'them', r.reply);
        } else if (r?.ok) {
          tuisongXiaoxi(chatId, 'them', r.reply);
          const c = state.chats.find((x) => x.id === chatId);
          if (c) {
            c.lastTs = Date.now();
            c.lastPreview = (r.reply || text).slice(0, 30);
          }
        } else {
          tuisongXiaoxi(chatId, 'them', r?.error || t('common.error'));
        }
      } catch (e) {
        tuisongXiaoxi(chatId, 'them', String(e.message || e));
      }
    } finally {
      queueRounds[chatId] = false;
    }
  }

  /** 一轮结束的收尾（直接路径与排队冲刷共用，避免两条路各收一半） */
  function endOfRound(chatId) {
    window.warmy.checkpointAuto?.('round_end');
    renderChat();
    playNotifySound('complete');
    refreshMetrics();
    refreshCheckpoints();
    if (chatKindOf(chatId) === 'internal') {
      // 值班者编排可能改了看板任务 → 右栏「进度」跟着刷真数据
      void renderProgressTasks();
    }
    if (CHAT_NAVS.has(state.nav)) renderList();
  }

  /**
   * 待执行队列（P2 插入 / P3 排队）的**真冲刷**。
   *
   * 事实（修前）：send() 把 P2/P3 塞进本会话队列就 return；flushQueue() 只把队列项
   * 本地回显成两条气泡，**从不**调用 chatSend / groupOrchestrate —— 而 P2 是**默认**紧急度，
   * 于是「输入 → 发送 → 界面上出现消息、模型那头什么都没收到」：默认路径整条是死的。
   *
   * 设计依据（ADR000 不变量 #8 与 §指令插入）：
   *   P1 立即插入（手动按钮）；P2 **默认**「当前任务完成后插入执行」；P3 排队「本轮结束后按队列执行，
   *   队列中内容可编辑/删除」；P0 = 停止。群聊那侧的同一语义在 group-router 里写得很直白：
   *   complete() = 「值班者完成一轮后回到 idle 并冲刷队列」，而冲刷的结果就是**被派发**。
   * 结论：排队项的唯一正确归宿是"真的发出去并被回答"，不是回显。
   *
   * 触发时机（"本轮结束"有两种）：
   *   ① 有轮在跑：消息留在队列里，等那一轮结束（直接路径在 endOfRound 之后调 flushQueue）
   *   ② 没有轮在跑（用户刚按下发送、谁都不忙）：排到下一个轮边界 —— QUEUE_GRACE_MS。
   *      这段窗口里队列项就在「待执行队列」条上，可编辑 / 可移除（产品写明的能力），
   *      窗口一过就真的派发；没有窗口的话这条队列只剩"闪一下"，编辑/删除根本够不着。
   * 顺序：FIFO（数组 push / shift），不按紧急度重排 —— 重排是群聊 Router 的职责
   * （Router.sortQueue 会按 P0<P1<P2<P3 再按入队时间重排），桌面端这条队列只做用户自己的待办序。
   */
  const QUEUE_GRACE_MS = 800;
  const queueRounds = {}; // chatId -> 本轮是否在跑
  const queueTimers = {}; // chatId -> 已排定的轮边界定时器
  const queueDrains = {}; // chatId -> 正在冲刷（同会话串行，保证顺序）

  function queueBusy(chatId) {
    return !!queueRounds[chatId] || !!queueDrains[chatId];
  }

  /** 排定一次"轮边界"冲刷；有轮在跑就交给那一轮结束时冲刷，不重复排 */
  function scheduleQueueFlush(chatId) {
    if (!chatId || queueTimers[chatId] || queueDrains[chatId]) return;
    if (queueBusy(chatId)) return;
    queueTimers[chatId] = setTimeout(() => {
      delete queueTimers[chatId];
      flushQueue(chatId);
    }, QUEUE_GRACE_MS);
  }

  /** 本轮结束点：真的冲刷该会话的待执行队列 */
  function flushQueue(chatId) {
    if (queueTimers[chatId]) {
      clearTimeout(queueTimers[chatId]);
      delete queueTimers[chatId];
    }
    if (queueBusy(chatId)) return; // 还有轮在跑：等它结束
    void drainQueue(chatId);
  }

  /** 逐条派发（同会话串行、FIFO；冲刷过程中新入队的排在其后） */
  async function drainQueue(chatId) {
    const q = queueOf(chatId);
    if (queueDrains[chatId] || !q.length) return;
    queueDrains[chatId] = true;
    try {
      while (q.length) {
        const item = q.shift();
        persistUiQueuesSoon();
        renderQueueBar();
        tuisongXiaoxi(chatId, 'me', item.text);
        renderChat();
        if (CHAT_NAVS.has(state.nav)) renderList();
        await deliver(chatId, item.text, item.u);
        endOfRound(chatId);
      }
    } finally {
      delete queueDrains[chatId];
      persistUiQueuesSoon();
      renderQueueBar();
      renderChat();
      if (CHAT_NAVS.has(state.nav)) renderList();
    }
  }

  async function send() {
    const text = $('input').value.trim();
    if (!text || !state.selectedChat) return;
    const id = state.selectedChat.id;
    const u = state.urgency;
    /**
     * ADR 004 P3 定稿：容器项目的开发面**只在容器里**。容器没运行 ⇒ 项目 = 已停止
     * （等同创建者下线）⇒ **拒绝在宿主侧派发这一轮**，而不是静默地在本机编辑项目文件。
     * 这不是"少一个功能"，而是这条安全承诺的全部意义所在（主进程还会再拒一次）。
     */
    const blocked = await xiangMuKaiFaKuai(id);
    if (blocked) {
      await uiAlert(fmtKey('container.project.devBlocked', { reason: blocked }), t('container.devEnv.title'));
      return;
    }
    const attachNote = state.attachments.length
      ? `\n[${state.attachments.map((a) => a.name).join(', ')}]`
      : '';
    const full = text + attachNote;

    // P2（默认「插入」）/ P3（「排队」）：进「待执行队列」，本轮结束后由冲刷**真的派发**出去
    if (u === 'P2' || u === 'P3') {
      queueOf(id).push({ id: 'q-' + Date.now(), text: full, u, editing: false });
      $('input').value = '';
      state.attachments = [];
      xuanranFujian();
      renderQueueBar();
      persistUiQueuesSoon();
      if (CHAT_NAVS.has(state.nav)) renderList();
      scheduleQueueFlush(id);
      return;
    }

    // P0（停止，见 stopAllAi）/ P1（加急）：立即插入 —— 直接派发
    tuisongXiaoxi(id, 'me', full);
    $('input').value = '';
    state.attachments = [];
    xuanranFujian();
    renderChat();

    await deliver(id, text, u);
    endOfRound(id);
    flushQueue(id); // 本轮结束 → 冲刷队列（真的发，不再只回显）
  }

  /**
   * 总看板（我的页底部）：
   * 顶部三卡：进行中项目 / 运行中实例 / 等待决策总数
   * 下方按 我的牛马 / 项目 / 联系人 / 群聊 分类折叠会话；
   * 折叠：名称 + 一句话最新 + 有等待决策时黄点；双击进入；
   * 展开：完整名、创建时间、耗时、摘要、等待决策列表。
   */
  async function renderDashboard(host) {
    if (!host) return;
    // 收集会话列表（真实数据优先）
    let groups = [];
    try {
      const quanJu = await window.warmy.groupList();
      if (quanJu?.ok && Array.isArray(quanJu.groups)) groups = quanJu.groups;
    } catch { groups = state.groups || []; }
    if (!groups.length) groups = state.groups || [];

    // 等待协助 / 决策总数
    let assistAll = [];
    try {
      const r = await window.warmy.assistList?.();
      assistAll = (r && r.items) || [];
    } catch { assistAll = []; }
    const pendingCount = assistAll.filter((x) => x.status === 'open').length;

    const running = (state.instances || []).filter((i) => i.status === 'running').length;
    const inProgressProjects = groups.filter((g) => g.type === 'internal').length;

    // 会话元数据
    const now = Date.now();
    const sessions = groups.map((g) => {
      const kind = g.type === 'internal' ? 'internal'
        : g.type === 'external' || g.type === 'externalGroup' ? 'external'
        : g.type === 'externalChat' ? 'contact'
        : 'single';
      const chatKind = g.type === 'externalGroup' ? 'extgroup' : g.type === 'externalChat' ? 'extchat' : g.type;
      const created = Number(g.createdAt || 0);
      const hours = created ? Math.max(0, Math.round((now - created) / 3600000)) : null;
      const assists = assistAll.filter((a) => !a.sessionId || a.sessionId === g.id);
      const pend = assists.filter((a) => a.status === 'open');
      const lastEv = (() => {
        try {
          const evs = (state.board && state.board.events) || [];
          const hit = evs.find((e) => e.session === g.id);
          return hit ? String(hit.title || '').slice(0, 80) : '';
        } catch { return ''; }
      })();
      const oneline = lastEv || (pend[0] ? String(pend[0].title).slice(0, 60) : t('dashboard.emptyLine'));
      const summary = (g.memory || lastEv || oneline || '').slice(0, 120);
      return {
        id: g.id,
        kind,
        chatKind: chatKind === 'single' ? 'single' : g.type,
        name: g.name || g.id,
        created,
        hours,
        oneline,
        summary,
        pend,
        createdAtLabel: created ? new Date(created).toLocaleString() : '—',
      };
    });

    const cats = [
      { key: 'single', label: t('dashboard.cat.single'), items: sessions.filter((s) => s.kind === 'single') },
      { key: 'internal', label: t('dashboard.cat.internal'), items: sessions.filter((s) => s.kind === 'internal') },
      { key: 'contact', label: t('dashboard.cat.contact'), items: sessions.filter((s) => s.kind === 'contact') },
      { key: 'external', label: t('dashboard.cat.external'), items: sessions.filter((s) => s.kind === 'external') },
    ];

    host.innerHTML = `
      <h1>${t('dashboard.title')}</h1>
      <div class="dash-stats">
        <div class="dash-card"><div class="muted">${t('dashboard.inProgressProjects')}</div><div class="stat">${escapeHtml(String(inProgressProjects))}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.runningInstances')}</div><div class="stat">${escapeHtml(String(running))}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.pendingDecisions')}</div><div class="stat">${escapeHtml(String(pendingCount))}</div></div>
      </div>
      <div id="dash-sessions"></div>`;
    const box = $('dash-sessions');
    if (!box) return;

    cats.forEach((cat) => {
      if (!cat.items.length) return;
      const head = document.createElement('div');
      head.className = 'dash-cat';
      head.textContent = cat.label;
      box.appendChild(head);
      cat.items.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'dash-row';
        row.title = t('dashboard.jump') || '';
        row.innerHTML =
          (s.pend.length ? '<span class="dash-badge" title="' + escapeHtml(t('dashboard.pendingBadge') || '') + '"></span>' : '<span style="width:8px"></span>') +
          '<div class="dash-name">' + escapeHtml(s.name) + '</div>' +
          '<div class="dash-oneline">' + escapeHtml(s.oneline) + '</div>' +
          (s.hours != null ? '<div class="muted" style="font-size:11px;flex-shrink:0">' + escapeHtml(fmtKey('dashboard.hoursAgo', { h: String(s.hours) })) + '</div>' : '');
        const detail = document.createElement('div');
        detail.className = 'dash-detail hidden';
        detail.innerHTML =
          '<div class="dd-line"><b>' + escapeHtml(s.name) + '</b></div>' +
          '<div class="dd-line muted">' + escapeHtml(t('dashboard.createdAt') || 'Created') + '：' + escapeHtml(s.createdAtLabel) + '</div>' +
          '<div class="dd-line muted">' + escapeHtml(t('dashboard.hoursAgo', { h: String(s.hours ?? '—') })) + '</div>' +
          '<div class="dd-line">' + escapeHtml(s.summary) + '</div>' +
          '<div class="dd-line"><b>' + escapeHtml(t('dashboard.pendingDecisions')) + '</b></div>' +
          (s.pend.length
            ? s.pend.slice(0, 8).map((p) => '<div class="dd-line">· ' + escapeHtml(String(p.title || '')) + ' <span class="muted">' + escapeHtml(p.priority === 'urgent' ? t('panel.assist.urgent') : '') + '</span></div>').join('')
            : '<div class="dd-line muted">—</div>');
        const enter = () => {
          const kind = s.chatKind || s.kind;
          const openKind = kind === 'extgroup' ? 'extgroup' : kind === 'extchat' ? 'extchat' : kind === 'internal' ? 'internal' : 'single';
          const nav = openKind === 'single' ? 'singleAi' : openKind === 'internal' ? 'internalGroup' : openKind === 'extgroup' ? 'externalGroup' : 'externalChat';
          setNav(nav);
          openChat(openKind, s.id, s.name);
        };
        row.ondblclick = enter;
        row.onclick = () => {
          detail.classList.toggle('hidden');
          if (!detail.classList.contains('hidden')) detail.scrollIntoView({ block: 'nearest' });
        };
        box.appendChild(row);
        box.appendChild(detail);
      });
    });
    if (!sessions.length) {
      box.innerHTML = '<div class="board-empty">' + escapeHtml(t('dashboard.emptySessions')) + '</div>';
    }
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
        const dsh = await window.warmy.dshAvailable().catch(() => ({ ok: false }));
        let r;
        if (dsh?.ok) {
          r = await window.warmy.spawnDshInstance({ id: inst.id, name: inst.name });
        } else {
          r = await window.warmy.spawnInstance({ id: inst.id, name: inst.name, dutyEligible: true });
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
        const r = await window.warmy.pickFile({ filters: ['md'] });
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
        const tianJiaAnNiu = $('i-add-model');
        const delBtn = $('i-del-model');
        if (tianJiaAnNiu) {
          tianJiaAnNiu.disabled = !full || inChain;
          tianJiaAnNiu.style.opacity = tianJiaAnNiu.disabled ? 0.45 : 1;
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
      // 这里原本漏了 await：`!uiConfirm(...)` 永远是 false（Promise 恒真），于是**确认框形同虚设**
      // —— 还没等用户点，牛马就已经被删掉了（顺手修掉，属同类缺陷：确认框必须真的能拦住操作）。
      if (!(await uiConfirm(t('instances.delete') + '?'))) return;
      try {
        await window.warmy.stopInstance(inst.id);
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

  /**
   * 凭证的**遮蔽显示**：露**前 3 组、后 4 组**，中间每一组都用「牛马」两个字写满。
   *
   * 为什么要遮：凭证就是私钥，屏幕上把它完整摆着，旁边有人看一眼/截个图就等于泄露。
   * 遮蔽形状按产品主逐轮收紧：51 位（17 组）现在是 `2B5-09V-KPY-牛马-…-牛马-3PX-0KP-T3Q`
   * —— 中间 **10 个「牛马」**（每组两个字，不是三个）。后段多露一组，便于核对结尾。
   */
  const CRED_HEAD_GROUPS = 3;
  const CRED_TAIL_GROUPS = 4;
  function maskCredential(value) {
    const s = String(value || '');
    if (!s) return '—';
    const raw = s.replace(/[\s-]+/g, '');
    if (raw.length <= 6) return s;
    const parts = [];
    for (let i = 0; i < raw.length; i += 3) parts.push(raw.slice(i, i + 3));
    if (parts.length <= CRED_HEAD_GROUPS + CRED_TAIL_GROUPS) return parts.join('-');
    const hidden = parts.length - CRED_HEAD_GROUPS - CRED_TAIL_GROUPS;
    return [
      ...parts.slice(0, CRED_HEAD_GROUPS),
      ...Array(hidden).fill('牛马'),
      ...parts.slice(-CRED_TAIL_GROUPS),
    ].join('-');
  }

  /** 小眼睛图标（内联 SVG，不依赖字体/emoji） */
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>';

  function renderPage() {
    const box = $('page-body');
    /**
     * **模型占用表**（模型 → 谁在用）。
     *
     * ⚠️ 声明必须放在这里（而不是供应商那段代码的中间）：`let` 有 TDZ，
     * 供应商卡片在渲染时会读它，一旦某个供应商**已经有模型**，读取就发生在声明之前 ⇒
     * `ReferenceError: Cannot access 'modelUsageCache' before initialization`，
     * 整页设置渲染中断（表现为"点了按钮像是跳回设置首页"）。
     * 以前每个供应商的 models 都是空的（回调不执行）所以没暴露出来。
     * 真实数据一来必炸 —— 门禁灌了"有模型的供应商"后当场复现。
     */
    let modelUsageCache = new Map();
    if (state.nav === 'me') {
      const p = state.profile;
      const avHtml = `<img class="avatar-img big" src="${personAvatarSrc(p)}" alt=""/>`;
      box.innerHTML = `
        <div class="me-top">
          <!-- 品牌块：**logo 与名称上下排列**（不再左右挤在一起）⇒ logo 可以更大 -->
          <div class="me-brand me-brand-stack">
            <img class="brand-logo brand-logo-xl" src="./icons/logo-tight.png" alt="${escapeHtml(t('brand.name'))}"/>
            <div class="me-brand-text">
              <div class="me-brand-name">${escapeHtml(t('brand.name'))}</div>
              <div class="me-brand-sub">${escapeHtml(t('brand.sub'))}</div>
              <div class="muted me-brand-tag">${escapeHtml(t('brand.tagline') || '')}</div>
            </div>
          </div>
          <!-- 用户资料：**一列**。
               排布按产品主要求：头像 → 下面用户名（邮箱在用户名**右侧**）→ 再下面凭证。
               指纹那一块删掉了：它与"凭证"是同一件东西的两种显示（产品主："这2个重复了"）。 -->
          <div class="me-strip me-strip-col" style="flex:1;min-width:300px;margin:0">
            <div class="me-avatar-col">
              <button id="p-av-btn" class="av-btn" aria-label="${escapeHtml(t('me.avatar'))}">${avHtml}</button>
              <!-- 用户名在头像下面；邮箱在用户名右侧；名称可点击就地编辑 -->
              <div class="me-name-row">
                <span id="p-name-display" class="username-display" title="${escapeHtml(t('me.username'))}">${escapeHtml(p.username || t('nav.avatar'))}</span>
                <input id="p-name" class="username-input hidden" value="${escapeHtml(p.username)}"/>
                <span class="me-email-inline">
                  <input id="p-email" autocomplete="email" placeholder="name@example.com" value="${escapeHtml(p.email || '')}" title="${escapeHtml(t('me.email'))}"/>
                </span>
                <span class="muted" id="p-email-msg" style="font-size:11px"></span>
              </div>
            </div>
            <div class="me-info-col">
              <div class="field">
                <label>${escapeHtml(t('me.credential'))}</label>
                <div class="me-cred-box">
                  <!-- 默认只露**前三后三**，中间用等长的「牛马」遮住；小眼睛点击后看全貌 -->
                  <span class="me-cred-val" id="me-id-val" data-shown="0">${escapeHtml(maskCredential(p.deviceId || ''))}</span>
                  <button class="btn-mini me-eye" id="btn-me-id-eye" type="button"
                          aria-label="${escapeHtml(t('me.showFull'))}" title="${escapeHtml(t('me.showFull'))}">
                    <span class="me-eye-off" aria-hidden="true">${EYE_SVG}</span>
                  </button>
                  <button class="btn-mini" id="btn-me-id-copy">${t('me.copy')}</button>
                  <button class="btn-mini" id="btn-me-cred-rotate">${t('me.changeCred')}</button>
                  <button class="btn-mini" id="btn-me-cred-switch">${t('me.switchIdentity')}</button>
                </div>
                <div class="muted me-hint" style="margin-top:4px">${escapeHtml(t('me.idHint'))}</div>
                <!-- 诚实告知：凭证就是私钥，泄露 = 身份被接管；没有服务器能替你找回 -->
                <div class="me-hint me-hint-warn" style="margin-top:4px">${escapeHtml(t('me.idWarn'))}</div>
              </div>
            </div>
          </div>
        </div>
        <div id="dash-host"></div>`;
      // 凭证 = ID = 私钥（只展示给本人；指纹不再单独显示，避免与它重复）
      (async () => {
        try {
          const info = await window.warmy.credentialInfo?.();
          const idEl = $('me-id-val');
          if (idEl && info?.ok && info.credential) {
            idEl.dataset.raw = info.credential;
            idEl.dataset.full = info.formatted || info.credential;
            idEl.textContent = idEl.dataset.shown === '1' ? idEl.dataset.full : maskCredential(info.credential);
          }
        } catch { /* noop */ }
      })();
      /**
       * 小眼睛：在"遮蔽"与"全貌"之间切换（按钮图标与 aria 也跟着变）。
       *
       * ⚠️ 必须容忍"异步还没回来就点"：`credentialInfo()` 是异步的，用户完全可能
       * 在它返回前就点眼睛。以前这里直接读 dataset，读不到就退化成把**当前文本**
       * 当全貌显示（门禁实测抓到：显示出一段不完整的值）。现在读不到就**当场补一次**，
       * 拿不到就什么都不改（宁可不动，也不显示半截凭证）。
       */
      $('btn-me-id-eye')?.addEventListener('click', async () => {
        const yuanSu = $('me-id-val');
        if (!yuanSu) return;
        if (!yuanSu.dataset.full || !yuanSu.dataset.raw) {
          try {
            const info = await window.warmy.credentialInfo?.();
            if (info?.ok && info.credential) {
              yuanSu.dataset.raw = info.credential;
              yuanSu.dataset.full = info.formatted || info.credential;
              yuanSu.textContent = maskCredential(info.credential);
            }
          } catch { /* noop */ }
        }
        if (!yuanSu.dataset.full && !yuanSu.dataset.raw) return;
        const shown = yuanSu.dataset.shown === '1';
        yuanSu.dataset.shown = shown ? '0' : '1';
        yuanSu.textContent = shown ? maskCredential(yuanSu.dataset.raw || '') : (yuanSu.dataset.full || yuanSu.dataset.raw || '');
        const btn = $('btn-me-id-eye');
        if (btn) {
          const label = shown ? t('me.showFull') : t('me.hideFull');
          btn.setAttribute('aria-label', label);
          btn.setAttribute('title', label);
          btn.classList.toggle('on', !shown);
        }
      });
      $('btn-me-id-copy')?.addEventListener('click', async () => {
        const yuanSu = $('me-id-val');
        const v = (yuanSu && yuanSu.dataset.raw) || (yuanSu && yuanSu.textContent) || '';
        try { await navigator.clipboard.writeText(v); uiAlert(t('contact.mineCopied')); } catch { uiAlert(t('contact.mineCopyFail')); }
      });
      $('btn-me-cred-copy')?.addEventListener('click', async () => {
        const yuanSu = $('me-id-val');
        const v = (yuanSu && yuanSu.dataset.raw) || (yuanSu && yuanSu.textContent) || '';
        try { await navigator.clipboard.writeText(v); uiAlert(t('contact.mineCopied')); } catch { uiAlert(t('contact.mineCopyFail')); }
      });
      /**
       * 更换凭证：**ID 与身份必须同时换**。
       * 因为"ID 就是私钥"，只换身份而不换 ID 会留下"两把不同的密钥"这个矛盾；
       * 主进程的 credential-rotate 会：备份旧身份 → 生成新凭证 → 用它派生出新身份 → 写回配置。
       */
      $('btn-me-cred-rotate')?.addEventListener('click', async () => {
        if (!(await uiConfirm(t('me.changeCred') + '?'))) return;
        const r = await window.warmy.credentialRotate?.().catch(() => null);
        if (r?.ok && r.credential) {
          const yuanSu = $('me-id-val');
          if (yuanSu) { yuanSu.textContent = r.formatted || r.credential; yuanSu.dataset.raw = r.credential; }
          uiAlert(t('me.credRotated'));
        } else {
          uiAlert(String(r?.error || 'fail'));
        }
      });
      $('btn-me-cred-switch')?.addEventListener('click', () => {
        const root = $('modal-root');
        $('modal-title').textContent = t('me.switchIdentity');
        $('modal-body').innerHTML =
          '<div class="muted" style="margin-bottom:8px">' + escapeHtml(t('me.switchHint')) + '</div>' +
          '<div class="field"><label>' + escapeHtml(t('me.backupJson')) + '</label>' +
          '<textarea id="me-backup-json" rows="5" style="width:100%"></textarea></div>' +
          '<div class="field" style="margin-top:8px"><label>' + escapeHtml(t('me.passphrase')) + '</label>' +
          '<input id="me-backup-pass" type="password"/></div>' +
          '<div class="muted" id="me-switch-msg" style="margin-top:6px"></div>';
        const acts = $('modal-actions');
        acts.innerHTML = '';
        const cancel = document.createElement('button');
        cancel.className = 'btn-mini';
        cancel.textContent = t('common.cancel') || 'Cancel';
        cancel.onclick = () => root.classList.add('hidden');
        const QueDingAnNiu = document.createElement('button');
        QueDingAnNiu.className = 'btn-primary';
        QueDingAnNiu.textContent = t('common.ok') || 'OK';
        QueDingAnNiu.onclick = async () => {
          const backupJson = $('me-backup-json')?.value || '';
          const passphrase = $('me-backup-pass')?.value || '';
          const r = await window.warmy.identityBackupImport?.({ backupJson, passphrase }).catch(() => null);
          const msg = $('me-switch-msg');
          if (r?.ok) {
            if (msg) msg.textContent = (t('me.switchIdentity') || '') + ' OK · ' + (r.fingerprint || '');
            /**
             * 恢复进来的身份也要与"凭证 = 私钥"这条不变量一致：
             * 主进程会从恢复出来的私钥**反推出对应的凭证**并写回配置，这里直接读回来显示。
             */
            const info = await window.warmy.credentialInfo?.().catch(() => null);
            const yuanSu = $('me-id-val');
            if (yuanSu && info?.ok && info.credential) { yuanSu.textContent = info.formatted || info.credential; yuanSu.dataset.raw = info.credential; }
            setTimeout(() => root.classList.add('hidden'), 600);
          } else if (msg) {
            msg.textContent = String(r?.error || 'fail');
          }
        };
        acts.append(cancel, QueDingAnNiu);
        root.classList.remove('hidden');
      });
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
      // 邮箱：格式正确即**即时保存**（不提供"保存资料"按钮）
      (function bindEmailAutoSave() {
        const shuRu = $('p-email');
        const msg = $('p-email-msg');
        if (!shuRu) return;
        let lastSaved = state.profile.email || '';
        const valid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
        const tongBu = () => {
          const v = String(shuRu.value || '').trim();
          if (!v) {
            if (msg) msg.textContent = '';
            if (lastSaved) { state.profile.email = ''; saveProfile(); lastSaved = ''; }
            return;
          }
          if (!valid(v)) {
            if (msg) msg.textContent = t('me.emailInvalid') || 'Invalid email';
            shuRu.classList.add('invalid');
            return;
          }
          shuRu.classList.remove('invalid');
          if (v !== lastSaved) {
            state.profile.email = v;
            saveProfile();
            lastSaved = v;
            if (msg) msg.textContent = t('me.emailSaved') || 'Saved';
            setTimeout(() => { if (msg) msg.textContent = ''; }, 1500);
          }
        };
        shuRu.addEventListener('input', tongBu);
        shuRu.addEventListener('blur', tongBu);
      })();
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
          <button data-sec="skill">${t('settings.tabSkills')}</button>
          <button data-sec="plugin">${t('settings.tabPlugins')}</button>
          <button data-sec="hotkey">${t('settings.section.hotkey')}</button>
          <button data-sec="about">${t('settings.section.about')}</button>
        </div>
        <div class="settings-content" id="settings-content">
        <div class="set-section" data-sec="ui"><h2 style="color:var(--accent)">${t('settings.section.ui')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.language')}</h2>
          <select id="sel-locale" title="${escapeHtml(t('settings.language'))}">
            ${localeOptionsHtml(state.locale)}
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
        </div>
                <div class="set-section set-card" id="notify-email-card">
          <h2>${t('settings.emailNotify')}</h2>
          <p class="muted">${t('settings.emailNotifyHint')}</p>
          <h3 style="font-size:13px;margin:10px 0 4px">${t('smtp.title')} <span class="muted">(${t('smtp.count')} <span id="smtp-n">0</span>/10 · ${t('smtp.max10')})</span></h3>
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
          <div style="font-weight:600;font-size:13px;margin:12px 0 6px">${t('settings.emailNotify')}</div>
          <div id="smtp-email-notify2">
            ${['complete', 'request', 'error']
              .map(
                (k) =>
                  '<label style="margin-right:14px"><input type="checkbox" data-email-k="' + k + '" ' +
                  (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</label>'
              )
              .join('')}
            <div class="muted">${t('settings.emailHint')}</div>
          </div>
          <div class="notify-apply-bar">
            <button class="btn-mini" id="btn-notify-cancel">${t('settings.notifyCancel')}</button>
            <button class="btn-primary" id="btn-notify-apply">${t('settings.notifyApply')}</button>
            <span class="muted" id="notify-apply-msg"></span>
          </div>
          <span class="muted" id="smtp-msg"></span>
        </div>
        <div class="set-section" data-sec="model"><h2 style="color:var(--accent)">${t('settings.section.model')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.providers')} <span class="muted" id="prov-count"></span></h2>
          <div class="inst-row" style="align-items:flex-end;margin-bottom:10px">
            <div class="field" style="max-width:220px">
              <label>${t('settings.providerPreset')}</label>
              <select id="prov-preset"></select>
            </div>
            <button class="btn-primary" id="btn-add-prov">${t('settings.addProvider')}</button>
          </div>
          <div id="prov-list"></div>
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
        <!-- ═══ ADR 004：功能 → 容器 ═══════════════════════════════════════
             ADR §3.2：主操作 =「查看本机已有容器」→ 列出本机**已有**的容器（含三态与不可用原因）；
             下方 =「常用容器安装说明」折叠区（折叠只显示名字，展开显示 收费/商用/系统/体积 + 官网四条链接）。
             列表数据来自主进程真探测（warmy:container-probe），不是写死的。 -->
        <div class="set-section set-card" id="container-card">
          <h2>${t('container.title')}</h2>
          <p class="ctg-dim">${t('container.hint')}</p>
          <div class="inst-row" style="align-items:center;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-primary" id="btn-container-probe">${t('container.probeBtn')}</button>
            <span class="ctg-dim" id="container-probe-msg" data-probe-state="idle"></span>
          </div>
          <div id="container-cta" class="ctg-cta hidden">${t('container.guideFirstStep')}</div>
          <div class="ctg-summary" id="container-summary" data-summary="none"></div>
          <!-- 第十七批：**本机已有容器**与**镜像**也做成折叠块（与"常用容器安装说明"一致）：
               折叠时只有标题 + 一个箭头；展开后箭头翻转朝下，一眼看出能收起。 -->
          <details class="ctg-collapse ctg-fold" id="container-existing-collapse">
            <summary class="ctg-fold-summary">
              <span class="ctg-caret" aria-hidden="true"></span>
              <span class="ctg-fold-title">${t('container.section.existing')}</span>
              <span class="ctg-dim" id="container-count-inline"></span>
              <span class="ctg-dim">${t('container.listTitleHint')}</span>
            </summary>
            <div class="ctg-collapse-body">
              <div class="ctg-list-head"><span>${t('container.listTitle')}</span></div>
              <div id="container-list" class="ctg-list" data-probe="none"></div>
              <div class="ctg-dim" id="container-missing-note"></div>
              <div class="ctg-hint-box" id="container-target-note">
            <div class="ctg-hint-title">${t('container.target.title')}</div>
            <div class="ctg-dim">${t('container.target.hint')}</div>
            <div class="ctg-hint-title">${t('container.mount.title')}</div>
            <div class="ctg-dim">${t('container.mount.body')}</div>
            <div class="ctg-dim">${t('container.mount.perf')}</div>
          </div>
            </div>
          </details>
          <!-- 镜像：同样折叠（标题 + 箭头） -->
          <details class="ctg-collapse ctg-fold" id="container-images-collapse">
            <summary class="ctg-fold-summary">
              <span class="ctg-caret" aria-hidden="true"></span>
              <span class="ctg-fold-title">${t('container.section.images')}</span>
            </summary>
            <div class="ctg-collapse-body">
          <div class="ctg-guide-head">${t('container.image.title')}</div>
          <div class="ctg-dim">${t('container.image.why')}</div>
          <div class="ctg-dim">${t('container.image.node')}</div>
          <div class="ctg-dim">${t('container.image.sourcePending')}</div>
          <div id="container-images" class="ctg-list"></div>
          <!-- 第八/九批：镜像按**项目技术栈**选 + 环境由用户自装 + 一键复制的安装提示词 -->
          <div class="ctg-hint-box" id="container-image-stack-scale">
            <div class="ctg-hint-title">${t('container.image.stack.title')}</div>
            <div class="ctg-dim">${t('container.image.stack.nodeOnly')}</div>
            <div class="ctg-dim">${t('container.image.executorHost')}</div>
            <div class="ctg-dim">${t('container.image.stack.moreLater')}</div>
            <div id="container-image-stacks" class="ctg-list"></div>
          </div>
            </div>
          </details>
          <details class="ctg-collapse ctg-fold" id="container-guide-collapse">
            <summary class="ctg-fold-summary">
              <span class="ctg-caret" aria-hidden="true"></span>
              <span class="ctg-fold-title">${t('container.guideCollapse')}</span>
            </summary>
            <div class="ctg-collapse-body">
          <div class="ctg-hint-box" id="container-env-install">
            <div class="ctg-hint-title">${t('container.env.install.title')}</div>
            <div class="ctg-dim">${t('container.env.install.body')}</div>
            <div class="ctg-hint-title">${t('container.env.install.persistTitle')}</div>
            <div class="ctg-dim">${t('container.env.install.persistBody')}</div>
            <div class="ctg-hint-title">${t('container.env.install.netTitle')}</div>
            <div class="ctg-dim">${t('container.env.install.netBody')}</div>
            <div class="ctg-dim">${t('container.env.install.noNodeForUs')}</div>
          </div>
          <div class="ctg-hint-box" id="container-install-prompt">
            <div class="ctg-hint-title">${t('container.env.prompt.title')}</div>
            <div class="ctg-dim">${t('container.env.prompt.hint')}</div>
            <pre id="ctg-install-prompt-text" class="ctg-prompt-text" data-prompt-lang=""></pre>
            <div class="ctg-actions-row">
              <button type="button" class="btn-mini" id="btn-copy-install-prompt">${t('container.env.prompt.copy')}</button>
              <span class="ctg-dim" id="ctg-install-prompt-msg" data-copy-state="idle"></span>
            </div>
          </div>
          <!-- 第八批：快照与回退点的关系（分层；不许声称"有容器回退点就更简单"） -->
          <div class="ctg-hint-box" id="container-snapshot-note">
            <div class="ctg-hint-title">${t('container.snapshot.title')}</div>
            <div class="ctg-dim">${t('container.snapshot.body')}</div>
            <div class="ctg-dim">${t('container.snapshot.layerFiles')}</div>
            <div class="ctg-dim">${t('container.snapshot.layerEnv')}</div>
            <div class="ctg-dim">${t('container.snapshot.fingerprint')}</div>
            <div class="ctg-dim">${t('container.snapshot.noClaim')}</div>
          </div>
          <div class="ctg-guide-head">${t('container.timing.title')}</div>
          <div id="container-timings" class="ctg-dim"></div>
          <div class="ctg-guide-head">${t('container.guideTitle')}</div>
          <div class="ctg-dim">${t('container.guideHint')}</div>
          <div id="container-guide" class="ctg-guide"></div>
            </div>
          </details>
        </div>
        <div class="set-section" data-sec="plugin"><h2 style="color:var(--accent)">${t('settings.tabPlugins')}</h2></div>
        <div class="set-section set-card">
          <h2>${t('settings.plugins')}</h2>
          <div id="plug-list" class="plugin-list"></div>
          <div class="inst-row" style="margin-top:6px;align-items:center">
            <button class="btn-mini" id="btn-plug-install-folder">${t('settings.pluginInstallBrowse')}</button>
          </div>
          <div class="skill-scan-block" style="margin-top:10px">
            <div class="skill-scan-title">${t('settings.pluginScanTitle')}</div>
            <div id="plug-scan-dirs"></div>
            <div class="inst-row" style="margin-top:6px;align-items:center">
              <input id="plug-scan-dir-input" style="flex:1;min-width:120px" placeholder="${escapeHtml(t('settings.skillsScanPlaceholder'))}"/>
              <button class="btn-mini" id="btn-plug-scan-browse">${t('settings.pickFolder')}</button>
              <button class="btn-mini" id="btn-plug-scan-add">${t('settings.skillsScanAdd')}</button>
            </div>
            <div style="margin-top:6px">
              <button class="btn-mini" id="btn-plug-scan-check">${t('settings.pluginScanCheck')}</button>
              <button class="btn-mini" id="btn-plug-scan-machine">${t('settings.scanMachine')}</button>
            </div>
            <div class="muted" id="plug-scan-msg"></div>
          </div>
        </div>
        <!-- 内网同步 / 多节点组网 旧设置块已移除：功能由下方「组网设置」卡片承接。
             底层 IPC 通道 warmy:lan-* / warmy:mesh-* 保留为产品契约，仅去掉 UI 与死渲染代码。 -->
        <!-- R8：组网设置：混合公网地址列表（IP + 域名）+ 刷新本机/公网地址 + 逐条检测 + 开关（检测通过才能打开） -->
        <div class="set-section set-card" id="net-card" data-sec="func">
          <h2>${t('net.title')} <button type="button" class="btn-mini net-help-btn" id="btn-net-help" aria-label="${escapeHtml(t('net.helpTitle'))}" title="${escapeHtml(t('net.helpTitle'))}">?</button></h2>
          <div id="net-help-box" class="muted net-help-box hidden">${escapeHtml(t('net.helpBody'))}</div>
          <p class="muted" style="margin:0 0 10px">${t('net.hint')}</p>
          <div class="inst-row">
            <div class="field" style="max-width:120px"><label>${t('net.port')}</label><input id="net-port" value="${escapeHtml(String(netState.addr.port || ''))}"/></div>
          </div>
          <!-- R13：端口**只是默认值 + 约定**，不是限制 —— 输入框永远可改（1–65535）。
               约定端口（开发/测试）在这里提示；实际绑上的端口由组网层事实驱动。
               data-convention / data-bound 是给验收脚本的稳定契约（不必解析文案）。 -->
          <div class="muted net-port-hint" id="net-port-hint" data-convention=""></div>
          <div class="muted net-port-bound" id="net-port-bound" data-bound=""></div>
          <!-- R13：**端口无法绑定**时在这里明确告知（端口号 + 底层错误码）+ 给出**可点选的建议**
               端口（点一下只填进输入框，不自动改端口、不替用户做主）。默认隐藏。 -->
          <div class="net-port-conflict hidden" id="net-port-conflict" data-fail-port="" data-fail-code=""></div>
          <!-- 本机地址事实 + 刷新按钮（取代旧「自动填入本机地址」） -->
          <div class="inst-row" style="align-items:center;gap:8px;margin:6px 0">
            <div class="muted" id="net-local-info" style="flex:1;min-width:0"></div>
            <button type="button" class="btn-mini" id="btn-net-refresh" title="${escapeHtml(t('net.refresh'))}">${t('net.refresh')}</button>
          </div>
          <!-- 附八.9 / 附八.3：连接阶梯档位 + 中继状态（全部走 i18n；未实现的档如实标「尚未实现」） -->
          <div class="net-ladder" id="net-ladder" data-sig=""></div>
          <!-- 公网地址列表：IP 与域名共用同一列表；标签只出现一次（修复旧双重渲染缺陷） -->
          <div style="margin-top:6px">
            <label class="net-sub-label" id="net-public-list-label">${t('net.domainTitle')}</label>
            <div id="net-domains"></div>
            <div style="margin-top:6px"><button class="btn-mini" id="btn-net-domain-add">${t('net.domainAdd')}</button></div>
          </div>
          <div id="net-entry-results" class="net-entry-results"></div>
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
        <div class="set-section set-card" id="settings-data-card" data-sec="func">
          <h2>${t('settings.dataTitle')}</h2>
          <p class="muted">${t('settings.dataHint')}</p>
          <div id="settings-data-metrics" class="diag-grid"></div>
        </div>
        <div class="set-section set-card" data-sec="func">
          <h2>${t('ctx.archive')}</h2>
          <p class="muted">${t('archive.hint')}</p>
          <div id="archived-box" class="muted">—</div>
        </div>
        <div class="set-section set-card" data-sec="model">
          <h2>${t('settings.specialModels')}</h2>
          <p class="muted">${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.asrModel')}</label>
            <select id="sm-asr" data-special="asr"></select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.embeddingModel')}</label>
            <select id="sm-embed" data-special="embed"></select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.organizerModel')}</label>
            <select id="sm-organizer" data-special="organizer"></select>
          </div>
          <div style="margin-top:8px"><button class="btn-mini" id="btn-webgpu">${t('webgpu.test')}</button> <span class="muted" id="webgpu-msg"></span></div>
          <button class="btn-mini" id="btn-save-special">${t('common.save')}</button>
          <span class="muted" id="sm-msg"></span>
        </div>
        
        <div class="set-section set-card" data-sec="func">
          <h2>${t('join.blacklistTitle')}</h2>
          <div id="blacklist-box" class="muted">${t('join.blacklistEmpty')}</div>
        </div>
        <div class="set-section" data-sec="skill"><h2 style="color:var(--accent)">${t('settings.tabSkills')}</h2></div>
        <div class="set-section set-card" id="skills-card">
          <h2>${t('settings.skills')}</h2>
          <p class="muted" style="margin:0 0 8px">${t('settings.skillsHint')}</p>
          <div style="margin-bottom:8px"><button class="btn-mini" id="btn-skill-import">${t('settings.skillsImport')}</button></div>
          <div class="skill-scan-block">
            <div class="skill-scan-title">${t('settings.skillsScanTitle')}</div>
            <div class="muted">${t('settings.skillsScanHint')}</div>
            <div id="skill-scan-dirs"></div>
            <div class="inst-row" style="margin-top:6px;align-items:center">
              <input id="skill-scan-dir-input" class="skill-scan-input" placeholder="${escapeHtml(t('settings.skillsScanPlaceholder'))}" style="flex:1;min-width:120px"/>
              <button class="btn-mini" id="btn-skill-scan-browse">${t('settings.pickFolder')}</button>
              <button class="btn-mini" id="btn-skill-scan-add">${t('settings.skillsScanAdd')}</button>
            </div>
            <div style="margin-top:6px">
              <button class="btn-mini" id="btn-skill-scan-check">${t('settings.skillsScanCheck')}</button>
              <button class="btn-mini" id="btn-skill-scan-machine">${t('settings.scanMachine')}</button>
            </div>
            <div class="muted" id="skill-scan-msg"></div>
          </div>
          <div id="skill-list" class="muted">${t('settings.skillsEmpty')}</div>
          <div class="muted skill-paths" id="skill-paths"></div>
        </div>
        <!-- R2「快捷」：**键盘快捷键在前**，AI/IPC 接口目录在后 -->
        <div class="set-section" data-sec="hotkey"><h2 style="color:var(--accent)">${t('settings.section.hotkey')}</h2></div>
        <div class="set-section set-card" id="hk-keys-card">
          <h2>${t('settings.hotkey.keyTitle')}</h2>
          <p class="hk-hint">${t('settings.hotkey.keyHint')}</p>
          <p class="hk-hint">${t('settings.hotkey.onlyWired')}</p>
          <table class="hk-keys">
            <thead><tr><th>${t('settings.hotkey.colAction')}</th><th>${t('settings.hotkey.colBinding')}</th><th>${t('settings.hotkey.colDesc')}</th></tr></thead>
            <tbody id="hk-keys-body"></tbody>
          </table>
          <div class="hk-msg" id="hk-keys-msg"></div>
        </div>
        <div class="set-section set-card" id="hk-api-card">
          <h2>${t('settings.hotkey.apiTitle')}</h2>
          <p class="hk-hint">${t('settings.hotkey.apiHint')}</p>
          <div class="hk-count" id="hk-api-count"></div>
          <div style="margin:6px 0">
            <button class="btn-mini" id="btn-copy-api-ops">${escapeHtml(t('settings.hotkey.apiCopyOps') || 'Copy AI guide')}</button>
            <span class="muted" id="api-copy-msg"></span>
          </div>
          <input class="hk-filter" id="hk-api-filter" placeholder="${escapeHtml(t('settings.hotkey.apiFilter'))}"/>
          <div id="hk-api-body"></div>
          <div class="hk-api-events" id="hk-api-events"></div>
        </div>
        <div class="set-section" data-sec="about"><h2 style="color:var(--accent)">${t('settings.section.about')}</h2></div>
        <div class="set-section set-card about-card">
          <div class="about-brand">
            <img class="about-logo" src="./icons/logo-tight.png" alt="${escapeHtml(t('about.logoAlt'))}"/>
            <div class="about-brand-text">
              <div class="about-name">${escapeHtml(t('brand.name'))}</div>
              <div class="about-sub">${escapeHtml(t('brand.sub'))}</div>
              <div class="about-tagline">${escapeHtml(t('brand.tagline') || t('about.tagline'))}</div>
              <div class="about-ver-line">
                <span class="muted about-ver" id="about-version">—</span>
                <button class="btn-mini" id="btn-about-update">${t('about.checkUpdate')}</button>
                <span class="muted" id="about-upd"></span>
              </div>
            </div>
          </div>
          <div class="about-block">
            <h3>${t('about.versionInfo')}</h3>
            <div class="muted" id="about-runtime">—</div>
            <div class="muted" id="about-device">—</div>
          </div>
          <div class="about-block">
            <h3>${t('memory.statusTitle')}</h3>
            <p class="muted">${t('memory.desc')}</p>
            <div class="muted" id="about-memory">—</div>
            <div style="margin-top:8px">
              <button class="btn-mini" id="btn-memory-rebuild">${t('memory.rebuild')}</button>
              <span class="muted" id="about-memory-msg"></span>
            </div>
            <p class="muted" style="margin-top:6px">${t('memory.rebuildWhy')}</p>
          </div>
          <div class="about-block">
            <h3>${t('privacy.viewTitle')}</h3>
            <div class="privacy-view" id="about-privacy-view">${privacyHtml(t('privacy.body'))}</div>
            <div style="margin-top:8px">
              <button class="btn-mini" id="btn-privacy-revoke">${t('privacy.revoke')}</button>
              <span class="muted" id="privacy-revoke-msg"></span>
            </div>
          </div>
          <div class="about-block"><h3>${t('about.opensource')}</h3><p class="muted">${t('about.opensourceBody')}</p></div>
          <div class="about-block"><h3>${t('about.techStack')}</h3><p class="muted">${t('about.techStackBody')}</p></div>
          <div class="about-block"><h3>${t('about.copyright')}</h3><p class="muted">${t('about.copyrightBody')}</p></div>
          <div class="about-block"><h3>${t('about.author')}</h3><p class="muted">${t('about.authorBody')}</p></div>
          <div class="about-block"><h3>${t('about.contact')}</h3><p class="muted">${t('about.contactBody')}</p></div>
          <div class="about-block"><h3>${t('about.legal')}</h3><p class="muted">${t('about.legalBody')}</p></div>
        </div></div></div>`;

      // 更新源 UI 已从「关于」移除（产品要求）。设置项 updateFeedUrl 仍然生效：
      // 可由 settings.json / 环境变量 WARMY_UPDATE_FEED_URL / IPC updateSourceSet 写入。
      // 这里不再渲染入口，也不再调用 updateSourceGet/Set。
      $('btn-about-update').onclick = async () => {
        const yuanSu = $('about-upd');
        if (yuanSu) yuanSu.textContent = t('about.checking');
        // 主进程会区分「未配置 / 网络失败 / HTTP 错误 / 格式非法 / 已最新 / 有更新」，
        // 不能只看 upToDate —— 那会把「未配置」误报成「发现新版本」。
        const r = await window.warmy.checkUpdate().catch(() => null);
        if (yuanSu) yuanSu.textContent = updateStatusText(r);
      };
      (async () => {
        try {
          const info = await window.warmy.appInfo();
          if (!info?.ok) return;
          const v = $('about-version');
          if (v) v.textContent = `${t('about.version')} ${info.version}`;
          const rt = $('about-runtime');
          if (rt) rt.textContent =
            `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}/${info.arch}`;
          const dv = $('about-device');
          // 产品要求：关于-版本信息**不显示设备 ID**
          if (dv) dv.textContent = `${t('about.version')} ${info.version || ''} · ${info.platform || ''}/${info.arch || ''}`;
        } catch { /* noop */ }
      })();
      // 记忆系统状态（产品重点：JSONL + FTS + 向量；未就绪如实显示）
      (async () => {
        const yuanSu = $('about-memory');
        const msg = $('about-memory-msg');
        const btn = $('btn-memory-rebuild');
        const xuanranJiyi = (st) => {
          if (!yuanSu) return;
          const ready = !!st?.ready;
          const line1 = ready ? t('memory.ready') : t('memory.notReady');
          const vec = st?.vector?.vector || st?.vector || null;
          let vecText = '—';
          try {
            if (vec && typeof vec === 'object') {
              const ok = vec.ok !== false && (vec.available ?? vec.ready ?? true);
              vecText = ok ? (vec.model || vec.status || 'ok') : (vec.reason || vec.error || 'n/a');
            }
          } catch { /* noop */ }
          let recText = '—';
          try {
            const s = st?.stats?.stats || st?.stats || null;
            if (s && typeof s === 'object') recText = JSON.stringify(s).slice(0, 120);
          } catch { /* noop */ }
          yuanSu.textContent = `${line1} · ${t('memory.vector')}: ${vecText} · ${t('memory.records')}: ${recText}`;
        };
        try {
          const st = await window.warmy.memoryStatus?.();
          xuanranJiyi(st);
        } catch (e) {
          if (yuanSu) yuanSu.textContent = t('memory.notReady');
        }
        if (btn) {
          btn.onclick = async () => {
            if (msg) msg.textContent = '';
            const r = await window.warmy.memoryRebuild?.().catch((e) => ({ ok: false, error: String(e) }));
            if (msg) msg.textContent = r?.ok ? t('memory.rebuildOk') : `${t('memory.rebuildFail')}${r?.error ? ' · ' + r.error : ''}`;
            try { xuanranJiyi(await window.warmy.memoryStatus?.()); } catch { /* noop */ }
          };
        }
      })();

      // 设置：第二列是菜单，第三列只显示对应板块
      (function bindSettingsMenu() {
        const neirongYuansu = $('settings-content');
        if (!neirongYuansu) return;
        const secIds = ['ui', 'notify', 'model', 'func', 'skill', 'plugin', 'hotkey', 'about'];
        const groups = { ui: [], notify: [], model: [], func: [], skill: [], plugin: [], hotkey: [], about: [] };
        let curSec = 'ui';
        Array.from(neirongYuansu.children).forEach((yuanSu) => {
          const ds = yuanSu.getAttribute && yuanSu.getAttribute('data-sec');
          if (ds) curSec = ds;
          if (groups[curSec]) groups[curSec].push(yuanSu);
        });
        const navBtns = Array.from(document.querySelectorAll('#settings-nav button'));
        const showSec = (s) => {
          settingsSection = s;   // 记住当前分区：renderPage() 后要回到这里
          secIds.forEach((k) => groups[k].forEach((yuanSu) => { yuanSu.style.display = k === s ? '' : 'none'; }));
          navBtns.forEach((b) => b.classList.toggle('on', b.dataset.sec === s));
        };
        navBtns.forEach((btn) => { btn.onclick = () => showSec(btn.dataset.sec); });
        /**
         * 以前这里写死 showSec('ui')：只要点了「添加供应商 / 拉取模型」之类的按钮，
         * 处理函数内部会 renderPage() 整页重渲染 ⇒ 分区被打回 'ui'，
         * 用户看到的就是"点一下就被弹回设置首页"。
         * 现在改为恢复到用户当前所在分区（点击导航栏时记录）。
         */
        showSec(settingsSection);
      })();

      // 通知+邮箱：确定生效 / 取消恢复
      (function bindNotifyApply() {
        const snap = () => ({
          sound: { ...(state.sound || {}) },
          soundFiles: { ...(state.soundFiles || {}) },
          emailNotify: { ...(state.emailNotify || {}) },
        });
        let backup = snap();
        const readForm = () => {
          const emailNotify = { complete: false, request: false, error: false };
          document.querySelectorAll('#notify-email-card [data-email-k], #smtp-email-notify2 [data-email-k]').forEach((yuanSu) => {
            emailNotify[yuanSu.dataset.emailK] = !!yuanSu.checked;
          });
          // sound checkboxes
          const sound = {
            complete: !!$('s-complete')?.checked,
            request: !!$('s-request')?.checked,
            error: !!$('s-error')?.checked,
          };
          return { emailNotify, sound };
        };
        $('btn-notify-apply')?.addEventListener('click', async () => {
          const f = readForm();
          state.emailNotify = f.emailNotify;
          state.sound = f.sound;
          await window.warmy.settingsSave({ emailNotify: f.emailNotify, sound: f.sound }).catch(() => {});
          backup = snap();
          const m = $('notify-apply-msg');
          if (m) m.textContent = t('settings.notifyApplied');
        });
        $('btn-notify-cancel')?.addEventListener('click', () => {
          state.sound = backup.sound;
          state.soundFiles = backup.soundFiles;
          state.emailNotify = backup.emailNotify;
          if ($('s-complete')) $('s-complete').checked = !!backup.sound.complete;
          if ($('s-request')) $('s-request').checked = !!backup.sound.request;
          if ($('s-error')) $('s-error').checked = !!backup.sound.error;
          document.querySelectorAll('[data-email-k]').forEach((yuanSu) => {
            yuanSu.checked = !!(backup.emailNotify && backup.emailNotify[yuanSu.dataset.emailK]);
          });
          window.warmy.settingsSave({ emailNotify: backup.emailNotify, sound: backup.sound }).catch(() => {});
          const m = $('notify-apply-msg');
          if (m) m.textContent = '';
        });
        // 打开设置页时备份当前生效值
        backup = snap();
      })();

      // 隐私政策：关于页撤销
      $('btn-privacy-revoke')?.addEventListener('click', async () => {
        if (!(await uiConfirm(t('privacy.revokeConfirm')))) return;
        await window.warmy.privacyConsentSet?.(false).catch(() => {});
        await window.warmy.appQuit?.('privacy-revoke').catch(() => {});
      });

      // 技能目录：资源管理器选择 + 检查扫描
      $('btn-skill-scan-browse')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (r?.ok && r.path && $('skill-scan-dir-input')) $('skill-scan-dir-input').value = r.path;
      });
      $('btn-skill-scan-check')?.addEventListener('click', async () => {
        const msg = $('skill-scan-msg');
        if (msg) msg.textContent = '…';
        try {
          await window.warmy.skillsList?.();
          const r = await window.warmy.skillsList?.();
          if (msg) msg.textContent = t('settings.skillsScanCheck') + ' · ' + String((r && (r.skills || r.items) || []).length || 0);
          if (typeof window.__refreshSkills === 'function') window.__refreshSkills();
          else setNav('settings');
        } catch (e) {
          if (msg) msg.textContent = String(e);
        }
      });

      // 插件目录浏览 / 检查
      $('btn-plug-scan-browse')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (r?.ok && r.path && $('plug-scan-dir-input')) $('plug-scan-dir-input').value = r.path;
      });
      $('btn-plug-scan-add')?.addEventListener('click', async () => {
        const input = $('plug-scan-dir-input');
        const dir = (input && input.value || '').trim();
        if (!dir) return;
        let dirs = [];
        try {
          const r = await window.warmy.pluginsScanDirsGet?.();
          dirs = (r && r.dirs) || [];
        } catch { dirs = []; }
        if (dirs.includes(dir) || dirs.length >= 10) return;
        dirs.push(dir);
        await window.warmy.pluginsScanDirsSet?.(dirs.slice(0, 10)).catch(() => {});
        if (input) input.value = '';
        renderPluginScanDirs(dirs);
      });
      $('btn-plug-scan-check')?.addEventListener('click', async () => {
        const msg = $('plug-scan-msg');
        if (msg) msg.textContent = '…';
        const r = await window.warmy.pluginsScan?.().catch(() => null);
        if (!r?.ok) { if (msg) msg.textContent = String(r?.error || 'fail'); return; }
        const found = r.found || [];
        found.forEach((f) => {
          if (!state.plugins.some((p) => p.id === f.id)) {
            state.plugins.push({ id: f.id, name: f.name, desc: f.desc || f.path, enabled: true, source: 'discovered' });
          }
        });
        if (msg) msg.textContent = (t('settings.pluginScanCheck') || '') + ' · ' + found.length;
        renderPluginList();
      });
      $('btn-plug-add')?.addEventListener('click', () => {
        const sel = $('plug-pick');
        const id = sel && sel.value;
        if (!id) return;
        if (!state.plugins.some((p) => p.id === id)) {
          state.plugins.push({ id, name: id, desc: '', enabled: true, source: 'builtin' });
        }
        renderPluginList();
      });

      function renderPluginScanDirs(dirs) {
        const box = $('plug-scan-dirs');
        if (!box) return;
        box.innerHTML = (dirs || []).map((d) => '<div class="ctg-row">' + escapeHtml(d) + '</div>').join('') || '<div class="muted">—</div>';
      }
      function renderPluginList() {
        const box = $('plug-list');
        if (!box) return;
        const yiZhi = ['dsh-agent-teams', 'dsh-memory-plus', 'warmy-board-tools'];
        const pick = $('plug-pick');
        if (pick) {
          pick.innerHTML = yiZhi.map((k) => '<option value="' + escapeHtml(k) + '">' + escapeHtml(k) + '</option>').join('');
        }
        box.innerHTML = (state.plugins || []).map((p, idx) => {
          return '<div class="ctg-row" data-plugin-idx="' + idx + '">' +
            '<div style="font-weight:600">' + escapeHtml(p.name || p.id) + '</div>' +
            '<div class="muted">' + escapeHtml(p.desc || '') + '</div>' +
            '<div style="margin-top:4px;display:flex;gap:6px">' +
            '<button class="btn-mini" data-plug-act="toggle" data-idx="' + idx + '">' + (p.enabled === false ? escapeHtml(t('settings.pluginEnable')) : escapeHtml(t('settings.pluginDisable'))) + '</button>' +
            '<button class="btn-mini" data-plug-act="del" data-idx="' + idx + '">' + escapeHtml(t('settings.pluginDelete')) + '</button>' +
            '</div></div>';
        }).join('') || '<div class="muted">' + escapeHtml(t('settings.skillsEmpty') || '—') + '</div>';
        box.querySelectorAll('[data-plug-act]').forEach((b) => {
          b.onclick = () => {
            const idx = Number(b.getAttribute('data-idx'));
            const act = b.getAttribute('data-plug-act');
            if (!state.plugins[idx]) return;
            if (act === 'toggle') state.plugins[idx].enabled = state.plugins[idx].enabled === false;
            if (act === 'del') state.plugins.splice(idx, 1);
            renderPluginList();
          };
        });
      }
      window.__renderPluginList = renderPluginList;
      (async () => {
        try {
          const r = await window.warmy.pluginsScanDirsGet?.();
          renderPluginScanDirs((r && r.dirs) || []);
        } catch { /* noop */ }
        renderPluginList();
      })();


      // 特殊模型：只允许选择「供应商里已存在的模型」
      async function fillSpecialModelSelects() {
        /**
         * 第 8 条：特殊模型**只能**从「模型供应商」里已添加的模型里选。
         * 之前这里先问 `window.warmy.providersList`（不存在的接口）再退到 settings.providers
         * （也没这份数据），于是即使供应商下一片空白，特殊模型仍能选到东西 —— 用户看到的正是这个。
         * 现在唯一来源 = 界面上的 state.providers（供应商卡片里有几个模型，就只能选这几个）。
         */
        const locals = [];
        for (const p of (state.providers || [])) {
          (p.models || []).forEach((m) => {
            const id = String(typeof m === 'string' ? m : (m.id || m.name || ''));
            if (id) locals.push({ id, provider: p.label || p.id || '', label: id + (p.label ? ' · ' + p.label : '') });
          });
        }
        document.querySelectorAll('select[data-special]').forEach((sel) => {
          const cur = sel.value;
          sel.innerHTML = locals.length
            ? locals.map((m) => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.label) + '</option>').join('')
            : '<option value="">—</option>';
          if (cur) sel.value = cur;
        });
        const msg = $('sm-msg');
        if (msg && !locals.length) msg.textContent = t('settings.specialModelsHint');
      }
      window.__fillSpecialModelSelects = fillSpecialModelSelects;
      fillSpecialModelSelects();

      // 插件：从文件夹安装（资源管理器）
      $('btn-plug-install-folder')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (!r?.ok || !r.path) return;
        // 目录名作为插件 id；若 IPC 支持 skills-import 同类安装则复用
        const id = String(r.path).split(/[\\/]/).filter(Boolean).pop() || 'plugin';
        if (!state.plugins.some((p) => p.id === id)) {
          state.plugins.push({ id, name: id, desc: r.path, enabled: true, source: 'folder' });
        }
        if (typeof window.__renderPluginList === 'function') window.__renderPluginList();
        else setNav('settings');
      });
      $('btn-plug-add')?.addEventListener('click', () => { /* 已移除假下拉添加 */ });

      // 自定义主题色：行内取色（非弹窗套弹窗）+ 全屏 EyeDropper
      (function bindInlineAccent() {
        const host = document.getElementById('theme-custom-row') || document.querySelector('.theme-custom-row');
        if (!host) return;
        let panel = document.getElementById('theme-custom-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.id = 'theme-custom-panel';
          panel.className = 'theme-custom-panel hidden';
          panel.innerHTML = `
            <div class="tcp-row">
              <input type="color" id="tcp-color" value="${escapeHtml(state.theme || '#07c160')}"/>
              <input type="text" id="tcp-hex" placeholder="#07c160" style="width:110px"/>
              <button type="button" class="btn-mini" id="tcp-eyedrop">${escapeHtml(t('settings.pickScreenColor'))}</button>
            </div>
            <div class="muted" style="margin-top:4px">${escapeHtml(t('settings.hexOrRgb'))}</div>
            <div class="tcp-row" style="margin-top:8px">
              <span class="theme-custom-preview" id="tcp-preview"></span>
              <button type="button" class="btn-mini" id="tcp-cancel">${escapeHtml(t('settings.notifyCancel'))}</button>
              <button type="button" class="btn-primary" id="tcp-ok">${escapeHtml(t('settings.notifyApply'))}</button>
            </div>`;
          host.appendChild(panel);
        }
        const btnCustom = document.getElementById('btn-theme-custom');
        const color = () => document.getElementById('tcp-color');
        const shiLiuJin = () => document.getElementById('tcp-hex');
        const prev = () => document.getElementById('tcp-preview');
        const tongBu = (v) => {
          if (!v) return;
          if (color()) color().value = v;
          if (shiLiuJin()) shiLiuJin().value = v;
          if (prev()) prev().style.background = v;
        };
        btnCustom?.addEventListener('click', () => {
          panel.classList.toggle('hidden');
          tongBu(state.theme || '#07c160');
        });
        color()?.addEventListener('input', () => tongBu(color().value));
        shiLiuJin()?.addEventListener('change', () => {
          let v = String(shiLiuJin().value || '').trim();
          if (/^[\d,\s]+$/.test(v)) {
            const p = v.split(/[\s,]+/).filter(Boolean).map(Number);
            if (p.length >= 3) {
              const to2 = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
              v = '#' + to2(p[0]) + to2(p[1]) + to2(p[2]);
            }
          }
          if (/^#[0-9a-fA-F]{6}$/.test(v)) tongBu(v.toLowerCase());
        });
        document.getElementById('tcp-cancel')?.addEventListener('click', () => panel.classList.add('hidden'));
        document.getElementById('tcp-ok')?.addEventListener('click', () => {
          const v = (color() && color().value) || '';
          if (/^#[0-9a-fA-F]{6}$/.test(v)) applyAccent(v);
          panel.classList.add('hidden');
        });
        document.getElementById('tcp-eyedrop')?.addEventListener('click', async () => {
          try {
            if (window.EyeDropper) {
              const ed = new window.EyeDropper();
              const res = await ed.open();
              if (res && res.sRGBHex) tongBu(res.sRGBHex);
            } else {
              uiAlert(t('settings.pickScreenColor') + ' · unsupported');
            }
          } catch { /* user cancel */ }
        });
      })();

      // 第二列顶部「+」：项目/群聊=新建+加入；联系人=添加联系人
      window.__setupListPlusMenu = function setupListPlusMenu(kind) {
        const action = $('list-action');
        const qr = $('btn-join-qr');
        if (!action) return;
        if (kind === 'externalChat') {
          if (qr) qr.classList.add('hidden');
          action.classList.remove('hidden');
          action.textContent = '+';
          action.title = t('list.addContact') || t('contact.add');
          action.onclick = () => { const b = $('btn-join-qr'); if (b) b.click(); };
          return;
        }
        if (kind === 'internal' || kind === 'extgroup' || kind === 'externalGroup') {
          if (qr) qr.classList.add('hidden');
          action.classList.remove('hidden');
          action.textContent = '+';
          action.title = t('list.addMore');
          action.onclick = (e) => {
            e.stopPropagation();
            const caiDan = $('list-add-menu');
            if (caiDan) { caiDan.classList.toggle('hidden'); return; }
            const m = document.createElement('div');
            m.id = 'list-add-menu';
            m.className = 'urg-menu';
            m.style.zIndex = '50';
            m.innerHTML =
              '<button type="button" data-la="create">' + escapeHtml(t('list.addMenuCreate') || t('list.createGroup')) + '</button>' +
              '<button type="button" data-la="join">' + escapeHtml(t('list.addMenuJoin') || t('join.apply')) + '</button>';
            action.parentElement?.appendChild(m);
            m.querySelectorAll('button').forEach((b) => {
              b.onclick = () => {
                m.classList.add('hidden');
                if (b.dataset.la === 'join') { $('btn-join-qr')?.classList.remove('hidden'); $('btn-join-qr')?.click(); }
                else $('list-action-trigger-create')?.click();
                // 兼容：直接触发原 list-action 语义
                if (b.dataset.la === 'create' && typeof window.__listCreate === 'function') window.__listCreate();
                if (b.dataset.la === 'join' && typeof window.__listJoin === 'function') window.__listJoin();
              };
            });
          };
        }
      };


      // 「检查所有硬盘」：整机扫描（有界；结果与边界都如实显示）
      async function runMachineScan(kind) {
        const msgId = kind === 'plugins' ? 'plug-scan-msg' : 'skill-scan-msg';
        const msg = $(msgId);
        if (msg) msg.textContent = t('settings.scanRunning');
        const r = await window.warmy.scanMachine?.(kind).catch(() => null);
        if (!r || !r.ok) {
          if (msg) msg.textContent = String(r?.error || t('common.error'));
          return;
        }
        const found = r.found || [];
        if (kind === 'skills') {
          found.forEach((f) => {
            if (!(state.skills || []).some((s) => s.id === f.id)) {
              state.skills = state.skills || [];
              state.skills.push({ id: f.id, name: f.name, path: f.path, source: 'machine' });
            }
          });
        } else {
          found.forEach((f) => {
            if (!state.plugins.some((p) => p.id === f.id)) {
              state.plugins.push({ id: f.id, name: f.name, desc: f.desc || f.path, enabled: true, source: 'machine' });
            }
          });
          if (typeof window.__renderPluginList === 'function') window.__renderPluginList();
        }
        if (msg) {
          const b = r.bound || {};
          const why = b.stoppedBy ? ' · ' + fmtKey('settings.scanStopped', { why: String(b.stoppedBy) }) : '';
          msg.textContent = fmtKey('settings.scanDone', { n: String(found.length), dirs: String(b.dirsVisited || 0) }) + why;
        }
        try { renderPage(); } catch { /* noop */ }
      }
      $('btn-skill-scan-machine')?.addEventListener('click', () => { void runMachineScan('skills'); });
      $('btn-plug-scan-machine')?.addEventListener('click', () => { void runMachineScan('plugins'); });

      $('sel-locale').onchange = async (e) => {
        await loadI18n(e.target.value);
        window.warmy.settingsSave({ locale: e.target.value });
        setNav('settings');
      };
      document.querySelectorAll('.theme-mode button').forEach((b) => {
        b.onclick = () => {
          applyThemeMode(b.dataset.m);
          window.warmy.settingsSave({ themeMode: b.dataset.m });
          renderPage();
        };
      });
      renderThemeSwatches();
      renderSkillList();
      renderSkillScanDirs().catch(() => {});
      bindSkillScanDirs();
      bindDataMetricsOnly();
      bindNetCard();
      bindHotkeySection();
      // ADR 004 P1：设置 → 功能 → 容器（折叠安装说明 + 探测 + 可操作状态列表）
      bindContainerCard();
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
          const keZhiXing = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
          if (!keZhiXing) {
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
      document.querySelectorAll('[data-email-k]').forEach((yuanSu) => {
        yuanSu.onchange = () => {
          state.emailNotify = state.emailNotify || { complete: false, request: true, error: true };
          state.emailNotify[yuanSu.dataset.emailK] = yuanSu.checked;
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
        await window.warmy.specialModelsSet(cfg).catch(() => {});
        $('sm-msg').textContent = t('instances.saved');
      });
      // 邀请链接 / 二维码（二维码由 index.html 引入的经典脚本编码器生成，见 qrSvg）
      //
      // 链接**只有**一个来源：ownInviteLink() —— node ← meshStatus().nodeId、
      // port ← 组网设置里当前配置的端口（netState.addr.port）、tok ← inviteCreate().invite.token。
      // 这里曾经硬编码了一个**早已退休的旧约定端口**（不是产品默认端口），改成读真实端口；
      // 真端口拿不到就**少一个字段**（如实少说），绝不编一个旧端口出来。
      // 面板元素在当前布局里可能不存在 —— 不存在就连 IPC 都不发（不白造邀请令牌）。
      (async () => {
        if (!$('join-link') && !$('join-qr')) return;
        const own = await ownInviteLink();
        const lk = $('join-link');
        if (lk) lk.textContent = own.link;
        const msg = $('join-msg');
        if (msg && !own.ok) msg.textContent = t('join.linkUnavailable');
        const qr = $('join-qr');
        if (qr) {
          const svg = own.ok ? qrSvg(own.link, 168) : '';
          // 编码器没加载上就如实说明：不画占位矩阵、也不拿截断的链接冒充二维码
          if (svg) qr.innerHTML = svg;
          else qr.textContent = t('join.qrUnavailable');
        }
      })();
      $('btn-join-copy')?.addEventListener('click', async () => {
        const link = String($('join-link')?.textContent || '').trim();
        if (!link) {
          if ($('join-msg')) $('join-msg').textContent = t('join.linkUnavailable');
          return;
        }
        try {
          await navigator.clipboard.writeText(link);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      });
      $('btn-join-accept')?.addEventListener('click', () => {
        const v = String(($('join-input') || {}).value || '').trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('warmy://') ? t('join.ok') : t('join.fail');
      });

      async function refreshBlacklist() {
        const box = $('blacklist-box');
        if (!box) return;
        const r = await window.warmy.blacklistList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((b) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(b.name) + ' · ' + escapeHtml(b.target) + ' · ' + new Date(b.blockedAt).toLocaleString() + '</span><button class="btn-mini" data-unblock="' + escapeHtml(b.id) + '">' + t('join.removeBlacklist') + '</button></div>').join('')
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
        const box = $('archived-box');
        if (!box) return;
        const r = await window.warmy.archivedList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((a) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(a.name) + ' · ' + escapeHtml(String(a.kind || '')) + '</span><button class="btn-mini" data-restore="' + escapeHtml(a.id) + '">' + t('cp.rollback') + '</button></div>').join('')
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
            await window.warmy.smtpRemove(b.dataset.x);
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
            const vr = await window.warmy.smtpVerify({ ...full, id });
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
        const r = await window.warmy.smtpAdd(acc);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([acc]);
          ['smtp-label', 'smtp-host', 'smtp-user', 'smtp-pass'].forEach((id) => {
            const yuanSu = $(id);
            if (yuanSu) yuanSu.value = '';
          });
          $('smtp-msg').textContent = t('instances.saved');
        } else {
          $('smtp-msg').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('prov-list');
      /**
       * 顺序：**新添加的排在最上面**（列表是追加进 state 的，所以这里倒着渲染）。
       * 用户刚加完一个供应商就能在第一个看到它，不用往下翻。
       */
      [...state.providers].reverse().forEach((pr) => {
        const yuanSu = document.createElement('div');
        yuanSu.className = 'prov-card';
        // 名称重复 ⇒ 这张卡片整体不可用：输入框与它下面的模型一起标红并给出原因
        const nameDup = providerLabelDupCount(pr.label, pr.id) > 0;
        /**
         * 「拉取模型」可用性（产品要求）：**名称 / 接口地址 / API Key 任一没填 ⇒ 按钮灰、点不动**。
         * 例外：`protocol === 'ollama'` 这类**本来不需要密钥**的协议 —— 密钥字段对它不适用，
         * 不算"没填写"（否则 Ollama 永远拉不了模型）。缺失项写进按钮 title，说清缺什么。
         */
        const keyRequired = pr.protocol !== 'ollama';
        const quShiDe = [];
        if (!String(pr.label || '').trim()) quShiDe.push(t('settings.fieldName'));
        if (!String(pr.baseURL || '').trim()) quShiDe.push(t('settings.fieldBaseUrl'));
        if (keyRequired && !String(pr.apiKey || '').trim() && !pr.hasKey) quShiDe.push(t('settings.fieldApiKey'));
        const laQuJiuXu = quShiDe.length === 0;
        const laQuBiaoTi = laQuJiuXu ? t('settings.fetchModels') : fmtKey('settings.fetchDisabledHint', { fields: quShiDe.join(' / ') });
        yuanSu.innerHTML =
          '<div class="prov-head" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.label) + '</span>' +
          '<button class="btn-mini" data-prov-del="' + escapeHtml(pr.id) + '" title="' + t('settings.pluginUninstall') + '">' + t('settings.pluginUninstall') + '</button>' +
          '</div>' +
          '<div class="inst-row">' +
          '<div class="field"><label>' + t('settings.providerName') + '</label><input data-k="label" class="' + (nameDup ? 'dup' : '') + '" value="' + escapeHtml(pr.label) + '" title="' + (nameDup ? escapeHtml(t('settings.providerNameDup')) : '') + '"/></div>' +
          '<div class="field"><label>' + t('settings.baseUrl') + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"/></div>' +
          '<div class="field"><label>' + t('settings.apiKey') + '</label><input data-k="apiKey" type="password" value="" placeholder="' + escapeHtml(pr.hasKey ? t('settings.keySaved') : t('settings.keyEmpty')) + '"/></div>' +
          '</div>' +
          '<div class="prov-actions"><button class="btn-mini" data-fetch' + (laQuJiuXu ? '' : ' disabled') + ' title="' + escapeHtml(laQuBiaoTi) + '">' + t('settings.fetchModels') + '</button></div>' +
          '<div class="model-row">' +
          (((pr.models || [])
            .map((m) => {
              const usedBy = modelUsageCache.get(m) || [];
              const inUse = usedBy.length > 0;
              const GuoQi = !!(pr.staleModels && pr.staleModels[m]);
              const dup = nameDup;
              /**
               * 悬停必须说清**为什么红**：重名 > 需重新拉取 > 正在被谁占用（可叠加）。
               */
              const tips = [];
              if (dup) tips.push(t('settings.providerNameDup'));
              if (GuoQi) tips.push(fmtKey('settings.modelStaleTip', {}));
              if (inUse) tips.push(fmtKey('settings.modelInUseTip', { who: usedBy.join(' / ') }));
              if (!tips.length) tips.push(t('settings.modelSetDefault'));
              return '<span class="model-chip' + ((inUse || GuoQi || dup) ? ' in-use' : '') + '" data-m="' + escapeHtml(m) + '" title="' + escapeHtml(tips.join(' · ')) + '">' +
                escapeHtml(m) +
                '<button class="x" data-del="' + escapeHtml(m) + '" title="' + t('settings.removeModel') + '">×</button></span>';
            })
            .join('')) || '<span class="muted">' + t('settings.modelsEmpty') + '</span>') +
          '</div>' +
          '<div class="muted" data-models-note style="font-size:11px">' +
          (nameDup ? escapeHtml(t('settings.providerNameDup')) : '') + '</div>';
        yuanSu.querySelectorAll('input[data-k]').forEach((shuRu) => {
          shuRu.onchange = async () => {
            const key = shuRu.dataset.k;
            const before = pr[key];
            pr[key] = shuRu.value;
            if (before === shuRu.value) return;
            /**
             * 产品规则（本轮修正）：改**名称 / 接口地址 / 密钥**任何一项，
             * 该供应商下的模型**全部不删**，而是先标红（stale）＝"可能无法正常使用，
             * 需要重新拉取模型"。重新拉取之后才做取舍：
             *   · 又被拉到的模型 → 恢复正常
             *   · 没被拉到且**没人在用** → 直接删除
             *   · 没被拉到但**正在被使用** → 保留并保持标红，悬停显示占用位置
             */
            if (key === 'label' || key === 'baseURL' || key === 'apiKey') {
              const models = pr.models || [];
              if (models.length) {
                models.forEach((m) => { pr.staleModels = { ...(pr.staleModels || {}), [m]: true }; });
              }
            }
            if (key === 'apiKey') {
              /**
               * 密钥**只进安全存储**（safeStorage），并且界面读不回明文。
               * 主进程拒绝写明文时（no-safe-storage）如实告诉用户，不假装保存成功。
               */
              const yiLeiXing = shuRu.value;
              const r = await window.warmy.providerKeySet?.({ providerId: pr.id, apiKey: yiLeiXing });
              if (r?.ok) {
                pr.hasKey = true;
                pr.apiKey = '';
                shuRu.value = '';
                shuRu.placeholder = t('settings.keySaved');
              } else {
                const note = yuanSu.querySelector('[data-models-note]');
                if (note) note.textContent = fmtKey('settings.keySaveFailed', { err: String(r?.error || '') });
              }
            }
            // 当前生效的供应商：把改动同步给主进程（密钥由主进程自己按 id 取，不回传明文）
            const cfg = { presetId: pr.id, baseURL: pr.baseURL, model: providerCfgModel(pr), protocol: pr.protocol };
            await window.warmy.setProvider(cfg);
            await saveProviders();
            // 变更后重渲染：标红与提示都反映最新状态
            renderPage();
          };
        });
        yuanSu.querySelector('[data-fetch]').onclick = async () => {
          const btn = yuanSu.querySelector('[data-fetch]');
          btn.textContent = t('common.loading');
          const note0 = yuanSu.querySelector('[data-models-note]');
          // 当前生效的供应商（离开这个卡片时拉取也要用对端点/密钥）——密钥由主进程按 id 解出
          await window.warmy.setProvider({
            presetId: pr.id,
            baseURL: pr.baseURL,
            protocol: pr.protocol,
            model: providerCfgModel(pr),
          });
          const r = await window.warmy.listModels({ protocol: pr.protocol, baseURL: pr.baseURL, providerId: pr.id });
          if (r?.ok && r.models?.length) {
            const fetched = new Set(r.models);
            const prev = pr.models || [];
            // 又被拉到的模型 ⇒ 恢复正常
            const GuoQi = { ...(pr.staleModels || {}) };
            fetched.forEach((m) => { delete GuoQi[m]; });
            // 没被拉到：**没人在用就删除**；正在被使用则保留（继续标红，悬停显示占用位置）
            modelUsageCache = await collectModelUsage();
            const kept = prev.filter((m) => fetched.has(m) || modelUsageCache.has(m));
            kept.forEach((m) => { if (!fetched.has(m)) GuoQi[m] = true; });
            pr.models = [...new Set([...kept, ...r.models])];
            pr.staleModels = GuoQi;
            const droppedN = prev.filter((m) => !kept.includes(m)).length;
            const stillStale = pr.models.filter((m) => GuoQi[m]).length;
            if (note0) {
              note0.textContent = [
                droppedN ? fmtKey('settings.modelsDropped', { n: String(droppedN) }) : '',
                stillStale ? fmtKey('settings.modelsStale', { n: String(stillStale) }) : '',
              ].filter(Boolean).join(' · ');
            }
          } else if (note0) {
            // 拉取失败**照实说**：不清空已有模型，也不假装成功（标红状态保持原样）
            note0.textContent = fmtKey('settings.modelsFetchFailed', { err: String(r?.error || t('common.error')) });
          }
          await saveProviders();
          renderPage();
        };
        yuanSu.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            pr.models = (pr.models || []).filter((m) => m !== btn.dataset.del);
            await saveProviders();
            renderPage();
          };
        });
        yuanSu.querySelector('[data-prov-del]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          state.providers = state.providers.filter((x) => x.id !== pr.id);
          // 供应商删掉 ⇒ 它那把密钥也不再留：安全存储里一并清掉
          try { await window.warmy.providerKeyClear?.({ providerId: pr.id }); } catch { /* noop */ }
          await saveProviders();
          renderPage();
        });
        yuanSu.querySelectorAll('.model-chip').forEach((chip) => {
          chip.onclick = async () => {
            pr.defaultModel = chip.dataset.m;
            await window.warmy.setProvider({
              presetId: pr.id,
              baseURL: pr.baseURL,
              model: pr.defaultModel,
              protocol: pr.protocol,
            });
            await saveProviders();
            renderPage();
          };
        });
        prov.appendChild(yuanSu);
      });
      // ── 供应商预设（常用 10 家 + 其他）──
      const PROVIDER_PRESETS = [
        { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1' },
        { id: 'openai', label: t('settings.provider.openai'), protocol: 'openai-compatible', baseURL: 'https://api.openai.com/v1' },
        { id: 'moonshot', label: t('settings.provider.moonshot'), protocol: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1' },
        { id: 'zhipu', label: t('settings.provider.zhipu'), protocol: 'openai-compatible', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
        { id: 'dashscope', label: t('settings.provider.dashscope'), protocol: 'openai-compatible', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        { id: 'siliconflow', label: t('settings.provider.siliconflow'), protocol: 'openai-compatible', baseURL: 'https://api.siliconflow.cn/v1' },
        { id: 'openrouter', label: t('settings.provider.openrouter'), protocol: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1' },
        { id: 'anthropic', label: t('settings.provider.anthropic'), protocol: 'anthropic', baseURL: 'https://api.anthropic.com' },
        { id: 'gemini', label: t('settings.provider.gemini'), protocol: 'openai-compatible', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
        { id: 'ollama', label: 'Ollama (本地)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434/v1' },
        { id: 'ollama-remote', label: t('settings.provider.ollamaRemote'), protocol: 'ollama', baseURL: 'http://<host>:11434/v1' },
        { id: 'groq', label: t('settings.provider.groq'), protocol: 'openai-compatible', baseURL: 'https://api.groq.com/openai/v1' },
        { id: 'mistral', label: t('settings.provider.mistral'), protocol: 'openai-compatible', baseURL: 'https://api.mistral.ai/v1' },
        { id: 'together', label: t('settings.provider.together'), protocol: 'openai-compatible', baseURL: 'https://api.together.xyz/v1' },
        { id: 'fireworks', label: t('settings.provider.fireworks'), protocol: 'openai-compatible', baseURL: 'https://api.fireworks.ai/inference/v1' },
        { id: 'perplexity', label: t('settings.provider.perplexity'), protocol: 'openai-compatible', baseURL: 'https://api.perplexity.ai' },
        { id: '__other__', label: t('settings.providerOther'), protocol: 'openai-compatible', baseURL: '' },
      ];
      const PROVIDER_MAX = 50;

      /**
       * **模型占用表**：某个模型被谁在用。
       * 用途（产品第 9 条）：改供应商的名称/接口地址/密钥 ⇒ 该供应商下的模型要"丢失"，
       * 但**正在被使用的模型不能消失**，而是标红并在悬停时说明"谁在用"。
       */
      /** 去掉首尾空白后比较，忽略大小写 */
      function normProvLabel(s) {
        return String(s || '').trim().toLowerCase();
      }
      /** 该名字已被几个供应商占用（用于查重提示） */
      function providerLabelDupCount(label, selfId) {
        const n = normProvLabel(label);
        if (!n) return 0;
        return (state.providers || []).filter((p) => p.id !== selfId && normProvLabel(p.label) === n).length;
      }
      /** 预设名重复时自动加 _2 / _3 …（用户仍可自行改名） */
      function uniqueProviderLabel(label) {
        const base = String(label || '').trim();
        if (!base) return '';
        let i = 1;
        let candidate = base;
        const taken = new Set((state.providers || []).map((p) => normProvLabel(p.label)));
        while (taken.has(normProvLabel(candidate))) {
          i += 1;
          candidate = `${base}_${i}`;
        }
        return candidate;
      }

      async function collectModelUsage() {
        const usage = new Map();   // modelId -> [who]
        const add = (id, who) => {
          const k = String(id || '').trim();
          if (!k) return;
          const cur = usage.get(k) || [];
          if (!cur.includes(who)) cur.push(who);
          usage.set(k, cur);
        };
        (state.instances || []).forEach((inst) => {
          const mingCheng = inst.name || inst.id;
          add(inst.model, t('instances.model') + ' · ' + mingCheng);
          add(inst.defaultModel, t('instances.defaultModel') + ' · ' + mingCheng);
          const mc = inst.modelConfig || {};
          add(mc.model, t('instances.model') + ' · ' + mingCheng);
          (mc.chain || inst.fallbackChain || []).forEach((m) => add(typeof m === 'string' ? m : m && m.model, t('instances.fallbackChain') + ' · ' + mingCheng));
        });
        try {
          const sp = await window.warmy.specialModelsGet?.();
          const sm = (sp && sp.specialModels) || {};
          Object.keys(sm).forEach((k) => {
            const v = sm[k] || {};
            add(v.model, (t('settings.specialModels') || 'special') + ' · ' + k);
            add(v.provider, null);
          });
        } catch { /* noop */ }
        return usage;
      }

      // 占用表在 renderPage() 顶部已声明（避免 TDZ）；这里先按内存里的实例算一遍
      void collectModelUsage().then((u) => { modelUsageCache = u; });

      function provCount() {
        const yuanSu = $('prov-count');
        if (yuanSu) yuanSu.textContent = `${state.providers.length}/${PROVIDER_MAX}`;
      }

      (function bindPresetSelect() {
        const sel = $('prov-preset');
        if (!sel) return;
        /**
         * 下拉的构成（产品要求）：
         *  · **默认项**是占位提示「选择要添加的供应商」（空值、不可提交）——
         *    添加成功后回到这一项，避免"上一次选的那家"被误当成当前选择；
         *  · **DeepSeek 固定第一**（最常用），其余按名称排序。
         */
        const rest = PROVIDER_PRESETS
          .filter((p) => p.id !== 'deepseek' && p.id !== '__other__')
          .slice()
          .sort((a, b) => String(a.label).localeCompare(String(b.label), state.locale || 'zh-CN'));
        const other = PROVIDER_PRESETS.filter((p) => p.id === '__other__');
        const first = PROVIDER_PRESETS.filter((p) => p.id === 'deepseek');
        sel.innerHTML =
          '<option value="" selected>' + escapeHtml(t('settings.providerPickHint')) + '</option>' +
          [...first, ...rest, ...other].map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>').join('');
      })();

      provCount();
      $('btn-add-prov').onclick = async () => {
        if (state.providers.length >= PROVIDER_MAX) {
          uiAlert(fmtKey('settings.providerMax', { n: String(PROVIDER_MAX) }));
          return;
        }
        const sel = $('prov-preset');
        const picked = sel ? PROVIDER_PRESETS.find((p) => p.id === sel.value) : null;
        // 占位项（"选择要添加的供应商"）不是选择：先让用户选一家，别默默给他加个不明的
        if (!picked) { uiAlert(t('settings.providerPickFirst')); return; }
        const preset = picked;
        const isOther = preset.id === '__other__';
        const baseLabel = isOther ? '' : preset.label;
        /**
         * 名称唯一：预设名重复时自动加序号后缀（用户可以再改）。
         * 产品要求：例如已经有一个 DeepSeek，再添加一个就叫 DeepSeek_2。
         */
        state.providers.push({
          id: (isOther ? 'custom-' : preset.id + '-') + Date.now(),
          label: uniqueProviderLabel(baseLabel),
          protocol: preset.protocol,
          baseURL: isOther ? '' : preset.baseURL,
          defaultModel: '',
          apiKey: '',
          hasKey: false,
          models: [],
          staleModels: {},
        });
        await saveProviders();
        // 添加成功后把下拉复位到占位项（产品要求：下次进来默认还是"选择要添加的供应商"）
        if (sel) sel.value = '';
        renderPage();
      };
    }
  }
  /* ══════════════════════════════════════════════════════════════════════
   * 组网状态与身份变更横幅（ADR 003 R8–R12 / 附六）
   * ----------------------------------------------------------------------
   * 改这块之前先读这五条：
   *
   *  1) 这里**只做 UI 与判定**，不实现网络：一律走 window.warmy 的组网/身份 IPC。
   *     该 IPC 还没落地（身份层并行开发中）时用**可注入的桩**顶替：
   *       window.__warmyNetStub / window.__warmyIdentityStub
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

  /**
   * Default mesh TCP port. 产品负责人**最终**决定：生产默认 59599。
   *
   * ⚠️ 渲染层不能用 import，只能**镜像**主进程那份常量：
   *    packages/app-shell/src/settings-store.ts 的 `WARMY_DEFAULT_NET_PORT`
   * 两处必须逐字一致（验证脚本会真的比对，不一致就红）。
   * LAN discovery UDP stays on 7799 (unchanged, elsewhere).
   *
   * 端口**不是**从用户视角硬编码的：下面这个值只是输入框的默认值，
   * 用户随时可以改成 1–65535 的任意值（parsePort 校验），不做任何"角色端口"限制。
   */
  const WARMY_DEFAULT_NET_PORT = 59599;

  /**
   * 开发/调试 与 测试 的**约定**端口（仅作提示；同样镜像 settings-store 的同名常量）。
   * 刻意**不**校验、不锁定：约定不是限制。
   */
  const WARMY_DEV_NET_PORT = 58588;
  const WARMY_TEST_NET_PORT = 62666;

  // 注意：候选端口表**刻意不在渲染层镜像** —— 它由主进程的 `WARMY_SUGGESTED_NET_PORTS`
  // 当"优先池"，再经 `warmy:net-port-candidates`（逐个**真 bind 实测**）后才可能出现在界面上。
  // 渲染层不自己拿静态表充建议：静态表"干净"不代表本机现在绑得上。

  const NET_DEFAULTS = {
    port: WARMY_DEFAULT_NET_PORT,
    devPort: WARMY_DEV_NET_PORT,
    testPort: WARMY_TEST_NET_PORT,
    hysteresisFailures: 3, // 连续失败次数
    hysteresisSeconds: 30, // 且持续这么久
    retryRounds: 3, // 先重试几轮
    backoffMs: [5000, 15000, 30000],
    tickMs: 1000,
    // 可达性数据（档位/中继）的保鲜期：超过就不再据此下结论，避免"数据早过期了还在说"
    reachTtlMs: 30000,
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
      reachTtlMs: n(o.reachTtlMs, NET_DEFAULTS.reachTtlMs),
    };
  }

  /** 组网层 IPC：桩优先，其次真实 IPC，都没有则 null（= 未就绪） */
  function netIpc(name, ...args) {
    const zhuang = window.__warmyNetStub;
    if (zhuang && typeof zhuang[name] === 'function') {
      try { return Promise.resolve(zhuang[name](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.warmy && window.warmy[name];
    if (typeof api === 'function') {
      try { return Promise.resolve(api(...args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.resolve(null);
  }

  /** 身份层 IPC：同上（window.warmy.identity*） */
  function idIpc(name, ...args) {
    const zhuang = window.__warmyIdentityStub;
    if (zhuang && typeof zhuang[name] === 'function') {
      try { return Promise.resolve(zhuang[name](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.warmy && window.warmy[name];
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
    /**
     * 公网地址列表：IP 与域名共用同一条列表（混合列表）。
     * 默认**不**用本机地址预填；用户可手动添加，或点「刷新」把检测到的公网地址写进来。
     */
    addr: { port: NET_DEFAULTS.port, publicAddresses: [] },
    /** 最近一次检测结果 { verdict:'pass'|'fail'|'unknown', code, entries:[], at } */
    probe: null,
    /** 逐条检测结果（每个 IP / 域名一行，诚实展示通过/失败） */
    entryResults: [],
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
    /**
     * 终态（两端都拨不进来且无中继）的**发生次数**与"上一次那次"的结论码。
     * 终态是一次**事件**，不是常驻状态：上一次关掉了，不代表这一次也不用提醒。
     * 产品要求：公网地址再次不可达 → 横幅必须重新出现（即使上一次被手动关过）。
     */
    gapEpisode: 0,
    gapLastCode: '',
    /** 本地地址信息（自动填入用） */
    local: null,
    /** 异地成员总数（横幅用）与按群缓存的成员状态 */
    remoteCount: 0,
    presence: {},
    /** 组网层是否就绪（有 netStatus/netProbe 之类的 IPC 才算） */
    ready: null,
    /**
     * 附八.9 / 附八.3：组网层给的**可达性**（ReachabilityHint，结构化）。
     * 档位名、中继结论、是否需要"有公网地址的机器做中继"都由它给；
     * UI 只做 key → 文案的映射，**不在这里推断协议层没给的结论**。
     */
    reachability: null,
    /** `reachability` 的采样时刻（过期就不再用它下结论） */
    reachedAt: 0,
    /** 本机 IPv6 事实（netStatus.ipv6 / netProbe.details.localIpv6 / netLocalAddress.ipv6） */
    ipv6: null,
    /** 最近一次 netStatus 里的对端探测行（用 `session` 判断是否已有活连接） */
    linkPeers: [],
    /** 活会话数（netStatus.sessions） */
    sessions: 0,
    /**
     * R13：端口绑定事实（netStatus.bind / meshEnable.bind）。
     * { requestedPort, boundPort, errorCode? } —— 组网层给的**事实**，UI 只显示不推断。
     */
    bind: null,
    /**
     * R13：**端口无法绑定**的现场（{ port, errorCode, error }）。
     * 由"打开组网"失败时记下；界面据此明确告知原因并给出可点选的建议端口。
     * 成功打开 / 关闭组网时清掉。**只用于告知与建议，绝不触发自动改端口**。
     */
    bindFail: null,
    /**
     * R13：**实测**得到的候选端口报告（netPortCandidates IPC）。
     * { requestedPort, recommended:[{port,status,...}], probed:[...],
     *   skipped:[{port,reason:'os-reserved-range',range:[s,e]}],
     *   osReserved:{supported,source,ranges,error?}, coverage, timedOut, elapsedMs }
     * 只推荐 status==='ok'（真的试绑成功过）的端口；**绝不**用静态列表直接充数。
     * skipped = 落在本机 OS 保留段里、**根本没被探测**的端口（如实回报，不是"探测失败"；
     * osReserved 说明这次保留段是从哪儿读的、读没读到）。
     */
    portCandidates: null,
    /** 正在实测中（UI 显示"正在实测…"，不卡界面） */
    portCandidatesLoading: false,
    /** 端口提示区的渲染签名（防 1s 心跳刷 DOM） */
    portHintSig: '',
    /** 端口冲突区块的渲染签名 */
    portConflictSig: '',
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

  /* ── 附八.9 / 附八.3：连接阶梯档位与中继状态（UI 只做映射，不猜结论） ──
   *
   *  数据来源**全部是结构化的**：
   *    · `netStatus.reachability`（ReachabilityHint）——`suggestedRung` / `i18n.rung` /
   *      `relay`（RelayDecision）/ `needsPublicRelayNotice` / `dialableKind`；
   *    · `netStatus.ipv6`、`netProbe.details.localIpv6`、`netLocalAddress.ipv6` —— 本机 IPv6 事实。
   *  拿不到（或数据已过期）就显示"无法判定/未知"，**绝不**写成好像在跑。
   */

  /** 档位顺序（与 packages/sync-protocol/src/ladder.ts DEFAULT_LADDER_ORDER 一致；附八.9 定的顺序） */
  const NET_RUNGS = ['ipv6-direct', 'public-direct', 'upnp', 'holepunch', 'relay', 'lan'];

  /** 档位 → i18n key（键名与协议层 `LADDER_RUNG_I18N` 一一对应） */
  const NET_RUNG_I18N = {
    'ipv6-direct': 'net.rung.ipv6Direct',
    'public-direct': 'net.rung.publicDirect',
    upnp: 'net.rung.upnp',
    holepunch: 'net.rung.holepunch',
    relay: 'net.rung.relay',
    lan: 'net.rung.lan',
  };

  /**
   * 协议层**当前未实现**的档位（`packages/sync-protocol/src/ladder.ts` 里挂的是 unsupportedStrategy）：
   *   · upnp      —— 未实现：UPnP/SSDP 与 NAT-PMP/PCP 需要额外依赖或原生模块
   *   · holepunch —— 未实现：真实 STUN 服务器与同时打洞需要公网对端
   * 这两档**绝不能**显示成"正在跑"：只能如实标「尚未实现（不可用）」（附八.3 的诚实性要求）。
   * 即便将来主进程把它们报成当前档，这里也会拒绝把它显示为 current（见 netLadderModel）。
   */
  const NET_RUNG_UNSUPPORTED = { upnp: true, holepunch: true };

  /** 中继结论码 → i18n key（与协议层 `relay.ts` 的 `RELAY_STATUS_I18N` 对齐） */
  const NET_RELAY_I18N = {
    'relay-selected': 'net.relay.selected',
    'relay-none-configured': 'net.relay.missing.noneConfigured',
    'relay-unreachable': 'net.relay.missing.unreachable',
    'relay-not-needed-peer-dialable': 'net.relay.notNeeded.peerDialable',
    'relay-not-needed-inbound-expected': 'net.relay.notNeeded.inboundExpected',
    'dialability-unknown': 'net.relay.unknown',
  };

  /** 可拨入性结论类型 → i18n key（与协议层 `dialability.ts` 的 `DIALABILITY_I18N` 对齐） */
  const NET_DIALABILITY_I18N = {
    'peer-verified': 'net.dialability.peerVerified',
    'ipv6-global-natural': 'net.dialability.ipv6Natural',
    undetermined: 'net.dialability.undetermined',
    undialable: 'net.dialability.undialable',
  };

  /** i18n key → 档位（主进程给的是 key 时反查；未知 key 返回 null，不瞎猜） */
  function netRungFromKey(key) {
    const k = String(key || '');
    const hit = NET_RUNGS.filter((r) => NET_RUNG_I18N[r] === k)[0];
    return hit || null;
  }

  /** i18n key → 可拨入性类型（同上） */
  function netDialKindFromKey(key) {
    const k = String(key || '');
    const hit = Object.keys(NET_DIALABILITY_I18N).filter((x) => NET_DIALABILITY_I18N[x] === k)[0];
    return hit || null;
  }

  /** 本机 IPv6 事实（三个来源形状不同，统一成 {hasGlobalUnicast, publicCandidate}；形状不符返回 null） */
  function netIpv6Facts(v) {
    if (!v || typeof v !== 'object' || typeof v.hasGlobalUnicast !== 'boolean') return null;
    return { hasGlobalUnicast: v.hasGlobalUnicast === true, publicCandidate: v.publicCandidate || null };
  }

  /** 组网层给的可达性；过期 / 缺失一律返回 null（不拿旧数据下结论） */
  function netReach() {
    const r = netState.reachability;
    if (!r || typeof r !== 'object') return null;
    const at = Number(netState.reachedAt || 0);
    if (!at || Date.now() - at > netTuning().reachTtlMs) return null;
    return r;
  }

  /**
   * 阶梯模型（**纯函数**：只读 netState，不碰 DOM）。
   *   current   —— 能**确定**在用的档位（null = 还不能确定；注意未实现的档永远不会成为 current）
   *   claimed   —— 主进程/协议层报上来的档位（可能落在未实现的档上，此时只用于如实标注）
   *   suggested —— 建议首档（地址事实推出，尚未被选中）
   *   relayKey / relayCode —— 中继状态
   *   dialKind / dialDerived —— 本机可拨入性（是否由地址事实推出）
   */
  function netLadderModel() {
    const r = netReach();
    const dec = r && r.relay && typeof r.relay === 'object' ? r.relay : null;
    const ipv6 = (r && r.ipv6) || netState.ipv6 || null;
    const hasV6 = !!(ipv6 && ipv6.hasGlobalUnicast === true);
    const relayCode = String((r && r.relayCode) || (dec && dec.code) || 'not-attempted');
    const relaySelected = relayCode === 'relay-selected' || !!(dec && dec.selected === true);
    const peers = Array.isArray(netState.linkPeers) ? netState.linkPeers : [];
    const livePeers = peers.filter((p) => p && p.session === true);
    const sessions = Number(netState.sessions || 0) || livePeers.length;

    // ① 档位：主进程给什么就用什么（结构化优先：rung id → i18n key → 中继选中）
    let claimed = null;
    if (r && typeof r.rung === 'string' && NET_RUNG_I18N[r.rung]) claimed = r.rung;
    else {
      const byKey = r && r.i18n ? netRungFromKey(r.i18n.rung) : null;
      if (byKey) claimed = byKey;
      else if (relaySelected) claimed = 'relay';
    }

    // ② 建议首档（还没确定在走哪一档时，显示"将会先试哪一档"）
    const suggested = r && typeof r.suggestedRung === 'string' && NET_RUNG_I18N[r.suggestedRung]
      ? r.suggestedRung
      : hasV6 ? 'ipv6-direct' : r ? 'public-direct' : null;

    // ③ 未实现的档不得显示成"当前档位"（这是本次接线要防住的"写得像在跑"）
    const current = claimed && !NET_RUNG_UNSUPPORTED[claimed] ? claimed : null;

    // ④ 中继状态：优先用协议层自己选的 key（白名单校验过才用），否则按结论码映射
    const wanted = r && r.i18n && typeof r.i18n.relay === 'string' ? r.i18n.relay : '';
    const knownRelayKeys = Object.keys(NET_RELAY_I18N).map((k) => NET_RELAY_I18N[k]);
    let relayKey;
    if (wanted && knownRelayKeys.indexOf(wanted) >= 0) relayKey = wanted;
    else if (NET_RELAY_I18N[relayCode]) relayKey = NET_RELAY_I18N[relayCode];
    else if (r && r.needsPublicRelayNotice === true) relayKey = 'net.relay.missing.needsPublicRelay';
    else relayKey = 'net.relay.unknown';

    // ⑤ 本机可拨入性：优先协议层的结构化类型；不然由"已验证标志 + 地址事实"推出（并标 data-derived）
    let dialKind = null;
    if (r && typeof r.dialableKind === 'string' && NET_DIALABILITY_I18N[r.dialableKind]) dialKind = r.dialableKind;
    else if (r && typeof r.dialableI18n === 'string') dialKind = netDialKindFromKey(r.dialableI18n);
    let dialDerived = false;
    if (!dialKind) {
      dialDerived = true;
      const self = r && typeof r.selfDialable === 'boolean' ? r.selfDialable : null;
      const natural = (r && r.naturalDialable === true) || hasV6;
      // 优先级与协议层 dialability.ts 一致：已验证 > 地址事实（IPv6 无 NAT）> 判定不可拨入 > 无法判定
      dialKind = self === true ? 'peer-verified' : natural ? 'ipv6-global-natural' : self === false ? 'undialable' : 'undetermined';
    }

    return {
      rungs: NET_RUNGS.slice(),
      current,
      claimed,
      suggested,
      connected: sessions > 0,
      sessions,
      relayCode,
      relaySelected,
      relayKey,
      relayAttempts: dec && Array.isArray(dec.attempts) ? dec.attempts.length : 0,
      dialKind,
      dialDerived,
      hasV6,
      ipv6Candidate: ipv6 && ipv6.publicCandidate ? ipv6.publicCandidate : null,
    };
  }

  /**
   * 「双不可拨入且无中继」——附八.3 第 2 条的**终态**（不是"重试中"）。
   *
   * 只在**结构化数据**同时给出 bothUndialable 与 needsPublicRelayNotice 时才成立；
   * 拿不到就返回 null —— 不猜、也不会把普通重试说成死锁（反过来也不会把死锁说成在转圈）。
   */
  function netRelayGap() {
    const r = netReach();
    if (!r) return null;
    const dec = r.relay && typeof r.relay === 'object' ? r.relay : null;
    const bothUndialable = r.bothUndialable === true || !!(dec && dec.bothUndialable === true);
    const notice = r.needsPublicRelayNotice === true || !!(dec && dec.needsPublicRelayNotice === true);
    if (!(bothUndialable && notice)) return null;
    const code = String((dec && dec.code) || r.relayCode || '');
    const key =
      code === 'relay-unreachable'
        ? 'net.relay.missing.unreachable'
        : code === 'relay-none-configured'
          ? 'net.relay.missing.noneConfigured'
          : 'net.relay.missing.needsPublicRelay';
    return {
      code,
      key,
      bothUndialable: true,
      attempts: dec && Array.isArray(dec.attempts) ? dec.attempts.length : 0,
    };
  }

  /** 本地实例（成员可能是邀请来的人，没有实例） */
  function localInstanceOf(member) {
    const id = String(member.instanceId || member.id || member.name || '');
    const mingCheng = String(member.name || '');
    return (state.instances || []).find((i) => i.id === id || i.name === mingCheng) || null;
  }

  /** 成员三态 + 停用（R11/R12）：disabled 优先，其次组网关闭，再次异地离线 */
  function memberVisual(groupId, member) {
    const bao = netState.presence[groupId] || {};
    const p = bao[String(member.id || member.name)] || bao[String(member.name)] || null;
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
    // 在线判据的来历（结构化，供 DOM 属性与提示用）：
    // local-instance=本机实例真实状态；mesh-session=活连接按指纹判定；
    // unattributed=本机没有该成员的指纹，**无法归属**（此时不声称在线）
    const basis = (p && p.basis) || (remote ? '' : 'local-instance');
    return { kind, remote, disabled, online, basis, fingerprint: (p && p.fp) || '' };
  }

  /** 实例是否异地：显式标记、或组网层在成员表里标过 */
  function instanceIsRemote(inst) {
    if (!inst) return false;
    if (inst.remote === true) return true;
    const zhuang = window.__warmyNetStub;
    if (zhuang && Array.isArray(zhuang.remoteInstanceIds) && zhuang.remoteInstanceIds.includes(inst.id)) return true;
    for (const gid of Object.keys(netState.presence)) {
      const bao = netState.presence[gid] || {};
      for (const k of Object.keys(bao)) {
        const rec = bao[k];
        if (rec && rec.remote && (k === inst.id || k === inst.name)) return true;
      }
    }
    return false;
  }

  /** 地址格式校验（IP 或域名） */
  function shiFouHeFaZhuJi(v) {
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
      const s = await window.warmy.settingsGet();
      const saved = s && s.settings && s.settings.net;
      if (saved && typeof saved === 'object') {
        const p = parsePort(saved.port);
        if (p) netState.addr.port = p;
        // 新契约：publicAddresses 混合列表。旧契约 ip+domains 迁移进同一列表（仅在用户曾保存时）。
        if (Array.isArray(saved.publicAddresses)) {
          netState.addr.publicAddresses = saved.publicAddresses.map(String).map((x) => x.trim()).filter(Boolean);
        } else {
          const migrated = [];
          if (saved.ip && String(saved.ip).trim()) migrated.push(String(saved.ip).trim());
          if (Array.isArray(saved.domains)) {
            for (const d of saved.domains) {
              const v = String(d || '').trim();
              if (v && migrated.indexOf(v) < 0) migrated.push(v);
            }
          }
          netState.addr.publicAddresses = migrated;
        }
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
      // R13：启动时组网已在跑 → 立刻显示"实际绑在哪个端口"（含兜底换端口的事实）
      if (st && st.bind && typeof st.bind === 'object') netState.bind = st.bind;
    } catch {
      /* noop */
    }
    if (netState.ready === null) {
      // 退一步：既有 meshStatus（老 IPC）至少能给出「监听中」这一个事实
      try {
        const ms = await window.warmy.meshStatus();
        if (ms && ms.ok !== false && typeof ms.listening === 'boolean') netState.enabled = ms.listening;
      } catch {
        /* noop */
      }
    }
  }

  /** 本机地址事实（local / public）；由「刷新」触发重采 */
  async function netFetchLocal() {
    try {
      const r = await netIpc('netLocalAddress');
      if (r && r.ok !== false && (r.localIp || r.ip)) {
        netState.local = { ip: String(r.localIp || r.ip), publicIp: String(r.publicIp || ''), behindNat: !!r.behindNat, port: parsePort(r.port) || null };
      }
      // 附八.9：本机 IPv6 事实（有全局单播 = 天然可拨入候选，阶梯第一档就是 IPv6 直连）
      const v6 = r ? netIpv6Facts(r.ipv6) : null;
      if (v6) netState.ipv6 = v6;
    } catch {
      /* noop */
    }
    return netState.local;
  }

  /**
   * 刷新：重新检测本机地址与公网地址，并把检测到的**公网地址**自动写入下方地址列表。
   * 不会把本机（私网）地址写进列表；列表默认也不用本机地址预填。
   */
  async function netRefreshAddresses() {
    netState.local = null;
    const loc = await netFetchLocal();
    const publicIp = loc && loc.publicIp ? String(loc.publicIp).trim() : '';
    if (publicIp) {
      const list = netState.addr.publicAddresses || (netState.addr.publicAddresses = []);
      if (list.indexOf(publicIp) < 0) list.push(publicIp);
    }
    netPersist();
    netState.probe = null;
    netState.entryResults = [];
    renderNetCard();
    return { local: loc, publicIp, list: (netState.addr.publicAddresses || []).slice() };
  }

  function netPersist() {
    const list = (netState.addr.publicAddresses || []).slice();
    window.warmy
      .settingsSave({
        net: {
          port: netState.addr.port,
          publicAddresses: list,
          // legacy mirrors for any older readers of the settings blob
          ip: list[0] || '',
          domains: list.slice(),
        },
      })
      .catch(() => {});
  }

  /** 把一次 netProbe 结果解析成单条 entry 的诚实结论 */
  function netParseProbeResult(r, entry) {
    if (!r || typeof r !== 'object') return { entry, verdict: 'unknown', code: 'no-ipc' };
    if (r.ok === false && !('isPublic' in r) && !('outboundOk' in r)) {
      return { entry, verdict: 'unknown', code: r.errorCode || 'probe-error' };
    }
    const isPublic = r.isPublic === true;
    const outboundOk = r.outboundOk === true;
    const lanOnly = r.lanOnly === true;
    let verdict = 'fail';
    let code = 'not-public';
    if (outboundOk && isPublic) { verdict = 'pass'; code = 'public'; }
    else if (outboundOk && lanOnly) { verdict = 'pass'; code = 'lan'; }
    else if (!outboundOk) { code = 'no-outbound'; }
    return {
      entry,
      verdict,
      code,
      isPublic,
      outboundOk,
      lanOnly,
      inboundVerified: r.inboundVerified === true,
      method: r.method || '',
      behindNat: !!r.behindNat,
    };
  }

  /**
   * 检测：对公网地址列表里的**每一条**（每个 IP 与每个域名）都发探测，
   * 并逐条展示通过/失败。列表为空或端口非法时如实拒绝。
   * 总开关门控：至少一条通过才算 pass（逐条结果仍全部展示）。
   */
  async function netDetect() {
    const entries = (netState.addr.publicAddresses || []).map((s) => String(s || '').trim()).filter(Boolean);
    const port = parsePort(netState.addr.port);
    if (!entries.length) return { ok: false, code: 'empty-list', entries: [] };
    if (!port) return { ok: false, code: 'invalid-port', entries: [] };
    netState.probing = true;
    netState.entryResults = [];
    renderNetCard();
    const results = [];
    let lastR = null;
    for (const entry of entries) {
      if (!shiFouHeFaZhuJi(entry)) {
        results.push({ entry, verdict: 'fail', code: 'invalid-entry' });
        continue;
      }
      let r = null;
      try {
        r = await netIpc('netProbe', { ip: entry, port, domains: [], publicAddresses: [entry] });
      } catch (e) {
        r = { ok: false, errorCode: 'error', error: String(e && e.message) };
      }
      lastR = r;
      results.push(netParseProbeResult(r, entry));
    }
    const v6 = netIpv6Facts(lastR && lastR.details ? lastR.details.localIpv6 : null);
    if (v6) netState.ipv6 = v6;
    const passCount = results.filter((x) => x.verdict === 'pass').length;
    const anyPass = passCount > 0;
    const anyPublic = results.some((x) => x.code === 'public');
    const allUnknown = results.length > 0 && results.every((x) => x.verdict === 'unknown');
    let verdict = 'fail';
    let code = results.length ? results[0].code : 'fail';
    if (anyPass) {
      verdict = 'pass';
      code = anyPublic ? 'public' : 'lan';
    } else if (allUnknown) {
      verdict = 'unknown';
      code = results[0].code || 'probe-error';
    } else if (results.some((x) => x.code === 'no-outbound')) {
      code = 'no-outbound';
    } else {
      code = 'not-public';
    }
    const probe = {
      verdict,
      code,
      at: Date.now(),
      entries: results.slice(),
      passCount,
      total: results.length,
      method: (results.find((x) => x.method) || {}).method || '',
      behindNat: !!((netState.local && netState.local.behindNat) || (results.find((x) => x.behindNat) || {}).behindNat),
    };
    netState.probing = false;
    netState.probe = probe;
    netState.entryResults = results.slice();
    renderNetCard();
    renderNetBanner();
    return probe;
  }

  /**
   * R13：这次失败是不是"**端口无法绑定**"。
   *
   * 认两个码：新的 `port-bind-failed`（主进程统一给这个，底层 errno 在 `error` 里）
   * 与旧的 `port-in-use`（EADDRINUSE）。除此之外的失败（身份未解锁等）走原有提示。
   */
  function netIsBindFailure(r) {
    const code = r && r.errorCode ? String(r.errorCode) : '';
    if (code === 'port-bind-failed' || code === 'port-in-use') return true;
    // 兜底：老实现只给了 bind.errorCode（底层 errno）
    const bindCode = r && r.bind && r.bind.errorCode ? String(r.bind.errorCode) : '';
    return !!bindCode;
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
        ? await netIpc('meshEnable', {
            port: netState.addr.port,
            publicAddresses: (netState.addr.publicAddresses || []).slice(),
            ip: (netState.addr.publicAddresses || [])[0] || '',
            domains: (netState.addr.publicAddresses || []).slice(),
          }) || (await window.warmy.meshStart(netState.addr.port))
        : await netIpc('meshDisable') || (await window.warmy.meshStop());
    } catch (e) {
      r = { ok: false, error: String(e && e.message) };
    }
    if (r && r.ok === false) {
      // R13：端口绑不上要**说清楚**（哪个端口 + 底层错误码），并给出可点选的建议端口。
      // 复用既有的"打开组网失败"提示通道（uiAlert）+ 组网卡片里的一块现场说明；
      // **不**换端口、**不**改 netState.addr.port、**不**写回设置 —— 用户自己选。
      if (on && netIsBindFailure(r)) {
        const failPort = parsePort(r.requestedPort != null ? r.requestedPort : netState.addr.port) || netState.addr.port;
        const errno = String(r.error || (r.bind && r.bind.errorCode) || '');
        netState.bindFail = { port: failPort, errorCode: String(r.errorCode || ''), error: errno };
        netState.portConflictSig = '';
        renderNetCard();
        // 立刻去**实测**一批可用端口（只探测、不绑定；失败也不影响下面的告知）
        void netFetchPortCandidates();
        await uiAlert(
          fmtKey('net.portBindFailedBody', { port: String(failPort), error: errno }),
          t('net.portBindFailedTitle')
        );
        return false;
      }
      await uiAlert(fmtKey(on ? 'net.enableFailed' : 'net.disableFailed', { err: String(r.error || '') }));
      return false;
    }
    const wasOn = netState.enabled;
    netState.enabled = !!on;
    netState.ready = true;
    // R13：打开成功 → 清掉旧的"端口无法绑定"现场；并记下**实际**绑定的端口
    if (on) {
      netState.bindFail = null;
      netState.portCandidates = null;
      netState.bind = r && r.bind && typeof r.bind === 'object' ? r.bind : netState.bind;
    } else {
      netState.bindFail = null;
    }
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
    // B5：组网关闭也要采本机事实（ipv6/reachability），否则阶梯/可达性空白
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
    // 心跳迟滞只在组网开着时吃样；关闭时仍保留 reachability/ipv6 事实
    netState.linkSample = netState.enabled ? reachable : null;
    const v6 = netIpv6Facts(st.ipv6);
    if (v6) netState.ipv6 = v6;
    netState.linkPeers = st.link && Array.isArray(st.link.peers) ? st.link.peers : [];
    netState.sessions = Number(st.sessions || 0) || 0;
    // R13：实际绑上的端口 / 是否走了兜底链。缺字段就清空（组网关着时不该还挂着旧结论）
    netState.bind = st.bind && typeof st.bind === 'object' ? st.bind : null;
    // 附八.9 / 附八.3：可达性结论只在组网开着时吃进并刷新时间戳。
    // 组网关闭时无法做现场探测：含 bothUndialable/needsPublicRelayNotice 的**结论**不作数、
    // 也不刷新 reachedAt —— 旧结论按 reachTtlMs 过期后 netReach() 返回 null，界面退回「未知」。
    // 本机地址事实（ipv6）不受开关影响，上面已单独采。
    const rawReach = st.reachability && typeof st.reachability === 'object' ? st.reachability : null;
    const reachHasConclusion = !!(
      rawReach &&
      (rawReach.bothUndialable === true ||
        rawReach.needsPublicRelayNotice === true ||
        (rawReach.relay &&
          (rawReach.relay.bothUndialable === true || rawReach.relay.needsPublicRelayNotice === true)))
    );
    if (netState.enabled) {
      netState.reachability = rawReach;
      if (netState.reachability) netState.reachedAt = Date.now();
    } else if (rawReach && !reachHasConclusion) {
      // 关闭组网仍可显示地址事实形状的提示（与 net-wiring 关闭分支一致）
      netState.reachability = rawReach;
      netState.reachedAt = Date.now();
    }
    // 含结论的数据在组网关闭时：不写入、不刷新时间戳 → 让旧结论按 TTL 自然过期
    // 档位区块只在签名变化时重建（1s 心跳不能把界面刷掉）
    renderNetLadder();
    renderNetPortHint();
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
      const bao = {};
      r.members.forEach((m) => {
        const key = String(m.id || m.name || '');
        if (!key) return;
        bao[key] = {
          remote: !!m.remote,
          online: m.online !== false,
          disabled: !!m.disabled,
          // 在线判据（主进程给的结构化字段）：'local-instance' | 'mesh-session' | 'unattributed'。
          // 'unattributed' = 成员表里没有指纹，本机无法把人映射到指纹上 → 只用于展示"无法判定"，
          // **不再据此声称在线**（R11 的精确判定依赖它）。
          basis: String(m.presenceBasis || ''),
          fp: String(m.fingerprint || ''),
        };
        if (m.name) bao[String(m.name)] = bao[key]; // 成员表里 id 与显示名都可能被用来查
      });
      netState.presence[gid] = bao;
    }
    // 去重：同一个异地成员可能同时以 id 与 name 存在 bag 里，只算一次
    const remoteKeys = new Set();
    Object.keys(netState.presence).forEach((gid) => {
      const bao = netState.presence[gid] || {};
      Object.keys(bao).forEach((k) => {
        if (!bao[k] || !bao[k].remote) return;
        const inst = (state.instances || []).find((i) => i.id === k || i.name === k);
        remoteKeys.add(inst ? inst.id : k);
      });
    });
    netState.remoteCount = remoteKeys.size;
    return netState.remoteCount;
  }

  /* ── 顶部横幅：断链 / 组网关闭（合并成一条）+ 身份变更（附六） ── */

  /**
   * 是否需要组网？（产品规则）
   *
   * 没有联系人、项目/群聊里也没有**其他设备的异地成员**时，本机根本不需要组网，
   * 因此**任何**组网提醒都不该出现（包括"组网已关闭""地址不可达"这类）。
   * 只有在存在异地对象时才提示。
   */
  function netNeedsMesh() {
    try {
      if (netRemoteCount() > 0) return true;
      if ((state.chats || []).some((c) => c && (c.kind === 'extdm' || c.kind === 'extchat'))) return true;
      if (Array.isArray(netState.peers) && netState.peers.length > 0) return true;
    } catch { /* 任何异常都按"不需要"处理，宁可少提示 */ }
    return false;
  }
  window.__netNeedsMesh = netNeedsMesh;

  /**
   * R9 + R10 合并后的**单一**模型。返回 null = 不出组网横幅。
   * DOM 里恒只有一行 .bn-row[data-kind="net"]，所以不会同时出现两条。
   */
  function netBannerModel() {
    // 产品规则：没有任何异地对象 ⇒ 组网提醒一律不出现（不是"关了才提醒"，是"用不上就不打扰"）
    if (!netNeedsMesh()) return null;
    const tn = netTuning();
    const l = netState.link;
    const info = netState.autoOffInfo;
    // 附八.3 的**终态**：两端都不可拨入且没有可用中继 —— 再重试也没用，必须给"加一台中继"这条出路
    const gap = netRelayGap();
    // ① 组网已关（含断链自动关）：只要有异地成员或刚自动关过，就出这一条
    if (!netState.enabled && (info || netState.remoteCount > 0)) {
      const sig = 'meshoff:' + netState.meshOffSeq;
      if (netState.dismissed[sig]) return null;
      const affected = netState.remoteCount;
      const yingXiang = affected > 0 ? fmtKey('net.banner.meshOffBody', { n: affected }) : '';
      return {
        sig,
        tone: info ? 'danger' : 'warn',
        title: info ? fmtKey('net.banner.mergedTitle', { n: affected }) : t('net.banner.meshOffTitle'),
        body: [
          ...(info
            ? [fmtKey('net.banner.mergedBody', { fails: info.fails, secs: info.secs, rounds: info.rounds }), yingXiang]
            : [yingXiang]),
          gap ? t(gap.key) : '',
        ]
          .filter(Boolean)
          .join(' '),
        showTurnOn: true,
      };
    }
    // ② 终态优先于"正在重试"：双不可拨入且无中继时，转圈文案是**错的**（重试不会有结果）
    if (gap) {
      // 「没有这个结论 → 有这个结论」= 新的一次发生（netGapEpisode 在渲染前推进序号）。
      // 序号进签名，所以：同一次发生里手动关闭仍然有效（不反复打扰），
      // 但下一次（中间恢复过）必须重新出现 —— 这就是产品要求的"公网地址再次不可达要再弹"。
      const sig = 'relaygap:' + gap.code + ':' + netState.gapEpisode;
      if (netState.dismissed[sig]) return null;
      return {
        sig,
        tone: 'danger',
        terminal: true,
        title: t('net.banner.relayTerminalTitle'),
        body: t(gap.key),
        // 终态要**可执行**：去设置里配一台有公网地址的机器做中继（而不是让用户等）
        action: 'relaySettings',
        showTurnOn: false,
      };
    }
    // ③ 仍在重试的断链：先提示（还没关组网）
    if (l.linkDown) {
      const sig = 'link:' + (l.downSince || 0);
      if (netState.dismissed[sig]) return null;
      const secs = Math.max(0, Math.round((Date.now() - (l.downSince || Date.now())) / 1000));
      const after = Math.max(0, Math.round(((l.nextRetryAt || Date.now()) - Date.now()) / 1000));
      const yingXiang = netState.remoteCount > 0 ? fmtKey('net.banner.meshOffBody', { n: netState.remoteCount }) : '';
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
          yingXiang,
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
    const liShi = idHistoryCard(c);
    const nw = idNewCard(c);
    const dec = idContactDecision(c);
    const histHtml = liShi
      ? '<div class="id-card" data-card="history">' +
        '<div class="id-card-h">' + escapeHtml(t('idchg.histTitle')) + idTagHtml('idchg.cardHistoryTag', 'hist') + '</div>' +
        '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.email')) + '</span>' + cardValue(liShi.email) + '</div>' +
        '<div class="id-field"><span class="id-k">' + escapeHtml(t('card.phone')) + '</span>' + cardValue(liShi.phone) + '</div>' +
        (liShi.capturedAt
          ? '<div class="bn-hint">' + escapeHtml(fmtKey('idchg.historyCapturedAt', { t: new Date(liShi.capturedAt).toLocaleString() })) + '</div>'
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
      !!liShi && !!nw && (String(liShi.email || '') !== String(nw.email || '') || String(liShi.phone || '') !== String(nw.phone || ''));
    const days = Math.floor(dec.msLeft / 86400000);
    const hours = Math.floor((dec.msLeft % 86400000) / 3600000);
    const freezeText = dec.adopted
      ? t('idchg.adopted')
      : dec.frozen
        ? fmtKey('idchg.freeze', { days, hours })
        : t('idchg.freezeOver');
    const nowText = liShi
      ? fmtKey('idchg.contactNowIs', { v: [liShi.email, liShi.phone].filter((x) => String(x || '').trim()).join(' / ') || t('idchg.empty') })
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
    const liShi = idHistoryCard(c);
    const dec = idContactDecision(c);
    // 折叠时只留常驻标记 + 一行历史值摘要（历史留存值才是本机当前认的那份）
    const summary =
      t('idchg.oldEmail') + ' ' + (liShi ? String(liShi.email || '').trim() || t('idchg.empty') : t('idchg.noHistory')) + ' · ' +
      t('idchg.oldPhone') + ' ' + (liShi ? String(liShi.phone || '').trim() || t('idchg.empty') : t('idchg.noHistory'));
    return (
      '<div class="id-item' + (collapsed ? ' is-collapsed' : '') + '" data-cid="' + cid + '"' +
      ' data-scope-basis="' + escapeHtml(String(c.scopeBasis || '')) + '">' +
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
    // 同上：没有任何联系人/异地成员时，身份变更也无从谈起（不打扰）
    if (!netNeedsMesh()) return null;

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

  /**
   * 终态（双不可拨入且无中继）的**发生次数**。
   * 「没有这个结论 → 有这个结论」= 新的一次；一直在同一个结论里 = 同一次（不重复计数）。
   * 结论消失（公网地址又可达了）会把 gapLastCode 清空，于是下次再不可达 = 新的一次。
   * 只在这里推进，netBannerModel 只读 —— 模型保持纯函数，序号在渲染路径上推进。
   */
  function netGapEpisode(gap) {
    const code = gap ? String(gap.code || '') : '';
    if (!gap) {
      netState.gapLastCode = '';
      return;
    }
    if (netState.gapLastCode !== code) {
      netState.gapLastCode = code;
      netState.gapEpisode += 1;
    }
  }

  function renderNetBanner() {
    const host = $('net-banner');
    if (!host) return;
    // 先推进"终态发生次数"，再算模型（模型的 sig 里带这个序号）
    netGapEpisode(netRelayGap());
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
        '<div class="bn-row net-row tone-' + netRow.tone + '" data-kind="net" data-sig="' + escapeHtml(netRow.sig) +
          '" data-terminal="' + (netRow.terminal ? '1' : '0') + '">' +
          '<span class="bn-ico">' + BN_ICON[netRow.tone] + '</span>' +
          '<div class="bn-main">' +
          '<div class="bn-title">' + escapeHtml(netRow.title) + '</div>' +
          '<div class="bn-body">' + escapeHtml(netRow.body) + '</div>' +
          (netRow.tone === 'danger' && !netRow.terminal ? '<div class="bn-body">' + escapeHtml(t('net.banner.autoOff')) + '</div>' : '') +
          '<div class="bn-actions">' +
          (netRow.showTurnOn
            ? '<button class="btn-mini" data-bn="turnOn">' + escapeHtml(t('net.banner.turnOn')) + '</button>'
            : '') +
          (netRow.action === 'relaySettings'
            ? '<button class="btn-primary" data-bn="relaySettings">' + escapeHtml(t('net.banner.relayConfigure')) + '</button>'
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
        // 全局持久化：其它窗口/下次启动同样保持关闭（不再"新窗口又冒出来"）
        try {
          const sigs = Object.keys(netState.dismissed).slice(-50);
          window.warmy.settingsSave({ netBannerDismissed: sigs });
        } catch { /* noop */ }
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
      // 附八.3 终态的动作：去设置里配一台有公网地址的机器做中继（不是"再等一会儿"）
      if (act === 'relaySettings') {
        gotoNetSettings();
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
          // 身份层真实形状是「按指纹手动确认采用对方的新名片」（warmy:identity-peer-confirm）
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
    if (p.verdict === 'pass') {
      const total = Number(p.total || (p.entries && p.entries.length) || 0);
      const passCount = Number(p.passCount || 0);
      const partial = total > 0 && passCount > 0 && passCount < total
        ? ' · ' + fmtKey('net.partialPass', { pass: passCount, total })
        : '';
      if (p.code === 'lan') return { text: t('net.result.passLan') + partial, cls: 'net-ok' };
      // 「公网可达」是**强断言**：它要求别人真的能拨进来。而检测实际只验了两件事
      // ——「地址是公网」+「出站能连通」；入站可达性要第三方对端拨回才算验过。
      // 没验过就照实补一句，不要把「地址是公网」说成「可达」（附八.3 的诚实性要求）。
      const tail = t('net.result.passUnverifiedInbound');
      return { text: t('net.result.pass') + tail + partial, cls: 'net-ok' };
    }
    if (p.code === 'no-ipc' || p.code === 'probe-error') return { text: t('net.result.unknown'), cls: 'net-bad' };
    if (p.code === 'no-outbound') return { text: t('net.result.failOutbound'), cls: 'net-bad' };
    return { text: t('net.result.failPublic'), cls: 'net-bad' };
  }

  /**
   * R13：取一份**实测**的候选端口报告（只读：只探测，不绑定、不改配置、不替用户做主）。
   *
   * 为什么必须实测：静态候选表"看着干净"不代表本机现在绑得上（可能被别的进程占用，
   * 也可能落在 OS 保留段里 EACCES）。所以主进程会逐个真 bind 一次再回结果。
   * 不缓存：端口占用状况随时在变，陈旧结论比没有结论更糟（打开设置页/展开失败提示时重取）。
   */
  async function netFetchPortCandidates() {
    if (netState.portCandidatesLoading) return netState.portCandidates;
    netState.portCandidatesLoading = true;
    netState.portConflictSig = '';
    renderNetPortHint();
    try {
      const r = await netIpc('netPortCandidates', { requestedPort: netState.addr.port });
      if (r && r.ok !== false && Array.isArray(r.recommended)) netState.portCandidates = r;
      else netState.portCandidates = null;
    } catch {
      netState.portCandidates = null;
    }
    netState.portCandidatesLoading = false;
    netState.portConflictSig = '';
    renderNetPortHint();
    return netState.portCandidates;
  }

  /**
   * 端口提示区（R13）。三件事，都**只报事实/约定，绝不代替用户做决定**：
   *
   *   1) 约定端口：开发惯用 58588、测试惯用 62666 —— 提示，不是限制；
   *      输入框依旧可填 1–65535 的任意值（`parsePort` 在 onchange 里校验）。
   *   2) 实际绑上的端口：来自组网层 `bind` 事实（`boundPort` 与请求端口分开报）。
   *   3) **端口无法绑定**时：明确写出"哪个端口 + 底层错误码"，并给出**本机实测可用**的
   *      建议端口（只列 status==='ok' 的）。点一下**只是把该端口填进输入框**
   *      （走用户手改的同一条 onchange 路径），不自动重开组网、不替用户做主。
   */
  function renderNetPortHint() {
    const hint = $('net-port-hint');
    const boundEl = $('net-port-bound');
    const conflict = $('net-port-conflict');
    if (!hint && !boundEl && !conflict) return;

    const bind = netState.bind && typeof netState.bind === 'object' ? netState.bind : null;
    // 不用"渲染签名"跳过：设置页会被整块重画（innerHTML 重建 = dataset/textContent 全丢），
    // 而签名没变 → 只靠签名的守卫会让提示永久空着。改成**按 DOM 实际值比对**：
    // 值相同就不写（不抖动），值不同就补上（重画后自愈）。
    if (hint) {
      const wantConvention = 'dev:' + WARMY_DEV_NET_PORT + ',test:' + WARMY_TEST_NET_PORT;
      if (hint.dataset.convention !== wantConvention) hint.dataset.convention = wantConvention;
      const wantText = fmtKey('net.portConventionHint', { dev: WARMY_DEV_NET_PORT, test: WARMY_TEST_NET_PORT });
      if (hint.textContent !== wantText) hint.textContent = wantText;
    }
    if (boundEl) {
      // 只有**真的绑上了**才显示；失败时不显示"正在监听"之类的话术
      const bound = bind && Number(bind.boundPort) > 0 ? Number(bind.boundPort) : 0;
      const wantBound = bound ? String(bound) : '';
      if (boundEl.dataset.bound !== wantBound) boundEl.dataset.bound = wantBound;
      const wantBoundText = bound ? fmtKey('net.portBound', { port: String(bound) }) : '';
      if (boundEl.textContent !== wantBoundText) boundEl.textContent = wantBoundText;
    }

    if (!conflict) return;
    const bf = netState.bindFail;
    const cur = String(netState.addr.port || '');
    const report = netState.portCandidates && typeof netState.portCandidates === 'object' ? netState.portCandidates : null;
    // 只认实测 ok 的（防御式：即使上游给错，也不把非 ok 的当推荐）
    const okPorts = report && Array.isArray(report.recommended)
      ? report.recommended.filter((x) => x && x.status === 'ok' && Number(x.port) > 0).map((x) => Number(x.port)).filter((p) => String(p) !== cur)
      : [];
    const csig = bf
      ? [bf.port, bf.errorCode || '', bf.error || '', cur, state.locale,
         netState.portCandidatesLoading ? 'L' : '-', okPorts.join(','), report ? String(report.probed ? report.probed.length : 0) : '-'].join('|')
      : '';
    // 同样按 DOM 实际值比对：整个卡片重画后 dataset 会丢，签名相同也必须补画
    const domDrawn = !!conflict.getAttribute('data-sig') && conflict.getAttribute('data-sig') === netState.portConflictSig;
    if (netState.portConflictSig === csig && domDrawn) return;
    netState.portConflictSig = csig;
    conflict.setAttribute('data-sig', csig);

    if (!bf) {
      conflict.classList.add('hidden');
      conflict.innerHTML = '';
      conflict.dataset.failPort = '';
      conflict.dataset.failCode = '';
      return;
    }

    conflict.classList.remove('hidden');
    conflict.dataset.failPort = String(bf.port || '');
    conflict.dataset.failCode = String(bf.errorCode || '');
    conflict.dataset.failErrno = String(bf.error || '');
    conflict.dataset.suggestState = netState.portCandidatesLoading ? 'checking' : okPorts.length ? 'ok' : 'none';

    let suggestHtml;
    if (netState.portCandidatesLoading) {
      suggestHtml = '<div class="muted net-conflict-hint" id="net-port-suggest-state">' + escapeHtml(t('net.portSuggestChecking')) + '</div>';
    } else if (okPorts.length) {
      suggestHtml =
        '<div class="muted net-conflict-hint" id="net-port-suggest-state">' +
        escapeHtml(fmtKey('net.portSuggestMeasured', { probed: String(report && report.probed ? report.probed.length : okPorts.length) })) +
        '</div>' +
        '<div class="net-port-suggest" id="net-port-suggest">' +
        okPorts.map((p) => '<button type="button" class="btn-mini net-port-suggest-btn" data-port="' + p + '" data-status="ok">' + p + '</button>').join('') +
        '</div>';
    } else {
      suggestHtml = '<div class="muted net-conflict-hint" id="net-port-suggest-state">' + escapeHtml(t('net.portSuggestNone')) + '</div>';
    }

    conflict.innerHTML =
      '<div class="net-conflict-title">' + escapeHtml(t('net.portBindFailedTitle')) + '</div>' +
      '<div class="net-conflict-body">' +
      escapeHtml(fmtKey('net.portBindFailedBody', { port: String(bf.port || ''), error: String(bf.error || bf.errorCode || '') })) +
      '</div>' +
      suggestHtml +
      '<div class="muted net-conflict-hint">' + escapeHtml(t('net.portSuggestHint')) + '</div>' +
      '<div><button type="button" class="btn-mini" id="btn-net-port-suggest-refresh">' + escapeHtml(t('net.portSuggestRefresh')) + '</button></div>';

    const shuaxinAnniu = $('btn-net-port-suggest-refresh');
    if (shuaxinAnniu) shuaxinAnniu.onclick = () => void netFetchPortCandidates();

    const suggestBox = $('net-port-suggest');
    if (suggestBox) {
      suggestBox.onclick = (ev) => {
        const btn = ev && ev.target && ev.target.closest ? ev.target.closest('.net-port-suggest-btn') : null;
        if (!btn) return;
        const input = $('net-port');
        const p = parsePort(btn.dataset.port);
        if (!input || !p) return;
        // 只填输入框：走与"用户手改"完全相同的那条路径（onchange → 校验 → netPersist），
        // 不自动重开组网 —— 选哪个端口、什么时候重试，都是用户的事。
        input.value = String(p);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
    }
  }

  function renderNetCard() {
    if (!$('net-card')) return;
    renderNetLadder();
    renderNetDomains();
    renderNetEntryResults();
    renderNetProbeState();
    renderNetPortHint();
    const helpBtn = $('btn-net-help');
    if (helpBtn && !helpBtn.dataset.bound) {
      helpBtn.dataset.bound = '1';
      helpBtn.onclick = () => {
        const box = $('net-help-box');
        if (!box) return;
        box.classList.toggle('hidden');
        box.textContent = t('net.helpBody');
      };
    }
  }

  /**
   * 连接阶梯区块（`#net-ladder`）：六个档位**全部列出来**并标出当前档，
   * 再给出中继状态与本机可拨入性。全部文案走 i18n（未实现的档额外标「尚未实现（不可用）」）。
   *
   * 为什么把六档全列出来：用户要能看出"现在在哪一档、下一档是什么、哪一档还没实现"，
   * 只显示当前一档时，"打洞中"与"打洞未实现"在界面上会长得一模一样。
   */
  function renderNetLadder() {
    const box = $('net-ladder');
    if (!box) return;
    const m = netLadderModel();
    const gap = netRelayGap();
    const dialKind = m.dialKind || 'undetermined';
    const sig = JSON.stringify([
      m.current, m.claimed, m.suggested, m.relayKey, m.relayCode, m.dialKind, m.dialDerived,
      m.connected, m.sessions, m.hasV6, m.ipv6Candidate, gap ? gap.key : '', state.locale,
    ]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.setAttribute('data-terminal', gap ? '1' : '0');

    const items = m.rungs
      .map((rung) => {
        const unsupported = !!NET_RUNG_UNSUPPORTED[rung];
        const isCurrent = m.current === rung;
        const isSuggested = !m.current && m.suggested === rung;
        // 未实现优先于一切：即便它就是"当前档"，也只能显示成 unsupported（不许像在跑）
        const st = unsupported ? 'unsupported' : isCurrent ? 'current' : isSuggested ? 'candidate' : 'idle';
        const text = t(NET_RUNG_I18N[rung]) + (unsupported ? ' · ' + t('net.ladder.unsupported') : '');
        return (
          '<li class="net-rung" data-rung="' + rung + '" data-state="' + st + '"' +
          (isCurrent ? ' aria-current="true"' : '') + '>' +
          '<span class="net-rung-dot" aria-hidden="true"></span>' +
          '<span class="net-rung-text">' + escapeHtml(text) + '</span>' +
          '</li>'
        );
      })
      .join('');

    const currentRung = m.current || m.suggested;
    const noFacts = !m.current && !m.suggested && !netState.reachability && !(netState.ipv6 && (netState.ipv6.hasGlobalUnicast || netState.ipv6.publicCandidate));
    const currentText = currentRung
      ? t(NET_RUNG_I18N[currentRung])
      : noFacts && !netState.enabled
        ? t('net.ladder.unknown')
        : t('net.ladder.none');
    box.innerHTML =
      '<div class="net-ladder-head">' + escapeHtml(t('net.ladder.title')) + '</div>' +
      '<ul class="net-ladder-list">' + items + '</ul>' +
      '<div class="net-ladder-kv" data-k="current">' +
      '<span class="net-ladder-k">' + escapeHtml(m.current ? t('net.ladder.current') : t('net.ladder.candidate')) + '</span>' +
      '<span class="net-ladder-v" id="net-ladder-current" data-rung="' + escapeHtml(currentRung || '') +
      '" data-derived="' + (m.current ? '0' : '1') + '" data-claimed="' + escapeHtml(m.claimed || '') + '">' +
      escapeHtml(currentText) + '</span></div>' +
      '<div class="net-ladder-kv" data-k="relay">' +
      '<span class="net-ladder-k">' + escapeHtml(t('net.ladder.relay')) + '</span>' +
      '<span class="net-ladder-v" id="net-ladder-relay" data-code="' + escapeHtml(m.relayCode) +
      '" data-terminal="' + (gap ? '1' : '0') + '">' + escapeHtml(t(m.relayKey)) + '</span></div>' +
      '<div class="net-ladder-kv" data-k="dialability">' +
      '<span class="net-ladder-k">' + escapeHtml(t('net.ladder.dialability')) + '</span>' +
      '<span class="net-ladder-v" id="net-ladder-dial" data-kind="' + escapeHtml(dialKind) +
      '" data-derived="' + (m.dialDerived ? '1' : '0') + '">' + escapeHtml(t(NET_DIALABILITY_I18N[dialKind] || 'net.dialability.undetermined')) + '</span></div>';
  }

  /**
   * 公网地址列表（IP + 域名混合）。标签在 HTML 里只出现一次（#net-public-list-label），
   * 这里空态文案使用**另一个** key，避免旧缺陷里「域名标签渲染两次」。
   */
  function renderNetDomains() {
    if (!$('net-card')) return;
    const box = $('net-domains');
    if (!box) return;
    const list = netState.addr.publicAddresses || [];
    box.innerHTML = list.length
      ? list
          .map(
            (d, i) =>
              '<div class="net-domain-row" data-di="' + i + '">' +
              '<input class="net-domain-input" data-di="' + i + '" value="' + escapeHtml(d) + '" placeholder="' +
              escapeHtml(t('net.domainPlaceholder')) + '"/>' +
              '<button class="btn-mini" data-domain-del="' + i + '">' + escapeHtml(t('net.domainRemove')) + '</button>' +
              '</div>'
          )
          .join('')
      : '<div class="muted">' + escapeHtml(t('net.publicListEmpty')) + '</div>';
    box.querySelectorAll('[data-domain-del]').forEach((b) => {
      b.onclick = () => {
        (netState.addr.publicAddresses || []).splice(Number(b.dataset.domainDel), 1);
        netPersist();
        netInvalidateProbe();
        renderNetCard();
      };
    });
    box.querySelectorAll('input.net-domain-input').forEach((shuRu) => {
      shuRu.onchange = () => {
        const i = Number(shuRu.dataset.di);
        const v = String(shuRu.value || '').trim();
        if (!v || !shiFouHeFaZhuJi(v)) {
          shuRu.classList.add('net-invalid');
          return;
        }
        shuRu.classList.remove('net-invalid');
        if (!netState.addr.publicAddresses) netState.addr.publicAddresses = [];
        netState.addr.publicAddresses[i] = v;
        netPersist();
        netInvalidateProbe();
      };
    });
  }

  /** 逐条检测结果：每个 IP / 域名一行，诚实标出通过/失败/格式错误 */
  function renderNetEntryResults() {
    const box = $('net-entry-results');
    if (!box) return;
    const rows = netState.entryResults || [];
    if (!rows.length) {
      box.innerHTML = '';
      return;
    }
    const labelOf = (r) => {
      if (r.verdict === 'pass') return t('net.entryOk');
      if (r.verdict === 'unknown') return t('net.entryUnknown');
      if (r.code === 'invalid-entry') return t('net.entryInvalid');
      return t('net.entryFail');
    };
    box.innerHTML =
      '<div class="muted net-entry-title">' +
      escapeHtml(t('net.entryResultsTitle') + ' · ' + fmtKey('net.probeCount', { n: rows.length })) +
      '</div>' +
      rows
        .map(
          (r) =>
            '<div class="net-entry-row" data-entry="' + escapeHtml(r.entry || '') + '" data-verdict="' +
            escapeHtml(r.verdict || '') + '" data-code="' + escapeHtml(r.code || '') + '">' +
            '<span class="net-entry-host">' + escapeHtml(r.entry || '') + '</span>' +
            '<span class="net-entry-status ' + escapeHtml(r.verdict || '') + '">' + escapeHtml(labelOf(r)) + '</span>' +
            '<span class="muted net-entry-code">' + escapeHtml(r.code || '') + '</span>' +
            '</div>'
        )
        .join('');
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
      // B2：禁用态在整行上打标，视觉 + cursor: not-allowed
      const row = sw.closest('.net-switch-row');
      if (row) row.classList.toggle('is-disabled', !!sw.disabled);
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

  /** 技能自动发现目录：读（既有 settings 通道 / 专用 IPC） */
  async function skillScanDirsGet() {
    try {
      if (window.warmy.skillsScanDirsGet) return await window.warmy.skillsScanDirsGet();
      const s = await window.warmy.settingsGet();
      const dirs = (s && s.settings && Array.isArray(s.settings.skillScanDirs) ? s.settings.skillScanDirs : []).map(String);
      return { ok: true, dirs, scanDirs: [], max: 10 };
    } catch (e) {
      return { ok: false, error: String(e && e.message), dirs: [], scanDirs: [] };
    }
  }

  async function skillScanDirsSet(dirs) {
    const list = (dirs || []).map((d) => String(d || '').trim()).filter(Boolean);
    const MAX = 10;
    if (list.length > MAX) return { ok: false, error: 'too-many-dirs', max: MAX, count: list.length };
    try {
      if (window.warmy.skillsScanDirsSet) return await window.warmy.skillsScanDirsSet(list);
      await window.warmy.settingsSave({ skillScanDirs: list });
      return { ok: true, dirs: list };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  }

  function skillScanStatusText(st) {
    if (!st) return '';
    if (st.ok) return t('settings.skillsScanOk') + (typeof st.skillCount === 'number' ? ' · ' + st.skillCount : '');
    if (st.error === 'missing') return t('settings.skillsScanMissing');
    return t('settings.skillsScanInvalid');
  }

  async function renderSkillScanDirs() {
    const box = $('skill-scan-dirs');
    if (!box) return;
    const msg = $('skill-scan-msg');
    const r = await skillScanDirsGet();
    const dirs = (r && r.dirs) || [];
    const status = (r && r.scanDirs) || [];
    const byPath = {};
    status.forEach((s) => { byPath[s.path] = s; });
    window.__skillScanState = { dirs: dirs.slice(), scanDirs: status.slice(), lastResult: r };
    if (!dirs.length) {
      box.innerHTML = '<div class="muted">' + escapeHtml(t('settings.skillsScanEmpty')) + '</div>';
      return;
    }
    box.innerHTML = dirs
      .map((p, i) => {
        const st = byPath[p] || null;
        const bad = st && st.ok === false;
        return (
          '<div class="skill-scan-row" data-scan-i="' + i + '" data-scan-path="' + escapeHtml(p) + '" data-ok="' +
          (bad ? '0' : '1') + '">' +
          '<span class="skill-scan-path">' + escapeHtml(p) + '</span>' +
          '<span class="skill-scan-status ' + (bad ? 'bad' : 'ok') + '">' + escapeHtml(skillScanStatusText(st)) + '</span>' +
          '<button class="btn-mini" data-scan-edit="' + i + '">' + escapeHtml(t('settings.skillsScanEdit')) + '</button>' +
          '<button class="btn-mini" data-scan-del="' + i + '">' + escapeHtml(t('settings.skillsScanRemove')) + '</button>' +
          '</div>'
        );
      })
      .join('');
    box.querySelectorAll('[data-scan-del]').forEach((b) => {
      b.onclick = async () => {
        const i = Number(b.dataset.scanDel);
        const next = dirs.slice();
        next.splice(i, 1);
        const yunXingJieGuo = await skillScanDirsSet(next);
        if (yunXingJieGuo && yunXingJieGuo.ok === false) {
          if (msg) msg.textContent = t('settings.skillsScanMax');
          return;
        }
        const shuRu = $('skill-scan-dir-input');
        if (shuRu) shuRu.removeAttribute('data-edit-i');
        const btn = $('btn-skill-scan-add');
        if (btn) btn.textContent = t('settings.skillsScanAdd');
        await renderSkillScanDirs();
        await renderSkillList();
      };
    });
    box.querySelectorAll('[data-scan-edit]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.scanEdit);
        const shuRu = $('skill-scan-dir-input');
        const btn = $('btn-skill-scan-add');
        if (shuRu) {
          shuRu.value = dirs[i] || '';
          shuRu.setAttribute('data-edit-i', String(i));
        }
        if (btn) btn.textContent = t('settings.skillsScanSave');
        if (msg) msg.textContent = '';
      };
    });
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
    const DaoHangAnNiu = document.querySelector('#settings-nav button[data-sec="func"]');
    if (DaoHangAnNiu) DaoHangAnNiu.click();
    const card = $('net-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
    // R13：进组网设置页时**重新实测**一次候选端口（端口占用状况随时在变，不用旧结论）
    if (netState.bindFail) void netFetchPortCandidates();
    const focusEl = $('net-domains') && $('net-domains').querySelector('input.net-domain-input');
    if (focusEl) focusEl.focus();
    else {
      const tianJiaAnNiu = $('btn-net-domain-add');
      if (tianJiaAnNiu) tianJiaAnNiu.focus();
    }
  }

  function bindNetCard() {
    const box = $('net-card');
    if (!box) return;
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
    // 刷新按钮：重采本机地址 + 公网地址，并把公网地址写入列表（取代旧「自动填入本机地址」）
    const refresh = $('btn-net-refresh');
    if (refresh && refresh.dataset.bound !== '1') {
      refresh.dataset.bound = '1';
      refresh.onclick = async () => {
        const r = await netRefreshAddresses();
        void uiAlert(
          fmtKey('net.refreshDone', { local: (r.local && r.local.ip) || '—', public: r.publicIp || '—' }),
          t('net.refresh')
        );
      };
    }
    const detect = $('btn-net-detect');
    if (detect && detect.dataset.bound !== '1') {
      detect.dataset.bound = '1';
      detect.onclick = async () => {
        const r = await netDetect();
        if (r && r.code === 'empty-list') void uiAlert(t('net.emptyList'), t('net.detect'));
        else if (r && r.code === 'invalid-port') void uiAlert(t('net.invalidPort'), t('net.port'));
      };
    }
    const addD = $('btn-net-domain-add');
    if (addD && addD.dataset.bound !== '1') {
      addD.dataset.bound = '1';
      addD.onclick = () => {
        if (!netState.addr.publicAddresses) netState.addr.publicAddresses = [];
        netState.addr.publicAddresses.push('');
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
        const keZhiXing = await netSetEnabled(want);
        if (!keZhiXing) renderNetCard();
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

  /** 本人身份（真实 IPC 已落地：warmy:identity-info；桩：identityGet） */
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
    // 只采本机/公网地址事实用于展示；**不**把本机地址写入公网地址列表（产品要求默认不预填）。
    await netFetchLocal();
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
    // 附八.9 / 附八.3：档位与中继的模型（纯函数，便于自动化直接断言映射与"未实现不显示成在跑"）
    ladder: netLadderModel,
    relayGap: netRelayGap,
    renderLadder: renderNetLadder,
    rungI18n: () => Object.assign({}, NET_RUNG_I18N),
    rungUnsupported: () => Object.assign({}, NET_RUNG_UNSUPPORTED),
    relayI18n: () => Object.assign({}, NET_RELAY_I18N),
    dialabilityI18n: () => Object.assign({}, NET_DIALABILITY_I18N),
    rungs: () => NET_RUNGS.slice(),
    refreshBanner: () => { netState.renderedSig = ''; renderNetBanner(); },
    /** 终态"发生次数"（只读诊断：证明"再次不可达 = 新的一次"） */
    gapEpisode: () => netState.gapEpisode,
    refreshPresence: netRefreshPresence,
    refreshMembers,
    loadIdChanges: idLoadChanges,
    detect: netDetect,
    setEnabled: netSetEnabled,
    refreshAddresses: netRefreshAddresses,
    heartbeat: netHeartbeatTick,
    gotoNetSettings,
    // R13：实测候选端口（只读；给自动化用，也能被界面的"重新实测"按钮调用）
    fetchPortCandidates: netFetchPortCandidates,
    renderPortHint: renderNetPortHint,
    // T194：控制台（真实事件流）—— push 走的就是 IPC 回调那条同路径函数。
    // 注意：cap/lines/lastSeq/isOpen 一律用**惰性取值函数**：``window.__netUi`` 这个字面量
    // 在本文件里出现得比 CONSOLE_CAP/consoleLines 的声明更早，直接取值会踩 TDZ。
    console: {
      push: consoleAppend,
      clear: consoleClear,
      render: renderConsole,
      lines: () => consoleLines.slice(),
      cap: () => CONSOLE_CAP,
      redact: consoleRedact,
      format: consoleLineText,
      lastSeq: () => consoleLastSeq,
      isOpen: () => !!state.consoleOpen,
    },
    // 邀请链接的**唯一**构造入口（node ← meshStatus.nodeId、port ← 组网设置里的真端口）
    ownInviteLink,
  };
  window.__skillsUi = {
    getDirs: skillScanDirsGet,
    setDirs: skillScanDirsSet,
    renderDirs: renderSkillScanDirs,
    renderList: renderSkillList,
    state: () => window.__skillScanState || null,
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
        const r = await window.warmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          // 尝试 ASR 转文字
          const asr = await window.warmy.asrTranscribe({ dataUrl, ext: 'webm' }).catch(() => null);
          const text = asr?.ok && asr.text ? asr.text : `[${t('chat.voice')}] ${r.path.split(/[\\/]/).pop()}`;
          tuisongXiaoxi(state.selectedChat.id, 'me', text);
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
    if (!btn) return;
    // 容器项目停止态：开发入口整体禁用（不是"能敲但发不出去"）
    if (($('input') || {}).dataset && $('input').dataset.devBlocked === '1') { btn.disabled = true; return; }
    btn.disabled = !($('input')?.value || '').trim();
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
    const caiDan = $('urg-menu');
    const dd = $('urgency-dd');
    const label = $('urg-label');
    if (!trigger || !caiDan || !dd) return;

    const LABELS = { P1: 'urgency.urgentLabel', P2: 'urgency.insertLabel', P3: 'urgency.queueLabel' };

    function refresh() {
      if (label) label.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      const icon = dd.querySelector('.urgent-i');
      if (icon) icon.classList.toggle('hidden', state.urgency !== 'P1');
      caiDan.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.u === state.urgency));
    }
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      caiDan.classList.toggle('hidden');
      if (!caiDan.classList.contains('hidden')) positionMenuFixed(trigger, caiDan);
    });
    onDocClick(() => caiDan?.classList.add('hidden'));

    caiDan.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');
      if (!b) return;
      const u = b.dataset.u;
      if (u === 'P1') {
        const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
        if (!ok) {
          caiDan.classList.add('hidden');
          return;
        }
      }
      state.urgency = u;
      caiDan.classList.add('hidden');
      refresh();
    });

    // 语言切换后刷新文案
    window.__refreshUrgency = refresh;
  })();
  // 「…」更多菜单
  $('more-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const caiDan = $('more-menu');
    caiDan?.classList.toggle('hidden');
    if (caiDan && !caiDan.classList.contains('hidden')) {
      try { xuanranGengduoCaidan(); } catch { /* noop */ }
      // 同步「仅@ai才发言」勾选态（群聊默认勾选）
      const g = (state.groups || []).find((x) => x.id === state.selectedChat?.id) || (state.chats || []).find((x) => x.id === state.selectedChat?.id);
      __directed = !!(g && g.directedMode);
      const m = $('mi-directed-mark');
      if (m) { m.textContent = __directed ? '✓' : '✕'; }
      const am = $('mi-autoscroll-mark');
      if (am) am.style.visibility = autoScrollChat ? 'visible' : 'hidden';
      positionMenuFixed($('more-trigger'), caiDan);
    }
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
      await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });
  // ADR 004 第七批：「运行/测试在容器中」这个菜单项**已删除**（容器 = 开发环境，测试/运行不在其职责内）。
  // 开发环境在**创建项目时**选定；启用/停用项目与切换容器都在**项目右键菜单**里。
  $('mi-open')?.addEventListener('click', async () => {
    $('more-menu')?.classList.add('hidden');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏；任务栏图标 = 该会话头像
    const iconDataUrl = await chatAvatarDataUrl();
    window.warmy.openChatWindow({
      id: state.selectedChat.id,
      title: state.selectedChat.name,
      kind: state.selectedChat.kind,
      mode: 'sub',
      iconDataUrl,
    });
  });
  $('mi-export')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    showExportDialog();
  });

  /* ══ 容器项目的开发面门禁（定稿语义）════════════════════════════════════════
     「容器项目 = 只能在容器里开发」。停止态（容器没起 或 创建者点了停止）下：
       · 开发入口（输入 + 发送）**禁用**，并给出原因；
       · 成员看到的状态**与"创建者下线"完全一致**（同一个标志位 + 同一句离线文案）；
       · 宿主侧编辑被**拒绝**（主进程会再拒一次 —— 渲染层不是授权层）。
     ══════════════════════════════════════════════════════════════════════════ */

  /** 返回"被拒绝的原因文案"，null = 放行 */
  async function xiangMuKaiFaKuai(sessionId) {
    const id = String(sessionId || '');
    if (!id) return null;
    const xiangMuTai = await quXiangMuTai(id);
    if (!xiangMuTai || xiangMuTai.devEnv !== 'container' || xiangMuTai.developmentAllowed) return null;
    return t(PROJECT_STOP_REASON(xiangMuTai.code, xiangMuTai.reasonKey));
  }

  /**
   * 把停止态落到**开发入口**上（输入框 / 发送按钮）+ 给聊天区挂一个可断言的标志位。
   * 只在「项目」里生效：「我的牛马」恒为本机开发，不受影响。
   */
  async function yingYongXiangMuKaiFaMen() {
    const sel = state.selectedChat;
    const input = $('input');
    const col = $('chat-col');
    const xiangMuTai = sel && sel.kind === 'internal' ? await quXiangMuTai(sel.id) : null;
    const stopped = !!(xiangMuTai && xiangMuTai.stopped);
    if (col) {
      col.dataset.projectState = xiangMuTai ? (stopped ? 'stopped' : 'running') : 'none';
      col.dataset.projectCode = xiangMuTai ? String(xiangMuTai.code) : '';
    }
    if (input) {
      input.dataset.devBlocked = stopped ? '1' : '0';
      input.disabled = stopped;
      input.title = stopped
        ? fmtKey('container.project.devBlocked', { reason: t(PROJECT_STOP_REASON(xiangMuTai ? xiangMuTai.code : 'container-not-ready', xiangMuTai ? xiangMuTai.reasonKey : '')) })
        : '';
    }
    const btn = $('btn-send');
    if (btn) {
      btn.title = stopped ? (input ? input.title : '') : '';
    }
    syncSendState();
    return stopped;
  }

  // 本机的人敲回车 / 点「执行」→ 走 submitShellLine（主进程未就绪则**不执行任何东西**）
  $('ctg-shell-send')?.addEventListener('click', () => { void submitShellLine(); });
  $('ctg-shell-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitShellLine(); }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     诊断事件流（T194，**已降级为独立排障视图**）—— 它是本机事件日志，**不是控制台**。
     控制台 = **容器内的 shell**（`#ctg-shell-pane`，见 openContainerShell）。
     把事件日志当"控制台"正是上一版做错的地方（已撤销），所以两者刻意分开。
     事件来源（主进程**推送**，不是轮询）：
       · cat=tool   工具调用开始 / 结束（recall、retrieve …）
       · cat=net    组网：开启、关闭、端口绑定失败、对端会话上/下线、局域网发现、握手
       · cat=error  错误：未捕获异常、未处理的 Promise 拒绝、IPC 处理器抛出的"已处理失败"、
                    chat-send 自己吞掉并回 retry 的失败
       · cat=ui     渲染层自身异常（error / unhandledrejection）
     没接上的：无。主进程侧只有这些"事件源"（其余 IPC 都是请求-应答式状态查询，
             没有事件语义，硬塞进来只会变成噪音）。
     渲染层只做三件事：①按 code 取 i18n 文案（未知 code 也如实显示原始 code）；②**打码**；
                     ③按上限截断（超上限丢最旧）。
     只显示**元数据**（工具名、端口、errno、频道名、错误首行）：消息正文与工具结果正文
     主进程根本不推。打码是双保险，不是唯一防线。
     ══════════════════════════════════════════════════════════════════════════ */
  /** 环形上限：超过就丢最旧的（面板不可能无限长） */
  const CONSOLE_CAP = 800;
  const consoleLines = [];
  /** 已处理的最大 seq：IPC 重投/窗口重建时不重复贴同一行 */
  let consoleLastSeq = 0;

  /**
   * 凭据打码（命中即替换成 t('console.redacted')）。
   * 覆盖：sk-/pk-/rk- 风格 API Key、GitHub gh*_ 令牌、Slack xox*、JWT（eyJ…）、
   *      `key=value` 形状里的密钥字段（api_key/token/tok/secret/password/…）、Bearer 头、
   *      以及 ≥40 位且字母数字混合的长串（密钥/哈希的典型形状）。
   * 宁可多打一点：这是"别把密钥显示在界面上"的最后一道防线。
   */
  function consoleRedact(text) {
    const mask = t('console.redacted');
    let s = String(text == null ? '' : text);
    s = s.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, mask);
    s = s.replace(/\bgh[pousr]_[A-Za-z0-9]{10,}/g, mask);
    s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{6,}/g, mask);
    s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, mask);
    s = s.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? mask : m));
    s = s.replace(
      /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|tok|secret|password|passwd|passphrase|authorization)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      (_m, k, sep) => k + sep + mask
    );
    s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ' + mask);
    return s;
  }

  /** 事件里的 data 直出成一行 JSON（对象不直出 [object Object]）；照样打码 */
  function consoleDataText(d) {
    try {
      const keys = Object.keys(d || {});
      if (!keys.length) return '';
      const parts = keys.map((k) => k + '=' + String(d[k] == null ? '' : d[k]));
      return parts.join(' ');
    } catch {
      return '';
    }
  }

  /**
   * 事件 → 一行文本。未知 code **不静默丢**：照原样显示 code + 数据（并打码）。
   * 返回 null = 这条事件不该显示（目前不会发生）。
   */
  function consoleLineText(ev) {
    const cat = String((ev && ev.cat) || 'system');
    const code = String((ev && ev.code) || '');
    let d = ev && ev.data && typeof ev.data === 'object' ? ev.data : {};
    // 少量"展示期派生"：布尔/枚举 → i18n 词（模板只做占位符替换，不做条件判断）
    if (code === 'tool.finish') d = Object.assign({}, d, { result: d.ok === false ? t('console.result.fail') : t('console.result.ok') });
    const catLabel = fmtKey('console.cat.' + cat);
    const catText = catLabel === 'console.cat.' + cat ? cat : catLabel;
    const key = 'console.' + code;
    const yiZhi = t(key) !== key;
    const body = yiZhi
      ? fmtKey(key, d)
      : fmtKey('console.unknown', { code: code || '?' }) + (consoleDataText(d) ? ' ' + consoleDataText(d) : '');
    const ts = new Date(Number((ev && ev.ts) || Date.now()) || Date.now());
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const anQuanCang = String(ts.getSeconds()).padStart(2, '0');
    return consoleRedact('[' + hh + ':' + mm + ':' + anQuanCang + '] [' + catText + '] ' + body);
  }

  /** 一条事件进面板：格式化 → 打码 → 入队 → 超上限丢最旧 → （面板开着才）重画 */
  function consoleAppend(ev) {
    try {
      const seq = Number(ev && ev.seq);
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= consoleLastSeq) return null; // 重复投递：同一 seq 只显示一次
        consoleLastSeq = seq;
      }
      const line = consoleLineText(ev);
      if (!line) return null;
      consoleLines.push(line);
      const shangxian = (typeof CONSOLE_CAP === 'number' ? CONSOLE_CAP : __CONSOLE_CAP_EARLY);
      while (consoleLines.length > shangxian) consoleLines.shift();
      renderConsole();
      return line;
    } catch {
      // 渲染层自己的格式化异常不能反过来打断消息流
      return null;
    }
  }

  /**
   * 画面板：表头（如实话术 + 上限）+ 清空按钮 + 正文。
   * 关闭时**不写正文**（避免无谓重排）；打开时由 toggle 调一次补齐 ——
   * 于是"打开面板"既不会刷屏、也不会重复贴行（正文永远是 buffer 的一次快照）。
   */
  function renderConsole() {
    const hint = $('console-hint');
    if (hint) hint.textContent = fmtKey('console.hint', { n: (typeof CONSOLE_CAP === 'number' ? CONSOLE_CAP : __CONSOLE_CAP_EARLY) });
    const btn = $('console-clear');
    if (btn) btn.textContent = t('console.clear');
    const out = $('console-out');
    if (!out || !state.consoleOpen) return;
    out.textContent = (consoleLines.length ? consoleLines.join('\n') : t('console.empty')) + '\n';
    out.scrollTop = out.scrollHeight;
  }

  /** 清空：buffer 清掉，并留一行"已清空"的时间戳（谁清的、什么时候清的要看得见） */
  function consoleClear() {
    const wasOpen = !!state.consoleOpen;
    consoleLines.length = 0;
    consoleLines.push(consoleRedact(fmtKey('console.cleared', { ts: new Date().toLocaleTimeString() })));
    if (wasOpen) renderConsole();
    return consoleLines.length;
  }

  // ── 接线：主进程推送 + 渲染层自身异常 ──
  /** onConsoleEvent 的退订函数（preload 返回；拿不到就是 null） */
  let consoleOffConsoleEvent = null;
  (function bindConsoleStream() {
    try {
      const off = window.warmy?.onConsoleEvent?.((ev) => consoleAppend(ev));
      if (typeof off === 'function') consoleOffConsoleEvent = off;
    } catch {
      /* preload 没这个方法（例如极旧的壳）：面板照样能用，只是没有主进程事件 */
    }
    window.addEventListener('error', (e) => {
      consoleAppend({
        cat: 'ui',
        code: 'ui.uncaught',
        ts: Date.now(),
        data: { message: String((e && (e.message || (e.error && e.error.message))) || 'error') },
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      consoleAppend({
        cat: 'ui',
        code: 'ui.unhandled-rejection',
        ts: Date.now(),
        data: { message: String((r && (r.message || r)) || 'rejection') },
      });
    });
  })();

  // ADR 004 P4：容器控制台（只在容器就绪 + 本会话开启容器运行时可用）
  $('btn-container-shell')?.addEventListener('click', () => { void openContainerShell(); });
  $('ctg-shell-close')?.addEventListener('click', () => { $('ctg-shell-pane')?.classList.add('hidden'); });
  // 诊断事件流：**自己展开/收起**（不再依赖已从聊天头移除的 #btn-console）
  function toggleDiagPanel(forceOpen) {
    const host = $('diag-host');
    const chev = $('diag-chev');
    const open = forceOpen === true ? true : forceOpen === false ? false : !(host && !host.classList.contains('hidden'));
    state.consoleOpen = !!open;
    host?.classList.toggle('hidden', !open);
    $('console-pane')?.classList.toggle('hidden', !open);
    if (chev) chev.textContent = open ? '⌄' : '›';
    $('btn-console')?.classList.toggle('tb-on', open);
    if (open) {
      try { renderConsole(); } catch { /* noop */ }
      const hint = $('console-hint');
      if (hint && !hint.textContent) {
        try {
          hint.innerHTML = escapeHtml(fmtKey('console.hint', { n: '200' })).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        } catch { hint.textContent = t('console.hint'); }
      }
    }
  }
  window.__toggleDiagPanel = toggleDiagPanel;
  $('btn-console')?.addEventListener('click', () => { toggleDiagPanel(); });
  $('diag-toggle')?.addEventListener('click', () => { toggleDiagPanel(); });
  $('console-clear')?.addEventListener('click', () => { consoleClear(); });
  (function bindConsoleResize() {
    const yuanSu = $('console-resizer');
    const mianBan = $('console-pane');
    if (!yuanSu || !mianBan) return;
    let y0 = 0, h0 = 0, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      const h = Math.min(360, Math.max(80, h0 + (y0 - e.clientY)));
      mianBan.style.maxHeight = h + 'px';
      mianBan.style.height = h + 'px';
    };
    const onUp = () => { drag = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    yuanSu.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = mianBan.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  })();
  $('btn-shot')?.addEventListener('click', () => uiAlert(t('chat.screenshotPending')));
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('sec-trigger');
    const caiDan = $('sec-menu');
    const dd = $('sec-dd');
    const label = $('sec-label');
    if (!trigger || !caiDan || !dd) return;

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
      caiDan.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === mode));
    }
    window.__refreshSecurity = refresh;
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      caiDan.classList.toggle('hidden');
      if (!caiDan.classList.contains('hidden')) positionMenuFixed(trigger, caiDan);
    });
    onDocClick(() => caiDan?.classList.add('hidden'));

    caiDan.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          caiDan.classList.add('hidden');
          return;
        }
      }
      caiDan.classList.add('hidden');
      if (state.selectedChat) {
        state.sessionSecurity[state.selectedChat.id] = mode;
      } else {
        state.globalSecurity = mode;
        try { await window.warmy.setSecurityMode(mode); } catch { /* noop */ }
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
  $('btn-win-min')?.addEventListener('click', () => window.warmy.winMinimize());
  $('btn-win-max')?.addEventListener('click', () => window.warmy.winMaximize());
  $('btn-win-close')?.addEventListener('click', () => window.warmy.winClose());
  $('btn-ui-refresh')?.addEventListener('click', () => window.warmy.winReload());
  $('btn-always-top')?.addEventListener('click', async () => {
    const r = await window.warmy.winAlwaysOnTop();
    $('btn-always-top')?.classList.toggle('tb-active', !!r?.alwaysOnTop);
  });

  (async () => {
    try {
      const p = await window.warmy.platformInfo();
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
      const r = await window.warmy.groupList();
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
  /** 供自动化/外部触发刷新（建群、对端同步、验收脚本都走这一条） */
  window.__syncGroups = () => syncGroupsFromStore();

  /**
   * 创建项目（ADR 004 P3）：**必须**先选开发环境（本机 / 容器）才能创建。
   * 选「容器中」时，创建后每次启动项目都必须先启动容器（启动流程见 startProjectFlow）。
   *
   * 第十六批（产品主定稿：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**）：
   * 开发环境随 `groupCreate` **写进项目记录**（项目级、会同步给成员）——
   * 键是 `devEnv`。下面那份 `containerDev` 只是**兼容旧版本读取路径的本机镜像**
   * （主进程读的时候**项目记录优先**）；它不再是"这条项目是不是容器项目"的唯一来源。
   */
  function projectCreateDialog() {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('container.devEnv.createTitle');
      const body = $('modal-body');
      body.innerHTML = '';
      const p1 = document.createElement('div');
      p1.textContent = t('container.devEnv.required');
      const nameLabel = document.createElement('div');
      nameLabel.className = 'ctg-dim';
      nameLabel.textContent = t('container.devEnv.nameLabel');
      const input = document.createElement('input');
      input.id = 'project-name-input';
      input.style.cssText = 'width:100%;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--input-bg);color:var(--ink);font:inherit';
      input.placeholder = t('placeholder.groupName');
      const kaifaHang = document.createElement('div');
      kaifaHang.id = 'project-dev-env';
      kaifaHang.className = 'ctg-seg';
      kaifaHang.dataset.chosen = '';
      const zao = (zhi, labelKey) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.devEnvPick = zhi;
        b.id = 'project-dev-env-' + zhi;
        b.textContent = t(labelKey);
        b.onclick = () => {
          kaifaHang.dataset.chosen = zhi;
          Array.from(kaifaHang.querySelectorAll('[data-dev-env-pick]')).forEach((x) => x.classList.toggle('on', x.dataset.devEnvPick === zhi));
          ok.disabled = false;
        };
        return b;
      };
      kaifaHang.append(zao('host', 'container.devEnv.host'), zao('container', 'container.devEnv.container'));
      const note = document.createElement('div');
      note.className = 'ctg-dim';
      note.textContent = t('container.devEnv.note');
      body.append(p1, nameLabel, input, kaifaHang, note);
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); resolve(null); };
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.id = 'project-create-ok';
      ok.textContent = t('common.ok');
      // **没选开发环境就不让创建**（这正是 P3 的要求：创建时必须选）
      ok.disabled = true;
      ok.onclick = () => {
        if (!kaifaHang.dataset.chosen) return;
        const name = String(input.value || '').trim();
        if (!name) { input.focus(); return; }
        root.classList.add('hidden');
        resolve({ name, devEnv: kaifaHang.dataset.chosen });
      };
      acts.append(cancel, ok);
      root.classList.remove('hidden');
      input.focus();
    });
  }

  function createGroupFlow() {
    if (state.nav === 'internalGroup') {
      // 项目：必须选开发环境（P3）
      void projectCreateDialog().then(async (res) => {
        if (!res) return;
        const id = 'g-' + Date.now();
        try {
          // devEnv 一起送进主进程 → 写进**项目记录**（项目级事实，随项目同步给成员）
          await window.warmy.groupCreate({ groupId: id, name: res.name, type: 'internal', directedMode: false, devEnv: res.devEnv });
        } catch (e) {
          uiAlert(String(e.message || e));
          return;
        }
        // 兼容旧版本读取路径的本机镜像（**不是**唯一来源：主进程读时项目记录优先）
        try {
          const s = await window.warmy.settingsGet();
          const map = (s && s.settings && s.settings.containerDev) || {};
          map[id] = res.devEnv;
          await window.warmy.settingsSave({ containerDev: map });
        } catch {
          /* 镜像写不进去也不该挡住创建：项目记录里那份才是事实来源 */
        }
        await syncGroupsFromStore();
      });
      return;
    }
    uiPrompt(t('list.createGroupChat'), t('placeholder.groupNameExt')).then(async (name) => {
      if (!name) return;
      const type = 'external';
      const id = 'g-' + Date.now();
      try {
        // 群聊默认「仅@ai才发言」勾选
        await window.warmy.groupCreate({ groupId: id, name, type, directedMode: true });
      } catch (e) {
        uiAlert(String(e.message || e));
        return;
      }
      await syncGroupsFromStore();
    });
  }

  /**
   * 加联系人（附六：对方一定看得到你的联系方式 —— 不可隐藏，但可以不写）。
   * 原来是「提示框填名字」的 addContactFlow，R4 把它并进「添加联系人」弹窗的右列
   * （左列放自己的链接/二维码），流程本身一字未改：填名字 → 名片确认 → 落一行联系人。
   * 返回 true = 真的加上了。
   */
  async function createContactWithCard(name) {
    const mingCheng = String(name || '').trim();
    if (!mingCheng) return false;
    const card = await myCard();
    const go = await shareCardConfirm(card, 'contact.add');
    if (!go) return false;
    state.chats.push({ id: 'c-' + Date.now(), name: mingCheng, kind: 'extdm', lastPreview: t('list.noReply'), notify: true, card });
    renderList();
    window.__saveState?.();
    return true;
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

  /**
   * 竖分隔条拖动（列表栏 #col-resizer 与右栏 #panel-resizer 共用这**一套**，不另造轮子）。
   *   opts.dir === 'right'：被拖的栏在**右边**（指针右移 → 该栏变窄），左侧那一栏由 1fr 吃掉差值。
   *   opts.hostId / opts.minOther：给「另一侧」留最小宽度——上限随容器宽度收缩，
   *     两边都拖不到 0（420px 的窗口里也拖不塌）。
   *   opts.persistKey：松手 / 双击复位后把宽度写回**既有 settings 通道**（不新开存储文件）。
   *   opts.resetWidth：双击恢复的默认宽度。
   */
  function bindResizer(yuanSu, cssVar, min, max, opts) {
    if (!yuanSu) return;
    const o = opts || {};
    const dir = o.dir === 'right' ? -1 : 1;
    const resetWidth = Number(o.resetWidth) || min;
    const minOther = Number(o.minOther) || 0;
    const curW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || resetWidth;
    /** 上限：还要给另一侧留出 minOther，否则窄窗口下会把对面挤成 0 */
    const capMax = () => {
      let cap = max;
      const host = o.hostId ? $(o.hostId) : null;
      if (host && minOther) {
        const keYong = host.getBoundingClientRect().width - minOther;
        if (keYong > min) cap = Math.min(cap, Math.floor(keYong));
      }
      return cap;
    };
    const setW = (w) => {
      const v = Math.min(capMax(), Math.max(min, Math.round(w)));
      document.documentElement.style.setProperty(cssVar, v + 'px');
      return v;
    };
    const persist = (w) => {
      if (!o.persistKey || !w) return;
      try {
        const patch = {};
        patch[o.persistKey] = w;
        window.warmy.settingsSave(patch);
      } catch {
        /* 持久化失败不影响拖动本身 */
      }
    };
    let startX = 0, startW = 0, dragging = false, lastW = 0;
    const onMove = (e) => {
      if (!dragging) return;
      lastW = setW(startW + dir * (e.clientX - startX));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      yuanSu.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      persist(lastW);
    };
    yuanSu.addEventListener('mousedown', (e) => {
      dragging = true;
      yuanSu.classList.add('dragging');
      startX = e.clientX;
      startW = curW();
      lastW = startW;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
    // 双击复位：被拖到极限后也能一步回到默认布局
    yuanSu.addEventListener('dblclick', (e) => {
      e.preventDefault();
      lastW = setW(resetWidth);
      persist(lastW);
    });
  }

  function bindVerticalResizer(handleId, targetId, dir) {
    const yuanSu = $(handleId);
    const target = $(targetId);
    if (!yuanSu || !target) return;
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
    yuanSu.addEventListener('mousedown', (e) => {
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

  /* ══════════════════════════════════════════════════════════════════════
     R2 设置「快捷」列：给其他智能体的接口目录 + 给人用的键盘快捷键
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * 真二维码：用 index.html 里以**普通 <script src>** 引入的经典脚本编码器
   * （vendor/qrcode-generator-2.0.4.js，MIT，全局 `qrcode`）把文本编成真 QR 再画成 SVG。
   *
   * 为什么是它、为什么必须 vendored 成文件而不是 npm 依赖：
   *   渲染层是 file:// 页面，index.html 的 CSP 是 `script-src 'self'`（没有 unsafe-eval）。
   *   本轮在**真实 dist 产物**上复现过：动态 import('./qr.js') 报
   *   "Failed to fetch dynamically imported module"，`<script type=module src>` 也加载失败
   *   —— ESM 这条路在 file:// + CSP 下走不通。所以编码器只能是「经典脚本 + 全局变量」，
   *   且必须随仓库、不联网、不加第三方依赖。
   *   （别拿 CDP 的 Runtime.evaluate 去测 eval/new Function：DevTools 求值不受页面 CSP 约束，
   *    实测在同一个 CSP 页面上 new Function 也能通过 —— 那种测法证不了 CSP。）
   *
   * 参数按 QR 规范取值，不是随手填的：
   *   * 纠错等级 M（产品要求，约 15% 冗余）；
   *   * 静区 4 个模块（ISO/IEC 18004 要求 ≥4），四周留白写进 viewBox，扫码才认得出边界；
   *   * 版本自适应（typeNumber 0），因此模块数 = 4*版本+17 是由载荷长度算出来的真值，
   *     并写进 data-qr-* 属性，验收脚本据此从**几何**上反解矩阵来核对。
   *
   * 拿不到编码器（脚本没加载上）或编码失败时返回空串，调用方**如实说明**，绝不画假码。
   */
  function qrSvg(text, size = 168, ecc = 'M') {
    const enc = typeof window !== 'undefined' ? window.qrcode : null;
    const data = String(text == null ? '' : text);
    if (typeof enc !== 'function' || !data) return '';
    try {
      // 上游默认 stringToBytes 是 Latin-1 式的逐字节映射；链接里可能出现非 ASCII
      // （身份别名/名字），显式换成 UTF-8，否则编出来的码扫出来是乱码。
      if (enc.stringToBytesFuncs && enc.stringToBytesFuncs['UTF-8']) {
        enc.stringToBytes = enc.stringToBytesFuncs['UTF-8'];
      }
      const qr = enc(0, ecc);
      qr.addData(data, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 4;
      const total = n + quiet * 2;
      const unit = size / total;
      const rects = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!qr.isDark(r, c)) continue;
          rects.push(
            '<rect x="' + ((c + quiet) * unit).toFixed(3) + '" y="' + ((r + quiet) * unit).toFixed(3) +
            '" width="' + unit.toFixed(3) + '" height="' + unit.toFixed(3) + '"/>'
          );
        }
      }
      const attrs =
        ' data-qr-version="' + ((n - 17) / 4) + '" data-qr-modules="' + n +
        '" data-qr-ecc="' + ecc + '" data-qr-quiet="' + quiet + '" data-qr-unit="' + unit.toFixed(6) +
        '" data-qr-payload-len="' + data.length + '"';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + escapeHtml(t('contact.mineQr')) + '"' + attrs + '>' +
        '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
        '<g fill="#111">' + rects.join('') + '</g></svg>';
    } catch {
      return '';
    }
  }

  /** 组合键 → 规范串（Ctrl+Alt+Shift+Meta+K）；只按了修饰键返回 null */
  function comboFromEvent(ev) {
    const raw = String(ev.key || '');
    if (raw === 'Control' || raw === 'Alt' || raw === 'Shift' || raw === 'Meta') return null;
    if (!raw) return null;
    let k = raw;
    if (raw === ' ') k = 'Space';
    else if (raw === 'Esc') k = 'Escape';
    else if (raw.length === 1) k = raw.toUpperCase();
    const mods = [];
    if (ev.ctrlKey) mods.push('Ctrl');
    if (ev.altKey) mods.push('Alt');
    if (ev.shiftKey) mods.push('Shift');
    if (ev.metaKey) mods.push('Meta');
    return { combo: mods.concat([k]).join('+'), key: k, mods, usable: mods.length > 0 || /^F([1-9]|1[0-2])$/.test(k) };
  }

  /**
   * 可绑定的动作：**只列真的接上了动作的**（跑不通的宁可不给绑，不要让用户绑了没反应）。
   * def = 预置的少数常用键；空串 = 默认留空，由用户自己设。
   */
  const SHORTCUT_ACTIONS = [
    { id: 'toggleSidebar', def: 'Ctrl+B', run: () => { const b = $('app-body'); if (b) b.classList.toggle('hide-list'); } },
    { id: 'openSettings', def: 'Ctrl+,', run: () => setNav('settings') },
    { id: 'newSession', def: 'Ctrl+N', run: () => { const b = primaryAddButton(); if (b) b.click(); } },
    { id: 'focusSearch', def: 'Ctrl+F', run: () => { const i = $('list-search'); if (i) { i.focus(); i.select(); } } },
    { id: 'focusInput', def: '', run: () => { const i = $('input'); if (i) i.focus(); } },
    { id: 'toggleConsole', def: '', run: () => { const b = $('diag-toggle') || $('btn-console'); if (b) b.click(); } },
    { id: 'stopAll', def: '', run: () => { const b = $('btn-stop-all'); if (b) b.click(); } },
    { id: 'openMe', def: '', run: () => setNav('me') },
    { id: 'openContacts', def: '', run: () => setNav('externalChat') },
  ];

  /** 当前页面的「新建」入口（实例页/项目页/群聊页/联系人页各不相同） */
  function primaryAddButton() {
    const b = $('list-action');
    if (b && !b.classList.contains('hidden')) return b;
    const j = $('btn-join-qr');
    if (j && !j.classList.contains('hidden')) return j;
    return null;
  }

  /** 给菜单用的快捷键文案（空则返回空串） */
  function SHORTCUT_LABEL(id) {
    try {
      const b = shortcutBinding(id);
      return b ? `(${b})` : '';
    } catch {
      return '';
    }
  }

  function shortcutActionById(id) {
    return SHORTCUT_ACTIONS.filter((a) => a.id === id)[0] || null;
  }

  /** 生效的按键：用户存过就用用户的（空串 = 显式解绑，不回落到预置值） */
  function shortcutBinding(id) {
    const s = state.shortcuts || {};
    if (Object.prototype.hasOwnProperty.call(s, id)) return String(s[id] || '');
    const a = shortcutActionById(id);
    return (a && a.def) || '';
  }

  /** 持久化：走既有 settings 通道（settings-store 落盘），不新开存储文件 */
  function saveShortcuts() {
    try {
      window.warmy.settingsSave({ shortcuts: state.shortcuts || {} });
    } catch {
      /* 保存失败不影响本次界面 */
    }
  }

  let shortcutCapturing = null;

  function shortcutMsg(text) {
    const yuanSu = $('hk-keys-msg');
    if (yuanSu) yuanSu.textContent = text || '';
  }

  function stopShortcutCapture() {
    const cur = shortcutCapturing;
    shortcutCapturing = null;
    if (cur && cur.btn) cur.btn.classList.remove('listening', 'invalid');
  }

  function startShortcutCapture(id, btn) {
    if (!btn) return;
    stopShortcutCapture();
    shortcutCapturing = { id, btn };
    btn.classList.remove('invalid', 'unbound');
    btn.classList.add('listening');
    btn.textContent = t('settings.hotkey.press');
    shortcutMsg(t('settings.hotkey.keyHint'));
  }

  /** 录制期：捕获阶段先吃掉按键，别让它触发别的快捷键/菜单 */
  document.addEventListener(
    'keydown',
    (e) => {
      if (!shortcutCapturing) return;
      e.preventDefault();
      e.stopPropagation();
      const id = shortcutCapturing.id;
      const btn = shortcutCapturing.btn;
      if (e.key === 'Escape') {
        stopShortcutCapture();
        renderShortcuts();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        state.shortcuts[id] = '';
        saveShortcuts();
        stopShortcutCapture();
        renderShortcuts();
        shortcutMsg(t('settings.hotkey.saved'));
        return;
      }
      const c = comboFromEvent(e);
      if (!c) return; // 只按了修饰键：继续等
      if (!c.usable) {
        btn.classList.add('invalid');
        btn.textContent = t('settings.hotkey.invalid');
        return;
      }
      state.shortcuts[id] = c.combo;
      saveShortcuts();
      stopShortcutCapture();
      renderShortcuts();
      shortcutMsg(t('settings.hotkey.saved') + ' · ' + t('settings.hotkey.act.' + id) + ' → ' + c.combo);
    },
    true
  );

  /** 派发：按下已绑定的组合键就执行它的动作 */
  document.addEventListener('keydown', (e) => {
    if (shortcutCapturing) return;
    const c = comboFromEvent(e);
    if (!c || !c.usable) return;
    const tgt = e.target;
    const typing =
      !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
    // 正在打字时不抢：只有带真修饰键（Ctrl/Alt/Meta）的组合才算快捷键
    if (typing && !(e.ctrlKey || e.altKey || e.metaKey)) return;
    for (const a of SHORTCUT_ACTIONS) {
      if (shortcutBinding(a.id) !== c.combo) continue;
      e.preventDefault();
      try {
        a.run();
      } catch {
        /* 单个动作异常不影响快捷键本身 */
      }
      break;
    }
  });

  function renderShortcuts() {
    const body = $('hk-keys-body');
    if (!body) return;
    body.innerHTML = SHORTCUT_ACTIONS.map((a) => {
      const bound = shortcutBinding(a.id);
      return (
        '<tr data-hk-row="' + a.id + '">' +
        '<td>' + escapeHtml(t('settings.hotkey.act.' + a.id)) + '</td>' +
        '<td><button type="button" class="hk-key' + (bound ? '' : ' unbound') + '" data-hk="' + a.id + '" title="' +
        escapeHtml(t('settings.hotkey.keyHint')) + '">' +
        escapeHtml(bound || t('settings.hotkey.unbound')) + '</button></td>' +
        '<td class="hk-keys-desc">' + escapeHtml(t('settings.hotkey.actDesc.' + a.id)) + '</td>' +
        '</tr>'
      );
    }).join('');
    body.querySelectorAll('[data-hk]').forEach((btn) => {
      btn.onclick = () => startShortcutCapture(btn.dataset.hk, btn);
    });
  }

  /* ── 给其他智能体的接口目录 ──
     目录来自 window.warmy 的**真实方法表**（键名即操作名），一个都不多、不硬编码清单；
     通道名与形参从桥函数的源码里解析（ipcRenderer.invoke('warmy:xxx', a, b)），解析不到就留空。 */

  const API_GROUP_RULES = [
    [/^(chatSend|chatLog|chatLogRestore|searchMessages|exportSession|saveText|openChatWindow|setInsertMode|getInsertMode|getChatQuery)$/, 'chat'],
    [/^(group|board)/, 'group'],
    [/^(joinRequest|joinPending|joinRespond|inviteCreate|blacklist)/, 'invite'],
    [/^identity/, 'identity'],
    [/^membership/, 'membership'],
    [/^(net|mesh|peers|sync|lan|nodes)/, 'net'],
    [/^(knowledge|kb|memory)/, 'knowledge'],
    [/^(metrics|cost|audit)/, 'metrics'],
    [/^skills?/, 'skill'],
    [/^(smtp|email)/, 'smtp'],
    [/^checkpoint/, 'checkpoint'],
    [/^(executors|executor)/, 'executor'],
    [/^assets/, 'asset'],
    [/^(security|approval|requestApproval|plugin|secureKey|repoGuard)/, 'security'],
    [/^(settings|profile|specialModels|roleModels|importOpenclaw|exportAllowlist|setup|lastError|clearError|i18n|localeInfo|theme|hardware|state)/, 'settings'],
    [/^(win|tray|registerHotkey|platformInfo|appInfo|checkUpdate|autoUpdate|updateSource|asr|voice|webgpu|pick|request)/, 'window'],
    [/^lease/, 'repo'],
    [/^(archived|archive|cleanup)/, 'archive'],
  ];

  function apiGroupOf(name) {
    for (let i = 0; i < API_GROUP_RULES.length; i++) {
      if (API_GROUP_RULES[i][0].test(name)) return API_GROUP_RULES[i][1];
    }
    return 'other';
  }

  /** 从桥函数源码里取 IPC 通道与形参；取不到就留空（不猜） */
  function apiFaceOf(fn) {
    const out = { channel: '', params: '' };
    let src = '';
    try {
      src = String(fn);
    } catch {
      return out;
    }
    const ch = src.match(/['"](warmy:[a-z0-9-]+)['"]/i);
    if (ch) out.channel = ch[1];
    const ps = src.match(/^\s*(?:async\s+)?(?:function\s*)?\(?\s*([^)=]*?)\s*\)?\s*=>/);
    if (ps && ps[1]) out.params = ps[1].replace(/\s+/g, ' ').trim();
    return out;
  }


  /**
   * window.warmy API 形参表（preload 白名单的**产品文档**，与实现一致）。
   * 目录页用它展示形参；只读类操作可「试运行」。
   */
  const WARMY_API_SIGNATURES = {
    hardware: '()',
    listInstances: '()',
    spawnInstance: '(cfg: {id,name,dutyEligible?})',
    stopInstance: '(id: string)',
    securityMode: '()',
    setSecurityMode: "(mode: 'full'|'normal'|'strict')",
    memoryRecall: '(q: string | {query,limit?,scope?})',
    memoryAppend: '(body: string)',
    memoryRetrieve: '(payload: {seq?, recordId?})',
    memoryStatus: '()',
    memoryRebuild: '()',
    i18n: "(locale: string)",
    localeInfo: '()',
    setThemeSource: "(s: 'system'|'dark'|'light')",
    themeInfo: '()',
    listModels: '(cfg: {protocol,baseURL?,apiKey?})',
    pickSound: '()',
    checkUpdate: '()',
    pickFile: '()',
    groupCreate: '(cfg: {name,type?,directedMode?,devEnv?,directory?})',
    groupList: '()',
    updateSourceGet: '()',
    updateSourceSet: '(payload: {url: string})',
    groupMessage: '(msg: {groupId,content,urgency?,userId?})',
    groupJoinInstance: '(groupId, instanceId)',
    boardTasks: '(groupId?: string)',
    boardEvents: '()',
    boardAggregate: '()',
    setProvider: '(cfg: {presetId,apiKey?,baseURL?,model?})',
    getProvider: '()',
    chatSend: '(msg: {sessionId,content,urgency?,attachments?})',
    checkpointCreate: '(phase?: string)',
    checkpointList: '()',
    checkpointRollback: '(id: string)',
    knowledgeQuery: '(q: string)',
    knowledgeAddEvent: '(ev: {title,body?,groupId?})',
    setInsertMode: "(sessionId, mode)",
    getInsertMode: '(sessionId)',
    metricsSummary: '()',
    metricsTurns: '()',
    metricsTools: '()',
    chatLog: '(payload: {sessionId,mode?,limit?})',
    chatLogRestore: '()',
    settingsGet: '()',
    settingsSave: '(partial: Partial<AppSettings>)',
    containerProbe: '(opts?: {force?: boolean})',
    containerAction: '(payload: {id,action:"start"|"stop"})',
    containerShell: '(payload: {runtimeId,action:"open"|"write"|"close"|"status",sessionId?,data?})',
    projectState: '(payload: {sessionId})',
    projectEnable: '(payload: {sessionId})',
    projectDisable: '(payload: {sessionId})',
    projectSetContainer: '(payload: {sessionId,runtimeId})',
    projectFiles: '(payload: {sessionId})',
    projectEnvStatus: '(payload: {sessionId})',
    projectEnvSolidify: '(payload: {sessionId,explicit?,beforeDestroy?})',
    projectEnvRollback: '(payload: {sessionId,imageRef?})',
    projectExec: '(payload: {sessionId,cmd: enum})',
    projectLedger: '(payload: {sessionId,limit?})',
    projectSetDirectory: '(payload: {sessionId})',
    projectFsGuard: '(payload: {sessionId,op:"status"|"lock"|"unlock"})',
    productRun: '(payload: {sessionId})',
    uiQueuesGet: '()',
    uiQueuesSet: '(queues: Record<chatId, item[]>)',
    routerQueuesGet: '()',
    profileGet: '()',
    appInfo: '()',
    skillsList: '()',
    skillsRemove: '(id: string)',
    skillsImport: '()',
    skillsPaths: '()',
    skillsScanDirsGet: '()',
    skillsScanDirsSet: '(dirs: string[] /* max 10, deduped */)',
    skillsSetEnabled: '(payload: {id,enabled:boolean})',
    projectMemoryGet: '(payload: {sessionId})',
    projectMemorySet: '(payload: {sessionId,memory: string})',
    aiQuestionOpen: '(payload: {groupId,title,body?,options[]})',
    aiQuestionList: '(groupId?: string)',
    aiQuestionAnswer: '(payload: {id,optionId,customText?})',
    identityInfo: '()',
    identityPeers: '()',
    membershipList: '(payload?: {groupId?})',
    meshEnable: '(payload: {port?: number})',
    meshDisable: '()',
    netStatus: '()',
    netPortCandidates: '(payload: {requestedPort?,want?})',
    peersList: '()',
    peersAdd: '(p: {host,port,name?})',
    inviteCreate: '(groupId: string)',
    executorsStatus: '()',
    executorsRunBrief: '(payload: {brief,contextItems?,executorIds?})',
    stateLoad: '()',
    stateSave: '(s: object)',
    lastError: '()',
    clearError: '()',
    setupState: '()',
    setupComplete: '(payload: {locale?})',
    searchMessages: '(q: string)',
    archiveList: '(groupId?: string)',
    archiveExternal: '(payload: {groupId,title,summary,anchors?})',
    cleanupRun: '(opts?: {checkpoints?: number})',
    boardSession: '(groupId: string)',
    groupMembers: '(groupId: string)',
    smtpList: '()',
    lanStatus: '()',
    meshStatus: '()',
    platformInfo: '()',
    costSummary: '()',
  };

  /** 可「试运行」的只读接口（不改系统状态；缺失参数时用最小合法样例） */
  const WARMY_API_READONLY = new Set([
    'hardware', 'listInstances', 'securityMode', 'memoryStatus', 'localeInfo', 'themeInfo',
    'groupList', 'updateSourceGet', 'boardTasks', 'boardEvents', 'boardAggregate',
    'getProvider', 'checkpointList', 'knowledgeQuery', 'metricsSummary', 'metricsTurns',
    'metricsTools', 'chatLogRestore', 'settingsGet', 'containerProbe', 'projectState',
    'projectFiles', 'projectEnvStatus', 'projectLedger', 'uiQueuesGet', 'routerQueuesGet',
    'profileGet', 'appInfo', 'skillsList', 'skillsPaths', 'skillsScanDirsGet',
    'projectMemoryGet', 'aiQuestionList', 'identityInfo', 'identityPeers', 'membershipList',
    'netStatus', 'netPortCandidates', 'peersList', 'executorsStatus', 'stateLoad',
    'lastError', 'setupState', 'searchMessages', 'archiveList', 'boardSession',
    'groupMembers', 'smtpList', 'lanStatus', 'meshStatus', 'platformInfo', 'costSummary',
    'memoryRecall', 'i18n',
  ]);

  function warmySampleArgs(name, qiaoJie) {
    switch (name) {
      case 'memoryRecall':
        return ['warmy'];
      case 'i18n':
        return [state.locale || 'zh-CN'];
      case 'boardTasks':
      case 'archiveList':
        return state.selectedChat ? [state.selectedChat.id] : [];
      case 'boardSession':
      case 'groupMembers':
      case 'projectState':
      case 'projectFiles':
      case 'projectEnvStatus':
      case 'projectLedger':
      case 'projectMemoryGet':
        return state.selectedChat ? [{ sessionId: state.selectedChat.id }] : [];
      case 'aiQuestionList':
        return state.selectedChat ? [state.selectedChat.id] : [];
      case 'knowledgeQuery':
        return ['WArmy'];
      case 'searchMessages':
        return ['测试'];
      case 'containerProbe':
        return [{ force: false }];
      case 'netPortCandidates':
        return [{ requestedPort: 59599 }];
      case 'membershipList':
        return [];
      default:
        return [];
    }
  }

  async function tryRunWarmyApi(name) {
    const qiaoJie = window.warmy;
    if (!qiaoJie || typeof qiaoJie[name] !== 'function') return { ok: false, error: 'missing-api' };
    if (!WARMY_API_READONLY.has(name)) {
      return { ok: false, error: t('settings.hotkey.apiTryReadOnly') || 'read-only only' };
    }
    const args = warmySampleArgs(name, qiaoJie);
    try {
      const r = await qiaoJie[name](...args);
      return { ok: true, args, result: r };
    } catch (e) {
      return { ok: false, args, error: String(e && e.message || e) };
    }
  }

  /** API 中文说明（与 docs/API-OPERATIONS.md 同步） */
  const WARMY_API_DOC_ZH = {
    hardware: '读本机 CPU/内存，给出建议最大牛马数',
    listInstances: '列出本机牛马实例',
    spawnInstance: '启动一个牛马实例',
    stopInstance: '停止指定实例',
    securityMode: '读全局安全模式',
    setSecurityMode: '写全局安全模式',
    memoryRecall: '记忆检索（关键词/语义卡片）',
    memoryAppend: '写入一条记忆',
    memoryRetrieve: '按 seq/recordId 取回原文',
    memoryStatus: '记忆服务就绪状态与数据目录',
    memoryRebuild: '从 JSONL 重建 SQLite 投影',
    i18n: '加载指定语言包',
    localeInfo: '系统语言与已支持语言列表',
    setThemeSource: '设置主题（system/dark/light）',
    themeInfo: '读当前主题',
    listModels: '按供应商拉取模型列表',
    pickSound: '选择提示音文件',
    checkUpdate: '检查更新（GitHub/自定义源）',
    groupCreate: '创建项目/群聊',
    groupList: '列出全部项目/群聊',
    updateSourceGet: '读更新源配置',
    updateSourceSet: '写更新源 URL',
    groupMessage: '向群发一条消息',
    groupOrchestrate: '值班编排闭环入口',
    groupMembers: '读群成员',
    boardTasks: '读某群看板任务',
    boardEvents: '读看板事件尾部',
    boardAggregate: '按群聚合看板进展',
    setProvider: '设置模型供应商',
    getProvider: '读当前供应商配置',
    chatSend: '发送聊天消息',
    chatLog: '读/写会话日志',
    chatLogRestore: '从记忆 JSONL 恢复会话日志',
    checkpointCreate: '创建回退点',
    checkpointList: '列出回退点',
    checkpointRollback: '回滚到指定点',
    knowledgeQuery: '检索知识库',
    knowledgeAddEvent: '向知识库添加事件',
    metricsSummary: '指标汇总',
    metricsTurns: '轮次指标',
    metricsTools: '工具调用指标',
    settingsGet: '读设置',
    settingsSave: '合并保存设置',
    containerProbe: '探测本机容器运行时',
    containerAction: '启动/停止容器引擎',
    containerShell: '容器内 shell（open/write/close/status）',
    projectState: '项目可用性状态',
    projectEnable: '启用项目',
    projectDisable: '停用项目',
    projectSetContainer: '切换项目容器运行时',
    projectFiles: '项目文件/产物面板数据',
    projectEnvStatus: '项目环境固化状态',
    projectEnvSolidify: '固化当前容器环境',
    projectEnvRollback: '回滚到固化镜像',
    projectLedger: '项目文件访问台账',
    projectMemoryGet: '读项目 MEMORY',
    projectMemorySet: '写项目 MEMORY（read-back）',
    aiQuestionOpen: '发起 AI 决策选项卡',
    aiQuestionList: '列出决策卡',
    aiQuestionAnswer: '回答决策卡（含自定义）',
    skillsList: '列出技能',
    skillsScanDirsGet: '读自动发现目录',
    skillsScanDirsSet: '写自动发现目录（≤10，去重）',
    uiQueuesGet: '读 UI 待执行队列',
    uiQueuesSet: '写 UI 待执行队列',
    routerQueuesGet: '读 Router 队列快照',
    identityInfo: '本机身份信息',
    netStatus: '组网状态',
    netPortCandidates: '实测候选端口',
    meshEnable: '启用组网',
    meshDisable: '关闭组网',
    executorsStatus: '执行者状态',
    setupState: '首次启动 setupDone',
    searchMessages: '搜索历史消息',
    archiveList: '列归档',
    archiveExternal: '归档并提炼知识/偏好',
    platformInfo: '平台信息',
    costSummary: '成本汇总',
    exportSession: '导出会话 Markdown',
  };
  function apiCatalogue() {
    const qiaoJie = (typeof window !== 'undefined' && window.warmy) || null;
    const rows = [];
    const events = [];
    if (!qiaoJie) return { rows, events, available: false };
    Object.keys(qiaoJie).sort().forEach((name) => {
      let fn = null;
      try {
        fn = qiaoJie[name];
      } catch {
        fn = null;
      }
      if (typeof fn !== 'function') return;
      if (/^on[A-Z]/.test(name)) {
        events.push(name); // 事件订阅：主进程 → 渲染层，不是可调用操作
        return;
      }
      const face = apiFaceOf(fn);
      const params = WARMY_API_SIGNATURES[name] || face.params || '()';
      const channel = face.channel || `warmy:${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
      rows.push({ name, group: apiGroupOf(name), channel, params, readonly: WARMY_API_READONLY.has(name) });
    });
    return { rows, events, available: true };
  }

  const API_GROUP_ORDER = [
    'chat', 'group', 'board', 'identity', 'membership', 'net', 'invite', 'knowledge',
    'metrics', 'skill', 'smtp', 'checkpoint', 'executor', 'asset', 'security',
    'settings', 'window', 'repo', 'archive', 'other',
  ];

  function renderApiCatalogue() {
    const box = $('hk-api-body');
    if (!box) return;
    const cat = apiCatalogue();
    const cnt = $('hk-api-count');
    if (cnt) cnt.textContent = fmtKey('settings.hotkey.apiCount', { n: cat.rows.length });
    const ev = $('hk-api-events');
    if (ev) ev.textContent = cat.events.length ? t('settings.hotkey.apiEvents') + ' ' + cat.events.join(', ') : '';
    if (!cat.available || !cat.rows.length) {
      box.innerHTML = '<div class="muted">' + escapeHtml(t('settings.hotkey.apiUnavailable')) + '</div>';
      return;
    }
    const q = ((($('hk-api-filter') || {}).value) || '').trim().toLowerCase();
    const hits = q ? cat.rows.filter((r) => r.name.toLowerCase().indexOf(q) >= 0) : cat.rows;
    const head =
      '<thead><tr><th>' + escapeHtml(t('settings.hotkey.apiColOp')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColChannel')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColParams')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColDesc')) + '</th></tr></thead>';
    let html = '';
    API_GROUP_ORDER.forEach((g) => {
      const list = hits.filter((r) => r.group === g);
      if (!list.length) return;
      html +=
        '<div class="hk-group-title">' + escapeHtml(t('settings.hotkey.group.' + g)) + ' · ' + list.length + '</div>' +
        '<table class="hk-api">' + head + '<tbody>' +
        list
          .map((r) => {
            const k = 'settings.hotkey.api.' + r.name;
            const desc = state.t[k] ? t(k) : (WARMY_API_DOC_ZH[r.name] || '');
            return (
              '<tr data-api-op="' + escapeHtml(r.name) + '">' +
              '<td class="hk-op">' + escapeHtml(r.name) + '</td>' +
              '<td class="hk-ch">' + escapeHtml(r.channel || '—') + '</td>' +
              '<td class="hk-pa"><code>' + escapeHtml(r.params || '()') + '</code></td>' +
              '<td class="hk-desc' + (desc ? '' : ' none') + '">' + escapeHtml(desc || t('settings.hotkey.apiNoDesc')) + '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table>';
    });
    box.innerHTML = html || '<div class="muted">' + escapeHtml(t('settings.hotkey.apiEmpty')) + '</div>';
  }

  function bindHotkeySection() {
    const copyBtn = $('btn-copy-api-ops');
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.onclick = async () => {
        const xiangDuiLu = 'docs/API-OPERATIONS.md';
        const abs = (window.warmy && window.warmy.__repoApiDoc) || xiangDuiLu;
        const text =
          t('settings.hotkey.apiCopyText') ||
          ('How to operate WArmy APIs: open the file `docs/API-OPERATIONS.md` in the project root (or absolute path if provided). Read it before calling window.warmy.* / IPC.');
        const payload = text + '\n\n' + abs + '\n\n' + xiangDuiLu;
        try {
          await navigator.clipboard.writeText(payload);
          const msg = $('api-copy-msg');
          if (msg) msg.textContent = t('settings.hotkey.apiCopied') || 'Copied';
        } catch {
          uiAlert(payload, t('settings.hotkey.apiCopyOps') || 'API guide');
        }
      };
    }
    renderApiCatalogue();
    renderShortcuts();
    shortcutMsg('');
    const f = $('hk-api-filter');
    if (f && f.dataset.bound !== '1') {
      f.dataset.bound = '1';
      f.addEventListener('input', () => renderApiCatalogue());
    }
  }


  // ── 右键菜单 ──
  // ── 3 权限审批：与决策卡同一通知区视觉整合 ──
  function showApprovalDialog(payload) {
    return new Promise((resolve) => {
      const wanCheng = async (allowed, scope) => {
        const host = $('approval-host');
        if (host) host.innerHTML = '';
        $('modal-root')?.classList.add('hidden');
        resolve({ allowed, scope });
      };
      // 通知区内联卡片（与 aiq-card 同构）
      const host = $('approval-host');
      if (host) {
        host.innerHTML = `<div class="approval-card" data-approval="1">
          <div class="aiq-title">${escapeHtml(t('approval.title') || '')} · ${escapeHtml(payload.action || '')}</div>
          <div class="muted">${escapeHtml(t('approval.hint') || '')}</div>
          <div class="aiq-opts">
            <button class="btn-mini" data-ap="deny">${escapeHtml(t('approval.deny'))}</button>
            <button class="btn-primary" data-ap="once">${escapeHtml(t('approval.once'))}</button>
            <button class="btn-mini" data-ap="project">${escapeHtml(t('approval.project'))}</button>
            <button class="btn-mini" data-ap="global">${escapeHtml(t('approval.global'))}</button>
          </div>
        </div>`;
        host.querySelectorAll('[data-ap]').forEach((b) => {
          b.onclick = () => {
            const k = b.getAttribute('data-ap');
            if (k === 'once') void wanCheng(true, 'once');
            else if (k === 'project') void wanCheng(true, 'project');
            else if (k === 'global') void wanCheng(true, 'global');
            else void wanCheng(false, 'deny');
          };
        });
      }
      // 兼容：仍用 modal 作为兜底（通知区不在当前视图时）
      const root = $('modal-root');
      $('modal-title').textContent = t('approval.title');
      $('modal-body').innerHTML =
        '<div style="margin-bottom:8px">' + escapeHtml(payload.action || '') + '</div>' +
        '<div class="muted">' + t('approval.hint') + '</div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const zao = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = async () => {
          root.classList.add('hidden');
          await fn();
        };
        acts.appendChild(b);
      };
      zao(t('approval.deny'), 'btn-mini', () => wanCheng(false, 'deny'));
      zao(t('approval.once'), 'btn-primary', () => wanCheng(true, 'once'));
      zao(t('approval.project'), 'btn-mini', () => wanCheng(true, 'project'));
      zao(t('approval.global'), 'btn-mini', () => wanCheng(true, 'global'));
      root.classList.remove('hidden');
    });
  }
  window.warmy.onApprovalRequest?.(async (d) => {
    const r = await showApprovalDialog(d);
    await window.warmy.approvalRespond(d.id, r.allowed, r.scope);
  });

  function openContextMenu(x, y, items) {
    closeContextMenu();
    const yuanSu = document.createElement('div');
    yuanSu.className = 'ctx-menu';
    yuanSu.id = 'ctx-menu';
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'ctx-sep';
        yuanSu.appendChild(s);
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
      yuanSu.appendChild(b);
    });
    yuanSu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    yuanSu.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    document.body.appendChild(yuanSu);
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

  function agentMenu(inst, hangYuanSu) {
    const running = inst.status === 'running';
    const blocked = running || sessionHasBlockingTasks(inst.id);
    const rect = hangYuanSu.getBoundingClientRect();
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
            await window.warmy.stopInstance(inst.id);
            inst.status = 'stopped';
          } else {
            try {
              await window.warmy.spawnInstance({ id: inst.id, name: inst.name, dutyEligible: true });
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
          await window.warmy.archivedAdd({ id: inst.id, name: inst.name, kind: 'agent' }).catch(() => {});
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

  async function qunCaidan(g, hangYuanSu) {
    const blocked = sessionHasBlockingTasks(g.id);
    const yiJiaRu = !g.joinedByOther;
    /**
     * ADR 004 第七批：「启用/停用项目」与「切换容器…」都在**项目的右键菜单**里。
     * 前者任何项目都有（与容器无关）；后者只有"创建时选了容器开发的项目"才有。
     */
    const projectItems = g.type === 'internal' ? await projectMenuItems(g) : [];
    void hangYuanSu;
    return projectItems.concat([
      {
        label: t('ctx.rename'),
        onClick: async () => {
          const name = await uiPrompt(t('ctx.renamePrompt'), g.name);
          if (!name) return;
          g.name = name;
          renderList();
        },
      },
      yiJiaRu
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
            label: t('ctx.leave'),
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
    ].filter(Boolean));
  }

  function bindRowContext(hangYuanSu, getItems) {
    hangYuanSu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 菜单构造可以是 async（例如"只有容器开发项目才有切换容器"要先读设置）：
      // 先把坐标固定下来，再等构造完成才弹菜单，避免异步期间鼠标已经移走。
      const x = e.clientX;
      const y = e.clientY;
      Promise.resolve()
        .then(() => getItems())
        .then((items) => openContextMenu(x, y, items || []))
        .catch(() => { /* 菜单构造失败就不弹，不抛到控制台 */ });
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
    const r = await window.warmy.joinPending().catch(() => null);
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
      const zao = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = async () => { root.classList.add('hidden'); await fn(); };
        acts.appendChild(b);
      };
      zao(t('join.reject'), 'btn-mini', () => resolve('reject'));
      zao(t('join.blacklist'), 'btn-danger', () => resolve('block'));
      zao(t('join.agree'), 'btn-primary', () => resolve('agree'));
      root.classList.remove('hidden');
    });
  }

  document.querySelectorAll('[data-nav="instances"]').forEach((yuanSu) => {
    yuanSu.addEventListener('click', async () => {
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

  // ── 进度 / 等待协助 折叠 ──
  function fmtWhen(ts) {
    try {
      if (!ts) return '—';
      return new Date(ts).toLocaleString();
    } catch { return '—'; }
  }

  $('progress-toggle')?.addEventListener('click', () => {
    $('progress-toggle')?.classList.toggle('open');
    const list = $('task-list');
    list?.classList.toggle('hidden');
    if (list && !list.classList.contains('hidden')) {
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
  });

  $('assist-toggle')?.addEventListener('click', () => {
    $('assist-toggle')?.classList.toggle('open');
    const list = $('assist-list');
    list?.classList.toggle('hidden');
    if (list && !list.classList.contains('hidden')) {
      void renderAssistList({ scrollBottom: true });
    }
  });

  /**
   * 等待协助：AI 运行中需要人处理的事。
   * open=黄点 · urgent open=红点 · done=绿勾 · stale=灰+删除线（不删除）
   * 排序：红垫底（当最新）→ 其余按时间正序（越下越新）；展开默认滚到底。
   */
  async function renderAssistList(opts) {
    const list = $('assist-list');
    const badge = $('assist-badge');
    if (!list) return;
    let items = [];
    try {
      const r = await window.warmy.assistList?.(state.selectedChat?.id);
      items = (r && r.items) || [];
    } catch { items = []; }

    const openN = items.filter((x) => x.status === 'open').length;
    const urgentN = items.filter((x) => x.status === 'open' && x.priority === 'urgent').length;
    if (badge) {
      if (urgentN > 0) {
        badge.className = 'assist-badge urgent';
        badge.classList.remove('hidden');
        badge.hidden = false;
      } else if (openN > 0) {
        badge.className = 'assist-badge open';
        badge.classList.remove('hidden');
        badge.hidden = false;
      } else {
        badge.className = 'assist-badge hidden';
        badge.hidden = true;
      }
    }

    const rank = (x) => {
      if (x.status === 'open' && x.priority === 'urgent') return 3;
      if (x.status === 'open') return 2;
      if (x.status === 'done') return 1;
      return 0;
    };
    items = items.slice().sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (!items.length) {
      list.innerHTML = '<li class="task-empty muted">' + escapeHtml(t('panel.assist.empty') || '—') + '</li>';
      return;
    }
    list.innerHTML = items.map((it) => {
      const st = String(it.status || 'open');
      const pri = String(it.priority || 'normal');
      let mark = '<span class="assist-dot open"></span>';
      let cls = 'assist-row';
      if (st === 'done') { mark = '<span class="assist-dot done" title="' + escapeHtml(t('panel.assist.done') || '') + '">✓</span>'; cls += ' is-done'; }
      else if (st === 'stale') { mark = '<span class="assist-dot none"></span>'; cls += ' is-stale'; }
      else if (pri === 'urgent') { mark = '<span class="assist-dot urgent" title="' + escapeHtml(t('panel.assist.urgent') || '') + '"></span>'; cls += ' is-urgent'; }
      return (
        '<li class="' + cls + '" data-assist-id="' + escapeHtml(String(it.id)) + '">' +
        mark +
        '<div class="assist-body">' +
        '<div class="assist-title">' + escapeHtml(String(it.title || '')) + '</div>' +
        (it.body ? '<div class="assist-desc muted">' + escapeHtml(String(it.body).slice(0, 120)) + '</div>' : '') +
        '<div class="assist-time muted">' + escapeHtml(fmtWhen(it.createdAt)) +
        (it.updatedAt && it.updatedAt !== it.createdAt ? ' · ' + escapeHtml(fmtWhen(it.updatedAt)) : '') +
        '</div></div>' +
        ((st === 'stale' || st === 'done') ? '' :
          '<div class="assist-actions">' +
          '<button type="button" class="btn-mini" data-assist-act="done" title="' + escapeHtml(t('panel.assist.markDone') || 'done') + '">✓</button>' +
          '<button type="button" class="btn-mini" data-assist-act="urgent" title="' + escapeHtml(t('panel.assist.markUrgent') || 'urgent') + '">!</button>' +
          '<button type="button" class="btn-mini" data-assist-act="stale" title="' + escapeHtml(t('panel.assist.markStale') || 'stale') + '">×</button>' +
          '</div>') +
        '</li>'
      );
    }).join('');

    list.querySelectorAll('[data-assist-act]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const row = b.closest('[data-assist-id]');
        const id = row && row.getAttribute('data-assist-id');
        if (!id) return;
        const act = b.getAttribute('data-assist-act');
        const payload = {
          id,
          sessionId: state.selectedChat?.id,
          title: row.querySelector('.assist-title')?.textContent || '',
        };
        if (act === 'done') { payload.status = 'done'; payload.priority = 'normal'; }
        else if (act === 'stale') { payload.status = 'stale'; payload.priority = 'normal'; }
        else if (act === 'urgent') { payload.status = 'open'; payload.priority = 'urgent'; }
        try { await window.warmy.assistUpsert?.(payload); } catch { /* noop */ }
        void renderAssistList({ scrollBottom: false });
      };
    });

    if (opts && opts.scrollBottom) {
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
  }
  window.__renderAssistList = renderAssistList;

  /**
   * 右栏「进度」= 真看板任务；限高滚动；每条带日期时间；越下越新。
   */
  function setProgressPct(pct) {
    const p = clampPercent(pct);
    const bar = $('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = $('progress-text');
    if (txt) txt.textContent = p + '%';
  }

  async function renderProgressTasks() {
    const list = $('task-list');
    if (!list) return;
    const sel = state.selectedChat;
    const shiQun = !!(sel && (sel.kind === 'internal' || sel.kind === 'extgroup' || sel.kind === 'single'));
    let tasks = [];
    const eventsByTitle = Object.create(null);
    if (shiQun) {
      try {
        const r = await window.warmy.boardTasks(sel.id);
        if (r && Array.isArray(r.tasks)) tasks = r.tasks;
      } catch {
        tasks = [];
      }
      try {
        const ev = await window.warmy.boardEvents(sel.id);
        const evs = (ev && ev.events) || [];
        for (const e of evs) {
          const key = String(e.title || '').replace(/\s*→\s*\d+%$/, '');
          if (!key) continue;
          if (!eventsByTitle[key] || (e.ts || 0) > eventsByTitle[key]) eventsByTitle[key] = e.ts || 0;
        }
      } catch { /* noop */ }
    }
    if (!tasks.length) {
      list.innerHTML = '<li class="task-empty">' + escapeHtml(t('panel.progressEmpty')) + '</li>';
      setProgressPct(0);
      return;
    }
    const DOT = { done: 'done', failed: 'fail', blocked: 'fail', doing: 'active', todo: '' };
    const rows = tasks.map((task, idx) => {
      const title = String((task && (task.title || task.name)) || '');
      const status = String((task && task.status) || '').toLowerCase();
      const ts = Number(task.updatedAt || task.ts || task.createdAt || eventsByTitle[title] || 0) || 0;
      return { task, title, status, ts, idx };
    });
    rows.sort((a, b) => (a.ts - b.ts) || (a.idx - b.idx));
    list.innerHTML = rows
      .map(({ task, title, status, ts }) => {
        const dot = DOT[status] !== undefined ? DOT[status] : '';
        const pct = task && task.progress != null ? clampPercent(task.progress) : null;
        return (
          '<li class="task-' + escapeHtml(status || 'todo') + '">' +
          '<span class="task-main">' + escapeHtml(title) +
          (pct === null ? '' : ' · ' + pct + '%') +
          '<span class="task-time muted">' + escapeHtml(fmtWhen(ts)) + '</span>' +
          '</span>' +
          '<span class="dot ' + dot + '"></span>' +
          '</li>'
        );
      })
      .join('');
    const done = tasks.filter((x) => String((x && x.status) || '').toLowerCase() === 'done').length;
    setProgressPct(Math.round((done / tasks.length) * 100));
    if (!list.classList.contains('hidden')) {
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ADR 004：执行环境（容器）
     ---------------------------------------------------------------------------
     P1 = 设置 → 功能 → 容器：探测（12 候选、三态）+ 可操作状态列表 + 折叠安装说明；
     P2 = 「我的牛马」与「非容器项目」的「运行/测试在容器中」选项 + 未就绪**硬提示**；
     P3 = 创建项目时**必选**开发环境（本机 / 容器）+ 仅创建者可启停（部分，见报告）。

     三条不许违反的规矩：
       1) **绝不静默降级**：选了"容器中"而本机没有可用运行时 → 出提示 + 跳设置引导，
          **不会**退回本机执行（那会让用户以为在沙箱里跑、实际在主机跑）；
       2) **只驱动、不安装**：这里不会跑安装器、不提权、不下载；
       3) **"命令在" ≠ "可用"**：状态一律来自主进程真探测（三态 + 引擎报错/系统不适用单列），
          不在渲染层猜、也不拿"上次探测"当"现在的事实"。
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * 12 个候选运行时的官网四条链接（URL 与语言无关，所以**不进 i18n**；
   * 链接的**标题文案**才进 i18n：container.link.official / install / download / support）。
   * 顺序 = 安装说明的展示顺序：Podman 第一（许可最干净，ADR §3.4 结论）。
   */
  const CONTAINER_LINKS = {
    podman: { official: 'https://podman.io/', install: 'https://podman.io/docs/installation', download: 'https://podman-desktop.io/downloads', support: 'https://github.com/containers/podman/discussions' },
    docker: { official: 'https://www.docker.com/', install: 'https://docs.docker.com/engine/install/', download: 'https://www.docker.com/products/docker-desktop/', support: 'https://forums.docker.com/' },
    wsl: { official: 'https://learn.microsoft.com/windows/wsl/', install: 'https://learn.microsoft.com/windows/wsl/install', download: 'https://learn.microsoft.com/windows/wsl/install-manual', support: 'https://github.com/microsoft/WSL/issues' },
    nerdctl: { official: 'https://containerd.io/', install: 'https://github.com/containerd/nerdctl#install', download: 'https://github.com/containerd/nerdctl/releases', support: 'https://github.com/containerd/nerdctl/issues' },
    'rancher-desktop': { official: 'https://rancherdesktop.io/', install: 'https://docs.rancherdesktop.io/getting-started/installation/', download: 'https://github.com/rancher-sandbox/rancher-desktop/releases', support: 'https://github.com/rancher-sandbox/rancher-desktop/issues' },
    colima: { official: 'https://github.com/abiosoft/colima', install: 'https://github.com/abiosoft/colima#installation', download: 'https://github.com/abiosoft/colima/releases', support: 'https://github.com/abiosoft/colima/issues' },
    lima: { official: 'https://lima-vm.io/', install: 'https://lima-vm.io/docs/installation/', download: 'https://github.com/lima-vm/lima/releases', support: 'https://github.com/lima-vm/lima/issues' },
    'windows-sandbox': { official: 'https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/', install: 'https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install', download: 'https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install', support: 'https://answers.microsoft.com/' },
    'lxd-incus': { official: 'https://linuxcontainers.org/incus/', install: 'https://linuxcontainers.org/incus/docs/main/installing/', download: 'https://github.com/lxc/incus/releases', support: 'https://discuss.linuxcontainers.org/' },
    isulad: { official: 'https://gitee.com/openeuler/iSulad', install: 'https://docs.openeuler.org/', download: 'https://gitee.com/openeuler/iSulad/releases', support: 'https://gitee.com/openeuler/iSulad/issues' },
    pouch: { official: 'https://github.com/alibaba/pouch', install: 'https://github.com/alibaba/pouch/blob/master/INSTALL.md', download: 'https://github.com/alibaba/pouch/releases', support: 'https://github.com/alibaba/pouch/issues' },
    kata: { official: 'https://katacontainers.io/', install: 'https://github.com/kata-containers/kata-containers/blob/main/docs/install/README.md', download: 'https://github.com/kata-containers/kata-containers/releases', support: 'https://github.com/kata-containers/kata-containers/issues' },
  };
  /**
   * 安装说明的条目顺序 = **字母序（按运行时 id）**。
   * 产品要求：不做"推荐排序"，也不标注厂商/收费等营销信息，避免像广告。
   */
  const CONTAINER_GUIDE_ORDER = ['colima', 'docker', 'isulad', 'kata', 'lima', 'lxd-incus', 'nerdctl', 'podman', 'pouch', 'rancher-desktop', 'windows-sandbox', 'wsl'];
  /**
   * 「运行 / 预览目标」（第五批）——**与"构建/测试在哪"是两个维度**。
   * 容器是 Linux 的，提供不了 Windows / macOS 的图形界面：这是物理约束，不是"还没做"。
   * 每个目标都如实写清"界面在哪里预览"，免得用户以为容器能把 Windows 界面送出来。
   */
  const CONTAINER_LINK_KEYS = ['official', 'install', 'download', 'support'];

  /** 渲染层侧的执行环境状态（**事实来自主进程探测**，这里只缓存最近一次报告） */
  const containerUi = {
    report: null,
    probing: false,
    /** 过渡态：{ id, action, deadline } */
    pending: null,
    /** 从引导（右键菜单 / 项目状态里的"去装/启动容器"）跳到设置卡片时高亮它 */
    cameFromGuidance: false,
    /** 进行中的轮询计时器 */
    pollTimer: null,
    /**
     * 实例缓存：runtimeId → `warmy:container-instances` 的结果。
     * 引擎没启动时**不拉取也不展开**（灰），启动后才允许查看。
     */
    instances: {},
    /** 哪些运行时的实例区是展开的 */
    instOpen: {},
    /** 正在读实例 / 正在起停实例的 runtimeId */
    instBusy: {},
  };

  const containerEntry = (id) => ((containerUi.report && containerUi.report.runtimes) || []).find((x) => x.id === id) || null;
  const containerReadyIds = () => ((containerUi.report && containerUi.report.usableIds) || []).slice();

  /**
   * 容器项目的开发面状态。传入的 facts 由调用方从**主进程**取（`warmy:project-dev-state`）；
   * 只有主进程不可用（预览桩 / 老版本）时才走这里的兜底 —— 兜底**一律保守**：
   * 只要不是"明确就绪"，就当停止（宁可显示停止，也不乐观放开宿主侧编辑）。
   */
  const PROJECT_STOP_REASON = (code, reasonKey) =>
    'container.project.stopReason.' +
    ((reasonKey && String(reasonKey)) ||
      (code === 'stopped-by-creator' ? 'stoppedByCreator'
        : code === 'container-not-installed' ? 'notInstalled'
          : code === 'container-not-chosen' ? 'notChosen'
            : code === 'ok' ? 'ok' : 'containerDown'));

  /**
   * 「没有可用容器」时那句提示里的 reason：如实列**已经装了的**运行时现在是什么状态
   * （本机实测 = docker·未运行 / wsl·未运行），而不是一句空话。
   */
  function noReadyReason(rep) {
    if (!rep) return t('container.status.not-installed');
    const att = (rep.attentionIds || []).map((id) => ((rep.runtimes || []).find((x) => x.id === id))).filter(Boolean);
    if (att.length) {
      return att.map((e) => t('container.rt.' + e.id + '.name') + ' · ' + t('container.run.' + e.run)).join('；');
    }
    return t('container.status.not-installed');
  }

  /**
   * 最近一次启停结果的**原因 + 原始输出**（第十批：进程派生了 ≠ 成功）。
   * 文案两层：① 具体原因码（例如"安装不完整或未能启动"）；② 原始输出行（可核对）。
   * 都用 --ink-dim/--danger-fg 的次要样式，对比度 >= 3.0。
   */
  function containerActionErrorText(entry) {
    const a = entry && entry.action;
    if (!a || !a.result || a.result.ok) return '';
    const reasonCode = String(a.result.reasonCode || (a.result.kind === 'start' ? 'engine-start-failed' : 'engine-stop-failed'));
    const reasonKey = t('container.action.reason.' + reasonCode) === 'container.action.reason.' + reasonCode
      ? t('container.action.reason.' + (a.result.kind === 'start' ? 'engine-start-failed' : 'engine-stop-failed'))
      : t('container.action.reason.' + reasonCode);
    return fmtKey('container.action.failedLine', {
      verb: t(a.result.kind === 'start' ? 'container.action.startVerb' : 'container.action.stopVerb'),
      reason: reasonKey,
      out: String(a.result.output || ('exit=' + a.result.code)),
    });
  }

  function containerBadge(entry) {
    const map = {
      running: ['container.run.running', 'ok'],
      'not-running': ['container.run.notRunning', 'dim'],
      error: ['container.run.error', 'danger'],
      unsupported: ['container.run.unsupported', 'dim'],
    };
    const peiDui = map[entry.run] || ['container.run.notRunning', 'dim'];
    return '<span class="ctg-badge" data-run="' + escapeHtml(entry.run) + '" data-tone="' + peiDui[1] + '">' + escapeHtml(t(peiDui[0])) + '</span>';
  }

  function containerCapabilityText(entry) {
    if (!entry.capability || !entry.capability.runCommand) return t('container.cap.none');
    const parts = [];
    if (entry.capability.runCommand) parts.push(t('container.cap.run'));
    if (entry.capability.interactiveShell) parts.push(t('container.cap.shell'));
    if (entry.capability.mountHostDir) parts.push(t('container.cap.mount'));
    return parts.join(' · ');
  }

  /** 一级行：状态 + 名称 + 类别 + 版本 + 原因/证据 + 能力 + 启停按钮 */
  function containerRowHtml(entry) {
    const name = t('container.rt.' + entry.id + '.name');
    const kind = t('container.kind.' + (entry.engine && entry.engine.kind ? entry.engine.kind : 'container'));
    const action = entry.action || null;
    const pending = !!(action && action.pending) || !!(containerUi.pending && containerUi.pending.id === entry.id);
    const pendingKind = action && action.pending ? action.kind : (containerUi.pending && containerUi.pending.id === entry.id ? containerUi.pending.action : null);
    let buttons = '';
    if (entry.lifecycle && entry.lifecycle.startable && entry.run !== 'running') {
      buttons += '<button type="button" class="btn-mini" id="ctg-act-start-' + escapeHtml(entry.id) + '" data-ctg-act="start" data-ctg-id="' + escapeHtml(entry.id) + '"' + (pending ? ' disabled' : '') + '>' +
        escapeHtml(pending && pendingKind === 'start' ? t('container.action.starting') : t('container.action.start')) + '</button>';
    }
    if (entry.lifecycle && entry.lifecycle.stoppable && entry.run === 'running') {
      buttons += '<button type="button" class="btn-mini ctg-danger" id="ctg-act-stop-' + escapeHtml(entry.id) + '" data-ctg-act="stop" data-ctg-id="' + escapeHtml(entry.id) + '"' + (pending ? ' disabled' : '') + '>' +
        escapeHtml(pending && pendingKind === 'stop' ? t('container.action.stopping') : t('container.action.stop')) + '</button>';
    }
    const reasonNote = buttons ? '' :
      '<div class="ctg-dim ctg-reason" data-reason="' + escapeHtml(entry.lifecycle ? entry.lifecycle.reason : 'ok') + '">' +
      escapeHtml(fmtKey('container.action.noButtons', { reason: t('container.reason.' + (entry.lifecycle ? entry.lifecycle.reason : 'ok')) })) + '</div>';
    const transition = pending
      ? '<div class="ctg-dim ctg-pending" data-pending="' + escapeHtml(String(pendingKind || '')) + '">' +
        escapeHtml(fmtKey(pendingKind === 'stop' ? 'container.action.stopping' : 'container.action.waitingReady', { s: String(Math.round((entry.lifecycle && entry.lifecycle.waitMs ? entry.lifecycle.waitMs : 120000) / 1000)) })) + '</div>'
      : '';
    const errText = containerActionErrorText(entry);
    const errLine = errText ? '<div class="ctg-err" data-ctg-error="' + escapeHtml(entry.id) + '">' + escapeHtml(errText) + '</div>' : '';
    return '<div class="ctg-row" data-rt="' + escapeHtml(entry.id) + '" data-status="' + escapeHtml(entry.status) + '" data-run="' + escapeHtml(entry.run) + '"' +
      ' data-kind="' + escapeHtml(String(entry.engine && entry.engine.kind)) + '"' +
      ' data-startable="' + (entry.lifecycle && entry.lifecycle.startable ? '1' : '0') + '"' +
      ' data-stoppable="' + (entry.lifecycle && entry.lifecycle.stoppable ? '1' : '0') + '">' +
      '<div class="ctg-row-head">' +
      '<span class="ctg-name">' + escapeHtml(name) + '</span>' +
      containerBadge(entry) +
      '<span class="ctg-kind">' + escapeHtml(kind) + '</span>' +
      (entry.version ? '<span class="ctg-dim">' + escapeHtml(t('container.versionLabel')) + ' ' + escapeHtml(entry.version) + '</span>' : '') +
      '<span class="ctg-spacer"></span>' +
      buttons +
      '</div>' +
      '<div class="ctg-dim ctg-dateil" data-close="' + escapeHtml(entry.detail || '') + '">' +
      escapeHtml(t('container.detailLabel')) + '：' + escapeHtml(entry.detail || '') +
      (entry.evidence ? ' · ' + escapeHtml(String(entry.evidence).slice(0, 240)) : ' · ' + escapeHtml(t('container.evidenceNone'))) +
      '</div>' +
      '<div class="ctg-dim ctg-cap">' + escapeHtml(t('container.capLabel')) + '：' + escapeHtml(containerCapabilityText(entry)) + '</div>' +
      reasonNote + transition + errLine +
      containerInstancesHtml(entry) +
      '</div>';
  }

  /**
   * **实例**区（第十七批）：环境 = 具体实例。
   *
   * 规则（产品定稿）：
   *  · 引擎**没启动** ⇒ 整块禁用并置灰，点了也不发请求（没有守护进程时问了也是错的）；
   *  · 引擎启动了 ⇒ 可以展开，列出该引擎下**所有实例**，每个实例可单独启动/停止；
   *  · **创建实例**不替用户在引擎里造（各引擎造法不同、还要拉镜像），而是打开该容器产品
   *    自己的界面/控制台，让用户在那里自行创建；
   *  · 引擎没有稳定的实例列表命令 ⇒ 如实说"该产品没有可用的实例列表接口"，不给假列表。
   */
  function containerInstancesHtml(entry) {
    if (entry.status === 'not-installed' || entry.status === 'unsupported-platform') return '';
    const running = entry.run === 'running';
    const open = !!containerUi.instOpen[entry.id];
    const busy = !!containerUi.instBusy[entry.id];
    const data = containerUi.instances[entry.id];
    let body = '';
    if (open && running) {
      if (busy) body = '<div class="ctg-dim">' + escapeHtml(t('container.inst.loading')) + '</div>';
      else if (!data) body = '<div class="ctg-dim">' + escapeHtml(t('container.inst.empty')) + '</div>';
      else if (!data.supported) body = '<div class="ctg-dim" data-inst-unsupported="' + escapeHtml(String(data.reason || '')) + '">' + escapeHtml(fmtKey('container.inst.unsupported', { reason: String(data.reason || '') })) + '</div>';
      else if (!data.ok) body = '<div class="ctg-err" data-inst-error="' + escapeHtml(String(data.reason || 'command-failed')) + '">' + escapeHtml(fmtKey('container.inst.listFailed', { err: String(data.evidence || data.reason || '') })) + '</div>';
      else if (!data.instances.length) body = '<div class="ctg-dim" data-inst-count="0">' + escapeHtml(t('container.inst.none')) + '</div>';
      else {
        body = data.instances.map((x) => {
          const on = x.state === 'running';
          const controllable = !!data.controllable;
          return '<div class="ctg-inst-row" data-inst-name="' + escapeHtml(x.name) + '" data-inst-state="' + escapeHtml(x.state) + '">' +
            '<span class="ctg-inst-name">' + escapeHtml(x.name) + '</span>' +
            (x.ours ? '<span class="ctg-badge" data-tone="ok">' + escapeHtml(t('container.inst.ours')) + '</span>' : '') +
            '<span class="ctg-dim">' + escapeHtml(x.image || '') + '</span>' +
            '<span class="ctg-badge" data-tone="' + (on ? 'ok' : 'dim') + '">' + escapeHtml(on ? t('container.inst.running') : t('container.inst.stopped')) + '</span>' +
            '<span class="ctg-spacer"></span>' +
            (controllable && !on
              ? '<button type="button" class="btn-mini" data-inst-act="start" data-inst-id="' + escapeHtml(entry.id) + '" data-inst-name="' + escapeHtml(x.name) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(t('container.inst.start')) + '</button>'
              : '') +
            (controllable && on
              ? '<button type="button" class="btn-mini ctg-danger" data-inst-act="stop" data-inst-id="' + escapeHtml(entry.id) + '" data-inst-name="' + escapeHtml(x.name) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(t('container.inst.stop')) + '</button>'
              : '') +
            '</div>';
        }).join('');
      }
    }
    const toggleLabel = open ? t('container.inst.collapse') : t('container.inst.view');
    return '<div class="ctg-inst" data-inst-for="' + escapeHtml(entry.id) + '" data-inst-enabled="' + (running ? '1' : '0') + '">' +
      '<div class="ctg-inst-head">' +
      '<button type="button" class="btn-mini" data-inst-toggle="' + escapeHtml(entry.id) + '"' + (running ? '' : ' disabled') + '>' +
      escapeHtml(toggleLabel) + '</button>' +
      '<button type="button" class="btn-mini" data-inst-create="' + escapeHtml(entry.id) + '"' + (running ? '' : ' disabled') + '>' +
      escapeHtml(t('container.inst.create')) + '</button>' +
      '<span class="ctg-dim">' + escapeHtml(running ? t('container.inst.hintReady') : t('container.inst.hintStopped')) + '</span>' +
      '</div>' +
      (open && running ? '<div class="ctg-inst-body">' + body + '</div>' : '') +
      '</div>';
  }

  /** 折叠的安装说明：**折叠时只显示名字**；展开才是四要素 + 四条链接 */
  function renderContainerGuide() {
    const box = $('container-guide');
    if (!box) return;
    box.innerHTML = CONTAINER_GUIDE_ORDER.map((id) => {
      const links = CONTAINER_LINKS[id] || {};
      const linkRows = CONTAINER_LINK_KEYS.map((k) =>
        '<a class="ctg-link" href="' + escapeHtml(links[k] || '') + '" target="_blank" rel="noreferrer noopener"' +
        ' data-link="' + escapeHtml(k) + '">' + escapeHtml(t('container.link.' + k)) + '</a>'
      ).join('');
      const field = (key, labelKey) =>
        '<div class="ctg-guide-field" data-field="' + escapeHtml(key) + '"><span class="ctg-guide-label">' +
        escapeHtml(t(labelKey)) + '</span><span class="ctg-guide-value">' + escapeHtml(t('container.rt.' + id + '.' + key)) + '</span></div>';
      return '<details class="ctg-guide-item" data-rt="' + escapeHtml(id) + '">' +
        '<summary class="ctg-guide-summary" id="ctg-guide-summary-' + escapeHtml(id) + '">' +
        '<span class="ctg-guide-name" data-name="' + escapeHtml(id) + '">' + escapeHtml(t('container.rt.' + id + '.name')) + '</span>' +
        // 第二批要求：折叠时除名称外，还要显示该容器**支持哪些系统**
        '<span class="ctg-guide-os ctg-dim" data-os="' + escapeHtml(id) + '">' + escapeHtml(t('container.rt.' + id + '.osShort')) + '</span>' +
        '</summary>' +
        '<div class="ctg-guide-body">' +
        // 只保留**中性事实**：支持系统 / 体积 / 官方与安装链接。
        // 刻意不显示"收费/商用/厂商"等字段：那会被读成推荐或广告。
        // 只陈述可核对的事实（许可/是否收费）；**不做比较、不发表观点**
        field('cost', 'container.guideCost') +
        field('os', 'container.guideOs') +
        field('size', 'container.guideSize') +
        '<div class="ctg-links">' + linkRows + '</div>' +
        '</div></details>';
    }).join('');
  }

  /**
   * 列表 = 本机**已有**的运行时（`not-installed` 不进列表，只进下方安装说明）。
   * `unsupported-platform` 与 `engine-error` 如实单列，**不**硬并进 running/not-running 两态。
   */
  function renderContainerList() {
    const box = $('container-list');
    const note = $('container-missing-note');
    const heJi = $('container-summary');
    if (!box) return;
    const rep = containerUi.report;
    if (!rep) {
      box.dataset.probe = 'none';
      box.innerHTML = '';
      if (note) note.textContent = '';
      if (heJi) { heJi.textContent = ''; heJi.dataset.summary = 'none'; }
      return;
    }
    /**
     * 列表**只列"本机可以用的 / 可以启动的"**（第十七批）。
     *   · ready（能用）与 installed-not-running 且**真能启动**的（一键启动/关闭都在行内）；
     *   · `engine-error` / `unsupported-platform` **不进列表**：它们既不能用、也没有可用的
     *     操作按钮，列出来只会让用户以为"有东西可以用"。有多少条被隐藏会**如实说**。
     *   · `not-installed` 本来就不进列表（只进下面的安装说明）。
     */
    const all = (rep.runtimes || []).filter((r) => r.status !== 'not-installed');
    const listed = all.filter((r) => r.status === 'ready' || (r.lifecycle && r.lifecycle.startable));
    const hiddenN = all.length - listed.length;
    box.dataset.probe = 'done';
    box.innerHTML = listed.length ? listed.map(containerRowHtml).join('') : '<div class="ctg-dim">' + escapeHtml(t('container.listEmpty')) + '</div>';
    bindContainerInstanceEvents();
    const notes = [];
    if (rep.notInstalledCount) notes.push(fmtKey('container.notInstalledNote', { n: String(rep.notInstalledCount) }));
    if (hiddenN) notes.push(fmtKey('container.listHidden', { n: String(hiddenN) }));
    if (note) note.textContent = notes.join(' · ');
    // 折叠块标题里带上数量：收起时也知道里面有几条（不用展开去数）
    const inline = $('container-count-inline');
    if (inline) inline.textContent = listed.length ? fmtKey('container.listCountInline', { n: String(listed.length) }) : '';
    if (heJi) {
      heJi.dataset.summary = String(rep.usableIds ? rep.usableIds.length : 0);
      heJi.textContent = fmtKey('container.probeSummary', {
        n: String(listed.length),
        ready: String((rep.usableIds || []).length),
        attention: String((rep.attentionIds || []).length),
        missing: String(rep.notInstalledCount || 0),
      });
    }
  }

  /**
   * 实例区的交互绑定（每次重渲染列表后绑一次）：
   *  · 展开/收起 —— 展开时按需拉一次实例（**引擎没启动的按钮是 disabled，点不动**）；
   *  · 启动/停止单个实例 —— 干完**重新拉一次列表**（状态来自引擎，不靠本地猜）；
   *  · 创建实例 —— 打开该容器产品自己的界面；打不开就**照实说**并给官方链接。
   */
  function bindContainerInstanceEvents() {
    document.querySelectorAll('[data-inst-toggle]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.instToggle;
        containerUi.instOpen[id] = !containerUi.instOpen[id];
        if (containerUi.instOpen[id] && !containerUi.instances[id]) {
          containerUi.instBusy[id] = true;
          renderContainerList();
          try {
            containerUi.instances[id] = await window.warmy.containerInstances({ id });
          } catch (e) {
            containerUi.instances[id] = { ok: false, id, supported: true, controllable: false, instances: [], reason: 'unexpected', evidence: String(e && e.message ? e.message : e) };
          }
          containerUi.instBusy[id] = false;
        }
        renderContainerList();
      };
    });
    document.querySelectorAll('[data-inst-act]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.instId;
        const name = btn.dataset.instName;
        const action = btn.dataset.instAct;
        containerUi.instBusy[id] = true;
        renderContainerList();
        const r = await window.warmy.containerInstanceAction({ id, action, instance: name })
          .catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
        containerUi.instBusy[id] = false;
        if (!r || !r.ok) {
          await uiAlert(fmtKey('container.inst.actFailed', { err: String((r && (r.error || r.evidence)) || 'unknown') }));
        }
        // 状态**重新问引擎**：不看本地缓存
        delete containerUi.instances[id];
        containerUi.instances[id] = await window.warmy.containerInstances({ id }).catch(() => null);
        renderContainerList();
      };
    });
    document.querySelectorAll('[data-inst-create]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.instCreate;
        const r = await window.warmy.containerAppOpen({ id }).catch((e) => ({ ok: false, opened: false, reason: String(e && e.message ? e.message : e) }));
        if (!r || !r.opened) {
          /**
           * 打不开就**说实话**，并把该产品官方链接给出去（用户自己建实例）。
           * 不假装"已跳转"，也不替用户在引擎里造容器。
           */
          await uiAlert(fmtKey('container.inst.openAppFailed', { reason: String((r && r.reason) || 'unknown') }) + '\n' + t('container.inst.createHint'));
        }
      };
    });
  }

  async function probeContainers(force) {
    if (containerUi.probing) return containerUi.report;
    containerUi.probing = true;
    const msg = $('container-probe-msg');
    if (msg) { msg.dataset.probeState = 'probing'; msg.textContent = t('container.probing'); }
    const btn = $('btn-container-probe');
    if (btn) btn.disabled = true;
    try {
      const r = await window.warmy.containerProbe({ force: !!force });
      const rep = r && r.report ? r.report : null;
      containerUi.report = rep;
      if (msg) {
        if (rep) {
          msg.dataset.probeState = 'done';
          msg.textContent = fmtKey('container.probeDone', { n: String((rep.usableIds || []).length) });
        } else {
          msg.dataset.probeState = 'failed';
          msg.textContent = fmtKey('container.probeFailed', { err: String((r && r.error) || 'unknown') });
        }
      }
    } catch (e) {
      containerUi.report = null;
      if (msg) { msg.dataset.probeState = 'failed'; msg.textContent = fmtKey('container.probeFailed', { err: String(e && e.message ? e.message : e) }); }
    } finally {
      containerUi.probing = false;
      if (btn) btn.disabled = false;
      renderContainerList();
      renderContainerFacts();
    }
    return containerUi.report;
  }

  /** 启停：**停止必须二次确认**（它是破坏性动作，会影响该运行时上其它程序的容器） */
  async function containerAction(id, action) {
    const entry = containerEntry(id);
    const name = t('container.rt.' + id + '.name');
    if (action === 'stop') {
      const go = await uiConfirm(fmtKey('container.action.confirmStopBody', { name }), t('container.action.confirmStopTitle'));
      if (!go) return false; // 未确认 → 一个操作都不发
    }
    const r = await window.warmy.containerAction({ id, action }).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
    if (!r || !r.ok) {
      await uiAlert(fmtKey('container.action.rejected', { err: String((r && (r.error || r.code)) || 'unknown') }));
      return false;
    }
    containerUi.pending = { id, action, deadline: Date.now() + ((entry && entry.lifecycle && entry.lifecycle.waitMs) || 120000) };
    renderContainerList();
    containerPollAction(id);
    return true;
  }

  /** 过渡态 + **真刷新**：轮询重探，直到状态真的变了 / 操作结束 / 超时 */
  function containerPollAction(id, round = 0) {
    if (containerUi.pollTimer) { clearTimeout(containerUi.pollTimer); containerUi.pollTimer = null; }
    const pend = containerUi.pending;
    if (!pend || pend.id !== id) return;
    const tick = async () => {
      containerPollAction(id, round + 1);
    };
    containerUi.pollTimer = setTimeout(async () => {
      containerUi.pollTimer = null;
      const rep = await probeContainers(true);
      const cur = containerUi.pending;
      if (!cur || cur.id !== id) return;
      const after = (rep && rep.runtimes || []).find((x) => x.id === id);
      const act = after && after.action;
      const settled = act && !act.pending;
      const reached = cur.action === 'start' ? (after && after.run === 'running') : (after && after.run !== 'running');
      if (settled || reached) {
        containerUi.pending = null;
        renderContainerList();
        return;
      }
      if (Date.now() > cur.deadline || round >= 90) {
        containerUi.pending = null;
        renderContainerList();
        await uiAlert(t('container.action.timeout'));
        return;
      }
      void tick();
    }, 1500);
  }

  /**
   * 安装提示词（第八批）：把**当前语言包**里的那段提示词灌进 `<pre>`，并绑一键复制。
   * 复制的必须是"语言包里那段"（逐字一致），不做二次拼接 —— 否则用户拿到的和验收的不是一份。
   */
  function renderInstallPrompt() {
    const pre = $('ctg-install-prompt-text');
    const btn = $('btn-copy-install-prompt');
    if (!pre) return;
    pre.textContent = t('container.env.prompt.content');
    pre.dataset.promptLang = String(state.locale || 'zh-CN');
    if (btn) btn.textContent = t('container.env.prompt.copy');
    const msg = $('ctg-install-prompt-msg');
    if (msg) {
      msg.textContent = '';
      msg.dataset.copyState = 'idle';
    }
    if (btn) {
      btn.onclick = async () => {
        const text = t('container.env.prompt.content');
        let okCopy = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            okCopy = true;
          }
        } catch {
          okCopy = false;
        }
        if (!okCopy) {
          // 兜底：选中内容让用户手动复制（**不假装已复制**）
          try {
            const range = document.createRange();
            range.selectNodeContents(pre);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } catch {
            /* 选中也失败就只给提示 */
          }
        }
        if (msg) {
          msg.dataset.copyState = okCopy ? 'copied' : 'failed';
          msg.textContent = okCopy ? t('container.env.prompt.copied') : t('container.env.prompt.failed');
        }
        return okCopy;
      };
    }
  }

  /** 设置卡片绑定（重渲染后要重新绑，所以是函数而不是一次性的） */
  function bindContainerCard() {
    renderContainerGuide();
    renderContainerList();
    renderContainerFacts();
    renderInstallPrompt();
    const btn = $('btn-container-probe');
    if (btn) btn.onclick = () => { void probeContainers(true); };
    const box = $('container-list');
    if (box) {
      box.onclick = (ev) => {
        const t2 = ev.target;
        const b = t2 && t2.closest ? t2.closest('[data-ctg-act]') : null;
        if (!b) return;
        void containerAction(b.dataset.ctgId, b.dataset.ctgAct);
      };
    }
    if (containerUi.cameFromGuidance) markContainerCardFocused();
  }

  /** 环境类型 / 镜像 / 实测耗时三段：数据全部来自探测报告，未获取就如实说"未获取" */
  function renderContainerFacts() {
    /* 第十七批：**不再渲染"环境类型"** —— 环境就是具体实例。
       原来那段（envTypes → Linux/Windows/Android 三选一的说明与徽章）整块删除：
       它既不是用户能选的运行环境（真正跑起来的是某个具体实例），又和"实例"重复。 */
    const tupianHe = $('container-images');
    if (tupianHe) {
      const tuPianJi = (containerUi.report && containerUi.report.images) || [];
      tupianHe.innerHTML = tuPianJi.length
        ? tuPianJi.map((x) => {
            const pinned = !!x.digest;
            return '<div class="ctg-row" data-image="' + escapeHtml(x.id) + '" data-digest="' + (pinned ? '1' : '0') + '">' +
              '<div class="ctg-row-head"><span class="ctg-name">' + escapeHtml(x.ref) + '</span>' +
              '<span class="ctg-badge" data-tone="' + (pinned ? 'ok' : 'danger') + '" data-pinned="' + (pinned ? '1' : '0') + '">' +
              escapeHtml(pinned ? t('container.image.pinned') : t('container.image.sourcePending')) + '</span></div>' +
              '<div class="ctg-dim">' + escapeHtml(x.license) + ' · ' + escapeHtml(x.approxSize) + ' · ' + escapeHtml(x.platform) + '</div>' +
              '<div class="ctg-dim">' + escapeHtml(x.purpose) + '</div>' +
              '<div class="ctg-dim" data-digest-value="' + escapeHtml(String(x.digest || '')) + '">' +
              escapeHtml(pinned ? String(x.digest) : 'digest: —') + '</div>' +
              '</div>';
          }).join('')
        : '<div class="ctg-dim">' + escapeHtml(t('container.probing')) + '</div>';
    }
    // 第八/九批：镜像**按项目技术栈**分档（最小 / 带 Node）+ 每档"适合什么项目"
    const stackBox = $('container-image-stacks');
    if (stackBox) {
      const tuPianJi = (containerUi.report && containerUi.report.images) || [];
      const stacks = ['minimal', 'node'];
      stackBox.innerHTML = stacks
        .map((st) => {
          const rows = tuPianJi.filter((x) => x.stack === st);
          const title = t(st === 'minimal' ? 'container.image.stack.minimal' : 'container.image.stack.node');
          const detail = rows.length
            ? rows.map((x) => '<div class="ctg-dim" data-fits="' + escapeHtml(x.id) + '">' + escapeHtml(x.ref) + ' · ' +
                escapeHtml(t('container.image.stack.fits')) + '：' + escapeHtml(x.fits) + '</div>').join('')
            : '<div class="ctg-dim" data-fits="none">' + escapeHtml(t('container.probing')) + '</div>';
          return '<div class="ctg-row" data-stack="' + st + '"><div class="ctg-row-head"><span class="ctg-name">' +
            escapeHtml(title) + '</span></div>' + detail + '</div>';
        })
        .join('');
    }
    const tBox = $('container-timings');
    if (tBox) {
      const tm = (containerUi.report && containerUi.report.timings) || {};
      const parts = [];
      if (typeof tm.engineStartMs === 'number') parts.push(fmtKey('container.timing.start', { s: (tm.engineStartMs / 1000).toFixed(1) }));
      if (typeof tm.engineStopMs === 'number') parts.push(fmtKey('container.timing.stop', { s: (tm.engineStopMs / 1000).toFixed(1) }));
      if (typeof tm.runMs === 'number') parts.push(fmtKey('container.timing.run', { ms: String(tm.runMs) }));
      tBox.dataset.measured = parts.length ? '1' : '0';
      tBox.textContent = parts.length ? parts.join('；') : t('container.timing.none');
    }
  }

  function markContainerCardFocused() {
    const card = $('container-card');
    if (!card) return;
    card.classList.add('container-card-focus');
    card.dataset.focusFrom = 'run-env';
    const cta = $('container-cta');
    if (cta) cta.classList.remove('hidden');
    try { card.scrollIntoView({ block: 'center' }); } catch { /* noop */ }
  }

  /**
   * 「去安装」的真实跳转：设置 → 功能 → 容器，并**滚到卡片 + 高亮 + 显示引导第一步**。
   * 这是 ADR §3.3 的那条链路，必须真的走到页面上（不是只改一个变量）。
   */
  async function gotoContainerCard() {
    containerUi.cameFromGuidance = true;
    setNav('settings');
    const funcBtn = document.querySelector('#settings-nav button[data-sec="func"]');
    if (funcBtn) funcBtn.click();
    // 首次进来 report 还是空的：顺手探一次，用户落地就能看到「已有容器」
    if (!containerUi.report) await probeContainers(true);
    markContainerCardFocused();
    return true;
  }

  /* ══ 项目可用性（ADR 004 第七批定稿）════════════════════════════════════════
     · 创建时选了「容器中开发」⇒ **容器必须启动，项目才可用**；否则项目置灰、**不可聊天**、
       其中功能不可用，**只能翻看之前的记录（历史仍可读 —— 这一点必须保证）**。
     · 创建时没选容器、或这是「我的牛马」⇒ **无需容器也能正常聊天**（绝不误伤）。
     · 对成员的可见效果**等同「创建者下线」**（同一个标志位 + 同一句既有文案，不新造状态）。
     · 「启用/停用项目」与容器**无关**：任何项目都能被创建者停用（入口在**项目右键菜单**）。
     · 「运行/测试在容器中」这个选项**已作废删除**（容器 = 开发环境；测试/运行不在其职责内）。
     ══════════════════════════════════════════════════════════════════════════ */

  /** 开发环境（dev）映射：缺项**一律按本机**（不猜旧项目） */
  async function loadContainerDevMap() {
    try {
      const s = await window.warmy.settingsGet();
      const m = (s && s.settings && s.settings.containerDev) || {};
      return m && typeof m === 'object' ? m : {};
    } catch {
      return {};
    }
  }
  /** 被创建者**停用**的项目（groupId → 停用时间戳；缺项 = 启用中） */
  async function loadProjectDisabledMap() {
    try {
      const s = await window.warmy.settingsGet();
      const m = (s && s.settings && s.settings.projectDisabled) || {};
      return m && typeof m === 'object' ? m : {};
    } catch {
      return {};
    }
  }
  /** 容器开发项目选定的运行时（groupId → runtimeId；缺项 = 还没选） */
  async function loadProjectRuntimeMap() {
    try {
      const s = await window.warmy.settingsGet();
      const m = (s && s.settings && s.settings.containerProjectRuntime) || {};
      return m && typeof m === 'object' ? m : {};
    } catch {
      return {};
    }
  }
  const devEnvOf = (map, id) => (map && map[id] === 'container' ? 'container' : 'host');

  /** 状态码 → i18n 原因后缀（与主进程 projectReasonKey **逐档对齐**） */
  const PROJECT_REASON = (code) =>
    'container.project.reason.' +
    (code === 'disabled-by-owner' ? 'disabledByOwner'
      : code === 'container-not-installed' ? 'notInstalled'
        : code === 'container-not-chosen' ? 'notChosen'
          : code === 'ok' || code === 'host-dev' ? 'ok' : 'containerDown');

  /**
   * 项目可用性：**主进程是唯一事实来源**（同一份 deriveProjectState）。
   * 返回 null = 这个会话不是"项目"（牛马/联系人/群聊），也就完全不受容器影响。
   * 主进程拿不到时走**保守兜底**：只要不是"明确可用"，一律当不可用（宁可不给，也不乐观放开）。
   */
  async function quXiangMuTai(sessionId) {
    const id = String(sessionId || '');
    if (!id) return null;
    try {
      const r = await window.warmy.projectState({ sessionId: id });
      if (r && r.ok && r.state) {
        return {
          ...r.state,
          runtimeId: String(r.state.runtimeId || ''),
          memberFaceKey: r.memberFaceKey || (r.state.memberFace === 'creator-offline' ? 'group.memberOffline' : null),
          localIsCreator: r.localIsCreator === true,
          historyReadable: true,
          /**
           * 第十六批：这条状态**是谁说的**。
           * `creator-signal` = 属性与可用性来自创建者节点同步来的信号（异地成员的情况）——
           * 渲染层据此多给一行说明，让成员看到"是创建者那边不可用"（而不是自己机器上的问题）。
           */
          projectSource: r.projectSource === 'creator-signal' ? 'creator-signal' : 'local',
          projectReportedAt: Number(r.projectReportedAt) || 0,
          projectDir: String(r.projectDir || ''),
          projectDirReason: String(r.projectDirReason || 'not-recorded'),
          inboundGate: r.inboundGate || null,
        };
      }
    } catch {
      /* 兜底见下 */
    }
    const dev = await loadContainerDevMap();
    const devEnv = devEnvOf(dev, id);
    const jinyongBiao = await loadProjectDisabledMap();
    const rtMap = await loadProjectRuntimeMap();
    const runtimeId = String(rtMap[id] || '');
    if (devEnv !== 'container' && !jinyongBiao[id]) return null; // 本机项目没被停用 ⇒ 与容器无关
    if (devEnv === 'host') {
      return {
        devEnv: 'host', containerOnly: false, running: false, stopped: true, code: 'disabled-by-owner',
        hostEditingRefused: false, developmentAllowed: false, developmentWhere: 'host',
        testingAllowed: true, testingWhere: 'host-or-other-device', historyReadable: true,
        memberFace: 'creator-offline', memberFaceKey: 'group.memberOffline',
        reasonKey: 'disabledByOwner', fix: 'enable-project', runtimeId, localIsCreator: false, restrictions: ['development', 'collaboration', 'features'],
      };
    }
    await probeContainers(false);
    const row = runtimeId ? containerEntry(runtimeId) : null;
    const ready = !!(row && row.status === 'ready');
    const disabled = !!jinyongBiao[id];
    const code = disabled ? 'disabled-by-owner' : !runtimeId ? 'container-not-chosen' : ready ? 'ok' : 'container-not-ready';
    const stopped = code !== 'ok';
    return {
      devEnv: 'container', containerOnly: true, running: !stopped, stopped, code,
      hostEditingRefused: true, developmentAllowed: !stopped, developmentWhere: 'container',
      testingAllowed: true, testingWhere: 'host-or-other-device', historyReadable: true,
      memberFace: stopped ? 'creator-offline' : null,
      memberFaceKey: stopped ? 'group.memberOffline' : null,
      reasonKey: code === 'disabled-by-owner' ? 'disabledByOwner' : code === 'ok' ? 'ok' : code === 'container-not-chosen' ? 'notChosen' : 'containerDown',
      fix: disabled ? 'enable-project' : code === 'ok' ? 'ok' : code === 'container-not-chosen' ? 'choose-container' : 'start-container',
      runtimeId, localIsCreator: false,
      restrictions: stopped ? ['host-editing', 'development', 'collaboration', 'features'] : ['host-editing'],
    };
  }

  /** 不可用时的原因文案（走 i18n） */
  const projectReasonText = (xiangMuTai) => t(PROJECT_REASON(xiangMuTai ? xiangMuTai.code : 'container-not-ready'));

  /** 返回"不可用的原因文案"，null = 放行（发送前调用；主进程还会再拒一次） */
  async function xiangMuKaiFaKuai(sessionId) {
    const xiangMuTai = await quXiangMuTai(sessionId);
    if (!xiangMuTai || xiangMuTai.running) return null;
    return projectReasonText(xiangMuTai);
  }

  /**
   * 把"不可用"落到界面：**开发与功能入口禁用**，但**历史照常可读**（绝不能把整块灰掉）。
   * 只在 `kind === 'internal'`（项目）上生效：「我的牛马」恒为本机开发，不受容器影响。
   */
  async function yingYongXiangMuKaiFaMen() {
    const sel = state.selectedChat;
    const input = $('input');
    const col = $('chat-col');
    const xiangMuTai = sel && sel.kind === 'internal' ? await quXiangMuTai(sel.id) : null;
    const blocked = !!(xiangMuTai && xiangMuTai.stopped);
    const reason = blocked ? projectReasonText(xiangMuTai) : '';
    if (col) {
      col.dataset.projectState = xiangMuTai ? (blocked ? 'unavailable' : 'available') : 'none';
      col.dataset.projectCode = xiangMuTai ? String(xiangMuTai.code) : '';
      col.dataset.historyReadable = xiangMuTai ? '1' : '0';
    }
    if (input) {
      input.dataset.devBlocked = blocked ? '1' : '0';
      input.disabled = blocked;
      input.title = blocked ? fmtKey('container.project.blockedNotice', { reason }) : '';
    }
    const btn = $('btn-send');
    if (btn) btn.title = blocked ? (input ? input.title : '') : '';
    // 项目功能入口：不可用时禁用（跑执行者=在项目里干活；控制台另有自己的门禁）
    const exec = $('btn-exec-run');
    if (exec && xiangMuTai) {
      exec.disabled = blocked;
      exec.title = blocked ? fmtKey('container.project.blockedNotice', { reason }) : '';
    }
    // 历史区**保持可读**：不做任何 opacity/filter 之类会降低可读性的处理（对比度也不许降）
    const msgs = $('messages');
    if (msgs) msgs.dataset.readonlyHistory = blocked ? '1' : '0';
    syncSendState();
    return blocked;
  }

  /** 右栏：项目状态（只读；动作在右键菜单里，右侧顶部**不再有**切换容器的入口） */
  async function renderProjectStateBlock() {
    const box = $('project-state-box');
    if (!box) return;
    const sel = state.selectedChat;
    if (!sel || sel.kind !== 'internal') { box.innerHTML = ''; return; }
    const dev = await loadContainerDevMap();
    const devEnv = devEnvOf(dev, sel.id);
    const xiangMuTai = await quXiangMuTai(sel.id);
    if (!xiangMuTai) { box.innerHTML = ''; return; }
    // 环境事实（当前容器 / 引擎系统模式 / 固化能力 / 上次固化）——来自主进程，不假定 Linux
    let envInfo = null;
    try { envInfo = await window.warmy.projectEnvStatus({ sessionId: sel.id }); } catch { envInfo = null; }
    const blocked = xiangMuTai.stopped;
    const rt = xiangMuTai.runtimeId ? t('container.rt.' + xiangMuTai.runtimeId + '.name') : t('container.project.none');
    const offline = xiangMuTai.memberFaceKey ? t(xiangMuTai.memberFaceKey) : '';
    const html = [];
    html.push('<div class="ctg-project-state" id="project-state" data-project-state="' + escapeHtml(blocked ? 'unavailable' : 'available') + '"' +
      ' data-project-code="' + escapeHtml(xiangMuTai.code) + '"' +
      ' data-member-face="' + escapeHtml(xiangMuTai.memberFace || '') + '"' +
      ' data-host-editing="' + (xiangMuTai.hostEditingRefused ? 'refused' : 'allowed') + '"' +
      ' data-history-readable="' + (xiangMuTai.historyReadable ? '1' : '0') + '">');
    if (blocked) {
      html.push('<div class="ctg-dim ctg-badge-line"><span class="ctg-badge" data-tone="danger" data-offline="' + escapeHtml(offline) + '">' + escapeHtml(offline) + '</span>' +
        '<span class="ctg-stopped-title">' + escapeHtml(t('container.project.unavailable')) + '</span></div>');
    } else {
      html.push('<div class="ctg-dim ctg-badge-line"><span class="ctg-badge" data-tone="ok">' + escapeHtml(t('container.project.available')) + '</span></div>');
    }
    html.push('<div class="ctg-dim" data-dev-env="' + escapeHtml(devEnv) + '">' + escapeHtml(t('container.devEnv.title')) + '：' +
      escapeHtml(devEnv === 'container' ? t('container.devEnv.container') : t('container.devEnv.host')) + '</div>');
    html.push('<div class="ctg-dim" data-project-runtime="' + escapeHtml(xiangMuTai.runtimeId || '') + '">' +
      escapeHtml(t('container.project.usingContainer')) + '：' + escapeHtml(rt) + '</div>');
    html.push('<div class="ctg-dim" data-project-reason="' + escapeHtml(xiangMuTai.reasonKey || '') + '">' +
      escapeHtml(fmtKey('container.project.reasonBody', { reason: projectReasonText(xiangMuTai) })) + '</div>');
    if (blocked) {
      html.push('<div class="ctg-dim" data-project-fix="' + escapeHtml(xiangMuTai.fix) + '">' + escapeHtml(t('container.project.fix.' + xiangMuTai.fix)) + '</div>');
      html.push('<div class="ctg-dim" data-project-history="1">' + escapeHtml(t('container.project.historyStillReadable')) + '</div>');
      // 需要先启动/选容器时才给跳转（走与之前一致的引导流）
      if (xiangMuTai.fix === 'start-container' || xiangMuTai.fix === 'install-container' || xiangMuTai.fix === 'choose-container') {
        html.push('<div><button type="button" class="btn-mini" id="btn-project-goto-container">' + escapeHtml(t('container.console.gotoInstall')) + '</button></div>');
      }
    }
    html.push('<div class="ctg-dim" data-project-offline-note="1">' + escapeHtml(t('container.project.unavailableAsOffline')) + '</div>');
    /**
     * 第十六批：**异地成员**看到的是"创建者那边"的事实（属性与可用性都来自创建者的信号）。
     * 这一行是给成员的解释：为什么我这台机器上找不到这个容器，却依然显示"已停止"。
     * 复用同一句「创建者离线」文案，不新造第三种状态。
     */
    if (xiangMuTai.projectSource === 'creator-signal') {
      html.push('<div class="ctg-dim" data-project-source="creator-signal">' + escapeHtml(t('container.project.remoteNotice')) + '</div>');
      if (xiangMuTai.projectReportedAt) {
        html.push('<div class="ctg-dim" data-project-reported-at="' + String(xiangMuTai.projectReportedAt) + '">' +
          escapeHtml(fmtKey('container.project.remoteReportedAt', { time: new Date(xiangMuTai.projectReportedAt).toLocaleString() })) + '</div>');
      }
    }
    // 项目目录（**产品级事实**：成员也能看到这个项目挂的是哪个目录）
    if (xiangMuTai.projectDir) {
      html.push('<div class="ctg-dim" data-project-dir="' + escapeHtml(xiangMuTai.projectDir) + '">' +
        escapeHtml(fmtKey('container.project.dirBody', { dir: xiangMuTai.projectDir })) + '</div>');
    } else if (devEnv === 'container') {
      html.push('<div class="ctg-dim" data-project-dir-missing="1">' + escapeHtml(t('container.project.dirNotRecorded')) + '</div>');
    }
    if (devEnv === 'container') {
      html.push('<div class="ctg-dim" data-project-host-edit="1">' + escapeHtml(t('container.project.hostEditingRefused')) + '</div>');
      html.push('<div class="ctg-dim" data-project-boundary="1">' + escapeHtml(t('container.project.enforceBoundary')) + '</div>');
    }
    html.push('<div class="ctg-dim" data-project-testing="1">' + escapeHtml(t('container.project.testingAllowed')) + '</div>');
    html.push('<div class="ctg-dim" data-project-menu-hint="1">' + escapeHtml(t('container.project.menuHint')) + '</div>');
    /**
     * ADR 004 §7.8/§7.9（第九批）：**环境状态** —— 当前容器 / 引擎的系统模式 /
     * 固化能力 / 上次固化时间，并给一个显式的「固化当前环境」按钮。
     * 全部来自主进程的真实事实：能力**按运行时区分**（Docker/Podman 可 commit；WSL 没有 commit），
     * 系统模式从真探测里读（**不假定 Linux**），固化记录只写"真发生过的事"。
     */
    if (devEnv === 'container') {
      const env = envInfo;
      const abilityKey = (k) => 'container.env.solidify.ability.' + (k === 'commit' ? 'commit' : k === 'export-import' ? 'export-import' : 'unsupported');
      const whyText = env && env.solidify ? t('container.env.solidify.why.' + env.solidify.why) : '';
      const modeText = env && env.engineMode && env.engineMode !== 'unknown'
        ? String(env.engineMode)
        : t('container.env.mode.unknown');
      html.push('<div class="ctg-hint-box" id="project-env-box" data-env-kind="' + escapeHtml(env && env.solidify ? env.solidify.kind : 'unsupported') + '"' +
        ' data-env-programmatic="' + (env && env.solidify && env.solidify.programmatic ? '1' : '0') + '">' +
        '<div class="ctg-hint-title">' + escapeHtml(t('container.env.solidify.title')) + '</div>' +
        '<div class="ctg-dim" data-env-status="1">' + escapeHtml(fmtKey('container.env.solidify.status', {
          runtime: rt, ability: t(abilityKey(env && env.solidify ? env.solidify.kind : 'unsupported')),
        })) + '</div>' +
        '<div class="ctg-dim" data-env-mode="' + escapeHtml(modeText) + '">' + escapeHtml(fmtKey('container.env.mode.body', { mode: modeText })) + '</div>' +
        '<div class="ctg-dim" data-env-why="' + escapeHtml(env && env.solidify ? env.solidify.why : 'no-runtime-chosen') + '">' + escapeHtml(whyText) + '</div>' +
        '<div class="ctg-dim" data-env-last="' + escapeHtml(String((env && env.solidify && env.solidify.lastSolidifiedAt) || 0)) + '">' +
        escapeHtml((env && env.solidify && env.solidify.lastSolidifiedAt)
          ? fmtKey('container.env.solidify.last', { time: new Date(env.solidify.lastSolidifiedAt).toLocaleString(), image: String(env.solidify.lastImageRef || '—') })
          : t('container.env.solidify.never')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.env.solidify.retained')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(fmtKey('container.env.solidify.keep', { n: String((env && env.solidify && env.solidify.keep) || 3) })) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.env.solidify.security')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.env.solidify.restore')) + '</div>' +
        /**
         * 容器里**真的有**什么东西：这是"真实执行"在 UI 上的一个入口（跑的是固定命令表里的
         * `env-probe` 那一组，一条命令都不会来自渲染层）。
         */
        '<div class="ctg-actions-row">' +
        '<button type="button" class="btn-mini" id="btn-env-probe">' + escapeHtml(t('container.env.probe.button')) + '</button>' +
        '<button type="button" class="btn-mini" id="btn-solidify-env">' + escapeHtml(t('container.env.solidify.button')) + '</button>' +
        '<button type="button" class="btn-mini" id="btn-rollback-env"' + (env && env.solidify && env.solidify.lastImageRef ? '' : ' disabled') + '>' +
        escapeHtml(t('container.env.rollback.button')) + '</button>' +
        '</div>' +
        '<div class="ctg-dim" id="env-probe-msg" data-probe-state="idle"></div>' +
        '<span class="ctg-dim" id="solidify-msg" data-solidify-state="idle"></span>' +
        '<span class="ctg-dim" id="rollback-msg" data-rollback-state="idle"></span>' +
        '</div>');
      // 宿主目录加锁（P5）：**只有创建者**、**只有用户按键**才会真的改 ACL；这里如实显示当前状态
      let guard = null;
      try { guard = await window.warmy.projectFsGuard({ sessionId: sel.id, action: 'status' }); } catch { guard = null; }
      html.push('<div class="ctg-hint-box" id="fs-guard-box" data-guard-supported="' + (guard && guard.platformSupported ? '1' : '0') + '"' +
        ' data-guard-active="' + (guard && guard.guarded ? '1' : '0') + '">' +
        '<div class="ctg-hint-title">' + escapeHtml(t('container.fsGuard.title')) + '</div>' +
        '<div class="ctg-dim" data-guard-state="' + escapeHtml(guard && guard.guarded ? 'guarded' : (guard && guard.code ? guard.code : 'off')) + '">' +
        escapeHtml(guard && guard.ok && guard.guarded ? t('container.fsGuard.on')
          : guard && !guard.ok ? t('container.fsGuard.unavailable.' + String(guard.code || 'unknown'))
            : t('container.fsGuard.off')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.fsGuard.what')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.fsGuard.undo')) + '</div>' +
        '<div class="ctg-dim">' + escapeHtml(t('container.fsGuard.limits')) + '</div>' +
        '<div class="ctg-actions-row">' +
        '<button type="button" class="btn-mini" id="btn-fs-guard"' + (guard && guard.platformSupported && xiangMuTai.localIsCreator ? '' : ' disabled') + '>' +
        escapeHtml(guard && guard.guarded ? t('container.fsGuard.unlock') : t('container.fsGuard.lock')) + '</button>' +
        '<span class="ctg-dim" id="fs-guard-msg"></span></div></div>');
    }
    html.push('</div>');
    box.innerHTML = html.join('');
    const go = $('btn-project-goto-container');
    if (go) go.onclick = () => { void gotoContainerCard(); };
    /**
     * 「固化当前环境」：现在**真的会 commit**（第十六批）。
     * 三种结果如实分开：真成功（有镜像 id）/ 如实拒绝（能力不支持·没容器·节流）/ 失败（带原始输出）。
     * **绝不在没成功的时候显示"已固化"**。
     */
    const solid = $('btn-solidify-env');
    if (solid) {
      solid.disabled = !(envInfo && envInfo.solidify && envInfo.solidify.programmatic);
      solid.onclick = async () => {
        const msg = $('solidify-msg');
        const r = await window.warmy.projectEnvSolidify({ sessionId: sel.id, explicit: true }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        const ok = !!(r && r.ok && r.evidence === 'commit-succeeded');
        // ⚠️ 顺序很重要：**先重新渲染**（固化成功会改变"上次固化/回滚按钮"），
        // 再把结果写在**新的**那个消息节点上 —— 反过来会被重渲染冲掉（实测踩过）。
        if (ok) await renderProjectStateBlock();
        const msg2 = $('solidify-msg') || msg;
        if (msg2) {
          msg2.dataset.solidifyState = ok ? 'done' : (r && r.evidence === 'not-attempted' ? 'throttled' : 'refused');
          msg2.dataset.solidifyEvidence = String((r && r.evidence) || 'refused');
          if (ok) {
            msg2.textContent = fmtKey('container.env.solidify.done', {
              time: new Date(Number(r.solidifiedAt) || Date.now()).toLocaleString(),
              image: String(r.imageRef || '—'),
              id: String(r.imageId || '').slice(0, 12),
            });
          } else {
            const key = 'container.env.solidify.refused.' + String((r && r.code) || 'no-runtime-chosen');
            const text = t(key);
            msg2.textContent = text === key
              ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') })
              : text;
          }
        }
        return r;
      };
    }
    /** 「回滚到固化点」：真的从固化镜像起一个容器（与文件回退点**分层**，文案里写清） */
    const roll = $('btn-rollback-env');
    if (roll) {
      roll.onclick = async () => {
        const msg = $('rollback-msg');
        const go2 = await uiConfirm(t('container.env.rollback.confirmBody'), t('container.env.rollback.confirmTitle'));
        if (!go2) return null;
        const r = await window.warmy.projectEnvRollback({ sessionId: sel.id }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        // 先刷新（回滚会改变容器状态），再写消息 —— 否则会被重渲染冲掉
        await afterProjectStateChange(sel.id);
        const msg2 = $('rollback-msg') || msg;
        if (msg2) {
          const ok = !!(r && r.ok && r.evidence === 'container-started');
          msg2.dataset.rollbackState = ok ? 'done' : 'refused';
          msg2.dataset.rollbackEvidence = String((r && r.evidence) || 'refused');
          const key = 'container.env.rollback.refused.' + String((r && r.code) || 'unknown');
          const text = t(key);
          msg2.textContent = ok
            ? fmtKey('container.env.rollback.done', { image: String(r.imageRef || ''), container: String(r.containerRef || '') })
            : (text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text);
        }
        return r;
      };
    }
    /** 「容器里到底有什么」：真的在容器里跑一组**固定命令**（探针），结果原样贴出来 */
    const probeBtn = $('btn-env-probe');
    if (probeBtn) {
      probeBtn.onclick = async () => {
        const msg = $('env-probe-msg');
        const r = await window.warmy.projectExec({ sessionId: sel.id, command: 'env-probe' }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        if (msg) {
          msg.dataset.probeState = r && r.ok ? 'done' : 'refused';
          if (r && r.ok) {
            msg.textContent = String(r.output || '').replace(/\s+/g, ' ').slice(0, 300);
          } else {
            const key = 'container.env.probe.refused.' + String((r && r.code) || 'unknown');
            const text = t(key);
            msg.textContent = text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text;
          }
        }
        return r;
      };
    }
    /** 「锁定 / 解锁项目目录」：**文件系统级**那道防线，可一键撤销 */
    const guardBtn = $('btn-fs-guard');
    if (guardBtn) {
      guardBtn.onclick = async () => {
        const msg = $('fs-guard-msg');
        const box2 = $('fs-guard-box');
        const xiangJieChu = box2 && box2.dataset.guardActive === '1';
        if (!xiangJieChu) {
          const go3 = await uiConfirm(t('container.fsGuard.confirmBody'), t('container.fsGuard.confirmTitle'));
          if (!go3) return null;
        }
        const r = await window.warmy.projectFsGuard({ sessionId: sel.id, action: xiangJieChu ? 'lift' : 'apply' })
          .catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        // 先重渲染（状态块要换成"已锁定/未锁定"），再写消息
        await renderProjectStateBlock();
        const msg2 = $('fs-guard-msg') || msg;
        if (msg2) {
          const key = 'container.fsGuard.failed.' + String((r && r.code) || 'unknown');
          const text = t(key);
          msg2.textContent = r && r.ok
            ? (xiangJieChu ? t('container.fsGuard.lifted') : t('container.fsGuard.applied'))
            : (text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text);
        }
        return r;
      };
    }
  }

  /**
   * 右栏三块：**最近改动文件 / 其他文件 / 生成的产品**。
   *
   * 数据全部来自主进程 `warmy:project-files`，第十六批之后有**四类真实来源**：
   *   ① **工具文件访问台账**（项目级、成员可见：读/写/改/删/建/备份/回滚 + 时间）；
   *   ② 回退点明细（真实 path + 真实 ts）；
   *   ③ **项目目录扫描**（真实 mtime；目录来自项目记录）；
   *   ④ 产物目录扫描（入口识别 + 能不能在本机跑）。
   * 拿不到就**如实显示空态与原因**（`missingSources`），**绝不**拿演示数据充数。
   * 「其他文件」= 被工具动过但**不在项目目录下**的路径（来源逐条标出来）。
   */
  async function renderProjectFilesBlock() {
    const box = $('project-files-box');
    if (!box) return;
    const sel = state.selectedChat;
    if (!sel || sel.kind !== 'internal') { box.innerHTML = ''; return; }
    let shiShi = null;
    try { shiShi = await window.warmy.projectFiles({ sessionId: sel.id }); } catch { shiShi = null; }
    if (!shiShi || !shiShi.ok) {
      box.innerHTML = '<div class="ctg-dim" data-files-empty="load-failed">' + escapeHtml(t('projectFiles.loadFailed')) + '</div>';
      return;
    }
    const LeiXingMing = (k) => t('projectFiles.kind.' + (k || 'changed'));
    const sourceLabel = (s) => t('projectFiles.source.' + (s || 'unknown'));
    const faShengShiJian = (ts) => {
      if (!ts) return '—';
      try {
        const d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      } catch { return '—'; }
    };
    const rowOf = (f, extra) =>
      '<div class="ctg-row pf-row" data-path="' + escapeHtml(f.path) + '" data-kind="' + escapeHtml(f.kind) + '"' +
      (f.op ? ' data-op="' + escapeHtml(f.op) + '"' : '') +
      (f.source ? ' data-source="' + escapeHtml(f.source) + '"' : '') + '>' +
      '<div class="ctg-row-head"><span class="pf-kind" data-kind="' + escapeHtml(f.kind) + '">' + escapeHtml(LeiXingMing(f.kind)) + '</span>' +
      '<span class="ctg-dim">' + escapeHtml(faShengShiJian(f.ts)) + '</span></div>' +
      '<div class="pf-path">' + escapeHtml(f.path) + '</div>' +
      (extra ? '<div class="ctg-dim">' + escapeHtml(extra) + '</div>' : '') +
      '</div>';
    const html = [];
    // ① 最近改动文件
    html.push('<div class="pf-head" data-pf="changed">' + escapeHtml(t('projectFiles.changedTitle')) + '</div>');
    html.push(shiShi.changed && shiShi.changed.length
      ? shiShi.changed.slice(0, 20).map((f) => rowOf(f, f.source ? sourceLabel(f.source) : '')).join('')
      : '<div class="ctg-dim" data-empty="changed">' + escapeHtml(t('projectFiles.empty.' + (shiShi.projectDirReason === 'not-recorded' ? 'noProjectDir' : 'changed'))) + '</div>');
    // ② 其他文件（非项目内的）
    html.push('<div class="pf-head" data-pf="other">' + escapeHtml(t('projectFiles.otherTitle')) + '</div>');
    html.push(shiShi.other && shiShi.other.length
      ? shiShi.other.slice(0, 20).map((f) => rowOf(f, sourceLabel(f.source))).join('')
      : '<div class="ctg-dim" data-empty="other">' + escapeHtml(t('projectFiles.empty.other')) + '</div>');
    // ③ 生成的产品
    const p = shiShi.product || {};
    html.push('<div class="pf-head" data-pf="product">' + escapeHtml(t('projectFiles.productTitle')) + '</div>');
    html.push('<div class="ctg-row" id="product-card" data-product-kind="' + escapeHtml(p.kind || 'none') + '"' +
      ' data-product-dir-exists="' + (p.dirExists ? '1' : '0') + '" data-entry-runnable="' + (p.entryHostRunnable ? '1' : '0') + '">' +
      '<div class="ctg-dim" data-product-dir="' + escapeHtml(p.dir || '') + '">' +
      escapeHtml(t('projectFiles.productDir')) + '：' + escapeHtml(p.dir || '—') +
      (p.dirExists ? '' : ' · ' + escapeHtml(t('projectFiles.productDirPlanned'))) + '</div>');
    if (p.entry) {
      html.push('<div class="pf-path" data-product-entry="' + escapeHtml(p.entry) + '">' + escapeHtml(p.entry) + '</div>');
      html.push('<div class="ctg-dim">' + escapeHtml(LeiXingMing(p.kind === 'program' ? 'program' : 'file')) + '</div>');
    } else {
      html.push('<div class="ctg-dim" data-product-none="' + escapeHtml(p.entryReason || 'none') + '">' + escapeHtml(t('projectFiles.entry.' + (p.entryReason || 'none'))) + '</div>');
    }
    html.push('<div class="ctg-dim" data-product-run-reason="' + escapeHtml(p.entryReason || '') + '">' +
      escapeHtml(t('projectFiles.runReason.' + (p.entryReason || 'none'))) + '</div>');
    html.push('<div class="pf-actions"><button type="button" class="btn-mini" id="btn-product-run"' +
      (p.kind === 'program' && p.entryHostRunnable ? '' : ' disabled') + '>' + escapeHtml(t('projectFiles.run')) + '</button>' +
      '<span class="ctg-dim" id="product-run-msg"></span></div>');
    /**
     * 台账本身也如实摆一行出来（**项目级、成员可见**）：有多少条、什么来源。
     * 这样"记录文件的改动是产品功能"这件事在界面上是**看得见**的，而不是只写在文档里。
     */
    const zhangBenHang = shiShi.ledger || [];
    html.push('<div class="ctg-dim" data-ledger-count="' + String(zhangBenHang.length) + '" data-ledger-scope="project">' +
      escapeHtml(fmtKey('projectFiles.ledgerCount', { n: String(zhangBenHang.length) })) + '</div>');
    if (shiShi.projectSource === 'creator-signal') {
      html.push('<div class="ctg-dim" data-project-source="creator-signal">' +
        escapeHtml(t('projectFiles.fromCreatorSignal')) + '</div>');
    }
    if (shiShi.missingSources && shiShi.missingSources.length) {
      html.push('<div class="ctg-dim" data-missing-sources="' + escapeHtml(shiShi.missingSources.join(',')) + '">' +
        escapeHtml(fmtKey('projectFiles.missingHint', { n: String(shiShi.missingSources.length) })) + '</div>');
    }
    html.push('</div>');
    box.innerHTML = html.join('');
    const run = $('btn-product-run');
    if (run) {
      run.onclick = async () => {
        const msg = $('product-run-msg');
        const r = await window.warmy.productRun({ sessionId: sel.id }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
        if (msg) {
          msg.textContent = r && r.ok
            ? fmtKey('projectFiles.runStarted', { pid: String((r && r.pid) || 0) })
            : fmtKey('projectFiles.runFailed', { code: String((r && (r.code || r.error)) || 'unknown') });
        }
      };
    }
  }

  /* ── 控制台 = **容器内的 shell**（P4 定稿）：只在「项目 / 我的牛马」 + 容器真的就绪时可用 ──
     门禁顺序与主进程的 containerShellGate **完全一致**（不可用就一条命令都不执行）：
       ① 不在这两处聊天里 → 按钮本来就隐藏（不占位）
       ② 会话没开启"运行/测试在容器中" → 置灰 + notEnabled
       ③ 容器项目已停止（= 等同创建者下线）→ 置灰 + projectStopped
       ④ 所选运行时现在不是 ready → 置灰 + notReady（并给安装/启动引导）
       ⑤ 就绪但没有项目容器镜像 → 能打开面板，但**输入行禁用**、如实说明（现在是这一档）
     诚实边界：面板里写清"只有本机的人手动输入才会执行；远程/群成员/智能体没有注入路径；
     不自动跑；不带密钥环境变量"（契约见 container-probe 的 CONTAINER_SHELL_SECURITY）。 */
  async function refreshContainerConsoleGate() {
    const btn = $('btn-container-shell');
    if (!btn) return;
    const gate = await currentShellGate();
    // 按钮可用 = 面板能打开（引擎就绪）；能不能**跑命令**另有一说（见 applyShellAvailability）
    btn.disabled = !gate.openable;
    btn.dataset.gate = gate.openable ? 'ok' : gate.code;
    btn.dataset.gateReason = gate.reason;
    btn.dataset.shellExecutable = gate.available ? '1' : '0';
    btn.title = gate.openable ? t('container.console.tip') : t('container.console.' + gate.reason);
    const mianBan = $('ctg-shell-pane');
    if (mianBan && !mianBan.classList.contains('hidden')) applyShellAvailability(gate);
    return btn.dataset.gate;
  }

  /** 输入行的可用性 = 门禁的直接结果（不可用就 disabled，不是"能敲但被忽略"） */
  function applyShellAvailability(gate) {
    const input = $('ctg-shell-input');
    const send = $('ctg-shell-send');
    const note = $('ctg-shell-note');
    const status = $('ctg-shell-status');
    const usable = !!(gate && gate.available);
    if (input) {
      input.disabled = !usable;
      input.dataset.shellInput = usable ? 'enabled' : 'disabled';
    }
    if (send) send.disabled = !usable;
    if (status) {
      status.dataset.shellState = gate ? gate.code : 'unknown';
      status.textContent = t('container.console.' + ((gate && gate.reason) || 'notReady'));
    }
    if (note) {
      note.dataset.shellNote = usable ? 'ok' : ((gate && gate.code) || 'not-ready');
      note.textContent = t('container.console.' + ((gate && gate.reason) || 'notReady'));
    }
    return usable;
  }

  async function openContainerShell() {
    const mianBan = $('ctg-shell-pane');
    if (!mianBan) return false;
    const gate = await currentShellGate();
    if (!gate.openable) return false;
    mianBan.classList.remove('hidden');
    const hint = $('ctg-shell-hint');
    if (hint) hint.textContent = t('container.console.title');
    const out = $('ctg-shell-out');
    const sel = state.selectedChat;
    const conn = sel ? await window.warmy.projectState({ sessionId: sel.id }).catch(() => null) : null;
    const rec = { runtimeId: (conn && conn.ok && conn.state && conn.state.runtimeId) || '' };
    /**
     * **真的去问主进程**（不写死一段文案）：主进程做参数校验 + 门禁，
     * 并在任何未就绪的情况下如实拒绝（`executed: false`）—— 也就是**一条命令都没执行**。
     * 参数形状只有 { runtimeId, action }（action 是枚举）——**没有任何命令字符串**。
     */
    let xiangYing = null;
    try {
      xiangYing = await window.warmy.containerShell({ runtimeId: String(rec.runtimeId || ''), action: 'open', sessionId: sel ? sel.id : '' });
    } catch (e) {
      xiangYing = { ok: false, code: 'ipc-failed', reasonKey: 'notReady', security: null, error: String((e && e.message) || e) };
    }
    const lines = [
      t('container.console.intro'),
      '',
      fmtKey('container.console.stateLine', {
        code: String((xiangYing && xiangYing.code) || 'unknown'),
        why: t('container.console.' + ((xiangYing && xiangYing.reasonKey) || 'notReady')),
      }),
      '',
    ];
    if (!xiangYing || !xiangYing.ok) {
      lines.push(t('container.console.needsImage'));
      lines.push('');
      lines.push(t('container.console.linuxNode'));
      lines.push('');
      lines.push(t('container.console.noExec'));
      lines.push('');
    } else {
      /**
       * 第十六批：门禁通过 ⇒ **真的在容器里开了一条 shell**（`insideContainer:true` 是主进程
       * 回给我们的**事实**）。这里如实说明容器名与"容器是新起的还是原本就在"。
       */
      lines.push(fmtKey('container.console.openedInContainer', { container: String(xiangYing.containerRef || '') }));
      lines.push('');
      lines.push(xiangYing.containerCreated ? t('container.console.containerCreated') : t('container.console.containerReused'));
      lines.push('');
    }
    lines.push(t('container.console.security'));
    lines.push(fmtKey('container.console.securityDetail', {
      remote: String((xiangYing && xiangYing.security && xiangYing.security.remoteInjectPaths) ?? 0),
      auto: (xiangYing && xiangYing.security && xiangYing.security.autoRun) === true ? '1' : '0',
      secretEnv: (xiangYing && xiangYing.security && xiangYing.security.forwardsSecretEnv) === true ? '1' : '0',
    }));
    if (out) out.textContent = lines.join('\n') + '\n';
    applyShellAvailability(gate);
    return true;
  }

  /** 当前门禁（不复用按钮上的 dataset，避免"按钮被别处改过"时口径不一致） */
  async function currentShellGate() {
    const sel = state.selectedChat;
    const inChat = !!sel && (sel.kind === 'single' || sel.kind === 'internal');
    if (!inChat) return { available: false, openable: false, code: 'not-in-chat', reason: 'onlyInChat', needsInstall: false };
    await probeContainers(false);
    const xiangMuTai = sel.kind === 'internal' ? await quXiangMuTai(sel.id) : null;
    // 控制台只属于**容器开发**的项目：「运行/测试在容器中」那个选项已作废删除
    const runInContainer = !!(xiangMuTai && xiangMuTai.devEnv === 'container');
    // 运行时来自项目状态（containerProjectRuntime），不再有会话级的容器记录
    const rec = { runtimeId: (xiangMuTai && xiangMuTai.runtimeId) || '' };
    if (!runInContainer) return { available: false, openable: false, code: 'not-enabled', reason: 'notEnabled', needsInstall: false };
    if (xiangMuTai && xiangMuTai.stopped) return { available: false, openable: false, code: 'project-stopped', reason: 'projectStopped', needsInstall: false };
    const row = rec.runtimeId ? containerEntry(rec.runtimeId) : null;
    if (!row || row.status !== 'ready') return { available: false, openable: false, code: 'container-not-ready', reason: 'notReady', needsInstall: true };
    /**
     * 第十六批：引擎就绪 ⇒ **可以真的跑命令**（镜像表已钉死 digest、项目容器按需创建）。
     * 门禁第 ⑤ 档（`no-image`）只在"运行时不是容器可执行的白名单"时才成立 ——
     * 这与主进程 `containerShellGate({ imageReady })` 的判据保持一致。
     */
    const executable = rec.runtimeId === 'docker' || rec.runtimeId === 'podman' || rec.runtimeId === 'nerdctl' || rec.runtimeId === 'rancher-desktop';
    if (!executable) return { available: false, openable: true, code: 'no-image', reason: 'needsImage', needsInstall: false };
    return { available: true, openable: true, code: 'ok', reason: 'ok', needsInstall: false };
  }

  /**
   * 本机的人敲了一行 → 送到主进程（`action:'write'`）。
   * 主进程未就绪时**不会**执行任何东西（`executed:false`），这里如实回显拒绝，
   * 并且**不会**在本机执行、也**不会**把内容塞进事件日志（那是另一个面板）。
   */
  async function submitShellLine() {
    const gate = await currentShellGate();
    const input = $('ctg-shell-input');
    const out = $('ctg-shell-out');
    const line = input ? String(input.value || '') : '';
    if (!gate.available) {
      applyShellAvailability(gate);
      if (out) out.textContent += t('container.console.noExec') + '\n';
      return false;
    }
    if (!line.trim()) return false;
    const sel = state.selectedChat;
    const conn2 = sel ? await window.warmy.projectState({ sessionId: sel.id }).catch(() => null) : null;
    const rec = { runtimeId: (conn2 && conn2.ok && conn2.state && conn2.state.runtimeId) || '' };
    let xiangYing = null;
    try {
      xiangYing = await window.warmy.containerShell({ runtimeId: String(rec.runtimeId || ''), action: 'write', sessionId: sel ? sel.id : '', data: line });
    } catch (e) {
      xiangYing = { ok: false, code: 'ipc-failed', reasonKey: 'notReady', executed: false, error: String((e && e.message) || e) };
    }
    const executed = !!(xiangYing && xiangYing.ok && xiangYing.executed !== false);
    if (out) {
      out.textContent += (executed ? t('container.console.sent') : t('container.console.refused') + ' ') + line + '\n';
      if (!executed) out.textContent += t('container.console.' + ((xiangYing && xiangYing.reasonKey) || 'notReady')) + '\n';
      /**
       * 第十六批：**容器里的真实输出**原样贴出来（这是"真的在容器里跑"最直接的证据）。
       * 没有输出就什么都不加（不编一句"没有输出"以外的内容）。
       */
      if (executed && xiangYing && xiangYing.output) out.textContent += String(xiangYing.output);
      if (executed && xiangYing && xiangYing.autoSolidify && xiangYing.autoSolidify.done) {
        out.textContent += '\n' + fmtKey('container.env.solidify.done', {
          time: new Date().toLocaleString(), image: String(xiangYing.autoSolidify.imageRef || ''), id: '',
        });
      }
      out.scrollTop = out.scrollHeight;
    }
    if (input) input.value = '';
    return executed;
  }

  /* ══ 项目右键菜单的动作（第七批定稿）══════════════════════════════════════════
     · **启用/停用项目**：任何项目都有（与是否选了容器无关）；**容器没启动时不能启用**，
       提示"需先到设置中启动容器"并给与之前一致的跳转引导。
     · **切换容器…**：只属于"创建时选了容器开发的项目"；点开是**独立弹窗**，
       列出设置中已检测到的所有容器 + 「添加更多容器 → 跳转设置」；
       **项目正在运行时切换 ⇒ 提示"重启项目才能生效"**。
     · 右侧顶部**不再**有切换容器的入口（产品主明确要求）。
     ══════════════════════════════════════════════════════════════════════════ */

  /** 启用项目：容器开发项目必须先有就绪的容器，否则出提示 + 跳设置引导 */
  async function enableProjectFlow(groupId) {
    const r = await window.warmy.projectEnable({ sessionId: groupId }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (r && r.ok) {
      await afterProjectStateChange(groupId);
      const msg = $('project-ctl-msg') || $('project-state-msg');
      if (msg) msg.textContent = t('container.project.enabledAt');
      return true;
    }
    if (r && r.code === 'not-creator') { await uiAlert(t('container.project.notCreator'), t('container.devEnv.title')); return false; }
    if (r && (r.needsContainer || r.code === 'container-not-ready' || r.code === 'container-not-chosen')) {
      // 产品主定稿的那句提示 + 与之前一致的跳转引导
      const go = await uiConfirm(
        t('container.project.enableNeedsContainer'),
        t('container.project.enableNeedsContainerTitle')
      );
      if (go) await gotoContainerCard();
      return false;
    }
    await uiAlert(fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
    return false;
  }

  /** 停用项目（与容器无关；效果 = 不可用、只能看历史、对成员等同创建者下线） */
  async function disableProjectFlow(groupId) {
    const go = await uiConfirm(t('container.project.disableConfirmBody'), t('container.project.disableConfirmTitle'));
    if (!go) return false;
    const r = await window.warmy.projectDisable({ sessionId: groupId }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (!r || !r.ok) {
      if (r && r.code === 'not-creator') { await uiAlert(t('container.project.notCreator'), t('container.devEnv.title')); return false; }
      await uiAlert(fmtKey('container.project.disableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
      return false;
    }
    await afterProjectStateChange(groupId);
    return true;
  }

  /** 状态变化后把与项目有关的三处刷新一遍（右栏状态、三块文件事实、控制台门禁） */
  async function afterProjectStateChange(groupId) {
    const sel = state.selectedChat;
    if (sel && sel.id === groupId) {
      await renderProjectStateBlock();
      await renderProjectFilesBlock();
    }
    await yingYongXiangMuKaiFaMen();
    await refreshContainerConsoleGate();
  }

  /**
   * 「切换容器…」弹窗：列出**设置中已检测到的**所有容器（真探测，不写死），
   * 另给一个「添加更多容器 → 跳转设置」。项目正在运行时切换 ⇒ 提示"重启项目才能生效"。
   */
  async function switchContainerDialog(groupId) {
    const dev = await loadContainerDevMap();
    if (devEnvOf(dev, groupId) !== 'container') {
      await uiAlert(t('container.project.notContainerProject'), t('container.devEnv.title'));
      return null;
    }
    const rep = await probeContainers(true);
    const usable = (rep && rep.usableIds) || [];
    const cur = (await loadProjectRuntimeMap())[groupId] || '';
    const root = $('modal-root');
    $('modal-title').textContent = t('container.project.switchTitle');
    const body = $('modal-body');
    body.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ctg-dim';
    head.textContent = t('container.project.switchBody');
    body.appendChild(head);
    let done = false;
    const wanCheng = (v) => { if (done) return; done = true; root.classList.add('hidden'); resolveSwitch(v); };
    let resolveSwitch = null;
    const p = new Promise((res) => { resolveSwitch = res; });
    if (!usable.length) {
      const none = document.createElement('div');
      none.className = 'ctg-err';
      none.id = 'switch-none';
      none.textContent = fmtKey('container.project.switchNoContainer', { reason: noReadyReason(rep) });
      body.appendChild(none);
    }
    usable.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cur === id ? 'ctg-env-opt on' : 'ctg-env-opt';
      b.id = 'switch-rt-' + id;
      b.setAttribute('data-pick', id);
      b.innerHTML = '<span class="ctg-env-title">' + escapeHtml(t('container.rt.' + id + '.name')) + '</span>' +
        '<span class="ctg-dim">' + escapeHtml(t('container.project.switchFits')) + '</span>';
      b.onclick = () => wanCheng(id);
      body.appendChild(b);
    });
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const more = document.createElement('button');
    more.className = 'btn-mini';
    more.id = 'switch-more';
    more.textContent = t('container.project.switchMore');
    more.onclick = () => { wanCheng('__more__'); };
    const cancel = document.createElement('button');
    cancel.className = 'btn-mini';
    cancel.id = 'switch-cancel';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => wanCheng(null);
    acts.append(more, cancel);
    root.classList.remove('hidden');
    if (more) more.focus();
    const picked = await p;
    if (picked === '__more__') { await gotoContainerCard(); return null; }
    if (!picked) return null;
    const r = await window.warmy.projectSetContainer({ sessionId: groupId, runtimeId: picked }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (!r || !r.ok) {
      await uiAlert(fmtKey('container.project.switchFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
      return null;
    }
    await afterProjectStateChange(groupId);
    const msg = $('project-state-msg');
    if (msg) {
      msg.textContent = r.restartRequired
        ? t('container.project.switchNeedRestart')
        : fmtKey('container.project.switchDone', { name: t('container.rt.' + picked + '.name') });
    }
    return picked;
  }

  /** 项目右键菜单条目（追加到既有的 groupMenu 上；只在 internal 项目里出现） */
  async function projectMenuItems(g) {
    // 状态与"是不是容器开发项目"都问**主进程**（唯一事实来源），不在渲染层猜
    const state19 = await quXiangMuTai(g.id);
    const blocked = !!(state19 && state19.stopped);
    const dev = await loadContainerDevMap();
    const isContainerProject = devEnvOf(dev, g.id) === 'container';
    const items = [
      blocked
        ? {
            label: t('ctx.projectEnable'),
            onClick: async () => { await enableProjectFlow(g.id); },
          }
        : {
            label: t('ctx.projectDisable'),
            danger: true,
            onClick: async () => { await disableProjectFlow(g.id); },
          },
    ];
    // 只有"创建时选了容器开发的项目"才有切换容器的出口
    if (isContainerProject) {
      items.push({
        label: t('ctx.projectSwitchContainer'),
        onClick: async () => { await switchContainerDialog(g.id); },
      });
      /**
       * 第十六批新增两个入口：
       *  · 「设置项目目录」：把项目目录记进**项目记录**（成员据此解析"最近改动文件"）；
       *  · 「锁定/解锁项目目录」：**文件系统级**那道防线（可一键撤销，见 container.fsGuard.*）。
       */
      items.push({
        label: t('ctx.projectSetDir'),
        onClick: async () => {
          const r = await window.warmy.projectSetDirectory({ sessionId: g.id }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
          if (r && r.ok) {
            await afterProjectStateChange(g.id);
            const msg = $('project-state-msg');
            if (msg) msg.textContent = fmtKey('container.project.dirSet', { dir: String(r.dir || '') });
          } else if (r && !r.canceled) {
            await uiAlert(fmtKey('container.project.dirSetFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
          }
        },
      });
      items.push({
        label: t('ctx.projectLockDir'),
        onClick: async () => { await lockDirFlow(g.id); },
      });
    }
    return items;
  }

  /**
   * 「锁定/解锁项目目录」入口（右键菜单）：先进状态，再决定是"锁"还是"撤"。
   * 两个方向都**明确告知**：加锁改的是**文件系统 ACL**；撤销是一条命令、属主永远能自己改回来。
   */
  async function lockDirFlow(groupId) {
    const st = await window.warmy.projectFsGuard({ sessionId: groupId, action: 'status' })
      .catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
    if (!st || !st.ok) {
      const key = 'container.fsGuard.unavailable.' + String((st && st.code) || 'unknown');
      const text = t(key);
      await uiAlert(text === key ? fmtKey('container.project.enableFailed', { err: String((st && (st.error || st.code)) || 'unknown') }) : text, t('container.fsGuard.title'));
      return false;
    }
    const xiangJieChu = st.guarded === true;
    const keZhiXing = await uiConfirm(
      xiangJieChu ? t('container.fsGuard.confirmLiftBody') : t('container.fsGuard.confirmBody'),
      t('container.fsGuard.confirmTitle')
    );
    if (!keZhiXing) return false;
    const r = await window.warmy.projectFsGuard({ sessionId: groupId, action: xiangJieChu ? 'lift' : 'apply' })
      .catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
    if (!r || !r.ok) {
      const key = 'container.fsGuard.failed.' + String((r && r.code) || 'unknown');
      const text = t(key);
      await uiAlert(text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text, t('container.fsGuard.title'));
      return false;
    }
    await afterProjectStateChange(groupId);
    return true;
  }

  /** 多选项弹窗（走项目既有 #modal-root；标题/正文/按钮文案全走 i18n） */
  function uiChoice(titleText, bodyText, choices) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = titleText || displayName();
      $('modal-body').textContent = String(bodyText ?? '');
      const acts = $('modal-actions');
      acts.innerHTML = '';
      let done = false;
      const wanCheng = (v) => { if (done) return; done = true; root.classList.add('hidden'); resolve(v); };
      (choices || []).forEach((c) => {
        const b = document.createElement('button');
        b.className = c.primary ? 'btn-primary' : 'btn-mini';
        b.textContent = c.label;
        b.setAttribute('data-choice', c.key);
        b.id = 'ctg-choice-' + c.key;
        b.onclick = () => wanCheng(c.key);
        acts.appendChild(b);
      });
      root.classList.remove('hidden');
      const first = acts.querySelector('button');
      if (first) first.focus();
    });
  }

  // ── only-group / 右栏分区 显示/隐藏（唯一权威见 applyPanelVisibility） ──
  function updatePanelVisibility() {
    const kind = currentPanelKind();
    try {
      window.__panelLog = window.__panelLog || [];
      window.__panelLog.push({ f: 'update', kind, t: Date.now() });
      if (window.__panelLog.length > 60) window.__panelLog.shift();
    } catch { /* noop */ }
    applyPanelVisibility(kind);
    const shiQun = kind === 'internal' || kind === 'external' || kind === 'externalGroup' || kind === 'extgroup';
    document.querySelectorAll('.only-group').forEach((yuanSu) => {
      yuanSu.classList.toggle('hidden', !shiQun);
    });
    /**
     * ADR 004 §一.7：容器相关区块**只在「项目」与「我的牛马」**出现 ——
     * 联系人与群聊用不到容器，不显示（不是灰着占位）。
     */
    const showRunEnv = kind === 'single' || kind === 'internal';
    document.querySelectorAll('[data-only="proj-single"]').forEach((yuanSu) => {
      yuanSu.classList.toggle('hidden', !showRunEnv);
    });
    // 控制台（容器壳）只在「项目 / 我的牛马」出现 —— 与 ADR 004 §一.7 一致
    const shellBtn = $('btn-container-shell');
    if (shellBtn) shellBtn.classList.toggle('hidden', !showRunEnv);
    if (!showRunEnv) $('ctg-shell-pane')?.classList.add('hidden');
    // 容器项目停止态 ⇒ 开发入口（输入 + 发送）禁用 + 说明（成员侧与"创建者下线"一致）
    void yingYongXiangMuKaiFaMen();
    void refreshContainerConsoleGate();
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
    const shiQun = sel.kind === 'internal' || sel.kind === 'extgroup';
    let entries = [];
    if (shiQun) {
      const g = state.groups.find((x) => x.id === sel.id);
      const members = (g && g.members) || [];
      entries = members.map((m) => {
        const mingCheng = typeof m === 'string' ? m : (m && (m.name || m.id)) || '';
        const local = state.instances.find((i) => i.name === mingCheng || i.id === mingCheng);
        return local
          ? { inst: local, editable: true }
          : { inst: { name: mingCheng, availableModels: [], chain: [], defaultModel: '' }, editable: false };
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

  /** 添加模型：选供应商 → 拉取 → 勾选；入口含「编辑供应商」跳设置-模型 */
  function pickModelsToAdd(inst) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('model.addTitle');
      const body = $('modal-body');
      const gongYingShangJi = state.providers || [];
      const editProvLabel = t('model.editProvider') || t('settings.providers');
      body.innerHTML = `<div class="field">
          <label>${t('model.pickProvider')}</label>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="mp-prov" style="flex:1">${gongYingShangJi.map((p, i) => `<option value="${i}">${escapeHtml(p.label || p.id)}</option>`).join('')}</select>
            <button class="btn-mini" id="mp-fetch">${t('model.fetch')}</button>
            <button class="btn-mini" id="mp-edit-prov" title="${escapeHtml(editProvLabel)}">${escapeHtml(editProvLabel)}</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px">${t('model.fetchHint')}</div>
        <div class="model-pick-list" id="mp-list"></div>`;
      const listBox = $('mp-list');
      const renderList = () => {
        const p = gongYingShangJi[Number($('mp-prov').value)] || {};
        const yiYou = new Set(inst.availableModels || []);
        const cand = (p.models || []).filter((m) => !yiYou.has(m));
        listBox.innerHTML = cand.length
          ? cand.map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}"/> ${escapeHtml(m)}</label>`).join('')
          : `<div class="muted">${t('model.noneAvailable')}</div>`;
      };
      renderList();
      $('mp-prov').onchange = renderList;
      $('mp-fetch').onclick = async () => {
        const btn = $('mp-fetch');
        btn.textContent = t('common.loading');
        const p = gongYingShangJi[Number($('mp-prov').value)] || {};
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
      /** 跳到 设置 → 模型：**先确认**（弹窗关闭不可回退，必须告知用户） */
      const goEditProviders = async () => {
        const keZhiXing = await uiConfirm(
          t('model.editProviderConfirmBody') ||
            '将关闭本弹窗并跳转到「设置 → 模型」编辑供应商。添加模型的选择会丢失，确定继续？',
          t('model.editProviderConfirm') || t('model.editProvider')
        );
        if (!keZhiXing) return; // 取消：停留在添加模型弹窗
        root.classList.add('hidden');
        resolve(null);
        try {
          setNav('settings');
          const DaoHangAnNiu = document.querySelector('#settings-nav button[data-sec="model"]');
          if (DaoHangAnNiu) DaoHangAnNiu.click();
          requestAnimationFrame(() => {
            const card = document.querySelector('#prov-list')?.closest('.set-section') || $('prov-list');
            if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
            const idx = Number($('mp-prov') ? $('mp-prov').value : -1);
            const want = gongYingShangJi[idx];
            if (want) {
              const rows = document.querySelectorAll('#prov-list .prov-row, #prov-list > div');
              rows.forEach((yuanSu) => {
                const txt = yuanSu.textContent || '';
                if (txt.includes(want.label || want.id || '')) yuanSu.classList.add('prov-focus');
              });
            }
          });
        } catch { /* noop */ }
      };
      const editBtn = $('mp-edit-prov');
      if (editBtn) editBtn.onclick = () => { void goEditProviders(); };
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn-mini';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('hidden'); resolve(null); };
      const editProv = document.createElement('button');
      editProv.className = 'btn-mini';
      editProv.textContent = editProvLabel;
      editProv.onclick = () => { void goEditProviders(); };
      const okAdd = document.createElement('button');
      okAdd.className = 'btn-primary';
      okAdd.textContent = t('model.addSelected');
      okAdd.onclick = () => {
        const picked = Array.from(listBox.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
        root.classList.add('hidden');
        resolve(picked);
      };
      acts.append(editProv, cancel, okAdd);
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
    const shuRu = $('search-popup-input');
    shuRu?.focus();
    let timer = null;
    shuRu?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = shuRu.value.trim();
        if (!q) { $('search-popup-results').textContent = ''; return; }
        const r = await window.warmy.searchMessages(q).catch(() => null);
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
      const r = await window.warmy.exportSession({
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
  document.querySelectorAll('.rail-item').forEach((yuanSu) => {
    yuanSu.onclick = () => setNav(yuanSu.dataset.nav);
  });
  $('list-search').addEventListener('input', () => renderList());
  $('btn-send').addEventListener('click', () => send());
  $('btn-stop-all')?.addEventListener('click', () => stopAllAi());
  $('btn-attach').addEventListener('click', async () => {
    const r = await window.warmy.pickFile();
    if (r?.ok) {
      const name = r.path.split(/[\\/]/).pop();
      state.attachments.push({ name, path: r.path });
      xuanranFujian();
    }
  });

  bindResizer($('col-resizer'), '--list-w', 200, 420, { persistKey: 'listWidth', resetWidth: 220 });
  // R3：聊天区 ↔ 右栏 —— 右栏在右边（dir:'right'），左侧聊天区保底 320px，宽度走 settings 里的 panelWidth
  bindResizer($('panel-resizer'), '--panel-w', 220, 480, {
    dir: 'right',
    hostId: 'chat-layout',
    minOther: 320,
    persistKey: 'panelWidth',
    resetWidth: 300,
  });

  async function refreshCost() {
    const box = $('cost-box');
    if (!box) return;
    const c = await window.warmy.costSummary().catch(() => null);
    if (c?.ok) {
      box.textContent = '¥' + c.estCostCny + ' · ' + c.promptTokens + ' in / ' + c.completionTokens + ' out · cache ' + ((c.cacheHitRate||0)*100).toFixed(1) + '%';
    }
  }
  

  async function refreshMetrics() {
    const box = $('metrics-box');
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
    const box = $('cost-dash');
    if (!box) return;
    const r = await window.warmy.metricsTurns().catch(() => null);
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
        const yunXingJieGuo = await window.warmy.saveText({
          defaultName: 'warmy-cost.csv',
          content: lines.join('\n'),
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (yunXingJieGuo && yunXingJieGuo.ok) uiAlert(t('instances.saved'));
        else if (yunXingJieGuo && yunXingJieGuo.error) uiAlert(String(yunXingJieGuo.error));
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
    // ADR 004 §7.6：回退点 = **文件 + 环境指纹**（环境那一维由容器镜像/快照承担）
    const r = await window.warmy.checkpointList({ sessionId: state.selectedChat ? state.selectedChat.id : '' });
    const list = r?.list || [];
    const envByCp = (r && r.envByCheckpoint) || {};
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
        const faShengShiJian = now - c.createdAt < 86400000 ? hm : d.toLocaleString();
        const envRec = (envByCp || {})[String(c.id)] || null;
        const cur = (r && r.currentEnv) || { active: false, runtimeId: '', revision: 'host' };
        const rtName = (id) => (id ? t('container.rt.' + id + '.name') : t('container.current.none'));
        const envLine = envRec
          ? fmtKey('checkpoints.env.recorded', { runtime: rtName(envRec.runtimeId), revision: String(envRec.revision || '') })
          : t('checkpoints.env.none');
        const envDiff = envRec && String(envRec.revision || '') !== String(cur.revision || '')
          ? '<div class="ctg-dim cp-env-changed" data-env-changed="1">' +
            escapeHtml(fmtKey('checkpoints.env.changed', { was: String(envRec.revision || ''), now: String(cur.revision || '') })) + '</div>'
          : '<div class="ctg-dim" data-env-changed="0">' + escapeHtml(t('checkpoints.env.same')) + '</div>';
        return `<details class="cp-item" data-id="${escapeHtml(String(c.id))}" data-env-revision="${escapeHtml(String((envRec && envRec.revision) || ''))}">
          <summary>${escapeHtml(String(faShengShiJian))} · ${escapeHtml(String(c.phase || ''))} · ${escapeHtml(String(c.strategy || ''))}</summary>
          <div class="cp-body">
            <div>${t('checkpoints.tasks')}: ${escapeHtml(c.phase || '')}</div>
            <div class="ctg-dim">${escapeHtml(t('checkpoints.env.title'))}</div>
            <div class="ctg-dim" data-env-line="1">${escapeHtml(envLine)}</div>
            <div class="ctg-dim">${escapeHtml(fmtKey('checkpoints.env.current', { runtime: rtName(cur.runtimeId), revision: String(cur.revision || '') }))}</div>
            ${envDiff}
            <div class="ctg-dim">${escapeHtml(t('checkpoints.env.layered'))}</div>
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
        const rb = await window.warmy.checkpointRollback(b.dataset.load, { sessionId: state.selectedChat ? state.selectedChat.id : '' });
        // 文件回退成功 ≠ 环境也回退了：环境变了就**如实说**（这正是"环境指纹"这条增益的用处）
        if (rb && rb.env && rb.env.changed) {
          await uiAlert(fmtKey('checkpoints.env.changed', {
            was: String((rb.env.recorded && rb.env.recorded.revision) || ''),
            now: String((rb.env.current && rb.env.current.revision) || ''),
          }), t('checkpoints.title'));
        } else {
          uiAlert(t('instances.saved'));
        }
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
  $('btn-cp-list')?.addEventListener('click', refreshCheckpoints);
  async function refreshSessionBoard() {
    const box = $('board-sess-box');
    if (!box || !state.selectedChat) return;
    const r = await window.warmy.boardSession(state.selectedChat.id).catch(() => null);
    const tasks = r?.tasks || [];
    box.innerHTML = tasks.length
      ? tasks.map((t) => '<div>' + escapeHtml(t.title) + ' · ' + clampPercent(t.progress) + '% · ' + escapeHtml(String(t.status || '')) + '</div>').join('')
      : '—';
  }
  /**
   * 数据卡片指标（**不是**卡顿自检）：把当前状态里的副本数、保留天数与字节估算
   * 渲染进 #settings-data-metrics 的三个格子；数字先过 fmtDisp，渲染成
   * `[object Object]` 的一律显示占位符「—」。由 bindDataMetricsOnly() 在设置页调用。
   * ⚠️ 这里既不测主进程 CPU/事件循环延迟，也不测渲染进程帧率 —— 那是**已退休**的
   * 卡顿自检（入口与采样逻辑整块移除），旧注释是历史残留。
   */
  function renderDataMetrics() {
    const box = $('settings-data-metrics');
    if (!box) return;
    const replicas = (state.groups || []).length || 0;
    const retentionDays = 30;
    const byteSample = 1024 * (state.instances || []).length;
    const ge = (k, v) => '<div class="diag-cell"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(fmtDisp(v)) + '</div></div>';
    box.innerHTML =
      ge(t('settings.dataReplicas'), replicas) +
      ge(t('settings.dataRetention'), retentionDays) +
      ge(t('settings.dataBytes'), byteSample);
    box.querySelectorAll('.v').forEach((yuanSu) => {
      if (yuanSu.textContent.indexOf('[object Object]') !== -1) yuanSu.textContent = '—';
    });
  }

  /** 数据卡片指标（保留）。卡顿自检入口与采样逻辑已整块移除。 */
  function bindDataMetricsOnly() {
    renderDataMetrics();
  }

  function bindSkillScanDirs() {
    const tianJiaAnNiu = $('btn-skill-scan-add');
    const shuRu = $('skill-scan-dir-input');
    const msg = $('skill-scan-msg');
    if (!tianJiaAnNiu || tianJiaAnNiu.dataset.bound === '1') return;
    tianJiaAnNiu.dataset.bound = '1';
    tianJiaAnNiu.onclick = async () => {
      const v = String((shuRu && shuRu.value) || '').trim();
      if (!v) {
        if (msg) msg.textContent = t('settings.skillsScanInvalid');
        return;
      }
      const cur = await skillScanDirsGet();
      const dirs = ((cur && cur.dirs) || []).slice();
      const editRaw = shuRu && shuRu.getAttribute('data-edit-i');
      const editing = editRaw !== null && editRaw !== undefined && editRaw !== '';
      const MAX = 10;
      if (!editing && dirs.length >= MAX) {
        if (msg) msg.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      if (editing) {
        const i = Number(editRaw);
        if (Number.isInteger(i) && i >= 0 && i < dirs.length) dirs[i] = v;
        else if (dirs.length < MAX) dirs.push(v);
        else {
          if (msg) msg.textContent = t('settings.skillsScanMax');
          return;
        }
      } else {
        if (dirs.indexOf(v) >= 0) {
          if (msg) msg.textContent = t('settings.skillsScanInvalid');
          return;
        }
        dirs.push(v);
      }
      if (dirs.length > MAX) {
        if (msg) msg.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      const yunXingJieGuo = await skillScanDirsSet(dirs);
      if (yunXingJieGuo && yunXingJieGuo.ok === false) {
        if (msg) msg.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      if (shuRu) {
        shuRu.value = '';
        shuRu.removeAttribute('data-edit-i');
      }
      tianJiaAnNiu.textContent = t('settings.skillsScanAdd');
      await renderSkillScanDirs();
      await renderSkillList();
      const st = (window.__skillScanState && window.__skillScanState.scanDirs) || [];
      const bad = st.filter((s) => s && s.ok === false);
      if (msg) {
        msg.textContent = bad.length
          ? t('settings.skillsScanMissing') + ': ' + bad.map((s) => s.path).join(' · ')
          : t('settings.skillsScanOk');
      }
    };
  }

  function skillSourceLabel(s) {
    if (!s) return '';
    if (s.source === 'discovered') return t('settings.skillSourceDiscovered');
    if (s.source === 'userData') return t('settings.skillSourceUserData');
    if (s.source === 'workspace') return t('settings.skillSourceWorkspace');
    return String(s.source || '');
  }

  async function renderSkillList() {
    const box = $('skill-list');
    if (!box) return;
    // 无论是否已安装 skill，设置→功能 里始终展示管理面板
    box.className = '';
    const importBtn = $('btn-skill-import');
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
    let items = [];
    let scanDirs = [];
    try {
      const pr = await window.warmy.skillsPaths?.().catch(() => null);
      const r0 = await window.warmy.skillsList().catch(() => null);
      scanDirs = (r0 && r0.scanDirs) || (pr && pr.scanDirs) || [];
      items = (r0 && r0.skills) || [];
      const bad = scanDirs.filter((s) => s && s.ok === false);
      const pb = $('skill-paths');
      if (pb) {
        let txt = t('settings.skillsPaths') + ': ' + ((pr && pr.paths) || []).join('  ·  ');
        if (bad.length) txt += '  ·  ' + t('settings.skillsScanMissing') + ': ' + bad.map((s) => s.path).join(' · ');
        const max = (r0 && r0.maxScanDirs) || 10;
        txt += '  ·  ' + t('settings.skillsScanTitle') + ` (${scanDirs.length}/${max})`;
        pb.textContent = txt;
      }
    } catch { /* keep going */ }

    window.__skillsState = { items: items.slice(), scanDirs };

    const head = '<div class="skill-list-head">' + escapeHtml(t('settings.skillsDiscoveredTitle')) +
      ' <span class="muted">(' + items.length + ')</span></div>';

    if (!items.length) {
      box.innerHTML = head +
        '<div class="muted">' + escapeHtml(t('settings.skillsEmpty')) + '</div>' +
        '<div class="muted">' + escapeHtml(t('settings.skillsHint')) + '</div>';
      return;
    }

    box.innerHTML =
      head +
      items
        .map((s) => {
          const discovered = s && s.source === 'discovered';
          const enabled = s && s.enabled !== false;
          const removable = s && s.removable !== false && !discovered;
          const id = escapeHtml(s.id || '');
          return (
            '<div class="skill-row' + (discovered ? ' is-discovered' : '') + '" data-skill-id="' + id + '" data-skill-source="' + escapeHtml((s && s.source) || '') + '">' +
            '<div class="skill-main">' +
            '<div class="skill-name">' + escapeHtml(s.name || s.id) +
            ' <span class="skill-status ' + (enabled ? 'is-on' : 'is-off') + '">' + escapeHtml(enabled ? t('settings.skillEnabled') : t('settings.skillPaused')) + '</span></div>' +
            '<div class="muted skill-desc">' + escapeHtml(s.description || '—') + '</div>' +
            '<div class="muted skill-src">' + t('settings.skillFrom') + ': ' + escapeHtml(skillSourceLabel(s)) +
            (discovered ? ' · ' + escapeHtml(t('settings.skillSourceDiscovered')) : '') + '</div>' +
            '</div>' +
            '<div class="skill-actions">' +
            '<button class="btn-mini" data-skill-toggle="' + id + '" data-enabled="' + (enabled ? '1' : '0') + '">' +
            escapeHtml(enabled ? t('settings.skillsPause') : t('settings.skillsEnable')) + '</button>' +
            (removable
              ? '<button class="btn-danger" data-skill-del="' + id + '">' + escapeHtml(t('settings.skillRemove')) + '</button>'
              : '<button class="btn-danger" disabled title="' + escapeHtml(t('settings.skillDeleteLocked')) + '">' + escapeHtml(t('settings.skillRemove')) + '</button>') +
            '</div>' +
            '</div>'
          );
        })
        .join('');

    box.querySelectorAll('[data-skill-toggle]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.skillToggle;
        const nowOn = b.dataset.enabled === '1';
        const r = await window.warmy.skillsSetEnabled?.({ id, enabled: !nowOn }).catch(() => null);
        if (r && r.ok === false) uiAlert(String(r.error || ''));
        renderSkillList();
      };
    });
    box.querySelectorAll('[data-skill-del]').forEach((b) => {
      if (b.disabled) return;
      b.onclick = async () => {
        const id = b.dataset.skillDel;
        if (!(await uiConfirm(t('settings.skillRemove') + ': ' + id + '?'))) return;
        const yunXingJieGuo = await window.warmy.skillsRemove(id);
        if (yunXingJieGuo && yunXingJieGuo.ok === false) uiAlert(String(yunXingJieGuo.error || ''));
        renderSkillList();
      };
    });
  }

  async function refreshMembers() {
    const box = $('members-box');
    if (!state.selectedChat) return;
    const r = await window.warmy.groupMembers(state.selectedChat.id).catch(() => null);
    const ms = (r && r.members) || [];
    /* 成员表**回填进 state.groups**：
       群记录（group-store 的 GroupRecord / warmy:group-list）里**没有**成员形状，
       而「模型管理」面板与列表行的成员数都读 `g.members` —— 不回填的话这两个地方会
       恒显示"暂无可管理的牛马 / 0 名成员"，明明群里有成员（实测：无组网巡检第 19 节）。
       只在真的变了的时候才重渲染，避免每 15s 的定时刷新把用户正在编辑的卡片刷掉。 */
    const group = (state.groups || []).find((x) => x.id === state.selectedChat.id);
    if (group) {
      const next = ms.map((x) => ({ id: x.id || x.name, name: x.name }));
      if (JSON.stringify(group.members || []) !== JSON.stringify(next)) {
        group.members = next;
        renderModelMgr();
        renderList();
      }
    }
    if (!box) return;
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
                    ? { state: 'offline', key: 'group.memberOffline', hintKey: 'group.memberPendingConfirm' }
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
              '<div class="member-row' + cls + '" data-mid="' + escapeHtml(String(x.id || x.name)) + '" data-state="' + v.kind + '"' +
              ' data-presence-basis="' + escapeHtml(v.basis || '') + '"' +
              (v.fingerprint ? ' data-fp="' + escapeHtml(v.fingerprint) + '"' : '') +
              (v.remote && v.basis === 'unattributed'
                ? ' data-presence-unknown="1" title="' + escapeHtml(t('group.memberPresenceUnknown')) + '"'
                : '') +
              '>' +
              '<span class="member-name' + (v.kind === 'disabled' ? ' struck' : '') + '">' +
              escapeHtml(x.name) + ' · ' + escapeHtml(String(x.role || '')) +
              '</span>' +
              (v.remote && v.basis === 'unattributed'
                ? '<span class="member-badge" data-state="unattributed">' + escapeHtml(t('group.memberUnattributed')) + '</span>'
                : '') +
              (v.remote ? '<span class="member-badge remote" data-state="remote">' + escapeHtml(t('group.memberRemote')) + '</span>' : '') +
              (badge ? '<span class="member-badge" data-state="' + badge.state + '"' + (badge.hintKey ? ' title="' + escapeHtml(t(badge.hintKey)) + '"' : '') + '>' + escapeHtml(t(badge.key)) + '</span>' : '') +
              (v.kind === 'offline'
                ? '<div class="member-hint muted">' + escapeHtml(t('group.memberPendingConfirm')) + ' · ' + escapeHtml(t('group.memberPendingConfirmHint')) + '</div>'
                : '') +
              '<button class="btn-mini" data-mkick="' + escapeHtml(String(x.id || x.name)) + '">' + t('group.kick') + '</button>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="muted">' + t('group.memberEmpty') + '</div>';
    box.querySelectorAll('[data-mkick]').forEach((b) => {
      b.onclick = async () => {
        await window.warmy.groupKick({ groupId: state.selectedChat.id, memberId: b.dataset.mkick });
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
    void renderMembershipCerts(state.selectedChat && state.selectedChat.id, ms);
  }

  /** B9：群成员面板「身份凭证」只读区块（不做签发/换证/吊销等危险操作） */
  function shortFp(fp) {
    const s = String(fp || '').replace(/[^0-9a-fA-F]/g, '');
    if (!s) return '—';
    if (s.length <= 12) return s;
    return s.slice(0, 8) + '…' + s.slice(-4);
  }
  function certStatusKey(code, valid) {
    const c = String(code || '');
    if (c === 'expired') return 'group.cert.expired';
    if (c.indexOf('revok') === 0) return 'group.cert.revoked';
    if (valid === true && (!c || c === 'ok')) return 'group.cert.valid';
    return 'group.cert.none';
  }
  async function renderMembershipCerts(groupId, members) {
    let host = $('membership-certs');
    if (!host) {
      const box = $('members-box');
      if (!box || !box.parentElement) return;
      host = document.createElement('div');
      host.id = 'membership-certs';
      host.className = 'set-card membership-certs';
      box.parentElement.appendChild(host);
    }
    if (!groupId) {
      host.innerHTML = '<h3>' + escapeHtml(t('group.cert.title')) + '</h3><div class="muted">' + escapeHtml(t('group.cert.unavailable')) + '</div>';
      return;
    }
    let snap = null;
    try {
      if (window.warmy && typeof window.warmy.membershipList === 'function') {
        snap = await window.warmy.membershipList({ groupId });
      }
    } catch {
      snap = null;
    }
    const group = snap && Array.isArray(snap.groups) ? (snap.groups.find((g) => g.groupId === groupId) || snap.groups[0]) : null;
    const certs = (group && group.certs) || [];
    const byName = {};
    certs.forEach((c) => {
      const n = c.displayName || '';
      if (!byName[n]) byName[n] = [];
      byName[n].push(c);
    });
    const rows = (members || []).map((m) => {
      const name = String(m.name || '');
      const bao = netState.presence[groupId] || {};
      const p = bao[name] || bao[String(m.id || name)] || {};
      const list = (byName[name] || []).slice();
      if (!list.length && p.fp) {
        certs.forEach((c) => { if (c.memberFingerprint === p.fp) list.push(c); });
      }
      const best = list.slice().sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0))[0] || null;
      const fp = (best && best.memberFingerprint) || p.fp || '';
      const status = best ? t(certStatusKey(best.code, best.valid)) : t('group.cert.none');
      const rotated = !!(best && best.supersedes);
      return (
        '<div class="cert-row" data-member="' + escapeHtml(name) + '">' +
        '<div class="cert-name">' + escapeHtml(name) + '</div>' +
        '<div class="cert-fp" title="' + escapeHtml(fp || t('group.cert.showFull')) + '" data-fp-full="' + escapeHtml(fp) + '">' + escapeHtml(shortFp(fp)) + '</div>' +
        '<div class="cert-status" data-code="' + escapeHtml((best && best.code) || 'none') + '">' + escapeHtml(status) + '</div>' +
        (rotated ? '<div class="cert-rotated">' + escapeHtml(t('group.cert.rotated')) + ' · ' + escapeHtml(t('group.cert.generation')) + ' ' + list.length + '</div>' : '') +
        '</div>'
      );
    }).join('');
    host.innerHTML =
      '<h3>' + escapeHtml(t('group.cert.title')) + '</h3>' +
      '<p class="muted">' + escapeHtml(t('group.cert.readonlyHint')) + '</p>' +
      (rows || '<div class="muted">' + escapeHtml(t(group ? 'group.cert.emptyGroup' : 'group.cert.unavailable')) + '</div>') +
      (certs.length
        ? '<div class="muted cert-full-list">' + certs.map((c) =>
            '<div>' + escapeHtml(c.displayName || '—') + ' · ' + escapeHtml(String(c.memberFingerprint || '')) + ' · ' + escapeHtml(t(certStatusKey(c.code, c.valid))) + '</div>'
          ).join('') + '</div>'
        : '');
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
      const r = await window.warmy.groupJoinInstance(state.selectedChat.id, instId);
      if (r && r.ok === false) {
        await window.warmy.groupInvite({ groupId: state.selectedChat.id, name: (inst && inst.name) || instId });
      }
    } catch {
      await window.warmy.groupInvite({ groupId: state.selectedChat.id, name: (inst && inst.name) || instId });
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
        send();
      } else {
        await window.warmy.clearError();
      }
    }
  }
  

  // R. 启动引导：让用户「选」语言，而不是手输 locale 字符串
  function pickOnboardingLocale() {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('setup.title') || t('settings.language');
      $('modal-body').innerHTML =
        '<div class="muted" style="margin-bottom:8px">' + escapeHtml(t('setup.pickLanguage') || t('settings.language')) + '</div>' +
        '<div class="field"><label>' + escapeHtml(t('setup.locale') || t('settings.language')) + '</label>' +
        '<select id="setup-locale">' + localeOptionsHtml(state.locale) + '</select></div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const QueDingAnNiu = document.createElement('button');
      QueDingAnNiu.className = 'btn-primary';
      QueDingAnNiu.textContent = t('setup.start') || t('common.ok');
      const sel = () => $('setup-locale');
      QueDingAnNiu.onclick = () => {
        const v = sel() ? sel().value : 'zh-CN';
        root.classList.add('hidden');
        resolve(v);
      };
      // live preview when user changes language in the picker
      if (sel()) {
        sel().onchange = async () => {
          const v = sel().value;
          try { await loadI18n(resolveLocalePack(v)); } catch { /* noop */ }
          $('modal-title').textContent = t('setup.title') || t('settings.language');
          const hint = $('modal-body').querySelector('.muted');
          if (hint) hint.textContent = t('setup.pickLanguage') || t('settings.language');
          const lab = $('modal-body').querySelector('label');
          if (lab) lab.textContent = t('setup.locale') || t('settings.language');
          QueDingAnNiu.textContent = t('setup.start') || t('common.ok');
        };
      }
      acts.append(QueDingAnNiu);
      root.classList.remove('hidden');
    });
  }

  function showPrivacyPolicyModal() {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('privacy.title');
      $('modal-body').innerHTML =
        '<div class="privacy-view" id="privacy-modal-body" style="max-height:300px">' + privacyHtml(t('privacy.body')) + '</div>' +
        '<div class="muted" id="privacy-hint" style="margin-top:8px">' + escapeHtml(t('privacy.scrollHint')) + ' · ' + escapeHtml(t('privacy.waitHint')) + '</div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const no = document.createElement('button');
      no.className = 'btn-mini';
      no.textContent = t('privacy.disagree');
      no.onclick = async () => {
        root.classList.add('hidden');
        await window.warmy.privacyConsentSet?.(false).catch(() => {});
        await window.warmy.appQuit?.('privacy-disagree').catch(() => {});
        resolve(false);
      };
      const yes = document.createElement('button');
      yes.className = 'btn-primary';
      yes.textContent = t('privacy.agree');
      yes.disabled = true;
      let scrolledEnd = false;
      let openedAt = Date.now();
      const box = () => $('privacy-modal-body');
      const tongBu = () => {
        const yuanSu = box();
        if (yuanSu) {
          const atEnd = yuanSu.scrollTop + yuanSu.clientHeight >= yuanSu.scrollHeight - 4;
          if (atEnd) scrolledEnd = true;
        }
        const longEnough = Date.now() - openedAt >= 3000;
        yes.disabled = !(scrolledEnd && longEnough);
        yes.style.opacity = yes.disabled ? '0.5' : '1';
      };
      box()?.addEventListener('scroll', tongBu);
      const timer = setInterval(tongBu, 200);
      yes.onclick = async () => {
        clearInterval(timer);
        root.classList.add('hidden');
        await window.warmy.privacyConsentSet?.(true).catch(() => {});
        resolve(true);
      };
      acts.append(no, yes);
      root.classList.remove('hidden');
      openedAt = Date.now();
      tongBu();
    });
  }
  async function maybeShowSetup() {
    const st = await window.warmy.setupState().catch(() => null);
    const settings = await window.warmy.settingsGet?.().catch(() => null);
    const consented = !!(settings && settings.settings && settings.settings.privacyConsent);
    if (!st || st.done) {
      // 已完成语言选择但未同意隐私：再次打开也要先弹隐私政策
      if (!consented) {
        const okp = await showPrivacyPolicyModal();
        if (!okp) return;
      }
      return;
    }
    const pick = await pickOnboardingLocale();
    if (pick) {
      await window.warmy.setupComplete({ locale: pick }).catch(() => {});
      if (resolveLocalePack(state.locale) !== resolveLocalePack(pick)) {
        try { await loadI18n(resolveLocalePack(pick)); } catch { /* noop */ }
      }
      await window.warmy.settingsSave({ locale: pick }).catch(() => {});
    } else {
      await window.warmy.setupComplete({}).catch(() => {});
    }
    await showPrivacyPolicyModal();
  }
  // 安装/首启：必须弹出语言选择（setupDone !== true）
  void maybeShowSetup();

  async function shuaxinZhixingqiji() {
    const box = $('exec-box');
    if (!box) return;
    const r = await window.warmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + escapeHtml(String(it.status || '')) + ' · ' + escapeHtml(String(it.durationMs ?? 0)) + 'ms</div>').join('')
      : '—';
  }
  $('btn-exec-run')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.warmy.executorsRunBrief({ brief, contextItems: [] });
    shuaxinZhixingqiji();
  });
  

  /** 知识库检索：结果可点击跳转（跳到聊天搜索）并可删除 */
  async function runKbQuery(q) {
    const out = $('kb-out');
    if (!out) return;
    const r = await window.warmy.knowledgeQuery(q).catch(() => null);
    const det = await window.warmy.kbDetail(q).catch(() => null);
    const ents = (r && r.entities) || (det && det.entities) || [];
    const evs = (r && r.events) || [];
    const rows = [];
    ents.forEach((e) => {
      const id = String(e.id || e.name);
      rows.push(
        '<div class="kb-row"><button class="kb-link" data-kbent="' + escapeHtml(id) + '">' +
          escapeHtml(e.name || id) + '</button><span class="muted" style="font-size:11px">' + escapeHtml(e.kind === 'entity' || !e.kind ? t('knowledge.kind.entity') : (e.kind === 'event' ? t('knowledge.kind.event') : String(e.kind))) + '</span>' +
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
          const shuRu = $('search-popup-input');
          if (!shuRu) return;
          shuRu.value = kw;
          shuRu.dispatchEvent(new Event('input', { bubbles: true }));
        }, 80);
      };
    });
    // 删除
    out.querySelectorAll('[data-kbdel]').forEach((b) => {
      b.onclick = async () => {
        const kind = b.dataset.kbdel;
        const id = b.dataset.kbid;
        if (!(await uiConfirm(t('knowledge.delete') + ': ' + id + '?'))) return;
        const yunXingJieGuo = await window.warmy.kbDelete({ kind, id }).catch(() => null);
        if (yunXingJieGuo && yunXingJieGuo.ok === false) uiAlert(String(yunXingJieGuo.error || ''));
        runKbQuery(q);
      };
    });
  }

  $('btn-kb-go')?.addEventListener('click', () => {
    const q = $('kb-q').value.trim();
    if (q) void runKbQuery(q);
  });

  /* ══════════════════════════════════════════════════════════════════════════
     扫**别人的**二维码（R16）：本机离线把一张图片解成加入链接，再喂给**同一条**加入路径
     ---------------------------------------------------------------------------
     反向链路（「我的二维码」是编码，这里是解码）：
        选图 / 拖入 / 粘贴 → FileReader.readAsDataURL → Image → canvas → getImageData
        → window.jsQR（vendored 经典脚本 vendor/jsqr-1.4.0.js）→ 载荷
        → 链接语法校验 → 写回链接输入框（用户看得见）→ 与「确定」按钮**同一个**加入函数
     纪律（踩过的坑都在这几句里）：
       * **全程本机、零联网**：解码器是 vendored 文件（Apache-2.0，许可证在同目录），
         不是 CDN、不是 npm 依赖、不是 Worker / WASM；
       * 图片源用 data: URL 而不是 blob:/file: —— file:// 文档里那种图会把 canvas 变脏，
         getImageData 会直接抛 SecurityError（data: URL 不污染 canvas）；
       * 解不出来 / 读出来的不是加入链接 → **各自专用文案如实说**，绝不静默、绝不编造联系人；
       * 大图（4000px 手机照片）按几个尺寸各试一遍；仍不中才换 90/180/270 三个角度重试
         （EXIF 旋转正常由浏览器按 image-orientation:from-image 处理，这里只兜"EXIF 被抹掉"的图）。
     ══════════════════════════════════════════════════════════════════════════ */

  /** 解码器是否加载上了（拿不到就如实说"本机暂时无法识图"，不假装能扫） */
  function qrDecoderAvailable() {
    return typeof window !== 'undefined' && typeof window.jsQR === 'function';
  }

  /**
   * 图片解码尝试计划（顺序即代价顺序）：
   *   1) 最长边缩到 1400 —— 手机照片（常见 3000~4000px）缩完仍远高于 QR 采样需要，且快得多；
   *   2) 最长边缩到 800  —— 更小的图更"平整"，有时反而比大图更容易被识别；
   *   3) 1400 再来 90/180/270 —— 前置 0° 已在第 1 步试过，不重复。
   * 只缩不放：小图不会被放大（放大只会插值出假模块）。
   */
  const QR_SCAN_STEPS = [
    { maxDim: 1400, rotations: [0] },
    { maxDim: 800, rotations: [0] },
    { maxDim: 1400, rotations: [90, 180, 270] },
  ];

  /** File/Blob → data: URL（不污染 canvas 的那条路） */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('read-failed'));
      fr.readAsDataURL(file);
    });
  }

  /** data: URL → 已解码的图片元素 */
  function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
      const tuPian = new Image();
      tuPian.onload = () => resolve(tuPian);
      tuPian.onerror = () => reject(new Error('image-failed'));
      tuPian.src = dataUrl;
    });
  }

  /**
   * 一次尝试：按 maxDim 缩放（只缩不放）+ 可选旋转 → 画到 canvas → 读像素 → jsQR。
   * 命中返回 {text,width,height,maxDim,rotationDeg}，未命中返回 null。
   */
  function qrTryDecode(tuPian, maxDim, rotationDeg) {
    const w0 = Number(tuPian.naturalWidth || tuPian.width || 0);
    const h0 = Number(tuPian.naturalHeight || tuPian.height || 0);
    if (!w0 || !h0) return null;
    const k = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const swap = rotationDeg === 90 || rotationDeg === 270;
    const cv = document.createElement('canvas');
    cv.width = swap ? h : w;
    cv.height = swap ? w : h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // 透明 PNG 直接解会得到黑底像素 → 先铺白底（QR 规范要求浅色底，深色模块）
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.translate(cv.width / 2, cv.height / 2);
    if (rotationDeg) ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(tuPian, -w / 2, -h / 2, w, h);
    const px = ctx.getImageData(0, 0, cv.width, cv.height);
    const res = window.jsQR(px.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
    if (!res || !res.data) return null;
    return { text: String(res.data), width: cv.width, height: cv.height, maxDim, rotationDeg };
  }

  /**
   * 图片 → 文本（本机离线）。
   * @returns {Promise<{ok:true,text:string,attempts:number,via:object}
   *                  |{ok:false,reason:string,attempts:number}>}
   *   reason: no-decoder（解码器没加载）| image-failed（不是能解的图片）
   *           | canvas-tainted（画布被污染，像素读不出来）| decode-error（解码器自己抛错）
   *           | no-qr（图里没有可识别的二维码）
   */
  async function decodeQrImage(dataUrl) {
    if (!qrDecoderAvailable()) return { ok: false, reason: 'no-decoder', attempts: 0 };
    let tuPian;
    try {
      tuPian = await loadImageElement(dataUrl);
    } catch {
      return { ok: false, reason: 'image-failed', attempts: 0 };
    }
    let attempts = 0;
    for (const step of QR_SCAN_STEPS) {
      for (const rot of step.rotations) {
        attempts++;
        let hit = null;
        try {
          hit = qrTryDecode(tuPian, step.maxDim, rot);
        } catch (e) {
          // 两种失败必须分清：画布被污染（SecurityError）与解码器自己抛错，
          // 都是"读不出这张图"，但现场记录里要能看出是哪一种。
          const name = String((e && e.name) || '');
          return { ok: false, reason: name === 'SecurityError' ? 'canvas-tainted' : 'decode-error', attempts, detail: String((e && e.message) || e).slice(0, 80) };
        }
        if (hit) return { ok: true, text: hit.text, attempts, via: hit };
      }
    }
    return { ok: false, reason: 'no-qr', attempts };
  }

  /** 命中：解出来的载荷是不是「加入链接」？不是就把具体原因与原文如实回给用户 */
  function classifyJoinPayload(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, reason: 'empty' };
    let query = '';
    if (/^warmy:\/\/join\b/i.test(s)) {
      const q = s.indexOf('?');
      if (q < 0) return { ok: false, reason: 'no-params' };
      query = s.slice(q + 1);
    } else if (/^https?:\/\//i.test(s)) {
      const m = /[?#]/.exec(s);
      if (!m) return { ok: false, reason: 'no-params' };
      const Duan = s.slice(m.index + 1);
      // 分享链接两种写法：直接带参数（?node=…&tok=…），或参数被包一层（?join=node%3D…&tok=…）
      const wrapped = /(?:^|&)join=([^&]*)/.exec(Duan);
      if (wrapped) {
        try { query = decodeURIComponent(wrapped[1]); } catch { query = wrapped[1]; }
      } else {
        query = Duan;
      }
    } else if (s.indexOf('://') < 0 && !/\s/.test(s) && /^[A-Za-z0-9_%&=.+~-]+=/.test(s)) {
      // 二维码里去掉 scheme 的裸查询串（复制粘贴时常见）
      query = s.replace(/^[?#]/, '');
    } else {
      return { ok: false, reason: 'not-a-link' };
    }
    let params;
    try {
      params = new URLSearchParams(query);
    } catch {
      return { ok: false, reason: 'not-a-link' };
    }
    const ANCHORS = ['node', 'fp', 'fingerprint', 'alias', 'id', 'tok', 'token', 'invite'];
    const anchors = ANCHORS.filter((k) => String(params.get(k) || '').trim().length > 0);
    if (!anchors.length) return { ok: false, reason: 'no-anchor' };
    // 喂给加入路径的**就是原样解出来的那串**（与粘贴链接完全同一条路；不做二次改写）
    return { ok: true, link: s, anchors, kind: /^warmy:/i.test(s) ? 'warmy' : /^https?:/i.test(s) ? 'http' : 'query' };
  }

  /** 长载荷在提示里截断显示（完整的仍在链接输入框里） */
  function scanPreviewText(s, n = 96) {
    const t0 = String(s == null ? '' : s);
    return t0.length > n ? t0.slice(0, n) + '…' : t0;
  }

  /** 扫码区块的 HTML（「加入项目/群聊」与「添加联系人」两个弹窗共用同一份） */
  function qrScanBlockHtml(prefix) {
    return (
      '<div class="qr-scan" id="' + prefix + '-scan">' +
      '<div class="qr-scan-row">' +
      '<button type="button" class="btn-mini" id="' + prefix + '-pick">' + escapeHtml(t('join.pickImage')) + '</button>' +
      '<span class="muted" id="' + prefix + '-hint">' + escapeHtml(t('join.dropHint')) + '</span>' +
      '</div>' +
      '<input type="file" id="' + prefix + '-file" accept="image/*" class="hidden"/>' +
      '<div class="qr-scan-detail muted" id="' + prefix + '-detail"></div>' +
      '</div>'
    );
  }

  /** 只有一个全局粘贴监听：路由到**当前弹窗**那个扫码区块（弹窗关了就不处理） */
  let qrScanActiveSink = null;
  document.addEventListener('paste', (e) => {
    if (typeof qrScanActiveSink !== 'function') return;
    const files = (e.clipboardData && e.clipboardData.files) || [];
    let tuPian = null;
    for (const f of files) {
      if (String(f.type || '').startsWith('image/')) { tuPian = f; break; }
    }
    if (!tuPian) return; // 纯文本粘贴：照旧交给输入框自己处理
    e.preventDefault();
    e.stopPropagation();
    void qrScanActiveSink(tuPian);
  });

  /**
   * 把扫码区块接上：选图 / 拖入 / 粘贴 → 解码 → 校验 → 调用**同一个**加入函数。
   * @param prefix  区块前缀（join-qr / contact-qr）
   * @param onJoin  解出合法链接后调用的加入函数（与弹窗「确定」按钮调用的是同一个）
   * @param linkInput 链接输入框（解出来的链接会写进去，用户看得见、可核对）
   */
  function bindQrScan(prefix, onJoin, linkInput) {
    const block = $(prefix + '-scan');
    const file = $(prefix + '-file');
    const pick = $(prefix + '-pick');
    const detail = $(prefix + '-detail');
    const hint = $(prefix + '-hint');
    if (!block || !file || !detail) return;
    const live = () => !!document.body.contains(detail) && !$('modal-root')?.classList.contains('hidden');
    const say = (text, state) => {
      if (!document.body.contains(detail)) return;
      detail.textContent = text;
      detail.setAttribute('data-scan-state', state || '');
      block.setAttribute('data-scan-state', state || '');
    };
    async function handleImage(fileOrBlob) {
      if (!fileOrBlob || !live()) return;
      if (!String(fileOrBlob.type || '').startsWith('image/')) { say(t('join.scanNotImage'), 'not-image'); return; }
      if (!qrDecoderAvailable()) { say(t('join.scanUnavailable'), 'no-decoder'); return; }
      say(t('join.scanWorking'), 'working');
      let dataUrl = '';
      try {
        dataUrl = await readFileAsDataUrl(fileOrBlob);
      } catch {
        say(t('join.scanReadFail'), 'read-fail');
        return;
      }
      const dec = await decodeQrImage(dataUrl);
      if (!live()) return; // 解码期间弹窗被关掉了：不贴提示、更不发起加入
      if (!dec.ok) {
        if (dec.reason === 'no-qr') say(fmtKey('join.scanNoQr', { n: dec.attempts }), 'no-qr');
        else if (dec.reason === 'no-decoder') say(t('join.scanUnavailable'), 'no-decoder');
        // canvas-tainted / decode-error / image-failed 都归到"读不出这张图片"这一句（如实，不编原因）
        else say(t('join.scanReadFail'), dec.reason);
        return;
      }
      const cls = classifyJoinPayload(dec.text);
      if (!cls.ok) {
        if (cls.reason === 'empty') say(t('join.scanEmpty'), 'empty');
        else say(fmtKey('join.scanNotJoinLink', { payload: scanPreviewText(dec.text) }), 'not-join-link');
        return;
      }
      if (linkInput) linkInput.value = cls.link;
      // 现场留痕：命中是哪一次尝试（尺寸 + 旋转角度）。诊断"这张图为什么能/不能扫"全靠它。
      block.setAttribute('data-scan-via', JSON.stringify({ maxDim: dec.via.maxDim, rotationDeg: dec.via.rotationDeg, width: dec.via.width, height: dec.via.height, attempts: dec.attempts }));
      say(fmtKey('join.scanFound', { link: scanPreviewText(cls.link) }), 'found');
      await onJoin(cls.link, { fromScan: true, attempts: dec.attempts, via: dec.via });
    }
    pick?.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { void handleImage(file.files && file.files[0]); });
    block.addEventListener('dragover', (e) => {
      e.preventDefault();
      block.classList.add('dropping');
      if (hint) hint.textContent = t('join.scanDropRelease');
    });
    block.addEventListener('dragleave', () => {
      block.classList.remove('dropping');
      if (hint) hint.textContent = t('join.dropHint');
    });
    block.addEventListener('drop', (e) => {
      e.preventDefault();
      block.classList.remove('dropping');
      if (hint) hint.textContent = t('join.dropHint');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      void handleImage(f);
    });
    // 粘贴路由：只在**这个**弹窗可见时接管
    qrScanActiveSink = (f) => { void handleImage(f); };
    block.setAttribute('data-scan-ready', qrDecoderAvailable() ? '1' : '0');
  }

  // 加入项目/群聊：扫码或粘贴链接
  /** 加入项目/群聊的弹窗内容（扫码区块 + 粘贴链接 + 「对方将看到的名片」） */
  function joinDialogBodyHtml(card) {
    return (
      '<div class="muted" style="margin-bottom:8px">' + escapeHtml(t('join.scanHint')) + '</div>' +
      qrScanBlockHtml('join-qr') +
      '<input id="join-link-input" placeholder="' + escapeHtml(t('join.pastePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"/>' +
      '<div class="muted" style="margin-top:10px">' + escapeHtml(t('card.peerWillSee')) + '</div>' + myCardHtml(card) +
      '<div id="join-qr-msg" class="muted" style="margin-top:6px"></div>'
    );
  }

  /**
   * R4：我的联系方式。链接来自**真实**数据，缺什么就少什么：
   *   node  ← meshStatus().nodeId（本机组网节点）
   *   token ← inviteCreate().invite.token（本机邀请令牌）
   *   port  ← 组网设置里当前配置的端口
   * 连 node/身份都拿不到 → ok:false，界面如实说「拿不到」，不画假码。
   */
  async function ownInviteLink() {
    let node = '';
    let token = '';
    let alias = '';
    let fp = '';
    try {
      const st = await window.warmy.meshStatus();
      node = String((st && st.nodeId) || '');
    } catch {
      /* 拿不到就留空 */
    }
    try {
      const inv = await window.warmy.inviteCreate();
      token = String((inv && inv.invite && inv.invite.token) || '');
    } catch {
      /* 拿不到就留空 */
    }
    try {
      const r = await myIdentity();
      const info = (r && r.identity) || {};
      alias = String(info.alias || (r && r.alias) || '');
      fp = String(info.fingerprint || (r && r.fingerprint) || '');
    } catch {
      /* 拿不到就留空 */
    }
    const who = node || fp || alias;
    const parts = [];
    if (who) parts.push('node=' + encodeURIComponent(who));
    const port = Number(netState.addr && netState.addr.port) || 0;
    if (port) parts.push('port=' + port);
    if (token) parts.push('tok=' + encodeURIComponent(token));
    return { ok: !!who, link: who ? 'warmy://join?' + parts.join('&') : '', node, token, alias, fingerprint: fp };
  }

  /**
   * 左列：我的链接 + 我的二维码（真编码器：见 qrSvg 与 vendor/qrcode-generator-2.0.4.js）
   */
  async function ownLinkColumnHtml() {
    const own = await ownInviteLink();
    if (!own.ok) {
      return { own, html: '<div class="own-qr-empty" id="contact-own-unavailable">' + escapeHtml(t('contact.mineUnavailable')) + '</div>' };
    }
    const html =
      '<div class="own-link-row">' +
      '<span class="own-link-text" id="contact-my-link">' + escapeHtml(own.link) + '</span>' +
      '<button type="button" class="btn-mini" id="btn-my-link-copy">' + escapeHtml(t('contact.mineCopy')) + '</button>' +
      '</div>' +
      (own.alias || own.fingerprint
        ? '<div class="own-id-line">' + escapeHtml(t('contact.ownId')) + ': ' + escapeHtml(own.alias || own.fingerprint) + '</div>'
        : '') +
      '<div id="contact-my-qr" data-link="' + escapeHtml(own.link) + '" aria-label="' + escapeHtml(t('contact.mineQr')) + '"></div>';
    return { own, html };
  }

  /**
   * 把左列的二维码画出来：**真** QR（版本自适应 + 纠错 M + 4 模块静区），屏幕宽度 168px。
   * 编码器不可用时返回 false 并置一句如实话术 —— 宁可没有码，也不给扫不出来的假码。
   */
  function fillOwnQr(yuanSu, link, size = 168) {
    if (!yuanSu) return false;
    const svg = qrSvg(link, size);
    if (svg) {
      yuanSu.innerHTML = svg;
      yuanSu.classList.remove('own-qr-empty');
      yuanSu.setAttribute('data-qr-state', 'ok');
      return true;
    }
    yuanSu.innerHTML = '';
    yuanSu.classList.add('own-qr-empty');
    yuanSu.setAttribute('data-qr-state', 'no-encoder');
    yuanSu.textContent = t('contact.qrUnavailable');
    return false;
  }

  $('btn-join-qr')?.addEventListener('click', async () => {
    const root = $('modal-root');
    // R4：联系人页的「添加联系人」弹窗 = 左列我的链接/二维码 + 右列添加对方。
    // 项目/群聊页仍是原来的「扫码加入 / 申请加入」。
    if (state.nav === 'externalChat') {
      $('modal-title').textContent = t('contact.add');
      const card = await myCard();
      const mine = await ownLinkColumnHtml();
      $('modal-body').innerHTML =
        '<div class="add-contact-grid">' +
        '<div class="add-contact-col" id="contact-own-panel">' +
        '<h4>' + escapeHtml(t('contact.mine')) + '</h4>' +
        '<p class="add-contact-hint">' + escapeHtml(t('contact.mineHint')) + '</p>' +
        mine.html +
        '</div>' +
        '<div class="add-contact-col" id="add-contact-others">' +
        '<h4>' + escapeHtml(t('contact.others')) + '</h4>' +
        '<p class="add-contact-hint">' + escapeHtml(t('contact.othersHint')) + '</p>' +
        '<input id="add-contact-name" placeholder="' + escapeHtml(t('contact.namePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-bottom:8px"/>' +
        '<div class="muted" style="margin-bottom:6px">' + escapeHtml(t('contact.scanHint')) + '</div>' +
        qrScanBlockHtml('contact-qr') +
        '<input id="join-link-input" placeholder="' + escapeHtml(t('join.pastePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:8px"/>' +
        '<div class="muted" style="margin-top:10px">' + escapeHtml(t('card.peerWillSee')) + '</div>' + myCardHtml(card) +
        '<div id="join-qr-msg" class="muted" style="margin-top:6px"></div>' +
        '</div></div>';
      if (mine.own.ok) {
        fillOwnQr($('contact-my-qr'), mine.own.link, 168);
        const copy = $('btn-my-link-copy');
        if (copy) {
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(mine.own.link);
              $('join-qr-msg').textContent = t('contact.mineCopied');
            } catch {
              $('join-qr-msg').textContent = t('contact.mineCopyFail');
            }
          };
        }
      }
      const cActs = $('modal-actions');
      cActs.innerHTML = '';
      const cCancel = document.createElement('button');
      cCancel.className = 'btn-mini';
      cCancel.textContent = t('common.cancel');
      cCancel.onclick = () => { root.classList.add('hidden'); };
      const cOk = document.createElement('button');
      cOk.className = 'btn-primary';
      cOk.textContent = t('common.ok');
      /**
       * 添加联系人弹窗里「用链接加入」的**唯一**实现 ——
       * 「确定」按钮（粘贴链接）与扫码区块（识别出的链接）都走这一个函数。
       * 这里不新增第二条加入实现：扫码只是把载荷塞进同一个入参位置。
       */
      const submitContactJoin = async (link) => {
        const r = await window.warmy.joinRequest({
          name: state.profile.username || 'user',
          kind: 'human',
          target: link,
          targetType: 'contact',
          // 附六：加入动作即交换名片（邮箱/手机号为空也照发）
          card: { email: card.email || '', phone: card.phone || '' },
        }).catch(() => null);
        const msg = $('join-qr-msg');
        if (msg) msg.textContent = r?.ok ? t('join.ok') : t('join.fail');
        return r;
      };
      cOk.onclick = async () => {
        const name = String((($('add-contact-name') || {}).value) || '').trim();
        const link = String((($('join-link-input') || {}).value) || '').trim();
        if (name) {
          // 「加对方」：原 addContactFlow 的流程（名片确认 → 落联系人）
          const added = await createContactWithCard(name);
          if (added) root.classList.add('hidden');
          return;
        }
        if (!link) {
          $('join-qr-msg').textContent = t('contact.needInput');
          return;
        }
        await submitContactJoin(link);
        setTimeout(() => root.classList.add('hidden'), 800);
      };
      cActs.append(cCancel, cOk);
      // 扫别人的二维码：选图 / 拖入 / 粘贴 → 本机解码 → 走上面**同一个** submitContactJoin
      bindQrScan('contact-qr', async (link) => {
        const r = await submitContactJoin(link);
        // 扫出来的链接加入成功才自动收窗；失败就留在弹窗里（让用户看到那句如实话术、可重试）
        if (r?.ok) setTimeout(() => root.classList.add('hidden'), 800);
      }, $('join-link-input'));
      root.classList.remove('hidden');
      return;
    }
    $('modal-title').textContent = t('join.title');
    const card = await myCard();
    $('modal-body').innerHTML = joinDialogBodyHtml(card);
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn-mini';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('hidden'); };
    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = t('join.apply');
    /**
     * 这个弹窗只有**一种**模式：用链接加入 —— 「申请加入」按钮下面的守卫要求必须有链接
     * （没有链接直接如实报错、不发请求），扫码区块也只是把解出来的链接塞进同一个入参位置。
     * 所以被提交的 target 就是**用户粘贴/扫到的那条链接本身**；绝不能拿"当前选中的会话名"顶替它
     * （修前正是 `state.selectedChat?.name || link`：只要列表里有选中的会话，粘贴/扫码就全是摆设，
     * 发出去的是一句会话名，而对面弹窗显示的是"想加入 xxx 项目"）。
     * targetType 是**另一个维度**（要加入的是"项目"还是"群聊"），按打开弹窗时所在的入口取一次，
     * 不跟 selectedChat 走（那边没选中会话时会误判成 group，见 setupListAction 的入口文案）。
     */
    const joinMode = state.nav === 'internalGroup' ? 'project' : 'group';
    const submitProjectJoin = async (link) => {
      const r = await window.warmy.joinRequest({
        name: state.profile.username || 'user',
        kind: 'human',
        target: link,
        targetType: joinMode,
        // 附六：加入动作即交换名片（邮箱/手机号为空也照发，对方看到的是「未填写」而不是「被隐藏」）
        card: { email: card.email || '', phone: card.phone || '' },
      }).catch(() => null);
      const msg = $('join-qr-msg');
      if (msg) msg.textContent = r?.ok ? t('join.ok') : t('join.fail');
      return r;
    };
    ok.onclick = async () => {
      const link = $('join-link-input')?.value?.trim();
      if (!link) { $('join-qr-msg').textContent = t('join.qrFail'); return; }
      await submitProjectJoin(link);
      setTimeout(() => root.classList.add('hidden'), 800);
    };
    acts.append(cancel, ok);
    // 扫别人的二维码：选图 / 拖入 / 粘贴 → 本机解码 → 走上面**同一个** submitProjectJoin
    bindQrScan('join-qr', async (link) => {
      const r = await submitProjectJoin(link);
      if (r?.ok) setTimeout(() => root.classList.add('hidden'), 800);
    }, $('join-link-input'));
    root.classList.remove('hidden');
  });

  $('btn-chat-search')?.addEventListener('click', async () => {
    const q = $('chat-search')?.value?.trim();
    if (!q) return;
    const r = await window.warmy.searchMessages(q).catch(() => null);
    const hits = r?.hits || [];
    tuisongXiaoxi(state.selectedChat?.id || 'search', 'them', hits.length ? hits.map((x) => x.snippet).join('\n') : t('list.empty'));
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
          const shuRu = $('input');
          if (shuRu) shuRu.value = '> ' + text.slice(0, 120) + '\n' + shuRu.value;
        } },
    ]);
  });
  // W. 定向模式开关（聊天头）
  /**
   * 独立窗的任务栏图标 = **这个聊天对象在第二列里显示的头像**。
   *
   * 之前写错了：用的是 `personAvatarSrc()`（那是「我」的头像），
   * 于是任何会话的任务栏图标都变成用户自己的头像。正确来源按会话类型分：
   *  - 我的牛马（single）：该牛马实例的头像（自定义图片 > 预设 svg）
   *  - 项目 / 群聊：群组头像（若有），否则与第二列一致的首字块
   *  - 联系人：联系人头像（若有），否则首字块
   * 首字块要和 `.list-item .av` 视觉一致：圆角方块 + 浅底 + 首字。
   */
  function chatPartnerAvatarSrc() {
    const sel = state.selectedChat;
    if (!sel) return { kind: 'none' };
    const kind = String(sel.kind || '');
    if (kind === 'single') {
      const inst = (state.instances || []).find((x) => x.id === sel.id || x.name === sel.name);
      if (inst) return { kind: 'image', src: instanceAvatarSrc(inst) };
      const chat = (state.chats || []).find((c) => c.id === sel.id);
      if (chat && (chat.avatarDataUrl || chat.avatarPreset)) {
        return { kind: 'image', src: inst ? instanceAvatarSrc(chat) : (chat.avatarDataUrl || '') };
      }
      return { kind: 'letter', text: String(sel.name || '?')[0] };
    }
    if (kind === 'internal' || kind === 'extgroup' || kind === 'externalGroup' || kind === 'external') {
      const g = (state.groups || []).find((x) => x.id === sel.id);
      if (g && (g.avatarDataUrl || g.avatarPreset)) return { kind: 'image', src: g.avatarDataUrl || '' };
      return { kind: 'letter', text: String(sel.name || g?.name || '?')[0] };
    }
    // 联系人 / 其他
    const c = (state.chats || []).find((x) => x.id === sel.id);
    if (c && c.avatarDataUrl) return { kind: 'image', src: c.avatarDataUrl };
    return { kind: 'letter', text: String(sel.name || c?.name || '?')[0] };
  }

  async function chatAvatarDataUrl() {
    try {
      const src = chatPartnerAvatarSrc();
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);
      /**
       * **任务栏图标要白底**（产品主）：任务栏深浅不一，透明底的头像/首字块在深色任务栏上
       * 几乎看不见。所以这里先铺一块白色圆角底，再把头像/首字块画上去。
       * （其它位置的图标不变：这一份只用于窗口图标 = 任务栏。）
       */
      const yuanJiaoJuXing = (x, y, w, h, rad) => {
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath();
      };
      const puBaiDi = () => {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        yuanJiaoJuXing(0, 0, 64, 64, 12);
        ctx.fill();
        ctx.restore();
      };
      if (src.kind === 'image' && src.src) {
        ctx.clearRect(0, 0, 64, 64);
        puBaiDi();
        const tuPian = new Image();
        tuPian.src = src.src;
        await tuPian.decode();
        // 白底上留一圈内边距，头像不至于顶到边
        const inset = 6;
        ctx.save();
        ctx.beginPath();
        yuanJiaoJuXing(inset, inset, 64 - inset * 2, 64 - inset * 2, 9);
        ctx.clip();
        ctx.drawImage(tuPian, inset, inset, 64 - inset * 2, 64 - inset * 2);
        ctx.restore();
        return c.toDataURL('image/png');
      }
      if (src.kind === 'letter') {
        // 与第二列 `.list-item .av` 同款：6/40 圆角比例、浅底、居中首字
        const cs = getComputedStyle(document.documentElement);
        const bg = (cs.getPropertyValue('--line') || '#e5e5e5').trim() || '#e5e5e5';
        const fg = (cs.getPropertyValue('--muted') || '#888').trim() || '#888';
        puBaiDi();
        const inset = 5;
        const size = 64 - inset * 2;
        const r = size * (6 / 40);
        ctx.fillStyle = bg;
        ctx.beginPath();
        yuanJiaoJuXing(inset, inset, size, size, r);
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.font = '600 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(src.text || '?'), 32, 33);
        return c.toDataURL('image/png');
      }
      return '';
    } catch { return ''; }
  }
  $('btn-open-win')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const iconDataUrl = await chatAvatarDataUrl();
    window.warmy.openChatWindow({
      id: state.selectedChat.id,
      title: state.selectedChat.name,
      kind: state.selectedChat.kind,
      mode: 'sub',
      iconDataUrl,
    });
  });
  $('btn-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('btn-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.warmy.exportSession({
      title: state.selectedChat.name,
      messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });
  // 托盘 + 热键
  window.warmy.trayInit?.().catch(() => {});
  window.warmy.registerHotkey?.('CommandOrControl+Shift+M').catch(() => {});
  // 从 URL 参数自动打开会话（多窗口）
  // 产品定稿：独立会话窗只保留 **聊天（第3列）+ 右侧事项（第4列）**；
  // 顶栏 #titlebar **必须保留**（无边框窗口靠它拖动 + 窗控），任务栏图标由主进程 setIcon。
  try {
    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    const cid0 = q.get('chatId');
    const title0 = q.get('chatTitle') || '';
    if (mode === 'sub' || cid0) {
      document.body.classList.add('chat-window');
      document.getElementById('rail')?.classList.add('hidden');
      document.getElementById('list-col')?.classList.add('hidden');
      document.getElementById('app-body')?.classList.add('hide-list');
      document.getElementById('empty-state')?.classList.add('hidden');
      document.getElementById('page-layout')?.classList.add('hidden');
      document.getElementById('inst-detail')?.classList.add('hidden');
      const cl = document.getElementById('chat-layout');
      if (cl) {
        cl.classList.remove('hidden');
        cl.style.display = 'grid';
        cl.style.height = '100%';
      }
      const mc = document.getElementById('main-col');
      if (mc) { mc.style.height = '100%'; mc.style.minHeight = '0'; }
      const pc = document.getElementById('panel-col');
      if (pc) { pc.style.display = 'flex'; pc.style.height = '100%'; pc.style.overflow = 'auto'; }
      if (title0) {
        try { document.title = title0; } catch { /* noop */ }
        const brand = document.getElementById('tb-brand');
        if (brand) brand.textContent = title0;
      }
    }
    const cid = q.get('chatId');
    if (cid) {
      const title = q.get('chatTitle') || cid;
      const kind = q.get('chatKind') || 'single';
      setTimeout(() => openChat(kind, cid, title), 300);
    }
  } catch { /* noop */ }

  /* ══════════════════════════════════════════════════════════════════════
   * 跨窗口同步（产品要求：新窗口与主界面是**同一个**会话，记录/信息/选项都要同步）
   * ----------------------------------------------------------------------
   * 以前两个窗口各存各的内存副本，且**没有任何推送通道** —— 所以新开的窗口是空白的、
   * 一边改设置另一边不变。现在：
   *  · 主进程写日志时广播 `chat-updated` ⇒ 正在看该会话的窗口重新拉正文；
   *  · 任一窗口改设置时广播 `settings-changed` ⇒ 其它窗口重新应用并重画。
   * 两条都只发"变化通知"，正文/设置本身仍旧从主进程读，避免出现第二个真相。
   * ══════════════════════════════════════════════════════════════════════ */
  try {
    window.warmy.onChatUpdated?.((d) => {
      const sid = String((d && d.sessionId) || '');
      if (!sid) return;
      void loadSessionMessages(sid);
    });
    /**
     * 实体级状态变化（群定向 / 项目启用停用 / 项目属性）：
     * 若变化的正是本窗口正在看的那个实体 ⇒ 按主进程那份事实重画自己的视图。
     * 注意：**不搬内容**，只是让两处视图都跟着同一份状态走。
     */
    window.warmy.onEntityUpdated?.((d) => {
      const id = String((d && d.id) || '');
      if (!id) return;
      if (state.selectedChat && state.selectedChat.id === id) {
        void refreshEntityView(id);
      }
    });
    window.warmy.onSettingsChanged?.((d) => {
      void (async () => {
        try {
          const r = await window.warmy.settingsGet();
          const s = r && r.settings;
          if (!s) return;
          const keys = Array.isArray(d && d.keys) ? d.keys : [];
          // 主题/强调色/语言：立刻应用（跨窗口看到的必须是同一套外观）
          if (!keys.length || keys.includes('themeMode') || keys.includes('accent')) {
            state.themeMode = s.themeMode || state.themeMode;
            state.theme = s.accent || state.theme;
            applyThemeMode?.(state.themeMode);
            document.documentElement.style.setProperty('--accent', state.theme);
          }
          if (keys.includes('locale') && s.locale && resolveLocalePack(s.locale) !== state.locale) {
            await loadI18n(resolveLocalePack(s.locale));
          }
          // 供应商/模型：重新从设置读一遍并重画（别一边加了供应商另一边看不到）
          if (!keys.length || keys.some((k) => String(k).startsWith('provider'))) {
            await loadProvidersFromSettings?.();
          }
          try { renderPage(); } catch { /* 不在设置页时忽略 */ }
        } catch { /* noop */ }
      })();
    });
  } catch { /* noop */ }

  // 主刷新循环：合并所有定时刷新，降低频率
  let __loopTick = 0;
  try { bindCtxBudget(); bindSummaryControls(); void ctxLoad(); void loadSummaryPref(); } catch { /* noop */ }
  setInterval(() => {
    __loopTick++;
    if (__loopTick % 2 === 0) raf(refreshMetrics);
    if (__loopTick % 3 === 0) raf(refreshCost);
    if (__loopTick % 4 === 0) raf(shuaxinZhixingqiji);
    if (__loopTick % 5 === 0) raf(() => { refreshSessionBoard(); refreshMembers(); });
    if (__loopTick % 6 === 0) raf(checkLastError);
    if (__loopTick % 2 === 0) raf(renderAiQuestions);
    if (__loopTick % 4 === 0) raf(renderProjectMemoryPanel);
    if (__loopTick % 8 === 0) raf(refreshJoinBadge);
    if (__loopTick % 15 === 0) raf(() => window.__saveState?.());
    // 语言：设置被外部改过（IPC settingsSave / 另一窗口）也要跟上，不靠启动时读一次
    if (__loopTick % 1 === 0) {
      void (async () => {
        try {
          const s = await window.warmy.settingsGet();
          const loc = s?.settings?.locale;
          if (loc && resolveLocalePack(loc) !== state.locale) {
            await loadI18n(resolveLocalePack(loc));
          }
        } catch { /* noop */ }
      })();
    }
  }, 5000);
  const __mainLoop = true;

  (async () => {
    try {
      // Prefer saved settings.locale; otherwise map navigator.language onto the full 10-locale set.
      let bootLocale = resolveLocalePack(navigator.language);
      try {
        const s0 = await window.warmy.settingsGet();
        if (s0?.settings?.locale) bootLocale = resolveLocalePack(s0.settings.locale);
      } catch { /* keep navigator mapping */ }
      await loadI18n(bootLocale);
    } catch {
      state.locale = 'zh-CN';
      state.t = { 'app.zhName': '无限牛马', 'app.enName': 'WArmy', 'app.subtitle': 'Workhorse Army', 'app.displayName': '无限牛马', 'brand.name': '无限牛马', 'brand.sub': 'WArmy（Workhorse Army）', 'brand.tagline': '让AI成为你的无限牛马', 'about.tagline': '多智能体群聊桌面应用' };
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
        // 载入全局横幅关闭记录（多窗口一致）
        try {
          const dis = s.settings.netBannerDismissed;
          if (Array.isArray(dis)) {
            dis.forEach((k) => { if (typeof k === 'string' && k) netState.dismissed[k] = true; });
            netState.renderedSig = '';
            renderNetBanner();
          }
        } catch { /* noop */ }
        state.embedUseGpu = s.settings.embedUseGpu !== false;
        // 供应商列表落盘读回（密钥只问"有没有"，读不回明文）
        await loadProvidersFromSettings();
        // Re-apply persisted locale (settingsGet is also used above for boot; ensure UI state matches).
        if (s.settings.locale && resolveLocalePack(s.settings.locale) !== state.locale) {
          try { await loadI18n(resolveLocalePack(s.settings.locale)); } catch { /* noop */ }
        }
        document.documentElement.style.setProperty('--accent', state.theme);
        // R3：右栏宽度沿用上次拖到的值（没存过就吃 CSS 里的 300px 默认）
        if (Number(s.settings.listWidth) > 0) {
          document.documentElement.style.setProperty('--list-w', Math.round(Number(s.settings.listWidth)) + 'px');
        }
        if (Number(s.settings.panelWidth) > 0) {
          document.documentElement.style.setProperty('--panel-w', Math.round(Number(s.settings.panelWidth)) + 'px');
        }
        // R2：用户设过的快捷键（只覆盖存过的动作，没存过的仍走预置）
        if (s.settings.shortcuts && typeof s.settings.shortcuts === 'object') {
          state.shortcuts = Object.assign({}, s.settings.shortcuts);
        }
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
    // 待执行队列：启动时从 userData/ui-queues.json 恢复（进程退出不丢 P2/P3）
    try { await restoreUiQueuesOnce(); } catch { /* noop */ }
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
      const st = await window.warmy.stateLoad();
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
      window.warmy.stateSave({
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
    shuaxinZhixingqiji();
  })();
})();
