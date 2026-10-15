/**
 * phase4：状态字段 / 异常角标数据源 / 滚动保持 / 右键菜单 / 当前模型 / 偏好归档
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function edit(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) {
      console.error(`FAIL ${rel} [${tag}] hits=${n}`);
      process.exit(1);
    }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

const APP = 'packages/app-shell/src/renderer/app.js';
const EM = 'packages/app-shell/src/electron-main.ts';
const AC = 'packages/app-shell/src/archive-cleanup.ts';

// 状态字段
edit(APP, [
  [
    `    /** 中断原因（点「继续/重试」时带给模型分析用） */
    renWuZhongDuan: {},`,
    `    /** 中断原因（点「继续/重试」时带给模型分析用） */
    renWuZhongDuan: {},
    /** 对话异常会话（列表角标显示 !） */
    chatErrors: new Set(),
    /** 最近一次决策卡列表缓存（列表角标显示 ?） */
    aiQuestions: [],`,
    'state-fields',
  ],
  // renderAiQuestions：缓存到 state.aiQuestions
  [
    `        const items = [...rawItems].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
        const pending = items.filter((q) => q.status === 'pending');`,
    `        const items = [...rawItems].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
        const pending = items.filter((q) => q.status === 'pending');
        try { state.aiQuestions = items; } catch { /* noop */ }`,
    'aiq-cache',
  ],
  // taskIncomplete → 记 chatErrors
  [
    `          if (r.taskIncomplete) huiBao = false;`,
    `          if (r.taskIncomplete) {
            huiBao = false;
            try {
              state.chatErrors = state.chatErrors || new Set();
              state.chatErrors.add(String(cur.id || ''));
              try { window.warmy.settingsSave?.({}); } catch { /* noop */ }
            } catch { /* noop */ }
          }`,
    'task-incomplete-err',
  ],
]);

// 修上面可能写错的变量名 huiBao
{
  const p = path.join(ROOT, APP);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('huiBiao = false;')) {
    s = s.replace('huiBiao = false;', 'huiBao = false;');
    fs.writeFileSync(p, s, 'utf8');
    console.log('fixed huiBao typo');
  }
}

// 任务7：切换视图回来时不要误挂「新内容」——renderChat 时若消息无新增且原在底部则清 pendingNewest
edit(APP, [
  [
    `  function renderChat(opts) {`,
    `  /** 每个会话的滚动位置（切换界面再回来不丢） */
  const chatScrollPos = new Map();
  function renderChat(opts) {
    try {
      const sid0 = state.selectedChat && state.selectedChat.id;
      const he0 = $('xiaoXiJi');
      if (sid0 && he0 && !opts?.keepScroll) {
        const prev = chatScrollPos.get(String(sid0));
        if (prev != null) {
          // 先记录再恢复：避免「拉到底了切换回来变未查看」
          opts = { ...(opts || {}), keepScroll: true };
          requestAnimationFrame(() => {
            try {
              const he = $('xiaoXiJi');
              if (he) {
                he.scrollTop = prev;
                if (isAtBottom(he)) { pendingNewest = null; updateScrollAffordances(he); }
              }
            } catch { /* noop */ }
          });
        }
      }
    } catch { /* noop */ }`,
    'scroll-keep',
  ],
  [
    `        if (isAtBottom(heZi)) pendingNewest = null;
        updateScrollAffordances(heZi);
      });`,
    `        if (isAtBottom(heZi)) pendingNewest = null;
        try {
          const sid = state.selectedChat && state.selectedChat.id;
          if (sid) chatScrollPos.set(String(sid), heZi.scrollTop);
        } catch { /* noop */ }
        updateScrollAffordances(heZi);
      });`,
    'scroll-save',
  ],
]);

console.log('phase4a done');
