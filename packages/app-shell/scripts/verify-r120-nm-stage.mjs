#!/usr/bin/env node
/**
 * verify-r120-nm-stage.mjs —— P7：`.nm` 预览与导入共用**一次**解包。
 *
 * 验行为：
 *   A. prepare → commit 全程只解包一次（nmStats.unpacked === 1），导入结果正确；
 *   B. 令牌绑定包哈希：预览后包被换掉 → package-changed，拒绝提交；
 *   C. 令牌绑定数据状态版本：预览后另一个导入已提交 → state-changed；
 *   D. 令牌绑定选择范围：提交时范围与预览不同 → selection-changed；
 *   E. 无效/已用令牌不能重放；预览后取消（dispose）不留临时目录；
 *   F. 旧 importNm 兼容路径同样只解一次。
 *
 * 临时目录 + 随机密钥 + 合成内容；不读真实 profile；结束清理。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DataVault, inspectNmPackage } = await import(pathToFileURL(path.join(pkg, 'dist', 'data-vault.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const clean = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };
const protector = { available: () => true, protect: (s) => Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s, 'base64').toString() };
const mk = (userData) => {
  const v = new DataVault({ userData, protector });
  v.setMasterKey(crypto.randomBytes(32));
  v.markUnsealed();
  return v;
};
const stageDirs = () => {
  const pre = `warmy-nm-stage-${process.pid}-`;
  return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(pre)).length;
};

const srcA = temp('warmy-r120-nm-srcA-');
const srcB = temp('warmy-r120-nm-srcB-');
const out = temp('warmy-r120-nm-out-');
try {
  fs.mkdirSync(path.join(srcA, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(srcA, 'settings.json'), JSON.stringify({ 主题: '深色', marker: 'A' }));
  fs.writeFileSync(path.join(srcA, 'memory', 'chat.jsonl'), '{"id":"m1","text":"第一行"}\n');
  const vaultA = mk(srcA);
  const nmA = path.join(out, 'a.nm');
  const ex = await vaultA.exportNm(nmA, { plain: true, include: ['settings', 'chat'], owner: 'fp-test-owner' });
  ok('测试包导出成功', ex.ok === true && fs.existsSync(nmA), ex);
  const ins = inspectNmPackage(nmA);
  ok('W06 清单记录 schemaVersion/owner/integrity', ins.ok && ins.schemaVersion === 2 && ins.owner === 'fp-test-owner' && ins.integrity === 'gzip', ins);
  ok('W06 清单记录未包含的依赖（chat → knowledge）', Array.isArray(ins.dependencies) && ins.dependencies.includes('knowledge'), ins.dependencies);
  const nmEnc = path.join(out, 'enc.nm');
  const exEnc = await vaultA.exportNm(nmEnc, { kroot: Buffer.alloc(32, 7), include: ['contacts'], owner: 'fp-enc-owner' });
  const insEnc = inspectNmPackage(nmEnc);
  ok('W06 密文包记录 aes-gcm 完整性与依赖（contacts → settings）',
    exEnc.ok && insEnc.integrity === 'aes-256-gcm' && insEnc.dependencies.includes('settings') && insEnc.owner === 'fp-enc-owner', insEnc);

  /* F. 旧 importNm 兼容路径：一次解包 */
  const userF = temp('warmy-r120-nm-userF-');
  const vF = mk(userF);
  const rF = await vF.importNm(nmA, { include: ['settings'] });
  ok('importNm 兼容路径导入成功', rF.ok === true, rF);
  ok('importNm 兼容路径只解包一次', vF.nmStats.unpacked === 1, vF.nmStats);
  ok('importNm 兼容路径恢复了 settings', (() => {
    try { return JSON.parse(fs.readFileSync(path.join(userF, 'settings.json'), 'utf8')).marker === 'A'; } catch { return false; }
  })());
  clean(userF);

  /* A. prepare → commit：一次解包 + 结果正确 */
  const userA = temp('warmy-r120-nm-userA-');
  const vA = mk(userA);
  const preA = await vA.prepareNm(nmA, { include: ['settings', 'chat'] });
  ok('prepare 返回令牌与统计', preA.ok === true && !!preA.token && preA.files >= 2, preA);
  const chkA = await vA.validateNmStage(preA.token);
  ok('prepare 后令牌可验证', chkA.ok === true, chkA);
  const beforeDirs = stageDirs();
  const cA = await vA.commitNm(preA.token, { include: ['settings', 'chat'] });
  ok('commit 成功', cA.ok === true, cA);
  ok('prepare+commit 只解包一次', vA.nmStats.unpacked === 1, vA.nmStats);
  ok('prepare+commit 统计 prepared=1 committed=1', vA.nmStats.prepared === 1 && vA.nmStats.committed === 1, vA.nmStats);
  ok('提交后暂存目录已删除', stageDirs() === beforeDirs - 1, { beforeDirs, after: stageDirs() });
  ok('提交后 settings 内容正确',
    JSON.parse(fs.readFileSync(path.join(userA, 'settings.json'), 'utf8')).marker === 'A');
  ok('已提交令牌不能重放', (await vA.validateNmStage(preA.token)).ok === false);

  /* C. 状态版本绑定：两个预览，先提交一个，另一个必须失效 */
  fs.mkdirSync(path.join(srcB, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(srcB, 'settings.json'), '{"marker":"B"}');
  const vaultB = mk(srcB);
  const nmB = path.join(out, 'b.nm');
  await vaultB.exportNm(nmB, { plain: true, include: ['settings'] });
  const userC = temp('warmy-r120-nm-userC-');
  const vC = mk(userC);
  const t1 = await vC.prepareNm(nmA, { include: ['settings'] });
  const t2 = await vC.prepareNm(nmA, { include: ['settings'] });
  ok('同一包可以准备两个独立令牌', t1.ok && t2.ok && t1.token !== t2.token);
  ok('先提交第一个令牌', (await vC.commitNm(t1.token, { include: ['settings'] })).ok === true);
  const chk2 = await vC.validateNmStage(t2.token);
  ok('数据状态已变 → 第二个令牌失效', chk2.ok === false && /state-changed/.test(String(chk2.error)), chk2);
  ok('失效令牌不能提交', (await vC.commitNm(t2.token, { include: ['settings'] })).ok === false);
  clean(userC);

  /* B. 包哈希绑定：预览后替换包 */
  const userD = temp('warmy-r120-nm-userD-');
  const vD = mk(userD);
  const tPkg = await vD.prepareNm(nmB, { include: ['settings'] });
  fs.copyFileSync(nmA, nmB); // 同路径换成另一个合法包
  const chkPkg = await vD.validateNmStage(tPkg.token);
  ok('包被换掉 → package-changed', chkPkg.ok === false && /package-changed/.test(String(chkPkg.error)), chkPkg);
  ok('包被换掉后不能提交', (await vD.commitNm(tPkg.token, { include: ['settings'] })).ok === false);
  clean(userD);

  /* D. 选择范围绑定 */
  const userE = temp('warmy-r120-nm-userE-');
  const vE = mk(userE);
  const tSel = await vE.prepareNm(nmA, { include: ['settings'] });
  const rSel = await vE.commitNm(tSel.token, { include: ['chat'] });
  ok('提交时范围与预览不同 → selection-changed', rSel.ok === false && /selection-changed/.test(String(rSel.error)), rSel);
  vE.disposeNm(tSel.token);
  clean(userE);

  /* E. 无效令牌 + dispose 清理 */
  const userG = temp('warmy-r120-nm-userG-');
  const vG = mk(userG);
  ok('随机令牌无效', (await vG.validateNmStage('deadbeef')).ok === false);
  ok('随机令牌不能提交', (await vG.commitNm('deadbeef', {})).ok === false);
  const before = stageDirs();
  const tDrop = await vG.prepareNm(nmA, { include: ['settings'] });
  ok('预览后暂存目录存在', stageDirs() === before + 1, { before, after: stageDirs() });
  vG.disposeNm(tDrop.token);
  ok('dispose 后暂存目录删除', stageDirs() === before, { before, after: stageDirs() });
  ok('dispose 后令牌无效', (await vG.commitNm(tDrop.token, { include: ['settings'] })).ok === false);
  clean(userG);

  console.log(`\nverify-r120-nm-stage: ${pass} PASS / 0 FAIL`);
} finally {
  clean(srcA); clean(srcB); clean(out);
}
