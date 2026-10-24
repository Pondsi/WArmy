/**
 * 模型规格与额度显示口径（第 44 轮，用户项 2："mimo-v2.5 的上下文应该是 1M，为什么窗口里显示 1048.576k？"）
 *
 * 为什么单独成一个模块：这里全是**纯函数 + 一张表**，零依赖 ⇒ 门禁脚本可以直接 `import` 跑断言，
 * 不必把整个主进程拖起来（历史教训：只测 CSS 源码字符串的门禁"绿了但界面还是红的"）。
 *
 * 三条口径（写死，改任意一条都要同步改门禁）：
 *  ① **拉取到的事实优先**（Ollama 的 `num_ctx`、端点给的 `context_length`）；问不到才查官方规格表；
 *     表也没有才用"默认 128K + 窗口→tpm→rpm 推导"。三条腿的来源**必须分开显示**，不许把表里的数说成"拉取信息"。
 *  ② **界面单位**：**先试十进制整除**（384000 → 384k，云端标的"384K"就是这个数），
 *     再试二进制整除（131072 → 128k、1048576 → 1m，本地 `num_ctx` 是这个数），
 *     两者都不整除才四舍五入到 2 位小数；三种情况都**把精确 token 数一起给出去**，界面在旁边如实显示。
 *     顺序写反就会把 384,000 读成 "375k" —— 看着像 bug，其实是两种传统抢一个位置。
 *  ③ **输入单位仍是十进制**（k=×1000、m=×1000000，第 39 轮定稿、多处门禁依赖）；
 *     显示只是"读法"，不是"算法"。用户没动过的那一栏保存时写回**原精确 token 数**，
 *     绝不因为"好看的小数"把 1,048,576 存成 1,050,000（这类漂移会让预算悄悄变小，是真事故）。
 */

export interface MoXingGuiGe {
  /** 上下文窗口（token） */
  chuangKou: number;
  /** 单次最大输出（token）；官方没写就不填（不猜） */
  shuChu?: number;
  /** 每分钟请求数（次） */
  rpm?: number;
  /** 每分钟 token 数 */
  tpm?: number;
  /** 官方声明的输入/输出模态（决定"看图/朗读"这类标签，不许靠猜） */
  inTypes?: string[];
  outTypes?: string[];
  /** 这行数据的出处（界面要显示） */
  laiYuan: string;
  /** 核对日期；null = 本轮没重新核对，界面必须标"未核对" */
  heShiRi: string | null;
}

/**
 * 官方规格表。数值出处（2026-10-19 逐条核对）：
 *  · MiMo 四款 —— mimo.mi.com 模型页：上下文 1M、最大输出 128K、RPM 100、TPM 10M；
 *    v2.5 / v2.6-flash / v2.6-pro 输入 = 文本+图+视频+音频，v2.5-pro 输入 = 文本；输出都是文本；都支持工具调用。
 *    官方"1M/128K"按十进制记 ⇒ 这里照官方存 1,000,000/128,000，**不再用 1048576 这个二进制猜值**。
 *  · deepseek-chat / deepseek-reasoner —— api-docs.deepseek.com「模型 & 价格」与 V4 公告：
 *    两个旧模型名已指向 V4-Flash（非思考/思考），上下文 1M、最大输出 384K。
 *    （原内置表写 65536 ⇒ 1M 的模型被按 64K 裁剪，小了 16 倍 —— 用户项 2 说的"杜绝这样的异常"就是这一类。）
 *  · 其余是历史遗留、本轮未重新核对 ⇒ `heShiRi: null`，界面显示"内置表（未核对）"。
 *
 * ⚠️ 云端 `/models` 端点**不回这些字段**（第 44 轮真机实测：MiMo token-plan 只回 `id/object/owned_by`），
 *    所以这一张表是唯一的官方事实来源；加新模型时要把官方页数字抄进来，不要顺手填个"看着像"的数。
 */
export const MODEL_GUIGE: Record<string, MoXingGuiGe> = {
  'mimo-v2.5': { chuangKou: 1000000, shuChu: 128000, rpm: 100, tpm: 10000000, inTypes: ['text', 'image', 'video', 'audio'], outTypes: ['text'], laiYuan: 'MiMo 官网模型页', heShiRi: '2026-10-19' },
  'mimo-v2.5-pro': { chuangKou: 1000000, shuChu: 128000, rpm: 100, tpm: 10000000, inTypes: ['text'], outTypes: ['text'], laiYuan: 'MiMo 官网模型页', heShiRi: '2026-10-19' },
  'mimo-v2.6-flash': { chuangKou: 1000000, shuChu: 128000, rpm: 100, tpm: 10000000, inTypes: ['text', 'image', 'video', 'audio'], outTypes: ['text'], laiYuan: 'MiMo 官网模型页', heShiRi: '2026-10-19' },
  'mimo-v2.6-pro': { chuangKou: 1000000, shuChu: 128000, rpm: 100, tpm: 10000000, inTypes: ['text', 'image', 'video', 'audio'], outTypes: ['text'], laiYuan: 'MiMo 官网模型页', heShiRi: '2026-10-19' },
  'deepseek-chat': { chuangKou: 1000000, shuChu: 384000, inTypes: ['text'], outTypes: ['text'], laiYuan: 'api-docs.deepseek.com 模型&价格（旧名现指 V4-Flash 非思考）', heShiRi: '2026-10-19' },
  'deepseek-reasoner': { chuangKou: 1000000, shuChu: 384000, inTypes: ['text'], outTypes: ['text'], laiYuan: 'api-docs.deepseek.com 模型&价格（旧名现指 V4-Flash 思考）', heShiRi: '2026-10-19' },
  'qwen3.7-max': { chuangKou: 131072, laiYuan: '内置表', heShiRi: null },
  'qwen3.8-27b': { chuangKou: 32768, laiYuan: '内置表', heShiRi: null },
  'gpt-4o': { chuangKou: 128000, laiYuan: '内置表', heShiRi: null },
  'gpt-4o-mini': { chuangKou: 128000, laiYuan: '内置表', heShiRi: null },
  'claude-3-5-sonnet': { chuangKou: 200000, laiYuan: '内置表', heShiRi: null },
};

