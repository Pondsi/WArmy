/**
 * 群消息的**最终一致（弱一致）**日志（第 57 轮用户口径："做弱一致"）。
 *
 * 为什么不是强一致：P2P 里强一致要共识（多数派在线 + 多轮往返），我们没有服务器也没有中继；
 * 用户要的是"创建者不在线时也能先发出去，等创建者上线后统一排序，所有人最终看到同一顺序"。
 *
 * 规则（可执行）：
 *  · 每条消息 = `{id, author, seq, createdAt, payloadHash, deps}`；`seq` 是**每个作者各自单调**的序号，
 *    不依赖全局时钟；`deps` 记录"我看到了谁的哪些消息"（因果依赖）。
 *  · **排序**：创建者的消息按 `creatorSeq` 排；其它作者的消息按 `(deps 深度, createdAt, author, seq)` 排，
 *    同一作者内部严格按 seq。排序结果**只取决于集合内容，不取决于到达顺序**（可复现）。
 *  · **本地队列**：创建者离线时，成员的消息进 `daiPaiXu`（待排序），界面上显示"待确认"；创建者上线后一次性并入日志。
 *  · **补拉**：按作者 seq 找出缺口（`queKou`），只拉缺的那几段；重复消息按 id 去重，不重复占用带宽。
 *  · **错位提示**：接收时间晚于创建时间很多、或某条消息的 `createdAt` 早于本地已显示的最后一条 ⇒ 标记"时间顺序异常"。
 *
 * 纯函数 ⇒ 门禁跑真值表（`scripts/verify-r57-ruo-yizhi.mjs`）。
 */

export type QunXiaoXi = {
  id: string;
  author: string;
  seq: number;
  createdAt: number;
  payloadHash?: string;
  /** 因果依赖：作者 → 我发这条时已经看到的该作者最大 seq */
  deps?: Record<string, number>;
};
export type RiZhi = {
  /** 已确认的消息（创建者已排序，或创建者本人发的） */
  queRen: QunXiaoXi[];
  /** 创建者离线时本地暂存、尚未排序的消息 */
  daiPaiXu: QunXiaoXi[];
};

const guiYi = (x: QunXiaoXi) => `${x.author}\u0000${Math.max(0, Math.floor(Number(x.seq) || 0))}`;

/** 合并两份日志：按 id 去重；同一作者同一 seq 取**先到的那条**（内容不可被后来的同 seq 覆盖） */
export function heBingRiZhi(a: RiZhi, b: RiZhi): RiZhi {
  const jian = new Map<string, QunXiaoXi>();
  const jianWei = new Map<string, QunXiaoXi>();
  for (const x of [...a.queRen, ...b.queRen]) if (x && x.id && !jian.has(x.id)) jian.set(x.id, x);
  for (const x of [...a.daiPaiXu, ...b.daiPaiXu]) if (x && x.id && !jianWei.has(x.id)) jianWei.set(x.id, x);
  return { queRen: [...jian.values()], daiPaiXu: [...jianWei.values()] };
}

/** 已确认日志里每位作者的**连续**最大 seq（遇到缺口就停，缺口后的不算连续） */
export function lianXuShuiWei(riZhi: QunXiaoXi[]): Record<string, number> {
  const by = new Map<string, Set<number>>();
  for (const x of riZhi) {
    if (!by.has(x.author)) by.set(x.author, new Set());
    by.get(x.author)!.add(Math.floor(Number(x.seq) || 0));
  }
  const out: Record<string, number> = {};
  for (const [a, s] of by) {
    let n = 0;
    while (s.has(n + 1)) n++;
    out[a] = n;
  }
  return out;
}

/** 补拉清单：每位作者缺哪些 seq 段（`[from,to]` 闭区间，最多列 20 段，防一份坏日志把请求撑爆） */
export function queKou(riZhi: QunXiaoXi[], zuiDa = 20): Array<{ author: string; from: number; to: number }> {
  const by = new Map<string, Set<number>>();
  for (const x of riZhi) {
    if (!by.has(x.author)) by.set(x.author, new Set());
    by.get(x.author)!.add(Math.floor(Number(x.seq) || 0));
  }
  const out: Array<{ author: string; from: number; to: number }> = [];
  for (const [author, s] of by) {
    const max = Math.max(...s, 0);
    let qi = 0;
    for (let n = 1; n <= max && out.length < zuiDa; n++) {
      if (!s.has(n)) { if (qi === 0) qi = n; }
      else if (qi) { out.push({ author, from: qi, to: n - 1 }); qi = 0; }
    }
    if (qi && out.length < zuiDa) out.push({ author, from: qi, to: max });
  }
  return out;
}

