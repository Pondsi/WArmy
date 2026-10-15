/**
 * phase3：任务3偏好归档 / 4决策卡层级 / 5-6列表角标 / 7滚动状态 / 8当前模型 / 10右键菜单
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
const CSS = 'packages/app-shell/src/renderer/app.css';
const RCSS = 'packages/app-shell/src/renderer/renderer.css';
const EM = 'packages/app-shell/src/electron-main.ts';
const AC = 'packages/app-shell/src/archive-cleanup.ts';

// ── 任务4：决策卡不要被新消息气泡挡住 ──
edit(RCSS, [
  [
    `.newXiaoXiBubble {
  left: 50%; right: auto; transform: translateX(-50%);
  bottom: 192px;
  max-width: 70%;
}`,
    `.newXiaoXiBubble {
  left: 50%; right: auto; transform: translateX(-50%);
  bottom: 192px;
  max-width: 70%;
  z-index: 30; /* 低于决策卡（.aiqKa z-index:50），避免挡住选项 */
}
/* 决策卡必须在上层（产品：不要被新消息提示气泡挡住） */
.aiqKa, .aiqWrap, #aiqQuYu, .shouQuanKa {
  position: relative;
  z-index: 50;
}`,
    'aiq-z',
  ],
]);

// ── 任务5/6：列表行右上角圆形角标（等待决策=? / 异常=!）──
edit(CSS, [
  [
    `.renWuZhongDuanMark {
  position: absolute; right: 6px; top: 6px;
  width: 18px; height: 18px; border-radius: 999px;
  background: var(--warn, #e8a33d); color: #241a0c;
  font-size: var(--fs-sm); line-height: 18px; text-align: center; font-weight: 700;
  pointer-events: none;
}`,
    `.renWuZhongDuanMark {
  position: absolute; right: 6px; top: 6px;
  width: 18px; height: 18px; border-radius: 999px;
  background: var(--warn, #e8a33d); color: #241a0c;
  font-size: var(--fs-sm); line-height: 18px; text-align: center; font-weight: 700;
  pointer-events: none;
}
/* 右上角强调色圆形角标：等待决策=? / 对话异常=! */
.hangJiaoBiao {
  position: absolute; right: 6px; top: 6px;
  width: 18px; height: 18px; border-radius: 999px;
  background: var(--accent); color: #fff;
  font-size: var(--fs-sm); line-height: 18px; text-align: center; font-weight: 700;
  pointer-events: none; z-index: 2;
}
.hangJiaoBiao.wen { background: var(--accent); }
.hangJiaoBiao.tan { background: var(--accent); }`,
    'hang-badges',
  ],
]);

edit(APP, [
  // attachChatMarks：补等待决策 / 异常角标
  [
    `    if (state.planInterrupted && state.planInterrupted.has(String(sid))) {
      const q = document.createElement('span');
      q.className = 'renWuZhongDuanMark';
      q.textContent = '?';
      q.title = escapeHtml(tOr('chat.resumeTask', '继续 / 重试'));
      hangYuanSu.appendChild(q);
    }
    return hangYuanSu;`,
    `    if (state.planInterrupted && state.planInterrupted.has(String(sid))) {
      const q = document.createElement('span');
      q.className = 'renWuZhongDuanMark';
      q.textContent = '?';
      q.title = escapeHtml(tOr('chat.resumeTask', '继续 / 重试'));
      hangYuanSu.appendChild(q);
    }
    /**
     * **右上角圆形强调色角标**（产品要求）：
     *  · 有等待中的决策卡 ⇒ 问号
     *  · 本会话出现过对话异常 ⇒ 感叹号
     */
    try {
      const daiJueCe = (state.aiQuestions || []).some((q) => q && !q.answered && (q.sessionId === sid || q.groupId === sid));
      const yiChang = state.chatErrors && state.chatErrors.has && state.chatErrors.has(String(sid));
      if (daiJueCe || yiChang) {
        const b = document.createElement('span');
        b.className = 'hangJiaoBiao ' + (yiChang ? 'tan' : 'wen');
        b.textContent = yiChang ? '!' : '?';
        b.title = yiChang
          ? escapeHtml(tOr('list.errorBadge', '对话出现异常'))
          : escapeHtml(tOr('list.waitDecision', '有等待决策'));
        hangYuanSu.appendChild(b);
      }
    } catch { /* noop */ }
    return hangYuanSu;`,
    'row-badges',
  ],
]);

console.log('phase3a done');
