/**
 * 「被拒不认」重试风暴的**记账本**（第 52 轮按用户拍板定稿：停用不再按时间窗失效）。
 *
 * 旧口径写在主进程里，两处失真都有真机读数：
 *  1. **时间窗一过就放行**：数的是「最近 120000ms 内这个工具的失败次数」⇒ 一条长任务里每 2 分钟
 *     重新放行一次。第 51 轮小游戏第 2 遍：`run_shell` 被拒 9 次、602 秒零产出，
 *     `juJueTingYong` 只在窗口内响了 2 次 —— 模型每次被放行就换一条命令再撞墙。
 *  2. **把普通失败算成授权拒绝**：数的是 `ok:false`，路径写错、命令退出码非 0 也进账
 *     ⇒ 提示语对模型撒谎「当前授权档不放行」，模型于是去找别的工具绕（正是最不想要的路径）。
 *
 * 新口径：**只由各拒绝点显式记账**（授权档不放行 / 用户点了拒绝），同一条任务里同一工具累计
 * `JU_JUE_DING_SI` 次 ⇒ **本轮硬停用**（不再执行）；只有**新的用户消息**才重置。
 * 「继续执行 / 用户决定」是同一个任务的续接 ⇒ 停用名单留着，否则点一次「继续」又把墙放开。
 *
 * 单独成模块是为了**能脱开 Electron 直接验真值表**（见 scripts/verify-r52-jujue.mjs）。
 */
/** 同一条任务里同一工具被拒到几次就钉死 */
export const JU_JUE_DING_SI = 2;

/**
 * 拒绝消息的**统一开头**（主进程各拒绝分支都写成 `[工具名] 被拒（…授权）：…` 或
 * `[工具名] 用户拒绝…`）。用它而不是数 `ok:false`：普通失败不进账。
 * `knowledge_add` 的「这一层对本会话不可写」也**故意不进账** —— 那是同一工具换层的正常用法，不是撞墙。
 */
export const JU_JUE_KAI_TOU = /^\[[^\]]{1,24}\] (?:被拒（|用户拒绝)/;

/**
 * 拒绝回话的**唯一出处**：文案从这里生成，开头就一定落进 `JU_JUE_KAI_TOU` ⇒
 * 记账判据和文案同源，改措辞不可能漏记一笔账（第 52 轮把这一点做成结构，而不是靠门禁扫字符串）。
 */
/** 授权档不放行：`[工具] 被拒（normal授权）：原因。补充` */
export function huiBaoShouQuanJu(gongJu: string, dangAn: string, yuanYin: string, buChong = ''): string {
  return `[${gongJu}] 被拒（${dangAn}授权）：${yuanYin}${buChong ? '。' + buChong : ''}`;
}
/** 用户点了拒绝：`[工具] 用户拒绝执行：命令。补充` */
export function huiBaoYongHuJu(gongJu: string, shi: string, buChong = ''): string {
  return `[${gongJu}] 用户拒绝${shi}${buChong ? '。' + buChong : ''}`;
}

export type JuJueJiLu = { n: number; yuanYin: string; gangTingYong: boolean };

export function chuangJuJueZhang(): {
  jiLu: (sessionId: string, tool: string, yuanYin: string) => JuJueJiLu;
  shiFouTingYong: (sessionId: string, tool: string) => boolean;
  ciShu: (sessionId: string, tool: string) => number;
  yuanYin: (sessionId: string, tool: string) => string;
  chongZhi: (sessionId: string) => void;
} {
  const ciShuBiao = new Map<string, Map<string, { n: number; yuanYin: string }>>();
  const tingYongBiao = new Map<string, Set<string>>();
  const key = (sessionId: string) => String(sessionId || '');
  return {
    /** 记一笔拒绝；返回累计次数与「这一次是否刚好把它钉死」（主进程据此写审计） */
    jiLu(sessionId, tool, yuanYin): JuJueJiLu {
      const k = key(sessionId);
      const ming = String(tool || '');
      const ji = ciShuBiao.get(k) || new Map<string, { n: number; yuanYin: string }>();
      const n = (ji.get(ming)?.n || 0) + 1;
      ji.set(ming, { n, yuanYin: String(yuanYin || '').slice(0, 160) });
      ciShuBiao.set(k, ji);
      const already = !!tingYongBiao.get(k)?.has(ming);
      let gangTingYong = false;
      if (n >= JU_JUE_DING_SI && !already) {
        const t = tingYongBiao.get(k) || new Set<string>();
        t.add(ming);
        tingYongBiao.set(k, t);
        gangTingYong = true;
      }
      return { n, yuanYin: ji.get(ming)!.yuanYin, gangTingYong };
    },
    shiFouTingYong(sessionId, tool) {
      return !!tingYongBiao.get(key(sessionId))?.has(String(tool || ''));
    },
    ciShu(sessionId, tool) {
      return ciShuBiao.get(key(sessionId))?.get(String(tool || ''))?.n || 0;
    },
    yuanYin(sessionId, tool) {
      return ciShuBiao.get(key(sessionId))?.get(String(tool || ''))?.yuanYin || '';
    },
    chongZhi(sessionId) {
      const k = key(sessionId);
      ciShuBiao.delete(k);
      tingYongBiao.delete(k);
    },
  };
}
