/**
 * xian-liu.ts —— **rpm / tpm 限流**（第 39 轮，对齐 CrewAI `max_rpm` 与 Hermes 的 provider 额度处理）
 *
 * 为什么放在 providers 层而不是主进程里：这样能被**单独测**（假时钟 + 假 provider），
 * 不用起 Electron —— 限流这种东西用字符串锚点断言毫无价值，必须跑到出结果。
 *
 * 口径（三条都是刻意的）：
 *  ① **60 秒滑动窗口**，不是"每分钟重置一次"的令牌桶 —— 后者在窗口交界处能放过 2 倍的量；
 *  ② 发之前先**估**（提示词字符 ÷ 1.6 + 本次要的输出上限），发完后按 `usage` **校正**成真实值
 *     （估计偏大就退款，偏小就补记 ⇒ 不会因为一次猜错就一直错下去）；
 *  ③ 超限时**等待**而不是报错（CrewAI 也是 sleep/节流）：等最早的那几条滑出窗口；
 *     最多等 `zuiDaDengMs`（默认 120 秒），等不到就**照发并留审计** ——
 *     用户要的是把活干完，不是被一个我们自己设的软限制卡死在那儿。
 */
import type { LiaoTianPian, LiaoTianQingQiu, LiaoTianXiangYing, MoxingGongYing } from './types.js';

const FEN_ZHONG_MS = 60_000;
const ZI_PER_TOKEN = 1.6;

export interface XianLiuPeiZhi {
  /** 每分钟请求数（0/不给 = 这一路不限） */
  rpm?: number;
  /** 每分钟 token 数（0/不给 = 这一路不限） */
  tpm?: number;
  /** 拿不到额度时**必须传进来**（由宿主按模型算），这里不做猜测 */
  zuiDaDengMs?: number;
  /** 可注入的时钟（测试用） */
  now?: () => number;
}

export interface XianLiuPanDuan {
  keyi: boolean;
  /** 不同意时要等多久（毫秒）才腾出位置 */
  yaoDengMs: number;
  yuanYin: 'rpm' | 'tpm' | '';
  dangQianCi: number;
  dangQianToken: number;
}

/** 一条 60 秒滑动窗口上的计数器（请求数 + token 数共用同一条时间轴） */
export class HuaChuangXianLiu {
  private ci: number[] = [];
  private zi: Array<{ t: number; n: number }> = [];
  private pei: XianLiuPeiZhi;

  constructor(pei: XianLiuPeiZhi = {}) {
    this.pei = { zuiDaDengMs: 120_000, ...pei };
  }

  /** 运行中改额度（用户在设置里改了 rpm/tpm，或同一个 provider 实例换了模型） */
  geiXin(pei: Partial<XianLiuPeiZhi>): void { this.pei = { ...this.pei, ...pei }; }

  private dan(dangQian: number): void {
    const xian = dangQian - FEN_ZHONG_MS;
    this.ci = this.ci.filter((t) => t > xian);
    this.zi = this.zi.filter((x) => x.t > xian);
  }

  private tokenHe(dangQian: number): number {
    this.dan(dangQian);
    return this.zi.reduce((s, x) => s + x.n, 0);
  }

  /** 估算一次请求的 token 数（宿主在没有 usage 之前唯一能拿到的量） */
  static guJiToken(Qiu: { xiaoXiJi?: Array<{ content?: unknown; reasoning?: unknown }>; maxTokens?: number }): number {
    let zi = 0;
    for (const m of Qiu.xiaoXiJi || []) {
      const c = m?.content;
      zi += typeof c === 'string' ? c.length : Array.isArray(c) ? JSON.stringify(c).length : 0;
      zi += String(m?.reasoning ?? '').length;
    }
    return Math.round(zi / ZI_PER_TOKEN) + Math.max(0, Number(Qiu.maxTokens) || 0);
  }

