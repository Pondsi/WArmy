/**
 * cred-vault —— **凭据保管**：社交信息里的密码字段，落盘一律加密。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：牛马管理局的「社交信息」里，邮箱 / 网站账号 / 钱包三类都能存密码，
 * 而它们是随 `taiBaoCun` 一起进 `settings.json` 的 —— **明文躺在磁盘上**。
 * 项目自己的 ADR 003 §2.3-5 写着「密钥必须进 safeStorage」，但那条只覆盖了
 * provider API Key（见 `secure-keys.ts`），**用户自己的密码漏在外面**。
 *
 * 做法（与 secure-keys 同一套纪律，不另起炉灶）：
 *   · 落盘前把每一行的 `miMa` 换成 `miMaEnc: 'enc:v1:<base64>'`，并在行上记 `miMaBaoHu`
 *     （`os` = 走系统保护；`plain` = 系统保护不可用退化成明文，**如实标记**，不冒充当加密）；
 *   · 读回时解密回 `miMa`，界面与搜索逻辑**完全不用改**（内存里仍是明文，只有磁盘加密）；
 *   · 老数据（明文 `miMa`）照常读得回来，不丢、不报错。
 *
 * 安全边界**如实说明**：safeStorage 用的是操作系统级密钥（Windows DPAPI / macOS 钥匙串 /
 * Linux 的 libsecret）。它挡的是"配置被拷走/被别的程序读"这一类；**挡不住已经在你机器上
 * 以你的身份运行的恶意程序**。这是 Electron 能给到的上限，不把它吹得更强。
 *
 * 纯函数（safeStorage 由调用方注入）—— 门禁可在无头环境直接断言。
 */

export interface MiMaBaoHuQi {
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
  isEncryptionAvailable(): boolean;
}

export const MI_MA_QIAN_ZHUI = 'enc:v1:';
/** 带密码字段的三类社交信息（手机号/头像/昵称没有密码） */
export const MI_MA_LEI = ['youXiang', 'wangZhan', 'qianBao'] as const;

export interface BaoHuTongJi {
  /** 加密替换掉的密码条数 */
  jiaMi: number;
  /** 解密还原的条数 */
  jieMi: number;
  /** 系统保护不可用、只能留明文（或解不开）的条数 */
  mingWen: number;
  /** 实际使用的模式 */
  moShi: 'os' | 'plain';
  /** 解密失败的具体条目（如实上报，便于用户知道哪一条要重填） */
  shiBai: Array<{ lei: string; index: number; ming?: string }>;
}

