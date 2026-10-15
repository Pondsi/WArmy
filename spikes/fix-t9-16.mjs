/**
 * 9 决策24h / 10 配速1.7 / 12 问号 / 16 计划竖条 / 17 赞踩上移 / 18 预算跟模型
 */
import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

const EM = 'packages/app-shell/src/electron-main.ts';
const APP = 'packages/app-shell/src/renderer/app.js';
const CSS = 'packages/app-shell/src/renderer/app.css';

edit(EM, [
  // 9) 决策卡超时 24 小时
  [
    `  timeoutMs = 10 * 60 * 1000,`,
    `  timeoutMs = 24 * 60 * 60 * 1000, // 产品要求：默认等 24 小时才算超时返回空`,
    'aiq-24h',
  ],
]);

edit(APP, [
  // 10) 配速最大 1.7 倍（最快更慢：MAX_S 从 9.7 → 用于 1.7x 的等效）
  // 产品：最大配速增加到 1.7 倍 = 走得更快。配速数字越大越慢，所以最快时间要更短。
  // 1.7x 相对原最慢 9.7s：9.7/1.7 ≈ 5.7s；保持最快 2.3 或按 2.3/1.7≈1.35
  [
    `      const MIN_S = 2.3, MAX_S = 9.7, BIAN_HUA_LV = 0.7, WEI_CHI = 1100;`,
    `      // 产品要求：最大配速增加到 1.7 倍（配速值越小走得越快）
      const MIN_S = 2.3 / 1.7, MAX_S = 9.7 / 1.7, BIAN_HUA_LV = 0.7, WEI_CHI = 1100;`,
    'pace-17',
  ],
  // 12) 问号：只在**有未答决策卡**时出现；已答/无卡不显示
  [
    `      const daiJueCe = (state.aiQuestions || []).some((q) => q && !q.answered && (q.sessionId === sid || q.groupId === sid));
      const yiChang = state.chatErrors && state.chatErrors.has && state.chatErrors.has(String(sid));
      if (daiJueCe || yiChang) {
        const b = document.createElement('span');
        b.className = 'hangJiaoBiao ' + (yiChang ? 'tan' : 'wen');
        b.textContent = yiChang ? '!' : '?';
        b.title = yiChang
          ? escapeHtml(tOr('list.errorBadge', '对话出现异常'))
          : escapeHtml(tOr('list.waitDecision', '有等待决策'));
        hangYuanSu.appendChild(b);
      }`,
    `      /**
       * **问号只在「当前有未答决策卡」时出现**（产品要求）：
       * 没有卡、或曾经有但用户已选择 ⇒ 问号消失。异常用 ! 单独表示。
       */
      const daiJueCe = (state.aiQuestions || []).some((q) => q && q.status === 'pending' && !q.answered && (q.sessionId === sid || q.groupId === sid));
      const yiChang = state.chatErrors && state.chatErrors.has && state.chatErrors.has(String(sid));
      if (yiChang) {
        const b = document.createElement('span');
        b.className = 'hangJiaoBiao tan';
        b.textContent = '!';
        b.title = escapeHtml(tOr('list.errorBadge', '对话出现异常'));
        hangYuanSu.appendChild(b);
      } else if (daiJueCe) {
        const b = document.createElement('span');
        b.className = 'hangJiaoBiao wen';
        b.textContent = '?';
        b.title = escapeHtml(tOr('list.waitDecision', '有等待决策'));
        hangYuanSu.appendChild(b);
      }`,
    'badge-pending-only',
  ],
]);

// 16) 计划任务：进行中/待完成 加强调色竖条；完成无竖条；blocked+strikethrough
edit(CSS, [
  [
    `.jiHuaBu[data-st="pending"]`,
    `/* 计划任务状态竖条（产品要求） */
.jiHuaBu { position: relative; padding-left: 8px; }
.jiHuaBu::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px;
  border-radius: 2px; background: transparent;
}
.jiHuaBu[data-st="pending"]::before,
.jiHuaBu[data-st="doing"]::before { background: var(--accent); }
.jiHuaBu[data-st="blocked"] { text-decoration: line-through; opacity: .7; }
.jiHuaBu[data-st="blocked"]::before { background: transparent; }
.jiHuaBu[data-st="done"]::before,
.jiHuaBu[data-st="verified"]::before { background: transparent; }

.jiHuaBu[data-st="pending"]`,
    'plan-bar-css',
  ],
]);

console.log('t9-12-16 done');
