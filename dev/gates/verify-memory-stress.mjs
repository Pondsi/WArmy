/**
 * verify-memory-stress.mjs —— 长期记忆/上下文压缩压测（独立 node 脚本，不启动 Electron）
 *
 * 用法（真 node 绝对路径）：
 *   resources\node\win-x64\node.exe verify-memory-stress.mjs
 *   resources\node\win-x64\node.exe verify-memory-stress.mjs --rounds 30 --stateDir .memory-stress-pilot --no-probe
 *   resources\node\win-x64\node.exe verify-memory-stress.mjs --runs 2 --rounds 1000
 *
 * 设计（哪些是"真"的，哪些是复刻）：
 *   · 真模块 1：`packages/app-shell/dist/context-renderer.js` 的 `xuanranYoujieShitu()`
 *     —— 这是产品里**唯一**的上下文渲染/压缩入口（纯函数、零 LLM、硬断言 viewChars ≤ budgetChars）。
 *        它内部用的是 `@warmy/ccr-compressor` 的规则型压缩（也是真模块）。
 *   · 真模块 2：`packages/memory-os/dist/index.js` 的 `JiyiCangFuwu`
 *     —— 真记忆服务：只追加 JSONL（唯一事实来源）+ SQLite 投影（records/fts_uni/fts_tri），
 *        以及真实解引用 API `recall()` / `retrieve()`。
 *   · 真模块 3：`packages/ccr-compressor/dist/index.js` 的 `CcrGateway.beforeLog()`
 *     —— 写入侧 CCR（消息类预算 = 4000×4 = 16000 字符），与产品聊天写入路径一致。
 *   · **复刻**：`youPeizhiSuanShangXiaWenYuSuan()`（主进程 electron-main.ts:2846）**没有可独立 import
 *     的入口**（它是 electron-main.ts 的内部函数，import 该文件会拉进 electron）。本脚本按源码
 *     **逐行复刻**了它的算法与常量（MIN_CONTEXT_TOKENS=2048 / CHARS_PER_TOKEN_EST=1.6 / MODEL_CTX_MAP /
 *     percent 夹 10..100 / minPercent / min(2000000, max(MIN_CONTEXT_BUDGET_CHARS, chars))）。
 *     复刻处均以 `[复刻]` 注释标出。渲染器与记忆服务是**原始模块**，未复刻。
 *
 * 真调模型（无任何模拟）：
 *   · 主体：MiMo 云端 `mimo-v2.6-flash`（OpenAI 兼容 /v1/chat/completions，key 从 `MIMO_KEY_FILE` 环境变量读）
 *   · 一部分：本机 ollama `huihui_ai/qwen3-vl-abliterated:4b`（原生 /api/chat）
 *
 * 断点续跑：每轮把指标 append 到 `<stateDir>/runN.metrics.jsonl`，把进度写 `<stateDir>/runN.state.json`；
 *   重启脚本会从 JSONL（唯一事实来源）把日志镜像重建回来，从 nextRound 继续。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ───────────────────────── 参数 ─────────────────────────
function can(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
const ROUNDS = Number(can('rounds', 1000));
const RUNS = Number(can('runs', 2));
const STATE_DIR = path.resolve(ROOT, String(can('stateDir', '.memory-stress-state')));
const DO_PROBE = can('no-probe', false) !== true;
const MIMO_MODEL = String(can('mimoModel', 'mimo-v2.6-flash'));
const OLLAMA_MODEL = String(can('ollamaModel', 'huihui_ai/qwen3-vl-abliterated:4b'));
/** run2 的最后这么多轮改用本机 ollama 模型（0 = 不用本地模型） */
const OLLAMA_TAIL_ROUNDS = Number(can('ollamaTail', ROUNDS >= 1000 ? 40 : 4));
/**
 * 密钥文件一律**从环境变量读**（门禁 verify-security 禁止脚本里出现真实用户路径/密钥文件名）。
 * 用法：`$env:MIMO_KEY_FILE="<key文件>"; node verify-memory-stress.mjs`
 * 也接受直接给 `MIMO_KEY`（第一行即 key）。
 */
const KEY_FILE = String(process.env.MIMO_KEY_FILE || '').trim();
const MIMO_BASE = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
const OLLAMA_BASE = 'http://127.0.0.1:11434/api/chat';

// ───────────────────── 真模块（import 编译产物） ─────────────────────
const { xuanranYoujieShitu, DEFAULT_KEEP_HEAD, DEFAULT_KEEP_TAIL, DEFAULT_CONTEXT_BUDGET_CHARS } =
  await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/context-renderer.js')).href);
const { JiyiCangFuwu } = await import(pathToFileURL(path.join(ROOT, 'packages/memory-os/dist/index.js')).href);
const { CcrGateway, compress: ccrCompress } = await import(
  pathToFileURL(path.join(ROOT, 'packages/ccr-compressor/dist/index.js')).href
);
/** 写入侧 CCR：与产品一致（默认预算 4000；message 类 ×4 = 16000） */
const ccrGateway = new CcrGateway(4000);

// ═══════════════════ [复刻] 主进程上下文预算函数 ═══════════════════
// 源码：packages/app-shell/src/electron-main.ts:2809-2867 与 2909-2929
// 复刻原因：该函数与 electron 运行时耦合、没有可独立 import 的出口（见文件头说明）。
const MIN_CONTEXT_TOKENS = 2048;
const CHARS_PER_TOKEN_EST = 1.6;
const MIN_CONTEXT_BUDGET_CHARS = 200;
/** 与 electron-main.ts:2814 MODEL_CTX_MAP 一致 */
const MODEL_CTX_MAP = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'mimo-v2.5-pro': 1048576,
  'mimo-v2.5': 1048576,
  'mimo-v2.6-flash': 1048576,
  'mimo-v2.6-pro': 1048576,
  'qwen3.7-max': 131072,
  'qwen3.8-27b': 32768,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-5-sonnet': 200000,
};
/** [复刻] electron-main.ts:2846 youPeizhiSuanShangXiaWenYuSuan（模型真实窗口这里用已知表表示） */
function youPeizhiSuanShangXiaWenYuSuan(modelId, settings = {}) {
  let percent = 60;
  let maxTokens = 32768;
  let youZhenShi = false;
  const mw = MODEL_CTX_MAP[String(modelId || '').split('/').pop()] || MODEL_CTX_MAP[modelId] || null;
  if (mw && mw >= 4096) {
    maxTokens = mw;
    youZhenShi = true;
  }
  const p = Number(settings.contextBudgetPercent);
  if (Number.isFinite(p)) percent = Math.min(100, Math.max(10, Math.round(p)));
  const m = Number(settings.modelContextTokens);
  if (!youZhenShi && Number.isFinite(m) && m >= 4096) maxTokens = m;
  const minPercent = Math.min(100, Math.ceil((MIN_CONTEXT_TOKENS / maxTokens) * 100));
  const effPercent = Math.max(percent, minPercent);
  const tokens = Math.max(MIN_CONTEXT_TOKENS, Math.round((effPercent / 100) * maxTokens));
  const chars = Math.max(200, Math.round(tokens * CHARS_PER_TOKEN_EST));
  return { chars, percent: effPercent, tokens, maxTokens, minPercent };
}
/** [复刻] electron-main.ts:2909 contextBudgetChars（含 200 万上限与 200 下限） */
function contextBudgetChars(modelId, settings = {}) {
  const suan = youPeizhiSuanShangXiaWenYuSuan(modelId, settings);
  return Math.min(2000000, Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.floor(suan.chars)));
}
/** [复刻] electron-main.ts:2869-2876 超限收缩阶梯 1.0 → 0.6 → 0.35 → 0.2 */
const SHANGXIAWEN_CHONGSHI_BUZHOU = [1.0, 0.6, 0.35, 0.2];
const isContextLengthError = (err) =>
  /context|token|too long|maximum length|context_length|maximum context/i.test(String(err?.message || err || ''));
