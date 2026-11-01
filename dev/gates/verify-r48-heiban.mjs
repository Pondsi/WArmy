/**
 * 第 48 轮 · 任务级共享黑板（ADR000 P5 SharedContext）+ 真正的蒸馏返回 + 队列冲刷同协议（fast 档，确定性）
 *
 * 判据全部是**行为**（调编译产物、接真记忆服务、起一个假的 OpenAI 兼容端点让编排器整条链真的跑），
 * 每一组断言都配了负向对照（同一组数据换成旧口径 / 坏输入，断言必须翻红）：
 *  ① 黑板纯逻辑：输入校验真值表、只追加 + tiDai 替代、来源宿主盖章（参数里自报的身份不认）、
 *     冲突 = 同主题 + 不同来源 + 说法不同、产物重叠、未决问题、有界摘要（黑板 200 条也 ≤ 2400 字）；
 *  ② 蒸馏纯逻辑：jiao_fu 解析、正文 JSON 兜底、结论硬上限、超长全文、产物宿主核实、公平配额；
 *  ③ 落盘适配（hei-ban-cun.ts，主进程调的同一份）× 真记忆服务（memory-os JiyiCangFuwu）：
 *     存进去、recall 找得到、retrieve(recordId) 取得回原文、重开进程还在、不混进聊天重放；记忆服务不可用 ⇒ 不给指针；
 *  ④ 编排器端到端（假模型）：两个执行者并行共写一块黑板、各自身份/工具、宿主补记、冲突摆出来、
 *     产物核实、超长结论存档 + 可执行指针；记忆服务挂了 ⇒ 如实说"未能存档"；
 *  ⑤ 队列冲刷：排队的消息真的被处理，且走与主路径同一套执行者协议（以前成员都还 busy ⇒ 永远轮不到）；
 *  ⑥ 契约「缓存三层顺序」：值班者自答 = 冻结系统提示 → 有界视图 → 状态卡片（最后），系统提示跨轮逐字相同；
 *  ⑦ 马尔可夫毯 O(任务规模)：用户发 20 万字，执行者请求仍在毯的档位内。
 *
 * 用法：node dev/gates/verify-r48-heiban.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Mod, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = (p) => pathToFileURL(path.join(GEN, p)).href;

/** 原生 sqlite 的解析：与压力档同一套（只在本进程里把 better-sqlite3 指到候选副本，不改仓库） */
const SQLITE_HOUXUAN = [
  path.join(GEN, 'packages/memory-os/vendor/better-sqlite3'),
  path.join(GEN, 'node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3'),
  path.join(GEN, 'node_modules/better-sqlite3'),
];
const yuanShiJieXi = Mod._resolveFilename;
Mod._resolveFilename = function (qingQiu, ...rest) {
  if (qingQiu === 'better-sqlite3') {
    for (const h of SQLITE_HOUXUAN) {
      const er = path.join(h, 'lib', 'index.js');
      if (fs.existsSync(er)) return yuanShiJieXi.call(Mod, er, ...rest);
    }
  }
  return yuanShiJieXi.call(this, qingQiu, ...rest);
};
try {
  const D = createRequire(path.join(GEN, 'packages/memory-os/package.json'))('better-sqlite3');
  new D(':memory:').close();
} catch {
  console.log('FATAL: 取不到可用的 better-sqlite3 原生绑定（候选：' + SQLITE_HOUXUAN.join(' ; ') + '）——这是环境缺件，不是产品缺陷');
  process.exit(2);
}

const HB = await import(dist('packages/app-shell/dist/hei-ban.js'));
const ZL = await import(dist('packages/app-shell/dist/zheng-liu.js'));
const CUN = await import(dist('packages/app-shell/dist/hei-ban-cun.js'));
const ORCH = await import(dist('packages/app-shell/dist/orchestrator.js'));
const WT = await import(dist('packages/app-shell/dist/work-tools.js'));
const { GroupChatRouter, DEFAULT_PERMISSIONS } = await import(dist('packages/group-router/dist/index.js'));
const { JiyiCangFuwu } = await import(dist('packages/memory-os/dist/index.js'));

const jie = [];
const jian = (ming, ok, xiang) => {
  jie.push({ ming, ok: ok === true, xiang: xiang === undefined ? '' : String(xiang) });
  console.log(`${ok === true ? 'PASS' : 'FAIL'} ${ming}${xiang === undefined || xiang === '' ? '' : ' —— ' + String(xiang).slice(0, 300)}`);
};
const LINSHI = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r48-'));
const LY = (id, ming) => ({ id, ming, jueSe: 'executor' });
const A = LY('nm-a', '甲');
const B = LY('nm-b', '乙');

