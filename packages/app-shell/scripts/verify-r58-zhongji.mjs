/**
 * verify-r58-zhongji.mjs（fast 档）—— 第 58 轮：可选中继服务器的协议与"服务器看不到明文"。
 *
 * 真链路：起样机服务器（内存中继，不落盘）→ 两个身份注册 → A 发给 B → B 轮询并解密；
 * 离线收件人 ⇒ 服务器回 offline，消息留在发送方（这里用本地队列模拟）；
 * 篡改密文 ⇒ 解密失败；用错误密钥 ⇒ 解密失败。另断言服务器源码里没有落盘/解密调用。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const K = await import(U('packages/app-shell/dist/zhong-ji-ke-hu.js'));
const { fwPath } = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/scripts/fwarmy-loc.mjs')).href);
const SERVER = fwPath('server.mjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 140) : '')); } };
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
/** 测试用临时数据目录：不往仓库里的 fwarmy/data 写测试凭据/测试配置 */
const shuJu = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-relay-'));
const srv = spawn(process.execPath, [SERVER, '--port=' + port, '--host=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WARMY_RELAY_DATA: shuJu } });
let ready = false;
srv.stdout.on('data', (b) => { if (String(b).includes('[fwarmy]')) ready = true; });
try {
  for (let i = 0; i < 60 && !ready; i++) await sleep(100);
  jian('样机服务器能在本机随机端口启动（内存中继）', ready);
  {
    /** ctl stop 靠健康检查确认“端口上是不是我们的服务”；它必须不需要业务凭据 */
    const h = await (await fetch(base + '/api/health')).json();
    jian('健康检查无需凭据即可读，且能认出 fwarmy-relay（ctl stop 的前提）', h.ok === true && h.server === 'fwarmy-relay' && h.product === 'FWArmy', JSON.stringify(h));
  }

  /** 管理面：本机直接操作（第 63 轮用户口径，不再有管理密钥/登录步骤） */
  const mk = await (await fetch(base + '/api/admin/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'gate-测试凭据' }) })).json();
  jian('本机管理面无需密钥即可生成**有名称**的凭据（打开即用）', mk.ok === true && !!mk.token && mk.name === 'gate-测试凭据');
  jian('不再生成管理密钥文件（少一个要用户保管的秘密）', !fs.existsSync(path.join(shuJu, 'admin-key.txt')));
  const cred = mk.token;

  const A = K.shengChengShenFen();
  const B = K.shengChengShenFen();
  const C = K.shengChengShenFen();
  const ka = K.zhuanJiKeHu(base, () => A, cred);
  const kb = K.zhuanJiKeHu(base, () => B, cred);
  const kc = K.zhuanJiKeHu(base, () => C, cred);
  const keWu = K.zhuanJiKeHu(base, () => ({ ...A }), '');
  jian('没有凭据 ⇒ 业务面 401（服务器确认"你有权使用"）', (await keWu.chaXun(B.edPub)).ok === false || (await keWu.zhuCe()) === false);

  jian('A 注册成功（身份签名被服务器校验）', await ka.zhuCe() === true);
  jian('B 注册成功', await kb.zhuCe() === true);
  {
    const f = await fetch(base + '/api/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cred }, body: JSON.stringify({ did: A.edPub, ts: Date.now(), sig: 'AAAA' }) });
    jian('心跳伪造签名 ⇒ 401（不能拿凭据替别人上线）', f.status === 401);
    const p = await fetch(base + '/api/poll?did=' + encodeURIComponent(A.edPub) + '&ts=' + Date.now() + '&sig=AAAA', { headers: { authorization: 'Bearer ' + cred } });
    jian('取信伪造签名 ⇒ 401（不能拿凭据取走/删除别人的密文）', p.status === 401);
  }
  jian('查询在线状态：B 在线', (await ka.chaXun(B.edPub)).online === true);

  const xin = K.fengZhuang(B.boxPub, '今晚八点老地方见', { did: A.edPub, edPriv: A.edPriv });
  const env = JSON.stringify(xin);
  jian('服务器只看得到不透明信封（没有明文片段）', !env.includes('今晚八点') && !env.includes('老地方'));

  const t1 = await ka.touDi(B.edPub, xin);
  jian('在线转发成功', t1.ok === true, JSON.stringify(t1));
  const lai = await kb.lunXun();
  jian('B 轮询拿到 1 个信封', lai.length === 1, String(lai.length));
  const wen = K.jieFeng(JSON.parse(lai[0]), B.boxPriv);
  jian('B 解密得到原文（端到端）', wen === '今晚八点老地方见', wen);

  const t2 = await ka.touDi(C.edPub, K.fengZhuang(C.boxPub, '你不在线时发的', { did: A.edPub, edPriv: A.edPriv }));
  jian('收件人离线 ⇒ 服务器回 offline（不替人存消息）', t2.ok === false && t2.offline === true, JSON.stringify(t2));

  const cuo = JSON.parse(JSON.stringify(xin));
  // 必须保证真的改了一个字节：旧写法若原首字节本来就是 0，密文没变 ⇒ 偶发“篡改后仍能解开”的假红。
  cuo.ct = (() => { const b = Buffer.from(String(cuo.ct), 'base64'); b[0] = (b[0] ^ 0xff) & 0xff; return b.toString('base64'); })();
  let jieCuo = false;
  try { K.jieFeng(cuo, B.boxPriv); } catch { jieCuo = true; }
  jian('篡改密文 ⇒ 解密失败（AEAD 校验）', jieCuo);

  let jieCuo2 = false;
  try { K.jieFeng(xin, C.boxPriv); } catch { jieCuo2 = true; }
  jian('服务器/第三方即使拿到信封，用错误密钥也解不开', jieCuo2);

  const zao = JSON.parse(JSON.stringify(xin));
  zao.from = C.edPub;
  let jieCuo3 = false;
  try { K.jieFeng(zao, B.boxPriv); } catch { jieCuo3 = true; }
  jian('伪造发件人 ⇒ 签名校验失败', jieCuo3);

  const jianCe = fs.readFileSync(SERVER, 'utf8');
  jian('服务器源码不落盘**消息**（只落凭据/配置；没有写队列或信封的调用）', !/(writeFile|appendFile|createWriteStream)[^;]*(queue|env)/i.test(jianCe) && /credentials.json/.test(jianCe));
  jian('服务器不解密消息正文（无 jieFeng；信封只读路由/签名元数据）', !/jieFeng/.test(jianCe) && /originSig|originPub/.test(jianCe));
  jian('服务器有队列上限与 TTL（不能当免费存储）', /queuePerUser: 50/.test(jianCe) && /TTL_MS = 30_000/.test(jianCe));
  const st = await (await fetch(base + '/api/admin/stats')).json();
  jian('取走后队列清空（不残留消息）', st && st.queued === 0, JSON.stringify(st && st.queued));
  const adminPage = await (await fetch(base + '/')).text();
  /** 第 65 轮 项 1：暂停/恢复在顶部启停按钮，不再放在全局配置区 */
  jian('管理页真能打开且带可视化控件（不是只有 API）',
    /id=["']?cfgRate/.test(adminPage) && /id=["']?toggleService/.test(adminPage) && /saveCfg/.test(adminPage));
  jian('管理页不再要求填密钥/登录（打开即连）', !/id=key|管理密钥|x-admin-key/.test(adminPage) && /本机管理/.test(adminPage));
  {
    /** 无密钥 ≠ 无边界：DNS rebinding（Host 不是回环名）必须挡；跨站 JSON POST 也必须挡 */
    const rawStatus = (p, headers) => new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => { res.resume(); resolve(res.statusCode || 0); });
      r.on('error', () => resolve(0)); r.end();
    });
    const evilHost = await rawStatus('/api/admin/stats', { host: 'evil.example' });
    jian('Host 不是回环名 ⇒ 403（防 DNS rebinding）', evilHost === 403, String(evilHost));
    const goodHost = await rawStatus('/api/admin/stats', { host: 'localhost:' + port });
    jian('Host 是 localhost ⇒ 200（正常本机访问不受影响）', goodHost === 200, String(goodHost));
    const cross = await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ accepting: true }) });
    jian('跨站 Origin ⇒ 403（浏览器里的恶意页面不能借刀操作）', cross.status === 403);
    const form = await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'accepting=true' });
    jian('管理写操作必须是 JSON ⇒ 表单跨站 POST 被挡', form.status === 403);
    const same = await fetch(base + '/api/admin/stats', { headers: { origin: base } });
    jian('同源 Origin 仍可用（正常页面不受影响）', same.status === 200);
  }

  // ── 在线心跳（第 60 轮）──
  await (await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presenceTtlMs: 400 }) })).json();
  jian('心跳能刷新在线状态（A 上线）', (await ka.xinTiao()) === true);
  const zai = await ka.piLiangZaiXian([A.edPub, B.edPub]);
  jian('批量在线查询：A 在线、B 在线（B 刚轮询过）', zai[A.edPub].online === true && zai[B.edPub].online === true);
  await sleep(700);
  const zai2 = await ka.piLiangZaiXian([A.edPub]);
  jian('超过在线 TTL 没通讯 ⇒ 判离线（服务器只靠 lastSeen，不靠内容）', zai2[A.edPub].online === false);

  // ── 管理页（第 62 轮）：可视化改配置，且全局限流对**已有**凭据立即生效 ──
  const gui = fs.readFileSync(fwPath('admin.html'), 'utf8');
  jian('管理页有可视化配置项与自动刷新（不用记命令）', /id=["']?cfgRate/.test(gui) && /id=["']?cfgDaily/.test(gui) && /saveCfg/.test(gui) && /setInterval\(/.test(gui));
  const cfgR = await (await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ratePerMin: 2 }) })).json();
  jian('管理端能改全局限流并回显配置', cfgR.ok === true && cfgR.config.ratePerMin === 2, JSON.stringify(cfgR));
  let beiXian = false;
  for (let i = 0; i < 5; i++) { const r = await ka.chaXun(B.edPub); if (r.ok === false) beiXian = true; }
  jian('全局限流对**已有**凭据立即生效（不是建凭据时的快照）', beiXian);
} finally {
  try { srv.kill(); } catch { /* noop */ }
  try { fs.rmSync(shuJu, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`==== verify-r58-zhongji: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
