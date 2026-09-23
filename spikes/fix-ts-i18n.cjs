const fs = require('node:fs');
const root = 'C:/Users/<user>/workspace/<repo>/WArmy/';

// Fix TS
const p = root + 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const before = s;
s = s.split('settingsStore.load() as Record<string, unknown>').join('settingsStore.load() as unknown as Record<string, unknown>');
if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('TS fixed');
} else {
  console.log('TS already ok or pattern not found');
}

// Ensure i18n keys
const zhP = root + 'packages/app-shell/src/i18n/zh-CN.json';
const zh = JSON.parse(fs.readFileSync(zhP, 'utf8'));
if (!zh['settings.specialModels']) {
  zh['settings.specialModels'] = '特殊模型';
  zh['settings.importProviders'] = '导入供应商';
  zh['settings.importHint'] = '从 openclaw.json 一键导入已配置的模型供应商';
  zh['settings.importDo'] = '导入';
  zh['settings.specialModelsHint'] = 'ASR / 向量 / 摘要 / 整理 等系统模型，可单独配置';
  zh['settings.asrModel'] = '语音识别模型';
  zh['settings.summaryModel'] = '摘要模型';
  zh['settings.organizerModel'] = '整理模型';
  fs.writeFileSync(zhP, JSON.stringify(zh, null, 2) + '\n');
  console.log('i18n added');
}
const enP = root + 'packages/app-shell/src/i18n/en-US.json';
const en = JSON.parse(fs.readFileSync(enP, 'utf8'));
if (!en['settings.specialModels']) {
  en['settings.specialModels'] = 'Special models';
  en['settings.importProviders'] = 'Import providers';
  en['settings.importHint'] = 'Import model providers from openclaw.json';
  en['settings.importDo'] = 'Import';
  en['settings.specialModelsHint'] = 'ASR / embedding / summary / organizer models';
  en['settings.asrModel'] = 'ASR model';
  en['settings.summaryModel'] = 'Summary model';
  en['settings.organizerModel'] = 'Organizer model';
  fs.writeFileSync(enP, JSON.stringify(en, null, 2) + '\n');
}
console.log('i18n zh keys:', Object.keys(zh).length);
