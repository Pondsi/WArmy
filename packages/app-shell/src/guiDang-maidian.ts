/**
 * 归档证据锚点（第 44 轮后半 · 用户 #7「归档摘要的锚点用的是假 id ⇒ 改用真实 recordId，指针必须可执行」）
 *
 * 为什么单独成一个纯模块：锚点这件事**只能靠字符串锚证明不了**——旧实现写的是 `recordId: 'seq:' + n`，
 * 一个记忆库里根本不存在的 id，解引用必然取空，用户看到的就是"它说有这条记录，怎么查不到"。
 * 把构造口径收进纯函数后，门禁可以直接喂夹具跑**真值表**（含旧写法作为反例），
 * 而不是去主进程源码里搜某一行字面。
 *
 * 口径（三条，写在 `maidianWeiFan` 里，任何一条违反都是缺陷）：
 *  1. `recordId` 只能**逐字来自**那条日志里真实存在的 id，**绝不许派生**（`'seq:' + n` 这类假 id）；
 *  2. 拿不到真 id 就留空串（宁缺不假）——解引用侧 `if (anchor.recordId)` 自然落回 seq 线索；
 *  3. `seq` 必须是日志里真的有的序号（seq ≤ 0 或日志里查不到 ⇒ 不许当锚点用）。
 */

import type { ZhengjuMaodian } from '@warmy/contracts';

/**
 * 归档锚点 = 契约 `ZhengjuMaodian`（v1.1：证据锚点全仓只有这一份定义；
 * 第 45 轮这里曾另写过一份同形接口，是"契约没人 import"的又一个例子，已收回）。
 */
export type GuiDangMaidian = ZhengjuMaodian;

/** 构造锚点只需要日志里的这两个字段 */
export interface MaidianYuanLiao {
  seq?: number | string | null;
  recordId?: string | null;
  byteOffset?: number | null;
}

/** 默认只锚最近这几条（锚点是"能回去"的线索，不是全量清单） */
export const MAIDIAN_ZUI_DUO_TIAO = 5;

function zhengSeq(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 从**会话日志**里取最近 `zuiDuo` 条做锚点。
 * 没有 seq 的条目直接跳过（宁少不假）；有 seq 没真 id 的，`recordId` 留空串。
 */
export function maidianCongRiZhi(
  rizhi: (readonly MaidianYuanLiao[] | null | undefined),
  opts?: { zuiDuo?: number; wenJian?: string },
): GuiDangMaidian[] {
  const zuiDuo = Math.max(1, Math.floor(Number(opts?.zuiDuo) || MAIDIAN_ZUI_DUO_TIAO));
  const wenJian = String(opts?.wenJian || 'chat-log');
  const keYong = (rizhi || []).filter((l) => l && zhengSeq(l.seq) > 0);
  return keYong.slice(-zuiDuo).map((l) => {
    const id = String(l.recordId || '').trim();
    const b: GuiDangMaidian = { file: wenJian, seq: zhengSeq(l.seq), recordId: id };
    const off = Number(l.byteOffset);
    if (Number.isFinite(off) && off >= 0) b.byteOffset = off;
    return b;
  });
}

/**
 * 外部群（iLink/微信那类）归档：payload 里通常只有 `{file, seq}`，拿不到记忆库的 id。
 * 传进来了就用，没传就空串——**永远不派生**。
 */
export function maidianCongWaiBu(
  anchors: ReadonlyArray<{ file?: string; seq?: number | string | null; recordId?: string | null }> | null | undefined,
  wenJian = 'chat-log',
): GuiDangMaidian[] {
  return (anchors || [])
    .map((a) => {
      const seq = zhengSeq(a?.seq);
      return { file: String(a?.file || wenJian), seq, recordId: String(a?.recordId || '').trim() };
    })
    .filter((a) => a.seq > 0);
}

/**
 * 不变量自检：**返回违反的规则名**（空数组 = 全部成立）。
 * 门禁拿它做真值表；产品侧只在归档后写审计（违反 = 缺陷，不是可接受的降级）。
 */
export function maidianWeiFan(
  maidian: (readonly GuiDangMaidian[] | null | undefined),
  rizhi: (readonly MaidianYuanLiao[] | null | undefined),
): string[] {
  const wei: string[] = [];
  const miao = maidian || [];
  const liao = rizhi || [];
  const seqJi = new Set<number>();
  const idJi = new Set<string>();
  for (const l of liao) {
    const s = zhengSeq(l?.seq);
    if (s > 0) seqJi.add(s);
    const id = String(l?.recordId || '').trim();
    if (id) idJi.add(id);
  }
  for (const m of miao) {
    const id = String(m?.recordId || '').trim();
    const seq = Number(m?.seq);
    /** 规则 1：id 必须逐字来自日志；规则 1b：绝不许是 `seq:N` 这类派生形状 */
    if (id && !idJi.has(id)) wei.push('jiaId');
    if (/^seq\s*[:=]/i.test(id)) wei.push('paiShengId');
    /** 规则 2：没 id 就是空串（不是 undefined、不是 'unknown' 之类占位） */
    if (m && typeof m.recordId !== 'string') wei.push('idLeiXingCuo');
    /** 规则 3：seq 必须真的在日志里 */
    if (!Number.isFinite(seq) || seq <= 0 || !seqJi.has(Math.floor(seq))) wei.push('jiaSeq');
    if (!String(m?.file || '').trim()) wei.push('queWenJian');
  }
  return [...new Set(wei)];
}

/** 锚点里**真的能解引用**的比例（写审计用：`youId / zong`，0 就是"全靠 seq 线索"） */
export function maidianZhenBi(maidian: (readonly GuiDangMaidian[] | null | undefined)): { zong: number; youId: number; bi: number } {
  const miao = maidian || [];
  const youId = miao.filter((m) => String(m?.recordId || '').trim().length > 0).length;
  return { zong: miao.length, youId, bi: miao.length ? Math.round((youId / miao.length) * 100) / 100 : 0 };
}
