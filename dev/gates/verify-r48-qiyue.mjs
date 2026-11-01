/**
 * 第 48 轮 · 契约 v1.1「契约 = 现实」（fast 档）
 *
 * v1.0 的十二份契约冻结之后只有 group-router 用了 6 个类型，其余实现各写各的 ⇒ "冻结"停在纸面，
 * 同一个概念出现多份不一致的定义（证据锚点 3 份、群类型少一个值）。这支门禁把"接入"钉成可失败的判据：
 *  ① 每个导出类型三选一：被包外**直接 import 且真的用到**（或再导出）/ 被别的已消费契约引用（传递）/ 标【未落地】；
 *  ② 13 份契约每一份至少有一个类型被直接 import（整份没人用 = 又停回纸面）；
 *  ③ 包外不许另写同名类型（只许 import、extends 或起别名）；
 *  ④ 本包只许有类型：dist 里没有任何值；memory-os 的 dist 运行时不引用本包（子进程运行目录里没有它）；
 *  ⑤ 运行时形状 = 契约：recall 卡片 / retrieve 结果 / 看板事件 / 检查点 / 蒸馏结果 / 错误分类 / 执行者报错，
 *     契约里的**必填字段**在真实返回值上逐个核；
 *  ⑥ 错误分类表真值表（判据顺序、URL 剥离、状态码只认状态码的位置）；
 *  ⑦ 不变量 #9「权限过滤先于相关性」：外部群里模型自己调的 recall / retrieve 也只认本群记录（契约 RetrieveRequest.scope）。
 * 每一类判据都拿伪造夹具撞一次，必须翻红（证明断言有牙）。
 *
 * 用法：node dev/gates/verify-r48-qiyue.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Mod, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = (p) => pathToFileURL(path.join(GEN, p)).href;
const jie = [];
const jian = (ming, ok, xiang) => {
  jie.push({ ming, ok: ok === true });
  console.log(`${ok === true ? 'PASS' : 'FAIL'} ${ming}${xiang === undefined || xiang === '' ? '' : ' —— ' + String(xiang).slice(0, 400)}`);
};

const QIYUE_LU = path.join(GEN, 'packages/contracts/src/index.ts');
const QIYUE = fs.readFileSync(QIYUE_LU, 'utf8');

/* ───────────── 解析契约源 ───────────── */
function jieXiQiYue(src) {
  const fenDuan = [...src.matchAll(/\/\* ─+ (\d+)\. (.+?) ─+ \*\//g)].map((m) => ({ xu: Number(m[1]), ming: m[2].trim(), at: m.index }));
  const daoChu = [...src.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => ({ ming: m[1], at: m.index }));
  const lie = daoChu.map((d, i) => {
    const jieShu = Math.min(...[daoChu[i + 1]?.at ?? src.length, ...fenDuan.filter((f) => f.at > d.at).map((f) => f.at)]);
    const qian = src.slice(Math.max(0, ...daoChu.filter((x) => x.at < d.at).map((x) => x.at), ...fenDuan.filter((f) => f.at < d.at).map((f) => f.at)), d.at);
    const zhuShi = (qian.match(/\/\*\*[\s\S]*?\*\/\s*$/) || [''])[0];
    const duan = fenDuan.filter((f) => f.at < d.at).pop();
    return { ming: d.ming, ti: src.slice(d.at, jieShu), weiLuoDi: /【未落地】/.test(zhuShi), duan: duan ? `${duan.xu}. ${duan.ming}` : '?' };
  });
  return { fenDuan, lie };
}

/** 一个文件里从 @warmy/contracts 引进来的名字：[{ yuan, ben }]（ben = 本地名，起了别名就是别名） */
function yinRu(wen) {
  const chu = [];
  for (const m of wen.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@warmy\/contracts'/g)) {
    for (const x of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const y = x.replace(/^type\s+/, '');
      const [yuan, ben] = y.split(/\s+as\s+/).map((s) => s.trim());
      chu.push({ yuan, ben: ben || yuan, yuJu: m[0] });
    }
  }
  return chu;
}

/** 本地名在文件里（去掉 import 语句本身）是否真的用到；再导出（export type { X }）单独标出来 */
function yongDao(wen, ben) {
  const qu = wen.replace(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'@warmy\/contracts';?/g, '');
  const zaiDaoChu = new RegExp(`export\\s+type\\s*\\{[^}]*\\b${ben}\\b[^}]*\\}`).test(qu);
  const quDaoChu = qu.replace(/export\s+type\s*\{[^}]*\}\s*;?/g, '');
  return { yong: new RegExp(`\\b${ben}\\b`).test(quDaoChu), zaiDaoChu };
}

/** 包外的同名定义：只许是 = / extends 一个从契约引进来的本地名 */
function chongDingYi(wen, mingJi) {
  const ben = new Set(yinRu(wen).map((x) => x.ben));
  const chu = [];
  for (const m of wen.matchAll(/^[ \t]*(?:export\s+)?(?:declare\s+)?(interface|type|class|enum)\s+(\w+)\b([\s\S]{0,300})/gm)) {
    const [, lei, ming, hou] = m;
    if (!mingJi.has(ming)) continue;
    const tou = hou.split(/[{;]/)[0];
    const zhiXiang = [...tou.matchAll(/\b(\w+)\b/g)].some((x) => ben.has(x[1]));
    const heFa = (lei === 'type' && /^\s*(<[^>]*>)?\s*=/.test(hou) && zhiXiang) || (lei === 'interface' && /^\s*(<[^>]*>)?\s*extends\b/.test(hou) && zhiXiang);
    if (!heFa) chu.push(`${lei} ${ming}`);
  }
  return chu;
}

function bianLi(mu, chu = []) {
  for (const e of fs.readdirSync(mu, { withFileTypes: true })) {
    const p = path.join(mu, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'renderer', 'i18n', 'assets', 'vendor'].includes(e.name)) bianLi(p, chu); }
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) chu.push(p);
  }
  return chu;
}

