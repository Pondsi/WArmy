/**
 * 第 22 轮：T34 决策卡扩展门禁（step-capped / eta-anomaly / length-short / 工具循环卡住与硬顶 / 调用链全败 / 计划续派出错）
 *
 * 为什么不是纯文本比对：分类器 `fenLeiRenWuKadian` 与卡面模型 `kadianKaMoxing` 都是**纯函数**，
 * 直接从构建产物里抠出来 `new Function` 跑真输入 —— 判错类别、选项缺「停止」、
 * 该发卡的没发（返回 null）都会真的红，而不是"源码里出现过这句话就算过"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainTsPath = path.join(root, 'packages/app-shell/src/electron-main.ts');
const mainJsPath = path.join(root, 'packages/app-shell/dist/electron-main.js');
const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const pre = fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8');
const mainTs = fs.readFileSync(mainTsPath, 'utf8');

let fail = 0;
const ok = (x, m, d) => { console.log(`${x ? 'PASS' : 'FAIL'} ${m}${x || d === undefined ? '' : ` => ${JSON.stringify(d).slice(0, 200)}`}`); if (!x) fail++; };

if (!fs.existsSync(mainJsPath)) { console.error('缺 dist/electron-main.js：请先 tsc -b packages/app-shell'); process.exit(2); }
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

/** 从构建产物里抠出纯函数（函数体里没有外部引用，抠出来能独立跑） */
function chouHanShu(name) {
  const i = mainJs.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let p = i; p < mainJs.length; p++) {
    const c = mainJs[p];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return mainJs.slice(i, p + 1); }
  }
  return null;
}
const fnLeiSrc = chouHanShu('fenLeiRenWuKadian');
const fnKaSrc = chouHanShu('kadianKaMoxing');
ok(!!fnLeiSrc, '能从 dist 抠出分类器（门禁不是摆设）');
ok(!!fnKaSrc, '能从 dist 抠出卡面模型');
if (!fnLeiSrc || !fnKaSrc) { console.log(`round22 decision gate: FAIL (${fail})`); process.exit(1); }

const fenLei = new Function(`${fnLeiSrc}; return fenLeiRenWuKadian;`)();
const kaMo = new Function(`${fnKaSrc}; return kadianKaMoxing;`)();

// ── 1. 分类：每类卡点都要被认出来（真输入取自审计里出现过的字样）─────────
const cases = [
  [{ error: 'step-capped', jieDuan: '同一步骤续派到顶', why: 'x' }, 'step-capped', '步骤续派到顶'],
  [{ error: '', jieDuan: '自动继续', why: '自动续派 4 次仍未推进，已跳过这一步继续后面的任务' }, 'step-capped', '从文案认出 step-capped'],
  [{ error: 'eta-anomaly', jieDuan: '工具', why: '连续 3 次超过预估' }, 'eta-anomaly', 'ETA 异常'],
  [{ error: 'length-short', jieDuan: '长文分段写', why: '要求 5200 字，实际只写到约 2241 字' }, 'length-short', '长文没写够'],
  [{ error: 'tool-loop-stall(300s 没有任何真实产出)', jieDuan: '模型调用', why: '模型调用失败（整条调用链都试过了）' }, 'tool-stall', '工具循环卡住（先认卡住，不认成链失败）'],
  [{ error: 'tool-loop-hard-cap(1801s)', jieDuan: '模型调用', why: 'y' }, 'tool-hard-cap', '工具循环硬顶'],
  [{ error: 'no-model-available', jieDuan: '模型调用', why: '模型调用失败（没有可用模型）' }, 'model-chain-fail', '没有可用模型'],
  [{ error: 'HTTP 500', jieDuan: '计划续派', why: '（自动继续下一步时出错，已停下。）' }, 'plan-continue-fail', '计划续派出错'],
  [{ error: 'no-progress', jieDuan: '自动继续', why: '连续两轮模型都没有调用任何工具' }, null, 'no-progress 不重复发卡（自己分支已发）'],
  [{ error: 'repeat-3x', jieDuan: '循环检测', why: '连续多轮重复相同工具与参数' }, null, 'repeat-3x 不重复发卡'],
  [{ error: 'Error: boom', jieDuan: '别的地方', why: '普通错误' }, null, '认不出来的不乱发卡'],
];
for (const [inp, want, label] of cases) {
  const got = fenLei(inp.error, inp.jieDuan, inp.why);
  ok(got === want, `分类：${label}`, { want, got });
}

