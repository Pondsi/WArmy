/**
 * plugin-runtime —— cordis 式「一切皆插件」运行时（R194 基础 / R238 对齐 dsh 官方插件系统）。
 *
 * 对齐 dsh/cordis 技术规范（https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market）：
 *  · 插件模块导出四件套 { name, inject, Config, apply }；
 *  · apply(ctx, config) 里用 ctx.tools.register(defineTool(...)) 注册**模型可调用工具**；
 *  · defineTool({ name, description, parameters, output:{schema,render}, execute })；
 *  · Config 是设置 schema（Schemastery 风格；框架据此渲染设置 UI / 校验配置）——**插件自行决定是否有设置**（无 Config 即无设置项）；
 *  · inject 声明依赖（其他插件/服务）；
 *  · cordis.patch.yml：按 id 覆盖 base 行 + insert 插入插件行。
 *
 * R238 新增——**确定性（非模型裁量）扩展点**，与 dsh 五类插件形态对齐：
 *  · ctx.on(event, handler)：订阅框架事件；宿主在固定生命周期点 faShe(event) 触发，不经模型选择（事件监听器形态）；
 *  · ctx.effect(fn)：生命周期效果，返回的 disposer 在卸载时执行（防资源泄漏，对齐 dsh heartbeat 例）；
 *  · ctx.provide(name, impl) / Service：提供服务，消费者 inject:[name] 后 ctx[name] 可用（服务提供者形态）；
 *  · ctx.middleware(fn)：确定性中间件，宿主在固定管线 paoZhongJianJian 按注册序跑（拦截器形态）；
 *  · 版本/engines 元数据 + chaJianXinXi/kuoZhanDian introspection（供已装列表/更新/扩展点展示）。
 *
 * 本模块是纯 Node 运行时（无 Electron 依赖，门禁可脱机真跑）：加载插件→apply 生命周期→
 * 工具注册 + 确定性扩展点登记→Config 校验→聚合→调用分发→卸载清理。
 * 安全：插件按不可信代码处理，工具调用经宿主授权网关；确定性扩展点由宿主在固定点触发并隔离异常。
 */

export interface GongJuGuiGe {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render?: (args: any, value: any) => Array<{ type: string; text: string }> };
  execute: (args: any, ctx: ChaJianShangXiaWen) => any | Promise<any>;
}

/** defineTool：校验工具定义形状（cordis 规范）。 */
export function defineTool(spec: Partial<GongJuGuiGe>): GongJuGuiGe {
  if (!spec || typeof spec.name !== 'string' || !spec.name) throw new Error('defineTool: name 必填');
  if (typeof spec.description !== 'string') throw new Error('defineTool: description 必填');
  if (!spec.parameters || typeof spec.parameters !== 'object') throw new Error('defineTool: parameters 必填（开放对象根）');
  if (!spec.output || typeof spec.output !== 'object' || !spec.output.schema) throw new Error('defineTool: output.schema 必填');
  if (typeof spec.execute !== 'function') throw new Error('defineTool: execute 必须是函数');
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: { schema: spec.output.schema, ...(spec.output.render ? { render: spec.output.render } : {}) },
    execute: spec.execute,
  };
}

/** 确定性中间件：宿主在固定管线点按注册序运行（非模型裁量）。next() 交给下游/终端。 */
export type ZhongJianJianHan = (payload: any, next: () => Promise<any>) => any | Promise<any>;

