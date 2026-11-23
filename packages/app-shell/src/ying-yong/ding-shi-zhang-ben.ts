/**
 * R298：定时任务持久账本 —— 执行意图/回执/错过未决/决定 CAS 的唯一 owner。
 *
 * 口径（计划《总结巡查预测发布闭环》§唯一执行取消恢复/§错过通知）：
 *  · 所有效果前持久化执行意图和授权版本；写盘失败阻断执行（cun 返回 false ⇒ 调用方不得派发）。
 *  · occurrence 身份 = task+revision+seq+原定时间；每步稳定 effectId+输入快照+真实回执。
 *  · 步骤状态：preparing/running/success/failed/cancelled/unknown；不以模型文字或提前计数认定完成。
 *  · 每任务最多一个在飞（running）+一个排队（preparing）；超出/过期交调度器转错过决定，不静默丢弃。
 *  · 错过未决是独立持久台账：不受系统消息 200 条上限影响，保留到决定或明确删除。
 *  · 决定按 decisionId+version 只受理一次（重复点击/跨窗并发/重启回放幂等）。
 *  · 补执行（buZhiXing）不消耗 repeat 计划次数、不改未来 nextAt；外部效果不承诺 exactly-once。
 *  · 崩溃恢复：读盘时 running/preparing 的在飞步骤 → unknown（结果不确定），非幂等效果不自动重试。
 *  · 修改任务生成新 revision；旧 revision 的意图登记被拒绝（不复活旧任务）。
 *
 * 构造无副作用：读盘/迁移由组合根显式调用。文件边界可注入（故障测试）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type DingShiRenWuV2, type DingShiChuFa, type DingShiDongZuo, type DingShiShouQuan, type DingShiZhuangTai,
  yanZhengChuFa, yanZhengDongZuo, yanZhengShiQu, yanZhengWeiCiZong, weiCiYiLai, jianChaYiLaiHuan,
  xiaCiChuFa, chouYangChuFa, occurrenceId, qianYiJiuDingShi, gapMingYiShiKe, type JiuDingShiRenWu, DING_SHI_XIAN_ZHI,
} from '../ji-chu/ding-shi-gui-ze.js';

export type BuZhouZhuangTai = 'preparing' | 'running' | 'success' | 'failed' | 'cancelled' | 'unknown';
export interface DingShiBuZhou {
  effectId: string;
  kind: string;
  /** 输入快照（受限 JSON 字符串；不含凭据明文） */
  snapshot: string;
  status: BuZhouZhuangTai;
  receipt?: string;
  at?: number;
}
export interface DingShiOccurrence {
  id: string;
  taskId: string;
  revision: number;
  seq: number;
  scheduledAt: number;
  status: BuZhouZhuangTai;
  steps: DingShiBuZhou[];
  createdAt: number;
  updatedAt: number;
  /** 补执行：不消耗 repeat、不改 nextAt */
  buZhiXing?: boolean;
  /** 关联的错过决定（补执行时） */
  decisionId?: string;
  reason?: string;
}
export type CuoGuoYuanYin = 'offline' | 'sleep' | 'dst-gap' | 'busy-overflow' | 'expired' | 'clock-back' | 'condition-offline' | 'sample-gap';
export interface CuoGuoJueDing {
  id: string;
  occurrenceId: string;
  taskId: string;
  revision: number;
  scheduledAt: number;
  taskName: string;
  sessionId: string;
  reason: CuoGuoYuanYin;
  createdAt: number;
  status: 'pending' | 'done' | 'dismissed' | 'custom-pending';
  /** 决定受理 CAS 版本 */
  version: number;
  choice?: 'bu' | 'buBu' | 'custom';
  choiceAt?: number;
  customText?: string;
  resolvedOccurrenceId?: string;
}
export interface DingShiJiShu { chuFa: number; changShi: number; chengGong: number; cuoGuo: number }

interface PersV2 {
  v: 2;
  tasks: DingShiRenWuV2[];
  states: Record<string, DingShiZhuangTai>;
  occurrences: DingShiOccurrence[];
  decisions: CuoGuoJueDing[];
  counters: Record<string, DingShiJiShu>;
  migratedFrom?: { file: string; at: number; count: number };
}

export interface DingShiZhangBenYiLai {
  wenJianLu: string;
  wenJianXiTong?: Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'mkdirSync' | 'renameSync'>;
  now?: () => number;
  rng?: () => number;
  audit?: (op: string, detail: unknown) => void;
}

const OCC_BAO_LIU = 500;      // 终态 occurrence 历史上限（活跃/未决不受此限）
const JUE_DING_BAO_LIU = 200; // 已决定历史保留；pending 永不淘汰
const EVENT_BAO_LIU = 200;

