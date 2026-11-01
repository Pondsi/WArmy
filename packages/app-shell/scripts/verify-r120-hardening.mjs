#!/usr/bin/env node
/**
 * verify-r120-hardening.mjs —— W01–W04 的可重复门禁（不启动 Electron、不读真实 profile）。
 *
 * 覆盖：
 *  W01 runner 判分自证（缺项/skip/轮数不足/超时/known-red 均判红）
 *  W03 S1 收件人白名单、S2 明文密钥桥删除、S3 IPC 主 frame/窗口绑定、S4 环境白名单+进程树、
 *      S5/S6 项目属性/加入批准三方绑定、gate-policy 合法约束不误伤
 *  W04 P1/P2/P4/P5 静态与行为（JSONL 头读、历史 DOM 签名、KB 合并写、向量 top-k 堆）
 *  D4 外部编辑失败保留副本
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const root = path.resolve(pkg, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('packages/app-shell/src/renderer/app.js');
const main = read('packages/app-shell/src/electron-main.ts');
const net = read('packages/app-shell/src/net-wiring.ts');
const tools = read('packages/app-shell/src/agent-tools.ts');
const enc = read('packages/app-shell/src/enc-fs.cjs');
const upd = read('packages/app-shell/src/updater.ts');
const preload = read('packages/app-shell/src/preload.cjs');
const kbSrc = read('packages/knowledge-base/src/index.ts');
const memSrc = read('packages/memory-os/src/index.ts');
const runner = read('dev/gates/run-verify-22.mjs');

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

const gp = await import(pathToFileURL(path.join(pkg, 'dist', 'gate-policy.js')).href);
const nw = await import(pathToFileURL(path.join(pkg, 'dist', 'net-wiring.js')).href);
const ee = await import(pathToFileURL(path.join(pkg, 'dist', 'external-edit.js')).href);
const at = await import(pathToFileURL(path.join(pkg, 'dist', 'agent-tools.js')).href);
const kb = await import(pathToFileURL(path.join(root, 'packages', 'knowledge-base', 'dist', 'index.js')).href);

/* ═══ W01：runner 自证 ═══ */
{
  const r = spawnSync(process.execPath, [path.join(root, 'dev', 'gates', 'run-verify-22.mjs'), '--self-test'], { encoding: 'utf8', timeout: 30000 });
  ok('W01 runner 判分自证 9 条反例', r.status === 0 && /9 个反例/.test(String(r.stdout)), { status: r.status, out: String(r.stdout).slice(-200) });
  ok('W01 轮数不再截断（无 Math.min(9, Number', !/Math\.min\(9,\s*Number/.test(runner));
  ok('W01 缺项/跳过/阻塞/超时进入判分', /panDingQuanYan/.test(runner) && /skippedIds/.test(runner) && /timedOut/.test(runner) && /blocked/.test(runner));
  ok('W01 缺文件也进入结果集（不是只加局部变量）', /missing: true/.test(runner));
  ok('W01 R103 只对明确瞬时故障重派，缺产物不再重派', !/!x\.artifacts\?\.length/.test(read('dev/gates/verify-r103-ten-by-ten.mjs')) && /linShi/.test(read('dev/gates/verify-r103-ten-by-ten.mjs')));
  ok('W01 R103 逐执行者校验产物（不只全局 some）', /自己的产物带验收码/.test(read('dev/gates/verify-r103-ten-by-ten.mjs')) && /自己的产物带本轮主题/.test(read('dev/gates/verify-r103-ten-by-ten.mjs')));
}

/* ═══ W03 S1：收件人白名单 ═══ */
{
  const peers = [
    { nodeId: 'a', host: '1.1.1.1', port: 1, zhiWen: 'AA-BB' },
    { nodeId: 'b', host: '2.2.2.2', port: 2, zhiWen: 'CC-DD' },
    { nodeId: 'c', host: '3.3.3.3', port: 3 },
  ];
  ok('S1 只保留白名单指纹对端', nw.guoLvShouJianDuiDuan(peers, ['aabb']).map((x) => x.nodeId).join(',') === 'a');
  ok('S1 没有白名单 ⇒ 零收件人（不广播地址簿）', nw.guoLvShouJianDuiDuan(peers, []).length === 0);
  ok('S1 无指纹的旧对端不会被选中', nw.guoLvShouJianDuiDuan(peers, ['ccdd']).every((x) => x.zhiWen === 'CC-DD'));
  ok('S1 主进程按群成员+创建者解析收件人', /guoLvShouJianDuiDuan\(duiduanYinyong\(\), allowed\)/.test(main) && /recipient-unresolved/.test(main));
  ok('S1 发送回调在构造传输前/握手后双校验', /expectFingerprints: allowed/.test(main) && /recipient-mismatch/.test(net));
  ok('S1 本地牛马会话不出网', /kind !== 'single'/.test(app));
  ok('S1 长消息不再静默截断', /message-too-long/.test(main));
}

/* ═══ W03 S2/S3 ═══ */
{
  ok('S2 明文密钥读回 IPC 已删除（主进程）', !/anQuanMiYaoJiaZai/.test(main) && !/return \{ ok: !!key, key:/.test(main));
  ok('S2 preload 不再暴露 secureKeyLoad', !/secureKeyLoad/.test(preload));
  ok('S3 IPC 只接受主 frame', /frame !== wc\.mainFrame/.test(main));
  ok('S3 IPC 绑定主 frame + index.html', /frame !== wc\.mainFrame/.test(main) && /path\.join\(__dirname, 'renderer', 'index\.html'\)/.test(main));
  ok('S3 旧 URL 前缀放行已删除', !/IPC_RENDERER_PREFIX/.test(main));
}

/* ═══ W03 S4：cwd/环境/进程树 ═══ */
{
  ok('S4 判权与执行使用同一个解析后 cwd', /const cwdAbs = path\.resolve/.test(main) && (main.match(/cwd: cwdAbs/g) || []).length >= 3 && !/cwd: String\(argsH\.cwd \|\| baseH\)/.test(main));
  ok('S4 工具进程不继承密钥环境变量（白名单）', /const allow = \['PATH'/.test(tools) && /env,/.test(tools));
  ok('S4 超时清理整棵进程树', /taskkill.*\/T/s.test(tools) && /process\.kill\(-child\.pid/.test(tools));
  const secret = 'WARMY_SECRET_' + Date.now();
  process.env[secret] = 'should-not-leak';
  const r = await at.yunXingMingLing('set', { cwd: pkg, timeoutMs: 15000 });
  delete process.env[secret];
  ok('S4 真实子进程看不到宿主自定义密钥变量', r.ok && !new RegExp(secret).test(r.stdout) && /PATH=/i.test(r.stdout), { code: r.code, hasPath: /PATH=/i.test(r.stdout) });
  const t0 = Date.now();
  const r2 = await at.yunXingMingLing('ping -n 6 127.0.0.1', { cwd: pkg, timeoutMs: 1000 });
  const elapsed = Date.now() - t0;
  ok('S4 超时返回且有明确 code', r2.code === 124 && elapsed < 4500, { code: r2.code, elapsed });
}

/* ═══ W03 S5/S6 + gate-policy ═══ */
{
  ok('S5 创建者回声不覆盖本机', nw.jueCeXiangMuShuXingLaiYuan({ hasGroup: true, creatorFingerprint: 'AA', peerFingerprint: 'AA', localFingerprint: 'AA' }) === 'echo');
  ok('S5 非创建者不落库', nw.jueCeXiangMuShuXingLaiYuan({ hasGroup: true, creatorFingerprint: 'AA', peerFingerprint: 'BB', localFingerprint: 'CC' }) === 'reject-creator-mismatch');
  ok('S5 未知群/无创建者不落库', nw.jueCeXiangMuShuXingLaiYuan({ hasGroup: false, creatorFingerprint: '', peerFingerprint: 'AA', localFingerprint: 'BB' }) === 'reject-unknown-group');
  ok('S5 成员接收创建者属性才应用', nw.jueCeXiangMuShuXingLaiYuan({ hasGroup: true, creatorFingerprint: 'AA', peerFingerprint: 'AA', localFingerprint: 'BB' }) === 'apply');
  const base = { peerFingerprint: 'AA', issuerFingerprint: 'AA', token: 't', publicKey: 'pk', subjectFp: 'S' };
  ok('S6 自签陌生批准被拒（握手≠签发者）', nw.jueCeJiaRuPiZhun({ ...base, issuerFingerprint: 'CC', pending: { token: 't' } }) === 'issuer-handshake-mismatch');
  ok('S6 无待批申请被拒', nw.jueCeJiaRuPiZhun({ ...base, pending: null }) === 'no-pending-request');
  ok('S6 token/公钥/主体不一致被拒', nw.jueCeJiaRuPiZhun({ ...base, pending: { token: 't2' } }) === 'token-mismatch'
    && nw.jueCeJiaRuPiZhun({ ...base, pending: { token: 't', subjectPublicKey: 'pk2' } }) === 'public-key-mismatch'
    && nw.jueCeJiaRuPiZhun({ ...base, pending: { token: 't', subjectFp: 'S2' } }) === 'subject-mismatch');
  ok('S6 三方一致才通过', nw.jueCeJiaRuPiZhun({ ...base, pending: { token: 't', subjectPublicKey: 'pk', subjectFp: 'S' } }) === 'ok');
  ok('gate-policy：禁止自填 verified 不再误判', JSON.stringify(gp.ruanMenJinChongTu('禁止自填 verified')) === '[]');
  ok('gate-policy：允许自填 verified 仍判 B', gp.ruanMenJinChongTu('允许自填 verified').includes('B'));
  ok('gate-policy：禁止跳过计划任务不误判', JSON.stringify(gp.ruanMenJinChongTu('禁止跳过计划任务')) === '[]');
  ok('gate-policy：无需计划任务仍判 B', gp.ruanMenJinChongTu('无需计划任务，直接做').includes('B'));
  ok('gate-policy：禁止静默执行不误判 C', JSON.stringify(gp.ruanMenJinChongTu('禁止静默执行')) === '[]');
}

/* ═══ W03 S7：逐跳 HTTPS ═══ */
{
  ok('S7 更新请求不再 redirect:follow', !/redirect: 'follow'/.test(upd));
  ok('S7 每一跳都重新校验 URL', /jiaoyanGengxinyuanUrl\(cur\)/.test(upd) && /redirect: 'manual'/.test(upd) && /too-many-redirects/.test(upd));
}

/* ═══ W04 P1/P2/P4/P5 ═══ */
{
  ok('P1 加密 JSONL 追加只读固定头（不再 readFileSync 全文件）', /只读固定头/.test(enc) && /const fdHead = orig\.openSync\(p, 'r'\)/.test(enc));
  ok('P1 只有 ENOENT 走新建，其它错误抛出', /e\.code !== 'ENOENT'\) throw e/.test(enc));
  ok('P2 历史过程 DOM 内容签名未变不重建', /__guoChengSig/.test(app) && /if \(n\.__guoChengSig === sig/.test(app));
  ok('P4 知识使用计数合并写 + dirty 可诊断', /scheduleUseSave/.test(kbSrc) && /isDirty\(\)/.test(kbSrc) && /this\.dirty = true; this\.scheduleUseSave\(\)/.test(kbSrc));
  ok('P5 向量 top-k 有界堆（不再全量 sort）', /有界 top-k 小顶堆/.test(memSrc) && !/scored\.sort\(/.test(memSrc));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-kb-'));
  const store = path.join(dir, 'knowledge-session.json');
  const k = new kb.KnowledgeBase(dir, 'session');
  k.addEvent({ id: 'ev1', biaoTi: 'x', entityIds: [], anchors: [], ts: Date.now() });
  let writes = 0;
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function (p, ...a) { if (String(p) === store) writes += 1; return realWrite.call(fs, p, ...a); };
  try {
    for (let i = 0; i < 5; i++) k.noteUse(['ev1']);
    ok('P4 连续 5 次 noteUse 不逐次整库写盘', writes === 0, { writes });
    ok('P4 未落盘时 dirty=true', k.isDirty() === true);
    const flushed = k.flush();
    ok('P4 flush 写一次且 dirty 清空', flushed === true && writes === 1 && k.isDirty() === false, { writes, dirty: k.isDirty() });
  } finally {
    fs.writeFileSync = realWrite;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/* ═══ D4：外部编辑失败保留副本 ═══ */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-ee-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const original = path.join(ws, 'a.txt');
  fs.writeFileSync(original, 'orig');
  const mgr = new ee.WaiBuBianJiGuanLiQi({ workspaceRoot: ws, manifestDir: path.join(dir, 'manifests') });
  const st = mgr.start(original);
  ok('D4 外部编辑副本已生成', st.ok === true && !!st.temp);
  fs.writeFileSync(st.temp, 'NEW-CONTENT');
  fs.rmSync(original, { force: true });
  fs.mkdirSync(original);
  const r = mgr.finishAll();
  ok('D4 回写失败被如实收集', r.failed.length === 1, r);
  ok('D4 失败后新副本仍在（不被 finally 删掉）', fs.existsSync(st.temp) && fs.readFileSync(st.temp, 'utf8') === 'NEW-CONTENT');
  ok('D4 失败后清单仍在（可恢复/重试）', fs.readdirSync(path.join(dir, 'manifests')).length === 1);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\nverify-r120-hardening: ${pass} PASS / 0 FAIL`);
