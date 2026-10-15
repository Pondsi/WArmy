/**
 * 第 20 轮 · 真机端到端验证（真实 MiMo 端点 + 本地 Ollama）
 *
 * 要证明的事：流式工具调用**不再出现"有名字、参数空"的条目** ——
 * 那正是 `chat.stream-fallback-empty-args` 的唯一触发条件，也是上一轮
 * 每轮多打一次非流式请求、最终 90s 超时、write_file 落 empty-args 的根因。
 *
 * 这里走的是**真实网络 + 真实模型**，不打桩。
 *
 * 跑法：$env:MIMO_KEY_FILE="<key文件>"; & $env:MIMO_NODE verify-round20-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0; const jingGao = [];
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const duKey = () => {
  const f = process.env.MIMO_KEY_FILE || '';
  if (!f || !fs.existsSync(f)) return '';
  // 约定：**只有第一行**是 key，其余行不是
  return String(fs.readFileSync(f, 'utf8').split(/\r?\n/)[0] || '').trim();
};

const { JianrongOpenAIGongYing } = await import(
  pathToFileURL(path.join(GEN, 'packages/providers/dist/openai.js')).href
);
const { OllamaGongYing } = await import(
  pathToFileURL(path.join(GEN, 'packages/providers/dist/ollama.js')).href
);

/** 工具规格：故意要求两个必填参数，逼模型吐出一段较长的 arguments（更容易拆成多帧） */
const GONGJU = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: '把内容写入一个文件',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件相对路径' },
        content: { type: 'string', description: '要写入的完整文本内容' },
      },
      required: ['path', 'content'],
    },
  },
}];

/** 按上层 `baoZhuangLiuShi` 的同一套规则归并流式工具调用 */
async function pao(gy, moXing, biaoQian) {
  const he = [];
  let zhengWen = '';
  let jieShu = null;
  for await (const pian of gy.chatStream({
    model: moXing,
    xiaoXiJi: [
      { role: 'system', content: '你必须用工具干活，不要只说话。' },
      { role: 'user', content: '请用 write_file 工具把一段约 200 字的中文自我介绍写到 intro.txt。必须调用工具。' },
    ],
    tools: GONGJU,
    toolChoice: 'auto',
    maxTokens: 2048,
  })) {
    const d = pian.choices?.[0]?.delta || {};
    if (d.content) zhengWen += String(d.content);
    const g = d.gongJuDiaoYongJi;
    if (Array.isArray(g)) he.push(...g);
    const fr = pian.choices?.[0]?.finishReason;
    if (fr) jieShu = String(fr);
  }
  const bing = new Map();
  for (const c of he) {
    const id = String(c.id || '');
    const y = bing.get(id) || { name: '', args: '' };
    y.args += String(c.function?.arguments || '');
    if (!y.name && c.function?.name) y.name = String(c.function.name);
    bing.set(id, y);
  }
  const tiaoJi = [...bing.values()];
  console.log(`\n  ── ${biaoQian}（${moXing}）`);
  console.log(`     分片 ${he.length} 个 · 归并后 ${tiaoJi.length} 个工具调用 · finishReason=${jieShu}`);
  for (const t of tiaoJi) {
    const yu = t.args.length > 70 ? t.args.slice(0, 70) + '…' : t.args;
    console.log(`     · ${t.name || '(无名)'} args(${t.args.length})=${yu}`);
  }
  if (zhengWen.trim()) console.log(`     正文 ${zhengWen.trim().length} 字`);
  return { tiaoJi, jieShu, zhengWen, fenPian: he.length };
}

// ── 1. 真实 MiMo 端点 ──────────────────────────────────────
console.log('\n1. 真实 MiMo 端点（流式工具调用）');
{
  const key = duKey();
  if (!key) {
    jingGao.push('没拿到 MiMo key（设 MIMO_KEY_FILE），跳过 MiMo 真机段');
    console.log('  [跳过] 没有 key');
  } else {
    const gy = new JianrongOpenAIGongYing(
      { apiKey: key },
      { id: 'mimo', defaultBase: 'https://token-plan-cn.xiaomimimo.com/v1' }
    );
    for (const mo of ['mimo-v2.6-flash', 'mimo-v2.6-pro']) {
      try {
        const r = await pao(gy, mo, 'MiMo');
        if (!r.tiaoJi.length) {
          jingGao.push(`${mo}：这一次没调工具（模型自由度，非解析缺陷）`);
          continue;
        }
        const kongCan = r.tiaoJi.filter((x) => x.name && x.args.trim().length < 2);
        shuo(kongCan.length === 0,
          `${mo}：无"有名字、参数空"条目（= 不会触发空参回退）`,
          `实得 ${kongCan.length} 个`);
        const sui = r.tiaoJi.filter((x) => !x.name && x.args.trim().length >= 2);
        shuo(sui.length === 0,
          `${mo}：无"有参数、没名字"的碎片（= id 没被拆开）`,
          `实得 ${sui.length} 个`);
        for (const t of r.tiaoJi) {
          if (!t.name) continue;
          let ok = false;
          try { const j = JSON.parse(t.args); ok = !!j && typeof j === 'object'; } catch { /* */ }
          shuo(ok, `${mo}：${t.name} 的参数拼回合法 JSON`, t.args.slice(0, 80));
        }
      } catch (e) {
        jingGao.push(`${mo} 请求失败：${String(e?.message || e).slice(0, 120)}`);
        console.log(`  [跳过] ${mo} 请求失败：${String(e?.message || e).slice(0, 120)}`);
      }
    }
  }
}

// ── 2. 本地 Ollama ────────────────────────────────────────
console.log('\n2. 本地 Ollama（流式工具调用）');
{
  let keYong = [];
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(8000) });
    keYong = ((await r.json()).models || []).map((m) => m.name);
  } catch (e) {
    jingGao.push('Ollama 不可达：' + String(e?.message || e).slice(0, 80));
  }
  if (!keYong.length) {
    console.log('  [跳过] Ollama 没有模型');
  } else {
    // 挑一个会 function calling 的通用对话模型（排除 asr/tts/向量/视觉专用）
    const hou = keYong.find((n) => /qwen3\.8-27b/i.test(n) && !/whisper|bge|vl/i.test(n))
      || keYong.find((n) => !/whisper|bge|tts|vl/i.test(n));
    const gy = new OllamaGongYing({ baseURL: 'http://127.0.0.1:11434' });
    try {
      const r = await pao(gy, hou, 'Ollama');
      if (!r.tiaoJi.length) {
        jingGao.push(`${hou}：这一次没调工具（本地小模型常见）`);
      } else {
        const kongCan = r.tiaoJi.filter((x) => x.name && x.args.trim().length < 2);
        shuo(kongCan.length === 0,
          `${hou}：无"有名字、参数空"条目`, `实得 ${kongCan.length} 个`);
        for (const t of r.tiaoJi) {
          if (!t.name) continue;
          let ok = false;
          try { const j = JSON.parse(t.args); ok = !!j && typeof j === 'object'; } catch { /* */ }
          shuo(ok, `${hou}：${t.name} 的参数是合法 JSON`, t.args.slice(0, 80));
        }
      }
    } catch (e) {
      jingGao.push(`Ollama ${hou} 失败：${String(e?.message || e).slice(0, 120)}`);
      console.log(`  [跳过] ${hou}：${String(e?.message || e).slice(0, 120)}`);
    }
  }
}

console.log(`\n${'─'.repeat(52)}`);
if (jingGao.length) {
  console.log('提示：');
  for (const w of jingGao) console.log('  · ' + w);
}
console.log(`过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