export interface ChaJianShangXiaWen {
  config: Record<string, unknown>;
  tools: { register: (spec: Partial<GongJuGuiGe>) => void; list: () => GongJuGuiGe[] };
  inject: Record<string, unknown>;
  log: (msg: string) => void;
  /** 订阅框架确定性事件；宿主在固定生命周期点 faShe 触发。返回注销函数。 */
  on: (event: string, handler: (payload: any) => any) => () => void;
  /** 生命周期效果：立即执行 fn；fn 返回的 disposer 在插件卸载时运行（防资源泄漏）。 */
  effect: (fn: () => void | (() => void)) => void;
  /** 提供服务（其他插件 inject 后可经 ctx[name] 使用）。 */
  provide: (name: string, impl: unknown) => void;
  /** 注册确定性中间件（拦截宿主固定管线）。 */
  middleware: (fn: ZhongJianJianHan) => void;
  /** 已解析的服务/依赖按名挂在 ctx 上（cordis ctx[name] 语义）。 */
  [service: string]: unknown;
}

/** Config 单条规则（Schemastery 风格的声明式 schema，驱动设置 UI + 校验）。 */
export interface ConfigGuiZe {
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  title?: string;
  options?: Array<{ value: unknown; label?: string } | unknown>;
  min?: number;
  max?: number;
  items?: ConfigGuiZe;
  properties?: Record<string, ConfigGuiZe>;
  hidden?: boolean;
}

export interface ChaJianMoKuai {
  name: string;
  inject?: string[];
  Config?: Record<string, ConfigGuiZe>;
  apply: (ctx: ChaJianShangXiaWen, config: Record<string, unknown>) => void | Promise<void>;
  /** R238：版本/元数据（供已装列表、更新检测、市场卡片）。 */
  version?: string;
  title?: string;
  description?: string;
  author?: string;
  engines?: { warmy?: string; dsh?: string };
}

/** Schema 构建器（dsh Schemastery 等价写法：Schema.object({ x: Schema.string().default('a') })）。 */
class GuiZeBuilder {
  rule: ConfigGuiZe;
  constructor(type: string, extra: Partial<ConfigGuiZe> = {}) { this.rule = { type, ...extra }; }
  default(v: unknown): this { this.rule.default = v; return this; }
  required(b = true): this { this.rule.required = b; return this; }
  description(s: string): this { this.rule.description = s; return this; }
  title(s: string): this { this.rule.title = s; return this; }
  min(n: number): this { this.rule.min = n; return this; }
  max(n: number): this { this.rule.max = n; return this; }
  hidden(b = true): this { this.rule.hidden = b; return this; }
}
function pingRule(v: unknown): ConfigGuiZe { return v instanceof GuiZeBuilder ? v.rule : (v as ConfigGuiZe); }
export const Schema = {
  string: () => new GuiZeBuilder('string'),
  number: () => new GuiZeBuilder('number'),
  integer: () => new GuiZeBuilder('integer'),
  boolean: () => new GuiZeBuilder('boolean'),
  select: (options: Array<{ value: unknown; label?: string } | unknown>) => new GuiZeBuilder('select', { options }),
  array: (items?: unknown) => new GuiZeBuilder('array', items ? { items: pingRule(items) } : {}),
  object: (props: Record<string, unknown>): Record<string, ConfigGuiZe> => {
    const out: Record<string, ConfigGuiZe> = {};
    for (const [k, v] of Object.entries(props || {})) out[k] = pingRule(v);
    return out;
  },
};

