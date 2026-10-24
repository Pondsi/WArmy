/**
 * 任务黑板 / 蒸馏全文的**宿主落盘适配**（主进程与门禁调同一份）。
 *
 * 编排器（orchestrator.ts）只认三个回调：黑板条目怎么存、产物怎么核实、超长结论怎么存档。
 * 这三件事以前要写在主进程里 —— 门禁跑不到主进程，只能搜字面；收成这里的纯工厂之后，
 * 门禁拿**真的记忆服务**（memory-os 的 JiyiCangFuwu）接上同一份工厂，直接验"存进去了、取得回来"。
 *
 * 口径：
 *  · 黑板条目 = 记忆库一条 kind:'blackboard'，recordId 就是条目 id（hb-<任务>-<序号>）；
 *  · 执行者超长结论 = 一条 kind:'worker'，recordId = wk-<任务>-<执行者>；
 *  · **只有记忆服务回了 ok:true 才算落盘** —— 落盘失败的条目不标"已存档"、超长结论不给指针
 *    （指向不存在的地方比不给更坏）；成败都写审计，能 grep 到。
 */
import fs from 'node:fs';
import type { HeiBanTiao, XieRuZhe, JsonlXieRu } from '@warmy/contracts';
import type { HeiBanCunChu } from './hei-ban.js';
import { heiBanJiLuWen } from './hei-ban.js';
import { resolveInside } from './work-tools.js';

/** 记忆服务里这里用得到的那一小块（主进程的 JiyiCangKeHu、门禁的 JiyiCangFuwu 适配都满足） */
export interface JiYiZhuiJiaKou {
  readonly isReady: boolean;
  append(record: JsonlXieRu & { ti: string }, Bi: XieRuZhe): Promise<unknown> | unknown;
}

export type ShenJi = (code: string, data: Record<string, unknown>) => void;

function cuoWen(e: unknown): string {
  return String((e as { message?: unknown })?.message || e || '').slice(0, 140);
}

function huiYingOk(hui: unknown): { ok: boolean; seq: number; error: string } {
  const h = (hui && typeof hui === 'object' ? hui : {}) as { ok?: unknown; seq?: unknown; error?: unknown };
  return { ok: h.ok === true, seq: Number(h.seq) || 0, error: String(h.error || '') };
}

/** 黑板条目落盘：写记忆库成功（ok:true）才返回 true */
export function zaoHeiBanCun(jiYi: () => JiYiZhuiJiaKou | null | undefined, shenJi: ShenJi = () => {}): HeiBanCunChu {
  return {
    xie: async (t: HeiBanTiao) => {
      const m = jiYi();
      if (!m?.isReady) {
        try { shenJi('group.heiban-fail', { groupId: t.groupId, renWuId: t.renWuId, id: t.id, error: 'memory-not-ready' }); } catch { /* noop */ }
        return false;
      }
      try {
        const hui = huiYingOk(await m.append({
          id: t.id,
          sessionId: t.groupId,
          groupId: t.groupId,
          kind: 'blackboard',
          entityType: 'blackboard',
          ti: heiBanJiLuWen(t),
          renWuId: t.renWuId,
          lei: t.lei,
          laiYuan: t.laiYuan,
          ...(t.zhuTi ? { zhuTi: t.zhuTi } : {}),
          ...(t.luJing ? { luJing: t.luJing } : {}),
          ...(t.guanLian ? { guanLian: t.guanLian } : {}),
          ...(t.tiDai ? { tiDai: t.tiDai } : {}),
        }, t.laiYuan.jueSe === 'executor' ? 'executor' : 'duty'));
        try { shenJi('group.heiban', { groupId: t.groupId, renWuId: t.renWuId, id: t.id, lei: t.lei, laiYuan: t.laiYuan.id, ok: hui.ok, seq: hui.seq }); } catch { /* noop */ }
        if (!hui.ok) {
          try { shenJi('group.heiban-fail', { groupId: t.groupId, renWuId: t.renWuId, id: t.id, error: hui.error || 'append-not-ok' }); } catch { /* noop */ }
        }
        return hui.ok;
      } catch (e) {
        try { shenJi('group.heiban-fail', { groupId: t.groupId, renWuId: t.renWuId, id: t.id, error: cuoWen(e) }); } catch { /* noop */ }
        return false;
      }
    },
  };
}

/** 执行者超长结论存档：成功返回记忆库里的真 recordId，失败返回空串（调用方据此不给指针） */
export function zaoCunZhengLiuQuanWen(jiYi: () => JiYiZhuiJiaKou | null | undefined, shenJi: ShenJi = () => {}) {
  return async (p: { groupId: string; renWuId: string; zxId: string; ming: string; wen: string }): Promise<string> => {
    const m = jiYi();
    if (!m?.isReady) {
      try { shenJi('group.zhengliu-quanwen-fail', { groupId: p.groupId, renWuId: p.renWuId, zxId: p.zxId, error: 'memory-not-ready' }); } catch { /* noop */ }
      return '';
    }
    const id = `wk-${p.renWuId}-${p.zxId}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    try {
      const hui = huiYingOk(await m.append({
        id,
        sessionId: p.groupId,
        groupId: p.groupId,
        kind: 'worker',
        entityType: 'worker',
        ti: `〔执行者完整结论 · ${p.ming} · 任务 ${p.renWuId}〕\n${p.wen}`,
        renWuId: p.renWuId,
        zhiXingZhe: p.zxId,
      }, 'executor'));
      if (!hui.ok) throw new Error(hui.error || 'append-failed');
      try { shenJi('group.zhengliu-quanwen', { groupId: p.groupId, renWuId: p.renWuId, zxId: p.zxId, id, seq: hui.seq, zi: p.wen.length }); } catch { /* noop */ }
      return id;
    } catch (e) {
      try { shenJi('group.zhengliu-quanwen-fail', { groupId: p.groupId, renWuId: p.renWuId, zxId: p.zxId, error: cuoWen(e) }); } catch { /* noop */ }
      return '';
    }
  };
}

/**
 * 产物核实：按干活工具**同一个解析口径**（resolveInside：「桌面」等别名、相对路径落在项目工作区）
 * 算出它指的是哪个文件，再看是否真的存在。只 stat，不读不写。
 */
export function zaoHeShiChanWu(gongZuoQuOf: (groupId: string) => string) {
  return (groupId: string, lu: string): string => {
    try {
      const yuan = String(lu || '').trim();
      if (!yuan) return '';
      const jue = resolveInside(gongZuoQuOf(groupId), yuan, true);
      return fs.existsSync(jue) && fs.statSync(jue).isFile() ? jue : '';
    } catch { return ''; }
  };
}
