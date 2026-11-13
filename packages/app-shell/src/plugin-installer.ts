/**
 * plugin-installer —— 插件安装器（R197）：pnpm + WArmy 目录扫描 双模式。
 *
 * 主人决策：插件安装两种方式都支持。
 *  · 目录扫描：扫指定目录下一层含 package.json 的子目录视为插件候选（现有机制，简单、离线）。
 *  · pnpm 安装：把 npm 上的 cordis 插件包装进 profile（dsh 方式，生态兼容；需 pnpm 环境/corepack）。
 *
 * 安装后统一经 plugin-runtime 加载（{name,inject,Config,apply}），工具并入工具循环（Plan A）。
 * 可测性：扫描用临时目录真跑；pnpm 命令构造为纯函数；安装 spawn 无 shell。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ChaJianHouXuan { id: string; ming: string; path: string; hasCordis: boolean; version?: string; }

/** 读 package.json 判定是否 cordis 插件（有 cordis 标记，或入口导出 name+apply 的约定）。 */
function shiFouCordis(pkg: Record<string, unknown>): boolean {
  if (pkg.cordis) return true;
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : [];
  return keywords.includes('cordis') || keywords.includes('warmy-plugin');
}

/** 目录扫描：dirs 下一层含 package.json 的子目录视为插件候选（去重、上限）。 */
export function scanChaJianMuLu(dirs: string[], max = 100): ChaJianHouXuan[] {
  const out: ChaJianHouXuan[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let ems: string[] = [];
    try { ems = fs.readdirSync(dir); } catch { continue; }
    for (const e of ems.slice(0, max)) {
      const sub = path.join(dir, e);
      const pkgLu = path.join(sub, 'package.json');
      try {
        if (!fs.statSync(sub).isDirectory() || !fs.existsSync(pkgLu)) continue;
        const pkg = JSON.parse(fs.readFileSync(pkgLu, 'utf8')) as Record<string, unknown>;
        const id = String(pkg.name || e);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, ming: String(pkg.displayName || pkg.name || e), path: sub, hasCordis: shiFouCordis(pkg), version: pkg.version ? String(pkg.version) : undefined });
      } catch { /* 坏 package.json 跳过 */ }
    }
  }
  return out;
}

/** pnpm 安装命令构造（纯函数，可测）。装进 profile 目录。 */
export function pnpmInstallArgs(pkg: string, profileDir: string): string[] {
  return ['add', pkg, '--dir', profileDir];
}

export interface AnZhuangJieGuo { ok: boolean; code: number | null; stdout: string; stderr: string; error?: string; }

/** 经 pnpm 安装插件包（spawn 无 shell；pnpm 不可用如实报错）。 */
export function installViaPnpm(pkg: string, profileDir: string, pnpmBin = 'pnpm', timeoutMs = 120000): Promise<AnZhuangJieGuo> {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(profileDir, { recursive: true });
      const p = spawn(pnpmBin, pnpmInstallArgs(pkg, profileDir), { cwd: profileDir, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
      timer.unref?.();
      p.stdout?.on('data', (d) => { out += String(d); });
      p.stderr?.on('data', (d) => { err += String(d); });
      p.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout: out, stderr: err }); });
      p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, stdout: out, stderr: err, error: `pnpm 不可用（${String(e.message)}）——请启用 corepack 或安装 pnpm，或改用目录扫描` }); });
    } catch (e) { resolve({ ok: false, code: null, stdout: '', stderr: '', error: String((e as Error).message) }); }
  });
}

/** 读已装插件的 cordis 模块入口（package.json main/module）。返回入口绝对路径或 null。 */
export function chaJianRuKou(pluginDir: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')) as { main?: string; module?: string };
    const entry = pkg.module || pkg.main || 'index.js';
    const lu = path.resolve(pluginDir, entry);
    return fs.existsSync(lu) ? lu : null;
  } catch { return null; }
}