/** Config schema 校验 + 默认值填充（cordis Config 语义；R238 增 select/number 边界/integer/boolean/object）。 */
export function jiaoYanConfig(Config: ChaJianMoKuai['Config'], config: Record<string, unknown>): { ok: boolean; config: Record<string, unknown>; errors: string[] } {
  const out: Record<string, unknown> = { ...config };
  const errors: string[] = [];
  if (!Config) return { ok: true, config: out, errors };
  for (const [key, rule0] of Object.entries(Config)) {
    const rule = pingRule(rule0) || {};
    if (out[key] === undefined && rule.default !== undefined) out[key] = rule.default;
    if (rule.required && (out[key] === undefined || out[key] === null)) { errors.push(`缺少必填配置 ${key}`); continue; }
    if (out[key] === undefined || !rule.type) continue;
    const v = out[key];
    const t = rule.type;
    if (t === 'array') {
      if (!Array.isArray(v)) errors.push(`配置 ${key} 类型应为 array，实为 ${typeof v}`);
    } else if (t === 'select') {
      const opts = (rule.options || []).map((o) => (o && typeof o === 'object' && 'value' in (o as object) ? (o as { value: unknown }).value : o));
      if (!opts.includes(v)) errors.push(`配置 ${key} 不在可选值内`);
    } else if (t === 'number' || t === 'integer') {
      if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`配置 ${key} 类型应为 ${t}，实为 ${typeof v}`);
      else {
        if (t === 'integer' && !Number.isInteger(v)) errors.push(`配置 ${key} 应为整数`);
        if (rule.min !== undefined && v < rule.min) errors.push(`配置 ${key} 不得小于 ${rule.min}`);
        if (rule.max !== undefined && v > rule.max) errors.push(`配置 ${key} 不得大于 ${rule.max}`);
      }
    } else if (t === 'object') {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) errors.push(`配置 ${key} 类型应为 object`);
    } else {
      const qiWang = t === 'boolean' ? 'boolean' : t;
      if (typeof v !== qiWang) errors.push(`配置 ${key} 类型应为 ${t}，实为 ${typeof v}`);
    }
  }
  return { ok: errors.length === 0, config: out, errors };
}

interface JiaZaiChaJian {
  module: ChaJianMoKuai;
  config: Record<string, unknown>;
  tools: GongJuGuiGe[];
  listeners: Array<{ event: string; handler: (payload: any) => any }>;
  disposers: Array<() => void>;
  services: string[];
  middlewares: ZhongJianJianHan[];
  inject: Record<string, unknown>;
}

export class ChaJianYunXingShi {
  private readonly chaJian = new Map<string, JiaZaiChaJian>();
  private readonly fuWuMap = new Map<string, unknown>();
  private readonly riZhi: string[] = [];

  /** 加载并激活一个插件（apply 生命周期 + 工具注册 + 确定性扩展点登记 + Config 校验）。 */
  async jiaZai(module: ChaJianMoKuai, config: Record<string, unknown> = {}, inject: Record<string, unknown> = {}): Promise<{ ok: boolean; errors: string[]; tools: string[] }> {
    if (!module || typeof module.name !== 'string' || typeof module.apply !== 'function') {
      return { ok: false, errors: ['插件必须导出 { name, apply }'], tools: [] };
    }
    if (this.chaJian.has(module.name)) return { ok: false, errors: [`插件已加载: ${module.name}`], tools: [] };
    // inject 依赖检查：传入 inject 或已提供服务满足其一即可
    const que = (module.inject || []).filter((d) => !(d in inject) && !this.fuWuMap.has(d));
    if (que.length) return { ok: false, errors: [`缺少依赖: ${que.join(',')}`], tools: [] };
    const cfg = jiaoYanConfig(module.Config, config);
    if (!cfg.ok) return { ok: false, errors: cfg.errors, tools: [] };
    const tools: GongJuGuiGe[] = [];
    const cj: JiaZaiChaJian = { module, config: cfg.config, tools, listeners: [], disposers: [], services: [], middlewares: [], inject };
    const resolvedInject: Record<string, unknown> = { ...inject };
    for (const d of module.inject || []) if (!(d in resolvedInject) && this.fuWuMap.has(d)) resolvedInject[d] = this.fuWuMap.get(d);
    const ctx: ChaJianShangXiaWen = {
      config: cfg.config,
      tools: { register: (spec) => { tools.push(defineTool(spec)); }, list: () => tools.slice() },
      inject: resolvedInject,
      log: (msg) => { this.riZhi.push(`[${module.name}] ${msg}`); },
      on: (event, handler) => {
        const item = { event: String(event), handler };
        cj.listeners.push(item);
        return () => { const i = cj.listeners.indexOf(item); if (i >= 0) cj.listeners.splice(i, 1); };
      },
      effect: (fn) => {
        try { const d = fn(); if (typeof d === 'function') cj.disposers.push(d); }
        catch (e) { this.riZhi.push(`[${module.name}] effect 失败: ${String((e as Error)?.message || e)}`); }
      },
      provide: (name, impl) => { const n = String(name); this.fuWuMap.set(n, impl); if (!cj.services.includes(n)) cj.services.push(n); ctx[n] = impl; },
      middleware: (fn) => { if (typeof fn === 'function') cj.middlewares.push(fn); },
    };
    for (const [k, v] of Object.entries(resolvedInject)) ctx[k] = v;
    try {
      await module.apply(ctx, cfg.config);
    } catch (e) {
      // apply 失败：回收已登记的效果/服务，避免半激活泄漏
      for (const d of cj.disposers) { try { d(); } catch { /* noop */ } }
      for (const s of cj.services) this.fuWuMap.delete(s);
      return { ok: false, errors: [`apply 失败: ${String((e as Error)?.message || e)}`], tools: [] };
    }
    this.chaJian.set(module.name, cj);
    return { ok: true, errors: [], tools: tools.map((t) => t.name) };
  }

