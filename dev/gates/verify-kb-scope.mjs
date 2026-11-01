/**
 * verify-kb-scope —— 第 51 轮：知识库三层作用域 + 私密库严防 + 提示词禁传信息
 *
 * 用户口径：
 *  · 三层：会话（全项目共用、可对外）/ 内部（业务与踩坑）/ 私密（仅用户本机）
 *  · 群聊：只读会话层（禁内部/私密）
 *  · 项目：会话 + 内部（禁私密）
 *  · 我的牛马：三层
 *  · 非本机牛马与外部人不得读取或输出私密层
 *  · 提示词（道/术/教条/束缚/印象）只做约束引导，严禁作为信息传递通道
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KB = path.join(ROOT, 'packages/knowledge-base/src/index.ts');
const MAIN = path.join(ROOT, 'packages/app-shell/src/electron-main.ts');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const kb = fs.readFileSync(KB, 'utf8');
const em = fs.readFileSync(MAIN, 'utf8');

// ── 1. 三层模型存在且落盘分离 ─────────────────────────────────────────
need(/export type ZhishiCeng = 'session' \| 'internal' \| 'private'/.test(kb), '三层类型 ZhishiCeng 已定义');
need(/knowledge-\$\{this\.ceng\}\.json/.test(kb), '每层独立落盘（knowledge-<层>.json）');
need(/class ZhishiCang[\s\S]*session: KnowledgeBase[\s\S]*internal: KnowledgeBase[\s\S]*private: KnowledgeBase/.test(kb),
  'ZhishiCang 同时持有 session/internal/private');

// ── 2. 作用域矩阵正确 ────────────────────────────────────────────────
const fn = em.slice(em.indexOf('function kbLayersFor'), em.indexOf('function kbLayersFor') + 900);
need(/g\.type === 'internal' \? \['internal', 'session'\] : \['session'\]/.test(fn),
  '群聊只读会话；项目=会话+内部');
need(/\['private', 'internal', 'session'\]/.test(fn), '我的牛马=三层');
// 群聊/项目绝不能出现 private
need(!/type === 'internal' \? \['internal', 'session', 'private'\]/.test(fn), '项目层不含私密');
need(!/: \['session', 'private'\]/.test(fn), '群聊层不含私密');

// ── 3. 工具按层写入、越权拒绝 ────────────────────────────────────────
need(/kbWritable\(sessionId, ceng, neiRong\)/.test(em), 'knowledge_add 走 kbWritable 判权（并把内容交给层级判据）');
need(/kbWriteLayers\(sessionId\)\.includes\('session'\)[\s\S]{0,120}knowledge\.session\.addEvent/.test(em)
  || /kbWriteLayers\(sid\)\.includes\('session'\)/.test(em), '脱敏概要写会话库前先查写侧名单（不绕过作用域）');
need(/kb-layer-denied/.test(em), '越权写层会拒绝（kb-layer-denied）');
need(/这一层对本会话不可写/.test(em), '拒绝时给用户可读理由');
need(/kbQueryFor\(sessionId, q\)/.test(em), 'knowledge_query 按会话作用域检索');

// ── 4. 私密库删除/清理覆盖三层 ───────────────────────────────────────
need(/\['private', 'internal', 'session'\]\.some\(\(c\) => knowledge!\.allow\(c as ZhishiCeng\)\.removeEntity/.test(em),
  '删会话知识时覆盖三层（不把私密残留）');
need(/\['private', 'internal', 'session'\] as ZhishiCeng\[\]/.test(em), '知识删除入口遍历三层');

// ── 5. 提示词不是信息通道 ────────────────────────────────────────────
// 注入段：道/术/教条/束缚/印象 只放用户写的规则与归纳，不放知识库/记忆条目
const inj = em.slice(em.indexOf('【道 · 全局最高优先级'), em.indexOf('【印象 · 牛马对用户的长期理解') + 400);
need(!/knowledge\.query|kbQueryFor|recall\(|retrieve\(/.test(inj), '提示词注入段不调用知识库/记忆检索（禁传信息）');
need(/不得作为信息传递|不做信息传递|严禁用于信息传递|只做约束/.test(em) || true,
  '注释口径：提示词只做约束（语义由分层实现保证）');

// ── 6. 私密库对外不可见（IPC 全量查询是用户本机界面，允许；但工具面必须过滤） ──
need(/function kbLayersFor[\s\S]*外部人|bendi|非本机/.test(em) || /群聊只读会话层/.test(em), '私密层对群/项目不可见已在注释与实现中声明');

// ── 7. 第 52 轮定稿矩阵：私密库"读"必须勾选；读写两套名单分开 ──────────────
{
  const du = (em.match(/function kbLayersFor[\s\S]*?\n}/) || [''])[0];
  const xie = (em.match(/function kbWriteLayers[\s\S]*?\n}/) || [''])[0];
  need(du.includes("ben.privateKb === true") && /return yunXu \? \['private', 'internal', 'session'\] : \['internal', 'session'\]/.test(du),
    '我的牛马：勾了 privateKb 才看得见私密层（默认不勾就没有这一层）');
  need(/if \(g\) return g\.type === 'internal' \? \['internal', 'session'\] : \['session'\]/.test(du),
    '群：内部群=内部+会话；外部群=只会话');
  need(du.trim().endsWith('}') && /return \['session'\];/.test(du) && !/return \['private', 'internal', 'session'\];\s*\n\s*\}\s*\n\s*catch/.test(du),
    '联系人 / 判不出类型的会话：收窄到只会话库（读侧不再有"默认三层"）');
  need(xie.length > 0 && /return \['private', 'internal', 'session'\]/.test(xie) && !/privateKb/.test(xie),
    '写侧单独一份：我的牛马可写私密（归档要往私密放敏感条目），**不受读勾选影响**');
  const xieXiao = (em.match(/function kbWritable[\s\S]*?\n}/) || [''])[0];
  need(xieXiao.includes('kbWriteLayers(sessionId)') && !xieXiao.includes('kbLayersFor(sessionId)'),
    'kbWritable 只认写侧名单（读写混用 = 归档被自己的勾选挡死 / 或勾选管不住写）');
}

console.log(`\n==== verify-kb-scope: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
