/**
 * R287 P6-1：社交配置/凭据持久化唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · 凭据加解密（zhengJiaMi/zhengJieMi）：safeStorage 纪律，嵌套密文有界解包，未知版本/解密失败一律抛错关闭网络路径；
 *    IM 凭据不允许明文降级——整次保存失败，绝不部分写盘。
 *  · 配置读写（duSheJiaoPeiZhi0/duSheJiaoPeiZhi/cunSheJiaoPeiZhi）：按牛马存＋全局旧数据兜底；唯一 IM 持久化入口连未修改的也先解包再加密。
 *  · 账号（sheJiaoZhangHaoLieBiao/cunSheJiaoZhangHao/biaoJiSheJiaoZhangHaoShiYong）：旧 zheng 补 legacy 0 号账号；上限 5；最近使用 60s 节流。
 *  · 连接键（sheJiaoLianJieJian/Jiu）：实例::平台::账号；旧键兼容。
 *  · baoLiuSheJiaoZiDuan：旧 renderer 整份状态不拥有 IM 凭据，新增实例不能旁路注入。
 * 加解密文本助手（jiaMiWenBen/jieMiWenBen）复用 cred-vault（纯函数直接 import）；
 * settingsStore/safeStorage/时钟窄注入；连接生命周期（adapter/队列）留主进程；构造无副作用。
 */
import { jiaMiWenBen, jieMiWenBen, type MiMaBaoHuQi } from '../cred-vault.js';
import type { SheJiaoPingZheng } from '../she-jiao-adapter.js';

export type SheJiaoZhangHao = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  zheng: SheJiaoPingZheng;
};
/** 社交配置（凭据进 cred-vault，配置进 settings.sheJiao） */
export type SheJiaoPeiZhi = {
  pingTai: string;
  qiYong: boolean;
  huiHuaYingShe?: Record<string, string>;
  zheng?: SheJiaoPingZheng;
  /** 多账号（个人微信等）；旧数据只有 zheng 时由 `zhangHaoLieBiao` 补齐 */
  accounts?: SheJiaoZhangHao[];
};
export const SHE_JIAO_ZHANG_HAO_SHANG_XIAN = 5;

export interface SheJiaoPeiZhiYiLai {
  settingsStore: { load: () => unknown; save: (patch: unknown) => void } | null;
  anQuanCunChu: () => MiMaBaoHuQi | null;
  shiZhong: () => number;
}

