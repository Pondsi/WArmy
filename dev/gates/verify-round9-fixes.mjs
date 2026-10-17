/**
 * verify-round9-fixes.mjs — 本轮三项修复的结构化断言（不扫全文正则打到自己）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'packages/app-shell/src/renderer/app.js');
const main = path.join(root, 'packages/app-shell/src/electron-main.ts');
const preload = path.join(root, 'packages/app-shell/src/preload.cjs');
const types = path.join(root, 'packages/providers/src/types.ts');
const tools = path.join(root, 'packages/providers/src/tools.ts');
const ollama = path.join(root, 'packages/providers/src/ollama.ts');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log('PASS', name); }
  else { fail += 1; console.log('FAIL', name, detail); }
}

const appT = fs.readFileSync(app, 'utf8');
const mainT = fs.readFileSync(main, 'utf8');
const preT = fs.readFileSync(preload, 'utf8');
const typesT = fs.readFileSync(types, 'utf8');
const toolsT = fs.readFileSync(tools, 'utf8');
const ollamaT = fs.readFileSync(ollama, 'utf8');

// ── 1. 音频测试并入音频设备 ──
check('audio-test lives inside devices card', appT.includes('id="yinPinSheBeiKa"') && appT.includes('anNiuMaiKeFengCeShi') && !appT.includes('id="yinPinCeShiKa"'));
check('audio-test no stray < before escapeHtml title', !appT.includes('<h2><${escapeHtml(tOr(\'audioTest.title\''));
check('audio-test uses document delegation', appT.includes('__yinPinCeShiBound') && appT.includes("t.closest('#anNiuMaiKeFengCeShi')"));
check('bindYinPinCeShi still invoked', appT.includes('bindYinPinCeShi();'));

// ── 2. 说话模型检测 ──
check('hasTts no longer uses tingHuaZhuangTai', !/const hasTts = !!\(stTts && stTts\.ready\)/.test(appT));
check('hasTts queries shuoHuaZhuangTai', appT.includes('shuoHuaZhuangTai'));
check('preload exposes shuoHuaZhuangTai', preT.includes('shuoHuaZhuangTai'));
check('main has shuoHuaZhuangTai IPC', mainT.includes("chuliIpc('warmy:shuoHuaZhuangTai'"));
check('main shuoHuaZhuangTai reads ttsChain', /shuoHuaZhuangTai[\s\S]{0,800}ttsChain/.test(mainT));

// ── 3. toolChoice required ──
check('types allow required', typesT.includes("toolChoice?: 'auto' | 'none' | 'required'"));
check('tools force-retry option', toolsT.includes('lingGongJuQiangZhi') && (toolsT.includes("diaoYongMoXing('required')") || toolsT.includes('diaoYongMoXing(\'required\')')));
check('tools has force-tools message', toolsT.includes('force-tools-required') || toolsT.includes('你必须立即调用工具'));
check('ollama maps tool_choice', ollamaT.includes('ji.tool_choice = Qiu.toolChoice') || ollamaT.includes("tool_choice: 'required'"));
check('ollama OpenAI-required path', ollamaT.includes('chatOpenAIRequired') && ollamaT.includes('v1/chat/completions'));
check('main passes toolChoice required for work', mainT.includes("yaoDongShouBenLun") && mainT.includes("'required'"));
check('main imports YAO_DONG_SHOU', mainT.includes('YAO_DONG_SHOU'));
check('pause message honest about false claims', mainT.includes('口头宣称') || mainT.includes('并未真正调用工具'));

// ── 4. specialModels save not silent ──
check('specialModelsSet error surfaces', !appT.includes('specialModelsSet(cfg).catch(() => {})'));

console.log(`\nRESULT ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
