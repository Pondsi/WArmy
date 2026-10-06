#!/usr/bin/env node
/**
 * 全量连续 3 轮验证跑批器（覆盖项目**全部**可跑门禁 + 专项单测）。
 *
 * 用法：node scripts/full-verify-rounds.mjs [rounds=3]
 *
 * 关键设计：
 *  - 每轮开始**清理游魂 Electron**：Electron 类门禁靠 CDP 连本地端口，残留进程会让
 *    它们报 "CDP not up"（实测踩过），必须先把上一轮/上次留下的进程收干净。
 *  - Electron 类门禁给足超时（它们要真启动应用）；超时计为该轮失败，不静默放过。
 *  - 单测（UNIT）覆盖：凭证遮挡、i18n、主题色、引导、工作工具会话权限等跨文件不变量。
 */
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..');
const node = process.execPath;
const need = Number(process.argv[2] || 3);

const E = (n) => `packages/app-shell/scripts/${n}`;

/** 无头/静态门禁（快） */
const GATES_FAST = [
  E('check-syntax.mjs'),
  E('verify-security.mjs'),
  E('verify-template-integrity.mjs'),
  E('verify-naming.mjs'),
  E('verify-electron-app-binding.mjs'),
  E('verify-container-probe.mjs'),
  E('verify-container-exec.mjs'),
  E('verify-credential.mjs'),
  E('verify-identity.mjs'),
  E('verify-i18n-locales.mjs'),
  E('verify-wiring.mjs'),
  E('verify-docs.mjs'),
  E('verify-group-store.mjs'),
  E('verify-history-persist.mjs'),
  E('verify-memory.mjs'),
  E('verify-router-queue.mjs'),
  E('verify-repo-guard.mjs'),
  E('verify-updater.mjs'),
  E('verify-updater-github.mjs'),
  E('verify-work-tools.mjs'),
  E('verify-office-ooxml.mjs'),
  E('verify-model-route.mjs'),
  E('verify-chat-content.mjs'),
  E('verify-model-pick.mjs'),
  E('verify-subagents.mjs'),
  E('verify-import-integrity.mjs'),
  E('verify-renderer-template-balance.mjs'),
  E('verify-membership.mjs'),
  E('verify-planB.mjs'),
  E('verify-planD.mjs'),
  E('verify-summary-quality.mjs'),
  E('verify-warmy-features.mjs'),
  E('verify-css-consistency.mjs'),
  E('verify-features-99.mjs'),
  E('verify-nm-format.mjs'),
  E('verify-tasks-666.mjs'),
  E('verify-thinking-merge.mjs'),
  E('verify-eta-forecast.mjs'),
];

/** Electron 类门禁（真启动应用 + CDP，慢） */
const GATES_ELECTRON = [
  E('verify-ui-layout.mjs'),
  E('verify-firstrun-ui.mjs'),
  E('verify-busy-toggle.mjs'),
  E('verify-runtime-errors.mjs'),
  E('verify-chat-window.mjs'),
  E('verify-ipc-probe.mjs'),
  E('verify-raf-batching.mjs'),
  E('verify-sound-card.mjs'),
  E('verify-strict-language.mjs'),
  E('verify-think-toolbar.mjs'),
  E('verify-usage-table.mjs'),
];

function killStrayElectron() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore', timeout: 30000 });
    } else {
      execSync("pkill -f 'electron' || true", { stdio: 'ignore', timeout: 30000 });
    }
  } catch { /* 没有残留进程时 taskkill 会返回非 0，属正常 */ }
}

function runGate(g, timeout) {
  const p = path.join(root, g);
  if (!fs.existsSync(p)) return { ok: false, out: `missing script ${g}` };
  try {
    const out = execFileSync(node, [p], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout });
    return { ok: true, out: String(out).slice(-300) };
  } catch (e) {
    const killed = e.killed === true || e.signal === 'SIGTERM';
    return { ok: false, out: (killed ? `TIMEOUT after ${timeout}ms\n` : '') + String(e.stdout || e.stderr || e).slice(-900) };
  }
}

