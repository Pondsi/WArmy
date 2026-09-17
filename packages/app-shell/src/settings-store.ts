/**
 * 本地账号（登录未开放时的本地会话）与设置持久化
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { DEFAULT_CONTEXT_BUDGET_CHARS } from './context-renderer.js';

export interface LocalProfile {
  username: string;
  avatarDataUrl: string;
  email: string;
  passwordHash?: string;
  /** 本机唯一 ID：9 位数字，首次生成后写入配置文件 */
  deviceId?: string;
  /** deviceId 的 HMAC 签名，用于检测配置文件被手改 */
  deviceIdSig?: string;
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

/** 仅接受「9 位且首位非 0」的形态 */
export function isValidDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[1-9][0-9]{8}$/.test(v);
}

/** 设备 ID 的 HMAC 签名：ID 被手改一位，签名就对不上 */
function signDeviceId(id: string): string {
  return crypto.createHmac('sha256', 'ccarmy.device-id.v1').update(id).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  /**
   * 上下文有界渲染器的视图预算（字符）—— ADR 002 / 不变量 #2。
   * 注入给模型的上下文恒 ≤ 该值，与日志总长解耦（默认见 DEFAULT_CONTEXT_BUDGET_CHARS）。
   * 下限 200：更小的预算连可执行指针都放不下（渲染器仍不抛错，只是退化为截断指针）。
   */
  contextBudgetChars: number;
  /**
   * 工具调用循环的最大轮数 —— ADR 002 §9.4 待办 2。
   * 模型要工具 → 宿主执行 recall/retrieve → 结果回给模型 → 再问，最多这么多轮。
   * **0 = 不暴露工具**（退回普通单轮对话，即"现状"）。
   */
  contextToolMaxRounds: number;
  /** 单条工具结果上限（字符，默认 4000） */
  contextToolResultChars: number;
  /** 一轮对话内工具结果的**总**预算（字符，默认 12000） */
  contextToolTotalChars: number;
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
    // 首次访问即生成 9 位 ID 并落盘；若 ID 或签名被改动/缺失，则重新生成
    if (!this.verifyIdFields(p)) {
      p.deviceId = generateDeviceId();
      p.deviceIdSig = signDeviceId(p.deviceId);
      try { this.saveProfile(p); } catch { /* 只读目录时忽略 */ }
    }
    return p;
  }

  /** 校验 ID 形态与 HMAC 签名；不触碰文件、不重新生成 */
  verifyIdFields(p: Partial<LocalProfile>): boolean {
    if (!isValidDeviceId(p.deviceId)) return false;
    if (typeof p.deviceIdSig !== 'string' || !p.deviceIdSig) return false;
    return safeEqual(signDeviceId(p.deviceId), p.deviceIdSig);
  }

  /** 供界面展示：当前 ID 与校验状态（只读，不修复） */
  idStatus(): { id: string; valid: boolean } {
    let raw: Partial<LocalProfile>;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { id: '', valid: false };
    }
    return { id: raw.deviceId || '', valid: this.verifyIdFields(raw) };
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
    /**
     * 默认 4000 字符（= context-renderer 的 DEFAULT_CONTEXT_BUDGET_CHARS，单一来源）。
     * 理由（ADR §8 已声明"预算用字符近似 token，后续按模型 tokenizer 校正"）：
     *  1) 与写入侧 CCR 的单条预算同量级（ccr-compressor DEFAULT_BUDGET = 4000），
     *     两侧串联后不放大：单条先被压到 4000，整段视图再被限在 4000；
     *  2) 4000 字符按常见 BPE 经验值折算约 1.5k~2.7k token（中文约 1.5 字符/token、
     *     ASCII 约 4 字符/token），而 chat-send 的 maxTokens = 1024：
     *     合计留在常见 8k 窗口内，并给输出留 1k token 余量；
     *  3) 明显大于 keepHead(1) + keepTail(8) 的近期原文（约 9 条），
     *     保证"指针 + 要点"与近期原文能同时放进同一个视图（否则视图会退化到只剩头尾）。
     * 本机未提供 tokenizer 词表，故此处是折算估计而非实测 token 数；换算口径可按模型替换。
     */
    contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
    /**
     * 工具调用上限（ADR 002 §9.4 待办 2）。
     * 3 轮足够"recall → retrieve → 终答"的典型链路，又是硬上限：
     * 最坏 4 次模型请求（3 轮工具 + 1 次强制收敛），每次注入都 ≤ contextBudgetChars，
     * 工具结果另有 12000 字符总预算与 4000 字符单条上限 —— 三层都在"有界"这一侧。
     */
    contextToolMaxRounds: 3,
    contextToolResultChars: 4000,
    contextToolTotalChars: 12000,
  };
}

export const SMTP_MAX_ACCOUNTS = 10;
