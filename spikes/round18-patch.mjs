/**
 * 第 18 轮补丁脚本（精确 UTF-8，绝不碰 PowerShell 编码）。
 * 只做字符串替换；每处 old 必须唯一命中，否则报错退出。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function edit(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) {
      console.error(`FAIL ${rel} [${tag}] hits=${n}`);
      process.exit(1);
    }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length} edits)`);
}

// ─────────────────────────────────────────────────────────────
// 1) electron-main.ts — 任务9：会话产物台账 / 路径归一授权 / 自动计划 / 续派注入
// ─────────────────────────────────────────────────────────────
edit('packages/app-shell/src/electron-main.ts', [
  // 1a. 会话级产物台账（跨自动续派/降级仍记得已落盘文件）
  [
    `let benLunChanPin: Array<{ path: string; abs: string; bytes: number; chars?: number; name: string }> = [];`,
    `let benLunChanPin: Array<{ path: string; abs: string; bytes: number; chars?: number; name: string }> = [];
/**
 * **会话级产物台账**（本轮修「反复重复执行已做过的任务」）。
 * 真机事故：自动续派/模型降级后 \`benLunChanPin\` 被清空 ⇒ 新模型不知道文件已落盘，
 * 于是反复 write_file 同名文件、反复 open_path、反复弹授权。
 * 这里跨轮累计，并在续派指令里如实注入「已完成产物」。
 */
const huiHuaChanPinTai = new Map<string, Array<{ path: string; abs: string; bytes: number; chars?: number; name: string; ts: number }>>();
/** 本会话已打开过的文件（避免反复 open_path 同一路径） */
const huiHuaYiDaKai = new Map<string, Set<string>>();`,
    'session-ledger-decl',
  ],
  // 1b. jiLuBenLunWenJian 同步进会话台账
  [
    `    benLunChanPin.push({ path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: ming0 });
  } catch { /* 记不上不影响主流程 */ }
}`,
    `    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: ming0 };
    benLunChanPin.push(tiao);
    try {
      const sid = String(jiLuBenLunWenJian.sid || '');
      if (sid) {
        let arr = huiHuaChanPinTai.get(sid);
        if (!arr) { arr = []; huiHuaChanPinTai.set(sid, arr); }
        if (!arr.some((x) => x.abs === abs) && arr.length < 60) arr.push({ ...tiao, ts: Date.now() });
      }
    } catch { /* noop */ }
  } catch { /* 记不上不影响主流程 */ }
}
/** 当前正在跑的会话（jiLuBenLunWenJian 要知道记到哪个会话） */
(jiLuBenLunWenJian as unknown as { sid?: string }).sid = '';
function sheZhiJiLuHuiHua(sid: string): void {
  (jiLuBenLunWenJian as unknown as { sid?: string }).sid = String(sid || '');
}`,
    'session-ledger-track',
  ],
  // 1c. 授权键：路径归一（Desktop/x 与绝对路径 x 视为同一请求）
  [
    `function shouQuanJian(t?: unknown, d?: unknown): string {
  const a = String(t ?? '').replace(/\\s+/g, ' ').trim();
  const b = String(d ?? '').replace(/\\s+/g, ' ').trim();
  return b ? a + '\\n' + b : a;
}`,
    `function shouQuanJian(t?: unknown, d?: unknown): string {
  const a = String(t ?? '').replace(/\\s+/g, ' ').trim();
  /**
   * **路径归一**（本轮修「不断请求授权」）：\`Desktop/x.txt\` 与 \`C:\\\\Users\\\\…\\\\Desktop\\\\x.txt\`
   * 是同一文件，但旧键把它们当成两个请求 ⇒ 每次路径写法不同就再弹一张授权卡。
   * 这里把详情里的路径统一成 basename + 末级目录名，再参与去重。
   */
  let b = String(d ?? '').replace(/\\s+/g, ' ').trim();
  b = b.replace(/(?:[A-Za-z]:)?[\\\\/](?:[^\\\\/\\s]+[\\\\/])*([^\\\\/\\s]+)(?=\\s|$|\\n|（|\\()/g, (m, base) => {
    const parts = m.split(/[\\\\/]/).filter(Boolean);
    const dir = parts.length >= 2 ? parts[parts.length - 2] : '';
    return dir ? (dir + '/' + base) : String(base);
  });
  return b ? a + '\\n' + b : a;
}`,
    'auth-key-norm',
  ],
  // 1d. 内部续派轮：不清会话产物；并设置记录会话
  [
    `    benLunChanPin = [];`,
    `    benLunChanPin = [];
    try { sheZhiJiLuHuiHua(String(sessionId || '')); } catch { /* noop */ }`,
    'reset-hook',
  ],
  // 1e. 系统提示：多步任务强制 plan_update（更硬的措辞）
  [
    `            ju.push(tMain('llm.planFirst', '【多步任务】如果这件事要做三件以上、或需要按顺序完成多个步骤，请先用 plan_update 列出步骤（id / 标题 / 状态），再逐个完成并用 plan_verify 标记验证；界面右侧的「计划任务」卡片会同步显示进度。'));`,
    `            {
              const yiYouJiHua = (jiHuaRenWuJi.get(sessionId) || []).length > 0;
              if (!yiYouJiHua) {
                ju.push(tMain('llm.planFirst', '【多步任务 · 必须先列计划】用户要求做多件事/多步骤时，**第一件事就是调用 plan_update** 列出步骤（id / 标题 / status=pending），再逐个完成并用 plan_verify 标记验证。禁止跳过计划直接散做。界面右侧「计划任务」卡片会同步显示进度。'));
              }
            }`,
    'plan-first-hard',
  ],
  // 1f. 续派指令注入「已完成产物」清单
  [
    `    const qingDan = bu.length ? bu.map((x) => \`\${x.id} \${x.title} [\${x.status}]\`).join('\\n') : '（没有显式计划：请自己判断还剩哪些没做完）';`,
    `    const qingDan = bu.length ? bu.map((x) => \`\${x.id} \${x.title} [\${x.status}]\`).join('\\n') : '（没有显式计划：请自己判断还剩哪些没做完）';
    /** 已完成产物台账：续派时如实注入，防止重复生成/重复打开 */
    const yiWanChanPin = (huiHuaChanPinTai.get(sessionId) || []).slice(-12)
      .map((x) => \`- \${x.name}（\${x.abs}，\${x.chars || x.bytes} 单位）\`).join('\\n');
    const yiDaKaiLie = [...(huiHuaYiDaKai.get(sessionId) || [])].slice(-8).join('、');`,
    'continue-inject',
  ],
  [
    `      content: zhiLing + (xia ? \`\\n\\n【下一步】\${xia.id} \${xia.title}\` : '') + \`\\n\\n【当前计划/进度】\\n\${qingDan}\\n\\n（这是系统自动接着派的一轮，不需要等我说话。）\`,`,
    `      content: zhiLing + (xia ? \`\\n\\n【下一步】\${xia.id} \${xia.title}\` : '') + \`\\n\\n【当前计划/进度】\\n\${qingDan}\``
        + ` + (yiWanChanPin ? \`\\n\\n【已完成的产物 · 不要重复生成同名文件】\\n\${yiWanChanPin}\` : '')`
        + ` + (yiDaKaiLie ? \`\\n\\n【已经打开过的文件 · 不要再 open_path】\${yiDaKaiLie}\` : '')`
        + ` + \`\\n\\n（这是系统自动接着派的一轮，不需要等我说话。请只做还没完成的部分。）\`,`,
    'continue-body',
  ],
]);

