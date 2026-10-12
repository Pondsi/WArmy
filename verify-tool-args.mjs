/**
 * verify-tool-args.mjs — 工具参数归一 / 自动补扩展名 结构断言
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const wt = fs.readFileSync(path.join(root, 'packages/app-shell/src/work-tools.ts'), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

check('has quLuJingCanShu', wt.includes('export function quLuJingCanShu'));
check('has buKuoZhanMing', wt.includes('export function buKuoZhanMing'));
check('accepts file alias', /file/.test(wt) && /filePath/.test(wt) && /filename/.test(wt));
check('write_file default path', wt.includes("args.path = 'output-'") || wt.includes('output-'));
check('make_pptx auto ext', wt.includes("buKuoZhanMing(String(args.path || 'slides')"));
check('make_docx auto ext', wt.includes("buKuoZhanMing(String(args.path || 'document')"));
check('runWorkTool normalizes', wt.includes('quLuJingCanShu(args)'));

const em = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
check('wall timeout 600s', em.includes('600_000') && em.includes('zhengLunShiChao'));
check('no 180s wall timeout', !em.includes('tool-loop-timeout(180s)'));

const app = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('no interrupted hint bubble', !app.includes("escapeHtml(tOr('chat.resumeTaskHint'"));
check('resume button centered class', app.includes('huiFuRenWuJuZhong'));

const css = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
check('css centers resume button', css.includes('huiFuRenWuJuZhong'));

const eta = fs.readFileSync(path.join(root, 'packages/app-shell/src/eta-forecast.ts'), 'utf8');
check('ETA gongJu 60s/3', /gongJu:\s*\{[\s\S]{0,80}miao:\s*60\s*\*\s*1000/.test(eta) && /lun:\s*3/.test(eta));
check('ETA CHAO_SHI 9', eta.includes('CHAO_SHI_LIAN_XU_XIAN = 9'));
check('ETA PAN_MO_XING 5', eta.includes('PAN_MO_XING_SHANG_XIAN = 5'));
check('ETA YANXU 40/20min', em.includes('YANXU_YUJING_CI = 40') && em.includes('20 * 60 * 1000'));

console.log(`RESULT ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
