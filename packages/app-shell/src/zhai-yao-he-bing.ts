/**
 * 归档摘要的**合并与注入份额**（第 44 轮记忆 #10：「摘要自身不许膨胀」+「永远知道何时/如何/从哪里/怎么取回」）
 *
 * 修之前的现实：注入点是 `gui.slice(-8).map(summary).join().slice(0, 3000)` ——
 *  · **只覆盖最近 8 条归档**：6000 轮的会话里，前面的归档被整段丢掉，而且**没人说出来**（模型以为自己看到的是"更早的全部"）；
 *  · **份额是常数**：与本轮预算无关 ⇒ 预算调大也不会多给历史，调小却照样吃 3000 字；
 *  · **摘要的摘要没有合并策略**：归档本身是"末 30 条 ×160 字→截 4000"，条数固定所以不会滚大，
 *    但多条归档**并列**注入时，重复的"## 决策 / ## 要点"结构会把份额吃光。
 *
 * 本模块只做算术与裁剪，不读盘、不调模型（门禁可直接 import 负向验证）。
 */

export interface GuiDangDingYue {
  ts: number;
  summary: string;
  /**
   * 这条归档自己的 id（`arc-…`）。归档摘要**也写进了记忆库**（`kind:'archive'`），
   * 所以这个 id 是 `retrieve(recordId=…)` 能直接命中的真锚点 —— 没进上下文的那些靠它取回。
   */
  id?: string;
  /** 真实锚点（解引用侧靠它把"我记得"变成"我查得到"） */
  anchors?: Array<{ seq?: number; recordId?: string }>;
}

export interface ZhuRuJieGuo {
  /** 要注入的正文（已经夹进份额里） */
  duan: string;
  /** 覆盖了哪一段（第几条到第几条、时间范围） */
  fuGai: { cong: number; dao: number; tiaoShu: number; zuiZaoTs: number; zuiXinTs: number };
  /** **没被覆盖的条数**（>0 就必须在正文里如实说出来，不许让模型以为看到了全部） */
  weiFuGai: number;
  /** 用掉的份额 */
  zi: number;
}

/** 一条归档最多给多少字（合并段里再压一档） */
const danTiao = (fenE: number, tiao: number): number => Math.max(160, Math.floor(fenE / Math.max(2, tiao)));