function unitChecks() {
  const fails = [];
  const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const distJs = fs.readFileSync(path.join(root, 'packages/app-shell/dist/renderer/app.js'), 'utf8');
  const probe = fs.readFileSync(path.join(root, 'packages/app-shell/dist/container-probe.js'), 'utf8');
  const work = fs.readFileSync(path.join(root, 'packages/app-shell/dist/work-tools.js'), 'utf8');
  const emTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  const ss = fs.readFileSync(path.join(root, 'packages/app-shell/src/settings-store.ts'), 'utf8');
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/zh-CN.json'), 'utf8'));
  const css = ['app.css', 'renderer.css']
    .map((n) => fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/' + n), 'utf8'))
    .join('\n');

  // 凭证遮挡：开头 1 组 + 9 牛马 + 末 6 字符
  if (!appJs.includes('CRED_MASK_GROUPS = 9')) fails.push('mask: CRED_MASK_GROUPS!=9');
  if (!appJs.includes('raw.slice(-6)')) fails.push('mask: last 6 chars missing');
  // i18n
  if (!appJs.includes('const tOr =')) fails.push('tOr missing');
  if (appJs.includes("t('panel.assist') ||")) fails.push('dropdown still uses raw t()||');
  // 容器 / Microsandbox
  if (!probe.includes("id: 'microsandbox'")) fails.push('probe: microsandbox missing');
  if (!probe.includes('microsandboxExecPlan')) fails.push('probe: msb exec plan missing');
  if (!zh['container.rt.microsandbox.name']) fails.push('i18n: microsandbox missing');
  // dsh
  if (!String(zh['dsh.biaoTi'] || '').includes('DeepSeek Shell')) fails.push('i18n: dsh full name');
  if (!appJs.includes('MIN_MS = 1300')) fails.push('dsh: min not 1300');
  // 主题色
  if (!appJs.includes("theme: '#A78567'")) fails.push('theme: default not #A78567');
  if (!ss.includes("accent: '#A78567'")) fails.push('theme: settings-store accent not #A78567');
  if (/#(?:2ea56a|07c160|10ad6a)/i.test(css)) fails.push('theme: green hex still in css');
  if (appJs.includes("btn.textContent = t('list.addInstance')")) fails.push('create btn not plus');
  if (!appJs.includes('iQiDongTingZhi')) fails.push('toggle button missing');
  if (!appJs.includes('bindThemeMode')) fails.push('theme: mode buttons not bound');
  if (!appJs.includes('miYaoYan')) fails.push('provider: key eye missing');
  if (!appJs.includes('__lastSend')) fails.push('chat: no duplicate-send guard');
  if (!appJs.includes('presetFromName')) fails.push('chat: unstable avatar fallback');
  if (!appJs.includes('xiaoXiMing')) fails.push('chat: speaker name missing');
  if (!appJs.includes('renderDefaultOptions')) fails.push('model: default options follow available');
  if (!appJs.includes('model.disable')) fails.push('model: chain disable missing');
  // 引导
  if (!appJs.includes('yinDaoTiao') || !appJs.includes('yinDaoLianJie')) fails.push('guide: bar/tip missing');
  if (!appJs.includes('guide.finish')) fails.push('guide: finish label missing');
  if (!appJs.includes('check: youGongYingShang') || !appJs.includes('check: youNiuMa')) fails.push('guide: no per-step gating');
  if (!appJs.includes('anNiuChongKanYinDao') || !appJs.includes('guideDone')) fails.push('guide: restart/persist missing');
  if (!css.includes('.yinDaoTiao') || !css.includes('right: 16px')) fails.push('css: guide not on the right');
  // 主进程
  if (!/process\.on\('uncaughtException'/.test(emTs)) fails.push('main: uncaughtException not handled');
  if (!huiYongWork(emTs)) fails.push('main: work tools not wired');
  // 小弟必须能干活，且不能再生小弟（以 spawn 登记点为锚，别被注释里的名字带偏）
  {
    const i = emTs.indexOf('chat.xiao-di-spawn');
    const seg = i >= 0 ? emTs.slice(Math.max(0, i - 1800), i + 1800) : '';
    if (!seg.includes('workToolSpecs')) fails.push('subagent work tools: 小弟没有文件工具');
    if (seg.includes('xiaoDiToolSpecs()')) fails.push('subagent work tools: 小弟又派小弟');
    if (!/zuiDaLunShu:\s*4/.test(seg)) fails.push('subagent work tools: 轮数过小');
  }
  if (!appJs.includes('chainDisabled')) fails.push('model: chainDisabled not persisted from UI');
  if (emTs.includes('pickModelForUrgency(')) fails.push('model: dead pickModelForUrgency still called');
  // 本轮 10 项专项
  if (!appJs.includes('yuYanBaoHuDao') || !appJs.includes('keYiGengYuYan')) fails.push('lang: no lock against revert');
  if (!appJs.includes('openExternal') || !emTs.includes('daKaiWaiBuLianJie')) fails.push('guide: external link not via system browser');
  if (!appJs.includes('bangTuo')) fails.push('guide: drag-snap missing');
  if (!appJs.includes('webgpuKa')) fails.push('webgpu: section missing');
  if (!appJs.includes('model.mgr') || !appJs.includes('modelZiXiang')) fails.push('model: manage-model card missing');
  if (!appJs.includes('showToast') || !appJs.includes('jianYiToast')) fails.push('toast: missing');
  if (!appJs.includes("status: 'running'")) fails.push('inst: created not marked running');
  if (!appJs.includes('yingYongWenZiPiHao') || !appJs.includes('ziTiXuanZe')) fails.push('text: font card missing');
  if (!emTs.includes('lieBiaoXiTongZiTi') || !emTs.includes('anZhuangZiTi')) fails.push('text: font IPC missing');
  const cssT = ['app.css','renderer.css'].map((n) => fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/' + n), 'utf8')).join('\n');
  if (!cssT.includes('.jianYiToast') || !cssT.includes('pointer-events: none')) fails.push('toast: css missing/not click-through');
  if (!cssT.includes('--fw-ui')) fails.push('text: weight var missing');
  if (!appJs.includes('和牛马聊天')) fails.push('guide: step3 button label');
  // 本轮 3 项专项（语言回退 / 引导卡拖动 / 设置页排版）
  if (!appJs.includes('yuYanDaiQueRen')) fails.push('lang: pending-choice lock missing');
  if (!/jieChuYuYanDaiQueRen\(/.test(appJs)) fails.push('lang: pending not cleared when settings catch up');
  // 局部变量遮蔽 i18n 的 t() ⇒ TypeError: t is not a function（本轮真事故：ctxRenderMeta）
  {
    const tDef = appJs.indexOf('const t = (k) =>');
    const after = tDef < 0 ? '' : appJs.slice(appJs.indexOf('\n', tDef));
    if (tDef < 0) fails.push('i18n: t() 定义丢失');
    else if (/^[ \t]*(?:const|let|var)[ \t]+t[ \t]*=[ \t]*[^=]/m.test(after)) fails.push('renderer: 有局部 t = ... 遮蔽 i18n 的 t()');
  }
  {
    const noDrag = (cssT.match(/\.yinDaoTiao\s*\{[^}]*no-drag/gs) || []).length;
    if (noDrag < 2) fails.push(`guide: .yinDaoTiao 未声明 -webkit-app-region: no-drag（命中 ${noDrag}/2 个 css）`);
  }
  {
    // 设置页内容列必须真的包住分区（模板级断言放在 verify-renderer-template-balance.mjs；这里再掐一次关键包裹）
    const seg = appJs.indexOf('id="peiZhiNeiRong"');
    const tail = appJs.slice(seg, seg + 300);
    if (!/id="peiZhiNeiRong"/.test(appJs) || !/peiZhiBuJu/.test(appJs)) fails.push('settings: layout container missing');
    if (!appJs.includes('<!-- WebGPU 测试与模型无关，已挪到「功能」分区（见下方 #webgpuKa） -->')) fails.push('settings: webgpu move comment lost');
    void tail;
  }
  // ── 本轮 11 项专项 ──
  // 1) 语言：用户选过就本会话不让步（旧的 2 分钟兜底过期是"几分钟后又跳回"的真凶）
  if (appJs.includes('yuYanDaiQueRenZhi')) fails.push('lang: 过期兜底又回来了（待确认必须粘住）');
  if (!appJs.includes('yuYanDuiHuaKuanKaiZhe')) fails.push('lang: 引导语言对话框打开时不许自动改语言');
  if (!appJs.includes('落盘回读校验') && !appJs.includes('落盘未跟上用户选择')) fails.push('lang: 选完语言没有回读校验');
  // 9) 模型名必须剥成纯 id（复合展示标签发出去是 HTTP 400）
  if (!appJs.includes('jieMoXingMing')) fails.push('model: 复合标签剥前缀未接入渲染层/主进程');
  if (!emTs.includes('jieMoXingMing')) fails.push('model: 主进程未接入 jieMoXingMing');
  // 8) 同一句话显示两遍：角色必须归一（wo/user、them/assistant）
  if (!emTs.includes('guiYiJiaoSe')) fails.push('chat: 角色未归一（会重复显示）');
  if (!appJs.includes("m.role === 'user' || m.role === 'wo'")) fails.push('chat: 合并时未认 wo/them 两套角色名');
  // 10) 聊天进行中的动态小字
  if (!appJs.includes('yunXingZhuangTaiKai') || !appJs.includes('yunXingZhuangTaiGuan')) fails.push('busy: 进行中动态小字缺失');
  if (!zh['chat.busy.1'] || !zh['chat.busy.done']) fails.push('busy: i18n 键缺失');
  if (!zh['chat.busy.still'] || !zh['chat.busy.fail']) fails.push('busy: 长任务/失败态文案缺失');
  if (!appJs.includes('yunXingMiao')) fails.push('busy: 已用秒数缺失');
  if (!appJs.includes('yunXingHuiHua')) fails.push('busy: 未按会话隔离');
  if (!cssT.includes('yunXingTan') || !cssT.includes('prefers-reduced-motion')) fails.push('busy: 打字点动画/减弱动效缺失');
  // 2) 发送按钮进行中
  if (!appJs.includes('faSongZhong') || !cssT.includes('faSongZhong')) fails.push('send: 进行中状态缺失');
  // 3) 拉取失败的「重试」
  if (!appJs.includes('data-retry') || !zh['common.retry']) fails.push('fetch: 失败后无重试入口');
  // 4) 启动/停止结果反馈
  if (!appJs.includes('showToast(inst.status')) fails.push('inst: 启停后无 Toast 反馈');
  // 5) 渲染层写入口也剥模型复合标签
  if (!appJs.includes('jieMoXingMing')) fails.push('model: 渲染层未剥复合标签');
  // 6) 导出角色两套命名都要认
  if (!emTs.includes("xiaoXi.role === 'user'")) fails.push('export: 角色归一缺失');
  // 7) 图标按钮无障碍名称跟随标题
  if (!appJs.includes("setAttribute('aria-label'")) fails.push('a11y: 图标按钮缺 aria-label 同步');
  // 3) 拉取模型动画至少 1.7s
  if (!appJs.includes('1700')) fails.push('fetch: 动画没有 1.7s 下限');
  if (!cssT.includes('.laQuZhuan') || !cssT.includes('.laQuJinDu')) fails.push('fetch: 动画样式缺失');
  // 2/4/5/7) 引导卡真实图标 + 新文案
  if (!appJs.includes('YIN_DAO_TU_BIAO') || !appJs.includes('yinDaoTuBiao')) fails.push('guide: 真实图标缺失');
  if (!cssT.includes('.yinDaoTuBiao')) fails.push('guide: 图标样式缺失');
  if (!appJs.includes('{icon:settings}') || !appJs.includes('{icon:niuMa}') || !appJs.includes('{icon:guanLiJu}')) fails.push('guide: 图标占位符缺失');
  if (!String(zh['guide.step2.body'] || '').includes('牛马管理局')) fails.push('guide: 第2步未指向 牛马管理局');
  if (!String(zh['guide.step2.value'] || '').includes('能随时差遣')) fails.push('guide: 第2步收益行不对');
  // 6) 启动/停止单飞
  if (!appJs.includes('instanceToggleBusy')) fails.push('inst: 启动/停止没有单飞保护');
  // ── 本轮（2026-10-01 第二批）专项 ──
  // 13) 安全授权标签：键名必须是 full（写成 Quan 会让「完全授权」显示成「常规授权」）
  if (!appJs.includes("full: 'chat.securityFull'") || !appJs.includes("full: 'settings.securityFullDesc'")) fails.push('sec: 完全授权标签键名不对');
  if (appJs.includes("Quan: 'chat.securityFull'") || appJs.includes("Quan: 'settings.securityFullDesc'")) fails.push('sec: 过期的 Quan 键还在');
  // 8/20) 聊天：右对齐 / 悬停时间 / 时间分隔 / 思考过程
  if (!appJs.includes('wanZhengShiJian') || !appJs.includes('kuaShiJianDian')) fails.push('chat: 时间戳/分隔缺失');
  if (!appJs.includes('siKaoKuai')) fails.push('chat: 思考过程块缺失');
  if (!cssT.includes('text-align: right')) fails.push('chat: 我方消息未右对齐');
  // 21) 思考级别：管理模型滑块 + 聊天框覆盖 + 降级标注
  if (!appJs.includes('THINK_STOPS') || !appJs.includes('iThinkLevel')) fails.push('think: 思考级别未接通');
  if (!emTs.includes('siKaoCanShu') || !emTs.includes('jiangJiTiShi')) fails.push('think: 主进程未做降级标注');
  if (!zh['chat.thinkDowngraded'] || !zh['model.think.auto']) fails.push('think: i18n 键缺失');
  // 6) 智能模式合并默认模型
  if (!appJs.includes('iSmartMoXing') || !appJs.includes('lianMoRenMoXing')) fails.push('model: 智能模式/默认模型合并缺失');
  if (!zh['model.smart']) fails.push('model: 智能模式文案缺失');
  // 5) 两列选择器：左侧未选右侧为空
  if (!appJs.includes('x.id === provPick.value) || null')) fails.push('model: 左侧未选时右侧未清空');
  // 18) 字体：家族名 + 粗细滑块 + 确定
  if (!emTs.includes('InstalledFontCollection')) fails.push('font: 未取系统家族名');
  if (!appJs.includes('anNiuWenZiQueDing')) fails.push('font: 缺确定按钮');
  // 3) MiMo 预设（实测端点）
  if (!appJs.includes('api.xiaomimimo.com')) fails.push('provider: MiMo 预设缺失');
  // 1/2) 配置拆分：功能设置 / 画面外观分文件
  if (!ss.includes('APPEARANCE_KEYS') || !ss.includes('appearance.json')) fails.push('config: 外观未拆独立配置文件');
  // 10) 截图按钮真功能
  if (!appJs.includes('captureScreen')) fails.push('shot: 截图按钮未接真功能');
  if (!emTs.includes('screenshots')) fails.push('shot: 截图未落盘');
  // 12/15/22) 宿主工具 + 定时任务/文件卡片
  if (!emTs.includes('hostToolSpecs') || !emTs.includes('open_path')) fails.push('host: 打开文件/浏览器工具缺失');
  if (!emTs.includes('dingShiRenWuJi') || !appJs.includes('queBaoKaPian')) fails.push('panel: 定时任务卡片缺失');
  // 14) 身份强制注入
  if (!emTs.includes('llm.identityLine') || !appJs.includes('ming: inst0')) fails.push('identity: 名字未强制注入');
  // 16) 导出后在资源管理器里显示
  if (!appJs.includes('xianShiWenJianJia')) fails.push('export: 导出后未显示文件位置');
  // 23) 聊天文字随背景变色（黑白灰分级）
  if (!appJs.includes('wenZiYanSeBeiJing') || !appJs.includes('tongBuBeiJingWenZi')) fails.push('contrast: 文字色未随背景计算');
  if (!cssT.includes('--me-bubble-ink') || !cssT.includes('--them-bubble-ink')) fails.push('contrast: 气泡文字色变量缺失');
  if (/\.xiaoXi\.wo \.bubble \{[^}]*color:\s*#111\s*;/s.test(cssT)) fails.push('contrast: 我方气泡仍写死黑字');
  // 24) 小弟数量（自适应 / 手动）
  if (!appJs.includes('iXiaoDiShu') || !appJs.includes('xiaoDiShuLiang')) fails.push('xiaoDi: 小弟数量选项缺失');
  if (!emTs.includes('xiaoDiShangXian') || !emTs.includes('yiPaiXiaoDi')) fails.push('xiaoDi: 主进程未按上限派小弟');
  if (!zh['model.xiaoDi']) fails.push('xiaoDi: i18n 键缺失');
  // ── 本轮（第三批）专项 ──
  // 1/13) 最高信念（agents.md）+ 我的名字强制注入
  if (!emTs.includes('agents.md') || !emTs.includes('zuiGaoXinNianShe')) fails.push('belief: agents.md 未落地');
  if (!emTs.includes('最高信念·最高优先级')) fails.push('belief: 未强制注入到每次请求');
  if (!appJs.includes('zuiGaoXinNianTi') || !zh['wo.belief']) fails.push('belief: 我的页卡片/i18n 缺失');
  if (!emTs.includes('llm.userLine') || !emTs.includes('dangQianYongHuMing')) fails.push('identity: 我的名字未注入');
  // 3) 预设：默认只有 DeepSeek；MiMo 在下拉里
  if (/PROVIDER_DEFAULTS[\s\S]{0,400}?mimo/.test(appJs)) fails.push('provider: 默认预置里不该有 mimo');
  if (!appJs.includes("id: 'mimo'")) fails.push('provider: 预设下拉里缺 mimo');
  // 6) 思考级别 8 档 + 按模型档位比例映射
  if (!/THINK_STOPS = \['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'auto'\]/.test(appJs)) fails.push('think: 8 档命名不对');
  if (!emTs.includes('siKaoQiangDu') || !emTs.includes('yingSheDangWei') || !emTs.includes('listModelsDetailed')) fails.push('think: 模型档位映射未接通');
  if (!zh['model.think.l6'] || !zh['model.think.off']) fails.push('think: 8 档 i18n 缺失');
  // 7/24) 思考过程展开折叠 + Markdown 渲染
  if (!appJs.includes('siKaoKai') || !appJs.includes("' open'")) fails.push('think: 思考过程未按回答状态展开/折叠');
  if (!appJs.includes('mdHtml') || !cssT.includes('.bubble.md .mdP')) fails.push('md: Markdown 渲染缺失');
  // 21) 音效：内置默认 + 播放 + 触发规则
  if (!emTs.includes("'warmy:yinXiaoQu'") || !appJs.includes('chuanBoYinXiao')) fails.push('sound: 通知音未接通');
  if (!fs.existsSync(path.join(root, 'packages/app-shell/src/renderer/sounds/complete.wav'))) fails.push('sound: 内置完成音缺失');
  if (!fs.existsSync(path.join(root, 'packages/app-shell/src/renderer/sounds/request.wav'))) fails.push('sound: 内置请求音缺失');
  if (!fs.existsSync(path.join(root, 'packages/app-shell/src/renderer/sounds/error.mp3'))) fails.push('sound: 内置错误音缺失');
  if (!/kind !== 'internal' && kind !== 'extgroup'/.test(appJs)) fails.push('sound: 群聊不该发音效');
  // 16/17/20/22) 请求卡 + 越权询问 + 完全授权 + 带「其他」的选择卡
  if (!appJs.includes('secWenXun') || !appJs.includes('askOnExceed')) fails.push('auth: 超出权限是否询问缺失');
  if (!emTs.includes('qingQiuKaPian') || !emTs.includes('dengDaiKaPian')) fails.push('auth: 请求卡阻塞等待缺失');
  if (!work.includes("name: 'ask_user'") || !work.includes('HOST_TOOL_NAMES')) fails.push('auth: ask_user 工具缺失');
  if (!work.includes('kuaiQuan')) fails.push('auth: 完全授权未贯穿工作工具');
  // 8/12) 文件产出并入项目文件卡 + 上传预览/路径气泡
  if (appJs.includes('mianBanGongZuoWenJianKuai')) fails.push('files: 旧的「文件产物」卡还在');
  if (!appJs.includes("queBaoKaPian('xiangMuWenJianJiKuai')") || !appJs.includes('data-reveal')) fails.push('files: 未并入项目文件卡/缺文件夹图标');
  if (!appJs.includes('wenJianYuLan') || !appJs.includes('attachSuoLue')) fails.push('upload: 图片预览/文件名缺失');
  // 11) 截图：先藏窗口 + 框选 + 右键取消
  if (!emTs.includes('win.hide()') || !appJs.includes('jieTuKuangXuan') || !appJs.includes('contextmenu')) fails.push('shot: 截图未重做（藏窗口/框选/右键取消）');
  // 23) 导出字段名
  if (!appJs.includes('biaoTi: xianShiMing')) fails.push('export: 导出仍未发 biaoTi');
  // 2) 粗细/大小同一行；5) 小弟到 50
  if (!appJs.includes('ziTiCuXiShu') || !/max="650"/.test(appJs)) fails.push('font: 粗细/大小同行缺失（或字号范围不是 15-650）');
  if (!appJs.includes('[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 30, 40, 50]')) fails.push('xiaoDi: 选项未到 50');
  // 9) 前景色多级灰阶（不止黑白两档）
  if (!/y > 0\.82/.test(appJs) || !/return '#3d3d3d'/.test(appJs)) fails.push('contrast: 仍只有黑白两档');
  // ── 本轮（第四批）专项 ──
  // 1) 决策模型（模型选项卡内，独立调用链；UI 叫「决策模型」，内部键 fenLei*）
  // 分类/决策模型：**牛马局里那份已按产品要求移除**（用不到）；全局那份在「设置 → 模型」里，必须还在
  if (!appJs.includes('smFenLei') || !appJs.includes('fenLeiChain')) fails.push('fenLei: 全局分类模型链缺失');
  if (appJs.includes('id="iFenLei"')) fails.push('fenLei: 牛马局里那份不该还在（产品要求已删）');
  if (!appJs.includes("tOr('settings.modelOptions'")) fails.push('fenLei: 特殊模型未改名「模型选项」');
  // 3) 截图遮罩取图顺序（先 __setCap 再注入）
  if (!emTs.includes('__setCap') || !emTs.includes('jieTuKaiShi')) fails.push('shot: 遮罩取图顺序/入口不对');
  // 4) 队列时间与正文上下排列
  if (!/\.duiLieTiaoMuJi li\s*\{[^}]*flex-direction:\s*column/s.test(cssT)) fails.push('queue: 时间/正文未上下排列');
  // 5) baseURL 规范化（少 /v1 会 404）
  if (!emTs.includes('guiFanBaseURL')) fails.push('url: baseURL 未规范化（会 404）');
  // 2) 计划模式存在
  if (!emTs.includes('plan_update') || !appJs.includes('mianBanJiHuaKuai')) fails.push('plan: 计划模式缺失');
  // 9) 音效 CSP 放行 data:
  if (!/media-src[^"]*data:/.test(fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/index.html'), 'utf8'))) fails.push('sound: CSP 未放行 data: 音频');
  /**
   * 主进程 TDZ：`chuliIpc` 内部要用 `IPC_ALIASES`（const，后面才初始化）。
   * 任何 chuliIpc 出现在它之前 ⇒ 启动即崩 `Cannot access 'IPC_ALIASES' before initialization`
   *（2026-10-02 真事故：两个新 IPC 插得太靠前）。
   */
  {
    const lines = emTs.split('\n');
    const aliasLine = lines.findIndex((l) => l.startsWith('const IPC_ALIASES'));
    const badIdx = aliasLine < 0 ? -1 : lines.findIndex((l, i) => i < aliasLine && l.includes('chuliIpc('));
    if (aliasLine < 0) fails.push('main: IPC_ALIASES 定义丢失');
    else if (badIdx >= 0) fails.push(`main: chuliIpc 出现在 IPC_ALIASES 之前（第 ${badIdx + 1} 行）⇒ 启动会崩`);
  }
  /**
   * index.html 标签平衡：多一个 `</div>` 会让解析器把 `#pageBuJu` 挪出 `#zhuLan`，
   * 于是 `position:absolute; inset:0` 铺满全窗、**压在左侧竖栏下**（2026-10-02 真事故：第二列看不见了）。
   */
  {
    const html = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/index.html'), 'utf8');
    const tags = ['div', 'main', 'aside', 'nav', 'section', 'header', 'footer', 'table', 'tbody', 'tr', 'td', 'form', 'ul', 'li', 'details', 'label', 'button', 'select', 'textarea', 'span'];
    const buPing = [];
    for (const t of tags) {
      const o = (html.match(new RegExp('<' + t + '(?=[\\s>])', 'gi')) || []).length;
      const c = (html.match(new RegExp('</' + t + '>', 'gi')) || []).length;
      if (o !== c) buPing.push(`${t} 开${o}/闭${c}`);
    }
    if (buPing.length) fails.push('index.html 标签不平衡（布局会被解析器重排）: ' + buPing.join(', '));
  }
  // 工作工具
  if (!work.includes('WORK_TOOL_SECURITY')) fails.push('work-tools: security block missing');
  // dist 同步
  for (const s of ['CRED_MASK_GROUPS = 9', 'MIN_MS = 1300', '__lastSend']) {
    if (!distJs.includes(s)) fails.push(`dist missing: ${s}`);
  }
  return fails;
}
function huiYongWork(emTs) {
  return emTs.includes('workToolSpecs') && emTs.includes('runWorkTool') && emTs.includes('huiHuaKeGanHuo');
}

let streak = 0;
for (let rnd = 1; rnd <= Math.max(need * 3, 9); rnd++) {
  console.log(`\n${'#'.repeat(64)}\n# FULL VERIFY ROUND ${rnd} (streak ${streak}/${need})\n${'#'.repeat(64)}`);
  killStrayElectron();
  let clean = true;
  const unit = unitChecks();
  if (unit.length) { clean = false; console.log('UNIT FAIL:\n  ' + unit.join('\n  ')); }
  else console.log('UNIT OK');

  for (const g of GATES_FAST) {
    const r = runGate(g, 180000);
    if (r.ok) console.log(`OK   ${g}`);
    else { clean = false; console.log(`FAIL ${g}\n${r.out}`); }
  }
  for (const g of GATES_ELECTRON) {
    const r = runGate(g, 300000);
    if (r.ok) console.log(`OK   ${g}`);
    else { clean = false; console.log(`FAIL ${g}\n${r.out}`); }
    killStrayElectron();
  }
  if (clean) {
    streak += 1;
    console.log(`\n>>> ROUND ${rnd} CLEAN streak=${streak}/${need}`);
    if (streak >= need) { console.log('FULL_VERIFY_3X_PASSED'); process.exit(0); }
  } else {
    streak = 0;
    console.log(`\n>>> ROUND ${rnd} FAILED`);
  }
}
console.log('FULL_VERIFY_FAILED');
process.exit(1);