// ═══════════════ ① 黑板纯逻辑 ═══════════════
console.log('\n① 任务黑板（纯逻辑）');
{
  const biao = [
    [{ lei: 'fact', nei: '读到 3 个文件' }, true, '合法事实'],
    [{ lei: 'bogus', nei: 'x' }, false, '种类不认识'],
    [{ lei: 'fact', nei: '   ' }, false, '内容为空'],
    [{ lei: 'fact', nei: 'x'.repeat(HB.HEI_BAN_DAN_TIAO_ZI) }, true, '正好到单条上限'],
    [{ lei: 'fact', nei: 'x'.repeat(HB.HEI_BAN_DAN_TIAO_ZI + 1) }, false, '超单条上限'],
    [{ lei: 'decision', nei: '用 A 方案' }, false, '决定没主题'],
    [{ lei: 'decision', zhuTi: '方案', nei: '用 A' }, true, '决定带主题'],
    [{ lei: 'artifact', nei: 'x' }, false, '产物没路径'],
    [{ lei: 'artifact', nei: 'x', luJing: 'C:/a.txt' }, true, '产物带路径'],
    [{ lei: 'answer', nei: 'x' }, false, '回答没关联'],
    [{ lei: 'answer', nei: 'x', guanLian: 'hb-nope' }, false, '回答关联了不存在的问题'],
    [{ lei: 'fact', nei: 'x', tiDai: 'hb-nope' }, false, '替代了不存在的条目'],
  ];
  const cuo = biao.filter(([s, yao]) => (HB.xiaoYanShuRu(s, []) === '') !== yao).map((x) => x[2]);
  jian('输入校验真值表（12 行：合法的收、坏的拒，拒收原因是给执行者看的可执行话）', cuo.length === 0, cuo.join('、') || '全部符合');
  const man = Array.from({ length: HB.HEI_BAN_MEI_REN_WU_TIAO }, (_, i) => ({ id: `hb-x-${i}`, lei: 'fact', nei: 'x', laiYuan: A }));
  jian('每个任务的条目数有上限（防一个执行者把黑板刷成第二份聊天记录）', /上限/.test(HB.xiaoYanShuRu({ lei: 'fact', nei: 'y' }, man)));

  const hb = new HB.RenWuHeiBan('rw-t1', 'g1', { xie: () => true }, () => 1000);
  const r1 = await hb.xie({ lei: 'decision', zhuTi: '输出文件名', nei: 'a.txt', laiYuan: { id: 'nm-b', ming: '乙' }, ming: '伪造的名字', id: 'hb-伪造' }, A);
  jian('来源由宿主盖章：参数里自报的 laiYuan / ming / id 一律不认',
    r1.ok && r1.tiao.laiYuan.id === 'nm-a' && r1.tiao.laiYuan.ming === '甲' && r1.tiao.id === 'hb-rw-t1-1',
    JSON.stringify(r1.ok ? { id: r1.tiao.id, laiYuan: r1.tiao.laiYuan } : r1));
  jian('落盘成功才标已存档（存储回 true）', r1.ok && r1.tiao.yiLuoPan === true);
  const r2 = await hb.xie({ lei: 'decision', zhuTi: '输出 文件名：', nei: 'b.txt' }, B);
  const ct = HB.heiBanChongTu(hb.lie());
  jian('冲突 = 同主题（归一后）+ 不同来源 + 说法不同', ct.length === 1 && ct[0].ge.length === 2, JSON.stringify(ct));
  const r3 = await hb.xie({ lei: 'decision', zhuTi: '输出文件名', nei: 'a.txt', tiDai: r2.tiao.id }, B);
  jian('只追加：改口新写一条 + tiDai，旧条目还在、但不再有效，冲突随之消解',
    r3.ok && hb.lie().length === 3 && !HB.youXiaoTiao(hb.lie()).some((t) => t.id === r2.tiao.id) && HB.heiBanChongTu(hb.lie()).length === 0,
    `条目 ${hb.lie().length} · 有效 ${HB.youXiaoTiao(hb.lie()).length} · 冲突 ${HB.heiBanChongTu(hb.lie()).length}`);
  {
    const tong = new HB.RenWuHeiBan('rw-t2', 'g1');
    await tong.xie({ lei: 'decision', zhuTi: '方案', nei: '用 A。' }, A);
    await tong.xie({ lei: 'decision', zhuTi: '方案', nei: '用a' }, B);
    const zhuYi = new HB.RenWuHeiBan('rw-t3', 'g1');
    await zhuYi.xie({ lei: 'decision', zhuTi: '方案', nei: '用 A' }, A);
    await zhuYi.xie({ lei: 'decision', zhuTi: '方案', nei: '用 B' }, A);
    jian('负向：说法相同不算冲突；同一来源改主意不算冲突（最新一条为准）',
      HB.heiBanChongTu(tong.lie()).length === 0 && HB.heiBanChongTu(zhuYi.lie()).length === 0
      && HB.youXiaoTiao(zhuYi.lie()).filter((t) => t.lei === 'decision').length === 1);
  }
  {
    const cuoCun = async (cun) => { const h = new HB.RenWuHeiBan('rw-c', 'g1', cun); return (await h.xie({ lei: 'fact', nei: 'x' }, A)).tiao.yiLuoPan; };
    const zhi = [await cuoCun({ xie: () => false }), await cuoCun({ xie: () => { throw new Error('盘满'); } }), await cuoCun(undefined), await cuoCun({ xie: async () => 'yes' })];
    jian('负向：存储回 false / 抛错 / 没有存储 / 回了非 true ⇒ 一律不算已存档（不给假指针）', zhi.every((x) => x === false), JSON.stringify(zhi));
  }
  {
    const h = new HB.RenWuHeiBan('rw-q', 'g1');
    const q1 = await h.xie({ lei: 'question', nei: '要不要压缩？' }, A);
    await h.xie({ lei: 'question', nei: '用哪个端口？' }, A);
    await h.xie({ lei: 'answer', nei: '不压缩', guanLian: q1.tiao.id }, B);
    const wei = HB.weiJieWenTi(h.lie());
    jian('未决问题：答过的不再算未决', wei.length === 1 && wei[0].nei === '用哪个端口？', wei.map((t) => t.nei).join('、'));
    await h.xie({ lei: 'artifact', nei: 'a', luJing: 'C:\\W\\a.txt' }, A);
    await h.xie({ lei: 'artifact', nei: 'a', luJing: 'c:/w/a.txt/' }, B);
    const dan = new HB.RenWuHeiBan('rw-q2', 'g1');
    await dan.xie({ lei: 'artifact', nei: 'a', luJing: 'C:/w/a.txt' }, A);
    await dan.xie({ lei: 'artifact', nei: 'a', luJing: 'C:/w/a.txt' }, A);
    jian('产物重叠：同一文件（大小写/斜杠归一）被两个来源写过 ⇒ 提醒；同一来源写两次不算',
      HB.chanWuChongDie(h.lie()).length === 1 && HB.chanWuChongDie(dan.lie()).length === 0);
    const qian = h.lie().length;
    const b1 = await h.buJi({ lei: 'question', nei: '用哪个端口？' }, A);
    jian('宿主补记去重：执行者自己写过的，补记不再重复写', b1 === false && h.lie().length === qian);
  }
  {
    const zao = async (n, cun) => {
      const h = new HB.RenWuHeiBan('rw-big', 'g1', cun);
      for (let i = 0; i < n; i++) {
        const lei = ['fact', 'decision', 'artifact', 'question'][i % 4];
        await h.xie({ lei, nei: `第${i}条 ` + '内容'.repeat(280), zhuTi: lei === 'decision' ? `主题${i % 7}` : undefined, luJing: lei === 'artifact' ? `C:/w/f${i}.txt` : undefined }, Math.floor(i / 4) % 2 ? A : B);
      }
      return h;
    };
    const da = await zao(HB.HEI_BAN_MEI_REN_WU_TIAO, { xie: () => true });
    const xiao = await zao(10, { xie: () => true });
    const zDa = HB.heiBanZhaiYao(da.lie(), 'rw-big');
    const zXiao = HB.heiBanZhaiYao(xiao.lie(), 'rw-big');
    const luoMu = da.lie().map((t) => t.nei).join('\n');
    jian(`有界摘要：黑板 ${HB.HEI_BAN_MEI_REN_WU_TIAO} 条（原文 ${luoMu.length} 字）摘要仍 ≤ ${HB.HEI_BAN_ZHAI_YAO_ZI} 字；10 条时也 ≤ 上限`,
      zDa.length <= HB.HEI_BAN_ZHAI_YAO_ZI && zXiao.length <= HB.HEI_BAN_ZHAI_YAO_ZI && luoMu.length > HB.HEI_BAN_ZHAI_YAO_ZI * 10,
      `200 条 → ${zDa.length} 字 · 10 条 → ${zXiao.length} 字 · 负向对照：直接拼原文 ${luoMu.length} 字`);
    jian('装不下的条数如实写出来，并给可执行的取回路径（heiban_read / retrieve）',
      /另有 \d+ 条没列出/.test(zDa) && /heiban_read/.test(zDa) && /retrieve\(recordId=/.test(zDa));
    {
      const youXiao = HB.youXiaoTiao(da.lie()).length;
      const lieChu = zDa.split('\n').filter((l) => l.startsWith('· [')).length;
      const ctHang = zDa.split('\n').filter((l) => l.startsWith('⚠ 冲突')).length;
      const shuo = Number((zDa.match(/另有 (\d+) 条没列出/) || [])[1]);
      /** 旧算法把冲突行也当条目（候选行 = 冲突行 + 各类最近几条）：同一块黑板下它会少报冲突行那么多条（负向对照） */
      const you = HB.youXiaoTiao(da.lie());
      const n = (lei, k) => Math.min(k, you.filter((t) => t.lei === lei).length);
      const hou = Math.min(4, HB.weiJieWenTi(da.lie()).length) + n('decision', 5) + n('artifact', 5) + n('fact', 5);
      const jiuShu = hou - lieChu + Math.max(0, youXiao - ctHang - hou);
      jian('"另有几条没列出"按条目算：报的数 + 列出的条目 = 有效条目总数（冲突行不算条目）',
        shuo + lieChu === youXiao && ctHang > 0 && jiuShu !== shuo, `有效 ${youXiao} · 列出 ${lieChu} · 冲突行 ${ctHang} · 报 ${shuo}（旧算法会报 ${jiuShu}）`);
    }
    jian('优先级：冲突 > 未决问题 > 决定（冲突行与未决行排在决定之前）',
      zDa.indexOf('⚠ 冲突') >= 0 && zDa.indexOf('⚠ 冲突') < zDa.indexOf('[决定]') && zDa.indexOf('[未决问题]') < zDa.indexOf('[决定]'),
      `冲突@${zDa.indexOf('⚠ 冲突')} 未决@${zDa.indexOf('[未决问题]')} 决定@${zDa.indexOf('[决定]')}`);
    const meiLuo = await zao(12, { xie: () => false });
    const zMei = HB.heiBanZhaiYao(meiLuo.lie(), 'rw-big');
    jian('只有已落盘的条目带 recordId（没落盘的给了也取不回，宁缺不假）',
      / · hb-rw-big-\d+）/.test(zXiao) && !/ · hb-rw-big-\d+）/.test(zMei));
    jian('空黑板 ⇒ 摘要为空串（不往上下文里塞空壳）', HB.heiBanZhaiYao([], 'rw-0') === '');
    const du = HB.heiBanDuChu(da.lie(), {}, 'rw-big');
    const duJue = HB.heiBanDuChu(da.lie(), { lei: 'decision' }, 'rw-big');
    jian(`heiban_read 有界（≤ ${HB.HEI_BAN_DU_ZI} 字 + 提示）、最新在前、能按种类筛`,
      du.length <= HB.HEI_BAN_DU_ZI + 200 && du.split('\n')[1].startsWith(da.lie()[da.lie().length - 1].id)
      && !/\[事实\]|\[产物\]/.test(duJue) && /\[决定\]/.test(duJue),
      `全量 ${du.length} 字 · 首行 ${du.split('\n')[1].slice(0, 30)}`);
  }
  const wen = HB.heiBanJiLuWen({ id: 'hb-rw-z-1', renWuId: 'rw-z', groupId: 'g', lei: 'decision', zhuTi: '输出文件名', nei: 'a.txt', laiYuan: A, ts: 1, yiLuoPan: true });
  jian('写进记忆库的正文带任务号、种类、主题、来源（recall(任务号) 就能找回整块黑板）',
    wen.includes('rw-z') && wen.includes('决定') && wen.includes('输出文件名') && wen.includes('甲'), wen);
  const gj = HB.heiBanGongJu();
  const can = gj.find((g) => g.function.name === 'heiban_write')?.function.parameters.properties || {};
  jian('工具规格里没有任何"来源"参数（执行者没有途径自报身份）',
    gj.map((g) => g.function.name).join(',') === 'heiban_write,heiban_read' && !['laiYuan', 'ming', 'id', 'source', 'from'].some((k) => k in can),
    Object.keys(can).join(','));
}

// ═══════════════ ② 蒸馏纯逻辑 ═══════════════
console.log('\n② 蒸馏返回（纯逻辑）');
{
  const hao = ZL.jieXiJiaoFu({ jieLun: ' 做完了 ', chanWu: ['a', 3, '', null, 'b'], shiShi: ['x'], jueDing: [{ zhuTi: 'k', nei: 'v' }, { nei: '没主题' }], wenTi: [] });
  jian('jiao_fu 解析：字段归一、非字符串丢掉、没主题的决定丢掉',
    hao && hao.jieLun === '做完了' && hao.chanWu.join(',') === 'a,b' && hao.jueDing.length === 1, JSON.stringify(hao));
  jian('负向：jieLun 缺失 / 坏 JSON / null ⇒ 不收（交给正文兜底，而不是收一份空交付）',
    ZL.jieXiJiaoFu({ chanWu: ['a'] }) === null && ZL.jieXiJiaoFu('{bad') === null && ZL.jieXiJiaoFu(null) === null
    && ZL.jieXiJiaoFu(JSON.stringify({ jieLun: '好' }))?.jieLun === '好');
  const j = ZL.jieXiZhengWen('做完了。\n```json\n{"jieLun":"已写好","shiShi":["s1"]}\n```');
  const z = ZL.jieXiZhengWen('写好了 C:\\out\\a.txt 和 report.md，版本 1.2.3。');
  jian('没调工具：先认正文里的 ```json 块，没有就按正文兜底（路径能认出，版本号不算路径）',
    j.laiYuan === 'json' && j.can.jieLun === '已写好' && z.laiYuan === 'zheng_wen'
    && z.can.chanWu.includes('C:\\out\\a.txt') && z.can.chanWu.includes('report.md') && !z.can.chanWu.includes('1.2.3'),
    JSON.stringify(z.can.chanWu));
  const zhen = path.join(LINSHI, 'zhen-chanwu.txt');
  fs.writeFileSync(zhen, 'x');
  const heShi = (lu) => (fs.existsSync(lu) && fs.statSync(lu).isFile() ? path.resolve(lu) : '');
  const chang = '这一句是结论。'.repeat(80);
  const zl = ZL.zhengLiu({
    taskId: 't', jiaoFu: { jieLun: chang, chanWu: [zhen, 'Z:/r48-bu-cun-zai/x.txt'], shiShi: Array.from({ length: 7 }, (_, i) => `事实${i}` + '长'.repeat(200)), jueDing: [{ zhuTi: '名', nei: 'a' }], wenTi: ['问1', '问2', '问3', '问4'] },
    zhengWen: '', youGongJu: true, heShi, stats: { durationMs: 1, promptTokens: 1, completionTokens: 1 },
  });
  jian(`结论硬上限（有工具 ≤${ZL.JIE_LUN_YOU_GONG_JU} 字），在句子边界截，超长标记 + 完整原文一字不丢`,
    zl.jieGuo.distilled.length <= ZL.JIE_LUN_YOU_GONG_JU && zl.jieGuo.distilled.endsWith('。') && zl.chaoChang && zl.quanWen.includes(chang),
    `${chang.length} → ${zl.jieGuo.distilled.length} 字`);
  jian('产物宿主核实：存在的进 artifacts（绝对路径），不存在的进 unverifiedArtifacts',
    zl.jieGuo.artifacts.length === 1 && zl.jieGuo.artifacts[0] === path.resolve(zhen) && zl.jieGuo.unverifiedArtifacts.join() === 'Z:/r48-bu-cun-zai/x.txt');
  jian('事实/问题条数与单条都有上限（5×160 / 3×160）',
    zl.jieGuo.facts.length === 5 && zl.jieGuo.facts.every((s) => s.length <= 161) && zl.jieGuo.questions.length === 3 && zl.jieGuo.laiYuan === 'jiao_fu');
  const wu = ZL.zhengLiu({ taskId: 't', jiaoFu: null, zhengWen: '短结论。', youGongJu: false, heShi, stats: { durationMs: 0, promptTokens: 0, completionTokens: 0 } });
  const wuChang = ZL.zhengLiu({ taskId: 't', jiaoFu: null, zhengWen: chang, youGongJu: false, heShi, stats: { durationMs: 0, promptTokens: 0, completionTokens: 0 } });
  jian(`没工具 ≤${ZL.JIE_LUN_WU_GONG_JU} 字；短结论不标超长、不产生存档原文`,
    wuChang.jieGuo.distilled.length <= ZL.JIE_LUN_WU_GONG_JU && !wu.chaoChang && wu.quanWen === '' && wu.jieGuo.laiYuan === 'zheng_wen');
  jian('指针只在真 recordId 时挂（空串 / 空白 ⇒ 不挂：指向不存在的地方比不给更坏）',
    !('fullRecordId' in ZL.zhengLiuZhiZhen(zl.jieGuo, '')) && !('fullRecordId' in ZL.zhengLiuZhiZhen(zl.jieGuo, '  '))
    && ZL.zhengLiuZhiZhen(zl.jieGuo, 'wk-1').fullRecordId === 'wk-1');
  const peiE = ZL.meiRenPeiE(3);
  const youZhi = ZL.zhengLiuXiaoJie(ZL.zhengLiuZhiZhen(zl.jieGuo, 'wk-rw-1-nm-a'), '甲', peiE, true);
  const wuZhi = ZL.zhengLiuXiaoJie(zl.jieGuo, '甲', peiE, true);
  const buChang = ZL.zhengLiuXiaoJie(wu.jieGuo, '甲', peiE, false);
  jian('回复小节：有存档 ⇒ 可执行指针；没存上 ⇒ 如实说"未能存档"；不超长 ⇒ 不提存档；每节 ≤ 配额',
    youZhi.includes('retrieve(recordId="wk-rw-1-nm-a")') && wuZhi.includes('未能存档') && !/存档/.test(buChang)
    && [youZhi, wuZhi, buChang].every((s) => s.length <= peiE) && youZhi.includes('说产出了但没找到'),
    `配额 ${peiE} · ${youZhi.length}/${wuZhi.length}/${buChang.length}`);
  jian('公平配额：1 人 3000 / 5 人 600 / 10 人 400（每人保底，不再先到先得）',
    ZL.meiRenPeiE(1) === 3000 && ZL.meiRenPeiE(5) === 600 && ZL.meiRenPeiE(10) === 400 && ZL.meiRenPeiE(0) === 3000);
}

// ═══════════════ ③ 落盘适配 × 真记忆服务 ═══════════════
console.log('\n③ 落盘适配（主进程同一份工厂）× 真记忆服务');
const JIYI_MU = path.join(LINSHI, 'mem');
let svc = new JiyiCangFuwu({ CangLu: JIYI_MU });
/** 与记忆服务 IPC 的 append 处理器同形：`{ ok: true, seq }`，抛错 ⇒ 调用方收到 rejection */
const kou = { get isReady() { return true; }, append: async (r, Bi) => { const x = svc.append(r, Bi); return { ok: true, seq: x.seq }; } };
const shenJi = [];
const rizhi = (code, data) => shenJi.push({ code, ...data });
{
  const cun = CUN.zaoHeiBanCun(() => kou, rizhi);
  const hb = new HB.RenWuHeiBan('rw-mem1', 'g-mem', cun);
  const t1 = (await hb.xie({ lei: 'decision', zhuTi: '输出文件名', nei: 'report-final.md' }, A)).tiao;
  const t2 = (await hb.xie({ lei: 'fact', nei: '数据源一共 1234 行，空值 17 行' }, B)).tiao;
  const t3 = (await hb.xie({ lei: 'artifact', nei: '报告', luJing: 'C:/w/report-final.md' }, A)).tiao;
  jian('三条都真的写进记忆库（回 ok:true 才标已存档）', [t1, t2, t3].every((t) => t.yiLuoPan), [t1, t2, t3].map((t) => `${t.id}:${t.yiLuoPan}`).join(' '));
  const qu = [t1, t2, t3].map((t) => svc.retrieve({ recordId: t.id }));
  jian('retrieve(recordId) 取回的是原文（条目 id 就是记忆库 recordId）',
    qu.every((x, i) => x && String(x.raw).includes([t1, t2, t3][i].nei)), qu.map((x) => (x ? String(x.raw).slice(0, 40) : 'null')).join(' | '));
  const ka = svc.recall('rw-mem1', 20);
  const kaId = new Set(ka.map((c) => c.recordId || c.anchor?.recordId));
  jian('recall(任务号) 找得到这块黑板', [t1, t2, t3].some((t) => kaId.has(t.id)), `命中 ${ka.length} 张：${[...kaId].join(',')}`);
  const ka2 = svc.recall('1234 行', 10);
  jian('recall(内容关键词) 也找得到（事实条目能被语义线索召回）', ka2.some((c) => (c.recordId || c.anchor?.recordId) === t2.id), `命中 ${ka2.map((c) => c.recordId || c.anchor?.recordId).join(',')}`);
  let juJue = false;
  try { svc.append({ id: 'x-msg', sessionId: 'g-mem', kind: 'message', ti: 'x' }, 'executor'); } catch { juJue = true; }
  jian('写入者约束仍在：执行者身份写 message 被拒，写 blackboard 放行（黑板没给执行者开后门写聊天流）', juJue && t2.yiLuoPan);
  const quan = CUN.zaoCunZhengLiuQuanWen(() => kou, rizhi);
  const chang = '完整结论第一段。'.repeat(700);
  const id = await quan({ groupId: 'g-mem', renWuId: 'rw-mem1', zxId: 'nm-a', ming: '甲', wen: chang });
  const hui = id ? svc.retrieve({ recordId: id }, { maxChars: 20000 }) : null;
  jian('超长结论存档：回真 recordId，retrieve 取回完整原文（一字不少）',
    id === 'wk-rw-mem1-nm-a' && !!hui && String(hui.raw).includes(chang), `${id} · 原文 ${chang.length} 字 · 取回 ${hui ? String(hui.raw).length : 0} 字`);
  svc.close();
  svc = new JiyiCangFuwu({ CangLu: JIYI_MU });
  const chong = svc.retrieve({ recordId: t1.id });
  const chongBo = svc.tailPerSession(120, 40).filter((r) => r.kind !== 'message');
  jian('重开记忆服务后黑板仍取得回；按会话重放只认 message（黑板/存档不会被当聊天消息重放）',
    !!chong && String(chong.raw).includes('report-final.md') && chongBo.length === 0,
    `重放里非 message 条目 ${chongBo.length}`);
  const fou = [
    await CUN.zaoHeiBanCun(() => ({ isReady: false, append: async () => ({ ok: true }) }), rizhi).xie(t1),
    await CUN.zaoHeiBanCun(() => null, rizhi).xie(t1),
    await CUN.zaoHeiBanCun(() => ({ isReady: true, append: async () => ({ ok: false, error: 'disk full' }) }), rizhi).xie(t1),
    await CUN.zaoHeiBanCun(() => ({ isReady: true, append: async () => { throw new Error('memory ipc timeout'); } }), rizhi).xie(t1),
    await CUN.zaoHeiBanCun(() => ({ isReady: true, append: async () => undefined }), rizhi).xie(t1),
  ];
  const fouQuan = [
    await CUN.zaoCunZhengLiuQuanWen(() => ({ isReady: false, append: async () => ({ ok: true }) }), rizhi)({ groupId: 'g', renWuId: 'r', zxId: 'z', ming: 'm', wen: 'w' }),
    await CUN.zaoCunZhengLiuQuanWen(() => ({ isReady: true, append: async () => ({ ok: false }) }), rizhi)({ groupId: 'g', renWuId: 'r', zxId: 'z', ming: 'm', wen: 'w' }),
  ];
  jian('负向：记忆服务没起 / 不存在 / 回 ok:false / IPC 超时 / 回空 ⇒ 黑板不算落盘、存档不给 recordId',
    fou.every((x) => x === false) && fouQuan.every((x) => x === ''), JSON.stringify({ fou, fouQuan }));
  jian('成败都进审计（能 grep 到原因：memory-not-ready / disk full / memory ipc timeout）',
    shenJi.some((x) => x.code === 'group.heiban' && x.ok === true) && shenJi.some((x) => x.code === 'group.heiban-fail' && x.error === 'memory-not-ready')
    && shenJi.some((x) => x.code === 'group.heiban-fail' && /disk full/.test(x.error)) && shenJi.some((x) => x.code === 'group.heiban-fail' && /ipc timeout/.test(x.error))
    && shenJi.some((x) => x.code === 'group.zhengliu-quanwen' && x.id === 'wk-rw-mem1-nm-a'));
  const qu2 = path.join(LINSHI, 'ws-g1');
  fs.mkdirSync(path.join(qu2, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(qu2, 'a.txt'), 'x');
  const heShi = CUN.zaoHeShiChanWu(() => qu2);
  jian('产物核实与干活工具同一解析口径：相对路径落在项目工作区、绝对路径照认、目录/不存在/空 ⇒ 没找到',
    heShi('g1', 'a.txt') === path.join(qu2, 'a.txt') && heShi('g1', path.join(qu2, 'a.txt')) === path.join(qu2, 'a.txt')
    && heShi('g1', 'sub') === '' && heShi('g1', 'nope.txt') === '' && heShi('g1', '') === '');
}

// ═══════════════ ④–⑦ 编排器端到端（假的 OpenAI 兼容端点） ═══════════════
const BIAO = 'r48' + Date.now().toString(36);
const QINGQIU = [];
const xiang = (content, gongJu) => ({
  id: 'c-' + QINGQIU.length, model: 'fake',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: content || '', ...(gongJu ? { tool_calls: gongJu.map(([n, a], i) => ({ id: `call_${QINGQIU.length}_${i}`, type: 'function', function: { name: n, arguments: JSON.stringify(a) } })) } : {}) },
    finish_reason: gongJu ? 'tool_calls' : 'stop',
  }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});
