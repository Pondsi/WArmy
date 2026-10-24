/**
 * verify-r52-jujue.mjs（fast 档）—— 第 52 轮项 11「④ run_shell 被拒即停用」的判据。
 *
 * 定稿口径：**同一条任务里**同一工具累计被拒 2 次 ⇒ 本轮硬停用（不再执行、不再放行），
 * 时间窗作废；只有新的用户消息重置，「继续执行/用户决定」这类续接**保留**停用名单。
 * 记账只认真正的拒绝（授权档不放行 / 用户点拒绝），**普通失败不进账**（旧口径对模型撒谎）。
 *
 * 用法：node packages/app-shell/scripts/verify-r52-jujue.mjs
 * 负向验证：把改坏的 main 复制到临时文件后用 V52_MAIN 指过来，必须变红（见 docs/HANDOFF 里本轮记录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ZHANG = await import(pathToFileURL(process.env.V52_ZHANG || path.join(ROOT, 'packages/app-shell/dist/ju-jue-zhang.js')).href);
const MAIN_FILE = process.env.V52_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const MAIN = fs.readFileSync(MAIN_FILE, 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 140) : '')); } };

// ── 1. 记账本真值表（直接跑真代码，不钉字节）────────────────────────────
{
  const z = ZHANG.chuangJuJueZhang();
  const S = 's1', T = 'run_shell';
  jian('第 1 次拒绝：不钉死、计数 1', (() => { const r = z.jiLu(S, T, '被拒（normal授权）'); return r.n === 1 && !r.gangTingYong && !z.shiFouTingYong(S, T); })());
  const r2 = z.jiLu(S, T, '被拒（normal授权）第 2 次');
  jian('第 2 次拒绝：刚好钉死（gangTingYong 只在这一次为真）', r2.n === 2 && r2.gangTingYong === true && z.shiFouTingYong(S, T) === true);
  const r3 = z.jiLu(S, T, '被拒（normal授权）第 3 次');
  jian('第 3 次拒绝：仍钉死但不重复报"刚好钉死"（审计不重复）', r3.n === 3 && r3.gangTingYong === false && z.shiFouTingYong(S, T) === true);
  jian('钉死后计数继续如实累计（提示语要报真实次数）', z.ciShu(S, T) === 3);
  jian('最后一个拒因如实可查（提示语不再谎称"授权档不放行"）', /第 3 次/.test(z.yuanYin(S, T)));
  jian('别的工具不受影响', z.shiFouTingYong(S, 'open_path') === false);
  jian('别的会话不受影响', z.shiFouTingYong('s2', T) === false);
  z.chongZhi(S);
  jian('新任务重置：停用名单与计数一起清零', z.shiFouTingYong(S, T) === false && z.ciShu(S, T) === 0 && z.yuanYin(S, T) === '');
  jian('重置后别的会话仍然完好（只清这一条）', (() => { const a = ZHANG.chuangJuJueZhang(); a.jiLu('x', 't', 'r'); a.jiLu('x', 't', 'r'); a.jiLu('y', 't', 'r'); a.jiLu('y', 't', 'r'); a.chongZhi('x'); return a.shiFouTingYong('x', 't') === false && a.shiFouTingYong('y', 't') === true; })());
  jian('拒因按 160 字符截断（不让长 stdout 撑爆上下文）', (() => { const a = ZHANG.chuangJuJueZhang(); a.jiLu('z', 't', 'X'.repeat(9999)); return a.yuanYin('z', 't').length <= 160; })());
  jian('阈值=2（第 52 轮定稿，改阈值要过门禁）', ZHANG.JU_JUE_DING_SI === 2);
  jian('空 sessionId / 空工具名不炸（防御性：调用方传过 undefined）', (() => { const a = ZHANG.chuangJuJueZhang(); a.jiLu('', '', ''); return a.ciShu('', '') === 1 && a.shiFouTingYong('', '') === false; })());
}

// ── 2. 拒绝消息开头 = 记账判据（正例必须全中、非拒绝必须全不中）──────────
const K = ZHANG.JU_JUE_KAI_TOU;
const ZHENG = [
  '[run_shell] 被拒（normal授权）：需要完全授权',
  '[ziding_yi] 被拒（normal授权）：x',
  '[open_path] 用户拒绝/未授权打开 C:\\x。若需要，请让用户在顶部改成「完全授权」。',
  '[install_skill] 用户拒绝安装 /tmp/a',
  '[download_file] 用户拒绝',
  '[write_skill] 用户拒绝写入含高危命令的技能。',
  '[run_shell] 用户拒绝执行：dir',
];
const FU = [
  '[run_shell] exit=1 (20ms)\n被拒（normal授权）这是命令输出里的一段话',
  '[read_file] 失败：路径不存在',
  '[knowledge_add] 拒绝：这一层对本会话不可写（群聊只能写会话库；项目不能写私密库）',
  '[run_shell] 请给出 command',
  '被拒（normal授权）：没有工具名前缀',
  '[a] 同意执行',
];
for (const w of ZHENG) jian('算拒绝：' + w.slice(0, 26), K.test(w) === true);
for (const w of FU) jian('不算拒绝：' + w.slice(0, 26), K.test(w) === false);
jian('knowledge_add 的"这一层不可写"故意不钉死（同工具换层是正常用法）', K.test(ZHENG[0]) && !K.test(FU[2]));

// ── 3. 主进程接线（行为不变量，不钉行号）──────────────────────────────
const ZHA_GUAN = /^\s*if \(shiBenLunTingYong\(sessionId, gongJuMing\)\) \{$/m;
const guardIdx = MAIN.search(ZHA_GUAN);
const panIdx = MAIN.indexOf('panDuanMingLingShouQuan(dang, yaoWen2, cmd, baseH)');
jian('硬停用闸门存在（且是 if 的条件本身，不是被 && 掉的死代码）', ZHA_GUAN.test(MAIN));
jian('闸门在真正执行工具之前（拒绝点之前，不是之后）', guardIdx > 0 && panIdx > 0 && guardIdx < panIdx);
jian('主进程用的是同一个记账本（import chuangJuJueZhang）', /from '\.\/ju-jue-zhang\.js'/.test(MAIN) && /chuangJuJueZhang\(\)/.test(MAIN));
jian('拒绝只有一个出口 huiBaoJuJue()：生成文案的当场就记账', /function huiBaoJuJue\(sessionId: string, gongJu: string, leiXing: 'shouQuan' \| 'yongHu'/.test(MAIN)
  && /jiLuShouQuanJuJue\(sessionId, gongJu, wen\)/.test(MAIN));
jian('不再靠"扫文案"反推拒绝（那条路实测能被改措辞绕过）', !/JU_JUE_KAI_TOU\.test\(huiBaoH\)/.test(MAIN));
jian('旧的时间窗口径彻底删除：源码里不再有 120000ms 的拒绝计数', !/now - x\.at < 120000/.test(MAIN) && !/最近两分钟内已被拒绝/.test(MAIN));
jian('新任务才重置；续接保留名单（if (!xuJie) chongZhiBenLunJuJue）', /if \(!xuJie\) chongZhiBenLunJuJue\(sessionId\)/.test(MAIN));
jian('钉死时如实告诉模型"再调用也不会执行"', /本轮已硬停用：再调用也不会执行/.test(MAIN));
jian('钉死提示语如实报累计次数与最后一次拒因', /已被拒绝 \$\{di\} 次（最后一次：\$\{yin\}）/.test(MAIN));
jian('审计事件 chat.tool-denied-locked 存在（钉死那一刻可 grep）', /chat\.tool-denied-locked/.test(MAIN));

// ── 4. 拒绝文案与记账判据**同源**（结构断言：文案只能出自两个构造器）────
{
  const kaiShi = MAIN.indexOf('if (isHostTool(gongJuMing)');
  const jieShu = MAIN.indexOf('jiLuGongJu(sessionId, gongJuMing, okH,', kaiShi);
  jian('宿主工具分支与记账点都能定位（找不到就先修这支探针）', kaiShi > 0 && jieShu > kaiShi);
  const duan = kaiShi > 0 && jieShu > kaiShi ? MAIN.slice(kaiShi, jieShu) : '';
  const KUO_KOU = /(被拒|拒绝|不放行|权限不足|未授权|无权)/;
  const GOU = /huiBaoJuJue\(/;
  /** 故意不进账的拒绝（同一工具换层是正常用法，钉死反而把知识库写入口全废） */
  const YUN_XU = [/huiBaoH = '\[knowledge_add\] 拒绝：这一层/];
  const xing = duan.split(/\r?\n/).filter((l) => /huiBaoH\s*=/.test(l) && KUO_KOU.test(l) && !/^\s*(\/\/|\*)/.test(l));
  const buZhong = xing.filter((l) => !GOU.test(l) && !YUN_XU.some((re) => re.test(l)));
  const chuKouShu = (duan.match(/huiBaoJuJue\(sessionId/g) || []).length;
  jian('宿主工具的拒绝全走唯一出口（出口 ' + chuKouShu + ' 处 ≥ 9；手写拒绝文案 ' + buZhong.length + ' 条，含改措辞漂移的必红）',
    chuKouShu >= 9 && buZhong.length === 0, buZhong.slice(0, 3).map((s) => s.trim().slice(0, 70)).join(' | '));
  jian('白名单里的例外确实存在（名单不许长期挂着没人用的条目）',
    YUN_XU.every((re) => xing.some((l) => re.test(l))));
  jian('两个构造器的产物都落进记账判据（文案与判据同源，改文案抓不丢）',
    K.test(ZHANG.huiBaoShouQuanJu('run_shell', 'normal', '需要完全授权')) === true
    && K.test(ZHANG.huiBaoYongHuJu('run_shell', '执行：dir')) === true);
  jian('构造器把拒因与"该换什么路子"原样带给模型（不是只说一句不行）',
    /需要完全授权/.test(ZHANG.huiBaoShouQuanJu('run_shell', 'normal', '需要完全授权', '改用别的工具'))
    && /改用别的工具/.test(ZHANG.huiBaoShouQuanJu('run_shell', 'normal', '需要完全授权', '改用别的工具')));
  jian('授权拒绝与用户拒绝在文案上分得开（模型据此知道该改授权档还是该问用户）',
    /被拒（normal授权）/.test(ZHANG.huiBaoShouQuanJu('run_shell', 'normal', 'x'))
    && /用户拒绝/.test(ZHANG.huiBaoYongHuJu('run_shell', '执行')));
}

console.log(`==== verify-r52-jujue: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