// ── 2. 卡面：每类都有标题/正文/≥2 选项、恒有「停止」、答完的方向能落地 ─────
const kinds = ['step-capped', 'eta-anomaly', 'length-short', 'tool-stall', 'tool-hard-cap', 'model-chain-fail', 'plan-continue-fail'];
const xiang = { why: '测试原因：这一步反复续派没推进', jieDuan: '测试环节', error: 'tool-loop-hard-cap(1801s)' };
for (const k of kinds) {
  const ka = kaMo(k, xiang);
  ok(!!ka && typeof ka.biaoTi === 'string' && ka.biaoTi.length >= 8, `卡面 ${k}：标题非空`, ka && ka.biaoTi);
  ok(!!ka && typeof ka.ti === 'string' && ka.ti.includes('测试原因') || !!ka && ka.ti.includes('测试环节') || !!ka && ka.ti.includes('tool-loop-hard-cap'),
    `卡面 ${k}：正文带上已知事实（不空喊"出错了"）`, ka && ka.ti.slice(0, 60));
  ok(Array.isArray(ka.options) && ka.options.length >= 3, `卡面 ${k}：至少 3 个方向`, ka.options && ka.options.length);
  ok(ka.options.some((o) => /停止/.test(o.biaoQian)), `卡面 ${k}：恒有「停止任务」`);
  ok(ka.options.every((o) => o.id && o.biaoQian && !/^(同意|允许)/.test(o.biaoQian)), `卡面 ${k}：选项不是授权卡（不会被长期授权顶掉）`);
}
ok(kaMo('tool-hard-cap', xiang).options.some((o) => /30 分钟/.test(o.biaoQian)), '硬顶卡给出「再给它 30 分钟」（延长是一次性授权，不是永久免检）');
ok(kaMo('step-capped', xiang).options.some((o) => /重试这一步/.test(o.biaoQian)), '步骤到顶卡给出「重试这一步」（能把 blocked 放回待办）');
ok(kaMo('length-short', xiang).options.some((o) => /追加/.test(o.biaoQian)), '长文卡给出「接着往后追加」（不重写不覆盖）');

