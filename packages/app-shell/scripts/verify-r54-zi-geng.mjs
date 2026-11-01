/**
 * verify-r54-zi-geng.mjs（fast 档）—— 第 54 轮项 3「脱敏白名单自我更新」+ 一项**真缺陷修复**。
 *
 * 先说缺陷：`knowledge_query` / `knowledge_add` 以前**只有分发分支、没有工具声明** ⇒ 模型根本调不到它们
 * （提示词里写着"用 knowledge_add 记下来"，可是工具表里没有这个名字）。这一轮把三个工具都补进 `hostToolSpecs()`：
 * knowledge_query / knowledge_add / capability_propose。
 *
 * 白名单自更新的口径：
 *  · 模型可以提案**能力类别**（不是事实），宿主逐条校验（≤14 字、无数字/标点/对象名/存在性说法、必须带 1–6 个匹配关键词）；
 *  · 合并时非法/重复条目直接丢弃、总量封顶 32 条；
 *  · **k-匿名与"概要不含项目信息"两条硬闸不因自更新而放松** —— 新类别仍要 ≥2 条独立证据才会对外说。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const FM = await import(process.env.V54_FM ? pathToFileURL(process.env.V54_FM).href : U('packages/app-shell/dist/zhi-shi-fen-ceng.js'));
const WT = await import(process.env.V54_WT ? pathToFileURL(process.env.V54_WT).href : U('packages/app-shell/dist/work-tools.js'));
const MAIN = fs.readFileSync(process.env.V54_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };

// ── 1. 准入真值表 ────────────────────────────────────────────────
{
  const hao = FM.jianChaXinNengLi('音视频转写与字幕', ['转写', '字幕']);
  jian('一条合格的类别提案能通过（≤14 字、无数字/标点、带关键词）', hao.ok === true, JSON.stringify(hao.why));
  const huai = [
    ['空短语', '', ['转写']],
    ['超长', '一二三四五六七八九十一二三四五', ['转写']],
    ['带顿号', '转写、字幕', ['转写']],
    ['带数字', '转写3小时音频', ['转写']],
    ['带客户', '为客户甲做转写', ['转写']],
    ['存在性说法', '做过音频转写', ['转写']],
    ['带路径', 'C:\\a\\b 的转写', ['转写']],
    ['没有关键词', '音视频转写与字幕', []],
    ['关键词过长', '音视频转写与字幕', ['一二三四五六七八九十一二三']],
    ['关键词带数字', '音视频转写与字幕', ['转写2']],
    ['关键词是对象名', '音视频转写与字幕', ['客户甲']],
    ['关键词带标点', '音视频转写与字幕', ['转写,字幕']],
  ];
  for (const [biao, hua, ci] of huai) jian('拒绝：' + biao, FM.jianChaXinNengLi(hua, ci).ok === false, JSON.stringify(FM.jianChaXinNengLi(hua, ci).why));
  jian('重复类别被拒（内置的也算）', FM.jianChaXinNengLi(FM.NENG_LI_BIAO[0].hua, ['x1']).ok === false);
}

// ── 2. 合并表：非法丢弃、去重、封顶 ────────────────────────────────
{
  const he = FM.heBingNengLi([
    { hua: '音视频转写与字幕', ci: ['转写', '字幕'] },
    { hua: '音视频转写与字幕', ci: ['转写'] },
    { hua: '带3个数字的类别', ci: ['x1'] },
    { hua: '为客户甲干活', ci: ['x1'] },
    { hua: '空的', ci: [] },
  ]);
  const hua = he.map((x) => x.hua);
  jian('合法条目进表、重复只留一条、非法条目被丢弃',
    hua.filter((x) => x === '音视频转写与字幕').length === 1 && !hua.some((x) => /数字|客户甲|空的/.test(x)), hua.slice(-3).join(','));
  jian('合并表仍以内置 12 类打底（自更新不会把内置挤掉）',
    FM.NENG_LI_BIAO.every((x) => hua.includes(x.hua)) && he.length === FM.NENG_LI_BIAO.length + 1);
  const duo = Array.from({ length: 50 }, (_, i) => ({ hua: '额外类别' + String.fromCharCode(0x4e00 + i), ci: ['关键词' + String.fromCharCode(0x4e00 + i)] }));
  jian('总量封顶（默认最多再收 32 条；无限膨胀会稀释 k-匿名）',
    FM.heBingNengLi(duo).length <= FM.NENG_LI_BIAO.length + 32, FM.heBingNengLi(duo).length);
}

// ── 3. 自更新的类别仍受 k-匿名与禁现约束 ────────────────────────────
{
  const biao = FM.heBingNengLi([{ hua: '音视频转写与字幕', ci: ['转写', '字幕'] }]);
  const yi = '给客户甲把 3 小时的会议录音转写成字幕，报价 2000 元';
  const er = '另一单：把访谈音频转写并配字幕，交付 srt';
  jian('只有一条证据：新类别也不许对外说（k=2 不因自更新放松）',
    FM.paiShengDuiWaiGaiLao([yi], undefined, biao).ok === false);
  const r = FM.paiShengDuiWaiGaiLao([yi, er], undefined, biao);
  jian('两条独立证据：新类别可以对外说，且概要里没有价格/客户/数字',
    r.ok === true && r.gai.includes('音视频转写与字幕') && !/[0-9０-９]/.test(r.gai) && !/客户甲|报价/.test(r.gai), JSON.stringify(r));
  jian('合并表里的非法条目不能成为"绕过禁现"的后门（检查器用同一张表）',
    FM.heBingNengLi([{ hua: '报价与合同', ci: ['报价'] }]).every((x) => x.hua !== '报价与合同'));
}

// ── 4. 工具声明（这一轮修的真缺陷）─────────────────────────────────
{
  const ming = WT.hostToolSpecs().map((t) => t.function.name);
  jian('knowledge_query 真的声明成工具（以前只有分发分支，模型调不到）', ming.includes('knowledge_query'), ming.filter((x) => /knowledge|capab/.test(x)).join(','));
  jian('knowledge_add 真的声明成工具', ming.includes('knowledge_add'));
  jian('capability_propose 声明成工具，且描述里写明"仍需 2 条独立证据"',
    ming.includes('capability_propose') && /2 条（独立）?证据|至少 2 条/.test((WT.hostToolSpecs().find((t) => t.function.name === 'capability_propose') || { function: {} }).function.description || ''));
  const kg = WT.hostToolSpecs().find((t) => t.function.name === 'knowledge_query');
  jian('knowledge_query 的参数与分发分支对得上（query 必填）',
    !!(kg && kg.function.parameters.required.includes('query')), JSON.stringify(kg.function.parameters.required));
}

// ── 5. 接线：持久化、审计、坏文件容错 ──────────────────────────────
{
  jian('模型提案走分发分支（capability_propose）', /gongJuMing === 'capability_propose'/.test(MAIN));
  jian('落盘走 tmp+rename（半个文件比没文件更糟）', /const tmp = p \+ '\.tmp';/.test(MAIN) && /fs\.renameSync\(tmp, p\)/.test(MAIN));
  jian('启动时读取，坏文件按空表处理（不许挡住启动）',
    /function duNengLiWai\(\)[\s\S]{0,500}?catch \{ \/\* 坏文件按空表处理/.test(MAIN));
  jian('通过/拒绝都落审计（白名单变了要能查是谁加的）',
    /kb\.capability-added/.test(MAIN) && /kb\.capability-rejected/.test(MAIN));
  jian('派生概要与检查器都吃"合并表"（不是只在内置表上跑）',
    /paiShengDuiWaiGaiLao\(\[zhengLi[^\n]*nengLiBiao\(\)\)/.test(MAIN) && /paiShengDuiWaiGaiLao\(knowledge\.internal\.activeEvents\(\)[\s\S]{0,120}?nengLiBiao\(\)\)/.test(MAIN));
  jian('合并逻辑只在纯模块里（主进程不另写一套）',
    /heBingNengLi\(nengLiWai\)/.test(MAIN) && !/function heBingNengLi/.test(MAIN));
}

console.log(`==== verify-r54-zi-geng: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
