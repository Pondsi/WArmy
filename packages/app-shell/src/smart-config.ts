/**
 * smart-config —— **智能配置文件**（`zhinengpeizhi.md`，落在 userData）。
 *
 * 产品要求（本轮）：
 *   ① 判定「用哪个模型、用哪档思考」的依据不是**紧急度**，而是**重要程度 + 复杂度**；
 *   ② 分类模型判定时要**看这个文件**作为依据（历史质量记录）；
 *   ③ 归档/整理摘要时，模型把「什么模型 / 什么思考级别 / 处理什么问题 / 质量如何」写进来；
 *   ④ 用户在对话上的**赞/踩**也先简单记进来，归档时再整理分析；取消赞/踩要**删掉**那条记录；
 *   ⑤ 归档时把文件**整理成更容易被 AI 阅读**的结构。
 *
 * 文件名：`zhinengpeizhi.md`（产品要求：不带中文，方便各种工具/脚本稳定引用）。
 * 文件形态：Markdown（AI 最好读），分节 + 条目追加；整理时重排成表格/小节。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 文件名（产品要求改成全拼音，避免中文路径在工具链里出问题） */
export const ZHI_NENG_PEI_ZHI_MING = 'zhinengpeizhi.md';

export interface ZhiNengPeiZhiLu {
  /** 追加一条原始记录（先简单记，不分析） */
  tianJia(mu: {
    lei: 'model-quality' | 'user-vote' | 'archive-note';
    moXing?: string;
    siKaoDang?: string;
    wenTi?: string;
    zhiLiang?: string;
    zanCai?: 'up' | 'down' | 'cancel';
    huiHua?: string;
    beiZhu?: string;
  }): void;
  du(): string;
  /**
   * **取消赞/踩**（产品要求）：把这条用户评价从文件里**删掉**，
   * 不是再记一条"取消"（否则归档时会被当成两次评价）。
   */
  shanChu(mao: { huiHua?: string; moXing?: string; wenTi?: string }): { ok: boolean; shanLe: number };
  /** 归档时整理：把散条目重排成「按模型分组的质量表 + 用户评价小结」，更容易被 AI 读 */
  zhengLi(): { ok: boolean; hangShu: number; error?: string };
  luJing: string;
}

const TOU = `# 智能配置（AI 可读的质量与偏好档案）

> 本文件由系统自动维护：分类模型在**判定用哪个模型/哪档思考**之前会先读它；
> 归档与用户评价会往里写。整理后按「模型 → 问题类型 → 质量」分组，便于检索。

## 怎么用（给 AI）
- 判定模型/思考级别时：看下面「质量记录」里**同类型问题**在哪个模型、哪档思考上质量最好。
- 重要程度高 / 复杂度高的问题 ⇒ 优先选质量记录里表现好的**高级模型 + 高思考**；
- 简单/低价值问题 ⇒ 选便宜的模型、低思考或不思考。
- 不要臆造记录里没有的质量结论。

## 质量记录
`;

function hang(mu: {
  lei: string; moXing?: string; siKaoDang?: string; wenTi?: string;
  zhiLiang?: string; zanCai?: string; huiHua?: string; beiZhu?: string;
}): string {
  const t = new Date().toISOString();
  const bu: string[] = [`- [${t}] ${mu.lei}`];
  if (mu.moXing) bu.push(`模型=${mu.moXing}`);
  if (mu.siKaoDang) bu.push(`思考=${mu.siKaoDang}`);
  if (mu.wenTi) bu.push(`问题=${String(mu.wenTi).slice(0, 120)}`);
  if (mu.zhiLiang) bu.push(`质量=${mu.zhiLiang}`);
  if (mu.zanCai) bu.push(`用户评价=${mu.zanCai === 'up' ? '赞' : mu.zanCai === 'down' ? '踩' : '取消'}`);
  if (mu.huiHua) bu.push(`会话=${mu.huiHua}`);
  if (mu.beiZhu) bu.push(`备注=${String(mu.beiZhu).slice(0, 160)}`);
  return bu.join(' · ');
}

