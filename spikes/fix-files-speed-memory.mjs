/**
 * 修：产物重复 / 打开未生效 / 慢 / 第二轮看不见任务
 */
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

// 1) 产物列表：同一文件只留一条，更新时间/大小
edit('packages/app-shell/src/renderer/app.js', [
  [
    `    window.warmy.onWenJianChanSheng?.((d) => {
      state.gongZuoWenJian = state.gongZuoWenJian || [];
      if (d && d.path) {
        state.gongZuoWenJian.push({ path: d.path, abs: d.abs || '', bytes: d.bytes || 0, ts: d.ts || Date.now() });
        if (d.root) state.gongZuoQuLuJing = String(d.root);
      }`,
    `    window.warmy.onWenJianChanSheng?.((d) => {
      state.gongZuoWenJian = state.gongZuoWenJian || [];
      if (d && d.path) {
        /**
         * **同一文件只显示一次**（真机：守灯的人.txt 更新几次就出现几条）。
         * 按 abs 去重：已存在就刷新大小/时间（最近改动会排到前面）。
         */
        const abs = String(d.abs || '');
        const key = abs || String(d.path || '');
        const jiu = state.gongZuoWenJian.find((x) => (x.abs || x.path) === key);
        if (jiu) {
          jiu.bytes = Number(d.bytes || jiu.bytes || 0);
          jiu.ts = Number(d.ts || Date.now());
          jiu.path = String(d.path || jiu.path);
          jiu.abs = abs || jiu.abs;
        } else {
          state.gongZuoWenJian.push({ path: d.path, abs: abs, bytes: d.bytes || 0, ts: d.ts || Date.now() });
        }
        if (d.root) state.gongZuoQuLuJing = String(d.root);
      }`,
    'files-dedupe',
  ],
]);

// 2) 带工具时走非流式（消除 empty-args 双倍请求）
edit('packages/app-shell/src/electron-main.ts', [
  [
    `      // 端点不支持流式 / 出错 ⇒ 退回普通 chat（不因为"想看流式"就把一轮搞黄）
      try {
        let reasoning = '';`,
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
      // 端点不支持流式 / 出错 ⇒ 退回普通 chat（不因为"想看流式"就把一轮搞黄）
      try {
        let reasoning = '';`,
    'no-stream-with-tools',
  ],
  // 3) 历史：keepHead=2，并注入最近用户任务
  [
    `    keepHead: DEFAULT_KEEP_HEAD,
    keepTail: DEFAULT_KEEP_TAIL,`,
    `    keepHead: Math.max(2, DEFAULT_KEEP_HEAD),
    keepTail: DEFAULT_KEEP_TAIL,`,
    'keep-head-2',
  ],
]);

// 4) open_path 失败时 showItemInFolder 兜底 + 如实记账
edit('packages/app-shell/src/electron-main.ts', [
  [
    `                  const r0 = await shell.openPath(abs);
                  if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
                  else {
                    kaiGuo.add(abs);
                    huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;`,
    `                  const r0 = await shell.openPath(abs);
                  if (r0) {
                    /**
                     * **openPath 失败时用资源管理器定位**（真机：授权弹了、回执 ok，
                     * 但用户说文件没被打开 —— 默认程序关联失败时 openPath 会静默出错）。
                     */
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
    'open-fallback-reveal',
  ],
]);

console.log('phase files-speed-memory done');
