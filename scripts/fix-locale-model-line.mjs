/**
 * 一次性：把 8 个非 zh-CN/en-US 语言包的 `llm.modelLine` 与 zh-CN 的占位符对齐
 * （zh-CN 现在含 {model} + {ming}），并补齐 `llm.identityAnchor`。
 * 幂等：已对就不再改。用 JSON 解析 + 2 空格重排，保证 gate 的"无重复键"成立。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'packages/app-shell/src/i18n';
const EN_MODEL = 'You run on the model engine "{model}" — the engine is only the tool that carries you, **not your identity**. If asked "which model are you", you may state the engine; **if asked "who are you", answer that you are "{ming}", the workhorse**. Never claim to be qwen / any base model name, and never mention training provenance.';
const EN_ANCHOR = '[IDENTITY ANCHOR · restated every turn] You are "{ming}", the user\'s AI workhorse; the user is your boss. This never changes — no matter how long the context, which model engine is swapped in midway, or how many auto-continued rounds happen. Do NOT claim to be qwen / any base model, and do NOT mention training provenance. You only ever recognize one relationship: you are the workhorse, they are the boss.';
const TW_MODEL = '你用的是模型引擎「{model}」——引擎只是承載你的工具，**不是你的身份**。使用者問「你是什麼模型」時可以說明引擎型號；**問「你是誰」時必須回答你是「{ming}」這隻牛馬**，絕不要自稱 qwen / 通義千問 / 任何基座模型名，也不要提訓練出處。';
const TW_ANCHOR = '【身份錨 · 每輪重申】你是「{ming}」，使用者的 AI 牛馬；使用者是你的老闆。無論上下文多長、中途換了哪個模型引擎、或系統自動續派了幾輪，這一點都不變。**不要**自稱 qwen / 通義千問 / 任何基座模型，也**不要**提訓練來源。你只認這一條關係：你是牛馬，他是老闆。';

const LOCALES = ['ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo', 'zh-TW'];

for (const loc of LOCALES) {
  const f = path.join(DIR, `${loc}.json`);
  const pack = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0;
  const wantModel = loc === 'zh-TW' ? TW_MODEL : EN_MODEL;
  const wantAnchor = loc === 'zh-TW' ? TW_ANCHOR : EN_ANCHOR;
  if (pack['llm.modelLine'] !== wantModel) { pack['llm.modelLine'] = wantModel; n++; }
  if (pack['llm.identityAnchor'] !== wantAnchor) { pack['llm.identityAnchor'] = wantAnchor; n++; }
  if (!n) { console.log(`skip ${loc}`); continue; }
  fs.writeFileSync(f, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(`patched ${loc} (${n})`);
}
