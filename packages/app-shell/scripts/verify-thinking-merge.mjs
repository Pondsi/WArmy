/**
 * 门禁：**多轮工具循环里的"思考过程"不许只剩最后一轮**。
 *
 * 真事故（用户报）：思考过程本来内容很多，回复完成后思考块里只剩一点点。
 * 根因：界面流式显示的是"整轮对话所有轮次"的思考（主进程逐增量广播、渲染层累加到一个缓冲），
 *       而工具循环只把**最后一轮**响应当最终回复 ⇒ 思考、聊天日志、返回值三处都只剩最后一轮。
 *
 * 这个门禁用假 provider 精确复现"三轮思考"的场景，断言最终响应里的思考是**全部三轮**，
 * 且轮与轮之间能分清（不是拼成一坨），单轮场景则原样不重复。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
process.chdir(pkgRoot);

const { liaoTianDaiGongJu } = await import('@warmy/providers');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); }
}

const YONG_LIANG = { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1, source: 'estimated' };
const GONG_JU = [{ type: 'function', function: { name: 'probe', description: 'probe', parameters: { type: 'object', properties: {} } } }];

function xiangYing(msg, finish) {
  return { id: 'x', model: 'fake', choices: [{ index: 0, message: msg, finishReason: finish }], usage: YONG_LIANG };
}

/** 造一个"每轮都思考、前两轮调工具"的假 provider */
function zaoJia(lun) {
  let i = 0;
  return {
    protocol: 'openai-compatible',
    baseURL: 'http://fake',
    supportsTools: true,
    async chat() {
      const d = lun[Math.min(i, lun.length - 1)];
      i += 1;
      return xiangYing(d, d.gongJuDiaoYongJi ? 'tool_calls' : 'stop');
    },
    async chatStream() { throw new Error('not used'); },
    async listModels() { return []; },
    async ping() { return { ok: true, ms: 1 }; },
  };
}

// ── 用例 1：三轮思考（工具循环两轮 + 收敛一轮）→ 三份都要在，且顺序正确 ──
const san = [
  { role: 'assistant', content: '', reasoning: '第一轮思考：先列目录', gongJuDiaoYongJi: [{ id: 'c1', type: 'function', function: { name: 'probe', arguments: '{}' } }] },
  { role: 'assistant', content: '', reasoning: '第二轮思考：再读一个文件', gongJuDiaoYongJi: [{ id: 'c2', type: 'function', function: { name: 'probe', arguments: '{}' } }] },
  { role: 'assistant', content: '最终答案在这里', reasoning: '第三轮思考：现在可以回答了' },
];
const r1 = await liaoTianDaiGongJu(
  zaoJia(san),
  { model: 'fake', xiaoXiJi: [{ role: 'user', content: '干活' }], tools: GONG_JU },
  async () => '工具结果',
  { zuiDaLunShu: 5 },
);
const sk1 = String(r1.xiangYingTi.choices[0].message.reasoning || '');
check('三轮思考：第一轮在', sk1.includes('第一轮思考：先列目录'), sk1.slice(0, 120));
check('三轮思考：第二轮在', sk1.includes('第二轮思考：再读一个文件'), sk1.slice(0, 120));
check('三轮思考：第三轮在', sk1.includes('第三轮思考：现在可以回答了'), sk1.slice(0, 120));
check('三轮思考：顺序为 1→2→3', sk1.indexOf('第一轮') < sk1.indexOf('第二轮') && sk1.indexOf('第二轮') < sk1.indexOf('第三轮'), sk1.slice(0, 120));
check('三轮思考：轮次之间有分隔（不是拼成一坨）', sk1.includes('\n\n'), JSON.stringify(sk1.slice(0, 60)));
check('正文仍是最终那一轮的答案', String(r1.xiangYingTi.choices[0].message.content) === '最终答案在这里');
check('确实跑了两轮工具', r1.lunShu === 2 && r1.gongJuDiaoYongJi === 2, { lunShu: r1.lunShu, gongJuDiaoYongJi: r1.gongJuDiaoYongJi });
/**
 * **回归判别力**：老实现返回的就是"最后一轮响应"，它的思考里**没有前几轮**。
 * 这条断言证明上面的用例真的能抓到老 bug（不是恒真的空断言）。
 */