/** 消费判定：直接（用到/再导出）→ 传递（被已消费契约的定义体引用）→ 未落地 */
function xiaoFei(qy, wenJian) {
  const mingJi = new Set(qy.lie.map((x) => x.ming));
  const zhiJie = new Map();
  const weiYong = [];
  for (const [lu, wen] of wenJian) {
    for (const x of yinRu(wen)) {
      if (!mingJi.has(x.yuan)) continue;
      const y = yongDao(wen, x.ben);
      if (y.yong || y.zaiDaoChu) {
        const l = zhiJie.get(x.yuan) || [];
        l.push(path.relative(GEN, lu).replace(/\\/g, '/') + (y.yong ? '' : '（再导出）'));
        zhiJie.set(x.yuan, l);
      } else weiYong.push(`${x.yuan} @ ${path.relative(GEN, lu)}`);
    }
  }
  const chuanDi = new Set(zhiJie.keys());
  for (let gai = true; gai;) {
    gai = false;
    for (const t of qy.lie) {
      if (!chuanDi.has(t.ming)) continue;
      for (const u of qy.lie) {
        if (!chuanDi.has(u.ming) && u.ming !== t.ming && new RegExp(`\\b${u.ming}\\b`).test(t.ti.replace(/^export (?:interface|type) \w+/, ''))) { chuanDi.add(u.ming); gai = true; }
      }
    }
  }
  const meiRen = qy.lie.filter((t) => !chuanDi.has(t.ming) && !t.weiLuoDi).map((t) => t.ming);
  return { zhiJie, chuanDi, meiRen, weiYong };
}

