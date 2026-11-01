#!/usr/bin/env node
/**
 * Self-test for the WArmy MCP bridge. No network, no external deps.
 *
 *   node selftest.mjs
 *
 * Spawns ./echo-server.mjs and asserts a full round trip:
 * discovery marker -> initialize -> notifications/initialized -> tools/list ->
 * tools/call -> resources/list -> error codes -> timeout + id matching ->
 * OpenAI tool-spec registry shape -> config-file loading.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  McpBridge,
  McpError,
  PROTOCOL_VERSION,
  StdioMcpClient,
  contentToText,
  loadConfig,
  qualifiedToolName,
} from './bridge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER = path.join(HERE, 'echo-server.mjs');

let pass = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

/**
 * Verbatim predicate from packages/app-shell/src/electron-main.ts
 * (`looksLikeWarmyPlugin`, ~line 17408) and the scandir gate in the
 * `warmy:chaJianJiSaoMiao` handler: a plugin dir needs package.json and the
 * package must match warmy|plugin by name, dependency, field or keyword.
 */
function looksLikeWarmyPlugin(pkgPath) {
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const ming = String(j.name || '');
    const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
    const yilaiMingzhong = Object.keys(deps).some((k) => /warmy|plugin/i.test(k));
    const ziduanMingzhong = 'warmy' in j || 'warmyPlugin' in j
      || (Array.isArray(j.keywords) && j.keywords.some((k) => /warmy|plugin/i.test(String(k))));
    const mingMingzhong = /warmy|plugin/i.test(ming);
    return { ok: mingMingzhong || yilaiMingzhong || ziduanMingzhong, ming, desc: String(j.description || '') };
  } catch {
    return { ok: false };
  }
}

/** Run `node bridge.mjs <args>` and capture output. stdinText is optional. */
function runCli(cliArgs, stdinText) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, 'bridge.mjs'), ...cliArgs], {
      cwd: HERE,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e.message) }));
    if (stdinText !== undefined) child.stdin.end(stdinText);
    else child.stdin.end();
  });
}

