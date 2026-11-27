/** R300：原生 A2UI 互动回复。普通正文保持不变，互动层独立生成、校验并写入会话工作区。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { A2uiRequestProcessor, DirectJsonFormatFactory, type AgentToRendererMessage } from '@a2ui/agent';
import { MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core';
import { basicCatalog } from '@a2ui/web_core/catalogs/basic/v1';
import type { LiaoTianNeiRongBu } from '@warmy/providers';

export const A2UI_CATALOG_ID = 'https://warmy.local/catalogs/a2ui-safe/1.json';
const AN_QUAN_COMPONENTS = [
  'Text', 'Icon', 'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider',
  'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'Image',
] as const;
const AN_QUAN_FUNCTIONS = [
  'required', 'regex', 'length', 'numeric', 'email', 'formatString',
  'formatNumber', 'formatCurrency', 'formatDate', 'pluralize', 'and', 'or', 'not',
] as const;

export interface A2uiZhuangTai {
  sessionId: string;
  messageId: string;
  artifactId: string;
  status: 'generating' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
  ts: number;
  entryPath?: string;
  nmAvailable?: boolean;
  error?: string;
  stage?: 'request' | 'parse' | 'write';
  attempts?: number;
  responseChars?: number;
  format?: 'tagged' | 'json' | 'jsonl' | 'other';
  finishReason?: string;
  model?: string;
  provider?: string;
}

export interface A2uiProviderPeiZhi {
  presetId: string;
  apiKey: string;
  baseURL: string;
  protocol: 'openai-compatible' | 'anthropic' | 'ollama';
}

export interface A2uiShengCheng {
  model: string;
  provider: string;
  /** 本次主回复实际使用的供应商快照；只走内存，不写入产物或审计。 */
  providerConfig?: A2uiProviderPeiZhi;
  system: string;
  user: string;
  signal: AbortSignal;
  attempt: number;
}

export interface A2uiYiLai {
  workspaceDir: (sid: string) => string;
  peizhi: () => { a2uiReplyEnabled?: boolean; nmKaiWenJian?: boolean };
  shengCheng: (p: A2uiShengCheng) => Promise<string | { text: string; finishReason?: string }>;
  yanZhengYuYan?: (messages: AgentToRendererMessage[]) => Promise<boolean>;
  guangBo: (channel: string, data: unknown) => void;
  nmKeYong: () => boolean;
  duMoBan: () => string;
  duRuntime: () => string;
  auditLog?: (op: string, data: unknown) => void;
  now?: () => number;
  randomId?: () => string;
}

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function anQuanMuLu() {
  return basicCatalog.derive({
    catalogId: A2UI_CATALOG_ID,
    components: [...AN_QUAN_COMPONENTS],
    functions: [...AN_QUAN_FUNCTIONS],
    instructions: 'WArmy 安全互动目录：只使用已注册组件与函数；不生成 HTML、CSS、JavaScript、远程 catalog 或设备授权动作。',
  });
}

let tiShiHuanCun = '';
export function a2uiTiShiShengCheng(): string {
  if (tiShiHuanCun) return tiShiHuanCun;
  const components = [
    { id: 'root', component: 'Column', children: ['check', 'notes'] },
    { id: 'check', component: 'CheckBox', label: '检查来源', value: false },
    { id: 'notes', component: 'TextField', label: '备注', value: '', variant: 'longText' },
  ];
  const example = [{ version: '1.0', createSurface: { surfaceId: 'example-surface', catalogId: A2UI_CATALOG_ID, components } }] as AgentToRendererMessage[];
  const processor = new A2uiRequestProcessor([anQuanMuLu()], { checklist: example }, new DirectJsonFormatFactory());
  tiShiHuanCun = processor.promptSnippet;
  return tiShiHuanCun;
}

