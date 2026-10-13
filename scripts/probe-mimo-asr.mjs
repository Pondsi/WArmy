/**
 * 探针：摸清 MiMo token-plan 端点 ASR 的真实形状。
 * 纯读取 + 一个小 wav，不改项目状态。
 *
 * 用法（**不要把密钥写进仓库**）：
 *   MIMO_KEY=<你的 key> node scripts/probe-mimo-asr.mjs
 *   MIMO_KEY_FILE=<file-with-key-on-first-line> node scripts/probe-mimo-asr.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const keyFromEnv = String(process.env.MIMO_KEY || '').trim();
const keyFile = String(process.env.MIMO_KEY_FILE || '').trim();
let key = keyFromEnv;
if (!key && keyFile) {
  try { key = fs.readFileSync(keyFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ }
}
if (!key) { console.error('no key: set MIMO_KEY or MIMO_KEY_FILE'); process.exit(2); }
const BASE = 'https://token-plan-cn.xiaomimimo.com/v1';

const WAV = path.resolve('spikes/probe-tone.wav');
const buf = fs.readFileSync(WAV);

async function show(label, res) {
  let body = '';
  try { body = await res.text(); } catch { /* noop */ }
  console.log(`\n=== ${label} ===`);
  console.log('status', res.status);
  console.log(body.slice(0, 600));
}

const H = { Authorization: 'Bearer ' + key };

// 1) models
await show('GET /models', await fetch(BASE + '/models', { headers: H }));

// 2) 标准 audio/transcriptions
{
  const f = new FormData();
  f.append('file', new Blob([buf], { type: 'audio/wav' }), 'a.wav');
  f.append('model', 'mimo-v2.5-asr');
  await show('POST /audio/transcriptions (multipart)', await fetch(BASE + '/audio/transcriptions', { method: 'POST', headers: H, body: f }));
}

// 3) chat 式 input_audio（format=wav）
{
  const body = { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: buf.toString('base64'), format: 'wav' } }] }] };
  await show('POST /chat/completions input_audio wav', await fetch(BASE + '/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

// 4) chat 式 input_audio（format=webm）—— 模拟麦克风录制格式
{
  const body = { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: buf.toString('base64'), format: 'webm' } }] }] };
  await show('POST /chat/completions input_audio webm', await fetch(BASE + '/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

// 5) chat 式 audio_url 形状（data url）
{
  const body = { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + buf.toString('base64'), format: 'wav' } }] }] };
  await show('POST /chat/completions input_audio data-url-prefixed', await fetch(BASE + '/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

// 6) 用 mimo-v2.5（非 asr）走 input_audio，看是否也认
{
  const body = { model: 'mimo-v2.5', messages: [{ role: 'user', content: [{ type: 'text', text: '转写这段音频' }, { type: 'input_audio', input_audio: { data: buf.toString('base64'), format: 'wav' } }] }] };
  await show('POST /chat/completions mimo-v2.5 + input_audio', await fetch(BASE + '/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
