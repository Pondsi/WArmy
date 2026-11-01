/**
 * verify-r110-replies —— 第 110 轮：
 *   1) 计划证据不再把「txt 文档」误判成必须生成 .docx；
 *   2) 每次模型回复独立保留（不再覆盖上一条），操作按发生时间归到对应回复；
 *   3) 整轮真正结束（含主进程续派收尾）只播一次完成提示音；
 *   4) 语音整理中的输入框特效、再点话筒取消、晚到结果按世代丢弃、下一次仍整理整个输入框。
 *
 * 纯本地；不启动 Electron、不联网、不写真实 profile。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('packages/app-shell/src/electron-main.ts');
const app = read('packages/app-shell/src/renderer/app.js');
const css = read('packages/app-shell/src/renderer/app.css');
const preload = read('packages/app-shell/src/preload.cjs');
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const bodyOf = (src, startRe, endRe) => {
  const i = src.search(startRe);
  if (i < 0) return '';
  const rest = src.slice(i);
  const j = rest.search(endRe);
  return j < 0 ? rest : rest.slice(0, j);
};

/* ═══ 1. 计划证据：txt 文档 ≠ Word 文档 ═══════════════════════════════ */
{
  const m = main.match(/function buZhouXuYaoZhengJu\([\s\S]*?\n\}/);
  assert.ok(m, '找不到 buZhouXuYaoZhengJu');
  const js = ts.transpileModule(m[0], { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const fn = new Function('yaoQiuZiShu', `${js}; return buZhouXuYaoZhengJu;`)(() => 0);
  const txt = fn('生成桌面 txt 文档');
  ok('「txt 文档」只要求 txt 证据，不再要求 .docx', txt.zu.length === 1 && txt.zu[0][0] === 'txt' && !txt.zu.some((g) => g.includes('docx')));
  ok('负向：旧正则「文档 ⇒ docx」会让这条断言变红', (() => {
    const old = (s) => { const zu = []; if (/txt|文本|记事本/i.test(s)) zu.push(['txt']); if (/docx?|word|文档/i.test(s)) zu.push(['doc', 'docx']); return zu; };
    return old('生成桌面 txt 文档').some((g) => g.includes('docx'));
  })());
  ok('「Word 文档」仍要求 docx 证据', fn('生成 Word 文档').zu.some((g) => g.includes('docx')));
  ok('「.docx」仍要求 docx 证据', fn('生成报告.docx').zu.some((g) => g.includes('docx')));
  ok('等待/打开证据仍能识别', fn('等待 3 秒').deng === true && fn('打开两个文件').kai === true);
}

/* ═══ 2. 回复保留：写入路径不再覆盖上一条，界面按时间排 ═══════════════ */
{
  const pushBody = bodyOf(main, /function zhuiJiaLiaoTianRiZhi/, /\/\*\* 纯标点\/零宽不入账/);
  ok('主进程写入不再合并/改写上一条 assistant 正文',
    /每一次模型回复都单独落一条/.test(pushBody)
    && !/last\.content\s*=\s*String\(last\.content/.test(pushBody)
    && !/entry as \{ mergeWithPrev/.test(pushBody));
  ok('主进程不再把续派轮的 reasoningDuan/zhongJian 塞进上一条',
    !/last\.reasoningDuan\s*=/.test(pushBody) && !/last\.zhongJian\s*=/.test(pushBody));
  const afterLog = bodyOf(main, /try \{ ZHU_LIU_SHI\.delete/, /if \(knowledge/);
  ok('每发落账后清空主进程思考分段（下一发不会重复上一发的思考）', /zhuSiKaoQing\(String\(sessionId/.test(afterLog));
  ok('负向：删掉清空后检测器变红', !/zhuSiKaoQing\(String\(sessionId/.test(afterLog.replace(/try \{ zhuSiKaoQing\(String\(sessionId[^\n]*\n?/, '')));
  ok('渲染层合并后按 ts 升序，且本地推送也排序',
    /quChong\.sort\(\(a, b\) => \(Number\(a\.ts\) \|\| 0\) - \(Number\(b\.ts\) \|\| 0\)\)/.test(app)
    && /yuanYou\.sort\(\(a, b\) => \(Number\(a\.ts\) \|\| 0\) - \(Number\(b\.ts\) \|\| 0\)\)/.test(app));
  ok('操作归属使用 guiShuMuBiao，不再整轮归最后一条',
    /function guiShuMuBiao/.test(app) && /guiShuMuBiao\(thems, yongHuTs, liuShiNode/.test(app) && !/lastThemOfTurn/.test(app));
}

/* guiShuMuBiao 真值表：一轮多条回复 / 流式 / 跨用户轮 */
{
  const m = app.match(/function guiShuMuBiao\([\s\S]*?\n  \}/);
  assert.ok(m, '找不到 guiShuMuBiao');
  const fn = new Function(`${m[0]}; return guiShuMuBiao;`)();
  const node = (t) => ({ dataset: { ts: String(t) } });
  const a1 = node(600), a2 = node(1200), stream = node(0);
  assert.equal(fn([a1, a2], [100], null, 0, 500), a1, 'A1 生成期间的操作归 A1');
  assert.equal(fn([a1, a2], [100], null, 0, 700), a2, 'A1 落地后的操作归下一条 A2');
  assert.equal(fn([a1, a2], [100], stream, 1500, 1400), stream, '最后一条回复之后的新操作归流式气泡');
  assert.equal(fn([a1, a2], [100], stream, 1500, 500), a1, '流式气泡不能抢更早回复的操作');
  assert.equal(fn([a1, a2], [100, 1000], null, 0, 1100), a2, '下一用户轮的操作归下一轮');
  assert.equal(fn([a1, a2], [100, 1000], null, 0, 900), a1, '上一轮尾部操作不跑进下一轮');
  ok('guiShuMuBiao 真值表：A1/A2/流式/跨轮边界', true);
}

/* ═══ 3. 完成提示音：整轮真结束只响一次（含主进程续派收尾）═══════════ */
{
  const guan = bodyOf(app, /function yunXingZhuangTaiGuan/, /function deliver\s*\(/);
  ok('完成音统一在 yunXingZhuangTaiGuan 播，按 run 去重', /run\.yinXiangBoGuo/.test(guan) && /chuanBoYinXiao\('complete', 'round-end'\)/.test(guan));
  ok('完成音受设置开关和会话静音控制，群聊不响', /chengGong === true/.test(guan) && /shouldNotify\(sid\)/.test(guan) && /lei !== 'internal' && lei !== 'extgroup'/.test(guan));
  ok('deliver 不再重复播完成音（只留失败音）', /huiBao === false\) \{\s*void chuanBoYinXiao\('error'\)/.test(app) && !/huiBao === true\) void chuanBoYinXiao\('complete'\)/.test(app));
  ok('endOfRound 不再用旧振荡器补播完成音', !/playNotifySound\('complete'\)/.test(app));
  ok('负向：去掉去重标记后断言变红', !/run\.yinXiangBoGuo/.test(guan.replace(/run\.yinXiangBoGuo/g, 'run.x')));
}

/* ═══ 4. 语音整理：整体整理 / 取消 / 晚到结果丢弃 / 特效 ═══════════════ */
{
  const m = app.match(/function zhengLiJieGuoKeYong\([\s\S]*?\n  \}/);
  assert.ok(m, '找不到 zhengLiJieGuoKeYong');
  const fn = new Function(`${m[0]}; return zhengLiJieGuoKeYong;`)();
  ok('结果世代真值表：同一发有效 / 取消无效 / 旧世代无效', fn(3, 3, false) === true && fn(3, 3, true) === false && fn(2, 3, false) === false && fn(0, 0, false) === false);
  const shouWei = bodyOf(app, /async function yuYinShouWei/, /function yuYinJieShu/);
  ok('整理始终提交整个输入框原文', /const yuan = String\(ru\.value \|\| ''\)/.test(shouWei) && /text: yuan/.test(shouWei) && !/zt\.jiBen/.test(shouWei));
  ok('请求带 requestId，结果按世代/取消判断后才写回', /requestId: rid/.test(shouWei) && /zhengLiJieGuoKeYong\(dai, yuYinZhengLiDai, zt\.zhengLiQuXiao === true\)/.test(shouWei));
  ok('取消时立即发 IPC 中止并清空本发请求号', /window\.warmy\.zhengLiQuXiao\?\.\(\{ requestId: rid \}\)/.test(app) && /yuYinZhengLiQingQiuId = ''/.test(app));
  ok('话筒点击优先处理整理中取消，再处理录音中停止', (() => {
    const a = app.indexOf("if (yuYinZhengLiZhong) { quXiaoZhengLi(); return; }");
    const b = app.indexOf('if (yuYinZhuangTai) { yuYinJieShu(); return; }', a);
    return a > 0 && b > a;
  })());
  ok('主进程按 requestId 可中止上游模型（含换链前检查）', /zhengLiQingQiu = new Map<string, AbortController>/.test(main) && /warmy:zhengLiQuXiao/.test(main) && /wenTeShuMoXing\('organizer'[\s\S]{0,2000}ctrl\?\.signal/.test(main));
  ok('preload 暴露取消通道', /zhengLiQuXiao: \(p\) => ipcRenderer\.invoke\('warmy:zhengLiQuXiao'/.test(preload));
  ok('输入框特效：逐字层 + 粒子层 + 主题色 + 减少动态', /zhengLiTeXiaoKai/.test(app) && /zhengLiZi/.test(css) && /zhengLiTeXiaoHua/.test(css) && /var\(--accent\)/.test(css) && /prefers-reduced-motion/.test(css));
  ok('有整理特效时话筒不再叠呼吸/波纹', /btn\.classList\.remove\('jiLuZhong', 'jieLianZhong'\)/.test(app) && /#anNiuYuYin\.zhengLiZhong[\s\S]{0,200}animation: none/.test(css));
  ok('10 个语言包都有整理/取消文案', (() => {
    const dir = path.join(root, 'packages/app-shell/src/i18n');
    const files = fs.readdirSync(dir).filter((f) => /^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(f));
    if (files.length < 10) return false;
    for (const f of files) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (typeof j['chat.voiceOrganizingStopTip'] !== 'string' || !j['chat.voiceOrganizingStopTip'].trim()) return false;
      if (typeof j['chat.voiceReorgStop'] !== 'string' || !j['chat.voiceReorgStop'].trim()) return false;
    }
    return true;
  })());
}

console.log(`\nverify-r110-replies: ${pass} PASS / 0 FAIL`);
