/* CCArmy renderer — 文案全在 i18n；主题/分栏/模型拉取/附件/语音/总看板 */
(() => {
  const $ = (id) => document.getElementById(id);
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
    smtp: { host: '', port: 465, secure: true, user: '', pass: '' },
    smtpAccounts: [],
    embedUseGpu: true,
    listWidth: 280,
    panelWidth: 300,
    attachments: [],
    profile: { loggedIn: false, username: '主人', avatarDataUrl: '', email: '' },
    queues: {},
    board: {
      /** ADR：外部聚合看板 — 会话进展只读，点击跳转；值班者写 board.jsonl */
      sessions: [
        { id: 's-internal-1', kind: 'internal', name: '项目推进群', progress: 65, status: 'doing', blocked: false },
        { id: 's-internal-2', kind: 'internal', name: '研发排期群', progress: 30, status: 'doing', blocked: true },
        { id: 's-ext-1', kind: 'extgroup', name: '客户对接群', progress: 90, status: 'doing', blocked: false },
        { id: 's-single-demo-1', kind: 'single', name: '主力牛马', progress: 40, status: 'doing', blocked: false },
      ],
      /** board.jsonl 结构化事件（值班者解析写入） */
      events: [
        { id: 'e1', ts: Date.now() - 3600e3, action: 'create_task', title: '整理周报', session: '项目推进群' },
        { id: 'e2', ts: Date.now() - 1800e3, action: 'update_progress', title: '整理周报 → 40%', session: '项目推进群' },
        { id: 'e3', ts: Date.now() - 900e3, action: 'block', title: '等待接口文档', session: '研发排期群' },
        { id: 'e4', ts: Date.now() - 300e3, action: 'complete_task', title: '记忆库归档', session: '主力牛马' },
      ],
      recent: ['实例主力牛马已启动', '完成 FTS 中文检索校验'],
    },
    plugins: [
      {
        id: 'agent-teams',
        name: '@nanmicoder/dsh-agent-teams',
        enabled: true,
        desc: '多智能体团队编排：在会话中用自然语言驱动 AgentTeams 分工协作，适合内部群值班者派活。',
      },
      {
        id: 'memory-plus',
        name: 'dsh-memory-bundle',
        enabled: true,
        desc: '记忆增强：中文全文检索、工具结果去重、混合向量+FTS5、跨会话核心记忆与压缩定位。',
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
        label: 'Ollama 本地',
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
    applyAvatar();
    document.title = displayName();
  }

  async function loadI18n(locale) {
    const pack = await window.ccarmy.i18n(locale);
    state.locale = pack.locale;
    state.t = pack.strings;
    if (pack.displayName) state.t['app.displayName'] = pack.displayName;
    const sel = $('session-sec');
    [...sel.options].forEach((o) => {
      const key = 'chat.security' + o.value.charAt(0).toUpperCase() + o.value.slice(1);
      o.textContent = t(key);
    });
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
      btn.textContent = t('list.createGroup');
      btn.title = t('list.createGroup');
      btn.classList.remove('hidden');
      btn.onclick = createGroupFlow;
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
          box.appendChild(
            row(
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
            )
          );
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
        box.appendChild(
          row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id)
        );
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
        box.appendChild(
          row(
            g.name,
            `${t('group.type.' + g.type)} · ${g.members?.length || 0}`,
            g.name[0],
            () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),
            state.selectedChat?.id === g.id
          )
        );
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
    $('session-sec').value = state.sessionSecurity[id] || state.globalSecurity;
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
        : `<div class="av">${escapeHtml((state.profile.username || '我').slice(0, 1))}</div>`;
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

    // 内部群走值班者编排 + LLM
    if (state.selectedChat.kind === 'internal') {
      try {
        const r = await window.ccarmy.groupMessage({
          groupId: id,
          content: text,
          urgency: u,
        });
        const duty = r?.duty ? ` · duty=${r.duty}` : '';
        const reply = r?.reply || `[${u}] ${r?.action || 'ok'}${duty}`;
        pushMsg(id, 'them', reply);
      } catch (e) {
        pushMsg(id, 'them', String(e.message || e));
      }
      renderChat();
      flushQueue(id);
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
    renderChat();
    flushQueue(id);
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
        <div class="inst-row">
          <div class="field"><label>${t('instances.name')}</label><input id="i-name" value="${escapeHtml(inst.name || '')}" title="${escapeHtml(t('instances.name'))}"/></div>
          <div class="field"><label>${t('instances.model')}</label><input id="i-model" value="${escapeHtml(inst.model || 'deepseek-chat')}" title="${escapeHtml(t('instances.model'))}"/></div>
          <div class="field"><label>${t('instances.memoryFile')}</label><input id="i-mem" value="${escapeHtml(inst.memoryFile || '')}" title="${escapeHtml(t('instances.memoryHint'))}"/></div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>${t('instances.persona')}</label>
          <textarea id="i-persona" placeholder="${escapeHtml(t('instances.personaPlaceholder'))}" title="${escapeHtml(t('instances.memoryHint'))}">${escapeHtml(inst.persona || '')}</textarea>
          <div class="muted">${t('instances.memoryHint')}</div>
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
        <div class="set-card" style="max-width:520px;margin-bottom:20px">
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
          <div class="field" style="margin-bottom:10px"><label>${t('me.avatar')}</label>
            <button class="btn-mini" id="p-av-upload">${t('me.avatarUpload')}</button>
            <span class="muted">${t('me.avatarHint')}</span>
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
      $('p-av-upload').onclick = () => $('avatar-file').click();
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
            <label><input type="checkbox" id="s-email" ${state.emailOnRequest ? 'checked' : ''}/> ${t('settings.emailOnRequest')}</label>
            <div class="muted">${t('settings.emailHint')}</div>
          </div>
          <div style="margin-top:12px">
            <button class="btn-mini" id="btn-update">${t('settings.checkUpdate')}</button>
            <span class="muted" id="upd-msg"></span>
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
            <div class="field"><label>${t('smtp.label')}</label><input id="smtp-label" placeholder="工作邮箱"/></div>
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
          <h2>${t('webgpu.title')}</h2>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="embed-gpu" ${state.embedUseGpu !== false ? 'checked' : ''}/>
            ${t('embed.useGpu')}
          </label>
          <div class="muted">${t('embed.gpuHint')}</div>
          <div style="margin-top:8px">
            <button class="btn-mini" id="btn-webgpu">${t('webgpu.test')}</button>
            <span class="muted" id="webgpu-msg"></span>
          </div>
        </div>
        <div class="set-section set-card">
          <h2>${t('lan.title')} · ${t('mesh.title')}</h2>
          <p class="muted">${t('mesh.hint')}</p>
          <div class="inst-row">
            <div class="field"><label>${t('lan.port')}</label><input id="mesh-port" value="7788"/></div>
            <button class="btn-mini" id="btn-mesh-start">${t('mesh.start')}</button>
            <button class="btn-mini" id="btn-mesh-stop">${t('mesh.stop')}</button>
            <button class="btn-mini" id="btn-mesh-bcast">${t('mesh.broadcast')}</button>
          </div>
          <div class="inst-row" style="margin-top:8px">
            <div class="field"><label>${t('mesh.name')}</label><input id="peer-name" placeholder="节点名"/></div>
            <div class="field"><label>${t('lan.peerHost')}</label><input id="peer-host" placeholder="192.168.1.123 或公网IP"/></div>
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
          <div style="margin-top:8px"><button class="btn-mini" id="btn-about-update">${t('about.checkUpdate')}</button>
          <span class="muted" id="about-upd"></span></div>
        </div>`;

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
      $('s-email').onchange = (e) => {
        state.emailOnRequest = e.target.checked;
      };
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
      $('btn-update').onclick = async () => {
        const r = await window.ccarmy.checkUpdate();
        $('upd-msg').textContent = r?.upToDate ? t('settings.upToDate') : t('settings.updateAvailable');
      };
      $('btn-about-update').onclick = async () => {
        const r = await window.ccarmy.checkUpdate();
        $('about-upd').textContent = r?.upToDate ? t('settings.upToDate') : t('settings.updateAvailable');
      };

      const prov = $('prov-list');
      state.providers.forEach((p) => {
        const el = document.createElement('div');
        el.className = 'prov-card';
        el.innerHTML = `
          <div class="prov-head">${escapeHtml(p.label)}</div>
          <div class="inst-row">
            <div class="field"><label>${t('settings.providerName')}</label><input data-k="label" value="${escapeHtml(p.label)}"/></div>
            <div class="field"><label>${t('settings.baseUrl')}</label><input data-k="baseURL" value="${escapeHtml(p.baseURL)}"/></div>
            <div class="field"><label>${t('settings.apiKey')}</label><input data-k="apiKey" type="password" value="${escapeHtml(p.apiKey || '')}"/></div>
          </div>
          <div class="prov-actions">
            <button class="btn-mini" data-fetch title="${escapeHtml(t('settings.fetchModels'))}">${t('settings.fetchModels')}</button>
          </div>
          <div class="model-row">${(p.models || [])
            .map(
              (m) =>
                `<span class="model-chip" data-m="${escapeHtml(m)}">${escapeHtml(m)}<button class="x" data-del="${escapeHtml(m)}" title="${escapeHtml(t('settings.removeModel'))}">×</button></span>`
            )
            .join('') || `<span class="muted">${t('settings.modelsEmpty')}</span>`}</div>`;
        el.querySelectorAll('input[data-k]').forEach((inp) => {
          inp.onchange = () => {
            p[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'label') el.querySelector('.prov-head').textContent = inp.value;
            // 同步到主进程 Provider
            window.ccarmy.setProvider({
              presetId: p.id,
              apiKey: p.apiKey,
              baseURL: p.baseURL,
              model: p.defaultModel || (p.models && p.models[0]) || providerCfgModel(p),
              protocol: p.protocol,
            });
          };
        });
        el.querySelector('[data-fetch]').onclick = async () => {
          const btn = el.querySelector('[data-fetch]');
          btn.textContent = t('common.loading');
          // 先同步 key/url
          await window.ccarmy.setProvider({
            presetId: p.id,
            apiKey: p.apiKey,
            baseURL: p.baseURL,
            protocol: p.protocol,
            model: p.defaultModel || '',
          });
          const r = await window.ccarmy.listModels({
            protocol: p.protocol,
            baseURL: p.baseURL,
            apiKey: p.apiKey,
          });
          if (r?.ok && r.models?.length) {
            const set = new Set([...(p.models || []), ...r.models]);
            p.models = [...set];
          }
          renderPage();
        };
        el.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            p.models = (p.models || []).filter((m) => m !== btn.dataset.del);
            renderPage();
          };
        });
        el.querySelectorAll('.model-chip').forEach((chip) => {
          chip.onclick = async () => {
            p.defaultModel = chip.dataset.m;
            await window.ccarmy.setProvider({
              presetId: p.id,
              apiKey: p.apiKey,
              baseURL: p.baseURL,
              model: p.defaultModel,
              protocol: p.protocol,
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

      const tbody = $('plug-body');
      state.plugins.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(p.name)}</td>
          <td class="plugin-desc">${escapeHtml(p.desc || '')}</td>
          <td><span class="badge ${p.enabled ? '' : 'off'}">${p.enabled ? t('settings.pluginEnable') : t('settings.pluginDisable')}</span></td>
          <td><button class="btn-mini" data-a="toggle">${p.enabled ? t('settings.pluginDisable') : t('settings.pluginEnable')}</button>
          <button class="btn-mini" data-a="un">${t('settings.pluginUninstall')}</button></td>`;
        tr.querySelector('[data-a=toggle]').onclick = () => {
          p.enabled = !p.enabled;
          renderPage();
        };
        tr.querySelector('[data-a=un]').onclick = () => {
          state.plugins = state.plugins.filter((x) => x.id !== p.id);
          renderPage();
        };
        tbody.appendChild(tr);
      });
      $('btn-plug-install').onclick = () => {
        const v = $('plug-path').value.trim();
        if (!v) return;
        state.plugins.push({ id: v, name: v, enabled: true, desc: '' });
        renderPage();
      };

      // SMTP 多账号（最多 10）
      async function renderSmtpList() {
        const r = await window.ccarmy.smtpList();
        const accounts = r?.accounts || [];
        $('smtp-n').textContent = String(accounts.length);
        const box = $('smtp-accounts');
        if (!accounts.length) {
          box.innerHTML = `<div class="muted">${t('smtp.empty')}</div>`;
          return;
        }
        box.innerHTML = accounts
          .map(
            (a) => `
          <div class="prov-card" style="margin-bottom:8px" data-id="${escapeHtml(a.id)}">
            <div class="inst-row">
              <div><b>${escapeHtml(a.label)}</b> <span class="muted">${escapeHtml(a.user)}@${escapeHtml(a.host)}:${a.port}</span></div>
              <span class="badge ${a.verified ? '' : 'off'}">${a.verified ? t('smtp.verified') : t('smtp.unverified')}</span>
              <button class="btn-mini" data-v="${escapeHtml(a.id)}">${t('smtp.verify')}</button>
              <button class="btn-mini" data-x="${escapeHtml(a.id)}">${t('smtp.remove')}</button>
            </div>
          </div>`
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
            const full = (state.smtpAccounts || []).find((x) => x.id === id);
            if (!full?.pass) {
              $('smtp-msg').textContent = t('smtp.fail');
              return;
            }
            $('smtp-msg').textContent = t('common.loading');
            const vr = await window.ccarmy.smtpVerify({ ...full, id });
            $('smtp-msg').textContent = vr?.ok ? t('smtp.ok') : `${t('smtp.fail')}: ${vr?.message || ''}`;
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
          state.smtpAccounts = [...(state.smtpAccounts || []), { ...acc, id: r.accounts[r.accounts.length - 1]?.id }];
          $('smtp-label').value = '';
          $('smtp-host').value = '';
          $('smtp-user').value = '';
          $('smtp-pass').value = '';
          $('smtp-msg').textContent = t('instances.saved');
        } else {
          $('smtp-msg').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // LAN
      $('btn-lan-start').onclick = async () => {
        const port = parseInt($('lan-port').value, 10) || 7788;
        const r = await window.ccarmy.lanStart(port);
        $('lan-msg').textContent = r?.ok ? `${t('lan.start')} :${r.port} ${r.nodeId}` : String(r?.error || '');
      };
      $('btn-lan-stop').onclick = async () => {
        await window.ccarmy.lanStop();
        $('lan-msg').textContent = t('lan.stop');
      };
      $('btn-lan-send').onclick = async () => {
        const r = await window.ccarmy.lanSend({
          host: $('lan-host').value.trim(),
          port: parseInt($('lan-pport').value, 10) || 7788,
          payload: { text: 'hello-from-ccarmy', ts: Date.now() },
        });
        $('lan-msg').textContent = r?.ok ? 'sent' : String(r?.error || '');
      };
      $('btn-lan-dual').onclick = async () => {
        $('lan-msg').textContent = t('common.loading');
        const r = await window.ccarmy.lanDualSmoke({
          peerHost: $('lan-host').value.trim(),
          peerPort: parseInt($('lan-pport').value, 10) || 7788,
        });
        $('lan-msg').textContent = JSON.stringify(r);
        const inbox = await window.ccarmy.lanInbox().catch(() => null);
        if (inbox?.messages?.length) {
          $('lan-inbox').textContent = inbox.messages
            .slice(-5)
            .map((m) => `${m.from}: ${JSON.stringify(m.payload).slice(0, 80)}`)
            .join('\n');
        }
      };

      // WebGPU / 嵌入 GPU 开关
      $('btn-webgpu').onclick = async () => {
        $('webgpu-msg').textContent = t('common.loading');
        try {
          if (!navigator.gpu) throw new Error('no navigator.gpu');
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('no adapter');
          const info = adapter.info || {};
          $('webgpu-msg').textContent =
            t('webgpu.ok') +
            ` · vendor=${info.vendor || ''} arch=${info.architecture || ''} desc=${info.description || ''}`;
        } catch (e) {
          $('webgpu-msg').textContent = `${t('webgpu.fail')} (${String(e.message || e).slice(0, 80)})`;
        }
      };
      $('embed-gpu').onchange = (e) => {
        state.embedUseGpu = e.target.checked;
        window.ccarmy.settingsSave({ embedUseGpu: e.target.checked });
      };

      // Mesh
      async function renderPeers() {
        const r = await window.ccarmy.peersList();
        const box = $('peer-list');
        const peers = r?.peers || [];
        box.innerHTML = `<div class="muted">${t('mesh.peers')} (${peers.length})</div>` +
          peers
            .map(
              (p) =>
                `<div class="inst-row" style="margin:4px 0"><span>${escapeHtml(p.name)} · ${escapeHtml(p.host)}:${p.port} · ${p.kind}</span>
                 <button class="btn-mini" data-rm="${escapeHtml(p.nodeId)}">${t('mesh.remove')}</button></div>`
            )
            .join('') || `<div class="muted">—</div>`;
        box.querySelectorAll('[data-rm]').forEach((b) => {
          b.onclick = async () => {
            await window.ccarmy.peersRemove(b.dataset.rm);
            renderPeers();
          };
        });
      }
      renderPeers();
      $('btn-mesh-start').onclick = async () => {
        const port = parseInt($('mesh-port').value, 10) || 7788;
        const r = await window.ccarmy.meshStart(port);
        $('mesh-msg').textContent = r?.ok
          ? `${t('mesh.start')} :${r.port}\n${r.notes?.lan || ''}\n${r.notes?.wanManual || ''}`
          : String(r?.error || '');
        renderPeers();
      };
      $('btn-mesh-stop').onclick = async () => {
        await window.ccarmy.meshStop();
        $('mesh-msg').textContent = t('mesh.stop');
      };
      $('btn-mesh-bcast').onclick = async () => {
        const r = await window.ccarmy.meshBroadcast({ text: 'hello-mesh', ts: Date.now() });
        $('mesh-msg').textContent = JSON.stringify(r);
        const inbox = await window.ccarmy.meshInbox();
        $('mesh-inbox').textContent = (inbox?.messages || [])
          .slice(-5)
          .map((m) => `${m.from}: ${JSON.stringify(m.payload).slice(0, 60)}`)
          .join('\n');
      };
      $('btn-peer-add').onclick = async () => {
        await window.ccarmy.peersAdd({
          name: $('peer-name').value.trim() || 'peer',
          host: $('peer-host').value.trim(),
          port: parseInt($('peer-port').value, 10) || 7788,
          kind: 'wan',
        });
        $('peer-name').value = '';
        renderPeers();
      };
    }
  }

  function createGroupFlow() {
    uiPrompt(t('list.createGroup'), state.nav === 'internalGroup' ? '项目群' : '外部协作群').then(async (name) => {
      if (!name) return;
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const id = 'g-' + Date.now();
      try {
        await window.ccarmy.groupCreate({ groupId: id, name, type, directedMode: false });
      } catch (e) {
        uiAlert(String(e.message || e));
        return;
      }
      state.groups.push({ id, name, type, members: [] });
      renderList();
    });
  }

  function addInstanceFlow() {
    uiPrompt(t('instances.name'), '牛马-' + (state.instances.length + 1)).then((name) => {
      if (!name) return;
      const inst = {
        id: 'inst-' + Date.now(),
        name,
        status: 'stopped',
        dutyEligible: true,
        model: 'deepseek-chat',
        memoryFile: `persona/${name}.md`,
        persona: '',
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

  // ── 绑定 ──
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('list-search').oninput = () => renderList();
  $('btn-send').onclick = send;
  $('btn-stop-all').onclick = stopAllAi;
  $('btn-attach').onclick = async () => {
    const r = await window.ccarmy.pickFile();
    if (r?.ok) {
      const name = r.path.split(/[\\/]/).pop();
      state.attachments.push({ name, path: r.path });
      renderAttach();
    }
  };
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
          pushMsg(state.selectedChat.id, 'me', `[${t('chat.voice')}] ${r.path.split(/[\\/]/).pop()}`);
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
  $('urgency-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-u]');
    if (!b) return;
    state.urgency = b.dataset.u;
    $('urgency-bar').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('session-sec').addEventListener('change', (e) => {
    if (!state.selectedChat) return;
    state.sessionSecurity[state.selectedChat.id] = e.target.value;
  });
  $('avatar-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.profile.avatarDataUrl = String(reader.result || '');
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

  bindResizer($('col-resizer'), '--list-w', 200, 420);
  bindResizer($('panel-resizer'), '--panel-w', 220, 480);

  async function refreshMetrics() {
    const box = $('metrics-box');
    if (!box) return;
    try {
      const m = await window.ccarmy.metricsSummary();
      if (!m?.ok) return;
      box.textContent = `turns=${m.turns} · cache=${((m.cacheHitRate || 0) * 100).toFixed(1)}% · ccr=${((m.ccrRatio || 1) * 100).toFixed(0)}% · avg=${m.avgDurationMs}ms`;
    } catch {
      /* noop */
    }
  }

  async function refreshCheckpoints() {
    const ul = $('cp-list');
    if (!ul) return;
    const r = await window.ccarmy.checkpointList();
    ul.innerHTML = (r?.list || [])
      .slice(0, 8)
      .map(
        (c) =>
          `<li>${c.phase} · ${c.strategy} · <button class="btn-mini" data-cp="${c.id}">${t('cp.rollback')}</button></li>`
      )
      .join('');
    ul.querySelectorAll('[data-cp]').forEach((b) => {
      b.onclick = async () => {
        await window.ccarmy.checkpointRollback(b.dataset.cp);
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
          name: '主力牛马',
          status: 'stopped',
          dutyEligible: true,
          model: 'deepseek-chat',
          memoryFile: 'persona/main.md',
          persona: '性格：沉稳可靠\n角色：值班执行者\n戒律：不泄露密钥，不越权写文件',
        },
      ];
    }
    setNav('singleAi');
    refreshMetrics();
  })();
})();