export function chuangJianDingShiZhangBen(yiLai: DingShiZhangBenYiLai) {
  const fsX = yiLai.wenJianXiTong ?? fs;
  const now = yiLai.now ?? (() => Date.now());
  const rng = yiLai.rng ?? (() => Math.random());
  const audit = yiLai.audit ?? (() => {});
  let pers: PersV2 = { v: 2, tasks: [], states: {}, occurrences: [], decisions: [], counters: {} };

  /* ── 持久化：原子写 + 回读核对；失败返回 false（调用方必须阻断效果） ── */
  function cun(): boolean {
    try {
      fsX.mkdirSync(path.dirname(yiLai.wenJianLu), { recursive: true });
      const lin = yiLai.wenJianLu + '.tmp';
      const wen = JSON.stringify(pers);
      fsX.writeFileSync(lin, wen, 'utf8');
      fsX.renameSync(lin, yiLai.wenJianLu);
      const hui = String(fsX.readFileSync(yiLai.wenJianLu, 'utf8'));
      if (hui.length !== wen.length) return false;
      const j = JSON.parse(hui) as PersV2;
      if (!j || j.v !== 2 || j.tasks.length !== pers.tasks.length || j.decisions.length !== pers.decisions.length) return false;
      return true;
    } catch { return false; }
  }
  function caiJian(): void {
    const zhongTai = pers.occurrences.filter((o) => o.status === 'preparing' || o.status === 'running');
    const liShi = pers.occurrences.filter((o) => o.status !== 'preparing' && o.status !== 'running').slice(-OCC_BAO_LIU);
    pers.occurrences = [...liShi, ...zhongTai];
    const weiJue = pers.decisions.filter((d) => d.status === 'pending' || d.status === 'custom-pending');
    const yiJue = pers.decisions.filter((d) => d.status === 'done' || d.status === 'dismissed').slice(-JUE_DING_BAO_LIU);
    pers.decisions = [...yiJue, ...weiJue];
  }

  /** 读盘 + 崩溃恢复（在飞→unknown，不自动重试）；组合根启动时显式调用 */
  function du(): { ok: boolean; recovered: number } {
    let recovered = 0;
    try {
      const j = JSON.parse(String(fsX.readFileSync(yiLai.wenJianLu, 'utf8'))) as PersV2;
      if (j && j.v === 2 && Array.isArray(j.tasks)) {
        pers = {
          v: 2, tasks: j.tasks, states: j.states || {}, occurrences: Array.isArray(j.occurrences) ? j.occurrences : [],
          decisions: Array.isArray(j.decisions) ? j.decisions : [], counters: j.counters || {},
          ...(j.migratedFrom ? { migratedFrom: j.migratedFrom } : {}),
        };
      }
    } catch { /* 首次没有/写坏了：从空账本开始，不挡启动 */ }
    for (const o of pers.occurrences) {
      if (o.status === 'running' || o.status === 'preparing') {
        o.status = 'unknown'; o.updatedAt = now(); o.reason = 'crash-recovery';
        for (const s of o.steps) if (s.status === 'running' || s.status === 'preparing') { s.status = 'unknown'; s.at = now(); }
        recovered += 1;
      }
    }
    if (recovered > 0) { caiJian(); cun(); audit('dingShi.journal-recover', { recovered }); }
    return { ok: true, recovered };
  }

  function jiShuOf(taskId: string): DingShiJiShu {
    let c = pers.counters[taskId];
    if (!c) { c = { chuFa: 0, changShi: 0, chengGong: 0, cuoGuo: 0 }; pers.counters[taskId] = c; }
    return c;
  }
  function zhuangTaiOf(taskId: string, revision: number): DingShiZhuangTai {
    let st = pers.states[taskId];
    if (!st || st.revision !== revision) {
      st = { taskId, revision, nextAt: 0, seq: st?.seq ?? 0 };
      pers.states[taskId] = st;
    }
    return st;
  }

  /** 随机触发：抽样一次并先落盘，再排下一次（重启不重抽、不提前副作用）。
   *  取 taskId 而非状态对象：外部拿到的是副本，改副本不会落账。 */
  function queBaoChouYang(taskId: string, n: number): boolean {
    const ren = pers.tasks.find((x) => x.id === taskId);
    if (!ren) return false;
    const st = zhuangTaiOf(ren.id, ren.revision);
    const r = xiaCiChuFa(ren.trigger, n, st);
    if (!r.chouYangXuQiu) return true;
    const yb = chouYangChuFa(ren.trigger, n, rng, st);
    if (!yb) return false; // 抽样落在 DST 缺口等：交调度器记错过，不悄悄换时间
    st.yangBen = yb;
    st.nextAt = yb.at;
    return cun();
  }

  /** 重算下一次（锚点推进/日历/时刻列表）；随机先抽样落盘；DST 缺口存待记录名义时刻 */
  function chongSuanXiaCi(taskId: string, n: number): { at: number; gapWall?: number; persistOk: boolean } {
    const ren = pers.tasks.find((x) => x.id === taskId);
    if (!ren) return { at: 0, persistOk: false };
    const st = zhuangTaiOf(ren.id, ren.revision);
    const r = xiaCiChuFa(ren.trigger, n, st);
    if (r.chouYangXuQiu) {
      const ok = queBaoChouYang(ren.id, n);
      return { at: ok ? st.nextAt : 0, persistOk: ok };
    }
    st.nextAt = r.at;
    if (r.gapWall) st.gapDaiJiLu = gapMingYiShiKe(r.gapWall, ren.tz, n);
    const ok = cun();
    return { at: r.at, ...(r.gapWall ? { gapWall: r.gapWall } : {}), persistOk: ok };
  }

  /* ── 任务 CRUD（软删留档，变更不删旧） ── */
  function renWuLieBiao(): DingShiRenWuV2[] { return pers.tasks.map((t) => ({ ...t })); }
  function renWu(id: string): DingShiRenWuV2 | undefined { const t = pers.tasks.find((x) => x.id === id); return t ? { ...t } : undefined; }

  function chuangJian(spec: {
    id?: string; sessionId: string; name: string; trigger: unknown; action: unknown;
    repeat?: number; tz?: string; shouQuan: DingShiShouQuan; planRef?: { planId: string; stepId: string };
    desc?: string; liShiCiShu?: number; enabled?: boolean; status?: 'active' | 'stopped';
  }): { ok: true; task: DingShiRenWuV2 } | { ok: false; error: string } {
    const n = now();
    const tzR = yanZhengShiQu(spec.tz);
    if (!tzR.ok) return { ok: false, error: tzR.error };
    const trig = yanZhengChuFa(spec.trigger, n);
    if (!trig.ok) return { ok: false, error: trig.error };
    const act = yanZhengDongZuo(spec.action);
    if (!act.ok) return { ok: false, error: act.error };
    if (!spec.shouQuan || !Array.isArray(spec.shouQuan.scope) || spec.shouQuan.version < 1) return { ok: false, error: 'need-fixed-scope-authorization' };
    const id = String(spec.id || `sch-${n}-${Math.random().toString(36).slice(2, 6)}`).slice(0, DING_SHI_XIAN_ZHI.idMax);
    /** 依赖环拒绝保存（条件谓词里的 taskStatus/planStep 折算成边；用稳定 id 检自环） */
    if (trig.value.kind === 'condition') {
      const edges = new Map<string, string[]>();
      for (const t of pers.tasks) {
        if (t.trigger.kind !== 'condition') continue;
        const e = weiCiYiLai(t.trigger.predicate);
        edges.set(t.id, [...e.tasks, ...e.plans]);
      }
      const e = weiCiYiLai(trig.value.predicate);
      edges.set(id, [...e.tasks, ...e.plans]);
      const huan = jianChaYiLaiHuan(edges);
      if (huan) return { ok: false, error: 'dependency-cycle:' + huan.join('>') };
    }
    if (pers.tasks.some((t) => t.id === id)) return { ok: false, error: 'duplicate-id' };
    const task: DingShiRenWuV2 = {
      id, revision: 1, sessionId: String(spec.sessionId || '').slice(0, DING_SHI_XIAN_ZHI.idMax),
      name: String(spec.name || '定时任务').slice(0, DING_SHI_XIAN_ZHI.nameMax),
      desc: String(spec.desc || '').slice(0, DING_SHI_XIAN_ZHI.descMax),
      tz: tzR.value, trigger: trig.value, action: act.value,
      repeat: Math.max(0, Math.floor(Number(spec.repeat) || 0)),
      enabled: spec.enabled !== false, status: spec.status === 'stopped' ? 'stopped' : 'active',
      createdAt: n, updatedAt: n, shouQuan: spec.shouQuan,
      ...(spec.planRef ? { planRef: spec.planRef } : {}),
      ...(spec.liShiCiShu ? { liShiCiShu: Math.floor(spec.liShiCiShu) } : {}),
    };
    pers.tasks.push(task);
    zhuangTaiOf(id, 1);
    const xia = chongSuanXiaCi(id, n);
    /** 创建时已过期的一次性/时刻列表：保留原到点作为水位，交调度器记错过（不静默跳过） */
    if (xia.at === 0 && (task.trigger.kind === 'once' || task.trigger.kind === 'times')) {
      const stGuo = pers.states[id];
      const yuan = task.trigger.kind === 'once' ? task.trigger.at : (task.trigger.list[0] ?? 0);
      if (stGuo && yuan > 0 && yuan <= n) { stGuo.nextAt = yuan; cun(); }
    }
    if (!xia.persistOk) { pers.tasks = pers.tasks.filter((t) => t.id !== id); delete pers.states[id]; cun(); return { ok: false, error: 'persist-failed' }; }
    audit('dingShi.create', { taskId: id, sessionId: task.sessionId, trigger: task.trigger.kind, nextAt: pers.states[id]?.nextAt ?? 0 });
    return { ok: true, task: { ...task } };
  }

  /** 修改 ⇒ 新 revision；旧 revision 的在飞由调度器取消；历史停止/替换记录保留 */
  function gai(id: string, patch: { trigger?: unknown; action?: unknown; name?: string; repeat?: number; shouQuan?: DingShiShouQuan; planRef?: { planId: string; stepId: string }; enabled?: boolean }): { ok: true; task: DingShiRenWuV2 } | { ok: false; error: string } {
    const t = pers.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: 'not-found' };
    const n = now();
    if (patch.trigger !== undefined) {
      const r = yanZhengChuFa(patch.trigger, n);
      if (!r.ok) return { ok: false, error: r.error };
      if (r.value.kind === 'condition') {
        const edges = new Map<string, string[]>();
        for (const x of pers.tasks) { if (x.trigger.kind === 'condition' && x.id !== id) { const e = weiCiYiLai(x.trigger.predicate); edges.set(x.id, [...e.tasks, ...e.plans]); } }
        const e = weiCiYiLai(r.value.predicate);
        edges.set(id, [...e.tasks, ...e.plans]);
        const huan = jianChaYiLaiHuan(edges);
        if (huan) return { ok: false, error: 'dependency-cycle:' + huan.join('>') };
      }
      t.trigger = r.value;
    }
    if (patch.action !== undefined) {
      const r = yanZhengDongZuo(patch.action);
      if (!r.ok) return { ok: false, error: r.error };
      t.action = r.value;
    }
    if (patch.name !== undefined) t.name = String(patch.name).slice(0, DING_SHI_XIAN_ZHI.nameMax);
    if (patch.repeat !== undefined) t.repeat = Math.max(0, Math.floor(Number(patch.repeat) || 0));
    if (patch.shouQuan) {
      if (!Array.isArray(patch.shouQuan.scope) || patch.shouQuan.version < 1) return { ok: false, error: 'need-fixed-scope-authorization' };
      t.shouQuan = patch.shouQuan;
    }
    if (patch.planRef) t.planRef = patch.planRef;
    if (patch.enabled !== undefined) { t.enabled = !!patch.enabled; if (t.enabled) { t.status = 'active'; delete t.stoppedReason; } }
    t.revision += 1;
    t.updatedAt = n;
    const st = zhuangTaiOf(id, t.revision);
    st.yangBen = undefined; st.conditionLast = undefined;
    const xia = chongSuanXiaCi(id, n);
    if (!xia.persistOk) return { ok: false, error: 'persist-failed' };
    audit('dingShi.revise', { taskId: id, revision: t.revision });
    return { ok: true, task: { ...t } };
  }

  /** 停止/软删除：留档不复活；在飞取消由调度器执行（只操作本任务拥有的 PID/请求） */
  function ting(id: string, reason: string, replacedBy?: string): { ok: boolean; error?: string } {
    const t = pers.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: 'not-found' };
    t.enabled = false; t.status = 'stopped';
    t.stoppedReason = String(reason || 'user-stop').slice(0, 120);
    t.stoppedAt = now();
    if (replacedBy) t.replacedBy = String(replacedBy).slice(0, DING_SHI_XIAN_ZHI.idMax);
    const st = pers.states[id];
    if (st) st.nextAt = 0;
    if (!cun()) return { ok: false, error: 'persist-failed' };
    audit('dingShi.stop', { taskId: id, reason: t.stoppedReason, replacedBy });
    return { ok: true };
  }

  /* ── 执行意图/回执（效果前落盘；写失败阻断） ── */
  function zhanYong(taskId: string): { running: number; preparing: number } {
    let running = 0, preparing = 0;
    for (const o of pers.occurrences) {
      if (o.taskId !== taskId) continue;
      if (o.status === 'running') running += 1;
      else if (o.status === 'preparing') preparing += 1;
    }
    return { running, preparing };
  }

  function dengJiYiTu(zhi: {
    taskId: string; revision: number; scheduledAt: number;
    steps: Array<{ effectId: string; kind: string; snapshot: string }>;
    buZhiXing?: boolean; decisionId?: string; reason?: string;
  }): { ok: true; occurrence: DingShiOccurrence; yiCunZai?: boolean } | { ok: false; error: string } {
    const t = pers.tasks.find((x) => x.id === zhi.taskId);
    if (!t) return { ok: false, error: 'not-found' };
    if (t.revision !== zhi.revision) return { ok: false, error: 'stale-revision' };
    if (!t.enabled && !zhi.buZhiXing) return { ok: false, error: 'task-stopped' };
    if (!Array.isArray(zhi.steps) || zhi.steps.length < 1 || zhi.steps.length > DING_SHI_XIAN_ZHI.stepsMax) return { ok: false, error: 'bad-steps' };
    const st = zhuangTaiOf(t.id, t.revision);
    /** 幂等键 = 自然触发槽（任务+revision+原定时刻[+决定]）；seq 会推进，不能用它认重试 */
    const jiu = pers.occurrences.find((o) => o.taskId === t.id && o.revision === t.revision && o.scheduledAt === zhi.scheduledAt
      && (zhi.buZhiXing ? o.decisionId === zhi.decisionId : !o.buZhiXing));
    if (jiu) return { ok: true, occurrence: { ...jiu }, yiCunZai: true }; // 同一意图不登记两份
    const zy = zhanYong(t.id);
    /** 每任务最多一个在飞 + 一个排队；补执行也占执行槽，不插队 */
    if (zy.preparing >= 1) return { ok: false, error: 'slot-full' };
    if (zy.running >= 1 && zhi.buZhiXing) return { ok: false, error: 'slot-full' };
    const n = now();
    const seq = st.seq;
    const oid = zhi.buZhiXing && zhi.decisionId
      ? `${occurrenceId(t.id, t.revision, seq, zhi.scheduledAt)}:bu:${zhi.decisionId}`
      : occurrenceId(t.id, t.revision, seq, zhi.scheduledAt);
    const occ: DingShiOccurrence = {
      id: oid, taskId: t.id, revision: t.revision, seq, scheduledAt: zhi.scheduledAt,
      status: 'preparing',
      steps: zhi.steps.map((s) => ({ effectId: String(s.effectId).slice(0, 160), kind: String(s.kind).slice(0, 40), snapshot: String(s.snapshot).slice(0, 4000), status: 'preparing' as const })),
      createdAt: n, updatedAt: n,
      ...(zhi.buZhiXing ? { buZhiXing: true } : {}),
      ...(zhi.decisionId ? { decisionId: zhi.decisionId } : {}),
      ...(zhi.reason ? { reason: String(zhi.reason).slice(0, 120) } : {}),
    };
    pers.occurrences.push(occ);
    if (!zhi.buZhiXing) { st.seq += 1; jiShuOf(t.id).chuFa += 1; }
    caiJian();
    if (!cun()) {
      pers.occurrences = pers.occurrences.filter((o) => o.id !== oid);
      if (!zhi.buZhiXing) { st.seq -= 1; jiShuOf(t.id).chuFa -= 1; }
      cun();
      return { ok: false, error: 'persist-failed' };
    }
    audit('dingShi.intent', { occurrenceId: oid, taskId: t.id, revision: t.revision, scheduledAt: zhi.scheduledAt, buZhiXing: !!zhi.buZhiXing, steps: occ.steps.length });
    return { ok: true, occurrence: { ...occ } };
  }

  /** 派发前推进到 running（尝试计数在这里，不在触发时预支成功） */
  function kaiShi(oid: string): boolean {
    const o = pers.occurrences.find((x) => x.id === oid);
    if (!o || o.status !== 'preparing') return false;
    o.status = 'running'; o.updatedAt = now();
    jiShuOf(o.taskId).changShi += 1;
    if (!cun()) { o.status = 'preparing'; jiShuOf(o.taskId).changShi -= 1; return false; }
    return true;
  }

  function buZhouKaiShi(oid: string, effectId: string): boolean {
    const o = pers.occurrences.find((x) => x.id === oid);
    const s = o?.steps.find((x) => x.effectId === effectId);
    if (!o || !s || s.status !== 'preparing') return false;
    s.status = 'running'; s.at = now(); o.updatedAt = now();
    return cun();
  }

  /** 真实回执落账；unknown 不自动重试（调用方决定） */
  function luHuiZhi(oid: string, effectId: string, status: 'success' | 'failed' | 'cancelled' | 'unknown', receipt?: string): boolean {
    const o = pers.occurrences.find((x) => x.id === oid);
    const s = o?.steps.find((x) => x.effectId === effectId);
    if (!o || !s) return false;
    if (s.status === 'success' || s.status === 'failed' || s.status === 'cancelled') return true; // 终态回执只受理一次
    s.status = status; s.receipt = String(receipt || '').slice(0, 2000); s.at = now(); o.updatedAt = now();
    const ok = cun();
    audit('dingShi.receipt', { occurrenceId: oid, effectId, status, persistOk: ok });
    return ok;
  }

  /** 收尾：整体状态由步骤真实回执聚合，不由模型文字认定 */
  function jieShu(oid: string, status?: BuZhouZhuangTai): boolean {
    const o = pers.occurrences.find((x) => x.id === oid);
    if (!o) return false;
    if (o.status !== 'running' && o.status !== 'preparing' && o.status !== 'unknown') return true;
    let zt: BuZhouZhuangTai;
    if (status) zt = status;
    else if (o.steps.some((s) => s.status === 'unknown')) zt = 'unknown';
    else if (o.steps.some((s) => s.status === 'failed')) zt = 'failed';
    else if (o.steps.some((s) => s.status === 'cancelled')) zt = 'cancelled';
    else if (o.steps.every((s) => s.status === 'success')) zt = 'success';
    else zt = 'unknown';
    o.status = zt; o.updatedAt = now();
    /** 成功计数按 occurrence 聚合（mixed 多步不算多次成功） */
    if (zt === 'success') jiShuOf(o.taskId).chengGong += 1;
    caiJian();
    const ok = cun();
    if (!ok && zt === 'success') jiShuOf(o.taskId).chengGong -= 1;
    audit('dingShi.finish', { occurrenceId: oid, taskId: o.taskId, status: zt, buZhiXing: !!o.buZhiXing });
    return ok;
  }

  /** 取消在飞/排队（停止任务、旧 revision、用户取消）；只改本任务 occurrence */
  function quXiaoZaiFei(taskId: string, reason: string): number {
    let n = 0;
    for (const o of pers.occurrences) {
      if (o.taskId !== taskId || (o.status !== 'running' && o.status !== 'preparing')) continue;
      o.status = 'cancelled'; o.reason = String(reason).slice(0, 120); o.updatedAt = now();
      for (const s of o.steps) if (s.status === 'preparing' || s.status === 'running') { s.status = 'cancelled'; s.at = now(); }
      n += 1;
    }
    if (n > 0) cun();
    return n;
  }

  /* ── 错过未决台账（独立持久，不受消息上限淘汰） ── */
  function jiCuoGuo(zhi: { taskId: string; scheduledAt: number; reason: CuoGuoYuanYin; revision?: number }): { ok: true; decision: CuoGuoJueDing; yiCunZai?: boolean } | { ok: false; error: string } {
    const t = pers.tasks.find((x) => x.id === zhi.taskId);
    if (!t) return { ok: false, error: 'not-found' };
    const rev = zhi.revision ?? t.revision;
    const oid = occurrenceId(t.id, rev, pers.states[t.id]?.seq ?? 0, zhi.scheduledAt);
    /** 同一任务同一原定时刻的未决只一条（seq 会随后续触发推进，去重认任务+时刻） */
    const jiu = pers.decisions.find((d) => d.taskId === t.id && d.scheduledAt === zhi.scheduledAt && (d.status === 'pending' || d.status === 'custom-pending'));
    if (jiu) return { ok: true, decision: { ...jiu }, yiCunZai: true };
    const n = now();
    const d: CuoGuoJueDing = {
      id: 'dec:' + oid, occurrenceId: oid, taskId: t.id, revision: rev, scheduledAt: zhi.scheduledAt,
      taskName: t.name, sessionId: t.sessionId, reason: zhi.reason, createdAt: n,
      status: 'pending', version: 1,
    };
    pers.decisions.push(d);
    jiShuOf(t.id).cuoGuo += 1;
    caiJian();
    if (!cun()) { pers.decisions = pers.decisions.filter((x) => x.id !== d.id); jiShuOf(t.id).cuoGuo -= 1; cun(); return { ok: false, error: 'persist-failed' }; }
    audit('dingShi.missed', { taskId: t.id, scheduledAt: zhi.scheduledAt, reason: zhi.reason, decisionId: d.id });
    return { ok: true, decision: { ...d } };
  }

  /** 决定受理：decisionId+version CAS，只受理一次；已读消息≠决定 */
  function jueDing(decisionId: string, version: number, choice: 'bu' | 'buBu' | 'custom', customText?: string): { ok: true; decision: CuoGuoJueDing } | { ok: false; error: string } {
    const d = pers.decisions.find((x) => x.id === decisionId);
    if (!d) return { ok: false, error: 'not-found' };
    if (d.status !== 'pending') return { ok: false, error: 'already-resolved' };
    if (d.version !== version) return { ok: false, error: 'version-conflict' };
    if (choice === 'custom') {
      const wen = String(customText || '').trim();
      if (!wen || wen.length > 2000) return { ok: false, error: 'custom-text-required' };
      d.status = 'custom-pending'; d.choice = 'custom'; d.customText = wen.slice(0, 2000);
    } else {
      d.status = choice === 'bu' ? 'done' : 'dismissed';
      d.choice = choice;
    }
    d.choiceAt = now(); d.version += 1;
    if (!cun()) { d.status = 'pending'; d.version -= 1; delete d.choice; delete d.choiceAt; delete d.customText; return { ok: false, error: 'persist-failed' }; }
    audit('dingShi.decision', { decisionId, choice, version: d.version });
    return { ok: true, decision: { ...d } };
  }

  /** 自行输入解析后的落账：接受提案→done（补执行 occurrence 由调度器登记）；拒绝→dismissed */
  function customJieGuo(decisionId: string, version: number, accepted: boolean, resolvedOccurrenceId?: string): { ok: boolean; error?: string } {
    const d = pers.decisions.find((x) => x.id === decisionId);
    if (!d) return { ok: false, error: 'not-found' };
    if (d.status !== 'custom-pending') return { ok: false, error: 'not-custom-pending' };
    if (d.version !== version) return { ok: false, error: 'version-conflict' };
    d.status = accepted ? 'done' : 'dismissed';
    d.version += 1;
    if (resolvedOccurrenceId) d.resolvedOccurrenceId = resolvedOccurrenceId;
    if (!cun()) { d.status = 'custom-pending'; d.version -= 1; return { ok: false, error: 'persist-failed' }; }
    return { ok: true };
  }

  /** 补执行 occurrence 与决定关联（不消耗 repeat 的凭据） */
  function guanLianBuZhiXing(decisionId: string, oid: string): boolean {
    const d = pers.decisions.find((x) => x.id === decisionId);
    if (!d) return false;
    d.resolvedOccurrenceId = oid;
    return cun();
  }

  function weiJueLieBiao(opts?: { taskId?: string; from?: number; to?: number; limit?: number; cursor?: number }): { items: CuoGuoJueDing[]; nextCursor: number; total: number } {
    let lie = pers.decisions.filter((d) => d.status === 'pending' || d.status === 'custom-pending');
    const taskId = opts?.taskId, from = opts?.from, to = opts?.to;
    if (taskId) lie = lie.filter((d) => d.taskId === taskId);
    if (from !== undefined) lie = lie.filter((d) => d.scheduledAt >= from);
    if (to !== undefined) lie = lie.filter((d) => d.scheduledAt <= to);
    lie.sort((a, b) => a.scheduledAt - b.scheduledAt);
    const total = lie.length;
    const cursor = Math.max(0, opts?.cursor ?? 0);
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const items = lie.slice(cursor, cursor + limit).map((d) => ({ ...d }));
    return { items, nextCursor: cursor + items.length, total };
  }

  /** 待补执行：已决定“补”/自定义已确认且未关联 occurrence，且 revision 仍是当前（旧任务变更不自动补） */
  function daiBuZhiXingLieBiao(): CuoGuoJueDing[] {
    return pers.decisions
      .filter((d) => d.status === 'done' && (d.choice === 'bu' || d.choice === 'custom') && !d.resolvedOccurrenceId)
      .filter((d) => { const t = pers.tasks.find((x) => x.id === d.taskId); return !!t && t.revision === d.revision; })
      .map((d) => ({ ...d }));
  }
  /** 任务已变更的旧补执行决定：不自动执行，供界面提示重新确认 */
  function guoQiBuZhiXingLieBiao(): CuoGuoJueDing[] {
    return pers.decisions
      .filter((d) => d.status === 'done' && (d.choice === 'bu' || d.choice === 'custom') && !d.resolvedOccurrenceId)
      .filter((d) => { const t = pers.tasks.find((x) => x.id === d.taskId); return !t || t.revision !== d.revision; })
      .map((d) => ({ ...d }));
  }

  /** 明确删除已决定历史（pending 不允许经此删除；用户删未决须先决定） */
  function shanChuYiJue(decisionId: string): boolean {
    const i = pers.decisions.findIndex((d) => d.id === decisionId);
    if (i < 0) return false;
    const d = pers.decisions[i]!;
    if (d.status === 'pending' || d.status === 'custom-pending') return false;
    pers.decisions.splice(i, 1);
    return cun();
  }

  /** 会话真删（R245 purge 专用，非用户日常删除）：清掉该会话全部任务/状态/执行/决定 */
  function qingLiHuiHuaRenWu(sessionId: string): number {
    const ids = new Set(pers.tasks.filter((t) => t.sessionId === sessionId).map((t) => t.id));
    if (!ids.size) return 0;
    pers.tasks = pers.tasks.filter((t) => !ids.has(t.id));
    pers.occurrences = pers.occurrences.filter((o) => !ids.has(o.taskId));
    pers.decisions = pers.decisions.filter((d) => !ids.has(d.taskId));
    for (const id of ids) { delete pers.states[id]; delete pers.counters[id]; }
    caiJian();
    cun();
    return ids.size;
  }

  /* ── 查询/状态 ── */
  function zhuangTai(taskId: string): DingShiZhuangTai | undefined { const s = pers.states[taskId]; return s ? { ...s } : undefined; }
  function jiShu(taskId: string): DingShiJiShu { return { ...jiShuOf(taskId) }; }
  function occurrenceLieBiao(taskId: string, limit = 50): DingShiOccurrence[] {
    return pers.occurrences.filter((o) => o.taskId === taskId).slice(-limit).map((o) => ({ ...o, steps: o.steps.map((s) => ({ ...s })) }));
  }
  function zaiFei(taskId: string): DingShiOccurrence | undefined {
    const o = pers.occurrences.find((x) => x.taskId === taskId && x.status === 'running');
    return o ? { ...o } : undefined;
  }
  function paiDui(taskId: string): DingShiOccurrence | undefined {
    const o = pers.occurrences.find((x) => x.taskId === taskId && x.status === 'preparing');
    return o ? { ...o } : undefined;
  }

  /** 条件状态推进（边沿/事件消费）：落盘失败返回 false，调度器不得据此触发 */
  function tuiJinTiaoJian(taskId: string, patch: { conditionLast?: boolean; seenEvent?: string; lastFireAt?: number; nextAt?: number; gapDaiJiLu?: number | null }): boolean {
    const t = pers.tasks.find((x) => x.id === taskId);
    if (!t) return false;
    const st = zhuangTaiOf(taskId, t.revision);
    if (patch.conditionLast !== undefined) st.conditionLast = patch.conditionLast;
    if (patch.lastFireAt !== undefined) st.lastFireAt = patch.lastFireAt;
    if (patch.nextAt !== undefined) st.nextAt = patch.nextAt;
    if (patch.gapDaiJiLu !== undefined) st.gapDaiJiLu = patch.gapDaiJiLu;
    if (patch.seenEvent) {
      const seen = st.seenEvents || [];
      if (seen.includes(patch.seenEvent)) return true; // 唯一事件只消费一次
      seen.push(patch.seenEvent);
      st.seenEvents = seen.slice(-EVENT_BAO_LIU);
    }
    return cun();
  }
  function yiJianEvent(taskId: string, eventId: string): boolean {
    return !!(pers.states[taskId]?.seenEvents || []).includes(eventId);
  }

  /** 触发后推进水位与下一次（锚点不漂移；补执行不走这里） */
  function chuFaHouTuiJin(taskId: string, scheduledAt: number): { nextAt: number; gapWall?: number; persistOk: boolean } {
    const t = pers.tasks.find((x) => x.id === taskId);
    if (!t) return { nextAt: 0, persistOk: false };
    /** 已停用任务不推进水位（停止/替换后不得复活旧周期） */
    if (!t.enabled) return { nextAt: 0, persistOk: true };
    const st = zhuangTaiOf(taskId, t.revision);
    st.lastFireAt = scheduledAt;
    /** repeat 用尽 ⇒ 停用（触发计数在 dengJiYiTu 已记；补执行不计） */
    if (t.repeat > 0 && jiShuOf(taskId).chuFa >= t.repeat) {
      t.enabled = false; t.status = 'stopped'; t.stoppedReason = 'repeat-exhausted'; t.stoppedAt = now();
      st.nextAt = 0;
      const ok = cun();
      audit('dingShi.exhausted', { taskId, chuFa: jiShuOf(taskId).chuFa, repeat: t.repeat });
      return { nextAt: 0, persistOk: ok };
    }
    const r = chongSuanXiaCi(t.id, Math.max(now(), scheduledAt));
    /** 一次性/时刻列表/随机窗口用尽 ⇒ 自动停用（完成不再触发） */
    if (r.at === 0 && (t.trigger.kind === 'once' || t.trigger.kind === 'randomOnce' || t.trigger.kind === 'times')) {
      t.enabled = false; t.status = 'stopped'; t.stoppedReason = t.trigger.kind === 'times' ? 'times-done' : 'once-done'; t.stoppedAt = now();
      const ok2 = cun();
      return { nextAt: 0, persistOk: r.persistOk && ok2 };
    }
    return { nextAt: r.at, ...(r.gapWall ? { gapWall: r.gapWall } : {}), persistOk: r.persistOk };
  }

  /* ── 旧账本迁移（保留原文件；旧计数只作历史） ── */
  function qianYiJiuWenJian(jiuLu: string): { ok: boolean; migrated: number; skipped: number } {
    if (pers.migratedFrom) return { ok: true, migrated: 0, skipped: 0 };
    let jiu: JiuDingShiRenWu[] = [];
    try {
      const j = JSON.parse(String(fsX.readFileSync(jiuLu, 'utf8')));
      if (Array.isArray(j)) jiu = j;
    } catch { return { ok: true, migrated: 0, skipped: 0 }; }
    let migrated = 0, skipped = 0;
    const n = now();
    for (const r of jiu) {
      if (!r || typeof r.id !== 'string') { skipped += 1; continue; }
      if (pers.tasks.some((t) => t.id === r.id)) { skipped += 1; continue; }
      const m = qianYiJiuDingShi(r, n);
      if (!m.ok) { skipped += 1; continue; }
      pers.tasks.push(m.value);
      const st = zhuangTaiOf(m.value.id, 1);
      /** 旧幂等键：崩在触发后落盘前的那一次不复活 */
      if (r.zuiHouChuFaAt > 0) st.lastFireAt = r.zuiHouChuFaAt;
      const base = Math.max(n, r.zuiHouChuFaAt || 0);
      const xia = xiaCiChuFa(m.value.trigger, base, st);
      st.nextAt = xia.at;
      migrated += 1;
    }
    pers.migratedFrom = { file: jiuLu, at: n, count: migrated };
    caiJian();
    const ok = cun();
    audit('dingShi.migrate', { from: jiuLu, migrated, skipped, persistOk: ok });
    return { ok, migrated, skipped };
  }

  return {
    du, cun, renWuLieBiao, renWu, chuangJian, gai, ting,
    dengJiYiTu, kaiShi, buZhouKaiShi, luHuiZhi, jieShu, quXiaoZaiFei, zhanYong,
    jiCuoGuo, jueDing, customJieGuo, guanLianBuZhiXing, weiJueLieBiao, daiBuZhiXingLieBiao, guoQiBuZhiXingLieBiao, shanChuYiJue,
    zhuangTai, jiShu, occurrenceLieBiao, zaiFei, paiDui, qingLiHuiHuaRenWu,
    tuiJinTiaoJian, yiJianEvent, chuFaHouTuiJin, chongSuanXiaCi, queBaoChouYang,
    qianYiJiuWenJian,
  };
}
export type DingShiZhangBen = ReturnType<typeof chuangJianDingShiZhangBen>;