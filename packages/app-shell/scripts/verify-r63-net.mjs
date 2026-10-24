/**
 * verify-r63-net.mjs — R63 网络设置（主机模式 / 主机服务商）快速门禁。
 *
 * 两层：
 *  A. 纯函数真值表：直接执行产品使用的 `src/renderer/net-host-pure.js`（vm，不另写一套解析）。
 *     覆盖 host:port / 默认端口 59599 / IPv6 方括号 / 非法条目 / 上限 10 / 上限 1000 / 重复。
 *  B. 真 DOM（hidden Electron + CDP，默认执行；`--no-dom` 可跳过）：
 *     用 build-preview 生成临时预览，复制 renderer.css + net-host-pure.js，加载真实 app.js，
 *     断言：主机模式与「添加主机服务商」默认折叠、服务商列表 7 行可见/超出滚动、
 *     检测动画 >= 1.3s 且 isBusy/动画类存在、公网 IP 自动填入、增删改与设置落盘。
 *     没有 Electron 时**如实降级**为纯函数 + 源码契约，并在输出里标 STATIC-ONLY。
 *
 * 用法：
 *   node packages/app-shell/scripts/verify-r63-net.mjs
 *   node packages/app-shell/scripts/verify-r63-net.mjs --no-dom
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attach, sleep, reporter} from './cdp-lib.mjs';

const SELF = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(SELF, '..');
const REPO = path.resolve(PKG, '..', '..');
const RENDERER = path.join(PKG, 'src', 'renderer');
const I18N = path.join(PKG, 'src', 'i18n');
const R = reporter();
const {ok, warn} = R;
const NO_DOM = process.argv.includes('--no-dom');

function read(p) { return fs.readFileSync(p, 'utf8'); }

/* ═══════════════════════════════════════════════════════════════════
   A. 纯函数真值表（产品代码本体）
   ═══════════════════════════════════════════════════════════════════ */
const sandbox = {console};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read(path.join(RENDERER, 'net-host-pure.js')), sandbox, {filename: 'net-host-pure.js'});
const H = sandbox.WarmyNetHost;

ok(!!H && typeof H.parseHostEntry === 'function', 'P0 纯函数模块可加载（parseHostEntry 存在）');
ok(H.HOSTS_MAX === 10 && H.PROVIDERS_MAX === 1000 && H.DEFAULT_NET_PORT === 59599,
  'P0 常量：主机 10 / 服务商 1000 / 默认端口 59599', JSON.stringify({h: H.HOSTS_MAX, p: H.PROVIDERS_MAX, d: H.DEFAULT_NET_PORT}));

const parseCases = [
  ['example.com', true, 'example.com:59599', 59599, false],
  ['Example.COM', true, 'example.com:59599', 59599, false],
  ['example.com:6000', true, 'example.com:6000', 6000, true],
  ['localhost', true, 'localhost:59599', 59599, false],
  ['192.168.1.10', true, '192.168.1.10:59599', 59599, false],
  ['192.168.1.10:59599', true, '192.168.1.10:59599', 59599, true],
  ['[::1]:6000', true, '[::1]:6000', 6000, true],
  ['[::1]', true, '[::1]:59599', 59599, false],
  ['::1', true, '[::1]:59599', 59599, false],
  ['2001:db8::1', true, '[2001:db8::1]:59599', 59599, false],
  ['[::ffff:192.0.2.1]:80', true, '[::ffff:192.0.2.1]:80', 80, true],
  ['999.1.1.1', false, 'invalid-host'],
  ['1.2.3.4:0', false, 'invalid-port'],
  ['1.2.3.4:65536', false, 'invalid-port'],
  ['host:abc', false, 'invalid-port'],
  ['[::1]:', false, 'invalid-port'],
  ['[bad]:1', false, 'invalid-ipv6'],
  ['http://x:1', false, 'invalid-host'],
  ['a_b.com', false, 'invalid-host'],
  ['has space.com', false, 'invalid-host'],
  ['', false, 'empty'],
];
let pc = 0;
for (const [raw, wantOk, want, port, hadPort] of parseCases) {
  const r = H.parseHostEntry(raw, 59599);
  const pass = wantOk
    ? (r.ok && r.canonical === want && r.port === port && r.hadPort === hadPort)
    : (!r.ok && r.code === want);
  ok(pass, `P1 解析 ${JSON.stringify(raw)} -> ${wantOk ? want : want}`, JSON.stringify(r));
  pc += 1;
}
ok(pc === parseCases.length, 'P1 解析真值表全量执行', String(pc));

