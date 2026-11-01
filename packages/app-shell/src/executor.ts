/**
 * P5 短命执行者协议：上下文 = O(任务规模)，完成即销毁，只回传**结构化的蒸馏结论**
 * （契约 v1.1：输入 `GongzuozheRenwuShuru`、返回 `GongzuozheJieguo`）。
 *
 * 三件事由这里保证（第 48 轮）：
 *  · **马尔可夫毯有尺寸闸**（`shouZhanBian`）：单条 ≤3000 字、总长 ≤12000 字、丢掉的条数如实说；
 *  · **蒸馏是结构化交付**：有工具时给 `jiao_fu` 提交工具（schema 约束），没调就找正文 JSON 块，都没有才正文兜底；
 *    结论硬上限、超长原文存档 + 指针、产物由宿主逐个核实（见 `zheng-liu.ts`）；
 *  · **共享黑板**：宿主把"按这个执行者绑定了来源"的 heiban_read / heiban_write 交进来，
 *    开工前把任务黑板的有界摘要放进上下文（见 `hei-ban.ts`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  congYuSheChuangJian,
  neiRongWenBen,
  liaoTianDaiGongJu,
  type LiaoTianXiaoXi,
  type GongJuGuiGe,
  type GongJuDiaoYong,
} from '@warmy/providers';
import type { GongzuozheRenwuShuru, GongzuozheJieguo } from '@warmy/contracts';
import {
  jiaoFuGongJu,
  jieXiJiaoFu,
  zhengLiu,
  zhengLiuZhiZhen,
  JIAO_FU_GONG_JU_MING,
  JIE_LUN_YOU_GONG_JU,
  JIE_LUN_WU_GONG_JU,
  type JiaoFuCanShu,
} from './zheng-liu.js';
import { fenLeiCuoWu } from './cuowu-fenlei.js';
import { jiSuanGongZuoHaoShi } from './work-time.js';

export interface ZhixingqiRenwu extends GongzuozheRenwuShuru {
  /** 用户原话长度（压缩前）：只用于验收/排障，证明超长输入确实被压到有界提示里 */
  yuanWenChars?: number;
  /**
   * **这个执行者是哪只牛马**（id + 名字 + 人格）。
   *
   * 真机缺陷（第 20 轮）：以前执行者只是一串 id 字符串，这里拿**全局 providerCfg**
   * 发一次请求就完事 ⇒ 群里添加多少只牛马，模型侧都只是"同一个模型多答一句"，
   * 既没有各自的人格，也没有各自的模型。现在把身份带进来，系统提示里如实注入。
   */
  shenFen?: { id: string; ming: string; persona?: string };
  /**
   * 值班者为本次任务指定的思考级别（auto = 跟随牛马自己的设置）。
   * 只影响本任务的思考强度，**不影响模型**（模型由各牛马自己的设置决定）。
   */
  thinkLevel?: 'auto' | 'off' | 'low' | 'medium' | 'high' | string;
  /** 思考级别映射到本模型的请求参数（宿主按模型能力生成；没有就发普通请求） */
  thinkExtra?: Record<string, unknown>;
  /**
   * **可用工具**（产品要求：项目里的执行者要和单聊牛马一样能干活）。
   * 不给就退回"只说不做"的纯对话 —— 那正是以前的行为。
   */
  tools?: GongJuGuiGe[];
  runTool?: (call: GongJuDiaoYong, ctx: { round: number; zuiDaJieGuoZiShu: number }) => Promise<string> | string;
  toolLimits?: { zuiDaLunShu: number; zuiDaJieGuoZiShu: number; totalChars: number };
  /** 第 121 轮：审批等待累计时钟（毫秒）。执行时间从 duration 里扣掉它，不把等人点按钮算成干活 */
  approvalWaitMs?: () => number;
  /** 共享黑板：工具规格 + 已按本执行者绑定来源的处理器 + 开工时的有界摘要 */
  heiBan?: { gongJu: GongJuGuiGe[]; zhiXing: (call: GongJuDiaoYong) => Promise<string> | string; zhaiYao: () => string };
  /** 宿主核实产物：真实存在 ⇒ 返回绝对路径，否则空串（缺省只认存在的绝对路径） */
  heShiChanWu?: (lu: string) => string;
  /** 上下文压缩留痕（验收/排障用）：毯子裁了几条、丢了几条、最终提示多少字 */
  onAudit?: (op: string, detail?: Record<string, unknown>) => void;
  /** 结论超长时存完整原文（返回记忆库里的真 recordId；失败返回空串 ⇒ 不给指针） */
  cunQuanWen?: (wen: string) => Promise<string>;
  /** 第 104 轮：项目停止时中止在途请求（客户端 abort；供应商有 cancel 接口时由上层另行调用） */
  signal?: AbortSignal;
}

