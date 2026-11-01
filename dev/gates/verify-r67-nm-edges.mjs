/**
 * 第 67 轮项 19：nm 四边吸附（纯几何真值表）+ 只读缩放/拖动的静态锚点。
 *
 * 只从 `packages/app-shell/src/nm-viewer-win.ts` 里摘纯函数/常量，用 vm 跑；
 * 不需要 Electron，也不会碰真实桌面窗口。
 *
 * 真窗口联动由 verify-r65-nm-pair-live / verify-r62-ui 覆盖；本门禁不冒充真机。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/nm-viewer-win.ts'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/nm-viewer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/nm-viewer.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/nm-viewer.css'), 'utf8');

const tree = ts.createSourceFile('nm.ts', SRC, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const pick = (name) => {
  let out = null;
  const walk = (n) => {
    if (out) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n.getText(tree);
    else if (ts.isVariableStatement(n)) {
      const text = n.getText(tree);
      if (new RegExp('const\\s+' + name + '\\b').test(text)) out = text;
    }
    if (!out) ts.forEachChild(n, walk);
  };
  walk(tree);
  if (!out) throw new Error('missing ' + name);
  return out.replace(/^\s*export\s+/gm, '');
};

const ctx = vm.createContext({});
const code = [
  pick('NM_XI_FU_JIA'),
  pick('NM_BIAN_DUI'),
  pick('NM_SI_BIAN'),
  pick('bianBeiZhan'),
  pick('kuangZaiWorkArea'),
  pick('nmJiSuanSiBianXiFu'),
  pick('nmBianHaiXiangLin'),
  pick('nmBianLiLianTong'),
].join('\n');
const jsOut = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
vm.runInContext(jsOut, ctx);

const jisuan = (zhu, qiTa, jia, wa) => ctx.nmJiSuanSiBianXiFu(zhu, qiTa, jia, wa);
const xiangLin = (a, b, bian, jia) => ctx.nmBianHaiXiangLin(a, b, bian, jia);
const bfs = (start, linJu) => ctx.nmBianLiLianTong(start, linJu);

let ok = 0;
const bad = [];
const jian = (m, t, x) => {
  if (t) { ok += 1; console.log('PASS ' + m); }
  else { bad.push(m); console.log('FAIL ' + m + (x ? ' ← ' + JSON.stringify(x).slice(0, 400) : '')); }
};
const kuang = (x, y, width, height) => ({ x, y, width, height });
const DUI = { shang: 'xia', you: 'zuo', xia: 'shang', zuo: 'you' };
const WA = kuang(0, 0, 2400, 1400);

/* 1. 四边各挂一个：一扇主窗口（id=-1）同时吸住上/右/下/左四个邻窗 */
{
  const C = { id: -1, kuang: kuang(500, 300, 600, 500), zhanYong: { shang: null, you: null, xia: null, zuo: null } };
  const ren = [
    { id: 1, kuang: kuang(1110, 300, 400, 500), zhanYong: { zuo: null } }, // 右
    { id: 2, kuang: kuang(90, 300, 400, 500), zhanYong: { you: null } },   // 左
    { id: 3, kuang: kuang(500, 810, 600, 300), zhanYong: { shang: null } },// 下
    { id: 4, kuang: kuang(500, 90, 600, 200), zhanYong: { xia: null } },   // 上
  ];
  // 顺序吸：每次只把这次结果写回占用，验证四条边都能各自成立
  const order = [];
  for (let k = 0; k < 4; k += 1) {
    const r = jisuan(C, ren, 24, WA);
    if (!r.xiFu) break;
    order.push(r.bian);
    C.zhanYong[r.bian] = r.muBiao;
    const o = ren.find((x) => x.id === r.muBiao);
    if (o) o.zhanYong[r.duiBian] = C.id;
  }
  const links = { ...C.zhanYong };
  jian('四边可各吸一个（顺序吸满 4 条边）', order.length === 4 && new Set(order).size === 4, { order, links });
  jian('四条边分别登记到正确邻窗', links.shang === 4 && links.you === 1 && links.xia === 3 && links.zuo === 2, links);
  jian('四个邻窗各自反向指回主窗口', ren.every((o) => {
    const bian = Object.keys(C.zhanYong).find((b) => C.zhanYong[b] === o.id);
    return !!bian && o.zhanYong[DUI[bian]] === -1;
  }), ren);
  // 五号窗也贴在右边、间隙更小：右边已占 ⇒ 不吸（先来的不被挤掉）
  const r5 = jisuan(C, [{ id: 5, kuang: kuang(1105, 300, 400, 500), zhanYong: { zuo: null } }], 24, WA);
  jian('右边已占：后来的更近也不吸（不挤掉先来的）', r5.xiFu === false, r5);
}

