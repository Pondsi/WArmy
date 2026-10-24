#!/usr/bin/env node
/**
 * WArmy MCP bridge — JSON-RPC 2.0 over a child process' stdin/stdout.
 *
 * Zero dependencies. Node ESM. Nothing here opens a socket.
 *
 * Protocol: MCP revision 2024-11-05, newline-delimited JSON (one JSON-RPC
 * message per line), which is what the MCP stdio transport specifies.
 *
 * Public API (importable):
 *   new StdioMcpClient({ command, args, env, cwd, timeoutMs, name })
 *   client.start() / client.initialize() / client.listTools() / client.callTool()
 *   client.listResources() / client.notify() / client.request() / client.close()
 *
 *   new McpBridge({ config, configPath }) -> .start() .toolSpecs() .callTool() .stop()
 *
 * CLI (this is how a WArmy agent actually reaches the tools today, because
 * WArmy's plugin UI only manages metadata — it does not execute plugin code):
 *   node bridge.mjs list   [--config <path>] [--json]
 *   node bridge.mjs tools  [--config <path>]        # OpenAI tool specs
 *   node bridge.mjs call <toolName> [jsonArgs | -] [--args-file <path>] [--config <path>]
 *
 * `--args-file` / `-` (stdin) exist because shells mangle inline JSON quotes.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JSONRPC_VERSION = '2.0';
export const PROTOCOL_VERSION = '2024-11-05';
export const PLUGIN_ID = 'mcp-bridge';
export const CLIENT_INFO = { name: 'warmy-mcp-bridge', version: '1.0.0' };

export const DEFAULT_TIMEOUT_MS = 30000;
export const INIT_TIMEOUT_MS = 20000;
export const MAX_STDERR_LINES = 40;
export const MAX_TOOL_NAME = 64;

/** JSON-RPC / transport level failure. `code` mirrors JSON-RPC error codes. */
export class McpError extends Error {
  constructor(message, { code = -32000, data, method, server } = {}) {
    super(String(message));
    this.name = 'McpError';
    this.code = code;
    if (data !== undefined) this.data = data;
    if (method) this.method = method;
    if (server) this.server = server;
  }
}

