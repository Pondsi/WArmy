/**
 * R298：定时调度唯一执行 owner —— 心跳驱动、错过不补、单飞/排队、补执行、条件边沿。
 *
 * 口径（计划《总结巡查预测发布闭环》§时间等待触发/§唯一执行取消恢复/§错过通知）：
 *  · 复用 xin-tiao 唯一计时源：注册周期巡检 + 每任务到期闹钟；不自建 setInterval。
 *  · 离线/休眠/明确跨过有效时刻 ⇒ 不自动补跑，分片枚举错过（不截断遗漏），交用户决定；
 *    连续在线且无离线证据的正常抖动允许 60s 容差（不是离线补跑窗口）。
 *  · 每任务最多一个在飞 + 一个排队；超出/过期进入错过决定并推进周期，不静默丢弃、不阻塞后续。
 *  · 效果前经账本持久化意图；写盘失败阻断派发。终态 occurrence 幂等跳过并推进水位（回拨/崩溃恢复不重跑）。
 *  · 条件默认假→真边沿或唯一事件 ID；无事件通知时 5s 低占空比核对；等待不占模型/执行租约。
 *  · 巡检片不被模型执行阻塞：派发后异步收尾（推进水位/重挂闹钟），片内只做有界账本操作。
 *  · 停止/换 revision 取消在飞请求与后续步骤（只操作本任务）；补执行不消耗 repeat、不改 nextAt；
 *    旧 revision 的错过决定不自动补（任务已变更须重新确认）。
 *  · mixed 串行：前一步非 success 即停后续（结果不确定不继续副作用）。
 *  · 本模块不做 IO/不调模型问时间：谓词求值与动作执行都由宿主注入（授权在动作层复核）。
 */
import {
  type DingShiRenWuV2, type DingShiDongZuo, type DingShiWeiCi,
  DING_SHI_XIAN_ZHI, xiaCiChuFa, meiGuoQuJian, yanZhengDongZuo, miaoShuChuFa,
} from '../ji-chu/ding-shi-gui-ze.js';
import type { DingShiZhangBen, DingShiOccurrence, DingShiBuZhou, CuoGuoYuanYin } from './ding-shi-zhang-ben.js';

export interface DiaoDuXinTiao {
  zhuCe(ren: { id: string; ming: string; meiMs: number; run: (ci: { now: number; buPao: boolean }) => void | Promise<void> }): void;
  xinChuCe?(id: string): boolean;
  daoJiShenQing(x: { id: string; yaoAt: number; beiZhu: string; chang: Record<string, unknown> }): unknown;
  daoJiQuXiao(id: string): boolean;
}
export interface DongZuoQingQiu {
  task: DingShiRenWuV2;
  occurrence: DingShiOccurrence;
  step: DingShiBuZhou;
  index: number;
  action: DingShiDongZuo;
  signal: AbortSignal;
}
export interface DongZuoJieGuo { status: 'success' | 'failed' | 'cancelled' | 'unknown'; receipt: string }

export interface DingShiDiaoDuYiLai {
  zhangBen: DingShiZhangBen;
  xinTiao: DiaoDuXinTiao;
  /** 动作适配器（ying-yong/ding-shi-dong-zuo）：真实回执，机械动作无须模型 */
  zhiXing: (req: DongZuoQingQiu) => Promise<DongZuoJieGuo>;
  /** 受限谓词求值（宿主做已授权文件/任务/计划/事件/工具结果查询；禁止 eval/模型） */
  pingGu: (predicate: DingShiWeiCi, task: DingShiRenWuV2) => Promise<boolean> | boolean;
  /** 错过通知：单未读合并 owner（xi-tong-xiao-xi.jiDingShiCuoGuo） */
  tongZhiCuoGuo: (title: string, body: string) => void;
  now?: () => number;
  guangBo?: (channel: string, payload: unknown) => void;
  audit?: (op: string, detail: unknown) => void;
  /** 宿主补充离线证据（心跳 long-gap/clock-jump/系统唤醒痕迹） */
  liXianZhengJu?: () => boolean;
  /** 巡检周期，默认 1000ms（心跳基础 tick 会夹到最早到期） */
  xunChaMs?: number;
}

