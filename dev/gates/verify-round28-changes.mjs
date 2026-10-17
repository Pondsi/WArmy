/**
 * 第 28 轮变更门禁（项 1/2/3/4/5/6/7）
 *
 * 真机取证在前（用户那台实例的 plans.json / fast-memory.jsonl 就是证据）：
 *   · 宿主预置把「[屏幕截图 xxx.png, 有道词典.lnk]」切成了一条永远验证不了的 pending 步骤
 *     ⇒ `jiHuaHuanYouBuWeiBu` 永远认为"还有没做完的" ⇒ 自动续派把同一个多步任务反复重做；
 *   · 决策卡从来没有推荐项（`kadianKaMoxing` 从不设 `tuiJian`）；
 *   · 选完选项后界面把 `queueRounds` 清成"空闲"，而被判中断的那一轮其实没被杀 ⇒ "像停了其实还在跑"；
 *   · 异常停止时第二列图标没有感叹号；
 *   · `renderChat` 整块重建会抹掉流式气泡，要等下一个分片才回来 ⇒ "思考与中间回复消失"；
 *   · audit 目录被清掉后每条日志静默失败 ⇒ 出事无日志可查。
 * 本门禁把这些逐条钉住。跑法：node verify-round28-changes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let guo = 0, bai = 0, wei = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log('  [过] ' + ming); }
  else { bai++; console.log('  [败] ' + ming + (xiang ? ' :: ' + String(xiang).slice(0, 240) : '')); }
};
const weiTi = (ming, yin) => { wei++; console.log('  [没跑] ' + ming + ' :: ' + yin); };

const p = (r) => path.join(GEN, r);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const mainTs = read(p('packages/app-shell/src/electron-main.ts'));
const app = read(p('packages/app-shell/src/renderer/app.js'));
const css = read(p('packages/app-shell/src/renderer/app.css'));
const auditTs = read(p('packages/app-shell/src/audit.ts'));
const mainJs = read(p('packages/app-shell/dist/electron-main.js'));
const i18n = JSON.parse(read(p('packages/app-shell/src/i18n/zh-CN.json')) || '{}');

// ── 项 6：重复执行的三个真因 ────────────────────────────────────
console.log('\n项 6 · 为什么"简单任务不断重复"');
{
  shuo(/leiXing\?: 'info'/.test(mainTs), '计划步骤有"说明行"类型（info），不当待办');
  shuo(/function jiHuaBenCi\([^)]*\)[\s\S]{0,240}x\.leiXing !== 'info'/.test(mainTs),
    '续派判据（第 34 轮 jiHuaBenCi）跳过说明行（真因：那条附件说明永远 pending ⇒ 无限续派）');
  shuo(/const benCiHou = heBing\.filter\(\(x\) => x\.leiXing !== 'info'/.test(mainTs), '回给模型的"还剩几步"也不把说明行算进去');
  shuo(!mainTs.includes("'plan.host-seed'") && !/const kanRenWu = \(s: string\)/.test(mainTs), '宿主不再按句预置步骤（第 34 轮：计划只由模型按门禁建）');
  shuo(/!\(x\.note === 'host-seed' && benCiIds\.has\(x\.id\)\)/.test(mainTs), '旧版本留下的预置行在真计划到达后退役（不再永远"没做完"）');
  shuo(/有证据的别再重做|防止重做/.test(mainTs) && /youZhengJu/.test(mainTs), '续派指令里明确"备注已有证据的步骤禁止重做，先验证掉"');
  shuo(/备注：\$\{zheng\}/.test(mainTs), '续派清单把每步的备注（证据）一起给模型看（以前只给 [pending]）');
  shuo(/const zaiTuLiao = new Map<string, number>\(\)/.test(mainTs) && /skipped: 'in-flight'/.test(mainTs),
    '主进程单飞保护：同一会话还在跑时，内部续派/决策卡续跑一律跳过（不再两轮并行改同一批文件）');
  shuo(/async function zhenZhengFaSongBen\(/.test(mainTs) && /return await zhenZhengFaSongBen\(/.test(mainTs),
    '发一轮的唯一入口包了一层（IPC 与续派共用，不会两套漂移）');
  shuo(/state\.abnormalStop/.test(app) && /abnormalStop\.has\(String\(sid\)\)/.test(app),
    '异常停止在第二列图标上亮感叹号（并入 yiChang 徽标口径）');
  shuo(/if \(sid0 && queueRounds && !zaiLiuShi\) queueRounds\[sid0\] = false;/.test(app),
    '还在出流式内容时不许谎报"空闲"（中断广播不再把运行态硬清掉）');
  shuo(/fs\.mkdirSync\(path\.dirname\(this\.file\)/.test(auditTs), '审计写失败会重建目录再试（目录被清过就不会从此静默无日志）');
  shuo(/queueBusy\(sid\)/.test(app), '界面侧也挡：上一轮没结束就延后再派（多窗口重复的兜底）');
}

// ── 项 2：选项卡必须有推荐 ─────────────────────────────────────
console.log('\n项 2 · 选项卡推荐');
{
  const ka = mainTs.slice(mainTs.indexOf('function kadianKaMoxing'), mainTs.indexOf('function kadianKaMoxing') + 6000);
  const geAn = (ka.match(/case '/g) || []).length;
  const tui = (ka.match(/tuiJian: true/g) || []).length;
  shuo(geAn >= 6, `决策卡模板覆盖 ${geAn} 类中断`, geAn);
  shuo(tui >= 6, '每一类中断卡都带推荐项（真机投诉：选项卡的推荐仍然没看到）', 'tuiJian:' + tui);
  shuo(/keXinDu: \d+/.test(ka), '推荐带可信度数值（用于 55% 阈值判定）');
  shuo(/ke === null \|\| ke >= 55/.test(mainTs), '可信度 <55 不标推荐（>=55 或没给才允许标）');
  shuo(/if \(!shiShouQuanKa && guiYi\.length && !guiYi\.some\(\(o\) => o\.tuiJian\)\)|if \(guiYi\.length && !guiYi\.some\(\(o\) => o\.tuiJian\)\)/.test(mainTs),
    '保底：一张卡上一个推荐都没有 ⇒ 自动标第一个非"停止"项（用户不用猜；授权卡例外）');
  shuo(/keTui && \(conf === null \|\| conf >= 55\)/.test(mainTs), 'ask_user（模型自己出的选项卡）仍走同一套 55% 规则');
  shuo(/aiqTuiJian/.test(app), '界面渲染「推荐」标');
}

// ── 项 3：中间回复不丢、归入行动中/行动过程 ────────────────────
console.log('\n项 3 · 行动中 / 行动过程');
{
  shuo(/function guiNaXingDong\(heZi, zaiPao\)/.test(app), '有"中间回复归组"这一步');
  shuo(/guiNaXingDong\(heZi, !!\(state\.selectedChat && queueRounds/.test(app), '渲染完就归组（运行中=行动中，结束=行动过程）');
  /**
   * 口径级判据（第 35 轮改口径）：**运行中与结束必须是两个不同的键**，且两处都用 tOr 取文案。
   * 不再写死文案（本轮把「行动中…/行动过程」改名成「执行中…/执行过程」，
   * 写死文案的门禁会因为**改名**而假红 —— 这正是交接里反复记的那条教训）。
   */
  shuo(/zaiPao\s*\?\s*tOr\('chat\.actingNow'/.test(app) && /:\s*tOr\('chat\.actionLog'/.test(app),
    '标题按运行状态切换（运行中 / 结束 用两个不同的键）');
  shuo(/if \(zh && b\.content\) zh\.textContent = b\.content;/.test(app),
    '空分片不许把已显示的中间回复抹成空白（真机：内容时有时无）');
  shuo(/_liuShiHuaShangCi = 0; xuanRanLiuShiKuai\(sidHu, state\.streamBuf\[sidHu\]\)/.test(app),
    'renderChat 整块重建后**立刻**用缓冲区重画流式块（不再等下一个分片才回来）');
  shuo(/\.xingDongKuai \{/.test(css) && /\.xingDongKuai\[open\]/.test(css), '折叠块有样式（含展开箭头）');
  shuo(/dataset\.role = m\.role === 'wo' \? 'wo' : 'them'/.test(app), '消息行打标，归组才认得出"本轮的第几条"');
  shuo(!/zh\.textContent = b\.content \|\| ''/.test(app), '旧的"空就抹掉"写法已移除');
}

// ── 项 1：编号重排 = 硬门禁保底 + 软展示 ───────────────────────
console.log('\n项 1 · 编号重排触发条件');
{
  shuo(/function jiHuaXinRenWuMenJin\(sessionId: string\)/.test(mainTs), '重排判定收进一个函数（周期 + 基准时间）');
  const faQi = mainTs.indexOf('jiHuaXinRenWuMenJin(sessionId)');
  const kuai = mainTs.slice(Math.max(0, faQi - 400), faQi + 60);
  shuo(faQi > 0 && /internal\?: boolean \}\)\.internal !== true/.test(kuai),
    '只在**非内部续派**（用户真的发起新任务）时判定 ⇒ 续派/重发不触发重排');
  shuo(!/qingLiZhouqiMs[\s\S]{0,200}plan\.hard-gate-clean/.test(mainTs.slice(mainTs.indexOf("gongJuMing === 'plan_update'"), mainTs.indexOf("gongJuMing === 'plan_update'") + 3000)),
    'plan_update 里那段"每次更新都判周期"的旧硬门禁已挪走（那等于续派也重排）');
  shuo(/broadcastToWindows\('warmy:jiHuaGengXin', \{ sessionId, steps, chongPai \}\)/.test(mainTs), '广播带 chongPai');
  shuo(/const zhuZiPai = y\.chongPai === true;/.test(app), '界面按主进程的 chongPai 执行（本地周期判断只当兜底）');
}

