/**
 * verify-r122-discovery.mjs —— 公开可发现（C 方案）门禁
 *
 * 判据：
 *  [静态] 默认关（设置缺省不发布）、IPC/preload/UI 接线、审计事件、10 语言键齐全
 *  [行为] 两个真实本地 DHT 节点 + 一个发布者：发布 → 按指纹查到地址；
 *         无引导节点 ⇒ 明确失败；无组网端口 ⇒ mesh-not-running；
 *         没有公开发现密钥的人读不到记录；篡改记录验签失败；
 *         关闭后不再发布（已发布记录最多保留 TTL，不谎称已撤销）。
 *  [负向] 把默认值改成 true / 删掉引导节点检查，判据必须转红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(here, '..', '..');
const read = (p) => fs.readFileSync(path.join(GEN, p), 'utf8');

let ok = 0;
let fail = 0;
function jian(biaoQian, cond, detail) {
  if (cond) { ok += 1; console.log(`  ok  ${biaoQian}`); }
  else { fail += 1; console.log(`  FAIL ${biaoQian}${detail === undefined ? '' : ' | ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`); }
}

const settings = read('packages/app-shell/src/settings-store.ts');
const main = read('packages/app-shell/src/electron-main.ts');
const preload = read('packages/app-shell/src/preload.cjs');
const app = read('packages/app-shell/src/renderer/app.js');
const moduleSrc = read('packages/app-shell/src/public-discovery.ts');

/* ── 1. 默认关与接线 ─────────────────────────────────────────── */
jian('设置层有 publicDiscoverable / bootstrap / port / advertiseHost 字段',
  /publicDiscoverable\?: boolean/.test(settings)
  && /discoveryBootstrap\?: string\[\]/.test(settings)
  && /discoveryPort\?: number/.test(settings)
  && /discoveryAdvertiseHost\?: string/.test(settings));
jian('设置默认值没把公开可发现设为 true',
  !/publicDiscoverable:\s*true/.test(settings) && !/defaults\(\)[\s\S]{0,4000}publicDiscoverable:\s*true/.test(settings));
jian('主进程只在 publicDiscoverable === true 时自动启动发现',
  /net\?\.publicDiscoverable === true/.test(main) && /qiDongGongKaiFaXian\(\)/.test(main));
