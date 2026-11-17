/**
 * harness-host —— Harness² 借鉴方案的宿主调度层（R231，方案 §8/§11/§12/§14/§16 阶段4）。
 *
 * 职责：manifest 冻结与批准事件绑定、A/B 随机交错串行调度、safe 工具执行、
 * 真实请求 ticket 绑定（经 providers shiYanGuanCha）、证据封存、独立验收、结构化 report。
 * 离线 fake provider 贯通管道；真实模型试点需主人批准后才接（§22）。
 *
 * 边界：不 import renderer；普通调用不带实验上下文零影响；keep_baseline 始终合法。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ShiYanManifest, ShiYanBi, YunXingZhuangTai, YunXingShouJu, ZiYuanZongLiang, ShiYanJueCe } from '@warmy/contracts';
import type { MoxingGongYing, LiaoTianQingQiu, LiaoTianXiangYing, LiaoTianPian, GongYingXieYi } from '@warmy/providers';
import { shiYanFaSongXuKe, neiRongWenBen } from '@warmy/providers';
import {
  ShiYanShiJianLiu, YuSuanZhangBen, ZhengJuKu, jiaoYanManifest, peiZhiHash, xinId,
  executionKeyOf, shiYanGongJuCeLue, yanShouResult, sha256Bytes,
  type ShiYanGongJuShangXiaWen,
} from './harness-experiment.js';

/** 版本化确定性 PRNG（mulberry32；seed 字符串先 hash 成 uint32）——方案 §14.3 */
export function mulberry32(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShiYanTask {
  taskId: string;
  /** 源输入原始字节（宿主提供，模型只经 safe 工具读） */
  source: Buffer;
  rows: Array<{ id: string; amount: string }>;
}
export interface PiZhunShiJian {
  approvalEventId: string;
  manifestHash: string;
  scope: string;
  ts: number;
}
export interface ShiYanRunJieGuo {
  taskId: string;
  arm: ShiYanBi;
  replicate: number;
  runId: string;
  state: YunXingShouJu['state'];
  verdict: 'pass' | 'fail' | 'unknown' | 'not_applicable';
  firstOutcome: 'pass' | 'fail' | 'unknown';
  reasonCode?: string;
  totals: ZiYuanZongLiang;
}
export interface ShiYanReport {
  manifestHash: string;
  taskIds: string[];
  assigned: number;
  executed: number;
  delivered: number;
  evaluable: number;
  missing: number;
  cancelled: number;
  runs: ShiYanRunJieGuo[];
  win: number; tie: number; loss: number;
  decision: ShiYanJueCe;
  reasonCode?: string;
  unknowns: string[];
}

const kongTotals = (): ZiYuanZongLiang => ({
  modelAttempts: 0, confirmedSent: 0, inDoubtPossibleSend: 0, conservativelyConsumedTickets: 0,
  toolCalls: 0, inputTokens: null, generationTokens: null, cachedInputTokens: null,
  usageStatus: 'unknown', elapsedMs: 0,
});

export class ShiYanHost {
  private liu: ShiYanShiJianLiu;
  private zhang: YuSuanZhangBen;
  private zheng: ZhengJuKu;
  private root: string;
  constructor(root: string, liu: ShiYanShiJianLiu, zhang: YuSuanZhangBen, zheng: ZhengJuKu) {
    this.root = root; this.liu = liu; this.zhang = zhang; this.zheng = zheng;
  }
  /** 冻结 manifest：校验 + 批准事件绑定 hash（§11.1）；不符拒绝 */
  dongJie(m: ShiYanManifest, pz: PiZhunShiJian): { ok: boolean; manifestHash?: string; reason?: string } {
    const cuo = jiaoYanManifest(m);
    if (cuo.length) return { ok: false, reason: cuo[0] };
    const hash = peiZhiHash(m);
    if (pz.manifestHash !== hash || pz.approvalEventId !== m.approvalEventId) return { ok: false, reason: 'invalid_manifest: approval binding' };
    this.liu.zhuiJia('experiment.created', { manifestHash: hash, approvalEventId: pz.approvalEventId });
    this.liu.zhuiJia('experiment.frozen', { manifestHash: hash });
    return { ok: true, manifestHash: hash };
  }
  /** A/B 串行随机交错（§11.3）；每 run 独立输出目录；ticket 经 observer 绑定 */
  async paoShiYan(m: ShiYanManifest, tasks: ShiYanTask[], provider: MoxingGongYing, opts?: { candidateInstruction?: string }): Promise<ShiYanReport> {
    const manifestHash = peiZhiHash(m);
    const rnd = mulberry32(m.randomizationSeed);
    const order: Array<{ task: ShiYanTask; arm: ShiYanBi; replicate: number }> = [];
    for (const task of tasks) {
      for (let r = 0; r < m.replicatesPerArm; r++) {
        const arms: ShiYanBi[] = rnd() < 0.5 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
        for (const arm of arms) if ((m.arms as ShiYanBi[]).includes(arm)) order.push({ task, arm, replicate: r });
      }
    }
    const runs: ShiYanRunJieGuo[] = [];
    const unknowns: string[] = [];
    let aborted = false;
    let abortReason = '';
    const siZi = Date.now();
    for (const o of order) {
      if (aborted) { runs.push({ taskId: o.task.taskId, arm: o.arm, replicate: o.replicate, runId: '', state: 'cancelled', verdict: 'not_applicable', firstOutcome: 'unknown', reasonCode: abortReason, totals: kongTotals() }); continue; }
      if (Date.now() - siZi > m.budget.maxWallMs) { aborted = true; abortReason = 'deadline_exceeded'; continue; }
      const runId = xinId('run');
      const outDir = path.join(this.root, 'runs', runId, 'workspace', 'output');
      fs.mkdirSync(outDir, { recursive: true });
      const ctx: ShiYanGongJuShangXiaWen = {
        runId,
        yuanWenJian: { 'source.json': path.join(this.root, 'runs', runId, 'source.json') },
        outputDir: outDir,
        yunXuMuBiao: ['result.json'],
      };
      fs.writeFileSync(ctx.yuanWenJian['source.json'] as string, o.task.source);
      const totals = kongTotals();
      const t0 = Date.now();
      let piaoOk = true;
      let verdict: ShiYanRunJieGuo['verdict'] = 'unknown';
      let firstOutcome: ShiYanRunJieGuo['firstOutcome'] = 'unknown';
      let reasonCode: string | undefined;
      let state: YunXingZhuangTai = 'running';
      this.liu.zhuiJia('run.planned', { runId, taskId: o.task.taskId, arm: o.arm, executionKey: executionKeyOf(m, o.task.taskId, o.arm, o.replicate) });
      this.liu.zhuiJia('run.started', { runId });
      const guanCha = {
        qianChang: (_n: number) => {
          piaoOk = this.zhang.haoPiao();
          if (piaoOk) {
            totals.modelAttempts += 1;
            totals.conservativelyConsumedTickets += 1;
            this.liu.zhuiJia('request.reserved', { runId, requestId: xinId('req'), kind: 'model' });
          }
        },
        yunXu: (_n: number) => piaoOk && Date.now() - siZi <= m.budget.maxWallMs,
      };
      const xiaoXiJi: LiaoTianQingQiu['xiaoXiJi'] = [
        { role: 'system', content: '合成账目任务：读 source.json 全部行（含正负零），写 output/result.json，仅 rowCount/totalCents 两整数字段。' + (o.arm === 'candidate' && opts?.candidateInstruction ? '\n' + opts.candidateInstruction : '') },
        { role: 'user', content: '任务输入经 task_source_read(key=source.json) 读取。' },
      ];
      try {
        for (let lun = 0; lun < 4; lun++) {
          const qiu: LiaoTianQingQiu = {
            model: m.model.modelId,
            xiaoXiJi,
            maxTokens: m.budget.maxGenerationTokensPerAttempt,
            temperature: 0,
            tools: [
              { type: 'function', function: { name: 'task_source_read', description: '读本任务源文件', parameters: { type: 'object', properties: { key: { type: 'string' } } } } },
              { type: 'function', function: { name: 'task_output_write', description: '写本 run 产物', parameters: { type: 'object', properties: { key: { type: 'string' }, content: { type: 'string' } } } } },
            ],
            shiYanGuanCha: guanCha,
          };
          const xiang: LiaoTianXiangYing = await provider.chat(qiu);
          totals.confirmedSent += 1;
          if (xiang.model !== m.model.modelId) { reasonCode = 'model_config_mismatch'; state = 'failed'; aborted = true; abortReason = reasonCode; break; }
          const yong = xiang.usage;
          if (yong && (yong.promptTokens > 0 || yong.completionTokens > 0)) {
            totals.inputTokens = (totals.inputTokens ?? 0) + yong.promptTokens;
            totals.generationTokens = (totals.generationTokens ?? 0) + yong.completionTokens;
            totals.usageStatus = 'reported';
          }
          const diao = xiang.choices[0]?.message?.gongJuDiaoYongJi || [];
          if (!diao.length) break;
          for (const d of diao) {
            totals.toolCalls += 1;
            const args = JSON.parse(d.function.arguments || '{}') as Record<string, unknown>;
            const ce = shiYanGongJuCeLue(d.function.name, args, ctx);
            if (!ce.ok || !ce.luJing) { reasonCode = ce.reason || 'permission_denied'; state = 'failed'; aborted = true; abortReason = reasonCode; break; }
            if (d.function.name === 'task_output_write') {
              const tmp = ce.luJing + '.tmp';
              fs.writeFileSync(tmp, String(args.content ?? ''), 'utf8');
              fs.renameSync(tmp, ce.luJing);
              this.liu.zhuiJia('artifact.sealed', { runId, key: String(args.key ?? '') });
            }
            xiaoXiJi.push({ role: 'assistant', content: '', gongJuDiaoYongJi: [d] });
            xiaoXiJi.push({ role: 'tool', content: d.function.name === 'task_source_read' ? fs.readFileSync(ce.luJing, 'utf8') : 'ok', toolCallId: d.id });
          }
          if (aborted) break;
        }
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (msg.startsWith('shiYanYuSuan:')) { reasonCode = 'budget_exhausted'; state = 'failed'; aborted = true; abortReason = reasonCode; }
        else { reasonCode = 'deadline_exceeded'; state = 'in_doubt'; totals.inDoubtPossibleSend += 1; unknowns.push(runId + ':transport'); }
      }
      totals.elapsedMs = Date.now() - t0;
      /* 验收：读 sealed 产物 bytes；缺产物=已知失败；验收器崩溃=unknown */
      const chanWu = path.join(outDir, 'result.json');
      if (state === 'running' || state === 'in_doubt') {
        if (!fs.existsSync(chanWu)) { verdict = 'fail'; reasonCode = reasonCode || 'artifact_missing'; if (state === 'running') state = 'completed'; }
        else {
          const bytes = fs.readFileSync(chanWu);
          const feng = this.zheng.fengCun(bytes);
          if (!feng.ok) { verdict = 'unknown'; reasonCode = feng.reason; unknowns.push(runId + ':evidence'); }
          else {
            const r = yanShouResult(bytes.toString('utf8'), o.task.rows);
            verdict = r.completion ? 'pass' : 'fail';
            if (!r.completion) reasonCode = r.reason || 'artifact_invalid';
            this.liu.zhuiJia('acceptance.recorded', { runId, verdict, schema: r.schema, numeric: r.numeric });
          }
          if (state === 'running') state = 'completed';
        }
      }
      firstOutcome = verdict === 'pass' ? 'pass' : verdict === 'fail' ? 'fail' : 'unknown';
      if (verdict === 'unknown') unknowns.push(runId + ':verdict');
      const shouJu: YunXingShouJu = { runId, state: state as YunXingShouJu['state'], executionKey: executionKeyOf(m, o.task.taskId, o.arm, o.replicate), terminalEventId: '', resourceTotals: totals, reasonCode };
      const ev = this.liu.zhuiJia('run.terminal', { runId, state: shouJu.state, reasonCode });
      shouJu.terminalEventId = ev.eventId;
      runs.push({ taskId: o.task.taskId, arm: o.arm, replicate: o.replicate, runId, state: shouJu.state, verdict, firstOutcome, reasonCode, totals });
    }
    /* 决策（§12/§15.2）：安全/预算失败→rejected；关键 unknown→inconclusive；回归→keep_baseline */
    const anQuan = runs.some((r) => r.reasonCode === 'permission_denied' || r.reasonCode === 'budget_exhausted' || r.reasonCode === 'model_config_mismatch');
    const guanJianUnknown = runs.some((r) => r.verdict === 'unknown');
    const byTask = new Map<string, { a?: ShiYanRunJieGuo; b?: ShiYanRunJieGuo }>();
    for (const r of runs) {
      const e = byTask.get(r.taskId) || {};
      if (r.arm === 'baseline') e.a = r; else e.b = r;
      byTask.set(r.taskId, e);
    }
    let win = 0, tie = 0, loss = 0;
    for (const e of byTask.values()) {
      if (!e.a || !e.b || e.a.verdict === 'unknown' || e.b.verdict === 'unknown') continue;
      if (e.b.verdict === 'pass' && e.a.verdict === 'fail') win++;
      else if (e.a.verdict === 'pass' && e.b.verdict === 'fail') loss++;
      else tie++;
    }
    let decision: ShiYanJueCe = 'keep_baseline';
    let reasonCode: string | undefined;
    if (anQuan) { decision = 'rejected'; reasonCode = 'safety_or_budget_failure'; }
    else if (aborted) { decision = 'aborted'; reasonCode = abortReason; }
    else if (guanJianUnknown) { decision = 'inconclusive'; reasonCode = 'acceptance_unknown'; }
    else if (loss > 0) { decision = 'keep_baseline'; reasonCode = 'regression'; }
    else if (win > 0) { decision = 'recommend_candidate'; }
    const bao: ShiYanReport = {
      manifestHash, taskIds: tasks.map((t) => t.taskId),
      assigned: order.length,
      executed: runs.filter((r) => r.runId !== '').length,
      delivered: runs.filter((r) => r.state === 'completed').length,
      evaluable: runs.filter((r) => r.verdict === 'pass' || r.verdict === 'fail').length,
      missing: runs.filter((r) => r.verdict === 'unknown').length,
      cancelled: runs.filter((r) => r.state === 'cancelled').length,
      runs, win, tie, loss, decision, reasonCode, unknowns,
    };
    fs.writeFileSync(path.join(this.root, 'report.json'), JSON.stringify(bao, null, 2), 'utf8');
    this.liu.xieTouYing(bao);
    return bao;
  }
}

/** 离线 fake provider（§16 阶段4）：脚本化行为贯通管道；不证明模型提质 */
export class JiaProvider implements MoxingGongYing {
  readonly id = 'fake';
  readonly protocol: GongYingXieYi = 'openai-compatible';
  readonly baseURL = 'http://127.0.0.1:0';
  readonly supportsTools = true;
  private mode: 'correct' | 'drop-negative' | 'no-usage' | 'switch-model' | 'forbidden-tool';
  private ci = 0;
  constructor(mode: JiaProvider['mode']) { this.mode = mode; }
  async chat(Qiu: LiaoTianQingQiu, _signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    /* 新 run 的首轮（仅 system+user）重置会话计数；fake provider 跨 run 不复用状态 */
    if (Qiu.xiaoXiJi.length <= 2) this.ci = 0;
    this.ci += 1;
    shiYanFaSongXuKe(Qiu.shiYanGuanCha, this.ci);
    const rows = (() => {
      try {
        const du = Qiu.xiaoXiJi.find((m) => m.role === 'tool');
        if (du) return (JSON.parse(String(du.content)) as { rows: Array<{ id: string; amount: string }> }).rows;
      } catch { /* noop */ }
      return [] as Array<{ id: string; amount: string }>;
    })();
    const usage = this.mode === 'no-usage'
      ? { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, source: 'none' as const }
      : { promptTokens: 100, completionTokens: 50, totalTokens: 150, cacheHitTokens: 0, cacheMissTokens: 100, source: 'native' as const };
    const model = this.mode === 'switch-model' ? 'other-model' : Qiu.model;
    if (this.ci === 1) {
      return { id: 'fake-1', model, choices: [{ index: 0, message: { role: 'assistant', content: '', gongJuDiaoYongJi: [{ id: 'c1', type: 'function', function: { name: 'task_source_read', arguments: JSON.stringify({ key: 'source.json' }) } }] }, finishReason: 'tool_calls' }], usage };
    }
    if (this.ci === 2) {
      if (this.mode === 'forbidden-tool') {
        return { id: 'fake-2', model, choices: [{ index: 0, message: { role: 'assistant', content: '', gongJuDiaoYongJi: [{ id: 'c2', type: 'function', function: { name: 'run_shell', arguments: '{}' } }] }, finishReason: 'tool_calls' }], usage };
      }
      const youXiao = (this.mode === 'drop-negative' && String(Qiu.xiaoXiJi[0]?.content ?? '').includes('DROP_NEGATIVE_TEST')) ? rows.filter((r) => !r.amount.startsWith('-')) : rows;
      let fen = 0n;
      for (const r of youXiao) {
        const fu = r.amount.startsWith('-');
        const [z, x] = r.amount.replace(/^[+-]/, '').split('.');
        const v = BigInt(z as string) * 100n + BigInt(x as string);
        fen += fu ? -v : v;
      }
      const neiRong = JSON.stringify({ rowCount: youXiao.length, totalCents: Number(fen) });
      return { id: 'fake-2', model, choices: [{ index: 0, message: { role: 'assistant', content: '', gongJuDiaoYongJi: [{ id: 'c2', type: 'function', function: { name: 'task_output_write', arguments: JSON.stringify({ key: 'result.json', content: neiRong }) } }] }, finishReason: 'tool_calls' }], usage };
    }
    return { id: 'fake-3', model, choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finishReason: 'stop' }], usage };
  }
  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const x = await this.chat(Qiu, signal);
    yield { id: x.id, model: x.model, choices: [{ index: 0, delta: { content: neiRongWenBen(x.choices[0]?.message?.content) }, finishReason: 'stop' }], usage: x.usage };
  }
  async listModels(_signal?: AbortSignal): Promise<string[]> { return [this.id]; }
  async ping(_signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; detail?: string }> { return { ok: true, latencyMs: 0 }; }
}