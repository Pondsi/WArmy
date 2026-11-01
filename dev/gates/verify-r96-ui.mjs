/**
 * verify-r96-ui —— 第 96 轮静态门禁（与真机门禁配套）。
 *
 * 覆盖：首启关闭热区/牛马动画、助记拼音与服务级截屏保护、短记忆新口径、
 * 聊天滚动/操作记录时序、受保护命令扫描的误伤修复。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const rd = (p) => { try { return fs.readFileSync(path.join(SRC, p), 'utf8'); } catch { return ''; } };
const auth = rd('renderer/auth-gate.js');
const css = rd('renderer/auth-gate.css');
const app = rd('renderer/app.js');
const main = rd('electron-main.ts');
const preload = rd('preload.cjs');
const kb = (() => { try { return fs.readFileSync(path.join(ROOT, 'packages/knowledge-base/src/index.ts'), 'utf8'); } catch { return ''; } })();
const protectedSrc = rd('protected-paths.ts');

let okN = 0, failN = 0;
const jian = (m, cond, d) => {
  if (cond) { okN++; console.log('  ok   ' + m); }
  else { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); }
};
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? s.slice(i) : s.slice(i, j);
};
const fn = (s, name) => {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') { d++; started = true; }
    else if (s[k] === '}' && started && --d === 0) return s.slice(i, k + 1);
  }
  return '';
};

// ── 1. 首启关闭热区 / 牛马动画 ──────────────────────────────────────────
{
  const hot = between(css, '.warmyAuthCloseHot {', '}');
  const x = between(css, '.warmyAuthCloseX {', '}');
  const track = between(css, '.warmyAuthQuitHorses {', '}');
  jian('关闭热区放大到 180×160', /width:\s*180px/.test(hot) && /height:\s*160px/.test(hot), hot);
  jian('叉点击目标 48×48', /width:\s*48px/.test(x) && /height:\s*48px/.test(x), x);
  jian('牛马轨道不再有背景色/渐变/圆角边界', !/gradient/.test(track) && !/border-radius/.test(track) && /background:\s*transparent/.test(track), track);
  jian('牛马轨道高度 150（给斜率/曲率留空间）', /height:\s*150px/.test(track), track);
  const spawn = fn(auth, 'spawnQuitHorse');
  jian('路径随机仍保留平移（28%）并加大斜线/曲线',
    /zhong < 0\.28/.test(spawn) && /zhong < 0\.68/.test(spawn)
    && /\(30 \+ Math\.random\(\) \* 45\)/.test(spawn) && /\(45 \+ Math\.random\(\) \* 55\)/.test(spawn),
    spawn.slice(0, 400));
  jian('从轨道最左外侧进、最右外侧出', /const x0 = -size - 60/.test(spawn) && /const x1 = W \+ 60/.test(spawn));
  jian('打开时三只均匀分布在轨道里', /spawnQuitHorse\(track, gen, 0\.2\)/.test(auth)
    && /spawnQuitHorse\(track, gen, 0\.45\)/.test(auth) && /spawnQuitHorse\(track, gen, 0\.7\)/.test(auth));
}

// ── 2. 助记拼音 / 颜色 ───────────────────────────────────────────────────
{
  const friendly = auth.match(/pinyinFriendly:\s*'([^']*)'/g) || [];
  jian('10 个语言包都有助记拼音标签', friendly.length >= 10, friendly.length);
  jian('中文标签文本为助记拼音', /pinyinFriendly:\s*'助记拼音'/.test(auth) && /pinyinFriendly:\s*'助記拼音'/.test(auth));
  jian('不再出现旧的中文友好型/Chinese-friendly 标签',
    !/pinyinFriendly:\s*'[^']*(中文友好|中文友善|Chinese-friendly|中国語向け|중국어 친화)[^']*'/.test(auth));
  const markup = fn(auth, 'mnemonicMarkup');
  jian('未勾选拼音时用 .warmyAuthWordEn 显示英文 BIP-39 词', /warmyAuthWordEn/.test(markup) && /it\.en/.test(markup));
  jian('勾选拼音时不再重复英文行（中文/拼音辅助）',
    /useFriendly[\s\S]{0,900}warmyAuthWordText[\s\S]{0,400}warmyAuthWordPinyin[\s\S]{0,200}:\s*`<span class="warmyAuthWordEn"/.test(markup));
  jian('第 97 轮：拼音本体取主题色，序号/中文取低调灰',
    /\.warmyAuthWordEn\s*\{[^}]*color:\s*var\(--accent\)/.test(css)
    && /\.warmyAuthWordFriendly \.warmyAuthWordPinyin\s*\{[^}]*color:\s*var\(--accent\)/.test(css)
    && /\.warmyAuthWordIndex\s*\{[^}]*color:\s*#8f8a82/.test(css)
    && /\.warmyAuthWordText\s*\{[^}]*color:\s*#8a8680/.test(css)
    && /\.warmyAuthWordPinyin\s*\{[^}]*color:\s*#9a948c/.test(css));
}

// ── 3. 助记词屏防护 ─────────────────────────────────────────────────────
{
  jian('主进程提供系统级截屏保护 IPC（setContentProtection）',
    /warmy:authScreenProtect/.test(main) && /win\.setContentProtection\(!!on\)/.test(main) && /isContentProtected/.test(main));
  jian('preload 暴露 authScreenProtect', /authScreenProtect:\s*\(on\)\s*=>\s*ipcRenderer\.invoke\('warmy:authScreenProtect'/.test(preload));
  jian('助记词/PIN/恢复/查看页会请求截屏保护',
    /\[('mnemonic-register', 'mnemonic-reminder', 'recover', 'viewer', 'login', 'pin-setup')\]/.test(auth)
    && /authScreenProtect\?\.\(minGan\)/.test(auth));
  jian('窗口失焦/隐藏时把助记词藏起来，回来需手动点显示',
    /window\.addEventListener\('blur', hideMnemonicOnBlur\)/.test(auth)
    && /visibilitychange/.test(auth)
    && /warmyAuthMnemonicHidden/.test(auth) && /mnemonic-reveal/.test(auth) && /viewer-reveal/.test(auth));
  const hidden = auth.match(/mnemonicHidden:\s*'[^']*'/g) || [];
  jian('10 个语言包都有“已隐藏”提示', hidden.length >= 10, hidden.length);
}

// ── 4. 聊天滚动与操作记录时序 ───────────────────────────────────────────
{
  jian('程序滚动有目标位置记录 + 用户滚动清空',
    /let chatZiGunTop = null/.test(app) && /chatZiGunTop = null/.test(app) && /sheZhiChatGunDong/.test(app));
  jian('scroll 事件同步识别用户接管（第 97 轮：位置对不上程序目标即判用户，不再只靠 180ms 时间窗）',
    /heZi\.addEventListener\('scroll'[\s\S]{0,1200}Math\.abs\(topNow - muBiao\) > 2[\s\S]{0,400}markUserScrolled\(\)/.test(app)
    && /let chatRebuilding = false/.test(app)
    && /if \(chatRebuilding\) return/.test(app));
  jian('流式/行动重排/整块重画都在用户接管时恢复原位置',
    /baoHuYongHuGunDong/.test(app) || (/const baoHuTop = topAlignSuppress\.has\(kLiu\)/.test(app) && /const baoHuTop = topAlignSuppress\.has\(sid\)/.test(app))
    && /const prevScrollTop = sameChatDom \? heZi\.scrollTop : null/.test(app));
  jian('单段思考也按 .siKaoDuanKuai 带 data-ts 渲染',
    /siKaoDuanXian\.length\s*\?/.test(app) && !/siKaoDuanXian\.length >= 2/.test(app)
    && /<pre class="siKaoDuanKuai" data-ts="0">/.test(app));
  jian('行动行按 ts 与思考段混排', /hunPai\.sort\(\(a, b\) => \(Number\(a\.dataset\.ts\)/.test(app));
}

// ── 5. 受保护命令扫描：当前工作区不能被误伤 ─────────────────────────────
{
  const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/protected-paths.js')).href);
  const base = path.join(process.env.APPDATA || os.homedir(), '@warmy', 'app-shell', 'workspace', 's1');
  const other = path.join(path.dirname(base), 's2');
  const ok1 = mod.protectedCommandReason(`powershell -NoProfile -File "${path.join(base, 'tmp.ps1')}"`, base, base);
  const bad1 = mod.protectedCommandReason(`type "${path.join(other, 'x.txt')}"`, base, base);
  jian('当前会话工作区里的脚本命令不再被误判为禁止区', ok1 === null, ok1);
  jian('其他会话工作区的路径仍被拒绝', /其他会话的工作区/.test(String(bad1)), bad1);
  jian('粗判据（appdata+workspace 就拒绝）已删除', !/appdata.*workspace.*禁止区域/i.test(protectedSrc));
}

// ── 6. 短记忆新口径 ─────────────────────────────────────────────────────
{
  jian('知识事件记录每次使用时间（useLog，最多 64 条）', /useLog\?: number\[\]/.test(kb) && /slice\(-64\)/.test(kb));
  jian('压缩短记忆不再写知识库 overflow',
    !/biaoTi:\s*'短记忆溢出'/.test(main) && /删除只删短记忆副本/.test(main));
  jian('会话时间线窗口：1000 活跃日 / 2000 天上限',
    /DUAN_JIYI_CHUANG_RI = 1000/.test(main) && /DUAN_JIYI_ZUI_CHANG_RI = 2000/.test(main)
    && /huiHuaShiJianChuang/.test(main) && /activeDays/.test(main));
  jian('时间衰减排序（180 天半衰期）替代简单次数排序',
    /DUAN_JIYI_BAN_SHUAI_RI = 180/.test(main) && /Math\.pow\(0\.5, day \/ DUAN_JIYI_BAN_SHUAI_RI\)/.test(main)
    && /score: duanJiYiShiYongFen/.test(main));
  jian('共享 session 层最多占五分之三', /sharedCount \+ 1\) \* 5 > \(totalCount \+ 1\) \* 3/.test(main));
  jian('本会话要点去重（读最新归档摘要 bullets/decisions/todos/risks）',
    /duBenHuiHuaYaoDian/.test(main) && /structured\?\.bullets/.test(main) && /duanJiYiYuYaoDianChongFu/.test(main));
  jian('即时“记住”按内容敏感度选层（kbWritable），不再按会话类型',
    /const ceng = kbWritable\(sid, undefined, biaoTi \+ '\\n' \+ wen\)/.test(main) && !/function jiShiCeng/.test(main));
  jian('即时“记住”覆盖生气/重复抱怨/反问语义',
    /不记得|忘了|又忘|怎么又|为什么还是|每次都要|你是不是/.test(main));
  jian('被守卫拦下的失败也记踩坑（不再排除权限/禁止路径）',
    !/权限\|授权\|拒绝\|未授权/.test(between(main, 'function jiShiJiZhuCaiKeng', 'function yaoQiuLu'))
    && /jiShiXieRu\(String\(sessionId\), 'pitfall'/.test(main));
}

console.log(`\nverify-r96-ui: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