export function chuangJianSheJiaoPeiZhi(yiLai: SheJiaoPeiZhiYiLai) {
  /** 第 37 轮 项 11：社交接入的 id/secret **落盘加密**（与「社交信息里的密码」同一套 safeStorage 纪律） */
  function zhengJiaMi(z: SheJiaoPingZheng | undefined): SheJiaoPingZheng | undefined {
    if (!z) return z;
    const bao = yiLai.anQuanCunChu();
    const out = { ...zhengJieMi(z) } as SheJiaoPingZheng;
    for (const k of Object.keys(out)) {
      if (k === 'pingTai' || !out[k]) continue;
      const j = jiaMiWenBen(out[k]!, bao);
      // 通用 vault 允许明文降级，IM 凭据不允许：整次保存失败，绝不部分写盘。
      if (!j.anQuan || !j.v.startsWith('enc:v1:')) throw new Error('social-credential-encrypt-failed');
      out[k] = j.v;
    }
    return out;
  }
  function zhengJieMi(z: SheJiaoPingZheng | undefined): SheJiaoPingZheng | undefined {
    if (!z) return z;
    const bao = yiLai.anQuanCunChu();
    const out = { ...z };
    for (const k of Object.keys(out)) {
      if (k === 'pingTai') continue;
      if (out[k] !== undefined && typeof out[k] !== 'string') throw new Error('social-credential-invalid');
      let yuan = out[k] || '';
      // 修复旧版重复保存产生的嵌套密文；有界解包，未知版本/解密失败一律关闭网络路径。
      for (let depth = 0; yuan.startsWith('enc:'); depth++) {
        if (depth >= 8 || yuan.length > 262144 || !yuan.startsWith('enc:v1:') || !bao || !bao.isEncryptionAvailable()) throw new Error('social-credential-decrypt-failed');
        const j = jieMiWenBen(yuan, bao);
        if (!j.ok || !j.v || j.v === yuan) throw new Error('social-credential-decrypt-failed');
        yuan = j.v;
      }
      out[k] = yuan;
    }
    return out;
  }
  function sheJiaoPeiZhiZhuan(x: SheJiaoPeiZhi, zhuan: typeof zhengJieMi): SheJiaoPeiZhi {
    return { ...x, zheng: zhuan(x.zheng), accounts: x.accounts?.map((a) => ({ ...a, zheng: zhuan(a.zheng)! })) };
  }
  function duSheJiaoPeiZhi(instId?: string): SheJiaoPeiZhi[] {
    return duSheJiaoPeiZhi0(instId).map((x) => sheJiaoPeiZhiZhuan(x, zhengJieMi));
  }
  function duSheJiaoPeiZhi0(instId?: string): SheJiaoPeiZhi[] {
    try {
      const s = yiLai.settingsStore?.load() as {
        sheJiao?: SheJiaoPeiZhi[];
        instances?: Array<{ id?: string; sheJiaoJieRu?: Record<string, SheJiaoPeiZhi> }>;
      } | undefined;
      const quanJu = Array.isArray(s?.sheJiao) ? s!.sheJiao! : [];
      if (!instId) return quanJu;
      /**
       * 第 36 轮【项 2】：**按牛马存**。
       * 老数据（`settings.sheJiao` 全局一份）继续读得到 —— 这只牛马自己还没配过的平台，
       * 用全局那份顶上，用户不会因为"搬了个位置"就以为配置丢了。
       */
      const inst = (s?.instances || []).find((x) => String(x?.id || '') === String(instId));
      const ge = inst && inst.sheJiaoJieRu;
      if (!ge || typeof ge !== 'object') return quanJu;
      const list: SheJiaoPeiZhi[] = Object.entries(ge).map(([k, v]) => ({ ...(v || {}), pingTai: String((v && v.pingTai) || k) } as SheJiaoPeiZhi));
      for (const x of quanJu) if (x && x.pingTai && !list.some((y) => y.pingTai === x.pingTai)) list.push({ ...x });
      return list;
    } catch { return []; }
  }
  /** 把一条平台配置写进**某只牛马**（没有 instId 时写回旧的全局键） */
  function cunSheJiaoPeiZhi(instId: string | undefined, tiao: SheJiaoPeiZhi): boolean {
    try {
      if (!yiLai.settingsStore) return false;
      const s = yiLai.settingsStore.load() as { sheJiao?: SheJiaoPeiZhi[]; instances?: Array<{ id?: string; sheJiaoJieRu?: Record<string, SheJiaoPeiZhi> }> };
      const global = [...(s.sheJiao || [])];
      const instances = [...(s.instances || [])];
      if (!instId) {
        const i = global.findIndex((x) => x.pingTai === tiao.pingTai);
        if (i >= 0) global[i] = tiao; else global.push(tiao);
      } else {
        const i = instances.findIndex((x) => x.id === instId);
        if (i < 0) return false;
        instances[i] = { ...instances[i], sheJiaoJieRu: { ...instances[i]!.sheJiaoJieRu, [tiao.pingTai]: tiao } };
      }
      // 唯一 IM 持久化入口：连未修改的平台/实例也先解包再加密，绝不把读回的明文带回磁盘。
      const sheJiao = global.map((x) => sheJiaoPeiZhiZhuan(x, zhengJiaMi));
      const encrypted = instances.map((x) => x.sheJiaoJieRu ? { ...x, sheJiaoJieRu: Object.fromEntries(
        Object.entries(x.sheJiaoJieRu).map(([k, v]) => [k, sheJiaoPeiZhiZhuan(v, zhengJiaMi)]),
      ) } : x);
      yiLai.settingsStore.save({ sheJiao, instances: encrypted } as never);
      return true;
    } catch { return false; }
  }
  /** 旧 renderer 的整份状态不拥有 IM 凭据；新增实例也不能经此旁路注入凭据。 */
  function baoLiuSheJiaoZiDuan(incoming: unknown[], current: unknown[]): unknown[] {
    return incoming.map((x) => {
      const item = { ...(x as Record<string, unknown>) };
      const old = current.find((v) => (v as { id?: unknown })?.id === item.id) as Record<string, unknown> | undefined;
      delete item.sheJiaoJieRu;
      if (old?.sheJiaoJieRu) item.sheJiaoJieRu = old.sheJiaoJieRu;
      return item;
    });
  }
  /**
   * 把一个平台的配置展开成账号列表（旧数据只有 `zheng` 时补成 id=legacy 的 0 号账号）。
   * 这里**只读内存里的明文**，不写盘；写盘由 `cunSheJiaoPeiZhi` 负责重新加密。
   */
  function sheJiaoZhangHaoLieBiao(pei: SheJiaoPeiZhi | undefined): SheJiaoZhangHao[] {
    if (!pei) return [];
    const out: SheJiaoZhangHao[] = [];
    for (const a of Array.isArray(pei.accounts) ? pei.accounts : []) {
      if (!a || !a.zheng) continue;
      const id = String(a.id || a.zheng.botId || '').trim();
      if (!id) continue;
      out.push({
        id,
        name: String(a.name || ''),
        createdAt: Number(a.createdAt) || 0,
        lastUsedAt: Number(a.lastUsedAt) || 0,
        zheng: a.zheng,
      });
    }
    if (!out.length && pei.zheng) {
      const id = String(pei.zheng.botId || pei.zheng.wxid || 'legacy').trim() || 'legacy';
      out.push({ id, name: id, createdAt: 0, lastUsedAt: 0, zheng: pei.zheng });
    }
    return out.slice(0, SHE_JIAO_ZHANG_HAO_SHANG_XIAN);
  }
  /** 连接的键：`实例::平台::账号` —— 同一个平台可以同时挂多个账号，不能互相吃消息 */
  function sheJiaoLianJieJian(instId: string | undefined, pingTai: string, accountId = 'default'): string {
    return String(instId || '') + '::' + String(pingTai || '') + '::' + String(accountId || 'default');
  }
  /** 旧键（兼容只连一个账号的既有调用） */
  function sheJiaoLianJieJianJiu(instId: string | undefined, pingTai: string): string {
    return String(instId || '') + '::' + String(pingTai || '');
  }
  /** 组装明文账号列表；由唯一持久化入口加密，`zheng` 保留最新一条做旧兼容。 */
  function cunSheJiaoZhangHao(instId: string | undefined, pingTai: string, accounts: SheJiaoZhangHao[]): boolean {
    const list = duSheJiaoPeiZhi(instId || undefined);
    const i = list.findIndex((x) => x.pingTai === pingTai);
    const old = i >= 0 && list[i] ? list[i]! : { pingTai, qiYong: false };
    const jie = accounts.slice(0, SHE_JIAO_ZHANG_HAO_SHANG_XIAN).map((a) => ({
      id: a.id,
      name: a.name,
      createdAt: a.createdAt,
      lastUsedAt: a.lastUsedAt,
      zheng: { ...a.zheng, pingTai },
    }));
    const xiao: SheJiaoPeiZhi = {
      ...old,
      pingTai,
      qiYong: jie.length > 0,
      accounts: jie,
      zheng: jie.length ? jie[jie.length - 1]!.zheng : undefined,
      huiHuaYingShe: old.huiHuaYingShe && Object.keys(old.huiHuaYingShe).length ? old.huiHuaYingShe : { default: String(instId || '') },
    };
    return cunSheJiaoPeiZhi(instId || undefined, xiao);
  }
  /** 记录某账号最近使用时间（只在内存里改配置并落盘；失败不影响收消息）。 */
  function biaoJiSheJiaoZhangHaoShiYong(instId: string, pingTai: string, accountId: string): void {
    try {
      if (!accountId) return;
      const list = duSheJiaoPeiZhi(instId || undefined);
      const pei = list.find((x) => x.pingTai === pingTai);
      if (!pei) return;
      const accounts = sheJiaoZhangHaoLieBiao(pei);
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return;
      // 一分钟内不重复写盘（每条消息都写会打断高频收信）。
      if (yiLai.shiZhong() - Number(account.lastUsedAt || 0) < 60000) return;
      account.lastUsedAt = yiLai.shiZhong();
      cunSheJiaoZhangHao(instId || undefined, pingTai, accounts);
    } catch { /* 最近使用时间写不进去不影响收消息 */ }
  }
  return { zhengJiaMi, zhengJieMi, sheJiaoPeiZhiZhuan, duSheJiaoPeiZhi, duSheJiaoPeiZhi0, cunSheJiaoPeiZhi, baoLiuSheJiaoZiDuan, sheJiaoZhangHaoLieBiao, sheJiaoLianJieJian, sheJiaoLianJieJianJiu, cunSheJiaoZhangHao, biaoJiSheJiaoZhangHaoShiYong };
}