let GONG_ZUO_QU = '';
const CHANG_JIE_LUN = '乙这边已经把文件写好并核对过内容。'.repeat(30);
const jiaoBen = (ti) => {
  const ms = ti.messages || [];
  const xi = String(ms[0]?.content || '');
  const n = ms.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length).length;
  if (xi.includes('「牛马乙」')) {
    if (n === 0) return xiang('', [['write_file', { path: `yi-${BIAO}.txt`, content: BIAO }], ['heiban_write', { lei: 'decision', zhuTi: '输出文件名', nei: `yi-${BIAO}.txt` }]]);
    if (n === 1) {
      return xiang('', [['jiao_fu', {
        jieLun: CHANG_JIE_LUN,
        chanWu: [path.join(GONG_ZUO_QU, `yi-${BIAO}.txt`), 'Z:/r48-bu-cun-zai/fake.txt'],
        shiShi: ['数据 1234 行', '空值 17 行', '编码 UTF-8', '分隔符逗号', '有表头', '多余的第六条'],
        jueDing: [{ zhuTi: '输出文件名', nei: `yi-${BIAO}.txt` }],
        wenTi: ['要不要压缩成 zip？'],
      }]]);
    }
    return xiang('已交付');
  }
  if (xi.includes('「牛马丙」')) {
    if (n === 0) {
      return xiang('', [
        ['heiban_write', { lei: 'decision', zhuTi: '输出 文件名：', nei: `bing-${BIAO}.txt`, laiYuan: { id: 'nm-yi', ming: '牛马乙', jueSe: 'host' }, ming: '牛马乙' }],
        ['heiban_read', {}],
      ]);
    }
    return xiang('做完了。\n```json\n' + JSON.stringify({ jieLun: '丙决定输出 bing 文件。', shiShi: ['丙核对了表头'], jueDing: [{ zhuTi: '输出文件名', nei: `bing-${BIAO}.txt` }], wenTi: [] }) + '\n```');
  }
  return xiang('值班者自己答：收到。');
};
const fuWu = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let ti = {};
    try { ti = JSON.parse(raw); } catch { /* 坏请求照样记 */ }
    QINGQIU.push(ti);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jiaoBen(ti)));
  });
});
const PORT = await new Promise((r) => fuWu.listen(0, '127.0.0.1', () => r(fuWu.address().port)));
const CFG = { presetId: 'fake-r48', apiKey: 'k-fake', baseURL: `http://127.0.0.1:${PORT}/v1`, model: 'fake-model', protocol: 'openai-compatible' };

