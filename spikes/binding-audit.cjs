const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
const j = fs.readFileSync(base + 'app.js', 'utf8');
const h = fs.readFileSync(base + 'index.html', 'utf8');

// 从 HTML 抽取所有 id，检查是否有对应绑定或明确不需要绑定
const ids = [...h.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
const noBindNeeded = new Set([
  'app', 'app-body', 'titlebar', 'rail', 'list-col', 'list-body', 'main-col', 'empty-state',
  'chat-layout', 'chat-col', 'panel-col', 'chat-title', 'chat-meta', 'messages', 'queue-bar',
  'queue-count', 'queue-items', 'input', 'attach-list', 'console-pane', 'console-out',
  'console-top-resizer', 'input-top-resizer', 'panel-resizer', 'col-resizer', 'modal-root',
  'modal-title', 'modal-body', 'modal-actions', 'avatar-file', 'selfAvatar', 'selfAvatarImg',
  'logo-name', 'logo-sub', 'tb-brand', 'tb-logo', 'tb-sub', 'tb-actions', 'list-title',
  'page-layout', 'page-body', 'inst-detail', 'cp-space', 'cp-detail-list', 'duty-info',
  'metrics-box', 'kb-out', 'urg-menu', 'urg-label', 'urgency-dd',
]);
const missing = [];
for (const id of ids) {
  if (noBindNeeded.has(id)) continue;
  if (!j.includes(`$('${id}')`) && !j.includes(`'${id}'`)) missing.push(id);
}
console.log('total ids', ids.length);
console.log('ids without any reference in app.js:', missing.join(', ') || '(none)');

// 关键交互绑定
const must = [
  ['rail click', "setNav(el.dataset.nav)"],
  ['list search', "$('list-search').addEventListener('input'"],
  ['send', "$('btn-send').addEventListener('click'"],
  ['stop all', "$('btn-stop-all').addEventListener('click'"],
  ['attach', "$('btn-attach').addEventListener('click'"],
  ['voice', "$('btn-voice').onclick"],
  ['screenshot', "$('btn-shot')"],
  ['console', "$('btn-console')"],
  ['urgency dropdown', "$('urg-trigger')"],
  ['window min/max/close', "$('btn-win-close')"],
  ['refresh', "$('btn-ui-refresh')"],
  ['always top', "$('btn-always-top')"],
  ['kb go', "$('btn-kb-go')"],
  ['smtp add', "$('btn-smtp-add')"],
  ['provider add', "$('btn-add-prov')"],
  ['list action', "$('list-action')"],
  ['sec dropdown', "$('sec-trigger')"],
  ['avatar file', "$('avatar-file')"],
  ['input enter', "$('input').addEventListener('keydown'"],
];
let fail = 0;
for (const [n, k] of must) {
  const ok = j.includes(k);
  console.log(ok ? 'OK  ' : 'FAIL', n);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
