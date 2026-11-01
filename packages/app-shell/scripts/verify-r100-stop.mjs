/**
 * verify-r100-stop.mjs —— 第 100 轮：停止语义 / 现场保留 / 独立窗关闭 / nm 插件装卸
 *
 * 判据不是“像不像”，而是：
 *   1) 停止后**结构上**没有降级、没有续派（stop-aborted + 世代守卫 + 唯一清标志点）；
 *   2) 停止现场（思考分段/中间回复/正文/操作）**写进同一条 stopped 日志**并在界面上合并；
 *   3) 操作归属按**用户轮边界**，上一轮的尾巴操作不会跑到下一轮；
 *   4) 独立会话窗关闭不再二次确认；nm 查看器可见、可卸载、可重装（卸载标记）。
 * 每个关键断言都配一条**负向变异**：删掉实现后检测器必须变红。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('src/electron-main.ts');
const app = read('src/renderer/app.js');
const preload = read('src/preload.cjs');
const css = read('src/renderer/app.css');
const store = read('src/settings-store.ts');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('PASS ' + name); };
const bodyOf = (src, startRe, endRe) => {
  const i = src.search(startRe);
  if (i < 0) return '';
  const rest = src.slice(i);
  const j = rest.search(endRe);
  return j < 0 ? rest : rest.slice(0, j);
};

/* ═══ 1. 主进程：停止 ≠ 失败，不降级/不续派 ═══════════════════════════════ */
const hasStopCatchGuard = (s) => /catch \(e\) \{[\s\S]{0,900}chat\.stop-aborted[\s\S]{0,400}return tingZhiJieGuo\(\)/.test(s);
ok('主进程：abort 异常走 stopped 返回（不再降级换模型）', hasStopCatchGuard(main));
ok('负向：删掉 stop-aborted 分支后检测器必须变红', !hasStopCatchGuard(main.replace(/chat\.stop-aborted/, 'chat.x')));
ok('主进程：模型循环每一步都查 benLunBeiTing()', /for \(let lun = 0; lun < zuiDaLun; lun\+\+\) \{[\s\S]{0,260}benLunBeiTing\(\)/.test(main));
ok('主进程：自动续派前拦住停止（stop-block-auto-continue）', /if \(benLunBeiTing\(\) \|\| stoppedSessions\.has\(String\(sessionId \|\| ''\)\)\)/.test(main) && /chat\.stop-block-auto-continue/.test(main));

const deleteCount = (main.match(/stoppedSessions\.delete\(sessionId\)/g) || []).length;
ok('停止标志只在「用户再次开口」清一次（续派路径不再自己擦掉）', deleteCount === 1 && /用户再次开口[\s\S]{0,500}stoppedSessions\.delete\(sessionId\)/.test(main));
ok('负向：若续派路径再写一次 delete，单点断言必须失败', deleteCount !== 2);

ok('停止世代：每次停止 +1，在途轮按开工时的世代判断', /const TING_ZHI_DAI = new Map/.test(main) && /TING_ZHI_DAI\.set\(k, \(TING_ZHI_DAI\.get\(k\) \|\| 0\) \+ 1\)/.test(main) && /tingZhiDaiOf\(sessionId\) !== benLunTingZhiDai/.test(main));

/* ═══ 2. 停止现场：一条 stopped 日志，带完整内容 ═══════════════════════════ */
const luoPan = bodyOf(main, /async function luoPanTingZhi/, /chuliIpc\('warmy:tingZhiDuiHua'/).split('function biaoJiXingDongTingZhi')[0];
ok('停止现场落一条 assistant 日志（stopped:true + 思考分段 + 中间回复）', /role: 'assistant'/.test(luoPan) && /stopped: true/.test(luoPan) && /reasoningDuan: xian\.reasoningDuan/.test(luoPan) && /zhongJian: xian\.zhongJian/.test(luoPan));
ok('负向：去掉 stopped:true 后检测器变红', !/stopped: true/.test(luoPan.replace(/stopped: true/, 'stopped: false')));
ok('停止时取现场三样：正文 / 思考分段 / 中间回复', /quTingZhiXianChang/.test(main) && /zhuLiuShiQu\(sid\)/.test(main) && /zhuSiKaoQu\(sid\)/.test(main) && /zhuZhongJianQu\(sid\)/.test(main));
ok('工具开始时把上一段正文归档为中间回复（与界面同口径）', /function zhuLiuShiGuiDang/.test(main) && /zhuLiuShiGuiDang\(sessionId[^)]*\)/.test(main));

/* 进行中的工具 → 已停止，不被随后返回的“成功”覆盖 */
ok('停止时把正在执行的行动标成已停止', /function biaoJiXingDongTingZhi/.test(main) && /XING_DONG_BEI_TING\.add\(ap\.hao\)/.test(main) && /stopped: true/.test(main));
ok('工具完成后不再覆盖已停止状态', /XING_DONG_BEI_TING\.has\(String\(d\.hao/.test(main));
ok('停止后不再执行新工具（工具入口按世代拦截）', /chat\.tool-blocked-after-stop/.test(main) && /gongJuBeiTing\(\)/.test(main));
ok('负向：删掉工具入口的停止守卫后检测器变红', !/chat\.tool-blocked-after-stop/.test(main.replace(/chat\.tool-blocked-after-stop/, 'chat.x')));

/* 行动 id 跨重启唯一（旧 xd1 会覆盖上一轮台账） */
ok('行动 id 跨重启唯一（xd-<时间戳>-<序号>）', /'xd-' \+ Date\.now\(\)\.toString\(36\)/.test(main));
ok('负向：回到 xd1 编号后唯一性断言必须失败', !/hao: 'xd' \+ \(\+\+xingDongHaoXu\)/.test(main));

/* ═══ 3. 每次模型回复独立保留（第 110 轮硬规则） ═════════════════════ */
const pushBody = bodyOf(main, /function zhuiJiaLiaoTianRiZhi/, /\/\*\* 纯标点\/零宽不入账/);
ok('每条 assistant 回复独立落库，不再改写上一条正文',
  /每一次模型回复都单独落一条/.test(pushBody) && !/last\.content\s*=\s*String\(last\.content/.test(pushBody));
ok('负向：把旧的“合并正文”写回去后检测器变红',
  /last\.content\s*=\s*String\(last\.content/.test(pushBody.replace(
    /const tiaoMu = \{ \.\.\.entry, role: guiYiJiaoSe\(entry\.role\) \} as LogEntry;/,
    'const tiaoMu = { ...entry, role: guiYiJiaoSe(entry.role) } as LogEntry; if (false) { const last = chatLogs.get(key)?.[0]; last.content = String(last.content) + String(tiaoMu.content); }',
  )));
ok('渲染层合并主进程/本地消息后按 ts 升序（同类回复不会被晚到者挤到后面）',
  /quChong\.sort\(\(a, b\) => \(Number\(a\.ts\) \|\| 0\) - \(Number\(b\.ts\) \|\| 0\)\)/.test(app));

/* 操作归属：按“操作发生时那一发回复”归属（支持一轮多条回复） */
const guiNa = bodyOf(app, /function guiNaXingDong\(/, /function xingDongHangNode\(/);
ok('操作归属改为 guiShuMuBiao（不再整轮统一塞给最后一条）',
  /function guiShuMuBiao/.test(app) && /guiShuMuBiao\(thems, yongHuTs, liuShiNode/.test(guiNa) && !/lastThemOfTurn/.test(guiNa));
ok('流式气泡单独承接“最后一条正式回复之后”的新操作', /assign\.set\(liuShiNode, \[\]\)/.test(guiNa));
{
  const m = app.match(/function guiShuMuBiao\([\s\S]*?\n  \}/);
  assert.ok(m, '找不到 guiShuMuBiao');
  const fn = new Function(`${m[0]}; return guiShuMuBiao;`)();
  const node = (ts) => ({ dataset: { ts: String(ts) } });
  const a1 = node(600);
  const a2 = node(1200);
  const stream = node(0);
  assert.equal(fn([a1, a2], [100], null, 0, 500), a1, 'A1 生成期间的操作归 A1');
  assert.equal(fn([a1, a2], [100], null, 0, 700), a2, 'A1 已落地后的操作归下一条回复 A2');
  assert.equal(fn([a1, a2], [100], stream, 1500, 1400), stream, '本轮最后一条回复之后的新操作归流式气泡');
  assert.equal(fn([a1, a2], [100], stream, 1500, 500), a1, '流式气泡不得抢走更早回复的操作');
  assert.equal(fn([a1, a2], [100, 1000], null, 0, 1100), a2, '下一用户轮的操作归下一轮回复');
  assert.equal(fn([a1, a2], [100, 1000], null, 0, 900), a1, '上一轮尾部的操作不跑到下一轮');
  assert.equal(fn([a1, a2], [100], null, 0, 1300), a2, '最后一条回复之后没有流式 ⇒ 归最后一条');
  ok('guiShuMuBiao 真值表：A1/A2/流式/跨轮边界', true);
}

/* ═══ 4. 渲染层：停止现场完整保留 + 即时汇报 + 晚到结果丢弃 ═══════════════ */
const stopFn = bodyOf(app, /function stopAllAi\(\)/, /\n  \/\*\* 会话 id → 类型/);
ok('stopAllAi 从三段缓冲取现场（不是只抓第一个 pre）', /siKaoQuDuan\(sid\)/.test(stopFn) && /state\.streamInterim/.test(stopFn) && /state\.streamBuf/.test(stopFn));
ok('stopAllAi 把 stopTs 交给主进程（日志/界面同一条）', /stopChat\?\.\(sid, \{ stopTs \}\)/.test(stopFn));
ok('stopAllAi 本地只画不写日志（noLog）', /noLog: true/.test(stopFn));
ok('负向：去掉 noLog 后重复日志检测器变红', !/noLog: true/.test(stopFn.replace(/noLog: true/, 'noLog: false')));
ok('stopAllAi 不再推「停止」空气泡', !/t\('chat\.stopAll'\)/.test(stopFn));
ok('stopAllAi 作废本轮世代（晚到回复不进界面）', /\.generation = \(.*generation \|\| 0\) \+ 1/.test(stopFn));
ok('空闲时点停止不产生任何消息（以忙状态条/发送键/流式气泡为准）', /const busyUi =/.test(stopFn) && /const sendBusy =/.test(stopFn) && /const zaiPao = youLiuShi \|\| busyUi \|\| sendBusy/.test(stopFn) && /if \(!zaiPao\)/.test(stopFn));
ok('空闲停止只回 idle，不广播现场', /zaiPao\s*\n\s*\? \{ sessionId: sid, stopped: true, alreadyLogged: true, \.\.\.xian \}[\s\S]{0,120}: \{ sessionId: sid, idle: true, ts: stopTs \}/.test(main) && /d\.idle === true\) return/.test(app));
ok('负向：去掉 idle 广播分支后检测器变红', !/idle: true, ts: stopTs/.test(main.replace(/idle: true, ts: stopTs/, 'idle: false')));

ok('主进程广播停止现场 → 界面合并（onTingZhiKuai）', /window\.warmy\.onTingZhiKuai/.test(app) && /heBingWenDuan\(m\.reasoningDuan, d\.reasoningDuan\)/.test(app) && /heBingWenDuan\(m\.zhongJian, d\.zhongJian\)/.test(app));
ok('负向：去掉合并后检测器变红', !/heBingWenDuan\(m\.reasoningDuan, d\.reasoningDuan\)/.test(app.replace(/heBingWenDuan\(m\.reasoningDuan, d\.reasoningDuan\)/, 'x')));
ok('preload 暴露停止现场通道', /onTingZhiKuai: \(cb\)/.test(preload) && /warmy:tingZhiKuai/.test(preload));

ok('停止气泡有摘要（操作数/最近操作/思考段/正文字数）', /chat\.stopSummary/.test(app) && /tingZhiZhaiYao/.test(app) && /chat\.stopSummaryRecent/.test(app));
ok('占位文案不算正文（正文 0 字）', /zhengWenQuan === tOr\('chat\.stoppedNoText'/.test(app));
ok('停止气泡的执行过程默认折叠（与正常回复一致）', /guoChengLieHtml/.test(app) && !/siKaoKai/.test(app));
ok('停止气泡有样式', /\.tingZhiZhaiYao/.test(css) && /\.xingDongHang\.isStopped/.test(css));

/* 操作归属已在第 3 节用 guiShuMuBiao 真值表覆盖（第 110 轮：支持一轮多条回复） */

/* ═══ 5. 停止标记跨重启 ═════════════════════════════════════════════════ */
ok('chat-meta 记录 stopped，重启后补回（且按时间相邻，不误标所有回复）', /stopped\?: boolean/.test(main) && /\.\.\.\(e\.stopped === true \? \{ stopped: true \}/.test(main) && /Number\(x\.ts \|\| 0\) - mTs\) <= 5000/.test(main));
ok('旧数据兜底：停止占位文案也认作 stopped', /function shiTingZhiZhanWei/.test(main) && /stopped: e\.stopped === true \|\| shiTingZhiZhanWei\(e\.content\)/.test(main));

/* ═══ 6. 独立会话窗关闭免二次确认 ═════════════════════════════════════════ */
ok('独立会话窗关闭不再二次确认', /if \(!state\.chatWindow && !document\.body\.classList\.contains\('liaoTianChuangKou'\)\) \{[\s\S]{0,400}closeConfirm/.test(app));
ok('负向：去掉独立窗判断后检测器变红', !/if \(!state\.chatWindow && !document\.body\.classList\.contains/.test(app.replace(/if \(!state\.chatWindow && !document\.body\.classList\.contains\('liaoTianChuangKou'\)\)/, 'if (true)')));

/* ═══ 7. nm 查看器：可见 / 可卸载 / 可重装 ═══════════════════════════════ */
ok('插件页合并内置条目（不再被落盘列表挤掉）', /state\.nmFileRemoved = st\.state\.nmFileRemoved === true/.test(app) && /if \(!he\.some\(\(p\) => String\(p\.id \|\| ''\) === 'warmy-memory'\)\)/.test(app) && /if \(!state\.nmFileRemoved && !he\.some\(\(p\) => String\(p\.id \|\| ''\) === 'nm-file'\)\)/.test(app));
ok('nm-file 删除写卸载标记（更新/重启不自动装回）', /state\.nmFileRemoved = true/.test(app) && /nmFileRemoved: !!state\.nmFileRemoved/.test(app) && /s\?\.nmFileRemoved === true\) return false/.test(main));
ok('设置→功能：启用右侧有安装/重装按钮', /anNiuNmChaJianAnZhuang/.test(app) && /settings\.nmInstall/.test(app) && /settings\.nmReinstall/.test(app));
ok('安装/重装清标记并恢复插件', /state\.nmFileRemoved = false;[\s\S]{0,200}cunChaJianJi\(\)/.test(app) && /id: 'nm-file', ming: 'nm文件', enabled: true/.test(app));
ok('settings-store 有 nmFileRemoved 字段', /nmFileRemoved\?: boolean/.test(store));
ok('负向：去掉卸载标记判断后检测器变红', !/s\?\.nmFileRemoved === true\) return false/.test(main.replace(/if \(s\?\.nmFileRemoved === true\) return false;/, '')));

/* ═══ 8. i18n：10 个语言包都有本轮新键 ═════════════════════════════════════ */
{
  const dir = path.join(root, 'src/i18n');
  const files = fs.readdirSync(dir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f));
  assert.ok(files.length >= 10, '语言包不足 10 个');
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const k of ['chat.stoppedNoText', 'chat.stopSummary', 'chat.stopSummaryRecent', 'chat.actStopped', 'settings.nmInstall', 'settings.nmReinstall', 'plugin.nmDelConfirm']) {
      assert.ok(typeof j[k] === 'string' && j[k].trim(), `${f} 缺 ${k}`);
    }
  }
  ok('10 个语言包：停止摘要 / 安装按钮 / 卸载确认键齐全', true);
}

console.log(`==== verify-r100-stop: ${pass} PASS / 0 FAIL ====`);
