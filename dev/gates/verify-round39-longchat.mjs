/**
 * verify-round39-longchat.mjs —— 第 39 轮新增：**超长会话**门禁（用户点名的验收）
 *
 * 要验的产品承诺有两句：
 *  ① **注入的提示词永远不超过模型上下文** —— 不是"超了再压实重试"，而是每一轮发出去之前就有界；
 *  ② **永远记得说过的话** —— 被挤出视图的内容不是丢掉，而是留下可解引用的指针，且**开头/中间/最近三段都真能回忆起来**。
 *
 * 三段测试：
 *  S1 **批量轮**（纯本地、不调模型）：往真记忆服务里灌 `--rounds` 轮、每轮带一大块工具输出，
 *     把聊天记录推到 **≥10M token 量级**（按项目口径 1 token ≈ 1.6 字符）；
 *     每一轮都用**真渲染器**渲一次有界视图，断言 `视图字符 ≤ 预算字符` 恒成立、从不抛错。
 *  S2 **不丢**：条数对得上、JSONL 行数对得上；抽一批（含第 1 条 / 中间 / 最后一条）用
 *     `retrieve(recordId)` 取回**原文**；再**重开一个记忆服务**只读 JSONL 重建镜像，条数与原文仍一致。
 *  S3 **真召回**：在 开头 / 中间 / 最近 三个位置各埋独有暗号，用**真模型**（MiMo flash，`MIMO_KEY_FILE`）
 *     带着有界视图去问"第 X 轮的暗号是什么"。暗号若在视图里 ⇒ 直接答对；
 *     若已被挤出 ⇒ 必须先 recall/retrieve 才能答对 —— 两种都算数，**答不出来就是红**。
 *
 * 为什么不用假模型：②是"模型记不记得"，只有真模型能证伪；①是宿主的渲染契约，本地就够。
 * ⚠️ 脚本里不出现任何真实用户路径 / 密钥文件名（`verify-security` 连注释一起扫）；密钥只走 `MIMO_KEY_FILE`。
 *
 * 跑法：
 *   MIMO_KEY_FILE=<key 文件> node dev/gates/verify-round39-longchat.mjs                 # 默认 600 轮
 *   node dev/gates/verify-round39-longchat.mjs --rounds=40 --bigChars=8000 --quick      # 冒烟（不打真模型）
 *   node dev/gates/verify-round39-longchat.mjs --keep                                   # 保留临时数据目录
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const can = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  return argv.includes(`--${name}`) ? true : dflt;
};
const ROUNDS = Math.max(8, Number(can('rounds', 600)) || 600);
const BIG_CHARS = Math.max(200, Number(can('bigChars', 30000)) || 30000);
/** 模型窗口（保守值，用来把"字符预算"折成 token 再对照窗口）：本地 12.8k / 云 128k 都成立 */
const CHUANGKOU_TOKENS = Math.max(4096, Number(can('windowTokens', 120000)) || 120000);
const CHARS_PER_TOKEN = 1.6;
const QUICK = can('quick', false) === true;
const KEEP = can('keep', false) === true;
const MIMO_MODEL = String(can('mimoModel', 'mimo-v2.6-flash'));

