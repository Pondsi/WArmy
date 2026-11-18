/**
 * R260 项「进化实验分析」：A/B 支线实验指标统计报告（可量化自改进）。
 *
 * 输入一次自进化实验（双臂 A/B 的回合/文件 + 逐条验收差异），输出：
 *  · 每臂：回合数、文件数、pass/fail/unknown 计数、通过率（pass/(pass+fail)，unknown 不计入分母）；
 *  · 文件差异：仅 A 有 / 仅 B 有的文件；
 *  · 推荐：客观模式按通过率（高者胜）→ 平手看回合（少者胜）→ 仍平手 null（交主观/用户）；
 *  · 一段可读报告。纯函数、不臆造（unknown 如实计入，不当 pass）。
 */

export interface FenXiShuRu {
  mode?: 'objective' | 'subjective';
  arms: Record<'A' | 'B', { turns?: number; files?: string[] }>;
  checks: Array<{ arm: 'A' | 'B'; outcome: 'pass' | 'fail' | 'unknown' }>;
  winner?: 'A' | 'B';
}
export interface BiTongJi { turns: number; fileCount: number; pass: number; fail: number; unknown: number; passRate: number | null }
export interface FenXiBaoGao {
  arms: Record<'A' | 'B', BiTongJi>;
  jinA: string[]; jinB: string[];
  tuiJian: 'A' | 'B' | null;
  liYou: string;
  baoGao: string;
}

function tongJi(arm: { turns?: number; files?: string[] } | undefined, checks: FenXiShuRu['checks'], zhi: 'A' | 'B'): BiTongJi {
  const ben = (checks || []).filter((c) => c.arm === zhi);
  const pass = ben.filter((c) => c.outcome === 'pass').length;
  const fail = ben.filter((c) => c.outcome === 'fail').length;
  const unknown = ben.filter((c) => c.outcome === 'unknown').length;
  const fenMu = pass + fail;
  return {
    turns: Number(arm?.turns || 0),
    fileCount: Array.isArray(arm?.files) ? arm!.files!.length : 0,
    pass, fail, unknown,
    passRate: fenMu > 0 ? pass / fenMu : null,
  };
}

export function fenXiShiYan(shuRu: FenXiShuRu): FenXiBaoGao {
  const A = tongJi(shuRu.arms?.A, shuRu.checks, 'A');
  const B = tongJi(shuRu.arms?.B, shuRu.checks, 'B');
  const filesA = new Set(shuRu.arms?.A?.files || []);
  const filesB = new Set(shuRu.arms?.B?.files || []);
  const jinA = [...filesA].filter((f) => !filesB.has(f)).sort();
  const jinB = [...filesB].filter((f) => !filesA.has(f)).sort();
  let tuiJian: 'A' | 'B' | null = null;
  let liYou = '';
  if (shuRu.mode === 'subjective') {
    tuiJian = shuRu.winner || null;
    liYou = tuiJian ? `主观模式：沿用已选 ${tuiJian}` : '主观模式：待用户/模型评判';
  } else if (A.passRate !== null && B.passRate !== null && A.passRate !== B.passRate) {
    tuiJian = A.passRate > B.passRate ? 'A' : 'B';
    liYou = `客观通过率 ${tuiJian} 更高（A=${(A.passRate * 100).toFixed(0)}% / B=${(B.passRate * 100).toFixed(0)}%）`;
  } else if (A.turns !== B.turns) {
    tuiJian = A.turns < B.turns ? 'A' : 'B';
    liYou = `通过率相同，${tuiJian} 回合更少（A=${A.turns} / B=${B.turns}）`;
  } else {
    tuiJian = shuRu.winner || null;
    liYou = tuiJian ? `指标持平，沿用已选 ${tuiJian}` : '指标持平，需主观/用户裁决';
  }
  const fmt = (z: 'A' | 'B', t: BiTongJi) => `${z}: 回合${t.turns} 文件${t.fileCount} 通过${t.pass}/失败${t.fail}/未知${t.unknown} 通过率${t.passRate === null ? '—' : (t.passRate * 100).toFixed(0) + '%'}`;
  const baoGao = `进化实验分析\n${fmt('A', A)}\n${fmt('B', B)}\n`
    + (jinA.length ? `仅A有文件：${jinA.join('、')}\n` : '')
    + (jinB.length ? `仅B有文件：${jinB.join('、')}\n` : '')
    + `推荐：${tuiJian || '无（持平）'}（${liYou}）`;
  return { arms: { A, B }, jinA, jinB, tuiJian, liYou, baoGao };
}