// ── 项 4 / 5 / 7 ─────────────────────────────────────────────
console.log('\n项 4 / 5 / 7');
{
  shuo((/设置 → 功能 → 本地语音识别|设置 → 功能 → 本地语音与文字互转/.test(app)) && /chat\.voiceNeedAsr/.test(app),
    '话筒没得用时把"本机 sherpa-onnx 一键安装"这条路告诉用户（第 34 轮 项 4 把这块改名为「本地语音与文字互转」，两个名字都认）');
  /**
   * 语音不可用时的指引必须指向**当前**那块的名字。
   * 第 34 轮把「本地语音识别」块改名为「本地语音与文字互转」（项 4 同时把它移到收信任文件夹上面），
   * 旧的断言写死了 `settings.asrLocalHint`（那个键本轮已删）⇒ 这里改成口径级检查：
   * 指引里出现的块名必须等于 `localSpeech.title` 的值，且十国语言包都不能再指向旧块名。
   */
  {
    const ti = String(i18n['localSpeech.title'] || '');
    const zhiYin = String(i18n['chat.voiceNeedAsr'] || '');
    shuo(!!ti && zhiYin.includes(ti), `语音指引指向当前块名「${ti}」`);
    const jiu = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'].filter((m) => {
      const j = JSON.parse(fs.readFileSync(path.join(GEN, 'packages/app-shell/src/i18n', m + '.json'), 'utf8'));
      return /本地语音识别|ローカル音声認識|Reconnaissance vocale locale|Локальное распознавание речи/.test(String(j['chat.voiceNeedAsr'] || ''))
        && !String(j['chat.voiceNeedAsr']).includes(String(j['localSpeech.title'] || '␀'));
    });
    shuo(jiu.length === 0, `没有任何语言包还指着已改名的旧块（红：${jiu.join(',') || '无'}）`);
    shuo(!('settings.asrLocalHint' in i18n) && !('settings.asrLocalHow' in i18n), '设置里旧的 ASR 说明键已删除（预设供应商下拉不再有本地语音识别）');
  }
  shuo(/const wen = '\[计划任务\] '/.test(app), '复制计划任务：编号前带 [计划任务]');
  shuo(!/anNiuJinengShiChangGithub/.test(app), '设置→技能 的「GitHub 项目页」按钮已删除');
  shuo(/id="anNiuJinengShiChangShua"/.test(app), '「打开 dsh-market」入口还在（弹窗照旧）');
}

