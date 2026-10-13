/**
 * media-format —— **给模型传数据前的格式验收 / 转换决策**（纯函数，可无头门禁）。
 *
 * 为什么必须有它（真机事故）：
 *   MiMo 的 chat 式 ASR **只收 `wav` / `mp3`**，而麦克风录的是 `webm` ——
 *   以前直接把 webm 发过去，端点回 `400 Param Incorrect: input_audio.format must be
 *   one of: wav, mp3`，界面表现为"配了听话模型却转不出字"。
 *
 * 产品要求（本轮）：
 *   ① **拉取模型时就知道它收什么格式**（按模型种类 + 协议给出可接受清单，落进 modelCaps）；
 *   ② **内置格式转换**（音频统一到 wav/mp3，图片统一到 png/jpeg，视频统一到 mp4）；
 *   ③ **做成门禁**：每次给模型传数据前都要过一次 `yanShouGeShi`，不合规就转或拒，
 *      **绝不**把注定 400 的请求发出去。
 */

/** 内部统一的规范格式名 */
export type GuiFanGeShi =
  | 'wav' | 'mp3' | 'ogg' | 'opus' | 'webm' | 'm4a' | 'flac' | 'aac'
  | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'svg'
  | 'mp4' | 'mov' | 'mkv' | 'avi' | 'webm-video'
  | 'unknown';

/** 数据类别 */
export type MeiTiZhongLei = 'audio' | 'image' | 'video';

/** 从 MIME / 扩展名 / dataURL 推断规范格式 */
export function jianBieGeShi(hint: string): GuiFanGeShi {
  const s = String(hint || '').toLowerCase().trim();
  const m = /^data:([^;,]+)/.exec(s);
  const t = (m ? m[1]! : s).split(';')[0]!.trim().replace(/^\./, '');
  const biao: Record<string, GuiFanGeShi> = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav', wav: 'wav', x_wav: 'wav',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', mp3: 'mp3', mpeg: 'mp3',
    'audio/ogg': 'ogg', ogg: 'ogg', oga: 'ogg',
    'audio/opus': 'opus', opus: 'opus',
    'audio/webm': 'webm', webm: 'webm',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', m4a: 'm4a', mp4a: 'm4a', aac: 'aac',
    'audio/flac': 'flac', flac: 'flac',
    'image/png': 'png', png: 'png',
    'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', jpeg: 'jpeg', jpg: 'jpeg',
    'image/gif': 'gif', gif: 'gif',
    'image/webp': 'webp', webp: 'webp',
    'image/bmp': 'bmp', bmp: 'bmp',
    'image/svg+xml': 'svg', svg: 'svg', svgz: 'svg',
    'video/mp4': 'mp4', mp4: 'mp4', m4v: 'mp4',
    'video/quicktime': 'mov', mov: 'mov',
    'video/x-matroska': 'mkv', mkv: 'mkv',
    'video/x-msvideo': 'avi', avi: 'avi',
  };
  return biao[t] || 'unknown';
}

