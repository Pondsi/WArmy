#!/usr/bin/env node
/**
 * verify-chat-content —— 多模态内容块 / 空回复 / 工具失败可见。
 * 真事故：① 截图只把路径塞进文本，模型「没看出来」；② 回复为空时界面一片空白，
 * 用户只看到「完成了」却什么都没有。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const providersRoot = path.join(pkgRoot, '..', 'providers');

let pass = 0, fail = 0;
const failures = [];
const check = (biaoQian, ok, detail) => {
  if (ok) { pass++; console.log('  PASS', biaoQian, detail ? '=> ' + String(detail).slice(0, 140) : ''); }
  else { fail++; failures.push(biaoQian); console.log('  FAIL', biaoQian, detail ? '=> ' + String(detail).slice(0, 180) : ''); }
};

console.log('[1] 类型层支持多模态内容块');
const typesSrc = fs.readFileSync(path.join(providersRoot, 'src', 'types.ts'), 'utf8');
check('定义 LiaoTianNeiRongBu', /interface LiaoTianNeiRongBu/.test(typesSrc));
check('支持 image_url 块', /image_url/.test(typesSrc));
check('content 可为数组', /content: string \| LiaoTianNeiRongBu\[\]/.test(typesSrc));
check('提供 neiRongWenBen 折文本', /function neiRongWenBen/.test(typesSrc));

console.log('\n[2] OpenAI 转换透传内容块数组');
const baseSrc = fs.readFileSync(path.join(providersRoot, 'src', 'base.ts'), 'utf8');
check('zhuanHuanOpenAI 认数组', /Array\.isArray\(m\.content\)/.test(baseSrc));

console.log('\n[3] 运行时：neiRongWenBen 行为');
const distTypes = path.join(providersRoot, 'dist', 'types.js');
if (fs.existsSync(distTypes)) {
  const T = await import(pathToFileURL(distTypes).href);
  check('纯文本原样', T.neiRongWenBen('你好') === '你好', T.neiRongWenBen('你好'));
  check('数组折文字', T.neiRongWenBen([{ type: 'text', text: '甲' }, { type: 'image_url', image_url: { url: 'data:,' } }, { type: 'text', text: '乙' }]) === '甲乙');
  check('空值折成空串', T.neiRongWenBen(null) === '');
} else {
  check('providers dist 存在（请先 build）', false, distTypes);
}

console.log('\n[4] 渲染层：空回复不空白 + 图片走多模态');
const appSrc = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
check('空回复有占位', /chat\.emptyReply/.test(appSrc) || /本条回复无内容/.test(appSrc));
check('附件随消息传给 chatSend', /attachments: fuJianJi/.test(appSrc) || /attachments:/.test(appSrc));
check('deliver 收附件参数', /deliver\(chatId, text, u, (fuJian|item\.fuJian)/.test(appSrc) || /function deliver\(chatId, text, u, fuJian\)/.test(appSrc));

console.log('\n[5] 主进程：图片喂给模型、过大如实跳过');
const emSrc = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
check('构造 image_url 块', /type: 'image_url'/.test(emSrc));
check('超大图跳过并注明', /未喂给模型/.test(emSrc));
check('审计记录图片附件', /chat\.image-attached/.test(emSrc));

console.log(`\n==== verify-chat-content: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
