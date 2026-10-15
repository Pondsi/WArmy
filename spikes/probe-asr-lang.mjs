/** 探针：MiMo ASR 带语言/不带语言、文本块前后位置 —— 用真中文语音实测 */
import fs from 'node:fs';
import path from 'node:path';

const key = String(process.env.MIMO_KEY || fs.readFileSync(String(process.env.MIMO_KEY_FILE || ''), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '').trim();
const BASE = 'https://token-plan-cn.xiaomimimo.com/v1';
const H = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

// 1) 用 TTS 合成一段真中文语音
const tts = await fetch(BASE + '/chat/completions', {
  method: 'POST', headers: H,
  body: JSON.stringify({
    model: 'mimo-v2.5-tts',
    messages: [{ role: 'user', content: '请把下一条消息原样读出来。' }, { role: 'assistant', content: '今天天气不错，我们一起去公园散步吧。' }],
    modalities: ['text', 'audio'], audio: { format: 'wav', voice: 'mimo_default' },
  }),
});
const tj = await tts.json();
const b64 = tj?.choices?.[0]?.message?.audio?.data || '';
console.log('TTS ok:', b64.length > 1000);
if (b64.length < 100) { console.log(JSON.stringify(tj).slice(0, 300)); process.exit(1); }

async function shi(name, body) {
  const r = await fetch(BASE + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  const t = j?.choices?.[0]?.message?.content;
  console.log(`\n=== ${name} === status=${r.status} text=${JSON.stringify(String(t || '').slice(0, 80))}`);
  if (r.status !== 200) console.log('  err:', JSON.stringify(j).slice(0, 200));
}

const pure = [{ type: 'input_audio', input_audio: { data: b64, format: 'wav' } }];
const zhHint = '请把这段音频转写成中文（简体）；不要输出英文。';

await shi('A 纯音频（无文本）', { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: pure }] });
await shi('B 文本在前+音频', { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'text', text: zhHint }, pure[0]] }] });
await shi('C 音频在前+文本在后', { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [pure[0], { type: 'text', text: zhHint }] }] });
await shi('D system+纯音频', { model: 'mimo-v2.5-asr', messages: [{ role: 'system', content: zhHint }, { role: 'user', content: pure }] });
await shi('E 顶层 language 字段', { model: 'mimo-v2.5-asr', language: 'zh', messages: [{ role: 'user', content: pure }] });
await shi('F audio.language=zh', { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: b64, format: 'wav', language: 'zh' } }] }] });
await shi('G prompt 字段', { model: 'mimo-v2.5-asr', prompt: zhHint, messages: [{ role: 'user', content: pure }] });
