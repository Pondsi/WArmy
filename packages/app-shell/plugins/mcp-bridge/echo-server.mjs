#!/usr/bin/env node
/**
 * Tiny MCP server used by selftest.mjs and by mcp-servers.json.example.
 * Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, protocol 2024-11-05.
 *
 *   node echo-server.mjs
 *
 * Tools: echo, add, slow (deliberate delay, for timeout tests).
 */
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the given message, prefixed with "pong:".',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo back.' } },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum as text.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'slow',
    description: 'Wait `ms` milliseconds, then answer. Used to test client timeouts.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number' } },
      required: ['ms'],
    },
  },
];

const RESOURCES = [
  { uri: 'echo://greeting', name: 'greeting', mimeType: 'text/plain', description: 'A static greeting.' },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text: String(text) }], isError };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function handle(msg) {
  const hasId = msg.id !== undefined && msg.id !== null;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  // Notifications from the client (initialized, cancelled, ...) carry no reply.
  if (!hasId) return;

  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: 'warmy-echo-server', version: '1.0.0' },
      });

    case 'ping':
      return ok(msg.id, {});

    case 'tools/list':
      return ok(msg.id, { tools: TOOLS });

    case 'resources/list':
      return ok(msg.id, { resources: RESOURCES });

    case 'resources/read': {
      const uri = String(params.uri || '');
      const hit = RESOURCES.find((r) => r.uri === uri);
      if (!hit) return fail(msg.id, -32602, `unknown resource: ${uri}`);
      return ok(msg.id, { contents: [{ uri, mimeType: hit.mimeType, text: 'hello from warmy echo server' }] });
    }

    case 'tools/call': {
      const name = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      if (name === 'echo') {
        if (typeof args.message !== 'string') return fail(msg.id, -32602, 'echo: "message" (string) is required');
        return ok(msg.id, textResult(`pong:${args.message}`));
      }
      if (name === 'add') {
        const a = Number(args.a);
        const b = Number(args.b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return fail(msg.id, -32602, 'add: numeric "a" and "b" are required');
        return ok(msg.id, textResult(a + b));
      }
      if (name === 'slow') {
        const ms = Math.min(Math.max(Number(args.ms) || 0, 0), 60000);
        await delay(ms);
        return ok(msg.id, textResult(`waited ${ms}ms`));
      }
      return fail(msg.id, -32602, `unknown tool: ${name}`);
    }

    default:
      return fail(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const raw = String(line || '').trim();
  if (!raw) return;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  Promise.resolve(handle(msg)).catch((e) => {
    if (msg && msg.id !== undefined) fail(msg.id, -32603, `internal error: ${e && e.message}`);
  });
});
rl.on('close', () => process.exit(0));
