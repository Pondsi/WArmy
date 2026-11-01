// 第 42 轮验收：一条命令跑完本轮所有新增断言 + 核心门禁。
// 用法：node scripts/verify-r42.mjs   （退出码 0 = 全绿）
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';

const root = process.cwd();
const dist = path.join(root, 'packages', 'app-shell', 'dist');
const imp = (f) => import(pathToFileURL(path.join(dist, f)).href);
let ok = 0;
const fail = [];
const check = (name, fn) => { try { fn(); ok += 1; console.log('  ok  ' + name); } catch (e) { fail.push(name + ' :: ' + (e && e.message)); console.log('  FAIL ' + name + ' :: ' + (e && e.message)); } };

// ── 1. 本轮新增模块的单元断言 ───────────────────────────────────────────
const { YING_MEN_JIN, jianChaRuanMenJin, panDuanRuanGai, yingMenJinTiShi } = await imp('gate-policy.js');
check('硬门禁共 4 条且 D 存在', () => { assert.equal(YING_MEN_JIN.length, 4); assert.equal(YING_MEN_JIN[3].id, 'D'); });
check('每条硬门禁都有最坏情况', () => { assert.ok(YING_MEN_JIN.every((g) => g.zuiHuai.length > 10)); });
check('正向表述不误判冲突', () => assert.equal(jianChaRuanMenJin('可复用能力不得只留在聊天里，必须落成 skill').chongTu, false));
check('冲突被识别（B/D）', () => { assert.ok(jianChaRuanMenJin('软门禁可以不建计划任务，直接动手').mingZhong.includes('B')); assert.ok(jianChaRuanMenJin('硬门禁可以被软门禁覆盖').mingZhong.includes('D')); });
check('冲突优先且免三论证', () => { const r = panDuanRuanGai({ neiRong: '硬门禁可以被覆盖', yongHuMingQue: false, lunZheng: [], qiTaFangAn: [] }); assert.equal(r.yunXu, true); assert.equal(r.luJing, 'conflict-hard-wins'); });
check('论证不足被拒', () => { const r = panDuanRuanGai({ neiRong: '日志检查改宽松', yongHuMingQue: false, lunZheng: ['a', 'a', 'b'], qiTaFangAn: [] }); assert.equal(r.yunXu, false); });
check('替代方案≥50% 被拒', () => { const r = panDuanRuanGai({ neiRong: '日志检查改宽松', yongHuMingQue: false, lunZheng: ['a', 'b', 'c'], qiTaFangAn: [{ fangAn: 'x', zhiXinDu: 0.6 }] }); assert.equal(r.yunXu, false); });
check('三条论证+无替代 ⇒ 放行并带告知', () => { const r = panDuanRuanGai({ neiRong: '日志检查改宽松', yongHuMingQue: false, lunZheng: ['a', 'b', 'c'], qiTaFangAn: [] }); assert.equal(r.luJing, 'three-proofs'); assert.ok(r.gaoZhi.includes('风险')); });
check('提示词含"最坏情况"', () => assert.ok(yingMenJinTiShi().includes('最坏情况')));

const { TrashStore, jieZhiZhaiYao, TRASH_TTL_MS } = await imp('trash-store.js');
const tf = path.join(process.env.TEMP || '.', 'r42-trash.json');
try { fs.unlinkSync(tf); } catch { /* fresh */ }
check('回收站：摘要截断到 140', () => { const s = new TrashStore(tf); const e = s.add({ id: 'a', kind: 'agent', name: 'A', preview: 'x'.repeat(400) }); assert.equal(Array.from(e.preview).length, 140); assert.ok(e.preview.endsWith('…')); });
check('回收站：48h 过期自动清理', () => { const s = new TrashStore(tf); s.add({ id: 'old', kind: 'group', name: 'O', deletedAt: Date.now() - TRASH_TTL_MS - 1000 }); assert.equal(s.list().some((x) => x.id === 'old'), false); });
check('回收站：移除生效', () => { const s = new TrashStore(tf); assert.equal(s.remove('a', 'agent'), true); assert.equal(s.list().length, 0); });
check('摘要工具函数', () => assert.equal(jieZhiZhaiYao('abcdefghij', 5), 'abcd…'));
try { fs.unlinkSync(tf); } catch { /* noop */ }

