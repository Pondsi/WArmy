/**
 * R298：定时动作适配器 —— 固定范围授权复核 + 机械执行 + 真实回执。
 *
 * 口径（计划《总结巡查预测发布闭环》§定时授权与邮件配置）：
 *  · 执行前复核任务 revision、脚本 hash、真实路径/重解析点、权限及凭据引用；范围改变拒绝执行（重新确认）。
 *  · 授权不得变成全局 shell 权限：脚本只跑创建时确认的 command+args+cwd+内容 hash；
 *    默认不下载、不安装、不提权（创建层不得默认授权这些范围）。
 *  · 机械动作（脚本/响铃/既有工具/计划步骤/唤醒）无须模型；自然语言解析与内容生成才走模型。
 *  · 邮件：账号/收件人/主题模板/附件范围必须在授权快照内；凭据由宿主安全仓解析，本层不见明文。
 *    回执只表示服务器接受，不保证送达；DATA 后断线/回执未知 → unknown，不盲目补发。
 *  · 模型自述完成≠成功：以执行器真实 ok/退出码/回执为准。
 *  · 所有 IO 由宿主注入（受控子进程/安全仓/邮件会话/音频），本模块可单测、不直接碰 Electron。
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DingShiRenWuV2, DingShiDongZuo } from '../ji-chu/ding-shi-gui-ze.js';
import type { DongZuoQingQiu, DongZuoJieGuo } from './ding-shi-diao-du.js';

/** 内联脚本规范 hash（创建与复核共用同一式；文件脚本由宿主扩展内容 hash） */
export function jiaoBenHaXi(command: string, args: string[], cwd: string): string {
  return createHash('sha256').update(JSON.stringify({ command, args, cwd })).digest('hex');
}

export interface DongZuoYiLai {
  /** 受控子进程：参数数组、环境白名单、超时/取消、只杀本任务 PID 树（宿主既有接口） */
  paoJiaoBen(req: { command: string; args: string[]; cwd: string; timeoutMs: number; signal: AbortSignal }): Promise<{ ok: boolean; exitCode: number | null; shuChu?: string; error?: string }>;
  /** 产物存在性检查（绝对路径） */
  chaChanWu(paths: string[]): Promise<string[]>;
  /** 模型执行（会话启用链；真实完成状态，不以文字认定） */
  paoMoXing(req: { task: DingShiRenWuV2; prompt: string; model?: string; signal: AbortSignal }): Promise<{ ok: boolean; text: string; error?: string }>;
  zhiXingJiHuaBuZhou(req: { planId: string; stepId: string; signal: AbortSignal }): Promise<{ ok: boolean; receipt: string }>;
  huanXingHuiHua(req: { sessionId: string; prompt?: string; signal: AbortSignal }): Promise<{ ok: boolean; receipt: string }>;
  /** SMTP 发件（smtp-send；465/587 fail-closed、凭据安全仓引用）。未配置=不提供 */
  faSongYouJian?(req: { accountId: string; to: string[]; subject: string; body: string; attachments?: string[]; signal: AbortSignal }): Promise<{ status: 'accepted' | 'unknown' | 'failed'; receipt: string }>;
  xiangLing(req: { sound?: string; times: number; signal: AbortSignal }): Promise<{ ok: boolean }>;
  paoGongJu(req: { tool: string; params: Record<string, unknown>; task: DingShiRenWuV2; signal: AbortSignal }): Promise<{ ok: boolean; receipt: string }>;
  /** 真实路径解析（realpath；失败抛错=路径不可信） */
  zhenShiLuJing(p: string): Promise<string> | string;
  /** 重解析点（junction/symlink）检测：true=是重解析点 ⇒ 拒绝自动执行 */
  shiFouChongJieXiDian?(p: string): Promise<boolean> | boolean;
  /** 文件脚本内容 hash（宿主把脚本文件内容纳入；不提供=只认内联规范 hash） */
  jiaoBenNeiRongHaXi?(command: string, args: string[], cwd: string): Promise<string | null>;
  /** 邮件账号存在性（安全仓引用可解析） */
  youJianZhangHaoCunZai?(accountId: string): boolean;
  audit?: (op: string, detail: unknown) => void;
}

const HUI_ZHI_MAX = 1800;
const shou = (s: unknown): string => String(s ?? '').slice(0, HUI_ZHI_MAX);

