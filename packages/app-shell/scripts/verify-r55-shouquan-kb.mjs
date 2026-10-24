/**
 * verify-r55-shouquan-kb.mjs（fast 档）—— 第 55 轮：授权档定稿 + 知识库条目操作 + token 专属校准随模型消亡。
 *
 * 授权档（用户定稿）：
 *  · 完全：整台设备开放，没有要问的；
 *  · 常规：只能在工作区内读/写/删；命令必须同时满足「在工作区」+「首词白名单」+「静态风险 low」才免问；
 *  · 严格：只能工作区文件操作；任何命令/脚本/工具都要问。
 * 这里用真值表钉住"命令碰了工作区外的路径就不算常规授权"——白名单只说明程序是谁，不说明它碰了哪里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const AT = await import(U('packages/app-shell/dist/agent-tools.js'));
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 140) : '')); } };
const BASE = path.resolve('C:/work/proj');
const pan = (dang, ask, cmd) => AT.panDuanMingLingShouQuan(dang, ask, cmd, BASE);

// ── 1. 三档真值表 ────────────────────────────────────────────────
jian('完全授权：任何命令都直接放行（没有需要问的）',
  pan('full', false, 'rm -rf /').allow === true && pan('full', false, 'cat /etc/passwd').allow === true);
jian('完全授权：高风险 skill 也不再问（用户定稿）',
  AT.panDuanShouQuan('full', false, 'skill', { ok: false, risk: 'high', reasons: ['x'], autoOk: false, summary: 'x' }).allow === true);
jian('严格授权：在工作区里跑 ls 也要问（任何命令都要确认）',
  pan('strict', true, 'ls').needAsk === true && pan('strict', true, 'ls').allow === false);
jian('严格授权 + 未勾允许提权 ⇒ 直接拒绝（不问）',
  pan('strict', false, 'ls').needAsk === false && pan('strict', false, 'ls').allow === false);
jian('常规授权：工作区内的只读命令直接放行',
  pan('normal', false, 'ls').allow === true && pan('normal', false, 'cat ./a.txt').allow === true);
jian('常规授权：**读取工作区外**的路径不放行（首词在白名单也不行）',
  pan('normal', true, 'cat /etc/passwd').allow === false && /工作区/.test(pan('normal', true, 'cat /etc/passwd').why));
jian('常规授权：盘符绝对路径在工作区外 ⇒ 不放行',
  pan('normal', true, 'type C:\\Windows\\win.ini').allow === false);
jian('常规授权：家目录引用 ⇒ 不放行', pan('normal', true, 'cat ~/.ssh/id_rsa').allow === false);
jian('常规授权：相对路径 ../ 上跳 ⇒ 不放行', pan('normal', true, 'cat ../secret.txt').allow === false);
jian('常规授权：UNC 网络共享 ⇒ 不放行',
  AT.mingLingZaiGongZuoQu('dir \\\\server\\share', BASE).ok === false);
jian('常规授权：不在白名单的命令 ⇒ 要问',
  pan('normal', true, 'ffmpeg -i a.mp4 b.mp4').allow === false && pan('normal', true, 'ffmpeg -i a.mp4 b.mp4').needAsk === true);
jian('常规授权：白名单但静态风险不 low（git push）⇒ 要问',
  pan('normal', true, 'git push').allow === false && pan('normal', true, 'git push').needAsk === true);
jian('常规授权 + 未勾允许提权 ⇒ 越界/未知命令直接拒（不问）',
  pan('normal', false, 'ffmpeg -i a.mp4 b.mp4').needAsk === false);
jian('工作区内的绝对路径允许（正例，防止判据过严）',
  AT.mingLingZaiGongZuoQu('cat ' + path.join(BASE, 'a.txt'), BASE).ok === true);
jian('主进程的 run_shell 用的是这条三合一判据（不是旧的只看风险）',
  /panDuanMingLingShouQuan\(dang, yaoWen2, cmd, baseH\)/.test(MAIN));

// ── 2. 知识库条目操作（第 55 轮项 1）────────────────────────────
jian('合并：至少 2 条、上限 20、只合并同层可见条目（否则拒绝）',
  /ids\.length < 2/.test(MAIN) && /ids\.length > 20/.test(MAIN) && /cengYouShiJian\(sid, ids\[0\]!\)/.test(MAIN));
jian('合并：其余条目取代不删除（可审计），新条目带 quDaiIds',
  /for \(const id of quDai\) zhao\.kb\.supersedeEvent\(id\)/.test(MAIN) && /quDaiIds: \[\.\.\.\(zuiXin\.quDaiIds \|\| \[\]\), \.\.\.quDai\]/.test(MAIN));
jian('重构：原条目取代不删除，新描述进待整理区（不是当场写回）',
  /kb\.rebuild-queued/.test(MAIN) && /items\.push\(\{ id: 'dz-'/.test(MAIN));
jian('待整理区：tmp+rename 落盘、条数封顶、坏了按空表',
  /const tmp = p \+ '\.tmp';/.test(MAIN) && /slice\(0, 200\)/.test(MAIN) && /catch \{ return \[\]; \}/.test(MAIN));
jian('归档开始时把待整理区写回（用户重写稿来源标 user:rebuild）',
  /chouGanDaiZhengLi\(sid\)/.test(MAIN) && /laiYuan: 'user:rebuild'/.test(MAIN));
jian('界面：勾选框 + 重构/合并按钮 + 二次确认 + 待整理内容区',
  /kbXuGou/.test(APP) && /data-kb-rebuild/.test(APP) && /data-kb-merge/.test(APP)
  && /kb\.rebuildConfirm2/.test(APP) && /kb\.mergeConfirm2/.test(APP) && /kb\.pendingTitle/.test(APP));
jian('界面勾选与主进程 IPC 对得上（kbMerge / kbRebuild / kbPending*）',
  /kbMerge\?\.\(\{ sessionId: sid, ids: \[\.\.\.kbXuan\] \}\)/.test(APP) && /kbRebuild\?\.\(\{ sessionId: sid, id, text/.test(APP)
  && /kbPendingLieBiao/.test(APP) && /kbPendingShanChu/.test(APP));

// ── 3. token 专属校准随模型消亡（第 55 轮项 3）──────────────────
jian('模型删除 ⇒ 专属校准被清掉，@avg 通用条目保留',
  /function qingLiTokenXiaoZhun/.test(MAIN) && /if \(k\.startsWith\('@avg\/'\)\) continue;/.test(MAIN) && /TOKEN_ZHU\.delete\(k\)/.test(MAIN));
jian('清理只在拿得到模型列表时做（不许把还在用的模型校准误删）',
  /if \(!lie\.length\) return;/.test(MAIN));
jian('启动与设置保存都会触发清理（模型被删后不用等重启）',
  (MAIN.match(/qingLiTokenXiaoZhun\(\)/g) || []).length >= 2 && /token\.calibration-pruned/.test(MAIN));

console.log(`==== verify-r55-shouquan-kb: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