function zaoQun(qunId, chengYuan) {
  const router = new GroupChatRouter({ queueWhenFixedBusy: false });
  router.createGroup({ groupId: qunId, ming: qunId, type: 'internal', dutyInstanceId: null, directedMode: false, members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50 });
  for (const s of chengYuan) router.join(qunId, { id: s.id, ming: s.ming, local: true, dutyEligible: true, status: 'idle' });
  return router;
}
const SAN = [
  { id: 'nm-jia', ming: '牛马甲', status: 'running', dutyEligible: true },
  { id: 'nm-yi', ming: '牛马乙', status: 'running', dutyEligible: true },
  { id: 'nm-bing', ming: '牛马丙', status: 'running', dutyEligible: true },
];
const RECALL_GUI_GE = { type: 'function', function: { name: 'recall', description: '回忆', parameters: { type: 'object', properties: { query: { type: 'string' } } } } };
function zaoDeps(router, chengYuan, jiYiKou, gongJuJi, ewai = {}) {
  return {
    router,
    board: { append: () => {}, listEvents: () => [] },
    ccr: { beforeLog: (x) => ({ content: x.content }) },
    history: new Map(),
    listInstances: () => chengYuan,
    contextBudgetChars: () => 8000,
    toolLimits: () => ({ zuiDaLunShu: 8, zuiDaJieGuoZiShu: 4000, totalChars: 12000 }),
    toolSpecs: () => [RECALL_GUI_GE],
    executorTools: () => WT.workToolSpecs().filter((g) => g.function.name === 'write_file'),
    executorConfig: (id) => (id === 'nm-yi' ? { persona: '你做事干脆，先动手再汇报。' } : undefined),
    runTool: async (call, ctx) => {
      const ming = String(call?.function?.name || '');
      gongJuJi.push(ming);
      if (WT.isWorkTool(ming)) return String(WT.runWorkTool(GONG_ZUO_QU, call, false, GEN).content || '').slice(0, ctx.zuiDaJieGuoZiShu);
      return '[recall] 没有更多';
    },
    projectMemory: () => '',
    decisionContext: () => '',
    heiBanCun: CUN.zaoHeiBanCun(() => jiYiKou, rizhi),
    heShiChanWu: CUN.zaoHeShiChanWu(() => GONG_ZUO_QU),
    cunZhengLiuQuanWen: CUN.zaoCunZhengLiuQuanWen(() => jiYiKou, rizhi),
    ...ewai,
  };
}
const qingQiuOf = (ming, cong) => QINGQIU.slice(cong).filter((q) => String(q.messages?.[0]?.content || '').includes(`「${ming}」`));
const gongJuMing = (q) => (q.tools || []).map((t) => t.function?.name);

