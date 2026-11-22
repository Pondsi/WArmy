/**
 * R287 P4-6：chat 式 TTS 唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 请求 chat/completions 合成语音；首选音色失败且端点回 voices 建议 ⇒ 用第一个建议音色重试一次（记 voice-corrected）；
 * 成功回 dataUrl（mime;base64），失败如实回 error/voices。URL 拼接/请求体/响应解析复用 @warmy/providers 纯函数；
 * fetch/审计窄注入；构造无副作用。
 */
import { pinJieUrl, taoTtsChatBody, jieXiTtsChatResponse } from '@warmy/providers';

export interface TtsGongYingXinXi { baseURL: string; apiKey?: string }
export interface TtsChatJieGuo { ok: boolean; dataUrl?: string; model?: string; voice?: string; error?: string; voices?: string[]; via?: string }
export interface TtsChatShiYiLai {
  fetch: (url: string, opts: unknown) => Promise<{ status: number; json: () => Promise<unknown> }>;
  auditLog: (op: string, detail: unknown) => void;
}

export function chuangJianTtsChatShi(yiLai: TtsChatShiYiLai) {
  async function ttsChatShi(an: TtsGongYingXinXi, mo: string, text: string, voice: string, speed: number): Promise<TtsChatJieGuo> {
    const yong = async (v: string) => {
      const r = await yiLai.fetch(pinJieUrl(an.baseURL, 'chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(an.apiKey ? { Authorization: `Bearer ${an.apiKey}` } : {}) },
        body: JSON.stringify(taoTtsChatBody({ model: mo, text: text, voice: v || undefined, format: 'wav', speed })),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, jie: jieXiTtsChatResponse(j, 'wav') };
    };
    let r = await yong(voice);
    if (!r.jie.ok && r.jie.voices && r.jie.voices.length) {
      const dai = r.jie.voices[0]!;
      const r2 = await yong(dai);
      if (r2.jie.ok) {
        try { yiLai.auditLog('tts.voice-corrected', { model: mo, from: voice, to: dai }); } catch { /* noop */ }
        return { ok: true, dataUrl: `data:${r2.jie.mime};base64,${r2.jie.audioBase64}`, model: mo, voice: dai, via: 'chat-completions' };
      }
    }
    if (r.jie.ok) return { ok: true, dataUrl: `data:${r.jie.mime};base64,${r.jie.audioBase64}`, model: mo, voice, via: 'chat-completions' };
    return { ok: false, error: r.jie.error || ('tts HTTP ' + r.status), ...(r.jie.voices ? { voices: r.jie.voices } : {}) };
  }
  return { ttsChatShi };
}