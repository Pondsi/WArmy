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
    listWidth: 280,
    panelWidth: 300,
    attachments: [],
    profile: { loggedIn: false, username: '主人', avatarDataUrl: '', email: '' },
    queues: {},
    board: {
      tasks: [
        { id: 't1', title: '整理周报', status: 'doing', progress: 40 },
        { id: 't2', title: '群聊值班编排', status: 'todo', progress: 0 },
        { id: 't3', title: '记忆库归档', status: 'done', progress: 100 },
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
  const displayName = () =>
    state.t['app.displayName'] || (state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName'));
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      $('app').classList.add('hide-list');
      $('page-layout').classList.remove('hidden');
      renderPage();
      return;
    }

    $('app').classList.remove('hide-list');
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
    try {
      await window.ccarmy.memoryAppend(full);
    } catch {
      /* optional */
    }
    setTimeout(() => {
      pushMsg(id, 'them', `[${u}] ${text.slice(0, 40)}…`);
      const c = state.chats.find((x) => x.id === id);
      if (c) {
        c.lastTs = Date.now();
        c.lastPreview = text.slice(0, 30);
      }
      renderChat();
      flushQueue(id);
      if (CHAT_NAVS.has(state.nav)) renderList();
    }, 350);
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

  function renderDashboard(host) {
    const running = state.instances.filter((i) => i.status === 'running').length;
    const queued = Object.values(state.queues).reduce((n, q) => n + q.length, 0);
    const doing = state.board.tasks.filter((x) => x.status === 'doing').length;
    const done = state.board.tasks.filter((x) => x.status === 'done').length;
    host.innerHTML = `
      <h1>${t('dashboard.title')}</h1>
      <div class="dash-grid">
        <div class="dash-card"><div class="muted">${t('dashboard.tasks')}</div><div class="stat">${doing}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.done')}</div><div class="stat">${done}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.agents')}</div><div class="stat">${running}</div></div>
        <div class="dash-card"><div class="muted">${t('dashboard.queue')}</div><div class="stat">${queued}</div></div>
      </div>
      <div class="set-card" style="margin-bottom:16px">
        <h2 style="margin:0 0 10px;font-size:14px">${t('panel.board')}</h2>
        <div class="board-kanban">
          <div class="board-col"><h3>TODO</h3>${state.board.tasks
            .filter((x) => x.status === 'todo')
            .map((x) => `<div class="board-item">${escapeHtml(x.title)}</div>`)
            .join('') || '<div class="muted">—</div>'}</div>
          <div class="board-col"><h3>DOING</h3>${state.board.tasks
            .filter((x) => x.status === 'doing')
            .map((x) => `<div class="board-item">${escapeHtml(x.title)}<div class="progress" style="margin-top:6px"><div class="progress-bar" style="width:${x.progress}%"></div></div></div>`)
            .join('') || '<div class="muted">—</div>'}</div>
          <div class="board-col"><h3>DONE</h3>${state.board.tasks
            .filter((x) => x.status === 'done')
            .map((x) => `<div class="board-item">${escapeHtml(x.title)}</div>`)
            .join('') || '<div class="muted">—</div>'}</div>
        </div>
      </div>
      <div class="set-card">
        <h2 style="margin:0 0 10px;font-size:14px">${t('dashboard.recent')}</h2>
        <ul class="task-list">${state.board.recent.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      </div>`;
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
        await window.ccarmy.spawnInstance({ id: inst.id, name: inst.name, dutyEligible: true });
        inst.status = 'running';
        renderInstanceDetail();
        renderList();
      } catch (e) {
        alert(String(e.message || e));
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
      if (!confirm(t('instances.delete') + '?')) return;
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
              <div style="font-size:18px;font-weight:600">${escapeHtml(p.username)}</div>
              <div class="muted">${p.loggedIn ? escapeHtml(p.email || '') : t('me.notLoggedIn')}</div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="btn-mini" id="p-login">${t('me.login')}</button>
                <button class="btn-mini" id="p-reg">${t('me.register')}</button>
              </div>
            </div>
          </div>
          <p class="muted">${t('me.loginHint')}</p>
          <div class="field" style="margin-bottom:10px"><label>${t('me.username')}</label><input id="p-name" value="${escapeHtml(p.username)}"/></div>
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
      $('p-login').onclick = () => alert(t('me.notAvailable'));
      $('p-reg').onclick = () => alert(t('me.notAvailable'));
      $('p-av-btn').onclick = () => $('avatar-file').click();
      $('p-av-upload').onclick = () => $('avatar-file').click();
      $('p-save').onclick = () => {
        state.profile.username = $('p-name').value.trim() || state.profile.username;
        state.profile.email = $('p-email').value.trim();
        applyAvatar();
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
          <h2>${t('settings.about')}</h2>
          <div class="muted">${t('about.version')} 0.1.0 · CCArmy · ${t('app.subtitle')}</div>
          <div style="margin-top:8px"><button class="btn-mini" id="btn-about-update">${t('about.checkUpdate')}</button>
          <span class="muted" id="about-upd"></span></div>
        </div>`;

      $('sel-locale').onchange = async (e) => {
        await loadI18n(e.target.value);
        setNav('settings');
      };
      document.querySelectorAll('.theme-mode button').forEach((b) => {
        b.onclick = () => {
          applyThemeMode(b.dataset.m);
          renderPage();
        };
      });
      document.querySelectorAll('.theme-swatches button').forEach((b) => {
        if (b.dataset.c === state.theme) b.classList.add('on');
        b.onclick = () => {
          state.theme = b.dataset.c;
          document.documentElement.style.setProperty('--accent', state.theme);
          document.documentElement.style.setProperty('--me-bubble', state.theme);
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
        el.style.cssText = 'border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--card)';
        el.innerHTML = `
          <div class="inst-row">
            <div class="field"><label>${t('settings.providerName')}</label><input data-k="label" value="${escapeHtml(p.label)}"/></div>
            <div class="field"><label>${t('settings.baseUrl')}</label><input data-k="baseURL" value="${escapeHtml(p.baseURL)}"/></div>
            <div class="field"><label>${t('settings.apiKey')}</label><input data-k="apiKey" type="password" value="${escapeHtml(p.apiKey || '')}"/></div>
          </div>
          <div class="inst-row" style="margin-top:8px">
            <div class="field"><label>${t('settings.defaultModel')}</label><input data-k="defaultModel" value="${escapeHtml(p.defaultModel)}"/></div>
            <button class="btn-mini" data-fetch>${t('settings.fetchModels')}</button>
          </div>
          <div class="model-row">${(p.models || []).map((m) => `<span class="model-chip ${m === p.defaultModel ? 'on' : ''}" data-m="${escapeHtml(m)}">${escapeHtml(m)}</span>`).join('') || `<span class="muted">${t('settings.modelsEmpty')}</span>`}</div>`;
        el.querySelectorAll('input[data-k]').forEach((inp) => {
          inp.onchange = () => {
            p[inp.dataset.k] = inp.value;
          };
        });
        el.querySelector('[data-fetch]').onclick = async () => {
          const btn = el.querySelector('[data-fetch]');
          btn.textContent = t('common.loading');
          const r = await window.ccarmy.listModels({
            protocol: p.protocol,
            baseURL: p.baseURL,
            apiKey: p.apiKey,
          });
          if (r?.ok && r.models?.length) {
            p.models = r.models;
            if (!p.defaultModel) p.defaultModel = r.models[0];
          } else {
            p.models = [];
          }
          renderPage();
        };
        el.querySelectorAll('.model-chip').forEach((chip) => {
          chip.onclick = () => {
            p.defaultModel = chip.dataset.m;
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
    }
  }

  function createGroupFlow() {
    const name = prompt(t('list.createGroup'), state.nav === 'internalGroup' ? '项目群' : '外部协作群');
    if (!name) return;
    const type = state.nav === 'internalGroup' ? 'internal' : 'external';
    state.groups.push({ id: 'g-' + Date.now(), name, type, members: [] });
    renderList();
  }

  function addInstanceFlow() {
    const name = prompt(t('instances.name'), '牛马-' + (state.instances.length + 1));
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
      stream.getTracks().forEach((tr) => tr.stop());
      alert(t('chat.voice') + ' · OK');
    } catch {
      alert(t('chat.voiceUnsupported'));
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
  bindResizer($('col-resizer'), '--list-w', 200, 420);
  bindResizer($('panel-resizer'), '--panel-w', 220, 480);

  (async () => {
    try {
      await loadI18n(navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US');
    } catch {
      state.locale = 'zh-CN';
      state.t = { 'app.zhName': '无限牛马', 'app.enName': 'CCArmy', 'app.subtitle': 'Corporate Cattle Army', 'app.displayName': '无限牛马' };
      applyI18n();
    }
    applyThemeMode('system');
    try {
      state.globalSecurity = (await window.ccarmy.securityMode()) || 'normal';
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
  })();
})();