async function main() {
  console.log(`node ${process.version} on ${process.platform}`);
  console.log(`plugin dir: ${HERE}\n`);

  // ── 1. Discovery / default-disabled markers ──────────────────────────────
  const pkgPath = path.join(HERE, 'package.json');
  const manifestPath = path.join(HERE, 'plugin.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const recognized = looksLikeWarmyPlugin(pkgPath);
  check('discovery: package.json recognized by WArmy scanner predicate', recognized.ok === true, recognized);
  eq('discovery: plugin id', recognized.ming, 'warmy-plugin-mcp-bridge');
  check('discovery: warmyPlugin field present', !!pkg.warmyPlugin && pkg.warmyPlugin.id === 'mcp-bridge');
  check('disabled-by-default: package.json defaultEnabled === false', pkg.defaultEnabled === false, pkg.defaultEnabled);
  check('disabled-by-default: warmyPlugin.defaultEnabled === false', pkg.warmyPlugin.defaultEnabled === false);
  check('disabled-by-default: plugin.json defaultEnabled === false', manifest.defaultEnabled === false);
  check('disabled-by-default: plugin.json enabled === false', manifest.enabled === false);
  eq('manifest: protocol version', manifest.protocolVersion, '2024-11-05');

  // ── 2. initialize / tools/list / tools/call over stdio ───────────────────
  const client = new StdioMcpClient({
    name: 'echo',
    command: process.execPath,
    args: [ECHO_SERVER],
    timeoutMs: 8000,
  });
  client.start();

  const init = await client.initialize();
  eq('initialize: protocolVersion', init.protocolVersion, PROTOCOL_VERSION);
  eq('initialize: serverInfo.name', init.serverInfo && init.serverInfo.name, 'warmy-echo-server');
  check('initialize: protocol version accepted', client.protocolVersionAccepted === true);
  check('initialize: tools capability advertised', !!(init.capabilities && init.capabilities.tools));

  const tools = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  eq('tools/list: tool names', toolNames, ['add', 'echo', 'slow']);
  check('tools/list: every tool carries an object inputSchema',
    tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object' && t.inputSchema.type === 'object'));

  const echoResult = await client.callTool('echo', { message: 'hello warmy' });
  eq('tools/call echo: text', contentToText(echoResult), 'pong:hello warmy');
  check('tools/call echo: isError false', echoResult.isError === false);

  const addResult = await client.callTool('add', { a: 1, b: 2 });
  eq('tools/call add: text', contentToText(addResult), '3');

  // ── 3. Error objects ─────────────────────────────────────────────────────
  let methodErr = null;
  try { await client.request('no/such/method', {}); } catch (e) { methodErr = e; }
  check('error: unknown method rejects with McpError', methodErr instanceof McpError, methodErr && methodErr.message);
  eq('error: unknown method code -32601', methodErr && methodErr.code, -32601);

  let toolErr = null;
  try { await client.callTool('nope', {}); } catch (e) { toolErr = e; }
  check('error: unknown tool code -32602', toolErr && toolErr.code === -32602, toolErr && toolErr.code);

  // ── 4. Timeout + id matching after timeout ───────────────────────────────
  const t0 = Date.now();
  let timeoutErr = null;
  try {
    await client.callTool('slow', { ms: 1500 }, { timeoutMs: 250 });
  } catch (e) {
    timeoutErr = e;
  }
  const elapsed = Date.now() - t0;
  check('timeout: slow tool rejects with -32000', timeoutErr instanceof McpError && timeoutErr.code === -32000, timeoutErr && timeoutErr.code);
  check('timeout: fires near the 250ms budget', elapsed >= 200 && elapsed < 1200, { elapsed });

  const afterTimeout = await client.callTool('echo', { message: 'still alive' });
  eq('timeout: client still answers after a timed-out id', contentToText(afterTimeout), 'pong:still alive');

  // ── 5. Optional resources surface ────────────────────────────────────────
  const resources = await client.listResources();
  eq('resources/list: one resource', resources.length, 1);
  eq('resources/list: uri', resources[0] && resources[0].uri, 'echo://greeting');
  const contents = await client.readResource('echo://greeting');
  eq('resources/read: text', contents[0] && contents[0].text, 'hello from warmy echo server');

  client.close();

  // ── 6. Bridge: OpenAI-shaped registry + call routing ─────────────────────
  const bridge = new McpBridge({
    config: {
      servers: {
        echo: { command: process.execPath, args: [ECHO_SERVER], cwd: HERE, enabled: true, timeoutMs: 8000 },
        broken: { command: path.join(HERE, 'definitely-not-a-binary-xyz'), args: [], enabled: true },
        off: { command: process.execPath, args: [ECHO_SERVER], enabled: false },
      },
    },
  });
  await bridge.start();

  const specs = bridge.toolSpecs();
  eq('bridge: one spec per tool', specs.length, 3);
  check('bridge: specs use the OpenAI function shape',
    specs.every((s) => s.type === 'function' && s.function && typeof s.function.parameters === 'object'));
  check('bridge: qualified names are tool-name safe',
    specs.every((s) => /^[a-zA-Z0-9_-]{1,64}$/.test(s.function.name)),
    specs.map((s) => s.function.name));
  check('bridge: qualified name format', specs.some((s) => s.function.name === 'mcp__echo__echo'), specs.map((s) => s.function.name));
  check('bridge: disabled server is not started', !bridge.clients.has('off'));
  check('bridge: broken server recorded without killing the healthy one',
    bridge.errors.length === 1 && bridge.errors[0].server === 'broken', bridge.errors);
  check('bridge: healthy server still connected', bridge.clients.has('echo'));

  const bridged = await bridge.callTool('mcp__echo__add', { a: 20, b: 22 });
  check('bridge: call through qualified name', bridged.ok === true && bridged.text === '42', bridged);
  const unknown = await bridge.callTool('mcp__echo__missing', {});
  check('bridge: unknown qualified tool returns a structured error', unknown.ok === false && unknown.code === -32602, unknown);
  bridge.stop();

  // ── 7. Config file loading ───────────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-mcp-'));
  const cfgPath = path.join(tmp, 'mcp-servers.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    version: 1,
    servers: { echo: { command: process.execPath, args: [ECHO_SERVER], enabled: true, timeoutMs: 8000 } },
  }, null, 2));
  const loaded = loadConfig(cfgPath);
  check('config: file loaded', loaded.exists === true && !!loaded.servers.echo);
  const fromFile = new McpBridge({ configPath: cfgPath });
  await fromFile.start();
  const listed = await fromFile.callTool('mcp__echo__echo', { message: 'from config' });
  eq('config: call via config file', listed.text, 'pong:from config');
  fromFile.stop();

  // Relative `args` + `cwd` resolution is the documented example shape.
  const relCfg = path.join(tmp, 'relative.json');
  fs.writeFileSync(relCfg, JSON.stringify({
    servers: { echo: { command: process.execPath, args: [ECHO_SERVER], cwd: HERE, enabled: true } },
  }));
  const relBridge = new McpBridge({ configPath: relCfg });
  await relBridge.start();
  check('config: relative cwd server starts', relBridge.clients.has('echo'), relBridge.errors);
  relBridge.stop();

  const badCfg = path.join(tmp, 'broken.json');
  fs.writeFileSync(badCfg, '{ this is not json');
  let badErr = null;
  try { loadConfig(badCfg); } catch (e) { badErr = e; }
  check('config: invalid JSON throws McpError', badErr instanceof McpError, badErr && badErr.message);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ── 8. Name sanitization edge cases ─────────────────────────────────────
  eq('naming: sanitizes spaces and dots', qualifiedToolName('My Server', 'read.file'), 'mcp__my_server__read_file');
  check('naming: never exceeds 64 chars', qualifiedToolName('s'.repeat(80), 't'.repeat(80)).length <= 64);

  // ── 9. CLI end-to-end (the path a WArmy agent actually uses) ────────────
  const cliTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-mcp-cli-'));
  const cliCfg = path.join(cliTmp, 'mcp-servers.json');
  // BOM on purpose: Windows editors add one and JSON.parse rejects it raw.
  fs.writeFileSync(cliCfg, '\uFEFF' + JSON.stringify({
    servers: { echo: { command: process.execPath, args: [ECHO_SERVER], enabled: true, timeoutMs: 8000 } },
  }));
  const argsFile = path.join(cliTmp, 'args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ a: 4, b: 2 }));

  const toolsRun = await runCli(['tools', '--config', cliCfg]);
  check('cli tools: exit 0', toolsRun.code === 0, { code: toolsRun.code, stderr: toolsRun.stderr });
  let toolsJson = null;
  try { toolsJson = JSON.parse(toolsRun.stdout); } catch { toolsJson = null; }
  check('cli tools: emits a tools array', !!toolsJson && Array.isArray(toolsJson.tools) && toolsJson.tools.length === 3,
    toolsJson && toolsJson.tools && toolsJson.tools.length);

  const callRun = await runCli(['call', 'mcp__echo__add', '--args-file', argsFile, '--config', cliCfg]);
  const callJson = (() => { try { return JSON.parse(callRun.stdout); } catch { return null; } })();
  check('cli call: exit 0 via --args-file', callRun.code === 0, { code: callRun.code, stderr: callRun.stderr });
  eq('cli call: text', callJson && callJson.text, '6');

  const badCall = await runCli(['call', 'mcp__echo__nope', '{}', '--config', cliCfg]);
  check('cli call: unknown tool exits 1', badCall.code === 1, { code: badCall.code });

  const stdinCall = await runCli(['call', 'mcp__echo__echo', '-', '--config', cliCfg], JSON.stringify({ message: 'via stdin' }));
  const stdinJson = (() => { try { return JSON.parse(stdinCall.stdout); } catch { return null; } })();
  eq('cli call: JSON args via stdin', stdinJson && stdinJson.text, 'pong:via stdin');
  fs.rmSync(cliTmp, { recursive: true, force: true });

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  if (failures.length) {
    console.log(`FAILED ${failures.length} / ${pass + failures.length}`);
    for (const f of failures) console.log(`  - ${f.name} ${f.detail === undefined ? '' : JSON.stringify(f.detail)}`);
    process.exit(1);
  }
  console.log(`ALL PASS — ${pass}/${pass} checks`);
}

main().catch((e) => {
  console.error('selftest crashed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
