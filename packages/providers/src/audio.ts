/**
 * audio —— **「只用 /chat/completions」的语音通道**（说话 TTS / 听话 ASR）。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：MiMo（token-plan 官方端点）**只暴露 `/v1/models` 与 `/v1/chat/completions`** ——
 * 没有 OpenAI 的 `/v1/audio/speech`、也没有 `/v1/audio/transcriptions`（实测都是 404）。
 * 于是产品里那套"标准 OpenAI 音频端点"写法的 TTS/ASR **一个字都跑不出来**，
 * 而它的模型列表里明明躺着 `mimo-v2.5-tts` / `mimo-v2.5-asr` —— "一等公民"名不副实。
 *
 * 实测出来的**真实形状**（不是猜的，2026-10-12 对 CN 站实测）：
 *   · TTS：`POST /v1/chat/completions`
 *       { model:'mimo-v2.5-tts',
 *         messages:[{role:'user',content:'…'},{role:'assistant',content:'要读出来的正文'}],
 *         modalities:['text','audio'], audio:{voice:'mimo_default',format:'wav'} }
 *     要读的文本**必须放在 assistant 消息里**（否则报 `messages must contain an assistant role for TTS model`）；
 *     不能带 system（报 `messages[0] system role is not allowed for TTS model`）；
 *     返回在 `choices[0].message.audio.data`（base64）。
 *   · ASR：`POST /v1/chat/completions`
 *       { model:'mimo-v2.5-asr', messages:[{role:'user',content:[{type:'input_audio',input_audio:{data,format}}]}] }
 *     返回正文在 `choices[0].message.content`。
 *   · 音色清单在报错里给出来（`Available voices: [mimo_default, 冰糖, …]`）——
 *     这里把它**解析出来如实上报**，而不是硬编码一份会过期的表。
 *
 * 纯函数、零依赖 —— 门禁可无头断言（见 scripts/verify-audio-first-class.mjs）。
 */

export type AudioGeShi = 'wav' | 'mp3' | 'opus' | 'webm' | 'm4a' | 'flac' | 'ogg';

export interface TtsChatQingQiu {
  model: string;
  text: string;
  voice?: string;
  format?: AudioGeShi;
  /** 可选：语言提示（部分实现认这个字段，不认也不报错） */
  language?: string;
  /** 速度 0.5–2（不认的实现会忽略） */
  speed?: number;
}

/** 造"chat 式 TTS"的请求体（**要读的文本放 assistant 消息里**，实测的硬要求） */
export function taoTtsChatBody(q: TtsChatQingQiu): Record<string, unknown> {
  const voice = String(q.voice || '').trim();
  const audio: Record<string, unknown> = { format: q.format || 'wav' };
  if (voice) audio['voice'] = voice;
  if (Number.isFinite(Number(q.speed)) && Number(q.speed) >= 0.5 && Number(q.speed) <= 2) audio['speed'] = Number(q.speed);
  const body: Record<string, unknown> = {
    model: String(q.model || 'tts-1'),
    // ⚠️ 顺序与角色是实测要求：user（指令）在前、assistant（要读的正文）在后，且**不许有 system**
    messages: [
      { role: 'user', content: '请把下一条消息原样读出来。' },
      { role: 'assistant', content: String(q.text ?? '') },
    ],
    modalities: ['text', 'audio'],
    audio,
  };
  if (q.language) body['language'] = q.language;
  return body;
}

export interface TtsJieGuo {
  ok: boolean;
  /** base64 音频（不带 data: 前缀） */
  audioBase64?: string;
  format?: string;
  mime?: string;
  /** 有些实现会把正文也在 content 里回一份 */
  transcript?: string;
  /** 端点要求的音色清单（从报错里解析出来时给） */
  voices?: string[];
  error?: string;
}

const GESHI_MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg' };

/** 从报错文本里解析 `Available voices: [a, b, c]`（**如实上报**，不硬编码会过期的表） */
export function jieXiKeYongYinSe(text: string): string[] {
  const m = /Available voices:\s*\[([^\]]*)\]/i.exec(String(text || ''));
  if (!m) return [];
  return m[1]!.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** 解析 chat 式 TTS 的响应体 */
export function jieXiTtsChatResponse(json: unknown, wantFormat = 'wav'): TtsJieGuo {
  const j = json as { choices?: Array<{ message?: { audio?: { data?: string; format?: string; voice?: string }; content?: unknown } }>; error?: { message?: string; param?: string } } | null;
  const err = j?.error ? String(j.error.param || j.error.message || 'tts-error') : '';
  const a = j?.choices?.[0]?.message?.audio;
  const data = a?.data;
  if (typeof data === 'string' && data.length > 100) {
    const fmt = String(a?.format || wantFormat || 'wav').toLowerCase();
    return {
      ok: true,
      audioBase64: data,
      format: fmt,
      mime: GESHI_MIME[fmt] || 'audio/wav',
      transcript: typeof j?.choices?.[0]?.message?.content === 'string' ? (j!.choices![0]!.message!.content as string) : undefined,
    };
  }
  const voices = jieXiKeYongYinSe(err);
  return {
    ok: false,
    error: err || 'tts-no-audio（响应里没有 audio.data）',
    ...(voices.length ? { voices } : {}),
  };
}

