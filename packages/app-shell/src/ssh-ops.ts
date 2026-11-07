/**
 * R136：SSH 远程通道 —— 对接**没装 WArmy 的设备**的 SSH（对方开 sshd 即可）。
 *
 * 口径（用户拍板）：
 *  · 「设备上使用什么实现网络通道是用户的事情，我们的 WArmy 负责对接对面设备的 ssh」
 *    —— 本模块**不内置**任何组网（Tailscale/Headscale/WireGuard 均不依赖）；
 *      用户用局域网/自己的 VPN/端口转发/自建组网让 host:port 可达，我们只做 SSH 客户端。
 *  · 三平台：Windows 10+ 自带 ssh.exe/scp.exe，macOS/Linux 自带 ssh/scp。
 *  · 认证：优先 Ed25519 密钥（私钥经 safeStorage 加密落盘，执行时写 0600 临时文件）；
 *      口令认证走 plink（PuTTY，若已安装）——OpenSSH 客户端无命令行口令通道，如实报错不冒充。
 *  · 门禁：目标必须在注册表（设备白名单）+ 每次执行弹授权卡 + 全程审计（不记私钥/口令）。
 *  · 主机指纹：首次连接 accept-new 写入本模块专用 known_hosts（防后续中间人冒充）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function anQuanCunChuOf(): { encryptString(s: string): Buffer; decryptString(b: Buffer): string; isEncryptionAvailable(): boolean } | null {
  try {
    const electron = require('electron') as { safeStorage?: { encryptString(s: string): Buffer; decryptString(b: Buffer): string; isEncryptionAvailable(): boolean } } | undefined;
    const c = electron?.safeStorage;
    if (!c || typeof c.encryptString !== 'function' || typeof c.decryptString !== 'function') return null;
    if (typeof c.isEncryptionAvailable === 'function' && !c.isEncryptionAvailable()) return null;
    return c;
  } catch {
    return null;
  }
}

export interface SshMubiao {
  /** 稳定 id（sha1(host:port:user) 前 12 位） */
  id: string;
  /** 显示名（用户起的） */
  ming: string;
  host: string;
  port: number;
  user: string;
  /** key = Ed25519 私钥；password = 口令（走 plink） */
  renZheng: 'key' | 'password';
  /** 私钥/口令在密文仓里的键名（不落明文） */
  pingZhengJian?: string;
  createdAt: number;
}

interface MimiTiaoMu { v: 2; protector: 'os' | 'plain'; data: string }

export class SshCaoZuo {
  private readonly dir: string;
  private readonly muBiaoFile: string;
  private readonly mimiFile: string;
  private readonly knownHosts: string;

  constructor(userData: string) {
    this.dir = path.join(userData, 'ssh');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.muBiaoFile = path.join(this.dir, 'targets.json');
    this.mimiFile = path.join(this.dir, 'secrets.enc.json');
    this.knownHosts = path.join(this.dir, 'known_hosts');
  }

  // ── 目标注册表（设备白名单） ──────────────────────────────────────────

  lieBiao(): SshMubiao[] {
    try {
      const j = JSON.parse(fs.readFileSync(this.muBiaoFile, 'utf8')) as { targets?: SshMubiao[] };
      return Array.isArray(j.targets) ? j.targets : [];
    } catch {
      return [];
    }
  }

