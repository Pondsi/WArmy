#!/usr/bin/env node
/**
 * Apply default GitHub update feed to WArmy settings.json (userData).
 * Writes updateFeedUrl = GitHub Releases API. Safe if settings missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FEED = 'https://api.github.com/repos/Pondsi/WArmy/releases/latest';
const candidates = [
  path.join(process.env.APPDATA || '', '无限牛马'),
  path.join(process.env.APPDATA || '', 'warmy'),
  path.join(process.env.APPDATA || '', 'WArmy'),
  path.join(process.env.APPDATA || '', 'Electron'),
];

let hit = null;
for (const dir of candidates) {
  const f = path.join(dir, 'settings.json');
  if (fs.existsSync(f)) { hit = f; break; }
  // maybe nested
  try {
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name, 'settings.json');
        if (fs.existsSync(p)) { hit = p; break; }
      }
    }
  } catch { /* noop */ }
  if (hit) break;
}

if (!hit) {
  // create in 无限牛马 profile
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '无限牛马');
  fs.mkdirSync(dir, { recursive: true });
  hit = path.join(dir, 'settings.json');
  const seed = { updateFeedUrl: FEED, locale: 'zh-CN' };
  fs.writeFileSync(hit, JSON.stringify(seed, null, 2), 'utf8');
  console.log('created', hit, seed);
} else {
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(hit, 'utf8')); } catch { obj = {}; }
  obj.updateFeedUrl = FEED;
  fs.writeFileSync(hit, JSON.stringify(obj, null, 2), 'utf8');
  console.log('updated', hit, 'updateFeedUrl=', FEED);
}
