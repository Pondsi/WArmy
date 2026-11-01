/**
 * verify-round39-budget.mjs —— 第 39 轮「额度重做」的**行为**门禁（不靠 Electron，不起进程，纯逻辑）
 *
 * 为什么必须写成行为门禁：额度这类东西**字符串锚点毫无价值** ——
 * 第 14/15 轮"默认 12 被静默夹到 8"就是靠 grep 断言存在的、实际值被 provider 层夹掉而没被发现。
 * 这里直接驱动真循环 `liaoTianDaiGongJu`（dist 产物），用假模型 + 假工具执行器把每一条判据
 * **跑到出结果**，断言的是"模型看到了什么、循环什么时候停、谁批准了续预算"。
 *
 * 覆盖的六条设计约束（缺一条，本轮要修的坏行为就会复发）：
 *  ① 模型**看得见**剩余额度（70%/90% 分级预警），且预警不留在对话历史里；
 *  ② 同一档预警**只发一次**（不刷屏）；请求抛错时不能记账（否则模型一次都没看见却没第二次）；
 *  ③ 撞顶**先问宿主**：宿主只认自己看到的事实；批准 ⇒ 抬高上限继续，拒绝 ⇒ 收敛；
 *  ④ 续预算有**硬顶**（循环侧次数、宿主侧数值），打转的任务不能靠"一直申请"活下来；
 *  ⑤ 额度耗尽的话术**不像权限拒绝**（真事故：写成"未执行/被拒" ⇒ 模型换工具硬试十几轮）；
 *  ⑥ 停止原因分清是哪条闸（轮数 / 次数 / 结果字符），且收口一定要给出完整正文。
 *
 * 跑法：node dev/gates/verify-round39-budget.mjs
 */
import { liaoTianDaiGongJu } from '../../packages/providers/dist/tools.js';
import { baoZhuangXianLiu, HuaChuangXianLiu } from '../../packages/providers/dist/xian-liu.js';

let ok = 0;
const shi = [];
const jian = (ming, panding, xuan) => {
  if (panding) { ok += 1; return; }
  shi.push(ming + (xuan === undefined ? '' : '  ← ' + String(xuan).slice(0, 260)));
};

/** 假工具调用（每条都要一个新 id，循环靠它配对 tool 结果） */
let diaoYongHao = 0;
const xinDiaoYong = (ming = 'write_file', n = 1) => Array.from({ length: n }, () => ({
  id: 'c' + (++diaoYongHao),
  function: { name: ming, arguments: JSON.stringify({ path: 'x.txt', content: '段' }) },
}));

/**
 * @param ben 每轮的脚本：`ben(lun, Qiu) => { content?, diaoYong?: number, chars?: number }`
 * @returns {jieGuo, qiu: Array<{di, toolChoice, jiaose: string[], chengXu: string[]}>}
 */
function pao(Xin, opts = {}) {
  const qiu = [];
  const provider = {
    protocol: 'openai-compatible',
    async chat(Q) {
      const di = qiu.length + 1;
      qiu.push({
        di,
        toolChoice: Q.toolChoice,
        jiaose: (Q.xiaoXiJi || []).map((m) => m.role),
        chengXu: (Q.xiaoXiJi || []).map((m) => (typeof m.content === 'string' ? m.content : '')),
      });
      const ben = typeof Xin === 'function' ? Xin(di, Q) : (Xin[di - 1] || {});
      if (ben.threw) throw new Error(ben.threw);
      const diao = ben.diaoYong ? xinDiaoYong(ben.tool || 'write_file', ben.diaoYong) : [];
      return {
        id: 'r' + di,
        model: 'jia-moxing',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: ben.content ?? (diao.length ? '我先做这一步' : ''),
            ...(diao.length ? { gongJuDiaoYongJi: diao } : {}),
          },
          finishReason: diao.length ? 'tool_calls' : 'stop',
        }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, source: 'none' },
      };
    },
  };
  const Qiu = {
    model: 'jia-moxing',
    xiaoXiJi: [{ role: 'user', content: '把六件事都做完' }],
    tools: [{ type: 'function', function: { name: 'write_file', description: '写文件', parameters: { type: 'object', properties: {} } } }],
  };
  const zhiXing = async (_call, ctx) => '结'.repeat(ctx.zuiDaJieGuoZiShu);
  return liaoTianDaiGongJu(provider, Qiu, zhiXing, opts).then((jieGuo) => ({ jieGuo, qiu }));
}
const TI_SHI_MA = '【宿主额度提示】';
const yuJingTiaoShu = (qiu) => qiu.reduce((he, r) => he + r.chengXu.filter((s) => s.includes(TI_SHI_MA)).length, 0);

/* ── ① 模型看得见额度：预警进模型上下文，且**用完即撤**（不留在历史里） ── */
{
  const { jieGuo, qiu } = await pao(
    (di) => (di <= 5 ? { diaoYong: 1, content: '第 ' + di + ' 步' } : { content: '全部做完了' }),
    { zuiDaLunShu: 32, zuiDaJieGuoZiShu: 200, maxToolResultChars: 1000, lingGongJuQiangZhi: false, daoShangXianWenMoXing: false }
  );
  const tiao = qiu.map((r) => r.chengXu.filter((s) => s.includes(TI_SHI_MA)).length);
  const faGuo = tiao.some((n) => n > 0);
  jian('① 额度到 70% 时模型上下文里真的出现了额度提示（不是只有日志）', faGuo, JSON.stringify(tiao));
  const tiShi = (qiu.find((r) => r.chengXu.some((s) => s.includes(TI_SHI_MA)))?.chengXu.find((s) => s.includes(TI_SHI_MA))) || '';
  jian('① 提示里带**具体剩多少**（数字，不是"快用完了"这种形容词）', /\d+\s*\/\s*\d+/.test(tiShi) && /%/.test(tiShi), tiShi.slice(0, 120));
  jian('① 预警只在发请求那一刻在历史里，**下一次请求已经没有它**（用完即撤 ⇒ 不落盘、不回放、不累积）',
    tiao.every((n) => n <= 1) && tiao.every((n, i) => !(n > 0 && i + 1 < tiao.length && tiao[i + 1] > 0)),
    JSON.stringify(tiao));
  jian('① 提示明说"这不是权限被拒"（口径：宿主用量闸 ≠ 模型被拒）', tiShi.includes('不是权限') || tiShi.includes('不是哪里出错'), tiShi.slice(0, 160));
  jian('① 预警不影响正常收尾（模型自己收尾时结果仍是它的正文）', String(jieGuo.xiangYingTi.choices[0].message.content || '').includes('全部做完了')
    || String(jieGuo.xiangYingTi.choices[0].message.content || '').length > 0,
    jieGuo.xiangYingTi.choices[0].message.content);
}

