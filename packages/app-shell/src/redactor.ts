/**
 * 工具输出脱敏（第 111 轮）。
 *
 * 目标不是“把一切像密钥的东西都猜成密钥”，而是：
 *   · 本应用**已知的**密钥（SecureKeyStore 里的 API Key / 社交密码等）绝不原样进入模型上下文；
 *   · 常见格式的高熵密钥（sk-…、Bearer …、api_key=…、PEM 私钥）替换成**可引用的占位**；
 *   · 普通文字、代码变量名、路径不误伤。
 *
 * 占位形如 `[已脱敏:secret-1a2b3c4d]`：模型可以引用这个引用，但拿不到原值。
 */
import crypto from 'node:crypto';

interface MiYaoTiao {
  value: string;
  ref: string;
}

function refOf(value: string): string {
  return 'secret-' + crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

export class TuoMinQi {
  private items: MiYaoTiao[] = [];

  /** 用已知密钥全集重建（去重、按长度倒序，先替换长的，避免短串把长串切碎） */
  setSecrets(values: Array<{ value: string; label?: string }>): void {
    const seen = new Set<string>();
    const out: MiYaoTiao[] = [];
    for (const it of values) {
      const v = String(it.value || '');
      if (v.length < 6 || seen.has(v)) continue;
      seen.add(v);
      out.push({ value: v, ref: String(it.label || '').trim() || refOf(v) });
    }
    out.sort((a, b) => b.value.length - a.value.length);
    this.items = out;
  }

  addSecret(value: string, label?: string): void {
    const v = String(value || '');
    if (v.length < 6) return;
    if (this.items.some((x) => x.value === v)) return;
    this.items.push({ value: v, ref: String(label || '').trim() || refOf(v) });
    this.items.sort((a, b) => b.value.length - a.value.length);
  }

  redact(text: unknown): string {
    let s = String(text ?? '');
    if (!s) return s;
    for (const it of this.items) {
      if (s.includes(it.value)) s = s.split(it.value).join(`[已脱敏:${it.ref}]`);
    }
    /** 常见高熵格式：只替换值，保留字段名，方便模型知道“这里有一个密钥引用” */
    s = s.replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, (m) => `[已脱敏:${refOf(m)}]`);
    s = s.replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, (m) => `[已脱敏:${refOf(m)}]`);
    s = s.replace(/\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g, (m) => `[已脱敏:${refOf(m)}]`);
    s = s.replace(/(Authorization\s*:\s*Bearer\s+)([^\s'"]{8,})/gi, (_m, head, secret) => `${head}[已脱敏:${refOf(String(secret))}]`);
    s = s.replace(/\b(api[_-]?key|access[_-]?token|secret[_-]?key|password|passwd)\b(\s*[:=]\s*['"]?)([A-Za-z0-9_\-./+=]{12,})/gi,
      (_m, name, sep, secret) => `${name}${sep}[已脱敏:${refOf(String(secret))}]`);
    s = s.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      '[已脱敏:private-key]');
    return s;
  }

  get size(): number { return this.items.length; }
}
