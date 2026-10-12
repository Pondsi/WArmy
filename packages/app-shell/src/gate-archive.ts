/**
 * gate-archive —— **门禁结果留档**。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：门禁跑完只在审计里留一条 `gate.run`，界面上闪一下 PASS/FAIL 就没了。
 * 于是"这支门禁是**一直红**还是**这次才红**"、"我改的东西有没有让它从绿变红"
 * 完全看不出来 —— 一次性结果对排查几乎没用，**趋势**才有用。
 *
 * 做法：每跑一次追加一行 JSONL（时间 / 名称 / 结果 / 耗时 / 退出码 / 输出尾巴），
 * 读的时候回最近 N 条并算出**趋势**（最近一次是否为"由绿转红"、连续红几次）。
 * 纯 Node、纯函数（路径由调用方给）—— 门禁可无头断言。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface MenJinJiLu {
  ts: number;
  /** 门禁标识（硬门禁是 id；软门禁是用户起的名字） */
  id: string;
  /** 实际跑的脚本相对/绝对路径 */
  script: string;
  cmd: string;
  pass: boolean;
  /** 退出码；超时为 null */
  code: number | null;
  timeout: boolean;
  ms: number;
  /** 硬门禁 / 软门禁 */
  kind: 'hard' | 'soft';
  /** 输出尾巴（截断，便于回溯失败原因） */
  tail: string;
}

/** 追加一条记录（目录不存在会建）；超过 maxLines 时裁掉最老的 */
export function jiLuMenJin(file: string, rec: MenJinJiLu, maxLines = 500): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > maxLines) {
      fs.writeFileSync(file, lines.slice(-maxLines).join('\n') + '\n', 'utf8');
    }
  } catch {
    /* 留档失败**不许**影响门禁本身的结果返回 */
  }
}

/** 读最近 n 条（新的在前）；坏行跳过，不整体失败 */
export function duMenJinLiShi(file: string, n = 30): MenJinJiLu[] {
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const out: MenJinJiLu[] = [];
    for (const l of lines.slice(-Math.max(1, n * 3))) {
      try {
        const o = JSON.parse(l) as MenJinJiLu;
        if (o && typeof o.ts === 'number' && typeof o.id === 'string') out.push(o);
      } catch { /* 坏行跳过 */ }
    }
    return out.slice(-n).reverse();
  } catch {
    return [];
  }
}

export interface MenJinQuShi {
  id: string;
  /** 最近一次结果 */
  last?: MenJinJiLu;
  /** 最近一次是否**由绿转红**（上一条绿、这一条红） */
  justBroke: boolean;
  /** 当前连续红了几次 */
  consecutiveFail: number;
  /** 观测窗口内总次数 / 通过次数 */
  total: number;
  passN: number;
}

/** 按门禁算趋势（用于界面把"一直红"和"刚变红"分开显示） */
export function menJinQuShi(records: MenJinJiLu[]): MenJinQuShi[] {
  const byId = new Map<string, MenJinJiLu[]>();
  // records 是"新的在前"，这里转成"老→新"再做趋势
  for (const r of [...records].reverse()) {
    const arr = byId.get(r.id) || [];
    arr.push(r);
    byId.set(r.id, arr);
  }
  const out: MenJinQuShi[] = [];
  for (const [id, arr] of byId) {
    const last = arr[arr.length - 1];
    let consecutiveFail = 0;
    for (let i = arr.length - 1; i >= 0 && !arr[i]!.pass; i--) consecutiveFail++;
    const prev = arr.length >= 2 ? arr[arr.length - 2] : undefined;
    out.push({
      id,
      last,
      justBroke: !!(last && prev && prev.pass && !last.pass),
      consecutiveFail,
      total: arr.length,
      passN: arr.filter((x) => x.pass).length,
    });
  }
  // 由绿转红的排最前（最该被看见），其余按最近时间倒序
  return out.sort((a, b) => {
    if (a.justBroke !== b.justBroke) return a.justBroke ? -1 : 1;
    return (b.last?.ts || 0) - (a.last?.ts || 0);
  });
}
