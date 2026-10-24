/**
 * verify-r63-main-ui.mjs（fast 档）—— 第 63 轮主界面/主进程改动的可核对锚点。
 *
 * 判据分四组：
 *  ① 吸附开关真的落盘、默认开；nm 打开偏好默认关；
 *  ② 标题栏图标统一为 currentColor SVG，主题色/字体色变量真的接上；
 *  ③ 破坏性覆盖卡、慢任务硬顶重置、本机语音禁用时走听话链，源码路径存在；
 *  ④ nm 主窗口吸附提供者已接线；三种新 i18n 键在 10 个语言包齐全。
 *
 * 这是 fast 档的**静态/纯函数**门禁；真机行为由 verify-r62-ui / round38 / live 覆盖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const U = (p) => pathToFileURL(path.join(ROOT, p)).href;
const MAIN = rd('packages/app-shell/src/electron-main.ts');
const APP = rd('packages/app-shell/src/renderer/app.js');
const HTML = rd('packages/app-shell/src/renderer/index.html');
const CSS1 = rd('packages/app-shell/src/renderer/app.css');
const CSS2 = rd('packages/app-shell/src/renderer/renderer.css');
const NMW = rd('packages/app-shell/src/nm-viewer-win.ts');
const STORE = rd('packages/app-shell/src/settings-store.ts');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 180) : '')); } };

// ① 设置字段与默认值
jian('主界面吸附有持久化字段且默认开', /zhuXiFuKai\?: boolean/.test(STORE) && /zhuXiFuKai: true/.test(STORE));
jian('nm 左键打开偏好有持久化字段且默认关', /nmKaiWenJian\?: boolean/.test(STORE) && /nmKaiWenJian: false/.test(STORE));
{
  const { PeizhiCang } = await import(U('packages/app-shell/dist/settings-store.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r63-store-'));
  try {
    const c = new PeizhiCang(path.join(dir, 'settings.json'));
    const d = c.load();
    jian('出厂默认：吸附开、nm 左键关', d.zhuXiFuKai === true && d.nmKaiWenJian === false, JSON.stringify({ a: d.zhuXiFuKai, b: d.nmKaiWenJian }));
    c.save({ zhuXiFuKai: false, nmKaiWenJian: true });
    const d2 = c.load();
    jian('保存后能读回（吸附关、nm 左键开）', d2.zhuXiFuKai === false && d2.nmKaiWenJian === true, JSON.stringify({ a: d2.zhuXiFuKai, b: d2.nmKaiWenJian }));
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }
}
jian('主进程 IPC 真的把吸附写进设置', /settingsStore\?\.save\(\{ zhuXiFuKai: kai \}/.test(MAIN));

// ② 图标与主题
jian('吸附/置顶都用 currentColor 的内联 SVG（不再用固定黑色 img）',
  /id="anNiuZhuXiFu"[\s\S]{0,400}class="biaoTiLansvg"[\s\S]{0,400}currentColor|id="anNiuZhuXiFu"[\s\S]{0,500}<path/.test(HTML)
  && !/id="anNiuZhuXiFu"[\s\S]{0,300}ruo-ci-tie\.svg/.test(HTML));
jian('主界面置顶图标与 nm 同一形状（path M9 4h6…）', /M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6Z/.test(HTML));
jian('两份 CSS 都把用户气泡底色接到主题色', /--me-bubble:\s*var\(--accent\)/.test(CSS1) && /--me-bubble:\s*var\(--accent\)/.test(CSS2));
jian('左栏图标跟随文字颜色、选中态用对比色', /--rail-fg:\s*var\(--ink-dim\)/.test(CSS1) && /--rail-active-fg:\s*var\(--accent-ink/.test(CSS1) && /--rail-fg:\s*var\(--ink-dim\)/.test(CSS2));
jian('「执行中」标题条铺满整行（不再只包住短标题）',
  /\.siKaoKuai > summary[^{]*\{[\s\S]{0,160}width: 100%/.test(CSS1) && /\.siKaoKuai > summary[^{]*\{[\s\S]{0,160}width: 100%/.test(CSS2));
jian('设置加载/变化时都会同步 --me-bubble', (APP.match(/setProperty\('--me-bubble'/g) || []).length >= 4);

// ③ 覆盖卡 / 慢任务 / ASR
jian('破坏性覆盖有确认卡 + 推荐项 + 2 分钟超时', /chat\.write-overwrite-card/.test(MAIN) && /writeOverwriteYes/.test(MAIN) && /120_000/.test(MAIN) && /tuiJian:/.test(MAIN));
jian('慢任务有净进展时重置硬顶（不因慢而误杀）', /chat\.tools\.hard-cap-reset/.test(MAIN) && /let xunShouKaiShi = Date\.now\(\)/.test(MAIN));
jian('本机语音未启用时不再被 asrLocalOnly 拦住（走听话链）', /benDiKai/.test(MAIN) && /jinBenDi && benDiKai/.test(MAIN));
jian('操作记录显示动作 + 展开显示绝对路径', /写入文件/.test(APP) && /xingDongDetail = buZhouLuJing\(baseA, pA\)\.abs/.test(MAIN));

// ④ nm 主窗吸附与 i18n
jian('nm 主窗吸附提供者已接线', /nmSheZhiZhuChuangKuang/.test(NMW) && /nmSheZhiZhuChuangKuang\(\(\) =>/.test(MAIN) && /NM_ZHU_CHUANG_ID/.test(NMW));
{
  const langs = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
  const keys = ['llm.writeOverwriteTitle', 'llm.writeOverwriteBody', 'llm.writeOverwriteYes', 'llm.writeOverwriteAppend', 'llm.writeOverwriteNo', 'settings.nmOpenTitle', 'settings.nmOpenEnable', 'settings.nmOpenHint', 'settings.nmOpenReady', 'settings.nmOpenUnavailable', 'settings.nmOpenOn', 'settings.nmOpenOff', 'ctx.viewProfile', 'ctx.note', 'ctx.notePrompt'];
  const que = [];
  for (const l of langs) {
    const j = JSON.parse(rd(`packages/app-shell/src/i18n/${l}.json`));
    for (const k of keys) if (!String(j[k] || '').trim()) que.push(l + ':' + k);
  }
  jian('覆盖卡/nm打开/联系人菜单新键在 10 个语言包齐全', que.length === 0, que.slice(0, 8).join(', '));
}

console.log(`==== verify-r63-main-ui: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
