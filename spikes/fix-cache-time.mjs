import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel}`);
}

// 15) 时间戳挪出 system（缓存命中：system 尽量静态）
edit('packages/app-shell/src/electron-main.ts', [
  [
    `           * **时间感知**（产品要求）：每次请求都带上当前时刻，模型才知道"现在几点"、
           * "过了多久"。需要更精确的时刻/联网时间时用 \`get_time\` 工具。
           */
          {
            const xz = new Date();
            ju.push(tMain('llm.timeLine', '当前时间是 {time}（时区 {tz}，时间戳 {epoch}）。需要精确时刻或联网时间时调用 get_time 工具；做"等待 N 秒"这类事请按时间戳算差值，不要凭感觉。')
              .replace('{time}', xz.toLocaleString())
              .replace('{tz}', Intl.DateTimeFormat().resolvedOptions().timeZone || 'local')
              .replace('{epoch}', String(xz.getTime())));
          }`,
    `           * **时间感知**（产品要求）：每次请求都带上当前时刻。
           *
           * **缓存友好**（产品要求）：时间戳**不进 system**（每分钟都变会打穿 prompt cache）。
           * 改为：system 只留静态说明；具体时刻附在**最后一条用户消息末尾**（动态内容靠后，
           * 与 OpenAI/Anthropic prompt caching 的「静态前缀 + 动态后缀」一致）。
           */
          {
            const shuoMing = tMain('llm.timeLineHint', '（系统会把当前时刻附在用户消息末尾；需要精确时刻或联网时间时调用 get_time；做"等待 N 秒"按时间戳算差值。）');
            if (shuoMing) ju.push(shuoMing);
          }`,
    'time-out-of-system',
  ],
]);

console.log('cache timestamp moved');