/** 规范格式属于哪一类 */
export function geShiZhongLei(f: GuiFanGeShi): MeiTiZhongLei | 'unknown' {
  if (['wav', 'mp3', 'ogg', 'opus', 'webm', 'm4a', 'flac', 'aac'].includes(f)) return 'audio';
  if (['png', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(f)) return 'image';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm-video'].includes(f)) return 'video';
  return 'unknown';
}

/**
 * **各类模型收什么格式**（拉取模型时据此写进 `modelCaps.mediaFormats`）。
 *
 * 依据：OpenAI 兼容规范（`/audio/transcriptions` 收 wav/mp3/…；`input_audio` 常见只收 wav/mp3；
 * `image_url` 常见 png/jpeg/webp/gif）+ MiMo token-plan 实测（ASR 只收 wav/mp3）。
 * 协议差异：`ollama` 原生 `/api/chat` 的图片走 base64，格式由模型自己的视觉塔决定，
 * 我们统一**转成 png** 再发（最稳）。
 */
export function jieShouGeShi(
  zhongLei: MeiTiZhongLei,
  xieYi: 'openai-compatible' | 'ollama' | 'anthropic' = 'openai-compatible',
  moXingKind = '',
): GuiFanGeShi[] {
  const k = String(moXingKind || '').toLowerCase();
  if (zhongLei === 'audio') {
    // ASR / 听话：MiMo 实测只收 wav/mp3；whisper 系更宽。**保守取交集**：wav+mp3 一定安全。
    if (k === 'asr') return ['wav', 'mp3'];
    // 音频输入给聊天模型（input_audio）：同样保守
    return ['wav', 'mp3'];
  }
  if (zhongLei === 'image') {
    if (xieYi === 'ollama') return ['png', 'jpeg', 'webp', 'gif'];   // 统一转 png 也行，但这些都认
    return ['png', 'jpeg', 'webp', 'gif'];
  }
  if (zhongLei === 'video') {
    return ['mp4', 'webm-video'];   // 视频理解：各家差异大，只承诺这两种
  }
  return [];
}

/** 转换目标格式（**内置转换**的统一出口）：给定已有格式与目标清单，决定转成什么 */
export function zhuanHuanMuBiao(you: GuiFanGeShi, jieShou: GuiFanGeShi[]): GuiFanGeShi | null {
  if (!jieShou.length) return null;
  if (jieShou.includes(you)) return you;
  const lei = geShiZhongLei(you);
  /**
   * **只在同类里找目标**：拿音频去塞给只收图片的模型，是**类别不匹配**，
   * 不是"换个格式就行" —— 必须拒绝，不能退而求其次返回 `jieShou[0]`（那会把音频当图片发出去）。
   */
  const tongLei = jieShou.filter((f) => geShiZhongLei(f) === lei);
  if (!tongLei.length) return null;
  // 音频 → 优先 wav，其次 mp3
  if (lei === 'audio') {
    if (tongLei.includes('wav')) return 'wav';
    if (tongLei.includes('mp3')) return 'mp3';
    return tongLei[0] ?? null;
  }
  // 图片 → 优先 png，其次 jpeg
  if (lei === 'image') {
    if (tongLei.includes('png')) return 'png';
    if (tongLei.includes('jpeg')) return 'jpeg';
    return tongLei[0] ?? null;
  }
  if (lei === 'video') {
    if (tongLei.includes('mp4')) return 'mp4';
    return tongLei[0] ?? null;
  }
  return null;
}

export interface YanShouJieGuo {
  ok: boolean;
  /** pass=原样发；convert=需要先转成 `to`；reject=不该发（调用方如实报错） */
  action: 'pass' | 'convert' | 'reject';
  to?: GuiFanGeShi;
  /** 人类可读的原因（拒绝时给界面/日志） */
  reason?: string;
}

/**
 * **格式验收门禁**（产品要求：每次给模型传数据前都过一次）。
 *
 * `have` = 实际要发的格式（MIME / 扩展名 / dataURL 都行）；
 * `jieShou` = 目标模型的可接受清单（来自 `jieshouGeShi()` 或 modelCaps.mediaFormats）。
 */
export function yanShouGeShi(have: string | GuiFanGeShi, jieShou: GuiFanGeShi[]): YanShouJieGuo {
  const you = (typeof have === 'string' ? jianBieGeShi(have) : have) as GuiFanGeShi;
  if (you === 'unknown') {
    return { ok: false, action: 'reject', reason: `format-unknown（识别不出「${String(have).slice(0, 40)}」是什么格式）` };
  }
  if (!Array.isArray(jieShou) || !jieShou.length) {
    // 没有清单 = 不设限（但仍然要求能识别）
    return { ok: true, action: 'pass' };
  }
  if (jieShou.includes(you)) return { ok: true, action: 'pass' };
  const to = zhuanHuanMuBiao(you, jieShou);
  if (!to) {
    return {
      ok: false,
      action: 'reject',
      reason: `format-unsupported（该模型只收 ${jieShou.join('/')}，收到 ${you}）`,
    };
  }
  return { ok: true, action: 'convert', to, reason: `${you} → ${to}` };
}

/**
 * 门禁入口：**调用方在发送前必须过这一关**。
 * 返回 `false` 表示**绝不能发**（调用方把 `reason` 如实带回界面）。
 */
export function biGuoMenJin(have: string | GuiFanGeShi, jieShou: GuiFanGeShi[]): { fa: boolean; jie: YanShouJieGuo } {
  const jie = yanShouGeShi(have, jieShou);
  return { fa: jie.action !== 'reject', jie };
}