console.log('\n④ 编排器端到端：两个执行者共写一块黑板 + 结构化蒸馏');
{
  GONG_ZUO_QU = path.join(LINSHI, 'ws-team');
  fs.mkdirSync(GONG_ZUO_QU, { recursive: true });
  const QUN = 'proj-r48';
  const router = zaoQun(QUN, SAN);
  const gongJuJi = [];
  const cong = QINGQIU.length;
  const r = await ORCH.xietiaoQunXiaoxi(zaoDeps(router, SAN, kou, gongJuJi), CFG, { groupId: QUN, userId: 'u', urgency: 'P2', content: `请两位分别产出结果文件（${BIAO}）` });
  console.log('     回复：' + String(r.reply || '').replace(/\n/g, ' ⏎ ').slice(0, 400));
  jian('派发成功：值班甲、执行者乙丙', r.action === 'dispatch' && r.dutyId === 'nm-jia' && (r.executorIds || []).join(',') === 'nm-yi,nm-bing', `${r.action} ${r.dutyId} ${(r.executorIds || []).join(',')}`);
  jian('值班者派发计划：2 个执行者、模型锁定、计划里没有 model',
    r.dispatchPlan?.modelLocked === true && r.dispatchPlan.assignments.length === 2
    && !JSON.stringify(r.dispatchPlan).includes('"model"')
    && r.dispatchPlan.assignments.every((a) => a.executorId === 'nm-yi' || a.executorId === 'nm-bing'),
    JSON.stringify(r.dispatchPlan).slice(0, 300));
  const yiQ = qingQiuOf('牛马乙', cong);
  const bingQ = qingQiuOf('牛马丙', cong);
  jian('每个执行者带自己的身份与人格（系统提示里如实注入）',
    yiQ.length >= 2 && bingQ.length >= 2 && String(yiQ[0].messages[0].content).includes('先动手再汇报') && !String(bingQ[0].messages[0].content).includes('先动手再汇报'));
  jian('执行者的工具 = 干活工具 + 记忆双刀 + jiao_fu + 黑板读写（不是只有值班者能回忆）',
    ['write_file', 'recall', 'jiao_fu', 'heiban_write', 'heiban_read'].every((n) => gongJuMing(yiQ[0]).includes(n)), gongJuMing(yiQ[0]).join(','));
  const zl = Object.fromEntries((r.zhengLiu || []).map((x) => [x.ming, x]));
  const yi = zl['牛马乙'];
  const bing = zl['牛马丙'];
  const zhen = path.join(GONG_ZUO_QU, `yi-${BIAO}.txt`);
  jian('乙走结构化交付（jiao_fu），产物经宿主核实：真文件进 artifacts、编的路径进 unverified',
    yi?.laiYuan === 'jiao_fu' && yi.artifacts.length === 1 && path.resolve(yi.artifacts[0]) === path.resolve(zhen) && fs.existsSync(zhen)
    && yi.unverified.join() === 'Z:/r48-bu-cun-zai/fake.txt', JSON.stringify(yi));
  jian('丙没调 jiao_fu ⇒ 认它正文里的 json 块（第二档兜底）', bing?.laiYuan === 'json', JSON.stringify(bing));
  const wk = yi?.fullRecordId || '';
  const quan = wk ? svc.retrieve({ recordId: wk }, { maxChars: 20000 }) : null;
  jian('乙的结论超长 ⇒ 完整原文存进记忆库，回复里给的指针真的取得回全文',
    yi?.chaoChang === true && /^wk-rw-/.test(wk) && !!quan && String(quan.raw).includes(CHANG_JIE_LUN) && String(r.reply).includes(`retrieve(recordId="${wk}")`),
    `${wk} · ${quan ? String(quan.raw).length : 0} 字`);
  const hb = r.renWuHeiBan || {};
  jian('黑板：两人的写入 + 宿主补记都在，全部落盘，检测到 1 处决定冲突',
    hb.tiaoShu >= 6 && hb.yiLuoPan === hb.tiaoShu && hb.chongTu === 1, JSON.stringify(hb));
  const jiLu = svc.recall(hb.renWuId || 'none', 50).map((c) => c.recordId || c.anchor?.recordId).filter((x) => String(x).startsWith('hb-'));
  const quanBu = Array.from({ length: hb.tiaoShu || 0 }, (_, i) => svc.retrieve({ recordId: `hb-${hb.renWuId}-${i + 1}` }));
  jian('每条黑板条目都能用 recordId 取回原文；recall(任务号) 召回这块黑板',
    quanBu.length === hb.tiaoShu && quanBu.every((x) => x && String(x.raw).includes(hb.renWuId)) && jiLu.length > 0,
    `取回 ${quanBu.filter(Boolean).length}/${hb.tiaoShu} · recall 命中 ${jiLu.length}`);
  const bingTiao = quanBu.filter((x) => x && String(x.raw).includes(`bing-${BIAO}`));
  jian('丙在参数里冒充"牛马乙/宿主"写黑板 ⇒ 记下的来源仍是丙',
    bingTiao.length >= 1 && bingTiao.every((x) => String(x.raw).includes('来源 牛马丙')), bingTiao.map((x) => String(x.raw).slice(-30)).join(' | '));
  const duHui = bingQ.slice(1).flatMap((q) => q.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)));
  jian('heiban_read 真的回到了执行者手里（有界、带 id）', duHui.some((s) => s.startsWith('[heiban_read]') && s.length <= HB.HEI_BAN_DU_ZI + 200), duHui.map((s) => s.slice(0, 50)).join(' | '));
  const reply = String(r.reply || '');
  jian('回复：每个执行者一节、点名没找到的产物、冲突摆出来交人裁决、黑板指针',
    reply.includes('【牛马乙】') && reply.includes('【牛马丙】') && reply.includes('说产出了但没找到') && reply.includes('决定有冲突')
    && reply.includes(`任务黑板 ${hb.renWuId}`) && !reply.includes('完整结论在各自的操作记录里'));
  jian('干完活所有成员回到 idle', router.listMembers(QUN).every((m) => m.status === 'idle'), router.listMembers(QUN).map((m) => `${m.ming}=${m.status}`).join(','));

  console.log('\n④b 负向：记忆服务不可用（同一条任务）');
  const router2 = zaoQun(QUN + '-b', SAN);
  const r2 = await ORCH.xietiaoQunXiaoxi(zaoDeps(router2, SAN, { isReady: false, append: async () => ({ ok: true }) }, []), CFG, { groupId: QUN + '-b', userId: 'u', urgency: 'P2', content: `请两位分别产出结果文件（${BIAO}）` });
  const yi2 = (r2.zhengLiu || []).find((x) => x.ming === '牛马乙');
  jian('记忆服务挂了：黑板 0 条落盘、不给存档指针、回复如实说"未能存档"、黑板摘要里没有 recordId',
    r2.renWuHeiBan?.yiLuoPan === 0 && r2.renWuHeiBan?.tiaoShu > 0 && yi2 && !yi2.fullRecordId && String(r2.reply).includes('未能存档')
    && !String(r2.reply).includes('retrieve(recordId="wk-') && String(r2.reply).includes('已存档 0 条'), JSON.stringify(r2.renWuHeiBan));
}