  /** 能不能发（不记账） */
  panDing(yongToken: number, when?: number): XianLiuPanDuan {
    const t = when ?? (this.pei.now ? this.pei.now() : Date.now());
    this.dan(t);
    const rpm = Math.max(0, Math.floor(Number(this.pei.rpm) || 0));
    const tpm = Math.max(0, Math.floor(Number(this.pei.tpm) || 0));
    const ciShu = this.ci.length;
    const tokenShi = this.tokenHe(t);
    let yuanYin: XianLiuPanDuan['yuanYin'] = '';
    let yaoDengMs = 0;
    if (rpm > 0 && ciShu + 1 > rpm) {
      yuanYin = 'rpm';
      // 等够到"最旧的那条请求"滑出窗口为止
      const chuQu = this.ci[Math.max(0, this.ci.length - rpm)] ?? this.ci[0] ?? t;
      yaoDengMs = Math.max(0, (chuQu + FEN_ZHONG_MS) - t + 1);
    }
    if (tpm > 0 && tokenShi + yongToken > tpm) {
      yuanYin = 'tpm';
      let he = 0;
      let chuQu = t;
      for (const x of this.zi) { he += x.n; chuQu = x.t; if (tokenShi + yongToken - he <= tpm) break; }
      const y2 = Math.max(0, (chuQu + FEN_ZHONG_MS) - t + 1);
      if (y2 > yaoDengMs) yaoDengMs = y2;
    }
    return { keyi: !yuanYin, yaoDengMs, yuanYin, dangQianCi: ciShu, dangQianToken: tokenShi };
  }

  /** 记账（真的要发出去时调） */
  jiFei(yongToken: number, when?: number): void {
    const t = when ?? (this.pei.now ? this.pei.now() : Date.now());
    this.ci.push(t);
    this.zi.push({ t, n: Math.max(0, Math.round(yongToken)) });
  }

  /**
   * **事后校正**：把估算换成真实 usage。
   * 真实值比估算小 ⇒ 退差额；比估算大 ⇒ 补记。这样一次猜错不会一直错下去。
   */
  jiaoZheng(guJi: number, shiJi: number, when?: number): void {
    const cha = Math.round((Number(shiJi) || 0) - (Number(guJi) || 0));
    if (!cha) return;
    const t = when ?? (this.pei.now ? this.pei.now() : Date.now());
    this.zi.push({ t, n: cha });
  }

  /** 当前窗口内的用量（观测/设置页显示用） */
  zhuangTai(when?: number): { ci: number; token: number; rpm: number; tpm: number } {
    const t = when ?? (this.pei.now ? this.pei.now() : Date.now());
    this.dan(t);
    return {
      ci: this.ci.length,
      token: this.tokenHe(t),
      rpm: Math.max(0, Math.floor(Number(this.pei.rpm) || 0)),
      tpm: Math.max(0, Math.floor(Number(this.pei.tpm) || 0)),
    };
  }

  get zuiDaDengMs(): number { return Math.max(0, Number(this.pei.zuiDaDengMs ?? 120_000)); }
}

export interface XianLiuGouZi {
  /** 每个模型的额度（宿主从设置/拉取信息算出来） */
  yuE: (modelId: string) => { rpm: number; tpm: number };
  /** 等了多久（审计用；`yuanYin` 是被哪一路拦下，`fangXingLe` = 等完是否真的腾出了位置） */
  onDengDai?: (p: { modelId: string; yuanYin: 'rpm' | 'tpm'; ms: number; fangXingLe: boolean }) => void;
  /** 计时与等待（测试里注入假实现即可） */
  deng?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 真实 usage 里取总 token */
  usage?: (resp: LiaoTianXiangYing) => number;
  /**
   * 可注入的时钟。**必须能注入**：等待是靠宿主给的 `deng` 实现的，
   * 如果账本只能用真 `Date.now()`，测试里"等完了"却拨不动时钟 ⇒
   * 复检永远不放行 ⇒ 只能测出一个假红（第 39 轮第一次跑就撞上）。
   */
  now?: () => number;
}

