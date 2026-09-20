#!/usr/bin/env node
/**
 * Optional: download official Node runtime into resources/node/<platform>/
 * Repo does not vendor multi-OS node tarballs by default (GitHub 50MB warning).
 *
 * Usage:
 *   node scripts/fetch-node-runtime.mjs
 *   NODE_VERSION=24.20.0 node scripts/fetch-node-runtime.mjs
 *
 * Then packaging / memory child can use resources/node/.../node.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.env.NODE_VERSION || '24.20.0';
const platform = process.platform;
const arch = process.arch;
const key = platform === 'win32' ? `win-${arch}` : `${platform}-${arch}`;
const ext = platform === 'win32' ? 'zip' : 'tar.gz';
const name = platform === 'win32'
  ? `node-v${VERSION}-win-${arch}`
  : `node-v${VERSION}-${platform}-${arch}`;
const url = `https://nodejs.org/dist/v${VERSION}/${name}.${ext}`;
const destDir = path.join(ROOT, 'resources', 'node', key);
const destFile = path.join(destDir, `${name}.${ext}`);

function get(u) {
  return new Promise((resolve, reject) => {
    https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(destDir, { recursive: true });
  const nodeBin = path.join(destDir, platform === 'win32' ? 'node.exe' : 'bin/node');
  if (fs.existsSync(nodeBin)) {
    console.log('already present:', nodeBin);
    return;
  }
  console.log('download', url);
  const res = await get(url);
  await pipeline(res, createWriteStream(destFile));
  console.log('saved', destFile, fs.statSync(destFile).size);
  if (platform === 'win32') {
    try {
      execFileSync('tar', ['-xf', destFile, '-C', destDir], { stdio: 'inherit' });
    } catch {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${destFile}' '${destDir}'`], { stdio: 'inherit' });
    }
  } else {
    execFileSync('tar', ['-xzf', destFile, '-C', destDir], { stdio: 'inherit' });
  }
  console.log('extracted under', destDir);
  console.log('note: place/use node binary path in packaging scripts as needed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