  private cunMuBiao(list: SshMubiao[]) {
    fs.writeFileSync(this.muBiaoFile, JSON.stringify({ targets: list }, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  /** 登记/更新目标。pingZheng（私钥全文或口令）经 safeStorage 加密后入密文仓，明文不落盘。 */
  baoCunMuBiao(input: { ming: string; host: string; port?: number | string; user: string; renZheng?: 'key' | 'password'; pingZheng?: string }): { ok: boolean; error?: string; id?: string } {
    const ming = String(input.ming || '').trim().slice(0, 60);
    const host = String(input.host || '').trim();
    const user = String(input.user || '').trim();
    const port = Math.max(1, Math.min(65535, Number(input.port) || 22));
    const renZheng = input.renZheng === 'password' ? 'password' : 'key';
    if (!host || !user) return { ok: false, error: 'host 与 user 必填' };
    if (/[\s;|&`$<>]/.test(host + user)) return { ok: false, error: 'host/user 含非法字符' };
    const id = crypto.createHash('sha256').update(`${host}:${port}:${user}`).digest('hex').slice(0, 12);
    const list = this.lieBiao().filter((t) => t.id !== id);
    const t: SshMubiao = { id, ming: ming || `${user}@${host}`, host, port, user, renZheng, createdAt: Date.now() };
    if (input.pingZheng && String(input.pingZheng).trim()) {
      if (!this.cunMimi(id, String(input.pingZheng))) return { ok: false, error: 'no-safe-storage' };
      t.pingZhengJian = id;
    }
    list.push(t);
    this.cunMuBiao(list);
    return { ok: true, id };
  }

  shanChuMuBiao(id: string): boolean {
    const before = this.lieBiao();
    const after = before.filter((t) => t.id !== id);
    if (after.length === before.length) return false;
    this.cunMuBiao(after);
    this.shanMimi(id);
    return true;
  }

  // ── 凭证密文仓（safeStorage） ─────────────────────────────────────────

  private cunMimi(key: string, value: string): boolean {
    const c = anQuanCunChuOf();
    if (!c) return false;
    const entry: MimiTiaoMu = { v: 2, protector: 'os', data: c.encryptString(value).toString('base64') };
    const all = this.duMimiRaw();
    all[key] = entry;
    fs.writeFileSync(this.mimiFile, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
    return true;
  }

  private duMimi(key: string): string | null {
    const raw = this.duMimiRaw()[key];
    if (!raw) return null;
    try {
      if (raw.protector === 'os') {
        const c = anQuanCunChuOf();
        return c ? c.decryptString(Buffer.from(raw.data, 'base64')) : null;
      }
      return Buffer.from(raw.data, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  private duMimiRaw(): Record<string, MimiTiaoMu> {
    try {
      return JSON.parse(fs.readFileSync(this.mimiFile, 'utf8')) as Record<string, MimiTiaoMu>;
    } catch {
      return {};
    }
  }

  private shanMimi(key: string) {
    const all = this.duMimiRaw();
    if (!(key in all)) return;
    delete all[key];
    fs.writeFileSync(this.mimiFile, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
  }

  // ── 客户端定位 ─────────────────────────────────────────────────────────

  /** 系统 ssh.exe / ssh 绝对路径；找不到返回 null（如实报错，不静默） */
  zhaoSsh(): string | null {
    const zha = (bin: string): string | null => {
      if (process.platform === 'win32') {
        const p = path.join(String(process.env.SystemRoot || 'C:\\Windows'), 'System32', 'OpenSSH', bin + '.exe');
        if (fs.existsSync(p)) return p;
      }
      for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
        const p = path.join(dir, process.platform === 'win32' ? bin + '.exe' : bin);
        try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
      }
      return null;
    };
    return zha('ssh');
  }

  zhaoScp(): string | null {
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(dir, process.platform === 'win32' ? 'scp.exe' : 'scp');
      try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
    }
    return null;
  }

  /** plink（PuTTY）——口令认证唯一可行的命令行通道 */
  private zhaoPlink(): string | null {
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(dir, process.platform === 'win32' ? 'plink.exe' : 'plink');
      try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
    }
    return null;
  }

  // ── 执行 ───────────────────────────────────────────────────────────────

  /**
   * 在已登记目标上执行远程命令。
   * 返回：{ ok, code, stdout, stderr, ms, fangShi }
   * 授权卡由调用方（工具派发层）负责弹；本层只执行 + 不记凭证。
   */
  async yuanChengMingLing(id: string, cmd: string, opts: { timeoutMs?: number; maxOut?: number } = {}):
    Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; ms: number; fangShi: string }> {
    const t = this.lieBiao().find((x) => x.id === id);
    if (!t) return { ok: false, code: null, stdout: '', stderr: `目标不存在：${id}`, ms: 0, fangShi: 'none' };
    const command = String(cmd || '').trim();
    if (!command) return { ok: false, code: null, stdout: '', stderr: '请给出远程命令', ms: 0, fangShi: 'none' };
    const timeoutMs = Math.max(3000, Math.min(Number(opts.timeoutMs) || 60000, 10 * 60 * 1000));
    const maxOut = Math.max(200, Math.min(Number(opts.maxOut) || 8000, 40000));

    let kij: string | null = null;
    let fangShi = '';
    let bin = '';
    let args: string[] = [];

    if (t.renZheng === 'key') {
      const ssh = this.zhaoSsh();
      if (!ssh) return { ok: false, code: null, stdout: '', stderr: '本机找不到 ssh 客户端（Windows 10+ 自带 OpenSSH；或安装后重试）', ms: 0, fangShi: 'none' };
      const priv = t.pingZhengJian ? this.duMimi(t.pingZhengJian) : null;
      if (!priv) return { ok: false, code: null, stdout: '', stderr: '该目标未存私钥（登记时需提供 Ed25519 私钥）', ms: 0, fangShi: 'none' };
      // 私钥写 0600 临时文件供 ssh -i 使用，用完即删
      kij = path.join(os.tmpdir(), `warmy-ssh-${crypto.randomBytes(6).toString('hex')}`);
      fs.writeFileSync(kij, priv.endsWith('\n') ? priv : priv + '\n', { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(kij, 0o600); } catch { /* Windows 无 POSIX 权限时忽略 */ }
      bin = ssh;
      fangShi = 'ssh(key)';
      args = [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${this.knownHosts}`,
        '-o', 'ConnectTimeout=10',
        '-p', String(t.port),
        '-i', kij,
        `${t.user}@${t.host}`,
        command,
      ];
    } else {
      const plink = this.zhaoPlink();
      if (!plink) return {
        ok: false, code: null, stdout: '',
        stderr: '口令认证需要 PuTTY 的 plink（OpenSSH 客户端不支持命令行口令）。请改用 Ed25519 密钥认证，或安装 PuTTY 后重试。',
        ms: 0, fangShi: 'none',
      };
      const pw = t.pingZhengJian ? this.duMimi(t.pingZhengJian) : null;
      if (!pw) return { ok: false, code: null, stdout: '', stderr: '该目标未存口令', ms: 0, fangShi: 'none' };
      bin = plink;
      fangShi = 'plink(password)';
      args = [
        '-batch',
        '-P', String(t.port),
        '-pw', pw,
        `${t.user}@${t.host}`,
        command,
      ];
    }

    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(bin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH || '',
          SystemRoot: process.env.SystemRoot || '',
          TEMP: process.env.TEMP || '',
          TMP: process.env.TMP || '',
          USERPROFILE: process.env.USERPROFILE || '',
        },
      });
      let out = '';
      let err = '';
      const can = (s: string, lim: number) => (s.length > lim ? s.slice(0, lim) + '…(截断)' : s);
      child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); if (out.length > maxOut * 2) out = out.slice(0, maxOut * 2); });
      child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); if (err.length > maxOut) err = err.slice(0, maxOut); });
      const to = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, timeoutMs);
      child.on('error', (e) => {
        clearTimeout(to);
        if (kij) { try { fs.rmSync(kij, { force: true }); } catch { /* noop */ } }
        resolve({ ok: false, code: null, stdout: '', stderr: String(e.message || e), ms: Date.now() - t0, fangShi });
      });
      child.on('close', (code) => {
        clearTimeout(to);
        if (kij) { try { fs.rmSync(kij, { force: true }); } catch { /* noop */ } }
        resolve({ ok: code === 0, code, stdout: can(out.trim(), maxOut), stderr: can(err.trim(), Math.min(maxOut, 2000)), ms: Date.now() - t0, fangShi });
      });
    });
  }

  /**
   * scp 传文件（get：远端→本机；put：本机→远端）。同样只对已登记目标生效。
   */
  async chuanWenJian(id: string, fangXiang: 'get' | 'put', yuan: string, muBiao: string, opts: { timeoutMs?: number } = {}):
    Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; ms: number }> {
    const t = this.lieBiao().find((x) => x.id === id);
    if (!t) return { ok: false, code: null, stdout: '', stderr: `目标不存在：${id}`, ms: 0 };
    if (t.renZheng !== 'key') return { ok: false, code: null, stdout: '', stderr: '文件传输仅支持密钥认证目标', ms: 0 };
    const scp = this.zhaoScp();
    if (!scp) return { ok: false, code: null, stdout: '', stderr: '本机找不到 scp', ms: 0 };
    const priv = t.pingZhengJian ? this.duMimi(t.pingZhengJian) : null;
    if (!priv) return { ok: false, code: null, stdout: '', stderr: '该目标未存私钥', ms: 0 };
    const kij = path.join(os.tmpdir(), `warmy-ssh-${crypto.randomBytes(6).toString('hex')}`);
    fs.writeFileSync(kij, priv.endsWith('\n') ? priv : priv + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(kij, 0o600); } catch { /* noop */ }
    const timeoutMs = Math.max(3000, Math.min(Number(opts.timeoutMs) || 120000, 15 * 60 * 1000));
    const src = fangXiang === 'get' ? `${t.user}@${t.host}:${yuan}` : yuan;
    const dst = fangXiang === 'get' ? muBiao : `${t.user}@${t.host}:${muBiao}`;
    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(scp, [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${this.knownHosts}`,
        '-P', String(t.port),
        '-i', kij,
        src, dst,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
      child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); if (err.length > 2000) err = err.slice(0, 2000); });
      const to = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, timeoutMs);
      const qingLi = () => { try { fs.rmSync(kij, { force: true }); } catch { /* noop */ } };
      child.on('error', (e) => { clearTimeout(to); qingLi(); resolve({ ok: false, code: null, stdout: '', stderr: String(e.message || e), ms: Date.now() - t0 }); });
      child.on('close', (code) => {
        clearTimeout(to);
        qingLi();
        resolve({ ok: code === 0, code, stdout: out.trim().slice(0, 2000), stderr: err.trim().slice(0, 2000), ms: Date.now() - t0 });
      });
    });
  }

  /** 连通性自检：ssh 执行 `echo warmy-ok`（用于「测试连接」按钮） */
  async ceShi(id: string): Promise<{ ok: boolean; error?: string; ms?: number }> {
    const r = await this.yuanChengMingLing(id, 'echo warmy-ok', { timeoutMs: 15000, maxOut: 500 });
    if (!r.ok) return { ok: false, error: r.stderr || `exit=${r.code}`, ms: r.ms };
    return { ok: /warmy-ok/.test(r.stdout), error: r.ok ? undefined : r.stderr, ms: r.ms };
  }
}
