const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// 1) 内部群走编排闭环
const oldGroup = j.match(/    \/\/ 内部群走值班者编排 \+ LLM[\s\S]*?      if \(CHAT_NAVS\.has\(state\.nav\)\) renderList\(\);\n      return;\n    \}/);
if (oldGroup) {
  j = j.replace(oldGroup[0], `    // 内部群：值班编排闭环
    if (state.selectedChat.kind === 'internal') {
      try {
        const r = await window.warmy.groupOrchestrate({
          groupId: id,
          content: text,
          urgency: u,
        });
        const reply = r?.reply || \`[\${u}] \${r?.action || 'ok'}\`;
        pushMsg(id, 'them', reply);
        if (r?.boardEvent) {
          state.board = state.board || { sessions: [], events: [], recent: [] };
          state.board.events = state.board.events || [];
          state.board.events.unshift({ id: 'e' + Date.now(), ts: Date.now(), action: r.boardEvent.split(':')[0], title: r.boardEvent, session: id });
        }
      } catch (e) {
        pushMsg(id, 'them', String(e.message || e));
      }
      window.warmy.checkpointAuto?.('round_end');
      renderChat();
      flushQueue(id);
      playNotifySound('complete');
      refreshMetrics();
      refreshCheckpoints();
      if (CHAT_NAVS.has(state.nav)) renderList();
      return;
    }`);
  console.log('group orchestrate wired');
} else {
  console.log('WARN: group faSong block not matched');
}

// 2) 审批弹窗
if (!j.includes('function showApprovalDialog')) {
  j = j.replace(
    '  function openContextMenu(x, y, items) {',
    `  // ── 3 权限审批弹窗 ──
  function showApprovalDialog(payload) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = t('approval.biaoTi');
      $('duiHuaKuangTi').innerHTML =
        '<div style="margin-bottom:8px">' + escapeHtml(payload.action || '') + '</div>' +
        '<div class="jingYin">' + t('approval.tiShi') + '</div>';
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const mk = (biaoQian, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = biaoQian;
        b.onclick = async () => {
          root.classList.add('yinCang');
          await fn();
        };
        acts.appendChild(b);
      };
      mk(t('common.cancel'), 'anNiuXiao', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.deny'), 'anNiuXiao', () => resolve({ allowed: false, scope: 'deny' }));
      mk(t('approval.once'), 'anNiuZhuYao', () => resolve({ allowed: true, scope: 'once' }));
      mk(t('approval.project'), 'anNiuXiao', () => resolve({ allowed: true, scope: 'project' }));
      mk(t('approval.global'), 'anNiuXiao', () => resolve({ allowed: true, scope: 'global' }));
      root.classList.remove('yinCang');
    });
  }
  window.warmy.onApprovalRequest?.(async (d) => {
    const r = await showApprovalDialog(d);
    await window.warmy.approvalRespond(d.id, r.allowed, r.scope);
  });

  function openContextMenu(x, y, items) {`
  );
  console.log('approval dialog added');
}

// 3) 知识库面板增强 + 成本仪表盘（在 refreshMetrics 中并入）
j = j.replace(
  /      box.textContent = `turns=\$\{m.turns\} · cache=\$\{\(\(m.cacheHitRate \|\| 0\) \* 100\)\.toFixed\(1\)\}% · ccr=\$\{\(\(m.ccrRatio \|\| 1\) \* 100\)\.toFixed\(0\)\}% · avg=\$\{m.avgDurationMs\}ms`;/,
  `      box.textContent = \`turns=\${m.turns} · cache=\${((m.cacheHitRate || 0) * 100).toFixed(1)}% · ccr=\${((m.ccrRatio || 1) * 100).toFixed(0)}% · avg=\${m.avgDurationMs}ms\`;
      const cost = await window.warmy.costSummary().catch(() => null);
      if (cost?.ok) {
        box.textContent += \` · ¥\${cost.estCostCny}\`;
      }`
);

// 4) 知识库：从聊天一键存入
j = j.replace(
  /      \$\('anNiuZhiShiKuGo'\)\?\.addEventListener\('click', async \(\) => \{[\s\S]*?\n      \}\);/,
  `      $('anNiuZhiShiKuGo')?.addEventListener('click', async () => {
        const q = $('zhiShiKuQ').value.trim();
        if (!q) return;
        const r = await window.warmy.knowledgeQuery(q);
        const ents = (r?.entities || []).map((e) => e.name + '(' + e.kind + ')').join(', ');
        const evs = (r?.events || []).map((e) => e.biaoTi).join(' | ');
        $('zhiShiKuShuChu').innerHTML =
          '<div><b>' + t('knowledge.biaoTi') + '</b></div>' +
          '<div>' + escapeHtml(ents || '—') + '</div>' +
          '<div>' + escapeHtml(evs || '—') + '</div>';
      });
      // 从当前会话存入知识库
      $('anNiuZhiShiKuBaoCun')?.addEventListener('click', async () => {
        const sid = state.selectedChat?.id;
        if (!sid) {
          $('zhiShiKuShuChu').textContent = t('common.error');
          return;
        }
        const xiaoXi = (window.__msgs && window.__msgs[sid]) || [];
        const last = xiaoXi[xiaoXi.length - 1];
        const ti = last?.text || '';
        if (!ti) return;
        await window.warmy.kbFromChat({
          sessionId: sid,
          title: ti.slice(0, 40),
          ti,
        });
        $('zhiShiKuShuChu').textContent = t('instances.saved');
      });`
);

// 5) 自动检查点：单 AI 发送也打轮末
j = j.replace(
  "    renderChat();\n    flushQueue(id);\n    playNotifySound('complete');\n    if (CHAT_NAVS.has(state.nav)) renderList();\n  }",
  "    window.warmy.checkpointAuto?.('round_end');\n    renderChat();\n    flushQueue(id);\n    playNotifySound('complete');\n    refreshMetrics();\n    refreshCheckpoints();\n    if (CHAT_NAVS.has(state.nav)) renderList();\n  }"
);

// 6) HTML：知识库加「存入」按钮
h = h.replace(
  '<button class="anNiuXiao" id="anNiuZhiShiKuGo" data-i18n="knowledge.search"></button>',
  '<button class="anNiuXiao" id="anNiuZhiShiKuGo" data-i18n="knowledge.search"></button>\n            <button class="anNiuXiao" id="anNiuZhiShiKuBaoCun" data-i18n="knowledge.save"></button>'
);

fs.writeFileSync(base + 'yingYong.js', j);
fs.writeFileSync(base + 'index.html', h);
console.log('renderer patched');
