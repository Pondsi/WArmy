/**
 * 修：配了 MiMo 却用 Ollama / 反复授权完不成 / 计划卡不生成
 *
 * 根因：
 *  1. 降级后 currentModel 粘住 Ollama，**新用户轮**也走 explicit ⇒ 配置的 MiMo 再也不用
 *  2. plan_update 空参数仍 ok:true，计划卡存成 []
 *  3. 授权键太窄（操作+完整路径），Desktop 下换个文件名就再弹卡
 *  4. yingGaiZiDongJiXu 被调两次（判断 + 续派），计数翻倍
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
  // 1) currentModel 只在**内部续派**时生效；新用户轮回到 defaultModel/调用链
  [
    `        explicit: String(xiaoXi.model || '').trim() || dangQianMoXingOf(sessionId) || undefined,`,
    `        /**
         * **currentModel 只黏内部续派**（本轮修：用户配了 MiMo，降级后却永远用 Ollama）。
         * 新用户轮一律回到「牛马默认模型 / 调用链」；自动续派（internal）才继续用降级后的模型
         * 把手头这轮干完。
         */
        explicit: String(xiaoXi.model || '').trim()
          || ((xiaoXi as { internal?: boolean }).internal ? dangQianMoXingOf(sessionId) : '')
          || undefined,`,
    'explicit-internal-only',
  ],
  // 2) 新用户轮清掉 currentModel（避免下一次又粘住）
  [
    `    /** 新一轮用户消息 ⇒ **工具调用预算清零**（预算按"一轮"算） */
    benLunGongJuShu.set(sessionId, 0);`,
    `    /** 新一轮用户消息 ⇒ **工具调用预算清零**（预算按"一轮"算） */
    benLunGongJuShu.set(sessionId, 0);
    /**
     * **新用户轮清掉「当前模型」粘滞**（本轮修：配了 MiMo 却一直用降级后的 Ollama）。
     * 降级黏住只服务**本轮内部续派**；用户再说话时应回到他配的默认模型。
     */
    if ((xiaoXi as { internal?: boolean }).internal !== true) {
      try {
        const s = settingsStore?.load() as { instances?: Array<{ id?: string; currentModel?: unknown }> } | undefined;
        const list = Array.isArray(s?.instances) ? s!.instances! : [];
        const cur = list.find((x) => x && x.id === sessionId);
        if (cur && String(cur.currentModel || '').trim()) {
          cur.currentModel = '';
          settingsStore?.save({ instances: list } as never);
          audit?.log('chat.currentModel-cleared', { sessionId, why: 'new-user-turn' });
        }
      } catch { /* 清不掉不挡对话 */ }
    }`,
    'clear-current-on-user-turn',
  ],
  // 3) plan_update 空参数必须失败（否则计划卡永远是空的）
  [
    `            if (gongJuMing === 'plan_update') {
              const bu = Array.isArray(argsH.steps) ? (argsH.steps as unknown[]).map((x) => {`,
    `            if (gongJuMing === 'plan_update') {
              const stepsRaw = Array.isArray(argsH.steps) ? argsH.steps : [];
              if (!stepsRaw.length) {
                okH = false;
                huiBaoH = '[plan_update] 参数为空（steps 必填）。请重新调用并给出步骤数组，例如 {"steps":[{"id":"T1","title":"生成文件","status":"pending"},{"id":"T2","title":"确认完成","status":"pending"}]}。计划卡片需要真实步骤才能显示。';
              }
              const bu = stepsRaw.map((x) => {`,
    'plan-empty-args',
  ],
  // 4) 续派判断复用结果，避免 yingGaiZiDongJiXu 双跑
  [
    `      let planPending = false;
      if (!shiNeiBu && yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, { diaoYongJi: loop.gongJuDiaoYongJi, huiFu: reply }).jiXu) {
        planPending = true;
        stoppedSessions.delete(sessionId); // 新一轮续派前清掉旧的停止标记
        setTimeout(() => {
          void yanXuJiHuaRenWu(sessionId, xiaoXi as never, {
            diaoYongJi: loop.gongJuDiaoYongJi,
            huiFu: reply,
            cuoWu: String((loop as { degradedReason?: string }).degradedReason || loop.tingZhiYuanYin || ''),
          });
        }, 250);`,
    `      let planPending = false;
      /**
       * **判续派只跑一次**（真机：yingGaiZiDongJiXu 被「先判再派」调两次，
       * 次数/空转计数翻倍，还会多记一条 plan.auto-continue）。
       * 结果传给 yanXuJiHuaRenWu，不再重算。
       */
      const xuPan = !shiNeiBu
        ? yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, { diaoYongJi: loop.gongJuDiaoYongJi, huiFu: reply })
        : { jiXu: false, liYou: 'internal' };
      if (xuPan.jiXu) {
        planPending = true;
        stoppedSessions.delete(sessionId);
        setTimeout(() => {
          void yanXuJiHuaRenWu(sessionId, xiaoXi as never, {
            diaoYongJi: loop.gongJuDiaoYongJi,
            huiFu: reply,
            cuoWu: String((loop as { degradedReason?: string }).degradedReason || loop.tingZhiYuanYin || ''),
          }, xuPan);
        }, 250);`,
    'continue-once',
  ],
  // 5) yanXuJiHuaRenWu 收预判结果
  [
    `async function yanXuJiHuaRenWu(sessionId: string, xiaoXi: Parameters<typeof zhenZhengFaSong>[1], shangLun?: { diaoYongJi?: number; huiFu?: string; cuoWu?: string }): Promise<void> {`,
    `async function yanXuJiHuaRenWu(sessionId: string, xiaoXi: Parameters<typeof zhenZhengFaSong>[1], shangLun?: { diaoYongJi?: number; huiFu?: string; cuoWu?: string }, yuPan?: { jiXu: boolean; liYou: string }): Promise<void> {`,
    'yanxu-sig',
  ],
  [
    `    const pan = yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, shangLun);`,
    `    const pan = yuPan && yuPan.liYou !== 'internal'
      ? yuPan
      : yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, shangLun);`,
    'yanxu-use-yupan',
  ],
]);

console.log('phase model-auth-plan done');
