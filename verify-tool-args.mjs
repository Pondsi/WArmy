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
/**
 * 契约更新：整轮**不再按墙上时间一刀切**（真机事故：写 5000 字/跑长构建这类"一直在推进"
 * 的任务在第 10 分钟被 600s 无条件掐断 ⇒ 降级到本地模型 ⇒ 用户看到"重活完不成"）。
 * 现在两把尺子：连续 `KONG_ZHUAN_MS` 零产出才算卡住 + `YING_DING_MS` 硬顶兜死循环。
 */
check('工具循环按进展计时（5 分钟零产出才算卡住，30 分钟硬顶兜底）',
  em.includes('KONG_ZHUAN_MS = 5 * 60 * 1000') && em.includes('YING_DING_MS = 30 * 60 * 1000') && em.includes('zhengLunQuXiao'));
/**
 * 死板墙钟超时的**实现**必须已经没了（`tool-loop-timeout(600s)` 这个词还留在注释里当历史事故，
 * 所以判据用旧的实现标识符 `zhengLunShiChao` + 旧结论串，而不是"注释里不许提到 600s"）。
 */
check('旧的死板 600s/180s 墙钟实现已移除', !em.includes('zhengLunShiChao') && !/tingZhiLiYou = `tool-loop-timeout/.test(em));

const app = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('no interrupted hint bubble', !app.includes("escapeHtml(tOr('chat.resumeTaskHint'"));
check('resume button centered class', app.includes('huiFuRenWuJuZhong'));

const css = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
check('css centers resume button', css.includes('huiFuRenWuJuZhong'));

const eta = fs.readFileSync(path.join(root, 'packages/app-shell/src/eta-forecast.ts'), 'utf8');
/** 单次工具调用的尺子：**120 秒 / 12 次**（原 60s/3 会把下载、构建、多步同名工具调用误判成异常） */
check('ETA gongJu 120s/12（不是旧的 60s/3）', /gongJu:\s*\{[\s\S]{0,80}miao:\s*120\s*\*\s*1000/.test(eta) && /lun:\s*12/.test(eta) && !/gongJu:\s*\{[\s\S]{0,80}miao:\s*60\s*\*\s*1000/.test(eta));
check('ETA CHAO_SHI 9', eta.includes('CHAO_SHI_LIAN_XU_XIAN = 9'));
check('ETA PAN_MO_XING 5', eta.includes('PAN_MO_XING_SHANG_XIAN = 5'));
check('ETA YANXU 40/20min', em.includes('YANXU_YUJING_CI = 40') && em.includes('20 * 60 * 1000'));

console.log(`RESULT ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