export function daKaiZhiNengPeiZhi(userDataDir: string): ZhiNengPeiZhiLu {
  const lu = path.join(userDataDir, ZHI_NENG_PEI_ZHI_MING);
  /** 旧名迁移（`智能配置.md` → `zhinengpeizhi.md`）：已有的记录不能丢 */
  try {
    const jiu = path.join(userDataDir, '智能配置.md');
    if (!fs.existsSync(lu) && fs.existsSync(jiu)) fs.renameSync(jiu, lu);
  } catch { /* 迁移失败就当新文件处理 */ }
  const bao = () => {
    try {
      if (!fs.existsSync(lu)) fs.writeFileSync(lu, TOU, 'utf8');
    } catch { /* 只读目录：返回内存态 */ }
  };
  return {
    luJing: lu,
    du(): string {
      try { return fs.existsSync(lu) ? fs.readFileSync(lu, 'utf8') : TOU; } catch { return TOU; }
    },
    tianJia(mu) {
      try {
        bao();
        fs.appendFileSync(lu, hang(mu) + '\n', 'utf8');
      } catch { /* 写不进就算了（磁盘只读），不阻断主流程 */ }
    },
    shanChu(mao) {
      try {
        if (!fs.existsSync(lu)) return { ok: true, shanLe: 0 };
        const yuan = fs.readFileSync(lu, 'utf8').split('\n');
        const out: string[] = [];
        let shan = 0;
        for (const x of yuan) {
          if (x.startsWith('- [') && x.includes('user-vote')) {
            const tong = (!mao.huiHua || x.includes(`会话=${mao.huiHua}`))
              && (!mao.moXing || x.includes(`模型=${mao.moXing}`))
              && (!mao.wenTi || x.includes(String(mao.wenTi).slice(0, 40)));
            if (tong) { shan++; continue; }
          }
          out.push(x);
        }
        if (shan) fs.writeFileSync(lu, out.join('\n'), 'utf8');
        return { ok: true, shanLe: shan };
      } catch (e) { return { ok: false, shanLe: 0 }; }
    },
    zhengLi() {
      try {
        const yuan = fs.existsSync(lu) ? fs.readFileSync(lu, 'utf8') : TOU;
        const tiao = yuan.split('\n').filter((x) => x.startsWith('- ['));
        if (!tiao.length) return { ok: true, hangShu: 0 };
        /** 按模型分组；模型未知的归到「未标注」 */
        const zu = new Map<string, string[]>();
        for (const t of tiao) {
          const m = /模型=([^ ·]+)/.exec(t);
          const k = (m && m[1]) ? String(m[1]) : '未标注';
          if (!zu.has(k)) zu.set(k, []);
          zu.get(k)!.push(t);
        }
        const out: string[] = [TOU.split('## 质量记录')[0]!.trimEnd(), '', '## 质量记录（已整理：按模型分组）', ''];
        for (const [mo, ji] of [...zu.entries()].sort((a, b) => b[1].length - a[1].length)) {
          out.push(`### ${mo}（${ji.length} 条）`);
          // 赞/踩小结：一并放在组头，AI 一眼看到这个模型的口碑
          const zan = ji.filter((x) => x.includes('用户评价=赞')).length;
          const cai = ji.filter((x) => x.includes('用户评价=踩')).length;
          if (zan || cai) out.push(`- 用户评价小结：赞 ${zan} / 踩 ${cai}`);
          out.push(...ji.slice(-40));
          out.push('');
        }
        const shu = out.join('\n').trimEnd() + '\n';
        fs.writeFileSync(lu, shu, 'utf8');
        return { ok: true, hangShu: tiao.length };
      } catch (e) { return { ok: false, hangShu: 0, error: String(e) }; }
    },
  };
}
