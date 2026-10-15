import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

// 在系统提示「必须先列计划」附近，增加：若仍无计划，由宿主预置骨架
const oldS = `            {
              const yiYouJiHua = (jiHuaRenWuJi.get(sessionId) || []).length > 0;
              if (!yiYouJiHua) {
                ju.push(tMain('llm.planFirst', '【多步任务 · 必须先列计划】用户要求做多件事/多步骤时，**第一件事就是调用 plan_update** 列出步骤（id / 标题 / status=pending），再逐个完成并用 plan_verify 标记验证。禁止跳过计划直接散做。界面右侧「计划任务」卡片会同步显示进度。'));
              }
            }`;

const newS = `            {
              const yiYouJiHua = (jiHuaRenWuJi.get(sessionId) || []).length > 0;
              if (!yiYouJiHua) {
                ju.push(tMain('llm.planFirst', '【多步任务 · 必须先列计划】用户要求做多件事/多步骤时，**第一件事就是调用 plan_update** 列出步骤（id / 标题 / status=pending），再逐个完成并用 plan_verify 标记验证。禁止跳过计划直接散做。界面右侧「计划任务」卡片会同步显示进度。'));
                /**
                 * **宿主预置计划骨架**（本轮修「计划任务没有生成」）：
                 * 模型偶发 plan_update 空参 / 干脆不调 ⇒ 第四列永远空。
                 * 多步请求且尚无计划时，先按句子切出骨架步骤，保证卡片有内容；
                 * 模型随后可用 plan_update 改写/细化。
                 */
                try {
                  const wen = String(xiaoXi.content || '');
                  const duoBu = /任务|步骤|计划|逐个|依次|全部|都做|完成这些|一步一步|生成|写入|打开|等待|然后再/.test(wen);
                  if (duoBu && !(jiHuaRenWuJi.get(sessionId) || []).length) {
                    const juZi = wen.split(/[。；;\\n\\r]+/).map((x) => x.trim()).filter((x) => x.length >= 4);
                    const bu: JiHuaBu[] = [];
                    let hao = 1;
                    for (const j of juZi.slice(0, 8)) {
                      const id = 'T' + hao;
                      bu.push({ id, title: j.slice(0, 80), status: 'pending', note: 'host-seed' });
                      hao += 1;
                    }
                    if (bu.length >= 2) {
                      jiHuaBaoCun(sessionId, bu);
                      audit?.log('plan.host-seed', { sessionId, steps: bu.length });
                    }
                  }
                } catch { /* 预置失败不挡对话 */ }
              }
            }`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) { console.log('fail'); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('host-seed plan added');