const { jieXiCron, xiaCiCron, qiangShangShiJian } = await imp('cron-lite.js');
check('cron：合法/非法解析', () => { assert.ok(jieXiCron('*/15 * * * *')); assert.equal(jieXiCron('bad'), null); });
check('cron：工作日 09:07（Asia/Shanghai）', () => {
  const base = Date.UTC(2026, 9, 19, 1, 0, 0);
  const q = qiangShangShiJian(xiaCiCron('7 9 * * 1-5', 'Asia/Shanghai', base), 'Asia/Shanghai');
  assert.equal(q.hh, 9); assert.equal(q.mm, 7);
});
check('cron：UTC 每日 0 点', () => assert.equal(new Date(xiaCiCron('0 0 * * *', 'UTC', Date.UTC(2026, 0, 1, 12))).toISOString(), '2026-01-02T00:00:00.000Z'));
check('cron：永不匹配返回 0', () => assert.equal(xiaCiCron('0 0 31 2 *', 'UTC', Date.UTC(2026, 0, 1)), 0));

// ── 2. 本轮改动的静态锚点（防止被回退） ─────────────────────────────────
const main = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'electron-main.ts'), 'utf8');
const appjs = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'renderer', 'app.js'), 'utf8');
const pre = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'preload.cjs'), 'utf8');
check('主进程：软门禁保存过裁决', () => assert.ok(main.includes('soft-gate-denied') && main.includes('menJinTongZhi')));
check('主进程：定时任务真跑且写回聊天', () => assert.ok(main.includes('paoDingShiRenWu') && main.includes('定时任务汇报')));
check('主进程：会话删除级联删定时任务', () => assert.ok(main.includes('dingShi.cascade-delete')));
check('主进程：Cron 已接进 suanXiaCi', () => assert.ok(main.includes('xiaCiCron(cron')));
check('主进程：内置插件默认关闭播种', () => assert.ok(main.includes('boZhongNeiZhiChaJian') && main.includes('enabled: false')));
/**
 * 原来这里写死 `CAPS_VERSION = 3` ⇒ 是个**字节锚**：第 44 轮为了刷掉"上一版探测失败留下的 contextLen=0"
 * 把版本升到 4，这条就红了，红的还不是缺陷而是"我改了缓存版本号"。
 * 真正的不变量是两条：**读取侧与写入侧必须同版本**（不同版本 = 旧缓存永远刷不掉或每次都刷），
 * 以及**版本 ≥3**（3 才开始带 tools/vision 全量落盘）。按不变量判，版本号本身可以长。
 */
check('主进程：能力缓存版本读写两侧一致且不低于 3（不锚死具体数字）', () => {
  const du = [...main.matchAll(/CAPS_VERSION\s*=\s*(\d+)|modelCapsVersion:\s*(\d+)/g)].map((m) => Number(m[1] || m[2]));
  assert.ok(du.length >= 2, '只找到一处版本号：' + JSON.stringify(du));
  assert.ok(new Set(du).size === 1, '读写两侧版本不一致：' + JSON.stringify(du));
  assert.ok(du[0] >= 3, '版本低于 3（旧缓存不再被采信的口径丢了）：' + du[0]);
});
check('渲染层：思考段在流式里会封口', () => assert.ok(appjs.includes('data-feng') && appjs.includes('siKaoDuanKuai')));
/**
 * 心跳**不进界面**（2026-10-19 用户当面定稿原话："设置的各个页面怎么有心跳？心跳没有什么需要设置的，
 * 无需显示在界面上，删除掉。"）。这一条以前按第 40 轮那句"只在日志里的心跳等于没有心跳"判成**正向存在**，
 * 口径反转 ⇒ 按最新那句判：界面里不许有心跳的痕迹。**引擎照旧跑**（它是全应用唯一计时源），
 * 状态从审计/日志看：`xin-tiao.ok` / `xin-tiao.wait-fire` / `xin-tiao.*-skipped` / `heartbeat.*`。
 * ⚠️ 撤界面时查出来的真根因另立一条不变量（见下一条）：那次"每个设置页都显示心跳"**不是心跳的错**，
 *   是分区注册表漏了一格 —— 带 `data-sec` 的分区如果在 `groups` 里没有对应的桶，
 *   `showSec()` 就永远不会隐藏它 ⇒ 它挂在所有页面上。以后新加设置分区别再踩。
 */