function shiDuiXiang(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 落盘前加密：返回**新的** instances（不改原对象，避免把内存里的明文也换掉）。
 */
export function jiaMiSheJiao(instances: unknown, bao: MiMaBaoHuQi | null): { instances: unknown; tong: BaoHuTongJi } {
  const tong: BaoHuTongJi = { jiaMi: 0, jieMi: 0, mingWen: 0, moShi: bao ? 'os' : 'plain', shiBai: [] };
  if (!Array.isArray(instances)) return { instances, tong };
  const keYong = !!bao && bao.isEncryptionAvailable();
  const out = instances.map((inst) => {
    if (!shiDuiXiang(inst)) return inst;
    const sj = inst['sheJiao'];
    if (!shiDuiXiang(sj)) return inst;
    const sj2: Record<string, unknown> = { ...sj };
    let dong = false;
    for (const lei of MI_MA_LEI) {
      const lie = sj2[lei];
      if (!Array.isArray(lie)) continue;
      const lie2 = lie.map((hang) => {
        if (!shiDuiXiang(hang)) return hang;
        const pw = hang['miMa'];
        if (typeof pw !== 'string' || !pw) {
          // 没有密码：什么都没加密，别标成"已保护"
          if (hang['miMaEnc'] || hang['miMaBaoHu']) { const { miMaEnc: _e, miMaBaoHu: _b, ...rest } = hang as Record<string, unknown>; void _e; void _b; return rest; }
          return hang;
        }
        if (pw.startsWith(MI_MA_QIAN_ZHUI)) return hang; // 已经是密文（重复保存），原样带过
        if (!keYong) { tong.mingWen++; return { ...hang, miMa: pw, miMaBaoHu: 'plain' }; }
        try {
          const enc = bao!.encryptString(pw).toString('base64');
          tong.jiaMi++;
          const { miMa: _m, ...rest } = hang as Record<string, unknown>;
          void _m;
          return { ...rest, miMaEnc: MI_MA_QIAN_ZHUI + enc, miMaBaoHu: 'os' };
        } catch {
          tong.mingWen++;
          return { ...hang, miMa: pw, miMaBaoHu: 'plain' };
        }
      });
      sj2[lei] = lie2;
      dong = true;
    }
    return dong ? { ...inst, sheJiao: sj2 } : inst;
  });
  return { instances: out, tong };
}

/**
 * 读回时解密：把 `miMaEnc` 还原成 `miMa`（解不开就**不塞假密码**，如实记进 `shiBai`）。
 */
export function jieMiSheJiao(instances: unknown, bao: MiMaBaoHuQi | null): { instances: unknown; tong: BaoHuTongJi } {
  const tong: BaoHuTongJi = { jiaMi: 0, jieMi: 0, mingWen: 0, moShi: bao ? 'os' : 'plain', shiBai: [] };
  if (!Array.isArray(instances)) return { instances, tong };
  const out = instances.map((inst) => {
    if (!shiDuiXiang(inst)) return inst;
    const sj = inst['sheJiao'];
    if (!shiDuiXiang(sj)) return inst;
    const sj2: Record<string, unknown> = { ...sj };
    let dong = false;
    for (const lei of MI_MA_LEI) {
      const lie = sj2[lei];
      if (!Array.isArray(lie)) continue;
      const lie2 = (lie as unknown[]).map((hang, index) => {
        if (!shiDuiXiang(hang)) return hang;
        const enc = hang['miMaEnc'];
        if (typeof enc !== 'string' || !enc.startsWith(MI_MA_QIAN_ZHUI)) {
          if (typeof hang['miMa'] === 'string') tong.mingWen++;
          return hang;
        }
        if (!bao || !bao.isEncryptionAvailable()) {
          tong.mingWen++;
          tong.shiBai.push({ lei, index, ming: String(hang['ming'] || hang['dizhi'] || '') });
          return hang; // 这台机器上解不开（换了用户/系统重装）：**不塞假值**
        }
        try {
          const pw = bao.decryptString(Buffer.from(enc.slice(MI_MA_QIAN_ZHUI.length), 'base64'));
          tong.jieMi++;
          const { miMaEnc: _e, ...rest } = hang as Record<string, unknown>;
          void _e;
          return { ...rest, miMa: pw, miMaBaoHu: 'os' };
        } catch {
          tong.mingWen++;
          tong.shiBai.push({ lei, index, ming: String(hang['ming'] || hang['dizhi'] || '') });
          return hang;
        }
      });
      sj2[lei] = lie2;
      dong = true;
    }
    return dong ? { ...inst, sheJiao: sj2 } : inst;
  });
  return { instances: out, tong };
}

/** 统计一份 instances 里**还有多少明文密码**（UI 提示 / 门禁断言用） */
export function mingWenMiMaShu(instances: unknown): number {
  let n = 0;
  if (!Array.isArray(instances)) return 0;
  for (const inst of instances) {
    if (!shiDuiXiang(inst)) continue;
    const sj = inst['sheJiao'];
    if (!shiDuiXiang(sj)) continue;
    for (const lei of MI_MA_LEI) {
      const lie = sj[lei];
      if (!Array.isArray(lie)) continue;
      for (const hang of lie) {
        if (!shiDuiXiang(hang)) continue;
        if (typeof hang['miMa'] === 'string' && hang['miMa'] && !hang['miMaEnc']) n++;
      }
    }
  }
  return n;
}

/**
 * 第 37 轮 项 11：**通用的"字符串加密落盘"**（给社交接入的 id/secret 用）。
 *
 * 为什么需要：社交接入的凭据以前**明文**躺在 settings.json 的 `sheJiao[].zheng` 里。
 * 本轮改成按牛马存之后份数还会变多 ⇒ 必须与「社交信息里的密码」同一套纪律：
 *   · 落盘 `enc:v1:<base64>`；内存里仍是明文（界面与适配器完全不用改）；
 *   · 系统保护不可用时**如实退明文**（不冒充当加密），由调用方去提示用户。
 */
export function jiaMiWenBen(s: string, bao: MiMaBaoHuQi | null): { v: string; anQuan: boolean } {
  const yuan = String(s || '');
  if (!yuan) return { v: '', anQuan: true };
  if (!bao || !bao.isEncryptionAvailable()) return { v: yuan, anQuan: false };
  try { return { v: MI_MA_QIAN_ZHUI + bao.encryptString(yuan).toString('base64'), anQuan: true }; } catch { return { v: yuan, anQuan: false }; }
}
export function jieMiWenBen(s: string, bao: MiMaBaoHuQi | null): { v: string; ok: boolean } {
  const yuan = String(s || '');
  if (!yuan) return { v: '', ok: true };
  if (!yuan.startsWith(MI_MA_QIAN_ZHUI)) return { v: yuan, ok: true };
  if (!bao) return { v: '', ok: false };
  try { return { v: bao.decryptString(Buffer.from(yuan.slice(MI_MA_QIAN_ZHUI.length), 'base64')), ok: true }; } catch { return { v: '', ok: false }; }
}
