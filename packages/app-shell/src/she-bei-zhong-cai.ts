/**
 * R275 设备仲裁（扬声器/麦克风/摄像头）：会话优先于拟态；多会话之间激活窗口优先。
 *
 * 口径（主人定稿）：
 *  · 会话界面要用扬声器/麦克风/摄像头时优先级高于拟态；拟态正在用 ⇒ 让出；会话用完 ⇒ 还回拟态。
 *  · 多个会话争同一设备 ⇒ 窗口处于激活（焦点）状态的会话优先。
 *  · 同级（都未激活/都激活不可能）按申请先后 FIFO。
 *
 * 纯逻辑、可单测：主进程负责把事件发给对应窗口、把焦点/关窗喂进来。
 * 让出是协作式的：持有者收到 revoke 后必须停止使用设备；归还时 resume=true 表示"恢复此前被抢的使用"。
 */
export type SheBeiLei = 'mic' | 'speaker' | 'camera';
export const SHE_BEI_JI: SheBeiLei[] = ['mic', 'speaker', 'camera'];

export interface SheBeiZhu {
  kind: 'session' | 'mimic';
  /** 会话 id（拟态为空串）；仅展示用，仲裁键是窗口 */
  sid: string;
  winId: number;
  ts: number;
}
export interface SheBeiShiJian {
  device: SheBeiLei;
  type: 'grant' | 'revoke' | 'wait' | 'release';
  winId: number;
  /** grant 且此前被抢过 ⇒ true（拟态恢复录音/补播、会话继续等待的动作） */
  resume: boolean;
  holderKind: 'session' | 'mimic' | '';
  holderSid: string;
}
export interface SheBeiZhuangTai {
  holder: SheBeiZhu | null;
  deng: SheBeiZhu[];
}

const tongWin = (a: SheBeiZhu, b: SheBeiZhu): boolean => a.winId === b.winId && a.kind === b.kind;

export class SheBeiZhongCai {
  private biao = new Map<SheBeiLei, { holder: SheBeiZhu | null; deng: SheBeiZhu[] }>();
  private jiaoDian = new Set<number>();
  /** 被抢让出过的持有者键（winId:kind）⇒ 归还时 resume=true */
  private beiQiang = new Set<string>();
  constructor(private faShiJian: (ev: SheBeiShiJian) => void) {}

