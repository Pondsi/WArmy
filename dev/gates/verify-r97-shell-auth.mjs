#!/usr/bin/env node
/**
 * verify-r97-shell-auth —— 「本会话允许工作区内命令」真值表 + 接线锚点（不启 Electron）。
 *
 * 口径：默认关。打开后只放宽「常规授权 + 命令在工作区内 + 风险非高 + 非明显破坏性」；
 * 严格授权 / 工作区外 / rm -rf、del /f、format、shutdown 等仍逐次询问。
 * 这是减少授权卡的可选开关，不是沙箱；脚本内容仍可能越界。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const dist = path.join(PKG, 'dist/agent-tools.js');
if (!fs.existsSync(dist)) { console.error('缺少构建产物：' + dist); process.exit(2); }
const M = await import(pathToFileURL(dist).href);
const base = process.cwd();
const pan = (dang, ask, cmd, on) => M.panDuanMingLingShouQuan(dang, ask, cmd, base, on);

let pass = 0, fail = 0;
const failures = [];
const jian = (m, c, d) => {
  if (c) { pass++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + JSON.stringify(d))); }
  else { fail++; failures.push(m); console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + JSON.stringify(d))); }
};

console.log('[1] 常规白名单 vs 非白名单 vs 严格授权');
{
  let a = pan('normal', true, 'tar -czf out.tgz .');
  jian('常规授权：工作区内白名单低风险命令直接放行（tar）', a.allow && !a.needAsk, { allow: a.allow, ask: a.needAsk, risk: a.jianCe.risk });
  let b = pan('normal', true, 'ffmpeg -i a.mp4 b.mp4');
  jian('常规授权：工作区内非白名单命令仍需询问', !b.allow && b.needAsk, { allow: b.allow, ask: b.needAsk, risk: b.jianCe.risk });
  let c = pan('normal', true, 'powershell -NoProfile -Command Get-Date');
  jian('常规授权：工作区内低风险 powershell 直接放行', c.allow && !c.needAsk, { allow: c.allow, ask: c.needAsk, risk: c.jianCe.risk });
  let s = pan('strict', true, 'tar -czf out.tgz .');
  jian('严格授权：即使白名单也逐次询问', !s.allow && s.needAsk, { allow: s.allow, ask: s.needAsk });
  let f = pan('full', true, 'tar -czf out.tgz .', false);
  jian('完全授权：不受开关影响，直接放行', f.allow && !f.needAsk, { allow: f.allow, ask: f.needAsk });
}

console.log('[2] 破坏性/越界命令永远不自动放行');
{
  for (const cmd of ['rm -rf ./tmp', 'rm -fr ./tmp', 'del /f out.txt', 'remove-item -Recurse .', 'format c:', 'shutdown /s', 'reg delete HKCU\\X /f', 'diskpart']) {
    const r = pan('normal', true, cmd, true);
    jian('打开后仍询问：' + cmd, !r.allow && r.needAsk, { allow: r.allow, ask: r.needAsk, risk: r.jianCe.risk });
  }
  const out = pan('normal', true, 'tar -czf ../x.tgz .', true);
  jian('工作区外（.. 上跳）仍询问', !out.allow && out.needAsk && out.zaiGongZuoQu === false, { allow: out.allow, ask: out.needAsk, zai: out.zaiGongZuoQu });
  const abs = pan('normal', true, 'tar -czf C:\\Windows\\Temp\\x.tgz .', true);
  jian('工作区外绝对路径仍询问', !abs.allow && abs.needAsk, { allow: abs.allow, ask: abs.needAsk, zai: abs.zaiGongZuoQu });
}

console.log('[3] 接线锚点：设置字段 / 主进程 / preload / 授权卡');
{
  const settings = fs.readFileSync(path.join(PKG, 'src/settings-store.ts'), 'utf8');
  const main = fs.readFileSync(path.join(PKG, 'src/electron-main.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(PKG, 'src/preload.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(PKG, 'src/renderer/app.js'), 'utf8');
  jian('第 99 轮：设置字段 workspaceCmdSessions 已删除', !/workspaceCmdSessions/.test(settings));
  jian('主进程不再有 workspaceCmdAllowed / setWorkspaceCmdAllowed',
    !/function workspaceCmdSessions/.test(main) && !/function setWorkspaceCmdAllowed/.test(main)
    && /panDuanMingLingShouQuan\(dang, yaoWen2, cmd, baseH\)/.test(main));
  jian('IPC / preload 不再暴露 authWorkspaceCmd', !/warmy:authWorkspaceCmd/.test(main) && !/authWorkspaceCmd: \(p\) =>/.test(preload));
  jian('授权卡不再有工作区命令勾选项', !/shouQuanCmdHang/.test(app) && !/authWorkspaceCmd\?\./.test(app));
}

console.log(`\n==== verify-r97-shell-auth: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exitCode = fail ? 1 : 0;
