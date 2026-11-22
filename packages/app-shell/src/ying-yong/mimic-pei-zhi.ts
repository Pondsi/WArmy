/**
 * R287 P4-1：拟态配置/模型解析唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · mimicYuYinPeiZhi：语音互动模式/唤醒词/判断模型派生（缺省 smart/[]/''）；
 *  · mimicDangQianMoXing：当前模型回落（实例 currentModel → 链首个未禁用 → defaultModel → 全局 activeProvider → 首个真有模型的供应商 → ''）；
 *  · mimicMoXingLian：生成调用链（去重顺延：实例 currentModel＋链未禁用＋defaultModel＋全局＋各供应商）。
 * 纯派生、无副作用；设置快照与拟态会话 id 窄注入。构造无副作用（闭包懒引用）。
 */
export interface MimicPeiZhiYiLai {
  duSheZhi: () => unknown;
  mimicSid: string;
}

export function chuangJianMimicPeiZhi(yiLai: MimicPeiZhiYiLai) {
  /** 拟态语音互动配置（设置里录入） */
  function mimicYuYinPeiZhi(): { moShi: string; ci: string[]; panDuan: string } {
    try {
      const s = yiLai.duSheZhi() as {
        mimicVoiceMode?: string; mimicWakeWords?: string[]; mimicPanDuanMoXing?: string;
      } | undefined;
      const moShi = String(s?.mimicVoiceMode || 'smart');
      const ci = Array.isArray(s?.mimicWakeWords) ? s?.mimicWakeWords.map(String).filter((x) => x.trim()) : [];
      return { moShi, ci, panDuan: String(s?.mimicPanDuanMoXing || '') };
    } catch { return { moShi: 'smart', ci: [], panDuan: '' }; }
  }

  /** 拟态当前模型：设置页「当前模型」优先，否则调用链第一个未禁用，否则回退全局默认 */
  function mimicDangQianMoXing(): string {
    try {
      const s = yiLai.duSheZhi() as { instances?: Array<{ id?: string; currentModel?: string; chain?: string[]; chainDisabled?: string[]; defaultModel?: string }>; activeProvider?: { model?: string }; providers?: Array<{ id?: string; protocol?: string; models?: string[]; defaultModel?: string }> } | undefined;
      const inst = (s?.instances || []).find((x) => x.id === yiLai.mimicSid);
      if (inst) {
        if (String(inst.currentModel || '').trim()) return String(inst.currentModel).trim();
        const lian = Array.isArray(inst.chain) ? inst.chain : [];
        const jin = new Set(Array.isArray(inst.chainDisabled) ? inst.chainDisabled : []);
        const shou = lian.find((m) => m && !jin.has(m));
        if (shou) return shou;
        if (String(inst.defaultModel || '').trim()) return String(inst.defaultModel).trim();
      }
      /* R243 报障10：拟态未配模型⇒回退全局当前供应商模型；仍空则挑第一个「真有模型」的供应商
       * （跳过空供应商，如第一个空 deepseek）——避免 AI 捏脸因 model-not-configured 无法生成。 */
      const ap = String(s?.activeProvider?.model || '').trim();
      if (ap) return ap;
      for (const p of (s?.providers || [])) {
        const m = String(p?.defaultModel || '').trim() || String((p?.models || [])[0] || '').trim();
        if (m) return m;
      }
      return '';
    } catch { return ''; }
  }

  /** R246：拟态生成（2D捏脸/3D）按调用链顺序尝试的模型列表——第一个失败顺延下一个。 */
  function mimicMoXingLian(): string[] {
    const out: string[] = [];
    const push = (m: unknown) => { const v = String(m || '').trim(); if (v && !out.includes(v)) out.push(v); };
    try {
      const s = yiLai.duSheZhi() as { instances?: Array<{ id?: string; currentModel?: string; chain?: string[]; chainDisabled?: string[]; defaultModel?: string }>; activeProvider?: { model?: string }; providers?: Array<{ defaultModel?: string; models?: string[] }> } | undefined;
      const inst = (s?.instances || []).find((x) => x.id === yiLai.mimicSid);
      if (inst) {
        push(inst.currentModel);
        const jin = new Set(Array.isArray(inst.chainDisabled) ? inst.chainDisabled : []);
        for (const m of (Array.isArray(inst.chain) ? inst.chain : [])) if (!jin.has(m)) push(m);
        push(inst.defaultModel);
      }
      push(s?.activeProvider?.model);
      for (const p of (s?.providers || [])) { push(p?.defaultModel); push((p?.models || [])[0]); }
    } catch { /* noop */ }
    return out;
  }

  return { mimicYuYinPeiZhi, mimicDangQianMoXing, mimicMoXingLian };
}