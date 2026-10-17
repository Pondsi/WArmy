/**
 * verify-round34-jiaofu.mjs —— 「哪两份文件才是用户要的交付物」的**唯一判据**（纯函数，可离线回放）
 *
 * 为什么单独抽出来（第 34 轮 项 12 收尾，r36 第 1 计次的教训）：这条判据本轮改过三次，
 * 每次都因为"我拿什么当证据"想当然而制造**假红**：
 *  ① 按正文含两句 + `<2000` 字猜 ⇒ 模型把小说追加进短稿（6144 字）时长度条件失效，一条根因炸出五项红；
 *  ② 按文件名含「你是谁」猜 ⇒ 真机 r36-ollama-4 模型起名 `身份.txt` / `身份.pptx`，
 *    而**用户原话根本没规定文件名**（只说"生成一个 txt、生成一个 ppt，写入 你是谁，我是谁"）⇒ 四条假红。
 * 现在按**证据强度**分级，txt 与 ppt **各认各的**（一条没找到就如实返回空，让判分去红 ——
 * 第一版写成"两份都凑齐才算数"，结果把已经认出来的那份也丢了，回放 B 抓到这个 bug）：
 *  **轨迹（30 秒等待前打开的就是"让我验收的那两份"）> 正文关键词 > 文件名关键词**。
 */

const xiao = (s) => String(s || '').toLowerCase().replace(/[\\/]+$/, '');
const jing = (s) => [...String(s || '').replace(/[\s　]+/g, '')].length;

const SHENG = ['trajectory', 'content', 'name'];

/** @returns {{txt:Array,ppt:Array,fangshi:string,liyou:string}} */
export function renJiaoFu({ xin = [], kai = [], dengKai = null } = {}) {
  const lu = (v) => xiao(v && v.p !== undefined ? v.p : v);
  /** ① 轨迹证据：等待开始（含 1.5s 容差）之前打开的文件 */
  const zaiQian = dengKai == null ? [] : kai.filter((k) => Number(k.ts) <= Number(dengKai) + 1500);
  const kaiLu = [...new Set(zaiQian.map((k) => xiao(k.abs)))];
  const cheng = (dai) => [...new Set(kaiLu.filter((a) => (dai === 'txt' ? /\.(txt|md|markdown)$/ : /\.pptx?$/).test(a)))];
  const anKai = (dai) => {
    const s = new Set(cheng(dai));
    return xin.filter((x) => s.has(lu(x)));
  };
  const anWen = (dai) => (dai === 'txt'
    ? xin.filter((x) => /\.txt$/i.test(x.m) && /你是谁/.test(x.wen) && /我是谁/.test(x.wen))
      .sort((a, b) => jing(a.wen) - jing(b.wen)).slice(0, 1)
    : xin.filter((x) => /\.pptx?$/i.test(x.m) && (/你是谁/.test(x.wen) || /我是谁/.test(x.wen))).slice(0, 1));
  const anMing = (dai) => (dai === 'txt'
    ? xin.filter((x) => /\.txt$/i.test(x.m) && (/你是谁/.test(x.m) || /我是谁/.test(x.m))).slice(0, 1)
    : xin.filter((x) => /\.pptx?$/i.test(x.m)).slice(0, 1));
  const yiJi = (dai) => {
    for (const f of [anKai, anWen, anMing]) {
      const r = f(dai);
      if (r.length) return { r, fangshi: SHENG[[anKai, anWen, anMing].indexOf(f)] };
    }
    return { r: [], fangshi: 'none' };
  };
  const w = yiJi('txt');
  const p = yiJi('ppt');
  return {
    txt: w.r,
    ppt: p.r,
    fangshi: `txt:${w.fangshi}/ppt:${p.fangshi}`,
    liyou: `等待前打开 ${zaiQian.length} 次，桌面本次新增 ${xin.length} 份`,
  };
}
