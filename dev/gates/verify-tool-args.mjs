/**
 * verify-tool-args.mjs — 工具参数归一 / 自动补扩展名 结构断言
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wt = fs.readFileSync(path.join(root, 'packages/app-shell/src/work-tools.ts'), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

check('has quLuJingCanShu', wt.includes('export function quLuJingCanShu'));
check('has buKuoZhanMing', wt.includes('export function buKuoZhanMing'));
check('accepts file alias', /file/.test(wt) && /filePath/.test(wt) && /filename/.test(wt));
check('write_file default path', wt.includes("args.path = 'output-'") || wt.includes('output-'));
check('make_pptx auto ext', wt.includes("buKuoZhanMing(String(args.path || 'slides')"));
check('make_docx auto ext', wt.includes("buKuoZhanMing(String(args.path || 'document')"));
check('runWorkTool normalizes', wt.includes('quLuJingCanShu(args)'));

const em = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
/**
 * 契约更新：整轮**不再按墙上时间一刀切**（真机事故：写 5000 字/跑长构建这类"一直在推进"
 * 的任务在第 10 分钟被 600s 无条件掐断 ⇒ 降级到本地模型 ⇒ 用户看到"重活完不成"）。
 * 现在两把尺子：连续 `KONG_ZHUAN_MS` 零产出才算卡住 + `YING_DING_MS` 硬顶兜死循环。
 */
check('工具循环按进展计时（5 分钟零产出才算卡住，30 分钟硬顶兜底）',
  em.includes('KONG_ZHUAN_MS = 5 * 60 * 1000') && em.includes('YING_DING_MS = 30 * 60 * 1000') && em.includes('zhengLunQuXiao'));
/**
 * 死板墙钟超时的**实现**必须已经没了（`tool-loop-timeout(600s)` 这个词还留在注释里当历史事故，
 * 所以判据用旧的实现标识符 `zhengLunShiChao` + 旧结论串，而不是"注释里不许提到 600s"）。
 */
