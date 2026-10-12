import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const node = process.execPath;

async function resetLight() {
  for (const [f, v] of [['plans.json', '[]'], ['ui-queues.json', '{}'], ['eta-live.json', '{}']]) {
    try { fs.writeFileSync(path.join(DATA, f), v); } catch { /* noop */ }
  }
  try { fs.writeFileSync(path.join(DATA, 'audit', 'audit.jsonl'), ''); } catch { /* noop */ }
  try {
    const sp = path.join(DATA, 'settings.json');
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    s.privacyConsent = true;
    s.guideDone = true;
    // 本地 ollama 对话
    const tags = await fetch('http://127.0.0.1:11434/api/tags').then((r) => r.json());
    const models = (tags.models || []).map((m) => m.name).filter(Boolean);
    const chatish = models.filter((m) => !/whisper|bge|nomic|embed/i.test(m));
    const rank = (m) => (/thinkingcap/i.test(m) ? 3 : /qwen3\.8|qwen3\.6-35b|qwen3\.5-9b/i.test(m) ? 0 : 1);
    chatish.sort((a, b) => rank(a) - rank(b) || String(a).length - String(b).length);
    const providers = Array.isArray(s.providers) ? s.providers : [];
    const oi = providers.findIndex((p) => p.protocol === 'ollama');
    const ollama = {
      id: oi >= 0 ? providers[oi].id : 'ollama-local',
      biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
      models, defaultModel: chatish[0] || models[0] || '', timeoutMs: 45000,
    };
    if (oi >= 0) providers[oi] = { ...providers[oi], ...ollama };
    else providers.push(ollama);
    s.providers = providers;
    s.specialModels = {
      ...(s.specialModels || {}),
      chatChain: chatish.slice(0, 6),
      chatDisabled: [],
      ttsChain: ['mimo-v2.5-tts'],
      ttsDisabled: [],
    };
    fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  } catch { /* noop */ }
  const id = 'inst-test-verify';
  const ws = path.join(DATA, 'instances', id);
  try {
    fs.mkdirSync(ws, { recursive: true });
    if (!fs.existsSync(path.join(ws, 'agent.mjs'))) {
      fs.writeFileSync(path.join(ws, 'agent.mjs'),
        'process.send?.({ type: "ready", pid: process.pid, ming: "牛马-1" });\nprocess.on("message", (m) => { if (m === "ping") process.send({ type: "pong" }); });\nsetInterval(() => {}, 1 << 30);\n');
    }
  } catch { /* noop */ }
}

async function runRound(n) {
  await resetLight();
  console.log(`\n######## ROUND ${n} ########`);
  return new Promise((resolve) => {
    const child = spawn(node, [path.join(root, 'round3-verify.mjs'), String(n)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
    });
    let out = '';
    child.stdout.on('data', (d) => { const s = String(d); out += s; process.stdout.write(s); });
    child.stderr.on('data', (d) => { const s = String(d); out += s; process.stderr.write(s); });
    child.on('close', (code) => {
      const m = out.match(/==== 第 (\d+) 轮结果：(\d+)\/(\d+) 通过 ====/);
      resolve({ n, code, pass: code === 0 && m && m[2] === m[3], summary: m ? m[0] : 'no summary' });
    });
  });
}

const results = [];
for (let i = 1; i <= 3; i++) {
  const r = await runRound(i);
  results.push(r);
  if (!r.pass) { console.log('FAIL at', i, JSON.stringify(results)); process.exit(1); }
}
console.log('ALL 3 ROUNDS GREEN', JSON.stringify(results));
process.exit(0);
