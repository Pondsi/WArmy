/**
 * verify-r82-shejiao-tong —— #113 / #115：社交接入向导纯模块门禁
 *
 * 覆盖：
 *  - 四平台配置校验（必填、agentId 数字、botToken 冒号格式）
 *  - secret/token 脱敏（错误文案 + 诊断结果 + 展示端点）
 *  - 端点推导（飞书 / 钉钉 / 企微 / Telegram，默认域名与自定义 baseUrl）
 *  - 回环 HTTP：200 连通、401/403 凭据被拒、慢响应超时、DNS 失败、5xx
 *  - 注入 fetchImpl / dnsLookup / now / skipDns
 *
 * 不访问外网；只起 127.0.0.1 回环 server。Node 24 直接跑：
 *   node dev/gates/verify-r82-shejiao-tong.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { jianChaPeiZhi, duanDian, anQuanDuanDian, ceShiLianTong, yanMo } = await import(
  pathToFileURL(path.join(ROOT, 'packages/app-shell/src/she-jiao-lian-tong.ts')).href
);

const MI = {
  feishu: 'FS_SECRET_r82_9f8e7d6c',
  dingtalk: 'DT_SECRET_r82_1a2b3c4d',
  wecom: 'WC_SECRET_r82_5e6f7a8b',
  telegram: '123456789:R82_TELEGRAM_TOKEN_abcdefghij',
};
const SECRETS = Object.values(MI);
const PING_TAI = ['feishu', 'dingtalk', 'wecom', 'telegram'];

let port = 0;
const base = (seg) => `http://127.0.0.1:${port}/${seg}`;

function peiZhi(platform, seg) {
  switch (platform) {
    case 'feishu':
      return { appId: 'cli_r82test', appSecret: MI.feishu, baseUrl: base(seg) };
    case 'dingtalk':
      return { clientId: 'ding_r82test', clientSecret: MI.dingtalk, baseUrl: base(seg) };
    case 'wecom':
      return {
        corpId: 'ww_r82test',
        corpSecret: MI.wecom,
        agentId: 1000002,
        baseUrl: base(seg),
      };
    case 'telegram':
      return { botToken: MI.telegram, baseUrl: base(seg) };
    default:
      throw new Error('未知平台');
  }
}

const requests = [];
const server = http.createServer((req, res) => {
  void (async () => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const seg = u.pathname.split('/')[1] || '';
      requests.push({
        method: req.method,
        path: u.pathname,
        search: u.searchParams,
        body,
      });

      // 慢响应：不写 headers，等客户端超时/断开。
      if (seg === 'slow') return;

      const status =
        { ok: 200, deny401: 401, deny403: 403, boom: 500, missing: 404, rate: 429, bad: 400 }[
          seg
        ] ?? 200;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: status === 200, status }));
    } catch {
      try {
        res.destroy();
      } catch {
        /* noop */
      }
    }
  })();
});
server.on('clientError', (_e, socket) => {
  try {
    socket.destroy();
  } catch {
    /* noop */
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
port = server.address().port;

function clean(value) {
  let s = typeof value === 'string' ? value : String(value?.stack || value?.message || value);
  for (const x of SECRETS) s = s.split(x).join('••••');
  s = s.replace(/\/bot[^/?#\s]*/g, '/bot••••');
  s = s.replace(/([?&]corpsecret=)[^&#\s]*/gi, '$1••••');
  return s;
}

function assertNoSecrets(value, label) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const x of SECRETS) {
    if (s.includes(x)) throw new Error(label + ' 泄漏了密钥全文');
  }
  if (/\/bot\d+:[A-Za-z0-9_-]+/.test(s)) throw new Error(label + ' 泄漏了 bot token 路径');
  const m = s.match(/corpsecret=([^&"\s]*)/i);
  if (m && m[1] && !/^•+$/.test(m[1])) throw new Error(label + ' 泄漏了 corpsecret');
}

function same(a, b, message) {
  if (a !== b) throw new Error(message);
}

let ok = 0;
const failNames = [];

async function t(name, fn) {
  try {
    await fn();
    ok += 1;
    console.log('  ok   ' + name);
  } catch (e) {
    failNames.push(name);
    console.log('  FAIL ' + name + ' ← ' + clean(e?.stack || e?.message || e).slice(0, 600));
  }
}

try {
  await t('A 四平台合法配置全部通过', async () => {
    for (const p of PING_TAI) {
      const r = jianChaPeiZhi(p, peiZhi(p, 'ok'));
      assert.equal(r.ok, true, p + ' 配置应通过');
      assert.deepEqual(r.errors, []);
    }
  });

  await t('B 四平台必填/格式错误被拒', async () => {
    const fs = jianChaPeiZhi('feishu', { appId: '', appSecret: MI.feishu });
    assert.equal(fs.ok, false);
    assert.ok(fs.errors.some((e) => e.includes('appId')));

    const dt = jianChaPeiZhi('dingtalk', { clientId: 'ding_r82' });
    assert.equal(dt.ok, false);
    assert.ok(dt.errors.some((e) => e.includes('clientSecret')));

    const wc = jianChaPeiZhi('wecom', { corpId: 'ww_r82', corpSecret: MI.wecom, agentId: '12a' });
    assert.equal(wc.ok, false);
    assert.ok(wc.errors.some((e) => e.includes('agentId')));
    assert.equal(
      jianChaPeiZhi('wecom', { corpId: 'ww_r82', corpSecret: MI.wecom, agentId: 0 }).ok,
      false,
    );
    assert.equal(
      jianChaPeiZhi('wecom', { corpId: 'ww_r82', corpSecret: MI.wecom, agentId: 1000002 }).ok,
      true,
    );

    const tg = jianChaPeiZhi('telegram', { botToken: '123456789R82TOKEN' });
    assert.equal(tg.ok, false);
    assert.ok(tg.errors.some((e) => e.includes('botToken')));
    assert.equal(jianChaPeiZhi('telegram', { botToken: '123456789:abcDEF_-123' }).ok, true);
  });

  await t('C secret/token 错误文案只显示掩码', async () => {
    assert.equal(yanMo('ABCDEF'), 'AB••••EF');
    assert.equal(yanMo('abc'), '••••');

    const bad = {
      feishu: { appId: 'cli_r82', appSecret: ' ' + MI.feishu },
      dingtalk: { clientId: 'ding_r82', clientSecret: ' ' + MI.dingtalk },
      wecom: { corpId: 'ww_r82', corpSecret: ' ' + MI.wecom, agentId: 1000002 },
      telegram: { botToken: ' ' + MI.telegram },
    };
    for (const p of PING_TAI) {
      const r = jianChaPeiZhi(p, bad[p]);
      assert.equal(r.ok, false, p + ' 应被拒');
      const text = r.errors.join('；');
      assert.ok(text.includes('••••'), p + ' 应显示掩码');
      assert.equal(text.includes(MI[p]), false, p + ' 错误文案泄漏密钥');
      assertNoSecrets(r, p + ' 配置错误');
    }
  });

  await t('D 端点推导：四平台默认域名与路径正确', async () => {
    same(
      duanDian('feishu', { appId: 'cli_x', appSecret: 'x' }),
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      '飞书端点错误',
    );
    same(
      duanDian('dingtalk', { clientId: 'ding_x', clientSecret: 'x' }),
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      '钉钉端点错误',
    );

    const uw = new URL(duanDian('wecom', { corpId: 'ww_x', corpSecret: 'wc_x', agentId: 1 }));
    same(uw.origin, 'https://qyapi.weixin.qq.com', '企微 origin 错误');
    same(uw.pathname, '/cgi-bin/gettoken', '企微路径错误');
    same(uw.searchParams.get('corpid'), 'ww_x', '企微 corpId 错误');
    same(uw.searchParams.get('corpsecret'), 'wc_x', '企微 corpSecret 错误');

    same(
      duanDian('telegram', { botToken: MI.telegram }),
      `https://api.telegram.org/bot${MI.telegram}/getMe`,
      'Telegram 端点错误',
    );

    const fs2 = duanDian('feishu', {
      appId: 'cli_x',
      appSecret: 'x',
      baseUrl: base('ok') + '/',
    });
    same(
      fs2,
      `${base('ok')}/open-apis/auth/v3/tenant_access_token/internal`,
      'baseUrl 尾斜杠未归一',
    );
  });

  await t('E 展示用端点不含 token/corpsecret', async () => {
    const tg = anQuanDuanDian(duanDian('telegram', peiZhi('telegram', 'ok')));
    assert.equal(tg.includes(MI.telegram), false);
    assert.match(tg, /\/bot••••\/getMe$/);

    const wc = anQuanDuanDian(duanDian('wecom', peiZhi('wecom', 'ok')));
    assert.equal(wc.includes(MI.wecom), false);
    assert.match(wc, /corpsecret=••••/);
  });

  await t('F 回环 200：四平台 config→dns→http 全通过', async () => {
    for (const p of PING_TAI) {
      const r = await ceShiLianTong(p, peiZhi(p, 'ok'), { timeoutMs: 1500 });
      assert.equal(r.ok, true, p + ' 应连通');
      assert.deepEqual(r.steps.map((s) => s.name), ['config', 'dns', 'http'], p + ' 步骤顺序');
      assert.ok(r.steps.every((s) => Number.isFinite(s.ms) && s.ms >= 0), p + ' ms 非法');
      assert.ok(
        r.steps.every((s) => typeof s.detail === 'string' && s.detail.length > 0),
        p + ' detail 为空',
      );
      const h = r.steps[2];
      assert.equal(h.ok, true);
      assert.match(h.detail, /HTTP 200/);
      assert.ok(r.hint.length > 0);
      assertNoSecrets(r, p + ' 诊断结果');
    }
  });

  await t('G 回环请求形状：方法/JSON 体/查询/token 路径正确', async () => {
    requests.length = 0;
    for (const p of PING_TAI) {
      await ceShiLianTong(p, peiZhi(p, 'ok'), { timeoutMs: 1500 });
    }
    same(requests.length, 4, '应有 4 次探测请求');

    const [fs, dt, wc, tg] = requests;
    same(fs.method, 'POST', '飞书应 POST');
    same(fs.path, '/ok/open-apis/auth/v3/tenant_access_token/internal', '飞书路径错误');
    const fsb = JSON.parse(fs.body);
    assert.deepEqual(Object.keys(fsb).sort(), ['app_id', 'app_secret']);
    same(fsb.app_id, 'cli_r82test', '飞书 app_id 错误');
    same(fsb.app_secret, MI.feishu, '飞书 app_secret 错误');

    same(dt.method, 'POST', '钉钉应 POST');
    same(dt.path, '/ok/v1.0/oauth2/accessToken', '钉钉路径错误');
    const dtb = JSON.parse(dt.body);
    assert.deepEqual(Object.keys(dtb).sort(), ['appKey', 'appSecret']);
    same(dtb.appKey, 'ding_r82test', '钉钉 appKey 错误');
    same(dtb.appSecret, MI.dingtalk, '钉钉 appSecret 错误');

    same(wc.method, 'GET', '企微应 GET');
    same(wc.path, '/ok/cgi-bin/gettoken', '企微路径错误');
    same(wc.search.get('corpid'), 'ww_r82test', '企微 corpid 错误');
    same(wc.search.get('corpsecret'), MI.wecom, '企微 corpsecret 错误');

    same(tg.method, 'GET', 'Telegram 应 GET');
    same(tg.path, `/ok/bot${MI.telegram}/getMe`, 'Telegram token 路径错误');
  });

  await t('H 回环 401：四平台均归为凭据被拒', async () => {
    for (const p of PING_TAI) {
      const r = await ceShiLianTong(p, peiZhi(p, 'deny401'), { timeoutMs: 1500 });
      assert.equal(r.ok, false, p + ' 不应通过');
      const h = r.steps.find((s) => s.name === 'http');
      assert.ok(h, p + ' 应有 http 步骤');
      assert.equal(h.ok, false);
      assert.match(h.detail, /凭据被拒/);
      assert.equal(h.detail.includes('网络不通'), false);
      assert.ok(r.hint.includes('密钥'));
      assertNoSecrets(r, p + ' 401 诊断');
    }
  });

  await t('I 回环 403：同样归为凭据被拒', async () => {
    const r = await ceShiLianTong('feishu', peiZhi('feishu', 'deny403'), { timeoutMs: 1500 });
    const h = r.steps.find((s) => s.name === 'http');
    assert.match(h.detail, /凭据被拒/);
    assert.match(h.detail, /403/);
  });

  await t('J 注入 120ms 超时：快速返回且归类为超时', async () => {
    const t0 = Date.now();
    const r = await ceShiLianTong('telegram', peiZhi('telegram', 'slow'), { timeoutMs: 120 });
    const dt = Date.now() - t0;
    assert.ok(dt < 1500, '超时返回过慢：' + dt + 'ms');
    assert.equal(r.ok, false);
    const h = r.steps.find((s) => s.name === 'http');
    assert.ok(h);
    assert.match(h.detail, /请求超时/);
    assert.match(h.detail, /120ms/);
    assert.equal(h.detail.includes('域名解析'), false);
    assert.ok(r.hint.includes('网络'));
    assertNoSecrets(r, '超时诊断');
  });

  await t('K DNS 失败：与 HTTP 超时分开，不进入 http 步骤', async () => {
    const e = new Error('getaddrinfo ENOTFOUND api.telegram.org');
    e.code = 'ENOTFOUND';
    const r = await ceShiLianTong(
      'telegram',
      { botToken: MI.telegram },
      {
        timeoutMs: 120,
        dnsLookup: async () => {
          throw e;
        },
      },
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.steps.map((s) => s.name), ['config', 'dns']);
    const d = r.steps[1];
    assert.equal(d.ok, false);
    assert.match(d.detail, /域名解析失败/);
    assert.match(d.detail, /ENOTFOUND/);
    assert.equal(d.detail.includes('超时'), false);
    assert.ok(r.hint.includes('DNS'));
    assertNoSecrets(r, 'DNS 诊断');
  });

  await t('L HTTP 层 ENOTFOUND 仍归类为域名解析失败', async () => {
    const e = new Error('fetch failed');
    e.code = 'ENOTFOUND';
    const r = await ceShiLianTong('feishu', peiZhi('feishu', 'ok'), {
      timeoutMs: 1500,
      skipDns: true,
      fetchImpl: async () => {
        throw e;
      },
    });
    const h = r.steps.find((s) => s.name === 'http');
    assert.equal(h.ok, false);
    assert.match(h.detail, /域名解析失败/);
    assert.match(h.detail, /ENOTFOUND/);
    assert.equal(h.detail.includes('凭据被拒'), false);
  });

  await t('M DNS 可注入、可跳过', async () => {
    let ci = 0;
    let host = '';
    const r1 = await ceShiLianTong('feishu', peiZhi('feishu', 'ok'), {
      timeoutMs: 1500,
      dnsLookup: async (h) => {
        ci += 1;
        host = h;
        return ['127.0.0.1'];
      },
    });
    same(ci, 1, '注入 DNS 应调用一次');
    same(host, '127.0.0.1', 'DNS 查询主机错误');
    assert.equal(r1.ok, true);

    let called = false;
    const r2 = await ceShiLianTong('feishu', peiZhi('feishu', 'ok'), {
      timeoutMs: 1500,
      skipDns: true,
      dnsLookup: async () => {
        called = true;
        return ['127.0.0.1'];
      },
    });
    assert.equal(called, false, 'skipDns 不应调用 DNS');
    assert.equal(r2.ok, true);
    assert.match(r2.steps[1].detail, /跳过/);
  });

  await t('N 注入 now：计时取注入时钟', async () => {
    let clock = 0;
    const r = await ceShiLianTong('feishu', peiZhi('feishu', 'ok'), {
      timeoutMs: 1500,
      skipDns: true,
      now: () => (clock += 7),
    });
    assert.equal(r.ok, true);
    assert.ok(r.steps.every((s) => Number.isInteger(s.ms) && s.ms >= 0));
    assert.ok(r.steps[0].ms >= 7, 'config 计时未使用注入时钟');
  });

  await t('O 回环 500：归类为平台服务端错误', async () => {
    const r = await ceShiLianTong('dingtalk', peiZhi('dingtalk', 'boom'), { timeoutMs: 1500 });
    const h = r.steps.find((s) => s.name === 'http');
    assert.match(h.detail, /平台服务端错误/);
    assert.ok(r.hint.includes('平台'));
  });

  await t('P baseUrl 安全校验：拒绝非 https 外网/带 userinfo/查询串', async () => {
    assert.equal(
      jianChaPeiZhi('feishu', { appId: 'cli_x', appSecret: MI.feishu, baseUrl: 'http://example.com' }).ok,
      false,
    );
    assert.equal(
      jianChaPeiZhi('feishu', { appId: 'cli_x', appSecret: MI.feishu, baseUrl: 'ftp://example.com' }).ok,
      false,
    );
    assert.equal(
      jianChaPeiZhi('feishu', {
        appId: 'cli_x',
        appSecret: MI.feishu,
        baseUrl: 'https://u:p@example.com',
      }).ok,
      false,
    );
    assert.equal(
      jianChaPeiZhi('feishu', {
        appId: 'cli_x',
        appSecret: MI.feishu,
        baseUrl: 'https://example.com?x=1',
      }).ok,
      false,
    );
    assert.equal(
      jianChaPeiZhi('feishu', {
        appId: 'cli_x',
        appSecret: MI.feishu,
        baseUrl: 'http://127.0.0.1:1',
      }).ok,
      true,
    );
  });
} finally {
  await new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
    const timer = setTimeout(resolve, 300);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

console.log(`\nverify-r82-shejiao-tong: ${ok} ok / ${failNames.length} FAIL`);
process.exit(failNames.length ? 1 : 0);