/* 2. 每边独占：目标窗的对边已被占 ⇒ 不吸 */
{
  const C = { id: 1, kuang: kuang(100, 100, 500, 500), zhanYong: { you: null } };
  const B = { id: 2, kuang: kuang(610, 100, 500, 500), zhanYong: { zuo: 99 } };
  const r = jisuan(C, [B], 24, WA);
  jian('目标窗对边已占 ⇒ 不吸', r.xiFu === false, r);
}

/* 3. 只吸最近的一条边；被占的边直接跳过，换下一条空闲边 */
{
  const C = { id: 1, kuang: kuang(500, 300, 600, 500), zhanYong: { you: 7 } };
  const R = { id: 2, kuang: kuang(1105, 300, 400, 500), zhanYong: { zuo: null } }; // 间隙 5，但右边已占
  const L = { id: 3, kuang: kuang(90, 300, 400, 500), zhanYong: { you: null } };   // 间隙 10
  const r = jisuan(C, [R, L], 24, WA);
  jian('右边已占时改吸左边（不占别的边）', r.xiFu && r.muBiao === 3 && r.bian === 'zuo', r);
  const C2 = { id: 1, kuang: kuang(500, 300, 600, 500), zhanYong: {} };
  const L2 = { id: 3, kuang: kuang(90, 300, 400, 500), zhanYong: {} };
  const R2 = { id: 2, kuang: kuang(1120, 300, 400, 500), zhanYong: {} };
  const r2 = jisuan(C2, [R2, L2], 24, WA);
  jian('两条边都空时只吸间隙更小的那条（10 < 20）', r2.xiFu && r2.bian === 'zuo' && r2.muBiao === 3, r2);
}

/* 4. 重叠不足 50% / 间隙超 24px ⇒ 不吸 */
{
  const C = { id: 1, kuang: kuang(100, 100, 500, 500) };
  const r1 = jisuan(C, [{ id: 2, kuang: kuang(610, 600, 500, 500) }], 24, WA); // 纵向只重叠 0
  jian('纵向重叠不足 50% ⇒ 不吸', r1.xiFu === false, r1);
  const r2 = jisuan(C, [{ id: 3, kuang: kuang(625, 100, 500, 500) }], 24, WA); // 间隙 25
  jian('间隙 25px（>24）⇒ 不吸', r2.xiFu === false, r2);
  const r3 = jisuan(C, [{ id: 4, kuang: kuang(624, 100, 500, 500) }], 24, WA); // 间隙 24
  jian('间隙 24px（=阈值）⇒ 吸住', r3.xiFu === true && r3.bian === 'you', r3);
}

/* 5. workArea 边界：放不下就不吸，放得下才吸 */
{
  const wa = kuang(0, 0, 1200, 800);
  const C = { id: 1, kuang: kuang(900, 100, 300, 500) };
  const R = { id: 2, kuang: kuang(1210, 100, 300, 500) };
  const r = jisuan(C, [R], 24, wa);
  jian('吸附后越出 workArea 右边界 ⇒ 不吸', r.xiFu === false, r);

  const C2 = { id: 3, kuang: kuang(300, 100, 300, 300) };
  const R2 = { id: 4, kuang: kuang(610, 100, 300, 300) };
  const r2 = jisuan(C2, [R2], 24, wa);
  jian('workArea 内放得下 ⇒ 正常吸', r2.xiFu && r2.muBiao === 4, r2);

  const C3 = { id: 5, kuang: kuang(300, 250, 300, 500) };
  const B3 = { id: 6, kuang: kuang(300, 760, 300, 300) };
  const r3 = jisuan(C3, [B3], 24, wa);
  jian('吸附后越出 workArea 下边界 ⇒ 不吸', r3.xiFu === false, r3);

  const C4 = { id: 7, kuang: kuang(300, 100, 300, 300) };
  const L4 = { id: 8, kuang: kuang(-10, 100, 300, 300) };
  const r4 = jisuan(C4, [L4], 24, wa);
  jian('邻窗本身越出 workArea 左边界 ⇒ 不吸', r4.xiFu === false, r4);
}

/* 6. 主窗口 id=-1 是平等参与者：两边都能互相吸 */
{
  const zhu = { id: -1, kuang: kuang(100, 100, 500, 400) };
  const nm = { id: 9, kuang: kuang(610, 100, 400, 400) };
  const a = jisuan(zhu, [nm], 24, WA);
  jian('主窗口吸 nm（主窗口在左，吸右边）', a.xiFu && a.muBiao === 9 && a.bian === 'you', a);
  const b = jisuan(nm, [zhu], 24, WA);
  jian('nm 吸主窗口（nm 在右，吸左边）', b.xiFu && b.muBiao === -1 && b.bian === 'zuo', b);
}