/** 契约结果 + "结论是否被截过"（回复里据此决定要不要写存档说明） */
export type zhixingqiJieguo = GongzuozheJieguo & { chaoChang: boolean };

export interface ZhixingqiGongyingshangPeizhi {
  presetId: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  protocol?: string;
  /** 单次模型调用上限（毫秒）：执行者不能因为供应商卡住而无限期占着项目 */
  timeoutMs?: number;
}

/**
 * **马尔可夫毯的尺寸闸**（ADR000 P5：执行者上下文 = O(任务规模)）——纯函数，门禁可直接 import 测。
 * 单条超出 `ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN` 就地截（留可执行的"按序号取原文"提示），
 * 总长超出 `ZHAN_BIAN_ZONG_ZI_SHANG_XIAN` 就**整条丢掉**（切成半句读不出意思，比不喂更坏），
 * 丢了几条要如实报出来。
 */
export const ZHAN_BIAN_ZONG_ZI_SHANG_XIAN = 12000;
export const ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN = 3000;
export function shouZhanBian(
  items: Array<unknown>,
  zongZi = ZHAN_BIAN_ZONG_ZI_SHANG_XIAN,
  danTiaoZi = ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN,
): { wen: string; beiJian: number; diuShu: number } {
  const zong = Math.max(1000, Number(zongZi) || ZHAN_BIAN_ZONG_ZI_SHANG_XIAN);
  const dan = Math.max(200, Number(danTiaoZi) || ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN);
  const chu: string[] = [];
  let yong = 0;
  let beiJian = 0;
  let diu = 0;
  for (const x of (Array.isArray(items) ? items : [])) {
    const yuan = String(x ?? '').trim();
    if (!yuan) continue;
    const tiao = yuan.length > dan
      ? yuan.slice(0, dan) + `…（本条还有 ${yuan.length - dan} 字未进毯：按序号回原文里取，不要猜）`
      : yuan;
    if (tiao !== yuan) beiJian++;
    if (yong + tiao.length + 4 > zong) { diu++; continue; }
    yong += tiao.length + 4;
    chu.push(tiao);
  }
  return { wen: chu.join('\n---\n'), beiJian, diuShu: diu };
}

/** 缺省的产物核实：只认真实存在的绝对路径文件（相对路径没有基准目录，宁可判"没找到"也不猜） */
function heShiMoRen(lu: string): string {
  try {
    const p = String(lu || '').trim();
    if (!p || !path.isAbsolute(p)) return '';
    return fs.existsSync(p) && fs.statSync(p).isFile() ? path.resolve(p) : '';
  } catch { return ''; }
}

/**
 * 执行者：独立短命会话，不继承值班者历史
 * 蒸馏返回：只给结构化结论，不给完整对话
 */