const h10 = [];
for (let i = 0; i < 10; i++) {
  const r = H.addHost(h10, `h${i}.example.com`, 59599, 10);
  if (i === 0) ok(r.ok && r.hosts.length === 1 && r.entry.port === 59599, 'P2 首条未写端口 -> 59599', JSON.stringify(r.entry));
  if (r.ok) h10.push(r.hosts[r.hosts.length - 1]);
}
ok(h10.length === 10, 'P2 主机列表可到 10 条', String(h10.length));
const dup = H.addHost(h10, 'h0.example.com:59599', 59599, 10);
ok(!dup.ok && dup.code === 'duplicate', 'P2 重复地址被拒（按规范化 host:port）', dup.code);
const full = H.addHost(h10, 'h11.example.com', 59599, 10);
ok(!full.ok && full.code === 'full', 'P2 第 11 条被拒（上限 10）', full.code);
const norm = H.normalizeStoredHosts(['b.example.com', 'B.EXAMPLE.COM:59599', 'bad host', '[::1]'], 59599, 10);
ok(norm.length === 3 && norm[0] === 'b.example.com:59599' && norm[1] === 'bad host' && norm[2] === '[::1]:59599',
  'P2 读回旧配置：规范化去重 + 非法条目保留可见', JSON.stringify(norm));
ok(H.removeAt(h10, 0).length === 9, 'P2 删除一条主机地址', '');

const p1000 = Array.from({length: 1000}, (_, i) => ({
  id: 'np-' + i, name: 'P' + i, address: `p${i}.example.com:59599`, hasCredential: false, credentialState: 'none',
}));
const pFull = H.upsertProvider(p1000, {name: 'overflow', address: 'overflow.example.com'}, 59599, 1000);
ok(!pFull.ok && pFull.code === 'full', 'P3 服务商上限 1000', pFull.code);
const p0 = H.upsertProvider([], {name: 'Home', address: 'home.example.com'}, 59599, 1000);
ok(p0.ok && p0.record.address === 'home.example.com:59599' && p0.record.credentialState === 'none',
  'P3 新增服务商：默认端口 + 无凭证状态', JSON.stringify(p0.record));
const pDup = H.upsertProvider(p0.providers, {name: 'Dup', address: 'HOME.example.com'}, 59599, 1000);
ok(!pDup.ok && pDup.code === 'duplicate', 'P3 重复服务商地址（域名大小写不敏感）', pDup.code);
const pEdit = H.upsertProvider(p0.providers, {id: p0.record.id, name: 'Home2', address: 'home2.example.com'}, 59599, 1000);
ok(pEdit.ok && pEdit.code === 'updated' && pEdit.record.name === 'Home2' && pEdit.providers.length === 1,
  'P3 编辑服务商不新增条目', JSON.stringify(pEdit.record));
const pName = H.upsertProvider([], {name: '', address: 'a.example.com'}, 59599, 1000);
ok(!pName.ok && pName.code === 'empty-name', 'P3 空名称被拒', pName.code);

ok(H.isPrivateAddress('192.168.1.2') && H.isPrivateAddress('10.0.0.1') && H.isPrivateAddress('100.64.0.1') &&
  H.isPrivateAddress('::1') && H.isPrivateAddress('fd00::1') && !H.isPrivateAddress('203.0.113.9'),
  'P4 私网/CGNAT/回环/ULA 分类');
ok(!H.isUsablePublicIp('192.168.1.2') && H.isUsablePublicIp('203.0.113.9') && H.isUsablePublicIp('2001:db8::1'),
  'P4 只把真正公网 IP 当作可自动填入');
