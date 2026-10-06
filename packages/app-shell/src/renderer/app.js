/* WArmy renderer — 文案全在 i18n；主题/分栏/模型拉取/附件/语音/总看板 */
(() => {
  const $ = (id) => document.getElementById(id);
  let pendingAvatarTarget = null;
  /**
   * 供应商列表的**出厂预设**（只在从来没有落盘过时用一次）。
   * 真正生效的列表一律以设置文件为准 —— 用户加过的供应商、拉到的模型、标红状态
   * 都写在 `settings.providers` 里（**密钥不在这里**：密钥走 safeStorage，见主进程）。
   */
  // 产品定稿：只预置 DeepSeek 一个供应商；Ollama 等由用户自行添加
  /**
   * **默认预置供应商只有 DeepSeek**（产品要求）。
   * 其它（含 MiMo）一律走「预设供应商」下拉由用户自行添加 —— 见 GONGYING_YUSHE_JIAN()。
   */
  const PROVIDER_DEFAULTS = [
    { id: 'deepseek', biaoQian: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: [] },
  ];
  const PROVIDER_PROTOCOLS = ['openai-compatible', 'anthropic', 'ollama'];
  const state = {
    /** 独立会话窗钉住的会话 id（URL 的 chatId）；非独立窗为空 */
    subWindowPinnedId: '',
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
    /** 聊天框的思考级别覆盖：只对当前聊天对象一次性生效（换会话即失效） */
    thinkOverride: {},
    /** 超出权限是否询问（默认询问；完全授权时该开关灰掉） */
    askOnExceed: true,
    /** 定时任务 / 文件产物（右栏卡片的数据） */
    dingShiRenWu: [],
    gongZuoWenJian: [],
    gongZuoQuLuJing: '',
    jiHuaRenWu: [],
    /**
     * 未读数（微信式角标）：**每次新回复 +1**，直到用户点了这个聊天界面里的任何元素才清零
     * （产品要求：即使当前正开着这个会话，角标也要显示）。
     */
    unread: {},
    /** 被打断的任务（程序异常/退出/重启后恢复到的会话）：列表亮 ?，会话里给「继续/重试」 */
    planInterrupted: new Set(),
    /** 中断原因（点「继续/重试」时带给模型分析用） */
    renWuZhongDuan: {},
    sound: { complete: true, request: true, error: true },
    soundVolume: 0.9,
    autoRead: false,
    /** 加强 AI 语言约束：思考过程与回复严格用界面语言 */
    strictAiLanguage: false,
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    theme: '#A78567',
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
    profile: { loggedIn: false, username: 'nav.touXiang', avatarDataUrl: '', email: '', deviceId: '', avatarPreset: 0 },
    queues: {},
    board: {
      /**
       * ADR：外部聚合看板 — 会话进展只读，点击跳转；值班者写 board.jsonl。
       *
       * ⚠️ 这里**刻意是空的**：以前预置了 4 个演示会话 + 4 条演示动态（demo.project1…），
       * 于是「总看板」在真数据还没来时显示得像"真的有 4 个项目在跑、刚刚完成了任务"
       * （时间戳还是相对现在算的，看着很新）。那属于"看起来在跑其实没跑"。
       * 现在：真数据一律来自 `warmy:kanbanJuHe` / `warmy:kanbanShiJianJi`；
       * 没数据就由 renderDashboard() 如实显示"暂无…"。
       */
      sessions: [],
      /** board.jsonl 结构化事件（值班者解析写入） */
      events: [],
      recent: [],
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
    providers: PROVIDER_DEFAULTS.map((p) => ({ ...p, models: [] })),
    /** 当前**生效**供应商 id（聊天真正用谁）；编辑其它供应商绝不劫持它 */
    activeProviderId: 'deepseek',
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
      biaoQian: String(p.biaoQian || ''),
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
      const idJi = state.providers.map((p) => p.id);
      const h = await window.warmy.providerKeyHas?.({ providerIds: idJi });
      if (h?.ok) state.providers.forEach((p) => { p.hasKey = !!h.has[p.id]; });
    } catch { /* 问不到就当没有：界面会显示"未设置密钥" */ }
    // 读回**当前生效**供应商 id（编辑其它供应商不得劫持它）
    try {
      const g = await window.warmy.getProvider?.();
      const cur = g && (g.providerCfg || g);
      if (cur && cur.presetId) state.activeProviderId = String(cur.presetId);
    } catch { /* 读不到就保持默认 */ }
  }
  window.__warmyReloadProviders = loadProvidersFromSettings;
  /**
   * 给**自动化门禁**用的两个钩子（真人从来不点这个）：
   *  · `__warmyRenderPage`：门禁要能"灌一份设置 → 立即按真实渲染路径重画"，
   *    否则只能靠静态文本断言（历史上正是这种弱断言把"没跑过"当成了"过了"）；
   *  · `__warmyProviders`：读回渲染层当前持有的供应商数组（只读快照）。
   */
  window.__warmyRenderPage = () => renderPage();

  /** 只读调试快照（门禁/自动诊断用；不改变任何行为） */
  window.__warmyDebugState = () => ({
    nav: state.nav,
    yiGuding: state.subWindowPinnedId || '',
    selected: state.selectedChat ? state.selectedChat.id : null,
    selectedKind: state.selectedChat ? state.selectedChat.kind : null,
    chatWindow: document.body.classList.contains('liaoTianChuangKou'),
    itemCount: document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length,
  });
  const t = (k) => state.t[k] || k;
  /** t() 缺键时会原样返回键名；界面文案用它拿真正兜底 */
  const tOr = (k, fallback) => {
    const v = state.t[k];
    return (v && v !== k) ? v : fallback;
  };
  /** 结构化值展示：对象绝不 textContent 直出（避免 [object Object]） */
  const fmtDisp = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.map(fmtDisp).join(' · ');
      return String(v.biaoQian || v.text || v.name || v.value || v.unit || '—');
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
    // .jinJiCaiDan 的 CSS 带 bottom:calc(100% + 6px)，不清掉会与 top 冲突、菜单被拉出视口
    caiDan.style.bottom = 'auto';
    caiDan.style.you = 'auto';
    caiDan.style.zIndex = '500';
    const mw = caiDan.offsetWidth || 170;
    const mh = caiDan.offsetHeight || 150;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const below = r.bottom + 4;
    const top = below + mh > window.innerHeight - 8 ? Math.max(8, r.top - 4 - mh) : below;
    caiDan.style.left = left + 'px';
    caiDan.style.top = top + 'px';
  }
  /**
   * **同帧合并**（真事故修）：默认每个 tick 里**只有第一个** raf 调用会执行，
   * 同一帧里排后面的那些被**静默丢掉** —— 主循环里 `renderAiQuestions` 永远排第二，
   * 于是"决策卡的轮询发现"从来没跑过：主进程没广播的卡片既不显示、也不响。
   * （同类受害者：`refreshCost`/`shuaxinZhixingqiji`/`refreshSessionBoard`/
   *   `refreshMembers`/`checkLastError`/`renderProjectMemoryPanel`/`refreshJoinBadge`）
   *
   * 现在按帧**排队 + 全跑**：仍然"一个 tick 最多一帧"，但不再丢任何回调；
   * 单个回调抛错也不影响同帧其它回调（以前一个抛错会把后面的全带下水）。
   * 另外补一个**兜底定时器**：窗口被遮挡/最小化时 `requestAnimationFrame` 会被节流甚至停发，
   * 队列要是一直没人喊醒就永远躺着 —— 这时用 setTimeout 把队列放出去。
   */
  let __rafDaiLie = null;
  let __rafBaoXianJi = null;
  function __rafFangChu() {
    const pail = __rafDaiLie;
    __rafDaiLie = null;
    if (__rafBaoXianJi) { try { clearTimeout(__rafBaoXianJi); } catch { /* noop */ } __rafBaoXianJi = null; }
    for (const f of (pail || [])) {
      try { f(); } catch { /* 单个刷新失败不影响其它刷新 */ }
    }
  }
  function raf(fn) {
    if (typeof fn !== 'function') return;
    if (!__rafDaiLie) {
      __rafDaiLie = [];
      try { requestAnimationFrame(__rafFangChu); } catch { __rafFangChu(); return; }
      // 隐藏窗口里 rAF 可能一直不回来：300ms 内没放出就自己放
      __rafBaoXianJi = setTimeout(__rafFangChu, 300);
    }
    __rafDaiLie.push(fn);
  }
  window.__rafDaiLieChang = () => (__rafDaiLie ? __rafDaiLie.length : 0);
  // 门禁用：直接验证"同一 tick 里排队的回调**全都跑**"（老实现只跑第一个）
  window.__raf = raf;
  let __inputThrottle = 0;
  /**
   * 「供应商名 · 模型名」是界面展示用复合标签；发给 API 的必须是纯模型 id
   * （复合串发出去会 HTTP 400：you passed DeepSeek · deepseek-flash）。
   * 主进程侧已在决策/落盘处剥前缀（model-pick.jieMoXingMing），这里再守一道写入口。
   */
  const jieMoXingMing = (ming) => {
    const s = String(ming || '').trim();
    if (!s) return '';
    const i = s.lastIndexOf(' · ');
    return i >= 0 ? s.slice(i + 3).trim() : s;
  };
  const providerCfgModel = (p) => jieMoXingMing(p.defaultModel || (p.models && p.models[0]) || 'deepseek-chat');
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
  function resolveLocalePack(yuYan) {
    if (!yuYan) return 'zh-CN';
    const raw = String(yuYan).trim();
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
    return SUPPORTED_LOCALES.map(([code, biaoQian]) => {
      const qiYong = resolveLocalePack(selected) === code ? ' selected' : '';
      return `<option value="${code}"${qiYong}>${escapeHtml(biaoQian)}</option>`;
    }).join('');
  }

  const displayName = () =>
    state.t['yingYong.displayName'] || state.t['brand.name'] || (state.yuYan.startsWith('zh') ? t('yingYong.zhName') : t('yingYong.enName'));
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
    const MAP = {
      'not-configured': 'update.status.notConfigured',
      'network-error': 'update.status.networkError',
      'http-error': 'update.status.httpError',
      'invalid-response': 'update.status.invalidResponse',
      'updater-unavailable': 'update.status.unavailable',
      'update-available': 'update.status.available',
      'up-to-date': 'update.status.upToDate',
    };
    if (r && r.i18nKey && state.t && state.t[r.i18nKey]) return t(r.i18nKey);
    if (st && MAP[st]) return t(MAP[st]);
    if (r && r.reason) return (t('update.status.unknown') + ' · ' + r.reason);
    if (r && r.message) return String(r.message);
    return t('update.status.unknown');
  }
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 改名兼容：后端字段是 ming，界面旧代码用 name —— 读写都走这两个别名 */
  const xianShiMing = (o) => (o && (o.name || o.ming || o.id)) || '';
  const mingOf = (o) => {
    if (!o || typeof o !== 'object') return '';
    return String(o.ming ?? o.name ?? '');
  };
  /**
   * **第二列（列表）里显示的那个名称**（真机反馈：总看板按窗口分组时显示的是内部 sessionId，
   * 用户看不懂 —— 要求用列表里的名称来表示这个窗口）。
   * 这里**刻意复刻列表的取名顺序**：群/项目 → 牛马实例 → 普通会话 → 兜底显示 id。
   */
  function mingBiaoQing(id) {
    const sid = String(id || '');
    if (!sid) return '—';
    try {
      const g = (state.groups || []).find((x) => x && String(x.id || '') === sid);
      if (g) return mingOf(g) || sid;
      const inst = (state.instances || []).find((x) => x && (String(x.id || '') === sid || String(x.ming || '') === sid || String(x.name || '') === sid));
      if (inst) return mingOf(inst) || sid;
      const c = (state.chats || []).find((x) => x && (String(x.id || '') === sid || String(x.ming || '') === sid || String(x.name || '') === sid));
      if (c) return mingOf(c) || sid;
    } catch { /* 取不到名就退回 id */ }
    return sid;
  }
  window.__mingBiaoQing = mingBiaoQing;
  const biaoZhunShiLi = (o) => {
    if (!o || typeof o !== 'object') return o;
    const ming = mingOf(o);
    return { ...o, ming, name: ming };
  };
  const biaoZhunQun = (o) => {
    if (!o || typeof o !== 'object') return o;
    const ming = mingOf(o);
    return { ...o, ming, name: ming, id: o.id || o.groupId, groupId: o.groupId || o.id };
  };

  /** 预设占位时「添加」不可点；选中真供应商才可点 */
  function syncTianJiaProvBtn() {
    try {
      const sel = $('provPreset');
      const btn = $('anNiuTianJiaProv');
      if (!btn) return;
      const okSel = !!(sel && sel.value && sel.value !== '');
      btn.disabled = !okSel;
      btn.style.opacity = okSel ? '' : '0.45';
      btn.style.cursor = okSel ? '' : 'not-allowed';
    } catch { /* noop */ }
  }
  /** 预设供应商下拉填充（设置→模型）：DeepSeek 第一，其余按界面语言排序 */
  function tianChongYuSheXiaLa() {
    const sel = $('provPreset');
    if (!sel) return;
    const presets = (typeof GONGYING_YUSHE_JIAN === 'function') ? GONGYING_YUSHE_JIAN() : [];
    const qiYu = presets.filter((p) => p.id !== 'deepseek' && p.id !== '__other__')
      .slice()
      .sort((a, b) => String(a.biaoQian || a.id).localeCompare(String(b.biaoQian || b.id), state.yuYan || 'zh-CN'));
    const other = presets.filter((p) => p.id === '__other__');
    const first = presets.filter((p) => p.id === 'deepseek');
    const rows = [...first, ...qiYu, ...other];
    sel.innerHTML = '<option value="" selected disabled>' + escapeHtml(t('settings.providerPickHint')) + '</option>' +
      rows.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian || p.id) + '</option>').join('');
    syncTianJiaProvBtn();
    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="" selected>…</option><option value="deepseek">DeepSeek</option><option value="__other__">Other</option>';
    }
  }
  /** 预设清单（与 providers 包 GONGYING_YUSHE 对齐；界面自持，避免下拉空白） */
  function GONGYING_YUSHE_JIAN() {
    return [
      { id: 'deepseek', biaoQian: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1' },
      // MiMo：实测的 OpenAI 兼容端点
      { id: 'mimo', biaoQian: 'MiMo', protocol: 'openai-compatible', baseURL: 'https://api.xiaomimimo.com/v1' },
      { id: 'openai', biaoQian: t('settings.provider.openai') || 'OpenAI', protocol: 'openai-compatible', baseURL: 'https://api.openai.com/v1' },
      { id: 'moonshot', biaoQian: t('settings.provider.moonshot') || 'Moonshot', protocol: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1' },
      { id: 'zhipu', biaoQian: t('settings.provider.zhipu') || 'Zhipu GLM', protocol: 'openai-compatible', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
      { id: 'dashscope', biaoQian: t('settings.provider.dashscope') || 'DashScope', protocol: 'openai-compatible', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { id: 'siliconflow', biaoQian: t('settings.provider.siliconflow') || 'SiliconFlow', protocol: 'openai-compatible', baseURL: 'https://api.siliconflow.cn/v1' },
      { id: 'openrouter', biaoQian: t('settings.provider.openrouter') || 'OpenRouter', protocol: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1' },
      { id: 'anthropic', biaoQian: t('settings.provider.anthropic') || 'Anthropic', protocol: 'anthropic', baseURL: 'https://api.anthropic.com' },
      { id: 'gemini', biaoQian: t('settings.provider.gemini') || 'Gemini', protocol: 'openai-compatible', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
      { id: 'ollama', biaoQian: 'Ollama (本机)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434' },
      { id: 'ollama-remote', biaoQian: t('settings.provider.ollamaCloud') || 'Ollama（云）', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434' },
      { id: 'groq', biaoQian: t('settings.provider.groq') || 'Groq', protocol: 'openai-compatible', baseURL: 'https://api.groq.com/openai/v1' },
      { id: 'mistral', biaoQian: t('settings.provider.mistral') || 'Mistral', protocol: 'openai-compatible', baseURL: 'https://api.mistral.ai/v1' },
      { id: 'together', biaoQian: t('settings.provider.together') || 'Together', protocol: 'openai-compatible', baseURL: 'https://api.together.xyz/v1' },
      { id: 'fireworks', biaoQian: t('settings.provider.fireworks') || 'Fireworks', protocol: 'openai-compatible', baseURL: 'https://api.fireworks.ai/inference/v1' },
      { id: 'perplexity', biaoQian: t('settings.provider.perplexity') || 'Perplexity', protocol: 'openai-compatible', baseURL: 'https://api.perplexity.ai' },
      { id: '__other__', biaoQian: t('settings.providerOther') || 'Other', protocol: 'openai-compatible', baseURL: '' },
    ];
  }



  /** 应用内弹窗：居中于主窗口，替代系统 alert/confirm */
  function uiAlert(message, biaoTi) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const copy = document.createElement('button');
      copy.className = 'anNiuXiao';
      copy.textContent = tOr('chat.copy', '复制');
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(String(message ?? '')); showToast(tOr('chat.copied', '已复制')); } catch { /* noop */ }
      };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => {
        root.classList.add('yinCang');
        resolve(true);
      };
      dongZuoJi.appendChild(copy);
      dongZuoJi.appendChild(ok);
      root.classList.remove('yinCang');
      ok.focus();
    });
  }

  function uiConfirm(message, biaoTi) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
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
        // 确认后**必须关上**：这里原本写成 remove('yinCang')（= 保持打开），
        // 于是「采用新联系方式 / 已联系本人核实」等确认框点完确定还留在屏幕上，
        // 遮住整页（遮蔽层连顶部横幅一起挡住），用户以为没生效、也点不到下面的按钮。
        // 对照 uiConfirmCountdown / uiAlert 的实现：两者都是 add('yinCang')。
        // 若调用方紧接着还要弹下一个框（uiAlert 会自己 remove('yinCang')），不受影响。
        root.classList.add('yinCang');
        resolve(true);
      };
      dongZuoJi.append(cancel, ok);
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
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); clearInterval(jiShiQi); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'anNiuDanger';
      ok.disabled = true;
      let left = seconds;
      const biaoQian = () => (t('urgency.confirmWait') || 'wait {s}s').replace('{s}', String(left));
      ok.textContent = biaoQian();
      const jiShiQi = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(jiShiQi);
          ok.disabled = false;
          ok.textContent = t('common.ok');
        } else {
          ok.textContent = biaoQian();
        }
      }, 1000);
      ok.onclick = () => { if (ok.disabled) return; root.classList.add('yinCang'); clearInterval(jiShiQi); resolve(true); };
      dongZuoJi.append(cancel, ok);
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
      const input = document.createElement('input');
      input.style.cssText = 'width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--input-bg);color:var(--ink);font:inherit';
      input.value = defaultValue ?? '';
      $('duiHuaKuangTi').append(p, input);
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
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
        resolve(input.value);
      };
      dongZuoJi.append(cancel, ok);
      root.classList.remove('yinCang');
      input.focus();
      input.select();
      input.onkeydown = (e) => {
        if (e.key === 'Enter') ok.click();
        if (e.key === 'Escape') cancel.click();
      };
    });
  }

  // ── 头像资源 ──
  /** 群/项目头像：没有自定义图时按名字稳定派生一个预设（换机/重启不变） */
  function groupAvatarSrc(g) {
    if (g && g.avatarDataUrl) return g.avatarDataUrl;
    const s = String((g && (g.ming || g.name || g.id)) || 'group');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
    return PRESET_AVATARS[h % PRESET_AVATARS.length];
  }
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
  /** 由名字稳定派生一个预设序号（换窗口/重启都不变） */
  function presetFromName(name) {
    const s = String(name || 'x');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
    return 1 + (h % PRESET_AVATARS.length);
  }
  function instanceAvatarSrc(inst) {
    if (inst && inst.avatarDataUrl) return inst.avatarDataUrl;
    const n = Number(inst && inst.avatarPreset);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return PRESET_AVATARS[n - 1];
    // 没有 avatarPreset（例如新窗口还没把实例读回来）：按名字派生，保证同一牛马到处一致
    const byName = presetFromName(mingOf(inst) || (inst && inst.id) || '');
    return PRESET_AVATARS[byName - 1];
  }

  /** 实例创建时随机挑一个预设头像 */
  function randomPreset() {
    return 1 + Math.floor(Math.random() * PRESET_AVATARS.length);
  }

  /** 头像选择器：10 个预设 + 选择本地图片 */
  function pickAvatar(LieBiao, currentPreset, labelOf) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('touXiang.pickTitle');
      const duiHuaTi = $('duiHuaKuangTi');
      duiHuaTi.innerHTML = '';
      const wangGe = document.createElement('div');
      wangGe.className = 'touXiangGrid';
      LieBiao.forEach((src, i) => {
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
        wangGe.appendChild(b);
      });
      duiHuaTi.appendChild(wangGe);
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
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
      dongZuoJi.append(localBtn, cancel);
      root.classList.remove('yinCang');
    });
  }

  function applyAvatar() {
    const tuPian = $('selfAvatarImg');
    const kuaDu = $('selfAvatar');
    const src = personAvatarSrc(state.profile);
    if (src) {
      tuPian.src = src;
      tuPian.classList.remove('yinCang');
      kuaDu.classList.add('yinCang');
    } else {
      tuPian.classList.add('yinCang');
      tuPian.removeAttribute('src');
      kuaDu.classList.remove('yinCang');
      kuaDu.textContent = (state.profile.username || t('nav.touXiang')).slice(0, 1);
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
      const lie = [];
      for (let k = 0; k < ROWS; k++) {
        const l = lmax - k * ((lmax - lmin) / (ROWS - 1));
        lie.push(hslToHex(h, Math.min(96, SAT_TOP + k * SAT_STEP), l));
      }
      lieJi.push(lie);
    }
    const wangGe = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < HUES.length; c++) wangGe.push(lieJi[c][r]);
    return wangGe;
  }

  /**
   * 文字偏好：字体 / 粗细 / 大小。
   * 大小是**全局缩放**（不是某一处字号）：按比例放大缩小 `--fs-*` 这套字号变量，
   * 界面上所有用到它们的地方一起变，保持层级关系。
   */
  /**
   * 按**背景亮度**挑文字色（黑 / 白 / 灰分级）—— 保证气泡上的字始终清晰可读。
   * 以前写死 `color:#111`：深色主题的深绿气泡上就是"黑字糊在暗底"，根本看不清。
   */
  function wenZiYanSeBeiJing(bg) {
    const s = String(bg || '').trim();
    let r = 255, g = 255, b = 255;
    const h = s.match(/^#?([0-9a-f]{6})$/i);
    const c = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (h) {
      const n = parseInt(h[1], 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else if (c) {
      r = Number(c[1]); g = Number(c[2]); b = Number(c[3]);
    }
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    /**
     * 前景不做"非黑即白"，而是**多级灰阶**：越是中间调，越往对方那侧多走一点，
     * 这样浅黄、中灰、暗绿、亮蓝等各种底色上都有足够对比度（不会只剩黑/白两档看不清）。
     */
    if (y > 0.82) return '#141414';
    if (y > 0.68) return '#242424';
    if (y > 0.55) return '#333333';
    if (y > 0.45) return '#3d3d3d';
    if (y > 0.35) return '#d8d8d8';
    if (y > 0.22) return '#eaeaea';
    if (y > 0.10) return '#f5f5f5';
    return '#ffffff';
  }
  /** 气泡/强调色上的文字色跟随背景（换主题、换主题色后都要重算） */
  function tongBuBeiJingWenZi() {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const me = cs.getPropertyValue('--me-bubble').trim() || '#95ec69';
    const them = cs.getPropertyValue('--them-bubble').trim() || '#ffffff';
    const accent = cs.getPropertyValue('--accent').trim() || '#A78567';
    root.style.setProperty('--me-bubble-ink', wenZiYanSeBeiJing(me));
    root.style.setProperty('--them-bubble-ink', wenZiYanSeBeiJing(them));
    root.style.setProperty('--accent-ink', wenZiYanSeBeiJing(accent));
  }
  window.__tongBuBeiJingWenZi = tongBuBeiJingWenZi;

  const FS_ZHI = { 'fs-xs': 11, 'fs-sm': 12, 'fs-base': 13, 'fs-md': 14, 'fs-lg': 16, 'fs-xl': 20 };
  function yingYongWenZiPiHao(p) {
    const pp = p || {};
    const root = document.documentElement;
    const ziti = String(pp.fontFamily || '').trim();
    if (ziti) root.style.setProperty('--font-ui', JSON.stringify(ziti) + ', "Segoe UI", "Microsoft YaHei", system-ui, sans-serif');
    else root.style.removeProperty('--font-ui');
    const cuXi = Number(pp.fontWeight) || 400;
    root.style.setProperty('--fw-ui', String(cuXi));
    const daxiao = Math.max(15, Math.min(650, Number(pp.fontSize) || 100)) / 100;
    Object.entries(FS_ZHI).forEach(([k, v]) => {
      root.style.setProperty('--' + k, (Math.round(v * daxiao * 10) / 10) + 'px');
    });
    root.style.setProperty('--text-scale', String(daxiao));
  }
  window.__yingYongWenZiPiHao = yingYongWenZiPiHao;

  /**
   * 简洁 Toast：无边框、半透明（约 67% 不透明）、点击穿透（pointer-events:none）、
   * 2.6 秒自动移除（**真的从 DOM 摘掉**，不留残骸）。
   */
  /**
   * 通知音（产品要求）：用户选了文件就用它，**没选/被清除就用内置默认音效**（主进程给 data URL）。
   * 只在"真的完成/真的失败/需要用户决定"时播 —— 中间思考、工具调用、流式片段都不响。
   */
  const yinXiaoHuanCun = {};
  /** 预加载的 Audio 元素（**兜底**通道，主路是 AudioContext） */
  const yinXiaoYuan = {};
  /**
   * **主路：AudioContext**（真事故修）。
   * HTMLAudioElement 的 `play()` 受自动播放策略影响，首次/静默场景常被拦下；
   * AudioContext 在用户手势里 `resume()` 之后可以**稳定**播放 —— 决策卡第 1 张没声音
   * 的根因就在这里。两条路都留着：AudioContext 失败再退回 HTMLAudioElement。
   */
  let yinPinShangXiaWen = null;
  const jieMaHuanCun = {};
  /**
   * **保活源**（真机反馈修：首次出现的提示音"很小"，像开头几帧被吃掉）。
   *
   * 根因不在解码、也不在 `start(0)`（那是采样级精确的），而在**输出设备还没被拉起来**：
   * AudioContext 刚创建 / 静置一段时间后，声卡流是关着的，第一声要等设备打开，
   * 打开期间的若干个渲染量子会被丢掉 —— 丢掉的正好是**起音包络**，
   * 听起来就是"没从头播、声音变小"。
   *
   * 修法：挂一个**静音的循环源**（0 增益）把输出流一直开着，设备就不会在提示音到来时才冷启动；
   * 再把真正的提示音排在 `currentTime + 20ms`（一点点提前量，避开刚起步的量子）。
   * 代价几乎为零（静音源不产生可听输出），换的是"第一声也是完整的"。
   */
  let yinPinBaoHuo = null;
  /** 保活源挂上多久了（用于决定第一次提示音的提前量） */
  let baoHuoAt = 0;
  function baoHuoYinPin(ctx) {
    if (!ctx || yinPinBaoHuo) return;
    try {
      /**
       * 4 个采样的**极低电平噪声**（≈ -70dBFS，人耳听不到）循环。
       * ⚠️ 不用纯数字静音：部分声卡/驱动会做"静音检测"，把流休眠掉，
       * 于是第一声到来时又要冷启动 ⇒ 起音被吃掉（真机反馈："首次音效很小、像开头几帧被挡"）。
       * 留一丝不可闻的电平，流就一直热着。
       */
      const n = 4;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate || 48000);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.0012;
      const yuan = ctx.createBufferSource();
      yuan.buffer = buf;
      yuan.loop = true;
      const yin = ctx.createGain();
      yin.gain.value = 1;
      yuan.connect(yin);
      yin.connect(ctx.destination);
      yuan.start(0);
      yinPinBaoHuo = { yuan, yin };
      baoHuoAt = Date.now();
    } catch { /* 保活失败不影响播放（只是可能丢掉第一声的起音） */ }
  }
  window.__yinPinBaoHuo = () => !!yinPinBaoHuo;
  /**
   * **播放诊断账本**（只给门禁与真机排查用，不打扰用户）：
   * 记最近 20 次尝试的真实结果 —— 走的哪条通道、音频上下文状态、音量、成不成、失败原因。
   *
   * 为什么要它：本轮"首次决策卡没声音"在代码里看**每一处都像对的**
   * （会响的函数都调了、音源也在），只有把"到底哪条通道、什么状态"记下来，
   * 才能证明修好了，而不是又一次"看着像修好了"。
   * 读法：控制台 `window.__yinXiaoZhenDuan` / `window.__yinXiaoZuiHou`。
   */
  const yinXiaoZhenDuan = [];
  // 一开始就挂到 window 上：账本是空的也能读（否则"没记录"与"没有账本"分不清）
  try { window.__yinXiaoZhenDuan = yinXiaoZhenDuan; } catch { /* noop */ }
  function jiYinXiao(rec) {
    try {
      yinXiaoZhenDuan.push(Object.assign({ ts: Date.now() }, rec || {}));
      if (yinXiaoZhenDuan.length > 20) yinXiaoZhenDuan.shift();
      window.__yinXiaoZhenDuan = yinXiaoZhenDuan;
      window.__yinXiaoZuiHou = yinXiaoZhenDuan[yinXiaoZhenDuan.length - 1];
    } catch { /* 记账失败不影响播放 */ }
  }
  function deDaoShangXiaWen() {
    try {
      if (!yinPinShangXiaWen) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        yinPinShangXiaWen = new AC();
        /**
         * 上下文一变回 running 就把**欠着的那一声**补上。
         * 只靠"用户手势"补播是不够的（用户可能一直不点，卡片就那么无声地跳出来了）；
         * `statechange` 是系统告诉我们"现在能出声了"的**唯一权威信号**。
         */
        yinPinShangXiaWen.addEventListener?.('statechange', () => {
          try {
            // 一变回 running 就先把保活源挂上（设备从这一刻起不再冷启动）
            if (yinPinShangXiaWen && yinPinShangXiaWen.state === 'running') baoHuoYinPin(yinPinShangXiaWen);
            if (yinPinShangXiaWen && yinPinShangXiaWen.state === 'running' && yinXiaoDaiBo) {
              setTimeout(() => { void buBoChenJiYinXiao(); }, 60);
            }
          } catch { /* noop */ }
        });
        baoHuoYinPin(yinPinShangXiaWen);
      }
      return yinPinShangXiaWen;
    } catch { return null; }
  }
  /** dataURL → AudioBuffer（解码失败返回 null，由调用方走兜底） */
  async function jieMaYinPin(u) {
    const ctx = deDaoShangXiaWen();
    if (!ctx || !u) return null;
    if (jieMaHuanCun[u]) return jieMaHuanCun[u];
    try {
      const b64 = String(u).replace(/^data:[^,]+,/, '');
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const buf = await ctx.decodeAudioData(arr.buffer.slice(0));
      jieMaHuanCun[u] = buf;
      return buf;
    } catch { return null; }
  }
  /**
   * **播不出去的提示音先攒着**：自动播放策略/首播被拦时记下来，
   * 等音频解锁或用户第一次手势后**补播**（真事故：决策卡有时没声音，
   * 因为那一次 play() 被策略拦掉后就再也没人重试）。
   */
  let yinXiaoDaiBo = null;
  /** 失败后的**定时重试**：只等用户手势是不够的（用户可能一直不点） */
  let yinXiaoChongShiJi = null;
  function paiYinXiaoChongShi() {
    if (yinXiaoChongShiJi) return;
    yinXiaoChongShiJi = setTimeout(() => {
      yinXiaoChongShiJi = null;
      void buBoChenJiYinXiao();
    }, 700);
  }
  async function chuanBoYinXiao(kind, laiYuan) {
    const k = kind === 'request' ? 'request' : kind === 'error' ? 'error' : 'complete';
    const jiao = { kind: k, laiYuan: String(laiYuan || '') };
    try {
      if (state.sound && state.sound[k] === false) {
        jiYinXiao(Object.assign(jiao, { ok: true, lu: 'off', note: '该类别被用户关掉' }));
        return true;   // 该类别被关掉：不算失败
      }
      let u = yinXiaoHuanCun[k];
      if (!u) {
        const r = await window.warmy.yinXiaoQu?.({ kind: k });
        if (!r || !r.ok || !r.dataUrl) {
          // 音源都取不到也要**记账待补播**：下一次手势/重试时再试一次（否则第一次就彻底没声音）
          yinXiaoDaiBo = k;
          jiYinXiao(Object.assign(jiao, { ok: false, lu: 'no-file', err: (r && r.error) || 'no-data-url' }));
          paiYinXiaoChongShi();
          return false;
        }
        u = r.dataUrl;
        yinXiaoHuanCun[k] = u;
      }
      /**
       * **主路：AudioContext**（真事故修 —— 决策卡第 1 张没声音）。
       * HTMLAudioElement 的 play() 受自动播放策略影响，首次/静默场景常被拦下且难以重试；
       * AudioContext 在用户手势里 resume() 之后可以**稳定**播放。解码一次到处复用。
       */
      try {
        const ctx = deDaoShangXiaWen();
        if (ctx) {
          if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
          const buf = await jieMaYinPin(u);
          const yinLiang = (state.soundVolume != null ? Number(state.soundVolume) : 0.9);
          if (buf && ctx.state === 'running' && yinLiang > 0) {
            baoHuoYinPin(ctx);   // 设备保活：第一声也不许丢起音
            const yuanYin = ctx.createBufferSource();
            yuanYin.buffer = buf;
            const zengYi = ctx.createGain();
            zengYi.gain.value = yinLiang;
            yuanYin.connect(zengYi);
            zengYi.connect(ctx.destination);
            /**
             * **排一点点提前量**而不是 `start(0)`：`start(0)` 是"立刻"，若音频线程/设备还在起步，
             * 最先几个量子会被吞掉（真机反馈："首次音效像开头几帧被挡"）。
             * 保活源刚挂上不久时多给一点（50ms），之后 20ms 就够 —— 人耳听不出这几十毫秒。
             */
            const baoHuoXin = (baoHuoAt && Date.now() - baoHuoAt < 500) ? 0.05 : 0.02;
            const qiShi = ctx.currentTime + baoHuoXin;
            yuanYin.start(qiShi);
            yinXiaoDaiBo = null;
            jiYinXiao(Object.assign(jiao, { ok: true, lu: 'audio-context', ctxState: ctx.state, gain: yinLiang, seconds: buf.duration, baoHuo: !!yinPinBaoHuo }));
            return true;
          }
          // 走到这里就是"主路没能出声"：把原因如实记下来（音量 0 与上下文挂起是两回事）
          jiYinXiao(Object.assign(jiao, {
            ok: false, lu: 'audio-context-skip', ctxState: ctx.state,
            decoded: !!buf, gain: yinLiang,
            note: !buf ? 'decode-failed' : (ctx.state !== 'running' ? 'ctx-not-running' : 'gain-0'),
          }));
        }
      } catch (e) {
        jiYinXiao(Object.assign(jiao, { ok: false, lu: 'audio-context-throw', err: String((e && e.message) || e) }));
      }
      /**
       * 兜底：**预加载的 Audio 元素**播（真事故：决定卡跳出来没音效，点完才响）。
       *
       * 关键点（真事故修）：
       *  ① **不能 `load()` 完就立刻 `play()`** —— 元素还没就绪时 play() 必被拒；
       *     这里等 `canplay`（最多 400ms）再播。
       *  ② 失败按 80/200/360/560ms 退避重试 5 次；
       *  ③ 还不行就**换一个全新 Audio** 再试（复用元素有时被浏览器卡住）；
       *  ④ 全部失败 ⇒ 记进 `yinXiaoDaiBo`，之后**每一次手势都补播**，直到真的播出去。
       */
      const yuan = yinXiaoYuan[k] || (yinXiaoYuan[k] = new Audio());
      if (yuan.src !== u) {
        yuan.src = u;
        // 等就绪（不等就播 = 必被拒）
        await new Promise((r2) => {
          let ting = false;
          const guo = () => { if (!ting) { ting = true; r2(undefined); } };
          yuan.addEventListener('canplay', guo, { once: true });
          yuan.addEventListener('error', guo, { once: true });
          try { yuan.load(); } catch { guo(); }
          setTimeout(guo, 400);
        });
      }
      yuan.volume = (state.soundVolume != null ? state.soundVolume : 0.9);
      const bo = () => yuan.play().then(() => true).catch(() => false);
      let ok = await bo();
      for (let ci = 0; ci < 5 && !ok; ci++) {
        await new Promise((r2) => setTimeout(r2, 80 + ci * 160));
        ok = await bo();
      }
      if (!ok) {
        try {
          const yang = new Audio(u);
          yang.volume = yuan.volume;
          ok = await yang.play().then(() => true).catch(() => false);
          if (ok) yinXiaoYuan[k] = yang;
        } catch { /* 仍失败就如实返回 */ }
      }
      if (ok) yinXiaoDaiBo = null;
      else { yinXiaoDaiBo = k; paiYinXiaoChongShi(); }   // 记下来：手势 + 定时都会补播
      jiYinXiao(Object.assign(jiao, { ok, lu: 'html-audio', ctxState: (yinPinShangXiaWen && yinPinShangXiaWen.state) || 'none', gain: yuan.volume }));
      return ok;
    } catch (e) {
      jiYinXiao(Object.assign(jiao, { ok: false, lu: 'throw', err: String((e && e.message) || e) }));
      yinXiaoDaiBo = k;
      paiYinXiaoChongShi();
      return false;
    }
  }
  window.__chuanBoYinXiao = chuanBoYinXiao;
  /**
   * **朗读一段文字**（用设置里选定的说话模型 / TTS）。
   * 找不到可用的说话模型时**如实告知**，不假装读了。
   */
  let langDuMang = false;
  async function langDuWenBen(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (langDuMang) return false;   // 一次只读一段，避免叠音
    langDuMang = true;
    try {
      const r = await window.warmy.ttsLangDu?.({ text: s.slice(0, 500) });
      if (r && r.ok && r.dataUrl) {
        const a = new Audio(r.dataUrl);
        a.volume = (state.soundVolume != null ? state.soundVolume : 0.9);
        await a.play().catch(() => {});
        return true;
      }
      showToast(String((r && r.error) || tOr('tts.noModel', '没有可用的说话模型（请在「设置 → 模型」里配置）')));
      return false;
    } catch (e) {
      showToast(String(e && e.message || e));
      return false;
    } finally { langDuMang = false; }
  }
  window.__langDuWenBen = langDuWenBen;
  /**
   * **音频解锁**：浏览器自动播放策略会拦掉"没有用户手势"的播放。
   * 真事故：决定卡第 1 张没声音。
   *
   * 这里用 **AudioContext.resume()** 解锁（HTMLAudioElement 的 play() 不可靠，
   * 见 chuanBoYinXiao 里的说明），并把三个提示音**预解码**成 AudioBuffer。
   */
  let yinYueJieSuo = false;
  /**
   * **预热**（三种提示音：取数据 → 解码成 AudioBuffer → 兜底的 Audio 元素也备好）。
   *
   * 真事故修：以前只在"第一次用户手势"里预热 ⇒ 若第一张决策卡在手势**之前**跳出来，
   * 那一次播放既要等 IPC 取音源、又要现解码，一路都是"第一次"的冷路径。
   * 现在**启动即预热**（Electron 里 AudioContext 无需手势就能 running），手势只当补充保险。
   */
  function yinXiaoYuRe() {
    for (const k of ['request', 'complete', 'error']) {
      try {
        void window.warmy.yinXiaoQu?.({ kind: k }).then((r) => {
          if (r && r.ok && r.dataUrl) {
            yinXiaoHuanCun[k] = r.dataUrl;
            void jieMaYinPin(r.dataUrl);
            if (!yinXiaoYuan[k]) {
              const el = new Audio(r.dataUrl);
              el.preload = 'auto';
              el.volume = state.soundVolume != null ? state.soundVolume : 0.9;
              yinXiaoYuan[k] = el;
            }
          }
        }).catch(() => { /* 取不到就走兜底/重试 */ });
      } catch { /* noop */ }
    }
  }
  window.__yinXiaoYuRe = yinXiaoYuRe;
  function jieSuoYinYue() {
    if (yinYueJieSuo) return;
    yinYueJieSuo = true;
    // ① 解锁 AudioContext（这是能稳定出声的那条路）
    try {
      const ctx = deDaoShangXiaWen();
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    } catch { /* noop */ }
    // ② 旧路子也顺手解锁一次（作为兜底通道）
    try {
      const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
      a.volume = 0;
      void a.play().catch(() => { /* 播不出去也不要紧 */ });
    } catch { /* noop */ }
    // ③ 预热（启动时已做过一次，这里补齐"启动那一刻还没起好的")
    yinXiaoYuRe();
    // ④ 补播刚才没播出去的
    setTimeout(() => { void buBoChenJiYinXiao(); }, 60);
  }
  // 启动**立刻**预热（真机反馈：第一张决策卡的音效像"开头几帧被挡"）
  // —— 音频上下文 + 保活源 + 三个音源全部提前备好，第一声不走冷路径
  try { deDaoShangXiaWen(); baoHuoYinPin(yinPinShangXiaWen); yinXiaoYuRe(); } catch { /* noop */ }
  /**
   * 手势保险：**不是 once** —— 万一第一下点击时上下文仍是 suspended，
   * 后面任何一次点击/按键都继续尝试 resume（用户不需要知道这些）。
   */
  function yinXiaoShouShiBaoXian() {
    try {
      const ctx = deDaoShangXiaWen();
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    } catch { /* noop */ }
    jieSuoYinYue();
  }
  window.addEventListener('pointerdown', yinXiaoShouShiBaoXian, { capture: true });
  window.addEventListener('keydown', yinXiaoShouShiBaoXian, { capture: true });
  window.addEventListener('pointerdown', buBoChenJiYinXiao, { capture: true });
  window.addEventListener('keydown', buBoChenJiYinXiao, { capture: true });
  /**
   * 解锁之后补播一次「刚才没播出去」的提示音（决策卡最常见）。
   * 只补一次、只补最后一声 —— 不给用户补一串迟到的音效。
   */
  function buBoChenJiYinXiao() {
    const k = yinXiaoDaiBo;
    yinXiaoDaiBo = null;
    if (!k) return;
    setTimeout(() => { void chuanBoYinXiao(k, 'buBo'); }, 120);
  }
  window.__qingHuanCunYinXiao = () => { Object.keys(yinXiaoHuanCun).forEach((k) => delete yinXiaoHuanCun[k]); };

  function showToast(text) {
    try {
      const old = document.getElementById('jianYiToast');
      if (old) old.remove();
      const el = document.createElement('div');
      el.id = 'jianYiToast';
      el.className = 'jianYiToast';
      el.textContent = String(text || '');
      document.body.appendChild(el);
      setTimeout(() => {
        try { el.classList.add('out'); } catch { /* noop */ }
        setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, 220);
      }, 2600);
    } catch { /* noop */ }
  }
  window.__showToast = showToast;

  /** 应用主题色（色板与自定义入口共用） */
  function applyAccent(color) {
    if (!color) return;
    state.theme = color;
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--me-bubble', color);
    tongBuBeiJingWenZi();
    window.warmy.settingsSave({ accent: color });
    // 对比度提示：过暗/过亮的主题色在浅色/深色底上会看不清 —— 如实提醒
    try {
      const c = String(color).replace('#', '');
      if (c.length === 6) {
        const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
        const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const ti = $('zhuTiDuibiDuTiShi');
        if (ti) {
          ti.textContent = y < 0.18
            ? tOr('settings.themeTooDark', '该主题色偏浅/偏亮，在浅色背景上可能看不清按钮文字')
            : y > 0.82
              ? tOr('settings.themeTooLight', '该主题色偏暗，在深色背景上可能看不清')
              : '';
        }
      }
    } catch { /* noop */ }
  }
  // 启动即上色（产品默认 #A78567；之后以设置里的 accent 为准）
  try {
    document.documentElement.style.setProperty('--accent', state.theme || '#A78567');
    document.documentElement.style.setProperty('--me-bubble', state.theme || '#A78567');
  } catch { /* noop */ }
  try { tongBuBeiJingWenZi(); } catch { /* noop */ }

  /**
   * 全屏取色：主进程截当前屏幕 → 铺一层位图 → 鼠标点哪取哪。
   * 浏览器 EyeDropper 只在本窗口内生效，出窗口鼠标就还原，所以必须走这条路。
   */
  window.__quanPingQuSe = async function quanPingQuSe() {
    try {
      const shot = await window.warmy.captureScreen?.();
      if (!shot || !shot.dataUrl) return null;
      return await new Promise((resolve) => {
        const lay = document.createElement('div');
        lay.id = 'quanPingQuSeCeng';
        lay.style.cssText = 'position:fixed;inset:0;z-index:20000;cursor:crosshair;background:#000;overflow:hidden';
        const img = new Image();
        img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;user-select:none;-webkit-user-drag:none;pointer-events:auto';
        img.src = shot.dataUrl;
        lay.appendChild(img);

        // 十字线（黑白双线，任意背景都可见）
        const crossH = document.createElement('div');
        const crossV = document.createElement('div');
        const crossH2 = document.createElement('div');
        const crossV2 = document.createElement('div');
        const crossCss = 'position:absolute;pointer-events:none;z-index:2';
        crossH2.style.cssText = crossCss + ';height:3px;left:0;right:0;background:rgba(0,0,0,0.75)';
        crossV2.style.cssText = crossCss + ';width:3px;top:0;bottom:0;background:rgba(0,0,0,0.75)';
        crossH.style.cssText = crossCss + ';height:1px;left:0;right:0;background:#fff';
        crossV.style.cssText = crossCss + ';width:1px;top:0;bottom:0;background:#fff';
        lay.appendChild(crossH2); lay.appendChild(crossV2);
        lay.appendChild(crossH); lay.appendChild(crossV);

        // Win11 风格放大镜 + 色值
        const mag = document.createElement('div');
        mag.style.cssText = 'position:absolute;width:120px;height:120px;border:2px solid #fff;border-radius:8px;overflow:hidden;pointer-events:none;z-index:3;box-shadow:0 4px 16px rgba(0,0,0,0.35);background:#000';
        const magCv = document.createElement('canvas');
        magCv.width = 120; magCv.height = 120;
        magCv.style.cssText = 'width:120px;height:120px;display:block;image-rendering:pixelated';
        mag.appendChild(magCv);
        const magTip = document.createElement('div');
        magTip.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(0,0,0,0.75);color:#fff;font-size:12px;border-radius:6px;white-space:nowrap;font-family:Consolas,monospace';
        magTip.textContent = '';
        const magWrap = document.createElement('div');
        magWrap.style.cssText = 'position:absolute;pointer-events:none;z-index:4;display:flex;flex-direction:column;align-items:center';
        magWrap.appendChild(mag); magWrap.appendChild(magTip);
        lay.appendChild(magWrap);

        const cv = document.createElement('canvas');
        let ctx = null;
        const to2 = (n) => n.toString(16).padStart(2, '0');
        const hexOf = (d) => '#' + to2(d[0]) + to2(d[1]) + to2(d[2]);

        const cleanup = (val) => {
          lay.remove();
          document.removeEventListener('keydown', onKey, true);
          resolve(val);
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(null); } };
        document.addEventListener('keydown', onKey, true);
        // 右键取消取色（与 Esc 同效）
        lay.addEventListener('contextmenu', (e) => { e.preventDefault(); cleanup(null); });
        lay.addEventListener('mousedown', (e) => {
          if (e.button === 2) { e.preventDefault(); cleanup(null); }
        });

        img.addEventListener('load', () => {
          cv.width = img.naturalWidth || 1;
          cv.height = img.naturalHeight || 1;
          ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
        });

        const sampleAt = (clientX, clientY) => {
          if (!ctx) return null;
          const rect = img.getBoundingClientRect();
          const nx = (clientX - rect.left) / rect.width;
          const ny = (clientY - rect.top) / rect.height;
          const px = Math.min(cv.width - 1, Math.max(0, Math.floor(nx * cv.width)));
          const py = Math.min(cv.height - 1, Math.max(0, Math.floor(ny * cv.height)));
          return { px, py, d: ctx.getImageData(px, py, 1, 1).data, rect, nx, ny };
        };

        const ZOOM = 12;
        const move = (e) => {
          const s = sampleAt(e.clientX, e.clientY);
          if (!s) return;
          crossH.style.top = e.clientY + 'px';
          crossV.style.left = e.clientX + 'px';
          if (crossH2) crossH2.style.top = (e.clientY - 1) + 'px';
          if (crossV2) crossV2.style.left = (e.clientX - 1) + 'px';
          // 放大镜跟随光标（右下偏移，避免挡住取样点）
          const wrapX = Math.min(window.innerWidth - 150, e.clientX + 24);
          const wrapY = Math.min(window.innerHeight - 170, e.clientY + 24);
          magWrap.style.left = wrapX + 'px';
          magWrap.style.top = wrapY + 'px';
          // 画放大镜
          const mctx = magCv.getContext('2d');
          const half = 5; // 取 11x11
          mctx.imageSmoothingEnabled = false;
          mctx.fillStyle = '#000';
          mctx.fillRect(0, 0, 120, 120);
          const cell = 120 / (half * 2 + 1);
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const sx = Math.min(cv.width - 1, Math.max(0, s.px + dx));
              const sy = Math.min(cv.height - 1, Math.max(0, s.py + dy));
              const d = ctx.getImageData(sx, sy, 1, 1).data;
              mctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
              mctx.fillRect((dx + half) * cell, (dy + half) * cell, cell + 0.5, cell + 0.5);
            }
          }
          // 对准像素：黑底白框 + 外圈黑环（任意背景色下都醒目）
          const cx = half * cell;
          mctx.strokeStyle = '#000';
          mctx.lineWidth = 4;
          mctx.strokeRect(cx, cx, cell, cell);
          mctx.strokeStyle = '#fff';
          mctx.lineWidth = 2;
          mctx.strokeRect(cx, cx, cell, cell);
          mctx.strokeStyle = '#000';
          mctx.lineWidth = 1;
          mctx.strokeRect(cx - 3, cx - 3, cell + 6, cell + 6);
          const hex = hexOf(s.d);
          magTip.textContent = `${hex}  rgb(${s.d[0]}, ${s.d[1]}, ${s.d[2]})`;
          mag.style.outline = '2px solid ' + hex;
        };

        lay.addEventListener('mousemove', move);
        lay.addEventListener('click', (e) => {
          e.preventDefault();
          const s = sampleAt(e.clientX, e.clientY);
          if (s) cleanup(hexOf(s.d));
        });
        document.body.appendChild(lay);
      });
    } catch {
      return null;
    }
  };

  /** 自定义主题色：打开 Win11 风格取色弹窗（见 bindWin11Accent），确定后返回色值 */
  function pickCustomAccent() {
    return new Promise((resolve) => {
      const btn = document.getElementById('anNiuZhuTiCustom');
      if (btn) {
        btn.click();
        // 用户点「确定」后 applyAccent 已写入 state.theme；轮询到值变化即可
        const before = state.theme;
        const timer = setInterval(() => {
          if (state.theme !== before) {
            clearInterval(timer);
            resolve(state.theme);
          }
        }, 200);
        // 最长 5 分钟超时
        setTimeout(() => { clearInterval(timer); resolve(state.theme || before); }, 300000);
        return;
      }
      resolve(null);
    });
  }

  function renderThemeSwatches() {
    const heZi = $('zhuTiSwatches');
    if (!heZi) return;
    // 设置页每次重建都重绑；filled 只挡重复填充
    if (heZi.dataset.filled !== '1') {
      heZi.innerHTML = accentPalette()
        .map((lie) => `<button type="button" data-c="${lie}" style="background:${lie}" title="${lie}"></button>`)
        .join('');
      heZi.dataset.filled = '1';
    }
    heZi.querySelectorAll('button[data-c]').forEach((b) => {
      b.classList.toggle('qiYong', b.dataset.c === state.theme);
      b.onclick = () => {
        applyAccent(b.dataset.c);
        heZi.querySelectorAll('button[data-c]').forEach((x) => x.classList.toggle('qiYong', x === b));
        const prev = $('zhuTiCustomPreview') || document.querySelector('.zhuTiSeKuai');
        if (prev) prev.style.background = state.theme;
      };
    });
    const kuai = document.querySelector('.zhuTiSeKuai') || $('zhuTiCustomPreview');
    if (kuai) kuai.style.background = state.theme || '#A78567';
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
      document.documentElement.style.setProperty('--brand-watermark', `"${escapeHtml(t('brand.name'))}"`);
    } catch {
      /* noop */
    }
    try {
      window.warmy.trayTooltip?.({
        text: `${escapeHtml(t('brand.name'))} ${escapeHtml(t('brand.fu'))}`,
        offWork: t('tray.offWork'),
        header: t('export.header'),
        wo: t('export.wo'),
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
      // 图标按钮无障碍名称跟标题同步：否则读屏器只念写死的英文（如 aria-label="stop"）
      if (yuanSu.getAttribute('aria-label') !== null || !yuanSu.textContent.trim()) {
        yuanSu.setAttribute('aria-label', yuanSu.title);
      }
    });
    $('logoMing').textContent = displayName();
    $('logoFu').textContent = t('brand.fu');
    // Owner rule: top-left biaoTiLan line = logo + tagline ONLY (no chanPin ming qiYong that line).
    if ($('biaoTiLanPinPai')) $('biaoTiLanPinPai').textContent = t('brand.tagline') || t('about.tagline');
    if (typeof updateListWatermark === 'function') updateListWatermark();
        applyAvatar();
    document.title = displayName();
    syncTrayText();
    // T194：控制台表头/清空按钮也走 i18n（面板合着时只更新表头那一行）
    try { renderConsole(); } catch { /* 控制台还没初始化完 */ }
  }

  /**
   * 用户刚选定语言后的一段保护期：期间轮询/回读**不许**把语言改回去。
   *
   * 为什么还要「待确认」这一层：首启引导里改语言只是**即时预览**（还没落盘），
   * 而 5s 轮询拿的是设置文件里的旧值 —— 实测就是"选了英文→界面变英文→几秒后被拉回简体中文，
   * 选择框仍显示英文"。
   *
   * ⚠️ 为什么待确认**不再设兜底过期**（本轮教训）：
   * 上一版给待确认加了 2 分钟兜底，结果用户把引导对话框多放了一会儿（或落盘失败），
   * 2 分钟一到轮询又把界面拉回中文 —— 症状从"几秒"变成"几分钟"，其实还是同一条路径。
   * **用户明确选过语言，本会话就不许任何自动路径再改它**；只有两种情况解除：
   *   1) 设置文件里的值已经等于用户的选择（正常落盘完成）；
   *   2) 用户自己又改了一次（覆盖成新的待确认）。
   * 跨窗口同步不受影响：别的窗口没做过选择，照常跟读设置文件。
   */
  let yuYanBaoHuDao = 0;
  let yuYanDaiQueRen = '';
  function baoHuYuYan(ms = 30000, daiQueRen = '') {
    yuYanBaoHuDao = Date.now() + ms;
    if (daiQueRen) yuYanDaiQueRen = resolveLocalePack(daiQueRen);
  }
  /** 设置文件里的语言已经等于用户的选择 ⇒ 解除待确认（此后正常跟读外部改动） */
  function jieChuYuYanDaiQueRen(weiZhi) {
    if (!yuYanDaiQueRen) return false;
    if (weiZhi && resolveLocalePack(weiZhi) === yuYanDaiQueRen) {
      yuYanDaiQueRen = '';
      yuYanBaoHuDao = 0;
      return true;
    }
    return false;
  }
  /** 引导语言选择框还开着 = 用户正在选：这段时间任何自动路径都无权改语言 */
  function yuYanDuiHuaKuanKaiZhe() {
    try {
      const gen = $('duiHuaKuangGen');
      return !!(gen && !gen.classList.contains('yinCang') && $('chuShiSheZhiYuYan'));
    } catch { return false; }
  }
  function keYiGengYuYan() {
    if (yuYanDaiQueRen) return false;
    if (yuYanDuiHuaKuanKaiZhe()) return false;
    return Date.now() > yuYanBaoHuDao;
  }

  async function loadI18n(yuYan) {
    try { (window.__langTrace = window.__langTrace || []).push({ v: String(yuYan), ms: Date.now(), st: String(new Error().stack || '').split('\n').slice(1, 6).join(' <- ') }); } catch { /* 临时取证 */ }
    const pack = await window.warmy.i18n(yuYan);
    state.yuYan = pack.yuYan;
    state.t = pack.strings;
    if (pack.displayName) state.t['yingYong.displayName'] = pack.displayName;
    window.__refreshUrgency?.();
    window.__refreshSecurity?.();
    applyI18n();
    // 静态 data-i18n 只覆盖一部分；导航标题/列表/当前页都是 t() 动态渲染的，
    // 必须整页重画，否则切语言后这些文案仍是旧语言（首启尤其明显）。
    try { renderList(); } catch { /* noop */ }
    try {
      const lt = $('lieBiaoBiaoTi');
      if (lt) lt.textContent = t(NAV_TITLES[state.nav] || state.nav);
    } catch { /* noop */ }
    try { renderPage(); } catch { /* noop */ }
    try { window.__refreshUrgency?.(); } catch { /* noop */ }
    // 首启引导条上的文案也要跟着语言走
    try { window.__yinDaoChongHua?.(); } catch { /* noop */ }
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
          return '<section class="pvSec"><h4>' + escapeHtml(m[1]) + '</h4><p>' + escapeHtml(m[2].trim()) + '</p></section>';
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
    // 换主题 ⇒ 气泡底色变了，文字色要跟着重算（黑白灰分级）
    try { setTimeout(tongBuBeiJingWenZi, 0); } catch { /* noop */ }
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
    document.querySelectorAll('.ceLanTiaoMu').forEach((yuanSu) => {
      yuanSu.classList.toggle('jiHuo', yuanSu.dataset.nav === nav);
    });
    hideMain();
    // 切页即重算右栏：未选中会话时一律隐藏会话卡片（不再出现"成员/进度"空占位）
    try { refreshPanelVisibility(); } catch { /* noop */ }
    // 顶部横幅依赖「会话是否可见」，等同步流程走完（本函数各分支的 return）再重算
    requestAnimationFrame(() => renderNetBanner());

    if (nav === 'settings' || nav === 'wo') {
      $('appTi').classList.add('yinCangLieBiao');
      // 设置/我的：只显示 pageBuJu，聊天/空态/实例详情一律隐藏
      hideMain();
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
      icon.setAttribute('aria-label', icon.title);
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
      const stillHere = !!cur && pipeiDaohang(cur, nav) && items.some((c) => c.id === cur.id);
      /**
       * 独立会话窗**钉住**了 URL 指定的那一个会话：
       *  · 它在本栏列表里 ⇒ 只打开它（哪怕当前选中的是别的）；
       *  · 它还没进列表（例如群列表还没拉回来）⇒ **什么都不做**，
       *    绝不能退化成"打开第一个" —— 那会把用户点开的会话换成不相干的会话
       *    （产品主反馈的"新窗口联动不对"就是这么来的）。
       */
      const yiGuding = String(state.subWindowPinnedId || '');
      if (yiGuding) {
        const mingZhong = items.find((c) => c.id === yiGuding);
        if (mingZhong && !stillHere) { openChat(mingZhong.kind, mingZhong.id, xianShiMing(mingZhong)); }
        return;
      }
      if (!stillHere && items.length) {
        openChat(items[0].kind, items[0].id, xianShiMing(items[0]));
        return;
      }
    }

    if (!state.selectedChat || !pipeiDaohang(state.selectedChat, nav)) {
      state.selectedChat = null;
      $('liaoTianBuJu').classList.add('yinCang');
      $('kongTai').classList.remove('yinCang');
    } else {
      $('kongTai').classList.add('yinCang');
      $('pageBuJu')?.classList.remove('peiZhiMoShi');
    $('liaoTianBuJu').classList.remove('yinCang');
      renderChat();
      renderQueueBar();
    }
  }

  /** 我的牛马候选列表：优先真实会话，没有会话时用实例兜底 */
  /** 列表排序：按时间（默认，最近有消息在上）或按名称 */
  function sortList(LieBiao) {
    const shuZu = LieBiao.slice();
    if (state.listSort === 'ming') {
      shuZu.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'zh'));
    } else {
      shuZu.sort((x, y) => tsOfItem(y) - tsOfItem(x));
    }
    return shuZu;
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
    return state.instances.map((i) => ({ id: i.id, ming: xianShiMing(i), name: xianShiMing(i), kind: 'single', lastTs: 0 }));
  }

  /** 某个列表页的候选会话列表（用于自动打开第一个） */
  function listItemsFor(nav) {
    if (nav === 'singleAi') return singleChatItems();
    if (nav === 'externalChat') {
      return sortList(state.chats.filter((c) => c.kind === 'extdm'))
        .map((c) => ({ id: c.id, ming: xianShiMing(c), name: xianShiMing(c), kind: 'extdm' }));
    }
    const type = nav === 'internalGroup' ? 'internal' : 'external';
    return sortList(state.groups.filter((g) => g.type === type))
      .map((g) => ({ id: g.id, ming: xianShiMing(g), name: xianShiMing(g), kind: g.type === 'internal' ? 'internal' : 'extgroup' }));
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
    const btn = $('lieBiaoDongZuo');
    const jiaRuAnNiu = $('anNiuJiaRuqr');
    const plusKinds = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
    if (plusKinds && btn) {
      if (jiaRuAnNiu) jiaRuAnNiu.classList.add('yinCang'); // 合并进「+」菜单，不再单独显示
      btn.classList.remove('yinCang');
      btn.textContent = '+';
      btn.title = t('list.addMore') || 'Add…';
      btn.onclick = (e) => {
        e.stopPropagation();
        const old = $('lieBiaoPlusCaiDan');
        if (old) { old.remove(); return; }
        const m = document.createElement('div');
        m.id = 'lieBiaoPlusCaiDan';
        m.className = 'jinJiCaiDan lieBiaoPlusCaiDan';
        const items = state.nav === 'externalChat'
          ? [{ k: 'contact', biaoQian: t('contact.add') }]
          : [
              { k: 'create', biaoQian: state.nav === 'internalGroup' ? t('list.createProject') : t('list.createGroupChat') },
              { k: 'join', biaoQian: state.nav === 'internalGroup' ? t('nav.addProject') : t('nav.addGroup') },
            ];
        m.innerHTML = items.map((it) => '<button type="button" data-lp="' + it.k + '">' + escapeHtml(it.biaoQian) + '</button>').join('');
        btn.parentElement.appendChild(m);
        m.querySelectorAll('button').forEach((b) => {
          b.onclick = (Shi) => {
            Shi.stopPropagation();
            m.remove();
            if (b.dataset.lp === 'create') createGroupFlow();
            else if (b.dataset.lp === 'join') { const jb = $('anNiuJiaRuqr'); if (jb) { jb.classList.remove('yinCang'); jb.click(); } }
            else if (b.dataset.lp === 'contact') { const jb = $('anNiuJiaRuqr'); if (jb) { jb.classList.remove('yinCang'); jb.click(); } }
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
    const btn = $('lieBiaoDongZuo');
    const jiaRuAnNiu = $('anNiuJiaRuqr');
    if (jiaRuAnNiu) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      jiaRuAnNiu.classList.toggle('yinCang', !showJoin);
      jiaRuAnNiu.title = t('join.qrHint');
      if (state.nav === 'internalGroup') jiaRuAnNiu.textContent = t('nav.addProject');
      else if (state.nav === 'externalGroup') jiaRuAnNiu.textContent = t('nav.addGroup');
      else if (state.nav === 'externalChat') {
        // R4：联系人页**只留这一个**添加按钮——右手那个 #lieBiaoDongZuo 原本同名同位（已知缺陷）。
        jiaRuAnNiu.textContent = t('contact.add');
        jiaRuAnNiu.title = t('contact.add');
      }
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.title = t(createKey);
      btn.classList.remove('yinCang');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      // R4：这里不再出现第二个「添加联系人」。加联系人走 #anNiuJiaRuqr（带「我的链接/二维码」的那个弹窗）。
      btn.classList.add('yinCang');
      btn.onclick = null;
    } else if (state.nav === 'instances') {
      btn.textContent = '+';
      btn.title = t('list.addInstance');
      btn.classList.remove('yinCang');
      btn.onclick = addInstanceFlow;
    } else {
      btn.classList.add('yinCang');
      btn.onclick = null;
    }
  }

  function hang(ming, fu, ch, onClick, jiHuo, avatarSrc) {
    const yuanSu = document.createElement('div');
    yuanSu.className = 'lieBiaoTiaoMu' + (jiHuo ? ' jiHuo' : '');
    if (avatarSrc) yuanSu.dataset.av = '1';
    yuanSu.innerHTML = `${avatarSrc ? `<img class="avTuPian" src="${escapeHtml(avatarSrc)}" alt=""/>` : `<div class="av">${escapeHtml(ch || '?')}</div>`}<div class="meta"><div class="name">${escapeHtml(ming)}</div><div class="fu">${escapeHtml(fu)}</div></div>`;
    yuanSu.title = `${ming}\n${fu}`;
    yuanSu.onclick = onClick;
    return yuanSu;
  }

  /** 列表行上的「身份变更待核实」常驻标记（附六：三个入口都能看到） */
  function attachIdChangeMark(hangYuanSu) {
    if (!hangYuanSu || hangYuanSu.querySelector('.idBianGengMark')) return hangYuanSu;
    const m = document.createElement('span');
    m.className = 'idBianGengMark';
    m.setAttribute('data-idchg-mark', '1');
    m.textContent = '! ' + escapeHtml(t('idchg.pending'));
    m.title = escapeHtml(t('idchg.biaoTi')) + ' · ' + escapeHtml(t('idchg.marker'));
    hangYuanSu.appendChild(m);
    return hangYuanSu;
  }

  /**
   * 列表行上的提示（产品要求，本版定稿）：
   *   · **第二行 = 最新的回复内容**（单行截断，绝不溢出）；
   *   · **新回复数放在第二行内容前面**：`[3] 最新回复…`；没有新回复时是灰色的 `[无]`；
   *   · 被打断的任务（`?`）照旧标在行上。
   *
   * 说明：上一版用的是右上角微信式小圆圈 —— 产品主改成"放第二行前面"，所以小圆圈撤掉，
   * 计数改走行首前缀（同一个 `state.unread` 账本）。
   */
  function attachChatMarks(hangYuanSu, sid) {
    if (!hangYuanSu || !sid) return hangYuanSu;
    hangYuanSu.dataset.sid = String(sid);
    hangYuanSu.querySelector('.weiDuJiaoBiao')?.remove();
    hangYuanSu.querySelector('.renWuZhongDuanMark')?.remove();
    const n = Number(state.unread[sid] || 0);
    // 第二行：把"新回复数"作为前缀插到最新回复内容前面
    const fu = hangYuanSu.querySelector('.fu');
    if (fu) {
      const wenBen = String(fu.textContent || '').trim();
      const qianZhui = n > 0
        ? '<span class="weiDuQianZhui">[' + (n > 99 ? '99+' : String(n)) + ']</span>'
        : '<span class="weiDuQianZhui wu">[' + escapeHtml(tOr('list.none', '无')) + ']</span>';
      fu.innerHTML = qianZhui + '<span class="fuWenBen" title="' + escapeHtml(wenBen) + '">' + escapeHtml(wenBen) + '</span>';
    }
    if (state.planInterrupted && state.planInterrupted.has(String(sid))) {
      const q = document.createElement('span');
      q.className = 'renWuZhongDuanMark';
      q.textContent = '?';
      q.title = escapeHtml(tOr('chat.resumeTaskHint', '上次的任务被打断了（程序异常/退出/重启）。点这里接着做。'));
      hangYuanSu.appendChild(q);
    }
    return hangYuanSu;
  }

  /**
   * R12：停用（stopped）的牛马实例 → 整行灰 + 名字删除线（灰仍须可读，见 --ink-dim）。
   * R11 在成员列表里，列表行这里只处理实例自身的停用态。
   */
  function applyInstanceRowState(hangYuanSu, inst, sessionKind) {
    if (!hangYuanSu || !inst) return hangYuanSu;
    if (inst.status === 'stopped') {
      hangYuanSu.classList.add('isJinYong');
      const mingCheng = hangYuanSu.querySelector('.name');
      if (mingCheng) mingCheng.classList.add('struck');
      const b = document.createElement('span');
      b.className = 'hangHuiZhang off';
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
    const q = ($('lieBiaoSouSuo').value || '').trim().toLowerCase();
    const heZi = $('lieBiaoTi');
    heZi.innerHTML = '';

    if (state.nav === 'instances') {
      const hw = state.hardware || { cpus: '—', suggested: '—', max: '—' };
      const ka = document.createElement('div');
      ka.className = 'lieBiaoKa';
      ka.innerHTML = `<h4>${escapeHtml(t('instances.hardware'))}</h4>
        <div class="jingYin">${escapeHtml(t('instances.cpus'))}: <b>${escapeHtml(String(hw.cpus ?? '—'))}</b></div>
        <div class="jingYin">${escapeHtml(t('instances.suggested'))}: <b>${escapeHtml(String(hw.suggested ?? '—'))}</b></div>
        <div class="jingYin">${escapeHtml(t('instances.max'))}: <b>${escapeHtml(String(hw.max ?? '—'))}</b></div>`;
      heZi.appendChild(ka);
      state.instances
        .filter((i) => !q || (mingOf(i)).toLowerCase().includes(q))
        .forEach((inst) => {
          const moXingMing = inst.defaultModel && inst.defaultModel !== '__smart__'
            ? inst.defaultModel
            : (inst.model || tOr('instances.smartPick', '智能选择'));
          const hangYuanSu = hang(
            mingOf(inst) || inst.id,
            (inst.status === 'running' ? t('instances.running') : t('instances.stopped')) + ' · ' + moXingMing,
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
          hangYuanSu.ondblclick = () => {
            setNav('singleAi');
            openChat('single', inst.id, xianShiMing(inst));
          };
          applyInstanceRowState(hangYuanSu, inst, 'single');
          heZi.appendChild(hangYuanSu);
        });
      return;
    }

    if (state.nav === 'singleAi') {
      const items = sortList(state.chats
        .filter((c) => c.kind === 'single')
        .filter((c) => !q || c.name.toLowerCase().includes(q)));
      const source = items.length
        ? items
        : state.instances.map((i) => ({ id: i.id, ming: xianShiMing(i), name: xianShiMing(i), kind: 'single', lastPreview: t('list.noReply') }));
      if (!source.length) {
        // 一个实例都没有 → 显示「进入牛马管理局」按钮
        heZi.innerHTML = `<div class="enterHqBaoGuo">
          <div class="jingYin">${escapeHtml(t('list.empty'))}</div>
          <button class="enterHqAnNiu" id="anNiuEnterHq">
            <svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>
            <span>${escapeHtml(t('nav.instances'))}</span>
          </button>
        </div>`;
        $('anNiuEnterHq')?.addEventListener('click', () => setNav('instances'));
        return;
      }
      source.forEach((c) => {
        const inst = state.instances.find((x) => x.id === c.id);
        const hangYuanSu = hang(
          c.name,
          // 第二行 = **最新的回复内容**（产品要求；模型名不再挤在这一行）
          (c.lastPreview || t('list.noReply')),
          c.name[0],
          () => openChat('single', c.id, xianShiMing(c)),
          state.selectedChat?.id === c.id,
          inst ? instanceAvatarSrc(inst) : null
        );
        const menuInst = inst || { id: c.id, ming: c.name, status: 'stopped', notify: true };
        bindRowContext(hangYuanSu, () => agentMenu(menuInst, hangYuanSu));
        applyInstanceRowState(hangYuanSu, inst, 'single');
        attachChatMarks(hangYuanSu, c.id);
        heZi.appendChild(hangYuanSu);
      });
      return;
    }

    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const items = sortList(state.groups.filter((g) => g.type === type).filter((g) => !q || g.name.toLowerCase().includes(q)));
      if (!items.length) {
        heZi.innerHTML = `<div class="lieBiaoKong">${escapeHtml(t('list.empty'))}</div>`;
        return;
      }
      items.forEach((g) => {
        const hangYuanSu = hang(
          g.name,
          `${t('group.type.' + g.type)} · ${g.members?.length || 0}`,
          g.ming[0],
          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, xianShiMing(g)),
          state.selectedChat?.id === g.id
        );
        bindRowContext(hangYuanSu, () => qunCaidan(g, hangYuanSu));
        if (hasPendingIdChange(g.type === 'internal' ? 'internal' : 'extgroup', g.id)) attachIdChangeMark(hangYuanSu);
        attachChatMarks(hangYuanSu, g.id);
        heZi.appendChild(hangYuanSu);
      });
      return;
    }

    if (state.nav === 'externalChat') {
      const items = sortList(state.chats.filter((c) => c.kind === 'extdm').filter((c) => !q || c.name.toLowerCase().includes(q)));
      if (!items.length) {
        heZi.innerHTML = `<div class="lieBiaoKong">${escapeHtml(t('list.empty'))}</div>`;
        return;
      }
      items.forEach((c) => {
        const hangYuanSu = hang(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, xianShiMing(c)), state.selectedChat?.id === c.id);
        if (hasPendingIdChange('extdm', c.id)) attachIdChangeMark(hangYuanSu);
        attachChatMarks(hangYuanSu, c.id);
        heZi.appendChild(hangYuanSu);
      });
    }
  }

  function openChat(kind, id, ming) {
    state.selectedChat = { kind, id, ming };
    hideMain();
    $('pageBuJu')?.classList.remove('peiZhiMoShi');
    $('liaoTianBuJu').classList.remove('yinCang');
    $('liaoTianBiaoTi').textContent = ming;
    $('liaoTianYuanShuju').textContent =
      kind === 'internal' ? t('group.type.internal') : kind.includes('ext') ? t('group.type.external') : t('nav.singleAi');
    window.__refreshSecurity?.();
    // 思考级别覆盖是"一次性"的：只对当前聊天对象生效，换会话即失效
    if (state.thinkOverride) {
      Object.keys(state.thinkOverride).forEach((k) => { if (k !== id) delete state.thinkOverride[k]; });
    }
    try { window.__refreshThink?.(); } catch { /* noop */ }
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
      if (!r || !r.ok || !Array.isArray(r.xiaoXiJi) || !r.xiaoXiJi.length) return;
      /**
       * 角色**归一到渲染层的命名**（wo / them）。
       * 日志里历史上出现过 user/assistant 与 wo/them 两套写法，以前只认 `user`
       * ⇒ `wo` 被映射成 `them`，与本地的同一条内容**重复显示**（本轮真事故：一句话显示两遍）。
       * 两套写法都归到 wo/them 后，合并按 role+text 去重才对得上。
       */
      const fromMain = r.xiaoXiJi.map((m) => ({
        role: (m.role === 'user' || m.role === 'wo') ? 'wo' : 'them',
        text: m.text, ts: m.ts || Date.now(),
        reasoning: m.reasoning || '',
        system: !!m.system,
        moXing: m.moXing || '',
      }));
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

  /**
   * 实体级状态变了：把**本窗口这一处视图**按最新事实重画。
   *
   * ⚠️ 必须先校验：只有当变化的实体**正是当前窗口正在看的那个**才动右栏。
   * 否则"牛马1 的变化"会把"牛马2 的界面"刷成牛马1 的内容（数据串台）。
   * 列表刷新与会话无关，照常做。
   */
  async function refreshEntityView(id) {
    const sid = String(id || '');
    const cur = state.selectedChat && state.selectedChat.id;
    const shiDangQian = !!cur && String(cur) === sid;
    if (shiDangQian) {
      try {
        const s = await window.warmy.projectState?.({ sessionId: sid }).catch(() => null);
        if (s && s.ok && s.state) state.selectedChatProject = s.state;
      } catch { /* noop */ }
      try { renderChat(); } catch { /* noop */ }
      try { void renderProjectStateBlock?.(); } catch { /* noop */ }
      try { refreshContainerConsoleGate?.(); } catch { /* noop */ }
    }
    try { renderList(); } catch { /* noop */ }
  }


  /** 聊天：展示**完整真实**记录；DOM 只挂最近 N 条，上滑加载；新消息按策略滚动 */
  const CHAT_VIEW_WINDOW = 20;
  const chatViewVisible = {};
  /** 自动滚动（默认关）：由三点菜单勾选；持久化到 settings */
  let autoScrollChat = false;
  let pendingNewest = null; // { text, role }

  /**
   * 极简 Markdown → HTML（模型回复基本都是 Markdown，直接当纯文本显示很难看）。
   * 先整体转义再按行处理，所以不会引入注入；支持：代码块、标题、列表、引用、粗斜体、行内码、链接。
   */
  function mdHtml(text) {
    const esc = escapeHtml(String(text || ''));
    const kuai = [];
    // 1) 先抠出代码块（占位，避免里面的符号被当 Markdown）
    let s0 = esc.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      kuai.push('<pre class="mdCode" data-lang="' + escapeHtml(lang || '') + '">' + code.replace(/\n$/, '') + '</pre>');
      return '\u0000K' + (kuai.length - 1) + '\u0000';
    });
    const hang = s0.split('\n');
    const out = [];
    let zaiLieBiao = false;
    const guanLieBiao = () => { if (zaiLieBiao) { out.push('</ul>'); zaiLieBiao = false; } };
    for (const yuan of hang) {
      const h = yuan.trim();
      if (!h) { guanLieBiao(); continue; }
      if (/^\u0000K\d+\u0000$/.test(h)) { guanLieBiao(); out.push(kuai[Number(h.replace(/\u0000K|\u0000/g, ''))] || ''); continue; }
      const biao = h.match(/^(#{1,4})\s+(.*)$/);
      if (biao) { guanLieBiao(); const n = biao[1].length; out.push('<h' + (n + 2) + ' class="mdH">' + biao[2] + '</h' + (n + 2) + '>'); continue; }
      const yin = h.match(/^&gt;\s?(.*)$/);
      if (yin) { guanLieBiao(); out.push('<blockquote class="mdQ">' + yin[1] + '</blockquote>'); continue; }
      const xiang = h.match(/^[-*+]\s+(.*)$/) || h.match(/^\d+[.)]\s+(.*)$/);
      if (xiang) { if (!zaiLieBiao) { out.push('<ul class="mdUl">'); zaiLieBiao = true; } out.push('<li>' + xiang[1] + '</li>'); continue; }
      guanLieBiao();
      out.push('<p class="mdP">' + h + '</p>');
    }
    guanLieBiao();
    s0 = out.join('');
    // 2) 行内格式
    s0 = s0
      .replace(/`([^`\n]+)`/g, '<code class="mdCi">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s0;
  }
  window.__mdHtml = mdHtml;

  function msgsOf(chatId) {
    return (window.__msgs && window.__msgs[chatId]) || [];
  }

  /** 完整时间（24 小时制）：YYYY-MM-DD HH:mm:ss —— 悬停在气泡上显示 */
  function wanZhengShiJian(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  /** 主动显示的时间：YYYY-MM-DD HH:mm（到**分**，不带秒 —— 秒只在悬停里给） */
  function nianYueShiFen(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** 分隔点文案：同一天内显示「HH:mm」，跨日显示「M月D日 HH:mm」 */
  function shiJianDianWen(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const tongRi = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return tongRi
      ? `${p(d.getHours())}:${p(d.getMinutes())}`
      : `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** 跨小时或跨日 ⇒ 要插时间分隔点 */
  function kuaShiJianDian(prevTs, curTs) {
    const a = new Date(Number(prevTs) || 0);
    const b = new Date(Number(curTs) || 0);
    if (!Number(prevTs)) return false;
    return a.getHours() !== b.getHours() || a.getDate() !== b.getDate() || a.getMonth() !== b.getMonth();
  }
  /** 发出时间：M月D日 HH:mm（待执行队列里用；悬停看完整时间） */
  function yueRiShiFen(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** 已等待时长（时:分:秒）—— 待执行队列里用 */
  function dengDaiShiChang(ts) {
    let s = Math.max(0, Math.floor((Date.now() - (Number(ts) || Date.now())) / 1000));
    const p = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${p(h)}:${p(m)}:${p(s)}`;
  }
  // 待执行队列的「已等待」每秒走一次（只在有排队项时动 DOM）
  setInterval(() => {
    const ji = document.querySelectorAll('[data-deng]');
    if (!ji.length) return;
    const q = state.selectedChat ? queueOf(state.selectedChat.id) : [];
    ji.forEach((el) => {
      const item = q[Number(el.getAttribute('data-deng'))];
      if (item) el.textContent = dengDaiShiChang(item.ts || Date.now());
    });
  }, 1000);

  function isAtBottom(heZi) {
    return heZi.scrollHeight - heZi.scrollTop - heZi.clientHeight < 12;
  }

  function updateScrollAffordances(heZi) {
    const btn = $('scrollDiAnNiu');
    const bub = $('newXiaoXiBubble');
    const zaiDiBu = heZi ? isAtBottom(heZi) : true;
    if (btn) btn.classList.toggle('yinCang', zaiDiBu);
    if (bub) {
      if (zaiDiBu || !pendingNewest) {
        bub.classList.add('yinCang');
      } else {
        bub.classList.remove('yinCang');
        bub.textContent = String(pendingNewest.text || '').slice(0, 120);
      }
    }
  }

  function scrollToBottom(smooth) {
    const heZi = $('xiaoXiJi');
    if (!heZi) return;
    pendingNewest = null;
    try { heZi.scrollTo({ top: heZi.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
    catch { heZi.scrollTop = heZi.scrollHeight; }
    updateScrollAffordances(heZi);
  }

  /**
   * 渲染聊天。滚动策略：
   *  - 自动滚动开：总是滚到底（最后一条的最后一句可见）
   *  - 自动滚动关（默认）：新内容滚到「能看见」为止；若新消息比视口高，
   *    则把它的**顶部**对齐到视口顶部并不再继续滚动（从头展示），此时显示下箭头
   */
  /**
   * **流式"正在进行"的气泡**：思考块默认展开、正文逐步追加。
   * 只在聊天末尾挂这一条（`data-streaming=1`），正式回复到了就被收走。
   *
   * 真事故修：
   *  ① 以前每帧 `innerHTML = …` **整块重建** ⇒ 思考块滚动位置被拍回顶部，
   *     用户既看不到下面、也滚不动。现在结构只建一次，之后**只改文本**。
   *  ② 思考内容**自动跟到最新一条**；用户手动滚上去就停止跟随，滚回底部再恢复。
   *  ③ 限频是「**节流 + 尾随**」：最后一段内容一定会被画出来（旧实现直接 return，
   *     流结束时最后一段就丢了）。
   */
  let _liuShiHuaShangCi = 0;
  let _liuShiDaiHua = null;
  function xuanRanLiuShiKuai(sid, b) {
    const heZi = $('xiaoXiJi');
    if (!heZi) return;
    if (state.selectedChat && String(state.selectedChat.id) !== String(sid)) return;
    // 节流 + 尾随：密到 100ms 内的增量先攒着，最后一次一定画出来
    const now = Date.now();
    if (now - _liuShiHuaShangCi < 100) {
      _liuShiDaiHua = { sid, b: { reasoning: String(b.reasoning || ''), content: String(b.content || '') } };
      return;
    }
    _liuShiHuaShangCi = now;
    _liuShiDaiHua = null;
    let kuai = heZi.querySelector('[data-streaming="1"]');
    const zaiDiBu = isAtBottom(heZi);
    if (!kuai) {
      kuai = document.createElement('div');
      kuai.className = 'xiaoXi liuShiKuai';
      kuai.setAttribute('data-streaming', '1');
      heZi.appendChild(kuai);
    }
    // 思考块：结构只建一次（不重建 innerHTML，滚动位置才留得住）
    let si = kuai.querySelector('.liuShiSiKao');
    if (b.reasoning && !si) {
      const wrap = kuai.querySelector('.bubbleWrap') || (() => {
        kuai.innerHTML = '<div class="bubbleWrap"></div>';
        return kuai.querySelector('.bubbleWrap');
      })();
      wrap.insertAdjacentHTML('afterbegin',
        '<details class="siKaoKuai" open><summary>' + escapeHtml(tOr('chat.thinkingOpen', '思考中…')) + '</summary><pre class="liuShiSiKao"></pre></details>');
      si = kuai.querySelector('.liuShiSiKao');
    }
    if (si) {
      si.textContent = b.reasoning || '';
      // 用户手动滚上去了 ⇒ 不抢视线；在底部（或很接近）⇒ 跟随到最新
      const zaiDi = si.scrollHeight - si.scrollTop - si.clientHeight < 28;
      if (!si.dataset.userScrolled || zaiDi) {
        si.dataset.userScrolled = '';
        si.scrollTop = si.scrollHeight;
      }
      if (!si.dataset.bound) {
        si.dataset.bound = '1';
        si.addEventListener('scroll', () => {
          const d = si.scrollHeight - si.scrollTop - si.clientHeight < 28;
          si.dataset.userScrolled = d ? '' : '1';
        }, { passive: true });
      }
    }
    let zh = kuai.querySelector('.liuShiZhengWen');
    if (b.content && !zh) {
      const wrap = kuai.querySelector('.bubbleWrap') || (() => {
        kuai.innerHTML = '<div class="bubbleWrap"></div>';
        return kuai.querySelector('.bubbleWrap');
      })();
      wrap.insertAdjacentHTML('beforeend', '<div class="bubble md liuShiZhengWen"></div>');
      zh = kuai.querySelector('.liuShiZhengWen');
    }
    if (zh) zh.textContent = b.content || '';
    if (zaiDiBu) { try { heZi.scrollTop = heZi.scrollHeight; } catch { /* noop */ } }
    // 尾随：把刚才被节流掉的那一份补画（含最后一段）
    if (_liuShiDaiHua) {
      const d = _liuShiDaiHua;
      _liuShiDaiHua = null;
      setTimeout(() => { _liuShiHuaShangCi = 0; xuanRanLiuShiKuai(d.sid, d.b); }, 110);
    }
  }
  /** 正式回复到了：把流式气泡收掉（正式那条里的思考块**自动折叠**） */
  function shouLiuShiKuai() {
    try {
      const heZi = $('xiaoXiJi');
      if (heZi) heZi.querySelectorAll('[data-streaming="1"]').forEach((n) => n.remove());
    } catch { /* noop */ }
  }
  window.__shouLiuShiKuai = shouLiuShiKuai;

  /**
   * **这段文字有没有实际内容**（真机反馈修：回复完成后多出一条只有「。」的回复）。
   *
   * 模型偶尔只吐一个标点当作答复；原来只判 `trim()` ⇒ 标点被当成正文 ⇒ 界面多一个空气泡。
   * 这里把"只有标点/空白/零宽字符"一律当**没有内容**，走既有的空回复占位文案。
   * （主进程侧同一套判据见 `youShiZhiWenBen`，两处都拦，任何入口进来的都不显示空话。）
   */
  function youShiZhiWenBen(wen) {
    const s = String(wen || '')
      .replace(/[\s\u200B-\u200F\uFEFF]/g, '')
      .replace(/[.,;:!?'"`~^\-_=+*\\/|<>()[\]{}@#$%&。，、；：！？…·—～「」『』（）【】《》“”‘’]/g, '');
    return s.length > 0;
  }
  window.__youShiZhiWenBen = youShiZhiWenBen;

  function renderChat(opts) {
    const heZi = $('xiaoXiJi');
    if (!heZi) return;
    const o = opts || {};
    const chatId = state.selectedChat && state.selectedChat.id;
    const xiaoXi = chatId ? msgsOf(chatId) : [];
    /**
     * 可见条数 = max(已加载数, min(窗口, 总条数))。
     * 早期写成 `min(chatViewVisible[id] || 20, xiaoXi.length)`：日志只有 1 条时把窗口锁成 1，
     * 之后新消息只会把旧的挤出视野（实测"发了消息但看不到"）。
     */
    const xianshi = Math.min(Math.max(chatViewVisible[chatId] || CHAT_VIEW_WINDOW, Math.min(CHAT_VIEW_WINDOW, xiaoXi.length)), xiaoXi.length);
    chatViewVisible[chatId] = xianshi;
    const slice = xiaoXi.slice(Math.max(0, xiaoXi.length - xianshi));
    const wasAtBottom = isAtBottom(heZi);
    heZi.innerHTML = '';
    const hiddenCount = xiaoXi.length - slice.length;
    if (hiddenCount > 0) {
      const gengDuo = document.createElement('button');
      gengDuo.className = 'liaoTianJiaZaiGengDuo anNiuXiao';
      gengDuo.textContent = `↑ ${t('chat.loadMore') || 'Load earlier'} (${hiddenCount})`;
      gengDuo.onclick = () => {
        chatViewVisible[chatId] = (chatViewVisible[chatId] || CHAT_VIEW_WINDOW) + CHAT_VIEW_WINDOW;
        renderChat({ keepScroll: true });
      };
      heZi.appendChild(gengDuo);
    }
    // 对方头像/名称：我的牛马用该实例的头像与名字；项目/群聊用群头像与群名
    const cur = state.selectedChat || {};
    const curInst = (state.instances || []).find((x) => x && (x.id === cur.id || x.ming === cur.ming || x.name === cur.name));
    const themName = String(curInst ? mingOf(curInst) : (cur.name || cur.ming || '')).trim();
    const themAvatar = curInst
      ? instanceAvatarSrc(curInst)
      : (cur.kind === 'internal' || cur.kind === 'extgroup'
        ? (cur.avatarDataUrl || groupAvatarSrc(cur))
        : PERSON_DEFAULT);
    let shangYiTiaoShiJian = 0;
    /** 上一次**主动显示**的时间（跨时才显示；跨自然日加分隔线） */
    let shangCiZhuDong = 0;
    /**
     * **被打断的任务：「继续 / 重试」按钮出现在牛马的最新回复里**（产品要求）。
     * 任何异常（卡死/闪退/超时/超限/模型调用失败）让任务停在半路、又没能自我修复，
     * 恢复可交互后，这条最新回复里就带一个按钮：点了先分析错误、规避/修复，再接着做；
     * 用户若直接发了新对话且 AI 已收到，按钮**变灰不可再点**。
     */
    const sidYong = state.selectedChat && state.selectedChat.id;
    const beiDaDuan = !!(sidYong && state.planInterrupted && state.planInterrupted.has(String(sidYong)));
    const yiGuanBi = !!(state.planResumeDisabled && state.planResumeDisabled[String(sidYong)]);
    const zuiHouThem = (function () {
      let z = -1;
      slice.forEach((m, i) => { if (m && !m.system && m.role !== 'wo') z = i; });
      return z;
    })();
    const fuHuoAnNiuHtml = (beiDaDuan || yiGuanBi)
      ? '<button type="button" class="anNiuZhuYao huiFuRenWuBtn"' + (yiGuanBi ? ' disabled' : '') + '>'
        + escapeHtml(yiGuanBi ? tOr('chat.resumeTaskExpired', '已过期（你已开始新的对话）') : tOr('chat.resumeTask', '继续 / 重试'))
        + '</button>'
      : '';
    slice.forEach((m, i) => {
      // **内部指令不进聊天记录**（自动续派的「继续执行计划…」只给模型看，不是用户说的话）
      if (m && m.hidden) return;
      // ── 主动显示时间：与上次主动显示的"时"不同才显示；跨自然日加浅分隔线 ──
      const ts = Number(m.ts || 0) || Date.now();
      if (!shangCiZhuDong || kuaShiJianDian(shangCiZhuDong, ts)) {
        const zhuDong = document.createElement('div');
        const kuaRi = shangCiZhuDong && new Date(shangCiZhuDong).getDate() !== new Date(ts).getDate();
        zhuDong.className = 'zhuDongShiJian' + (kuaRi ? ' kuaRi' : '');
        zhuDong.textContent = nianYueShiFen(ts);
        heZi.appendChild(zhuDong);
        shangCiZhuDong = ts;
      }
      shangYiTiaoShiJian = ts;
      // 系统小字（如"本轮模型：xxx"）：不画气泡，居中一行浅色小字
      if (m.system) {
        const xi = document.createElement('div');
        xi.className = 'xiTongXiaoZi';
        xi.textContent = m.text;
        heZi.appendChild(xi);
        return;
      }
      const div = document.createElement('div');
      div.className = 'xiaoXi' + (m.role === 'wo' ? ' wo' : '');
      // 悬停显示完整时间到**秒**；其余一律只到**分**（产品要求）
      div.title = wanZhengShiJian(ts);
      // 我方头像 = 「我的」页设的头像（自定义图 > 人物头像 > 默认），不再用「主」字占位
      const woTou = personAvatarSrc(state.profile);
      const av = `<img class="touXiangTuPian" src="${woTou}" alt=""/>`;
      const themAv = `<img class="touXiangTuPian" src="${themAvatar}" alt=""/>`;
      // 群聊/项目：气泡上方显示名称（微信样式）；一对一不显示
      const showName = m.role !== 'wo' && !!themName
        && (cur.kind === 'internal' || cur.kind === 'extgroup' || cur.kind === 'extdm');
      // 思考过程（有才显示）：**回答中展开、回答完成后折叠**（最后一条 + 本轮还在跑 ⇒ open）
      const zaiPao = !!queueRounds[cur.id];
      const shiZuiHou = i === slice.length - 1;
      const siKaoKai = zaiPao && shiZuiHou;
      const siKao = m.reasoning
        ? '<details class="siKaoKuai"' + (siKaoKai ? ' open' : '') + '><summary>'
          + escapeHtml(siKaoKai ? tOr('chat.thinkingOpen', '思考中…') : tOr('chat.thinkingDone', '思考过程'))
          + '</summary><pre>' + escapeHtml(String(m.reasoning)) + '</pre></details>'
        : '';
      const zuYaoHuiFuFu = (i === zuiHouThem) && (beiDaDuan || yiGuanBi) && m.role !== 'wo';
      div.innerHTML = (m.role === 'wo' ? av : themAv)
        + '<div class="bubbleWrap">'
        + (showName ? '<div class="xiaoXiMing">' + escapeHtml(themName) + '</div>' : '')
        + siKao
        + (m.role === 'wo'
            // 我方消息是**纯文本**：原样显示（pre-wrap），复制才不会丢换行
            ? '<div class="bubble">' + escapeHtml(m.text) + '</div>'
            : '<div class="bubble md">' + mdHtml(m.text) + '</div>')
        + (m.role === 'wo' ? '' :
          // 牛马回复：第一行 = 模型名称（只显示名称，不带「本轮模型」前缀；人说的会话不显示）
          '<div class="xiaoXiMoXing">' + escapeHtml(String(m.moXing || '').replace(/^本轮模型[：:]\s*/, '')) + '</div>')
        // 第二行：时间 + 朗读 + 复制（**牛马和人的回复都有**；与模型名一起悬停出现，不居中）
        // 产品要求：⧉ 与 🔊 **对调位置**（朗读在前、复制在后），且 🔊 换成**线条单色**图标
        + '<div class="xiaoXiJiao"><div class="xiaoXiJiaoHang">' +
          '<span class="xiaoXiShiJian">' + escapeHtml(wanZhengShiJian(ts)) + '</span>' +
          '<button type="button" class="xiaoXiLangDu" title="' + escapeHtml(tOr('chat.read', '朗读')) + '" data-read="' + escapeHtml(m.text) + '">'
          + '<svg viewBox="0 0 24 24" class="xiaoXiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 8.7a4.6 4.6 0 0 1 0 6.6"/>'
          + '</svg></button>' +
          '<button type="button" class="xiaoXiFuZhi" title="' + escapeHtml(tOr('chat.copy', '复制')) + '" data-copy="' + escapeHtml(m.text) + '">⧉</button>' +
          (zuYaoHuiFuFu ? fuHuoAnNiuHtml : '') +
          '</div></div>'
        + '</div>';
      // 悬停复制：一次委托绑定（复制 + 朗读）
      if (heZi.dataset.copyBound !== '1') {
        heZi.dataset.copyBound = '1';
        heZi.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-copy]');
          if (b) {
            e.preventDefault(); e.stopPropagation();
            try {
              await navigator.clipboard.writeText(b.getAttribute('data-copy') || '');
              showToast(tOr('chat.copied', '已复制'));
            } catch { /* 剪贴板不可用 */ }
            return;
          }
          const d = e.target.closest('[data-read]');
          if (d) {
            e.preventDefault(); e.stopPropagation();
            void langDuWenBen(d.getAttribute('data-read') || '');
          }
        });
      }
      heZi.appendChild(div);
    });
    if (heZi.dataset.lazyBound !== '1') {
      heZi.dataset.lazyBound = '1';
      heZi.addEventListener('scroll', () => {
        const id2 = state.selectedChat && state.selectedChat.id;
        if (heZi.scrollTop < 40 && id2) {
          const total = msgsOf(id2).length;
          const vis = chatViewVisible[id2] || CHAT_VIEW_WINDOW;
          if (vis < total) {
            chatViewVisible[id2] = Math.min(total, vis + CHAT_VIEW_WINDOW);
            renderChat({ keepScroll: true });
            heZi.scrollTop = 80;
            return;
          }
        }
        if (isAtBottom(heZi)) pendingNewest = null;
        updateScrollAffordances(heZi);
      });
    }
    const last = heZi.lastElementChild;
    if (o.keepScroll) {
      // 加载历史：保持位置
    } else if (autoScrollChat) {
      /**
       * **勾选「自动滚动聊天记录」**：一直滚到最底，最新内容全部露出来。
       */
      scrollToBottom(false);
    } else if (last && wasAtBottom) {
      /**
       * **未勾选（默认）＝ 像 DeepSeek 网页版那样"不抢你的视线"**：
       *   · 最新那条**比聊天框高** ⇒ 把它的**开头**对齐聊天框顶部就停住，
       *     之后流式内容继续长也不会把你拽到中间 —— 你可以从第一行读起；
       *   · 最新那条**不够高** ⇒ 只滚到"刚好把它完整露出来"为止（底部对齐），
       *     否则顶上会留一块莫名其妙的空白（这正是上一版照"一律顶部对齐"做出来的毛病）。
       *
       * **勾选**才是"一直跟到最底"（见上面那个分支）。
       */
      const maxScroll = Math.max(0, heZi.scrollHeight - heZi.clientHeight);
      const lastTop = last.offsetTop;
      const lastH = last.offsetHeight;
      if (lastH <= heZi.clientHeight) {
        // 放得下：底部对齐（不多滚一格、也不留空白）
        heZi.scrollTop = Math.min(maxScroll, Math.max(0, lastTop + lastH - heZi.clientHeight));
      } else {
        // 比视口高：从头读
        heZi.scrollTop = Math.min(lastTop, maxScroll);
      }
      updateScrollAffordances(heZi);
    } else {
      updateScrollAffordances(heZi);
    }
    /**
     * **被打断的任务：「继续/重试」按钮**（产品要求）。
     * 形态 = 最新一条聊天记录的样子；点了就能接着做；用户若直接发了新消息而没点它，
     * 按钮**自动失效变灰**（新对话已经开始，旧任务不再被自动续上）。
     */
    try {
      /**
       * 兜底：一条牛马回复都没有时（例如任务刚开就崩了），仍给一行提示 + 按钮。
       * 有回复时按钮**已经挂在最新那条回复里**（见上面 footer）。
       */
      if ((beiDaDuan || yiGuanBi) && zuiHouThem < 0) {
        const hang = document.createElement('div');
        hang.className = 'xiaoXi huiFuRenWuHang' + (yiGuanBi ? ' yiGuoQi' : '');
        hang.innerHTML =
          '<div class="bubbleWrap">' +
          '<div class="bubble">' + escapeHtml(tOr('chat.resumeTaskHint', '上次的任务被打断了（程序异常/退出/重启）。点这里接着做。')) + '</div>' +
          '<div class="xiaoXiJiao"><div class="xiaoXiJiaoHang">' + fuHuoAnNiuHtml + '</div></div></div>';
        heZi.appendChild(hang);
      }
      // 「继续 / 重试」：不管按钮挂在哪儿，共用一套行为
      heZi.querySelectorAll('.huiFuRenWuBtn').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.onclick = () => {
          if (btn.disabled) return;
          const sid = state.selectedChat && state.selectedChat.id;
          const wei = (state.renWuZhongDuan && sid && state.renWuZhongDuan[String(sid)]) || {};
          const why = String(wei.why || tOr('chat.resumeTaskHint', '任务被中断'));
          const jieDuan = String(wei.jieDuan || '');
          /**
           * 点了就**带上中断原因**发一条内部指令：让模型先分析原因、规避/修复，
           * 再继续或重新执行（产品要求："点击后就会分析发生的错误…然后继续或重新执行"）。
           * 有「从哪一步断的」就一并告诉模型，续传不是从头懵。
           */
          const zhiLing = tOr('chat.resumeTaskCmd', '【继续执行】上次任务因「{why}」中断。请先分析原因并规避或修复，然后继续或重新执行未完成的任务。')
            .replace('{why}', why)
            + (jieDuan ? ' ' + tOr('chat.resumeTaskFrom', '（中断发生在：{jieDuan}）').replace('{jieDuan}', jieDuan) : '');
          const ru = $('shuRu');
          if (ru) { ru.value = zhiLing; void faSong(); }
          if (sid && state.planInterrupted) state.planInterrupted.delete(String(sid));
          try { renderList(); } catch { /* noop */ }
        };
      });
    } catch { /* 恢复按钮失败不得中断渲染 */ }
    const duty = $('dutyXinXi');
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
      const ming = (typeof t === 'function' && t('brand.name')) || 'WArmy';
      document.documentElement.style.setProperty('--brand-watermark', `"${String(ming)}"`);
      const yuanSu = document.getElementById('lieBiaoWatermark');
      if (yuanSu) yuanSu.setAttribute('data-brand', String(ming));
    } catch { /* noop */ }
  }

  function tuisongXiaoxi(chatId, role, text, opts) {
    window.__msgs = window.__msgs || {};
    window.__msgs[chatId] = window.__msgs[chatId] || [];
    /**
     * 去重规则与主进程保持一致：与**上一条** role+text 完全相同就跳过。
     * 否则窗口比主进程日志多出重复条目，两处视图看起来就不一样
     *（实测：窗口 4 条 / 日志 2 条）。
     */
    const yuanYou = window.__msgs[chatId];
    const shangYiTiao = yuanYou[yuanYou.length - 1];
    if (!(shangYiTiao && shangYiTiao.role === role && shangYiTiao.text === text)) {
      yuanYou.push({ role, text, ts: Date.now(), reasoning: (opts && opts.reasoning) || '', system: !!(opts && opts.system), moXing: (opts && opts.moXing) || '' });
      // 正式回复到了 ⇒ 收掉流式"正在进行"的气泡（里面的思考块随之折叠）
      if (role === 'them' && !(opts && opts.system)) {
        try { shouLiuShiKuai(); } catch { /* noop */ }
        if (state.streamBuf) delete state.streamBuf[chatId];
      }
      /**
       * **未读角标**（微信式）：对方/牛马的新回复 +1。
       * 产品要求：**即使当前正开着这个会话也照常亮**，直到用户点了该聊天界面里的
       * 任何元素（消息区/输入框/按钮）才清零 —— 所以这里不做"当前会话就跳过"的判断。
       */
      if (role === 'them' && !(opts && opts.system)) {
        state.unread = state.unread || {};
        // 单会话上限 999（防长跑把数字撑得没法看；到顶就停）
        const xianZai = Number(state.unread[chatId] || 0);
        state.unread[chatId] = Math.min(999, xianZai + 1);
        try { renderList(); } catch { /* noop */ }
      }
    }
    /**
     * **同时写进主进程日志**（唯一事实来源）。
     * 只有写进那里，"主界面 + 独立窗"才真的是同一套数据：
     * 以前项目/群聊的消息只 push 在本窗口内存里，新窗口打开就是空的。
     * 主进程侧对"与上一条完全相同"去重 ⇒ 单聊路径（chat-send 已记账）不会重复。
     */
    try { void window.warmy.chatLogAppend?.({ sessionId: chatId, role, content: text, system: !!(opts && opts.system), moXing: (opts && opts.moXing) || '' }); } catch { /* noop */ }
    if (state.selectedChat && state.selectedChat.id === chatId) {
      const heZi = $('xiaoXiJi');
      const zaiDiBu = heZi ? isAtBottom(heZi) : true;
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
        for (const [k, shuZu] of Object.entries(state.queues || {})) {
          if (!Array.isArray(shuZu) || !shuZu.length) continue;
          out[k] = shuZu.map((x) => ({
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
      for (const [k, shuZu] of Object.entries(q)) {
        if (!Array.isArray(shuZu) || !shuZu.length) continue;
        state.queues[k] = shuZu.map((x) => ({
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
      return { state: false, files: false, jinDu: false, model: false, dir: false, members: false, kb: false, summary: false, assist: false };
    }
    const work = kind === 'single' || kind === 'internal';
    const chat = kind === 'external' || kind === 'externalChat' || kind === 'extGroup' || kind === 'extgroup' || kind === 'externalGroup';
    const group = kind === 'internal' || kind === 'external' || kind === 'externalGroup' || kind === 'extgroup';
    return {
      state: work,
      files: work,
      jinDu: work,
      model: work || group,
      dir: kind === 'internal',
      members: group,              // 仅项目/群聊；我的牛马与联系人**没有**
      kb: kind === 'internal' || chat,
      summary: kind === 'internal' || chat,
      assist: work || chat,
    };
  }

  /** 第四列默认卡片（我的牛马 / 项目）；其余由用户添加 */
  /**
   * 第四列默认卡片集合。
   * 注意 `xiangMuJiYiKuai`（项目记忆）**不进默认集合** —— 它不是"人人都有"的卡片：
   * 只有**项目**才配得上"项目规矩/目标"，显隐由 `renderProjectMemoryPanel` 按
   * "这个会话是不是项目"决定（我的牛马/联系人/群聊一律看不到）。
   */
  const PAN_DEFAULT = {
    single: ['diagMianBanKuai', 'mianBanAssistKuai', 'mianBanMoXingMgrKuai', 'mianBanZhiShiKuKuai'],
    internal: ['diagMianBanKuai', 'xiangMuTaiKuai', 'mianBanJinDuKuai', 'mianBanAssistKuai', 'mianBanMoXingMgrKuai', 'mianBanZhiShiKuKuai', 'mianBanZhiShiKuQunKuai', 'mianBanMuLuKuai', 'xiangMuWenJianJiKuai', 'mianBanChengYuanJiKuai', 'mianBanZhiBanZheKuai', 'mianBanHuiTuiDianKuai', 'mianBanZhiXingKuai', 'mianBanZhiBiaoKuai'],
  };
  const PAN_ALL = {
    diagMianBanKuai: 'diag', xiangMuTaiKuai: 'state', mianBanJinDuKuai: 'jinDu',
    mianBanAssistKuai: 'assist', mianBanMoXingMgrKuai: 'model', mianBanZhiShiKuKuai: 'kb',
    mianBanZhiShiKuQunKuai: 'kb2', mianBanMuLuKuai: 'dir', xiangMuWenJianJiKuai: 'files',
    mianBanChengYuanJiKuai: 'members', mianBanZhaiYaoKuai: 'summary',
    mianBanZhiBanZheKuai: 'duty', mianBanHuiTuiDianKuai: 'checkpoint',
    mianBanZhiXingKuai: 'exec', mianBanZhiBiaoKuai: 'metrics',
    mianBanDingShiKuai: 'schedule', mianBanJiHuaKuai: 'plan',
    xiangMuJiYiKuai: 'pm',
  };
  function panCardsFor(kind) {
    try {
      const saved = state.panCards && state.panCards[kind];
      if (Array.isArray(saved) && saved.length) return saved;
    } catch { /* noop */ }
    return (PAN_DEFAULT[kind === 'single' ? 'single' : 'internal'] || []).slice();
  }
  /** 给第四列每张卡片右上角补「×」：悬停才显示，点击从本类布局里移除 */
  function ensurePanCardCloseButtons() {
    const host = $('mianBanLan');
    if (!host) return;
    host.querySelectorAll(':scope > .mianBanKuai').forEach((ka) => {
      if (ka.querySelector(':scope > .kaGuanBi')) return;
      if (!ka.id || !PAN_ALL[ka.id]) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kaGuanBi';
      btn.title = tOr('panel.removeCard', '从本页移除');
      btn.setAttribute('aria-label', btn.title);
      btn.textContent = '×';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
        const cur = panCardsFor(k).filter((x) => x !== ka.id);
        state.panCards = state.panCards || {};
        state.panCards[k] = cur;
        try { window.warmy.settingsSave?.({ panCards: state.panCards }); } catch { /* noop */ }
        refreshPanelVisibility();
      });
      ka.appendChild(btn);
    });
  }
  window.__ensurePanCardCloseButtons = ensurePanCardCloseButtons;

  /**
   * 第四列卡片**自动补回**（产品要求）：用户关掉了也不要紧，
   * 定时任务到点 / 有文件生成时 —— 检查卡片在不在，不在就加回来。
   */
  function queBaoKaPian(kaId) {
    const ka = $(kaId);
    if (!ka) return;
    const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
    const cur = panCardsFor(k);
    if (!cur.includes(ka.id)) {
      state.panCards = state.panCards || {};
      state.panCards[k] = [...cur, ka.id];
      try { window.warmy.settingsSave?.({ panCards: state.panCards }); } catch { /* noop */ }
    }
    ka.classList.remove('yinCang');
    ka.style.display = '';
    try { refreshPanelVisibility(); } catch { /* noop */ }
  }
  window.__queBaoKaPian = queBaoKaPian;

  /** 计划任务卡片：任务树 T1/T1.1 —— 步骤可见、可阻塞/恢复、逐个完成并逐个验证 */
  function renderJiHuaKa() {
    const he = $('jiHuaLieBiao');
    if (!he) return;
    // 折叠/展开（隐藏计划模式：只留标题，内容收起）
    const shouQi = $('jiHuaShouQi');
    if (shouQi && !shouQi.dataset.bound) {
      shouQi.dataset.bound = '1';
      shouQi.onclick = () => {
        const kai = he.classList.toggle('yinCang');
        shouQi.textContent = kai ? '+' : '−';
        try { window.warmy.settingsSave?.({ planCardCollapsed: kai }); } catch { /* noop */ }
      };
      // 恢复上次折叠状态
      (async () => {
        try {
          const r = await window.warmy.settingsGet?.();
          if (r?.settings?.planCardCollapsed) {
            he.classList.add('yinCang');
            shouQi.textContent = '+';
          }
        } catch { /* noop */ }
      })();
    }
    const bu = state.jiHuaRenWu || [];
    if (!bu.length) {
      he.innerHTML = '<div class="jingYin">' + escapeHtml(tOr('panel.plan.empty', '还没有计划；长任务可让牛马先列计划再逐个完成')) + '</div>';
      return;
    }
    const tongji = { pending: 0, doing: 0, done: 0, verified: 0, blocked: 0 };
    bu.forEach((x) => { tongji[x.status] = (tongji[x.status] || 0) + 1; });
    he.innerHTML =
      '<div class="jingYin" style="margin-bottom:6px">' +
      escapeHtml(tOr('panel.plan.progress', '进度')) + ' ' + (tongji.verified + tongji.done) + '/' + bu.length +
      ' · ' + escapeHtml(tOr('panel.plan.verified', '已验证')) + ' ' + tongji.verified +
      (tongji.doing ? ' · ' + escapeHtml(tOr('panel.plan.doing', '进行中')) + ' ' + tongji.doing : '') +
      (tongji.blocked ? ' · ' + escapeHtml(tOr('panel.plan.blocked', '受阻')) + ' ' + tongji.blocked : '') +
      '</div>' +
      bu.map((x) =>
        '<div class="jiHuaBu" data-st="' + escapeHtml(x.status) + '">' +
        '<span class="jiHuaId">' + escapeHtml(x.id || '') + '</span>' +
        '<span class="jiHuaMing">' + escapeHtml(x.title || '') + '</span>' +
        '<span class="jiHuaZhuangTai">' + escapeHtml(tOr('panel.plan.' + x.status, x.status)) + '</span>' +
        (x.note ? '<div class="jingYin" style="font-size:11px;word-break:break-all">' + escapeHtml(x.note) + '</div>' : '') +
        '</div>'
      ).join('');
  }
  window.__renderJiHuaKa = renderJiHuaKa;

  /** 定时任务卡片 */
  function renderDingShiKa() {
    const he = $('dingShiLieBiao');
    if (!he) return;
    const LieBiao = state.dingShiRenWu || [];
    if (!LieBiao.length) {
      he.innerHTML = '<div class="jingYin">' + escapeHtml(tOr('panel.schedule.empty', '暂无定时任务')) + '</div>';
      return;
    }
    he.innerHTML = LieBiao.map((r) =>
      '<div style="margin:6px 0">' +
      '<div>' + escapeHtml(r.name || '') + '</div>' +
      '<div class="jingYin" style="font-size:11px">' + escapeHtml(r.desc || '') + ' · ' +
        escapeHtml(tOr('panel.schedule.next', '下次')) + ' ' + escapeHtml(yueRiShiFen(r.nextAt)) + '</div>' +
      '<div class="jingYin" style="font-size:11px;word-break:break-all">' + escapeHtml(String(r.prompt || '').slice(0, 60)) + '</div>' +
      '<button class="anNiuXiao" data-sch-tg="' + escapeHtml(r.id) + '" style="margin-top:2px">' + escapeHtml(r.enabled === false ? tOr('panel.schedule.resume', '恢复') : tOr('panel.schedule.pause', '暂停')) + '</button>' +
      '<button class="anNiuXiao" data-sch-del="' + escapeHtml(r.id) + '" style="margin-top:2px">' + escapeHtml(t('chat.queueDelete')) + '</button>' +
      '</div>'
    ).join('');
    he.querySelectorAll('[data-sch-tg]').forEach((b) => {
      b.onclick = async () => {
        const id = b.getAttribute('data-sch-tg');
        const it = (state.dingShiRenWu || []).find((x) => x.id === id);
        if (!it) return;
        it.enabled = it.enabled === false;
        try { await window.warmy.dingShiRenWuGengXin?.({ id, enabled: it.enabled }); } catch { /* noop */ }
        renderDingShiKa();
      };
    });
    he.querySelectorAll('[data-sch-del]').forEach((b) => {
      b.onclick = async () => {
        try { await window.warmy.dingShiRenWuShanChu?.({ id: b.getAttribute('data-sch-del') }); } catch { /* noop */ }
        state.dingShiRenWu = (state.dingShiRenWu || []).filter((x) => x.id !== b.getAttribute('data-sch-del'));
        renderDingShiKa();
      };
    });
  }


  /** 第四列：自定义卡片（需求 / 成果）渲染 */
  function renderPanCustomCards(kind) {
    const host = $('mianBanLan');
    if (!host) return;
    let bar = $('panKaPianTianJia');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'panKaPianTianJia';
      bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0 0 10px;flex-wrap:wrap';
      bar.innerHTML = `
        <select id="panKaXuanZe" style="flex:1;min-width:120px">
          <option value="custom">${escapeHtml(tOr('panel.addCustomCard', '自定义卡片'))}</option>
          <option value="xiangMuTaiKuai">${escapeHtml(tOr('panel.projectState', '项目状态'))}</option>
          <option value="mianBanJinDuKuai">${escapeHtml(tOr('panel.jinDu', '进度'))}</option>
          <option value="mianBanAssistKuai">${escapeHtml(tOr('panel.assist.title', tOr('panel.assist', '等待协助')))}</option>
          <option value="mianBanMoXingMgrKuai">${escapeHtml(tOr('panel.modelMgr', '模型管理'))}</option>
          <option value="mianBanZhiShiKuKuai">${escapeHtml(tOr('panel.kb.biaoTi', tOr('panel.kb.title', '知识库')))}</option>
          <option value="mianBanMuLuKuai">${escapeHtml(tOr('panel.dir', '项目目录'))}</option>
          <option value="xiangMuWenJianJiKuai">${escapeHtml(tOr('panel.projectFiles', '项目文件与产物'))}</option>
          <option value="mianBanDingShiKuai">${escapeHtml(tOr('panel.schedule.title', '定时任务'))}</option>
          <option value="mianBanChengYuanJiKuai">${escapeHtml(tOr('panel.members', '成员'))}</option>
          <option value="mianBanZhaiYaoKuai">${escapeHtml(tOr('panel.summary.biaoTi', tOr('panel.summary.title', '摘要')))}</option>
          <option value="mianBanZhiBanZheKuai">${escapeHtml(tOr('panel.duty', '值班者'))}</option>
          <option value="mianBanHuiTuiDianKuai">${escapeHtml(tOr('checkpoints.biaoTi', '回退点'))}</option>
          <option value="mianBanZhiXingKuai">${escapeHtml(tOr('executors.biaoTi', '执行者'))}</option>
          <option value="mianBanZhiBiaoKuai">${escapeHtml(tOr('metrics.biaoTi', '性能指标'))}</option>
          <option value="mianBanZhiShiKuQunKuai">${escapeHtml(tOr('knowledge.biaoTi', '知识库'))}</option>
          <option value="diagMianBanKuai">${escapeHtml(tOr('console.biaoTi', '诊断事件流'))}</option>
        </select>
        <button class="anNiuXiao" id="panKaTianJia">${escapeHtml(tOr('panel.addCard', '添加'))}</button>`;
      host.insertBefore(bar, host.firstChild);
      $('panKaTianJia')?.addEventListener('click', () => {
        const v = $('panKaXuanZe')?.value || 'custom';
        if (v === 'custom') { showCustomCardDialog(); return; }
        const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
        const cur = panCardsFor(k);
        const flashTo = (el) => {
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.remove('cardFlash');
            // 强制 reflow，保证连续点击同一张卡也能再次闪烁
            void el.offsetWidth;
            el.classList.add('cardFlash');
            setTimeout(() => { el.classList.remove('cardFlash'); }, 1800);
          } catch { /* noop */ }
        };
        if (cur.includes(v)) {
          const el = document.getElementById(v);
          if (el) { el.classList.remove('yinCang'); el.style.display = ''; flashTo(el); }
          return;
        }
        cur.push(v);
        state.panCards = state.panCards || {};
        state.panCards[k] = cur;
        try { window.warmy.settingsSave?.({ panCards: state.panCards }); } catch { /* noop */ }
        refreshPanelVisibility();
        setTimeout(() => { const el = document.getElementById(v); if (el) flashTo(el); }, 80);
      });
    }
    // 自定义卡片列表
    let box = $('panZiDingYiJi');
    if (!box) {
      box = document.createElement('div');
      box.id = 'panZiDingYiJi';
      host.insertBefore(box, bar.nextSibling);
    }
    const customs = (state.customCards || []).filter((c) => !kind || c.kind === (kind === 'single' ? 'single' : 'internal'));
    box.innerHTML = customs.map((c, idx) => `
      <div class="mianBanKuai" data-custom-card="${idx}">
        <h3>${escapeHtml(t('panel.customCard') || '自定义卡片')}</h3>
        <div class="jingYin" style="margin-bottom:4px">${escapeHtml(t('panel.requirement') || '需求')}</div>
        <div style="white-space:pre-wrap;max-height:120px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px">${escapeHtml(c.req || '')}</div>
        <div class="jingYin" style="margin:8px 0 4px">${escapeHtml(t('panel.result') || '成果')}</div>
        <div style="white-space:pre-wrap;max-height:160px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px">${escapeHtml(c.res || '—')}</div>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="anNiuXiao" data-custom-edit="${idx}">${escapeHtml(t('common.edit') || '编辑')}</button>
          <button class="anNiuXiao" data-custom-del="${idx}">${escapeHtml(t('common.delete') || '删除')}</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-custom-del]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.customDel);
      const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
      const list = (state.customCards || []).filter((c) => c.kind === k);
      const target = list[i];
      if (target) state.customCards = (state.customCards || []).filter((c) => c !== target);
      try { window.warmy.settingsSave?.({ customCards: state.customCards }); } catch { /* noop */ }
      renderPanCustomCards(kind);
    }));
    box.querySelectorAll('[data-custom-edit]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.customEdit);
      const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
      const list = (state.customCards || []).filter((c) => c.kind === k);
      showCustomCardDialog(list[i]);
    }));
  }
  /** 自定义卡片弹窗：需求 5000 字上限，固定高度+滚动，取消/保存 */
  function showCustomCardDialog(edit) {
    const root = $('duiHuaKuangGen');
    if (!root) return;
    $('duiHuaKuangBiaoTi').textContent = t('panel.customCard') || '自定义卡片';
    const duiHuaTi = $('duiHuaKuangTi');
    duiHuaTi.innerHTML = `
      <div class="jingYin" style="margin-bottom:4px">${escapeHtml(t('panel.requirement') || '需求')}（≤5000）</div>
      <textarea id="customReq" maxlength="5000" style="width:100%;height:160px;resize:none;overflow:auto"></textarea>
      <div class="jingYin" style="margin:8px 0 4px">${escapeHtml(t('panel.result') || '成果')}</div>
      <div id="customRes" style="max-height:120px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px">—</div>`;
    $('customReq').value = edit ? (edit.req || '') : '';
    if (edit) $('customRes').textContent = edit.res || '—';
    const dongZuoJi = $('duiHuaKuangDongZuoJi');
    dongZuoJi.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel') || '取消';
    cancel.onclick = () => root.classList.add('yinCang');
    const save = document.createElement('button');
    save.className = 'anNiuZhuYao';
    save.textContent = t('common.save') || '保存';
    save.onclick = async () => {
      const req = ($('customReq')?.value || '').slice(0, 5000);
      const k = state.selectedChat && state.selectedChat.kind === 'single' ? 'single' : 'internal';
      state.customCards = state.customCards || [];
      if (edit) {
        edit.req = req;
        // 成果：值班 AI 生成（有 Key 时）
        try {
          const r = await window.warmy.customCardGenerate?.({ req });
          if (r && r.ok && r.text) edit.res = r.text;
        } catch { /* noop */ }
      } else {
        let res = '';
        try {
          const r = await window.warmy.customCardGenerate?.({ req });
          if (r && r.ok && r.text) res = r.text;
        } catch { /* noop */ }
        state.customCards.push({ kind: k, req, res });
      }
      try { window.warmy.settingsSave?.({ customCards: state.customCards }); } catch { /* noop */ }
      root.classList.add('yinCang');
      refreshPanelVisibility();
    };
    dongZuoJi.append(cancel, save);
    root.classList.remove('yinCang');
  }
  function applyPanelVisibility(kindRaw) {
    const v = panelVisibilityFor(kindRaw);
    try {
      window.__panelLog = window.__panelLog || [];
      window.__panelLog.push({ f: 'apply', kind: String(kindRaw || ''), members: v.members, t: Date.now() });
      if (window.__panelLog.length > 60) window.__panelLog.shift();
    } catch { /* noop */ }
    const set = (id, qiYong) => {
      const yuanSu = document.getElementById(id);
      if (!yuanSu) return;
      yuanSu.classList.toggle('yinCang', !qiYong);
      yuanSu.style.display = qiYong ? '' : 'none';
      yuanSu.setAttribute('data-panel-hidden', qiYong ? '0' : '1');
    };
    // 用户可自定义卡片集合（默认见 PAN_DEFAULT）
    const kind = String(kindRaw || '');
    const want = new Set(kind === 'none' || !kind ? [] : panCardsFor(kind === 'single' ? 'single' : 'internal'));
    const vis = {
      xiangMuTaiKuai: want.has('xiangMuTaiKuai'),
      xiangMuWenJianJiKuai: want.has('xiangMuWenJianJiKuai'),
      mianBanJinDuKuai: want.has('mianBanJinDuKuai'),
      mianBanMoXingMgrKuai: want.has('mianBanMoXingMgrKuai'),
      mianBanMuLuKuai: want.has('mianBanMuLuKuai'),
      mianBanChengYuanJiKuai: want.has('mianBanChengYuanJiKuai'),
      mianBanZhiShiKuKuai: want.has('mianBanZhiShiKuKuai'),
      mianBanZhaiYaoKuai: want.has('mianBanZhaiYaoKuai'),
      mianBanAssistKuai: want.has('mianBanAssistKuai'),
      diagMianBanKuai: want.has('diagMianBanKuai'),
      mianBanZhiBanZheKuai: want.has('mianBanZhiBanZheKuai'),
      mianBanHuiTuiDianKuai: want.has('mianBanHuiTuiDianKuai'),
      mianBanZhiXingKuai: want.has('mianBanZhiXingKuai'),
      mianBanZhiBiaoKuai: want.has('mianBanZhiBiaoKuai'),
      mianBanZhiShiKuQunKuai: want.has('mianBanZhiShiKuQunKuai'),
      xiangMuJiYiKuai: want.has('xiangMuJiYiKuai'),
    };
    set('xiangMuTaiKuai', vis.xiangMuTaiKuai);
    set('xiangMuWenJianJiKuai', vis.xiangMuWenJianJiKuai);
    set('mianBanJinDuKuai', vis.mianBanJinDuKuai);
    set('mianBanMoXingMgrKuai', vis.mianBanMoXingMgrKuai);
    set('mianBanMuLuKuai', vis.mianBanMuLuKuai);
    set('mianBanChengYuanJiKuai', vis.mianBanChengYuanJiKuai);
    set('mianBanZhiShiKuKuai', vis.mianBanZhiShiKuKuai);
    set('mianBanZhaiYaoKuai', vis.mianBanZhaiYaoKuai);
    set('mianBanAssistKuai', vis.mianBanAssistKuai);
    set('diagMianBanKuai', vis.diagMianBanKuai);
    set('mianBanZhiBanZheKuai', vis.mianBanZhiBanZheKuai);
    set('mianBanHuiTuiDianKuai', vis.mianBanHuiTuiDianKuai);
    set('mianBanZhiXingKuai', vis.mianBanZhiXingKuai);
    set('mianBanZhiBiaoKuai', vis.mianBanZhiBiaoKuai);
    set('mianBanZhiShiKuQunKuai', vis.mianBanZhiShiKuQunKuai);
    set('xiangMuJiYiKuai', vis.xiangMuJiYiKuai);
    // 自定义卡片容器
    try { renderPanCustomCards(kind); } catch { /* noop */ }
    try { ensurePanCardCloseButtons(); } catch { /* noop */ }
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
    membersClass: (document.getElementById('mianBanChengYuanJiKuai') || {}).className || '',
    membersHidden: !!document.getElementById('mianBanChengYuanJiKuai')?.classList.contains('yinCang'),
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
    const host = document.getElementById('mianBanZhiShiKuHe');
    if (!host) return;
    const qunId = state.selectedChat && state.selectedChat.id;
    if (!qunId) { host.textContent = '—'; return; }
    try {
      const r = await window.warmy.knowledgeQuery?.(qunId);
      const ents = (r && r.entities) || [];
      const evs = (r && r.events) || [];
      host.innerHTML = (ents.length || evs.length)
        ? [
            ...ents.slice(0, 6).map((e) => `<div class="pkHang">${escapeHtml(e.name || e.id)}</div>`),
            ...evs.slice(0, 6).map((e) => `<div class="pkHang jingYin">${escapeHtml(e.title || '')}</div>`),
          ].join('')
        : `<div class="jingYin">${escapeHtml(t('knowledge.empty') || '—')}</div>`;
    } catch {
      host.textContent = '—';
    }
  }

  async function renderPanelSummary() {
    const host = document.getElementById('mianBanZhaiYaoHe');
    if (!host) return;
    const qunId = state.selectedChat && state.selectedChat.id;
    if (!qunId) { host.textContent = '—'; return; }
    try {
      const r = await window.warmy.archiveList?.(qunId);
      const LieBiao = (r && r.entries) || [];
      // 最新一条若带 structured，则优先展示要点/决策/待办/风险
      const last = LieBiao[LieBiao.length - 1];
      const st = last && last.structured;
      let extra = '';
      if (st) {
        const sec = (shuZu, key) => (shuZu && shuZu.length ? `<div class="pk-sec"><b>${escapeHtml(t(key))}</b>${shuZu.map((x) => `<div class="pkHang"><button class="anNiuXiao" data-jump-st="${escapeHtml(String(x).slice(0, 80))}">${escapeHtml(x)}</button></div>`).join('')}</div>` : '');
        extra = sec(st.decisions, 'panel.summary.decisions') + sec(st.todos, 'panel.summary.todos') + sec(st.risks, 'panel.summary.risks') + sec(st.bullets, 'panel.summary.bullets');
      }
      host.innerHTML = extra + (LieBiao.length
        ? LieBiao.slice(-5).reverse().map((e) => `
            <div class="pkHang">
              <div>${escapeHtml(e.title || '')}</div>
              <div class="jingYin">${escapeHtml(String(e.summary || '').slice(0, 80))}</div>
              <button class="anNiuXiao" data-jump-archive="${escapeHtml(e.id)}">${escapeHtml(t('panel.summary.jump') || 'Jump')}</button>
            </div>`).join('')
        : `<div class="jingYin">${escapeHtml(t('panel.summary.empty') || '—')}</div>`);
      host.querySelectorAll('[data-jump-archive]').forEach((b) => {
        b.onclick = () => {
          const id = b.getAttribute('data-jump-archive');
          const item = LieBiao.find((x) => x.id === id);
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
              const sid = qunId;
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
                const sid = first.sessionId || qunId;
                openChat(state.selectedChat?.kind || 'single', sid, sid);
                setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
              } else {
                const sid = qunId;
                openChat(state.selectedChat?.kind || 'single', sid, sid);
                setTimeout(() => { chatViewVisible[sid] = 999; renderChat(); }, 200);
              }
            });
          } catch {
            try {
              const sid = qunId;
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
              const sid = (hits[0] && hits[0].sessionId) || qunId;
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
    $('caiDanTuBiaoDingXiang')?.classList.toggle('yinCang', !isGroupChat);
    /**
     * 独立会话窗里**不再提供「在新窗口打开」**：那个窗口本来就是"这个会话的窗口"，
     * 再开只会得到重复视图（用户明确要求去掉）。
     */
    $('caiDanTuBiaoDaKai')?.classList.toggle('yinCang', document.body.classList.contains('liaoTianChuangKou'));
    const sc = (id, key) => { const e = $(id); if (e) e.textContent = typeof SHORTCUT_LABEL === 'function' ? SHORTCUT_LABEL(key) : ''; };
    sc('scDaKai', 'openChatWindow');
    sc('scDaoChu', 'exportSession');
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
    const baiFenBi = $('shangXiaWenPct');
    const tok = $('shangXiaWenTokens');
    const minP = ctxMinPercent();
    if (baiFenBi) baiFenBi.textContent = `${ctxState.percent}%`;
    if (tok) {
      // 变量名不能叫 t：会遮蔽 i18n 的 t()，导致 `t is not a function`（本轮真事故）
      const tokenShu = Math.max(CTX_MIN_TOKENS, Math.round((ctxState.percent / 100) * ctxState.maxTokens));
      const ju = fmtKey('ctx.budget.tokens', { n: String(tokenShu) });
      tok.textContent = ju === 'ctx.budget.tokens' ? `≈ ${tokenShu} tokens` : ju;
    }
    const s = $('shangXiaWenSlider');
    if (s) { s.min = String(minP); s.value = String(ctxState.percent); }
    const tiShi = document.querySelector('#shangXiaWenPopover .shangXiaWenPopMin');
    if (tiShi) tiShi.textContent = fmtKey('ctx.budget.minHint', { n: String(minP) });
  }

  function ctxVisibleFor(nav) {
    // 群聊不暴露；联系人不涉及；项目/我的牛马可见
    return nav === 'singleAi' || nav === 'internalGroup'; // 群聊/联系人不显示，由后台自动收敛
  }

  function bindCtxBudget() {
    const btn = $('anNiuShangXiaWen');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('shangXiaWenPopover');
      if (!pop) return;
      const opening = pop.classList.contains('yinCang');
      pop.classList.toggle('yinCang');
      btn.classList.toggle('qiYong', opening);
      if (opening) {
        try {
          const r = btn.getBoundingClientRect();
          pop.style.left = Math.max(8, Math.min(r.left - 120, window.innerWidth - 320)) + 'px';
          pop.style.top = Math.max(8, r.top - 8 - pop.offsetHeight) + 'px';
        } catch { /* noop */ }
      }
      ctxRenderMeta();
    });
    const slider = $('shangXiaWenSlider');
    if (slider) {
      slider.addEventListener('input', () => {
        ctxState.percent = Number(slider.value) || ctxState.percent;
        ctxRenderMeta();
        // 落盘（合并式设置）
        try { window.warmy.settingsSave({ contextBudgetPercent: ctxState.percent }); } catch { /* noop */ }
      });
    }
    onDocClick((Shi) => {
      const pop = $('shangXiaWenPopover');
      if (!pop || pop.classList.contains('yinCang')) return;
      if (Shi.target && (Shi.target.closest('#shangXiaWenPopover') || Shi.target.closest('#anNiuShangXiaWen'))) return;
      pop.classList.add('yinCang');
      btn.classList.remove('qiYong');
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
        const qunId = state.selectedChat && state.selectedChat.id;
        const g = (state.groups || []).find((x) => x.id === qunId);
        const dutyId = g && (g.dutyInstanceId || g.dutyInstance);
        const inst = state.instances.find((x) => x.id === dutyId) || state.instances.find((x) => x.dutyEligible);
        model = String(inst?.model || inst?.defaultModel || '');
      }
      /**
       * **真实上下文优先**（真机反馈）：滑块的最高必须跟着**当前这个牛马实际在用的模型**走，
       * 不是写死的对照表。真实窗口取"拉取模型"时拿到的能力（`__moXingNengLi[model].contextLen`），
       * 拿不到才退回已知表 / 用户覆盖值。
       */
      if (model) {
        const nl = (window.__moXingNengLi && window.__moXingNengLi[model]) || null;
        const zhen = Number(nl && nl.contextLen) || 0;
        if (zhen >= 1024) return zhen;
        if (MODEL_CTX_MAP[model]) return MODEL_CTX_MAP[model];
      }
    } catch { /* noop */ }
    return ctxState.maxTokens || CTX_DEFAULT_WINDOW;
  }

  async function ctxLoad() {
    try {
      const s = await window.warmy.settingsGet();
      const p = Number(s?.settings?.contextBudgetPercent);
      // 上限放开到 100%：滑块的最高 = 当前牛马的**实际上下文**（不再被 90% 卡住）
      if (Number.isFinite(p)) ctxState.percent = Math.min(100, Math.max(10, Math.round(p)));
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
    const qunId = state.selectedChat && state.selectedChat.id;
    if (!qunId) return null;
    const xiaoXi = $('zhaiYaoXiaoXi');
    if (xiaoXi && !auto) xiaoXi.textContent = t('common.loading') || '';
    try {
      const r = await window.warmy.sessionSummary?.({ sessionId: qunId, auto: !!auto });
      if (xiaoXi && !auto) xiaoXi.textContent = r && r.ok ? (t('panel.summary.done') || 'OK') : String(r?.error || '');
      lastSummaryAt = Date.now();
      try { void renderPanelSummary(); } catch { /* noop */ }
      return r;
    } catch (e) {
      if (xiaoXi && !auto) xiaoXi.textContent = String(e.message || e);
      return null;
    }
  }

  function bindSummaryControls() {
    const btn = $('anNiuGenZhaiYao');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { void genSessionSummary(false); });
    }
    const tg = $('ziDongZhaiYaoKaiGuan');
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
      const tg = $('ziDongZhaiYaoKaiGuan');
      if (tg) tg.checked = autoSummaryOn;
    } catch { /* 默认开 */ }
  }

  /** 空闲自动摘要：每 10 分钟检查一次；有新消息且空闲才生成 */
  setInterval(() => {
    if (!autoSummaryOn || !state.selectedChat) return;
    const qunId = state.selectedChat.id;
    const xiaoXi = (window.__msgs && window.__msgs[qunId]) || [];
    if (!xiaoXi.length) return;
    const lastTs = xiaoXi[xiaoXi.length - 1] && xiaoXi[xiaoXi.length - 1].ts || 0;
    const kongxian = Date.now() - lastTs > 3 * 60 * 1000;
    const since = Date.now() - lastSummaryAt > 10 * 60 * 1000;
    if (kongxian && since) void genSessionSummary(true);
  }, 60 * 1000);

  // ── 聊天滚动：下箭头 / 新消息气泡 / 自动滚动 ──
  (function bindScrollUx() {
    /* btn-scroll-bottom-bind */
    $('scrollDiAnNiu')?.addEventListener('click', () => scrollToBottom(true));
    $('newXiaoXiBubble')?.addEventListener('click', () => scrollToBottom(true));
    const miAuto = $('caiDanTuBiaoAutoscroll');
    const markAuto = $('caiDanTuBiaoAutoscrollMark');
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
    // **自动阅读回复**（勾选）：新回复到了就用说话模型读；提示音先播完再读，避免叠音
    const miDu = $('caiDanTuBiaoLangDu');
    const markDu = $('caiDanTuBiaoLangDuMark');
    const syncDu = () => {
      if (markDu) markDu.style.visibility = state.autoRead ? 'visible' : 'hidden';
      if (miDu) miDu.setAttribute('aria-checked', state.autoRead ? 'true' : 'false');
    };
    if (miDu && !miDu.dataset.bound) {
      miDu.dataset.bound = '1';
      miDu.addEventListener('click', async () => {
        state.autoRead = !state.autoRead;
        syncDu();
        try { await window.warmy.settingsSave({ autoRead: state.autoRead }); } catch { /* noop */ }
      });
    }
    syncDu();
    // 输入字数
    const input = $('shuRu');
    const counter = $('shuRuCounter');
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
  /** 已经为**哪些决策卡**响过提示音（按 id 记账；切页面/重画都不丢） */
  let yiJingXiangGuo = new Set();
  /** 正在播的卡（防"广播"与"轮询"两条入口在同一瞬间各响一次 ⇒ 叠音） */
  let zhengZaiXiang = new Set();
  /**
   * **卡片一出现就响一声** —— 两条入口（主进程广播 / 定时轮询）共用这一本账：
   *   · 只认"还没响过的 id"，所以不会响两遍；
   *   · 只有**真的播出去**才记账（播失败不记账），所以不会漏；
   *   · 正在播的 id 先占位，避免同一张卡被两条入口同时触发。
   *
   * 真事故（第三次报修"首次出现的决策卡没有音效"）修的就是这里：
   * 以前音效逻辑长在 `renderAiQuestions` **里面**，而那个函数开头
   * `if (!host || !state.selectedChat) return` —— 只要**还没选中任何会话**
   * （冷启动最常见），音效那一段根本执行不到：卡跳出来，一声不响。
   * 现在音效与"卡片画不画得出来"**彻底解耦**：能不能画是 UI 的事，响不响是通知的事。
   */
  function xiangKaPianYin(ids, laiYuan) {
    const xin = (ids || []).map((x) => String(x || '')).filter((id) => id && !yiJingXiangGuo.has(id) && !zhengZaiXiang.has(id));
    if (!xin.length) return;
    for (const id of xin) zhengZaiXiang.add(id);
    void (async () => {
      const ok = await chuanBoYinXiao('request', laiYuan || 'card');
      for (const id of xin) zhengZaiXiang.delete(id);
      if (ok) {
        for (const id of xin) yiJingXiangGuo.add(id);
        // 只记最近 500 个 id，避免长跑把内存撑大
        if (yiJingXiangGuo.size > 500) yiJingXiangGuo = new Set([...yiJingXiangGuo].slice(-250));
      } else if (laiYuan === 'broadcast') {
        // 播失败如实提示（不假装响过）；失败不记账 ⇒ 下次轮询/手势继续补播
        try { showToast(tOr('aiq.newCard', '有新的决策卡，请查看输入框上方')); } catch { /* noop */ }
      }
    })();
  }
  // 门禁用：卡片音效的唯一入口（广播与轮询都走它）
  window.__xiangKaPianYin = xiangKaPianYin;
  function renderAiQuestions() {
    const host = $('aiqHost');
    const qunId = state.selectedChat ? String(state.selectedChat.id || '') : '';
    void (async () => {
      try {
        /**
         * ⚠️ 这里**不带会话过滤能拿到全部**（主进程 `LieBiao(undefined)` 返回所有）：
         * 冷启动还没选中会话时也要能发现新卡并响一声 —— 这正是"首次出现的决策卡"那条路。
         */
        const r = await window.warmy.aiQuestionList?.(qunId || undefined);
        const rawItems = (r && r.items) || [];
        /**
         * **编号必须按时间正序**。
         * 主进程 `LieBiao()` 按 createdAt **倒序**返回（最新的在前）——
         * 真事故：最新的那张永远排 index 0 ⇒ 徽章**永远是 1/X**。
         * 这里自己重排成"从早到晚"，第 N 张就是第 N 个决策。
         */
        const items = [...rawItems].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
        const pending = items.filter((q) => q.status === 'pending');
        // ① 先处理音效（与能不能画出来无关）
        xiangKaPianYin(pending.map((q) => q.id), 'render');
        if (!host) return;
        if (!qunId) { host.innerHTML = ''; return; }
        if (!pending.length) {
          host.innerHTML = '';
          return;
        }
        /**
         * X/N：**这一串决策里的第几个 / 一共几个**（含已答的，编号才稳定）。
         * 只有 1 张时藏掉徽章；多张时每张都标。
         */
        const zongShu = items.length;
        host.innerHTML = pending.map((q) => {
          const qi = items.findIndex((x) => String(x.id) === String(q.id));
          const opts = (q.options || []).map((o) =>
            `<button class="anNiuXiao" data-aiq="${escapeHtml(q.id)}" data-opt="${escapeHtml(o.id)}">${escapeHtml(o.biaoQian)}</button>`
          ).join(' ');
          const jiShu = zongShu > 1 ? '<span class="aiqJiShu">' + (qi + 1) + '/' + zongShu + '</span>' : '';
          return `<div class="aiqKa" data-qid="${escapeHtml(q.id)}">
            <div class="aiqBiaoTi">${jiShu}${escapeHtml(t('aiq.biaoTi')||'')}${(q.biaoTi || q.title) ? ' · ' + escapeHtml(String(q.biaoTi || q.title)) : ''}</div>
            ${q.ti ? `<div class="jingYin">${escapeHtml(q.ti)}</div>` : ''}
            <div class="aiqOpts">${opts}
              <button class="anNiuXiao" data-aiq="${escapeHtml(q.id)}" data-opt="__custom__">${escapeHtml(t('aiq.custom')||'Other')}</button>
            </div>
            <div class="aiqCustom yinCang"><input class="aiqShuRu" placeholder="${escapeHtml(t('aiq.custom')||'')}"/>
              <button class="anNiuZhuYao" data-aiq-submit="${escapeHtml(q.id)}">${escapeHtml(t('aiq.submit')||'OK')}</button></div>
          </div>`;
        }).join('');
        // 音效已在上面 `xiangKaPianYin` 里处理（与绘制解耦），这里不再重复播
        host.querySelectorAll('[data-aiq]').forEach((b) => {
          b.onclick = async () => {
            const id = b.getAttribute('data-aiq');
            const opt = b.getAttribute('data-opt');
            if (opt === '__custom__') {
              const ka = host.querySelector(`[data-qid="${CSS.escape(id)}"]`);
              if (ka) ka.querySelector('.aiqCustom')?.classList.remove('yinCang');
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
            const ka = host.querySelector(`[data-qid="${CSS.escape(id)}"]`);
            const zhi = ka ? (ka.querySelector('.aiqShuRu')?.value || '') : '';
            const r2 = await window.warmy.aiQuestionAnswer?.({ id, optionId: '__custom__', customText: zhi });
            if (r2 && r2.ok === false) uiAlert(String(r2.error||''));
            renderAiQuestions();
          };
        });
      } catch { host.innerHTML = ''; }
    })();
  }

  /**
   * **项目记忆**（项目的"规矩/目标"，覆盖式，与会话流水记忆不重复存储）。
   *
   * 位置与显隐（真机反馈修）：它原先被塞在**聊天输入框上方**（`#pmHe`），
   * 而且**不看会话类型** —— 用户在一个「我的牛马」单聊里也看到「项目记忆 / 当前有效的项目规矩」
   * 和「保存项目记忆」按钮，既没有上下文也没有意义。
   * 现在：① 挪到**右栏**（与其他项目卡片同处），② **只有真的是项目**才出现
   * （判据与「项目状态」卡同一个来源 `quXiangMuTai`，不是渲染层自己猜）。
   */
  const pmYiJianGuo = new Set();
  async function renderProjectMemoryPanel() {
    const heZi = $('xiangMuJiYiHe');
    const ka = $('xiangMuJiYiKuai');
    if (!heZi || !ka) return;
    const sid = state.selectedChat ? String(state.selectedChat.id || '') : '';
    if (!sid) {
      ka.classList.add('yinCang');
      heZi.innerHTML = '';
      return;
    }
    // 是不是项目：以主进程那份事实为准（非项目/拿不到 ⇒ 不显示）
    const tai = await quXiangMuTai(sid);
    if (!tai) {
      ka.classList.add('yinCang');
      heZi.innerHTML = '';
      return;
    }
    try {
      const r = await window.warmy.projectMemoryGet?.({ sessionId: sid });
      const jiYi = (r && r.memory) || '';
      // 有内容 ⇒ 一定要看得见；第一次进这个项目也主动亮一次（否则功能看不见）
      if (jiYi || !pmYiJianGuo.has(sid)) {
        pmYiJianGuo.add(sid);
        try { queBaoKaPian('xiangMuJiYiKuai'); } catch { /* noop */ }
      }
      ka.classList.remove('yinCang');
      heZi.innerHTML = `<div class="jingYin">${escapeHtml(t('pm.tiShi')||'')}</div>
        <textarea id="pmWenBen" rows="5" style="width:100%;margin-top:6px">${escapeHtml(jiYi)}</textarea>
        <div style="margin-top:6px"><button class="anNiuXiao" id="anNiuPmBaoCun">${escapeHtml(t('pm.save')||'Save')}</button>
        <span class="jingYin" id="pmXiaoXi">${jiYi ? '' : escapeHtml(t('pm.empty')||'')}</span></div>`;
      const btn = $('anNiuPmBaoCun');
      if (btn) btn.onclick = async () => {
        const zhi = $('pmWenBen') ? $('pmWenBen').value : '';
        const yunXingJieGuo = await window.warmy.projectMemorySet?.({ sessionId: sid, memory: zhi });
        const xiaoXi = $('pmXiaoXi');
        if (xiaoXi) {
          xiaoXi.textContent = yunXingJieGuo && yunXingJieGuo.ok ? t('pm.saved') : (yunXingJieGuo?.error || t('pm.readBackFail'));
        }
      };
    } catch {
      heZi.innerHTML = '';
    }
  }

  function renderQueueBar() {
    const jinDuTiao = $('duiLieTiao');
    const LieBiao = $('duiLieTiaoMuJi');
    if (!state.selectedChat) {
      jinDuTiao.classList.add('yinCang');
      return;
    }
    const q = queueOf(state.selectedChat.id);
    if (!q.length) {
      jinDuTiao.classList.add('yinCang');
      LieBiao.innerHTML = '';
      return;
    }
    jinDuTiao.classList.remove('yinCang');
    $('duiLieCount').textContent = String(q.length);
    /**
     * **插话区高度可拉伸**（产品要求）：上下拖这条把手改 `--queue-h`。
     * 范围：至少 1 条（72px）、最多 12 条 —— 再高就把输入框顶没了。
     */
    (function bindQueueResize() {
      const ba = $('duiLieLaShen');
      if (!ba || ba.dataset.bound === '1') return;
      ba.dataset.bound = '1';
      let startY = 0;
      let startH = 0;
      ba.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        startH = LieBiao.getBoundingClientRect().height;
        try { ba.setPointerCapture(e.pointerId); } catch { /* noop */ }
        e.preventDefault();
      });
      ba.addEventListener('pointermove', (e) => {
        if (!startY) return;
        const h = Math.max(72, Math.min(12 * 78, startH - (e.clientY - startY)));
        LieBiao.style.setProperty('--queue-h', h + 'px');
        try { window.warmy.settingsSave?.({ queueHeightPx: h }); } catch { /* noop */ }
      });
      const ting = () => { startY = 0; };
      ba.addEventListener('pointerup', ting);
      ba.addEventListener('pointercancel', ting);
    })();
    LieBiao.innerHTML = '';
    q.forEach((item, suoYin) => {
      const li = document.createElement('li');
      const tag = item.u === 'P2' ? t('chat.p2') : t('chat.p3');
      const ts = Number(item.ts || 0) || Date.now();
      // 发出时间（月日 时:分）+ 已等待（时:分:秒）
      // 时间/等待/标签都是**内容上方的小字**（不显眼、不占左侧），下面才是正文
      li.innerHTML = `<div class="qTouXiaoZi"><span class="qBiaoQian">${escapeHtml(tag)}</span><span class="qShiJian" title="${escapeHtml(wanZhengShiJian(ts))}">${escapeHtml(yueRiShiFen(ts))}</span><span class="qDengDai">已等 <b data-deng="${suoYin}">${escapeHtml(dengDaiShiChang(ts))}</b></span></div><div class="qZhengWen"></div>`;
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
          persistUiQueuesSoon();
        };
        del.onclick = () => {
          q.splice(suoYin, 1);
          renderQueueBar();
          persistUiQueuesSoon();
        };
        // 编辑态的确定/删除也**并排**（和查看态一致，不许竖着排）
        const caoE = document.createElement('div');
        caoE.className = 'qCaoZuoJi';
        caoE.append(save, del);
        (li.querySelector('.qZhengWen') || li).append(ta, caoE);
      } else {
        const kuaDu = document.createElement('div');
        kuaDu.className = 'qWenBen';
        kuaDu.textContent = item.text;
        const edit = document.createElement('button');
        edit.className = 'anNiuXiao';
        edit.textContent = t('chat.queueEdit');
        const del = document.createElement('button');
        del.className = 'anNiuXiao';
        del.textContent = t('chat.queueDelete');
        const up = document.createElement('button');
        up.className = 'anNiuXiao';
        up.textContent = '↑';
        up.title = tOr('chat.queueUp', '上移');
        up.disabled = suoYin === 0;
        up.onclick = () => {
          if (suoYin <= 0) return;
          const t0 = q[suoYin - 1]; q[suoYin - 1] = q[suoYin]; q[suoYin] = t0;
          renderQueueBar(); persistUiQueuesSoon();
        };
        edit.onclick = () => {
          item.editing = true;
          renderQueueBar();
        };
        del.onclick = () => {
          q.splice(suoYin, 1);
          renderQueueBar();
          persistUiQueuesSoon();
        };
        const dn = document.createElement('button');
        dn.className = 'anNiuXiao';
        dn.textContent = '↓';
        dn.title = tOr('chat.queueDown', '下移');
        dn.disabled = suoYin === q.length - 1;
        dn.onclick = () => {
          if (suoYin >= q.length - 1) return;
          const t0 = q[suoYin + 1]; q[suoYin + 1] = q[suoYin]; q[suoYin] = t0;
          renderQueueBar(); persistUiQueuesSoon();
        };
        (li.querySelector('.qZhengWen') || li).append(kuaDu);
        // 操作按钮**并排**在会话下方（上移/下移/编辑/移除 —— 不许竖着排）
        const cao = document.createElement('div');
        cao.className = 'qCaoZuoJi';
        cao.append(up, dn, edit, del);
        (li.querySelector('.qZhengWen') || li).append(cao);
      }
      LieBiao.appendChild(li);
    });
  }

  function xuanranFujian() {
    // 附件增删要同步「发送」按钮：有文字或有附件都算有内容（真机反馈）
    try { window.__syncSendState && window.__syncSendState(); } catch { /* noop */ }
    const yuanSu = $('attachLieBiao');
    if (!state.attachments.length) {
      yuanSu.classList.add('yinCang');
      yuanSu.innerHTML = '';
      return;
    }
    yuanSu.classList.remove('yinCang');
    yuanSu.innerHTML = state.attachments
      .map((a, i) => {
        const suoLue = a.dataUrl ? `<img class="attachSuoLue" src="${a.dataUrl}" alt="" data-zoom="${i}"/>` : '';
        // 悬停显示**完整路径**（文件名看不清/重名时最有用）
        const ti = escapeHtml(a.path || a.name || a.ming || '');
        const daXiao = a.bytes ? ' · ' + Number(a.bytes) + 'B' : '';
        return `<span class="attachChip" data-i="${i}" title="${ti}">${suoLue}${escapeHtml(a.name || a.ming || '')}${escapeHtml(daXiao)} <button data-i="${i}" title="${escapeHtml(t('chat.queueDelete'))}">×</button></span>`;
      })
      .join(' ');
    // 图片附件：异步读回缩略图（不是图片/太大 → 保持只显示文件名）
    state.attachments.forEach((a) => {
      if (a.dataUrl || !a.path || a.__suoLueTried) return;
      a.__suoLueTried = true;
      void (async () => {
        try {
          const r = await window.warmy.wenJianYuLan?.({ path: a.path });
          if (r && r.ok && r.dataUrl) {
            a.dataUrl = r.dataUrl;
            xuanranFujian();
          }
        } catch { /* 读不到就只显示文件名 */ }
      })();
    });
    // 点击缩略图放大预览
    yuanSu.querySelectorAll('img[data-zoom]').forEach((img) => {
      img.style.cursor = 'zoom-in';
      img.onclick = (e) => {
        e.stopPropagation();
        const a = state.attachments[Number(img.dataset.zoom)];
        if (!a || !a.dataUrl) return;
        const lay = document.createElement('div');
        lay.className = 'tuPianYuLanCeng';
        lay.innerHTML = '<img src="' + a.dataUrl + '" alt=""/>';
        lay.onclick = () => lay.remove();
        document.body.appendChild(lay);
      };
    });
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
   * 聊天进行中的**动态小字**（发出消息 → 回包之间）。
   *
   * 形态参考同类开源实现（open-webui / LobeChat 等）：状态条放在**输入框上方**、
   * 配打字点动画 + 已用秒数，长任务再切换"还在干"文案 —— 用户一眼能看出
   * **牛马在跑、没卡死、也没报错**；回包成功闪「干完了」，失败闪「出了点问题」（正文在气泡里）。
   *
   * 分阶段文案：起手 2 秒固定「正在思考…」→ 之后轮换轻松短语 → 20 秒后「还在干，没卡住…」。
   * 秒数与文案每秒一起走；打字三点只做一次 DOM（别每秒重画，动画会重启）。
   * 按会话隔离：切换会话/并发轮不会互相串台。
   */
  /**
   * 「干活中」小字文案池（2222 条，见 busy-phrases.js）。
   * 起手段保持一句安静的「正在思考…」，之后才轮到这些有人味的短句。
   * 轮换**要慢**（12 秒一条）—— 以前 6 秒换一次，看着眼花。
   */
  const BUSY_PHRASES = (typeof window !== 'undefined' && Array.isArray(window.__BUSY_PHRASES)) ? window.__BUSY_PHRASES : [];
  const BUSY_ROTATE_MS = (typeof window !== 'undefined' && Number(window.__BUSY_ROTATE_MS)) || 12000;
  /** 每轮从一个随机位置开始，两次对话不会永远是同一句 */
  let busyPhraseSeed = 0;
  function busyPhraseAt(i) {
    if (!BUSY_PHRASES.length) return '';
    const n = BUSY_PHRASES.length;
    return BUSY_PHRASES[(((busyPhraseSeed + i) % n) + n) % n];
  }
  const YUN_XING_CIHOU = 8;
  let yunXingJiShiQi = 0;
  let yunXingXuHao = 0;
  let yunXingKaiShi = 0;
  let yunXingHuiHua = '';
  /** 每轮的世代号：上一轮的 finally 不许把新一轮的动态小字关掉（真事故：多轮后小字不出现） */
  let yunXingShiDai = 0;
  function yunXingZhuangTaiKai(chatId) {
    const he = $('yunXingZhuangTai');
    if (!he) return;
    yunXingHuiHua = String(chatId || '');
    yunXingKaiShi = Date.now();
    yunXingXuHao = 1;
    yunXingShiDai += 1;
    // 文案池从随机位置起（同一句别老重复）；起手段仍然是安静的「正在思考…」
    busyPhraseSeed = Math.floor(Math.random() * Math.max(1, BUSY_PHRASES.length));
    clearInterval(yunXingJiShiQi);
    he.classList.remove('yinCang', 'cuoWu');
    he.innerHTML =
      '<span class="yunXingDian" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="yunXingWen"></span><span class="yunXingMiao"></span>';
    const wen = he.querySelector('.yunXingWen');
    const miao = he.querySelector('.yunXingMiao');
    const hua = () => {
      const yong = Math.max(0, Math.floor((Date.now() - yunXingKaiShi) / 1000));
      let ju;
      if (yong < 8) ju = tOr('chat.busy.1', '正在思考…');
      else if (yong >= 120) ju = tOr('chat.busy.still', '还在干，没卡住…');
      else if (BUSY_PHRASES.length) {
        // 文案池：**每 12 秒**才换一句（真反馈：换太快看着眼花）
        const idx = Math.floor((yong - 8) * 1000 / BUSY_ROTATE_MS);
        ju = busyPhraseAt(idx);
      } else {
        yunXingXuHao = (Math.floor((yong - 8) / BUSY_ROTATE_MS) % (YUN_XING_CIHOU - 1)) + 2;
        ju = tOr('chat.busy.' + yunXingXuHao, '正在干活…');
      }
      if (wen) wen.textContent = ju;
      if (miao) miao.textContent = yong + 's';
    };
    hua();
    // 秒数每秒走；文案在 hua() 内部按 BUSY_ROTATE_MS 节流
    yunXingJiShiQi = setInterval(hua, 1000);
  }
  function yunXingZhuangTaiGuan(chengGong, chatId) {
    // 只收属于这一轮的那条：并发/切会话/前后轮交错时都不许把别人的动态小字关掉
    if (chatId !== undefined && yunXingHuiHua && String(chatId) !== yunXingHuiHua) return;
    const shiDai = yunXingShiDai;
    clearInterval(yunXingJiShiQi);
    const he = $('yunXingZhuangTai');
    if (!he) return;
    // 若这一轮关的时候已经开了新一轮（shiDai 变了），不做任何隐藏
    if (shiDai !== yunXingShiDai) return;
    if (chengGong === true) {
      he.classList.remove('cuoWu');
      he.innerHTML = '<span class="yunXingDian ok" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="yunXingWen">' + escapeHtml(tOr('chat.busy.done', '干完了')) + '</span>';
      setTimeout(() => { he.classList.add('yinCang'); }, 1600);
    } else if (chengGong === false) {
      he.classList.add('cuoWu');
      he.innerHTML = '<span class="yunXingDian cuo" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="yunXingWen">' + escapeHtml(tOr('chat.busy.fail', '出了点问题…')) + '</span>';
      setTimeout(() => { he.classList.add('yinCang'); he.classList.remove('cuoWu'); }, 2200);
    } else {
      // notice（例如"还没配密钥"）：气泡里已经说清了，这里安静收起
      he.classList.add('yinCang');
    }
    yunXingHuiHua = '';
  }

  /**
   * 真的把一条消息交给模型（一轮 = 一次派发，从发起到回包）。
   *   · 内部群 → groupOrchestrate（值班编排闭环：回包 + 看板事件 + 检查点都在主进程那侧）
   *   · 单 AI / 外部 → chatSend（真 Provider 对话）
   * 直接路径（P0·P1，见 faSong()）与「待执行队列」的冲刷走的是**同一个**实现 ——
   * 修前排队项只被本地回显、从不派发，根因就是没有这一份共用的"派发"。
   */
  async function deliver(chatId, text, u, fuJian) {
    const kind = chatKindOf(chatId);
    /** 附件随本轮一起交给主进程（图片走多模态）；发送前已从 state 摘下，这里才是真正送达的那份 */
    const fuJianJi = Array.isArray(fuJian) ? fuJian : [];
    queueRounds[chatId] = true;
    /** true=干完了 / false=出了点问题 / 'notice'=安静收起（例如还没配密钥） */
    let huiBao = false;
    yunXingZhuangTaiKai(chatId);
    // 发送按钮"进行中"：转圈 + 禁用（防重复发送；也是"点到了"的即时反馈）
    const faSongAnNiu = $('anNiuFaSong');
    if (faSongAnNiu) { faSongAnNiu.disabled = true; faSongAnNiu.classList.add('faSongZhong'); }
    try {
      if (kind === 'internal') {
        try {
          const r = await window.warmy.groupOrchestrate({ groupId: chatId, content: text, urgency: u });
          const reply = r?.reply || `[${u}] ${r?.action || 'ok'}`;
          tuisongXiaoxi(chatId, 'them', reply);
          huiBao = true;
          // 群聊回复也写进主进程日志（去重），另一处视图才能看到同一轮对话
          try { void window.warmy.chatLogAppend?.({ sessionId: chatId, role: 'them', content: reply }); } catch { /* noop */ }
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
        // 「智能选模型」的决策输入：如实带牛马的配置，由主进程 model-pick 决策
        // （显式 > 默认 > 调用链+紧急度 > 角色表 > 兜底）
        const inst0 = (state.instances || []).find((x) => x && (x.id === chatId || x.ming === chatId || x.name === chatId));
        const r = await window.warmy.chatSend({
          sessionId: chatId,
          content: text,
          insertMode: u === 'P1' ? 'inner' : 'outer',
          // 附件一并交给主进程：图片走多模态（模型真的能看到），其它只带路径
          attachments: fuJianJi.map((a) => ({ name: a.name || a.ming || '', path: a.path || '', dataUrl: a.dataUrl || '' })),
          // 身份强制注入：让它知道自己叫什么（主进程会把这句放在最前面）
          ming: inst0 ? mingOf(inst0) : '',
          // 思考级别：聊天框的一次性覆盖 > 牛马管理里的默认档 > 自动
          thinkLevel: (state.thinkOverride && state.thinkOverride[chatId]) || (inst0 && inst0.thinkLevel) || 'auto',
          // 小弟数量：自适应 / 0..8（0 = 不许派小弟）
          xiaoDiShuLiang: (inst0 && inst0.xiaoDiShuLiang !== undefined && inst0.xiaoDiShuLiang !== '') ? inst0.xiaoDiShuLiang : 'auto',
          moXingJueCe: {
            urgency: u,
            defaultModel: inst0 ? (inst0.defaultModel || '') : '',
            chain: (inst0 && inst0.chain) || [],
            chainDisabled: (inst0 && inst0.chainDisabled) || [],
          },
        });
        if (r?.needsKey) {
          const huiFu2 = (r.reply && youShiZhiWenBen(r.reply)) ? String(r.reply) : tOr('chat.emptyReply', '（本条回复无内容）');
          tuisongXiaoxi(chatId, 'them', huiFu2, { reasoning: r.reasoning || '' });
          huiBao = 'notice';
        } else if (r?.ok) {
          // 空回复如实显示占位（真事故：第二条回复「完成了」但界面上什么都没有）
          const huiFu = (r.reply && youShiZhiWenBen(r.reply)) ? String(r.reply) : tOr('chat.emptyReply', '（本条回复无内容）');
          tuisongXiaoxi(chatId, 'them', huiFu, { reasoning: r.reasoning || '', moXing: r.moXing || '' });
          huiBao = true;
          // **本轮模型调用可见**：模型名单独一行（在气泡下方，与时间行一起），不再居中占一行
          // 自动阅读回复：提示音先播完再读，避免重叠
          if (state.autoRead) {
            void (async () => {
              try {
                await chuanBoYinXiao('complete');
                await langDuWenBen(huiFu);
              } catch { /* noop */ }
            })();
          }
          const c = state.chats.find((x) => x.id === chatId);
          if (c) {
            c.lastTs = Date.now();
            c.lastPreview = (huiFu || text).slice(0, 30);
          }
        } else {
          // 失败：如实告诉用户**出了什么问题**（带上下文，不甩裸解析器报错）
          const cuo = String(r?.error || t('common.error'));
          tuisongXiaoxi(chatId, 'them', tOr('chat.failed', '本轮回复失败') + '：' + cuo);
          // 失败把原文放回输入框，别让用户重打
          try {
            const sr = $('shuRu');
            if (sr && !String(sr.value || '').trim()) sr.value = text;
          } catch { /* noop */ }
        }
      } catch (e) {
        tuisongXiaoxi(chatId, 'them', tOr('chat.failed', '本轮回复失败') + '：' + String(e && e.message || e));
      }
    } finally {
      yunXingZhuangTaiGuan(huiBao, chatId);
      /**
       * 音效规则（产品要求）：**群聊不发音效**；单聊/联系人在"真的成功完成"时播完成音，
       * 失败（不会再有任何新回复）时播错误音。中间过程（思考/工具调用）一律不响。
       */
      if (kind !== 'internal' && kind !== 'extgroup') {
        if (huiBao === true) void chuanBoYinXiao('complete');
        else if (huiBao === false) void chuanBoYinXiao('error');
      }
      if (faSongAnNiu && faSongAnNiu.isConnected) {
        faSongAnNiu.disabled = false;
        faSongAnNiu.classList.remove('faSongZhong');
      }
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
   * 事实（修前）：faSong() 把 P2/P3 塞进本会话队列就 return；flushQueue() 只把队列项
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
        tuisongXiaoxi(chatId, 'wo', item.text);
        renderChat();
        if (CHAT_NAVS.has(state.nav)) renderList();
        await deliver(chatId, item.text, item.u, item.fuJian);
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

  let __lastSend = { text: '', at: 0 };
  async function faSong() {
    const text = $('shuRu').value.trim();
    if (!text || !state.selectedChat) return;
    // 同一条文本 600ms 内只发一次：Enter 与发送按钮可能同时触发（实测「发一次显示两次」）
    {
      const now = Date.now();
      if (__lastSend.text === text && now - __lastSend.at < 600) return;
      __lastSend = { text, at: now };
    }
    const id = state.selectedChat.id;
    /**
     * **被中断任务的「继续/重试」按钮失效**（产品要求）：
     * 用户没点按钮、直接发了新内容 ⇒ 旧任务不再被自动续上，按钮变灰不可点。
     * 按钮自己走的是「先清 planInterrupted 再 faSong」，所以这里不会误伤。
     */
    if (state.planInterrupted && state.planInterrupted.has(String(id))) {
      state.planInterrupted.delete(String(id));
      state.planResumeDisabled = state.planResumeDisabled || {};
      state.planResumeDisabled[String(id)] = true;
      try { renderList(); } catch { /* noop */ }
    }
    const u = state.urgency;
    /**
     * ADR 004 P3 定稿：容器项目的开发面**只在容器里**。容器没运行 ⇒ 项目 = 已停止
     * （等同创建者下线）⇒ **拒绝在宿主侧派发这一轮**，而不是静默地在本机编辑项目文件。
     * 这不是"少一个功能"，而是这条安全承诺的全部意义所在（主进程还会再拒一次）。
     */
    const blocked = await xiangMuKaiFaKuai(id);
    if (blocked) {
      await uiAlert(fmtKey('container.project.devBlocked', { reason: blocked }), t('container.devEnv.biaoTi'));
      return;
    }
    const attachNote = state.attachments.length
      ? `\n[${state.attachments.map((a) => a.name || a.ming || '').join(', ')}]` +
        // 有真实路径的一并告诉模型（它可以用文件工具读到），截图/文件都不再是"看不见的附件"
        (state.attachments.some((a) => a.path)
          ? `\n[附件路径] ${state.attachments.filter((a) => a.path).map((a) => a.path).join('; ')}`
          : '')
      : '';
    const Quan = text + attachNote;
    // 发送前先摘下附件（随后清空输入区），随本轮一直传到 deliver
    const fuJianJi = (state.attachments || []).map((a) => ({ name: a.name || a.ming || '', path: a.path || '', dataUrl: a.dataUrl || '' }));

    // P2（默认「插入」）/ P3（「排队」）：进「待执行队列」，本轮结束后由冲刷**真的派发**出去
    if (u === 'P2' || u === 'P3') {
      queueOf(id).push({ id: 'q' + Date.now(), text: Quan, u, editing: false, ts: Date.now(), fuJian: fuJianJi });
      $('shuRu').value = '';
      state.attachments = [];
      xuanranFujian();
      renderQueueBar();
      persistUiQueuesSoon();
      if (CHAT_NAVS.has(state.nav)) renderList();
      scheduleQueueFlush(id);
      return;
    }

    // P0（停止，见 stopAllAi）/ P1（加急）：立即插入 —— 直接派发
    // tuisongXiaoxi 内部已经写主进程日志（唯一事实来源），这里**不再重复写**：
    // 以前这里又补写一次，两边角色名不同（wo vs user）⇒ 日志里同一句话两条 ⇒ 界面显示两遍。
    tuisongXiaoxi(id, 'wo', Quan);
    $('shuRu').value = '';
    state.attachments = [];
    xuanranFujian();
    renderChat();

    // 进行中反馈（动态小字 + 发送按钮）在 deliver 内部统一处理：直接派发与队列冲刷共用
    await deliver(id, text, u, fuJianJi);
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
    const pendingCount = assistAll.filter((x) => x.status === 'daKai').length;

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
      const pend = assists.filter((a) => a.status === 'daKai');
      const lastEv = (() => {
        try {
          const evs = (state.board && state.board.events) || [];
          const mingZhong = evs.find((e) => e.session === g.id);
          return mingZhong ? String(mingZhong.title || '').slice(0, 80) : '';
        } catch { return ''; }
      })();
      const oneline = lastEv || (pend[0] ? String(pend[0].title).slice(0, 60) : t('dashboard.emptyLine'));
      const summary = (g.memory || lastEv || oneline || '').slice(0, 120);
      return {
        id: g.id,
        kind,
        chatKind: chatKind === 'single' ? 'single' : g.type,
        ming: mingOf(g) || g.id,
        created,
        hours,
        oneline,
        summary,
        pend,
        createdAtLabel: created ? new Date(created).toLocaleString() : '—',
      };
    });

    const cats = [
      { key: 'single', biaoQian: t('dashboard.cat.single'), items: sessions.filter((s) => s.kind === 'single') },
      { key: 'internal', biaoQian: t('dashboard.cat.internal'), items: sessions.filter((s) => s.kind === 'internal') },
      { key: 'contact', biaoQian: t('dashboard.cat.contact'), items: sessions.filter((s) => s.kind === 'contact') },
      { key: 'external', biaoQian: t('dashboard.cat.external'), items: sessions.filter((s) => s.kind === 'external') },
    ];

    /**
     * **使用量**（真机反馈定稿）：
     *   · 只算 **token 消耗**，**不算钱**、也不标注"按内置价目估算"（用户明确要求去掉）；
     *   · 做成**表格**（窗口 / 供应商 / 模型 / 提示词 / 补全 / 合计）；
     *   · 窗口列用**第二列显示的那个名称**（不是内部 sessionId —— 以前显示的是 id，用户看不懂）。
     */
    let tokenTotal = 0;
    window.__costData = [];
    try {
      const sum = await window.warmy.metricsSummary?.();
      if (sum && typeof sum.promptTokens === 'number') tokenTotal = (sum.promptTokens || 0) + (sum.completionTokens || 0);
      /**
       * 细目来源：summary 自带 turnsDetail **不存在**（真事故：明细永远是空的，
       * 因为主进程的 summary() 里根本没有这个字段）。所以回落到 metricsTurns()。
       */
      let turns = (sum && (sum.turnsDetail || sum.turns_list)) || [];
      if (!Array.isArray(turns) || !turns.length) {
        try { const rt = await window.warmy.metricsTurns?.(); turns = (rt && rt.turns) || []; } catch { /* noop */ }
      }
      if (Array.isArray(turns) && turns.length) {
        window.__costData = turns
          .filter((x) => ((x.promptTokens || 0) + (x.completionTokens || 0)) > 0)
          .map((x) => ({
            windowId: String(x.sessionId || x.window || ''),
            window: mingBiaoQing(x.sessionId || x.window || ''),
            provider: String(x.providerId || x.provider || '—'),
            model: String(x.model || '—'),
            ru: x.promptTokens || 0,
            chu: x.completionTokens || 0,
            tokens: (x.promptTokens || 0) + (x.completionTokens || 0),
          }));
      }
    } catch { /* noop */ }
    host.innerHTML = `
      <h1>${escapeHtml(t('dashboard.biaoTi'))}</h1>
      <div class="dashStats">
        <div class="dashKa"><div class="jingYin">${escapeHtml(t('dashboard.inProgressProjects'))}</div><div class="stat">${escapeHtml(String(inProgressProjects))}</div></div>
        <div class="dashKa"><div class="jingYin">${escapeHtml(t('dashboard.runningInstances'))}</div><div class="stat">${escapeHtml(String(running))}</div></div>
        <div class="dashKa"><div class="jingYin">${escapeHtml(t('dashboard.pendingDecisions'))}</div><div class="stat">${escapeHtml(String(pendingCount))}</div></div>
        <div class="dashKa"><div class="jingYin">${escapeHtml(tOr('dashboard.tokenCost', '词元消耗'))}</div><div class="stat">${escapeHtml(String(tokenTotal))}</div></div>
      </div>
      <!-- 产品要求：**删掉单独的「成本」卡片**；明细叫「使用量」，只按词元消耗排 -->
      <details class="dashKa" id="dashChengBen" style="margin:12px 0">
        <summary style="cursor:pointer;font-weight:600">${escapeHtml(tOr('dashboard.usage', '使用量'))} · ${escapeHtml(String(tokenTotal))} ${escapeHtml(tOr('dashboard.tokens', '词元'))}</summary>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap" id="costSortBar">
          <button class="anNiuXiao" data-cost-sort="window">${escapeHtml(t('cost.byWindow') || '按窗口')}</button>
          <button class="anNiuXiao" data-cost-sort="provider">${escapeHtml(t('cost.byProvider') || '按供应商')}</button>
          <button class="anNiuXiao" data-cost-sort="model">${escapeHtml(t('cost.byModel') || '按模型')}</button>
        </div>
        <div id="costList" style="margin-top:8px"></div>
      </details>
      <div id="dashHuiHuaJi"></div>`;
    // 使用量表格：按所选列排序（同列再按词元降序），末尾一行合计
    (function bindCost() {
      const list = $('costList');
      const bar = $('costSortBar');
      if (!list || !bar) return;
      let sort = 'window';
      const data = () => { try { return (window.__costData || []); } catch { return []; } };
      /** 同一（窗口,供应商,模型）合并成一行 —— 表格里一行一件事，别把同一条重复列 */
      const heBing = () => {
        const m = new Map();
        for (const r of data()) {
          const k = [r.windowId, r.provider, r.model].join('\u0001');
          const cur = m.get(k) || { window: r.window, windowId: r.windowId, provider: r.provider, model: r.model, ru: 0, chu: 0, tokens: 0 };
          cur.ru += r.ru; cur.chu += r.chu; cur.tokens += r.tokens;
          m.set(k, cur);
        }
        const key = sort === 'provider' ? 'provider' : sort === 'model' ? 'model' : 'window';
        return [...m.values()].sort((a, b) => {
          const ka = String(a[key] || ''), kb = String(b[key] || '');
          if (ka !== kb) return ka.localeCompare(kb);
          return b.tokens - a.tokens;
        });
      };
      const th = (wen) => '<th>' + escapeHtml(wen) + '</th>';
      const td = (wen, you) => '<td' + (you ? ' style="text-align:right"' : '') + '>' + escapeHtml(String(wen)) + '</td>';
      const render = () => {
        const rows = heBing();
        if (!rows.length) {
          list.innerHTML = '<div class="jingYin">' + escapeHtml(tOr('dashboard.noUsage', '还没有用量记录（发一轮对话后就有了）')) + '</div>';
          return;
        }
        const heJi = rows.reduce((a, r) => ({ ru: a.ru + r.ru, chu: a.chu + r.chu, tokens: a.tokens + r.tokens }), { ru: 0, chu: 0, tokens: 0 });
        list.innerHTML = '<table class="usageBiao"><thead><tr>'
          + th(tOr('usage.window', '窗口')) + th(tOr('usage.provider', '供应商')) + th(tOr('usage.model', '模型'))
          + th(tOr('usage.prompt', '提示词')) + th(tOr('usage.completion', '补全')) + th(tOr('dashboard.tokens', '词元'))
          + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + td(r.window) + td(r.provider) + td(r.model) + td(r.ru, true) + td(r.chu, true) + td(r.tokens, true) + '</tr>').join('')
          + '</tbody><tfoot><tr>' + td(tOr('usage.total', '合计')) + td('') + td('') + td(heJi.ru, true) + td(heJi.chu, true) + td(heJi.tokens, true) + '</tr></tfoot></table>';
      };
      const paint = () => {
        bar.querySelectorAll('[data-cost-sort]').forEach((x) => {
          const on = x.dataset.costSort === sort;
          x.classList.toggle('qiYong', on);
          x.style.background = on ? 'var(--accent)' : '';
          x.style.color = on ? '#fff' : '';
          x.style.fontWeight = on ? '600' : '';
          x.style.borderColor = on ? 'var(--accent)' : '';
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      };
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cost-sort]');
        if (!b) return;
        sort = b.dataset.costSort;
        paint();
        render();
      });
      paint();
      render();
    })();
    const heZi = $('dashHuiHuaJi');
    if (!heZi) return;

    cats.forEach((cat) => {
      if (!cat.items.length) return;
      const touBu = document.createElement('div');
      touBu.className = 'dashCat';
      touBu.textContent = cat.biaoQian;
      heZi.appendChild(touBu);
      cat.items.forEach((s) => {
        const hang = document.createElement('div');
        hang.className = 'dashHang';
        hang.title = t('dashboard.jump') || '';
        hang.innerHTML =
          (s.pend.length ? '<span class="dashHuiZhang" title="' + escapeHtml(t('dashboard.pendingBadge') || '') + '"></span>' : '<span style="width:8px"></span>') +
          '<div class="dashMing">' + escapeHtml(s.name) + '</div>' +
          '<div class="dashOneline">' + escapeHtml(s.oneline) + '</div>' +
          (s.hours != null ? '<div class="jingYin" style="font-size:11px;flex-shrink:0">' + escapeHtml(fmtKey('dashboard.hoursAgo', { h: String(s.hours) })) + '</div>' : '');
        const detail = document.createElement('div');
        detail.className = 'dashXiangQing yinCang';
        detail.innerHTML =
          '<div class="ddXian"><b>' + escapeHtml(s.name) + '</b></div>' +
          '<div class="ddXian jingYin">' + escapeHtml(t('dashboard.createdAt') || 'Created') + '：' + escapeHtml(s.createdAtLabel) + '</div>' +
          '<div class="ddXian jingYin">' + escapeHtml(t('dashboard.hoursAgo', { h: String(s.hours ?? '—') })) + '</div>' +
          '<div class="ddXian">' + escapeHtml(s.summary) + '</div>' +
          '<div class="ddXian"><b>' + escapeHtml(t('dashboard.pendingDecisions')) + '</b></div>' +
          (s.pend.length
            ? s.pend.slice(0, 8).map((p) => '<div class="ddXian">· ' + escapeHtml(String(p.title || '')) + ' <span class="jingYin">' + escapeHtml(p.priority === 'urgent' ? t('panel.assist.urgent') : '') + '</span></div>').join('')
            : '<div class="ddXian jingYin">—</div>');
        const enter = () => {
          const kind = s.chatKind || s.kind;
          const openKind = kind === 'extgroup' ? 'extgroup' : kind === 'extchat' ? 'extchat' : kind === 'internal' ? 'internal' : 'single';
          const nav = openKind === 'single' ? 'singleAi' : openKind === 'internal' ? 'internalGroup' : openKind === 'extgroup' ? 'externalGroup' : 'externalChat';
          setNav(nav);
          openChat(openKind, s.id, xianShiMing(s));
        };
        hang.ondblclick = enter;
        hang.onclick = () => {
          detail.classList.toggle('yinCang');
          if (!detail.classList.contains('yinCang')) detail.scrollIntoView({ kuai: 'nearest' });
        };
        heZi.appendChild(hang);
        heZi.appendChild(detail);
      });
    });
    if (!sessions.length) {
      heZi.innerHTML = '<div class="kanbanKong">' + escapeHtml(t('dashboard.emptySessions')) + '</div>';
    }
  }

  /**
   * 牛马管理局「启动/停止」单飞标志。
   * 真事故：同一时刻既有人在等 spawn/stop 返回，又有 `listInstances` 的异步回调把状态写回去，
   * 且重渲染会换掉按钮节点 ⇒ 表现为"有时点一下没反应、有时又生效"。
   * 约束：动作进行中不许并发第二次动作，也不许用轮询结果覆盖状态。
   */
  let instanceToggleBusy = false;

  /**
   * 思考级别：**8 档**（产品定稿顺序）
   *   0 灵机（关闭）→ 1 微觉 → 2 慎思 → 3 明辨 → 4 沉吟 → 5 穷理 → 6 参悟 → 7 自然（自动）
   * 发给模型时按**比例映射**到该模型真正支持的档位（见主进程 siKaoCanShu）。
   */
  const THINK_STOPS = ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'auto'];
  const THINK_I18N = {
    off: 'model.think.off', l1: 'model.think.l1', l2: 'model.think.l2', l3: 'model.think.l3',
    l4: 'model.think.l4', l5: 'model.think.l5', l6: 'model.think.l6', auto: 'model.think.auto',
  };
  const THINK_FB = { off: '灵机（关闭）', l1: '微觉', l2: '慎思', l3: '明辨', l4: '沉吟', l5: '穷理', l6: '参悟', auto: '自然（自动）' };
  function thinkLabelOf(v) {
    const k = THINK_I18N[v] || THINK_I18N.auto;
    return tOr(k, THINK_FB[v] || THINK_FB.auto);
  }
  /** 思考级别下拉/滑块的选项 HTML（管理模型与聊天框共用一套） */
  function thinkOptionsHtml() {
    return THINK_STOPS.map((v, i) => `<option value="${i}">${escapeHtml(thinkLabelOf(v))}</option>`).join('');
  }
  /** 智能模式 = 系统自动安排调用链（历史数据：defaultModel 空串或 __smart__ 都算） */
  function shiZhiNengMoShi(inst) {
    if (inst && typeof inst.smartMode === 'boolean') return inst.smartMode;
    const dm = inst ? String(inst.defaultModel || '') : '';
    return !dm || dm === '__smart__';
  }
  /** 调用链里**第一个未禁用**的模型 = 默认模型（合并后的语义，见产品要求） */
  function lianMoRenMoXing(inst) {
    const dis = new Set((inst && inst.chainDisabled) || []);
    const lian = (inst && inst.chain) || [];
    for (const m of lian) {
      const s = String(m || '').trim();
      if (s && !dis.has(s)) return s;
    }
    return '';
  }

  function renderInstanceDetail() {
    const inst = state.selectedInstance;
    if (!inst) return;
    const smartMoXing = shiZhiNengMoShi(inst);
    // 状态以主进程为准（本地可能是旧值：显示成「启动」却已在跑）
    try {
      window.warmy.listInstances?.().then((arr) => {
        if (instanceToggleBusy) return; // 动作进行中：别让轮询把状态改回去
        const live = (arr || []).find((x) => x && (x.id === inst.id || x.ming === inst.ming || x.name === inst.name));
        if (live && live.status) {
          inst.status = live.status;
          // 只刷按钮文案，不整页重入
          const b = $('iQiDongTingZhi');
          if (b && !instanceToggleBusy) {
            const running = inst.status === 'running';
            b.textContent = running ? t('instances.stop') : t('instances.start');
            b.title = b.textContent;
          }
          const zhang = document.querySelector('.huiZhang');
          if (zhang) {
            zhang.classList.toggle('off', inst.status !== 'running');
            zhang.textContent = inst.status === 'running' ? t('instances.running') : t('instances.stopped');
          }
        }
      }).catch(() => {});
    } catch { /* noop */ }
    const heZi = $('shiLiXiangQing');
    heZi.innerHTML = `
      <h1>${escapeHtml(mingOf(inst) || inst.id)}</h1>
      <div class="sheZhiKa" style="max-width:720px">
        <div class="profileHead" style="align-items:center;gap:14px">
          <button id="iAvAnNiu" class="avAnNiu" title="${escapeHtml(t('touXiang.pickTitle'))}">
            <img class="touXiangTuPian big" src="${instanceAvatarSrc(inst)}" alt=""/>
          </button>
          <div style="flex:1">
            <div class="field"><label>${escapeHtml(t('instances.name'))}</label><input id="iMing" value="${escapeHtml(mingOf(inst))}"/></div>
          </div>
        </div>

        <h3 style="margin:14px 0 8px;font-size:13px">${escapeHtml(t('instances.cognition'))}</h3>
        <div class="jingYin" style="margin-bottom:8px">${escapeHtml(t('instances.cognitionHint'))}</div>
        <div id="iCogLieBiao"></div>
        <div style="margin-top:8px">
          <button class="anNiuXiao" id="iCogTianJia">${escapeHtml(t('instances.cognitionAdd'))}</button>
        </div>
        <div class="field" style="margin-top:12px">
          <label>${escapeHtml(t('instances.persona'))}</label>
          <textarea id="iPersona" placeholder="${escapeHtml(t('instances.personaPlaceholder'))}">${escapeHtml(inst.persona || '')}</textarea>
        </div>
        <div class="sheZhiKa" style="margin-top:14px" id="iModelcfg">
          <h3 style="margin:0 0 10px;font-size:14px">${escapeHtml(tOr('model.mgr', '管理模型'))}</h3>

          <!-- 子项 1：可用模型（只有这里的模型，才能被「默认模型」和「模型调用链」使用） -->
          <div class="modelZiXiang">
            <h4>${escapeHtml(tOr('model.available', '可用模型'))}</h4>
            <div class="jingYin" style="margin-bottom:6px">${escapeHtml(tOr('model.availableHint', '只有这里选中的模型，才能被「默认模型」和「模型调用链」使用。'))}</div>
            <label style="display:block;margin-bottom:8px">
              <input type="checkbox" id="iAllMoXingJi" ${inst.allModels !== false ? 'checked' : ''}/> ${escapeHtml(t('instances.allAvailable'))}
            </label>
            <div id="iManual" class="${inst.allModels !== false ? 'yinCang' : ''}">
              <div class="modelLiangLie">
                <select id="iProvXuanZe" size="6">${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian) + '</option>').join('')}</select>
                <select id="iMoXingXuanZe" size="6"></select>
              </div>
              <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
                <button class="anNiuXiao" id="iTianJiaMoXing">${escapeHtml(t('instances.addModel'))}</button>
                <button class="anNiuXiao" id="iDelMoXing">${escapeHtml(t('settings.removeModel'))}</button>
              </div>
            </div>
          </div>

          <!-- 子项 2：调用链（默认模型已并入：智能模式 = 自动安排；否则第一个未禁用的就是默认模型） -->
          <div class="modelZiXiang">
            <h4>${escapeHtml(tOr('model.chain', '调用链'))}</h4>
            <div class="jingYin" style="margin-bottom:6px">${escapeHtml(tOr('model.chainHint', '按顺序尝试；禁用的模型不会被调用。'))}</div>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <input type="checkbox" id="iSmartMoXing" ${smartMoXing ? 'checked' : ''}/>
              <span>${escapeHtml(tOr('model.smart', '智能模式'))}</span>
              <span class="jingYin">${escapeHtml(tOr('model.smartHint', '勾选后由系统自动安排调用链；取消勾选可手动排序/禁用。'))}</span>
            </label>
            <div id="iChain" class="${smartMoXing ? 'yinCang' : ''}"></div>
          </div>

          <!-- 子项 3：默认思考级别 -->
          <div class="modelZiXiang">
            <h4>${escapeHtml(tOr('model.think', '默认思考级别'))}</h4>
            <div class="jingYin" style="margin-bottom:6px">${escapeHtml(tOr('model.thinkHint', '控制模型思考的深度。选「自动」时由系统按任务挑最合适的档位；模型不支持所选档位会自动降级为「自动」并在回复开头说明。'))}</div>
            <div class="shiLiHang" style="align-items:center">
              <input type="range" id="iThinkLevel" min="0" max="7" step="1" list="iThinkTicks" style="flex:1;min-width:200px"
                     value="${Math.max(0, THINK_STOPS.indexOf(inst.thinkLevel || 'auto'))}"/>
              <span class="jingYin" id="iThinkLabel" style="min-width:78px;text-align:right">${escapeHtml(thinkLabelOf(inst.thinkLevel || 'auto'))}</span>
            </div>
            <datalist id="iThinkTicks">${THINK_STOPS.map((_, i) => `<option value="${i}"></option>`).join('')}</datalist>
          </div>

          <!-- 分类/决策模型：**已从牛马管理局移除**（产品要求：用不到，只保留「设置 → 模型」里那一份全局的） -->

          <!-- 子项 4：小弟数量（派生小弟的上限；默认自适应） -->
          <div class="modelZiXiang">
            <h4>${escapeHtml(tOr('model.xiaoDi', '小弟数量'))}</h4>
            <div class="jingYin" style="margin-bottom:6px">${escapeHtml(tOr('model.xiaoDiHint', '这只牛马最多同时派几个小弟干活。自适应 = 系统按任务自己定；0 = 不许派小弟。'))}</div>
            <select id="iXiaoDiShu">
              <option value="auto"${(inst.xiaoDiShuLiang === undefined || inst.xiaoDiShuLiang === 'auto' || inst.xiaoDiShuLiang === '') ? ' selected' : ''}>${escapeHtml(tOr('model.xiaoDiAuto', '自适应'))}</option>
              ${[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 30, 40, 50].map((n) => `<option value="${n}"${String(inst.xiaoDiShuLiang) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}
            </select>
            <div class="jingYin" style="font-size:11px;margin-top:4px">${escapeHtml(tOr('model.xiaoDiNow', '当前：'))}${escapeHtml(inst.xiaoDiShuLiang === undefined || inst.xiaoDiShuLiang === 'auto' || inst.xiaoDiShuLiang === '' ? tOr('model.xiaoDiAuto', '自适应') : String(inst.xiaoDiShuLiang))}</div>
          </div>
        </div>
        <div class="shiLiHang" style="margin-top:14px">
          <button class="anNiuZhuYao" id="iBaoCun" title="${escapeHtml(t('common.save'))}">${escapeHtml(t('common.save'))}</button>
          <button class="anNiuXiao" id="iQiDongTingZhi" title="${escapeHtml(inst.status === 'running' ? t('instances.stop') : t('instances.start'))}">${escapeHtml(inst.status === 'running' ? t('instances.stop') : t('instances.start'))}</button>
          <button class="anNiuDanger" id="iDel" title="${escapeHtml(t('instances.delete'))}">${escapeHtml(t('instances.delete'))}</button>
          <span class="huiZhang ${inst.status === 'running' ? '' : 'off'}">${inst.status === 'running' ? t('instances.running') : t('instances.stopped')}</span>
        </div>
      </div>`;
    $('iBaoCun').onclick = () => {
      const newMing = ($('iMing') && $('iMing').value.trim()) || mingOf(inst);
      if (mingYiZhanYong(newMing, inst.id)) { uiAlert(t('instances.nameDup') || ('重名：' + newMing)); return; }
      inst.name = newMing; inst.ming = newMing;
      const personaEl = $('iPersona');
      if (personaEl) inst.persona = personaEl.value;
      // 「默认模型」已并入调用链：智能模式 = 自动安排；否则取链上第一个未禁用的
      const smartEl = $('iSmartMoXing');
      inst.smartMode = smartEl ? !!smartEl.checked : shiZhiNengMoShi(inst);
      inst.defaultModel = inst.smartMode ? '' : lianMoRenMoXing(inst);
      const thinkEl = $('iThinkLevel');
      if (thinkEl) inst.thinkLevel = THINK_STOPS[Number(thinkEl.value) || 0] || 'auto';
      // 小弟数量：自适应 / 0..8（0 = 不许派小弟）
      const xiaoDiEl = $('iXiaoDiShu');
      if (xiaoDiEl) inst.xiaoDiShuLiang = xiaoDiEl.value === 'auto' ? 'auto' : Number(xiaoDiEl.value);
      window.__saveState?.();
      renderList();
      // 简洁 Toast：无边框、半透明、点击穿透、2.6 秒自毁
      showToast(tOr('common.saved', '已保存'));
    };
    const toggleBtn = $('iQiDongTingZhi');
    if (toggleBtn) {
      toggleBtn.onclick = async () => {
        // 单飞：上一个动作还没完就忽略这次点击（避免点两下开两个/停两次）
        if (instanceToggleBusy) return;
        instanceToggleBusy = true;
        const yuanWenBen = toggleBtn.textContent;
        const kaiShi = Date.now();
        toggleBtn.disabled = true;
        toggleBtn.textContent = tOr('common.loading', '处理中…');
        try {
          // 单开关：运行中→停止，否则→启动
          if (inst.status === 'running') {
            try {
              await window.warmy.stopInstance(inst.id);
            } catch (e) {
              uiAlert(String(e && e.message || e));
            }
            inst.status = 'stopped';
          } else {
            let r = null;
            try {
              const dsh = await window.warmy.dshAvailable().catch(() => ({ ok: false }));
              if (dsh && dsh.ok) {
                r = await window.warmy.spawnDshInstance({ id: inst.id, ming: mingOf(inst) });
              } else {
                r = await window.warmy.spawnInstance({ id: inst.id, ming: mingOf(inst), dutyEligible: true });
              }
            } catch (e) {
              uiAlert(String(e && e.message || e));
              return;
            }
            if (r && r.ok === false) {
              uiAlert(String(r.error || 'start failed'));
              return;
            }
            inst.status = 'running';
          }
        } finally {
          /**
           * 收尾以**主进程实况**为准（本地乐观值可能与真实不一致），
           * 然后整页重画 —— 把"点了没反应"变成"点了立刻有反馈 + 状态确实变了"。
           */
          try {
            const arr = await window.warmy.listInstances?.();
            const live = (arr || []).find((x) => x && (x.id === inst.id || x.ming === inst.ming || x.name === inst.name));
            if (live && live.status) inst.status = live.status;
          } catch { /* 读不到就用刚才的乐观值 */ }
          /**
           * **「进行中」最短可见 300ms**：动作太快时按钮一闪就恢复，
           * 用户（和自动化验收）根本来不及看到反馈（真事故：偶发地"点了没反应"）。
           */
          const yongShi = Date.now() - kaiShi;
          if (yongShi < 300) await new Promise((r) => setTimeout(r, 300 - yongShi));
          instanceToggleBusy = false;
          if (toggleBtn.isConnected) { toggleBtn.disabled = false; toggleBtn.textContent = yuanWenBen; }
          renderInstanceDetail();
          renderList();
          // 结果反馈：让用户明确知道"点生效了、现在是什么状态"
          try {
            showToast(inst.status === 'running' ? t('instances.running') : t('instances.stopped'));
          } catch { /* noop */ }
        }
      };
    }
    // ── 模型配置：默认模型 / 全部可用 / 手动添加 / 调用链 ──
    // ── 牛马头像 + 认知注入 ──
    (function bindInstanceAvatarCognition() {
      if (!inst.cognitionFiles) inst.cognitionFiles = [];
      const LieBiao = $('iCogLieBiao');
      function renderCog() {
        if (!LieBiao) return;
        LieBiao.innerHTML =
          inst.cognitionFiles
            .map(
              (f, i) =>
                '<div class="shiLiHang" style="margin:4px 0"><span style="flex:1">' +
                escapeHtml(f.name) +
                '</span><span class="jingYin">' + escapeHtml(String(f.size || 0)) + ' B</span>' +
                '<button class="anNiuXiao" data-cog-del="' + i + '">' + escapeHtml(t('mesh.remove')) + '</button></div>'
            )
            .join('') || '<div class="jingYin">' + escapeHtml(t('instances.cognitionEmpty')) + '</div>';
        LieBiao.querySelectorAll('[data-cog-del]').forEach((b) => {
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
      if (!$('iModelcfg')) return;
      const inst2 = inst;
      if (!inst2.availableModels) inst2.availableModels = [];
      if (inst2.allModels === undefined) inst2.allModels = true;
      /**
       * **真事故修**：「全部可用」默认是勾着的，但 `availableModels` 从没被填过 ——
       * 于是 `syncChainToAvailable()` 把空链过滤成空链，取消「智能模式」时**一个模型都不显示**。
       * 只有把「全部可用」取消再勾上（触发 onchange）才会填上模型。
       * 现在：绑定时就按「全部可用」补一次初始清单。
       */
      if (inst2.allModels !== false && (!inst2.availableModels || !inst2.availableModels.length)) {
        try {
          const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
          inst2.availableModels = [...new Set(all)];
        } catch { /* noop */ }
      }
      if (!inst2.chain || !inst2.chain.length) inst2.chain = [...inst2.availableModels];

      const defSel = $('iDefaultMoXing');
      const allChk = $('iAllMoXingJi');
      const allList = $('i-all-list');
      const manual = $('iManual');
      const provPick = $('iProvXuanZe');
      const modelPick = $('iMoXingXuanZe');
      const chainBox = $('iChain');

      /** 调用链只允许「可用模型」里的项；禁用的记在 inst2.chainDisabled */
      function syncChainToAvailable() {
        const avail = inst2.availableModels || [];
        inst2.chain = (inst2.chain || []).filter((m) => avail.includes(m));
        avail.forEach((m) => { if (!inst2.chain.includes(m)) inst2.chain.push(m); });
        inst2.chainDisabled = (inst2.chainDisabled || []).filter((m) => avail.includes(m));
      }

      /** 默认模型下拉跟随可用模型（默认「智能」） */
      function renderDefaultOptions() {
        const sel = $('iDefaultMoXing');
        if (!sel) return;
        const avail = inst2.availableModels || [];
        const cur = inst2.defaultModel || '__smart__';
        sel.innerHTML =
          '<option value="__smart__"' + (cur === '__smart__' ? ' selected' : '') + '>' + escapeHtml(t('instances.smartPick')) + '</option>' +
          avail.map((m) => '<option value="' + escapeHtml(m) + '"' + (cur === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('');
        if (cur !== '__smart__' && !avail.includes(cur)) {
          inst2.defaultModel = '__smart__';
          sel.value = '__smart__';
        }
      }

      function saveInst() {
        try { state.instances = state.instances.map((x) => (x.id === inst2.id ? inst2 : x)); window.__saveState?.(); } catch { /* noop */ }
      }

      function renderChain() {
        if (!chainBox) return;
        syncChainToAvailable();
        const LieBiao = inst2.chain || [];
        const dis = inst2.chainDisabled || [];
        /** 非智能模式下：第一个未禁用的模型 = 默认模型（给它挂标签） */
        const moRen = shiZhiNengMoShi(inst2) ? '' : lianMoRenMoXing(inst2);
        chainBox.innerHTML =
          LieBiao
            .map(
              (m, i) =>
                '<div class="shiLiHang lianHang" style="margin:4px 0' + (dis.includes(m) ? ';color:var(--muted)' : '') + '">' +
                '<span class="lianMing" style="flex:1' + (dis.includes(m) ? ';text-decoration:line-through' : '') + '">' + escapeHtml(m) +
                (m === moRen ? ' <span class="moRenBiaoQian">' + escapeHtml(tOr('model.default', '默认模型')) + '</span>' : '') +
                '</span>' +
                '<button class="anNiuXiao" data-top="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="' + escapeHtml(tOr('model.moveTop', '置顶')) + '">⤒</button>' +
                '<button class="anNiuXiao" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>' + escapeHtml(t('instances.moveUp')) + '</button>' +
                '<button class="anNiuXiao" data-down="' + i + '"' + (i === LieBiao.length - 1 ? ' disabled' : '') + '>' + escapeHtml(t('instances.moveDown')) + '</button>' +
                '<button class="anNiuXiao" data-tog="' + i + '">' + escapeHtml(dis.includes(m) ? tOr('model.enable', '启用') : tOr('model.disable', '禁用')) + '</button>' +
                '</div>'
            )
            .join('') || '<div class="jingYin">' + escapeHtml(t('settings.modelsEmpty')) + '</div>';
        chainBox.querySelectorAll('[data-top]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.top);
            if (i <= 0) return;
            const shuZu = inst2.chain;
            const [m0] = shuZu.splice(i, 1);
            shuZu.unshift(m0);
            if (!shiZhiNengMoShi(inst2)) inst2.defaultModel = lianMoRenMoXing(inst2);
            saveInst(); renderChain();
          };
        });
        chainBox.querySelectorAll('[data-up]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.up);
            if (i <= 0) return;
            const shuZu = inst2.chain;
            [shuZu[i - 1], shuZu[i]] = [shuZu[i], shuZu[i - 1]];
            if (!shiZhiNengMoShi(inst2)) inst2.defaultModel = lianMoRenMoXing(inst2);
            saveInst(); renderChain();
          };
        });
        chainBox.querySelectorAll('[data-down]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.down);
            const shuZu = inst2.chain;
            if (i >= shuZu.length - 1) return;
            [shuZu[i + 1], shuZu[i]] = [shuZu[i], shuZu[i + 1]];
            if (!shiZhiNengMoShi(inst2)) inst2.defaultModel = lianMoRenMoXing(inst2);
            saveInst(); renderChain();
          };
        });
        chainBox.querySelectorAll('[data-tog]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.tog);
            const m = (inst2.chain || [])[i];
            if (!m) return;
            const dis2 = new Set(inst2.chainDisabled || []);
            if (dis2.has(m)) dis2.delete(m); else dis2.add(m);
            inst2.chainDisabled = [...dis2];
            if (!shiZhiNengMoShi(inst2)) inst2.defaultModel = lianMoRenMoXing(inst2);
            saveInst(); renderChain();
          };
        });
      }
      renderDefaultOptions();
      renderChain();

      // 分类/决策模型链已从「牛马管理局 → 管理模型」移除（用不到；全局那份在「设置 → 模型」里）

      // 智能模式：勾上 = 系统自动安排调用链（收起模型列表）；取消 = 手动列出来（第一个未禁用 = 默认模型）
      const smartChk = $('iSmartMoXing');
      if (smartChk) {
        smartChk.onchange = () => {
          inst2.smartMode = smartChk.checked;
          inst2.defaultModel = smartChk.checked ? '' : lianMoRenMoXing(inst2);
          chainBox?.classList.toggle('yinCang', smartChk.checked);
          // 取消智能模式时要能**看得到模型**：链是空的就先按「全部可用」补一次
          if (!smartChk.checked && inst2.allModels !== false && !(inst2.chain || []).length) {
            try {
              const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
              inst2.availableModels = [...new Set(all)];
              inst2.chain = [...inst2.availableModels];
              inst2.chainDisabled = [];
            } catch { /* noop */ }
          }
          saveInst();
          renderDefaultOptions();
          renderChain();
        };
      }
      // 默认思考级别滑块
      const thinkEl = $('iThinkLevel');
      if (thinkEl) {
        thinkEl.oninput = () => {
          const v = THINK_STOPS[Number(thinkEl.value) || 0] || 'auto';
          const lab = $('iThinkLabel');
          if (lab) lab.textContent = thinkLabelOf(v);
          inst2.thinkLevel = v;
          saveInst();
        };
      }

      // 全部可用：勾选时不显示模型列表；取消时进入手动添加
      if (allChk) {
        allChk.onchange = () => {
          inst2.allModels = allChk.checked;
          manual?.classList.toggle('yinCang', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
            inst2.availableModels = [...new Set(all)];
            inst2.chain = [...inst2.availableModels];
            inst2.chainDisabled = [];
          }
          renderDefaultOptions();
          renderChain();
          updateAddDelState();
          saveInst();
        };
      }

      // 两列选择器：左供应商 → 右模型
      function fillModels() {
        if (!provPick || !modelPick) return;
        /**
         * 左侧**没选中**供应商 ⇒ 右侧必须是空的（右侧就是左侧供应商的模型清单）。
         * 以前这里 `|| state.providers[0]` 兜底 ⇒ 左边没选也冒出第一家的模型，语义是错的。
         */
        const p = state.providers.find((x) => x.id === provPick.value) || null;
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
        const Quan = selectedFull();
        const inChain = Quan && (inst2.chain || []).includes(Quan);
        const tianJiaAnNiu = $('iTianJiaMoXing');
        const delBtn = $('iDelMoXing');
        if (tianJiaAnNiu) {
          tianJiaAnNiu.disabled = !Quan || inChain;
          tianJiaAnNiu.style.opacity = tianJiaAnNiu.disabled ? 0.45 : 1;
        }
        if (delBtn) {
          delBtn.disabled = !Quan || !inChain;
          delBtn.style.opacity = delBtn.disabled ? 0.45 : 1;
        }
      }

      defSel?.addEventListener('change', () => {
        inst2.defaultModel = defSel.value;
        saveInst();
      });

      if (provPick) {
        provPick.onchange = fillModels;
        fillModels();
      }
      modelPick?.addEventListener('change', updateAddDelState);

      $('iTianJiaMoXing')?.addEventListener('click', () => {
        const Quan = selectedFull();
        if (!Quan) return;
        inst2.availableModels = [...new Set([...(inst2.availableModels || []), Quan])];
        inst2.chain = [...new Set([...(inst2.chain || []), Quan])];
        const sel = $('iDefaultMoXing');
        if (sel && ![...sel.options].some((o) => o.value === Quan)) {
          const opt = document.createElement('option');
          opt.value = Quan;
          opt.textContent = Quan;
          sel.appendChild(opt);
        }
        renderChain();
        updateAddDelState();
      });

      $('iDelMoXing')?.addEventListener('click', () => {
        const Quan = selectedFull();
        if (!Quan) return;
        inst2.chain = (inst2.chain || []).filter((x) => x !== Quan);
        inst2.availableModels = (inst2.availableModels || []).filter((x) => x !== Quan);
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
        '<option value="__smart__">' + escapeHtml(t('instances.smartPick')) + '</option>' +
        (inst.availableModels || [])
          .map((m) => '<option value="' + escapeHtml(m) + '"' + (cur === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>')
          .join('');
      function inst2DefaultModel() {
        return inst.defaultModel || '';
      }
    }

    $('iDel').onclick = async () => {
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
      $('kongTai').classList.remove('yinCang');
      renderList();
    };
  }

  /**
   * 凭证的**遮蔽显示**：开头 **3 组**原样、中间 **3 组「牛马」**、结尾 **9 组**原样，
   * 仍然 3 个一组、用 - 分隔。为什么要遮：凭证就是私钥，完整摆着等于泄露。
   * 51 位 = 17 组示例：`2B5-09V-KPY-牛马-牛马-牛马-3PX-0KP-...-T3Q`（3 真 + 3 遮 + 9 真）。
   */
  /**
   * 凭证遮挡定稿：开头 1 组原样 + 中间 9 个「牛马」（假数量）+ **最后 6 个字符**原样。
   * 「最后 6 位」= 字符数（不是 6 组）；仍 3 字符一组、- 分隔。
   * 例（51 位）：`2B5-牛马-牛马-牛马-牛马-牛马-牛马-牛马-牛马-牛马-XXXXXX`
   */
  const CRED_MASK_GROUPS = 9;
  function maskCredential(value) {
    const s = String(value || '');
    if (!s) return '—';
    const raw = s.replace(/[\s-]+/g, '');
    if (raw.length <= 9) return s;
    const head = raw.slice(0, 3);
    const tail = raw.slice(-6);
    const mid = Array.from({ length: CRED_MASK_GROUPS }, () => '牛马');
    return [head, ...mid, tail].join('-');
  }

  /** 小眼睛图标（内联 SVG，不依赖字体/emoji） */
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>';

  function renderPage() {
    const heZi = $('pageTi');
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
    if (state.nav === 'wo') {
      const p = state.profile;
      const avHtml = `<img class="touXiangTuPian big" src="${personAvatarSrc(p)}" alt=""/>`;
      heZi.innerHTML = `
        <div class="woDing">
          <!-- 品牌块：**logo 与名称上下排列**（不再左右挤在一起）⇒ logo 可以更大 -->
          <div class="woPinPai woPinPaiStack">
            <img class="pinPailogo pinPailogoXl" src="./icons/logo-tight.png" alt="${escapeHtml(t('brand.name'))}"/>
            <div class="woPinPaiWenBen">
              <div class="woPinPaiMing">${escapeHtml(t('brand.name'))}</div>
              <div class="woPinPaiFu">${escapeHtml(t('brand.fu'))}</div>
              <div class="jingYin woPinPaiBiaoQian">${escapeHtml(t('brand.tagline') || '')}</div>
            </div>
          </div>
          <!-- 用户资料：**一列**。
               排布按产品主要求：头像 → 下面用户名（邮箱在用户名**右侧**）→ 再下面凭证。
               指纹那一块删掉了：它与"凭证"是同一件东西的两种显示（产品主："这2个重复了"）。 -->
          <div class="woStrip woStripLan" style="flex:1;min-width:300px;margin:0">
            <div class="woTouXiangLan">
              <button id="pAvAnNiu" class="avAnNiu" aria-label="${escapeHtml(t('wo.touXiang'))}">${avHtml}</button>
              <!-- 用户名在头像下面；邮箱在用户名右侧；名称可点击就地编辑 -->
              <div class="woMingHang">
                <span id="pMingDisplay" class="usernameDisplay" title="${escapeHtml(t('wo.username'))}">${escapeHtml(p.username || t('nav.touXiang'))}</span>
                <input id="pMing" class="usernameShuRu yinCang" value="${escapeHtml(p.username)}"/>
                <span class="woYouJianInline">
                  <input id="pYouJian" autocomplete="email" placeholder="ming@example.com" value="${escapeHtml(p.email || '')}" title="${escapeHtml(t('wo.email'))}"/>
                </span>
                <span class="jingYin" id="pYouJianXiaoXi" style="font-size:11px"></span>
              </div>
            </div>
            <div class="woXinXiLan">
              <div class="field">
                <label>${escapeHtml(t('wo.credential'))}</label>
                <div class="woCredHe">
                  <!-- 默认只露**前三后三**，中间用等长的「牛马」遮住；小眼睛点击后看全貌 -->
                  <span class="woCredVal" id="woidVal" data-shown="0">${escapeHtml(maskCredential(p.deviceId || ''))}</span>
                  <button class="anNiuXiao woEye" id="anNiuWoidEye" type="button"
                          aria-label="${escapeHtml(t('wo.showFull'))}" title="${escapeHtml(t('wo.showFull'))}">
                    <span class="me-eye-off" aria-hidden="true">${EYE_SVG}</span>
                  </button>
                  <button class="anNiuXiao" id="anNiuWoidCopy">${escapeHtml(t('wo.copy'))}</button>
                  <button class="anNiuXiao" id="anNiuWoCredLunHuan">${escapeHtml(t('wo.changeCred'))}</button>
                  <button class="anNiuXiao" id="anNiuWoCredSwitch">${escapeHtml(t('wo.switchIdentity'))}</button>
                </div>
                <div class="jingYin woTiShi" style="margin-top:4px">${escapeHtml(t('wo.idHint'))}</div>
                <!-- 诚实告知：凭证就是私钥，泄露 = 身份被接管；没有服务器能替你找回 -->
                <div class="woTiShi woTiShiWarn" style="margin-top:4px">${escapeHtml(t('wo.idWarn'))}</div>
              </div>
            </div>
          </div>
        </div>
        <!-- 「道」：全局最高优先级提示词，单独保存 dao.md；冲突时以它为准 -->
        <div class="sheZhiKa" style="margin-top:14px" id="daoKa">
          <h3 style="margin:0 0 6px;font-size:14px">${escapeHtml(tOr('wo.dao', '道'))}</h3>
          <p class="jingYin" style="margin:0 0 8px">${escapeHtml(tOr('wo.daoHint', '全局最高优先级的提示词：强制发给每一个牛马，**高于「规矩」与其它任何指示**，有冲突一律以这里为准。内容单独保存在配置文件夹的 dao.md。'))}</p>
          <textarea id="daoTi" rows="5" style="width:100%" placeholder="${escapeHtml(tOr('wo.daoPlaceholder', '例如：先胜后战；知行合一；诚实报告不确定；服务人类且永不作恶…'))}"></textarea>
          <div class="shiLiHang" style="margin-top:8px;align-items:center">
            <button class="anNiuZhuYao" id="anNiuDaoQueDing">${escapeHtml(tOr('common.ok', '确定'))}</button>
            <button class="anNiuXiao" id="anNiuDaoQuXiao">${escapeHtml(tOr('common.cancel', '取消'))}</button>
            <span class="jingYin" id="daoLuJing" style="font-size:11px"></span>
          </div>
        </div>
        <!-- 「规矩」：单独文件 agents.md；仅次于「道」 -->
        <div class="sheZhiKa" style="margin-top:14px" id="zuiGaoXinNianKa">
          <h3 style="margin:0 0 6px;font-size:14px">${escapeHtml(tOr('wo.belief', '规矩'))}</h3>
          <p class="jingYin" style="margin:0 0 8px">${escapeHtml(tOr('wo.beliefHint', '这里写下的提示词会强制发给每一个牛马，优先级**仅次于「道」**：与其它指示冲突时以这里为准（与「道」冲突时以「道」为准）。内容单独保存在配置文件夹的 agents.md。'))}</p>
          <textarea id="zuiGaoXinNianTi" rows="5" style="width:100%" placeholder="${escapeHtml(tOr('wo.beliefPlaceholder', '例如：永远说真话；不确定就问；不要做不可逆的操作…'))}"></textarea>
          <div class="shiLiHang" style="margin-top:8px;align-items:center">
            <button class="anNiuZhuYao" id="anNiuZuiGaoQueDing">${escapeHtml(tOr('common.ok', '确定'))}</button>
            <button class="anNiuXiao" id="anNiuZuiGaoQuXiao">${escapeHtml(tOr('common.cancel', '取消'))}</button>
            <span class="jingYin" id="zuiGaoXinNianLu" style="font-size:11px"></span>
          </div>
        </div>
        <div id="dashHost"></div>`;
      /**
       * 「道」与「规矩」共用同一套「读回 → 编辑 → 确定保存 / 取消还原」。
       * （真机反馈修：此前 preload 缺这两个入口，`?.()` 让保存静默空转 —— 从来没落过盘。）
       */
      (function bindDaoGui() {
        const zuHe = (taId, okId, noId, luId, du, she, wenJian) => {
          const ta = $(taId);
          if (!ta) return;
          let shangCi = ta.value;
          void (async () => {
            try {
              const r = await du();
              if (r && r.ok) {
                shangCi = String(r.text || '');
                ta.value = shangCi;
                const lu = $(luId);
                if (lu && r.path) lu.textContent = tOr('wo.beliefFile', '文件') + '：' + r.path;
              }
            } catch { /* noop */ }
          })();
          $(okId)?.addEventListener('click', async () => {
            try {
              const r = await she({ text: ta.value });
              if (r && r.ok) {
                shangCi = ta.value;
                showToast(tOr('common.saved', '已保存'));
                const lu = $(luId);
                if (lu && r.path) lu.textContent = tOr('wo.beliefFile', '文件') + '：' + r.path;
              } else {
                uiAlert(String((r && r.error) || t('common.error')));
              }
            } catch (e) { uiAlert(String(e && e.message || e)); }
          });
          $(noId)?.addEventListener('click', () => {
            ta.value = shangCi;
            showToast(tOr('common.cancel', '取消'));
          });
          void wenJian;
        };
        zuHe('daoTi', 'anNiuDaoQueDing', 'anNiuDaoQuXiao', 'daoLuJing',
          () => window.warmy.daoDu?.(), (p) => window.warmy.daoShe?.(p), 'dao.md');
        zuHe('zuiGaoXinNianTi', 'anNiuZuiGaoQueDing', 'anNiuZuiGaoQuXiao', 'zuiGaoXinNianLu',
          () => window.warmy.zuiGaoXinNianDu?.(), (p) => window.warmy.zuiGaoXinNianShe?.(p), 'agents.md');
      })();
      // 凭证 = ID = 私钥（只展示给本人；指纹不再单独显示，避免与它重复）
      (async () => {
        try {
          const info = await window.warmy.credentialInfo?.();
          const idEl = $('woidVal');
          if (idEl && info?.ok && info.credential) {
            idEl.dataset.raw = info.credential;
            idEl.dataset.Quan = info.formatted || info.credential;
            idEl.textContent = idEl.dataset.xianshi === '1' ? idEl.dataset.Quan : maskCredential(info.credential);
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
      $('anNiuWoidEye')?.addEventListener('click', async () => {
        const yuanSu = $('woidVal');
        if (!yuanSu) return;
        if (!yuanSu.dataset.Quan || !yuanSu.dataset.raw) {
          try {
            const info = await window.warmy.credentialInfo?.();
            if (info?.ok && info.credential) {
              yuanSu.dataset.raw = info.credential;
              yuanSu.dataset.Quan = info.formatted || info.credential;
              yuanSu.textContent = maskCredential(info.credential);
            }
          } catch { /* noop */ }
        }
        if (!yuanSu.dataset.Quan && !yuanSu.dataset.raw) return;
        const xianshi = yuanSu.dataset.xianshi === '1';
        yuanSu.dataset.xianshi = xianshi ? '0' : '1';
        yuanSu.textContent = xianshi ? maskCredential(yuanSu.dataset.raw || '') : (yuanSu.dataset.Quan || yuanSu.dataset.raw || '');
        const btn = $('anNiuWoidEye');
        if (btn) {
          const biaoQian = xianshi ? t('wo.showFull') : t('wo.hideFull');
          btn.setAttribute('aria-label', biaoQian);
          btn.setAttribute('title', biaoQian);
          btn.classList.toggle('qiYong', !xianshi);
        }
      });
      $('anNiuWoidCopy')?.addEventListener('click', async () => {
        const yuanSu = $('woidVal');
        const v = (yuanSu && yuanSu.dataset.raw) || (yuanSu && yuanSu.textContent) || '';
        try { await navigator.clipboard.writeText(v); uiAlert(t('contact.mineCopied')); } catch { uiAlert(t('contact.mineCopyFail')); }
      });
      $('btn-me-cred-copy')?.addEventListener('click', async () => {
        const yuanSu = $('woidVal');
        const v = (yuanSu && yuanSu.dataset.raw) || (yuanSu && yuanSu.textContent) || '';
        try { await navigator.clipboard.writeText(v); uiAlert(t('contact.mineCopied')); } catch { uiAlert(t('contact.mineCopyFail')); }
      });
      /**
       * 更换凭证：**ID 与身份必须同时换**。
       * 因为"ID 就是私钥"，只换身份而不换 ID 会留下"两把不同的密钥"这个矛盾；
       * 主进程的 credential-rotate 会：备份旧身份 → 生成新凭证 → 用它派生出新身份 → 写回配置。
       */
      $('anNiuWoCredLunHuan')?.addEventListener('click', async () => {
        if (!(await uiConfirm(t('wo.changeCred') + '?'))) return;
        const r = await window.warmy.credentialRotate?.().catch(() => null);
        if (r?.ok && r.credential) {
          const yuanSu = $('woidVal');
          if (yuanSu) { yuanSu.textContent = r.formatted || r.credential; yuanSu.dataset.raw = r.credential; }
          uiAlert(t('wo.credRotated'));
        } else {
          uiAlert(String(r?.error || 'fail'));
        }
      });
      $('anNiuWoCredSwitch')?.addEventListener('click', () => {
        const root = $('duiHuaKuangGen');
        $('duiHuaKuangBiaoTi').textContent = t('wo.switchIdentity');
        $('duiHuaKuangTi').innerHTML =
          '<div class="jingYin" style="margin-bottom:8px">' + escapeHtml(t('wo.switchHint')) + '</div>' +
          '<div class="field"><label>' + escapeHtml(t('wo.backupJson')) + '</label>' +
          '<textarea id="woBeiFenjson" rows="5" style="width:100%"></textarea></div>' +
          '<div class="field" style="margin-top:8px"><label>' + escapeHtml(t('wo.passphrase')) + '</label>' +
          '<input id="woBeiFenPass" type="password"/></div>' +
          '<div class="jingYin" id="woSwitchXiaoXi" style="margin-top:6px"></div>';
        const dongZuoJi = $('duiHuaKuangDongZuoJi');
        dongZuoJi.innerHTML = '';
        const cancel = document.createElement('button');
        cancel.className = 'anNiuXiao';
        cancel.textContent = t('common.cancel') || 'Cancel';
        cancel.onclick = () => root.classList.add('yinCang');
        const QueDingAnNiu = document.createElement('button');
        QueDingAnNiu.className = 'anNiuZhuYao';
        QueDingAnNiu.textContent = t('common.ok') || 'OK';
        QueDingAnNiu.onclick = async () => {
          const backupJson = $('woBeiFenjson')?.value || '';
          const passphrase = $('woBeiFenPass')?.value || '';
          const r = await window.warmy.identityBackupImport?.({ backupJson, passphrase }).catch(() => null);
          const xiaoXi = $('woSwitchXiaoXi');
          if (r?.ok) {
            if (xiaoXi) xiaoXi.textContent = (t('wo.switchIdentity') || '') + ' OK · ' + (r.zhiWen || '');
            /**
             * 恢复进来的身份也要与"凭证 = 私钥"这条不变量一致：
             * 主进程会从恢复出来的私钥**反推出对应的凭证**并写回配置，这里直接读回来显示。
             */
            const info = await window.warmy.credentialInfo?.().catch(() => null);
            const yuanSu = $('woidVal');
            if (yuanSu && info?.ok && info.credential) { yuanSu.textContent = info.formatted || info.credential; yuanSu.dataset.raw = info.credential; }
            setTimeout(() => root.classList.add('yinCang'), 600);
          } else if (xiaoXi) {
            xiaoXi.textContent = String(r?.error || 'fail');
          }
        };
        dongZuoJi.append(cancel, QueDingAnNiu);
        root.classList.remove('yinCang');
      });
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
      // 邮箱：格式正确即**即时保存**（不提供"保存资料"按钮）
      (function bindEmailAutoSave() {
        const input = $('pYouJian');
        const xiaoXi = $('pYouJianXiaoXi');
        if (!input) return;
        let lastSaved = state.profile.email || '';
        const valid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
        const tongBu = () => {
          const v = String(input.value || '').trim();
          if (!v) {
            if (xiaoXi) xiaoXi.textContent = '';
            if (lastSaved) { state.profile.email = ''; saveProfile(); lastSaved = ''; }
            return;
          }
          if (!valid(v)) {
            if (xiaoXi) xiaoXi.textContent = t('wo.emailInvalid') || 'Invalid email';
            input.classList.add('invalid');
            return;
          }
          input.classList.remove('invalid');
          if (v !== lastSaved) {
            state.profile.email = v;
            saveProfile();
            lastSaved = v;
            if (xiaoXi) xiaoXi.textContent = t('wo.emailSaved') || 'Saved';
            setTimeout(() => { if (xiaoXi) xiaoXi.textContent = ''; }, 1500);
          }
        };
        input.addEventListener('input', tongBu);
        input.addEventListener('blur', tongBu);
      })();
      renderDashboard($('dashHost'));
      return;
    }

    if (state.nav === 'settings') {
      heZi.innerHTML = `
        <div class="peiZhiBuJu">
        <div class="peiZhiDaoHang" id="peiZhiDaoHang">
          <input id="peiZhiSouSuo" class="hkFilter" placeholder="${escapeHtml(tOr('settings.search', '搜索设置…'))}" style="margin-bottom:8px"/>
          <button data-sec="ui" class="qiYong">${escapeHtml(t('settings.section.ui'))}</button>
          <button data-sec="notify">${escapeHtml(t('settings.section.notify'))}</button>
          <button data-sec="model">${escapeHtml(t('settings.section.model'))}</button>
          <button data-sec="func">${escapeHtml(t('settings.section.func'))}</button>
          <button data-sec="skill">${escapeHtml(t('settings.tabSkills'))}</button>
          <button data-sec="plugin">${escapeHtml(t('settings.tabPlugins'))}</button>
          <button data-sec="hotkey">${escapeHtml(t('settings.section.hotkey'))}</button>
          <button data-sec="about">${escapeHtml(t('settings.section.about'))}</button>
          <button data-sec="mimic">${escapeHtml(tOr('settings.mimic', '拟态'))}</button>
        </div>
        <div class="peiZhiNeiRong" id="peiZhiNeiRong">
        <div class="sheZhiSection" data-sec="ui"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.ui'))}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.language'))}</h2>
          <select id="xuanZeYuYan" title="${escapeHtml(t('settings.language'))}">
            ${localeOptionsHtml(state.yuYan)}
          </select>
          <!-- 加强 AI 语言约束：思考过程与回复都严格用上面选的语言 -->
          <label style="display:flex;align-items:center;gap:6px;margin-top:10px;cursor:pointer">
            <input type="checkbox" id="yanGeYuYan" ${state.strictAiLanguage ? 'checked' : ''}/>
            <span>${escapeHtml(tOr('settings.strictAiLanguage', '加强 AI 语言约束（AI 将更少地使用其他语言）'))}</span>
          </label>
          <div class="jingYin" style="margin-top:4px">${escapeHtml(tOr('settings.strictAiLanguageHint', '勾选后，AI 的思考过程与回复会更严格地使用上面设置的语言。'))}</div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.themeMode'))}</h2>
          <div class="zhuTiMoShi">
            <button data-m="light" class="${state.themeMode === 'light' ? 'qiYong' : ''}">${escapeHtml(t('settings.themeLight'))}</button>
            <button data-m="dark" class="${state.themeMode === 'dark' ? 'qiYong' : ''}">${escapeHtml(t('settings.themeDark'))}</button>
            <button data-m="system" class="${state.themeMode === 'system' ? 'qiYong' : ''}">${escapeHtml(t('settings.themeSystem'))}</button>
          </div>
          <h2 style="margin-top:12px">${escapeHtml(t('settings.theme'))}</h2>
          <div class="zhuTiSwatches" id="zhuTiSwatches"></div>
          <div class="jingYin" id="zhuTiDuibiDuTiShi" style="font-size:11px;min-height:16px"></div>
          <div class="zhuTiCustomHang">
            <div class="jingYin" style="margin:6px 0 4px">${escapeHtml(tOr('settings.themeCustom', '自定义颜色'))}</div>
            <button type="button" id="anNiuZhuTiCustom" class="zhuTiSeKuai" title="${escapeHtml(tOr('settings.customColorTitle', '自定义主题色'))}" aria-label="${escapeHtml(tOr('settings.customColorTitle', '自定义主题色'))}"></button>
          </div>
        </div>
        <div class="sheZhiSection sheZhiKa" id="wenZiKa">
          <h2>${escapeHtml(tOr('settings.text', '文字'))}</h2>
          <p class="jingYin">${escapeHtml(tOr('settings.textHint', '字体、粗细与大小。安装包不内置字体：这里列出系统已装字体，也可自行安装你有权使用的字体。'))}</p>
          <div class="field" style="margin-top:10px">
            <label>${escapeHtml(tOr('settings.fontFamily', '字体'))}</label>
            <div class="shiLiHang">
              <select id="ziTiXuanZe">
                <option value="">${escapeHtml(tOr('settings.fontDefault', '默认（跟随系统）'))}</option>
              </select>
              <button type="button" class="anNiuXiao" id="anNiuAnZhuangZiTi">${escapeHtml(tOr('settings.fontInstall', '安装字体…'))}</button>
            </div>
            <div class="jingYin" id="ziTiXiaoXi" style="font-size:11px;margin-top:4px"></div>
          </div>
          <div class="shiLiHang" style="margin-top:10px;align-items:flex-end;gap:16px">
            <div class="field" style="flex:1;min-width:180px;max-width:320px">
              <label>${escapeHtml(tOr('settings.fontWeight', '粗细'))} <span class="jingYin" id="ziTiCuXiShu"></span></label>
              <input type="range" id="ziTiCuXi" min="100" max="900" step="50" style="width:100%"/>
            </div>
            <div class="field" style="flex:1;min-width:180px;max-width:320px">
              <label>${escapeHtml(tOr('settings.fontSize', '大小'))} <span class="jingYin" id="ziTiDaXiaoShu"></span></label>
              <input type="range" id="ziTiDaXiao" min="15" max="650" step="5" style="width:100%"/>
            </div>
          </div>
          <div class="jingYin" style="font-size:11px">${escapeHtml(tOr('settings.fontWeightHint', '粗细向左更细、向右更粗（100–900）；大小统一放大或缩小程序里所有可见文字。'))}</div>
          <div class="shiLiHang" style="margin-top:12px;align-items:center">
            <button type="button" class="anNiuZhuYao" id="anNiuWenZiQueDing">${escapeHtml(tOr('common.ok', '确定'))}</button>
            <span class="jingYin" id="ziTiQueDingTiShi">${escapeHtml(tOr('settings.fontApplyHint', '改完点「确定」后生效。'))}</span>
          </div>
        </div>
        <div class="sheZhiSection" data-sec="notify"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.notify'))}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.soundName'))}</h2>
          <div class="soundHang">
            <label><input type="checkbox" id="sWanCheng" ${state.sound.complete ? 'checked' : ''}/> ${escapeHtml(t('settings.soundComplete'))}</label>
            <label><input type="checkbox" id="sQingQiu" ${state.sound.request ? 'checked' : ''}/> ${escapeHtml(t('settings.soundRequest'))}</label>
            <label><input type="checkbox" id="sCuoWu" ${state.sound.error ? 'checked' : ''}/> ${escapeHtml(t('settings.soundError'))}</label>
          </div>
          <div class="field" style="margin-top:8px">
            <label>${escapeHtml(tOr('settings.soundVolume', '通知音量'))}</label>
            <input type="range" id="soundVolume" min="0" max="100" step="5" value="${Math.round((state.soundVolume != null ? state.soundVolume : 0.9) * 100)}"/>
            <div class="jingYin" style="font-size:11px" id="soundVolumeVal">${Math.round((state.soundVolume != null ? state.soundVolume : 0.9) * 100)}%</div>
          </div>
          <div class="field" style="margin-top:10px"><label>${escapeHtml(t('settings.soundCompleteFile'))}</label>
            <div class="shiLiHang"><input id="sfWanCheng" value="${escapeHtml(state.soundFiles.complete)}" readonly placeholder="${escapeHtml(tOr('settings.builtinComplete', '内置默认音效'))}"/>
            <button class="anNiuXiao" data-pick="complete">${escapeHtml(t('settings.soundPick'))}</button>
            <button class="anNiuXiao" data-clear="complete">${escapeHtml(t('settings.soundClear'))}</button><button class="anNiuXiao" data-try="complete">${escapeHtml(tOr('sound.try', '试听'))}</button><span class="jingYin" style="font-size:11px">${escapeHtml(tOr('sound.builtin', '留空则用内置默认音效'))}</span></div></div>
          <div class="field" style="margin-top:8px"><label>${escapeHtml(t('settings.soundRequestFile'))}</label>
            <div class="shiLiHang"><input id="sfQingQiu" value="${escapeHtml(state.soundFiles.request)}" readonly placeholder="${escapeHtml(tOr('settings.builtinRequest', '内置默认音效'))}"/>
            <button class="anNiuXiao" data-pick="request">${escapeHtml(t('settings.soundPick'))}</button>
            <button class="anNiuXiao" data-clear="request">${escapeHtml(t('settings.soundClear'))}</button><button class="anNiuXiao" data-try="request">${escapeHtml(tOr('sound.try', '试听'))}</button><span class="jingYin" style="font-size:11px">${escapeHtml(tOr('sound.builtin', '留空则用内置默认音效'))}</span></div></div>
          <div class="field" style="margin-top:8px"><label>${escapeHtml(t('settings.soundErrorFile'))}</label>
            <div class="shiLiHang"><input id="sfCuoWu" value="${escapeHtml(state.soundFiles.error)}" readonly placeholder="${escapeHtml(tOr('settings.builtinError', '内置默认音效'))}"/>
            <button class="anNiuXiao" data-pick="error">${escapeHtml(t('settings.soundPick'))}</button>
            <button class="anNiuXiao" data-clear="error">${escapeHtml(t('settings.soundClear'))}</button><button class="anNiuXiao" data-try="error">${escapeHtml(tOr('sound.try', '试听'))}</button><span class="jingYin" style="font-size:11px">${escapeHtml(tOr('sound.builtin', '留空则用内置默认音效'))}</span></div></div>
        </div>
                <div class="sheZhiSection sheZhiKa" id="tongZhiYouJianKa">
          <h2>${escapeHtml(t('settings.emailNotify'))}</h2>
          <p class="jingYin">${escapeHtml(t('settings.emailNotifyHint'))}</p>
          <div style="font-weight:600;font-size:13px;margin:10px 0 4px">${escapeHtml(t('settings.emailWhen'))}</div>
          <div id="smtpYouJianNotify2">
            ${['complete', 'request', 'error']
              .map(
                (k) =>
                  '<label style="margin-right:14px"><input type="checkbox" data-email-k="' + k + '" ' +
                  (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</label>'
              )
              .join('')}
            <div class="jingYin">${escapeHtml(t('settings.emailHint'))}</div>
          </div>
          <h3 style="font-size:13px;margin:12px 0 4px">${escapeHtml(t('smtp.biaoTi'))} <span class="jingYin">(${escapeHtml(t('smtp.count'))} <span id="smtpN">0</span>/10 · ${escapeHtml(t('smtp.max10'))})</span></h3>
          <p class="jingYin">${escapeHtml(t('smtp.tiShi'))}</p>
          <div id="smtpAccounts"></div>
          <div class="shiLiHang" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
            <div class="field"><label>${escapeHtml(t('smtp.biaoQian'))}</label><input id="smtpBiaoQian" placeholder="${escapeHtml(t('placeholder.email'))}"/></div>
            <div class="field"><label>${escapeHtml(t('smtp.host'))}</label><input id="smtpHost" value="" placeholder="smtp.example.com"/></div>
            <div class="field"><label>${escapeHtml(t('smtp.port'))}</label><input id="smtpDuanKou" value="465"/></div>
          </div>
          <div class="shiLiHang" style="margin-top:8px">
            <label><input type="checkbox" id="smtpAnQuan" checked/> ${escapeHtml(t('smtp.secure'))}</label>
            <div class="field"><label>${escapeHtml(t('smtp.user'))}</label><input id="smtpUser"/></div>
            <div class="field"><label>${escapeHtml(t('smtp.pass'))}</label><input id="smtpPass" type="password"/></div>
            <button class="anNiuXiao" id="anNiusmtpTianJia">${escapeHtml(t('smtp.add'))}</button>
          </div>
                    <div class="tongZhiApplyTiao">
            <button class="anNiuXiao" id="anNiuTongZhiCancel">${escapeHtml(t('settings.notifyCancel'))}</button>
            <button class="anNiuZhuYao" id="anNiuTongZhiApply">${escapeHtml(t('settings.notifyApply'))}</button>
            <span class="jingYin" id="tongZhiApplyXiaoXi"></span>
          </div>
          <span class="jingYin" id="smtpXiaoXi"></span>
        </div>
        <div class="sheZhiSection" data-sec="model"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.model'))}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.providers'))} <span class="jingYin" id="provCount"></span></h2>
          <div class="shiLiHang" style="align-items:flex-end;margin-bottom:10px">
            <div class="field" style="max-width:220px">
              <label>${escapeHtml(t('settings.providerPreset'))}</label>
              <select id="provPreset"></select>
            </div>
            <button class="anNiuZhuYao" id="anNiuTianJiaProv">${escapeHtml(t('settings.addProvider'))}</button>
          </div>
          <div id="provLieBiao"></div>
        </div>
        <div class="sheZhiSection" data-sec="func"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.func'))}</h2></div>
        <div class="sheZhiSection sheZhiKa" id="jiYiXiTongKa">
          <h2>${escapeHtml(t('memory.statusTitle'))}</h2>
          <p class="jingYin">${escapeHtml(t('memory.desc'))}</p>
          <div class="jingYin" id="aboutJiYi">—</div>
          <div style="margin-top:8px">
            <button class="anNiuXiao" id="anNiuJiYiChongJian">${escapeHtml(t('memory.rebuild'))}</button>
            <span class="jingYin" id="aboutJiYiXiaoXi"></span>
          </div>
          <p class="jingYin" style="margin-top:6px">${escapeHtml(t('memory.rebuildWhy'))}</p>
        </div>
        <div class="sheZhiSection sheZhiKa" id="dshAnZhuangKa">
          <h2>${escapeHtml(t('dsh.biaoTi'))}</h2>
          <p class="jingYin">${escapeHtml(t('dsh.tiShi'))}</p>
          <div id="dshZhuangTaiWenBen" class="dshZhuangTai" style="font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px;background:var(--hover);margin:6px 0;border:1px solid transparent">—</div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="anNiuZhuYao" id="anNiuDshAnZhuang">${escapeHtml(tOr('dsh.anZhuang', '一键安装 dsh'))}</button>
            <button class="anNiuXiao" id="anNiuDshJianCha">${escapeHtml(t('dsh.jianCha'))}</button>
            <span class="jingYin" id="dshAnZhuangXiaoXi"></span>
          </div>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.security'))}</h2>
          <div class="secHang">
            <select id="xuanZeSec" title="${escapeHtml(t('settings.securityHint'))}">
              <option value="normal">${escapeHtml(t('settings.securityNormal'))}</option>
              <option value="strict">${escapeHtml(t('settings.securityStrict'))}</option>
              <option value="full">${escapeHtml(t('settings.securityFull'))}</option>
            </select>
            <span class="secMiaoShu" id="secMiaoShu"></span>
          </div>
          <p class="jingYin" style="margin:8px 0 0">${escapeHtml(t('settings.securityHint'))}</p>
        </div>
        <!-- ═══ ADR 004：功能 → 容器 ═══════════════════════════════════════
             ADR §3.2：主操作 =「查看本机已有容器」→ 列出本机**已有**的容器（含三态与不可用原因）；
             下方 =「常用容器安装说明」折叠区（折叠只显示名字，展开显示 收费/商用/系统/体积 + 官网四条链接）。
             列表数据来自主进程真探测（warmy:rongQiTanCe），不是写死的。 -->
        <div class="sheZhiSection sheZhiKa" id="rongQiKa">
          <h2>${escapeHtml(t('container.biaoTi'))}</h2>
          <p class="ctgDim">${escapeHtml(t('container.tiShi'))}</p>
          <div class="shiLiHang" style="align-items:center;gap:8px;flex-wrap:wrap">
            <button type="button" class="anNiuZhuYao" id="anNiuRongQiTanCe">${escapeHtml(t('container.probeBtn'))}</button>
            <button type="button" class="anNiuXiao" id="anNiuMsbAnZhuang">${escapeHtml(tOr('container.microsandbox.install', '安装 Microsandbox'))}</button>
            <button type="button" class="anNiuXiao" id="anNiuMsbXieZai" disabled title="${escapeHtml(tOr('container.microsandbox.uninstallDisabled', '未检测到已安装，不可卸载'))}">${escapeHtml(tOr('container.microsandbox.uninstall', '卸载 Microsandbox'))}</button>
            <span class="ctgDim" id="rongQiTanCeXiaoXi" data-probe-state="idle"></span>
          </div>
          <div class="jingYin" id="msbXuNiHuaTiShi" style="margin-top:4px"></div>
          <div class="jingYin" id="msbAnZhuangXiaoXi" style="margin-top:4px" data-msb-state="idle"></div>
          <div id="rongQiCta" class="ctgCta yinCang">${escapeHtml(t('container.guideFirstStep'))}</div>
          <div class="ctgZhaiYao" id="rongQiZhaiYao" data-summary="none"></div>
          <!-- 第十七批：**本机已有容器**与**镜像**也做成折叠块（与"常用容器安装说明"一致）：
               折叠时只有标题 + 一个箭头；展开后箭头翻转朝下，一眼看出能收起。 -->
          <details class="ctgShouQi ctgFold" id="rongQiExistingShouQi">
            <summary class="ctgFoldZhaiYao">
              <span class="ctgJianTou" aria-hidden="true"></span>
              <span class="ctgFoldBiaoTi">${escapeHtml(t('container.section.existing'))}</span>
              <span class="ctgDim" id="rongQiCountInline"></span>
              <span class="ctgDim">${escapeHtml(t('container.listTitleHint'))}</span>
            </summary>
            <div class="ctgShouQiTi">
              <div class="ctgLieBiaoHead"><span>${escapeHtml(t('container.listTitle'))}</span></div>
              <div id="rongQiLieBiao" class="ctgLieBiao" data-probe="none"></div>
              <div class="ctgDim" id="rongQiMissingNote"></div>
              <div class="ctgTiShiHe" id="rongQiTargetNote">
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.target.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.target.tiShi'))}</div>
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.mount.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.mount.ti'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.mount.perf'))}</div>
          </div>
            </div>
          </details>
          <!-- 镜像：同样折叠（标题 + 箭头） -->
          <details class="ctgShouQi ctgFold" id="rongQiImagesShouQi">
            <summary class="ctgFoldZhaiYao">
              <span class="ctgJianTou" aria-hidden="true"></span>
              <span class="ctgFoldBiaoTi">${escapeHtml(t('container.section.images'))}</span>
            </summary>
            <div class="ctgShouQiTi">
          <div class="ctgGuideHead">${escapeHtml(t('container.image.biaoTi'))}</div>
          <div class="ctgDim">${escapeHtml(t('container.image.why'))}</div>
          <div class="ctgDim">${escapeHtml(t('container.image.node'))}</div>
          <div class="ctgDim">${escapeHtml(t('container.image.sourcePending'))}</div>
          <div id="rongQiImages" class="ctgLieBiao"></div>
          <!-- 第八/九批：镜像按**项目技术栈**选 + 环境由用户自装 + 一键复制的安装提示词 -->
          <div class="ctgTiShiHe" id="rongQiImageStackScale">
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.image.stack.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.image.stack.nodeOnly'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.image.executorHost'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.image.stack.moreLater'))}</div>
            <div id="rongQiImageStacks" class="ctgLieBiao"></div>
          </div>
            </div>
          </details>
          <details class="ctgShouQi ctgFold" id="rongQiGuideShouQi">
            <summary class="ctgFoldZhaiYao">
              <span class="ctgJianTou" aria-hidden="true"></span>
              <span class="ctgFoldBiaoTi">${escapeHtml(t('container.guideCollapse'))}</span>
            </summary>
            <div class="ctgShouQiTi">
          <div class="ctgTiShiHe" id="rongQiHuanJingAnZhuang">
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.env.install.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.env.install.ti'))}</div>
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.env.install.persistTitle'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.env.install.persistBody'))}</div>
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.env.install.netTitle'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.env.install.netBody'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.env.install.noNodeForUs'))}</div>
          </div>
          <div class="ctgTiShiHe" id="rongQiAnZhuangPrompt">
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.env.prompt.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.env.prompt.tiShi'))}</div>
            <pre id="ctgAnZhuangPromptWenBen" class="ctgPromptWenBen" data-prompt-lang=""></pre>
            <div class="ctgDongZuoJiHang">
              <button type="button" class="anNiuXiao" id="anNiuCopyAnZhuangPrompt">${escapeHtml(t('container.env.prompt.copy'))}</button>
              <span class="ctgDim" id="ctgAnZhuangPromptXiaoXi" data-copy-state="idle"></span>
            </div>
          </div>
          <!-- 第八批：快照与回退点的关系（分层；不许声称"有容器回退点就更简单"） -->
          <div class="ctgTiShiHe" id="rongQiSnapshotNote">
            <div class="ctgTiShiBiaoTi">${escapeHtml(t('container.snapshot.biaoTi'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.snapshot.ti'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.snapshot.layerFiles'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.snapshot.layerEnv'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.snapshot.fingerprint'))}</div>
            <div class="ctgDim">${escapeHtml(t('container.snapshot.noClaim'))}</div>
          </div>
          <div class="ctgGuideHead">${escapeHtml(t('container.timing.biaoTi'))}</div>
          <div id="rongQiTimings" class="ctgDim"></div>
          <div class="ctgGuideHead">${escapeHtml(t('container.guideTitle'))}</div>
          <div class="ctgDim">${escapeHtml(t('container.guideHint'))}</div>
          <div id="rongQiGuide" class="ctgGuide"></div>
            </div>
          </details>
        </div>
        <div class="sheZhiSection" data-sec="plugin"><h2 style="color:var(--accent)">${escapeHtml(t('settings.tabPlugins'))}</h2></div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${escapeHtml(t('settings.chaJianJi'))}</h2>
          <div id="plugLieBiao" class="chaJianLieBiao"></div>
          <div class="shiLiHang" style="margin-top:6px;align-items:center">
            <button class="anNiuXiao" id="anNiuPlugAnZhuangFolder">${escapeHtml(t('settings.pluginInstallBrowse'))}</button>
          </div>
          <div class="jinengSaoMiaoKuai" style="margin-top:10px">
            <div class="jinengSaoMiaoBiaoTi">${escapeHtml(t('settings.pluginScanTitle'))}</div>
            <div id="plugSaoMiaoMuLuJi"></div>
            <div class="shiLiHang" style="margin-top:6px;align-items:center">
              <input id="plugSaoMiaoMuLuShuRu" style="flex:1;min-width:120px" placeholder="${escapeHtml(t('settings.skillsScanPlaceholder'))}"/>
              <button class="anNiuXiao" id="anNiuPlugSaoMiaoBrowse">${escapeHtml(t('settings.pickFolder'))}</button>
              <button class="anNiuXiao" id="anNiuPlugSaoMiaoTianJia">${escapeHtml(t('settings.skillsScanAdd'))}</button>
            </div>
            <div style="margin-top:6px">
              <button class="anNiuXiao" id="anNiuPlugSaoMiaoJianCha">${escapeHtml(t('settings.pluginScanCheck'))}</button>
              <button class="anNiuXiao" id="anNiuPlugSaoMiaoJiQi">${escapeHtml(t('settings.scanMachine'))}</button>
            </div>
            <div class="jingYin" id="plugSaoMiaoXiaoXi"></div>
          </div>
        </div>
        <!-- 内网同步 / 多节点组网 旧设置块已移除：功能由下方「组网设置」卡片承接。
             底层 IPC 通道 warmy:lan-* / warmy:mesh-* 保留为产品契约，仅去掉 UI 与死渲染代码。 -->
        <!-- R8：组网设置：混合公网地址列表（IP + 域名）+ 刷新本机/公网地址 + 逐条检测 + 开关（检测通过才能打开） -->
        <div class="sheZhiSection sheZhiKa" id="wangLuoKa" data-sec="func">
          <h2>${escapeHtml(t('net.biaoTi'))} <button type="button" class="anNiuXiao wangLuoHelpAnNiu" id="anNiuWangLuoHelp" aria-label="${escapeHtml(t('net.helpTitle'))}" title="${escapeHtml(t('net.helpTitle'))}">?</button></h2>
          <div id="wangLuoHelpHe" class="jingYin wangLuoHelpHe yinCang">${escapeHtml(t('net.helpBody'))}</div>
          <p class="jingYin" style="margin:0 0 10px">${escapeHtml(t('net.tiShi'))}</p>
          <div class="shiLiHang">
            <div class="field" style="max-width:120px"><label>${escapeHtml(t('net.port'))}</label><input id="wangLuoDuanKou" value="${escapeHtml(String(netState.addr.port || ''))}"/></div>
          </div>
          <!-- R13：端口**只是默认值 + 约定**，不是限制 —— 输入框永远可改（1–65535）。
               约定端口（开发/测试）在这里提示；实际绑上的端口由组网层事实驱动。
               data-convention / data-bound 是给验收脚本的稳定契约（不必解析文案）。 -->
          <div class="jingYin wangLuoDuanKouTiShi" id="wangLuoDuanKouTiShi" data-convention=""></div>
          <div class="jingYin wangLuoDuanKouBound" id="wangLuoDuanKouBound" data-bound=""></div>
          <!-- R13：**端口无法绑定**时在这里明确告知（端口号 + 底层错误码）+ 给出**可点选的建议**
               端口（点一下只填进输入框，不自动改端口、不替用户做主）。默认隐藏。 -->
          <div class="wangLuoDuanKouConflict yinCang" id="wangLuoDuanKouConflict" data-fail-port="" data-fail-code=""></div>
          <!-- 本机地址事实 + 刷新按钮（取代旧「自动填入本机地址」） -->
          <div class="shiLiHang" style="align-items:center;gap:8px;margin:6px 0">
            <div class="jingYin" id="wangLuoBenJiXinXi" style="flex:1;min-width:0"></div>
            <button type="button" class="anNiuXiao" id="anNiuWangLuoRefresh" title="${escapeHtml(t('net.refresh'))}">${escapeHtml(t('net.refresh'))}</button>
          </div>
          <!-- 附八.9 / 附八.3：连接阶梯档位 + 中继状态（全部走 i18n；未实现的档如实标「尚未实现」） -->
          <div class="wangLuoLadder" id="wangLuoLadder" data-sig=""></div>
          <!-- 公网地址列表：IP 与域名共用同一列表；标签只出现一次（修复旧双重渲染缺陷） -->
          <div style="margin-top:6px">
            <label class="wangLuoFuBiaoQian" id="wangLuoPublicLieBiaoBiaoQian">${escapeHtml(t('net.domainTitle'))}</label>
            <div id="wangLuoDomains"></div>
            <div style="margin-top:6px"><button class="anNiuXiao" id="anNiuWangLuoDomainTianJia">${escapeHtml(t('net.domainAdd'))}</button></div>
          </div>
          <div id="wangLuoEntryResults" class="wangLuoEntryResults"></div>
          <div class="shiLiHang" style="margin-top:10px;align-items:center">
            <button class="anNiuZhuYao" id="anNiuWangLuoDetect">${escapeHtml(t('net.detect'))}</button>
            <div id="wangLuoTanCeResult" style="flex:1;min-width:220px"></div>
          </div>
          <div class="wangLuoSwitchHang">
            <label class="wangLuoSwitch"><input type="checkbox" id="wangLuoSwitch" aria-label="${escapeHtml(t('net.switch'))}"/><span class="wangLuoSwitchTrack"></span></label>
            <span class="wangLuoSwitchBiaoQian">${escapeHtml(t('net.switch'))}</span>
            <span class="jingYin" id="wangLuoSwitchXiaoXi"></span>
          </div>
        </div>
        <div class="sheZhiSection sheZhiKa" id="peiZhiDataKa" data-sec="func">
          <h2>${escapeHtml(t('settings.dataTitle'))}</h2>
          <p class="jingYin">${escapeHtml(t('settings.dataHint'))}</p>
          <div id="peiZhiDataZhiBiaoJi" class="diagGrid"></div>
        </div>
        <div class="sheZhiSection sheZhiKa" data-sec="func">
          <h2>${escapeHtml(t('ctx.archive'))}</h2>
          <p class="jingYin">${escapeHtml(t('archive.tiShi'))}</p>
          <div id="yiGuiDangHe" class="jingYin">—</div>
        </div>
        <div class="sheZhiSection sheZhiKa" data-sec="model">
          <h2>${escapeHtml(tOr('settings.modelOptions', '模型选项'))}</h2>
          <p class="jingYin">${escapeHtml(t('settings.specialModelsHint'))}</p>
          <!-- 四类特殊模型统一成**调用链**形式：第一个=默认，可上移/下移/禁用；默认折叠，点开查看 -->
          <details class="moXianSuLian" id="smShouAsr">
            <summary>${escapeHtml(t('settings.asrModel'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="asr"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.asr', ''))}</div>
            <div id="smAsrLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouEmbed">
            <summary>${escapeHtml(t('settings.embeddingModel'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="embed"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.embed', ''))}</div>
            <div id="smEmbedLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouOrganizer">
            <summary>${escapeHtml(t('settings.organizerModel'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="organizer"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.organizer', ''))}</div>
            <div id="smOrganizerLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouTts">
            <summary>${escapeHtml(tOr('settings.ttsModel', '语音模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="tts"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.tts', ''))}</div>
            <div id="smTtsLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouFenLei">
            <summary>${escapeHtml(tOr('model.fenLei', '决策模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="fenLei"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.fenLei', ''))}</div>
            <div id="smFenLei"></div>
          </details>
          <details class="moXianSuLian" id="smShouImageUnd">
            <summary>${escapeHtml(tOr('settings.imageUndModel', '看图模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="imageUnd"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.imageUnd', ''))}</div>
            <div id="smImageUndLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouImage">
            <summary>${escapeHtml(tOr('settings.imageModel', '画图模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="image"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.image', ''))}</div>
            <div id="smImageLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouVideoUnd">
            <summary>${escapeHtml(tOr('settings.videoUndModel', '看视频模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="videoUnd"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.videoUnd', ''))}</div>
            <div id="smVideoUndLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouVideoGen">
            <summary>${escapeHtml(tOr('settings.videoGenModel', '做视频模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="videoGen"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.videoGen', ''))}</div>
            <div id="smVideoGenLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouRerank">
            <summary>${escapeHtml(tOr('settings.rerankModel', '嵌入重排'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="rerank"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.rerank', ''))}</div>
            <div id="smRerankLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouSafety">
            <summary>${escapeHtml(tOr('settings.safetyModel', '安全审核'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="safety"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.safety', ''))}</div>
            <div id="smSafetyLian"></div>
          </details>
          <details class="moXianSuLian" id="smShouTranslate">
            <summary>${escapeHtml(tOr('settings.translateModel', '翻译模型'))}<span class="jingYin moXianSuZhaiYao" data-zhaiyao="translate"></span></summary>
            <div class="jingYin" style="margin:6px 0">${escapeHtml(tOr('model.kindHint.translate', ''))}</div>
            <div id="smTranslateLian"></div>
          </details>
          <!-- WebGPU 测试与模型无关，已挪到「功能」分区（见下方 #webgpuKa） -->
          <button class="anNiuXiao" id="anNiuBaoCunTeShu">${escapeHtml(t('common.save'))}</button>
          <span class="jingYin" id="smXiaoXi"></span>
        </div>
        
        <div class="sheZhiSection sheZhiKa" data-sec="func">
          <h2>${escapeHtml(t('join.blacklistTitle'))}</h2>
          <div id="heiMingDanHe" class="jingYin">${escapeHtml(t('join.blacklistEmpty'))}</div>
        </div>
        <div class="sheZhiSection" data-sec="skill"><h2 style="color:var(--accent)">${escapeHtml(t('settings.tabSkills'))}</h2></div>
        <div class="sheZhiSection sheZhiKa" id="jinengJiKa">
          <h2>${escapeHtml(t('settings.skills'))}</h2>
          <p class="jingYin" style="margin:0 0 8px">${escapeHtml(t('settings.skillsHint'))}</p>
          <div style="margin-bottom:8px"><button class="anNiuXiao" id="anNiuJinengDaoRu">${escapeHtml(t('settings.skillsImport'))}</button></div>
          <div class="jinengSaoMiaoKuai">
            <div class="jinengSaoMiaoBiaoTi">${escapeHtml(t('settings.skillsScanTitle'))}</div>
            <div class="jingYin">${escapeHtml(t('settings.skillsScanHint'))}</div>
            <div id="jinengSaoMiaoMuLuJi"></div>
            <div class="shiLiHang" style="margin-top:6px;align-items:center">
              <input id="jinengSaoMiaoMuLuShuRu" class="skill-scan-input" placeholder="${escapeHtml(t('settings.skillsScanPlaceholder'))}" style="flex:1;min-width:120px"/>
              <button class="anNiuXiao" id="anNiuJinengSaoMiaoBrowse">${escapeHtml(t('settings.pickFolder'))}</button>
              <button class="anNiuXiao" id="anNiuJinengSaoMiaoTianJia">${escapeHtml(t('settings.skillsScanAdd'))}</button>
            </div>
            <div style="margin-top:6px">
              <button class="anNiuXiao" id="anNiuJinengSaoMiaoJianCha">${escapeHtml(t('settings.skillsScanCheck'))}</button>
              <button class="anNiuXiao" id="anNiuJinengSaoMiaoJiQi">${escapeHtml(t('settings.scanMachine'))}</button>
            </div>
            <div class="jingYin" id="jinengSaoMiaoXiaoXi"></div>
          </div>
          <div id="jinengLieBiao" class="jingYin">${escapeHtml(t('settings.skillsEmpty'))}</div>
          <div class="jingYin jinengLuJingJi" id="jinengLuJingJi"></div>
        </div>
        <div class="sheZhiSection sheZhiKa" id="webgpuKa">
          <h2>${escapeHtml(tOr('webgpu.section', '图形加速（WebGPU）'))}</h2>
          <p class="jingYin">${escapeHtml(tOr('webgpu.hint', '检测本机是否支持 WebGPU（与模型无关）。'))}</p>
          <div style="margin-top:8px"><button class="anNiuXiao" id="anNiuwebgpu">${escapeHtml(t('webgpu.test'))}</button> <span class="jingYin" id="webgpuXiaoXi"></span></div>
        </div>
        <div class="sheZhiSection sheZhiKa" id="yinDaoKa">
          <h2>${escapeHtml(tOr('guide.section', '新手引导'))}</h2>
          <p class="jingYin">${escapeHtml(tOr('guide.sectionHint', '第一次用的三步指引；随时可以再看一遍。'))}</p>
          <div class="shiLiHang" style="margin-top:8px"><button type="button" class="anNiuXiao" id="anNiuChongKanYinDao">${escapeHtml(tOr('guide.restart', '重新查看引导'))}</button></div>
        </div>
        <!-- R2「快捷」：**键盘快捷键在前**，AI/IPC 接口目录在后 -->
        <div class="sheZhiSection" data-sec="hotkey"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.hotkey'))}</h2></div>
        <div class="sheZhiSection sheZhiKa" id="hkMiYaoJiKa">
          <h2>${escapeHtml(t('settings.hotkey.keyTitle'))}</h2>
          <p class="hkTiShi">${escapeHtml(t('settings.hotkey.keyHint'))}</p>
          <p class="hkTiShi">${escapeHtml(t('settings.hotkey.onlyWired'))}</p>
          <table class="hkMiYaoJi">
            <thead><tr><th>${escapeHtml(t('settings.hotkey.colAction'))}</th><th>${escapeHtml(t('settings.hotkey.colBinding'))}</th><th>${escapeHtml(t('settings.hotkey.colDesc'))}</th></tr></thead>
            <tbody id="hkMiYaoJiTi"></tbody>
          </table>
          <div class="hkXiaoXi" id="hkMiYaoJiXiaoXi"></div>
        </div>
        <div class="sheZhiSection sheZhiKa" id="hkapiKa">
          <h2>${escapeHtml(t('settings.hotkey.apiTitle'))}</h2>
          <p class="hkTiShi">${escapeHtml(t('settings.hotkey.apiHint'))}</p>
          <div class="hkCount" id="hkapiCount"></div>
          <div style="margin:6px 0">
            <button class="anNiuXiao" id="anNiuCopyapiOps">${escapeHtml(t('settings.hotkey.apiCopyOps') || 'Copy AI guide')}</button>
            <span class="jingYin" id="apiCopyXiaoXi"></span>
          </div>
          <input class="hkFilter" id="hkapiFilter" placeholder="${escapeHtml(t('settings.hotkey.apiFilter'))}"/>
          <div id="hkapiTi"></div>
          <div class="hkapiShiJianJi" id="hkapiShiJianJi"></div>
        </div>
        <div class="sheZhiSection sheZhiKa" data-sec="mimic">
          <h2>${escapeHtml(tOr('settings.mimic', '拟态'))}</h2>
          <div class="jingYin">${escapeHtml(tOr('settings.mimicHint', '（预留）拟态相关设置将在此处提供。'))}</div>
        </div>
        <!--
          关于分区：**标题必须紧贴在内容之前**。
          分区归属靠「最后一个带 data-sec 的元素」往后归并（见 bindSettingsMenu），
          所以空标题留在前面、内容没有 data-sec 时，整块关于内容会被算进**拟态**里
          （真事故：点「关于」是空的，内容却出现在「拟态」下面）。
        -->
        <div class="sheZhiSection" data-sec="about"><h2 style="color:var(--accent)">${escapeHtml(t('settings.section.about'))}</h2></div>
        <div class="sheZhiSection sheZhiKa aboutKa">
          <div class="aboutPinPai">
            <img class="aboutlogo" src="./icons/logo-tight.png" alt="${escapeHtml(t('about.logoAlt'))}"/>
            <div class="aboutPinPaiWenBen">
              <div class="aboutMing">${escapeHtml(t('brand.name'))}</div>
              <div class="aboutFu">${escapeHtml(t('brand.fu'))}</div>
              <div class="aboutTagline">${escapeHtml(t('brand.tagline') || t('about.tagline'))}</div>
              <div class="aboutVerXian">
                <span class="jingYin aboutVer" id="aboutVersion">—</span>
                <button class="anNiuXiao" id="anNiuAboutGengXin">${escapeHtml(t('about.checkUpdate'))}</button>
                <span class="jingYin" id="aboutUpd"></span>
              </div>
            </div>
          </div>
          <div class="aboutKuai">
            <h3>${escapeHtml(t('about.versionInfo'))}</h3>
            <div class="jingYin" id="aboutRuntime">—</div>
            <div class="jingYin" id="aboutDevice">—</div>
            <div class="jingYin" id="aboutBeliefPath" style="margin-top:4px;word-break:break-all">—</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="anNiuXiao" id="anNiuDaoChuSheZhi">${escapeHtml(tOr('settings.exportJson', '导出配置（.NM）'))}</button>
              <button class="anNiuXiao" id="anNiuDaoRuSheZhi">${escapeHtml(tOr('settings.importNm', '导入配置（.NM）'))}</button>
              <button class="anNiuXiao" id="anNiuHuiFuMoRen">${escapeHtml(tOr('settings.restoreDefaults', '恢复默认设置'))}</button>
              <button class="anNiuXiao" id="anNiuDaKaiRiZhi">${escapeHtml(tOr('settings.openLog', '打开启动日志'))}</button>
            </div>
          </div>
          <div class="aboutKuai">
            <h3>${escapeHtml(t('privacy.viewTitle'))}</h3>
            <div class="yinSiShiTu" id="aboutYinSiShiTu">${privacyHtml(t('privacy.ti'))}</div>
            <div style="margin-top:8px">
              <button class="anNiuXiao" id="anNiuYinSiCheXiao">${escapeHtml(t('privacy.revoke'))}</button>
              <span class="jingYin" id="yinSiCheXiaoXiaoXi"></span>
            </div>
          </div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.opensource'))}</h3><p class="jingYin">${escapeHtml(t('about.opensourceBody'))}</p></div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.techStack'))}</h3><p class="jingYin">${escapeHtml(t('about.techStackBody'))}</p></div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.copyright'))}</h3><p class="jingYin">${escapeHtml(t('about.copyrightBody'))}</p></div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.author'))}</h3><p class="jingYin">${escapeHtml(t('about.authorBody'))}</p></div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.contact'))}</h3><p class="jingYin">${escapeHtml(t('about.contactBody'))}</p></div>
          <div class="aboutKuai"><h3>${escapeHtml(t('about.legal'))}</h3><p class="jingYin">${escapeHtml(t('about.legalBody'))}</p></div>
        </div></div></div>`;

      // 更新源 UI 已从「关于」移除（产品要求）。设置项 updateFeedUrl 仍然生效：
      // 可由 settings.json / 环境变量 WARMY_UPDATE_FEED_URL / IPC updateSourceSet 写入。
      // 这里不再渲染入口，也不再调用 updateSourceGet/Set。
      /** 有更新时：按钮变成「开始更新」，点下去下载；无更新/未配置：保持「检查更新」 */
      let __updAvail = null;
      async function applyUpdateUi(r) {
        const yuanSu = $('aboutUpd');
        const btn = $('anNiuAboutGengXin');
        __updAvail = r && r.status === 'update-available' ? r : null;
        if (__updAvail) {
          if (btn) btn.textContent = t('about.startUpdate');
          if (yuanSu) {
            const latest = __updAvail.latestVersion || __updAvail.latest || '';
            yuanSu.textContent = latest
              ? (t('update.status.latestIs') + ' ' + latest)
              : t('update.status.available');
          }
        } else {
          if (btn) btn.textContent = t('about.checkUpdate');
          if (yuanSu) yuanSu.textContent = updateStatusText(r);
        }
      }
      async function doCheckUpdate(fromAuto) {
        const yuanSu = $('aboutUpd');
        if (yuanSu && !fromAuto) yuanSu.textContent = t('about.checking');
        const r = await window.warmy.checkUpdate().catch(() => null);
        // 自动检查失败时不要打扰（不弹窗）；界面若在关于页则仍更新文案
        if (r && r.status === 'update-available') await applyUpdateUi(r);
        else if (!fromAuto || (r && (r.status === 'up-to-date' || r.status))) await applyUpdateUi(r);
        return r;
      }
      $('anNiuAboutGengXin').onclick = async () => {
        if (__updAvail) {
          const yuanSu = $('aboutUpd');
          if (yuanSu) yuanSu.textContent = t('about.updating');
          const d = await window.warmy.autoUpdateDownload?.().catch(() => null)
            || await window.warmy.checkUpdate?.().catch(() => null);
          if (yuanSu) yuanSu.textContent = d?.ok === false
            ? (t('update.status.networkError'))
            : (t('about.updateStarted') + (d?.path || d?.file || d?.version ? ' · ' + (d.path || d.file || d.version) : ''));
          return;
        }
        await doCheckUpdate(false);
      };
      // 导出配置（`.NM`，带口令） / 导入配置（全新开始 / 合并）
      $('anNiuDaoChuSheZhi')?.addEventListener('click', async () => {
        try {
          const pw = await uiPrompt(tOr('nm.setExportPassword', '请设置导出口令（导入时必须输入）'), '');
          if (pw === null) return;
          if (!pw.trim()) { uiAlert(tOr('nm.needPassword', '口令不能为空：导出时必须设置口令。')); return; }
          const r = await window.warmy.peizhiDaoChu?.({ password: pw.trim() });
          if (r && r.ok) showToast(tOr('export.done', '已导出') + '：' + (r.path || ''));
          else showToast(String((r && r.error) || t('common.error')));
        } catch (e) { showToast(String(e && e.message || e)); }
      });
      (function bindPeizhiDaoRu() {
        const btn = $('anNiuDaoRuSheZhi');
        if (!btn) return;
        btn.onclick = async () => {
          try {
            const f = await window.warmy.pickFile?.({ filters: [{ name: 'WArmy 配置', extensions: ['NM', 'nm', 'json'] }] });
            if (!f?.ok || !f.path) return;
            const xin = await window.warmy.peizhiXinFeng?.({ path: f.path });
            if (!xin || !xin.ok) { uiAlert(String((xin && xin.error) || tOr('nm.badFormat', '不是 WArmy 的 .nm 文件，或文件已损坏'))); return; }
            // 模式选择：全新开始（要二次确认） / 合并配置（冲突逐项问）
            const moShi = await uiConfirm(
              tOr('nm.freshConfirm', '要「全新开始」吗？\n确定 = 删除当前全部配置后导入（不可撤销）\n取消 = 合并配置（有冲突会逐项问你）'),
              tOr('nm.importMode', '导入配置')
            );
            const mode = moShi ? 'fresh' : 'merge';
            if (mode === 'fresh') {
              const erCi = await uiConfirm(tOr('nm.freshConfirm2', '再次确认：将删除当前所有配置（含供应商、牛马、聊天设置），并用导入包替换。此操作不可撤销！'));
              if (!erCi) return;
            }
            const pw = await uiPrompt(tOr('nm.enterPassword', '请输入导出时设置的口令'), '');
            if (pw === null) return;
            const r = await window.warmy.peizhiDaoRu?.({ path: f.path, password: pw, mode });
            if (r && r.ok) {
              showToast(tOr('nm.importDone', '导入完成') + '（' + (r.applied ? r.applied.length : 0) + '）');
              setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 700);
            } else {
              uiAlert(String((r && r.error) || t('common.error')));
            }
          } catch (e) { uiAlert(String(e && e.message || e)); }
        };
      })();
      $('anNiuHuiFuMoRen')?.addEventListener('click', async () => {
        if (!(await uiConfirm(tOr('settings.restoreConfirm', '将清空所有设置并恢复出厂默认（含供应商/密钥引用/外观）。此操作不可撤销。是否继续？')))) return;
        try {
          await window.warmy.settingsSave?.({ restoreDefaults: true });
          showToast(tOr('settings.restored', '已恢复默认设置'));
          setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 600);
        } catch (e) { uiAlert(String(e && e.message || e)); }
      });
      $('anNiuDaKaiRiZhi')?.addEventListener('click', async () => {
        try {
          const lu = (window.warmy.zuiGaoXinNianDu ? (await window.warmy.zuiGaoXinNianDu()) : null)?.path || '';
          const logLu = lu ? lu.replace(/agents\.md$/i, 'warmy-boot.log') : '';
          const r = await window.warmy.daKaiLuJing?.({ path: logLu });
          if (!r || r.ok === false) showToast(String((r && r.error) || tOr('settings.logMissing', '日志文件不存在')));
        } catch (e) { showToast(String(e && e.message || e)); }
      });
      (async () => {
        try {
          const info = await window.warmy.appInfo();
          if (!info?.ok) return;
          const v = $('aboutVersion');
          if (v) v.textContent = `${escapeHtml(t('about.version'))} ${info.version}`;
          const rt = $('aboutRuntime');
          const dshLine = info.dsh
            ? ` · dsh ${info.dsh}`
            : ` · dsh ${escapeHtml(t('about.dshMissing'))}`;
          if (rt) rt.textContent =
            `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}${dshLine} · ${info.platform}/${info.arch}`;
          const dv = $('aboutDevice');
          // 产品要求：关于-版本信息**不显示设备 ID**
          if (dv) dv.textContent = `${escapeHtml(t('about.version'))} ${info.version || ''} · ${info.platform || ''}/${info.arch || ''}` + (info.dsh ? ` · dsh ${info.dsh}` : '');
          // agents.md 路径（最高信念文件）
          try {
            const zg = await window.warmy.zuiGaoXinNianDu?.();
            const lu = $('aboutBeliefPath');
            if (lu && zg && zg.path) lu.textContent = tOr('wo.beliefFile', '文件') + '：' + zg.path;
          } catch { /* noop */ }
        } catch { /* noop */ }
        // 启动时自动检测更新（不打断：只在有更新时改按钮）
        try { await doCheckUpdate(true); } catch { /* noop */ }
      })();
      // 记忆系统状态（产品重点：JSONL + FTS + 向量；未就绪如实显示）
      (async () => {
        const yuanSu = $('aboutJiYi');
        const xiaoXi = $('aboutJiYiXiaoXi');
        const btn = $('anNiuJiYiChongJian');
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
          yuanSu.textContent = `${line1} · ${escapeHtml(t('memory.vector'))}: ${vecText} · ${escapeHtml(t('memory.records'))}: ${recText}`;
        };
        try {
          const st = await window.warmy.memoryStatus?.();
          xuanranJiyi(st);
        } catch (e) {
          if (yuanSu) yuanSu.textContent = t('memory.notReady');
        }
        if (btn) {
          btn.onclick = async () => {
            if (xiaoXi) xiaoXi.textContent = '';
            const r = await window.warmy.memoryRebuild?.().catch((e) => ({ ok: false, error: String(e) }));
            if (xiaoXi) xiaoXi.textContent = r?.ok ? t('memory.rebuildOk') : `${escapeHtml(t('memory.rebuildFail'))}${r?.error ? ' · ' + r.error : ''}`;
            try { xuanranJiyi(await window.warmy.memoryStatus?.()); } catch { /* noop */ }
          };
        }
      })();

      // 设置：第二列是菜单，第三列只显示对应板块
      (function bindSettingsMenu() {
        const neirongYuansu = $('peiZhiNeiRong');
        if (!neirongYuansu) return;
        // 设置页搜索：按文案过滤卡片（标题/正文命中即显示）
        (function bindSettingsSearch() {
          const souSuo = $('peiZhiSouSuo');
          if (!souSuo || souSuo.dataset.bound) return;
          souSuo.dataset.bound = '1';
          souSuo.addEventListener('input', () => {
            const q = String(souSuo.value || '').trim().toLowerCase();
            Array.from(neirongYuansu.querySelectorAll('.sheZhiKa')).forEach((ka) => {
              if (!q) { ka.style.display = ''; return; }
              const txt = (ka.textContent || '').toLowerCase();
              ka.style.display = txt.includes(q) ? '' : 'none';
            });
          });
        })();
        const secIds = ['ui', 'notify', 'model', 'func', 'skill', 'plugin', 'hotkey', 'about', 'mimic'];
        // skill 与 jineng 是同一分区的两种历史键名 —— 必须别名到同一数组
        const skillBucket = [];
        const groups = { ui: [], notify: [], model: [], func: [], plugin: [], hotkey: [], about: [], mimic: [] };
        groups['skill'] = skillBucket;
        groups['jineng'] = skillBucket;
        let curSec = 'ui';
        Array.from(neirongYuansu.children).forEach((yuanSu) => {
          const ds = yuanSu.getAttribute && yuanSu.getAttribute('data-sec');
          if (ds) curSec = ds === 'jineng' ? 'skill' : ds;
          if (groups[curSec]) groups[curSec].push(yuanSu);
        });
        const navBtns = Array.from(document.querySelectorAll('#peiZhiDaoHang button'));
        const showSec = (s) => {
          const key = s === 'jineng' ? 'skill' : s;
          settingsSection = key;   // 记住当前分区：renderPage() 后要回到这里
          secIds.forEach((k) => (groups[k] || []).forEach((yuanSu) => {
            const show = (k === key);
            yuanSu.style.display = show ? '' : 'none';
            // 同步 yinCang，避免 CSS !important 把 display:none 顶掉
            yuanSu.classList.toggle('yinCang', !show);
          }));
          navBtns.forEach((b) => b.classList.toggle('qiYong', b.dataset.sec === key || b.dataset.sec === s));
        };
        navBtns.forEach((btn) => { btn.onclick = () => { showSec(btn.dataset.sec); if (btn.dataset.sec === 'model') { try { tianChongYuSheXiaLa(); } catch { /* noop */ } } }; });
        /**
         * 以前这里写死 showSec('ui')：只要点了「添加供应商 / 拉取模型」之类的按钮，
         * 处理函数内部会 renderPage() 整页重渲染 ⇒ 分区被打回 'ui'，
         * 用户看到的就是"点一下就被弹回设置首页"。
         * 现在改为恢复到用户当前所在分区（点击导航栏时记录）。
         */
        showSec(settingsSection);
        // 快捷键 + AI 接口目录：必须在此调用，否则表是空的
        try { bindHotkeySection(); } catch { /* noop */ }
      })();


      // 通知音「试听」：主进程给 data URL（用户没选就用内置默认音效）
      document.querySelectorAll('[data-try]').forEach((b) => {
        b.onclick = async () => {
          const ok = await chuanBoYinXiao(b.getAttribute('data-try'));
          if (ok === false) showToast(tOr('sound.tryFail', '试听失败：音频文件缺失或不可播放'));
        };
      });
      // 通知音量滑块
      (function bindSoundVolume() {
        const sl = $('soundVolume');
        const lab = $('soundVolumeVal');
        if (!sl || sl.dataset.bound) return;
        sl.dataset.bound = '1';
        sl.oninput = () => {
          const v = Number(sl.value) / 100;
          state.soundVolume = v;
          if (lab) lab.textContent = sl.value + '%';
        };
        sl.onchange = () => {
          try { window.warmy.settingsSave?.({ soundVolume: state.soundVolume }); } catch { /* noop */ }
        };
      })();
      // Microsandbox：两按钮状态机（安装/重装 + 卸载）
      // 探测到已装或点过「查看本机已有容器」且已装 ⇒ 安装钮变「重新安装」，卸载钮可用
      (function bindMsbAnZhuang() {
        if (window.__msbInstallDelegated) return;
        window.__msbInstallDelegated = 1;

        const shuaXinXuNiHua = async () => {
          const tip = $('msbXuNiHuaTiShi');
          if (!tip) return;
          try {
            const v = await window.warmy.microsandboxVirt?.();
            if (!v) { tip.textContent = ''; return; }
            if (v.ok) {
              tip.textContent = tOr('container.microsandbox.virtOk', '虚拟化前提已满足');
              tip.style.color = '#1a7f37';
              tip.style.fontWeight = '';
            } else {
              tip.textContent = tOr('container.microsandbox.virtNeed', '虚拟化前提未满足') + '：' + (v.howTo || '');
              tip.style.color = '#b45309';
              tip.style.fontWeight = '600';
            }
          } catch { tip.textContent = ''; }
        };

        /** installed=true ⇒ 安装钮=重新安装，卸载钮可用 */
        const sheZhiAnNiu = (installed) => {
          const btnI = $('anNiuMsbAnZhuang');
          const btnU = $('anNiuMsbXieZai');
          if (btnI) {
            btnI.textContent = installed
              ? tOr('container.microsandbox.reinstall', '重新安装 Microsandbox')
              : tOr('container.microsandbox.install', '安装 Microsandbox');
            btnI.dataset.mode = installed ? 'reinstall' : 'install';
            btnI.disabled = false;
          }
          if (btnU) {
            // 未确认已装 ⇒ 灰掉，不可点
            btnU.disabled = !installed;
            btnU.title = installed ? '' : tOr('container.microsandbox.uninstallDisabled', '未检测到已安装，不可卸载');
          }
        };
        window.__msbSheZhiAnNiu = sheZhiAnNiu;

        /** 探测是否已装（查用户目录 + 运行时报告） */
        const tanCeShiFouAnZhuang = async () => {
          try {
            const st = await window.warmy.microsandboxStatus?.();
            return !!(st && st.ok);
          } catch { return false; }
        };
        window.__msbTanCeShiFouAnZhuang = tanCeShiFouAnZhuang;

        /** 进度行 */
        const jinDu = (text, kind) => {
          const x = $('msbAnZhuangXiaoXi');
          if (!x) return;
          x.textContent = text;
          x.dataset.msbState = kind || 'busy';
          x.style.color = kind === 'ok' ? '#1a7f37' : kind === 'err' ? '#b91c1c' : '';
          x.style.fontWeight = kind === 'busy' ? '' : '600';
        };

        /** 至少 minMs 的分步动画（卸载→下载→安装→检测） */
        const dongHuaChongZhuang = async (run, minMs) => {
          const buZhou = [
            [tOr('container.microsandbox.stepCheck', '正在检测本机是否已安装…'), 300],
            [tOr('container.microsandbox.stepUninstall', '正在卸载旧版…'), 400],
            [tOr('container.microsandbox.stepDownload', '正在下载…'), 400],
            [tOr('container.microsandbox.stepInstall', '正在安装…'), 300],
            [tOr('container.microsandbox.stepDetect', '正在检测安装结果…'), 200],
          ];
          const t0 = Date.now();
          let i = 0;
          jinDu(buZhou[0][0], 'busy');
          const tick = async () => {
            if (i < buZhou.length) {
              const [txt] = buZhou[i];
              i += 1;
              jinDu(txt, 'busy');
              await new Promise((r) => setTimeout(r, 450));
            }
          };
          const anim = (async () => {
            while (i < buZhou.length) await tick();
          })();
          const work = run();
          await Promise.all([anim, work]);
          const elapsed = Date.now() - t0;
          if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
          return work;
        };

        document.addEventListener('click', async (e) => {
          if (window.__msbBusy) return;
          const target = e.target && e.target.closest ? e.target : null;
          const isInstall = target && target.closest('#anNiuMsbAnZhuang');
          const isUninstall = target && target.closest('#anNiuMsbXieZai');
          if (!isInstall && !isUninstall) return;
          e.preventDefault();
          window.__msbBusy = 1;
          try {
            if (isUninstall) {
              jinDu(tOr('container.microsandbox.uninstalling', '正在卸载 Microsandbox…'), 'busy');
              const r = await window.warmy.microsandboxUninstall?.().catch((err) => ({ ok: false, error: String(err) }));
              jinDu(
                r?.ok
                  ? tOr('container.microsandbox.uninstallOk', 'Microsandbox 已卸载')
                  : (tOr('container.microsandbox.uninstallFail', 'Microsandbox 卸载失败') + (r?.error || r?.err ? ' · ' + String(r.error || r.err).slice(0, 140) : '')),
                r?.ok ? 'ok' : 'err',
              );
              sheZhiAnNiu(false);
              await shuaXinXuNiHua();
              return;
            }
            // 安装 / 重新安装
            const mode = (isInstall && isInstall.dataset.mode) || 'install';
            const chongZhuang = mode === 'reinstall';
            const result = await dongHuaChongZhuang(async () => {
              return await window.warmy.microsandboxInstall?.({ force: chongZhuang }).catch((err) => ({ ok: false, error: String(err) }));
            }, 1500);
            const r = await result;
            const detail = (r && (r.err || r.error || '')) ? ' · ' + String(r.err || r.error).slice(0, 160) : '';
            jinDu(
              r?.ok
                ? ((chongZhuang ? tOr('container.microsandbox.reinstallOk', 'Microsandbox 重新安装成功') : tOr('container.microsandbox.installOk', 'Microsandbox 安装成功')) + (r?.version ? ' · ' + r.version : ''))
                : (tOr('container.microsandbox.installFail', 'Microsandbox 安装失败') + detail),
              r?.ok ? 'ok' : 'err',
            );
            const nowInstalled = r?.ok ? true : await tanCeShiFouAnZhuang();
            sheZhiAnNiu(nowInstalled);
            await shuaXinXuNiHua();
          } finally {
            window.__msbBusy = 0;
          }
        });

        // 立即按当前是否已装初始化按钮（未装 ⇒ 卸载钮灰）；虚拟化提示稍后刷
        const tongBuChuShi = async () => {
          const installed = await tanCeShiFouAnZhuang();
          sheZhiAnNiu(installed);
          await shuaXinXuNiHua();
        };
        void tongBuChuShi();
        setTimeout(() => { void tongBuChuShi(); }, 400);
        window.__msbTongBuChuShi = tongBuChuShi;
      })();

      // dsh：一键安装 / 状态检查（PC 必装；未装时如实提示）
      (function bindDshAnZhuang() {
        const st = $('dshZhuangTaiWenBen');
        const xiaoXi = $('dshAnZhuangXiaoXi');
        // 程序启动/进入设置时立即显示安装状态
        const shuaXin = async () => {
          try {
            const r = await window.warmy.dshStatus();
            xuanran(r);
          } catch { xuanran(null); }
        };
        setTimeout(() => { void shuaXin(); }, 300);
        // 启动即探测一次（设置页打开时也会刷）
        setTimeout(() => { try { void (typeof jianCha === 'function' ? jianCha() : null); } catch { /* noop */ } }, 800);
        const xuanran = (r) => {
          if (!st) return;
          st.classList.remove('isChecking', 'isOk', 'isBad', 'isErr');
          const btn = $('anNiuDshAnZhuang');
          if (r && r.ok) {
            st.textContent = tOr('dsh.yiAnZhuang', '已安装') + (r.version ? ' · ' + r.version : '');
            st.classList.add('isOk');
            if (btn) {
              btn.textContent = tOr('dsh.chongXinAnZhuang', '重新安装 dsh');
              btn.dataset.installed = '1';
            }
          } else {
            st.textContent = tOr('dsh.weiAnZhuang', '未安装');
            st.classList.add('isBad');
            if (btn) {
              btn.textContent = tOr('dsh.anZhuang', '一键安装 dsh');
              btn.dataset.installed = '0';
            }
          }
        };
        const jianCha = async (opts = {}) => {
          const { withAnim = false } = opts;
          if (xiaoXi) xiaoXi.textContent = '';
          const t0 = Date.now();
          const MIN_MS = 1300;
          const TIMEOUT_MS = 15000;
          if (withAnim && st) {
            st.classList.remove('isOk', 'isBad', 'isErr');
            st.classList.add('isChecking');
            st.textContent = tOr('dsh.jianChaZhong', '正在检查 dsh…');
          }
          const withTimeout = (p, ms) => Promise.race([
            p,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
          ]);
          let r = null;
          let err = null;
          try {
            r = await withTimeout(
              window.warmy.dshStatus?.() ?? Promise.resolve(null),
              TIMEOUT_MS,
            );
            if (!r || !r.ok) {
              r = await withTimeout(
                window.warmy.dshAvailable?.() ?? Promise.resolve(null),
                TIMEOUT_MS,
              );
            }
          } catch (e) {
            err = e;
          }
          // 检查动画至少 3 秒，避免一闪而过
          if (withAnim) {
            const elapsed = Date.now() - t0;
            if (elapsed < MIN_MS) await new Promise((res) => setTimeout(res, MIN_MS - elapsed));
          }
          if (st) st.classList.remove('isChecking');
          if (err) {
            if (st) {
              st.classList.remove('isOk', 'isBad');
              st.classList.add('isErr');
              const kind = String(err && err.message) === 'timeout'
                ? tOr('dsh.jianChaChaoShi', '检查超时，无法检测')
                : tOr('dsh.jianChaYiChang', '检查异常，无法检测');
              st.textContent = kind;
            }
            return null;
          }
          xuanran(r);
          return r;
        };
        // 委托：renderPage 重建按钮后仍可点
        const yiAnZhuangTiShi = (now) => {
          const ver = now && now.version ? ' · ' + now.version : '';
          return tOr('dsh.yiAnZhuang', '已安装') + ver + ' · ' + tOr('dsh.alreadyInstalled', '已安装，无需重复安装');
        };
        const zhiXingAnZhuang = async () => {
          const x = $('dshAnZhuangXiaoXi');
          if (window.__dshBusy) return;
          window.__dshBusy = 1;
          try {
            let already = false;
            try {
              const now = await window.warmy.dshStatus?.().catch(() => null);
              already = !!(now && now.ok);
            } catch { /* fall through */ }
            if (x) {
              x.textContent = already
                ? tOr('dsh.chongXinAnZhuangZhong', '正在重新安装 dsh…')
                : tOr('dsh.anZhuangZhong', '正在安装 dsh…');
              x.style.color = '';
              x.style.fontWeight = '';
            }
            // 任何参数形态都要装上（兼容不接 opts 的旧桥）
            let r = null;
            try {
              r = await window.warmy.dshInstall?.({ force: true });
            } catch (e1) {
              try { r = await window.warmy.dshInstall?.(); } catch (e2) {
                r = { ok: false, error: String(e1 || e2) };
              }
            }
            if (x) {
              x.textContent = r?.ok
                ? (already ? tOr('dsh.chongXinChengGong', '重新安装成功') : tOr('dsh.anZhuangChengGong', '安装成功'))
                : (tOr('dsh.anZhuangShiBai', '安装失败') + (r?.error ? ' · ' + String(r.error).slice(0, 120) : ''));
              x.style.color = r?.ok ? '#1a7f37' : '#b45309';
              x.style.fontWeight = '600';
            }
            if (typeof window.__dshJianCha === 'function') await window.__dshJianCha();
          } finally {
            window.__dshBusy = 0;
          }
        };
        window.__dshZhiXingAnZhuang = zhiXingAnZhuang;
        window.__dshJianCha = jianCha;
        // 只走委托（renderPage 重建按钮后仍可点），并用 btn 变量避免遮蔽 i18n 的 t()
        if (!window.__dshBtnDelegated) {
          window.__dshBtnDelegated = 1;
          document.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest && e.target.closest('#anNiuDshJianCha');
            if (btn) {
              e.preventDefault();
              void (window.__dshJianCha || jianCha)({ withAnim: true });
            }
          });
          document.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest && e.target.closest('#anNiuDshAnZhuang');
            if (btn) {
              e.preventDefault();
              void (window.__dshZhiXingAnZhuang || zhiXingAnZhuang)();
            }
          });
        }
        void jianCha();
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
          document.querySelectorAll('#tongZhiYouJianKa [data-email-k], #smtpYouJianNotify2 [data-email-k]').forEach((yuanSu) => {
            emailNotify[yuanSu.dataset.emailK] = !!yuanSu.checked;
          });
          // sound checkboxes
          const sound = {
            complete: !!$('sWanCheng')?.checked,
            request: !!$('sQingQiu')?.checked,
            error: !!$('sCuoWu')?.checked,
          };
          return { emailNotify, sound };
        };
        $('anNiuTongZhiApply')?.addEventListener('click', async () => {
          const f = readForm();
          state.emailNotify = f.emailNotify;
          state.sound = f.sound;
          await window.warmy.settingsSave({ emailNotify: f.emailNotify, sound: f.sound }).catch(() => {});
          backup = snap();
          const m = $('tongZhiApplyXiaoXi');
          if (m) m.textContent = t('settings.notifyApplied');
        });
        $('anNiuTongZhiCancel')?.addEventListener('click', () => {
          state.sound = backup.sound;
          state.soundFiles = backup.soundFiles;
          state.emailNotify = backup.emailNotify;
          if ($('sWanCheng')) $('sWanCheng').checked = !!backup.sound.complete;
          if ($('sQingQiu')) $('sQingQiu').checked = !!backup.sound.request;
          if ($('sCuoWu')) $('sCuoWu').checked = !!backup.sound.error;
          document.querySelectorAll('[data-email-k]').forEach((yuanSu) => {
            yuanSu.checked = !!(backup.emailNotify && backup.emailNotify[yuanSu.dataset.emailK]);
          });
          window.warmy.settingsSave({ emailNotify: backup.emailNotify, sound: backup.sound }).catch(() => {});
          const m = $('tongZhiApplyXiaoXi');
          if (m) m.textContent = '';
        });
        // 打开设置页时备份当前生效值
        backup = snap();
      })();

      // 隐私政策：关于页撤销
      $('anNiuYinSiCheXiao')?.addEventListener('click', async () => {
        if (!(await uiConfirm(t('privacy.revokeConfirm')))) return;
        await window.warmy.privacyConsentSet?.(false).catch(() => {});
        await window.warmy.appQuit?.('privacy-revoke').catch(() => {});
      });

      // 技能目录：资源管理器选择 + 检查扫描
      $('anNiuJinengSaoMiaoBrowse')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (r?.ok && r.path && $('jinengSaoMiaoMuLuShuRu')) $('jinengSaoMiaoMuLuShuRu').value = r.path;
      });
      $('anNiuJinengSaoMiaoJianCha')?.addEventListener('click', async () => {
        const xiaoXi = $('jinengSaoMiaoXiaoXi');
        if (xiaoXi) xiaoXi.textContent = '…';
        try {
          await window.warmy.skillsList?.();
          const r = await window.warmy.skillsList?.();
          if (xiaoXi) xiaoXi.textContent = escapeHtml(t('settings.skillsScanCheck')) + ' · ' + String((r && (r.jinengJi || r.items) || []).length || 0);
          if (typeof window.__refreshSkills === 'function') window.__refreshSkills();
          else setNav('settings');
        } catch (e) {
          if (xiaoXi) xiaoXi.textContent = String(e);
        }
      });

      // 插件目录浏览 / 检查
      $('anNiuPlugSaoMiaoBrowse')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (r?.ok && r.path && $('plugSaoMiaoMuLuShuRu')) $('plugSaoMiaoMuLuShuRu').value = r.path;
      });
      $('anNiuPlugSaoMiaoTianJia')?.addEventListener('click', async () => {
        const input = $('plugSaoMiaoMuLuShuRu');
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
      $('anNiuPlugSaoMiaoJianCha')?.addEventListener('click', async () => {
        const xiaoXi = $('plugSaoMiaoXiaoXi');
        if (xiaoXi) xiaoXi.textContent = '…';
        const r = await window.warmy.pluginsScan?.().catch(() => null);
        if (!r?.ok) { if (xiaoXi) xiaoXi.textContent = String(r?.error || 'fail'); return; }
        const found = r.found || [];
        found.forEach((f) => {
          if (!state.chaJianJi.some((p) => p.id === f.id)) {
            state.chaJianJi.push({ id: f.id, ming: f.name, desc: f.desc || f.path, enabled: true, source: 'discovered' });
          }
        });
        if (xiaoXi) xiaoXi.textContent = (t('settings.pluginScanCheck') || '') + ' · ' + found.length;
        renderPluginList();
      });
      $('btn-plug-add')?.addEventListener('click', () => {
        const sel = $('plug-pick');
        const id = sel && sel.value;
        if (!id) return;
        if (!state.chaJianJi.some((p) => p.id === id)) {
          state.chaJianJi.push({ id, ming: id, desc: '', enabled: true, source: 'builtin' });
        }
        renderPluginList();
      });

      function renderPluginScanDirs(dirs) {
        const heZi = $('plugSaoMiaoMuLuJi');
        if (!heZi) return;
        heZi.innerHTML = (dirs || []).map((d) => '<div class="ctgHang">' + escapeHtml(d) + '</div>').join('') || '<div class="jingYin">—</div>';
      }
      function renderPluginList() {
        const heZi = $('plugLieBiao');
        if (!heZi) return;
        const yiZhi = ['dsh-agent-teams', 'dsh-memory-plus', 'warmy-board-tools'];
        const pick = $('plug-pick');
        if (pick) {
          pick.innerHTML = yiZhi.map((k) => '<option value="' + escapeHtml(k) + '">' + escapeHtml(k) + '</option>').join('');
        }
        heZi.innerHTML = (state.chaJianJi || []).map((p, suoYin) => {
          // desc 可能是 i18n key（内置）或纯文本（扫描/文件夹）
          const descText = (p.desc && state.t && state.t[p.desc]) ? t(p.desc) : (p.desc || '');
          const provider = p.id === 'agent-teams'
            ? tOr('plugin.teams.provider', '提供方：@nanmicoder')
            : p.id === 'memory-plus'
              ? tOr('plugin.memory.provider', '提供方：dsh 社区')
              : '';
          const installedAt = p.source === 'folder'
            ? tOr('plugin.fromFolder', '来源：本地文件夹')
            : tOr('plugin.builtin', '内置插件（随 dsh 运行时自动安装）');
          return '<div class="ctgHang" data-plugin-idx="' + suoYin + '">' +
            '<div style="font-weight:600">' + escapeHtml(p.ming || p.name || p.id) + '</div>' +
            '<div class="jingYin">' + escapeHtml(descText) + '</div>' +
            '<div class="jingYin" style="font-size:11px;margin-top:2px">' + escapeHtml([provider, installedAt].filter(Boolean).join(' · ')) + '</div>' +
            '<div style="margin-top:4px;display:flex;gap:6px">' +
            '<button class="anNiuXiao" data-plug-act="toggle" data-idx="' + suoYin + '">' + (p.enabled === false ? escapeHtml(t('settings.pluginEnable')) : escapeHtml(t('settings.pluginDisable'))) + '</button>' +
            '<button class="anNiuXiao" data-plug-act="del" data-idx="' + suoYin + '">' + escapeHtml(t('settings.pluginDelete')) + '</button>' +
            '</div></div>';
        }).join('') || '<div class="jingYin">' + escapeHtml(t('settings.skillsEmpty') || '—') + '</div>';
        heZi.querySelectorAll('[data-plug-act]').forEach((b) => {
          b.onclick = () => {
            const suoYin = Number(b.getAttribute('data-idx'));
            const act = b.getAttribute('data-plug-act');
            if (!state.chaJianJi[suoYin]) return;
            if (act === 'toggle') state.chaJianJi[suoYin].enabled = state.chaJianJi[suoYin].enabled === false;
            if (act === 'del') state.chaJianJi.splice(suoYin, 1);
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
            if (id) locals.push({ id, provider: p.biaoQian || p.id || '', biaoQian: id + (p.biaoQian ? ' · ' + p.biaoQian : '') });
          });
        }
        document.querySelectorAll('select[data-special]').forEach((sel) => {
          const cur = sel.value;
          sel.innerHTML = locals.length
            ? locals.map((m) => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.biaoQian) + '</option>').join('')
            : '<option value="">—</option>';
          if (cur) sel.value = cur;
        });
        const xiaoXi = $('smXiaoXi');
        if (xiaoXi && !locals.length) xiaoXi.textContent = t('settings.specialModelsHint');
        const ids = locals.map((m) => m.id);
        for (const k of SM_LIAN_JI) renderSmLian(k, ids);
      }
      window.__fillSpecialModelSelects = fillSpecialModelSelects;
      /**
       * 特殊模型调用链（四类通用）：语音识别 / 嵌入 / 整理 / 分类 —— **统一成调用链**。
       * 每类都列出所有已添加模型；第一个未禁用 = 默认；可上移 / 下移 / 禁用（启用）。
       * 产品定稿：这些选项**默认折叠**，点开才展开（`<details>` 自带折叠）。
       */
      const SM_LIAN_JI = ['asr', 'embed', 'organizer', 'tts', 'fenLei', 'imageUnd', 'image', 'videoUnd', 'videoGen', 'rerank', 'safety', 'translate'];
      const SM_HE_JI = {
        asr: 'smAsrLian', embed: 'smEmbedLian', organizer: 'smOrganizerLian', tts: 'smTtsLian', fenLei: 'smFenLei',
        imageUnd: 'smImageUndLian', image: 'smImageLian', videoUnd: 'smVideoUndLian', videoGen: 'smVideoGenLian', rerank: 'smRerankLian',
        safety: 'smSafetyLian', translate: 'smTranslateLian',
      };
      /**
       * 每条链只收**支持该用途**的模型（产品要求：专业链只显专业模型，不放进通用对话模型 ——
       * 用错模型会直接出错）。没有专业模型时链是空的，**使用时会无痛回退到牛马的对话模型链**，
       * 所以这里不需要用 chat 兜底。
       *
       * ⚠️ 看图链**不能**把 'chat' 放进白名单：那样 `yaoZhongLei.includes(n.kind)` 会让
       * **所有对话模型**都通过（真事故：看图链里列出了全部模型，包括不带视觉的）。
       * 视觉能力走下面 `chun()` 里的 `vision === true` 单独判。
       */
      const SM_LIAN_YAO = {
        asr: ['asr'], embed: ['embedding'], organizer: ['chat'], tts: ['tts'], fenLei: ['decision'],
        imageUnd: ['imageUnd'], image: ['image'], videoUnd: ['videoUnd'], videoGen: ['videoGen'], rerank: ['rerank'],
        safety: ['safety'], translate: ['translate'],
      };
      const SM_LIAN_DATA = {};   // key -> { chain: string[], disabled: string[] }
      async function loadSmLian() {
        try {
          const sp = await window.warmy.specialModelsGet?.();
          const sm = (sp && sp.specialModels) || {};
          for (const k of SM_LIAN_JI) {
            const c = Array.isArray(sm[k + 'Chain']) ? sm[k + 'Chain'].slice()
              : (k === 'fenLei' && Array.isArray(sm.fenLeiChain) ? sm.fenLeiChain.slice() : []);
            const d = Array.isArray(sm[k + 'Disabled']) ? sm[k + 'Disabled'].slice()
              : (k === 'fenLei' && Array.isArray(sm.fenLeiDisabled) ? sm.fenLeiDisabled.slice() : []);
            const mg = Array.isArray(sm[k + 'Manual']) ? sm[k + 'Manual'].slice() : [];
            SM_LIAN_DATA[k] = { chain: c, disabled: d, manual: mg };
          }
        } catch {
          for (const k of SM_LIAN_JI) SM_LIAN_DATA[k] = { chain: [], disabled: [] };
        }
      }
      /** 上下文长度短标签（如 128K / 32K） */
      function shangXiaWenBiaoQian(n) {
        const v = Number(n) || 0;
        if (v <= 0) return '';
        if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (v >= 1000) return Math.round(v / 1000) + 'K';
        return String(v);
      }
      /** 模型种类 → 文案（简体中文用产品叫法 说话/听话/对话/画图/看视频/做视频…，其它语言走规范术语） */
      function kindWenAn(k) {
        const m = {
          chat: 'model.kind.chat', embedding: 'model.kind.embedding', asr: 'model.kind.asr', tts: 'model.kind.tts',
          decision: 'model.kind.decision', imageUnd: 'model.kind.imageUnd', image: 'model.kind.image', videoUnd: 'model.kind.videoUnd',
          videoGen: 'model.kind.videoGen', rerank: 'model.kind.rerank', safety: 'model.kind.safety', translate: 'model.kind.translate',
        };
        return m[k] ? tOr(m[k], k) : '';
      }
      window.__moXingNengLi = {};
      window.__shangXiaWenBiaoQian = shangXiaWenBiaoQian;
      window.__kindWenAn = kindWenAn;
      function renderSmLian(key, allIds) {
        const he = $(SM_HE_JI[key]);
        if (!he) return;
        const st = SM_LIAN_DATA[key] || (SM_LIAN_DATA[key] = { chain: [], disabled: [] });
        const nengLi = (window.__moXingNengLi) || {};
        const yaoZhongLei = SM_LIAN_YAO[key] || [];
        const chun = (id) => {
          const n = nengLi[id];
          if (!n || !n.kind || n.kind === 'unknown') return yaoZhongLei.includes('chat');
          if (yaoZhongLei.includes(n.kind)) return true;
          // 看图：带视觉能力的对话模型同样胜任（"只显专业模型"针对的是用错模型会出错的链）
          if (key === 'imageUnd' && n.kind === 'chat' && n.vision === true) return true;
          return false;
        };
        const ids = (Array.isArray(allIds) && allIds.length
          ? allIds.map(String)
          : (() => {
              const out = [];
              for (const p of (state.providers || [])) {
                (p.models || []).forEach((m) => {
                  const id = String(typeof m === 'string' ? m : (m.id || m.name || ''));
                  if (id) out.push(id);
                });
              }
              return out;
            })()).filter(chun);
        // 链 = 已保存顺序里仍存在的项 + 新出现的项（追加在末尾）
        /**
         * **手动添加的模型必须留在链上**（真事故：点了「手动添加」却看不到 ——
         * 因为重绘时 `saved` 只保留能过 `chun()` 能力过滤的项，人工加进来的又被踢掉了）。
         * 产品语义：自动识别只是**建议**，用户手动放进来的以用户为准。
         */
        if (!st.manual) st.manual = [];
        const shouLiu = (m) => ids.includes(m) || st.manual.includes(m);
        const saved = st.chain.filter(shouLiu);
        const news = ids.filter((m) => !saved.includes(m));
        st.chain = [...saved, ...news];
        st.disabled = st.disabled.filter((m) => st.chain.includes(m));
        const dis = st.disabled;
        const moRen = st.chain.find((m) => !dis.includes(m)) || '';
        // 折叠摘要：显示当前默认模型，方便不点开也知道
        const zhai = document.querySelector('[data-zhaiyao="' + key + '"]');
        if (zhai) zhai.textContent = moRen ? ' · ' + tOr('model.default', '默认') + '：' + moRen : '';
        he.innerHTML = st.chain.map((m, i) => {
          const nl = nengLi[m] || {};
          const ctxB = nl.contextLen ? ' <span class="moXingCtx" title="' + escapeHtml(tOr('model.contextLen', '上下文长度')) + '">' + escapeHtml(shangXiaWenBiaoQian(nl.contextLen)) + '</span>' : '';
          const kindB = (nl.kind && nl.kind !== 'unknown') ? ' <span class="moXingKind">' + escapeHtml(kindWenAn(nl.kind)) + '</span>' : '';
          // **说话模型**等有专属参数（语速/语音）：拉取时拿到就摆出来可调
          let zhuan = '';
          if (nl.kind === 'tts') {
            const su = (nl.speakers && nl.speakers.length)
              ? '<select class="moXingShu" data-tts-voice="' + key + '|' + i + '">' + nl.speakers.map((s) => '<option>' + escapeHtml(s) + '</option>').join('') + '</select>'
              : '';
            zhuan = '<span class="moXingZhuanShu">' +
              '<label>' + escapeHtml(tOr('model.speakSpeed', '语速')) +
              '<input type="range" min="50" max="200" step="5" value="' + Number(nl.speed || 100) + '" data-tts-speed="' + key + '|' + i + '"/></label>' +
              su + '</span>';
          }
          return (
          '<div class="shiLiHang lianHang" style="margin:4px 0;align-items:center;flex-wrap:wrap' + (dis.includes(m) ? ';color:var(--muted)' : '') + '">' +
          '<span class="lianMing" style="flex:1;min-width:180px' + (dis.includes(m) ? ';text-decoration:line-through' : '') + '">' + escapeHtml(m) + kindB + ctxB +
          (m === moRen ? ' <span class="moRenBiaoQian">' + escapeHtml(tOr('model.default', '默认模型')) + '</span>' : '') + '</span>' +
          zhuan +
          // 置顶：已是最上面 ⇒ 灰
          '<button class="anNiuXiao" data-sml-top="' + key + '|' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="' + escapeHtml(tOr('model.moveTop', '置顶')) + '">⤒</button>' +
          // 上移：已是最上面 ⇒ 灰
          '<button class="anNiuXiao" data-sml-up="' + key + '|' + i + '"' + (i === 0 ? ' disabled' : '') + '>' + escapeHtml(t('instances.moveUp')) + '</button>' +
          // 下移：已是最下面 ⇒ 灰
          '<button class="anNiuXiao" data-sml-dn="' + key + '|' + i + '"' + (i === st.chain.length - 1 ? ' disabled' : '') + '>' + escapeHtml(t('instances.moveDown')) + '</button>' +
          // 启用/禁用**永不置灰**（禁用了还要能点回来）
          '<button class="anNiuXiao" data-sml-tg="' + key + '|' + i + '">' + escapeHtml(dis.includes(m) ? tOr('model.enable', '启用') : tOr('model.disable', '禁用')) + '</button>' +
          '</div>'
          );
        }).join('') || '<div class="jingYin">' + escapeHtml(tOr('model.lianKong', '没有支持该用途的模型（拉取模型后会自动识别）')) + '</div>';
        /**
         * **手动添加**（产品要求）：下拉里列出**所有已拉取到的模型**（不按能力过滤 ——
         * 自动识别不准时，用户可以自己把模型加进这条链），点「手动添加」就入链。
         */
        {
          const quanBu = [];
          for (const p of (state.providers || [])) {
            (p.models || []).forEach((m) => {
              const id = String(typeof m === 'string' ? m : (m.id || m.name || ''));
              if (id && !quanBu.includes(id)) quanBu.push(id);
            });
          }
          he.insertAdjacentHTML('beforeend',
            '<div class="smShouDong">' +
            '<select class="moXingShu" data-sml-sel="' + escapeHtml(key) + '">' +
            (quanBu.length
              ? quanBu.map((m) => '<option value="' + escapeHtml(m) + '"' + (st.chain.includes(m) ? ' disabled' : '') + '>' + escapeHtml(m) + (st.chain.includes(m) ? '（已在链上）' : '') + '</option>').join('')
              : '<option value="">' + escapeHtml(tOr('model.noModels', '还没有拉取到模型')) + '</option>') +
            '</select>' +
            '<button class="anNiuXiao" data-sml-add="' + escapeHtml(key) + '">' + escapeHtml(tOr('model.addManually', '手动添加')) + '</button>' +
            '</div>');
        }
        const fen = (b, cha) => {
          const [k, iS] = String(b.getAttribute(cha) || '').split('|');
          return { k, i: Number(iS) };
        };
        he.querySelectorAll('[data-sml-add]').forEach((b) => {
          b.onclick = () => {
            const k = String(b.getAttribute('data-sml-add') || '');
            const sel = he.querySelector('select[data-sml-sel="' + k + '"]');
            const m = String((sel && sel.value) || '').trim();
            const s2 = SM_LIAN_DATA[k];
            if (!m || !s2) return;
            if (s2.chain.includes(m)) { showToast(tOr('model.alreadyInChain', '这个模型已经在链上了')); return; }
            s2.chain.push(m);
            // 记进 manual：重绘时**不再被能力过滤踢掉**（用户手动放的，以用户为准）
            if (!s2.manual) s2.manual = [];
            if (!s2.manual.includes(m)) s2.manual.push(m);
            renderSmLian(k, ids);
            showToast(tOr('model.addedToChain', '已加入调用链') + '：' + m);
          };
        });
        he.querySelectorAll('[data-sml-top]').forEach((b) => {
          b.onclick = () => {
            const { k, i } = fen(b, 'data-sml-top');
            const s2 = SM_LIAN_DATA[k]; if (!s2 || i <= 0) return;
            const [m0] = s2.chain.splice(i, 1);
            s2.chain.unshift(m0);
            renderSmLian(k, ids);
          };
        });
        he.querySelectorAll('[data-sml-up]').forEach((b) => {
          b.onclick = () => {
            const { k, i } = fen(b, 'data-sml-up');
            const s2 = SM_LIAN_DATA[k]; if (!s2 || i <= 0) return;
            const t0 = s2.chain[i - 1]; s2.chain[i - 1] = s2.chain[i]; s2.chain[i] = t0;
            renderSmLian(k, ids);
          };
        });
        he.querySelectorAll('[data-sml-dn]').forEach((b) => {
          b.onclick = () => {
            const { k, i } = fen(b, 'data-sml-dn');
            const s2 = SM_LIAN_DATA[k]; if (!s2 || i >= s2.chain.length - 1) return;
            const t0 = s2.chain[i + 1]; s2.chain[i + 1] = s2.chain[i]; s2.chain[i] = t0;
            renderSmLian(k, ids);
          };
        });
        he.querySelectorAll('[data-sml-tg]').forEach((b) => {
          b.onclick = () => {
            const { k, i } = fen(b, 'data-sml-tg');
            const s2 = SM_LIAN_DATA[k]; const m = s2 && s2.chain[i]; if (!m) return;
            const dis2 = new Set(s2.disabled);
            if (dis2.has(m)) dis2.delete(m); else dis2.add(m);
            s2.disabled = [...dis2];
            renderSmLian(k, ids);
          };
        });
        /**
         * 说话模型专属参数（语速 / 音色）：拉动即记，保存时落盘。
         * 真事故：界面画了滑条/下拉，但没有 change ⇒ TTS 永远用 alloy/1x 默认。
         */
        he.querySelectorAll('[data-tts-speed]').forEach((el) => {
          el.oninput = () => {
            SM_LIAN_DATA.ttsParams = SM_LIAN_DATA.ttsParams || {};
            const m = String(el.getAttribute('data-tts-speed') || '').split('|')[0];
            const p = SM_LIAN_DATA.ttsParams[m] || (SM_LIAN_DATA.ttsParams[m] = {});
            p.speed = Number(el.value) / 100;
          };
        });
        he.querySelectorAll('[data-tts-voice]').forEach((el) => {
          el.onchange = () => {
            SM_LIAN_DATA.ttsParams = SM_LIAN_DATA.ttsParams || {};
            const m = String(el.getAttribute('data-tts-voice') || '').split('|')[0];
            const p = SM_LIAN_DATA.ttsParams[m] || (SM_LIAN_DATA.ttsParams[m] = {});
            p.voice = String(el.value || '');
          };
        });
      }
      window.__renderSmLian = renderSmLian;
      loadSmLian().then(() => fillSpecialModelSelects());
      fillSpecialModelSelects();

      // 插件：从文件夹安装（资源管理器）
      $('anNiuPlugAnZhuangFolder')?.addEventListener('click', async () => {
        const r = await window.warmy.pickDirectory?.().catch(() => null);
        if (!r?.ok || !r.path) return;
        // 目录名作为插件 id；若 IPC 支持 skills-import 同类安装则复用
        const id = String(r.path).split(/[\\/]/).filter(Boolean).pop() || 'plugin';
        if (!state.chaJianJi.some((p) => p.id === id)) {
          state.chaJianJi.push({ id, ming: id, desc: r.path, enabled: true, source: 'folder' });
        }
        if (typeof window.__renderPluginList === 'function') window.__renderPluginList();
        else setNav('settings');
      });
      $('btn-plug-add')?.addEventListener('click', () => { /* 已移除假下拉添加 */ });

      // 自定义主题色：模仿 Windows 11「设置 > 个性化 > 颜色 > 查看颜色」的自定义颜色弹窗
      // 结构：HSV 饱和度/明度大方块 + 右侧色相条 + 新旧预览 + RGB/HEX + 取色器 + 确定/取消
      (function bindWin11Accent() {
        const btnCustom = document.getElementById('anNiuZhuTiCustom');
        const preview = document.getElementById('zhuTiCustomPreview');
        if (preview) preview.style.background = state.theme || '#A78567';

        // ── 颜色工具 ──
        const hexToRgb = (hex) => {
          const h = String(hex || '#000000').replace('#', '');
          const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        };
        const rgbToHex = (r, g, b) => {
          const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
          return '#' + to2(r) + to2(g) + to2(b);
        };
        const rgbToHsv = (r, g, b) => {
          r /= 255; g /= 255; b /= 255;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
          let h = 0;
          if (d) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
          }
          const s = mx ? d / mx : 0;
          return { h, s, v: mx };
        };
        const hsvToRgb = (h, s, v) => {
          const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
          let r = 0, g = 0, b = 0;
          if (h < 60) { r = c; g = x; }
          else if (h < 120) { r = x; g = c; }
          else if (h < 180) { g = c; b = x; }
          else if (h < 240) { g = x; b = c; }
          else if (h < 300) { r = x; b = c; }
          else { r = c; b = x; }
          return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
        };

        let w11 = null;
        let hsv = { h: 0, s: 0, v: 0 };
        let cur = '#A78567';
        let w11Api = null;

        const paint = () => {
          if (!w11Api) return;
          const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
          cur = rgbToHex(rgb.r, rgb.g, rgb.b);
          w11Api.sv.style.background = `hsl(${hsv.h}, 100%, 50%)`;
          w11Api.svCursor.style.left = (hsv.s * 100) + '%';
          w11Api.svCursor.style.top = ((1 - hsv.v) * 100) + '%';
          w11Api.svCursor.style.background = cur;
          w11Api.hueCursor.style.top = (hsv.h / 360 * 100) + '%';
          w11Api.newSw.style.background = cur;
          w11Api.inpR.value = String(Math.round(rgb.r));
          w11Api.inpG.value = String(Math.round(rgb.g));
          w11Api.inpB.value = String(Math.round(rgb.b));
          w11Api.inpHex.value = cur.toUpperCase();
        };
        const setFromHex = (hex) => {
          const rgb = hexToRgb(hex);
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          paint();
        };

        function ensureDialog() {
          if (w11) return w11;
          const el = document.createElement('div');
          el.id = 'w11ColorDialog';
          el.className = 'w11ColorDialog yinCang';
          el.innerHTML = `
            <div class="w11ColorMask" data-w11-cancel></div>
            <div class="w11ColorKa" role="dialog" aria-label="${escapeHtml(tOr('settings.customColorTitle', '自定义主题色'))}">
              <div class="w11ColorTitle">
                <span>${escapeHtml(tOr('settings.customColorTitle', '自定义主题色'))}</span>
                <button type="button" class="w11Close" data-w11-cancel title="${escapeHtml(tOr('common.cancel', '取消'))}">×</button>
              </div>
              <div class="w11ColorBody">
                <div class="w11Sv" id="w11Sv">
                  <div class="w11SvWhite"></div>
                  <div class="w11SvBlack"></div>
                  <div class="w11SvCursor" id="w11SvCursor"></div>
                </div>
                <div class="w11Hue" id="w11Hue">
                  <div class="w11HueCursor" id="w11HueCursor"></div>
                </div>
                <div class="w11Right">
                  <div class="w11PreviewRow">
                    <div class="w11PreviewBox">
                      <div class="w11JingYin">${escapeHtml(tOr('settings.themePreview', '预览'))}</div>
                      <div class="w11SwatchRow">
                        <div class="w11Swatch" id="w11Old"></div>
                        <div class="w11Swatch" id="w11New"></div>
                      </div>
                    </div>
                  </div>
                  <div class="w11Fields">
                    <label>R <input type="number" id="w11R" min="0" max="255"/></label>
                    <label>G <input type="number" id="w11G" min="0" max="255"/></label>
                    <label>B <input type="number" id="w11B" min="0" max="255"/></label>
                  </div>
                  <div class="w11Fields">
                    <label class="w11HexLab">HEX <input type="text" id="w11Hex" spellcheck="false" maxlength="7"/></label>
                  </div>
                  <div class="w11Fields">
                    <button type="button" class="anNiuXiao" id="w11Eye">${escapeHtml(tOr('settings.pickScreenColor', '全屏取色'))}</button>
                  </div>
                </div>
              </div>
              <div class="w11ColorFoot">
                <button type="button" class="anNiuXiao" data-w11-cancel>${escapeHtml(tOr('common.cancel', '取消'))}</button>
                <button type="button" class="anNiuZhuYao" id="w11Ok">${escapeHtml(tOr('common.ok', '确定'))}</button>
              </div>
            </div>`;
          document.body.appendChild(el);
          w11 = el;

          const sv = el.querySelector('#w11Sv');
          const hue = el.querySelector('#w11Hue');
          const svCursor = el.querySelector('#w11SvCursor');
          const hueCursor = el.querySelector('#w11HueCursor');
          const inpR = el.querySelector('#w11R');
          const inpG = el.querySelector('#w11G');
          const inpB = el.querySelector('#w11B');
          const inpHex = el.querySelector('#w11Hex');
          const oldSw = el.querySelector('#w11Old');
          const newSw = el.querySelector('#w11New');

          w11Api = { sv, hue, svCursor, hueCursor, inpR, inpG, inpB, inpHex, oldSw, newSw };
          const setFromRgb = () => {
            hsv = rgbToHsv(Number(inpR.value) || 0, Number(inpG.value) || 0, Number(inpB.value) || 0);
            paint();
          };

          const drag = (box, onMove) => {
            const handle = (e) => {
              const rect = box.getBoundingClientRect();
              const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
              onMove(x, y);
            };
            box.addEventListener('pointerdown', (e) => {
              box.setPointerCapture(e.pointerId);
              handle(e);
              const move = (ev) => handle(ev);
              const up = () => {
                box.removeEventListener('pointermove', move);
                box.removeEventListener('pointerup', up);
              };
              box.addEventListener('pointermove', move);
              box.addEventListener('pointerup', up);
            });
          };
          drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; paint(); });
          drag(hue, (_x, y) => { hsv.h = y * 360; paint(); });

          [inpR, inpG, inpB].forEach((n) => n.addEventListener('input', setFromRgb));
          inpHex.addEventListener('change', () => {
            let v = String(inpHex.value || '').trim();
            if (!v.startsWith('#')) v = '#' + v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) setFromHex(v);
          });

          el.querySelector('#w11Eye')?.addEventListener('click', async () => {
            try {
              const hex = await window.__quanPingQuSe?.();
              if (hex) { setFromHex(hex); return; }
            } catch { /* user cancel */ }
          });

          el.querySelectorAll('[data-w11-cancel]').forEach((b) => {
            b.addEventListener('click', () => { el.classList.add('yinCang'); });
          });
          el.querySelector('#w11Ok')?.addEventListener('click', () => {
            applyAccent(cur);
            // 色块 + 预览都要跟上（preview 可能是旧节点）
            try {
              document.querySelectorAll('.zhuTiSeKuai, #zhuTiCustomPreview').forEach((n) => {
                n.style.background = cur;
              });
            } catch { /* noop */ }
            if (preview) preview.style.background = cur;
            el.classList.add('yinCang');
            try {
              document.querySelectorAll('.zhuTiSwatches button').forEach((b) => {
                b.classList.toggle('qiYong', b.dataset.c === cur);
              });
            } catch { /* noop */ }
          });

          return w11;
        }

        btnCustom?.addEventListener('click', () => {
          const el = ensureDialog();
          const start = state.theme || '#A78567';
          el.classList.remove('yinCang');
          el.querySelector('#w11Old').style.background = start;
          // 打开时用当前主题色定位游标
          const rgb = hexToRgb(start);
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          paint();
          const c = el.querySelector('#w11Hex');
          if (c) { try { c.focus(); c.select(); } catch { /* noop */ } }
        });
      })();

      (function bindThemeCustom() {
        // 预设色板恢复显示 + 自定义色块点开 Win11 取色弹窗
        renderThemeSwatches();
        const kuai = document.querySelector('.zhuTiSeKuai');
        if (kuai) kuai.style.background = state.theme || '#A78567';
      })();
      // 文字：字体 / 粗细 / 大小（列表来自系统字体 + 用户自行安装）
      (function bindWenZi() {
        const sel = $('ziTiXuanZe');
        const cuXi = $('ziTiCuXi');
        const cuXiShu = $('ziTiCuXiShu');
        const daXiao = $('ziTiDaXiao');
        const daShu = $('ziTiDaXiaoShu');
        const xiaoXi = $('ziTiXiaoXi');
        const queDing = $('anNiuWenZiQueDing');
        const st = state.wenZi || {};
        const duiZhao = { 100: '极细', 200: '特细', 300: '细', 400: '正常', 500: '中等', 600: '半粗', 700: '粗', 800: '特粗', 900: '黑体' };
        const cuXiWen = (v) => tOr('settings.fw' + v, duiZhao[v] || String(v));
        /** 只更新标签（**不生效**）；生效一律走「确定」（产品要求：点确定后生效） */
        const tongBuBiaoQian = () => {
          if (cuXiShu) cuXiShu.textContent = cuXiWen(Number(cuXi && cuXi.value) || 400);
          if (daShu) daShu.textContent = ((daXiao && daXiao.value) || 100) + '%';
        };
        const yingYongBingBaoCun = () => {
          const pp = {
            fontFamily: sel && sel.value,
            fontWeight: cuXi && cuXi.value,
            fontSize: daXiao && daXiao.value,
          };
          yingYongWenZiPiHao(pp);
          state.wenZi = pp;
          try { window.warmy.settingsSave({ wenZi: pp }); } catch { /* noop */ }
          tongBuBiaoQian();
          showToast(tOr('common.saved', '已保存'));
        };
        // 字体列表
        const tian = (fonts) => {
          if (!sel) return;
          const cur = (st.fontFamily || '');
          sel.innerHTML = '<option value="">' + escapeHtml(tOr('settings.fontDefault', '默认（跟随系统）')) + '</option>' +
            (fonts || []).map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
          if (cur) sel.value = cur;
        };
        tian([]);
        if (sel) {
          sel.value = st.fontFamily || '';
          sel.onchange = tongBuBiaoQian;
        }
        if (cuXi) { cuXi.value = String(st.fontWeight || 400); cuXi.oninput = tongBuBiaoQian; }
        if (daXiao) { daXiao.value = String(st.fontSize || 100); daXiao.oninput = tongBuBiaoQian; }
        if (queDing) queDing.onclick = yingYongBingBaoCun;
        void (async () => {
          try {
            const r = await window.warmy.listSystemFonts?.();
            if (r && r.ok) tian(r.fonts);
            else if (xiaoXi) xiaoXi.textContent = tOr('settings.fontListFail', '系统字体列表读取失败');
            if (sel) sel.value = st.fontFamily || '';
          } catch { if (xiaoXi) xiaoXi.textContent = tOr('settings.fontListFail', '系统字体列表读取失败'); }
        })();
        $('anNiuAnZhuangZiTi')?.addEventListener('click', async () => {
          try {
            const r = await window.warmy.pickFile?.({ filters: [{ name: 'Font', extensions: ['ttf', 'otf', 'ttc'] }] });
            if (!r || !r.ok || !r.path) return;
            const ins = await window.warmy.installFont?.({ path: r.path });
            if (ins && ins.ok) {
              const r2 = await window.warmy.listSystemFonts?.();
              if (r2 && r2.ok) tian(r2.fonts);
              if (sel) sel.value = ins.family || '';
              yingYongBingBaoCun();
              if (xiaoXi) { xiaoXi.textContent = tOr('settings.fontInstalled', '已安装') + '：' + (ins.family || ''); xiaoXi.style.color = '#1a7f37'; }
            } else if (xiaoXi) {
              xiaoXi.textContent = tOr('settings.fontInstallFail', '安装失败') + (ins && ins.error ? ' · ' + ins.error : '');
              xiaoXi.style.color = '#b91c1c';
            }
          } catch { /* noop */ }
        });
        // 先应用已存的偏好
        yingYongWenZiPiHao(st);
        tongBuBiaoQian();
      })();

      // 语言：设置页下拉必须落盘 + 立即生效（此前没有任何 handler，改了不生效）
      (function bindLanguageSelect() {
        const sel = $('xuanZeYuYan');
        if (!sel) return;
        sel.value = state.yuYan;
        sel.onchange = async () => {
          const pick = resolveLocalePack(sel.value);
          baoHuYuYan(30000, pick);
          try { await loadI18n(pick); } catch { /* noop */ }
          try { await window.warmy.settingsSave({ yuYan: pick }); } catch { /* noop */ }
          try { await window.warmy.setupComplete({ yuYan: pick }); } catch { /* noop */ }
          renderPage();
        };
      })();

      // 加强 AI 语言约束：勾上后思考过程与回复都严格用界面语言（主进程按它注入系统指令）
      (function bindStrictAiLanguage() {
        const chk = $('yanGeYuYan');
        if (!chk) return;
        chk.checked = !!state.strictAiLanguage;
        chk.onchange = () => {
          state.strictAiLanguage = !!chk.checked;
          try { window.warmy.settingsSave?.({ strictAiLanguage: state.strictAiLanguage }); } catch { /* noop */ }
          showToast(state.strictAiLanguage
            ? tOr('settings.strictOn', '已开启：AI 会更严格地使用界面语言')
            : tOr('settings.strictOff', '已关闭：AI 可自行选择语言'));
        };
      })();

      // 明暗模式（浅色/深色/跟随系统）：此前按钮没有 handler，点了没反应
      (function bindThemeMode() {
        const wrap = document.querySelector('.zhuTiMoShi');
        if (!wrap) return;
        wrap.querySelectorAll('button[data-m]').forEach((b) => {
          b.onclick = async () => {
            const mode = b.dataset.m;
            applyThemeMode(mode);
            wrap.querySelectorAll('button[data-m]').forEach((x) => x.classList.toggle('qiYong', x === b));
            try { await window.warmy.settingsSave({ themeMode: mode }); } catch { /* noop */ }
          };
        });
      })();

      // 重新查看引导（设置 → 功能）：随时可重调
      (function bindGuideRestart() {
        if (window.__guideRestartDelegated) return;
        window.__guideRestartDelegated = 1;
        document.addEventListener('click', (e) => {
          const b = e.target && e.target.closest && e.target.closest('#anNiuChongKanYinDao');
          if (!b) return;
          e.preventDefault();
          try { window.__showOnboardingGuide?.(true); } catch { /* noop */ }
        });
      })();

      // 容器卡片：安装提示词灌入 + 复制绑定（此前漏调，导致 pre 为空、复制无动作）
      try { bindContainerCard(); } catch { /* noop */ }
      // Microsandbox 卸载钮：每次重渲染后按真实安装态同步（避免残留可点）
      try { window.__msbTongBuChuShi?.(); } catch { /* noop */ }
      const SEC_DESC = {
        normal: 'settings.securityNormalDesc',
        strict: 'settings.securityStrictDesc',
        // ⚠️ 键名必须是 full（原来写成 Quan ⇒ 完全授权下描述仍显示常规授权那句）
        full: 'settings.securityFullDesc',
      };
      const syncSecDesc = () => {
        const d = $('secMiaoShu');
        if (d) d.textContent = t(SEC_DESC[state.globalSecurity] || SEC_DESC.normal);
      };
      const xuanZeSec = $('xuanZeSec');
      if (xuanZeSec) {
        xuanZeSec.value = state.globalSecurity;
        syncSecDesc();
        xuanZeSec.onchange = async (e) => {
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
      }
      // 声音开关：HTML id 已是 sWanCheng/sQingQiu/sCuoWu（不是 s-complete）
      const soundIdByKey = { complete: 'sWanCheng', request: 'sQingQiu', error: 'sCuoWu' };
      Object.keys(soundIdByKey).forEach((k) => {
        const el = $(soundIdByKey[k]);
        if (el) el.onchange = (e) => { state.sound[k] = e.target.checked; };
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
        window.__qingHuanCunYinXiao?.();   // 清除后回落到内置默认音效，缓存要重取
          renderPage();
        };
      });

      // ── SMTP 多账号（最多 10） ──
      $('btn-import-openclaw')?.addEventListener('click', async () => {
        $('import-msg').textContent = t('common.loading');
        const r = await window.warmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = escapeHtml(t('instances.saved')) + ' (' + r.providers.length + ')';
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
          $('webgpuXiaoXi').textContent = escapeHtml(t('webgpu.ok')) + ' · vendor=' + (info.vendor||'') + ' arch=' + (info.architecture||'');
        } catch (e) {
          $('webgpuXiaoXi').textContent = t('webgpu.fail');
        }
      });
      $('anNiuBaoCunTeShu')?.addEventListener('click', async () => {
        const lian = {};
        for (const k of SM_LIAN_JI) {
          const st = SM_LIAN_DATA[k] || { chain: [], disabled: [] };
          lian[k + 'Chain'] = st.chain.slice();
          lian[k + 'Disabled'] = st.disabled.slice();
          lian[k + 'Manual'] = (st.manual || []).slice();
        }
        // 说话模型专属参数：默认取链上第一个未禁用的 tts 模型的设置
        const ttsParams = SM_LIAN_DATA.ttsParams || {};
        const ttsMo = (lian.ttsChain || []).find((m) => !(lian.ttsDisabled || []).includes(m)) || '';
        const ttsP = (ttsMo && ttsParams[ttsMo]) || Object.values(ttsParams)[0] || {};
        const cfg = {
          // 四类调用链（第一个未禁用 = 默认）
          ...lian,
          // 说话模型：语速 / 音色（TTS 请求会读这两个字段）
          ttsVoice: ttsP.voice || '',
          ttsSpeed: Number(ttsP.speed) || 1,
          // 旧字段兼容：按链上第一个未禁用项填
          asr: { provider: (lian.asrChain || []).find((m) => !(lian.asrDisabled || []).includes(m)) || 'ollama' },
          embedding: { provider: (lian.embedChain || []).find((m) => !(lian.embedDisabled || []).includes(m)) || 'onnx' },
          organizer: { provider: 'deepseek', model: (lian.organizerChain || []).find((m) => !(lian.organizerDisabled || []).includes(m)) || 'deepseek-chat' },
          fenLeiChain: lian.fenLeiChain.slice(),
          fenLeiDisabled: lian.fenLeiDisabled.slice(),
        };
        await window.warmy.specialModelsSet(cfg).catch(() => {});
        $('smXiaoXi').textContent = t('instances.saved');
      });
      // 邀请链接 / 二维码（二维码由 index.html 引入的经典脚本编码器生成，见 qrSvg）
      //
      // 链接**只有**一个来源：ownInviteLink() —— node ← meshStatus().nodeId、
      // port ← 组网设置里当前配置的端口（netState.addr.port）、tok ← inviteCreate().invite.token。
      // 这里曾经硬编码了一个**早已退休的旧约定端口**（不是产品默认端口），改成读真实端口；
      // 真端口拿不到就**少一个字段**（如实少说），绝不编一个旧端口出来。
      // 面板元素在当前布局里可能不存在 —— 不存在就连 IPC 都不发（不白造邀请令牌）。
      (async () => {
        if (!$('jiaRuLink') && !$('jiaRuqr')) return;
        const ziji = await ownInviteLink();
        const lk = $('jiaRuLink');
        if (lk) lk.textContent = ziji.link;
        const xiaoXi = $('join-msg');
        if (xiaoXi && !ziji.ok) xiaoXi.textContent = t('join.linkUnavailable');
        const erWeiMa = $('jiaRuqr');
        if (erWeiMa) {
          const svg = ziji.ok ? qrSvg(ziji.link, 168) : '';
          // 编码器没加载上就如实说明：不画占位矩阵、也不拿截断的链接冒充二维码
          if (svg) erWeiMa.innerHTML = svg;
          else erWeiMa.textContent = t('join.qrUnavailable');
        }
      })();
      $('btn-join-copy')?.addEventListener('click', async () => {
        const link = String($('jiaRuLink')?.textContent || '').trim();
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
        const heZi = $('heiMingDanHe');
        if (!heZi) return;
        const r = await window.warmy.blacklistList().catch(() => null);
        const items = r?.items || [];
        heZi.innerHTML = items.length
          ? items.map((b) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(b.name) + ' · ' + escapeHtml(b.target) + ' · ' + new Date(b.blockedAt).toLocaleString() + '</span><button class="anNiuXiao" data-unblock="' + escapeHtml(b.id) + '">' + escapeHtml(t('join.removeBlacklist')) + '</button></div>').join('')
          : t('join.blacklistEmpty');
        heZi.querySelectorAll('[data-unblock]').forEach((btn) => {
          btn.onclick = async () => {
            await window.warmy.blacklistRemove(btn.dataset.unblock).catch(() => {});
            refreshBlacklist();
          };
        });
      }
      refreshBlacklist();

      async function refreshArchived() {
        const heZi = $('yiGuiDangHe');
        if (!heZi) return;
        const r = await window.warmy.archivedList().catch(() => null);
        const items = r?.items || [];
        heZi.innerHTML = items.length
          ? items.map((a) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(a.name) + ' · ' + escapeHtml(String(a.kind || '')) + '</span><button class="anNiuXiao" data-restore="' + escapeHtml(a.id) + '">' + escapeHtml(t('cp.rollback')) + '</button></div>').join('')
          : '—';
        heZi.querySelectorAll('[data-restore]').forEach((b) => {
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
        const heZi = $('smtpAccounts');
        if (!heZi) return;
        if (!accounts.length) {
          heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('smtp.empty')) + '</div>';
          return;
        }
        heZi.innerHTML = accounts
          .map(
            (a) =>
              '<div class="provKa" style="margin-bottom:8px" data-id="' + escapeHtml(a.id) + '">' +
              '<div class="shiLiHang">' +
              '<div><b>' + escapeHtml(a.biaoQian) + '</b> <span class="jingYin">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + escapeHtml(String(a.port)) + '</span></div>' +
              '<span class="huiZhang ' + (a.yiYanZheng ? '' : 'off') + '">' + (a.yiYanZheng ? t('smtp.verified') : t('smtp.unverified')) + '</span>' +
              '<button class="anNiuXiao" data-v="' + escapeHtml(a.id) + '">' + escapeHtml(t('smtp.verify')) + '</button>' +
              '<button class="anNiuXiao" data-x="' + escapeHtml(a.id) + '">' + escapeHtml(t('smtp.remove')) + '</button>' +
              '</div></div>'
          )
          .join('');
        heZi.querySelectorAll('[data-x]').forEach((b) => {
          b.onclick = async () => {
            await window.warmy.smtpRemove(b.dataset.x);
            renderSmtpList();
          };
        });
        heZi.querySelectorAll('[data-v]').forEach((b) => {
          b.onclick = async () => {
            const id = b.dataset.v;
            const Quan = (state.smtpFull || []).find((x) => x.id === id);
            if (!Quan) {
              $('smtpXiaoXi').textContent = t('smtp.fail');
              return;
            }
            $('smtpXiaoXi').textContent = t('common.loading');
            const vr = await window.warmy.smtpVerify({ ...Quan, id });
            $('smtpXiaoXi').textContent = vr?.ok ? t('smtp.ok') : t('smtp.fail') + ': ' + (vr?.message || '');
            renderSmtpList();
          };
        });
      }
      renderSmtpList();

      $('anNiusmtpTianJia').onclick = async () => {
        const leiJi = {
          biaoQian: $('smtpBiaoQian').value.trim(),
          host: $('smtpHost').value.trim(),
          port: parseInt($('smtpDuanKou').value, 10) || 465,
          secure: $('smtpAnQuan').checked,
          user: $('smtpUser').value.trim(),
          pass: $('smtpPass').value,
        };
        if (!leiJi.host || !leiJi.user) {
          $('smtpXiaoXi').textContent = t('common.error');
          return;
        }
        const r = await window.warmy.smtpAdd(leiJi);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([leiJi]);
          ['smtpBiaoQian', 'smtpHost', 'smtpUser', 'smtpPass'].forEach((id) => {
            const yuanSu = $(id);
            if (yuanSu) yuanSu.value = '';
          });
          $('smtpXiaoXi').textContent = t('instances.saved');
        } else {
          $('smtpXiaoXi').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('provLieBiao');
      /**
       * 顺序：**新添加的排在最上面**（列表是追加进 state 的，所以这里倒着渲染）。
       * 用户刚加完一个供应商就能在第一个看到它，不用往下翻。
       */
      [...state.providers].reverse().forEach((pr) => {
        const yuanSu = document.createElement('div');
        yuanSu.className = 'provKa';
        // 名称重复 ⇒ 这张卡片整体不可用：输入框与它下面的模型一起标红并给出原因
        const nameDup = providerLabelDupCount(pr.biaoQian, pr.id) > 0;
        /**
         * 「拉取模型」可用性（产品要求）：**名称 / 接口地址 / API Key 任一没填 ⇒ 按钮灰、点不动**。
         * 例外：`protocol === 'ollama'` 这类**本来不需要密钥**的协议 —— 密钥字段对它不适用，
         * 不算"没填写"（否则 Ollama 永远拉不了模型）。缺失项写进按钮 biaoTi，说清缺什么。
         */
        const keyRequired = pr.protocol !== 'ollama';
        const quShiDe = [];
        if (!String(pr.biaoQian || '').trim()) quShiDe.push(t('settings.fieldName'));
        if (!String(pr.baseURL || '').trim()) quShiDe.push(t('settings.fieldBaseUrl'));
        if (keyRequired && !String(pr.apiKey || '').trim() && !pr.hasKey) quShiDe.push(t('settings.fieldApiKey'));
        const laQuJiuXu = quShiDe.length === 0;
        const laQuBiaoTi = laQuJiuXu ? t('settings.fetchModels') : fmtKey('settings.fetchDisabledHint', { fields: quShiDe.join(' / ') });
        yuanSu.innerHTML =
          '<div class="provHead" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.biaoQian) + '</span>' +
          '<span style="display:flex;gap:6px;align-items:center">' +
          '<button class="anNiuXiao" data-prov-del="' + escapeHtml(pr.id) + '" title="' + escapeHtml(t('settings.pluginUninstall')) + '">' + escapeHtml(t('settings.pluginUninstall')) + '</button>' +
          '</span>' +
          '</div>' +
          '<div class="shiLiHang">' +
          '<div class="field"><label>' + escapeHtml(t('settings.providerName')) + '</label><input data-k="biaoQian" class="' + (nameDup ? 'dup' : '') + '" value="' + escapeHtml(pr.biaoQian) + '" title="' + (nameDup ? escapeHtml(t('settings.providerNameDup')) : '') + '"/></div>' +
          '<div class="field"><label>' + escapeHtml(t('settings.baseUrl')) + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"' +
          (pr.protocol === 'ollama'
            ? ' placeholder="http://127.0.0.1:11434" title="Ollama 原生 API 根地址（默认 http://127.0.0.1:11434；远程请改成对方主机）；不要加 /v1"'
            : '') +
          '/></div>' +
          '<div class="field"><label>' + escapeHtml(t('settings.apiKey')) + '</label>' +
          '<div class="miYaoHang"><input data-k="apiKey" type="password" value="' + escapeHtml(pr.apiKey || '') + '" placeholder="' + escapeHtml(pr.hasKey && !pr.apiKey ? t('settings.keySaved') : t('settings.keyEmpty')) + '"/>' +
          '<button type="button" class="miYaoYan" data-key-eye="' + escapeHtml(pr.id) + '" title="' + escapeHtml(tOr('settings.keyReveal', '显示/隐藏密钥')) + '" aria-label="' + escapeHtml(tOr('settings.keyReveal', '显示/隐藏密钥')) + '">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>' +
          '</button></div></div>' +
          '</div>' +
          '<div class="provDongZuoJi"><button class="anNiuXiao" data-fetch' + (laQuJiuXu ? '' : ' disabled') + ' title="' + escapeHtml(laQuBiaoTi) + '">' + escapeHtml(t('settings.fetchModels')) + '</button></div>' +
          '<div class="moXingHang">' +
          (((pr.models || [])
            .map((m) => {
              const usedBy = modelUsageCache.get(m) || [];
              const inUse = usedBy.length > 0;
              const GuoQi = !!(pr.staleModels && pr.staleModels[m]);
              const zhongFu = nameDup;
              /**
               * 悬停必须说清**为什么红**：重名 > 需重新拉取 > 正在被谁占用（可叠加）。
               */
              const tips = [];
              if (zhongFu) tips.push(t('settings.providerNameDup'));
              if (GuoQi) tips.push(fmtKey('settings.modelStaleTip', {}));
              if (inUse) tips.push(fmtKey('settings.modelInUseTip', { shui: usedBy.join(' / ') }));
              if (!tips.length) tips.push(t('settings.modelSetDefault'));
              return '<span class="moXingChip' + ((inUse || GuoQi || zhongFu) ? ' ruShiYong' : '') + '" data-m="' + escapeHtml(m) + '" title="' + escapeHtml(tips.join(' · ')) + '">' +
                escapeHtml(m) +
                (function () {
                  const nl = (window.__moXingNengLi || {})[m] || {};
                  const k = nl.kind && nl.kind !== 'unknown' ? ' <span class="moXingKind">' + escapeHtml(kindWenAn(nl.kind)) + '</span>' : '';
                  const c = nl.contextLen ? ' <span class="moXingCtx">' + escapeHtml(shangXiaWenBiaoQian(nl.contextLen)) + '</span>' : '';
                  return k + c;
                })() +
                '<button class="x" data-del="' + escapeHtml(m) + '" title="' + escapeHtml(t('settings.removeModel')) + '">×</button></span>';
            })
            .join('')) || '<span class="jingYin">' + escapeHtml(t('settings.modelsEmpty')) + '</span>') +
          '</div>' +
          '<div class="jingYin" data-models-note style="font-size:11px">' +
          escapeHtml([nameDup ? t('settings.providerNameDup') : '', pr.lastFetchError || ''].filter(Boolean).join(' · ')) +
          (pr.lastFetchError
            ? ' <button type="button" class="anNiuXiao" data-retry title="' + escapeHtml(tOr('common.retry', '重试')) + '">' + escapeHtml(tOr('common.retry', '重试')) + '</button>'
            : '') +
          '</div>';
        // 密钥眼睛：切换明文/密文（明文只在本窗口内存里，落盘仍走 safeStorage）
        yuanSu.querySelectorAll('[data-key-eye]').forEach((eye) => {
          eye.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const inp = yuanSu.querySelector('input[data-k="apiKey"]');
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            eye.classList.toggle('qiYong', show);
          };
        });
        yuanSu.querySelectorAll('input[data-k]').forEach((input) => {
          // 记录卡片渲染时的原值，change 时与它比（input 事件会先改 pr，不能拿 pr 当 before）
          input.dataset.prev = input.value;
          input.addEventListener('input', () => {
            const key = input.dataset.k;
            pr[key] = input.value;
          });
          input.onchange = async () => {
            const key = input.dataset.k;
            const before = input.dataset.prev;
            pr[key] = input.value;
            input.dataset.prev = input.value;
            if (before === input.value) return;
            /**
             * 产品规则（本轮修正）：改**名称 / 接口地址 / 密钥**任何一项，
             * 该供应商下的模型**全部不删**，而是先标红（stale）＝"可能无法正常使用，
             * 需要重新拉取模型"。重新拉取之后才做取舍：
             *   · 又被拉到的模型 → 恢复正常
             *   · 没被拉到且**没人在用** → 直接删除
             *   · 没被拉到但**正在被使用** → 保留并保持标红，悬停显示占用位置
             */
            if (key === 'biaoQian' || key === 'baseURL' || key === 'apiKey') {
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
              const yiLeiXing = input.value;
              const r = await window.warmy.providerKeySet?.({ providerId: pr.id, apiKey: yiLeiXing });
              if (r?.ok) {
                pr.hasKey = true;
                // 保留明文在本窗口内存（用户要求「密钥始终显示」）；落盘仍是 safeStorage 密文
                pr.apiKey = yiLeiXing;
                input.placeholder = t('settings.keySaved');
              } else {
                const note = yuanSu.querySelector('[data-models-note]');
                if (note) note.textContent = fmtKey('settings.keySaveFailed', { err: String(r?.error || '') });
              }
            }
            /**
             * **只同步「当前生效」那一家**：改任何供应商的字段都不得把生效供应商
             * 劫持成这一家（真事故：加了个 Ollama 当普通供应商，聊天就 404 了 ——
             * 用户从来没把它设成生效）。
             */
            if (pr.id === state.activeProviderId) {
              const cfg = { presetId: pr.id, baseURL: pr.baseURL, model: providerCfgModel(pr), protocol: pr.protocol };
              await window.warmy.setProvider(cfg);
            }
            await saveProviders();
            /**
             * **不再整页重渲染**：以前一改密钥就 renderPage()，
             * 用户接着点「拉取模型」时按钮已被换掉 ⇒ 第一次点了没反应、第二次才生效。
             * 只同步按钮可用态，DOM 不重建。
             */
            try {
              const btnF = yuanSu.querySelector('[data-fetch]');
              const keyOk = pr.protocol === 'ollama' || !!String(pr.apiKey || '').trim() || !!pr.hasKey;
              const nameOk = !!String(pr.biaoQian || '').trim();
              const urlOk = !!String(pr.baseURL || '').trim();
              if (btnF) {
                btnF.disabled = !(nameOk && urlOk && keyOk);
                const miss = [];
                if (!nameOk) miss.push(t('settings.fieldName'));
                if (!urlOk) miss.push(t('settings.fieldBaseUrl'));
                if (!keyOk) miss.push(t('settings.fieldApiKey'));
                btnF.title = btnF.disabled
                  ? fmtKey('settings.fetchDisabledHint', { fields: miss.join(' / ') })
                  : t('settings.fetchModels');
              }
            } catch { /* noop */ }
          };
        });
        yuanSu.querySelector('[data-fetch]').onclick = async () => {
          const btn = yuanSu.querySelector('[data-fetch]');
          const note0 = yuanSu.querySelector('[data-models-note]');
          const jiuWenBen = btn.textContent;
          /**
           * 拉取过程要有**看得见的动画**，且至少 1.7 秒（产品要求）：
           * 转圈 + 不确定进度条，直到真的拉完/报错；没到 1.7 秒就等满，别一闪而过。
           */
          const kaiShi = Date.now();
          btn.disabled = true;
          btn.classList.add('laQuZhong');
          btn.innerHTML = '<span class="laQuZhuan" aria-hidden="true"></span>' + escapeHtml(t('common.loading'));
          if (note0) note0.innerHTML = '<div class="laQuJinDu"><div class="laQuJinDuTiao"></div></div>';
          let r = null;
          try {
            // 拉取模型**只用本卡的端点/密钥**（listModels 自带 providerId），不改生效供应商
            r = await window.warmy.listModels({ protocol: pr.protocol, baseURL: pr.baseURL, providerId: pr.id });
            // 记下模型能力（种类 / 上下文长度 / 视觉 / 思考），界面上按它过滤与标注
            if (r && r.nengLi) {
              window.__moXingNengLi = Object.assign({}, window.__moXingNengLi || {}, r.nengLi);
            }
          } catch (e) {
            r = { ok: false, error: String(e && e.message || e) };
          }
          const shengYu = 1700 - (Date.now() - kaiShi);
          if (shengYu > 0) await new Promise((zhong) => setTimeout(zhong, shengYu));
          if (!r) r = { ok: false, error: t('common.error') };
          if (r?.ok && r.models?.length) {
            pr.lastFetchError = '';
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
            showToast(tOr('settings.modelsFetched', '已拉取') + '：' + pr.models.length + ' ' + tOr('settings.modelsUnit', '个模型'));
          } else {
            // 拉取失败**照实说**：不清空已有模型，也不假装成功（标红状态保持原样）
            const msg = fmtKey('settings.modelsFetchFailed', { err: String(r?.error || t('common.error')) });
            pr.lastFetchError = msg;
            if (note0) note0.textContent = msg;
            uiAlert(msg, t('settings.fetchModels'));
          }
          /**
           * **先出结果、再收动画**：以前先把「忙」标志撤了才写提示，
           * 用户（与门禁）正好卡在那个空窗里看到"没反应/没提示"。
           */
          btn.disabled = false;
          btn.classList.remove('laQuZhong');
          btn.textContent = jiuWenBen;
          await saveProviders();
          renderPage();
        };
        // 失败后的「重试」：同一个拉取动作（含动画与错误提示）
        yuanSu.querySelector('[data-retry]')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          yuanSu.querySelector('[data-fetch]')?.click();
        });
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
        yuanSu.querySelectorAll('.moXingChip').forEach((chip) => {
          chip.onclick = async () => {
            pr.defaultModel = chip.dataset.m;
            // 只有这一家**就是**生效供应商时才同步给主进程（绝不劫持）
            if (pr.id === state.activeProviderId) {
              await window.warmy.setProvider({
                presetId: pr.id,
                baseURL: pr.baseURL,
                model: pr.defaultModel,
                protocol: pr.protocol,
              });
            }
            await saveProviders();
            renderPage();
          };
        });
        prov.appendChild(yuanSu);
      });
      // ── 供应商预设（常用 10 家 + 其他）──
      const GONGYING_YUSHE = [
        { id: 'deepseek', biaoQian: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1' },
        { id: 'mimo', biaoQian: 'MiMo', protocol: 'openai-compatible', baseURL: 'https://api.xiaomimimo.com/v1' },
          { id: 'openai', biaoQian: t('settings.provider.openai'), protocol: 'openai-compatible', baseURL: 'https://api.openai.com/v1' },
        { id: 'moonshot', biaoQian: t('settings.provider.moonshot'), protocol: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1' },
        { id: 'zhipu', biaoQian: t('settings.provider.zhipu'), protocol: 'openai-compatible', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
        { id: 'dashscope', biaoQian: t('settings.provider.dashscope'), protocol: 'openai-compatible', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        { id: 'siliconflow', biaoQian: t('settings.provider.siliconflow'), protocol: 'openai-compatible', baseURL: 'https://api.siliconflow.cn/v1' },
        { id: 'openrouter', biaoQian: t('settings.provider.openrouter'), protocol: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1' },
        { id: 'anthropic', biaoQian: t('settings.provider.anthropic'), protocol: 'anthropic', baseURL: 'https://api.anthropic.com' },
        { id: 'gemini', biaoQian: t('settings.provider.gemini'), protocol: 'openai-compatible', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
        { id: 'ollama', biaoQian: 'Ollama (本机)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434' },
        { id: 'ollama-remote', biaoQian: t('settings.provider.ollamaCloud'), protocol: 'ollama', baseURL: 'http://127.0.0.1:11434' },
        { id: 'groq', biaoQian: t('settings.provider.groq'), protocol: 'openai-compatible', baseURL: 'https://api.groq.com/openai/v1' },
        { id: 'mistral', biaoQian: t('settings.provider.mistral'), protocol: 'openai-compatible', baseURL: 'https://api.mistral.ai/v1' },
        { id: 'together', biaoQian: t('settings.provider.together'), protocol: 'openai-compatible', baseURL: 'https://api.together.xyz/v1' },
        { id: 'fireworks', biaoQian: t('settings.provider.fireworks'), protocol: 'openai-compatible', baseURL: 'https://api.fireworks.ai/inference/v1' },
        { id: 'perplexity', biaoQian: t('settings.provider.perplexity'), protocol: 'openai-compatible', baseURL: 'https://api.perplexity.ai' },
        { id: '__other__', biaoQian: t('settings.providerOther'), protocol: 'openai-compatible', baseURL: '' },
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
      function providerLabelDupCount(biaoQian, selfId) {
        const n = normProvLabel(biaoQian);
        if (!n) return 0;
        return (state.providers || []).filter((p) => p.id !== selfId && normProvLabel(p.biaoQian) === n).length;
      }
      /** 预设名重复时自动加 _2 / _3 …（用户仍可自行改名） */
      function uniqueProviderLabel(biaoQian) {
        const base = String(biaoQian || '').trim();
        if (!base) return '';
        let i = 1;
        let candidate = base;
        const taken = new Set((state.providers || []).map((p) => normProvLabel(p.biaoQian)));
        while (taken.has(normProvLabel(candidate))) {
          i += 1;
          candidate = `${base}_${i}`;
        }
        return candidate;
      }

      async function collectModelUsage() {
        const usage = new Map();   // modelId -> [shui]
        const add = (id, shui) => {
          const k = String(id || '').trim();
          if (!k) return;
          const cur = usage.get(k) || [];
          if (!cur.includes(shui)) cur.push(shui);
          usage.set(k, cur);
        };
        (state.instances || []).forEach((inst) => {
          const mingCheng = mingOf(inst) || inst.id;
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
        const yuanSu = $('provCount');
        if (yuanSu) yuanSu.textContent = `${state.providers.length}/${PROVIDER_MAX}`;
      }

      (function bindPresetSelect() { try { tianChongYuSheXiaLa(); } catch (e) { console.error('provPreset', e); } })();

      provCount();
      // 兜底：若预设下拉仍为空，再填一次（防 renderPage 中途异常导致未执行）
      setTimeout(() => {
        try {
          const sel = $('provPreset');
          if (sel && sel.options.length <= 1) {
            const picks = (typeof GONGYING_YUSHE !== 'undefined' ? GONGYING_YUSHE : [])
              .map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian) + '</option>').join('');
            sel.innerHTML = '<option value="" selected disabled>' + escapeHtml(t('settings.providerPickHint')) + '</option>' + picks;
            syncTianJiaProvBtn();
          }
        } catch { /* noop */ }
      }, 0);
      // 供应商预设填槽（兜底）
      const btnTianJiaProv = $('anNiuTianJiaProv');
      const tianJiaProvHandler = async () => {
        try {
          const sel = $('provPreset');
          const presetsNow = (typeof GONGYING_YUSHE_JIAN === 'function' ? GONGYING_YUSHE_JIAN() : (typeof GONGYING_YUSHE !== 'undefined' ? GONGYING_YUSHE : []));
          const picked = sel ? presetsNow.find((p) => p.id === sel.value) : null;
          if (!picked) { uiAlert(t('settings.providerPickFirst')); return; }
          if ((state.providers || []).length >= 50) { uiAlert(t('settings.providerMax')); return; }
          const isOther = picked.id === '__other__';
          const baseLabel = isOther ? '' : picked.biaoQian;
          state.providers.push({
            id: (isOther ? 'custom-' : picked.id + '-') + Date.now(),
            biaoQian: typeof uniqueProviderLabel === 'function' ? uniqueProviderLabel(baseLabel) : baseLabel,
            protocol: picked.protocol,
            baseURL: isOther ? '' : picked.baseURL,
            defaultModel: '',
            apiKey: '',
            hasKey: false,
            models: [],
          });
          try { await saveProviders(); } catch { /* noop */ }
          renderPage();
        } catch (e) {
          uiAlert(String(e && e.message || e));
        }
      };
      if (btnTianJiaProv) {
        btnTianJiaProv.onclick = () => { void tianJiaProvHandler(); };
        // 占位时不可点（委托会重复触发已移除）
        btnTianJiaProv.addEventListener('change', syncTianJiaProvBtn);
      }
      try { const sp = $('provPreset'); if (sp) sp.addEventListener('change', syncTianJiaProvBtn); } catch { /* noop */ }
      syncTianJiaProvBtn();
      const __unusedOldAdd = async () => {
        if (state.providers.length >= PROVIDER_MAX) {
          uiAlert(fmtKey('settings.providerMax', { n: String(PROVIDER_MAX) }));
          return;
        }
        const sel = $('provPreset');
        const presetsNow = (typeof GONGYING_YUSHE_JIAN === 'function' ? GONGYING_YUSHE_JIAN() : GONGYING_YUSHE);
        const picked = sel ? presetsNow.find((p) => p.id === sel.value) : null;
        // 占位项（"选择要添加的供应商"）不是选择：先让用户选一家，别默默给他加个不明的
        if (!picked) { uiAlert(t('settings.providerPickFirst')); return; }
        const preset = picked;
        const isOther = preset.id === '__other__';
        const baseLabel = isOther ? '' : preset.biaoQian;
        /**
         * 名称唯一：预设名重复时自动加序号后缀（用户可以再改）。
         * 产品要求：例如已经有一个 DeepSeek，再添加一个就叫 DeepSeek_2。
         */
        state.providers.push({
          id: (isOther ? 'custom-' : preset.id + '-') + Date.now(),
          biaoQian: uniqueProviderLabel(baseLabel),
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
   *     .bnHang[data-kind="net"]，不会出两条。
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
   * LAN discovery UDP stays qiYong 7799 (unchanged, elsewhere).
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
  // 当"优先池"，再经 `warmy:wangLuoDuanKouHouXuanJi`（逐个**真 bind 实测**）后才可能出现在界面上。
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
      lunShu: n(o.retryRounds, NET_DEFAULTS.retryRounds),
      backoff: Array.isArray(o.backoffMs) && o.backoffMs.length ? o.backoffMs.map(Number) : NET_DEFAULTS.backoffMs.slice(),
      tickMs: n(o.tickMs, NET_DEFAULTS.tickMs),
      reachTtlMs: n(o.reachTtlMs, NET_DEFAULTS.reachTtlMs),
    };
  }

  /** 组网层 IPC：桩优先，其次真实 IPC，都没有则 null（= 未就绪） */
  function netIpc(ming, ...args) {
    const zhuang = window.__warmyNetStub;
    if (zhuang && typeof zhuang[ming] === 'function') {
      try { return Promise.resolve(zhuang[ming](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.warmy && window.warmy[ming];
    if (typeof api === 'function') {
      try { return Promise.resolve(api(...args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.resolve(null);
  }

  /** 身份层 IPC：同上（window.warmy.identity*） */
  function idIpc(ming, ...args) {
    const zhuang = window.__warmyIdentityStub;
    if (zhuang && typeof zhuang[ming] === 'function') {
      try { return Promise.resolve(zhuang[ming](...args)); } catch (e) { return Promise.reject(e); }
    }
    const api = window.warmy && window.warmy[ming];
    if (typeof api === 'function') {
      try { return Promise.resolve(api(...args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.resolve(null);
  }

  /** 带 {ming} 变量的 i18n 文本 */
  function fmtKey(k, vars) {
    return String(t(k)).replace(/\{(\w+)\}/g, (m, ming) => (vars && ming in vars ? String(vars[ming]) : m));
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
  function netStep(s, Shi, cfg, now) {
    const next = {
      fails: s.fails,
      downSince: s.downSince,
      linkDown: s.linkDown,
      round: s.round,
      autoOff: s.autoOff,
      nextRetryAt: s.nextRetryAt || 0,
    };
    if (Shi.type === 'heartbeat-ok' || Shi.type === 'up') {
      next.fails = 0;
      next.downSince = 0;
      next.linkDown = false;
      next.round = 0;
      next.nextRetryAt = 0;
      return next;
    }
    if (Shi.type === 'heartbeat-failed') {
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
    if (Shi.type === 'retry-tick') {
      if (!next.linkDown || next.autoOff) return next;
      if (now < next.nextRetryAt) return next;
      next.round = s.round + 1;
      if (next.round >= cfg.lunShu) {
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
  function netLinkStep(Shi, now) {
    const prev = netState.link;
    const next = netStep(prev, Shi, netTuning(), now || Date.now());
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
    const mingZhong = NET_RUNGS.filter((r) => NET_RUNG_I18N[r] === k)[0];
    return mingZhong || null;
  }

  /** i18n key → 可拨入性类型（同上） */
  function netDialKindFromKey(key) {
    const k = String(key || '');
    const mingZhong = Object.keys(NET_DIALABILITY_I18N).filter((x) => NET_DIALABILITY_I18N[x] === k)[0];
    return mingZhong || null;
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
    return (state.instances || []).find((i) => i.id === id || mingOf(i) === mingCheng) || null;
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
    return { kind, remote, disabled, online, basis, zhiWen: (p && p.fp) || '' };
  }

  /** 实例是否异地：显式标记、或组网层在成员表里标过 */
  function instanceIsRemote(inst) {
    if (!inst) return false;
    if (inst.remote === true) return true;
    const zhuang = window.__warmyNetStub;
    if (zhuang && Array.isArray(zhuang.remoteInstanceIds) && zhuang.remoteInstanceIds.includes(inst.id)) return true;
    for (const qunId of Object.keys(netState.presence)) {
      const bao = netState.presence[qunId] || {};
      for (const k of Object.keys(bao)) {
        const jiLu = bao[k];
        if (jiLu && jiLu.remote && (k === inst.id || k === inst.name)) return true;
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
          const yiQianYi = [];
          if (saved.ip && String(saved.ip).trim()) yiQianYi.push(String(saved.ip).trim());
          if (Array.isArray(saved.domains)) {
            for (const d of saved.domains) {
              const v = String(d || '').trim();
              if (v && yiQianYi.indexOf(v) < 0) yiQianYi.push(v);
            }
          }
          netState.addr.publicAddresses = yiQianYi;
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
    const weiZhi = await netFetchLocal();
    const publicIp = weiZhi && weiZhi.publicIp ? String(weiZhi.publicIp).trim() : '';
    if (publicIp) {
      const LieBiao = netState.addr.publicAddresses || (netState.addr.publicAddresses = []);
      if (LieBiao.indexOf(publicIp) < 0) LieBiao.push(publicIp);
    }
    netPersist();
    netState.probe = null;
    netState.entryResults = [];
    renderNetCard();
    return { local: weiZhi, publicIp, LieBiao: (netState.addr.publicAddresses || []).slice() };
  }

  function netPersist() {
    const LieBiao = (netState.addr.publicAddresses || []).slice();
    window.warmy
      .settingsSave({
        net: {
          port: netState.addr.port,
          publicAddresses: LieBiao,
          // legacy mirrors for any older readers of the settings blob
          ip: LieBiao[0] || '',
          domains: LieBiao.slice(),
        },
      })
      .catch(() => {});
  }

  /** 把一次 netProbe 结果解析成单条 entry 的诚实结论 */
  function netParseProbeResult(r, entry) {
    if (!r || typeof r !== 'object') return { entry, caijue: 'unknown', code: 'no-ipc' };
    if (r.ok === false && !('isPublic' in r) && !('outboundOk' in r)) {
      return { entry, caijue: 'unknown', code: r.errorCode || 'probe-error' };
    }
    const isPublic = r.isPublic === true;
    const outboundOk = r.outboundOk === true;
    const lanOnly = r.lanOnly === true;
    let caijue = 'fail';
    let code = 'not-public';
    if (outboundOk && isPublic) { caijue = 'pass'; code = 'public'; }
    else if (outboundOk && lanOnly) { caijue = 'pass'; code = 'lan'; }
    else if (!outboundOk) { code = 'no-outbound'; }
    return {
      entry,
      caijue,
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
        results.push({ entry, caijue: 'fail', code: 'invalid-entry' });
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
    const v6 = netIpv6Facts(lastR && lastR.xiangQing ? lastR.xiangQing.localIpv6 : null);
    if (v6) netState.ipv6 = v6;
    const passCount = results.filter((x) => x.caijue === 'pass').length;
    const anyPass = passCount > 0;
    const anyPublic = results.some((x) => x.code === 'public');
    const allUnknown = results.length > 0 && results.every((x) => x.caijue === 'unknown');
    let caijue = 'fail';
    let code = results.length ? results[0].code : 'fail';
    if (anyPass) {
      caijue = 'pass';
      code = anyPublic ? 'public' : 'lan';
    } else if (allUnknown) {
      caijue = 'unknown';
      code = results[0].code || 'probe-error';
    } else if (results.some((x) => x.code === 'no-outbound')) {
      code = 'no-outbound';
    } else {
      code = 'not-public';
    }
    const probe = {
      caijue,
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
  async function netSetEnabled(qiYong, opts) {
    const tn = netTuning();
    if (qiYong && !(netState.probe && netState.probe.caijue === 'pass')) {
      await uiAlert(t('net.result.needPass'), t('net.switch'));
      return false;
    }
    let r = null;
    try {
      r = qiYong
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
      if (qiYong && netIsBindFailure(r)) {
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
      await uiAlert(fmtKey(qiYong ? 'net.enableFailed' : 'net.disableFailed', { err: String(r.error || '') }));
      return false;
    }
    const wasOn = netState.enabled;
    netState.enabled = !!qiYong;
    netState.ready = true;
    // R13：打开成功 → 清掉旧的"端口无法绑定"现场；并记下**实际**绑定的端口
    if (qiYong) {
      netState.bindFail = null;
      netState.portCandidates = null;
      netState.bind = r && r.bind && typeof r.bind === 'object' ? r.bind : netState.bind;
    } else {
      netState.bindFail = null;
    }
    if (qiYong) {
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
      lunShu: netTuning().lunShu,
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
    const idJi = [];
    (state.groups || []).forEach((g) => idJi.push(g.id));
    if (state.selectedChat && !idJi.includes(state.selectedChat.id)) idJi.push(state.selectedChat.id);
    for (const qunId of idJi) {
      let r = null;
      try {
        r = await netIpc('netMembersPresence', { groupId: qunId });
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
          fp: String(m.zhiWen || ''),
        };
        if (m.name) bao[String(m.name)] = bao[key]; // 成员表里 id 与显示名都可能被用来查
      });
      netState.presence[qunId] = bao;
    }
    // 去重：同一个异地成员可能同时以 id 与 ming 存在 bag 里，只算一次
    const remoteKeys = new Set();
    Object.keys(netState.presence).forEach((qunId) => {
      const bao = netState.presence[qunId] || {};
      Object.keys(bao).forEach((k) => {
        if (!bao[k] || !bao[k].remote) return;
        const inst = (state.instances || []).find((i) => i.id === k || mingOf(i) === k);
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
   * DOM 里恒只有一行 .bnHang[data-kind="net"]，所以不会同时出现两条。
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
        ti: [
          ...(info
            ? [fmtKey('net.banner.mergedBody', { fails: info.fails, secs: info.secs, lunShu: info.lunShu }), yingXiang]
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
        ti: t(gap.key),
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
        ti: [
          fmtKey('net.banner.linkBody', {
            fails: l.fails,
            secs,
            round: Math.min(l.round + 1, tn.lunShu),
            lunShu: tn.lunShu,
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
    weixian: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm-1 7h2v7h-2V9zm0 8h2v2h-2v-2z"/></svg>',
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
    if (!s) return '<span class="idV idValKong" data-empty="1">' + escapeHtml(t(placeholderKey || 'idchg.empty')) + '</span>';
    return '<span class="idV">' + escapeHtml(s) + '</span>';
  }

  function cardValue(v) {
    return cardValueWith(v, 'idchg.empty');
  }

  function idTagHtml(textKey, cls) {
    return '<span class="idBiaoQian ' + cls + '" data-tag="' + cls + '">' + escapeHtml(t(textKey)) + '</span>';
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
      ? '<div class="idKa" data-card="history">' +
        '<div class="idKaH">' + escapeHtml(t('idchg.histTitle')) + idTagHtml('idchg.cardHistoryTag', 'hist') + '</div>' +
        '<div class="idField"><span class="idK">' + escapeHtml(t('ka.email')) + '</span>' + cardValue(liShi.email) + '</div>' +
        '<div class="idField"><span class="idK">' + escapeHtml(t('ka.phone')) + '</span>' + cardValue(liShi.phone) + '</div>' +
        (liShi.capturedAt
          ? '<div class="bnTiShi">' + escapeHtml(fmtKey('idchg.historyCapturedAt', { t: new Date(liShi.capturedAt).toLocaleString() })) + '</div>'
          : '') +
        '</div>'
      : '<div class="idKa" data-card="history" data-empty-history="1">' +
        '<div class="idKaH">' + escapeHtml(t('idchg.histTitle')) + idTagHtml('idchg.cardHistoryTag', 'hist') + '</div>' +
        '<div class="idNohistory">' + escapeHtml(t('idchg.noHistory')) + '</div>' +
        '<div class="bnTiShi">' + escapeHtml(t('idchg.noHistoryHint')) + '</div>' +
        '</div>';
    const nwEmpty = !String((nw && nw.email) || '').trim() && !String((nw && nw.phone) || '').trim();
    const newHtml =
      '<div class="idKa" data-card="new">' +
      '<div class="idKaH">' + escapeHtml(t('idchg.newTitle')) + idTagHtml('idchg.cardNewTag', 'pending') + '</div>' +
      '<div class="idField"><span class="idK">' + escapeHtml(t('ka.email')) + '</span>' + cardValue(nw && nw.email) + '</div>' +
      '<div class="idField"><span class="idK">' + escapeHtml(t('ka.phone')) + '</span>' + cardValue(nw && nw.phone) + '</div>' +
      (nw && nw.submittedAt
        ? '<div class="bnTiShi">' + escapeHtml(fmtKey('idchg.newSubmittedAt', { t: new Date(nw.submittedAt).toLocaleString() })) + '</div>'
        : '') +
      (nwEmpty ? '<div class="bnTiShi">' + escapeHtml(t('idchg.newEmptyHint')) + '</div>' : '') +
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
      '<div class="idKa">' + histHtml + newHtml + '</div>' +
      (changed ? '<div class="bnTiShi id-contact-warn" data-changed="1">' + escapeHtml(t('idchg.contactChanged')) + '</div>' : '') +
      (nowText ? '<div class="bnTiShi">' + escapeHtml(nowText) + '</div>' : '') +
      '<div class="bnTiShi id-freeze" data-freeze="' + (dec.frozen ? '1' : '0') + '" data-adopted="' + (dec.adopted ? '1' : '0') + '">' +
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
    const summary = escapeHtml(t('idchg.oldEmail')) + ' ' + (liShi ? String(liShi.email || '').trim() || t('idchg.empty') : t('idchg.noHistory')) + ' · ' + escapeHtml(t('idchg.oldPhone')) + ' ' + (liShi ? String(liShi.phone || '').trim() || t('idchg.empty') : t('idchg.noHistory'));
    return (
      '<div class="idTiaoMu' + (collapsed ? ' isCollapsed' : '') + '" data-cid="' + cid + '"' +
      ' data-scope-basis="' + escapeHtml(String(c.scopeBasis || '')) + '">' +
      '<div class="idHead">' +
      '<span class="idBiaoTi">' + escapeHtml(fmtKey('idchg.titleNamed', { ming: c.subjectName || c.subjectId || '—' })) + '</span>' +
      '<span class="idPending">' + escapeHtml(t('idchg.pending')) + '</span>' +
      (scopeLabelOf(c) ? '<span class="idScope">' + escapeHtml(scopeLabelOf(c)) + '</span>' : '') +
      (c.generation ? '<span class="idGen">' + escapeHtml(fmtKey('idchg.generation', { n: c.generation })) + '</span>' : '') +
      '</div>' +
      '<div class="idZhaiYao">' + escapeHtml(summary) + '</div>' +
      '<div class="idXiangQing">' +
      '<div class="bnTi">' +
      escapeHtml(
        fmtKey('idchg.ti', {
          old: c.oldFingerprint || '—',
          new: c.newFingerprint || '—',
          gen: c.generation || '—',
          at,
        })
      ) +
      '</div>' +
      idContactCardsHtml(c) +
      '<div class="bnTiShi">' + escapeHtml(t('idchg.emptyHint')) + '</div>' +
      (reasonKey ? '<div class="bnTiShi">' + escapeHtml(t('idchg.reason')) + ': ' + escapeHtml(t(reasonKey)) + '</div>' : '') +
      '</div>' +
      '<div class="bnDongZuoJi">' +
      '<button class="anNiuXiao" data-bn="idCollapse" data-cid="' + cid + '">' +
      escapeHtml(collapsed ? t('idchg.expand') : t('idchg.collapse')) +
      '</button>' +
      '<button class="anNiuXiao" data-bn="idAdopt" data-cid="' + cid + '"' + (dec.frozen || dec.adopted ? ' disabled' : '') +
      ' title="' + escapeHtml(dec.frozen ? t('idchg.adoptFrozen') : t('idchg.adopt')) + '">' + escapeHtml(t('idchg.adopt')) + '</button>' +
      '<button class="anNiuXiao" data-bn="idDismiss" data-cid="' + cid + '">' + escapeHtml(t('idchg.dismiss')) + '</button>' +
      '<button class="anNiuZhuYao" data-bn="idVerify" data-cid="' + cid + '" title="' + escapeHtml(t('idchg.verifiedHint')) + '">' +
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
    const chat = $('liaoTianBuJu');
    if (chat && chat.classList.contains('yinCang')) return null;
    const all = idForSession(sel);
    if (!all.length) return null;
    const kejian = all.filter((c) => !bnHidden(String(c.id)));
    const markerOnly = kejian.length === 0;
    const collapsedAll = !markerOnly && kejian.every((c) => idchgState.collapsed[String(c.id)]);
    return { all, kejian, markerOnly, collapsedAll, total: all.length };
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
    const host = $('wangLuoBanner');
    if (!host) return;
    // 先推进"终态发生次数"，再算模型（模型的 sig 里带这个序号）
    netGapEpisode(netRelayGap());
    const netRow = netBannerModel();
    const idRow = idRowModel();
    const sig = JSON.stringify([
      netRow ? [netRow.sig, netRow.title, netRow.ti, netRow.tone, netRow.showTurnOn] : null,
      idRow ? [idRow.total, idRow.markerOnly, idRow.collapsedAll, idRow.all.map((c) => String(c.id))] : null,
      state.selectedChat ? state.selectedChat.id : '',
    ]);
    if (sig === netState.renderedSig) return;
    netState.renderedSig = sig;

    const rows = [];
    if (netRow) {
      rows.push(
        '<div class="bnHang net-row tone-' + netRow.tone + '" data-kind="net" data-sig="' + escapeHtml(netRow.sig) +
          '" data-terminal="' + (netRow.terminal ? '1' : '0') + '">' +
          '<span class="bnIco">' + BN_ICON[netRow.tone] + '</span>' +
          '<div class="bnZhu">' +
          '<div class="bnBiaoTi">' + escapeHtml(netRow.title) + '</div>' +
          '<div class="bnTi">' + escapeHtml(netRow.ti) + '</div>' +
          (netRow.tone === 'danger' && !netRow.terminal ? '<div class="bnTi">' + escapeHtml(t('net.banner.autoOff')) + '</div>' : '') +
          '<div class="bnDongZuoJi">' +
          (netRow.showTurnOn
            ? '<button class="anNiuXiao" data-bn="turnOn">' + escapeHtml(t('net.banner.turnOn')) + '</button>'
            : '') +
          (netRow.action === 'relaySettings'
            ? '<button class="anNiuZhuYao" data-bn="relaySettings">' + escapeHtml(t('net.banner.relayConfigure')) + '</button>'
            : '') +
          '<button class="anNiuXiao" data-bn="netDismiss" data-sig="' + escapeHtml(netRow.sig) + '">' + escapeHtml(t('net.banner.close')) + '</button>' +
          '<span class="bnTiShi">' + escapeHtml(t('net.banner.dismissHint')) + '</span>' +
          '</div>' +
          '</div>' +
          '<button class="bnx" data-bn="netDismiss" data-sig="' + escapeHtml(netRow.sig) + '" title="' + escapeHtml(t('net.banner.close')) + '">×</button>' +
          '</div>'
      );
    }
    if (idRow) {
      const items = idRow.markerOnly
        ? '<div class="bnTiShi">' + escapeHtml(t('idchg.audited') + ' · ' + t('idchg.marker')) + '</div>'
        : idRow.kejian.map(idChangeItemHtml).join('');
      rows.push(
        '<div class="bnHang idHang" data-kind="idchg" data-marker="' + (idRow.markerOnly ? '1' : '0') + '">' +
          '<span class="bnIco">' + BN_ICON.weixian + '</span>' +
          '<div class="bnZhu">' +
          '<div class="bnHead">' +
          '<span class="bnBiaoTi">' + escapeHtml(t('idchg.biaoTi')) + '</span>' +
          '<span class="idMarker" data-marker="1">' + escapeHtml(t('idchg.marker')) + ' · ' + idRow.total + '</span>' +
          '</div>' +
          items +
          (idRow.markerOnly
            ? '<div class="bnDongZuoJi"><button class="anNiuXiao" data-bn="idExpandAll">' + escapeHtml(t('idchg.expand')) + '</button></div>'
            : '') +
          '</div>' +
          '</div>'
      );
    }

    host.innerHTML = rows.join('');
    const any = rows.length > 0;
    host.classList.toggle('yinCang', !any);
    const main = $('zhuLan');
    if (main) main.classList.toggle('hasBanner', any);
    requestAnimationFrame(() => {
      const h = any ? host.offsetHeight : 0;
      document.documentElement.style.setProperty('--banner-h', h + 'px');
    });
  }

  function bindBannerHost() {
    const host = $('wangLuoBanner');
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
        if (netState.probe && netState.probe.caijue === 'pass') await netSetEnabled(true);
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
          // 身份层真实形状是「按指纹手动确认采用对方的新名片」（warmy:shenFenDuiDuanQueRen）
          const fp = String((ch && (ch.newFingerprint || ch.zhiWen)) || '');
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
    if (p.caijue === 'pass') {
      const total = Number(p.total || (p.entries && p.entries.length) || 0);
      const passCount = Number(p.passCount || 0);
      const partial = total > 0 && passCount > 0 && passCount < total
        ? ' · ' + fmtKey('net.partialPass', { pass: passCount, total })
        : '';
      if (p.code === 'lan') return { text: t('net.result.passLan') + partial, cls: 'wangLuook' };
      // 「公网可达」是**强断言**：它要求别人真的能拨进来。而检测实际只验了两件事
      // ——「地址是公网」+「出站能连通」；入站可达性要第三方对端拨回才算验过。
      // 没验过就照实补一句，不要把「地址是公网」说成「可达」（附八.3 的诚实性要求）。
      const tail = t('net.result.passUnverifiedInbound');
      return { text: t('net.result.pass') + tail + partial, cls: 'wangLuook' };
    }
    if (p.code === 'no-ipc' || p.code === 'probe-error') return { text: t('net.result.unknown'), cls: 'wangLuoBad' };
    if (p.code === 'no-outbound') return { text: t('net.result.failOutbound'), cls: 'wangLuoBad' };
    return { text: t('net.result.failPublic'), cls: 'wangLuoBad' };
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
    const tiShi = $('wangLuoDuanKouTiShi');
    const boundEl = $('wangLuoDuanKouBound');
    const conflict = $('wangLuoDuanKouConflict');
    if (!tiShi && !boundEl && !conflict) return;

    const bind = netState.bind && typeof netState.bind === 'object' ? netState.bind : null;
    // 不用"渲染签名"跳过：设置页会被整块重画（innerHTML 重建 = dataset/textContent 全丢），
    // 而签名没变 → 只靠签名的守卫会让提示永久空着。改成**按 DOM 实际值比对**：
    // 值相同就不写（不抖动），值不同就补上（重画后自愈）。
    if (tiShi) {
      const wantConvention = 'dev:' + WARMY_DEV_NET_PORT + ',test:' + WARMY_TEST_NET_PORT;
      if (tiShi.dataset.convention !== wantConvention) tiShi.dataset.convention = wantConvention;
      const wantText = fmtKey('net.portConventionHint', { kaifa: WARMY_DEV_NET_PORT, test: WARMY_TEST_NET_PORT });
      if (tiShi.textContent !== wantText) tiShi.textContent = wantText;
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
      ? [bf.port, bf.errorCode || '', bf.error || '', cur, state.yuYan,
         netState.portCandidatesLoading ? 'L' : '-', okPorts.join(','), report ? String(report.probed ? report.probed.length : 0) : '-'].join('|')
      : '';
    // 同样按 DOM 实际值比对：整个卡片重画后 dataset 会丢，签名相同也必须补画
    const domDrawn = !!conflict.getAttribute('data-sig') && conflict.getAttribute('data-sig') === netState.portConflictSig;
    if (netState.portConflictSig === csig && domDrawn) return;
    netState.portConflictSig = csig;
    conflict.setAttribute('data-sig', csig);

    if (!bf) {
      conflict.classList.add('yinCang');
      conflict.innerHTML = '';
      conflict.dataset.failPort = '';
      conflict.dataset.failCode = '';
      return;
    }

    conflict.classList.remove('yinCang');
    conflict.dataset.failPort = String(bf.port || '');
    conflict.dataset.failCode = String(bf.errorCode || '');
    conflict.dataset.failErrno = String(bf.error || '');
    conflict.dataset.suggestState = netState.portCandidatesLoading ? 'checking' : okPorts.length ? 'ok' : 'none';

    let suggestHtml;
    if (netState.portCandidatesLoading) {
      suggestHtml = '<div class="jingYin wangLuoConflictTiShi" id="wangLuoDuanKouSuggestTai">' + escapeHtml(t('net.portSuggestChecking')) + '</div>';
    } else if (okPorts.length) {
      suggestHtml =
        '<div class="jingYin wangLuoConflictTiShi" id="wangLuoDuanKouSuggestTai">' +
        escapeHtml(fmtKey('net.portSuggestMeasured', { probed: String(report && report.probed ? report.probed.length : okPorts.length) })) +
        '</div>' +
        '<div class="wangLuoDuanKouSuggest" id="wangLuoDuanKouSuggest">' +
        okPorts.map((p) => '<button type="button" class="anNiuXiao wangLuoDuanKouSuggestAnNiu" data-port="' + p + '" data-status="ok">' + p + '</button>').join('') +
        '</div>';
    } else {
      suggestHtml = '<div class="jingYin wangLuoConflictTiShi" id="wangLuoDuanKouSuggestTai">' + escapeHtml(t('net.portSuggestNone')) + '</div>';
    }

    conflict.innerHTML =
      '<div class="wangLuoConflictBiaoTi">' + escapeHtml(t('net.portBindFailedTitle')) + '</div>' +
      '<div class="wangLuoConflictTi">' +
      escapeHtml(fmtKey('net.portBindFailedBody', { port: String(bf.port || ''), error: String(bf.error || bf.errorCode || '') })) +
      '</div>' +
      suggestHtml +
      '<div class="jingYin wangLuoConflictTiShi">' + escapeHtml(t('net.portSuggestHint')) + '</div>' +
      '<div><button type="button" class="anNiuXiao" id="anNiuWangLuoDuanKouSuggestRefresh">' + escapeHtml(t('net.portSuggestRefresh')) + '</button></div>';

    const shuaxinAnniu = $('anNiuWangLuoDuanKouSuggestRefresh');
    if (shuaxinAnniu) shuaxinAnniu.onclick = () => void netFetchPortCandidates();

    const suggestBox = $('wangLuoDuanKouSuggest');
    if (suggestBox) {
      suggestBox.onclick = (Shi) => {
        const btn = Shi && Shi.target && Shi.target.closest ? Shi.target.closest('.wangLuoDuanKouSuggestAnNiu') : null;
        if (!btn) return;
        const input = $('wangLuoDuanKou');
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
    if (!$('wangLuoKa')) return;
    renderNetLadder();
    renderNetDomains();
    renderNetEntryResults();
    renderNetProbeState();
    renderNetPortHint();
    const helpBtn = $('anNiuWangLuoHelp');
    if (helpBtn && !helpBtn.dataset.bound) {
      helpBtn.dataset.bound = '1';
      helpBtn.onclick = () => {
        const heZi = $('wangLuoHelpHe');
        if (!heZi) return;
        heZi.classList.toggle('yinCang');
        heZi.textContent = t('net.helpBody');
      };
    }
  }

  /**
   * 连接阶梯区块（`#wangLuoLadder`）：六个档位**全部列出来**并标出当前档，
   * 再给出中继状态与本机可拨入性。全部文案走 i18n（未实现的档额外标「尚未实现（不可用）」）。
   *
   * 为什么把六档全列出来：用户要能看出"现在在哪一档、下一档是什么、哪一档还没实现"，
   * 只显示当前一档时，"打洞中"与"打洞未实现"在界面上会长得一模一样。
   */
  function renderNetLadder() {
    const heZi = $('wangLuoLadder');
    if (!heZi) return;
    const m = netLadderModel();
    const gap = netRelayGap();
    const dialKind = m.dialKind || 'undetermined';
    const sig = JSON.stringify([
      m.current, m.claimed, m.suggested, m.relayKey, m.relayCode, m.dialKind, m.dialDerived,
      m.connected, m.sessions, m.hasV6, m.ipv6Candidate, gap ? gap.key : '', state.yuYan,
    ]);
    if (heZi.dataset.sig === sig) return;
    heZi.dataset.sig = sig;
    heZi.setAttribute('data-terminal', gap ? '1' : '0');

    const items = m.rungs
      .map((rung) => {
        const unsupported = !!NET_RUNG_UNSUPPORTED[rung];
        const isCurrent = m.current === rung;
        const isSuggested = !m.current && m.suggested === rung;
        // 未实现优先于一切：即便它就是"当前档"，也只能显示成 unsupported（不许像在跑）
        const st = unsupported ? 'unsupported' : isCurrent ? 'current' : isSuggested ? 'candidate' : 'idle';
        const text = t(NET_RUNG_I18N[rung]) + (unsupported ? ' · ' + t('net.ladder.unsupported') : '');
        return (
          '<li class="wangLuoRung" data-rung="' + rung + '" data-state="' + st + '"' +
          (isCurrent ? ' aria-current="true"' : '') + '>' +
          '<span class="wangLuoRungDian" aria-hidden="true"></span>' +
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
    heZi.innerHTML =
      '<div class="wangLuoLadderHead">' + escapeHtml(t('net.ladder.biaoTi')) + '</div>' +
      '<ul class="wangLuoLadderLieBiao">' + items + '</ul>' +
      '<div class="wangLuoLadderKv" data-k="current">' +
      '<span class="wangLuoLadderK">' + escapeHtml(m.current ? t('net.ladder.current') : t('net.ladder.candidate')) + '</span>' +
      '<span class="wangLuoLadderV" id="wangLuoLadderCurrent" data-rung="' + escapeHtml(currentRung || '') +
      '" data-derived="' + (m.current ? '0' : '1') + '" data-claimed="' + escapeHtml(m.claimed || '') + '">' +
      escapeHtml(currentText) + '</span></div>' +
      '<div class="wangLuoLadderKv" data-k="relay">' +
      '<span class="wangLuoLadderK">' + escapeHtml(t('net.ladder.relay')) + '</span>' +
      '<span class="wangLuoLadderV" id="wangLuoLadderRelay" data-code="' + escapeHtml(m.relayCode) +
      '" data-terminal="' + (gap ? '1' : '0') + '">' + escapeHtml(t(m.relayKey)) + '</span></div>' +
      '<div class="wangLuoLadderKv" data-k="dialability">' +
      '<span class="wangLuoLadderK">' + escapeHtml(t('net.ladder.dialability')) + '</span>' +
      '<span class="wangLuoLadderV" id="wangLuoLadderDial" data-kind="' + escapeHtml(dialKind) +
      '" data-derived="' + (m.dialDerived ? '1' : '0') + '">' + escapeHtml(t(NET_DIALABILITY_I18N[dialKind] || 'net.dialability.undetermined')) + '</span></div>';
  }

  /**
   * 公网地址列表（IP + 域名混合）。标签在 HTML 里只出现一次（#wangLuoPublicLieBiaoBiaoQian），
   * 这里空态文案使用**另一个** key，避免旧缺陷里「域名标签渲染两次」。
   */
  function renderNetDomains() {
    if (!$('wangLuoKa')) return;
    const heZi = $('wangLuoDomains');
    if (!heZi) return;
    const LieBiao = netState.addr.publicAddresses || [];
    heZi.innerHTML = LieBiao.length
      ? LieBiao
          .map(
            (d, i) =>
              '<div class="wangLuoDomainHang" data-di="' + i + '">' +
              '<input class="net-domain-input" data-di="' + i + '" value="' + escapeHtml(d) + '" placeholder="' +
              escapeHtml(t('net.domainPlaceholder')) + '"/>' +
              '<button class="anNiuXiao" data-domain-del="' + i + '">' + escapeHtml(t('net.domainRemove')) + '</button>' +
              '</div>'
          )
          .join('')
      : '<div class="jingYin">' + escapeHtml(t('net.publicListEmpty')) + '</div>';
    heZi.querySelectorAll('[data-domain-del]').forEach((b) => {
      b.onclick = () => {
        (netState.addr.publicAddresses || []).splice(Number(b.dataset.domainDel), 1);
        netPersist();
        netInvalidateProbe();
        renderNetCard();
      };
    });
    heZi.querySelectorAll('input.net-domain-input').forEach((input) => {
      input.onchange = () => {
        const i = Number(input.dataset.di);
        const v = String(input.value || '').trim();
        if (!v || !shiFouHeFaZhuJi(v)) {
          input.classList.add('wangLuoInvalid');
          return;
        }
        input.classList.remove('wangLuoInvalid');
        if (!netState.addr.publicAddresses) netState.addr.publicAddresses = [];
        netState.addr.publicAddresses[i] = v;
        netPersist();
        netInvalidateProbe();
      };
    });
  }

  /** 逐条检测结果：每个 IP / 域名一行，诚实标出通过/失败/格式错误 */
  function renderNetEntryResults() {
    const heZi = $('wangLuoEntryResults');
    if (!heZi) return;
    const rows = netState.entryResults || [];
    if (!rows.length) {
      heZi.innerHTML = '';
      return;
    }
    const labelOf = (r) => {
      if (r.caijue === 'pass') return t('net.entryOk');
      if (r.caijue === 'unknown') return t('net.entryUnknown');
      if (r.code === 'invalid-entry') return t('net.entryInvalid');
      return t('net.entryFail');
    };
    heZi.innerHTML =
      '<div class="jingYin wangLuoEntryBiaoTi">' +
      escapeHtml(t('net.entryResultsTitle') + ' · ' + fmtKey('net.probeCount', { n: rows.length })) +
      '</div>' +
      rows
        .map(
          (r) =>
            '<div class="wangLuoEntryHang" data-entry="' + escapeHtml(r.entry || '') + '" data-verdict="' +
            escapeHtml(r.caijue || '') + '" data-code="' + escapeHtml(r.code || '') + '">' +
            '<span class="wangLuoEntryHost">' + escapeHtml(r.entry || '') + '</span>' +
            '<span class="wangLuoEntryZhuangTai ' + escapeHtml(r.caijue || '') + '">' + escapeHtml(labelOf(r)) + '</span>' +
            '<span class="jingYin wangLuoEntryCode">' + escapeHtml(r.code || '') + '</span>' +
            '</div>'
        )
        .join('');
  }

  /** 检测结论 + 开关（地址被改动时只刷这一块，不动输入框） */
  function renderNetProbeState() {
    if (!$('wangLuoKa')) return;
    const tn = netTuning();
    const res = $('wangLuoTanCeResult');
    if (res) {
      const v = netProbeView();
      const p = netState.probe;
      const xiangQing = [];
      if (p && p.at) xiangQing.push(fmtKey('net.result.at', { t: new Date(p.at).toLocaleString() }));
      if (p && p.method) xiangQing.push(fmtKey('net.result.method', { m: p.method }));
      if (p && p.behindNat) xiangQing.push(t('net.result.behindNat'));
      res.innerHTML =
        (v.text ? '<div class="wangLuoTanCeXian ' + v.cls + '">' + escapeHtml(v.text) + '</div>' : '') +
        (xiangQing.length ? '<div class="jingYin">' + escapeHtml(xiangQing.join(' · ')) + '</div>' : '');
    }
    const pass = !!(netState.probe && netState.probe.caijue === 'pass');
    const sw = $('wangLuoSwitch');
    if (sw) {
      sw.checked = !!netState.enabled;
      sw.disabled = !netState.enabled && !pass;
      sw.title = pass || netState.enabled ? t('net.switch') : t('net.result.needPass');
      // B2：禁用态在整行上打标，视觉 + cursor: not-allowed
      const hang = sw.closest('.wangLuoSwitchHang');
      if (hang) hang.classList.toggle('isJinYong', !!sw.disabled);
    }
    const xiaoXi = $('wangLuoSwitchXiaoXi');
    if (xiaoXi) {
      xiaoXi.textContent = netState.enabled
        ? fmtKey('net.switchOn', { port: netState.addr.port || tn.port })
        : netState.probe
          ? pass
            ? t('net.switchOff')
            : t('net.switchBlocked')
          : t('net.switchNeedDetect');
    }
    const info = $('wangLuoBenJiXinXi');
    if (info) {
      const weiZhi = netState.local;
      info.textContent = weiZhi
        ? t('net.localIp') + ': ' + weiZhi.ip + (weiZhi.publicIp ? ' · ' + escapeHtml(t('net.publicIp')) + ': ' + weiZhi.publicIp : '')
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
    const LieBiao = (dirs || []).map((d) => String(d || '').trim()).filter(Boolean);
    const MAX = 10;
    if (LieBiao.length > MAX) return { ok: false, error: 'too-many-dirs', max: MAX, count: LieBiao.length };
    try {
      if (window.warmy.skillsScanDirsSet) return await window.warmy.skillsScanDirsSet(LieBiao);
      await window.warmy.settingsSave({ skillScanDirs: LieBiao });
      return { ok: true, dirs: LieBiao };
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
    const heZi = $('jinengSaoMiaoMuLuJi');
    if (!heZi) return;
    const xiaoXi = $('jinengSaoMiaoXiaoXi');
    const r = await skillScanDirsGet();
    const dirs = (r && r.dirs) || [];
    const status = (r && r.scanDirs) || [];
    const byPath = {};
    status.forEach((s) => { byPath[s.path] = s; });
    window.__skillScanState = { dirs: dirs.slice(), scanDirs: status.slice(), lastResult: r };
    if (!dirs.length) {
      heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('settings.skillsScanEmpty')) + '</div>';
      return;
    }
    heZi.innerHTML = dirs
      .map((p, i) => {
        const st = byPath[p] || null;
        const huai = st && st.ok === false;
        return (
          '<div class="jinengSaoMiaoHang" data-scan-i="' + i + '" data-scan-path="' + escapeHtml(p) + '" data-ok="' +
          (huai ? '0' : '1') + '">' +
          '<span class="jinengSaoMiaoLuJing">' + escapeHtml(p) + '</span>' +
          '<span class="jinengSaoMiaoZhuangTai ' + (huai ? 'bad' : 'ok') + '">' + escapeHtml(skillScanStatusText(st)) + '</span>' +
          '<button class="anNiuXiao" data-scan-edit="' + i + '">' + escapeHtml(t('settings.skillsScanEdit')) + '</button>' +
          '<button class="anNiuXiao" data-scan-del="' + i + '">' + escapeHtml(t('settings.skillsScanRemove')) + '</button>' +
          '</div>'
        );
      })
      .join('');
    heZi.querySelectorAll('[data-scan-del]').forEach((b) => {
      b.onclick = async () => {
        const i = Number(b.dataset.scanDel);
        const next = dirs.slice();
        next.splice(i, 1);
        const yunXingJieGuo = await skillScanDirsSet(next);
        if (yunXingJieGuo && yunXingJieGuo.ok === false) {
          if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanMax');
          return;
        }
        const input = $('jinengSaoMiaoMuLuShuRu');
        if (input) input.removeAttribute('data-edit-i');
        const btn = $('anNiuJinengSaoMiaoTianJia');
        if (btn) btn.textContent = t('settings.skillsScanAdd');
        await renderSkillScanDirs();
        await renderSkillList();
      };
    });
    heZi.querySelectorAll('[data-scan-edit]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.scanEdit);
        const input = $('jinengSaoMiaoMuLuShuRu');
        const btn = $('anNiuJinengSaoMiaoTianJia');
        if (input) {
          input.value = dirs[i] || '';
          input.setAttribute('data-edit-i', String(i));
        }
        if (btn) btn.textContent = t('settings.skillsScanSave');
        if (xiaoXi) xiaoXi.textContent = '';
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
    const DaoHangAnNiu = document.querySelector('#peiZhiDaoHang button[data-sec="func"]');
    if (DaoHangAnNiu) DaoHangAnNiu.click();
    const ka = $('wangLuoKa');
    if (ka && ka.scrollIntoView) ka.scrollIntoView({ kuai: 'center' });
    // R13：进组网设置页时**重新实测**一次候选端口（端口占用状况随时在变，不用旧结论）
    if (netState.bindFail) void netFetchPortCandidates();
    const focusEl = $('wangLuoDomains') && $('wangLuoDomains').querySelector('input.net-domain-input');
    if (focusEl) focusEl.focus();
    else {
      const tianJiaAnNiu = $('anNiuWangLuoDomainTianJia');
      if (tianJiaAnNiu) tianJiaAnNiu.focus();
    }
  }

  function bindNetCard() {
    const heZi = $('wangLuoKa');
    if (!heZi) return;
    const port = $('wangLuoDuanKou');
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
    const refresh = $('anNiuWangLuoRefresh');
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
    const detect = $('anNiuWangLuoDetect');
    if (detect && detect.dataset.bound !== '1') {
      detect.dataset.bound = '1';
      detect.onclick = async () => {
        const r = await netDetect();
        if (r && r.code === 'empty-list') void uiAlert(t('net.emptyList'), t('net.detect'));
        else if (r && r.code === 'invalid-port') void uiAlert(t('net.invalidPort'), t('net.port'));
      };
    }
    const addD = $('anNiuWangLuoDomainTianJia');
    if (addD && addD.dataset.bound !== '1') {
      addD.dataset.bound = '1';
      addD.onclick = () => {
        if (!netState.addr.publicAddresses) netState.addr.publicAddresses = [];
        netState.addr.publicAddresses.push('');
        renderNetCard();
        const last = $('wangLuoDomains') && $('wangLuoDomains').querySelector('input.net-domain-input:last-of-type');
        if (last) last.focus();
      };
    }
    const sw = $('wangLuoSwitch');
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
   * 名片标签/占位文案的键名：身份层（身份层还没有 `ka.*` 这套键）通过
   * identityInfo.contactI18n 声明它需要的键（CONTACT_CARD_I18N），这里照它给的用，
   * 拿不到时退回本地 ka.* 键。两套键都在 i18n 里，不会显示成 key 原文。
   */
  let identityCardI18n = null;
  function cardKey(ming, huiTui) {
    const m = identityCardI18n || {};
    const k = m[ming];
    return k && state.t && state.t[k] ? k : huiTui;
  }

  /** 本人身份（真实 IPC 已落地：warmy:shenFenXinXi；桩：identityGet） */
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
    const ka = { email: String(state.profile.email || ''), phone: '' };
    const r = await myIdentity();
    if (r && typeof r === 'object' && r.ok !== false) {
      const info = r.identity || {};
      const c = info.contactCard || r.contactCard || r.ka || {};
      if (c.email) ka.email = String(c.email);
      if (c.phone) ka.phone = String(c.phone);
      if (c.extra) ka.extra = c.extra;
    }
    return ka;
  }

  function myCardHtml(ka) {
    const c = ka || {};
    const titleKey = cardKey('biaoTi', 'ka.biaoTi');
    const emailKey = cardKey('email', 'ka.email');
    const phoneKey = cardKey('phone', 'ka.phone');
    const noteKey = cardKey('alwaysVisible', 'ka.cannotHide');
    const empty = !String(c.email || '').trim() && !String(c.phone || '').trim();
    return (
      '<div class="myKa">' +
      '<div class="idKaH">' + escapeHtml(t(titleKey)) + '</div>' +
      '<div class="idField"><span class="idK">' + escapeHtml(t(emailKey)) + '</span>' + cardValueWith(c.email, cardKey('unfilled', 'ka.empty')) + '</div>' +
      '<div class="idField"><span class="idK">' + escapeHtml(t(phoneKey)) + '</span>' + cardValueWith(c.phone, cardKey('unfilled', 'ka.empty')) + '</div>' +
      (Array.isArray(c.extra) && c.extra.length
        ? c.extra
            .map(
              (e) =>
                '<div class="idField"><span class="idK">' + escapeHtml(String(e.biaoQian || t('ka.extra'))) + '</span>' +
                cardValueWith(e.value, cardKey('unfilled', 'ka.empty')) + '</div>'
            )
            .join('')
        : '') +
      '<div class="bnTiShi">' + escapeHtml(t(noteKey)) + '</div>' +
      (empty ? '<div class="bnTiShi">' + escapeHtml(t('ka.fillInProfile')) + '</div>' : '') +
      '</div>'
    );
  }

  /** 加入动作前把「对方将看到的名片」摆在用户面前；空值显示未填写占位 */
  function shareCardConfirm(ka, titleKey) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t(titleKey || 'ka.biaoTi');
      $('duiHuaKuangTi').innerHTML = '<div class="jingYin">' + escapeHtml(t('ka.peerWillSee')) + '</div>' + myCardHtml(ka);
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.textContent = t('common.ok');
      ok.onclick = () => { root.classList.add('yinCang'); resolve(true); };
      dongZuoJi.append(cancel, ok);
      root.classList.remove('yinCang');
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
    buZhou: netStep,
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
      HangJi: () => consoleLines.slice(),
      shangXian: () => CONSOLE_CAP,
      tuomin: consoleRedact,
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

  /**
   * **语音输入（听写）** —— 产品要求：
   *   ① 点之前先确认配了「听话模型」；没配 → 如实提示去配，**不开始录音**；
   *   ② 配了 → 图标点亮，说的话由听话模型**边录边转**写进输入框；
   *   ③ 再点一下 → 停止，图标复原。
   *
   * 真事故：旧实现是"录 1.2 秒就停"，而且无视「听话模型」设置（硬发 whisper-1），
   * 转不出来的就往对话里丢一条 `[语音] xxx.webm`。
   */
  let yuYinZhuangTai = null;
  function yuYinDengJi(on) {
    const b = $('anNiuYuYin');
    if (!b) return;
    b.classList.toggle('jiLuZhong', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? tOr('chat.voiceStopTip', '正在听写…再点一下结束') : tOr('chat.voiceTip', '语音输入');
  }
  function yuYinQingLi() {
    try { yuYinZhuangTai?.rec?.state !== 'inactive' && yuYinZhuangTai?.rec?.stop(); } catch { /* noop */ }
    try { yuYinZhuangTai?.stream?.getTracks?.().forEach((tr) => tr.stop()); } catch { /* noop */ }
    yuYinZhuangTai = null;
    yuYinDengJi(false);
  }
  async function yuYinTingXie() {
    const ru = $('shuRu');
    const zt = yuYinZhuangTai;
    if (!zt || !ru) return;
    // 只在"新的一段"里加空格，避免把已有文字粘起来
    const jiBen = zt.jiBen;
    zt.busy = true;
    try {
      const chunks = zt.chunks.slice();
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buf = await blob.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const dataUrl = 'data:audio/webm;base64,' + btoa(bin);
      const asr = await window.warmy.asrTranscribe?.({ dataUrl, ext: 'webm' }).catch(() => null);
      if (asr?.ok && asr.text) {
        const jie = String(asr.text).trim();
        ru.value = jiBen + jie;
        ru.dispatchEvent(new Event('input'));
      }
    } catch { /* 单段转写失败不影响继续录 */ } finally { if (zt) zt.busy = false; }
  }
  async function yuYinKaiShi() {
    const ru = $('shuRu');
    const st = await window.warmy.tingHuaZhuangTai?.().catch(() => null);
    if (!st || !st.ready) {
      uiAlert(tOr('chat.voiceNeedAsr', '还没配「听话模型」：请先在「设置 → 模型 → 听话模型」里配一个，才能把语音转成文字。'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { uiAlert(t('chat.voiceUnsupported')); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      yuYinZhuangTai = { rec, stream, chunks: [], jiBen: (ru?.value || '') + (ru?.value ? ' ' : ''), busy: false, n: 0 };
      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size || !yuYinZhuangTai) return;
        yuYinZhuangTai.chunks.push(e.data);
        yuYinZhuangTai.n += 1;
        // 边录边转：第一段立刻转，之后每两段转一次（少发请求，也够"实时"）
        if (yuYinZhuangTai.n === 1 || yuYinZhuangTai.n % 2 === 0) void yuYinTingXie();
      };
      rec.onstop = () => { void yuYinTingXie(); };
      rec.start(3000);
      yuYinDengJi(true);
    } catch {
      uiAlert(t('chat.voiceUnsupported'));
      yuYinQingLi();
    }
  }
  /**
   * **未读角标清零**（产品要求）：点了这个聊天界面里的**任何元素**就算"看过了" ——
   * 消息区、输入框、按钮、决策卡…都算。之后列表上的角标消失。
   * 用捕获阶段，连被 preventDefault 的按钮点击也算。
   */
  (function bindUnreadAck() {
    const qing = () => {
      const sid = state.selectedChat && state.selectedChat.id;
      if (!sid) return;
      if (!state.unread || !state.unread[sid]) return;
      delete state.unread[sid];
      try { renderList(); } catch { /* noop */ }
    };
    document.addEventListener('click', (e) => {
      // ⚠️ 不能叫 `t`：会遮蔽 i18n 的 `t()`（门禁会报「renderer: 有局部 t = ...」）
      const muBiao = e.target;
      if (!muBiao || !muBiao.closest) return;
      if (muBiao.closest('#xiaoXiJi, #shuRu, #tongZhiQu, .liaoTianHead, .shuRuQu, .yunXingZhuangTai, #aiqHost, #piZhunHost, #xiangMuJiYiKuai')) qing();
    }, true);
    // 键盘输入也算（在输入框里打字 = 在看这个会话）
    document.addEventListener('keydown', (e) => {
      const muBiao = e.target;
      if (muBiao && (muBiao.id === 'shuRu' || (muBiao.closest && muBiao.closest('#shuRu')))) qing();
    }, true);
  })();

  $('anNiuYuYin') && ($('anNiuYuYin').onclick = () => {
    if (yuYinZhuangTai) { const zt = yuYinZhuangTai; try { zt.rec.stop(); } catch { /* noop */ } yuYinQingLi(); return; }
    void yuYinKaiShi();
  });
  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });
  // 输入防抖：仅更新内部状态，不触发重渲染
  const syncSendState = () => {
    const btn = $('anNiuFaSong');
    if (!btn) return;
    // 容器项目停止态：开发入口整体禁用（不是"能敲但发不出去"）
    if (($('shuRu') || {}).dataset && $('shuRu').dataset.devBlocked === '1') { btn.disabled = true; return; }
    /**
     * **有内容才能发**（真机反馈）：文字、附件（文件/图片）任一存在就算"有内容"；
     * 两个都没有才灰掉 —— 否则点了也不知道要发什么。
     */
    const youWen = !!($('shuRu')?.value || '').trim();
    const youFu = Array.isArray(state.attachments) && state.attachments.length > 0;
    btn.disabled = !(youWen || youFu);
  };
  window.__syncSendState = syncSendState;
  $('shuRu')?.addEventListener('input', () => {
    syncSendState();
    const now = Date.now();
    if (now - __inputThrottle < 100) return;
    __inputThrottle = now;
  });
  syncSendState();
  /**
   * 插入（加急 / 插话 / 排队）：点图标**弹出三个选项**（产品要求），
   * 选中哪个，图标就换成哪个（气泡 + 感叹号 / 闪电 / 十字）；不要文字、不要箭头。
   * 选中「加急」仍要二次确认（它会打断正在跑的活），取消就停在原档。
   */
  (function bindUrgency() {
    const trigger = $('jinJiTrigger');
    const caiDan = $('jinJiCaiDan');
    const dd = $('urgencyDd');
    if (!trigger || !caiDan || !dd) return;
    const LABELS = { P1: 'urgency.urgentLabel', P2: 'urgency.insertLabel', P3: 'urgency.queueLabel' };
    function refresh() {
      dd.classList.toggle('urgent', state.urgency === 'P1');
      // 只切**触发器上**的图标（菜单里三个选项的图标是并列展示的，都要看得见）
      trigger.querySelectorAll('.chaRuIco').forEach((s) => {
        s.classList.toggle('yinCang', s.dataset.u !== state.urgency);
      });
      caiDan.querySelectorAll('button[data-u]').forEach((b) => b.classList.toggle('qiYong', b.dataset.u === state.urgency));
      const ming = t(LABELS[state.urgency] || 'urgency.insertLabel');
      trigger.title = ming;
      trigger.setAttribute('aria-label', ming);
    }
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      caiDan.classList.toggle('yinCang');
      if (!caiDan.classList.contains('yinCang')) { refresh(); positionMenuFixed(trigger, caiDan); }
    });
    onDocClick(() => caiDan?.classList.add('yinCang'));

    caiDan.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');
      if (!b) return;
      const u = b.dataset.u;
      if (u === 'P1') {
        const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
        if (!ok) { caiDan.classList.add('yinCang'); refresh(); return; }
      }
      state.urgency = u;
      caiDan.classList.add('yinCang');
      refresh();
    });

    // 语言切换后刷新文案
    window.__refreshUrgency = refresh;
  })();
  // 「…」更多菜单
  $('gengDuoTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const caiDan = $('gengDuoCaiDan');
    caiDan?.classList.toggle('yinCang');
    if (caiDan && !caiDan.classList.contains('yinCang')) {
      try { xuanranGengduoCaidan(); } catch { /* noop */ }
      // 同步「仅@ai才发言」勾选态（群聊默认勾选）
      const g = (state.groups || []).find((x) => x.id === state.selectedChat?.id) || (state.chats || []).find((x) => x.id === state.selectedChat?.id);
      __directed = !!(g && g.directedMode);
      const m = $('caiDanTuBiaoDingXiangMark');
      if (m) { m.textContent = __directed ? '✓' : '✕'; }
      const am = $('caiDanTuBiaoAutoscrollMark');
      if (am) am.style.visibility = autoScrollChat ? 'visible' : 'hidden';
      positionMenuFixed($('gengDuoTrigger'), caiDan);
    }
  });
  onDocClick(() => $('gengDuoCaiDan')?.classList.add('yinCang'));
  $('caiDanTuBiaoSouSuo')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    showSearchPopup();
  });
  let __directed = false;
  $('caiDanTuBiaoDingXiang')?.addEventListener('click', async () => {
    __directed = !__directed;
    const BiaoJi = $('caiDanTuBiaoDingXiangMark');
    if (BiaoJi) BiaoJi.textContent = __directed ? '✓' : '✕';
    if (state.selectedChat) {
      await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });
  // ADR 004 第七批：「运行/测试在容器中」这个菜单项**已删除**（容器 = 开发环境，测试/运行不在其职责内）。
  // 开发环境在**创建项目时**选定；启用/停用项目与切换容器都在**项目右键菜单**里。
  $('caiDanTuBiaoDaKai')?.addEventListener('click', async () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏；任务栏图标 = 该会话头像
    const iconDataUrl = await chatAvatarDataUrl();
    window.warmy.openChatWindow({
      id: state.selectedChat.id,
      biaoTi: xianShiMing(state.selectedChat) || mingOf((state.instances||[]).find((i)=>i.id===state.selectedChat.id)) || state.selectedChat.id,
      title: xianShiMing(state.selectedChat) || mingOf((state.instances||[]).find((i)=>i.id===state.selectedChat.id)) || state.selectedChat.id,
      kind: state.selectedChat.kind,
      mode: 'fu',
      iconDataUrl,
    });
  });
  $('caiDanTuBiaoDaoChu')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
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
    const input = $('shuRu');
    const lie = $('liaoTianLan');
    // 我的牛马：实例 stopped ⇒ 只读（可看记录/右栏，不可输入发送）
    let singleStopped = false;
    try {
      if (sel && sel.kind === 'single') {
        const inst = (state.instances || []).find((x) => x.id === sel.id);
        singleStopped = !!(inst && inst.status === 'stopped');
      }
    } catch { /* noop */ }
    const xiangMuTai = sel && sel.kind === 'internal' ? await quXiangMuTai(sel.id) : null;
    const stopped = singleStopped || !!(xiangMuTai && xiangMuTai.stopped);
    if (lie) {
      lie.dataset.projectState = xiangMuTai ? (stopped ? 'stopped' : 'running') : 'none';
      lie.dataset.projectCode = xiangMuTai ? String(xiangMuTai.code) : '';
    }
    if (input) {
      input.dataset.devBlocked = stopped ? '1' : '0';
      input.disabled = stopped;
      input.title = stopped
        ? fmtKey('container.project.devBlocked', { reason: t(PROJECT_STOP_REASON(xiangMuTai ? xiangMuTai.code : 'container-not-ready', xiangMuTai ? xiangMuTai.reasonKey : '')) })
        : '';
    }
    const btn = $('anNiuFaSong');
    if (btn) {
      btn.disabled = stopped;
      btn.title = stopped ? (input ? input.title : '') : '';
    }
    // 附件/语音/紧急度等工具钮：stopped 时一并禁用（仍可看历史与右栏）
    try {
      for (const id of ['anNiuAttach', 'anNiuYuYin', 'jinJiTrigger', 'anNiuTingZhiAll']) {
        const b = $(id);
        if (b) { b.disabled = stopped; if (stopped) b.style.opacity = '0.45'; else b.style.opacity = ''; }
      }
    } catch { /* noop */ }
    syncSendState();
    return stopped;
  }

  // 本机的人敲回车 / 点「执行」→ 走 submitShellLine（主进程未就绪则**不执行任何东西**）
  $('ctgKongZhiTaiFaSong')?.addEventListener('click', () => { void submitShellLine(); });
  $('ctgKongZhiTaiShuRu')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitShellLine(); }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     诊断事件流（T194，**已降级为独立排障视图**）—— 它是本机事件日志，**不是控制台**。
     控制台 = **容器内的 shell**（`#ctgKongZhiTaiMianBan`，见 openContainerShell）。
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
    const yanma = t('console.redacted');
    let s = String(text == null ? '' : text);
    s = s.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, yanma);
    s = s.replace(/\bgh[pousr]_[A-Za-z0-9]{10,}/g, yanma);
    s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{6,}/g, yanma);
    s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, yanma);
    s = s.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? yanma : m));
    s = s.replace(
      /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|tok|secret|password|passwd|passphrase|authorization)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      (_m, k, sep) => k + sep + yanma
    );
    s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ' + yanma);
    return s;
  }

  /** 事件里的 data 直出成一行 JSON（对象不直出 [object Object]）；照样打码 */
  function consoleDataText(d) {
    try {
      const keys = Object.keys(d || {});
      if (!keys.length) return '';
      const Pian = keys.map((k) => k + '=' + String(d[k] == null ? '' : d[k]));
      return Pian.join(' ');
    } catch {
      return '';
    }
  }

  /**
   * 事件 → 一行文本。未知 code **不静默丢**：照原样显示 code + 数据（并打码）。
   * 返回 null = 这条事件不该显示（目前不会发生）。
   */
  function consoleLineText(Shi) {
    const cat = String((Shi && Shi.cat) || 'system');
    const code = String((Shi && Shi.code) || '');
    let d = Shi && Shi.data && typeof Shi.data === 'object' ? Shi.data : {};
    // 少量"展示期派生"：布尔/枚举 → i18n 词（模板只做占位符替换，不做条件判断）
    if (code === 'tool.finish') d = Object.assign({}, d, { result: d.ok === false ? t('console.result.fail') : t('console.result.ok') });
    const catLabel = fmtKey('console.cat.' + cat);
    const catText = catLabel === 'console.cat.' + cat ? cat : catLabel;
    const key = 'console.' + code;
    const yiZhi = t(key) !== key;
    const ti = yiZhi
      ? fmtKey(key, d)
      : fmtKey('console.unknown', { code: code || '?' }) + (consoleDataText(d) ? ' ' + consoleDataText(d) : '');
    const ts = new Date(Number((Shi && Shi.ts) || Date.now()) || Date.now());
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const anQuanCang = String(ts.getSeconds()).padStart(2, '0');
    return consoleRedact('[' + hh + ':' + mm + ':' + anQuanCang + '] [' + catText + '] ' + ti);
  }

  /** 一条事件进面板：格式化 → 打码 → 入队 → 超上限丢最旧 → （面板开着才）重画 */
  function consoleAppend(Shi) {
    try {
      const seq = Number(Shi && Shi.seq);
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= consoleLastSeq) return null; // 重复投递：同一 seq 只显示一次
        consoleLastSeq = seq;
      }
      const Hang = consoleLineText(Shi);
      if (!Hang) return null;
      consoleLines.push(Hang);
      const shangxian = (typeof CONSOLE_CAP === 'number' ? CONSOLE_CAP : __CONSOLE_CAP_EARLY);
      while (consoleLines.length > shangxian) consoleLines.shift();
      renderConsole();
      return Hang;
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
    const tiShi = $('kongZhiTaiTiShi');
    if (tiShi) tiShi.textContent = fmtKey('console.tiShi', { n: (typeof CONSOLE_CAP === 'number' ? CONSOLE_CAP : __CONSOLE_CAP_EARLY) });
    const btn = $('kongZhiTaiQingChu');
    if (btn) btn.textContent = t('console.clear');
    const out = $('kongZhiTaiShuChu');
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
      const off = window.warmy?.onConsoleEvent?.((Shi) => consoleAppend(Shi));
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
  $('anNiuRongQiKongZhiTai')?.addEventListener('click', () => { void openContainerShell(); });
  $('ctgKongZhiTaiGuanBi')?.addEventListener('click', () => { $('ctgKongZhiTaiMianBan')?.classList.add('yinCang'); });
  // 诊断事件流：**自己展开/收起**（不再依赖已从聊天头移除的 #anNiuKongZhiTai）
  function toggleDiagPanel(forceOpen) {
    const host = $('diagHost');
    const jianTou = $('diagJianTou');
    const daKai = forceOpen === true ? true : forceOpen === false ? false : !(host && !host.classList.contains('yinCang'));
    state.consoleOpen = !!daKai;
    host?.classList.toggle('yinCang', !daKai);
    $('kongZhiTaiMianBan')?.classList.toggle('yinCang', !daKai);
    if (jianTou) jianTou.textContent = daKai ? '⌄' : '›';
    $('anNiuKongZhiTai')?.classList.toggle('biaoTiLanQiYong', daKai);
    if (daKai) {
      try { renderConsole(); } catch { /* noop */ }
      const tiShi = $('kongZhiTaiTiShi');
      if (tiShi && !tiShi.textContent) {
        try {
          tiShi.innerHTML = escapeHtml(fmtKey('console.tiShi', { n: '200' })).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        } catch { tiShi.textContent = t('console.tiShi'); }
      }
    }
  }
  window.__toggleDiagPanel = toggleDiagPanel;
  $('anNiuKongZhiTai')?.addEventListener('click', () => { toggleDiagPanel(); });
  $('diagKaiGuan')?.addEventListener('click', () => { toggleDiagPanel(); });
  $('kongZhiTaiQingChu')?.addEventListener('click', () => { consoleClear(); });
  (function bindConsoleResize() {
    const yuanSu = $('kongZhiTaiTiaoZhengTiao');
    const mianBan = $('kongZhiTaiMianBan');
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
  /**
   * 截图：真·全屏抓取（主进程会先把窗口藏起来）→ 在应用内做**框选遮罩**：
   *   拖框选中区域 → 松手裁切并附到消息；直接单击/回车 = 用整屏；**右键 / Esc = 取消**。
   */
  function jieTuKuangXuan(cap) {
    return new Promise((resolve) => {
      const ceng = document.createElement('div');
      ceng.id = 'jieTuCeng';
      ceng.className = 'jieTuCeng';
      ceng.innerHTML =
        '<img class="jieTuDi" src="' + cap.dataUrl + '" alt=""/>' +
        '<div class="jieTuKuang yinCang"></div>' +
        '<div class="jieTuTiShi">' + escapeHtml(tOr('chat.shotHint', '拖动选择区域 · 单击/回车＝整屏 · 右键/Esc＝取消')) + '</div>';
      document.body.appendChild(ceng);
      const kuang = ceng.querySelector('.jieTuKuang');
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0, tuo = false;
      const huaKuang = () => {
        const l = Math.min(x0, x1), t = Math.min(y0, y1);
        const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        kuang.classList.toggle('yinCang', w < 4 && h < 4);
        kuang.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${h}px`;
      };
      const shouWei = () => {
        ceng.remove();
        document.removeEventListener('keydown', anJian);
      };
      const anJian = (e) => {
        if (e.key === 'Escape') { shouWei(); resolve(null); }         // Esc 取消
        else if (e.key === 'Enter') { shouWei(); resolve({ x: 0, y: 0, w: 0, h: 0 }); }  // 回车＝整屏
      };
      ceng.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;                                    // 右键由 contextmenu 处理
        tuo = true; x0 = x1 = e.clientX; y0 = y1 = e.clientY; huaKuang();
        try { ceng.setPointerCapture(e.pointerId); } catch { /* noop */ }
      });
      ceng.addEventListener('pointermove', (e) => {
        if (!tuo) return;
        x1 = e.clientX; y1 = e.clientY; huaKuang();
      });
      ceng.addEventListener('pointerup', () => {
        if (!tuo) return;
        tuo = false;
        const r = kuang.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) { shouWei(); resolve({ x: 0, y: 0, w: 0, h: 0 }); return; }  // 单击＝整屏
        shouWei();
        resolve({ x: r.left, y: r.top, w: r.width, h: r.height });
      });
      // **右键取消**
      ceng.addEventListener('contextmenu', (e) => { e.preventDefault(); shouWei(); resolve(null); });
      document.addEventListener('keydown', anJian);
      document.addEventListener('contextmenu', function yiCi(ev) { ev.preventDefault(); }, { once: true });
    });
  }
  /** 按选区裁切（截图是屏幕像素，界面是 CSS 像素，按比例换算） */
  function jieTuCaiQie(cap, qu) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const kuai = qu && qu.w > 0 && qu.h > 0
          ? { x: Math.round(qu.x * (img.naturalWidth / window.innerWidth)), y: Math.round(qu.y * (img.naturalHeight / window.innerHeight)), w: Math.round(qu.w * (img.naturalWidth / window.innerWidth)), h: Math.round(qu.h * (img.naturalHeight / window.innerHeight)) }
          : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, kuai.w); cv.height = Math.max(1, kuai.h);
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, kuai.x, kuai.y, kuai.w, kuai.h, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => resolve('');
      img.src = cap.dataUrl;
    });
  }
  $('anNiuShot')?.addEventListener('click', async () => {
    try {
      // 真·全屏截图：独立遮罩窗覆盖整个桌面框选（右键/Esc 取消、单击/回车=整屏），主进程裁切落盘
      const cap = await window.warmy.jieTuKaiShi?.();
      if (!cap || !cap.ok) { uiAlert(String((cap && cap.error) || t('common.error'))); return; }
      if (cap.cancelled) { showToast(tOr('chat.shotCancel', '已取消截图')); return; }
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const ming = `屏幕截图 ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      state.attachments.push({ name: ming, ming, path: cap.path || '', dataUrl: cap.dataUrl || '' });
      xuanranFujian();
      showToast(tOr('chat.shotDone', '已截取屏幕并附到消息'));
    } catch (e) {
      uiAlert(String(e && e.message || e));
    }
  });
  /**
   * 思考级别（聊天框图标按钮）：点开是一个**横向滑块**。
   *
   * 产品语义（真机反馈定稿）：
   *   · 滑块**左 = 灵机（关闭，最省）、右 = 自然（自动，最用力）**，就按这个顺序排；
   *   · 勾选「由牛马管理局设置」⇒ 这块聊天的思考级别**跟随该牛马在管理局里的默认档**，
   *     滑块**变灰、不可拖**（档位显示成当前跟随到的那个档）；
   *   · 取消勾选 ⇒ 可以随意拖，手动选的档位**保持**（写进设置，重启后还在）；
   *   · 默认状态就是"跟随牛马管理局"（勾上）。
   */
  (function bindThinkSlider() {
    const trigger = $('siKaoTrigger');
    const ka = $('siKaoCaiDan');
    const dd = $('siKaoDd');
    const biaoQian = $('siKaoBiaoQian');
    const genSuiJu = $('siKaoGenSuiJu');
    const huaKuai = $('siKaoHuaKuai');
    const dangBiao = $('siKaoKaDang');
    if (!trigger || !ka || !dd || !genSuiJu || !huaKuai) return;
    /** 滑块档位 → 级别值（顺序就是产品要求的：左灵机 → 右自然） */
    const stops = () => (Array.isArray(THINK_STOPS) && THINK_STOPS.length ? THINK_STOPS : ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'auto']);
    huaKuai.min = '0';
    huaKuai.max = String(Math.max(0, stops().length - 1));
    const dangWei = (v) => {
      const i = stops().indexOf(String(v || 'auto'));
      return i < 0 ? stops().length - 1 : i;
    };
    const dangQianChat = () => (state.selectedChat && state.selectedChat.id) || '';
    /** 还没选中会话时的本地手动档（只影响这块界面的显示；真实使用总有会话） */
    let juBuShouDong = '';
    /** 这个牛马在管理局里设的默认档（跟随模式就显示它） */
    function niuMaDang() {
      const id = dangQianChat();
      const inst0 = (state.instances || []).find((x) => x && (x.id === id || x.ming === id || x.name === id));
      return String((inst0 && inst0.thinkLevel) || 'auto');
    }
    /** 手动档（没手动设过就是空 ⇒ 跟随） */
    function shouDongDang() {
      const id = dangQianChat();
      if (!id) return juBuShouDong;
      return (state.thinkOverride && state.thinkOverride[id]) || '';
    }
    function refresh() {
      const shou = shouDongDang();
      const genSui = !shou;
      const dang = genSui ? niuMaDang() : shou;
      genSuiJu.checked = genSui;
      huaKuai.disabled = genSui;          // 勾上（跟随）⇒ 灰色不可拖
      huaKuai.value = String(dangWei(dang));
      if (dangBiao) dangBiao.textContent = thinkLabelOf(dang);
      // 触发器上的小字：**只有手动档才显示**（跟随牛马时不必重复牛马的名字）
      if (biaoQian) {
        biaoQian.textContent = genSui ? '' : thinkLabelOf(dang);
        biaoQian.classList.toggle('yinCang', genSui);
      }
    }
    window.__refreshThink = refresh;
    refresh();
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      ka.classList.toggle('yinCang');
      if (!ka.classList.contains('yinCang')) { refresh(); positionMenuFixed(trigger, ka); }
    });
    ka.addEventListener('click', (e) => e.stopPropagation());   // 卡片内点击不关
    onDocClick(() => ka?.classList.add('yinCang'));
    /** 手动档要**保持**（写进设置；重启后还在），这是产品要求"用户可以手动调节来保持这个思考级别" */
    function cunThinkOverride() {
      try { window.warmy.settingsSave?.({ thinkOverride: state.thinkOverride || {} }); } catch { /* noop */ }
    }
    genSuiJu.addEventListener('change', () => {
      const id = dangQianChat();
      state.thinkOverride = state.thinkOverride || {};
      const dang = stops()[Number(huaKuai.value)] || niuMaDang();
      if (genSuiJu.checked) {
        // 跟随 ⇒ 交回牛马管理局
        if (id) delete state.thinkOverride[id];
        juBuShouDong = '';
      } else {
        // 取消勾选：从"当前跟随到的档"起步（滑块位置就是它），用户接着拖即可
        if (id) state.thinkOverride[id] = dang;
        juBuShouDong = dang;
      }
      if (id) cunThinkOverride();
      refresh();
      // 产品要求：调整思考级别**不要提示文字**（什么都不弹）
    });
    huaKuai.addEventListener('input', () => {
      const id = dangQianChat();
      // 拖动滑块 = 想手动定档 ⇒ 自动取消"跟随"（不用先点勾选框，符合直觉）
      genSuiJu.checked = false;
      const dang = stops()[Number(huaKuai.value)] || 'auto';
      state.thinkOverride = state.thinkOverride || {};
      if (id) state.thinkOverride[id] = dang;
      juBuShouDong = dang;
      if (id) cunThinkOverride();
      if (dangBiao) dangBiao.textContent = thinkLabelOf(dang);
      if (biaoQian) { biaoQian.textContent = thinkLabelOf(dang); biaoQian.classList.remove('yinCang'); }
      huaKuai.disabled = false;
    });
    huaKuai.addEventListener('change', () => {
      // 产品要求：调整思考级别**不要提示文字**（什么都不弹）
    });
  })();
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('secTrigger');
    const caiDan = $('secCaiDan');
    const dd = $('secDd');
    const biaoQian = $('secBiaoQian');
    if (!trigger || !caiDan || !dd) return;

    const LABELS = {
      normal: 'chat.securityNormal',
      strict: 'chat.securityStrict',
      // ⚠️ 键名必须与 data-s 一致（原来写成 Quan ⇒ 选了「完全授权」标签仍显示「常规授权」）
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
      caiDan.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.s === mode));
      // 「超出权限是否询问」：完全授权时灰掉（那时没什么需要用户授权的）
      const wen = $('secWenXun');
      if (wen) {
        wen.checked = state.askOnExceed !== false;
        wen.disabled = mode === 'full';
        const hang = $('secWenXunHang');
        if (hang) hang.style.opacity = mode === 'full' ? '0.45' : '1';
      }
    }
    window.__refreshSecurity = refresh;
    refresh();
    // 勾选框：落盘 + 立即生效（越权时可询问）
    const wenKuai = $('secWenXun');
    if (wenKuai) {
      wenKuai.onchange = () => {
        state.askOnExceed = !!wenKuai.checked;
        try { window.warmy.settingsSave({ askOnExceed: state.askOnExceed }); } catch { /* noop */ }
      };
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      caiDan.classList.toggle('yinCang');
      if (!caiDan.classList.contains('yinCang')) positionMenuFixed(trigger, caiDan);
    });
    onDocClick(() => caiDan?.classList.add('yinCang'));

    caiDan.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          caiDan.classList.add('yinCang');
          return;
        }
      }
      caiDan.classList.add('yinCang');
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
    const duQuQi = new FileReader();
    duQuQi.onload = () => {
      const url = String(duQuQi.result || '');
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
    duQuQi.readAsDataURL(f);
    e.target.value = '';
  });
  $('anNiuwinMin')?.addEventListener('click', () => window.warmy.winMinimize());
  $('anNiuwinMax')?.addEventListener('click', () => window.warmy.winMaximize());
  $('anNiuwinGuanBi')?.addEventListener('click', async () => {
    // 关闭二次确认（设置里可关）：防误点把窗口关掉
    try {
      const r = await window.warmy.settingsGet?.();
      if (r?.settings?.closeConfirm !== false) {
        if (!(await uiConfirm(tOr('win.closeConfirm', '确定关闭窗口吗？（可在设置里关闭此确认）')))) return;
      }
    } catch { /* 读不到设置就直接关 */ }
    window.warmy.winClose();
  });
  // 双击标题栏：最大化 / 还原
  try {
    const tb = $('biaoTiLanTuoZhuai') || $('biaoTiLan');
    if (tb) tb.addEventListener('dblclick', () => { try { window.warmy.winMaximize?.(); } catch { /* noop */ } });
  } catch { /* noop */ }
  // 双击标题栏空白处：最大化/还原
  document.querySelector('.biaoTiLanTuoZhuai')?.addEventListener('dblclick', () => {
    try { window.warmy.winMaximize?.(); } catch { /* noop */ }
  });
  // 附件拖拽上传：拖到输入区即加入附件列表
  (function bindAttachDrop() {
    const ta = $('shuRu');
    const host = ta && ta.closest('.shuRuQu');
    if (!host || host.dataset.dropBound) return;
    host.dataset.dropBound = '1';
    host.addEventListener('dragover', (e) => { e.preventDefault(); host.classList.add('dropping'); });
    host.addEventListener('dragleave', () => host.classList.remove('dropping'));
    host.addEventListener('drop', (e) => {
      e.preventDefault();
      host.classList.remove('dropping');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      files.forEach((f) => {
        const p = (f && f.path) || '';
        state.attachments.push({ name: f.name || 'file', ming: f.name || 'file', path: p, bytes: f.size || 0, dataUrl: '' });
      });
      try { xuanranFujian(); } catch { /* noop */ }
    });
  })();
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
        const ming = mingOf(g);
        return {
          id: g.groupId || g.id,
          groupId: g.groupId || g.id,
          ming,
          name: ming,
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
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('container.devEnv.createTitle');
      const duiHuaTi = $('duiHuaKuangTi');
      duiHuaTi.innerHTML = '';
      const p1 = document.createElement('div');
      p1.textContent = t('container.devEnv.required');
      const nameLabel = document.createElement('div');
      nameLabel.className = 'ctgDim';
      nameLabel.textContent = t('container.devEnv.nameLabel');
      const input = document.createElement('input');
      input.id = 'xiangMuMingShuRu';
      input.style.cssText = 'width:100%;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--input-bg);color:var(--ink);font:inherit';
      input.placeholder = t('placeholder.groupName');
      const kaifaHang = document.createElement('div');
      kaifaHang.id = 'xiangMuKaiFaHuanJing';
      kaifaHang.className = 'ctgSeg';
      kaifaHang.dataset.chosen = '';
      const zao = (zhi, labelKey) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.devEnvPick = zhi;
        b.id = 'xiangMuKaiFaHuanJing' + zhi;
        b.textContent = t(labelKey);
        b.onclick = () => {
          kaifaHang.dataset.chosen = zhi;
          Array.from(kaifaHang.querySelectorAll('[data-dev-env-pick]')).forEach((x) => x.classList.toggle('qiYong', x.dataset.devEnvPick === zhi));
          ok.disabled = false;
        };
        return b;
      };
      kaifaHang.append(zao('host', 'container.devEnv.host'), zao('container', 'container.devEnv.container'));
      const note = document.createElement('div');
      note.className = 'ctgDim';
      note.textContent = t('container.devEnv.note');
      duiHuaTi.append(p1, nameLabel, input, kaifaHang, note);
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); resolve(null); };
      const ok = document.createElement('button');
      ok.className = 'anNiuZhuYao';
      ok.id = 'xiangMuChuangJianok';
      ok.textContent = t('common.ok');
      // **没选开发环境就不让创建**（这正是 P3 的要求：创建时必须选）
      ok.disabled = true;
      ok.onclick = () => {
        if (!kaifaHang.dataset.chosen) return;
        const ming = String(input.value || '').trim();
        if (!ming) { input.focus(); return; }
        root.classList.add('yinCang');
        resolve({ ming, devEnv: kaifaHang.dataset.chosen });
      };
      dongZuoJi.append(cancel, ok);
      root.classList.remove('yinCang');
      input.focus();
    });
  }

  function createGroupFlow() {
    if (state.nav === 'internalGroup') {
      // 项目：必须选开发环境（P3）
      void projectCreateDialog().then(async (res) => {
        if (!res) return;
        const id = 'g' + Date.now();
        try {
          const jr = await window.warmy.groupCreate({ groupId: id, ming: res.ming || res.name, type: 'internal', directedMode: false, devEnv: res.devEnv });
          if (jr && jr.ok === false) {
            uiAlert(String(jr.error || t('common.error')));
            return;
          }
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
    uiPrompt(t('list.createGroupChat'), t('placeholder.groupNameExt')).then(async (ming) => {
      if (!ming) return;
      const type = 'external';
      const id = 'g' + Date.now();
      try {
        // 群聊默认「仅@ai才发言」勾选
        const jr = await window.warmy.groupCreate({ groupId: id, ming, type, directedMode: true });
        if (jr && jr.ok === false) {
          uiAlert(String(jr.error || t('common.error')));
          return;
        }
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
  async function createContactWithCard(ming) {
    const mingCheng = String(ming || '').trim();
    if (!mingCheng) return false;
    const ka = await myCard();
    const go = await shareCardConfirm(ka, 'contact.add');
    if (!go) return false;
    state.chats.push({ id: 'c-' + Date.now(), ming: mingCheng, kind: 'extdm', lastPreview: t('list.noReply'), notify: true, ka });
    renderList();
    window.__saveState?.();
    return true;
  }

  /** 牛马名称是否已被占用（我的牛马 + 牛马管理局都走这里） */
  function mingYiZhanYong(ming, skipId) {
    const n = String(ming || '').trim();
    if (!n) return false;
    return (state.instances || []).some((i) => i && i.id !== skipId && mingOf(i) === n);
  }

  /** 主进程实例列表与本地合并：绝不整表覆盖（否则会把第一个牛马顶掉） */
  function heBingShiLiJi(remote) {
    const Suoyin = new Map();
    for (const i of state.instances || []) {
      if (i && i.id) Suoyin.set(i.id, biaoZhunShiLi(i));
    }
    for (const i of remote || []) {
      const n = biaoZhunShiLi(i);
      if (!n || !n.id) continue;
      const old = Suoyin.get(n.id) || {};
      Suoyin.set(n.id, biaoZhunShiLi({ ...old, ...n, id: n.id }));
    }
    state.instances = [...Suoyin.values()];
  }

  function addInstanceFlow() {
    const suanMing = () => {
      let n = (state.instances || []).length + 1;
      let houXuan = escapeHtml(t('placeholder.agentName')) + '-' + n;
      while (mingYiZhanYong(houXuan)) { n += 1; houXuan = escapeHtml(t('placeholder.agentName')) + '-' + n; }
      return houXuan;
    };
    uiPrompt(t('instances.name'), suanMing(), t('nav.singleAi')).then(async (ming) => {
      if (!ming) return;
      ming = String(ming).trim();
      if (!ming) return;
      // 重名不允许（产品要求：我的牛马不能重名）
      if (mingYiZhanYong(ming)) {
        uiAlert(t('instances.nameDup') || ('重名：' + ming));
        return;
      }
      // id 绝不与既有实例冲突（避免顶替）
      let id = 'inst-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      while ((state.instances || []).some((x) => x && x.id === id)) {
        id = 'inst-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      }
      const inst = {
        id,
        ming,
        name: ming,
        status: 'running', // 创建即拉起；真实状态以后续 listInstances 为准
        dutyEligible: true,
        notify: true,
        model: 'deepseek-chat',
        memoryFile: 'persona/' + ming + '.md',
        persona: t('instances.personaDefault'),
        avatarPreset: randomPreset(),
        avatarDataUrl: '',
      };
      state.instances.push(biaoZhunShiLi(inst));
      state.selectedInstance = state.instances[state.instances.length - 1];
      // 登记到主进程；失败则回滚本地条目，避免"假成功"
      void (async () => {
        try {
          const r = await window.warmy.spawnInstance({ id, ming, dutyEligible: true });
          if (r && (r.ok === false || r.error)) {
            state.instances = (state.instances || []).filter((x) => x.id !== id);
            state.selectedInstance = (state.instances || [])[0] || null;
            uiAlert(String(r.error || t('common.error')));
          } else {
            try {
              heBingShiLiJi((await window.warmy.listInstances()) || []);
            } catch { /* keep local */ }
          }
        } catch (e) {
          state.instances = (state.instances || []).filter((x) => x.id !== id);
          uiAlert(String(e && e.message || e));
        }
        renderList();
      })();
      hideMain();
      $('shiLiXiangQing').classList.remove('yinCang');
      renderInstanceDetail();
      renderList();
    });
  }

  /**
   * 竖分隔条拖动（列表栏 #lanTiaoZhengTiao 与右栏 #mianBanTiaoZhengTiao 共用这**一套**，不另造轮子）。
   *   opts.dir === 'you'：被拖的栏在**右边**（指针右移 → 该栏变窄），左侧那一栏由 1fr 吃掉差值。
   *   opts.hostId / opts.minOther：给「另一侧」留最小宽度——上限随容器宽度收缩，
   *     两边都拖不到 0（420px 的窗口里也拖不塌）。
   *   opts.persistKey：松手 / 双击复位后把宽度写回**既有 settings 通道**（不新开存储文件）。
   *   opts.resetWidth：双击恢复的默认宽度。
   */
  function bindResizer(yuanSu, cssVar, min, max, opts) {
    if (!yuanSu) return;
    const o = opts || {};
    const dir = o.dir === 'you' ? -1 : 1;
    const resetWidth = Number(o.resetWidth) || min;
    const minOther = Number(o.minOther) || 0;
    const curW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || resetWidth;
    /** 上限：还要给另一侧留出 minOther，否则窄窗口下会把对面挤成 0 */
    const capMax = () => {
      let shangXian = max;
      const host = o.hostId ? $(o.hostId) : null;
      if (host && minOther) {
        const keYong = host.getBoundingClientRect().width - minOther;
        if (keYong > min) shangXian = Math.min(shangXian, Math.floor(keYong));
      }
      return shangXian;
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
  bindVerticalResizer('kongZhiTaiDingTiaoZhengTiao', 'kongZhiTaiMianBan', 'up');
  // 控制台下方（输入框上方）：拉伸输入区
  bindVerticalResizer('shuRuDingTiaoZhengTiao', 'shuRu', 'up');

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
      const erWeiMa = enc(0, ecc);
      erWeiMa.addData(data, 'Byte');
      erWeiMa.make();
      const n = erWeiMa.getModuleCount();
      const anJing = 4;
      const total = n + anJing * 2;
      const unit = size / total;
      const juXingJi = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!erWeiMa.isDark(r, c)) continue;
          juXingJi.push(
            '<rect x="' + ((c + anJing) * unit).toFixed(3) + '" y="' + ((r + anJing) * unit).toFixed(3) +
            '" width="' + unit.toFixed(3) + '" height="' + unit.toFixed(3) + '"/>'
          );
        }
      }
      const attrs =
        ' data-qr-version="' + ((n - 17) / 4) + '" data-qr-modules="' + n +
        '" data-qr-ecc="' + ecc + '" data-qr-quiet="' + anJing + '" data-qr-unit="' + unit.toFixed(6) +
        '" data-qr-payload-len="' + data.length + '"';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + escapeHtml(t('contact.mineQr')) + '"' + attrs + '>' +
        '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
        '<g fill="#111">' + juXingJi.join('') + '</g></svg>';
    } catch {
      return '';
    }
  }

  /** 组合键 → 规范串（Ctrl+Alt+Shift+Meta+K）；只按了修饰键返回 null */
  function comboFromEvent(Shi) {
    const raw = String(Shi.key || '');
    if (raw === 'Control' || raw === 'Alt' || raw === 'Shift' || raw === 'Meta') return null;
    if (!raw) return null;
    let k = raw;
    if (raw === ' ') k = 'Space';
    else if (raw === 'Esc') k = 'Escape';
    else if (raw.length === 1) k = raw.toUpperCase();
    const mods = [];
    if (Shi.ctrlKey) mods.push('Ctrl');
    if (Shi.altKey) mods.push('Alt');
    if (Shi.shiftKey) mods.push('Shift');
    if (Shi.metaKey) mods.push('Meta');
    return { combo: mods.concat([k]).join('+'), key: k, mods, usable: mods.length > 0 || /^F([1-9]|1[0-2])$/.test(k) };
  }

  /**
   * 可绑定的动作：**只列真的接上了动作的**（跑不通的宁可不给绑，不要让用户绑了没反应）。
   * def = 预置的少数常用键；空串 = 默认留空，由用户自己设。
   */
  const SHORTCUT_ACTIONS = [
    { id: 'toggleSidebar', def: 'Ctrl+B', run: () => { const b = $('appTi'); if (b) b.classList.toggle('yinCangLieBiao'); } },
    { id: 'openSettings', def: 'Ctrl+,', run: () => setNav('settings') },
    { id: 'newSession', def: 'Ctrl+N', run: () => { const b = primaryAddButton(); if (b) b.click(); } },
    { id: 'focusSearch', def: 'Ctrl+F', run: () => { const i = $('lieBiaoSouSuo'); if (i) { i.focus(); i.select(); } } },
    { id: 'focusInput', def: '', run: () => { const i = $('shuRu'); if (i) i.focus(); } },
    { id: 'toggleConsole', def: '', run: () => { const b = $('diagKaiGuan') || $('anNiuKongZhiTai'); if (b) b.click(); } },
    { id: 'stopAll', def: '', run: () => { const b = $('anNiuTingZhiAll'); if (b) b.click(); } },
    { id: 'openMe', def: '', run: () => setNav('wo') },
    { id: 'openContacts', def: '', run: () => setNav('externalChat') },
  ];

  /** 当前页面的「新建」入口（实例页/项目页/群聊页/联系人页各不相同） */
  function primaryAddButton() {
    const b = $('lieBiaoDongZuo');
    if (b && !b.classList.contains('yinCang')) return b;
    const j = $('anNiuJiaRuqr');
    if (j && !j.classList.contains('yinCang')) return j;
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
    const yuanSu = $('hkMiYaoJiXiaoXi');
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
    const ti = $('hkMiYaoJiTi');
    if (!ti) return;
    ti.innerHTML = SHORTCUT_ACTIONS.map((a) => {
      const bound = shortcutBinding(a.id);
      return (
        '<tr data-hk-row="' + a.id + '">' +
        '<td>' + escapeHtml(t('settings.hotkey.act.' + a.id)) + '</td>' +
        '<td><button type="button" class="hkMiYao' + (bound ? '' : ' unbound') + '" data-hk="' + a.id + '" title="' +
        escapeHtml(t('settings.hotkey.keyHint')) + '">' +
        escapeHtml(bound || t('settings.hotkey.unbound')) + '</button></td>' +
        '<td class="hkMiYaoJiMiaoShu">' + escapeHtml(t('settings.hotkey.actDesc.' + a.id)) + '</td>' +
        '</tr>'
      );
    }).join('');
    ti.querySelectorAll('[data-hk]').forEach((btn) => {
      btn.onclick = () => startShortcutCapture(btn.dataset.hk, btn);
    });
  }

  /* ── 给其他智能体的接口目录 ──
     目录来自 window.warmy 的**真实方法表**（键名即操作名），一个都不多、不硬编码清单；
     通道名与形参从桥函数的源码里解析（ipcRenderer.invoke('warmy:zhanWei', a, b)），解析不到就留空。 */

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

  function apiGroupOf(ming) {
    for (let i = 0; i < API_GROUP_RULES.length; i++) {
      if (API_GROUP_RULES[i][0].test(ming)) return API_GROUP_RULES[i][1];
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
    spawnInstance: '(cfg: {id,ming,dutyEligible?})',
    stopInstance: '(id: string)',
    securityMode: '()',
    setSecurityMode: "(mode: 'full'|'normal'|'strict')",
    memoryRecall: '(q: string | {query,limit?,scope?})',
    memoryAppend: '(ti: string)',
    memoryRetrieve: '(payload: {seq?, recordId?})',
    memoryStatus: '()',
    memoryRebuild: '()',
    i18n: "(yuYan: string)",
    localeInfo: '()',
    setThemeSource: "(s: 'system'|'dark'|'light')",
    themeInfo: '()',
    listModels: '(cfg: {protocol,baseURL?,apiKey?})',
    pickSound: '()',
    checkUpdate: '()',
    pickFile: '()',
    groupCreate: '(cfg: {ming,type?,directedMode?,devEnv?,directory?})',
    groupList: '()',
    updateSourceGet: '()',
    updateSourceSet: '(payload: {url: string})',
    groupMessage: '(xiaoXi: {groupId,content,urgency?,userId?})',
    groupJoinInstance: '(groupId, instanceId)',
    boardTasks: '(groupId?: string)',
    boardEvents: '()',
    boardAggregate: '()',
    setProvider: '(cfg: {presetId,apiKey?,baseURL?,model?})',
    getProvider: '()',
    chatSend: '(xiaoXi: {sessionId,content,urgency?,attachments?})',
    checkpointCreate: '(phase?: string)',
    checkpointList: '()',
    checkpointRollback: '(id: string)',
    knowledgeQuery: '(q: string)',
    knowledgeAddEvent: '(ev: {biaoTi,ti?,groupId?})',
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
    containerShell: '(payload: {runtimeId,action:"daKai"|"write"|"close"|"status",sessionId?,data?})',
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
    aiQuestionOpen: '(payload: {groupId,biaoTi,ti?,options[]})',
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
    peersAdd: '(p: {host,port,ming?})',
    inviteCreate: '(groupId: string)',
    executorsStatus: '()',
    executorsRunBrief: '(payload: {brief,contextItems?,executorIds?})',
    stateLoad: '()',
    stateSave: '(s: object)',
    lastError: '()',
    clearError: '()',
    setupState: '()',
    setupComplete: '(payload: {yuYan?})',
    searchMessages: '(q: string)',
    archiveList: '(groupId?: string)',
    archiveExternal: '(payload: {groupId,biaoTi,summary,anchors?})',
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

  function warmySampleArgs(ming, qiaoJie) {
    switch (ming) {
      case 'memoryRecall':
        return ['warmy'];
      case 'i18n':
        return [state.yuYan || 'zh-CN'];
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

  async function tryRunWarmyApi(ming) {
    const qiaoJie = window.warmy;
    if (!qiaoJie || typeof qiaoJie[ming] !== 'function') return { ok: false, error: 'missing-api' };
    if (!WARMY_API_READONLY.has(ming)) {
      return { ok: false, error: t('settings.hotkey.apiTryReadOnly') || 'read-only only' };
    }
    const args = warmySampleArgs(ming, qiaoJie);
    try {
      const r = await qiaoJie[ming](...args);
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
    containerShell: '容器内 shell（daKai/write/close/status）',
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
    Object.keys(qiaoJie).sort().forEach((ming) => {
      let fn = null;
      try {
        fn = qiaoJie[ming];
      } catch {
        fn = null;
      }
      if (typeof fn !== 'function') return;
      if (/^qiYong[A-Z]/.test(ming)) {
        events.push(ming); // 事件订阅：主进程 → 渲染层，不是可调用操作
        return;
      }
      const face = apiFaceOf(fn);
      const params = WARMY_API_SIGNATURES[ming] || face.params || '()';
      const channel = face.channel || `warmy:${ming.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
      rows.push({ ming, group: apiGroupOf(ming), channel, params, readonly: WARMY_API_READONLY.has(ming) });
    });
    return { rows, events, available: true };
  }

  const API_GROUP_ORDER = [
    'chat', 'group', 'board', 'identity', 'membership', 'net', 'invite', 'knowledge',
    'metrics', 'skill', 'smtp', 'checkpoint', 'executor', 'asset', 'security',
    'settings', 'window', 'repo', 'archive', 'other',
  ];

  function renderApiCatalogue() {
    const heZi = $('hkapiTi');
    if (!heZi) return;
    const cat = apiCatalogue();
    const cnt = $('hkapiCount');
    if (cnt) cnt.textContent = fmtKey('settings.hotkey.apiCount', { n: cat.rows.length });
    const Shi = $('hkapiShiJianJi');
    if (Shi) Shi.textContent = cat.events.length ? t('settings.hotkey.apiEvents') + ' ' + cat.events.join(', ') : '';
    if (!cat.available || !cat.rows.length) {
      heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('settings.hotkey.apiUnavailable')) + '</div>';
      return;
    }
    const q = ((($('hkapiFilter') || {}).value) || '').trim().toLowerCase();
    const hits = q ? cat.rows.filter((r) => r.name.toLowerCase().indexOf(q) >= 0) : cat.rows;
    const touBu =
      '<thead><tr><th>' + escapeHtml(t('settings.hotkey.apiColOp')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColChannel')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColParams')) + '</th><th>' +
      escapeHtml(t('settings.hotkey.apiColDesc')) + '</th></tr></thead>';
    let html = '';
    API_GROUP_ORDER.forEach((g) => {
      const LieBiao = hits.filter((r) => r.group === g);
      if (!LieBiao.length) return;
      html +=
        '<div class="hkQunBiaoTi">' + escapeHtml(t('settings.hotkey.group.' + g)) + ' · ' + LieBiao.length + '</div>' +
        '<table class="hkapi">' + touBu + '<tbody>' +
        LieBiao
          .map((r) => {
            const k = 'settings.hotkey.api.' + r.name;
            const desc = state.t[k] ? t(k) : (WARMY_API_DOC_ZH[r.name] || '');
            return (
              '<tr data-api-op="' + escapeHtml(r.name) + '">' +
              '<td class="hkOp">' + escapeHtml(r.name) + '</td>' +
              '<td class="hkCh">' + escapeHtml(r.channel || '—') + '</td>' +
              '<td class="hkPa"><code>' + escapeHtml(r.params || '()') + '</code></td>' +
              '<td class="hkMiaoShu' + (desc ? '' : ' none') + '">' + escapeHtml(desc || t('settings.hotkey.apiNoDesc')) + '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table>';
    });
    heZi.innerHTML = html || '<div class="jingYin">' + escapeHtml(t('settings.hotkey.apiEmpty')) + '</div>';
  }

  function bindHotkeySection() {
    const copyBtn = $('anNiuCopyapiOps');
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.onclick = async () => {
        const xiangDuiLu = 'docs/API-OPERATIONS.md';
        const jueDuiLu = (window.warmy && window.warmy.__repoApiDoc) || xiangDuiLu;
        const text =
          t('settings.hotkey.apiCopyText') ||
          ('How to operate WArmy APIs: daKai the file `docs/API-OPERATIONS.md` in the project root (or absolute path if provided). Read it before calling window.warmy.* / IPC.');
        const payload = text + '\n\n' + jueDuiLu + '\n\n' + xiangDuiLu;
        try {
          await navigator.clipboard.writeText(payload);
          const xiaoXi = $('apiCopyXiaoXi');
          if (xiaoXi) xiaoXi.textContent = t('settings.hotkey.apiCopied') || 'Copied';
        } catch {
          uiAlert(payload, t('settings.hotkey.apiCopyOps') || 'API guide');
        }
      };
    }
    renderApiCatalogue();
    renderShortcuts();
    shortcutMsg('');
    const f = $('hkapiFilter');
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
        const host = $('piZhunHost');
        if (host) host.innerHTML = '';
        $('duiHuaKuangGen')?.classList.add('yinCang');
        resolve({ allowed, scope });
      };
      // 通知区内联卡片（与 aiqKa 同构）
      const host = $('piZhunHost');
      if (host) {
        host.innerHTML = `<div class="piZhunKa" data-approval="1">
          <div class="aiqBiaoTi">${escapeHtml(t('approval.biaoTi') || '')} · ${escapeHtml(payload.action || '')}</div>
          <div class="jingYin">${escapeHtml(t('approval.tiShi') || '')}</div>
          <div class="aiqOpts">
            <button class="anNiuXiao" data-ap="deny">${escapeHtml(t('approval.deny'))}</button>
            <button class="anNiuZhuYao" data-ap="once">${escapeHtml(t('approval.once'))}</button>
            <button class="anNiuXiao" data-ap="project">${escapeHtml(t('approval.project'))}</button>
            <button class="anNiuXiao" data-ap="global">${escapeHtml(t('approval.global'))}</button>
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
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('approval.biaoTi');
      $('duiHuaKuangTi').innerHTML =
        '<div style="margin-bottom:8px">' + escapeHtml(payload.action || '') + '</div>' +
        '<div class="jingYin">' + escapeHtml(t('approval.tiShi')) + '</div>';
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const zao = (biaoQian, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = biaoQian;
        b.onclick = async () => {
          root.classList.add('yinCang');
          await fn();
        };
        dongZuoJi.appendChild(b);
      };
      zao(t('approval.deny'), 'anNiuXiao', () => wanCheng(false, 'deny'));
      zao(t('approval.once'), 'anNiuZhuYao', () => wanCheng(true, 'once'));
      zao(t('approval.project'), 'anNiuXiao', () => wanCheng(true, 'project'));
      zao(t('approval.global'), 'anNiuXiao', () => wanCheng(true, 'global'));
      root.classList.remove('yinCang');
    });
  }
  window.warmy.onApprovalRequest?.(async (d) => {
    const r = await showApprovalDialog(d);
    await window.warmy.approvalRespond(d.id, r.allowed, r.scope);
  });

  function openContextMenu(x, y, items) {
    closeContextMenu();
    const yuanSu = document.createElement('div');
    yuanSu.className = 'shangXiaWenCaiDan';
    yuanSu.id = 'shangXiaWenCaiDan';
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'shangXiaWenFenGe';
        yuanSu.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.biaoQian;
      if (it.weixian) b.classList.add('danger');
      if (it.checked) b.classList.add('qiYong');
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

  function agentMenu(inst, hangYuanSu) {
    const running = inst.status === 'running';
    const blocked = running || sessionHasBlockingTasks(inst.id);
    const rect = hangYuanSu.getBoundingClientRect();
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
              await window.warmy.spawnInstance({ id: inst.id, ming: mingOf(inst), dutyEligible: true });
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
          inst.name = ming; inst.ming = ming;
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
        weixian: true,
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
        biaoQian: t('ctx.rename'),
        onClick: async () => {
          const ming = await uiPrompt(t('ctx.renamePrompt'), g.name);
          if (!ming) return;
          g.name = ming;
          renderList();
        },
      },
      yiJiaRu
        ? {
            biaoQian: t('ctx.delete'),
            weixian: true,
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
            weixian: true,
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

  function showJoinRequestModal(Qiu) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('join.requestBadge');
      $('duiHuaKuangTi').innerHTML =
        '<div>' + escapeHtml(t('join.requester')) + ': ' + escapeHtml(Qiu.name) + '</div>' +
        '<div>' + escapeHtml(t('join.kind')) + ': ' + escapeHtml(Qiu.kind) + '</div>' +
        '<div>' + escapeHtml(t('join.target')) + ': ' + escapeHtml(Qiu.targetType) + ' ' + escapeHtml(Qiu.target) + '</div>' +
        '<div>' + escapeHtml(t('join.applyTime')) + ': ' + new Date(Qiu.ts).toLocaleString() + '</div>' +
        '<div>' + escapeHtml(t('join.expireTime')) + ': ' + new Date(Qiu.expireAt).toLocaleString() + '</div>';
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const zao = (biaoQian, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = biaoQian;
        b.onclick = async () => { root.classList.add('yinCang'); await fn(); };
        dongZuoJi.appendChild(b);
      };
      zao(t('join.reject'), 'anNiuXiao', () => resolve('reject'));
      zao(t('join.blacklist'), 'anNiuDanger', () => resolve('block'));
      zao(t('join.agree'), 'anNiuZhuYao', () => resolve('agree'));
      root.classList.remove('yinCang');
    });
  }

  document.querySelectorAll('[data-nav="instances"]').forEach((yuanSu) => {
    yuanSu.addEventListener('click', async () => {
      const r = await window.warmy.joinPending().catch(() => null);
      if (r?.items?.length) {
        const Qiu = r.items[0];
        const action = await showJoinRequestModal(Qiu);
        await window.warmy.joinRespond({ id: Qiu.id, action });
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

  $('jinDuKaiGuan')?.addEventListener('click', () => {
    $('jinDuKaiGuan')?.classList.toggle('daKai');
    const LieBiao = $('renwuLieBiao');
    LieBiao?.classList.toggle('yinCang');
    if (LieBiao && !LieBiao.classList.contains('yinCang')) {
      requestAnimationFrame(() => { LieBiao.scrollTop = LieBiao.scrollHeight; });
    }
  });

  $('assistKaiGuan')?.addEventListener('click', () => {
    $('assistKaiGuan')?.classList.toggle('daKai');
    const LieBiao = $('assistLieBiao');
    LieBiao?.classList.toggle('yinCang');
    if (LieBiao && !LieBiao.classList.contains('yinCang')) {
      void renderAssistList({ scrollBottom: true });
    }
  });

  /**
   * 等待协助：AI 运行中需要人处理的事。
   * daKai=黄点 · urgent daKai=红点 · done=绿勾 · stale=灰+删除线（不删除）
   * 排序：红垫底（当最新）→ 其余按时间正序（越下越新）；展开默认滚到底。
   */
  async function renderAssistList(opts) {
    const LieBiao = $('assistLieBiao');
    const huiZhang = $('assistHuiZhang');
    if (!LieBiao) return;
    let items = [];
    try {
      const r = await window.warmy.assistList?.(state.selectedChat?.id);
      items = (r && r.items) || [];
    } catch { items = []; }

    const openN = items.filter((x) => x.status === 'daKai').length;
    const urgentN = items.filter((x) => x.status === 'daKai' && x.priority === 'urgent').length;
    if (huiZhang) {
      if (urgentN > 0) {
        huiZhang.className = 'assistHuiZhang urgent';
        huiZhang.classList.remove('yinCang');
        huiZhang.yinCang = false;
      } else if (openN > 0) {
        huiZhang.className = 'assistHuiZhang daKai';
        huiZhang.classList.remove('yinCang');
        huiZhang.yinCang = false;
      } else {
        huiZhang.className = 'assistHuiZhang yinCang';
        huiZhang.yinCang = true;
      }
    }

    const paiMing = (x) => {
      if (x.status === 'daKai' && x.priority === 'urgent') return 3;
      if (x.status === 'daKai') return 2;
      if (x.status === 'done') return 1;
      return 0;
    };
    items = items.slice().sort((a, b) => {
      const ra = paiMing(a); const rb = paiMing(b);
      if (ra !== rb) return ra - rb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (!items.length) {
      LieBiao.innerHTML = '<li class="renwuKong jingYin">' + escapeHtml(t('panel.assist.empty') || '—') + '</li>';
      return;
    }
    LieBiao.innerHTML = items.map((it) => {
      const st = String(it.status || 'daKai');
      const pri = String(it.priority || 'normal');
      let BiaoJi = '<span class="assistDian daKai"></span>';
      let cls = 'assistHang';
      if (st === 'done') { BiaoJi = '<span class="assistDian done" title="' + escapeHtml(t('panel.assist.done') || '') + '">✓</span>'; cls += ' isDone'; }
      else if (st === 'stale') { BiaoJi = '<span class="assistDian none"></span>'; cls += ' isStale'; }
      else if (pri === 'urgent') { BiaoJi = '<span class="assistDian urgent" title="' + escapeHtml(t('panel.assist.urgent') || '') + '"></span>'; cls += ' is-urgent'; }
      return (
        '<li class="' + cls + '" data-assist-id="' + escapeHtml(String(it.id)) + '">' +
        BiaoJi +
        '<div class="assistTi">' +
        '<div class="assistBiaoTi">' + escapeHtml(String(it.title || '')) + '</div>' +
        (it.ti ? '<div class="assistMiaoShu jingYin">' + escapeHtml(String(it.ti).slice(0, 120)) + '</div>' : '') +
        '<div class="assistShiJian jingYin">' + escapeHtml(fmtWhen(it.createdAt)) +
        (it.updatedAt && it.updatedAt !== it.createdAt ? ' · ' + escapeHtml(fmtWhen(it.updatedAt)) : '') +
        '</div></div>' +
        ((st === 'stale' || st === 'done') ? '' :
          '<div class="assistDongZuoJi">' +
          '<button type="button" class="anNiuXiao" data-assist-act="done" title="' + escapeHtml(t('panel.assist.markDone') || 'done') + '">✓</button>' +
          '<button type="button" class="anNiuXiao" data-assist-act="urgent" title="' + escapeHtml(t('panel.assist.markUrgent') || 'urgent') + '">!</button>' +
          '<button type="button" class="anNiuXiao" data-assist-act="stale" title="' + escapeHtml(t('panel.assist.markStale') || 'stale') + '">×</button>' +
          '</div>') +
        '</li>'
      );
    }).join('');

    LieBiao.querySelectorAll('[data-assist-act]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const hang = b.closest('[data-assist-id]');
        const id = hang && hang.getAttribute('data-assist-id');
        if (!id) return;
        const act = b.getAttribute('data-assist-act');
        const payload = {
          id,
          sessionId: state.selectedChat?.id,
          title: hang.querySelector('.assistBiaoTi')?.textContent || '',
        };
        if (act === 'done') { payload.status = 'done'; payload.priority = 'normal'; }
        else if (act === 'stale') { payload.status = 'stale'; payload.priority = 'normal'; }
        else if (act === 'urgent') { payload.status = 'daKai'; payload.priority = 'urgent'; }
        try { await window.warmy.assistUpsert?.(payload); } catch { /* noop */ }
        void renderAssistList({ scrollBottom: false });
      };
    });

    if (opts && opts.scrollBottom) {
      requestAnimationFrame(() => { LieBiao.scrollTop = LieBiao.scrollHeight; });
    }
  }
  window.__renderAssistList = renderAssistList;

  /**
   * 右栏「进度」= 真看板任务；限高滚动；每条带日期时间；越下越新。
   */
  function setProgressPct(baiFenBi) {
    const p = clampPercent(baiFenBi);
    const jinDuTiao = $('jinDuTiao');
    if (jinDuTiao) jinDuTiao.style.width = p + '%';
    const txt = $('jinDuWenBen');
    if (txt) txt.textContent = p + '%';
  }

  async function renderProgressTasks() {
    const LieBiao = $('renwuLieBiao');
    if (!LieBiao) return;
    const sel = state.selectedChat;
    const shiQun = !!(sel && (sel.kind === 'internal' || sel.kind === 'extgroup' || sel.kind === 'single'));
    let RenwuJi = [];
    const eventsByTitle = Object.create(null);
    if (shiQun) {
      try {
        const r = await window.warmy.boardTasks(sel.id);
        if (r && Array.isArray(r.RenwuJi)) RenwuJi = r.RenwuJi;
      } catch {
        RenwuJi = [];
      }
      try {
        const Shi = await window.warmy.boardEvents(sel.id);
        const evs = (Shi && Shi.events) || [];
        for (const e of evs) {
          const key = String(e.title || '').replace(/\s*→\s*\d+%$/, '');
          if (!key) continue;
          if (!eventsByTitle[key] || (e.ts || 0) > eventsByTitle[key]) eventsByTitle[key] = e.ts || 0;
        }
      } catch { /* noop */ }
    }
    if (!RenwuJi.length) {
      LieBiao.innerHTML = '<li class="renwuKong">' + escapeHtml(t('panel.progressEmpty')) + '</li>';
      setProgressPct(0);
      return;
    }
    const DOT = { done: 'done', failed: 'fail', blocked: 'fail', doing: 'jiHuo', todo: '' };
    const rows = RenwuJi.map((renwu, suoYin) => {
      const biaoTi = String((renwu && (renwu.title || renwu.name)) || '');
      const status = String((renwu && renwu.status) || '').toLowerCase();
      const ts = Number(renwu.updatedAt || renwu.ts || renwu.createdAt || eventsByTitle[biaoTi] || 0) || 0;
      return { renwu, biaoTi, status, ts, suoYin };
    });
    rows.sort((a, b) => (a.ts - b.ts) || (a.suoYin - b.suoYin));
    LieBiao.innerHTML = rows
      .map(({ renwu, biaoTi, status, ts }) => {
        const dian = DOT[status] !== undefined ? DOT[status] : '';
        const baiFenBi = renwu && renwu.jinDu != null ? clampPercent(renwu.jinDu) : null;
        return (
          '<li class="task-' + escapeHtml(status || 'todo') + '">' +
          '<span class="renwuZhu">' +
          '<span class="renwuMing">' + escapeHtml(biaoTi) +
          (baiFenBi === null ? '' : ' · ' + baiFenBi + '%') + '</span>' +
          '<span class="renwuShiJian jingYin">' + escapeHtml(fmtWhen(ts)) + '</span>' +
          '</span>' +
          '<span class="dian ' + dian + '"></span>' +
          '</li>'
        );
      })
      .join('');
    const done = RenwuJi.filter((x) => String((x && x.status) || '').toLowerCase() === 'done').length;
    setProgressPct(Math.round((done / RenwuJi.length) * 100));
    if (!LieBiao.classList.contains('yinCang')) {
      requestAnimationFrame(() => { LieBiao.scrollTop = LieBiao.scrollHeight; });
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
    microsandbox: { official: 'https://docs.microsandbox.dev', install: 'https://docs.microsandbox.dev/getting-started/quickstart', download: 'https://docs.microsandbox.dev/getting-started/quickstart', support: 'https://github.com/superradcompany/microsandbox/issues' },
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
  const CONTAINER_GUIDE_ORDER = ['microsandbox', 'docker', 'podman', 'colima', 'isulad', 'kata', 'lima', 'lxd-incus', 'nerdctl', 'pouch', 'rancher-desktop', 'windows-sandbox', 'wsl'];
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
     * 实例缓存：runtimeId → `warmy:rongQiShiLiJi` 的结果。
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
   * 容器项目的开发面状态。传入的 facts 由调用方从**主进程**取（`warmy:xiangMuKaiFaTai`）；
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
      out: String(a.result.shuChu || ('exit=' + a.result.code)),
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
    return '<span class="ctgHuiZhang" data-run="' + escapeHtml(entry.run) + '" data-tone="' + peiDui[1] + '">' + escapeHtml(t(peiDui[0])) + '</span>';
  }

  function containerCapabilityText(entry) {
    if (!entry.capability || !entry.capability.runCommand) return t('container.cap.none');
    const Pian = [];
    if (entry.capability.runCommand) Pian.push(t('container.cap.run'));
    if (entry.capability.interactiveShell) Pian.push(t('container.cap.shell'));
    if (entry.capability.mountHostDir) Pian.push(t('container.cap.mount'));
    return Pian.join(' · ');
  }

  /** 一级行：状态 + 名称 + 类别 + 版本 + 原因/证据 + 能力 + 启停按钮 */
  function containerRowHtml(entry) {
    const ming = t('container.rt.' + entry.id + '.name');
    const kind = t('container.kind.' + (entry.engine && entry.engine.kind ? entry.engine.kind : 'container'));
    const action = entry.action || null;
    const pending = !!(action && action.pending) || !!(containerUi.pending && containerUi.pending.id === entry.id);
    const pendingKind = action && action.pending ? action.kind : (containerUi.pending && containerUi.pending.id === entry.id ? containerUi.pending.action : null);
    let buttons = '';
    if (entry.lifecycle && entry.lifecycle.startable && entry.run !== 'running') {
      buttons += '<button type="button" class="anNiuXiao" id="ctgActQiDong' + escapeHtml(entry.id) + '" data-ctg-act="start" data-ctg-id="' + escapeHtml(entry.id) + '"' + (pending ? ' disabled' : '') + '>' +
        escapeHtml(pending && pendingKind === 'start' ? t('container.action.starting') : t('container.action.start')) + '</button>';
    }
    if (entry.lifecycle && entry.lifecycle.stoppable && entry.run === 'running') {
      buttons += '<button type="button" class="anNiuXiao ctgDanger" id="ctgActTingZhi' + escapeHtml(entry.id) + '" data-ctg-act="stop" data-ctg-id="' + escapeHtml(entry.id) + '"' + (pending ? ' disabled' : '') + '>' +
        escapeHtml(pending && pendingKind === 'stop' ? t('container.action.stopping') : t('container.action.stop')) + '</button>';
    }
    const reasonNote = buttons ? '' :
      '<div class="ctgDim ctgReason" data-reason="' + escapeHtml(entry.lifecycle ? entry.lifecycle.reason : 'ok') + '">' +
      escapeHtml(fmtKey('container.action.noButtons', { reason: t('container.reason.' + (entry.lifecycle ? entry.lifecycle.reason : 'ok')) })) + '</div>';
    const transition = pending
      ? '<div class="ctgDim ctgPending" data-pending="' + escapeHtml(String(pendingKind || '')) + '">' +
        escapeHtml(fmtKey(pendingKind === 'stop' ? 'container.action.stopping' : 'container.action.waitingReady', { s: String(Math.round((entry.lifecycle && entry.lifecycle.waitMs ? entry.lifecycle.waitMs : 120000) / 1000)) })) + '</div>'
      : '';
    const errText = containerActionErrorText(entry);
    const errLine = errText ? '<div class="ctgErr" data-ctg-error="' + escapeHtml(entry.id) + '">' + escapeHtml(errText) + '</div>' : '';
    return '<div class="ctgHang" data-rt="' + escapeHtml(entry.id) + '" data-status="' + escapeHtml(entry.status) + '" data-run="' + escapeHtml(entry.run) + '"' +
      ' data-kind="' + escapeHtml(String(entry.engine && entry.engine.kind)) + '"' +
      ' data-startable="' + (entry.lifecycle && entry.lifecycle.startable ? '1' : '0') + '"' +
      ' data-stoppable="' + (entry.lifecycle && entry.lifecycle.stoppable ? '1' : '0') + '">' +
      '<div class="ctgHangHead">' +
      '<span class="ctgMing">' + escapeHtml(ming) + '</span>' +
      containerBadge(entry) +
      '<span class="ctgLeiXing">' + escapeHtml(kind) + '</span>' +
      (entry.version ? '<span class="ctgDim">' + escapeHtml(t('container.versionLabel')) + ' ' + escapeHtml(entry.version) + '</span>' : '') +
      '<span class="ctgSpacer"></span>' +
      buttons +
      '</div>' +
      '<div class="ctgDim ctgDateil" data-close="' + escapeHtml(entry.detail || '') + '">' +
      escapeHtml(t('container.detailLabel')) + '：' + escapeHtml(entry.detail || '') +
      (entry.evidence ? ' · ' + escapeHtml(String(entry.evidence).slice(0, 240)) : ' · ' + escapeHtml(t('container.evidenceNone'))) +
      '</div>' +
      '<div class="ctgDim ctgCap">' + escapeHtml(t('container.capLabel')) + '：' + escapeHtml(containerCapabilityText(entry)) + '</div>' +
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
    const daKai = !!containerUi.instOpen[entry.id];
    const busy = !!containerUi.instBusy[entry.id];
    const data = containerUi.instances[entry.id];
    let ti = '';
    if (daKai && running) {
      if (busy) ti = '<div class="ctgDim">' + escapeHtml(t('container.inst.loading')) + '</div>';
      else if (!data) ti = '<div class="ctgDim">' + escapeHtml(t('container.inst.empty')) + '</div>';
      else if (!data.supported) ti = '<div class="ctgDim" data-inst-unsupported="' + escapeHtml(String(data.reason || '')) + '">' + escapeHtml(fmtKey('container.inst.unsupported', { reason: String(data.reason || '') })) + '</div>';
      else if (!data.ok) ti = '<div class="ctgErr" data-inst-error="' + escapeHtml(String(data.reason || 'command-failed')) + '">' + escapeHtml(fmtKey('container.inst.listFailed', { err: String(data.evidence || data.reason || '') })) + '</div>';
      else if (!data.instances.length) ti = '<div class="ctgDim" data-inst-count="0">' + escapeHtml(t('container.inst.none')) + '</div>';
      else {
        ti = data.instances.map((x) => {
          const qiYong = x.state === 'running';
          const controllable = !!data.controllable;
          return '<div class="ctgShiLiHang" data-inst-name="' + escapeHtml(x.name) + '" data-inst-state="' + escapeHtml(x.state) + '">' +
            '<span class="ctgShiLiMing">' + escapeHtml(x.name) + '</span>' +
            (x.ours ? '<span class="ctgHuiZhang" data-tone="ok">' + escapeHtml(t('container.inst.ours')) + '</span>' : '') +
            '<span class="ctgDim">' + escapeHtml(x.image || '') + '</span>' +
            '<span class="ctgHuiZhang" data-tone="' + (qiYong ? 'ok' : 'dim') + '">' + escapeHtml(qiYong ? t('container.inst.running') : t('container.inst.stopped')) + '</span>' +
            '<span class="ctgSpacer"></span>' +
            (controllable && !qiYong
              ? '<button type="button" class="anNiuXiao" data-inst-act="start" data-inst-id="' + escapeHtml(entry.id) + '" data-inst-name="' + escapeHtml(x.name) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(t('container.inst.start')) + '</button>'
              : '') +
            (controllable && qiYong
              ? '<button type="button" class="anNiuXiao ctgDanger" data-inst-act="stop" data-inst-id="' + escapeHtml(entry.id) + '" data-inst-name="' + escapeHtml(x.name) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(t('container.inst.stop')) + '</button>'
              : '') +
            '</div>';
        }).join('');
      }
    }
    const toggleLabel = daKai ? t('container.inst.collapse') : t('container.inst.view');
    return '<div class="ctgShiLi" data-inst-for="' + escapeHtml(entry.id) + '" data-inst-enabled="' + (running ? '1' : '0') + '">' +
      '<div class="ctgShiLiHead">' +
      '<button type="button" class="anNiuXiao" data-inst-toggle="' + escapeHtml(entry.id) + '"' + (running ? '' : ' disabled') + '>' +
      escapeHtml(toggleLabel) + '</button>' +
      '<button type="button" class="anNiuXiao" data-inst-create="' + escapeHtml(entry.id) + '"' + (running ? '' : ' disabled') + '>' +
      escapeHtml(t('container.inst.create')) + '</button>' +
      '<span class="ctgDim">' + escapeHtml(running ? t('container.inst.hintReady') : t('container.inst.hintStopped')) + '</span>' +
      '</div>' +
      (daKai && running ? '<div class="ctgShiLiTi">' + ti + '</div>' : '') +
      '</div>';
  }

  /** 折叠的安装说明：**折叠时只显示名字**；展开才是四要素 + 四条链接 */
  function renderContainerGuide() {
    const heZi = $('rongQiGuide');
    if (!heZi) return;
    heZi.innerHTML = CONTAINER_GUIDE_ORDER.map((id) => {
      const links = CONTAINER_LINKS[id] || {};
      const linkRows = CONTAINER_LINK_KEYS.map((k) =>
        '<a class="ctgLink" href="' + escapeHtml(links[k] || '') + '" target="_blank" rel="noreferrer noopener"' +
        ' data-link="' + escapeHtml(k) + '">' + escapeHtml(t('container.link.' + k)) + '</a>'
      ).join('');
      const field = (key, labelKey) =>
        '<div class="ctgGuideField" data-field="' + escapeHtml(key) + '"><span class="ctgGuideBiaoQian">' +
        escapeHtml(t(labelKey)) + '</span><span class="ctgGuideValue">' + escapeHtml(t('container.rt.' + id + '.' + key)) + '</span></div>';
      return '<details class="ctgGuideTiaoMu" data-rt="' + escapeHtml(id) + '">' +
        '<summary class="ctgGuideZhaiYao" id="ctgGuideZhaiYao' + escapeHtml(id) + '">' +
        '<span class="ctgGuideMing" data-name="' + escapeHtml(id) + '">' + escapeHtml(t('container.rt.' + id + '.name')) + '</span>' +
        // 第二批要求：折叠时除名称外，还要显示该容器**支持哪些系统**
        '<span class="ctgGuideos ctgDim" data-os="' + escapeHtml(id) + '">' + escapeHtml(t('container.rt.' + id + '.osShort')) + '</span>' +
        '</summary>' +
        '<div class="ctgGuideTi">' +
        // 只保留**中性事实**：支持系统 / 体积 / 官方与安装链接。
        // 刻意不显示"收费/商用/厂商"等字段：那会被读成推荐或广告。
        // 只陈述可核对的事实（许可/是否收费）；**不做比较、不发表观点**
        field('cost', 'container.guideCost') +
        field('os', 'container.guideOs') +
        field('size', 'container.guideSize') +
        '<div class="ctgLinks">' + linkRows + '</div>' +
        '</div></details>';
    }).join('');
  }

  /**
   * 列表 = 本机**已有**的运行时（`not-installed` 不进列表，只进下方安装说明）。
   * `unsupported-platform` 与 `engine-error` 如实单列，**不**硬并进 running/not-running 两态。
   */
  function renderContainerList() {
    const heZi = $('rongQiLieBiao');
    const note = $('rongQiMissingNote');
    const heJi = $('rongQiZhaiYao');
    if (!heZi) return;
    const rep = containerUi.report;
    if (!rep) {
      heZi.dataset.probe = 'none';
      heZi.innerHTML = '';
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
    heZi.dataset.probe = 'done';
    heZi.innerHTML = listed.length ? listed.map(containerRowHtml).join('') : '<div class="ctgDim">' + escapeHtml(t('container.listEmpty')) + '</div>';
    bindContainerInstanceEvents();
    const notes = [];
    if (rep.notInstalledCount) notes.push(fmtKey('container.notInstalledNote', { n: String(rep.notInstalledCount) }));
    if (hiddenN) notes.push(fmtKey('container.listHidden', { n: String(hiddenN) }));
    if (note) note.textContent = notes.join(' · ');
    // 折叠块标题里带上数量：收起时也知道里面有几条（不用展开去数）
    const inline = $('rongQiCountInline');
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
        const ming = btn.dataset.instName;
        const action = btn.dataset.instAct;
        containerUi.instBusy[id] = true;
        renderContainerList();
        const r = await window.warmy.containerInstanceAction({ id, action, instance: ming })
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

  async function probeContainers(force, deep) {
    if (containerUi.probing) return containerUi.report;
    containerUi.probing = true;
    const xiaoXi = $('rongQiTanCeXiaoXi');
    if (xiaoXi) { xiaoXi.dataset.probeState = 'probing'; xiaoXi.textContent = t('container.probing'); }
    const btn = $('anNiuRongQiTanCe');
    if (btn) btn.disabled = true;
    try {
      const r = await window.warmy.containerProbe({ force: !!force, deep: deep === true });
      const rep = r && r.report ? r.report : null;
      containerUi.report = rep;
      if (xiaoXi) {
        if (rep) {
          xiaoXi.dataset.probeState = 'done';
          xiaoXi.textContent = fmtKey('container.probeDone', { n: String((rep.usableIds || []).length) });
        } else {
          xiaoXi.dataset.probeState = 'failed';
          xiaoXi.textContent = fmtKey('container.probeFailed', { err: String((r && r.error) || 'unknown') });
        }
      }
    } catch (e) {
      containerUi.report = null;
      if (xiaoXi) { xiaoXi.dataset.probeState = 'failed'; xiaoXi.textContent = fmtKey('container.probeFailed', { err: String(e && e.message ? e.message : e) }); }
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
    const ming = t('container.rt.' + id + '.name');
    if (action === 'stop') {
      const go = await uiConfirm(fmtKey('container.action.confirmStopBody', { ming }), t('container.action.confirmStopTitle'));
      if (!go) return false; // 未确认 → 一个操作都不发
    }
    const r = await window.warmy.containerAction({ id, action }).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
    if (!r || !r.ok) {
      await uiAlert(fmtKey('container.action.rejected', { err: String((r && (r.error || r.code)) || 'unknown') }));
      return false;
    }
    containerUi.pending = { id, action, jiezhixian: Date.now() + ((entry && entry.lifecycle && entry.lifecycle.waitMs) || 120000) };
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
      const yiJieSuan = act && !act.pending;
      const reached = cur.action === 'start' ? (after && after.run === 'running') : (after && after.run !== 'running');
      if (yiJieSuan || reached) {
        containerUi.pending = null;
        renderContainerList();
        return;
      }
      if (Date.now() > cur.jiezhixian || round >= 90) {
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
    const pre = $('ctgAnZhuangPromptWenBen');
    const btn = $('anNiuCopyAnZhuangPrompt');
    if (!pre) return;
    pre.textContent = tOr('container.env.prompt.content', tOr('container.env.prompt.title', '（提示词缺失）'));
    pre.dataset.promptLang = String(state.yuYan || 'zh-CN');
    if (btn) btn.textContent = tOr('container.env.prompt.copy', '复制提示词');
    const xiaoXi = $('ctgAnZhuangPromptXiaoXi');
    if (xiaoXi) {
      xiaoXi.textContent = '';
      xiaoXi.dataset.copyState = 'idle';
    }
    if (btn) {
      btn.onclick = async () => {
        const text = pre.textContent || tOr('container.env.prompt.content', '');
        let okCopy = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            okCopy = true;
          }
        } catch { okCopy = false; }
        if (!okCopy) {
          try {
            const range = document.createRange();
            range.selectNodeContents(pre);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            okCopy = document.execCommand && document.execCommand('copy');
            if (!okCopy) {
              // 选中后仍失败：保持选中，提示手动复制
              try {
                const range2 = document.createRange();
                range2.selectNodeContents(pre);
                const sel2 = window.getSelection();
                sel2.removeAllRanges();
                sel2.addRange(range2);
              } catch { /* noop */ }
            }
          } catch { okCopy = false; }
        }
        if (xiaoXi) {
          xiaoXi.dataset.copyState = okCopy ? 'copied' : 'failed';
          xiaoXi.textContent = okCopy
            ? tOr('container.env.prompt.copied', '已复制到剪贴板')
            : tOr('container.env.prompt.failed', '复制失败（请手动全选复制）');
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
    const btn = $('anNiuRongQiTanCe');
    if (btn) btn.onclick = () => {
      void (async () => {
        await probeContainers(true, true);
        // 探测后同步 Microsandbox 安装/卸载按钮状态
        try {
          const st = await window.warmy.microsandboxStatus?.();
          const installed = !!(st && st.ok);
          if (typeof window.__msbSheZhiAnNiu === 'function') window.__msbSheZhiAnNiu(installed);
        } catch { /* noop */ }
      })();
    };
    const heZi = $('rongQiLieBiao');
    if (heZi) {
      heZi.onclick = (Shi) => {
        const t2 = Shi.target;
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
    const tupianHe = $('rongQiImages');
    if (tupianHe) {
      const tuPianJi = (containerUi.report && containerUi.report.images) || [];
      tupianHe.innerHTML = tuPianJi.length
        ? tuPianJi.map((x) => {
            const yiGuding = !!x.digest;
            return '<div class="ctgHang" data-image="' + escapeHtml(x.id) + '" data-digest="' + (yiGuding ? '1' : '0') + '">' +
              '<div class="ctgHangHead"><span class="ctgMing">' + escapeHtml(x.ref) + '</span>' +
              '<span class="ctgHuiZhang" data-tone="' + (yiGuding ? 'ok' : 'danger') + '" data-pinned="' + (yiGuding ? '1' : '0') + '">' +
              escapeHtml(yiGuding ? t('container.image.pinned') : t('container.image.sourcePending')) + '</span></div>' +
              '<div class="ctgDim">' + escapeHtml(x.license) + ' · ' + escapeHtml(x.approxSize) + ' · ' + escapeHtml(x.platform) + '</div>' +
              '<div class="ctgDim">' + escapeHtml(x.purpose) + '</div>' +
              '<div class="ctgDim" data-digest-value="' + escapeHtml(String(x.digest || '')) + '">' +
              escapeHtml(yiGuding ? String(x.digest) : 'digest: —') + '</div>' +
              '</div>';
          }).join('')
        : '<div class="ctgDim">' + escapeHtml(t('container.probing')) + '</div>';
    }
    // 第八/九批：镜像**按项目技术栈**分档（最小 / 带 Node）+ 每档"适合什么项目"
    const stackBox = $('rongQiImageStacks');
    if (stackBox) {
      const tuPianJi = (containerUi.report && containerUi.report.images) || [];
      const stacks = ['minimal', 'node'];
      stackBox.innerHTML = stacks
        .map((st) => {
          const rows = tuPianJi.filter((x) => x.stack === st);
          const biaoTi = t(st === 'minimal' ? 'container.image.stack.minimal' : 'container.image.stack.node');
          const detail = rows.length
            ? rows.map((x) => '<div class="ctgDim" data-fits="' + escapeHtml(x.id) + '">' + escapeHtml(x.ref) + ' · ' +
                escapeHtml(t('container.image.stack.fits')) + '：' + escapeHtml(x.fits) + '</div>').join('')
            : '<div class="ctgDim" data-fits="none">' + escapeHtml(t('container.probing')) + '</div>';
          return '<div class="ctgHang" data-stack="' + st + '"><div class="ctgHangHead"><span class="ctgMing">' +
            escapeHtml(biaoTi) + '</span></div>' + detail + '</div>';
        })
        .join('');
    }
    const tBox = $('rongQiTimings');
    if (tBox) {
      const tm = (containerUi.report && containerUi.report.timings) || {};
      const Pian = [];
      if (typeof tm.engineStartMs === 'number') Pian.push(fmtKey('container.timing.start', { s: (tm.engineStartMs / 1000).toFixed(1) }));
      if (typeof tm.engineStopMs === 'number') Pian.push(fmtKey('container.timing.stop', { s: (tm.engineStopMs / 1000).toFixed(1) }));
      if (typeof tm.runMs === 'number') Pian.push(fmtKey('container.timing.run', { ms: String(tm.runMs) }));
      tBox.dataset.measured = Pian.length ? '1' : '0';
      tBox.textContent = Pian.length ? Pian.join('；') : t('container.timing.none');
    }
  }

  function markContainerCardFocused() {
    const ka = $('rongQiKa');
    if (!ka) return;
    ka.classList.add('rongQiKaFocus');
    ka.dataset.focusFrom = 'run-env';
    const cta = $('rongQiCta');
    if (cta) cta.classList.remove('yinCang');
    try { ka.scrollIntoView({ kuai: 'center' }); } catch { /* noop */ }
  }

  /**
   * 「去安装」的真实跳转：设置 → 功能 → 容器，并**滚到卡片 + 高亮 + 显示引导第一步**。
   * 这是 ADR §3.3 的那条链路，必须真的走到页面上（不是只改一个变量）。
   */
  async function gotoContainerCard() {
    containerUi.cameFromGuidance = true;
    setNav('settings');
    const funcBtn = document.querySelector('#peiZhiDaoHang button[data-sec="func"]');
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
    const kaifa = await loadContainerDevMap();
    const devEnv = devEnvOf(kaifa, id);
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
    const hang = runtimeId ? containerEntry(runtimeId) : null;
    const ready = !!(hang && hang.status === 'ready');
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
    const shuRu = $('shuRu');
    const lie = $('liaoTianLan');
    // 我的牛马：实例 stopped ⇒ 只读（可看历史/右栏，禁输入发送与工具钮）
    let singleStopped = false;
    try {
      if (sel && sel.kind === 'single') {
        const inst = (state.instances || []).find((x) => x.id === sel.id);
        singleStopped = !!(inst && inst.status === 'stopped');
      }
    } catch { /* noop */ }
    const xiangMuTai = sel && sel.kind === 'internal' ? await quXiangMuTai(sel.id) : null;
    const blocked = singleStopped || !!(xiangMuTai && xiangMuTai.stopped);
    const reason = blocked ? projectReasonText(xiangMuTai) : '';
    if (lie) {
      lie.dataset.projectState = xiangMuTai ? (blocked ? 'unavailable' : 'available') : 'none';
      lie.dataset.projectCode = xiangMuTai ? String(xiangMuTai.code) : '';
      lie.dataset.historyReadable = xiangMuTai ? '1' : '0';
    }
    if (shuRu) {
      shuRu.dataset.devBlocked = blocked ? '1' : '0';
      shuRu.disabled = blocked;
      shuRu.title = blocked ? fmtKey('container.project.blockedNotice', { reason }) : '';
    }
    const btn = $('anNiuFaSong');
    if (btn) { btn.disabled = blocked; btn.title = blocked ? (shuRu ? shuRu.title : '') : ''; }
    try {
      for (const id of ['anNiuAttach', 'anNiuYuYin', 'jinJiTrigger', 'anNiuTingZhiAll']) {
        const b = $(id);
        if (b) { b.disabled = blocked; b.style.opacity = blocked ? '0.45' : ''; }
      }
    } catch { /* noop */ }
    // 项目功能入口：不可用时禁用（跑执行者=在项目里干活；控制台另有自己的门禁）
    const exec = $('anNiuZhiXingYunXing');
    if (exec && xiangMuTai) {
      exec.disabled = blocked;
      exec.title = blocked ? fmtKey('container.project.blockedNotice', { reason }) : '';
    }
    // 历史区**保持可读**：不做任何 opacity/filter 之类会降低可读性的处理（对比度也不许降）
    const xiaoXi = $('xiaoXiJi');
    if (xiaoXi) xiaoXi.dataset.readonlyHistory = blocked ? '1' : '0';
    syncSendState();
    return blocked;
  }

  /** 右栏：项目状态（只读；动作在右键菜单里，右侧顶部**不再有**切换容器的入口） */
  async function renderProjectStateBlock() {
    const heZi = $('xiangMuTaiHe');
    if (!heZi) return;
    const sel = state.selectedChat;
    if (!sel || sel.kind !== 'internal') { heZi.innerHTML = ''; return; }
    const kaifa = await loadContainerDevMap();
    const devEnv = devEnvOf(kaifa, sel.id);
    const xiangMuTai = await quXiangMuTai(sel.id);
    if (!xiangMuTai) { heZi.innerHTML = ''; return; }
    // 环境事实（当前容器 / 引擎系统模式 / 固化能力 / 上次固化）——来自主进程，不假定 Linux
    let envInfo = null;
    try { envInfo = await window.warmy.projectEnvStatus({ sessionId: sel.id }); } catch { envInfo = null; }
    const blocked = xiangMuTai.stopped;
    const rt = xiangMuTai.runtimeId ? t('container.rt.' + xiangMuTai.runtimeId + '.name') : t('container.project.none');
    const offline = xiangMuTai.memberFaceKey ? t(xiangMuTai.memberFaceKey) : '';
    const html = [];
    html.push('<div class="ctgXiangMuTai" id="xiangMuTai" data-project-state="' + escapeHtml(blocked ? 'unavailable' : 'available') + '"' +
      ' data-project-code="' + escapeHtml(xiangMuTai.code) + '"' +
      ' data-member-face="' + escapeHtml(xiangMuTai.memberFace || '') + '"' +
      ' data-host-editing="' + (xiangMuTai.hostEditingRefused ? 'refused' : 'allowed') + '"' +
      ' data-history-readable="' + (xiangMuTai.historyReadable ? '1' : '0') + '">');
    if (blocked) {
      html.push('<div class="ctgDim ctgHuiZhangXian"><span class="ctgHuiZhang" data-tone="danger" data-offline="' + escapeHtml(offline) + '">' + escapeHtml(offline) + '</span>' +
        '<span class="ctgStoppedBiaoTi">' + escapeHtml(t('container.project.unavailable')) + '</span></div>');
    } else {
      html.push('<div class="ctgDim ctgHuiZhangXian"><span class="ctgHuiZhang" data-tone="ok">' + escapeHtml(t('container.project.available')) + '</span></div>');
    }
    html.push('<div class="ctgDim" data-dev-env="' + escapeHtml(devEnv) + '">' + escapeHtml(t('container.devEnv.biaoTi')) + '：' +
      escapeHtml(devEnv === 'container' ? t('container.devEnv.container') : t('container.devEnv.host')) + '</div>');
    html.push('<div class="ctgDim" data-project-runtime="' + escapeHtml(xiangMuTai.runtimeId || '') + '">' +
      escapeHtml(t('container.project.usingContainer')) + '：' + escapeHtml(rt) + '</div>');
    html.push('<div class="ctgDim" data-project-reason="' + escapeHtml(xiangMuTai.reasonKey || '') + '">' +
      escapeHtml(fmtKey('container.project.reasonBody', { reason: projectReasonText(xiangMuTai) })) + '</div>');
    if (blocked) {
      html.push('<div class="ctgDim" data-project-fix="' + escapeHtml(xiangMuTai.fix) + '">' + escapeHtml(t('container.project.fix.' + xiangMuTai.fix)) + '</div>');
      html.push('<div class="ctgDim" data-project-history="1">' + escapeHtml(t('container.project.historyStillReadable')) + '</div>');
      // 需要先启动/选容器时才给跳转（走与之前一致的引导流）
      if (xiangMuTai.fix === 'start-container' || xiangMuTai.fix === 'install-container' || xiangMuTai.fix === 'choose-container') {
        html.push('<div><button type="button" class="anNiuXiao" id="anNiuXiangMuGotoRongQi">' + escapeHtml(t('container.console.gotoInstall')) + '</button></div>');
      }
    }
    html.push('<div class="ctgDim" data-project-offline-note="1">' + escapeHtml(t('container.project.unavailableAsOffline')) + '</div>');
    /**
     * 第十六批：**异地成员**看到的是"创建者那边"的事实（属性与可用性都来自创建者的信号）。
     * 这一行是给成员的解释：为什么我这台机器上找不到这个容器，却依然显示"已停止"。
     * 复用同一句「创建者离线」文案，不新造第三种状态。
     */
    if (xiangMuTai.projectSource === 'creator-signal') {
      html.push('<div class="ctgDim" data-project-source="creator-signal">' + escapeHtml(t('container.project.remoteNotice')) + '</div>');
      if (xiangMuTai.projectReportedAt) {
        html.push('<div class="ctgDim" data-project-reported-at="' + String(xiangMuTai.projectReportedAt) + '">' +
          escapeHtml(fmtKey('container.project.remoteReportedAt', { time: new Date(xiangMuTai.projectReportedAt).toLocaleString() })) + '</div>');
      }
    }
    // 项目目录（**产品级事实**：成员也能看到这个项目挂的是哪个目录）
    if (xiangMuTai.projectDir) {
      html.push('<div class="ctgDim" data-project-dir="' + escapeHtml(xiangMuTai.projectDir) + '">' +
        escapeHtml(fmtKey('container.project.dirBody', { dir: xiangMuTai.projectDir })) + '</div>');
    } else if (devEnv === 'container') {
      html.push('<div class="ctgDim" data-project-dir-missing="1">' + escapeHtml(t('container.project.dirNotRecorded')) + '</div>');
    }
    if (devEnv === 'container') {
      html.push('<div class="ctgDim" data-project-host-edit="1">' + escapeHtml(t('container.project.hostEditingRefused')) + '</div>');
      html.push('<div class="ctgDim" data-project-boundary="1">' + escapeHtml(t('container.project.enforceBoundary')) + '</div>');
    }
    html.push('<div class="ctgDim" data-project-testing="1">' + escapeHtml(t('container.project.testingAllowed')) + '</div>');
    html.push('<div class="ctgDim" data-project-menu-hint="1">' + escapeHtml(t('container.project.menuHint')) + '</div>');
    /**
     * ADR 004 §7.8/§7.9（第九批）：**环境状态** —— 当前容器 / 引擎的系统模式 /
     * 固化能力 / 上次固化时间，并给一个显式的「固化当前环境」按钮。
     * 全部来自主进程的真实事实：能力**按运行时区分**（Docker/Podman 可 commit；WSL 没有 commit），
     * 系统模式从真探测里读（**不假定 Linux**），固化记录只写"真发生过的事"。
     */
    if (devEnv === 'container') {
      const env = envInfo;
      const abilityKey = (k) => 'container.env.solidify.ability.' + (k === 'commit' ? 'commit' : k === 'export-import' ? 'export-import' : 'unsupported');
      const whyText = env && env.solidify ? t('container.env.solidify.why.' + env.solidify.yuanYin) : '';
      const modeText = env && env.engineMode && env.engineMode !== 'unknown'
        ? String(env.engineMode)
        : t('container.env.mode.unknown');
      html.push('<div class="ctgTiShiHe" id="xiangMuHuanJingHe" data-env-kind="' + escapeHtml(env && env.solidify ? env.solidify.kind : 'unsupported') + '"' +
        ' data-env-programmatic="' + (env && env.solidify && env.solidify.programmatic ? '1' : '0') + '">' +
        '<div class="ctgTiShiBiaoTi">' + escapeHtml(t('container.env.solidify.biaoTi')) + '</div>' +
        '<div class="ctgDim" data-env-status="1">' + escapeHtml(fmtKey('container.env.solidify.status', {
          runtime: rt, ability: t(abilityKey(env && env.solidify ? env.solidify.kind : 'unsupported')),
        })) + '</div>' +
        '<div class="ctgDim" data-env-mode="' + escapeHtml(modeText) + '">' + escapeHtml(fmtKey('container.env.mode.ti', { mode: modeText })) + '</div>' +
        '<div class="ctgDim" data-env-why="' + escapeHtml(env && env.solidify ? env.solidify.yuanYin : 'no-runtime-chosen') + '">' + escapeHtml(whyText) + '</div>' +
        '<div class="ctgDim" data-env-last="' + escapeHtml(String((env && env.solidify && env.solidify.lastSolidifiedAt) || 0)) + '">' +
        escapeHtml((env && env.solidify && env.solidify.lastSolidifiedAt)
          ? fmtKey('container.env.solidify.last', { time: new Date(env.solidify.lastSolidifiedAt).toLocaleString(), image: String(env.solidify.lastImageRef || '—') })
          : t('container.env.solidify.never')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.env.solidify.retained')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(fmtKey('container.env.solidify.keep', { n: String((env && env.solidify && env.solidify.keep) || 3) })) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.env.solidify.security')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.env.solidify.restore')) + '</div>' +
        /**
         * 容器里**真的有**什么东西：这是"真实执行"在 UI 上的一个入口（跑的是固定命令表里的
         * `env-probe` 那一组，一条命令都不会来自渲染层）。
         */
        '<div class="ctgDongZuoJiHang">' +
        '<button type="button" class="anNiuXiao" id="anNiuHuanJingTanCe">' + escapeHtml(t('container.env.probe.button')) + '</button>' +
        '<button type="button" class="anNiuXiao" id="anNiuGuHuaHuanJing">' + escapeHtml(t('container.env.solidify.button')) + '</button>' +
        '<button type="button" class="anNiuXiao" id="anNiuHuiGunHuanJing"' + (env && env.solidify && env.solidify.lastImageRef ? '' : ' disabled') + '>' +
        escapeHtml(t('container.env.rollback.button')) + '</button>' +
        '</div>' +
        '<div class="ctgDim" id="huanJingTanCeXiaoXi" data-probe-state="idle"></div>' +
        '<span class="ctgDim" id="guHuaXiaoXi" data-solidify-state="idle"></span>' +
        '<span class="ctgDim" id="huiGunXiaoXi" data-rollback-state="idle"></span>' +
        '</div>');
      // 宿主目录加锁（P5）：**只有创建者**、**只有用户按键**才会真的改 ACL；这里如实显示当前状态
      let guard = null;
      try { guard = await window.warmy.projectFsGuard({ sessionId: sel.id, action: 'status' }); } catch { guard = null; }
      html.push('<div class="ctgTiShiHe" id="wenJianXiTongShouWeiHe" data-guard-supported="' + (guard && guard.platformSupported ? '1' : '0') + '"' +
        ' data-guard-active="' + (guard && guard.guarded ? '1' : '0') + '">' +
        '<div class="ctgTiShiBiaoTi">' + escapeHtml(t('container.fsGuard.biaoTi')) + '</div>' +
        '<div class="ctgDim" data-guard-state="' + escapeHtml(guard && guard.guarded ? 'guarded' : (guard && guard.code ? guard.code : 'off')) + '">' +
        escapeHtml(guard && guard.ok && guard.guarded ? t('container.fsGuard.qiYong')
          : guard && !guard.ok ? t('container.fsGuard.unavailable.' + String(guard.code || 'unknown'))
            : t('container.fsGuard.off')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.fsGuard.what')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.fsGuard.undo')) + '</div>' +
        '<div class="ctgDim">' + escapeHtml(t('container.fsGuard.limits')) + '</div>' +
        '<div class="ctgDongZuoJiHang">' +
        '<button type="button" class="anNiuXiao" id="anNiuWenJianXiTongShouWei"' + (guard && guard.platformSupported && xiangMuTai.localIsCreator ? '' : ' disabled') + '>' +
        escapeHtml(guard && guard.guarded ? t('container.fsGuard.unlock') : t('container.fsGuard.lock')) + '</button>' +
        '<span class="ctgDim" id="wenJianXiTongShouWeiXiaoXi"></span></div></div>');
    }
    html.push('</div>');
    heZi.innerHTML = html.join('');
    const go = $('anNiuXiangMuGotoRongQi');
    if (go) go.onclick = () => { void gotoContainerCard(); };
    /**
     * 「固化当前环境」：现在**真的会 commit**（第十六批）。
     * 三种结果如实分开：真成功（有镜像 id）/ 如实拒绝（能力不支持·没容器·节流）/ 失败（带原始输出）。
     * **绝不在没成功的时候显示"已固化"**。
     */
    const solid = $('anNiuGuHuaHuanJing');
    if (solid) {
      solid.disabled = !(envInfo && envInfo.solidify && envInfo.solidify.programmatic);
      solid.onclick = async () => {
        const xiaoXi = $('guHuaXiaoXi');
        const r = await window.warmy.projectEnvSolidify({ sessionId: sel.id, explicit: true }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        const ok = !!(r && r.ok && r.evidence === 'commit-succeeded');
        // ⚠️ 顺序很重要：**先重新渲染**（固化成功会改变"上次固化/回滚按钮"），
        // 再把结果写在**新的**那个消息节点上 —— 反过来会被重渲染冲掉（实测踩过）。
        if (ok) await renderProjectStateBlock();
        const msg2 = $('guHuaXiaoXi') || xiaoXi;
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
    const roll = $('anNiuHuiGunHuanJing');
    if (roll) {
      roll.onclick = async () => {
        const xiaoXi = $('huiGunXiaoXi');
        const go2 = await uiConfirm(t('container.env.rollback.confirmBody'), t('container.env.rollback.confirmTitle'));
        if (!go2) return null;
        const r = await window.warmy.projectEnvRollback({ sessionId: sel.id }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        // 先刷新（回滚会改变容器状态），再写消息 —— 否则会被重渲染冲掉
        await afterProjectStateChange(sel.id);
        const msg2 = $('huiGunXiaoXi') || xiaoXi;
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
    const probeBtn = $('anNiuHuanJingTanCe');
    if (probeBtn) {
      probeBtn.onclick = async () => {
        const xiaoXi = $('huanJingTanCeXiaoXi');
        const r = await window.warmy.projectExec({ sessionId: sel.id, command: 'env-probe' }).catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        if (xiaoXi) {
          xiaoXi.dataset.probeState = r && r.ok ? 'done' : 'refused';
          if (r && r.ok) {
            xiaoXi.textContent = String(r.shuChu || '').replace(/\s+/g, ' ').slice(0, 300);
          } else {
            const key = 'container.env.probe.refused.' + String((r && r.code) || 'unknown');
            const text = t(key);
            xiaoXi.textContent = text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text;
          }
        }
        return r;
      };
    }
    /** 「锁定 / 解锁项目目录」：**文件系统级**那道防线，可一键撤销 */
    const guardBtn = $('anNiuWenJianXiTongShouWei');
    if (guardBtn) {
      guardBtn.onclick = async () => {
        const xiaoXi = $('wenJianXiTongShouWeiXiaoXi');
        const box2 = $('wenJianXiTongShouWeiHe');
        const xiangJieChu = box2 && box2.dataset.guardActive === '1';
        if (!xiangJieChu) {
          const go3 = await uiConfirm(t('container.fsGuard.confirmBody'), t('container.fsGuard.confirmTitle'));
          if (!go3) return null;
        }
        const r = await window.warmy.projectFsGuard({ sessionId: sel.id, action: xiangJieChu ? 'lift' : 'apply' })
          .catch((e) => ({ ok: false, code: 'ipc-failed', error: String((e && e.message) || e) }));
        // 先重渲染（状态块要换成"已锁定/未锁定"），再写消息
        await renderProjectStateBlock();
        const msg2 = $('wenJianXiTongShouWeiXiaoXi') || xiaoXi;
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
   * 数据全部来自主进程 `warmy:xiangMuWenJianJi`，第十六批之后有**四类真实来源**：
   *   ① **工具文件访问台账**（项目级、成员可见：读/写/改/删/建/备份/回滚 + 时间）；
   *   ② 回退点明细（真实 path + 真实 ts）；
   *   ③ **项目目录扫描**（真实 mtime；目录来自项目记录）；
   *   ④ 产物目录扫描（入口识别 + 能不能在本机跑）。
   * 拿不到就**如实显示空态与原因**（`missingSources`），**绝不**拿演示数据充数。
   * 「其他文件」= 被工具动过但**不在项目目录下**的路径（来源逐条标出来）。
   */
  async function renderProjectFilesBlock() {
    const heZi = $('xiangMuWenJianJiHe');
    if (!heZi) return;
    const sel = state.selectedChat;
    // 单聊（我的牛马）也要显示：AI 产出的文件归到这张卡里
    if (!sel || (sel.kind !== 'internal' && sel.kind !== 'single')) { heZi.innerHTML = ''; return; }
    let shiShi = null;
    try { shiShi = await window.warmy.projectFiles({ sessionId: sel.id }); } catch { shiShi = null; }
    if (!shiShi || !shiShi.ok) {
      heZi.innerHTML = '<div class="ctgDim" data-files-empty="load-failed">' + escapeHtml(t('projectFiles.loadFailed')) + '</div>';
      return;
    }
    const LeiXingMing = (k) => t('projectFiles.kind.' + (k || 'changed'));
    const sourceLabel = (s) => t('projectFiles.source.' + (s || 'unknown'));
    /**
     * 文件展示统一口径（产品要求）：
     *   · **不显示完整路径**，只显示文件名；
     *   · 按扩展名给一个**线条图标**（与朗读/复制图标同一路子）；
     *   · 完整路径放在 `title`，鼠标放上去才看；
     *   · 点击打开文件。
     */
    const jianMing = (p) => {
      const s = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      return i >= 0 ? s.slice(i + 1) : s;
    };
    const wenJianIco = (p) => {
      const s = String(p || '');
      const ext = (s.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '';
      const e = ext.toLowerCase();
      const svg = (nei) => '<svg viewBox="0 0 24 24" class="pfIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + nei + '</svg>';
      const WEN = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
      if (!e) return svg(WEN + '<path d="M8 13h8M8 17h5"/>');                                  // 无扩展名 = 通用文件
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(e)) return svg(WEN + '<circle cx="9.5" cy="12" r="1.4"/><path d="M7 18l4-4 3 3 2-2 3 3"/>');
      if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a'].includes(e)) return svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>');
      if (['doc', 'docx', 'md', 'rtf'].includes(e)) return svg(WEN + '<path d="M8 13h8M8 17h8M8 9h3"/>');
      if (['ppt', 'pptx', 'key'].includes(e)) return svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>');
      if (['xls', 'xlsx', 'csv', 'tsv'].includes(e)) return svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>');
      if (['pdf'].includes(e)) return svg(WEN + '<path d="M8 13h8M8 17h4"/>');
      if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'sh', 'ps1', 'json', 'yml', 'yaml', 'xml', 'html', 'css'].includes(e)) return svg('<path d="M8 6l-4 6 4 6M16 6l4 6-4 6M13 5l-2 14"/>');
      return svg(WEN + '<path d="M8 13h8M8 17h5"/>');
    };
    const faShengShiJian = (ts) => {
      if (!ts) return '—';
      try {
        const d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      } catch { return '—'; }
    };
    /** 一行文件：图标 + 文件名（title = 完整路径）+ 类型/时间等副信息 */
    const rowOf = (f, extra) =>
      '<div class="ctgHang pfHang" data-path="' + escapeHtml(f.path) + '" data-kind="' + escapeHtml(f.kind) + '"' +
      (f.op ? ' data-op="' + escapeHtml(f.op) + '"' : '') +
      (f.source ? ' data-source="' + escapeHtml(f.source) + '"' : '') + ' data-open="' + escapeHtml(f.path) + '">' +
      '<div class="ctgHangHead">' +
      '<span class="pfIcoJi" title="' + escapeHtml(f.path) + '">' + wenJianIco(f.path) + '</span>' +
      '<span class="pfMing" title="' + escapeHtml(f.path) + '">' + escapeHtml(jianMing(f.path)) + '</span>' +
      '<span class="pfLeiXing" data-kind="' + escapeHtml(f.kind) + '">' + escapeHtml(LeiXingMing(f.kind)) + '</span>' +
      '<span class="ctgDim">' + escapeHtml(faShengShiJian(f.ts)) + '</span></div>' +
      (extra ? '<div class="ctgDim">' + escapeHtml(extra) + '</div>' : '') +
      '</div>';
    const html = [];
    // ① 最近改动文件
    html.push('<div class="pfHead" data-pf="changed">' + escapeHtml(t('projectFiles.changedTitle')) + '</div>');
    html.push(shiShi.changed && shiShi.changed.length
      ? shiShi.changed.slice(0, 20).map((f) => rowOf(f, f.source ? sourceLabel(f.source) : '')).join('')
      : '<div class="ctgDim" data-empty="changed">' + escapeHtml(t('projectFiles.empty.' + (shiShi.projectDirReason === 'not-recorded' ? 'noProjectDir' : 'changed'))) + '</div>');
    // ② 其他文件（非项目内的）
    html.push('<div class="pfHead" data-pf="other">' + escapeHtml(t('projectFiles.otherTitle')) + '</div>');
    html.push(shiShi.other && shiShi.other.length
      ? shiShi.other.slice(0, 20).map((f) => rowOf(f, sourceLabel(f.source))).join('')
      : '<div class="ctgDim" data-empty="other">' + escapeHtml(t('projectFiles.empty.other')) + '</div>');
    // ③ 生成的产品
    const p = shiShi.chanPin || {};
    html.push('<div class="pfHead" data-pf="chanPin">' + escapeHtml(t('projectFiles.productTitle')) + '</div>');
    html.push('<div class="ctgHang" id="chanPinKa" data-product-kind="' + escapeHtml(p.kind || 'none') + '"' +
      ' data-product-dir-exists="' + (p.dirExists ? '1' : '0') + '" data-entry-runnable="' + (p.entryHostRunnable ? '1' : '0') + '">' +
      '<div class="ctgDim pfHang" data-product-dir="' + escapeHtml(p.dir || '') + '" data-open="' + escapeHtml(p.dir || '') + '" title="' + escapeHtml(p.dir || '') + '" style="cursor:pointer">' +
      escapeHtml(t('projectFiles.productDir')) + '：<span class="pfMing">' + escapeHtml(jianMing(p.dir) || p.dir || '—') + '</span>' +
      (p.dirExists ? '' : ' · ' + escapeHtml(t('projectFiles.productDirPlanned'))) + '</div>');
    if (p.entry) {
      html.push('<div class="pfLuJing pfHang" data-product-entry="' + escapeHtml(p.entry) + '" data-open="' + escapeHtml(p.entry) + '" title="' + escapeHtml(p.entry) + '">' +
        '<span class="pfIcoJi">' + wenJianIco(p.entry) + '</span>' +
        '<span class="pfMing">' + escapeHtml(jianMing(p.entry)) + '</span></div>');
      html.push('<div class="ctgDim">' + escapeHtml(LeiXingMing(p.kind === 'program' ? 'program' : 'file')) + '</div>');
    } else {
      html.push('<div class="ctgDim" data-product-none="' + escapeHtml(p.entryReason || 'none') + '">' + escapeHtml(t('projectFiles.entry.' + (p.entryReason || 'none'))) + '</div>');
    }
    html.push('<div class="ctgDim" data-product-run-reason="' + escapeHtml(p.entryReason || '') + '">' +
      escapeHtml(t('projectFiles.runReason.' + (p.entryReason || 'none'))) + '</div>');
    html.push('<div class="pfDongZuoJi"><button type="button" class="anNiuXiao" id="anNiuChanPinYunXing"' +
      (p.kind === 'program' && p.entryHostRunnable ? '' : ' disabled') + '>' + escapeHtml(t('projectFiles.run')) + '</button>' +
      '<span class="ctgDim" id="chanPinYunXingXiaoXi"></span></div>');
    /**
     * 台账本身也如实摆一行出来（**项目级、成员可见**）：有多少条、什么来源。
     * 这样"记录文件的改动是产品功能"这件事在界面上是**看得见**的，而不是只写在文档里。
     */
    const zhangBenHang = shiShi.ledger || [];
    html.push('<div class="ctgDim" data-ledger-count="' + String(zhangBenHang.length) + '" data-ledger-scope="project">' +
      escapeHtml(fmtKey('projectFiles.ledgerCount', { n: String(zhangBenHang.length) })) + '</div>');
    if (shiShi.projectSource === 'creator-signal') {
      html.push('<div class="ctgDim" data-project-source="creator-signal">' +
        escapeHtml(t('projectFiles.fromCreatorSignal')) + '</div>');
    }
    if (shiShi.missingSources && shiShi.missingSources.length) {
      html.push('<div class="ctgDim" data-missing-sources="' + escapeHtml(shiShi.missingSources.join(',')) + '">' +
        escapeHtml(fmtKey('projectFiles.missingHint', { n: String(shiShi.missingSources.length) })) + '</div>');
    }
    html.push('</div>');
    // ④ 工作区产出：AI 真写出来的文件 —— 链接式（点开即打开）+ 文件夹图标（打开所在目录）
    {
      const gz = (state.gongZuoWenJian || []);
      html.push('<div class="pfHead" data-pf="work">' + escapeHtml(tOr('panel.workfiles.title', '文件产物')) +
        ' <button class="anNiuXiao" id="anNiuShuaXinChanPin" title="' + escapeHtml(tOr('panel.workfiles.refresh', '刷新')) + '" style="margin-left:6px">↻</button></div>');
      if (state.gongZuoQuLuJing) {
        html.push('<div class="ctgDim" style="font-size:11px;word-break:break-all">' +
          escapeHtml(tOr('panel.workfiles.workspace', '工作区')) + '：<a href="#" class="pfLink" data-open="' + escapeHtml(state.gongZuoQuLuJing) + '" title="' + escapeHtml(state.gongZuoQuLuJing) + '">' + escapeHtml(jianMing(state.gongZuoQuLuJing) || state.gongZuoQuLuJing) + '</a></div>');
      }
      // 字节 → 自适应单位（>1024 逐级升）
      const ziJie = (n) => {
        const v = Number(n) || 0;
        if (v < 1024) return v + ' B';
        if (v < 1024 * 1024) return (v / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
        if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
        return (v / 1024 / 1024 / 1024).toFixed(2).replace(/\.00$/, '') + ' GB';
      };
      html.push(gz.length
        ? gz.slice(-30).reverse().map((g) => {
            const abs = String(g.abs || '');
            const luJing = String(g.path || abs || '');
            const shiJian = g.ts ? new Date(Number(g.ts)).toLocaleString() : '';
            // 产品要求：**不显示完整路径**，只给图标 + 文件名；完整路径挂在 title 上；点击打开
            return '<div class="ctgHang pfHang pfHangKeDian" data-open="' + escapeHtml(abs || luJing) + '" title="' + escapeHtml(abs || luJing) + '">' +
              '<div class="ctgHangHead">' +
              '<span class="pfIcoJi">' + wenJianIco(luJing) + '</span>' +
              '<span class="pfMing">' + escapeHtml(jianMing(luJing)) + '</span>' +
              '<span class="ctgDim">' + ziJie(g.bytes) + (shiJian ? ' · ' + escapeHtml(shiJian) : '') + '</span>' +
              '<button class="anNiuXiao" data-reveal="' + escapeHtml(abs) + '" title="' + escapeHtml(tOr('panel.workfiles.reveal', '打开所在文件夹')) + '" aria-label="' + escapeHtml(tOr('panel.workfiles.reveal', '打开所在文件夹')) + '">📁</button>' +
              '</div></div>';
          }).join('')
        : '<div class="ctgDim" data-empty="work">' + escapeHtml(tOr('panel.workfiles.empty', '还没有生成文件')) + '</div>');
    }
    heZi.innerHTML = html.join('');
    heZi.querySelector('#anNiuShuaXinChanPin')?.addEventListener('click', () => {
      try { void renderProjectFilesBlock(); } catch { /* noop */ }
      showToast(tOr('panel.workfiles.refreshed', '已刷新'));
    });
    // 产出文件：点链接打开文件；点文件夹图标在资源管理器里定位
    heZi.querySelectorAll('[data-open]').forEach((a) => {
      a.onclick = async (e) => {
        e.preventDefault();
        const r = await window.warmy.daKaiLuJing?.({ path: a.getAttribute('data-open') });
        if (r && r.ok === false) uiAlert(String(r.error || t('common.error')));
      };
    });
    heZi.querySelectorAll('[data-reveal]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = await window.warmy.xianShiWenJianJia?.({ path: b.getAttribute('data-reveal') });
        if (r && r.ok === false) uiAlert(String(r.error || t('common.error')));
      };
    });
    const run = $('anNiuChanPinYunXing');
    if (run) {
      run.onclick = async () => {
        const xiaoXi = $('chanPinYunXingXiaoXi');
        const r = await window.warmy.productRun({ sessionId: sel.id }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
        if (xiaoXi) {
          xiaoXi.textContent = r && r.ok
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
    const btn = $('anNiuRongQiKongZhiTai');
    if (!btn) return;
    // 我的牛马永不进容器 ⇒ 控制台按钮直接隐藏（项目里仍保留）
    try {
      const sel = state.selectedChat;
      if (!sel || sel.kind === 'single') {
        btn.classList.add('yinCang');
        btn.style.display = 'none';
        return 'hidden-single';
      }
      btn.classList.remove('yinCang');
      btn.style.display = '';
    } catch { /* noop */ }
    const menjin = await currentShellGate();
    // 按钮可用 = 面板能打开（引擎就绪）；能不能**跑命令**另有一说（见 applyShellAvailability）
    btn.disabled = !menjin.openable;
    btn.dataset.menjin = menjin.openable ? 'ok' : menjin.code;
    btn.dataset.gateReason = menjin.reason;
    btn.dataset.shellExecutable = menjin.available ? '1' : '0';
    btn.title = menjin.openable ? t('container.console.tip') : t('container.console.' + menjin.reason);
    const mianBan = $('ctgKongZhiTaiMianBan');
    if (mianBan && !mianBan.classList.contains('yinCang')) applyShellAvailability(menjin);
    return btn.dataset.menjin;
  }

  /** 输入行的可用性 = 门禁的直接结果（不可用就 disabled，不是"能敲但被忽略"） */
  function applyShellAvailability(menjin) {
    const shuRu = $('ctgKongZhiTaiShuRu');
    const faSong = $('ctgKongZhiTaiFaSong');
    const note = $('ctgKongZhiTaiNote');
    const status = $('ctgKongZhiTaiZhuangTai');
    const usable = !!(menjin && menjin.available);
    if (shuRu) {
      shuRu.disabled = !usable;
      shuRu.dataset.shellInput = usable ? 'enabled' : 'disabled';
    }
    if (faSong) faSong.disabled = !usable;
    if (status) {
      status.dataset.shellState = menjin ? menjin.code : 'unknown';
      status.textContent = t('container.console.' + ((menjin && menjin.reason) || 'notReady'));
    }
    if (note) {
      note.dataset.shellNote = usable ? 'ok' : ((menjin && menjin.code) || 'not-ready');
      note.textContent = t('container.console.' + ((menjin && menjin.reason) || 'notReady'));
    }
    return usable;
  }

  async function openContainerShell() {
    const mianBan = $('ctgKongZhiTaiMianBan');
    if (!mianBan) return false;
    const menjin = await currentShellGate();
    if (!menjin.openable) return false;
    mianBan.classList.remove('yinCang');
    const tiShi = $('ctgKongZhiTaiTiShi');
    if (tiShi) tiShi.textContent = t('container.console.biaoTi');
    const out = $('ctgKongZhiTaiShuChu');
    const sel = state.selectedChat;
    const conn = sel ? await window.warmy.projectState({ sessionId: sel.id }).catch(() => null) : null;
    const jiLu = { runtimeId: (conn && conn.ok && conn.state && conn.state.runtimeId) || '' };
    /**
     * **真的去问主进程**（不写死一段文案）：主进程做参数校验 + 门禁，
     * 并在任何未就绪的情况下如实拒绝（`executed: false`）—— 也就是**一条命令都没执行**。
     * 参数形状只有 { runtimeId, action }（action 是枚举）——**没有任何命令字符串**。
     */
    let xiangYing = null;
    try {
      xiangYing = await window.warmy.containerShell({ runtimeId: String(jiLu.runtimeId || ''), action: 'daKai', sessionId: sel ? sel.id : '' });
    } catch (e) {
      xiangYing = { ok: false, code: 'ipc-failed', reasonKey: 'notReady', security: null, error: String((e && e.message) || e) };
    }
    const HangJi = [
      t('container.console.intro'),
      '',
      fmtKey('container.console.stateLine', {
        code: String((xiangYing && xiangYing.code) || 'unknown'),
        yuanYin: t('container.console.' + ((xiangYing && xiangYing.reasonKey) || 'notReady')),
      }),
      '',
    ];
    if (!xiangYing || !xiangYing.ok) {
      HangJi.push(t('container.console.needsImage'));
      HangJi.push('');
      HangJi.push(t('container.console.linuxNode'));
      HangJi.push('');
      HangJi.push(t('container.console.noExec'));
      HangJi.push('');
    } else {
      /**
       * 第十六批：门禁通过 ⇒ **真的在容器里开了一条 shell**（`insideContainer:true` 是主进程
       * 回给我们的**事实**）。这里如实说明容器名与"容器是新起的还是原本就在"。
       */
      HangJi.push(fmtKey('container.console.openedInContainer', { container: String(xiangYing.containerRef || '') }));
      HangJi.push('');
      HangJi.push(xiangYing.containerCreated ? t('container.console.containerCreated') : t('container.console.containerReused'));
      HangJi.push('');
    }
    HangJi.push(t('container.console.security'));
    HangJi.push(fmtKey('container.console.securityDetail', {
      remote: String((xiangYing && xiangYing.security && xiangYing.security.remoteInjectPaths) ?? 0),
      auto: (xiangYing && xiangYing.security && xiangYing.security.autoRun) === true ? '1' : '0',
      secretEnv: (xiangYing && xiangYing.security && xiangYing.security.forwardsSecretEnv) === true ? '1' : '0',
    }));
    if (out) out.textContent = HangJi.join('\n') + '\n';
    applyShellAvailability(menjin);
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
    const jiLu = { runtimeId: (xiangMuTai && xiangMuTai.runtimeId) || '' };
    if (!runInContainer) return { available: false, openable: false, code: 'not-enabled', reason: 'notEnabled', needsInstall: false };
    if (xiangMuTai && xiangMuTai.stopped) return { available: false, openable: false, code: 'project-stopped', reason: 'projectStopped', needsInstall: false };
    const hang = jiLu.runtimeId ? containerEntry(jiLu.runtimeId) : null;
    if (!hang || hang.status !== 'ready') return { available: false, openable: false, code: 'container-not-ready', reason: 'notReady', needsInstall: true };
    /**
     * 第十六批：引擎就绪 ⇒ **可以真的跑命令**（镜像表已钉死 digest、项目容器按需创建）。
     * 门禁第 ⑤ 档（`no-image`）只在"运行时不是容器可执行的白名单"时才成立 ——
     * 这与主进程 `containerShellGate({ imageReady })` 的判据保持一致。
     */
    const executable = jiLu.runtimeId === 'docker' || jiLu.runtimeId === 'podman' || jiLu.runtimeId === 'nerdctl' || jiLu.runtimeId === 'rancher-desktop';
    if (!executable) return { available: false, openable: true, code: 'no-image', reason: 'needsImage', needsInstall: false };
    return { available: true, openable: true, code: 'ok', reason: 'ok', needsInstall: false };
  }

  /**
   * 本机的人敲了一行 → 送到主进程（`action:'write'`）。
   * 主进程未就绪时**不会**执行任何东西（`executed:false`），这里如实回显拒绝，
   * 并且**不会**在本机执行、也**不会**把内容塞进事件日志（那是另一个面板）。
   */
  async function submitShellLine() {
    const menjin = await currentShellGate();
    const shuRu = $('ctgKongZhiTaiShuRu');
    const out = $('ctgKongZhiTaiShuChu');
    const Hang = shuRu ? String(shuRu.value || '') : '';
    if (!menjin.available) {
      applyShellAvailability(menjin);
      if (out) out.textContent += escapeHtml(t('container.console.noExec')) + '\n';
      return false;
    }
    if (!Hang.trim()) return false;
    const sel = state.selectedChat;
    const conn2 = sel ? await window.warmy.projectState({ sessionId: sel.id }).catch(() => null) : null;
    const jiLu = { runtimeId: (conn2 && conn2.ok && conn2.state && conn2.state.runtimeId) || '' };
    let xiangYing = null;
    try {
      xiangYing = await window.warmy.containerShell({ runtimeId: String(jiLu.runtimeId || ''), action: 'write', sessionId: sel ? sel.id : '', data: Hang });
    } catch (e) {
      xiangYing = { ok: false, code: 'ipc-failed', reasonKey: 'notReady', executed: false, error: String((e && e.message) || e) };
    }
    const executed = !!(xiangYing && xiangYing.ok && xiangYing.executed !== false);
    if (out) {
      out.textContent += (executed ? t('container.console.sent') : t('container.console.refused') + ' ') + Hang + '\n';
      if (!executed) out.textContent += t('container.console.' + ((xiangYing && xiangYing.reasonKey) || 'notReady')) + '\n';
      /**
       * 第十六批：**容器里的真实输出**原样贴出来（这是"真的在容器里跑"最直接的证据）。
       * 没有输出就什么都不加（不编一句"没有输出"以外的内容）。
       */
      if (executed && xiangYing && xiangYing.shuChu) out.textContent += String(xiangYing.shuChu);
      if (executed && xiangYing && xiangYing.autoSolidify && xiangYing.autoSolidify.done) {
        out.textContent += '\n' + fmtKey('container.env.solidify.done', {
          time: new Date().toLocaleString(), image: String(xiangYing.autoSolidify.imageRef || ''), id: '',
        });
      }
      out.scrollTop = out.scrollHeight;
    }
    if (shuRu) shuRu.value = '';
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
      const xiaoXi = $('project-ctl-msg') || $('xiangMuTaiXiaoXi');
      if (xiaoXi) xiaoXi.textContent = t('container.project.enabledAt');
      return true;
    }
    if (r && r.code === 'not-creator') { await uiAlert(t('container.project.notCreator'), t('container.devEnv.biaoTi')); return false; }
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
      if (r && r.code === 'not-creator') { await uiAlert(t('container.project.notCreator'), t('container.devEnv.biaoTi')); return false; }
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
    const kaifa = await loadContainerDevMap();
    if (devEnvOf(kaifa, groupId) !== 'container') {
      await uiAlert(t('container.project.notContainerProject'), t('container.devEnv.biaoTi'));
      return null;
    }
    const rep = await probeContainers(true);
    const usable = (rep && rep.usableIds) || [];
    const cur = (await loadProjectRuntimeMap())[groupId] || '';
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('container.project.switchTitle');
    const duiHuaTi = $('duiHuaKuangTi');
    duiHuaTi.innerHTML = '';
    const touBu = document.createElement('div');
    touBu.className = 'ctgDim';
    touBu.textContent = t('container.project.switchBody');
    duiHuaTi.appendChild(touBu);
    let done = false;
    const wanCheng = (v) => { if (done) return; done = true; root.classList.add('yinCang'); resolveSwitch(v); };
    let resolveSwitch = null;
    const p = new Promise((res) => { resolveSwitch = res; });
    if (!usable.length) {
      const wu = document.createElement('div');
      wu.className = 'ctgErr';
      wu.id = 'switchNone';
      wu.textContent = fmtKey('container.project.switchNoContainer', { reason: noReadyReason(rep) });
      duiHuaTi.appendChild(wu);
    }
    usable.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cur === id ? 'ctgHuanJingOpt qiYong' : 'ctgHuanJingOpt';
      b.id = 'switchRt' + id;
      b.setAttribute('data-pick', id);
      b.innerHTML = '<span class="ctgHuanJingBiaoTi">' + escapeHtml(t('container.rt.' + id + '.name')) + '</span>' +
        '<span class="ctgDim">' + escapeHtml(t('container.project.switchFits')) + '</span>';
      b.onclick = () => wanCheng(id);
      duiHuaTi.appendChild(b);
    });
    const dongZuoJi = $('duiHuaKuangDongZuoJi');
    dongZuoJi.innerHTML = '';
    const gengDuo = document.createElement('button');
    gengDuo.className = 'anNiuXiao';
    gengDuo.id = 'switchGengDuo';
    gengDuo.textContent = t('container.project.switchMore');
    gengDuo.onclick = () => { wanCheng('__more__'); };
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.id = 'switchCancel';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => wanCheng(null);
    dongZuoJi.append(gengDuo, cancel);
    root.classList.remove('yinCang');
    if (gengDuo) gengDuo.focus();
    const picked = await p;
    if (picked === '__more__') { await gotoContainerCard(); return null; }
    if (!picked) return null;
    const r = await window.warmy.projectSetContainer({ sessionId: groupId, runtimeId: picked }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (!r || !r.ok) {
      await uiAlert(fmtKey('container.project.switchFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
      return null;
    }
    await afterProjectStateChange(groupId);
    const xiaoXi = $('xiangMuTaiXiaoXi');
    if (xiaoXi) {
      xiaoXi.textContent = r.restartRequired
        ? t('container.project.switchNeedRestart')
        : fmtKey('container.project.switchDone', { ming: t('container.rt.' + picked + '.name') });
    }
    return picked;
  }

  /** 项目右键菜单条目（追加到既有的 groupMenu 上；只在 internal 项目里出现） */
  async function projectMenuItems(g) {
    // 状态与"是不是容器开发项目"都问**主进程**（唯一事实来源），不在渲染层猜
    const state19 = await quXiangMuTai(g.id);
    const blocked = !!(state19 && state19.stopped);
    const kaifa = await loadContainerDevMap();
    const isContainerProject = devEnvOf(kaifa, g.id) === 'container';
    const items = [
      blocked
        ? {
            biaoQian: t('ctx.projectEnable'),
            onClick: async () => { await enableProjectFlow(g.id); },
          }
        : {
            biaoQian: t('ctx.projectDisable'),
            weixian: true,
            onClick: async () => { await disableProjectFlow(g.id); },
          },
    ];
    // 只有"创建时选了容器开发的项目"才有切换容器的出口
    if (isContainerProject) {
      items.push({
        biaoQian: t('ctx.projectSwitchContainer'),
        onClick: async () => { await switchContainerDialog(g.id); },
      });
      /**
       * 第十六批新增两个入口：
       *  · 「设置项目目录」：把项目目录记进**项目记录**（成员据此解析"最近改动文件"）；
       *  · 「锁定/解锁项目目录」：**文件系统级**那道防线（可一键撤销，见 container.fsGuard.*）。
       */
      items.push({
        biaoQian: t('ctx.projectSetDir'),
        onClick: async () => {
          const r = await window.warmy.projectSetDirectory({ sessionId: g.id }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
          if (r && r.ok) {
            await afterProjectStateChange(g.id);
            const xiaoXi = $('xiangMuTaiXiaoXi');
            if (xiaoXi) xiaoXi.textContent = fmtKey('container.project.dirSet', { dir: String(r.dir || '') });
          } else if (r && !r.canceled) {
            await uiAlert(fmtKey('container.project.dirSetFailed', { err: String((r && (r.error || r.code)) || 'unknown') }));
          }
        },
      });
      items.push({
        biaoQian: t('ctx.projectLockDir'),
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
      await uiAlert(text === key ? fmtKey('container.project.enableFailed', { err: String((st && (st.error || st.code)) || 'unknown') }) : text, t('container.fsGuard.biaoTi'));
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
      await uiAlert(text === key ? fmtKey('container.project.enableFailed', { err: String((r && (r.error || r.code)) || 'unknown') }) : text, t('container.fsGuard.biaoTi'));
      return false;
    }
    await afterProjectStateChange(groupId);
    return true;
  }

  /** 多选项弹窗（走项目既有 #duiHuaKuangGen；标题/正文/按钮文案全走 i18n） */
  function uiChoice(titleText, bodyText, choices) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = titleText || displayName();
      $('duiHuaKuangTi').textContent = String(bodyText ?? '');
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      let done = false;
      const wanCheng = (v) => { if (done) return; done = true; root.classList.add('yinCang'); resolve(v); };
      (choices || []).forEach((c) => {
        const b = document.createElement('button');
        b.className = c.primary ? 'anNiuZhuYao' : 'anNiuXiao';
        b.textContent = c.biaoQian;
        b.setAttribute('data-choice', c.key);
        b.id = 'ctgChoice' + c.key;
        b.onclick = () => wanCheng(c.key);
        dongZuoJi.appendChild(b);
      });
      root.classList.remove('yinCang');
      const first = dongZuoJi.querySelector('button');
      if (first) first.focus();
    });
  }

  // ── onlyQun / 右栏分区 显示/隐藏（唯一权威见 applyPanelVisibility） ──
  function updatePanelVisibility() {
    const kind = currentPanelKind();
    try {
      window.__panelLog = window.__panelLog || [];
      window.__panelLog.push({ f: 'update', kind, t: Date.now() });
      if (window.__panelLog.length > 60) window.__panelLog.shift();
    } catch { /* noop */ }
    applyPanelVisibility(kind);
    const shiQun = kind === 'internal' || kind === 'external' || kind === 'externalGroup' || kind === 'extgroup';
    document.querySelectorAll('.onlyQun').forEach((yuanSu) => {
      yuanSu.classList.toggle('yinCang', !shiQun);
    });
    /**
     * ADR 004 §一.7：容器相关区块**只在「项目」与「我的牛马」**出现 ——
     * 联系人与群聊用不到容器，不显示（不是灰着占位）。
     */
    const showRunEnv = kind === 'single' || kind === 'internal';
    document.querySelectorAll('[data-only="proj-single"]').forEach((yuanSu) => {
      yuanSu.classList.toggle('yinCang', !showRunEnv);
    });
    // 控制台（容器壳）只在「项目 / 我的牛马」出现 —— 与 ADR 004 §一.7 一致
    const shellBtn = $('anNiuRongQiKongZhiTai');
    if (shellBtn) shellBtn.classList.toggle('yinCang', !showRunEnv);
    if (!showRunEnv) $('ctgKongZhiTaiMianBan')?.classList.add('yinCang');
    // 容器项目停止态 ⇒ 开发入口（输入 + 发送）禁用 + 说明（成员侧与"创建者下线"一致）
    void yingYongXiangMuKaiFaMen();
    void refreshContainerConsoleGate();
  }

  // ── 模型管理（会话右侧）──
  let __mgrOpen = new Set();
  function renderModelMgr() {
    const heZi = $('moXingMgr');
    if (!heZi) return;
    const sel = state.selectedChat;
    if (!sel) {
      heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('panel.modelMgrEmpty')) + '</div>';
      return;
    }
    const shiQun = sel.kind === 'internal' || sel.kind === 'extgroup';
    let entries = [];
    if (shiQun) {
      const g = state.groups.find((x) => x.id === sel.id);
      const members = (g && g.members) || [];
      entries = members.map((m) => {
        const mingCheng = typeof m === 'string' ? m : (m && (m.name || m.id)) || '';
        const local = state.instances.find((i) => mingOf(i) === mingCheng || i.id === mingCheng);
        return local
          ? { inst: local, editable: true }
          : { inst: { ming: mingCheng, availableModels: [], chain: [], defaultModel: '' }, editable: false };
      });
    } else {
      const local =
        state.instances.find((i) => i.id === sel.id) ||
        state.instances.find((i) => mingOf(i) === sel.name) ||
        state.instances.find((i) => mingOf(i) === sel.ming);
      // 新窗口可能还没把实例读回来：用会话名做一个稳定替身（头像/名称仍与主界面一致）
      entries = [
        local
          ? { inst: local, editable: true }
          : { inst: { id: sel.id, ming: sel.ming || sel.name, name: sel.name, availableModels: [], chain: [], defaultModel: '' }, editable: false },
      ];
    }
    if (!entries.length) {
      heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('panel.modelMgrEmpty')) + '</div>';
      return;
    }
    heZi.innerHTML = entries
      .map((x, suoYin) => modelMgrCard(x.inst, x.editable, suoYin))
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

  function modelMgrCard(inst, editable, suoYin) {
    const models = inst.availableModels || [];
    const chain = (inst.chain && inst.chain.length) ? inst.chain : models;
    const dis = editable ? '' : ' disabled';
    const daKai = __mgrOpen.has(suoYin) ? ' daKai' : '';
    // 产品定稿：第四列「模型管理」**只显示**可用模型 + 调用链，与牛马管理局一致，其余不放
    return `<details class="mgrKa${editable ? '' : ' zhiDuMianBan'}" data-mgidx="${suoYin}"${daKai}>
      <summary>
        <img class="avTuPian small" src="${escapeHtml(instanceAvatarSrc(inst))}" alt=""/>
        <span class="mgrMing">${escapeHtml(mingOf(inst) || inst.id || '')}</span>
        ${editable ? '' : '<span class="mgrRo">' + escapeHtml(t('panel.modelMgrReadonly')) + '</span>'}
      </summary>
      <div class="mgrTi">
        <label class="mgrLb">${escapeHtml(t('instances.availableModels'))}</label>
        <div class="mgrMoXingJi">${
          models.length
            ? models.map((m) => `<span class="moXingChip">${escapeHtml(m)}${
                editable ? `<button class="x" data-mgdel="${suoYin}" data-m="${escapeHtml(m)}" title="${escapeHtml(t('settings.removeModel'))}">×</button>` : ''
              }</span>`).join('')
            : '<span class="jingYin">' + escapeHtml(t('settings.modelsEmpty')) + '</span>'
        }</div>
        <label class="mgrLb">${escapeHtml(t('instances.fallbackChain'))}</label>
        <ol class="mgrChain">${
          chain.length
            ? chain.map((m, k) => `<li data-chain="${suoYin}" data-k="${k}"${editable ? ' draggable="true"' : ''}>
                <span class="mgrChainMing">${escapeHtml(m)}</span>
                ${editable ? `
                  <button class="anNiuXiao" data-mgup="${suoYin}" data-k="${k}"${k === 0 ? ' disabled' : ''}>↑</button>
                  <button class="anNiuXiao" data-mgdn="${suoYin}" data-k="${k}"${k === chain.length - 1 ? ' disabled' : ''}>↓</button>` : ''}
              </li>`).join('')
            : '<li class="jingYin">—</li>'
        }</ol>
      </div>
    </details>`;
  }

  function bindModelMgr(entries) {
    const heZi = $('moXingMgr');
    if (!heZi) return;
    heZi.querySelectorAll('details.mgrKa').forEach((d) => {
      d.addEventListener('toggle', () => {
        const i = Number(d.dataset.mgidx);
        if (d.daKai) __mgrOpen.add(i);
        else __mgrOpen.delete(i);
      });
    });
    heZi.querySelectorAll('[data-mg="default"]').forEach((selEl) => {
      selEl.onchange = () => {
        const e = entries[Number(selEl.dataset.i)];
        if (!e || !e.editable) return;
        e.inst.defaultModel = selEl.value === '__smart__' ? '' : selEl.value;
        window.__saveState?.();
      };
    });
    heZi.querySelectorAll('[data-mgdel]').forEach((b) => {
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
    const move = (suoYin, k, dir) => {
      const e = entries[suoYin];
      if (!e || !e.editable) return;
      const shuZu = e.inst.chain;
      if (!shuZu) return;
      const t2 = k + dir;
      if (t2 < 0 || t2 >= shuZu.length) return;
      [shuZu[k], shuZu[t2]] = [shuZu[t2], shuZu[k]];
      renderModelMgr();
      window.__saveState?.();
    };
    heZi.querySelectorAll('[data-mgup]').forEach((b) => {
      b.onclick = () => move(Number(b.dataset.mgup), Number(b.dataset.k), -1);
    });
    heZi.querySelectorAll('[data-mgdown]').forEach((b) => {
      b.onclick = () => move(Number(b.dataset.mgdown), Number(b.dataset.k), 1);
    });
    // 拖拽排序
    let dragFrom = null;
    heZi.querySelectorAll('.mgrChain li[draggable="true"]').forEach((li) => {
      li.ondragstart = (e) => {
        dragFrom = { suoYin: Number(li.dataset.chain), k: Number(li.dataset.k) };
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
        const to = { suoYin: Number(li.dataset.chain), k: Number(li.dataset.k) };
        if (dragFrom.suoYin !== to.suoYin || dragFrom.k === to.k) return;
        const e2 = entries[dragFrom.suoYin];
        if (!e2 || !e2.editable || !e2.inst.chain) return;
        const shuZu = e2.inst.chain;
        const [item] = shuZu.splice(dragFrom.k, 1);
        shuZu.splice(to.k, 0, item);
        renderModelMgr();
        window.__saveState?.();
      };
    });
    // 测速：请求供应商的 models 接口，记录耗时
    heZi.querySelectorAll('[data-mgtest]').forEach((b) => {
      b.onclick = async () => {
        const model = b.dataset.m;
        b.disabled = true;
        const biaoQian = b.textContent;
        b.textContent = '…';
        try {
          const p = (state.providers || []).find((x) => (x.models || []).includes(model));
          const qiShiShiJian = performance.now();
          const r = await window.warmy.listModels({ protocol: p && p.protocol, baseURL: p && p.baseURL, apiKey: p && p.apiKey });
          const ms = Math.round(performance.now() - qiShiShiJian);
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
    heZi.querySelectorAll('[data-mgadd]').forEach((b) => {
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
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('model.addTitle');
      const duiHuaTi = $('duiHuaKuangTi');
      const gongYingShangJi = state.providers || [];
      const editProvLabel = t('model.editProvider') || t('settings.providers');
      duiHuaTi.innerHTML = `<div class="field">
          <label>${escapeHtml(t('model.pickProvider'))}</label>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="mpProv" style="flex:1">${gongYingShangJi.map((p, i) => `<option value="${i}">${escapeHtml(p.biaoQian || p.id)}</option>`).join('')}</select>
            <button class="anNiuXiao" id="mpFetch">${escapeHtml(t('model.fetch'))}</button>
            <button class="anNiuXiao" id="mpEditProv" title="${escapeHtml(editProvLabel)}">${escapeHtml(editProvLabel)}</button>
          </div>
        </div>
        <div class="jingYin" style="font-size:12px">${escapeHtml(t('model.fetchHint'))}</div>
        <div class="moXingXuanZeLieBiao" id="mpLieBiao"></div>`;
      const listBox = $('mpLieBiao');
      const renderList = () => {
        const p = gongYingShangJi[Number($('mpProv').value)] || {};
        const yiYou = new Set(inst.availableModels || []);
        const houXuan = (p.models || []).filter((m) => !yiYou.has(m));
        listBox.innerHTML = houXuan.length
          ? houXuan.map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}"/> ${escapeHtml(m)}</label>`).join('')
          : `<div class="jingYin">${escapeHtml(t('model.noneAvailable'))}</div>`;
      };
      renderList();
      if ($('mpProv')) $('mpProv').onchange = renderList;
      $('mpFetch').onclick = async () => {
        const btn = $('mpFetch');
        btn.textContent = t('common.loading');
        const p = gongYingShangJi[Number($('mpProv').value)] || {};
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
        root.classList.add('yinCang');
        resolve(null);
        try {
          setNav('settings');
          const DaoHangAnNiu = document.querySelector('#peiZhiDaoHang button[data-sec="model"]');
          if (DaoHangAnNiu) DaoHangAnNiu.click();
          requestAnimationFrame(() => {
            const ka = document.querySelector('#provLieBiao')?.closest('.sheZhiSection') || $('provLieBiao');
            if (ka && ka.scrollIntoView) ka.scrollIntoView({ kuai: 'start' });
            const suoYin = Number($('mpProv') ? $('mpProv').value : -1);
            const want = gongYingShangJi[suoYin];
            if (want) {
              const rows = document.querySelectorAll('#provLieBiao .prov-row, #provLieBiao > div');
              rows.forEach((yuanSu) => {
                const txt = yuanSu.textContent || '';
                if (txt.includes(want.biaoQian || want.id || '')) yuanSu.classList.add('provFocus');
              });
            }
          });
        } catch { /* noop */ }
      };
      const editBtn = $('mpEditProv');
      if (editBtn) editBtn.onclick = () => { void goEditProviders(); };
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); resolve(null); };
      const editProv = document.createElement('button');
      editProv.className = 'anNiuXiao';
      editProv.textContent = editProvLabel;
      editProv.onclick = () => { void goEditProviders(); };
      const okAdd = document.createElement('button');
      okAdd.className = 'anNiuZhuYao';
      okAdd.textContent = t('model.addSelected');
      okAdd.onclick = () => {
        const picked = Array.from(listBox.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
        root.classList.add('yinCang');
        resolve(picked);
      };
      dongZuoJi.append(editProv, cancel, okAdd);
      root.classList.remove('yinCang');
    });
  }

  // ── 搜索浮窗 ──
  function showSearchPopup() {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('list.search');
    $('duiHuaKuangTi').innerHTML = '<input id="souSuoPopupShuRu" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="' + escapeHtml(t('list.search')) + '"/><div id="souSuoPopupResults" class="jingYin" style="margin-top:8px;max-height:200px;overflow:auto"></div>';
    const dongZuoJi = $('duiHuaKuangDongZuoJi');
    dongZuoJi.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'anNiuXiao';
    close.textContent = t('common.close');
    close.onclick = () => { root.classList.add('yinCang'); };
    dongZuoJi.appendChild(close);
    root.classList.remove('yinCang');
    const shuRu = $('souSuoPopupShuRu');
    shuRu?.focus();
    let jiShiQi = null;
    shuRu?.addEventListener('input', () => {
      clearTimeout(jiShiQi);
      jiShiQi = setTimeout(async () => {
        const q = shuRu.value.trim();
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
    /**
     * **导出分流**（产品定稿）：
     *   · 我的牛马 → 「导出聊天」：只带聊天记录；
     *   · 项目     → 「导出项目」：聊天 + 产出的文件 + 计划进度 + 项目配置，整个打成 `.nm`。
     */
    const shiXiangMu = state.selectedChat && (state.selectedChat.kind === 'internal' || state.selectedChat.kind === 'extgroup');
    const biaoTi = shiXiangMu ? tOr('nm.exportProject', '导出项目') : tOr('nm.exportChat', '导出聊天');
    $('duiHuaKuangBiaoTi').textContent = biaoTi;
    $('duiHuaKuangTi').innerHTML =
      '<div style="margin-bottom:8px">' + escapeHtml(
        shiXiangMu
          ? tOr('nm.exportProjectHint', '将把这个项目打包成一个 .nm 文件：聊天记录、产出的文件、计划进度、项目配置都在里面。')
          : tOr('nm.exportChatHint', '将把这个聊天的记录打包成一个 .nm 文件。')
      ) + '</div>' +
      '<div class="jingYin">' + escapeHtml(t('export.include')) + '</div>';
    const dongZuoJi = $('duiHuaKuangDongZuoJi');
    dongZuoJi.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
    ok.textContent = biaoTi;
    ok.onclick = async () => {
      if (!state.selectedChat) { root.classList.add('yinCang'); return; }
      root.classList.add('yinCang');
      const r = await window.warmy.xiangMuDaoChu?.({
        sessionId: state.selectedChat.id,
        kind: shiXiangMu ? 'project' : 'chat',
      });
      if (r?.ok && r.path) {
        try { await window.warmy.xianShiWenJianJia?.({ path: r.path }); } catch { /* noop */ }
        showToast(tOr('export.done', '已导出') + '：' + r.path);
      } else {
        uiAlert(String((r && r.error) || t('common.error')));
      }
    };
    dongZuoJi.append(cancel, ok);
    root.classList.remove('yinCang');
  }

  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.ceLanTiaoMu').forEach((yuanSu) => {
    yuanSu.onclick = () => setNav(yuanSu.dataset.nav);
  });
  $('lieBiaoSouSuo').addEventListener('input', () => renderList());
  $('anNiuFaSong').addEventListener('click', () => faSong());
  // Esc 清空输入框（误输入时一键还原）
  $('shuRu')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && String($('shuRu').value || '').trim()) {
      e.preventDefault();
      $('shuRu').value = '';
      showToast(tOr('chat.inputCleared', '已清空输入框'));
    }
  });
  $('anNiuTingZhiAll')?.addEventListener('click', () => stopAllAi());
  $('anNiuAttach').addEventListener('click', async () => {
    const r = await window.warmy.pickFile();
    if (r?.ok) {
      const ming = r.path.split(/[\\/]/).pop();
      // 统一用 name（渲染与发送都读它）；ming 留作兼容旧数据 —— 以前只存 ming ⇒ 界面显示 undefined
      state.attachments.push({ name: ming, ming, path: r.path });
      xuanranFujian();
    }
  });
  // 附件拖拽上传：拖到聊天输入区即加入附件列表
  try {
    const shuRuQu = document.querySelector('.shuRuQu') || $('shuRu');
    if (shuRuQu) {
      shuRuQu.addEventListener('dragover', (e) => { e.preventDefault(); shuRuQu.classList.add('dropping'); });
      shuRuQu.addEventListener('dragleave', () => shuRuQu.classList.remove('dropping'));
      shuRuQu.addEventListener('drop', (e) => {
        e.preventDefault();
        shuRuQu.classList.remove('dropping');
        const fjs = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        for (const f of fjs) {
          const p = f.path || (f.name ? String(f.name) : '');
          if (!p) continue;
          const ming = p.split(/[\\/]/).pop() || f.name;
          state.attachments.push({ name: ming, ming, path: p, bytes: Number(f.size) || 0 });
        }
        xuanranFujian();
      });
    }
  } catch { /* noop */ }

  bindResizer($('lanTiaoZhengTiao'), '--list-w', 200, 420, { persistKey: 'listWidth', resetWidth: 220 });
  // R3：聊天区 ↔ 右栏 —— 右栏在右边（dir:'you'），左侧聊天区保底 320px，宽度走 settings 里的 panelWidth
  bindResizer($('mianBanTiaoZhengTiao'), '--panel-w', 220, 480, {
    dir: 'you',
    hostId: 'liaoTianBuJu',
    minOther: 320,
    persistKey: 'panelWidth',
    resetWidth: 300,
  });

  async function refreshCost() {
    const heZi = $('cost-box');
    if (!heZi) return;
    const c = await window.warmy.costSummary().catch(() => null);
    if (c?.ok) {
      // 产品要求：**只算词元，不算钱**（金额一律不显示）
      heZi.textContent = (c.promptTokens || 0) + ' in / ' + (c.completionTokens || 0) + ' out · cache ' + ((c.cacheHitRate || 0) * 100).toFixed(1) + '%';
    }
  }
  

  async function refreshMetrics() {
    const heZi = $('zhiBiaoJiHe');
    if (!heZi) return;
    try {
      const m = await window.warmy.metricsSummary();
      if (!m?.ok) return;
      heZi.textContent = `turns=${m.turns} · cache=${((m.cacheHitRate || 0) * 100).toFixed(1)}% · ccr=${((m.ccrRatio || 1) * 100).toFixed(0)}% · avg=${m.avgDurationMs}ms`
        + ` · tokens=${(m.promptTokens || 0) + (m.completionTokens || 0)}`;
    } catch {
      /* noop */
    }
  }

  /** 成本明细：按会话 / 按模型聚合，可导出 CSV */
  async function renderCostDash() {
    const heZi = $('chengBenDash');
    if (!heZi) return;
    const r = await window.warmy.metricsTurns().catch(() => null);
    const turns = (r && r.turns) || [];
    if (!turns.length) {
      heZi.innerHTML = '<div class="jingYin">' + escapeHtml(t('cost.empty')) + '</div>';
      return;
    }
    const agg = (key) => {
      const m = new Map();
      turns.forEach((x) => {
        const k = x[key] || '—';
        const cur = m.get(k) || { turns: 0, tokens: 0 };
        cur.turns += 1;
        cur.tokens += (x.promptTokens || 0) + (x.completionTokens || 0);
        m.set(k, cur);
      });
      // 产品要求：只按**词元消耗**降序（不算钱）
      return [...m.entries()].sort((p, q2) => q2[1].tokens - p[1].tokens);
    };
    const table = (rows, firstCol) => {
      const touBu =
        '<tr><th>' + firstCol + '</th><th>' + escapeHtml(t('cost.turns')) + '</th><th>' + escapeHtml(t('cost.tokens')) + '</th></tr>';
      const ti = rows
        .slice(0, 8)
        .map(
          ([k, v]) =>
            '<tr><td>' + escapeHtml(String(k).slice(0, 18)) + '</td><td>' + v.turns + '</td><td>' + v.tokens +
            '</td></tr>'
        )
        .join('');
      return '<table class="chengBenTable">' + touBu + ti + '</table>';
    };
    heZi.innerHTML =
      '<div class="chengBenFu">' + escapeHtml(t('cost.bySession')) + '</div>' + table(agg('sessionId'), t('cost.session')) +
      '<div class="chengBenFu">' + escapeHtml(t('cost.byModel')) + '</div>' + table(agg('model'), t('cost.model'));

    const btn = $('anNiuChengBenCsv');
    if (btn) {
      btn.onclick = async () => {
        const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
        const HangJi = ['dimension,key,turns,tokens'];
        for (const [biaoQian, key] of [['session', 'sessionId'], ['model', 'model']]) {
          agg(key).forEach(([k, v]) => HangJi.push([biaoQian, esc(k), v.turns, v.tokens].join(',')));
        }
        const yunXingJieGuo = await window.warmy.saveText({
          defaultName: 'warmy-cost.csv',
          content: HangJi.join('\n'),
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (yunXingJieGuo && yunXingJieGuo.ok) uiAlert(t('instances.saved'));
        else if (yunXingJieGuo && yunXingJieGuo.error) uiAlert(String(yunXingJieGuo.error));
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
    const heZi = $('cpXiangQingLieBiao') || $('cpLieBiao');
    const space = $('cpSpace');
    if (!heZi) return;
    // ADR 004 §7.6：回退点 = **文件 + 环境指纹**（环境那一维由容器镜像/快照承担）
    const r = await window.warmy.checkpointList({ sessionId: state.selectedChat ? state.selectedChat.id : '' });
    const LieBiao = r?.LieBiao || [];
    const envByCp = (r && r.envByCheckpoint) || {};
    const maxMb = 50;
    const usedMb = Math.min(maxMb, LieBiao.length * 0.5);
    if (space) {
      space.textContent = `${escapeHtml(t('checkpoints.used'))} ${usedMb.toFixed(1)}MB / ${escapeHtml(t('checkpoints.max'))} ${maxMb}MB`;
    }
    if (!LieBiao.length) {
      heZi.innerHTML = `<div class="jingYin">${escapeHtml(t('checkpoints.empty'))}</div>`;
      return;
    }
    const now = Date.now();
    heZi.innerHTML = LieBiao
      .slice(0, 12)
      .map((c) => {
        const d = new Date(c.createdAt);
        const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const faShengShiJian = now - c.createdAt < 86400000 ? hm : d.toLocaleString();
        const envRec = (envByCp || {})[String(c.id)] || null;
        const cur = (r && r.currentEnv) || { jiHuo: false, runtimeId: '', revision: 'host' };
        const rtName = (id) => (id ? t('container.rt.' + id + '.name') : t('container.current.none'));
        const envLine = envRec
          ? fmtKey('checkpoints.env.recorded', { runtime: rtName(envRec.runtimeId), revision: String(envRec.revision || '') })
          : t('checkpoints.env.none');
        const envDiff = envRec && String(envRec.revision || '') !== String(cur.revision || '')
          ? '<div class="ctgDim cp-env-changed" data-env-changed="1">' +
            escapeHtml(fmtKey('checkpoints.env.changed', { was: String(envRec.revision || ''), now: String(cur.revision || '') })) + '</div>'
          : '<div class="ctgDim" data-env-changed="0">' + escapeHtml(t('checkpoints.env.same')) + '</div>';
        return `<details class="cpTiaoMu" data-id="${escapeHtml(String(c.id))}" data-env-revision="${escapeHtml(String((envRec && envRec.revision) || ''))}">
          <summary>${escapeHtml(String(faShengShiJian))} · ${escapeHtml(String(c.phase || ''))} · ${escapeHtml(String(c.strategy || ''))}</summary>
          <div class="cpTi">
            <div>${escapeHtml(t('checkpoints.tasks'))}: ${escapeHtml(c.phase || '')}</div>
            <div class="ctgDim">${escapeHtml(t('checkpoints.env.biaoTi'))}</div>
            <div class="ctgDim" data-env-line="1">${escapeHtml(envLine)}</div>
            <div class="ctgDim">${escapeHtml(fmtKey('checkpoints.env.current', { runtime: rtName(cur.runtimeId), revision: String(cur.revision || '') }))}</div>
            ${envDiff}
            <div class="ctgDim">${escapeHtml(t('checkpoints.env.layered'))}</div>
            <ul>
              <li>${escapeHtml(t('checkpoints.changed'))}: ${escapeHtml((c.filesChanged || []).map((f) => f.path).join(', ') || '—')}</li>
              <li>${escapeHtml(t('checkpoints.created'))}: ${escapeHtml((c.filesCreated || []).map((f) => f.path).join(', ') || c.dir)}</li>
              <li>${escapeHtml(t('checkpoints.irreversible'))}: ${escapeHtml((c.irreversible || []).join(', ') || '—')}</li>
              <li>${escapeHtml(t('checkpoints.assets'))}: ${escapeHtml((c.assets || []).join(', ') || '—')}</li>
            </ul>
          </div>
          <div class="cpDongZuoJi">
            <button class="anNiuXiao" data-load="${c.id}">${escapeHtml(t('checkpoints.stopAndLoad'))}</button>
          </div>
        </details>`;
      })
      .join('');
    heZi.querySelectorAll('[data-load]').forEach((b) => {
      b.onclick = async () => {
        const ok = await uiConfirm(t('checkpoints.confirmBody'), t('checkpoints.confirmTitle'));
        if (!ok) return;
        const rb = await window.warmy.checkpointRollback(b.dataset.load, { sessionId: state.selectedChat ? state.selectedChat.id : '' });
        // 文件回退成功 ≠ 环境也回退了：环境变了就**如实说**（这正是"环境指纹"这条增益的用处）
        if (rb && rb.env && rb.env.changed) {
          await uiAlert(fmtKey('checkpoints.env.changed', {
            was: String((rb.env.jilu && rb.env.jilu.revision) || ''),
            now: String((rb.env.current && rb.env.current.revision) || ''),
          }), t('checkpoints.biaoTi'));
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
  $('anNiuCpLieBiao')?.addEventListener('click', refreshCheckpoints);
  async function refreshSessionBoard() {
    const heZi = $('board-sess-box');
    if (!heZi || !state.selectedChat) return;
    const r = await window.warmy.boardSession(state.selectedChat.id).catch(() => null);
    const RenwuJi = r?.RenwuJi || [];
    heZi.innerHTML = RenwuJi.length
      ? RenwuJi.map((t) => '<div>' + escapeHtml(t.title) + ' · ' + clampPercent(t.jinDu) + '% · ' + escapeHtml(String(t.status || '')) + '</div>').join('')
      : '—';
  }
  /**
   * 数据卡片指标（**不是**卡顿自检）：把当前状态里的副本数、保留天数与字节估算
   * 渲染进 #peiZhiDataZhiBiaoJi 的三个格子；数字先过 fmtDisp，渲染成
   * `[object Object]` 的一律显示占位符「—」。由 bindDataMetricsOnly() 在设置页调用。
   * ⚠️ 这里既不测主进程 CPU/事件循环延迟，也不测渲染进程帧率 —— 那是**已退休**的
   * 卡顿自检（入口与采样逻辑整块移除），旧注释是历史残留。
   */
  function renderDataMetrics() {
    const heZi = $('peiZhiDataZhiBiaoJi');
    if (!heZi) return;
    const replicas = (state.groups || []).length || 0;
    const retentionDays = 30;
    const byteSample = 1024 * (state.instances || []).length;
    const ge = (k, v) => '<div class="diagCell"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(fmtDisp(v)) + '</div></div>';
    heZi.innerHTML =
      ge(t('settings.dataReplicas'), replicas) +
      ge(t('settings.dataRetention'), retentionDays) +
      ge(t('settings.dataBytes'), byteSample);
    heZi.querySelectorAll('.v').forEach((yuanSu) => {
      if (yuanSu.textContent.indexOf('[object Object]') !== -1) yuanSu.textContent = '—';
    });
  }

  /** 数据卡片指标（保留）。卡顿自检入口与采样逻辑已整块移除。 */
  function bindDataMetricsOnly() {
    renderDataMetrics();
  }

  function bindSkillScanDirs() {
    const tianJiaAnNiu = $('anNiuJinengSaoMiaoTianJia');
    const input = $('jinengSaoMiaoMuLuShuRu');
    const xiaoXi = $('jinengSaoMiaoXiaoXi');
    if (!tianJiaAnNiu || tianJiaAnNiu.dataset.bound === '1') return;
    tianJiaAnNiu.dataset.bound = '1';
    tianJiaAnNiu.onclick = async () => {
      const v = String((input && input.value) || '').trim();
      if (!v) {
        if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanInvalid');
        return;
      }
      const cur = await skillScanDirsGet();
      const dirs = ((cur && cur.dirs) || []).slice();
      const editRaw = input && input.getAttribute('data-edit-i');
      const editing = editRaw !== null && editRaw !== undefined && editRaw !== '';
      const MAX = 10;
      if (!editing && dirs.length >= MAX) {
        if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      if (editing) {
        const i = Number(editRaw);
        if (Number.isInteger(i) && i >= 0 && i < dirs.length) dirs[i] = v;
        else if (dirs.length < MAX) dirs.push(v);
        else {
          if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanMax');
          return;
        }
      } else {
        if (dirs.indexOf(v) >= 0) {
          if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanInvalid');
          return;
        }
        dirs.push(v);
      }
      if (dirs.length > MAX) {
        if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      const yunXingJieGuo = await skillScanDirsSet(dirs);
      if (yunXingJieGuo && yunXingJieGuo.ok === false) {
        if (xiaoXi) xiaoXi.textContent = t('settings.skillsScanMax');
        void uiAlert(t('settings.skillsScanMax'), t('settings.skillsScanTitle'));
        return;
      }
      if (input) {
        input.value = '';
        input.removeAttribute('data-edit-i');
      }
      tianJiaAnNiu.textContent = t('settings.skillsScanAdd');
      await renderSkillScanDirs();
      await renderSkillList();
      const st = (window.__skillScanState && window.__skillScanState.scanDirs) || [];
      const huai = st.filter((s) => s && s.ok === false);
      if (xiaoXi) {
        xiaoXi.textContent = huai.length
          ? t('settings.skillsScanMissing') + ': ' + huai.map((s) => s.path).join(' · ')
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
    const heZi = $('jinengLieBiao');
    if (!heZi) return;
    // 无论是否已安装 skill，设置→功能 里始终展示管理面板
    heZi.className = '';
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
    let items = [];
    let scanDirs = [];
    try {
      const pr = await window.warmy.skillsPaths?.().catch(() => null);
      const r0 = await window.warmy.skillsList().catch(() => null);
      scanDirs = (r0 && r0.scanDirs) || (pr && pr.scanDirs) || [];
      items = (r0 && r0.jinengJi) || [];
      const huai = scanDirs.filter((s) => s && s.ok === false);
      const pb = $('jinengLuJingJi');
      if (pb) {
        let txt = escapeHtml(t('settings.skillsPaths')) + ': ' + ((pr && pr.paths) || []).join('  ·  ');
        if (huai.length) txt += '  ·  ' + escapeHtml(t('settings.skillsScanMissing')) + ': ' + huai.map((s) => s.path).join(' · ');
        const max = (r0 && r0.maxScanDirs) || 10;
        txt += '  ·  ' + escapeHtml(t('settings.skillsScanTitle')) + ` (${scanDirs.length}/${max})`;
        pb.textContent = txt;
      }
    } catch { /* keep going */ }

    window.__skillsState = { items: items.slice(), scanDirs };

    const touBu = '<div class="jinengLieBiaoHead">' + escapeHtml(t('settings.skillsDiscoveredTitle')) +
      ' <span class="jingYin">(' + items.length + ')</span></div>';

    if (!items.length) {
      heZi.innerHTML = touBu +
        '<div class="jingYin">' + escapeHtml(t('settings.skillsEmpty')) + '</div>' +
        '<div class="jingYin">' + escapeHtml(t('settings.skillsHint')) + '</div>';
      return;
    }

    heZi.innerHTML =
      touBu +
      items
        .map((s) => {
          const discovered = s && s.source === 'discovered';
          const enabled = s && s.enabled !== false;
          const removable = s && s.removable !== false && !discovered;
          const id = escapeHtml(s.id || '');
          return (
            '<div class="jinengHang' + (discovered ? ' isDiscovered' : '') + '" data-skill-id="' + id + '" data-skill-source="' + escapeHtml((s && s.source) || '') + '">' +
            '<div class="jinengZhu">' +
            '<div class="jinengMing">' + escapeHtml(s.name || s.id) +
            ' <span class="jinengZhuangTai ' + (enabled ? 'isQiYong' : 'isOff') + '">' + escapeHtml(enabled ? t('settings.skillEnabled') : t('settings.skillPaused')) + '</span></div>' +
            '<div class="jingYin jinengMiaoShu">' + escapeHtml(s.description || '—') + '</div>' +
            '<div class="jingYin jinengSrc">' + escapeHtml(t('settings.skillFrom')) + ': ' + escapeHtml(skillSourceLabel(s)) +
            (discovered ? ' · ' + escapeHtml(t('settings.skillSourceDiscovered')) : '') + '</div>' +
            '</div>' +
            '<div class="jinengDongZuoJi">' +
            '<button class="anNiuXiao" data-skill-toggle="' + id + '" data-enabled="' + (enabled ? '1' : '0') + '">' +
            escapeHtml(enabled ? t('settings.skillsPause') : t('settings.skillsEnable')) + '</button>' +
            (removable
              ? '<button class="anNiuDanger" data-skill-del="' + id + '">' + escapeHtml(t('settings.skillRemove')) + '</button>'
              : '<button class="anNiuDanger" disabled title="' + escapeHtml(t('settings.skillDeleteLocked')) + '">' + escapeHtml(t('settings.skillRemove')) + '</button>') +
            '</div>' +
            '</div>'
          );
        })
        .join('');

    heZi.querySelectorAll('[data-skill-toggle]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.skillToggle;
        const nowOn = b.dataset.enabled === '1';
        const r = await window.warmy.skillsSetEnabled?.({ id, enabled: !nowOn }).catch(() => null);
        if (r && r.ok === false) uiAlert(String(r.error || ''));
        renderSkillList();
      };
    });
    heZi.querySelectorAll('[data-skill-del]').forEach((b) => {
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
    const heZi = $('chengYuanJiHe');
    if (!state.selectedChat) return;
    const r = await window.warmy.groupMembers(state.selectedChat.id).catch(() => null);
    const ms = (r && r.members) || [];
    /* 成员表**回填进 state.groups**：
       群记录（group-store 的 GroupRecord / warmy:qunLieBiao）里**没有**成员形状，
       而「模型管理」面板与列表行的成员数都读 `g.members` —— 不回填的话这两个地方会
       恒显示"暂无可管理的牛马 / 0 名成员"，明明群里有成员（实测：无组网巡检第 19 节）。
       只在真的变了的时候才重渲染，避免每 15s 的定时刷新把用户正在编辑的卡片刷掉。 */
    const group = (state.groups || []).find((x) => x.id === state.selectedChat.id);
    if (group) {
      const next = ms.map((x) => ({ id: x.id || x.name, ming: x.name }));
      if (JSON.stringify(group.members || []) !== JSON.stringify(next)) {
        group.members = next;
        renderModelMgr();
        renderList();
      }
    }
    if (!heZi) return;
    // R11 三态：在线正常 / 异地离线（灰 + 离线角标）/ 组网关闭（异地成员灰 + 异常角标）
    // R12：停用实例灰 + 名字删除线（灰色仍满足对比度 ≥ 3.0，见 --ink-dim）
    heZi.innerHTML = ms.length
      ? ms
          .map((x) => {
            const v = memberVisual(state.selectedChat.id, x);
            const huiZhang =
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
                ? ' isJinYong'
                : v.kind === 'meshOff'
                  ? ' isWangZhuangOff'
                  : v.kind === 'offline'
                    ? ' isOffline'
                    : '';
            return (
              '<div class="chengYuanHang' + cls + '" data-mid="' + escapeHtml(String(x.id || x.name)) + '" data-state="' + v.kind + '"' +
              ' data-presence-basis="' + escapeHtml(v.basis || '') + '"' +
              (v.zhiWen ? ' data-fp="' + escapeHtml(v.zhiWen) + '"' : '') +
              (v.remote && v.basis === 'unattributed'
                ? ' data-presence-unknown="1" title="' + escapeHtml(t('group.memberPresenceUnknown')) + '"'
                : '') +
              '>' +
              '<span class="chengYuanMing' + (v.kind === 'disabled' ? ' struck' : '') + '">' +
              escapeHtml(x.name) + ' · ' + escapeHtml(String(x.role || '')) +
              '</span>' +
              (v.remote && v.basis === 'unattributed'
                ? '<span class="chengYuanHuiZhang" data-state="unattributed">' + escapeHtml(t('group.memberUnattributed')) + '</span>'
                : '') +
              (v.remote ? '<span class="chengYuanHuiZhang remote" data-state="remote">' + escapeHtml(t('group.memberRemote')) + '</span>' : '') +
              (huiZhang ? '<span class="chengYuanHuiZhang" data-state="' + huiZhang.state + '"' + (huiZhang.hintKey ? ' title="' + escapeHtml(t(huiZhang.hintKey)) + '"' : '') + '>' + escapeHtml(t(huiZhang.key)) + '</span>' : '') +
              (v.kind === 'offline'
                ? '<div class="chengYuanTiShi jingYin">' + escapeHtml(t('group.memberPendingConfirm')) + ' · ' + escapeHtml(t('group.memberPendingConfirmHint')) + '</div>'
                : '') +
              '<button class="anNiuXiao" data-mkick="' + escapeHtml(String(x.id || x.name)) + '">' + escapeHtml(t('group.kick')) + '</button>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="jingYin">' + escapeHtml(t('group.memberEmpty')) + '</div>';
    heZi.querySelectorAll('[data-mkick]').forEach((b) => {
      b.onclick = async () => {
        await window.warmy.groupKick({ groupId: state.selectedChat.id, memberId: b.dataset.mkick });
        refreshMembers();
      };
    });
    // 可选牛马下拉（排除已在群里的）
    const pick = $('chengYuanXuanZe');
    if (pick) {
      const inGroup = new Set(ms.map((x) => x.name));
      const houXuan = (state.instances || []).filter((i) => !inGroup.has(i.name));
      pick.innerHTML = houXuan.length
        ? houXuan.map((i) => '<option value="' + escapeHtml(i.id) + '">' + escapeHtml(i.name) + '</option>').join('')
        : '<option value="">' + escapeHtml(t('group.memberEmpty')) + '</option>';
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
    let host = $('chengYuanMingCeZhengShu');
    if (!host) {
      const heZi = $('chengYuanJiHe');
      if (!heZi || !heZi.parentElement) return;
      host = document.createElement('div');
      host.id = 'chengYuanMingCeZhengShu';
      host.className = 'sheZhiKa chengYuanMingCeZhengShu';
      heZi.parentElement.appendChild(host);
    }
    if (!groupId) {
      host.innerHTML = '<h3>' + escapeHtml(t('group.cert.biaoTi')) + '</h3><div class="jingYin">' + escapeHtml(t('group.cert.unavailable')) + '</div>';
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
      const ming = String(m.name || '');
      const bao = netState.presence[groupId] || {};
      const p = bao[ming] || bao[String(m.id || ming)] || {};
      const LieBiao = (byName[ming] || []).slice();
      if (!LieBiao.length && p.fp) {
        certs.forEach((c) => { if (c.memberFingerprint === p.fp) LieBiao.push(c); });
      }
      const zuiJia = LieBiao.slice().sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0))[0] || null;
      const fp = (zuiJia && zuiJia.memberFingerprint) || p.fp || '';
      const status = zuiJia ? t(certStatusKey(zuiJia.code, zuiJia.valid)) : t('group.cert.none');
      const rotated = !!(zuiJia && zuiJia.supersedes);
      return (
        '<div class="zhengShuHang" data-member="' + escapeHtml(ming) + '">' +
        '<div class="cert-name">' + escapeHtml(ming) + '</div>' +
        '<div class="zhengShuFp" title="' + escapeHtml(fp || t('group.cert.showFull')) + '" data-fp-full="' + escapeHtml(fp) + '">' + escapeHtml(shortFp(fp)) + '</div>' +
        '<div class="zhengShuZhuangTai" data-code="' + escapeHtml((zuiJia && zuiJia.code) || 'none') + '">' + escapeHtml(status) + '</div>' +
        (rotated ? '<div class="zhengShuRotated">' + escapeHtml(t('group.cert.rotated')) + ' · ' + escapeHtml(t('group.cert.generation')) + ' ' + LieBiao.length + '</div>' : '') +
        '</div>'
      );
    }).join('');
    host.innerHTML =
      '<h3>' + escapeHtml(t('group.cert.biaoTi')) + '</h3>' +
      '<p class="jingYin">' + escapeHtml(t('group.cert.readonlyHint')) + '</p>' +
      (rows || '<div class="jingYin">' + escapeHtml(t(group ? 'group.cert.emptyGroup' : 'group.cert.unavailable')) + '</div>') +
      (certs.length
        ? '<div class="jingYin zhengShuFullLieBiao">' + certs.map((c) =>
            '<div>' + escapeHtml(c.displayName || '—') + ' · ' + escapeHtml(String(c.memberFingerprint || '')) + ' · ' + escapeHtml(t(certStatusKey(c.code, c.valid))) + '</div>'
          ).join('') + '</div>'
        : '');
  }
  $('anNiuChengYuanTianJia')?.addEventListener('click', async () => {
    const pick = $('chengYuanXuanZe');
    if (!pick || !state.selectedChat) return;
    const instId = pick.value;
    if (!instId) return;
    const inst = (state.instances || []).find((i) => i.id === instId);
    // R10：添加异地成员前先检查组网开关；没开就问一句是否进设置打开
    if (instanceIsRemote(inst) && !netState.enabled) {
      const go = await uiConfirm(fmtKey('net.addRemoteBody', { ming: (inst && inst.name) || instId }), t('net.addRemoteTitle'));
      if (go) gotoNetSettings();
      return;
    }
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
      const qiShiYuYan = state.yuYan || 'zh-CN';
      $('duiHuaKuangBiaoTi').textContent = tOr('setup.biaoTi', tOr('settings.language', '欢迎使用'));
      $('duiHuaKuangTi').innerHTML =
        '<div class="jingYin" style="margin-bottom:8px">' + escapeHtml(tOr('setup.pickLanguage', '请选择界面语言（可稍后在设置中修改）')) + '</div>' +
        '<div class="field"><label>' + escapeHtml(tOr('setup.yuYan', '语言')) + '</label>' +
        '<select id="chuShiSheZhiYuYan">' + localeOptionsHtml(qiShiYuYan) + '</select></div>';
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const QueDingAnNiu = document.createElement('button');
      QueDingAnNiu.className = 'anNiuZhuYao';
      QueDingAnNiu.textContent = tOr('setup.start', '开始使用');
      const sel = () => $('chuShiSheZhiYuYan');
      QueDingAnNiu.onclick = () => {
        const v = sel() ? sel().value : 'zh-CN';
        root.classList.add('yinCang');
        resolve(v);
      };
      // live preview when user changes language in the picker
      if (sel()) {
        sel().onchange = async () => {
          const v = sel().value;
          // 即时预览也要上锁：引导确认前的这段等待里，5s 轮询会把设置文件里的旧语言拉回来
          baoHuYuYan(60000, v);
          try { await loadI18n(resolveLocalePack(v)); } catch { /* noop */ }
          $('duiHuaKuangBiaoTi').textContent = tOr('setup.biaoTi', '欢迎使用');
          const tiShi = $('duiHuaKuangTi').querySelector('.jingYin');
          if (tiShi) tiShi.textContent = tOr('setup.pickLanguage', '请选择界面语言（可稍后在设置中修改）');
          const lab = $('duiHuaKuangTi').querySelector('label');
          if (lab) lab.textContent = tOr('setup.yuYan', '语言');
          QueDingAnNiu.textContent = tOr('setup.start', '开始使用');
        };
      }
      dongZuoJi.append(QueDingAnNiu);
      root.classList.remove('yinCang');
    });
  }

  function showPrivacyPolicyModal() {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('privacy.biaoTi');
      $('duiHuaKuangTi').innerHTML =
        '<div class="yinSiShiTu" id="yinSiDuiHuaKuangTi" style="max-height:300px">' + privacyHtml(t('privacy.ti')) + '</div>' +
        '<div class="jingYin" id="yinSiTiShi" style="margin-top:8px">' + escapeHtml(t('privacy.scrollHint')) + ' · ' + escapeHtml(t('privacy.waitHint')) + '</div>';
      const dongZuoJi = $('duiHuaKuangDongZuoJi');
      dongZuoJi.innerHTML = '';
      const no = document.createElement('button');
      no.className = 'anNiuXiao';
      no.textContent = t('privacy.disagree');
      no.onclick = async () => {
        root.classList.add('yinCang');
        await window.warmy.privacyConsentSet?.(false).catch(() => {});
        await window.warmy.appQuit?.('privacy-disagree').catch(() => {});
        resolve(false);
      };
      const yes = document.createElement('button');
      yes.className = 'anNiuZhuYao';
      yes.textContent = t('privacy.agree');
      yes.disabled = true;
      let scrolledEnd = false;
      let openedAt = Date.now();
      const heZi = () => $('yinSiDuiHuaKuangTi');
      const tongBu = () => {
        const yuanSu = heZi();
        if (yuanSu) {
          const atEnd = yuanSu.scrollTop + yuanSu.clientHeight >= yuanSu.scrollHeight - 4;
          if (atEnd) scrolledEnd = true;
        }
        const longEnough = Date.now() - openedAt >= 3000;
        yes.disabled = !(scrolledEnd && longEnough);
        yes.style.opacity = yes.disabled ? '0.5' : '1';
      };
      heZi()?.addEventListener('scroll', tongBu);
      const jiShiQi = setInterval(tongBu, 200);
      yes.onclick = async () => {
        clearInterval(jiShiQi);
        root.classList.add('yinCang');
        await window.warmy.privacyConsentSet?.(true).catch(() => {});
        resolve(true);
      };
      dongZuoJi.append(no, yes);
      root.classList.remove('yinCang');
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
      baoHuYuYan(60000, pick);
      await window.warmy.setupComplete({ yuYan: pick }).catch(() => {});
      // 无论 live-preview 是否已切过，确认时都强制再载一次，保证 UI 与选项一致
      try { await loadI18n(resolveLocalePack(pick)); } catch { /* noop */ }
      await window.warmy.settingsSave({ yuYan: pick }).catch(() => {});
      /**
       * **落盘回读校验**（本轮教训）：用户报"几分钟后又跳回中文"，探针证明落盘成功时不会回退 ——
       * 说明真实场景里出现过"写没成功"。这里写完回读一次，没跟上就再写一次；
       * 仍没跟上也**不改界面**（待确认仍在），只是如实记进启动日志便于追责。
       */
      try {
        const huiDu = await window.warmy.settingsGet?.();
        const cunDe = resolveLocalePack(huiDu?.settings?.yuYan || '');
        if (cunDe !== resolveLocalePack(pick)) {
          await window.warmy.settingsSave({ yuYan: pick }).catch(() => {});
          const zaiDu = await window.warmy.settingsGet?.();
          if (resolveLocalePack(zaiDu?.settings?.yuYan || '') !== resolveLocalePack(pick)) {
            console.warn('[yuYan] 落盘未跟上用户选择', { pick, disk: zaiDu?.settings?.yuYan });
          }
        }
      } catch { /* 回读失败不影响本次界面 */ }
    } else {
      await window.warmy.setupComplete({}).catch(() => {});
    }
    await showPrivacyPolicyModal();
    // 首次：引导添加供应商 → 创建牛马 → 说明怎么开始用
    try { await showOnboardingGuide(); } catch { /* noop */ }
  }
  // 安装/首启语言选择：必须等 i18n 加载完成后再弹（否则界面是键名）
  window.__maybeShowSetup = maybeShowSetup;

  /**
   * 首启引导（产品定稿）：
   *  1) 添加模型供应商（可跳过）
   *  2) 去牛马管理局创建牛马（若已有供应商则引导设默认模型与调用链）
   *  3) 说明：聊天框可开始干活；左侧项目/联系人/群聊各是什么
   */
  /**
   * 首启引导（逐步真实完成，可随时跳过）：
   *  ① 添加模型供应商 —— 等到 settings 里真有供应商（且非仅默认空密钥）或用户跳过
   *  ② 创建牛马 —— 等到 instances.length > 0 或用户跳过
   *  ③ 开始使用 —— 说明聊天框与左侧入口
   * 点「去操作」只跳转并**等待**，不自动进入下一步。
   */
  /**
   * 首启引导（页内高亮条，非阻塞弹窗）：
   *  - 底部固定一条「引导条」：当前步骤文案 + 去做 / 跳过
   *  - 目标元素描边高亮，指引用户去点
   *  - 条件真正达成后自动进入下一步；可随时跳过
   */
  /**
   * 首启引导（按 NN/g「pull revelation」+ app-onboarding-questionnaire 技能原则重做）：
   *  - **非阻塞**：页内引导条，不遮聊天，不打断操作
   *  - **必须真做**：每步引导用户去点，条件达成才进下一步
   *  - **可跳过、可重调**：跳过即退出；设置 → 关于 里有「重新查看引导」
   *  - **进度可见**：第 n/N 步
   *  - **收益导向**：文案说「你能得到什么」，不说功能清单
   *  - **不要求记忆**：帮助贴在当下这一步旁边
   */
  let yinDaoBu = 0;           // 当前步序号
  let yinDaoSteps = [];       // 本次引导的步骤（语言切换后可重画）
  let yinDaoDone = false;

  function yinDaoHide() {
    const bar = $('yinDaoTiao');
    if (bar) bar.remove();
    document.querySelectorAll('.yinDaoGaoLiang').forEach((n) => n.classList.remove('yinDaoGaoLiang'));
  }

  function yinDaoHighlight(sel) {
    document.querySelectorAll('.yinDaoGaoLiang').forEach((n) => n.classList.remove('yinDaoGaoLiang'));
    if (!sel) return null;
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (el) {
      el.classList.add('yinDaoGaoLiang');
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ }
    }
    return el;
  }

  /** 画当前步（语言切换后可重画，不重置进度） */
  /**
   * 引导文案里的**真实图标**（与左侧导航/列表头同一套图形，不是另画的近似物）。
   * 文案里用 `{icon:settings}` / `{icon:niuMa}` / `{icon:guanLiJu}` 占位，
   * 语言包里保持纯文本（可翻译），图标由渲染时替换进去。
   * ⚠️ settings 那个齿轮的 mask id 必须与 index.html 里的 `h2` 错开（重复 id 会互相串）。
   */
  const YIN_DAO_TU_BIAO = {
    settings: '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><mask id="yd-h2"><rect width="100" height="100" fill="white"/><polygon points="50,32 66,42 66,58 50,68 34,58 34,42" fill="black"/></mask></defs><g fill="currentColor" mask="url(#yd-h2)"><circle cx="50" cy="50" r="30"/><g stroke="currentColor" stroke-width="14"><line x1="50" y1="20" x2="50" y2="6"/><line x1="50" y1="80" x2="50" y2="94"/><line x1="20" y1="50" x2="6" y2="50"/><line x1="80" y1="50" x2="94" y2="50"/><line x1="29" y1="29" x2="19" y2="19"/><line x1="71" y1="71" x2="81" y2="81"/><line x1="71" y1="29" x2="81" y2="19"/><line x1="29" y1="71" x2="19" y2="81"/></g></g></svg>',
    niuMa: '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="34" r="12"/><path d="M14,78 C14,60 24,54 34,54 C40,54 45,56 49,60"/><rect x="58" y="26" width="24" height="24" rx="4"/><circle cx="70" cy="38" r="3" fill="currentColor"/><line x1="70" y1="26" x2="70" y2="18"/><circle cx="70" cy="16" r="3" fill="currentColor"/></g></svg>',
    guanLiJu: '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>',
  };
  /** 先转义文案（防注入），再把 `{icon:xxx}` 换成我们自己的图标（只认这三个 key） */
  function yinDaoWenAnHtml(wen) {
    return escapeHtml(wen || '').replace(/\{icon:(settings|niuMa|guanLiJu)\}/g, (_m, k) =>
      '<span class="yinDaoTuBiao" aria-hidden="true">' + YIN_DAO_TU_BIAO[k] + '</span>');
  }
  function yinDaoRender() {
    if (yinDaoDone || !yinDaoSteps.length) return;
    const step = yinDaoSteps[yinDaoBu];
    if (!step) return;
    let bar = $('yinDaoTiao');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'yinDaoTiao';
      bar.className = 'yinDaoTiao';
      document.body.appendChild(bar);
    }
    const total = yinDaoSteps.length;
    bar.innerHTML =
      '<div class="yinDaoHead">' +
        '<span class="yinDaoJiDu">' + escapeHtml(tOr('guide.progress', '第 {n}/{total} 步').replace('{n}', String(yinDaoBu + 1)).replace('{total}', String(total))) + '</span>' +
        '<button type="button" class="yinDaoClose" data-yd="skip" title="' + escapeHtml(tOr('guide.skip', '跳过')) + '">×</button>' +
      '</div>' +
      '<div class="yinDaoTi">' + escapeHtml(step.title) + '</div>' +
      '<div class="yinDaoWen">' + yinDaoWenAnHtml(step.body) + '</div>' +
      (step.value ? '<div class="yinDaoJiaZhi">' + yinDaoWenAnHtml(step.value) + '</div>' : '') +
      (step.tip ? '<a class="yinDaoLianJie" href="' + escapeHtml(step.tipUrl || '#') + '" data-yd="tip">' + escapeHtml(step.tip) + '</a>' : '') +
      '<div class="yinDaoDongZuo">' +
        '<button type="button" class="anNiuXiao" data-yd="skip">' + escapeHtml(tOr('guide.skip', '跳过')) + '</button>' +
        (step.btn ? '<button type="button" class="anNiuZhuYao" data-yd="go">' + escapeHtml(step.btn) + '</button>' : '') +
        '<button type="button" class="anNiuZhuYao" data-yd="next">' +
          escapeHtml(yinDaoBu >= total - 1 ? tOr('guide.finish', '完成') : tOr('guide.next', '下一步')) +
        '</button>' +
      '</div>';
    yinDaoHighlight(step.target);
    // 外链用**系统默认浏览器**打开，不用内置浏览器
    bar.querySelectorAll('[data-yd="tip"]').forEach((el) => {
      el.onclick = (ev) => {
        ev.preventDefault();
        const url = el.getAttribute('href') || '';
        if (url && url !== '#') {
          try { window.warmy.openExternal?.(url); } catch { /* noop */ }
        }
      };
    });
    // 只许贴边拖动：按住标题栏拖，松手吸附到最近的边
    (function bangTuo() {
      const shouBa = bar.querySelector('.yinDaoHead') || bar;
      let tuozhuai = null;
      shouBa.style.cursor = 'move';
      shouBa.addEventListener('pointerdown', (e) => {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        const rect = bar.getBoundingClientRect();
        tuozhuai = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
        try { shouBa.setPointerCapture(e.pointerId); } catch { /* noop */ }
        e.preventDefault();
      });
      shouBa.addEventListener('pointermove', (e) => {
        if (!tuozhuai) return;
        bar.style.transform = 'none';
        bar.style.left = Math.max(0, Math.min(window.innerWidth - tuozhuai.w, e.clientX - tuozhuai.dx)) + 'px';
        bar.style.top = Math.max(0, Math.min(window.innerHeight - tuozhuai.h, e.clientY - tuozhuai.dy)) + 'px';
        // 初始定位是 bottom:24px —— 拖动时必须把它清掉，否则 top/bottom 同时生效会把卡片拉高
        bar.style.right = 'auto';
        bar.style.bottom = 'auto';
      });
      const songShou = () => {
        if (!tuozhuai) return;
        tuozhuai = null;
        // 贴边吸附：四边取最近
        const r = bar.getBoundingClientRect();
        const du = [r.left, window.innerWidth - r.right, r.top, window.innerHeight - r.bottom];
        const min = Math.min(...du);
        const bian = du.indexOf(min);
        bar.style.transition = 'left .18s ease, top .18s ease, right .18s ease, bottom .18s ease';
        if (bian === 0) { bar.style.left = '8px'; bar.style.top = r.top + 'px'; bar.style.right = 'auto'; bar.style.bottom = 'auto'; }
        else if (bian === 1) { bar.style.right = '8px'; bar.style.left = 'auto'; bar.style.top = r.top + 'px'; bar.style.bottom = 'auto'; }
        else if (bian === 2) { bar.style.top = '8px'; bar.style.left = r.left + 'px'; bar.style.bottom = 'auto'; bar.style.right = 'auto'; }
        else { bar.style.bottom = '8px'; bar.style.top = 'auto'; bar.style.left = r.left + 'px'; bar.style.right = 'auto'; }
        setTimeout(() => { bar.style.transition = ''; }, 220);
      };
      shouBa.addEventListener('pointerup', songShou);
      shouBa.addEventListener('pointercancel', songShou);
    })();
    bar.querySelectorAll('[data-yd="skip"]').forEach((b) => {
      b.onclick = () => { yinDaoDone = true; yinDaoHide(); try { window.warmy.setupComplete?.({ guideDone: true }); } catch { /* noop */ } };
    });
    const go = bar.querySelector('[data-yd="go"]');
    if (go) go.onclick = () => { try { step.action(); } catch { /* noop */ } yinDaoHighlight(step.target); };
    const nx = bar.querySelector('[data-yd="next"]');
    if (nx) {
      nx.onclick = async () => {
        if (typeof step.check === 'function' && !step.check()) {
          // 还没做完：提示但允许继续
          // ⚠️ 这里必须走 yinDaoWenAnHtml：以前用 textContent 重写，
          // 把 {icon:settings} 原样吐出来、图标也一起没了（本轮真事故）。
          const w = bar.querySelector('.yinDaoWen');
          if (w && !w.dataset.warned) {
            w.dataset.warned = '1';
            w.innerHTML = yinDaoWenAnHtml(step.body + ' ' + (step.pending || ''));
          }
          return;
        }
        yinDaoBu += 1;
        if (yinDaoBu >= yinDaoSteps.length) {
          yinDaoDone = true;
          yinDaoHide();
          try { window.warmy.setupComplete?.({ guideDone: true }); } catch { /* noop */ }
          return;
        }
        yinDaoRender();
      };
    }
  }
  window.__yinDaoChongHua = yinDaoRender;

  async function showOnboardingGuide(force) {
    try {
      const st = await window.warmy.setupState?.().catch(() => null);
      if (!force && st && st.guideDone) return;
    } catch { /* 读不到就照常引导 */ }

    // 真·已配置供应商：有密钥或已拉到模型（只有默认 baseURL 不算）
    const youGongYingShang = () => {
      try {
        return (state.providers || []).some((p) => p && p.id && (p.hasKey === true || (p.models && p.models.length > 0)));
      } catch { return false; }
    };
    const youNiuMa = () => (state.instances || []).length > 0;

    yinDaoSteps = [
      {
        title: tOr('guide.step1.title', '先给 AI 接上一个大脑'),
        body: tOr('guide.step1.body', '点左侧底部的 {icon:settings}「设置」→「模型」→ 在「预设供应商」中添加一个你已经拥有 API Key 的供应商 → 填写「名称」「接口地址」和「密钥」→ 点击「拉取模型」→ 确保有成功显示模型。'),
        value: tOr('guide.step1.value', '没有它，牛马没法替你干活。'),
        tip: tOr('guide.step1.tip', '没有 API Key？点这里查看 DeepSeek 的 Key 获取方法'),
        tipUrl: 'https://platform.deepseek.com/api_keys',
        btn: tOr('guide.step1.btn', '去设置'),
        pending: tOr('guide.step1.pending', '（还没检测到可用的供应商，填好 Key 后再点「下一步」。也可以暂时跳过，稍后再添加。）'),
        target: '#peiZhiDaoHang button[data-sec="model"], [data-nav="settings"]',
        action: () => {
          setNav('settings');
          try {
            settingsSection = 'model';
            renderPage();
            setTimeout(() => yinDaoHighlight('#peiZhiDaoHang button[data-sec="model"]'), 200);
          } catch { /* noop */ }
        },
        check: youGongYingShang,
      },
      {
        title: tOr('guide.step2.title', '创建一个牛马'),
        body: tOr('guide.step2.body', '点左侧 {icon:niuMa}「我的牛马」→ {icon:guanLiJu}「牛马管理局」→ 点击上面的 「+」 创建一只牛马→确保「管理模型」中的模型设置正确而有效。创建完成后，点开它并给它选默认模型。'),
        value: tOr('guide.step2.value', '做完这步，你就有一个能随时差遣的 AI 牛马了。'),
        btn: tOr('guide.step2.btn', '去牛马管理局'),
        pending: tOr('guide.step2.pending', '（还没创建牛马，建好后再点「下一步」。）'),
        target: '#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao, #lieBiaoDongZuo',
        action: () => {
          setNav('singleAi');
          setTimeout(() => yinDaoHighlight('#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao'), 200);
        },
        check: youNiuMa,
      },
      {
        title: tOr('guide.step3.title', '现在就能开工了'),
        body: tOr('guide.step3.body', '点下面的「和牛马聊天」按钮，进入后就可以在底部输入框里说话，牛马就会替你干活。'),
        value: tOr('guide.step3.value', '也可以从左侧导航进入：项目 = 多牛马协同（可多人指挥）；联系人 = 与人端到端私聊；群聊 = 多人聊天并让 AI 参与；我的牛马 = 单只牛马。'),
        btn: tOr('guide.step3.btn', '和牛马聊天'),
        target: null,
        action: () => {
          const first = (state.instances || [])[0];
          setNav('singleAi');
          if (first) openChat('single', first.id, mingOf(first));
          setTimeout(() => yinDaoHighlight('#shuRu'), 250);
        },
        check: () => true,
      },
    ];

    yinDaoBu = 0;
    yinDaoDone = false;
    yinDaoRender();
  }
  window.__showOnboardingGuide = showOnboardingGuide;

  async function shuaxinZhixingqiji() {
    const heZi = $('zhiXingHe');
    if (!heZi) return;
    const r = await window.warmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    heZi.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + escapeHtml(String(it.status || '')) + ' · ' + escapeHtml(String(it.durationMs ?? 0)) + 'ms</div>').join('')
      : '—';
  }
  $('anNiuZhiXingYunXing')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.warmy.executorsRunBrief({ brief, contextItems: [] });
    shuaxinZhixingqiji();
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
          escapeHtml(e.name || id) + '</button><span class="jingYin" style="font-size:11px">' + escapeHtml(e.kind === 'entity' || !e.kind ? t('knowledge.kind.entity') : (e.kind === 'event' ? t('knowledge.kind.event') : String(e.kind))) + '</span>' +
          '<button class="anNiuXiao" data-kbdel="entity" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    evs.forEach((e) => {
      const id = String(e.id || e.title);
      rows.push(
        '<div class="zhiShiKuHang"><button class="zhiShiKuLink" data-kbev="' + escapeHtml(id) + '">' +
          escapeHtml(e.title || id) + '</button>' +
          '<button class="anNiuXiao" data-kbdel="event" data-kbid="' + escapeHtml(id) + '">×</button></div>'
      );
    });
    out.innerHTML = rows.length ? rows.join('') : '<div class="jingYin">' + escapeHtml(t('knowledge.empty')) + '</div>';
    // 点击 → 跳到聊天搜索（把关键词带过去）
    out.querySelectorAll('.zhiShiKuLink').forEach((b) => {
      b.onclick = () => {
        const kw = b.textContent || '';
        showSearchPopup();
        setTimeout(() => {
          const input = $('souSuoPopupShuRu');
          if (!input) return;
          input.value = kw;
          input.dispatchEvent(new Event('input', { bubbles: true }));
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

  $('anNiuZhiShiKuGo')?.addEventListener('click', () => {
    const q = $('zhiShiKuQ').value.trim();
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
    for (const buZhou of QR_SCAN_STEPS) {
      for (const rot of buZhou.rotations) {
        attempts++;
        let mingZhong = null;
        try {
          mingZhong = qrTryDecode(tuPian, buZhou.maxDim, rot);
        } catch (e) {
          // 两种失败必须分清：画布被污染（SecurityError）与解码器自己抛错，
          // 都是"读不出这张图"，但现场记录里要能看出是哪一种。
          const ming = String((e && e.name) || '');
          return { ok: false, reason: ming === 'SecurityError' ? 'canvas-tainted' : 'decode-error', attempts, detail: String((e && e.message) || e).slice(0, 80) };
        }
        if (mingZhong) return { ok: true, text: mingZhong.text, attempts, via: mingZhong };
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
    const qiShiShiJian = String(s == null ? '' : s);
    return qiShiShiJian.length > n ? qiShiShiJian.slice(0, n) + '…' : qiShiShiJian;
  }

  /** 扫码区块的 HTML（「加入项目/群聊」与「添加联系人」两个弹窗共用同一份） */
  function qrScanBlockHtml(prefix) {
    return (
      '<div class="qrSaoMiao" id="' + prefix + '-scan">' +
      '<div class="qrSaoMiaoHang">' +
      '<button type="button" class="anNiuXiao" id="' + prefix + '-pick">' + escapeHtml(t('join.pickImage')) + '</button>' +
      '<span class="jingYin" id="' + prefix + '-hint">' + escapeHtml(t('join.dropHint')) + '</span>' +
      '</div>' +
      '<input type="file" id="' + prefix + '-file" accept="image/*" class="yinCang"/>' +
      '<div class="qrSaoMiaoXiangQing jingYin" id="' + prefix + '-detail"></div>' +
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
   * @param prefix  区块前缀（jiaRuqr / contact-qr）
   * @param onJoin  解出合法链接后调用的加入函数（与弹窗「确定」按钮调用的是同一个）
   * @param linkInput 链接输入框（解出来的链接会写进去，用户看得见、可核对）
   */
  function bindQrScan(prefix, onJoin, linkInput) {
    const kuai = $(prefix + '-scan');
    const file = $(prefix + '-file');
    const pick = $(prefix + '-pick');
    const detail = $(prefix + '-detail');
    const tiShi = $(prefix + '-hint');
    if (!kuai || !file || !detail) return;
    const huoZhe = () => !!document.body.contains(detail) && !$('duiHuaKuangGen')?.classList.contains('yinCang');
    const say = (text, state) => {
      if (!document.body.contains(detail)) return;
      detail.textContent = text;
      detail.setAttribute('data-scan-state', state || '');
      kuai.setAttribute('data-scan-state', state || '');
    };
    async function handleImage(fileOrBlob) {
      if (!fileOrBlob || !huoZhe()) return;
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
      if (!huoZhe()) return; // 解码期间弹窗被关掉了：不贴提示、更不发起加入
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
      kuai.setAttribute('data-scan-via', JSON.stringify({ maxDim: dec.via.maxDim, rotationDeg: dec.via.rotationDeg, width: dec.via.width, height: dec.via.height, attempts: dec.attempts }));
      say(fmtKey('join.scanFound', { link: scanPreviewText(cls.link) }), 'found');
      await onJoin(cls.link, { fromScan: true, attempts: dec.attempts, via: dec.via });
    }
    pick?.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { void handleImage(file.files && file.files[0]); });
    kuai.addEventListener('dragover', (e) => {
      e.preventDefault();
      kuai.classList.add('dropping');
      if (tiShi) tiShi.textContent = t('join.scanDropRelease');
    });
    kuai.addEventListener('dragleave', () => {
      kuai.classList.remove('dropping');
      if (tiShi) tiShi.textContent = t('join.dropHint');
    });
    kuai.addEventListener('drop', (e) => {
      e.preventDefault();
      kuai.classList.remove('dropping');
      if (tiShi) tiShi.textContent = t('join.dropHint');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      void handleImage(f);
    });
    // 粘贴路由：只在**这个**弹窗可见时接管
    qrScanActiveSink = (f) => { void handleImage(f); };
    kuai.setAttribute('data-scan-ready', qrDecoderAvailable() ? '1' : '0');
  }

  // 加入项目/群聊：扫码或粘贴链接
  /** 加入项目/群聊的弹窗内容（扫码区块 + 粘贴链接 + 「对方将看到的名片」） */
  function joinDialogBodyHtml(ka) {
    return (
      '<div class="jingYin" style="margin-bottom:8px">' + escapeHtml(t('join.scanHint')) + '</div>' +
      qrScanBlockHtml('jiaRuqr') +
      '<input id="jiaRuLinkShuRu" placeholder="' + escapeHtml(t('join.pastePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"/>' +
      '<div class="jingYin" style="margin-top:10px">' + escapeHtml(t('ka.peerWillSee')) + '</div>' + myCardHtml(ka) +
      '<div id="jiaRuqrXiaoXi" class="jingYin" style="margin-top:6px"></div>'
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
    let bieMing = '';
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
      bieMing = String(info.bieMing || (r && r.bieMing) || '');
      fp = String(info.zhiWen || (r && r.zhiWen) || '');
    } catch {
      /* 拿不到就留空 */
    }
    const shui = node || fp || bieMing;
    const Pian = [];
    if (shui) Pian.push('node=' + encodeURIComponent(shui));
    const port = Number(netState.addr && netState.addr.port) || 0;
    if (port) Pian.push('port=' + port);
    if (token) Pian.push('tok=' + encodeURIComponent(token));
    return { ok: !!shui, link: shui ? 'warmy://join?' + Pian.join('&') : '', node, token, bieMing, zhiWen: fp };
  }

  /**
   * 左列：我的链接 + 我的二维码（真编码器：见 qrSvg 与 vendor/qrcode-generator-2.0.4.js）
   */
  async function ownLinkColumnHtml() {
    const ziji = await ownInviteLink();
    if (!ziji.ok) {
      return { ziji, html: '<div class="ownqrKong" id="lianXiOwnUnavailable">' + escapeHtml(t('contact.mineUnavailable')) + '</div>' };
    }
    const html =
      '<div class="ownLinkHang">' +
      '<span class="ownLinkWenBen" id="lianXiMyLink">' + escapeHtml(ziji.link) + '</span>' +
      '<button type="button" class="anNiuXiao" id="anNiuMyLinkCopy">' + escapeHtml(t('contact.mineCopy')) + '</button>' +
      '</div>' +
      (ziji.bieMing || ziji.zhiWen
        ? '<div class="ownidXian">' + escapeHtml(t('contact.ownId')) + ': ' + escapeHtml(ziji.bieMing || ziji.zhiWen) + '</div>'
        : '') +
      '<div id="lianXiMyqr" data-link="' + escapeHtml(ziji.link) + '" aria-label="' + escapeHtml(t('contact.mineQr')) + '"></div>';
    return { ziji, html };
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
      yuanSu.classList.remove('ownqrKong');
      yuanSu.setAttribute('data-qr-state', 'ok');
      return true;
    }
    yuanSu.innerHTML = '';
    yuanSu.classList.add('ownqrKong');
    yuanSu.setAttribute('data-qr-state', 'no-encoder');
    yuanSu.textContent = t('contact.qrUnavailable');
    return false;
  }

  $('anNiuJiaRuqr')?.addEventListener('click', async () => {
    const root = $('duiHuaKuangGen');
    // R4：联系人页的「添加联系人」弹窗 = 左列我的链接/二维码 + 右列添加对方。
    // 项目/群聊页仍是原来的「扫码加入 / 申请加入」。
    if (state.nav === 'externalChat') {
      $('duiHuaKuangBiaoTi').textContent = t('contact.add');
      const ka = await myCard();
      const benji = await ownLinkColumnHtml();
      $('duiHuaKuangTi').innerHTML =
        '<div class="tianJiaLianXiGrid">' +
        '<div class="tianJiaLianXiLan" id="lianXiOwnMianBan">' +
        '<h4>' + escapeHtml(t('contact.mine')) + '</h4>' +
        '<p class="tianJiaLianXiTiShi">' + escapeHtml(t('contact.mineHint')) + '</p>' +
        benji.html +
        '</div>' +
        '<div class="tianJiaLianXiLan" id="tianJiaLianXiOthers">' +
        '<h4>' + escapeHtml(t('contact.others')) + '</h4>' +
        '<p class="tianJiaLianXiTiShi">' + escapeHtml(t('contact.othersHint')) + '</p>' +
        '<input id="tianJiaLianXiMing" placeholder="' + escapeHtml(t('contact.namePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-bottom:8px"/>' +
        '<div class="jingYin" style="margin-bottom:6px">' + escapeHtml(t('contact.scanHint')) + '</div>' +
        qrScanBlockHtml('contact-qr') +
        '<input id="jiaRuLinkShuRu" placeholder="' + escapeHtml(t('join.pastePlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:8px"/>' +
        '<div class="jingYin" style="margin-top:10px">' + escapeHtml(t('ka.peerWillSee')) + '</div>' + myCardHtml(ka) +
        '<div id="jiaRuqrXiaoXi" class="jingYin" style="margin-top:6px"></div>' +
        '</div></div>';
      if (benji.ziji.ok) {
        fillOwnQr($('lianXiMyqr'), benji.ziji.link, 168);
        const copy = $('anNiuMyLinkCopy');
        if (copy) {
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(benji.ziji.link);
              $('jiaRuqrXiaoXi').textContent = t('contact.mineCopied');
            } catch {
              $('jiaRuqrXiaoXi').textContent = t('contact.mineCopyFail');
            }
          };
        }
      }
      const cActs = $('duiHuaKuangDongZuoJi');
      cActs.innerHTML = '';
      const cCancel = document.createElement('button');
      cCancel.className = 'anNiuXiao';
      cCancel.textContent = t('common.cancel');
      cCancel.onclick = () => { root.classList.add('yinCang'); };
      const cOk = document.createElement('button');
      cOk.className = 'anNiuZhuYao';
      cOk.textContent = t('common.ok');
      /**
       * 添加联系人弹窗里「用链接加入」的**唯一**实现 ——
       * 「确定」按钮（粘贴链接）与扫码区块（识别出的链接）都走这一个函数。
       * 这里不新增第二条加入实现：扫码只是把载荷塞进同一个入参位置。
       */
      const submitContactJoin = async (link) => {
        const r = await window.warmy.joinRequest({
          ming: state.profile.username || 'user',
          kind: 'human',
          target: link,
          targetType: 'contact',
          // 附六：加入动作即交换名片（邮箱/手机号为空也照发）
          ka: { email: ka.email || '', phone: ka.phone || '' },
        }).catch(() => null);
        const xiaoXi = $('jiaRuqrXiaoXi');
        if (xiaoXi) xiaoXi.textContent = r?.ok ? t('join.ok') : t('join.fail');
        return r;
      };
      cOk.onclick = async () => {
        const ming = String((($('tianJiaLianXiMing') || {}).value) || '').trim();
        const link = String((($('jiaRuLinkShuRu') || {}).value) || '').trim();
        if (ming) {
          // 「加对方」：原 addContactFlow 的流程（名片确认 → 落联系人）
          const yiTianJia = await createContactWithCard(ming);
          if (yiTianJia) root.classList.add('yinCang');
          return;
        }
        if (!link) {
          $('jiaRuqrXiaoXi').textContent = t('contact.needInput');
          return;
        }
        await submitContactJoin(link);
        setTimeout(() => root.classList.add('yinCang'), 800);
      };
      cActs.append(cCancel, cOk);
      // 扫别人的二维码：选图 / 拖入 / 粘贴 → 本机解码 → 走上面**同一个** submitContactJoin
      bindQrScan('contact-qr', async (link) => {
        const r = await submitContactJoin(link);
        // 扫出来的链接加入成功才自动收窗；失败就留在弹窗里（让用户看到那句如实话术、可重试）
        if (r?.ok) setTimeout(() => root.classList.add('yinCang'), 800);
      }, $('jiaRuLinkShuRu'));
      root.classList.remove('yinCang');
      return;
    }
    $('duiHuaKuangBiaoTi').textContent = t('join.biaoTi');
    const ka = await myCard();
    $('duiHuaKuangTi').innerHTML = joinDialogBodyHtml(ka);
    const dongZuoJi = $('duiHuaKuangDongZuoJi');
    dongZuoJi.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
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
        ming: state.profile.username || 'user',
        kind: 'human',
        target: link,
        targetType: joinMode,
        // 附六：加入动作即交换名片（邮箱/手机号为空也照发，对方看到的是「未填写」而不是「被隐藏」）
        ka: { email: ka.email || '', phone: ka.phone || '' },
      }).catch(() => null);
      const xiaoXi = $('jiaRuqrXiaoXi');
      if (xiaoXi) xiaoXi.textContent = r?.ok ? t('join.ok') : t('join.fail');
      return r;
    };
    ok.onclick = async () => {
      const link = $('jiaRuLinkShuRu')?.value?.trim();
      if (!link) { $('jiaRuqrXiaoXi').textContent = t('join.qrFail'); return; }
      await submitProjectJoin(link);
      setTimeout(() => root.classList.add('yinCang'), 800);
    };
    dongZuoJi.append(cancel, ok);
    // 扫别人的二维码：选图 / 拖入 / 粘贴 → 本机解码 → 走上面**同一个** submitProjectJoin
    bindQrScan('jiaRuqr', async (link) => {
      const r = await submitProjectJoin(link);
      if (r?.ok) setTimeout(() => root.classList.add('yinCang'), 800);
    }, $('jiaRuLinkShuRu'));
    root.classList.remove('yinCang');
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
  $('xiaoXiJi')?.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    e.preventDefault();
    const text = bubble.textContent || '';
    openContextMenu(e.clientX, e.clientY, [
      { biaoQian: t('common.copy'), onClick: () => { navigator.clipboard?.writeText(text); } },
      { biaoQian: t('common.quote'), onClick: () => {
          const input = $('shuRu');
          if (input) input.value = '> ' + text.slice(0, 120) + '\n' + input.value;
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
   * 首字块要和 `.lieBiaoTiaoMu .av` 视觉一致：圆角方块 + 浅底 + 首字。
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
        // 与第二列 `.lieBiaoTiaoMu .av` 同款：6/40 圆角比例、浅底、居中首字
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
      biaoTi: xianShiMing(state.selectedChat) || mingOf((state.instances||[]).find((i)=>i.id===state.selectedChat.id)) || state.selectedChat.id,
      title: xianShiMing(state.selectedChat) || mingOf((state.instances||[]).find((i)=>i.id===state.selectedChat.id)) || state.selectedChat.id,
      kind: state.selectedChat.kind,
      mode: 'fu',
      iconDataUrl,
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
      title: xianShiMing(state.selectedChat),
      xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });
  // 托盘 + 热键
  window.warmy.trayInit?.().catch(() => {});
  window.warmy.registerHotkey?.('CommandOrControl+Shift+M').catch(() => {});
  // 从 URL 参数自动打开会话（多窗口）
  // 产品定稿：独立会话窗只保留 **聊天（第3列）+ 右侧事项（第4列）**；
  // 顶栏 #biaoTiLan **必须保留**（无边框窗口靠它拖动 + 窗控），任务栏图标由主进程 setIcon。
  try {
    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    const cid0 = q.get('chatId');
    const title0 = q.get('chatBiaoTi') || q.get('chatTitle') || q.get('biaoTi') || '';
    if (mode === 'fu' || cid0) {
      document.body.classList.add('liaoTianChuangKou');
      /**
       * 钉住 URL 指定的会话，并把导航设成它所在的栏。
       * 否则 renderList() 的"自动打开第一个"会在 singleAi 栏里把选中抢回第一个实例
       * —— 独立窗就永远显示错会话（实测：请求 link-p1，窗口里却是 demo.agent）。
       */
      state.subWindowPinnedId = String(cid0 || '');
      const k0 = String(q.get('chatKind') || 'single');
      state.nav = k0 === 'internal' ? 'internalGroup'
        : (k0 === 'extgroup' || k0 === 'externalGroup' || k0 === 'external') ? 'externalGroup'
          : (k0 === 'extdm' || k0 === 'externaldm') ? 'externalChat'
            : 'singleAi';
      document.getElementById('ceLan')?.classList.add('yinCang');
      document.getElementById('lieBiaoLan')?.classList.add('yinCang');
      document.getElementById('appTi')?.classList.add('yinCangLieBiao');
      document.getElementById('kongTai')?.classList.add('yinCang');
      document.getElementById('pageBuJu')?.classList.add('yinCang');
      document.getElementById('shiLiXiangQing')?.classList.add('yinCang');
      const cl = document.getElementById('liaoTianBuJu');
      if (cl) {
        cl.classList.remove('yinCang');
        cl.style.display = 'grid';
        cl.style.height = '100%';
      }
      const mc = document.getElementById('zhuLan');
      if (mc) { mc.style.height = '100%'; mc.style.minHeight = '0'; }
      const pc = document.getElementById('mianBanLan');
      if (pc) { pc.style.display = 'flex'; pc.style.height = '100%'; pc.style.overflow = 'auto'; }
      if (title0) {
        try { document.title = title0; } catch { /* noop */ }
        const brand = document.getElementById('biaoTiLanPinPai');
        if (brand) brand.textContent = title0;
      }
    }
    const cid = q.get('chatId');
    if (cid) {
      const biaoTi = q.get('chatBiaoTi') || q.get('chatTitle') || q.get('biaoTi') || cid;
      const kind = q.get('chatKind') || 'single';
      setTimeout(() => openChat(kind, cid, biaoTi), 300);
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
      // 该会话的消息（主进程日志 = 唯一事实来源）
      void loadSessionMessages(sid);
      // 若它正是本窗口正在看的会话，右侧（进度/成员/项目状态）也要跟着一致
      if (state.selectedChat && String(state.selectedChat.id) === sid) void refreshEntityView(sid);
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
    // 定时任务 / 文件产物：事件一来就**自动补卡片**（被关掉也会加回来）
    window.warmy.onDingShiRenWu?.((d) => {
      state.dingShiRenWu = (d && d.tasks) || [];
      try { queBaoKaPian('mianBanDingShiKuai'); renderDingShiKa(); } catch { /* noop */ }
    });
    window.warmy.onDingShiDaoDian?.((d) => {
      try { queBaoKaPian('mianBanDingShiKuai'); renderDingShiKa(); } catch { /* noop */ }
      // 到点：替用户发这一轮（走与手动发送同一条派发路径）
      try {
        if (d && d.sessionId && d.prompt) void deliver(String(d.sessionId), String(d.prompt), 'P2');
      } catch { /* noop */ }
    });
    // 计划任务更新（AI 列/改计划）：卡片自动出现并刷新（被关掉也会补回）
    window.warmy.onJiHuaGengXin?.((d) => {
      state.jiHuaRenWu = (d && d.steps) || [];
      try { queBaoKaPian('mianBanJiHuaKuai'); renderJiHuaKa(); } catch { /* noop */ }
    });
    /**
     * **重启/崩溃后恢复到「还有被打断的任务」的会话**：
     * 列表亮 `?`，进会话会看到「继续/重试」按钮（产品要求）。
     */
    window.warmy.onJiHuaHuiFu?.((d) => {
      try {
        const ss = (d && Array.isArray(d.sessions)) ? d.sessions : [];
        state.planInterrupted = state.planInterrupted || new Set();
        for (const s of ss) state.planInterrupted.add(String(s));
        /**
         * **任何异常让任务停在半路**（卡死/闪退/超时/超限/模型调用失败）都会带 `why/error`：
         * 记下来，点「继续 / 重试」时交给模型分析（产品要求）。
         */
        if (d && d.why) {
          state.renWuZhongDuan = state.renWuZhongDuan || {};
          const sid0 = String(d.sessionId || (ss[0] || ''));
          if (sid0) state.renWuZhongDuan[sid0] = { why: String(d.why), error: String(d.error || ''), jieDuan: String(d.jieDuan || '') };
        }
        renderList();
      } catch { /* noop */ }
    });
    /**
     * **自动续派期间动态小字要一直亮着**（真事故：主轮 `deliver` 收尾把小字关了，
     * 而续派还在跑 ⇒ 界面像"已经结束"，其实 AI 还在干活）。
     * 主进程在每一轮续派前后各广播一次，这里跟着开/关。
     */
    window.warmy.onYunXingZhuangTai?.((d) => {
      try {
        const sid = String((d && d.sessionId) || '');
        if (!sid) return;
        if (d.kai) yunXingZhuangTaiKai(sid);
        else yunXingZhuangTaiGuan(true, sid);
      } catch { /* noop */ }
    });
    /**
     * **流式增量**：思考过程与正文**边出边显示**（产品要求）。
     * 形态：聊天末尾一条"正在进行"的气泡，思考块**默认展开**；等正式回复到了
     * （`tuisongXiaoxi`）就把它收走，正式那条里的思考块**自动折叠**。
     */
    window.warmy.onSuiXingPianDuan?.((d) => {
      try {
        const sid = String((d && d.sessionId) || '');
        if (!sid) return;
        if (d.end) { try { shouLiuShiKuai(); } catch { /* noop */ } return; }
        state.streamBuf = state.streamBuf || {};
        const b = state.streamBuf[sid] || (state.streamBuf[sid] = { reasoning: '', content: '' });
        // 单会话缓冲上限 200KB（防长文把内存撑大；到顶就不再追加）
        if (d.reasoning && b.reasoning.length < 200000) b.reasoning += String(d.reasoning);
        if (d.content && b.content.length < 200000) b.content += String(d.content);
        if (state.selectedChat && String(state.selectedChat.id) === sid) xuanRanLiuShiKuai(sid, b);
      } catch { /* 流式渲染失败不影响主流程 */ }
    });
    window.warmy.onAiWenTi?.((d) => {
      /**
       * **决策卡创建那一刻就响**（真事故：首次出现决策卡常常没声音）。
       * 以前只在 `renderAiQuestions` 里播 —— 那个函数开头会
       * `if (!host || !state.selectedChat) return`：用户停在别的页/列表还没选中会话时，
       * 整段音效逻辑被跳过，等回到聊天页才补播（太晚，用户已经以为没声音）。
       * 现在：主进程一广播就按 id 记账并播一次；`renderAiQuestions` 里只在
       * **还没记过账**的卡上补播，两边共用同一本账（`xiangKaPianYin`），不会响两遍也不会漏。
       */
      try {
        const id = String((d && (d.id || (d.question && d.question.id))) || '');
        if (id) xiangKaPianYin([id], 'broadcast');
        else void chuanBoYinXiao('request', 'broadcast-no-id');
      } catch { /* noop */ }
      try { void renderAiQuestions(); } catch { /* noop */ }
    });
    window.warmy.onWenJianChanSheng?.((d) => {
      state.gongZuoWenJian = state.gongZuoWenJian || [];
      if (d && d.path) {
        state.gongZuoWenJian.push({ path: d.path, abs: d.abs || '', bytes: d.bytes || 0, ts: d.ts || Date.now() });
        if (d.root) state.gongZuoQuLuJing = String(d.root);
      }
      // 归到「项目文件与产物」卡片：**有更新就自动补卡片**（被关掉也会加回来）
      try {
        queBaoKaPian('xiangMuWenJianJiKuai');
        void renderProjectFilesBlock();
      } catch { /* noop */ }
    });
    // 起手拉一次定时任务列表（重启后卡片里还有）
    try {
      window.warmy.dingShiRenWuLieBiao?.().then((r) => {
        state.dingShiRenWu = (r && r.tasks) || [];
        if (state.dingShiRenWu.length) { queBaoKaPian('mianBanDingShiKuai'); renderDingShiKa(); }
      }).catch(() => {});
    } catch { /* noop */ }
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
            try { tongBuBeiJingWenZi(); } catch { /* noop */ }
          }
          if (keys.includes('yuYan') && s.yuYan && keYiGengYuYan() && resolveLocalePack(s.yuYan) !== state.yuYan) {
            await loadI18n(resolveLocalePack(s.yuYan));
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
    // 决策卡：**不走 raf**（窗口被遮挡时 rAF 会停发，卡片就"既不显示也不响"）。
    // 专用定时器 + 真实计时器（主窗口 backgroundThrottling=false）⇒ 后台也能发现新卡并响铃。
    if (__loopTick % 4 === 0) raf(renderProjectMemoryPanel);
    if (__loopTick % 8 === 0) raf(refreshJoinBadge);
    if (__loopTick % 15 === 0) raf(() => window.__saveState?.());
    // 语言：设置被外部改过（IPC settingsSave / 另一窗口）也要跟上，不靠启动时读一次
    if (__loopTick % 1 === 0) {
      void (async () => {
        try {
          const s = await window.warmy.settingsGet();
          const weiZhi = s?.settings?.yuYan;
          // 设置文件跟上用户的选择后解除待确认；此后外部改动照常跟读
          jieChuYuYanDaiQueRen(weiZhi);
          if (weiZhi && keYiGengYuYan() && resolveLocalePack(weiZhi) !== state.yuYan) {
            await loadI18n(resolveLocalePack(weiZhi));
          }
        } catch { /* noop */ }
      })();
    }
  }, 5000);
  /**
   * 决策卡专用心跳（**与 rAF 无关**）：主进程广播可能因为渲染层刚起、窗口在后台、
   * 或广播那一刻刚好没绑上监听而丢掉；轮询是最后一道保险。
   * 用普通 `setInterval`（主窗口 `backgroundThrottling:false`）⇒ 后台也按时跑到。
   */
  setInterval(() => { try { void renderAiQuestions(); } catch { /* noop */ } }, 1200);
  const __mainLoop = true;

  (async () => {
    try {
      // Prefer saved settings.yuYan; otherwise map navigator.language onto the full 10-locale set.
      let bootLocale = resolveLocalePack(navigator.language);
      try {
        // 系统语言优先（Electron main 的 app.getLocale，比 navigator 更准）
        const sys = await window.warmy.localeInfo?.().catch(() => null);
        if (sys && (sys.resolved || sys.system)) bootLocale = resolveLocalePack(sys.resolved || sys.system);
      } catch { /* fall through */ }
      try {
        const s0 = await window.warmy.settingsGet();
        if (s0?.settings?.yuYan) bootLocale = resolveLocalePack(s0.settings.yuYan);
      } catch { /* keep system mapping */ }
      await loadI18n(bootLocale);
    } catch {
      state.yuYan = 'zh-CN';
      state.t = { 'yingYong.zhName': '无限牛马', 'yingYong.enName': 'WArmy', 'yingYong.subtitle': 'Workhorse Army', 'yingYong.displayName': '无限牛马', 'brand.name': '无限牛马', 'brand.fu': 'WArmy（Workhorse Army）', 'brand.tagline': '让AI成为你的无限牛马', 'about.tagline': '多智能体群聊桌面应用' };
      applyI18n();
    }
    // i18n 就绪后再弹首启语言选择（此前在脚本加载时就弹，界面全是键名）
    try { void window.__maybeShowSetup?.(); } catch { /* noop */ }
    try {
      const s = await window.warmy.settingsGet();
      if (s?.settings) {
        state.wenZi = s.settings.wenZi || state.wenZi || {};
        try { window.__qingHuanCunYinXiao?.(); } catch { /* noop */ }
        state.themeMode = s.settings.themeMode || 'system';
        state.theme = s.settings.accent || state.theme;
        state.sound = s.settings.sound || state.sound;
        state.soundFiles = s.settings.soundFiles || state.soundFiles;
        if (s.settings.soundVolume != null) state.soundVolume = Number(s.settings.soundVolume);
        // 手动设定的思考级别要**保持**（存在设置里；没设过就是"跟随牛马管理局"）
        if (s.settings.thinkOverride && typeof s.settings.thinkOverride === 'object') {
          state.thinkOverride = { ...s.settings.thinkOverride };
        }
        if (s.settings.autoRead != null) state.autoRead = !!s.settings.autoRead;
        state.emailOnRequest = !!s.settings.emailOnRequest;
        state.globalSecurity = s.settings.globalSecurity || 'normal';
        state.askOnExceed = s.settings.askOnExceed !== false;
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
        // Re-apply persisted yuYan (settingsGet is also used above for boot; ensure UI state matches).
        jieChuYuYanDaiQueRen(s.settings.yuYan);
        if (s.settings.yuYan && keYiGengYuYan() && resolveLocalePack(s.settings.yuYan) !== state.yuYan) {
          try { await loadI18n(resolveLocalePack(s.settings.yuYan)); } catch { /* noop */ }
        }
        document.documentElement.style.setProperty('--accent', state.theme);
        try { tongBuBeiJingWenZi(); } catch { /* noop */ }
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
    try { yingYongWenZiPiHao(state.wenZi); } catch { /* noop */ }
    applyAvatar();
    try {
      state.globalSecurity = (await window.warmy.securityMode()) || state.globalSecurity;
      state.hardware = await window.warmy.hardware();
      heBingShiLiJi((await window.warmy.listInstances()) || []);
    } catch {
      /* noop */
    }
    // 待执行队列：启动时从 userData/ui-queues.json 恢复（进程退出不丢 P2/P3）
    try { await restoreUiQueuesOnce(); } catch { /* noop */ }
    // 产品定稿：首次打开**不**造假牛马；空列表引导用户去牛马管理局创建
    if (!state.instances.length) {
      state.instances = [];
    }
    // 老实例缺头像时补一个稳定的预设（按 id 派生，重启后不变）
    state.instances.forEach((i) => {
      if (!i.avatarPreset && !i.avatarDataUrl) {
        let h = 0;
        const s = String(i.id || mingOf(i));
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
        chaJianJi: state.chaJianJi,
        groups: state.groups,
        chats: state.chats,
        instanceAvatars,
        listSort: state.listSort,
      }).catch(() => {});
    };
    window.__saveState = saveState;
    
    /**
     * 独立会话窗：导航已按 URL 的 chatKind 设好，**不能**再改回 singleAi，
     * 也**不能**执行下面这段"默认选中第一个聊天" —— 它在这段异步启动之后才跑，
     * 会把 URL 指定的会话直接换成第一列的第一个实例
     * （实测时间线：500ms 选中还是请求的那个项目，1000ms 变成 demo-1）。
     */
    if (!state.subWindowPinnedId) {
      setNav('singleAi');
      // 默认选中第一个聊天
      setTimeout(() => {
        const first = state.instances[0] || state.chats.find((x) => x.kind === 'single');
        if (first) openChat('single', first.id, xianShiMing(first));
      }, 100);
    }
    refreshMetrics();
    shuaxinZhixingqiji();
  })();
})();
