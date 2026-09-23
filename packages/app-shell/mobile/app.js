/* WArmy 移动端 — 单列 + 底部 Tab + 下钻返回
   规则：
   - 一级导航只走底部 Tab（会话 / 牛马 / 看板 / 我）
   - 二级、三级页面从右侧滑入，顶部一定有「‹ 返回」
   - 聊天右侧的成员/模型/知识库/回退点/指标/导出，统一收进聊天顶部「…」的底部面板
   - 界面文字一律走 t()；语言包缺失时回落中文兜底 D，再回落键名
*/
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  // ── i18n：单文件构建时会把语言包注入 window.__I18N__ ──
  const I18N = window.__I18N__ || { yuYan: 'zh-CN', strings: {} };
  const D = {
    'brand.name': '无限牛马',
    'brand.fu': 'WArmy（Workhorse Army）',
    'tab.sessions': '会话', 'tab.cattle': '牛马', 'tab.board': '看板', 'tab.wo': '我',
    'sessions.biaoTi': '会话',
    'cattle.biaoTi': '牛马',
    'board.biaoTi': '看板', 'board.running': '进行中', 'board.done': '今日完成',
    'board.instances': '运行实例', 'board.queue': '排队', 'board.jinDu': '会话进展',
    'wo.biaoTi': '我', 'wo.settings': '设置', 'wo.appearance': '外观', 'wo.provider': '模型供应商',
    'wo.smtp': '邮箱 SMTP', 'wo.mesh': '组网', 'wo.about': '关于',
    'wo.language': '语言', 'wo.theme': '主题', 'wo.accent': '主题色',
    'wo.light': '浅色', 'wo.dark': '深色', 'wo.system': '跟随系统',
    'wo.version': '版本', 'wo.checkUpdate': '检查更新', 'wo.opensource': '开源信息',
    'wo.copyright': '版权', 'wo.deviceId': '设备 ID', 'wo.owner': '主人',
    'chat.placeholder': '输入消息', 'm.chat.placeholder': '输入消息', 'chat.faSong': '发送', 'chat.more': '更多',
    'chat.members': '成员', 'chat.model': '模型管理', 'chat.kb': '知识库',
    'chat.checkpoints': '回退点', 'chat.metrics': '性能指标', 'chat.export': '导出会话',
    'chat.urgent': '加急', 'chat.insert': '插入', 'chat.queue': '排队',
    'chat.cancel': '取消', 'chat.systemNote': '手机端为外观预览；编排在桌面端完成。',
    'inst.status.running': '运行中', 'inst.status.stopped': '已停止',
    'inst.defaultModel': '默认模型', 'inst.models': '可用模型', 'inst.chain': '调用链',
    'inst.persona': '写入更多', 'inst.group': '成员',
    'kb.tiShi': '输入关键词检索知识库', 'cp.empty': '暂无回退点', 'cp.rollback': '回退', 'cp.rollbackHint': '回退：将停止当前任务并回到该节点。',
    'metrics.turns': '轮次', 'metrics.cost': '成本(¥)',
    'common.yes': '是',
    'ui.type.single': '牛马', 'ui.type.internal': '项目', 'ui.type.contact': '联系人', 'ui.type.external': '群聊',
    'board.blocked': '阻塞', 'board.readonlyHint': '看板为只读聚合视图，修改请通过与值班者对话完成。',
    'chat.fu.single': '我的牛马', 'chat.fu.group': '群聊',
    'export.hasTs': '包含时间戳', 'accent.custom': '自定义取色',
    'provider.list': '供应商列表', 'provider.add': '+ 添加供应商', 'provider.configured': '已配置', 'provider.notConfigured': '未配置',
    'smtp.settings': '邮箱 SMTP 设置', 'smtp.hostLabel': 'SMTP 服务器', 'smtp.portLabel': '端口', 'smtp.userLabel': '用户名',
    'smtp.passLabel': '授权码', 'smtp.passPlaceholder': '输入授权码', 'smtp.fromLabel': '发件人名称', 'smtp.fromPlaceholder': '无限牛马通知', 'smtp.verifyBtn': '验证并保存',
    'notify.biaoTi': '邮件通知', 'notify.done': '完成通知', 'notify.req': '请求通知', 'notify.err': '错误通知',
    'mesh.portLabel': '监听端口', 'mesh.stateLabel': '组网开关', 'mesh.peers': '已知节点', 'mesh.start': '打开组网', 'mesh.stop': '关闭组网',
    'mesh.stopped': '已关闭', 'mesh.invite': '邀请加入', 'mesh.genInvite': '生成邀请码', 'mesh.scanJoin': '扫码加入',
    'about.license': '许可证',
    'xiaoXi.initFailed': '移动端初始化失败：',
    'preview.settingsNotice': '以下设置仅为本机预览：改动不会保存，也不会同步到桌面端。', 'xiaoXi.smtpDesktopOnly': 'SMTP 验证需要桌面端配合，手机端仅作界面预览。', 'prompt.providerName': '供应商名称',
    'xiaoXi.latest': '当前已是最新版本', 'xiaoXi.inviteCopied': '邀请码已复制到剪贴板', 'xiaoXi.scanOnDesktop': '请使用桌面端扫码功能', 'export.tiShi': '导出当前会话为 Markdown',
  };
  const t = (k) => (I18N.strings && I18N.strings[k]) || D[k] || k;
  const brandName = () => t('brand.name');
  /** 可见文字一律 esc(t(...))；对象/空值不直出 */
  const disp = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.map(disp).join(' · ');
      return String(v.biaoQian || v.text || v.name || v.value || '—');
    }
    return String(v);
  };

  // ── 演示数据（单文件预览用；名称/文案走 i18n 键，避免中英界面串台）──
  const AV = (n) => {
    const set = window.__AVATARS__ || {};
    return set['preset-' + n] || null;
  };
  const demoName = (key, fallback) => t(key) !== key ? t(key) : fallback;
  const INSTANCES = [
    { id: 'demo-1', nameKey: null, ming: 'demo.agent', status: 'running', model: 'deepseek-chat', preset: 5,
      models: ['deepseek-chat', 'deepseek-reasoner', 'mimo-v2.5-pro'],
      chain: ['deepseek-chat', 'deepseek-reasoner'], personaKey: 'demo.persona' },
    { id: 'demo-2', nameKey: 'demo.name.archiver', ming: null, status: 'stopped', model: 'mimo-v2.5-pro', preset: 9,
      models: ['mimo-v2.5-pro'], chain: ['mimo-v2.5-pro'], personaKey: null },
  ];
  const instName = (i) => (i && (i.name || (i.nameKey ? t(i.nameKey) : ''))) || '?';
  const SESSIONS = [
    { id: 'demo-1', nameKey: null, ming: 'demo.agent', kind: 'single', lastKey: 'demo.xiaoXi.scheduled', tsKey: null, ts: null, unread: 1 },
    { id: 'g-1', nameKey: 'demo.sess.g1', ming: null, kind: 'internal', lastKey: 'demo.xiaoXi.synced', ts: '12:04', unread: 2 },
    { id: 'g-2', nameKey: 'demo.sess.g2', ming: null, kind: 'internal', lastKey: 'demo.xiaoXi.rndUpdated', tsKey: null, ts: null },
    { id: 'g-3', nameKey: 'demo.sess.g3', ming: null, kind: 'external', lastKey: 'demo.xiaoXi.extSilent', ts: null },
    { id: 'c-1', nameKey: 'demo.sess.c1', ming: null, kind: 'contact', lastKey: 'demo.xiaoXi.weekly', ts: null },
  ];
  // 时间戳也走 i18n：中文「刚刚/昨天/周一」在英文界面不能原样出现
  const TIME_KEYS = {
    '12:04': '12:04',
  };
  const sessionName = (s) => (s && (s.name || (s.nameKey ? t(s.nameKey) : ''))) || '?';
  const sessionLast = (s) => (s && s.lastKey ? t(s.lastKey) : (s && s.last) || '');
  const sessionTs = (s) => {
    if (!s) return '';
    if (s.ts) {
      if (s.id === 'g-1') return '12:04';
      return s.ts;
    }
    if (s.id === 'demo-1') return t('time.justNow') !== 'time.justNow' ? t('time.justNow') : (I18N.yuYan && I18N.yuYan.startsWith('en') ? 'Just now' : '刚刚');
    if (s.id === 'g-2') return t('time.yesterday') !== 'time.yesterday' ? t('time.yesterday') : (I18N.yuYan && I18N.yuYan.startsWith('en') ? 'Yesterday' : '昨天');
    if (s.id === 'g-3') return t('time.monday') !== 'time.monday' ? t('time.monday') : (I18N.yuYan && I18N.yuYan.startsWith('en') ? 'Mon' : '周一');
    if (s.id === 'c-1') return t('time.yesterday') !== 'time.yesterday' ? t('time.yesterday') : (I18N.yuYan && I18N.yuYan.startsWith('en') ? 'Yesterday' : '昨天');
    return '';
  };
  const GROUP_MEMBERS = { 'g-1': ['demo-agent', 'demo-2'], 'g-2': ['demo-agent'], 'g-3': ['demo-agent'] };
  const MSGS = {
    'demo-1': [
      { shui: 'them', key: 'demo.xiaoXi.hello' },
      { shui: 'wo', key: 'demo.xiaoXi.schedule' },
      { shui: 'them', key: 'demo.xiaoXi.scheduled' },
    ],
    'g-1': [
      { shui: 'sys', key: 'demo.xiaoXi.duty' },
      { shui: 'them', key: 'demo.xiaoXi.synced' },
      { shui: 'wo', key: 'demo.xiaoXi.urgent' },
    ],
    'g-2': [{ shui: 'them', key: 'demo.xiaoXi.rndUpdated' }],
    'g-3': [{ shui: 'sys', key: 'demo.xiaoXi.extSilent' }],
    'c-1': [
      { shui: 'them', key: 'demo.xiaoXi.weekly' },
      { shui: 'wo', key: 'demo.xiaoXi.weeklyOk' },
    ],
  };
  const KB_ENTRIES = [
    { id: 'kb-1', nameKey: 'kb.entryOrg', kindKey: 'kb.kind.project', summaryKey: 'kb.detailHint' },
    { id: 'kb-2', nameKey: 'kb.entryProject', kindKey: 'kb.kind.org', summaryKey: 'kb.detailHint' },
  ];
  const sessionOf = (id) => SESSIONS.filter((s) => s.id === id)[0];
  const instOf = (id) => INSTANCES.filter((i) => i.id === id || i.name === id || (i.nameKey && t(i.nameKey) === id))[0];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    tab: 'sessions',
    yuYan: I18N.yuYan || 'zh-CN',
    theme: 'light',
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#07c160',
    urgent: 'P2',
    providers: [
      { ming: 'DeepSeek', url: 'api.deepseek.com', key: '***', configured: true },
      { ming: 'Ollama', url: '127.0.0.1:11434', key: '', configured: false },
    ],
    smtp: { host: '', port: '465', user: '', pass: '', from: '' },
    mesh: { port: 59599, running: false, peers: 0 },
    notifyDone: true,
    notifyReq: true,
    notifyErr: true,
    boardTasks: [
      { id: 'bt-0', titleKey: 'panel.taskDemo.3', title: null, pct: 40 },
    ],
    lastToast: '',
  };

  // ── HSL 工具 ──
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function relLuminance(hex) {
    const ch = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrastWithWhite(hex) {
    return 1.05 / (relLuminance(hex) + 0.05);
  }

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

  // ── 通用片段 ──
  /** 头像：优先 preset SVG；无图时用 CSS 状态/首字点，绝不出现裸字母文本兜底 */
  const avHtml = (ming, preset, cls, status) => {
    const src = preset ? AV(preset) : null;
    const st = status || '';
    let inner;
    if (src) inner = '<img src="' + src + '" alt=""/>';
    else inner = '<span class="avDian" data-status="' + esc(st || 'idle') + '" aria-hidden="true"></span>';
    return '<div class="av ' + (cls || '') + '" data-has-img="' + (src ? '1' : '0') + '">' + inner + '</div>';
  };
  const statusDotHtml = (status) =>
    '<span class="zhuangTaiDian" data-status="' + esc(status || 'stopped') + '" aria-hidden="true"></span>';

  const noticeHtml = (key) => '<div class="notice">' + esc(t(key || 'preview.settingsNotice')) + '</div>';

  const barHtml = (biaoTi, fu, opts) => {
    const o = opts || {};
    const left = o.back
      ? '<button class="iconbtn back" data-act="back" aria-label="' + esc(t('tip.back')) + '" title="' + esc(t('tip.back')) + '">‹</button>'
      : '<div class="spacer"></div>';
    const you = o.more
      ? '<button class="iconbtn" data-act="more" aria-label="' + esc(t('tip.more')) + '" title="' + esc(t('tip.more')) + '"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
      : '<div class="spacer"></div>';
    return '<div class="tiao">' + left + '<div class="biaoTi">' + esc(biaoTi) + (fu ? '<small>' + esc(fu) + '</small>' : '') + '</div>' + you + '</div>';
  };
  const cellHtml = (biaoQian, value, act, attrs) => {
    return '<div class="cell"' + (act ? ' data-act="' + act + '"' : '') + (attrs || '') + '>' +
      '<span class="biaoQian">' + esc(biaoQian) + '</span>' +
      (value === undefined ? '' : '<span class="value">' + value + '</span>') +
      (act ? '<span class="jianTou">›</span>' : '') + '</div>';
  };

  function toast(xiaoXi) {
    state.lastToast = String(xiaoXi || '');
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = state.lastToast;
    el.classList.add('qiYong');
    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove('qiYong'), 2200);
  }

  // ── PC 端左侧导航图标 ──
  const NAV_INNER = {
    single: '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="34" r="12"/><path d="M14,78 C14,60 24,54 34,54 C40,54 45,56 49,60"/><rect x="58" y="26" width="24" height="24" rx="4"/><circle cx="70" cy="38" r="3" fill="currentColor"/><line x1="70" y1="26" x2="70" y2="18"/><circle cx="70" cy="16" r="3" fill="currentColor"/></g>',
    internal: '<path d="M50,14 A36,36 0 1,1 21,71" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M34,50 C30,38 42,38 50,50 C58,62 70,62 66,50 C62,38 50,38 50,50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
    contact: '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><circle cx="42" cy="34" r="14"/><path d="M18,82 C18,62 30,56 42,56 C48,56 53,58 57,62"/><path d="M68,32 C74,38 74,50 68,56"/><path d="M78,24 C88,36 88,52 78,64"/></g>',
    external: '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="34" r="12"/><path d="M16,78 C16,62 24,54 34,54 C44,54 52,62 52,78"/><circle cx="66" cy="34" r="12"/><path d="M48,78 C48,62 56,54 66,54 C76,54 84,62 84,78"/></g>',
  };
  const UNIFIED_AVATAR = { internal: 1, external: 1 };
  function navSvg(kind, cls) {
    const inner = NAV_INNER[kind];
    if (!inner) return '';
    return '<svg viewBox="0 0 100 100" class="' + (cls || '') + '" aria-hidden="true">' + inner + '</svg>';
  }

  const typeLabel = (kind) => t({ single: 'ui.type.single', internal: 'ui.type.internal', contact: 'ui.type.contact', external: 'ui.type.external' }[kind] || '');

  // ── 一级：四个 Tab ──
  function renderSessions() {
    const rows = SESSIONS.map((s) => {
      const inst = instOf(s.id);
      const nm = sessionName(s);
      let avWrap;
      if (UNIFIED_AVATAR[s.kind]) {
        avWrap = '<div class="avBaoGuo"><div class="av unified">' + navSvg(s.kind, 'nav-ic') + '</div></div>';
      } else {
        avWrap = '<div class="avBaoGuo">' + avHtml(nm, inst ? inst.preset : 0, '', inst ? inst.status : '') +
          '<span class="avHuiZhang">' + navSvg(s.kind, 'badge-ic') + '</span></div>';
      }
      return '<div class="hang" data-open="' + esc(s.id) + '">' + avWrap +
        '<div class="mid"><div class="n">' + esc(nm) + ' <span class="leiXingBiaoQian" data-kind="' + esc(s.kind) + '">' + esc(typeLabel(s.kind)) + '</span></div><div class="s">' + esc(sessionLast(s)) + '</div></div>' +
        '<div class="you"><div class="t">' + esc(sessionTs(s)) + '</div>' +
        (s.unread ? '<div class="huiZhang" title="' + esc(t('chat.tipBadge')) + '" aria-label="' + esc(t('chat.tipBadge')) + '">' + s.unread + '</div>' : '') + '</div></div>';
    }).join('');
    return barHtml(brandName()) +
      '<div class="ti">' + rows +
      '<div class="tiShi">' + esc(t('chat.systemNote')) + '</div></div>';
  }

  function renderCattle() {
    const rows = INSTANCES.map((i) => {
      return '<div class="hang" data-inst="' + esc(i.id) + '">' + avHtml(instName(i), i.preset, '', i.status) +
        '<div class="mid"><div class="n">' + esc(instName(i)) + '</div>' +
        '<div class="s">' + statusDotHtml(i.status) + esc(t('inst.status.' + i.status)) + ' · ' + esc(i.model) + '</div></div>' +
        '<div class="you"><span class="jianTou" style="color:var(--ink-dim)">›</span></div></div>';
    }).join('');
    return barHtml(t('cattle.biaoTi')) + '<div class="ti">' + rows + '</div>';
  }

  function renderBoard() {
    const tasks = state.boardTasks || [];
    const queueN = tasks.length;
    const stat = (biaoQian, n) => '<div class="cellbox"><span>' + esc(biaoQian) + '</span><b>' + n + '</b></div>';
    const prog = (ming, pct, note) =>
      '<div class="cell cellCompact"><span class="biaoQian">' + esc(ming) + (note ? ' <span class="jingYin" style="color:var(--ink-dim);font-size:12px">' + esc(note) + '</span>' : '') +
      '</span><span class="value">' + pct + '%</span></div>' +
      '<div style="padding:0 14px 8px"><div class="jinDu"><i style="width:' + pct + '%"></i></div></div>';
    const taskRows = tasks.map((task) => {
      const biaoTi = task.biaoTi || (task.titleKey ? t(task.titleKey) : '');
      return '<div class="cell cellCompact" data-task="' + esc(task.id) + '"><span class="biaoQian">' + esc(biaoTi) + '</span><span class="value">' + (task.pct || 0) + '%</span></div>';
    }).join('');
    return barHtml(t('board.biaoTi')) +
      '<div class="ti">' +
      '<div class="stats">' + stat(t('board.running'), 3) + stat(t('board.done'), 1) + stat(t('board.instances'), 1) + stat(t('board.queue'), queueN) + '</div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('board.addTask')) + '</div>' +
      '<div class="kanbanTianJia"><input id="kanbanRenwuShuRu" placeholder="' + esc(t('board.taskTitle')) + '" />' +
      '<button class="anNiuAccent" data-act="kanbanTianJia">' + esc(t('board.addBtn')) + '</button>' +
      '<button class="anNiuGhost" data-act="board-ai">' + esc(t('board.aiGenerate')) + '</button></div>' +
      '<div class="kaBiaoTi">' + esc(t('board.queueList')) + '</div>' +
      '<div id="kanbanRenwuLieBiao">' + (taskRows || '<div class="empty">' + esc(t('cp.empty')) + '</div>') + '</div>' +
      '</div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('board.jinDu')) + '</div>' +
      prog(demoName('demo.sess.g1', '项目推进群'), 65) + prog(demoName('demo.sess.g2', '研发排期'), 30, t('board.blocked')) + prog('demo.agent', 40) +
      '</div><div class="tiShi">' + esc(t('board.readonlyHint')) + '</div></div>';
  }

  /**
   * 组网端口（真值来自 state.mesh，默认与桌面端 settings-store 的
   * WARMY_DEFAULT_NET_PORT 对齐 = 59599）。
   * ⚠️ 旧的 7788 是**已退休**的约定端口，不许再出现在移动端；
   * 端口在桌面端「设置 → 组网」可改，手机端只是外观预览（不假装在监听）。
   */
  const MESH_DEFAULT_PORT = 59599;
  function meshPort() {
    const p = Number((state.mesh && state.mesh.port) || 0);
    return Number.isFinite(p) && p > 0 ? p : MESH_DEFAULT_PORT;
  }
  /** 组网开关文案（与桌面端同一套键：net.switchOn/net.switchOff） */
  function meshSwitchText() {
    const qiYong = !!(state.mesh && state.mesh.running);
    return String(qiYong ? t('net.switchOn') : t('net.switchOff')).replace('{port}', String(meshPort()));
  }

  function renderMe() {
    return barHtml(t('wo.biaoTi')) +
      '<div class="ti">' +
      '<div class="woHead">' + avHtml(t('wo.owner'), 1) +
      '<div class="shui"><div class="n">' + esc(t('wo.owner')) + '</div><div class="m">ID: 884024787 · ' + esc(brandName()) + '</div></div></div>' +
      noticeHtml() +
      '<div class="ka">' +
      cellHtml(t('wo.appearance'), '', 'set-appearance') +
      cellHtml(t('wo.provider'), esc(t('provider.configured')), 'set-provider') +
      cellHtml(t('wo.smtp'), esc(t('wo.notConfiguredHint')), 'set-smtp') +
      cellHtml(t('wo.mesh'), String(meshPort()), 'set-mesh') +
      cellHtml(t('wo.about'), '0.1.0', 'set-about') +
      '</div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('wo.settings')) + '</div>' +
      cellHtml(t('wo.models'), esc(t('wo.desktopOnly')), 'act-models') +
      cellHtml(t('wo.skills'), esc(t('wo.desktopOnly')), 'act-skills') +
      cellHtml(t('wo.cleanup'), esc(t('wo.desktopOnly')), 'act-cleanup') +
      cellHtml(t('wo.updates'), esc(t('wo.desktopOnly')), 'act-updates') +
      '</div></div>';
  }

  const TABS = [
    { id: 'sessions', biaoQian: 'tab.sessions', svg: '<path d="M4 4h16v11H8l-4 4V4z"/>' },
    { id: 'cattle', biaoQian: 'tab.cattle', svg: '<path d="M12 4a4 4 0 014 4v1h1v9H7v-9h1V8a4 4 0 014-4zm-6 6a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z"/>' },
    { id: 'board', biaoQian: 'tab.board', svg: '<path d="M4 4h7v7H4V4zm9 0h7v4h-7V4zM4 13h7v7H4v-7zm9 2h7v5h-7v-5z"/>' },
    { id: 'wo', biaoQian: 'tab.wo', svg: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-5 0-8 2.5-8 5v1h16v-1c0-2.5-3-5-8-5z"/>' },
  ];
  function renderTabs() {
    return TABS.map((x) => {
      const biaoQian = t(x.biaoQian);
      return '<button data-tab="' + x.id + '" class="' + (state.tab === x.id ? 'qiYong' : '') + '"' +
        ' aria-label="' + esc(biaoQian) + '" title="' + esc(biaoQian) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + x.svg + '</svg>' + esc(biaoQian) + '</button>';
    }).join('');
  }

  const TAB_RENDER = { sessions: renderSessions, cattle: renderCattle, board: renderBoard, wo: renderMe };

  function renderTab() {
    $('#tabsHost').innerHTML = '<section class="tab-page qiYong">' + TAB_RENDER[state.tab]() + '</section>';
    $('#tabs').innerHTML = renderTabs();
  }

  // ── 二级/三级页面（滑入 + 返回）──
  const stack = [];
  function pageShell(inner) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = inner;
    $('#pageHost').appendChild(el);
    requestAnimationFrame(() => el.classList.add('qiYong'));
    return el;
  }
  function pop() {
    const el = stack.pop();
    if (!el) return;
    el.classList.remove('qiYong');
    setTimeout(() => el.remove(), 240);
  }
  function push(inner) {
    const el = pageShell(inner);
    stack.push(el);
    return el;
  }
  function wirePage(el, handlers) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'back') { pop(); return; }
      if (handlers && handlers[act]) handlers[act](b);
    });
  }

  // 聊天页
  function openChat(id) {
    const s = sessionOf(id) || { id: id, ming: id, kind: 'internal' };
    const nm = sessionName(s);
    const xiaoXi = MSGS[id] || [];
    const ti = xiaoXi.map((m) => {
      const text = m.key ? t(m.key) : m.text;
      if (m.shui === 'sys') return '<div class="xiaoXiHang"><span class="sys">' + esc(text) + '</span></div>';
      const wo = m.shui === 'wo';
      const inst = wo ? null : instOf(id);
      const av = wo ? avHtml(t('wo.owner'), 1) : inst ? avHtml(instName(inst), inst.preset, '', inst.status) : avHtml(nm, 0);
      return '<div class="xiaoXi' + (wo ? ' wo' : '') + '">' + av + '<div class="bubble">' + esc(text) + '</div></div>';
    }).join('');
    const inner =
      barHtml(nm, s.kind === 'single' ? t('chat.fu.single') : t('chat.fu.group'), { back: true, more: true }) +
      '<div class="ti liaoTianTi"><div class="xiaoXi" id="xiaoXi">' + ti + '</div></div>' +
      '<div class="shuRuQu"><textarea id="shuRu" rows="1" placeholder="' + esc(t('m.chat.placeholder')) + '"></textarea>' +
      '<button class="faSong" id="faSong" disabled>' + esc(t('chat.faSong')) + '</button></div>';
    const el = push(inner);
    wirePage(el, {
      more: () => openSheet([
        { biaoQian: t('chat.members'), act: 'p-members', id: id },
        { biaoQian: t('chat.model'), act: 'p-model', id: id },
        { biaoQian: t('chat.kb'), act: 'p-kb', id: id },
        { biaoQian: t('chat.checkpoints'), act: 'p-cp', id: id },
        { biaoQian: t('chat.metrics'), act: 'p-metrics', id: id },
        { biaoQian: t('chat.export'), act: 'p-export', id: id },
      ]),
    });
    const ta = $('#shuRu', el);
    const faSong = $('#faSong', el);
    const sync = () => { faSong.disabled = !ta.value.trim(); };
    ta.addEventListener('input', sync);
    faSong.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      const d = document.createElement('div');
      d.className = 'xiaoXi wo';
      d.innerHTML = avHtml(t('wo.owner'), 1) + '<div class="bubble">' + esc(v) + '</div>';
      $('#xiaoXi', el).appendChild(d);
      ta.value = ''; sync();
      $('#xiaoXi', el).scrollTop = $('#xiaoXi', el).scrollHeight;
    });
  }

  // 实例详情（含启动/停止/重启，状态真变）
  function openInstance(id) {
    const i = instOf(id);
    if (!i) return;
    const chip = (m) => '<span style="display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:99px;padding:3px 9px;margin:3px 6px 3px 0;font-size:12px">' + esc(m) + '</span>';
    const persona = i.personaKey ? t(i.personaKey) : (i.persona || '');
    const inner = barHtml(instName(i), t('inst.status.' + i.status), { back: true }) +
      '<div class="ti" data-inst-page="' + esc(i.id) + '">' +
      '<div class="woHead">' + avHtml(instName(i), i.preset, '', i.status) +
      '<div class="shui"><div class="n">' + esc(instName(i)) + '</div><div class="m" data-inst-status>' + statusDotHtml(i.status) + esc(t('inst.status.' + i.status)) + '</div></div></div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.defaultModel')) + '</div>' +
      cellHtml(disp(i.model)) + '</div>' +
      '<div class="ka shiLiDongZuoJi">' +
      '<button class="anNiuAccent" data-act="inst-start" data-id="' + esc(i.id) + '">' + esc(t('inst.start')) + '</button>' +
      '<button class="anNiuGhost" data-act="inst-stop" data-id="' + esc(i.id) + '">' + esc(t('inst.stop')) + '</button>' +
      '<button class="anNiuGhost" data-act="inst-restart" data-id="' + esc(i.id) + '">' + esc(t('inst.restart')) + '</button>' +
      '</div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.models')) + '</div>' +
      '<div style="padding:10px 14px 14px">' + i.models.map(chip).join('') + '</div></div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.chain')) + '</div>' +
      i.chain.map((m, k) => cellHtml((k + 1) + '. ' + m)).join('') + '</div>' +
      '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.persona')) + '</div>' +
      '<div style="padding:12px 14px;white-space:pre-wrap;font-size:14px">' + esc(persona || '—') + '</div></div>' +
      '<div class="tiShi">' + esc(t('chat.systemNote')) + '</div></div>';
    const el = push(inner);
    wirePage(el, {
      'inst-start': () => applyInstStatus(i, 'running'),
      'inst-stop': () => applyInstStatus(i, 'stopped'),
      'inst-restart': () => applyInstStatus(i, 'running', true),
    });
  }
  function applyInstStatus(i, next, isRestart) {
    i.status = next;
    if (isRestart) toast(t('inst.status.restarting') + ' → ' + t('inst.status.' + next));
    else toast(t('inst.actionDone') + ': ' + t('inst.status.' + next));
    // 就地更新当前页状态文字/圆点，不整页重绘导致闪烁
    const page = stack[stack.length - 1];
    if (page) {
      const slot = page.querySelector('[data-inst-status]');
      if (slot) slot.innerHTML = statusDotHtml(next) + esc(t('inst.status.' + next));
      const titleSub = page.querySelector('.tiao .biaoTi small');
      if (titleSub) titleSub.textContent = t('inst.status.' + next);
    }
  }

  // 聊天「…」里的六个面板（三级）
  function openPanel(kind, id) {
    const s = sessionOf(id) || { ming: id, id: id };
    const sName = sessionName(s);
    let biaoTi = '', bodyHtml = '';
    if (kind === 'members') {
      biaoTi = t('chat.members');
      const names = (GROUP_MEMBERS[id] || [id]).map((mid) => {
        const inst = instOf(mid);
        return { ming: inst ? instName(inst) : mid, inst: inst };
      });
      bodyHtml = '<div class="ka">' + names.map((n) => {
        const inst = n.inst;
        return '<div class="hang" data-inst="' + esc(inst ? inst.id : n.name) + '">' +
          avHtml(n.name, inst ? inst.preset : 0, '', inst ? inst.status : '') +
          '<div class="mid"><div class="n">' + esc(n.name) + '</div><div class="s">' + esc(inst ? disp(inst.model) : '—') + '</div></div></div>';
      }).join('') + '</div>';
    } else if (kind === 'model') {
      biaoTi = t('chat.model');
      const inst = instOf(id) || INSTANCES[0];
      const chip = (m) => '<span style="display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:99px;padding:3px 9px;margin:3px 6px 3px 0;font-size:12px">' + esc(m) + '</span>';
      bodyHtml = '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.defaultModel')) + '</div>' + cellHtml(disp(inst.model)) + '</div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.models')) + '</div><div style="padding:10px 14px 14px">' + inst.models.map(chip).join('') + '</div></div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('inst.chain')) + '</div>' + inst.chain.map((m, k) => cellHtml((k + 1) + '. ' + m)).join('') + '</div>';
    } else if (kind === 'kb') {
      biaoTi = t('chat.kb');
      const rows = KB_ENTRIES.map((e) =>
        cellHtml(t(e.mingKey), esc(t(e.kindKey)), 'kb-open', ' data-kb="' + esc(e.id) + '"')
      ).join('');
      bodyHtml = '<div class="ka"><div style="padding:12px 14px"><input id="zhiShiKuQ" placeholder="' + esc(t('kb.tiShi')) + '" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit"/></div></div>' +
        '<div class="ka" id="zhiShiKuLieBiao">' + rows + '</div>';
    } else if (kind === 'cp') {
      biaoTi = t('chat.checkpoints');
      bodyHtml = '<div class="ka">' + cellHtml(t('time.justNow') !== 'time.justNow' ? t('time.justNow') : '12:04', '65%') + cellHtml(t('time.yesterday') !== 'time.yesterday' ? t('time.yesterday') : '18:20', '30%') + '</div>' +
        '<div class="tiShi">' + esc(t('cp.rollbackHint')) + '</div>';
    } else if (kind === 'metrics') {
      biaoTi = t('chat.metrics');
      bodyHtml = '<div class="stats"><div class="cellbox"><span>' + esc(t('metrics.turns')) + '</span><b>3</b></div>' +
        '<div class="cellbox"><span>' + esc(t('metrics.cost')) + '</span><b>0.029</b></div></div>' +
        '<div class="ka">' + cellHtml('cache', '32%') + cellHtml('ccr', '90%') + cellHtml('avg', '2400ms') + '</div>';
    } else {
      biaoTi = t('chat.export');
      bodyHtml = '<div class="ka">' + cellHtml(t('export.markdown'), '.md') + cellHtml(t('export.hasTs'), t('common.yes')) + '</div>' +
        '<div class="tiShi">' + esc(t('export.tiShi')) + '</div>';
    }
    const el = push(barHtml(biaoTi, sName, { back: true }) + '<div class="ti" data-panel="' + esc(kind) + '">' + bodyHtml + '</div>');
    if (kind === 'kb') {
      wirePage(el, {
        'kb-open': (b) => openKbDetail(b.dataset.kb),
      });
    }
  }

  function openKbDetail(kbId) {
    const e = KB_ENTRIES.filter((x) => x.id === kbId)[0] || KB_ENTRIES[0];
    const inner = barHtml(t(e.mingKey), t(e.kindKey), { back: true }) +
      '<div class="ti"><div class="ka"><div class="kaBiaoTi">' + esc(t('kb.detail')) + '</div>' +
      cellHtml(t(e.mingKey), esc(t(e.kindKey))) +
      '<div style="padding:12px 14px;font-size:14px;line-height:1.6">' + esc(t(e.summaryKey)) + '</div>' +
      '</div><div class="tiShi">' + esc(t('chat.systemNote')) + '</div></div>';
    push(inner);
  }

  function openDesktopOnly(kind) {
    // 'diag'（卡顿自检）已退休：桌面端入口整块移除，移动端这条悬空入口也随之删掉。
    const labelKey = { models: 'wo.models', skills: 'wo.skills', cleanup: 'wo.cleanup', updates: 'wo.updates' }[kind] || 'wo.settings';
    const inner = barHtml(t(labelKey), '', { back: true }) +
      '<div class="ti"><div class="notice">' + esc(t('wo.desktopOnly')) + '</div>' +
      '<div class="ka">' + cellHtml(t(labelKey), esc(t('wo.desktopOnly'))) + '</div></div>';
    push(inner);
  }

  // 设置分组（三级）
  function openSetting(group) {
    const map = {
      appearance: t('wo.appearance'),
      provider: t('wo.provider'),
      smtp: t('wo.smtp'),
      mesh: t('wo.mesh'),
      about: t('wo.about'),
    };
    let ti = '';
    const flatColors = accentPalette();
    const swatchHtml = flatColors.map((c) => '<button data-color="' + c + '" style="width:100%;aspect-ratio:1;border-radius:50%;background:' + c + ';border:2px solid ' + (c === state.accent ? 'var(--ink)' : 'transparent') + ';cursor:pointer;padding:0"></button>').join('');

    if (group === 'appearance') {
      ti = '<div class="ka"><div class="kaBiaoTi">' + esc(t('wo.language')) + '</div>' +
        cellHtml(t('settings.localeZh'), state.yuYan === 'zh-CN' ? '✓' : '', 'lang-zh') +
        cellHtml(t('settings.localeEn'), state.yuYan === 'en-US' ? '✓' : '', 'lang-en') + '</div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('wo.theme')) + '</div>' +
        cellHtml(t('wo.light'), state.theme === 'light' ? '✓' : '', 'theme-light') +
        cellHtml(t('wo.dark'), state.theme === 'dark' ? '✓' : '', 'theme-dark') +
        cellHtml(t('wo.system'), state.theme === 'system' ? '✓' : '', 'theme-system') + '</div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('wo.accent')) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(17,1fr);gap:5px;padding:10px 14px">' + swatchHtml + '</div>' +
        '<div style="padding:0 14px 12px;text-align:center"><button data-act="custom-color" style="font-size:13px;color:var(--accent);background:none;border:none;cursor:pointer">' + esc(t('accent.custom')) + ' ›</button></div>' +
        '</div>';
    } else if (group === 'provider') {
      const rows = state.providers || [];
      ti = '<div class="ka"><div class="kaBiaoTi">' + esc(t('provider.list')) + '</div>' +
        rows.map((p, i) => '<div class="cell" data-edit-prov="' + i + '"><span class="biaoQian">' + esc(p.name) + '</span><span class="value">' + esc(p.configured ? t('provider.configured') : t('provider.notConfigured')) + '</span><span class="jianTou">›</span></div>').join('') +
        '<div class="cell" data-act="add-provider"><span class="biaoQian" style="color:var(--accent)">' + esc(t('provider.add')) + '</span></div>' +
        '</div>';
    } else if (group === 'smtp') {
      const smtp = state.smtp || { host: '', port: '465', user: '', pass: '', from: '' };
      ti = '<div class="ka"><div class="kaBiaoTi">' + esc(t('smtp.settings')) + '</div>' +
        '<div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px">' +
        '<label style="font-size:13px">' + esc(t('smtp.hostLabel')) + '<input id="smtpHost" value="' + esc(smtp.host) + '" placeholder="smtp.example.com" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.portLabel')) + '<input id="smtpDuanKou" value="' + esc(smtp.port) + '" placeholder="465" type="number" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.userLabel')) + '<input id="smtpUser" value="' + esc(smtp.user) + '" placeholder="your@email.com" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.passLabel')) + '<input id="smtpPass" value="" type="password" placeholder="' + esc(t('smtp.passPlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.fromLabel')) + '<input id="smtpCong" value="' + esc(smtp.from) + '" placeholder="' + esc(t('smtp.fromPlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '</div><div style="padding:0 14px 12px"><button data-act="verify-smtp" class="anNiuZhuYao" style="width:100%;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer">' + esc(t('smtp.verifyBtn')) + '</button></div></div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('notify.biaoTi')) + '</div>' +
        cellHtml(t('notify.done'), state.notifyDone ? '✓' : '', 'notify-done') +
        cellHtml(t('notify.req'), state.notifyReq ? '✓' : '', 'notify-req') +
        cellHtml(t('notify.err'), state.notifyErr ? '✓' : '', 'notify-err') + '</div>';
    } else if (group === 'mesh') {
      // 组网（新概念）：沿用桌面端的键与语义 —— 组网开关 + 监听端口 + 已知节点 + 邀请入口。
      // 旧「内网同步 / 多节点组网」块已退休：这里不再有 mesh.addPeer/remove/broadcast 那套多节点面板文案。
      const mesh = state.mesh || { port: MESH_DEFAULT_PORT, running: false, peers: 0 };
      ti = '<div class="ka"><div class="kaBiaoTi">' + esc(t('mesh.biaoTi')) + '</div>' +
        cellHtml(t('mesh.portLabel'), String(meshPort())) +
        cellHtml(t('mesh.stateLabel'), esc(meshSwitchText())) +
        cellHtml(t('mesh.peers'), String(mesh.peers)) +
        '<div style="padding:10px 14px 12px"><button data-act="toggle-mesh" style="width:100%;padding:10px;border:none;border-radius:8px;background:' + (mesh.running ? 'var(--danger)' : 'var(--accent)') + ';color:#fff;font:inherit;cursor:pointer">' + (mesh.running ? esc(t('mesh.stop')) : esc(t('mesh.start'))) + '</button></div>' +
        '</div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('mesh.invite')) + '</div>' +
        cellHtml(t('mesh.genInvite'), '', 'gen-invite') +
        cellHtml(t('mesh.scanJoin'), '', 'scan-invite') + '</div>';
    } else {
      ti = '<div class="ka"><div class="kaBiaoTi">' + esc(t('wo.about')) + '</div>' +
        cellHtml(t('wo.version'), 'v0.1.0') +
        cellHtml(t('wo.checkUpdate'), esc(t('wo.checkUpdate')), 'check-update') +
        cellHtml('Electron', '33.2.0') +
        cellHtml('Chromium', '130.0.6723.191') +
        cellHtml('Node.js', '24.20.0') + '</div>' +
        '<div class="ka"><div class="kaBiaoTi">' + esc(t('about.opensource')) + '</div>' +
        cellHtml(t('about.license'), 'MIT') +
        cellHtml(t('about.author'), 'Pondsi') +
        cellHtml(t('wo.copyright'), '© 2026 Pondsi') +
        cellHtml(t('wo.deviceId'), '884024787') + '</div>';
    }
    const el = push(barHtml(map[group], '', { back: true }) + '<div class="ti">' + noticeHtml() + ti + '</div>');
    el.querySelectorAll('[data-color]').forEach((b) => {
      b.addEventListener('click', () => {
        state.accent = b.dataset.color;
        document.documentElement.style.setProperty('--accent', state.accent);
        document.documentElement.style.setProperty('--me-bubble', state.accent);
        // 就地刷新外观页（先弹掉再打开保持栈深度稳定）
        pop();
        setTimeout(() => openSetting('appearance'), 30);
      });
    });
    ['smtpHost', 'smtpDuanKou', 'smtpUser', 'smtpPass', 'smtpCong'].forEach((id) => {
      const inp = el.querySelector('#' + id);
      if (inp) inp.addEventListener('change', () => {
        const key = id.replace('smtp-', '');
        state.smtp[key] = inp.value;
      });
    });
    wirePage(el, {
      'lang-zh': () => setLocale('zh-CN'),
      'lang-en': () => setLocale('en-US'),
      'theme-light': () => setTheme('light'),
      'theme-dark': () => setTheme('dark'),
      'theme-system': () => setTheme('system'),
      'custom-color': () => {
        const inp = document.createElement('input');
        inp.type = 'color'; inp.value = state.accent;
        inp.onchange = () => { state.accent = inp.value; document.documentElement.style.setProperty('--accent', state.accent); document.documentElement.style.setProperty('--me-bubble', state.accent); pop(); setTimeout(() => openSetting('appearance'), 30); };
        inp.click();
      },
      'verify-smtp': () => { toast(t('xiaoXi.smtpDesktopOnly')); },
      'toggle-mesh': () => {
        state.mesh.running = !state.mesh.running;
        pop();
        setTimeout(() => openSetting('mesh'), 30);
      },
      'notify-done': () => { state.notifyDone = !state.notifyDone; pop(); setTimeout(() => openSetting('smtp'), 30); },
      'notify-req': () => { state.notifyReq = !state.notifyReq; pop(); setTimeout(() => openSetting('smtp'), 30); },
      'notify-err': () => { state.notifyErr = !state.notifyErr; pop(); setTimeout(() => openSetting('smtp'), 30); },
      'add-provider': () => {
        const ming = prompt(t('prompt.providerName'));
        if (ming) {
          state.providers.push({ ming, url: '', key: '', configured: false });
          pop();
          setTimeout(() => openSetting('provider'), 30);
        }
      },
      'check-update': () => toast(t('xiaoXi.latest') + ' v0.1.0'),
      'gen-invite': () => toast(t('xiaoXi.inviteCopied')),
      'scan-invite': () => toast(t('xiaoXi.scanOnDesktop')),
    });
    el.querySelectorAll('[data-edit-prov]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.editProv);
        const p = state.providers[idx];
        if (!p) return;
        const url = prompt('Base URL', p.url);
        if (url !== null) { p.url = url; p.configured = !!url; }
        pop();
        setTimeout(() => openSetting('provider'), 30);
      });
    });
  }

  // ── 底部动作面板（「…」）──
  function openSheet(items) {
    closeSheet();
    const mask = $('#mask');
    const sheet = $('#sheet');
    sheet.innerHTML = '<div class="sheetBiaoTi">' + esc(brandName()) + '</div>' +
      items.map((x) => '<button type="button" data-sheet="' + esc(x.act) + '" data-id="' + esc(x.id || '') + '">' + esc(x.biaoQian) + '</button>').join('') +
      '<button type="button" class="cancel" data-sheet="__cancel">' + esc(t('chat.cancel')) + '</button>';
    mask.classList.add('qiYong');
    requestAnimationFrame(() => sheet.classList.add('qiYong'));
    mask.onclick = closeSheet;
    // 每条单独绑，避免 closest 委托在部分触摸实现里 target 漂移
    sheet.querySelectorAll('[data-sheet]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const act = b.dataset.sheet;
        const id = b.dataset.id;
        closeSheet();
        if (act === '__cancel') return;
        const kind = { 'p-members': 'members', 'p-model': 'model', 'p-kb': 'kb', 'p-cp': 'cp', 'p-metrics': 'metrics', 'p-export': 'export' }[act];
        if (kind) openPanel(kind, id);
      });
    });
  }
  function closeSheet() {
    const mask = $('#mask');
    const sheet = $('#sheet');
    if (mask) mask.classList.remove('qiYong');
    if (sheet) {
      sheet.classList.remove('qiYong');
      // 清空内容：否则切换语言后 sheet 里仍残留上一语言的 innerText（英文界面扫到中文）
      sheet.innerHTML = '';
    }
  }

  // ── 语言 / 主题 ──
  function popAll() {
    while (stack.length) pop();
  }
  function setLocale(loc) {
    state.yuYan = loc;
    const pack = (window.__I18N_ALL__ || {})[loc];
    if (pack) {
      I18N.strings = pack;
      I18N.yuYan = loc;
    }
    document.documentElement.lang = loc;
    document.title = brandName() + ' ' + t('brand.fu');
    closeSheet();
    popAll();
    renderTab();
    openSetting('appearance');
  }
  function setTheme(mode) {
    state.theme = mode;
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    closeSheet();
    popAll();
    openSetting('appearance');
  }

  function boardAddTask(biaoTi) {
    const v = String(biaoTi || '').trim();
    if (!v) return false;
    state.boardTasks.push({ id: 'bt-' + Date.now(), title: v, pct: 0 });
    return true;
  }

  // ── 事件绑定（一级）──
  function bindGlobal() {
    const phone = $('#phone');
    phone.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        popAll();
        closeSheet();
        renderTab();
        return;
      }
      const hang = e.target.closest('[data-open]');
      if (hang) { openChat(hang.dataset.daKai); return; }
      const inst = e.target.closest('[data-inst]');
      if (inst) { openInstance(inst.dataset.inst); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act.indexOf('set-') === 0) { openSetting(act.slice(4)); return; }
      if (act.indexOf('act-') === 0) { openDesktopOnly(act.slice(4)); return; }
      if (act === 'back') { pop(); return; }
      if (act === 'kanbanTianJia') {
        const inp = $('#kanbanRenwuShuRu');
        const ok = boardAddTask(inp ? inp.value : '');
        if (ok) { toast(t('board.added')); renderTab(); }
        return;
      }
      if (act === 'board-ai') {
        toast(t('board.aiNotReady'));
        return;
      }
    });
  }

  /** 审计探针：__MOBILE_I18N_AUDIT__ — 供 verify-mobile-ui 读取 */
  function collectAudit() {
    const all = window.__I18N_ALL__ || {};
    const zh = all['zh-CN'] || {};
    const en = all['en-US'] || {};
    const pack = I18N.strings || {};
    const used = new Set();
    $$('[data-i18n]').forEach((el) => used.add(el.getAttribute('data-i18n')));
    // 扫描可见文本里的 D 键命中情况
    const visible = ($('#phone') && $('#phone').innerText) || '';
    const allowCjkInEn = ['yingYong.zhName', 'settings.localeZh', 'about.copyrightBody', 'llm.toolRecallDesc'];
    const zhKeys = Object.keys(zh);
    const enKeys = Object.keys(en);
    const missingInPack = zhKeys.filter((k) => !pack[k] && !D[k]);
    return {
      yuYan: state.yuYan,
      localeDoc: document.documentElement.lang,
      zhCount: zhKeys.length,
      enCount: enKeys.length,
      keyAligned: zhKeys.length === enKeys.length && zhKeys.every((k) => k in en) && enKeys.every((k) => k in zh),
      usedKeys: [...used],
      missingInPack: missingInPack.slice(0, 50),
      visibleSample: visible.slice(0, 800),
      hasStaticViews: $$('#tabsHost section.tab-page').length === 1 && $('#pageHost') !== null,
      stackDepth: stack.length,
      toast: state.lastToast,
      boardTaskCount: (state.boardTasks || []).length,
      allowCjkInEn,
      probeVersion: 1,
    };
  }

  function init() {
    try {
      renderTab();
      bindGlobal();
      document.title = brandName() + ' ' + t('brand.fu');
      window.__MOBILE_I18N_AUDIT__ = collectAudit;
    } catch (e) {
      document.body.innerHTML =
        '<pre style="padding:16px;font-size:12px;color:#c00;white-space:pre-wrap">' + esc(t('xiaoXi.initFailed')) + String((e && e.message) || e) + '</pre>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.__MOBILE__ = {
    state: state,
    openChat: openChat,
    openInstance: openInstance,
    openPanel: openPanel,
    openSetting: openSetting,
    openSheet: openSheet,
    openKbDetail: openKbDetail,
    openDesktopOnly: openDesktopOnly,
    setLocale: setLocale,
    setTheme: setTheme,
    popAll: popAll,
    closeSheet: closeSheet,
    boardAddTask: boardAddTask,
    collectAudit: collectAudit,
    t: t,
  };
})();