/** 把重复的小节头去掉（多条并列时"## 要点"出现 8 次只是浪费份额） */
function quChongWen(wen: string): string {
  return String(wen || '').replace(/^#{1,3}\s+/gm, '· ');
}

/**
 * 注入份额分配：
 *  · 最近的 `zuiHouTiao` 条**逐条保留**（越新越接近现场）；
 *  · 更早的**合并成一段**（去重、每条只留最靠前几行、按份额封顶）；
 *  · 合并段也装不下的条数 = `weiFugai`，必须写进正文，并告诉模型怎么取回。
 */
export function jiYaoZhuRu(p: {
  quanBu: GuiDangDingYue[];
  fenE: number;
  zuiHouTiao?: number;
}): ZhuRuJieGuo {
  const list = (Array.isArray(p.quanBu) ? p.quanBu : []).filter((x) => x && String(x.summary || '').trim());
  const fenE = Math.max(600, Number(p.fenE) || 0);
  const zuiHou = Math.max(1, Math.min(8, Number(p.zuiHouTiao ?? 6) || 6));
  const xinDe = list.slice(-zuiHou);
  const zheng = list.slice(0, Math.max(0, list.length - xinDe.length));
  const ziZhiXin = Math.floor(fenE * 0.6);
  const ziZheZhao = fenE - ziZhiXin;
  const zhiXin = xinDe.map((x) => quChongWen(String(x.summary || '')).slice(0, danTiao(ziZhiXin, xinDe.length))).filter(Boolean).join('\n\n');
  /** 更早的合并：每条最多留 3 行，去重后按份额截断 */
  const feiDan: string[] = [];
  const jian = new Set<string>();
  for (const x of zheng) {
    const hang = String(x.summary || '').split('\n').map((h) => h.trim()).filter((h) => h && !/^[#]/.test(h)).slice(0, 3);
    for (const h of hang) {
      const key = h.slice(0, 40);
      if (jian.has(key)) continue;
      jian.add(key);
      feiDan.push(h);
    }
  }
  const zhao = feiDan.join('\n').slice(0, Math.max(0, ziZheZhao - 80));
  /** 合并段实际吃掉了多少条：按"留了几行 / 每条最多 3 行"回推，宁少不多（少报 = 骗自己说全覆盖了） */
  const fuGaiTiao = zheng.length === 0 ? 0 : Math.max(1, Math.min(zheng.length, Math.ceil(zhao.split('\n').length / 3)));
  const weiFuGai = Math.max(0, zheng.length - fuGaiTiao);
  /**
   * 没被覆盖的那些归档，指针必须**可执行**（与 #7 的假 recordId 同一类缺陷）：
   * 归档摘要自己也写进了记忆库（`kind:'archive'`，id = `arc-…`），所以这里直接给出真的 recordId 样例，
   * 而不是只说一句"用 recall 取"（关键词猜不中就等于取不回）。
   */
  const weiId = zheng.slice(fuGaiTiao).map((x) => String(x.id || '').trim()).filter(Boolean).slice(0, 2);
  const cong = Math.max(1, list.length - xinDe.length - zheng.length + 1);
  const dao = list.length - xinDe.length;
  let duan = '';
  if (zhao) duan += `〔更早的 {n} 次归档合并如下（重复条目已去掉）〕\n`.replace('{n}', String(fuGaiTiao)) + zhao + (weiFuGai > 0 ? `\n〔另有 ${weiFuGai} 次归档**没有**被放进这段上下文：它们仍在归档里，用 recall("关键词") 取${weiId.length ? `，或直接 retrieve(recordId="${weiId.join('" / "')}")` : ''}，不要凭印象编造〕` : '');
  if (zhiXin) duan += (duan ? '\n\n' : '') + zhiXin;
  /**
   * **整段去重**（不是只去合并段内部的重复）：多条归档并列注入时，同一句结论出现 6 次只是把份额吃光，
   * 让"更早的历史"反而装不进去 —— 这正是 #10 说的"摘要自身膨胀"。
   * 只去**完全相同**的行，空白行保留一条，顺序不变（越靠后越新这条读法不能被搅乱）。
   */
  const kan = new Set<string>();
  duan = duan.split('\n').filter((h) => {
    const key = h.trim();
    if (!key) return true;
    if (kan.has(key)) return false;
    kan.add(key);
    return true;
  }).join('\n');
  if (duan.length > fenE) duan = duan.slice(0, fenE) + '…（份额用满，其余靠 recall/retrieve 取）';
  return {
    duan,
    fuGai: {
      cong: list.length ? cong : 0,
      dao: list.length ? dao : 0,
      tiaoShu: fuGaiTiao + xinDe.length,
      zuiZaoTs: list.length ? Number(list[0]?.ts || 0) : 0,
      zuiXinTs: list.length ? Number(list[list.length - 1]?.ts || 0) : 0,
    },
    weiFuGai,
    zi: duan.length,
  };
}

/**
 * 份额随长度自适应（#10 的后半）：归档注入不该是一个和预算无关的常数。
 * 比例固定，绝对值随本轮预算线性缩放，两端夹住（太小不如不给，太大就挤掉现场）。
 */
export function jiYaoFenE(budgetChars: number, bi = 0.08, xia = 1200, shang = 8000): number {
  const b = Math.max(0, Number(budgetChars) || 0);
  if (!b) return 0;
  return Math.min(shang, Math.max(xia, Math.round(b * (bi || 0))));
}
