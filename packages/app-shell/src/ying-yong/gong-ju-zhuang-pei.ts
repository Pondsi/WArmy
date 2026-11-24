/**
 * R287 P3-6：工具规格装配唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 装配顺序：干活工具（含小弟）＋记忆工具＋自定义工具＋MCP 工具 → 可见性过滤 →
 * 档位截尾（点名/最小干活集不裁）→ R291 稳定化（排序＋canonical 键序，prefix cache LCP）。
 * 规格来源/可见性/点名/审计窄注入；截尾与稳定化复用既有纯模块（不另写一套）。构造无副作用。
 */
import type { GongJuGuiGe } from '@warmy/providers';
import { fenDangJieWei } from '../gong-ju-fen-dang.js';
import { wenDingGongJuBiao } from '../ji-chu/gong-ju-wen-ding.js';

export interface GongJuZhuangPeiYiLai {
  jiYiGuiGe: () => GongJuGuiGe[];
  ganHuoGuiGe: (xiaoDiShangXian: number) => GongJuGuiGe[];
  mcpGuiGe: () => Promise<GongJuGuiGe[]>;
  ziDingLie: () => Array<{ name: string; description?: string; parameters?: unknown }>;
  keJian: (name: string) => boolean;
  dianMing: (sessionId: string) => Set<string> | undefined;
  auditLog: (op: string, detail: unknown) => void;
}

export function chuangJianGongJuZhuangPei(yiLai: GongJuZhuangPeiYiLai) {
  async function zuJingGongJuGuiGe(sessionId: string, xiaoDiShangXian: number, jiyiJiuxu: boolean, keGanHuo: boolean, zuiDuo = 0): Promise<GongJuGuiGe[]> {
    const jiyiTools: GongJuGuiGe[] = jiyiJiuxu ? yiLai.jiYiGuiGe() : [];
    const ganHuoTools = keGanHuo ? yiLai.ganHuoGuiGe(xiaoDiShangXian) : [];
    /** T148：第三方 MCP 工具（经监管网关过滤/标记后并入）；没配置时为空 */
    const mcpTools: GongJuGuiGe[] = await (async () => {
      try { return await yiLai.mcpGuiGe(); } catch { return []; }
    })();
    const ziDing = yiLai.ziDingLie().filter((g) => yiLai.keJian(g.name));
    const ziDingGuiGe = ziDing.map((g) => ({
      type: 'function' as const,
      function: { name: g.name, description: g.description || `自定义工具：${g.name}`, parameters: g.parameters },
    })) as unknown as GongJuGuiGe[];
    const quan = [...ganHuoTools, ...jiyiTools, ...ziDingGuiGe, ...mcpTools].filter((g) => yiLai.keJian(g.function.name));
    /**
     * **窗口装不下整套工具规格时按档位截尾**（计价侧与发送侧同调这一个函数）：
     * 用户这一轮点名/明显要用的工具与最小干活集永远不许被裁。
     */
    const dianMing = yiLai.dianMing(String(sessionId || ''));
    const fd = fenDangJieWei(quan, zuiDuo, { ziDingMing: new Set(ziDing.map((z) => z.name)), dianMing });
    if (fd.jieWei) {
      try { yiLai.auditLog('chat.tools.trim-list', { sessionId, zuiDuo: fd.shou, baoDi: fd.baoDi, liu: fd.liu.map((g) => g.function.name), diu: fd.diu, dianMing: [...(dianMing || [])] }); } catch { /* 审计失败不挡发送 */ }
    }
    /* R291：稳定前缀——同集合下逐轮字节一致（排序＋键序规范化），最大化 prefix cache LCP。 */
    return wenDingGongJuBiao(fd.liu);
  }
  return { zuJingGongJuGuiGe };
}
