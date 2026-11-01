#!/usr/bin/env node
/**
 * Install this plugin into WArmy's default plugin scan directory.
 *
 *   node seed.mjs                                  # probe the usual user-data dirs and copy
 *   node seed.mjs --target "<dir>\scan-dirs\plugins"
 *   node seed.mjs --target ... --settings "<dir>\settings.json"   # also seed chaJianJi entry (disabled)
 *   node seed.mjs --target ... --dry-run
 *
 * WArmy creates `<userData>/scan-dirs/plugins` itself (see `moRenSaoMiaoLuJing`),
 * so seeding is only about dropping the folder where the scanner looks.
 * Nothing here touches the app bundle.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = 'mcp-bridge';
const PACKAGE_NAME = 'warmy-plugin-mcp-bridge';
/** Copy whitelist — seed.mjs itself stays behind. */
const FILES = [
  'package.json',
  'plugin.json',
  'bridge.mjs',
  'echo-server.mjs',
  'selftest.mjs',
  'README.md',
  'mcp-servers.json.example',
];

function parseArgs(argv) {
  const out = { target: '', settings: '', enable: false, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i] || '';
    else if (a === '--settings') out.settings = argv[++i] || '';
    else if (a === '--enable') out.enable = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/** Likely `userData` roots, most specific first. We only accept ones that already exist. */
function userDataCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      process.env.WARMY_USER_DATA,
      path.join(appData, 'WARMY'),
      path.join(appData, 'warmy'),
      path.join(appData, 'Warmy'),
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      process.env.WARMY_USER_DATA,
      path.join(home, 'Library', 'Application Support', 'WARMY'),
      path.join(home, 'Library', 'Application Support', 'warmy'),
    ].filter(Boolean);
  }
  return [
    process.env.WARMY_USER_DATA,
    path.join(home, '.config', 'WARMY'),
    path.join(home, '.config', 'warmy'),
  ].filter(Boolean);
}

function resolveTarget(explicit) {
  if (explicit) {
    const p = path.resolve(explicit);
    return p.replace(/[\\/]+$/, '');
  }
  for (const ud of userDataCandidates()) {
    if (!ud) continue;
    if (fs.existsSync(ud)) return path.join(ud, 'scan-dirs', 'plugins');
  }
  return '';
}

function seedSettings(settingsPath, { enable }) {
  const p = path.resolve(settingsPath);
  if (!fs.existsSync(p)) return { ok: false, error: `settings file not found: ${p}` };
  let raw;
  try {
    // Windows editors often prepend a UTF-8 BOM; JSON.parse would reject it.
    raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { ok: false, error: `settings.json is not valid JSON: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'settings.json is not an object' };
  const list = Array.isArray(raw.chaJianJi) ? raw.chaJianJi : [];
  const entry = {
    id: PLUGIN_ID,
    ming: PACKAGE_NAME,
    desc: 'Bridge MCP stdio servers into WArmy agents as ordinary tools.',
    enabled: enable === true,
    source: 'discovered',
  };
  const idx = list.findIndex((x) => x && x.id === PLUGIN_ID);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  raw.chaJianJi = list;

  fs.copyFileSync(p, `${p}.mcp-bridge.bak`);
  const tmp = `${p}.mcp-bridge.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2));
  fs.renameSync(tmp, p);
  return { ok: true, path: p, entry, backup: `${p}.mcp-bridge.bak`, created: idx < 0 };
}

function copyPlugin(target, { dryRun, force }) {
  const dest = path.join(target, PLUGIN_ID);
  if (fs.existsSync(path.join(dest, 'package.json')) && !force) {
    return { dest, copied: [], existed: true };
  }
  const copied = [];
  for (const f of FILES) {
    const from = path.join(HERE, f);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, f);
    if (!dryRun) {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(from, to);
    }
    copied.push(f);
  }
  const example = path.join(HERE, 'mcp-servers.json.example');
  const config = path.join(dest, 'mcp-servers.json');
  if (fs.existsSync(example) && !fs.existsSync(config)) {
    if (!dryRun) fs.copyFileSync(example, config);
    copied.push('mcp-servers.json (from .example)');
  }
  return { dest, copied, existed: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node seed.mjs [--target <pluginScanDir>] [--settings <settings.json>] [--enable] [--dry-run] [--force]');
    return 0;
  }
  const target = resolveTarget(args.target);
  if (!target) {
    console.error('Could not find WArmy userData. Pass --target explicitly, e.g.\n'
      + '  node seed.mjs --target "%APPDATA%\\WARMY\\scan-dirs\\plugins"\n'
      + 'probed: ' + userDataCandidates().filter(Boolean).join(', '));
    return 1;
  }

  console.log(`target: ${target}${args.dryRun ? ' (dry run)' : ''}`);
  if (!fs.existsSync(target) && !args.dryRun) fs.mkdirSync(target, { recursive: true });

  const r = copyPlugin(target, args);
  if (r.existed) {
    console.log(`already installed at ${r.dest} — pass --force to overwrite (nothing copied)`);
  } else {
    console.log(`copied ${r.copied.length} files to ${r.dest}`);
    for (const f of r.copied) console.log(`  + ${f}`);
  }

  if (args.settings) {
    if (args.dryRun) {
      console.log(`would seed chaJianJi entry { id: "${PLUGIN_ID}", enabled: ${args.enable === true} } in ${args.settings}`);
    } else {
      const s = seedSettings(args.settings, args);
      if (!s.ok) {
        console.error(`settings seeding skipped: ${s.error}`);
      } else {
        console.log(`seeded chaJianJi entry in ${s.path} (enabled: ${s.entry.enabled}, backup: ${s.backup})`);
      }
    }
  } else {
    console.log(`plugin enable state is NOT set by this script. See README "Enable / disable" —`);
    console.log(`default is disabled (defaultEnabled: false in package.json/plugin.json).`);
  }

  console.log('\nNext: copy mcp-servers.json.example -> mcp-servers.json and edit it, then');
  console.log(`  node "${path.join(target, PLUGIN_ID, 'bridge.mjs')}" list`);
  return 0;
}

process.exit(main());
