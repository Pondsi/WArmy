/**
 * 第 20 轮 · CSS 覆盖门禁
 *
 * index.html 先加载 app.css、再加载 renderer.css ⇒ **同名选择器后者赢**。
 *
 * 真机事故（任务5）：计划任务竖条在 app.css 里早就按产品要求改好了
 * （未完成=强调色 / 完成=无条 / 受阻=删除线），但 renderer.css 里还留着旧的一套
 * （done 绿条、blocked 红条、doing 黄条）。renderer.css 后加载，把正确规则整组盖掉，
 * 于是用户反馈「之前让你做过，你说做好了，但我没有看到效果」——
 * 代码确实改了，改的是**不生效的那一份**。
 *
 * 这类问题没有任何编译器会报，只能靠门禁。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-css.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = path.join(GEN, 'packages/app-shell/src/renderer');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const duCss = (f) => fs.readFileSync(path.join(R, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 抽出「选择器 → 声明块」，只取顶层规则（忽略 @media 等包装层内的同名规则） */
function chouGuiZe(wen) {
  const out = new Map();
  const zheng = /(^|[\n}])\s*([^@{}\n][^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = zheng.exec(wen))) {
    const xuan = m[2].trim().replace(/\s+/g, ' ');
    if (!xuan || xuan.startsWith('@')) continue;
    for (const one of xuan.split(',').map((s) => s.trim()).filter(Boolean)) {
      const arr = out.get(one) || [];
      arr.push(m[3].trim());
      out.set(one, arr);
    }
  }
  return out;
}

console.log('\nCSS 覆盖门禁（app.css → renderer.css，后者赢）');

const appGui = chouGuiZe(duCss('app.css'));
const renGui = chouGuiZe(duCss('renderer.css'));

/**
 * **跨文件冲突**：两份都定义同一个选择器**同一个属性**，且取值不同 ⇒
 * app.css 那条永远不生效，是"改了看不到效果"的温床。
 */
const shuXing = (kuai) => {
  const m = new Map();
  for (const d of kuai.split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    m.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return m;
};

const chongTu = [];
for (const [xuan, renKuai] of renGui) {
  const appKuai = appGui.get(xuan);
  if (!appKuai) continue;
  const a = shuXing(appKuai.join(';'));
  const b = shuXing(renKuai.join(';'));
  /**
   * 归一后再比：`40px` 与 `40px !important` 取值相同，只是权重不同，不算冲突；
   * 真正要抓的是**取值不同**、导致 app.css 那条永远不生效的情况。
   */
  const gui1 = (v) => String(v || '').replace(/\s*!important\s*$/i, '').replace(/\s+/g, ' ').trim();
  for (const [k, av] of a) {
    if (!b.has(k)) continue;
    if (gui1(b.get(k)) !== gui1(av)) chongTu.push(`${xuan} { ${k}: app=${av} / renderer=${b.get(k)} }`);
  }
}
/**
 * 既有的跨文件冲突是**存量债务**，以前没有门禁、已经存在了很久；
 * 本轮只把它们**如实列出**（报告，不判红），新增的产品规则另有下面的正向断言兜底。
 * 想要收紧时，把 `chongTu` 改成判红即可。
 */
console.log(`  [报告] 存量跨文件冲突 ${chongTu.length} 条（app.css 那条被 renderer.css 盖掉，取值不同）`);
for (const c of chongTu.slice(0, 8)) console.log('         · ' + c);
if (chongTu.length > 8) console.log(`         …另有 ${chongTu.length - 8} 条`);
/** 计划竖条绝不能再出现在冲突清单里（本轮修过的那一组） */
shuo(!chongTu.some((c) => c.startsWith('.jiHuaBu')), '计划任务竖条不再有跨文件冲突');

// 计划任务竖条：产品定稿的正向断言（两份都要对）
console.log('\n计划任务竖条（产品定稿）');
for (const f of ['app.css', 'renderer.css']) {
  const wen = duCss(f);
  const qu = (st) => {
    const m = wen.match(new RegExp('\\.jiHuaBu\\[data-st="' + st + '"\\]\\s*\\{([^}]*)\\}', 'g'));
    return m ? m[m.length - 1] : '';   // 取最后一条（真正生效的那条）
  };
  shuo(/var\(--accent\)/.test(qu('pending')), `${f}：pending = 强调色竖条`);
  shuo(/var\(--accent\)/.test(qu('doing')), `${f}：doing = 强调色竖条`, qu('doing'));
  shuo(/transparent/.test(qu('done')), `${f}：done = 无色竖条`);
  shuo(/transparent/.test(qu('verified')), `${f}：verified = 无色竖条`);
  const bl = qu('blocked');
  shuo(/transparent/.test(bl) && /line-through/.test(bl), `${f}：blocked = 无色竖条 + 删除线`);
}

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
