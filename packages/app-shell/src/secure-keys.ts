/**
 * SafeStorage 密钥加密：API Key 写入前加密，读取后内存解密。
 *
 * ⚠️ 历史缺陷（本次修复）：本文件是 ESM 模块，而原来用裸 `require('electron')` —— 在 ESM 下
 * 必然抛 `ReferenceError: require is not defined`，被 catch 吞掉后**静默降级为明文 base64**。
 * 于是即使本机 safeStorage 可用，provider API Key 也是明文落盘（base64 只是编码不是加密）。
 * 这违反了 ADR 003 §2.3-5「密钥必须进 safeStorage」的硬要求。
 *
 * 现在的规则：
 * 1. 用 `createRequire(import.meta.url)` 正确拿到 electron，safeStorage 真正生效；
 * 2. 落盘格式带**显式保护标记** `{ v: 2, protector, data }`，不再靠"猜"；
 * 3. **无 OS 保护时拒绝写明文**并抛出 `no-safe-storage`。只有显式设置
 *    `WARMY_ALLOW_PLAINTEXT_KEYS=1`（仅供开发）才允许，且仍会打上 `plain` 标记，
 *    读回时给出可识别的降级信号，便于 UI 提示与后续迁移。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface Tiaomu {
  v: 2;
  protector: 'os' | 'plain';
  data: string;
}

type YuanwenWenjian = Record<string, Tiaomu | string>;

function anQuanCunChuOf(): { encryptString(s: string): Buffer; decryptString(b: Buffer): string; isEncryptionAvailable(): boolean } | null {
  try {
    const electron = require('electron') as typeof import('electron');
    const anQuanCang = electron?.safeStorage;
    if (!anQuanCang) return null;
    // 在非 Electron 环境（纯 node 跑测试）下这两项可能不存在
    if (typeof anQuanCang.encryptString !== 'function' || typeof anQuanCang.decryptString !== 'function') return null;
    if (typeof anQuanCang.isEncryptionAvailable === 'function' && !anQuanCang.isEncryptionAvailable()) return null;
    return anQuanCang as never;
  } catch {
    return null;
  }
}

function yunxuMingwen(): boolean {
  return process.env['WARMY_ALLOW_PLAINTEXT_KEYS'] === '1';
}

export class AnQuanMiyaoCang {
  private file: string;

  constructor(userData: string) {
    const dir = path.join(userData, 'secure');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'keys.enc.json');
  }

  /** 加密保存。没有 OS 级保护时**拒绝写明文**（除非显式开发开关）。 */
  async save(providerId: string, apiKey: string): Promise<void> {
    const anQuanCang = anQuanCunChuOf();
    let entry: Tiaomu;
    if (anQuanCang) {
      entry = { v: 2, protector: 'os', data: anQuanCang.encryptString(apiKey).toString('base64') };
    } else if (yunxuMingwen()) {
      // 仅供开发：明文但**明确标记**，不冒充加密
      entry = { v: 2, protector: 'plain', data: Buffer.from(apiKey, 'utf8').toString('base64') };
    } else {
      throw new Error('no-safe-storage');
    }
    const all = this.loadRaw();
    all[providerId] = entry;
    fs.writeFileSync(this.file, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
  }

  /** 读取；若条目是无保护的明文（历史遗留或开发开关），照常返回但给出可识别信号。 */
  async load(providerId: string): Promise<string | null> {
    const all = this.loadRaw();
    const raw = all[providerId];
    if (!raw) return null;

    // v1 遗留：裸 base64 字符串，无法区分"密文"还是"明文"
    if (typeof raw === 'string') {
      const buf = Buffer.from(raw, 'base64');
      const anQuanCang = anQuanCunChuOf();
      if (anQuanCang) {
        try {
          return anQuanCang.decryptString(buf);
        } catch {
          /* 不是 OS 密文 → 当遗留明文处理 */
        }
      }
      return buf.toString('utf8');
    }

    if (raw.protector === 'os') {
      const anQuanCang = anQuanCunChuOf();
      if (!anQuanCang) return null; // 现在解不开，不要返回乱码
      try {
        return anQuanCang.decryptString(Buffer.from(raw.data, 'base64'));
      } catch {
        return null;
      }
    }
    // protector === 'plain'
    return Buffer.from(raw.data, 'base64').toString('utf8');
  }

  /** 该条目是否为无保护明文（供 UI 提示 / 迁移） */
  isUnprotected(providerId: string): boolean {
    const raw = this.loadRaw()[providerId];
    if (raw === undefined) return false;
    return typeof raw === 'string' || raw.protector === 'plain';
  }

  delete(providerId: string): void {
    const all = this.loadRaw();
    delete all[providerId];
    fs.writeFileSync(this.file, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
  }

  private loadRaw(): YuanwenWenjian {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as YuanwenWenjian;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}
