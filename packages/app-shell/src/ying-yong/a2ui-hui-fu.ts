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
}

export interface A2uiYiLai {
  workspaceDir: (sid: string) => string;
  peizhi: () => { a2uiReplyEnabled?: boolean; nmKaiWenJian?: boolean };
  shengCheng: (p: A2uiShengCheng) => Promise<string>;
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

export function a2uiTiShiShengCheng(): string {
  const processor = new A2uiRequestProcessor([anQuanMuLu()], undefined, new DirectJsonFormatFactory());
  return processor.promptSnippet;
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
  const parts = processor.parseResponse(source);
  const messages = parts
    .filter((p): p is Extract<typeof p, { type: 'a2ui' }> => p.type === 'a2ui')
    .flatMap((p) => p.a2ui);
  xiaoYanXiaoXi(messages, surfaceId);
  const renderer = new MessageProcessor([anQuanMuLu()], undefined, {
    version: '1.0', validationConfig: STRICT_VALIDATION, reportErrorsOnly: false,
  });
  renderer.processMessages(messages);
  const surface = renderer.getSurface(surfaceId);
  if (!surface || !surface.componentsModel.has(surface.rootId)) throw new Error('a2ui-root-missing');
  renderer.dispose();
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

function htmlNeiRong(template: string, data: string): string {
  /* script[type=application/json] 里必须是原始 JSONL；再套 JSON.stringify 会变成字符串字面量。 */
  const safe = String(data || '').replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('__A2UI_DATA__', () => safe);
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
  }): Promise<A2uiZhuangTai> {
    const sid = String(input.sessionId || ''), mid = String(input.messageId || '');
    if (!yiLai.peizhi().a2uiReplyEnabled || !sid || !mid || !String(input.reply || '').trim()) {
      return { sessionId: sid, messageId: mid, artifactId: mid, status: 'cancelled', ts: now() };
    }
    const old = cha(sid, mid);
    if (old?.status === 'ready') { bao(old); return old; }
    renWu.get(sid)?.abort();
    const ctrl = new AbortController(); renWu.set(sid, ctrl);
    const start: A2uiZhuangTai = { sessionId: sid, messageId: mid, artifactId: mid, status: 'generating', ts: now() };
    bao(start);
    try {
      const system = '你是 WArmy 的原生 A2UI 互动回复生成器。根据用户问题和已经生成的普通回复，生成一个简洁、可操作的互动界面。只输出 A2UI Direct JSON，不输出解释、HTML、CSS 或 JavaScript。目标 surfaceId 必须为 "' + mid + '"。\n\n' + a2uiTiShiShengCheng();
      const user = '【用户问题】\n' + String(input.userText || '').slice(0, 4000)
        + '\n\n【普通回复，互动内容必须与它一致】\n' + String(input.reply || '').slice(0, 16000);
      const text = await yiLai.shengCheng({
        model: input.model, provider: input.provider, providerConfig: input.providerConfig, system, user, signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) throw new Error('a2ui-cancelled');
      const messages = bianYiA2ui(text, mid);
      const { dir, manifest } = luJing(sid, mid);
      fs.mkdirSync(dir, { recursive: true });
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      const runtime = yiLai.duRuntime();
      const entry = htmlNeiRong(yiLai.duMoBan(), jsonl);
      xieYuanZi(path.join(dir, 'surface.jsonl'), jsonl);
      xieYuanZi(path.join(dir, 'a2ui-runtime.js'), runtime);
      xieYuanZi(path.join(dir, 'index.html'), entry);
      const ready: A2uiZhuangTai = {
        ...start, status: 'ready', ts: now(), entryPath: path.join(dir, 'index.html'),
        nmAvailable: yiLai.nmKeYong(),
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
        error: aborted ? 'a2ui-cancelled' : String((e as Error)?.message || e).slice(0, 160),
      };
      try { xieYuanZi(luJing(sid, mid).manifest, JSON.stringify(failed, null, 2)); } catch { /* 无目录也要保留内存状态 */ }
      bao(failed);
      return failed;
    } finally {
      if (renWu.get(sid) === ctrl) renWu.delete(sid);
    }
  }

  function quXiao(sid: string): void {
    const ctrl = renWu.get(String(sid || ''));
    if (!ctrl) return;
    ctrl.abort();
    renWu.delete(String(sid || ''));
  }

  function daKai(sid: string, mid: string): { ok: boolean; path?: string; nmAvailable?: boolean; error?: string } {
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
      /* runtime 还必须与安装资源中的受信副本一致；只比可写 manifest 不足以防止替换。 */
      if (j.sessionId !== sid || j.messageId !== mid
        || j.entrySha256 !== sha256(fs.readFileSync(file))
        || j.surfaceSha256 !== sha256(fs.readFileSync(surfaceFile))
        || j.runtimeSha256 !== sha256(fs.readFileSync(runtimeFile))
        || j.runtimeSha256 !== sha256(yiLai.duRuntime())) return { ok: false, error: 'a2ui-integrity' };
      return { ok: true, path: file, nmAvailable: !!s.nmAvailable && yiLai.nmKeYong() };
    } catch { return { ok: false, error: 'a2ui-invalid' }; }
  }

  function tuPian(s: A2uiZhuangTai): LiaoTianNeiRongBu[] {
    if (s.status !== 'ready' || !s.entryPath) return [];
    return [{ type: 'text', text: '互动内容已生成：' + s.entryPath }];
  }

  return { kaiShi, cha, quXiao, daKai, tuPian };
}
