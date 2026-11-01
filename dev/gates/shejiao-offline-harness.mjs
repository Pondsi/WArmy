/** R65: in-memory source execution, loopback HTTP only; no dist, Electron, settings or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL('../../', import.meta.url));
const origins = new Set();
const nativeFetch = globalThis.fetch;
export async function offlineFetch(url, options) {
  const parsed = new URL(String(url));
  assert(origins.has(parsed.origin), 'offline gate refuses any unregistered HTTP destination');
  return nativeFetch(url, options);
}

export function execute(source, filename, dependencies = {}) {
  const result = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.equal((result.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0);
  const context = vm.createContext({
    exports: {}, require: (id) => { assert.equal(id, 'node:crypto'); return require(id); },
    fetch: offlineFetch, AbortSignal, AbortController, Buffer, setTimeout, clearTimeout, console,
    TypeError, ...dependencies,
  });
  vm.runInContext(result.outputText, context, { filename });
  return context;
}

const adapterFile = new URL('../../packages/app-shell/src/she-jiao-adapter.ts', import.meta.url);
export const AD = execute(fs.readFileSync(adapterFile, 'utf8'), fileURLToPath(adapterFile)).exports;
export function adapter(baseURL, botId = 'mock-bot') {
  const ad = new AD.ILinkAdapter({ pingTai: 'ilink', botToken: 'offline-fixture-only', botId, baseURL });
  // Only scheduling is suppressed: lianJie/laQu/callback/faSong all execute production source.
  ad.xunHuan = async () => {};
  return ad;
}
export const message = (id, recipient, context, text = '本机协议夹具') => ({
  message_id: id, from_user_id: recipient, to_user_id: 'mock-bot',
  create_time_ms: 1800000000123, message_type: 1, message_state: 2,
  context_token: context, item_list: [{ type: 1, text_item: { text } }],
});
export const plain = (value) => JSON.parse(JSON.stringify(value));

export async function mockHTTP() {
  const state = { updates: [], getResults: [], sendResults: [], gets: [], sends: [], cursor: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const request = { path: req.url, method: req.method, headers: req.headers, body };
    let result;
    if (req.url === '/ilink/bot/getupdates') {
      state.gets.push(request);
      result = state.getResults.shift() || { body: {
        ret: 0, msgs: state.updates.splice(0), get_updates_buf: 'cursor-' + (++state.cursor), longpolling_timeout_ms: 30000,
      } };
    } else if (req.url === '/ilink/bot/sendmessage') {
      state.sends.push(request);
      result = state.sendResults.shift() || { body: { ret: 0, message_id: 'mock-server-id' } };
    } else result = { status: 404, body: {} };
    if (result.disconnect) { req.socket.destroy(); return; }
    res.writeHead(result.status || 200, { 'content-type': 'application/json' });
    res.end(result.raw ?? JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  origins.add(baseURL);
  return {
    state, baseURL,
    async close() {
      origins.delete(baseURL);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Execute the actual social connection function and IPC callbacks, not a rewritten mirror. */
export function mainSocial(dependencies) {
  const filename = fileURLToPath(new URL('../../packages/app-shell/src/electron-main.ts', import.meta.url));
  const source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const functions = new Set(['sheJiaoLianJieJian', 'zhiXingSheJiaoLianJie']);
  const channels = new Set(['warmy:sheJiaoFaSong', 'warmy:sheJiaoDuanKai', 'warmy:liaoTianFaSong']);
  const selected = tree.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return functions.has(node.name?.text);
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    return ts.isIdentifier(call.expression) && call.expression.text === 'chuliIpc'
      && ts.isStringLiteral(call.arguments[0]) && channels.has(call.arguments[0].text);
  });
  assert.equal(selected.length, functions.size + channels.size, 'all source boundaries located with TypeScript AST');
  return execute(selected.map((x) => x.getText(tree)).join('\n'), filename, dependencies);
}