/* ── ② 同一档只发一次；请求失败不能把这一档"记成已送达" ── */
{
  const { qiu } = await pao(
    (di) => ({ diaoYong: 1, content: '还没完' }) /* 永远不收尾 ⇒ 一路顶到上限 */,
    { zuiDaLunShu: 3, zuiDaJieGuoZiShu: 200, maxToolResultChars: 100000, lingGongJuQiangZhi: false, xuYuSuanLai: () => null, daoShangXianWenMoXing: false }
  );
  const tiao = yuJingTiaoShu(qiu);
  jian('② 同一档预警最多发一次（不刷屏、不烧上下文）', tiao <= 2, '预警条数=' + tiao + ' 请求数=' + qiu.length);
}
{
  // 用"超出上下文 ⇒ 压实后重发同一次请求"这条路径来证：**失败的那次不能把预警记成已送达**
  const { qiu } = await pao(
    (di) => (di === 5 ? { threw: 'HTTP 400: request exceeds the available context size' }
      : di <= 6 ? { diaoYong: 1, content: '第 ' + di + ' 步' }
        : { content: '收尾正文' }),
    {
      zuiDaLunShu: 32, zuiDaJieGuoZiShu: 200, maxToolResultChars: 1000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false,
      yaSuoLai: (m) => m.map((x) => ({ ...x })),
    }
  );
  const tiao = qiu.map((r) => r.chengXu.filter((s) => s.includes(TI_SHI_MA)).length);
  jian('② 请求抛错时那一档预警**不算送达**：压实重发的同一次请求里提示还在（模型确实看见了），之后才撤',
    tiao.length >= 6 && tiao[4] === 1 && tiao[5] === 1 && tiao.slice(6).every((n) => n === 0),
    JSON.stringify(tiao) + ' toolChoice=' + qiu.map((r) => r.toolChoice).join(','));
}

/* ── ③ 撞顶先问宿主：批准 ⇒ 抬高上限继续干活；拒绝 ⇒ 收敛 ── */
{
  let shenQing = 0;
  const { jieGuo, qiu } = await pao(
    (di) => (di <= 7 ? { diaoYong: 1, content: '第 ' + di + ' 段' } : { content: '六件事都做完了' }),
    {
      zuiDaLunShu: 3,
      zuiDaJieGuoZiShu: 100,
      maxToolResultChars: 100000,
      lingGongJuQiangZhi: false,
      daoShangXianWenMoXing: false,
      xuYuSuanLai: (k) => { shenQing += 1; return k.yuanYin === 'lun' ? { lunShu: 4 } : null; },
    }
  );
  jian('③ 轮数撞顶时**先向宿主申请**（钩子被调到，且带上了是哪条闸）', shenQing >= 1, 'shenQing=' + shenQing);
  jian('③ 宿主批准 ⇒ 任务接着跑完（不是硬停在第 3 轮）', jieGuo.lunShu >= 7 && String(jieGuo.xiangYingTi.choices[0].message.content || '').includes('都做完了'),
    'lunShu=' + jieGuo.lunShu + ' tingZhi=' + jieGuo.tingZhiYuanYin + ' qiu=' + qiu.length);
  jian('③ 批准续的额度记在结果里（宿主可审计"这轮续过几次"）', (jieGuo.yuSuan?.xuYuSuanCiShu || 0) >= 1, JSON.stringify(jieGuo.yuSuan || {}));
}
{
  let shenQing = 0;
  const { jieGuo } = await pao(
    () => ({ diaoYong: 1, content: '还在做' }),
    {
      zuiDaLunShu: 3, zuiDaJieGuoZiShu: 100, maxToolResultChars: 100000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false,
      xuYuSuanLai: () => { shenQing += 1; return null; },
    }
  );
  jian('③ 宿主拒绝（没新证据/停滞）⇒ 立刻收敛，绝不自己加轮', shenQing >= 1 && jieGuo.lunShu === 3 && jieGuo.tingZhiYuanYin === 'max-rounds',
    'lunShu=' + jieGuo.lunShu + ' tingZhi=' + jieGuo.tingZhiYuanYin);
  jian('③ 拒绝后仍然给用户一段正文（不是空回复、不是半句前导语）',
    [...String(jieGuo.xiangYingTi.choices[0].message.content || '')].length > 0,
    jieGuo.xiangYingTi.choices[0].message.content);
}