// open_path：本会话已打开过就如实说明并跳过（防「不断打开文件」）
edit('packages/app-shell/src/electron-main.ts', [
  [
    `            if (okH && abs) {
              const r0 = await shell.openPath(abs);
              if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
              else {
                huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;`,
    `            if (okH && abs) {
              /** 本会话已打开过 ⇒ 不再重复弹窗（真机：同一文件被连开十几次） */
              try {
                let kaiGuo = huiHuaYiDaKai.get(sessionId);
                if (!kaiGuo) { kaiGuo = new Set(); huiHuaYiDaKai.set(sessionId, kaiGuo); }
                if (kaiGuo.has(abs)) {
                  huiBaoH = \`[open_path] \${abs} 本会话已经打开过了，不再重复打开。如需再看请让用户自己点开。\`;
                } else {
                  const r0 = await shell.openPath(abs);
                  if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
                  else {
                    kaiGuo.add(abs);
                    huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;`,
    'open-once-a',
  ],
  [
    `                try { jiLuBenLunWenJian(String(argsH.path || ''), abs, Number((fs.existsSync(abs) && fs.statSync(abs).size) || 0)); } catch { /* noop */ }
              }
            }
          } else if (gongJuMing === 'run_shell') {`,
    `                    try { jiLuBenLunWenJian(String(argsH.path || ''), abs, Number((fs.existsSync(abs) && fs.statSync(abs).size) || 0)); } catch { /* noop */ }
                  }
                }
              } catch { /* 去重失败不挡打开 */ }
            }
          } else if (gongJuMing === 'run_shell') {`,
    'open-once-b',
  ],
]);

console.log('phase1 electron-main done');
