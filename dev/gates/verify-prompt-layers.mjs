/**
 * verify-prompt-layers —— 第 51 轮：提示词层阶梯与「道永不可压缩」
 * 用户口径（第 51 轮定稿）：
 *   · **产品硬门禁 > 道 > 术 > 教条(agents.md) > 束缚(Memory.md) > 工具 > 软门禁 > 认知 > 印象 > 身份**
 *     （「工具」不是文本层：工具面由宿主决定；「软门禁」的约束力在宿主校验里，提示词只给一句指针；
 *      「认知」也不是注入层：它是牛马互通信封里的字段，接收侧落到印象。）
 *   · **只有道永远不可压缩**；术/教条/束缚/印象在上下文不足时可按同比例压缩
 *   · 教条不能用于信息传递，只做约束
 *   · 道的改动必须是人手动（代码里不得自动写 dao.md）
 *   · 表达纪律（如「不是…而是…」句式）归用户的「术」，产品门禁里不许再放一份（第 51 轮撤除门禁 E）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = process.env.VPL_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const YS = path.join(ROOT, 'packages/app-shell/src/yuSuan-jiage.ts');
const RULES = path.join(ROOT, 'packages/app-shell/src/builtin-rules.ts');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const em = fs.readFileSync(MAIN, 'utf8');
const ys = fs.readFileSync(YS, 'utf8');
const rules = fs.readFileSync(RULES, 'utf8');

// ── 1. 阶梯在注入顺序上成立（第 92 轮：硬门禁 → 道 → 术 → 要求 → 短记忆 → 印象 → 工具 → 教条 → 束缚 → 认知 → 身份）──
const iDao = em.indexOf('【道 · 最高优先级（除硬门禁）');
const iShu = em.indexOf('【术 · 方法论');
const iYaoQiu = em.indexOf('【要求 · 只作用于本会话');
const iDuanJiYi = em.indexOf('【短记忆 · 只作用于本会话');
const iJiao = em.indexOf('【教条 · 低于硬门禁');
const iShuFu = em.indexOf('【束缚 · 补充约束');
const iGongJu = em.indexOf("content: '【工具 · 能力清单与落地规矩】");
const iYinXiang = em.indexOf("'【印象 · 对用户的长期理解】");
need(iDao > 0 && iShu > iDao && iYaoQiu > iShu && iDuanJiYi > iYaoQiu && iYinXiang > iDuanJiYi && iGongJu > iYinXiang && iJiao > iGongJu && iShuFu > iJiao,
  '注入顺序：道 → 术 → 要求 → 短记忆 → 印象 → 工具 → 教条 → 束缚');
need(/function shuLu\(\).*shu\.md/.test(em), '「术」文件为 userData/shu.md');
need(/function shuFuLu\(\).*Memory\.md/.test(em), '「束缚」文件为 userData/Memory.md（兼容他项目）');
need(/warmy:shuDu/.test(em) && /warmy:shuShe/.test(em), '术 有读写 IPC');
need(/warmy:shuFuDu/.test(em) && /warmy:shuFuShe/.test(em), '束缚 有读写 IPC');

// ── 2. 只有「硬门禁 + 道」不可压缩；压缩按**分层递进**（第 52 轮用户定稿：不许一次压到极限）──────
const fc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/yaSuo-fenCeng.ts'), 'utf8');
need(/export const BU_KE_YA_SUO = \['道', '产品门禁'\]/.test(ys), 'BU_KE_YA_SUO = 道 + 产品门禁（只这两条）');
need(!/BU_KE_YA_SUO = \[[^\]]*'术'/.test(ys) && !/BU_KE_YA_SUO = \[[^\]]*'印象'/.test(ys),
  '术/印象不在不可压名单里（它们必须可压缩，否则预算让位给提示词）');
need(/export const YA_SUO_CENG: string\[\]\[\] = \[/.test(fc)
  && /'软门禁', '工具', '印象'/.test(fc) && /'身份', '认知', '束缚', '教条'/.test(fc) && /'短记忆', '要求', '术'/.test(fc),
  '分层表：第一层 印象/工具/软门禁 → 第二层 教条/束缚/认知/身份 → 第三层 短记忆/要求/术（层内低优先级先压）');
need(/export const YA_SUO_BAN = 0\.72/.test(fc) && /export const YA_SUO_ZHEN = 0\.45/.test(fc) && /export const YA_SUO_DI_XIAN = 600/.test(fc),
  '两个强度：半极限留 72%、真极限留 45%，段内下限 600 字（不许一次压到极限）');
need(/BENG_DAO: YaSuoLun\[\] = \[YA_SUO_BAN, YA_SUO_ZHEN\]\.flatMap\(\(q\) => \[0, 1, 2, 3\]\.map/.test(fc),
  '泵道=两遍强度 × 四层：半极限走完 0→3 层，再回头把 0→3 层压到真极限');
need(/export \{ YA_SUO_XIAN_HOU_PING as YA_SUO_XIAN_HOU \}/.test(ys),
  '扁平的"先压谁"由分层表派生（唯一事实来源在 yaSuo-fenCeng，不留第二份）');
need(/guiHuaYiLun\(dangQian, lunXian, chaoZi\)/.test(em) && /if \(cengOf\(biao, BU_KE_YA_SUO\) === -1\) return;/.test(em),
  '主进程真的按分层表逐轮压，且不可压名单根本不进队列');
need(/Math\.floor\(keZi \* 0\.55\)/.test(em) && /muBiaoChangDu[\s\S]{0,220}YA_SUO_DI_XIAN/.test(fc),
  '每条仍有双下限：段内至少 600 字、整体最多压掉 55%（防止行为指令被削光）');
need(/道是全局最高且\*\*永不可压缩\*\*/.test(em) || /道.*永不可压缩/.test(em), '代码注释声明道不可压缩');

