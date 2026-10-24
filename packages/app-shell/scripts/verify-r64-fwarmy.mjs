/**
 * verify-r64-fwarmy.mjs（fast 档）—— 第 64 轮：服务器改名 FWArmy + 管理界面 + 凭据级统计/限额。
 *
 * 覆盖：
 *  ① 独立项目位于 WArmy 仓库外（默认 `../FWArmy`，可用 FWARMY_DIR 覆盖），单文件/无界面/控制台入口齐全；
 *  ② 首次启动自动生成安全凭据；管理页自包含（无外部脚本/样式），打开即用；
 *  ③ 每个凭据：名称、请求速度、流量速度、日/月/年配额、停用、删除（删除需二次确认）；
 *  ④ 统计按凭据累计请求/上下行字节/峰值，日/月/年分桶，重启不丢；损坏按空表启动；
 *  ⑤ 无界面 ctl start/stop、日志格式、控制台自动对齐；日志/磁盘都不含消息明文或凭据明文；
 *  ⑥ 本机管理面四道边界仍在（回环 + Host + Origin + JSON）；旧版凭据限额字段可迁移。
 *
 * 负例（证明断言不是摆设）：伪造 Host / 跨站 Origin / 表单 POST / 超日额 / 超月额 / 超年额 /
 * 停用 / 错名称删除，都必须被拒绝。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const K = await import(U('packages/app-shell/dist/zhong-ji-ke-hu.js'));
const { FWARMY_ROOT: FW, fwPath, fwRead, fwExists } = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/scripts/fwarmy-loc.mjs')).href);
const SERVER = fwPath('server.mjs');
const CTL = fwPath('ctl.mjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 180) : '')); } };
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

async function post(base, p, b) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  return { status: r.status, j: await r.json() };
}
async function get(base, p) {
  const r = await fetch(base + p);
  return { status: r.status, j: await r.json() };
}
async function startNode(data, port) {
  const srv = spawn(process.execPath, [SERVER, '--port=' + port, '--host=127.0.0.1', '--data=' + data, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WARMY_RELAY_DATA: data } });
  let out = '';
  srv.stdout.on('data', (b) => { out += String(b); });
  srv.stderr.on('data', (b) => { out += String(b); });
  let h = null;
  for (let i = 0; i < 80 && !h; i++) {
    await sleep(100);
    try { h = (await get(`http://127.0.0.1:${port}`, '/api/health')).j; } catch { /* retry */ }
  }
  if (!h) throw new Error('服务器没起来：' + out.slice(0, 500));
  return { srv, out: () => out };
}
async function stopNode(srv, port) {
  try { await post(`http://127.0.0.1:${port}`, '/api/admin/shutdown', {}); } catch { /* noop */ }
  for (let i = 0; i < 60; i++) { if (srv.exitCode !== null) return; await sleep(100); }
  try { srv.kill(); } catch { /* noop */ }
}
function killDataDir(dir) {
  try {
    const inst = JSON.parse(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8'));
    if (inst && inst.pid) process.kill(Number(inst.pid));
  } catch { /* noop */ }
}
function rawStatus(port, p, headers) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    r.on('error', () => resolve(0)); r.end();
  });
}

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'fwarmy-r64-' + tag + '-'));
const dataA = tmp('main');
const dataB = tmp('ctl');
const dataC = tmp('legacy');
const portA = await freePort();
const base = `http://127.0.0.1:${portA}`;
let srvA = null;

