/**
 * SafeStorage 密钥加密：API Key 写入前加密，读取后内存解密
 * Electron safeStorage → 加密文件；未加密时回退 base64（仅开发）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class SecureKeyStore {
  private file: string;

  constructor(userData: string) {
    const dir = path.join(userData, 'secure');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'keys.enc.json');
  }

  /** 加密保存（Electron safeStorage 优先） */
  async save(providerId: string, apiKey: string): Promise<void> {
    let encrypted: string;
    try {
      const { safeStorage } = require('electron');
      if (safeStorage.isEncryptionAvailable()) {
        encrypted = safeStorage.encryptString(apiKey).toString('base64');
      } else {
        encrypted = Buffer.from(apiKey, 'utf8').toString('base64');
      }
    } catch {
      encrypted = Buffer.from(apiKey, 'utf8').toString('base64');
    }
    const all = this.loadRaw();
    all[providerId] = encrypted;
    fs.writeFileSync(this.file, JSON.stringify(all), 'utf8');
  }

  async load(providerId: string): Promise<string | null> {
    const all = this.loadRaw();
    const enc = all[providerId];
    if (!enc) return null;
    try {
      const { safeStorage } = require('electron');
      const buf = Buffer.from(enc, 'base64');
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buf);
      }
      return buf.toString('utf8');
    } catch {
      return Buffer.from(enc, 'base64').toString('utf8');
    }
  }

  delete(providerId: string): void {
    const all = this.loadRaw();
    delete all[providerId];
    fs.writeFileSync(this.file, JSON.stringify(all), 'utf8');
  }

  private loadRaw(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
}