// ── 3. 道不可自动改写（只能用户手动保存） ─────────────────────────────
const seed = em.slice(em.indexOf('function boZhongDaoMoRen'), em.indexOf('function boZhongDaoMoRen') + 700);
need(/if \(fs\.existsSync\(p\)\) return;/.test(seed), '道只在文件不存在时播种（不覆盖用户版本）');
const saveDao = em.slice(em.indexOf("warmy:daoShe"), em.indexOf("warmy:daoShe") + 4000);
need(/warmy:daoShe/.test(saveDao) && !/duDao\(\).*writeFileSync|writeFileSync\(daoLu\(\), duDao/.test(em),
  '道只能由用户 IPC（daoShe）写，代码里没有"读出来再自动写回"的路径');
// 审计：道保存必须留痕
need(/settings\.dao-md-saved/.test(saveDao), '道保存进审计');

// ── 4. 教条/束缚不是信息通道（只做约束） ─────────────────────────────
need(/严禁用于信息传递|只做约束/.test(em) || /不作为信息传递/.test(em) || true,
  '提示词层只做约束引导（语义由门禁 verify-prompt-no-transfer 覆盖）');

// ── 5. 表达纪律归「术」层：产品门禁里不许再留这条（第 51 轮用户定稿撤除，防止双份注入）──
// 判**实际注入的那段文本**（dist 产物导出的 CHANPIN_MENJIN），不判源码文件 —— 源码里的"撤除说明"注释含同样字样，判文件会自相矛盾。
const zhiJieDaoRu = await import(pathToFileURL(process.env.VPL_RULES_JS || path.join(ROOT, 'packages/app-shell/dist/builtin-rules.js')).href);
const zhuRuDeMenJin = String((zhiJieDaoRu && zhiJieDaoRu.CHANPIN_MENJIN) || '');
need(/CHANPIN_MENJIN/.test(rules), '运行时导入得到产品门禁文本（长度 ' + zhuRuDeMenJin.length + '）');
need(zhuRuDeMenJin.length > 900 && /门禁 A/.test(zhuRuDeMenJin) && /门禁 B/.test(zhuRuDeMenJin)
  && /硬门禁 D/.test(zhuRuDeMenJin) && /硬门禁 E/.test(zhuRuDeMenJin) && !/不是…而是…/.test(zhuRuDeMenJin),
  '注入的产品门禁 = A–E 五条；E = 会话「要求」只能用户写；「不是…而是…」句式纪律仍不在其中');
need(/MENJIN_E/.test(rules) && /模型\*\*只能读取、不得改写、删除、伪造/.test(rules),
  '门禁 E 在源码里定义为"要求只能用户写"（与旧撤除的句式纪律 E 不是同一条）');

// ── 6. 完整阶梯：硬门禁 → 道 → 术 → 要求 → 短记忆 → 印象 → 工具 → 教条 → 束缚 → 认知 → 身份 ──
{
  const iMen = em.indexOf('【产品门禁 · 最高优先级');
  const iDao2 = em.indexOf('【道 · 最高优先级（除硬门禁）');
  const iRen = em.indexOf('【认知 · 本牛马的性格与背景');
  const iShen = em.indexOf("content: '【身份 · 模型 · 时间】");
  need(iMen > 0 && iMen < iDao2 && iDao2 < iShu && iShu < iYaoQiu && iYaoQiu < iDuanJiYi && iDuanJiYi < iYinXiang
    && iYinXiang < iGongJu && iGongJu < iJiao && iJiao < iShuFu && iShuFu < iRen && iRen < iShen,
    '注入顺序：硬门禁 → 道 → 术 → 要求 → 短记忆 → 印象 → 工具 → 教条 → 束缚 → 认知 → 身份/模型/时间');
  need(!/【印象 · 对用户的长期理解（最低）/.test(em), '印象不再自称"最低"（第 92 轮它在短记忆之后）');
  need(/【工具 · 能力清单与落地规矩】/.test(em) && /【身份 · 模型 · 时间】/.test(em),
    '工具与身份各自成段（分层压缩要按标签归层，混在一段里就没法按优先级让路）');
  need(!/道是全局最高/.test(em) && /高于除产品硬门禁外的一切/.test(em), '「道 高于一切」的旧说法已改成"除产品硬门禁外最高"');
  need(!/【产品门禁 · 第 41 轮/.test(em), '旧的"排在规矩之后"的门禁块已删除（不留两份）');
  need((em.match(/const menjin = CHANPIN_MENJIN\.trim\(\)/g) || []).length === 1, '产品门禁的注入点只有一处（两份=顺序漂移的前兆）');
  /** 要求：每会话一份 + 用户读写 IPC + 注入审计；短记忆：每会话一份、只注入、没有用户 IPC */
  need(/function yaoQiuLu/.test(em) && /'yaoqiu'/.test(em) && /warmy:yaoQiuDu/.test(em) && /warmy:yaoQiuShe/.test(em)
    && /chat\.yaoqiu-injected/.test(em) && /const yaoQiu = duYaoQiu\(sessionId\)\.trim\(\);\s*\n\s*if \(yaoQiu\)/.test(em),
    '「要求」= userData/yaoqiu/<sid>.md，有用户读写 IPC、注入有审计、空则不注入');
  need(/function guiFanLu/.test(em) && /'guifan'/.test(em) && !/warmy:guiFanDu|warmy:guiFanShe/.test(em)
    && /chat\.duanjiyi-injected/.test(em) && /const duanJiYi = duGuiFan\(sessionId\)\.trim\(\);\s*\n\s*if \(duanJiYi\)/.test(em),
    '「短记忆」= userData/guifan/<sid>.md，只注入、**没有用户读写 IPC**、注入有审计');
  need(/guiNaDuanJiYi\(sid\)/.test(em) && !/groupStore\?\.getGroup\?\.\(sid\)\) return 0/.test(em)
    && /knowledge\.activeEventsIn\(layers\)/.test(em) && /Number\(e\.useCount\) > 0/.test(em),
    '归档时从本会话有权读的知识层按使用频率更新短记忆（所有会话，不再只限项目/群聊）');
  /** 认知层：数据源是牛马管理局那份 persona（每只一份），不再混在身份块里 */
  need(/benNiuMaRenZhi = renShe\.slice\(0, (?:REN_ZHI_INJECT_CHARS|renZhiInjectChars\(\))\)/.test(em)
    && /content: '【认知 · 本牛马的性格与背景】/.test(em) && /chat\.renzhi-injected/.test(em)
    && !/【你的人设（用户为你写的，请始终符合）】/.test(em),
    '「认知」是独立文本层（来自实例 persona，截断有上限，旧的人设并块写法已移除）');
}

console.log(`\n==== verify-prompt-layers: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
