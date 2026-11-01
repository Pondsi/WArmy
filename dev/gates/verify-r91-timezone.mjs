/**
 * 第 91 轮：时间口径门禁。
 *
 * 不变量（用户定稿）：
 *  1. 记录只存时间戳（epoch ms）；给模型/日志只给 epoch / ISO 8601；
 *  2. 界面时间按“设置里选定的 IANA 时区”换算，默认系统时区；
 *  3. 登录后若系统时区与已存时区不同，5 秒后二选一：保持 / 更换；
 *     “保持”要记住，同一个系统时区不再重复问；
 *  4. 10 种语言都有对应文案。
 *
 * 这里跑真值表 + 静态判据，不启动 Electron；真机 UI 由 round 验收另行覆盖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const DIST = path.join(ROOT, 'packages/app-shell/dist');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const jian = (m, cond, detail) => (cond ? ok : bad)(m + (cond || !detail ? '' : ' :: ' + JSON.stringify(detail)));
const rd = (p) => fs.readFileSync(p, 'utf8');

console.log('\n[1] 渲染层时区工具真值表（time-tz.js）');
const timeTzSrc = rd(path.join(SRC, 'renderer/time-tz.js'));
const ctx = { window: {}, Intl, Date, console };
vm.createContext(ctx);
vm.runInContext(timeTzSrc, ctx);
const T = ctx.window.__warmyTime;
jian('模块导出完整', !!T && ['setTimezone', 'decide', 'parts', 'loc', 'locTime', 'zones'].every((k) => typeof T[k] === 'function'));
jian('默认时区 = 系统时区', T.getTimezone() === T.systemTimezone(), { cur: T.getTimezone(), sys: T.systemTimezone() });

const T0 = Date.UTC(2026, 9, 26, 0, 30, 0);
const expect = {
  UTC: '2026-10-26 00:30:00',
  'Asia/Shanghai': '2026-10-26 08:30:00',
  'America/New_York': '2026-10-25 20:30:00',
  'Asia/Tokyo': '2026-10-26 09:30:00',
};
for (const [tz, want] of Object.entries(expect)) {
  T.setTimezone(tz);
  jian(`${tz} 完整时间`, T.full(T0) === want, { got: T.full(T0), want });
  jian(`${tz} 时分`, T.hm(T0) === want.slice(11, 16), { got: T.hm(T0) });
}
T.setTimezone('Asia/Shanghai');
jian('跨日判断（上海 23:59 vs 次日 00:00）', T.sameDay(T0, Date.UTC(2026, 9, 26, 15, 59)) === true && T.sameDay(T0, Date.UTC(2026, 9, 26, 16, 0)) === false);
jian('跨小时判断', T.crossPoint(T0, T0 + 3600000) === true && T.crossPoint(T0, T0 + 60000) === false);
jian('月份日期文案', T.monthDayHm(T0) === '10月26日 08:30', { got: T.monthDayHm(T0) });
jian('偏移标签东八区', T.offsetLabel('Asia/Shanghai') === 'UTC+08:00', { got: T.offsetLabel('Asia/Shanghai') });
const zs = T.zones();
jian('时区列表有内容且含 UTC / Asia/Shanghai', zs.length > 100 && zs.some((z) => z.tz === 'UTC') && zs.some((z) => z.tz === 'Asia/Shanghai'), { n: zs.length });
jian('时区列表按偏移排序', zs.every((z, i) => i === 0 || zs[i - 1].offset <= z.offset));
T.setTimezone('Bad/Zone');
jian('非法时区回退系统时区', T.getTimezone() === T.systemTimezone());
T.setTimezone('Asia/Shanghai');

console.log('\n[2] 启动决策真值表（init / prompt / none）');
jian('没存过 ⇒ 初始化系统时区', JSON.stringify(T.decide('', 'Asia/Shanghai', '')) === JSON.stringify({ action: 'init', timezone: 'Asia/Shanghai', system: 'Asia/Shanghai' }));
jian('存过且不同 ⇒ 提醒', (() => { const d = T.decide('Asia/Tokyo', 'Asia/Shanghai', ''); return d.action === 'prompt' && d.timezone === 'Asia/Tokyo' && d.system === 'Asia/Shanghai'; })());
jian('存过且相同 ⇒ 不动', T.decide('Asia/Shanghai', 'Asia/Shanghai', '').action === 'none');
jian('已对该系统时区选过保持 ⇒ 不再提醒', (() => { const d = T.decide('Asia/Tokyo', 'Asia/Shanghai', 'Asia/Shanghai'); return d.action === 'none' && d.kept === true; })());
jian('系统时区又换了一个 ⇒ 重新提醒', T.decide('Asia/Tokyo', 'Europe/Paris', 'Asia/Shanghai').action === 'prompt');
jian('非法已存值 ⇒ 初始化', T.decide('Bad/Zone', 'Asia/Shanghai', '').action === 'init');

console.log('\n[3] 主进程时间工具（dist/time-utils.js）');
const U = await import(pathToFileURL(path.join(DIST, 'time-utils.js')).href);
jian('SH ISO 带 +08:00', U.isoZaiShiQu(T0, 'Asia/Shanghai') === '2026-10-26T08:30:00+08:00', { got: U.isoZaiShiQu(T0, 'Asia/Shanghai') });
jian('NY ISO 带 -04:00（夏令时）', U.isoZaiShiQu(T0, 'America/New_York') === '2026-10-25T20:30:00-04:00', { got: U.isoZaiShiQu(T0, 'America/New_York') });
jian('偏移分钟东八区 = 480', U.shiQuPianYiFen('Asia/Shanghai', T0) === 480, { got: U.shiQuPianYiFen('Asia/Shanghai', T0) });
jian('时间戳文案 = epoch + UTC ISO', U.shiJianChuoWen(T0) === '1792974600000 (2026-10-26T00:30:00.000Z)', { got: U.shiJianChuoWen(T0) });
jian('非法时区回退系统时区', U.guiYiShiQu('Bad/Zone') === U.xiTongShiQu());
jian('shiQuHeFa 认得 IANA、拒绝垃圾', U.shiQuHeFa('Asia/Tokyo') === true && U.shiQuHeFa('Bad/Zone') === false);

console.log('\n[4] 设置持久化（PeizhiCang）');
const SS = await import(pathToFileURL(path.join(DIST, 'settings-store.js')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r91-'));
try {
  const file = path.join(tmp, 'settings.json');
  const store = new SS.PeizhiCang(file);
  const d0 = store.load();
  jian('默认 timezone 为空（未落盘哨兵）', d0.timezone === '', { got: d0.timezone });
  jian('默认 timezoneKeepFor 为空', d0.timezoneKeepFor === '', { got: d0.timezoneKeepFor });
  store.save({ timezone: 'Asia/Tokyo', timezoneKeepFor: 'Asia/Shanghai' });
  const j1 = JSON.parse(fs.readFileSync(file, 'utf8'));
  jian('timezone 落到 settings.json', j1.timezone === 'Asia/Tokyo' && j1.timezoneKeepFor === 'Asia/Shanghai', j1);
  jian('重新 load 读回来', store.load().timezone === 'Asia/Tokyo');
  store.reset();
  jian('恢复出厂后 timezone 回到空哨兵', store.load().timezone === '' && store.load().timezoneKeepFor === '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n[5] 10 种语言文案');
const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
const KEYS = ['settings.timezone', 'settings.timezoneHint', 'settings.timezoneSystem', 'settings.timezoneChangedTitle', 'settings.timezoneChangedBody', 'settings.timezoneKeep', 'settings.timezoneSwitch', 'settings.timezoneSaved'];
for (const lang of LANGS) {
  const j = JSON.parse(rd(path.join(SRC, 'i18n', lang + '.json')));
  const miss = KEYS.filter((k) => typeof j[k] !== 'string' || !j[k].trim());
  jian(`${lang} 8 个时区文案齐全`, miss.length === 0, { miss });
  jian(`${lang} 提醒文案含 {prev}/{sys}`, /{prev}/.test(j['settings.timezoneChangedBody']) && /{sys}/.test(j['settings.timezoneChangedBody']));
  jian(`${lang} 系统时区标签含 {tz}`, /{tz}/.test(j['settings.timezoneSystem']));
}

console.log('\n[6] 静态判据：入口、5 秒提醒、无裸本地时间');
const appJs = rd(path.join(SRC, 'renderer/app.js'));
const indexHtml = rd(path.join(SRC, 'renderer/index.html'));
const nmHtml = rd(path.join(SRC, 'renderer/nm-viewer.html'));
const nmJs = rd(path.join(SRC, 'renderer/nm-viewer.js'));
const mainTs = rd(path.join(SRC, 'electron-main.ts'));

jian('index.html 在 app.js 之前加载 time-tz.js', indexHtml.indexOf('./time-tz.js') > 0 && indexHtml.indexOf('./time-tz.js') < indexHtml.indexOf('./app.js'));
jian('nm 查看器也加载 time-tz.js', nmHtml.includes('./time-tz.js'));
jian('app.js 用统一入口 TZ', /const TZ = window\.__warmyTime/.test(appJs));
jian('设置页有 timezone 下拉与选项生成', appJs.includes('id="xuanZeShiQu"') && /function timezoneOptionsHtml/.test(appJs));
jian('选择变更落盘并清掉“保持”记录', /settingsSave\(\{ timezone: pick, timezoneKeepFor: '' \}\)/.test(appJs));
jian('登录后应用时区设置', /yingYongShiQuSheZhi\(s\.settings\)/.test(appJs));
jian('提醒挂 5 秒定时器', /anPaiShiQuTiXing[\s\S]{0,400}setTimeout\([\s\S]{0,200}5000\)/.test(appJs));
jian('提醒是二选一（保持 / 更换）', /uiChooseTwo\(/.test(appJs) && appJs.includes("settings.timezoneKeep") && appJs.includes("settings.timezoneSwitch"));
jian('保持会把系统时区记下来', /timezoneKeepFor: sys/.test(appJs));
jian('每次启动只提醒一次', /shiQuTiXingGuo/.test(appJs) && /if \(state\.shiQuTiXingGuo\) return;/.test(appJs));
jian('独立会话窗不弹提醒', /if \(state\.subWindowPinnedId\) return;/.test(appJs));

jian('app.js 没有裸的本地化日期显示', !/\.toLocaleTimeString\(|\.toLocaleDateString\(/.test(appJs) && !/new Date\([^\n]*\)\.toLocaleString\(/.test(appJs));
jian('nm-viewer.js 没有裸的本地化时间', !/\.toLocaleTimeString\(|\.toLocaleDateString\(|new Date\([^\n]*\)\.toLocaleString\(/.test(nmJs));
const TS_FILES = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && e.name !== 'time-utils.ts') TS_FILES.push(p);
  }
};
walk(SRC);
const bareTs = TS_FILES.filter((p) => /toLocaleString|toLocaleTimeString|toLocaleDateString/.test(rd(p)));
jian('主进程 TS 不再用本地化时间字符串（time-utils 除外）', bareTs.length === 0, bareTs.map((p) => path.relative(ROOT, p)));

jian('模型当前时间行只给 epoch + UTC ISO', /epochMs=' \+ xz\.getTime\(\)/.test(mainTs) && /UTC=' \+ xz\.toISOString\(\)/.test(mainTs) && !/当前时间[^\n]*toLocaleString/.test(mainTs));
jian('get_time 输出 epoch/ISO/timezoneIso', mainTs.includes('epochMs: benDiMs') && mainTs.includes('isoUtc:') && mainTs.includes('timezoneIso:') && !mainTs.includes('localText:'));
jian('helper 备份 createdAt 改时间戳', /createdAt: Date\.now\(\)/.test(rd(path.join(SRC, 'helper-tool.ts'))));
jian('checkpoint 摘要使用 ISO 时间戳', /new Date\(now\)\.toISOString\(\)/.test(rd(path.join(SRC, 'checkpoint.ts'))));

console.log(`\nverify-r91-timezone: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
