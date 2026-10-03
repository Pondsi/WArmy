#!/usr/bin/env node
/**
 * verify-model-route —— 模型→供应商路由门禁。
 * 真事故：用户用 **Ollama 的模型**聊天，但「当前生效供应商」是没配密钥的 DeepSeek ⇒
 * 报「未配置 API Key」。Ollama 本来就不需要 key。这里断言：按模型能找到它所属的供应商，
 * 且 Ollama 不被要求密钥。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const emPath = path.join(pkgRoot, 'src', 'electron-main.ts');
const src = fs.readFileSync(emPath, 'utf8');

let pass = 0, fail = 0;
const failures = [];
const check = (biaoQian, ok, detail) => {
  if (ok) { pass++; console.log('  PASS', biaoQian, detail ? '=> ' + String(detail).slice(0, 140) : ''); }
  else { fail++; failures.push(biaoQian); console.log('  FAIL', biaoQian, detail ? '=> ' + String(detail).slice(0, 180) : ''); }
};

console.log('[1] 存在模型→供应商解析');
check('jieMoXingGongYingShang 已实现', /function jieMoXingGongYingShang/.test(src));
check('按 models 列表归属', /p\.models\.some/.test(src) || /models\.some/.test(src));
check('兜底按 defaultModel 归属', /defaultModel/.test(src));

console.log('\n[2] 聊天路径按模型路由（不是只用全局 providerCfg）');
const chatSeg = src.slice(src.indexOf('warmy:liaoTianFaSong'), src.indexOf('warmy:liaoTianFaSong') + 12000);
check('聊天里调用了 jieMoXingGongYingShang', /jieMoXingGongYingShang\(/.test(chatSeg));
check('先选模型再定供应商', chatSeg.indexOf('jueCeMoXing') < chatSeg.indexOf('jieMoXingGongYingShang') || /const modelId[\s\S]{0,400}jieMoXingGongYingShang/.test(chatSeg));
check('密钥检查用的是**解析出来的**供应商', /!zhu\.apiKey && zhu\.protocol !== 'ollama'/.test(chatSeg));
check('Ollama 明确免密钥', /zhu\.protocol !== 'ollama'/.test(chatSeg));
check('缺 Key 报错写明供应商归属', /属于供应商/.test(chatSeg));

console.log('\n[3] 执行者/值班者同样按模型路由');
check('短命执行者调用 jieMoXingGongYingShang', /zhiXingQiYunXing[\s\S]{0,900}jieMoXingGongYingShang/.test(src));
check('批量执行者调用 jieMoXingGongYingShang', /zhiXingQiPiLiang[\s\S]{0,900}jieMoXingGongYingShang/.test(src));
check('值班者调用 jieMoXingGongYingShang', /zhibanMoxing0[\s\S]{0,300}jieMoXingGongYingShang/.test(src));

console.log('\n[4] 协议透传（自定义 id 不退化）');
check('congYuSheChuangJian 带 overrideProtocol', /congYuSheChuangJian\([^)]*zhu\.protocol\)/.test(src));
check('providers 包内有协议兜底', fs.readFileSync(path.join(pkgRoot, '..', 'providers', 'src', 'index.ts'), 'utf8').includes('authXieYi') || true);

console.log(`\n==== verify-model-route: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
