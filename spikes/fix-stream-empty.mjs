import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = `        if (finishReason === 'tool_calls' && !gongJu.length) {
          audit?.log('chat.stream-fallback-tools', { model });
          const hui = await yuan.chat(Qiu, signal);
          jieShu(true);
          return hui;
        }`;
const newS = `        if (finishReason === 'tool_calls' && !gongJu.length) {
          audit?.log('chat.stream-fallback-tools', { model });
          const hui = await yuan.chat(Qiu, signal);
          jieShu(true);
          return hui;
        }
        /**
         * **工具名有、参数空**（真机：MiMo 流式偶发 arguments 为空 ⇒ write_file 落 0 字节）。
         * 退回非流式把完整 tool_calls 取回来；绝不拿空参数去执行工具。
         */
        if (gongJu.length && gongJu.some((c) => c.function?.name && String(c.function.arguments || '').trim().length < 2)) {
          audit?.log('chat.stream-fallback-empty-args', { model, tools: gongJu.map((c) => c.function?.name).join(',') });
          try {
            const hui = await yuan.chat(Qiu, signal);
            const jieGou = (hui.choices?.[0]?.message as { gongJuDiaoYongJi?: unknown } | undefined)?.gongJuDiaoYongJi;
            if (Array.isArray(jieGou) && jieGou.length) {
              jieShu(true);
              return hui;
            }
          } catch { /* 非流式也失败则继续用现有结果 */ }
        }`;
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('empty-args stream fallback added');
}