const c1 = H.classifyHostReachability({localIp: '192.168.1.2', publicIp: '203.0.113.9', probe: {isPublic: true, outboundOk: true}});
ok(c1.isPublic === 'yes' && c1.reach === 'direct-unverified', 'P4 公网 + 出站通 => 可直连（入站未验证）', JSON.stringify(c1));
const c2 = H.classifyHostReachability({localIp: '192.168.1.2', publicIp: '', probe: {lanOnly: true}});
ok(c2.isPublic === 'no' && c2.reach === 'lan', 'P4 无公网 + lanOnly => 仅局域网', JSON.stringify(c2));
const c3 = H.classifyHostReachability({localIp: '192.168.1.2', publicIp: '203.0.113.9', behindNat: true});
ok(c3.isPublic === 'yes' && c3.reach === 'unknown', 'P4 NAT 后不冒充可直连', JSON.stringify(c3));

/* ═══════════════════════════════════════════════════════════════════
   B. 源码契约（即使 DOM 不可用也检查）
   ═══════════════════════════════════════════════════════════════════ */
const appJs = read(path.join(RENDERER, 'app.js'));
const indexHtml = read(path.join(RENDERER, 'index.html'));
const css = read(path.join(RENDERER, 'renderer.css'));
const settingsTs = read(path.join(PKG, 'src', 'settings-store.ts'));
ok(indexHtml.indexOf('./net-host-pure.js') !== -1 && indexHtml.indexOf('./net-host-pure.js') < indexHtml.indexOf('./app.js'),
  'S1 index.html 在 app.js 之前加载纯函数模块');
ok(/<details class="wangLuoHostDetails" id="wangLuoHostMode">/.test(appJs) && !/<details class="wangLuoHostDetails" id="wangLuoHostMode" open/.test(appJs),
  'S1 主机模式是 <details> 且默认折叠');
ok(/<details class="wangLuoProviderDetails" id="wangLuoProviderMode">/.test(appJs),
  'S1 主机服务商是 <details> 且默认折叠');
ok(appJs.indexOf('data-max="10"') !== -1 && appJs.indexOf('data-max="1000"') !== -1 && appJs.indexOf('data-visible-rows="7"') !== -1,
  'S1 列表上限/可见行数写进 DOM 契约');
ok(appJs.indexOf('NET_HOST_DETECT_MIN_MS = 1300') !== -1 && appJs.indexOf('NET_HOST_DETECT_TIMEOUT_MS = 8000') !== -1,
  'S2 检测最短 1.3s + 超时 8s');
ok(appJs.indexOf('hostMode: !!netState.hostMode.enabled') !== -1 &&
  appJs.indexOf('hosts,') !== -1 && appJs.indexOf('providers,') !== -1,
  'S3 持久化 net 同时包含旧字段 + hostMode/hosts/providers');
ok(settingsTs.indexOf('hosts?: string[]') !== -1 && settingsTs.indexOf('providers?: Array<') !== -1,
  'S3 settings-store 类型声明 hostMode/hosts/providers');
ok(css.indexOf('calc(var(--net-provider-row) * 7 + 2px)') !== -1 && css.indexOf('@keyframes wangLuoHostSpin') !== -1 &&
  css.indexOf('.wangLuoHostDetectBtn.isBusy') !== -1,
  'S4 CSS：7 行高度 + 检测忙碌动画');
ok(appJs.indexOf('warmy:anQuanMiYaoBaoCun') !== -1 && appJs.indexOf('secureKeySave') !== -1 &&
  appJs.indexOf('apiKey: cred') !== -1,
  'S5 凭证只走 secureKeySave，不写明文到 settings');

/* i18n：新增键必须在 10 个语言包都存在且非空（verify-i18n-locales 再跑全量） */
const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
const NEW_KEYS = Object.keys(JSON.parse(read(path.join(I18N, 'zh-CN.json'))))
  .filter((k) => k.startsWith('net.card') || k.startsWith('net.host.') || k.startsWith('net.provider.'));
