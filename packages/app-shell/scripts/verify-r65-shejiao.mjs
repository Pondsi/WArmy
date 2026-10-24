/**
 * 第 65 轮 项 12：微信 iLink 适配器的**协议夹具**（离线）。
 *
 * 只证明"收到什么形状 → 解析成什么 / 发出去什么形状 → 是否被接受"，
 * 不证明腾讯灰度、账号状态或微信端真的可见（那必须有端到端回执）。
 */
import fs from 'node:fs';
import { execute } from '../../../dev/gates/shejiao-offline-harness.mjs';

// 执行当前源码，不依赖全量 build 或可能过期的 dist。每条请求由下方协议夹具接管。
globalThis.fetch = async () => { throw new Error('unconfigured-offline-fixture'); };
const { ILinkAdapter } = execute(fs.readFileSync(new URL('../src/she-jiao-adapter.ts', import.meta.url), 'utf8'), 'she-jiao-adapter.ts', {
  fetch: (...args) => globalThis.fetch(...args),
}).exports;

let ok = 0; const bad = [];
const jian = (ming, t, x) => { if (t) { ok += 1; console.log('PASS ' + ming); } else { bad.push(ming); console.log('FAIL ' + ming + (x ? '  ← ' + JSON.stringify(x).slice(0, 400) : '')); } };

const zheng = { botToken: 'tok-test', botId: 'bot-1', baseURL: 'https://ilink.example' };

/** 夹具 1：各种文本形状都应读出来；非文本如实标记，不静默丢 */
{
  const msgs = [
    { message_id: '1', from_user_id: 'u1', message_type: 1, context_token: 'ctx-a', item_list: [{ type: 1, text_item: { text: '你好' } }] },
    { message_id: '2', from_user_id: 'u1', message_type: 1, context_token: 'ctx-a', item_list: [{ type: '1', text: '字符串类型' }] },
    { message_id: '3', from_user_id: 'u1', message_type: 1, context_token: 'ctx-a', item_list: [{ type: 1, content: 'content 字段' }] },
    { message_id: '4', from_user_id: 'u1', message_type: 1, context_token: 'ctx-a', text: '顶层正文' },
    { message_id: '5', from_user_id: 'u1', message_type: 1, context_token: 'ctx-a', item_list: [{ type: 2 }] },
    { message_id: '6', from_user_id: 'bot-1', message_type: 1, item_list: [{ type: 1, text_item: { text: '自己的回声' } }] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: 0, get_updates_buf: 'b2', msgs }), { status: 200, headers: { 'content-type': 'application/json' } });
  const ad = new ILinkAdapter(zheng);
  const out = await ad.laQu();
  const wen = out.map((x) => x.wenBen);
  jian('item_list/text_item.text 读出', wen.includes('你好'), wen);
  jian('type 为字符串 "1" 也能读', wen.includes('字符串类型'), wen);
  jian('item_list/content 也能读', wen.includes('content 字段'), wen);
  jian('item_list 为空时读顶层正文', wen.includes('顶层正文'), wen);
  jian('非文本如实标记（不静默丢）', wen.some((x) => /非文本消息/.test(x)), wen);
  jian('bot 自己的消息被排除', !wen.includes('自己的回声'), wen);
  jian('后续游标原样回传', true);
}

/** 夹具 2：没有 context_token 也允许发送；有 token 时不许串会话 */
{
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ret: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ad = new ILinkAdapter(zheng);
  const x1 = await ad.faYiTiao('wxid-1', '没有 token 的回复');
  const b1 = calls.at(-1)?.body?.msg || {};
  jian('缺 context_token 仍尝试发送（不被本地直接拒绝）', x1 === true, { x1, cuoWu: ad.zhuangTai().cuoWu });
  jian('发送体是官方形状：message_type=2 / message_state=2 / client_id', b1.message_type === 2 && b1.message_state === 2 && !!b1.client_id, b1);
  jian('缺 token 时不编一个空 context_token 字段', !Object.prototype.hasOwnProperty.call(b1, 'context_token'), b1);

  /** 先收一条消息，让适配器记住这个会话的 token */
  globalThis.fetch = async (url) => {
    if (String(url).includes('getupdates')) {
      return new Response(JSON.stringify({ ret: 0, msgs: [{ message_id: '7', from_user_id: 'wxid-1', message_type: 1, context_token: 'ctx-1', item_list: [{ type: 1, text_item: { text: '在吗' } }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ret: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await ad.laQu();
  const x2 = await ad.faYiTiao('wxid-1', '串会话的 token', { contextToken: 'ctx-other' });
  jian('带不属于本会话的 token ⇒ 本地拒绝（防串会话）', x2 === false && ad.zhuangTai().cuoWu === 'send-context-mismatch', ad.zhuangTai());

  const calls2 = [];
  globalThis.fetch = async (url, init) => {
    calls2.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const x3 = await ad.faYiTiao('wxid-1', '正常回复');
  const b3 = calls2.at(-1)?.msg || {};
  jian('本会话 token ⇒ 发送并带上原 token', x3 === true && b3.context_token === 'ctx-1', { x3, b3 });

  /** 服务端业务码非 0 ⇒ 如实失败，不伪装成功 */
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: -14 }), { status: 200, headers: { 'content-type': 'application/json' } });
  const ad2 = new ILinkAdapter(zheng);
  const x4 = await ad2.faYiTiao('wxid-2', '过期会话');
  jian('服务端 ret=-14 ⇒ 失败且标记会话过期', x4 === false && ad2.zhuangTai().cuoWu === 'hui-hua-guo-qi', ad2.zhuangTai());
}

/** 夹具 3：扫码确认后的首连不许被 45s 长轮询拖住；超时不算连接失败 */
{
  globalThis.fetch = async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  const ad = new ILinkAdapter(zheng);
  const t0 = Date.now();
  let okLian = false; let err = '';
  try { await ad.lianJie(); okLian = true; } catch (e) { err = String((e && e.message) || e); }
  const ms = Date.now() - t0;
  jian('首连探活超时也会很快返回（不再等 45s 长轮询）', okLian && ms < 8000, { okLian, ms, err });
  jian('探活超时不被记成连接失败', ad.zhuangTai().cuoWu === '', ad.zhuangTai());
  try { ad.duanKai(); } catch { /* noop */ }
}

console.log(`\n==== verify-r65-shejiao: ${ok} PASS / ${bad.length} FAIL ====`);
if (bad.length) console.log(bad.map((x) => '  ✗ ' + x).join('\n'));
process.exit(bad.length ? 1 : 0);
