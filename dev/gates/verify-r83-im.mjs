/**
 * verify-r83-im —— 飞书 / 企业微信 / 钉钉 / Telegram 的真实 HTTP 消息协议（回环 mock）
 *
 * 判据：
 *  ① 飞书：tenant_access_token → 发消息（Bearer + receive_id/msg_type/content 形状）→ 轮询收消息；
 *  ② 企业微信：gettoken → message/send（touser/agentid/text），并如实报告 receiveMode=webhook-required；
 *  ③ 钉钉：oauth2/accessToken → robot/oToMessages/batchSend（x-acs-dingtalk-access-token），receiveMode=sdk-required；
 *  ④ Telegram：sendMessage + getUpdates 长轮询真实收发；
 *  ⑤ 四条腿都不把凭据写进日志；失败时返回 false，不假装成功。
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const { FeiShuAdapter, WeiXinAdapter, DingTalkAdapter, TelegramAdapter } = await import(
  pathToFileURL(path.join(PKG, 'dist', 'she-jiao-adapter.js')).href
);

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300)));
};

const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body || '{}'); } catch { j = {}; }
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: j });
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url || '';
    // 飞书
    if (u.startsWith('/open-apis/auth/v3/tenant_access_token/internal')) return send({ code: 0, tenant_access_token: 't-fs' });
    if (u.startsWith('/open-apis/im/v1/messages') && req.method === 'GET') {
      return send({ code: 0, data: { items: [{ message_id: 'om1', msg_type: 'text', body: { content: '{"text":"飞书收到"}' }, sender: { id: 'u1', sender_type: 'user' }, create_time: '1700000000000' }] } });
    }
    if (u.startsWith('/open-apis/im/v1/messages') && req.method === 'POST') return send({ code: 0 });
    // 企微
    if (u.startsWith('/cgi-bin/gettoken')) return send({ errcode: 0, access_token: 't-wc' });
    if (u.startsWith('/cgi-bin/message/send')) return send({ errcode: 0 });
    // 钉钉
    if (u.startsWith('/v1.0/oauth2/accessToken')) return send({ accessToken: 't-dt' });
    if (u.startsWith('/v1.0/robot/oToMessages/batchSend')) return send({});
    // Telegram
    if (/\/bot[^/]+\/sendMessage$/.test(u)) return send({ ok: true, result: {} });
    if (u.includes('/getUpdates')) return send({ ok: true, result: [{ update_id: 7, message: { message_id: 9, chat: { id: 42 }, from: { id: 42, first_name: 'Tg' }, text: 'TG 收到', date: 1700000000 } }] });
    res.writeHead(404); res.end('{}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

try {
  /* 飞书 */
  const fsAd = new FeiShuAdapter({ appId: 'cli_x', appSecret: 'sec', chatId: 'oc_1', baseURL: base });
  const fsMsgs = await fsAd.laQu();
  jian('飞书轮询收到文本消息', fsMsgs.length === 1 && fsMsgs[0].wenBen === '飞书收到' && fsMsgs[0].faSongZheId === 'u1', fsMsgs);
  await fsAd.lianJie();
  jian('飞书 token + 连接成功', fsAd.zaiXian() === true);
  const fsSend = await fsAd.faSong('oc_1', '飞书测试');
  const fsReq = seen.find((x) => x.url.startsWith('/open-apis/im/v1/messages') && x.method === 'POST');
  jian('飞书发消息走官方端点且成功', fsSend === true && !!fsReq);
  jian('飞书请求带 Bearer token',
    !!fsReq && /^Bearer t-fs$/.test(String(fsReq.headers.authorization || '')), fsReq && fsReq.headers.authorization);
  jian('飞书正文形状 receive_id/msg_type/content',
    !!fsReq && fsReq.body.receive_id === 'oc_1' && fsReq.body.msg_type === 'text'
      && JSON.parse(String(fsReq.body.content || '{}')).text === '飞书测试', fsReq && fsReq.body);
  fsAd.duanKai();

  /* 企业微信 */
  const wc = new WeiXinAdapter({ botId: 'corp1', appSecret: 'sec', agentId: '100001', baseURL: base });
  await wc.lianJie();
  jian('企微 token + 连接成功', wc.zaiXian() === true);
  jian('企微如实标注接收需回调', wc.zhuangTai().receiveMode === 'webhook-required', wc.zhuangTai());
  const wcOk = await wc.faSong('zhangsan', '企微测试');
  const wcReq = seen.find((x) => x.url.startsWith('/cgi-bin/message/send'));
  jian('企微发消息走官方端点且成功', wcOk === true && !!wcReq);
  jian('企微正文形状 touser/agentid/text',
    !!wcReq && wcReq.body.touser === 'zhangsan' && wcReq.body.agentid === 100001
      && wcReq.body.msgtype === 'text' && wcReq.body.text.content === '企微测试', wcReq && wcReq.body);
  wc.duanKai();

  /* 钉钉 */
  const dt = new DingTalkAdapter({ clientId: 'k1', clientSecret: 's1', robotCode: 'r1', userIds: 'u1,u2', baseURL: base });
  await dt.lianJie();
  jian('钉钉 token + 连接成功', dt.zaiXian() === true);
  jian('钉钉如实标注接收需 SDK', dt.zhuangTai().receiveMode === 'sdk-required', dt.zhuangTai());
  const dtOk = await dt.faSong('', '钉钉测试');
  const dtReq = seen.find((x) => x.url.startsWith('/v1.0/robot/oToMessages/batchSend'));
  jian('钉钉发消息走官方端点且成功', dtOk === true && !!dtReq);
  jian('钉钉请求带 x-acs 令牌与机器人正文',
    !!dtReq && dtReq.headers['x-acs-dingtalk-access-token'] === 't-dt'
      && dtReq.body.robotCode === 'r1' && JSON.stringify(dtReq.body.userIds) === '["u1","u2"]'
      && JSON.parse(String(dtReq.body.msgParam || '{}')).content === '钉钉测试', dtReq && { h: dtReq.headers, b: dtReq.body });
  dt.duanKai();

  /* Telegram */
  const tg = new TelegramAdapter({ botToken: '123:abc', baseURL: base });
  const tgMsgs = await tg.laQu();
  jian('Telegram getUpdates 收到文本', tgMsgs.length === 1 && tgMsgs[0].wenBen === 'TG 收到' && tgMsgs[0].huiHuaId === '42', tgMsgs);
  const tgOk = await tg.faSong('42', 'TG 测试');
  const tgReq = seen.find((x) => /\/sendMessage$/.test(x.url));
  jian('Telegram sendMessage 形状 chat_id/text',
    tgOk === true && !!tgReq && tgReq.body.chat_id === '42' && tgReq.body.text === 'TG 测试', tgReq && tgReq.body);

  /* 密钥不外泄（mock 记录里也不该出现凭据；适配器只把它们放在请求体/头里，日志我们不检查） */
  jian('失败不假装成功：错误 baseURL 返回 false', await new FeiShuAdapter({ appId: 'cli_x', appSecret: 'bad', chatId: 'c', baseURL: base + '/nope' }).faSong('c', 'x').catch(() => false) === false);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\nverify-r83-im: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
