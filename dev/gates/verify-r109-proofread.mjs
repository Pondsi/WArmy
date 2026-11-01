/** #109 受控校对：纯函数硬校验（无需网络）。 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { validateProofread } = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/scripts/proofread-i18n-ai.mjs')).href);
let ok = 0, fail = 0;
const j = (n, p) => { p ? ok++ : fail++; console.log(`${p ? 'ok  ' : 'FAIL'} ${n}`); };
const src = { a: '你是「{ming}」，运行在「{model}」。', b: '联系 Public@numumu.com · https://github.com/Pondsi/WArmy', c: '短句' };
j('键不变、占位符不变 ⇒ 通过', validateProofread(src, { ...src, c: '短句子' }).length === 0);
j('占位符被改 ⇒ 拒绝', validateProofread(src, { ...src, a: 'Vous êtes {nom}' }).includes('placeholder:a'));
j('新增/删除键 ⇒ 拒绝', validateProofread(src, { a: src.a }).includes('keys-changed'));
j('联系方式丢失 ⇒ 拒绝', validateProofread(src, { ...src, b: '联系我' }).some((x) => x.startsWith('contact:')));
j('URL 丢失 ⇒ 拒绝', validateProofread(src, { ...src, b: 'Public@numumu.com' }).some((x) => x.startsWith('url:')));
j('空值 ⇒ 拒绝', validateProofread(src, { ...src, c: ' ' }).includes('empty:c'));
j('长度上限 ⇒ 拒绝', validateProofread(src, { ...src, c: '很长'.repeat(50) }, { maxLen: { c: 10 } }).includes('too-long:c'));
console.log(`\nverify-r109-proofread: ${ok} ok / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
