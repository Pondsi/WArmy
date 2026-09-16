/**
 * 本地账号（登录未开放时的本地会话）与设置持久化
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export interface LocalProfile {
  username: string;
  avatarDataUrl: string;
  email: string;
  passwordHash?: string;
  /** 本机唯一 ID：9 位数字，首次生成后写入配置文件 */
  deviceId?: string;
}

/**
 * 采集本机熵源（网络 / 硬件 / IP / 13 位时间戳），
 * 哈希后折算成 9 位十进制数字（100000000–999999999），几乎不会重复。
 */
function collectEntropy(): string {
  const parts: string[] = [];
  parts.push(String(Date.now()));                 // 13 位毫秒时间戳
  parts.push(`${process.platform}-${process.arch}`);
  try { parts.push(os.hostname()); } catch { /* 忽略 */ }
  try { parts.push(os.userInfo().username); } catch { /* 忽略 */ }
  try {
    const cpus = os.cpus();
    const first = cpus[0];
    if (first) parts.push(`${first.model}#${cpus.length}`);
  } catch { /* 忽略 */ }
  try { parts.push(String(os.totalmem())); } catch { /* 忽略 */ }
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets).sort()) {
      for (const a of nets[name] || []) {
        if (a.internal) continue;
        parts.push(`${name}/${a.family}/${a.mac}/${a.address}`);  // MAC + 局域网 IP
      }
    }
  } catch { /* 忽略 */ }
  return parts.join('|');
}

export function generateDeviceId(): string {
  const digest = crypto.createHash('sha256').update(collectEntropy()).digest('hex');
  const n = BigInt('0x' + digest.slice(0, 16)) % 900000000n;
  return String(n + 100000000n);   // 恒为 9 位
}

export interface SmtpAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** 授权码；本地保存，界面可用密文展示 */
  pass: string;
  /** 验证结果缓存 */
  verified?: boolean;
  lastVerifyAt?: number;
}

export interface AppSettings {
  locale: string;
  themeMode: 'light' | 'dark' | 'system';
  accent: string;
  sound: { complete: boolean; request: boolean; error: boolean };
  soundFiles: { complete: string; request: string; error: string };
  emailOnRequest: boolean;
  listWidth: number;
  panelWidth: number;
  globalSecurity: 'full' | 'normal' | 'strict';
  /** 最多 10 个 SMTP 账号 */
  smtpAccounts: SmtpAccount[];
  /** 嵌入是否使用 GPU（WebGPU）；false=WASM/CPU */
  embedUseGpu: boolean;
  /** 邮件通知：完成/请求/错误 */
  emailNotify: { complete: boolean; request: boolean; error: boolean };
}

function hash(pw: string) {
  return crypto.createHash('sha256').update(pw + 'ccarmy').digest('hex');
}

export class LocalAccountStore {
  constructor(private file: string) {}

  loadProfile(): LocalProfile {
    let p: LocalProfile;
    try {
      p = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      p = { username: '主人', avatarDataUrl: '', email: '' };
    }
    // 首次访问即生成 9 位 ID 并落盘，之后一直跟随配置文件
    if (!p.deviceId) {
      p.deviceId = generateDeviceId();
      try { this.saveProfile(p); } catch { /* 只读目录时忽略 */ }
    }
    return p;
  }

  saveProfile(p: LocalProfile): LocalProfile {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { passwordHash: _drop, ...rest } = p;
    fs.writeFileSync(this.file, JSON.stringify(rest, null, 2));
    return rest as LocalProfile;
  }

  /** 登录功能占位：本地密码校验 */
  setPassword(pw: string): void {
    const p = this.loadProfile();
    p.passwordHash = hash(pw);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(p, null, 2));
  }

  verifyPassword(pw: string): boolean {
    const p = this.loadProfile();
    if (!p.passwordHash) return false;
    return p.passwordHash === hash(pw);
  }

  loginLocal(pw: string): { ok: boolean; profile?: LocalProfile } {
    if (!this.verifyPassword(pw)) return { ok: false };
    const p = this.loadProfile();
    return { ok: true, profile: { username: p.username, avatarDataUrl: p.avatarDataUrl, email: p.email } };
  }
}

export class SettingsStore {
  constructor(private file: string) {}

  load(): AppSettings {
    try {
      return { ...defaults(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return defaults();
    }
  }

  save(s: Partial<AppSettings>): AppSettings {
    const next = { ...this.load(), ...s };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}

function defaults(): AppSettings {
  return {
    locale: 'zh-CN',
    themeMode: 'system',
    accent: '#07c160',
    sound: { complete: true, request: true, error: true },
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    listWidth: 280,
    panelWidth: 300,
    globalSecurity: 'normal',
    smtpAccounts: [],
    embedUseGpu: true,
    emailNotify: { complete: true, request: true, error: true },
  };
}

export const SMTP_MAX_ACCOUNTS = 10;