function clampText(v, max = 200) {
  const s = String(v == null ? '' : v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * One MCP server, spoken to over stdio.
 *
 * Spawn is `spawn(command, argsArray, { shell: false })` on purpose: no shell,
 * so no interpolation, no injection. argv is passed through as an array.
 */
export class StdioMcpClient {
  constructor(opts = {}) {
    this.name = String(opts.name || 'server');
    this.command = String(opts.command || '');
    this.args = Array.isArray(opts.args) ? opts.args.map(String) : [];
    this.cwd = opts.cwd ? path.resolve(String(opts.cwd)) : process.cwd();
    this.env = opts.env && typeof opts.env === 'object'
      ? { ...process.env, ...Object.fromEntries(Object.entries(opts.env).map(([k, v]) => [String(k), String(v)])) }
      : process.env;
    this.timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.maxLineBytes = 8 * 1024 * 1024;

    this.child = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrLines = [];
    this.protocolWarnings = [];
    this.closed = false;
    this.exited = null;

    this.serverInfo = null;
    this.protocolVersion = null;
    this.protocolVersionAccepted = null;
    this.capabilities = {};
  }

  start() {
    if (this.child) return this;
    if (!this.command) throw new McpError('mcp: "command" is required', { code: -32602, server: this.name });

    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.on('error', (e) => {
      this.closed = true;
      this.#failAll(new McpError(`spawn failed: ${e.message}`, { code: -32001, server: this.name }));
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      this.exited = { code, signal };
      this.#failAll(new McpError(`server exited (code=${code}, signal=${signal})`, { code: -32002, server: this.name }));
    });
    this.child.stderr.on('data', (buf) => this.#keepStderr(buf));
    // stderr is diagnostic only; drain it so a chatty server cannot block on a full pipe.
    this.child.stdin.on('error', () => { /* EPIPE handled by pending rejection */ });

    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.#onLine(line));
    return this;
  }

  #keepStderr(buf) {
    const text = String(buf).replace(/\r/g, '');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      this.stderrLines.push(clampText(line, 400));
      if (this.stderrLines.length > MAX_STDERR_LINES) this.stderrLines.shift();
    }
  }

  #onLine(line) {
    const raw = String(line || '').trim();
    if (!raw) return;
    if (raw.length > this.maxLineBytes) {
      this.protocolWarnings.push('line dropped: exceeds maxLineBytes');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Non-JSON chatter on stdout: keep a short trace instead of crashing.
      this.protocolWarnings.push(`non-JSON stdout line: ${clampText(raw, 120)}`);
      return;
    }
    if (!msg || typeof msg !== 'object') {
      this.protocolWarnings.push('non-object JSON-RPC message dropped');
      return;
    }

    const hasId = msg.id !== undefined && msg.id !== null;
    const isResponse = hasId && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'));

    if (isResponse) {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return; // late reply for a timed-out id — drop it
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) {
        waiter.reject(new McpError(
          String(msg.error.message || `error ${msg.error.code}`),
          { code: Number(msg.error.code) || -32000, data: msg.error.data, method: waiter.method, server: this.name },
        ));
      } else {
        waiter.resolve(msg.result);
      }
      return;
    }

    // Notification from the server (no id): nothing to answer.
    if (typeof msg.method === 'string' && !hasId) return;

    // Server -> client request. We advertise no sampling/roots support, so answer
    // with a clean "method not found" instead of leaving the server hanging.
    if (typeof msg.method === 'string' && hasId) {
      if (msg.method === 'ping') {
        this.#send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: {} });
      } else {
        this.#send({
          jsonrpc: JSONRPC_VERSION,
          id: msg.id,
          error: { code: -32601, message: `client does not implement ${msg.method}` },
        });
      }
    }
  }

  #send(msg) {
    if (!this.child || this.closed) throw new McpError('transport closed', { code: -32002, server: this.name });
    try {
      this.child.stdin.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      throw new McpError(`write failed: ${e.message}`, { code: -32003, server: this.name });
    }
  }

  #failAll(err) {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      this.pending.delete(id);
      waiter.reject(err);
    }
  }

  /** Send a request and await the matching `id` response, or time out. */
  request(method, params, { timeoutMs } = {}) {
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : this.timeoutMs;
    const id = this.nextId++;
    const msg = { jsonrpc: JSONRPC_VERSION, id, method };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`timeout after ${ms}ms: ${method}`, { code: -32000, method, server: this.name }));
      }, ms);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.#send(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof McpError ? e : new McpError(String(e && e.message), { code: -32003, method, server: this.name }));
      }
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: JSONRPC_VERSION, method };
    if (params !== undefined) msg.params = params;
    this.#send(msg);
  }

  async initialize({ clientInfo = CLIENT_INFO, capabilities } = {}) {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: capabilities || { roots: { listChanged: false } },
      clientInfo,
    }, { timeoutMs: Math.max(INIT_TIMEOUT_MS, this.timeoutMs) });

    this.serverInfo = result && result.serverInfo ? result.serverInfo : null;
    this.protocolVersion = result && result.protocolVersion ? String(result.protocolVersion) : '';
    this.protocolVersionAccepted = this.protocolVersion === PROTOCOL_VERSION;
    this.capabilities = (result && result.capabilities) || {};
    if (!this.protocolVersionAccepted) {
      this.protocolWarnings.push(`server negotiated protocol ${this.protocolVersion || '(none)'} instead of ${PROTOCOL_VERSION}`);
    }
    await this.notify('notifications/initialized');
    return result;
  }

  async listTools() {
    const result = await this.request('tools/list', {});
    const tools = result && Array.isArray(result.tools) ? result.tools : [];
    return tools;
  }

  async callTool(name, args, { timeoutMs } = {}) {
    const result = await this.request('tools/call', { name: String(name), arguments: args && typeof args === 'object' ? args : {} }, { timeoutMs });
    return result || {};
  }

  /** resources/list is optional in MCP: a server may not implement it. */
  async listResources() {
    try {
      const result = await this.request('resources/list', {});
      return Array.isArray(result && result.resources) ? result.resources : [];
    } catch (e) {
      if (e instanceof McpError && (e.code === -32601 || e.code === -32602)) return [];
      throw e;
    }
  }

  async readResource(uri) {
    const result = await this.request('resources/read', { uri: String(uri) });
    return result && Array.isArray(result.contents) ? result.contents : [];
  }

  close() {
    try { this.rl && this.rl.close(); } catch { /* noop */ }
    this.#failAll(new McpError('client closed', { code: -32002, server: this.name }));
    this.closed = true;
    const child = this.child;
    if (!child) return;
    try { child.stdin.end(); } catch { /* noop */ }
    const kill = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, 500);
    if (typeof kill.unref === 'function') kill.unref();
    child.once('exit', () => clearTimeout(kill));
  }
}