export async function yunxingDuanCunhuoZhixingqi(
  renwu: ZhixingqiRenwu,
  cfg: ZhixingqiGongyingshangPeizhi
): Promise<zhixingqiJieguo> {
  const qiShiShiJian = Date.now();
  const piZhun0 = Math.max(0, Number(renwu.approvalWaitMs?.()) || 0);
  const gongZuoHaoShi = (): number => jiSuanGongZuoHaoShi(qiShiShiJian, piZhun0, Date.now(), Math.max(0, Number(renwu.approvalWaitMs?.()) || 0));
  const sf = renwu.shenFen;
  const youGongJu = !!(renwu.tools && renwu.tools.length && renwu.runTool);
  /**
   * 系统提示：**你是哪只牛马**（名字 + 人格）+ 执行者纪律。
   * 有工具时明确要求"用工具真的去干"——否则模型常常只描述打算怎么做；
   * 交付必须走 jiao_fu（结构化），宿主据此核实产物、汇总给值班者。
   */
  const xiTong = [
    sf ? `你是 WArmy 项目里的牛马「${sf.ming}」，这次被值班者派来执行一项任务。` : '你是 WArmy 的短命执行者。',
    sf?.persona ? `你的人设：${String(sf.persona).slice(0, 600)}` : '',
    '只根据给定任务与上下文完成工作，不继承值班者的完整历史。',
    youGongJu
      ? '需要生成/修改/打开文件、执行命令时，**必须真的调用工具**去做，不要只描述打算怎么做。'
        + '如果任务只是创建一个文件：**直接调用 write_file**，不要先 list_dir / read_file 绕圈；写完立刻调用交付工具。'
        + `做完后**必须调用 ${JIAO_FU_GONG_JU_MING}** 提交结构化结果：jieLun（结论，≤${JIE_LUN_YOU_GONG_JU} 字）、chanWu（产物的**绝对路径**）、shiShi（关键事实）、jueDing（决定，带主题）、wenTi（还没解决的问题）。宿主会逐个核实你说的产物是否真的存在。`
      : `最后用一个 \`\`\`json 代码块给出 {"jieLun":"结论（≤${JIE_LUN_WU_GONG_JU}字）","shiShi":[],"jueDing":[{"zhuTi":"","nei":""}],"wenTi":[]}，不要复述完整过程。`,
    youGongJu && renwu.heiBan
      ? '这个任务还有别的执行者在并行干：开工前先用 heiban_read 看别人已经做了什么、定了什么；有新的发现或决定就用 heiban_write 写到任务黑板上，避免重复或各做各的。'
      : '',
  ].filter(Boolean).join('\n');
  /**
   * **马尔可夫毯必须有尺寸闸**（ADR000 P5「执行者上下文 = O(任务规模)」）。
   * 以前这里是 `contextItems.join(...)` 直拼、无长度闸，而『用户消息: 原话全文』也在毯里
   * ⇒ 一句 10M 的任务会把"短命执行者"撑成比值班者更贵的那一个（文档定的 O(任务规模) 变成 O(日志规模)）。
   * 丢掉的条数要**当场说出来**：静默丢上下文与假装看过是同一种错误。
   */
  const tan = shouZhanBian(renwu.contextItems || []);
  const brief = String(renwu.brief || '');
  const briefZai = brief.length > ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN
    ? brief.slice(0, ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN) + `…（任务描述还有 ${brief.length - ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN} 字未进毯：原文在群日志里，需要就按序号取，不要猜）`
    : brief;
  /** 任务黑板的有界摘要（≤2400 字，与黑板大小无关）；并行的执行者之后用 heiban_read 看实时的 */
  let heiBanZhai = '';
  try { heiBanZhai = renwu.heiBan ? String(renwu.heiBan.zhaiYao() || '') : ''; } catch { heiBanZhai = ''; }
  try {
    renwu.onAudit?.('group.executor-context', {
      taskId: renwu.taskId,
      zhanBianChars: tan.wen.length,
      zhanBianClipped: tan.beiJian,
      zhanBianDropped: tan.diuShu,
      briefChars: briefZai.length,
      heiBanChars: heiBanZhai.length,
      yuanWenChars: Number(renwu.yuanWenChars || 0),
      thinkLevel: String(renwu.thinkLevel || 'auto'),
      thinkParams: !!renwu.thinkExtra,
      promptChars: xiTong.length + briefZai.length + tan.wen.length + heiBanZhai.length,
    });
  } catch { /* 留痕失败不许拖累执行 */ }
  const xiaoXiJi: LiaoTianXiaoXi[] = [
    { role: 'system', content: xiTong },
    {
      role: 'user',
      content: `【任务】${briefZai}\n\n【上下文】\n${tan.wen}`
        + (tan.diuShu > 0 ? `\n（另有 ${tan.diuShu} 条上下文因为超出执行者档位上限**没有进毯**，不是遗漏也不是让你猜。）` : '')
        + (heiBanZhai ? `\n\n${heiBanZhai}` : ''),
    },
  ];
  /** 交付工具收到的结构化结果（模型可能调多次：以最后一次有效的为准） */
  let jiaoFu: JiaoFuCanShu | null = null;
  /**
   * **工具实际写出的、宿主核实存在的产物**。
   * 模型偶尔会调用 jiao_fu 却漏填 chanWu（真机：本地 9B 写文件成功、交付里 artifacts 为空），
   * 这时不能把"真的做完了"判成"没产物"；以宿主核实的工具结果兜底。
   */
  const shiJiChanWu = new Set<string>();
  const gongJu: GongJuGuiGe[] | undefined = youGongJu
    ? (() => {
      const kan = new Set<string>();
      return [...renwu.tools!, jiaoFuGongJu(), ...(renwu.heiBan?.gongJu || [])].filter((g) => {
        const n = g.function.name;
        if (kan.has(n)) return false;
        kan.add(n);
        return true;
      });
    })()
    : undefined;
  const yunXing = async (call: GongJuDiaoYong, ctx: { round: number; zuiDaJieGuoZiShu: number }): Promise<string> => {
    const ming = String(call?.function?.name || '');
    if (ming === JIAO_FU_GONG_JU_MING) {
      const can = jieXiJiaoFu(call.function.arguments);
      if (!can) return `[${JIAO_FU_GONG_JU_MING}] 没收到：jieLun（结论）不能为空。请带上 jieLun 与 chanWu 再调用一次。`;
      jiaoFu = can;
      return `[${JIAO_FU_GONG_JU_MING}] 已收到交付（结论 ${can.jieLun.length} 字、产物 ${can.chanWu.length} 个）。不需要再复述，回一句"已交付"即可。`;
    }
    if (renwu.heiBan && (ming === 'heiban_write' || ming === 'heiban_read')) return String(await renwu.heiBan.zhiXing(call));
    const jieGuo = String(await renwu.runTool!(call, ctx));
    if (ming === 'write_file' || ming === 'edit_file') {
      try {
        const can = JSON.parse(call.function.arguments || '{}') as { path?: unknown; file?: unknown };
        const lu = String(can.path || can.file || '');
        const abs = lu && renwu.heShiChanWu ? renwu.heShiChanWu(lu) : '';
        if (abs) shiJiChanWu.add(abs);
      } catch { /* 参数坏了由工具自己报错，这里不猜 */ }
    }
    return jieGuo;
  };
  const tongJiKong = { durationMs: 0, promptTokens: 0, completionTokens: 0 };
  try {
    const provider = congYuSheChuangJian(cfg.presetId, {
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || undefined,
      protocol: cfg.protocol,
      ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    } as never, cfg.protocol as never);
    const Qiu = {
      model: cfg.model || 'deepseek-chat',
      xiaoXiJi,
      /** 有工具要多给预算：工具参数（如 write_file 的正文）本身就占输出 token */
      maxTokens: youGongJu ? Math.max(2048, renwu.budgetTokens || 4096) : Math.min(512, renwu.budgetTokens || 512),
      ...(gongJu ? { tools: gongJu } : {}),
      ...(renwu.thinkExtra ? { extra: renwu.thinkExtra } : {}),
    };
    const lim = renwu.toolLimits || { zuiDaLunShu: 8, zuiDaJieGuoZiShu: 4000, totalChars: 12000 };
    const xiangYing = youGongJu
      ? (await liaoTianDaiGongJu(provider, Qiu, yunXing, {
          zuiDaLunShu: lim.zuiDaLunShu,
          zuiDaJieGuoZiShu: lim.zuiDaJieGuoZiShu,
          maxToolResultChars: lim.totalChars,
          // 一次性蒸馏任务：额度预警只会占掉它本来就不多的输出预算（第 39 轮：预警只给主对话循环）
          wuYuSuanTiShi: true,
          ...(renwu.signal ? { signal: renwu.signal } : {}),
        })).xiangYingTi
      : await provider.chat(Qiu, renwu.signal);
    const zl = zhengLiu({
      taskId: renwu.taskId,
      jiaoFu,
      zhengWen: neiRongWenBen(xiangYing.choices[0]?.message?.content),
      youGongJu,
      heShi: renwu.heShiChanWu || heShiMoRen,
      stats: {
        durationMs: gongZuoHaoShi(),
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
      },
    });
    let jg = zl.jieGuo;
    if (shiJiChanWu.size) {
      jg = { ...jg, artifacts: [...new Set([...(jg.artifacts || []), ...shiJiChanWu])] };
    }
    /**
     * **没核实到的产物不许在汇报里冒充真产物**：模型有时会在结论里多写一个不存在的路径
     * （宿主已在 `unverifiedArtifacts` 里记账）。把它从面向用户的结论中替换成「（未核实）」，
     * 真实产物一个不少；值班者汇总时就不会把假路径当成交付物报给用户。
     */
    if ((jg.unverifiedArtifacts || []).length) {
      let wen = String(jg.distilled || '');
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const u of jg.unverifiedArtifacts || []) {
        const lu = String(u || '');
        const ji = lu.split(/[\\/]/).pop() || lu;
        if (lu) wen = wen.split(lu).join('（未核实）');
        /**
         * 裸文件名只按**独立词**替换：真产物 `…-01.txt` 里也含 `01.txt`，
         * 直接全局替换会把好路径改成 `…-（未核实）`（反而毁掉真实产物）。
         */
        if (ji && ji !== lu) {
          const re = new RegExp('(^|[\\s`"（(【])' + esc(ji) + '(?=$|[\\s`"）)】,，。;；])', 'g');
          wen = wen.replace(re, '$1（未核实）');
        }
      }
      jg = { ...jg, distilled: wen };
    }
    /** 超长：完整原文存档，**存成功**才挂指针（存不上，回复里如实说"未能存档"） */
    if (zl.chaoChang && renwu.cunQuanWen) {
      let id = '';
      try { id = String(await renwu.cunQuanWen(zl.quanWen) || ''); } catch { id = ''; }
      jg = zhengLiuZhiZhen(jg, id);
    }
    return { ...jg, chaoChang: zl.chaoChang };
  } catch (e) {
    /** 错误按契约分类表归类；认不出的一律当执行者崩溃（WORKER_CRASH），不当"未知"糊过去 */
    const gl = fenLeiCuoWu(e);
    return {
      taskId: renwu.taskId,
      distilled: '',
      artifacts: [],
      stats: { ...tongJiKong, durationMs: gongZuoHaoShi() },
      error: gl.category === 'UNKNOWN' ? { ...gl, category: 'WORKER_CRASH', code: 'worker' } : gl,
      chaoChang: false,
    };
  }
}

/** 批量派发：多个执行者并行，各自短命 */
export async function yunXingZhiXingQiJi(
  RenwuJi: ZhixingqiRenwu[],
  cfg: ZhixingqiGongyingshangPeizhi
): Promise<zhixingqiJieguo[]> {
  return Promise.all(RenwuJi.map((t) => yunxingDuanCunhuoZhixingqi(t, cfg)));
}
