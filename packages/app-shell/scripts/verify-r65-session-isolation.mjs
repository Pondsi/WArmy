// Offline behavioral fixtures: execute actual renderer functions / IPC callbacks, not source-pattern assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src/electron-main.ts'), 'utf8');
const locale = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/zh-CN.json'), 'utf8'));
function parse(s) { return ts.createSourceFile('fixture.ts', s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
function find(tree, predicate) {
  let result;
  function walk(n) { if (!result && predicate(n)) result = n; if (!result) ts.forEachChild(n, walk); }
  walk(tree);
  assert.ok(result, 'required production AST node exists');
  return result;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const noop = () => {};
class Element {
  constructor() {
    this.dataset = {}; this.style = {}; this.children = []; this.parts = {}; this.attributes = {};
    this.textContent = ''; this.value = ''; this.isConnected = true;
    const classes = new Set();
    this.classList = {
      add: (...a) => a.forEach(x => classes.add(x)), remove: (...a) => a.forEach(x => classes.delete(x)),
      contains: x => classes.has(x), toggle: (x, force) => { const yes = force ?? !classes.has(x); yes ? classes.add(x) : classes.delete(x); return yes; },
    };
  }
  set innerHTML(value) {
    this.html = value; this.parts = {}; this.children = [];
    for (const name of ['yunXingWen', 'yunXingShiJian', 'yunXingMiao', 'niuMaGui', 'bubbleWrap', 'liuShiZhengWen', 'liuShiSiKao']) {
      if (value.includes(name)) this.parts['.' + name] = new Element();
    }
    this.kicks = [...value.matchAll(/data-mkick="([^"]*)"/g)].map(m => { const b = new Element(); b.dataset.mkick = m[1]; return b; });
  }
  get innerHTML() { return this.html || ''; }
  get innerText() { return this.textContent || this.children.map(x => x.innerText).join(''); }
  appendChild(n) { this.children.push(n); return n; }
  insertAdjacentHTML(_where, html) {
    for (const name of ['liuShiZhengWen', 'liuShiSiKao']) if (html.includes(name)) this.parts['.' + name] = new Element();
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  removeAttribute(k) { delete this.attributes[k]; }
  getAttribute(k) { return this.attributes[k] || ''; }
  querySelector(selector) {
    if (selector === '[data-streaming="1"]') return this.children.find(x => x.attributes['data-streaming'] === '1') || null;
    const key = selector.replace(':not([data-feng])', '');
    if (this.parts[key]) return this.parts[key];
    for (const child of [...this.children, ...Object.values(this.parts)]) { const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-streaming="1"]') return this.children.filter(x => x.attributes['data-streaming'] === '1');
    if (selector === '[data-mkick]') return this.kicks || [];
    return [];
  }
  addEventListener() {}
}
function harness(s = source) {
  const tree = parse(s);
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const timers = new Map(), frames = new Map(); let sequence = 0, clock = 10000;
  const calls = { persisted: [], kicks: [], cards: [], list: 0 };
  const state = { selectedChat: { id: 'A', kind: 'single' }, groups: [], chats: [], instances: [], streamBuf: {}, gongZuoWenJian: [], queues: {} };
  const warmy = {
    huiFuJinXing: p => { calls.persisted.push(structuredClone(p)); return Promise.resolve({ ok: true }); },
    groupMembers: async () => ({ ok: true, members: [] }),
    groupKick: async p => { calls.kicks.push(p); return { ok: true }; },
    projectFiles: async p => ({ ok: true, sessionId: p.sessionId, changed: [] }),
    wenJianDaXiao: async () => ({ ok: true, bytes: 1 }),
    membershipList: async () => ({ groups: [] }),
  };
  const sandbox = {
    state, window: { warmy }, console, $, document: { querySelector: q => $('xiaoXiJi').querySelector(q), querySelectorAll: () => [], createElement: () => new Element(), documentElement: { lang: 'zh-CN' } },
    Date: class extends Date { static now() { return clock; } },
    setInterval: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearInterval: id => timers.delete(id),
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
    t: k => locale[k] || k, tOr: (k, fallback) => locale[k] || fallback,
    escapeHtml: v => String(v ?? ''), fmtKey: (k, p) => k + JSON.stringify(p),
    isAtBottom: () => true, youShiZhiWenBen: v => !!String(v || '').trim(),
    wenJianIco: () => '', renLeiDaXiao: n => String(n), whoMing: () => 'owner',
    memberVisual: () => ({ kind: 'online' }), netState: { presence: {} },
    modelMgrCard: (inst, editable) => { calls.cards.push({ inst, editable }); return inst.ming || inst.name || inst.id || ''; },
    bindModelMgr: noop, chongChouBusyZu: noop, busyPhraseAt: () => 'busy', niuMaBengGengXin: noop,
    queueRounds: {}, paiFaQuChong: {}, chuanBoYinXiao: async () => {},
    renderList: () => { calls.list++; }, renderChat: () => { $('xiaoXiJi').innerHTML = ''; },
    pendingNewest: null, showToast: noop, uiAlert: noop, uiConfirm: async () => true,
    queBaoKaPian: noop, shouWenJianYouJianCaiDan: noop,
  };
  for (const name of ['hideMain', 'xuanranFujian', 'renderQueueBar', 'updatePanelVisibility', 'renderProjectStateBlock', 'renderShouQuanKa', 'renderFenShenKa', 'refreshContainerConsoleGate', 'idRefreshForChat', 'renderProgressTasks', 'loadSessionMessages', 'renderJiHuaKa', 'renderDingShiKa']) sandbox[name] = noop;
  const context = vm.createContext(sandbox);
  const declarations = ['_liuShiHuaShangCi', '_liuShiDaiHua', '_liuShiDaiBySid', '_liuShiDaiBump', '_liuShiShouWei', '_liuShiZuiHou', 'jinXingShangCi', 'SI_KAO_DUAN', 'yunXingJiShiQi', 'yunXingXuHao', 'yunXingKaiShi', 'yunXingZuiXin', 'yunXingHuiHua', 'yunXingShiDai', 'YUN_XING_CIHOU', 'NIUMA_BENG', 'NIUMA_GROUP', 'BUSY_PHRASES', 'wenJianBianShi'];
  for (const name of declarations) {
    const n = find(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === name);
    vm.runInContext(`let ${n.getText(tree)};`, context);
  }
  for (const name of ['huiHuaShiJianYouXiao', 'shouHuiHuaLiu', 'shouLiuShiKuai', 'siKaoZhuiDuan', 'siKaoQuDuan', 'siKaoQing', 'jinXingLuoPan', 'xuanRanLiuShiKuai', 'nianYueRiShiFenMiao', 'chuoYunXingZuiXin', 'yunXingZhuangTaiHuiFu', 'yunXingZhuangTaiKai', 'yunXingZhuangTaiGuan', 'renderProjectFilesBlock', 'refreshMembers', 'renderMembershipCerts', 'shortFp', 'certStatusKey', 'renderModelMgr', 'openChat', 'tuisongXiaoxi', 'chatKindOf', 'deliver']) {
    const n = find(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    vm.runInContext(n.getText(tree), context, { filename: 'production-' + name + '.js' });
  }
  const events = {};
  for (const name of ['onSuiXingPianDuan', 'onYunXingZhuangTai', 'onWenJianChanSheng', 'onWenJianBianGeng']) {
    const n = find(tree, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name);
    events[name] = vm.runInContext('(' + n.arguments[0].getText(tree) + ')', context);
  }
  return { c: context, $, state, warmy, calls, events, timers, frames, tick: n => { clock = n; }, run: code => vm.runInContext(code, context) };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function stream(h, sid, content, extra = {}) { h.events.onSuiXingPianDuan({ sessionId: sid, content, ts: h.c.Date.now(), ...extra }); }
function open(h, id, kind = 'single') { h.c.openChat(kind, id, id); }

async function emptyBufferFixture(s = source) {
  const h = harness(s);
  open(h, 'B');
  h.c.yunXingZhuangTaiKai('B', { xinRenWu: true });
  h.c.yunXingZhuangTaiKai('A', { xinRenWu: true });
  stream(h, 'B', 'B-private-text');
  h.$('xiaoXiJi').querySelector('[data-streaming="1"]').textContent = 'B-private-text';
  stream(h, 'A', '', { reasoning: 'A-only-thinking' });
  const a = h.calls.persisted.find(p => p.sessionId === 'A' && !p.clear);
  assert.ok(a, 'A persistence path actually ran');
  assert.equal(a.content, '', 'A empty buffer must not persist B DOM');
  assert.ok(a.reasoningDuan.length, 'A thinking retained separately');
  assert.ok(h.calls.persisted.some(p => p.sessionId === 'B'), 'B is not throttled by A');
}
await test('A empty buffer + B visible DOM: sid-only persistence and independent throttles', () => emptyBufferFixture());
await test('A/B interleaved streams, B selected A.end and A.reply leave B intact', async () => {
  const h = harness(); open(h, 'B');
  h.c.yunXingZhuangTaiKai('A', { xinRenWu: true }); h.c.yunXingZhuangTaiKai('B', { xinRenWu: true });
  stream(h, 'A', 'alpha'); stream(h, 'B', 'beta');
  h.tick(12100); stream(h, 'A', '+a'); stream(h, 'B', '+b');
  assert.equal(h.state.streamBuf.A.content, 'alpha+a'); assert.equal(h.state.streamBuf.B.content, 'beta+b');
  const b = h.$('xiaoXiJi').querySelector('[data-streaming="1"]'); assert.ok(b);
  stream(h, 'A', '', { end: true });
  assert.equal(h.state.streamBuf.A, undefined); assert.equal(b.getAttribute('data-streaming'), '1');
  h.c.tuisongXiaoxi('A', 'them', 'A final');
  assert.equal(h.c.window.__msgs.A[0].text, 'A final');
  assert.equal(b.getAttribute('data-streaming'), '1'); assert.equal(h.state.streamBuf.B.content, 'beta+b');
  h.events.onYunXingZhuangTai({ sessionId: 'A', kai: false, ts: 12100 });
  assert.equal(h.state.sessionRuns.A.running, false); assert.equal(h.state.sessionRuns.B.running, true);
});
await test('missing sid events cannot acquire current session', async () => {
  const h = harness(); open(h, 'B');
  stream(h, undefined, 'wrong');
  h.events.onYunXingZhuangTai({ kai: true, ts: 10000 });
  h.events.onWenJianChanSheng({ path: 'unknown.txt' }); h.events.onWenJianBianGeng({});
  assert.equal(Object.keys(h.state.streamBuf).length, 0); assert.equal(h.state.sessionRuns, undefined);
  assert.equal(h.state.gongZuoWenJian.length, 0); assert.equal(h.state.wenJianBianCi, undefined);
});
await test('same sid new round rejects old ts chunks/end/status and stale generation close', async () => {
  const h = harness(); open(h, 'A'); h.c.yunXingZhuangTaiKai('A', { xinRenWu: true });
  const old = h.state.sessionRuns.A.generation; stream(h, 'A', 'old');
  h.tick(20000); h.c.yunXingZhuangTaiKai('A', { xinRenWu: true }); stream(h, 'A', 'new');
  stream(h, 'A', 'late', { ts: 10001 }); stream(h, 'A', '', { ts: 10001, end: true });
  stream(h, 'A', 'wrong-generation', { generation: old });
  h.events.onYunXingZhuangTai({ sessionId: 'A', kai: false, ts: 10001 });
  h.c.yunXingZhuangTaiGuan(true, 'A', old);
  assert.equal(h.state.streamBuf.A.content, 'new'); assert.equal(h.state.sessionRuns.A.running, true);
});
await test('openChat restores per-sid running; old interval/RAF/hide cannot mutate new view', async () => {
  const h = harness(); open(h, 'A'); h.c.yunXingZhuangTaiKai('A', { xinRenWu: true });
  const started = h.state.sessionRuns.A.startedAt;
  const oldCallbacks = [...h.timers.values(), ...h.frames.values()];
  h.c.yunXingZhuangTaiGuan(true, 'A'); const oldHide = [...h.timers.values()];
  h.tick(20000); h.c.yunXingZhuangTaiKai('A', { xinRenWu: true });
  open(h, 'B'); h.c.yunXingZhuangTaiKai('B', { xinRenWu: true });
  const html = h.$('yunXingZhuangTai').innerHTML, frames = h.frames.size;
  for (const fn of [...oldCallbacks, ...oldHide]) fn(21000);
  assert.equal(h.$('yunXingZhuangTai').innerHTML, html); assert.equal(h.frames.size, frames);
  assert.equal(h.$('yunXingZhuangTai').classList.contains('yinCang'), false);
  open(h, 'A'); assert.equal(h.state.sessionRuns.A.startedAt, 20000); assert.notEqual(started, 20000);
  assert.equal(h.$('yunXingZhuangTai').classList.contains('yinCang'), false);
  for (const kind of ['extdm', 'extgroup', 'external', 'externalGroup']) {
    open(h, 'C-' + kind, kind); h.c.yunXingZhuangTaiKai('C-' + kind, { xinRenWu: true });
    assert.equal(h.$('yunXingZhuangTai').classList.contains('yinCang'), true, kind);
  }
  open(h, 'P', 'internal'); h.c.yunXingZhuangTaiKai('P', { xinRenWu: true });
  assert.equal(h.$('yunXingZhuangTai').classList.contains('yinCang'), false);
});
await test('members A delayed response never overwrites B; same-sid newest request wins', async () => {
  const h = harness(); h.state.groups = [{ id: 'A' }, { id: 'B' }];
  h.state.selectedChat = { id: 'A', kind: 'internal' };
  const a = deferred(), b = deferred(); h.warmy.groupMembers = sid => sid === 'A' ? a.promise : b.promise;
  const pa = h.c.refreshMembers(); h.state.selectedChat = { id: 'B', kind: 'internal' }; const pb = h.c.refreshMembers();
  b.resolve({ ok: true, members: [{ id: 'b', instanceId: 'bi', ming: 'Bee', role: 'duty' }] }); await pb;
  const html = h.$('chengYuanJiHe').innerHTML;
  a.resolve({ ok: true, members: [{ id: 'a', name: 'Alpha' }] }); await pa;
  assert.equal(h.$('chengYuanJiHe').innerHTML, html); assert.equal(h.state.groups[0].members, undefined);
  assert.equal(h.state.groups[1].members[0].instanceId, 'bi'); assert.ok(html.includes(locale['panel.duty']));
  const old = deferred(), newer = deferred(); let n = 0; h.warmy.groupMembers = () => ++n === 1 ? old.promise : newer.promise;
  const po = h.c.refreshMembers(), pn = h.c.refreshMembers(); newer.resolve({ ok: true, members: [{ id: 'new' }] }); await pn;
  old.resolve({ ok: true, members: [{ id: 'stale' }] }); await po;
  assert.equal(h.state.groups[1].members[0].name, 'new');
  const before = h.$('chengYuanJiHe').innerHTML;
  h.warmy.groupMembers = async () => ({ ok: false, members: [] }); await h.c.refreshMembers();
  assert.equal(h.$('chengYuanJiHe').innerHTML, before);
});
await test('member deletion closure captures group/member IDs; failed kick never refreshes', async () => {
  const h = harness(); h.state.selectedChat = { id: 'A', kind: 'internal' }; h.state.groups = [{ id: 'A' }];
  h.warmy.groupMembers = async () => ({ ok: true, members: [{ id: 'a', ming: 'Member' }] }); await h.c.refreshMembers();
  const button = h.$('chengYuanJiHe').querySelectorAll('[data-mkick]')[0]; button.dataset.mkick = 'tampered';
  h.state.selectedChat = { id: 'B', kind: 'internal' }; await button.onclick();
  assert.equal(h.calls.kicks[0].groupId, 'A'); assert.equal(h.calls.kicks[0].memberId, 'a');
  h.warmy.groupKick = async () => ({ ok: false }); let reads = 0; h.warmy.groupMembers = async () => { reads++; return { ok: true }; };
  await button.onclick(); assert.equal(reads, 0);
});
await test('member model identity prefers instanceId then id, never same-name ownership', async () => {
  const h = harness(); h.state.selectedChat = { id: 'P', kind: 'internal' };
  h.state.instances = [{ id: 'i1', ming: 'same' }, { id: 'i2', name: 'same' }];
  h.state.groups = [{ id: 'P', members: [{ id: 'i1', instanceId: 'i2', ming: 'same' }, { id: 'remote', name: 'same' }, { id: 'raw-id' }] }];
  h.c.renderModelMgr();
  assert.equal(h.calls.cards[0].inst.id, 'i2'); assert.equal(h.calls.cards[1].editable, false);
  assert.equal(h.calls.cards[2].inst.ming, 'raw-id'); assert.ok(!h.$('moXingMgr').innerHTML.includes('undefined'));
});
await test('files delayed A cannot overwrite B; newest same-session generation wins', async () => {
  const h = harness(), a = deferred(), b = deferred(); h.warmy.projectFiles = p => p.sessionId === 'A' ? a.promise : b.promise;
  const pa = h.c.renderProjectFilesBlock(); h.state.selectedChat = { id: 'B', kind: 'single' }; const pb = h.c.renderProjectFilesBlock();
  b.resolve({ ok: true, sessionId: 'B', changed: [{ path: 'B.txt' }] }); await pb;
  const html = h.$('xiangMuWenJianJiHe').innerHTML;
  a.resolve({ ok: false }); await pa; assert.equal(h.$('xiangMuWenJianJiHe').innerHTML, html);
  const old = deferred(), newer = deferred(); let n = 0; h.warmy.projectFiles = () => ++n === 1 ? old.promise : newer.promise;
  const po = h.c.renderProjectFilesBlock(), pn = h.c.renderProjectFilesBlock();
  newer.resolve({ ok: true, changed: [{ path: 'new.txt' }] }); await pn;
  old.resolve({ ok: true, changed: [{ path: 'stale.txt' }] }); await po;
  assert.ok(h.$('xiangMuWenJianJiHe').innerHTML.includes('new.txt')); assert.ok(!h.$('xiangMuWenJianJiHe').innerHTML.includes('stale.txt'));
});
await test('files cache/root/duplicate-path ownership and delayed stat are sid-isolated', async () => {
  const h = harness(); h.state.selectedChat = { id: 'B', kind: 'single' };
  h.state.gongZuoWenJian = [{ sid: 'A', path: 'A-secret.txt' }, { path: 'unowned.txt' }, { sid: 'B', path: 'B.txt', bytes: 1 }];
  h.state.gongZuoQuLuJingBySid = { A: 'A-root', B: 'B-root' };
  const stat = deferred(); h.warmy.wenJianDaXiao = () => stat.promise;
  await h.c.renderProjectFilesBlock(); const html = h.$('xiangMuWenJianJiHe').innerHTML;
  assert.ok(html.includes('B.txt') && html.includes('B-root'));
  for (const wrong of ['A-secret.txt', 'unowned.txt', 'A-root']) assert.ok(!html.includes(wrong), wrong);
  h.state.selectedChat = { id: 'A', kind: 'single' }; stat.resolve({ ok: false }); await settle();
  assert.equal(h.state.gongZuoWenJian[2].missing, undefined);
  h.events.onWenJianChanSheng({ sessionId: 'A', path: 'same.txt', bytes: 3 });
  h.events.onWenJianChanSheng({ sessionId: 'B', path: 'same.txt', bytes: 4 });
  assert.equal(h.state.gongZuoWenJian.filter(x => x.path === 'same.txt').length, 2);
});
await test('files change debounce and membership certificate late callbacks ignore switched view', async () => {
  const h = harness(); const snap = deferred(); h.warmy.membershipList = () => snap.promise;
  const selected = h.state.selectedChat;
  const p = h.c.renderMembershipCerts('A', [{ id: 'a', name: 'Alpha' }], () => h.state.selectedChat === selected);
  h.events.onWenJianBianGeng({ sessionId: 'A' }); const callbacks = [...h.timers.values()];
  h.state.selectedChat = { id: 'B', kind: 'single' }; h.$('chengYuanMingCeZhengShu').innerHTML = 'B-cert';
  let requests = 0; h.warmy.projectFiles = async () => { requests++; return { ok: true }; };
  callbacks.forEach(fn => fn()); snap.resolve({ groups: [{ groupId: 'A', certs: [] }] }); await p;
  assert.equal(h.$('chengYuanMingCeZhengShu').innerHTML, 'B-cert'); assert.equal(requests, 0);
});
await test('deliver stale same-session reply/finally cannot end newer request', async () => {
  const h = harness(); h.state.selectedChat = { id: 'A', kind: 'internal' };
  const old = deferred(), newer = deferred(); let n = 0;
  h.warmy.groupOrchestrate = () => ++n === 1 ? old.promise : newer.promise;
  const p1 = h.c.deliver('A', 'first', 'P2'); h.tick(20000); const p2 = h.c.deliver('A', 'second', 'P2');
  old.resolve({ reply: 'stale reply' }); await p1;
  assert.equal(h.state.sessionRuns.A.running, true); assert.equal(h.c.window.__msgs, undefined);
  assert.equal(h.c.queueRounds.A, true);
  newer.resolve({ reply: 'new reply' }); await p2;
  assert.equal(h.c.window.__msgs.A[0].text, 'new reply'); assert.equal(h.state.sessionRuns.A.running, false);
});
await test('main checkpoint loop filters session before slice, including workspace fallback', async () => {
  const tree = parse(mainSource);
  const fn = find(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === 'projectFilesFor');
  const declaration = find(fn, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'cps');
  let block = declaration; while (!ts.isTryStatement(block)) block = block.parent;
  const js = ts.transpileModule(block.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const checkpoints = [{ sessionId: 'A', workspace: 'A-work', detail: { filesCreated: [{ path: 'A.txt', ts: 1 }] } }, ...Array.from({ length: 25 }, () => ({ sessionId: 'B', workspace: 'B-work', detail: { filesCreated: [{ path: 'B.txt', ts: 2 }] } })), { workspace: 'unowned' }];
  const c = vm.createContext({ id: 'A', checkpoints: { LieBiao: () => checkpoints }, fs: { existsSync: () => true }, changed: [], projectDir: null, projectDirReason: '' });
  vm.runInContext(js, c);
  assert.equal(c.changed.length, 1); assert.equal(c.changed[0].path, 'A.txt'); assert.equal(c.projectDir, 'A-work');
});

// In-memory mutation only. Reintroduce the reported DOM fallback and demand the SAME behavior test reject it.
const mutant = source.replace('jinXingLuoPan(sid, b.content);', 'jinXingLuoPan(sid, b.content || document.querySelector(\'[data-streaming="1"]\')?.innerText || "");');
assert.notEqual(mutant, source, 'negative control mutation applied');
await assert.rejects(() => emptyBufferFixture(mutant), e => e.code === 'ERR_ASSERTION' && e.message.includes('A empty buffer must not persist B DOM'));
console.log('PASS negative control: restored DOM fallback rejected by behavioral assertion');
console.log(`R65 session isolation: ${passed} behavior fixtures + 1 negative control PASS (offline; no Electron/cloud)`);
console.log('LIMIT: IPC has ts but no run ID; old work emitted after a new round with a fresh ts cannot be attributed by this renderer-only gate.');
