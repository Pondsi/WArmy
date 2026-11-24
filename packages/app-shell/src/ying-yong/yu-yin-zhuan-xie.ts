/**
 * R287 P4-5：音频附件转写委托唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 附件不受话筒开关/语言影响：过滤音频附件（dataUrl audio/扩展名）→ 上传转码 dataUrl 优先（不读回压缩原件）→
 * 格式别名归一（mpeg→mp3/x-wav→wav/mp4→m4a/oga→ogg…）→ 统一转写管线 → 单条直出/多条带名前缀。
 * **失败必须抛给调用方终止，不可冒充专业模型的转写结果**。文件读取/转写管线/审计/错误净化窄注入；构造无副作用。
 */
export interface YinPinFuJian { path?: string; name?: string; dataUrl?: string }
export interface ZhuanXieJieGuo { ok: boolean; text?: string; model?: string; error?: string; source: string }
export interface YuYinZhuanXieYiLai {
  wenJianCunZai: (lu: string) => boolean;
  duWenJian: (lu: string) => Buffer;
  zhuanXie: (buf: Buffer, geShi: string, source: 'attachment') => Promise<ZhuanXieJieGuo>;
  auditLog: (op: string, detail: unknown) => void;
  jingCuoWu: (e: unknown) => string;
}

export function chuangJianYuYinZhuanXie(yiLai: YuYinZhuanXieYiLai) {
  function shiYinPinFuJian(a: YinPinFuJian): boolean {
    return /^data:audio\//i.test(String(a?.dataUrl || ''))
      || /\.(mp3|wav|m4a|ogg|oga|opus|flac|webm)$/i.test(String(a?.path || a?.name || ''));
  }

  /** 附件不受话筒开关/语言影响。失败必须抛给调用方终止，不可冒充专业模型的转写结果。 */
  async function yuYinZhuanXie(att: YinPinFuJian[]): Promise<string | null> {
    const yinPin = (att || []).filter(shiYinPinFuJian);
    if (!yinPin.length) return null;
    const wen: string[] = [];
    for (const a of yinPin) {
      try {
        let buf: Buffer | null = null;
        let geShi = '';
        // 上传转码后的 dataUrl 优先，不能又读回 path 指向的压缩原件。
        if (/^data:audio\//i.test(String(a.dataUrl || ''))) {
          buf = Buffer.from(String(a.dataUrl).replace(/^data:[^,]*,/, ''), 'base64');
          geShi = (/^data:audio\/([a-z0-9.+-]+)/i.exec(String(a.dataUrl))?.[1] || '').toLowerCase();
        } else if (a.path && yiLai.wenJianCunZai(a.path)) {
          buf = yiLai.duWenJian(a.path);
          geShi = String(a.path).toLowerCase().replace(/^.*\./, '');
        }
        if (!buf?.length) throw new Error('audio-attachment-read-failed（音频附件为空或无法读取）');
        const aliases: Record<string, string> = { mpeg: 'mp3', 'x-wav': 'wav', wave: 'wav', mp4: 'm4a', 'x-m4a': 'm4a', oga: 'ogg' };
        geShi = aliases[geShi] || geShi;
        const r = await yiLai.zhuanXie(buf, geShi || 'wav', 'attachment');
        if (!r.ok || !r.text?.trim()) throw new Error(r.error || 'asr-empty-result');
        wen.push(yinPin.length === 1 ? r.text : `${a.name || a.path || '音频附件'}：${r.text}`);
        try { yiLai.auditLog('asr.used', { model: r.model, chars: r.text.length, source: r.source }); } catch { /* noop */ }
      } catch (e) {
        const error = `${a.name || a.path || '音频附件'}: ${yiLai.jingCuoWu(e)}`;
        try { yiLai.auditLog('asr-delegate.failed', { error: error.slice(0, 160) }); } catch { /* noop */ }
        throw new Error(error);
      }
    }
    return wen.join('\n');
  }

  return { shiYinPinFuJian, yuYinZhuanXie };
}