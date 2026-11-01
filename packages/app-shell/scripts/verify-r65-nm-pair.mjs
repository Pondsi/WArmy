/**
 * 第 65 轮 项 25：nm 两窗吸附几何（离线真值表）。
 * 只验证"算出来的框/方向/是否还算相邻"；真实窗口联动由 r62-ui 真机档覆盖主窗吸附，
 * 两窗联动仍需要在真机上点一次（本门禁不冒充）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/nm-viewer-win.ts'), 'utf8');
const tree = ts.createSourceFile('nm.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const pick = (name) => {
  let out = null;
  const walk = (n) => {
    if (out) return;
    if ((ts.isFunctionDeclaration(n) || ts.isVariableStatement(n))) {
      const text = n.getText(tree);
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = text;
      if (ts.isVariableStatement(n) && text.includes('const ' + name)) out = text;
    }
    if (!out) ts.forEachChild(n, walk);
  };
  walk(tree);
  if (!out) throw new Error('missing ' + name);
  return out.replace(/^\s*export\s+/gm, '');
};
const ctx = vm.createContext({});
const ju = ts.transpileModule(
  [pick('NM_XI_FU_JIA'), pick('nmJiSuanXiFu'), pick('nmHaiXiangLin')].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText;
vm.runInContext(ju, ctx);
const jisuan = (zhu, qiTa, jia) => ctx.nmJiSuanXiFu(zhu, qiTa, jia);
const xiangLin = (a, b, jia) => ctx.nmHaiXiangLin(a, b, jia);

let ok = 0; const bad = [];
const jian = (m, t, x) => { if (t) { ok++; console.log('PASS ' + m); } else { bad.push(m); console.log('FAIL ' + m + (x ? ' ← ' + JSON.stringify(x).slice(0, 300) : '')); } };

/* 1. 左右相隔 10px、纵向重叠过半 ⇒ 并排吸附，顶边对齐、高度拉平 */
{
  const a = { id: 1, kuang: { x: 100, y: 100, width: 800, height: 600 } };
  const b = { id: 2, kuang: { x: 910, y: 140, width: 700, height: 500 } };
  const r = jisuan(a, [b], 24);
  jian('左右 10px ⇒ 吸附到邻居左边（拖动窗在左）', r.xiFu && r.muBiao === 2 && r.fangXiang === 'zuo', r);
  jian('并排后两窗顶边对齐且同高', r.zhu && r.lin && r.zhu.y === r.lin.y && r.zhu.height === r.lin.height && r.zhu.height === 600, r);
  jian('并排后没有缝：拖动窗右边 = 邻居左边', r.zhu && r.zhu.x + r.zhu.width === 910, r.zhu);
}

/* 2. 左右相隔 30px（>24）⇒ 不吸 */
{
  const r = jisuan({ id: 1, kuang: { x: 100, y: 100, width: 800, height: 600 } }, [{ id: 2, kuang: { x: 930, y: 100, width: 700, height: 600 } }], 24);
  jian('间隔 30px 超过阈值 ⇒ 不吸附', r.xiFu === false && r.muBiao === null, r);
}

/* 3. 上下相隔 10px、横向重叠过半 ⇒ 下方吸附，且各自高度不变 */
{
  const r = jisuan({ id: 1, kuang: { x: 100, y: 100, width: 800, height: 600 } }, [{ id: 2, kuang: { x: 120, y: 710, width: 700, height: 500 } }], 24);
  jian('上下 10px ⇒ 吸附到邻居上方（拖动窗在上）', r.xiFu && r.muBiao === 2 && r.fangXiang === 'shang', r);
  jian('上下吸附不拉平高度（各管各的）', r.zhu && r.lin && r.zhu.height === 600 && r.lin.height === 500, r);
}

/* 4. 吸附后仍算相邻；被拖开 100px 后不算 */
{
  const a = { x: 910, y: 100, width: 800, height: 600 };
  const b = { x: 100, y: 100, width: 810, height: 600 };
  jian('吸附后仍判定为相邻', xiangLin(a, b, 24) === true);
  jian('拖开 100px 后判定为不相邻', xiangLin({ ...a, x: 1010 }, b, 24) === false);
}

/* 5. 主界面作为目标（id=-1）也能吸；靠近不吸别人 */
{
  const r = jisuan({ id: 1, kuang: { x: 910, y: 100, width: 800, height: 600 } }, [{ id: -1, kuang: { x: 100, y: 100, width: 810, height: 600 } }], 24);
  jian('主界面目标 id=-1 能吸（只移动 nm 自己）', r.xiFu && r.muBiao === -1 && r.fangXiang === 'you', r);
}

/* 6. 负向：两窗大面积重叠但边不贴 ⇒ 不吸（防"一打开就粘住"） */
{
  const r = jisuan({ id: 1, kuang: { x: 100, y: 100, width: 800, height: 600 } }, [{ id: 2, kuang: { x: 200, y: 200, width: 800, height: 600 } }], 24);
  jian('重叠但不贴边 ⇒ 不吸附', r.xiFu === false, r);
}

console.log(`\n==== verify-r65-nm-pair: ${ok} PASS / ${bad.length} FAIL ====`);
if (bad.length) console.log(bad.map((x) => '  ✗ ' + x).join('\n'));
process.exit(bad.length ? 1 : 0);