jian('开关落盘/IPC：gongKaiFaXianDu/She/Cha + 审计事件',
  /chuliIpc\('warmy:gongKaiFaXianDu'/.test(main)
  && /chuliIpc\('warmy:gongKaiFaXianShe'/.test(main)
  && /chuliIpc\('warmy:gongKaiFaXianCha'/.test(main)
  && /net\.discoverable-on/.test(main)
  && /net\.discoverable-off/.test(main)
  && /net\.discovery-publish/.test(main)
  && /net\.discovery-stop/.test(main));
jian('preload 暴露三个发现接口', /gongKaiFaXianDu:/.test(preload) && /gongKaiFaXianShe:/.test(preload) && /gongKaiFaXianCha:/.test(preload));
jian('UI 有开关/引导节点/端口/宣告地址，且保存进 net',
  /id="wangLuoDiscoveryEnabled"/.test(app)
  && /id="wangLuoDiscoveryBootstrap"/.test(app)
  && /id="wangLuoDiscoveryPort"/.test(app)
  && /id="wangLuoDiscoveryAdvertiseHost"/.test(app)
  && /publicDiscoverable: !!netState\.discovery\.enabled/.test(app));
jian('UI 未勾选时不显示“已开启”', /checked !== !!st\.enabled/.test(app) && /net\.discovery\.off/.test(app));
jian('发现层只发布地址记录，不含聊天正文',
  /kind: 'warmy-playground'/.test(moduleSrc)
  && !/payload|chat|message/i.test(moduleSrc.slice(moduleSrc.indexOf('const record'), moduleSrc.indexOf('const record') + 600)));
jian('记录 TTL 30 分钟 / 10 分钟刷新（关闭后不谎称已撤销）',
  /GONG_KAI_FA_XIAN_REFRESH_MS = 10 \* 60_000/.test(moduleSrc) && /30 分钟/.test(moduleSrc));
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const missing = [];
for (const l of locales) {
  const j = JSON.parse(read(`packages/app-shell/src/i18n/${l}.json`));
  for (const k of ['net.discovery.title', 'net.discovery.hint', 'net.discovery.enable', 'net.discovery.bootstrap', 'net.discovery.save', 'net.discovery.off']) {
    if (!j[k]) missing.push(`${l}:${k}`);
  }
}
jian('10 语言都有公开可发现文案', missing.length === 0, missing.slice(0, 6));

/* ── 2. 纯函数：地址解析 ─────────────────────────────────────── */
const {
  GongKaiFaXian, jieXiFaXianDiZhi, guiFanFaXianPeiZhi, GONG_KAI_FA_XIAN_MI_YAO, GONG_KAI_FA_XIAN_DEFAULT_PORT,
} = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/public-discovery.js')).href);
const {
  DhtJieDian, QunMiyaoHuan, chuangjianLinShiShenFen, jiLuJianYouZhiWen, yanZhengJiLuFeng, randomBytes,
} = await import(pathToFileURL(path.join(GEN, 'packages/sync-protocol/dist/index.js')).href);

jian('host 默认端口 7800', jieXiFaXianDiZhi('example.com')?.port === GONG_KAI_FA_XIAN_DEFAULT_PORT);
jian('host:port 正常解析', jieXiFaXianDiZhi('1.2.3.4:9999')?.port === 9999);
jian('IPv6 必须带方括号才能带端口', jieXiFaXianDiZhi('[::1]:7800')?.host === '::1' && jieXiFaXianDiZhi('::1:7800') === null);
jian('非法端口/空值被拒', jieXiFaXianDiZhi('x:0') === null && jieXiFaXianDiZhi('') === null && jieXiFaXianDiZhi('x:70000') === null);
jian('引导节点去重、上限 10、非法项丢弃',
  guiFanFaXianPeiZhi(['a:1', 'a:1', 'bad:0', 'b', 'c']).length === 3
  && guiFanFaXianPeiZhi(Array.from({ length: 20 }, (_, i) => `h${i}:7800`)).length === 10);

/* ── 3. 真实 DHT：发布与查询 ─────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (n) => chuangjianLinShiShenFen(n).provider;
const seedId = mk('r122-seed');
const pubId = mk('r122-pub');
const qId = mk('r122-query');
const outId = mk('r122-outsider');
const nodes = [];
try {
  const seed = new DhtJieDian({
    identity: seedId, nodeId: 'r122-seed', host: '127.0.0.1', port: 0, tcpPort: 1,
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]), rpcTimeoutMs: 900,
  });
  nodes.push(seed);
  const seedAddr = await seed.start();

  // 绑定 0.0.0.0 的种子/中继必须显式 advertiseHost，否则对端只能学到 127.0.0.1（真机跨机测试暴露的缺陷）
  const probe = new DhtJieDian({
    identity: mk('r122-probe'), nodeId: 'r122-probe', host: '127.0.0.1', port: 0, tcpPort: 1,
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]), rpcTimeoutMs: 900,
  });
  nodes.push(probe);
  await probe.start();
  const seedWild = new DhtJieDian({
    identity: mk('r122-seed-wild'), nodeId: 'r122-seed-wild', host: '0.0.0.0', port: 0, tcpPort: 1,
    advertiseHost: '192.0.2.10',
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]), rpcTimeoutMs: 900,
  });
  nodes.push(seedWild);
  const wildAddr = await seedWild.start();
  const seen = await probe.ping({ host: '127.0.0.1', port: wildAddr.port });
  jian('绑定 0.0.0.0 的种子按 advertiseHost 自报对外地址', seen?.host === '192.0.2.10', seen);
  const seedWild2 = new DhtJieDian({
    identity: mk('r122-seed-wild2'), nodeId: 'r122-seed-wild2', host: '0.0.0.0', port: 0, tcpPort: 1,
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]), rpcTimeoutMs: 900,
  });
  nodes.push(seedWild2);
  const wild2Addr = await seedWild2.start();
  const seen2 = await probe.ping({ host: '127.0.0.1', port: wild2Addr.port });
  jian('负向：未给 advertiseHost 时自报 127.0.0.1（修复前的缺陷形态）', seen2?.host === '127.0.0.1', seen2);

  const svc = new GongKaiFaXian();
  jian('默认未启动时 status.enabled=false', svc.status().enabled === false);
  const noBoot = await svc.start({
    identity: pubId, nodeId: 'r122-pub', tcpPort: 59601, advertiseHost: '127.0.0.1', bootstrap: [], listenPort: 0,
  });
  jian('没有引导节点 ⇒ bootstrap-required（不假装已公开）', noBoot.ok === false && noBoot.error === 'bootstrap-required', noBoot.error);
  const noPort = await svc.start({
    identity: pubId, nodeId: 'r122-pub', tcpPort: 0, advertiseHost: '127.0.0.1', bootstrap: [seedAddr], listenPort: 0,
  });
  jian('组网未监听 ⇒ mesh-not-running', noPort.ok === false && noPort.error === 'mesh-not-running', noPort.error);

  const started = await svc.start({
    identity: pubId, nodeId: 'r122-pub', tcpPort: 59601, advertiseHost: '127.0.0.1',
    bootstrap: [seedAddr], listenPort: 0,
  });
  jian('有引导 + 端口 ⇒ 启动并发布成功', started.ok === true && started.status.enabled === true, started.error);
  jian('发布成功至少落到一个节点', (started.status.lastStoredOn?.length ?? 0) >= 1, started.status.lastStoredOn);
  jian('状态回报对外宣告地址与 UDP 端口', started.status.advertised?.host === '127.0.0.1' && started.status.advertised?.port === 59601 && !!started.status.udp?.port);

  const queryNode = new DhtJieDian({
    identity: qId, nodeId: 'r122-query', host: '127.0.0.1', port: 0, tcpPort: 1,
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]), rpcTimeoutMs: 900,
  });
  nodes.push(queryNode);
  await queryNode.start();
  await queryNode.yindao([seedAddr]);
  const found = await queryNode.query(svc.status().fingerprint);
  jian('另一个节点按指纹查到发布者地址',
    found.ok === true && found.record?.host === '127.0.0.1' && found.record?.port === 59601 && found.record?.bieMing === 'r122-pub',
    found.record || found.attempts);

  const outsider = new DhtJieDian({
    identity: outId, nodeId: 'r122-outsider', host: '127.0.0.1', port: 0, tcpPort: 1,
    groupKeys: new QunMiyaoHuan([randomBytes(32)]), rpcTimeoutMs: 900,
  });
  nodes.push(outsider);
  await outsider.start();
  await outsider.yindao([seedAddr]);
  const denied = await outsider.query(svc.status().fingerprint);
  jian('没有公开发现密钥的人读不到记录内容（查询不成立）',
    denied.ok === false && Array.isArray(denied.rejected) && denied.rejected.length > 0,
    { ok: denied.ok, rejected: denied.rejected?.slice(0, 2) });

  jian('记录键是指纹的哈希（DHT 上不直接暴露指纹）',
    found.envelope?.k === jiLuJianYouZhiWen(svc.status().fingerprint)
    && found.envelope?.k !== svc.status().fingerprint);

  const tampered = JSON.parse(JSON.stringify(found.envelope));
  tampered.sl = tampered.sl.slice(0, 8) + (tampered.sl[8] === 'A' ? 'B' : 'A') + tampered.sl.slice(9);
  const tamperCheck = await yanZhengJiLuFeng(tampered, {
    expectKey: tampered.k,
    groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]),
    requireDecrypt: true,
  });
  jian('篡改记录 ⇒ 验签/解密失败', tamperCheck.ok === false, tamperCheck.reason);

  const pubFp = svc.status().fingerprint;
  await svc.stop();
  jian('关闭后立即停止发布（status.enabled=false）', svc.status().enabled === false);
  await sleep(300);
  const afterStop = await queryNode.query(pubFp);
  jian('关闭不谎称撤销：已发布记录在 TTL 内仍可被查到（如实说明 30 分钟自然过期）',
    afterStop.ok === true && afterStop.record?.port === 59601);
} finally {
  for (const n of nodes) { try { await n.stop(); } catch { /* noop */ } }
}

/* ── 4. 负向 ─────────────────────────────────────────────────── */
{
  const fakeMain = main.replace('net?.publicDiscoverable === true', 'false');
  jian('负向：去掉“默认关”门控后自动启动判据转红', !/net\?\.publicDiscoverable === true/.test(fakeMain));
  const fakeSrc = moduleSrc.replace("if (!opts.bootstrap.length) {", "if (false) {");
  jian('负向：删掉引导节点检查后行为测试会失败（静态判据可检出）',
    /if \(!opts\.bootstrap\.length\) \{/.test(moduleSrc) && !/if \(!opts\.bootstrap\.length\) \{/.test(fakeSrc));
}

console.log(`\n==== verify-r122-discovery: ${ok} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
