/**
 * verify-r57-ruo-yizhi.mjs（fast 档）—— 第 57 轮："做弱一致"的可执行判据。
 *
 * 弱一致不是"随便乱序"，而是：**任何到达顺序，所有节点用同一个确定性排序函数都得到同一结果**；
 * 缺口能被算出来补拉；重复消息按 id 去重；创建者离线时的本地队列不会丢、也不会提前冒充"已确认"。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const X = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/qun-xiao-xi-rixi.js')).href);
let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 140) : '')); } };
const C = 'creator';
const m = (id, author, seq, createdAt, deps) => ({ id, author, seq, createdAt, deps });
const A = [m('c1', C, 1, 10), m('c2', C, 2, 20)];
const B = [m('a1', 'alice', 1, 15, { [C]: 1 }), m('b1', 'bob', 1, 16, { [C]: 1, alice: 1 })];

const luan = [...B, ...A].reverse();
const p1 = X.paiXuRiZhi(A.concat(B), C);
const p2 = X.paiXuRiZhi(luan, C);
jian('排序与到达顺序无关（同一集合 → 同一结果）', JSON.stringify(p1) === JSON.stringify(p2));
jian('创建者的消息排在最前，且按自己的 seq', p1[0].id === 'c1' && p1[1].id === 'c2');
jian('其它成员按因果层级/时间稳定展开（alice 先于 bob）', p1[2].id === 'a1' && p1[3].id === 'b1', p1.map((x) => x.id).join(','));

const he = X.heBingRiZhi({ queRen: A, daiPaiXu: [] }, { queRen: [...A, ...B], daiPaiXu: [] });
jian('合并日志按 id 去重（重复消息不占两次）', he.queRen.length === 4 && new Set(he.queRen.map((x) => x.id)).size === 4);
jian('同一作者同一 seq 先到者胜（后到的同 seq 不覆盖内容）',
  X.heBingRiZhi({ queRen: [{ ...m('x1', 'a', 1, 1), payloadHash: 'sha-old' }], daiPaiXu: [] },
    { queRen: [{ ...m('x1', 'a', 1, 1), payloadHash: 'sha-new' }], daiPaiXu: [] }).queRen[0].payloadHash === 'sha-old');

const gap = X.queKou([m('a1', 'alice', 1, 1), m('a3', 'alice', 3, 3), m('a5', 'alice', 5, 5)]);
jian('补拉清单能算出缺口段（1,3,5 → 2-2 与 4-4）',
  gap.length === 2 && gap[0].from === 2 && gap[0].to === 2 && gap[1].from === 4 && gap[1].to === 4, JSON.stringify(gap));
jian('连续水位在遇到缺口时停下（不是取最大值）',
  X.lianXuShuiWei([m('a1', 'alice', 1, 1), m('a3', 'alice', 3, 3)])['alice'] === 1);

let ri = { queRen: A, daiPaiXu: [] };
ri = X.duiLieDaiPaiXu(ri, m('a1', 'alice', 1, 15));
ri = X.duiLieDaiPaiXu(ri, m('a1', 'alice', 1, 15));
jian('创建者离线：本地消息进待排序队列，重复 id 不重复入队', ri.daiPaiXu.length === 1);
jian('待排序的消息**不算已确认**（不许提前冒充送达）', X.xiaoXiZhuangTai(ri, 'a1') === 'daiPaiXu');
const shang = X.chuangJianZheShangXian(ri);
jian('创建者上线：待排序并入已确认，队列清空', shang.daiPaiXu.length === 0 && shang.queRen.some((x) => x.id === 'a1'));

const cuo = X.shiJianCuoWei(m('a0', 'alice', 0, 5), 100, 200);
jian('创建时间早于已显示的最后一条 ⇒ 标记错位', cuo.cuoWei === true);
jian('创建到接收超过 10 分钟 ⇒ 也标记错位（接收晚）',
  X.shiJianCuoWei(m('a9', 'alice', 9, 1_000_000), 0, 1_000_000 + 11 * 60 * 1000).cuoWei === true);
jian('正常先后顺序不误报', X.shiJianCuoWei(m('a9', 'alice', 9, 1_000_000), 999_000, 1_000_100).cuoWei === false);

// ── 产品层发送策略（第 58 轮放宽创建者离线只读）─────────────────
jian('创建者在线/本人 ⇒ 直接发', X.qunFaSongCeLue({ shiChuangJianZhe: true, chuangJianZheZaiXian: false }) === 'send'
  && X.qunFaSongCeLue({ shiChuangJianZhe: false, chuangJianZheZaiXian: true }) === 'send');
jian('创建者离线 ⇒ 一律只读（群/项目不排队；第 60 轮用户定稿）',
  X.QUN_RUO_YI_ZHI_MO_REN === false && X.qunFaSongCeLue({ shiChuangJianZhe: false, chuangJianZheZaiXian: false }) === 'readonly');
jian('即使显式传 ruoYiZhi=true 也不再排队（参数只为兼容旧调用）',
  X.qunFaSongCeLue({ shiChuangJianZhe: false, chuangJianZheZaiXian: false, ruoYiZhi: true }) === 'readonly');

console.log(`==== verify-r57-ruo-yizhi: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