const budgetCharsForStep = (base, buZhou) =>
  Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.round(base * buZhou));

/** 本脚本用的 settings（默认值来自 settings-store 默认：contextBudgetPercent 60 / autoSummary true） */
const SETTINGS = { contextBudgetPercent: 60, modelContextTokens: 32768, autoSummary: true };

// ───────────────────────── 记忆点账本 ─────────────────────────
/** 埋点位置：'head' = 该轮用户消息开头（能被中段 240 字采样窗口看到）；'tail' = 该轮用户消息结尾 */
function zaoJiYiDian(runId, code, round, weizhi, ti, daAn) {
  return { runId, code, round, weizhi, ti, daAn };
}
const JIYI_DIAN = {
  1: [
    zaoJiYiDian(1, 'R1-F-01', 1, 'head', '【记忆点 R1-F-01】我在第 1 轮说过：我的幸运数字是 8317。', '8317'),
    zaoJiYiDian(1, 'R1-F-02', 3, 'head', '【记忆点 R1-F-02】我在第 3 轮说过：我在做一个叫 KX-42 的项目。', 'KX-42'),
    zaoJiYiDian(1, 'R1-F-03', 8, 'tail', '【记忆点 R1-F-03】我在第 8 轮说过：我最讨厌的食物是香菜。', '香菜'),
    zaoJiYiDian(1, 'R1-F-04', 12, 'head', '【记忆点 R1-F-04】我在第 12 轮说过：我的备用硬盘序列号是 SN-99887。', 'SN-99887'),
    zaoJiYiDian(1, 'R1-F-05', 16, 'tail', '【记忆点 R1-F-05】我在第 16 轮说过：我常去的面馆叫 老陈牛肉面。', '老陈牛肉面'),
    zaoJiYiDian(1, 'R1-F-06', 20, 'head', '【记忆点 R1-F-06】我在第 20 轮说过：我的备用车钥匙藏在蓝色工具箱第二格。', '蓝色工具箱'),
    zaoJiYiDian(1, 'R1-M-01', 498, 'head', '【记忆点 R1-M-01】我在第 498 轮说过：我女儿的小名叫团团。', '团团'),
    zaoJiYiDian(1, 'R1-M-02', 499, 'tail', '【记忆点 R1-M-02】我在第 499 轮说过：我的工位编号是 B-7-2311。', 'B-7-2311'),
    zaoJiYiDian(1, 'R1-M-03', 500, 'head', '【记忆点 R1-M-03】我在第 500 轮说过：我的锁屏密码前缀是 7782。', '7782'),
    zaoJiYiDian(1, 'R1-M-04', 500, 'tail', '【记忆点 R1-M-04】我在第 500 轮说过：我最喜欢的乐队是腰乐队。', '腰乐队'),
    zaoJiYiDian(1, 'R1-M-05', 501, 'head', '【记忆点 R1-M-05】我在第 501 轮说过：我订的期刊是《无线电》1979 合订本。', '无线电'),
    zaoJiYiDian(1, 'R1-M-06', 501, 'tail', '【记忆点 R1-M-06】我在第 501 轮说过：我的健身房叫铁牛-3号。', '铁牛-3号'),
    zaoJiYiDian(1, 'R1-R-01', 997, 'head', '【记忆点 R1-R-01】我在第 997 轮说过：我今天喝的是桂花乌龙拿铁。', '桂花乌龙'),
    zaoJiYiDian(1, 'R1-R-02', 998, 'head', '【记忆点 R1-R-02】我在第 998 轮说过：我正在读《芯片简史》。', '芯片简史'),
    zaoJiYiDian(1, 'R1-R-03', 999, 'head', '【记忆点 R1-R-03】我在第 999 轮说过：我明天要修一台编号 RAD-88 的老式收音机。', 'RAD-88'),
    zaoJiYiDian(1, 'R1-R-04', 999, 'tail', '【记忆点 R1-R-04】我在第 999 轮说过：我的旧手机号尾号是 0431。', '0431'),
    zaoJiYiDian(1, 'R1-R-05', 1000, 'head', '【记忆点 R1-R-05】我在第 1000 轮说过：我养的猫叫煤球。', '煤球'),
    zaoJiYiDian(1, 'R1-R-06', 1000, 'tail', '【记忆点 R1-R-06】我在第 1000 轮说过：我最新校验用的数字是 4096。', '4096'),
  ],
  2: [
    zaoJiYiDian(2, 'R2-F-01', 1, 'head', '【记忆点 R2-F-01】我在第 1 轮说过：我的幸运数字是 6318。', '6318'),
    zaoJiYiDian(2, 'R2-F-02', 3, 'head', '【记忆点 R2-F-02】我在第 3 轮说过：我在做一个叫 KX-43 的项目。', 'KX-43'),
    zaoJiYiDian(2, 'R2-F-03', 8, 'tail', '【记忆点 R2-F-03】我在第 8 轮说过：我最讨厌的食物是折耳根。', '折耳根'),
    zaoJiYiDian(2, 'R2-F-04', 12, 'head', '【记忆点 R2-F-04】我在第 12 轮说过：我的备用硬盘序列号是 SN-77120。', 'SN-77120'),
    zaoJiYiDian(2, 'R2-F-05', 16, 'tail', '【记忆点 R2-F-05】我在第 16 轮说过：我常去的面馆叫 三号线馄饨。', '三号线馄饨'),
    zaoJiYiDian(2, 'R2-F-06', 20, 'head', '【记忆点 R2-F-06】我在第 20 轮说过：我的备用车钥匙藏在阳台第二个铁盒里。', '阳台第二个铁盒'),
    zaoJiYiDian(2, 'R2-M-01', 498, 'head', '【记忆点 R2-M-01】我在第 498 轮说过：我儿子的小名叫皮蛋。', '皮蛋'),
    zaoJiYiDian(2, 'R2-M-02', 499, 'tail', '【记忆点 R2-M-02】我在第 499 轮说过：我的工位编号是 C-2-0918。', 'C-2-0918'),
    zaoJiYiDian(2, 'R2-M-03', 500, 'head', '【记忆点 R2-M-03】我在第 500 轮说过：我的保险柜密码前缀是 3351。', '3351'),
    zaoJiYiDian(2, 'R2-M-04', 500, 'tail', '【记忆点 R2-M-04】我在第 500 轮说过：我最喜欢的乐队是万能青年旅店。', '万能青年旅店'),
    zaoJiYiDian(2, 'R2-M-05', 501, 'head', '【记忆点 R2-M-05】我在第 501 轮说过：我订的期刊是《模型火箭》2011 合订本。', '模型火箭'),
    zaoJiYiDian(2, 'R2-M-06', 501, 'tail', '【记忆点 R2-M-06】我在第 501 轮说过：我的健身房叫石狮子-9号。', '石狮子-9号'),
    zaoJiYiDian(2, 'R2-R-01', 997, 'head', '【记忆点 R2-R-01】我在第 997 轮说过：我今天喝的是陈皮普洱。', '陈皮普洱'),
    zaoJiYiDian(2, 'R2-R-02', 998, 'head', '【记忆点 R2-R-02】我在第 998 轮说过：我正在读《焊接工艺手册》。', '焊接工艺手册'),
    zaoJiYiDian(2, 'R2-R-03', 999, 'head', '【记忆点 R2-R-03】我在第 999 轮说过：我明天要修一台编号 RAD-99 的电子管功放。', 'RAD-99'),
    zaoJiYiDian(2, 'R2-R-04', 999, 'tail', '【记忆点 R2-R-04】我在第 999 轮说过：我的旧固话尾号是 0865。', '0865'),
    zaoJiYiDian(2, 'R2-R-05', 1000, 'head', '【记忆点 R2-R-05】我在第 1000 轮说过：我养的狗叫铁蛋。', '铁蛋'),
    zaoJiYiDian(2, 'R2-R-06', 1000, 'tail', '【记忆点 R2-R-06】我在第 1000 轮说过：我最新校验用的数字是 8128。', '8128'),
  ],
};
/** 抽查清单（每条 10 个：开头 4 / 中间 3 / 最近 3） */
const CHOUCHA = {
  1: ['R1-F-01', 'R1-F-02', 'R1-F-03', 'R1-F-04', 'R1-M-01', 'R1-M-03', 'R1-M-05', 'R1-R-01', 'R1-R-03', 'R1-R-04'],
  2: ['R2-F-01', 'R2-F-02', 'R2-F-03', 'R2-F-04', 'R2-M-01', 'R2-M-03', 'R2-M-05', 'R2-R-01', 'R2-R-03', 'R2-R-04'],
};

