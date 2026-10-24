/**
 * verify-r52-yasuo.mjs（fast 档）—— 第 52 轮项 4 的**分层压缩**判据。
 *
 * 用户口径：可压缩名单不变（只有 产品硬门禁 与 道 不可压），但压缩顺序按新优先级，
 * 且**不许一次压到极限**：第 1 层（印象/规范/工具/软门禁）→ 第 2 层（教条/束缚/认知/身份）
 * → 第 3 层（术）先各压到**半极限**，走完一轮再回头把第 1 层压到**真极限**，逐层递进
 * ⇒ 优先级越高，上下文不足时留下的越多。
 *
 * 判据是**跑真代码**（直接调 `yaSuo-fenCeng` 编译产物）而不是钉字节；只有接线部分用静态断言。
 * 用法：node packages/app-shell/scripts/verify-r52-yasuo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const F = await import(pathToFileURL(process.env.V52_FEN || path.join(ROOT, 'packages/app-shell/dist/yaSuo-fenCeng.js')).href);
const MAIN = fs.readFileSync(process.env.V52_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };

// ── 1. 归层真值表 ────────────────────────────────────────────────────
const CENG = [
  ['产品门禁 · 最高优先级（硬约束）', -1], ['道 · 最高优先级（除硬门禁）· 不可压缩', -1],
  ['术 · 方法论（仅次于硬门禁与「道」）', 3],
  ['规范 · 只作用于本会话（仅次于「术」）', 3], ['印象 · 对用户的长期理解', 1],
  ['工具 · 能力清单与落地规矩', 1], ['软门禁 · 宿主校验的指针', 1],
  ['教条 · 低于硬门禁、道、术、规范、印象、工具、软门禁', 2], ['束缚 · 补充约束（低于「教条」，只为移植兼容）', 2],
  ['认知 · 本牛马的性格与背景', 2], ['身份 · 模型 · 时间', 2],
  ['本轮工具面收窄', 0], ['上一轮任务黑板摘要 · 任务 7', 0], ['没登记过的新段（不许悄悄享有保留承诺）', 0],
];
for (const [b, yao] of CENG) jian('归层 ' + yao + '：' + b.slice(0, 18), F.cengOf(b) === yao, '实际=' + F.cengOf(b));
jian('第 53 轮口径：规范与术**同层**（都是最后一层，规范先压、术最后压）',
  F.cengOf('规范 · 只作用于本会话') === 3 && F.cengOf('术 · 方法论') === 3
  && F.cengNeiMing('规范 · 只作用于本会话', 3) < F.cengNeiMing('术 · 方法论', 3));
jian('未登记的段落到第 0 层（最先压）而不是最后一层：新增段没有"保留"承诺', F.cengOf('随便什么新段') === 0);

// ── 2. 强度与下限 ────────────────────────────────────────────────────
jian('半极限=留 72%、真极限=留 45%（两个强度，不许一步到极限）', F.YA_SUO_BAN === 0.72 && F.YA_SUO_ZHEN === 0.45);
jian('2000 字段：半极限留 1440、真极限留 900', F.muBiaoChangDu(2000, F.YA_SUO_BAN) === 1440 && F.muBiaoChangDu(2000, F.YA_SUO_ZHEN) === 900);
jian('短段（700 字）真极限只到 600 的下限，不许压成 315', F.muBiaoChangDu(700, F.YA_SUO_ZHEN) === 600);
jian('比下限还短的段（500 字）根本不压（保持原长）', F.muBiaoChangDu(500, F.YA_SUO_ZHEN) === 500);
jian('泵道 = 两遍强度 × 四层，共 8 轮', F.BENG_DAO.length === 8
  && F.BENG_DAO[0].ceng === 0 && F.BENG_DAO[0].qiangDu === F.YA_SUO_BAN
  && F.BENG_DAO[3].ceng === 3 && F.BENG_DAO[3].qiangDu === F.YA_SUO_BAN
  && F.BENG_DAO[4].ceng === 0 && F.BENG_DAO[4].qiangDu === F.YA_SUO_ZHEN
  && F.BENG_DAO[7].ceng === 3 && F.BENG_DAO[7].qiangDu === F.YA_SUO_ZHEN);

// ── 3. 一遍只动一层（分层递进的行为本体）────────────────────────────
{
  const duan = [
    { i: 0, biao: '道 · 不可压缩', yuanShi: 3000, dangQian: 3000 },
    { i: 1, biao: '术 · 方法论', yuanShi: 2000, dangQian: 2000 },
    { i: 2, biao: '规范 · 本会话', yuanShi: 2000, dangQian: 2000 },
    { i: 3, biao: '印象 · 长期理解', yuanShi: 2000, dangQian: 2000 },
    { i: 4, biao: '教条 · agents.md', yuanShi: 2000, dangQian: 2000 },
    { i: 5, biao: '认知 · 本牛马', yuanShi: 2000, dangQian: 2000 },
    { i: 6, biao: '本轮工具面收窄', yuanShi: 2000, dangQian: 2000 },
  ];
  const r0 = F.guiHuaYiLun(duan, { ceng: 0, qiangDu: F.YA_SUO_BAN }, 99999);
  jian('第 0 轮只动无名段（其余一层都不许提前动）', r0.bianGeng.length === 1 && r0.bianGeng[0].i === 6, JSON.stringify(r0.bianGeng));
  const r1 = F.guiHuaYiLun(duan, { ceng: 1, qiangDu: F.YA_SUO_BAN }, 99999);
  jian('第 1 层轮只动 印象（这一层里没有工具/软门禁段；规范已改与术同层）', r1.bianGeng.length === 1 && r1.bianGeng[0].i === 3, JSON.stringify(r1.bianGeng));
  jian('第 1 层轮压到半极限（2000→1440）而不是真极限', r1.bianGeng.every((b) => b.dao === 1440));
  const r3 = F.guiHuaYiLun(duan, { ceng: 3, qiangDu: F.YA_SUO_BAN }, 99999);
  jian('第 3 层最后一轮才动 规范 + 术（含术，第 53 轮起同层）',
    r3.bianGeng.length === 2 && r3.bianGeng.map((b) => b.i).join(',') === '2,1' && r3.bianGeng.every((b) => b.dao === 1440),
    JSON.stringify(r3.bianGeng));
  const dao = F.guiHuaYiLun(duan, { ceng: -1, qiangDu: F.YA_SUO_ZHEN }, 99999);
  jian('没有任何一轮的层号是 -1 ⇒「道/硬门禁」永远排不进队列（泵道里没有 -1 层）',
    F.BENG_DAO.every((l) => l.ceng !== -1) && dao.bianGeng.length === 0);
  const ling = F.guiHuaYiLun(duan, { ceng: 1, qiangDu: F.YA_SUO_BAN }, 0);
  jian('缺口=0 ⇒ 一段都不压（够用就不许动刀）', ling.bianGeng.length === 0 && ling.jianDi === 0);
  const r = F.guiHuaYiLun(duan, { ceng: 2, qiangDu: F.YA_SUO_BAN }, 300);
  jian('缺口小于一段的减量时**不越层**：本层攒够就停，下一层留给下一轮',
    r.bianGeng.every((b) => b.i === 4 || b.i === 5) && r.jianDi >= 300);
}

// ── 4. 层内也是"低优先级先压" ───────────────────────────────────────
{
  const duan = [
    { i: 0, biao: '印象 · 长期理解', yuanShi: 2000, dangQian: 2000 },
    { i: 1, biao: '工具 · 能力清单', yuanShi: 2000, dangQian: 2000 },
    { i: 2, biao: '软门禁 · 指针', yuanShi: 2000, dangQian: 2000 },
  ];
  const r = F.guiHuaYiLun(duan, { ceng: 1, qiangDu: F.YA_SUO_BAN }, 500);
  jian('第 1 层内先压软门禁（层内倒序：软门禁→工具→印象）', r.bianGeng.length === 1 && r.bianGeng[0].i === 2, JSON.stringify(r.bianGeng));
  const r2 = F.guiHuaYiLun(duan, { ceng: 1, qiangDu: F.YA_SUO_BAN }, 620);
  jian('一段不够（560<620）才轮到工具段（依然不碰印象）', r2.bianGeng.length === 2 && !r2.bianGeng.some((b) => b.i === 0), JSON.stringify(r2.bianGeng));
  jian('印象（第 1 层里优先级最高）最后才动', r2.bianGeng.map((b) => b.i).join(',') === '2,1');
  const duan3 = [
    { i: 0, biao: '术 · 方法论', yuanShi: 2000, dangQian: 2000 },
    { i: 1, biao: '规范 · 本会话', yuanShi: 2000, dangQian: 2000 },
  ];
  const r3 = F.guiHuaYiLun(duan3, { ceng: 3, qiangDu: F.YA_SUO_BAN }, 500);
  jian('同层的规范与术：先压规范，术最后（同层内也按优先级倒序）',
    r3.bianGeng.length === 1 && r3.bianGeng[0].i === 1, JSON.stringify(r3.bianGeng));
}

// ── 5. 整条泵道跑下来：优先级越高保留越多 ─────────────────────────
{
  const mk = () => [
    { i: 0, biao: '道 · 不可压缩', yuanShi: 3000, dangQian: 3000 },
    { i: 1, biao: '术 · 方法论', yuanShi: 2000, dangQian: 2000 },
    { i: 2, biao: '规范 · 本会话', yuanShi: 2000, dangQian: 2000 },
    { i: 3, biao: '印象 · 长期理解', yuanShi: 2000, dangQian: 2000 },
    { i: 4, biao: '本轮工具面收窄', yuanShi: 2000, dangQian: 2000 },
  ];
  const zh = mk();
  /** 每一段**第一次被动**是在第几轮：这是"优先级越高越晚被压"的可执行说法 */
  const diYiCiDong = {};
  F.BENG_DAO.forEach((lun, h) => {
    const ji = F.guiHuaYiLun(zh.map((d) => ({ ...d })), lun, 500);
    for (const b of ji.bianGeng) {
      if (diYiCiDong[b.i] === undefined) diYiCiDong[b.i] = h;
      zh[b.i].dangQian = b.dao;
    }
  });
  jian('跑完 8 轮：道一字未动', zh[0].dangQian === 3000);
  jian('第一次被动的轮次：无名段 0 < 印象（第 1 层）1 < 规范（第 3 层，与术同层）3 ⇒ 优先级越高越晚动',
    diYiCiDong[4] === 0 && diYiCiDong[3] === 1 && diYiCiDong[2] === 3, JSON.stringify(diYiCiDong));
  jian('术是同层里最后动的：这个缺口下它一段都没被压', diYiCiDong[1] === undefined && zh[1].dangQian === 2000);
  jian('跑完 8 轮：无名段最先也压得最狠（真极限 900）', zh[4].dangQian === 900);
  jian('缺口大到必须动第 3 层最后一档时，才轮到术（先压规范到真极限）', (() => {
    const z2 = mk();
    const dong = {};
    F.BENG_DAO.forEach((lun, h) => {
      const j2 = F.guiHuaYiLun(z2.map((d) => ({ ...d })), lun, 1200);
      for (const b of j2.bianGeng) { if (dong[b.i] === undefined) dong[b.i] = h; z2[b.i].dangQian = b.dao; }
    });
    /** 术被动的那一刻，规范已经压到真极限（同层内低优先级先压满） */
    return dong[1] !== undefined && z2[2].dangQian <= 900;
  })());
  jian('每一段都停在真极限或更高，不会压穿 600 字下限', zh.every((d) => d.dangQian === 3000 || d.dangQian >= 900));
  jian('每一段都停在真极限或更高，不会压穿 600 字下限', zh.every((d) => d.dangQian === 3000 || d.dangQian >= 900));
  const ji1 = F.guiHuaYiLun(mk(), F.BENG_DAO[0], 500);
  const yi = mk().map((d) => {
    const b = ji1.bianGeng.find((x) => x.i === d.i);
    return b ? { ...d, dangQian: b.dao } : { ...d };
  });
  const ji2 = F.guiHuaYiLun(yi, F.BENG_DAO[0], 500);
  jian('同一层同一强度再跑一遍不再压（幂等：不靠循环次数硬凑第二刀）', ji2.bianGeng.length === 0);
}