/** Flatten MCP `content` blocks into plain text an LLM can read. */
export function contentToText(result) {
  if (!result || typeof result !== 'object') return '';
  const blocks = Array.isArray(result.content) ? result.content : [];
  if (!blocks.length) {
    if (typeof result.text === 'string') return result.text;
    return result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : '';
  }
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text') parts.push(String(b.text == null ? '' : b.text));
    else if (b.type === 'image') parts.push(`[image ${b.mimeType || 'unknown'} ${Math.ceil(String(b.data || '').length * 0.75)} bytes]`);
    else if (b.type === 'audio') parts.push(`[audio ${b.mimeType || 'unknown'}]`);
    else if (b.type === 'resource') {
      const r = b.resource || {};
      parts.push(typeof r.text === 'string' ? r.text : `[resource ${r.uri || ''}]`);
    } else parts.push(`[${b.type || 'unknown'} block]`);
  }
  return parts.join('\n');
}

/** `mcp__<server>__<tool>` — safe for the OpenAI/Anthropic function-name charset. */
export function qualifiedToolName(serverName, toolName) {
  const clean = (s, max) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  const s = clean(serverName, 24) || 'server';
  const t = clean(toolName, MAX_TOOL_NAME - s.length - 7) || 'tool';
  return `mcp__${s}__${t}`.slice(0, MAX_TOOL_NAME);
}

export function defaultConfigPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-servers.json');
}

export function resolveConfigPath(explicit) {
  const given = explicit || process.env.WARMY_MCP_CONFIG || '';
  if (given) return path.resolve(given.replace(/^~(?=$|[\\/])/, os.homedir()));
  const local = defaultConfigPath();
  if (fs.existsSync(local)) return local;
  return path.join(os.homedir(), '.warmy', 'mcp-servers.json');
}

/** Editors on Windows happily prepend a UTF-8 BOM; JSON.parse chokes on it. */
export function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

/** Load + shape-check `mcp-servers.json`. Missing file is not fatal: empty config. */
export function loadConfig(configPath) {
  const p = resolveConfigPath(configPath);
  if (!fs.existsSync(p)) return { path: p, exists: false, servers: {} };
  let raw;
  try {
    raw = readJsonFile(p);
  } catch (e) {
    throw new McpError(`mcp-servers.json is not valid JSON: ${e.message}`, { code: -32602 });
  }
  const servers = raw && typeof raw.servers === 'object' && raw.servers ? raw.servers : {};
  return { path: p, exists: true, servers };
}

/**
 * Multi-server bridge. One tool registry, one call surface.
 *
 * A server that fails to start is recorded in `errors` and skipped; it never
 * takes the healthy servers down with it.
 */