/** 只消除运输包装；协议字段、组件和数据均由官方解析器校验，不在此修造。 */
export function guiFanA2uiYunShu(text: string): { source: string; wrapped: boolean; format: 'tagged' | 'json' | 'jsonl' | 'other' } {
  let source = String(text || '').trim();
  if (/<a2ui-json(?:\s|>)/i.test(source)) return { source, wrapped: true, format: 'tagged' };
  const fence = /^```(?:json|jsonl)?\s*\n([\s\S]*?)\n```\s*$/i.exec(source);
  if (fence) source = fence[1]!.trim();
  if (/^[\[{]/.test(source)) {
    try { JSON.parse(source); }
    catch {
      const lines = source.split(/\r?\n/).filter((x) => x.trim());
      if (lines.length > 1) {
        try {
          const messages = lines.map((x) => JSON.parse(x));
          if (messages.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
            return { source: JSON.stringify(messages), wrapped: false, format: 'jsonl' };
          }
        } catch { /* 非 JSONL 仍交给官方完整 JSON 校验 */ }
      }
    }
    return { source, wrapped: false, format: 'json' };
  }
  return { source, wrapped: true, format: 'other' };
}

function anQuanCuoWu(e: unknown): string {
  const raw = String((e as Error)?.message || '');
  const own = /^a2ui-[a-z-]+$/.exec(raw);
  if (own) return own[0];
  if (/catalog/i.test(raw)) return 'a2ui-catalog-invalid';
  if (/surface/i.test(raw)) return 'a2ui-surface-invalid';
  if (/JSON|parse|block|response ended/i.test(raw)) return 'a2ui-format-invalid';
  if (/component|root|schema|validation|reachable/i.test(raw)) return 'a2ui-schema-invalid';
  if (/HTTP|fetch|network|timeout|abort/i.test(raw)) return 'a2ui-request-failed';
  if (/ENOENT|EACCES|EPERM/i.test(raw)) return 'a2ui-storage-failed';
  return 'a2ui-invalid';
}

function xiaoYanXiaoXi(messages: AgentToRendererMessage[], surfaceId: string): void {
  if (!messages.length) throw new Error('a2ui-empty');
  const raw = JSON.stringify(messages);
  if (Buffer.byteLength(raw, 'utf8') > 5 * 1024 * 1024) throw new Error('a2ui-too-large');
  let components = 0;
  const allowed = new Set(['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']);
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const o = v as Record<string, unknown>;
    if (o.component === 'Image' && typeof o.url === 'string' && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(o.url)) {
      throw new Error('a2ui-image-remote-forbidden');
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === 'components' && Array.isArray(x)) components += x.length;
      walk(x);
    }
  };
  for (const message of messages) {
    const m = message as unknown as Record<string, unknown>;
    if (m.version !== '1.0') throw new Error('a2ui-version');
    const keys = Object.keys(m).filter((k) => k !== 'version');
    if (keys.length !== 1 || !allowed.has(keys[0]!)) throw new Error('a2ui-message-forbidden');
    const body = m[keys[0]!] as Record<string, unknown> | undefined;
    if (!body || body.surfaceId !== surfaceId) throw new Error('a2ui-surface-mismatch');
    walk(message);
  }
  if (components > 300) throw new Error('a2ui-too-many-components');
}

export function bianYiA2ui(text: string, surfaceId: string): AgentToRendererMessage[] {
  const source = String(text || '');
  /* 先拦资源上限，避免官方解析器在超大组件树上做完整拓扑校验。 */
  if (Buffer.byteLength(source, 'utf8') > 6 * 1024 * 1024) throw new Error('a2ui-too-large');
  if ((source.match(/"component"\s*:/g) || []).length > 300) throw new Error('a2ui-too-many-components');
  const processor = new A2uiRequestProcessor([anQuanMuLu()], undefined, new DirectJsonFormatFactory());
  const transport = guiFanA2uiYunShu(source);
  const parts = processor.parseResponse(transport.source, { wrapped: transport.wrapped });
  const messages = parts
    .filter((p): p is Extract<typeof p, { type: 'a2ui' }> => p.type === 'a2ui')
    .flatMap((p) => p.a2ui);
  xiaoYanXiaoXi(messages, surfaceId);
  const renderer = new MessageProcessor([anQuanMuLu()], undefined, {
    version: '1.0', validationConfig: STRICT_VALIDATION, reportErrorsOnly: false,
  });
  try {
    renderer.processMessages(messages);
    const surface = renderer.getSurface(surfaceId);
    if (!surface || !surface.componentsModel.has(surface.rootId)) throw new Error('a2ui-root-missing');
  } finally { renderer.dispose(); }
  return messages;
}

function anQuanLuJing(root: string, target: string): string {
  const base = path.resolve(root);
  const out = path.resolve(target);
  if (out !== base && !out.startsWith(base + path.sep)) throw new Error('a2ui-path-escape');
  return out;
}