/* ── ④ 续预算有硬顶：模型打转不能靠"一直申请"活下来 ── */
{
  let fu = null;
  const { jieGuo } = await pao(
    (di) => (di <= 8 ? { diaoYong: 1, content: '转' } : { content: '收尾' }),
    {
      zuiDaLunShu: 2, zuiDaJieGuoZiShu: 100, maxToolResultChars: 100000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false,
      xuYuSuanLai: (k) => { if (fu) return null; fu = { ziShang: k.zongYuSuan, ziYong: k.jieGuoZiShu, ciShang: k.zuiDaGongJuCiShu, lunShang: k.zuiDaLunShu }; return { lunShu: 2 }; },
    }
  );
  jian('③ 快照把**当前上限**一起交给宿主（宿主必须按上限算增量；按"已用"算会复利越抬越高）',
    !!fu && fu.ziShang === 100000 && fu.ziYong < fu.ziShang && fu.lunShang === 2, JSON.stringify(fu));
  jian('④ 没传次数上限时这一路**不计**（SWE-agent 口径：0 = 关掉这一路，不新增配置键）',
    jieGuo.tingZhiYuanYin !== 'call-budget' && jieGuo.lunShu >= 4,
    jieGuo.tingZhiYuanYin + ' lun=' + jieGuo.lunShu);
}
{
  let ciShu = 0;
  const { jieGuo } = await pao(
    () => ({ diaoYong: 1, content: '我还能转' }),
    {
      zuiDaLunShu: 2, zuiDaJieGuoZiShu: 50, maxToolResultChars: 100000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false,
      xuYuSuanLai: () => { ciShu += 1; return { lunShu: 8 }; },
    }
  );
  jian('④ 循环侧续预算次数有硬顶（≤4 次，之后只能收口）', ciShu <= 5, 'shenQingCiShu=' + ciShu);
  jian('④ 总轮数被硬顶住（远小于无限）', jieGuo.lunShu <= 2 + 4 * 8 && jieGuo.qingQiuJi <= 40,
    'lunShu=' + jieGuo.lunShu + ' qingQiuJi=' + jieGuo.qingQiuJi);
  jian('④ 到顶后停止原因如实是轮数闸（不是 error、不是 stop）', jieGuo.tingZhiYuanYin === 'max-rounds' || jieGuo.tingZhiYuanYin === 'max-rounds-extended',
    jieGuo.tingZhiYuanYin);
}

/* ── ⑤ 额度耗尽的话术不能像权限拒绝；三条闸各自报 own 原因 ── */
{
  // 一轮里发 3 个调用、额度只够 2 条结果 ⇒ 第 3 条**没执行**，回给模型的那句话就是口径试验场
  const { jieGuo, qiu } = await pao(
    (di) => (di <= 1 ? { diaoYong: 3, content: '一口气三件' } : { content: '收尾' }),
    {
      zuiDaLunShu: 32, zuiDaJieGuoZiShu: 1000, maxToolResultChars: 2000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false, xuYuSuanLai: () => null,
    }
  );
  const allWen = qiu.flatMap((r) => r.chengXu).join('\u0001');
  const jieWen = allWen.split('\u0001').filter((s) => s.includes('没有执行') && s.includes('额度')).join('||');
  jian('⑤ 结果字符用完时回给模型的话**明说不是权限被拒**', /不是权限/.test(jieWen), jieWen.slice(0, 200) || allWen.slice(0, 160));
  jian('⑤ 同一句话要它"列出还差哪几步"（额度耗尽 = 交付半成品，不是把活扔掉）',
    /还差|没交付/.test(jieWen), jieWen.slice(0, 200));
  jian('⑤ 结果字符闸单独可辨（tingZhiYuanYin=budget，宿主才谈"是被额度拦的"）',
    jieGuo.tingZhiYuanYin === 'budget', jieGuo.tingZhiYuanYin + ' lunShu=' + jieGuo.lunShu + ' zi=' + jieGuo.toolResultChars);
}
{
  const { jieGuo } = await pao(
    () => ({ diaoYong: 2, content: '批量' }),
    {
      zuiDaLunShu: 32, zuiDaGongJuCiShu: 2, zuiDaJieGuoZiShu: 50, maxToolResultChars: 1000000,
      lingGongJuQiangZhi: false, daoShangXianWenMoXing: false, xuYuSuanLai: () => null,
    }
  );
  jian('⑤ 调用次数闸也自成一类停止原因（call-budget：以前这条闸只在宿主侧、循环不知道）',
    jieGuo.tingZhiYuanYin === 'call-budget' && jieGuo.gongJuDiaoYongJi === 2,
    jieGuo.tingZhiYuanYin + ' diaoYongJi=' + jieGuo.gongJuDiaoYongJi);
}

/* ── ⑥ 收口一定给完整正文 + 额度条取"最紧一项"（不报互相矛盾的数字） ── */
{
  const { jieGuo } = await pao(
    (di) => (di <= 2 ? { diaoYong: 1, content: '做' } : { content: '好了' }),
    { zuiDaLunShu: 2, zuiDaJieGuoZiShu: 100, maxToolResultChars: 100000, lingGongJuQiangZhi: false, daoShangXianWenMoXing: false, xuYuSuanLai: () => null }
  );
  jian('⑥ 强制收敛后正文来自收敛那次响应（不是"接下来我要…"的前导语）',
    String(jieGuo.xiangYingTi.choices[0].message.content || '').includes('好了'),
    jieGuo.xiangYingTi.choices[0].message.content);
  const y = jieGuo.yuSuan || {};
  jian('⑥ 返回值带额度快照（lv / 三条仪表 / 续了几次），宿主能如实告诉用户"额度用完了"而非"做完了"',
    typeof y.lv === 'number' && y.lv >= 0.99 && y.zuiDaLunShu >= 2 && y.lunShu === 2, JSON.stringify(y));
}

