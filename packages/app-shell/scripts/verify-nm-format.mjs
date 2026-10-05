#!/usr/bin/env node
/**
 * verify-nm-format —— `.nm` 专有格式的**打包/解包往返**门禁。
 * 产品定稿：`.nm` 是我们专有的格式；导出设口令、导入必须给对口令；
 * 明文包（项目/聊天）要能让内置 `read_nm` 直接读。
 */
import crypto from 'node:crypto';
import { daBaoNm, chaiBaoNm, duXinFeng } from '../dist/nm-wen-jian.js';

let pass = 0, fail = 0;
const fails = [];
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS', label, detail ? '=> ' + String(detail).slice(0, 120) : ''); }
  else { fail++; fails.push(label); console.log('  FAIL', label, detail ? '=> ' + String(detail).slice(0, 160) : ''); }
};

console.log('[1] 加密包往返');
{
  const payload = { a: 1, zh: '中文', nested: { x: [1, 2, 3] } };
  const wen = daBaoNm('config', payload, 'pass-1234', { v: 1 });
  check('打包后是合法 JSON', (() => { try { JSON.parse(wen); return true; } catch { return false; } })());
  const xin = duXinFeng(wen);
  check('信封可读（不需口令）', !!xin, xin && xin.kind);
  check('加密包 data 不是 plain.', xin && !String(xin.data).startsWith('plain.'));
  const ming = chaiBaoNm(wen, 'pass-1234');
  check('解包后内容一致', JSON.stringify(ming.payload) === JSON.stringify(payload));
  let err = '';
  try { chaiBaoNm(wen, 'wrong-pass'); } catch (e) { err = String(e.message || e); }
  check('口令错如实报错', /bad-password/.test(err), err);
}

console.log('\n[2] 明文包（项目/聊天）');
{
  const payload = { sessionId: 's1', chat: [{ role: 'user', content: 'hi' }], files: [] };
  const wen = daBaoNm('project', payload, '', { m: 2 });
  const xin = duXinFeng(wen);
  check('明文包可读信封', !!xin);
  check('明文包 data 以 plain. 开头', xin && String(xin.data).startsWith('plain.'));
  const ming = chaiBaoNm(wen, '');   // 不需要口令
  check('明文包无口令也能解开', JSON.stringify(ming.payload) === JSON.stringify(payload));
  check('kind 正确', ming.kind === 'project');
}

console.log('\n[3] 坏包如实拒绝');
{
  let e1 = '';
  try { chaiBaoNm('not json', 'x'); } catch (e) { e1 = String(e.message || e); }
  check('非 JSON 报 bad-format', /bad-format/.test(e1), e1);
  let e2 = '';
  try { chaiBaoNm('{"format":"other","version":1,"data":"a.b.c"}', 'x'); } catch (e) { e2 = String(e.message || e); }
  check('别的格式报 bad-format', /bad-format/.test(e2), e2);
  check('坏信封返回 null', duXinFeng('{"format":"wamy-nm","version":9}') === null);
}

console.log('\n[4] 口令派生是随机 salt（两次打包密文不同）');
{
  const a = daBaoNm('config', { k: 1 }, 'pw', {});
  const b = daBaoNm('config', { k: 1 }, 'pw', {});
  check('相同明文+口令 ⇒ 密文不同（salt/iv 随机）', a !== b);
}

console.log(`\n==== verify-nm-format: ${pass} ok / ${fail} FAIL ====`);
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
