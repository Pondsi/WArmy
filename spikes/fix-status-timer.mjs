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

// 动态小字计时：开始时间=任务开始（不因续派/换模型重置）
edit('packages/app-shell/src/renderer/app.js', [
  [
    `  function yunXingZhuangTaiKai(chatId) {
    const he = $('yunXingZhuangTai');
    if (!he) return;
    // 新一轮开始 ⇒ 允许这一会话的流式分片再进来（收尾标记清掉）
    try { _liuShiShouWei.delete(String(chatId || '')); } catch { /* noop */ }
    yunXingHuiHua = String(chatId || '');
    yunXingKaiShi = Date.now();
    yunXingZuiXin = yunXingKaiShi;
    yunXingXuHao = 1;
    yunXingShiDai += 1;`,
    `  function yunXingZhuangTaiKai(chatId, opts) {
    const he = $('yunXingZhuangTai');
    if (!he) return;
    // 新一轮开始 ⇒ 允许这一会话的流式分片再进来（收尾标记清掉）
    try { _liuShiShouWei.delete(String(chatId || '')); } catch { /* noop */ }
    const tongYiRenWu = yunXingHuiHua === String(chatId || '') && yunXingKaiShi > 0
      && !(opts && opts.xinRenWu);
    yunXingHuiHua = String(chatId || '');
    /**
     * **开始时间 = 任务开始**（产品要求）：自动续派 / 换模型 / 内容更新都不重置。
     * 只有**新用户任务**（xinRenWu）才把开始时间拨到当下；
     * 持续秒数 = 从任务开始到最终回复，中途不归零。
     */
    if (!tongYiRenWu) {
      yunXingKaiShi = Date.now();
      yunXingXuHao = 1;
    }
    yunXingZuiXin = Date.now();
    yunXingShiDai += 1;`,
    'status-timer',
  ],
  [
    `    yunXingZhuangTaiKai(chatId);`,
    `    yunXingZhuangTaiKai(chatId, { xinRenWu: true });`,
    'status-new-task',
  ],
]);

// 内部续派广播 yunXingZhuangTai 时不要当新任务 —— 主进程已带 kai:true
// 渲染层 22678: if (d.kai) yunXingZhuangTaiKai(sid);
edit('packages/app-shell/src/renderer/app.js', [
  [
    `        if (d.kai) yunXingZhuangTaiKai(sid);`,
    `        // 续派/运行中广播：同一任务，不重置开始时间
        if (d.kai) yunXingZhuangTaiKai(sid, { xinRenWu: false });`,
    'status-broadcast',
  ],
]);

console.log('status timer fixed');
