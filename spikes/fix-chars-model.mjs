/**
 * 修：字数统计错导致无限写 / currentModel 粘死 Ollama / 动态小字计时重置
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

const EM = 'packages/app-shell/src/electron-main.ts';

edit(EM, [
  // 1) 产物台账：写入优先，读文件不挤掉写入
  [
    `function jiLuBenLunWenJian(luJing: string, zhenAbs: string, bytes: number, chars?: number): void {
  try {
    const abs = String(zhenAbs || luJing || '');
    if (!abs || benLunChanPin.some((x) => x.abs === abs)) return;
    if (benLunChanPin.length >= 30) return;`,
    `function jiLuBenLunWenJian(luJing: string, zhenAbs: string, bytes: number, chars?: number, youXian = false): void {
  try {
    const abs = String(zhenAbs || luJing || '');
    if (!abs) return;
    const yi = benLunChanPin.find((x) => x.abs === abs);
    if (yi) {
      // 同一文件再次写入：刷新字节/字符（取更大），否则后续追加后字数停在旧值
      if (bytes > (yi.bytes || 0)) yi.bytes = bytes;
      if (Number(chars || 0) > Number(yi.chars || 0)) yi.chars = Number(chars || 0);
      return;
    }
    /**
     * **写入不许被读文件挤掉**（真机：台账满 30 条后小说追加被丢 ⇒ 字数停在 534
     * ⇒ target-length 永远觉得没写够 ⇒ 无限重写）。
     * 写入可挤掉最早的读记录；读满了就丢。
     */
    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: String(path.basename(abs) || luJing) };
    if (benLunChanPin.length >= 30) {
      const du = benLunChanPin.findIndex((x) => !x.chars || x.chars <= 0);
      if (youXian && du >= 0) benLunChanPin.splice(du, 1);
      else if (!youXian) return;
      else {
        // 全是写入：丢最早的
        benLunChanPin.shift();
      }
    }`,
    'ledger-write-priority',
  ],
  // 2) 目标字数：以磁盘真实字数为准（跨轮台账 + 读文件）
  [
    `  {
    const yao = yaoQiuZiShu(String(xiaoXi.content || ''));
    if (yao > 0) {
      const xie = benLunChanPin.reduce((zui, x) => Math.max(zui, Number(x.chars) || 0), 0);`,
    `  {
    const yao = yaoQiuZiShu(String(xiaoXi.content || ''));
    if (yao > 0) {
      /**
       * **磁盘真实字数**（真机：台账被挤掉后 xie 停在 534，小说已 16KB 仍在无限重写）。
       * 取「本轮 + 会话台账」的 max，并**实读文件**核对；写够就收工。
       */
      let xie = benLunChanPin.reduce((zui, x) => Math.max(zui, Number(x.chars) || 0), 0);
      try {
        const tai = huiHuaChanPinTai.get(sessionId) || [];
        for (const x of tai) xie = Math.max(xie, Number(x.chars) || 0);
        // 实读：路径还在磁盘上的最大字符数
        for (const x of [...benLunChanPin, ...tai]) {
          try {
            const abs = String(x.abs || '');
            if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              const txt = fs.readFileSync(abs, 'utf8');
              xie = Math.max(xie, [...txt].length);
            }
          } catch { /* 读不了就用记录值 */ }
        }
      } catch { /* */ }`,
    'target-length-disk',
  ],
  // 3) target-length 续派硬上限，防止永远写不够
  [
    `        if ((meiYouJinZhan.get(sessionId) || 0) >= 2) {
          meiYouJinZhan.delete(sessionId);
          try { audit?.log('plan.auto-continue-length-capped', { sessionId, xie, yao, kongZhuan: (meiYouJinZhan.get(sessionId) || 0) }); } catch { /* noop */ }
          return { jiXu: false, liYou: 'length-capped' };
        }
        try { huiHuaChongFu.delete(sessionId); } catch { /* noop */ }
        try { audit?.log('plan.auto-continue', { sessionId, why: 'target-length', xie, yao }); } catch { /* noop */ }
        return { jiXu: true, liYou: 'target-length' };`,
    `        if ((meiYouJinZhan.get(sessionId) || 0) >= 2) {
          meiYouJinZhan.delete(sessionId);
          try { audit?.log('plan.auto-continue-length-capped', { sessionId, xie, yao, kongZhuan: (meiYouJinZhan.get(sessionId) || 0) }); } catch { /* noop */ }
          return { jiXu: false, liYou: 'length-capped' };
        }
        /**
         * **目标长度续派硬顶**（真机：几十分钟无限重写）。同一任务最多续 8 次写长文，
         * 到顶就如实停，并把当前真实字数说清楚。
         */
        {
          const m = buZhouYanXu.get(sessionId) || new Map<string, number>();
          const ci = (m.get('__length__') || 0) + 1;
          m.set('__length__', ci);
          buZhouYanXu.set(sessionId, m);
          if (ci > 8) {
            try { audit?.log('plan.auto-continue-length-capped', { sessionId, xie, yao, n: ci }); } catch { /* noop */ }
            return { jiXu: false, liYou: 'length-capped' };
          }
        }
        try { huiHuaChongFu.delete(sessionId); } catch { /* noop */ }
        try { audit?.log('plan.auto-continue', { sessionId, why: 'target-length', xie, yao }); } catch { /* noop */ }
        return { jiXu: true, liYou: 'target-length' };`,
    'length-hard-cap',
  ],
  // 4) currentModel 不再作 explicit（新用户轮已清；内部续派也回 defaultModel/链）
  [
    `        explicit: String(xiaoXi.model || '').trim()
          || ((xiaoXi as { internal?: boolean }).internal ? dangQianMoXingOf(sessionId) : '')
          || undefined,`,
    `        /**
         * **不再用 currentModel 当 explicit**（真机：降级后粘死 Ollama，
         * 用户配的 MiMo 整段任务再也用不上）。降级记忆只作界面显示；
         * 选型一律走 默认模型/调用链，挂了再顺链降。
         */
        explicit: String(xiaoXi.model || '').trim() || undefined,`,
    'no-explicit-current',
  ],
]);

console.log('phase chars-model done');