try {
  // ── ① 改名与入口 ──
  jian('FWArmy 位于仓库外且旧 relay-server/ 不再存在', fwExists('server.mjs') && fwExists('README.md') && !fs.existsSync(path.join(ROOT, 'fwarmy')) && !fs.existsSync(path.join(ROOT, 'relay-server')));
  jian('独立项目入口齐全（server/admin/ctl/package/README/启停/无界面/控制台/单文件构建）',
    ['server.mjs', 'admin.html', 'ctl.mjs', 'package.json', 'README.md', 'start.bat', 'start.sh', 'stop.bat', 'stop.sh',
      'fwarmy-headless.bat', 'fwarmy-headless.sh', 'fwarmy-console.bat', 'fwarmy-console.sh', 'build-sea.mjs', 'build-sea.sh', 'sea-main.mjs',
    ].every((f) => fwExists(f)));
  jian('旧路径引用已清理（没有 relay-server/server.mjs / ctl.mjs / cd relay-server）',
    ['docs/SERVER-RELAY.md', 'packages/app-shell/scripts/verify-r58-zhongji.mjs', 'packages/app-shell/scripts/verify-r59-wangluo.mjs', 'packages/app-shell/scripts/verify-r60-nm-server.mjs']
      .every((f) => !/relay-server[\\/](server|ctl)\.mjs|cd relay-server/.test(read(f)))
    && !/relay-server[\\/](server|ctl)\.mjs|cd relay-server/.test(fwRead('README.md')));
  jian('package.json 是零运行依赖的独立项目', (() => { const p = JSON.parse(fwRead('package.json')); return p.name === 'fwarmy' && !p.dependencies && p.type === 'module'; })());
  jian('无界面启动器不开浏览器并写 server.log；控制台启动器进 console --watch',
    /--no-open/.test(fwRead('fwarmy-headless.bat')) && /server\.log/.test(fwRead('fwarmy-headless.bat'))
    && /console --watch/.test(fwRead('fwarmy-console.bat')) && /console --watch/.test(fwRead('fwarmy-console.sh')));
  jian('单文件构建脚本含 esbuild + postject + admin.html 资产 + 冒烟', /esbuild@/.test(fwRead('build-sea.mjs')) && /postject@/.test(fwRead('build-sea.mjs'))
    && /admin\.html/.test(fwRead('build-sea.mjs')) && /--version/.test(fwRead('build-sea.mjs')) && /hashes|sha256/i.test(fwRead('build-sea.mjs')));
  /**
   * 第 65 轮 项 1：页面加了本地 favicon（`/favicon.svg`，由服务器自己提供），不是 CDN。
   * 判据改成"任何资源都必须同源/相对"：不许 http(s):// 外链、不许外部 `<script src>`。
   */
  jian('管理页自包含（没有外部 script src / stylesheet CDN）',
    !/<script[^>]+src=/i.test(fwRead('admin.html'))
    && !/<(?:script|link)[^>]+(?:src|href)=["']?https?:/i.test(fwRead('admin.html'))
    && !/<link[^>]+rel=["']?stylesheet/i.test(fwRead('admin.html')));
  jian('管理页有总览/凭据/设置/日志与逐凭据编辑/删除二次确认控件',
    /id="credTable"/.test(fwRead('admin.html')) && /data-act="edit"/.test(fwRead('admin.html'))
    && /id="fRate"/.test(fwRead('admin.html')) && /id="fDaily"/.test(fwRead('admin.html'))
    && /id="fMonthly"/.test(fwRead('admin.html')) && /id="fYearly"/.test(fwRead('admin.html'))
    && /id="delConfirm"/.test(fwRead('admin.html')) && /confirmName/.test(fwRead('admin.html')));

  // ── ② 首次启动 + 管理页 ──
  srvA = await startNode(dataA, portA);
  const h = (await get(base, '/api/health')).j;
  jian('健康检查认出 fwarmy-relay / FWArmy，且无需业务凭据', h.ok === true && h.server === 'fwarmy-relay' && h.product === 'FWArmy', JSON.stringify(h));
  const page = await (await fetch(base + '/')).text();
  jian('管理页能打开且是 FWArmy（不是旧标题/空壳）', /FWArmy/.test(page) && /id="credTable"/.test(page) && /id="cfgRate"/.test(page));
  const first = (await get(base, '/api/admin/first-credential')).j;
  /**
   * 第 65 轮 项 1 用户改口径：**首次启动不自动生成凭据**，由用户在管理页手动生成（可多个）。
   * 旧断言钉的是"自动生成"，属于被推翻的旧要求。
   */
  jian('首次启动不自动生成凭据（用户手动点「生成凭据」）',
    first.ok === true && first.pending === false && !first.token
    && !fs.existsSync(path.join(dataA, 'first-credential.txt')), JSON.stringify(first));
  jian('首次启动也不会偷偷落明文 token（credentials.json 只有哈希）',
    (() => {
      const f = path.join(dataA, 'credentials.json');
      const s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      return !/"token"\s*:/.test(s) && !/[A-Za-z0-9_-]{40,}/.test(s.replace(/"(hash|hash8)"\s*:\s*"[^"]*"/g, ''));
    })());
  jian('不再生成管理密钥文件（无登录 ≠ 无边界）', !fs.existsSync(path.join(dataA, 'admin-key.txt')));

  const mk = async (name, limits) => (await post(base, '/api/admin/credentials', { name, limits })).j;
  const baseCred = await mk('基础凭据', {});
  jian('新建凭据返回明文一次，且可设置逐凭据限额',
    baseCred.ok === true && !!baseCred.token && baseCred.credential.limits.ratePerMin === null && baseCred.credential.effective.ratePerMin === 120);

  const A = K.shengChengShenFen(), B = K.shengChengShenFen();
  const kBaseA = K.zhuanJiKeHu(base, () => A, baseCred.token);
  const kBaseB = K.zhuanJiKeHu(base, () => B, baseCred.token);
  jian('业务面用新凭据注册 A/B 成功（协议未变）', (await kBaseA.zhuCe()) === true && (await kBaseB.zhuCe()) === true);

  // 请求速度：令牌桶容量=2，前 2 次通过，第 3 次 429
  const cRate = await mk('限速2', { ratePerMin: 2 });
  const st = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch(base + '/api/lookup?did=' + encodeURIComponent(B.edPub), { headers: { authorization: 'Bearer ' + cRate.token } });
    st.push(r.status);
  }
  jian('凭据级请求速度真的生效（2 次通过，第 3 次 429）', st.filter((x) => x === 200).length === 2 && st.filter((x) => x === 429).length === 1, st.join(','));

  // 日配额：大信封 2000 字 > 1024 字节
  const cDay = await mk('日限额', { ratePerMin: 120, dailyBytes: 1024 });
  const big = K.fengZhuang(B.boxPub, 'x'.repeat(2000), { did: A.edPub, edPriv: A.edPriv });
  const dayTry = await K.zhuanJiKeHu(base, () => A, cDay.token).touDi(B.edPub, big);
  jian('凭据级日配额真的生效（超 1 KB 被 429 daily-quota）', dayTry.ok === false && dayTry.error === 'daily-quota', JSON.stringify(dayTry));

  // 月/年配额：小信封约 427B，前 2 次通过，第 3 次超 1024B。
  // 第 78 轮新增「同一条消息 24h 内最多转发 2 次」，配额测试必须用不同消息，否则命中的是防重放而不是限额。
  const xiao = (tag) => K.fengZhuang(B.boxPub, 'z'.repeat(120) + tag, { did: A.edPub, edPriv: A.edPriv });
  const cMonth = await mk('月限额', { ratePerMin: 120, dailyBytes: 0, monthlyBytes: 1024, yearlyBytes: 0 });
  const kMA = K.zhuanJiKeHu(base, () => A, cMonth.token), kMB = K.zhuanJiKeHu(base, () => B, cMonth.token);
  jian('月限额凭据能注册收发双方', (await kMA.zhuCe()) === true && (await kMB.zhuCe()) === true);
  const m1 = await kMA.touDi(B.edPub, xiao('m1')), m2 = await kMA.touDi(B.edPub, xiao('m2')), m3 = await kMA.touDi(B.edPub, xiao('m3'));
  jian('凭据级月配额真的生效（前 2 次成功，第 3 次 429 monthly-quota）', m1.ok === true && m2.ok === true && m3.ok === false && m3.error === 'monthly-quota', JSON.stringify([m1, m2, m3]));

  const cYear = await mk('年限额', { ratePerMin: 120, dailyBytes: 0, monthlyBytes: 0, yearlyBytes: 1024 });
  const kYA = K.zhuanJiKeHu(base, () => A, cYear.token), kYB = K.zhuanJiKeHu(base, () => B, cYear.token);
  jian('年限额凭据能注册收发双方', (await kYA.zhuCe()) === true && (await kYB.zhuCe()) === true);
  const y1 = await kYA.touDi(B.edPub, xiao('y1')), y2 = await kYA.touDi(B.edPub, xiao('y2')), y3 = await kYA.touDi(B.edPub, xiao('y3'));
  jian('凭据级年配额真的生效（前 2 次成功，第 3 次 429 yearly-quota）', y1.ok === true && y2.ok === true && y3.ok === false && y3.error === 'yearly-quota', JSON.stringify([y1, y2, y3]));

  // 停用：立即 401
  const dis = await post(base, '/api/admin/credential-update', { id: cRate.credential.id, disabled: true });
  const disTry = await fetch(base + '/api/lookup?did=' + encodeURIComponent(B.edPub), { headers: { authorization: 'Bearer ' + cRate.token } });
  jian('停用凭据立即失效（401），启用入口存在', dis.j.ok === true && dis.j.credential.disabled === true && disTry.status === 401);

  // 改名
  const ren = await post(base, '/api/admin/credential-update', { id: cDay.credential.id, name: '日限额改名' });
  const list1 = (await get(base, '/api/admin/credentials')).j;
  jian('凭据可改名，列表即时反映', ren.j.ok === true && list1.items.some((c) => c.name === '日限额改名'));

  // 删除二次确认
  const cDel = await mk('待删除', {});
  const delWrong = await post(base, '/api/admin/credential-delete', { id: cDel.credential.id, confirmName: '写错了' });
  const delRight = await post(base, '/api/admin/credential-delete', { id: cDel.credential.id, confirmName: '待删除' });
  const delTry = await fetch(base + '/api/lookup?did=' + encodeURIComponent(B.edPub), { headers: { authorization: 'Bearer ' + cDel.token } });
  const list2 = (await get(base, '/api/admin/credentials')).j;
  jian('删除必须二次确认（名称不匹配 400），正确确认后凭据失效且不再列出',
    delWrong.status === 400 && delRight.j.ok === true && delTry.status === 401 && !list2.items.some((c) => c.id === cDel.credential.id));

  // ── ④ 统计累加 / 日月底/峰值 / 重启保留 ──
  const S1 = (await get(base, '/api/admin/stats')).j;
  /** 第 65 轮起首次不再自动生成凭据 ⇒ 本测试自己建了 6 个、删了 1 个 = 5 个 */
  jian('统计有每凭据的累计/今日/本月/今年与字节、速度、峰值',
    S1.perCredential.length >= 5 && S1.perCredential.every((c) => c.total && c.today && c.month && c.year && c.speed && typeof c.peakPerMin === 'number')
    && S1.perCredential.some((c) => c.total.requests > 0 && c.total.bytes > 0), JSON.stringify({ n: S1.perCredential.length }));
  jian('总统计大于等于各凭据之和（含已删除凭据的历史）',
    S1.totals.requests >= S1.perCredential.reduce((n, c) => n + c.total.requests, 0)
    && S1.totals.bytes >= S1.perCredential.reduce((n, c) => n + c.total.bytes, 0)
    && S1.totals.today.requests > 0 && S1.totals.month.requests > 0 && S1.totals.year.requests > 0
    && S1.totals.peakPerMin >= 1);
  await sleep(3600); // 统计是 3 秒防抖写盘；等它落盘再检查文件
  jian('统计文件按日/月/年分桶，且健康检查/管理请求不冒充业务请求',
    (() => { const s = JSON.parse(fs.readFileSync(path.join(dataA, 'stats.json'), 'utf8')); const c = Object.values(s.credentials).find((x) => Object.keys(x.days || {}).length); return !!c && !!c.days && !!c.months && !!c.years && c.days[Object.keys(c.days)[0]].requests > 0; })());
  jian('所有凭据的总统计与单凭据统计口径一致（requests 总和）', S1.totals.requests >= S1.totals.today.requests && S1.totals.today.requests > 0);

  // 无消息落盘：唯一标记出现在信封里，但任何数据文件/日志都不得包含它
  const marker = 'R64-MARKER-' + crypto.randomBytes(6).toString('hex');
  const mx = K.fengZhuang(B.boxPub, marker, { did: A.edPub, edPriv: A.edPriv });
  const sent = await K.zhuanJiKeHu(base, () => A, baseCred.token).touDi(B.edPub, mx);
  const hits = [];
  for (const f of fs.readdirSync(dataA)) {
    try { if (fs.readFileSync(path.join(dataA, f), 'utf8').includes(marker)) hits.push(f); } catch { /* binary */ }
  }
  jian('消息不落盘（数据目录所有文件都不含信封明文标记）', sent.ok === true && hits.length === 0, hits.join(','));
  const logText = fs.readFileSync(path.join(dataA, 'server.log'), 'utf8');
  jian('日志不含消息明文/首次凭据明文，且行格式固定（时间 + 5 列级别）',
    !logText.includes(marker) && !(typeof first.token === 'string' && first.token && logText.includes(first.token))
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO  (\[fwarmy\]|req )/m.test(logText),
    JSON.stringify({ markerInLog: logText.includes(marker), firstTokenInLog: !!(first.token && logText.includes(first.token)), head: logText.split(/\r?\n/).slice(0, 3) }));

  // 重启保留
  const before = (await get(base, '/api/admin/stats')).j.totals;
  await stopNode(srvA.srv, portA); srvA = null;
  srvA = await startNode(dataA, portA);
  const S2 = (await get(base, '/api/admin/stats')).j;
  jian('重启后统计不丢（总请求/总字节/今日一致）',
    S2.totals.requests === before.requests && S2.totals.bytes === before.bytes && S2.totals.today.requests === before.today.requests,
    JSON.stringify({ before, after: S2.totals }));

  // 管理面四道边界
  const evilHost = await rawStatus(portA, '/api/admin/stats', { host: 'evil.example' });
  const goodHost = await rawStatus(portA, '/api/admin/stats', { host: 'localhost:' + portA });
  const cross = await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ accepting: true }) });
  const form = await fetch(base + '/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'accepting=true' });
  const same = await fetch(base + '/api/admin/stats', { headers: { origin: base } });
  jian('本机管理四道边界仍在：Host 非回环 403、localhost 200、跨站 403、表单 403、同源 200',
    evilHost === 403 && goodHost === 200 && cross.status === 403 && form.status === 403 && same.status === 200,
    JSON.stringify({ evilHost, goodHost, cross: cross.status, form: form.status, same: same.status }));

  // 控制台表格（自动对齐；输出含日/月/年列）
  const tbl = spawnSync(process.execPath, [CTL, 'table', '--port=' + portA], { encoding: 'utf8', cwd: FW });
  jian('控制台表格能读状态/凭据/日·月·年统计，且包含对齐分隔线',
    tbl.status === 0 && /今日/.test(tbl.stdout) && /本月/.test(tbl.stdout) && /今年/.test(tbl.stdout)
    && /----/.test(tbl.stdout) && /基础凭据/.test(tbl.stdout), (tbl.stderr || '').slice(0, 120));

  // 首次凭据确认后删除明文文件
  const ack = await post(base, '/api/admin/first-credential-ack', {});
  jian('确认保存后删除首次凭据明文文件，状态变为未待保存',
    ack.j.ok === true && !fs.existsSync(path.join(dataA, 'first-credential.txt')) && (await get(base, '/api/admin/stats')).j.firstRunPending === false);

  await stopNode(srvA.srv, portA); srvA = null;

  // ── 损坏 stats.json 不挡启动 ──
  fs.writeFileSync(path.join(dataA, 'stats.json'), '{ this is not json', 'utf8');
  srvA = await startNode(dataA, portA);
  const S3 = (await get(base, '/api/admin/stats')).j;
  const log3 = fs.readFileSync(path.join(dataA, 'server.log'), 'utf8');
  jian('stats.json 损坏按空表启动（服务可用、原文件改名保留、日志有 WARN）',
    S3.ok === true && S3.totals.requests === 0 && /stats\.json 损坏/.test(log3)
    && fs.readdirSync(dataA).some((f) => f.startsWith('stats.json.corrupt-')));
  await stopNode(srvA.srv, portA); srvA = null;

  // ── 旧版凭据限额字段迁移 ──
  const legacyToken = 'legacy-token-' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(path.join(dataC, 'credentials.json'), JSON.stringify({
    items: {
      legacy1: {
        id: 'legacy1', name: '旧凭据', hash: sha(legacyToken), hash8: sha(legacyToken).slice(0, 8),
        createdAt: new Date().toISOString(), revoked: false, ratePerMin: 5, dailyBytes: 12345, requests: 7, bytes: 999,
      },
    },
  }), 'utf8');
  const portC = await freePort();
  const srvC = await startNode(dataC, portC);
  const oldList = (await get(`http://127.0.0.1:${portC}`, '/api/admin/credentials')).j;
  const oldCred = (oldList.items || []).find((c) => c.id === 'legacy1');
  const oldStats = (await get(`http://127.0.0.1:${portC}`, '/api/admin/stats')).j;
  jian('旧版凭据的 ratePerMin/dailyBytes 迁移为逐凭据覆盖（不再被丢弃）',
    !!oldCred && oldCred.limits.ratePerMin === 5 && oldCred.limits.dailyBytes === 12345 && oldCred.effective.ratePerMin === 5);
  jian('旧版请求/字节计数迁移到统计，重启不丢', oldStats.totals.requests >= 7 && oldStats.totals.bytes >= 999, JSON.stringify(oldStats.totals));
  await stopNode(srvC.srv, portC);

  // ── 无界面 ctl start/stop（真分离进程）──
  const portB = await freePort();
  const stStart = spawnSync(process.execPath, [CTL, 'start', '--port=' + portB, '--data=' + dataB], { encoding: 'utf8', cwd: FW, timeout: 20000 });
  let hB = null;
  try { hB = (await get(`http://127.0.0.1:${portB}`, '/api/health')).j; } catch { /* noop */ }
  const logB = fs.existsSync(path.join(dataB, 'server.log')) ? fs.readFileSync(path.join(dataB, 'server.log'), 'utf8') : '';
  const stStop = spawnSync(process.execPath, [CTL, 'stop', '--data=' + dataB], { encoding: 'utf8', cwd: FW, timeout: 20000 });
  let afterStop = null;
  try { afterStop = (await get(`http://127.0.0.1:${portB}`, '/api/health')).j; } catch { afterStop = null; }
  jian('无界面 ctl start 能启动并写 server.log；stop 能按健康检查停止',
    stStart.status === 0 && hB && hB.server === 'fwarmy-relay' && /\[fwarmy\]/.test(logB)
    && stStop.status === 0 && !afterStop, (stStart.stderr || stStop.stderr || '').slice(0, 160));

  // 若本机已构建单文件，顺手验一下 --version（不是必需产物，缺失不算红）
  const exe = fwPath('dist', process.platform === 'win32' ? 'FWArmy.exe' : 'FWArmy');
  if (fs.existsSync(exe)) {
    const v = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 15000 });
    jian('已构建的单文件能 --version（本机产物冒烟）', v.status === 0 && /FWArmy/.test(v.stdout), (v.stderr || '').slice(0, 120));
  } else {
    jian('未构建单文件时跳过 --version（构建脚本已存在，不把未构建当红）', true);
  }
} finally {
  if (srvA) { try { await stopNode(srvA.srv, portA); } catch { /* noop */ } }
  killDataDir(dataB);
  for (const d of [dataA, dataB, dataC]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } }
}
console.log(`==== verify-r64-fwarmy: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
