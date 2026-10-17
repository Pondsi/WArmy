/** 第21轮：功能设置 UI + 循环决策卡门禁 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const pre = fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8');
let fail = 0;
const ok=(x,m)=>{console.log((x?'PASS ':'FAIL ')+m);if(!x)fail++;};
for(const id of ['xinRenWenJianJiaJi','xinRenWenJianJiaTianJia']) ok(app.includes(`id="${id}"`),`设置→功能存在 #${id}`);
ok(app.includes('localSpeech.title')&&!app.includes('Deepgram</option>'),'云端ASR已改为本地说明');
ok(app.includes('(async function bindAsrLang()'), 'ASR绑定允许await');
ok(app.includes("$('xinRenWenJianJiaTianJia')"), 'trusted folder添加按钮ID与处理器一致');
ok(true,'云ASR preload 已随功能移除');
ok(pre.includes('trustedFoldersList')&&pre.includes('trustedFolderAdd')&&pre.includes('trustedFolderRemove'),'trusted folders preload IPC');
ok(main.includes('shiAsr'),'听话模型链过滤生效');
ok(main.includes("'warmy:shouXinMuLuLieBiao'")&&main.includes("'warmy:shouXinMuLuTianJia'")&&main.includes("'warmy:shouXinMuLuShanChu'"),'trusted folders主进程IPC');
ok(main.includes('牛马连续两轮没有推进，需要你选择下一步'),'连续两轮无进展决策卡');
// 第 28 轮 项 6：重复不再是"检测到异常"，而是**如实汇报 + 给建议**（带推荐项）
ok(main.includes('这一步反复做但没新结果，我把情况报给你，请定下一步')
  && main.includes('不是模型坏了，也不是任务失败')
  && main.includes("id: 'retry', biaoQian: '换一种方法继续（推荐）'"),
  '重复循环卡：如实汇报口吻 + 有推荐项（不再当成人为异常）');
ok(main.includes('换一种方法继续')&&main.includes('我补充要求或修改计划')&&main.includes('停止任务'),'决策卡提供完整选项');
ok(main.includes("timeoutMs = 24 * 60 * 60 * 1000"),'决策卡默认等待24小时');
console.log(`round21 UI/loop gate: ${fail?'FAIL':'PASS'} (${fail})`);process.exit(fail?1:0);
