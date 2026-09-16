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
    smtp: { host: '', port: 465, secure: true, user: '', pass: '' },
    smtpAccounts: [],
    embedUseGpu: true,
    listWidth: 280,
    panelWidth: 300,
    attachments: [],
    profile: { loggedIn: false, username: 'nav.avatar', avatarDataUrl: '', email: '' },
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
        { id: 'e1', ts: Date.now() - 3600e3, action: 'create_task', title: 'demo.task1', session: '项目推进群' },
        { id: 'e2', ts: Date.now() - 1800e3, action: 'update_progress', title: 'demo.task1', session: '项目推进群' },
        { id: 'e3', ts: Date.now() - 900e3, action: 'block', title: 'demo.task2', session: '研发排期群' },
        { id: 'e4', ts: Date.now() - 300e3, action: 'complete_task', title: 'demo.task3', session: '主力牛马' },
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
  const providerCfgModel = (p) => p.defaultModel || (p.models && p.models[0]) || 'deepseek-chat';
  const displayName = () =>
    state.t['app.displayName'] || (state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName'));
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

  function applyAvatar() {
    const img = $('selfAvatarImg');
    const span = $('selfAvatar');
    if (state.profile.avatarDataUrl) {
      img.src = state.profile.avatarDataUrl;
      img.classList.remove('hidden');
      span.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      span.classList.remove('hidden');
      span.textContent = (state.profile.username || t('nav.avatar')).slice(0, 1);
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
    if ($('tb-logo')) $('tb-logo').textContent = state.locale.startsWith('zh') ? '牛' : 'C';
    applyAvatar();
    document.title = displayName();
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

    if (nav === 'settings' || nav === 'me') {
      $('app-body').classList.add('hide-list');
      $('page-layout').classList.remove('hidden');
      renderPage();
      return;
    }

    $('app-body').classList.remove('hide-list');
    $('list-title').textContent = t(NAV_TITLES[nav] || nav);
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
    if (!state.selectedChat || !matchNav(state.selectedChat, nav)) {
      state.selectedChat = null;
      $('empty-state').classList.remove('hidden');
    } else {
      $('chat-layout').classList.remove('hidden');
      renderChat();
      renderQueueBar();
    }
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

  function row(name, sub, ch, onClick, active) {
    const el = document.createElement('div');
    el.className = 'list-item' + (active ? ' active' : '');
    el.innerHTML = `<div class="av">${escapeHtml(ch || '?')}</div><div class="meta"><div class="name">${escapeHtml(name)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    el.title = `${name}\n${sub}`;
    el.onclick = onClick;
    return el;
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
        <div class="muted">${t('instances.cpus')}: <b>${hw.cpus}</b></div>
        <div class="muted">${t('instances.suggested')}: <b>${hw.suggested}</b></div>
        <div class="muted">${t('instances.max')}: <b>${hw.max ?? '—'}</b></div>`;
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
            state.selectedInstance?.id === inst.id
          );
          bindRowContext(rowEl, () => agentMenu(inst, rowEl));
          box.appendChild(rowEl);
        });
      return;
    }

    if (state.nav === 'singleAi') {
      const items = state.chats
        .filter((c) => c.kind === 'single')
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
      const source = items.length
        ? items
        : state.instances.map((i) => ({ id: i.id, name: i.name, kind: 'single', lastPreview: t('list.noReply') }));
      if (!source.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      source.forEach((c) => {
        const rowEl = row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id);
        const inst = state.instances.find((x) => x.id === c.id) || { id: c.id, name: c.name, status: 'stopped', notify: true };
        bindRowContext(rowEl, () => agentMenu(inst, rowEl));
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const items = state.groups.filter((g) => g.type === type).filter((g) => !q || g.name.toLowerCase().includes(q));
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
        box.appendChild(rowEl);
      });
      return;
    }

    if (state.nav === 'externalChat') {
      const items = state.chats.filter((c) => c.kind === 'extdm').filter((c) => !q || c.name.toLowerCase().includes(q));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((c) => {
        box.appendChild(
          row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, c.name), state.selectedChat?.id === c.id)
        );
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
        <div class="dash-card"><div class="muted">${t('dashboard.tasks')}</div><div class="stat">${doing}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.done')}</div><div class="stat">${done}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.agents')}</div><div class="stat">${running}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.queue')}</div><div class="stat">${queued}</div></div>
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
        <div class="bs-name">${escapeHtml(s.name)}</div>
        <span class="bs-type">${escapeHtml(typeLabel(s.kind))}</span>
        <div class="bs-prog">
          <div class="progress"><div class="progress-bar" style="width:${s.progress}%"></div></div>
          <div class="muted" style="margin-top:2px">${t('dashboard.progressLabel')} ${s.progress}%${s.blocked ? ' · ' + t('dashboard.blocked') : ''}</div>
        </div>
        <span class="bs-status">${t('dashboard.jump')} →</span>`;
      el.onclick = () => {
        const kind = s.kind === 'single' ? 'single' : s.kind === 'internal' ? 'internal' : 'extgroup';
        const nav = kind === 'single' ? 'singleAi' : kind === 'internal' ? 'internalGroup' : 'externalGroup';
        if (kind !== 'single' && !state.groups.find((g) => g.id === s.id)) {
          state.groups.push({ id: s.id, name: s.name, type: kind, members: [] });
        }
        setNav(nav);
        openChat(kind, s.id, s.name);
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
          <div><div>${escapeHtml(e.title)}</div>
          <div class="muted">${escapeHtml(e.session)} · ${new Date(e.ts).toLocaleString()}</div></div>`;
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
          <button id="i-av-btn" class="av-btn" title="${t('instances.avatarUpload')}">
            ${inst.avatarDataUrl
              ? '<img class="avatar-img big" src="' + inst.avatarDataUrl + '" alt=""/>'
              : '<div class="big-av">' + escapeHtml((inst.name || '?').slice(0, 1)) + '</div>'}
          </button>
          <div style="flex:1">
            <div class="field"><label>${t('instances.name')}</label><input id="i-name" value="${escapeHtml(inst.name || '')}"/></div>
            <div class="muted" style="margin-top:6px">${t('instances.avatarUpload')}</div>
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
          <textarea id="i-persona" placeholder="${escapeHtml(t('instances.personaPlaceholder'))}" title="${escapeHtml(t('instances.memoryHint'))}">${escapeHtml(inst.persona || '')}</textarea>
          <div class="muted">${t('instances.memoryHint')}</div>
        </div>
        <div class="set-card" style="margin-top:14px" id="i-modelcfg">
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

      $('i-av-btn')?.addEventListener('click', () => {
        pendingAvatarTarget = { kind: 'instance', inst };
        $('avatar-file').click();
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
      const avHtml = p.avatarDataUrl
        ? `<img class="avatar-img big" src="${p.avatarDataUrl}" alt=""/>`
        : `<div class="big-av">${escapeHtml((p.username || '?').slice(0, 1))}</div>`;
      box.innerHTML = `
        <h1>${t('nav.avatar')}</h1>
        <div class="me-strip">
          <div class="profile-head">
            <button id="p-av-btn" class="av-btn" title="${escapeHtml(t('me.avatarHint'))}">${avHtml}</button>
            <div>
              <div id="p-name-display" class="username-display" title="${escapeHtml(t('me.username'))}">${escapeHtml(p.username)}</div>
              <div class="muted">${p.loggedIn ? escapeHtml(p.email || '') : t('me.notLoggedIn')}</div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="btn-mini" id="p-login">${t('me.login')}</button>
                <button class="btn-mini" id="p-reg">${t('me.register')}</button>
              </div>
            </div>
          </div>
          <p class="muted">${t('me.loginHint')}</p>
          <div class="field" style="margin-bottom:10px">
            <label for="p-name">${t('me.username')}</label>
            <input id="p-name" name="username" autocomplete="username" spellcheck="false" value="${escapeHtml(p.username)}" title="${escapeHtml(t('me.username'))}"/>
          </div>
          <div class="muted" style="margin-bottom:10px">${t('me.avatarHint')}</div>
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
      $('p-name-display').onclick = () => {
        const inp = $('p-name');
        inp.focus();
        inp.select();
      };
      // 实时同步显示名，避免“看起来不能编辑”
      $('p-name').oninput = () => {
        const v = $('p-name').value;
        $('p-name-display').textContent = v || p.username;
      };
      $('p-av-btn').onclick = () => $('avatar-file').click();
      $('p-save').onclick = () => {
        const v = $('p-name').value.trim();
        if (v) state.profile.username = v;
        state.profile.email = $('p-email').value.trim();
        applyAvatar();
        $('p-name-display').textContent = state.profile.username;
        window.ccarmy.profileSave({
          username: state.profile.username,
          email: state.profile.email,
          avatarDataUrl: state.profile.avatarDataUrl,
        });
        uiAlert(t('instances.saved'));
      };
      renderDashboard($('dash-host'));
      return;
    }

    if (state.nav === 'settings') {
      box.innerHTML = `
        <h1>${t('nav.settings')}</h1>
        <div class="set-section set-card">
          <h2>${t('settings.language')}</h2>
          <select id="sel-locale" title="${escapeHtml(t('settings.language'))}">
            <option value="zh-CN" ${state.locale.startsWith('zh') ? 'selected' : ''}>中文</option>
            <option value="en-US" ${state.locale.startsWith('en') ? 'selected' : ''}>English</option>
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
          <div class="theme-swatches">
            <button data-c="#07c160" style="background:#07c160"></button>
            <button data-c="#3d8bfd" style="background:#3d8bfd"></button>
            <button data-c="#b8860b" style="background:#b8860b"></button>
            <button data-c="#c45c26" style="background:#c45c26"></button>
          </div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.security')}</h2>
          <select id="sel-sec" title="${escapeHtml(t('settings.securityHint'))}">
            <option value="normal">${t('settings.securityNormal')}</option>
            <option value="strict">${t('settings.securityStrict')}</option>
            <option value="full">${t('settings.securityFull')}</option>
          </select>
          <p class="muted" style="margin:8px 0 0">${t('settings.securityHint')}</p>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.sound')}</h2>
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
          <h2>${t('settings.providers')}</h2>
          <div id="prov-list"></div>
          <button class="btn-mini" id="btn-add-prov">${t('settings.addProvider')}</button>
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
          <h2>${t('smtp.title')} <span class="muted">(${t('smtp.count')} <span id="smtp-n">0</span>/10 · ${t('smtp.max10')})</span></h2>
          <p class="muted">${t('smtp.hint')}</p>
          <div id="smtp-accounts"></div>
          <div class="inst-row" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
            <div class="field"><label>${t('smtp.label')}</label><input id="smtp-label" placeholder="' + t('placeholder.email') + '"/></div>
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
          <h2>${t('settings.embedding')}</h2>
          <p class="muted">${t('settings.embeddingHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <label>${t('settings.embeddingModel')}</label>
            <input id="embed-model" value="${escapeHtml(state.embedModel || 'Xenova/bge-small-zh-v1.5')}"/>
          </div>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="embed-gpu" ${state.embedUseGpu !== false ? 'checked' : ''}/>
            ${t('settings.embeddingGpu')}
          </label>
          <div class="muted">${t('embed.gpuHint')}</div>
          <div style="margin-top:8px">
            <button class="btn-mini" id="btn-webgpu">${t('webgpu.test')}</button>
            <span class="muted" id="webgpu-msg"></span>
          </div>
        </div>
        <div class="set-section set-card">
          <h2>${t('join.title')}</h2>
          <div class="join-row">
            <div class="join-qr" id="join-qr"></div>
            <div>
              <div class="muted" style="margin-bottom:6px">${t('join.qrHint')}</div>
              <div class="join-link" id="join-link">—</div>
              <div style="margin-top:8px"><button class="btn-mini" id="btn-join-copy">${t('join.copyLink')}</button>
              <span class="muted" id="join-msg"></span></div>
              <div class="field" style="margin-top:10px">
                <label>${t('join.scanHint')}</label>
                <input id="join-input" placeholder="${escapeHtml(t('join.pastePlaceholder'))}"/>
              </div>
              <button class="btn-mini" id="btn-join-accept">${t('join.accept')}</button>
            </div>
          </div>
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
            <div class="field"><label>${t('mesh.name')}</label><input id="peer-name" placeholder="' + t('placeholder.nodeName') + '"/></div>
            <div class="field"><label>${t('lan.peerHost')}</label><input id="peer-host" placeholder="' + t('placeholder.peerHost') + '"/></div>
            <div class="field"><label>${t('lan.peerPort')}</label><input id="peer-port" value="7788"/></div>
            <button class="btn-mini" id="btn-peer-add">${t('mesh.addPeer')}</button>
          </div>
          <div id="peer-list" style="margin-top:10px"></div>
          <div class="muted" id="mesh-msg" style="margin-top:8px"></div>
          <div class="muted" id="mesh-inbox" style="margin-top:8px;max-height:100px;overflow:auto"></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.about')}</h2>
          <div class="muted">${t('about.version')} 0.1.0 · CCArmy · ${t('app.subtitle')}</div>
          <div style="margin-top:10px">
            <button class="btn-mini" id="btn-about-update">${t('about.checkUpdate')}</button>
            <span class="muted" id="about-upd"></span>
          </div>
        </div>`;

      $('btn-about-update').onclick = async () => {
        const r = await window.ccarmy.checkUpdate();
        $('about-upd').textContent = r?.upToDate ? t('settings.upToDate') : t('settings.updateAvailable');
      };

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
      document.querySelectorAll('.theme-swatches button').forEach((b) => {
        if (b.dataset.c === state.theme) b.classList.add('on');
        b.onclick = () => {
          state.theme = b.dataset.c;
          document.documentElement.style.setProperty('--accent', state.theme);
          document.documentElement.style.setProperty('--me-bubble', state.theme);
          window.ccarmy.settingsSave({ accent: state.theme });
          renderPage();
        };
      });
      $('sel-sec').value = state.globalSecurity;
      $('sel-sec').onchange = async (e) => {
        state.globalSecurity = e.target.value;
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
              '<div><b>' + escapeHtml(a.label) + '</b> <span class="muted">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + a.port + '</span></div>' +
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
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

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
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = pane.getBoundingClientRect().height; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const h = Math.min(360, Math.max(80, h0 + (y0 - e.clientY)));
      pane.style.maxHeight = h + 'px';
      pane.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; });
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
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

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
        return;
      }
      state.profile.avatarDataUrl = url;
      applyAvatar();
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
      state.groups.push({ id, name, type, members: [], notify: true });
      renderList();
    });
  }

  function addContactFlow() {
    uiPrompt(t('contact.add'), '').then((name) => {
      if (!name) return;
      state.chats.push({ id: 'c-' + Date.now(), name, kind: 'extdm', lastPreview: t('list.noReply'), notify: true });
      renderList();
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
    let startX = 0;
    let startW = 0;
    let dragging = false;
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      el.classList.add('dragging');
      startX = e.clientX;
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 280;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, w + 'px');
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
    });
  }

  function bindVerticalResizer(handleId, targetId, dir) {
    const el = $(handleId);
    const target = $(targetId);
    if (!el || !target) return;
    let y0 = 0, h0 = 0, drag = false;
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = target.getBoundingClientRect().height; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const delta = dir === 'up' ? (y0 - e.clientY) : (e.clientY - y0);
      const h = Math.min(400, Math.max(80, h0 + delta));
      target.style.height = h + 'px';
      target.style.maxHeight = h + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; });
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
              state.groups = state.groups.filter((x) => x.id !== g.id);
              if (state.selectedChat?.id === g.id) state.selectedChat = null;
              renderList();
              setNav(state.nav);
            },
          }
        : {
            label: t('ctx.leave'),
            danger: true,
            onClick: () => {
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

  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('list-search').addEventListener('input', () => renderList());
  $('btn-send').addEventListener('click', () => send());
  $('btn-stop-all').addEventListener('click', () => stopAllAi());
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
        return `<details class="cp-item" data-id="${c.id}">
          <summary>${when} · ${c.phase} · ${c.strategy}</summary>
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
  async function refreshExecutors() {
    const box = $('exec-box');
    if (!box) return;
    const r = await window.ccarmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + it.status + ' · ' + it.durationMs + 'ms</div>').join('')
      : '—';
  }
  $('btn-exec-run')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.ccarmy.executorsRunBrief({ brief, contextItems: [] });
    refreshExecutors();
  });
  setInterval(refreshExecutors, 8000);

  $('btn-kb-go')?.addEventListener('click', async () => {
    const q = $('kb-q').value.trim();
    if (!q) return;
    const r = await window.ccarmy.knowledgeQuery(q);
    $('kb-out').textContent =
      (r?.entities || []).map((e) => e.name).join(', ') +
      ' | ' +
      (r?.events || []).map((e) => e.title).join(', ');
  });

  setInterval(refreshMetrics, 5000);

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
    // E. 加载持久化状态
    try {
      const st = await window.ccarmy.stateLoad();
      if (st?.state) {
        if (Array.isArray(st.state.plugins) && st.state.plugins.length) state.plugins = st.state.plugins;
        if (Array.isArray(st.state.groups) && st.state.groups.length) state.groups = st.state.groups;
        if (Array.isArray(st.state.chats) && st.state.chats.length) state.chats = st.state.chats;
      }
    } catch { /* noop */ }
    // 变更时保存
    const saveState = () => {
      window.ccarmy.stateSave({
        plugins: state.plugins,
        groups: state.groups,
        chats: state.chats,
      }).catch(() => {});
    };
    window.__saveState = saveState;
    setInterval(saveState, 15000);
    setNav('singleAi');
    refreshMetrics();
    refreshExecutors();
  })();
})();
