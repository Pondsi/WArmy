/**
 * 第 20 轮 · 多牛马协同（项目 / 值班调度）端到端验证
 *
 * 要证明的事（子代理核对出的五个断点，逐条打钉）：
 *   A. 执行者是**真实的牛马**：带自己的身份/人格/模型，不是"同一个模型多答一句"；
 *   B. 成员状态会被**真实同步**（router.setStatus 不再零调用），干活时 busy、完事回 idle；
 *   C. 新建牛马**自动入群**（不必手动添加成员）；
 *   D. 值班者**可见可指定**（warmy:qunZhiBan / qunSheZhiZhiBan），不再显示会话名；
 *   E. 项目里的执行者**有干活工具**（能真的写文件），不再弱于单聊。
 *
 * A/E 用真实模型跑；B/C/D 走真实 Router + 真实 IPC 注册的静态与行为断言。
 *
 * 跑法：$env:MIMO_KEY_FILE="<key>"; & $env:MIMO_NODE verify-round20-team.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0; const ti = [];
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

// ── 源码/接线断言（B/C/D） ─────────────────────────────────
console.log('\n多牛马协同 · 接线');
{
  const main = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
  const orch = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/orchestrator.js'), 'utf8');
  const rt = fs.readFileSync(path.join(GEN, 'packages/group-router/dist/index.js'), 'utf8');
  const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const pre = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/preload.cjs'), 'utf8');

  // B：状态同步
  shuo(/setStatus\(xiaoXi\.groupId, it\.id, it\.status === 'running'/.test(orch),
    'B 派活前按真实实例状态同步成员（setStatus 不再零调用）');
  shuo(/setStatus\(xiaoXi\.groupId, id, 'busy'\)/.test(orch), 'B 值班+执行者干活期间标 busy');
  shuo(/finally/.test(orch) && /'idle'\)/.test(orch), 'B finally 里放回 idle（出错也不会卡死）');

  // C：成员必须手动入群；重启只恢复持久化成员
  shuo(!/新牛马自动加入已有项目/.test(main)
    && /syncRouterFromGroupStore\(g\.groupId\)/.test(main),
    'C 新建牛马不自动入群，重启仅恢复持久化成员');
  shuo(/if \(g\.dutyInstanceId\)/.test(main), 'C 重启后回灌固定值班（不丢用户设置）');

  // D：值班可见可指定
  shuo(/'warmy:qunZhiBan'/.test(main), 'D 有「查询当前值班者」的 IPC');
  shuo(/'warmy:qunSheZhiZhiBan'/.test(main), 'D 有「指定固定/纯调度值班」的 IPC');
  shuo(/groupDuty:/.test(pre) && /groupSetDuty:/.test(pre), 'D preload 已暴露这两个通道');
  shuo(/setPureDispatcher\(groupId, instanceId, pure\)/.test(rt), 'D Router 补上 pureDispatcher 写入点');
  shuo(/setDutyInstance\(qunId, sid \|\| null\)/.test(main), 'D 固定值班持久化到 group-store');
  shuo(!/duty\.textContent = state\.selectedChat \? state\.selectedChat\.name/.test(app),
    'D 右栏不再把会话名当值班者显示');
  shuo(/async function shuaXinZhiBan\(\)/.test(app) && /groupDuty\?\.\(/.test(app),
    'D 右栏改为查询真实值班者');

  // A/E：执行者是真牛马 + 有干活工具
  shuo(/shenFen: \{ id: zxId, ming, persona/.test(orch), 'A 执行者带自己的身份与人格');
  shuo(/geRen\?\.model \? \{ model: geRen\.model \}/.test(orch), 'A 执行者可用自己的模型');
  shuo(/Promise\.all\(zhiXingQiJi\.map/.test(orch), 'A 多个执行者各自真的跑一遍（不再只发一次请求）');
  shuo(/executorTools:/.test(main) && /workToolSpecs\(\)/.test(main), 'E 执行者拿到干活工具');
  shuo(/if \(isWorkTool\(toolName\)\)/.test(main) && /runWorkTool\(base/.test(main),
    'E 项目路径真的执行干活工具（工作区按项目隔离）');
  shuo(/jiaJu = \[\.\.\.ganHuoTools/.test(main) && !/jiyiJiuxu\s*\?\s*\[\.\.\.ganHuoTools/.test(main),
    '记忆不可用时只砍记忆工具，干活工具照常暴露');
}

// ── 真实模型：值班编排 + 执行者真的写文件（A/E） ───────────
console.log('\n多牛马协同 · 真机（真实模型 + 真实工具）');
{
  const { GroupChatRouter, DEFAULT_PERMISSIONS } = await import(
    pathToFileURL(path.join(GEN, 'packages/group-router/dist/index.js')).href
  );
  const { xietiaoQunXiaoxi } = await import(
    pathToFileURL(path.join(GEN, 'packages/app-shell/dist/orchestrator.js')).href
  );
  const { workToolSpecs, runWorkTool, isWorkTool } = await import(
    pathToFileURL(path.join(GEN, 'packages/app-shell/dist/work-tools.js')).href
  );

  const key = (() => {
    const f = process.env.MIMO_KEY_FILE || '';
    if (!f || !fs.existsSync(f)) return '';
    return String(fs.readFileSync(f, 'utf8').split(/\r?\n/)[0] || '').trim();
  })();
  /**
   * `--ollama` ⇒ 用本地 Ollama 跑同一套协同（证明不依赖云端也成立）。
   * ⚠️ 这个开关**必须能在没有云端 key 时独立生效**：原来整段体被 `if (key)` 包住，
   * 于是"没 key + 加了 --ollama"= **一项都没跑却 exit 0**（假绿，本轮实测抓到）。
   */
  const yongOllama = process.argv.includes('--ollama');
  if (!key && !yongOllama) {
    console.log('  [没跑] 既没有 MiMo key（MIMO_KEY_FILE），也没加 --ollama ⇒ 本门禁一项都没验证');
    console.log('\n' + '─'.repeat(52) + '\n  · 结论：什么都不没跑 ≠ 通过\n');
    process.exit(1);
  }
  if (!key && yongOllama) console.log('  [提示] 没有 MiMo key ⇒ 只跑本地 Ollama 那一遍');
  {
    const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-team-'));
    const QUN = 'proj-team-test';
    const router = new GroupChatRouter({ queueWhenFixedBusy: false });
    router.createGroup({
      groupId: QUN, ming: '测试项目', type: 'internal', dutyInstanceId: null,
      directedMode: false, members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50,
    });
    /** 两只牛马：甲值班、乙当执行者 */
    const shiLi = [
      { id: 'nm-jia', ming: '牛马甲', status: 'running', dutyEligible: true },
      { id: 'nm-yi', ming: '牛马乙', status: 'running', dutyEligible: true },
    ];
    for (const s of shiLi) {
      router.join(QUN, { id: s.id, ming: s.ming, local: true, dutyEligible: s.dutyEligible, status: 'idle' });
    }

    const gongJuJi = [];
    const deps = {
      router,
      board: { append: () => {}, listEvents: () => [] },
      ccr: { beforeLog: (x) => ({ content: x.content }) },
      history: new Map(),
      listInstances: () => shiLi,
      contextBudgetChars: () => 8000,
      toolLimits: () => ({ zuiDaLunShu: 8, zuiDaJieGuoZiShu: 4000, totalChars: 12000 }),
      executorTools: () => workToolSpecs(),
      executorConfig: (id) => (id === 'nm-yi'
        ? { persona: '你做事干脆，先动手再汇报。' }
        : undefined),
      runTool: async (call, ctx) => {
        const ming = String(call?.function?.name || '');
        gongJuJi.push(ming);
        if (isWorkTool(ming)) {
          const wr = runWorkTool(gen, call, false, GEN);
          return String(wr.content || '').slice(0, ctx.zuiDaJieGuoZiShu);
        }
        return '[不支持的工具]';
      },
      projectMemory: () => '',
      decisionContext: () => '',
    };
    /**
     * Ollama 走 OpenAI 兼容 /v1 端点（与项目里 ollama 供应商的工具调用路径一致）。
     */
    const cfg = yongOllama
      ? {
          presetId: 'ollama', apiKey: '',
          baseURL: 'http://127.0.0.1:11434',
          model: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K',
          protocol: 'ollama',
        }
      : {
          presetId: 'mimo-token-plan', apiKey: key,
          baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
          model: 'mimo-v2.6-flash', protocol: 'openai-compatible',
        };
    console.log(`     供应商：${yongOllama ? 'Ollama（本地）' : 'MiMo（云端）'} · 模型 ${cfg.model}`);

    const BIAO = 'team-' + Date.now().toString(36);
    const r = await xietiaoQunXiaoxi(deps, cfg, {
      groupId: QUN, userId: 'u', urgency: 'P2',
      content: `请用 write_file 在工作区创建 ${BIAO}.txt，内容写 ${BIAO}，然后一句话确认。`,
    });

    console.log(`     action=${r.action} 值班=${r.dutyId} 执行者=${(r.executorIds || []).join(',') || '无'}`);
    console.log(`     工具调用：${gongJuJi.join(' → ') || '（无）'}`);
    console.log(`     回复：${String(r.reply || '').slice(0, 160).replace(/\n/g, ' ⏎ ')}`);

    shuo(r.action === 'dispatch', `编排成功派发（action=${r.action}）`);
    shuo(!!r.dutyId, `选出了值班者（${r.dutyId}）`);
    shuo((r.executorIds || []).length > 0, `选出了执行者（${(r.executorIds || []).join(',')}）`);
    shuo(gongJuJi.includes('write_file'), 'E 执行者真的调用了 write_file', gongJuJi.join(','));
    const luo = path.join(gen, BIAO + '.txt');
    shuo(fs.existsSync(luo), `E 文件真的落盘（${BIAO}.txt）`);
    if (fs.existsSync(luo)) {
      shuo(fs.readFileSync(luo, 'utf8').includes(BIAO), 'E 文件内容正确');
    }
    shuo(String(r.reply || '').trim().length > 0, '有回复内容（不是空回复）');

    // B：干完活成员回到 idle（否则下一条消息没人接）
    const chengYuan = router.listMembers(QUN);
    shuo(chengYuan.every((m) => m.status === 'idle'),
      'B 干完活所有成员回到 idle（下一条消息仍有人接）',
      chengYuan.map((m) => `${m.ming}=${m.status}`).join(','));

    // D：值班查询与指定
    router.setFixedDuty(QUN, 'nm-yi');
    shuo(router.duty(QUN).instance?.id === 'nm-yi', 'D 指定固定值班后，值班者真的变成它');
    router.setPureDispatcher(QUN, 'nm-yi', true);
    shuo(router.listMembers(QUN).find((m) => m.id === 'nm-yi')?.pureDispatcher === true,
      'D 纯调度标记可写入');
    router.setFixedDuty(QUN, null);
    shuo(router.duty(QUN).instance?.id === 'nm-jia', 'D 取消固定后回到序号最小的空闲牛马');

    ti.push(`真机产物目录：${gen}`);
    try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

console.log(`\n${'─'.repeat(52)}`);
for (const x of ti) console.log('  · ' + x);
console.log(`过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