console.log('\n④c 值班者按难易度指定思考级别（模型仍由牛马设置决定）');
{
  GONG_ZUO_QU = path.join(LINSHI, 'ws-plan');
  fs.mkdirSync(GONG_ZUO_QU, { recursive: true });
  const QUN = 'proj-r48-plan';
  const router = zaoQun(QUN, SAN);
  const chengYuan = SAN.map((x) => ({ ...x, thinkLevel: 'auto' }));
  const cong = QINGQIU.length;
  const deps = zaoDeps(router, chengYuan, kou, [], {
    executorConfig: (id) => ({ model: `fake-model-${id}`, persona: '执行任务' }),
    executorThink: (_id, level) => ({ thinking_level: level }),
  });
  const r = await ORCH.xietiaoQunXiaoxi(deps, CFG, {
    groupId: QUN, userId: 'u', urgency: 'P2',
    content: `生产环境付款、删除数据库、发布上线，请两位分别产出结果文件（${BIAO}-plan）`,
  });
  const qs = QINGQIU.slice(cong).filter((q) => q.messages?.some((m) => m.role === 'user' && String(m.content).includes(`${BIAO}-plan`)));
  jian('高难任务 ⇒ 计划思考级别 l6（参悟级）', r.dispatchPlan?.difficulty?.thinkLevel === 'l6'
    && r.dispatchPlan.assignments.every((a) => a.thinkLevel === 'l6'), JSON.stringify(r.dispatchPlan?.assignments));
  jian('思考级别真的进了执行者请求（thinking_level=l6）',
    qs.length >= 2 && qs.every((q) => q.thinking_level === 'l6'), qs.map((q) => `${q.model}:${q.thinking_level}`).join(','));
  jian('模型仍来自各牛马自己的设置（值班者没有改 model）',
    r.dispatchPlan?.modelLocked === true && qs.some((q) => q.model === 'fake-model-nm-yi') && qs.some((q) => q.model === 'fake-model-nm-bing'),
    qs.map((q) => q.model).join(','));
}

