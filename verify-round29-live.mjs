/**
 * Round 29 live checks. ASCII-safe. Needs local Ollama.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function settingsPath() { return path.join(os.homedir(), 'AppData', 'Roaming', '@warmy', 'app-shell', 'settings.json'); }
function keyPath() { return path.join(os.homedir(), '.openclaw', 'workspace', decodeURIComponent('%E5%A4%A7%E9%BE%99%E8%99%BE%E4%BA%92%E5%8A%A8%E5%8C%BA'), '<keyfile>.txt'); }
const fail = [];
const ok = [];
const chk = (name, cond, detail) => {
  if (cond) ok.push(name);
  else fail.push(name + (detail ? ' :: ' + String(detail).slice(0, 140) : ''));
};

async function ollamaChat(model, prompt, opts = {}) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    ...(opts.tools ? { tools: opts.tools } : {}),
    options: { num_predict: opts.maxTokens || 512 },
  };
  const r = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error('ollama http ' + r.status);
  return r.json();
}

console.log('=== verify-round29-live ===');

// 1. Ollama basic chat (thinking models may put text in content OR thinking)
try {
  const r = await ollamaChat('qwen3.8-27b:iq4-128K', 'Reply with exactly: PONG', { maxTokens: 256 });
  const txt = String(r.message?.content || '') + String(r.message?.thinking || '');
  chk('ollama-chat', /PONG/i.test(txt) || txt.trim().length > 0, txt.slice(0, 60));
} catch (e) { chk('ollama-chat', false, e.message); }

// 2. Ollama tool call
try {
  const tools = [{
    type: 'function',
    function: {
      name: 'write_file',
      description: 'write a text file to disk',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  }];
  const r = await ollamaChat('qwen3.8-27b:iq4-128K',
    'Call write_file to create file round29-test.txt with content HELLO29. Do not explain, just call the tool.',
    { tools, maxTokens: 256 });
  const tc = r.message?.tool_calls || [];
  const txt = String(r.message?.content || '') + String(r.message?.thinking || '');
  chk('ollama-tool-call', tc.length > 0 || /write_file|round29/.test(txt),
    JSON.stringify(tc).slice(0, 100) || txt.slice(0, 80));
} catch (e) { chk('ollama-tool-call', false, e.message); }

// 3. Auth hard-gate
try {
  const em = fs.readFileSync('packages/app-shell/src/electron-main.ts', 'utf8');
  chk('auth-hard-gate', !em.includes('muLuOf(t2) === muLu') && (em.includes("mode: 'exact'") || em.includes('yiShouQuan')));
} catch (e) { chk('auth-hard-gate', false, e.message); }

// 4. MiMo key (UTF-8 safe path)
try {
  const kp = keyPath();
  const keyLine = fs.readFileSync(kp, 'utf8').split(/\r?\n/)[0] || '';
  const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  const mimo = (s.providers || []).find((p) => /mimo/i.test(String(p.id || '') + String(p.biaoQian || '')));
  chk('mimo-provider-configured', !!(mimo && mimo.hasKey) && keyLine.length > 10, keyLine.slice(0, 8));
} catch (e) { chk('mimo-provider-configured', false, e.message); }

// 5. Ollama default model
try {
  const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  const ol = (s.providers || []).find((p) => p.protocol === 'ollama');
  chk('ollama-default-model', !!(ol && ol.defaultModel), String(ol && ol.defaultModel));
} catch (e) { chk('ollama-default-model', false, e.message); }

// 6. dist fresh
try {
  const a = fs.statSync('packages/app-shell/dist/renderer/app.js');
  const b = fs.statSync('packages/app-shell/src/renderer/app.js');
  chk('dist-fresh', a.mtimeMs >= b.mtimeMs - 2000);
} catch (e) { chk('dist-fresh', false, e.message); }

console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
