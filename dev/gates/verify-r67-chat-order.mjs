/**
 * verify-r67-chat-order.mjs（fast 档）—— 第 67 轮 项 11/12/13/17/18 的接线判据。
 * 只做静态/真值表；行为由真机 UI 与真实模型三连覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/preload.cjs'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/she-jiao-adapter.ts'), 'utf8');

let ok = 0, fail = 0;
const jian = (l, p, d) => { if (p) { ok++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 200) : '')); } };

/* ── 项 18：真实时间线 ── */
jian('项18 工具开始 ⇒ 当前正文移入 streamInterim 并清空正文缓冲',
  /state\.streamInterim/.test(APP) && /lie\.push\(\{ ts: Number\(\(sb && sb\.contentAt\) \|\| Date\.now\(\)\), text: zj \}\)/.test(APP)
  && /sb\.content = ''; sb\.contentAt = 0;/.test(APP));
jian('项18 流式思考/中间回复生成多段执行过程（guoChengLie + zhongJianKa）',
  /guoChengLieHtml/.test(APP) && /zhongJianKa/.test(APP) && /zhongJian/.test(APP));
jian('项18 中间回复把执行过程切段；工具按 data-fen 归属',
  /guoChengLieHtml/.test(APP) && /data-fen/.test(APP) && /guoChengDuan/.test(APP));
jian('项18（第122轮改口径）中间回复与最终回复同样式：无浮雕/渐变，悬停操作条左下',
  /\.zhongJianKa\s*\{[^}]*background:\s*var\(--them-bubble\)/.test(CSS)
  && !/\.zhongJianKa\s*\{[^}]*linear-gradient/.test(CSS)
  && !/\.zhongJianKa\s*\{[^}]*inset/.test(CSS)
  && /\.guoChengCaoZuo\s*\{[^}]*justify-content:\s*flex-start/.test(CSS));

/* ── 项 11/12：附加内容纯文本 + 只有它有悬停气泡 ── */
jian('项12 附加内容用 escapeHtml，不经过 mdHtml/链接转换',
  /function addendumHtml/.test(APP) && /escapeHtml\(text\)/.test(APP)
  && !/addendumHtml[\s\S]{0,800}mdHtml/.test(APP));
jian('项11 附加内容 CSS 无下划线/手型光标，链接样式被强制回落',
  /\.waiJiaNeiRong[\s\S]{0,400}text-decoration:\s*none/.test(CSS)
  && /cursor:\s*default/.test(CSS) && /\.waiJiaNeiRong a[^{]*\{[^}]*text-decoration:\s*none !important/.test(CSS));
jian('项12 只有附加内容挂 data-tip 气泡，聊天气泡不再挂 title',
  /class="waiJiaNeiRong"[^>]*data-tip=/.test(APP) && !/div\.title\s*=/.test(APP));

/* ── 项 13：回档 ── */
jian('项13 回档 IPC 不再覆盖聊天 jsonl，只恢复工作区 + 文件日志',
  /chuliIpc\('warmy:checkpointHuiGun'[\s\S]{0,2200}?checkpoints\.rollback\(id, \{ \.\.\.\(ws \? \{ workspace: ws \} : \{\}\) \}\)/.test(MAIN)
  && !/chuliIpc\('warmy:checkpointHuiGun'[\s\S]{0,2200}?jsonlPath: jsonl/.test(MAIN));
jian('项13 回档追加“回档到…”作为聊天上下文',
  /回档到 \$\{label\}/.test(MAIN) && /role: 'system'/.test(MAIN));
jian('项13 工作区外文件留原件（fs 钩子 + 回档还原）',
  /function huiDangBeiFen/.test(MAIN) && /function zhuangXieRuHuiDangGouZi/.test(MAIN)
  && /function huiDangHuiFu/.test(MAIN) && /daiHuiDang\(/.test(MAIN));
jian('项13 UI 是“回档”，没有“回到这一轮之前”按钮/预加载 API',
  /data-load=.*checkpoints\.huiDang/.test(APP) && !/data-cp-round/.test(APP) && !/chatRollbackRound/.test(PRELOAD)
  && /checkpointRollback: \(id, opts\)/.test(PRELOAD));

/* ── 项 17：微信多账号 ── */
jian('项17 个人微信改名为“微信（个人）”，风险只写“中”',
  /ming: '微信（个人）'/.test(ADAPTER) && /id: 'ilink'.*fengXian: '中'/.test(ADAPTER)
  && !/静默风控/.test(ADAPTER));
jian('项17 配置按 accounts[] 保存，凭据在唯一入口逐条加密，最多 5 个',
  /type SheJiaoZhangHao/.test(MAIN) && /SHE_JIAO_ZHANG_HAO_SHANG_XIAN = 5/.test(MAIN)
  && /function cunSheJiaoZhangHao/.test(MAIN) && /sheJiaoPeiZhiZhuan\(x, zhengJiaMi\)/.test(MAIN));
jian('项17 每个账号单独连接键（实例::平台::账号）',
  /function sheJiaoLianJieJian\(instId: string \| undefined, pingTai: string, accountId = 'default'\)/.test(MAIN)
  && /String\(instId \|\| ''\) \+ '::' \+ String\(pingTai \|\| ''\) \+ '::'/.test(MAIN));
jian('项17 列表显示链接时间/最近使用/连接/断开/删除',
  /shejiao\.wxCreated/.test(APP) && /shejiao\.wxLastUsed/.test(APP)
  && /data-sj-acc-conn/.test(APP) && /data-sj-acc-disc/.test(APP) && /data-sj-acc-del/.test(APP));

/* ── 项 1/10/14：ASR 自动语言、whisper 排除、模型分类 ── */
jian('项1 ASR 不再强制 zh 重试；没有按短语猜幻觉的误杀',
  !/asr\.zh-retry/.test(MAIN) && !/asr-hallucination/.test(MAIN) && !/yiHuanJue/.test(MAIN)
  && /asrWuYuYin/.test(MAIN));
jian('项10 ASR 链严格按配置顺序，Ollama 按协议事实排除',
  /\[\.\.\.new Set\(nengLiLianMoXing\('asr'\)\)\]/.test(MAIN)
  && !/shiAsrHouXuan/.test(MAIN) && /an\.protocol === 'ollama'/.test(MAIN));
jian('项10 UI 不把 Ollama whisper 当可运行模型/听话模型',
  /if \(nl && nl\.buKeYong\) return false;/.test(APP)
  && /dimavz\\\//.test(APP) && /return 'unknown';/.test(APP));
{
  const providersSrc = fs.readFileSync(path.join(ROOT, 'packages/providers/src/mo-xing-neng-li.ts'), 'utf8');
  jian('项14 分类正则带 orcarouter 负向断言，clef 命中 decision',
    /router\(\?!outer\)/.test(providersSrc) && providersSrc.includes('clef([-_/.:]|$)'));
}

/* ── 项 16：卡片标注真正注入 ── */
jian('项16 「要求」卡标注“注入”且每个会话都显示；规范/印象/项目记忆卡已移除',
  /panInjectBadge/.test(HTML) && (HTML.match(/panInjectBadge/g) || []).length >= 1
  && /set\('mianBanYaoQiuKuai', vis\.mianBanYaoQiuKuai\)/.test(APP)
  && !/id="mianBanGuiFanKuai"/.test(HTML)
  && !/id="mianBanYinXiangKuai"/.test(HTML) && !/id="xiangMuJiYiKuai"/.test(HTML));

console.log(`==== verify-r67-chat-order：${ok} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
