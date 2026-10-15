import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

edit('packages/app-shell/src/electron-main.ts', [
  // 1) 撤销「带工具强制非流式」——大上下文一次请求 2~4 分钟且无任何输出
  [
    `      /**
       * **带工具的请求直接走非流式**（真机：MiMo 流式 tool_args 常为空 ⇒
       * 每个工具调用都要再 fallback 一次非流式，一轮 23 次工具 ≈ 双倍请求，极慢）。
       * 流式只留给「无工具的最终回答」（toolChoice:none / 无 tools）。
       */
      const daiGongJu = Array.isArray(Qiu.tools) && Qiu.tools.length > 0 && Qiu.toolChoice !== 'none';
      if (daiGongJu) {
        try {
          const zhi = await yuan.chat(Qiu, signal);
          jieShu(true);
          return zhi;
        } catch {
          /* 非流式失败再走下面的流式/降级 */
        }
      }
      // 端点不支持流式 / 出错 ⇒ 退回普通 chat（不因为"想看流式"就把一轮搞黄）`,
    `      /**
       * **仍优先流式**（真机：强制非流式后，大上下文单次请求 2~4 分钟且
       * zaiChuZi=false ⇒ 用户看是「一直没回复、也没卡死」）。
       * 流式有 tool_args 空参时，下面的 empty-args 回退会再取一次非流式（带超时）。
       */
      // 端点不支持流式 / 出错 ⇒ 退回普通 chat（不因为"想看流式"就把一轮搞黄）`,
    'revert-always-nostream',
  ],
  // 2) empty-args 回退的非流式调用加 90s 超时
  [
    `        if (gongJu.length && gongJu.some((c) => c.function?.name && String(c.function.arguments || '').trim().length < 2)) {
          audit?.log('chat.stream-fallback-empty-args', { model, tools: gongJu.map((c) => c.function?.name).join(',') });
          try {
            const hui = await yuan.chat(Qiu, signal);
            const jieGou = (hui.choices?.[0]?.message as { gongJuDiaoYongJi?: unknown } | undefined)?.gongJuDiaoYongJi;
            if (Array.isArray(jieGou) && jieGou.length) {
              jieShu(true);
              return hui;
            }
          } catch { /* 非流式也失败则继续用现有结果 */ }
        }`,
    `        if (gongJu.length && gongJu.some((c) => c.function?.name && String(c.function.arguments || '').trim().length < 2)) {
          audit?.log('chat.stream-fallback-empty-args', { model, tools: gongJu.map((c) => c.function?.name).join(',') });
          try {
            /** 回退非流式也必须有超时：真机曾一次挂 4 分钟无任何反馈 */
            const yu90 = AbortSignal.timeout(90_000);
            const ben90 = signal ? AbortSignal.any([signal, yu90]) : yu90;
            const hui = await yuan.chat({ ...Qiu, toolChoice: Qiu.toolChoice }, ben90);
            const jieGou = (hui.choices?.[0]?.message as { gongJuDiaoYongJi?: unknown } | undefined)?.gongJuDiaoYongJi;
            if (Array.isArray(jieGou) && jieGou.length) {
              jieShu(true);
              return hui;
            }
          } catch (e) {
            try { audit?.log('chat.stream-fallback-timeout', { model, error: String((e as Error)?.message || e).slice(0, 80) }); } catch { /* */ }
          }
        }`,
    'fallback-90s-timeout',
  ],
  // 3) 「等待回复」无进展无出字超过 90 秒就允许判卡（原来要 5 分钟）
  [
    `    const changAnJingMs = 5 * 60 * 1000;
    const kePanKaSi = !youJinZhan
      && anJingMs >= changAnJingMs
      && (zhongLei === 'shiJian' || zuiDaChongFu >= 3);`,
    `    /**
     * **等待回复（dengDaiHuiFu）更快判定**（真机：强制非流式后一次请求 2~4 分钟
     * 无任何输出，界面像死了）。这里 90 秒无进展、无出字就允许进入卡死判定；
     * 其它行为仍按 5 分钟，避免误伤长工具任务。
     */
    const changAnJingMs = x === 'dengDaiHuiFu' ? 90_000 : 5 * 60 * 1000;
    const kePanKaSi = !youJinZhan
      && anJingMs >= changAnJingMs
      && (zhongLei === 'shiJian' || x === 'dengDaiHuiFu' || zuiDaChongFu >= 3);`,
    'stall-90s-wait',
  ],
]);

console.log('revert+timeout+stall done');
