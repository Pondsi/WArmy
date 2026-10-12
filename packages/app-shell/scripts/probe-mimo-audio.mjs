#!/usr/bin/env node
/**
 * probe-mimo-audio.mjs —— **真机**验证 MiMo 的 TTS/ASR（**探针，刻意不进 CI/门禁**）。
 *
 * 为什么是探针：它需要**网络 + 真实密钥**（密钥从本机 key 文件读，**只读第一行、绝不打印**），
 * 因此不能当"每次提交都要跑"的门禁；它的价值是**一次性取证**，证明：
 *   ① 端点确实只有 `/chat/completions`（标准音频端点 404）；
 *   ② 用产品**同一套** `taoTtsChatBody` / `jieXiTtsChatResponse` 能真的合成出音频；
 *   ③ 把合成出来的音频再喂给 `taoAsrChatBody` / `jieXiAsrChatResponse` 能**逐字转回** —— 往返闭合。
 *
 * 用法：node packages/app-shell/scripts/probe-mimo-audio.mjs ["要读的一句话"]
 * 密钥文件路径可用 WARMY_MIMO_KEY_FILE 覆盖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(selfDir, '..', '..', '..');
const P = await import(new URL('file://' + path.join(repoRoot, 'packages', 'providers', 'dist', 'index.js')).href);

/**
 * ⚠️ 密钥文件**必须**用环境变量给（`WARMY_MIMO_KEY_FILE`）—— 这里**不写死任何本机路径**：
 * 写死就把用户目录结构带进仓库（`verify-security` 会拦，也确实不该带）。
 */
const keyFile = String(process.env.WARMY_MIMO_KEY_FILE || '').trim();
const YUAN = process.argv.slice(2).join(' ').trim() || '你好，这是语音合成与识别往返测试，一二三四五。';
const BASE = process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1';

let ok = 0, bad = 0;
const t = (l, c, d) => { if (c) { ok++; console.log('  ok   ' + l); } else { bad++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 200) : '')); } };

if (!keyFile || !fs.existsSync(keyFile)) {
  console.error('用法：先设 WARMY_MIMO_KEY_FILE=<含密钥的文件（第一行是 key）>，例如：');
  console.error('  $env:WARMY_MIMO_KEY_FILE="<密钥文件路径>"; node packages/app-shell/scripts/probe-mimo-audio.mjs');
  process.exit(2);
}
const key = fs.readFileSync(keyFile, 'utf8').split(/\r?\n/)[0].trim();
if (!key) { console.error('密钥文件第一行为空'); process.exit(2); }
console.log('端点 ' + BASE + '，密钥已读取（长度 ' + key.length + '，不打印）');
const H = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-mimo-audio-'));

/* ① 端点上有什么 */
{
  const r = await fetch(BASE + '/models', { headers: H, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  const ids = (j?.data || []).map((m) => m.id);
  console.log('\n[1] /models 返回 ' + r.status + '：' + ids.join(', '));
  const cap = P.moXingNengLi;
  t('mimo-v2.5-asr 被判为 asr', ids.includes('mimo-v2.5-asr') && cap('mimo-v2.5-asr').kind === 'asr');
  t('mimo-v2.5-tts 被判为 tts', ids.includes('mimo-v2.5-tts') && cap('mimo-v2.5-tts').kind === 'tts');
  for (const p of ['/audio/speech', '/audio/transcriptions']) {
    const r2 = await fetch(BASE + p, { method: 'POST', headers: H, body: '{}', signal: AbortSignal.timeout(30000) });
    console.log('    ' + p + ' → ' + r2.status + (r2.status === 404 ? '（标准音频端点不存在 ⇒ 必须走 chat 式）' : ''));
    t('标准音频端点不存在（' + p + '）', r2.status === 404 || r2.status === 400);
  }
}

/* ② TTS：用产品同一套构造器 */
let audioB64 = '', mime = '';
{
  const body = P.taoTtsChatBody({ model: 'mimo-v2.5-tts', text: YUAN, voice: 'mimo_default', format: 'wav' });
  const r = await fetch(BASE + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => null);
  const jie = P.jieXiTtsChatResponse(j, 'wav');
  console.log('\n[2] TTS（产品构造器 taoTtsChatBody → jieXiTtsChatResponse）→ ' + r.status);
  t('TTS 合成成功（拿到 audio.data）', jie.ok, jie.error);
  if (jie.ok) {
    audioB64 = jie.audioBase64;
    mime = jie.mime;
    const buf = Buffer.from(audioB64, 'base64');
    const f = path.join(dir, 'tts.wav');
    fs.writeFileSync(f, buf);
    console.log('    音频 ' + buf.length + ' 字节，头 ' + JSON.stringify(buf.subarray(0, 4).toString('latin1')) + ' → ' + f);
    t('是合法 WAV（RIFF 头）', buf.subarray(0, 4).toString('latin1') === 'RIFF');
    t('mime 正确', mime === 'audio/wav', mime);
  }
}

/* ③ ASR：把刚合成的音频转回来（往返闭合） */
if (audioB64) {
  const buf = Buffer.from(audioB64, 'base64');
  const body = P.taoAsrChatBody({ model: 'mimo-v2.5-asr', dataBase64: buf.toString('base64'), format: 'wav' });
  const r = await fetch(BASE + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => null);
  const jie = P.jieXiAsrChatResponse(j);
  console.log('\n[3] ASR（产品构造器）→ ' + r.status);
  t('ASR 转写成功', jie.ok, jie.error);
  if (jie.ok) {
    console.log('    原文：' + YUAN);
    console.log('    转回：' + jie.text);
    const gui = (s) => String(s).replace(/[\s，。、,.!！?？]/g, '');
    t('往返一致（去标点逐字相同）', gui(jie.text) === gui(YUAN), { yuan: gui(YUAN), hui: gui(jie.text) });
  }
}

/* ④ 音色：故意给一个不存在的音色，看端点是否给出可用清单（产品会自动纠正一次） */
{
  const body = P.taoTtsChatBody({ model: 'mimo-v2.5-tts', text: '试一下音色纠正', voice: 'no-such-voice-xyz', format: 'wav' });
  const r = await fetch(BASE + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => null);
  const jie = P.jieXiTtsChatResponse(j, 'wav');
  console.log('\n[4] 坏音色 → ' + r.status + '，可用清单：' + JSON.stringify(jie.voices || []));
  t('坏音色被如实拒（且给出可用清单，产品据此自动纠正）', !jie.ok && Array.isArray(jie.voices) && jie.voices.length > 0, jie.voices);
}

console.log('\n探针结果：ok=' + ok + ' fail=' + bad + '（临时目录 ' + dir + '）');
process.exit(bad === 0 ? 0 : 1);