check('旧的死板 600s/180s 墙钟实现已移除', !em.includes('zhengLunShiChao') && !/tingZhiLiYou = `tool-loop-timeout/.test(em));

const app = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('no interrupted hint bubble', !app.includes("escapeHtml(tOr('chat.resumeTaskHint'"));
check('resume button centered class', app.includes('huiFuRenWuJuZhong'));

const css = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
check('css centers resume button', css.includes('huiFuRenWuJuZhong'));

const eta = fs.readFileSync(path.join(root, 'packages/app-shell/src/eta-forecast.ts'), 'utf8');
/** 单次工具调用的尺子：**120 秒 / 12 次**（原 60s/3 会把下载、构建、多步同名工具调用误判成异常） */
check('ETA gongJu 120s/12（不是旧的 60s/3）', /gongJu:\s*\{[\s\S]{0,80}miao:\s*120\s*\*\s*1000/.test(eta) && /lun:\s*12/.test(eta) && !/gongJu:\s*\{[\s\S]{0,80}miao:\s*60\s*\*\s*1000/.test(eta));
check('ETA CHAO_SHI 9', eta.includes('CHAO_SHI_LIAN_XU_XIAN = 9'));
check('ETA PAN_MO_XING 5', eta.includes('PAN_MO_XING_SHANG_XIAN = 5'));
check('ETA YANXU 40/20min', em.includes('YANXU_YUJING_CI = 40') && em.includes('20 * 60 * 1000'));

/**
 * ============ 第 51/52 轮：工具结果**静默截断**修复钉住 ============
 * 事故：read_file 结果被宿主 `slice(0, 4000)` 一刀切走、**截断处零提示** ⇒ 模型以为看到全文，
 * 对没看到的后半段没法定点编辑 ⇒ 撞 search_files / run_shell 共 602 秒零产出 ⇒ 判红。
 * 修法只许「在同一上限内如实告知 + 给续读分页」，**不许抬高上限、不许放宽判据**。
 */
const { pathToFileURL } = await import('node:url');
const sk = await import(pathToFileURL(path.join(root, 'packages/app-shell/dist/jie-guo-shou-kou.js')).href);
const wtMod = await import(pathToFileURL(path.join(root, 'packages/app-shell/dist/work-tools.js')).href);
check('纯模块导出了收口函数', typeof sk.jieGuoShouWei === 'function' && typeof sk.readFileXuDu === 'function');

/** ① 装得下 ⇒ 一字不改（不能给短结果凭空加行） */
check('未超限原样返回', sk.jieGuoShouWei('abc', 4000) === 'abc');
/** ② 超限 ⇒ 如实告知，且总长仍不超上限（注入量恒定：先预留后截断） */
const chang = '甲'.repeat(9000);
const shou = sk.jieGuoShouWei(chang, 4000, 'read_file');
check('超限时总长不超上限', shou.length <= 4000);
check('超限时如实告知看不到的字数', shou.includes('[结果不完整]') && shou.includes('你看不到'));
check('告知数字自洽（放出+未见=原文）', (() => {
  const m = shou.match(/只放出前 (\d+) 字[^\d]*?后面 (\d+) 字/);
  return !!m && Number(m[1]) + Number(m[2]) === 9000;
})());
/** ③ 上限夹得住：配置被写成畸形值也不许放大到无界 */
check('畸形上限仍收口', sk.jieGuoShouWei('乙'.repeat(5000), Number.NaN).length <= 4000);

/** ④ 续读游标真值表：段首提示行不是正文，算游标必须先扣掉它（长度当场算，别写死） */
const yiQi = '[本段是第 0~1000 字符，原文共 7411 字符]\n';
const yuanChang = yiQi.length + 1000;
const zhengWen520 = 520 - yiQi.length;
check('样例本身有效（提示行短于放出量）', yiQi.length > 0 && zhengWen520 > 0 && zhengWen520 < 520);
const g1 = sk.readFileXuDu({ tool: 'read_file', path: 'youxi.html', offset: 0, bodyChars: 1000 }, yuanChang, 520);
check(`游标=真正放出的正文（${zhengWen520}，不是把提示行算进去的 520）`, g1.includes(`offset=${zhengWen520}`));
check('游标不许跳过没显示的字（退化写法 520 判红）', !g1.includes('offset=520'));
const g2 = sk.readFileXuDu({ tool: 'read_file', path: 'f', offset: 3000, bodyChars: 1000 }, yuanChang, 10);
check('只看到提示行时退回重叠读（不前进=不跳字）', g2.includes('offset=3000') && !/offset=3\d{4}/.test(g2.replace('offset=3000', '')));
check('非 read_file 不编造游标', !sk.readFileXuDu({ tool: 'run_shell' }, 100, 50).includes('offset='));
check('出错的 read_file 不编造游标', !sk.readFileXuDu({ tool: 'read_file', error: 'not-found' }, 100, 50).includes('offset='));

/** ④b 提示行自己**不许再被切一刀**（固定预留会把「offset=N」切在半截数字上 = 等于没修） */
for (const shang of [200, 404, 1000, 4000]) {
  const chang = shang * 3;
  const o = sk.jieGuoShouWei('字'.repeat(chang), shang, 'read_file', (k) => sk.readFileXuDu({ tool: 'read_file', path: 'youxi.html', offset: 0, bodyChars: chang }, chang + 40, k));
  check(`上限 ${shang}：总长不越线`, o.length <= shang);
  check(`上限 ${shang}：offset 与「只放出前 N 字」都完整送到位`, /offset=\d+/.test(o) && /只放出前 \d+ 字/.test(o) && o.includes('你看不到'));
}

/** ④c 告知的放出量必须**等于实际放出的正文**（谎报=新的看不见），且默认量级下正文不许被提示行挤光 */
for (const shang of [200, 404, 1000, 4000, 8000]) {
  const chang = shang * 3;
  const o = sk.jieGuoShouWei('字'.repeat(chang), shang, 'read_file', (k) => sk.readFileXuDu({ tool: 'read_file', path: 'youxi.html', offset: 0, bodyChars: chang }, chang + 40, k));
  const dm = o.match(/只放出前 (\d+) 字/);
  const ge = o.lastIndexOf('\n[结果不完整]');
  const shiJi = ge >= 0 ? ge : 0;
  check(`上限 ${shang}：说的放出量=实际放出量`, !!dm && Number(dm[1]) === shiJi);
  if (shang >= 1000) check(`上限 ${shang}：提示行不许把正文挤到不足 8 成`, !!dm && Number(dm[1]) >= shang * 0.8);
}

/** ⑤ 端到端覆盖：一页页读，**读过的正文区间必须连续覆盖全文**（允许重叠，不许缺口） */
const wen = 'W'.repeat(2500);
let off = 0, hu = 0, duan = [], bing = true;
while (off < wen.length && hu++ < 30) {
  const xian = wen.slice(off, off + 1000);
  const beiQie = wen.length - off > xian.length;
  const tou = beiQie ? `[本段是第 ${off}~${off + xian.length} 字符，原文共 ${wen.length} 字符]\n` : '';
  const nei = tou + xian;
  const out = sk.jieGuoShouWei(nei, 404, 'read_file', (k) => sk.readFileXuDu({ tool: 'read_file', path: 'f', offset: off, bodyChars: xian.length }, nei.length, k));
  if (out.length > 404) { bing = false; break; }
  const kM = out.match(/只放出前 (\d+) 字/);
  const fangKai = kM ? Number(kM[1]) : nei.length;
  const fuChu = Math.max(0, Math.min(xian.length, fangKai - tou.length));
  duan.push([off, off + fuChu]);
  const nM = [...out.matchAll(/offset=(\d+)/g)];
  if (!nM.length) break;
  const next = Number(nM[nM.length - 1][1]);
  if (next <= off && fuChu > 0) { bing = false; break; }
  off = next;
}
check('分段读覆盖连续无缺口（拼起来等于全文）', (() => {
  if (!bing) return false;
  duan.sort((a, b) => a[0] - b[0]);
  let zhi = 0;
  for (const [s, e] of duan) { if (s > zhi) return false; zhi = Math.max(zhi, e); }
  return zhi >= wen.length;
})());
check('分段读能在若干页内读完', hu < 30 && bing);

/** ⑥ 结构锚：裸切必须消失（把旧写法加回去就红） */
check('主进程不再有裸 slice(wr.content)', !/return String\(wr\.content(?: \|\| '')?\)\.slice\(0, ctx\.zuiDaJieGuoZiShu\);/.test(em));
check('干活工具结果接线了截断审计', em.includes("'chat.result-truncated'") && em.includes("'group.result-truncated'"));
const wt2 = wt;
check('read_file 有 offset 分页（实现+参数面）', /Number\(args\?\.offset\)/.test(wt2) && /offset:\s*\{\s*type:\s*'number'/.test(wt2));
check('续读提示写在**段首**（尾巴会被再切一刀，写段尾等于没写）', /content:\s*tou\s*\+\s*xian/.test(wt2) && !/content:\s*xian\s*\+\s*tou/.test(wt2));
/** ④d **行为**断言（文字锚会骗人：把引导写进字符串但分支永不进入，锚照样绿） */
const os = await import('node:os');
const muLu = fs.mkdtempSync(path.join(os.tmpdir(), 'r52-toolargs-'));
try {
  const yuan = `${'A'.repeat(1000)}${'B'.repeat(1000)}${'C'.repeat(502)}`;
  fs.writeFileSync(path.join(muLu, 'big.txt'), yuan);
  const zaiDuan = (r) => r.content.slice(r.content.length - (Number(r.meta.bodyChars) || 0));
  const p1 = wtMod.workReadFile(muLu, { path: 'big.txt', maxChars: 1000 });
  const p2 = wtMod.workReadFile(muLu, { path: 'big.txt', maxChars: 1000, offset: 1000 });
  const p3 = wtMod.workReadFile(muLu, { path: 'big.txt', maxChars: 1000, offset: 2000 });
  check('offset 分页三段拼起来=原文（不丢字不重叠错位）', zaiDuan(p1) + zaiDuan(p2) + zaiDuan(p3) === yuan);
  /** 游标只看语义（下一段该从哪读），不锚具体文案 —— 文案改了也不该假红 */
  const youDu = (r) => { const mm = String(r.content).split('\n')[0].match(/offset=(\d+)/); return mm ? Number(mm[1]) : Number.NaN; };
  check('段首游标=已放出正文的末尾位置', youDu(p1) === 1000 && youDu(p2) === 2000);
  check('读到末尾不再给游标', Number.isNaN(youDu(p3)) && p3.meta.truncated === false);
  check('最后一段如实说已到末尾', p3.meta.truncated === false && !/offset=2502/.test(p3.content));
  check('不传 offset 时与旧行为逐字一致（前 1000 字）', zaiDuan(p1) === yuan.slice(0, 1000));
  check('offset 越过末尾如实说没有内容', /已到\/超过文件末尾/.test(wtMod.workReadFile(muLu, { path: 'big.txt', offset: 99999 }).content));
  const sWen = wtMod.workSearchFiles(muLu, { query: 'BBB', path: 'big.txt' });
  const sCw = `${String(sWen.meta?.error || '')}${String(sWen.content || '')}`;
  check('search_files 传文件⇒真给出可执行出路（提到 read_file+offset）', sWen.ok === false && /read_file/.test(sCw) && /offset/.test(sCw));
  check('search_files 传目录照旧能搜', wtMod.workSearchFiles(muLu, { query: 'BBB', path: '.' }).ok === true);
} finally {
  fs.rmSync(muLu, { recursive: true, force: true });
}
/** ⑦ 反向护栏：不许靠"把上限调大"来让任务变容易（那等于换掉我们测的东西） */
check('每条结果默认上限仍是 4000（没被抬高）', /zuiDaJieGuoZiShu: Number\.isFinite\(mei\) \? Math\.min\(8000, Math\.max\(200, Math\.floor\(mei\)\)\) : 4000/.test(em));
check('read_file 工具侧上限仍是 20000（没被抬高）', /maxReadChars:\s*20000/.test(wt2));

console.log(`RESULT ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
