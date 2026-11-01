/**
 * verify-r82-hu-chi —— 知识库 / 模型可改提示词的“互斥放置”口径
 *
 * 用户 2026-10-25 口径：
 *  · 互斥组 = 知识库（会话/内部/私密）+ 模型会自动改写的提示词（术、印象）；
 *    同一内容只能出现在其中一处；归档时一条内容只能放进一个位置。
 *  · 提示词旧内容被替换 ⇒ 旧内容先写进知识库，再写新内容。
 *  · 规范、道、教条、束缚、认知**不参与互斥**，允许和知识库/其它提示词重复。
 *
 * 本门禁：
 *  ① 纯函数真值表（同义判定、位置判定、豁免表）；
 *  ② 代码接线：术/印象写入前查互斥、裁剪/替换前先迁知识库；
 *  ③ 归档提炼事件先过滤；knowledge_add 拒绝重复写；
 *  ④ 模型提示词与工具说明都写了这条规则。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAINJS = path.join(PKG, 'dist', 'electron-main.js');
const MAIN = fs.readFileSync(path.join(PKG, 'src', 'electron-main.ts'), 'utf8');
const TOOLS = fs.readFileSync(path.join(PKG, 'src', 'work-tools.ts'), 'utf8');
const PURE = path.join(PKG, 'dist', 'prompt-placement.js');

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400)));
};

try {
  if (!fs.existsSync(PURE)) throw new Error('缺少 dist/prompt-placement.js（先构建）');
  const m = await import(pathToFileURL(PURE).href);
  const { shiTongYiNeiRong, shiZhanWeiChongFu, zhaoHuChiWeiZhi, shiHuChiTiShiCeng, HU_CHI_TI_SHI_CENG, BU_HU_CHI_TI_SHI_CENG } = m;

  /* ── ① 同义判定真值表 ── */
  jian('同一条内容：标点/空白不同仍算同一条',
    shiTongYiNeiRong('以后都用中文回复。', '以后都用中文回复') === true);
  jian('同一条内容：长文包含短文（短文 ≥8 字）算同一条',
    shiTongYiNeiRong('以后都用中文回复，别再用英文', '以后都用中文回复') === true);
  jian('短短语（<8 字）不被长文误判',
    shiTongYiNeiRong('先查后问', '每次都要先查资料再回答问题') === false);
  jian('不同内容不误判',
    shiTongYiNeiRong('以后都用中文回复', '不要自动提交代码') === false);
  jian('空值不误判', shiTongYiNeiRong('', '随便什么') === false && shiTongYiNeiRong(null, 'x') === false);
  jian('跨库判重用严格相等：旧+新要求的超集不算重复（否则永远无法替换）',
    shiZhanWeiChongFu('以后都用中文回复，不要用英文', '以后都用中文回复') === false
    && shiZhanWeiChongFu('以后都用中文回复。', '以后都用中文回复') === true);

  /* ── ② 位置判定 ── */
  const w = '以后都用中文回复';
  jian('已在知识库 ⇒ 判为 knowledge',
    zhaoHuChiWeiZhi(w, { knowledge: ['以后都用中文回复。'] }) === 'knowledge');
  jian('已在术 ⇒ 判为 shu', zhaoHuChiWeiZhi(w, { shu: ['以后都用中文回复'] }) === 'shu');
  jian('已在印象 ⇒ 判为 yinXiang', zhaoHuChiWeiZhi(w, { yinXiang: ['以后都用中文回复'] }) === 'yinXiang');
  jian('同位置不算“别处重复”（术写术不拦，由本层去重处理）',
    zhaoHuChiWeiZhi(w, { shu: [w] }, 'shu') === null);
  jian('知识库命中优先于提示词命中',
    zhaoHuChiWeiZhi(w, { knowledge: [w], shu: [w] }) === 'knowledge');

  /* ── ③ 豁免表：规范与只能人写的提示词不互斥 ── */
  jian('互斥表只有术/印象', JSON.stringify([...HU_CHI_TI_SHI_CENG]) === JSON.stringify(['shu', 'yinXiang']));
  jian('要求/短记忆(guifan)/道/教条/束缚/认知都在豁免表',
    ['yaoqiu', 'guifan', 'dao', 'jiaotiao', 'shufu', 'renzhi'].every((x) => BU_HU_CHI_TI_SHI_CENG.includes(x)));
  jian('shiHuChiTiShiCeng：术/印象 true，规范/道 false',
    shiHuChiTiShiCeng('shu') && shiHuChiTiShiCeng('yinXiang')
    && !shiHuChiTiShiCeng('guifan') && !shiHuChiTiShiCeng('dao') && !shiHuChiTiShiCeng('renzhi'));

  /* ── ④ 代码接线 ── */
  const shuFn = MAIN.slice(MAIN.indexOf('function guiNaShu('), MAIN.indexOf('function zhengLiYinXiang('));
  const yinFn = MAIN.slice(MAIN.indexOf('function zhengLiYinXiang('), MAIN.indexOf("chuliIpc('warmy:yinXiangZhiYi'"));
  jian('术写入前调用互斥判定（知识库/印象）',
    /zhaoHuChiWeiZhi\(w, \{ knowledge: zhiShi, yinXiang: yinXian \}, 'shu'\)/.test(shuFn));
  jian('术：自动段旧条目被替换时先迁知识库',
    /jiuTiao[\s\S]{0,260}qianYiTiShiDaoZhiShi\(jiuTiao, 'shu'/.test(shuFn));
  jian('术：裁掉最旧条目前先迁知识库（迁不动就保留）',
    /qianYiTiShiDaoZhiShi\(w, 'shu', caiLiao\.sid\)[\s\S]{0,120}liu = \[l, \.\.\.liu\]/.test(shuFn));
  jian('印象写入前调用互斥判定（知识库/术）',
    /zhaoHuChiWeiZhi\(w, \{ knowledge: zhiShi, shu: shuXian \}, 'yinXiang'\)/.test(yinFn));
  jian('印象：自动段旧条目被替换时先迁知识库',
    /jiuTiao[\s\S]{0,260}qianYiTiShiDaoZhiShi\(jiuTiao, 'yinXiang'/.test(yinFn));
  jian('印象：裁条目前先迁知识库，迁不动就停',
    /qianYiTiShiDaoZhiShi\(w, 'yinXiang', caiLiao\.sid\)[\s\S]{0,80}break/.test(yinFn));
  jian('迁出只落内部/私密库（不落某个群的会话库）',
    /minGan[\s\S]{0,160}keXie\.includes\('private'\)[\s\S]{0,160}keXie\.includes\('internal'\)/.test(MAIN));
  jian('归档提炼事件写库前过滤（两处归档路径）',
    (MAIN.match(/guoLuHuChiShiTi\(liWai\.events/g) || []).length >= 2);
  jian('knowledge_add 对已在术/印象的内容拒绝重复写',
    /kb\.placement-skip/.test(MAIN) && /内容已在提示词中（术\/印象）/.test(MAIN));
  jian('knowledge_add 也拦“已在知识库任一层”的重复内容',
    /const zhiShiYi = huChiZhiShiWenBen\(\)/.test(MAIN) && /wei: 'knowledge'/.test(MAIN)
    && /内容已在知识库（任一层）/.test(MAIN));
  jian('归档摘要/派生概要不算“知识内容条目”（避免把用户原话判成重复）',
    /\^\(archive:\|derived:\)/.test(MAIN));

  /* ── ⑤ 模型提示词 / 工具说明 ── */
  jian('归档整理提示词写了放置规则',
    /【放置规则】同一事实\/偏好只能放在知识库或模型可改的提示词/.test(MAIN));
  jian('印象整理提示词写了放置规则',
    /【放置规则】同一内容只能放在知识库或模型可改的提示词/.test(MAIN));
  jian('knowledge_add 工具说明写了互斥口径与规范豁免',
    /互斥口径/.test(TOOLS) && /规范与只能人写的提示词/.test(TOOLS));
  jian('代码里有“规范/道等不参与互斥”的常量/注释',
    /BU_HU_CHI_TI_SHI_CENG/.test(fs.readFileSync(path.join(PKG, 'src', 'prompt-placement.ts'), 'utf8')));
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
}

/* ── ⑥ 真机行为：直接调用主进程的互斥放置（WARMY_TEST_HOOKS=1） ── */
let child = null, cdp = null;
const profile = path.join(os.tmpdir(), 'warmy-r82-huchi-' + Date.now() + '-' + process.pid);
try {
  const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1', WARMY_TEST_HOOKS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=9688', '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAINJS], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env,
  });
  let last = '';
  for (let i = 0; i < 80; i++) {
    try { cdp = await attach(9688, { biaoQian: 'r82-huchi', callTimeout: 15000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!cdp) throw new Error('CDP 没连上：' + last);
  await cdp.send('Runtime.enable');
  await cdp.waitFor('!!window.warmy?.testPromptPlacement', { timeout: 30000, biaoQian: '测试钩子' });
  const tp = (p) => cdp.evaluate(`window.warmy.testPromptPlacement(${JSON.stringify(p)})`, { awaitPromise: true });

  /* A. 知识库已有 ⇒ 不写术 */
  const a = await tp({
    knowledge: ['不要自动提交代码，必须先问我'],
    shuText: '',
    shuYuanHua: ['不要自动提交代码，必须先问我。'],
  });
  jian('真机：知识库已有同一内容 ⇒ 术不再重复写',
    !!a?.ok && a.shuRes?.jia === 0 && !String(a.shu).includes('不要自动提交代码'),
    JSON.stringify({ ok: a?.ok, jia: a?.shuRes?.jia, shu: a?.shu }));

  /* B. 术旧条目被新说法替换 ⇒ 旧条目进知识库、新说法进术 */
  const OLD = '以后都用中文回复';
  const NEW = '以后都用中文回复，不要用英文，必须统一';
  const b = await tp({
    shuText: '## 牛马归纳（归档时自动整理；可直接改或删）\n- ' + OLD,
    shuYuanHua: [NEW],
  });
  const bOldLine = String(b?.shu || '').split('\n').some((l) => l.trim() === '- ' + OLD);
  const bNewLine = String(b?.shu || '').split('\n').some((l) => l.trim() === '- ' + NEW);
  const bMoved = (b?.internal || []).some((e) => e.result === OLD && e.laiYuan === 'prompt:moved');
  jian('真机：术旧条目被替换 ⇒ 新说法进术、旧条目迁进知识库',
    !!b?.ok && bNewLine && !bOldLine && bMoved,
    JSON.stringify({ ok: b?.ok, bNewLine, bOldLine, bMoved, shu: b?.shu, internal: b?.internal }));

  /* C. 知识库已有 ⇒ 不写印象 */
  const C = '我不喜欢长篇大论，请直接给结论';
  const c = await tp({ knowledge: [C], yinXiangText: '', yinXiangCandidates: [C] });
  jian('真机：知识库已有同一内容 ⇒ 印象不再重复写',
    !!c?.ok && c.yinRes?.jia === 0 && !String(c.yinXiang).includes(C),
    JSON.stringify({ ok: c?.ok, jia: c?.yinRes?.jia, yinXiang: c?.yinXiang }));

  /* D. 术已有 ⇒ 不写印象 */
  const D = '每次回答都要先给结论';
  const d = await tp({
    shuText: '## 牛马归纳（归档时自动整理；可直接改或删）\n- ' + D,
    yinXiangText: '',
    yinXiangCandidates: [D],
  });
  jian('真机：术已有同一内容 ⇒ 印象不再重复写',
    !!d?.ok && d.yinRes?.jia === 0 && !String(d.yinXiang).includes(D),
    JSON.stringify({ ok: d?.ok, jia: d?.yinRes?.jia, yinXiang: d?.yinXiang }));

  /* E. 印象旧条目被替换 ⇒ 旧条目进知识库、新说法进印象 */
  const OLD2 = '每次先给结论，再解释';
  const NEW2 = '每次先给结论，再解释，必须控制在三段以内';
  const e = await tp({
    yinXiangText: '## 牛马归纳（后台归档时自动补充；可直接改或删）\n- ' + OLD2,
    yinXiangCandidates: [NEW2],
  });
  const eOldLine = String(e?.yinXiang || '').split('\n').some((l) => l.trim() === '- ' + OLD2);
  const eNewLine = String(e?.yinXiang || '').split('\n').some((l) => l.trim() === '- ' + NEW2);
  const eMoved = (e?.internal || []).some((x) => x.result === OLD2 && x.laiYuan === 'prompt:moved');
  jian('真机：印象旧条目被替换 ⇒ 新说法进印象、旧条目迁进知识库',
    !!e?.ok && eNewLine && !eOldLine && eMoved,
    JSON.stringify({ ok: e?.ok, eNewLine, eOldLine, eMoved, yinXiang: e?.yinXiang, internal: e?.internal }));
} catch (e) {
  jian('真机互斥行为执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  try { if (cdp) await cdp.send('Browser.close', {}, { timeout: 5000 }); } catch { /* noop */ }
  if (child) {
    for (let i = 0; i < 25; i++) { await new Promise((r) => setTimeout(r, 200)); try { process.kill(child.pid, 0); } catch { break; } }
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 文件锁 */ }
}

console.log(`\nverify-r82-hu-chi: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
