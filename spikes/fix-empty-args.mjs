import fs from 'node:fs';

// 1) verify: use mimo-v2.5 (reliable tool args)
{
  const p = 'verify-round18.mjs';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace("const CHAT_MODEL = process.env.CHAT_MODEL || 'mimo-v2.6-flash';", "const CHAT_MODEL = process.env.CHAT_MODEL || 'mimo-v2.5';");
  s = s.replaceAll('mimo-v2.6-flash', 'mimo-v2.5');
  fs.writeFileSync(p, s, 'utf8');
  console.log('verify -> mimo-v2.5');
}

// 2) product: empty work-tool args → clearer error + not a permanent block
{
  const p = 'packages/app-shell/src/work-tools.ts';
  let s = fs.readFileSync(p, 'utf8');
  const oldS = `  if (name === 'write_file') {`;
  // Find empty content error and improve; also add empty-args guard before runWorkTool
  const needle = `export function runWorkTool(baseDir: string, call: { function?: { name?: string; arguments?: unknown } }, kuaiQuan = false, gaoJiMuLu = ''): WorkToolResult {
  const name0 = String((call && call.function && call.function.name) || '');`;
  const add = `export function runWorkTool(baseDir: string, call: { function?: { name?: string; arguments?: unknown } }, kuaiQuan = false, gaoJiMuLu = ''): WorkToolResult {
  const name0 = String((call && call.function && call.function.name) || '');
  /**
   * **空参数工具调用**（真机：MiMo 偶发吐 name 但 arguments 为空 ⇒ write_file 落成 0 字节）。
   * 如实报错并给出可执行示例，让模型下一轮带齐参数 —— 不要静默造空文件。
   */
  {
    const raw0 = call && call.function ? call.function.arguments : undefined;
    const parsed0 = jieXiGongJuCanShu(raw0);
    const kong = !parsed0.args || Object.keys(parsed0.args).length === 0;
    if (kong && !['get_time', 'list_dir', 'list_archive', 'list_subagents'].includes(String(parsed0.args && name0 || name0))) {
      if (name0 === 'write_file') {
        return fail('write_file', new Error('empty-args（工具参数为空：请重新调用并带上 path 与 content，例如 {\\"path\\":\\"note.txt\\",\\"content\\":\\"正文\\"}）'), '');
      }
    }
  }`;
  if (s.includes(needle)) {
    s = s.replace(needle, add);
    fs.writeFileSync(p, s, 'utf8');
    console.log('work-tools empty-args guard');
  } else {
    console.log('work-tools needle missing');
  }
}

// 3) electron-main: if work tool args empty, do not count as same-fingerprint repeat blocker for next GOOD call
// (fingerprint already differs when args differ). Also log raw args length.
{
  const p = 'packages/app-shell/src/electron-main.ts';
  let s = fs.readFileSync(p, 'utf8');
  const oldS = `      const rawArgsH = call && call.function ? call.function.arguments : undefined;`;
  const newS = `      const rawArgsH = call && call.function ? call.function.arguments : undefined;
      try {
        const ra = String(rawArgsH || '');
        if (ra.length < 3) audit?.log('chat.tool-empty-args', { sessionId, tool: gongJuMing, rawLen: ra.length });
      } catch { /* noop */ }`;
  const n = s.split(oldS).length - 1;
  console.log('rawArgsH hits', n);
  if (n === 1) {
    s = s.replace(oldS, newS);
    fs.writeFileSync(p, s, 'utf8');
    console.log('empty-args audit added');
  }
}