let i18nMissing = [];
for (const loc of LOCALES) {
  const pack = JSON.parse(read(path.join(I18N, loc + '.json')));
  for (const k of NEW_KEYS) if (typeof pack[k] !== 'string' || !pack[k].trim()) i18nMissing.push(loc + ':' + k);
}
ok(NEW_KEYS.length >= 60, 'S6 R63 新增 i18n 键数量 >= 60', String(NEW_KEYS.length));
ok(i18nMissing.length === 0, 'S6 新增 i18n 键在 10 个语言包都存在且非空', JSON.stringify(i18nMissing.slice(0, 5)));

/* ═══════════════════════════════════════════════════════════════════
   C. 真 DOM（hidden Electron + CDP）
   ═══════════════════════════════════════════════════════════════════ */
const electronExe = [
  path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(PKG, 'node_modules', 'electron', 'dist', 'electron'),
].find((p) => fs.existsSync(p));
if (NO_DOM) {
  warn('STATIC-ONLY：--no-dom，跳过隐藏 Electron DOM 断言（纯函数与源码契约已跑）');
} else if (!electronExe) {
  warn('STATIC-ONLY：找不到 Electron 可执行文件，跳过 DOM 断言（不声称 UI 已验证）');
} else {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r63-net-'));
  let child = null;
  let c = null;
  try {
    execFileSync(process.execPath, [path.join(PKG, 'scripts', 'build-preview.mjs'), '--out', OUT], {cwd: REPO, stdio: 'ignore'});
    // build-preview 只复制 app.css/app.js；真实 index.html 还引用 renderer.css，R63 新样式在这个文件里。
    fs.copyFileSync(path.join(RENDERER, 'renderer.css'), path.join(OUT, 'renderer.css'));
    fs.copyFileSync(path.join(RENDERER, 'net-host-pure.js'), path.join(OUT, 'net-host-pure.js'));

    const hostFile = path.join(OUT, 'r63-host.cjs');
    fs.writeFileSync(hostFile, `
const {app, BrowserWindow} = require('electron');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false},
  });
  w.loadFile(process.env.PREVIEW_HTML);
});
app.on('window-all-closed', () => app.quit());
`, 'utf8');

    const port = 9600 + Math.floor(Math.random() * 200);
    const profile = path.join(OUT, 'profile');
    const envChild = {...process.env, PREVIEW_HTML: path.join(OUT, 'index.html')};
    // ELECTRON_RUN_AS_NODE=1 会让 Electron 按 Node 解析参数（--user-data-dir 被判 bad option）
    delete envChild.ELECTRON_RUN_AS_NODE;
    child = spawn(electronExe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--disable-features=CalculateNativeWinOcclusion',
      hostFile,
    ], {
      cwd: OUT,
      env: envChild,
      stdio: 'ignore',
      windowsHide: true,
    });

    let attached = false;
    for (let i = 0; i < 80 && !attached; i++) {
      try { c = await attach(port, {biaoQian: 'verify-r63-net', callTimeout: 12000}); attached = true; } catch { await sleep(250); }
    }
    if (!attached) throw new Error('CDP 连接超时（Electron 没起来）');
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Page.addScriptToEvaluateOnNewDocument', {source: `
      window.__r63Errs = [];
      window.__r63ConsoleErrs = [];
      (function () {
        var orig = console.error;
        console.error = function () {
          try {
            window.__r63ConsoleErrs.push(Array.prototype.map.call(arguments, function (a) {
              return String((a && a.stack) || a || '');
            }).join(' '));
          } catch (e) { /* noop */ }
          return orig.apply(console, arguments);
        };
      })();
      window.addEventListener('error', function (e) {
        window.__r63Errs.push({msg: String(e.message || ''), stack: String((e.error && e.error.stack) || '')});
      });
      window.addEventListener('unhandledrejection', function (e) {
        window.__r63Errs.push({msg: 'rejection: ' + String((e.reason && e.reason.message) || e.reason || ''), stack: String((e.reason && e.reason.stack) || '')});
      });
      window.__warmyNetStub = {
        netLocalAddress: async () => ({ok: true, localIp: '192.168.1.50', publicIp: '203.0.113.9', behindNat: false, port: 59599}),
        netProbe: async () => ({ok: true, isPublic: true, outboundOk: true, lanOnly: false, method: 'harness'}),
        netStatus: async () => ({ok: true, meshEnabled: false, sessions: 0}),
      };
    `});
    await c.send('Page.reload', {ignoreCache: true});
    await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi && !!document.querySelector("#ceLan")',
      {timeout: 30000, biaoQian: '页面启动完成'});
    await c.evaluate(`(function(){
      window.__r63Keys = [];
      if (window.warmy) window.warmy.secureKeySave = async (p) => { window.__r63Keys.push(p); return {ok: true}; };
      return true;
    })()`);
    const bootErrCount = c.errors().length;
    const bootPageErrCount = Number(await c.evaluate('(window.__r63Errs||[]).length')) || 0;
    const bootConsoleErrCount = Number(await c.evaluate('(window.__r63ConsoleErrs||[]).length')) || 0;
    if (bootErrCount) {
      warn('预览源数据已知启动异常 ' + bootErrCount + ' 条（demoChats 提供 ming、列表读 name）——不计入 R63 新增异常');
    }

    // 打开设置 → 功能分区 → 网络卡
    // 预览首帧可能停在首启/空态，不假设一定自动打开会话；给启动后的自动导航一点时间即可。
    await sleep(900);
    await c.evaluate(`(function(){var b=document.querySelector('[data-nav="settings"]'); if(b)b.click(); return true;})()`);
    await c.waitFor('!!document.querySelector("#wangLuoKa")', {timeout: 10000, biaoQian: '设置卡出现'});
    await c.evaluate(`(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b)b.click(); return true;})()`);
    await c.waitFor('!document.querySelector("#wangLuoKa").classList.contains("yinCang")', {timeout: 8000, biaoQian: '网络卡可见'});
    await c.evaluate(`(function(){var e=document.querySelector('#wangLuoKa'); if(e&&e.scrollIntoView) e.scrollIntoView({block:'center'}); return true;})()`);
    await sleep(250);

    ok(await c.evaluate('document.querySelector("#wangLuoHostMode").open === false'), 'D1 主机模式默认折叠');
    ok(await c.evaluate('document.querySelector("#wangLuoProviderMode").open === false'), 'D1 主机服务商默认折叠');
    ok(await c.evaluate('!!document.querySelector("#wangLuoHostList") && !!document.querySelector("#wangLuoProviderList")'),
      'D1 主机列表 / 服务商列表存在');

    // 展开两个 details
    await c.evaluate('document.querySelector("#wangLuoHostMode").open = true; document.querySelector("#wangLuoProviderMode").open = true; true');

    // 主机地址：默认端口、IPv6、重复、上限 10、删除确认
    await c.evaluate(`(function(){
      window.__netUi.hostMode.hosts = [];
      var i=document.querySelector('#wangLuoHostInput');
      i.value='example.com'; document.querySelector('#anNiuHostAdd').click();
      i.value='[::1]:6000'; document.querySelector('#anNiuHostAdd').click();
      i.value='[::1]'; document.querySelector('#anNiuHostAdd').click();
      return true;
    })()`);
    await c.waitFor('window.__netUi.hostMode.hosts.length === 3', {timeout: 5000, biaoQian: '主机 3 条'});
    const hostSnap = JSON.parse(await c.evaluate('JSON.stringify(window.__netUi.hostMode.hosts)'));
    ok(hostSnap[0] === 'example.com:59599' && hostSnap[1] === '[::1]:6000' && hostSnap[2] === '[::1]:59599',
      'D2 host:port / IPv6 / 默认端口 59599', JSON.stringify(hostSnap));
    await c.evaluate(`(function(){var i=document.querySelector('#wangLuoHostInput'); i.value='example.com'; document.querySelector('#anNiuHostAdd').click(); return true;})()`);
    await c.waitFor('document.querySelector("#wangLuoHostMsg").textContent.indexOf("已经在列表里") !== -1', {timeout: 4000, biaoQian: '重复提示'});
    ok(true, 'D2 重复主机地址被拒并说明');
    await c.evaluate(`(function(){
      for (var n=3;n<10;n++){var i=document.querySelector('#wangLuoHostInput'); i.value='h'+n+'.example.com'; document.querySelector('#anNiuHostAdd').click();}
      return window.__netUi.hostMode.hosts.length;
    })()`);
    await c.waitFor('window.__netUi.hostMode.hosts.length === 10', {timeout: 6000, biaoQian: '主机 10 条'});
    await c.evaluate(`(function(){var i=document.querySelector('#wangLuoHostInput'); i.value='overflow.example.com'; document.querySelector('#anNiuHostAdd').click(); return true;})()`);
    await c.waitFor('document.querySelector("#wangLuoHostMsg").textContent.indexOf("最多 10 条") !== -1', {timeout: 4000, biaoQian: '主机上限提示'});
    ok(true, 'D2 第 11 条主机被拒（上限 10）');
    await c.evaluate('document.querySelector("[data-host-del=\\"0\\"]").click()');
    await c.waitFor('!document.querySelector("#duiHuaKuangGen").classList.contains("yinCang")', {timeout: 4000, biaoQian: '删除确认'});
    ok(true, 'D2 删除主机地址有确认框');
    await c.evaluate('document.querySelector("#duiHuaKuangDongZuoJi .anNiuZhuYao").click()');
    await c.waitFor('window.__netUi.hostMode.hosts.length === 9', {timeout: 4000, biaoQian: '主机删除生效'});
    ok(true, 'D2 确认后删除生效');

    // 检测：清空主机列表 → 点按钮 → 至少 1.3s + 动画 + 自动填入公网 IP
    await c.evaluate('window.__netUi.hostMode.hosts = []; true');
    const det = await c.evaluate(`(async function(){
      var b=document.querySelector('#anNiuHostDetect');
      var t0=performance.now();
      b.click();
      var busyAtStart=b.classList.contains('isBusy');
      var anim=getComputedStyle(b,'::before').animationName;
      while (b.classList.contains('isBusy')) await new Promise(function(r){setTimeout(r,20);});
      return {elapsed: performance.now()-t0, busyAtStart: busyAtStart, anim: anim,
        isPublic: document.querySelector('#wangLuoHostDetectResult').dataset.isPublic,
        reach: document.querySelector('#wangLuoHostDetectResult').dataset.reach,
        text: document.querySelector('#wangLuoHostDetectResult').innerText,
        hosts: window.__netUi.hostMode.hosts.slice()};
    })()`);
    ok(det.elapsed >= 1290, 'D3 检测动画至少 1.3s', Math.round(det.elapsed) + 'ms');
    ok(det.busyAtStart === true && det.anim === 'wangLuoHostSpin', 'D3 检测期间有 isBusy + CSS 旋转动画', JSON.stringify({busy: det.busyAtStart, anim: det.anim}));
    ok(det.isPublic === 'yes' && det.reach === 'direct-unverified', 'D3 如实显示公网 + 可直连（入站未验证）', JSON.stringify({p: det.isPublic, r: det.reach}));
    ok(det.text.indexOf('192.168.1.50') !== -1 && det.text.indexOf('203.0.113.9') !== -1, 'D3 显示本机 IP 与公网 IP', det.text.slice(0, 120));
    ok(det.hosts.length === 1 && det.hosts[0] === '203.0.113.9:59599', 'D3 公网 IP 自动填入（默认端口）', JSON.stringify(det.hosts));

    // 再检测一次：去重，不重复添加
    const det2 = await c.evaluate('window.__netUi.hostDetect()');
    await c.waitFor('window.__netUi.hostMode.hosts.length === 1', {timeout: 5000, biaoQian: '自动填入去重'});
    ok(det2.auto === 'duplicate', 'D3 公网 IP 已在列表 => 不重复添加', det2.auto);

    // 主机模式启用勾选持久化
    await c.evaluate('document.querySelector("#wangLuoHostEnabled").click()');
    await c.waitFor('window.__netUi.hostMode.enabled === true', {timeout: 4000, biaoQian: '主机模式启用'});
    const persist1 = JSON.parse(await c.evaluate('JSON.stringify((window.__previewSettings||{}).net||{})'));
    ok(persist1.hostMode === true && Array.isArray(persist1.hosts) && persist1.hosts[0] === '203.0.113.9:59599',
      'D4 hostMode/hosts 落盘', JSON.stringify({hostMode: persist1.hostMode, hosts: persist1.hosts}));

    // 服务商：添加 8 条 → 7 行可见、滚动；状态/编辑/删除/凭证
    for (let i = 0; i < 8; i++) {
      await c.evaluate(`(async function(){
        window.__netUi.providerOpenForm('add','');
        document.querySelector('#wangLuoProviderName').value='P${i}';
        document.querySelector('#wangLuoProviderAddress').value='p${i}.example.com';
        return await window.__netUi.providerSave();
      })()`);
    }
    await c.waitFor('window.__netUi.providers.length === 8', {timeout: 8000, biaoQian: '服务商 8 条'});
    await c.evaluate(`(function(){var e=document.querySelector('#wangLuoProviderList'); if(e&&e.scrollIntoView) e.scrollIntoView({block:'center'}); return true;})()`);
    await sleep(250);
    const box = JSON.parse(await c.evaluate(`(function(){
      var l=document.querySelector('#wangLuoProviderList');
      var rows=Array.from(l.querySelectorAll('.wangLuoProviderHang'));
      return JSON.stringify({rows: rows.length, clientH: l.clientHeight, offsetH: l.offsetHeight, scrollH: l.scrollHeight, rowH: rows[0]?rows[0].offsetHeight:0, vis: getComputedStyle(l).overflowY});
    })()`));
    ok(box.rows === 8 && box.rowH === 46 && Math.round(box.clientH / 46) === 7 && box.scrollH > box.clientH,
      'D5 服务商列表固定 7 行可见、第 8 条起滚动', JSON.stringify(box));

    // 添加带凭证的一条（走 secureKeySave 桩），并确认 settings 不含明文
    const addCred = await c.evaluate(`(async function(){
      window.__netUi.providerOpenForm('add','');
      document.querySelector('#wangLuoProviderName').value='Cred Host';
      document.querySelector('#wangLuoProviderAddress').value='cred.example.com:6000';
      document.querySelector('#wangLuoProviderCredential').value='s3cret-value';
      var r=await window.__netUi.providerSave();
      return {r:r, keys:window.__r63Keys.slice(), providers:window.__netUi.providers.slice()};
    })()`);
    const credRec = addCred.providers.find((p) => p.name === 'Cred Host');
    ok(!!credRec && credRec.hasCredential === true && credRec.credentialState === 'stored', 'D5 凭证已交 SecureKeyStore（状态 stored）', JSON.stringify(credRec));
    ok(addCred.keys.length === 1 && addCred.keys[0].providerId.indexOf('net-provider:') === 0 && addCred.keys[0].apiKey === 's3cret-value',
      'D5 凭证走 secureKeySave + 命名空间 id', JSON.stringify(addCred.keys[0]));
    const persistedAll = await c.evaluate('JSON.stringify(window.__previewSettings||{})');
    ok(persistedAll.indexOf('s3cret-value') === -1, 'D5 settings 里没有明文凭证');

    // 编辑：留空凭证 => 保持 hasCredential，名称/地址更新
    await c.evaluate(`(function(){document.querySelector('[data-pedit="'+${JSON.stringify(credRec.id)}+'"]').click(); return true;})()`);
    await c.waitFor('!document.querySelector("#wangLuoProviderForm").classList.contains("yinCang")', {timeout: 4000, biaoQian: '编辑表单'});
    ok(await c.evaluate('document.querySelector("#wangLuoProviderCredential").value === ""'), 'D6 编辑不回显明文凭证');
    await c.evaluate(`(async function(){
      document.querySelector('#wangLuoProviderName').value='Cred Host 2';
      document.querySelector('#wangLuoProviderAddress').value='cred2.example.com';
      return await window.__netUi.providerSave();
    })()`);
    await c.waitFor('window.__netUi.providers.some(function(p){return p.name==="Cred Host 2"&&p.hasCredential===true;})', {timeout: 5000, biaoQian: '编辑生效'});
    ok(true, 'D6 编辑名称/地址并保留凭证状态');

    // 删除：确认后生效
    await c.evaluate(`(function(){document.querySelector('[data-pdel="'+${JSON.stringify(credRec.id)}+'"]').click(); return true;})()`);
    await c.waitFor('!document.querySelector("#duiHuaKuangGen").classList.contains("yinCang")', {timeout: 4000, biaoQian: '服务商删除确认'});
    ok(true, 'D6 删除服务商有确认框');
    await c.evaluate('document.querySelector("#duiHuaKuangDongZuoJi .anNiuZhuYao").click()');
    await c.waitFor('window.__netUi.providers.length === 8', {timeout: 5000, biaoQian: '服务商删除生效'});
    ok(true, 'D6 确认后服务商删除生效');
    ok(c.errors().length === bootErrCount, 'D6.5 R63 增删改/检测期间无新增异常',
      JSON.stringify(c.errors().slice(bootErrCount, bootErrCount + 2)).slice(0, 600));

    // 旧配置迁移：写回 ip/domains（无 hostMode/hosts），reload 后仍能读回公网地址列表
    await c.evaluate(`(function(){
      localStorage.setItem('warmyPreviewSettings', JSON.stringify({net:{ip:'198.51.100.7', domains:['legacy.example.com'], port:59600}}));
      return true;
    })()`);
    await c.send('Page.reload', {ignoreCache: true});
    await c.waitFor('typeof window.__netUi === "object" && Array.isArray(window.__netUi.net.addr.publicAddresses)', {timeout: 30000, biaoQian: 'reload 后启动'});
    const reloadBootErrCount = c.errors().length;
    const legacy = JSON.parse(await c.evaluate('JSON.stringify({addr:window.__netUi.net.addr.publicAddresses, port:window.__netUi.net.addr.port, hm:window.__netUi.net.hostMode.enabled})'));
    ok(legacy.addr.indexOf('198.51.100.7') !== -1 && legacy.addr.indexOf('legacy.example.com') !== -1 && legacy.port === 59600,
      'D7 旧 ip/domains 迁移到地址列表且端口读回', JSON.stringify(legacy));
    ok(legacy.hm === false, 'D7 旧配置没有 hostMode => 默认未启用（不破坏旧配置）', String(legacy.hm));

    const newPageErrs = await c.evaluate(`(window.__r63Errs||[]).slice(${bootPageErrCount})`);
    const newConsoleErrs = await c.evaluate(`(window.__r63ConsoleErrs||[]).slice(${bootConsoleErrCount})`);
    if (newPageErrs && newPageErrs.length) console.log('    [diag] new page errors =', JSON.stringify(newPageErrs.slice(0, 3)));
    if (newConsoleErrs && newConsoleErrs.length) console.log('    [diag] new console errors =', JSON.stringify(newConsoleErrs.slice(0, 3)));
    const errs = c.errors().slice(Math.max(bootErrCount, reloadBootErrCount));
    ok(errs.length === 0, 'D8 reload 后无新增控制台异常/未捕获错误', JSON.stringify(errs.slice(0, 3)).slice(0, 1200));
  } catch (e) {
    ok(false, 'DOM 验收未完成：' + e.message.slice(0, 240));
  } finally {
    try { c && c.close(); } catch { /* noop */ }
    if (child) {
      try { child.kill(); } catch { /* noop */ }
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true}); } catch { /* noop */ }
      }
    }
  }
}

const pass = R.summary('R63 网络设置快速门禁' + (NO_DOM ? '（STATIC-ONLY）' : ''));
process.exit(pass ? 0 : 2);
