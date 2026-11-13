/**
 * diwen-bridge —— 迪文（Diwen）融合桥（R192）。
 *
 * 统一三态门控（所有迪文化落点共用）：
 *  · 确定（结构化且校验通过）→ structured（迪文机器层 + GCF，给机器看）；
 *  · 不确定（仅原文 / 结构损坏）→ fallback-text（回退原文，自然语）；
 *  · 没有 → reject（不编造）；
 *  · 迪文不可用 → unavailable（回退原文，绝不阻断业务）。
 *
 * 红线：迪文只给机器看；**用户可见内容（知识库卡片搜索等）一律回退原文**；S8 非安全/加密层。
 * 接入：迪文私有，开发期按路径 import（WARMY_DIWEN_DIR 可配）；发布形态须 vendor 进 monorepo（见交接文档）。
 */
import { pathToFileURL } from 'node:url';

const MO_REN_DIWEN = 'C:\\Users\\p\\.openclaw\\workspace-cloud\\tmp\\Diwen';
let dwCache: any = null;
let dwFailed = false;

/** 懒加载迪文（纯 ESM、零依赖）；不可用则缓存失败，回退原文不阻断。 */
export async function jiaZaiDiwen(): Promise<any> {
  if (dwCache) return dwCache;
  if (dwFailed) return null;
  try {
    const dir = (process.env.WARMY_DIWEN_DIR || MO_REN_DIWEN).replace(/\\/g, '/');
    dwCache = await import(pathToFileURL(dir + '/src/index.js').href);
    return dwCache;
  } catch {
    dwFailed = true;
    return null;
  }
}

export type DiwenMode = 'structured' | 'fallback-text' | 'reject' | 'unavailable';
export interface DiwenHuaJieGuo { mode: DiwenMode; text: string; diwen?: any; gcf?: string; }

/**
 * 统一迪文化入口。
 * @param input.text 原文（自然语，用户可见回退用）
 * @param input.doc  可选迪文机器层文档（确定内容才给）
 * 确定→structured；不确定/损坏→fallback-text；没有→reject；迪文不可用→unavailable（回退原文）。
 */
export async function diwenHua(input: { text?: string; doc?: any }): Promise<DiwenHuaJieGuo> {
  const text = String(input?.text ?? '');
  const dw = await jiaZaiDiwen();
  if (!dw) return { mode: 'unavailable', text }; // 迪文不可用：回退原文，不阻断、不编造
  if (input?.doc) {
    try {
      const v = dw.validateDocument(input.doc);
      if (v && v.valid) {
        let gcf: string | undefined;
        try { gcf = dw.encode(input.doc).text; } catch { /* GCF 失败不影响结构化结论 */ }
        return { mode: 'structured', text: text || String(input.doc.reasoning || ''), diwen: input.doc, ...(gcf ? { gcf } : {}) };
      }
    } catch { /* 校验异常按损坏处理 */ }
    return { mode: 'fallback-text', text }; // 结构损坏 → 回退原文
  }
  if (text) {
    // R198：用迪文 v6.2.0 基线映射（mapText，确定性词典最长匹配）尝试 NL→迪文
    try {
      const m = dw.mapText(text);
      if (m && m.status === 'STRUCTURED' && Array.isArray(m.words) && m.words.length) {
        const doc = { reasoning: text, words: m.words };
        const v = dw.validateDocument(doc);
        if (v && v.valid) {
          let gcf: string | undefined;
          try { gcf = dw.encode(doc).text; } catch { /* GCF 失败不影响结构化 */ }
          return { mode: 'structured', text, diwen: doc, ...(gcf ? { gcf } : {}) };
        }
      }
    } catch { /* 映射失败回退原文 */ }
    return { mode: 'fallback-text', text }; // 映射不出结构 → 回退原文
  }
  return { mode: 'reject', text: '' }; // 没有 → 不编
}

/** 用户可见搜索：**永远只回原文**（迪文只给机器）。 */
export async function diwenYongHuSouSuo(input: { text?: string; doc?: any }): Promise<string> {
  const r = await diwenHua(input);
  return r.text; // 无论 structured/fallback，用户看到的都是自然语原文
}

/** 结构校验（证据闸/升层判定用）。迪文不可用回 {valid:false, unavailable:true}。 */
export async function diwenValidate(doc: any): Promise<{ valid: boolean; errors?: any[]; unavailable?: boolean }> {
  const dw = await jiaZaiDiwen();
  if (!dw) return { valid: false, unavailable: true };
  try { const v = dw.validateDocument(doc); return { valid: !!v?.valid, errors: v?.errors || [] }; }
  catch (e) { return { valid: false, errors: [String((e as Error)?.message || e)] }; }
}

/** GCF 编码（机器间交换/摘要压缩，省 token 主要靠补丁与去重）。不可用回 null。 */
export async function gcfBianMa(doc: any): Promise<string | null> {
  const dw = await jiaZaiDiwen();
  if (!dw) return null;
  try { return dw.encode(doc).text; } catch { return null; }
}

/** 三态知识库（确定 STRUCTURED / 不确定 FALLBACK_TEXT / 没有 REJECT）。不可用回 null。 */
export async function diwenZhiShiKu(entries: any[]): Promise<any> {
  const dw = await jiaZaiDiwen();
  if (!dw) return null;
  try { return dw.createKB(entries); } catch { return null; }
}

/** 智能体互通迪文化：把结构化事实封装为可验证交换载荷（机器看）；自由文本指令保留原文。 */
export async function zhiNengTiJiaoHuan(facts: { text?: string; doc?: any }): Promise<{ payload: DiwenHuaJieGuo; yuanWen: string }> {
  const payload = await diwenHua(facts);
  return { payload, yuanWen: payload.text };
}

/** R198：NL→迪文基线映射（迪文 v6.2.0 mapText，确定性词典最长匹配，三态）。不是自动翻译器，是可控基线。 */
export async function diwenYingShe(text: string): Promise<{ status: string; words: any[]; coverage: number; unavailable?: boolean }> {
  const dw = await jiaZaiDiwen();
  if (!dw) return { status: 'REJECT', words: [], coverage: 0, unavailable: true };
  try { const m = dw.mapText(String(text || '')); return { status: m.status, words: m.words || [], coverage: m.coverage || 0 }; }
  catch { return { status: 'REJECT', words: [], coverage: 0 }; }
}

/** R198：规范化 + 内容哈希（去重/等价判定，迪文 v6.2.0 normalize）。 */
export async function diwenGuiFanHua(doc: any): Promise<{ canonical?: string; hash?: string; unavailable?: boolean }> {
  const dw = await jiaZaiDiwen();
  if (!dw) return { unavailable: true };
  try { return { canonical: dw.canonicalJson(doc), hash: String(dw.contentHash(doc)) }; }
  catch { return {}; }
}

/** R198：DRS 三值判定（sat/unsat/unknown；预算超限降级 unknown，不冒充 unsat）。 */
export async function diwenPanDing(drs: any, opts?: any): Promise<{ decision: string; unavailable?: boolean }> {
  const dw = await jiaZaiDiwen();
  if (!dw) return { decision: 'unknown', unavailable: true };
  try { const r = dw.decideDrs(drs, opts); return { decision: String(r?.decision ?? r ?? 'unknown') }; }
  catch { return { decision: 'unknown' }; }
}

/** R198：文档等价判定（规范形比较，去重用）。 */
export async function diwenXiangDeng(a: any, b: any): Promise<boolean> {
  const dw = await jiaZaiDiwen();
  if (!dw) return false;
  try { return !!dw.equivalentDocs(a, b); } catch { return false; }
}