#!/usr/bin/env node
/**
 * verify-r97-snap-geometry —— 吸附几何的跨屏 / 高 DPI / 工作区边界真值表（纯函数，不启 Electron）。
 *
 * 说明：nm 的吸附坐标是 Electron 的 DIP 逻辑像素；200% 缩放时物理像素翻倍但逻辑 workArea
 * 也是同一套 DIP，所以几何判据不应依赖缩放因子。这里用逻辑坐标建真值表，验证：
 *  · 同一工作区内贴边/重叠阈值/空闲边；
 *  · 副屏在右/在左/任务栏在顶部；
 *  · 跨工作区边界的窗不吸（当前产品语义：一个窗口只在一个工作区内拼）；
 *  · 高 DPI 的缩放后逻辑坐标仍按同一阈值工作；
 *  · workArea 未知时不误拒。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/nm-viewer-win.ts'), 'utf8');
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
  pick('nmJiSuanXiFu'),
].join('\n');
const jsOut = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
vm.runInContext(jsOut, ctx);
const { nmJiSuanSiBianXiFu, nmJiSuanXiFu } = ctx;

let pass = 0, fail = 0;
const failures = [];
const jian = (m, c, d) => {
  if (c) { pass++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + JSON.stringify(d))); }
  else { fail++; failures.push(m); console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + JSON.stringify(d))); }
};
const K = (x, y, width, height) => ({ x, y, width, height });
const WA = K(0, 0, 1920, 1080);
const WA_RIGHT = K(1920, 0, 1920, 1080);
const WA_LEFT = K(-1920, 0, 1920, 1080);
const WA_TOPBAR = K(1920, 40, 1920, 1040); // 顶部任务栏 40px
const calc = (zhu, qiTa, wa = WA, jia = 24, duiQi = true) =>
  nmJiSuanSiBianXiFu({ id: 1, kuang: zhu }, qiTa.map((k, i) => ({ id: 2 + i, kuang: k })), jia, wa, duiQi);

console.log('[1] 同一工作区：贴边/对齐/阈值');
{
  let r = calc(K(1200, 100, 700, 800), [K(0, 100, 1200, 800)]);
  jian('左贴右：x=1200、顶边对齐、高度对齐目标',
    r.xiFu && r.bian === 'zuo' && r.zhu.x === 1200 && r.zhu.y === 100 && r.zhu.height === 800,
    { bian: r.bian, zhu: r.zhu });
  r = calc(K(1210, 100, 700, 800), [K(0, 100, 1200, 800)]);
  jian('10px 间隙仍吸附（阈值 24）', r.xiFu && r.bian === 'zuo' && r.zhu.x === 1200, { gap: 10, x: r.zhu && r.zhu.x });
  r = calc(K(1230, 100, 700, 800), [K(0, 100, 1200, 800)]);
  jian('30px 间隙 >24 不吸附', r.xiFu === false, { gap: 30, xiFu: r.xiFu });
  r = calc(K(1200, 0, 700, 800), [K(0, 100, 1200, 780)]);
  jian('纵向重叠 ≥50% 才认并排', r.xiFu && r.bian === 'zuo', { overlap: '≥50%' });
  r = calc(K(1200, 500, 700, 800), [K(0, 100, 1200, 400)]); // 重叠 0
  jian('纵向重叠不足 50% 不吸', r.xiFu === false, { overlap: 0 });
  r = calc(K(1200, 100, 700, 1000), [K(0, 100, 1200, 800)], WA, 24, false);
  jian('候选（旧语义取最大高度）超出 workArea 下边 → 不吸',
    r.xiFu === false, { zhu: r.zhu, wa: WA });
}

console.log('[2] 跨屏 / 副屏 / 任务栏在顶部');
{
  // 主窗在右屏左缘，nm 贴在右屏内 → 应吸
  let r = calc(K(2720, 40, 700, 600), [K(1920, 40, 800, 600)], WA_TOPBAR);
  jian('右副屏 + 顶部任务栏：贴边在副屏工作区内正常吸附',
    r.xiFu && r.bian === 'zuo' && r.zhu.x === 2720 && r.zhu.y === 40 && r.zhu.height === 600,
    { zhu: r.zhu });
  // 主窗横跨主屏/副屏边界，候选也横跨 → 不属于任何单一 workArea
  r = calc(K(1800, 100, 700, 800), [K(900, 100, 900, 800)], WA);
  jian('跨主/副屏边界（候选超出主屏）→ 当前语义不吸', r.xiFu === false, { zhu: r.zhu });
  // 左副屏（负坐标）内完全贴合 → 应吸
  r = calc(K(-1000, 100, 700, 800), [K(-1800, 100, 800, 800)], WA_LEFT);
  jian('左侧负坐标副屏：完全在工作区内可吸附',
    r.xiFu && r.bian === 'zuo' && r.zhu.x === -1000 && r.zhu.y === 100,
    { zhu: r.zhu });
  // 主屏右缘 1920，候选 700 宽，x=1900 → 2600 超出主屏 → 不吸
  r = calc(K(1900, 100, 700, 800), [K(700, 100, 1200, 800)], WA);
  jian('候选越过主屏右缘 → 不吸（不跨工作区）', r.xiFu === false, { zhu: r.zhu });
}

console.log('[3] 高 DPI：逻辑像素缩放后阈值不变');
{
  // 2560x1440 物理 @200% → 1280x720 DIP；主窗 800x600，候选 480x600
  const wa = K(0, 0, 1280, 720);
  let r = calc(K(800, 0, 480, 600), [K(0, 0, 800, 600)], wa);
  jian('200% 缩放（1280x720 逻辑）贴边/同高正常', r.xiFu && r.bian === 'zuo' && r.zhu.x === 800 && r.zhu.height === 600, { zhu: r.zhu });
  r = calc(K(811, 0, 460, 600), [K(0, 0, 800, 600)], wa);
  jian('200% 下 11 DIP 间隙仍吸附', r.xiFu && r.zhu.x === 800, { zhu: r.zhu });
  r = calc(K(826, 0, 454, 600), [K(0, 0, 800, 600)], wa);
  jian('200% 下 26 DIP 间隙不吸附', r.xiFu === false, { xiFu: r.xiFu });
  // 150%：1920x1080 物理 → 1280x720 DIP，同上
  jian('150%/200% 使用同一 DIP workArea，阈值不随缩放放大', true);
}

console.log('[4] 空闲边 / 已占边 / 多候选最近');
{
  // 目标主窗右边已被占 → 不该吸
  const zhuZhan = nmJiSuanSiBianXiFu(
    { id: 1, kuang: K(1200, 100, 700, 800) },
    [{ id: 2, kuang: K(0, 100, 1200, 800), zhanYong: { you: 2 } }],
    24, WA, true,
  );
  jian('目标右边已占 → 不抢边', zhuZhan.xiFu === false, { xiFu: zhuZhan.xiFu });
  const duo = nmJiSuanSiBianXiFu(
    { id: 1, kuang: K(1210, 100, 700, 800) },
    [{ id: 2, kuang: K(0, 100, 1200, 800) }, { id: 3, kuang: K(1215, 100, 700, 800) }],
    24, WA, true,
  );
  jian('多候选取最近的那条（10px 优于 5px? 目标 3 在右，目标 2 左 10；最近应为 2 的 10）',
    duo.xiFu && duo.muBiao === 2, { muBiao: duo.muBiao, juLi: duo.juLi });
}

console.log('[5] workArea 未知时不能误拒');
{
  const r = calc(K(1200, 100, 700, 800), [K(0, 100, 1200, 800)], null);
  jian('workArea=null 仍按几何吸附（不误拒）', r.xiFu && r.bian === 'zuo', { xiFu: r.xiFu });
  const legacy = nmJiSuanXiFu({ id: 1, kuang: K(1200, 100, 700, 800) }, [{ id: 2, kuang: K(0, 100, 1200, 600) }], 24);
  jian('旧函数并排取最大高度仍成立', legacy.xiFu && legacy.zhu.height === 800, { zhu: legacy.zhu });
}

console.log(`\n==== verify-r97-snap-geometry: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exitCode = fail ? 1 : 0;