console.log('\n① / ② / ③ 消费点与重复定义');
const PKG = path.join(GEN, 'packages');
const WEN_JIAN = [];
for (const b of fs.readdirSync(PKG)) {
  if (b === 'contracts') continue;
  const src = path.join(PKG, b, 'src');
  if (!fs.existsSync(src)) continue;
  for (const f of bianLi(src)) WEN_JIAN.push([f, fs.readFileSync(f, 'utf8')]);
}
const QY = jieXiQiYue(QIYUE);
const XF = xiaoFei(QY, WEN_JIAN);
console.log(`     契约 ${QY.fenDuan.length} 份 · 导出类型 ${QY.lie.length} 个 · 直接消费 ${XF.zhiJie.size} · 传递 ${XF.chuanDi.size - XF.zhiJie.size} · 【未落地】 ${QY.lie.filter((t) => t.weiLuoDi).length}`);
jian(`契约份数 = 13（12 份 + 任务黑板），导出类型 ≥ 40`, QY.fenDuan.length === 13 && QY.lie.length >= 40, QY.fenDuan.map((f) => f.xu + '.' + f.ming).join(' / '));
jian('每个导出类型都有着落：直接消费 / 传递引用 / 标【未落地】（没有"冻结在纸面"的类型）', XF.meiRen.length === 0, XF.meiRen.join(', ') || '全部有着落');
jian('import 进来的契约类型都真的用到了（不许为了凑消费点空 import）', XF.weiYong.length === 0, XF.weiYong.join('；') || '无空 import');
const meiFenDuan = QY.fenDuan.filter((f) => !QY.lie.some((t) => t.duan === `${f.xu}. ${f.ming}` && XF.zhiJie.has(t.ming)));
jian('13 份契约每一份至少有一个类型被包外直接 import', meiFenDuan.length === 0,
  meiFenDuan.map((f) => f.ming).join('、') || QY.fenDuan.map((f) => `${f.xu}:${QY.lie.filter((t) => t.duan === `${f.xu}. ${f.ming}` && XF.zhiJie.has(t.ming)).map((t) => t.ming).join('+')}`).join(' '));
const weiLuoDi = QY.lie.filter((t) => t.weiLuoDi);
jian('标【未落地】的类型确实没人 import（标了未落地却在用 = 标错了）', weiLuoDi.every((t) => !XF.zhiJie.has(t.ming)), weiLuoDi.map((t) => t.ming).join(','));
const MING_JI = new Set(QY.lie.map((x) => x.ming));
const chong = WEN_JIAN.flatMap(([lu, wen]) => chongDingYi(wen, MING_JI).map((x) => `${x} @ ${path.relative(GEN, lu)}`));
jian('包外没有另写的同名类型（只许 import / extends / 起别名）', chong.length === 0, chong.join('；') || '无');

console.log('\n   负向夹具（同一套判据必须能翻红）');
{
  const jia = QIYUE + '\n/* ─── 14. 假的 ─── */\nexport interface WuRenYong { a: string }\n/** 【未落地】假的设计 */\nexport interface BiaoLeWeiLuoDi { b: string }\n';
  const qy2 = jieXiQiYue(jia);
  const xf2 = xiaoFei(qy2, WEN_JIAN);
  jian('负向：新加一个没人用、也没标未落地的类型 ⇒ 被点名；标了【未落地】的不被点名',
    xf2.meiRen.includes('WuRenYong') && !xf2.meiRen.includes('BiaoLeWeiLuoDi'), xf2.meiRen.join(','));
  const kong = xiaoFei(QY, [['C:/假/a.ts', "import type { Jinji } from '@warmy/contracts';\nconst x = 1;\n"]]);
  jian('负向：import 了却没用 ⇒ 记为空 import', kong.weiYong.some((s) => s.startsWith('Jinji')), kong.weiYong.join(';'));
  const zaiDao = xiaoFei(QY, [['C:/假/b.ts', "import type { Jinji } from '@warmy/contracts';\nexport type { Jinji };\n"]]);
  jian('再导出算消费（包的公开类型就是契约本身），但单独标出来', (zaiDao.zhiJie.get('Jinji') || []).some((s) => /再导出/.test(s)));
  const huai = chongDingYi('export interface ZhengjuMaodian { file: string }\n', MING_JI);
  const huai2 = chongDingYi("import type { QunLei as Q } from '@warmy/contracts';\nexport type QunLei = 'internal' | 'external';\n", MING_JI);
  const hao = chongDingYi("import type { ZhengjuMaodian as Q, RecallCard as R } from '@warmy/contracts';\nexport type ZhengjuMaodian = Q;\nexport interface RecallCard extends R { x: number }\nexport type QunLei = Extract<Q, 'a'>;\n", MING_JI);
  jian('负向：包外另写一份 ZhengjuMaodian / 自己写死 QunLei ⇒ 被点名；别名、extends、Extract<契约> 放行',
    huai.length === 1 && huai2.length === 1 && hao.length === 0, JSON.stringify({ huai, huai2, hao }));
}

