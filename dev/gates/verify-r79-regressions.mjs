/** R79 回归：重启后牛马显示名不退回内部 ID；FWArmy 不在 WArmy 仓库内。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
let ok = 0, fail = 0;
const j = (name, pass, d) => { pass ? ok++ : fail++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ' ← ' + String(d || '').slice(0, 300)}`); };

j('合并运行态时保留已落盘的非 id 显示名',
  /const oldMing = mingOf\(old\);[\s\S]{0,220}oldMing !== old\.id[\s\S]{0,220}n\.ming = oldMing/.test(app));
j('单聊列表优先用实例显示名（会话记录 name 是 id 也不外泄）',
  /function singleChatItems\(\)[\s\S]{0,700}const ming = \(inst && mingOf\(inst\)\) \|\| mingOf\(c\) \|\| c\.id/.test(app));
j('第二列渲染同样优先实例显示名',
  /source\.forEach\(\(c\) => \{[\s\S]{0,400}const ming = \(inst && mingOf\(inst\)\) \|\| mingOf\(c\) \|\| c\.id/.test(app));
j('nm 默认开启（设置库默认 + 主进程只在显式 false 时关）',
  /nmKaiWenJian: true/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8'))
  && /nmKaiWenJian !== false/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8')));
j('第二列水印宽度不超过列宽',
  /min\(168px, calc\(100% - 24px\)\)/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8')));
j('FWArmy 已移出 WArmy 仓库（同级独立目录）',
  !fs.existsSync(path.join(ROOT, 'fwarmy')) && fs.existsSync(path.resolve(ROOT, '..', 'FWArmy', 'server.mjs')));
j('项目/群聊改名只对创建者可见（加入者不能改别人的名称）',
  /yiJiaRu \? \{\s*biaoQian: t\('ctx\.rename'\)/.test(app)
  && !/\n\s{6}\{\n\s{8}biaoQian: t\('ctx\.rename'\),[\s\S]{0,200}g\.name/.test(app));
console.log(`\nverify-r79-regressions: ${ok} ok / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