// ───────────────────────── 内容生成（确定性，可续跑复现） ─────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 真实中文技术文本池（不是 lorem，是成段可读的技术叙述） */
const WEN_BEN_CHI = [
  '今天把容器编排那层的健康检查从 TCP 探针换成了 HTTP 探针，结果发现有 3 个实例的 /healthz 返回 200 但依赖的 sqlite 投影还没建好，属于"探针通过、实际不可用"。改法是让 /healthz 显式检查 schema_version 与 records 计数，两者都对才返回 200。',
  'CRDT 那边又把 last-write-wins 换成了 op-based 计数，因为盖戳需要可信时钟，而本机设备的时钟漂移实测能到 400ms 以上，排序会乱。op-based 只需要单调的本地序号，代价是必须在网络恢复后重放整个操作日志，重放耗时在 2000 条量级大概是 120ms。',
  '流式解析的背压问题：上游每秒推 8 万个事件，下游写盘只有每秒 3 万条的能力，管道里堆了 40 万个待处理事件后 RSS 涨到 1.8G。现在的做法是给管道加一个高水位标记，超过 5 万就暂停读取 socket，靠 TCP 窗口自然反压，RSS 稳定在 300M 左右。',
  '把打包产物从 3 个 chunk 拆成 9 个之后，冷启动首屏从中位 1.9s 降到 1.2s，但首屏之后的第二次交互反而慢了 80ms，原因是 chunk 太多导致请求竞争。最后折中成 5 个 chunk，首屏 1.4s、二次交互回到基线，算是拿一点首屏换整体手感。',
  '索引重建的时候发现 trigram 索引的体积是原文的 2.7 倍，10MB 的语料建出 27MB 的索引，而且插入是逐条提交的，2000 条记录耗时 4.6s。下一步打算改成攒 500 条一个事务批量提交，同时把 fts_tri 只对 ≥3 字符的字段建，能省掉大概四成体积。',
  '排查一个偶发崩溃花了三个小时：栈里只有一个 native frame，没有任何业务信息。最后靠给每个子进程加 --report-on-fatalerror 拿到崩溃报告，定位到是某个 C 扩展在 4 字节对齐的缓冲区上做了非对齐读。教训是：子进程必须有人读 stdout/stderr，否则管道写满会把进程卡死在写操作上。',
  '把超时从固定 8 秒改成带抖动的指数退避之后，上游那台机器的重试风暴消失了。原来的固定超时让所有客户端在同一时刻重试，峰值把服务端打满；现在退避基数是 500ms、抖动 ±30%，重试峰值被摊平到 3 秒窗口里，服务端 P99 从 2.4s 降到 340ms。',
  '记忆检索的三路融合用的是 RRF，k 取 60。实测下来 fts_uni 在 1 到 2 字的短查询上最强，fts_tri 在错误码、路径、ASCII 标识符上最强，向量腿只在"换个说法问同一件事"时有增益。把三路权重调成纯 RRF 之后，乱码查询的 top1 余弦掉到 0.447，正好在阈值 0.5 以下被跳过，行为符合预期。',
  '把状态机的转移写成表驱动之后，新增一个状态只需要加两行，但代价是类型推导变弱，编译器不再能证明穷尽性。折中方案是保留一个手写的 exhaustive check 函数，任何新增状态没在表里出现就在编译期报错，运行时零成本。',
  '磁盘写入的 fsync 策略调整：原先每条记录都 fsync，跑 2000 条要 90 秒；改成 50ms 一次组提交之后降到 6 秒，掉电最多丢 50ms 的写入。对只追加的日志来说这是可接受的，因为日志是唯一事实来源，投影丢了可以全量重建。',
  '上下文预算这件事的坑在于：预算看起来是"能塞多少字"，实际约束是"注意力预算"。同一份 20 万字的上下文，把关键事实放在开头、中间、结尾三个位置做针尖测试，命中率能从 98% 掉到 62%（中间位置最差）。所以压缩的正确目标不是"塞满"，而是"把高信号的东西放到注意力强的位置"。',
  '把摘要器从"每轮都摘要"改成"到达阈值才压缩"之后，单位对话的 token 成本下降了 4 成，但代价是压缩点不可预测，压完那一轮的延迟会突然冒出 2 秒。做法是压缩触发时先把新一轮的上下文降级渲染（宁可少给原文也别卡住），压缩完成后再回到正常渲染。',
  '做可解引用的指针设计时，故意让线索冗余：seq 范围、recordId 采样、语义线索三条路都能把原文取回来。实测任何一条坏了另外两条都还能命中，代价是指针本身的字符数从 40 涨到 110。考虑到指针省下的是几千字的原文，这笔账很划算。',
  '调试一个"模型说这是咱们的第一条消息"的事故：原因是预算被配到极小，视图把 6 条历史全省略只剩一根指针。修复方式是在渲染器里加硬规则——只要日志非空，视图至少要带最后一条真实消息，宁可少给也不能给空。这类事故说明"有界"和"可用"是两个独立目标，只优化前者会翻车。',
  '遥测采集要控制基数：把 model_id 直接当标签之后，时序库的活跃序列从 200 涨到 1.4 万，查询延迟翻了 5 倍。现在的做法是只保留 model_family 作为标签，具体版本号放进日志正文，需要细查的时候再按 trace_id 捞原始记录。',
  '把权限过滤放到相关性排序之前之后，命中率表面上没变化，但越权数据的相似度根本不会被计算——这一点在做向量检索时特别重要，因为余弦相似度本身就会泄露"存在一条很像的记录"。',
  '重试的幂等键设计踩过坑：一开始用请求体的哈希做幂等键，结果两次内容相同但意图不同的请求被合并。改成客户端生成的 UUID 之后正确了，但要求客户端在重试时必须复用同一个 UUID，所以幂等键必须由调用方持有，不能由服务端生成。',
  '本地模型的上下文窗口经常被"默认值"坑到：接口不传 num_ctx 的话，很多推理后端会按训练时的小窗口截断，而且截断是静默的，你只会看到模型答非所问。显式传 num_ctx 之后，同样的提示词命中率立刻恢复，代价是显存占用和首 token 延迟都上去。',
  '把一个 3000 行的文件拆成 12 个模块的过程中，最有价值的不是拆本身，而是顺手暴露了 3 处循环依赖。拆分前这些依赖被同一个文件的存在掩盖着，拆分后构建工具立刻报错，反而说明拆对了。',
  '压测的采样要按真实分布来：用均匀分布的间隔去压接口，会把最坏情况平均掉，看上去 P99 很漂亮。真实流量是突发的，所以压测要么用真实的到达过程，要么至少加入一批突发桶，不然测出来的容量是假的。',
  '缓存穿透的兜底不能只靠布隆过滤器：过滤器本身有假阳性，而且冷启动时它是空的。最后的组合是过滤器挡住绝大多数、空结果用短 TTL 缓存挡住剩余、DB 侧再加一层带超时的互斥，三层叠起来才有稳定效果。',
  '把 UI 的渲染路径从"每次都重建整棵树"改成"按脏标记局部更新"之后，长列表滚动掉帧从 12% 降到 0.8%。关键不是算法有多巧，而是把"哪些数据变了"这件事变成显式契约，否则隐式失效传播会一直在你不知道的地方发生。',
  '日志采样率不能一刀切：错误路径要 100% 保留，成功路径 1% 就够。混在一起之后，错误日志会被成功日志淹掉，排查时找不到关键那条。按级别分流的实现很简单，效果立竿见影。',
  '并发写入同一份 JSON 配置文件的教训：读-改-写的窗口里发生另一次写入，后者会被静默覆盖。现在改成写临时文件再原子重命名，并且写之前先算一次内容哈希，哈希没变就不落盘，避免无意义的写放大。',
];
function zaoLunNeiRong(runId, round, sizeChars, dian) {
  const rnd = mulberry32(runId * 1000003 + round * 7919);
  let out = `【第 ${round} 轮 · 长文本工作记录】\n`;
  if (dian) {
    for (const d of dian) if (d.weizhi === 'head') out += d.ti + '\n';
  }
  let guard = 0;
  while (out.length < sizeChars - 400 && guard++ < 400) {
    out += WEN_BEN_CHI[Math.floor(rnd() * WEN_BEN_CHI.length)] + '\n';
    out += `（记录片段 ${round}-${guard}，观测值 ${Math.floor(rnd() * 100000)}，耗时 ${Math.floor(rnd() * 900) + 100}ms）\n`;
  }
  if (dian) {
    for (const d of dian) if (d.weizhi === 'tail') out += d.ti + '\n';
  }
  out += `\n以上是本轮记录（轮次编号 ${round}）。请用不超过 80 字总结要点，并给出记录编号。`;
  return out;
}
/** 每 50 轮塞一段"工具输出"（>16000 字符），专门用来触发写入侧 CCR 的截断分支 */
function yingTiGongShuChu(runId, round) {
  if (round % 50 !== 0) return '';
  const rnd = mulberry32(runId * 31 + round);
  const hang = [];
  let n = 0;
  while (n < 17200) {
    const l = `[${round}] step ${String(n).padStart(6, '0')} ok  ${(rnd() * 100).toFixed(3)}s  worker-${Math.floor(rnd() * 12)}  artifact=dist/chunk-${Math.floor(rnd() * 999)}.js`;
    hang.push(l);
    n += l.length + 1;
  }
  return `\n【附着：本轮构建输出（未裁剪）】\n${hang.join('\n')}\n【构建输出结束】\n`;
}