console.log('\n④d 紧急度 P0：对正在忙的目标真的先停止，再派发');
{
  GONG_ZUO_QU = path.join(LINSHI, 'ws-stop');
  fs.mkdirSync(GONG_ZUO_QU, { recursive: true });
  const QUN = 'proj-r48-stop';
  const router = zaoQun(QUN, SAN);
  const busyMembers = SAN.map((x) => ({ ...x, busy: true }));
  const stopped = [];
  const auditEvents = [];
  const deps = zaoDeps(router, busyMembers, kou, [], {
    stopInstanceTask: (id) => { stopped.push(id); return true; },
    audit: (op, d) => { auditEvents.push({ op, ...(d || {}) }); },
  });
  const r = await ORCH.xietiaoQunXiaoxi(deps, CFG, {
    groupId: QUN, userId: 'u', urgency: 'P0',
    content: `紧急任务，请两位分别产出结果文件（${BIAO}-stop）`,
  });
  jian('P0 计划对忙碌目标写 stop', r.dispatchPlan?.assignments.every((a) => a.interrupt === 'stop'), JSON.stringify(r.dispatchPlan?.assignments));
  jian('宿主真的执行了停止（不是只写在计划里）',
    stopped.includes('nm-yi') && stopped.includes('nm-bing')
    && auditEvents.filter((e) => e.op === 'group.interrupt' && e.applied === true).length >= 2,
    `stopped=${stopped.join(',')} audit=${auditEvents.filter((e) => e.op === 'group.interrupt').length}`);
}