export class McpBridge {
  constructor({ config, configPath, clientInfo, timeoutMs } = {}) {
    this.configPath = resolveConfigPath(configPath);
    this.config = config || loadConfig(this.configPath);
    this.clientInfo = clientInfo || CLIENT_INFO;
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.clients = new Map();
    this.tools = [];
    this.errors = [];
  }

  async start() {
    const entries = Object.entries(this.config.servers || {});
    for (const [name, spec] of entries) {
      if (!spec || typeof spec !== 'object') {
        this.errors.push({ server: name, error: 'spec is not an object' });
        continue;
      }
      if (spec.enabled === false) continue;
      try {
        const client = new StdioMcpClient({
          name,
          command: spec.command,
          args: spec.args,
          env: spec.env,
          cwd: spec.cwd,
          timeoutMs: Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : this.timeoutMs,
        });
        client.start();
        await client.initialize({ clientInfo: this.clientInfo });
        const tools = await client.listTools();
        const used = new Set(this.tools.map((t) => t.qualifiedName));
        for (const tool of tools) {
          if (!tool || typeof tool.name !== 'string') continue;
          let qn = qualifiedToolName(name, tool.name);
          if (used.has(qn)) qn = `${qn}_${this.tools.length}`.slice(0, MAX_TOOL_NAME);
          used.add(qn);
          this.tools.push({
            qualifiedName: qn,
            server: name,
            tool: tool.name,
            description: String(tool.description || ''),
            inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', properties: {}, required: [] },
            annotations: tool.annotations,
          });
        }
        this.clients.set(name, client);
      } catch (e) {
        this.errors.push({ server: name, error: String(e && e.message ? e.message : e), code: e && e.code });
      }
    }
    return this;
  }

  /** WArmy/OpenAI function-calling shape: { type:'function', function:{ name, description, parameters } } */
  toolSpecs() {
    return this.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.qualifiedName,
        description: `[MCP:${t.server}] ${t.description || t.tool}`.trim(),
        parameters: t.inputSchema,
      },
    }));
  }

  status() {
    return {
      ok: this.errors.length === 0,
      configPath: this.configPath,
      protocolVersion: PROTOCOL_VERSION,
      servers: [...this.clients.keys()].map((name) => {
        const c = this.clients.get(name);
        return {
          name,
          serverInfo: c.serverInfo,
          protocolVersion: c.protocolVersion,
          protocolVersionAccepted: c.protocolVersionAccepted,
          tools: this.tools.filter((t) => t.server === name).length,
          warnings: c.protocolWarnings.slice(0, 5),
          stderrTail: c.stderrLines.slice(-5),
        };
      }),
      errors: this.errors,
    };
  }

  /** Call by qualified name. Returns a normalized, model-friendly envelope. */
  async callTool(qualifiedName, args, { timeoutMs } = {}) {
    const entry = this.tools.find((t) => t.qualifiedName === qualifiedName)
      || this.tools.find((t) => t.tool === qualifiedName);
    if (!entry) {
      return { ok: false, error: `unknown tool: ${qualifiedName}`, code: -32602, known: this.tools.map((t) => t.qualifiedName) };
    }
    const client = this.clients.get(entry.server);
    if (!client) return { ok: false, error: `server not connected: ${entry.server}`, code: -32002 };
    try {
      const raw = await client.callTool(entry.tool, args, { timeoutMs });
      const isError = raw.isError === true;
      return {
        ok: !isError,
        server: entry.server,
        tool: entry.tool,
        qualifiedName: entry.qualifiedName,
        text: contentToText(raw),
        isError,
        content: Array.isArray(raw.content) ? raw.content : [],
        structured: raw.structuredContent,
      };
    } catch (e) {
      return {
        ok: false,
        server: entry.server,
        tool: entry.tool,
        qualifiedName: entry.qualifiedName,
        error: String(e && e.message ? e.message : e),
        code: e && e.code,
        data: e && e.data,
      };
    }
  }

  /** Optional MCP surface. Servers that do not implement it return an empty list. */
  async listResources() {
    const out = [];
    for (const [name, client] of this.clients) {
      try {
        for (const r of await client.listResources()) out.push({ server: name, ...r });
      } catch (e) {
        this.errors.push({ server: name, error: `resources/list: ${e && e.message}` });
      }
    }
    return out;
  }

  stop() {
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
  }
}

