/**
 * 第 20 轮 · 任务10 根因回归测试
 *
 * 本轮三个根因各一组断言，全部用**真实代码路径**，不打桩业务逻辑：
 *   A. OpenAI 流式 tool_calls 按 index 归并（空参风暴的源头）
 *   B. 会话真实字数按去重文件求和（误判"没写够"的源头）
 *   C. agent.mjs stub 带退出通道（残留进程的源头）
 *
 * 跑法：& $env:MIMO_NODE verify-round20-stream.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

// ── A. 流式工具调用按 index 归并 ────────────────────────────
console.log('\nA. OpenAI 流式 tool_calls 按 index 归并');
{
  const { JianrongOpenAIGongYing } = await import(
    pathToFileURL(path.join(GEN, 'packages/providers/dist/openai.js')).href
  );

  /**
   * 真实的 OpenAI 流式分片形态：第一帧带 id + name、参数空；
   * 后续帧**只有 index**，逐段追加 arguments。这正是 MiMo 端点的实际行为。
   */
  const pianJi = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_real_1', function: { name: 'write_file', arguments: '' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a.txt"' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ',"content":"hi"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  const ti = pianJi.map((p) => `data: ${JSON.stringify(p)}`).join('\n\n') + '\n\ndata: [DONE]\n\n';

  const yuanFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(ti, {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  });
  try {
    const gy = new JianrongOpenAIGongYing({ apiKey: 'test' }, { defaultBase: 'https://example.invalid/v1' });
    const he = [];
    for await (const pian of gy.chatStream({ model: 'm', xiaoXiJi: [] })) {
      const g = pian.choices?.[0]?.delta?.gongJuDiaoYongJi;
      if (Array.isArray(g)) he.push(...g);
    }
    const ids = [...new Set(he.map((x) => x.id))];
    shuo(ids.length === 1, `同一工具调用只有一个 id（实得 ${ids.length} 个：${ids.join(',')}）`);
    shuo(ids[0] === 'call_real_1', `id 用第一帧的真实值（实得 ${ids[0]}）`);

    // 按上层（baoZhuangLiuShi）同样的规则归并，断言不再出现"有名字、参数空"
    const bing = new Map();
    for (const c of he) {
      const y = bing.get(c.id) || { name: '', args: '' };
      y.args += String(c.function?.arguments || '');
      if (!y.name && c.function?.name) y.name = String(c.function.name);
      bing.set(c.id, y);
    }
    const tiaoJi = [...bing.values()];
    shuo(tiaoJi.length === 1, `归并后只剩一个工具调用（实得 ${tiaoJi.length}）`);
    const kongCan = tiaoJi.filter((x) => x.name && x.args.trim().length < 2);
    shuo(kongCan.length === 0, `没有"有名字、参数空"的条目（这正是空参回退的触发条件，实得 ${kongCan.length} 个）`);
    const t0 = tiaoJi[0];
    shuo(t0.name === 'write_file', `工具名保住了（实得 ${t0.name}）`);
    let jie = null;
    try { jie = JSON.parse(t0.args); } catch { /* 下面断言会报 */ }
    shuo(!!jie && jie.path === 'a.txt' && jie.content === 'hi',
      `参数完整拼回合法 JSON（实得 ${t0.args}）`);
  } finally {
    globalThis.fetch = yuanFetch;
  }
}

// ── B. agent.mjs stub 必须带退出通道 ────────────────────────
console.log('\nB. 分身 stub 的退出通道（残留进程）');
{
  const src = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/runtime.js'), 'utf8');
  shuo(src.includes("process.on('disconnect'"), 'stub 模板含 disconnect 退出（父进程没了就不留孤儿）');
  shuo(src.includes("if (m === 'shutdown') zouBa(0)"), 'stub 模板含 shutdown 消息退出');
  shuo(src.includes("process.on('SIGTERM'"), 'stub 模板含 SIGTERM 退出');
  shuo(src.includes('clearInterval(keepalive)'), 'keepalive 定时器会被清掉');
  shuo(src.includes("h.Zhi.send('shutdown')"), 'stop() 先发协作式 shutdown');
  shuo(src.includes("jiu.includes('1 << 30') && !jiu.includes('disconnect')"), '旧 stub 会被就地升级');

  // 真的把 stub 跑起来：disconnect 后必须自己退出
  const { ShiliGuanliqi } = await import(
    pathToFileURL(path.join(GEN, 'packages/app-shell/dist/runtime.js')).href
  );
  const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-stub-'));
  const chai = { register() {}, unregister() {}, async shutdownAll() {} };
  const guanLi = new ShiliGuanliqi({
    instancesRoot: gen, teardown: chai, security: {},
    nodePath: process.execPath, maxInstances: 4,
  });
  const h = await guanLi.spawn({ config: { id: 'inst-test', ming: '牛马-测试' } });
  shuo(!!h.pid, `stub 进程已拉起（pid=${h.pid}）`);
  const huo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  shuo(huo(h.pid), 'stub 进程在跑');
  await guanLi.stop('inst-test', 4000);
  await new Promise((r) => setTimeout(r, 400));
  shuo(!huo(h.pid), `stop() 之后进程真的退了（pid=${h.pid} 不再存在）`);
  try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
}

// ── C. 字数统计口径统一 ────────────────────────────────────
console.log('\nC. 字数统计口径（误判"没写够"）');
{
  const src = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
  // 统一的字数统计函数第 34 轮换过名字（huiHuaZhenShiZiShu → renWuZiShu，因为口径从"本轮"扩到"本次任务"）；
  // 这里认**任一名字**，判据不变：有一个统一函数、至少三处判据在用它。
  const han = /function (huiHuaZhenShiZiShu|renWuZiShu)\b/.exec(src);
  shuo(!!han, '存在统一的字数统计函数');
  const ci = ((han && han[1]) ? (src.match(new RegExp(han[1] + '\\((sessionId|sid|String\\(sessionId \\|\\| \'\'\\))\\)', 'g')) || []) : []).length;
  shuo(ci >= 3, `三处判据都改用它（实得 ${ci} 处调用）`);
  shuo(!/benLunChanPin\.reduce\(\(zui, x\) => Math\.max/.test(src),
    '旧的"只取 max"口径已彻底移除（它会把 425 字节的脚本当成正文）');
  shuo(src.includes("audit?.log('plan.auto-continue-step-skipped'")
    || src.includes('plan.auto-continue-step-skipped'), '卡住的步骤改为跳过并记审计');
  shuo(src.includes("status: 'blocked'"), '跳过的步骤标记为 blocked（界面显示删除线）');
}

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
