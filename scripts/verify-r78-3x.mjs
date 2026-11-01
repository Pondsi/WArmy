/**
 * 第 78 轮核心门禁三连：任一非 0 即停止并保留日志。
 *
 * 用异步 spawn 按 exit 判完成，而不是 spawnSync 的管道 EOF：
 * 门禁若遗留 Electron 子进程，管道 EOF 会被拖住，表现为整轮无声挂死。
 * 每道门禁结束后清掉测试用 Electron 残留（只匹配 %TEMP%\warmy-* 的临时 profile）。
 */
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gates = [
  ['dev/gates/verify-r44-shejiao.mjs', '微信凭据/队列'],
  ['packages/app-shell/scripts/verify-r65-shejiao.mjs', '微信协议'],
  ['dev/gates/verify-asr-routing.mjs', 'ASR 路由'],
  ['packages/app-shell/scripts/verify-r65-mic-lifecycle.mjs', '话筒生命周期'],
  ['dev/gates/verify-r78-scroll.mjs', '滚动顶部对齐'],
  ['dev/gates/verify-r78-prompt-limits.mjs', '提示词限长'],
  ['dev/gates/verify-r67-chat-order.mjs', '思考/工具时序'],
  ['dev/gates/verify-r78-auth-tour.mjs', '首启登录/引导'],
  ['dev/gates/verify-r67-firstrun.mjs', '首启静态'],
  ['dev/gates/verify-r68-firstrun-ui.mjs', '首启界面'],
  ['dev/gates/verify-r68-auth-ui.mjs', '我的页/认证'],
  ['packages/app-shell/scripts/verify-r63-nm.mjs', 'nm 基础'],
  ['packages/app-shell/scripts/verify-zip-look.mjs', 'nm 压缩包'],
  ['dev/gates/verify-r78-nm-plugin.mjs', 'nm 插件默认'],
  ['dev/gates/verify-r79-regressions.mjs', 'R79 回归'],
  ['dev/gates/verify-r81-ui.mjs', 'R81 UI/数据'],
  ['dev/gates/verify-r81-nm.mjs', 'R81 nm'],
  ['dev/gates/verify-r82-kuanping.mjs', '宽屏/带鱼屏/全屏'],
  ['dev/gates/verify-r82-chatwin.mjs', '独立会话窗只显示三四列'],
  ['dev/gates/verify-r82-aiedit-badge.mjs', '模型改写提示词图标'],
  ['dev/gates/verify-r82-hu-chi.mjs', '知识库/提示词互斥'],
  ['dev/gates/verify-r82-chuan-shu.mjs', '会话传输/发件箱'],
  ['dev/gates/verify-r82-invite.mjs', '邀请与Ed25519锚点'],
  ['dev/gates/verify-r82-shejiao-tong.mjs', '社交连通性诊断'],
  ['dev/gates/verify-r82-r103.mjs', '#103/#109/#112/#113 接线'],
  ['dev/gates/verify-r83-quanping.mjs', 'F11 真全屏 + 4K 字号'],
  ['dev/gates/verify-r83-invite-sign.mjs', '签名邀请密码学'],
  ['dev/gates/verify-r83-join-signed.mjs', '签名加入/申请持久化'],
  ['dev/gates/verify-r83-im.mjs', 'IM 真实消息协议'],
  ['dev/gates/verify-r83-mimic-look.mjs', '受控拟态观察'],
  ['dev/gates/verify-r83-quit-confirm.mjs', '首启关闭二次确认'],
  ['dev/gates/verify-r83-shuang-li.mjs', '双实例聊天+签名加入 E2E'],
];
const ROUNDS = Math.max(1, Number(process.env.VERIFY_ROUNDS || 3));
const TIMEOUT = Number(process.env.GATE_TIMEOUT_MS || 240_000);

function qingLiCanLiu() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | Where-Object { $_.CommandLine -like '*Temp\\warmy-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ], { stdio: 'ignore', timeout: 20_000 });
  } catch { /* 清理失败不影响判定 */ }
}

function pao(rel) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [path.join(root, rel)], {
      cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let done = false;
    const finish = (code, timedOut = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, timedOut, out });
    };
    const timer = setTimeout(() => {
      try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
      setTimeout(() => finish(null, true), 300);
    }, TIMEOUT);
    cp.stdout.on('data', (d) => { out += d; });
    cp.stderr.on('data', (d) => { out += d; });
    cp.on('error', (e) => { out += '\nspawn error: ' + e.message; finish(null); });
    // 只看 exit，不等管道 EOF：祖先遗留的 Electron 可能一直握着 stdout
    cp.on('exit', (code) => { setTimeout(() => finish(code), 100); });
  });
}

let failed = 0;
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n===== R78 ROUND ${round}/${ROUNDS} =====`);
  for (const [rel, name] of gates) {
    const r = await pao(rel);
    const last = r.timedOut
      ? `GATE TIMEOUT ${Math.round(TIMEOUT / 1000)}s`
      : String(r.out || '').trim().split(/\r?\n/).slice(-1)[0];
    const ok = !r.timedOut && r.code === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${last}`);
    qingLiCanLiu();
    if (!ok) { failed++; console.log(String(r.out || '').slice(-1200)); break; }
  }
  if (failed) break;
}
console.log(failed ? `\nR78 3x FAILED at round ${failed}` : '\nR78 3x PASSED');
process.exitCode = failed ? 1 : 0;