const XUN_CHA_MO_REN = 1000;
const MEI_PIAN_MEI_GUO = 64;   // 每片错过枚举上限（让出事件循环，跨片继续不截断）
const MEI_PIAN_REN_WU = 32;    // 每片处理任务上限
const MEI_PIAN_BU_ZHI = 8;     // 每片补执行上限
const LI_XIAN_JIAN_GE = 90_000; // 巡检间隔超过此值视为休眠/饿死证据

interface ZaiFei { occurrenceId: string; controller: AbortController }
interface MeiGuoYouBiao { cursor: number; to: number; reason: CuoGuoYuanYin; revision: number }

export function chuangJianDingShiDiaoDu(yiLai: DingShiDiaoDuYiLai) {
  const zb = yiLai.zhangBen;
  const now = yiLai.now ?? (() => Date.now());
  const audit = yiLai.audit ?? (() => {});
  const guangBo = yiLai.guangBo ?? (() => {});
  const xunChaMs = Math.max(200, yiLai.xunChaMs ?? XUN_CHA_MO_REN);
  const zaiFeiJi = new Map<string, ZaiFei>();
  const meiGuoYouBiaoJi = new Map<string, MeiGuoYouBiao>();
  const tiaoJianPollJi = new Map<string, number>();
  const revisionJian = new Map<string, number>();
  const buZhiXingFuGaiJi = new Map<string, { action: DingShiDongZuo }>();
  const yunXingZhong = new Set<Promise<void>>();
  let shangCiXunCha = 0;
  let yiQiDong = false;
  let xunChaMang = false;

  function mingYiCuoGuo(t: DingShiRenWuV2, items: number[], reason: CuoGuoYuanYin): number {
    let xin = 0;
    for (const at of items) {
      const r = zb.jiCuoGuo({ taskId: t.id, scheduledAt: at, reason, revision: t.revision });
      if (r.ok && !r.yiCunZai) xin += 1;
    }
    /** 新错过⇒卡片刷新（未决区即时可见，不等下一次任务事件） */
    if (xin > 0) guangBo('warmy:dingShiRenWuGengXin', { taskId: t.id, missed: xin });
    return xin;
  }
  function tongZhiGuiZu(xin: Array<{ task: DingShiRenWuV2; items: number[]; reason: CuoGuoYuanYin }>): void {
    if (!xin.length) return;
    const hang: string[] = [];
    for (const g of xin) {
      const shiKe = g.items.slice(0, 3).map((at) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')).join('、');
      hang.push(`【${g.task.name}】${miaoShuChuFa(g.task.trigger)}：遗漏 ${g.items.length} 次（${shiKe}${g.items.length > 3 ? '…' : ''}，${g.reason}）`);
    }
    yiLai.tongZhiCuoGuo('定时任务错过', hang.join('\n') + '\n到定时卡选择：补执行／不补／自行输入。未处理不阻塞其他任务与后续周期。');
  }

  /** 动作 → 串行步骤（mixed 展开；effectId 绑定自然触发槽，重试稳定） */
  function buZhouLie(t: DingShiRenWuV2, scheduledAt: number, action: DingShiDongZuo): Array<{ effectId: string; kind: string; snapshot: string; action: DingShiDongZuo }> {
    const dong = action.kind === 'mixed' ? action.steps : [action];
    return dong.slice(0, DING_SHI_XIAN_ZHI.stepsMax).map((a, i) => ({
      effectId: `${t.id}:r${t.revision}:${scheduledAt}:s${i}`,
      kind: a.kind,
      snapshot: JSON.stringify(a).slice(0, 4000),
      action: a,
    }));
  }
  function yiTuCanShu(t: DingShiRenWuV2, scheduledAt: number, action: DingShiDongZuo) {
    return buZhouLie(t, scheduledAt, action).map(({ effectId, kind, snapshot }) => ({ effectId, kind, snapshot }));
  }

  function guaNaodoZhong(t: DingShiRenWuV2): void {
    const id = 'schv2:' + t.id;
    try { yiLai.xinTiao.daoJiQuXiao(id); } catch { /* noop */ }
    const st = zb.zhuangTai(t.id);
    if (!t.enabled || !st || !(st.nextAt > 0)) return;
    try { yiLai.xinTiao.daoJiShenQing({ id, yaoAt: st.nextAt, beiZhu: t.name, chang: { taskId: t.id, revision: t.revision } }); } catch { /* 保底挂不上不影响本机心跳 */ }
  }
  function zhongGua(taskId: string): void {
    const t = zb.renWu(taskId);
    if (t) guaNaodoZhong(t);
  }

  /** 异步收尾跟踪：巡检片不等待模型执行；测试/退出可 dengDai 收齐 */
  function genZong(p: Promise<void>): void {
    yunXingZhong.add(p);
    void p.finally(() => yunXingZhong.delete(p));
  }

  /** 串行执行一个 occurrence 的全部步骤；前一步非 success 即停后续 */
  async function paoOccurrence(t: DingShiRenWuV2, occ: DingShiOccurrence, action: DingShiDongZuo): Promise<void> {
    const kong = new AbortController();
    zaiFeiJi.set(t.id, { occurrenceId: occ.id, controller: kong });
    if (!zb.kaiShi(occ.id)) { zaiFeiJi.delete(t.id); return; } // 写盘失败/状态不符 ⇒ 不派发
    const bu = buZhouLie(t, occ.scheduledAt, action);
    let tingZhiHouXu = false;
    try {
      for (let i = 0; i < occ.steps.length; i += 1) {
        const s = occ.steps[i]!;
        if (tingZhiHouXu || kong.signal.aborted) {
          zb.luHuiZhi(occ.id, s.effectId, 'cancelled', tingZhiHouXu ? 'prior-step-not-success' : 'task-cancelled');
          continue;
        }
        if (s.status === 'success') continue; // 恢复不重跑已完成步骤
        if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'unknown') { tingZhiHouXu = true; continue; }
        if (!zb.buZhouKaiShi(occ.id, s.effectId)) { tingZhiHouXu = true; continue; }
        const dong = bu[i]?.action ?? action;
        let jie: DongZuoJieGuo;
        try {
          jie = await yiLai.zhiXing({ task: t, occurrence: occ, step: s, index: i, action: dong, signal: kong.signal });
        } catch (e) {
          jie = { status: 'failed', receipt: String((e as Error)?.message || e).slice(0, 300) };
        }
        if (kong.signal.aborted) jie = { status: 'cancelled', receipt: 'aborted' };
        zb.luHuiZhi(occ.id, s.effectId, jie.status, jie.receipt);
        if (jie.status !== 'success') tingZhiHouXu = true;
      }
    } finally {
      const dang = zaiFeiJi.get(t.id);
      if (dang && dang.occurrenceId === occ.id) zaiFeiJi.delete(t.id);
      zb.jieShu(occ.id);
      guangBo('warmy:dingShiRenWuGengXin', { taskId: t.id, occurrenceId: occ.id });
    }
  }

  /** 到点推进（登记时即推进，锚点不漂移；缺口由跨过名义时刻时记录）；一次性用尽由账本自动停用 */
  function tuiJinBingGua(t: DingShiRenWuV2, scheduledAt: number): void {
    zb.chuFaHouTuiJin(t.id, scheduledAt);
    zhongGua(t.id);
  }

  /** 正常到点派发（在线容差内）；终态幂等跳过并推进；槽满转错过并推进周期 */
  function paiFaDaoDian(t: DingShiRenWuV2, scheduledAt: number, n: number): void {
    const yi = zb.dengJiYiTu({ taskId: t.id, revision: t.revision, scheduledAt, steps: yiTuCanShu(t, scheduledAt, t.action) });
    if (!yi.ok) {
      if (yi.error === 'slot-full') {
        mingYiCuoGuo(t, [scheduledAt], 'busy-overflow');
        tongZhiGuiZu([{ task: t, items: [scheduledAt], reason: 'busy-overflow' }]);
        /** 超出项交用户决定；周期照常推进，不阻塞后续 */
        zb.chongSuanXiaCi(t.id, n);
        zhongGua(t.id);
      }
      audit('dingShi.dispatch-blocked', { taskId: t.id, error: yi.error });
      return;
    }
    const occ = yi.occurrence;
    if (occ.status === 'running') return; // 在飞：登记时已推进，等收尾
    if (occ.status !== 'preparing') {
      /** 终态（崩溃恢复 unknown / 回拨重复 / 已完成）：不重跑，只推进水位 */
      tuiJinBingGua(t, scheduledAt);
      return;
    }
    /** 触发已发生：登记即推进锚点水位（执行耗时不漂移，排队/溢出槽也能被后续片看到） */
    tuiJinBingGua(t, scheduledAt);
    if (zb.zaiFei(t.id)) return; // 在飞 ⇒ 本项排队，下轮派发
    genZong(paoOccurrence(t, occ, t.action));
  }

  /** 离线/过期：分片枚举错过（不截断），推进 nextAt 不阻塞后续周期 */
  function chuLiMeiGuo(t: DingShiRenWuV2, n: number, reason: CuoGuoYuanYin): void {
    const st = zb.zhuangTai(t.id);
    if (!st) return;
    let yb = meiGuoYouBiaoJi.get(t.id);
    if (!yb || yb.revision !== t.revision) {
      /** 从当前到点槽开始枚举（之前已执行/已记录；过期一次性槽也在内，不静默丢） */
      const from = st.nextAt > 0 ? st.nextAt - 1 : (st.lastFireAt || t.createdAt);
      yb = { cursor: from, to: n, reason, revision: t.revision };
      meiGuoYouBiaoJi.set(t.id, yb);
    }
    const pian = meiGuoQuJian(t.trigger, yb.cursor, yb.to, MEI_PIAN_MEI_GUO);
    const xin = mingYiCuoGuo(t, pian.items, yb.reason);
    if (xin > 0) tongZhiGuiZu([{ task: t, items: pian.items, reason: yb.reason }]);
    if (!pian.wan) { yb.cursor = pian.nextFrom; return; } // 下一片继续（重启重枚举由账本去重兜底）
    meiGuoYouBiaoJi.delete(t.id);
    /** 错过不补：把下一次推到当前之后（后续周期继续；缺口存待记录，跨过时报） */
    const r = zb.chongSuanXiaCi(t.id, n);
    /** 一次性/时刻列表/随机窗口错过后无未来触发 ⇒ 停用（历史错过仍可补） */
    if (r.at === 0 && (t.trigger.kind === 'once' || t.trigger.kind === 'randomOnce' || t.trigger.kind === 'times')) {
      zb.ting(t.id, t.trigger.kind === 'times' ? 'times-missed' : 'once-missed');
    }
    zhongGua(t.id);
  }

  /** 条件任务：低占空比核对，假→真边沿或唯一事件触发；等待不占执行租约 */
  async function chuLiTiaoJian(t: DingShiRenWuV2, n: number): Promise<void> {
    if (t.trigger.kind !== 'condition') return;
    const st = zb.zhuangTai(t.id);
    if (!st) return;
    const poll = t.trigger.pollMs ?? DING_SHI_XIAN_ZHI.pollMoRenMs;
    const shang = tiaoJianPollJi.get(t.id) || 0;
    if (n - shang < poll) return;
    tiaoJianPollJi.set(t.id, n);
    let zhen = false;
    try { zhen = await yiLai.pingGu(t.trigger.predicate, t); } catch { zhen = false; }
    const eventId = t.trigger.eventId;
    const yiJian = eventId ? zb.yiJianEvent(t.id, eventId) : false;
    const bianYan = zhen && st.conditionLast !== true;
    const shiJianChuFa = !!(eventId && zhen && !yiJian);
    if (!bianYan && !shiJianChuFa) {
      if (st.conditionLast !== zhen) zb.tuiJinTiaoJian(t.id, { conditionLast: zhen });
      return;
    }
    if (zb.zaiFei(t.id) || zb.paiDui(t.id)) return; // 忙时边沿保留（conditionLast 不推进），空闲再触发
    const scheduledAt = n;
    const yi = zb.dengJiYiTu({ taskId: t.id, revision: t.revision, scheduledAt, steps: yiTuCanShu(t, scheduledAt, t.action), reason: 'condition-edge' });
    if (!yi.ok || yi.occurrence.status !== 'preparing') return;
    zb.tuiJinTiaoJian(t.id, { conditionLast: true, lastFireAt: n, ...(eventId ? { seenEvent: eventId } : {}) });
    const occ = yi.occurrence;
    genZong(paoOccurrence(t, occ, t.action).then(() => {
      /** 触发后回到当前真值沿等待（事件型由 seenEvents 防重） */
      zb.tuiJinTiaoJian(t.id, { conditionLast: zhen });
    }));
  }

  /** 补执行拾取：已决定“补”/自定义提案已确认且未关联 occurrence；不消耗 repeat、不改 nextAt */
  function shiQuBuZhiXing(): void {
    let chuLi = 0;
    for (const d of zb.daiBuZhiXingLieBiao()) {
      if (chuLi >= MEI_PIAN_BU_ZHI) break;
      const t = zb.renWu(d.taskId);
      if (!t) continue;
      if (zb.zaiFei(t.id) || zb.paiDui(t.id)) continue;
      const fuGai = buZhiXingFuGaiJi.get(d.id);
      let action = t.action;
      if (fuGai) {
        const r = yanZhengDongZuo(fuGai.action);
        if (!r.ok) continue;
        action = r.value;
      }
      const yi = zb.dengJiYiTu({ taskId: t.id, revision: t.revision, scheduledAt: d.scheduledAt, steps: yiTuCanShu(t, d.scheduledAt, action), buZhiXing: true, decisionId: d.id });
      if (!yi.ok) continue; // 槽满等：下轮再试（决定已受理，不丢）
      zb.guanLianBuZhiXing(d.id, yi.occurrence.id);
      buZhiXingFuGaiJi.delete(d.id);
      chuLi += 1;
      if (yi.occurrence.status !== 'preparing') continue; // 幂等：已执行过
      genZong(paoOccurrence(t, yi.occurrence, action));
    }
  }

  /** 一片巡检（有界工作；由心跳驱动，不自建定时器；不等待模型执行） */
  async function xunCha(ci?: { now?: number; buPao?: boolean }): Promise<void> {
    if (xunChaMang) return; // 重入保护：上一片没跑完不叠片
    xunChaMang = true;
    try {
      const n = ci?.now ?? now();
      const liXian = !!ci?.buPao || (shangCiXunCha > 0 && n - shangCiXunCha > LI_XIAN_JIAN_GE) || !!yiLai.liXianZhengJu?.();
      const huiBo = shangCiXunCha > 0 && n - shangCiXunCha < -2000;
      shangCiXunCha = n;
      const renWu = zb.renWuLieBiao().filter((t) => t.enabled && t.status === 'active');
      let chuLi = 0;
      for (const t of renWu) {
        if (chuLi >= MEI_PIAN_REN_WU) break;
        chuLi += 1;
        /** revision 变化：取消旧在飞（不复活旧任务） */
        const jiuRev = revisionJian.get(t.id);
        if (jiuRev !== undefined && jiuRev !== t.revision) quXiao(t.id, 'revision-changed');
        revisionJian.set(t.id, t.revision);
        const st0 = zb.zhuangTai(t.id);
        /** DST 缺口：跨过名义时刻才记错过（不提前预警，不自动顺延） */
        if (st0?.gapDaiJiLu && n >= st0.gapDaiJiLu) {
          mingYiCuoGuo(t, [st0.gapDaiJiLu], 'dst-gap');
          tongZhiGuiZu([{ task: t, items: [st0.gapDaiJiLu], reason: 'dst-gap' }]);
          zb.tuiJinTiaoJian(t.id, { gapDaiJiLu: null });
        }
        if (t.trigger.kind === 'condition') { await chuLiTiaoJian(t, n); continue; }
        const st = zb.zhuangTai(t.id);
        if (!st) continue;
        /** 随机类：抽样先落盘再排（重启不重抽） */
        const xia = xiaCiChuFa(t.trigger, n, st);
        if (xia.chouYangXuQiu) {
          if (!zb.queBaoChouYang(t.id, n)) {
            mingYiCuoGuo(t, [n], 'sample-gap');
            tongZhiGuiZu([{ task: t, items: [n], reason: 'sample-gap' }]);
          }
          zhongGua(t.id);
          continue;
        }
        /** 排队项优先派发（在飞已收尾时；登记时已推进水位，不重复推进） */
        const pd = zb.paiDui(t.id);
        if (pd && !zb.zaiFei(t.id)) {
          genZong(paoOccurrence(t, pd, t.action));
          continue;
        }
        if (!(st.nextAt > 0) || st.nextAt > n) continue;
        if (huiBo) { zhongGua(t.id); continue; } // 回拨：已执行项由自然键幂等挡住，只重排
        const chiDao = n - st.nextAt;
        if (liXian || chiDao > DING_SHI_XIAN_ZHI.zaiXianRongChaMs) {
          chuLiMeiGuo(t, n, liXian ? 'offline' : 'expired');
          continue;
        }
        paiFaDaoDian(t, st.nextAt, n);
      }
      /** 排队项收尾：任务停用/跑满后，已计数的排队触发仍要执行完（活跃任务主循环已处理） */
      for (const t of zb.renWuLieBiao()) {
        if (t.enabled && t.status === 'active') continue;
        const pd = zb.paiDui(t.id);
        if (pd && !zb.zaiFei(t.id)) genZong(paoOccurrence(t, pd, t.action));
      }
      shiQuBuZhiXing();
    } finally {
      xunChaMang = false;
    }
  }

  /** 取消本任务在飞（停止/软删/换 revision/退出）；只 abort 本任务的控制器 */
  function quXiao(taskId: string, reason: string): number {
    const z = zaiFeiJi.get(taskId);
    if (z) { try { z.controller.abort(); } catch { /* noop */ } zaiFeiJi.delete(taskId); }
    const n = zb.quXiaoZaiFei(taskId, reason);
    meiGuoYouBiaoJi.delete(taskId);
    try { yiLai.xinTiao.daoJiQuXiao('schv2:' + taskId); } catch { /* noop */ }
    audit('dingShi.cancel', { taskId, reason, cancelled: n });
    return n;
  }

  /** 任务定义变化后重挂闹钟（main 在 chuangJian/gai/ting 后调） */
  function chongGua(taskId: string): void {
    const t = zb.renWu(taskId);
    if (!t) return;
    const jiuRev = revisionJian.get(t.id);
    if (jiuRev !== undefined && jiuRev !== t.revision) quXiao(t.id, 'revision-changed');
    revisionJian.set(t.id, t.revision);
    guaNaodoZhong(t);
    guangBo('warmy:dingShiRenWuGengXin', { taskId });
  }

  /** 自定义提案经用户确认后登记动作覆盖（宿主已做模型解析+重新授权） */
  function buZhiXingFuGai(decisionId: string, action: unknown): { ok: boolean; error?: string } {
    const r = yanZhengDongZuo(action);
    if (!r.ok) return { ok: false, error: r.error };
    buZhiXingFuGaiJi.set(decisionId, { action: r.value });
    return { ok: true };
  }

  function qiDong(): void {
    if (yiQiDong) return;
    yiQiDong = true;
    yiLai.xinTiao.zhuCe({ id: 'ding-shi-diao-du', ming: '定时调度巡检', meiMs: xunChaMs, run: (ci) => xunCha({ now: ci.now, buPao: ci.buPao }) });
    for (const t of zb.renWuLieBiao()) {
      revisionJian.set(t.id, t.revision);
      guaNaodoZhong(t);
    }
    audit('dingShi.scheduler-start', { xunChaMs });
  }
  function tingZhi(): void {
    yiQiDong = false;
    for (const id of [...zaiFeiJi.keys()]) quXiao(id, 'scheduler-stop');
    try { yiLai.xinTiao.xinChuCe?.('ding-shi-diao-du'); } catch { /* noop */ }
  }
  /** 收齐在飞执行（测试/优雅退出用） */
  async function dengDai(): Promise<void> { await Promise.all([...yunXingZhong]); }
  function zhuangTai(): Record<string, unknown> {
    return {
      yiQiDong, shangCiXunCha, zaiFei: [...zaiFeiJi.keys()],
      meiGuoYouBiao: [...meiGuoYouBiaoJi.entries()].map(([k, v]) => ({ taskId: k, cursor: v.cursor, to: v.to, reason: v.reason })),
    };
  }

  return { qiDong, tingZhi, xunCha, quXiao, chongGua, buZhiXingFuGai, dengDai, zhuangTai };
}
export type DingShiDiaoDu = ReturnType<typeof chuangJianDingShiDiaoDu>;