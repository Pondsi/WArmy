#!/usr/bin/env node
/**
 * verify-subagents —— 「牛马派小弟」验证（**真跑**，含落盘与上限）。
 *
 * 产品语义：每只牛马干活时可自行分出子代理，名字固定为「牛马的名字 + 小弟X号」。
 * 本脚本断言：命名规则、编号跳号、上限、落盘登记、列表排序、未知工具不抛错。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'subagents.js');
if (!fs.existsSync(dist)) {
  console.error('缺少构建产物，请先 build：' + dist);
  process.exit(2);
}
const S = await import(pathToFileURL(dist).href);

let pass = 0, fail = 0;
const failures = [];
function check(l, c, d) {
  const s = d === undefined ? '' : ` => ${typeof d === 'string' ? d : JSON.stringify(d)}`;
  if (c) { pass++; console.log(`  [PASS] ${l}${s}`); }
  else { fail++; failures.push(l); console.log(`  [FAIL] ${l}${s}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-xiaodi-'));

console.log('[1] 命名规则：牛马的名字 + 小弟X号');
{
  const a = S.xiaDiHao('阿黄', []);
  check('第一个小弟 = 阿黄-小弟1号', a.ming === '阿黄-小弟1号' && a.hao === 1, a);
  const b = S.xiaDiHao('阿黄', ['阿黄-小弟1号']);
  check('第二个 = 阿黄-小弟2号', b.ming === '阿黄-小弟2号' && b.hao === 2, b);
  const c = S.xiaDiHao('牛牛', []);
  check('不同父牛马各自从 1 号开始', c.ming === '牛牛-小弟1号', c);
  const d = S.xiaDiHao('', []);
  check('空父名 → 结构化失败', 'error' in d && /empty-parent-name/.test(d.error), d);
}

console.log('\n[2] 编号跳号（已占用则顺延）');
{
  const a = S.xiaDiHao('阿黄', ['阿黄-小弟1号', '阿黄-小弟2号', '阿黄-小弟5号']);
  check('跳过已占用，取最小空号 3', a.hao === 3 && a.ming === '阿黄-小弟3号', a);
  const b = S.xiaYiHao(['阿黄-小弟1号', '别的-小弟9号'], '阿黄');
  check('只认同父名的小弟', b === 2, b);
}

console.log('\n[3] 上限保护');
{
  const many = Array.from({ length: S.XIAO_DI_SHANG_XIAN }, (_, i) => `阿黄-小弟${i + 1}号`);
  const r = S.xiaDiHao('阿黄', many);
  check(`达到上限 ${S.XIAO_DI_SHANG_XIAN} ⇒ 拒绝`, 'error' in r && /too-many-subagents/.test(r.error), r);
}

console.log('\n[4] 登记簿：落盘 + 列表 + 持久化');
{
  const f = path.join(tmp, 'xiaodi.json');
  const bu = new S.XiaoDiDengJiBu(f);
  const p1 = bu.pai('阿黄', 1700000000000);
  check('派出第 1 个', p1.ok === true && p1.lu.ming === '阿黄-小弟1号', p1);
  const p2 = bu.pai('阿黄', 1700000001000);
  check('派出第 2 个', p2.ok === true && p2.lu.ming === '阿黄-小弟2号', p2);
  check('列表按编号升序', bu.list('阿黄').map((x) => x.hao).join(',') === '1,2', bu.list('阿黄'));
  check('别名父名不受影响', bu.list('牛牛').length === 0);
  check('真的写盘了', fs.existsSync(f));
  // 新开一个实例：编号应续上
  const bu2 = new S.XiaoDiDengJiBu(f);
  const p3 = bu2.pai('阿黄', 1700000002000);
  check('重启后续号为 3（不会重复 1/2）', p3.ok === true && p3.lu.hao === 3, p3);
  check('id 唯一', new Set([p1.lu.id, p2.lu.id, p3.lu.id]).size === 3);
  check('记录带父名与时间', p1.lu.fuMing === '阿黄' && p1.lu.createdAt === 1700000000000, p1.lu);
}

console.log('\n[5] 工具规格（给模型看的）');
{
  const specs = S.xiaoDiToolSpecs();
  const names = specs.map((s) => s.function.name).sort();
  check('暴露 spawn_subagent / list_subagents', names.includes('spawn_subagent') && names.includes('list_subagents') && names.length === 2, names);
  check('spawn_subagent 必填 task', JSON.stringify(specs.find((s) => s.function.name === 'spawn_subagent').function.parameters.required) === '["task"]');
  check('isXiaoDiTool 判定正确', S.isXiaoDiTool('spawn_subagent') === true && S.isXiaoDiTool('list_subagents') === true && S.isXiaoDiTool('write_file') === false);
  check('【安全】子代理共用工作区（工具里没有额外写盘/执行入口）', !names.some((n) => /exec|run|shell|cmd/i.test(n)), names);
}

console.log('\n[6] 边界：怪输入不抛错');
{
  let ok = true;
  try {
    S.xiaDiHao(null, null);
    S.xiaDiHao('x', [null, '', 'x-小弟abc号']);
    new S.XiaoDiDengJiBu(path.join(tmp, 'nope', 'deep', 'x.json')).pai('');
  } catch { ok = false; }
  check('null/空/畸形输入全部不抛错', ok);
}

console.log(`\n==== verify-subagents: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
process.exit(fail ? 1 : 0);
