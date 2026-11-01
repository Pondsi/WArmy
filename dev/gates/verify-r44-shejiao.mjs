/** WeChat-only offline gate. Official numeric item types; never probes live endpoints or launches Electron. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AD, adapter, execute, memorySocial, rendererSocial, message, mockHTTP, plain, checks } from './shejiao-offline-harness.mjs';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function rendererFixture(api = {}, nodes = {}) {
  const overlays = [], timers = [], subscribers = new Set();
  const xi = { textContent: '' };
  const button = (attr, value) => ({ disabled: false, getAttribute: (k) => k === attr ? value : null });
  const qr = button('data-sj-qr', 'ilink');
  const he = { isConnected: true, innerHTML: '', querySelectorAll: (selector) => nodes[selector] || (selector === '[data-sj-qr]' ? [qr] : []) };
  const document = {
    body: { appendChild: (n) => overlays.push(n), contains: (n) => overlays.includes(n) },
    querySelectorAll: () => [...overlays], getElementById: () => xi,
    createElement: () => {
      const status = { textContent: '等待扫码…' }, closeButton = {};
      const codeBox = { hidden: true }, codeInput = { value: '', focus() {} }, codeSubmit = {};
      const controls = { '[data-qr-zt]': status, '[data-qr-guan]': closeButton, '[data-qr-code-box]': codeBox, '[data-qr-code]': codeInput, '[data-qr-submit]': codeSubmit };
      const n = { style: {}, status, closeButton, codeBox, codeInput, codeSubmit, querySelector: (s) => controls[s],
        remove: () => { const i = overlays.indexOf(n); if (i >= 0) overlays.splice(i, 1); } };
      return n;
    },
  };
  const warmy = {
    sheJiaoPingTai: async () => ({ items: [{ id: 'ilink', ming: '微信' }] }),
    sheJiaoPeiZhiQu: async () => ({ items: [] }),
    sheJiaoSaoMaKaiShi: async () => ({ ok: true, qrcode: 'qr', tuNeiRong: 'offline://fixture' }),
    onSheJiaoZhuangTai: (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); },
    ...api,
  };
  const render = rendererSocial({
    window: { warmy }, document, $: () => xi,
    MutationObserver: class { observe() {} disconnect() {} },
    escapeHtml: (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    tOr: (_k, fallback) => fallback, t: (k) => k,
    qrSvg: () => '<svg></svg>', showToast: () => assert.fail('state polling must not duplicate message/toast writes'),
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  return { render: () => render({ id: 'i' }, he), he, qr, xi, overlays, timers, subscribers,
    emit: (s) => { for (const cb of subscribers) cb(s); }, button };
}

const gate = checks('verify-r44-shejiao');
const mock = await mockHTTP();
const { state } = mock;
const ad = adapter(mock.baseURL);
try {
  await gate.test('official text_item.text enters callback; message_id deduplicates; milliseconds preserved', async () => {
    const first = message('m1', 'alice', 'alice-context-1', '帮我打开 ppt');
    const image = { ...message('m2', 'alice', 'alice-context-2'), item_list: [{ type: 2, image_item: { url: 'mock-image' } }] };
    state.updates.push(first, image, first, { ...message('bot-echo', 'alice', 'ignored'), message_type: 2 });
    const received = [];
    ad.shouXiaoXi((msg) => received.push(msg));
    await ad.lianJie();
    assert.equal(received.length, 2);
    assert.equal(received[0].wenBen, '帮我打开 ppt');
    assert.equal(received[0].xiaoXiId, 'm1');
    assert.equal(received[0].ts, first.create_time_ms);
    assert.equal(received[0].huiHuaId, 'alice');
    assert.equal(received[0].contextToken, 'alice-context-1');
    assert(received[1].wenBen.includes('非文本消息：2'));
    state.updates.push(first);
    assert.equal((await ad.laQu()).length, 0);
  });
  await gate.test('POST paths, authentication and server cursor are observed on HTTP', async () => {
    assert.equal(state.gets[0].method, 'POST');
    assert.equal(state.gets[0].headers.authorizationtype, 'ilink_bot_token');
    assert.equal(state.gets[0].headers.authorization, 'Bearer offline-fixture-only');
    assert.deepEqual(state.gets[0].body, { get_updates_buf: '', longpolling_timeout_ms: 3500 });
    assert.deepEqual(state.gets[1].body, { get_updates_buf: 'cursor-1' });
  });
  await gate.test('outbound body matches official schema and original callback context', async () => {
    assert.equal(await ad.faSong('alice', '好的', { contextToken: 'alice-context-1', xiaoXiId: 'stable-client-id' }), true);
    assert.equal(state.sends[0].method, 'POST');
    assert.deepEqual(state.sends[0].body, { msg: {
      from_user_id: '', to_user_id: 'alice', client_id: 'stable-client-id',
      message_type: 2, message_state: 2, context_token: 'alice-context-1',
      item_list: [{ type: 1, text_item: { text: '好的' } }],
    } });
  });
  await gate.test('missing token sends by recipient; foreign token is refused; valid send recovers status', async () => {
    /**
     * 第 65 轮项 12（真机：收到消息却回不出去）已把契约改成：
     * **没有 context_token 也按收件人发送**，只有"带了 token 但它不属于本会话"才拒绝。
     * 旧门禁还在要求 send-no-context-token ⇒ 是门禁过期，不是产品回归。
     */
    const count = state.sends.length;
    assert.equal(await ad.faSong('unknown', '不可发送'), true);
    assert.notEqual(ad.zhuangTai().cuoWu, 'send-no-context-token');
    assert.equal(state.sends.length, count + 1);
    assert.equal(await ad.faSong('unknown', '不可借用 context', { contextToken: 'alice-context-1' }), false);
    assert.equal(state.sends.length, count + 1);
    assert.equal(await ad.faSong('alice', '不可发送', { contextToken: 'someone-else' }), false);
    assert.equal(ad.zhuangTai().cuoWu, 'send-context-mismatch');
    assert.equal(state.sends.length, count + 1);
    assert.equal(await ad.faSong('alice', '恢复'), true);
    assert.equal(ad.zhuangTai().cuoWu, '');
    assert.equal(state.sends.at(-1).body.msg.context_token, 'alice-context-2');
  });
  await gate.test('HTTP 200 ret!=0 or errcode!=0 never succeeds or retries; errors do not echo secrets', async () => {
    for (const body of [{ ret: 9 }, { ret: 0, errcode: 7 }, { ret: 8, errcode: 0 }]) {
      const count = state.sends.length;
      state.sendResults.push({ body: { ...body, errmsg: 'private-fixture-do-not-log' } });
      assert.equal(await ad.faSong('alice', '失败'), false);
      assert.equal(state.sends.length, count + 1);
      assert(!JSON.stringify(ad.zhuangTai()).includes('private-fixture'));
    }
  });
  await gate.test('HTTP failures and invalid success JSON cannot masquerade as success', async () => {
    for (const result of [{ status: 400, body: { ret: 0 } }, { status: 401, body: { ret: 0 } }, { raw: '<html>bad</html>' }, { body: null }]) {
      const count = state.sends.length;
      state.sendResults.push(result);
      assert.equal(await ad.faSong('alice', '失败'), false);
      assert.equal(state.sends.length, count + 1);
    }
    state.sendResults.push({ status: 503, body: { ret: 0 } }, { status: 503, body: { ret: 0 } });
    assert.equal(await ad.faSong('alice', '持续失败'), false);
  });
  await gate.test('recoverable HTTP/network failure retries once with identical client_id/body', async () => {
    for (const result of [{ status: 503, body: {} }, { disconnect: true }]) {
      const start = state.sends.length;
      state.sendResults.push(result);
      assert.equal(await ad.faSong('alice', '恢复性重试'), true);
      const sent = state.sends.slice(start);
      assert.equal(sent.length, 2);
      assert.deepEqual(sent[0].body, sent[1].body);
      assert(sent[0].body.msg.client_id.length > 10);
    }
  });
  await gate.test('failed getupdates neither delivers messages nor advances cursor', async () => {
    const cursor = state.gets.at(-1).body.get_updates_buf;
    // First success establishes the cursor that every following failed pull must retain.
    await ad.laQu();
    const expected = 'cursor-' + state.cursor;
    for (const result of [{ status: 500, body: { ret: 0 } }, { body: { ret: 6 } }, { body: { ret: 0, errcode: 5 } }]) {
      state.getResults.push({ ...result, body: { ...result.body, msgs: [message('blocked', 'bob', 'blocked')], get_updates_buf: 'must-not-advance' } });
      assert.equal((await ad.laQu()).length, 0);
      assert.equal(state.gets.at(-1).body.get_updates_buf, expected);
    }
    assert.equal(typeof cursor, 'string');
    // 第 65 轮契约：没收到合法 context_token 也按收件人发送（只是不带 token），不再拒绝。
    assert.equal(await ad.faSong('bob', '未收到合法 context'), true);
    assert.equal(state.sends.at(-1).body.msg.context_token, undefined);
  });
  await gate.test('uint64 message IDs retain precision and adjacent IDs do not collide', async () => {
    const ids = ['9007199254740992', '9007199254740993'];
    const msgs = ids.map((id) => JSON.stringify(message(id, 'large-id-user', 'large-context')).replace('"message_id":"' + id + '"', '"message_id":' + id));
    state.getResults.push({ raw: '{"ret":0,"msgs":[' + msgs.join(',') + ']}' });
    const received = await ad.laQu();
    assert.deepEqual(plain(received.map((m) => m.xiaoXiId)), ids);
  });
  await gate.test('bounded dedupe evicts oldest only, retaining recent IDs past capacity', async () => {
    for (let i = 0; i < 2005; i++) state.updates.push(message('window-' + i, 'window-user', 'window-context'));
    assert.equal((await ad.laQu()).length, 2005);
    state.updates.push(message('window-2004', 'window-user', 'window-context'));
    assert.equal((await ad.laQu()).length, 0);
  });
  await gate.test('session expiry from ret/errcode stops connection, remains redacted, reconnect works', async () => {
    state.sendResults.push({ body: { ret: -14, errmsg: 'private-fixture-do-not-log' } });
    assert.equal(await ad.faSong('alice', '过期'), false);
    assert.equal(ad.zaiXian(), false);
    assert.equal(ad.zhuangTai().cuoWu, 'hui-hua-guo-qi');
    state.getResults.push({ body: { ret: 0, errcode: -14 } });
    await assert.rejects(ad.lianJie());
    assert.equal(ad.zaiXian(), false);
    state.updates.push(message('fresh', 'alice', 'fresh-context'));
    await ad.lianJie();
    assert.equal(ad.zaiXian(), true);
    assert.equal(await ad.faSong('alice', '重新连接'), true);
  });
  await gate.test('save/read/adapter gets plaintext; all accounts/platforms encrypted once across repeated saves and lastUsed', async () => {
    const constructed = [];
    const m = memorySocial({ instances: [{ id: 'i' }, { id: 'j' }], sheJiao: [{ pingTai: 'telegram', qiYong: true, zheng: { pingTai: 'telegram', botToken: 'other-platform-secret' } }] }, {
      chuangJianSheJiao: (p, z) => {
        constructed.push(plain(z));
        const a = new AD.ILinkAdapter(z); a.xunHuan = async () => {}; return a;
      },
    });
    const account = (id, token) => ({ id, name: '', createdAt: 1, lastUsedAt: 0,
      zheng: { pingTai: 'ilink', botId: id, botToken: token, baseURL: mock.baseURL } });
    try {
      assert(m.cunSheJiaoZhangHao('i', 'ilink', [account('a', 'secret-a'), account('b', 'secret-b')]));
      assert(m.cunSheJiaoZhangHao('j', 'ilink', [account('c', 'secret-c')]));
      for (let i = 0; i < 3; i++) {
        assert.equal((await m.ipc('sheJiaoBaoCunPeiZhi', { instId: 'i', pingTai: 'ilink', zheng: { pingTai: 'ilink' } })).ok, true);
        const p = m.duSheJiaoPeiZhi('i').find((p) => p.pingTai === 'ilink');
        assert.deepEqual(plain(p.accounts.map((a) => a.zheng.botToken)), ['secret-a', 'secret-b']);
      }
      m.biaoJiSheJiaoZhangHaoShiYong('i', 'ilink', 'a');
      assert(m.duSheJiaoPeiZhi('i')[0].accounts[0].lastUsedAt > 0);
      for (const id of ['a', 'b']) assert.equal((await m.zhiXingSheJiaoLianJie({ instId: 'i', pingTai: 'ilink', accountId: id })).zaiXian, true);
      assert.deepEqual(constructed.map((z) => z.botToken), ['secret-a', 'secret-b']);
      assert(constructed.every((z) => z.baseURL === mock.baseURL));
      assert.equal(m.duSheJiaoPeiZhi('j')[0].accounts[0].zheng.botToken, 'secret-c');
      for (const write of m.writes) {
        const json = JSON.stringify(write);
        for (const secret of ['secret-a', 'secret-b', 'secret-c', 'other-platform-secret', mock.baseURL]) assert(!json.includes(secret));
        const configs = [...write.sheJiao, ...write.instances.flatMap((x) => Object.values(x.sheJiaoJieRu || {}))];
        for (const config of configs) for (const z of [config.zheng, ...(config.accounts || []).map((a) => a.zheng)].filter(Boolean)) {
          for (const [k, v] of Object.entries(z)) if (k !== 'pingTai' && v) {
            assert(v.startsWith('enc:v1:'));
            const decoded = m.protector.decryptString(Buffer.from(v.slice(7), 'base64'));
            assert(!decoded.startsWith('enc:'), 'exactly one encryption layer on disk');
          }
        }
      }
      assert.equal((await m.zhiXingSheJiaoLianJie({ instId: 'i', pingTai: 'ilink', accountId: 'not-an-account' })).ok, false);
      assert.equal(constructed.length, 2);
    } finally { m.close(); }
  });
  await gate.test('nested legacy ciphertext recovers with bounded unwrap; corrupt/deep/unavailable protection fails closed', async () => {
    const m = memorySocial({ instances: [{ id: 'i' }] });
    const enc = (s, n = 1) => { for (let i = 0; i < n; i++) s = m.encrypt(s); return s; };
    assert(m.cunSheJiaoZhangHao('i', 'ilink', [{ id: 'a', name: '', zheng: { pingTai: 'ilink', botToken: enc('restored-token', 4), baseURL: enc(mock.baseURL, 3) } }]));
    assert.equal(m.duSheJiaoPeiZhi('i')[0].accounts[0].zheng.botToken, 'restored-token');
    for (const bad of ['enc:v1:not-decryptable', enc('too-deep', 9), 'enc:v2:unknown']) {
      let constructions = 0;
      const broken = memorySocial({ instances: [{ id: 'i', sheJiaoJieRu: { ilink: { pingTai: 'ilink', accounts: [{ id: 'a', zheng: { pingTai: 'ilink', botToken: bad } }] } } }] }, {
        chuangJianSheJiao: () => { constructions++; throw new Error('must-not-run'); },
      });
      const r = await broken.zhiXingSheJiaoLianJie({ instId: 'i', pingTai: 'ilink' });
      assert.equal(r.ok, false); assert.equal(constructions, 0);
      assert.equal(broken.ipc('sheJiaoPeiZhiQu', { instId: 'i' }).ok, false);
      assert(!JSON.stringify([r, broken.events, broken.logs]).includes(bad));
      assert.equal(broken.cunSheJiaoPeiZhi(undefined, { pingTai: 'telegram', qiYong: true, zheng: { pingTai: 'telegram', botToken: 'new' } }), false);
      assert.equal(broken.writes.length, 0);
    }
    const before = m.read(); m.protector.available = false;
    assert.equal(m.cunSheJiaoPeiZhi('i', { pingTai: 'ilink', qiYong: true, zheng: { pingTai: 'ilink', botToken: 'plaintext-must-not-persist' } }), false);
    assert.deepEqual(m.read(), before);
    assert.throws(() => new AD.ILinkAdapter({ pingTai: 'ilink', botToken: 'enc:v1:blocked' }));
  });
  await gate.test('local remark validates length and account ownership; stale whole-state save preserves main-process credentials', async () => {
    const m = memorySocial({ instances: [{ id: 'i', persona: 'old' }] });
    const a = { id: 'wx-a', name: '', createdAt: 1, lastUsedAt: 2, zheng: { pingTai: 'ilink', botToken: 'private', botId: 'wx-a' } };
    assert(m.cunSheJiaoZhangHao('i', 'ilink', [a]));
    assert.equal(m.ipc('sheJiaoZhangHaoBeiZhu', { instId: 'i', pingTai: 'ilink', accountId: 'wx-a', name: ' 工作号 ', zheng: { botToken: 'injected' } }).ok, true);
    assert.equal(m.duSheJiaoPeiZhi('i')[0].accounts[0].name, '工作号');
    assert.equal(m.duSheJiaoPeiZhi('i')[0].accounts[0].zheng.botToken, 'private');
    for (const p of [{ name: 'x'.repeat(81) }, { name: '\n' }, { accountId: 'wrong' }, { instId: 'other' }, { name: 42 }]) {
      assert.equal(m.ipc('sheJiaoZhangHaoBeiZhu', { instId: 'i', pingTai: 'ilink', accountId: 'wx-a', name: 'valid', ...p }).ok, false);
    }
    const before = m.read().instances[0].sheJiaoJieRu;
    assert.equal(m.ipc('taiBaoCun', { sheJiao: [{ zheng: { botToken: 'injected-global' } }], instances: [
      { id: 'i', persona: 'new', sheJiaoJieRu: { ilink: { zheng: { botToken: 'stale-renderer' } } } },
      { id: 'new', sheJiaoJieRu: { ilink: { zheng: { botToken: 'injected' } } } },
    ] }).ok, true);
    assert.deepEqual(m.read().instances[0].sheJiaoJieRu, before);
    assert.equal(m.read().instances[0].persona, 'new');
    assert.equal(m.read().instances[1].sheJiaoJieRu, undefined);
    assert(!JSON.stringify(m.read()).includes('injected'));
    assert.equal(m.ipc('sheJiaoZhangHaoBeiZhu', { instId: 'i', pingTai: 'ilink', accountId: 'wx-a', name: '' }).ok, true);
    assert.equal(m.duSheJiaoPeiZhi('i')[0].accounts[0].name, '');
  });
  await gate.test('QR confirmed returns saved/connecting before connection settles, then broadcasts success or failure', async () => {
    for (const fails of [false, true]) {
      const connect = deferred();
      const m = memorySocial({ instances: [{ id: 'i' }] }, {
        fetch: async (_url, options) => { assert(options.signal); return new Response(JSON.stringify({ status: 'confirmed', bot_token: 'qr-secret', ilink_bot_id: 'wx-qr' })); },
        chuangJianSheJiao: (_p, z) => {
          assert.equal(z.botToken, 'qr-secret');
          return { shouXiaoXi() {}, async lianJie() { await connect.promise; if (fails) throw new Error('must-not-echo-qr-secret'); }, zaiXian: () => !fails, duanKai() {} };
        },
      });
      m.saoMaDai.set('qr', { instId: 'i', pingTai: 'ilink', base: 'https://offline.invalid', ts: Date.now() });
      const result = await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' });
      assert.equal(result.status, 'connecting'); assert.equal(result.qrStatus, 'confirmed'); assert.equal(result.saved, true);
      assert.equal(result.zaiXian, false); assert.equal(m.writes.length, 1);
      assert.equal(m.events.at(-1).data.status, 'connecting');
      assert.equal(m.saoMaDai.has('qr'), false);
      connect.resolve(); await flush();
      assert.equal(m.events.at(-1).data.status, fails ? 'failed' : 'connected');
      assert(!JSON.stringify([result, m.events, m.logs]).includes('qr-secret'));
      m.close();
    }
  });
  await gate.test('QR timeout stays pending/scanned; HTTP/business rejection/expiry/cancel terminate; duplicate polls serialize', async () => {
    const cases = [
      { status: 401, body: { errmsg: 'do-not-echo' } }, { body: { ret: -14, errmsg: 'do-not-echo' } },
      { body: { status: 'expired' } }, { body: { status: 'canceled' } }, { body: { status: 'cancelled' } },
    ];
    for (const c of cases) {
      const m = memorySocial({}, { fetch: async (_u, o) => { assert(o.signal); return new Response(JSON.stringify(c.body), { status: c.status || 200 }); } });
      m.saoMaDai.set('qr', { base: 'https://offline.invalid', ts: Date.now() });
      const r = await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' });
      assert(!m.saoMaDai.has('qr')); assert(!JSON.stringify(r).includes('do-not-echo'));
    }
    const wait = deferred(); let calls = 0;
    const m = memorySocial({}, { fetch: async () => { calls++; await wait.promise; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; } });
    m.saoMaDai.set('qr', { base: 'https://offline.invalid', ts: Date.now(), status: 'scaned' });
    const first = m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' });
    assert.equal((await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' })).status, 'scaned');
    assert.equal(calls, 1); wait.resolve();
    const r = await first; assert.equal(r.ok, true); assert.equal(r.pending, true); assert.equal(r.status, 'scaned'); assert(m.saoMaDai.has('qr'));
  });
  await gate.test('session queue preserves order and bounded backpressure without cross-session model blocking', async () => {
    const m = memorySocial(); const block = deferred(), seen = [];
    await m.sheJiaoRuDui('a', async () => { seen.push('a0'); await block.promise; });
    for (let i = 1; i < 64; i++) await m.sheJiaoRuDui('a', async () => { seen.push('a' + i); });
    let admitted = false;
    const overflow = m.sheJiaoRuDui('a', async () => { seen.push('a64'); }).then(() => { admitted = true; });
    await m.sheJiaoRuDui('b', async () => { seen.push('b'); }); await flush();
    assert.equal(admitted, false); assert(seen.includes('b')); assert.equal(m.pending(), 64);
    block.resolve(); await overflow; await m.drain();
    assert.deepEqual(seen.filter((x) => x.startsWith('a')), Array.from({ length: 65 }, (_, i) => 'a' + i));
    assert.equal(m.pending(), 0);
    const cap = deferred();
    for (let i = 0; i < 256; i++) await m.sheJiaoRuDui('s' + i, async () => cap.promise);
    let extra = false; const overflowGlobal = m.sheJiaoRuDui('last', async () => {}).then(() => { extra = true; });
    await flush(); assert.equal(m.pending(), 256); assert.equal(extra, false);
    cap.resolve(); await overflowGlobal; await m.drain(); assert.equal(m.pending(), 0);
  });
  await gate.test('actual main callback only enqueues; disconnect/reconnect prevents old pending dispatch and replies', async () => {
    const callbacks = [], sent = [], ran = [], block = deferred();
    const m = memorySocial({ instances: [{ id: 'i' }, { id: 'j' }] }, {
      chuangJianSheJiao: () => ({
        shouXiaoXi(cb) { callbacks.push(cb); }, async lianJie() {}, zaiXian: () => true, duanKai() {},
        async faSong(id, text) { sent.push([id, text]); return true; },
      }),
      zhenZhengFaSong: async (_e, p) => { ran.push(p); if (p.sessionId === 'i') await block.promise; return { ok: true, reply: 'fixture-reply' }; },
    });
    for (const instId of ['i', 'j']) {
      assert(m.cunSheJiaoZhangHao(instId, 'ilink', [{ id: 'a', name: '', zheng: { pingTai: 'ilink', botToken: 'fixture' } }]));
      assert((await m.zhiXingSheJiaoLianJie({ instId, pingTai: 'ilink', accountId: 'a' })).ok);
    }
    const msg = (id) => ({ pingTai: 'ilink', huiHuaId: id, wenBen: id, ts: 1, contextToken: 'not-for-renderer' });
    await callbacks[0](msg('first')); await callbacks[0](msg('second')); await callbacks[1](msg('other-session')); await flush();
    assert.deepEqual(ran.map((p) => p.sessionId), ['i', 'j']);
    assert.equal(sent.length, 1); assert.equal(sent[0][0], 'other-session');
    m.ipc('sheJiaoDuanKai', { instId: 'i', pingTai: 'ilink', accountId: 'a' });
    await m.zhiXingSheJiaoLianJie({ instId: 'i', pingTai: 'ilink', accountId: 'a' });
    block.resolve(); await m.drain();
    assert.equal(ran.length, 2); assert.equal(sent.length, 1);
    await callbacks[0](msg('late')); await m.drain(); assert.equal(ran.length, 2);
    assert(!JSON.stringify(m.events).includes('not-for-renderer'));
    assert.equal(m.events.filter((e) => e.name === 'warmy:sheJiaoXiaoXi').length, 2);
    m.close();
  });
  await gate.test('normal longpoll continues immediately; errors back off finitely; first timeout stays connecting', async () => {
    const source = fs.readFileSync(new URL('../../packages/app-shell/src/she-jiao-adapter.ts', import.meta.url), 'utf8');
    const timers = [], states = []; let mode = 'ok';
    const mod = execute(source, 'she-jiao-adapter.ts', {
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
      fetch: async () => {
        if (mode === 'timeout') { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
        if (mode === 'error') throw new TypeError('do-not-echo');
        return new Response(JSON.stringify({ ret: 0, longpolling_timeout_ms: 30000, msgs: [] }));
      },
    }).exports;
    const a = new mod.ILinkAdapter({ pingTai: 'ilink', botToken: 'fixture' });
    a.onZhuangTai((s) => states.push(s));
    await a.lianJie(); await flush(); assert.equal(timers.at(-1).ms, 0);
    mode = 'error'; await timers.at(-1).fn(); await flush(); assert.equal(timers.at(-1).ms, 500);
    for (let i = 0; i < 8; i++) { await timers.at(-1).fn(); await flush(); assert(timers.at(-1).ms <= 5000); }
    mode = 'ok'; await timers.at(-1).fn(); await flush(); assert.equal(timers.at(-1).ms, 0); assert.equal(states.at(-1).status, 'connected');
    a.duanKai(); mode = 'timeout'; await a.lianJie(); await flush(); assert.equal(a.zhuangTai().status, 'connecting'); assert.equal(a.zaiXian(), false);
    a.duanKai(); mode = 'error'; await assert.rejects(a.lianJie()); assert.equal(a.zhuangTai().cuoWu, 'wangluo:get-failed'); assert.equal(a.zaiXian(), false);
    a.duanKai();
  });
  await gate.test('real initial getupdates plus main queue returns connected while model reply is still pending', async () => {
    const block = deferred(); let ran = false; let timeout;
    const m = memorySocial({ instances: [{ id: 'i' }] }, {
      chuangJianSheJiao: (_p, z) => { const a = new AD.ILinkAdapter(z); a.xunHuan = async () => {}; return a; },
      zhenZhengFaSong: async () => { ran = true; await block.promise; return { ok: true, reply: '' }; },
    });
    try {
      assert(m.cunSheJiaoZhangHao('i', 'ilink', [{ id: 'a', name: '', zheng: { pingTai: 'ilink', botToken: 'fixture', baseURL: mock.baseURL } }]));
      state.updates.push(message('initial-model-block', 'initial-user', 'initial-context'));
      const r = await Promise.race([
        m.zhiXingSheJiaoLianJie({ instId: 'i', pingTai: 'ilink', accountId: 'a' }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('connection waited for model')), 2000); }),
      ]);
      assert.equal(r.zaiXian, true); assert.equal(ran, true); assert.equal(m.pending(), 1);
    } finally { clearTimeout(timeout); block.resolve(); await m.drain(); m.close(); }
  });
  await gate.test('late getupdates after explicit disconnect cannot deliver or resurrect online state', async () => {
    const response = deferred(); const received = [];
    const mod = execute(fs.readFileSync(new URL('../../packages/app-shell/src/she-jiao-adapter.ts', import.meta.url), 'utf8'), 'she-jiao-adapter.ts', {
      fetch: () => response.promise,
    }).exports;
    const a = new mod.ILinkAdapter({ pingTai: 'ilink', botToken: 'fixture' });
    a.shouXiaoXi((msg) => received.push(msg));
    const connecting = a.lianJie(); a.duanKai();
    response.resolve(new Response(JSON.stringify({ ret: 0, msgs: [message('late', 'user', 'ctx')] })));
    await connecting; await flush();
    assert.equal(received.length, 0); assert.equal(a.zaiXian(), false); assert.equal(a.zhuangTai().status, 'disconnected');
  });
  await gate.test('renderer QR polls immediately and serially, displays scan/save/connect separately, ignores late closed results', async () => {
    let pending = deferred(), calls = 0;
    const ui = rendererFixture({ sheJiaoSaoMaZhuangTai: () => { calls++; return pending.promise; } });
    await ui.render(); await ui.qr.onclick();
    const overlay = ui.overlays[0];
    assert.equal(calls, 1); assert.equal(ui.timers.length, 0);
    pending.resolve({ ok: true, status: 'scaned' }); await flush();
    assert.equal(overlay.status.textContent, '已扫码，请在手机上确认');
    assert.equal(ui.timers.length, 1); assert.equal(ui.timers[0].ms, 250);
    pending = deferred(); ui.timers.shift().fn(); assert.equal(calls, 2); assert.equal(ui.timers.length, 0);
    pending.resolve({ ok: true, status: 'connecting', qrStatus: 'confirmed', saved: true, accountId: 'a' }); await flush();
    assert.equal(overlay.status.textContent, '扫码已确认，凭据已加密保存，正在连接…');
    assert.equal(ui.timers.length, 0);
    ui.emit({ instId: 'other', pingTai: 'ilink', accountId: 'a', status: 'connected', zaiXian: true });
    assert(overlay.status.textContent.includes('正在连接'));
    ui.emit({ instId: 'i', pingTai: 'ilink', accountId: 'a', status: 'failed', zaiXian: false, error: 'wangluo:get-failed' });
    assert.equal(overlay.status.textContent, '连接失败：wangluo:get-failed');
    ui.emit({ instId: 'i', pingTai: 'ilink', accountId: 'a', status: 'connected', zaiXian: true });
    assert.equal(overlay.status.textContent, '已连接');
    overlay.closeButton.onclick(); await flush();
    assert.equal(ui.overlays.length, 0); assert.equal(ui.subscribers.size, 1);
    ui.he._sheJiaoCleanup(); assert.equal(ui.subscribers.size, 0);
    const late = deferred();
    const closed = rendererFixture({ sheJiaoSaoMaZhuangTai: () => late.promise });
    await closed.render(); await closed.qr.onclick();
    const old = closed.overlays[0]; old.closeButton.onclick();
    late.resolve({ ok: true, status: 'connecting', qrStatus: 'confirmed', saved: true, accountId: 'a' }); await flush();
    assert.equal(old.status.textContent, '等待扫码…'); assert.equal(closed.timers.length, 0); assert.equal(closed.overlays.length, 0);
    closed.he._sheJiaoCleanup();
  });
  await gate.test('renderer handles early connection broadcast and QR terminal rejection without further polling', async () => {
    const wait = deferred();
    const ui = rendererFixture({ sheJiaoSaoMaZhuangTai: () => wait.promise });
    await ui.render(); await ui.qr.onclick();
    ui.emit({ instId: 'i', pingTai: 'ilink', accountId: 'a', status: 'connected', zaiXian: true });
    wait.resolve({ ok: true, status: 'connecting', qrStatus: 'confirmed', saved: true, accountId: 'a' }); await flush();
    assert.equal(ui.overlays[0].status.textContent, '已连接');
    ui.overlays[0].closeButton.onclick(); await flush(); ui.he._sheJiaoCleanup();
    for (const result of [{ ok: false, status: 'error', error: 'http:403' }, { ok: true, status: 'expired' }, { ok: true, status: 'canceled' }]) {
      const failed = rendererFixture({ sheJiaoSaoMaZhuangTai: async () => result });
      await failed.render(); await failed.qr.onclick(); await flush();
      assert.equal(failed.timers.length, 0); assert.equal(failed.subscribers.size, 1);
      assert(!failed.overlays[0].status.textContent.includes('等待扫码'));
      failed.overlays[0].closeButton.onclick(); failed.he._sheJiaoCleanup();
    }
  });
  await gate.test('renderer includes instId for save and skips empty credentials on reconnect; remark displays name plus ID', async () => {
    const calls = [];
    const save = { getAttribute: () => 'telegram' }, conn = { getAttribute: () => 'telegram' };
    const ui = rendererFixture({
      sheJiaoBaoCunPeiZhi: async (p) => { calls.push(plain(p)); return { ok: true }; },
      sheJiaoLianJie: async () => ({ ok: true, status: 'connecting', zaiXian: false }),
      sheJiaoPeiZhiQu: async () => ({ items: [{ pingTai: 'ilink', accounts: [{ id: 'wx-a', name: '工作号' }, { id: 'wx-b', name: '' }] }] }),
    }, { '[data-sj-save]': [save], '[data-sj-conn]': [conn] });
    await ui.render();
    assert(ui.he.innerHTML.includes('工作号 · wx-a')); assert(ui.he.innerHTML.includes('<b>wx-b</b>'));
    assert(ui.he.innerHTML.includes('maxlength="80"'));
    await save.onclick(); await conn.onclick(); await flush();
    assert.deepEqual(calls, [{ instId: 'i', pingTai: 'telegram' }, { instId: 'i', pingTai: 'telegram' }]);
    assert.equal(ui.xi.textContent, '正在连接…');
    ui.he._sheJiaoCleanup();
  });
  await gate.test('QR redirects only to official hosts and preserves scan state', async () => {
    for (const host of ['ilinkai.weixin.qq.com', 'example.invalid', 'ilinkai.weixin.qq.com.evil.invalid', 'evil@ilinkai.weixin.qq.com', 'ilinkai.weixin.qq.com/path']) {
      const m = memorySocial({}, { URL, fetch: async () => new Response(JSON.stringify({ status: 'scaned_but_redirect', redirect_host: host })) });
      m.saoMaDai.set('qr', { base: 'https://offline.invalid', ts: Date.now() });
      const result = await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' });
      if (host === 'ilinkai.weixin.qq.com') { assert.equal(result.status, 'scaned'); assert.equal(m.saoMaDai.get('qr').base, 'https://' + host); }
      else { assert.equal(result.ok, false); assert.equal(m.saoMaDai.has('qr'), false); }
    }
  });
  await gate.test('QR verification code is passed only to the state endpoint and never persisted or logged', async () => {
    const urls = [];
    const m = memorySocial({}, { fetch: async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ status: urls.length === 1 ? 'need_verifycode' : 'scaned' })); } });
    m.saoMaDai.set('qr', { base: 'https://offline.invalid', ts: Date.now() });
    assert.equal((await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr' })).status, 'need_verifycode');
    assert.equal(m.saoMaDai.has('qr'), true);
    const code = 'fixture-code';
    assert.equal((await m.ipc('sheJiaoSaoMaZhuangTai', { qrcode: 'qr', verifyCode: code })).status, 'scaned');
    assert.ok(urls[1].includes('verify_code=' + code));
    assert.ok(!JSON.stringify([m.logs, m.events, [...m.saoMaDai.values()]]).includes(code));
  });
  await gate.test('renderer pauses QR polling for verification code and resumes only after explicit submission', async () => {
    const requests = [];
    const ui = rendererFixture({ sheJiaoSaoMaZhuangTai: async (payload) => { requests.push(payload); return requests.length === 1 ? { ok: true, status: 'need_verifycode' } : { ok: true, status: 'scaned' }; } });
    await ui.render(); await ui.qr.onclick(); await flush();
    const overlay = ui.overlays[0];
    assert.equal(overlay.codeBox.hidden, false); assert.equal(ui.timers.length, 0);
    overlay.codeInput.value = '123456'; overlay.codeSubmit.onclick(); await flush();
    assert.equal(requests.length, 2); assert.equal(requests[1].verifyCode, '123456');
    assert.equal(overlay.codeBox.hidden, true); assert.equal(ui.timers.length, 1);
    overlay.closeButton.onclick(); ui.he._sheJiaoCleanup();
  });
  gate.done();
} finally {
  ad.duanKai();
  await mock.close();
}
