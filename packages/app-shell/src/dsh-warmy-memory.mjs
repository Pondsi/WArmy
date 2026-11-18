/**
 * R258 报障25：warmy-memory-system 的 dsh 侧 embodiment —— cordis 插件（非 WArmy 插件运行时）。
 *
 * 强制接管：
 *  · 上下文摘要：compaction 服务由本插件提供（profile patch 禁用 compaction-basic 后插进 compaction 隔离组），
 *    summarize() 唯一钩子改走 WArmy 记忆系统结构化摘要（host RPC）；超时/失败如实回退 dsh 默认摘要。
 *  · 记忆：session 消息镜像写入 memory-os（host 单一写入者）；每轮首步注入召回简报（inbox.nextStep 指令通道）。
 *  · 上下文预算：contextPercent（10..100，相对当前模型 contextWindow）→ thresholdRatio 强制压力阈值。
 *
 * 加载：profile cordis.patch.yml（writeWarmyMemoryPatch 生成）。dsh 模块一律经 WARMY_DSH_DIR
 * （宿主注入）createRequire 解析——插件文件在 app dist，裸 specifier 解析不到 dsh 依赖。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const dshDir = String(process.env.WARMY_DSH_DIR || '');
const reqBase = createRequire(path.join(dshDir || process.cwd(), 'package.json'));
const basicPath = reqBase.resolve('@deepseek-ai/dsh-compaction-basic');
const req = createRequire(basicPath);
const jiaZai = async (spec) => import(pathToFileURL(req.resolve(spec)).href);
const { default: BasicCompactionEngine } = await jiaZai('@deepseek-ai/dsh-compaction-basic');
const { createUserMessage } = await jiaZai('@deepseek-ai/dsh-llm');
const z = (await jiaZai('@deepseek-ai/schemastery')).default;

export const name = 'warmy-memory';
export const inject = ['llm', 'tokenMeter', 'sessions'];

/** host ↔ dsh 子进程 JSON-line RPC（entry 转发 warmy-memory / warmy-memory-reply）。 */
const pending = new Map();
let daiId = 1;
process.on('message', (m) => {
  if (!m || m.type !== 'warmy-memory-reply' || typeof m.id !== 'number') return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  p.resolve(m);
});
function qingQiu(op, payload, timeoutMs) {
  if (typeof process.send !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = daiId++;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
    pending.set(id, { resolve, timer });
    try { process.send({ type: 'warmy-memory', id, op, ...payload }); }
    catch { clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}
const wenBenOf = (blocks) => ((blocks || []).filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n'));

export default class WarmyMemoryCompaction extends BasicCompactionEngine {
  static Config = z.object({ contextPercent: z.number().min(10).max(100).default(80) });
  constructor(ctx, config = {}) {
    const percent = Math.min(100, Math.max(10, Number(config.contextPercent ?? 80)));
    super(ctx, { thresholdRatio: percent / 100, auto: true });
    this.warmyPercent = percent;
    const daiZhaoHui = new Set();
    /** 记忆接管①：会话消息镜像到 WArmy memory-os（host 单一写入者落 JSONL）。 */
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') { daiZhaoHui.add(session); return; }
      if (event.type !== 'user/message' && event.type !== 'assistant/message') return;
      const text = wenBenOf(event.data && event.data.content).slice(0, 4000);
      if (!text) return;
      void qingQiu('memory-append', {
        sessionId: String(session.id), role: event.type === 'user/message' ? 'user' : 'assistant', text,
      }, 3000);
    });
    /** 记忆接管②：每轮首步注入召回简报（指令通道 inbox.nextStep，与 dsh-agent-instructions 同通道）。 */
    ctx.on('agent/pre-step', async (payload, next) => {
      const agent = payload && payload.agent;
      if (agent && daiZhaoHui.has(agent.session)) {
        daiZhaoHui.delete(agent.session);
        const r = await qingQiu('memory-recall', { sessionId: String(agent.session.id) }, 5000);
        const brief = r && r.ok ? String(r.text || '').trim() : '';
        if (brief && agent.inbox && Array.isArray(agent.inbox.nextStep)) {
          agent.inbox.nextStep.push(createUserMessage({ content: [{ type: 'text', text: '[WARMY-MEMORY] ' + brief.slice(0, 2000) }] }));
        }
      }
      return next();
    }, { prepend: true });
    if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info('[warmy-memory] loaded: compaction/memory takeover, contextPercent=' + percent);
  }
  /** 上下文摘要强制接管：WArmy 结构化摘要（要点/决策/待办/风险）；不可用时回退 dsh 默认（不编造、不阻断）。 */
  async summarize(input, agent, signal) {
    const lines = [];
    for (const m of (input && input.messages) || []) {
      const t = wenBenOf(m && m.content);
      if (t) lines.push(String((m && m.role) || 'user') + ': ' + t);
    }
    const r = await qingQiu('summarize', {
      sessionId: String((agent && agent.session && agent.session.id) || ''),
      text: lines.join('\n').slice(0, 12000),
    }, 15000);
    if (r && r.ok && String(r.text || '').trim()) {
      return { summary: [{ type: 'text', text: String(r.text) }], llmStreamCall: false, provider: 'warmy-memory', model: 'warmy-summary' };
    }
    return super.summarize(input, agent, signal);
  }
}