/** Windows 路径大小写不敏感比较；其余平台精确 */
function luJingDeng(a: string, b: string): boolean {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
function zaiFanWeiNei(p: string, fanWei: string[]): boolean {
  const rp = path.resolve(p);
  return fanWei.some((f) => {
    const rf = path.resolve(f);
    if (process.platform === 'win32') return rp.toLowerCase().startsWith(rf.toLowerCase() + path.sep) || luJingDeng(rp, rf);
    return rp.startsWith(rf + path.sep) || rp === rf;
  });
}

export function chuangJianDingShiDongZuo(yiLai: DongZuoYiLai) {
  const audit = yiLai.audit ?? (() => {});

  /** 执行前授权复核：范围改变/路径不可信 ⇒ 拒绝（调用方转重新确认，不自动执行） */
  async function fuHeShouQuan(task: DingShiRenWuV2, action: DingShiDongZuo): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!task.shouQuan || task.shouQuan.version < 1 || !Array.isArray(task.shouQuan.scope) || !task.shouQuan.scope.length) {
      return { ok: false, error: 'no-fixed-scope-authorization' };
    }
    if (action.kind === 'script') {
      const sq = task.shouQuan.script;
      if (!sq) return { ok: false, error: 'script-scope-missing' };
      /** hash 复核：内联规范式 + 宿主文件内容式（两者都认，任一不符即拒绝） */
      const guiFan = jiaoBenHaXi(action.command, action.args, action.cwd);
      if (action.hash !== guiFan && action.hash !== sq.hash) return { ok: false, error: 'script-hash-changed' };
      if (sq.hash !== guiFan) {
        if (!yiLai.jiaoBenNeiRongHaXi) return { ok: false, error: 'script-hash-changed' };
        const nei = await yiLai.jiaoBenNeiRongHaXi(action.command, action.args, action.cwd);
        if (!nei || nei !== action.hash || nei !== sq.hash) return { ok: false, error: 'script-content-changed' };
      }
      if (JSON.stringify(sq.args) !== JSON.stringify(action.args)) return { ok: false, error: 'script-args-changed' };
      if (!luJingDeng(sq.cwd, action.cwd)) return { ok: false, error: 'script-cwd-changed' };
      /** 真实路径/重解析点：cwd 必须可解析、非重解析点、在授权范围内 */
      let zhenShi: string;
      try { zhenShi = await yiLai.zhenShiLuJing(action.cwd); } catch { return { ok: false, error: 'cwd-unresolvable' }; }
      if (yiLai.shiFouChongJieXiDian && await yiLai.shiFouChongJieXiDian(action.cwd)) return { ok: false, error: 'cwd-reparse-point' };
      if (!zaiFanWeiNei(zhenShi, sq.fanWei)) return { ok: false, error: 'cwd-out-of-scope' };
      if (action.outputs) {
        for (const o of action.outputs) if (!zaiFanWeiNei(o, sq.fanWei)) return { ok: false, error: 'output-out-of-scope' };
      }
      return { ok: true };
    }
    if (action.kind === 'mail') {
      const sm = task.shouQuan.mail;
      if (!sm) return { ok: false, error: 'mail-scope-missing' };
      if (!yiLai.faSongYouJian) return { ok: false, error: 'mail-not-configured' };
      if (sm.accountId !== action.accountId) return { ok: false, error: 'mail-account-changed' };
      if (yiLai.youJianZhangHaoCunZai && !yiLai.youJianZhangHaoCunZai(action.accountId)) return { ok: false, error: 'mail-account-missing' };
      const yunXu = new Set(sm.to.map((x) => x.toLowerCase()));
      if (action.to.some((x) => !yunXu.has(x.toLowerCase()))) return { ok: false, error: 'mail-to-out-of-scope' };
      if (action.subject !== sm.subjectMoBan) return { ok: false, error: 'mail-subject-changed' };
      if (action.attachments) {
        for (const a of action.attachments) if (!zaiFanWeiNei(a, sm.attachmentsFanWei)) return { ok: false, error: 'mail-attachment-out-of-scope' };
      }
      return { ok: true };
    }
    /** model/wake/tool/ring/planStep/mixed：创建时已确认范围；mixed 子步逐个复核 */
    if (action.kind === 'mixed') {
      for (const s of action.steps) {
        const r = await fuHeShouQuan(task, s);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  /** 单动作执行（scheduler 逐步调用；mixed 已在调度层展开为步骤） */
  async function zhiXing(req: DongZuoQingQiu): Promise<DongZuoJieGuo> {
    const { task, action, signal } = req;
    if (signal.aborted) return { status: 'cancelled', receipt: 'aborted-before-start' };
    const he = await fuHeShouQuan(task, action);
    if (!he.ok) {
      audit('dingShi.action-rejected', { taskId: task.id, kind: action.kind, error: he.error });
      return { status: 'failed', receipt: `授权复核未过：${he.error}（范围已改变，需重新确认）` };
    }
    try {
      switch (action.kind) {
        case 'script': {
          const r = await yiLai.paoJiaoBen({ command: action.command, args: action.args, cwd: action.cwd, timeoutMs: action.timeoutMs, signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          if (!r.ok) return { status: 'failed', receipt: shou(`退出码 ${r.exitCode ?? '未知'}：${r.error || r.shuChu || ''}`) };
          if (action.outputs && action.outputs.length) {
            const cunZai = await yiLai.chaChanWu(action.outputs);
            const que = action.outputs.filter((o) => !cunZai.includes(o));
            if (que.length) return { status: 'failed', receipt: shou(`产物缺失：${que.join('、')}`) };
          }
          return { status: 'success', receipt: shou(`退出码 0${r.shuChu ? '；' + r.shuChu : ''}`) };
        }
        case 'model': {
          const r = await yiLai.paoMoXing({ task, prompt: action.prompt, ...(action.model ? { model: action.model } : {}), signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          /** 真实 ok 为准；模型文字里的"完成"不算数 */
          return r.ok ? { status: 'success', receipt: shou(r.text) } : { status: 'failed', receipt: shou(r.error || r.text || '模型执行失败') };
        }
        case 'planStep': {
          const r = await yiLai.zhiXingJiHuaBuZhou({ planId: action.planId, stepId: action.stepId, signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          return r.ok ? { status: 'success', receipt: shou(r.receipt) } : { status: 'failed', receipt: shou(r.receipt) };
        }
        case 'wake': {
          const r = await yiLai.huanXingHuiHua({ sessionId: action.sessionId, ...(action.prompt ? { prompt: action.prompt } : {}), signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          return r.ok ? { status: 'success', receipt: shou(r.receipt) } : { status: 'failed', receipt: shou(r.receipt) };
        }
        case 'mail': {
          let body = action.body;
          if (action.bodySource === 'model') {
            /** 内容生成才调模型；生成失败不发信 */
            const g = await yiLai.paoMoXing({ task, prompt: action.body, signal });
            if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
            if (!g.ok || !g.text.trim()) return { status: 'failed', receipt: shou('邮件正文生成失败：' + (g.error || '')) };
            body = g.text;
          }
          const r = await yiLai.faSongYouJian!({ accountId: action.accountId, to: action.to, subject: action.subject, body, ...(action.attachments ? { attachments: action.attachments } : {}), signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          if (r.status === 'accepted') return { status: 'success', receipt: shou('服务器已接受（不保证最终送达）：' + r.receipt) };
          if (r.status === 'unknown') return { status: 'unknown', receipt: shou('回执未知（不盲目补发）：' + r.receipt) };
          return { status: 'failed', receipt: shou(r.receipt) };
        }
        case 'ring': {
          const r = await yiLai.xiangLing({ ...(action.sound ? { sound: action.sound } : {}), times: action.times ?? 1, signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          return r.ok ? { status: 'success', receipt: `响铃 ${action.times ?? 1} 次` } : { status: 'failed', receipt: '响铃失败' };
        }
        case 'tool': {
          const r = await yiLai.paoGongJu({ tool: action.tool, params: action.params, task, signal });
          if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
          return r.ok ? { status: 'success', receipt: shou(r.receipt) } : { status: 'failed', receipt: shou(r.receipt) };
        }
        default:
          return { status: 'failed', receipt: 'mixed 应由调度层展开为步骤' };
      }
    } catch (e) {
      if (signal.aborted) return { status: 'cancelled', receipt: 'aborted' };
      return { status: 'failed', receipt: shou((e as Error)?.message || e) };
    }
  }

  return { fuHeShouQuan, zhiXing };
}
export type DingShiDongZuoShiPei = ReturnType<typeof chuangJianDingShiDongZuo>;