  private ge(device: SheBeiLei): { holder: SheBeiZhu | null; deng: SheBeiZhu[] } {
    let g = this.biao.get(device);
    if (!g) { g = { holder: null, deng: [] }; this.biao.set(device, g); }
    return g;
  }
  private keyOf(z: SheBeiZhu): string { return z.winId + ':' + z.kind; }
  youXian(z: SheBeiZhu): number {
    if (z.kind === 'mimic') return 1;
    return this.jiaoDian.has(z.winId) ? 3 : 2;
  }
  private paiXu(pool: SheBeiZhu[]): SheBeiZhu[] {
    return pool.slice().sort((a, b) => (this.youXian(b) - this.youXian(a)) || (a.ts - b.ts));
  }
  private fa(device: SheBeiLei, type: SheBeiShiJian['type'], z: SheBeiZhu, resume: boolean, holder: SheBeiZhu | null): void {
    try {
      this.faShiJian({ device, type, winId: z.winId, resume, holderKind: holder ? holder.kind : '', holderSid: holder ? holder.sid : '' });
    } catch { /* 发事件失败不影响仲裁态 */ }
  }
  /** 重排：优先级最高者持有，其余排队；持有者变化 ⇒ 旧持有者收 revoke、新持有者收 grant */
  private chongPai(device: SheBeiLei): void {
    const g = this.ge(device);
    const pool = g.holder ? [g.holder, ...g.deng] : [...g.deng];
    if (!pool.length) { g.holder = null; g.deng = []; return; }
    const pai = this.paiXu(pool);
    const xin = pai[0]!;
    const qiYu = pai.slice(1);
    const jiu = g.holder;
    g.deng = qiYu;
    if (jiu && tongWin(jiu, xin)) { g.holder = jiu; return; }
    if (jiu) {
      this.beiQiang.add(this.keyOf(jiu));
      g.holder = null;
      this.fa(device, 'revoke', jiu, false, xin);
    }
    g.holder = xin;
    const k = this.keyOf(xin);
    const resume = this.beiQiang.has(k);
    this.beiQiang.delete(k);
    this.fa(device, 'grant', xin, resume, xin);
  }
  /** 申请使用：立即持有或排队（wait 事件）。同窗同kind重复申请＝刷新 sid，不重排优先级 */
  claim(device: SheBeiLei, z: SheBeiZhu): SheBeiZhuangTai {
    if (!SHE_BEI_JI.includes(device)) return this.zhuangTai(device);
    const g = this.ge(device);
    if (g.holder && tongWin(g.holder, z)) { g.holder = { ...g.holder, sid: z.sid }; return this.zhuangTai(device); }
    g.deng = g.deng.filter((x) => !tongWin(x, z));
    g.deng.push(z);
    const jiuHolder = g.holder;
    this.chongPai(device);
    const hou = this.ge(device).holder;
    if (hou && tongWin(hou, z)) return this.zhuangTai(device);
    /* 没拿到 ⇒ 告知排队（持有者未变时也发，界面提示"正被谁用"） */
    this.fa(device, 'wait', z, false, hou || jiuHolder);
    return this.zhuangTai(device);
  }
  /** 用完释放：持有者释放 ⇒ 队首接管（被抢过的拟态/会话拿回 resume=true） */
  release(device: SheBeiLei, winId: number, kind: 'session' | 'mimic'): SheBeiZhuangTai {
    const g = this.ge(device);
    if (g.holder && g.holder.winId === winId && g.holder.kind === kind) {
      this.fa(device, 'release', g.holder, false, g.holder);
      this.beiQiang.delete(this.keyOf(g.holder));
      g.holder = null;
      this.chongPai(device);
    } else {
      g.deng = g.deng.filter((x) => !(x.winId === winId && x.kind === kind));
    }
    return this.zhuangTai(device);
  }
  /** 窗口焦点变化：激活会话优先级升高 ⇒ 可能从非激活持有者手里抢过来 */
  focus(winId: number, on: boolean): void {
    if (on) this.jiaoDian.add(winId); else this.jiaoDian.delete(winId);
    for (const d of SHE_BEI_JI) this.chongPai(d);
  }
  /** 窗口关闭：释放它的一切持有与排队 */
  closed(winId: number): void {
    this.jiaoDian.delete(winId);
    for (const d of SHE_BEI_JI) {
      const g = this.ge(d);
      const youGuan = (g.holder && g.holder.winId === winId) || g.deng.some((x) => x.winId === winId);
      if (!youGuan) continue;
      if (g.holder && g.holder.winId === winId) { this.fa(d, 'release', g.holder, false, g.holder); this.beiQiang.delete(this.keyOf(g.holder)); g.holder = null; }
      g.deng = g.deng.filter((x) => x.winId !== winId);
      this.chongPai(d);
    }
  }
  zhuangTai(device: SheBeiLei): SheBeiZhuangTai {
    const g = this.ge(device);
    return { holder: g.holder ? { ...g.holder } : null, deng: g.deng.map((x) => ({ ...x })) };
  }
  /** media 权限判定：该窗口此刻是否被允许打开对应采集设备 */
  yunXuCaiJi(winId: number, kind: 'session' | 'mimic', device: SheBeiLei): boolean {
    const g = this.ge(device);
    if (!g.holder) return true; /* 还没人申请（探测/枚举）⇒ 放行，真正使用前会 claim */
    return g.holder.winId === winId && g.holder.kind === kind;
  }
}