const shiSuDeng = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const to = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(to); resolve(); }, { once: true });
});

/**
 * 给 provider 装上限流（包住 `chat` / `chatStream`，其余方法原样透传）。
 * **返回的仍是同一个协议形状**，所以工具循环/降级链/流式包装都不用改。
 */
export function baoZhuangXianLiu(yuan: MoxingGongYing, gou: XianLiuGouZi): MoxingGongYing {
  const zhang = new Map<string, HuaChuangXianLiu>();
  const benZhang = (moXing: string): HuaChuangXianLiu => {
    const pei = gou.yuE(String(moXing || ''));
    let z = zhang.get(String(moXing || ''));
    if (!z) { z = new HuaChuangXianLiu({ rpm: pei.rpm, tpm: pei.tpm, now: gou.now }); zhang.set(String(moXing || ''), z); }
    else z.geiXin({ rpm: pei.rpm, tpm: pei.tpm });
    return z;
  };
  /** 放行前排队：估算 → 判定 → 等待 → 记账 */
  const paiDui = async (Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<{ zhang: HuaChuangXianLiu; guJi: number }> => {
    const z = benZhang(String(Qiu.model || ''));
    const guJi = HuaChuangXianLiu.guJiToken(Qiu as unknown as { xiaoXiJi?: Array<{ content?: unknown; reasoning?: unknown }>; maxTokens?: number });
    const pan = z.panDing(guJi);
    if (!pan.keyi) {
      const deng = Math.min(pan.yaoDengMs, z.zuiDaDengMs);
      if (deng > 0) {
        await (gou.deng || shiSuDeng)(deng, signal);
        const re = z.panDing(guJi);
        gou.onDengDai?.({ modelId: String(Qiu.model || ''), yuanYin: (pan.yuanYin || re.yuanYin) as 'rpm' | 'tpm', ms: deng, fangXingLe: re.keyi });
      } else {
        gou.onDengDai?.({ modelId: String(Qiu.model || ''), yuanYin: (pan.yuanYin || 'rpm') as 'rpm' | 'tpm', ms: 0, fangXingLe: false });
      }
    }
    z.jiFei(guJi);
    return { zhang: z, guJi };
  };
  const jiaoZheng = (z: HuaChuangXianLiu, guJi: number, resp: LiaoTianXiangYing): void => {
    const shi = gou.usage ? gou.usage(resp) : Number((resp as { usage?: { totalTokens?: number } }).usage?.totalTokens || 0);
    if (shi > 0) z.jiaoZheng(guJi, shi);
  };
  return {
    ...yuan,
    protocol: yuan.protocol,
    baseURL: yuan.baseURL,
    supportsTools: yuan.supportsTools,
    async chat(Qiu, signal) {
      const { zhang, guJi } = await paiDui(Qiu, signal);
      const resp = await yuan.chat(Qiu, signal);
      jiaoZheng(zhang, guJi, resp);
      return resp;
    },
    /** ⚠️ 接口要求**同步**返回可迭代对象 ⇒ 排队发生在第一次取分片时（工具循环立刻就会取） */
    chatStream(Qiu, signal): AsyncIterable<LiaoTianPian> {
      const huoZong = (dui: unknown): number => {
        const u = (dui as { usage?: { totalTokens?: number } } | null | undefined)?.usage;
        return Number(u?.totalTokens || 0);
      };
      const nei = yuan.chatStream(Qiu, signal);
      const wrap = (async function* (): AsyncGenerator<LiaoTianPian, void, unknown> {
        const { zhang, guJi } = await paiDui(Qiu, signal);
        let lastZong = 0;
        for await (const pian of nei) {
          const z = huoZong(pian);
          if (z > 0) lastZong = z;
          yield pian;
        }
        if (lastZong > 0) zhang.jiaoZheng(guJi, lastZong);
      })();
      return wrap;
    },
    listModels: (signal) => yuan.listModels(signal),
    ping: (signal) => yuan.ping(signal),
  };
}