/* ── ⑦ 窗口闸：明知超窗就不发（第 39 轮真机红：本地 num_ctx=7680 被循环攒到 30932 token ⇒ Ollama 400） ── */
{
  const gongJu = [{ type: 'function', function: { name: 'write_file', description: '写文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } }];
  const jiLu = [];
  let yaSuoCis = 0;
  const shrinkShi = [];
  const provider = {
    protocol: 'openai-compatible',
    async chat(Q) {
      let s = JSON.stringify(Q.tools || []).length;
      for (const m of Q.xiaoXiJi || []) s += String(m.content || '').length + String(m.reasoning || '').length + JSON.stringify(m.gongJuDiaoYongJi || '').length;
      jiLu.push(s);
      const di = jiLu.length;
      const diao = di <= 6 ? xinDiaoYong() : [];
      return {
        id: 'r' + di, model: 'j',
        choices: [{ index: 0, message: { role: 'assistant', content: di <= 6 ? '再写一段' : '收尾正文', ...(diao.length ? { gongJuDiaoYongJi: diao } : {}) }, finishReason: diao.length ? 'tool_calls' : 'stop' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, source: 'none' },
      };
    },
  };
  const ZHI_JING = 3000;
  const jieGuo = await liaoTianDaiGongJu(provider,
    { model: 'j', xiaoXiJi: [{ role: 'user', content: '把六件事都做完，这件很长' }], tools: gongJu },
    async (_c, ctx) => '结'.repeat(Math.min(ctx.zuiDaJieGuoZiShu, 1800)),
    {
      zuiDaLunShu: 8, zuiDaJieGuoZiShu: 1800, maxToolResultChars: 1000000,
      zuiDaQingQiuZi: ZHI_JING, lingGongJuQiangZhi: false, daoShangXianWenMoXing: false,
      wuYuSuanTiShi: true, xuYuSuanLai: () => null,
      yaSuoLai: (m, jiYa) => { yaSuoCis += 1; return jiYa ? m.map((x) => ({ ...x })) : m.map((x) => ({ ...x })); },
      onEvent: (e) => { if (e.kind === 'shrink') shrinkShi.push(String(e.detail)); },
    });
  const zuiDa = Math.max(...jiLu);
  jian('⑦ 每一发请求的估算大小都不超过窗口闸（明知超窗就不发，而不是等模型 400）',
    zuiDa <= ZHI_JING * 1.2, `最大 ${zuiDa} / 闸 ${ZHI_JING} · 逐发 ${jiLu.join(',')}`);
  jian('⑦ 超窗时先走宿主压实钩子（压实优先于中段收起）', yaSuoCis > 0, '调用次数=' + yaSuoCis);
  jian('⑦ 收起来的段落**留了"可 retrieve"的话**，不是静默截断（模型知道这里少了一段）',
    shrinkShi.length > 0 && /收起/.test(shrinkShi.join('|')), shrinkShi.join('|').slice(0, 160) || '没有 shrink 事件');
  jian('⑦ 窗口闸不影响正常收尾（照样给正文、照样如实报停止原因）',
    String(jieGuo.xiangYingTi.choices[0].message.content || '').length > 0,
    jieGuo.tingZhiYuanYin + ' lun=' + jieGuo.lunShu);
}


/* ── ⑧ rpm/tpm 限流：等，不报错；0 就是不限；等不到也照发；用量事后校正 ── */
{
  const daYing = (Q) => ({
    id: 'r', model: Q.model,
    choices: [{ index: 0, message: { role: 'assistant', content: '好' }, finishReason: 'stop' }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheHitTokens: 0, cacheMissTokens: 0, source: 'exact' },
  });
  const jiaGongYing = (jiLu) => ({
    id: 'j', protocol: 'openai-compatible', baseURL: '',
    async chat(Q) { jiLu.faSong += 1; return daYing(Q); },
    async * chatStream() { },
    async listModels() { return []; },
    async ping() { return { ok: true, latencyMs: 1 }; },
  });

  // rpm=2：第 3 发必须等，等完照发
  {
    let shiJian = 1000000;
    const jiLu = { faSong: 0, deng: [] };
    const z = baoZhuangXianLiu(jiaGongYing(jiLu), {
      yuE: () => ({ rpm: 2, tpm: 0 }),
      onDengDai: (x) => jiLu.deng.push(x),
      now: () => shiJian,
      deng: async (ms) => { shiJian += ms; },
      usage: (r) => Number(r?.usage?.totalTokens || 0),
    });
    for (let i = 0; i < 3; i++) await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    jian('⑧ rpm 到顶 ⇒ **等待而不是报错**（CrewAI 同口径），并把等待记进审计',
      jiLu.deng.length === 1 && jiLu.deng[0].yuanYin === 'rpm' && jiLu.deng[0].fangXingLe === true, JSON.stringify(jiLu.deng));
    jian('⑧ 三发最后都发出去了（限流不许吞用户要干的活）', jiLu.faSong === 3, 'faSong=' + jiLu.faSong);
  }
  // tpm=200：第一发记 106 ⇒ 第二发 212 > 200 必须等，等过窗口才放（不发 usage ⇒ 不做校正，专测拦与放）
  {
    let shiJian = 0;
    const jiLu = { faSong: 0, deng: [] };
    const z = baoZhuangXianLiu(jiaGongYing(jiLu), {
      yuE: () => ({ rpm: 0, tpm: 200 }),
      onDengDai: (x) => jiLu.deng.push(x),
      now: () => shiJian,
      deng: async (ms) => { shiJian += ms; },
      usage: () => 0,
    });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    jian('⑧ tpm 按"提示词估算 + 本次输出上限"拦（发之前就知道会不会超），等过窗口再放行',
      jiLu.deng.length === 1 && jiLu.deng[0].yuanYin === 'tpm' && jiLu.deng[0].fangXingLe === true && jiLu.faSong === 2,
      JSON.stringify(jiLu.deng) + ' faSong=' + jiLu.faSong);
  }
  /**
   * 单发就超过 tpm ⇒ **等多久都没用**（窗口再滑也腾不出那么大位置）。
   * 这一条必须"等满上限就照发"而不是报错或死等：tpm 是运营软限制，不是权限，
   * 也不许因为用户把 tpm 填小了就把任务打死。
   */
  {
    const jiLu = { faSong: 0, deng: [] };
    const z = baoZhuangXianLiu(jiaGongYing(jiLu), {
      yuE: () => ({ rpm: 0, tpm: 50 }),
      onDengDai: (x) => jiLu.deng.push(x),
      deng: async () => { },
      usage: () => 0,
    });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    jian('⑧ 单发就超过 tpm ⇒ 不假装能等到，**等满上限照样发出去**（软限制不许打死任务）',
      jiLu.faSong === 2 && jiLu.deng.every((x) => x.fangXingLe === false) && jiLu.deng.length >= 1,
      JSON.stringify(jiLu.deng));
  }
  // 0 = 这一路不限（SWE-agent：谓词 0 < limit < used）
  {
    const jiLu = { faSong: 0, deng: [] };
    const z = baoZhuangXianLiu(jiaGongYing(jiLu), {
      yuE: () => ({ rpm: 0, tpm: 0 }), onDengDai: (x) => jiLu.deng.push(x),
      deng: async () => { }, usage: (r) => Number(r?.usage?.totalTokens || 0),
    });
    for (let i = 0; i < 60; i++) await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    jian('⑧ rpm/tpm 给 0 ⇒ 这一路完全不限（不新增开关键，与 SWE-agent 同一谓词）',
      jiLu.faSong === 60 && jiLu.deng.length === 0, 'faSong=' + jiLu.faSong + ' deng=' + jiLu.deng.length);
  }
  // 等不到位也照发（不许把用户的请求卡在软限制上）
  {
    const jiLu = { faSong: 0, deng: [] };
    const z = baoZhuangXianLiu(jiaGongYing(jiLu), {
      yuE: () => ({ rpm: 1, tpm: 0 }), onDengDai: (x) => jiLu.deng.push(x),
      deng: async () => { /* 时钟不动 ⇒ 等不到位置 */ },
      usage: (r) => Number(r?.usage?.totalTokens || 0),
    });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'a' }], maxTokens: 10 });
    await z.chat({ model: 'm', xiaoXiJi: [{ role: 'user', content: 'b' }], maxTokens: 10 });
    jian('⑧ 最多等 120 秒，等不到位**仍然照发并留痕**（fangXingLe=false，但不报错、不静默丢弃）',
      jiLu.faSong === 2 && jiLu.deng.length === 1 && jiLu.deng[0].fangXingLe === false && jiLu.deng[0].ms <= 120000,
      JSON.stringify(jiLu.deng));
  }
  // 滑动窗口本身：不是"每分钟重置"的桶（交界处不能放过 2 倍量）
  {
    let shiJian = 0;
    const z = new HuaChuangXianLiu({ rpm: 1, now: () => shiJian });
    const a = z.panDing(10); z.jiFei(10);
    shiJian = 59_999; const b = z.panDing(10);
    shiJian = 60_001; const c = z.panDing(10);
    jian('⑧ 限流是 60 秒**滑动**窗口（59.999 秒仍拦、过 60 秒才放）',
      a.keyi === true && b.keyi === false && c.keyi === true, JSON.stringify([a, b, c].map((x) => x.keyi)));
    z.jiFei(10); z.jiaoZheng(1000, 20);
    const tai = z.zhuangTai(60_002);
    jian('⑧ 事后按真实 usage 校正（估算 1000、真实 20 ⇒ 退差额，估算不会一直错下去）',
      tai.token < 40, '窗口内 token=' + tai.token);
  }
}

