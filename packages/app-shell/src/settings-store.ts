/**
 * 本地账号（登录未开放时的本地会话）与设置持久化
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface LocalProfile {
  username: string;
  avatarDataUrl: string;
  email: string;
  passwordHash?: string;
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
}

function hash(pw: string) {
  return crypto.createHash('sha256').update(pw + 'ccarmy').digest('hex');
}

export class LocalAccountStore {
  constructor(private file: string) {}

  loadProfile(): LocalProfile {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { username: '主人', avatarDataUrl: '', email: '' };
    }
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
  };
}