check('渲染层：心跳没有界面（用户 2026-10-19 定稿；引擎照跑，状态看审计与日志）', () => {
  ['data-sec="xintiao"', "'xintiao'", 'xinTiaoBiao', 'renderXinTiao', 'xinTiaoWakeKai', 'xinTiaoZongLan']
    .forEach((c) => assert.ok(!appjs.includes(c), '渲染层还留着心跳界面的痕迹：' + c));
});
check('渲染层：每个 secIds 分区都要在 groups 里有桶（漏一个 ⇒ 该分区在每个设置页都露出来）', () => {
  const secIds = (appjs.match(/const secIds = \[([^\]]*)\]/) || [])[1] || '';
  const ming = secIds.split(',').map((x) => String(x).trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(ming.length >= 8, '没抓到 secIds（判据要失效了）：' + ming.length);
  const g = appjs.match(/const groups = \{([^}]*)\}/);
  assert.ok(!!g, '找不到 groups 桶定义 ⇒ 没人管分区可见性');
  const tong = new Set([...((g[1].match(/(\w+)\s*:/g) || []).map((x) => x.replace(/\s*:/, ''))),
    ...([...appjs.matchAll(/groups\[\s*['"]([\w]+)['"]\s*\]/g)].map((m) => m[1]))]);
  const que = ming.filter((k) => !tong.has(k));
  assert.ok(que.length === 0, '这些分区键没有对应的桶，切走时不会被隐藏：' + que.join('、'));
});
check('渲染层：回收站区块存在', () => assert.ok(appjs.includes('laJiQu') && appjs.includes('renderLaJi')));
check('渲染层：分类标签不再用「决策」', () => { const zh = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'i18n', 'zh-CN.json'), 'utf8'); assert.ok(zh.includes('"model.chip.decision": "分类"')); });
check('preload：新通道齐备', () => ['laJiLieBiao', 'laJiHuiFu', 'laJiYongJiuShanChu', 'laJiJiLu', 'menJinYingQingDan', 'menJinRuanJianCha', 'menJinRuanShenQing', 'onDingShiHuiBao'].forEach((k) => assert.ok(pre.includes(k), k)));
check('头像：4 色以内（无第 5 个 hex）', () => {
  const svg = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'renderer', 'icons', 'avatars', 'user-default.svg'), 'utf8');
  const colors = new Set((svg.match(/#[0-9A-Fa-f]{6}/g) || []).map((c) => c.toUpperCase()));
  assert.ok(colors.size <= 4, [...colors].join(','));
});
check('MCP 桥接插件文件在包内', () => {
  const dir = path.join(root, 'packages', 'app-shell', 'plugins', 'mcp-bridge');
  assert.ok(fs.existsSync(path.join(dir, 'bridge.mjs')) && fs.existsSync(path.join(dir, 'plugin.json')));
});

// ── 3. 项目自带核心门禁 ─────────────────────────────────────────────────
const gates = ['verify-css-consistency', 'verify-i18n-locales', 'verify-no-empty-catch', 'verify-import-integrity', 'verify-wiring', 'verify-renderer-scope'];
for (const g of gates) {
  check('门禁 ' + g, () => execFileSync(process.execPath, [path.join(root, 'packages', 'app-shell', 'scripts', g + '.mjs')], { stdio: 'pipe' }));
}

console.log(`\n==== verify-r42: ${ok} ok / ${fail.length} FAIL ====`);
if (fail.length) { for (const f of fail) console.log('  ! ' + f); process.exit(1); }