/** Full production credential/QR/queue boundaries, with a purely in-memory settings store and vault. */
export function memorySocial(initial = {}, dependencies = {}) {
  const filename = fileURLToPath(new URL('../../packages/app-shell/src/electron-main.ts', import.meta.url));
  const source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const save = tree.statements.find((n) => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.arguments[0]?.text === 'warmy:taiBaoCun');
  assert(save, 'actual whole-state IPC found');
  const start = source.indexOf('const sheJiaoLianJie =');
  const end = source.indexOf('/** 已落盘的模型能力', start);
  assert(start > 0 && end > start);
  const vaultFile = new URL('../../packages/app-shell/src/cred-vault.ts', import.meta.url);
  const vault = execute(fs.readFileSync(vaultFile, 'utf8'), fileURLToPath(vaultFile)).exports;
  // Deterministic fixture encryption, NOT OS/profile access. Exercise actual vault wrappers.
  const protector = {
    available: true,
    isEncryptionAvailable() { return this.available; },
    encryptString(s) { return Buffer.from('fixture:' + s); },
    decryptString(b) { const s = b.toString(); assert(s.startsWith('fixture:')); return s.slice(8); },
  };
  let state = structuredClone(initial);
  const handlers = new Map(), events = [], logs = [], writes = [];
  const ctx = execute(source.slice(start, end) + '\n' + save.getText(tree) + `\n
    globalThis.social = { duSheJiaoPeiZhi, cunSheJiaoPeiZhi, cunSheJiaoZhangHao, zhengJieMi,
      zhiXingSheJiaoLianJie, biaoJiSheJiaoZhangHaoShiYong, sheJiaoLianJie, saoMaDai, sheJiaoRuDui,
      pending: () => sheJiaoDuiLieShu, drain: () => Promise.all([...sheJiaoDuiLie.values()].map(q => q.tail)) };
  `, filename, {
    ...vault,
    anQuanCunChu: () => protector,
    settingsStore: { load: () => structuredClone(state), save: (partial) => { state = { ...state, ...structuredClone(partial) }; writes.push(structuredClone(state)); } },
    chuliIpc: (name, fn) => handlers.set(name, fn),
    anQuanChuLi: (fn, fallback) => { try { return fn(); } catch { return fallback; } },
    xiJingCuoWu: (e) => String(e?.message || e),
    audit: { log: (name, data) => logs.push({ name, data: plain(data) }) },
    broadcastToWindows: (name, data) => events.push({ name, data: plain(data) }),
    SHE_JIAO_PING_TAI: AD.SHE_JIAO_PING_TAI,
    chuangJianSheJiao: AD.chuangJianSheJiao,
    zhenZhengFaSong: async () => ({ ok: true, reply: '' }),
    shangXianOf: () => 0, dangQianYuYan: () => 'zh-CN',
    ...dependencies,
  });
  return { ...ctx.social, ctx, protector, events, logs, writes,
    read: () => structuredClone(state),
    ipc: (name, payload) => handlers.get('warmy:' + name)(null, payload),
    encrypt: (value) => vault.jiaMiWenBen(value, protector).v,
    close: () => { for (const ad of ctx.social.sheJiaoLianJie.values()) ad.duanKai(); },
  };
}

export function rendererSocial(dependencies) {
  const filename = fileURLToPath(new URL('../../packages/app-shell/src/renderer/app.js', import.meta.url));
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('  async function renderSheJiao(');
  const end = source.indexOf('  window.__renderSheJiao = renderSheJiao;', start);
  assert(start > 0 && end > start);
  return execute(source.slice(start, end), filename, dependencies).renderSheJiao;
}

export function checks(label) {
  let count = 0;
  return {
    async test(name, run) { await run(); count++; console.log('PASS ' + name); },
    done() { console.log(label + ': ' + count + ' PASS / 0 FAIL (source + loopback HTTP; no Electron/live WeChat)'); },
  };
}
