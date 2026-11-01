/**
 * 第 44 轮：长文副本防护（`write_file` 与 `copy_file` 共用一套判定）
 *
 * 为什么要专门一支：真机 r34-mimo 里小说已经写完（5945 字），模型为了"自己数一遍/取个尾"
 * 先写了 `get_tail.ps1`，再用 **`copy_file`** 把整篇拷成 `novel_full.txt` ⇒ 同一次任务里两份一模一样的长文。
 * 老防护只挂在 `write_file` 上，换条工具路就绕开了。补防护最容易犯的错是**把用户真需求的复制也拦掉**，
 * 所以这支门禁跑的是**真值表**（拦什么、放什么），全部打在纯函数上，不靠钉源码措辞。
 *
 * 用法：node dev/gates/verify-r44-fuzhi.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = await import('../../packages/app-shell/dist/chang-wen-fu-zhi.js')
  .catch(() => import(path.join(GEN, 'packages/app-shell/dist/chang-wen-fu-zhi.js')));
const { jingZiShu, chongHeLv, shiChangWenFuBen, fuBenBoHuiWen, CHANG_WEN_XIAN } = M;

const jie = [];
const jian = (ming, ok, xiang) => { jie.push({ ming, ok: ok === true, xiang }); };
const CHANG = ('无限牛马的故事'.repeat(120));  // 660 字×… ⇒ 稳过 800 净字门槛
const XIN_YI = ('另一篇完全不同的文字'.repeat(120));

const zheng = (p) => shiChangWenFuBen({ neiRong: CHANG, muBiaoYiCunZai: false, wenBenLei: true, yongHuYaoFuBen: false, yiQueRen: false, zhuiJia: false, chongHe: 1, ...p });

// ── ① 该拦的：整篇原样另存/复制 ──
jian('整篇原样另存成新文件 ⇒ 拦（重合 100%、目标不存在、文本类、够长）', zheng({}) === true);
jian('重合 80% 刚好到线 ⇒ 拦', zheng({ chongHe: 0.8 }) === true);
jian('重合 79% ⇒ 放（改写过的就不算副本）', zheng({ chongHe: 0.79 }) === false);

// ── ② 必须放的：每一条逃生口单独验（防护挡住真需求比少拦一次更坏）──
jian('用户原话就要一份副本 ⇒ 放', zheng({ yongHuYaoFuBen: true }) === false);
jian('模型带 overwrite:true 明确确认 ⇒ 放', zheng({ yiQueRen: true }) === false);
jian('追加写（append:true）不是另存 ⇒ 放', zheng({ zhuiJia: true }) === false);
jian('目标文件已存在 ⇒ 这里不管（那是覆盖，归别的防护）', zheng({ muBiaoYiCunZai: true }) === false);
jian('源/目标是同一个文件 ⇒ 放', zheng({ tongYiWenJian: true }) === false);
jian('非文本类（复制图片/压缩包）⇒ 放', zheng({ wenBenLei: false }) === false);
jian('短文（< 800 净字）⇒ 放：同一任务里顺手写的短文件不算长文副本', zheng({ neiRong: '很短的一段说明文字' }) === false);

// ── ③ 算法本身：净字数与重合率 ──
jian('jingZiShu 不计空白与换行（含换行的算法会把 5493 字当 6000 字）',
  jingZiShu('a b\tc\nd e\n') === 5 && jingZiShu('  ') === 0 && jingZiShu('牛马工作') === 4);
jian('同一篇文自己跟自己重合 = 1', chongHeLv(CHANG, CHANG) === 1);
jian('另一篇完全不同内容的重合率很低（<0.2）⇒ 不会被误判成副本', chongHeLv(CHANG, XIN_YI) < 0.2);
jian('旧文短于一个切片 ⇒ 视为完全重合（保守：宁可拦明显的整篇搬运）', chongHeLv('短文', CHANG) === 1);
jian('长文按 ~400 切片抽样，不逐位比较（性能口径）', (() => {
  const chaoChang = ('甲乙丙丁戊己庚辛壬癸'.repeat(40000));
  const t0 = Date.now();
  chongHeLv(chaoChang, chaoChang);
  return Date.now() - t0 < 1200;
})());

// ── ④ 拦下时给模型看的话：占位符必须换干净（本轮刚踩过 {k}/{y} 漏替换）──
const MO_BAN = '{q} 与 {p} 重合 {r}%，{q} 是副本';
const hua = fuBenBoHuiWen(MO_BAN, 'D:/旧文.txt', 'D:/新文.txt', 0.831);
jian('回给模型的说明里不许留着没替换的占位符', !/\{[a-z]+\}/i.test(hua) && /83%/.test(hua) && hua.indexOf('D:/新文.txt') === 0, hua);
jian('重复出现的占位符要**全部**替换（串形式 replace 只换第一处这个坑本轮踩过两次）',
  (hua.match(/D:\/新文\.txt/g) || []).length === 2);
jian('门槛常量与判定用的是同一个数（800）', CHANG_WEN_XIAN === 800 && zheng({ neiRong: 'x'.repeat(CHANG_WEN_XIAN) }) === true);

// ── ⑤ 接线：两条工具路都得走这同一个判定（call-graph，不钉措辞）──
const ZHU = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const jianZhong = (ZHU.match(/shiChangWenFuBen\(/g) || []).length;
jian('主进程确实调用这个判定（不是只写了个函数没人调）', jianZhong >= 1, '调用 ' + jianZhong + ' 处');
jian('copy_file 那条工具路也接在这个判定上（防护不许只挂 write_file）',
  /function changWenFuZhiLanCongFuZhi/.test(ZHU)
  && (ZHU.match(/changWenFuZhiLanCongFuZhi\(/g) || []).length >= 2
  && /ming === 'copy_file'/.test(ZHU));

jian('重合率算法只有一份实现（主进程不许再写一个 chongHeLv）',
  (ZHU.match(/function chongHeLv/g) || []).length === 0 && (ZHU.match(/function jingZiShu/g) || []).length === 0);

let hong = 0;
for (const x of jie) { if (!x.ok) hong++; console.log(`  ${x.ok ? 'ok  ' : 'FAIL'} ${x.ming}${x.ok ? '' : '  ← ' + JSON.stringify(x.xiang)}`); }
console.log(`\n==== verify-r44-fuzhi：${jie.length - hong} ok / ${hong} FAIL ====`);
process.exit(hong ? 1 : 0);