// ── 3. 接线：卡点必须挂在唯一的中断登记出口上，且不许重复挂 ─────────────
ok(/function biaoRenWuZhongDuan[\s\S]{0,1800}?fenLeiRenWuKadian\(/.test(mainTs), '决策卡挂在 biaoRenWuZhongDuan（唯一中断登记出口）上', undefined);
ok(mainTs.includes('jueCeKaZaiDeng.has(k)') && mainTs.includes('jueCeKaZaiDeng.delete(k)'), '同一会话同一类卡点只挂一张（在途去重 + 答完释放）');
ok(/qingQiuKaPian\(\s*sessionId,\s*ka\.biaoTi/.test(mainTs), '卡面走 qingQiuKaPian（沿用 24h 默认等待）');
ok(mainTs.includes('timeoutMs = 24 * 60 * 60 * 1000'), '决策卡默认等待仍是 24 小时');
ok(/if \(!xuan\) return;/.test(mainTs.replace(/\r/g, '').replace(/；[^\n]*\n/g, '\n')) || mainTs.includes('if (!wen) return;'), '24h 没人答 ⇒ 什么都不做（不烧 token、不替用户拿主意）');
ok(mainTs.includes("return { jiXu: false, liYou: 'step-capped' }"), '步骤续派到顶如实报 step-capped（不再伪装成 done）');
ok(mainTs.includes("if (pan.liYou === 'step-capped')") && mainTs.includes("'step-capped', '同一步骤续派到顶'"), 'step-capped 分支登记中断并发卡');
ok(mainTs.includes("toolXunHuanYanZhang.set(String(sessionId || ''), Date.now() + 30 * 60 * 1000)"), '「再给它 30 分钟」真的写进延长账本');
ok(/const yingDingMs = yanZhangDao > Date.now\(\) \? YING_DING_MS \+ \(yanZhangDao - Date\.now\(\)\) : YING_DING_MS;/.test(mainTs), '巡检硬顶读用户批准的延长量（不是把常量改了）');
ok(mainTs.includes('if (yanZhangDao) toolXunHuanYanZhang.delete(String(sessionId || \'\'));'), '延长用完即失效（不许批一次永久免检）');
ok(mainTs.includes("broadcastToWindows('warmy:jueCeKaJiXu'"), '选完方向后广播给界面（模型/牛马配置在界面那侧）');
ok(pre.includes("onJueCeKaJiXu: (cb) => ipcRenderer.on('warmy:jueCeKaJiXu'"), 'preload 暴露 onJueCeKaJiXu');
ok(appJs.includes('window.warmy.onJueCeKaJiXu?.(') && /onJueCeKaJiXu[\s\S]{0,900}?zhiXingJueCeKa\(d\)/.test(appJs) && /function zhiXingJueCeKa[\s\S]{0,700}?void deliver\(sid, prompt, 'P2'\)/.test(appJs), '界面用同一条 deliver 路径接着发（经 zhiXingJueCeKa）');
ok(/function zhiXingJueCeKa[\s\S]{0,700}?state\.planResumeDisabled\[sid\] = true[\s\S]{0,300}?void deliver\(/.test(appJs), '卡片已续派的会话：「继续 / 重试」按钮随即失效（不许派两轮）');
ok(/function zhiXingJueCeKa[\s\S]{0,300}?if \(queueBusy\(sid\)\)/.test(appJs), '第 28 轮：上一轮还在跑时不并行开新一轮（选完选项"像停了其实还在跑"的修法）');
ok(mainTs.includes('chongZhiBeiTiaoGuoDeBuZhou(sessionId)') && /status === 'blocked'[\s\S]{0,80}status: 'pending'/.test(mainTs), '选「重试这一步」会把 blocked 步骤放回 pending');
ok(mainTs.includes('etaYiChang.delete(sessionId);') && mainTs.includes('buZhouYanXu.delete(sessionId);'), '继续前清掉异常/续派计数（否则下一轮立刻又被判停）');
/**
 * 反语义误路由：「按原调用链再试一次」字面里也带"调用链"。
 * 若先判"换模型"，用户点的是**重试**，却被办成"你自己去设置里改" ⇒ 方向被偷换。
 * 判据是**代码顺序**：先算"接着干"的方向，再才轮到换模型/补充要求。
 */
{
  const ti = mainTs.indexOf('function lvXingKadianJueCe');
  const fenZhi = mainTs.slice(ti, ti + 4000);
  const idxJiXu = fenZhi.indexOf('const jiXuLei =');
  const idxMoXing = fenZhi.indexOf('去设置里调整');
  ok(idxJiXu > 0 && idxMoXing > idxJiXu, '「再试一次」不会被误判成「换模型」（先判接着干，再判换模型）', { idxJiXu, idxMoXing });
  ok(/\/换模型\|去设置里调整\|调整调用链\|擅长写长文\//.test(fenZhi), '换模型分支不再用裸"调用链"当判据（避免撞上"按原调用链再试一次"）');
  ok(/认不出的方向\*\*不乱动\*\*/.test(fenZhi) || /return;\s*\/\/\s*认不出的方向/.test(fenZhi), '认不出的方向直接不动（不替用户猜）');
}

// ── 4. 反例自证：分类器不是"永远返回同一个值"的摆设 ────────────────────
{
  const luan = fenLei('anything-else', '无关环节', '无关原因');
  ok(luan === null, '反例：认不出的卡点不发卡（宁可不发，也不乱发）', { got: luan });
  const buTong = new Set(kinds.map((k) => kaMo(k, xiang).biaoTi));
  ok(buTong.size === kinds.length, '反例：七类卡点各有自己的标题（不是同一张卡复用）', buTong.size);
}

console.log(`round22 decision gate: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail + ' 红' : '全绿'})`);
process.exit(fail ? 1 : 0);