// ───────────────────────── 模型调用（真调） ─────────────────────────
const MIMO_KEY = (() => {
  // 懒加载：只在真正要调 MiMo 时才读（--regen 这种零 API 模式不需要 key）
  let cache = '';
  return () => {
    if (cache) return cache;
    const zhi = String(process.env.MIMO_KEY || '').trim();
    if (zhi) {
      cache = zhi;
      return cache;
    }
    if (!KEY_FILE) throw new Error('缺少密钥：请设置 MIMO_KEY_FILE（或 MIMO_KEY）环境变量后再运行');
    cache = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
    return cache;
  };
})();
const SYS_PROMPT =
  '你是 WArmy 里的一个机器人（牛马）。你只会看到一段"有界视图"（可能包含被压缩的要点与省略指针）。' +
  '严格依据你可见的内容回答；可见内容里没有的事实，必须明确说"当前上下文里没有这条信息"，绝对不许编造。';

async function tiaoMimo(messages, maxTokens) {
  const t0 = Date.now();
  const r = await fetch(MIMO_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MIMO_KEY() },
    body: JSON.stringify({ model: MIMO_MODEL, messages, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(240000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`mimo HTTP ${r.status}: ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  const m = j.choices?.[0]?.message || {};
  return {
    content: String(m.content || ''),
    reasoning: String(m.reasoning_content || ''),
    ms: Date.now() - t0,
    promptTokens: j.usage?.prompt_tokens ?? null,
    completionTokens: j.usage?.completion_tokens ?? null,
    cachedTokens: j.usage?.prompt_tokens_details?.cached_tokens ?? null,
  };
}
async function tiaoOllama(messages, maxTokens, numCtx) {
  const t0 = Date.now();
  const r = await fetch(OLLAMA_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      think: false,
      options: { num_ctx: numCtx, num_predict: maxTokens, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(900000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`ollama HTTP ${r.status}: ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  return {
    content: String(j.message?.content || ''),
    reasoning: String(j.message?.thinking || ''),
    ms: Date.now() - t0,
    promptTokens: j.prompt_eval_count ?? null,
    completionTokens: j.eval_count ?? null,
    cachedTokens: null,
  };
}
/**
 * 真调模型。
 *
 * 真机发现（pilot 实测）：`mimo-v2.6-flash` 是**推理模型**，`reasoning_content` 与正文共享同一个
 * `max_tokens` 配额 —— strict 上限给小了（192）时会返回 HTTP 200 但 `content` 为空、reasoning 吃满配额，
 * 表现为"调用成功但没人说话"。本函数因此：① 默认给足配额；② 正文为空但 reasoning 非空时自动放大配额重试一次；
 * ③ ollama 侧用 `think:false` 关掉思考；若仍只有 thinking 文本，则如实降级使用并标记来源。
 */
async function jiaoMoXing(provider, messages, maxTokens = 512) {
  const yiCi = () => (provider === 'ollama' ? tiaoOllama(messages, maxTokens, SETTINGS.modelContextTokens) : tiaoMimo(messages, maxTokens));
  let r = await yiCi();
  if (!r.content) {
    if (provider === 'ollama' && r.reasoning) {
      r = { ...r, content: r.reasoning, contentFrom: 'thinking' };
    } else {
      const kuoDa = Math.min(4096, Math.max(512, maxTokens * 3));
      const r2 = provider === 'ollama' ? await tiaoOllama(messages, kuoDa, SETTINGS.modelContextTokens) : await tiaoMimo(messages, kuoDa);
      r2.emptyRetry = true;
      r = r2;
      if (!r.content && r.reasoning) r = { ...r, content: r.reasoning, contentFrom: 'thinking' };
      if (!r.content) throw new Error(`empty-content（max_tokens=${kuoDa}，reasoning 已吃满配额）`);
    }
  }
  return r;
}

// ───────────────────────── 单轮 ─────────────────────────
function xieZhuangTai(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function duZhuangTai(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

class Paotai {
  constructor(runId, stateDir) {
    this.runId = runId;
    this.dir = path.join(stateDir, `run${runId}`);
    fs.mkdirSync(this.dir, { recursive: true });
    this.stateFile = path.join(stateDir, `run${runId}.state.json`);
    this.metricsFile = path.join(stateDir, `run${runId}.metrics.jsonl`);
    this.svc = new JiyiCangFuwu({ CangLu: this.dir });
    this.sessionId = `stress-run${runId}`;
    /** 日志镜像（与 JSONL 同源）：从真服务 tail 重建 */
    this.log = this.svc
      .tail(5000)
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({ seq: r.seq, role: r.role || (String(r.id).startsWith('a-') ? 'assistant' : 'user'), content: String(r.ti || ''), recordId: r.id, ts: r.ts }));
    const st = duZhuangTai(this.stateFile);
    this.next = st?.nextRound || 1;
    this.ok = st?.okRounds || 0;
    this.failed = st?.failedRounds || 0;
    this.totalChars = this.log.reduce((s, e) => s + e.content.length, 0);
    this.dianYing = st ? this.log.filter((e) => e.role === 'user').length : 0;
    /** 累计指标 */
    this.m = st?.m || {
      viewCharsMax: 0,
      viewCharsSum: 0,
      budgetChars: 0,
      elidedRounds: 0,
      pointersMax: 0,
      overBudget: 0,
      ccrTruncated: 0,
      ctxShrink: 0,
      apiErrors: 0,
      prefillTokensSum: 0,
      cachedTokensSum: 0,
      roundMsSum: 0,
      roundMsMax: 0,
      renderMsSum: 0,
      renderMsMax: 0,
      ollamaRounds: 0,
      mimoRounds: 0,
      emptyContentRetries: 0,
      budgetMimo: 0,
      budgetOllama: 0,
    };
    this.duanFen = new Map();
    for (const d of JIYI_DIAN[runId] || []) this.duanFen.set(d.round, [...(this.duanFen.get(d.round) || []), d]);
  }

  /** 渲染有界视图（真渲染器 + 真/复刻预算） */
  xuanRan(modelId, recallHint) {
    const budget = contextBudgetChars(modelId, SETTINGS);
    const t0 = Date.now();
    const view = xuanranYoujieShitu(this.log, {
      budgetChars: budget,
      keepHead: DEFAULT_KEEP_HEAD,
      keepTail: DEFAULT_KEEP_TAIL,
      recallHint,
    });
    return { view, budget, ms: Date.now() - t0 };
  }

  async paoYiLun(round) {
    const dian = this.duanFen.get(round) || [];
    const modelId = this.runId === 2 && round > ROUNDS - OLLAMA_TAIL_ROUNDS ? OLLAMA_MODEL : MIMO_MODEL;
    const provider = this.runId === 2 && round > ROUNDS - OLLAMA_TAIL_ROUNDS ? 'ollama' : 'mimo';

    // ① 生成用户消息（埋点 + 可能的大块工具输出）
    let renWen = zaoLunNeiRong(this.runId, round, 5200, dian) + yingTiGongShuChu(this.runId, round);
    // ② 写入侧 CCR（真模块）
    const ccr = ccrGateway.beforeLog({ kind: 'message', content: renWen });
    // ③ 真落盘（真记忆服务，只追加 JSONL + 三路投影）
    const rec = this.svc.append(
      { id: `m-${this.runId}-${round}`, sessionId: this.sessionId, kind: 'message', role: 'user', ti: ccr.content, groupId: this.sessionId, entityType: 'chat' },
      'duty'
    );
    this.log.push({ seq: rec.seq, role: 'user', content: ccr.content, recordId: rec.id, ts: rec.ts });

    // ④ 渲染有界视图（真渲染器）
    const r = this.xuanRan(modelId, `第 ${round} 轮工作记录`);

    // ⑤ 真调模型（带超限收缩阶梯 —— 复刻 daiShangXiaWenChongShiYunXing）
    let reply = '';
    let err = '';
    let jinZhan = 0;
    let usedBudget = r.budget;
    let meta = null;
    const ladder = [...SHANGXIAWEN_CHONGSHI_BUZHOU];
    for (let step = 0; step < ladder.length; step++) {
      usedBudget = budgetCharsForStep(r.budget, ladder[step]);
      const bu = step === 0 ? r.view : xuanranYoujieShitu(this.log, { budgetChars: usedBudget, keepHead: DEFAULT_KEEP_HEAD, keepTail: DEFAULT_KEEP_TAIL, recallHint: `第 ${round} 轮工作记录` }).view;
      const xiaoXi = [{ role: 'system', content: SYS_PROMPT }, ...bu.xiaoXiJi];
      try {
        meta = await jiaoMoXing(provider, xiaoXi, 512);
        reply = meta.content || '';
        err = '';
        break;
      } catch (e) {
        err = String(e?.message || e);
        if (!isContextLengthError(e) || step === ladder.length - 1) {
          // 非 context 错误：再做最多 3 次普通重试
          let ok = false;
          for (let k = 0; k < 3 && !ok; k++) {
            await new Promise((res) => setTimeout(res, 800 * (k + 1)));
            try {
              meta = await jiaoMoXing(provider, xiaoXi, 512);
              reply = meta.content || '';
              err = '';
              ok = true;
              this.m.apiErrors++;
            } catch (e2) {
              err = String(e2?.message || e2);
            }
          }
          if (!ok) this.m.apiErrors++;
          break;
        }
        jinZhan++;
        this.m.ctxShrink++;
      }
    }
    if (!reply) {
      this.failed++;
      // 宁可留一条如实标注的空回复，也不编造
      reply = `[模型调用失败] ${err.slice(0, 120)}`;
    } else {
      this.ok++;
    }

    // ⑥ 助手回复入日志（真写入路径；正文不截断）
    const arc = this.svc.append(
      { id: `a-${this.runId}-${round}`, sessionId: this.sessionId, kind: 'message', role: 'assistant', ti: reply, groupId: this.sessionId, entityType: 'chat' },
      'duty'
    );
    this.log.push({ seq: arc.seq, role: 'assistant', content: reply, recordId: arc.id, ts: arc.ts });

    // ⑦ 指标
    const roundChars = ccr.content.length + reply.length;
    this.totalChars += roundChars;
    this.m.viewCharsMax = Math.max(this.m.viewCharsMax, r.view.stats.viewBytes);
    this.m.viewCharsSum += r.view.stats.viewBytes;
    this.m.budgetChars = r.budget;
    if (provider === 'ollama') this.m.budgetOllama = r.budget;
    else this.m.budgetMimo = r.budget;
    this.m.pointersMax = Math.max(this.m.pointersMax, r.view.stats.pointers);
    if (r.view.elided.length) this.m.elidedRounds++;
    if (r.view.stats.viewBytes > r.budget) this.m.overBudget++;
    if (ccr.truncated) this.m.ccrTruncated++;
    if (meta?.emptyRetry) this.m.emptyContentRetries++;
    this.m.prefillTokensSum += meta?.promptTokens || 0;
    this.m.cachedTokensSum += meta?.cachedTokens || 0;
    this.m.roundMsSum += meta?.ms || 0;
    this.m.roundMsMax = Math.max(this.m.roundMsMax, meta?.ms || 0);
    this.m.renderMsSum += r.ms;
    this.m.renderMsMax = Math.max(this.m.renderMsMax, r.ms);
    if (provider === 'ollama') this.m.ollamaRounds++;
    else this.m.mimoRounds++;

    const hang = {
      run: this.runId,
      round,
      provider,
      model: modelId,
      ok: !reply.startsWith('[模型调用失败]'),
      roundMs: meta?.ms ?? null,
      renderMs: r.ms,
      budgetChars: r.budget,
      usedBudget,
      ctxShrinkSteps: jinZhan,
      viewChars: r.view.stats.viewBytes,
      viewMsgs: r.view.xiaoXiJi.length,
      logEntries: r.view.stats.logEntries,
      logChars: r.view.stats.logBytes,
      elidedCount: r.view.elided.reduce((s, x) => s + x.count, 0),
      pointers: r.view.stats.pointers,
      ccrTruncated: ccr.truncated,
      userChars: ccr.content.length,
      assistantChars: reply.length,
      promptTokens: meta?.promptTokens ?? null,
      cachedTokens: meta?.cachedTokens ?? null,
      error: err ? err.slice(0, 200) : null,
      factsInRound: dian.map((d) => d.code),
      ts: Date.now(),
    };
    fs.appendFileSync(this.metricsFile, JSON.stringify(hang) + '\n', 'utf8');
    this.next = round + 1;
    if (round % 10 === 0 || round === ROUNDS)
      xieZhuangTai(this.stateFile, {
        nextRound: this.next,
        okRounds: this.ok,
        failedRounds: this.failed,
        totalCharsThisRun: this.totalChars,
        totalBytesThisRun: Buffer.byteLength(this.log.map((e) => e.content).join('\n'), 'utf8'),
        m: this.m,
        updatedAt: new Date().toISOString(),
      });
    return hang;
  }
}

async function chaoRun(runId, stateDir) {
  const p = new Paotai(runId, stateDir);
  console.log(`[run${runId}] 起始轮次 ${p.next}，已有日志 ${p.log.length} 条 / ${p.totalChars} 字符`);
  for (let round = p.next; round <= ROUNDS; round++) {
    const h = await p.paoYiLun(round);
    if (round % 25 === 0 || round === ROUNDS) {
      const avg = p.m.roundMsSum / Math.max(1, p.ok + p.failed);
      console.log(
        `[run${runId}] ${round}/${ROUNDS} ok=${p.ok} fail=${p.failed} 日志=${p.totalChars}字符 ` +
          `视图=${h.viewChars} 预算=${h.budgetChars} 指针=${h.pointers} 轮耗时均=${avg.toFixed(0)}ms 本轮=${h.roundMs}ms tok=${h.promptTokens} 缓存=${h.cachedTokens}`
      );
    }
  }
  xieZhuangTai(p.stateFile, {
    nextRound: p.next,
    okRounds: p.ok,
    failedRounds: p.failed,
    totalCharsThisRun: p.totalChars,
    totalBytesThisRun: Buffer.byteLength(p.log.map((e) => e.content).join('\n'), 'utf8'),
    m: p.m,
    updatedAt: new Date().toISOString(),
  });
  return p;
}

// ───────────────────────── 抽查（真调模型 + 真解引用） ─────────────────────────
async function chouCha(p, cfg) {
  const { modelId, provider, tag } = cfg;
  // 注意：抽查就是"产品在最后一轮会看到的那份视图"再追加一个提问，日志不再改动
  const budget = contextBudgetChars(modelId, SETTINGS);
  const t0 = Date.now();
  const view = xuanranYoujieShitu(p.log, {
    budgetChars: budget,
    keepHead: DEFAULT_KEEP_HEAD,
    keepTail: DEFAULT_KEEP_TAIL,
    recallHint: '历史记忆点抽查',
  });
  const viewText = view.xiaoXiJi.map((m) => m.content).join('\n');
  const rows = [];
  for (const code of CHOUCHA[p.runId] || []) {
    const d = (JIYI_DIAN[p.runId] || []).find((x) => x.code === code);
    if (!d) continue;
    const expectedRecordId = `m-${p.runId}-${d.round}`;
    const q =
      `我第 ${d.round} 轮说过的那条编号 ${d.code} 的事实是什么？` +
      `如果这条信息不在你当前可见的上下文里，请直接回答「当前上下文里没有这条信息」，不要猜测。`;
    const xiaoXi = [{ role: 'system', content: SYS_PROMPT }, ...view.xiaoXiJi, { role: 'user', content: q }];
    let ans = '';
    let err = '';
    let ms = null;
    try {
      const m = await jiaoMoXing(provider, xiaoXi, 512);
      ans = m.content;
      ms = m.ms;
    } catch (e) {
      err = String(e?.message || e);
    }
    const hit = ans.includes(d.daAn);
    /**
     * 客观对照（两列，必须分开）：
     *   ansInView  = 这条事实的**答案正文**是否出现在模型可见的视图里 → 这才是"能不能答对"的判据
     *   codeInView = 仅"编号"出现在视图里（例如某条 assistant 回复复述了编号清单）。
     *                真机实测：run2 有 4 条属于"只看见编号、看不见内容"——误导性最强的一种，
     *                模型会顺着编号回答"上下文里有这条信息"却给不出事实。必须单列出来。
     */
    const ansInView = viewText.includes(d.daAn);
    const codeInView = viewText.includes(d.code);
    const inView = ansInView;

    // 解引用腿：真 recall（语义/关键词召回）+ 真 retrieve（按 recordId 精确取回）
    let recallIds = [];
    let recallHit = false;
    let recallErr = '';
    let recallMs = null;
    try {
      const t1 = Date.now();
      const cards = p.svc.recall(d.daAn, 5, { scope: { sessionId: p.sessionId } });
      recallMs = Date.now() - t1;
      recallIds = cards.map((c) => `${c.recordId}#${c.hitLevel}`);
      recallHit = cards.some((c) => c.recordId === expectedRecordId);
    } catch (e) {
      recallErr = String(e?.message || e);
    }
    let retrieveHit = false;
    let retrieveChars = 0;
    let retrieveErr = '';
    try {
      const out = p.svc.retrieve({ recordId: expectedRecordId }, { maxChars: 8000 });
      const s = JSON.stringify(out || null);
      retrieveHit = !!out && s.includes(d.daAn);
      retrieveChars = out?.ti?.length || out?.text?.length || (out?.records?.[0]?.ti || '').length || 0;
    } catch (e) {
      retrieveErr = String(e?.message || e);
    }
    rows.push({
      run: p.runId,
      tag,
      modelId,
      provider,
      code: d.code,
      round: d.round,
      weizhi: d.weizhi,
      lei: code.includes('-F-') ? '开头(1~20轮)' : code.includes('-M-') ? '中间(≈500轮)' : '最近(997~1000轮)',
      ti: d.ti,
      daAn: d.daAn,
      question: q,
      inView,
      ansInView,
      codeInView,
      answer: ans,
      hit,
      ms,
      err,
      recallHit,
      recallIds,
      recallMs,
      recallErr,
      retrieveHit,
      retrieveChars,
      retrieveErr,
    });
    console.log(
      `[run${p.runId}/${tag}@${budget}字] 抽查 ${code} 正文在视图内=${ansInView} 仅编号可见=${!ansInView && codeInView} 命中=${hit} recall=${recallHit} retrieve=${retrieveHit} 用时=${ms}ms`
    );
  }
  return {
    run: p.runId,
    tag,
    modelId,
    provider,
    budgetChars: budget,
    viewChars: view.stats.viewBytes,
    viewMsgs: view.xiaoXiJi.length,
    pointers: view.stats.pointers,
    elidedCount: view.elided.reduce((s, x) => s + x.count, 0),
    logEntries: view.stats.logEntries,
    logChars: view.stats.logBytes,
    jsonlBytes: fs.statSync(p.svc.jsonlPath).size,
    renderMs: Date.now() - t0,
    rows,
  };
}

// ───────────────────────── 报告落盘 ─────────────────────────
function xieZhangBen(all) {
  const L = [];
  L.push('# 记忆压测事实账本（MEMORY-STRESS-LEDGER）');
  L.push('');
  L.push('> 本文件由 `verify-memory-stress.mjs` 自动生成。每条"记忆点"的原文、埋入轮次、埋入位置');
  L.push('> （head = 该轮用户消息开头；tail = 该轮用户消息结尾）、唯一答案 token 都记录在此，供人肉核对。');
  L.push('');
  L.push(`- 生成时间：${new Date().toISOString()}`);
  L.push(`- 每次对话轮数：${ROUNDS}；次数：${RUNS}`);
  L.push('');
  // 记忆点全表按 **run** 去重打印一次（all 里每个 run 可能有多个"预算×模型"配置，不能按配置重复打印）
  for (const runId of [...new Set(all.map((a) => a.run))]) {
    L.push(`## run${runId} · 记忆点全表（共 ${(JIYI_DIAN[runId] || []).length} 条）`);
    L.push('');
    L.push('| 编号 | 埋入轮次 | 位置 | 事实原文 | 唯一答案 |');
    L.push('|---|---|---|---|---|');
    for (const d of JIYI_DIAN[runId] || []) {
      L.push(`| ${d.code} | 第 ${d.round} 轮 | ${d.weizhi} | ${d.ti} | \`${d.daAn}\` |`);
    }
    L.push('');
  }
  L.push('## 抽查结果（每轮 10 条，覆盖开头/中间/最近）');
  L.push('');
  for (const a of all) {
    L.push(`### run${a.run} · 配置「${a.tag}」`);
    L.push('');
    L.push(`- 作答模型：\`${a.modelId}\`（provider=${a.provider}）`);
    L.push(`- 渲染预算：${a.budgetChars} 字符；实际视图：${a.viewChars} 字符 / ${a.viewMsgs} 条消息；省略 ${a.elidedCount} 条，指针 ${a.pointers} 条`);
    L.push(`- 日志：${a.logEntries} 条 / ${a.logChars} 字符（JSONL ${a.jsonlBytes} 字节）`);
    L.push('');
    L.push('| 编号 | 轮次 | 类别 | 埋入位置 | 事实正文在视图内 | 仅编号在视图内 | 提问 | 模型回答 | 答对 | recall 命中 | retrieve 命中 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of a.rows) {
      const q = `我第 ${r.round} 轮说过的那条编号 ${r.code} 的事实是什么？`;
      L.push(
        `| ${r.code} | ${r.round} | ${r.lei} | ${r.weizhi} | ${r.ansInView ? '是' : '否'} | ${
          !r.ansInView && r.codeInView ? '是' : '否'
        } | ${q} | ${String(r.answer).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)} | ${
          r.hit ? '✅' : '❌'
        } | ${r.recallHit ? '✅' : '❌'} | ${r.retrieveHit ? '✅' : '❌'} |`
      );
    }
    L.push('');
  }
  L.push('');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/MEMORY-STRESS-LEDGER.md'), L.join('\n'), 'utf8');
  return L.join('\n');
}

function tongJi(a) {
  const m = a.m;
  const roundN = a.ok + a.failed;
  return {
    run: a.run,
    okRounds: a.ok,
    failedRounds: a.failed,
    rounds: roundN,
    totalChars: a.totalChars,
    totalBytes: a.jsonlBytes,
    budgetChars: a.budgetChars,
    viewCharsMax: m.viewCharsMax,
    viewCharsAvg: Math.round(m.viewCharsSum / Math.max(1, roundN)),
    elidedRounds: m.elidedRounds,
    pointersMax: m.pointersMax,
    overBudget: m.overBudget,
    ccrTruncated: m.ccrTruncated,
    ctxShrink: m.ctxShrink,
    apiErrors: m.apiErrors,
    mimoRounds: m.mimoRounds,
    ollamaRounds: m.ollamaRounds,
    roundMsAvg: Math.round(m.roundMsSum / Math.max(1, roundN)),
    roundMsMax: m.roundMsMax,
    renderMsSum: Math.round(m.renderMsSum),
    renderMsMax: m.renderMsMax,
    prefillTokensSum: m.prefillTokensSum,
    cachedTokensSum: m.cachedTokensSum,
  };
}

// ───────────────────────── 仅重算视图列（零 API 调用） ─────────────────────────
/**
 * `--regen`：不动日志、不调模型，只把每组的"视图"按当前代码重新渲染一遍，
 * 用**同一份日志**修正 ansInView / codeInView 两列，并重写 result.json 与账本。
 * 用途：抽查的"是否在视图内"必须是可复算的客观量，不能靠记忆写死。
 */
async function chongSuanShitu() {
  const rf = path.join(STATE_DIR, 'result.json');
  const j = JSON.parse(fs.readFileSync(rf, 'utf8'));
  const huancun = new Map();
  for (const c of j.chouCha) {
    if (!huancun.has(c.run)) {
      const svc = new JiyiCangFuwu({ CangLu: path.join(STATE_DIR, `run${c.run}`) });
      const log = svc
        .tail(5000)
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map((r) => ({ seq: r.seq, role: r.role || (String(r.id).startsWith('a-') ? 'assistant' : 'user'), content: String(r.ti || ''), recordId: r.id }));
      huancun.set(c.run, { svc, log });
    }
    const { svc, log } = huancun.get(c.run);
    const v = xuanranYoujieShitu(log, {
      budgetChars: c.budgetChars,
      keepHead: DEFAULT_KEEP_HEAD,
      keepTail: DEFAULT_KEEP_TAIL,
      recallHint: '历史记忆点抽查',
    });
    const vt = v.xiaoXiJi.map((m) => m.content).join('\n');
    c.viewChars = v.stats.viewBytes;
    c.viewMsgs = v.xiaoXiJi.length;
    c.pointers = v.stats.pointers;
    c.elidedCount = v.elided.reduce((s, x) => s + x.count, 0);
    c.logEntries = v.stats.logEntries;
    c.logChars = v.stats.logBytes;
    c.jsonlBytes = fs.statSync(svc.jsonlPath).size;
    for (const r of c.rows) {
      r.ansInView = vt.includes(r.daAn);
      r.codeInView = vt.includes(r.code);
      r.inView = r.ansInView;
    }
    console.log(
      `[run${c.run}][${c.tag}] 重算：视图 ${c.viewChars} 字符（预算 ${c.budgetChars}）· 正文在视图内 ${c.rows.filter((r) => r.ansInView).length}/${
        c.rows.length
      } · 仅编号可见 ${c.rows.filter((r) => !r.ansInView && r.codeInView).length} · 答对 ${c.rows.filter((r) => r.hit).length}`
    );
  }
  for (const [, x] of huancun) {
    try {
      x.svc.close();
    } catch {
      /* noop */
    }
  }
  xieZhuangTai(rf, j);
  xieZhangBen(j.chouCha);
  console.log('已重写 result.json 与 docs/MEMORY-STRESS-LEDGER.md');
}

// ───────────────────────── main ─────────────────────────
async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (can('regen', false) === true) {
    await chongSuanShitu();
    process.exit(0);
  }
  console.log(`=== WArmy 记忆压测 === 轮数/次=${ROUNDS} 次数=${RUNS} 状态目录=${STATE_DIR}`);
  console.log(`预算(复刻 youPeizhiSuanShangXiaWenYuSuan)：${MIMO_MODEL} → ${contextBudgetChars(MIMO_MODEL, SETTINGS)} 字符；${OLLAMA_MODEL} → ${contextBudgetChars(OLLAMA_MODEL, SETTINGS)} 字符`);
  const t0 = Date.now();
  /**
   * 两条 1000 轮对话**并行**跑（各自内部严格串行：每一轮都依赖上一轮的日志/视图）。
   * 这是"总量做够"的代价折中：总轮数与总字符数不变，但墙钟时间砍半。
   */
  const paotai = await Promise.all(Array.from({ length: RUNS }, (_, i) => chaoRun(i + 1, STATE_DIR)));
  const t1 = Date.now();

  let chouChaJieGuo = [];
  if (DO_PROBE) {
    // 2×2 对照：预算（大/小）× 模型（云端 MiMo / 本机 ollama），日志完全相同，只换"渲染预算 + 作答模型"
    const daYusuan = { tag: 'MiMo+大预算(60%×1M窗口=1006634字)', modelId: MIMO_MODEL, provider: 'mimo' };
    for (let i = 0; i < paotai.length; i++) {
      const p = paotai[i];
      for (const cfg of [daYusuan]) {
        chouChaJieGuo.push(await chouCha(p, cfg));
      }
      if (i === 0) {
        // run1 额外用"小预算"再看一遍（同一份日志，只把预算换成 60%×32k=31458 字）
        chouChaJieGuo.push(await chouCha(p, { tag: 'MiMo+小预算(60%×32k窗口=31458字)', modelId: OLLAMA_MODEL, provider: 'mimo' }));
      }
      if (i === 1 && OLLAMA_TAIL_ROUNDS > 0) {
        // run2 额外用本机 ollama 作答（预算=60%×32k=31458 字）
        chouChaJieGuo.push(await chouCha(p, { tag: '本机ollama 4b+小预算(31458字)', modelId: OLLAMA_MODEL, provider: 'ollama' }));
      }
    }
  }

  const perRun = paotai.map((p) =>
    tongJi({
      run: p.runId,
      ok: p.ok,
      failed: p.failed,
      totalChars: p.totalChars,
      jsonlBytes: fs.statSync(p.svc.jsonlPath).size,
      budgetChars: p.m.budgetChars,
      m: p.m,
    })
  );
  const heJi = {
    runs: RUNS,
    roundsPerRun: ROUNDS,
    totalRounds: perRun.reduce((s, r) => s + r.rounds, 0),
    totalOkRounds: perRun.reduce((s, r) => s + r.okRounds, 0),
    totalChars: perRun.reduce((s, r) => s + r.totalChars, 0),
    totalJsonlBytes: perRun.reduce((s, r) => s + r.totalBytes, 0),
    wallSeconds: Math.round((t1 - t0) / 1000),
    probeWallSeconds: Math.round((Date.now() - t1) / 1000),
    perRun,
    chouCha: chouChaJieGuo,
    config: {
      mimoModel: MIMO_MODEL,
      ollamaModel: OLLAMA_MODEL,
      ollamaTailRounds: OLLAMA_TAIL_ROUNDS,
      settings: SETTINGS,
      keepHead: DEFAULT_KEEP_HEAD,
      keepTail: DEFAULT_KEEP_TAIL,
      defaultBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
      ccrGateway: 'CcrGateway(4000) → message 类预算 16000 字符',
    },
  };
  xieZhuangTai(path.join(STATE_DIR, 'result.json'), heJi);
  xieZhangBen(chouChaJieGuo);

  console.log('\n=== 汇总 ===');
  console.log(JSON.stringify({ ...heJi, chouCha: undefined, perRun }, null, 2).slice(0, 4000));
  for (const a of chouChaJieGuo) {
    const hit = a.rows.filter((r) => r.hit).length;
    const recall = a.rows.filter((r) => r.recallHit).length;
    const retr = a.rows.filter((r) => r.retrieveHit).length;
    const inV = a.rows.filter((r) => r.inView).length;
    console.log(`run${a.run} [${a.tag}] 抽查 ${a.rows.length} 条：视图内含=${inV} 模型答对=${hit} recall命中=${recall} retrieve命中=${retr}（预算 ${a.budgetChars} 字符 / 视图 ${a.viewChars} 字符）`);
  }
  console.log(`总轮数=${heJi.totalRounds} 总字符=${heJi.totalChars} 总字节=${heJi.totalJsonlBytes} 对话用时=${heJi.wallSeconds}s`);
  // 服务要显式关闭，否则 better-sqlite3 句柄会让进程挂着
  for (const p of paotai) {
    try {
      p.svc.close();
    } catch {
      /* noop */
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