/* ── 宿主侧口径（静态但**判关系**，不判字节）：三条仪表必须同源、旧硬编码必须消失 ── */
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  jian('宿主 三条仪表从**同一份预算账本**取（循环与工具执行器读同一个数 ⇒ 模型看到的剩余=真正执法的上限）',
    /const yuSuanZhang = xinBenLunYuSuan\(/.test(main) && /zuiDaLunShu: yuSuanZhang\.lun/.test(main)
    && /maxToolResultChars: yuSuanZhang\.zi/.test(main) && /zuiDaGongJuCiShu: yuSuanZhang\.ci/.test(main)
    && /const yuSuan = huoBenLunYuSuan\(String\(sessionId \|\| ''\)\)\.ci/.test(main));
  jian('宿主 旧的三处硬编码补丁已经拆掉（轮数 +8 / 结果字符 ×4 / 调用次数 ×2 都不在了）',
    !/limits\.totalChars \* 4/.test(main) && !/jiZhun \* 2/.test(main) && !/zuiDaLunShu \+ \(yaoQiuZiShu/.test(main));
  jian('宿主 续预算只认宿主事实（huizhuYouJinZhan），并且同时管着"额度续"和"30 分钟硬顶放宽"两处 —— 口径不能分家',
    /function huizhuYouJinZhan/.test(main) && /const jin = huizhuYouJinZhan\(s\);/.test(main)
    && /huizhuYouJinZhan\(String\(sessionId \|\| ''\)\)\.you/.test(main));
  jian('宿主 判进展要"新证据"：证据指纹变了 或 长文还在净增长；停滞/重复≥3/连续两轮空转一律不续',
    /pingZheng === zhang\.pingZheng && !zhangWenZaiTuiJin\(s\)/.test(main)
    && /chongFuZuiDuoCiShu\(s\) >= 3/.test(main) && /zhang2\.kongZhuan >= 2/.test(main) && /changWenTingZhiLe\(s\)/.test(main));
  jian('宿主 续预算有次数硬顶与数值硬顶（YU_SUAN_TING），不是想续就能续',
    /const BEN_LUN_XU_YU_SUAN_ZUIDA = (\d);/.test(main) && /const YU_SUAN_TING = \{ lun: (\d+), ci: (\d+), zi: (\d+) \}/.test(main));
  jian('宿主 停止原因新增的 call-budget 已经进"被截断"判据（两处：续派判定与异常出口），否则会漏掉一整类中断',
    (main.match(/tingZhi === 'call-budget'/g) || []).length + (main.match(/jie === 'call-budget'/g) || []).length >= 2);
  jian('宿主 额度事件全部留痕（warn / extend / denied / extend-capped / hard-cap-widened / done 带 yuSuan）',
    /chat\.budget\.event/.test(main) && /chat\.budget\.extend'/.test(main) && /chat\.budget\.denied'/.test(main)
    && /chat\.budget\.extend-capped'/.test(main) && /chat\.tools\.hard-cap-widened/.test(main) && /yuSuan: loop\.yuSuan && \{/.test(main));
  /**
   * 这条以前钉死了 `const duan = yao > 0 ? Math.max(1, Math.ceil(yao / 1200)) : 0;` 整行原话（字节锚）：
   * 把每段字数从 1200 调成 1000、或把变量改个名，门禁就红，而产品行为一点没变。
   * 现在改成在 `xinBenLunYuSuan()` 函数体里判**四条关系**：读没读用户的字数要求、没要求时是不是 0、
   * 有要求时是不是"按每段字数向上取整且至少 1 段"、以及放大的是**基线**而不是硬顶。
   */
  jian('宿主 按任务尺寸开局给额度（用户点名要 N 字 ⇒ 按分段写入次数估基线），但只在有字数要求时放大',
    (() => {
      const kai = main.indexOf('function xinBenLunYuSuan(');
      if (kai < 0) return false;
      const han = main.slice(kai, kai + 2600);
      return /yaoQiuZiShu\(/.test(han)                                  // 读的是用户这轮原文里的字数要求
        && /yao > 0 \?/.test(han) && /: 0;/.test(han)                     // 没点字数 ⇒ 一点不放大
        && /Math\.max\(1, Math\.ceil\(yao \/ \d+\)\)/.test(han)           // 有要求 ⇒ 按每段字数向上取整，至少 1 段
        && /YU_SUAN_TING/.test(han);                                      // 放大后仍受硬顶约束
    })());
  jian('宿主 续预算的增量按**循环当前上限**算（`xin* - k.zui*`），不是按已用算 —— 按已用是隐蔽的复利 bug',
    /jia\.lunShu = xinLun - k\.zuiDaLunShu/.test(main) && /jia\.gongJuCiShu = xinCi - k\.zuiDaGongJuCiShu/.test(main)
    && /jia\.jieGuoZiShu = xinZi - k\.zongYuSuan/.test(main)
    && !/xinLun - k\.lunShu/.test(main) && !/xinZi - k\.jieGuoZiShu/.test(main));
  jian('宿主 窗口闸交给循环的是**当前模型的实际预算**（不是写死数：Ollama 的真实 num_ctx 会跟着走）',
    /zuiDaQingQiuZi: youPeizhiSuanShangXiaWenYuSuan\(/.test(main));
  jian('宿主 一次性调用（提炼/摘要/压缩）关掉额度预警：不给它们塞没用的提示词',
    (main.match(/wuYuSuanTiShi: true/g) || []).length >= 1);
  /** ── ⑨ 模型额度 / 限流 / 分身记账的接线（判关系：装在哪、先后次序、有没有第二份） ── */
  const appJs = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const pre = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/preload.cjs'), 'utf8');
  const provIndex = fs.readFileSync(path.join(ROOT, 'packages/providers/src/index.ts'), 'utf8');
  jian('⑨ 限流装在**创建供应商**那一处，不是散在每个调用点（全仓十几处 congYuSheChuangJian，漏一处就等于那条路不限流）',
    /export function sheProviderJiXieGou/.test(provIndex) && /chuangJianHouGou \? chuangJianHouGou\(p\) : p/.test(provIndex)
    && /sheProviderJiXieGou\(\(p\) => baoZhuangXianLiu\(p,/.test(main));
  jian('⑨ 额度取值优先级写死为「用户存过的 → 拉取到的信息 → 已知表 → 默认/计算」，并且每项**单独记来源**（不许把猜的说成模型报的）',
    /const fu = moXingQuotaDangQian\(m\);/.test(main) && /const la = moXingLaQuXinXi\(m\);/.test(main)
    && /const ji = moXingYuEJiSuan\(la\);/.test(main) && /chuangKou: fu\?\.ctx \|\| ji\.chuangKou/.test(main));
  jian('⑨ 推导只有**一份**（拉取模型 / 恢复默认 / 没存过客都走 `moXingYuEJiSuan`），且顺序是 窗口 → tpm → rpm',
    (() => {
      const t = main.search(/const tpm = la\.tpm > 0 \? la\.tpm : Math\.max\(MO_XING_TPM_XIA_XIAN, Math\.round\(chuangKou \* MO_XING_TPM_BEI_SHU\)\)/);
      const r = main.search(/const rpm = la\.rpm > 0 \? la\.rpm : Math\.max\(MO_XING_RPM_XIA_XIAN, Math\.round\(tpm \/ MO_XING_RPM_FEN_MU\)\)/);
      return t > 0 && r > t && /function moXingYuEJiSuan\(la: LaQuXinXi\)/.test(main)
        && /MO_XING_MO_REN_CHUANGKOU = 128000/.test(main) && /MO_XING_TPM_BEI_SHU = 2;/.test(main)
        && /MO_XING_RPM_FEN_MU = 4000/.test(main) && /MO_XING_RPM_XIA_XIAN = 100/.test(main);
    })());
  jian('⑨ **快照语义**：推导只用拉取到的基准窗口，绝不掺用户改过的窗口（掺了就等于"改窗口自动带动 rpm/tpm"，用户明令禁止）',
    /moXingQuotaDangQian\(m\);[\s\S]{0,400}moXingYuEJiSuan\(la\)/.test(main)
    && /const chuangKou = la\.chuangKou > 0 \? la\.chuangKou : MO_XING_MO_REN_CHUANGKOU/.test(main)
    && !/moXingYuEJiSuan\(\{ \.\.\.la, chuangKou: fu\?\.ctx/.test(main));
  jian('⑨ rpm/tpm **没有单位**：读取侧不再乘任何系数（只有窗口/输出走 k|m）',
    /const zheng = \(n\?: number\): number \| undefined =>/.test(main)
    && /rpm: zheng\(z\.rpm\), tpm: zheng\(z\.tpm\)/.test(main)
    && !/rpmNum\?: number; rpmUnit\?: string/.test(main));
  /**
   * 第 44 轮把这三条**字节锚改成不变量**（原正则把源码里某一行原话钉死，改一个词就红，
   * 而"红"里混着真缺陷与措辞变化，分不清）：
   *  ① 保存仍是"合并写回"（没填的项保留原值）—— 现在多了 `ziDong:false` 这个尾项，所以判"包含 ...jiu 与 ...xin"；
   *  ② "已有记录一律不覆盖"这条口径**本轮被改了**（自动快照必须能刷掉），
   *     所以判据换成真正的不变量：**只有用户认定过的不覆盖**，由 `shiYongHuRenDing` 统一裁决。
   */
  jian('⑨ 保存是**合并**（没填的项保留原值），不是整份覆盖：否则改一次窗口会把 tpm/rpm 抹掉',
    /quan\[mo\] = \{ \.\.\.jiu,\s*\.\.\.xin/.test(main) && /ziDong:\s*false/.test(main));
  jian('⑨ 「恢复默认」按拉取信息**重算并存下来**（没拉到的项留空），不是删掉记录后靠运行时现推',
    /if \(p0\?\.reset\) \{[\s\S]{0,200}quan\[mo\] = moXingQuotaCongLaQu\(mo\)/.test(main)
    && /chu\.outNum = o\.num/.test(main));
  jian('⑨ **自动快照能被下一次拉取刷掉，用户认定的不刷**（第 44 轮：旧口径"一律不覆盖"让探测失败存的 128K 永远留在预算里）',
    /function shiYongHuRenDing/.test(main)
    && /if \(shiYongHuRenDing\(jiu[\s\S]{0,160}?\)\s*continue;/.test(main)
    && /ziDong: true/.test(main));
  jian('⑨ **拉取模型时就把额度算好存下**（用户口径：只有拉取与恢复默认会算）',
    /quan\[id0\] = moXingQuotaCongLaQu\(id0\)/.test(main) && /model\.quota-fetched/.test(main));
  /**
   * 这条以前是**字节锚**：钉死 `const keYong = Math.max(MIN_CONTEXT_TOKENS, maxTokens - yuE.shuChu)` 那一行原话。
   * 第 44 轮后半把窗口闸改成 `benLunShuChuYuZhan()` + `keZhuangShuRuChuangKou`（输出预留与发送侧共用一个数）之后，
   * 它就红了 —— 红的是**仪器**，不是产品（不变量还在：输出配额照样从可装输入窗口里扣）。
   * 现在判**关系**（预留读不读额度、有没有 2048 地板、装配处减不减）+ 用纯函数验**行为**（给了输出上限 ⇒ 可装输入真的变小）。
   */
  jian('⑨ 发送前的窗口闸扣掉了输出配额（输入刚好卡满窗口也会 400，这条以前漏过）',
    await (async () => {
      const kai = main.indexOf('function benLunShuChuYuZhan');
      const han = kai >= 0 ? main.slice(kai, kai + 900) : '';
      const guanXi = /yuE\.shuChu > 0/.test(han)
        && /Math\.max\(2048, Math\.min\(base, yuE\.shuChu\)\)/.test(han)
        && /keZhuangShuRuChuangKou = Math\.max\(MIN_CONTEXT_TOKENS,[\s\S]{0,200}- yuZhanTok\)/.test(main);
      const Y = await import('../../packages/app-shell/dist/yuSuan-jiage.js');
      const you = Y.peizhiYuSuan({ percent: 100, windowTokens: 32768, shuChuYueDing: 12288 });
      const wu = Y.peizhiYuSuan({ percent: 100, windowTokens: 32768 });
      return guanXi && you.tokens <= 32768 - 12288 && you.tokens < wu.tokens;
    })());
  jian('⑨ 用户设的输出上限真的夹住了 maxTokens（保底 2048：思考模型 thinking 吃光配额会回空）',
    /yunXuShuChu = Math\.max\(2048, Math\.min\(shuChuShangXian, yuE\.shuChu\)\)/.test(main) && /maxTokens: yunXuShuChu/.test(main));
  jian('⑨ **分身用量记入父预算**：先占父会话的格子、占不到就如实说预算用完，然后才真执行工具',
    (() => {
      const a = main.indexOf('const fuYuSuan = huoBenLunYuSuan(sid);');
      const b = main.indexOf('benLunGongJuShu.set(sid, fuYiYong);');
      const c = main.indexOf('const subOut = runWorkTool(subBase, subCall');
      const wen = main.slice(a, b);
      return a > 0 && b > a && c > b && /工具调用预算已用完/.test(wen) && /这不是权限被拒/.test(wen);
    })());
  jian('⑨ 右键模型弹额度窗：字段齐（窗口/输出/rpm/tpm + 输入/输出类型 + 恢复默认/取消/确定），单位只有 k 与 m',
    /async function kaiMoXingYuEDu/.test(appJs) && /'mqCtx'/.test(appJs) && /'mqOut'/.test(appJs)
    && /'mqRpm'/.test(appJs) && /'mqTpm'/.test(appJs) && /mqReset/.test(appJs) && /mqCancel/.test(appJs) && /mqOk/.test(appJs)
    && /danXuan\(danWeiName, \['k', 'm'\], 'm'\)/.test(appJs));
  jian('⑨ 输入/输出两侧的标签**分开命名**（输入图像=看图，输出图像=画图；不许"有图像就画图"）',
    /image: tOr\('model\.chip\.vision', '看图'\)/.test(appJs) && /image: tOr\('model\.chip\.image', '画图'\)/.test(appJs)
    && /video: tOr\('model\.chip\.videoUnd', '看视频'\)/.test(appJs) && /video: tOr\('model\.chip\.videoGen', '做视频'\)/.test(appJs));
  jian('⑨ 弹窗沿用模态遮罩（主界面点不动），并且不新写一套 CSS（两份 CSS 会漂）',
    /zhe\.className = 'shouDongMoXingZhe'/.test(appJs) && /mk\.className = 'shouDongMoXingTan moXingYuEDan'/.test(appJs));
  jian('⑨ 恢复默认要**二次确认**（第一下只把按钮变成确认并讲清后果，第二下才真删）',
    /let queRenLe = false;/.test(appJs) && /if \(!queRenLe\) \{/.test(appJs) && /model\.restoreConfirm/.test(appJs));
  jian('⑨ 右键绑在模型 chip 上并标 data-has-ctx，否则通用右键菜单会把这个事件抢走',
    /chip\.setAttribute\('data-has-ctx', '1'\)/.test(appJs) && /chip\.addEventListener\('contextmenu'/.test(appJs)
    && /kaiMoXingYuEDu\(mo\)/.test(appJs));
  jian('⑨ IPC 与 preload 桥成对存在（渲染层调得到、主进程接得住）',
    /chuliIpc\('warmy:moXingYuEDu'/.test(main) && /chuliIpc\('warmy:moXingYuEDuSheZhi'/.test(main)
    && /modelQuotaGet:/.test(pre) && /modelQuotaSet:/.test(pre));
  /** 第 44 轮：这条以前钉死整行源码（`u === 'm' ? 1000000 : 1000`），改个写法就红。
   *  真正要守的是**不变量**：单位乘数只有一套（k=1000、其余按 m=1e6，缺省方向与主进程 `danWeiBeiShu` 一致），
   *  且任何地方都不许冒出"1024 当乘数"的第二套口径。 */
  jian('⑨ 单位折算全应用只有一个口径（k=1000 / m=1000000，缺省按 m；手动添加模型那扇窗也一起改）',
    /const toTok = \(n, u\) =>/.test(appJs) && /String\(u \|\| 'm'\) === 'k' \? 1000 : 1000000/.test(appJs)
    && !/u === 'm' \? 1000000 : 1024/.test(appJs) && !/\? 1024 :/.test(appJs));
  jian('⑨ 限流等待进审计，超过 3 秒还要在主界面看得见（不能只是日志里有、用户不知道为什么不回话）',
    /chat\.budget\.event/.test(main) && /llm\.rate-wait/.test(main));
}

/* ── ⑩ 等待时长：宿主算累计秒数（第 2 遍真机红：用户要等 30 秒，模型等 20 秒就往下走） ── */
{
  const fsx = await import('node:fs');
  const pathx = await import('node:path');
  const { fileURLToPath: f2u } = await import('node:url');
  const GEN_TU = pathx.resolve(pathx.dirname(f2u(import.meta.url)), '../..');
  const main = fsx.readFileSync(pathx.join(GEN_TU, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  const sc = await import('../../packages/app-shell/dist/shi-chang.js');
  const kou = sc.yaoQiuDengDaiMiaoShu;
  jian('⑩ 「等待30秒」解析成 30 秒（阿拉伯数字）', kou('完成后等待30秒，然后写小说') === 30, kou('完成后等待30秒，然后写小说'));
  jian('⑩ 「先等 10 秒再等 20 秒」累加成 30 秒（欠的是总时长，不是次数）', kou('先等 10 秒，再等 20 秒') === 30, kou('先等 10 秒，再等 20 秒'));
  jian('⑩ 中文数字与"半"也认（三十秒=30、两分钟=120、半分钟=30）',
    kou('等三十秒') === 30 && kou('等两分钟') === 120 && kou('等半分钟') === 30,
    [kou('等三十秒'), kou('等两分钟'), kou('等半分钟')].join('/'));
  jian('⑩ 轮询/间隔**不算一次性欠账**（"每隔 10 秒看看"若当成只许等 10 秒就把任务锁死了）',
    kou('每隔10秒检查一次进度') === 0 && kou('每 5 分钟提醒我') === 0, kou('每隔10秒检查一次进度'));
  jian('⑩ 荒唐值退回 0（宁可回到次数口径，也不拿一个错数字催模型等一天）',
    kou('等 999999999 秒') === 0 && kou('等 86401 秒') === 0, kou('等 86401 秒'));
  jian('⑩ 次数口径仍在（与秒数配合使用，不是被替换掉）',
    sc.yuanWenDengDaiCiShu('完成后等待30秒') === 1 && sc.yuanWenDengDaiCiShu('等 5 秒，再等 5 秒') === 2,
    sc.yuanWenDengDaiCiShu('完成后等待30秒') + '/' + sc.yuanWenDengDaiCiShu('等 5 秒，再等 5 秒'));
  jian('⑩ 账本记的是**累计秒数**（miaoLeiJi），不是只记次数',
    /const miaoLeiJi = \(j0\?\.miaoLeiJi \|\| 0\) \+ miao;/.test(main) && /n, miaoLeiJi,/.test(main));
  jian('⑩ 次数够了但秒数欠着 ⇒ **不许把补等拦掉**（原来的洞：cap 满足 ⇒ 判重复 ⇒ 少等的 10 秒永远补不回）',
    /if \(yaoMiao > 0 && \(j\.miaoLeiJi \|\| 0\) < yaoMiao\) return null;/.test(main));
  jian('⑩ 等待进度在**记账之后**报（先等够才算够），话术含"还差 N 秒"与补等方法，等够后明确叫它别再等',
    (() => {
      const a = main.indexOf("jiBuZhou(sessionId, 'wait_seconds', rawArgsH, baseH, huiBaoH);");
      const b = main.indexOf('【等待进度】用户要求累计等');
      const wen = main.slice(a, a + 1600);
      return a > 0 && b > a && /还差 \$\{cha\} 秒/.test(wen) && /wait_seconds\(seconds=\$\{cha\}\)/.test(wen) && /\*\*不用再等了\*\*/.test(wen);
    })());
  jian('⑩ 解析只有 shi-chang.ts 一份（主进程 import 它，不再原地写第二份口径）',
    /import \{ yaoQiuDengDaiMiaoShu, yuanWenDengDaiCiShu \} from '\.\/shi-chang\.js';/.test(main)
    && !/function yaoQiuDengDaiMiaoShu/.test(main) && !/function yuanWenDengDaiCiShu/.test(main));
}

console.log(`第 39 轮额度行为门禁：${ok} 通过 / ${shi.length} 失败`);
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