// ── i18n 键存在性 ─────────────────────────────────────────────
console.log('\ni18n');
{
  const yong = [...new Set([
    ...[...app.matchAll(/tOr\('chat\.(actingNow|actionLog|tiao|voiceNeedAsr)'/g)].map((x) => 'chat.' + x[1]),
  ])];
  const que = yong.filter((k) => !(k in i18n));
  shuo(yong.length >= 3, '新文案走 i18n（' + yong.length + ' 键）');
  shuo(que.length === 0, '新键都在语言包里', que.join(','));
}

// ── 产物 ─────────────────────────────────────────────────────
console.log('\n产物');
{
  shuo(mainJs.length > 100000, 'dist/electron-main.js 已重新编译');
  if (mainJs) {
    shuo(/jiHuaXinRenWuMenJin/.test(mainJs) && /zaiTuLiao/.test(mainJs), '本轮主进程改动在**编译产物**里');
    const qd = [...mainJs.matchAll(/chuliIpc\('([^']+)'/g)].map((m) => m[1]);
    const c = new Map();
    for (const q of qd) c.set(q, (c.get(q) || 0) + 1);
    shuo([...c.values()].every((n) => n === 1), '没有重复注册的 IPC 通道', [...c].filter(([, n]) => n > 1).map(([k]) => k).join(','));
  } else weiTi('产物断言', '先跑 tsc');
}

console.log('\n' + '─'.repeat(52));
console.log('第 28 轮变更：过 ' + guo + ' · 败 ' + bai + ' · 没跑 ' + wei);
if (bai > 0) process.exit(1);
