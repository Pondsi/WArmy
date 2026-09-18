const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// 1) 邮件通知标题
if (!j.includes("t('settings.emailNotify')")) {
  j = j.replace(
    '<div class="set-section set-card">\n          <h2>${t(\'settings.sound\')}</h2>',
    '<div class="set-section set-card">\n          <h2>${t(\'settings.sound\')}</h2>'
  );
  // 在邮件复选框区块前插入标题
  j = j.replace(
    `<div style="margin-top:12px">
            \${['complete', 'request', 'error']`,
    `<div style="margin-top:12px">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px">\${t('settings.emailNotify')}</div>
            \${['complete', 'request', 'error']`
  );
  console.log('email heading added');
}

// 2) 我的页去掉上传头像按钮
j = j.replace(
  /<div class="field" style="margin-bottom:10px"><label>\$\{t\('me\.avatar'\)\}<\/label>\s*<button class="btn-mini" id="p-av-upload">\$\{t\('me\.avatarUpload'\)\}<\/button>\s*<span class="muted">\$\{t\('me\.avatarHint'\)\}<\/span>\s*<\/div>/,
  `<div class="muted" style="margin-bottom:10px">\${t('me.avatarHint')}</div>`
);
j = j.replace(/\s*\$\('p-av-upload'\)\.onclick = \(\) => \$\('avatar-file'\)\.click\(\);/, '');
console.log('me avatar dup removed');

// 3) 右键菜单系统
if (!j.includes('function openContextMenu')) {
  const ctx = `  // ── 右键菜单 ──
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

`;
  j = j.replace('  // ── 顶层交互绑定（必须全局执行一次） ──', ctx + '  // ── 顶层交互绑定（必须全局执行一次） ──');
  console.log('ctx menu system added');
}

// 4) 在 renderList 的 row() 中挂右键
if (!j.includes('bindRowContext(rowEl')) {
  j = j.replace(
    `    el.title = \`\${name}\\n\${sub}\`;
    el.onclick = onClick;
    return el;
  }`,
    `    el.title = \`\${name}\\n\${sub}\`;
    el.onclick = onClick;
    el.__ctx = true;
    return el;
  }`
  );
  // 在单AI/项目/群聊渲染处绑定
  j = j.replace(
    "      source.forEach((c) => {\n        box.appendChild(\n          row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id)\n        );\n      });",
    "      source.forEach((c) => {\n        const rowEl = row(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id);\n        const inst = state.instances.find((x) => x.id === c.id) || { id: c.id, name: c.name, status: 'stopped', notify: false };\n        bindRowContext(rowEl, () => agentMenu(inst, rowEl));\n        box.appendChild(rowEl);\n      });"
  );
  j = j.replace(
    "      items.forEach((g) => {\n        box.appendChild(\n          row(\n            g.name,\n            \`\${t('group.type.' + g.type)} · \${g.members?.length || 0}\`,\n            g.name[0],\n            () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),\n            state.selectedChat?.id === g.id\n          )\n        );\n      });",
    "      items.forEach((g) => {\n        const rowEl = row(\n          g.name,\n          \`\${t('group.type.' + g.type)} · \${g.members?.length || 0}\`,\n          g.name[0],\n          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),\n          state.selectedChat?.id === g.id\n        );\n        bindRowContext(rowEl, () => groupMenu(g, rowEl));\n        box.appendChild(rowEl);\n      });"
  );
  console.log('row ctx bound');
}

// 5) CSS
if (!c.includes('.ctx-menu')) {
  c += `
.ctx-menu {
  position: fixed;
  z-index: 200;
  min-width: 150px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-md, 0 10px 30px rgba(0,0,0,.18));
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.ctx-menu button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.ctx-menu button:hover { background: var(--hover); }
.ctx-menu button.danger { color: var(--danger); }
.ctx-menu button.danger:hover { background: rgba(250,81,81,.12); }
.ctx-menu button.on { color: var(--accent); }
.ctx-sep { height: 1px; background: var(--line); margin: 4px 8px; }
`;
}

fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'app.css', c);
console.log('done');
