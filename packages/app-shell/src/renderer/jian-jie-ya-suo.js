/* R294-2 工程级简洁视图（单一 owner，经典脚本；渲染层与探针共用同一份，不另写一套）。
 * 宿主侧抽取式压缩：零 LLM、确定性、模型无关。压的是「视图」不是原文——
 * 原文完整保留可展开，创造性零损失。中文分句＋去句首话语标记＋lead-bias/内容词密度打分，
 * 按原序取 ≤maxJu 句。短文（≤duanWen 字）与含代码块（```）原样返回。
 * R295：① 抽取式默认（零模型成本）；分句器参数（duanWen/话语标记/leadBias/密度权/长度惩罚）
 * 由 harness 自我改进裁决可调（peiZhi 入参，模型改进分句器）；启用受用户「简洁输出」勾选总闸＋守卫裁决。 */
(() => {
  'use strict';
  const MO_REN_BIAO_JI = ['首先', '其次', '再次', '最后', '总而言之', '综上所述', '总的来说', '总体来看', '不得不说', '值得一提的是', '可以说', '某种程度上', '众所周知', '简单来说', '换句话说', '也就是说', '需要注意的是', '需要指出的是', '不可否认'];
  const MO_REN_LEAD = [2, 1, 0];
  const zhuanYi = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function biaoJiZhengZe(biaoJi) {
    const lie = (Array.isArray(biaoJi) && biaoJi.length ? biaoJi : MO_REN_BIAO_JI).map((x) => String(x || '').trim()).filter(Boolean);
    if (!lie.length) return null;
    try { return new RegExp('^(?:' + lie.map(zhuanYi).join('|') + ')[，,：:、\\s]*'); } catch { return null; }
  }
  function jianJieYaSuo(wen, maxJu, peiZhi) {
    const pz = peiZhi || {};
    const n = Math.max(1, Math.min(6, Math.round(Number(maxJu || pz.maxJu || 3))));
    const duanWen = Number(pz.duanWen) > 0 ? Number(pz.duanWen) : 120;
    const lead = Array.isArray(pz.leadBias) && pz.leadBias.length ? pz.leadBias : MO_REN_LEAD;
    const miDuQuan = Number.isFinite(Number(pz.miDuQuan)) ? Number(pz.miDuQuan) : 2;
    const changFa = Number(pz.changFa) > 0 ? Number(pz.changFa) : 200;
    const zhengZe = biaoJiZhengZe(pz.huaYuBiaoJi);
    const s = String(wen || '').trim();
    if (s.length <= duanWen) return s;
    if (/```/.test(s)) return s;
    const ju = s.split(/(?<=[。！？；!?;\n])/).map((x) => x.trim()).filter(Boolean);
    if (ju.length <= n) return s;
    const qing = ju.map((j) => (zhengZe ? j.replace(zhengZe, '') : j).trim()).filter(Boolean);
    if (qing.length <= n) return qing.join('');
    const deFen = (j, i) => {
      const zi = j.replace(/[的了是在和与及或等就都也还又很太更最]/g, '');
      const miDu = j.length ? zi.length / j.length : 0;
      const lb = Number(lead[i]) || 0;
      return lb + miDu * miDuQuan - Math.max(0, j.length - 80) / changFa;
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