/**
 * R287 P3-5：会话写入主路唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 规则闭包：角色归一 → hidden 只进镜像 → 纯标点/零宽拦截 → 10 分钟归一化去重 →
 * 用户消息刷新话题 → 落日志 → 旁路富字段 → 镜像 → 跨窗广播 → 记忆服务不可用兜底 JSONL。
 * 状态（chatLogs/chatHistories）与规则函数（归一/正文判据/话题/旁路/镜像）仍由主进程持有，窄注入；
 * 本模块只拥有「写入路径的判定顺序」这一份实现。构造无副作用。
 */
import type { LogEntry } from '../context-renderer.js';
import type { LiaoTianXiaoXi } from '@warmy/providers';

export interface HuiHuaXieRuYiLai {
  guiYiJiaoSe: (role: string) => string;
  youShiZhiWenBen: (wen: string) => boolean;
  shuaXinHuaTi: (key: string, content: string, seq: number) => void;
  /** 读日志数组（返回主进程 Map 里的真实引用，push 原地生效） */
  duRiZhi: (key: string) => LogEntry[] | undefined;
  sheRiZhi: (key: string, entries: LogEntry[]) => void;
  jiLuMeta: (key: string, entry: LogEntry) => void;
  jingXiangXieRu: (key: string, role: LiaoTianXiaoXi['role'], content: string) => void;
  guangBo: (tongDao: string, shuJu: unknown) => void;
  memoryJiuXu: () => boolean;
  daBaoXieRuJsonl: (key: string, role: string, ti: string) => void;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong?: () => number;
}

export function chuangJianHuiHuaXieRu(yiLai: HuiHuaXieRuYiLai) {
  const shiZhong = yiLai.shiZhong || (() => Date.now());

  function zhuiJiaLiaoTianRiZhi(key: string, entry: LogEntry): void {
    // 归一后写入：去重、镜像、回读全部只认这一套角色名
    const tiaoMu = { ...entry, role: yiLai.guiYiJiaoSe(entry.role) } as LogEntry;
    /**
     * **内部指令不进聊天记录**（真事故：用户看到聊天里冒出「【继续执行计划】…」自己没说过的话）。
     * 自动续派的工单只进模型上下文（chatHistories），不进会话日志（chatLogs）⇒ 界面不显示。
     */
    if ((entry as { hidden?: boolean }).hidden) {
      yiLai.jingXiangXieRu(key, tiaoMu.role, tiaoMu.content);
      return;
    }
    /**
     * **每一次模型回复都单独落一条**（第 110 轮硬规则）：绝不合并正文/思考/中间回复/行动，
     * 续派轮也作为新 assistant 消息追在后面。mergeWithPrev 字段保留只为兼容旧调用方，写入路径忽略它。
     */
    /**
     * **纯标点/零宽不入账**（真机反馈：回答完下面多出一个只有「。」的回复）。
     * 主进程各条写入路径都经这里，所以在入口统一拦掉。（系统提示类 system:true 如实保留。）
     */
    if (!tiaoMu.system && tiaoMu.role !== 'user' && String(tiaoMu.content || '').trim() && !yiLai.youShiZhiWenBen(String(tiaoMu.content))) {
      try { yiLai.auditLog('chat.punct-only-dropped', { sessionId: key, chars: String(tiaoMu.content || '').length }); } catch { /* noop */ }
      return;
    }
    /**
     * **短窗口去重**：同一条消息有两条写入路径（渲染层补写 + 主进程 chat-send/值班记录），
     * 不去重就会两份。第 123 轮：窗口 3 秒 → 10 分钟 + 归一化比较（与渲染层同口径）。
     */
    {
      const arr0 = yiLai.duRiZhi(key) || [];
      const last = arr0[arr0.length - 1];
      const ts = Number(tiaoMu.ts || 0) || shiZhong();
      const guiYiBi = (s: unknown) => String((s as string) || '').replace(/\s+/g, ' ').trim();
      if (last && last.role === tiaoMu.role && guiYiBi(last.content) === guiYiBi(tiaoMu.content) && ts - Number(last.ts || 0) < 600000) {
        return; // 跳过：同一条消息被两条路径重复写入（窗口 10 分钟）
      }
    }
    /** 新话题判断：用户消息进入时刷新话题起点（换题设点 / 回题清除 / 超 30 分钟设点） */
    if (tiaoMu.role === 'user') void yiLai.shuaXinHuaTi(key, String(tiaoMu.content || ''), Number(tiaoMu.seq) || 0);
    const shuZu = yiLai.duRiZhi(key);
    if (shuZu) shuZu.push(tiaoMu);
    else yiLai.sheRiZhi(key, [tiaoMu]);
    /** 第 38 轮 项 2/8：富字段（思考/模型/词元/附件）另存旁路，重启后还能显示 */
    try { yiLai.jiLuMeta(key, tiaoMu); } catch { /* noop */ }
    yiLai.jingXiangXieRu(key, tiaoMu.role, tiaoMu.content);
    /**
     * 日志一写就播给所有窗口：只带 sessionId 与 seq，不带正文 ——
     * 正文仍由渲染层按既有通道回读，保证"看到的就是日志里那份"，不会出现第二个真相。
     */
    try {
      yiLai.guangBo('warmy:liaoTianUpdated', { sessionId: key, seq: (entry as { seq?: number }).seq ?? null, ts: shiZhong() });
    } catch { /* noop */ }
    // 记忆服务不可用 ⇒ 直接落 JSONL（否则重启即丢）；服务在跑时由 memory.append 写，不重复
    if (!yiLai.memoryJiuXu()) {
      yiLai.daBaoXieRuJsonl(key, tiaoMu.role, String(tiaoMu.content || ''));
    }
  }

  return { zhuiJiaLiaoTianRiZhi };
}