console.log('\n⑤ 队列冲刷：排队的消息真的被处理，且走同一套执行者协议');
{
  GONG_ZUO_QU = path.join(LINSHI, 'ws-queue');
  fs.mkdirSync(GONG_ZUO_QU, { recursive: true });
  const QUN = 'proj-r48-q';
  const router = zaoQun(QUN, SAN);
  for (const s of SAN) router.setStatus(QUN, s.id, 'busy');
  const pai = router.route({ groupId: QUN, userId: 'u', content: `排队的那条（${BIAO}-Q）`, urgency: 'P2', mentionIds: [], timestamp: Date.now() });
  jian('前置：成员都 busy 时 route() 选不出值班 ⇒ 入队（这正是冲刷时成员还没放回 idle 的旧状况）',
    pai.action === 'queue' && router.listQueue(QUN).length === 1, pai.action);
  const cong = QINGQIU.length;
  const r = await ORCH.xietiaoQunXiaoxi(zaoDeps(router, SAN, kou, []), CFG, { groupId: QUN, userId: 'u', urgency: 'P2', content: `新来的这条（${BIAO}-N）` });
  const paiDuiQ = qingQiuOf('牛马乙', cong).filter((q) => q.messages.some((m) => m.role === 'user' && String(m.content).includes(`${BIAO}-Q`)));
  jian('排队那条被冲刷处理掉了（队列清空、回复里有冲刷段且带执行者小节）',
    router.listQueue(QUN).length === 0 && /\[队列冲刷\][\s\S]*【牛马乙】/.test(String(r.reply)), `队列 ${router.listQueue(QUN).length} · ${String(r.reply).slice(-200).replace(/\n/g, ' ⏎ ')}`);
  jian('冲刷路径与主路径同一协议：执行者带身份、有 jiao_fu 与黑板工具',
    paiDuiQ.length >= 1 && ['jiao_fu', 'heiban_write', 'write_file'].every((n) => gongJuMing(paiDuiQ[0]).includes(n)), paiDuiQ.length ? gongJuMing(paiDuiQ[0]).join(',') : '没收到冲刷的执行者请求');
}

console.log('\n⑥ 值班者本体不执行：只派唯一分身（第 121 轮口径）');
{
  const DAN = [{ id: 'nm-jia', ming: '牛马甲', status: 'running', dutyEligible: true }];
  const QUN = 'proj-r48-c';
  const router = zaoQun(QUN, DAN);
  const riZhi = [];
  const auditEvents = [];
  const deps = zaoDeps(router, DAN, kou, [], { logOf: () => riZhi, audit: (op, d) => { auditEvents.push({ op, ...(d || {}) }); } });
  const cong = QINGQIU.length;
  const auCong = auditEvents.length;
  for (let i = 0; i < 3; i++) {
    riZhi.push({ seq: riZhi.length + 1, role: 'user', content: `第 ${i} 轮用户说的话（${'字'.repeat(50 + i * 30)}）`, recordId: `m-${i}` });
    await ORCH.xietiaoQunXiaoxi(deps, CFG, { groupId: QUN, userId: 'u', urgency: 'P2', content: `第 ${i} 轮` });
  }
  const qiu = QINGQIU.slice(cong);
  const zhiBan = qiu.filter((q) => String(q.messages?.[0]?.content || '').includes('的值班者'));
  const fenShen = qiu.filter((q) => q.messages.some((m) => String(m.content || '').includes('分身')));
  jian('值班者本体不再直接答活（没有“你是…的值班者”请求）', zhiBan.length === 0, zhiBan.length);
  jian('三轮都派了分身子代理', fenShen.length >= 3, { requests: qiu.length, fenShen: fenShen.length });
  jian('每轮只有一次分身启动（同一时间一个）', auditEvents.slice(auCong).filter((e) => e.op === 'group.duty-subagent-start').length === 3,
    auditEvents.slice(auCong).filter((e) => e.op === 'group.duty-subagent-start').length);
  const s = ORCH.sanCengXiaoXi({ inHistorySystemPrompt: 'SYS', appendedHistoryView: '', statusCard: 'KA', totalBudgetTokens: 0 }, [{ role: 'user', content: 'u' }]);
  const kong = ORCH.sanCengXiaoXi({ inHistorySystemPrompt: 'SYS', appendedHistoryView: '', statusCard: '', totalBudgetTokens: 0 }, [{ role: 'user', content: 'u' }]);
  jian('sanCengXiaoXi 顺序 = 系统 → 视图 → 卡片；没有卡片就不塞空 system', s.map((m) => m.content).join('>') === 'SYS>u>KA' && kong.length === 2);
}

console.log('\n⑦ 马尔可夫毯 O(任务规模)：用户发 20 万字');
{
  GONG_ZUO_QU = path.join(LINSHI, 'ws-big');
  fs.mkdirSync(GONG_ZUO_QU, { recursive: true });
  const QUN = 'proj-r48-big';
  const router = zaoQun(QUN, SAN);
  const cong = QINGQIU.length;
  const DA = '超长原话'.repeat(50000) + BIAO;
  await ORCH.xietiaoQunXiaoxi(zaoDeps(router, SAN, kou, []), CFG, { groupId: QUN, userId: 'u', urgency: 'P2', content: DA });
  const shou = [...qingQiuOf('牛马乙', cong), ...qingQiuOf('牛马丙', cong)].filter((q) => !q.messages.some((m) => m.role === 'tool'));
  const zi = shou.map((q) => q.messages.reduce((n, m) => n + String(m.content || '').length, 0));
  jian(`执行者首轮请求都在毯的档位内（≤ 2 万字，与原话 ${DA.length} 字无关）`, shou.length === 2 && zi.every((n) => n <= 20000) && DA.length > 20000 * 9, zi.join(' / '));
  jian('毯里说清楚原话没进全文、去哪里取（不是让模型猜）',
    shou.every((q) => /原话过长，未进毯的部分按序号回群日志取/.test(q.messages.map((m) => String(m.content)).join('\n'))));
}

fuWu.close();
try { svc.close(); } catch { /* noop */ }
try { fs.rmSync(LINSHI, { recursive: true, force: true }); } catch { /* noop */ }
const bai = jie.filter((x) => !x.ok);
console.log(`\n==== verify-r48-heiban：${jie.length - bai.length} ok / ${bai.length} FAIL ====`);
for (const x of bai) console.log('  FAIL ' + x.ming + (x.xiang ? ' —— ' + x.xiang.slice(0, 300) : ''));
process.exit(bai.length ? 1 : 0);