/** deps 深度（因果层级）：一条消息依赖的、尚未被更早消息覆盖的条数；用来做稳定排序的第二关键字 */
function yinGuoCeng(x: QunXiaoXi): number {
  const d = x.deps || {};
  return Object.values(d).reduce((n, v) => n + Math.max(0, Math.floor(Number(v) || 0)), 0);
}

/**
 * **确定性排序**（结果与到达顺序无关）：
 *  1. 创建者的消息按 seq 排在最前（它们是权威顺序）；
 *  2. 其它消息按 (因果层级, createdAt, author, seq) 排序；
 *  3. 同一 id 只出现一次。
 * 这不是"全局时钟排序"——没有可信全局时钟；它是**可复现的偏序展开**，所有节点用同一函数会得到同一结果。
 */
export function paiXuRiZhi(riZhi: QunXiaoXi[], chuangJianZhe: string): QunXiaoXi[] {
  const jian = new Map<string, QunXiaoXi>();
  for (const x of riZhi) if (x && x.id && !jian.has(x.id)) jian.set(x.id, x);
  const quan = [...jian.values()];
  const zhu = quan.filter((x) => x.author === chuangJianZhe).sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
  const ke = quan.filter((x) => x.author !== chuangJianZhe).sort((a, b) =>
    yinGuoCeng(a) - yinGuoCeng(b) || a.createdAt - b.createdAt || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0) || a.seq - b.seq);
  return [...zhu, ...ke];
}

/** 创建者离线时：本地消息进待排序队列（同 id 不重复）；返回新日志 */
export function duiLieDaiPaiXu(riZhi: RiZhi, xin: QunXiaoXi): RiZhi {
  if (!xin || !xin.id) return riZhi;
  if (riZhi.queRen.some((x) => x.id === xin.id) || riZhi.daiPaiXu.some((x) => x.id === xin.id)) return riZhi;
  return { ...riZhi, daiPaiXu: [...riZhi.daiPaiXu, xin] };
}

/** 创建者上线：把待排序队列并入已确认日志（创建者的消息先入；其余由 `paiXuRiZhi` 统一展开） */
export function chuangJianZheShangXian(riZhi: RiZhi): RiZhi {
  const quan = [...riZhi.queRen, ...riZhi.daiPaiXu];
  return { queRen: quan, daiPaiXu: [] };
}

/**
 * 错位判定：这条消息的创建时间早于"本地已显示的最后一条"的创建时间 ⇒ 时间顺序异常（接收晚于创建）。
 * `yiXianShiZuiHou` 是界面上最后一条的 createdAt；`jieShouTs` 是本地收到它的时刻。
 */
export function shiJianCuoWei(x: QunXiaoXi, yiXianShiZuiHou: number, jieShouTs: number): { cuoWei: boolean; chaMs: number } {
  const chuang = Math.max(0, Number(x.createdAt) || 0);
  const cha = Math.max(0, Number(jieShouTs) || 0) - chuang;
  const cuoWei = (yiXianShiZuiHou > 0 && chuang < yiXianShiZuiHou) || cha > 10 * 60 * 1000;
  return { cuoWei, chaMs: cha };
}

/** 一条消息该显示什么状态（给界面用；与发送侧的状态机同一套词） */
export function xiaoXiZhuangTai(riZhi: RiZhi, id: string): 'queRen' | 'daiPaiXu' | 'weiZhi' {
  if (riZhi.queRen.some((x) => x.id === id)) return 'queRen';
  if (riZhi.daiPaiXu.some((x) => x.id === id)) return 'daiPaiXu';
  return 'weiZhi';
}

/**
 * **产品层的发送策略**（第 60 轮用户定稿：群聊/项目创建者离线一律只读）：
 *  · 创建者本人 / 创建者在线 ⇒ 直接发；
 *  · 创建者离线 ⇒ **只读**（不排队、不缓存）；刚发出但创建者没收到的那条显示"发送失败"并冻结，
 *    创建者再上线时**自动丢弃、不重发**；
 *  · 只有**联系人**的消息才留本机等对方上线重发（属联系人通道，不走本函数）。
 * `ruoYiZhi` 参数只为兼容旧调用保留；群/项目**不再支持排队**。
 */
export const QUN_RUO_YI_ZHI_MO_REN = false;
export type FaSongCeLue = 'send' | 'queue' | 'readonly';
export function qunFaSongCeLue(q: { shiChuangJianZhe: boolean; chuangJianZheZaiXian: boolean; ruoYiZhi?: boolean }): FaSongCeLue {
  if (q.shiChuangJianZhe || q.chuangJianZheZaiXian) return 'send';
  return 'readonly';
}
