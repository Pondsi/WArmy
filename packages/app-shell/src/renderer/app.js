/* CCArmy renderer — 文案全部走 i18n，业务数据经 preload IPC */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    nav: 'singleAi',
    locale: 'zh-CN',
    t: {},
    selectedChat: null, // { kind, id, name }
    urgency: 'P2',
    instances: [],
    groups: [],
    chats: [], // 单AI / 外部私聊 列表
    hardware: null,
    security: 'normal',
    sound: true,
    theme: '#07c160',
    plugins: [
      { id: 'agent-teams', name: '@nanmicoder/dsh-agent-teams', enabled: true },
      { id: 'memory-plus', name: 'dsh-memory-bundle', enabled: true },
    ],
    providers: [
      { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', apiKey: '' },
      { id: 'ollama', label: 'Ollama 本地', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: 'qwen2.5:7b', apiKey: '' },
    ],
  };

  function t(key) {
    return state.t[key] || key;
  }

  function appName() {
    return state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName');
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    $('logo-name').textContent = displayName();
    $('logo-sub').textContent = t('app.subtitle');
    $('selfAvatar').textContent = t('nav.avatar').slice(0, 1);
    document.title = displayName();
  }

  async function loadI18n(locale) {
    const pack = await window.ccarmy.i18n(locale);
    state.locale = pack.locale;
    state.t = pack.strings;
    if (pack.displayName) state.t['app.displayName'] = pack.displayName;
    applyI18n();
  }

  function displayName() {
    return state.t['app.displayName'] || appName();
  }

  // ── 导航 ──
  const NAV_TITLES = {
    me: 'nav.avatar',
    singleAi: 'nav.singleAi',
    internalGroup: 'nav.internalGroup',
    externalChat: 'nav.externalChat',
    externalGroup: 'nav.externalGroup',
    instances: 'nav.instances',
    settings: 'nav.settings',
  };

  function setNav(nav) {
    state.nav = nav;
    document.querySelectorAll('.rail-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === nav);
    });
    $('list-title').textContent = t(NAV_TITLES[nav] || nav);
    renderList();
    // 实例/设置显示页，不进聊天布局
    const isPage = nav === 'instances' || nav === 'settings' || nav === 'me';
    $('empty-state').classList.add('hidden');
    $('chat-layout').classList.add('hidden');
    $('page-layout').classList.add('hidden');
    if (isPage) {
      $('page-layout').classList.remove('hidden');
      renderPage();
      $('list-body').innerHTML = '';
      $('list-action').classList.add('hidden');
    } else {
      // 未选会话 → 空白 logo
      if (!state.selectedChat || !matchNav(state.selectedChat, nav)) {
        state.selectedChat = null;
        $('empty-state').classList.remove('hidden');
      } else {
        $('chat-layout').classList.remove('hidden');
        renderChat();
      }
      setupListAction();
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
      btn.classList.remove('hidden');
      btn.onclick = createGroupFlow;
    } else {
      btn.classList.add('hidden');
    }
  }

  // ── 第二列列表 ──
  function renderList() {
    const q = ($('list-search').value || '').trim().toLowerCase();
    const box = $('list-body');
    box.innerHTML = '';

    if (state.nav === 'singleAi') {
      const items = state.chats
        .filter((c) => c.kind === 'single')
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        // 仍展示本机实例供选择
        state.instances.forEach((inst) => {
          box.appendChild(
            row(inst.name, t('list.noReply'), inst.name[0] || 'A', () => openChat('single', inst.id, inst.name))
          );
        });
        return;
      }
      items.forEach((c) => {
        box.appendChild(row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name)));
      });
      return;
    }

    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const items = state.groups
        .filter((g) => g.type === type)
        .filter((g) => !q || g.name.toLowerCase().includes(q));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((g) => {
        box.appendChild(
          row(g.name, `${t('group.type.' + g.type)} · ${g.members?.length || 0}${t('group.members')}`, g.name[0], () =>
            openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name)
          )
        );
      });
      return;
    }

    if (state.nav === 'externalChat') {
      const items = state.chats
        .filter((c) => c.kind === 'extdm')
        .filter((c) => !q || c.name.toLowerCase().includes(q));
      if (!items.length) {
        box.innerHTML = `<div class="list-empty">${t('list.empty')}</div>`;
        return;
      }
      items.forEach((c) => {
        box.appendChild(row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('extdm', c.id, c.name)));
      });
    }
  }

  function row(name, sub, ch, onClick) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<div class="av">${escapeHtml(ch || '?')}</div><div class="meta"><div class="name">${escapeHtml(name)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    el.onclick = onClick;
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── 会话 ──
  function openChat(kind, id, name) {
    state.selectedChat = { kind, id, name };
    $('empty-state').classList.add('hidden');
    $('page-layout').classList.add('hidden');
    $('chat-layout').classList.remove('hidden');
    $('chat-title').textContent = name;
    $('chat-meta').textContent = kind.includes('ext') ? t('group.type.external') : kind === 'internal' ? t('group.type.internal') : t('nav.singleAi');
    renderChat();
    renderList();
  }

  function renderChat() {
    const box = $('messages');
    box.innerHTML = '';
    const msgs = (state.selectedChat && window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    msgs.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'msg' + (m.role === 'me' ? ' me' : '');
      div.innerHTML = `<div class="av">${m.role === 'me' ? t('nav.avatar').slice(0, 1) : escapeHtml((state.selectedChat?.name || 'A')[0])}</div><div class="bubble">${escapeHtml(m.text)}</div>`;
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

  async function send() {
    const text = $('input').value.trim();
    if (!text || !state.selectedChat) return;
    const id = state.selectedChat.id;
    pushMsg(id, 'me', text);
    $('input').value = '';
    renderChat();
    try {
      await window.ccarmy.memoryAppend(text);
    } catch {
      /* memory optional */
    }
    // 占位：值班者/实例回复
    setTimeout(() => {
      pushMsg(id, 'them', `[${state.urgency}] ${text.slice(0, 40)}…`);
      const c = state.chats.find((x) => x.id === id);
      if (c) {
        c.lastTs = Date.now();
        c.lastPreview = text.slice(0, 30);
      }
      renderChat();
      if (state.nav === 'singleAi' || state.nav === 'externalChat') renderList();
    }, 400);
  }

  // ── 页面：实例 / 设置 / 我 ──
  async function renderPage() {
    const box = $('page-body');
    if (state.nav === 'instances') {
      if (!state.hardware) {
        try {
          state.hardware = await window.ccarmy.hardware();
        } catch {
          state.hardware = { cpus: '—', suggested: '—', max: '—' };
        }
      }
      try {
        state.instances = (await window.ccarmy.listInstances()) || state.instances;
      } catch {
        /* keep mock */
      }
      const hw = state.hardware;
      box.innerHTML = `
        <h1>${t('nav.instances')}</h1>
        <div class="hw-grid">
          <div class="hw-card"><div class="muted">${t('instances.hardware')}</div><div class="stat">${hw.cpus ?? '—'}</div><div class="muted">${t('instances.cpus')}</div></div>
          <div class="hw-card"><div class="muted">${t('instances.suggested')}</div><div class="stat">${hw.suggested ?? '—'}</div><div class="muted">${t('instances.running')} / max ${hw.max ?? '—'}</div></div>
          <div class="hw-card" style="display:grid;place-items:center">
            <button class="btn-primary" id="btn-add-inst">${t('list.addInstance')}</button>
          </div>
        </div>
        <div id="inst-list"></div>`;
      $('btn-add-inst').onclick = addInstanceFlow;
      const list = $('inst-list');
      const items = state.instances.length
        ? state.instances
        : [{ id: 'demo-1', name: '主力牛马', status: 'stopped', dutyEligible: true, model: 'deepseek-chat', memoryFile: 'persona/main.md' }];
      items.forEach((inst) => {
        const el = document.createElement('div');
        el.className = 'inst-card';
        el.innerHTML = `
          <div class="inst-row">
            <div class="field"><label>${t('instances.name')}</label><input value="${escapeHtml(inst.name || '')}" data-k="name"/></div>
            <div class="field"><label>${t('instances.model')}</label><input value="${escapeHtml(inst.model || 'deepseek-chat')}" data-k="model"/></div>
            <div class="field"><label>${t('instances.memoryFile')}</label><input value="${escapeHtml(inst.memoryFile || '')}" data-k="memoryFile" placeholder="${escapeHtml(t('instances.memoryHint'))}"/></div>
            <label class="muted"><input type="checkbox" ${inst.dutyEligible ? 'checked' : ''}/> ${t('instances.dutyEligible')}</label>
            <span class="badge ${inst.status === 'running' ? '' : 'off'}">${inst.status === 'running' ? t('instances.running') : t('instances.stopped')}</span>
            <button class="btn-mini" data-a="start">${t('instances.start')}</button>
            <button class="btn-mini" data-a="stop">${t('instances.stop')}</button>
            <button class="btn-danger" data-a="del">${t('instances.delete')}</button>
          </div>`;
        el.querySelectorAll('button').forEach((b) => {
          b.onclick = async () => {
            const a = b.dataset.a;
            if (a === 'start') {
              try {
                await window.ccarmy.spawnInstance({ id: inst.id || 'i-' + Date.now(), name: inst.name || 'agent', dutyEligible: true });
                renderPage();
              } catch (e) {
                alert(String(e.message || e));
              }
            } else if (a === 'stop') {
              try {
                await window.ccarmy.stopInstance(inst.id);
                renderPage();
              } catch {
                /* noop */
              }
            } else if (a === 'del') {
              if (confirm(t('instances.delete') + '?')) {
                try {
                  await window.ccarmy.stopInstance(inst.id);
                } catch {
                  /* noop */
                }
                state.instances = state.instances.filter((x) => x.id !== inst.id);
                renderPage();
              }
            }
          };
        });
        list.appendChild(el);
      });
      return;
    }

    if (state.nav === 'settings') {
      box.innerHTML = `
        <h1>${t('nav.settings')}</h1>
        <div class="set-section set-card">
          <h2>${t('settings.language')}</h2>
          <select id="sel-locale">
            <option value="zh-CN" ${state.locale.startsWith('zh') ? 'selected' : ''}>中文</option>
            <option value="en-US" ${state.locale.startsWith('en') ? 'selected' : ''}>English</option>
          </select>
          <div class="muted" style="margin-top:6px">${state.locale.startsWith('zh') ? t('app.zhName') : t('app.enName')}</div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.theme')}</h2>
          <div class="theme-swatches">
            <button data-c="#07c160" style="background:#07c160"></button>
            <button data-c="#3d8bfd" style="background:#3d8bfd"></button>
            <button data-c="#b8860b" style="background:#b8860b"></button>
            <button data-c="#c45c26" style="background:#c45c26"></button>
          </div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.security')}</h2>
          <select id="sel-sec">
            <option value="normal">${t('settings.securityNormal')}</option>
            <option value="strict">${t('settings.securityStrict')}</option>
            <option value="full">${t('settings.securityFull')}</option>
          </select>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.sound')}</h2>
          <label><input type="checkbox" id="chk-sound" ${state.sound ? 'checked' : ''}/> ${state.sound ? t('settings.soundOn') : t('settings.soundOff')}</label>
          <div style="margin-top:8px"><button class="btn-mini" id="btn-update">${t('settings.checkUpdate')}</button> <span class="muted" id="upd-msg"></span></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.providers')}</h2>
          <div id="prov-list"></div>
          <button class="btn-mini" id="btn-add-prov">${t('settings.addProvider')}</button>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.plugins')}</h2>
          <table class="plugins"><thead><tr><th>ID</th><th></th><th></th></tr></thead><tbody id="plug-body"></tbody></table>
          <div style="margin-top:8px"><input id="plug-path" placeholder="package or path" style="width:60%"/> <button class="btn-mini" id="btn-plug-install">${t('settings.pluginInstall')}</button></div>
        </div>
        <div class="set-section set-card">
          <h2>${t('settings.about')}</h2>
          <div class="muted">CCArmy · ${t('app.subtitle')} · v0.1.0</div>
        </div>`;

      $('sel-locale').onchange = async (e) => {
        await loadI18n(e.target.value);
        setNav('settings');
      };
      $('sel-sec').value = state.security;
      $('sel-sec').onchange = async (e) => {
        state.security = e.target.value;
        try {
          await window.ccarmy.setSecurityMode(state.security);
        } catch {
          /* noop */
        }
      };
      $('chk-sound').onchange = (e) => {
        state.sound = e.target.checked;
        renderPage();
      };
      $('btn-update').onclick = () => {
        $('upd-msg').textContent = t('settings.upToDate');
      };
      document.querySelectorAll('.theme-swatches button').forEach((b) => {
        if (b.dataset.c === state.theme) b.classList.add('on');
        b.onclick = () => {
          state.theme = b.dataset.c;
          document.documentElement.style.setProperty('--accent', state.theme);
          document.documentElement.style.setProperty('--me-bubble', state.theme);
          renderPage();
        };
      });
      const prov = $('prov-list');
      state.providers.forEach((p) => {
        const el = document.createElement('div');
        el.className = 'inst-row';
        el.style.marginBottom = '10px';
        el.innerHTML = `
          <div class="field"><label>${escapeHtml(p.label)}</label><input data-k="baseURL" value="${escapeHtml(p.baseURL)}"/></div>
          <div class="field"><label>${t('settings.baseUrl')}</label><input data-k="baseURL" value="${escapeHtml(p.baseURL)}"/></div>
          <div class="field"><label>${t('settings.apiKey')}</label><input data-k="apiKey" type="password" value="${escapeHtml(p.apiKey || '')}" placeholder="••••••••"/></div>
          <div class="field"><label>${t('settings.defaultModel')}</label><input data-k="defaultModel" value="${escapeHtml(p.defaultModel)}"/></div>`;
        el.querySelectorAll('input').forEach((inp) => {
          inp.onchange = () => {
            p[inp.dataset.k] = inp.value;
          };
        });
        prov.appendChild(el);
      });
      $('btn-add-prov').onclick = () => {
        state.providers.push({ id: 'custom-' + Date.now(), label: 'Custom', protocol: 'openai-compatible', baseURL: '', defaultModel: '', apiKey: '' });
        renderPage();
      };
      const tbody = $('plug-body');
      state.plugins.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td><span class="badge ${p.enabled ? '' : 'off'}">${p.enabled ? t('settings.pluginEnable') : t('settings.pluginDisable')}</span></td>
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
        state.plugins.push({ id: v, name: v, enabled: true });
        renderPage();
      };
      return;
    }

    if (state.nav === 'me') {
      box.innerHTML = `
        <h1>${t('nav.avatar')}</h1>
        <div class="set-card" style="max-width:420px">
          <div style="display:flex;gap:16px;align-items:center">
            <div class="avatar" style="width:64px;height:64px;font-size:22px">${escapeHtml(t('nav.avatar').slice(0, 1))}</div>
            <div>
              <div style="font-size:18px;font-weight:600">${escapeHtml(appName())}</div>
              <div class="muted">${t('app.subtitle')}</div>
            </div>
          </div>
          <p class="muted" style="margin-top:16px">${t('instances.memoryHint')}</p>
        </div>`;
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
    state.instances.push({
      id: 'inst-' + Date.now(),
      name,
      status: 'stopped',
      dutyEligible: true,
      model: 'deepseek-chat',
      memoryFile: `persona/${name}.md`,
    });
    renderPage();
  }

  // ── 绑定 ──
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('list-search').oninput = () => renderList();
  $('btn-send').onclick = send;
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

  // ── 启动 ──
  (async () => {
    try {
      await loadI18n(navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US');
    } catch {
      state.locale = 'zh-CN';
      state.t = { 'app.zhName': '无限牛马', 'app.enName': 'CCArmy', 'app.subtitle': 'Corporate Cattle Army' };
      applyI18n();
    }
    try {
      state.security = (await window.ccarmy.securityMode()) || 'normal';
    } catch {
      /* noop */
    }
    setNav('singleAi');
  })();
})();