console.log('\n④ 本包只许有类型');
{
  const qd = fs.readFileSync(path.join(GEN, 'packages/contracts/dist/index.js'), 'utf8');
  const youZhi = /\bexport\s+(const|let|var|function|class|default)\b|Object\.defineProperty\(exports|module\.exports/.test(qd);
  jian('contracts/dist/index.js 里没有任何值（只有 export {}）', !youZhi && /export\s*\{\s*\}/.test(qd), qd.slice(0, 120).replace(/\n/g, ' ⏎ '));
  const moDist = path.join(GEN, 'packages/memory-os/dist');
  const yin = fs.readdirSync(moDist).filter((f) => f.endsWith('.js')).filter((f) => /['"]@warmy\/contracts['"]/.test(fs.readFileSync(path.join(moDist, f), 'utf8')));
  jian('memory-os 的 dist 运行时不引用 @warmy/contracts（子进程运行目录里没有它；只许 import type）', yin.length === 0, yin.join(',') || '无运行时引用');
  const jiaDist = "import { Jinji } from '@warmy/contracts';\nexport const a = 1;\n";
  jian('负向：值导出 / 运行时 import 的样本会被同一判据抓到',
    /\bexport\s+(const|let|var|function|class|default)\b/.test(jiaDist) && /['"]@warmy\/contracts['"]/.test(jiaDist));
}

console.log('\n⑤ 运行时形状 = 契约（必填字段逐个核）');
/** 从契约源里取某个 interface 的**必填顶层字段**（含 extends 的父接口） */
function biTian(ming, qy = QY) {
  const t = qy.lie.find((x) => x.ming === ming);
  if (!t) return [];
  const fu = (t.ti.match(/^export interface \w+ extends (\w+)/) || [])[1];
  const ziDuan = [...t.ti.matchAll(/^ {4}(\w+)(\?)?:/gm)].filter((m) => !m[2]).map((m) => m[1]);
  return [...new Set([...(fu ? biTian(fu, qy) : []), ...ziDuan])];
}
function lianHe(ming) {
  const t = QY.lie.find((x) => x.ming === ming);
  return t ? [...t.ti.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]) : [];
}
const queZiDuan = (obj, ming) => biTian(ming).filter((k) => !(obj && typeof obj === 'object' && k in obj));
{
  jian('负向：字段核对器对缺字段的对象会报出来', queZiDuan({ seq: 1 }, 'RecallCard').length >= 4 && biTian('KanbanShi').includes('biaoTi'),
    `RecallCard 必填 ${biTian('RecallCard').join(',')} · KanbanShi 必填 ${biTian('KanbanShi').join(',')}`);
  const SQ = [
    path.join(GEN, 'packages/memory-os/vendor/better-sqlite3'),
    path.join(GEN, 'node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3'),
    path.join(GEN, 'node_modules/better-sqlite3'),
  ];
  const yuan = Mod._resolveFilename;
  Mod._resolveFilename = function (q, ...rest) {
    if (q === 'better-sqlite3') {
      for (const h of SQ) { const er = path.join(h, 'lib', 'index.js'); if (fs.existsSync(er)) return yuan.call(Mod, er, ...rest); }
    }
    return yuan.call(this, q, ...rest);
  };
  let sqOk = true;
  try { const D = createRequire(path.join(GEN, 'packages/memory-os/package.json'))('better-sqlite3'); new D(':memory:').close(); } catch { sqOk = false; }
  const LS = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r48q-'));
  if (!sqOk) {
    jian('记忆服务运行时形状（需要 better-sqlite3 原生绑定）', false, '环境缺件：取不到可用的 better-sqlite3');
  } else {
    const { JiyiCangFuwu } = await import(dist('packages/memory-os/dist/index.js'));
    const svc = new JiyiCangFuwu({ CangLu: path.join(LS, 'mem') });
    svc.append({ id: 'm-q-1', sessionId: 's-q', kind: 'message', role: 'user', ti: '契约核对用的一条消息：紫色长颈鹿在跳舞' }, 'duty');
    const ka = svc.recall('紫色长颈鹿', 5)[0];
    jian('recall 返回的卡片 ⊇ 契约 RecallCard 必填字段，source ∈ HuisuoLaiyuan，anchor ⊇ ZhengjuMaodian',
      !!ka && queZiDuan(ka, 'RecallCard').length === 0 && lianHe('HuisuoLaiyuan').includes(ka.source) && queZiDuan(ka.anchor, 'ZhengjuMaodian').length === 0,
      ka ? `缺 ${queZiDuan(ka, 'RecallCard').join(',') || '无'} · source=${ka.source} · anchor 缺 ${queZiDuan(ka.anchor, 'ZhengjuMaodian').join(',') || '无'}` : '没有召回到');
    const hui = svc.retrieve({ recordId: 'm-q-1' });
    jian('retrieve 返回 ⊇ 契约 JiansuoJieguo 必填字段，hitLevel 合法，原文逐字',
      !!hui && queZiDuan(hui, 'JiansuoJieguo').length === 0 && ['exact', 'nearby', 'fuzzy'].includes(hui.hitLevel) && hui.raw.includes('紫色长颈鹿'),
      hui ? `缺 ${queZiDuan(hui, 'JiansuoJieguo').join(',') || '无'} · hitLevel=${hui.hitLevel} · via=${hui.via}` : 'null');
    svc.close();
  }
  const { KanbanCang, JieLing } = await import(dist('packages/board/dist/index.js'));
  const kb = new KanbanCang(path.join(LS, 'board'));
  const ling = JieLing('新建任务: 契约核对', 'g-q');
  const shi = ling ? kb.append(ling, 'duty') : null;
  jian('看板事件 ⊇ 契约 KanbanShi（含 KanbanLing）必填字段，action ∈ KanbanLingLei',
    !!shi && queZiDuan(shi, 'KanbanShi').length === 0 && lianHe('KanbanLingLei').includes(shi.action), shi ? JSON.stringify(shi) : '没解析出指令');
  const { JianChaDianCang } = await import(dist('packages/app-shell/dist/checkpoint.js'));
  const cp = new JianChaDianCang(path.join(LS, 'cp')).create({ phase: 'round_end', logSeq: 7 });
  jian('检查点 ⊇ 契约 JianchadianZengliang 必填字段，strategy ∈ cow/shadow',
    queZiDuan(cp, 'JianchadianZengliang').length === 0 && ['cow', 'shadow'].includes(cp.strategy), JSON.stringify({ id: cp.id, phase: cp.phase, logSeq: cp.logSeq, strategy: cp.strategy, dir: cp.dir }));
  const ZL = await import(dist('packages/app-shell/dist/zheng-liu.js'));
  const zl = ZL.zhengLiu({ taskId: 't', jiaoFu: null, zhengWen: '好。', youGongJu: false, heShi: () => '', stats: { durationMs: 0, promptTokens: 0, completionTokens: 0 } });
  jian('蒸馏结果 ⊇ 契约 GongzuozheJieguo 必填字段，laiYuan 是契约里的三档之一',
    queZiDuan(zl.jieGuo, 'GongzuozheJieguo').length === 0 && ['jiao_fu', 'json', 'zheng_wen'].includes(zl.jieGuo.laiYuan), Object.keys(zl.jieGuo).join(','));
  const EXE = await import(dist('packages/app-shell/dist/executor.js'));
  const bi = await EXE.yunxingDuanCunhuoZhixingqi({ taskId: 't-err', brief: 'x', contextItems: [] }, { presetId: 'fake-closed', apiKey: 'k', baseURL: 'http://127.0.0.1:9/v1', model: 'm', protocol: 'openai-compatible' });
  jian('执行者报错 = 契约 GuileiCuowu（归了类、带 recoverable），连不上不会被当成"上下文超限"',
    !!bi.error && queZiDuan(bi.error, 'GuileiCuowu').length === 0 && lianHe('CuowuLeibie').includes(bi.error.category) && bi.error.category !== 'CONTEXT_OVERFLOW' && bi.error.category !== 'UNKNOWN',
    bi.error ? `${bi.error.category} / ${bi.error.code} / recoverable=${bi.error.recoverable} / ${String(bi.error.message).slice(0, 80)}` : '没报错？');

  console.log('\n⑦ 不变量 #9「权限过滤先于相关性」：模型自己调的 recall / retrieve 也守作用域');
  if (sqOk) {
    const { JiyiCangFuwu } = await import(dist('packages/memory-os/dist/index.js'));
    const MC = await import(dist('packages/app-shell/dist/memory-client.js'));
    const svc = new JiyiCangFuwu({ CangLu: path.join(LS, 'mem9') });
    const wai = svc.append({ id: 'm-wai-1', sessionId: 'g-wai', groupId: 'g-wai', kind: 'message', role: 'user', ti: '外部群里说的：蓝色鲸鱼今天来开会', entityType: 'chat' }, 'duty');
    const si = svc.append({ id: 'm-si-1', sessionId: 'inst-si', groupId: 'inst-si', kind: 'message', role: 'user', ti: '私聊里说的：蓝色鲸鱼的保险箱密码是 7788', entityType: 'chat' }, 'duty');
    /** 与记忆服务 IPC 处理器同形的客户端（recall / recallScoped / retrieve 的回包形状都照 IPC） */
    const keHu = {
      isReady: true,
      recall: async (q, limit) => ({ ok: true, cards: (await svc.recallDetailed({ query: q, limit })).cards }),
      recallScoped: async (q, limit, scope) => ({ ok: true, cards: (await svc.recallDetailed({ query: q, scope, limit })).cards }),
      retrieve: async (anchor, opts) => ({ ok: true, result: svc.retrieve(anchor, opts || {}) }),
    };
    const diao = (name, args, scope) => MC.yunxingJiyiCangGongju(keHu, { id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } }, { maxChars: 4000, ...(scope ? { scope } : {}) });
    const SC = { groupId: 'g-wai' };
    const r1 = await diao('recall', { query: '蓝色鲸鱼' }, SC);
    const r2 = await diao('recall', { query: '蓝色鲸鱼' });
    jian('外部群作用域下 recall 只召回本群（私聊里的话召不出来）；不给作用域时照旧全局（单聊跨会话"永远记得"）',
      r1.ok && r1.content.includes('m-wai-1') && !r1.content.includes('m-si-1') && r2.content.includes('m-si-1'),
      `作用域内：${r1.content.split('\n').filter((l) => /recordId=/.test(l)).map((l) => l.match(/recordId=(\S+)/)?.[1]).join(',')}`);
    const q1 = await diao('retrieve', { recordId: 'm-si-1' }, SC);
    const q2 = await diao('retrieve', { seq: si.seq }, SC);
    const q3 = await diao('retrieve', { recordId: 'm-si-1' });
    jian('外部群作用域下拿着别处的 recordId / seq 直接 retrieve 也取不到私聊原文（解引用侧同样守作用域）',
      !q1.content.includes('7788') && !q2.content.includes('7788') && q3.content.includes('7788'),
      `recordId → ${q1.ok ? '命中' : '拒'}：${q1.content.slice(0, 60)} ｜ seq → ${q2.content.slice(0, 60)}`);
    jian('负向：记忆服务层不给作用域 ⇒ 私聊原文取得到；给了外部群作用域 ⇒ 精确命中被判作用域外',
      String(svc.retrieve({ recordId: 'm-si-1' })?.raw || '').includes('7788')
      && !String(svc.retrieve({ recordId: 'm-si-1' }, { scope: SC, huiTui: 'exact' })?.raw || '').includes('7788')
      && String(svc.retrieve({ recordId: 'm-wai-1' }, { scope: SC })?.raw || '').includes('蓝色鲸鱼') && wai.seq > 0);
    const zhu = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
    jian('主进程接线：单聊/群聊路径的记忆工具带上会话作用域（外部群 ⇒ 本群；查不出群类型时收窄而不是放开）',
      /yunxingJiyiCangGongju\(memory, call, \{ maxChars: ctx\.zuiDaJieGuoZiShu, scope: jiYiZuoYongYu\(/.test(zhu)
      && /lei === 'external' \? \{ groupId: sid \} : undefined/.test(zhu) && /catch \{\s*return \{ groupId: sid \};/.test(zhu));
    svc.close();
  } else {
    jian('不变量 #9 作用域（需要 better-sqlite3）', false, '环境缺件');
  }
  try { fs.rmSync(LS, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log('\n⑥ 错误分类表真值表');
{
  const { fenLeiCuoWu, shiShangXiaWenChaoXian, SHANG_XIA_WEN_CHAO_XIAN, LEI_BIE_MING } = await import(dist('packages/app-shell/dist/cuowu-fenlei.js'));
  const biao = [
    ['HTTP 401 Unauthorized: invalid api key', 'PERMISSION_DENIED', false],
    ['invalid token', 'PERMISSION_DENIED', false],
    ['Error: token has expired', 'PERMISSION_DENIED', false],
    ['invalid token count in request', 'CONTEXT_OVERFLOW', true],
    ['Your request was rejected because it was considered high risk', 'MODERATION_BLOCKED', true],
    ['absolute-path-not-allowed: C:/x', 'BOUNDARY_VIOLATION', false],
    ['memory ipc timeout', 'IPC_DEAD', true],
    ["This model's maximum context length is 65536 tokens", 'CONTEXT_OVERFLOW', true],
    ['400 request exceeds the available context size', 'CONTEXT_OVERFLOW', true],
    ['ETIMEDOUT 10.0.0.1:443', 'PROTO_TIMEOUT', true],
    ['fetch failed https://token-plan-cn.xiaomimimo.com/v1/chat/completions', 'MODEL_UNAVAILABLE', true],
    ['status: 503 Service Unavailable', 'MODEL_UNAVAILABLE', true],
    ['seq 401 没找到', 'UNKNOWN', true],
    ['完全看不懂的报错', 'UNKNOWN', true],
  ];
  const cuo = biao.map(([w, lei, hf]) => ({ w, lei, hf, r: fenLeiCuoWu(new Error(w)) })).filter((x) => x.r.category !== x.lei || x.r.recoverable !== x.hf);
  jian('14 行真值表：判据顺序（鉴权/风控/越界/IPC 先于超限）、URL 先剥离、状态码只认状态码的位置、可恢复性',
    cuo.length === 0, cuo.map((x) => `「${x.w}」→${x.r.category}/${x.r.recoverable}（应 ${x.lei}/${x.hf}）`).join('；') || '全部符合');
  const jiu = (w) => SHANG_XIA_WEN_CHAO_XIAN.test(w);
  jian('负向对照：旧判据（裸正则）会把"连不上 token-plan 端点"和"invalid token"都当成上下文超限去收缩重试',
    jiu('fetch failed https://token-plan-cn.xiaomimimo.com/v1') && jiu('invalid token')
    && !shiShangXiaWenChaoXian(new Error('fetch failed https://token-plan-cn.xiaomimimo.com/v1')) && !shiShangXiaWenChaoXian(new Error('invalid token')));
  const tiShi = fenLeiCuoWu('x', { category: 'WORKER_CRASH' });
  jian('调用方已确定的类别以它为准（执行者整段崩了 ⇒ WORKER_CRASH）', tiShi.category === 'WORKER_CRASH' && tiShi.recoverable === true);
  const quan = lianHe('CuowuLeibie');
  jian('每个类别都有给用户看的名字（契约里加了类别、这里没跟上会红）', quan.length >= 12 && quan.every((k) => typeof LEI_BIE_MING[k] === 'string' && LEI_BIE_MING[k]), quan.filter((k) => !LEI_BIE_MING[k]).join(','));
  const zh = JSON.parse(fs.readFileSync(path.join(GEN, 'packages/app-shell/src/i18n/zh-CN.json'), 'utf8'));
  jian('每个类别都有 i18n 键 err.category.*（界面按语言包出，不写死中文）', quan.every((k) => typeof zh[`err.category.${k}`] === 'string'), quan.filter((k) => !zh[`err.category.${k}`]).join(','));
}

const bai = jie.filter((x) => !x.ok);
console.log(`\n==== verify-r48-qiyue：${jie.length - bai.length} ok / ${bai.length} FAIL ====`);
for (const x of bai) console.log('  FAIL ' + x.ming);
process.exit(bai.length ? 1 : 0);
