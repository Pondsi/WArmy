/* CCArmy 移动端 — 单列 + 底部 Tab + 下钻返回
   规则：
   - 一级导航只走底部 Tab（会话 / 牛马 / 看板 / 我）
   - 二级、三级页面从右侧滑入，顶部一定有「‹ 返回」
   - 聊天右侧的成员/模型/知识库/回退点/指标/导出，统一收进聊天顶部「…」的底部面板
*/
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  // ── i18n：单文件构建时会把语言包注入 window.__I18N__ ──
  const I18N = window.__I18N__ || { locale: 'zh-CN', strings: {} };
  const D = {
    'brand.name': '无限牛马',
    'brand.sub': 'CCArmy（Corporate Cattle Army）',
    'tab.sessions': '会话', 'tab.cattle': '牛马', 'tab.board': '看板', 'tab.me': '我',
    'sessions.title': '会话',
    'cattle.title': '牛马',
    'board.title': '看板', 'board.running': '进行中', 'board.done': '今日完成',
    'board.instances': '运行实例', 'board.queue': '排队', 'board.progress': '会话进展',
    'me.title': '我', 'me.settings': '设置', 'me.appearance': '外观', 'me.provider': '模型供应商',
    'me.smtp': '邮箱 SMTP', 'me.mesh': '多节点组网', 'me.about': '关于',
    'me.language': '语言', 'me.theme': '主题', 'me.accent': '主题色',
    'me.light': '浅色', 'me.dark': '深色', 'me.system': '跟随系统',
    'me.version': '版本', 'me.checkUpdate': '检查更新', 'me.opensource': '开源信息',
    'me.copyright': '版权', 'me.deviceId': '设备 ID', 'me.owner': '主人',
    'chat.placeholder': '输入消息', 'm.chat.placeholder': '输入消息', 'chat.send': '发送', 'chat.more': '更多',
    'chat.members': '成员', 'chat.model': '模型管理', 'chat.kb': '知识库',
    'chat.checkpoints': '回退点', 'chat.metrics': '性能指标', 'chat.export': '导出会话',
    'chat.urgent': '加急', 'chat.insert': '插入', 'chat.queue': '排队',
    'chat.cancel': '取消', 'chat.systemNote': '手机端为外观预览；编排在桌面端完成。',
    'inst.status.running': '运行中', 'inst.status.stopped': '已停止',
    'inst.defaultModel': '默认模型', 'inst.models': '可用模型', 'inst.chain': '调用链',
    'inst.persona': '写入更多', 'inst.group': '成员',
    'kb.hint': '输入关键词检索知识库', 'cp.empty': '暂无回退点', 'cp.rollback': '回退', 'cp.rollbackHint': '回退：将停止当前任务并回到该节点。',
    'metrics.turns': '轮次', 'metrics.cost': '成本(¥)',

    'common.yes': '是',
    'ui.type.single': '牛马', 'ui.type.internal': '项目', 'ui.type.contact': '联系人', 'ui.type.external': '群聊',
    'board.blocked': '阻塞', 'board.readonlyHint': '看板为只读聚合视图，修改请通过与值班者对话完成。',
    'chat.sub.single': '我的牛马', 'chat.sub.group': '群聊',
    'export.hasTs': '包含时间戳', 'accent.custom': '自定义取色',
    'provider.list': '供应商列表', 'provider.add': '+ 添加供应商', 'provider.configured': '已配置', 'provider.notConfigured': '未配置',
    'smtp.settings': '邮箱 SMTP 设置', 'smtp.hostLabel': 'SMTP 服务器', 'smtp.portLabel': '端口', 'smtp.userLabel': '用户名',
    'smtp.passLabel': '授权码', 'smtp.passPlaceholder': '输入授权码', 'smtp.fromLabel': '发件人名称', 'smtp.fromPlaceholder': '无限牛马通知', 'smtp.verifyBtn': '验证并保存',
    'notify.title': '邮件通知', 'notify.done': '完成通知', 'notify.req': '请求通知', 'notify.err': '错误通知',
    'mesh.portLabel': '监听端口', 'mesh.stateLabel': '状态', 'mesh.peers': '已连接节点', 'mesh.start': '启动组网', 'mesh.stop': '停止组网',
    'mesh.stopped': '未启动', 'mesh.invite': '邀请加入', 'mesh.genInvite': '生成邀请码', 'mesh.scanJoin': '扫码加入',
    'about.license': '许可证',
    'msg.initFailed': '移动端初始化失败：', 'msg.smtpDesktopOnly': 'SMTP 验证需要桌面端配合，手机端仅作界面预览。', 'prompt.providerName': '供应商名称',
    'msg.latest': '当前已是最新版本', 'msg.inviteCopied': '邀请码已复制到剪贴板', 'msg.scanOnDesktop': '请使用桌面端扫码功能', 'export.hint': '导出当前会话为 Markdown',
  };
  const t = (k) => (I18N.strings && I18N.strings[k]) || D[k] || k;
  const brandName = () => t('brand.name');

  // ── 演示数据（单文件预览用）──
  const AV = (n) => {
    const set = window.__AVATARS__ || {};
    return set['preset-' + n] || null;
  };
  const INSTANCES = [
    { id: 'demo-1', name: 'demo.agent', status: 'running', model: 'deepseek-chat', preset: 5,
      models: ['deepseek-chat', 'deepseek-reasoner', 'mimo-v2.5-pro'],
      chain: ['deepseek-chat', 'deepseek-reasoner'], persona: '性格：沉稳可靠\n角色：值班执行者' },
    { id: 'demo-2', name: '归档员', status: 'stopped', model: 'mimo-v2.5-pro', preset: 9,
      models: ['mimo-v2.5-pro'], chain: ['mimo-v2.5-pro'], persona: '' },
  ];
  const SESSIONS = [
    { id: 'demo-1', name: 'demo.agent', kind: 'single', last: '好的，已安排周三评审', ts: '刚刚', unread: 1 },
    { id: 'g-1', name: '项目推进群', kind: 'internal', last: '值班者：排期已同步', ts: '12:04', unread: 2 },
    { id: 'g-2', name: '研发排期', kind: 'internal', last: '排期表已更新', ts: '昨天' },
    { id: 'g-3', name: '客户对接群', kind: 'external', last: '仅 @ 时响应', ts: '周一' },
  ];
  const GROUP_MEMBERS = { 'g-1': ['demo.agent', '归档员'], 'g-2': ['demo.agent'], 'g-3': ['demo.agent'] };
  const MSGS = {
    'demo-1': [
      { who: 'them', text: '你好，我是无限牛马。手机端可查看会话、牛马与看板。' },
      { who: 'me', text: '看一下今天的排期' },
      { who: 'them', text: '已安排在周三评审，两位成员都收到通知了。' },
    ],
    'g-1': [
      { who: 'sys', text: '值班者：demo.agent 已接管本群' },
      { who: 'them', text: '排期已同步到看板。' },
      { who: 'me', text: '好，加急处理一下客户那条。' },
    ],
    'g-2': [{ who: 'them', text: '排期表已更新。' }],
    'g-3': [{ who: 'sys', text: '外部群默认静默，@ 后才回复' }],
  };
  const sessionOf = (id) => SESSIONS.filter((s) => s.id === id)[0];
  const instOf = (id) => INSTANCES.filter((i) => i.id === id || i.name === id)[0];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    tab: 'sessions',
    locale: I18N.locale || 'zh-CN',
    theme: 'light',
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#07c160',
    urgent: 'P2',
    providers: [
      { name: 'DeepSeek', url: 'api.deepseek.com', key: '***', configured: true },
      { name: 'Ollama 本地', url: '127.0.0.1:11434', key: '', configured: false },
    ],
    smtp: { host: '', port: '465', user: '', pass: '', from: '' },
    mesh: { port: 7788, running: false, peers: 0 },
    notifyDone: true,
    notifyReq: true,
    notifyErr: true,
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
   * 主题色板：17 色相 × 3 明度 = 51 色（每行 17 个）。
   * 与桌面端同一套算法：每列先向下搜索出「白字对比度 >= 3.0」的最亮明度作为上限，
   * 再在 [上限, 上限-20] 区间内均分 3 档，因此没有看不清的颜色；
   * 同一列越暗越饱和（+8%/档），相邻色相相差 20°，不会出现彼此接近的颜色。
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

  // ── 通用片段 ──
  const avHtml = (name, preset, cls) => {
    const src = preset ? AV(preset) : null;
    const inner = src ? '<img src="' + src + '" alt=""/>' : esc((name || '?').slice(0, 1));
    return '<div class="av ' + (cls || '') + '">' + inner + '</div>';
  };
  const barHtml = (title, sub, opts) => {
    const o = opts || {};
    const left = o.back ? '<button class="iconbtn back" data-act="back" aria-label="back">‹</button>' : '<div class="spacer"></div>';
    const right = o.more
      ? '<button class="iconbtn" data-act="more" aria-label="more"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
      : '<div class="spacer"></div>';
    return '<div class="bar">' + left + '<div class="title">' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' + right + '</div>';
  };
  const cellHtml = (label, value, act, attrs) => {
    return '<div class="cell"' + (act ? ' data-act="' + act + '"' : '') + (attrs || '') + '>' +
      '<span class="label">' + esc(label) + '</span>' +
      (value === undefined ? '' : '<span class="value">' + value + '</span>') +
      (act ? '<span class="chev">›</span>' : '') + '</div>';
  };

  // ── 会话类型角标 SVG ──
  const TYPE_ICONS = {
    single: '<svg viewBox="0 0 16 16" class="type-badge"><circle cx="6" cy="5" r="3" fill="#07c160"/><rect x="0" y="10" width="12" height="4" rx="2" fill="#07c160"/><rect x="10" y="2" width="5" height="5" rx="1" fill="#576b95"/></svg>',
    internal: '<svg viewBox="0 0 16 16" class="type-badge"><circle cx="8" cy="8" r="6" fill="none" stroke="#576b95" stroke-width="1.5"/><path d="M5 8C5 5 8 5 8 8S11 11 11 8" fill="none" stroke="#576b95" stroke-width="1.5"/></svg>',
    contact: '<svg viewBox="0 0 16 16" class="type-badge"><circle cx="8" cy="5" r="3.5" fill="#576b95"/><path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="#576b95"/></svg>',
    external: '<svg viewBox="0 0 16 16" class="type-badge"><rect x="1" y="1" width="14" height="10" rx="2" fill="#576b95"/><path d="M4 11l4 4 4-4" fill="#576b95"/></svg>',
  };
  const typeLabel = (kind) => t({ single: 'ui.type.single', internal: 'ui.type.internal', contact: 'ui.type.contact', external: 'ui.type.external' }[kind] || '');

  // ── 一级：四个 Tab ──
  function renderSessions() {
    const rows = SESSIONS.map((s) => {
      const isGroup = s.kind !== 'single';
      const inst = instOf(s.id);
      const av = inst ? avHtml(s.name, inst.preset) : avHtml(s.name, 0, 'g');
      const badge = TYPE_ICONS[s.kind] || '';
      const avWrap = '<div class="av-wrap">' + av + badge + '</div>';
      return '<div class="row" data-open="' + esc(s.id) + '">' + avWrap +
        '<div class="mid"><div class="n">' + esc(s.name) + ' <span class="type-tag" data-kind="' + esc(s.kind) + '">' + esc(typeLabel(s.kind)) + '</span></div><div class="s">' + esc(s.last) + '</div></div>' +
        '<div class="right"><div class="t">' + esc(s.ts) + '</div>' +
        (s.unread ? '<div class="badge">' + s.unread + '</div>' : '') + '</div></div>';
    }).join('');
    return barHtml(brandName()) +
      '<div class="body">' + rows +
      '<div class="hint">' + esc(t('chat.systemNote')) + '</div></div>';
  }

  function renderCattle() {
    const rows = INSTANCES.map((i) => {
      return '<div class="row" data-inst="' + esc(i.id) + '">' + avHtml(i.name, i.preset) +
        '<div class="mid"><div class="n">' + esc(i.name) + '</div>' +
        '<div class="s">' + esc(t('inst.status.' + i.status)) + ' · ' + esc(i.model) + '</div></div>' +
        '<div class="right"><span class="chev" style="color:#c8c8c8">›</span></div></div>';
    }).join('');
    return barHtml(t('cattle.title')) + '<div class="body">' + rows + '</div>';
  }

  function renderBoard() {
    const stat = (label, n) => '<div class="cellbox"><span>' + esc(label) + '</span><b>' + n + '</b></div>';
    const prog = (name, pct, note) =>
      '<div class="cell"><span class="label">' + esc(name) + (note ? ' <span class="muted" style="color:var(--muted);font-size:12px">' + esc(note) + '</span>' : '') +
      '</span><span class="value">' + pct + '%</span></div>' +
      '<div style="padding:0 14px 12px"><div class="progress"><i style="width:' + pct + '%"></i></div></div>';
    return barHtml(t('board.title')) +
      '<div class="body">' +
      '<div class="stats">' + stat(t('board.running'), 3) + stat(t('board.done'), 1) + stat(t('board.instances'), 1) + stat(t('board.queue'), 0) + '</div>' +
      '<div class="card"><div class="card-title">' + esc(t('board.progress')) + '</div>' +
      prog('项目推进群', 65) + prog('研发排期', 30, t('board.blocked')) + prog('demo.agent', 40) +
      '</div><div class="hint">' + esc(t('board.readonlyHint')) + '</div></div>';
  }

  function renderMe() {
    const inst = INSTANCES[0];
    return barHtml(t('me.title')) +
      '<div class="body">' +
      '<div class="me-head">' + avHtml(t('me.owner'), 1) +
      '<div class="who"><div class="n">' + esc(t('me.owner')) + '</div><div class="m">ID: 884024787 · ' + esc(brandName()) + '</div></div></div>' +
      '<div class="card">' +
      cellHtml(t('me.appearance'), '', 'set-appearance') +
      cellHtml(t('me.provider'), 'DeepSeek', 'set-provider') +
      cellHtml(t('me.smtp'), '0 / 10', 'set-smtp') +
      cellHtml(t('me.mesh'), '7788', 'set-mesh') +
      cellHtml(t('me.about'), '0.1.0', 'set-about') +
      '</div></div>';
  }

  const TABS = [
    { id: 'sessions', label: 'tab.sessions', svg: '<path d="M4 4h16v11H8l-4 4V4z"/>' },
    { id: 'cattle', label: 'tab.cattle', svg: '<path d="M12 4a4 4 0 014 4v1h1v9H7v-9h1V8a4 4 0 014-4zm-6 6a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z"/>' },
    { id: 'board', label: 'tab.board', svg: '<path d="M4 4h7v7H4V4zm9 0h7v4h-7V4zM4 13h7v7H4v-7zm9 2h7v5h-7v-5z"/>' },
    { id: 'me', label: 'tab.me', svg: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-5 0-8 2.5-8 5v1h16v-1c0-2.5-3-5-8-5z"/>' },
  ];
  function renderTabs() {
    return TABS.map((x) =>
      '<button data-tab="' + x.id + '" class="' + (state.tab === x.id ? 'on' : '') + '">' +
      '<svg viewBox="0 0 24 24">' + x.svg + '</svg>' + esc(t(x.label)) + '</button>'
    ).join('');
  }

  const TAB_RENDER = { sessions: renderSessions, cattle: renderCattle, board: renderBoard, me: renderMe };

  function renderTab() {
    $('#tabs-host').innerHTML = '<section class="tab-page on">' + TAB_RENDER[state.tab]() + '</section>';
    $('#tabs').innerHTML = renderTabs();
  }

  // ── 二级/三级页面（滑入 + 返回）──
  const stack = [];
  function pageShell(inner) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = inner;
    $('#page-host').appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    return el;
  }
  function pop() {
    const el = stack.pop();
    if (!el) return;
    el.classList.remove('on');
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
    const s = sessionOf(id) || { id: id, name: id, kind: 'internal' };
    const msgs = MSGS[id] || [];
    const body = msgs.map((m) => {
      if (m.who === 'sys') return '<div class="msg-row"><span class="sys">' + esc(m.text) + '</span></div>';
      const me = m.who === 'me';
      const inst = me ? null : instOf(id);
      const av = me ? avHtml(t('me.owner'), 1) : inst ? avHtml(inst.name, inst.preset) : avHtml(s.name, 0);
      return '<div class="msg' + (me ? ' me' : '') + '">' + av + '<div class="bubble">' + esc(m.text) + '</div></div>';
    }).join('');
    const inner =
      barHtml(s.name, s.kind === 'single' ? t('chat.sub.single') : t('chat.sub.group'), { back: true, more: true }) +
      '<div class="body chat-body"><div class="msgs" id="msgs">' + body + '</div></div>' +
      '<div class="composer"><textarea id="input" rows="1" placeholder="' + esc(t('m.chat.placeholder')) + '"></textarea>' +
      '<button class="send" id="send" disabled>' + esc(t('chat.send')) + '</button></div>';
    const el = push(inner);
    wirePage(el, {
      more: () => openSheet([
        { label: t('chat.members'), act: 'p-members', id: id },
        { label: t('chat.model'), act: 'p-model', id: id },
        { label: t('chat.kb'), act: 'p-kb', id: id },
        { label: t('chat.checkpoints'), act: 'p-cp', id: id },
        { label: t('chat.metrics'), act: 'p-metrics', id: id },
        { label: t('chat.export'), act: 'p-export', id: id },
      ]),
    });
    const ta = $('#input', el);
    const send = $('#send', el);
    const sync = () => { send.disabled = !ta.value.trim(); };
    ta.addEventListener('input', sync);
    send.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      const d = document.createElement('div');
      d.className = 'msg me';
      d.innerHTML = avHtml(t('me.owner'), 1) + '<div class="bubble">' + esc(v) + '</div>';
      $('#msgs', el).appendChild(d);
      ta.value = ''; sync();
      $('#msgs', el).scrollTop = $('#msgs', el).scrollHeight;
    });
  }

  // 实例详情（三级：从「牛马」或聊天「…」进入）
  function openInstance(id) {
    const i = instOf(id);
    if (!i) return;
    const chip = (m) => '<span style="display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:99px;padding:3px 9px;margin:3px 6px 3px 0;font-size:12px">' + esc(m) + '</span>';
    const inner = barHtml(i.name, t('inst.status.' + i.status), { back: true }) +
      '<div class="body">' +
      '<div class="me-head">' + avHtml(i.name, i.preset) +
      '<div class="who"><div class="n">' + esc(i.name) + '</div><div class="m">' + esc(t('inst.status.' + i.status)) + '</div></div></div>' +
      '<div class="card"><div class="card-title">' + esc(t('inst.defaultModel')) + '</div>' +
      cellHtml(i.model || '—') + '</div>' +
      '<div class="card"><div class="card-title">' + esc(t('inst.models')) + '</div>' +
      '<div style="padding:10px 14px 14px">' + i.models.map(chip).join('') + '</div></div>' +
      '<div class="card"><div class="card-title">' + esc(t('inst.chain')) + '</div>' +
      i.chain.map((m, k) => cellHtml((k + 1) + '. ' + m)).join('') + '</div>' +
      '<div class="card"><div class="card-title">' + esc(t('inst.persona')) + '</div>' +
      '<div style="padding:12px 14px;white-space:pre-wrap;font-size:14px">' + esc(i.persona || '—') + '</div></div>' +
      '<div class="hint">' + esc(t('chat.systemNote')) + '</div></div>';
    push(inner);
  }

  // 聊天「…」里的六个面板（三级）
  function openPanel(kind, id) {
    const s = sessionOf(id) || { name: id };
    let title = '', bodyHtml = '';
    if (kind === 'members') {
      title = t('chat.members');
      const names = GROUP_MEMBERS[id] || [s.name];
      bodyHtml = '<div class="card">' + names.map((n) => {
        const inst = instOf(n);
        return '<div class="row" data-inst="' + esc(inst ? inst.id : n) + '">' +
          avHtml(n, inst ? inst.preset : 0) +
          '<div class="mid"><div class="n">' + esc(n) + '</div><div class="s">' + esc(inst ? inst.model : '—') + '</div></div></div>';
      }).join('') + '</div>';
    } else if (kind === 'model') {
      title = t('chat.model');
      const inst = instOf(id) || INSTANCES[0];
      const chip = (m) => '<span style="display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:99px;padding:3px 9px;margin:3px 6px 3px 0;font-size:12px">' + esc(m) + '</span>';
      bodyHtml = '<div class="card"><div class="card-title">' + esc(t('inst.defaultModel')) + '</div>' + cellHtml(inst.model) + '</div>' +
        '<div class="card"><div class="card-title">' + esc(t('inst.models')) + '</div><div style="padding:10px 14px 14px">' + inst.models.map(chip).join('') + '</div></div>' +
        '<div class="card"><div class="card-title">' + esc(t('inst.chain')) + '</div>' + inst.chain.map((m, k) => cellHtml((k + 1) + '. ' + m)).join('') + '</div>';
    } else if (kind === 'kb') {
      title = t('chat.kb');
      bodyHtml = '<div class="card"><div style="padding:12px 14px"><input placeholder="' + esc(t('kb.hint')) + '" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit"/></div></div>' +
        '<div class="card">' + cellHtml('无限牛马', 'project') + cellHtml('项目推进群', 'org') + '</div>';
    } else if (kind === 'cp') {
      title = t('chat.checkpoints');
      bodyHtml = '<div class="card">' + cellHtml('今天 12:04 · round_end', '65%') + cellHtml('昨天 18:20 · round_start', '30%') + '</div>' +
        '<div class="hint">' + esc(t('cp.rollbackHint')) + '</div>';
    } else if (kind === 'metrics') {
      title = t('chat.metrics');
      bodyHtml = '<div class="stats"><div class="cellbox"><span>' + esc(t('metrics.turns')) + '</span><b>3</b></div>' +
        '<div class="cellbox"><span>' + esc(t('metrics.cost')) + '</span><b>0.029</b></div></div>' +
        '<div class="card">' + cellHtml('cache', '32%') + cellHtml('ccr', '90%') + cellHtml('avg', '2400ms') + '</div>';
    } else {
      title = t('chat.export');
      bodyHtml = '<div class="card">' + cellHtml('Markdown', '.md') + cellHtml(t('export.hasTs'), t('common.yes')) + '</div>' +
        '<div class="hint">' + esc(t('export.hint')) + '</div>';
    }
    push(barHtml(title, s.name, { back: true }) + '<div class="body">' + bodyHtml + '</div>');
  }

  // 设置分组（三级）
  function openSetting(group) {
    const map = {
      appearance: t('me.appearance'),
      provider: t('me.provider'),
      smtp: t('me.smtp'),
      mesh: t('me.mesh'),
      about: t('me.about'),
    };
    let body = '';
    // ── 主题色板（17 色相 × 3 明度 = 51 色，对比度自适应与桌面端一致）──
    const flatColors = accentPalette();
    const swatchHtml = flatColors.map((c) => '<button data-color="' + c + '" style="width:100%;aspect-ratio:1;border-radius:50%;background:' + c + ';border:2px solid ' + (c === state.accent ? 'var(--ink)' : 'transparent') + ';cursor:pointer;padding:0"></button>').join('');

    if (group === 'appearance') {
      body = '<div class="card"><div class="card-title">' + esc(t('me.language')) + '</div>' +
        cellHtml(t('settings.localeZh'), state.locale === 'zh-CN' ? '✓' : '', 'lang-zh') +
        cellHtml(t('settings.localeEn'), state.locale === 'en-US' ? '✓' : '', 'lang-en') + '</div>' +
        '<div class="card"><div class="card-title">' + esc(t('me.theme')) + '</div>' +
        cellHtml(t('me.light'), state.theme === 'light' ? '✓' : '', 'theme-light') +
        cellHtml(t('me.dark'), state.theme === 'dark' ? '✓' : '', 'theme-dark') +
        cellHtml(t('me.system'), state.theme === 'system' ? '✓' : '', 'theme-system') + '</div>' +
        '<div class="card"><div class="card-title">' + esc(t('me.accent')) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(17,1fr);gap:5px;padding:10px 14px">' + swatchHtml + '</div>' +
        '<div style="padding:0 14px 12px;text-align:center"><button data-act="custom-color" style="font-size:13px;color:var(--accent);background:none;border:none;cursor:pointer">' + esc(t('accent.custom')) + ' ›</button></div>' +
        '</div>';
    } else if (group === 'provider') {
      const rows = state.providers || [{ name: 'DeepSeek', url: 'api.deepseek.com', key: '***', configured: true }, { name: 'Ollama 本地', url: '127.0.0.1:11434', key: '', configured: false }];
      body = '<div class="card"><div class="card-title">' + esc(t('provider.list')) + '</div>' +
        rows.map((p, i) => '<div class="cell" data-edit-prov="' + i + '"><span class="label">' + esc(p.name) + '</span><span class="value">' + (p.configured ? t('provider.configured') : t('provider.notConfigured')) + '</span><span class="chev">›</span></div>').join('') +
        '<div class="cell" data-act="add-provider"><span class="label" style="color:var(--accent)">' + esc(t('provider.add')) + '</span></div>' +
        '</div>';
    } else if (group === 'smtp') {
      const smtp = state.smtp || { host: '', port: '465', user: '', pass: '', from: '' };
      body = '<div class="card"><div class="card-title">' + esc(t('smtp.settings')) + '</div>' +
        '<div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px">' +
        '<label style="font-size:13px">' + esc(t('smtp.hostLabel')) + '<input id="smtp-host" value="' + esc(smtp.host) + '" placeholder="smtp.example.com" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.portLabel')) + '<input id="smtp-port" value="' + esc(smtp.port) + '" placeholder="465" type="number" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.userLabel')) + '<input id="smtp-user" value="' + esc(smtp.user) + '" placeholder="your@email.com" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.passLabel')) + '<input id="smtp-pass" value="" type="password" placeholder="' + esc(t('smtp.passPlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '<label style="font-size:13px">' + esc(t('smtp.fromLabel')) + '<input id="smtp-from" value="' + esc(smtp.from) + '" placeholder="' + esc(t('smtp.fromPlaceholder')) + '" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-top:4px"/></label>' +
        '</div><div style="padding:0 14px 12px"><button data-act="verify-smtp" class="btn-primary" style="width:100%;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer">' + esc(t('smtp.verifyBtn')) + '</button></div></div>' +
        '<div class="card"><div class="card-title">' + esc(t('notify.title')) + '</div>' +
        cellHtml(t('notify.done'), state.notifyDone ? '✓' : '', 'notify-done') +
        cellHtml(t('notify.req'), state.notifyReq ? '✓' : '', 'notify-req') +
        cellHtml(t('notify.err'), state.notifyErr ? '✓' : '', 'notify-err') + '</div>';
    } else if (group === 'mesh') {
      const mesh = state.mesh || { port: 7788, running: false, peers: 0 };
      body = '<div class="card"><div class="card-title">' + esc(t('me.mesh')) + '</div>' +
        cellHtml(t('mesh.portLabel'), String(mesh.port)) +
        cellHtml(t('mesh.stateLabel'), mesh.running ? t('inst.status.running') : t('mesh.stopped')) +
        cellHtml(t('mesh.peers'), String(mesh.peers)) +
        '<div style="padding:10px 14px 12px"><button data-act="toggle-mesh" style="width:100%;padding:10px;border:none;border-radius:8px;background:' + (mesh.running ? 'var(--danger)' : 'var(--accent)') + ';color:#fff;font:inherit;cursor:pointer">' + (mesh.running ? t('mesh.stop') : t('mesh.start')) + '</button></div>' +
        '</div>' +
        '<div class="card"><div class="card-title">' + esc(t('mesh.invite')) + '</div>' +
        cellHtml(t('mesh.genInvite'), '', 'gen-invite') +
        cellHtml(t('mesh.scanJoin'), '', 'scan-invite') + '</div>';
    } else {
      body = '<div class="card"><div class="card-title">' + esc(t('me.about')) + '</div>' +
        cellHtml(t('me.version'), 'v0.1.0') +
        cellHtml(t('me.checkUpdate'), '检查更新', 'check-update') +
        cellHtml('Electron', '33.2.0') +
        cellHtml('Chromium', '130.0.6723.191') +
        cellHtml('Node.js', '24.20.0') + '</div>' +
        '<div class="card"><div class="card-title">' + esc(t('about.opensource')) + '</div>' +
        cellHtml(t('about.license'), 'MIT') +
        cellHtml(t('about.author'), 'Pondsi') +
        cellHtml(t('about.copyright'), '© 2026 Pondsi') +
        cellHtml(t('me.deviceId'), '884024787') + '</div>';
    }
    const el = push(barHtml(map[group], '', { back: true }) + '<div class="body">' + body + '</div>');
    // 色板点击
    el.querySelectorAll('[data-color]').forEach((b) => {
      b.addEventListener('click', () => {
        state.accent = b.dataset.color;
        document.documentElement.style.setProperty('--accent', state.accent);
        document.documentElement.style.setProperty('--me-bubble', state.accent);
        openSetting('appearance');
      });
    });
    // SMTP 输入保存
    ['smtp-host', 'smtp-port', 'smtp-user', 'smtp-pass', 'smtp-from'].forEach((id) => {
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
        inp.onchange = () => { state.accent = inp.value; document.documentElement.style.setProperty('--accent', state.accent); document.documentElement.style.setProperty('--me-bubble', state.accent); openSetting('appearance'); };
        inp.click();
      },
      'verify-smtp': () => {
        alert(t('msg.smtpDesktopOnly'));
      },
      'toggle-mesh': () => {
        state.mesh.running = !state.mesh.running;
        openSetting('mesh');
      },
      'notify-done': () => { state.notifyDone = !state.notifyDone; openSetting('smtp'); },
      'notify-req': () => { state.notifyReq = !state.notifyReq; openSetting('smtp'); },
      'notify-err': () => { state.notifyErr = !state.notifyErr; openSetting('smtp'); },
      'add-provider': () => {
        const name = prompt(t('prompt.providerName'));
        if (name) {
          state.providers.push({ name, url: '', key: '', configured: false });
          openSetting('provider');
        }
      },
      'check-update': () => alert(t('msg.latest') + ' v0.1.0'),
      'gen-invite': () => alert(t('msg.inviteCopied')),
      'scan-invite': () => alert(t('msg.scanOnDesktop')),
    });
    // 供应商编辑点击
    el.querySelectorAll('[data-edit-prov]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.editProv);
        const p = state.providers[idx];
        if (!p) return;
        const url = prompt('Base URL', p.url);
        if (url !== null) { p.url = url; p.configured = !!url; }
        openSetting('provider');
      });
    });
  }

  // ── 底部动作面板（「…」）──
  let sheetEl = null;
  function openSheet(items) {
    closeSheet();
    const mask = $('#mask');
    const sheet = $('#sheet');
    sheet.innerHTML = '<div class="sheet-title">' + esc(brandName()) + '</div>' +
      items.map((x) => '<button data-sheet="' + esc(x.act) + '" data-id="' + esc(x.id || '') + '">' + esc(x.label) + '</button>').join('') +
      '<button class="cancel" data-sheet="__cancel">' + esc(t('chat.cancel')) + '</button>';
    mask.classList.add('on');
    requestAnimationFrame(() => sheet.classList.add('on'));
    sheetEl = sheet;
    mask.onclick = closeSheet;
    sheet.onclick = (e) => {
      const b = e.target.closest('[data-sheet]');
      if (!b) return;
      const act = b.dataset.sheet;
      const id = b.dataset.id;
      closeSheet();
      if (act === '__cancel') return;
      if (act.indexOf('p-') === 0) {
        const kind = { 'p-members': 'members', 'p-model': 'model', 'p-kb': 'kb', 'p-cp': 'cp', 'p-metrics': 'metrics', 'p-export': 'export' }[act];
        setTimeout(() => openPanel(kind, id), 180);
      }
    };
  }
  function closeSheet() {
    const mask = $('#mask');
    const sheet = $('#sheet');
    if (mask) mask.classList.remove('on');
    if (sheet) sheet.classList.remove('on');
  }

  // ── 语言 / 主题 ──
  function setLocale(loc) {
    state.locale = loc;
    const pack = (window.__I18N_ALL__ || {})[loc];
    if (pack) {
      I18N.strings = pack;
      I18N.locale = loc;
    }
    document.documentElement.lang = loc;
    document.title = brandName() + ' ' + t('brand.sub');
    while (stack.length) pop();
    renderTab();
  }
  function setTheme(mode) {
    state.theme = mode;
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    while (stack.length) pop();
    openSetting('appearance');
  }

  // ── 事件绑定（一级）──
  function bindGlobal() {
    const phone = $('#phone');
    phone.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        while (stack.length) pop();
        closeSheet();
        renderTab();
        return;
      }
      const row = e.target.closest('[data-open]');
      if (row) { openChat(row.dataset.open); return; }
      const inst = e.target.closest('[data-inst]');
      if (inst) { openInstance(inst.dataset.inst); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act.indexOf('set-') === 0) { openSetting(act.slice(4)); return; }
      if (act === 'back') { pop(); return; }
    });
  }

  function init() {
    try {
      renderTab();
      bindGlobal();
      document.title = brandName() + ' ' + t('brand.sub');
    } catch (e) {
      // 初始化异常时直接把原因显示出来，避免整页空白
      document.body.innerHTML =
        '<pre style="padding:16px;font-size:12px;color:#c00;white-space:pre-wrap">' + esc(t('msg.initFailed')) + String((e && e.message) || e) + '</pre>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.__MOBILE__ = { state: state, openChat: openChat, openInstance: openInstance, openPanel: openPanel, openSetting: openSetting };
})();