function xieYuanZi(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function htmlNeiRong(template: string, data: string, sid?: string, mid?: string): string {
  /* script[type=application/json] 里必须是原始 JSONL；再套 JSON.stringify 会变成字符串字面量。 */
  const safe = String(data || '').replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const attr = (v: string) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  /* R308⑨：带上会话/消息标识，互动窗口按钮动作才能回传宿主定位存档落点。 */
  const tagged = template.replace('<script id="a2ui-data" type="application/json">',
    () => '<script id="a2ui-data" type="application/json" data-session="' + attr(sid || '') + '" data-message="' + attr(mid || '') + '">');
  return tagged.replace('__A2UI_DATA__', () => safe);
}

export function chuangJianA2uiHuiFu(yiLai: A2uiYiLai) {
  const now = yiLai.now || (() => Date.now());
  const randomId = yiLai.randomId || (() => crypto.randomBytes(6).toString('hex'));
  const zhuangTai = new Map<string, A2uiZhuangTai>();
  const renWu = new Map<string, AbortController>();
  const keyOf = (sid: string, mid: string) => sid + '\u0000' + mid;

  function bao(s: A2uiZhuangTai): void {
    zhuangTai.set(keyOf(s.sessionId, s.messageId), s);
    try { yiLai.guangBo('warmy:a2uiZhuangTai', s); } catch { /* 状态广播失败不影响产物 */ }
  }

  function luJing(sid: string, mid: string): { dir: string; manifest: string } {
    const safeSid = String(sid || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const safeMid = String(mid || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
    if (!safeSid || !safeMid) throw new Error('a2ui-bad-id');
    const dir = anQuanLuJing(yiLai.workspaceDir(sid), path.join(yiLai.workspaceDir(sid), 'a2ui', safeMid));
    return { dir, manifest: path.join(dir, 'manifest.json') };
  }

  function cha(sid: string, mid: string): A2uiZhuangTai | null {
    const mem = zhuangTai.get(keyOf(sid, mid));
    if (mem) return mem;
    try {
      const { manifest } = luJing(sid, mid);
      const j = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Partial<A2uiZhuangTai>;
      if (j.sessionId !== sid || j.messageId !== mid || !['ready', 'failed', 'cancelled', 'interrupted'].includes(String(j.status))) return null;
      const s = j as A2uiZhuangTai;
      zhuangTai.set(keyOf(sid, mid), s);
      return s;
    } catch { return null; }
  }

  async function kaiShi(input: {
    sessionId: string;
    messageId: string;
    userText: string;
    reply: string;
    model: string;
    provider: string;
    providerConfig?: A2uiProviderPeiZhi;
    /** R310①：手动生成/重新生成（马头确认框）不受全局开关限制，且 ready 也允许重跑。 */
    force?: boolean;
  }): Promise<A2uiZhuangTai> {
    const sid = String(input.sessionId || ''), mid = String(input.messageId || '');
    if ((!yiLai.peizhi().a2uiReplyEnabled && !input.force) || !sid || !mid || !String(input.reply || '').trim()) {
      return { sessionId: sid, messageId: mid, artifactId: mid, status: 'cancelled', ts: now() };
    }
    const old = cha(sid, mid);
    if (old?.status === 'ready' && !input.force) { bao(old); return old; }
    /* R301：任务键＝会话+消息。进化双臂/连续回复互不取消；quXiao 仍按会话整批取消。 */
    const taskKey = keyOf(sid, mid);
    if (old?.status === 'generating' && renWu.has(taskKey)) return old;
    renWu.get(taskKey)?.abort();
    const ctrl = new AbortController(); renWu.set(taskKey, ctrl);
    const timeout = setTimeout(() => ctrl.abort(), 120000); timeout.unref();
    const start: A2uiZhuangTai = { sessionId: sid, messageId: mid, artifactId: mid, status: 'generating', ts: now(), model: input.model, provider: input.provider };
    bao(start);
    let stage: A2uiZhuangTai['stage'] = 'request';
    let attempts = 0, responseChars = 0;
    let format: A2uiZhuangTai['format'] = 'other', finishReason = '';
    try {
      const system = '你是 WArmy 的原生 A2UI 互动回复生成器。根据用户问题和普通回复，生成简洁互动界面。只输出 A2UI Direct JSON，禁止解释、HTML、CSS 或 JavaScript。示例仅说明结构，实际内容与语言必须符合本次回复。\n\n' + a2uiTiShiShengCheng();
      const user = '【用户问题】\n' + String(input.userText || '').slice(0, 4000)
        + '\n\n【普通回复，互动内容必须与它一致】\n' + String(input.reply || '').slice(0, 16000)
        + '\n\n【本次目标】surfaceId 必须严格为 ' + JSON.stringify(mid) + '；catalogId 必须为 ' + JSON.stringify(A2UI_CATALOG_ID) + '。';
      let messages: AgentToRendererMessage[] = [], feedback = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        attempts = attempt + 1; stage = 'request';
        const response = await yiLai.shengCheng({
          model: input.model, provider: input.provider, providerConfig: input.providerConfig,
          system, user: user + feedback, signal: ctrl.signal, attempt,
        });
        if (ctrl.signal.aborted) throw new Error('a2ui-cancelled');
        const text = typeof response === 'string' ? response : response.text;
        finishReason = typeof response === 'string' ? '' : String(response.finishReason || '').slice(0, 32);
        responseChars = text.length;
        format = guiFanA2uiYunShu(text.slice(0, 6 * 1024 * 1024)).format;
        stage = 'parse';
        try {
          if (finishReason === 'length') throw new Error('a2ui-truncated');
          messages = bianYiA2ui(text, mid);
          if (yiLai.yanZhengYuYan && !await yiLai.yanZhengYuYan(messages)) throw new Error('a2ui-language');
          break;
        } catch (e) {
          const code = anQuanCuoWu(e);
          try { yiLai.auditLog?.('a2ui.validation-failed', { sessionId: sid, messageId: mid, code, attempts, format, responseChars, finishReason }); } catch { /* 不影响失败回执 */ }
          if (attempt === 2 || ctrl.signal.aborted) throw e;
          feedback = '\n【校验反馈】' + code + '。重新生成更简洁的完整合法 JSON；不要更改目标 ID、catalog 或安全目录。只使用本次问题和普通回复，不执行工具。';
        }
      }
      if (ctrl.signal.aborted) throw new Error('a2ui-cancelled');
      stage = 'write';
      const { dir, manifest } = luJing(sid, mid);
      fs.mkdirSync(dir, { recursive: true });
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      const runtime = yiLai.duRuntime();
      const entry = htmlNeiRong(yiLai.duMoBan(), jsonl, sid, mid);
      xieYuanZi(path.join(dir, 'surface.jsonl'), jsonl);
      xieYuanZi(path.join(dir, 'a2ui-runtime.js'), runtime);
      xieYuanZi(path.join(dir, 'index.html'), entry);
      const ready: A2uiZhuangTai = {
        ...start, status: 'ready', ts: now(), entryPath: path.join(dir, 'index.html'),
        nmAvailable: yiLai.nmKeYong(), attempts, responseChars, format, finishReason,
      };
      xieYuanZi(manifest, JSON.stringify({
        ...ready, protocol: 'a2ui/1.0', catalog: A2UI_CATALOG_ID,
        surfaceSha256: sha256(jsonl), entrySha256: sha256(entry), runtimeSha256: sha256(runtime),
        model: input.model, provider: input.provider,
      }, null, 2));
      const indexFile = path.join(yiLai.workspaceDir(sid), 'a2ui', 'index.json');
      let index: { version: number; items: Record<string, A2uiZhuangTai> } = { version: 1, items: {} };
      try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as typeof index; } catch { /* 新工作区 */ }
      index.items[mid] = ready;
      xieYuanZi(indexFile, JSON.stringify(index, null, 2));
      bao(ready);
      try { yiLai.auditLog?.('a2ui.ready', { sessionId: sid, messageId: mid, components: messages.length }); } catch { /* noop */ }
      return ready;
    } catch (e) {
      const aborted = ctrl.signal.aborted;
      const failed: A2uiZhuangTai = {
        ...start, status: aborted ? 'cancelled' : 'failed', ts: now(),
        error: aborted ? 'a2ui-cancelled' : anQuanCuoWu(e), stage, attempts, responseChars, format, finishReason,
      };
      try { xieYuanZi(luJing(sid, mid).manifest, JSON.stringify(failed, null, 2)); } catch { /* 无目录也要保留内存状态 */ }
      bao(failed);
      try { yiLai.auditLog?.('a2ui.failed', failed); } catch { /* 失败状态已经持久化 */ }
      return failed;
    } finally {
      clearTimeout(timeout);
      if (renWu.get(taskKey) === ctrl) renWu.delete(taskKey);
    }
  }

  function quXiao(sid: string): void {
    const prefix = String(sid || '') + '\u0000';
    for (const [k, ctrl] of [...renWu]) {
      if (!k.startsWith(prefix)) continue;
      ctrl.abort();
      renWu.delete(k);
    }
  }
  /** R311⑫：重新生成文字回复后丢弃旧互动产物（状态/manifest/index），马头回文字色。 */
  function wangJi(sid: string, mid: string): void {
    const k = keyOf(sid, mid);
    renWu.get(k)?.abort();
    renWu.delete(k);
    zhuangTai.delete(k);
    try {
      const { dir, manifest } = luJing(sid, mid);
      fs.rmSync(dir, { recursive: true, force: true });
      const indexFile = path.join(yiLai.workspaceDir(sid), 'a2ui', 'index.json');
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as { items?: Record<string, unknown> };
      if (index && index.items) { delete index.items[mid]; fs.writeFileSync(indexFile, JSON.stringify(index, null, 2)); }
      void manifest;
    } catch { /* 无产物也正常 */ }
  }

  function duKuaiZhao(sid: string, mid: string): { ok: boolean; path?: string; nmAvailable?: boolean; error?: string; html?: Buffer; runtime?: Buffer; jsonl?: string } {
    const s = cha(sid, mid);
    if (!s || s.status !== 'ready' || !s.entryPath) return { ok: false, error: 'a2ui-not-ready' };
    try {
      const { dir, manifest } = luJing(sid, mid);
      const file = anQuanLuJing(dir, s.entryPath);
      if (path.basename(file) !== 'index.html' || !fs.existsSync(file)) return { ok: false, error: 'a2ui-missing' };
      const j = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { entrySha256?: string; surfaceSha256?: string; runtimeSha256?: string; sessionId?: string; messageId?: string };
      const surfaceFile = path.join(dir, 'surface.jsonl');
      const runtimeFile = path.join(dir, 'a2ui-runtime.js');
      if (!fs.existsSync(surfaceFile) || !fs.existsSync(runtimeFile)) return { ok: false, error: 'a2ui-missing' };
      for (const f of [file, surfaceFile, runtimeFile]) {
        if (fs.statSync(f).size > 16 * 1024 * 1024) return { ok: false, error: 'a2ui-too-large' };
      }
      const html = fs.readFileSync(file), surface = fs.readFileSync(surfaceFile), runtime = fs.readFileSync(runtimeFile);
      /* runtime 还必须与安装资源中的受信副本一致；只比可写 manifest 不足以防止替换。 */
      if (j.sessionId !== sid || j.messageId !== mid
        || j.entrySha256 !== sha256(html)
        || j.surfaceSha256 !== sha256(surface)
        || j.runtimeSha256 !== sha256(runtime)
        || j.runtimeSha256 !== sha256(yiLai.duRuntime())) return { ok: false, error: 'a2ui-integrity' };
      bianYiA2ui(surface.toString('utf8'), mid);
      if (html.toString('utf8') !== htmlNeiRong(yiLai.duMoBan(), surface.toString('utf8'), sid, mid)) return { ok: false, error: 'a2ui-integrity' };
      return { ok: true, path: file, nmAvailable: yiLai.nmKeYong(), html, runtime, jsonl: surface.toString('utf8') };
    } catch { return { ok: false, error: 'a2ui-invalid' }; }
  }

  function daKai(sid: string, mid: string): { ok: boolean; path?: string; nmAvailable?: boolean; error?: string } {
    const { html: _html, runtime: _runtime, jsonl: _jsonl, ...result } = duKuaiZhao(sid, mid);
    return result;
  }

  function tuPian(s: A2uiZhuangTai): LiaoTianNeiRongBu[] {
    if (s.status !== 'ready' || !s.entryPath) return [];
    return [{ type: 'text', text: '互动内容已生成：' + s.entryPath }];
  }

  return { kaiShi, cha, quXiao, wangJi, daKai, duKuaiZhao, tuPian };
}
