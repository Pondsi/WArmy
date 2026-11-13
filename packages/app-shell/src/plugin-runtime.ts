/**
 * plugin-runtime —— cordis 式「一切皆插件」运行时基础（R194）。
 *
 * 对齐 dsh/cordis 技术规范：
 *  · 插件模块导出四件套 { name, inject, Config, apply }；
 *  · apply(ctx, config) 里用 ctx.tools.register(defineTool(...)) 注册工具；
 *  · defineTool({ name, description, parameters, output:{schema,render}, execute })；
 *  · Config 是设置 schema（框架据此渲染设置 UI / 校验配置）；
 *  · inject 声明依赖（其他插件/服务）；
 *  · cordis.patch.yml：按 id 覆盖 base 行 + insert 插入插件行。
 *
 * 本模块是纯 Node 运行时（无 Electron 依赖，门禁可脱机真跑）：加载插件→apply 生命周期→
 * 工具注册→Config 校验→工具规格聚合→调用分发。是 WArmy 插件系统从「元数据管理」
 * 升级到「通用插件执行」的基础层。安全：插件按不可信代码处理，工具调用经宿主授权网关。
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

export interface ChaJianShangXiaWen {
  config: Record<string, unknown>;
  tools: { register: (spec: Partial<GongJuGuiGe>) => void; list: () => GongJuGuiGe[] };
  inject: Record<string, unknown>;
  log: (msg: string) => void;
}

export interface ChaJianMoKuai {
  name: string;
  inject?: string[];
  Config?: Record<string, { type?: string; required?: boolean; default?: unknown; description?: string }>;
  apply: (ctx: ChaJianShangXiaWen, config: Record<string, unknown>) => void | Promise<void>;
}

/** Config schema 校验 + 默认值填充（cordis Config 语义）。 */
export function jiaoYanConfig(Config: ChaJianMoKuai['Config'], config: Record<string, unknown>): { ok: boolean; config: Record<string, unknown>; errors: string[] } {
  const out: Record<string, unknown> = { ...config };
  const errors: string[] = [];
  if (!Config) return { ok: true, config: out, errors };
  for (const [key, rule] of Object.entries(Config)) {
    if (out[key] === undefined && rule.default !== undefined) out[key] = rule.default;
    if (rule.required && (out[key] === undefined || out[key] === null)) errors.push(`缺少必填配置 ${key}`);
    if (out[key] !== undefined && rule.type) {
      const t = typeof out[key];
      const qiWang = rule.type === 'array' ? 'object' : rule.type;
      if (rule.type === 'array' ? !Array.isArray(out[key]) : t !== qiWang) errors.push(`配置 ${key} 类型应为 ${rule.type}，实为 ${Array.isArray(out[key]) ? 'array' : t}`);
    }
  }
  return { ok: errors.length === 0, config: out, errors };
}

interface JiaZaiChaJian { module: ChaJianMoKuai; config: Record<string, unknown>; tools: GongJuGuiGe[]; }

export class ChaJianYunXingShi {
  private readonly chaJian = new Map<string, JiaZaiChaJian>();
  private readonly riZhi: string[] = [];

  /** 加载并激活一个插件（apply 生命周期 + 工具注册 + Config 校验）。 */
  async jiaZai(module: ChaJianMoKuai, config: Record<string, unknown> = {}, inject: Record<string, unknown> = {}): Promise<{ ok: boolean; errors: string[]; tools: string[] }> {
    if (!module || typeof module.name !== 'string' || typeof module.apply !== 'function') {
      return { ok: false, errors: ['插件必须导出 { name, apply }'], tools: [] };
    }
    // inject 依赖检查
    const que = (module.inject || []).filter((d) => !(d in inject));
    if (que.length) return { ok: false, errors: [`缺少依赖: ${que.join(',')}`], tools: [] };
    const cfg = jiaoYanConfig(module.Config, config);
    if (!cfg.ok) return { ok: false, errors: cfg.errors, tools: [] };
    const tools: GongJuGuiGe[] = [];
    const ctx: ChaJianShangXiaWen = {
      config: cfg.config,
      tools: {
        register: (spec) => { tools.push(defineTool(spec)); },
        list: () => tools.slice(),
      },
      inject,
      log: (msg) => { this.riZhi.push(`[${module.name}] ${msg}`); },
    };
    try {
      await module.apply(ctx, cfg.config);
    } catch (e) {
      return { ok: false, errors: [`apply 失败: ${String((e as Error)?.message || e)}`], tools: [] };
    }
    this.chaJian.set(module.name, { module, config: cfg.config, tools });
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
      const value = await tool.execute(args, { config: cj.config, tools: { register: () => { /* 运行期不再注册 */ }, list: () => cj.tools.slice() }, inject: {}, log: () => { /* noop */ } });
      const blocks = tool.output.render ? tool.output.render(args, value) : [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
      return { ok: true, value, blocks };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /** 插件设置 schema（供 UI 渲染设置面板）。 */
  sheZhiSchema(): Array<{ plugin: string; Config: ChaJianMoKuai['Config'] }> {
    return [...this.chaJian.values()].filter((c) => c.module.Config).map((c) => ({ plugin: c.module.name, Config: c.module.Config }));
  }

  lieBiao(): string[] { return [...this.chaJian.keys()]; }
  /** 某 qualifiedName（plugin__tool）是否属于本运行时（供宿主工具循环分流）。 */
  youGongJu(qualifiedName: string): boolean {
    const idx = qualifiedName.indexOf('__');
    if (idx < 0) return false;
    const cj = this.chaJian.get(qualifiedName.slice(0, idx));
    return !!cj && cj.tools.some((t) => t.name === qualifiedName.slice(idx + 2));
  }
  xieZai(name: string): boolean { return this.chaJian.delete(name); }
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