const require = createRequire(import.meta.url);
/**
 * `memory-os` 里是 `require('better-sqlite3')`，而仓库根只装了 pnpm 存储、没把它链到
 * `packages/memory-os/node_modules/` ⇒ 直接 import 会 `MODULE_NOT_FOUND`
 * （`verify-memory-stress` 是靠打包应用自带的那份跑的）。
 * 这里在**进程内**给 CJS 解析器加一条兜底：先按原样解析，解不到就换成本仓库里那份
 * 已经为本机 node 编译好的 `spikes/node_modules/better-sqlite3`。不改仓库、不新增依赖。
 */
{
  const Module = require('node:module');
  const yuan = Module._resolveFilename;
  const houXuan = ['spikes/node_modules/better-sqlite3', 'packages/app-shell/vendor/better-sqlite3']
    .map((p) => path.join(ROOT, p)).filter((p) => fs.existsSync(p));
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'better-sqlite3' && houXuan.length) {
      try { return yuan.call(this, ...[request, ...rest]); } catch {
        for (const h of houXuan) { try { return yuan.call(this, h, ...rest); } catch { /* 换下一个 */ } }
      }
    }
    return yuan.apply(this, [request, ...rest]);
  };
}
const { xuanranYoujieShitu, DEFAULT_KEEP_HEAD, DEFAULT_KEEP_TAIL } = await import(
  pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/context-renderer.js')).href);
const { JiyiCangFuwu } = await import(pathToFileURL(path.join(ROOT, 'packages/memory-os/dist/index.js')).href);
const { CcrGateway } = await import(pathToFileURL(path.join(ROOT, 'packages/ccr-compressor/dist/index.js')).href);

let ok = 0;
const shi = [];
const jian = (ming, panding, xuan) => {
  if (panding) { ok += 1; return; }
  shi.push(ming + (xuan === undefined ? '' : '  ← ' + String(xuan).slice(0, 300)));
};

/** 预算：与主进程同一口径（字符 ≈ token × 1.6），再留 20% 给系统话/工具清单 */
const YU_SUAN_ZI = Math.floor(CHUANGKOU_TOKENS * CHARS_PER_TOKEN * 0.8);

const tmpJi = fs.mkdtempSync(path.join(os.tmpdir(), 'r39-longchat-'));
const ccrGateway = new CcrGateway({ maxChars: 4000 });
const svc = new JiyiCangFuwu({ CangLu: tmpJi });
const SID = 'r39-longchat';
const log = [];
let xuLie = 0;

/** 暗号锚点：位置 → 只在那里出现过的一次性字符串（错一个字符就算"忘了"） */
const MAO = new Map();
const anHao = (n) => `R39-${String(n).padStart(4, '0')}-${(n * 7919 % 9973).toString(36)}`;
const zhuiJia = [1, 2, 3, Math.floor(ROUNDS * 0.3), Math.floor(ROUNDS * 0.55), Math.floor(ROUNDS * 0.55) + 1, Math.floor(ROUNDS * 0.8), ROUNDS - 1, ROUNDS]
  .filter((n, i, a) => n >= 1 && n <= ROUNDS && a.indexOf(n) === i);
for (const n of zhuiJia) MAO.set(n, anHao(n));

const tuiLi = (lun) => '本轮第 ' + lun + ' 步：把用户要的这一段写进交付物，写完继续下一步，不重复已经写过的部分。';
const daKuai = (lun) => {
  const head = `[工具输出 第 ${lun} 轮] `;
  const body = ('第' + lun + '段·' + tuiLi(lun)).repeat(Math.ceil(BIG_CHARS / 40)).slice(0, BIG_CHARS - head.length);
  return head + body;
};

/* ───────────────────────── S1：批量轮，每轮渲染必须有界 ───────────────────────── */
const kaiShi = Date.now();
let zuiDaShiTuZi = 0;
let yiLiuZi = 0;
let chaoYu = 0;
let cuoWu = '';
let appendCiShu = 0;
let zhenDuanJiLu = [];
for (let lun = 1; lun <= ROUNDS; lun++) {
  const mao = MAO.get(lun);
  const yongHu = '用户第 ' + lun + ' 轮：' + (mao ? `请记住本次的暗号是 ${mao}，后面会考。` : '继续按上面的口径做。') + ' ' + tuiLi(lun);
  for (const [role, raw] of [['user', yongHu], ['assistant', '助手第 ' + lun + ' 轮回执：已按要求推进，细节见交付物。'], ['tool', daKuai(lun)]]) {
    const ccr = ccrGateway.beforeLog({ kind: 'message', content: raw });
    const rec = svc.append(
      { id: `m-${lun}-${role}`, sessionId: SID, kind: 'message', role, ti: ccr.content, groupId: SID, entityType: 'chat' },
      'duty'
    );
    log.push({ seq: rec.seq, role, content: ccr.content, recordId: rec.id, ts: rec.ts });
    appendCiShu += 1;
  }
  try {
    const r = xuanranYoujieShitu(log, {
      budgetChars: YU_SUAN_ZI,
      keepHead: DEFAULT_KEEP_HEAD,
      keepTail: DEFAULT_KEEP_TAIL,
      recallHint: `第 ${lun} 轮工作记录`,
    });
    const zi = r.xiaoXiJi.reduce((s, m) => s + String(m.content || '').length, 0);
    if (zi > r.stats.budgetChars) { chaoYu += 1; if (!cuoWu) cuoWu = `第 ${lun} 轮视图 ${zi} 字符 > 预算 ${r.stats.budgetChars}`; }
    zuiDaShiTuZi = Math.max(zuiDaShiTuZi, zi);
    yiLiuZi = r.stats.logBytes;
    if (lun === 1 || lun === Math.floor(ROUNDS / 2) || lun === ROUNDS) zhenDuanJiLu.push({ lun, zi, logZi: r.stats.logBytes, pointers: r.stats.pointers, entries: r.stats.logEntries });
  } catch (e) {
    cuoWu = cuoWu || `第 ${lun} 轮渲染抛错：${String(e && e.message || e).slice(0, 160)}`;
  }
}
const totalZi = log.reduce((s, m) => s + m.content.length, 0);
const guJiToken = Math.round(totalZi / CHARS_PER_TOKEN);
console.log(`S1 ${ROUNDS} 轮 · 聊天记录 ${totalZi} 字符 ≈ ${guJiToken} token · 渲染最大视图 ${zuiDaShiTuZi} 字符（预算 ${YU_SUAN_ZI}）· ${((Date.now() - kaiShi) / 1000).toFixed(1)}s`);
jian('S1 每一轮渲染出来的视图都不超预算（10M 量级下**一次超窗都没有**）', chaoYu === 0 && !cuoWu, cuoWu || `超预算轮数=${chaoYu}`);
jian('S1 视图大小与聊天记录大小**脱钩**（记录涨了千倍，视图仍是同一量级 ⇒ 不是"越聊越长"）',
  zuiDaShiTuZi <= YU_SUAN_ZI && totalZi > zuiDaShiTuZi * 3, `记录 ${totalZi} vs 视图 ${zuiDaShiTuZi}`);
jian('S1 估算 token 远超模型窗口（这才叫压测：' + guJiToken + ' token vs 窗口 ' + CHUANGKOU_TOKENS + '）',
  guJiToken > CHUANGKOU_TOKENS * 2, 'guJiToken=' + guJiToken);
jian('S1 被省略的部分**都留下指针**（不是静默截断；指针是"能取回"的前提）',
  zhenDuanJiLu.slice(-1)[0]?.pointers > 0, JSON.stringify(zhenDuanJiLu));

/* ───────────────────────── S2：一条不少、每条都能取回、重启后一样 ───────────────────────── */
{
  const tongJi = svc.stats();
  jian('S2 落盘条数 = 写入条数（JSONL 与投影都不许多也不许少）',
    tongJi.jsonlLines === appendCiShu && tongJi.records === appendCiShu,
    `JSONL=${tongJi.jsonlLines} 投影=${tongJi.records} 写入=${appendCiShu}`);
  jian('S2 序号连续到最后一轮（中间没有断号 ⇒ 渲染层看到的镜像与写进去的是同一份）',
    tongJi.seq === appendCiShu && log[log.length - 1]?.seq === appendCiShu,
    `最大 seq=${tongJi.seq} 末条=${log[log.length - 1]?.seq}`);
  /** 抽头/中/尾各若干条：必须按 recordId 精确取回原文（前 30 字符逐字一致） */
  const yang = [log[0], log[Math.floor(log.length / 3)], log[Math.floor(log.length / 2)], log[Math.floor(log.length * 0.8)], log[log.length - 1]];
  let quHui = 0;
  const que = [];
  for (const e of yang) {
    try {
      const out = svc.retrieve({ recordId: e.recordId }, { maxChars: 8000 });
      const s = String(out?.raw || out?.ti || out?.text || (out?.records || []).map((r) => r.ti || r.raw).join('\n') || '');
      if (s.includes(e.content.slice(0, 30))) quHui += 1; else que.push(`${e.seq}:${s.slice(0, 40) || '(空)'}`);
    } catch (err) { que.push(`${e.seq}:${String(err && err.message || err).slice(0, 60)}`); }
  }
  jian('S2 抽查的头/中/尾条目**逐字取回原文**（有指针 ≠ 取得回，这条才叫"不丢"）', quHui === yang.length, que.join(' / '));
  /** 早期暗号是否还在原始事实库里（视图早就把它挤出去了，但记忆必须有） */
  const zaoMao = MAO.get(zhuiJia[0]);
  const zhao = svc.recall(String(zaoMao), 5, { scope: { sessionId: SID } });
  jian('S2 最早那条埋点（' + zaoMao + '）在**第 ' + ROUNDS + ' 轮之后**仍 recall 得到', zhao.length > 0, JSON.stringify(zhao).slice(0, 200));
  /** 重开服务（只读 JSONL 重建）⇒ 条数与原文都还在 ⇒ 重启不丢 */
  const svc2 = new JiyiCangFuwu({ CangLu: tmpJi });
  let chongHui = 0;
  for (const e of [log[0], log[log.length - 1]]) {
    try {
      const out = svc2.retrieve({ recordId: e.recordId }, { maxChars: 8000 });
      const s = String(out?.raw || out?.ti || out?.text || '');
      if (s.includes(e.content.slice(0, 30))) chongHui += 1;
    } catch { /* 取不回就是没取回 */ }
  }
  const tongJi2 = svc2.stats();
  jian('S2 重开一个记忆服务只读 JSONL，头尾两条仍能逐字取回、条数一致（进程重启不失忆）',
    chongHui === 2 && tongJi2.records === appendCiShu, chongHui + '/2 条数=' + tongJi2.records);
  try { svc2.close(); } catch { /* noop */ }
}

/* ───────────────────────── S3：真模型回忆开头 / 中间 / 最近 ───────────────────────── */
if (!QUICK) {
  const keyLu = String(process.env.MIMO_KEY_FILE || '').trim();
  if (!keyLu || !fs.existsSync(keyLu)) {
    console.log('S3 缺 MIMO_KEY_FILE ⇒ 真模型召回不跑（**不假绿**：这一段没跑就明确报缺，退出码算红）');
    jian('S3 有可用的真模型密钥（缺了就整段无法证伪，不允许静默跳过）', false, keyLu || '(未设置)');
  } else {
    const miYao = fs.readFileSync(keyLu, 'utf8').split(/\r?\n/)[0].trim();
    const jiDian = [zhuiJia[0], zhuiJia[Math.floor(zhuiJia.length / 2)], zhuiJia[zhuiJia.length - 1]];
    const tuBiao = [];
    for (const [i, lun] of jiDian.entries()) {
      const mao = MAO.get(lun);
      const bian = ['开头', '中间', '最近'][i] || '第' + lun + '轮';
      const r = xuanranYoujieShitu(log, { budgetChars: YU_SUAN_ZI, keepHead: DEFAULT_KEEP_HEAD, keepTail: DEFAULT_KEEP_TAIL, recallHint: '历史记忆点抽查：' + bian });
      const viewChars = r.xiaoXiJi.reduce((s, m) => s + String(m.content || '').length, 0);
      const zaiShiTu = r.xiaoXiJi.some((m) => String(m.content || '').includes(mao));
      /**
       * 暗号已被挤出视图 ⇒ 走产品真实的那条腿：**照指针取回原文**再问模型
       * （真运行时是模型自己调 `retrieve(recordId=…)`，宿主把原文回给它；这里由门禁代打这一发，
       * 因为要验的是"原文还在不在、能不能逐字取回并让模型用上"，不是验模型会不会想到要调工具）。
       */
      const bu = [];
      let jieYue = '';
      let naTiaoJi = '';
      if (!zaiShiTu) {
        const cards = svc.recall(mao, 8, { scope: { sessionId: SID } });
        /**
         * 逐条按指针取回，**取到含暗号的那条为止**（真运行时是模型自己决定 retrieve 哪条 recordId；
         * 只取第一条会取到同轮的"工具输出"记录 ⇒ 原文里没有暗号 ⇒ 把仪器错记成产品失忆）。
         */
        for (const c of cards) {
          if (!c || !c.recordId) continue;
          const out = svc.retrieve({ recordId: c.recordId }, { maxChars: 8000 });
          const raw = String(out?.raw || '');
          if (raw) {
            jieYue = raw;
            naTiaoJi = String(out.recordId || c.recordId) + '(' + raw.length + '字' + (raw.includes(mao) ? ',含暗号' : ',不含') + ')';
            if (raw.includes(mao)) break;
          }
        }
        if (jieYue) bu.push({ role: 'system', content: '（宿主按指针取回的原文）\n' + jieYue.slice(0, 1200) });
      }
      const tiShi = `这次会话里**第 ${lun} 轮**（${bian}）让你记住的暗号是什么？只回答那个暗号字符串。`;
      /**
       * 问法不能留"你可以去检索"的余地：真机 r40 第 1 遍就是在这里红的 ——
       * 旧措辞写了"只依据给你的材料与**可以检索到的原始记录**回答"，模型看到"可以检索"
       * 就直接回了一段 `<invoke name="recall">` 的**假工具调用**（这一发根本没有 tools 参数）。
       * 那是我们把模型引去演工具，不是记忆坏了 ⇒ 判据这边收紧：只依据材料、不许调用工具；
       * 并且**宿主侧的"原文取不取得回来"另有独立断言**（下面那条），两者不互相顶包。
       */
      const xiTong = '你在一个超长会话里。只依据下面给你的材料回答；**不要调用任何工具，不要输出工具调用格式**，只输出答案本身。';
      let da = '';
      let cuo = '';
      let changShi = 0;
      const faYiCi = async (zhiShao) => {
        const resp = await fetch('https://token-plan-cn.xiaomimimo.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + miYao },
          body: JSON.stringify({
            model: MIMO_MODEL,
            messages: [
              { role: 'system', content: zhiShao },
              ...r.xiaoXiJi.map((m) => ({ role: m.role === 'tool' ? 'system' : m.role, content: String(m.content || '') })),
              ...bu,
              { role: 'user', content: tiShi },
            ],
            max_tokens: 200,
            temperature: 0,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + JSON.stringify(j).slice(0, 200));
        return String(j?.choices?.[0]?.message?.content || '');
      };
      for (changShi = 1; changShi <= 2; changShi += 1) {
        try {
          da = await faYiCi(changShi === 1 ? xiTong : xiTong + '\n（上一次你输出了工具调用格式，这次**只用纯文本回答那个暗号本身**。）');
          cuo = '';
        } catch (e) { cuo = String((e && e.message) || e).slice(0, 200); da = ''; }
        if (da.includes(mao)) break;
      }
      tuBiao.push({ bian, lun, mao, zaiShiTu, jieYueZh: jieYue.length, na: naTiaoJi, hanMao: jieYue.includes(mao), viewChars, changShi, da: da.slice(0, 60) });
      jian(`S3 ${bian}（第 ${lun} 轮）暗号 ${mao} 真模型答得出、且没超窗`,
        !cuo && da.includes(mao), cuo || `答="${da.slice(0, 80)}" 在视图内=${zaiShiTu} 取回=${naTiaoJi || '无'} 视图=${viewChars}字符/预算 ${YU_SUAN_ZI}`);
    }
    jian('S3 三处暗号的**原文都确实取得回来**（视图外的必须能靠指针取到含暗号的那条 ⇒ 把"记忆坏了"和"模型没答好"分开判）',
      tuBiao.every((t) => t.zaiShiTu || t.hanMao),
      JSON.stringify(tuBiao.map((t) => t.bian + ':' + (t.zaiShiTu ? '视图内' : '取回=' + (t.na || '无') + ' 含暗号=' + t.hanMao))));
    jian('S3 每一发请求的视图字符都 ≤ 预算（真调模型那几发也没越界）',
      tuBiao.every((t) => t.viewChars <= YU_SUAN_ZI), JSON.stringify(tuBiao));
    jian('S3 至少有一发是"已被挤出视图 ⇒ 靠取回原文才答对"（这才证明指针真的能用，不是靠窗口大）',
      tuBiao.some((t) => !t.zaiShiTu && t.jieYueZh > 0), JSON.stringify(tuBiao.map((t) => t.bian + ':' + (t.zaiShiTu ? '在视图' : '靠取回' + t.jieYueZh))));
    console.log(tuBiao.map((t) => `  · ${t.bian} 第${t.lun}轮 ${t.mao} → ${t.zaiShiTu ? '视图内含' : '视图外·取回 ' + t.jieYueZh + ' 字'} 答="${t.da}"`).join('\n'));
  }
} else {
  console.log('S3 --quick ⇒ 跳过真模型召回（只验宿主侧有界与不失忆）');
}

if (!KEEP) { try { fs.rmSync(tmpJi, { recursive: true, force: true }); } catch { /* noop */ } } else console.log('保留临时目录：' + tmpJi);
try { svc.close(); } catch { /* noop */ }

console.log(`\n第 39 轮超长会话门禁：${ok} 通过 / ${shi.length} 失败`);
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