check('（判别力）老行为=只取最后一轮，确实缺前几轮 ⇒ 本用例能抓到旧 bug', !String(san[2].reasoning).includes('第一轮思考'));

// ── 用例 2：单轮对话（无工具）→ 思考原样、不重复 ──
const dan = [{ role: 'assistant', content: '只回答一句', reasoning: '唯一的一段思考' }];
const r2 = await liaoTianDaiGongJu(
  zaoJia(dan),
  { model: 'fake', xiaoXiJi: [{ role: 'user', content: '你好' }], tools: GONG_JU },
  async () => '',
  { zuiDaLunShu: 5 },
);
const sk2 = String(r2.xiangYingTi.choices[0].message.reasoning || '');
check('单轮：思考原样保留', sk2 === '唯一的一段思考', sk2);

// ── 用例 3：模型的思考里本来就带空行 → 不许把它切坏/丢段 ──
const duo = [{ role: 'assistant', content: '答', reasoning: '段一\n\n段二\n\n段三' }];
const r3 = await liaoTianDaiGongJu(
  zaoJia(duo),
  { model: 'fake', xiaoXiJi: [{ role: 'user', content: 'x' }], tools: GONG_JU },
  async () => '',
  { zuiDaLunShu: 5 },
);
check('单轮多段思考完整', String(r3.xiangYingTi.choices[0].message.reasoning) === '段一\n\n段二\n\n段三', String(r3.xiangYingTi.choices[0].message.reasoning));

// ── 用例 4：轮数上限不再被静默砍到 8（设置里填 12 就得能跑 12 轮） ──
let lunCi = 0;
const wuQiong = {
  protocol: 'openai-compatible',
  baseURL: 'http://fake',
  supportsTools: true,
  async chat() {
    lunCi += 1;
    if (lunCi <= 12) {
      return xiangYing({ role: 'assistant', content: '', reasoning: `第${lunCi}轮想`, gongJuDiaoYongJi: [{ id: 'c' + lunCi, type: 'function', function: { name: 'probe', arguments: '{}' } }] }, 'tool_calls');
    }
    return xiangYing({ role: 'assistant', content: '收敛', reasoning: '收尾思考' }, 'stop');
  },
  async chatStream() { throw new Error('not used'); },
  async listModels() { return []; },
  async ping() { return { ok: true, ms: 1 }; },
};
const r4 = await liaoTianDaiGongJu(
  wuQiong,
  { model: 'fake', xiaoXiJi: [{ role: 'user', content: 'x' }], tools: GONG_JU },
  async () => 'ok',
  { zuiDaLunShu: 12, maxToolResultChars: 200000 },
);
check('zuiDaLunShu=12 真的跑满 12 轮（不再被砍到 8）', r4.lunShu === 12, { lunShu: r4.lunShu, qingQiuJi: r4.qingQiuJi });
check('跑满轮数后思考仍是全量（12 轮都在）', String(r4.xiangYingTi.choices[0].message.reasoning || '').includes('第12轮想'), String(r4.xiangYingTi.choices[0].message.reasoning || '').slice(0, 80));

// ── 用例 5：界面侧不变量 —— 正式回复里的思考块必须用**同一条** reasoning（不再被流式缓冲顶掉） ──
const fs = await import('node:fs');
const appJs = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
check('渲染层：正式回复的思考块读的是 m.reasoning', /\$\{escapeHtml\(String\(m\.reasoning\)\)\}/.test(appJs) || /escapeHtml\(String\(m\.reasoning\)\)/.test(appJs));
check('主进程：流式增量是"攒着+尾随"（不再直接丢掉密集增量）', /_boXingDai\.set\(sessionId, dai\)/.test(fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8')));

console.log(`\n==== verify-thinking-merge: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
