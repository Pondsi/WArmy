/* R294-2 工程级简洁视图（单一 owner，经典脚本；渲染层与探针共用同一份，不另写一套）。
 * 宿主侧抽取式压缩：零 LLM、确定性、模型无关。压的是「视图」不是原文——
 * 原文完整保留可展开，创造性零损失。中文分句＋去句首话语标记＋lead-bias/内容词密度打分，
 * 按原序取 ≤maxJu 句。短文（≤120 字）与含代码块（```）原样返回。
 * 是否启用由 harness 自我改进守卫 concise-view 裁决（无手动开关）。 */
(() => {
  'use strict';
  const HUA_YU_BIAO_JI = /^(首先|其次|再次|最后|总而言之|综上所述|总的来说|总体来看|不得不说|值得一提的是|可以说|某种程度上|众所周知|简单来说|换句话说|也就是说|需要注意的是|需要指出的是|不可否认)[，,：:、\s]*/;
  function jianJieYaSuo(wen, maxJu) {
    const n = maxJu || 3;
    const s = String(wen || '').trim();
    if (s.length <= 120) return s;
    if (/```/.test(s)) return s;
    const ju = s.split(/(?<=[。！？；!?;\n])/).map((x) => x.trim()).filter(Boolean);
    if (ju.length <= n) return s;
    const qing = ju.map((j) => j.replace(HUA_YU_BIAO_JI, '').trim()).filter(Boolean);
    if (qing.length <= n) return qing.join('');
    const deFen = (j, i) => {
      const zi = j.replace(/[的了是在和与及或等就都也还又很太更最]/g, '');
      const miDu = j.length ? zi.length / j.length : 0;
      return (i === 0 ? 2 : i === 1 ? 1 : 0) + miDu * 2 - Math.max(0, j.length - 80) / 200;
    };
    const pai = qing.map((j, i) => ({ j, i, f: deFen(j, i) }))
      .sort((a, b) => b.f - a.f)
      .slice(0, n)
      .sort((a, b) => a.i - b.i);
    const ya = pai.map((x) => x.j).join('');
    return ya && ya.length < s.length ? ya : s;
  }
  const gen = typeof window !== 'undefined' ? window : globalThis;
  gen.WarmyJianJie = { jianJieYaSuo };
  if (typeof module !== 'undefined' && module.exports) module.exports = { jianJieYaSuo };
})();