export interface AsrChatQingQiu {
  model: string;
  /** 音频 base64（不带 data: 前缀） */
  dataBase64: string;
  format?: AudioGeShi;
  /** 可选的提示（有些实现支持） */
  prompt?: string;
  /** **语言**（ISO-639-1，如 zh / en）：中文语音被识别成英文就是缺它 */
  language?: string;
  /**
   * 是否把语言提示写成前置文本块（默认 false）。
   * 实测 MiMo：`input_audio` 旁边塞文本会让转写变空 ⇒ 只在"纯音频转不出来"的重试里打开。
   */
  daiYuYanTiShi?: boolean;
}

/** 造"chat 式 ASR"的请求体（input_audio 内容块） */
export function taoAsrChatBody(q: AsrChatQingQiu): Record<string, unknown> {
  const fmt = String(q.format || 'wav');
  /**
   * **实测约束（MiMo token-plan，2026-10-13）**：
   *   · `content` 里**不许有文本块** —— 端点回 `400 Param Incorrect: ASR request must not
   *     include text parts; text prompt is injected by the gateway`（这正是"识别成英文/转不出字"
   *     与上一版"塞文本提示导致转写为空"的根因）；
   *   · **可用**的语言载体：顶层 `language` / `input_audio.language` / 顶层 `prompt` / system 消息。
   * 这里统一用 **顶层 `language` + `input_audio.language`** 双写（不同网关认的字段不同），
   * 内容数组里只放音频。
   */
  const yu = String(q.language || '').trim().toLowerCase();
  const audio: Record<string, unknown> = { data: String(q.dataBase64 ?? ''), format: fmt };
  if (yu) audio['language'] = yu;
  const body: Record<string, unknown> = {
    model: String(q.model || 'whisper-1'),
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: audio }] }],
  };
  if (yu) body['language'] = yu;
  /** 顶层 prompt 也认（有的网关拿它当上下文提示）；只在显式给了 prompt 时带上 */
  if (String(q.prompt || '').trim()) body['prompt'] = String(q.prompt).trim();
  return body;
}

/** 解析 chat 式 ASR 的响应体 */
export function jieXiAsrChatResponse(json: unknown): { ok: boolean; text?: string; error?: string } {
  const j = json as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } } | null;
  if (j?.error) return { ok: false, error: String(j.error.message || 'asr-error') };
  const c = j?.choices?.[0]?.message?.content;
  const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((b) => (b && typeof b === 'object' ? String((b as { text?: string }).text || '') : '')).join('') : '');
  if (!text.trim()) return { ok: false, error: 'asr-empty（转写结果为空）' };
  return { ok: true, text };
}

/**
 * 这次失败**要不要换"chat 式"再试**。
 * 判据：404/405（端点不存在）/ 400/422（端点存在但不认这个形状）/ 501 ——
 * 都是"这条路走不通"，值得换形状；401/403 是**密钥问题**，换形状没用（如实报错更诚实）。
 */
export function yingGaiHuanChatShi(status: number): boolean {
  return status === 404 || status === 405 || status === 400 || status === 422 || status === 501;
}

/**
 * **chat 式 ASR 只吃 wav / mp3**。
 *
 * 实测（2026-10-13，MiMo token-plan CN 站）：
 *   `POST /v1/chat/completions` 带 `input_audio.format:'webm'` ⇒
 *   `400 Param Incorrect: input_audio.format must be one of: wav, mp3. Got: webm`
 *
 * 而 Chromium 的 `MediaRecorder` 默认只录 `audio/webm` —— 这就是"配了听话模型却转不出字"
 * 的直接原因。所以这里给一个**规范格式**函数：调用方先转码（渲染层用 decodeAudioData 转 WAV），
 * 转不了的就**如实报错**，不要把 webm 直接发给端点白挨一个 400。
 */
export function guiFanAsrGeShi(geShi: string): 'wav' | 'mp3' | null {
  const f = (String(geShi || '').toLowerCase().replace(/^\./, '').split(';')[0] ?? '').trim();
  if (f === 'wav' || f === 'x-wav' || f === 'wave') return 'wav';
  if (f === 'mp3' || f === 'mpeg' || f === 'x-mpeg') return 'mp3';
  return null;
}