/* 7. 并排高度拉平；上下各自高度不变（保留旧产品语义） */
{
  const C = { id: 1, kuang: kuang(100, 100, 400, 500) };
  const R = { id: 2, kuang: kuang(510, 180, 300, 300) };
  const r = jisuan(C, [R], 24, WA);
  jian('并排吸附：顶边对齐、两边同高（取最大）', r.xiFu && r.zhu && r.lin
    && r.zhu.y === 100 && r.lin.y === 100 && r.zhu.height === 500 && r.lin.height === 500, r);
  const C2 = { id: 3, kuang: kuang(100, 100, 400, 500) };
  const B2 = { id: 4, kuang: kuang(100, 610, 400, 300) };
  const r2 = jisuan(C2, [B2], 24, WA);
  jian('上下吸附：各自高度不变', r2.xiFu && r2.zhu && r2.lin
    && r2.zhu.height === 500 && r2.lin.height === 300, r2);
}

/* 8. 边贴边判定按"这一条边"算，不拿别的边凑数 */
{
  const a = kuang(100, 100, 400, 400);
  const b = kuang(510, 100, 400, 400);
  jian('a 的右边确实贴着 b 的左边', xiangLin(a, b, 'you', 24) === true);
  jian('a 的左边没有贴着 b（不能误判）', xiangLin(a, b, 'zuo', 24) === false);
  jian('拖开 100px 后右边不再算相邻', xiangLin({ ...a, x: 200 }, b, 'you', 24) === false);
}

/* 9. 连通分量 BFS：环 + 自环也只走一遍，不重复、不死循环 */
{
  const graph = new Map([
    [1, [2, 4, 1]],
    [2, [1, 3, 5]],
    [3, [2, 4]],
    [4, [3, 1]],
    [5, [2]],
    [6, [6]],
  ]);
  const order = bfs(1, (id) => graph.get(id) || []);
  const uniq = new Set(order);
  jian('BFS 覆盖整个连通分量', order.length === 5 && [1, 2, 3, 4, 5].every((x) => uniq.has(x)), order);
  jian('BFS 不重复访问（含 2×2 环与自环）', order.length === uniq.size, order);
  jian('BFS 不会把不连通的自环节点带进来', !uniq.has(6), order);
  const onlySelf = bfs(7, () => [7]);
  jian('孤立节点/自环立即结束', onlySelf.length === 1 && onlySelf[0] === 7, onlySelf);
}

/* 10. 渲染层：不用 style.zoom，滚轮/拖动/范围/媒体排除的锚点必须在 */
jian('nm-viewer.js 不再使用 style.zoom', !/\.style\.zoom\b/.test(JS));
jian('视图用 transform scale/translate（不是改 layout）',
  /style\.transform/.test(JS) && /scale\(/.test(JS) && /translate\(/.test(JS));
jian('缩放范围 0.25–5', /Math\.min\(5,\s*Math\.max\(0\.25/.test(JS));
jian('滚轮监听 passive:false 且以鼠标位置为焦点',
  /addEventListener\('wheel',[\s\S]{0,500}\{ passive: false \}\)/.test(JS) && /clientX: e\.clientX, clientY: e\.clientY/.test(JS));
jian('左键拖动用 pointer capture', /pointerdown/.test(JS) && /setPointerCapture/.test(JS) && /pointermove/.test(JS) && /pointerup/.test(JS));
jian('音频/视频不接管滚轮与拖动',
  /zt\.leiXing === 'audio' \|\| zt\.leiXing === 'video'/.test(JS) && /return; \/\/ native|音频\/视频/.test(JS));
jian('文档内容层包装 #kuaiNei（缩放不作用在滚动容器上）', /id="kuaiNei"/.test(HTML) && /el\('kuaiNei'\)/.test(JS));
jian('只读拖动光标/禁用触摸手势的 CSS 在位', /\.nmKeTuo\s*\{[^}]*cursor:\s*grab/.test(CSS) && /touch-action:\s*none/.test(CSS));
jian('工具栏仍然禁止横向滚动（窄窗不溢出）',
  /#gongJuLan\s*\{[\s\S]{0,240}overflow:\s*hidden/.test(CSS) && !/#gongJuLan\s*\{[^}]*overflow-x:\s*auto/.test(CSS));
jian('打印时去掉屏幕缩放（纸张不跟着放大/平移）', /#kuaiNei, #wenBen, #gaoLiang, #shiLiuNei \{ transform: none !important; \}/.test(CSS));

console.log(`\n==== verify-r67-nm-edges: ${ok} PASS / ${bad.length} FAIL ====`);
if (bad.length) console.log(bad.map((x) => '  ✗ ' + x).join('\n'));
process.exit(bad.length ? 1 : 0);
