/**
 * subagents —— 让牛马在执行任务时**自行分出子代理**（"小弟 X 号"）。
 *
 * 产品语义：每只牛马干活时可以拉起子代理，名字固定为「牛马的名字 + 小弟X号」：
 *   牛马「阿黄」→ 阿黄-小弟1号 / 阿黄-小弟2号 / …
 *
 * 设计约束
 * ---------------------------------------------------------------------------
 *  1. **纯函数命名**：`xiaDiHao()` 只做编号与命名，可无头断言（换窗口/重启编号可续）。
 *  2. **有界**：每个父牛马的子代理数量有上限（防爆炸）；同名不重复。
 *  3. **可审计**：每次派出返回结构化记录（id/名字/父/时间），由调用方写审计。
 *  4. **不越权**：子代理与父代理共用同一个会话工作区沙箱（见 work-tools），
 *     不额外获得任何文件/命令权限。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 单个父牛马最多能有多少个小弟 */
export const XIAO_DI_SHANG_XIAN = 32;

export interface XiaoDiJiLu {
  id: string;
  /** 形如「阿黄-小弟3号」 */
  ming: string;
  /** 父牛马的名字 */
  fuMing: string;
  /** 第几号（1 起） */
  hao: number;
  createdAt: number;
}

/** 从已有名字里挑出下一个编号（1 起；跳过已占用） */
export function xiaYiHao(existing: string[], fuMing: string): number {
  const yong = new Set<number>();
  const qianZhui = `${fuMing}-小弟`;
  for (const n of existing || []) {
    const s = String(n || '');
    if (!s.startsWith(qianZhui)) continue;
    const m = /-小弟(\d+)号$/.exec(s);
    if (m) yong.add(Number(m[1]));
  }
  let hao = 1;
  while (yong.has(hao)) hao += 1;
  return hao;
}

/** 生成子代理名：`<父名>-小弟<N>号` */
export function xiaDiHao(fuMing: string, existing: string[] = []): { hao: number; ming: string } | { error: string } {
  const fu = String(fuMing || '').trim();
  if (!fu) return { error: 'empty-parent-name' };
  if ((existing || []).length >= XIAO_DI_SHANG_XIAN) return { error: `too-many-subagents (${XIAO_DI_SHANG_XIAN})` };
  const hao = xiaYiHao(existing, fu);
  return { hao, ming: `${fu}-小弟${hao}号` };
}

/** 列出某父牛马名下的小弟（按编号升序） */
export function lieBiaoXiaoDi(all: XiaoDiJiLu[], fuMing: string): XiaoDiJiLu[] {
  return (all || [])
    .filter((x) => x && x.fuMing === fuMing)
    .sort((a, b) => a.hao - b.hao);
}

/** 持久化登记簿（JSON 文件）；进程内单例由调用方决定 */
export class XiaoDiDengJiBu {
  private items: XiaoDiJiLu[] = [];
  constructor(private file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(j.items)) this.items = j.items;
    } catch {
      /* fresh */
    }
  }
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2), 'utf8');
    } catch { /* 写不进也不抛：命名仍然可用，只是重启后可能重复编号 */ }
  }
  list(fuMing: string): XiaoDiJiLu[] {
    return lieBiaoXiaoDi(this.items, fuMing);
  }
  /** 派一个新小弟；成功返回记录，失败返回 error（不抛错） */
  pai(fuMing: string, at = Date.now()): { ok: true; lu: XiaoDiJiLu } | { ok: false; error: string } {
    const fu = String(fuMing || '').trim();
    if (!fu) return { ok: false, error: 'empty-parent-name' };
    const old = this.list(fu).map((x) => x.ming);
    const r = xiaDiHao(fu, old);
    if ('error' in r) return { ok: false, error: r.error };
    const lu: XiaoDiJiLu = {
      id: `xiaoDi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ming: r.ming,
      fuMing: fu,
      hao: r.hao,
      createdAt: at,
    };
    this.items.push(lu);
    this.save();
    return { ok: true, lu };
  }
}

/** 子代理工具规格（暴露给模型的 function calling 形态） */
export function xiaoDiToolSpecs(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return [
    {
      type: 'function',
      function: {
        name: 'spawn_subagent',
        description:
          '派一个子代理（小弟）去独立完成一个子任务，名字会是「你的名字-小弟N号」。' +
          '适合把大任务拆开并行做；子任务做完会把结论回传给你。子代理与你共用同一个工作区。',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '要交给小弟去做的**一件具体的事**（写清楚交付物）' },
            title: { type: 'string', description: '给这个子任务起的短名（可选）' },
          },
          required: ['task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_subagents',
        description: '列出你自己已经派出过的小弟（名字与编号）。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}

export function isXiaoDiTool(name: unknown): boolean {
  return name === 'spawn_subagent' || name === 'list_subagents';
}