/** 按型号查官方规格（支持 `vendor/mimo-v2.5` 这种带前缀的写法） */
export function chaMoXingGuiGe(modelId?: string): MoXingGuiGe | null {
  const m = String(modelId || '').trim();
  if (!m) return null;
  return MODEL_GUIGE[m] || MODEL_GUIGE[m.split('/').pop() || ''] || null;
}

/** 界面单位只有 k / m；输入侧的乘数按十进制（第 39 轮定稿） */
export function danWeiBeiShu(u?: unknown): number { return String(u || 'm') === 'k' ? 1000 : 1000000; }

export interface ZhanShiDanWei { num: number; unit: 'k' | 'm'; tokens: number }
/**
 * **token 数 → 界面（数字 + 单位）**：**先看哪种读法能整除**，再看是否需要小数；
 * 三种情况都把**精确 token 数**一起返回（`= 1,000,000 token` 那行提示用的就是它）。
 *
 * 顺序为什么是"十进制整除 → 二进制整除"：各家标的 K/M 有两种传统 ——
 * 云端按十进制（MiMo 官方"1M/128K"=1,000,000/128,000；DeepSeek 的"384K"=384,000），
 * 本地推理按二进制（Ollama 的 num_ctx 131072=128K、262144=256K）。
 * **先试十进制整除**才能把 384000 读成 384k（读成 375k 就是"看着像 bug"），
 * 而 131072 除不尽 1000 ⇒ 自然落到二进制读成 128k。两头都对，不会互相抢。
 */
export function zhanShiDanWei(token?: number): ZhanShiDanWei {
  const t = Math.max(0, Math.round(Number(token) || 0));
  const q = (x: number) => Math.round(x * 100) / 100;
  if (t === 0) return { num: 0, unit: 'k', tokens: 0 };
  if (t % 1000000 === 0) return { num: t / 1000000, unit: 'm', tokens: t };
  if (t % 1048576 === 0) return { num: t / 1048576, unit: 'm', tokens: t };
  if (t >= 1000000) return { num: q(t / 1000000), unit: 'm', tokens: t };
  if (t % 1000 === 0) return { num: t / 1000, unit: 'k', tokens: t };
  if (t % 1024 === 0) return { num: t / 1024, unit: 'k', tokens: t };
  if (t >= 1000) return { num: q(t / 1000), unit: 'k', tokens: t };
  return { num: t, unit: 'k', tokens: t };
}

/**
 * **自查（用户项 2 的后半句："自查其他的模型情况，杜绝这样的异常"）**：
 * 对"要上界面的显示值"做机械检查，返回异常清单（空数组 = 干净）。
 * 四条判据都是"人眼看着不对"的形式化：
 *  · 数字不该 ≥1000 还挂着 k（1048.576k ⇒ 应该进位成 m）；
 *  · 小数位不许超过 2 位（1048.576 这种三位以上就是把换算残渣甩给用户）；
 *  · 数字必须 >0（0k/0m 是空值不是额度）；
 *  · `num × 单位乘数` 与精确 token 数的误差不得超过 1%（好看不能改变事实）。
 */
export function panZeZhanShi(ming: string, d: ZhanShiDanWei): string[] {
  const cuo: string[] = [];
  if (Number(d.num) >= 1000 && d.unit === 'k') cuo.push(ming + '：' + d.num + 'k 没进位成 m');
  const ws = String(d.num).split('.')[1];
  if (ws && ws.length > 2) cuo.push(ming + '：' + d.num + ' 小数超过 2 位');
  if (!(Number(d.num) > 0) && Number(d.tokens) > 0) cuo.push(ming + '：显示为 0 但事实非 0');
  if (Number(d.tokens) > 0) {
    /** 反算要**两种基数都试**（输入侧乘数是十进制，但"1048576 读成 1m"是二进制的读法）：
     *  任何一边能对上就不算异常，两边都对不上才是真把事实改掉了。 */
    const jiShu = d.unit === 'k' ? [1000, 1024] : [1000000, 1048576];
    const pian = Math.min(...jiShu.map((bei) => Math.abs(Math.round(Number(d.num) * bei) - d.tokens) / d.tokens));
    if (pian > 0.01) cuo.push(ming + '：' + d.num + d.unit + ' 无论按十进制还是二进制反算都对不上精确 ' + d.tokens);
  }
  return cuo;
}
