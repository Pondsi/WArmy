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

edit('packages/app-shell/src/electron-main.ts', [
  [
    `                    const r0 = await shell.openPath(abs);
                    if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
                    else {
                      kaiGuo.add(abs);
                      huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;`,
    `                    const r0 = await shell.openPath(abs);
                    if (r0) {
                      try {
                        shell.showItemInFolder(abs);
                        kaiGuo.add(abs);
                        huiBaoH = \`[open_path] 默认程序打开失败（\${r0}），已在资源管理器中定位 \${abs}\`;
                      } catch {
                        okH = false;
                        huiBaoH = \`[open_path] 打开失败：\${r0}\`;
                      }
                    }
                    else {
                      kaiGuo.add(abs);
                      huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;`,
    'open-reveal-fallback',
  ],
  // 注入「本会话用户交代过的事」——修第二轮看不到上文
  [
    `        try {
          const ziDongZhaiYao = (settingsStore?.load() as { autoSummary?: boolean } | undefined)?.autoSummary !== false;`,
    `        /**
         * **本会话用户交代过的事**（本轮修「第二轮说看不到上面的任务」）。
         * 有界视图会压缩中段，长工具轮之后原始任务可能只剩指针；
         * 这里把最近几条 **user** 原文固定注入，模型永远能找回「上面的任务」。
         */
        try {
          const yongHuShi = (chatLogs.get(sessionId) || [])
            .filter((e) => e && (e as { role?: string }).role === 'user' && !(e as { hidden?: boolean }).hidden)
            .slice(-5)
            .map((e, i) => \`\${i + 1}. \${String((e as { content?: string }).content || '').slice(0, 500)}\`)
            .join('\\n');
          if (yongHuShi.trim()) {
            shenFenTou.push({
              role: 'system',
              content: tMain('llm.recentUserTasks', '【本会话用户交代过的事】需要「接着做 / 重做上面的任务」时，以下面这些为准（不要说看不到）：\\n')
                + yongHuShi,
            } as LiaoTianXiaoXi);
          }
        } catch { /* noop */ }
        try {
          const ziDongZhaiYao = (settingsStore?.load() as { autoSummary?: boolean } | undefined)?.autoSummary !== false;`,
    'inject-user-tasks',
  ],
]);

console.log('open + memory inject done');