  /** 聚合所有已加载插件的工具规格（OpenAI function 形状，供模型工具循环）。 */
  gongJuGuiGe(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    const out: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];
    for (const cj of this.chaJian.values()) {
      for (const t of cj.tools) {
        out.push({ type: 'function', function: { name: `${cj.module.name}__${t.name}`, description: t.description, parameters: t.parameters } });
      }
    }
    return out;
  }

  /** 分发工具调用（qualifiedName = plugin__tool）。安全：调用方应先经宿主授权网关。 */
  async diaoYong(qualifiedName: string, args: any): Promise<{ ok: boolean; value?: any; blocks?: Array<{ type: string; text: string }>; error?: string }> {
    const idx = qualifiedName.indexOf('__');
    if (idx < 0) return { ok: false, error: 'bad-qualified-name' };
    const cj = this.chaJian.get(qualifiedName.slice(0, idx));
    if (!cj) return { ok: false, error: 'plugin-not-loaded' };
    const tool = cj.tools.find((t) => t.name === qualifiedName.slice(idx + 2));
    if (!tool) return { ok: false, error: 'tool-not-found' };
    try {
      const inj: Record<string, unknown> = { ...cj.inject };
      for (const d of cj.module.inject || []) if (!(d in inj) && this.fuWuMap.has(d)) inj[d] = this.fuWuMap.get(d);
      const execCtx: ChaJianShangXiaWen = { config: cj.config, tools: { register: () => { /* 运行期不再注册 */ }, list: () => cj.tools.slice() }, inject: inj, log: () => { /* noop */ }, on: () => () => { /* noop */ }, effect: () => { /* noop */ }, provide: () => { /* noop */ }, middleware: () => { /* noop */ } };
      for (const [k, v] of Object.entries(inj)) execCtx[k] = v;
      const value = await tool.execute(args, execCtx);
      const blocks = tool.output.render ? tool.output.render(args, value) : [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
      return { ok: true, value, blocks };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /**
   * R238 确定性事件触发（非模型裁量）：宿主在固定生命周期点调用，按插件加载序 + 监听注册序运行所有 handler。
   * 每个 handler 异常隔离（不影响其它插件/宿主）。返回各 handler 结果数组。
   */
  faShe(event: string, payload?: any): any[] {
    const out: any[] = [];
    const ev = String(event);
    for (const cj of this.chaJian.values()) {
      for (const l of cj.listeners.slice()) {
        if (l.event !== ev) continue;
        try {
          const r = l.handler(payload);
          if (r && typeof (r as Promise<unknown>).then === 'function') { (r as Promise<unknown>).then(() => { /* noop */ }, (e) => { this.riZhi.push(`[${cj.module.name}] 事件 ${ev} 异步处理失败: ${String((e as Error)?.message || e)}`); }); out.push(undefined); }
          else out.push(r);
        }
        catch (e) { this.riZhi.push(`[${cj.module.name}] 事件 ${ev} 处理失败: ${String((e as Error)?.message || e)}`); }
      }
    }
    return out;
  }

  /** R238 确定性 bail 事件：第一个返回非 undefined/null 的 handler 结果即短路（供拦截/否决类扩展点）。 */
  faSheBail(event: string, payload?: any): any {
    const ev = String(event);
    for (const cj of this.chaJian.values()) {
      for (const l of cj.listeners.slice()) {
        if (l.event !== ev) continue;
        try { const r = l.handler(payload); if (r !== undefined && r !== null) return r; }
        catch (e) { this.riZhi.push(`[${cj.module.name}] 事件 ${ev} 处理失败: ${String((e as Error)?.message || e)}`); }
      }
    }
    return undefined;
  }

  /** R238 异步 bail 事件：await 每个 handler（cordis 监听器普遍 async），首个非空短路；异步异常隔离归因到插件。宿主 before-tool 用此。 */
  async faSheBailAsync(event: string, payload?: any): Promise<any> {
    const ev = String(event);
    for (const cj of this.chaJian.values()) {
      for (const l of cj.listeners.slice()) {
        if (l.event !== ev) continue;
        try { const r = await l.handler(payload); if (r !== undefined && r !== null) return r; }
        catch (e) { this.riZhi.push(`[${cj.module.name}] 事件 ${ev} 处理失败: ${String((e as Error)?.message || e)}`); }
      }
    }
    return undefined;
  }

  /** R238 确定性中间件管线：按注册序 compose，terminal 为宿主终端逻辑。 */
  async paoZhongJianJian(payload: any, terminal: () => Promise<any>): Promise<any> {
    const fns: ZhongJianJianHan[] = [];
    for (const cj of this.chaJian.values()) fns.push(...cj.middlewares);
    let last = -1;
    const dispatch = async (i: number): Promise<any> => {
      if (i <= last) throw new Error('middleware next() 重复调用');
      last = i;
      const fn = fns[i];
      if (!fn) return terminal();
      return fn(payload, () => dispatch(i + 1));
    };
    return dispatch(0);
  }

  /** R238 取服务实例（其他插件/宿主用）。 */
  fuWu(name: string): unknown { return this.fuWuMap.get(String(name)); }

  /** R238 更新设置：校验新 Config → 卸载（跑 disposer）→ 用同一模块+依赖重新 apply（设置即时生效）。 */
  async gengXinPeiZhi(name: string, config: Record<string, unknown>): Promise<{ ok: boolean; errors: string[]; tools: string[] }> {
    const cj = this.chaJian.get(name);
    if (!cj) return { ok: false, errors: ['plugin-not-loaded'], tools: [] };
    const module = cj.module; const baseInject = cj.inject; const oldConfig = cj.config;
    const cfg = jiaoYanConfig(module.Config, config);
    if (!cfg.ok) return { ok: false, errors: cfg.errors, tools: [] };
    this.xieZai(name);
    const r = await this.jiaZai(module, config, baseInject);
    if (!r.ok) {
      // 回滚：apply 失败时用旧配置重载，避免插件停留在「已启用但实际卸载」态
      const back = await this.jiaZai(module, oldConfig, baseInject);
      return { ok: false, errors: [...r.errors, back.ok ? '（已回滚到旧配置）' : '（回滚失败，插件已卸载）'], tools: back.tools };
    }
    return r;
  }

  /** 插件设置 schema（供 UI 渲染设置面板）；无 Config 的插件不出现在此（自行决定是否有设置）。 */
  sheZhiSchema(): Array<{ plugin: string; Config: ChaJianMoKuai['Config'] }> {
    return [...this.chaJian.values()].filter((c) => c.module.Config).map((c) => ({ plugin: c.module.name, Config: c.module.Config }));
  }

  /** R238 已装插件元信息（版本/作者/engines/是否含设置/工具/扩展点），供已装列表 + 更新检测。 */
  chaJianXinXi(): Array<{ name: string; version: string; title: string; description: string; author: string; engines: { warmy?: string; dsh?: string } | null; hasConfig: boolean; config: Record<string, unknown>; tools: string[]; events: string[]; services: string[] }> {
    return [...this.chaJian.values()].map((cj) => ({
      name: cj.module.name,
      version: String(cj.module.version || ''),
      title: String(cj.module.title || cj.module.name),
      description: String(cj.module.description || ''),
      author: String(cj.module.author || ''),
      engines: cj.module.engines || null,
      hasConfig: !!cj.module.Config,
      config: cj.config,
      tools: cj.tools.map((t) => t.name),
      events: [...new Set(cj.listeners.map((l) => l.event))],
      services: cj.services.slice(),
    }));
  }

  /** R238 确定性扩展点清单（每插件订阅的事件/提供的服务/中间件数/效果数/工具），供 UI 展示「非模型裁量」能力。 */
  kuoZhanDian(): Array<{ plugin: string; version: string; events: string[]; services: string[]; middleware: number; effects: number; tools: string[] }> {
    return [...this.chaJian.values()].map((cj) => ({
      plugin: cj.module.name,
      version: String(cj.module.version || ''),
      events: [...new Set(cj.listeners.map((l) => l.event))],
      services: cj.services.slice(),
      middleware: cj.middlewares.length,
      effects: cj.disposers.length,
      tools: cj.tools.map((t) => t.name),
    }));
  }

  lieBiao(): string[] { return [...this.chaJian.keys()]; }
  /** 某 qualifiedName（plugin__tool）是否属于本运行时（供宿主工具循环分流）。 */
  youGongJu(qualifiedName: string): boolean {
    const idx = qualifiedName.indexOf('__');
    if (idx < 0) return false;
    const cj = this.chaJian.get(qualifiedName.slice(0, idx));
    return !!cj && cj.tools.some((t) => t.name === qualifiedName.slice(idx + 2));
  }
  /** R238 卸载：先跑所有 disposer（ctx.effect 回收）+ 移除服务，再删插件（防资源泄漏）。 */
  xieZai(name: string): boolean {
    const cj = this.chaJian.get(name);
    if (!cj) return false;
    for (const d of cj.disposers.slice()) { try { d(); } catch (e) { this.riZhi.push(`[${name}] 卸载清理失败: ${String((e as Error)?.message || e)}`); } }
    for (const s of cj.services) this.fuWuMap.delete(s);
    this.chaJian.delete(name);
    return true;
  }
  riZhiNeiRong(): string[] { return this.riZhi.slice(); }
}

/** 解析 cordis.patch.yml 的极简实现（按 id 覆盖 base 行 + insert 插入；不引第三方 yaml 依赖）。 */
export function heBingPatch(base: Array<Record<string, unknown>>, patchLines: string[]): Array<Record<string, unknown>> {
  const out = base.map((x) => ({ ...x }));
  for (const line of patchLines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const insert = /^insert:\s*(.+)$/.exec(t);
    if (insert) { const ins = insert[1]; if (ins) { try { out.push(JSON.parse(ins)); } catch { /* 非法行忽略 */ } } continue; }
    const override = /^id:\s*(\S+)\s+set:\s*(.+)$/.exec(t);
    if (override) {
      const oid = override[1]; const oset = override[2];
      if (oid && oset) {
        const target = out.find((x) => x.id === oid);
        if (target) { try { Object.assign(target, JSON.parse(oset)); } catch { /* 非法忽略 */ } }
      }
    }
  }
  return out;
}