// ── 6. 主进程接线 ───────────────────────────────────────────────────
jian('主进程按泵道轮数循环（BENG_DAO.length + 收尾档），不是写死两趟', /for \(let lun = 0; lun < BENG_DAO\.length \+ 2; lun\+\+\)/.test(MAIN));
jian('主进程把「不可压名单」根本不放进队列（道 / 产品门禁不进 dangQian）',
  /if \(cengOf\(biao, BU_KE_YA_SUO\) === -1\) return;/.test(MAIN));
jian('主进程一轮只提一层（把整条队列一次性丢给压缩器 = 分层失效）',
  /guiHuaYiLun\(dangQian, lunXian, chaoZi\)/.test(MAIN) && !/guiHuaYiLun\(dangQian, \{ ceng: 0/.test(MAIN));
jian('原文长度从压缩说明里取（不靠下标记账：后面还会往队列里加段）', /本段从 \(\\d\+\) 字压到/.test(MAIN)
  && /const yuanShi = Math\.max\(Number\(jiu\?\.\[1\]\) \|\| 0, c\.length\)/.test(MAIN));
jian('审计把**层号与强度**一起落下（能回答"这一轮压的是哪一层"）',
  /ceng: lunXian\.ceng, qiangDu: lunXian\.qiangDu/.test(MAIN));
jian('压缩后仍然如实告诉模型"完整内容可以取回，不是删掉了"', /完整内容由记忆工具 recall\/retrieve 取，不是删掉了/.test(MAIN));
jian('压完一轮就重新核算、装得下立刻停手（不做无谓的第二刀）',
  /chengBen = jiBen\(\);[\s\S]{0,160}if \(!fp\.jiangJi\.includes\(JIANG_JI\.TINGZHI\)\) break;/.test(MAIN));

console.log(`==== verify-r52-yasuo: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
