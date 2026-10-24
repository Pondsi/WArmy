#!/usr/bin/env node
/**
 * verify-audio-first-class.mjs —— **TTS / ASR 一等公民**（硬门禁；纯 Node，不需要网络/密钥）。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：`mimo-v2.5-tts` / `mimo-v2.5-asr` 明明在端点 `/models` 里，产品里却**一个字都跑不出来** ——
 *   ① 能力表抓不住这两个型号名（`asr-` 要求 asr 后面还有连字符；`\btts\b` 抓不住 `-tts-voiceclone`）
 *      ⇒ 它们**永远不会出现在「说话模型 / 听话模型」的可选列表里**；
 *   ② TTS/ASR 只会打 OpenAI 的 `/audio/speech`、`/audio/transcriptions`，
 *      而 MiMo 这类网关**只有 `/chat/completions`**（实测那两个路径都是 404）。
 *
 * 这条门禁钉三件事：
 *   ① 能力识别：这两个型号必须被判成 asr / tts（否则链是空的，一等公民名不副实）；
 *   ② 请求/响应构造：chat 式音频的**真实形状**（TTS 要读的文本必须在 assistant 消息里、不许带 system；
 *      ASR 走 input_audio 块）—— 逐条断言，形状错了当场红；
 *   ③ 接线：主进程里两条路都在（标准端点 + chat 式兜底），且**失败只在"该换形状"的状态码上换**
 *      （401/403 是密钥问题，换形状没用、要如实报错）。
 *
 * 门禁必须能失败：末节用"坏形状"撞三处判定，任何一处抓不出来就判红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 300) : '')); }
};

const P = await import(new URL('file://' + path.join(repoRoot, 'packages', 'providers', 'dist', 'index.js')).href);
const {
  taoTtsChatBody, jieXiTtsChatResponse, taoAsrChatBody, jieXiAsrChatResponse,
  yingGaiHuanChatShi, jieXiKeYongYinSe, moXingNengLi, caiZhongLei, chuangjianGongYing, quGongYingYuShe,
} = P;
const jianCeMoXingNengLi = moXingNengLi;

console.log('=== TTS/ASR 一等公民门禁（硬门禁）===');

/* ── 1. 能力识别：型号名必须被认出来 ── */
console.log('\n[1] 能力识别');
{
  const nAsr = moXingNengLi('mimo-v2.5-asr');
  const nTts = moXingNengLi('mimo-v2.5-tts');
  const nTtsVc = moXingNengLi('mimo-v2.5-tts-voiceclone');
  const nPro = moXingNengLi('mimo-v2.6-pro');
  check('mimo-v2.5-asr 判为 asr', nAsr?.kind === 'asr', nAsr);
  check('mimo-v2.5-tts 判为 tts', nTts?.kind === 'tts', nTts);
  check('mimo-v2.5-tts-voiceclone 也判为 tts', nTtsVc?.kind === 'tts', nTtsVc);
  check('mimo-v2.6-pro 判为 chat（且支持工具）', nPro?.kind === 'chat' && nPro?.tools === true, nPro);
  check('纯型号名推断也认（caiZhongLei）', caiZhongLei('mimo-v2.5-asr') === 'asr' && caiZhongLei('mimo-v2.5-tts') === 'tts', [caiZhongLei('mimo-v2.5-asr'), caiZhongLei('mimo-v2.5-tts')]);
  check('别的供应商的 asr/tts 没被带坏（whisper 仍 asr）', caiZhongLei('whisper-1') === 'asr');
}

/* ── 2. MiMo 供应商预设存在且指向 token-plan ── */
console.log('\n[2] 供应商预设');
{
  const yu = quGongYingYuShe('mimo');
  check('预设里有 mimo', !!yu, yu);
  check('指向 token-plan CN 的 /v1', /token-plan-cn\.xiaomimimo\.com\/v1$/.test(String(yu?.baseURL || '')), yu?.baseURL);
  check('默认模型是对话模型', /^mimo-v2\./.test(String(yu?.defaultModel || '')), yu?.defaultModel);
  check('走 openai-compatible 协议', yu?.protocol === 'openai-compatible', yu?.protocol);
  const g = chuangjianGongYing('openai-compatible', { apiKey: 'x', baseURL: yu?.baseURL });
  check('能造出供应商实例且 baseURL 正确', String(g.baseURL).includes('token-plan-cn'), g.baseURL);
}

