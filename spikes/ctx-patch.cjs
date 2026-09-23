const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// 1) 邮件通知标题
if (!j.includes("t('settings.emailNotify')")) {
  j = j.replace(
    '<div class="sheZhiSection sheZhiKa">\n          <h2>${t(\'settings.sound\')}</h2>',
    '<div class="sheZhiSection sheZhiKa">\n          <h2>${t(\'settings.sound\')}</h2>'
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
  /<div class="field" style="margin-bottom:10px"><biaoQian>\$\{t\('wo\.touXiang'\)\}<\/biaoQian>\s*<button class="anNiuXiao" id="p-av-upload">\$\{t\('wo\.avatarUpload'\)\}<\/button>\s*<span class="jingYin">\$\{t\('wo\.avatarHint'\)\}<\/span>\s*<\/div>/,
  `<div class="jingYin" style="margin-bottom:10px">\${t('wo.avatarHint')}</div>`
);
j = j.replace(/\s*\$\('p-av-upload'\)\.onclick = \(\) => \$\('touXiangWenJian'\)\.click\(\);/, '');
console.log('wo touXiang dup removed');

// 3) 右键菜单系统
if (!j.includes('function openContextMenu')) {
  const ctx = `  // ── 右键菜单 ──
  function openContextMenu(x, y, items) {
    closeContextMenu();
    const el = document.createElement('div');
    el.className = 'shangXiaWenCaiDan';
    el.id = 'shangXiaWenCaiDan';
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'shangXiaWenFenGe';
        el.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.biaoQian;
      if (it.danger) b.classList.add('danger');
      if (it.checked) b.classList.add('qiYong');
      b.onclick = async () => {
        closeContextMenu();
        await it.onClick?.();
      };
      el.appendChild(b);
    });
    el.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    el.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    document.ti.appendChild(el);
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
              await window.warmy.spawnInstance({ id: inst.id, ming: inst.name, dutyEligible: true });
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
          inst.name = ming;
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
          uiAlert(t('instances.saved'));
          renderList();
        },
      },
      {
        biaoQian: t('ctx.clear'),
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
        biaoQian: t('ctx.notify') + (inst.notify ? ' ✓' : ''),
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
        biaoQian: t('ctx.rename'),
        onClick: async () => {
          const ming = await uiPrompt(t('ctx.renamePrompt'), g.name);
          if (!ming) return;
          g.name = ming;
          renderList();
        },
      },
      joined
        ? {
            biaoQian: t('ctx.delete'),
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
            biaoQian: t('ctx.leave'),
            danger: true,
            onClick: () => {
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

// 4) 在 renderList 的 hang() 中挂右键
if (!j.includes('bindRowContext(rowEl')) {
  j = j.replace(
    `    el.biaoTi = \`\${ming}\\n\${fu}\`;
    el.onclick = onClick;
    return el;
  }`,
    `    el.biaoTi = \`\${ming}\\n\${fu}\`;
    el.onclick = onClick;
    el.__ctx = true;
    return el;
  }`
  );
  // 在单AI/项目/群聊渲染处绑定
  j = j.replace(
    "      source.forEach((c) => {\n        box.appendChild(\n          hang(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id)\n        );\n      });",
    "      source.forEach((c) => {\n        const rowEl = hang(c.name, c.lastPreview || t('list.noReply'), c.name[0], () => openChat('single', c.id, c.name), state.selectedChat?.id === c.id);\n        const inst = state.instances.find((x) => x.id === c.id) || { id: c.id, ming: c.name, status: 'stopped', notify: false };\n        bindRowContext(rowEl, () => agentMenu(inst, rowEl));\n        box.appendChild(rowEl);\n      });"
  );
  j = j.replace(
    "      items.forEach((g) => {\n        box.appendChild(\n          hang(\n            g.name,\n            \`\${t('group.type.' + g.type)} · \${g.members?.length || 0}\`,\n            g.ming[0],\n            () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),\n            state.selectedChat?.id === g.id\n          )\n        );\n      });",
    "      items.forEach((g) => {\n        const rowEl = hang(\n          g.name,\n          \`\${t('group.type.' + g.type)} · \${g.members?.length || 0}\`,\n          g.ming[0],\n          () => openChat(g.type === 'internal' ? 'internal' : 'extgroup', g.id, g.name),\n          state.selectedChat?.id === g.id\n        );\n        bindRowContext(rowEl, () => groupMenu(g, rowEl));\n        box.appendChild(rowEl);\n      });"
  );
  console.log('hang ctx bound');
}

// 5) CSS
if (!c.includes('.shangXiaWenCaiDan')) {
  c += `
.shangXiaWenCaiDan {
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
.shangXiaWenCaiDan button {
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
.shangXiaWenCaiDan button:hover { background: var(--hover); }
.shangXiaWenCaiDan button.danger { color: var(--danger); }
.shangXiaWenCaiDan button.danger:hover { background: rgba(250,81,81,.12); }
.shangXiaWenCaiDan button.qiYong { color: var(--accent); }
.shangXiaWenFenGe { height: 1px; background: var(--line); margin: 4px 8px; }
`;
}

fs.writeFileSync(base + 'yingYong.js', j);
fs.writeFileSync(base + 'yingYong.css', c);
console.log('done');
