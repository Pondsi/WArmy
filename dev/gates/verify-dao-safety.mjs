/**
 * verify-dao-safety —— 第 51 轮：**「道」的第二支硬门禁**（防误改 / 防自动改 / 防压缩）
 *
 * 与 `verify-prompt-layers` 的分工：
 *  · prompt-layers 管「顺序 + 只有道不可压缩 + 门禁 E」；
 *  · 本支专管「道这份文件本身」：只能人手改、改前留备份、代码里没有自动写入口、界面不是"改了就存"。
 *
 * 用户口径：本项目永远不可自动或牛马更改「道」，必须人手动更改；「道」永远不可压缩。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const APP = path.join(ROOT, 'packages/app-shell/src/renderer/app.js');
const YS = path.join(ROOT, 'packages/app-shell/src/yuSuan-jiage.ts');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const em = fs.readFileSync(MAIN, 'utf8');
const ap = fs.readFileSync(APP, 'utf8');
const ys = fs.readFileSync(YS, 'utf8');

// 1. 唯一写入口 + 备份
const she = em.slice(em.indexOf("warmy:daoShe"), em.indexOf("warmy:daoShe") + 2200);
need(/chuliIpc\('warmy:daoShe'/.test(em), '道只有一个写入口 warmy:daoShe');
need(/dao\.md\.bak-/.test(she), '覆盖前先备份（dao.md.bak-<时间戳>）');
need(/while \(bak\.length > 5\)/.test(she), '备份只留最近 5 份（有界）');
need(/beiFen/.test(she) && /settings\.dao-md-saved/.test(she), '备份路径进审计（可追溯）');

// 2. 播种只在缺失时发生；没有任何其它自动写
const seed = em.slice(em.indexOf('function boZhongDaoMoRen'), em.indexOf('function boZhongDaoMoRen') + 700);
need(/if \(fs\.existsSync\(p\)\) return;/.test(seed), '只在 dao.md 不存在时播种');
const writesDao = [...em.matchAll(/writeFileSync\(daoLu\(\)/g)].length;
const writesSeed = [...em.matchAll(/writeFileSync\(p, (?:DAO_MOREN|mo\.dao)/g)].length;
/** 第三条写路径是"随语言切换重写**未改过**的出厂稿"：必须带 shiChuChangGao 判据（第 54 轮项 1） */
const xieYuYan = (() => {
  const i = em.indexOf('function moRenYuYanTongBu');
  const duan = i < 0 ? '' : em.slice(i, i + 1400);
  return /if \(!shiChuChangGao\(cur\)\)/.test(duan) && /fs\.writeFileSync\(p, x\.wen/.test(duan);
})();
need(writesDao === 1 && writesSeed === 1 && xieYuYan,
  `写 dao.md 的调用只有「播种 + 用户保存 + 受判据保护的语言切换」三处（实际 保存=${writesDao} 播种=${writesSeed} 语言切换=${xieYuYan}）`);

// 3. 界面不是"改了就存"：必须点确定
need(/'daoTi',\s*'anNiuDaoQueDing'/.test(ap), '道编辑器绑的是「确定」按钮');
need(!/\$\('daoTi'\)\.onchange\s*=/.test(ap), '道编辑器没有 onchange 自动保存');

// 4. 不可压缩名单 = 「道」+「产品门禁」（第 52 轮阶梯定稿），按实读的集合判，不钉写法
const buKeRaw = (ys.match(/export const BU_KE_YA_SUO = \[([^\]]*)\]/) || [])[1] || '';
const buKe = [...buKeRaw.matchAll(/'([^']+)'/g)].map((m) => m[1]);
need(buKe.length === 2 && buKe.includes('道') && buKe.includes('产品门禁'),
  `不可压缩名单恰好是「道」与「产品门禁」（实际读到的名单 ${JSON.stringify(buKe)}）`);

// 5. 教条/束缚默认折叠（第 51 轮）
need(/<details class="sheZhiKa"[^>]*id="zuiGaoXinNianKa"/.test(ap), '教条默认折叠（details，无 open）');
need(/<details class="sheZhiKa"[^>]*id="shuFuKa"/.test(ap), '束缚默认折叠（details，无 open）');
need(!/<details[^>]*id="zuiGaoXinNianKa"[^>]*open/.test(ap), '教条不是默认展开');

console.log(`\n==== verify-dao-safety: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