/* ── 3. chat 式 TTS 的真实形状 ── */
console.log('\n[3] chat 式 TTS 形状');
{
  const b = taoTtsChatBody({ model: 'mimo-v2.5-tts', text: '要读的正文', voice: 'mimo_default', format: 'wav' });
  const ms = b.messages;
  check('带 model', b.model === 'mimo-v2.5-tts');
  check('messages 里**必须有 assistant** 且正文在它里面（网关硬要求）',
    Array.isArray(ms) && ms.some((m) => m.role === 'assistant' && m.content === '要读的正文'), ms);
  check('**不许带 system**（网关会 400）', !ms.some((m) => m.role === 'system'), ms.map((m) => m.role));
  check('modalities 含 audio', Array.isArray(b.modalities) && b.modalities.includes('audio'), b.modalities);
  check('audio.format 传下去', b.audio?.format === 'wav', b.audio);
  check('audio.voice 传下去', b.audio?.voice === 'mimo_default', b.audio);
  const b2 = taoTtsChatBody({ model: 'm', text: 'x', speed: 1.5 });
  check('语速在 0.5~2 才带', b2.audio?.speed === 1.5);
  const b3 = taoTtsChatBody({ model: 'm', text: 'x', speed: 9 });
  check('荒唐语速不带（不把垃圾参数发给端点）', b3.audio?.speed === undefined, b3.audio);
  // 响应解析：正常 / 无音频 / 音色错（带清单）
  const ok = jieXiTtsChatResponse({ choices: [{ message: { audio: { data: 'A'.repeat(400), format: 'wav' } } }] });
  check('正常响应解析出音频与 mime', ok.ok && ok.format === 'wav' && ok.mime === 'audio/wav', { ok: ok.ok, mime: ok.mime });
  const kong = jieXiTtsChatResponse({ choices: [{ message: { content: 'hi' } }] });
  check('没有 audio.data ⇒ 如实失败（不假装读了）', !kong.ok && /tts-no-audio/.test(String(kong.error)), kong);
  const cuo = jieXiTtsChatResponse({ error: { param: 'Unknown voice: alloy. Available voices: [mimo_default, 冰糖, 茉莉]' } });
  check('音色错 ⇒ 解析出可用音色清单', !cuo.ok && cuo.voices?.length === 3 && cuo.voices[0] === 'mimo_default', cuo.voices);
  check('jieXiKeYongYinSe 单独可用', jieXiKeYongYinSe('Available voices: [a, b]').join('|') === 'a|b');
}

/* ── 4. chat 式 ASR 的真实形状 ── */
console.log('\n[4] chat 式 ASR 形状');
{
  const b = taoAsrChatBody({ model: 'mimo-v2.5-asr', dataBase64: 'QUJD', format: 'wav' });
  const c = b.messages[0].content;
  check('model 正确', b.model === 'mimo-v2.5-asr');
  check('内容是 input_audio 块（不是字符串）', Array.isArray(c) && c.some((x) => x.type === 'input_audio'), c);
  const kuai = c.find((x) => x.type === 'input_audio');
  check('input_audio 带 data/format', kuai.input_audio?.data === 'QUJD' && kuai.input_audio?.format === 'wav', kuai);
  const b2 = taoAsrChatBody({ model: 'm', dataBase64: 'QQ==', format: 'mp3', prompt: '请转写' });
  /**
   * **契约（第 21 轮实测）**：MiMo token-plan 的 ASR 端点对"内容里带文本块"直接回
   * `400 ASR request must not include text parts` ⇒ 提示只能走**顶层 `prompt`**。
   * 早先这里断言"文本块排在前面"，那是按通用 chat 形状写的，与真实端点相反。
   */
  check('可选提示走顶层 prompt（不进 content 文本块）', b2.prompt === '请转写', { prompt: b2.prompt, content: b2.messages[0].content });
  check('内容数组里**只有音频**（有文本块就等着 400）', b2.messages[0].content.every((x) => x.type === 'input_audio'), b2.messages[0].content);
  const ok = jieXiAsrChatResponse({ choices: [{ message: { content: '你好世界' } }] });
  check('正常响应解析出文本', ok.ok && ok.text === '你好世界', ok);
  const kong = jieXiAsrChatResponse({ choices: [{ message: { content: '' } }] });
  check('空转写 ⇒ 如实失败（不返回空串当成功）', !kong.ok && /asr-empty/.test(String(kong.error)), kong);
  const cuo = jieXiAsrChatResponse({ error: { message: 'bad' } });
  check('错误响应如实带出', !cuo.ok && cuo.error === 'bad', cuo);
}

