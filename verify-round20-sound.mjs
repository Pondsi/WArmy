/**
 * 第 20 轮 · 任务7：消除来源不明的「滴」声
 *
 * 用户现象：仍有滴声，**不是**完成音、不是决策卡音、不是异常警告音；
 * 像是"思考和中途回复消失了，几秒后再次出现时一同出现滴声"。
 *
 * 根因：待播音（`yinXiaoDaiBo`）补播机制**没有时效**。一次 play() 被自动播放策略
 * 拦下后记录永久挂着，而补播触发点有三个（700ms 定时、**任何** pointerdown/keydown、
 * AudioContext statechange）⇒ 那一声可能几十秒后、用户随手一点时才响。
 *
 * 本测试直接跑 app.js 里的真函数（`jiDaiBoYinXiao` / `buBoChenJiYinXiao` 等），
 * 不另写等价实现。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-sound.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');

/** 抠出待播音的那几个真函数 + 常量（它们彼此相邻） */
function chouDuan(kaiBiao, jieBiao) {
  const a = app.indexOf(kaiBiao);
  const b = app.indexOf(jieBiao, a);
  if (a < 0 || b < 0) throw new Error('抠不到：' + kaiBiao);
  return app.slice(a, b);
}

const duan1 = chouDuan('let yinXiaoDaiBoAt = 0;', 'async function chuanBoYinXiao');
const duan2 = chouDuan('function buBoChenJiYinXiao() {', 'window.__qingHuanCunYinXiao');

const riZhi = [];
const boGuo = [];
const sb = {
  state: { sound: {} },
  Date,
  setTimeout: (fn) => { boGuo.push('scheduled'); return 0; },   // 真补播会走 setTimeout
  jiYinXiao: (o) => riZhi.push(o),
  chuanBoYinXiao: (k, l) => { boGuo.push(k + '/' + l); return true; },
};
vm.createContext(sb);
vm.runInContext(`${duan1}\n${duan2}\n
this.jiDaiBoYinXiao = jiDaiBoYinXiao;
this.qingDaiBoYinXiao = qingDaiBoYinXiao;
this.buBoChenJiYinXiao = buBoChenJiYinXiao;
this.chaKan = () => ({ k: yinXiaoDaiBo, at: yinXiaoDaiBoAt });
this.zaoDeng = (ms) => { yinXiaoDaiBoAt -= ms; };
this.shiXiao = YINXIAO_DAIBO_SHIXIAO;
`, sb);

console.log('\n任务7 · 待播提示音的时效');

shuo(typeof sb.shiXiao === 'number' && sb.shiXiao > 0 && sb.shiXiao <= 10000,
  `待播音有明确时效（${sb.shiXiao}ms）`);

// 1. 时效内：正常补播
{
  riZhi.length = 0; boGuo.length = 0;
  sb.jiDaiBoYinXiao('request');
  sb.buBoChenJiYinXiao();
  shuo(boGuo.length === 1, '时效内的待播音会补播', JSON.stringify(boGuo));
  shuo(sb.chaKan().k === null, '补播后清掉记录（不会重复响）');
}

// 2. 过期：直接丢，且如实记账
{
  riZhi.length = 0; boGuo.length = 0;
  sb.jiDaiBoYinXiao('request');
  sb.zaoDeng(sb.shiXiao + 1000);          // 把登记时刻往前拨，模拟"几十秒后用户才点一下"
  sb.buBoChenJiYinXiao();
  shuo(boGuo.length === 0, '过期的待播音不再补播（这正是神秘滴声的来源）', JSON.stringify(boGuo));
  shuo(riZhi.some((x) => x.lu === 'expired'), '过期被如实记进音效日志', JSON.stringify(riZhi));
}

// 3. 期间用户把该类别关了 ⇒ 不补播
{
  riZhi.length = 0; boGuo.length = 0;
  sb.state.sound = { request: false };
  sb.jiDaiBoYinXiao('request');
  sb.buBoChenJiYinXiao();
  shuo(boGuo.length === 0, '补播前重查开关：已关闭的类别不出声', JSON.stringify(boGuo));
  shuo(riZhi.some((x) => x.lu === 'off'), '关闭原因如实记账');
  sb.state.sound = {};
}

// 4. 没有待播记录 ⇒ 什么都不做
{
  riZhi.length = 0; boGuo.length = 0;
  sb.qingDaiBoYinXiao();
  sb.buBoChenJiYinXiao();
  shuo(boGuo.length === 0 && riZhi.length === 0, '没有待播音时完全静默');
}

// 5. 源码层面：所有写入点都走统一入口（防止漏写时刻 ⇒ 又变成永久待播）
console.log('\n源码收口');
{
  // 排除 `let yinXiaoDaiBo = null;` 这行声明，只数真正的赋值
  const fuZhi = [...app.matchAll(/(^|[^a-zA-Z_$.])yinXiaoDaiBo\s*=/gm)]
    .filter((m) => !/\blet\s+yinXiaoDaiBo\s*=/.test(app.slice(Math.max(0, m.index - 6), m.index + 20)));
  shuo(fuZhi.length === 2,
    `待播音只在两个统一入口里赋值（记/清各一处，实得 ${fuZhi.length} 处）`);
  shuo(/function jiDaiBoYinXiao\(k\) \{\s*yinXiaoDaiBo = k;\s*yinXiaoDaiBoAt = Date\.now\(\);/.test(app),
    '记账入口同时写 kind 与时刻（不会漏写时刻变成永久待播）');
  shuo(/function qingDaiBoYinXiao\(\) \{\s*yinXiaoDaiBo = null;\s*yinXiaoDaiBoAt = 0;/.test(app),
    '清空入口同时清 kind 与时刻');
  shuo(/if \(!at \|\| Date\.now\(\) - at > YINXIAO_DAIBO_SHIXIAO\)/.test(app), '补播前做时效判断');
}

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
