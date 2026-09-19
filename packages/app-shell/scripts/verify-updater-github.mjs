/**
 * 真机：把更新源指到 GitHub 仓库，并实测 Updater 能否正确解析。
 * 不启动 Electron UI；直接 import dist/updater.js。
 *
 * 默认源（产品定稿）：
 *   A. GitHub Releases API（推荐）
 *      https://api.github.com/repos/Pondsi/WArmy/releases/latest
 *   B. 仓库内 feed（raw）
 *      https://raw.githubusercontent.com/Pondsi/WArmy/main/feed/latest.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Updater } from '../dist/updater.js';

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
function check(label, cond, detail) {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ' => ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 240)}`);
  if (!cond) fail++;
}

async function main() {
  const dir = path.join(os.tmpdir(), 'warmy-updater-github-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FEEDS) {
    console.log('\n=== feed', f.id, f.url);
    const up = new Updater({
      currentVersion: '0.1.0',
      downloadDir: dir,
      getSettings: () => ({ updateFeedUrl: f.url }),
      env: {},
    });
    const r = await up.check();
    console.log('   full:', JSON.stringify(r, null, 0).slice(0, 500));
    check(`${f.id}: has status`, !!r.status, r.status);
    check(`${f.id}: not fake always-up-to-date without config`, r.status !== 'not-configured', r.status);
    const okStatuses = ['up-to-date', 'update-available'];
    check(`${f.id}: reachable parse (up-to-date|update-available)`, okStatuses.includes(r.status), { status: r.status, error: r.error, latest: r.latestVersion, source: r.source });
    if (r.status === 'up-to-date' || r.status === 'update-available') {
      check(`${f.id}: source points to github`, /github\.com/i.test(String(r.source || f.url)), r.source);
      check(`${f.id}: latestVersion looks like semver/tag`, !!r.latestVersion && /^v?\d+\.\d+\.\d+/.test(String(r.latestVersion)), r.latestVersion);
    }
    if (r.status === 'update-available') {
      check(`${f.id}: update-available has download url or notes`, !!(r.downloadUrl || r.notes || r.manifest?.downloadUrl), { downloadUrl: r.downloadUrl, notes: r.notes });
    }
  }

  // extra: prove update-available path against real GitHub by pretending older currentVersion
  console.log('\n=== feed github-api-latest as current=0.0.1 (expect update-available) ===');
  {
    const up = new Updater({
      currentVersion: '0.0.1',
      downloadDir: dir,
      getSettings: () => ({ updateFeedUrl: 'https://api.github.com/repos/Pondsi/WArmy/releases/latest' }),
      env: {},
    });
    const r = await up.check();
    console.log('   ', JSON.stringify({ status: r.status, latest: r.latestVersion, updateAvailable: r.updateAvailable, downloadUrl: r.downloadUrl || r.manifest?.downloadUrl }).slice(0, 400));
    check('github feed can report update-available for older app', r.status === 'update-available' && !!r.latestVersion, { status: r.status, latest: r.latestVersion });
  }

  console.log('\n==== verify-updater-github: failures=', fail, '====');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