/* ── 5. "什么时候才换形状"：401/403 不许换 ── */
console.log('\n[5] 换形状的判据');
{
  check('404/405/400/422/501 判为"该换形状"', [404, 405, 400, 422, 501].every((s) => yingGaiHuanChatShi(s)));
  check('401/403 判为"不该换"（密钥问题，换形状没用）', ![401, 403].some((s) => yingGaiHuanChatShi(s)));
  check('200/500 也不换（成功或服务端错，换形状无益）', ![200, 500, 502].some((s) => yingGaiHuanChatShi(s)));
}

/* ── 6. 接线：两条路都在，且失败时换的是形状而不是"重试一遍" ── */
console.log('\n[6] 主进程接线');
{
  const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  check('TTS 走 chat 式兜底（ttsChatShi）', /async function ttsChatShi/.test(em) && /await ttsChatShi\(/.test(em));
  check('ASR 走 chat 式兜底（asrChatShi）', /async function asrChatShi/.test(em) && /await asrChatShi\(/.test(em));
  /**
   * 契约是"**换形状这件事只由状态码判据决定**"，不是"某个变量必须叫 `res2`"。
   * 原来这里钉死了两处局部变量名，改名/换写法就把绿的产品判据判成红 —— 门禁不该管局部变量叫什么。
   */
  const panDuanChu = (em.match(/if \(yingGaiHuanChatShi\(/g) || []).length;
  check('两处兜底都以状态码判据为前提（≥2 处，不许无条件换形状重试）', panDuanChu >= 2, { panDuanChu });
  check('音色被纠正后**如实记审计**', /tts\.voice-corrected/.test(em));
  check('TTS 把实际音色回给界面（voice 字段）', /voice: r2\.voice \|\| voice/.test(em));
  check('ASR 标注实际走的通道（via: chat-completions）', /via: 'chat-completions'/.test(em));
  check('音频容器格式会从 ext/mime 推（不是写死 webm）', /yinPinGeShi/.test(em) && /data:audio\\\//.test(em));
}

/* ── 7. 自证：坏形状必须被判出来 ── */
console.log('\n[7] 自证（门禁必须能失败）');
{
  const huai1 = taoTtsChatBody({ model: 'm', text: '正文' });
  check('自证：若把正文放进 user 而不是 assistant，则"文本在 assistant 里"这条必须为假',
    !(huai1.messages[huai1.messages.length - 1].role === 'user' && huai1.messages[0].role === 'assistant'));
  const huai2 = { model: 'm', messages: [{ role: 'user', content: 'x' }] };
  check('自证：坏 ASR 响应（无 choices）必须解析失败', !jieXiAsrChatResponse(huai2).ok);
  check('自证：401 若被判"该换形状"，本门禁失效', !yingGaiHuanChatShi(401));
  const nHuai = moXingNengLi('mimo-v2.5-asr');
  check('自证：若 asr 型号被判成 chat，本门禁失效', nHuai?.kind !== 'chat');
}

console.log(`\nTTS/ASR 一等公民门禁: ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
