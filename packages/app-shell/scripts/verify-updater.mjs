/**
 * 验证 updater：四种（及以上）真实分支 + 真实下载校验
 *
 *   node scripts/verify-updater.mjs
 *
 * 本地起一个真实 HTTP 服务器当「更新源」，逐条走真实网络：
 *   未配置 / 有更新 / 已是最新 / 本地版本更新 / 网络失败 / HTTP 非 2xx /
 *   响应非法（非 JSON、缺 version、坏校验和）/ GitHub Releases 形态 /
 *   下载成功（sha256+size 校验）/ 校验和不符 / 大小不符 / 无下载地址 / 超时
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Updater, compareVersions, parseVersion } from '../dist/updater.js';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ── 本地更新源（真实 HTTP 服务器） ──
const ARTIFACT = Buffer.from('CCArmy fake installer payload 无限牛马\n'.repeat(64), 'utf8');
const ARTIFACT_SHA = crypto.createHash('sha256').update(ARTIFACT).digest('hex');
const WRONG_SHA = 'deadbeef'.repeat(8);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const json = (obj, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  switch (url.pathname) {
    case '/feed/newer.json':
      return json({
        version: '2.0.0',
        notes: 'fix everything',
        url: `http://127.0.0.1:${port}/artifact.bin`,
        sha256: ARTIFACT_SHA,
        size: ARTIFACT.length,
        mandatory: false,
        publishedAt: '2026-09-17T00:00:00Z',
      });
    case '/feed/latest.json':
      return json({ version: CURRENT, url: `http://127.0.0.1:${port}/artifact.bin`, sha256: ARTIFACT_SHA, size: ARTIFACT.length });
    case '/feed/older.json':
      return json({ version: '0.0.1' });
    case '/feed/no-url.json':
      return json({ version: '3.1.4', notes: 'query-only feed' });
    case '/feed/not-json':
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>not a manifest</body></html>');
    case '/feed/no-version.json':
      return json({ notes: 'no version here' });
    case '/feed/bad-checksum.json':
      return json({ version: '2.0.0', url: `http://127.0.0.1:${port}/artifact.bin`, sha256: 'not-a-sha' });
    case '/feed/wrong-sha.json':
      return json({ version: '2.0.0', url: `http://127.0.0.1:${port}/artifact.bin`, sha256: WRONG_SHA, size: ARTIFACT.length });
    case '/feed/wrong-size.json':
      return json({ version: '2.0.0', url: `http://127.0.0.1:${port}/artifact.bin`, sha256: ARTIFACT_SHA, size: ARTIFACT.length + 12345 });
    case '/feed/github.json':
      return json({
        tag_name: 'v3.0.0',
        body: 'github style release',
        assets: [{ name: 'CCArmy-3.0.0.exe', browser_download_url: `http://127.0.0.1:${port}/artifact.bin`, size: ARTIFACT.length }],
      });
    case '/feed/github-draft.json':
      return json({ tag_name: 'v9.9.9', draft: true });
    case '/feed/503':
      res.writeHead(503, { 'content-type': 'text/plain' });
      return res.end('service unavailable');
    case '/feed/slow.json':
      await new Promise((r) => setTimeout(r, 800));
      return json({ version: '2.0.0' });
    case '/artifact.bin':
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(ARTIFACT.length) });
      return res.end(ARTIFACT);
    default:
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
  }
});

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const base = `http://127.0.0.1:${port}`;
console.log(`本地更新源: ${base}\n构件 ${ARTIFACT.length} 字节, sha256=${ARTIFACT_SHA}`);

const CURRENT = '0.1.0';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccarmy-updater-'));
const downloadDir = path.join(tmpRoot, 'updates');

const mk = (opts = {}) =>
  new Updater({
    currentVersion: CURRENT,
    downloadDir: opts.downloadDir || downloadDir,
    getSettings: opts.getSettings || (() => ({})),
    env: opts.env || {},
    timeoutMs: opts.timeoutMs ?? 4000,
    log: () => {},
  });
const isDefinite = (r) => typeof r.upToDate === 'boolean' && r.status !== 'network-error';

// ── 1. 未配置更新源：明确返回未配置，不得伪装成「已是最新」 ──
console.log('\n[1] 未配置更新源');
const r1 = await mk().check();
check('status = not-configured', r1.status === 'not-configured', { status: r1.status, auto: r1.autoUpdateStatus, ok: r1.ok });
check('ok=false 且 upToDate=false（没伪装成最新）', r1.ok === false && r1.upToDate === false, { ok: r1.ok, upToDate: r1.upToDate });
check('给出 i18nKey 供界面本地化', r1.i18nKey === 'update.status.notConfigured', r1.i18nKey);

const r1b = await mk({ getSettings: () => ({ updateFeedUrl: 'file:///etc/passwd' }) }).check();
check('非法更新源（file://）也判未配置', r1b.status === 'not-configured' && r1b.reason === 'invalid-feed-url', { status: r1b.status, reason: r1b.reason });

// ── 2. 有更新 ──
console.log('\n[2] 有更新');
const r2 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/newer.json` }) }).check();
check('status = update-available', r2.status === 'update-available', r2.status);
check('latestVersion=2.0.0 / updateAvailable=true / upToDate=false', r2.latestVersion === '2.0.0' && r2.updateAvailable === true && r2.upToDate === false, { latest: r2.latestVersion, upToDate: r2.upToDate });
check('带回 sha256/size/notes/downloadUrl', !!r2.sha256 && r2.size === ARTIFACT.length && r2.notes === 'fix everything' && r2.downloadUrl === `${base}/artifact.bin`, { size: r2.size, hasSha: !!r2.sha256 });
check('sourceOrigin=settings 且 source 展示串去掉了查询串', r2.sourceOrigin === 'settings' && r2.source === `http://127.0.0.1:${port}/feed/newer.json`, r2.source);

// ── 3. 已是最新 ──
console.log('\n[3] 已是最新');
const r3 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/latest.json` }) }).check();
check('status = up-to-date', r3.status === 'up-to-date', r3.status);
check('ok=true / upToDate=true / updateAvailable=false', r3.ok === true && r3.upToDate === true && r3.updateAvailable === false, { ok: r3.ok, updateAvailable: r3.updateAvailable });
const r3b = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/older.json` }) }).check();
check('本地版本更新时也是 up-to-date（reason=local-version-newer）', r3b.status === 'up-to-date' && r3b.reason === 'local-version-newer', r3b.reason);

// ── 4. 网络失败（真实连不通的端口） ──
console.log('\n[4] 网络失败');
const deadPort = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const r4 = await mk({ getSettings: () => ({ updateFeedUrl: `http://127.0.0.1:${deadPort}/feed.json` }) }).check();
check('status = network-error', r4.status === 'network-error', { status: r4.status, reason: r4.reason });
check('ok=false / 不是「已是最新」', r4.ok === false && r4.upToDate === false, { ok: r4.ok, upToDate: r4.upToDate });
check('reason 为可读的网络原因（无堆栈/内部路径）', /connection-refused|fetch-failed|timeout|dns-failure/.test(String(r4.reason)), r4.reason);
const r4b = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/slow.json` }), timeoutMs: 150 }).check();
check('超时归为 network-error(timeout)', r4b.status === 'network-error' && r4b.reason === 'timeout', { status: r4b.status, reason: r4b.reason });

// ── 5. HTTP 非 2xx ──
console.log('\n[5] HTTP 非 2xx');
const r5 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/503` }) }).check();
check('status = http-error 且 httpStatus=503', r5.status === 'http-error' && r5.httpStatus === 503, { status: r5.status, http: r5.httpStatus });

// ── 6. 返回格式非法 ──
console.log('\n[6] 返回格式非法');
const r6 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/not-json` }) }).check();
check('非 JSON → invalid-response(bad-json)', r6.status === 'invalid-response' && r6.reason === 'bad-json', { status: r6.status, reason: r6.reason });
const r6b = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/no-version.json` }) }).check();
check('缺 version → invalid-response(missing-version)', r6b.status === 'invalid-response' && r6b.reason === 'missing-version', r6b.reason);
const r6c = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/bad-checksum.json` }) }).check();
check('坏校验和 → invalid-response(bad-checksum)', r6c.status === 'invalid-response' && r6c.reason === 'bad-checksum', r6c.reason);
const r6d = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/github-draft.json` }) }).check();
check('draft 条目 → invalid-response(draft-entry)', r6d.status === 'invalid-response' && r6d.reason === 'draft-entry', r6d.reason);
check('非法响应的 ok 均为 false', [r6, r6b, r6c, r6d].every((r) => r.ok === false && r.upToDate === false), 'ok=false');

// ── 7. GitHub Releases 形态 ──
console.log('\n[7] GitHub Releases 形态');
const r7 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/github.json` }) }).check();
check('tag_name 解析为版本 v3.0.0 → update-available', r7.status === 'update-available' && r7.latestVersion === 'v3.0.0', { status: r7.status, latest: r7.latestVersion });
check('assets[0].browser_download_url 作为下载地址', r7.downloadUrl === `${base}/artifact.bin`, r7.downloadUrl);

// ── 8. 环境变量作为更新源 ──
console.log('\n[8] 环境变量更新源');
const r8 = await mk({ env: { CCARMY_UPDATE_FEED_URL: `${base}/feed/latest.json` } }).check();
check('settings 未配置时读 CCARMY_UPDATE_FEED_URL', r8.status === 'up-to-date' && r8.sourceOrigin === 'env', { status: r8.status, origin: r8.sourceOrigin });

// ── 9. 真实下载 + 校验 ──
console.log('\n[9] 下载（真实落盘 + sha256/size 校验）');
const dl1 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/newer.json` }) }).download();
check('status = downloaded', dl1.status === 'downloaded', { status: dl1.status, ok: dl1.ok });
check('verification = sha256+size 且 verified=true', dl1.verification === 'sha256+size' && dl1.verified === true, dl1.verification);
check('文件真的落盘且内容一致', !!dl1.filePath && fs.existsSync(dl1.filePath) && crypto.createHash('sha256').update(fs.readFileSync(dl1.filePath)).digest('hex') === ARTIFACT_SHA, { filePath: dl1.filePath, bytes: dl1.bytes });
check('installImplemented=false（安装明确未实现，不是空壳）', dl1.installImplemented === false && typeof dl1.installNotes === 'string', dl1.installNotes);
check('下载目录内无 .part 残留', fs.readdirSync(path.dirname(dl1.filePath)).every((f) => !f.endsWith('.part')), fs.readdirSync(path.dirname(dl1.filePath)));

// ── 10. 校验失败必须删掉半成品 ──
console.log('\n[10] 校验失败');
const dlDir2 = path.join(tmpRoot, 'updates-fail');
const dirOf = (v) => path.join(dlDir2, v);
const dirListing = (v) => (fs.existsSync(dirOf(v)) ? fs.readdirSync(dirOf(v)) : '(目录不存在)');
const dl2 = await mk({ downloadDir: dlDir2, getSettings: () => ({ updateFeedUrl: `${base}/feed/wrong-sha.json` }) }).download();
check('sha256 不符 → checksum-mismatch', dl2.status === 'checksum-mismatch', { status: dl2.status, actual: dl2.sha256, expected: dl2.expectedSha256 });
const afterSha = dirListing('2.0.0');
check('sha 校验失败后不留文件/半成品', Array.isArray(afterSha) && afterSha.length === 0, afterSha);
const dl3 = await mk({ downloadDir: dlDir2, getSettings: () => ({ updateFeedUrl: `${base}/feed/wrong-size.json` }) }).download();
check('size 不符 → size-mismatch', dl3.status === 'size-mismatch', { status: dl3.status, bytes: dl3.bytes, expected: dl3.expectedSize });
const afterSize = dirListing('2.0.0');
check('size 校验失败同样不留半成品', Array.isArray(afterSize) && afterSize.length === 0, afterSize);

// ── 11. 下载前置条件 ──
console.log('\n[11] 下载前置条件');
const dl4 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/no-url.json` }) }).download();
check('清单无下载地址 → no-download-url', dl4.status === 'no-download-url', dl4.status);
const dl5 = await mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/latest.json` }) }).download();
check('已是最新时不下载 → 透传 up-to-date', dl5.status === 'up-to-date' && dl5.downloadUrlPresent === false, dl5.status);
const dl6 = await mk().download();
check('未配置更新源 → not-configured', dl6.status === 'not-configured', dl6.status);

// ── 12. 状态文件落盘（可诊断） ──
console.log('\n[12] 状态文件');
const stateFile = path.join(downloadDir, 'update-state.json');
const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
check('update-state.json 记录 lastCheck', !!st.lastCheck && typeof st.lastCheck.status === 'string', st.lastCheck?.status);
check('记录 lastDownload', !!st.lastDownload && st.lastDownload.status === 'downloaded', st.lastDownload?.status);
const info = mk({ getSettings: () => ({ updateFeedUrl: `${base}/feed/newer.json` }) }).getSourceInfo();
check('getSourceInfo 报告已配置 + 上次结果', info.configured === true && info.origin === 'settings' && !!info.lastCheck, { url: info.url, last: info.lastCheck });

// ── 13. 版本比较工具 ──
console.log('\n[13] 版本比较');
check('1.0.0 < 1.0.1', compareVersions('1.0.0', '1.0.1') === -1);
check('v2.0.0 > 1.9.9', compareVersions('v2.0.0', '1.9.9') === 1);
check('1.0.0 == v1.0.0', compareVersions('1.0.0', 'v1.0.0') === 0);
check('1.0.0 > 1.0.0-beta.1', compareVersions('1.0.0', '1.0.0-beta.1') === 1);
check('非法版本返回 null', compareVersions('abc', '1.0.0') === null && parseVersion('abc') === null);

server.close();
console.log(`\n结论: ${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
console.log(`临时目录: ${tmpRoot}`);
console.log(`构件 sha256: ${ARTIFACT_SHA}`);
process.exit(failures === 0 ? 0 : 1);
