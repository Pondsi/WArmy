/** R78 #20/#21: nm viewer is listed, enabled by default, and the open preference defaults to on. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
let ok = 0, fail = 0;
const j = (name, pass) => { pass ? ok++ : fail++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); };
j('内置插件列表含 nm-file 且默认启用', /id: 'nm-file'[\s\S]{0,120}enabled: true/.test(app));
j('nm 打开项目文件默认勾选（未存过时为 true，存过 false 仍尊重）',
  /nmKaiWenJian: true/.test(app) && /s\.nmKaiWenJian !== false/.test(app) && /s\.settings\.nmKaiWenJian !== false/.test(app));
j('未勾选时左键走系统默认程序（行为分支）', /nmChaJianKai\(\) && state\.nmKaiWenJian === true/.test(app));
j('主进程也按插件开关决定是否交给 nm', /chaJianJi[\s\S]{0,400}nm-file|nm-file[\s\S]{0,400}chaJianJi/.test(main));
j('设置库默认值也是开启（新账号不再被 false 覆盖）',
  /nmKaiWenJian: true/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8')));
j('主进程读取未存过的值为开（显式 false 才关）', /nmKaiWenJian !== false/.test(main));
j('第二列水印不超出列宽（窄列不压 logo）',
  /min\(168px, calc\(100% - 24px\)\)/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8')));
console.log(`\nverify-r78-nm-plugin: ${ok} ok / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
