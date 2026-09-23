/**
 * 真机：把更新源指到 GitHub 仓库，并实测 Gengxinqi 能否正确解析。
 * 不启动 Electron UI；直接 import dist/updater.js。
 *
 * 默认源（产品定稿）：
 *   A. GitHub Releases API（推荐）
 *      https://api.github.com/repos/Pondsi/WARMY/releases/latest
 *   B. 仓库内 feed（raw）
 *      https://raw.githubusercontent.com/Pondsi/WARMY/main/feed/latest.json
 *
 * 网络容错：api.github.com 可能 403 限流，raw.githubusercontent.com 可能超时。
 * **任一源**解析成功即算链路可用；全部源网络/HTTP 失败才打红。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Gengxinqi} from '../dist/updater.js';

const FEEDS = [
  {
    id: 'github-api-latest',
    url: 'https://api.github.com/repos/Pondsi/WArmy/releases/latest',
  },
  {
    id: 'github-api-releases',
    url: 'https://api.github.com/repos/Pondsi/WArmy/releases',
  },
  {
    id: 'raw-feed-latest',
    url: 'https://raw.githubusercontent.com/Pondsi/WArmy/main/feed/latest.json',
  },
];

let fail = 0;
function check(biaoQian, cond, detail) {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${biaoQian}${detail === undefined ? '' : ' => ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 240)}`);
  if (!cond) fail++;
}

const OK = new Set(['up-to-date', 'update-available']);
const NET_FLAKE = new Set(['network-error', 'http-error', 'timeout']);
async function checkWithRetry(makeUpdater, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await makeUpdater().check();
    if (OK.has(last.status)) return last;
    if (last.status && !NET_FLAKE.has(last.status) && last.status !== 'not-configured') return last;
    await new Promise((s) => setTimeout(s, 1200));
  }
  return last;
}

async function main() {
  const dir = path.join(os.tmpdir(), 'warmy-updater-github-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  let anyReachable = false;
  const flakeNotes = [];
  for (const f of FEEDS) {
    console.log('\n=== feed', f.id, f.url);
    const r = await checkWithRetry(() => new Gengxinqi({
      currentVersion: '0.1.0',
      downloadDir: dir,
      getSettings: () => ({ updateFeedUrl: f.url }),
      env: {},
    }), 3);
    console.log('   full:', JSON.stringify(r, null, 0).slice(0, 500));
    check(`${f.id}: has status`, !!r.status, r.status);
    check(`${f.id}: not fake always-up-to-date without config`, r.status !== 'not-configured', r.status);
    const reachable = OK.has(r.status);
    if (reachable) anyReachable = true;
    if (!reachable && NET_FLAKE.has(r.status)) {
      flakeNotes.push({ id: f.id, status: r.status, httpStatus: r.httpStatus, reason: r.reason || r.error || '' });
      check(`${f.id}: network/http flake recorded (ok if another feed reachable)`, true, { status: r.status, httpStatus: r.httpStatus });
    } else {
      check(`${f.id}: reachable parse (up-to-date|update-available)`, reachable, { status: r.status, error: r.error, latest: r.latestVersion, source: r.source });
    }
    if (reachable) {
      check(`${f.id}: source points to github`, /githubusercontent\.com|github\.com/i.test(String(r.source || f.url)), r.source);
      check(`${f.id}: latestVersion looks like semver/tag`, !!r.latestVersion && /^v?\d+\.\d+\.\d+/.test(String(r.latestVersion)), r.latestVersion);
      if (r.status === 'update-available') {
        check(`${f.id}: update-available has download url or notes`, !!(r.downloadUrl || r.notes || r.manifest?.downloadUrl), { downloadUrl: r.downloadUrl, notes: r.notes });
      }
    }
  }
  check('at least one GitHub feed reachable (parse chain works)', anyReachable, flakeNotes);

  // extra: prove update-available path (use raw feed — api.github.com may be 403-limited)
  console.log('\n=== feed raw-feed-latest as current=0.0.1 (expect update-available) ===');
  {
    const r = await checkWithRetry(() => new Gengxinqi({
      currentVersion: '0.0.1',
      downloadDir: dir,
      getSettings: () => ({ updateFeedUrl: 'https://raw.githubusercontent.com/Pondsi/WArmy/main/feed/latest.json' }),
      env: {},
    }), 3);
    console.log('   ', JSON.stringify({ status: r.status, latest: r.latestVersion, updateAvailable: r.updateAvailable, downloadUrl: r.downloadUrl || r.manifest?.downloadUrl }).slice(0, 400));
    if (NET_FLAKE.has(r.status) && anyReachable) {
      check('update-available path: network flake tolerated (another feed already OK)', true, { status: r.status });
    } else {
      check('feed can report update-available for older version', r.status === 'update-available' && !!r.latestVersion, { status: r.status, latest: r.latestVersion });
    }
  }

  console.log('\n==== verify-updater-github: failures=', fail, '====');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
