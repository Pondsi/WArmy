/** 请求边界装饰器：后台上下文携带取消凭据，前台优先；不改工具集/提示词历史，本地后端沿用运行中的上下文（不触发重载）。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ZongJieRenWu } from './zong-jie-xun-cha.js';
import { zongJieTokenGuSuan, type ZongJieHouDuan, type ZongJieXuQiu } from './zong-jie-zi-yuan.js';
export const zongJieYuJing = new AsyncLocalStorage<ZongJieRenWu>();
/** 本地后端放不下就拒发（换下一个候选），绝不让后端静默截掉开头的指令或原文。 */
export function zongJieFangDeXia(q: { xiaoXiJi?: ReadonlyArray<{ content?: unknown }>; maxTokens?: number }, need: ZongJieXuQiu | undefined): string | null {
  if (!need || need.cloud) return null;
  const limit = Number(need.context);
  if (!Number.isInteger(limit) || limit < 1024) return 'summary-context-unknown';
  return zongJieTokenGuSuan(q.xiaoXiJi || []) + Math.max(256, Number(q.maxTokens) || 1024) > Math.floor(limit * 0.9) ? 'summary-context-too-small' : null;
}
export function baoZhuangZongJieProvider<T extends { chat: (...a: any[]) => Promise<any>; chatStream: (...a: any[]) => AsyncIterable<any> }>(p: T, key: string, baseURL: string, protocol: string, resource: { pao: <R>(b: ZongJieHouDuan, fn: (s: AbortSignal, need?: ZongJieXuQiu) => Promise<R>, parent: AbortSignal) => Promise<R>; qianTai: (b: ZongJieHouDuan) => () => void }) : T {
  let local = false, unknownLocation = false;
  try {
    const host = new URL(baseURL).hostname, loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    local = protocol === 'ollama' && loopback;
    unknownLocation = loopback && protocol !== 'ollama';
  } catch { unknownLocation = true; }
  const descriptor = (q: any): ZongJieHouDuan => ({ key, baseURL, local, unknownLocation, model: String(q.model || ''), context: 0 });
  return new Proxy(p, {
    get(target, property) {
      if (property === 'chat') return async (q: any, parent?: AbortSignal) => {
        const ctx = zongJieYuJing.getStore(), b = descriptor(q);
        if (ctx) {
          if (!ctx.valid()) throw new Error('summary-stale');
          try {
            return await resource.pao(b, (s, need) => {
              const why = local ? zongJieFangDeXia(q, need) : null;
              if (why) throw new Error(why);
              // 已加载的模型：显式带上它正在用的 num_ctx，后端才不会为后台请求卸载重载；未加载则不带（用 Modelfile 声明值）。
              const body = local && need?.loaded && need.context ? { ...q, extra: { ...q.extra, options: { ...q.extra?.options, num_ctx: need.context } } } : q;
              return target.chat(body, parent ? AbortSignal.any([parent, s]) : s);
            }, ctx.signal);
          } catch (error) {
            if ((error as Error)?.message === 'summary-preempted') ctx.fail?.();
            throw error;
          }
        }
        const release = resource.qianTai(b);
        try { return await target.chat(q, parent); } finally { release(); }
      };
      if (property === 'chatStream') return async function* (q: any, parent?: AbortSignal) {
        // 总结只走非流式候选；防止后台通过流式旁路绕过限额。
        if (zongJieYuJing.getStore()) throw new Error('summary-stream-not-allowed');
        const release = resource.qianTai(descriptor(q));
        try { yield* target.chatStream(q, parent); } finally { release(); }
      };
      const v = Reflect.get(target, property, target); return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