// ─────────────────────────── CLI ───────────────────────────

function parseFlags(argv) {
  const out = { _: [], config: '', argsFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') { out.config = argv[++i] || ''; continue; }
    if (a === '--args-file') { out.argsFile = argv[++i] || ''; continue; }
    if (a === '--json') { out.json = true; continue; }
    out._.push(a);
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

/**
 * Tool arguments as a JSON object.
 *
 * Shell quoting mangles inline JSON on Windows (`'{"a":1}'` arrives as `{a:1}`),
 * so a file or stdin is the reliable path: `--args-file path.json` or `-`.
 */
async function resolveToolArgs(flags) {
  if (flags.argsFile) {
    const p = path.resolve(flags.argsFile);
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  }
  const inline = flags._[2];
  if (inline === '-') return JSON.parse((await readStdin()).replace(/^\uFEFF/, '') || '{}');
  if (!inline) return {};
  return JSON.parse(inline);
}

async function main(argv) {
  const flags = parseFlags(argv);
  const cmd = flags._[0] || 'list';
  const bridge = new McpBridge({ configPath: flags.config });
  try {
    await bridge.start();
    if (cmd === 'list') {
      const rows = bridge.tools.map((t) => ({
        name: t.qualifiedName,
        server: t.server,
        tool: t.tool,
        description: t.description,
      }));
      if (flags.json) {
        process.stdout.write(JSON.stringify({ ok: bridge.errors.length === 0, configPath: bridge.configPath, tools: rows, status: bridge.status() }, null, 2) + '\n');
      } else {
        process.stdout.write(`config: ${bridge.configPath}\n`);
        process.stdout.write(`servers: ${[...bridge.clients.keys()].join(', ') || '(none)'}\n`);
        for (const r of rows) process.stdout.write(`  ${r.name}  — ${r.description || r.tool}\n`);
        for (const e of bridge.errors) process.stdout.write(`  ! ${e.server}: ${e.error}\n`);
      }
      return bridge.errors.length ? 2 : 0;
    }
    if (cmd === 'tools') {
      process.stdout.write(JSON.stringify({ tools: bridge.toolSpecs() }, null, 2) + '\n');
      return bridge.errors.length ? 2 : 0;
    }
    if (cmd === 'call') {
      const toolName = flags._[1];
      if (!toolName) {
        process.stderr.write('usage: node bridge.mjs call <toolName> [jsonArgs]\n');
        return 64;
      }
      let argsRaw = {};
      try {
        argsRaw = await resolveToolArgs(flags);
      } catch (e) {
        process.stderr.write(`tool arguments are not a valid JSON object: ${e.message}\n`);
        process.stderr.write('hint: on Windows pass `--args-file args.json` or pipe JSON with `-`\n');
        return 64;
      }
      if (!argsRaw || typeof argsRaw !== 'object' || Array.isArray(argsRaw)) {
        process.stderr.write('tool arguments must be a JSON object\n');
        return 64;
      }
      const r = await bridge.callTool(toolName, argsRaw);
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return r.ok ? 0 : 1;
    }
    process.stderr.write(`unknown command: ${cmd}\n`);
    return 64;
  } finally {
    bridge.stop();
  }
}

const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { return false; }
})();

if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`mcp-bridge failed: ${e && e.stack ? e.stack : e}\n`);
      process.exit(1);
    });
}
